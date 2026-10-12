// One platform's block on the Socials overview: header with a Connect button,
// then whichever of error / not configured / empty / account grid applies.
// Each platform renders independently so one being down never hides the other.
import SocialAccountCard from './SocialAccountCard.jsx';
import { PLATFORMS } from '../lib/socialPlatforms.js';
import SocialConnectionSetup from './SocialConnectionSetup.jsx';

export default function SocialPlatformSection({
  platform,
  ready,
  setup,
  accounts,
  error,
  busy,
  onConnect,
  onRetry,
  onOpen,
  onRename,
  onDisconnect,
}) {
  const meta = PLATFORMS[platform];
  const count = accounts.length;

  let body;
  if (count > 0) {
    body = <div className="grid grid-3">{accounts.map(a => <SocialAccountCard key={a.id} platform={platform} account={a} busy={busy}
      onOpen={() => onOpen(a)} onRename={() => onRename(a)} onDisconnect={() => onDisconnect(a)}
      onReconnect={onConnect} canConnect={ready} />)}</div>;
  } else if (error) {
    body = (
      <div className="placeholder social-placeholder">
        <i className="ti ti-cloud-off" aria-hidden="true" />
        <h2>Couldn’t load {meta.name}</h2>
        <p>{error}</p>
        <button className="btn" onClick={onRetry}><i className="ti ti-refresh" /> Retry</button>
      </div>
    );
  } else if (!ready) {
    body = (
      <div className="placeholder social-placeholder">
        <i className={`ti ${meta.icon}`} aria-hidden="true" />
        <h2>Set up {meta.name}</h2>
        <p>{meta.requirement} Open the connection setup below to get started.</p>
      </div>
    );
  } else {
    body = (
      <div className="placeholder social-placeholder">
        <i className={`ti ${meta.icon}`} aria-hidden="true" />
        <h2>No {meta.name} {meta.noun}s yet</h2>
        <p>
          {meta.requirement} Every {meta.noun} you connect becomes its own section in the sidebar — rename them to tell
          them apart.
        </p>
        <button className="btn btn--accent" onClick={onConnect} disabled={busy}><i className={`ti ${meta.icon}`} aria-hidden="true" /> Connect {meta.noun}</button>
      </div>
    );
  }

  return (
    <section className="social-section" aria-label={meta.name}>
      <div className="social-section-head">
        <div className="row" style={{ gap: 8 }}>
          <i className={`ti ${meta.icon}`} style={{ color: 'var(--text-secondary)' }} aria-hidden="true" />
          <span className="section-label">{meta.name}</span>
          {!error && ready && count > 0 && <span className="list-row-meta">{count} {count === 1 ? meta.noun : `${meta.noun}s`}</span>}
        </div>
        {count > 0 && (
          <button className="btn btn--sm" onClick={onConnect} disabled={busy || !ready}>
            <i className="ti ti-plus" aria-hidden="true" /> Connect another
          </button>
        )}
      </div>
      {body}
      {error && count > 0 && <p className="body-text" role="alert">{error}</p>}
      <SocialConnectionSetup platform={platform} setup={setup} onRetry={onRetry} busy={busy} />
    </section>
  );
}
