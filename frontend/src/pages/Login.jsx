import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { homeFor, useAuth } from '../auth';
import { Alert, Button } from '../components/ui';

const DEMO = [
  { u: 'admin', p: 'admin123', role: 'Label admin' },
  { u: 'rahul', p: 'rahul123', role: 'Singer' },
  { u: 'arjun', p: 'arjun123', role: 'Producer' },
  { u: 'priya', p: 'priya123', role: 'Songwriter' },
  { u: 'finance', p: 'finance123', role: 'Finance' },
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const user = await login(username, password);
      navigate(homeFor(user.role), { replace: true });
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <div className="login-page">
      <div className="login-panel">
        <div className="brand login-brand">
          <span className="brand-mark" aria-hidden="true">♪</span>
          <div>
            <div className="brand-name">RoyaltyDesk</div>
            <div className="brand-sub">Music Royalty Management System</div>
          </div>
        </div>
        <h1>Sign in</h1>
        <p className="muted">Manage splits, streaming reports and royalty payouts.</p>
        <form onSubmit={submit} className="stack">
          <Alert error={error} />
          <label className="field">
            <span className="field-label">Username</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
          <Button type="submit" busy={busy} className="btn btn-primary btn-block">Sign in</Button>
        </form>
        <div className="demo-accounts">
          <div className="field-label">Demo accounts (click to fill)</div>
          <div className="demo-grid">
            {DEMO.map((d) => (
              <button key={d.u} type="button" className="demo-chip" onClick={() => { setUsername(d.u); setPassword(d.p); }}>
                <strong>{d.u}</strong><span>{d.role}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="login-art" aria-hidden="true">
        <div className="login-art-inner">
          <h2>From stream to statement.</h2>
          <p>Spotify, Apple Music and YouTube Music reports → approved splits → sampling obligations → advances → payouts.</p>
          <div className="art-bars">{[38, 62, 48, 80, 56, 92, 70].map((h, i) => <span key={i} style={{ height: `${h}%` }} />)}</div>
        </div>
      </div>
    </div>
  );
}
