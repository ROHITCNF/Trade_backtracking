// Journal (v2/Journal — desktop.png, mobile.png): every list's ORB result per
// day, kept current by Journal runs (decisions D16–D18). The 20-day heatmap
// picks a day (?day=); the day itself is shown below it.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { connectFyers, useMe } from '../lib/me.jsx';
import { dateLong, dateShort, pnl, qty, tone } from '../lib/format.js';
import { settingsLabel } from '../lib/runs.js';
import { sameStrategy } from '../lib/research.js';
import { compactPnl, heatmap, HEATMAP_DAYS } from '../lib/journal.js';
import { useJournal } from '../lib/useJournal.js';
import StrategyFields from '../components/StrategyFields.jsx';
import Icon from '../components/Icon.jsx';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayHead = (ymd) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  return [DAYS[d.getUTCDay()], `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`];
};

// What the Journal is doing, or why it can't: one line at most.
function UpdateNote({ data, queueError, canQueue, onRetry }) {
  const { me } = useMe();
  const active = data.state.filter((s) => s.active);
  const failed = data.state.filter((s) => s.failed);
  const due = data.state.filter((s) => s.needsRun);
  if (queueError) return <div className="banner banner-error banner-row"><Icon name="alert" /><span>{queueError}</span></div>;
  if (active.length) {
    const running = active.find((s) => s.active.status === 'running')?.active;
    return (
      <div className="banner banner-info banner-row" role="status">
        <Icon name="clock" />
        <span>
          Updating {active.map((s) => s.list.name).join(', ')} to {dateShort(data.to)}
          {running && <span className="caption"> · {running.done} / {running.total} symbols</span>}
        </span>
      </div>
    );
  }
  if (failed.length) {
    return (
      <div className="banner banner-error banner-row">
        <Icon name="alert" />
        <span><b>Updating {failed.map((s) => s.list.name).join(', ')} failed.</b> {failed[0].failed.error}</span>
        <span className="spacer" />
        <button className="btn" onClick={() => failed.forEach((s) => onRetry(s.failed.id))}>Retry</button>
      </div>
    );
  }
  if (due.length && !canQueue && me) {
    return (
      <div className="banner banner-info banner-row" role="status">
        <Icon name="info" />
        <span>
          {me.budget.paused ? 'Fyers data calls are paused until 00:00 IST' : 'Connect Fyers'} to bring {due.map((s) => s.list.name).join(', ')} up to {dateLong(data.to)}.
        </span>
        <span className="spacer" />
        {!me.fyers.connected && <button className="btn btn-primary" onClick={() => connectFyers()}>Connect Fyers</button>}
      </div>
    );
  }
  return null;
}

function StrategyPanel({ strategy, onApply, onClose, calls }) {
  const [config, setConfig] = useState({ ...strategy });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const changed = !sameStrategy(config, strategy);
  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      await onApply(config);
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <section className="card research-bar">
      <div className="row">
        <span className="section spacer">Default strategy</span>
        <button className="btn btn-ghost icon-btn" aria-label="Close" onClick={onClose}>×</button>
      </div>
      <StrategyFields config={config} onChange={(patch) => setConfig((c) => ({ ...c, ...patch }))} />
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <span className="caption spacer">Every list is re-run on the new strategy for the last {HEATMAP_DAYS} trading days · ≈ {qty(calls)} Fyers calls. Research starts from it too.</span>
        {error && <span className="loss">{error}</span>}
        <button className="btn btn-primary" disabled={!changed || busy} onClick={apply}>{busy ? 'Queuing…' : 'Apply to all lists'}</button>
      </div>
    </section>
  );
}

function Heatmap({ data, day, onDay }) {
  const scroller = useRef(null);
  const map = useMemo(() => heatmap(data.rows), [data.rows]);
  // Phones scroll the grid sideways; start at the latest day.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [map.dates.length]);

  return (
    <section className="card heat-card">
      <div className="row heat-head">
        <h2 className="section spacer">Last {HEATMAP_DAYS} trading days</h2>
        <span className="caption hide-xs">click a cell to open that day · click a list name to edit it</span>
      </div>
      {map.dates.length === 0 ? (
        <p className="caption">No days yet — the first Journal runs fill this in.</p>
      ) : (
        <div className="heat-scroll" ref={scroller}>
          <table className="heat">
            <thead>
              <tr>
                <th className="heat-list" />
                {map.dates.map((d) => {
                  const [wd, dm] = dayHead(d);
                  return <th key={d} className={d === day ? 'on' : ''}><span>{wd}</span><span>{dm}</span></th>;
                })}
                <th className="heat-total caption">{map.dates.length} days</th>
              </tr>
            </thead>
            <tbody>
              {map.rows.map(({ list, cells, total }) => {
                const state = data.state.find((s) => s.list.id === list.id);
                return (
                  <tr key={list.id}>
                    <th className="heat-list" scope="row">
                      <Link to={`/watchlists/${list.id}`} className="heat-name">{list.name}</Link>
                      <span className="caption">{list.count} symbols</span>
                    </th>
                    {cells.map((c) => (
                      <td key={c.date}>
                        <button type="button" className={`heat-cell ${c.pnl === null ? 'heat-empty' : `${c.pnl < 0 ? 'heat-loss' : 'heat-profit'} heat-${c.shade}`}${c.date === day ? ' on' : ''}`}
                          onClick={() => onDay(c.date)} aria-label={`${list.name} ${dateLong(c.date)}: ${c.pnl === null ? 'no trades' : pnl(c.pnl)}`}>
                          {c.pnl === null ? '—' : compactPnl(c.pnl)}
                        </button>
                      </td>
                    ))}
                    <td className={`heat-total num ${tone(total)}`}>
                      {state?.done ? <b>{compactPnl(total).replace(/^([+−]?)/, '$1₹')}</b> : <span className="caption">{state?.active ? 'updating…' : '—'}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Link to="/watchlists" className="heat-add">+ Add list — search symbols or import a .txt</Link>
      <div className="legend caption">
        <span><i className="heat-key heat-profit heat-2" />profitable day</span>
        <span><i className="heat-key heat-loss heat-2" />losing day</span>
        <span>darker = bigger, scaled per list</span>
      </div>
    </section>
  );
}

export default function Journal() {
  const { data, error, queueError, canQueue, applyStrategy, retry } = useJournal();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState(false);

  if (error) return <div className="banner banner-error">{error}</div>;
  if (!data) return <p className="placeholder">Loading…</p>;
  const dates = heatmap(data.rows).dates;
  const day = params.get('day') && dates.includes(params.get('day')) ? params.get('day') : dates.at(-1) || null;
  const calls = data.lists.reduce((a, w) => a + w.count, 0);

  return (
    <div className="stack journal">
      <div className="row page-head" style={{ alignItems: 'flex-start' }}>
        <div className="spacer">
          <h1 className="display">Journal</h1>
          <p className="page-sub">
            ORB runs on each list automatically at 15:45 IST · Default strategy ({settingsLabel(data.strategy)}){' '}
            <button className="link-btn accent" onClick={() => setEditing(!editing)}>change</button>
          </p>
        </div>
        <Link className="btn btn-lg" to="/watchlists">+ Add list</Link>
      </div>
      {editing && <StrategyPanel strategy={data.strategy} calls={calls} onApply={applyStrategy} onClose={() => setEditing(false)} />}
      <UpdateNote data={data} queueError={queueError} canQueue={canQueue} onRetry={retry} />
      <Heatmap data={data} day={day} onDay={(d) => setParams({ day: d }, { replace: true })} />
    </div>
  );
}
