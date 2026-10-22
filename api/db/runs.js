// Creating runs and asking running ones to stop or carry on. The worker
// (api/worker.js) does the executing; these are what the API calls.

const { withTransaction } = require('./pool');

async function insertRun(client, { name = null, config, fromDate, toDate, symbols, watchlistName = null }, sweepId = null) {
  const { rows } = await client.query(
    `insert into runs (name, sweep_id, status, config, from_date, to_date, watchlist_name, symbols, total)
     values ($1, $2, 'queued', $3, $4, $5, $6, $7, $8) returning id`,
    [name, sweepId, config, fromDate, toDate, watchlistName, symbols, symbols.length]
  );
  const id = rows[0].id;
  await client.query(
    `insert into run_symbols (run_id, symbol, position, status)
     select $1, symbol, position - 1, 'pending' from unnest($2::text[]) with ordinality as s(symbol, position)`,
    [id, symbols]
  );
  return Number(id);
}

// spec: { name, config, fromDate, toDate, symbols, watchlistName }. config is
// the full settings snapshot (FR-13); symbols are a snapshot too (FR-37).
function createRun(pool, spec) {
  return withTransaction(pool, (client) => insertRun(client, spec));
}

// One run per variant, sharing a sweep_id (the first run's id). Each variant's
// overrides are merged over spec.config. Returns the run ids in variant order.
function createSweep(pool, spec, variants) {
  return withTransaction(pool, async (client) => {
    const ids = [];
    for (const { label, ...overrides } of variants) {
      const run = { ...spec, name: spec.name ? `${spec.name} · ${label}` : label, config: { ...spec.config, ...overrides } };
      ids.push(await insertRun(client, run, ids[0] ?? null));
    }
    await client.query('update runs set sweep_id = $1 where id = $1', [ids[0]]);
    return ids;
  });
}

// A queued run is cancelled on the spot; a running one stops after its current
// symbol (FR-19). Returns false if the run had already finished.
async function requestCancel(pool, id) {
  const { rowCount } = await pool.query(
    `update runs set
       cancel_requested = true,
       status = case when status = 'queued' then 'cancelled' else status end,
       finished_at = case when status = 'queued' then now() else finished_at end
     where id = $1 and status in ('queued', 'running')`,
    [id]
  );
  return rowCount > 0;
}

// Puts a failed run back in the queue; its pending symbols continue and failed
// symbols stay failed (FR-17). Returns false unless the run had failed.
async function requestResume(pool, id) {
  const { rowCount } = await pool.query(
    `update runs set status = 'queued', error = null, finished_at = null where id = $1 and status = 'failed'`,
    [id]
  );
  return rowCount > 0;
}

module.exports = { createRun, createSweep, requestCancel, requestResume };
