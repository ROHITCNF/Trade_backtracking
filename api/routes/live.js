// Live paper trading (M6): the scheduler's state and the paper trades it has
// recorded. Read-only; the session itself is driven by api/live.js.

const fyers = require('../../src/fyers');
const { istToday, dateToEpoch, istParts } = require('../../src/time');
const { round } = require('../../src/util');

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

const daysBefore = (date, n) => istParts(dateToEpoch(date) - n * 86400).date;

async function liveRoutes(app, { tokenStatus = fyers.tokenStatus } = {}) {
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
      return { from, to, trades, ...summarize(trades) };
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
}

module.exports = { liveRoutes, summarize };
