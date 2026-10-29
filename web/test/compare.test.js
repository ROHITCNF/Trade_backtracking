import test from 'node:test';
import assert from 'node:assert/strict';
import { bestIndex, settingRows, tickerRows } from '../src/lib/compare.js';

const run = (config, extra = {}) => ({
  fromDate: '2025-10-23', toDate: '2026-10-21', total: 39, watchlistName: 'core',
  config: { direction: 'both', orbStart: '09:15', orbEnd: '09:30', sessionEnd: '15:14', slMode: 'tighter', slPct: 1, targetMode: 'R', targetR: 1.5, targetPct: 1, sizing: 'entryPrice', capitalPerTrade: 10000, leverage: 5, quantity: 1, costBps: 5, ...config },
  ...extra,
});

test('settings diff marks identical rows', () => {
  const rows = settingRows([run({}), run({ targetMode: 'pct' }), run({ direction: 'long', slMode: 'range' }, { watchlistName: 'final', total: 17 })]);
  const by = Object.fromEntries(rows.map((r) => [r.label, r]));
  assert.deepEqual(by.Target.values, ['1.5R', '1%', '1.5R']);
  assert.equal(by.Target.same, false);
  assert.deepEqual(by.Stop.values, ['Tighter 1%', 'Tighter 1%', 'Range']);
  assert.equal(by.Symbols.values[2], 'final – 17');
  assert.equal(by['Session end'].same, true);
});

test('BEST needs a single winner', () => {
  assert.equal(bestIndex([1, 3, 2], 'max'), 1);
  assert.equal(bestIndex([-2431, -3375, -1348], 'max'), 2); // least drawdown
  assert.equal(bestIndex([1, 3, 3], 'max'), -1);
  assert.equal(bestIndex([1.7, Infinity], 'max'), 1);
  assert.equal(bestIndex([5], 'max'), -1);
  assert.equal(bestIndex([1, 2], null), -1);
});

test('rule labels and per-ticker spread', () => {
  const rows = tickerRows([
    { bySymbol: { A: { pnl: 100, trades: 2 }, B: { pnl: 50, trades: 1 } } },
    { bySymbol: { A: { pnl: -20, trades: 2 }, C: { pnl: 5, trades: 1 } } },
  ]);
  assert.deepEqual(rows.map((r) => [r.symbol, r.spread]), [['A', 120], ['B', null], ['C', null]]);
  assert.equal(rows[1].cells[1], null);
});
