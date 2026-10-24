// Calendar arithmetic on 'YYYY-MM-DD' strings (IST trading dates), done in UTC
// so the browser's own timezone never shifts a day.

import { istParts } from './ist.js';

const toDate = (ymd) => new Date(`${ymd}T00:00:00Z`);
const toYmd = (d) => d.toISOString().slice(0, 10);

export function istToday(now = Date.now()) {
  return new Date(now + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

export function addDays(ymd, n) {
  const d = toDate(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return toYmd(d);
}

export function addMonths(ymd, n) {
  const d = toDate(ymd);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return toYmd(d);
}

// Inclusive count of calendar days.
export const daysBetween = (from, to) => Math.round((toDate(to) - toDate(from)) / 86400000) + 1;

// The earliest From the API accepts: one year before today (FR-10).
export const earliestFrom = (today = istToday()) => addMonths(today, -12);

// Default To: today once the session is over, else yesterday (today's candles
// would stop at the current minute).
export function defaultTo(now = Date.now()) {
  const today = istToday(now);
  const { weekday, minutes } = istParts(now);
  const trading = weekday >= 1 && weekday <= 5 && minutes < 15 * 60 + 30;
  return trading ? addDays(today, -1) : today;
}

// The weekday before `today` (Monday gives Friday). Holidays are ignored for
// now, so a holiday can come back and simply yield no trades.
export function lastTradingDay(today = istToday()) {
  let d = addDays(today, -1);
  while ([0, 6].includes(toDate(d).getUTCDay())) d = addDays(d, -1);
  return d;
}

// A 1Y/6M/3M/1M shortcut ending at `to`, never earlier than allowed.
export function rangeFor(months, to, today = istToday()) {
  const from = addMonths(to, -months);
  const earliest = earliestFrom(today);
  return { fromDate: from < earliest ? earliest : from, toDate: to };
}
