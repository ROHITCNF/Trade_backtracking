// The Research, Journal and Live charts (design system § Chart styles).
// Every number shown comes from the API; these only draw it.

import { useMemo } from 'react';
import EChart from './EChart.jsx';
import { axisStyle, baseOption, signColor, useThemeColors } from '../lib/chartTheme.js';
import { dateShort, pnl, qty } from '../lib/format.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ts = (ymd) => Date.parse(`${ymd}T00:00:00Z`);
// Axis labels: ₹10k, −₹1.2L (true minus before the ₹, like every signed amount).
const compact = (v) => {
  const a = Math.abs(v);
  const body = a >= 100000 ? `${(a / 100000).toFixed(1)}L` : a >= 1000 ? `${(a / 1000).toFixed(0)}k` : `${Math.round(a)}`;
  return `${v < 0 ? '\u2212' : ''}₹${body}`;
};

// Time-axis ticks: months over a long range, days over a short one, so a
// month name never repeats along the axis.
const spanDays = (curve) => (curve.length > 1 ? (ts(curve.at(-1).date) - ts(curve[0].date)) / 864e5 : 0);
const tickMs = (curve) => (spanDays(curve) > 75 ? 28 : spanDays(curve) > 21 ? 7 : 1) * 864e5;
const dateTick = (curve) => (v) => {
  const d = new Date(v);
  if (spanDays(curve) <= 75) return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return d.getUTCMonth() === 0 ? `Jan '${String(d.getUTCFullYear()).slice(2)}` : MONTHS[d.getUTCMonth()];
};

// Equity: stepped accent line over a soft area; drawdown below in its own
// 60-px pane, peak to trough, in loss red.
export function EquityChart({ curve, height = 300 }) {
  const c = useThemeColors();
  const option = useMemo(() => {
    let peak = 0;
    const equity = [];
    const dd = [];
    curve.forEach((p, i) => {
      // Same-day trades share a timestamp; nudge each so the step stays ordered.
      const x = ts(p.date) + (i % 300) * 1000;
      peak = Math.max(peak, p.equity);
      equity.push([x, p.equity]);
      dd.push([x, Math.round((p.equity - peak) * 100) / 100]);
    });
    const ax = axisStyle(c);
    return {
      ...baseOption(c),
      grid: [
        { left: 64, right: 16, top: 12, height: height - 120 },
        { left: 64, right: 16, top: height - 92, height: 60 },
      ],
      xAxis: [
        { type: 'time', gridIndex: 0, ...ax, axisLabel: { show: false }, splitLine: { show: false } },
        {
          type: 'time', gridIndex: 1, ...ax, splitLine: { show: false }, minInterval: tickMs(curve),
          axisLabel: { ...ax.axisLabel, hideOverlap: true, formatter: dateTick(curve) },
        },
      ],
      yAxis: [
        { type: 'value', gridIndex: 0, ...ax, axisLabel: { ...ax.axisLabel, formatter: compact } },
        { type: 'value', gridIndex: 1, ...ax, splitNumber: 1, axisLabel: { show: false }, splitLine: { show: false } },
      ],
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      tooltip: {
        ...baseOption(c).tooltip,
        formatter: (ps) => {
          const e = ps.find((p) => p.seriesIndex === 0);
          const d = ps.find((p) => p.seriesIndex === 1);
          const date = new Date((e || d).value[0]).toISOString().slice(0, 10);
          return `${dateShort(date)}<br/>Equity <b>${pnl(e?.value[1])}</b>${d ? `<br/>Drawdown ${pnl(d.value[1])}` : ''}`;
        },
      },
      series: [
        {
          type: 'line', step: 'end', data: equity, showSymbol: false, xAxisIndex: 0, yAxisIndex: 0,
          lineStyle: { color: c.accent, width: 2 }, areaStyle: { color: c.accent, opacity: 0.08 },
          markLine: { silent: true, symbol: 'none', data: [{ yAxis: 0 }], lineStyle: { color: c.muted, type: 'dashed', width: 1 }, label: { show: false } },
        },
        {
          type: 'line', step: 'end', data: dd, showSymbol: false, xAxisIndex: 1, yAxisIndex: 1,
          lineStyle: { color: c.loss, width: 1 }, areaStyle: { color: c.loss, opacity: 0.16 },
        },
      ],
    };
  }, [curve, c, height]);
  return <EChart option={option} height={height} />;
}

// P&L bars by category (month, weekday, entry time): green up, red down,
// trade count in the tooltip and under each label.
export function PnlBars({ rows, label = (r) => r.key, height = 200 }) {
  const c = useThemeColors();
  const option = useMemo(() => {
    const ax = axisStyle(c);
    return {
      ...baseOption(c),
      grid: { left: 8, right: 8, top: 12, bottom: 44, containLabel: false },
      xAxis: {
        type: 'category', data: rows.map(label), ...ax, splitLine: { show: false },
        axisLabel: { ...ax.axisLabel, interval: 0, hideOverlap: true, formatter: (v, i) => `${v}\n{n|${pnl(rows[i].pnl)}}`, rich: { n: { fontSize: 10, color: c.ink3, padding: [3, 0, 0, 0] } } },
      },
      yAxis: { type: 'value', show: false },
      tooltip: {
        ...baseOption(c).tooltip,
        axisPointer: { type: 'shadow', shadowStyle: { color: c.surface2, opacity: 0.6 } },
        formatter: ([p]) => { const r = rows[p.dataIndex]; return `${label(r)}<br/>P&amp;L <b>${pnl(r.pnl)}</b><br/>${qty(r.trades)} trades · ${r.winRate}% win`; },
      },
      series: [{ type: 'bar', barMaxWidth: 36, data: rows.map((r) => ({ value: r.pnl, itemStyle: { color: signColor(c, r.pnl), borderRadius: 2 } })) }],
    };
  }, [rows, c, label]);
  return <EChart option={option} height={height} />;
}

// Tiny cumulative-P&L line for table rows. Plain SVG: a run can have 200+
// rows, and one canvas per row would be the slowest thing on the page.
export function Sparkline({ values, width = 96, height = 24 }) {
  if (!values || values.length < 2) return <svg width={width} height={height} />;
  const pts = [0, ...values];
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const d = pts.map((v, i) => `${((i / (pts.length - 1)) * (width - 2) + 1).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`).join(' ');
  const last = values.at(-1);
  return (
    <svg width={width} height={height} aria-hidden="true">
      <polyline points={d} fill="none" stroke={last >= 0 ? 'var(--profit)' : 'var(--loss)'} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

// Several runs' equity on one scale (compare, sweep). `lines` are
// { name, curve, color, width?, z? }; colours come from the caller so the
// compare screen can use categorical tokens and the sweep can grey the rest.
export function EquityOverlay({ lines, height = 300 }) {
  const c = useThemeColors();
  const option = useMemo(() => {
    const ax = axisStyle(c);
    return {
      ...baseOption(c),
      grid: { left: 64, right: 16, top: 12, bottom: 28 },
      xAxis: {
        type: 'time', ...ax, splitLine: { show: false }, minInterval: tickMs(lines[0]?.curve || []),
        axisLabel: { ...ax.axisLabel, hideOverlap: true, formatter: dateTick(lines[0]?.curve || []) },
      },
      yAxis: { type: 'value', ...ax, axisLabel: { ...ax.axisLabel, formatter: compact } },
      tooltip: {
        ...baseOption(c).tooltip,
        formatter: (ps) => `${dateShort(new Date(ps[0].value[0]).toISOString().slice(0, 10))}<br/>${ps.map((p) => `${p.marker}${p.seriesName} <b>${pnl(p.value[1])}</b>`).join('<br/>')}`,
      },
      series: lines.map((l, k) => ({
        name: l.name, type: 'line', step: 'end', showSymbol: false, z: l.z ?? 2,
        data: l.curve.map((p, i) => [ts(p.date) + (i % 300) * 1000, p.equity]),
        lineStyle: { color: l.color, width: l.width ?? 1.6 }, itemStyle: { color: l.color },
        ...(k === 0 ? { markLine: { silent: true, symbol: 'none', data: [{ yAxis: 0 }], lineStyle: { color: c.muted, type: 'dashed', width: 1 }, label: { show: false } } } : {}),
      })),
    };
  }, [lines, c]);
  return <EChart option={option} height={height} />;
}
