// Bar replay controls for the Live trade panel (issue #118): play the day's
// 1-minute candles from 09:15, one whole candle per step. Space plays or
// pauses, ← → step a candle.

import { useEffect, useState } from 'react';
import { pnl, price, rMultiple, tone } from '../lib/format.js';
import Icon from './Icon.jsx';
import Segmented from './Segmented.jsx';

const SPEEDS = [[1, '1×'], [2, '2×'], [5, '5×'], [10, '10×']];

// Replay state for `count` candles: off until start(); playing advances the
// cursor `speed` candles a second and stops at the last one.
export function useReplay(count) {
  const [on, setOn] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const last = count - 1;

  useEffect(() => {
    if (!on || !playing) return undefined;
    const id = setInterval(() => setCursor((c) => Math.min(c + 1, last)), 1000 / speed);
    return () => clearInterval(id);
  }, [on, playing, speed, last]);

  useEffect(() => {
    if (playing && cursor >= last) setPlaying(false);
  }, [playing, cursor, last]);

  const seek = (i) => setCursor(Math.max(0, Math.min(i, last)));
  const replay = {
    on, cursor, playing, speed, setSpeed, seek,
    start: () => { setCursor(0); setPlaying(true); setOn(true); },
    stop: () => { setPlaying(false); setOn(false); },
    toggle: () => {
      if (playing) return setPlaying(false);
      if (cursor >= last) setCursor(0);
      setPlaying(true);
    },
    step: (d) => { setPlaying(false); seek(cursor + d); },
  };

  // Space and the arrows drive replay. preventDefault on both key events, so
  // a focused button isn't also clicked by Space.
  useEffect(() => {
    if (!on) return undefined;
    const typing = (e) => /^(TEXTAREA|SELECT)$/.test(e.target.tagName) || (e.target.tagName === 'INPUT' && e.target.type !== 'range');
    const onKey = (e) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (e.type === 'keydown' && !e.repeat) replay.toggle();
      } else if (e.type === 'keydown' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        replay.step(e.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('keyup', onKey);
    };
  });

  return replay;
}

function Readout({ frame }) {
  const state = {
    range: 'Opening range forming',
    waiting: 'Waiting for a breakout',
  }[frame.phase];
  return (
    <span className="replay-readout">
      <b>{frame.clock}</b>
      <span className="caption-md">{price(frame.close)}</span>
      {state ? (
        <span className="caption-md">{state}</span>
      ) : (
        <span className={tone(frame.pnl)}>
          {frame.phase === 'open' ? 'Open' : 'Closed'} {pnl(frame.pnl)}{frame.r != null && ` (${rMultiple(frame.r)})`}
        </span>
      )}
    </span>
  );
}

export function ReplayBar({ replay, frame }) {
  return (
    <div className="replay-bar">
      <div className="row replay-buttons">
        <button className="btn icon-btn" aria-label="Back to 09:15" title="Back to the open" onClick={() => { replay.seek(0); }}><Icon name="restart" /></button>
        <button className="btn icon-btn" aria-label="Back one candle" title="Back one candle (←)" disabled={frame.cursor <= 0} onClick={() => replay.step(-1)}><Icon name="stepBack" /></button>
        <button className="btn icon-btn btn-primary" aria-label={replay.playing ? 'Pause' : 'Play'} title={`${replay.playing ? 'Pause' : 'Play'} (Space)`} onClick={replay.toggle}>
          <Icon name={replay.playing ? 'pause' : 'play'} />
        </button>
        <button className="btn icon-btn" aria-label="Forward one candle" title="Forward one candle (→)" disabled={frame.cursor >= frame.last} onClick={() => replay.step(1)}><Icon name="stepFwd" /></button>
      </div>
      <input className="replay-slider" type="range" aria-label="Replay position" min={0} max={frame.last} value={frame.cursor}
        onChange={(e) => replay.seek(Number(e.target.value))} />
      <Readout frame={frame} />
      <Segmented label="Candles per second" value={replay.speed} options={SPEEDS} onChange={replay.setSpeed} />
      <button className="btn" onClick={replay.stop}>Exit replay</button>
    </div>
  );
}
