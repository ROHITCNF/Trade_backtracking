// App frame (v2): brand, Journal · Research · Live, and the status chip; any
// blocking-condition banners sit over the current screen.

import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Suspense, useState } from 'react';
import { clearSession } from '../lib/session.js';
import { applyTheme, readTheme } from '../lib/theme.js';
import { MeProvider } from '../lib/me.jsx';
import BrandMark from './BrandMark.jsx';
import StatusChip from './StatusChip.jsx';
import Banners from './Banners.jsx';
import Toast from './Toast.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';

// Each tab also owns the screens reached from it, so it stays lit there.
const NAV = [
  ['/', 'Journal', (p) => p === '/'],
  ['/research', 'Research', (p) => /^\/(research|runs)(\/|$)/.test(p)],
  ['/live', 'Live', (p) => p.startsWith('/live')],
];

export default function Shell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [theme, setTheme] = useState(readTheme);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  };
  const logout = () => {
    clearSession();
    navigate('/login', { replace: true });
  };

  return (
    <MeProvider>
      <header className="header">
        <div className="header-inner">
          <Link to="/" className="brand">
            <BrandMark size={24} />
            ORB Lab
          </Link>
          <nav className="nav">
            {NAV.map(([to, label, isOn]) => (
              <Link key={to} to={to} className={`nav-link${isOn(location.pathname) ? ' active' : ''}`}
                aria-current={isOn(location.pathname) ? 'page' : undefined}>
                {label}
              </Link>
            ))}
          </nav>
          <div className="spacer" />
          <StatusChip theme={theme} onTheme={toggleTheme} onLogout={logout} />
        </div>
      </header>
      <main className="page">
        <Banners />
        <ErrorBoundary resetKey={location.pathname}>
          <Suspense fallback={<p className="placeholder">Loading…</p>}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
      <Toast />
    </MeProvider>
  );
}
