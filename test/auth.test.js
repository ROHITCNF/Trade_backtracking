// App login, session tokens and the login limiter. No Postgres needed.

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { buildApp } = require('../api/server');
const { loadConfig } = require('../api/config');
const { signSession, verifySession, SESSION_MS } = require('../api/auth/session');
const { createLoginLimiter, WINDOW_MS } = require('../api/auth/loginLimiter');

const SECRET = 's'.repeat(40);
const config = loadConfig({
  DATABASE_URL: 'postgres://stub',
  FRONTEND_URL: 'https://app.example.com',
  APP_PASSWORD_HASH: bcrypt.hashSync('correct horse battery', 4),
  SESSION_SECRET: SECRET,
});
const pool = { query: async () => ({ rows: [] }) };
const app = (opts = {}) => {
  const a = buildApp({ pool, config, ...opts });
  a.get('/api/secret', async (request) => ({ exp: request.session.exp }));
  return a;
};
const login = (a, password, ip = '1.1.1.1') => a.inject({ method: 'POST', url: '/api/login', payload: { password }, remoteAddress: ip });

test('right password gets a 7-day token that opens protected routes', async () => {
  const a = app();
  const res = await login(a, 'correct horse battery');
  assert.equal(res.statusCode, 200);
  const { token, expiresAt } = res.json();
  assert.ok(Math.abs(expiresAt - (Date.now() + SESSION_MS)) < 5000);

  const ok = await a.inject({ url: '/api/secret', headers: { authorization: `Bearer ${token}` } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().exp, expiresAt);
});

test('wrong password is a 401 with no detail', async () => {
  const res = await login(app(), 'wrong');
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.json(), { error: 'Wrong password' });
});

test('protected routes need a valid session; public ones do not', async () => {
  const a = app();
  assert.equal((await a.inject('/api/secret')).statusCode, 401);
  assert.equal((await a.inject({ url: '/api/secret', headers: { authorization: 'Bearer junk' } })).statusCode, 401);
  assert.equal((await a.inject('/api/health')).statusCode, 200);
  // Unknown routes are hidden behind the session too.
  assert.equal((await a.inject('/api/nope')).statusCode, 401);
  // A 401 still carries CORS headers, so the frontend can read it.
  const res = await a.inject({ url: '/api/secret', headers: { origin: 'https://app.example.com' } });
  assert.equal(res.headers['access-control-allow-origin'], 'https://app.example.com');
});

test('expired and tampered tokens are rejected', () => {
  const now = Date.now();
  const { token } = signSession(SECRET, now);
  assert.ok(verifySession(token, SECRET, now + SESSION_MS - 1));
  assert.equal(verifySession(token, SECRET, now + SESSION_MS), null, 'expired');
  assert.equal(verifySession(token, 'o'.repeat(40), now), null, 'other secret');

  const [payload, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ exp: now + 10 * SESSION_MS })).toString('base64url');
  assert.equal(verifySession(`${forged}.${sig}`, SECRET, now), null, 'payload swapped');
  const edited = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
  assert.equal(verifySession(`${payload}.${edited}`, SECRET, now), null, 'signature edited');
  assert.equal(verifySession(`${token}.x`, SECRET, now), null);
  assert.equal(verifySession(undefined, SECRET, now), null);
});

test('5 failures in 15 min lock that IP out, even with the right password', async () => {
  const a = app();
  for (let i = 0; i < 5; i++) assert.equal((await login(a, 'nope', '2.2.2.2')).statusCode, 401);
  const locked = await login(a, 'correct horse battery', '2.2.2.2');
  assert.equal(locked.statusCode, 429);
  assert.ok(Number(locked.headers['retry-after']) > 0);
  assert.equal((await login(a, 'correct horse battery', '3.3.3.3')).statusCode, 200, 'other IPs unaffected');
});

test('the lockout lifts once failures age out; success clears the count', () => {
  let t = 0;
  const limiter = createLoginLimiter({ now: () => t });
  for (let i = 0; i < 5; i++) limiter.fail('ip');
  assert.equal(limiter.retryAfter('ip'), WINDOW_MS);
  t = WINDOW_MS;
  assert.equal(limiter.retryAfter('ip'), 0);

  for (let i = 0; i < 4; i++) limiter.fail('ip2');
  limiter.succeed('ip2');
  limiter.fail('ip2');
  assert.equal(limiter.retryAfter('ip2'), 0);
});
