// Synthetic candles for engine tests. Times are IST wall-clock; the engine reads
// epoch seconds, so each candle's timestamp is built from the date and 'HH:MM'.

const { dateToEpoch, toMinutes } = require('../src/time');
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

module.exports = { candle, openingRange, config };
