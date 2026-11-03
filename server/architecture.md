# Live runner architecture

Phase 1: **data only**. Nothing is ordered. The runner watches live prices, asks the
existing backtest engine what it would do, and writes that decision to disk. Order
placement needs app whitelisting and comes later.

## The one rule

**`src/engine.js` is the only place strategy logic lives.** The live runner does not
re-implement the opening range, the breakout test, the stop or the target: the engine
decides the entry and sets the levels.

**One exception, by design (D24): once a position is open, live manages it on the
socket's prices.** The first tick at or through the stop or target closes it at that
tick's price; the first tick at `sessionEnd` closes it as EOD. Entries fill at the
breakout tick's price too. A 1-minute backtest can't see the order of prices inside a
candle and assumes the worst; live can see it, so it never re-asks the engine while it
holds (which would also let a whipsaw candle swap a stopped-out long for a short).

**The trail flow (D25) is the second thing live owns.** With `config.trail.enabled`, every
entry also opens a `trail` paper position: same entry and starting stop as the engine's,
no target, and `trail.js` steps the stop with the best price (every `stepPct` % of entry
in favour moves it the same amount, never back). The engine knows nothing about it, and
the backtest can't model it: a trailing stop depends on whether a candle's high came
before its low. The two flows exit independently; the symbol is CLOSED once both are.

## How a tick becomes a decision

```
websocket tick (LTP)
   │
   ▼
candles.js ─ updates the minute candle being formed right now
   │          (and closes it when the IST minute rolls over)
   ▼
session.js, per symbol:
   FLAT    → runBacktest([completed] + [partial])   ← the engine, unmodified
             breakout on this tick? ENTRY at this tick's price, engine's stop/target
   OPEN    → this tick vs the position's own stop / target / sessionEnd → EXIT at this price
             trail: this tick vs its current stop / sessionEnd → EXIT, else a new best
             may step the stop → TRAIL (stop checked before it moves)
   CLOSED  → nothing (one trade a day)
   │
   ▼
broker/paper.js records it        (broker/fyers.js will place it, later)
```

The partial candle's high and low update on every tick, so the engine sees a breakout
the moment price crosses the opening range — not a minute later when the candle closes.
Only ticks that move the partial candle's high or low can be a breakout, so only those
ask the engine; while a position is open, every tick is checked.

## While live is blind

Before launch, during a disconnect, or after a restart, no ticks exist for those
minutes. On warm start, reconnect and the end-of-day refresh, an open position is
checked against the REST candles from the last minute live watched (or its entry
minute): the engine's rules apply there — stop wins a candle that touches both, fills
at the level, EOD at the `sessionEnd` candle's close. A breakout found only in REST
candles fills where the backtest would. A restart restores an open position's levels
from `paper_trades` (or the state file), never from the engine.

The trail does the same with its current stop, then lets the candle's high (low, for a
short) step it. It starts from the minute its stop was last set (`slTime`, saved with
every step), not from the entry: earlier minutes were lived through with an older stop,
and a low that was safe then may sit under today's stop. That minute itself isn't
re-checked against the new stop, since its low may have come before the step.

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
| `trail.js` | the trail flow's stop for a given best price (pure) |
| `broker/paper.js` | records simulated fills and trail stop moves |

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

Reconciliation runs every day after the close and labels each traded symbol:
**match** (same side, entry minute, exit reason and exit minute; the P&L difference is
kept as slippage), **tick order** (the backtest had to guess inside a candle that broke
both range edges or touched both stop and target, and live saw the real order —
expected), or **mismatch** (anything else: a missed breakout, a stop live never saw — a
plumbing problem worth a look).

## What is deliberately not here

- **Order placement.** Phase 3, after paper output matches the backtest for a few weeks.
- **A second strategy implementation.** See the first rule.
- **Anything clever about threading or queues.** One process, one socket, synchronous
  decisions. It has to be debuggable at 09:30 with money on the line.
