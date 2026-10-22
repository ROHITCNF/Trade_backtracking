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

module.exports = { getPool, closePool };
