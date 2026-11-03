---
name: engine-rules
description: The rules that keep ORB backtest and live results honest. Load before changing or reviewing src/engine.js, src/targets.js, src/metrics.js, server/session.js, server/candles.js, api/reconcile.js or anything that decides entries, stops, targets, exits or P&L.
---

# Engine rules

`src/engine.js` is a **pure function**: candles + config in, trades out. No network, disk,
clock or Fyers. Biome enforces the imports (`biome.json` overrides); you keep the rest
pure, which means no `Date.now()`, no `process.env` and no randomness.

It is the **only** place entry rules and levels live. `server/session.js` asks it for the
entry and levels and never re-implements the opening range, the breakout test, the stop or
the target (`server/architecture.md` § The one rule). The single exception is D24: once a
live position is open, live manages it on tick prices.

## The four modelling choices (never weaken)

| Rule | Where | Why |
|---|---|---|
| **Gap fills**: long entry = `max(orbHigh, candle.open)`, short = `min(orbLow, candle.open)` | entry | A gap through the level can't fill at the level. |
| **Stop wins ties**: a candle spanning both stop and target exits at the stop | exits | Optimistic tie-breaking invents edge. |
| **The entry candle is checked for exits** | exits | A wide breakout candle can stop out at once. |
| **Ambiguous bars are skipped**: a candle breaking both edges takes no side; the next candle is checked | entry | Otherwise `direction: 'both'` quietly favours longs. |

Plus:
- **One trade per day**, no re-entry after an exit.
- Opening range = 09:15–09:29 IST (`orbStart` inclusive, `orbEnd` exclusive). Entries from `orbEnd`.
- Open positions close at `sessionEnd` as `EOD`.
- **Stop-mode asymmetry is deliberate.** In `computeStop`, "closer to entry" is `Math.max` for longs and `Math.min` for shorts. Don't "fix" it.

## Time

All IST handling goes through `src/time.js` (`+19800` shift, read as UTC). Compare sessions
as minutes since midnight (`toMinutes('09:15') === 555`). Never use local-time getters
(`getHours()`, `toLocaleString()` without a time zone) or `new Date()` for market time
outside `src/time.js`. The machine's zone is not IST.

## Sanity checks for any engine change

1. **Add a test** in `test/engine.test.js` with synthetic candles from `test/helpers.js`
   (`candle`, `openingRange`, `walk`). Pin the exact entry, stop, target, exit and reason.
2. **1R == 1%** when `slMode: 'pct'` and `slPct: 1`: a `targetMode: 'R', targetR: 1` run and a
   `targetMode: 'pct', targetPct: 1` run must produce identical trades.
3. **Parity**: `test/parity.test.js` (stored trades equal engine output) must still pass with
   `TEST_DATABASE_URL` set. CI runs it.
4. For live changes: `test/liveSession.test.js` and `test/reconcile.test.js`. Reconcile compares
   a day's paper trades with a backtest of that day, so drift between them is a bug, not noise.

## Escalate, don't decide

Changing any of the four modelling choices, the tie rule, sizing or costs changes every past
result. Stop and ask the owner. If they agree, record a D-number in `docs/decisions.md` (`/decision`).
