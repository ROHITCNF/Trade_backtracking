// Password login (F2). Minimal for the scaffold; #30 brings the full screen.

import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { readSession, saveSession } from '../lib/session.js';

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
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={submit}>
        <h1 className="title">ORB Lab</h1>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" className="input" type="password" autoFocus autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={Boolean(error)} />
        {error && <div className="loss" role="alert">{error}</div>}
        <button className="btn btn-primary" disabled={busy || !password}>Log in</button>
      </form>
    </div>
  );
}
