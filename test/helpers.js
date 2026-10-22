// Synthetic candles for engine tests. Times are IST wall-clock; the engine reads
// epoch seconds, so each candle's timestamp is built from the date and 'HH:MM'.

const { dateToEpoch, toMinutes, IST_OFFSET_SECONDS } = require('../src/time');
const { round } = require('../src/util');
const baseConfig = require('../config');

// candle('2026-01-05', '09:15', o, h, l, c) -> [ts, o, h, l, c, volume]
function candle(date, time, o, h, l, c) {
  return [dateToEpoch(date) + toMinutes(time) * 60, o, h, l, c, 1000];
}

// A flat opening range 09:15–09:29 with high 101 and low 99 (range 2).
function openingRange(date, { high = 101, low = 99 } = {}) {
  const mid = (high + low) / 2;
  const out = [];
  for (let m = toMinutes('09:15'); m < toMinutes('09:30'); m++) {
    const t = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    out.push(candle(date, t, mid, m === toMinutes('09:15') ? high : mid, m === toMinutes('09:16') ? low : mid, mid));
  }
  return out;
}

// Fixed sizing keeps P&L arithmetic obvious; zero costs keep it exact.
const config = (overrides = {}) => ({
  ...baseConfig,
  direction: 'both',
  sizing: 'fixed',
  quantity: 1,
  costBps: 0,
  slMode: 'pct',
  slPct: 1,
  targetMode: 'R',
  targetR: 1,
  orbStart: '09:15',
  orbEnd: '09:30',
  sessionEnd: '15:14',
  ...overrides,
});

// Deterministic random walk: 09:15–15:29 one-minute candles on weekdays, with
// overnight gaps, prices to 2 decimals, so trades hit every exit reason, both
// sides, gap fills and odd-paise rounding.
function walk(seed, start, days, from = '2026-01-05') {
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const out = [];
  let price = start;
  for (let d = 0, day = dateToEpoch(from); d < days; day += 86400) {
    const weekday = new Date((day + IST_OFFSET_SECONDS) * 1000).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    d++;
    price *= 1 + (rand() - 0.5) * 0.03;
    const vol = price * (0.0005 + rand() * 0.002);
    for (let m = 9 * 60 + 15; m < 15 * 60 + 30; m++) {
      const o = round(price);
      const c = round(o + (rand() - 0.5) * 2 * vol);
      const h = round(Math.max(o, c) + rand() * vol);
      const l = round(Math.min(o, c) - rand() * vol);
      out.push([day + m * 60, o, h, l, c, 1000]);
      price = c;
    }
  }
  return out;
}

module.exports = { candle, openingRange, config, walk };
