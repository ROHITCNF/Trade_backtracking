import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyCurve, narrative, sideBars, tradingDays } from '../src/lib/summary.js';

const text = (parts) => parts.map((p) => p.text).join('');
const analysis = (over = {}) => ({
  metrics: { totalTrades: 4738, totalPnl: 75632, ...over.metrics },
  breakdowns: {
    side: [{ key: 'long', trades: 2410, pnl: 30505 }, { key: 'short', trades: 2328, pnl: 45127 }],
    reason: [{ key: 'TARGET', share: 25.1 }, { key: 'SL', share: 38.2 }, { key: 'EOD', share: 36.7 }],
    ...over.breakdowns,
  },
});

test('narrative reads like the design, bigger side first', () => {
  const parts = narrative(analysis());
  assert.equal(text(parts), 'Made ₹75,632 on 4,738 trades. Shorts +₹45,127, longs +₹30,505. 38% hit the stop, 25% the target.');
  assert.deepEqual(parts.filter((p) => p.tone).map((p) => p.tone), ['profit', 'profit', 'profit']);
});

test('narrative for a loss, one side, and no trades', () => {
  const one = analysis({ metrics: { totalTrades: 1, totalPnl: -496 }, breakdowns: { side: [{ key: 'long', trades: 1, pnl: -496 }, { key: 'short', trades: 0, pnl: 0 }] } });
  assert.equal(text(narrative(one)), 'Lost ₹496 on 1 trade. All longs. 38% hit the stop, 25% the target.');
  assert.equal(narrative(one)[1].tone, 'loss');
  assert.equal(text(narrative(analysis({ metrics: { totalTrades: 0, totalPnl: 0 } }))), 'No trades.');
});

test('daily curve keeps each day’s last point', () => {
  const curve = [{ date: '2026-10-01', equity: 10 }, { date: '2026-10-01', equity: -5 }, { date: '2026-10-02', equity: 30 }];
  assert.deepEqual(dailyCurve(curve), [{ date: '2026-10-01', equity: -5 }, { date: '2026-10-02', equity: 30 }]);
  assert.equal(tradingDays(curve), 2);
});

test('side bars scale to the larger side and point by sign', () => {
  assert.deepEqual(sideBars([{ key: 'long', pnl: 119 }, { key: 'short', pnl: 3012 }]).map((s) => [s.width, s.dir]), [[2, 'right'], [50, 'right']]);
  assert.deepEqual(sideBars([{ key: 'long', pnl: -200 }, { key: 'short', pnl: 100 }]).map((s) => [s.width, s.dir]), [[50, 'left'], [25, 'right']]);
  assert.deepEqual(sideBars([{ key: 'long', pnl: 0 }]).map((s) => s.width), [0]);
});
