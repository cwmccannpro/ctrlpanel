import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../components/AuthProvider.jsx';
import Spinner from '../components/shared/Spinner.jsx';

export default function Register() {
  const { signUp, configured } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    const { data, error } = await signUp({ email, password, fullName });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    // If email confirmation is disabled, a session is returned immediately.
    if (data?.session) navigate('/');
    else setNotice('Account created! If email confirmation is enabled in Supabase, confirm via the email we sent, then sign in.');
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

        <h1 className="auth-title">Create your account</h1>
        <p className="auth-sub">Your own private Life OS — start fresh.</p>

        {!configured && (
          <div className="auth-notice">
            Supabase isn't configured yet. Add <code>VITE_SUPABASE_URL</code> and{' '}
            <code>VITE_SUPABASE_ANON_KEY</code> to <code>.env</code>, then restart the dev server.
          </div>
        )}

        <div className="field">
          <label className="field-label">Full name</label>
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </div>
        <div className="field">
          <label className="field-label">Email</label>
          <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label className="field-label">Password</label>
          <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>

        {error && <div className="auth-error">{error}</div>}
        {notice && <div className="auth-notice" style={{ borderColor: 'var(--green)', color: 'var(--text-primary)' }}>{notice}</div>}

        <button className="btn btn--accent" style={{ width: '100%', justifyContent: 'center' }} disabled={loading || !configured}>
          {loading ? <Spinner /> : 'Create Account'}
        </button>

        <p className="auth-foot">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
