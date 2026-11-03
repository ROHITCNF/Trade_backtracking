-- M10 (#148): live records two paper flows per breakout on the same entry:
-- 'fixed' (the engine's stop and target, as before) and 'trail' (same starting
-- stop, no target, the stop steps with the price). Every existing row is fixed.
alter table paper_trades add column flow text not null default 'fixed'
  check (flow in ('fixed', 'trail'));

-- The most favourable price seen while a trail trade was open; null for fixed.
alter table paper_trades add column best numeric;

alter table paper_trades drop constraint paper_trades_pkey;
alter table paper_trades add primary key (date, symbol, flow);
