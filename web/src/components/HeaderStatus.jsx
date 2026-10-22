// Header pills: Fyers connection, NSE open/closed from the clock, and today's
// data-call budget. Routine states (disconnected every morning) stay grey;
// only things that cost data turn amber or red (States.png).

import { useEffect, useState } from 'react';
import { connectFyers, useMe } from '../lib/me.jsx';
import { marketStatus } from '../lib/ist.js';
import { qty } from '../lib/format.js';

function FyersPill({ fyers }) {
  const [busy, setBusy] = useState(false);
  if (!fyers) return null;
  if (fyers.connected) {
    return (
      <span className="pill pill-ok">
        <span className="dot dot-profit" />
        Fyers · Connected{fyers.clientName && <> · <b>{fyers.clientName}</b></>}
      </span>
    );
  }
  return (
    <span className="pill pill-split">
      <span className="dot dot-hollow" />
      <span className="hide-sm">Fyers · Not connected today</span>
      <button className="pill-action" disabled={busy} onClick={() => { setBusy(true); connectFyers().catch(() => setBusy(false)); }}>
        Connect Fyers
      </button>
    </span>
  );
}

function MarketPill() {
  const [status, setStatus] = useState(() => marketStatus());
  useEffect(() => {
    const timer = setInterval(() => setStatus(marketStatus()), 30000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className="pill">
      <span className={`dot ${status.open ? 'dot-accent' : ''}`} />
      NSE {status.open ? 'Open' : 'Closed'}
      <span className="caption hide-sm">· {status.label}</span>
    </span>
  );
}

export function budgetLevel({ used, cap, paused }) {
  if (paused || used >= cap) return 'red';
  return used / cap >= 0.8 ? 'amber' : 'grey';
}

function ApiMeter({ budget }) {
  if (!budget) return null;
  const level = budgetLevel(budget);
  const pct = Math.min(100, (budget.used / budget.cap) * 100);
  return (
    <span className="pill" title={budget.paused ? 'Paused after a 429 until 00:00 IST' : 'Fyers data calls used today; resets 00:00 IST'}>
      <span className="caption">API</span>
      <span className="meter">
        <span className={`meter-fill meter-${level}`} style={{ width: `${pct}%` }} />
      </span>
      <span className={level === 'red' ? 'loss' : ''}>
        {qty(budget.used)} / {qty(budget.cap)}
      </span>
      <span className="caption hide-sm">calls today</span>
    </span>
  );
}

export default function HeaderStatus() {
  const { me } = useMe();
  return (
    <div className="header-status">
      <FyersPill fyers={me?.fyers} />
      <MarketPill />
      <ApiMeter budget={me?.budget} />
    </div>
  );
}
