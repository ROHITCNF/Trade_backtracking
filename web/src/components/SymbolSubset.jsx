// "All 39 symbols ▾": pick some of a watchlist's symbols. value is null for
// the whole list, else the chosen symbols in list order.

import { useEffect, useRef, useState } from 'react';

const short = (s) => s.replace(/^NSE:|-EQ$/g, '');

export default function SymbolSubset({ symbols, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  const chosen = new Set(value ?? symbols);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const set = (next) => onChange(next.size === symbols.length ? null : symbols.filter((s) => next.has(s)));
  const toggle = (s) => {
    const next = new Set(chosen);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    set(next);
  };
  const needle = q.trim().toUpperCase();
  const shown = symbols.filter((s) => !needle || short(s).includes(needle));
  const label = value === null || value === undefined ? `All ${symbols.length} symbols` : `${value.length} of ${symbols.length} symbols`;

  return (
    <div className="subset" ref={ref}>
      <button type="button" className="input select-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        {label}
        <svg width="12" height="12" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
      </button>
      {open && (
        <div className="subset-menu card">
          <div className="row">
            <input className="input spacer" placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            <button type="button" className="link-btn accent" onClick={() => onChange(null)}>All</button>
            <button type="button" className="link-btn accent" onClick={() => onChange([])}>None</button>
          </div>
          <ul className="subset-list" role="listbox" aria-multiselectable="true">
            {shown.map((s) => (
              <li key={s}>
                <label>
                  <input type="checkbox" checked={chosen.has(s)} onChange={() => toggle(s)} />
                  {short(s)}
                </label>
              </li>
            ))}
          </ul>
          <span className="caption">{chosen.size} picked</span>
        </div>
      )}
    </div>
  );
}
