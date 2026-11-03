// The Live page's left column: Traded / All / Review tabs and one row per
// trade (docs/design/reference/live). Rows without a paper trade still show:
// "missed by live" from the backtest check, and on a single day every other
// symbol of the list, greyed.

import { dateLong, pnl, price, qty, rMultiple, tone } from '../lib/format.js';
import { REASON, short } from '../lib/liveView.js';
import Segmented from './Segmented.jsx';

function SideBadge({ side }) {
  if (!side) return null;
  return <span className={`side-badge side-${side}`} title={side === 'long' ? 'Long' : 'Short'}>{side === 'long' ? 'L' : 'S'}</span>;
}

function Row({ row, maxAbs, selected, onSelect }) {
  if (row.kind === 'none') {
    return (
      <li className="live-row live-row-none">
        <div className="live-row-top"><b>{short(row.symbol)}</b></div>
        <div className="live-row-sub caption">{row.note}</div>
      </li>
    );
  }
  const t = row.trade;
  const bt = row.mismatch?.backtest;
  const sub = row.kind === 'missed'
    ? `Backtest only · ${price(bt?.entry)}`
    : t.status === 'open' ? 'Open' : `${REASON[t.reason] || t.reason} ${t.exitTime} · ${rMultiple(row.r)}`;
  const width = row.pnl == null || !maxAbs ? 0 : Math.max(4, (Math.abs(row.pnl) / maxAbs) * 100);
  return (
    <li>
      <button type="button" className={`live-row${selected ? ' on' : ''}`} onClick={() => onSelect(row.key)} aria-current={selected || undefined}>
        <div className="live-row-top">
          <b>{short(row.symbol)}</b>
          <SideBadge side={row.side} />
          <span className="caption live-row-time">{row.entryTime || ''}</span>
          <span className="spacer" />
          <b className={tone(row.pnl)}>{row.pnl == null ? '—' : pnl(row.pnl)}</b>
        </div>
        <div className="live-row-sub">
          <span className="caption">{sub}</span>
          {row.tag && <span className="warn-tag">{row.tag}</span>}
          {!row.tag && row.check?.kind === 'tick' && <span className="tag tick-tag" title={row.check.problem}>tick order</span>}
          {row.liveOnly && <span className="tag" title="Not reconciled · live only (D25)">live only</span>}
          <span className="spacer" />
          <span className="live-bar"><span className={`${tone(row.pnl)}-bg`} style={{ width: `${width}%` }} /></span>
        </div>
      </button>
    </li>
  );
}

export default function LiveList({ rows, tabs, tab, onTab, sortBy, onSort, selected, onSelect, footer }) {
  const maxAbs = Math.max(0, ...rows.map((r) => Math.abs(r.pnl ?? 0)));
  const items = [];
  let day = null;
  const days = new Set(rows.map((r) => r.date)).size;
  for (const row of rows) {
    if (days > 1 && sortBy === 'time' && row.date !== day) {
      day = row.date;
      items.push(<li key={`d-${day}`} className="live-day-head caption">{dateLong(day)}</li>);
    }
    items.push(<Row key={row.key} row={row} maxAbs={maxAbs} selected={selected === row.key} onSelect={onSelect} />);
  }
  return (
    <div className="card live-list">
      <div className="live-list-head">
        <Segmented label="Show" value={tab} onChange={onTab} options={tabs.map(([v, text, n]) => [v, `${text} ${qty(n)}`])} />
        <span className="spacer" />
        <button type="button" className="btn icon-btn live-sort" onClick={() => onSort(sortBy === 'time' ? 'pnl' : 'time')}
          title={sortBy === 'time' ? 'Sorted by time — sort by P&L' : 'Sorted by P&L — sort by time'} aria-label="Change sort">
          ↑↓<span className="caption">{sortBy === 'time' ? 'time' : 'P&L'}</span>
        </button>
      </div>
      {rows.length ? <ul className="live-rows">{items}</ul> : <p className="caption live-empty">Nothing here for this range.</p>}
      {footer}
    </div>
  );
}
