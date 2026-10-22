// Search the Fyers symbol master by ticker or company (FR-11) and pick one.
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

export default function SymbolSearch({ onPick, exclude = [], placeholder = 'Search ticker or company' }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (!query) return setResults([]);
    const n = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const { results } = await api(`/api/symbols?q=${encodeURIComponent(query)}`);
        if (n === seq.current) {
          setResults(results);
          setActive(0);
          setError(null);
        }
      } catch (err) {
        if (n === seq.current) setError(err.message);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  const shown = results.filter((r) => !exclude.includes(r.symbol));
  const pick = (r) => {
    onPick(r);
    setQ('');
    setResults([]);
  };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, shown.length - 1));
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
    else if (e.key === 'Enter' && shown[active]) {
      e.preventDefault();
      pick(shown[active]);
    } else return;
    e.preventDefault();
  };

  return (
    <div className="search">
      <input className="input search-input" value={q} placeholder={placeholder} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
      {error && <div className="caption loss">{error}</div>}
      {shown.length > 0 && (
        <ul className="search-results" role="listbox">
          {shown.map((r, i) => (
            <li key={r.symbol} role="option" aria-selected={i === active} className={i === active ? 'active' : ''}
              onMouseDown={(e) => { e.preventDefault(); pick(r); }} onMouseEnter={() => setActive(i)}>
              <b>{r.ticker}</b> <span className="caption">{r.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
