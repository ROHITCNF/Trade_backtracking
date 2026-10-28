// Live paper trading: what the Live page says about the scheduler, and the
// per-day rows for its P&L chart. Pure, so the rules are tested in web/test.

import { istParts } from './ist.js';

// The API's scheduler starts the session at 09:10 IST and stops it a few
// minutes after the 15:14 exit; 15:30 matches the market pill.
const START = 9 * 60 + 10;
const CLOSE = 15 * 60 + 30;

export function inLiveWindow(now = Date.now()) {
  const { weekday, minutes } = istParts(now);
  return weekday >= 1 && weekday <= 5 && minutes >= START && minutes < CLOSE;
}

// The one notice worth showing above the page, or null. Ordered by what blocks
// the session first: switched off, then no token, then a failed start.
export function liveNotice(status, now = Date.now()) {
  if (!status) return null;
  if (!status.enabled) {
    return { tone: 'info', title: 'Live paper trading is off.', body: 'Set LIVE_ENABLED=true on the API service to record paper trades on market days.' };
  }
  const window = inLiveWindow(now);
  if (window && !status.tokenConnected) {
    return { tone: 'warn', title: 'Live won’t start — connect Fyers.', body: 'The session needs today’s Fyers token. It starts within a minute of connecting.', action: 'connect' };
  }
  if (window && !status.session && status.lastError) {
    return { tone: 'error', title: 'The live session didn’t start.', body: `${status.lastError} Retrying every 30 seconds.` };
  }
  return null;
}

// One line for the status strip.
export function sessionLabel(status, now = Date.now()) {
  if (!status?.enabled) return 'Off';
  const s = status.session;
  if (s?.running) return `Watching ${s.symbols} symbols · ${s.open} open · ${s.closed} closed today`;
  if (inLiveWindow(now)) return status.tokenConnected ? 'Starting…' : 'Waiting for Fyers';
  return 'Idle · next session 09:10 IST on a weekday';
}

// Closed trades grouped by date, oldest first, in the shape PnlBars draws.
export function dailyRows(trades) {
  const byDate = new Map();
  for (const t of trades) {
    if (t.status !== 'closed') continue;
    const d = byDate.get(t.date) || { key: t.date, pnl: 0, trades: 0, wins: 0 };
    d.pnl += t.pnl;
    d.trades += 1;
    if (t.pnl > 0) d.wins += 1;
    byDate.set(t.date, d);
  }
  return [...byDate.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(({ wins, ...d }) => ({ ...d, pnl: Math.round(d.pnl * 100) / 100, winRate: Math.round((wins / d.trades) * 100) }));
}

// One reconciliation (live vs backtest, after the close) as a short verdict.
export function reconLabel(r) {
  const parts = [];
  if (r.mismatches.length) parts.push(`${r.mismatches.length} mismatch${r.mismatches.length === 1 ? '' : 'es'}`);
  else if (r.backfilled === 0 || r.matched > 0) parts.push(`${r.matched}/${r.checked} matched`);
  if (r.backfilled) parts.push(`${r.backfilled} backfilled`);
  return { text: parts.join(' · '), tone: r.mismatches.length ? 'loss' : 'profit' };
}
