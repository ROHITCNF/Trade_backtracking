# High-level design — v1 web app

> Status: **frozen** for v1 (2026-10-22). Change only by deliberate revision.

How the app described in [spec.md](spec.md) is built. Why it exists: [intent.md](intent.md).

## Overview

```
                        ┌──────────────────────────────┐
  Browser ─────────────►│ Render static site           │  React + Vite SPA
     │                  │ web/ build output            │
     │  HTTPS + Bearer  └──────────────────────────────┘
     ▼
┌──────────────────────────────────────────────────────────────────┐
│ Render web service (one Node process)                            │
│                                                                  │
│  HTTP API (api/)          Worker (api/worker.js)                 │
│  ─ auth, sessions         ─ claims queued runs, one at a time    │
│  ─ Fyers OAuth            ─ per symbol: fetch → engine → metrics │
│  ─ runs CRUD, results     ─ writes trades + progress             │
│  ─ chart candles proxy    ─ resumes interrupted runs on boot     │
│           │                        │                             │
│           └──────┬─────────────────┘                             │
│                  ▼                                               │
│  Core (src/) — unchanged strategy code                           │
│  engine.js · metrics.js · fetch.js · time.js · util.js           │
│  fyers.js (client + rest() throttle, storage moved to Postgres)  │
└────────┬─────────────────────────────────────────┬───────────────┘
         │ SQL (pg pool)                           │ HTTPS
         ▼                                         ▼
┌──────────────────────────┐            ┌─────────────────────────┐
│ Neon Postgres            │            │ Fyers API v3            │
│ runs · run_symbols ·     │            │ OAuth · history ·       │
│ trades · fyers_token ·   │            │ profile · symbol master │
│ rest_usage · oauth_state │            └─────────────────────────┘
└──────────────────────────┘
```

API and worker share one process in v1, so the worker can be woken directly when a run
is created. That removes any need to poll the database. They can be split into two
Render services later without changing the schema.

## Layers

| layer | lives in | responsibility | changes for v1 |
|---|---|---|---|
| Frontend | `web/` | Screens from spec.md; calls the API; draws charts | new |
| API | `api/` | Auth, validation, routes, Fyers OAuth, serialising results | new |
| Worker | `api/worker.js` | Executes runs, persists results, resumes after restart | new; replaces the loop in `src/run.js` for the web path |
| Core | `src/` | Engine, metrics, candle fetch, time helpers | none, except storage in `fyers.js` |
| Fyers access | `src/fyers.js` | SDK client, `rest()` throttle, token | token and usage storage move from files to Postgres |
| Storage | Neon | Runs, trades, token, throttle state | new |
| CLI | root scripts | Existing local workflow | keeps working |
| Live runner | `server/` | Paper live | untouched, out of scope |

**Rule carried over from `server/architecture.md`:** `src/engine.js` is the only place
strategy logic lives. The API and the frontend only move data.

## Repo layout

```
src/            core (existing) — engine, metrics, fetch, fyers, time, util, tickers
api/
  server.js     HTTP server, route wiring, CORS, auth middleware
  routes/       auth.js · fyers.js · runs.js · trades.js · symbols.js · meta.js
  worker.js     run executor
  db/
    pool.js     pg pool from DATABASE_URL
    migrations/ numbered .sql files, applied on boot
  auth/         password check, session token sign/verify, token encryption
web/            React + Vite app (design from Claude Design)
lists/          watchlists, shipped read-only with the code
server/         live runner (unchanged)
docs/           intent · spec · hld
```

## Tech choices

| concern | choice | why |
|---|---|---|
| Runtime | Node 22 | Render supports it; built-in `fetch`, `crypto`, `--env-file` |
| HTTP | Fastify | Small, schema validation built in, CORS and rate-limit plugins; plain `http` would mean hand-rolling those |
| DB driver | `pg` (node-postgres), pooled | Long-lived process; Neon's pooled connection string works with it |
| Migrations | Plain `.sql` files + a tiny runner | One user, few tables; no ORM needed |
| Password hash | `bcryptjs` | Pure JS, no native build on Render |
| Session token | HMAC-signed token via `node:crypto` | Bearer header; no session table needed |
| Token encryption | AES-256-GCM via `node:crypto` | Fyers token at rest |
| Frontend | React + Vite | Builds to static files for a Render static site |
| Charts | TradingView Lightweight Charts **v4** | Same pinned major as `src/template.html` |
| Fyers | `fyers-api-v3` SDK (existing) | Already used by `fetch.js` and login |

## Data model

```sql
-- One backtest job. config is the full settings snapshot (FR-13).
create table runs (
  id           bigserial primary key,
  name         text,
  sweep_id     bigint,                    -- groups the runs of one sweep; null otherwise
  status       text not null,             -- queued | running | done | failed | cancelled
  cancel_requested boolean not null default false,
  config       jsonb not null,            -- direction, slMode, slPct, targetMode, ... resolution
  from_date    date not null,
  to_date      date not null,
  list_name    text,                      -- 'core.txt' when picked from a list
  symbols      text[] not null,
  total        int not null,              -- symbols.length
  done         int not null default 0,    -- symbols finished (ok or skipped)
  metrics      jsonb,                     -- pooled computeMetrics + portfolio stats, set when done
  error        text,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);

-- Per-symbol progress and stats. Doubles as the run's live log and as the resume point.
create table run_symbols (
  run_id   bigint references runs(id) on delete cascade,
  symbol   text not null,
  position int not null,                  -- order within the run
  status   text not null,                 -- pending | done | skipped
  reason   text,                          -- why skipped
  metrics  jsonb,                         -- computeMetrics for this symbol (without curve)
  primary key (run_id, symbol)
);

-- One row per trade, exactly the fields buildTrade returns, minus candles.
create table trades (
  id          bigserial primary key,
  run_id      bigint not null references runs(id) on delete cascade,
  symbol      text not null,
  date        date not null,
  side        text not null,              -- long | short
  orb_high    numeric not null,
  orb_low     numeric not null,
  entry_time  text not null,              -- 'HH:MM' IST
  entry_ts    bigint not null,            -- epoch seconds
  entry       numeric not null,
  sl          numeric not null,
  target      numeric,
  exit_time   text not null,
  exit_ts     bigint not null,
  exit        numeric not null,
  reason      text not null,              -- SL | TARGET | EOD
  quantity    int not null,
  notional    numeric not null,
  pnl         numeric not null,
  pnl_pct     numeric not null,
  r_multiple  numeric not null
);
create index on trades (run_id, symbol, date);

-- The single Fyers access token. One row.
create table fyers_token (
  id             int primary key default 1 check (id = 1),
  token_enc      bytea not null,          -- AES-256-GCM ciphertext + iv + tag
  expires_at     timestamptz not null,    -- next 06:30 IST after issue (Fyers' daily expiry)
  client_name    text,
  updated_at     timestamptz not null default now()
);

-- Replaces data/rest-usage.json. One row per IST day.
create table rest_usage (
  date          date primary key,
  count         int not null default 0,
  next_slot_at  timestamptz not null default now(),
  limited       boolean not null default false
);

-- One-time OAuth state values, valid for 10 minutes.
create table oauth_state (
  state       text primary key,
  created_at  timestamptz not null default now()
);
```

Storage estimate: a trade row is ~250 bytes, so 100k trades ≈ 25 MB plus indexes. That fits
comfortably in Neon's free tier (NFR-16).

There is no users table. The single user is defined by `APP_PASSWORD_HASH`. If a second
user is ever needed, add `users` and a `user_id` column to `runs`.

## Key flows

### Authentication

```
POST /api/login {password}
  → bcrypt.compare(password, APP_PASSWORD_HASH)
  → ok: token = base64url(payload{exp: now+30d}) + "." + HMAC_SHA256(SESSION_SECRET, payload)
  → { token }                          frontend keeps it in localStorage

every request: Authorization: Bearer <token>
  → verify HMAC, check exp → else 401
```

A Bearer header is used rather than a cookie because the static site and the API are on
different `*.onrender.com` hosts. Browsers treat those as different sites, and Safari
blocks cross-site cookies. If both move under one custom domain, an httpOnly cookie becomes
the better choice.

Login attempts are rate-limited per IP (FR-4). Changing `SESSION_SECRET` logs out every
session.

### Fyers OAuth

```
GET /api/fyers/connect            (authenticated)
  → state = random 32 bytes; insert oauth_state
  → { url: fyers.generateAuthCode() with state }      frontend navigates there

user logs in on Fyers (their PIN/TOTP)

GET /auth/fyers/callback?auth_code&state             (public — browser redirect)
  → delete oauth_state where state = $1 and created_at > now() - 10 min
       (no row → reject)
  → fyers.generate_access_token({ secret_key, auth_code })
  → encrypt with TOKEN_ENC_KEY; upsert fyers_token (expires_at = next 06:30 IST)
  → get_profile → store client_name
  → 302 to FRONTEND_URL/?fyers=connected      (or ?fyers=error)
```

The callback carries no session token, since it is a browser redirect from Fyers. The
one-time `state` is what ties it to a Connect click made by the logged-in owner.

`src/fyers.js` changes from `readToken()`/`saveToken()` on `data/token.json` to the
`fyers_token` row, and the expiry check moves from "issued today" to `expires_at`. Fyers
kills tokens at 06:30 IST, so a token issued between midnight and 06:30 dies the same morning.

### Rate-limit throttle (Postgres)

`rest()` keeps its contract: every Fyers data call goes through it. Only `reserveSlot()`
and `markLimited()` change storage:

```sql
begin;
insert into rest_usage (date) values ($today) on conflict do nothing;
select count, next_slot_at, limited from rest_usage where date = $today for update;
-- limited → throw "paused after 429"
-- count >= 4800 → throw "daily budget used"
-- at = greatest(now(), next_slot_at)
update rest_usage set count = count + 1, next_slot_at = at + interval '1.3 s' where date = $today;
commit;
-- sleep until `at`, then make the call
```

The row lock replaces the `mkdir` lock, so the API, the worker and a CLI pointed at the same
`DATABASE_URL` all share one clock and one count (NFR-5). The in-process FIFO queue in
`rest()` stays, so calls inside one process never race for the lock.

Calls to Profile (trading/user-info budget) and downloads of the public symbol master do not
count against the data budget and skip `rest()`.

### Run execution (worker)

```
create run (POST /api/runs)
  → validate (FR-10), estimate cost, check remaining budget (FR-12)
  → insert runs (queued) + run_symbols (pending, in order)
  → worker.wake()

worker loop (one run at a time):
  claim:  update runs set status='running', started_at=coalesce(started_at, now())
          where id = (select id from runs where status in ('queued','running')
                      order by created_at limit 1 for update skip locked)
  for each run_symbol with status 'pending', in position order:
      if runs.cancel_requested → status='cancelled', stop
      candles = getCandles({ symbol, resolution, fromDate, toDate })   // via rest()
      for each run in the sweep group (1 for a normal run):
          trades  = runBacktest(candles, config)
          metrics = computeMetrics(trades)
          in one transaction:
              insert trades (without candles)
              update run_symbols set status='done'|'skipped', metrics, reason
              update runs set done = done + 1
  on all symbols finished:
      pooled = computeMetrics(all trades of run) + portfolio stats (as summary.js totalsFrom)
      update runs set status='done', metrics=pooled, finished_at=now()
  on a fatal error (budget exhausted, 429 pause, token expired):
      status='failed', error=message; remaining symbols stay pending → "Resume" possible
```

- **Resume (FR-17):** on boot the worker claims any `running` run first. Pending symbols
  are exactly the unfinished ones. A symbol interrupted mid-way has no rows committed,
  because the inserts are one transaction, so it simply re-runs.
- **Sweep (F5):** a sweep is N runs sharing a `sweep_id`, executed together. Candles are
  fetched once per symbol and fed to each variant's config. N variants cost the calls of one.
- **Skips (FR-16):** a fetch error or zero trades marks that symbol `skipped` with a reason.
  Only budget, 429 or token errors stop the run, since every later symbol would fail too.
- **Cancel (FR-19):** sets `cancel_requested`; checked between symbols.

Candles stay in memory for one symbol at a time: a year of 1-minute data is ~94k candles,
a few MB. They are never written to disk or the database.

### Dashboard data

```
GET /api/runs/:id                 → run row + run_symbols (status, metrics) — progress and per-symbol table
GET /api/runs/:id/analysis?side&reason&from&to&symbols
                                  → loads matching trades, returns:
                                    computeMetrics(filtered)       stat cards + equity curve
                                    portfolio stats                 (summary.js totalsFrom)
                                    breakdowns: month, weekday, entry bucket, reason, side, histogram
                                    per-symbol rows                 (summary.js rowFor)
GET /api/runs/:id/trades?symbol&… → trade rows for tables / CSV export
```

Filtered numbers are computed in Node with the existing `computeMetrics`, not re-derived in
SQL. That keeps one definition of every metric (NFR-1). At 50k trades this is a few
milliseconds of work. Unfiltered pooled metrics are cached on `runs.metrics` when the run
finishes.

### Trade chart

```
GET /api/trades/:id/candles
  → load trade (symbol, date)
  → getCandles({ symbol, resolution:'1', fromDate: date, toDate: date })   // 1 call, via rest()
  → return [[t,o,h,l,c], ...] plus the trade's orb/entry/sl/target for overlays
```

Not persisted (FR-29). Because the worker awaits each call in turn, at most one worker call
is ever ahead in the `rest()` queue, so a chart waits at most ~2.6 s behind a running run.
The response carries `Cache-Control: private, max-age=3600`, so reopening the same trade
in one session costs nothing.

Chart drawing follows `src/template.html`: the `+19800` IST shift on timestamps, the ORB
band, and the entry/SL/target price lines.

### Symbol search

On boot (and daily), the API downloads the Fyers NSE capital-market symbol master, a public
file outside the data budget. It keeps `{ symbol, name }` in memory for search.
`GET /api/symbols?q=` serves it. Watchlists come from `lists/*.txt` via
`GET /api/lists`.

## API surface

| method | path | auth | purpose |
|---|---|---|---|
| POST | `/api/login` | — | password → session token |
| GET | `/api/health` | — | liveness for Render |
| GET | `/api/me` | ✓ | session check; Fyers status; budget used; paused flag |
| GET | `/api/fyers/connect` | ✓ | OAuth URL with fresh `state` |
| GET | `/auth/fyers/callback` | state | OAuth callback |
| GET | `/api/lists` | ✓ | watchlist names and symbols |
| GET | `/api/symbols?q=` | ✓ | symbol search |
| GET | `/api/defaults` | ✓ | `config.js` defaults for the form |
| POST | `/api/estimate` | ✓ | calls, duration, budget share for a draft run |
| POST | `/api/runs` | ✓ | create run or sweep |
| GET | `/api/runs` | ✓ | runs list |
| GET | `/api/runs/:id` | ✓ | run + per-symbol progress/stats |
| PATCH | `/api/runs/:id` | ✓ | rename; `{cancel:true}`; `{resume:true}` for failed runs |
| DELETE | `/api/runs/:id` | ✓ | delete run and its trades |
| GET | `/api/runs/:id/analysis` | ✓ | filtered metrics and breakdowns |
| GET | `/api/runs/:id/trades` | ✓ | trade rows (JSON or `?format=csv`) |
| GET | `/api/trades/:id/candles` | ✓ | day candles for the chart |
| GET | `/api/compare?ids=` | ✓ | metrics, curves and per-symbol P&L for 2–4 runs |

The frontend polls `GET /api/runs/:id` every 2 s while a run is active, and `/api/me` every
60 s. Both are database reads only; neither touches Fyers.

## Configuration

Render web service env vars:

| var | purpose |
|---|---|
| `DATABASE_URL` | Neon connection string (pooled) |
| `APP_PASSWORD_HASH` | bcrypt hash of the owner's password |
| `SESSION_SECRET` | ≥32 random bytes; signs session tokens |
| `TOKEN_ENC_KEY` | 32 random bytes (base64); encrypts the Fyers token |
| `FYERS_APP_ID`, `FYERS_SECRET_ID` | Fyers app credentials |
| `FYERS_REDIRECT_URI` | `https://<api>.onrender.com/auth/fyers/callback`; must match the Fyers app exactly |
| `REST_DAILY_CAP` | `3800`, leaving 1,000 of the account's daily data budget for the local CLI |
| `FRONTEND_URL` | Static site origin; used for CORS and the post-OAuth redirect |

Static site: `VITE_API_URL`, plus a rewrite of `/*` → `/index.html` so client-side routes work.

`.env` keeps serving local development; it is never committed.

## Deployment

| piece | Render type | notes |
|---|---|---|
| `api/` | Web service, always-on instance | Free instances sleep after idle and would kill a running backtest; resume (FR-17) recovers, but an always-on instance avoids the stall |
| `web/` | Static site | `npm run build` in `web/`, publish `web/dist` |
| DB | Neon | Pooled connection string; migrations applied on API boot |

Because there is no background polling, Neon can scale to zero while the app is idle.

## Security summary

- Two separate gates: app password (owner → API) and Fyers OAuth (API → Fyers). Neither
  credential reaches the frontend bundle; the Fyers password never touches the app at all.
- Bearer session token, HMAC-signed, 30-day expiry; login attempts rate-limited.
- Fyers token encrypted at rest; treated as dead after its `expires_at` (06:30 IST).
- OAuth `state` is one-time and expires after 10 min.
- CORS restricted to `FRONTEND_URL`. HTTPS everywhere (Render default).
- An exposed API would let someone burn the data budget and get the Fyers account blocked
  for the day. That is why every route except login, health and the callback requires a
  session.

## Migration from the current code

1. **Storage seam in `src/fyers.js`.** Token and usage go behind a small store interface:
   file store when `DATABASE_URL` is unset (the CLI, unchanged), Postgres store when it is
   set (the web service). `DAILY_CAP` becomes `REST_DAILY_CAP` from env, defaulting to 4,800.
   The CLI stays local-only and never touches the database (spec § Local CLI).
2. **Schema + worker.** Migrations, then `api/worker.js` calling `getCandles` /
   `runBacktest` / `computeMetrics` exactly as `src/run.js` does.
3. **Parity gate.** For one list and range, compare the CLI's `data/trades/*.json` with the DB
   trades. Zero differences required (NFR-1).
4. **API + auth + Fyers OAuth.**
5. **Throwaway UI** to prove the flows, then the Claude Design build in `web/`.
6. **Deploy:** create the second Fyers app (web callback URI), set `REST_DAILY_CAP` on both
   sides, then Neon, Render web service, Render static site.

Until step 6 the local web server reuses the CLI's `.env` and Fyers app.

## Risks

| risk | mitigation |
|---|---|
| Local and deployed share one redirect URI | Two Fyers apps on the same account, one per environment |
| Server token invalidates the local token, or vice versa | Unknown; verify once (spec open question 1). Worst case: re-login locally |
| CLI file counter + server DB counter → one Fyers account, two budgets → block | Split `REST_DAILY_CAP` (3,800 server / 1,000 local); never run both at once |
| Render instance sleeps or restarts mid-run | Resume from `run_symbols` (FR-17) |
| Fyers changes limits or the SDK | Limits live in one place (`src/fyers.js`); the UI reads budget figures from `/api/me` |
| A large run (207 symbols ≈ 1,400 calls) starves charts | Charts wait ≤ ~2.6 s by design; the launcher warns when a run takes most of the budget |
