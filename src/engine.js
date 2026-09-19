// Opening Range Breakout backtest. Pure — no network, no disk.
// Give it candles + config, it gives back one trade per day (or none).

const { toMinutes, istParts } = require('./time');

const round = (n) => Math.round(n * 100) / 100;

// [[ts,o,h,l,c,v], ...] -> Map<'2025-01-02', [{t,o,h,l,c,minute,time}, ...]>
function groupByDay(rawCandles) {
  const days = new Map();
  for (const [t, o, h, l, c] of rawCandles) {
    const { date, time, minute } = istParts(t);
    if (!days.has(date)) days.set(date, []);
    days.get(date).push({ t, o, h, l, c, time, minute });
  }
  for (const list of days.values()) list.sort((a, b) => a.t - b.t);
  return days;
}

function openingRange(candles, config) {
  const start = toMinutes(config.orbStart);
  const end = toMinutes(config.orbEnd);
  const inRange = candles.filter((c) => c.minute >= start && c.minute < end);
  if (inRange.length === 0) return null;
  return {
    high: Math.max(...inRange.map((c) => c.h)),
    low: Math.min(...inRange.map((c) => c.l)),
  };
}

// Did this candle break out? Returns the entry side, or null.
function breakoutSide(candle, orb, direction) {
  const wantsLong = direction === 'long' || direction === 'both';
  const wantsShort = direction === 'short' || direction === 'both';
  const brokeHigh = wantsLong && candle.h >= orb.high;
  const brokeLow = wantsShort && candle.l <= orb.low;

  // One bar breaking both edges gives no way to tell which side triggered first,
  // so we take nothing and wait for a clean break.
  if (brokeHigh && brokeLow) return null;
  if (brokeHigh) return 'long';
  if (brokeLow) return 'short';
  return null;
}

// Stop placement. A long's stop sits below entry and a short's above it, so the
// price closer to entry is the tighter stop in both cases — hence max for longs
// and min for shorts when picking the tighter of two candidates.
function computeStop(side, entry, orb, config) {
  const rangeStop = side === 'long' ? orb.low : orb.high;
  const distance = entry * (config.slPct / 100);
  const pctStop = side === 'long' ? entry - distance : entry + distance;

  switch (config.slMode) {
    case 'range':
      return rangeStop;
    case 'pct':
      return pctStop;
    // Closer to entry of the two: risk is capped at slPct, and comes in under it
    // whenever the opening range is narrower than slPct.
    case 'tighter':
      return side === 'long' ? Math.max(rangeStop, pctStop) : Math.min(rangeStop, pctStop);
    // Further from entry of the two: risk is at least slPct, and grows past it
    // whenever the opening range is wider than slPct.
    case 'wider':
      return side === 'long' ? Math.min(rangeStop, pctStop) : Math.max(rangeStop, pctStop);
    default:
      throw new Error(`Unknown slMode: "${config.slMode}"`);
  }
}

// Target is measured off risk (the stop distance), not off a fixed percentage,
// so it widens on volatile days and tightens on quiet ones. See config.targetMode.
function computeTarget(side, entry, sl, config) {
  if (config.targetMode === 'none') return null;

  const distance =
    config.targetMode === 'pct'
      ? entry * (config.targetPct / 100)
      : Math.abs(entry - sl) * config.targetR;

  return side === 'long' ? entry + distance : entry - distance;
}

// A candle can touch both stop and target. We assume the stop hit first —
// pessimistic, but it stops the backtest from inventing an edge that isn't there.
function checkExit(candle, position) {
  if (position.side === 'long') {
    if (candle.l <= position.sl) return { price: position.sl, reason: 'SL' };
    if (position.target !== null && candle.h >= position.target) {
      return { price: position.target, reason: 'TARGET' };
    }
  } else {
    if (candle.h >= position.sl) return { price: position.sl, reason: 'SL' };
    if (position.target !== null && candle.l <= position.target) {
      return { price: position.target, reason: 'TARGET' };
    }
  }
  return null;
}

function simulateDay(date, candles, config) {
  const orb = openingRange(candles, config);
  if (!orb) return null;

  const entryFrom = toMinutes(config.orbEnd);
  const exitBy = toMinutes(config.sessionEnd);
  const tradable = candles.filter((c) => c.minute >= entryFrom && c.minute <= exitBy);
  if (tradable.length === 0) return null;

  let position = null;

  for (const candle of tradable) {
    if (!position) {
      const side = breakoutSide(candle, orb, config.direction);
      if (!side) continue;

      // A gap through the level fills at the open, not at the level itself.
      const entry =
        side === 'long' ? Math.max(orb.high, candle.o) : Math.min(orb.low, candle.o);

      const sl = computeStop(side, entry, orb, config);

      position = {
        side,
        entry,
        sl,
        target: computeTarget(side, entry, sl, config),
        entryTime: candle.time,
        entryTs: candle.t,
      };
    }

    // The entry candle itself can hit the stop or target, so check it too.
    const exit = checkExit(candle, position);
    if (exit) {
      return buildTrade({ date, orb, position, exitPrice: exit.price, reason: exit.reason, candle, config, candles });
    }
  }

  if (!position) return null;

  const last = tradable[tradable.length - 1];
  return buildTrade({ date, orb, position, exitPrice: last.c, reason: 'EOD', candle: last, config, candles });
}

function buildTrade({ date, orb, position, exitPrice, reason, candle, config, candles }) {
  const sign = position.side === 'long' ? 1 : -1;
  const gross = (exitPrice - position.entry) * sign * config.quantity;
  const cost = ((position.entry + exitPrice) * config.quantity * config.costBps) / 10000;
  const pnl = gross - cost;
  const risk = Math.abs(position.entry - position.sl) * config.quantity;

  return {
    date,
    side: position.side,
    orbHigh: round(orb.high),
    orbLow: round(orb.low),
    entryTime: position.entryTime,
    entryTs: position.entryTs,
    entry: round(position.entry),
    sl: round(position.sl),
    target: position.target === null ? null : round(position.target),
    exitTime: candle.time,
    exitTs: candle.t,
    exit: round(exitPrice),
    reason,
    pnl: round(pnl),
    pnlPct: round((pnl / (position.entry * config.quantity)) * 100),
    rMultiple: risk > 0 ? round(pnl / risk) : 0,
    // Kept so the report can draw this day's chart on click.
    candles: candles.map((c) => [c.t, c.o, c.h, c.l, c.c]),
  };
}

function runBacktest(rawCandles, config) {
  const trades = [];
  for (const [date, dayCandles] of groupByDay(rawCandles)) {
    const trade = simulateDay(date, dayCandles, config);
    if (trade) trades.push(trade);
  }
  return trades.sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = { runBacktest, groupByDay, openingRange };
