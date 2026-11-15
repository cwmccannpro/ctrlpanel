import { useState } from 'react';
import Modal from './shared/Modal.jsx';
import { ical } from '../lib/api.js';
import { FEED_COLORS, MAX_FEEDS, feedHost, feedName, makeFeed, parseFeedUrl } from '../lib/icalFeeds.js';

const DAY = 86400000;

/**
 * Manage the read-only .ics feeds behind the Calendar page. A new feed is
 * fetched once before it is saved, so a typo or a private link fails here
 * instead of silently showing an empty calendar.
 */
export default function CalendarFeeds({ feeds, health, onSave, onClose }) {
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(null);

  const add = async (e) => {
    e.preventDefault();
    setError('');
    const parsed = parseFeedUrl(url);
    if (parsed.error) return setError(parsed.error);
    if (feeds.some((f) => f.url === parsed.url)) return setError('That feed is already added.');
    const draft = makeFeed({ url: parsed.url, label }, feeds);
    setBusy(true);
    try {
      const now = Date.now();
      const res = await ical.events([draft], { timeMin: new Date(now).toISOString(), timeMax: new Date(now + 30 * DAY).toISOString() });
      const status = res.feeds?.[0];
      if (!status?.ok) throw new Error(status?.error || 'That feed couldn’t be read.');
      // Use the calendar's own colour from iCloud when it sends one.
      const feed = status.suggestedColor ? makeFeed({ url: parsed.url, label, color: status.suggestedColor }, feeds) : draft;
      await onSave([...feeds, feed]);
      setUrl('');
      setLabel('');
    } catch (err) {
      setError(err.message || 'That feed couldn’t be added.');
    } finally {
      setBusy(false);
    }
  };

  const recolor = async (id, color) => {
    setError('');
    setPicking(null);
    try {
      await onSave(feeds.map((f) => (f.id === id ? { ...f, color } : f)));
    } catch (err) {
      setError(err.message || 'Couldn’t change that colour.');
    }
  };

  const remove = async (id) => {
    setError('');
    try {
      await onSave(feeds.filter((f) => f.id !== id));
    } catch (err) {
      setError(err.message || 'Couldn’t remove that feed.');
    }
  };

  return (
    <Modal title="Calendar feeds" onClose={onClose}>
      <div className="calendar-feeds">
        <p className="calendar-feeds-help">
          Read-only. Add any public calendar link (<code>.ics</code> / <code>webcal://</code>). For iCloud: in the Calendar app, share
          the calendar, turn on <strong>Public Calendar</strong>, and copy the link. Anyone with the link can read that calendar, so
          keep it private; iCloud refreshes it every so often, so changes can take a few minutes to appear.
        </p>

        {feeds.length > 0 && (
          <ul className="calendar-feeds-list">
            {feeds.map((f) => {
              const h = health?.[f.id];
              return (
                <li key={f.id}>
                  <button className="calendar-feeds-swatch-btn" style={{ '--c': f.color }} aria-label={`Change colour for ${feedName(f)}`} aria-expanded={picking === f.id} onClick={() => setPicking(picking === f.id ? null : f.id)}><i /></button>
                  <div>
                    <strong>{feedName(f)}</strong>
                    <small className={h && !h.ok ? 'calendar-feeds-bad' : ''}>
                      {h && !h.ok ? h.error : feedHost(f.url)}
                    </small>
                  </div>
                  <button className="btn btn--ghost btn--icon" aria-label={`Remove ${feedName(f)}`} onClick={() => remove(f.id)}>
                    <i className="ti ti-trash" />
                  </button>
                  {picking === f.id && (
                    <div className="calendar-feeds-palette" role="group" aria-label="Feed colour">
                      {FEED_COLORS.map((c) => <button key={c} style={{ '--c': c }} aria-label={c} aria-pressed={c === f.color} onClick={() => recolor(f.id, c)} />)}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {feeds.length < MAX_FEEDS ? (
          <form className="calendar-feeds-form" onSubmit={add}>
            <input className="input" placeholder="webcal://… or https://….ics" value={url} onChange={(e) => setUrl(e.target.value)} autoComplete="off" spellCheck={false} aria-label="Calendar feed link" />
            <input className="input" placeholder="Name (optional)" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} aria-label="Feed name" />
            <button className="btn btn--accent" disabled={busy || !url.trim()}>{busy ? 'Checking…' : 'Add feed'}</button>
          </form>
        ) : (
          <p className="calendar-feeds-help">You’ve reached the {MAX_FEEDS}-feed limit.</p>
        )}
        {error && <p className="calendar-feeds-bad" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
