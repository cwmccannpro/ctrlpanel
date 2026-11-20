import { PLATFORMS } from '../lib/socialPlatforms.js';

const GUIDES = {
  youtube: {
    url: 'https://console.cloud.google.com/apis/credentials', label: 'Google Cloud',
    steps: ['Use the existing Google Web OAuth client. Enable YouTube Data API v3 and YouTube Analytics API.',
      'Register the callback URL below exactly. Add youtube.readonly and yt-analytics.readonly to the consent screen.',
      'If the consent screen is in Testing, add your Google account as a test user. Google testing grants may expire after seven days.',
      'Connect each channel. Choose its Google account or Brand Account in the sign-in picker. Repeat to add another channel.'],
  },
  instagram: {
    url: 'https://developers.facebook.com/apps/', label: 'Meta for Developers',
    steps: ['Use an Instagram Business or Creator account. Add Instagram API with Instagram Login to a Meta app.',
      'Add the callback URL below to Instagram login settings. Use the Instagram app ID and secret from that product.',
      'Grant instagram_business_basic and instagram_business_manage_insights. For your own account in Development mode, add it as an Instagram tester and accept its invitation.',
      'Connect each Instagram account separately. If an account’s access expires, reconnect it here.'],
  },
  x: {
    url: 'https://console.x.com/', label: 'X Developer Console',
    steps: ['Create an X developer app and enable OAuth 2.0 for a Web App with Read permissions.',
      'Register the callback URL below exactly and set the app website to CTRLpanel’s URL. Use the OAuth 2.0 Client ID and Client Secret.',
      'Enable access to read posts and users; CTRLpanel requests tweet.read, users.read and offline.access.',
      'Check API credits and set a spending limit in the developer console. Content analytics load when requested; each request can consume credits.',
      'Connect each X account separately. Switch accounts on X before connecting another account if X reuses your current sign-in.'],
  },
  tiktok: {
    url: 'https://developers.tiktok.com/', label: 'TikTok for Developers',
    steps: ['Add Login Kit for Web and Display API to a TikTok developer app.',
      'Register the HTTPS callback URL below and request user.info.basic, user.info.stats and video.list.',
      'Use an authorized sandbox account for testing or submit the app and scopes for review for production.'],
  },
};
export default function SocialConnectionSetup({ platform, setup, error, onRetry, busy, onClose }) {
  const guide = GUIDES[platform];
  return <section className="social-setup" aria-labelledby="social-setup-title">
    <div className="spread">
      <h3 id="social-setup-title" className="social-overview-title">{PLATFORMS[platform].name} connection setup</h3>
      <button className="btn btn--ghost btn--icon" onClick={onClose} aria-label="Close connection setup"><i className="ti ti-x" aria-hidden="true" /></button>
    </div>
    <div className="social-setup-body">
      {error && <p role="alert">{error}</p>}
      {setup?.ready && <p role="status">Ready to sign in.</p>}
      {setup?.missing?.length > 0 && <p>Set these server credentials: <code>{setup.missing.join(', ')}</code>.</p>}
      {setup?.issues?.filter(issue => issue !== error).map(issue => <p key={issue}>{issue}</p>)}
      <ol>{guide.steps.map(step => <li key={step}>{step}</li>)}</ol>
      <label className="social-callback-label">Registered callback URL
        <input className="input" readOnly value={setup?.redirectUri || `https://your-domain/api/${platform}/callback`} onFocus={e => e.target.select()} />
      </label>
      <p className="list-row-meta">Save credentials in the server environment or Cloudflare Worker secrets, then restart or deploy.</p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <a className="btn btn--sm" href={guide.url} target="_blank" rel="noopener noreferrer">Open {guide.label}<i className="ti ti-external-link" aria-hidden="true" /></a>
        <button className="btn btn--sm" onClick={onRetry} disabled={busy}><i className="ti ti-refresh" aria-hidden="true" /> Check {PLATFORMS[platform].name} setup</button>
      </div>
    </div>
  </section>;
}
