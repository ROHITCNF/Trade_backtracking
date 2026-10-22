// Reading finished results (FR-20–FR-31): filtered analysis, trade rows and
// CSV, run comparison, and one trade's day candles for the chart.

const { getCandles: fetchCandles } = require('../../src/fetch');
const { computeMetrics } = require('../../src/metrics');
const { toCsv, COLUMNS } = require('../../src/tradeLog');
const { loadTrades, loadTrade } = require('../db/trades');
const { analyse, filterTrades } = require('../analysis');
const { STRATEGY_KEYS } = require('../runSpec');
const { httpError } = require('../errors');

const idParam = { type: 'object', properties: { id: { type: 'integer', minimum: 1 } } };
const date = { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' };
const csvList = { type: 'string', maxLength: 20000 };

// Filters arrive as ?side=long&reason=SL,EOD&from=…&to=…&symbols=NSE:A-EQ,NSE:B-EQ
const filterProps = { side: { enum: ['long', 'short'] }, reason: csvList, from: date, to: date, symbols: csvList };
const split = (s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined);
const filtersOf = (q) => ({ side: q.side, reasons: split(q.reason), from: q.from, to: q.to, symbols: split(q.symbols) });

const CSV_COLUMNS = ['symbol', ...COLUMNS];

async function analysisRoutes(app, { getCandles = fetchCandles }) {
  const db = app.db;

  async function runOf(id) {
    const { rows } = await db.query(
      `select id, name, status, config, sweep_id as "sweepId", from_date::text as "fromDate", to_date::text as "toDate",
         total, watchlist_name as "watchlistName", created_at as "createdAt", finished_at as "finishedAt"
       from runs where id = $1`,
      [id]
    );
    if (!rows.length) throw httpError(404, 'Run not found');
    return { ...rows[0], id: Number(rows[0].id), sweepId: rows[0].sweepId === null ? null : Number(rows[0].sweepId) };
  }

  app.get('/api/runs/:id/analysis', { schema: { params: idParam, querystring: { type: 'object', properties: filterProps } } }, async (request) => {
    const run = await runOf(request.params.id);
    const [trades, status] = await Promise.all([
      loadTrades(db, run.id),
      db.query('select status, count(*)::int as n from run_symbols where run_id = $1 group by status', [run.id]),
    ]);
    const symbolStatus = Object.fromEntries(status.rows.map((r) => [r.status, r.n]));
    const nameOf = (s) => app.symbols?.ready() ? app.symbols.lookup(s)?.name ?? null : null;
    return { run, ...analyse(trades, { config: run.config, filters: filtersOf(request.query), symbolStatus, nameOf }) };
  });

  app.get(
    '/api/runs/:id/trades',
    { schema: { params: idParam, querystring: { type: 'object', properties: { ...filterProps, format: { enum: ['json', 'csv'] } } } } },
    async (request, reply) => {
      const run = await runOf(request.params.id);
      const trades = filterTrades(await loadTrades(db, run.id), filtersOf(request.query));
      if (request.query.format !== 'csv') return { trades };
      // FR-26: the CLI's trade-log columns, plus the symbol since a run spans many.
      reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="run-${run.id}-trades.csv"`);
      return toCsv(trades, CSV_COLUMNS);
    }
  );

  // 2–4 runs by id, or a whole sweep group (FR-30, FR-31).
  app.get(
    '/api/compare',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { ids: { type: 'string', pattern: '^[0-9]+(,[0-9]+){1,3}$' }, sweep: { type: 'integer', minimum: 1 } },
          oneOf: [{ required: ['ids'] }, { required: ['sweep'] }],
        },
      },
    },
    async (request) => {
      let ids;
      if (request.query.sweep) {
        const { rows } = await db.query('select id from runs where sweep_id = $1 order by id', [request.query.sweep]);
        if (!rows.length) throw httpError(404, 'Sweep not found');
        ids = rows.map((r) => Number(r.id));
      } else {
        ids = [...new Set(request.query.ids.split(',').map(Number))];
        if (ids.length < 2) throw httpError(400, 'Pick 2 to 4 different runs.');
      }

      const runs = [];
      for (const id of ids) {
        const run = await runOf(id);
        const trades = await loadTrades(db, id);
        const bySymbol = {};
        for (const t of trades) bySymbol[t.symbol] = (bySymbol[t.symbol] || 0) + t.pnl;
        for (const s in bySymbol) bySymbol[s] = Math.round(bySymbol[s] * 100) / 100;
        runs.push({ run, metrics: computeMetrics(trades), bySymbol });
      }

      // Settings that differ between the runs; the rest is shared.
      const fields = [...STRATEGY_KEYS.map((k) => [k, (r) => r.config[k]]), ['fromDate', (r) => r.fromDate], ['toDate', (r) => r.toDate], ['symbols', (r) => r.total]];
      const settingsDiff = fields
        .map(([key, get]) => ({ key, values: runs.map(({ run }) => get(run) ?? null) }))
        .filter(({ values }) => new Set(values.map((v) => JSON.stringify(v))).size > 1);
      return { runs, settingsDiff };
    }
  );

  // The trade's day on 1-minute candles: one Fyers call through rest(), never
  // stored (FR-29). The browser caches it for the session.
  app.get('/api/trades/:id/candles', { schema: { params: idParam } }, async (request, reply) => {
    const trade = await loadTrade(db, request.params.id);
    if (!trade) throw httpError(404, 'Trade not found');
    let candles;
    try {
      candles = await getCandles({ symbol: trade.symbol, resolution: '1', fromDate: trade.date, toDate: trade.date });
    } catch (err) {
      if (/No Fyers token/.test(err.message)) throw httpError(409, 'Connect Fyers to load the chart.');
      if (/REST budget|429/.test(err.message)) throw httpError(503, err.message); // our own throttle message
      request.log.warn({ code: err.code, trade: trade.id }, 'candles: fetch failed');
      throw httpError(502, 'Could not load candles from Fyers.');
    }
    reply.header('cache-control', 'private, max-age=3600');
    return { trade, candles: candles.map(([t, o, h, l, c]) => [t, o, h, l, c]) };
  });
}

module.exports = { analysisRoutes };
