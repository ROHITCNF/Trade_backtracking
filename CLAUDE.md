# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # one ticker (config.symbol) -> out/report.html
npm run report     # same, then open it
npm run sweep      # compare every profit-target rule on the same candles
node runAll.js 5   # first 5 tickers from _F&O.txt
node runAll.js all # the whole watchlist
```

**Single-ticker is the default working mode.** `config.singleTickerOnly` is `true`, which makes
`runAll.js` refuse to start; the strategy is still being validated on one name before it is worth
looking at others. Leave it alone unless the user asks to open up the watchlist. `runAll.js` also
demands an explicit count — there is no bare invocation — because the watchlist is 207 symbols,
roughly 1,000 chunked API calls and ~600 MB of cache.

`runAll.js` writes one page per ticker (`out/NSE_RVNL_EQ.html`) with a dropdown that navigates
between them. It runs in two passes: the first fetches and backtests to learn which symbols have
usable data, the second writes the pages once the dropdown list is known. The second pass is
network-free because everything is cached by then, and it exists so the dropdown never links to a
page that was never written.

No dependencies and no build step — Node 18+ native `fetch` only. There is no test runner; the engine
is a pure function, so exercise it by requiring `src/engine.js` and feeding it synthetic candle arrays.

## Pipeline

`index.js` wires four stages together, each in its own module and each independently runnable:

1. `src/fetch.js` — pulls candles from Fyers' internal history API and caches them under
   `data/candles/`. Requests are chunked 60 days at a time because intraday history is capped
   per request.
2. `src/engine.js` — pure backtest. Candles + config in, trades out. No network, no disk.
3. `src/metrics.js` — trades in, summary stats + equity curve out.
4. `src/tradeLog.js` — dumps the run to `data/trades/<SYMBOL>.json` and `.csv`.
5. `src/report.js` — injects results as JSON into `src/template.html`, writes `out/report.html`.

## Inspecting a run without the browser

Every run writes `data/trades/<SYMBOL>.json` (config + metrics + trades) and `.csv` (one row per
trade). Day candles are stripped from both — they are 98% of the payload and carry nothing useful
for reading trades. These files are the fastest way to answer questions about a run: read the JSON
or grep the CSV rather than regenerating anything. They are overwritten on each run for that symbol,
so they always reflect the latest config.

The fetch/engine split is deliberate: the Fyers token expires roughly daily, so candles are cached
once and the backtest re-runs offline as many times as you like while tuning parameters.

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

## Credentials

`FYERS_AUTH_TOKEN` and `FYERS_TOKEN_ID` come from `.env` (gitignored, loaded by `src/env.js`).
They expire roughly daily; a 401 during fetch means they need refreshing from a logged-in session.
Never paste them into tracked source files.
