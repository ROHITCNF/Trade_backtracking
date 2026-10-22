// One ECharts instance bound to a div: built once, updated when the option
// changes, resized with its box, disposed on unmount.
import { useEffect, useRef } from 'react';
import echarts from '../lib/echarts.js';

export default function EChart({ option, height = 220, onClick }) {
  const ref = useRef(null);
  const chart = useRef(null);

  useEffect(() => {
    chart.current = echarts.init(ref.current, null, { renderer: 'canvas' });
    const ro = new ResizeObserver(() => chart.current?.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, true);
  }, [option]);

  useEffect(() => {
    if (!onClick || !chart.current) return;
    chart.current.on('click', onClick);
    return () => chart.current?.off('click', onClick);
  }, [onClick]);

  return <div ref={ref} style={{ width: '100%', height }} />;
}
