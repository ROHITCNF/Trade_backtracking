// One research run's results (v2/Research — desktop.png, lower part): title,
// narrative, six stat tiles, Long vs short, How trades ended, daily equity,
// month / weekday / entry-time bars and the By symbol table. Every number comes
// from /api/runs/:id/analysis (FR-24); the View select filters by symbol and
// ?from=&to= narrows to a date range (the Journal links here for one day).

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { dateLong, dateShort, pnl, profitFactor, qty, rate, rMultiple, tone } from '../lib/format.js';
import { settingsLabel } from '../lib/runs.js';
import { cardTitle, sameStrategy } from '../lib/research.js';
import { dailyCurve, tradingDays } from '../lib/summary.js';
import { EquityChart, PnlBars, Sparkline } from './charts.jsx';
import { LongShort, Narrative, TradesEnded } from './Summary.jsx';
import Icon from './Icon.jsx';

const short = (s) => s.replace(/^NSE:|-EQ$/g, '');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ROWS_SHOWN = 15;

const COLUMNS = [
  ['trades', 'Trades', (r) => r.trades, qty],
  ['winRate', 'Win %', (r) => r.winRate, (v) => `${Math.round(v)}%`],
  ['expectancy', 'Expectancy', (r) => r.expectancy, pnl, true],
  ['profitFactor', 'PF', (r) => (r.profitFactor === null ? Infinity : r.profitFactor), (v) => profitFactor(v === Infinity ? null : v)],
  ['avgR', 'Avg R', (r) => r.avgR, rMultiple, true],
  ['totalPnl', 'Total P&L', (r) => r.totalPnl, pnl, true],
];

async function downloadCsv(runId, query) {
  const res = await api(`/api/runs/${runId}/trades?${query}${query ? '&' : ''}format=csv`, { raw: true });
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: `run-${runId}-trades.csv` });
  a.click();
  URL.revokeObjectURL(url);
}

function BySymbol({ rows, runId }) {
  const navigate = useNavigate();
  const [sort, setSort] = useState(['totalPnl', -1]);
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const needle = q.trim().toUpperCase();
  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c[0] === sort[0]);
    const hit = rows.filter((r) => !needle || r.symbol.includes(needle) || (r.name || '').toUpperCase().includes(needle));
    return [...hit].sort((a, b) => (col[2](a) - col[2](b)) * sort[1]);
  }, [rows, sort, needle]);
  const shown = all || needle ? sorted : sorted.slice(0, ROWS_SHOWN);
  const open = (symbol) => navigate(`/runs/${runId}/symbols/${encodeURIComponent(symbol)}`);

  return (
    <section className="card" style={{ padding: 0 }}>
      <div className="row by-symbol-head">
        <h2 className="section">By symbol</h2>
        <span className="caption">· {rows.length} symbols · click one to see its trades</span>
        <span className="spacer" />
        <input className="input" placeholder="Search symbol" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="table-wrap">
        <table className="data by-symbol">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Equity</th>
              {COLUMNS.map(([key, label]) => (
                <th key={key} className="num sortable" onClick={() => setSort([key, sort[0] === key ? -sort[1] : -1])}
                  aria-sort={sort[0] === key ? (sort[1] < 0 ? 'descending' : 'ascending') : 'none'}>
                  {label}{sort[0] === key ? (sort[1] < 0 ? ' ↓' : ' ↑') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.symbol} className="clickable" onClick={() => open(r.symbol)}>
                <td><Link to={`/runs/${runId}/symbols/${encodeURIComponent(r.symbol)}`} onClick={(e) => e.stopPropagation()}><b>{short(r.symbol)}</b></Link></td>
                <td><Sparkline values={r.curve} width={80} height={22} /></td>
                {COLUMNS.map(([k, , get, fmt, signed]) => {
                  const v = get(r);
                  return <td key={k} className={`num ${signed ? tone(v) : ''}`}>{k === 'totalPnl' ? <b>{fmt(v)}</b> : fmt(v)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!needle && rows.length > ROWS_SHOWN && (
        <button className="btn btn-ghost show-all" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${rows.length} symbols`}</button>
      )}
    </section>
  );
}

function Skeleton() {
  return (
    <div className="stack" aria-busy="true">
      <div className="skel" style={{ width: 280, height: 26 }} />
      <div className="skel" style={{ height: 64 }} />
      <div className="skel" style={{ height: 300 }} />
    </div>
  );
}

export default function RunResults({ run, strategy }) {
  const [params, setParams] = useSearchParams();
  const symbol = params.get('symbol') || '';
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (symbol) q.set('symbols', symbol);
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    return q.toString();
  }, [symbol, from, to]);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api(`/api/runs/${run.id}/analysis${query ? `?${query}` : ''}`).then(
      (a) => !cancelled && setAnalysis(a),
      (err) => !cancelled && setError(err.message)
    );
    return () => {
      cancelled = true;
    };
  }, [run.id, query]);

  const set = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    setParams(next, { replace: true });
  };

  // The symbol list for the View select stays the run's, whatever the filter.
  const [allSymbols, setAllSymbols] = useState([]);
  useEffect(() => {
    if (analysis && !query) setAllSymbols(analysis.symbols.map((s) => s.symbol).sort());
  }, [analysis, query]);

  if (error) return <div className="banner banner-error">{error}</div>;
  if (!analysis || analysis.run.id !== run.id) return <Skeleton />;

  const m = analysis.metrics;
  const b = analysis.breakdowns;
  const curve = dailyCurve(m.curve);
  const days = tradingDays(m.curve);
  const isDefault = strategy && sameStrategy(run.config, strategy);
  const period = from && from === to ? dateLong(from) : from || to ? `${from ? dateShort(from) : '…'} → ${to ? dateShort(to) : '…'}` : null;

  return (
    <div className="stack results">
      <div className="results-head">
        <div className="spacer">
          <h2 className="title-lg">{cardTitle(run)} · {dateShort(run.fromDate)} → {dateShort(run.toDate)}</h2>
          <span className="caption">
            {qty(run.total)} symbol{run.total === 1 ? '' : 's'} · {days} trading day{days === 1 ? '' : 's'} · {isDefault ? 'Default strategy' : settingsLabel(run.config)}
          </span>
        </div>
        <label className="affix">View
          <select className="input" value={symbol} onChange={(e) => set({ symbol: e.target.value })}>
            <option value="">All symbols</option>
            {allSymbols.map((s) => <option key={s} value={s}>{short(s)}</option>)}
          </select>
        </label>
        <button className="btn" onClick={() => downloadCsv(run.id, query)}>Export CSV</button>
      </div>

      {period && (
        <div className="row">
          <span className="filter-chip">{period}<button aria-label="Show the whole range" onClick={() => set({ from: '', to: '' })}><Icon name="close" size={12} /></button></span>
        </div>
      )}

      {analysis.count === 0 ? (
        <div className="card empty"><h2 className="title">No trades in this view</h2><button className="btn" onClick={() => set({ symbol: '', from: '', to: '' })}>Show everything</button></div>
      ) : (
        <>
          <Narrative analysis={analysis} className="narrative-lg" />

          {analysis.warnings.smallSample && (
            <div className="banner banner-row"><Icon name="warn" /><span><b>Small sample — {analysis.count} trades.</b> <span className="warn">Under 30 trades, these numbers move a lot with each new trade.</span></span></div>
          )}
          {analysis.warnings.concentrated && (
            <div className="banner banner-row"><Icon name="warn" /><span><b>{analysis.portfolio.bestSymbol} carries {Math.round(analysis.portfolio.topShare)}% of the P&amp;L.</b> <span className="warn">Check one name isn’t the whole result.</span></span></div>
          )}

          <div className="tiles">
            <div className="tile"><span className="label">Net P&amp;L</span><span className={`stat ${tone(m.totalPnl)}`}>{pnl(m.totalPnl)}</span></div>
            <div className="tile"><span className="label">Trades</span><span className="stat">{qty(m.totalTrades)}</span></div>
            <div className="tile"><span className="label">Win rate</span><span className="stat">{rate(m.winRate)}</span></div>
            <div className="tile"><span className="label">Profit factor</span><span className="stat">{profitFactor(m.profitFactor)}</span></div>
            <div className="tile"><span className="label">Avg R</span><span className={`stat ${tone(m.avgR)}`}>{rMultiple(m.avgR)}</span></div>
            <div className="tile"><span className="label">Max drawdown</span><span className={`stat ${tone(-m.maxDrawdown)}`}>{pnl(-m.maxDrawdown)}</span></div>
          </div>

          <div className="summary-grid">
            <LongShort analysis={analysis} />
            <TradesEnded analysis={analysis} />
          </div>

          <section className="card chart-card">
            <div className="row"><h2 className="section">Equity</h2><span className="caption">· cumulative ₹, one step per day</span></div>
            <EquityChart curve={curve} />
            <span className="caption">Drawdown · max {pnl(-m.maxDrawdown)}</span>
          </section>

          <div className="chart-grid">
            <section className="card chart-card"><h2 className="section">By month</h2>
              <PnlBars rows={b.month} label={(x) => MONTHS[Number(x.key.slice(5)) - 1]} /></section>
            <section className="card chart-card"><h2 className="section">By weekday</h2>
              <PnlBars rows={b.weekday} /></section>
            <section className="card chart-card"><h2 className="section">By entry time</h2>
              <PnlBars rows={b.entryTime.filter((x, i, all) => x.trades > 0 || all.slice(i).some((y) => y.trades > 0))} label={(x) => x.key.replace(/:00(?=–|$)/g, '').replace(/^(\d+)–/, '$1–')} /></section>
          </div>

          <BySymbol rows={analysis.symbols} runId={run.id} />
        </>
      )}
    </div>
  );
}
