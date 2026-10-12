import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useWorkspace } from './WorkspaceProvider.jsx';
import { x } from '../lib/api.js';
import { accountLabel } from '../lib/socialPlatforms.js';
import { compactNumber } from '../lib/helpers.js';

export default function XPanel({ cfg = {}, onCfg = () => {} }) {
  const { socials } = useWorkspace();
  const account = socials.x.accounts.find(a => a.id === cfg.accountId) || socials.x.accounts[0];
  const id = account?.id;
  const range = ['7d', '28d'].includes(cfg.range) ? cfg.range : '28d';
  const [result, setResult] = useState(null);
  const request = useRef(0);
  useEffect(() => { request.current++; setResult(null); return () => { request.current++; }; }, [id, range]);
  const load = async () => {
    const revision = ++request.current;
    setResult({ id, range, loading: true });
    try { const data = await x.analytics(id, range); if (revision === request.current) setResult({ id, range, data }); }
    catch (e) { if (revision === request.current) setResult({ id, range, error: e.message }); }
  };
  const show = value => value == null ? '—' : compactNumber(value);
  const path = id ? `/socials/x/${id}` : '/socials';
  const current = result?.id === id && result.range === range ? result : null;
  return <>
    <div className="dash2-panel-head"><Link className="dash2-panel-title dash2-link" to={path}>X</Link></div>
    {!socials.loaded ? <p className="dash2-panel-note">Loading accounts…</p> : !account ? <><p className="dash2-panel-note">Connect your X account in Socials.</p><Link className="btn btn--sm" to="/socials">Open Socials</Link></> : <>
      <label className="dash2-panel-setting">Account<select className="dash2-select" value={id} onChange={e => onCfg({ accountId: e.target.value })}>{socials.x.accounts.map(a => <option key={a.id} value={a.id}>{accountLabel('x', a)}</option>)}</select></label>
      <div className="segmented segmented--xs" aria-label="X post range">{['7d', '28d'].map(r => <button key={r} className={range === r ? 'active' : ''} aria-pressed={range === r} onClick={() => onCfg({ range: r })}>{r}</button>)}</div>
      <div className="dash2-yt-stats"><div><span className="dash2-yt-num">{show(account.followers_count)}</span><span className="dash2-yt-lbl">followers</span></div><div><span className="dash2-yt-num">{show(current?.data?.totals.impressions)}</span><span className="dash2-yt-lbl">post impressions</span></div><div><span className="dash2-yt-num">{show(current?.data?.totals.likes)}</span><span className="dash2-yt-lbl">post likes</span></div></div>
      {current?.error && <p className="dash2-panel-note" role="alert">{current.error}</p>}
      <p className="dash2-panel-note">Lifetime metrics for posts from {range}. Loading uses X API credits.</p>
      <div className="dash2-panel-actions"><button className="btn btn--sm" onClick={load} disabled={current?.loading}>{current?.loading ? 'Loading…' : 'Load analytics'}</button><Link className="btn btn--sm" to={path}>Open account</Link></div>
    </>}
  </>;
}
