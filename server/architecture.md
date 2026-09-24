# Live runner architecture

Phase 1: **data only**. Nothing is ordered. The runner watches live prices, asks the
existing backtest engine what it would do, and writes that decision to disk. Order
placement needs app whitelisting and comes later.

## The one rule

**`src/engine.js` is the only place strategy logic lives.** The live runner does not
re-implement the opening range, the breakout test, the stop or the target. If live and
backtest ever disagree about what a trade should be, that is a bug in the plumbing here,
never a second opinion about the strategy.

## How a tick becomes a decision

```
websocket tick (LTP)
   │
   ▼
candles.js ─ updates the minute candle being formed right now
   │          (and closes it when the IST minute rolls over)
   ▼
[today's completed candles] + [the partial candle]
   │
   ▼
runBacktest(candles, config)      ← the backtest engine, unmodified
   │
   ▼
live.js reads the result as a desired state
   │
   ▼
broker/paper.js records it        (broker/fyers.js will place it, later)
```

The partial candle's high and low update on every tick, so the engine sees a breakout
the moment price crosses the opening range — not a minute later when the candle closes.
That keeps live entries close to the backtest's fill assumption, and it means there is
exactly one code path.

## Reading the engine's output as a live position

`runBacktest` returns a finished trade or nothing. It has no concept of "still open", so
the runner derives that from the exit reason and the clock:

| engine returns | last candle before `sessionEnd`? | live meaning |
|---|---|---|
| nothing | — | flat, no breakout yet |
| trade, reason `SL` / `TARGET` | — | position closed, done for the day |
| trade, reason `EOD` | yes | **position is open right now** at that entry |
| trade, reason `EOD` | no | closed at the session end |

That table is the whole translation layer. No engine changes were needed for it.

## Files

| file | job |
|---|---|
| `auth.js` | OAuth two-step, caches the token in `data/live/token.json` |
| `callback.js` | localhost server that catches the redirect and grabs `auth_code` |
| `login.js` | CLI that runs the login once a day |
| `candles.js` | ticks → IST-aligned 1-minute candles |
| `warmstart.js` | REST backfill of today's candles, on launch and after a reconnect |
| `feed.js` | `fyersDataSocket` wrapper, auto-reconnect |
| `state.js` | writes decisions and positions to `data/live/`, survives a restart |
| `live.js` | the loop that ties the above together |
| `broker/paper.js` | records simulated fills |

## Why each awkward bit exists

**Warm start.** Connecting at 09:17 means the 09:15 and 09:16 candles were never seen,
so the opening range would be wrong for the whole day. `warmstart.js` pulls today's
candles over REST before the socket takes over, and again after any reconnect.

**Candles come from REST, not ticks, wherever possible.** A tick stream only samples
price; the true high of a minute can fall between two ticks. Completed candles are
therefore taken from `getHistory`, and ticks only ever build the one candle currently
forming.

**The engine only re-runs when the partial candle's high or low actually moves.** Most
ticks change neither. This is a large saving over 39 symbols and it is deterministic —
a tick that cannot change the outcome cannot trigger a decision.

**State is on disk.** A dropped socket or a laptop sleeping must not produce a second
entry on a symbol already held. `live.js` restores from `data/live/state.json` first and
only then starts the feed.

## Rate limits — the one that ends the day

```
10/sec · 200/min · 100,000/day
breaching the per-minute cap 3 times in one day blocks the account until tomorrow
```

Never poll `getQuotes`. Live prices come from the websocket only. REST is used for warm
start and reconnect backfill, nothing else. That is 39 calls at launch, spaced, and the
data socket allows 5,000 symbols per connection so all 39 share one.

## Auth

`APP_ID:ACCESS_TOKEN` authenticates both REST and the websocket. The access token dies at
the end of each trading day, so `npm run login` is a morning ritual. A refresh-token flow
exists but the vendor documents it as possibly being withdrawn, so daily login is treated
as the reliable path.

## What is deliberately not here

- **Order placement.** Phase 3, after paper output matches the backtest for a few weeks.
- **A second strategy implementation.** See the first rule.
- **Anything clever about threading or queues.** One process, one socket, synchronous
  decisions. It has to be debuggable at 09:30 with money on the line.
