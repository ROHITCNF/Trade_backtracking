// Live paper trading: what the Live page says about the scheduler, the range
// it shows, and the per-day rows for its P&L chart. Pure, so the rules are
// tested in web/test.

import { istParts } from './ist.js';
import { addDays, addMonths } from './dates.js';

// The API's scheduler starts the session at 09:10 IST and stops it a few
// minutes after the 15:14 exit; 15:30 matches the market pill.
const START = 9 * 60 + 10;
const CLOSE = 15 * 60 + 30;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IST_MS = 5.5 * 3600 * 1000;

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

// 'Mon 2 Nov, 09:10 IST': the next time the scheduler starts a session.
// Weekdays only; NSE holidays are not known (#69).
export function nextSession(now = Date.now()) {
  const { weekday, minutes } = istParts(now);
  let ahead = weekday >= 1 && weekday <= 5 && minutes < START ? 0 : 1;
  while ([0, 6].includes((weekday + ahead) % 7)) ahead++;
  const d = new Date(now + IST_MS + ahead * 86400000);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, 09:10 IST`;
}

// The pill next to the title and the line under it.
export function sessionHeader(status, now = Date.now()) {
  const tail = 'paper trading, no real orders';
  if (!status?.enabled) return { pill: 'Off', tone: 'off', line: `Live paper trading is switched off · ${tail}` };
  const s = status.session;
  if (s?.running) {
    return { pill: 'Live', tone: 'live', line: `Watching ${s.symbols} symbols of “${status.watchlist}” · ${s.open} open · ${s.closed} closed today · ${tail}` };
  }
  if (inLiveWindow(now)) {
    return status.tokenConnected
      ? { pill: 'Starting', tone: 'idle', line: `Starting today’s session · ${tail}` }
      : { pill: 'Waiting', tone: 'warn', line: `Waiting for Fyers to start today’s session · ${tail}` };
  }
  return { pill: 'Idle', tone: 'idle', line: `Next session ${nextSession(now)} · ${tail}` };
}

// Closed trades grouped by date, oldest first.
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

// The range buttons. All but 'custom' end on the chosen Date, which defaults
// to the last trading day (the newest day with a paper trade, from
// /api/live/status). 'custom' takes From and To.
export const RANGES = [['day', 'Day'], ['15d', '15D'], ['1m', '1M'], ['1y', '1Y'], ['custom', 'Custom']];

export function liveRange(range, { date, custom }) {
  switch (range) {
    case 'day': return { from: date, to: date };
    case '15d': return { from: addDays(date, -14), to: date };
    case '1m': return { from: addDays(addMonths(date, -1), 1), to: date };
    case '1y': return { from: addDays(addMonths(date, -12), 1), to: date };
    default: return { from: custom.from, to: custom.to };
  }
}

// The list the page opens on: 'final' if it exists, else the first one.
export function defaultWatchlist(watchlists) {
  return (watchlists.find((w) => w.name === 'final') || watchlists[0])?.id ?? null;
}
