// Routes for every screen in docs/design/reference/. Everything but /login sits
// behind a session; an expired one (any 401) lands back on /login.

import { lazy, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { setUnauthorizedHandler } from './lib/api.js';
import { readSession } from './lib/session.js';
import Shell from './components/Shell.jsx';
import Login from './pages/Login.jsx';

// Screens load on demand: charts (ECharts, Lightweight Charts) stay out of the
// first download, so login and the shell appear fast.
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const NewBacktest = lazy(() => import('./pages/NewBacktest.jsx'));
const RunProgress = lazy(() => import('./pages/RunProgress.jsx'));
const Runs = lazy(() => import('./pages/Runs.jsx'));
const TickerDetail = lazy(() => import('./pages/TickerDetail.jsx'));
const Compare = lazy(() => import('./pages/Compare.jsx'));
const Watchlists = lazy(() => import('./pages/Watchlists.jsx'));
const Live = lazy(() => import('./pages/Live.jsx'));
const NotFound = lazy(() => import('./pages/NotFound.jsx'));

function RequireSession({ children }) {
  const location = useLocation();
  if (!readSession()) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}

export default function App() {
  const navigate = useNavigate();
  useEffect(() => setUnauthorizedHandler(() => navigate('/login', { replace: true })), [navigate]);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireSession>
            <Shell />
          </RequireSession>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="runs" element={<Runs />} />
        <Route path="runs/:id" element={<Dashboard />} />
        <Route path="runs/:id/progress" element={<RunProgress />} />
        <Route path="runs/:id/symbols/:symbol" element={<TickerDetail />} />
        <Route path="new" element={<NewBacktest />} />
        <Route path="compare" element={<Compare />} />
        <Route path="watchlists" element={<Watchlists />} />
        <Route path="watchlists/:id" element={<Watchlists />} />
        <Route path="live" element={<Live />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
