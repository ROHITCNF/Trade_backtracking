// Live paper trading (M6): the scheduler's state and the paper trades it has
// recorded. Read-only; the session itself is driven by api/live.js.

const fyers = require('../../src/fyers');
const { getCandles: fetchCandles } = require('../../src/fetch');
const { istToday, dateToEpoch, istParts, toMinutes } = require('../../src/time');
const { round } = require('../../src/util');
const { httpError } = require('../errors');
const { reconcileDay } = require('../reconcile');
const { loadWatchlist } = require('../live');
const baseConfig = require('../../config');

const DATE = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const DEFAULT_DAYS = 30;

const TRADE_COLUMNS = `date::text as date, symbol, status, side, quantity, entry_time as "entryTime", entry, sl, target,
  exit_time as "exitTime", exit, reason, pnl, source`;
const NUMERIC = ['entry', 'sl', 'target', 'exit', 'pnl'];

function rowToTrade(row) {
  const t = { ...row };
  for (const k of NUMERIC) if (t[k] !== null) t[k] = Number(t[k]);
  return t;
}

// Closed trades only: an open trade has no P&L yet.
function summarize(trades) {
  const closed = trades.filter((t) => t.status === 'closed');
  const wins = closed.filter((t) => t.pnl > 0).length;
  const byDate = new Map();
  for (const t of closed) byDate.set(t.date, (byDate.get(t.date) || 0) + t.pnl);
  return {
    summary: {
      trades: trades.length,
      open: trades.length - closed.length,
      closed: closed.length,
      wins,
      losses: closed.length - wins,
      winRate: closed.length ? round((wins / closed.length) * 100) : null,
      netPnl: round(closed.reduce((sum, t) => sum + t.pnl, 0)),
    },
    days: [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, pnl]) => ({ date, pnl: round(pnl) })),
  };
}

// True once today's session is over (sessionEnd has passed in IST).
const afterClose = (date, now = Date.now()) => {
  const { date: today, minute } = istParts(Math.floor(now / 1000));
  return date < today || (date === today && minute > toMinutes(baseConfig.sessionEnd));
};

const daysBefore = (date, n) => istParts(dateToEpoch(date) - n * 86400).date;

// What the trade chart needs beyond the stored row: the opening range from the
// day's candles, and epoch seconds for the entry and exit markers.
function chartTrade(trade, candles, { orbStart, orbEnd }) {
  const from = toMinutes(orbStart);
  const to = toMinutes(orbEnd);
  const range = candles.filter(([t]) => {
    const m = istParts(t).minute;
    return m >= from && m < to;
  });
  const at = (hhmm) => (hhmm ? dateToEpoch(trade.date) + toMinutes(hhmm) * 60 : null);
  return {
    ...trade,
    orbHigh: range.length ? Math.max(...range.map((c) => c[2])) : null,
    orbLow: range.length ? Math.min(...range.map((c) => c[3])) : null,
    entryTs: at(trade.entryTime),
    exitTs: at(trade.exitTime),
  };
}

async function liveRoutes(app, { tokenStatus = fyers.tokenStatus, getCandles = fetchCandles, config = baseConfig } = {}) {
  const db = app.db;

  app.get('/api/live/status', async () => {
    const live = app.live ? app.live.status() : { enabled: false, watchlist: null, lastError: null, session: null };
    const { connected } = await tokenStatus();
    return { ...live, tokenConnected: connected, today: istToday() };
  });

  app.get(
    '/api/paper-trades',
    { schema: { querystring: { type: 'object', properties: { from: DATE, to: DATE } } } },
    async (request) => {
      const to = request.query.to || istToday();
      const from = request.query.from || daysBefore(to, DEFAULT_DAYS - 1);
      const { rows } = await db.query(
        `select ${TRADE_COLUMNS} from paper_trades where date between $1 and $2
         order by date desc, entry_time desc, symbol`,
        [from, to]
      );
      const trades = rows.map(rowToTrade);
      const rec = await db.query(
        `select date::text as date, reconciled_at as "reconciledAt", checked, matched, backfilled, mismatches
         from paper_reconciliations where date between $1 and $2 order by date desc`,
        [from, to]
      );
      return { from, to, trades, ...summarize(trades), reconciliations: rec.rows };
    }
  );

  app.get(
    '/api/paper-trades/:date/decisions',
    { schema: { params: { type: 'object', properties: { date: DATE } } } },
    async (request) => {
      const { rows } = await db.query(
        'select id, symbol, kind, payload, at from live_decisions where date = $1 order by id',
        [request.params.date]
      );
      return { date: request.params.date, decisions: rows.map((r) => ({ ...r, id: Number(r.id) })) };
    }
  );

  // Re-checks a day against the backtest by hand: for a day the scheduler
  // missed, or after fixing a mismatch. One Fyers call per symbol.
  app.post(
    '/api/paper-trades/:date/reconcile',
    { schema: { params: { type: 'object', properties: { date: DATE } } } },
    async (request) => {
      const { date } = request.params;
      if (!afterClose(date)) throw httpError(409, 'The day isn’t over yet.');
      const symbols = await loadWatchlist(db, app.live?.status().watchlist || 'core');
      try {
        return await reconcileDay({ pool: db, date, symbols, config, getCandles });
      } catch (err) {
        if (/No Fyers token/.test(err.message)) throw httpError(409, 'Connect Fyers to reconcile.');
        if (/REST budget|429/.test(err.message)) throw httpError(503, err.message);
        throw err;
      }
    }
  );

  // The paper trade's day on 1-minute candles: one Fyers call, never stored,
  // like /api/trades/:id/candles for backtest trades.
  app.get(
    '/api/paper-trades/:date/:symbol/candles',
    { schema: { params: { type: 'object', properties: { date: DATE, symbol: { type: 'string', maxLength: 64 } } } } },
    async (request, reply) => {
      const { date, symbol } = request.params;
      const { rows } = await db.query(`select ${TRADE_COLUMNS} from paper_trades where date = $1 and symbol = $2`, [date, symbol]);
      if (!rows.length) throw httpError(404, 'Paper trade not found');
      let candles;
      try {
        candles = await getCandles({ symbol, resolution: '1', fromDate: date, toDate: date });
      } catch (err) {
        if (/No Fyers token/.test(err.message)) throw httpError(409, 'Connect Fyers to load the chart.');
        if (/REST budget|429/.test(err.message)) throw httpError(503, err.message);
        request.log.warn({ code: err.code, symbol, date }, 'paper candles: fetch failed');
        throw httpError(502, 'Could not load candles from Fyers.');
      }
      candles = candles.map(([t, o, h, l, c]) => [t, o, h, l, c]);
      // Today's candles keep changing; past days don't.
      reply.header('cache-control', date === istToday() ? 'no-store' : 'private, max-age=3600');
      return { trade: chartTrade(rowToTrade(rows[0]), candles, config), candles, orbEnd: config.orbEnd };
    }
  );
}

module.exports = { liveRoutes, summarize, chartTrade };
