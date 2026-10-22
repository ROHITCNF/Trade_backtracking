// Routes for every screen in docs/design/reference/. Everything but /login sits
// behind a session; an expired one (any 401) lands back on /login.

import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { setUnauthorizedHandler } from './lib/api.js';
import { readSession } from './lib/session.js';
import Shell from './components/Shell.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import NewBacktest from './pages/NewBacktest.jsx';
import RunProgress from './pages/RunProgress.jsx';
import Runs from './pages/Runs.jsx';
import TickerDetail from './pages/TickerDetail.jsx';
import Compare from './pages/Compare.jsx';
import Watchlists from './pages/Watchlists.jsx';
import NotFound from './pages/NotFound.jsx';

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
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
