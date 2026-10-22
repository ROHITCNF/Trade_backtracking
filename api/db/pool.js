// One pg pool per process, built on first use from DATABASE_URL. Neon's pooled
// connection string carries sslmode=require, which pg honours as-is.

const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('Missing DATABASE_URL. Fill it in .env (see .env.example).');
    pool = new Pool({ connectionString });
  }
  return pool;
}

async function closePool() {
  if (pool) await pool.end();
  pool = null;
}

// Runs fn(client) inside begin/commit, rolling back if it throws.
async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { getPool, closePool, withTransaction };
