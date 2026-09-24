// Turns a tick stream into 1-minute candles on the same IST boundaries the
// historical data uses, so the opening range computed live matches the backtest.

const { istParts } = require('../src/time');

// Epoch seconds -> the epoch second that starts that IST minute.
function minuteStart(epochSeconds) {
  return epochSeconds - (epochSeconds % 60);
}

class CandleBuilder {
  constructor() {
    this.completed = []; // [[ts,o,h,l,c], ...] for today, oldest first
    this.partial = null; // the candle currently forming
  }

  // Replaces completed candles wholesale. Used by warm start and after a
  // reconnect, where REST is the source of truth rather than the tick stream.
  setCompleted(candles) {
    this.completed = candles.map((c) => [c[0], c[1], c[2], c[3], c[4]]);
    this.partial = null;
  }

  // Returns true when this tick moved the forming candle's high or low, which is
  // the only case where a decision could possibly change.
  addTick(price, epochSeconds) {
    const start = minuteStart(epochSeconds);

    if (!this.partial) {
      this.partial = [start, price, price, price, price];
      return true;
    }

    if (start > this.partial[0]) {
      this.completed.push(this.partial);
      this.partial = [start, price, price, price, price];
      return true;
    }

    // Same minute: extend it.
    this.partial[4] = price;
    if (price > this.partial[2]) { this.partial[2] = price; return true; }
    if (price < this.partial[3]) { this.partial[3] = price; return true; }
    return false;
  }

  // What the engine gets: everything closed so far plus the one still forming.
  candles() {
    return this.partial ? [...this.completed, this.partial] : this.completed;
  }

  lastMinute() {
    const all = this.candles();
    return all.length ? istParts(all[all.length - 1][0]).minute : null;
  }
}

module.exports = { CandleBuilder, minuteStart };
