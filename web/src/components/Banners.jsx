// Conditions that block work, shown under the header on every screen until
// they clear (States.png § Daily API budget exhausted & account paused).

import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { connectFyers, useMe } from '../lib/me.jsx';
import { hoursMinutes, msUntilIstMidnight } from '../lib/ist.js';
import { qty } from '../lib/format.js';
import Icon from './Icon.jsx';

function useNow(ms) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export default function Banners() {
  const { me } = useMe();
  const now = useNow(60000);
  if (!me) return null;
  const { budget, fyers } = me;
  const out = [];

  if (budget.paused) {
    out.push(
      <div key="429" className="banner banner-error banner-row" role="alert">
        <Icon name="alert" />
        <div>
          <b>Fyers returned 429 — data calls paused until tomorrow.</b>{' '}
          <span className="loss">
            No candle requests will be sent until 00:00 IST so the limit can reset. Running backtests stopped and kept their finished symbols.
          </span>
        </div>
        <span className="spacer" />
        <b className="loss nowrap">Resumes in {hoursMinutes(msUntilIstMidnight(now))}</b>
      </div>
    );
  } else if (budget.used >= budget.cap) {
    out.push(
      <div key="budget" className="banner banner-row" role="status">
        <Icon name="warn" />
        <div>
          <b>Daily data budget used — {qty(budget.used)} / {qty(budget.cap)} calls.</b>{' '}
          <span className="warn">New runs and trade charts are paused until the budget resets at midnight IST. Saved results, filters and exports still work.</span>
        </div>
        <span className="spacer" />
        <Link className="btn" to="/runs">View saved runs</Link>
      </div>
    );
  }

  if (!fyers.connected) {
    out.push(
      <div key="fyers" className="banner banner-info banner-row" role="status">
        <Icon name="info" />
        <div>
          <b>Fyers isn’t connected today.</b> Connect to start runs or load trade charts — everything already computed is available offline.
        </div>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={() => connectFyers()}>Connect Fyers</button>
      </div>
    );
  }

  return out.length ? <div className="banners">{out}</div> : null;
}
