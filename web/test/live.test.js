import test from 'node:test';
import assert from 'node:assert/strict';
import { inLiveWindow, liveNotice, sessionLabel, dailyRows } from '../src/lib/live.js';

const ist = (s) => Date.parse(`${s}+05:30`);
const MON_OPEN = ist('2026-10-26T10:00:00'); // Monday
const MON_EARLY = ist('2026-10-26T08:30:00');
const SAT = ist('2026-10-24T10:00:00');

const status = (over = {}) => ({ enabled: true, watchlist: 'core', lastError: null, session: null, tokenConnected: true, ...over });

test('the live window is weekdays 09:10–15:30 IST', () => {
  assert.equal(inLiveWindow(ist('2026-10-26T09:09:00')), false);
  assert.equal(inLiveWindow(ist('2026-10-26T09:10:00')), true);
  assert.equal(inLiveWindow(ist('2026-10-26T15:29:00')), true);
  assert.equal(inLiveWindow(ist('2026-10-26T15:30:00')), false);
  assert.equal(inLiveWindow(SAT), false);
});

test('notice: off, then missing token in the window, then a failed start', () => {
  assert.equal(liveNotice(null), null);
  assert.equal(liveNotice(status({ enabled: false }), MON_OPEN).tone, 'info');

  const noToken = liveNotice(status({ tokenConnected: false }), MON_OPEN);
  assert.equal(noToken.action, 'connect');
  assert.match(noToken.title, /connect Fyers/);
  assert.equal(liveNotice(status({ tokenConnected: false }), MON_EARLY), null, 'no nagging before 09:10');
  assert.equal(liveNotice(status({ tokenConnected: false }), SAT), null);

  const failed = liveNotice(status({ lastError: 'watchlist "core" is empty or missing' }), MON_OPEN);
  assert.equal(failed.tone, 'error');
  assert.match(failed.body, /watchlist "core"/);

  const running = status({ session: { running: true, symbols: 39, open: 1, closed: 0 }, lastError: 'old' });
  assert.equal(liveNotice(running, MON_OPEN), null);
});

test('session label follows the scheduler and the clock', () => {
  assert.equal(sessionLabel(status({ enabled: false }), MON_OPEN), 'Off');
  assert.equal(sessionLabel(status({ session: { running: true, symbols: 39, open: 2, closed: 1 } }), MON_OPEN), 'Watching 39 symbols · 2 open · 1 closed today');
  assert.equal(sessionLabel(status(), MON_OPEN), 'Starting…');
  assert.equal(sessionLabel(status({ tokenConnected: false }), MON_OPEN), 'Waiting for Fyers');
  assert.match(sessionLabel(status(), SAT), /^Idle/);
});

test('daily rows sum closed trades per date, oldest first', () => {
  const rows = dailyRows([
    { date: '2026-10-27', status: 'closed', pnl: 10.005 },
    { date: '2026-10-26', status: 'closed', pnl: -5 },
    { date: '2026-10-27', status: 'closed', pnl: -2 },
    { date: '2026-10-27', status: 'open', pnl: null },
  ]);
  assert.deepEqual(rows, [
    { key: '2026-10-26', pnl: -5, trades: 1, winRate: 0 },
    { key: '2026-10-27', pnl: 8.01, trades: 2, winRate: 50 },
  ]);
  assert.deepEqual(dailyRows([]), []);
});
