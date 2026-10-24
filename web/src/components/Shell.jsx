// App frame: the header (nav, status pills, logout) and any blocking-condition
// banners over the current screen.

import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Suspense, useState } from 'react';
import { clearSession } from '../lib/session.js';
import { applyTheme, readTheme } from '../lib/theme.js';
import { MeProvider } from '../lib/me.jsx';
import BrandMark from './BrandMark.jsx';
import HeaderStatus from './HeaderStatus.jsx';
import Banners from './Banners.jsx';
import Toast from './Toast.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import Icon from './Icon.jsx';

const NAV = [
  ['/', 'Dashboard', true],
  ['/new', 'New backtest'],
  ['/runs', 'Runs'],
  ['/compare', 'Compare'],
  ['/watchlists', 'Watchlists'],
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
          <NavLink to="/" className="brand">
            <BrandMark />
            ORB Lab
          </NavLink>
          <nav className="nav">
            {NAV.map(([to, label, end]) => (
              <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="spacer" />
          <HeaderStatus />
          <button className="btn btn-ghost icon-btn" onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          <button className="btn" onClick={logout} aria-label="Log out">
            <span className="hide-xs">Log out</span>
            <span className="show-xs"><Icon name="logout" /></span>
          </button>
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
