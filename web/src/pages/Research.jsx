// Research (v2/Research — desktop.png, mobile.png): the launcher bar, one card
// per research run with its progress inline (decisions D20), and below them the
// selected run's results (?run=<id>) or, with two to four cards ticked
// (?compare=1,2), the comparison. Journal runs and sweeps are not shown here.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { connectFyers, useMe } from '../lib/me.jsx';
import { dateShort, duration, pnl, profitFactor, qty, tone } from '../lib/format.js';
import { defaultTo, earliestFrom, istToday, rangeFor } from '../lib/dates.js';
import { isActive, settingsLabel } from '../lib/runs.js';
import { useEstimate } from '../lib/useEstimate.js';
import {
  allRuns, cardTitle, defaultStrategy, progressFacts, researchDraft, researchRuns, sameStrategy, strategyOf, weekdaysBetween,
} from '../lib/research.js';
import Segmented from '../components/Segmented.jsx';
import SymbolSearch from '../components/SymbolSearch.jsx';
import SymbolSubset from '../components/SymbolSubset.jsx';
import StrategyFields from '../components/StrategyFields.jsx';
import StatusPill from '../components/StatusPill.jsx';
import Icon from '../components/Icon.jsx';
import RunResults from '../components/RunResults.jsx';
import RunsCompare from '../components/RunsCompare.jsx';

const POLL_MS = 3000;
const CARDS_SHOWN = 8;
const MAX_COMPARE = 4;
const RANGES = [['1', '1M'], ['3', '3M'], ['6', '6M'], ['12', '1Y'], ['custom', 'Custom']];

// Watchlists, runs and the default strategy, reloaded on demand and every few
// seconds while any run is queued or running.
function useResearchData() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    try {
      const [{ watchlists }, { items }, defaults] = await Promise.all([api('/api/watchlists'), api('/api/runs?limit=200'), api('/api/defaults')]);
      setData({ lists: watchlists, items, strategy: defaultStrategy(items, defaults.config) });
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const active = data?.items.some((it) => (it.type === 'run' ? [it.run] : it.runs).some((r) => isActive(r.status)));
  useEffect(() => {
    if (!active) return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [active, load]);
  return { data, error, reload: load };
}

// The symbols of the chosen watchlist, for the subset picker.
function useListSymbols(id) {
  const [symbols, setSymbols] = useState(null);
  useEffect(() => {
    if (!id) return setSymbols(null);
    let cancelled = false;
    setSymbols(null);
    api(`/api/watchlists/${id}`).then(({ symbols }) => !cancelled && setSymbols(symbols.map((s) => s.symbol)), () => {});
    return () => {
      cancelled = true;
    };
  }, [id]);
  return symbols;
}

function initialForm(lists, strategy) {
  return {
    mode: 'watchlist',
    watchlistId: lists.find((w) => w.name === 'core')?.id ?? lists[0]?.id ?? null,
    subset: null,
    symbol: null,
    range: '6',
    ...rangeFor(6, defaultTo()),
    config: { ...strategy },
  };
}

function Launcher({ form, setForm, lists, strategy, onStarted }) {
  const { me, refresh } = useMe();
  const [editing, setEditing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(null);
  const list = lists.find((w) => w.id === form.watchlistId) || null;
  const listSymbols = useListSymbols(form.mode === 'watchlist' ? form.watchlistId : null);
  const draft = useMemo(() => researchDraft({ ...form, list }), [form, list]);
  const { est, error, loading } = useEstimate(draft, me?.fyers.connected);
  const custom = !sameStrategy(form.config, strategy);
  const today = istToday();

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setRange = (range) => (range === 'custom' ? set({ range }) : set({ range, ...rangeFor(Number(range), defaultTo()) }));

  async function start() {
    setStarting(true);
    setStartError(null);
    try {
      const res = await api('/api/runs', { method: 'POST', body: draft });
      refresh();
      onStarted(res.id);
    } catch (err) {
      setStartError(err.message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <section className="card research-bar">
      <div className="research-row">
        <Segmented value={form.mode} options={[['watchlist', 'Watchlist'], ['symbol', 'Single symbol']]} onChange={(mode) => set({ mode })} label="Research on" />
        {form.mode === 'watchlist' ? (
          <>
            <select className="input" value={form.watchlistId ?? ''} onChange={(e) => set({ watchlistId: Number(e.target.value), subset: null })} aria-label="Watchlist">
              {lists.map((w) => <option key={w.id} value={w.id}>{w.name} · {w.count}</option>)}
            </select>
            {listSymbols && <SymbolSubset symbols={listSymbols} value={form.subset} onChange={(subset) => set({ subset })} />}
          </>
        ) : form.symbol ? (
          <span className="chip chip-lg">
            {form.symbol.ticker}
            <button type="button" aria-label={`Remove ${form.symbol.ticker}`} onClick={() => set({ symbol: null })}><Icon name="close" size={12} /></button>
          </span>
        ) : (
          <SymbolSearch onPick={(symbol) => set({ symbol })} placeholder="Search one ticker or company" />
        )}
      </div>

      <div className="research-row">
        <Segmented value={form.range} options={RANGES} onChange={setRange} label="Date range" />
        <label className="affix">From
          <input className="input input-date" type="date" value={form.fromDate} min={earliestFrom(today)} max={form.toDate}
            onChange={(e) => set({ fromDate: e.target.value, range: 'custom' })} />
        </label>
        <label className="affix">To
          <input className="input input-date" type="date" value={form.toDate} min={form.fromDate} max={today}
            onChange={(e) => set({ toDate: e.target.value, range: 'custom' })} />
        </label>
        <button type="button" className={`strategy-pill${editing ? ' on' : ''}`} onClick={() => setEditing(!editing)} aria-expanded={editing}
          title={settingsLabel(form.config)}>
          <b>{custom ? 'Custom strategy' : 'Default strategy'}</b> <span className="accent-link">{editing ? 'done' : 'change'}</span>
        </button>
        <span className="spacer" />
        <span className={`caption research-estimate${est && !est.canStart ? ' loss' : ''}`} style={{ opacity: loading ? 0.6 : 1 }}>
          {error ? <span className="loss">{error}</span>
            : !draft ? 'Pick at least one symbol'
            : est ? (est.canStart ? `≈ ${qty(est.calls)} Fyers calls · ${est.share === null ? '—' : `${Math.max(1, Math.round(est.share))}%`} of today` : est.blockers.join(' '))
            : 'Pricing…'}
        </span>
        {me && !me.fyers.connected ? (
          <button className="btn btn-primary" onClick={() => connectFyers()}>Connect Fyers</button>
        ) : (
          <button className="btn btn-primary" disabled={!est?.canStart || loading || starting || !draft} onClick={start}>
            {starting ? 'Starting…' : 'Run research'}
          </button>
        )}
      </div>

      {editing && (
        <div className="research-strategy">
          <div className="row">
            <span className="section spacer">Strategy for this research</span>
            {custom && <button type="button" className="link-btn accent" onClick={() => set({ config: { ...strategy } })}>Reset to default</button>}
          </div>
          <StrategyFields config={form.config} onChange={(patch) => setForm((f) => ({ ...f, config: { ...f.config, ...patch } }))} />
          <span className="caption">Default: {settingsLabel(strategy)} — the Journal’s strategy.</span>
        </div>
      )}
      {startError && <span className="loss" role="alert">{startError}</span>}
    </section>
  );
}

// The symbol a running run is on: its first pending one.
function useCurrentSymbol(run) {
  const [symbol, setSymbol] = useState(null);
  const running = run.status === 'running';
  useEffect(() => {
    if (!running) return setSymbol(null);
    let cancelled = false;
    api(`/api/runs/${run.id}`).then(({ symbols }) => !cancelled && setSymbol(symbols.find((s) => s.status === 'pending')?.symbol ?? null), () => {});
    return () => {
      cancelled = true;
    };
  }, [run.id, running, run.done]);
  return symbol;
}

function CardMenu({ run, onUse, onRename, onDelete }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <div className="card-confirm" onClick={(e) => e.stopPropagation()}>
        <span>Delete this run and its trades?</span>
        <button className="btn btn-sm btn-danger" onClick={onDelete}>Delete</button>
        <button className="btn btn-sm" onClick={() => setConfirming(false)}>Keep</button>
      </div>
    );
  }
  return (
    <span className="card-menu" onClick={(e) => e.stopPropagation()}>
      <button className="link-btn" aria-label="Run actions" aria-expanded={open} onClick={() => setOpen(!open)}>⋯</button>
      {open && (
        <span className="card-menu-list card" onMouseLeave={() => setOpen(false)}>
          <button onClick={() => { setOpen(false); onUse(); }}>Use these settings</button>
          <button onClick={() => { setOpen(false); onRename(); }}>Rename</button>
          {!isActive(run.status) && <button className="loss" onClick={() => { setOpen(false); setConfirming(true); }}>Delete</button>}
        </span>
      )}
    </span>
  );
}

function ResultCard({ run, selected, ticked, canTick, onTick, onSelect, onAction, onUse }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(run.name || '');
  const current = useCurrentSymbol(run);
  const m = run.metrics;
  const active = isActive(run.status);
  const p = progressFacts(run);

  const saveName = async () => {
    setRenaming(false);
    if (name.trim() !== (run.name || '')) await onAction(run.id, { name: name.trim() || null });
  };

  return (
    <article className={`result-card${selected ? ' on' : ''}`} onClick={() => !renaming && onSelect(run.id)} tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(run.id)} aria-current={selected || undefined}>
      <div className="result-card-top">
        {run.status === 'done' && (
          <input type="checkbox" className="result-tick" checked={ticked} disabled={!ticked && !canTick} aria-label={`Compare ${cardTitle(run)}`}
            onClick={(e) => e.stopPropagation()} onChange={() => onTick(run.id)} />
        )}
        {renaming ? (
          <input className="input" autoFocus value={name} maxLength={120} onClick={(e) => e.stopPropagation()} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setRenaming(false); }} onBlur={saveName} />
        ) : (
          <b className="result-card-title">{cardTitle(run)}</b>
        )}
        <span className="spacer" />
        {run.status === 'done' && m ? <b className={tone(m.totalPnl)}>{pnl(m.totalPnl)}</b> : <StatusPill status={run.status} />}
        <CardMenu run={run} onUse={() => onUse(run)} onRename={() => setRenaming(true)} onDelete={() => onAction(run.id, null)} />
      </div>
      <span className="caption">{dateShort(run.fromDate)} → {dateShort(run.toDate)} · {weekdaysBetween(run.fromDate, run.toDate)} days</span>
      {active ? (
        <>
          <div className={`progress progress-${run.status}`}><span style={{ width: `${p.pct}%` }} /></div>
          <span className="caption">
            {run.status === 'queued' ? 'Queued — starts after the runs ahead of it' : <>{run.done} / {run.total} symbols{current && <> · {current.replace(/^NSE:|-EQ$/g, '')}</>} · ≈ {duration(p.etaSeconds)} left</>}
          </span>
          <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); onAction(run.id, { cancel: true }); }}>Cancel</button>
        </>
      ) : m ? (
        <span className="caption">{qty(m.totalTrades)} trades · PF {profitFactor(m.profitFactor)} · max DD {pnl(-m.maxDrawdown)}</span>
      ) : (
        <span className="caption">{run.status === 'failed' ? run.error || 'Stopped' : 'Cancelled'} · {run.done} / {run.total} symbols finished</span>
      )}
      {run.status === 'failed' && (
        <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); onAction(run.id, { resume: true }); }}>Resume</button>
      )}
    </article>
  );
}

function ResultCards({ runs, selectedId, ticked, onTick, onSelect, onAction, onUse }) {
  const [all, setAll] = useState(false);
  if (!runs.length) {
    return <p className="caption">No research yet. Pick a list or a ticker and a range above, then Run research.</p>;
  }
  const shown = all ? runs : runs.slice(0, CARDS_SHOWN);
  return (
    <div className="stack" style={{ gap: 'var(--s-2)' }}>
      <div className="result-cards">
        {shown.map((r) => (
          <ResultCard key={r.id} run={r} selected={ticked.length < 2 && r.id === selectedId} ticked={ticked.includes(r.id)} canTick={ticked.length < MAX_COMPARE}
            onTick={onTick} onSelect={onSelect} onAction={onAction} onUse={onUse} />
        ))}
      </div>
      <span className="caption">{ticked.length ? `${ticked.length} ticked · ${ticked.length < 2 ? 'tick one more to compare' : 'comparing below'}` : 'Tick two to four to compare.'}</span>
      {runs.length > CARDS_SHOWN && (
        <button className="link-btn accent" style={{ alignSelf: 'flex-start' }} onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${runs.length} runs`}
        </button>
      )}
    </div>
  );
}

export default function Research() {
  const { data, error, reload } = useResearchData();
  const { refresh } = useMe();
  const [params, setParams] = useSearchParams();
  const [form, setForm] = useState(null);
  const [actionError, setActionError] = useState(null);

  useEffect(() => {
    if (data && !form) setForm(initialForm(data.lists, data.strategy));
  }, [data, form]);

  const runs = useMemo(() => (data ? researchRuns(data.items) : []), [data]);
  const selectedId = Number(params.get('run')) || runs.find((r) => r.status === 'done')?.id || null;
  const ticked = (params.get('compare') || '').split(',').map(Number).filter((id) => runs.some((r) => r.id === id));
  const select = (id) => setParams({ run: String(id) }, { replace: true });
  const setTicked = (ids) => {
    const next = new URLSearchParams(params);
    if (ids.length) next.set('compare', ids.join(','));
    else next.delete('compare');
    setParams(next, { replace: true });
  };
  const tick = (id) => setTicked(ticked.includes(id) ? ticked.filter((x) => x !== id) : [...ticked, id]);

  // Rename / cancel / resume with a patch body; delete with null.
  async function act(id, body) {
    setActionError(null);
    try {
      if (body === null) {
        await api(`/api/runs/${id}`, { method: 'DELETE' });
        if (id === selectedId) setParams({}, { replace: true });
      } else {
        await api(`/api/runs/${id}`, { method: 'PATCH', body });
      }
      await reload();
      refresh();
    } catch (err) {
      setActionError(err.message);
    }
  }

  // Load a run's settings, range and symbols into the launcher.
  async function use(run) {
    const { symbols } = await api(`/api/runs/${run.id}`);
    const list = data.lists.find((w) => w.name === run.watchlistName || run.name?.startsWith(`${w.name} (`));
    const syms = symbols.map((s) => s.symbol);
    setForm((f) => ({
      ...f,
      fromDate: run.fromDate < earliestFrom() ? earliestFrom() : run.fromDate,
      toDate: run.toDate,
      range: 'custom',
      config: { ...f.config, ...strategyOf(run.config) },
      ...(syms.length === 1 && !run.watchlistName
        ? { mode: 'symbol', symbol: { symbol: syms[0], ticker: syms[0].replace(/^NSE:|-EQ$/g, '') } }
        : list
          ? { mode: 'watchlist', watchlistId: list.id, subset: run.watchlistName ? null : syms }
          : f),
    }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (error) return <div className="banner banner-error">{error}</div>;
  if (!data || !form) return <p className="placeholder">Loading…</p>;
  // A Journal run has no card, but the Journal links its trades here.
  const selected = runs.find((r) => r.id === selectedId) || allRuns(data.items).find((r) => r.id === selectedId) || null;

  return (
    <div className="stack research">
      <div>
        <h1 className="display">Research</h1>
        <p className="page-sub">Any date range, on a whole list, some of its symbols, or one ticker.</p>
      </div>
      <Launcher form={form} setForm={setForm} lists={data.lists} strategy={data.strategy}
        onStarted={async (id) => { await reload(); select(id); }} />
      {actionError && <div className="banner banner-error">{actionError}</div>}
      <ResultCards runs={runs} selectedId={selectedId} ticked={ticked} onTick={tick} onSelect={select} onAction={act} onUse={use} />
      {ticked.length >= 2 ? (
        <RunsCompare ids={ticked} onClear={() => setTicked([])} />
      ) : selected && ['done', 'failed', 'cancelled'].includes(selected.status) && selected.done > 0 ? (
        <RunResults key={selected.id} run={selected} strategy={data.strategy} />
      ) : null}
    </div>
  );
}
