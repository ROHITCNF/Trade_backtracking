// Run dashboard (F6; Run dashboard.png). `/` shows the latest finished run,
// `/runs/:id` a chosen one. Filters live in the URL and every number on the
// page is recomputed for them by the API (FR-24) — nothing is derived here.

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { dateShort, duration, istDateTime, pnl, profitFactor, qty, rate, rMultiple, rupees, tone } from '../lib/format.js';
import { runTitle, stopLabel, targetLabel } from '../lib/runs.js';
import { EquityChart, Histogram, PnlBars, Sparkline } from '../components/charts.jsx';
import StatusPill from '../components/StatusPill.jsx';
import EmptyRuns from '../components/EmptyRuns.jsx';
import Segmented from '../components/Segmented.jsx';
import Icon from '../components/Icon.jsx';
import MetricCards, { Stat } from '../components/MetricCards.jsx';
import { useNarrow } from '../lib/useMedia.js';

const short = (s) => s.replace(/^NSE:|-EQ$/g, '');
const REASON_LABEL = { TARGET: 'Target', SL: 'Stop loss', EOD: 'End of day' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym) => `${MONTHS[Number(ym.slice(5)) - 1]} '${ym.slice(2, 4)}`;

// The run to show: the URL's, else the newest finished one.
function useRunId() {
  const { id } = useParams();
  const [latest, setLatest] = useState(id ? Number(id) : undefined);
  useEffect(() => {
    if (id) return setLatest(Number(id));
    api('/api/runs').then(({ items }) => {
      const runs = items.flatMap((it) => (it.type === 'run' ? [it.run] : it.runs));
      setLatest(runs.find((r) => r.status === 'done')?.id ?? null);
    }, () => setLatest(null));
  }, [id]);
  return latest;
}

// Months covered by the run, for the Period filter.
function monthsBetween(from, to) {
  const out = [];
  let [y, m] = from.slice(0, 7).split('-').map(Number);
  const [ty, tm] = to.slice(0, 7).split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

function filterQuery(params) {
  const q = new URLSearchParams();
  if (params.get('side')) q.set('side', params.get('side'));
  if (params.get('reason')) q.set('reason', params.get('reason'));
  const period = params.get('period');
  if (period) {
    const [y, m] = period.split('-').map(Number);
    q.set('from', `${period}-01`);
    q.set('to', new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10));
  }
  if (params.get('symbol')) q.set('symbols', params.get('symbol'));
  return q.toString();
}

async function downloadCsv(runId, query) {
  const res = await api(`/api/runs/${runId}/trades?${query}${query ? '&' : ''}format=csv`, { raw: true });
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: `run-${runId}-trades.csv` });
  a.click();
  URL.revokeObjectURL(url);
}

function SettingsStrip({ run }) {
  const c = run.config;
  const items = [
    ['Dates', `${dateShort(run.fromDate)} → ${dateShort(run.toDate)}`],
    ['Symbols', run.watchlistName ? `${run.watchlistName} – ${run.total}` : `${run.total} picked`],
    ['Direction', { both: 'Both', long: 'Long', short: 'Short' }[c.direction]],
    ['Opening range', `${c.orbStart}–${c.orbEnd}`],
    ['Session end', c.sessionEnd],
    ['Stop', stopLabel(c).replace(/^SL /, '').replace(/^\w/, (x) => x.toUpperCase())],
    ['Target', targetLabel(c).replace(/^TGT /, '')],
    ['Sizing', c.sizing === 'fixed' ? `${c.quantity} shares` : `${rupees(c.capitalPerTrade)} × ${c.leverage}x · entry-price`],
    ['Costs', `${c.costBps} bps round-trip`],
  ];
  return (
    <div className="card settings-strip">
      {items.map(([k, v]) => (
        <div key={k}><span className="label">{k}</span><span>{v}</span></div>
      ))}
    </div>
  );
}

function Filters({ params, setParams, run, symbols, count, totalCount }) {
  const set = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const traded = symbols.filter((s) => s.status === 'done').map((s) => s.symbol).sort();
  return (
    <div className="filters">
      <span className="label">Side</span>
      <Segmented value={params.get('side') || ''} options={[['', 'All'], ['long', 'Long'], ['short', 'Short']]} onChange={(v) => set('side', v)} label="Side" />
      <span className="label">Exit</span>
      <Segmented value={params.get('reason') || ''} options={[['', 'All'], ['SL', 'SL'], ['TARGET', 'Target'], ['EOD', 'EOD']]} onChange={(v) => set('reason', v)} label="Exit reason" />
      <span className="label">Period</span>
      <select className="input" value={params.get('period') || ''} onChange={(e) => set('period', e.target.value)}>
        <option value="">Full range</option>
        {monthsBetween(run.fromDate, run.toDate).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
      </select>
      <span className="label">Symbol</span>
      <select className="input" value={params.get('symbol') || ''} onChange={(e) => set('symbol', e.target.value)}>
        <option value="">All symbols</option>
        {traded.map((s) => <option key={s} value={s}>{short(s)}</option>)}
      </select>
      <span className="spacer" />
      <span className="caption">Showing <b>{qty(count)}</b> of {qty(totalCount)} trades</span>
    </div>
  );
}

const TICKER_COLUMNS = [
  ['trades', 'Trades', (r) => r.trades, qty],
  ['winRate', 'Win %', (r) => r.winRate, rate],
  ['totalPnl', 'Total P&L', (r) => r.totalPnl, pnl, true],
  ['expectancy', 'Expectancy', (r) => r.expectancy, pnl, true],
  ['profitFactor', 'PF', (r) => (r.profitFactor === null ? Infinity : r.profitFactor), (v) => profitFactor(v === Infinity ? null : v)],
  ['avgR', 'Avg R', (r) => r.avgR, rMultiple, true],
  ['avgWin', 'Avg win', (r) => r.avgWin, pnl, true],
  ['avgLoss', 'Avg loss', (r) => r.avgLoss, pnl, true],
  ['maxDrawdown', 'Max DD', (r) => -r.maxDrawdown, pnl, true],
  ['bestTrade', 'Best', (r) => r.bestTrade, pnl, true],
  ['worstTrade', 'Worst', (r) => r.worstTrade, pnl, true],
];

const MOBILE_ROWS = 12;

// Phones get a list instead of the 16-column table (Mobile · Dashboard.png).
function TickerList({ rows, runId }) {
  const navigate = useNavigate();
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, MOBILE_ROWS);
  return (
    <section className="card" style={{ padding: 0 }}>
      <div className="row" style={{ padding: 'var(--s-3) var(--s-4)' }}>
        <h2 className="section spacer">Per ticker</h2><span className="caption">by P&amp;L</span>
      </div>
      <ul className="ticker-list">
        {shown.map((r) => (
          <li key={r.symbol} onClick={() => navigate(`/runs/${runId}/symbols/${encodeURIComponent(r.symbol)}`)}>
            <span><b>{short(r.symbol)}</b><span className="cell-sub">{r.trades} trades · {Math.round(r.winRate)}% win · PF {profitFactor(r.profitFactor)}</span></span>
            <Sparkline values={r.curve} />
            <b className={`num ${tone(r.totalPnl)}`}>{pnl(r.totalPnl)}</b>
          </li>
        ))}
      </ul>
      {rows.length > MOBILE_ROWS && (
        <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${rows.length} symbols`}
        </button>
      )}
    </section>
  );
}

function TickerTable({ rows, idle, runId }) {
  const navigate = useNavigate();
  const narrow = useNarrow();
  const [sort, setSort] = useState(['totalPnl', -1]);
  const [q, setQ] = useState('');
  const needle = q.trim().toUpperCase();
  const shown = useMemo(() => {
    const col = TICKER_COLUMNS.find((c) => c[0] === sort[0]);
    const filtered = rows.filter((r) => !needle || r.symbol.includes(needle) || (r.name || '').toUpperCase().includes(needle));
    return [...filtered].sort((a, b) => (col[2](a) - col[2](b)) * sort[1]);
  }, [rows, sort, needle]);
  const idleShown = idle.filter((s) => !needle || s.symbol.includes(needle));
  if (narrow) return <TickerList rows={[...rows].sort((a, b) => b.totalPnl - a.totalPnl)} runId={runId} />;
  return (
    <section className="card" style={{ padding: 0 }}>
      <div className="row" style={{ padding: 'var(--s-3) var(--s-4)' }}>
        <h2 className="section">Per ticker</h2>
        <span className="caption">{rows.length} symbols · click a symbol for its trades</span>
        <span className="spacer" />
        <input className="input" style={{ width: 240 }} placeholder="Search symbol or company" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="table-wrap">
        <table className="data ticker-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Equity</th>
              {TICKER_COLUMNS.map((col) => <TickerHead key={col[0]} col={col} sort={sort} setSort={setSort} />)}
              <th className="num">Qty</th>
              <th className="num">Avg notional</th>
              <th>Exits</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.symbol} className="clickable" onClick={() => navigate(`/runs/${runId}/symbols/${encodeURIComponent(r.symbol)}`)}>
                <td><b>{short(r.symbol)}</b>{r.name && <span className="cell-sub">{r.name}</span>}</td>
                <td><Sparkline values={r.curve} /></td>
                {TICKER_COLUMNS.map(([k, , get, fmt, signed]) => {
                  const v = get(r);
                  return <td key={k} className={`num ${signed ? tone(v) : ''}`}>{fmt(v)}</td>;
                })}
                <td className="num">{r.qtyRange}</td>
                <td className="num">{rupees(r.avgNotional)}</td>
                <td className="caption nowrap">{r.exits}</td>
              </tr>
            ))}
            {idleShown.map((s) => (
              <tr key={s.symbol} className="muted">
                <td><b>{short(s.symbol)}</b></td>
                <td colSpan={TICKER_COLUMNS.length + 4}>
                  {s.status === 'skipped' ? 'Skipped · no breakout trades in range' : s.status === 'failed' ? `Fetch failed · ${s.reason}` : 'Not fetched'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TickerHead({ col: [key, label], sort, setSort }) {
  return (
    <th className="num sortable" onClick={() => setSort([key, sort[0] === key ? -sort[1] : -1])}
      aria-sort={sort[0] === key ? (sort[1] < 0 ? 'descending' : 'ascending') : 'none'}>
      {label}{sort[0] === key ? (sort[1] < 0 ? ' ↓' : ' ↑') : ''}
    </th>
  );
}

function Skeleton() {
  return (
    <div className="stack" aria-busy="true">
      <div className="skel" style={{ width: 240, height: 22 }} />
      <div className="skel" style={{ height: 56 }} />
      <div className="stat-grid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skel" style={{ height: 72 }} />)}</div>
      <div className="skel" style={{ height: 300 }} />
      <span className="caption">Loading run results…</span>
    </div>
  );
}

export default function Dashboard() {
  const { id: routeId } = useParams();
  const runId = useRunId();
  const [params, setParams] = useSearchParams();
  const query = filterQuery(params);
  const [run, setRun] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!runId) return;
    setRun(null);
    api(`/api/runs/${runId}`).then(setRun, (err) => setError(err.message));
  }, [runId]);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    api(`/api/runs/${runId}/analysis${query ? `?${query}` : ''}`).then(
      (a) => !cancelled && setAnalysis(a),
      (err) => !cancelled && setError(err.message)
    );
    return () => {
      cancelled = true;
    };
  }, [runId, query]);

  if (runId === null) return <EmptyRuns />;
  if (error) return <div className="banner banner-error">{error}</div>;
  if (!run || !analysis) return <Skeleton />;

  const r = run.run;
  const m = analysis.metrics;
  const p = analysis.portfolio;
  const b = analysis.breakdowns;
  const isLatest = !routeId;
  const ranFor = r.startedAt && r.finishedAt ? (new Date(r.finishedAt) - new Date(r.startedAt)) / 1000 : null;
  const tradedIds = new Set(analysis.symbols.map((s) => s.symbol));
  const idle = run.symbols.filter((s) => s.status !== 'done' && !tradedIds.has(s.symbol));
  const filtered = Boolean(query);

  return (
    <div className="stack dashboard">
      <div className="breadcrumb"><Link to="/runs">Runs</Link> / {isLatest ? 'Latest run' : runTitle(r)}</div>
      <div className="row page-head" style={{ alignItems: 'flex-start' }}>
        <div className="spacer">
          <div className="row"><h1 className="display">{runTitle(r)}</h1><StatusPill status={r.status} /></div>
          <p className="caption" style={{ fontSize: 13.5, margin: '4px 0 0' }}>
            Created {istDateTime(r.createdAt)} IST{ranFor !== null && ` · ran in ${duration(ranFor)}`} · {qty(r.callsUsed)} Fyers calls
          </p>
        </div>
        {run.sweepRunIds.length > 1 && <Link className="btn" to={`/compare?sweep=${r.sweepId}`}>Compare targets</Link>}
        <Link className="btn" to="/runs">Compare</Link>
        <Link className="btn" to={`/new?run=${r.id}`}>Duplicate as new run</Link>
        <button className="btn btn-primary" onClick={() => downloadCsv(r.id, query)}>Export CSV</button>
      </div>

      {r.status !== 'done' && (
        <div className="banner banner-row"><Icon name="warn" /><span>This run is <b>{r.status}</b>; numbers cover the {r.done} of {r.total} symbols that finished. <Link to={`/runs/${r.id}/progress`}>Progress</Link></span></div>
      )}

      <SettingsStrip run={r} />
      <Filters params={params} setParams={setParams} run={r} symbols={run.symbols} count={analysis.count} totalCount={analysis.totalCount} />

      {analysis.count === 0 ? (
        <div className="card empty"><h2 className="title">No trades match these filters</h2><button className="btn" onClick={() => setParams({}, { replace: true })}>Clear filters</button></div>
      ) : (
        <>
          {analysis.warnings.smallSample && (
            <div className="banner banner-row"><Icon name="warn" /><span><b>Small sample — {analysis.count} trades.</b> <span className="warn">Under 30 trades, these numbers move a lot with each new trade. Widen the range or symbols before trusting them.</span></span></div>
          )}

          <MetricCards analysis={analysis} filtered={filtered} />

          {p && (
            <div className="portfolio-grid">
              <Stat label="Profitable symbols" value={<>{p.winners} <span className="flat">/ {p.symbolsTraded}</span></>}
                sub={`${p.symbolsTraded} traded${p.symbols.skipped ? ` · ${p.symbols.skipped} skipped (no trades)` : ''}${p.symbols.failed ? ` · ${p.symbols.failed} failed` : ''}`} />
              <Stat label="Median symbol P&L" value={pnl(p.medianPnl)} className={tone(p.medianPnl)} sub="half the symbols did better than this" />
              <div className={`stat-card${analysis.warnings.concentrated ? ' stat-warn' : ''}`}>
                <span className="label">Top symbol’s share of P&amp;L</span>
                <span className="stat">{p.topShare > 0 ? `${p.topShare.toFixed(0)}%` : '—'} <span className="caption">{p.bestSymbol}</span></span>
                <span className={analysis.warnings.concentrated ? 'warn' : 'caption'}>
                  {analysis.warnings.concentrated ? 'One symbol carries most of the result — check it isn’t luck' : 'how much one name drives the total'}
                </span>
              </div>
              <Stat label="Best symbol" value={pnl(analysis.symbols[0].totalPnl)} className={tone(analysis.symbols[0].totalPnl)} sub={`${p.bestSymbol} · ${analysis.symbols[0].trades} trades`} />
              <Stat label="Worst symbol" value={pnl(analysis.symbols.at(-1).totalPnl)} className={tone(analysis.symbols.at(-1).totalPnl)} sub={`${p.worstSymbol} · ${analysis.symbols.at(-1).trades} trades`} />
            </div>
          )}

          <section className="card chart-card">
            <div className="row"><h2 className="section">Equity curve</h2><span className="caption">cumulative closed P&amp;L, ₹</span><span className="spacer" /><span className="caption">Net <b className={tone(m.totalPnl)}>{pnl(m.totalPnl)}</b></span></div>
            <EquityChart curve={m.curve} />
            <span className="caption">Drawdown · max {pnl(-m.maxDrawdown)}</span>
          </section>

          <div className="chart-grid">
            <section className="card chart-card"><div className="row"><h2 className="section spacer">P&amp;L by month</h2><span className="caption">₹, net</span></div>
              <PnlBars rows={b.month} label={(x) => monthLabel(x.key)} /></section>
            <section className="card chart-card"><div className="row"><h2 className="section spacer">P&amp;L % per trade</h2><span className="caption">count of trades per 0.2% bucket</span></div>
              <Histogram bins={b.histogram} /></section>
            <section className="card chart-card"><div className="row"><h2 className="section spacer">P&amp;L by weekday</h2><span className="caption">₹, net</span></div>
              <PnlBars rows={b.weekday} /></section>
            <section className="card chart-card"><div className="row"><h2 className="section spacer">P&amp;L by entry time</h2><span className="caption">IST, by breakout candle</span></div>
              <PnlBars rows={b.entryTime.filter((x, i, all) => x.trades > 0 || all.slice(i).some((y) => y.trades > 0))} label={(x) => x.key.replace('–', '–​')} /></section>
            <section className="card chart-card">
              <div className="row"><h2 className="section spacer">Exit reasons</h2><span className="caption">share of trades</span></div>
              <div className="share-bar">
                {b.reason.map((x) => <span key={x.key} className={`share-${x.key}`} style={{ width: `${x.share}%` }} title={`${REASON_LABEL[x.key]} ${x.share}%`} />)}
              </div>
              <div className="table-wrap"><table className="data compact">
                <thead><tr><th>Reason</th><th className="num">Trades</th><th className="num">Share</th><th className="num">Avg R</th><th className="num">P&amp;L</th></tr></thead>
                <tbody>
                  {b.reason.map((x) => (
                    <tr key={x.key}>
                      <td><span className={`swatch share-${x.key}`} />{REASON_LABEL[x.key]}</td>
                      <td className="num">{qty(x.trades)}</td><td className="num">{x.share.toFixed(0)}%</td>
                      <td className={`num ${tone(x.avgR)}`}>{x.trades ? rMultiple(x.avgR) : '—'}</td>
                      <td className={`num ${tone(x.pnl)}`}>{pnl(x.pnl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </section>
            <section className="card chart-card">
              <div className="row"><h2 className="section spacer">Long vs short</h2><span className="caption">same filters</span></div>
              <div className="table-wrap"><table className="data compact">
                <thead><tr><th>Side</th><th className="num">Trades</th><th className="num">Win %</th><th className="num">Expectancy</th><th className="num">PF</th><th className="num">Avg R</th><th className="num">P&amp;L</th></tr></thead>
                <tbody>
                  {b.side.map((x) => (
                    <tr key={x.key}>
                      <td>{x.key === 'long' ? 'Long' : 'Short'}</td>
                      <td className="num">{qty(x.trades)}</td><td className="num">{x.trades ? rate(x.winRate) : '—'}</td>
                      <td className={`num ${tone(x.expectancy)}`}>{x.trades ? pnl(x.expectancy) : '—'}</td>
                      <td className="num">{x.trades ? profitFactor(x.profitFactor) : '—'}</td>
                      <td className={`num ${tone(x.avgR)}`}>{x.trades ? rMultiple(x.avgR) : '—'}</td>
                      <td className={`num ${tone(x.pnl)}`}>{pnl(x.pnl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </section>
          </div>

          <TickerTable rows={analysis.symbols} idle={filtered ? [] : idle} runId={r.id} />
        </>
      )}
    </div>
  );
}
