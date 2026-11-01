// Live paper trading (M6, D22): the API's scheduler state and the paper trades
// it recorded, seen through one watchlist over a chosen range. Nothing here
// places orders; the session runs inside the API (api/live.js) and this page
// only reads what it recorded. It opens on the last trading day and never
// moves on its own: Refresh picks up new trades. Clicking a trade loads that
// day's candles from Fyers (one call, not stored).

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { connectFyers } from '../lib/me.jsx';
import { istToday } from '../lib/dates.js';
import { dateLong, dateShort, pnl, price, qty, rate, tone } from '../lib/format.js';
import { RANGES, dailyRows, defaultWatchlist, liveNotice, liveRange, reconLabel, sessionLabel } from '../lib/live.js';
import { PnlBars } from '../components/charts.jsx';
import { Stat } from '../components/Stat.jsx';
import TradeChart from '../components/TradeChart.jsx';
import Segmented from '../components/Segmented.jsx';
import Icon from '../components/Icon.jsx';

const short = (s) => s.replace(/^NSE:|-EQ$/g, '');
const keyOf = (t) => `${t.date}|${t.symbol}`;

function Notice({ notice }) {
  if (!notice) return null;
  const cls = notice.tone === 'error' ? 'banner-error' : notice.tone === 'info' ? 'banner-info' : '';
  return (
    <div className={`banner banner-row ${cls}`} role="status">
      <Icon name={notice.tone === 'info' ? 'info' : 'alert'} />
      <div>
        <b>{notice.title}</b> <span>{notice.body}</span>
      </div>
      <span className="spacer" />
      {notice.action === 'connect' && <button className="btn btn-primary" onClick={() => connectFyers()}>Connect Fyers</button>}
    </div>
  );
}

function TradeDay({ trade, onClose }) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let cancelled = false;
    setState({ loading: true });
    api(`/api/paper-trades/${trade.date}/${encodeURIComponent(trade.symbol)}/candles`).then(
      (data) => !cancelled && setState({ data }),
      (error) => !cancelled && setState({ error })
    );
    return () => {
      cancelled = true;
    };
  }, [trade.date, trade.symbol, trade.status]);

  return (
    <div className="card stack">
      <div className="row">
        <span className="title">{short(trade.symbol)}</span>
        <span className="tag">{trade.side === 'long' ? 'Long' : 'Short'}</span>
        {trade.status === 'open' ? <span className="tag">Open</span> : <b className={`title ${tone(trade.pnl)}`}>{pnl(trade.pnl)}</b>}
        <span className="caption">{dateLong(trade.date)}</span>
        <span className="spacer" />
        <button className="btn icon-btn" aria-label="Close chart" onClick={onClose}>×</button>
      </div>
      {state.loading && <p className="placeholder">Loading 1-minute candles from Fyers…</p>}
      {state.error && (
        <div className="chart-state chart-state-box">
          <b>{state.error.status === 409 ? 'Connect Fyers to load the chart' : 'The chart didn’t load'}</b>
          <span className="caption">
            {state.error.status === 409 ? 'Candles are fetched from the broker on demand. The trade’s numbers below don’t need it.' : state.error.message}
          </span>
          {state.error.status === 409 && <button className="btn btn-primary" onClick={() => connectFyers()}>Connect Fyers</button>}
        </div>
      )}
      {state.data && <TradeChart candles={state.data.candles} trade={state.data.trade} orbEnd={state.data.orbEnd} height={320} />}
    </div>
  );
}

function TradesTable({ trades, selected, onSelect, showDate }) {
  return (
    <div className="card table-wrap" style={{ padding: 0 }}>
      <table className="data">
        <thead>
          <tr>
            {showDate && <th>Date</th>}
            <th>Symbol</th>
            <th>Side</th>
            <th>Entry</th>
            <th className="num">Price</th>
            <th className="num">SL</th>
            <th className="num">Target</th>
            <th>Exit</th>
            <th className="num">Price</th>
            <th>Reason</th>
            <th className="num">Qty</th>
            <th className="num">P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={keyOf(t)} className={`clickable${selected === keyOf(t) ? ' selected' : ''}`} onClick={() => onSelect(keyOf(t))}>
              {showDate && <td className="nowrap">{dateShort(t.date)}</td>}
              <td><b>{short(t.symbol)}</b>{t.source === 'backtest' && <span className="cell-sub">backfilled</span>}</td>
              <td>{t.side === 'long' ? 'Long' : 'Short'}</td>
              <td>{t.entryTime}</td>
              <td className="num">{price(t.entry)}</td>
              <td className="num">{price(t.sl)}</td>
              <td className="num">{price(t.target)}</td>
              <td>{t.status === 'open' ? <span className="tag">Open</span> : t.exitTime}</td>
              <td className="num">{price(t.exit)}</td>
              <td>{t.reason ?? '—'}</td>
              <td className="num">{qty(t.quantity)}</td>
              <td className={`num ${tone(t.pnl)}`}>{pnl(t.pnl)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// After each close the API re-runs the day as a backtest; live and backtest
// must agree exactly. A mismatch is a plumbing bug worth opening.
function Reconciliations({ items, onRecheck, busy }) {
  if (!items.length) return null;
  return (
    <section className="stack">
      <h2 className="title">Checked against backtest</h2>
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table className="data">
          <thead>
            <tr><th>Date</th><th>Result</th><th>Details</th><th /></tr>
          </thead>
          <tbody>
            {items.map((r) => {
              const v = reconLabel(r);
              return (
                <tr key={r.date}>
                  <td className="nowrap">{dateShort(r.date)}</td>
                  <td className={`nowrap ${v.tone}`}><b>{v.text}</b></td>
                  <td>
                    {r.mismatches.length === 0
                      ? <span className="caption">{r.backfilled ? 'Live didn’t run; trades filled in from the backtest.' : 'Every symbol agrees.'}</span>
                      : r.mismatches.map((m) => <div key={m.symbol} className="caption"><b>{short(m.symbol)}</b> · {m.problem}</div>)}
                  </td>
                  <td className="num"><button className="btn" disabled={busy === r.date} onClick={() => onRecheck(r.date)}>{busy === r.date ? 'Checking…' : 'Re-check'}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// "8 of 95 symbols in core aren't traded live" — those never get a paper trade.
function Coverage({ coverage }) {
  if (!coverage?.missing.length) return null;
  const { missing, symbols, watchlist } = coverage;
  const shown = missing.slice(0, 8).map(short).join(', ');
  return (
    <p className="caption">
      {qty(missing.length)} of {qty(symbols)} symbols in “{watchlist.name}” aren’t traded live, so they have no paper trades:{' '}
      {shown}{missing.length > 8 ? `, +${missing.length - 8} more` : ''}.
    </p>
  );
}

export default function Live() {
  const [status, setStatus] = useState(null);
  const [lists, setLists] = useState(null);
  const [listId, setListId] = useState(null);
  const [range, setRange] = useState('day');
  const [custom, setCustom] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [rechecking, setRechecking] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0); // bumped by Refresh to re-read trades
  const latest = useRef(0); // only the newest trades request may land
  const today = istToday();

  // Status (and with it the last trading day) is read on open and on Refresh
  // only, so the page never jumps to a new day by itself.
  const loadStatus = useCallback(async () => {
    const [s, { watchlists }] = await Promise.all([api('/api/live/status'), api('/api/watchlists')]);
    setStatus(s);
    setLists(watchlists);
    setListId((cur) => cur ?? defaultWatchlist(watchlists));
    setCustom((cur) => cur ?? { from: s.lastTradeDate || s.today, to: s.lastTradeDate || s.today });
  }, []);

  const { from, to } = status && custom ? liveRange(range, { today, lastTradeDate: status.lastTradeDate, custom }) : {};

  const loadTrades = useCallback(async () => {
    if (!from || !to) return;
    const id = ++latest.current;
    const q = new URLSearchParams({ from, to, ...(listId && { watchlist: String(listId) }) });
    try {
      const d = await api(`/api/paper-trades?${q}`);
      if (id !== latest.current) return;
      setData(d);
      setError(null);
    } catch (err) {
      if (id === latest.current) setError(err.message);
    }
  }, [from, to, listId, tick]);

  useEffect(() => {
    loadStatus().catch((err) => setError(err.message));
  }, [loadStatus]);

  useEffect(() => {
    loadTrades();
  }, [loadTrades]);

  async function refresh() {
    setRefreshing(true);
    try {
      await loadStatus();
      setTick((n) => n + 1);
    } catch (err) {
      setError(err.message);
    }
    setRefreshing(false);
  }

  async function recheck(date) {
    setRechecking(date);
    try {
      await api(`/api/paper-trades/${date}/reconcile`, { method: 'POST' });
      await loadTrades();
    } catch (err) {
      setError(err.message);
    }
    setRechecking(null);
  }

  // Editing a date makes the range custom, starting from what is shown.
  function pickDate(key, value) {
    if (!value) return;
    setCustom({ from, to, [key]: value });
    setRange('custom');
  }

  if (error && !data) return <div className="banner banner-error">{error}</div>;
  if (!data || !status || !lists) return <p className="placeholder">Loading live paper trading…</p>;

  const oneDay = from === to;
  const pick = data.trades.find((t) => keyOf(t) === selected);
  const select = (k) => setSelected((cur) => (cur === k ? null : k));
  const rows = dailyRows(data.trades);
  const { summary } = data;
  const span = oneDay ? dateLong(from) : `${dateShort(from)} – ${dateShort(to)}`;

  return (
    <div className="stack">
      <div className="row page-head" style={{ alignItems: 'flex-end' }}>
        <div className="spacer">
          <h1 className="display">Live paper</h1>
          <p className="page-sub">
            {status.watchlist ? `Trading “${status.watchlist}” · ` : ''}
            {sessionLabel(status)} · no orders are placed
          </p>
        </div>
        <button className="btn" onClick={refresh} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
      </div>

      <div className="research-row">
        <Segmented label="Range" value={range} options={RANGES} onChange={setRange} />
        <label className="affix">From
          <input className="input input-date" type="date" value={from} max={to} onChange={(e) => pickDate('from', e.target.value)} />
        </label>
        <label className="affix">To
          <input className="input input-date" type="date" value={to} min={from} max={today} onChange={(e) => pickDate('to', e.target.value)} />
        </label>
        <label className="affix">List
          <select className="input" value={listId ?? ''} onChange={(e) => { setListId(Number(e.target.value)); setSelected(null); }}>
            {lists.map((w) => <option key={w.id} value={w.id}>{w.name} · {qty(w.count)}</option>)}
          </select>
        </label>
      </div>

      <Notice notice={liveNotice(status)} />
      {error && <div className="banner banner-error">{error}</div>}
      <Coverage coverage={data.coverage} />

      <div className="stat-grid stat-grid-fit">
        <Stat label="Net P&L" value={pnl(summary.netPnl)} className={tone(summary.netPnl)} sub={`${span}, closed trades`} />
        <Stat label="Trades" value={qty(summary.trades)} sub={`${qty(summary.open)} open`} />
        <Stat label="Win rate" value={summary.winRate === null ? '—' : rate(summary.winRate)} sub={`${qty(summary.wins)} W · ${qty(summary.losses)} L`} />
        <Stat label="Days traded" value={qty(rows.length)} sub={oneDay ? '' : `${dateShort(from)} – ${dateShort(to)}`} />
      </div>

      {pick && <TradeDay key={keyOf(pick)} trade={pick} onClose={() => setSelected(null)} />}

      <section className="stack">
        <h2 className="title-lg">{oneDay ? `Trades · ${dateLong(from)}` : 'Trades'}</h2>
        {!oneDay && rows.length > 1 && (
          <div className="card">
            <PnlBars rows={rows} label={(r) => dateShort(r.key)} />
          </div>
        )}
        {data.trades.length ? (
          <TradesTable trades={data.trades} selected={selected} onSelect={select} showDate={!oneDay} />
        ) : (
          <p className="caption">
            No paper trades {oneDay ? `on ${dateLong(from)}` : `from ${dateShort(from)} to ${dateShort(to)}`}
            {from === today ? '. Refresh to see new breakouts.' : '.'}
          </p>
        )}
      </section>

      <Reconciliations items={data.reconciliations} onRecheck={recheck} busy={rechecking} />
    </div>
  );
}
