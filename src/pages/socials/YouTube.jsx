// ============================================================
// CTRLpanel — Socials → one YouTube channel (`/socials/youtube/:id`)
// Each connected channel is its own section: its own sidebar entry, its own
// page and its own name (renameable, so several channels stay apart). Nothing
// is hardcoded to a single channel; analytics are pulled on request (on load,
// range change, or Refresh).
// ============================================================
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import Card from '../../components/shared/Card.jsx';
import Spinner from '../../components/shared/Spinner.jsx';
import { useAuth } from '../../components/AuthProvider.jsx';
import { useWorkspace } from '../../components/WorkspaceProvider.jsx';
import { youtube } from '../../lib/api.js';
import { channelLabel, number, compactNumber } from '../../lib/helpers.js';

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
  const { id } = useParams();
  const navigate = useNavigate();
  const { socials } = useWorkspace();
  const { settings, updateUiPreferences } = useAuth();
  const [range, setRange] = useState('28d');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const preferences = settings?.ui_preferences?.youtube || {};

  useEffect(() => {
    if (RANGES.some((item) => item.id === preferences.range)) setRange(preferences.range);
  }, [preferences.range]);

  // Pull analytics on request (channel / range change).
  const loadAnalytics = useCallback(async (channelId, r) => {
    if (!channelId) return;
    setLoading(true);
    setError('');
    setData(null);
    try {
      setData(await youtube.analytics(channelId, r));
    } catch (e) {
      setError(e.message || 'Could not load analytics.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (id) loadAnalytics(id, range);
  }, [id, range, loadAnalytics]);

  const channel = socials.channels.find((c) => c.id === id);

  const rename = async () => {
    const next = prompt('Rename section', channelLabel(channel));
    if (next === null) return;
    try {
      await socials.rename(id, next);
    } catch (e) {
      setError(e.message || 'Could not rename this section.');
    }
  };

  const disconnect = async () => {
    if (!channel) return;
    if (!confirm(`Disconnect "${channelLabel(channel)}"?`)) return;
    setLoading(true);
    setError('');
    try {
      await socials.disconnect(channel.id);
      navigate('/socials');
    } catch (e) {
      setError(e.message || 'Could not disconnect channel.');
      setLoading(false);
    }
  };

  const selectRange = (value) => {
    setRange(value);
    updateUiPreferences('youtube', { range: value }).catch(() => {});
  };

  const ch = data?.channel;
  const totals = data?.totals;
  const title = channelLabel(channel || ch);

  // The channel list is loaded once, app-wide (WorkspaceProvider).
  if (!socials.loaded) {
    return <div className="placeholder" style={{ minHeight: 240 }}><Spinner large /></div>;
  }
  if (!channel) {
    return (
      <div className="placeholder">
        <i className="ti ti-brand-youtube" />
        <h2>Channel not found</h2>
        <p>This section is no longer connected. Pick another one from the sidebar or connect a channel.</p>
        <button className="btn" onClick={() => navigate('/socials')}><i className="ti ti-arrow-left" /> Back to Socials</button>
      </div>
    );
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">{title}</h1>
          <div className="page-header-sub">
            YouTube{channel.label ? ` · ${channel.title}` : ''} · analytics pulled on request
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={rename}><i className="ti ti-pencil" /> Rename</button>
          <button className="btn" onClick={() => loadAnalytics(id, range)} disabled={loading}>
            <i className={`ti ${loading ? 'ti-loader-2' : 'ti-refresh'}`} /> Refresh
          </button>
        </div>
      </div>

      {/* Channel header + range */}
      <Card className="card-section" static>
        <div className="spread" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div className="row" style={{ gap: 12 }}>
            {(ch?.thumbnail || channel.thumbnail) && (
              <img src={ch?.thumbnail || channel.thumbnail} alt="" className="yt-header-thumb" />
            )}
            <div>
              <div className="value-md" style={{ color: 'var(--text-primary)' }}>{ch?.title || channel.title}</div>
              <div className="list-row-meta">
                {number(ch?.subscribers ?? channel.subscriber_count ?? 0)} subscribers ·
                {' '}{number(ch?.videoCount ?? channel.video_count ?? 0)} videos ·
                {' '}{compactNumber(ch?.totalViews ?? channel.view_count ?? 0)} total views
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
    </div>
  );
}
