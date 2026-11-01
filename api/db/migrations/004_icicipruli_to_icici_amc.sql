-- ICICIPRULI is no longer in Fyers' NSE symbol master; ICICI Prudential AMC
-- (ICICIAMC) takes its place in every watchlist that held it, read-only
-- seeds included. lists/*.txt carry the same swap for fresh databases.
insert into watchlist_symbols (watchlist_id, symbol)
select watchlist_id, 'NSE:ICICIAMC-EQ' from watchlist_symbols where symbol = 'NSE:ICICIPRULI-EQ'
on conflict do nothing;
delete from watchlist_symbols where symbol = 'NSE:ICICIPRULI-EQ';
update watchlists set updated_at = now()
where id in (select watchlist_id from watchlist_symbols where symbol = 'NSE:ICICIAMC-EQ');
