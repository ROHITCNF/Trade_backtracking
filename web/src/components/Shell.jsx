// App frame: the header (nav, status pills, logout) over the current screen.
// The pills themselves arrive with the header work (#30).

import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { clearSession } from '../lib/session.js';
import { applyTheme, readTheme } from '../lib/theme.js';

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
    <>
      <header className="header">
        <div className="header-inner">
          <NavLink to="/" className="brand">
            <span className="brand-mark" aria-hidden="true" />
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
          <div className="header-status" />
          <button className="btn btn-ghost" onClick={toggleTheme} aria-label="Toggle dark theme">
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
          <button className="btn btn-ghost" onClick={logout}>
            Log out
          </button>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </>
  );
}
