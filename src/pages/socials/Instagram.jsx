// ============================================================
// CTRLpanel — Socials → one Instagram account (`/socials/instagram/:id`)
// Each connected account is its own section: its own sidebar entry, page and
// name. Analytics are pulled on request (on load, range change, or Refresh).
// Instagram only serves ~30 days of account insights per request, so the ranges
// are short; anything Instagram doesn't return shows as "—" with a note.
// ============================================================
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import Card from '../../components/shared/Card.jsx';
import Spinner from '../../components/shared/Spinner.jsx';
import { useAuth } from '../../components/AuthProvider.jsx';
import { useWorkspace } from '../../components/WorkspaceProvider.jsx';
import { instagram } from '../../lib/api.js';
import { number, compactNumber, parseLocalDate } from '../../lib/helpers.js';
import { PLATFORMS, accountLabel, instagramAccountKind } from '../../lib/socialPlatforms.js';

const RANGES = [
  { id: '7d', label: '7d' },
  { id: '14d', label: '14d' },
  { id: '30d', label: '30d' },
];
const TIP = { background: 'var(--bg-elevated)', border: '1px solid var(--border-bright)', borderRadius: 8, fontSize: 12 };
const axis = { stroke: 'var(--text-secondary)', fontSize: 11, tickLine: false, axisLine: false };
// Series dates are plain YYYY-MM-DD — parse as local days, not UTC.
const fmtDay = (d) => parseLocalDate(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const fmtStamp = (t) => (t ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
const show = (v) => (v === null || v === undefined ? '—' : number(v));

function Stat({ label, icon, value, range }) {
  return (
    <Card className="stat-card">
      <div className="stat-card-head"><span className="section-label">{label}</span><i className={`ti ${icon}`} /></div>
      <div className="stat-card-value">{show(value)}</div>
      <div className="stat-card-meta">last {range}</div>
    </Card>
  );
}

export default function Instagram() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { socials } = useWorkspace();
  const { settings, updateUiPreferences } = useAuth();
  const [range, setRange] = useState('30d');
  const [response, setData] = useState(null);
  const request = useRef(0);
  const data = response?.id === id && response.range === range ? response.data : null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [avatarBroken, setAvatarBroken] = useState(false);
  const preferences = settings?.ui_preferences?.instagram || {};
  const ig = socials.instagram;

  useEffect(() => {
    if (RANGES.some((item) => item.id === preferences.range)) setRange(preferences.range);
  }, [preferences.range]);

  const loadAnalytics = useCallback(async (accountId, r) => {
    if (!accountId) return;
    const pending = ++request.current;
    setLoading(true);
    setError('');
    setData(null);
    try {
      const next = await instagram.analytics(accountId, r);
      if (pending === request.current) setData({ id: accountId, range: r, data: next });
    } catch (e) {
      if (pending === request.current) setError(e.message || 'Could not load analytics.');
    } finally {
      if (pending === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (id) loadAnalytics(id, range);
    return () => { request.current++; };
  }, [id, range, loadAnalytics]);

  const account = ig.accounts.find((a) => a.id === id);

  const rename = async () => {
    const next = prompt('Rename section', accountLabel('instagram', account));
    if (next === null) return;
    try {
      await ig.rename(id, next);
    } catch (e) {
      setError(e.message || 'Could not rename this section.');
    }
  };

  const disconnect = async () => {
    if (!account) return;
    if (!confirm(`Disconnect "${accountLabel('instagram', account)}"?`)) return;
    setLoading(true);
    setError('');
    try {
      await ig.disconnect(account.id);
      navigate('/socials');
    } catch (e) {
      setError(e.message || 'Could not disconnect account.');
      setLoading(false);
    }
  };

  const selectRange = (value) => {
    setRange(value);
    updateUiPreferences('instagram', { range: value }).catch(() => {});
  };

  const live = data?.account;
  const totals = data?.totals;
  const posts = data?.posts || [];
  const newFollowers = data?.hasFollowerSeries ? data.series.reduce((sum, p) => sum + (p.newFollowers || 0), 0) : null;
  const hasReachSeries = data?.series?.some((p) => p.reach !== null);
  const avatar = live?.profile_picture_url || account?.profile_picture_url;

  if (!socials.loaded) {
    return <div className="placeholder" style={{ minHeight: 240 }}><Spinner large /></div>;
  }
  if (!account) {
    return (
      <div className="placeholder">
        <i className="ti ti-brand-instagram" />
        <h2>Account not found</h2>
        <p>This section is no longer connected. Pick another one from the sidebar or connect an account.</p>
        <button className="btn" onClick={() => navigate('/socials')}><i className="ti ti-arrow-left" /> Back to Socials</button>
      </div>
    );
  }

  const view = live || account;
  const kind = instagramAccountKind(view.account_type);

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">{accountLabel('instagram', account)}</h1>
          <div className="page-header-sub">
            Instagram{account.label && account.username ? ` · @${account.username}` : ''} · analytics pulled on request
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={rename}><i className="ti ti-pencil" /> Rename</button>
          <button className="btn" onClick={() => loadAnalytics(id, range)} disabled={loading}>
            <i className={`ti ${loading ? 'ti-loader-2' : 'ti-refresh'}`} /> Refresh
          </button>
        </div>
      </div>

      {/* Account header + range */}
      <Card className="card-section" static>
        <div className="spread" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div className="row" style={{ gap: 12 }}>
            {avatar && !avatarBroken ? (
              <img src={avatar} alt="" className="yt-header-thumb" onError={() => setAvatarBroken(true)} referrerPolicy="no-referrer" />
            ) : (
              <span className="social-avatar-fallback"><i className={`ti ${PLATFORMS.instagram.icon}`} /></span>
            )}
            <div>
              <div className="value-md" style={{ color: 'var(--text-primary)' }}>{view.name || `@${view.username}`}</div>
              <div className="list-row-meta">
                @{view.username} · {number(view.followers_count)} followers · {number(view.follows_count)} following ·
                {' '}{number(view.media_count)} posts{kind ? ` · ${kind}` : ''}
              </div>
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <div className="segmented">
              {RANGES.map((r) => (
                <button key={r.id} className={range === r.id ? 'active' : ''} onClick={() => selectRange(r.id)}>{r.label}</button>
              ))}
            </div>
            <button className="btn btn--ghost btn--icon" title="Disconnect" onClick={disconnect} disabled={loading}>
              <i className="ti ti-plug-off" />
            </button>
          </div>
        </div>
      </Card>

      {error ? (
        <Card className="card-section" static>
          <p className="body-text" style={{ color: 'var(--accent)' }}><i className="ti ti-alert-triangle" /> {error}</p>
          <p className="list-row-meta mt-16">
            Instagram access lasts 60 days and renews whenever you open this page. If it lapsed or was revoked,
            disconnect and connect the account again from Socials.
          </p>
        </Card>
      ) : loading && !data ? (
        <div className="placeholder" style={{ minHeight: 200 }}><Spinner large /></div>
      ) : data ? (
        <>
          <div className="grid grid-3">
            <Stat label="Views" icon="ti-eye" value={totals.views} range={range} />
            <Stat label="Reach" icon="ti-radar-2" value={totals.reach} range={range} />
            <Stat label="Accounts engaged" icon="ti-hand-click" value={totals.accountsEngaged} range={range} />
            <Stat label="Interactions" icon="ti-heart-handshake" value={totals.interactions} range={range} />
            <Stat label="New followers" icon="ti-user-plus" value={newFollowers} range={range} />
            <Stat label="Profile link taps" icon="ti-link" value={totals.profileTaps} range={range} />
          </div>

          <Card className="card-section" static>
            <div className="card-section-title">Engagement breakdown</div>
            <div className="ig-breakdown">
              {[
                ['Likes', 'ti-heart', totals.likes],
                ['Comments', 'ti-message-circle', totals.comments],
                ['Shares', 'ti-send', totals.shares],
                ['Saves', 'ti-bookmark', totals.saves],
              ].map(([label, icon, value]) => (
                <div key={label} className="ig-breakdown-item">
                  <i className={`ti ${icon}`} />
                  <div className="ig-breakdown-num">{show(value)}</div>
                  <div className="dash2-yt-lbl">{label}</div>
                </div>
              ))}
            </div>
          </Card>

          {hasReachSeries && (
            <Card className="card-section" static>
              <div className="card-section-title">Reach per day</div>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={data.series} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="igReach" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" {...axis} tickFormatter={fmtDay} minTickGap={40} />
                  <YAxis {...axis} tickFormatter={(v) => compactNumber(v)} width={44} />
                  <Tooltip contentStyle={TIP} labelFormatter={fmtDay} formatter={(v) => [number(v), 'Reach']} />
                  <Area type="monotone" dataKey="reach" stroke="var(--accent)" strokeWidth={2} fill="url(#igReach)" connectNulls />
                </AreaChart>
              </ResponsiveContainer>
            </Card>
          )}

          {data.hasFollowerSeries && (
            <Card className="card-section" static>
              <div className="card-section-title">New followers per day</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.series} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" {...axis} tickFormatter={fmtDay} minTickGap={40} />
                  <YAxis {...axis} width={36} />
                  <Tooltip contentStyle={TIP} labelFormatter={fmtDay} formatter={(v) => [v, 'New followers']} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                  <Bar dataKey="newFollowers" fill="var(--accent)" radius={[3, 3, 0, 0]} maxBarSize={26} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}

          <Card className="card-section" static>
            <div className="card-section-title">Recent posts</div>
            {posts.length === 0 ? (
              <p className="list-row-meta">No posts to show yet.</p>
            ) : (
              <div className="ig-post-grid">
                {posts.map((p) => (
                  <a key={p.id} className="ig-post" href={p.permalink || undefined} target="_blank" rel="noopener noreferrer">
                    <div className="ig-post-thumb">
                      {p.thumbnail ? <img src={p.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <i className="ti ti-photo" />}
                      <span className="ig-post-badge">{p.type}</span>
                    </div>
                    <div className="ig-post-body">
                      <div className="ig-post-caption">{p.caption || 'No caption'}</div>
                      <div className="list-row-meta">{fmtStamp(p.timestamp)}</div>
                      <div className="ig-post-stats">
                        <span title="Reach"><i className="ti ti-radar-2" /> {show(p.reach)}</span>
                        <span title="Views"><i className="ti ti-eye" /> {show(p.views)}</span>
                        <span title="Likes"><i className="ti ti-heart" /> {show(p.likes)}</span>
                        <span title="Comments"><i className="ti ti-message-circle" /> {show(p.comments)}</span>
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </Card>

          {(data.notes.length > 0 || data.unavailable.length > 0) && (
            <Card className="card-section" static>
              {data.notes.map((n) => <p key={n} className="list-row-meta"><i className="ti ti-info-circle" /> {n}</p>)}
              {data.unavailable.length > 0 && (
                <p className="list-row-meta">
                  <i className="ti ti-info-circle" /> Instagram returned no data for: {data.unavailable.join(', ').replace(/_/g, ' ')}.
                </p>
              )}
            </Card>
          )}
          <p className="list-row-meta">Instagram can delay insights by up to 48 hours, so the latest days may look low.</p>
        </>
      ) : null}
    </div>
  );
}
