import { useEffect, useState } from 'react';
import Card from './shared/Card.jsx';
import { aiApi } from '../lib/api.js';

const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const count = (n) => String(Math.round(Number(n) || 0));

function Meter({ label, used, max, format }) {
  const filled = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 100;
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="spread" style={{ fontSize: 12, marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ color: 'var(--text-secondary)' }}>{format(used)} of {format(max)}</span>
      </div>
      <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={filled}>
        <div className="progress-fill" style={{ width: `${filled}%`, background: filled >= 90 ? 'var(--accent)' : 'var(--text-secondary)' }} />
      </div>
    </div>
  );
}

// Today's AI use on the server's Anthropic key, against the per-user daily limits.
export default function AiUsage() {
  const [usage, setUsage] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    aiApi.usage().then((u) => live && setUsage(u)).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, []);

  const shared = usage?.server_key && usage?.allowed;
  return (
    <Card className="card-section" static>
      <div className="card-section-title">AI usage today</div>
      {error && <p className="body-text">Could not load AI usage: {error}</p>}
      {!error && !usage && <p className="body-text">Loading…</p>}
      {usage && (
        <>
          <p className="body-text" style={{ marginBottom: 12 }}>
            {!usage.server_key
              ? 'This server has no shared Anthropic key, so AI features use the key you add under Connectors.'
              : !usage.allowed
                ? 'Your account is not approved to use the shared Anthropic key. Add your own key under Connectors.'
                : 'Limits for AI that runs on the shared Anthropic key. Anything you run with your own key under Connectors is not counted.'}
          </p>
          {shared && (
            <>
              <Meter label="Spend" used={usage.cost_usd} max={usage.limits.daily_usd} format={usd} />
              <Meter label="Requests" used={usage.requests} max={usage.limits.daily_requests} format={count} />
              <p className="body-text muted" style={{ fontSize: 12 }}>
                Resets at 00:00 UTC.{usage.persistent ? '' : ' Counts are not saved between server restarts until the AI usage migration is applied.'}
              </p>
            </>
          )}
        </>
      )}
    </Card>
  );
}
