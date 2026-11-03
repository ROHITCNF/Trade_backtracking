const test = require('node:test');
const assert = require('node:assert/strict');
const { trailStop } = require('../server/trail');

const long = { side: 'long', entry: 1672, initialSl: 1655.28, stepPct: 0.5 };
const short = { side: 'short', entry: 1672, initialSl: 1688.72, stepPct: 0.5 };

test('long: one full step lifts the stop by 0.5% of entry', () => {
  assert.equal(trailStop({ ...long, best: 1680.36 }), 1663.64);
});

test('long: two full steps (exact multiple counts)', () => {
  assert.equal(trailStop({ ...long, best: 1688.72 }), 1672);
});

test('long: short of a full step leaves the starting stop', () => {
  assert.equal(trailStop({ ...long, best: 1679 }), 1655.28);
});

test('long: best below entry (adverse) never moves the stop below its start', () => {
  assert.equal(trailStop({ ...long, best: 1660 }), 1655.28);
  assert.equal(trailStop({ ...long, best: 1672 }), 1655.28);
});

test('long: partial steps beyond a multiple round down', () => {
  assert.equal(trailStop({ ...long, best: 1688.7 }), 1663.64);
});

test('short: one full step lowers the stop by 0.5% of entry', () => {
  assert.equal(trailStop({ ...short, best: 1663.64 }), 1680.36);
});

test('short: two full steps (exact multiple counts)', () => {
  assert.equal(trailStop({ ...short, best: 1655.28 }), 1672);
});

test('short: short of a full step, and adverse best, leave the starting stop', () => {
  assert.equal(trailStop({ ...short, best: 1665 }), 1688.72);
  assert.equal(trailStop({ ...short, best: 1680 }), 1688.72);
});

test('no move-back: a pullback after a high best keeps the stop where best put it', () => {
  // best only ratchets; the session passes the best-so-far, never the last price.
  const stepped = trailStop({ ...long, best: 1688.72 });
  assert.equal(trailStop({ ...long, best: 1688.72 }), stepped);
  assert.ok(trailStop({ ...long, best: 1700 }) >= stepped);
  assert.ok(trailStop({ ...short, best: 1640 }) <= trailStop({ ...short, best: 1655.28 }));
});

test('float error does not cost an exact step', () => {
  // entry 100, step 0.5: best 100.5 is exactly one step
  assert.equal(trailStop({ side: 'long', entry: 100, initialSl: 99, best: 100.5, stepPct: 0.5 }), 99.5);
  assert.equal(trailStop({ side: 'short', entry: 100, initialSl: 101, best: 99.5, stepPct: 0.5 }), 100.5);
});
