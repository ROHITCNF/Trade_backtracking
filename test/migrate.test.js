// Needs a Postgres to talk to, so it only runs when TEST_DATABASE_URL is set
// (e.g. postgres://localhost/postgres). It creates a throwaway database, never
// touching the one the URL names beyond that.

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { migrate } = require('../api/db/migrate');

const adminUrl = process.env.TEST_DATABASE_URL;
const TABLES = ['fyers_token', 'oauth_state', 'rest_usage', 'run_symbols', 'runs', 'schema_migrations', 'trades', 'watchlist_symbols', 'watchlists'];

test('a fresh database migrates cleanly and a rerun is a no-op', { skip: !adminUrl && 'TEST_DATABASE_URL not set' }, async () => {
  const name = `backtest_migrate_test_${process.pid}`;
  const admin = new Pool({ connectionString: adminUrl });
  await admin.query(`create database ${name}`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.toString() });
  try {
    const first = await migrate(pool, { log: () => {} });
    assert.ok(first.includes('001_init.sql'));

    const { rows } = await pool.query(`select table_name from information_schema.tables where table_schema = 'public' order by 1`);
    assert.deepEqual(rows.map((r) => r.table_name), TABLES);

    assert.deepEqual(await migrate(pool, { log: () => {} }), []);
    const applied = await pool.query('select count(*)::int as n from schema_migrations');
    assert.equal(applied.rows[0].n, first.length);
  } finally {
    await pool.end();
    await admin.query(`drop database ${name}`);
    await admin.end();
  }
});
