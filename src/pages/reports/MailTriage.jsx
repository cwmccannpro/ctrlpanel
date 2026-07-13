// ============================================================
// CTRLpanel — Reports → Mail Triage
// The combined Email Triage brief: connected accounts, agent arm/disarm +
// "Run now", and the latest run's items grouped by account, needs-reply
// first. Suggested replies are reviewed here; "Approve → Create draft"
// makes a native Gmail draft in the source account — sending always
// happens in Gmail, never from CTRLpanel.
// ============================================================
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Card from '../../components/shared/Card.jsx';
import { useWorkspace } from '../../components/WorkspaceProvider.jsx';
import { queryTable } from '../../lib/supabase.js';
import { gmail } from '../../lib/api.js';

export const CATEGORY_META = {
  needs_reply: { label: 'Needs reply', icon: 'ti-mail-forward', color: 'var(--accent)' },
  client_lead: { label: 'Client / lead', icon: 'ti-user-star', color: '#3b82f6' },
  payments: { label: 'Payments', icon: 'ti-receipt', color: '#f59e0b' },
  ignore: { label: 'Ignore', icon: 'ti-mail-off', color: 'var(--text-secondary)' },
};
const CATEGORY_ORDER = ['needs_reply', 'client_lead', 'payments', 'ignore'];

export function CategoryBadge({ category }) {
  const meta = CATEGORY_META[category] || CATEGORY_META.ignore;
  return (
    <span
      className="badge"
      style={{ color: meta.color, borderColor: meta.color, flexShrink: 0 }}
      title={meta.label}
    >
      <i className={`ti ${meta.icon}`} style={{ marginRight: 4 }} />
      {meta.label}
    </span>
  );
}

const runLabel = (r) =>
  `${new Date(r.run_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${r.source} · ${r.emails_scanned} emails`;

const TRIAGE_AGENT_DEFAULTS = {
  name: 'Email Triage',
  description:
    'Scans unread mail across your connected Gmail accounts every morning, categorizes it, and drafts suggested replies for review. Never sends anything.',
  status: 'running',
  webhook_url: null,
  config: { type: 'email_triage', schedule_hour: 13 },
};

function TriageItem({ item, onDraft }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canDraft = item.category === 'needs_reply' && item.suggested_reply;

  const approve = async () => {
    setBusy(true);
    setError('');
    try {
      await onDraft(item);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ borderBottom: '1px solid var(--border)', padding: '8px 0' }}>
      <div
        className="list-row"
        style={{ border: 'none', padding: 0, cursor: canDraft ? 'pointer' : 'default' }}
        onClick={() => canDraft && setOpen((o) => !o)}
      >
        <CategoryBadge category={item.category} />
        <div className="list-row-title" style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.subject || '(no subject)'}
          </span>
          <span className="list-row-meta">
            {[item.from_name || item.from_email, item.summary].filter(Boolean).join('  ·  ')}
          </span>
        </div>
        {item.draft_id && (
          <span className="badge badge--green" style={{ flexShrink: 0 }}>
            <i className="ti ti-check" style={{ marginRight: 4 }} /> Draft created
          </span>
        )}
        {canDraft && (
          <i className={`ti ti-chevron-${open ? 'up' : 'down'}`} style={{ color: 'var(--text-secondary)' }} />
        )}
      </div>

      {open && canDraft && (
        <div
          style={{
            margin: '8px 0 4px 8px',
            padding: '10px 12px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <div className="section-label" style={{ marginBottom: 6 }}>Suggested reply</div>
          <p className="body-text" style={{ whiteSpace: 'pre-wrap', color: 'var(--text-primary)' }}>
            {item.suggested_reply}
          </p>
          <div className="row" style={{ marginTop: 10, gap: 8 }}>
            {item.draft_id ? (
              <span className="list-row-meta">
                <i className="ti ti-check" /> Draft is waiting in Gmail ({item.account_alias}) — review and send it there.
              </span>
            ) : (
              <button className="btn btn--accent btn--sm" onClick={approve} disabled={busy}>
                <i className="ti ti-mail-plus" /> {busy ? 'Creating…' : 'Approve → Create draft'}
              </button>
            )}
            {error && <span className="list-row-meta" style={{ color: 'var(--accent)' }}>{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MailTriage() {
  const { agents } = useWorkspace();
  const triageAgent = agents.rows.find((a) => a.config?.type === 'email_triage');

  const [accounts, setAccounts] = useState([]);
  const [ready, setReady] = useState(true);
  const [runs, setRuns] = useState([]);
  const [runId, setRunId] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState('');

  const loadRuns = useCallback(async (selectNewest = false) => {
    const { data } = await queryTable('triage_runs', { order: 'run_at', ascending: false, limit: 20 });
    const list = Array.isArray(data) ? data : [];
    setRuns(list);
    setRunId((prev) => (selectNewest || !prev ? list[0]?.id || null : prev));
    setLoading(false);
  }, []);

  useEffect(() => {
    loadRuns();
    gmail
      .status()
      .then((s) => { setAccounts(s.accounts || []); setReady(!!s.ready); })
      .catch(() => {});
  }, [loadRuns]);

  useEffect(() => {
    if (!runId) { setItems([]); return; }
    queryTable('triage_items', { filters: { run_id: runId }, order: 'received_at', ascending: false, limit: 400 })
      .then(({ data }) => setItems(Array.isArray(data) ? data : []));
  }, [runId]);

  const run = runs.find((r) => r.id === runId) || null;

  // Toggle ON arms the schedule (creates the agent on first use); OFF disarms.
  const toggleAgent = async () => {
    if (!triageAgent) {
      await agents.add({ ...TRIAGE_AGENT_DEFAULTS });
      return;
    }
    agents.patch(triageAgent.id, { status: triageAgent.status === 'running' ? 'stopped' : 'running' });
  };

  const setScheduleHour = (hour) => {
    if (!triageAgent) return;
    agents.patch(triageAgent.id, { config: { ...triageAgent.config, schedule_hour: Number(hour) } });
  };

  const runNow = async () => {
    setRunning(true);
    setNotice('');
    try {
      const res = await gmail.runNow();
      setNotice(`Scanned ${res.emails_scanned} emails across ${res.accounts_scanned} account${res.accounts_scanned === 1 ? '' : 's'} — ${res.needs_reply} need a reply.${res.errors?.length ? ` (${res.errors.join(' · ')})` : ''}`);
      await loadRuns(true);
    } catch (e) {
      setNotice(e.message);
    } finally {
      setRunning(false);
    }
  };

  const createDraft = async (item) => {
    const res = await gmail.createDraft(item.id);
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, draft_id: res.draft_id } : i)));
  };

  // Brief structure: account → category → items (needs_reply first).
  const aliases = [...new Set(items.map((i) => i.account_alias || 'unknown'))].sort();
  const counts = CATEGORY_ORDER.map((c) => ({ c, n: items.filter((i) => i.category === c).length }));
  const scheduleHour = Number(triageAgent?.config?.schedule_hour ?? 13);
  const localTime = new Date(Date.UTC(2000, 0, 1, scheduleHour)).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  return (
    <div className="fade-in" style={{ maxWidth: 900 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Mail Triage</h1>
          <div className="page-header-sub">
            {accounts.length
              ? `${accounts.length} Gmail account${accounts.length === 1 ? '' : 's'} connected · ${accounts.map((a) => a.alias).join(', ')}`
              : 'Daily email brief across your Gmail accounts'}
          </div>
        </div>
        <button className="btn btn--accent" onClick={runNow} disabled={running || !accounts.length}>
          <i className={`ti ${running ? 'ti-loader-2' : 'ti-refresh'}`} /> {running ? 'Scanning…' : 'Run now'}
        </button>
      </div>

      {/* Agent control */}
      <Card className="card-section" static style={{ marginBottom: 16 }}>
        <div className="spread">
          <div>
            <div className="section-label">Email Triage agent</div>
            <div className="value-md" style={{ color: triageAgent?.status === 'running' ? 'var(--accent)' : 'var(--text-secondary)' }}>
              {triageAgent ? (triageAgent.status === 'running' ? 'Armed' : 'Off') : 'Not set up'}
            </div>
          </div>
          <div className="row gap-16">
            {triageAgent && (
              <div className="row" style={{ gap: 6 }}>
                <span className="list-row-meta">Daily at</span>
                <select
                  className="input"
                  style={{ width: 110 }}
                  value={scheduleHour}
                  onChange={(e) => setScheduleHour(e.target.value)}
                >
                  {Array.from({ length: 24 }).map((_, h) => (
                    <option key={h} value={h}>{`${h}:00 UTC`}</option>
                  ))}
                </select>
                <span className="list-row-meta">({localTime} local)</span>
              </div>
            )}
            <div className={`switch ${triageAgent?.status === 'running' ? 'on' : ''}`} onClick={toggleAgent} />
          </div>
        </div>
        <p className="list-row-meta mt-16">
          When armed, unread mail from the last 24h is scanned daily across every connected account, categorized, and
          summarized here. Suggested replies wait for your approval — nothing is ever sent automatically. Manage
          accounts in <Link to="/settings" style={{ color: 'var(--accent)' }}>Settings → Gmail Accounts</Link>.
        </p>
        {notice && <p className="list-row-meta mt-16" style={{ color: 'var(--text-primary)' }}>{notice}</p>}
        {!ready && <p className="list-row-meta mt-16">Gmail is not configured on the server (.env) yet.</p>}
      </Card>

      {/* Brief */}
      {loading ? (
        <p className="list-row-meta">Loading…</p>
      ) : !runs.length ? (
        <div className="placeholder">
          <i className="ti ti-mailbox" />
          <h2>No triage runs yet</h2>
          <p>
            {accounts.length
              ? 'Press "Run now" to scan your unread mail, or arm the agent and the morning brief will land here.'
              : 'Connect a Gmail account in Settings → Gmail Accounts, then run your first triage.'}
          </p>
          {!accounts.length && (
            <Link to="/settings" className="btn btn--accent"><i className="ti ti-brand-gmail" /> Connect Gmail</Link>
          )}
        </div>
      ) : (
        <>
          <div className="spread" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {counts.map(({ c, n }) => (
                <span key={c} className="badge" style={{ color: CATEGORY_META[c].color, borderColor: CATEGORY_META[c].color }}>
                  {CATEGORY_META[c].label}: {n}
                </span>
              ))}
            </div>
            <select className="input" style={{ width: 'auto' }} value={runId || ''} onChange={(e) => setRunId(e.target.value)}>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>{runLabel(r)}</option>
              ))}
            </select>
          </div>

          {run?.status === 'error' && (
            <Card className="card-section" static style={{ marginBottom: 16 }}>
              <p className="body-text" style={{ color: 'var(--accent)' }}>
                <i className="ti ti-alert-triangle" /> This run failed: {run.error}
              </p>
            </Card>
          )}

          {!items.length && run?.status !== 'error' && (
            <Card className="card-section" static>
              <p className="body-text">Inbox zero — no unread mail in the last 24h for this run. 🎉</p>
            </Card>
          )}

          {aliases.map((alias) => {
            const acctItems = items.filter((i) => (i.account_alias || 'unknown') === alias);
            const ordered = CATEGORY_ORDER.flatMap((c) => acctItems.filter((i) => i.category === c));
            return (
              <Card className="card-section" static key={alias} style={{ marginBottom: 16 }}>
                <div className="card-section-title">
                  <span>
                    <i className="ti ti-brand-gmail" style={{ color: 'var(--accent)', marginRight: 6 }} />
                    {alias}
                    <span className="list-row-meta" style={{ marginLeft: 8 }}>{acctItems[0]?.account_email}</span>
                  </span>
                  <span className="list-row-meta">{acctItems.length} emails</span>
                </div>
                {ordered.map((item) => (
                  <TriageItem key={item.id} item={item} onDraft={createDraft} />
                ))}
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}
