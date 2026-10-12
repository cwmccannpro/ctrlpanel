import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useWorkspace } from './WorkspaceProvider.jsx';
import { instagram } from '../lib/api.js';
import { accountLabel } from '../lib/socialPlatforms.js';
import { compactNumber } from '../lib/helpers.js';

export default function InstagramPanel({ cfg = {}, onCfg = () => {} }) {
  const { socials } = useWorkspace();
  const ig = socials.instagram;
  const account = ig.accounts.find((item) => item.id === cfg.accountId) || ig.accounts[0];
  const accountId = account?.id;
  const range = ['7d', '14d', '30d'].includes(cfg.range) ? cfg.range : '30d';
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState(null);
  useEffect(() => {
    if (!accountId) return;
    let active = true;
    setResponse({ id: accountId, range, loading: true });
    instagram.analytics(accountId, range)
      .then((data) => active && setResponse({ id: accountId, range, data }))
      .catch(() => active && setResponse({ id: accountId, range, error: true }));
    return () => { active = false; };
  }, [accountId, range, revision]);
  const current = response?.id === accountId && response.range === range ? response : null;
  const data = current?.data;
  const show = (value) => value == null ? '—' : compactNumber(value);
  const path = accountId ? `/socials/instagram/${accountId}` : '/socials';

  return <>
    <div className="dash2-panel-head dash2-panel-head--wrap">
      <Link className="dash2-panel-title dash2-link" to={path}>Instagram</Link>
      {accountId && <button className="btn btn--sm btn--ghost btn--icon" onClick={() => setRevision((value) => value + 1)} disabled={!current || current.loading} aria-label="Refresh Instagram analytics"><i className="ti ti-refresh" aria-hidden="true" /></button>}
    </div>
    {!socials.loaded ? <p className="dash2-panel-note" role="status">Loading accounts…</p>
      : !account ? <><p className="dash2-panel-note">{ig.error ? 'Instagram couldn’t load. Open Socials to check the connection.' : ig.ready ? 'Connect an Instagram Business or Creator account to see its analytics.' : 'Set up Instagram in Socials to see its analytics here.'}</p><Link className="btn btn--sm" to="/socials">Open Socials</Link></>
        : <>
          <label className="dash2-panel-setting">Account
            <select className="dash2-select" value={accountId} onChange={(event) => onCfg({ accountId: event.target.value })}>
              {ig.accounts.map((item) => <option key={item.id} value={item.id}>{accountLabel('instagram', item)}</option>)}
            </select>
          </label>
          <div className="segmented segmented--xs dash2-instagram-range" aria-label="Instagram analytics range">
            {['7d', '14d', '30d'].map((value) => <button key={value} className={value === range ? 'active' : ''} aria-pressed={value === range} onClick={() => onCfg({ range: value })}>{value}</button>)}
          </div>
          <div className="dash2-yt-stats">
            <div><span className="dash2-yt-num">{show(data?.account?.followers_count ?? account.followers_count)}</span><span className="dash2-yt-lbl">followers</span></div>
            <div><span className="dash2-yt-num">{show(data?.totals?.views)}</span><span className="dash2-yt-lbl">views {range}</span></div>
            <div><span className="dash2-yt-num">{show(data?.totals?.reach)}</span><span className="dash2-yt-lbl">reach {range}</span></div>
          </div>
          {!current || current.loading ? <p className="dash2-panel-note" role="status">Loading analytics…</p>
            : current.error ? <p className="dash2-panel-note" role="alert">Analytics couldn’t load. Refresh or open the account to reconnect.</p>
              : <p className="dash2-panel-note">{data?.notes?.length ? 'Some insights are unavailable. Open the account for details.' : `Last ${range.replace('d', ' days')} · ${show(data?.totals?.accountsEngaged)} accounts engaged`}</p>}
          <div className="dash2-panel-actions"><Link className="btn btn--sm" to={path}>Open account</Link></div>
        </>}
  </>;
}
