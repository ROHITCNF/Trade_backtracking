// Runs history (F9; Runs history.png): every run, newest first, sweeps as one
// row. Select two to four finished runs to compare. Rename inline, duplicate
// into the launcher, cancel, retry a failed run, delete with confirmation.

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useMe } from '../lib/me.jsx';
import { dateShort, duration, istDateTime, pnl, profitFactor, qty, rate, tone } from '../lib/format.js';
import { isActive, plannedCalls, runTitle, settingsLabel, stopLabel, sweepTitle } from '../lib/runs.js';
import StatusPill from '../components/StatusPill.jsx';
import EmptyRuns from '../components/EmptyRuns.jsx';

const MAX_COMPARE = 4;
const DIRECTION = { long: 'Long', short: 'Short', both: 'Both' };

// A sweep is shown as one row whose status is its runs' combined state.
function sweepStatus(runs) {
  const s = new Set(runs.map((r) => r.status));
  for (const status of ['running', 'queued', 'failed', 'cancelled']) if (s.has(status)) return status;
  return 'done';
}

function StatusCell({ run, status, anyRunning }) {
  let note = null;
  if (status === 'queued') note = anyRunning ? 'starts after the current run' : 'starting…';
  else if (status === 'running') {
    const left = (run.total - run.done) * Math.max(1, Math.round(plannedCalls(run) / run.total)) * 1.3;
    note = `${run.done} / ${run.total} · ≈ ${duration(left)} left`;
  } else if (status === 'failed') note = <span className="loss">{run.error}</span>;
  return (
    <td>
      <StatusPill status={status} />
      {note && <span className="cell-sub">{note}</span>}
    </td>
  );
}

export default function Runs() {
  const navigate = useNavigate();
  const { refresh: refreshMe } = useMe();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    try {
      setItems((await api('/api/runs')).items);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const anyActive = items?.some((it) => (it.type === 'run' ? isActive(it.run.status) : it.runs.some((r) => isActive(r.status))));
  useEffect(() => {
    if (!anyActive) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [anyActive, load]);

  if (error) return <div className="banner banner-error">{error}</div>;
  if (!items) return <p className="placeholder">Loading runs…</p>;

  const runCount = items.reduce((n, it) => n + (it.type === 'run' ? 1 : it.runs.length), 0);
  const anyRunning = items.some((it) => (it.type === 'run' ? it.run.status === 'running' : it.runs.some((r) => r.status === 'running')));

  async function patch(ids, body) {
    try {
      for (const id of ids) await api(`/api/runs/${id}`, { method: 'PATCH', body });
      if (body.resume) refreshMe();
    } catch (err) {
      setError(err.message);
    }
    load();
  }
  async function remove(ids, title) {
    if (!window.confirm(`Delete “${title}” and its trades? This can’t be undone.`)) return;
    try {
      for (const id of ids) await api(`/api/runs/${id}`, { method: 'DELETE' });
    } catch (err) {
      setError(err.message);
    }
    setSelected((s) => s.filter((id) => !ids.includes(id)));
    load();
  }
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < MAX_COMPARE ? [...s, id] : s));

  return (
    <div className="stack">
      <div className="row page-head" style={{ alignItems: 'flex-end' }}>
        <div className="spacer">
          <h1 className="display">Runs</h1>
          <p className="caption" style={{ fontSize: 13.5, margin: '4px 0 0' }}>
            {runCount} run{runCount === 1 ? '' : 's'} · select two to four to compare
          </p>
        </div>
        <button className="btn btn-primary" disabled={selected.length < 2} onClick={() => navigate(`/compare?ids=${selected.join(',')}`)}>
          Compare {selected.length >= 2 ? `${selected.length} runs` : 'runs'}
        </button>
        <Link className="btn" to="/new">New backtest</Link>
      </div>

      {items.length === 0 ? (
        <EmptyRuns />
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table className="data runs-table">
            <thead>
              <tr>
                <th style={{ width: 36 }} />
                <th>Run</th>
                <th>Date range</th>
                <th className="num">Symbols</th>
                <th>Settings</th>
                <th>Status</th>
                <th className="num">Trades</th>
                <th className="num">Win %</th>
                <th className="num">Total P&amp;L</th>
                <th className="num">PF</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const isSweep = it.type === 'sweep';
                const run = isSweep ? it.runs[0] : it.run;
                const ids = isSweep ? it.runs.map((r) => r.id) : [run.id];
                const status = isSweep ? sweepStatus(it.runs) : run.status;
                const title = isSweep ? sweepTitle(run) : runTitle(run);
                const m = !isSweep && run.status === 'done' ? run.metrics : null;
                const key = isSweep ? `s${it.sweepId}` : run.id;
                const open = isSweep
                  ? status === 'done' ? `/compare?sweep=${it.sweepId}` : `/runs/${run.id}/progress`
                  : run.status === 'done' ? `/runs/${run.id}` : `/runs/${run.id}/progress`;
                const canSelect = !isSweep && run.status === 'done';
                return (
                  <tr key={key} className={selected.includes(run.id) && !isSweep ? 'selected' : ''}>
                    <td>
                      <input type="checkbox" aria-label={`Select ${title}`} disabled={!canSelect || (!selected.includes(run.id) && selected.length >= MAX_COMPARE)}
                        checked={canSelect && selected.includes(run.id)} onChange={() => toggle(run.id)} />
                    </td>
                    {editing === key ? (
                      <td>
                        <input className="input" style={{ width: '100%' }} autoFocus defaultValue={run.name || ''} maxLength={120} placeholder={title}
                          onBlur={(e) => { setEditing(null); patch(ids.slice(0, 1), { name: e.target.value.trim() || null }); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditing(null); }} />
                      </td>
                    ) : (
                      <td>
                        <Link to={open} className="run-name"><b>{title}</b></Link>
                        <span className="cell-sub">Created {istDateTime(run.createdAt)}</span>
                      </td>
                    )}
                    <td className="nowrap">{dateShort(run.fromDate)} → {dateShort(run.toDate)}</td>
                    <td className="num">{run.total}</td>
                    <td>{isSweep ? `${DIRECTION[run.config.direction]} · ${stopLabel(run.config)} · sweep ${it.runs.length} targets` : settingsLabel(run.config)}</td>
                    <StatusCell run={run} status={status} anyRunning={anyRunning} />
                    <td className="num">{m ? qty(m.totalTrades) : '—'}</td>
                    <td className="num">{m ? rate(m.winRate) : '—'}</td>
                    <td className={`num ${m ? tone(m.totalPnl) : ''}`}>{m ? pnl(m.totalPnl) : '—'}</td>
                    <td className="num">{m ? profitFactor(m.profitFactor) : '—'}</td>
                    <td>
                      <div className="actions">
                        {status === 'failed' && <button className="btn" onClick={() => patch(ids.filter((id, i) => (isSweep ? it.runs[i].status === 'failed' : true)), { resume: true })}>Retry</button>}
                        <Link to={open}>Open</Link>
                        {!isSweep && <button className="link-btn" onClick={() => setEditing(key)}>Rename</button>}
                        <button className="link-btn" onClick={() => navigate(`/new?run=${run.id}`)}>Duplicate</button>
                        {isActive(status) ? (
                          <button className="link-btn danger" onClick={() => patch(ids.filter((id, i) => !isSweep || isActive(it.runs[i].status)), { cancel: true })}>Cancel</button>
                        ) : (
                          <button className="link-btn danger" onClick={() => remove(ids, title)}>Delete</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
