// Password sign-in (F2, Login.png). One user; a wrong password says only that.

import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { readSession, saveSession } from '../lib/session.js';
import BrandMark from '../components/BrandMark.jsx';

const MESSAGES = {
  401: 'That password didn’t match. Try again.',
  429: 'Too many attempts. Wait a few minutes and try again.',
};

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (readSession()) return <Navigate to="/" replace />;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      saveSession(await api('/api/login', { method: 'POST', body: { password } }));
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(MESSAGES[err.status] || err.message);
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-main">
        <div className="auth-wrap">
          <div className="auth-brand">
            <BrandMark size={28} />
            <span className="title">ORB Lab</span>
          </div>
          <form className="card auth-card" onSubmit={submit}>
            <div>
              <h1 className="title">Sign in</h1>
              <p className="auth-sub">Opening Range Breakout backtests · NSE</p>
            </div>
            <label className="field">
              <span className="label">Password</span>
              <input className="input input-lg" type="password" autoFocus autoComplete="current-password"
                value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={Boolean(error)} />
            </label>
            {error && <div className="field-error" role="alert">{error}</div>}
            <button className="btn btn-primary btn-lg" disabled={busy || !password}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <p className="caption auth-foot">Single-user app · sessions last 7 days</p>
        </div>
      </div>
      <div className="auth-art" aria-hidden="true">
        <img className="auth-art-fill" src="/assets/login_banner.png" alt="" />
        <img className="auth-art-image" src="/assets/login_banner.png" alt="" />
      </div>
    </div>
  );
}
