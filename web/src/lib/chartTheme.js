// Chart colours come from the same CSS tokens as the rest of the UI, read at
// draw time, so dark mode needs no second palette.
import { useEffect, useState } from 'react';

const TOKENS = ['ink', 'ink-2', 'ink-3', 'muted', 'line', 'surface', 'surface-2', 'accent', 'profit', 'loss', 'warn', 'cat-1', 'cat-2', 'cat-3', 'cat-4'];

export function readColors() {
  const css = getComputedStyle(document.documentElement);
  const c = {};
  for (const t of TOKENS) c[t.replace(/-(\w)/g, (_, x) => x.toUpperCase())] = css.getPropertyValue(`--${t}`).trim();
  return c;
}

// Re-renders when the theme attribute flips, so charts redraw in the new colours.
export function useThemeColors() {
  const [colors, setColors] = useState(readColors);
  useEffect(() => {
    const obs = new MutationObserver(() => setColors(readColors()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return colors;
}

// Shared axis/tooltip styling per the design system: hairline grid, 11px labels.
export function baseOption(c) {
  return {
    animation: false,
    textStyle: { fontFamily: 'Inter, system-ui, sans-serif', fontSize: 11, color: c.ink3 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: c.surface,
      borderColor: c.line,
      textStyle: { color: c.ink, fontSize: 12 },
      axisPointer: { type: 'line', lineStyle: { color: c.muted } },
    },
  };
}

export const axisStyle = (c) => ({
  axisLine: { lineStyle: { color: c.line } },
  axisTick: { show: false },
  axisLabel: { color: c.ink3, fontSize: 11 },
  splitLine: { lineStyle: { color: c.line, opacity: 0.6 } },
});

// Bars: profit green / loss red at 85% opacity (design system § Chart styles).
export const signColor = (c, v) => (v >= 0 ? c.profit : c.loss) + 'D9';
