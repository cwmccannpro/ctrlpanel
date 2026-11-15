// ============================================================
// CTRLpanel — Socials (overview)
// Socials is modular, like Projects: every connected YouTube channel or
// Instagram account is its own renameable section with its own page
// (`/socials/youtube/:id`, `/socials/instagram/:id`) and its own sidebar entry,
// so several accounts stay distinguishable. Each platform renders on its own,
// so one being unconfigured or failing never hides the other.
// ============================================================
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../../components/shared/Card.jsx';
import Spinner from '../../components/shared/Spinner.jsx';
import SocialPlatformSection from '../../components/SocialPlatformSection.jsx';
import SocialAnalyticsOverview from '../../components/SocialAnalyticsOverview.jsx';
import { useWorkspace } from '../../components/WorkspaceProvider.jsx';
import { socialApi } from '../../lib/api.js';
import { PLATFORMS, PLATFORM_LIST, accountLabel } from '../../lib/socialPlatforms.js';

// The OAuth callbacks come back here with ?youtube=… or ?instagram=…
const CALLBACK_PARAMS = PLATFORM_LIST.map(p => p.id);

export default function Socials() {
  const { socials } = useWorkspace();
  const { reload } = socials;
  const navigate = useNavigate();
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const connect = async platform => {
    setBusy(true); setError('');
    try { await socialApi[platform].connect(); }
    catch (e) { setError(e.message || 'Could not start sign-in.'); setBusy(false); }
  };
  const check = async () => { setBusy(true); try { await reload(); } finally { setBusy(false); } };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const platform = CALLBACK_PARAMS.find((p) => params.get(p));
    if (!platform) return;
    const name = PLATFORMS[platform].name;
    setNotice(
      params.get(platform) === 'connected'
        ? `${name} ${PLATFORMS[platform].noun} connected.`
        : `Connection failed: ${params.get('message') || 'unknown error'}`
    );
    window.history.replaceState({}, '', '/socials');
    reload();
  }, [reload]);

  const rename = async (platform, account, apply) => {
    const next = prompt('Rename section', accountLabel(platform, account));
    if (next === null) return;
    setError('');
    try {
      await apply(account.id, next);
    } catch (e) {
      setError(e.message || 'Could not rename this section.');
    }
  };

  const disconnect = async (platform, account, apply) => {
    if (!confirm(`Disconnect "${accountLabel(platform, account)}"? Its analytics page is removed from the sidebar.`)) return;
    setBusy(true);
    setError('');
    try {
      await apply(account.id);
    } catch (e) {
      setError(e.message || `Could not disconnect this ${PLATFORMS[platform].noun}.`);
    } finally {
      setBusy(false);
    }
  };

  const { instagram: ig } = socials;
  const total = socials.channels.length + ig.accounts.length + socials.x.accounts.length;
  const noticeIsError = notice.startsWith('Connection failed');

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Socials</h1>
          <div className="page-header-sub">
            YouTube, Instagram & X · {total} {total === 1 ? 'account' : 'accounts'} connected
          </div>
        </div>
      </div>

      {notice && (
        <Card className={`yt-notice ${noticeIsError ? 'is-error' : ''}`} static>
          <i className={`ti ${noticeIsError ? 'ti-alert-triangle' : 'ti-circle-check'}`} />
          <span>{notice}</span>
          <button className="btn btn--ghost btn--icon" onClick={() => setNotice('')} aria-label="Dismiss"><i className="ti ti-x" /></button>
        </Card>
      )}

      {error && (
        <Card className="card-section" static>
          <p className="body-text" style={{ color: 'var(--accent)' }} role="alert"><i className="ti ti-alert-triangle" aria-hidden="true" /> {error}</p>
        </Card>
      )}

      {!socials.loaded ? (
        <div className="placeholder" style={{ minHeight: 200 }}><Spinner large /></div>
      ) : (
        <div className="social-sections">
          <SocialAnalyticsOverview socials={socials} />
          {PLATFORM_LIST.map(meta => {
            const state = meta.id === 'youtube' ? { ...socials, accounts: socials.channels } : socials[meta.id];
            return <SocialPlatformSection key={meta.id} platform={meta.id} {...state} busy={busy}
              onConnect={() => connect(meta.id)} onRetry={check}
              onOpen={a => navigate(meta.path(a.id))}
              onRename={a => rename(meta.id, a, state.rename)}
              onDisconnect={a => disconnect(meta.id, a, state.disconnect)} />;
          })}
        </div>
      )}
    </div>
  );
}
