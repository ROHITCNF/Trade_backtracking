// Applies api/db/migrations/*.sql in name order, each once, each in its own
// transaction. Runs on API boot and via `npm run migrate`. An advisory lock
// keeps two processes booting at once from applying the same file twice.

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'migrations');
const LOCK_ID = 7210418; // any constant; only this runner takes it

async function migrate(pool, { log = console.log } = {}) {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`create table if not exists schema_migrations (
      name       text primary key,
      applied_at timestamptz not null default now()
    )`);
    const { rows } = await client.query('select name from schema_migrations');
    const applied = new Set(rows.map((r) => r.name));

    const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
    const pending = files.filter((f) => !applied.has(f));
    for (const name of pending) {
      await client.query('begin');
      try {
        await client.query(fs.readFileSync(path.join(DIR, name), 'utf8'));
        await client.query('insert into schema_migrations (name) values ($1)', [name]);
        await client.query('commit');
      } catch (err) {
        await client.query('rollback');
        throw new Error(`Migration ${name} failed: ${err.message}`);
      }
      log(`migrated ${name}`);
    }
    return pending;
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}

module.exports = { migrate };

if (require.main === module) {
  require('../../src/env').loadEnv();
  const { getPool, closePool } = require('./pool');
  migrate(getPool())
    .then((done) => console.log(done.length ? `${done.length} migration(s) applied` : 'Database up to date'))
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    })
    .finally(closePool);
}
