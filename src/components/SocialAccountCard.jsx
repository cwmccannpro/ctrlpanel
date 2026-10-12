// One connected Socials section (a YouTube channel or an Instagram account) on
// the overview. Clicking opens its analytics page; rename / disconnect are
// inline. Platform differences live in lib/socialPlatforms.js.
import { useState } from 'react';
import Card from './shared/Card.jsx';
import { number, compactNumber } from '../lib/helpers.js';
import { PLATFORMS, accountLabel, instagramAccountKind } from '../lib/socialPlatforms.js';

function details(platform, a) {
  if (platform === 'x') return { image: a.profile_image_url, sub: a.label ? `X · @${a.username}` : 'X',
    stats: `${number(a.followers_count)} followers · ${number(a.tweet_count)} posts` };
  if (platform === 'instagram') {
    const kind = instagramAccountKind(a.account_type);
    return {
      image: a.profile_picture_url,
      sub: a.label && a.username ? `Instagram · @${a.username}` : 'Instagram',
      stats: `${number(a.followers_count)} followers · ${number(a.media_count)} posts${kind ? ` · ${kind}` : ''}`,
    };
  }
  return {
    image: a.thumbnail,
    sub: a.label ? `YouTube · ${a.title}` : 'YouTube',
    stats: `${number(a.subscriber_count)} subscribers · ${number(a.video_count)} videos · ${compactNumber(a.view_count)} total views`,
  };
}

export default function SocialAccountCard({ platform, account, onOpen, onRename, onDisconnect, onReconnect, canConnect, busy }) {
  const meta = PLATFORMS[platform];
  const { image, sub, stats } = details(platform, account);
  // Instagram's CDN links are signed and expire; fall back to the platform icon.
  const [broken, setBroken] = useState(false);

  return (
    <Card className="card-section" static>
      <div className="row" style={{ gap: 10, marginBottom: 10 }}>
        {image && !broken ? (
          <img src={image} alt="" className="yt-header-thumb" onError={() => setBroken(true)} referrerPolicy="no-referrer" />
        ) : (
          <span className="social-avatar-fallback" aria-hidden="true"><i className={`ti ${meta.icon}`} /></span>
        )}
        <div style={{ minWidth: 0 }}>
          <button className="social-account-name social-account-open" onClick={onOpen}>{accountLabel(platform, account)} <i className="ti ti-arrow-up-right" aria-hidden="true" /></button>
          <div className="list-row-meta">{sub}</div>
        </div>
      </div>
      <div className="list-row-meta">{stats}</div>
      <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn btn--sm" onClick={onRename} disabled={busy}><i className="ti ti-pencil" aria-hidden="true" /> Rename</button>
        {canConnect && <button className="btn btn--sm btn--ghost" onClick={onReconnect} disabled={busy}><i className="ti ti-plug-connected" aria-hidden="true" /> Reconnect</button>}
        <button className="btn btn--sm btn--ghost" onClick={onDisconnect} disabled={busy}>
          <i className="ti ti-plug-off" aria-hidden="true" /> Disconnect
        </button>
      </div>
    </Card>
  );
}
