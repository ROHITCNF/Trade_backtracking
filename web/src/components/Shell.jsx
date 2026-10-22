// App frame: the header (nav, status pills, logout) and any blocking-condition
// banners over the current screen.

import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { clearSession } from '../lib/session.js';
import { applyTheme, readTheme } from '../lib/theme.js';
import { MeProvider } from '../lib/me.jsx';
import BrandMark from './BrandMark.jsx';
import HeaderStatus from './HeaderStatus.jsx';
import Banners from './Banners.jsx';
import Toast from './Toast.jsx';

const NAV = [
  ['/', 'Dashboard', true],
  ['/new', 'New backtest'],
  ['/runs', 'Runs'],
  ['/compare', 'Compare'],
  ['/watchlists', 'Watchlists'],
];

export default function Shell() {
  const navigate = useNavigate();
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
          <button className="btn btn-ghost hide-sm" onClick={toggleTheme} aria-label="Toggle dark theme">
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
          <button className="btn" onClick={logout}>
            Log out
          </button>
        </div>
      </header>
      <main className="page">
        <Banners />
        <Outlet />
      </main>
      <Toast />
    </MeProvider>
  );
}
