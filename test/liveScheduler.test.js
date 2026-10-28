const test = require('node:test');
const assert = require('node:assert/strict');
const { createLiveScheduler } = require('../api/live');
const { loadConfig } = require('../api/config');
const { dateToEpoch, toMinutes } = require('../src/time');
const { config } = require('./helpers');

// 2026-01-05 is a Monday; 2026-01-10 a Saturday. Times are IST.
const clockAt = (date, hhmm) => (dateToEpoch(date) + toMinutes(hhmm) * 60) * 1000;

// A scheduler with a settable clock and fake sessions that record their lifecycle.
function harness({ token = true, symbols = ['NSE:A-EQ', 'NSE:B-EQ'], failStart = false, reconciled = [], failReconcile = false } = {}) {
  const h = { now: clockAt('2026-01-05', '09:00'), token, sessions: [], logs: [], reconciles: [] };
  h.scheduler = createLiveScheduler({
    pool: null,
    enabled: true,
    watchlist: 'core',
    config: config({ sessionEnd: '15:14' }),
    store: {},
    hasToken: async () => h.token,
    symbolsFor: async () => symbols,
    now: () => h.now,
    log: (msg) => h.logs.push(msg),
    isReconciled: async (date) => reconciled.includes(date),
    reconcile: async ({ date, symbols: syms }) => {
      h.reconciles.push({ date, symbols: syms });
      if (failReconcile) throw new Error('REST budget spent');
    },
    createSession: ({ symbols: syms, date }) => {
      const s = { date, symbols: syms, started: false, stopped: 0, refreshed: 0 };
      h.sessions.push(s);
      return {
        start: async () => { if (failStart) throw new Error('boom'); s.started = true; },
        stop: async () => { s.stopped++; },
        refresh: async () => { s.refreshed++; },
        status: () => ({ date, running: s.started && !s.stopped }),
      };
    },
  });
  h.at = async (date, hhmm) => { h.now = clockAt(date, hhmm); await h.scheduler.tick(); };
  return h;
}

test('starts at 09:10 on a weekday and stops after sessionEnd with an EOD refresh', async () => {
  const h = harness();
  await h.at('2026-01-05', '09:09');
  assert.equal(h.sessions.length, 0);

  await h.at('2026-01-05', '09:10');
  assert.equal(h.sessions.length, 1);
  assert.equal(h.sessions[0].date, '2026-01-05');
  assert.deepEqual(h.sessions[0].symbols, ['NSE:A-EQ', 'NSE:B-EQ']);
  assert.equal(h.scheduler.status().session.running, true);

  await h.at('2026-01-05', '12:00');
  await h.at('2026-01-05', '15:18'); // inside the 5-minute grace
  assert.equal(h.sessions.length, 1, 'no second session while one runs');
  assert.equal(h.sessions[0].stopped, 0);

  await h.at('2026-01-05', '15:19');
  assert.equal(h.sessions[0].refreshed, 1);
  assert.equal(h.sessions[0].stopped, 1);
  assert.equal(h.scheduler.status().session, null);

  await h.at('2026-01-05', '15:30');
  assert.equal(h.sessions.length, 1, 'does not restart after close');
});

test('does nothing on a weekend', async () => {
  const h = harness();
  await h.at('2026-01-10', '10:00');
  assert.equal(h.sessions.length, 0);
});

test('waits for the Fyers token, logging once, then starts late', async () => {
  const h = harness({ token: false });
  await h.at('2026-01-05', '09:10');
  await h.at('2026-01-05', '09:15');
  assert.equal(h.sessions.length, 0);
  assert.equal(h.logs.filter((m) => /no Fyers token/.test(m)).length, 1);

  h.token = true;
  await h.at('2026-01-05', '09:20');
  assert.equal(h.sessions.length, 1);
});

test('a boot mid-session starts straight away (restart resume)', async () => {
  const h = harness();
  await h.at('2026-01-05', '11:42');
  assert.equal(h.sessions.length, 1);
  assert.equal(h.sessions[0].started, true);
});

test('a failed start is cleaned up and retried on the next check', async () => {
  const h = harness({ failStart: true });
  await h.at('2026-01-05', '09:10');
  await h.at('2026-01-05', '09:11');
  assert.equal(h.sessions.length, 2);
  assert.ok(h.sessions.every((s) => s.stopped === 1));
  assert.equal(h.scheduler.status().lastError, 'boom');
  assert.equal(h.scheduler.status().session, null);
});

test('an empty watchlist does not start a session', async () => {
  const h = harness({ symbols: [] });
  await h.at('2026-01-05', '09:10');
  assert.equal(h.sessions.length, 0);
  assert.match(h.scheduler.status().lastError, /watchlist "core"/);
});

test('a session left over from yesterday is ended on the new day', async () => {
  const h = harness();
  await h.at('2026-01-05', '15:00');
  await h.at('2026-01-06', '09:12');
  assert.equal(h.sessions[0].stopped, 1);
  assert.equal(h.sessions.length, 2);
  assert.equal(h.sessions[1].date, '2026-01-06');
});

test('stop() ends a running session; disabled scheduler never starts one', async () => {
  const h = harness();
  await h.at('2026-01-05', '10:00');
  await h.scheduler.stop();
  assert.equal(h.sessions[0].stopped, 1);

  const off = createLiveScheduler({ pool: null, enabled: false, watchlist: 'core', store: {}, log: () => {} });
  off.start();
  assert.equal(off.status().enabled, false);
  assert.equal(off.status().session, null);
});

test('LIVE_ENABLED and LIVE_WATCHLIST are read from the environment', () => {
  const env = { DATABASE_URL: 'x', APP_PASSWORD_HASH: 'h', SESSION_SECRET: 's'.repeat(32) };
  assert.deepEqual(loadConfig(env).live, { enabled: false, watchlist: 'core' });
  assert.deepEqual(loadConfig({ ...env, LIVE_ENABLED: 'true', LIVE_WATCHLIST: 'final' }).live, { enabled: true, watchlist: 'final' });
});

test('reconciles once after the close, waiting for a token', async () => {
  const h = harness({ token: false });
  await h.at('2026-01-05', '15:18');
  assert.equal(h.reconciles.length, 0, 'not before sessionEnd + grace');
  await h.at('2026-01-05', '15:19');
  assert.equal(h.reconciles.length, 0, 'no token, no REST');
  h.token = true;
  await h.at('2026-01-05', '15:20');
  await h.at('2026-01-05', '15:30');
  assert.deepEqual(h.reconciles, [{ date: '2026-01-05', symbols: ['NSE:A-EQ', 'NSE:B-EQ'] }]);
  await h.at('2026-01-10', '16:00'); // Saturday
  assert.equal(h.reconciles.length, 1);
});

test('a day already reconciled (e.g. before a restart) is not redone', async () => {
  const h = harness({ reconciled: ['2026-01-05'] });
  await h.at('2026-01-05', '15:25');
  assert.equal(h.reconciles.length, 0);
});

test('a failed reconcile is reported and not retried all evening', async () => {
  const h = harness({ failReconcile: true });
  await h.at('2026-01-05', '15:25');
  await h.at('2026-01-05', '15:26');
  assert.equal(h.reconciles.length, 1);
  assert.match(h.scheduler.status().lastError, /reconcile failed: REST budget/);
});
