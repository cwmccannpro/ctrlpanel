import { useState, useEffect, useCallback } from 'react';
import Card from './shared/Card.jsx';
import { useAuth } from './AuthProvider.jsx';
import { useWorkspace } from './WorkspaceProvider.jsx';
import { useCrud } from '../lib/useData.js';
import { authApi } from '../lib/api.js';

// Settings → Sharing & Friends: the one place to share ANY section with a
// person. Enter an email, toggle what to share (To Do boards, Nutrition
// friend), send — each selection produces a Resend invite with a tokenized
// accept link. Below, every connection is grouped by person with per-item
// revoke/leave, plus incoming requests you can accept in-app.
export default function SharingCenter() {
  const { user } = useAuth();
  const { todoBoards } = useWorkspace();
  const shares = useCrud('board_shares', 'created_at');
  const [social, setSocial] = useState({ friends: [], incoming: [], outgoing: [] });

  const [email, setEmail] = useState('');
  const [pickNutrition, setPickNutrition] = useState(false);
  const [pickBoards, setPickBoards] = useState([]); // board ids
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { ok: [], fail: [] }

  const myEmail = (user?.email || '').toLowerCase();
  const ownedBoards = todoBoards.rows.filter((b) => b.user_id === user?.id);

  const loadSocial = useCallback(
    () => authApi.get('/social/friends').then(setSocial).catch(() => {}),
    []
  );
  useEffect(() => {
    loadSocial();
  }, [loadSocial]);

  const toggleBoard = (id) =>
    setPickBoards((prev) => (prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]));

  const nothingPicked = !pickNutrition && pickBoards.length === 0;

  const sendInvites = async () => {
    const target = email.trim();
    if (!target || nothingPicked) return;
    setBusy(true);
    const ok = [];
    const fail = [];
    for (const bid of pickBoards) {
      const name = ownedBoards.find((b) => b.id === bid)?.name || 'list';
      try {
        await authApi.post('/shares/board', { board_id: bid, email: target });
        ok.push(`To Do "${name}"`);
      } catch (e) {
        fail.push(`To Do "${name}": ${e.message}`);
      }
    }
    if (pickNutrition) {
      try {
        await authApi.post('/social/friends', { email: target });
        ok.push('Nutrition friend');
      } catch (e) {
        fail.push(`Nutrition friend: ${e.message}`);
      }
    }
    setNotice({ ok, fail, target });
    if (fail.length === 0) {
      setEmail('');
      setPickBoards([]);
      setPickNutrition(false);
    }
    await Promise.all([shares.reload(), loadSocial()]);
    setBusy(false);
  };

  const accept = async (token) => {
    setBusy(true);
    try {
      await authApi.post('/invites/accept', { token });
      await Promise.all([shares.reload(), loadSocial(), todoBoards.reload()]);
    } catch (e) {
      setNotice({ ok: [], fail: [e.message] });
    }
    setBusy(false);
  };

  const dropFriend = async (id) => {
    setBusy(true);
    try {
      await authApi.del(`/social/friends/${id}`);
      await loadSocial();
    } catch (e) {
      setNotice({ ok: [], fail: [e.message] });
    }
    setBusy(false);
  };

  /* ---- Group every connection by the other person's email ---- */
  const people = {};
  const personFor = (key) => {
    const k = (key || 'unknown').toLowerCase();
    return (people[k] = people[k] || { email: k, items: [] });
  };

  for (const s of shares.rows) {
    const iOwn = s.owner_id === user?.id;
    const item = {
      key: `bs-${s.id}`,
      icon: 'ti-checklist',
      label: `To Do · ${s.board_name || 'Untitled'}`,
      status: s.status,
      dir: iOwn ? 'out' : 'in',
    };
    if (iOwn) {
      item.actions = [{ title: 'Revoke access', icon: 'ti-x', run: () => shares.remove(s.id) }];
    } else if (s.status === 'pending') {
      item.actions = [
        { title: 'Accept', label: 'Accept', accent: true, run: () => accept(s.token) },
        { title: 'Decline', icon: 'ti-x', run: () => shares.remove(s.id) },
      ];
    } else {
      item.actions = [{ title: 'Leave list', icon: 'ti-logout', run: () => shares.remove(s.id) }];
    }
    personFor(iOwn ? s.invitee_email : s.inviter_email).items.push(item);
  }

  for (const o of social.outgoing) {
    personFor(o.invitee_email).items.push({
      key: `fr-${o.id}`, icon: 'ti-salad', label: 'Nutrition friend', status: 'pending', dir: 'out',
      actions: [{ title: 'Revoke invite', icon: 'ti-x', run: () => dropFriend(o.id) }],
    });
  }
  for (const inv of social.incoming) {
    personFor(inv.inviter_email).items.push({
      key: `fr-${inv.id}`, icon: 'ti-salad', label: 'Nutrition friend', status: 'pending', dir: 'in',
      actions: [
        { title: 'Accept', label: 'Accept', accent: true, run: () => accept(inv.token) },
        { title: 'Decline', icon: 'ti-x', run: () => dropFriend(inv.id) },
      ],
    });
  }
  for (const f of social.friends) {
    personFor(f.email).items.push({
      key: `fr-${f.id}`, icon: 'ti-salad', label: 'Nutrition friend', status: 'accepted', dir: 'mutual',
      actions: [{ title: 'Unfriend', icon: 'ti-x', run: () => dropFriend(f.id) }],
    });
  }
  const peopleList = Object.values(people).sort((a, b) => a.email.localeCompare(b.email));

  return (
    <Card className="card-section" static>
      <div className="card-section-title">Sharing & Friends</div>
      <p className="body-text" style={{ marginBottom: 12 }}>
        Share sections of your CTRLpanel with someone by email. They get an invite with an accept
        link; once accepted, To Do lists become fully collaborative and Nutrition friends can
        compare aggregate stats on leaderboards and challenges.
      </p>

      {/* Composer */}
      <div className="field">
        <label className="field-label">Person's email</label>
        <input
          className="input"
          type="email"
          placeholder="friend@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field-label">What to share</label>
        <div className="spread" style={{ marginBottom: 8 }}>
          <span className="body-text"><i className="ti ti-salad" style={{ marginRight: 6 }} /> Nutrition (friend, leaderboard & challenges)</span>
          <div className={`switch ${pickNutrition ? 'on' : ''}`} onClick={() => setPickNutrition(!pickNutrition)} />
        </div>
        {ownedBoards.map((b) => (
          <div className="spread" key={b.id} style={{ marginBottom: 8 }}>
            <span className="body-text"><i className="ti ti-checklist" style={{ marginRight: 6 }} /> To Do · {b.name}</span>
            <div className={`switch ${pickBoards.includes(b.id) ? 'on' : ''}`} onClick={() => toggleBoard(b.id)} />
          </div>
        ))}
        {ownedBoards.length === 0 && (
          <p className="list-row-meta">No To Do lists yet — create one on the To Do page to share it.</p>
        )}
      </div>
      <button className="btn btn--accent" onClick={sendInvites} disabled={busy || !email.trim() || nothingPicked}>
        <i className="ti ti-send" /> {busy ? 'Sending…' : 'Send invites'}
      </button>

      {notice && (notice.ok.length > 0 || notice.fail.length > 0) && (
        <div style={{ marginTop: 10 }}>
          {notice.ok.length > 0 && (
            <p className="list-row-meta text-green">Invited {notice.target} to: {notice.ok.join(', ')}.</p>
          )}
          {notice.fail.map((f, i) => (
            <p className="list-row-meta" key={i} style={{ color: 'var(--accent)' }}>{f}</p>
          ))}
        </div>
      )}

      {/* Connections grouped by person */}
      {peopleList.length > 0 && (
        <div className="field" style={{ marginTop: 18, marginBottom: 0 }}>
          <label className="field-label">Your connections</label>
          {peopleList.map((p) => (
            <div key={p.email} style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}>
              <div className="list-row-title" style={{ marginBottom: 4 }}>{p.email === myEmail ? 'You' : p.email}</div>
              {p.items.map((it) => (
                <div className="list-row" key={it.key}>
                  <i className={`ti ${it.icon}`} style={{ color: 'var(--accent)' }} />
                  <span className="list-row-title">{it.label}</span>
                  <span className="badge">
                    {it.status === 'pending' ? (it.dir === 'in' ? 'invited you' : 'pending') : it.dir === 'in' ? 'shared with you' : 'active'}
                  </span>
                  {(it.actions || []).map((a, i) =>
                    a.label ? (
                      <button key={i} className={`btn btn--sm ${a.accent ? 'btn--accent' : 'btn--ghost'}`} disabled={busy} onClick={a.run}>
                        {a.label}
                      </button>
                    ) : (
                      <button key={i} className="btn btn--ghost btn--icon" title={a.title} disabled={busy} onClick={a.run}>
                        <i className={`ti ${a.icon}`} />
                      </button>
                    )
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
