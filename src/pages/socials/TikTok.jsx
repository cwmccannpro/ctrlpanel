import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useWorkspace } from '../../components/WorkspaceProvider.jsx';
import Card from '../../components/shared/Card.jsx';
import SocialContentList from '../../components/SocialContentList.jsx';
import { tiktok } from '../../lib/api.js';
import { accountLabel } from '../../lib/socialPlatforms.js';
import { number } from '../../lib/helpers.js';

const show = value => value == null ? '—' : number(value);

function TikTokAnalytics({ account }) {
  const { socials } = useWorkspace();
  const navigate = useNavigate();
  const { id } = account;
  const [range, setRange] = useState('28d');
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState(null);
  const [action, setAction] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    tiktok.analytics(id, range).then(
      data => { if (active) setResult({ range, refresh, data }); },
      error => { if (active) setResult({ range, refresh, error: error.message }); },
    );
    return () => { active = false; };
  }, [id, range, refresh]);

  const current = result?.range === range && result.refresh === refresh ? result : null;
  const data = current?.data;
  const profile = data?.account || account;
  const label = accountLabel('tiktok', account);

  const rename = async () => {
    const next = prompt('Rename account', label);
    if (next === null) return;
    setAction('rename');
    setError('');
    try { await socials.tiktok.rename(id, next); }
    catch (e) { setError(e.message); }
    finally { setAction(''); }
  };
  const disconnect = async () => {
    if (!confirm(`Disconnect "${label}"?`)) return;
    setAction('disconnect');
    setError('');
    try { await socials.tiktok.disconnect(id); navigate('/socials'); }
    catch (e) { setError(e.message); setAction(''); }
  };
  const reconnect = async () => {
    setAction('reconnect');
    setError('');
    try { await tiktok.connect(); }
    catch (e) { setError(e.message); setAction(''); }
  };

  return <div className="fade-in social-sections">
    <div className="page-header">
      <div><h1 className="page-title">{label}</h1><p className="page-header-sub">TikTok{account.label && profile.name ? ` · ${profile.name}` : ''}</p></div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Link className="btn" to="/socials">All accounts</Link>
        <button className="btn" disabled={Boolean(action)} onClick={rename}>Rename</button>
      </div>
    </div>
    <Card className="card-section" static>
      <h2 className="social-overview-title">Account stats</h2>
      <div className="social-performance-stats">
        <span><strong>{show(profile.followers_count)}</strong>Followers</span>
        <span><strong>{show(profile.following_count)}</strong>Following</span>
        <span><strong>{show(profile.likes_count)}</strong>Total likes</span>
        <span><strong>{show(profile.video_count)}</strong>Public videos</span>
      </div>
      {data && profile.followers_count == null && <p className="list-row-meta">If account stats are unavailable, reconnect and allow access to profile statistics.</p>}
    </Card>
    <Card className="card-section" static>
      <div className="spread" style={{ gap: 12, flexWrap: 'wrap' }}>
        <h2 className="social-overview-title">Public video performance</h2>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="segmented" aria-label="Video publication range">{['7d', '28d'].map(value => <button
            key={value} className={value === range ? 'active' : ''} aria-pressed={value === range} onClick={() => setRange(value)}>{value}</button>)}</div>
          <button className="btn" disabled={!current || Boolean(action)} onClick={() => setRefresh(value => value + 1)}>
            <i className="ti ti-refresh" aria-hidden="true" />{current?.error ? 'Retry' : 'Refresh'}
          </button>
        </div>
      </div>
      <p className="list-row-meta">Lifetime metrics for public videos published in the last {range.slice(0, -1)} days.</p>
      {!current && <p className="social-overview-empty" role="status">Loading TikTok analytics…</p>}
      {current?.error && <p className="social-connect-error" role="alert">{current.error}</p>}
      {data && <>
        {data.notes.map(note => <p key={note} className="list-row-meta" role="status">{note}</p>)}
        <div className="social-performance-stats" aria-label={data.partial ? 'Totals for available videos' : 'Video totals'}>
          <span><strong>{show(data.totals.views)}</strong>Views</span>
          <span><strong>{show(data.totals.likes)}</strong>Likes</span>
          <span><strong>{show(data.totals.comments)}</strong>Comments</span>
          <span><strong>{show(data.totals.shares)}</strong>Shares</span>
        </div>
        <SocialContentList platform="tiktok" posts={data.posts} emptyMessage="No public videos found in this range." />
      </>}
    </Card>
    {error && <p className="body-text" role="alert">{error}</p>}
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      {socials.tiktok.ready && <button className="btn btn--sm" onClick={reconnect} disabled={Boolean(action)}>Reconnect</button>}
      <button className="btn btn--sm btn--ghost" onClick={disconnect} disabled={Boolean(action)}>Disconnect</button>
    </div>
  </div>;
}

export default function TikTok() {
  const { id } = useParams();
  const { socials } = useWorkspace();
  const account = socials.tiktok.accounts.find(a => a.id === id);
  if (!socials.loaded) return <div className="placeholder" role="status">Loading accounts…</div>;
  if (!account) return <div className="placeholder">
    <h2>{socials.tiktok.error ? 'Could not load TikTok accounts' : 'TikTok account unavailable'}</h2>
    {socials.tiktok.error && <p role="alert">{socials.tiktok.error}</p>}
    <Link className="btn" to="/socials">Back to Socials</Link>
  </div>;
  return <TikTokAnalytics key={id} account={account} />;
}
