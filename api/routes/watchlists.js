// Watchlists (FR-32–FR-37): list, create, rename, delete, add/remove one
// symbol, two-step .txt import, export. Symbols are always stored as
// NSE:XXX-EQ after checking the symbol master. The F&O seed is read-only (D2).
// Runs keep their own symbol snapshot, so nothing here touches past runs.

const { withTransaction } = require('../db/pool');
const { insertSymbols } = require('../db/watchlists');
const { previewImport } = require('../watchlists');
const { httpError } = require('../errors');

const idParam = { type: 'object', properties: { id: { type: 'integer', minimum: 1 } } };
const name = { type: 'string', minLength: 1, maxLength: 80 };
const description = { type: ['string', 'null'], maxLength: 500 };

const LIST_COLUMNS = `w.id, w.name, w.description, w.source, w.read_only as "readOnly", w.source_file as "sourceFile",
  w.created_at as "createdAt", w.updated_at as "updatedAt"`;

const UNIQUE_VIOLATION = '23505';
const nameTaken = (err) => {
  if (err.code === UNIQUE_VIOLATION) throw httpError(409, 'A watchlist with that name already exists.');
  throw err;
};

async function watchlistRoutes(app) {
  const db = app.db;

  function master() {
    if (!app.symbols?.ready()) throw httpError(503, 'Symbol list is still loading. Try again in a minute.');
    return app.symbols;
  }

  async function find(id, { writable = false } = {}) {
    const { rows } = await db.query(`select ${LIST_COLUMNS} from watchlists w where id = $1`, [id]);
    if (!rows.length) throw httpError(404, 'Watchlist not found');
    const list = { ...rows[0], id: Number(rows[0].id) };
    if (writable && list.readOnly) throw httpError(409, `${list.name} is read-only.`);
    return list;
  }

  const symbolsOf = async (id) =>
    (await db.query('select symbol from watchlist_symbols where watchlist_id = $1 order by added_at, symbol', [id])).rows.map((r) => r.symbol);

  const touch = (client, id, sourceFile) =>
    client.query('update watchlists set updated_at = now(), source_file = coalesce($2, source_file) where id = $1', [id, sourceFile ?? null]);

  app.get('/api/watchlists', async () => {
    const { rows } = await db.query(
      `select ${LIST_COLUMNS}, count(s.symbol)::int as count
       from watchlists w left join watchlist_symbols s on s.watchlist_id = w.id
       group by w.id order by w.read_only, w.name`
    );
    return { watchlists: rows.map((r) => ({ ...r, id: Number(r.id) })) };
  });

  app.post(
    '/api/watchlists',
    { schema: { body: { type: 'object', required: ['name'], additionalProperties: false, properties: { name, description } } } },
    async (request, reply) => {
      const { rows } = await db
        .query(`insert into watchlists (name, description, source) values ($1, $2, 'custom') returning id`, [
          request.body.name.trim(),
          request.body.description ?? null,
        ])
        .catch(nameTaken);
      reply.code(201);
      return { watchlist: await find(Number(rows[0].id)) };
    }
  );

  // Symbols with company names and their latest finished run's stats (FR-36).
  app.get('/api/watchlists/:id', { schema: { params: idParam } }, async (request) => {
    const list = await find(request.params.id);
    const { rows } = await db.query(
      `select s.symbol, s.added_at as "addedAt", latest.run_id as "runId", latest.metrics
       from watchlist_symbols s
       left join lateral (
         select rs.metrics, r.id as run_id from run_symbols rs join runs r on r.id = rs.run_id
         where r.status = 'done' and rs.status = 'done' and rs.symbol = s.symbol
         order by r.finished_at desc limit 1
       ) latest on true
       where s.watchlist_id = $1 order by s.added_at, s.symbol`,
      [list.id]
    );
    const nameOf = (s) => (app.symbols?.ready() ? app.symbols.lookup(s)?.name ?? null : null);
    const symbols = rows.map((r) => ({
      symbol: r.symbol,
      name: nameOf(r.symbol),
      addedAt: r.addedAt,
      latest: r.metrics && { runId: Number(r.runId), trades: r.metrics.totalTrades, winRate: r.metrics.winRate, totalPnl: r.metrics.totalPnl },
    }));
    return { watchlist: { ...list, count: symbols.length }, symbols };
  });

  app.patch(
    '/api/watchlists/:id',
    { schema: { params: idParam, body: { type: 'object', minProperties: 1, additionalProperties: false, properties: { name, description } } } },
    async (request) => {
      const list = await find(request.params.id, { writable: true });
      const { name: newName, description: desc } = request.body;
      await db
        .query(
          `update watchlists set name = coalesce($2, name), description = case when $4 then $3 else description end,
             updated_at = now() where id = $1`,
          [list.id, newName?.trim() ?? null, desc ?? null, 'description' in request.body]
        )
        .catch(nameTaken);
      return { watchlist: await find(list.id) };
    }
  );

  app.delete('/api/watchlists/:id', { schema: { params: idParam } }, async (request, reply) => {
    const list = await find(request.params.id, { writable: true });
    await db.query('delete from watchlists where id = $1', [list.id]);
    reply.code(204);
  });

  app.post(
    '/api/watchlists/:id/symbols',
    { schema: { params: idParam, body: { type: 'object', required: ['symbol'], properties: { symbol: { type: 'string', maxLength: 40 } } } } },
    async (request, reply) => {
      const list = await find(request.params.id, { writable: true });
      const hit = master().classify(request.body.symbol);
      if (hit.kind === 'index') throw httpError(400, `${hit.symbol} is an index, not a stock.`);
      if (hit.kind !== 'equity') throw httpError(400, `${request.body.symbol} is not an NSE equity.`);
      await withTransaction(db, async (client) => {
        await insertSymbols(client, list.id, [hit.symbol]);
        await touch(client, list.id);
      });
      reply.code(201);
      return { symbol: hit.symbol, name: hit.name };
    }
  );

  app.delete(
    '/api/watchlists/:id/symbols/:symbol',
    { schema: { params: { type: 'object', properties: { id: { type: 'integer', minimum: 1 }, symbol: { type: 'string' } } } } },
    async (request, reply) => {
      const list = await find(request.params.id, { writable: true });
      await withTransaction(db, async (client) => {
        await client.query('delete from watchlist_symbols where watchlist_id = $1 and symbol = $2', [list.id, request.params.symbol]);
        await touch(client, list.id);
      });
      reply.code(204);
    }
  );

  const importText = { type: 'object', required: ['text'], properties: { fileName: { type: 'string', maxLength: 200 }, text: { type: 'string', maxLength: 200000 } } };

  // Step 1: classify the file against the list. Writes nothing (D3).
  app.post('/api/watchlists/:id/import/preview', { schema: { params: idParam, body: importText } }, async (request) => {
    const list = await find(request.params.id);
    try {
      return previewImport(request.body.text, { classify: master().classify, existing: await symbolsOf(list.id) });
    } catch (err) {
      if (err.tooLong) throw httpError(400, err.message);
      throw err;
    }
  });

  // Step 2: apply the symbols the owner confirmed. add/replace change this
  // list (not allowed on read-only); new creates a list and leaves this one be.
  app.post(
    '/api/watchlists/:id/import',
    {
      schema: {
        params: idParam,
        body: {
          type: 'object',
          required: ['mode', 'symbols'],
          additionalProperties: false,
          properties: {
            mode: { enum: ['add', 'replace', 'new'] },
            name,
            fileName: { type: 'string', maxLength: 200 },
            symbols: { type: 'array', items: { type: 'string', maxLength: 40 }, maxItems: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      const { mode, symbols: raw, fileName } = request.body;
      const list = await find(request.params.id, { writable: mode !== 'new' });
      if (mode === 'new' && !request.body.name?.trim()) throw httpError(400, 'Name the new watchlist.');

      // Re-check: the preview's output is only a suggestion from the browser.
      const classify = master().classify;
      const symbols = [];
      for (const s of raw) {
        const hit = classify(s);
        if (hit.kind !== 'equity') throw httpError(400, `${s} is not an NSE equity.`);
        if (!symbols.includes(hit.symbol)) symbols.push(hit.symbol);
      }

      const id = await withTransaction(db, async (client) => {
        let target = list.id;
        if (mode === 'new') {
          const { rows } = await client
            .query(`insert into watchlists (name, source, source_file) values ($1, 'import', $2) returning id`, [request.body.name.trim(), fileName ?? null])
            .catch(nameTaken);
          target = Number(rows[0].id);
        } else if (mode === 'replace') {
          await client.query('delete from watchlist_symbols where watchlist_id = $1', [target]);
        }
        await insertSymbols(client, target, symbols);
        await touch(client, target, fileName);
        return target;
      });
      if (mode === 'new') reply.code(201);
      return { watchlist: { ...(await find(id)), count: (await symbolsOf(id)).length } };
    }
  );

  // FR-35: one full symbol per line, ready for lists/ or a re-import.
  app.get('/api/watchlists/:id/export', { schema: { params: idParam } }, async (request, reply) => {
    const list = await find(request.params.id);
    const file = `${list.name.replace(/[^A-Za-z0-9_-]+/g, '_')}.txt`;
    reply.header('content-type', 'text/plain; charset=utf-8').header('content-disposition', `attachment; filename="${file}"`);
    return (await symbolsOf(list.id)).join('\n') + '\n';
  });
}

module.exports = { watchlistRoutes };
