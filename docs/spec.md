# Spec — v1 web app

> Status: **frozen** for v1 (2026-10-22). Change only by deliberate revision.
> Revision v1.1 (2026-10-22): watchlists, charts and the design review — see
> [decisions.md](decisions.md).

> Revision v2 (2026-10-29): the UI follows [design/reference/v2/](design/reference/v2/) —
> Journal · Research · Live, frontend only. See [decisions.md](decisions.md) D14–D21; the
> screens and flows below that v2 removes (Dashboard, launcher, Runs, Compare, sweep,
> Watchlists) are superseded, the functional rules behind them still apply.

What v1 is. Why: [intent.md](intent.md). How: [hld.md](hld.md).

## Scope

**In v1:** app login, Fyers connect, backtest launcher, run progress, run history, run
dashboard, ticker detail, trade detail chart, run comparison, target sweep, watchlists
with `.txt` import/export.

**UI source of truth:** the screens in [design/reference/](design/reference/). Where they
disagree with this spec, [decisions.md](decisions.md) says which one wins.

**Not in v1:** live runner / paper view, order placement, candle storage, multiple users,
non-ORB strategies, Fyers Prime-only features.

## Glossary

| term | meaning |
|---|---|
| Run | One backtest job: a settings snapshot, a date range, a symbol set, and its results |
| Settings | The strategy knobs from `config.js` (direction, stop, target, sizing, ORB window, session end, costs) |
| Watchlist | A named, editable symbol list stored in the app; seeded from `lists/` — `core` (39), `final` (17), `fno` (207, read-only) |
| Sweep | A group of runs on the same symbols and dates that differ only in target rule |
| R | P&L as a multiple of the risk taken (entry-to-stop distance × qty) |
| Data budget | Fyers Standard plan Data API cap: 50/min, 5,000/day; the app stops at 4,800 |

## Fyers constraints the product must respect

| constraint | product consequence |
|---|---|
| Standard plan: 1-minute history only for the **last 1 year** | Date picker blocks start dates older than today − 1 year |
| History API: ≤100 days per request (app uses 60) | Cost of a run = symbols × ceil(days / 60) calls |
| Data APIs: 50/min, 5,000/day; 3 per-minute breaches = account blocked for the day | All calls spaced ≥1.3 s; app-wide daily cap 4,800; any 429 pauses data calls until the next IST day |
| Access token expires daily at 06:30 IST | Fyers must be reconnected every trading day after 06:30; runs and charts need it, browsing stored results does not |
| Rate limits are per Fyers account, not per app | The local CLI and the deployed app spend one budget (see § Local CLI) |
| Trading/User-info APIs have a separate, larger budget (200/min) | Profile lookup for the header is free of data-budget cost |

## UX flows

### F1. First-time setup (once)

1. Owner sets env vars on Render (see hld.md § Configuration), including a password hash.
2. Owner sets the Fyers app redirect URI to `https://<api>/auth/fyers/callback` on the Fyers
   dashboard.
3. Owner opens the app → login screen.

### F2. Log in to the app (≈ every 7 days)

1. Open app → no valid session → login screen.
2. Enter password → submit.
3. Correct → land on Dashboard (latest run, or empty state). Wrong → inline error, no detail
   about why.

### F3. Morning: connect Fyers (every trading day)

1. Header shows **Fyers: not connected today**, with a **Connect Fyers** button.
2. Click → browser goes to Fyers login (Fyers' own page, its own PIN/TOTP).
3. Fyers redirects back to the API callback → token stored → browser returns to the app.
4. Header shows **Fyers: connected · <client name>**.
5. Failure (cancelled, state mismatch, exchange error) → back to the app with an error
   toast; header stays disconnected.

### F4. Run a backtest

1. **New backtest** → form prefilled with the latest run's settings (`config.js` defaults
   when there are no runs).
2. Choose date range, then symbols (a watchlist, or a searchable multi-select), then adjust
   settings.
3. The form shows a live estimate: calls, approximate duration, share of today's remaining
   budget.
4. **Start** → run queued → Run progress screen.
5. Progress shows the current symbol, done/total, elapsed/ETA and a per-symbol log
   (trades and P&L, or skipped / failed with reason).
6. On completion → Run dashboard. The owner may leave mid-run; the run keeps going and the
   Runs list shows its status.

Start is disabled when: Fyers not connected, estimate exceeds remaining budget, data calls
paused after a 429, or the form is invalid.

### F5. Run a sweep

Same as F4 with **Sweep targets** on. Creates one run per target variant (none, 0.5R, 1R,
1.5R, 2R, 3R, 1%, 2%, 2.5%) in one sweep group. Candles are fetched **once** per symbol and
reused across variants, so a sweep costs the same calls as one run. Opens the Compare
screen when done.

### F6. Analyse a run

Run dashboard → filters (side, exit reason, date sub-range, symbols) update every card,
chart and table → click a symbol row → Ticker detail → click a trade → Trade detail.

### F7. Inspect a trade

Trade detail opens as a panel. Trade numbers show immediately; the day's 1-minute chart
loads from Fyers (1 call). Previous/next trade navigation. If Fyers is not connected or
data calls are paused, the chart area says so and the numbers remain.

### F8. Compare

Runs list → select 2–4 runs → Compare. Or open a sweep group. Shows a settings diff, stats
per run, overlaid equity curves and per-symbol results per run.

### F9. Manage runs

From Runs list: rename, duplicate as a new run (opens the form prefilled), cancel a queued
or running run, resume a failed run, delete a finished run (with confirmation; deletes its
trades).

### F10. Manage watchlists

Watchlists screen → list of watchlists on the left (name, source, symbol count) → select
one → its symbols with company name, the latest run's trades / win % / P&L for each
symbol, and the date added. From there:

- **New** watchlist (name, optional description).
- **Add a symbol** through the same search as the launcher.
- **Remove** a symbol.
- **Backtest this list** → New backtest with this watchlist selected.
- **Export .txt** → one `NSE:XXX-EQ` per line.
- **Delete** the watchlist, with confirmation. Past runs keep their own symbol snapshot.

The F&O watchlist is read-only: no add, remove, import or delete.

### F11. Import a .txt

1. **Import .txt** on a watchlist → pick a file (one symbol per line or comma-separated;
   `PAYTM` or `NSE:PAYTM-EQ`).
2. Preview: counts of **will be added**, **already in list** and **not recognised**; chips
   for the symbols; skipped lines listed with line number and reason (not found, or an
   index rather than a stock).
3. Choose **Add to this list**, **Replace list** or **New watchlist** → confirm.
   Nothing is saved before confirming.

## Functional requirements

### Auth

- **FR-1** The app has exactly one user. Login is by password only; there is no sign-up or
  reset flow (reset = change the env var).
- **FR-2** Every API route except `/api/login`, `/api/health` and the Fyers callback requires
  a valid session. Invalid or expired session → 401 → login screen.
- **FR-3** Sessions last 7 days. Logout ends the session in this browser.
- **FR-4** Repeated failed logins are slowed (e.g. 5 attempts per 15 min per IP).

### Fyers connection

- **FR-5** Connect Fyers uses the OAuth redirect flow with a one-time `state` value,
  verified on callback.
- **FR-6** The access token is stored encrypted with its expiry (the next 06:30 IST after
  it was issued) and treated as invalid after it.
- **FR-7** The header shows connection status and the Fyers client name (from Profile).
- **FR-8** The header shows data budget used today (`count / 4,800`) and a paused state
  after a 429. Both reset at 00:00 IST.

### Launcher

- **FR-9** Inputs: from/to date (with 1Y / 6M / 3M / 1M shortcuts); symbols (a watchlist or
  an explicit set, at least 1); direction; ORB
  start/end; session end; stop mode and SL %; target mode and R or %; sizing mode with
  capital, leverage or fixed qty; cost bps; sweep toggle; optional run name.
- **FR-10** Validation: from ≤ to; from ≥ today − 1 year; to ≤ today; ORB start < ORB end <
  session end; SL % > 0; target value > 0 unless mode is none; capital, leverage, qty > 0.
- **FR-11** Symbol search uses the Fyers symbol master (NSE equities), showing ticker and
  company name.
- **FR-12** The cost estimate is shown before start and blocks start when it exceeds the
  remaining daily budget.

### Runs

- **FR-13** A run stores a full settings snapshot. Later changes to defaults never alter
  past runs.
- **FR-14** Status lifecycle: `queued → running → done | failed | cancelled`.
- **FR-15** Runs execute one at a time, in order of creation.
- **FR-16** A symbol that produces no trades is recorded as `skipped`; one whose fetch still
  fails after retries is recorded as `failed`. Both carry a reason, and the run continues.
  Transient errors (timeout, network, HTTP 5xx) retry twice; a 429 never retries.
- **FR-17** A run interrupted by a server restart resumes from its first unfinished symbol.
  A failed run can be resumed by hand (e.g. the next day after a budget stop).
- **FR-18** Results for a symbol (trades and per-symbol stats) are saved as soon as that
  symbol finishes.
- **FR-19** Cancel stops the run after the current symbol; finished symbols are kept.
- **FR-19a** A run records the Fyers calls it used and when each symbol finished.

### Dashboard and analysis

- **FR-20** Run stats are those of `computeMetrics`: trades, wins, losses, win rate, total
  P&L, avg win, avg loss, expectancy, profit factor, avg R, max drawdown, best/worst
  trade, exits by reason, equity curve.
- **FR-21** Portfolio stats (as in `summary.js`): profitable symbols / total, median
  symbol P&L, top symbol's share of total P&L, best and worst symbol. Pooled across trades,
  never an average of per-symbol averages.
- **FR-22** Breakdowns: P&L % histogram, P&L by month, by weekday, by entry-time bucket,
  by exit reason, long vs short.
- **FR-23** Per-symbol table: trades, win %, total P&L, expectancy, PF, avg R, avg
  win/loss, max DD, best/worst, qty range, avg notional, exits. Sortable and searchable.
- **FR-24** Filters (side, exit reason, date sub-range, symbols) recompute every number on
  the screen.
- **FR-25** Trade table columns: date, side, entry time, entry, SL, target, exit time,
  exit, reason, qty, P&L ₹, P&L %, R.
- **FR-26** Export the filtered trades of a run as CSV, using the same columns as
  `src/tradeLog.js`.
- **FR-27** The UI warns on small samples (fewer than 30 trades in the current view) and
  on concentration (top symbol > 50% of total P&L).

### Trade chart

- **FR-28** The trade chart shows the day's 1-minute candles (09:15–15:30 IST), the opening
  range as a band, lines for entry, SL and target, and entry/exit markers.
- **FR-29** Candles are fetched from Fyers on demand (1 call) and not persisted.

### Charts

- **FR-28a** The trade candle chart uses TradingView Lightweight Charts v5. Every other chart
  (equity + drawdown, bar breakdowns, histogram, exit split, sparklines, compare and sweep
  overlays) uses Apache ECharts.

### Compare

- **FR-30** Compare 2–4 runs: settings diff, stats per run, overlaid equity curves,
  per-symbol P&L per run.
- **FR-31** Sweep view: one row per target rule — trades, win %, P&L, expectancy, avg R,
  PF, max DD, exits — with best expectancy highlighted and a small-sample note. The note
  that % targets equal R targets appears only when the stop mode is `pct`.

### Watchlists

- **FR-32** Watchlists are stored in the app, seeded once from `lists/*.txt`. The F&O
  watchlist is read-only.
- **FR-33** Create, rename, delete a watchlist; add and remove symbols. Symbols are
  validated against the Fyers NSE symbol master and stored as `NSE:XXX-EQ`; duplicates
  are ignored.
- **FR-34** `.txt` import accepts one symbol per line or comma-separated, bare (`PAYTM`) or
  full (`NSE:PAYTM-EQ`). A preview shows will-be-added, already-in-list and not-recognised
  counts, with skipped lines by line number and reason. Modes: add, replace, new watchlist.
  Nothing is written until confirmed. Max 500 lines per file.
- **FR-35** Export writes one full symbol per line.
- **FR-36** Each watchlist symbol shows trades, win % and P&L from the latest finished run
  that included it, or "not in run".
- **FR-37** Runs snapshot their symbols. Editing or deleting a watchlist never changes past
  runs.

### Header and display

- **FR-38** The market pill (NSE Open / Closed) is computed from the clock — Mon–Fri,
  09:15–15:30 IST — and never calls Fyers. Holidays are ignored in v1.
- **FR-39** Profit factor with no losing P&L is shown as `∞`. Signed P&L always carries a
  sign; ₹ uses Indian digit grouping (see the design system reference).
- **FR-40** Light theme by default; dark theme from the same tokens.

## Non-functional requirements

### Correctness

- **NFR-1** The web path calls the same `runBacktest` and `computeMetrics` as the CLI. For the
  same symbols, dates and settings, trades are identical field for field. A parity check
  (CLI JSON vs DB trades) gates release.
- **NFR-2** All dates and times are IST. Stored timestamps are epoch seconds; trading dates
  are `YYYY-MM-DD` IST strings.
- **NFR-3** Money is shown in ₹ with Indian digit grouping; numbers rounded to 2 dp as the
  engine does.

### Rate-limit safety

- **NFR-4** No Fyers data call bypasses the shared throttle: ≥1.3 s spacing, 4,800/day cap,
  global pause after any 429 until the next IST day (or manual reset).
- **NFR-5** Throttle state is in the database, so restarts and any CLI using the same
  database share one budget.
- **NFR-6** No polling of Fyers quotes or history to refresh UI state.

### Security

- **NFR-7** HTTPS only. The Fyers secret, DB URL and keys live in host env vars, never in
  the repo or the frontend bundle. All Fyers calls are server-side.
- **NFR-8** Password stored only as a bcrypt hash. Session tokens signed; Fyers token
  encrypted at rest (AES-256-GCM).
- **NFR-9** CORS allows only the frontend origin. The OAuth callback rejects a missing or
  mismatched `state`.
- **NFR-10** Errors returned to the browser never include tokens, secrets or raw Fyers
  responses with credentials.

### Performance

- **NFR-11** Dashboard for a run of up to 50,000 trades renders in under 2 s after the data
  arrives; API responses for a run under 1 s.
- **NFR-12** Run duration is bounded by the rate limit (~1.3 s per call), not by the app.
  Engine time per symbol is negligible by comparison.

### Reliability

- **NFR-13** A server restart loses at most the symbol in progress; the run resumes (FR-17).
- **NFR-14** A failed symbol never fails the whole run (FR-16).

### Cost and operations

- **NFR-15** Runs on one Render web service, one Render static site and Neon Postgres.
  Target: Neon free tier plus the smallest always-on Render instance.
- **NFR-16** Stored data per trade stays small (no candles); 100k trades should stay well
  under Neon's free storage.
- **NFR-17** Server logs include run id and symbol on every run log line; failed runs store
  their error message.

### Maintainability

- **NFR-18** Strategy logic exists only in `src/engine.js`. The API and the frontend contain
  none.
- **NFR-19** The CLI scripts keep working.

## Local CLI

**During development** one Fyers app and the existing `.env` serve both the CLI and the
local web server, and the rate-limit split below is not applied. The second Fyers app and
the split are set up as part of deployment.

The CLI scripts stay as they are, for local testing only. They do not use the database, do
not show up in the UI, and keep `data/token.json` and `data/rest-usage.json`.

- **Separate Fyers app.** An app has one redirect URI, so local login
  (`http://127.0.0.1:5000/callback`) and the deployed callback need two Fyers apps on the
  same account. Each has its own `FYERS_APP_ID` / `FYERS_SECRET_ID`.
- **One account, two counters.** Fyers counts limits per account, but the CLI's file counter
  and the server's database counter cannot see each other. Two rules keep the sum safe:
  - Split the daily cap: server `REST_DAILY_CAP=3800`, local `REST_DAILY_CAP=1000`
    (4,800 total, under 5,000).
  - Never run a CLI backtest while a web run is active. Each process alone stays at ~46/min;
    both together would hit ~92/min, over the 50/min cap.

## Open questions

1. Does a new token for one Fyers app invalidate another app's token for the same account?
   Fyers does not document it. Verify once: log in locally, connect on the server, then make
   a call with the local token.
