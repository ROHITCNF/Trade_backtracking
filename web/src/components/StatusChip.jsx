// The header status chip (v2/Journal — desktop.png): "● All good · Fyers on ·
// NSE closed · API 0 / 3,800 ▾". The dropdown carries the details the v1 pills
// showed (connect Fyers, market hours, the budget meter) plus theme and log out.

import { useEffect, useRef, useState } from 'react';
import { connectFyers, useMe } from '../lib/me.jsx';
import { marketStatus } from '../lib/ist.js';
import { qty } from '../lib/format.js';
import { budgetLevel, statusSummary } from '../lib/status.js';
import Icon from './Icon.jsx';

function useMarket() {
  const [status, setStatus] = useState(() => marketStatus());
  useEffect(() => {
    const timer = setInterval(() => setStatus(marketStatus()), 30000);
    return () => clearInterval(timer);
  }, []);
  return status;
}

function Details({ me, market, theme, onTheme, onLogout }) {
  const [busy, setBusy] = useState(false);
  const fyers = me?.fyers;
  const budget = me?.budget;
  return (
    <div className="status-menu card" role="menu">
      <div className="status-row">
        <span className="label">Fyers</span>
        {fyers?.connected ? (
          <span><span className="dot dot-profit" /> Connected{fyers.clientName && <> · <b>{fyers.clientName}</b></>}</span>
        ) : (
          <span className="row">
            <span className="caption">Not connected today</span>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => { setBusy(true); connectFyers().catch(() => setBusy(false)); }}>
              Connect Fyers
            </button>
          </span>
        )}
      </div>
      <div className="status-row">
        <span className="label">NSE</span>
        <span><span className={`dot ${market.open ? 'dot-accent' : ''}`} /> {market.open ? 'Open' : 'Closed'} <span className="caption">· {market.label}</span></span>
      </div>
      {budget && (
        <div className="status-row status-budget">
          <span className="label">API calls today</span>
          <span className={budgetLevel(budget) === 'red' ? 'loss' : ''}><b>{qty(budget.used)}</b> / {qty(budget.cap)}</span>
          <span className="meter meter-wide">
            <span className={`meter-fill meter-${budgetLevel(budget)}`} style={{ width: `${Math.min(100, (budget.used / budget.cap) * 100)}%` }} />
          </span>
          <span className="caption">{budget.paused ? 'Paused after a 429 until 00:00 IST' : 'Resets at 00:00 IST'}</span>
        </div>
      )}
      <hr className="divider" />
      <button className="status-action" role="menuitem" onClick={onTheme}>
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} /> {theme === 'dark' ? 'Light theme' : 'Dark theme'}
      </button>
      <button className="status-action" role="menuitem" onClick={onLogout}>
        <Icon name="logout" /> Log out
      </button>
    </div>
  );
}

export default function StatusChip({ theme, onTheme, onLogout }) {
  const { me } = useMe();
  const market = useMarket();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const s = statusSummary(me, market);

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

  return (
    <div className="status-chip-wrap" ref={ref}>
      <button className={`status-chip status-${s.level}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="dot" />
        <b>{s.title}</b>
        <span className="status-parts hide-xs">{s.parts.map((p) => <span key={p}> · {p}</span>)}</span>
        <svg className={`chip-chevron${open ? ' open' : ''}`} width="12" height="12" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
      {open && <Details me={me} market={market} theme={theme} onTheme={onTheme} onLogout={onLogout} />}
    </div>
  );
}
