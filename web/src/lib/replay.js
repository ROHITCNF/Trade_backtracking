// Bar replay of a paper trade's day (Live page): what the chart shows with
// only the first `cursor + 1` one-minute candles played. Pure, so it's tested
// without a chart. Nothing from later candles leaks in: the opening range is
// built from the candles shown, the trade's levels appear from the entry
// candle, and a mark appears once its candle is reached.

import { hhmm, rOf } from './liveView.js';

const IST = 19800;
const minuteOf = (ts) => Math.floor(((ts + IST) % 86400) / 60);
const toMinutes = (s) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};

// Index of the candle that contains `ts` (the last one starting at or before
// it), or -1.
export function indexAt(candles, ts) {
  if (ts == null) return -1;
  let at = -1;
  for (let i = 0; i < candles.length && candles[i][0] <= ts; i++) at = i;
  return at;
}

export function replayFrame({ candles, trade, orbEnd, marks = [], cursor }) {
  const i = Math.max(0, Math.min(cursor, candles.length - 1));
  const [time, , , , close] = candles[i];

  const end = toMinutes(orbEnd);
  const inRange = candles.slice(0, i + 1).filter(([t]) => minuteOf(t) < end);
  const orb = inRange.length
    ? {
        from: inRange[0][0],
        to: inRange.at(-1)[0],
        high: Math.max(...inRange.map((c) => c[2])),
        low: Math.min(...inRange.map((c) => c[3])),
      }
    : null;

  const entryAt = indexAt(candles, trade.entryTs);
  const exitAt = trade.exitTs != null ? indexAt(candles, trade.exitTs) : -1;
  const entered = entryAt >= 0 && i >= entryAt;
  const exited = entered && exitAt >= 0 && i >= exitAt;

  let phase = 'waiting';
  let pnl = null;
  let r = null;
  if (!entered) {
    if (minuteOf(time) < end) phase = 'range';
  } else if (!exited) {
    phase = 'open';
    const move = (close - trade.entry) * (trade.side === 'short' ? -1 : 1);
    const risk = Math.abs(trade.entry - trade.sl);
    pnl = Math.round(move * trade.quantity * 100) / 100;
    r = risk ? move / risk : null;
  } else {
    phase = 'closed';
    pnl = trade.pnl;
    r = rOf(trade);
  }

  return {
    cursor: i,
    last: candles.length - 1,
    time,
    clock: hhmm(time),
    close,
    orb,
    levels: entered ? { entry: trade.entry, sl: trade.sl, target: trade.target } : null,
    marks: marks.filter((m) => m.time <= time),
    entryAt,
    phase,
    pnl,
    r,
  };
}
