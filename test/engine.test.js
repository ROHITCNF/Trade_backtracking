const test = require('node:test');
const assert = require('node:assert/strict');
const { runBacktest } = require('../src/engine');
const { computeMetrics } = require('../src/metrics');
const { round } = require('../src/util');
const { candle, openingRange, config } = require('./helpers');

const D = '2026-01-05';
const day = (...after) => [...openingRange(D), ...after];

test('opening range is the high/low of 09:15–09:29', () => {
  const [t] = runBacktest(day(candle(D, '09:30', 100, 101.5, 100, 101)), config({ targetMode: 'none' }));
  assert.equal(t.orbHigh, 101);
  assert.equal(t.orbLow, 99);
});

test('long fills at the range high when the candle crosses it', () => {
  const [t] = runBacktest(day(candle(D, '09:31', 100.5, 101.2, 100.5, 101)), config({ targetMode: 'none' }));
  assert.equal(t.side, 'long');
  assert.equal(t.entry, 101);
  assert.equal(t.entryTime, '09:31');
});

test('gap through the level fills at the open, not the level', () => {
  const [t] = runBacktest(day(candle(D, '09:30', 103, 103.5, 102.8, 103.2)), config({ targetMode: 'none' }));
  assert.equal(t.entry, 103);
});

test('short side mirrors the long side', () => {
  const [t] = runBacktest(day(candle(D, '09:30', 99.5, 99.5, 98.5, 98.8)), config({ targetMode: 'none' }));
  assert.equal(t.side, 'short');
  assert.equal(t.entry, 99);
  assert.equal(t.sl, 99.99);
});

test('a bar breaking both edges is skipped; the next clean break is taken', () => {
  const trades = runBacktest(
    day(candle(D, '09:30', 100, 102, 98, 100), candle(D, '09:31', 100, 99.5, 98.7, 98.9)),
    config({ targetMode: 'none' })
  );
  assert.equal(trades.length, 1);
  assert.equal(trades[0].side, 'short');
  assert.equal(trades[0].entryTime, '09:31');
});

test('direction long ignores a downside break', () => {
  const trades = runBacktest(day(candle(D, '09:30', 99.5, 99.5, 98.5, 98.8)), config({ direction: 'long' }));
  assert.equal(trades.length, 0);
});

test('stop wins when one candle spans both stop and target', () => {
  // entry 101, 1% stop 99.99, 1R target 102.01; next candle touches both.
  const [t] = runBacktest(day(candle(D, '09:30', 100.5, 101.2, 100.5, 101), candle(D, '09:31', 101, 102.5, 99.5, 101)), config());
  assert.equal(t.reason, 'SL');
  assert.equal(t.exit, 99.99);
});

test('the entry candle itself is checked for exits', () => {
  const [t] = runBacktest(day(candle(D, '09:30', 100.5, 101.2, 99.8, 100)), config());
  assert.equal(t.reason, 'SL');
  assert.equal(t.exitTime, '09:30');
});

test('target exit books the target price', () => {
  const [t] = runBacktest(day(candle(D, '09:30', 100.5, 101.2, 100.5, 101), candle(D, '09:31', 101, 102.1, 100.8, 102)), config());
  assert.equal(t.reason, 'TARGET');
  assert.equal(t.exit, 102.01);
  assert.equal(t.rMultiple, 1);
});

test('open position closes at sessionEnd as EOD', () => {
  const [t] = runBacktest(
    day(candle(D, '09:30', 100.5, 101.2, 100.5, 101), candle(D, '15:14', 101.3, 101.4, 101.2, 101.3), candle(D, '15:20', 105, 105, 105, 105)),
    config({ targetMode: 'none' })
  );
  assert.equal(t.reason, 'EOD');
  assert.equal(t.exit, 101.3);
  assert.equal(t.exitTime, '15:14');
});

test('one trade per day, no re-entry after an exit', () => {
  const trades = runBacktest(
    day(candle(D, '09:30', 100.5, 101.2, 99.8, 100), candle(D, '09:40', 101, 103, 101, 102.5)),
    config()
  );
  assert.equal(trades.length, 1);
});

test('slMode picks between the % stop and the range edge', () => {
  // Long entry at 101. Range stop = 99 (risk 2), 1% stop = 99.99 (risk 1.01).
  const bar = candle(D, '09:30', 100.5, 101.2, 100.5, 101);
  const sl = (slMode) => runBacktest(day(bar), config({ slMode, targetMode: 'none' }))[0].sl;
  assert.equal(sl('pct'), 99.99);
  assert.equal(sl('range'), 99);
  assert.equal(sl('tighter'), 99.99);
  assert.equal(sl('wider'), 99);
});

test('with slMode pct, a 1R target equals a fixed 1% target', () => {
  const days = ['2026-01-05', '2026-01-06', '2026-01-07'].flatMap((d, i) => [
    ...openingRange(d),
    candle(d, '09:30', 100.5, 101.2, 100.5, 101),
    candle(d, '10:00', 101, [102.5, 101.5, 101][i], [100.5, 99.5, 100.5][i], 101),
  ]);
  const strip = (ts) => ts.map(({ candles, ...t }) => t);
  const r = runBacktest(days, config({ slMode: 'pct', targetMode: 'R', targetR: 1 }));
  const p = runBacktest(days, config({ slMode: 'pct', targetMode: 'pct', targetPct: 1 }));
  assert.equal(r.length, 3);
  assert.deepEqual(strip(r), strip(p));
});

test('entryPrice sizing: capital x leverage / entry, never zero', () => {
  const bar = candle(D, '09:30', 100.5, 101.2, 100.5, 101);
  const qty = (o) => runBacktest(day(bar), config({ sizing: 'entryPrice', capitalPerTrade: 10000, leverage: 5, targetMode: 'none', ...o }))[0].quantity;
  assert.equal(qty({}), Math.floor(50000 / 101));
  assert.equal(qty({ capitalPerTrade: 10 }), 1);
});

test('costs come off P&L', () => {
  const bar = candle(D, '09:30', 100.5, 101.2, 100.5, 101);
  const close = candle(D, '15:14', 102, 102, 102, 102);
  const [t] = runBacktest(day(bar, close), config({ targetMode: 'none', costBps: 10 }));
  assert.equal(t.pnl, round(1 - (101 + 102) * 0.001)); // engine rounds to 2 dp
});

test('metrics: profit factor is null when nothing lost', () => {
  const [t] = runBacktest(day(candle(D, '09:30', 100.5, 101.2, 100.5, 101), candle(D, '09:31', 101, 102.1, 100.8, 102)), config());
  const m = computeMetrics([t]);
  assert.equal(m.wins, 1);
  assert.equal(m.profitFactor, null);
  assert.equal(m.curve.length, 1);
});

test('round never returns -0', () => {
  assert.ok(Object.is(round(-0.001), 0));
  assert.equal(round(-1.234), -1.23);
});
