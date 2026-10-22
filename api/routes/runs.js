// Runs API (FR-9–FR-19): launcher defaults and estimate, create (single run or
// sweep), list, get with per-symbol progress, rename/cancel/resume, delete.
// Execution is the worker's job; these routes only queue and report.

const baseConfig = require('../../config');
const fyers = require('../../src/fyers');
const { TARGET_VARIANTS } = require('../../src/targets');
const { createRun, createSweep, requestCancel, requestResume } = require('../db/runs');
const { draftSchema, validate, snapshot, strategyOf, estimate, callsPerSymbol } = require('../runSpec');
const { httpError } = require('../errors');

const idParam = { type: 'object', properties: { id: { type: 'integer', minimum: 1 } } };

const RUN_COLUMNS = `id, name, sweep_id as "sweepId", status, cancel_requested as "cancelRequested", config,
  from_date::text as "fromDate", to_date::text as "toDate", watchlist_name as "watchlistName",
  total, done, metrics, calls_used as "callsUsed", error, created_at as "createdAt",
  started_at as "startedAt", finished_at as "finishedAt"`;

const toRun = (row) => row && { ...row, id: Number(row.id), sweepId: row.sweepId === null ? null : Number(row.sweepId) };

async function runRoutes(app, { symbols }) {
  const db = app.db;

  async function findRun(id) {
    const { rows } = await db.query(`select ${RUN_COLUMNS} from runs where id = $1`, [id]);
    if (!rows.length) throw httpError(404, 'Run not found');
    return toRun(rows[0]);
  }

  // The draft's symbols, as NSE:X-EQ, deduplicated, in the order given.
  async function resolveSymbols(body) {
    let list = body.symbols;
    let watchlistName = null;
    if (body.watchlistId) {
      const { rows } = await db.query(
        `select w.name, coalesce(array_agg(s.symbol order by s.added_at, s.symbol) filter (where s.symbol is not null), '{}') as symbols
         from watchlists w left join watchlist_symbols s on s.watchlist_id = w.id where w.id = $1 group by w.id`,
        [body.watchlistId]
      );
      if (!rows.length) throw httpError(400, 'Watchlist not found.');
      watchlistName = rows[0].name;
      list = rows[0].symbols;
    }
    if (!list || !list.length) throw httpError(400, 'Pick at least one symbol.');

    const out = [];
    const unknown = [];
    for (const raw of list) {
      let symbol = null;
      if (symbols && symbols.ready()) {
        const hit = symbols.classify(raw);
        if (hit.kind === 'equity') symbol = hit.symbol;
      } else if (/^NSE:[A-Z0-9&_-]+-EQ$/.test(raw)) {
        symbol = raw; // master still loading: accept the canonical form only
      }
      if (!symbol) unknown.push(raw);
      else if (!out.includes(symbol)) out.push(symbol);
    }
    if (unknown.length) throw httpError(400, `Not NSE equities: ${unknown.slice(0, 10).join(', ')}${unknown.length > 10 ? ' …' : ''}`);
    return { symbols: out, watchlistName };
  }

  // Validates a draft and prices it against what is left of today's budget,
  // after the calls already promised to queued and running runs.
  async function price(body) {
    const config = snapshot(body.config);
    const errors = validate({ fromDate: body.fromDate, toDate: body.toDate, config });
    if (errors.length) throw httpError(400, errors.join(' '));
    const resolved = await resolveSymbols(body);

    const { rows } = await db.query(
      `select coalesce(sweep_id, id) as grp, from_date::text as "fromDate", to_date::text as "toDate",
         (select count(*)::int from run_symbols rs where rs.run_id = runs.id and rs.status = 'pending') as pending
       from runs where status in ('queued', 'running')`
    );
    // A sweep fetches once for all its variants, so count each group once.
    const byGroup = new Map();
    for (const r of rows) byGroup.set(r.grp, Math.max(byGroup.get(r.grp) || 0, r.pending * callsPerSymbol(r.fromDate, r.toDate)));
    const queued = [...byGroup.values()].reduce((a, b) => a + b, 0);

    const [usage, token] = await Promise.all([fyers.usageToday(), fyers.tokenStatus()]);
    const remaining = Math.max(0, usage.cap - usage.count - queued);
    const cost = estimate({ symbolCount: resolved.symbols.length, fromDate: body.fromDate, toDate: body.toDate });

    const blockers = [];
    if (!token.connected) blockers.push('Fyers is not connected.');
    if (usage.limited) blockers.push('Fyers data calls are paused after a 429 until 00:00 IST.');
    if (cost.calls > remaining) blockers.push(`Needs ${cost.calls} calls; ${remaining} left today.`);

    return {
      config,
      ...resolved,
      estimate: {
        symbols: resolved.symbols.length,
        ...cost,
        budget: { used: usage.count, cap: usage.cap, queued, remaining },
        share: remaining ? Math.round((cost.calls / remaining) * 1000) / 10 : null,
        canStart: blockers.length === 0,
        blockers,
      },
    };
  }

  // D7: the latest run's settings, else config.js. Dates are not carried over.
  app.get('/api/defaults', async () => {
    const { rows } = await db.query('select config from runs order by created_at desc, id desc limit 1');
    return rows.length
      ? { source: 'run', config: strategyOf(rows[0].config) }
      : { source: 'config', config: strategyOf({ ...baseConfig, resolution: '1' }) };
  });

  app.post('/api/estimate', { schema: { body: draftSchema } }, async (request) => (await price(request.body)).estimate);

  app.post('/api/runs', { schema: { body: draftSchema } }, async (request, reply) => {
    const body = request.body;
    const priced = await price(body);
    if (!priced.estimate.canStart) throw httpError(409, priced.estimate.blockers.join(' '));

    const spec = {
      name: body.name?.trim() || null,
      config: priced.config,
      fromDate: body.fromDate,
      toDate: body.toDate,
      symbols: priced.symbols,
      watchlistName: priced.watchlistName,
    };
    const ids = body.sweep ? await createSweep(db, spec, TARGET_VARIANTS) : [await createRun(db, spec)];
    app.worker?.wake();
    reply.code(201);
    return { id: ids[0], ids, sweepId: body.sweep ? ids[0] : null, estimate: priced.estimate };
  });

  // Newest first. A sweep's runs come as one entry so the list shows the group.
  app.get(
    '/api/runs',
    { schema: { querystring: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 } } } } },
    async (request) => {
      const { rows } = await db.query(`select ${RUN_COLUMNS} from runs order by created_at desc, id desc limit $1`, [request.query.limit]);
      const items = [];
      const sweeps = new Map();
      for (const run of rows.map(toRun)) {
        if (run.sweepId === null) {
          items.push({ type: 'run', run });
          continue;
        }
        if (!sweeps.has(run.sweepId)) {
          const entry = { type: 'sweep', sweepId: run.sweepId, runs: [] };
          sweeps.set(run.sweepId, entry);
          items.push(entry);
        }
        sweeps.get(run.sweepId).runs.push(run);
      }
      for (const s of sweeps.values()) s.runs.sort((a, b) => a.id - b.id);
      return { items };
    }
  );

  app.get('/api/runs/:id', { schema: { params: idParam } }, async (request) => {
    const run = await findRun(request.params.id);
    const { rows } = await db.query(
      `select symbol, position, status, reason, metrics, finished_at as "finishedAt"
       from run_symbols where run_id = $1 order by position`,
      [run.id]
    );
    let siblings = [];
    if (run.sweepId !== null) {
      const res = await db.query('select id from runs where sweep_id = $1 order by id', [run.sweepId]);
      siblings = res.rows.map((r) => Number(r.id));
    }
    return { run, symbols: rows, sweepRunIds: siblings };
  });

  app.patch(
    '/api/runs/:id',
    {
      schema: {
        params: idParam,
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          maxProperties: 1,
          properties: { name: { type: ['string', 'null'], maxLength: 120 }, cancel: { const: true }, resume: { const: true } },
        },
      },
    },
    async (request) => {
      const { id } = request.params;
      const body = request.body;
      const run = await findRun(id);
      if ('name' in body) {
        await db.query('update runs set name = $2 where id = $1', [id, body.name?.trim() || null]);
      } else if (body.cancel) {
        if (!(await requestCancel(db, id))) throw httpError(409, `Run is already ${run.status}.`);
      } else if (body.resume) {
        if (!(await requestResume(db, id))) throw httpError(409, 'Only a failed run can be resumed.');
        app.worker?.wake();
      }
      return { run: await findRun(id) };
    }
  );

  // A running run must be cancelled first, so the worker never writes into a
  // run that no longer exists.
  app.delete('/api/runs/:id', { schema: { params: idParam } }, async (request, reply) => {
    const run = await findRun(request.params.id);
    const { rowCount } = await db.query(`delete from runs where id = $1 and status <> 'running'`, [run.id]);
    if (!rowCount) throw httpError(409, 'Cancel the run before deleting it.');
    reply.code(204);
  });
}

module.exports = { runRoutes };
