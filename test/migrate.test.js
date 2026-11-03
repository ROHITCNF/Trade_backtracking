const test = require('node:test');
const assert = require('node:assert/strict');
const { migrate } = require('../api/db/migrate');
const { createTestDb, noDb } = require('./db');

const TABLES = ['fyers_token', 'live_decisions', 'live_state', 'oauth_state', 'paper_reconciliations', 'paper_trades', 'rest_usage', 'run_symbols', 'runs', 'schema_migrations', 'trades', 'watchlist_symbols', 'watchlists'];

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

test('006 keeps existing paper trades as the fixed flow', { skip: noDb }, async () => {
  const fs = require('fs');
  const path = require('path');
  const { pool, drop } = await createTestDb({ migrated: false });
  try {
    const dir = path.join(__dirname, '../api/db/migrations');
    await pool.query('create table schema_migrations (name text primary key, applied_at timestamptz not null default now())');
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.sql') && n < '006').sort()) {
      await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await pool.query('insert into schema_migrations (name) values ($1)', [f]);
    }
    await pool.query(`insert into paper_trades (date, symbol, status, side, quantity, entry_time, entry, sl, target)
      values ('2026-01-05', 'NSE:A-EQ', 'open', 'long', 5, '09:31', 102, 100.98, 103.02)`);

    assert.deepEqual(await migrate(pool, { log: () => {} }), ['006_paper_flow.sql']);
    const { rows } = await pool.query('select symbol, flow, best from paper_trades');
    assert.deepEqual(rows, [{ symbol: 'NSE:A-EQ', flow: 'fixed', best: null }]);
    await pool.query(`insert into paper_trades (date, symbol, flow, status, side, quantity, entry_time, entry, sl)
      values ('2026-01-05', 'NSE:A-EQ', 'trail', 'open', 'long', 5, '09:31', 102, 100.98)`);
    await assert.rejects(pool.query(`insert into paper_trades (date, symbol, flow, status, side, quantity, entry_time, entry, sl)
      values ('2026-01-05', 'NSE:A-EQ', 'other', 'open', 'long', 5, '09:31', 102, 100.98)`), /check/);
  } finally {
    await drop();
  }
});
