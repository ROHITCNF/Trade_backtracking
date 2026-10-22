// The API skeleton, driven with app.inject() against a stub pool, so it needs
// no Postgres.

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../api/server');
const { loadConfig } = require('../api/config');
const { httpError } = require('../api/errors');
const { signSession } = require('../api/auth/session');

const AUTH_ENV = { APP_PASSWORD_HASH: 'unused', SESSION_SECRET: 'x'.repeat(32) };
const config = loadConfig({ DATABASE_URL: 'postgres://stub', FRONTEND_URL: 'https://app.example.com/', ...AUTH_ENV });
const authed = (opts) => ({ ...opts, headers: { authorization: `Bearer ${signSession(config.sessionSecret).token}`, ...opts.headers } });
const upPool = { query: async () => ({ rows: [{ '?column?': 1 }] }) };
const downPool = { query: async () => { throw new Error('connect ECONNREFUSED postgres://user:secret@db'); } };

test('health is ok when the database answers, 503 when it does not', async () => {
  const up = buildApp({ pool: upPool, config });
  const res = await up.inject('/api/health');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });

  const down = buildApp({ pool: downPool, config });
  const bad = await down.inject('/api/health');
  assert.equal(bad.statusCode, 503);
  assert.doesNotMatch(bad.body, /secret/);
});

test('CORS allows only the frontend origin', async () => {
  const app = buildApp({ pool: upPool, config });
  const ok = await app.inject({ url: '/api/health', headers: { origin: 'https://app.example.com' } });
  assert.equal(ok.headers['access-control-allow-origin'], 'https://app.example.com');
  const other = await app.inject({ url: '/api/health', headers: { origin: 'https://evil.example.com' } });
  assert.notEqual(other.headers['access-control-allow-origin'], 'https://evil.example.com');
});

test('errors never leak internals; HttpError and 4xx messages pass through', async () => {
  const app = buildApp({ pool: upPool, config });
  app.get('/boom', async () => { throw new Error('token=abc123 password=hunter2'); });
  app.get('/teapot', async () => { throw httpError(409, 'Run is already finished'); });
  app.post('/typed', { schema: { body: { type: 'object', required: ['name'] } } }, async () => ({}));

  const boom = await app.inject(authed({ url: '/boom' }));
  assert.equal(boom.statusCode, 500);
  assert.deepEqual(boom.json(), { error: 'Internal error' });

  const teapot = await app.inject(authed({ url: '/teapot' }));
  assert.equal(teapot.statusCode, 409);
  assert.deepEqual(teapot.json(), { error: 'Run is already finished' });

  const typed = await app.inject(authed({ method: 'POST', url: '/typed', payload: {} }));
  assert.equal(typed.statusCode, 400);
  assert.match(typed.json().error, /name/);

  const missing = await app.inject(authed({ url: '/api/nope' }));
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), { error: 'Not found' });
});

test('config: production needs FRONTEND_URL; dev defaults to Vite', () => {
  assert.throws(() => loadConfig({}), /DATABASE_URL/);
  assert.throws(() => loadConfig({ DATABASE_URL: 'x', NODE_ENV: 'production', ...AUTH_ENV }), /FRONTEND_URL/);
  assert.throws(() => loadConfig({ DATABASE_URL: 'x', APP_PASSWORD_HASH: 'h', SESSION_SECRET: 'short' }), /32 characters/);
  const dev = loadConfig({ DATABASE_URL: 'x', ...AUTH_ENV });
  assert.equal(dev.frontendUrl, 'http://localhost:5173');
  assert.equal(dev.host, '127.0.0.1');
  assert.equal(config.frontendUrl, 'https://app.example.com', 'trailing slash dropped');
});
