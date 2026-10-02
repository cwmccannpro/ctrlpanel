import { Component, useEffect } from 'react';
import { useRouteError } from 'react-router-dom';
import { describeError, isChunkLoadError, shouldAutoReload } from '../lib/errors.js';
import '../styles/overlays.css';

const RELOAD_KEY = 'ctrlpanel-chunk-reload';

// After a deploy an open tab asks for page files that no longer exist. Reload once
// to pick up the new build; never twice within 30s so a truly broken file can't loop.
function tryAutoReload() {
  try {
    if (!shouldAutoReload(Date.now(), sessionStorage.getItem(RELOAD_KEY))) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}

export function ErrorPanel({ error, onRetry, full = false }) {
  const d = describeError(error);
  return (
    <div className={`error-panel ${full ? 'error-panel--full' : ''}`} role="alert">
      <i className="ti ti-alert-triangle" />
      <h2>{d.title}</h2>
      <p>{d.message}</p>
      <div className="row" style={{ gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        {/* A failed lazy import is cached by React, so only a reload can recover it. */}
        {onRetry && !d.chunk && <button className="btn" onClick={onRetry}><i className="ti ti-refresh" /> Try again</button>}
        <button className="btn btn--accent" onClick={() => window.location.reload()}>Reload</button>
        <a className="btn btn--ghost" href="/">Go to Today</a>
      </div>
      {error?.message && (
        <details className="error-details">
          <summary>Technical details</summary>
          <pre>{String(error.stack || error.message).slice(0, 1500)}</pre>
        </details>
      )}
    </div>
  );
}

/**
 * Keeps one crashing page from taking the whole app down: the sidebar, topbar and
 * command palette stay usable. Navigating elsewhere (a new `resetKey`) clears the error.
 */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[CTRLpanel] a page crashed:', error, info?.componentStack);
    if (isChunkLoadError(error)) tryAutoReload();
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <ErrorPanel error={this.state.error} onRetry={() => this.setState({ error: null })} />;
  }
}

/** React Router `errorElement`: the last line of defence when the shell itself fails. */
export function RouteError() {
  const error = useRouteError();
  useEffect(() => {
    console.error('[CTRLpanel] route error:', error);
    if (isChunkLoadError(error)) tryAutoReload();
  }, [error]);
  return (
    <div className="error-page">
      <ErrorPanel error={error} full />
    </div>
  );
}
