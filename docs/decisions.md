# Decisions

Choices made while turning the design references into the v1 plan. Each one is reflected
in [spec.md](spec.md) and [hld.md](hld.md); this file records why. Newest last.

## 2026-10-22 — v1.1 revision, after the design review

Source: the screens in [design/reference/](design/reference/), produced with Claude Design
from the spec. Those images are the UI source of truth; where they disagree with the spec,
the decision below says which one wins.

| # | decision | why |
|---|---|---|
| D1 | **Watchlists are editable in the app** and live in Postgres (`watchlists`, `watchlist_symbols`). The first deploy seeds them from `lists/core.txt`, `final.txt` and `fno.txt`. After that the web app never reads `lists/`; the CLI still does. | The design adds a Watchlists screen with add, remove, import and export. Files on Render's disk would not survive a redeploy. |
| D2 | **F&O list is a read-only seed** from `fno.txt` in v1. Syncing it from the Fyers NSE_FO symbol master is a later step. | Keeps v1 small. The list changes a few times a year. |
| D3 | **`.txt` import validates each line against the Fyers NSE symbol master.** It reports "will be added / already in list / not recognised", and recognises indices. **No rename hints** ("did you mean ETERNAL?"). | The symbol master has no rename history, so a hint would need a hand-kept map that goes stale. "Not recognised" is honest and enough. |
| D4 | **Sessions last 7 days**, not 30. | The login design says 7. A shorter session costs a password entry a week and narrows the window if a token leaks. |
| D5 | **Charts: TradingView Lightweight Charts v5 for the trade candle chart only. Apache ECharts for every other chart:** equity + drawdown, P&L bars by month, weekday and entry time, return histogram, exit-reason split, sparklines, compare and sweep overlays. | Lightweight Charts is built for price series on a time axis, so it is the right tool for candles with price lines and markers. Most other charts have category axes (weekday, entry bucket, target rule), which it handles poorly. ECharts covers all of them with one API and one theme. v5 instead of v4 because the design relies on `createSeriesMarkers`; the CLI template stays on v4. |
| D6 | **The "NSE Open / Closed" pill is computed from the clock** (Mon–Fri, 09:15–15:30 IST). It makes no Fyers call. Exchange holidays are ignored in v1. | The Fyers docs don't say whether Market Status counts against the data budget. A pill that refreshes every minute must never spend it. |
| D7 | **Launcher defaults come from the latest run's settings**, falling back to `config.js` when there are no runs. | The design says "Defaults match your last run". It saves re-entering a setup that is usually tweaked, not rebuilt. |
| D8 | **Transient fetch errors retry twice** (timeout, network error, HTTP 5xx), with 2 s then 5 s backoff. Each retry goes through `rest()` and counts against the budget. A 429 is never retried. A symbol still failing is marked `failed` (distinct from `skipped`) and the run continues. **No per-symbol retry button**: resuming the run covers it. | The design shows failed symbols separately from skipped ones. Automatic retries fix most transient failures without a new UI action. |
| D9 | **Budget and 429 pauses reset at 00:00 IST.** All UI copy says so. | Matches the code (`rest_usage` is keyed by IST date). One design state said 09:00, which was wrong. |
| D10 | **Runs record the Fyers calls they used** (`runs.calls_used`), and each symbol records when it finished (`run_symbols.finished_at`). | The Run in progress screen shows "Fyers calls 273 / 273" and a time per finished symbol. |
| D11 | **The sweep screen's "% targets equal R targets" note appears only when the stop mode is `pct`.** | Only then is 1R exactly 1%. With `tighter`, the stop can sit closer than 1%, so 1R < 1%. |
| D12 | **Profit factor with zero gross loss is shown as ∞.** | `computeMetrics` returns `null` in that case; the design's `4406.94` for a symbol with no losing trades is a sample-data error. |
| D13 | **Light theme is the default, dark is supported** with the same token names. | The design system defines light first and pairs every token with a dark value. |
