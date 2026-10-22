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
// candle before orbEnd, between the range's low and high.
class RangeBand {
  constructor(from, to, low, high, color) {
    Object.assign(this, { from, to, low, high, color });
  }
  attached({ chart, series, requestUpdate }) {
    Object.assign(this, { chart, series });
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
              const x1 = ts.timeToCoordinate(this.from);
              const x2 = ts.timeToCoordinate(this.to);
              const y1 = this.series.priceToCoordinate(this.high);
              const y2 = this.series.priceToCoordinate(this.low);
              if ([x1, x2, y1, y2].some((v) => v === null)) return;
              context.fillStyle = this.color;
              context.fillRect(Math.round(x1 * hr), Math.round(y1 * vr), Math.round((x2 - x1) * hr), Math.round((y2 - y1) * vr));
            }),
        }),
      },
    ];
  }
}

export default function TradeChart({ candles, trade, orbEnd, height = 360 }) {
  const ref = useRef(null);
  const c = useThemeColors();

  useEffect(() => {
    const chart = createChart(ref.current, {
      height,
      autoSize: true,
      layout: { background: { color: c.surface }, textColor: c.ink3, fontFamily: 'Inter, system-ui, sans-serif', fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: c.line }, horzLines: { color: c.line } },
      rightPriceScale: { borderColor: c.line },
      timeScale: { borderColor: c.line, timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: c.muted, labelBackgroundColor: c.ink }, horzLine: { color: c.muted, labelBackgroundColor: c.ink } },
      localization: { priceFormatter: (p) => price(p) },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: c.profit, downColor: c.loss, wickUpColor: c.profit, wickDownColor: c.loss, borderVisible: false,
      // Price lines don't widen the scale on their own; keep stop and target in view.
      autoscaleInfoProvider: (original) => {
        const res = original();
        if (!res) return res;
        const levels = [trade.entry, trade.sl, trade.target, trade.orbHigh, trade.orbLow].filter((v) => v !== null);
        return {
          ...res,
          priceRange: {
            minValue: Math.min(res.priceRange.minValue, ...levels),
            maxValue: Math.max(res.priceRange.maxValue, ...levels),
          },
        };
      },
    });
    const data = candles.map(([t, o, h, l, cl]) => ({ time: t + IST, open: o, high: h, low: l, close: cl }));
    series.setData(data);

    const line = (p, color, title) => p !== null && series.createPriceLine({ price: p, color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title });
    line(trade.entry, c.accent, 'Entry');
    line(trade.sl, c.loss, 'SL');
    line(trade.target, c.profit, 'Target');

    // Band: candles from the first one up to (not including) the ORB end.
    const [h, m] = orbEnd.split(':').map(Number);
    const orbEndMinute = h * 60 + m;
    const inRange = data.filter((d) => {
      const dt = new Date(d.time * 1000);
      return dt.getUTCHours() * 60 + dt.getUTCMinutes() < orbEndMinute;
    });
    if (inRange.length) series.attachPrimitive(new RangeBand(inRange[0].time, inRange.at(-1).time, trade.orbLow, trade.orbHigh, `${c.accent}1F`));

    createSeriesMarkers(series, [
      { time: trade.entryTs + IST, position: 'atPriceMiddle', shape: 'circle', color: c.accent, price: trade.entry, text: '' },
      { time: trade.exitTs + IST, position: 'atPriceMiddle', shape: 'square', color: c.ink, price: trade.exit, text: '' },
    ]);
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [candles, trade, orbEnd, height, c]);

  return <div ref={ref} style={{ width: '100%', height }} />;
}
