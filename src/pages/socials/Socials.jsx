import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Card from '../../components/shared/Card.jsx';
import Spinner from '../../components/shared/Spinner.jsx';
import SocialPlatformSection from '../../components/SocialPlatformSection.jsx';
import SocialConnectionSetup from '../../components/SocialConnectionSetup.jsx';
import SocialAnalyticsOverview from '../../components/SocialAnalyticsOverview.jsx';
import { useWorkspace } from '../../components/WorkspaceProvider.jsx';
import { socialApi } from '../../lib/api.js';
import { PLATFORM_LIST, accountLabel, socialSections } from '../../lib/socialPlatforms.js';

export default function Socials() {
  const { socials } = useWorkspace();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [setupPanel, setSetupPanel] = useState(null);

  useEffect(() => {
    const platform = PLATFORM_LIST.find(({ id }) => ['connected', 'error'].includes(params.get(id)));
    if (!platform) return;
    const failed = params.get(platform.id) === 'error';
    setNotice({ failed, platform: platform.id, text: failed
      ? params.get('message') || `Could not connect to ${platform.name}.`
      : `${platform.name} connected. Select an account to view its analytics.` });
    setParams({}, { replace: true });
  }, [params, setParams]);

  const connect = async platform => {
    setBusy(platform);
    setError('');
    setSetupPanel(null);
    try { await socialApi[platform].connect(); }
    catch (e) {
      if (e.setup) setSetupPanel({ platform, setup: e.setup });
      else setError(e.message || 'Could not start sign-in.');
      setBusy('');
    }
  };
  const check = async () => {
    setBusy('check');
    try {
      await socials.reload();
      setSetupPanel(current => current && { platform: current.platform });
    } finally { setBusy(''); }
  };
  const rename = async (platform, account, apply) => {
    const next = prompt('Rename account', accountLabel(platform, account));
    if (next === null) return;
    setError('');
    try { await apply(account.id, next); }
    catch (e) { setError(e.message || 'Could not rename this account.'); }
  };
  const disconnect = async (platform, account, apply) => {
    if (!confirm(`Disconnect "${accountLabel(platform, account)}"?`)) return;
    setBusy('disconnect');
    setError('');
    try { await apply(account.id); }
    catch (e) { setError(e.message || 'Could not disconnect this account.'); }
    finally { setBusy(''); }
  };

  const platforms = PLATFORM_LIST.map(meta => ({
    meta, state: meta.id === 'youtube' ? { ...socials, accounts: socials.channels } : socials[meta.id],
  }));
  const total = socialSections(socials).length;
  const selected = platforms.find(({ meta }) => meta.id === setupPanel?.platform);

  return (
    <div className="fade-in">
      <div className="page-header"><h1 className="page-title">Socials</h1></div>

      {notice && <Card className={`yt-notice ${notice.failed ? 'is-error' : ''}`} static>
        <i className={`ti ${notice.failed ? 'ti-alert-triangle' : 'ti-circle-check'}`} aria-hidden="true" />
        <span role={notice.failed ? 'alert' : 'status'}>{notice.text}</span>
        {notice.failed && <button className="btn btn--sm" onClick={() => setSetupPanel({ platform: notice.platform })}>Connection setup</button>}
        <button className="btn btn--ghost btn--icon" onClick={() => setNotice(null)} aria-label="Dismiss"><i className="ti ti-x" aria-hidden="true" /></button>
      </Card>}

      <div className="social-sections">
        <Card className="card-section" static>
          <h2 className="social-overview-title">Connect an account</h2>
          <div className="social-connect-options">
            {PLATFORM_LIST.map(meta => (
              <button key={meta.id} className="btn social-connect-button" disabled={Boolean(busy)}
                onClick={() => connect(meta.id)}>
                <i className={`ti ${meta.icon}`} aria-hidden="true" />
                <span>{busy === meta.id ? 'Opening sign-in…' : `Sign in with ${meta.name}`}
                  {meta.id === 'instagram' && <small>Business or Creator</small>}
                </span>
              </button>
            ))}
          </div>
          {error && <p className="social-connect-error" role="alert">{error}</p>}
          {selected && <SocialConnectionSetup key={selected.meta.id} platform={selected.meta.id}
            setup={setupPanel.setup || selected.state.setup} error={setupPanel.setup ? '' : selected.state.error}
            onRetry={check} busy={Boolean(busy)} onClose={() => setSetupPanel(null)} />}
        </Card>
        {!socials.loaded ? <div className="placeholder" style={{ minHeight: 200 }}><Spinner large /></div> : total > 0 && <>
          <section aria-labelledby="connected-social-accounts">
            <h2 className="social-overview-title" id="connected-social-accounts">Connected accounts</h2>
            {platforms.filter(({ state }) => state.accounts.length).map(({ meta, state }) =>
              <SocialPlatformSection key={meta.id} platform={meta.id} accounts={state.accounts} ready={state.ready} busy={Boolean(busy)}
                onConnect={() => connect(meta.id)} onOpen={a => navigate(meta.path(a.id))}
                onRename={a => rename(meta.id, a, state.rename)}
                onDisconnect={a => disconnect(meta.id, a, state.disconnect)} />)}
          </section>
          <SocialAnalyticsOverview socials={socials} />
        </>}
      </div>
    </div>
  );
}
