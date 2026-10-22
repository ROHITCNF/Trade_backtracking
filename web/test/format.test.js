import test from 'node:test';
import assert from 'node:assert/strict';
import { rupees, pnl, price, rMultiple, pctReturn, rate, profitFactor, qty, dateShort, dateLong, tone } from '../src/lib/format.js';

const M = '−';

test('rupees use Indian grouping and no decimals', () => {
  assert.equal(rupees(123456), '₹1,23,456');
  assert.equal(rupees(10000), '₹10,000');
  assert.equal(rupees(49999.6), '₹50,000');
});

test('P&L always carries a sign, with a true minus; zero is unsigned', () => {
  assert.equal(pnl(11344), '+₹11,344');
  assert.equal(pnl(-1331), `${M}₹1,331`);
  assert.equal(pnl(0), '₹0');
  assert.equal(pnl(-0.3), '₹0');
  assert.equal(pnl(2246200), '+₹22,46,200');
});

test('prices, R, returns, rates, PF, quantities', () => {
  assert.equal(price(1094.94), '1,094.94');
  assert.equal(price(15234.5), '15,234.50');
  assert.equal(rMultiple(1.48), '+1.48R');
  assert.equal(rMultiple(-1.03), `${M}1.03R`);
  assert.equal(rMultiple(0), '0.00R');
  assert.equal(pctReturn(0.52), '+0.52%');
  assert.equal(pctReturn(-0.8), `${M}0.80%`);
  assert.equal(rate(52.73), '52.7%');
  assert.equal(profitFactor(1.743), '1.74');
  assert.equal(profitFactor(null), '∞');
  assert.equal(qty(124500), '1,24,500');
  assert.equal(pnl(undefined), '—');
});

test('dates: short in tables, long in panel headers', () => {
  assert.equal(dateShort('2025-10-23'), '23 Oct 25');
  assert.equal(dateLong('2025-10-23'), 'Thu, 23 Oct 2025');
});

test('tone colours only meaningful signs', () => {
  assert.equal(tone(1), 'profit');
  assert.equal(tone(-1), 'loss');
  assert.equal(tone(0.001), 'flat');
  assert.equal(tone(null), 'flat');
});
