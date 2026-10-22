# Intent

> Status: **frozen** for v1 (2026-10-22). Change only by deliberate revision.

Why the web app exists, and what it is meant to fix. For what gets built see
[spec.md](spec.md); for how, see [hld.md](hld.md).

## Background

backtestV2 backtests an Opening Range Breakout (ORB) strategy on NSE stocks using 1-minute
candles from the Fyers API. It is a set of Node scripts: edit `config.js`, run `npm start`,
`npm run sweep`, `runAll.js` or `summary.js`, and open the HTML file it writes to `out/`.
A paper live runner (`server/`) runs the same engine on live ticks.

The engine is sound and deliberately pessimistic. The problems are everything around it.

## Problem

1. **Every experiment is a code edit.** Changing the date range, stop rule or target means
   editing `config.js` and re-running from a terminal. Nothing records what was tried.
2. **Results don't survive.** `out/*.html` and `data/trades/<SYMBOL>.json` are overwritten on
   the next run for that symbol. There is no history of runs and no way to say "this
   setting beat that one" without re-running both.
3. **Comparing is manual.** `sweep.js` compares target rules for one symbol and prints a
   console table. Comparing two stop rules across a watchlist means two runs, two pages, and
   reading numbers side by side by eye.
4. **Analysis is shallow.** Reports show per-symbol stats and an equity curve. Questions like
   "do shorts work?", "is Monday worse?", "do late entries lose?" or "which month hurt?" need
   a fresh script each time.
5. **Tied to one laptop.** The tool, its outputs and the Fyers login all live on one
   machine. Nothing can be looked at from anywhere else.
6. **Daily login is a terminal ritual.** The Fyers token dies every morning at 06:30;
   `npm run login` has to be run by hand before anything works.

## Solution

A private, deployed web app for one user (the owner) that wraps the existing engine:

- **Launch backtests from a form.** Pick dates, symbols and strategy settings in the browser.
  The server fetches candles from Fyers under the same rate-limit discipline and runs the
  unchanged engine.
- **Keep every run.** Each run's settings, per-symbol results and trades are stored in
  Postgres, so runs can be reopened, filtered and compared at any time.
- **Analyse in one place.** A dashboard of pooled stats, equity curve and breakdowns by
  symbol, side, month, weekday, entry time and exit reason, all filterable. Clicking any
  trade draws that day's chart.
- **Compare runs and target rules** side by side, replacing the console sweep.
- **Log in from the browser.** A password protects the app; a "Connect Fyers" button replaces
  `npm run login`.

## Principles

- **The engine stays the single source of truth.** `src/engine.js` and `src/metrics.js` are
  reused, not rewritten. Web results must match CLI results trade for trade.
- **Honest modelling is not negotiable.** Gap fills at the open, stop wins ties, entry
  candle checked for exits, ambiguous bars skipped. The UI must not invite optimism either:
  show sample sizes and concentration warnings.
- **The Fyers account must never be blocked.** Three per-minute breaches in a day block the
  account. Every call stays behind one throttle, and the UI shows the cost of a run before
  it starts.
- **Small and debuggable.** One user, one server process, one database. No queues,
  caches or services that a single person doesn't need.

## Non-goals (v1)

- Live trading, the live runner, or order placement.
- Storing candles. They are re-fetched from Fyers when needed.
- Multiple users, sign-up or sharing.
- Strategies other than ORB (see `research/emavwap.md` for one that was parked).

## Success looks like

- A year-long backtest over the `core` list can be started from a phone and its results
  reopened a week later.
- Two settings can be compared across a whole watchlist in under a minute of clicking.
- Web and CLI produce identical trades for the same inputs.
- The Fyers account is never rate-blocked by the app.
