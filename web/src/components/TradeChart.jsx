// One trade's day on 1-minute candles (FR-28; hld § Trade chart): the opening
// range as a shaded band, dashed price lines for entry, stop and target, and
// entry/exit markers. Lightweight Charts v5, whose time axis is UTC, so every
// timestamp is shifted +19800 s to read as IST (as src/template.html does).

import { useEffect, useRef } from 'react';
import { CandlestickSeries, LineStyle, createChart, createSeriesMarkers } from 'lightweight-charts';
import { useThemeColors } from '../lib/chartTheme.js';
import { price } from '../lib/format.js';

const IST = 19800;

// Fills the opening range: a rectangle from the first candle to the last
// candle before orbEnd, between the range's low and high. With `full`, the
// band spans the whole chart width, so the range stays visible when zoomed.
class RangeBand {
  constructor(from, to, low, high, color, full = false) {
    Object.assign(this, { from, to, low, high, color, full });
  }
  attached({ chart, series, requestUpdate }) {
    Object.assign(this, { chart, series, requestUpdate });
    requestUpdate();
  }
  paneViews() {
    return [
      {
        zOrder: () => 'bottom',
        renderer: () => ({
          draw: (target) =>
            target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
              const ts = this.chart.timeScale();
              const x1 = this.full ? 0 : ts.timeToCoordinate(this.from);
              const x2 = this.full ? ts.width() : ts.timeToCoordinate(this.to);
              const y1 = this.series.priceToCoordinate(this.high);
              const y2 = this.series.priceToCoordinate(this.low);
              if (this.low == null || [x1, x2, y1, y2].some((v) => v === null)) return;
              context.fillStyle = this.color;
              context.fillRect(Math.round(x1 * hr), Math.round(y1 * vr), Math.round((x2 - x1) * hr), Math.round((y2 - y1) * vr));
            }),
        }),
      },
    ];
  }
}

// Shapes the built-in markers can't draw: a ring (entry), a dashed ring (the
// backtest's entry when it differs), a square (exit) and diamonds (best and
// worst move). Each mark is { time (epoch s, IST-shifted), price, shape, color }.
class Marks {
  constructor(marks, fill) {
    Object.assign(this, { marks, fill });
  }
  attached({ chart, series, requestUpdate }) {
    Object.assign(this, { chart, series, requestUpdate });
    requestUpdate();
  }
  paneViews() {
    return [
      {
        zOrder: () => 'top',
        renderer: () => ({
          draw: (target) =>
            target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
              const ts = this.chart.timeScale();
              for (const m of this.marks) {
                const x = ts.timeToCoordinate(m.time);
                const y = this.series.priceToCoordinate(m.price);
                if (x === null || y === null) continue;
                const cx = x * hr;
                const cy = y * vr;
                const r = 6 * hr;
                ctx.save();
                ctx.lineWidth = 2 * hr;
                ctx.strokeStyle = m.color;
                ctx.fillStyle = m.color;
                ctx.beginPath();
                if (m.shape === 'ring' || m.shape === 'dashed-ring') {
                  if (m.shape === 'dashed-ring') ctx.setLineDash([3 * hr, 3 * hr]);
                  ctx.arc(cx, cy, r, 0, Math.PI * 2);
                  ctx.fillStyle = this.fill;
                  ctx.fill();
                  ctx.stroke();
                } else if (m.shape === 'square') {
                  ctx.rect(cx - r * 0.8, cy - r * 0.8, r * 1.6, r * 1.6);
                  ctx.fill();
                } else {
                  ctx.moveTo(cx, cy - r);
                  ctx.lineTo(cx + r, cy);
                  ctx.lineTo(cx, cy + r);
                  ctx.lineTo(cx - r, cy);
                  ctx.closePath();
                  ctx.fill();
                }
                ctx.restore();
              }
            }),
        }),
      },
    ];
  }
}

const bar = ([t, o, h, l, cl]) => ({ time: t + IST, open: o, high: h, low: l, close: cl });

// `marks` replaces the default entry/exit markers (Live page); `visible`
// zooms to { from, to } epoch seconds; `bandFull` stretches the range band
// across the chart; `lineTitles` labels the price lines. `replay` (a frame
// from lib/replay.js) shows only the candles played so far: the chart is
// built once per replay and each step adds a candle, so playing doesn't
// rebuild it or lose the user's zoom.
export default function TradeChart({ candles, trade, orbEnd, height = 360, marks = null, visible = null, bandFull = false, lineTitles = true, replay = null }) {
  const ref = useRef(null);
  const c = useThemeColors();
  const built = useRef(null);
  const frame = useRef(replay);
  frame.current = replay;
  const replaying = Boolean(replay);

  useEffect(() => {
    const chart = createChart(ref.current, {
      // autoSize follows the container, so a new `height` resizes the chart
      // without rebuilding it (and without losing the user's zoom).
      autoSize: true,
      layout: { background: { color: c.surface }, textColor: c.ink3, fontFamily: 'Inter, system-ui, sans-serif', fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: c.line }, horzLines: { color: c.line } },
      rightPriceScale: { borderColor: c.line },
      // Replay places the view itself (applyReplay).
      timeScale: { borderColor: c.line, timeVisible: true, secondsVisible: false, shiftVisibleRangeOnNewBar: !replaying },
      crosshair: { vertLine: { color: c.muted, labelBackgroundColor: c.ink }, horzLine: { color: c.muted, labelBackgroundColor: c.ink } },
      localization: { priceFormatter: (p) => price(p) },
    });
    // Price lines don't widen the scale on their own; keep these in view.
    // In replay it's only what has happened so far.
    const state = { chart, levels: [trade.entry, trade.sl, trade.target, trade.orbHigh, trade.orbLow], lines: [], shown: -1 };
    const series = chart.addSeries(CandlestickSeries, {
      upColor: c.profit, downColor: c.loss, wickUpColor: c.profit, wickDownColor: c.loss, borderVisible: false,
      // With custom marks (Live), the last price would read as a fourth level.
      lastValueVisible: !marks, priceLineVisible: !marks,
      autoscaleInfoProvider: (original) => {
        const res = original();
        const levels = state.levels.filter((v) => v != null);
        if (!res || !levels.length) return res;
        return {
          ...res,
          priceRange: {
            minValue: Math.min(res.priceRange.minValue, ...levels),
            maxValue: Math.max(res.priceRange.maxValue, ...levels),
          },
        };
      },
    });
    state.series = series;

    const line = (p, color, title) => p != null && series.createPriceLine({ price: p, color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: lineTitles ? title : '' });
    state.drawLines = () => [line(trade.entry, c.accent, 'Entry'), line(trade.sl, c.loss, 'SL'), line(trade.target, c.profit, 'Target')].filter(Boolean);
    const markColor = { accent: c.accent, ink: c.ink, profit: c.profit, loss: c.loss, muted: c.muted };
    const toMark = (m) => ({ ...m, time: m.time + IST, color: markColor[m.color] || m.color });

    if (replaying) {
      state.band = new RangeBand(0, 0, null, null, `${c.accent}1F`, bandFull);
      series.attachPrimitive(state.band);
      state.marks = new Marks([], c.surface);
      state.toMark = toMark;
      series.attachPrimitive(state.marks);
      built.current = state;
      applyReplay(state, candles, frame.current);
      return () => {
        built.current = null;
        chart.remove();
      };
    }

    const data = candles.map(bar);
    series.setData(data);
    state.drawLines();

    // Band: candles from the first one up to (not including) the ORB end.
    const [h, m] = orbEnd.split(':').map(Number);
    const orbEndMinute = h * 60 + m;
    const inRange = data.filter((d) => {
      const dt = new Date(d.time * 1000);
      return dt.getUTCHours() * 60 + dt.getUTCMinutes() < orbEndMinute;
    });
    if (inRange.length && trade.orbHigh != null) series.attachPrimitive(new RangeBand(inRange[0].time, inRange.at(-1).time, trade.orbLow, trade.orbHigh, `${c.accent}1F`, bandFull));

    if (marks) {
      series.attachPrimitive(new Marks(marks.map(toMark), c.surface));
    } else {
      // A live paper trade still open has no exit yet.
      createSeriesMarkers(series, [
        { time: trade.entryTs + IST, position: 'atPriceMiddle', shape: 'circle', color: c.accent, price: trade.entry, text: '' },
        trade.exitTs != null && { time: trade.exitTs + IST, position: 'atPriceMiddle', shape: 'square', color: c.ink, price: trade.exit, text: '' },
      ].filter(Boolean));
    }
    if (visible) chart.timeScale().setVisibleRange({ from: visible.from + IST, to: visible.to + IST });
    else chart.timeScale().fitContent();
    return () => chart.remove();
  }, [candles, trade, orbEnd, c, marks, visible, bandFull, lineTitles, replaying]);

  useEffect(() => {
    if (built.current && replay) applyReplay(built.current, candles, replay);
  }, [candles, replay]);

  return <div ref={ref} style={{ width: '100%', height }} />;
}

// One replay step: the candles up to the cursor, the range band so far, the
// trade's lines from the entry candle on, and the marks reached.
function applyReplay(state, candles, f) {
  const { chart, series } = state;
  const n = f.cursor;
  if (n === state.shown + 1 && state.shown >= 0) {
    // Next candle: append. The view fills from the left, then slides one
    // candle at a time to keep the newest in sight, unless the user has
    // scrolled away from it.
    series.update(bar(candles[n]));
    const ts = chart.timeScale();
    const lr = ts.getVisibleLogicalRange();
    if (lr && n > lr.to - 8 && n <= lr.to + 1) ts.setVisibleLogicalRange({ from: lr.from + 1, to: lr.to + 1 });
  } else if (n !== state.shown) {
    series.setData(candles.slice(0, n + 1).map(bar));
    // About an hour of candles, filling from the left until there are more.
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(n - 60, -1), to: Math.max(n, 60) + 8 });
  }
  state.shown = n;

  state.levels = f.levels ? [f.levels.entry, f.levels.sl, f.levels.target, f.orb?.high, f.orb?.low] : [f.orb?.high, f.orb?.low];
  if (f.levels && !state.lines.length) state.lines = state.drawLines();
  if (!f.levels && state.lines.length) {
    for (const l of state.lines) series.removePriceLine(l);
    state.lines = [];
  }

  Object.assign(state.band, f.orb ? { from: f.orb.from + IST, to: f.orb.to + IST, low: f.orb.low, high: f.orb.high } : { low: null, high: null });
  state.band.requestUpdate?.();
  state.marks.marks = f.marks.map(state.toMark);
  state.marks.requestUpdate?.();
}
