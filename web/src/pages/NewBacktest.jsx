// New backtest (F4, F5; New backtest.png). Prefilled from the latest run's
// settings (D7), or from ?run=<id> (duplicate) or ?watchlist=<id> (backtest
// this list). The estimate panel prices the draft live and explains why Start
// is blocked rather than failing after the click (States.png).

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { connectFyers, useMe } from '../lib/me.jsx';
import { dateShort, qty, rupees } from '../lib/format.js';
import { daysBetween, defaultTo, earliestFrom, lastTradingDay, rangeFor, istToday } from '../lib/dates.js';
import Section from '../components/Section.jsx';
import Segmented from '../components/Segmented.jsx';
import Toggle from '../components/Toggle.jsx';
import SymbolSearch from '../components/SymbolSearch.jsx';
import Icon from '../components/Icon.jsx';
import { settingsLabel, stopLabel } from '../lib/runs.js';

const SWEEP_VARIANTS = 9; // src/targets.js
const STOP_HINTS = {
  pct: 'Pct — always SL % from the entry. Fixed risk, ignores how wide the range is.',
  range: 'Range — the opposite edge of the opening range. The classic ORB stop; risk varies by day.',
  tighter: 'Tighter — whichever of Pct and Range is closer to the entry. Smaller risk, more stop-outs.',
  wider: 'Wider — whichever of Pct and Range is further from the entry. Room to breathe, larger risk.',
};
const DIRECTION = { long: 'Long', short: 'Short', both: 'Both' };

// What the form holds -> the API's draft body. Numbers typed as text are sent
// as numbers; anything unparseable comes back from the API as a 400 message.
function toDraft(form) {
  const n = (v) => (v === '' || v === null ? undefined : Number(v));
  const c = form.config;
  return {
    name: form.name.trim() || undefined,
    fromDate: form.fromDate,
    toDate: form.toDate,
    ...(form.mode === 'watchlist' ? { watchlistId: form.watchlistId ?? undefined } : { symbols: form.picked.map((p) => p.symbol) }),
    sweep: form.sweep,
    config: {
      direction: c.direction,
      orbStart: c.orbStart,
      orbEnd: c.orbEnd,
      sessionEnd: c.sessionEnd,
      slMode: c.slMode,
      slPct: n(c.slPct),
      targetMode: c.targetMode,
      targetR: n(c.targetR),
      targetPct: n(c.targetPct),
      sizing: c.sizing,
      capitalPerTrade: n(c.capitalPerTrade),
      leverage: n(c.leverage),
      quantity: n(c.quantity),
      costBps: n(c.costBps),
    },
  };
}


function useInitialForm(params) {
  const [form, setForm] = useState(null);
  const [lists, setLists] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ watchlists }, defaults] = await Promise.all([api('/api/watchlists'), api('/api/defaults')]);
        const to = defaultTo();
        let base = {
          name: '',
          ...rangeFor(12, to),
          mode: 'watchlist',
          watchlistId: watchlists.find((w) => w.name === 'core')?.id ?? watchlists[0]?.id ?? null,
          picked: [],
          sweep: false,
          config: { ...defaults.config },
        };
        const runId = params.get('run');
        const listId = Number(params.get('watchlist'));
        if (runId) {
          // Duplicate: same settings, dates and symbols as that run (F9).
          const { run, symbols } = await api(`/api/runs/${runId}`);
          const list = watchlists.find((w) => w.name === run.watchlistName);
          base = {
            ...base,
            name: run.name ? `${run.name} (copy)` : '',
            fromDate: run.fromDate < earliestFrom() ? earliestFrom() : run.fromDate,
            toDate: run.toDate,
            config: { ...base.config, ...run.config },
            ...(list
              ? { mode: 'watchlist', watchlistId: list.id }
              : { mode: 'pick', picked: symbols.map((s) => ({ symbol: s.symbol, ticker: s.symbol.replace(/^NSE:|-EQ$/g, '') })) }),
          };
        } else if (listId && watchlists.some((w) => w.id === listId)) {
          base.watchlistId = listId;
        }
        if (!cancelled) {
          setLists(watchlists);
          setForm(base);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params]);

  return { form, setForm, lists, error };
}

// Debounced POST /api/estimate whenever the draft changes.
function useEstimate(draft, refreshKey) {
  const [state, setState] = useState({ loading: true });
  const key = JSON.stringify(draft);
  useEffect(() => {
    if (!draft) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    const t = setTimeout(async () => {
      try {
        const est = await api('/api/estimate', { method: 'POST', body: draft });
        if (!cancelled) setState({ est });
      } catch (err) {
        if (!cancelled) setState({ error: err.message });
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [key, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

function minutes(seconds) {
  return seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}

function EstimatePanel({ form, lists, estimate, onStart, starting, startError }) {
  const { me } = useMe();
  const { est, error, loading } = estimate;
  const c = form.config;
  const list = lists.find((w) => w.id === form.watchlistId);
  const symbolCount = est?.symbols ?? (form.mode === 'watchlist' ? list?.count ?? 0 : form.picked.length);
  const notConnected = me && !me.fyers.connected;

  let tone = '';
  if (est && !est.canStart) tone = 'red';
  else if (est && est.share > 50) tone = 'amber';

  const used = est?.budget.used ?? 0;
  const cap = est?.budget.cap ?? 4800;
  const queued = est?.budget.queued ?? 0;

  return (
    <div className="launcher-side">
      <div className="card stack" style={{ gap: 'var(--s-3)', padding: 'var(--s-4)' }}>
        <h2 className="section">Before you start</h2>
        <div>
          <div className="kv"><span>Symbols</span><span>{symbolCount}</span></div>
          <div className="kv"><span>Range</span><span>{daysBetween(form.fromDate, form.toDate)} days</span></div>
          <div className="kv"><span>Variants</span><span>{form.sweep ? SWEEP_VARIANTS : 1}</span></div>
          <div className="kv"><span>Settings</span><span>{form.sweep ? `${DIRECTION[c.direction]} · ${stopLabel(c)} · all targets` : settingsLabel(c)}</span></div>
        </div>

        {error ? (
          <div className="estimate estimate-red" role="alert">
            <span className="estimate-head">Can’t start yet</span>
            <span className="loss">{error}</span>
          </div>
        ) : est ? (
          <div className={`estimate${tone ? ` estimate-${tone}` : ''}`} style={{ opacity: loading ? 0.6 : 1 }}>
            <span className="estimate-head">
              ≈ {qty(est.calls)} Fyers calls · ≈ {minutes(est.seconds)} · {est.share === null ? '—' : `${Math.round(est.share)}%`} of today’s budget
            </span>
            <div className="budget-bar" aria-hidden="true">
              <span className="budget-used" style={{ width: `${Math.min(100, ((used + queued) / cap) * 100)}%` }} />
              <span className="budget-this" style={{ width: `${Math.min(100, (est.calls / cap) * 100)}%` }} />
            </div>
            {est.canStart ? (
              <span className={tone === 'amber' ? 'warn' : 'caption'}>
                {qty(est.budget.remaining)} calls left today after {qty(used)} used{queued ? ` and ${qty(queued)} queued` : ''}.
                {tone === 'amber'
                  ? ` Uses ${Math.round(est.share)}% of what’s left — fine to run, but little room for trade charts afterwards.`
                  : ` This run leaves ${qty(est.budget.remaining - est.calls)}.`}
              </span>
            ) : (
              <span className="loss">{est.blockers.join(' ')}{est.calls > est.budget.remaining && ' Shorten the range, pick fewer symbols, or run it tomorrow.'}</span>
            )}
          </div>
        ) : (
          <div className="estimate"><span className="caption">Pricing this run…</span></div>
        )}

        <button className="btn btn-primary btn-lg" disabled={!est?.canStart || loading || starting || Boolean(error)} onClick={onStart}>
          {starting ? 'Starting…' : 'Start backtest'}
        </button>
        {notConnected && (
          <>
            <span className="caption">Connect Fyers first — the connection resets every morning and candles can’t be fetched without it.</span>
            <button className="btn btn-lg" onClick={() => connectFyers()}>Connect Fyers</button>
          </>
        )}
        {startError && <span className="loss" role="alert">{startError}</span>}
      </div>
      <p className="caption" style={{ margin: 0 }}>
        Runs continue on the server — you can close this tab and find progress under <Link to="/runs">Runs</Link>.
      </p>
    </div>
  );
}

function listBlurb(w) {
  if (w.description) return w.description;
  if (w.source === 'import') return `Imported from ${w.sourceFile || '.txt'}`;
  if (w.source === 'seed') return w.readOnly ? 'Every stock in the F&O segment' : `Seeded from lists/${w.sourceFile}`;
  return 'Your list';
}

export default function NewBacktest() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { me, refresh } = useMe();
  const { form, setForm, lists, error } = useInitialForm(params);
  const draft = useMemo(() => (form ? toDraft(form) : null), [form]);
  const estimate = useEstimate(draft, me?.fyers.connected);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(null);

  if (error) return <div className="banner banner-error">{error}</div>;
  if (!form) return <p className="placeholder">Loading…</p>;

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setC = (patch) => setForm((f) => ({ ...f, config: { ...f.config, ...patch } }));
  const c = form.config;
  const today = istToday();
  const list = lists.find((w) => w.id === form.watchlistId);

  async function start() {
    setStarting(true);
    setStartError(null);
    try {
      const res = await api('/api/runs', { method: 'POST', body: draft });
      refresh();
      navigate(`/runs/${res.id}/progress`);
    } catch (err) {
      setStartError(err.message);
      setStarting(false);
    }
  }

  const targetHint =
    c.targetMode === 'R'
      ? `${c.targetR}R = ${c.targetR} × the stop distance`
      : c.targetMode === 'pct'
        ? `Target ${c.targetPct}% from the entry, whatever the stop`
        : 'No target — exits on the stop or at session end';
  const notional = Number(c.capitalPerTrade) * Number(c.leverage);

  return (
    <div className="stack">
      <div>
        <h1 className="display">New backtest</h1>
        <p className="caption" style={{ margin: '4px 0 0', fontSize: 13.5 }}>
          {params.get('run') ? 'Settings copied from that run.' : 'Defaults match your last run.'} Everything is in IST.
        </p>
      </div>

      <div className="launcher">
        <div className="stack" style={{ gap: 'var(--s-3)' }}>
          <Section title="Date range" summary={`${dateShort(form.fromDate)} → ${dateShort(form.toDate)}`}>
            <div className="fields">
              <label className="field"><span className="label">From</span>
                <input className="input input-date" type="date" value={form.fromDate} min={earliestFrom(today)} max={form.toDate}
                  onChange={(e) => set({ fromDate: e.target.value })} />
              </label>
              <label className="field"><span className="label">To</span>
                <input className="input input-date" type="date" value={form.toDate} min={form.fromDate} max={today}
                  onChange={(e) => set({ toDate: e.target.value })} />
              </label>
              <div className="row">
                <button type="button" className="chip-btn" onClick={() => set({ fromDate: today, toDate: today })}>Today</button>
                <button type="button" className="chip-btn" onClick={() => { const d = lastTradingDay(today); set({ fromDate: d, toDate: d }); }}>Last trading day</button>
                {[[12, '1Y'], [6, '6M'], [3, '3M'], [1, '1M']].map(([m, label]) => (
                  <button type="button" key={label} className="chip-btn" onClick={() => set(rangeFor(m, form.toDate, today))}>{label}</button>
                ))}
              </div>
            </div>
            <span className="caption">
              Earliest start: {dateShort(earliestFrom(today))} · {daysBetween(form.fromDate, form.toDate)} calendar days selected
            </span>
          </Section>

          <Section title="Symbols" summary={form.mode === 'watchlist' ? (list ? `${list.name} · ${list.count} symbols` : 'No watchlist') : `${form.picked.length} picked`}>
            <Segmented value={form.mode} options={[['watchlist', 'Watchlist'], ['pick', 'Pick symbols']]} onChange={(mode) => set({ mode })} label="Symbols from" />
            {form.mode === 'watchlist' ? (
              <>
                <div className="row">
                  <span className="caption">Pick one of your watchlists</span>
                  <span className="spacer" />
                  <Link to="/watchlists" className="caption" style={{ color: 'var(--accent)' }}>Manage watchlists · import .txt</Link>
                </div>
                <div className="pick-grid">
                  {lists.map((w) => (
                    <button type="button" key={w.id} className={`pick-card${w.id === form.watchlistId ? ' on' : ''}`} onClick={() => set({ watchlistId: w.id })}>
                      <span className="pick-card-top"><span>{w.name}</span><span className="caption">{w.count} symbols</span></span>
                      <span className="caption">{listBlurb(w)}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <SymbolSearch exclude={form.picked.map((p) => p.symbol)} onPick={(r) => set({ picked: [...form.picked, r] })} />
                {form.picked.length > 0 ? (
                  <div className="chips">
                    {form.picked.map((p) => (
                      <span className="chip" key={p.symbol} title={p.name}>
                        {p.ticker}
                        <button type="button" aria-label={`Remove ${p.ticker}`} onClick={() => set({ picked: form.picked.filter((x) => x.symbol !== p.symbol) })}>
                          <Icon name="close" size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="caption">Add at least one symbol.</span>
                )}
              </>
            )}
          </Section>

          <Section title="Entry, stop & target" summary={settingsLabel(c)}>
            <div className="fields">
              <label className="field"><span className="label">Direction</span>
                <Segmented value={c.direction} options={[['long', 'Long'], ['short', 'Short'], ['both', 'Both']]} onChange={(direction) => setC({ direction })} label="Direction" />
              </label>
              <label className="field"><span className="label">OR start</span>
                <input className="input input-time" inputMode="numeric" maxLength={5} placeholder="HH:MM" value={c.orbStart} onChange={(e) => setC({ orbStart: e.target.value })} />
              </label>
              <label className="field"><span className="label">OR end</span>
                <input className="input input-time" inputMode="numeric" maxLength={5} placeholder="HH:MM" value={c.orbEnd} onChange={(e) => setC({ orbEnd: e.target.value })} />
              </label>
              <label className="field"><span className="label">Session end</span>
                <input className="input input-time" inputMode="numeric" maxLength={5} placeholder="HH:MM" value={c.sessionEnd} onChange={(e) => setC({ sessionEnd: e.target.value })} />
              </label>
            </div>
            <hr className="divider" />
            <div className="fields">
              <label className="field"><span className="label">Stop mode</span>
                <Segmented value={c.slMode} options={[['pct', 'Pct'], ['range', 'Range'], ['tighter', 'Tighter'], ['wider', 'Wider']]} onChange={(slMode) => setC({ slMode })} label="Stop mode" />
              </label>
              <label className="field"><span className="label">SL %</span>
                <input className="input" inputMode="decimal" value={c.slPct} onChange={(e) => setC({ slPct: e.target.value })} disabled={c.slMode === 'range'} />
              </label>
            </div>
            <div className="hint">{STOP_HINTS[c.slMode]}</div>
            <hr className="divider" />
            <div className="fields">
              <label className="field"><span className="label">Target mode</span>
                <Segmented value={c.targetMode} options={[['R', 'R'], ['pct', 'Pct'], ['none', 'None']]} onChange={(targetMode) => setC({ targetMode })} label="Target mode" />
              </label>
              {c.targetMode !== 'none' && (
                <label className="field"><span className="label">Target ({c.targetMode === 'R' ? 'R' : '%'})</span>
                  <input className="input" inputMode="decimal" value={c.targetMode === 'R' ? c.targetR : c.targetPct}
                    onChange={(e) => setC(c.targetMode === 'R' ? { targetR: e.target.value } : { targetPct: e.target.value })} />
                </label>
              )}
              <span className="caption" style={{ paddingBottom: 8 }}>{targetHint}</span>
            </div>
            {form.sweep && <span className="caption">Sweep is on: the target here is replaced by each of the {SWEEP_VARIANTS} target rules.</span>}
          </Section>

          <Section title="Sizing" summary={c.sizing === 'fixed' ? `Fixed · ${c.quantity} shares` : `Entry-price based · ${rupees(Number(c.capitalPerTrade))} × ${c.leverage}x`}>
            <Segmented value={c.sizing} options={[['entryPrice', 'Entry-price based'], ['fixed', 'Fixed qty']]} onChange={(sizing) => setC({ sizing })} label="Sizing" />
            {c.sizing === 'entryPrice' ? (
              <div className="fields">
                <label className="field"><span className="label">Capital per trade</span>
                  <span className="affix">₹<input className="input" style={{ width: 120 }} inputMode="numeric" value={c.capitalPerTrade} onChange={(e) => setC({ capitalPerTrade: e.target.value })} /></span>
                </label>
                <label className="field"><span className="label">Leverage</span>
                  <span className="affix"><input className="input" style={{ width: 72 }} inputMode="decimal" value={c.leverage} onChange={(e) => setC({ leverage: e.target.value })} />x</span>
                </label>
                <span className="caption" style={{ paddingBottom: 8 }}>
                  Qty = ⌊{rupees(notional)} ÷ entry price⌋ · e.g. at ₹1,180 → {Number.isFinite(notional) ? Math.max(1, Math.floor(notional / 1180)) : '—'} shares
                </span>
              </div>
            ) : (
              <div className="fields">
                <label className="field"><span className="label">Quantity</span>
                  <input className="input" inputMode="numeric" value={c.quantity} onChange={(e) => setC({ quantity: e.target.value })} />
                </label>
                <span className="caption" style={{ paddingBottom: 8 }}>The same number of shares on every trade, whatever the price.</span>
              </div>
            )}
          </Section>

          <Section title="Costs" summary={`${c.costBps} bps round-trip`} defaultOpen={false}>
            <div className="fields">
              <label className="field"><span className="label">Cost (bps, round-trip)</span>
                <input className="input" inputMode="decimal" value={c.costBps} onChange={(e) => setC({ costBps: e.target.value })} />
              </label>
              <span className="caption" style={{ paddingBottom: 8 }}>10 bps = 0.1% of entry + exit value, taken off every trade. 0 shows the raw edge.</span>
            </div>
          </Section>

          <section className="card row" style={{ padding: 'var(--s-3) var(--s-4)' }}>
            <div className="spacer">
              <div className="section">Sweep targets</div>
              <div className="caption">Run these settings once per target rule and compare them side by side. Candles are fetched once — no extra Fyers calls.</div>
            </div>
            <Toggle checked={form.sweep} onChange={(sweep) => set({ sweep })} label="Sweep targets" />
          </section>

          <section className="card" style={{ padding: 'var(--s-3) var(--s-4)' }}>
            <label className="field"><span className="label">Run name (optional)</span>
              <input className="input" style={{ maxWidth: 420 }} maxLength={120} placeholder={list && form.mode === 'watchlist' ? `${list.name} · ${settingsLabel(c)}` : ''}
                value={form.name} onChange={(e) => set({ name: e.target.value })} />
            </label>
          </section>
        </div>

        <EstimatePanel form={form} lists={lists} estimate={estimate} onStart={start} starting={starting} startError={startError} />
      </div>
    </div>
  );
}
