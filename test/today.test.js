// `npm run today`: the decision log as one row per paper trade (D25: per flow).

const test = require('node:test');
const assert = require('node:assert/strict');
const { tradeRows } = require('../server/today');

const ev = (kind, extra) => ({ symbol: 'NSE:RVNL-EQ', side: 'long', quantity: 10, ...extra, kind });

test('a single-flow log pairs entry and exit as before', () => {
  const rows = tradeRows([
    ev('ENTRY', { price: 100, sl: 99, target: 101.5, time: '09:31' }),
    ev('EXIT', { price: 101.5, reason: 'TARGET', pnl: 15, time: '10:00' }),
  ]);
  assert.deepEqual(rows.map((r) => [r.flow, r.symbol, r.sl, r.why, r.pnl]), [['fixed', 'RVNL', 99, 'TARGET', 15]]);
});

test('two flows give two rows; TRAIL moves the stop, never counts as an exit', () => {
  const open = tradeRows([
    ev('ENTRY', { flow: 'fixed', price: 100, sl: 99, target: 101.5, time: '09:31' }),
    ev('ENTRY', { flow: 'trail', price: 100, sl: 99, target: null, best: 100, time: '09:31' }),
    ev('TRAIL', { flow: 'trail', sl: 99.5, best: 100.5, time: '09:40' }),
  ]);
  assert.deepEqual(open.map((r) => [r.flow, r.sl, r.why, r.pnl]), [['fixed', 99, 'OPEN', null], ['trail', 99.5, 'OPEN', null]]);

  const closed = tradeRows([
    ev('ENTRY', { flow: 'fixed', price: 100, sl: 99, target: 101.5, time: '09:31' }),
    ev('ENTRY', { flow: 'trail', price: 100, sl: 99, target: null, best: 100, time: '09:31' }),
    ev('EXIT', { flow: 'fixed', price: 101.5, reason: 'TARGET', pnl: 15, time: '10:00' }),
    ev('TRAIL', { flow: 'trail', sl: 101, best: 102, time: '10:20' }),
    ev('EXIT', { flow: 'trail', price: 101, reason: 'SL', pnl: 10, time: '11:00' }),
  ]);
  assert.deepEqual(closed.map((r) => [r.flow, r.sl, r.why, r.pnl]), [['fixed', 99, 'TARGET', 15], ['trail', 101, 'SL', 10]]);
});
