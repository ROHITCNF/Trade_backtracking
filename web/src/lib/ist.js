// IST wall-clock helpers for the browser. Shifting epoch ms by +5:30 and
// reading the result as UTC gives IST without a timezone library (as
// src/time.js does on the server).

const IST_MS = 5.5 * 3600 * 1000;
const OPEN = 9 * 60 + 15;
const CLOSE = 15 * 60 + 30;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad = (n) => String(n).padStart(2, '0');

export function istParts(now = Date.now()) {
  const d = new Date(now + IST_MS);
  return { weekday: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), hhmm: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` };
}

// NSE Open / Closed from the clock alone: Mon–Fri 09:15–15:30 IST, holidays
// ignored (FR-38, D6). Never asks Fyers.
export function marketStatus(now = Date.now()) {
  const { weekday, minutes, hhmm } = istParts(now);
  const weekdayOpen = weekday >= 1 && weekday <= 5;
  if (weekdayOpen && minutes >= OPEN && minutes < CLOSE) return { open: true, label: `${hhmm} IST` };
  if (weekdayOpen && minutes < OPEN) return { open: false, label: 'opens 09:15' };
  // After the close or at the weekend: name the next trading day.
  let next = (weekday + 1) % 7;
  while (next === 0 || next === 6) next = (next + 1) % 7;
  return { open: false, label: `opens ${DAYS[next]} 09:15` };
}

// Milliseconds until 00:00 IST, when the budget and a 429 pause reset (D9).
export function msUntilIstMidnight(now = Date.now()) {
  const shifted = now + IST_MS;
  const nextMidnight = Math.floor(shifted / 86400000 + 1) * 86400000;
  return nextMidnight - shifted;
}

export function hoursMinutes(ms) {
  const total = Math.max(0, Math.round(ms / 60000));
  return `${Math.floor(total / 60)} h ${total % 60} m`;
}
