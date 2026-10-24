// Ticker detail + trade panel (F6–F7; Ticker detail + trade panel.png). One
// symbol of one run: its stat cards and equity, every trade, and — for the
// selected trade (?trade=<id>) — the day's candles in place of the equity
// curve (an Equity | Trade toggle flips back) and a panel with the trade's
// numbers. On a phone the panel takes the screen and carries the chart itself. Candles cost one Fyers call, so they load only when a trade
// is opened and are kept for the session; the numbers come from the saved run
// and always render, whatever happens to the chart (States.png).

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { connectFyers } from '../lib/me.jsx';
import { dateLong, dateShort, pctReturn, pnl, price, qty, rMultiple, rupees, tone } from '../lib/format.js';
import { runTitle, settingsLabel } from '../lib/runs.js';
import { EquityChart } from '../components/charts.jsx';
import MetricCards from '../components/MetricCards.jsx';
import TradeChart from '../components/TradeChart.jsx';
import Icon from '../components/Icon.jsx';
import Segmented from '../components/Segmented.jsx';
import { useNarrow } from '../lib/useMedia.js';

const short = (s) => s.replace(/^NSE:|-EQ$/g, '');
const candleCache = new Map(); // trade id -> response, for this browser session

function useCandles(tradeId, attempt) {
  const [state, setState] = useState({});
  useEffect(() => {
    if (!tradeId) return setState({});
    if (candleCache.has(tradeId)) return setState({ data: candleCache.get(tradeId) });
    let cancelled = false;
    setState({ loading: true });
    api(`/api/trades/${tradeId}/candles`).then(
      (data) => {
        candleCache.set(tradeId, data);
        if (!cancelled) setState({ data });
      },
      (err) => !cancelled && setState({ error: err })
    );
    return () => {
      cancelled = true;
    };
  }, [tradeId, attempt]);
  return state;
}

function ChartArea({ state, trade, orbEnd, height, onRetry }) {
  const style = height ? { height } : undefined;
  if (state.loading) {
    return (
      <div className="chart-state" style={style}>
        <div className="skel-bars">{Array.from({ length: 24 }, (_, i) => <span key={i} style={{ height: `${30 + ((i * 37) % 60)}%` }} />)}</div>
        <span className="caption">Loading 1-minute candles from Fyers…</span>
      </div>
    );
  }
  const err = state.error;
  if (err?.status === 409) {
    return (
      <div className="chart-state chart-state-box" style={style}>
        <Icon name="link" size={22} />
        <b>Connect Fyers to load the chart</b>
        <span className="caption">Candles are fetched from the broker on demand. The connection resets every morning — the trade’s numbers below don’t need it.</span>
        <button className="btn btn-primary" onClick={() => connectFyers()}>Connect Fyers</button>
      </div>
    );
  }
  if (err?.status === 503) {
    return (
      <div className="chart-state chart-state-box chart-state-warn" style={style}>
        <Icon name="clock" size={22} />
        <b>Rate limit reached — try later</b>
        <span className="warn">{err.message} Backtest results aren’t affected.</span>
      </div>
    );
  }
  if (err) {
    return (
      <div className="chart-state chart-state-box" style={style}>
        <b>The chart didn’t load</b>
        <span className="caption">{err.message}</span>
        <button className="btn" onClick={onRetry}>Try again</button>
      </div>
    );
  }
  if (!state.data) return null;
  return <TradeChart candles={state.data.candles} trade={trade} orbEnd={orbEnd} height={height} />;
}

// The selected trade's day: candles (or why they're missing) plus the legend.
function TradeDayChart({ trade, orbEnd, height }) {
  const [retry, setRetry] = useState(0);
  const state = useCandles(trade.id, retry);
  const reload = () => {
    candleCache.delete(trade.id);
    setRetry((n) => n + 1);
  };
  return (
    <>
      <div key={`${trade.id}-${retry}`}>
        <ChartArea state={state} trade={trade} orbEnd={orbEnd} height={height} onRetry={reload} />
      </div>
      <div className="legend caption">
        <span><i className="lg-band" />Opening range · {price(trade.orbLow)}–{price(trade.orbHigh)}</span>
        <span><i className="lg-line lg-entry" />Entry</span>
        <span><i className="lg-line lg-sl" />Stop</span>
        <span><i className="lg-line lg-target" />Target</span>
        <span><i className="lg-dot" />Entry {trade.entryTime}</span>
        <span><i className="lg-sq" />Exit {trade.exitTime}</span>
      </div>
    </>
  );
}

function Num({ label, value, className = '' }) {
  return (
    <div className="num-cell">
      <span className="label">{label}</span>
      <b className={className}>{value}</b>
    </div>
  );
}

function TradePanel({ trade, index, total, onPrev, onNext, onClose, orbEnd, mobile = false }) {
  const risk = Math.abs(trade.entry - trade.sl) * trade.quantity;
  return (
    <aside className="card trade-panel">
      <div className="row page-head" style={{ alignItems: 'flex-start' }}>
        <div className="spacer">
          <div className="row">
            <span className="title">{short(trade.symbol)}</span>
            <span className="tag">{trade.side === 'long' ? 'Long' : 'Short'}</span>
            <b className={`title ${tone(trade.pnl)}`}>{pnl(trade.pnl)}</b>
            <span className={tone(trade.rMultiple)}>{rMultiple(trade.rMultiple)}</span>
          </div>
          <span className="caption">{dateLong(trade.date)} · 1-minute · 09:15–15:30 IST</span>
        </div>
        {!mobile && (
          <>
            <span className="caption nowrap" style={{ marginTop: 8 }}>{index + 1} of {total}</span>
            <button className="btn icon-btn" aria-label="Previous trade" disabled={index === 0} onClick={onPrev}>‹</button>
            <button className="btn icon-btn" aria-label="Next trade" disabled={index === total - 1} onClick={onNext}>›</button>
            <button className="btn btn-ghost icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
          </>
        )}
      </div>
      {mobile && <TradeDayChart trade={trade} orbEnd={orbEnd} />}
      <div className="num-grid">
        <Num label="Entry time" value={`${trade.entryTime} IST`} />
        <Num label="Entry" value={`₹${price(trade.entry)}`} />
        <Num label="Stop loss" value={`₹${price(trade.sl)}`} className="loss" />
        <Num label="Target" value={trade.target === null ? '—' : `₹${price(trade.target)}`} className="profit" />
        <Num label="Exit time" value={`${trade.exitTime} IST`} />
        <Num label="Exit" value={`₹${price(trade.exit)}`} />
        <Num label="Exit reason" value={trade.reason} />
        <Num label="Qty" value={qty(trade.quantity)} />
        <Num label="Notional" value={rupees(trade.notional)} />
        <Num label="Risk (1R)" value={rupees(risk)} />
        <Num label="P&L ₹" value={pnl(trade.pnl)} className={tone(trade.pnl)} />
        <Num label="P&L %" value={pctReturn(trade.pnlPct)} className={tone(trade.pnlPct)} />
        <Num label="R multiple" value={rMultiple(trade.rMultiple)} className={tone(trade.rMultiple)} />
        <Num label="OR high" value={`₹${price(trade.orbHigh)}`} />
        <Num label="OR low" value={`₹${price(trade.orbLow)}`} />
        <Num label="OR width" value={`${(((trade.orbHigh - trade.orbLow) / trade.orbLow) * 100).toFixed(2)}%`} />
      </div>
      {mobile && (
        <div className="trade-mobile-bar">
          <button className="btn btn-lg" disabled={index === 0} onClick={onPrev}>‹ Previous</button>
          <button className="btn btn-primary btn-lg" disabled={index === total - 1} onClick={onNext}>Next trade ›</button>
        </div>
      )}
    </aside>
  );
}

export default function TickerDetail() {
  const { id, symbol } = useParams();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const narrow = useNarrow();
  const [view, setView] = useState('trade'); // left card while a trade is open: 'equity' | 'trade'

  useEffect(() => {
    const q = `symbols=${encodeURIComponent(symbol)}`;
    Promise.all([api(`/api/runs/${id}`), api(`/api/runs/${id}/analysis?${q}`), api(`/api/runs/${id}/trades?${q}`)]).then(
      ([run, analysis, { trades }]) => setData({ run: run.run, analysis, trades }),
      (err) => setError(err.message)
    );
  }, [id, symbol]);

  const selectedId = Number(params.get('trade')) || null;
  const index = useMemo(() => (data ? data.trades.findIndex((t) => t.id === selectedId) : -1), [data, selectedId]);
  const select = (tradeId) => {
    if (tradeId) setView('trade');
    const next = new URLSearchParams(params);
    if (tradeId) next.set('trade', tradeId);
    else next.delete('trade');
    setParams(next, { replace: true });
  };

  if (error) return <div className="banner banner-error">{error}</div>;
  if (!data) return <p className="placeholder">Loading…</p>;
  const { run, analysis, trades } = data;
  const name = analysis.symbols[0]?.name;
  const trade = index >= 0 ? trades[index] : null;
  const showTrade = trade && view === 'trade';

  if (trade && narrow) {
    return (
      <div className="stack">
        <div className="row">
          <button className="link-btn accent" onClick={() => select(null)}>‹ {short(symbol)}</button>
          <span className="spacer" />
          <span className="caption">Trade {index + 1} of {trades.length}</span>
        </div>
        <TradePanel key={trade.id} trade={trade} index={index} total={trades.length} orbEnd={run.config.orbEnd} mobile
          onPrev={() => select(trades[index - 1].id)} onNext={() => select(trades[index + 1].id)} onClose={() => select(null)} />
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="breadcrumb"><Link to="/runs">Runs</Link> / <Link to={`/runs/${run.id}`}>{runTitle(run)}</Link> / {short(symbol)}</div>
      <div className="row page-head" style={{ alignItems: 'flex-start' }}>
        <div className="spacer">
          <div className="row" style={{ alignItems: 'baseline' }}>
            <h1 className="display">{short(symbol)}</h1>
            <span className="caption" style={{ fontSize: 14 }}>{name ? `${name} · ` : ''}{symbol}</span>
          </div>
          <p className="caption" style={{ fontSize: 13.5, margin: '4px 0 0' }}>{settingsLabel(run.config)} · {dateShort(run.fromDate)} → {dateShort(run.toDate)}</p>
        </div>
        <Link className="btn" to={`/runs/${run.id}`}>‹ Back to run</Link>
      </div>

      {trades.length === 0 ? (
        <div className="card empty"><h2 className="title">No trades for {short(symbol)} in this run</h2><p>It never broke out of its opening range in the selected dates, or its fetch failed.</p></div>
      ) : (
        <>
          <MetricCards analysis={analysis} />
          <div className={`ticker-layout${trade ? ' with-panel' : ''}`}>
            <div className="stack" style={{ minWidth: 0 }}>
              <section className="card chart-card">
                <div className="row">
                  {showTrade ? (
                    <><h2 className="section">{short(symbol)} · {dateShort(trade.date)}</h2><span className="caption">1-minute · 09:15–15:30 IST</span></>
                  ) : (
                    <><h2 className="section">{short(symbol)} equity</h2><span className="caption">cumulative ₹</span></>
                  )}
                  <span className="spacer" />
                  {!showTrade && <span className="caption">Net <b className={tone(analysis.metrics.totalPnl)}>{pnl(analysis.metrics.totalPnl)}</b></span>}
                  {trade && <Segmented label="Chart" value={view} onChange={setView} options={[['equity', 'Equity'], ['trade', 'Trade']]} />}
                </div>
                {showTrade
                  ? <TradeDayChart key={trade.id} trade={trade} orbEnd={run.config.orbEnd} height={420} />
                  : <EquityChart curve={analysis.metrics.curve} height={300} />}
              </section>
              <section className="card" style={{ padding: 0 }}>
                <div className="row" style={{ padding: 'var(--s-3) var(--s-4)' }}>
                  <h2 className="section">Trades</h2><span className="caption">{trades.length} · select one to see its chart</span>
                </div>
                <div className="table-wrap">
                  <table className="data trade-table">
                    <thead>
                      <tr>
                        <th>Date</th><th>Side</th><th className="num">Entry time</th><th className="num">Entry</th><th className="num">SL</th>
                        <th className="num">Target</th><th className="num">Exit time</th><th className="num">Exit</th><th>Reason</th>
                        <th className="num">Qty</th><th className="num">P&amp;L ₹</th><th className="num">P&amp;L %</th><th className="num">R</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trades.map((t) => (
                        <tr key={t.id} className={`clickable${t.id === selectedId ? ' selected' : ''}`} onClick={() => select(t.id)}>
                          <td><span className="accent-link">{dateShort(t.date)}</span></td>
                          <td>{t.side === 'long' ? 'Long' : 'Short'}</td>
                          <td className="num">{t.entryTime}</td>
                          <td className="num">{price(t.entry)}</td>
                          <td className="num">{price(t.sl)}</td>
                          <td className="num">{t.target === null ? '—' : price(t.target)}</td>
                          <td className="num">{t.exitTime}</td>
                          <td className="num">{price(t.exit)}</td>
                          <td><span className={`swatch share-${t.reason}`} />{t.reason}</td>
                          <td className="num">{qty(t.quantity)}</td>
                          <td className={`num ${tone(t.pnl)}`}><b>{pnl(t.pnl)}</b></td>
                          <td className={`num ${tone(t.pnlPct)}`}>{pctReturn(t.pnlPct)}</td>
                          <td className={`num ${tone(t.rMultiple)}`}>{rMultiple(t.rMultiple)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
            {trade ? (
              <TradePanel key={trade.id} trade={trade} index={index} total={trades.length} orbEnd={run.config.orbEnd}
                onPrev={() => select(trades[index - 1].id)} onNext={() => select(trades[index + 1].id)} onClose={() => select(null)} />
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
