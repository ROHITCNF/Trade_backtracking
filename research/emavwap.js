// EMA20 / VWAP pullback — research script. READ ONLY.
//
//   node research/emavwap.js
//
// Reproduces every number in emavwap.md. Touches no project code: it fetches
// 5-minute candles itself and computes its own indicators, so the ORB engine
// and the live runner are unaffected by anything here. Needs today's Fyers
// token (`npm run login`).

require('../src/env').loadEnv();
const { getCandles } = require('../src/fetch');
const { istParts, toMinutes } = require('../src/time');

const SYMBOLS = ['LAURUSLABS', 'PAYTM', 'CDSL', 'ITC', 'INFY', 'LODHA', 'VEDL', 'NBCC'];
const FROM = '2026-01-01';
const TO = '2026-09-23';

const SESSION_START = toMinutes('09:15');
const NO_NEW_TRADES_AFTER = toMinutes('13:00');
const SESSION_END = toMinutes('15:14');

// symbol -> Map<date, bars>, filled once by main() before any report runs.
const DAYS = new Map();
const loadDays = (symbol) => DAYS.get(symbol) || null;

async function fetchDays(symbol) {
  const candles = await getCandles({ symbol: `NSE:${symbol}-EQ`, resolution: '5', fromDate: FROM, toDate: TO });
  const days = new Map();
  for (const [t, o, h, l, c, v] of candles) {
    const { date, minute } = istParts(t);
    if (minute < SESSION_START) continue;
    if (!days.has(date)) days.set(date, []);
    days.get(date).push({ t, o, h, l, c, v, min: minute });
  }
  for (const bars of days.values()) bars.sort((a, b) => a.t - b.t);
  return days;
}

// WARNING: this resets the EMA daily, which is NOT what TradingView does — its
// "EMA 20 close" runs continuously across sessions while "VWAP Session" resets.
// Results from this function overstate the gap filter badly; see the correction in
// emavwap.md. Kept as-is to document what was measured. Carry the EMA across days
// before drawing any new conclusion.
function annotate(bars, period = 20) {
  const k = 2 / (period + 1);
  let ema = null;
  let pv = 0;
  let vol = 0;

  return bars.map((b) => {
    ema = ema === null ? b.c : b.c * k + ema * (1 - k);
    const typical = (b.h + b.l + b.c) / 3;
    pv += typical * b.v;
    vol += b.v;
    const vwap = vol ? pv / vol : b.c;
    return { ...b, ema, vwap, gapPct: ((ema - vwap) / vwap) * 100 };
  });
}

// Maximum favourable / adverse excursion from entry to the session close.
function excursion(bars, fromIndex, side, entry) {
  let mfe = 0;
  let mae = 0;
  for (let i = fromIndex; i < bars.length && bars[i].min <= SESSION_END; i++) {
    const b = bars[i];
    const favourable = side === 'long' ? b.h - entry : entry - b.l;
    const adverse = side === 'long' ? entry - b.l : b.h - entry;
    if (favourable > mfe) mfe = favourable;
    if (adverse > mae) mae = adverse;
  }
  const last = bars.filter((b) => b.min <= SESSION_END).pop();
  return {
    mfePct: (mfe / entry) * 100,
    maePct: (mae / entry) * 100,
    eodPct: ((side === 'long' ? last.c - entry : entry - last.c) / entry) * 100,
  };
}

// entryMode 'cross'    -> enter at the crossover bar's close
// entryMode 'pullback' -> wait for price to come back and straddle the EMA
// minGap               -> EMA must separate this far (%) from VWAP to count as a
//                         real cross rather than the two lines hugging
function collect(symbol, { entryMode, minGap = 0, confirmBars = 0, minExtend = 0.15 }) {
  const days = loadDays(symbol);
  if (!days) return [];
  const out = [];

  for (const [date, rawBars] of days) {
    const bars = annotate(rawBars);
    let taken = false;

    for (let i = 20; i < bars.length && !taken; i++) {
      const prev = bars[i - 1];
      const cur = bars[i];
      const crossed = prev.ema > prev.vwap !== cur.ema > cur.vwap;
      if (!crossed || cur.min > NO_NEW_TRADES_AFTER) continue;

      const side = cur.ema > cur.vwap ? 'long' : 'short';

      // Wait for the lines to actually separate before believing the cross.
      let confirmAt = i;
      if (minGap > 0) {
        confirmAt = null;
        for (let j = i; j <= i + confirmBars && j < bars.length; j++) {
          if (bars[j].min > NO_NEW_TRADES_AFTER) break;
          const stillSide = bars[j].ema > bars[j].vwap === (side === 'long');
          if (Math.abs(bars[j].gapPct) >= minGap && stillSide) { confirmAt = j; break; }
        }
        if (confirmAt === null) continue;
      }

      if (entryMode === 'cross') {
        out.push({ date, side, ...excursion(bars, confirmAt, side, bars[confirmAt].c) });
        taken = true;
        continue;
      }

      // Pullback: price must extend away, then return to touch the EMA.
      let maxExtend = 0;
      for (let j = confirmAt + 1; j <= confirmAt + 12 && j < bars.length; j++) {
        const b = bars[j];
        if (b.min > NO_NEW_TRADES_AFTER) break;
        if (b.ema > b.vwap !== (side === 'long')) break; // re-crossed, setup dead

        const extend = side === 'long' ? ((b.h - b.ema) / b.ema) * 100 : ((b.ema - b.l) / b.ema) * 100;
        if (extend > maxExtend) maxExtend = extend;
        if (maxExtend < minExtend) continue;
        if (!(b.l <= b.ema && b.ema <= b.h)) continue;

        out.push({ date, side, ...excursion(bars, j, side, b.ema) });
        taken = true;
        break;
      }
    }
  }
  return out;
}

const quantile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(p * (sorted.length - 1))];
};

function report(label, opts) {
  const all = SYMBOLS.flatMap((s) => collect(s, opts));
  if (all.length < 15) {
    console.log(label.padEnd(46), `only ${all.length} setups — too few to judge`);
    return;
  }
  const mfe = all.map((x) => x.mfePct);
  const mae = all.map((x) => x.maePct);
  const eod = all.map((x) => x.eodPct);
  const edge = quantile(mfe, 0.5) - quantile(mae, 0.5);
  const eodMean = eod.reduce((a, b) => a + b, 0) / eod.length;

  console.log(
    label.padEnd(46),
    String(all.length).padStart(4),
    quantile(mfe, 0.5).toFixed(2).padStart(7),
    quantile(mae, 0.5).toFixed(2).padStart(7),
    ((edge >= 0 ? '+' : '') + edge.toFixed(2)).padStart(7),
    ((eodMean >= 0 ? '+' : '') + eodMean.toFixed(3)).padStart(8)
  );
}

async function main() {
  const missing = [];
  for (const symbol of SYMBOLS) {
    try {
      DAYS.set(symbol, await fetchDays(symbol));
    } catch (err) {
      missing.push(symbol);
      console.log(`  ${symbol}: ${err.message}`);
    }
  }
  if (missing.length === SYMBOLS.length) throw new Error('No symbol could be fetched.');

  console.log(`\nEMA20 / VWAP — ${SYMBOLS.length} symbols, ${FROM} to ${TO}`);
  console.log('"edge" = median MFE minus median MAE. Must be clearly positive to matter.\n');
  console.log('setup'.padEnd(46), '   n  MFEp50  MAEp50    edge  EODmean');
  console.log('-'.repeat(84));

  report('CROSSOVER entry, no gap filter', { entryMode: 'cross' });
  report('CROSSOVER entry, gap>=0.10% within 3 bars', { entryMode: 'cross', minGap: 0.1, confirmBars: 3 });
  report('CROSSOVER entry, gap>=0.20% within 5 bars', { entryMode: 'cross', minGap: 0.2, confirmBars: 5 });
  report('CROSSOVER entry, gap>=0.30% within 8 bars', { entryMode: 'cross', minGap: 0.3, confirmBars: 8 });
  console.log('');
  report('PULLBACK entry, no gap filter', { entryMode: 'pullback' });
  report('PULLBACK entry, gap>=0.10% within 3 bars', { entryMode: 'pullback', minGap: 0.1, confirmBars: 3 });
  report('PULLBACK entry, gap>=0.20% within 5 bars', { entryMode: 'pullback', minGap: 0.2, confirmBars: 5 });
  report('PULLBACK entry, gap>=0.30% within 8 bars', { entryMode: 'pullback', minGap: 0.3, confirmBars: 8 });

  console.log('\nSee emavwap.md for what these numbers mean and what to do next.\n');
}

main().catch((err) => {
  console.error('\n' + err.message);
  process.exit(1);
});
