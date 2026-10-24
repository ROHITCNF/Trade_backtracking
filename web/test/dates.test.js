import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, addMonths, daysBetween, earliestFrom, defaultTo, lastTradingDay, rangeFor, istToday } from '../src/lib/dates.js';

const ist = (s) => Date.parse(`${s}+05:30`);

test('date arithmetic stays on calendar dates', () => {
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
  assert.equal(addMonths('2026-10-22', -12), '2025-10-22');
  assert.equal(daysBetween('2025-10-23', '2026-10-21'), 364);
  assert.equal(istToday(ist('2026-10-22T23:30:00')), '2026-10-22');
});

test('defaults: To is yesterday while the session can still trade', () => {
  assert.equal(defaultTo(ist('2026-10-22T14:07:00')), '2026-10-21');
  assert.equal(defaultTo(ist('2026-10-22T16:00:00')), '2026-10-22');
  assert.equal(defaultTo(ist('2026-10-24T10:00:00')), '2026-10-24'); // Saturday
});

test('last trading day skips the weekend', () => {
  assert.equal(lastTradingDay('2026-10-22'), '2026-10-21'); // Thursday -> Wednesday
  assert.equal(lastTradingDay('2026-10-26'), '2026-10-23'); // Monday -> Friday
  assert.equal(lastTradingDay('2026-10-25'), '2026-10-23'); // Sunday -> Friday
});

test('range shortcuts clamp to one year back', () => {
  assert.equal(earliestFrom('2026-10-22'), '2025-10-22');
  assert.deepEqual(rangeFor(12, '2026-10-21', '2026-10-22'), { fromDate: '2025-10-22', toDate: '2026-10-21' });
  assert.deepEqual(rangeFor(3, '2026-10-21', '2026-10-22'), { fromDate: '2026-07-21', toDate: '2026-10-21' });
});
