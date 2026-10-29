// Live paper trading (M6): the API's scheduler state, today's paper trades and
// the history over a chosen window. Nothing here places orders; the session
// runs inside the API (api/live.js) and this page only reads what it recorded.
// Clicking a trade loads that day's candles from Fyers (one call, not stored).

import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { connectFyers } from '../lib/me.jsx';
import { addDays, istToday } from '../lib/dates.js';
import { dateLong, dateShort, pnl, price, qty, rate, tone } from '../lib/format.js';
import { dailyRows, inLiveWindow, liveNotice, reconLabel, sessionLabel } from '../lib/live.js';
import { PnlBars } from '../components/charts.jsx';
import { Stat } from '../components/MetricCards.jsx';
import TradeChart from '../components/TradeChart.jsx';
import Segmented from '../components/Segmented.jsx';
import Icon from '../components/Icon.jsx';

const POLL_MS = 30000;
const WINDOWS = [['7', '7 days'], ['30', '30 days'], ['90', '90 days']];
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

export default function Live() {
  const [status, setStatus] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [days, setDays] = useState('30');
  const [selected, setSelected] = useState(null);
  const [rechecking, setRechecking] = useState(null);
  const today = istToday();

  const load = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([
        api('/api/live/status'),
        api(`/api/paper-trades?from=${addDays(today, -(Number(days) - 1))}&to=${today}`),
      ]);
      setStatus(s);
      setData(d);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [days, today]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll only while a session can be producing trades.
  const live = inLiveWindow();
  useEffect(() => {
    if (!live) return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [live, load]);

  async function recheck(date) {
    setRechecking(date);
    try {
      await api(`/api/paper-trades/${date}/reconcile`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err.message);
    }
    setRechecking(null);
  }

  if (error && !data) return <div className="banner banner-error">{error}</div>;
  if (!data || !status) return <p className="placeholder">Loading live paper trading…</p>;

  const todays = data.trades.filter((t) => t.date === today);
  const history = data.trades.filter((t) => t.date !== today);
  const pick = data.trades.find((t) => keyOf(t) === selected);
  const select = (k) => setSelected((cur) => (cur === k ? null : k));
  const rows = dailyRows(data.trades);
  const todayPnl = todays.filter((t) => t.status === 'closed').reduce((sum, t) => sum + t.pnl, 0);
  const { summary } = data;

  return (
    <div className="stack">
      <div className="row page-head" style={{ alignItems: 'flex-end' }}>
        <div className="spacer">
          <h1 className="display">Live paper</h1>
          <p className="page-sub">
            {status.watchlist ? `Watchlist “${status.watchlist}” · ` : ''}
            {sessionLabel(status)} · no orders are placed
          </p>
        </div>
        <Segmented label="History window" value={days} options={WINDOWS} onChange={setDays} />
      </div>

      <Notice notice={liveNotice(status)} />
      {error && <div className="banner banner-error">{error}</div>}

      <div className="stat-grid stat-grid-fit">
        <Stat label="Net P&L" value={pnl(summary.netPnl)} className={tone(summary.netPnl)} sub={`${days} days, closed trades`} />
        <Stat label="Trades" value={qty(summary.trades)} sub={`${qty(summary.open)} open`} />
        <Stat label="Win rate" value={summary.winRate === null ? '—' : rate(summary.winRate)} sub={`${qty(summary.wins)} W · ${qty(summary.losses)} L`} />
        <Stat label="Today" value={pnl(todayPnl)} className={tone(todayPnl)} sub={`${qty(todays.length)} trades`} />
      </div>

      {pick && <TradeDay key={keyOf(pick)} trade={pick} onClose={() => setSelected(null)} />}

      <section className="stack">
        <h2 className="title-lg">Today · {dateShort(today)}</h2>
        {todays.length ? (
          <TradesTable trades={todays} selected={selected} onSelect={select} />
        ) : (
          <p className="caption">No paper trades yet today.{live ? ' Breakouts appear here within 30 seconds.' : ''}</p>
        )}
      </section>

      <section className="stack">
        <h2 className="title-lg">History</h2>
        {rows.length > 0 && (
          <div className="card">
            <PnlBars rows={rows} label={(r) => dateShort(r.key)} />
          </div>
        )}
        {history.length ? (
          <TradesTable trades={history} selected={selected} onSelect={select} showDate />
        ) : (
          <p className="caption">No paper trades in the last {days} days.</p>
        )}
      </section>

      <Reconciliations items={data.reconciliations} onRecheck={recheck} busy={rechecking} />
    </div>
  );
}
