-- M10 (#148): live records two paper flows per breakout on the same entry:
-- 'fixed' (the engine's stop and target, as before) and 'trail' (same starting
-- stop, no target, the stop steps with the price). Every existing row is fixed.
alter table paper_trades add column flow text not null default 'fixed'
  check (flow in ('fixed', 'trail'));

-- Trail trades only (null for fixed): the stop the trade started with, which
-- every step is measured from; the most favourable price seen while open; and
-- the 'HH:MM' the current stop was set (null while it is still the starting
-- stop), so a restart re-checks only the minutes after it.
alter table paper_trades add column initial_sl numeric;
alter table paper_trades add column best numeric;
alter table paper_trades add column sl_time text;

alter table paper_trades drop constraint paper_trades_pkey;
alter table paper_trades add primary key (date, symbol, flow);
