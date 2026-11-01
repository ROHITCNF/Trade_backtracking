-- D24: live manages positions on ticks, so it can differ from the backtest
-- for good reasons. `notes` holds the per-symbol verdicts that aren't problems
-- ({ symbol, kind: 'match' | 'tick', problem?, slippage, live, backtest });
-- `mismatches` keeps only the ones worth reviewing.
alter table paper_reconciliations add column notes jsonb not null default '[]';
