import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRows, checkText, excursions, held, mismatchKind, reviewCounts, rOf, sortRows, tabRows, tradeStory } from '../src/lib/liveView.js';

const D = '2026-10-30';
const trade = (symbol, over = {}) => ({
  date: D, symbol, status: 'closed', side: 'long', quantity: 10, entryTime: '09:40', entry: 100, sl: 99, target: 101.5,
  exitTime: '10:10', exit: 101.5, reason: 'TARGET', pnl: 15, source: 'live', ...over,
});

test('R is P&L over the money at risk', () => {
  assert.equal(rOf(trade('A')), 1.5);
  assert.equal(rOf(trade('A', { pnl: null })), null);
  assert.equal(rOf(trade('A', { sl: 100 })), null);
});

test('mismatch kinds and tags', () => {
  assert.deepEqual(mismatchKind({ problem: 'backtest traded, live did not' }), { kind: 'missed', tag: 'missed by live' });
  assert.deepEqual(mismatchKind({ problem: 'entry price differs' }), { kind: 'differs', tag: 'entry differs' });
  assert.deepEqual(mismatchKind({ problem: 'exit reason differs' }), { kind: 'differs', tag: 'exit differs' });
  assert.deepEqual(mismatchKind({ problem: 'candles failed: x' }), { kind: 'differs', tag: 'check failed' });
});

test('rows: traded, missed from the check, and the rest of the list on one day', () => {
  const recon = [{ date: D, mismatches: [
    { symbol: 'NSE:A-EQ', problem: 'entry price differs', live: { entry: 100 }, backtest: { entry: 99.9 } },
    { symbol: 'NSE:M-EQ', problem: 'backtest traded, live did not', live: null, backtest: { side: 'short', entry: 50, exit: 49, reason: 'EOD', entryTime: '09:50' } },
  ] }];
  const rows = buildRows({
    trades: [trade('NSE:A-EQ'), trade('NSE:B-EQ', { pnl: -10, entryTime: '09:31', reason: 'SL' })],
    reconciliations: recon, symbols: ['NSE:A-EQ', 'NSE:B-EQ', 'NSE:M-EQ', 'NSE:N-EQ', 'NSE:X-EQ'], missing: ['NSE:X-EQ'], oneDay: true, date: D,
  });
  assert.deepEqual(rows.map((r) => [r.symbol, r.kind, r.tag ?? r.note ?? null]), [
    ['NSE:A-EQ', 'traded', 'entry differs'],
    ['NSE:B-EQ', 'traded', null],
    ['NSE:M-EQ', 'missed', 'missed by live'],
    ['NSE:N-EQ', 'none', 'No breakout · backtest agrees'],
    ['NSE:X-EQ', 'none', 'Not traded live'],
  ]);
  assert.equal(tabRows(rows, 'traded').length, 2);
  assert.equal(tabRows(rows, 'review').length, 2);
  assert.deepEqual(reviewCounts(rows), { review: 2, missed: 1, differ: 1, tick: 0 });
  assert.deepEqual(sortRows(rows, 'time').map((r) => r.symbol), ['NSE:B-EQ', 'NSE:A-EQ', 'NSE:M-EQ', 'NSE:N-EQ', 'NSE:X-EQ']);
  assert.deepEqual(sortRows(rows, 'pnl').map((r) => r.symbol).slice(0, 3), ['NSE:A-EQ', 'NSE:B-EQ', 'NSE:M-EQ']);

  const multi = buildRows({ trades: [trade('NSE:A-EQ')], reconciliations: [], symbols: ['NSE:A-EQ', 'NSE:N-EQ'], oneDay: false, date: D });
  assert.equal(multi.length, 1, 'no untraded rows over a range');
  const unchecked = buildRows({ trades: [], reconciliations: [], symbols: ['NSE:N-EQ'], oneDay: true, date: D });
  assert.equal(unchecked[0].note, 'No breakout');
});

test('held time', () => {
  assert.equal(held('09:55', '15:14'), '5 h 19 m');
  assert.equal(held('09:31', '10:12'), '41 m');
  assert.equal(held('09:31', null), '—');
});

// Candles every minute from 09:15; epoch seconds with IST at +19800.
const base = Date.UTC(2026, 9, 30, 9, 15) / 1000 - 19800;
const bar = (min, o, h, l, c) => [base + min * 60, o, h, l, c];

test('excursions and the story of a short', () => {
  const candles = [bar(0, 1680, 1687, 1675, 1680), bar(14, 1660, 1661, 1658.2, 1659), bar(40, 1659, 1662.35, 1655, 1656), bar(60, 1650, 1651, 1636.42, 1640), bar(80, 1640, 1641, 1638, 1638.4)];
  const t = {
    side: 'short', quantity: 30, entryTime: '09:55', entry: 1658.2, sl: 1674.78, target: 1633.33, exitTime: '10:35', exit: 1638.4, reason: 'EOD', pnl: 594, status: 'closed',
    orbHigh: 1687.22, orbLow: 1658.2, entryTs: base + 40 * 60, exitTs: base + 80 * 60,
  };
  const ex = excursions(t, candles);
  assert.equal(ex.best.price, 1636.42);
  assert.equal(ex.worst.price, 1662.35);
  const { events } = tradeStory(t, candles, '09:30');
  assert.equal(events[0].text, 'Opening range set by 09:30: 1,658.20 – 1,687.22 (1.75% wide).');
  assert.equal(events[1].text, 'Broke below the range at 1,658.20 → Short 30 · SL 1,674.78 · target 1,633.33.');
  assert.match(events[2].text, /^Best move 1,636\.42 \(\+1\.31R\) — 3\.09 short of target\. Worst 1,662\.35 at 09:55 \(−0\.25R\)\.$/);
  assert.equal(events[3].text, 'Closed at session end, 1,638.40 → +₹594 (+1.19R).');
});

test('backtest check text', () => {
  assert.equal(
    checkText({ problem: 'entry price differs', live: { entry: 1658.2 }, backtest: { entry: 1657.9 } }),
    'Backtest check: entry price differs — backtest entered at 1,657.90, live entered at 1,658.20. Shown as the dashed circle.'
  );
  assert.match(checkText({ problem: 'backtest traded, live did not', backtest: { side: 'short', entry: 50, exit: 49, reason: 'EOD', entryTime: '09:50' } }), /^Live didn’t trade this\. The backtest went short at 50\.00 \(09:50\)/);
});

test('tick-order notes are expected: tagged, counted apart, never under Review', async () => {
  const { tickText } = await import('../src/lib/liveView.js');
  const note = { symbol: 'NSE:A-EQ', kind: 'tick', problem: 'one candle touched both stop and target; the backtest assumes the stop, live saw which came first', slippage: 25, backtest: { reason: 'SL', pnl: -10 } };
  const rows = buildRows({ trades: [trade('NSE:A-EQ')], reconciliations: [{ date: D, mismatches: [], notes: [note] }], symbols: null, oneDay: true, date: D });
  assert.equal(rows[0].check.kind, 'tick');
  assert.equal(tabRows(rows, 'review').length, 0);
  assert.deepEqual(reviewCounts(rows), { review: 0, missed: 0, differ: 0, tick: 1 });
  assert.equal(tickText(note), 'Tick order (expected): one candle touched both stop and target; the backtest assumes the stop, live saw which came first. The backtest exited on Stop for −₹10.');
});
