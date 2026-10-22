-- Every table in docs/hld.md § Data model.

-- One backtest job. config is the full settings snapshot (FR-13).
create table runs (
  id               bigserial primary key,
  name             text,
  sweep_id         bigint,                  -- groups the runs of one sweep; null otherwise
  status           text not null,           -- queued | running | done | failed | cancelled
  cancel_requested boolean not null default false,
  config           jsonb not null,          -- direction, slMode, slPct, targetMode, ... resolution
  from_date        date not null,
  to_date          date not null,
  watchlist_name   text,                    -- name at creation time, when picked from a watchlist
  symbols          text[] not null,         -- snapshot; editing the watchlist never changes it (FR-37)
  total            int not null,            -- symbols.length
  done             int not null default 0,  -- symbols finished (ok or skipped)
  metrics          jsonb,                   -- pooled computeMetrics + portfolio stats, set when done
  calls_used       int not null default 0,  -- Fyers data calls spent, retries included (D10)
  error            text,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz
);

-- Per-symbol progress and stats. Doubles as the run's live log and as the resume point.
create table run_symbols (
  run_id      bigint references runs(id) on delete cascade,
  symbol      text not null,
  position    int not null,                 -- order within the run
  status      text not null,                -- pending | done | skipped | failed
  reason      text,                         -- why skipped or failed
  metrics     jsonb,                        -- computeMetrics for this symbol (without curve)
  finished_at timestamptz,
  primary key (run_id, symbol)
);

-- One row per trade, exactly the fields buildTrade returns, minus candles.
create table trades (
  id         bigserial primary key,
  run_id     bigint not null references runs(id) on delete cascade,
  symbol     text not null,
  date       date not null,
  side       text not null,                 -- long | short
  orb_high   numeric not null,
  orb_low    numeric not null,
  entry_time text not null,                 -- 'HH:MM' IST
  entry_ts   bigint not null,               -- epoch seconds
  entry      numeric not null,
  sl         numeric not null,
  target     numeric,
  exit_time  text not null,
  exit_ts    bigint not null,
  exit       numeric not null,
  reason     text not null,                 -- SL | TARGET | EOD
  quantity   int not null,
  notional   numeric not null,
  pnl        numeric not null,
  pnl_pct    numeric not null,
  r_multiple numeric not null
);
create index trades_run_symbol_date on trades (run_id, symbol, date);

-- Editable symbol lists (D1). Seeded once from lists/*.txt.
create table watchlists (
  id          bigserial primary key,
  name        text not null unique,
  description text,
  source      text not null,                -- custom | import | seed
  read_only   boolean not null default false, -- true for the F&O seed (D2)
  source_file text,                         -- last imported file name, for the subtitle
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table watchlist_symbols (
  watchlist_id bigint references watchlists(id) on delete cascade,
  symbol       text not null,               -- always 'NSE:XXX-EQ'
  added_at     timestamptz not null default now(),
  primary key (watchlist_id, symbol)
);

-- The single Fyers access token. One row.
create table fyers_token (
  id          int primary key default 1 check (id = 1),
  token_enc   bytea not null,               -- AES-256-GCM ciphertext + iv + tag
  expires_at  timestamptz not null,         -- next 06:30 IST after issue (Fyers' daily expiry)
  client_name text,
  updated_at  timestamptz not null default now()
);

-- Replaces data/rest-usage.json. One row per IST day.
create table rest_usage (
  date         date primary key,
  count        int not null default 0,
  next_slot_at timestamptz not null default now(),
  limited      boolean not null default false
);

-- One-time OAuth state values, valid for 10 minutes.
create table oauth_state (
  state      text primary key,
  created_at timestamptz not null default now()
);
