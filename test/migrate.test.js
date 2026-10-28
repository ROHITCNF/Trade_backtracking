const test = require('node:test');
const assert = require('node:assert/strict');
const { migrate } = require('../api/db/migrate');
const { createTestDb, noDb } = require('./db');

const TABLES = ['fyers_token', 'live_decisions', 'live_state', 'oauth_state', 'paper_trades', 'rest_usage', 'run_symbols', 'runs', 'schema_migrations', 'trades', 'watchlist_symbols', 'watchlists'];

test('a fresh database migrates cleanly and a rerun is a no-op', { skip: noDb }, async () => {
  const { pool, drop } = await createTestDb({ migrated: false });
  try {
    const first = await migrate(pool, { log: () => {} });
    assert.ok(first.includes('001_init.sql'));

    const { rows } = await pool.query(`select table_name from information_schema.tables where table_schema = 'public' order by 1`);
    assert.deepEqual(rows.map((r) => r.table_name), TABLES);

    assert.deepEqual(await migrate(pool, { log: () => {} }), []);
    const applied = await pool.query('select count(*)::int as n from schema_migrations');
    assert.equal(applied.rows[0].n, first.length);
  } finally {
    await drop();
  }
});
