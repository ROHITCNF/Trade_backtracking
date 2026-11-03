# Plan — v1 web app

How [spec.md](spec.md) and [hld.md](hld.md) get built. Every task is a GitHub issue in its
milestone. Progress lives in the issues; this file is the map.

## Workflow per task

Since M9 this is automated by `/ship`; see [workflow.md](workflow.md).

1. Branch from `main`: `<milestone>/<issue>-<slug>` (e.g. `m1/15-test-harness`).
2. Implement, with tests where the task says so. `npm test` must pass.
3. Open a PR to `main` that says `Closes #<issue>`.
4. Merge, delete the branch, the issue closes.
5. Next task.

Tasks run in order. Each milestone ends with `main` in a working state; the CLI keeps
working throughout.

Until M5 the local web server reuses the CLI's `.env` and Fyers app, with no rate-limit
split (spec § Local CLI).

## M0 · Plan

This file and the issue list.

| issue | task |
|---|---|
| [#14](https://github.com/ROHITCNF/Trade_backtracking/issues/14) | Create plan.md with milestones and tasks |

## M1 · Core foundations

Prepare the existing core for the web app without changing CLI behaviour: a test harness, a storage seam in `src/fyers.js`, and fetch retries.

| issue | task |
|---|---|
| [#15](https://github.com/ROHITCNF/Trade_backtracking/issues/15) | Add node:test harness and engine tests |
| [#16](https://github.com/ROHITCNF/Trade_backtracking/issues/16) | Storage seam for Fyers token and REST usage in src/fyers.js |
| [#17](https://github.com/ROHITCNF/Trade_backtracking/issues/17) | Retry transient fetch errors and count calls |

## M2 · Database and worker

Postgres schema and the background worker that runs backtests and stores trades. Ends with the parity gate: stored trades equal engine output.

| issue | task |
|---|---|
| [#18](https://github.com/ROHITCNF/Trade_backtracking/issues/18) | Postgres schema, migration runner and local dev database |
| [#19](https://github.com/ROHITCNF/Trade_backtracking/issues/19) | Postgres store for Fyers token and REST throttle |
| [#20](https://github.com/ROHITCNF/Trade_backtracking/issues/20) | Run worker: execute, persist, resume, cancel, sweep |
| [#21](https://github.com/ROHITCNF/Trade_backtracking/issues/21) | Parity test: engine output vs trades stored in Postgres |

## M3 · API

Fastify API on top of the worker: app login, Fyers OAuth, runs, analysis, symbols and watchlists.

| issue | task |
|---|---|
| [#22](https://github.com/ROHITCNF/Trade_backtracking/issues/22) | Fastify API skeleton: health, config, CORS, errors |
| [#23](https://github.com/ROHITCNF/Trade_backtracking/issues/23) | App login: password, 7-day session token, rate-limited |
| [#24](https://github.com/ROHITCNF/Trade_backtracking/issues/24) | Fyers OAuth connect/callback and /api/me |
| [#25](https://github.com/ROHITCNF/Trade_backtracking/issues/25) | Symbol master download and search |
| [#26](https://github.com/ROHITCNF/Trade_backtracking/issues/26) | Runs API: defaults, estimate, create, list, get, patch, delete |
| [#27](https://github.com/ROHITCNF/Trade_backtracking/issues/27) | Analysis, trades, CSV, compare and candle routes |
| [#28](https://github.com/ROHITCNF/Trade_backtracking/issues/28) | Watchlists API: seed, CRUD, import preview/apply, export |

## M4 · Frontend

The React app in `web/`, built screen by screen from `docs/design/reference/`.

| issue | task |
|---|---|
| [#29](https://github.com/ROHITCNF/Trade_backtracking/issues/29) | web/ scaffold: Vite + React, router, tokens, API client, app shell |
| [#30](https://github.com/ROHITCNF/Trade_backtracking/issues/30) | Login screen and header: Fyers pill, market pill, API meter |
| [#31](https://github.com/ROHITCNF/Trade_backtracking/issues/31) | New backtest launcher |
| [#32](https://github.com/ROHITCNF/Trade_backtracking/issues/32) | Run in progress and Runs history |
| [#33](https://github.com/ROHITCNF/Trade_backtracking/issues/33) | Run dashboard with ECharts |
| [#34](https://github.com/ROHITCNF/Trade_backtracking/issues/34) | Ticker detail and trade chart (Lightweight Charts v5) |
| [#35](https://github.com/ROHITCNF/Trade_backtracking/issues/35) | Compare runs and sweep results |
| [#36](https://github.com/ROHITCNF/Trade_backtracking/issues/36) | Watchlists screen with .txt import |
| [#37](https://github.com/ROHITCNF/Trade_backtracking/issues/37) | Empty/loading/error states, mobile layouts, dark theme pass |

## M5 · Deploy

Render + Neon. **The owner is needed here**: Neon project, second Fyers app, Render env vars.

| issue | task |
|---|---|
| [#38](https://github.com/ROHITCNF/Trade_backtracking/issues/38) | Render blueprint and production build |
| [#39](https://github.com/ROHITCNF/Trade_backtracking/issues/39) | Create Neon project, second Fyers app, Render services (owner) |
| [#40](https://github.com/ROHITCNF/Trade_backtracking/issues/40) | Production smoke test and token-conflict check |

## M7 · v2 Journal & Research

The v2 design in `docs/design/reference/v2/`, frontend only ([decisions.md](decisions.md) D14–D21).

| issue | task |
|---|---|
| [#86](https://github.com/ROHITCNF/Trade_backtracking/issues/86) | Record the v2 design decisions and the M7 plan |
| [#87](https://github.com/ROHITCNF/Trade_backtracking/issues/87) | v2 shell: Journal · Research · Live nav and the status chip |
| [#88](https://github.com/ROHITCNF/Trade_backtracking/issues/88) | Research: launcher bar, estimate and result cards with inline progress |
| [#89](https://github.com/ROHITCNF/Trade_backtracking/issues/89) | Research: results view and compare |
| [#90](https://github.com/ROHITCNF/Trade_backtracking/issues/90) | Journal: daily auto-run per list and the 20-day heatmap |
| [#91](https://github.com/ROHITCNF/Trade_backtracking/issues/91) | Journal: day view — list cards, day summary, top movers |
| [#92](https://github.com/ROHITCNF/Trade_backtracking/issues/92) | Journal: add and edit lists (search symbols or import .txt) |
| [#93](https://github.com/ROHITCNF/Trade_backtracking/issues/93) | Restyle the ticker page and Live for v2, mobile pass |
| [#94](https://github.com/ROHITCNF/Trade_backtracking/issues/94) | Remove the v1 screens and the sweep UI |

## M8 · Live paper by watchlist

[decisions.md](decisions.md) D22.

| issue | task |
|---|---|
| [#104](https://github.com/ROHITCNF/Trade_backtracking/issues/104) | Live session on a 95-symbol `live` list covering core and final |
| [#105](https://github.com/ROHITCNF/Trade_backtracking/issues/105) | Filter paper trades by watchlist |
| [#106](https://github.com/ROHITCNF/Trade_backtracking/issues/106) | Live page: range presets, date picker, watchlist dropdown |
| [#111](https://github.com/ROHITCNF/Trade_backtracking/issues/111) | Live page v2: trade list + trade panel (D23) |

## M9 · AI-native workflow

[workflow.md](workflow.md). CI, guards, agents and skills so every task runs `/feature` → `/ship`.
GitHub milestone 9; its branches were named `m8/…` before the milestone was renumbered to follow
this file.

| issue | task |
|---|---|
| [#124](https://github.com/ROHITCNF/Trade_backtracking/issues/124) | CI: GitHub Actions + branch protection |
| [#125](https://github.com/ROHITCNF/Trade_backtracking/issues/125) | Lint: Biome with repo-specific rules |
| [#126](https://github.com/ROHITCNF/Trade_backtracking/issues/126) | PR template and area labels |
| [#127](https://github.com/ROHITCNF/Trade_backtracking/issues/127) | Claude hook: block prod DATABASE_URL, confirm Fyers-spending scripts |
| [#128](https://github.com/ROHITCNF/Trade_backtracking/issues/128) | E2E harness: Playwright + stub API + smoke specs |
| [#129](https://github.com/ROHITCNF/Trade_backtracking/issues/129) | engine-rules skill and per-area review checklists |
| [#130](https://github.com/ROHITCNF/Trade_backtracking/issues/130) | Agents: pr-creator, e2e-tester, pr-reviewer, test-writer |
| [#131](https://github.com/ROHITCNF/Trade_backtracking/issues/131) | Skills: /feature, /decision, /review, /e2e |
| [#132](https://github.com/ROHITCNF/Trade_backtracking/issues/132) | /ship orchestrator skill |
| [#133](https://github.com/ROHITCNF/Trade_backtracking/issues/133) | Docs: workflow.md, CLAUDE.md, plan.md M9 |

## M10 · Trailing-stop paper flow

Live records a second paper flow beside the fixed stop and target, on the same entry: same
starting stop, no target, and the stop steps with the price (0.5% of entry per 0.5% move in favour).
Live only; the backtest and reconciliation stay on the fixed flow. [decisions.md](decisions.md) D25.

| issue | task |
|---|---|
| [#148](https://github.com/ROHITCNF/Trade_backtracking/issues/148) | Store paper trades per flow (fixed \| trail) |
| [#149](https://github.com/ROHITCNF/Trade_backtracking/issues/149) | Live: trailing-stop paper flow beside the fixed flow |
| [#150](https://github.com/ROHITCNF/Trade_backtracking/issues/150) | Live page: Fixed / Trail toggle with stepped SL |

## Owner involvement

Only M5 needs the owner:

- Create the Neon project and share `DATABASE_URL` as a Render env var.
- Create the second Fyers app with the Render callback URI.
- Choose the app password; set the Render env vars from hld § Configuration.
- Run the production smoke test and the token-conflict check.
