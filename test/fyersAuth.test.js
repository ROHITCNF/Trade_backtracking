// Fyers OAuth connect/callback and /api/me, with a stubbed Fyers client and a
// real database. Needs TEST_DATABASE_URL (see test/db.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fyers = require('../src/fyers');
const { buildApp } = require('../api/server');
const { loadConfig } = require('../api/config');
const { signSession } = require('../api/auth/session');
const { createPgStore } = require('../api/db/fyersStore');
const { createTestDb, noDb } = require('./db');

process.env.TOKEN_ENC_KEY = crypto.randomBytes(32).toString('base64');
process.env.FYERS_APP_ID = 'APP-100';
process.env.FYERS_SECRET_ID = 'shh';

const config = loadConfig({
  DATABASE_URL: 'postgres://unused',
  FRONTEND_URL: 'https://app.example.com',
  APP_PASSWORD_HASH: 'unused',
  SESSION_SECRET: 'x'.repeat(32),
});
const auth = { authorization: `Bearer ${signSession(config.sessionSecret).token}` };

// Fake SDK client: records exchanges; behaviour set per test.
function stubFyers({ exchange = { s: 'ok', access_token: 'tok-123' }, profile = { s: 'ok', data: { name: 'ROHIT S' } } } = {}) {
  const calls = { exchanges: [], tokens: [] };
  const newClient = () => ({
    generateAuthCode: ({ state }) => `https://api-t1.fyers.in/api/v3/generate-authcode?client_id=APP-100&state=${state}`,
    generate_access_token: async (req) => {
      calls.exchanges.push(req);
      if (exchange instanceof Error) throw exchange;
      return exchange;
    },
    setAccessToken: (t) => calls.tokens.push(t),
    get_profile: async () => {
      if (profile instanceof Error) throw profile;
      return profile;
    },
  });
  return { newClient, calls };
}

async function withApp(stubOpts, fn) {
  const db = await createTestDb();
  fyers.setStore(createPgStore(db.pool));
  const stub = stubFyers(stubOpts);
  const app = buildApp({ pool: db.pool, config, newFyersClient: stub.newClient });
  try {
    await fn({ app, pool: db.pool, calls: stub.calls });
  } finally {
    await app.close();
    await db.drop();
  }
}

const connect = async (app) => new URL((await app.inject({ url: '/api/fyers/connect', headers: auth })).json().url).searchParams.get('state');
const callback = (app, query) => app.inject({ url: `/auth/fyers/callback?${new URLSearchParams(query)}` });

test('connect needs a session and issues a one-time state', { skip: noDb }, () =>
  withApp({}, async ({ app, pool }) => {
    assert.equal((await app.inject('/api/fyers/connect')).statusCode, 401);
    const state = await connect(app);
    assert.ok(state.length >= 40);
    const { rows } = await pool.query('select state from oauth_state');
    assert.deepEqual(rows.map((r) => r.state), [state]);
  }));

test('callback with a valid state stores the token encrypted and the client name', { skip: noDb }, () =>
  withApp({}, async ({ app, pool, calls }) => {
    const state = await connect(app);
    const res = await callback(app, { auth_code: 'code-1', state });
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, 'https://app.example.com/?fyers=connected');
    assert.deepEqual(calls.exchanges, [{ client_id: 'APP-100', secret_key: 'shh', auth_code: 'code-1' }]);

    assert.equal(await fyers.readToken(), 'tok-123');
    const { rows } = await pool.query('select token_enc, client_name from fyers_token');
    assert.ok(!rows[0].token_enc.includes(Buffer.from('tok-123')));
    assert.equal(rows[0].client_name, 'ROHIT S');

    // The state is spent: replaying the redirect fails.
    const replay = await callback(app, { auth_code: 'code-1', state });
    assert.equal(replay.headers.location, 'https://app.example.com/?fyers=error');
    assert.equal(calls.exchanges.length, 1);
  }));

test('a missing, unknown or expired state is rejected before any exchange', { skip: noDb }, () =>
  withApp({}, async ({ app, pool, calls }) => {
    for (const query of [{ auth_code: 'c' }, { auth_code: 'c', state: 'made-up' }, { state: await connect(app) }]) {
      const res = await callback(app, query);
      assert.equal(res.headers.location, 'https://app.example.com/?fyers=error', JSON.stringify(query));
    }
    const old = await connect(app);
    await pool.query(`update oauth_state set created_at = now() - interval '11 minutes' where state = $1`, [old]);
    assert.equal((await callback(app, { auth_code: 'c', state: old })).headers.location, 'https://app.example.com/?fyers=error');
    assert.equal(calls.exchanges.length, 0);
    assert.equal(await fyers.readToken(), null);
  }));

test('a failed exchange saves nothing; a failed profile still connects', { skip: noDb }, async () => {
  await withApp({ exchange: { s: 'error', code: -16, message: 'invalid auth code' } }, async ({ app }) => {
    const res = await callback(app, { auth_code: 'bad', state: await connect(app) });
    assert.equal(res.headers.location, 'https://app.example.com/?fyers=error');
    assert.equal(await fyers.readToken(), null);
  });
  await withApp({ profile: new Error('profile down') }, async ({ app, pool }) => {
    const res = await callback(app, { auth_code: 'ok', state: await connect(app) });
    assert.equal(res.headers.location, 'https://app.example.com/?fyers=connected');
    assert.equal((await pool.query('select client_name from fyers_token')).rows[0].client_name, null);
  });
});

test('/api/me reports Fyers status, client name and today\'s budget', { skip: noDb }, () =>
  withApp({}, async ({ app }) => {
    assert.equal((await app.inject('/api/me')).statusCode, 401);
    let me = (await app.inject({ url: '/api/me', headers: auth })).json();
    assert.deepEqual(me.fyers, { connected: false, expiresAt: null, clientName: null });
    assert.equal(me.budget.used, 0);
    assert.equal(me.budget.paused, false);

    await callback(app, { auth_code: 'c', state: await connect(app) });
    await fyers.rest(async () => ({ s: 'error', code: 429 }));
    me = (await app.inject({ url: '/api/me', headers: auth })).json();
    assert.equal(me.fyers.connected, true);
    assert.equal(me.fyers.clientName, 'ROHIT S');
    assert.ok(me.fyers.expiresAt > Date.now());
    assert.deepEqual({ used: me.budget.used, cap: me.budget.cap, paused: me.budget.paused }, { used: 1, cap: 4800, paused: true });
    assert.ok(me.session.expiresAt > Date.now());
  }));
