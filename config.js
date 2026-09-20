// All knobs live here. Change these, re-run `npm start`.

module.exports = {
  // --- What to backtest ---
  symbol: "NSE:PAGEIND-EQ",
  fromDate: "2020-01-01",
  toDate: "2026-09-18",

  // Blocks runAll.js so only `symbol` above is ever tested. Keep this true while
  // validating the strategy on one name; flip it to false to open up _F&O.txt.
  singleTickerOnly: false,

  // --- Strategy ---
  // 'long' | 'short' | 'both'. With 'both', the first clean break decides the side.
  // A candle that breaks the range high AND low in the same bar is ambiguous, so it
  // is skipped and the next candle is checked. One trade per day either way.
  direction: "both",

  // Position size.
  //   'entryPrice' -> capitalPerTrade of margin at `leverage`, priced off each
  //                   trade's own entry. Every trade risks a comparable rupee
  //                   amount, so one expensive stock can't dominate the totals.
  //   'ltp'        -> same maths, but priced off today's last traded price from
  //                   the quotes API. This is the size you would place right now;
  //                   applying it to months-old trades misstates them.
  //   'fixed'      -> plain `quantity` shares, ignoring price.
  sizing: "entryPrice",
  capitalPerTrade: 200000, // rupees of margin per trade
  leverage: 5, // broker margin multiple, so 10k controls 50k of stock
  quantity: 1, // only used when sizing is 'fixed'

  // Where the stop sits. Two candidates exist on every trade: slPct % from entry,
  // and the opposite edge of the opening range.
  //   'pct'     -> always the slPct stop. Fixed risk, ignores range width.
  //   'range'   -> always the range edge. The classic ORB stop; risk varies daily.
  //   'tighter' -> whichever is closer to entry. Risk capped at slPct.
  //   'wider'   -> whichever is further from entry. Risk at least slPct.
  slMode: "tighter",
  slPct: 1,

  // How the profit target is set:
  //   'R'    -> targetR x risk, where risk = orbHigh - orbLow (the stop distance).
  //             targetR: 1 projects the full opening range from the breakout.
  //   'pct'  -> targetPct % of entry price. Ignores range width, so it does not
  //             adapt to volatility — kept only for comparison.
  //   'none' -> no target at all. Exit on stop or at sessionEnd.
  // Run `npm run sweep` to compare these on your own data.
  targetMode: "pct",
  targetR: 1, // only used when targetMode is 'R'
  targetPct: 2,

  // Opening range window. orbEnd is exclusive, so 09:15-09:29 = first 15 one-min candles.
  orbStart: "09:15",
  orbEnd: "09:30",

  // Entry allowed from orbEnd. Any open position is closed at sessionEnd.
  sessionEnd: "15:14",

  // Round-trip cost in basis points (10 = 0.1%). Set 0 to see raw edge.
  costBps: 0,

  // --- Data ---
  resolution: "1", // minutes per candle
};
