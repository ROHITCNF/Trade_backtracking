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
| `../src/fyers.js` | OAuth client + REST throttle, caches the token in `data/token.json` |
| `login.js` | daily OAuth login; catches the redirect on localhost to grab `auth_code` |
| `candles.js` | ticks → IST-aligned 1-minute candles |
| `warmstart.js` | REST backfill of today's candles, on launch and after a reconnect |
| `feed.js` | `fyersDataSocket` wrapper, auto-reconnect |
| `state.js` | file state store: decisions and positions in `data/live/`, survives a restart |
| `session.js` | one day's loop that ties the above together, as `start()` / `stop()`; state goes through an injected store |
| `live.js` | terminal host for `session.js` with the file store (`npm run live`) |
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

**State is persisted.** A dropped socket or a laptop sleeping must not produce a second
entry on a symbol already held. `session.js` restores from its store first and only then
starts the feed. `npm run live` uses the file store (`data/live/state-<date>.json`); a web
host, whose disk does not survive a restart, passes a Postgres store of the same shape
(`{ load, save, logDecision }`).

## Rate limits — the one that ends the day

```
Data APIs (history): 5/sec · 50/min · 5,000/day   (Standard plan)
breaching the per-minute cap 3 times in one day blocks the account until tomorrow
```

Never poll `getQuotes`. Live prices come from the websocket only. REST is used for warm
start and reconnect backfill, nothing else. That is 39 calls at launch, spaced, and the
Standard data socket allows 100 symbols so all 39 share one.

Every REST call goes through `rest()` in `src/fyers.js`, which spaces calls ≥1.3 s apart
(≤46/min) and stops at 4,800/day. The clock and count live in `data/rest-usage.json` behind a
lock, so the live runner and a backtest share one budget. Warm start's 39 calls take ~50 s,
and a large backtest running alongside slows it further. After any 429, every process
refuses REST for the day — delete the file to resume once the window has reset.

## Auth

`APP_ID:ACCESS_TOKEN` authenticates both REST and the websocket. The access token dies at
the end of each trading day, so `npm run login` is a morning ritual. A refresh-token flow
exists but the vendor documents it as possibly being withdrawn, so daily login is treated
as the reliable path.

## Hosting inside the API

`npm run live` is one host for `session.js`; the web API is the other. The deployed
API runs on Render's free tier, which has no background workers or cron and wipes its
disk on restart, so:

| piece | file | job |
|---|---|---|
| scheduler | `api/live.js` | every 30 s: on a weekday from 09:10 IST to `sessionEnd` + 5 min, with a Fyers token and a non-empty watchlist, start a session; afterwards `refresh()` (EOD exits) and `stop()` |
| state store | `api/db/liveStore.js` | `live_state`, `live_decisions`, `paper_trades` in Postgres, same `{ load, save, logDecision }` shape as `state.js` |
| reconcile | `api/reconcile.js` | once per day after the close: backtest the day on REST candles and diff it against `paper_trades`; on a day with no session, backfill it |
| routes | `api/routes/live.js` | status, paper trades, decisions, per-trade candles, manual reconcile |

An external pinger on `/api/health` keeps the instance awake through market hours
(docs/deploy.md § Live paper trading). The scheduler is off unless `LIVE_ENABLED=true`.

Reconciliation is "the one rule" made into a test that runs every day: paper fills come
from the engine, so live and backtest must agree to the paisa. A mismatch is a plumbing
bug here, never a second opinion about the strategy.

## What is deliberately not here

- **Order placement.** Phase 3, after paper output matches the backtest for a few weeks.
- **A second strategy implementation.** See the first rule.
- **Anything clever about threading or queues.** One process, one socket, synchronous
  decisions. It has to be debuggable at 09:30 with money on the line.
