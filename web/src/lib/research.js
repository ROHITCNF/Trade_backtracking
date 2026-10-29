// Research screen rules (v2/Research — desktop.png), pure so web/test covers
// them: which runs are research, what each card is called, what the launcher
// sends, and how far an active run has got.

import { daysBetween } from './dates.js';
import { plannedCalls, runTitle } from './runs.js';

// Journal runs are ordinary runs with a reserved name (decisions D16).
export const JOURNAL_PREFIX = 'Journal · ';
export const isJournalRun = (run) => Boolean(run.name?.startsWith(JOURNAL_PREFIX));

// The strategy knobs a run snapshots (api/runSpec.js STRATEGY_KEYS, minus resolution).
export const STRATEGY_KEYS = [
  'direction', 'orbStart', 'orbEnd', 'sessionEnd', 'slMode', 'slPct', 'targetMode', 'targetR',
  'targetPct', 'sizing', 'capitalPerTrade', 'leverage', 'quantity', 'costBps',
];

export const strategyOf = (config) => Object.fromEntries(STRATEGY_KEYS.filter((k) => config[k] !== undefined).map((k) => [k, config[k]]));

// Two strategies are the same when every knob matches; numbers typed as text
// ('1.5') equal the stored number (1.5).
export function sameStrategy(a, b) {
  return STRATEGY_KEYS.every((k) => String(a[k] ?? '') === String(b[k] ?? ''));
}

// Every run in a GET /api/runs response, newest first (sweeps flattened).
export const allRuns = (items) => items.flatMap((it) => (it.type === 'run' ? [it.run] : it.runs));

// Research cards: single runs that aren't Journal runs. Sweeps are no longer
// shown (decisions D19).
export const researchRuns = (items) => items.filter((it) => it.type === 'run' && !isJournalRun(it.run)).map((it) => it.run);

// The default strategy (D18): the newest Journal run's settings, else the
// API's defaults.
export function defaultStrategy(items, fallback) {
  const journal = allRuns(items).find(isJournalRun);
  return strategyOf(journal ? journal.config : fallback);
}

// What a card is called: its name ("final (5 of 18)", "SBIN"), else the list.
export const cardTitle = (run) => run.name || run.watchlistName || runTitle(run);

// Weekdays in the range, inclusive. Holidays are ignored (#69), so this is an
// upper bound on trading days.
export function weekdaysBetween(from, to) {
  const start = new Date(`${from}T00:00:00Z`);
  let n = 0;
  for (let i = 0; i < daysBetween(from, to); i++) {
    const d = new Date(start.getTime() + i * 86400000).getUTCDay();
    if (d !== 0 && d !== 6) n++;
  }
  return n;
}

// Launcher form -> the API's draft body. Numbers typed as text go as numbers;
// anything unparseable comes back from the API as a 400 message.
export function configBody(c) {
  const n = (v) => (v === '' || v === null || v === undefined ? undefined : Number(v));
  return {
    direction: c.direction, orbStart: c.orbStart, orbEnd: c.orbEnd, sessionEnd: c.sessionEnd,
    slMode: c.slMode, slPct: n(c.slPct), targetMode: c.targetMode, targetR: n(c.targetR), targetPct: n(c.targetPct),
    sizing: c.sizing, capitalPerTrade: n(c.capitalPerTrade), leverage: n(c.leverage), quantity: n(c.quantity), costBps: n(c.costBps),
  };
}

// form: { mode: 'watchlist' | 'symbol', list, subset (null = all), symbol, fromDate, toDate, config }.
// A subset is sent as symbols and named after the list ("final (5 of 18)"), a
// single symbol by its ticker, so each card can be titled without a lookup.
export function researchDraft(form) {
  const base = { fromDate: form.fromDate, toDate: form.toDate, config: configBody(form.config) };
  if (form.mode === 'symbol') {
    return form.symbol ? { ...base, name: form.symbol.ticker, symbols: [form.symbol.symbol] } : null;
  }
  if (!form.list) return null;
  if (!form.subset || form.subset.length === form.list.count) return { ...base, watchlistId: form.list.id };
  if (!form.subset.length) return null;
  return { ...base, name: `${form.list.name} (${form.subset.length} of ${form.list.count})`, symbols: form.subset };
}

const SECONDS_PER_CALL = 1.3; // src/fyers.js MIN_GAP_MS

// How far an active run has got, and roughly how long is left.
export function progressFacts(run) {
  const pct = run.total ? Math.round((run.done / run.total) * 100) : 0;
  const remainingCalls = Math.max(0, plannedCalls(run) - run.callsUsed);
  return { pct, remainingCalls, etaSeconds: Math.ceil(remainingCalls * SECONDS_PER_CALL) };
}
