import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetLevel, statusSummary } from '../src/lib/status.js';

const me = (fyers = {}, budget = {}) => ({
  fyers: { connected: true, clientName: 'R S', ...fyers },
  budget: { used: 0, cap: 3800, paused: false, ...budget },
});
const closed = { open: false, label: 'opens Fri 09:15' };

test('all good when connected with budget to spare', () => {
  assert.deepEqual(statusSummary(me(), closed), { level: 'ok', title: 'All good', parts: ['Fyers on', 'NSE closed', 'API 0 / 3,800'] });
});

test('disconnected is routine, not a warning', () => {
  const s = statusSummary(me({ connected: false }), { open: true, label: '10:00 IST' });
  assert.equal(s.level, 'idle');
  assert.equal(s.title, 'Connect Fyers');
  assert.deepEqual(s.parts, ['Fyers off', 'NSE open', 'API 0 / 3,800']);
});

test('budget states outrank the connection', () => {
  assert.equal(statusSummary(me({}, { used: 3100 }), closed).title, 'Budget low');
  assert.equal(statusSummary(me({ connected: false }, { used: 3800 }), closed).title, 'Budget used');
  assert.equal(statusSummary(me({}, { used: 12, paused: true }), closed).level, 'error');
  assert.equal(statusSummary(me({}, { used: 12, paused: true }), closed).title, 'Paused');
});

test('loading shows only the clock fact', () => {
  assert.deepEqual(statusSummary(null, closed), { level: 'idle', title: 'Checking…', parts: ['NSE closed'] });
});

test('budget meter level', () => {
  assert.equal(budgetLevel({ used: 100, cap: 3800, paused: false }), 'grey');
  assert.equal(budgetLevel({ used: 3040, cap: 3800, paused: false }), 'amber');
  assert.equal(budgetLevel({ used: 3800, cap: 3800, paused: false }), 'red');
  assert.equal(budgetLevel({ used: 0, cap: 3800, paused: true }), 'red');
});
