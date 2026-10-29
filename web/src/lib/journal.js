// Journal rules (v2/Journal — desktop.png; decisions D16–D18, D21), pure so
// web/test covers them. A Journal run is an ordinary run named
// "Journal · <watchlist id>" over the last 40 days; this file decides when a
// list needs one, which old ones can go, and turns runs into heatmap cells.

import { addDays, istToday, lastTradingDay } from './dates.js';
import { istParts } from './ist.js';
import { JOURNAL_PREFIX, sameStrategy } from './research.js';

export const WINDOW_DAYS = 40; // under one 60-day history chunk: 1 call per symbol
export const HEATMAP_DAYS = 20;
const READY_AT = 15 * 60 + 45; // "runs automatically at 15:45 IST"

export const journalName = (listId) => `${JOURNAL_PREFIX}${listId}`;
export const journalListId = (run) => (run.name?.startsWith(JOURNAL_PREFIX) ? Number(run.name.slice(JOURNAL_PREFIX.length)) : null);

// The last session the Journal should cover: today from 15:45 IST on a
// weekday, else the weekday before. Holidays are ignored (#69); a holiday just
// yields no trades.
export function journalTo(now = Date.now()) {
  const today = istToday(now);
  const { weekday, minutes } = istParts(now);
  return weekday >= 1 && weekday <= 5 && minutes >= READY_AT ? today : lastTradingDay(today);
}

export const journalFrom = (to) => addDays(to, -(WINDOW_DAYS - 1));

const ACTIVE = new Set(['queued', 'running']);

// Per list: its Journal runs (newest first), the newest finished one, any
// active one, why it is out of date, and whether to queue a run now.
// runs: every run, newest first. strategy: the default (D18). to: journalTo().
export function journalState(lists, runs, strategy, to) {
  return lists.map((list) => {
    const mine = runs.filter((r) => journalListId(r) === list.id);
    const done = mine.find((r) => r.status === 'done') || null;
    const active = mine.find((r) => ACTIVE.has(r.status)) || null;
    const target = active || done;
    const stale = [];
    if (!target) stale.push('never run');
    else {
      if (target.toDate < to) stale.push('behind');
      if (!sameStrategy(target.config, strategy)) stale.push('strategy');
      if (target.total !== list.count) stale.push('symbols');
    }
    // A run that failed for the same day and settings is not retried on its own:
    // it would fail the same way (spent budget, dead token). The owner retries it.
    const failed = mine.find((r) => r.status === 'failed' && (!done || r.id > done.id)) || null;
    const failedSame = failed && failed.toDate === to && sameStrategy(failed.config, strategy) && failed.total === list.count;
    const needsRun = stale.length > 0 && !active && !failedSame && list.count > 0;
    return { list, runs: mine, done, active, failed: failedSame ? failed : null, stale, needsRun };
  });
}

// Journal runs that a newer finished run has made redundant: everything older
// than the list's newest done run, except anything still active.
export function supersededRuns(state) {
  return state.flatMap((s) => (s.done ? s.runs.filter((r) => r.id < s.done.id && !ACTIVE.has(r.status)).map((r) => r.id) : []));
}

// Day P&L from a per-trade equity curve (in entry order): each trade's P&L is
// the step from the previous point (D21).
export function dayPnl(curve) {
  const days = new Map();
  let prev = 0;
  for (const p of curve) {
    days.set(p.date, Math.round(((days.get(p.date) || 0) + p.equity - prev) * 100) / 100);
    prev = p.equity;
  }
  return days;
}

// rows: [{ list, days: Map date -> P&L }]. The last `count` dates any list
// traded become the columns; each cell carries a 1–4 shade scaled to the
// largest day in its own row ("darker = bigger, scaled per list").
export function heatmap(rows, count = HEATMAP_DAYS) {
  const dates = [...new Set(rows.flatMap((r) => [...r.days.keys()]))].sort().slice(-count);
  return {
    dates,
    rows: rows.map(({ list, days }) => {
      const values = dates.map((d) => (days.has(d) ? days.get(d) : null));
      const max = Math.max(0, ...values.filter((v) => v !== null).map(Math.abs)) || 1;
      const cells = dates.map((date, i) => {
        const pnl = values[i];
        return { date, pnl, shade: pnl === null || pnl === 0 ? 0 : Math.max(1, Math.ceil((Math.abs(pnl) / max) * 4)) };
      });
      const total = Math.round(values.reduce((a, v) => a + (v || 0), 0) * 100) / 100;
      return { list, cells, total };
    }),
  };
}

// +1.4k / −5.7k / +165 / +23.0k — a heatmap cell.
export function compactPnl(n) {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  const a = Math.abs(n);
  return a >= 1000 ? `${sign}${(a / 1000).toFixed(1)}k` : `${sign}${Math.round(a)}`;
}

// "Today" / "Yesterday" (the last trading day before today) / "" for older days.
export function relativeDay(day, today = istToday()) {
  if (day === today) return 'Today';
  return day === lastTradingDay(today) ? 'Yesterday' : '';
}

// The day's best and worst trades: up to n winners, biggest first, and n
// losers, worst first. A flat trade is neither.
export function topMovers(trades, n = 3) {
  const best = trades.filter((t) => t.pnl > 0).sort((a, b) => b.pnl - a.pnl).slice(0, n);
  const worst = trades.filter((t) => t.pnl < 0).sort((a, b) => a.pnl - b.pnl).slice(0, n);
  return { best, worst };
}
