import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../components/AuthProvider.jsx';
import Spinner from '../components/shared/Spinner.jsx';

export default function Login() {
  const { signIn, configured } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await signIn({ email, password });
    setLoading(false);
    if (error) setError(error.message);
    else navigate('/');
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card fade-in" onSubmit={submit}>
        <div className="auth-brand">
          <div className="auth-logo">CTRL</div>
          <div>
            <div className="sidebar-brand-name" style={{ fontSize: 18 }}>CTRLpanel</div>
            <div className="sidebar-brand-tag">by cwmccann.pro</div>
          </div>
        </div>

        <h1 className="auth-title">Welcome back</h1>
        <p className="auth-sub">Sign in to your Life OS.</p>

        {!configured && (
          <div className="auth-notice">
            Supabase isn't configured yet. Add <code>VITE_SUPABASE_URL</code> and{' '}
            <code>VITE_SUPABASE_ANON_KEY</code> to <code>.env</code>, then restart the dev server.
          </div>
        )}

        <div className="field">
          <label className="field-label">Email</label>
          <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label className="field-label">Password</label>
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>

        {error && <div className="auth-error">{error}</div>}

        <button className="btn btn--accent" style={{ width: '100%', justifyContent: 'center' }} disabled={loading || !configured}>
          {loading ? <Spinner /> : 'Sign In'}
        </button>

        <p className="auth-foot">
          No account? <Link to="/register">Create one</Link>
        </p>
      </form>
    </div>
  );
}
