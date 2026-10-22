import test from 'node:test';
import assert from 'node:assert/strict';
import { marketStatus, msUntilIstMidnight, hoursMinutes } from '../src/lib/ist.js';

const ist = (s) => Date.parse(`${s}+05:30`);

test('market pill follows the IST clock, Mon–Fri 09:15–15:30', () => {
  assert.deepEqual(marketStatus(ist('2026-10-22T14:07:00')), { open: true, label: '14:07 IST' }); // Thu
  assert.deepEqual(marketStatus(ist('2026-10-22T09:15:00')), { open: true, label: '09:15 IST' });
  assert.deepEqual(marketStatus(ist('2026-10-22T09:14:00')), { open: false, label: 'opens 09:15' });
  assert.deepEqual(marketStatus(ist('2026-10-22T15:30:00')), { open: false, label: 'opens Fri 09:15' });
  assert.deepEqual(marketStatus(ist('2026-10-23T16:00:00')), { open: false, label: 'opens Mon 09:15' }); // Fri
  assert.deepEqual(marketStatus(ist('2026-10-24T11:00:00')), { open: false, label: 'opens Mon 09:15' }); // Sat
});

test('countdown to the 00:00 IST reset', () => {
  assert.equal(msUntilIstMidnight(ist('2026-10-22T14:07:00')), (9 * 60 + 53) * 60000);
  assert.equal(hoursMinutes(msUntilIstMidnight(ist('2026-10-22T14:07:00'))), '9 h 53 m');
});
