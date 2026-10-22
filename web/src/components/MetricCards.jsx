// The computeMetrics stat cards (FR-20), shared by the run dashboard and the
// ticker detail. `analysis` is a /api/runs/:id/analysis response.

import { dateShort, pnl, profitFactor, qty, rate, rMultiple, tone } from '../lib/format.js';

const short = (s) => s.replace(/^NSE:|-EQ$/g, '');

export function Stat({ label, value, sub, className = '' }) {
  return (
    <div className="stat-card">
      <span className="label">{label}</span>
      <span className={`stat ${className}`}>{value}</span>
      {sub && <span className="caption">{sub}</span>}
    </div>
  );
}

export default function MetricCards({ analysis, filtered = false }) {
  const m = analysis.metrics;
  const reasons = Object.fromEntries(analysis.breakdowns.reason.map((x) => [x.key, x]));
  const breakEven = m.avgWin > 0 ? (Math.abs(m.avgLoss) / (m.avgWin + Math.abs(m.avgLoss))) * 100 : null;
  const { best, worst } = analysis.extremes || {};
  return (
    <div className="stat-grid">
      <Stat label="Trades" value={qty(m.totalTrades)} sub={`${m.wins} won · ${m.losses} lost`} />
      <Stat label="Win rate" value={rate(m.winRate)} sub={breakEven === null ? null : `break-even ≈ ${breakEven.toFixed(0)}% at these win/loss sizes`} />
      <Stat label="Total P&L" value={pnl(m.totalPnl)} className={tone(m.totalPnl)} sub={filtered ? 'filtered view, net of costs' : 'net of costs'} />
      <Stat label="Expectancy / trade" value={pnl(m.expectancy)} className={tone(m.expectancy)} sub={`${rMultiple(m.avgR)} per trade`} />
      <Stat label="Profit factor" value={profitFactor(m.profitFactor)} sub="gross win ÷ gross loss" />
      <Stat label="Avg R" value={rMultiple(m.avgR)} className={tone(m.avgR)} sub="net, after costs" />
      <Stat label="Avg win" value={pnl(m.avgWin)} className={tone(m.avgWin)} sub="per winning trade" />
      <Stat label="Avg loss" value={pnl(m.avgLoss)} className={tone(m.avgLoss)} sub="per losing trade" />
      <Stat label="Max drawdown" value={pnl(-m.maxDrawdown)} className={tone(-m.maxDrawdown)} sub="peak to trough, closed P&L" />
      <Stat label="Best trade" value={pnl(m.bestTrade)} className={tone(m.bestTrade)} sub={best && `${short(best.symbol)} · ${dateShort(best.date)}`} />
      <Stat label="Worst trade" value={pnl(m.worstTrade)} className={tone(m.worstTrade)} sub={worst && `${short(worst.symbol)} · ${dateShort(worst.date)}`} />
      <Stat label="Exits" value={`${qty(reasons.SL.trades)} / ${qty(reasons.TARGET.trades)} / ${qty(reasons.EOD.trades)}`} sub="SL / Target / EOD" />
    </div>
  );
}
