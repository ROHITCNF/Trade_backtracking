// Run in progress (F4 steps 4–6; Run in progress.png). Polls the run every 2 s
// while it is queued or running — database reads only. Shows progress, time,
// trades and P&L so far, Fyers calls, and every finished symbol, newest first.
// A failed run explains what stopped it and offers to resume (States.png).

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useMe } from '../lib/me.jsx';
import { dateShort, duration, istTime, pnl, qty, tone } from '../lib/format.js';
import { isActive, plannedCalls, runTitle, settingsLabel } from '../lib/runs.js';
import StatusPill from '../components/StatusPill.jsx';
import Icon from '../components/Icon.jsx';

const POLL_MS = 2000;
const short = (s) => s.replace(/^NSE:|-EQ$/g, '');

function useRun(id) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    try {
      setData(await api(`/api/runs/${id}`));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [id]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const active = data && isActive(data.run.status);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [active, load]);
  return { data, error, reload: load };
}

function useTick(on) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [on]);
}

function headline(run, counts) {
  const parts = [`${counts.done} symbol${counts.done === 1 ? '' : 's'} traded`];
  if (counts.skipped) parts.push(`${counts.skipped} skipped`);
  if (counts.failed) parts.push(`${counts.failed} failed`);
  const tail = parts.join(', ');
  switch (run.status) {
    case 'queued': return 'Queued · starts after the current run';
    case 'running': return `Running · ${tail}`;
    case 'done': return `Finished · ${tail}`;
    case 'cancelled': return `Cancelled · ${tail}`;
    default: return `Stopped · ${tail}`;
  }
}

export default function RunProgress() {
  const { id } = useParams();
  const { refresh: refreshMe } = useMe();
  const { data, error, reload } = useRun(id);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  useTick(data && data.run.status === 'running');

  // The header's budget meter moves while a run spends calls.
  useEffect(() => {
    if (data && data.run.status === 'running') refreshMe();
  }, [data?.run.done]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="banner banner-error">{error.status === 404 ? 'Run not found.' : error.message}</div>;
  if (!data) return <p className="placeholder">Loading run…</p>;

  const { run, symbols, sweepRunIds } = data;
  const isSweep = sweepRunIds.length > 1;
  const finished = symbols.filter((s) => s.status !== 'pending');
  const counts = { done: 0, skipped: 0, failed: 0 };
  for (const s of finished) counts[s.status] = (counts[s.status] || 0) + 1;
  const trades = finished.reduce((n, s) => n + (s.metrics?.totalTrades || 0), 0);
  const pnlSoFar = finished.reduce((n, s) => n + (s.metrics?.totalPnl || 0), 0);

  const start = run.startedAt ? new Date(run.startedAt).getTime() : null;
  const end = run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now();
  const elapsed = start ? (end - start) / 1000 : null;
  const perSymbol = run.done ? elapsed / run.done : null;
  const remaining = run.status === 'running' && perSymbol ? perSymbol * (run.total - run.done) : null;
  const pct = run.total ? (run.done / run.total) * 100 : 0;
  const log = [...finished].sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
  const current = symbols.find((s) => s.status === 'pending');

  async function act(body) {
    setBusy(true);
    setActionError(null);
    try {
      await api(`/api/runs/${run.id}`, { method: 'PATCH', body });
      await reload();
    } catch (err) {
      setActionError(err.message);
    }
    setBusy(false);
  }

  const openTarget = isSweep ? `/compare?sweep=${run.sweepId}` : `/runs/${run.id}`;

  return (
    <div className="stack narrow">
      <div className="breadcrumb">
        <Link to="/runs">Runs</Link> / {runTitle(run)}
      </div>
      <div className="row page-head" style={{ alignItems: 'flex-start' }}>
        <div className="spacer">
          <div className="row">
            <h1 className="display">{runTitle(run)}</h1>
            <StatusPill status={run.status} />
          </div>
          <p className="caption" style={{ fontSize: 13.5, margin: '4px 0 0' }}>
            {isSweep ? `Sweep · ${sweepRunIds.length} target rules` : settingsLabel(run.config)} · {dateShort(run.fromDate)} → {dateShort(run.toDate)}
            {run.startedAt && ` · started ${istTime(run.startedAt)} IST`}
          </p>
        </div>
        {isActive(run.status) && (
          <button className="btn" disabled={busy || run.cancelRequested} onClick={() => act({ cancel: true })}>
            {run.cancelRequested ? 'Cancelling after this symbol…' : 'Cancel run'}
          </button>
        )}
        {(run.status === 'done' || run.status === 'cancelled') && (
          <Link className="btn btn-primary btn-lg" to={openTarget}>{isSweep ? 'Compare targets' : 'Open dashboard'}</Link>
        )}
      </div>

      {run.status === 'failed' && (
        <div className="banner banner-error banner-row" role="alert">
          <Icon name="alert" />
          <div>
            <b>Run stopped at symbol {run.done + 1} / {run.total}{current ? ` (${current.symbol})` : ''}.</b>{' '}
            <span className="loss">
              {String(run.error).replace(/\.$/, '')}. {run.done} symbols finished and their trades are saved; the remaining {run.total - run.done} weren’t fetched.
            </span>
          </div>
          <span className="spacer" />
          <button className="btn btn-primary" disabled={busy} onClick={() => act({ resume: true })}>
            Retry remaining {run.total - run.done}
          </button>
          {run.done > 0 && <Link className="btn" to={`/runs/${run.id}`}>View partial results</Link>}
        </div>
      )}
      {actionError && <div className="banner banner-error">{actionError}</div>}

      <section className="card progress-card">
        <div className="row">
          <span className="section spacer" style={{ fontSize: 15 }}>{headline(run, counts)}</span>
          <span><b>{run.done}</b> / {run.total} symbols</span>
        </div>
        <div className={`progress progress-${run.status}`}><span style={{ width: `${pct}%` }} /></div>
        <div className="progress-stats">
          <div><span className="label">Elapsed</span><span className="stat">{duration(elapsed)}</span></div>
          <div><span className="label">Remaining</span><span className="stat">{remaining === null ? '—' : `≈ ${duration(remaining)}`}</span></div>
          <div><span className="label">Trades so far</span><span className="stat">{qty(trades)}</span></div>
          <div><span className="label">P&amp;L so far</span><span className={`stat ${tone(pnlSoFar)}`}>{pnl(pnlSoFar)}</span></div>
          <div><span className="label">Fyers calls</span><span className="stat">{qty(run.callsUsed)} / {qty(plannedCalls(run))}</span></div>
        </div>
        {isActive(run.status) && (
          <div className="hint">
            This run continues on the server. Leave this page whenever you like — it will be under <Link to="/runs">Runs</Link> when it finishes.
          </div>
        )}
        {isSweep && <span className="caption">Showing the “{run.name?.split(' · ').pop()}” variant; all {sweepRunIds.length} variants share these candles and finish together.</span>}
      </section>

      <section className="card" style={{ padding: 0 }}>
        <div className="row" style={{ padding: 'var(--s-3) var(--s-4)' }}>
          <h2 className="section spacer">Finished symbols</h2>
          <span className="caption">newest first</span>
        </div>
        {log.length === 0 ? (
          <p className="caption" style={{ padding: '0 var(--s-4) var(--s-4)' }}>
            {run.status === 'queued' ? 'Nothing yet — this run starts when the one ahead of it finishes.' : 'The first symbol is being fetched…'}
          </p>
        ) : (
          <div className="table-wrap log">
            <table className="data">
              <thead>
                <tr><th>Time</th><th>Symbol</th><th className="num">Trades</th><th className="num">P&amp;L</th><th>Note</th></tr>
              </thead>
              <tbody>
                {log.map((s) => (
                  <tr key={s.symbol} className={s.status === 'done' ? '' : 'muted'}>
                    <td className="caption">{istTime(s.finishedAt, true)}</td>
                    <td><b>{short(s.symbol)}</b></td>
                    <td className="num">{s.metrics ? s.metrics.totalTrades : '—'}</td>
                    <td className={`num ${s.metrics ? tone(s.metrics.totalPnl) : ''}`}>{s.metrics ? pnl(s.metrics.totalPnl) : '—'}</td>
                    <td className={s.status === 'failed' ? 'loss' : ''}>
                      {s.status === 'skipped' && `Skipped · ${s.reason === 'no trades' ? 'no breakout trades in range' : s.reason}`}
                      {s.status === 'failed' && `Fetch failed · ${s.reason}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
