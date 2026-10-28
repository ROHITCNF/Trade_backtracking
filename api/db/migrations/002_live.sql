-- Live paper trading (M6). The live session's state store (server/session.js)
-- writes the first two; paper_trades is the table the UI reads.

-- Each symbol's position for the day. Restored on boot, so a restarted
-- instance never takes a second position in a symbol it already holds.
create table live_state (
  date       date not null,
  symbol     text not null,
  position   text not null,                 -- FLAT | OPEN | CLOSED
  updated_at timestamptz not null default now(),
  primary key (date, symbol)
);

-- Append-only: every paper-broker event, as emitted, for replay and debugging.
create table live_decisions (
  id      bigserial primary key,
  date    date not null,
  symbol  text not null,
  kind    text not null,                    -- ENTRY | EXIT
  payload jsonb not null,
  at      timestamptz not null default now()
);
create index live_decisions_date on live_decisions (date, id);

-- One paper trade per symbol per day (the strategy takes at most one), opened
-- by an ENTRY and closed by its EXIT. Prices are the engine's, not tick prints.
create table paper_trades (
  date       date not null,
  symbol     text not null,
  status     text not null,                 -- open | closed
  side       text not null,                 -- long | short
  quantity   int not null,
  entry_time text not null,                 -- 'HH:MM' IST
  entry      numeric not null,
  sl         numeric not null,
  target     numeric,
  exit_time  text,
  exit       numeric,
  reason     text,                          -- SL | TARGET | EOD
  pnl        numeric,
  source     text not null default 'live',  -- live | backtest (filled in after close, #76)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (date, symbol)
);
