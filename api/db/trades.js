// Trades rows <-> the trade objects runBacktest returns (minus candles). The
// parity test (test/parity.test.js) holds this mapping to zero differences.

// Postgres returns numeric and bigint as strings; these come back as numbers.
const NUMERIC = ['orbHigh', 'orbLow', 'entryTs', 'entry', 'sl', 'target', 'exitTs', 'exit', 'notional', 'pnl', 'pnlPct', 'rMultiple'];

const COLUMNS = `symbol, date::text as date, side, orb_high as "orbHigh", orb_low as "orbLow",
  entry_time as "entryTime", entry_ts as "entryTs", entry, sl, target, exit_time as "exitTime",
  exit_ts as "exitTs", exit, reason, quantity, notional, pnl, pnl_pct as "pnlPct", r_multiple as "rMultiple"`;

const RECORDSET = `date date, side text, "orbHigh" numeric, "orbLow" numeric, "entryTime" text,
  "entryTs" bigint, entry numeric, sl numeric, target numeric, "exitTime" text, "exitTs" bigint,
  exit numeric, reason text, quantity int, notional numeric, pnl numeric, "pnlPct" numeric,
  "rMultiple" numeric`;

function rowToTrade(row) {
  const t = { ...row };
  for (const k of NUMERIC) if (t[k] !== null) t[k] = Number(t[k]);
  return t;
}

async function insertTrades(client, runId, symbol, trades) {
  if (!trades.length) return;
  const rows = trades.map(({ candles, ...t }) => t);
  await client.query(
    `insert into trades (run_id, symbol, date, side, orb_high, orb_low, entry_time, entry_ts, entry, sl,
       target, exit_time, exit_ts, exit, reason, quantity, notional, pnl, pnl_pct, r_multiple)
     select $1, $2, date, side, "orbHigh", "orbLow", "entryTime", "entryTs", entry, sl, target, "exitTime",
       "exitTs", exit, reason, quantity, notional, pnl, "pnlPct", "rMultiple"
     from jsonb_to_recordset($3::jsonb) as t(${RECORDSET})`,
    [runId, symbol, JSON.stringify(rows)]
  );
}

// A run's trades in entry order, optionally for one symbol. Each carries its symbol.
async function loadTrades(db, runId, { symbol } = {}) {
  const { rows } = await db.query(
    `select ${COLUMNS} from trades where run_id = $1 and ($2::text is null or symbol = $2)
     order by entry_ts, symbol`,
    [runId, symbol ?? null]
  );
  return rows.map(rowToTrade);
}

module.exports = { insertTrades, loadTrades };
