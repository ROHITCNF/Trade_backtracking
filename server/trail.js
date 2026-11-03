// The trail flow's stop (M10, D25). Live only: the backtest has no trailing
// stop, because 1-minute candles can't say whether a candle's high came before
// or after its low, and a trailing stop depends on exactly that order.
//
// The stop starts where the fixed flow's does. For every full `stepPct`% of
// entry that the best price has moved in the trade's favour, it moves the same
// amount in the same direction. `best` only ever improves, so the stop never
// moves back.
//
//   long 1672, stop 1655.28, step 0.5%: best 1680.36 -> 1663.64, 1688.72 -> 1672

const { round } = require('../src/util');

// Float error would turn an exact multiple (8.36 / 1672 * 100 = 0.5) into
// 0.49999…, so a step counts once the move is within this of it.
const EPS = 1e-9;

function trailStop({ side, entry, initialSl, best, stepPct }) {
  const long = side === 'long';
  const movePct = ((long ? best - entry : entry - best) / entry) * 100;
  const steps = Math.max(0, Math.floor(movePct / stepPct + EPS));
  const shift = (steps * stepPct * entry) / 100;
  return round(long ? initialSl + shift : initialSl - shift);
}

// The better of the best price so far and a new price, for this side.
const improve = (side, best, price) => (side === 'long' ? Math.max(best, price) : Math.min(best, price));

module.exports = { trailStop, improve };
