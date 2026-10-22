// One formatter per kind of number, used everywhere (design system § Number
// formatting). en-IN grouping (1,23,456); signed values use a true minus
// (U+2212), never a hyphen; zero is neutral and unsigned.

const MINUS = '−';

const grouped = (digits) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const int = grouped(0);
const two = grouped(2);

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const DASH = '—';

// Sign prefix for a signed value: '+', '−' or '' for zero.
const sign = (n) => (n > 0 ? '+' : n < 0 ? MINUS : '');

// ₹1,23,456 — unsigned amounts (capital, notional). No decimals.
export function rupees(n) {
  if (!isNum(n)) return DASH;
  return `${n < 0 ? MINUS : ''}₹${int.format(Math.abs(Math.round(n)))}`;
}

// +₹11,344 / −₹1,331 / ₹0 — P&L always carries its sign.
export function pnl(n) {
  if (!isNum(n)) return DASH;
  const r = Math.round(n);
  return `${sign(r)}₹${int.format(Math.abs(r))}`;
}

// 1,094.94 — prices: two decimals, Indian grouping, no ₹ in price columns.
export function price(n) {
  return isNum(n) ? two.format(n) : DASH;
}

// +1.48R / −1.03R — R multiples, two decimals, net of costs.
export function rMultiple(n) {
  if (!isNum(n)) return DASH;
  const v = Math.abs(n).toFixed(2);
  return `${v === '0.00' ? '' : sign(n)}${v}R`;
}

// +0.52% — a return, signed, two decimals.
export function pctReturn(n) {
  if (!isNum(n)) return DASH;
  const v = Math.abs(n).toFixed(2);
  return `${v === '0.00' ? '' : sign(n)}${v}%`;
}

// 52.7% — a rate (win %, share), unsigned, one decimal.
export function rate(n) {
  return isNum(n) ? `${n.toFixed(1)}%` : DASH;
}

// 1.74 / ∞ — profit factor; computeMetrics returns null when nothing lost (D12).
export function profitFactor(n) {
  if (n === null) return '∞';
  return isNum(n) ? n.toFixed(2) : DASH;
}

// 42 / 1,24,500 — quantities and counts.
export function qty(n) {
  return isNum(n) ? int.format(n) : DASH;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const parts = (ymd) => ymd.split('-').map(Number);

// '2025-10-23' -> '23 Oct 25' (tables)
export function dateShort(ymd) {
  if (!ymd) return DASH;
  const [y, m, d] = parts(ymd);
  return `${d} ${MONTHS[m - 1]} ${String(y).slice(2)}`;
}

// '2025-10-23' -> 'Thu, 23 Oct 2025' (panel headers). Trading dates are IST
// calendar dates, so the weekday is computed on the date itself, not a clock.
export function dateLong(ymd) {
  if (!ymd) return DASH;
  const [y, m, d] = parts(ymd);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAYS[wd]}, ${d} ${MONTHS[m - 1]} ${y}`;
}

// 'profit' | 'loss' | 'flat' — the class that colours a signed number.
export function tone(n) {
  if (!isNum(n) || Math.round(n * 100) === 0) return 'flat';
  return n > 0 ? 'profit' : 'loss';
}

const IST_MS = 5.5 * 3600 * 1000;
const pad2 = (n) => String(n).padStart(2, '0');

// ISO timestamp -> '14:07' or '14:07:42' in IST.
export function istTime(iso, withSeconds = false) {
  if (!iso) return DASH;
  const d = new Date(new Date(iso).getTime() + IST_MS);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}${withSeconds ? `:${pad2(d.getUTCSeconds())}` : ''}`;
}

// ISO timestamp -> '21 Oct 2026, 18:42' in IST.
export function istDateTime(iso) {
  if (!iso) return DASH;
  const d = new Date(new Date(iso).getTime() + IST_MS);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${istTime(iso)}`;
}

// 347 s -> '5m 47s'; 4000 s -> '1h 6m'.
export function duration(seconds) {
  if (!isNum(seconds) || seconds < 0) return DASH;
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad2(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
