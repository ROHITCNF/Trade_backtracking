// Dashboard analysis: the pure numbers (no Postgres), then the routes against a
// real database (TEST_DATABASE_URL, see test/db.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { runBacktest } = require('../src/engine');
const { computeMetrics } = require('../src/metrics');
const { rowFor, totalsFrom } = require('../src/portfolio');
const { round } = require('../src/util');
const { analyse, filterTrades } = require('../api/analysis');
const { buildApp } = require('../api/server');
const { loadConfig } = require('../api/config');
const { signSession } = require('../api/auth/session');
const { createWorker } = require('../api/worker');
const { createRun, createSweep } = require('../api/db/runs');
const { loadTrades } = require('../api/db/trades');
const { TARGET_VARIANTS } = require('../src/targets');
const { config, walk } = require('./helpers');
const { createTestDb, noDb } = require('./db');

const CANDLES = {
  'NSE:AAA-EQ': walk(3, 412.3, 40),
  'NSE:BBB-EQ': walk(17, 1890.05, 40),
  'NSE:CCC-EQ': walk(29, 77.7, 40),
};
const CFG = config({ slMode: 'tighter', slPct: 0.8, targetMode: 'R', targetR: 1.5, sizing: 'entryPrice', capitalPerTrade: 10000, leverage: 5, costBps: 5 });

// What the worker would store: engine trades tagged with their symbol, in entry order.
const TRADES = Object.entries(CANDLES)
  .flatMap(([symbol, c]) => runBacktest(c, { ...CFG, symbol }).map(({ candles, ...t }) => ({ symbol, ...t })))
  .sort((a, b) => a.entryTs - b.entryTs || a.symbol.localeCompare(b.symbol));

const sum = (xs) => round(xs.reduce((a, b) => a + b, 0));

test('analysis numbers are computeMetrics / rowFor / totalsFrom on the filtered trades', () => {
  const filterSets = [{}, { side: 'long' }, { reasons: ['SL', 'EOD'] }, { from: '2026-01-20', to: '2026-02-10' }, { symbols: ['NSE:BBB-EQ'] }];
  for (const filters of filterSets) {
    const view = filterTrades(TRADES, filters);
    const a = analyse(TRADES, { config: CFG, filters });
    assert.ok(view.length > 0, JSON.stringify(filters));
    assert.deepEqual(a.metrics, computeMetrics(view), JSON.stringify(filters));
    assert.equal(a.count, view.length);
    assert.equal(a.extremes.best.pnl, a.metrics.bestTrade);
    assert.equal(a.extremes.worst.pnl, a.metrics.worstTrade);

    const groups = Object.groupBy(view, (t) => t.symbol);
    for (const row of a.symbols) {
      const { name, curve, ...rest } = row;
      assert.deepEqual(rest, rowFor(row.symbol, groups[row.symbol], computeMetrics(groups[row.symbol])));
      assert.equal(curve.at(-1), computeMetrics(groups[row.symbol]).totalPnl, 'sparkline ends at the symbol total');
    }
    const { symbolsTraded, symbols, ...portfolio } = a.portfolio;
    assert.deepEqual(portfolio, totalsFrom(view, a.symbols));

    // Every breakdown partitions the same trades.
    const b = a.breakdowns;
    for (const key of ['month', 'weekday', 'entryTime', 'reason', 'side']) {
      assert.equal(b[key].reduce((n, r) => n + r.trades, 0), view.length, key);
      assert.equal(sum(b[key].map((r) => r.pnl)), round(a.metrics.totalPnl), key);
    }
    assert.equal(b.histogram.reduce((n, r) => n + r.count, 0), view.length);
  }
});

test('breakdown shapes: weekdays Mon–Fri, hourly entry buckets from ORB end, 0.2% histogram', () => {
  const b = analyse(TRADES, { config: CFG }).breakdowns;
  assert.deepEqual(b.weekday.map((r) => r.key), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  assert.deepEqual(b.entryTime.map((r) => r.key), ['09:30–10:00', '10:00–11:00', '11:00–12:00', '12:00–13:00', '13:00–14:00', '14:00–15:00', '15:00–16:00']);
  assert.deepEqual(b.reason.map((r) => r.key), ['TARGET', 'SL', 'EOD']);
  assert.ok(Math.abs(sum(b.reason.map((r) => r.share)) - 100) <= 0.02, 'shares are rounded to 2 dp each');
  for (const [i, h] of b.histogram.entries()) {
    assert.equal(round(h.to - h.from), 0.2);
    if (i) assert.equal(h.from, b.histogram[i - 1].to, 'contiguous');
  }
  for (const t of TRADES) {
    const bin = b.histogram.find((h) => t.pnlPct >= h.from - 1e-9 && t.pnlPct < h.to - 1e-9);
    assert.ok(bin, `trade at ${t.pnlPct}% has a bucket`);
  }
});

test('warnings: small sample under 30 trades, concentration over 50%', () => {
  const few = analyse(TRADES.slice(0, 10), { config: CFG });
  assert.equal(few.warnings.smallSample, true);
  assert.equal(analyse(TRADES, { config: CFG }).warnings.smallSample, false);
  const lone = analyse(TRADES, { config: CFG, filters: { symbols: ['NSE:AAA-EQ'] } });
  assert.equal(lone.warnings.concentrated, lone.portfolio.topShare > 50);
  const none = analyse(TRADES, { config: CFG, filters: { side: 'long', symbols: ['NSE:NOPE-EQ'] } });
  assert.equal(none.count, 0);
  assert.equal(none.portfolio, null);
});

// --- routes ---------------------------------------------------------------

const apiConfig = loadConfig({ DATABASE_URL: 'x', APP_PASSWORD_HASH: 'h', SESSION_SECRET: 'x'.repeat(32) });
const headers = { authorization: `Bearer ${signSession(apiConfig.sessionSecret).token}` };
const spec = (cfg = CFG) => ({ config: cfg, fromDate: '2026-01-05', toDate: '2026-02-27', symbols: Object.keys(CANDLES) });

async function withApi(fn, { getCandles } = {}) {
  const db = await createTestDb();
  const worker = createWorker({ pool: db.pool, getCandles: async ({ symbol }, { onCall }) => (onCall(), CANDLES[symbol]), log: () => {} });
  const app = buildApp({ pool: db.pool, config: apiConfig, worker, getCandles });
  const get = (url) => app.inject({ url, headers });
  try {
    await fn({ app, get, pool: db.pool, worker });
  } finally {
    await app.close();
    await db.drop();
  }
}

test('GET analysis matches computeMetrics on the stored, filtered trades', { skip: noDb }, () =>
  withApi(async ({ get, pool, worker }) => {
    const id = await createRun(pool, spec());
    await worker.wake();
    const stored = await loadTrades(pool, id);

    const all = (await get(`/api/runs/${id}/analysis`)).json();
    assert.deepEqual(all.metrics, computeMetrics(stored));
    assert.equal(all.run.id, id);
    assert.deepEqual(all.portfolio.symbols, { done: 3 });

    const res = (await get(`/api/runs/${id}/analysis?side=short&reason=SL,TARGET&from=2026-01-15&symbols=NSE:AAA-EQ,NSE:CCC-EQ`)).json();
    const view = filterTrades(stored, { side: 'short', reasons: ['SL', 'TARGET'], from: '2026-01-15', symbols: ['NSE:AAA-EQ', 'NSE:CCC-EQ'] });
    assert.deepEqual(res.metrics, computeMetrics(view));
    assert.equal(res.count, view.length);
    assert.ok(res.symbols.every((r) => ['NSE:AAA-EQ', 'NSE:CCC-EQ'].includes(r.symbol)));

    assert.equal((await get(`/api/runs/${id}/analysis?side=up`)).statusCode, 400);
    assert.equal((await get('/api/runs/999/analysis')).statusCode, 404);
  }));

test('trades as JSON and as CSV with the CLI trade-log columns', { skip: noDb }, () =>
  withApi(async ({ get, pool, worker }) => {
    const id = await createRun(pool, spec());
    await worker.wake();
    const json = (await get(`/api/runs/${id}/trades?side=long`)).json().trades;
    assert.ok(json.length > 0 && json.every((t) => t.side === 'long' && Number.isInteger(t.id)));

    const csv = await get(`/api/runs/${id}/trades?side=long&format=csv`);
    assert.match(csv.headers['content-type'], /text\/csv/);
    assert.match(csv.headers['content-disposition'], new RegExp(`run-${id}-trades.csv`));
    const lines = csv.body.trim().split('\n');
    assert.equal(lines[0], 'symbol,date,side,entryTime,entry,sl,target,exitTime,exit,reason,quantity,notional,pnl,pnlPct,rMultiple');
    assert.equal(lines.length, json.length + 1);
    const first = json[0];
    assert.equal(lines[1], [first.symbol, first.date, first.side, first.entryTime, first.entry, first.sl, first.target ?? '', first.exitTime, first.exit, first.reason, first.quantity, first.notional, first.pnl, first.pnlPct, first.rMultiple].join(','));
  }));

test('compare runs by id or a whole sweep, with a settings diff', { skip: noDb }, () =>
  withApi(async ({ get, pool, worker }) => {
    const a = await createRun(pool, spec());
    const b = await createRun(pool, spec({ ...CFG, slMode: 'range', costBps: 0 }));
    const sweepIds = await createSweep(pool, spec(), TARGET_VARIANTS);
    await worker.wake();

    const res = (await get(`/api/compare?ids=${a},${b}`)).json();
    assert.deepEqual(res.runs.map((r) => r.run.id), [a, b]);
    assert.deepEqual(res.settingsDiff, [{ key: 'slMode', values: ['tighter', 'range'] }, { key: 'costBps', values: [5, 0] }]);
    const stored = await loadTrades(pool, a);
    assert.deepEqual(res.runs[0].metrics, computeMetrics(stored));
    assert.equal(sum(Object.values(res.runs[0].bySymbol)), computeMetrics(stored).totalPnl);

    const sweep = (await get(`/api/compare?sweep=${sweepIds[0]}`)).json();
    assert.equal(sweep.runs.length, TARGET_VARIANTS.length);
    assert.deepEqual(sweep.settingsDiff.map((d) => d.key), ['targetMode', 'targetR', 'targetPct']);

    assert.equal((await get(`/api/compare?ids=${a}`)).statusCode, 400);
    assert.equal((await get(`/api/compare?ids=${a},${a}`)).statusCode, 400);
    assert.equal((await get('/api/compare?ids=1,2,3,4,5')).statusCode, 400);
  }));

test('trade candles: one fetch for the trade day, cached, errors mapped', { skip: noDb }, async () => {
  const calls = [];
  let fail = null;
  const getCandles = async (params) => {
    calls.push(params);
    if (fail) throw new Error(fail);
    return CANDLES[params.symbol].slice(0, 3);
  };
  await withApi(
    async ({ get, pool, worker }) => {
      const id = await createRun(pool, spec());
      await worker.wake();
      const [t] = await loadTrades(pool, id);

      const res = await get(`/api/trades/${t.id}/candles`);
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['cache-control'], 'private, max-age=3600');
      assert.deepEqual(calls, [{ symbol: t.symbol, resolution: '1', fromDate: t.date, toDate: t.date }]);
      const body = res.json();
      assert.equal(body.trade.id, t.id);
      assert.equal(body.trade.entry, t.entry);
      assert.deepEqual(body.candles[0], CANDLES[t.symbol][0].slice(0, 5));

      fail = 'No Fyers token for today. Run `npm run login` first.';
      assert.equal((await get(`/api/trades/${t.id}/candles`)).statusCode, 409);
      fail = 'Fyers returned 429 earlier today; REST paused to avoid a block.';
      assert.equal((await get(`/api/trades/${t.id}/candles`)).statusCode, 503);
      fail = 'Fyers history failed for X: {"token":"secret"}';
      const bad = await get(`/api/trades/${t.id}/candles`);
      assert.equal(bad.statusCode, 502);
      assert.doesNotMatch(bad.body, /secret/);
      assert.equal((await get('/api/trades/999999/candles')).statusCode, 404);
    },
    { getCandles }
  );
});
