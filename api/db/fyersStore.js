// Postgres side of the store seam in src/fyers.js (contract in src/fileStore.js).
// The token lives encrypted in fyers_token; REST usage lives in rest_usage, one
// row per IST day, updated under SELECT … FOR UPDATE so every process sharing
// the database shares one clock and one count (NFR-5).
//
// The API and worker install it at boot with setStore(createPgStore(getPool()));
// the CLI keeps its file store even when .env has a DATABASE_URL.

const { istToday } = require('../../src/time');
const { encrypt, decrypt } = require('../auth/tokenCrypto');

// rest_usage row <-> the raw usage record src/fyers.js works with.
const USAGE_COLUMNS = `date::text as date, count, next_slot_at, limited`;
const toUsage = (row) => row && { date: row.date, count: row.count, next: row.next_slot_at.getTime(), limited: row.limited };

function createPgStore(pool) {
  return {
    async readToken() {
      const { rows } = await pool.query('select token_enc, expires_at from fyers_token where id = 1');
      if (!rows.length) return null;
      return { access_token: decrypt(rows[0].token_enc), expiresAt: rows[0].expires_at.getTime() };
    },

    async saveToken({ access_token, expiresAt }) {
      await pool.query(
        `insert into fyers_token (id, token_enc, expires_at, updated_at) values (1, $1, $2, now())
         on conflict (id) do update set token_enc = excluded.token_enc, expires_at = excluded.expires_at,
           updated_at = now()`,
        [encrypt(access_token), new Date(expiresAt)]
      );
    },

    async readUsage() {
      const { rows } = await pool.query(`select ${USAGE_COLUMNS} from rest_usage where date = $1`, [istToday()]);
      return toUsage(rows[0]) || null;
    },

    async updateUsage(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const date = istToday();
        await client.query('insert into rest_usage (date) values ($1) on conflict do nothing', [date]);
        const { rows } = await client.query(`select ${USAGE_COLUMNS} from rest_usage where date = $1 for update`, [date]);
        const { usage, result } = await fn(toUsage(rows[0]));
        await client.query(
          `insert into rest_usage (date, count, next_slot_at, limited) values ($1, $2, $3, $4)
           on conflict (date) do update set count = excluded.count, next_slot_at = excluded.next_slot_at,
             limited = excluded.limited`,
          [usage.date, usage.count, new Date(usage.next), usage.limited]
        );
        await client.query('commit');
        return result;
      } catch (err) {
        await client.query('rollback').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

module.exports = { createPgStore };
