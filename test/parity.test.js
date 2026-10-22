// Parity gate (NFR-1): trades that go through the worker into Postgres and back
// must equal runBacktest's output field for field, for every stop and target
// rule. Needs TEST_DATABASE_URL (see test/db.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorker } = require('../api/worker');
const { createRun } = require('../api/db/runs');
const { loadTrades } = require('../api/db/trades');
const { runBacktest } = require('../src/engine');
const { config, walk } = require('./helpers');
const { createTestDb, noDb } = require('./db');

const CANDLES = {
  'NSE:LOW-EQ': walk(7, 87.35, 30),
  'NSE:MID-EQ': walk(42, 1234.55, 30),
  'NSE:HIGH-EQ': walk(1001, 24310.1, 30),
};

const TARGETS = [
  { targetMode: 'none' },
  { targetMode: 'R', targetR: 0.5 },
  { targetMode: 'R', targetR: 1 },
  { targetMode: 'R', targetR: 2 },
  { targetMode: 'pct', targetPct: 1 },
  { targetMode: 'pct', targetPct: 2.5 },
];
const SIZING = [
  { sizing: 'entryPrice', capitalPerTrade: 10000, leverage: 5, costBps: 7, direction: 'both' },
  { sizing: 'fixed', quantity: 3, costBps: 0, direction: 'long' },
  { sizing: 'fixed', quantity: 1, costBps: 3, direction: 'short' },
];
const COMBOS = [];
for (const slMode of ['pct', 'range', 'tighter', 'wider'])
  for (const target of TARGETS)
    for (const sizing of SIZING) COMBOS.push(config({ slMode, slPct: 0.8, ...target, ...sizing }));

test('trades stored in Postgres equal runBacktest output for every rule', { skip: noDb }, async () => {
  const { pool, drop } = await createTestDb();
  try {
    const symbols = Object.keys(CANDLES);
    const ids = [];
    for (const c of COMBOS) ids.push(await createRun(pool, { config: c, fromDate: '2026-01-05', toDate: '2026-02-13', symbols }));
    await createWorker({ pool, getCandles: async ({ symbol }, { onCall }) => (onCall(), CANDLES[symbol]), log: () => {} }).wake();

    const seen = { reasons: new Set(), sides: new Set(), nullTarget: 0, trades: 0 };
    for (const [i, id] of ids.entries()) {
      for (const symbol of symbols) {
        const expected = runBacktest(CANDLES[symbol], { ...COMBOS[i], symbol }).map(({ candles, ...t }) => t);
        const stored = (await loadTrades(pool, id, { symbol })).map(({ id: _id, symbol: s, ...t }) => t);
        assert.deepStrictEqual(stored, expected, `run ${id} ${JSON.stringify(COMBOS[i])} ${symbol}`);
        for (const t of expected) {
          seen.reasons.add(t.reason);
          seen.sides.add(t.side);
          if (t.target === null) seen.nullTarget++;
        }
        seen.trades += expected.length;
      }
    }
    // The fixture really exercised what parity has to survive.
    assert.deepEqual([...seen.reasons].sort(), ['EOD', 'SL', 'TARGET']);
    assert.deepEqual([...seen.sides].sort(), ['long', 'short']);
    assert.ok(seen.nullTarget > 0);
    assert.ok(seen.trades > 1000, `${seen.trades} trades compared`);
  } finally {
    await drop();
  }
});
