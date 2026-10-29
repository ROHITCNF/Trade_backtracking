// The v2 summary blocks shared by Research results and the Journal day: the
// one-line narrative, Long vs short, and How trades ended. `analysis` is a
// /api/runs/:id/analysis response (any filters).

import { pnl, profitFactor, qty, rate, rMultiple, tone } from '../lib/format.js';
import { narrative, sideBars } from '../lib/summary.js';

const REASON_LABEL = { TARGET: 'Target', SL: 'Stop loss', EOD: 'End of day' };
const REASON_ORDER = ['TARGET', 'SL', 'EOD'];

export function Narrative({ analysis, className = '' }) {
  return (
    <p className={`narrative ${className}`}>
      {narrative(analysis).map((p, i) => (p.tone ? <b key={i} className={p.tone}>{p.text}</b> : <span key={i}>{p.text}</span>))}
    </p>
  );
}

// The six v2 stat tiles: Net P&L, Trades, Win rate, PF, Avg R, Max drawdown.
export function StatTiles({ metrics: m }) {
  return (
    <div className="tiles">
      <div className="tile"><span className="label">Net P&amp;L</span><span className={`stat ${tone(m.totalPnl)}`}>{pnl(m.totalPnl)}</span></div>
      <div className="tile"><span className="label">Trades</span><span className="stat">{qty(m.totalTrades)}</span></div>
      <div className="tile"><span className="label">Win rate</span><span className="stat">{rate(m.winRate)}</span></div>
      <div className="tile"><span className="label">Profit factor</span><span className="stat">{profitFactor(m.profitFactor)}</span></div>
      <div className="tile"><span className="label">Avg R</span><span className={`stat ${tone(m.avgR)}`}>{rMultiple(m.avgR)}</span></div>
      <div className="tile"><span className="label">Max drawdown</span><span className={`stat ${tone(-m.maxDrawdown)}`}>{pnl(-m.maxDrawdown)}</span></div>
    </div>
  );
}

export function LongShort({ analysis }) {
  const rows = sideBars(analysis.breakdowns.side);
  return (
    <section className="card summary-card">
      <h2 className="section">Long vs short</h2>
      {rows.map((s) => (
        <div key={s.key} className="side-row">
          <b>{s.key === 'long' ? 'Long' : 'Short'}</b>
          <div className="side-mid">
            <div className="side-track" aria-hidden="true">
              <span className={`side-bar side-${s.dir} ${tone(s.pnl)}-bg`} style={{ width: `${Math.max(s.width, s.trades ? 0.8 : 0)}%` }} />
            </div>
            <span className="caption">{qty(s.trades)} trades{s.trades ? ` · ${Math.round(s.winRate)}% win · PF ${profitFactor(s.profitFactor)}` : ''}</span>
          </div>
          <b className={`num ${tone(s.pnl)}`}>{pnl(s.pnl)}</b>
        </div>
      ))}
    </section>
  );
}

export function TradesEnded({ analysis }) {
  const byKey = Object.fromEntries(analysis.breakdowns.reason.map((r) => [r.key, r]));
  const rows = REASON_ORDER.map((k) => byKey[k] || { key: k, trades: 0, share: 0, pnl: 0 });
  return (
    <section className="card summary-card">
      <h2 className="section">How trades ended</h2>
      <div className="share-bar share-bar-lg">
        {rows.map((x) => <span key={x.key} className={`share-${x.key}`} style={{ width: `${x.share}%` }} />)}
      </div>
      {rows.map((x) => (
        <div key={x.key} className="reason-row">
          <span><span className={`swatch share-${x.key}`} />{REASON_LABEL[x.key]} <span className="caption">· {qty(x.trades)} · {Math.round(x.share)}%</span></span>
          <b className={`num ${tone(x.pnl)}`}>{pnl(x.pnl)}</b>
        </div>
      ))}
    </section>
  );
}
