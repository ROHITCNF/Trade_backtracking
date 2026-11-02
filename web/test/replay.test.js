import test from 'node:test';
import assert from 'node:assert/strict';
import { indexAt, replayFrame } from '../src/lib/replay.js';

// 2026-10-30 09:15 IST in epoch seconds; one candle per minute from there.
const T0 = Date.UTC(2026, 9, 30, 9, 15) / 1000 - 19800;
const at = (min) => T0 + min * 60;
const bar = (min, o, h, l, c) => [at(min), o, h, l, c];

// 09:15–09:29 range 99–101, breakout long at 09:31 (101), target 103 at 09:34.
const candles = [
  ...Array.from({ length: 15 }, (_, k) => bar(k, 100, k === 3 ? 101 : 100.5, k === 7 ? 99 : 99.5, 100)),
  bar(15, 100, 100.8, 99.8, 100.5), // 09:30
  bar(16, 100.6, 101.4, 100.5, 101.2), // 09:31 entry
  bar(17, 101.2, 101.6, 100.9, 101.5),
  bar(18, 101.5, 102.5, 101.4, 102.4),
  bar(19, 102.4, 103.2, 102.2, 103), // 09:34 exit at target
  bar(20, 103, 103.5, 102.8, 103.1),
];
const trade = {
  side: 'long', quantity: 10, entry: 101, sl: 99, target: 103, exit: 103, pnl: 20, reason: 'TARGET',
  entryTs: at(16), exitTs: at(19),
};
const marks = [
  { time: at(16), price: 101, shape: 'ring' },
  { time: at(19), price: 103, shape: 'square' },
];
const frame = (cursor) => replayFrame({ candles, trade, orbEnd: '09:30', marks, cursor });

test('indexAt finds the candle containing a time', () => {
  assert.equal(indexAt(candles, at(16)), 16);
  assert.equal(indexAt(candles, at(16) + 30), 16);
  assert.equal(indexAt(candles, at(0) - 1), -1);
  assert.equal(indexAt(candles, null), -1);
});

test('the opening range grows from the candles shown, then stops at orbEnd', () => {
  const first = frame(0);
  assert.equal(first.phase, 'range');
  assert.deepEqual([first.orb.low, first.orb.high], [99.5, 100.5]);
  assert.equal(first.clock, '09:15');
  assert.deepEqual([frame(3).orb.low, frame(3).orb.high], [99.5, 101]);
  assert.deepEqual([frame(14).orb.low, frame(14).orb.high], [99, 101]);
  // 09:30's candle isn't part of the range, and the range is done.
  const after = frame(15);
  assert.equal(after.phase, 'waiting');
  assert.equal(after.orb.to, at(14));
  assert.deepEqual([after.orb.low, after.orb.high], [99, 101]);
});

test('levels and marks appear only once their candle is reached', () => {
  assert.equal(frame(15).levels, null);
  assert.deepEqual(frame(15).marks, []);
  assert.deepEqual(frame(16).levels, { entry: 101, sl: 99, target: 103 });
  assert.equal(frame(16).marks.length, 1);
  assert.equal(frame(18).marks.length, 1);
  assert.equal(frame(19).marks.length, 2);
});

test('open P&L and R follow the close while the trade is open', () => {
  const f = frame(18);
  assert.equal(f.phase, 'open');
  assert.equal(f.pnl, 14); // (102.4 − 101) × 10
  assert.ok(Math.abs(f.r - 0.7) < 1e-9);
  const short = replayFrame({ candles, trade: { ...trade, side: 'short', sl: 103 }, orbEnd: '09:30', cursor: 17 });
  assert.equal(short.pnl, -5); // (101 − 101.5) × 10
});

test('from the exit candle on, the frame shows the booked result', () => {
  for (const c of [19, 20]) {
    const f = frame(c);
    assert.equal(f.phase, 'closed');
    assert.equal(f.pnl, 20);
    assert.equal(f.r, 1);
  }
});

test('the cursor is clamped to the candles', () => {
  assert.equal(frame(-5).cursor, 0);
  assert.equal(frame(999).cursor, 20);
  assert.equal(frame(0).last, 20);
});
