# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run login                # once a day: Fyers OAuth, saves data/token.json
npm start                    # one ticker (config.symbol) -> out/report.html
npm run report               # same, then open it
npm run sweep                # compare every profit-target rule on the same candles
node runAll.js 5             # first 5 tickers from lists/fno.txt, one page each
node runAll.js all final.txt # every ticker in lists/final.txt  (npm run final)
npm run core                 # summary.js over lists/core.txt -> out/summary.html
npm run live                 # live paper runner (see server/architecture.md)
npm run today                # print today's live decision log
npm test                     # node --test over test/*.test.js
npm run api                  # web API + run worker (api/), needs DATABASE_URL
npm run migrate              # apply api/db/migrations to DATABASE_URL
npm run web                  # React frontend (web/, Vite) on :5173; `npm --prefix web test` for its tests
```

`runAll.js` and `summary.js` demand an explicit count (`5`, `all`) and take an optional list name
from `lists/`. There is no bare invocation, because `fno.txt` is 207 symbols — about 1,400 API
calls (~30 minutes at 50/min) for a year of 1-minute data.

`runAll.js` writes one page per ticker (`out/NSE_RVNL_EQ.html`) as each finishes, then writes
`out/tickers.js`, which those pages load for their dropdown, so the dropdown only ever names pages
that exist. `summary.js` writes one page with a row per symbol and pooled totals, no day charts.

One dependency (`fyers-api-v3`), no build step, Node 18+. `npm test` runs `node --test` over
`test/*.test.js` (built-in runner, no extra deps). The engine is a pure function, so tests feed it
synthetic candles built with `test/helpers.js`; add a test there when changing engine behaviour.

## Pipeline

`src/run.js` (`backtestSymbol`, `runList`) wires the stages together for every entry script:

1. `src/fetch.js` — pulls candles from Fyers' history API via the SDK, 60 days per request. **No
   cache**: every run fetches fresh, so every run needs today's token. All REST goes through
   `rest()` in `src/fyers.js`, which spaces calls ≥1.3 s apart to stay under the Standard plan's
   Data API cap of 50/min (three breaches in a day block the account, live runner included) and
   stops at 4,800 of the 5,000/day. Clock and count live in `data/rest-usage.json`, shared across
   processes; after any 429 every process refuses REST for the rest of the day.
2. `src/engine.js` — pure backtest. Candles + config in, trades out. No network, no disk.
3. `src/metrics.js` — trades in, summary stats + equity curve out.
4. `src/tradeLog.js` — dumps the run to `data/trades/<SYMBOL>.json` and `.csv`.
5. `src/report.js` — injects results as JSON into `src/template.html`, writes `out/report.html`.

Shared helpers: `src/time.js` (IST handling, `istToday`), `src/util.js` (`round`, `shortSymbol`),
`src/tickers.js` (reads `lists/*.txt`).

## Inspecting a run without the browser

Every run writes `data/trades/<SYMBOL>.json` (config + metrics + trades) and `.csv` (one row per
trade). Day candles are stripped from both — they are 98% of the payload and carry nothing useful
for reading trades. These files are the fastest way to answer questions about a run: read the JSON
or grep the CSV rather than regenerating anything. They are overwritten on each run for that symbol,
so they always reflect the latest config.

`config.js` holds every tunable knob. Prefer changing it over hardcoding values elsewhere.

## Strategy (Opening Range Breakout)

Per trading day, on 1-minute candles:
- Opening range = high/low across 09:15–09:29 IST (`orbStart` inclusive, `orbEnd` exclusive).
- From 09:30, the first candle whose high crosses the range high goes long (or low crosses the range
  low goes short, depending on `direction`). One trade per day, max — no re-entry after an exit.
- A single candle that breaks both edges is ambiguous (OHLC can't say which came first), so it is
  skipped and the next candle is checked.
- Stop is set by `slMode`. Every trade has two candidate stops — `slPct`% from entry, and the
  opposite edge of the opening range — and the mode picks between them: `'pct'` always takes the
  percentage one, `'range'` always the range edge, `'tighter'` whichever is closer to entry (risk
  capped at `slPct`), `'wider'` whichever is further (risk floored at `slPct`). A long's stop sits
  below entry and a short's above it, so "closer to entry" is `Math.max` for longs and `Math.min`
  for shorts — the asymmetry in `computeStop` is deliberate, not a bug.
- Target is set by `targetMode`: `'R'` is `targetR` × stop distance, `'pct'` is `targetPct`% of
  entry, `'none'` means stop-or-close only. When `slMode` is `'pct'`, R and % coincide — a `1R`
  target and a `fixed 1%` target produce identical trades, which is a useful engine sanity check.
- Open positions close at `sessionEnd`, booked as an `EOD` exit.

`npm run sweep` re-runs the same candles across every target rule and prints a comparison table.
Entries and stops are identical across rows; only the target varies.

Four modelling choices keep results honest — preserve them when editing the engine:
- **Gap fills**: entry is `max(orbHigh, candle.open)` for longs, so a gap through the level fills at
  the open rather than at an unreachable level price.
- **Stop wins ties**: when one candle's range spans both stop and target, the stop is assumed hit
  first. Optimistic tie-breaking is the classic way a backtest invents an edge that doesn't exist.
- **The entry candle is checked for exits too**, since a wide breakout candle can stop out immediately.
- **Ambiguous bars are skipped rather than assigned a side**, so `direction: 'both'` doesn't quietly
  favour longs just because they're tested first.

## Time handling

Fyers returns epoch seconds. `src/time.js` shifts by the IST offset and reads the result as UTC,
which yields IST wall-clock values without a timezone dependency. The same `+19800` shift is applied
in the report so Lightweight Charts' UTC axis displays IST. Sessions are compared as minutes since
midnight (`toMinutes('09:15')` → 555).

## Report

`out/report.html` is standalone — stats cards, equity curve, return histogram, and a sortable trade
table. Clicking a row draws that day's candles with the opening range, entry, stop and target marked,
which is the fastest way to sanity-check why a given trade behaved as it did. Each trade therefore
carries its day's candles in the JSON payload; that's what makes the file large, and it's intentional.

Charts come from Lightweight Charts v4 via CDN — the v5 series API is different, so keep the pinned
version in sync with the `addCandlestickSeries` / `addAreaSeries` calls in the template.

## Live runner

`server/` runs the same `runBacktest` on live websocket ticks and records paper decisions to
`data/live/`. It places no orders. `src/engine.js` stays the only place strategy logic lives; see
`server/architecture.md` before touching it.

## Credentials

`FYERS_APP_ID`, `FYERS_SECRET_ID` and `FYERS_REDIRECT_URI` live in `.env` (gitignored, loaded by
`src/env.js`; see `.env.example`). `npm run login` exchanges them for an access token saved to
`data/token.json`, valid until Fyers expires it at 06:30 IST the next morning. "No Fyers token for today" means run it
again. Never paste credentials or tokens into tracked source files.
