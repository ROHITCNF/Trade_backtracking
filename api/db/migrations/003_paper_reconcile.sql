-- After the close, the day's paper trades are checked against a backtest of
-- the same candles (#76). Live fills come from the engine, so any difference
-- is a plumbing bug, never a second opinion about the strategy.
create table paper_reconciliations (
  date          date primary key,
  reconciled_at timestamptz not null default now(),
  checked       int not null,                  -- symbols compared
  matched       int not null,
  backfilled    int not null default 0,        -- trades written with source = 'backtest'
  mismatches    jsonb not null default '[]'    -- [{ symbol, problem, live, backtest }]
);
