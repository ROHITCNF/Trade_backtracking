// Throwaway Postgres databases for tests. Only usable when TEST_DATABASE_URL
// points at a server (e.g. postgres://localhost/postgres); tests pass
// `{ skip: noDb }` so plain `npm test` needs no Postgres.

const { Pool } = require('pg');
const { migrate } = require('../api/db/migrate');

const adminUrl = process.env.TEST_DATABASE_URL;
const noDb = !adminUrl && 'TEST_DATABASE_URL not set';
let seq = 0;

// Creates a fresh database (migrated unless { migrated: false }) and returns a
// pool on it plus drop(), which closes the pool and removes the database.
async function createTestDb({ migrated = true } = {}) {
  const name = `backtest_test_${process.pid}_${seq++}`;
  const admin = new Pool({ connectionString: adminUrl });
  await admin.query(`create database ${name}`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.toString() });
  if (migrated) await migrate(pool, { log: () => {} });

  async function drop() {
    await pool.end();
    await admin.query(`drop database ${name}`);
    await admin.end();
  }
  return { pool, drop };
}

module.exports = { createTestDb, noDb };
