import test from 'node:test';
import assert from 'node:assert/strict';
import { inLiveWindow, liveNotice, sessionHeader, nextSession, dailyRows } from '../src/lib/live.js';

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

test('session header follows the scheduler and the clock', () => {
  assert.equal(sessionHeader(status({ enabled: false }), MON_OPEN).pill, 'Off');
  const live = sessionHeader(status({ session: { running: true, symbols: 95, open: 2, closed: 1 } }), MON_OPEN);
  assert.equal(live.pill, 'Live');
  assert.match(live.line, /^Watching 95 symbols of “core” · 2 open · 1 closed today/);
  assert.equal(sessionHeader(status(), MON_OPEN).pill, 'Starting');
  assert.equal(sessionHeader(status({ tokenConnected: false }), MON_OPEN).pill, 'Waiting');
  const idle = sessionHeader(status(), SAT);
  assert.equal(idle.pill, 'Idle');
  assert.equal(idle.line, 'Next session Mon 26 Oct, 09:10 IST · paper trading, no real orders');
});

test('next session: today before 09:10 on a weekday, else the next weekday', () => {
  assert.equal(nextSession(MON_EARLY), 'Mon 26 Oct, 09:10 IST');
  assert.equal(nextSession(MON_OPEN), 'Tue 27 Oct, 09:10 IST');
  assert.equal(nextSession(ist('2026-10-30T16:00:00')), 'Mon 2 Nov, 09:10 IST');
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


test('range buttons end on the chosen date; custom takes From and To', async () => {
  const { liveRange } = await import('../src/lib/live.js');
  const ctx = { date: '2026-11-02', custom: { from: '2026-10-01', to: '2026-10-05' } };
  assert.deepEqual(liveRange('day', ctx), { from: '2026-11-02', to: '2026-11-02' });
  assert.deepEqual(liveRange('15d', ctx), { from: '2026-10-19', to: '2026-11-02' });
  assert.deepEqual(liveRange('1m', ctx), { from: '2026-10-03', to: '2026-11-02' });
  assert.deepEqual(liveRange('1y', ctx), { from: '2025-11-03', to: '2026-11-02' });
  assert.deepEqual(liveRange('custom', ctx), { from: '2026-10-01', to: '2026-10-05' });
});

test('the page opens on final, else the first list', async () => {
  const { defaultWatchlist } = await import('../src/lib/live.js');
  assert.equal(defaultWatchlist([{ id: 1, name: 'core' }, { id: 2, name: 'final' }]), 2);
  assert.equal(defaultWatchlist([{ id: 1, name: 'core' }]), 1);
  assert.equal(defaultWatchlist([]), null);
});
