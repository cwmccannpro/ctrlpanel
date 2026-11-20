import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Card from './shared/Card.jsx';
import SocialContentList from './SocialContentList.jsx';
import YouTubePublications from './YouTubePublications.jsx';
import { socialSections, PLATFORMS } from '../lib/socialPlatforms.js';
import { socialApi } from '../lib/api.js';
import { number } from '../lib/helpers.js';

export default function SocialAnalyticsOverview({ socials }) {
  const sections = socialSections(socials);
  const key = sections.map(s => s.key).join('|');
  const [range, setRange] = useState('28d');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  useEffect(() => { request.current++; setResults(null); setLoading(false); return () => { request.current++; }; }, [key, range]);
  const load = async () => {
    const revision = ++request.current;
    setLoading(true);
    const settled = await Promise.allSettled(sections.map(s => socialApi[s.platform].analytics(s.id, range)));
    if (revision !== request.current) return;
    setResults(settled.map((r, i) => ({ section: sections[i], ...(r.status === 'fulfilled' ? { data: r.value } : { error: r.reason.message }) })));
    setLoading(false);
  };
  const show = value => value == null ? '—' : number(value);
  return <Card className="card-section social-overview" static>
    <div className="spread" style={{ gap: 12, flexWrap: 'wrap' }}>
      <h2 className="social-overview-title">Compare content performance</h2>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div className="segmented" aria-label="Analytics range">{['7d', '28d'].map(r => <button key={r} className={r === range ? 'active' : ''} aria-pressed={r === range} disabled={loading} onClick={() => setRange(r)}>{r}</button>)}</div>
        <button className="btn btn--accent" onClick={load} disabled={loading || !sections.length}><i className={`ti ${loading ? 'ti-loader-2' : 'ti-refresh'}`} aria-hidden="true" />{loading ? 'Loading…' : results ? 'Refresh analytics' : 'Load analytics'}</button>
      </div>
    </div>
    {!results ? (loading && <p className="social-overview-empty" role="status">Loading analytics…</p>)
        : <div className="social-performance-results">{results.map(({ section, data, error }) => {
          const platform = section.platform;
          const t = data?.totals || {};
          const audience = data?.channel?.subscribers ?? data?.account?.followers_count;
          return <div key={section.key} className="social-performance-account">
            <Link className="social-performance-name" to={section.to}><i className={`ti ${PLATFORMS[platform].icon}`} aria-hidden="true" />{section.label}<i className="ti ti-arrow-up-right" aria-hidden="true" /></Link>
            {error ? <p role="alert" className="body-text">{error}</p> : <>
              <div className="social-performance-stats">
                <span><strong>{show(audience)}</strong>{platform === 'youtube' ? 'Subscribers' : 'Followers'}</span>
                <span><strong>{show(platform === 'x' ? t.impressions : t.views)}</strong>{platform === 'x' ? 'Post impressions' : platform === 'tiktok' ? 'Video views' : `Views · ${range}`}</span>
                <span><strong>{show(platform === 'youtube' ? t.watchHours : platform === 'instagram' ? t.reach : t.likes)}</strong>{platform === 'youtube' ? `Watch hours · ${range}` : platform === 'instagram' ? `Reach · ${range}` : 'Post likes'}</span>
              </div>
              {platform === 'youtube'
                ? <YouTubePublications posts={(data.latestPosts || []).slice(0, 6)} notes={data.latestNotes} status={data.latestStatus} limit={6} compact />
                : <><p className="list-row-meta">{platform === 'instagram' ? 'Recent posts show lifetime insights. Account totals use the selected range.'
                  : `Lifetime metrics for ${platform === 'tiktok' ? 'public videos' : 'original posts'} published in the last ${range.slice(0, -1)} days.`}</p>
                  <SocialContentList platform={platform} posts={(data.posts || []).slice(0, 6)} /></>}
              {data.notes?.map(note => <p className="list-row-meta" key={note}>{note}</p>)}
              <Link className="btn btn--sm" to={section.to}>Open full analytics</Link>
            </>}
          </div>;
        })}</div>}
    {sections.some(s => s.platform === 'x') && <p className="list-row-meta">X requests use developer API credits. Analytics refresh only when you request them.</p>}
  </Card>;
}
