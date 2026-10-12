import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../components/AuthProvider.jsx';
import { useWorkspace } from '../../components/WorkspaceProvider.jsx';
import Card from '../../components/shared/Card.jsx';
import SocialContentList from '../../components/SocialContentList.jsx';
import { x } from '../../lib/api.js';
import { accountLabel } from '../../lib/socialPlatforms.js';
import { number } from '../../lib/helpers.js';

export default function X() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { socials } = useWorkspace();
  const { settings, updateUiPreferences } = useAuth();
  const account = socials.x.accounts.find(a => a.id === id);
  const [range, setRange] = useState('28d');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const savedRange = settings?.ui_preferences?.x?.range;
  useEffect(() => { if (['7d', '28d'].includes(savedRange)) setRange(savedRange); }, [savedRange]);
  useEffect(() => { request.current++; setResult(null); setBusy(false); setError(''); return () => { request.current++; }; }, [id, range]);
  const load = async () => {
    const revision = ++request.current;
    setBusy(true); setError('');
    try { const data = await x.analytics(id, range); if (request.current === revision) setResult({ id, range, data }); }
    catch (e) { if (request.current === revision) setError(e.message); }
    finally { if (request.current === revision) setBusy(false); }
  };
  const connect = async () => { setBusy(true); try { await x.connect(); } catch (e) { setError(e.message); setBusy(false); } };
  const rename = async () => {
    const label = prompt('Rename section', accountLabel('x', account));
    if (label === null) return;
    try { await socials.x.rename(id, label); } catch (e) { setError(e.message); }
  };
  const disconnect = async () => {
    if (!confirm(`Disconnect "${accountLabel('x', account)}"?`)) return;
    setBusy(true);
    try { await socials.x.disconnect(id); navigate('/socials'); } catch (e) { setError(e.message); setBusy(false); }
  };
  if (!socials.loaded) return <div className="placeholder" role="status">Loading accounts…</div>;
  if (!account) return <div className="placeholder"><i className="ti ti-brand-x" /><h2>Account not found</h2><p>Connect an X account in Socials to view its content analytics.</p><button className="btn" onClick={() => navigate('/socials')}>Back to Socials</button></div>;
  const data = result?.id === id && result.range === range ? result.data : null;
  const show = value => value == null ? '—' : number(value);
  const live = data?.account || account;
  return <div className="fade-in">
    <div className="page-header"><div><h1>{accountLabel('x', account)}</h1><div className="page-header-sub">X · @{live.username}</div></div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><button className="btn" onClick={() => navigate('/socials')}>All accounts</button><button className="btn" onClick={rename} disabled={busy}>Rename</button></div>
    </div>
    <Card className="card-section" static><div className="spread" style={{ gap: 12, flexWrap: 'wrap' }}>
      <div><div className="value-md">{live.name}</div><p className="list-row-meta">{show(live.followers_count)} followers · {show(live.following_count)} following · {show(live.tweet_count)} posts</p></div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><div className="segmented" aria-label="Post publication range">{['7d', '28d'].map(r => <button key={r} className={r === range ? 'active' : ''} aria-pressed={r === range} disabled={busy} onClick={() => { setRange(r); updateUiPreferences('x', { range: r }).catch(() => {}); }}>{r}</button>)}</div>
        <button className="btn btn--accent" onClick={load} disabled={busy}>{busy ? 'Loading…' : data ? 'Refresh analytics' : 'Load analytics'}</button>
        <button className="btn" onClick={connect} disabled={busy || !socials.x.ready}>Reconnect</button>
        <button className="btn btn--ghost" onClick={disconnect} disabled={busy}>Disconnect</button>
      </div>
    </div></Card>
    {error && <Card className="card-section" static><p role="alert">{error}</p><p className="list-row-meta">Use Reconnect for expired access, or check connection setup in Socials.</p></Card>}
    {!data ? <Card className="card-section" static><p role="status">{busy ? 'Reading your X posts…' : 'Load content analytics when you’re ready. Requests consume X developer API credits.'}</p></Card>
      : <>
        <div className="grid grid-3">{[['impressions', 'Impressions'], ['likes', 'Likes'], ['reposts', 'Reposts'], ['replies', 'Replies'], ['urlClicks', 'Link clicks'], ['profileClicks', 'Profile clicks']].map(([key, label]) =>
          <Card className="stat-card" key={key} static><div className="stat-card-head"><span className="section-label">{label}</span></div><div className="stat-card-value">{show(data.totals[key])}</div><div className="stat-card-meta">{data.partial ? 'Available posts · ' : ''}lifetime totals · posts from {range}</div></Card>)}</div>
        <Card className="card-section" static><div className="card-section-title">Posts · {range}</div><SocialContentList platform="x" posts={data.posts} /></Card>
        <Card className="card-section" static>{data.notes.map(note => <p className="list-row-meta" key={note}>{note}</p>)}<p className="list-row-meta">{data.posts.length} posts returned · refreshed {new Date(data.fetchedAt).toLocaleString()}</p></Card>
      </>}
  </div>;
}
