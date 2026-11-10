// Live paper trading (M6, D22, D23; docs/design/reference/live): the API's
// scheduler state and the paper trades it recorded, seen through one
// watchlist over a chosen range, as a trade list beside one trade's chart.
// Nothing here places orders; the session runs inside the API (api/live.js).
// The page opens on the last trading day and never moves on its own: Refresh
// picks up new trades. Opening a trade loads its day's candles from Fyers
// (one call, kept for the visit so paging back costs nothing).
// Fixed / Trail (D25) picks which paper flow the whole page shows; it lives
// in the URL (?flow=trail). The trail flow isn't reconciled.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { connectFyers } from '../lib/me.jsx';
import { istToday } from '../lib/dates.js';
import { dateLong, dateShort, pnl, qty, rate, tone } from '../lib/format.js';
import { RANGES, dailyRows, defaultWatchlist, liveNotice, liveRange, sessionHeader } from '../lib/live.js';
import { FLOWS, buildRows, parseFlow, reviewCounts, rowKey, sortRows, tabRows } from '../lib/liveView.js';
import { useNarrow } from '../lib/useMedia.js';
import { Stat } from '../components/Stat.jsx';
import Segmented from '../components/Segmented.jsx';
import DatePicker from '../components/DatePicker.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import Icon from '../components/Icon.jsx';
import LiveList from '../components/LiveList.jsx';
import LiveTrade from '../components/LiveTrade.jsx';

const WINDOWS = [['trade', 'Trade window'], ['full', 'Full day']];

function Notice({ notice }) {
  if (!notice) return null;
  const cls = notice.tone === 'error' ? 'banner-error' : notice.tone === 'info' ? 'banner-info' : '';
  return (
    <div className={`banner banner-row ${cls}`} role="status">
      <Icon name={notice.tone === 'info' ? 'info' : 'alert'} />
      <div>
        <b>{notice.title}</b> <span>{notice.body}</span>
      </div>
      <span className="spacer" />
      {notice.action === 'connect' && <button className="btn btn-primary" onClick={() => connectFyers()}>Connect Fyers</button>}
    </div>
  );
}

function CheckStat({ counts, checkedDays, onShow }) {
  if (!checkedDays) return <Stat label="Checked against backtest" value="Not yet" sub="checked after each close" />;
  const tick = counts.tick ? ` · ${qty(counts.tick)} tick order` : '';
  if (!counts.review) return <Stat label="Checked against backtest" value="All match" className="profit" sub={`${qty(checkedDays)} day${checkedDays === 1 ? '' : 's'} checked${tick}`} />;
  return (
    <div className="stat-card">
      <span className="label">Checked against backtest</span>
      <span className="stat warn">{qty(counts.review)} to review</span>
      <button type="button" className="link-btn accent caption live-show" onClick={onShow}>
        {counts.differ} differ · {counts.missed} missed{tick} — show
      </button>
    </div>
  );
}

// The enlarged chart is a per-browser preference, like the theme.
const EXPAND_KEY = 'orb.liveChartExpanded';
function readExpanded() {
  try { return localStorage.getItem(EXPAND_KEY) === '1'; } catch { return false; }
}
function saveExpanded(on) {
  try { localStorage.setItem(EXPAND_KEY, on ? '1' : '0'); } catch {}
}

export default function Live() {
  const narrow = useNarrow();
  const [params, setParams] = useSearchParams();
  const flow = parseFlow(params.get('flow'));
  const otherFlow = flow === 'trail' ? 'fixed' : 'trail';
  const [status, setStatus] = useState(null);
  const [lists, setLists] = useState(null);
  const [listId, setListId] = useState(null);
  const [symbols, setSymbols] = useState(null);
  const [range, setRange] = useState('day');
  const [date, setDate] = useState(null);
  const [picked, setPicked] = useState(false); // the user chose the Date; Refresh keeps it
  const [custom, setCustom] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [mailing, setMailing] = useState(null); // null | 'sending' | the date last mailed
  const [tab, setTab] = useState('traded');
  const [sortBy, setSortBy] = useState('time');
  const [selected, setSelected] = useState(null);
  const [open, setOpen] = useState(false); // phone: showing one trade instead of the list
  const [win, setWin] = useState('trade');
  const [expanded, setExpanded] = useState(readExpanded); // desktop: chart enlarged, list hidden
  const [charts, setCharts] = useState({});
  const [others, setOthers] = useState(null); // the other flow's trades, by date|symbol
  const [decisions, setDecisions] = useState({}); // date -> that day's decision log (trail stop moves)
  const [rechecking, setRechecking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0); // bumped by Refresh to re-read trades
  const latest = useRef(0); // only the newest trades request may land
  const loading = useRef(new Set());
  const today = istToday();

  // Status (and with it the last trading day) is read on open and on Refresh
  // only, so the page never jumps to a new day by itself.
  const loadStatus = useCallback(async () => {
    const [s, { watchlists }] = await Promise.all([api('/api/live/status'), api('/api/watchlists')]);
    const last = s.lastTradeDate || s.today;
    setStatus(s);
    setLists(watchlists);
    setListId((cur) => cur ?? defaultWatchlist(watchlists));
    setDate((cur) => (picked && cur ? cur : last));
    setCustom((cur) => cur ?? { from: last, to: last });
  }, [picked]);

  const { from, to } = date && custom ? liveRange(range, { date, custom }) : {};
  const oneDay = Boolean(from) && from === to;

  const loadTrades = useCallback(async () => {
    if (!from || !to) return;
    const id = ++latest.current;
    const q = (f) => new URLSearchParams({ from, to, flow: f, ...(listId && { watchlist: String(listId) }) });
    try {
      const d = await api(`/api/paper-trades?${q(flow)}`);
      if (id !== latest.current) return;
      setData(d);
      setError(null);
    } catch (err) {
      if (id === latest.current) setError(err.message);
      return;
    }
    // The same entries in the other flow, for "Same entry, Fixed: …". Not
    // worth an error banner if it fails: the panel just doesn't say.
    setOthers(null);
    try {
      const o = await api(`/api/paper-trades?${q(otherFlow)}`);
      if (id === latest.current) setOthers(new Map(o.trades.map((t) => [rowKey(t.date, t.symbol), t])));
    } catch {
      // leave it unknown
    }
  }, [from, to, listId, tick, flow]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadStatus().catch((err) => setError(err.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadTrades();
  }, [loadTrades]);

  // The list's symbols, for the "All" tab's untraded rows.
  useEffect(() => {
    if (!listId) return;
    let cancelled = false;
    api(`/api/watchlists/${listId}`).then(
      (d) => !cancelled && setSymbols((d.symbols || []).map((s) => (typeof s === 'string' ? s : s.symbol))),
      () => !cancelled && setSymbols(null)
    );
    return () => {
      cancelled = true;
    };
  }, [listId]);

  const rows = useMemo(
    () => (data ? buildRows({ trades: data.trades, reconciliations: data.reconciliations, symbols, missing: data.coverage?.missing, oneDay, date: from, flow: data.flow }) : []),
    [data, symbols, oneDay, from]
  );
  // Everything below follows the flow of the trades on screen, so a toggle
  // never pairs one flow's rows with the other's candles while it loads.
  const shownFlow = data?.flow ?? flow;
  const trail = shownFlow === 'trail';
  const tabs = [
    ['traded', 'Traded', tabRows(rows, 'traded').length],
    ...(oneDay ? [['all', 'All', rows.length]] : []),
    ...(trail ? [] : [['review', 'Review', tabRows(rows, 'review').length]]),
  ];
  const shownTab = tabs.some(([v]) => v === tab) ? tab : 'traded';
  const visibleRows = useMemo(() => sortRows(tabRows(rows, shownTab), sortBy), [rows, shownTab, sortBy]);
  const clickable = visibleRows.filter((r) => r.kind !== 'none');
  const current = clickable.find((r) => r.key === selected) || (narrow ? null : clickable[0]) || null;
  const at = current ? clickable.indexOf(current) : -1;

  // One Fyers call per paper trade opened, kept for the visit.
  const chartKey = current ? `${shownFlow}|${current.key}` : null;
  useEffect(() => {
    const t = current?.trade;
    if (!t || charts[chartKey] || loading.current.has(chartKey)) return;
    const key = chartKey;
    loading.current.add(key);
    setCharts((c) => ({ ...c, [key]: { loading: true } }));
    api(`/api/paper-trades/${t.date}/${encodeURIComponent(t.symbol)}/candles?flow=${shownFlow}`).then(
      (d) => setCharts((c) => ({ ...c, [key]: { data: d } })),
      (err) => setCharts((c) => ({ ...c, [key]: { error: err } }))
    ).finally(() => loading.current.delete(key));
  }, [current, charts]); // eslint-disable-line react-hooks/exhaustive-deps

  // A trail trade's stop moves are in its day's decision log: one call a day.
  const tradeDate = trail ? current?.trade?.date : null;
  useEffect(() => {
    if (!tradeDate || decisions[tradeDate]) return;
    setDecisions((d) => ({ ...d, [tradeDate]: { loading: true } }));
    api(`/api/paper-trades/${tradeDate}/decisions`).then(
      (d) => setDecisions((all) => ({ ...all, [tradeDate]: { list: d.decisions } })),
      () => setDecisions((all) => ({ ...all, [tradeDate]: { list: [] } }))
    );
  }, [tradeDate, decisions]);

  const pickFlow = (f) => {
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (f === 'fixed') next.delete('flow');
      else next.set('flow', f);
      return next;
    }, { replace: true });
    setSelected(null);
  };

  async function refresh() {
    setRefreshing(true);
    try {
      await loadStatus();
      setCharts((c) => Object.fromEntries(Object.entries(c).filter(([k]) => k.split('|')[1] !== today))); // today's candles move
      setDecisions(({ [today]: _, ...rest }) => rest);
      setTick((n) => n + 1);
    } catch (err) {
      setError(err.message);
    }
    setRefreshing(false);
  }

  // Mails the day's report (#157): the range's last day, the same mail as the EOD one.
  async function mailReport() {
    setMailing('sending');
    try {
      await api(`/api/paper-trades/${to}/mail`, { method: 'POST' });
      setMailing(to);
    } catch (err) {
      setError(err.message);
      setMailing(null);
    }
  }

  async function recheck() {
    setRechecking(true);
    try {
      await api(`/api/paper-trades/${from}/reconcile`, { method: 'POST' });
      setTick((n) => n + 1);
    } catch (err) {
      setError(err.message);
    }
    setRechecking(false);
  }

  const select = (key) => {
    setSelected(key);
    setOpen(true);
  };
  const step = (d) => {
    const next = clickable[at + d];
    if (!next) return;
    setSelected(next.key);
    if (narrow) window.scrollTo(0, 0);
  };

  if (error && !data) return <div className="banner banner-error">{error}</div>;
  if (!data || !status || !lists) return <p className="placeholder">Loading live paper trading…</p>;

  const head = sessionHeader(status);
  const { summary } = data;
  const days = dailyRows(data.trades);
  const counts = reviewCounts(rows);
  const span = oneDay ? dateLong(from) : `${dateShort(from)} – ${dateShort(to)}`;
  const afterClose = from < today || status.session === null;

  const nav = (
    <div className="row live-nav">
      <button className="btn icon-btn" aria-label="Previous trade" disabled={at <= 0} onClick={() => step(-1)}>‹</button>
      <button className="btn icon-btn" aria-label="Next trade" disabled={at < 0 || at >= clickable.length - 1} onClick={() => step(1)}>›</button>
      {!narrow && (
        <button className="btn icon-btn" aria-pressed={expanded} aria-label={expanded ? 'Shrink chart' : 'Enlarge chart'}
          title={expanded ? 'Shrink chart, show the trade list' : 'Enlarge chart, hide the trade list'}
          onClick={() => { setExpanded(!expanded); saveExpanded(!expanded); }}>
          <Icon name={expanded ? 'collapse' : 'expand'} />
        </button>
      )}
    </div>
  );
  const wide = expanded && !narrow && Boolean(current);
  const panel = current && (
    <LiveTrade key={chartKey} row={current} chart={charts[chartKey]} window={win} onWindow={setWin} nav={nav} narrow={narrow} wide={wide}
      flow={shownFlow} other={others ? others.get(current.key) ?? null : undefined} decisions={decisions[current.trade?.date]?.list} />
  );

  // Phone, one trade open: its own screen with Previous / Next at the bottom.
  if (narrow && open && current) {
    return (
      <div className="stack live-mobile-trade">
        <div className="row">
          <button className="link-btn accent live-back" onClick={() => setOpen(false)}>‹ All trades</button>
          <span className="spacer" />
          {current.trade && <Segmented label="Chart window" value={win} options={WINDOWS} onChange={setWin} />}
        </div>
        {panel}
        <div className="live-pager">
          <button className="btn btn-lg" disabled={at <= 0} onClick={() => step(-1)}>‹ Previous</button>
          <button className="btn btn-lg btn-primary" disabled={at >= clickable.length - 1} onClick={() => step(1)}>Next ›</button>
        </div>
      </div>
    );
  }

  const footer = (
    <>
      {shownTab === 'all' && data.coverage?.missing.length > 0 && (
        <p className="caption live-foot">{qty(data.coverage.missing.length)} of {qty(data.coverage.symbols)} symbols in “{data.coverage.watchlist.name}” aren’t traded live.</p>
      )}
      {!trail && shownTab === 'review' && oneDay && afterClose && (
        <div className="live-foot">
          <button className="link-btn accent" disabled={rechecking} onClick={recheck}>{rechecking ? 'Checking…' : 'Re-check day against the backtest'}</button>
        </div>
      )}
    </>
  );

  return (
    <div className="stack live-page">
      <div className="row page-head" style={{ alignItems: 'flex-start' }}>
        <div className="spacer">
          <div className="row live-title">
            <h1 className="display">Live paper</h1>
            <span className={`live-pill live-pill-${head.tone}`}><i />{head.pill}</span>
          </div>
          <p className="page-sub">{head.line}</p>
        </div>
        <Segmented label="Flow" value={flow} options={FLOWS} onChange={pickFlow} />
        <button className="btn" onClick={mailReport} disabled={!status.mail || mailing === 'sending'}
          title={status.mail ? `Mail the ${to} report (the mail list’s fixed trades)` : 'Mail isn’t set up: set BREVO_API_KEY and MAIL_TO on the API'}>
          {mailing === 'sending' ? 'Sending…' : mailing === to ? `Sent ${to}` : 'Mail report'}
        </button>
        <button className="btn" onClick={refresh} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
      </div>

      <div className="research-row">
        <Segmented label="Range" value={range} options={RANGES} onChange={(r) => { setRange(r); if (r === 'custom') setCustom({ from, to }); }} />
        {range === 'custom' ? (
          <>
            <label className="affix">From
              <DatePicker label="From" value={custom.from} max={custom.to} onChange={(v) => setCustom({ ...custom, from: v })} />
            </label>
            <label className="affix">To
              <DatePicker label="To" value={custom.to} min={custom.from} max={today} onChange={(v) => setCustom({ ...custom, to: v })} />
            </label>
          </>
        ) : (
          <label className="affix">Date
            <DatePicker label="Date" value={date} max={today} onChange={(v) => { setDate(v); setPicked(true); }} />
          </label>
        )}
        {/* Not a <label>: Radix opens the Select on pointer down, which a label's click doesn't send. */}
        <div className="affix">List
          <Select value={listId != null ? String(listId) : undefined} onValueChange={(v) => { setListId(Number(v)); setSelected(null); }}>
            <SelectTrigger size="sm" aria-label="List">
              <SelectValue placeholder="Pick a list" />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              {lists.map((w) => <SelectItem key={w.id} value={String(w.id)}>{w.name} · {qty(w.count)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Notice notice={liveNotice(status)} />
      {error && <div className="banner banner-error">{error}</div>}

      <div className="stat-grid stat-grid-fit live-stats">
        <Stat label="Net P&L" value={pnl(summary.netPnl)} className={tone(summary.netPnl)} sub={span} />
        <Stat label="Trades" value={qty(summary.trades)} sub={`${qty(summary.open)} open`} />
        <Stat label="Win rate" value={summary.winRate === null ? '—' : rate(summary.winRate)} sub={`${qty(summary.wins)} W · ${qty(summary.losses)} L`} />
        <Stat label="Days traded" value={qty(days.length)} sub={oneDay ? 'single day' : span} />
        {trail
          ? <Stat label="Checked against backtest" value="Live only" sub="the trail flow isn’t reconciled" />
          : <CheckStat counts={counts} checkedDays={data.reconciliations.length} onShow={() => { setTab('review'); setSelected(null); }} />}
      </div>

      <div className={`live-split${wide ? ' live-split-wide' : ''}`}>
        {!wide && <LiveList rows={visibleRows} tabs={tabs} tab={shownTab} onTab={(v) => { setTab(v); setSelected(null); }}
          sortBy={sortBy} onSort={setSortBy} selected={narrow ? null : current?.key} onSelect={select} footer={footer} />}
        {!narrow && (panel || <div className="card live-trade live-trade-empty"><p className="caption">No trades {oneDay ? `on ${dateLong(from)}` : 'in this range'}. {from === today ? 'Refresh to see new breakouts.' : ''}</p></div>)}
      </div>
    </div>
  );
}
