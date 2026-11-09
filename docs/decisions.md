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

## 2026-10-29 — v2: Journal and Research

Source: the screens in [design/reference/v2/](design/reference/v2/) (`Journal` and
`Research`, desktop and mobile). They replace the v1 screens as the UI source of truth.
v1's decisions above still hold unless one below overrides them.

| # | decision | why |
|---|---|---|
| D14 | **Navigation is Journal · Research · Live.** Journal is the home screen. Dashboard, New backtest, Runs, Run progress, Compare and Watchlists are removed; their URLs redirect. | The v2 design folds launch, results and comparison into Research, and lists into Journal. Fewer places to look. |
| D15 | **v2 is frontend only. The API, worker, schema and engine do not change.** A backend change needs its own decision here, made only if the frontend cannot do the job. | The API already serves everything the screens need (runs, filtered analysis, trades, compare, watchlists, estimate). Keeping the backend fixed keeps the parity guarantee (NFR-1) untouched. |
| D16 | **Journal runs are ordinary runs named `Journal · <watchlist id>`**, one per list, covering the last 40 calendar days up to the last finished session. Opening Journal queues any that are missing or stale; once a newer one is done, older ones for that list are deleted. | 40 days is under one 60-day history chunk, so a refresh costs 1 call per symbol (264 for core + final + F&O, ~7% of the 3,800 cap) and holds the 20 trading days the heatmap shows. Recomputing the whole window means every day uses the current strategy. |
| D17 | **"Runs automatically at 15:45 IST" means: the first time Journal is opened after 15:45 on a weekday** (Fyers connected, budget allowing). There is no server cron. | A server job needs a backend change (D15), and it would need the day's Fyers token anyway, which only exists after the morning connect. The data is history, so running later gives the same trades. |
| D18 | **The default strategy is the newest Journal run's settings** (`/api/defaults` until one exists). Changing it re-runs every list. Research starts from it and may override it per run. | No settings table exists (D15), and `/api/defaults` follows whatever ran last, Research included. |
| D19 | **Sweeps are dropped from the UI.** The API keeps supporting them. | Not in the v2 design; comparing ticked Research runs covers the need. |
| D20 | **The ticker page stays** (`/runs/:id/symbols/:symbol`), restyled to v2. **Run progress is shown inline** on the Research card. | No v2 mockup replaces either; "click a symbol to see its trades" needs the ticker page. |
| D21 | **Day P&L for the heatmap comes from the run's equity curve**, differenced per trade and grouped by date. | `/api/runs/:id/analysis` already returns it in entry order; no per-day endpoint is needed (D15). |

## 2026-11-01 — Live paper: the `live` list and the watchlist filter

| # | decision | why |
|---|---|---|
| D22 | **The live session trades a seeded, read-only list `live` (95 symbols): every core and final symbol, deduplicated, plus 45 random F&O symbols.** `LIVE_WATCHLIST` defaults to it, and the scheduler refuses any list over 100 symbols. The Live page filters paper trades by any watchlist (opening on `final`) through `GET /api/paper-trades?watchlist=<id>`, and says which of a list's symbols live doesn't trade. This overrides D15 for the paper-trade endpoints only. | Fyers Standard caps the data websocket at 100 symbols per account across all connections, so F&O 207 can't be watched live. 95 leaves headroom for a reconnect that overlaps the old connection. Read-only keeps the backend set fixed; filtering is a view. Random filler avoids picking symbols by past results. Reconciliation goes from 39 to 95 REST calls a day. |
| D23 | **The Live page follows `design/reference/live/`: a trade list (Traded / All / Review) beside one trade's chart and story; on a phone, list then trade with Previous / Next. Frontend only.** Range keeps 1Y and Custom beside the design's Day · 15D · 1M; the Date picks the day or the range's last day. Best/worst move, R, held time and "What happened" are computed in the browser from the candles the paper-trade candle route already returns. Rows the backtest traded but live didn't ("missed") show the backtest's numbers without a chart, since that route only serves paper trades. On a single day, the list's untraded symbols show greyed ("No breakout · backtest agrees"). | The owner asked for no backend change. Everything except candles for missed trades is already in `/api/paper-trades`, `/api/watchlists/:id` and the candle route. |

## 2026-11-01 — Live follows the socket once in a trade

| # | decision | why |
|---|---|---|
| D24 | **Live takes its entry from the engine, then manages the position on the socket's ticks**: entry fills at the breakout tick's price, the first tick at or through the stop or target exits at that tick's price, the first tick at `sessionEnd` exits as EOD. Minutes live couldn't watch (warm start, reconnect, restart, EOD refresh) are checked on REST candles with the engine's rules (stop first, fill at the level). Reconciliation labels each traded symbol match (slippage kept) / tick order (expected) / mismatch (review). The backtest and every paper trade before 2026-11-02 are unchanged. | The owner wants live to respect the prices it receives. Re-asking the engine every tick could swap a stopped-out long for a short when one minute broke both edges of the range (the position's own stop was never checked), and it applied the backtest's worst-case guess where live had seen the real order. |

## 2026-11-04 — Live paper: a trailing-stop flow beside the fixed one

| # | decision | why |
|---|---|---|
| D25 | **Live records two paper trades per entry: `fixed` (the engine's stop and target, unchanged) and `trail` (same entry and starting stop, no target). For every full `trail.stepPct` (0.5%) of entry the best price moves in favour, the trail's stop moves the same amount, and never back. Each price is checked against the current stop before it may move the stop; on blind candles the stop fills at its level, and the minute the stop last moved in isn't re-checked against the new stop. That last rule can only ever favour the trail (a dip under the new stop later in that minute, while live was blind, goes unseen); it is accepted because the alternative books stops on lows that came before the step. Live only: no backtest, no Research, and reconciliation covers `fixed` alone.** `paper_trades` is keyed by `(date, symbol, flow)`; `trail.enabled: false` restores the single flow exactly. | The owner wants to test letting winners run, without giving up today's flow, so both are recorded on the same entries and can be compared. 1-minute candles can't say whether a candle's high came before its low, which a trailing stop depends on, so only socket ticks can test it honestly. Steps are a % of entry so they mean the same on every price. |

## 2026-11-10 — Live paper: trade emails

| # | decision | why |
|---|---|---|
| D26 | **The API emails each closed `fixed` paper trade on `MAIL_WATCHLIST` (default `final`), and one end-of-day summary (P&L, trades, wins/losses, win rate, a row per trade) when the session stops, through Brevo's HTTPS API.** Live still trades the whole `live` list; `trail` trades and other symbols send nothing. Off unless `BREVO_API_KEY` and `MAIL_TO` are set. A send never throws into the session; a failure is logged. Only the process that hosted the session sends the EOD mail, so a restart after the close never resends it, and one between 15:14 and the stop skips it. | The owner wants trades without opening the Live page, scoped to the 18 symbols they follow. Render's free plan blocks SMTP, so the mail goes over HTTPS; Brevo's free 300/day covers at most 18 trade mails plus 1 summary, and needs only a verified sender, no domain. |
