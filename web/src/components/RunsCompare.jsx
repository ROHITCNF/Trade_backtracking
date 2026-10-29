// Two to four ticked research runs side by side (FR-30; "Tick two to four to
// compare" on v2/Research): what differs in their settings, their stats with
// the best marked, equity on one scale, and P&L per symbol.

import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { pnl, tone } from '../lib/format.js';
import { readColors } from '../lib/chartTheme.js';
import { cardTitle } from '../lib/research.js';
import { METRIC_ROWS, bestIndex, settingRows, tickerRows } from '../lib/compare.js';
import { dailyCurve } from '../lib/summary.js';
import { EquityOverlay } from './charts.jsx';

const short = (s) => s.replace(/^NSE:|-EQ$/g, '');
const color = (i) => `var(--cat-${i + 1})`;

export default function RunsCompare({ ids, onClear }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const key = ids.join(',');
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    api(`/api/compare?ids=${key}`).then((d) => !cancelled && setData(d), (err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [key]);
  const colors = useMemo(readColors, []);
  const tickers = useMemo(() => (data ? tickerRows(data.runs) : []), [data]);

  if (error) return <div className="banner banner-error">{error}</div>;
  if (!data) return <div className="skel" style={{ height: 320 }} aria-busy="true" />;
  const runs = data.runs;
  const settings = settingRows(runs.map((r) => r.run)).filter((r) => !r.same);
  const head = (
    <tr><th />{runs.map(({ run }, i) => <th key={run.id} className="num"><i className="key-sq" style={{ background: color(i) }} />{cardTitle(run)}</th>)}</tr>
  );

  return (
    <div className="stack results">
      <div className="results-head">
        <div className="spacer">
          <h2 className="title-lg">Comparing {runs.length} runs</h2>
          <span className="caption">Best value in each row is marked. Runs over different symbols aren’t like-for-like — read the settings first.</span>
        </div>
        <button className="btn" onClick={onClear}>Clear selection</button>
      </div>

      <section className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="data compare-table">
            <thead>{head}</thead>
            <tbody>
              {settings.map((r) => (
                <tr key={r.label}><td className="caption">{r.label}</td>{r.values.map((v, i) => <td key={i} className="num"><span className="diff-chip">{v}</span></td>)}</tr>
              ))}
              {METRIC_ROWS.map(([label, get, fmt, better, signed]) => {
                const values = runs.map((r) => get(r.metrics));
                const best = bestIndex(values, better);
                return (
                  <tr key={label}>
                    <td>{label}</td>
                    {values.map((v, i) => (
                      <td key={i} className={`num ${signed ? tone(v) : ''}${best === i ? ' best-cell' : ''}`}>
                        {fmt(v)}{best === i && <span className="best-tag">BEST</span>}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card chart-card">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <h2 className="section">Equity</h2><span className="caption">· cumulative ₹, same scale</span><span className="spacer" />
          {runs.map(({ run, metrics }, i) => (
            <span key={run.id} className="caption"><i className="key-line" style={{ background: color(i) }} />{cardTitle(run)} <b className={tone(metrics.totalPnl)}>{pnl(metrics.totalPnl)}</b></span>
          ))}
        </div>
        <EquityOverlay lines={runs.map(({ run, metrics }, i) => ({ name: cardTitle(run), curve: dailyCurve(metrics.curve), color: colors[`cat${i + 1}`] }))} />
      </section>

      <section className="card" style={{ padding: 0 }}>
        <div className="row by-symbol-head"><h2 className="section">By symbol</h2><span className="caption">· P&amp;L per run, — where a run didn’t include it</span></div>
        <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
          <table className="data">
            <thead>{head}</thead>
            <tbody>
              {tickers.map((t) => (
                <tr key={t.symbol}>
                  <td><b>{short(t.symbol)}</b></td>
                  {t.cells.map((c, i) => (
                    <td key={i} className="num">{c ? <><span className={tone(c.pnl)}>{pnl(c.pnl)}</span> <span className="caption">{c.trades} tr</span></> : <span className="caption">—</span>}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
