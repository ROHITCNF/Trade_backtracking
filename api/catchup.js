// Closes paper trades that a sleeping instance left open (#161). The live
// session closes everything at sessionEnd (D27), but only while the process
// that hosts it is awake; one that wakes after the close never ran the
// session, so nothing else would ever close them.
//
// Every row still 'open' whose day is over (any earlier date, or today from
// sessionEnd) is booked EOD at the close of its symbol's last candle before
// sessionEnd, the price at 15:10:00. The minutes the instance slept through are
// not replayed: a stop or target hit in them is not booked (owner's choice, D27).
//
// Safe to run any number of times, from any process: a row is closed only
// while it is still open, and only that update writes its decision.

const baseConfig = require('../config');
const { getCandles: fetchCandles } = require('../src/fetch');
const { withTransaction } = require('./db/pool');
const { istParts, toMinutes } = require('../src/time');
const { round } = require('../src/util');
const { pnlOf } = require('../server/session');

const hhmm = (minute) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

// The close of the last candle before sessionEnd, and its minute, or null.
function closeBefore(candles, sessionEndMin) {
  let last = null;
  for (const c of candles) {
    const minute = istParts(c[0]).minute;
    if (minute < sessionEndMin && (!last || minute >= last.minute)) last = { price: c[4], minute };
  }
  return last;
}

async function closeStaleTrades({ pool, config = baseConfig, getCandles = fetchCandles, now = () => Date.now(), log = () => {} }) {
  const sessionEndMin = toMinutes(config.sessionEnd);
  const { date: today, minute } = istParts(Math.floor(now() / 1000));
  const { rows } = await pool.query(
    `select date::text as date, symbol, flow, side, entry, quantity from paper_trades
     where status = 'open' and (date < $1 or (date = $1 and $2))
     order by date, symbol, flow`,
    [today, minute >= sessionEndMin]
  );

  const groups = new Map();
  for (const r of rows) {
    const key = `${r.date}|${r.symbol}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  let closed = 0;
  let left = 0;
  for (const trades of groups.values()) {
    const { date, symbol } = trades[0];
    let close;
    try {
      close = closeBefore(await getCandles({ symbol, resolution: '1', fromDate: date, toDate: date }), sessionEndMin);
    } catch (err) {
      log(`catch-up: ${symbol} ${date} left open, candles failed: ${err.message}`);
      left += trades.length;
      continue;
    }
    if (!close) {
      log(`catch-up: ${symbol} ${date} left open, no candle before ${config.sessionEnd}`);
      left += trades.length;
      continue;
    }

    const price = round(close.price);
    const time = hhmm(close.minute);
    closed += await withTransaction(pool, async (client) => {
      let n = 0;
      for (const t of trades) {
        const position = { side: t.side, entry: Number(t.entry), quantity: Number(t.quantity) };
        const pnl = pnlOf(position, price, config);
        const updated = await client.query(
          `update paper_trades set status = 'closed', exit_time = $4, exit = $5, reason = 'EOD', pnl = $6, updated_at = now()
           where date = $1 and symbol = $2 and flow = $3 and status = 'open'`,
          [date, symbol, t.flow, time, price, pnl]
        );
        if (!updated.rowCount) continue; // another process got there first
        n++;
        const event = { kind: 'EXIT', symbol, flow: t.flow, side: t.side, price, quantity: position.quantity, reason: 'EOD', pnl, time, catchUp: true };
        await client.query('insert into live_decisions (date, symbol, kind, payload) values ($1, $2, $3, $4)', [date, symbol, 'EXIT', JSON.stringify(event)]);
      }
      await client.query(
        `update live_state set position = 'CLOSED', updated_at = now() where date = $1 and symbol = $2 and position is distinct from 'CLOSED'`,
        [date, symbol]
      );
      return n;
    });
    log(`catch-up: closed ${symbol} ${date} EOD at ${price} (${time})`);
  }
  return { closed, left };
}

module.exports = { closeStaleTrades, closeBefore };
