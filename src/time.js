// Fyers returns epoch seconds. Indian market runs in IST (UTC+5:30).
// Trick: add the IST offset, then read the timestamp as if it were UTC.
// That gives IST wall-clock values without pulling in a timezone library.

const IST_OFFSET_SECONDS = 5.5 * 3600;

// '09:15' -> 555 (minutes since midnight)
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// epoch seconds -> { date: '2025-01-02', time: '09:15', minute: 555 }
function istParts(epochSeconds) {
  const shifted = new Date((epochSeconds + IST_OFFSET_SECONDS) * 1000);
  const iso = shifted.toISOString();
  return {
    date: iso.slice(0, 10),
    time: iso.slice(11, 16),
    minute: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

// '2025-01-02' -> epoch seconds at 00:00 IST
function dateToEpoch(dateStr) {
  return Date.parse(`${dateStr}T00:00:00Z`) / 1000 - IST_OFFSET_SECONDS;
}

module.exports = { IST_OFFSET_SECONDS, toMinutes, istParts, dateToEpoch };
