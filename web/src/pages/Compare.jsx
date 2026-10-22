// Compare (F8; Compare runs.png) and Sweep results (F5; Sweep results.png).
// ?ids=1,2[,3,4] compares runs; ?sweep=<id> shows one sweep's target rules;
// neither shows a picker of finished runs and sweeps.

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { dateShort, pnl, profitFactor, qty, rate, rMultiple, tone } from '../lib/format.js';
import { readColors } from '../lib/chartTheme.js';
import { durationLabel, runTitle, settingsLabel, stopLabel, sweepTitle } from '../lib/runs.js';
import { METRIC_ROWS, bestIndex, ruleLabel, settingRows, tickerRows } from '../lib/compare.js';
import { EquityOverlay } from '../components/charts.jsx';
import Icon from '../components/Icon.jsx';

const CAT = ['cat1', 'cat2', 'cat3', 'cat4'];
const short = (s) => s.replace(/^NSE:|-EQ$/g, '');
const SMALL_SAMPLE = 30;

function useCompare(query) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    if (!query) return setState({});
    setState({ loading: true });
    api(`/api/compare?${query}`).then((data) => setState({ data }), (err) => setState({ error: err.message }));
  }, [query]);
  return state;
}

function Picker() {
  const navigate = useNavigate();
  const [items, setItems] = useState(null);
  const [picked, setPicked] = useState([]);
  useEffect(() => {
    api('/api/runs').then(({ items }) => setItems(items));
  }, []);
  if (!items) return <p className="placeholder">Loading…</p>;
  const runs = items.filter((it) => it.type === 'run' && it.run.status === 'done').map((it) => it.run);
  const sweeps = items.filter((it) => it.type === 'sweep' && it.runs.every((r) => r.status === 'done'));
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 4 ? [...p, id] : p));
  return (
    <div className="stack">
      <div className="row">
        <div className="spacer">
          <h1 className="display">Compare runs</h1>
          <p className="caption" style={{ fontSize: 13.5, margin: '4px 0 0' }}>Pick two to four finished runs, or open a sweep.</p>
        </div>
        <button className="btn btn-primary" disabled={picked.length < 2} onClick={() => navigate(`/compare?ids=${picked.join(',')}`)}>
          Compare {picked.length >= 2 ? `${picked.length} runs` : ''}
        </button>
      </div>
      {sweeps.length > 0 && (
        <section className="card stack" style={{ gap: 'var(--s-2)' }}>
          <h2 className="section">Sweeps</h2>
          {sweeps.map((s) => (
            <Link key={s.sweepId} to={`/compare?sweep=${s.sweepId}`}>{sweepTitle(s.runs[0])} · {s.runs.length} target rules · {dateShort(s.runs[0].fromDate)} → {dateShort(s.runs[0].toDate)}</Link>
          ))}
        </section>
      )}
      <section className="card" style={{ padding: 0 }}>
        {runs.length === 0 ? (
          <p className="caption" style={{ padding: 'var(--s-4)' }}>No finished runs yet. <Link to="/new">Start a backtest</Link>.</p>
        ) : (
          <table className="data">
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className={`clickable${picked.includes(r.id) ? ' selected' : ''}`} onClick={() => toggle(r.id)}>
                  <td style={{ width: 36 }}><input type="checkbox" readOnly checked={picked.includes(r.id)} aria-label={`Select ${runTitle(r)}`} /></td>
                  <td><b>{runTitle(r)}</b><span className="cell-sub">{settingsLabel(r.config)}</span></td>
                  <td className="nowrap">{dateShort(r.fromDate)} → {dateShort(r.toDate)}</td>
                  <td className={`num ${tone(r.metrics?.totalPnl)}`}>{pnl(r.metrics?.totalPnl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function RunsCompare({ data }) {
  const [showSame, setShowSame] = useState(false);
  const runs = data.runs;
  const colors = useMemo(readColors, []);
  const color = (i) => `var(--cat-${i + 1})`;
  const rows = settingRows(runs.map((r) => r.run));
  const differ = rows.filter((r) => !r.same);
  const tickers = useMemo(() => tickerRows(runs), [runs]);

  return (
    <div className="stack">
      <div className="row page-head" style={{ alignItems: 'flex-start' }}>
        <div className="spacer">
          <h1 className="display">Compare runs</h1>
          <p className="caption" style={{ fontSize: 13.5, margin: '4px 0 0' }}>
            Best value in each row is marked. Runs over different symbol lists aren’t like-for-like — read the settings first.
          </p>
        </div>
        <Link className="btn" to="/compare">Change runs</Link>
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {runs.map(({ run }, i) => (
          <Link key={run.id} className="run-chip" to={`/runs/${run.id}`}><i style={{ background: color(i) }} />{runTitle(run)}</Link>
        ))}
      </div>

      <section className="card" style={{ padding: 0 }}>
        <div className="row" style={{ padding: 'var(--s-3) var(--s-4)' }}>
          <h2 className="section">Settings</h2>
          <span className="caption">{differ.length} differ, {rows.length - differ.length} identical</span>
          <span className="spacer" />
          <button className="link-btn accent" onClick={() => setShowSame(!showSame)}>{showSame ? 'Hide identical' : 'Show identical'}</button>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Setting</th>{runs.map(({ run }, i) => <th key={run.id}><i className="key-sq" style={{ background: color(i) }} />{runTitle(run)}</th>)}</tr>
            </thead>
            <tbody>
              {(showSame ? rows : differ).map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  {r.values.map((v, i) => <td key={i}>{r.same ? v : <span className="diff-chip">{v}</span>}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="compare-cols" style={{ gridTemplateColumns: `repeat(${runs.length}, minmax(0, 1fr))` }}>
        {runs.map(({ run, metrics }, i) => (
          <section key={run.id} className="card compare-col" style={{ borderTopColor: color(i) }}>
            <div style={{ padding: 'var(--s-3) var(--s-4)' }}>
              <b>{runTitle(run)}</b>
              <span className="cell-sub">{settingsLabel(run.config)}</span>
            </div>
            {METRIC_ROWS.map(([label, get, fmt, better, signed]) => {
              const values = runs.map((r) => get(r.metrics));
              const best = bestIndex(values, better) === i;
              const v = get(metrics);
              return (
                <div key={label} className={`metric-row${best ? ' best' : ''}`}>
                  <span>{label}</span>
                  <span className={signed ? tone(v) : ''}><b>{fmt(v)}</b>{best && <span className="best-tag">BEST</span>}</span>
                </div>
              );
            })}
            <div className="metric-row"><span>Exits S / T / E</span><b>{qty(metrics.byReason.SL || 0)} / {qty(metrics.byReason.TARGET || 0)} / {qty(metrics.byReason.EOD || 0)}</b></div>
          </section>
        ))}
      </div>

      <section className="card chart-card">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <h2 className="section">Equity curves</h2><span className="caption">cumulative ₹, same scale</span><span className="spacer" />
          {runs.map(({ run, metrics }, i) => (
            <span key={run.id} className="caption"><i className="key-line" style={{ background: color(i) }} />{runTitle(run)} <b className={tone(metrics.totalPnl)}>{pnl(metrics.totalPnl)}</b></span>
          ))}
        </div>
        <EquityOverlay lines={runs.map(({ run, metrics }, i) => ({ name: runTitle(run), curve: metrics.curve, color: colors[CAT[i]] }))} />
      </section>

      <section className="card" style={{ padding: 0 }}>
        <div className="row" style={{ padding: 'var(--s-3) var(--s-4)' }}>
          <h2 className="section">Per ticker</h2><span className="caption">total P&amp;L and trades per run · sorted by first run</span>
          <span className="spacer" /><span className="caption">— = symbol not in that run’s list</span>
        </div>
        <div className="table-wrap" style={{ maxHeight: 640, overflowY: 'auto' }}>
          <table className="data">
            <thead>
              <tr>
                <th>Symbol</th>
                {runs.map(({ run }, i) => <th key={run.id} className="num"><i className="key-sq" style={{ background: color(i) }} />{runTitle(run)}</th>)}
                <th className="num">Spread</th>
              </tr>
            </thead>
            <tbody>
              {tickers.map((t) => (
                <tr key={t.symbol}>
                  <td><b>{short(t.symbol)}</b></td>
                  {t.cells.map((c, i) => (
                    <td key={i} className="num">
                      {c ? <><span className={tone(c.pnl)}>{pnl(c.pnl)}</span> <span className="caption">{c.trades} tr</span></> : <span className="caption">—</span>}
                    </td>
                  ))}
                  <td className="num">{t.spread === null ? '—' : pnl(t.spread).replace(/^\+/, '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SweepView({ data }) {
  const navigate = useNavigate();
  const colors = useMemo(readColors, []);
  const runs = data.runs;
  const first = runs[0].run;
  const c = first.config;
  const exps = runs.map((r) => r.metrics.expectancy);
  const bestIdx = bestIndex(exps, 'max') >= 0 ? bestIndex(exps, 'max') : exps.indexOf(Math.max(...exps));
  const best = runs[bestIdx];
  const maxAbs = Math.max(...exps.map(Math.abs), 1);
  const trades = best.metrics.totalTrades;
  const ranked = [...exps].sort((a, b) => b - a);
  const topThree = runs.map((r, i) => i).sort((a, b) => exps[b] - exps[a]).slice(0, 3);
  const close = ranked.length >= 3 ? ranked[0] - ranked[2] : null;

  return (
    <div className="stack">
      <div className="breadcrumb"><Link to="/compare">Compare</Link> / Sweep</div>
      <div className="row page-head" style={{ alignItems: 'flex-start' }}>
        <div className="spacer">
          <h1 className="display">Target sweep · {sweepTitle(first).replace(/ · sweep$/, '')}</h1>
          <p className="caption" style={{ fontSize: 13.5, margin: '4px 0 0' }}>
            Same entries, {runs.length} exit rules · {{ both: 'Both', long: 'Long', short: 'Short' }[c.direction]} · {stopLabel(c)} · {dateShort(first.fromDate)} → {dateShort(first.toDate)} · {durationLabel(first.fromDate, first.toDate)}
          </p>
        </div>
        <Link className="btn" to={`/new?run=${best.run.id}`}>Run the best rule as a new backtest</Link>
      </div>

      <div className="card row" style={{ padding: 'var(--s-3) var(--s-4)', flexWrap: 'wrap' }}>
        <span className="caption" style={{ fontSize: 13.5 }}>Only difference between variants</span>
        <span className="diff-chip">Target rule</span>
        <span className="caption">Dates, symbols, direction, opening range, stop, sizing and costs are identical</span>
      </div>

      <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-wrap">
          <table className="data sweep-table">
            <thead>
              <tr>
                <th>Target rule</th><th className="num">Trades</th><th className="num">Win %</th><th className="num">Total P&amp;L</th>
                <th className="num">Expectancy</th><th className="num">Avg R</th><th className="num">PF</th><th className="num">Max DD</th><th className="num">Exits S · T · E</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(({ run, metrics: m }, i) => (
                <tr key={run.id} className={`clickable${i === bestIdx ? ' best-row' : ''}`} onClick={() => navigate(`/runs/${run.id}`)}>
                  <td><b>{ruleLabel(run.config)}</b>{i === bestIdx && <span className="best-tag">BEST EXPECTANCY</span>}</td>
                  <td className="num">{qty(m.totalTrades)}</td>
                  <td className="num">{rate(m.winRate)}</td>
                  <td className={`num ${tone(m.totalPnl)}`}>{pnl(m.totalPnl)}</td>
                  <td className="num">
                    <span className="exp-bar"><span className={m.expectancy >= 0 ? 'pos' : 'neg'} style={{ width: `${(Math.abs(m.expectancy) / maxAbs) * 50}%` }} /></span>
                    <b className={tone(m.expectancy)}>{pnl(m.expectancy)}</b>
                  </td>
                  <td className={`num ${tone(m.avgR)}`}>{rMultiple(m.avgR)}</td>
                  <td className="num">{profitFactor(m.profitFactor)}</td>
                  <td className={`num ${tone(-m.maxDrawdown)}`}>{pnl(-m.maxDrawdown)}</td>
                  <td className="num">{qty(m.byReason.SL || 0)} · {qty(m.byReason.TARGET || 0)} · {qty(m.byReason.EOD || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="banner banner-row" style={{ borderRadius: 0, border: 0, borderTop: '1px solid var(--line)' }}>
          <Icon name="warn" />
          <span className="warn">
            Small samples move this ranking — widen the date range before trusting it.
            {close !== null && ` With ${qty(trades)} trades, the top three rules (${topThree.map((k) => ruleLabel(runs[k].run.config)).join(', ')}) are within ${pnl(close).replace(/^\+/, '')} per trade of each other.`}
            {trades < SMALL_SAMPLE && ` Only ${trades} trades — too few to rank rules.`}
            {/* D11: only with a pct stop is 1R exactly 1%. */}
            {c.slMode === 'pct' && ` With a ${c.slPct}% stop, the % targets equal R targets (${c.slPct}% = 1R).`}
          </span>
        </div>
      </section>

      <section className="card chart-card">
        <div className="row"><h2 className="section">Equity by target rule</h2><span className="caption">best expectancy in blue, others grey</span></div>
        <EquityOverlay
          lines={runs.map(({ run, metrics }, i) => ({
            name: ruleLabel(run.config), curve: metrics.curve,
            color: i === bestIdx ? colors.accent : colors.muted, width: i === bestIdx ? 2.2 : 1, z: i === bestIdx ? 10 : 2,
          }))}
          height={340}
        />
      </section>
    </div>
  );
}

export default function Compare() {
  const [params] = useSearchParams();
  const query = params.get('sweep') ? `sweep=${params.get('sweep')}` : params.get('ids') ? `ids=${params.get('ids')}` : null;
  const state = useCompare(query);
  if (!query) return <Picker />;
  if (state.error) return <div className="banner banner-error">{state.error} <Link to="/compare">Pick other runs</Link></div>;
  if (state.loading || !state.data) return <p className="placeholder">Loading comparison…</p>;
  return params.get('sweep') ? <SweepView data={state.data} /> : <RunsCompare data={state.data} />;
}
