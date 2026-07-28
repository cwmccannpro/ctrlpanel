// ============================================================
// CTRLpanel — Socials (overview)
// Socials is modular, like Projects: every connected channel is its own
// renameable section with its own page (`/socials/youtube/:id`) and its own
// sidebar entry, so several YouTube channels stay distinguishable.
// ============================================================
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../../components/shared/Card.jsx';
import Spinner from '../../components/shared/Spinner.jsx';
import { useWorkspace } from '../../components/WorkspaceProvider.jsx';
import { youtube } from '../../lib/api.js';
import { channelLabel, number, compactNumber } from '../../lib/helpers.js';

export default function Socials() {
  const { socials } = useWorkspace();
  const { reload } = socials;
  const navigate = useNavigate();
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // The OAuth callback comes back here with ?youtube=connected|error.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('youtube') === 'connected') setNotice('Channel connected.');
    if (params.get('youtube') === 'error') setNotice(`Connection failed: ${params.get('message') || 'unknown error'}`);
    if (params.get('youtube')) {
      window.history.replaceState({}, '', '/socials');
      reload();
    }
  }, [reload]);

  const rename = async (channel) => {
    const next = prompt('Rename section', channelLabel(channel));
    if (next === null) return;
    setError('');
    try {
      await socials.rename(channel.id, next);
    } catch (e) {
      setError(e.message || 'Could not rename this section.');
    }
  };

  const disconnect = async (channel) => {
    if (!confirm(`Disconnect "${channelLabel(channel)}"? Its analytics page is removed from the sidebar.`)) return;
    setBusy(true);
    setError('');
    try {
      await socials.disconnect(channel.id);
    } catch (e) {
      setError(e.message || 'Could not disconnect this channel.');
    } finally {
      setBusy(false);
    }
  };

  const noticeIsError = notice.startsWith('Connection failed');

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Socials</h1>
          <div className="page-header-sub">
            {socials.channels.length} {socials.channels.length === 1 ? 'section' : 'sections'} · each channel gets its own page
          </div>
        </div>
        {socials.ready && (
          <button className="btn btn--accent" onClick={() => youtube.connect()}>
            <i className="ti ti-brand-youtube" /> {socials.channels.length ? 'Connect another' : 'Connect channel'}
          </button>
        )}
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
          <p className="body-text" style={{ color: 'var(--accent)' }}><i className="ti ti-alert-triangle" /> {error}</p>
        </Card>
      )}

      {!socials.loaded ? (
        <div className="placeholder" style={{ minHeight: 200 }}><Spinner large /></div>
      ) : socials.error ? (
        <div className="placeholder">
          <i className="ti ti-cloud-off" />
          <h2>Couldn’t load Socials</h2>
          <p>{socials.error}</p>
          <button className="btn" onClick={socials.reload}><i className="ti ti-refresh" /> Retry</button>
        </div>
      ) : !socials.ready ? (
        <div className="placeholder">
          <i className="ti ti-brand-youtube" />
          <h2>YouTube isn’t configured on the server</h2>
          <p>
            Set the Google OAuth env vars and enable the <strong>YouTube Data API v3</strong> and
            <strong> YouTube Analytics API</strong> in Google Cloud, then add the YouTube read-only scopes to the
            consent screen (see .env.example).
          </p>
        </div>
      ) : socials.channels.length === 0 ? (
        <div className="placeholder">
          <i className="ti ti-brand-youtube" />
          <h2>No channels yet</h2>
          <p>
            Sign in with the Google account that owns your YouTube channel to pull its analytics here. Every channel you
            connect becomes its own section in the sidebar — rename them to tell them apart.
          </p>
          <button className="btn btn--accent" onClick={() => youtube.connect()}><i className="ti ti-brand-youtube" /> Connect channel</button>
        </div>
      ) : (
        <div className="grid grid-3">
          {socials.channels.map((c) => (
            <Card key={c.id} className="card-section" onClick={() => navigate(`/socials/youtube/${c.id}`)} style={{ cursor: 'pointer' }}>
              <div className="row" style={{ gap: 10, marginBottom: 10 }}>
                {c.thumbnail && <img src={c.thumbnail} alt="" className="yt-header-thumb" />}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)' }}>{channelLabel(c)}</div>
                  <div className="list-row-meta">
                    {c.label ? `YouTube · ${c.title}` : 'YouTube'}
                  </div>
                </div>
              </div>
              <div className="list-row-meta">
                {number(c.subscriber_count || 0)} subscribers · {number(c.video_count || 0)} videos ·
                {' '}{compactNumber(c.view_count || 0)} total views
              </div>
              <div className="row" style={{ gap: 6, marginTop: 12 }} onClick={(e) => e.stopPropagation()}>
                <button className="btn btn--sm" onClick={() => rename(c)}><i className="ti ti-pencil" /> Rename</button>
                <button className="btn btn--sm btn--ghost" onClick={() => disconnect(c)} disabled={busy}>
                  <i className="ti ti-plug-off" /> Disconnect
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
