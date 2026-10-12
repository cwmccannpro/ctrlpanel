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
};
export default function SocialConnectionSetup({ platform, setup, onRetry, busy }) {
  const guide = GUIDES[platform];
  return <details className="social-setup">
    <summary><i className="ti ti-plug-connected" aria-hidden="true" /> {setup?.ready ? 'Connection setup' : 'Finish connection setup'}</summary>
    <div className="social-setup-body">
      {setup && <div className="social-checks" role="status">
        <span><i className={`ti ${setup.missing?.length ? 'ti-alert-circle' : 'ti-circle-check'}`} aria-hidden="true" /> {setup.missing?.length ? 'Credentials needed' : 'App credentials present'}</span>
        <span><i className={`ti ${setup.storage === 'ready' ? 'ti-circle-check' : 'ti-alert-circle'}`} aria-hidden="true" /> {setup.storage === 'ready' ? 'Private storage ready' : 'Private storage needs setup'}</span>
      </div>}
      {setup?.missing?.length > 0 && <p>Set these server credentials: <code>{setup.missing.join(', ')}</code>.</p>}
      {setup?.issues?.map(issue => <p key={issue}>{issue}</p>)}
      <ol>{guide.steps.map(step => <li key={step}>{step}</li>)}</ol>
      <label className="social-callback-label">Registered callback URL
        <input className="input" readOnly value={setup?.redirectUri || `https://your-domain/api/${platform}/callback`} onFocus={e => e.target.select()} />
      </label>
      <p className="list-row-meta">Save credentials in the server environment or Cloudflare Worker secrets, then restart or deploy. Apply migrations/20261011-social-connections.sql in Supabase once. The connection check verifies credentials are present and storage is accessible; provider permissions are verified during sign-in.</p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <a className="btn btn--sm" href={guide.url} target="_blank" rel="noopener noreferrer">Open {guide.label}<i className="ti ti-external-link" aria-hidden="true" /></a>
        <button className="btn btn--sm" onClick={onRetry} disabled={busy}><i className="ti ti-refresh" aria-hidden="true" /> Check {PLATFORMS[platform].name} setup</button>
      </div>
    </div>
  </details>;
}
