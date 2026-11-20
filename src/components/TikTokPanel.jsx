import { Link } from 'react-router-dom';
import { useWorkspace } from './WorkspaceProvider.jsx';
import { accountLabel, PLATFORMS } from '../lib/socialPlatforms.js';
import { compactNumber } from '../lib/helpers.js';

const show = value => value == null ? '—' : compactNumber(value);

export default function TikTokPanel({ cfg = {}, onCfg = () => {} }) {
  const { socials } = useWorkspace();
  const { accounts, error } = socials.tiktok;
  const account = accounts.find(a => a.id === cfg.accountId) || accounts[0];
  const path = account ? PLATFORMS.tiktok.path(account.id) : '/socials';
  return <>
    <div className="dash2-panel-head"><Link className="dash2-panel-title dash2-link" to={path}>TikTok</Link></div>
    {!socials.loaded ? <p className="dash2-panel-note" role="status">Loading accounts…</p> : !account ? <>
      <p className="dash2-panel-note">{error || 'Connect a TikTok account to see its stats.'}</p>
      <Link className="btn btn--sm" to="/socials">Open Socials</Link>
    </> : <>
      <label className="dash2-panel-setting">Account<select className="dash2-select" value={account.id} onChange={e => onCfg({ accountId: e.target.value })}>
        {accounts.map(a => <option key={a.id} value={a.id}>{accountLabel('tiktok', a)}</option>)}
      </select></label>
      <div className="dash2-yt-stats">
        <div><span className="dash2-yt-num">{show(account.followers_count)}</span><span className="dash2-yt-lbl">followers</span></div>
        <div><span className="dash2-yt-num">{show(account.likes_count)}</span><span className="dash2-yt-lbl">total likes</span></div>
        <div><span className="dash2-yt-num">{show(account.video_count)}</span><span className="dash2-yt-lbl">public videos</span></div>
      </div>
      <p className="dash2-panel-note">Stats at last sign-in</p>
      <Link className="btn btn--sm" to={path}>View analytics</Link>
    </>}
  </>;
}
