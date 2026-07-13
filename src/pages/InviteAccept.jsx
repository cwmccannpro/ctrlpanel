import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../components/AuthProvider.jsx';
import Spinner from '../components/shared/Spinner.jsx';
import { authApi } from '../lib/api.js';

// Landing page for tokenized invite links from Resend emails
// (`/invite/<token>` — shared to-do lists AND nutrition friend requests).
// Signed out: stash the token and go through login/register; App.jsx routes
// back here once a session exists. Signed in: redeem immediately.
export const PENDING_INVITE_KEY = 'ctrlpanel-pending-invite';

export default function InviteAccept() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { loading, session } = useAuth();
  const [state, setState] = useState({ status: 'working' });
  const ran = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (!session) {
      localStorage.setItem(PENDING_INVITE_KEY, token);
      navigate('/login', { replace: true });
      return;
    }
    if (ran.current) return;
    ran.current = true;
    localStorage.removeItem(PENDING_INVITE_KEY);
    authApi
      .post('/invites/accept', { token })
      .then((res) => setState({ status: 'done', result: res }))
      .catch((e) => setState({ status: 'error', message: e.message }));
  }, [loading, session, token, navigate]);

  const result = state.result;
  return (
    <div className="auth-wrap">
      <div className="auth-card fade-in" style={{ textAlign: 'center' }}>
        <div className="auth-brand" style={{ justifyContent: 'center' }}>
          <div className="auth-logo">CTRL</div>
        </div>

        {state.status === 'working' && (
          <>
            <h1 className="auth-title">Accepting invite…</h1>
            <Spinner large />
          </>
        )}

        {state.status === 'done' && result?.kind === 'board' && (
          <>
            <h1 className="auth-title">You're in!</h1>
            <p className="auth-sub">
              The to-do list <strong>"{result.board_name || 'Shared list'}"</strong> is now shared with you.
              Everyone's changes sync live.
            </p>
            <button className="btn btn--accent" style={{ width: '100%', justifyContent: 'center' }} onClick={() => navigate(`/todo/${result.board_id}`)}>
              Open the list
            </button>
          </>
        )}

        {state.status === 'done' && result?.kind === 'friend' && (
          <>
            <h1 className="auth-title">Friends!</h1>
            <p className="auth-sub">
              You and <strong>{result.inviter_email}</strong> are now nutrition friends. Compare goal
              adherence on the leaderboard and join challenges — only aggregate stats are shared.
            </p>
            <button className="btn btn--accent" style={{ width: '100%', justifyContent: 'center' }} onClick={() => navigate('/health/nutrition')}>
              Go to Nutrition
            </button>
          </>
        )}

        {state.status === 'error' && (
          <>
            <h1 className="auth-title">Invite unavailable</h1>
            <div className="auth-error">{state.message}</div>
            <button className="btn" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }} onClick={() => navigate('/')}>
              Back to dashboard
            </button>
          </>
        )}
      </div>
    </div>
  );
}
