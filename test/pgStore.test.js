// The Postgres store behind src/fyers.js. Needs TEST_DATABASE_URL (see test/db.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { Pool } = require('pg');
const fyers = require('../src/fyers');
const { createPgStore } = require('../api/db/fyersStore');
const { encrypt, decrypt } = require('../api/auth/tokenCrypto');
const { createTestDb, noDb } = require('./db');

process.env.TOKEN_ENC_KEY = crypto.randomBytes(32).toString('base64');

// Runs fn with a fresh migrated database installed as fyers' store.
async function withStore(fn) {
  const db = await createTestDb();
  const store = createPgStore(db.pool);
  fyers.setStore(store);
  try {
    await fn(store, db);
  } finally {
    await db.drop();
  }
}

test('token encryption round-trips and detects tampering', () => {
  const blob = encrypt('secret-token');
  assert.ok(!blob.includes(Buffer.from('secret-token')), 'ciphertext hides the token');
  assert.equal(decrypt(blob), 'secret-token');
  blob[blob.length - 1] ^= 1;
  assert.throws(() => decrypt(blob));
  assert.throws(() => decrypt(encrypt('x'), crypto.randomBytes(32)), 'wrong key fails');
});

test('the token is stored encrypted and expires at expires_at', { skip: noDb }, () =>
  withStore(async (store, { pool }) => {
    assert.equal(await fyers.readToken(), null);
    await fyers.saveToken('live-token');
    assert.equal(await fyers.readToken(), 'live-token');
    assert.equal((await fyers.tokenStatus()).connected, true);

    const { rows } = await pool.query('select token_enc from fyers_token');
    assert.ok(!rows[0].token_enc.includes(Buffer.from('live-token')));

    await store.saveToken({ access_token: 'dead', expiresAt: Date.now() - 1 });
    assert.equal(await fyers.readToken(), null);
    assert.equal((await pool.query('select count(*)::int as n from fyers_token')).rows[0].n, 1, 'one row');
  }));

test('rest() spaces calls and enforces the daily cap', { skip: noDb }, () =>
  withStore(async () => {
    process.env.REST_DAILY_CAP = '2';
    try {
      const t0 = Date.now();
      await fyers.rest(async () => ({ s: 'ok' }));
      await fyers.rest(async () => ({ s: 'ok' }));
      assert.ok(Date.now() - t0 >= fyers.MIN_GAP_MS - 20, 'second call waited for its slot');
      assert.equal((await fyers.usageToday()).count, 2);
      await assert.rejects(fyers.rest(async () => ({ s: 'ok' })), /daily REST budget used/);
      assert.equal((await fyers.usageToday()).count, 2, 'a refused call is not counted');
    } finally {
      delete process.env.REST_DAILY_CAP;
    }
  }));

test('a 429 pauses every later call for the day', { skip: noDb }, () =>
  withStore(async () => {
    await fyers.rest(async () => ({ s: 'error', code: 429 }));
    assert.equal((await fyers.usageToday()).limited, true);
    await assert.rejects(fyers.rest(async () => ({ s: 'ok' })), /429 earlier today/);
  }));

test('two processes sharing the database share one clock and count', { skip: noDb }, () =>
  withStore(async (store, { pool }) => {
    // A second store on its own pool stands in for another process.
    const otherPool = new Pool({ connectionString: pool.options.connectionString });
    const other = createPgStore(otherPool);
    const claim = (s) =>
      s.updateUsage((raw) => {
        const u = raw || { date: '', count: 0, next: 0, limited: false };
        const slot = Math.max(Date.now(), u.next);
        return { usage: { ...u, count: u.count + 1, next: slot + fyers.MIN_GAP_MS }, result: slot };
      });
    try {
      const slots = await Promise.all([claim(store), claim(other), claim(store), claim(other)]);
      slots.sort((a, b) => a - b);
      for (let i = 1; i < slots.length; i++) assert.ok(slots[i] - slots[i - 1] >= fyers.MIN_GAP_MS);
      assert.equal((await store.readUsage()).count, 4);
    } finally {
      await otherPool.end();
    }
  }));
