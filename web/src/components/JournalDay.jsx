// One Journal day (v2/Journal — desktop.png, lower half): a day navigator,
// a card per list, and the selected list's summary, Long vs short, How trades
// ended and top movers. Numbers come from each list's Journal run, filtered to
// the day by the API (/analysis and /trades with from = to = day).

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { dateLong, pnl, profitFactor, qty, tone } from '../lib/format.js';
import { relativeDay, topMovers } from '../lib/journal.js';
import { LongShort, Narrative, TradesEnded } from './Summary.jsx';

const short = (s) => s.replace(/^NSE:|-EQ$/g, '');
const REASON = { TARGET: 'Target', SL: 'SL', EOD: 'EOD' };
const cache = new Map(); // `${runId}|${day}` -> { analysis, trades } (finished runs never change)

// "Wed 28 Oct" from 'Wed, 28 Oct 2026'.
const dayName = (ymd) => dateLong(ymd).replace(',', '').replace(/ \d{4}$/, '');

function useDayData(state, day) {
  const [byList, setByList] = useState({});
  const key = state.map((s) => s.done?.id ?? 0).join(',');
  useEffect(() => {
    if (!day) return;
    let cancelled = false;
    (async () => {
      const out = {};
      await Promise.all(
        state.filter((s) => s.done).map(async (s) => {
          const k = `${s.done.id}|${day}`;
          if (!cache.has(k)) {
            const q = `from=${day}&to=${day}`;
            const [analysis, { trades }] = await Promise.all([api(`/api/runs/${s.done.id}/analysis?${q}`), api(`/api/runs/${s.done.id}/trades?${q}`)]);
            cache.set(k, { analysis, trades });
          }
          out[s.list.id] = cache.get(k);
        })
      );
      if (!cancelled) setByList(out);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key, day]); // eslint-disable-line react-hooks/exhaustive-deps
  return byList;
}

function ListCard({ list, data, selected, onSelect }) {
  if (!data) {
    return <div className="day-card day-card-empty"><b>{list.name}</b> <span className="caption">{list.count} symbols · not run yet</span></div>;
  }
  const m = data.analysis.metrics;
  const side = Object.fromEntries(data.analysis.breakdowns.side.map((s) => [s.key, s]));
  const reason = Object.fromEntries(data.analysis.breakdowns.reason.map((r) => [r.key, r]));
  return (
    <button type="button" className={`day-card${selected ? ' on' : ''}`} onClick={onSelect} aria-pressed={selected}>
      <div className="day-card-top">
        <span><b className="day-card-name">{list.name}</b> <span className="caption">{list.count} symbols</span></span>
        <b className={`day-card-pnl ${tone(m.totalPnl)}`}>{m.totalTrades ? pnl(m.totalPnl) : '₹0'}</b>
      </div>
      {m.totalTrades ? (
        <>
          <span className="day-card-line">{qty(m.totalTrades)} trades · {Math.round(m.winRate)}% win · PF {profitFactor(m.profitFactor)}</span>
          <div className="day-card-sides">
            {['long', 'short'].map((k) => (
              <div key={k} className="kv">
                <span>{k === 'long' ? 'Long' : 'Short'}</span>
                <span className={tone(side[k]?.pnl)}>{pnl(side[k]?.pnl ?? 0)} ({side[k]?.trades ?? 0})</span>
              </div>
            ))}
          </div>
          <div className="share-bar share-bar-lg">
            {['TARGET', 'SL', 'EOD'].map((k) => <span key={k} className={`share-${k}`} style={{ width: `${reason[k]?.share ?? 0}%` }} />)}
          </div>
          <span className="caption">Target {Math.round(reason.TARGET?.share ?? 0)}% · Stop {Math.round(reason.SL?.share ?? 0)}% · EOD {Math.round(reason.EOD?.share ?? 0)}%</span>
        </>
      ) : (
        <span className="day-card-line caption">No breakouts this day.</span>
      )}
    </button>
  );
}

function Mover({ trade, runId }) {
  return (
    <Link className={`mover ${trade.pnl > 0 ? 'mover-profit' : 'mover-loss'}`} to={`/runs/${runId}/symbols/${encodeURIComponent(trade.symbol)}?trade=${trade.id}`}>
      <b>{short(trade.symbol)}</b>
      <span className="caption">{trade.side === 'long' ? 'Long' : 'Short'} · {REASON[trade.reason]}</span>
      <b className={tone(trade.pnl)}>{pnl(trade.pnl)}</b>
    </Link>
  );
}

function ListDay({ s, data, day }) {
  const m = data.analysis.metrics;
  const { best, worst } = topMovers(data.trades);
  return (
    <div className="stack day-detail">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <h2 className="title-lg spacer">{s.list.name} · {dayName(day)}</h2>
        <span className="caption">{qty(s.list.count)} symbols · {qty(m.totalTrades)} trades</span>
      </div>
      <Narrative analysis={data.analysis} className="narrative-xl" />
      {m.totalTrades > 0 && (
        <>
          <div className="summary-grid">
            <LongShort analysis={data.analysis} />
            <TradesEnded analysis={data.analysis} />
          </div>
          <section className="card summary-card">
            <div className="row">
              <h2 className="section spacer">Top movers</h2>
              <Link to={`/research?run=${s.done.id}&from=${day}&to=${day}`}>See all {qty(m.totalTrades)} trades in Research →</Link>
            </div>
            <div className="movers">
              <div>
                <span className="label movers-head">Best</span>
                <div className="mover-list">{best.length ? best.map((t) => <Mover key={t.id} trade={t} runId={s.done.id} />) : <span className="caption">No winners.</span>}</div>
              </div>
              <div>
                <span className="label movers-head">Worst</span>
                <div className="mover-list">{worst.length ? worst.map((t) => <Mover key={t.id} trade={t} runId={s.done.id} />) : <span className="caption">No losers.</span>}</div>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default function JournalDay({ state, dates, day, onDay, listId, onList }) {
  const byList = useDayData(state, day);
  if (!day) return null;
  const i = dates.indexOf(day);
  const rel = relativeDay(day);
  const total = Object.values(byList).reduce((a, d) => a + d.analysis.metrics.totalPnl, 0);
  const lists = state.filter((s) => s.list.count > 0);
  const selected = lists.find((s) => s.list.id === listId && byList[s.list.id]) || lists.find((s) => byList[s.list.id]) || null;

  return (
    <div className="stack journal-day">
      <div className="day-nav">
        <button className="btn icon-btn" aria-label="Previous day" disabled={i <= 0} onClick={() => onDay(dates[i - 1])}>‹</button>
        <h2 className="day-title">{rel && `${rel} · `}{dayName(day)}</h2>
        <button className="btn icon-btn" aria-label="Next day" disabled={i < 0 || i >= dates.length - 1} onClick={() => onDay(dates[i + 1])}>›</button>
        {Object.keys(byList).length > 0 && <span className="day-total">All lists together <b className={tone(total)}>{pnl(total)}</b></span>}
      </div>
      <div className="day-cards">
        {lists.map((s) => (
          <ListCard key={s.list.id} list={s.list} data={byList[s.list.id]} selected={selected?.list.id === s.list.id} onSelect={() => onList(s.list.id)} />
        ))}
      </div>
      {selected && <ListDay s={selected} data={byList[selected.list.id]} day={day} />}
    </div>
  );
}
