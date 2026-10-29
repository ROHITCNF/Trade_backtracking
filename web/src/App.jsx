// Routes for the v2 screens (docs/design/reference/v2/): Journal, Research,
// Live, and the ticker page. Everything but /login sits behind a session; an
// expired one (any 401) lands back on /login. The v1 addresses redirect to
// where their content now lives (decisions D14).

import { lazy, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { setUnauthorizedHandler } from './lib/api.js';
import { readSession } from './lib/session.js';
import Shell from './components/Shell.jsx';
import Login from './pages/Login.jsx';

// Screens load on demand: charts (ECharts, Lightweight Charts) stay out of the
// first download, so login and the shell appear fast.
const Journal = lazy(() => import('./pages/Journal.jsx'));
const Research = lazy(() => import('./pages/Research.jsx'));
const TickerDetail = lazy(() => import('./pages/TickerDetail.jsx'));
const Live = lazy(() => import('./pages/Live.jsx'));
const NotFound = lazy(() => import('./pages/NotFound.jsx'));

function RequireSession({ children }) {
  const location = useLocation();
  if (!readSession()) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}

// /runs/:id and /runs/:id/progress → that run in Research.
function RunRedirect() {
  const { id } = useParams();
  return <Navigate to={`/research?run=${id}`} replace />;
}

// /compare?ids=1,2 → ticked in Research; a sweep has no v2 screen (D19).
function CompareRedirect() {
  const [params] = useSearchParams();
  const ids = params.get('ids');
  return <Navigate to={ids ? `/research?compare=${ids}` : '/research'} replace />;
}

// /watchlists/:id → that list's sheet on the Journal.
function WatchlistRedirect() {
  const { id } = useParams();
  return <Navigate to={id ? `/?edit=${id}` : '/'} replace />;
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
        <Route index element={<Journal />} />
        <Route path="research" element={<Research />} />
        <Route path="runs/:id/symbols/:symbol" element={<TickerDetail />} />
        <Route path="live" element={<Live />} />

        <Route path="runs" element={<Navigate to="/research" replace />} />
        <Route path="runs/:id" element={<RunRedirect />} />
        <Route path="runs/:id/progress" element={<RunRedirect />} />
        <Route path="new" element={<Navigate to="/research" replace />} />
        <Route path="compare" element={<CompareRedirect />} />
        <Route path="watchlists" element={<WatchlistRedirect />} />
        <Route path="watchlists/:id" element={<WatchlistRedirect />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
