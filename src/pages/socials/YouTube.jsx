// ============================================================
// CTRLpanel — Socials → YouTube
// Full analytics for the user's connected YouTube channel(s). Nothing is
// hardcoded: the channel list comes from whatever Google account(s) the user
// connects, and the page is modular for multiple channels. Analytics are
// pulled on request (on load, channel/range change, or Refresh).
// ============================================================
import { useState, useEffect, useCallback } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import Card from '../../components/shared/Card.jsx';
import Spinner from '../../components/shared/Spinner.jsx';
import { useAuth } from '../../components/AuthProvider.jsx';
import { youtube } from '../../lib/api.js';
import { number, compactNumber } from '../../lib/helpers.js';

const RANGES = [
  { id: '7d', label: '7d' },
  { id: '28d', label: '28d' },
  { id: '90d', label: '90d' },
  { id: '365d', label: '1y' },
];
const TIP = { background: 'var(--bg-elevated)', border: '1px solid var(--border-bright)', borderRadius: 8, fontSize: 12 };
const axis = { stroke: 'var(--text-secondary)', fontSize: 11, tickLine: false, axisLine: false };
const fmtDay = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export default function YouTube() {
  const { settings, updateUiPreferences } = useAuth();
  const [state, setState] = useState({ ready: false, channels: [], loaded: false, error: '' });
  const [selected, setSelected] = useState(null);
  const [range, setRange] = useState('28d');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const preferences = settings?.ui_preferences?.youtube || {};

  useEffect(() => {
    if (RANGES.some((item) => item.id === preferences.range)) setRange(preferences.range);
    if (preferences.channel_id) setSelected((current) => current || preferences.channel_id);
  }, [preferences.channel_id, preferences.range]);

  const loadStatus = useCallback(async () => {
    try {
      const s = await youtube.status();
      setState({ ready: !!s.ready, channels: s.channels || [], loaded: true, error: '' });
      setSelected((current) =>
        s.channels?.some((channel) => channel.id === current) ? current : s.channels?.[0]?.id || null
      );
    } catch (e) {
      setState((p) => ({ ...p, loaded: true, error: e.message || 'Could not reach the YouTube integration.' }));
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const params = new URLSearchParams(window.location.search);
    if (params.get('youtube') === 'connected') setNotice('Channel connected.');
    if (params.get('youtube') === 'error') setNotice(`Connection failed: ${params.get('message') || 'unknown error'}`);
    if (params.get('youtube')) window.history.replaceState({}, '', '/socials/youtube');
  }, [loadStatus]);

  // Pull analytics on request (channel / range change).
  const loadAnalytics = useCallback(async (id, r) => {
    if (!id) return;
    setLoading(true);
    setError('');
    setData(null);
    try {
      setData(await youtube.analytics(id, r));
    } catch (e) {
      setError(e.message || 'Could not load analytics.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selected) loadAnalytics(selected, range);
  }, [selected, range, loadAnalytics]);

  const disconnect = async (ch) => {
    if (!ch) return;
    if (!confirm(`Disconnect "${ch.title}"?`)) return;
    setLoading(true);
    setError('');
    try {
      await youtube.disconnect(ch.id);
      if (selected === ch.id) { setSelected(null); setData(null); }
      updateUiPreferences('youtube', { channel_id: null }).catch(() => {});
      await loadStatus();
      setNotice('Channel disconnected.');
    } catch (e) {
      setError(e.message || 'Could not disconnect channel.');
    } finally {
      setLoading(false);
    }
  };

  const ch = data?.channel;
  const totals = data?.totals;
  const selectedChannel = state.channels.find((c) => c.id === selected);
  const noticeIsError = notice.startsWith('Connection failed');
  const selectChannel = (id) => {
    setSelected(id);
    updateUiPreferences('youtube', { channel_id: id }).catch(() => {});
  };
  const selectRange = (value) => {
    setRange(value);
    updateUiPreferences('youtube', { range: value }).catch(() => {});
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">YouTube</h1>
          <div className="page-header-sub">Channel analytics · pulled from YouTube on request</div>
        </div>
        <div className="row">
          {state.channels.length > 0 && (
            <button className="btn" onClick={() => selected && loadAnalytics(selected, range)} disabled={loading}>
              <i className={`ti ${loading ? 'ti-loader-2' : 'ti-refresh'}`} /> Refresh
            </button>
          )}
          {state.ready && (
            <button className="btn btn--accent" onClick={() => youtube.connect()}>
              <i className="ti ti-brand-youtube" /> {state.channels.length ? 'Connect another' : 'Connect channel'}
            </button>
          )}
        </div>
      </div>

      {notice && (
        <Card className={`yt-notice ${noticeIsError ? 'is-error' : ''}`} static>
          <i className={`ti ${noticeIsError ? 'ti-alert-triangle' : 'ti-circle-check'}`} />
          <span>{notice}</span>
          <button className="btn btn--ghost btn--icon" onClick={() => setNotice('')} aria-label="Dismiss"><i className="ti ti-x" /></button>
        </Card>
      )}

      {!state.loaded ? (
        <div className="placeholder" style={{ minHeight: 200 }}><Spinner large /></div>
      ) : state.error ? (
        <div className="placeholder">
          <i className="ti ti-cloud-off" />
          <h2>Couldn’t load YouTube</h2>
          <p>{state.error}</p>
          <button className="btn" onClick={loadStatus}><i className="ti ti-refresh" /> Retry</button>
        </div>
      ) : !state.ready ? (
        <div className="placeholder">
          <i className="ti ti-brand-youtube" />
          <h2>YouTube isn’t configured on the server</h2>
          <p>
            Set the Google OAuth env vars and enable the <strong>YouTube Data API v3</strong> and
            <strong> YouTube Analytics API</strong> in Google Cloud, then add the YouTube read-only scopes to the
            consent screen (see .env.example).
          </p>
        </div>
      ) : state.channels.length === 0 ? (
        <div className="placeholder">
          <i className="ti ti-brand-youtube" />
          <h2>Connect your channel</h2>
          <p>Sign in with the Google account that owns your YouTube channel to pull its analytics here. You can connect more channels later.</p>
          <button className="btn btn--accent" onClick={() => youtube.connect()}><i className="ti ti-brand-youtube" /> Connect channel</button>
        </div>
      ) : (
        <>
          {/* Channel picker (modular for multiple channels) */}
          {state.channels.length > 1 && (
            <div className="yt-channels">
              {state.channels.map((c) => (
                <button key={c.id} className={`yt-channel-chip ${selected === c.id ? 'active' : ''}`} onClick={() => selectChannel(c.id)}>
                  {c.thumbnail && <img src={c.thumbnail} alt="" className="yt-channel-thumb" />}
                  <span className="yt-channel-name">{c.title}</span>
                </button>
              ))}
            </div>
          )}

          {/* Channel header + range */}
          <Card className="card-section" static>
            <div className="spread" style={{ flexWrap: 'wrap', gap: 12 }}>
              <div className="row" style={{ gap: 12 }}>
                {ch?.thumbnail && <img src={ch.thumbnail} alt="" className="yt-header-thumb" />}
                <div>
                  <div className="value-md" style={{ color: 'var(--text-primary)' }}>{ch?.title || selectedChannel?.title}</div>
                  <div className="list-row-meta">
                    {number(ch?.subscribers ?? selectedChannel?.subscriber_count ?? 0)} subscribers ·
                    {' '}{number(ch?.videoCount ?? selectedChannel?.video_count ?? 0)} videos ·
                    {' '}{compactNumber(ch?.totalViews ?? selectedChannel?.view_count ?? 0)} total views
                  </div>
                </div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <div className="segmented">
                  {RANGES.map((r) => (
                    <button key={r.id} className={range === r.id ? 'active' : ''} onClick={() => selectRange(r.id)}>{r.label}</button>
                  ))}
                </div>
                <button className="btn btn--ghost btn--icon" title="Disconnect" onClick={() => disconnect(selectedChannel)} disabled={loading}>
                  <i className="ti ti-plug-off" />
                </button>
              </div>
            </div>
          </Card>

          {error ? (
            <Card className="card-section" static>
              <p className="body-text" style={{ color: 'var(--accent)' }}><i className="ti ti-alert-triangle" /> {error}</p>
              <p className="list-row-meta mt-16">If this is the first connect, make sure the YouTube Data API v3 and YouTube Analytics API are enabled in Google Cloud and the read-only scopes were granted.</p>
            </Card>
          ) : loading && !data ? (
            <div className="placeholder" style={{ minHeight: 200 }}><Spinner large /></div>
          ) : totals ? (
            <>
              <div className="grid grid-3">
                <Card className="stat-card"><div className="stat-card-head"><span className="section-label">Views</span><i className="ti ti-eye" /></div><div className="stat-card-value">{number(totals.views)}</div><div className="stat-card-meta">last {range}</div></Card>
                <Card className="stat-card"><div className="stat-card-head"><span className="section-label">Watch time</span><i className="ti ti-clock" /></div><div className="stat-card-value">{number(totals.watchHours)}<span style={{ fontSize: 14 }}> hrs</span></div><div className="stat-card-meta">last {range}</div></Card>
                <Card className="stat-card"><div className="stat-card-head"><span className="section-label">Net subscribers</span><i className="ti ti-users" /></div><div className={`stat-card-value ${totals.netSubs >= 0 ? 'text-green' : 'text-red'}`}>{totals.netSubs >= 0 ? '+' : ''}{number(totals.netSubs)}</div><div className="stat-card-meta">last {range}</div></Card>
              </div>

              <Card className="card-section" static>
                <div className="card-section-title">Views per day</div>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={data.series} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="ytViews" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="date" {...axis} tickFormatter={fmtDay} minTickGap={40} />
                    <YAxis {...axis} tickFormatter={(v) => compactNumber(v)} width={44} />
                    <Tooltip contentStyle={TIP} labelFormatter={fmtDay} formatter={(v) => [number(v), 'Views']} />
                    <Area type="monotone" dataKey="views" stroke="var(--accent)" strokeWidth={2} fill="url(#ytViews)" />
                  </AreaChart>
                </ResponsiveContainer>
              </Card>

              <Card className="card-section" static>
                <div className="card-section-title">Subscribers gained per day (net)</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data.series} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="date" {...axis} tickFormatter={fmtDay} minTickGap={40} />
                    <YAxis {...axis} width={36} />
                    <Tooltip contentStyle={TIP} labelFormatter={fmtDay} formatter={(v) => [v, 'Net subs']} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Bar dataKey="subs" fill="var(--accent)" radius={[3, 3, 0, 0]} maxBarSize={26} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
