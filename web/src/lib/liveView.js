// The Live page's trade list and trade panel (docs/design/reference/live, D23):
// rows built from paper trades, the list's symbols and the day's backtest
// check, and the story of one trade read off its 1-minute candles. Pure.

import { pnl, price, rMultiple } from './format.js';

const IST = 19800;
const pad = (n) => String(n).padStart(2, '0');
export const hhmm = (ts) => {
  const d = new Date((ts + IST) * 1000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
const minutesOf = (t) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null);
export const short = (s) => s.replace(/^NSE:|-EQ$/g, '');
export const rowKey = (date, symbol) => `${date}|${symbol}`;

// The stop a trade started with: a trail trade's stop moves (D25), and R is
// always measured against the risk taken at entry.
export const startSl = (t) => t.initialSl ?? t.sl;

// R of a trade: P&L over the money at risk, |entry − starting stop| × quantity.
export function rOf(t) {
  const sl = startSl(t);
  if (t.pnl == null || sl == null || !t.quantity) return null;
  const risk = Math.abs(t.entry - sl) * t.quantity;
  return risk > 0 ? t.pnl / risk : null;
}

// The two paper flows live records (D25).
export const FLOWS = [['fixed', 'Fixed'], ['trail', 'Trail']];
export const flowName = (flow) => (flow === 'trail' ? 'Trail' : 'Fixed');
export const parseFlow = (v) => (v === 'trail' ? 'trail' : 'fixed');

// A trail trade's stop over time, for the chart's stepped line: the starting
// stop from entry, each TRAIL decision's stop from its minute, held to the
// exit (or `lastTs` while open). Epoch seconds; null for a fixed trade.
export function slSteps(trade, decisions, lastTs = null) {
  if (trade.flow !== 'trail' || trade.entryTs == null) return null;
  const points = [{ time: trade.entryTs, value: startSl(trade) }];
  for (const d of decisions || []) {
    if (d.kind !== 'TRAIL' || d.symbol !== trade.symbol || d.payload?.flow !== 'trail') continue;
    const time = tsOn(trade, d.payload.time);
    if (time == null || time < points.at(-1).time) continue;
    if (time === points.at(-1).time) points.at(-1).value = d.payload.sl;
    else points.push({ time, value: d.payload.sl });
  }
  const end = trade.exitTs ?? lastTs;
  if (end != null && end > points.at(-1).time) points.push({ time: end, value: points.at(-1).value });
  return points;
}

// The other flow's result for the same entry, for the trade panel.
export function otherFlowText(flow, other) {
  const name = flowName(flow === 'trail' ? 'fixed' : 'trail');
  if (!other) return `${name}: —`;
  if (other.status !== 'closed') return `${name}: open`;
  return `${name}: ${pnl(other.pnl)} · ${REASON[other.reason] || other.reason}`;
}

// What a reconciliation mismatch means for the list: 'missed' when the
// backtest traded and live didn't (there is no paper trade to chart), else
// 'differs'. The tag is the short form shown on the row.
const TAGS = [
  [/backtest traded, live did not/, 'missed', 'missed by live'],
  [/live traded, backtest did not/, 'differs', 'not in backtest'],
  [/^side/, 'differs', 'side differs'],
  [/^entry/, 'differs', 'entry differs'],
  [/^exit/, 'differs', 'exit differs'],
  [/still open/, 'differs', 'still open'],
];
export function mismatchKind(m) {
  const hit = TAGS.find(([re]) => re.test(m.problem));
  return hit ? { kind: hit[1], tag: hit[2] } : { kind: 'differs', tag: 'check failed' };
}

export const REASON = { SL: 'Stop', TARGET: 'Target', EOD: 'EOD' };

// Every row the list can show. Traded rows are paper trades; missed rows come
// from the backtest check; on a single day, every other symbol of the list is
// a 'none' row (no breakout, or not traded live at all).
// The trail flow (D25) isn't reconciled: its rows carry no backtest check and
// are marked live only.
export function buildRows({ trades, reconciliations, symbols, missing = [], oneDay, date, flow = 'fixed' }) {
  if (flow === 'trail') reconciliations = [];
  const checks = new Map();
  const notes = new Map(); // D24: 'match' (with slippage) and 'tick' (expected) verdicts
  for (const r of reconciliations) {
    for (const m of r.mismatches) checks.set(rowKey(r.date, m.symbol), m);
    for (const n of r.notes || []) notes.set(rowKey(r.date, n.symbol), n);
  }
  const checked = new Set(reconciliations.map((r) => r.date));
  const rows = [];
  const seen = new Set();

  for (const t of trades) {
    const key = rowKey(t.date, t.symbol);
    seen.add(key);
    const m = checks.get(key) || null;
    const note = notes.get(key) || null;
    rows.push({ key, kind: 'traded', date: t.date, symbol: t.symbol, side: t.side, entryTime: t.entryTime, pnl: t.pnl, r: rOf(t), trade: t, mismatch: m, tag: m && mismatchKind(m).tag, check: note, liveOnly: flow === 'trail' });
  }
  for (const [key, m] of checks) {
    if (seen.has(key) || mismatchKind(m).kind !== 'missed') continue;
    seen.add(key);
    const [d, symbol] = key.split('|');
    const bt = m.backtest || {};
    rows.push({ key, kind: 'missed', date: d, symbol, side: bt.side, entryTime: bt.entryTime, pnl: null, r: null, trade: null, mismatch: m, tag: 'missed by live' });
  }
  if (oneDay && symbols) {
    const notLive = new Set(missing);
    for (const symbol of symbols) {
      const key = rowKey(date, symbol);
      if (seen.has(key)) continue;
      const note = notLive.has(symbol) ? 'Not traded live' : checked.has(date) ? 'No breakout · backtest agrees' : 'No breakout';
      rows.push({ key, kind: 'none', date, symbol, side: null, entryTime: null, pnl: null, r: null, trade: null, mismatch: null, tag: null, note });
    }
  }
  return rows;
}

export function tabRows(rows, tab) {
  if (tab === 'traded') return rows.filter((r) => r.kind === 'traded');
  if (tab === 'review') return rows.filter((r) => r.mismatch);
  return rows;
}

// 'time': newest day first, then by entry time; 'pnl': best first. Rows with
// nothing to sort on go last, by symbol.
export function sortRows(rows, by) {
  const rank = (r) => (r.kind === 'none' ? 1 : 0);
  return [...rows].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (by === 'pnl') {
      if (a.pnl == null || b.pnl == null) return (a.pnl == null) - (b.pnl == null) || a.symbol.localeCompare(b.symbol);
      return b.pnl - a.pnl;
    }
    return b.date.localeCompare(a.date) || (a.entryTime || '99').localeCompare(b.entryTime || '99') || a.symbol.localeCompare(b.symbol);
  });
}

// Counts for the "Checked against backtest" card over the range. Tick-order
// differences are expected (D24) and counted apart from the ones to review.
export function reviewCounts(rows) {
  const review = rows.filter((r) => r.mismatch);
  const missed = review.filter((r) => mismatchKind(r.mismatch).kind === 'missed').length;
  const tick = rows.filter((r) => r.check?.kind === 'tick').length;
  return { review: review.length, missed, differ: review.length - missed, tick };
}

// The grey line for a tick-order difference: what the backtest had to guess.
export function tickText(note) {
  const bt = note.backtest;
  const what = bt ? ` The backtest ${bt.reason ? `exited on ${REASON[bt.reason] || bt.reason}` : 'went another way'}${bt.pnl != null ? ` for ${pnl(bt.pnl)}` : ''}.` : ' The backtest has no trade.';
  return `Tick order (expected): ${note.problem}.${what}`;
}

// '5 h 19 m' / '42 m' between two 'HH:MM' times.
export function held(entryTime, exitTime) {
  const a = minutesOf(entryTime);
  const b = minutesOf(exitTime);
  if (a == null || b == null || b < a) return '—';
  const m = b - a;
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} m` : `${m} m`;
}

// The furthest the trade went for and against it between entry and exit.
export function excursions(trade, candles) {
  const long = trade.side === 'long';
  const end = trade.exitTs ?? Infinity;
  const inTrade = candles.filter(([t]) => t >= trade.entryTs - 59 && t <= end);
  if (!inTrade.length) return null;
  let best = null;
  let worst = null;
  for (const [t, , h, l] of inTrade) {
    const fav = long ? h : l;
    const adv = long ? l : h;
    if (!best || (long ? fav > best.price : fav < best.price)) best = { price: fav, ts: t };
    if (!worst || (long ? adv < worst.price : adv > worst.price)) worst = { price: adv, ts: t };
  }
  const risk = Math.abs(trade.entry - startSl(trade));
  const dir = long ? 1 : -1;
  const r = (p) => (risk > 0 ? (dir * (p - trade.entry)) / risk : null);
  return { best: { ...best, r: r(best.price) }, worst: { ...worst, r: r(worst.price) } };
}

const EXIT_PHRASE = { TARGET: 'Hit the target', SL: 'Stopped out', EOD: 'Closed at session end' };

// "What happened": the opening range, the breakout, the best and worst moves,
// and the exit, each with its IST time.
export function tradeStory(trade, candles, orbEnd) {
  const events = [];
  const long = trade.side === 'long';
  if (trade.orbHigh != null && candles.length) {
    const width = ((trade.orbHigh - trade.orbLow) / trade.orbLow) * 100;
    events.push({ time: hhmm(candles[0][0]), tone: 'accent', text: `Opening range set by ${orbEnd}: ${price(trade.orbLow)} – ${price(trade.orbHigh)} (${width.toFixed(2)}% wide).` });
  }
  const target = trade.target != null ? `target ${price(trade.target)}` : 'no target';
  const afterEntry = events.length + 1;
  events.push({ time: trade.entryTime, tone: 'accent', text: `Broke ${long ? 'above' : 'below'} the range at ${price(trade.entry)} → ${long ? 'Long' : 'Short'} ${trade.quantity} · SL ${price(startSl(trade))} · ${target}.` });

  const ex = excursions(trade, candles);
  if (ex) {
    const { best, worst } = ex;
    let toTarget = '';
    if (trade.target != null) {
      const reached = long ? best.price >= trade.target : best.price <= trade.target;
      toTarget = reached ? ' — reached the target' : ` — ${price(Math.abs(trade.target - best.price))} short of target`;
    }
    events.push({
      time: hhmm(best.ts),
      tone: best.r > 0 ? 'profit' : 'loss',
      text: `Best move ${price(best.price)} (${rMultiple(best.r)})${toTarget}. Worst ${price(worst.price)} at ${hhmm(worst.ts)} (${rMultiple(worst.r)}).`,
    });
  }
  if (trade.flow === 'trail' && trade.sl !== startSl(trade) && trade.slTime) {
    events.push({ time: trade.slTime, tone: 'accent', text: `Stop trailed from ${price(startSl(trade))} to ${price(trade.sl)}.` });
    // The trail's last move can come before the best move: keep time order
    // after the opening range and the entry.
    const later = events.splice(afterEntry).sort((a, b) => a.time.localeCompare(b.time));
    events.push(...later);
  }
  if (trade.status === 'closed') {
    const r = rOf(trade);
    const phrase = trade.flow === 'trail' && trade.reason === 'SL' ? 'Trailing stop hit' : EXIT_PHRASE[trade.reason] || 'Closed';
    events.push({ time: trade.exitTime, tone: trade.pnl >= 0 ? 'profit' : 'loss', last: true, text: `${phrase}, ${price(trade.exit)} → ${pnl(trade.pnl)} (${rMultiple(r)}).` });
  } else {
    events.push({ time: '', tone: 'accent', last: true, text: 'Still open.' });
  }
  return { events, excursions: ex };
}

// The yellow "Backtest check" line for a row with a mismatch.
export function checkText(m, trade) {
  const bt = m.backtest || {};
  const lv = m.live || {};
  const side = (s) => (s === 'long' ? 'long' : 'short');
  const p = m.problem;
  if (/backtest traded, live did not/.test(p)) {
    return `Live didn’t trade this. The backtest went ${side(bt.side)} at ${price(bt.entry)} (${bt.entryTime || '—'}) and exited at ${price(bt.exit)} (${REASON[bt.reason] || bt.reason || '—'}). No chart: candles load only for paper trades.`;
  }
  if (/live traded, backtest did not/.test(p)) return 'Backtest check: the backtest has no trade for this symbol on this day.';
  if (/^entry/.test(p)) return `Backtest check: entry price differs — backtest entered at ${price(bt.entry)}, live entered at ${price(lv.entry ?? trade?.entry)}. Shown as the dashed circle.`;
  if (/^entry time/.test(p)) return `Backtest check: entry time differs — backtest entered at ${bt.entryTime || '—'}, live at ${lv.entryTime || trade?.entryTime || '—'}.`;
  if (/^exit time/.test(p)) return `Backtest check: exit time differs — backtest exited at ${bt.exitTime || '—'} (${REASON[bt.reason] || bt.reason}), live at ${lv.exitTime || trade?.exitTime || '—'}.`;
  if (/^exit price/.test(p)) return `Backtest check: exit price differs — backtest exited at ${price(bt.exit)}, live exited at ${price(lv.exit ?? trade?.exit)}.`;
  if (/^exit reason/.test(p)) return `Backtest check: exit differs — backtest exited on ${REASON[bt.reason] || bt.reason} at ${price(bt.exit)}, live on ${REASON[lv.reason] || lv.reason} at ${price(lv.exit)}.`;
  if (/^side/.test(p)) return `Backtest check: side differs — backtest went ${side(bt.side)}, live went ${side(lv.side)}.`;
  if (/still open/.test(p)) return 'Backtest check: the trade was still open after the close.';
  return `Backtest check: ${p}.`;
}

// Epoch seconds of an 'HH:MM' IST time on the trade's day.
export function tsOn(trade, time) {
  const m = minutesOf(time);
  const e = minutesOf(trade.entryTime);
  return m == null || e == null ? null : trade.entryTs + (m - e) * 60;
}
