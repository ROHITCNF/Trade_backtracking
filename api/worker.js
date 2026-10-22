// Executes runs, one at a time in creation order (FR-15), and writes each
// symbol's trades and stats as soon as that symbol finishes (FR-18). Strategy
// logic stays in src/engine.js; this file only moves data (NFR-18).
//
// A sweep is several runs sharing a sweep_id. They execute together, so each
// symbol's candles are fetched once and fed to every variant (spec F5).
//
// Everything a run needs to resume lives in the database: a symbol is pending
// until the transaction that writes its results commits, so after a crash the
// worker simply picks the run up again and re-runs the unfinished symbols (FR-17).

const { getCandles: fetchCandles } = require('../src/fetch');
const { runBacktest } = require('../src/engine');
const { computeMetrics } = require('../src/metrics');
const { rowFor, totalsFrom } = require('../src/portfolio');
const { withTransaction } = require('./db/pool');
const { insertTrades, loadTrades } = require('./db/trades');

// Errors that every later symbol would hit too: spent budget, a 429 pause, a
// dead token. These fail the whole run instead of one symbol (FR-16, D8); the
// pending symbols stay pending, so the run can be resumed later.
const isFatal = (err) => /REST budget|429|token/i.test(err.message);

const firstLine = (err) => String(err.message).split('\n')[0].slice(0, 500);

// computeMetrics without the equity curve: one point per trade is too much to
// keep on every row, and the dashboard recomputes it from the trades anyway.
function summaryOf(trades) {
  const { curve, ...rest } = computeMetrics(trades);
  return rest;
}

function createWorker({ pool, getCandles = fetchCandles, log = console.log }) {
  // Records one symbol's outcome for one run, all in one transaction.
  function finishSymbol(run, symbol, { status, reason = null, trades = [], metrics = null }, calls) {
    return withTransaction(pool, async (client) => {
      await insertTrades(client, run.id, symbol, trades);
      await client.query(
        `update run_symbols set status = $3, reason = $4, metrics = $5, finished_at = now()
         where run_id = $1 and symbol = $2`,
        [run.id, symbol, status, reason, metrics]
      );
      await client.query('update runs set done = done + 1, calls_used = calls_used + $2 where id = $1', [run.id, calls]);
    });
  }

  async function finishRun(run) {
    const trades = await loadTrades(pool, run.id);
    const bySymbol = new Map();
    for (const t of trades) bySymbol.set(t.symbol, [...(bySymbol.get(t.symbol) || []), t]);
    const symbolRows = [...bySymbol].map(([symbol, ts]) => rowFor(symbol, ts, computeMetrics(ts)));

    const metrics = { ...summaryOf(trades), portfolio: symbolRows.length ? totalsFrom(trades, symbolRows) : null };
    await pool.query(
      `update runs set status = 'done', metrics = $2, finished_at = now() where id = $1 and status = 'running'`,
      [run.id, metrics]
    );
    log(`[run ${run.id}] done — ${trades.length} trades, P&L ${metrics.totalPnl}`);
  }

  async function failRuns(runs, err, calls) {
    for (const run of runs) {
      await pool.query(
        `update runs set status = 'failed', error = $2, calls_used = calls_used + $3, finished_at = now() where id = $1`,
        [run.id, firstLine(err), calls.get(run.id) || 0]
      );
      log(`[run ${run.id}] failed — ${firstLine(err)}`);
    }
  }

  // Drops runs whose cancel was requested, marking them cancelled (FR-19).
  async function withoutCancelled(runs) {
    const { rows } = await pool.query(
      `update runs set status = 'cancelled', finished_at = now()
       where id = any($1) and cancel_requested and status = 'running' returning id`,
      [runs.map((r) => r.id)]
    );
    const cancelled = new Set(rows.map((r) => Number(r.id)));
    for (const id of cancelled) log(`[run ${id}] cancelled`);
    return runs.filter((r) => !cancelled.has(r.id));
  }

  // The oldest unfinished run, plus the rest of its sweep, now marked running.
  async function claim() {
    const { rows } = await pool.query(
      `update runs set status = 'running', started_at = coalesce(started_at, now())
       where id = (select id from runs where status in ('queued', 'running')
                   order by created_at, id limit 1 for update skip locked)
       returning id, sweep_id`
    );
    if (!rows.length) return null;
    const { id, sweep_id } = rows[0];
    if (sweep_id !== null) {
      await pool.query(
        `update runs set status = 'running', started_at = coalesce(started_at, now())
         where sweep_id = $1 and status in ('queued', 'running')`,
        [sweep_id]
      );
    }
    const { rows: runs } = await pool.query(
      `select id, config, from_date::text as "fromDate", to_date::text as "toDate" from runs
       where status = 'running' and (id = $1 or sweep_id = $2) order by id`,
      [id, sweep_id]
    );
    return runs.map((r) => ({ ...r, id: Number(r.id) }));
  }

  async function execute(group) {
    const ids = group.map((r) => r.id);
    log(`[run ${ids.join(',')}] started`);
    const { rows: pending } = await pool.query(
      `select run_id, symbol from run_symbols where run_id = any($1) and status = 'pending' order by position, run_id`,
      [ids]
    );
    // symbol -> ids of the runs still needing it, in position order.
    const todo = new Map();
    for (const { run_id, symbol } of pending) todo.set(symbol, [...(todo.get(symbol) || []), Number(run_id)]);

    let active = group;
    for (const [symbol, needIds] of todo) {
      active = await withoutCancelled(active);
      if (!active.length) return;
      const runs = active.filter((r) => needIds.includes(r.id));
      if (!runs.length) continue;

      // Every variant of a sweep shares symbols and dates, so one fetch serves all.
      const { config, fromDate, toDate } = runs[0];
      let calls = 0;
      let candles;
      try {
        candles = await getCandles({ symbol, resolution: config.resolution, fromDate, toDate }, { onCall: () => calls++ });
      } catch (err) {
        if (isFatal(err)) {
          await failRuns(active, err, new Map(runs.map((r) => [r.id, calls])));
          return;
        }
        log(`[run ${runs[0].id}] ${symbol} — failed: ${firstLine(err)}`);
        for (const run of runs) await finishSymbol(run, symbol, { status: 'failed', reason: firstLine(err) }, calls);
        continue;
      }

      for (const run of runs) {
        let trades;
        try {
          trades = runBacktest(candles, { ...run.config, symbol, fromDate, toDate });
        } catch (err) {
          log(`[run ${run.id}] ${symbol} — engine error: ${firstLine(err)}`);
          await finishSymbol(run, symbol, { status: 'failed', reason: `engine error: ${firstLine(err)}` }, calls);
          continue;
        }
        const outcome = trades.length
          ? { status: 'done', trades, metrics: summaryOf(trades) }
          : { status: 'skipped', reason: 'no trades' };
        await finishSymbol(run, symbol, outcome, calls);
        log(`[run ${run.id}] ${symbol} — ${trades.length ? `${trades.length} trades` : 'no trades, skipped'}`);
      }
    }

    // A cancel that arrived during the last symbol still counts.
    for (const run of await withoutCancelled(active)) await finishRun(run);
  }

  async function runNext() {
    const group = await claim();
    if (!group) return false;
    await execute(group);
    return true;
  }

  // Works through the queue until it is empty. Calling wake() while it is busy
  // makes it look again before stopping, so a run queued mid-drain is not missed.
  let draining = null;
  let again = false;
  function wake() {
    if (draining) {
      again = true;
      return draining;
    }
    draining = (async () => {
      do {
        again = false;
        while (await runNext());
      } while (again);
    })()
      .catch((err) => log(`worker error: ${err.stack || err.message}`))
      .finally(() => {
        draining = null;
      });
    return draining;
  }

  return { wake };
}

module.exports = { createWorker, isFatal };
