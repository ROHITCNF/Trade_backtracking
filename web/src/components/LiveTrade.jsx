// The Live page's trade panel (docs/design/reference/live): the day's candles
// with the opening range, entry, stop, target, exit, best and worst move, and
// the backtest's entry when it differs; then the backtest check, "What
// happened" and the numbers. Missed rows (backtest traded, live didn't) have
// no paper trade, so no candles: their panel shows the backtest's numbers.

import { connectFyers } from '../lib/me.jsx';
import { dateLong, pnl, price, qty, rMultiple, tone } from '../lib/format.js';
import { REASON, checkText, held, rOf, short, tradeStory, tsOn } from '../lib/liveView.js';
import TradeChart from './TradeChart.jsx';
import Segmented from './Segmented.jsx';

const WINDOWS = [['trade', 'Trade window'], ['full', 'Full day']];
const REASON_LONG = { SL: 'Stopped out', TARGET: 'Target', EOD: 'End of day' };

function Cell({ label, value, className = '' }) {
  return (
    <div className="live-cell">
      <span className="label">{label}</span>
      <b className={className}>{value}</b>
    </div>
  );
}

function Legend({ backtest }) {
  return (
    <div className="live-legend caption">
      <span><i className="lg-band" />Opening range</span>
      <span><i className="lg-ring" />Entry</span>
      <span><i className="lg-square" />Exit</span>
      <span><i className="lg-diamond profit-bg" />Best move</span>
      <span><i className="lg-diamond loss-bg" />Worst move</span>
      {backtest && <span><i className="lg-ring lg-dashed" />Backtest</span>}
    </div>
  );
}

function ChartState({ chart }) {
  if (!chart || chart.loading) return <div className="chart-state live-chart-state"><p className="placeholder">Loading 1-minute candles from Fyers…</p></div>;
  if (chart.error) {
    const connect = chart.error.status === 409;
    return (
      <div className="chart-state chart-state-box live-chart-state">
        <b>{connect ? 'Connect Fyers to load the chart' : 'The chart didn’t load'}</b>
        <span className="caption">{connect ? 'Candles are fetched from the broker on demand. The trade’s numbers below don’t need it.' : chart.error.message}</span>
        {connect && <button className="btn btn-primary" onClick={() => connectFyers()}>Connect Fyers</button>}
      </div>
    );
  }
  return null;
}

export default function LiveTrade({ row, chart, window: win, onWindow, nav, narrow }) {
  const t = row.trade;
  const m = row.mismatch;
  const head = (
    <div className="live-trade-head">
      <div className="spacer">
        <div className="row live-trade-title">
          <span className="title-lg">{short(row.symbol)}</span>
          {row.side && <span className={`side-tag side-${row.side}`}>{row.side === 'long' ? 'Long' : 'Short'}</span>}
          {t ? (
            <>
              <b className={`title-lg ${tone(t.pnl)}`}>{t.status === 'open' ? 'Open' : pnl(t.pnl)}</b>
              {t.status === 'closed' && <span className={tone(rOf(t))}>{rMultiple(rOf(t))}</span>}
              {t.status === 'closed' && <span className="caption-md">· {REASON_LONG[t.reason] || t.reason}</span>}
            </>
          ) : (
            <span className="warn-tag">missed by live</span>
          )}
        </div>
        <p className="caption-md">{dateLong(row.date)}{t ? ' · 1-minute · IST' : ' · backtest only'}</p>
      </div>
      {!narrow && t && <Segmented label="Chart window" value={win} options={WINDOWS} onChange={onWindow} />}
      {!narrow && nav}
    </div>
  );

  if (!t) {
    const bt = m?.backtest || {};
    return (
      <div className="card live-trade">
        {head}
        <div className="banner banner-warn live-check">{checkText(m)}</div>
        <div className="live-grid">
          <Cell label="Backtest entry" value={`${bt.entryTime || '—'} · ${price(bt.entry)}`} />
          <Cell label="Side" value={bt.side === 'long' ? 'Long' : bt.side === 'short' ? 'Short' : '—'} />
          <Cell label="Backtest exit" value={price(bt.exit)} />
          <Cell label="Reason" value={REASON[bt.reason] || bt.reason || '—'} />
        </div>
      </div>
    );
  }

  const data = chart?.data;
  const shown = data?.trade;
  const story = shown ? tradeStory(shown, data.candles, data.orbEnd) : null;
  const ex = story?.excursions;
  const bt = m?.backtest;
  const btMark = shown && bt?.entry != null && bt.entryTime && /^entry|^side/.test(m.problem) ? { time: tsOn(shown, bt.entryTime), price: bt.entry, shape: 'dashed-ring', color: 'muted' } : null;
  // Drawn in order, so the backtest's ring sits under live's entry.
  const marks = shown && [
    btMark && btMark.time != null && btMark,
    { time: shown.entryTs, price: shown.entry, shape: 'ring', color: 'accent' },
    shown.exitTs != null && { time: shown.exitTs, price: shown.exit, shape: 'square', color: 'ink' },
    ex && { time: ex.best.ts, price: ex.best.price, shape: 'diamond', color: 'profit' },
    ex && { time: ex.worst.ts, price: ex.worst.price, shape: 'diamond', color: 'loss' },
  ].filter(Boolean);
  const last = data?.candles.at(-1)?.[0];
  const visible = shown && win === 'trade' && last
    ? { from: Math.max(data.candles[0][0], shown.entryTs - 25 * 60), to: Math.min(last, (shown.exitTs ?? last) + 10 * 60) }
    : null;

  return (
    <div className="card live-trade">
      {head}
      {shown ? (
        <>
          <div className="live-chart">
            {shown.orbHigh != null && <span className="live-orb-label">Opening range {price(shown.orbLow)} – {price(shown.orbHigh)}</span>}
            <TradeChart candles={data.candles} trade={shown} orbEnd={data.orbEnd} height={narrow ? 340 : 440}
              marks={marks} visible={visible} bandFull lineTitles={false} />
          </div>
          <Legend backtest={Boolean(btMark)} />
        </>
      ) : (
        <ChartState chart={chart} />
      )}

      {m && <div className="banner banner-warn live-check">{checkText(m, t)}</div>}

      {story && (
        <section className="stack live-story">
          <h3 className="title">What happened</h3>
          <ol className="timeline">
            {story.events.map((e, i) => (
              <li key={i} className={e.last ? `timeline-last ${e.tone}-soft-bg` : ''}>
                <b className="timeline-time">{e.time}</b>
                <i className={`timeline-dot ${e.tone}-dot`} />
                <span>{e.text}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="live-grid">
        <Cell label="Entry" value={`${t.entryTime} · ${price(t.entry)}`} />
        <Cell label="Stop loss" value={price(t.sl)} className="loss" />
        <Cell label="Target" value={price(t.target)} className="profit" />
        <Cell label="Exit" value={t.status === 'open' ? 'Open' : `${t.exitTime} · ${price(t.exit)}`} />
        <Cell label="Qty" value={qty(t.quantity)} />
        <Cell label="P&L" value={pnl(t.pnl)} className={tone(t.pnl)} />
        <Cell label="R" value={rMultiple(rOf(t))} className={tone(rOf(t))} />
        <Cell label="Held" value={t.status === 'open' ? '—' : held(t.entryTime, t.exitTime)} />
      </div>
    </div>
  );
}
