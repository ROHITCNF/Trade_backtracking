// Records what would have been traded. No orders are placed anywhere.
// broker/fyers.js will implement this same shape once the app is whitelisted.

function createPaperBroker({ onEvent }) {
  return {
    name: 'paper',

    enter(symbol, { side, price, quantity, sl, target, time }) {
      onEvent({ kind: 'ENTRY', symbol, side, price, quantity, sl, target, time });
    },

    exit(symbol, { side, price, quantity, reason, pnl, time }) {
      onEvent({ kind: 'EXIT', symbol, side, price, quantity, reason, pnl, time });
    },
  };
}

module.exports = { createPaperBroker };
