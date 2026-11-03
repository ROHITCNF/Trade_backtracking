// Records what would have been traded. No orders are placed anywhere.
// broker/fyers.js will implement this same shape once the app is whitelisted.

function createPaperBroker({ onEvent }) {
  return {
    name: 'paper',

    // `flow` ('fixed' | 'trail') is set only when live runs both (M10); a
    // trail entry also carries its starting best price.
    enter(symbol, { flow, side, price, quantity, sl, target, best, time }) {
      onEvent({ kind: 'ENTRY', symbol, ...(flow && { flow }), side, price, quantity, sl, target, ...(best != null && { best }), time });
    },

    exit(symbol, { flow, side, price, quantity, reason, pnl, time }) {
      onEvent({ kind: 'EXIT', symbol, ...(flow && { flow }), side, price, quantity, reason, pnl, time });
    },

    // The trail flow's stop moved (paper only: a real broker would modify the order).
    trail(symbol, { side, sl, best, time }) {
      onEvent({ kind: 'TRAIL', symbol, flow: 'trail', side, sl, best, time });
    },
  };
}

module.exports = { createPaperBroker };
