import { useState, lazy, Suspense, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import Card from '../components/shared/Card.jsx';
import Badge from '../components/shared/Badge.jsx';
import Spinner from '../components/shared/Spinner.jsx';
import { useWorkspace } from '../components/WorkspaceProvider.jsx';
import { useRows } from '../lib/useData.js';
import { KANBAN_COLUMNS } from '../lib/mockData.js';
import { formatDate } from '../lib/helpers.js';

const ExcalidrawBoard = lazy(() => import('../components/ExcalidrawBoard.jsx'));

const STATUSES = ['Active', 'Paused', 'Complete'];
const TABS = ['Project Dashboard', 'Excalidraw', 'Board', 'Notes', 'Files & Links', 'People'];
const statusVariant = { Active: 'green', Paused: 'warm', Complete: 'accent' };

let seq = 0;
const newId = () => `n-${Date.now()}-${seq++}`;
const mdSnippet = (md = '', len = 120) =>
  md.replace(/[#*_>`[\]()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, len);

// Read a project's notes as a list, migrating the legacy single-blob `notes`
// field into the first entry when notes_list hasn't been used yet.
function notesOf(project) {
  if (project.notes_list?.length) return project.notes_list;
  if (project.notes) {
    return [{ id: 'legacy', title: 'Notes', content: project.notes, pinned: false, updated_at: null }];
  }
  return [];
}

function Rollup({ icon, title, onClick, children }) {
  return (
    <Card className="card-section" onClick={onClick} style={{ cursor: 'pointer' }}>
      <div className="card-section-title">
        <span><i className={`ti ${icon}`} style={{ marginRight: 6, color: 'var(--accent)' }} />{title}</span>
        <i className="ti ti-arrow-up-right muted" />
      </div>
      {children}
    </Card>
  );
}

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { projects, crmBoards } = useWorkspace();
  const { rows: tasks } = useRows('tasks', []);
  const { rows: contacts } = useRows('crm_contacts', []);
  const [tab, setTab] = useState('Project Dashboard');
  const [preview, setPreview] = useState({}); // note id → markdown preview on
  const [newLink, setNewLink] = useState({ title: '', url: '', type: 'link' });

  const project = projects.rows.find((p) => p.id === id);

  const patch = useCallback((changes) => projects.patch(id, changes), [projects, id]);
  const persistScene = useCallback(
    (scene, thumb) => patch(thumb ? { excalidraw: scene, excalidraw_preview: thumb } : { excalidraw: scene }),
    [patch]
  );

  if (!project) {
    return (
      <div className="placeholder fade-in">
        <i className="ti ti-folder-off" />
        <h2>{projects.loading ? 'Loading…' : 'Project not found'}</h2>
        {!projects.loading && <button className="btn btn--accent" onClick={() => navigate('/projects')}>Back to Projects</button>}
      </div>
    );
  }

  const del = () => {
    if (!confirm(`Delete project "${project.name}"?`)) return;
    projects.remove(id);
    navigate('/projects');
  };

  /* ---- Derived data shared by Dashboard + tabs ---- */
  const projectTasks = tasks.filter((t) => t.project_id === project.name);
  const taskCounts = projectTasks.reduce((acc, t) => {
    const col = t.column_name || '—';
    acc[col] = (acc[col] || 0) + 1;
    return acc;
  }, {});
  const blockedCount = projectTasks.filter((t) => /block/i.test(t.column_name || '')).length;

  const notesList = notesOf(project);
  const pinnedNotes = notesList.filter((n) => n.pinned);
  const dashNotes = pinnedNotes.length
    ? pinnedNotes
    : notesList.length
    ? [[...notesList].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))[0]]
    : [];

  const entries = project.files || [];
  const recentEntries = [...entries]
    .sort((a, b) => (b.added_at || '').localeCompare(a.added_at || ''))
    .slice(0, 3);

  const linkedContacts = project.crm_board_id ? contacts.filter((c) => c.board_id === project.crm_board_id) : [];

  /* ---- Charter ---- */
  const charter = project.charter || {};
  const metrics = charter.metrics || [];
  const patchCharter = (changes) => patch({ charter: { ...charter, ...changes } });
  const setMetric = (i, changes) => patchCharter({ metrics: metrics.map((m, j) => (j === i ? { ...m, ...changes } : m)) });

  /* ---- Notes ops ---- */
  const saveNotes = (next) => patch({ notes_list: next });
  const addNote = () => saveNotes([...notesList, { id: newId(), title: 'New note', content: '', pinned: false, updated_at: new Date().toISOString() }]);
  const patchNote = (nid, changes) =>
    saveNotes(notesList.map((n) => (n.id === nid ? { ...n, ...changes, updated_at: new Date().toISOString() } : n)));
  const delNote = (nid) => saveNotes(notesList.filter((n) => n.id !== nid));

  /* ---- Files & Links ops ---- */
  const addEntry = () => {
    if (!newLink.title.trim() || !newLink.url.trim()) return;
    patch({ files: [...entries, { ...newLink, added_at: new Date().toISOString() }] });
    setNewLink({ title: '', url: '', type: 'link' });
  };
  const removeEntry = (i) => patch({ files: entries.filter((_, j) => j !== i) });

  return (
    <div className="fade-in" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="page-header">
        <div className="row" style={{ gap: 10 }}>
          <button className="btn btn--ghost btn--icon" onClick={() => navigate('/projects')} title="Back"><i className="ti ti-arrow-left" /></button>
          <div>
            <div className="row">
              <span className="list-row-dot" style={{ background: project.color }} />
              <h1 className="page-title">{project.name}</h1>
            </div>
            <div className="page-header-sub"><Badge variant={statusVariant[project.status]}>{project.status}</Badge></div>
          </div>
        </div>
        <button className="btn btn--danger" onClick={del}><i className="ti ti-trash" /> Delete</button>
      </div>

      <Card className="card-section" static style={{ flex: 1, overflowY: 'auto' }}>
        <div className="tabs">
          {TABS.map((t) => (
            <div key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</div>
          ))}
        </div>

        {/* ============ 1. PROJECT DASHBOARD ============ */}
        {tab === 'Project Dashboard' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Charter — editable, persisted per project */}
            <Card className="card-section" static>
              <div className="card-section-title">Charter</div>
              <div className="field">
                <label className="field-label">Summary / vision</label>
                <textarea className="textarea" value={charter.summary || ''} onChange={(e) => patchCharter({ summary: e.target.value })} placeholder="What is this project, and where is it going?" />
              </div>
              <div className="field">
                <label className="field-label">Current objective</label>
                <input className="input" value={charter.objective || ''} onChange={(e) => patchCharter({ objective: e.target.value })} placeholder="The one thing being pushed right now" />
              </div>
              <label className="field-label">Key metrics</label>
              {metrics.length === 0 && <p className="body-text">No metrics yet.</p>}
              {metrics.map((m, i) => (
                <div className="edit-row" key={i}>
                  <input className="input" value={m.label || ''} onChange={(e) => setMetric(i, { label: e.target.value })} placeholder="Metric" style={{ flex: 2 }} />
                  <input className="input" value={m.value || ''} onChange={(e) => setMetric(i, { value: e.target.value })} placeholder="Value" style={{ width: 140 }} />
                  <button className="btn btn--ghost btn--icon" onClick={() => patchCharter({ metrics: metrics.filter((_, j) => j !== i) })} title="Remove"><i className="ti ti-trash" /></button>
                </div>
              ))}
              <button className="btn btn--sm" style={{ marginTop: 8 }} onClick={() => patchCharter({ metrics: [...metrics, { label: '', value: '' }] })}>
                <i className="ti ti-plus" /> Add metric
              </button>
            </Card>

            {/* Roll-ups — live, read-only, click through to their tab */}
            <div className="grid grid-3">
              <Rollup icon="ti-layout-kanban" title="Board" onClick={() => setTab('Board')}>
                {projectTasks.length === 0 && <p className="body-text">No tasks tagged to this project.</p>}
                {Object.entries(taskCounts).map(([col, n]) => (
                  <div className="spread" key={col} style={{ padding: '3px 0' }}>
                    <span className="body-text">{col}</span>
                    <span className="kanban-col-count">{n}</span>
                  </div>
                ))}
                {blockedCount > 0 && <Badge variant="urgent" className="mt-16">{blockedCount} blocked</Badge>}
              </Rollup>

              <Rollup icon="ti-pencil" title="Excalidraw" onClick={() => setTab('Excalidraw')}>
                {project.excalidraw_preview ? (
                  <img src={project.excalidraw_preview} alt="Canvas preview" className="rollup-thumb" />
                ) : (
                  <div className="rollup-thumb rollup-thumb--empty"><i className="ti ti-pencil" /> Empty canvas</div>
                )}
              </Rollup>

              <Rollup icon="ti-note" title="Notes" onClick={() => setTab('Notes')}>
                {dashNotes.length === 0 && <p className="body-text">No notes yet.</p>}
                {dashNotes.slice(0, 3).map((n) => (
                  <div key={n.id} style={{ marginBottom: 8 }}>
                    <div className="row" style={{ gap: 6 }}>
                      {n.pinned && <i className="ti ti-pin-filled" style={{ color: 'var(--accent)', fontSize: 12 }} />}
                      <span className="list-row-title">{n.title || 'Untitled'}</span>
                    </div>
                    <div className="list-row-meta">{mdSnippet(n.content) || '—'}</div>
                  </div>
                ))}
              </Rollup>

              <Rollup icon="ti-link" title="Files & Links" onClick={() => setTab('Files & Links')}>
                <div className="value-md" style={{ marginBottom: 6 }}>{entries.length}</div>
                {recentEntries.map((f, i) => (
                  <div className="list-row" key={i}>
                    <i className={`ti ${f.type === 'file' ? 'ti-file' : 'ti-link'}`} style={{ color: 'var(--accent)' }} />
                    <span className="list-row-title">{f.title}</span>
                    {f.added_at && <span className="list-row-meta">{formatDate(f.added_at)}</span>}
                  </div>
                ))}
              </Rollup>

              <Rollup icon="ti-users" title="People" onClick={() => setTab('People')}>
                {!project.crm_board_id ? (
                  <p className="body-text">Not linked to a CRM page.</p>
                ) : (
                  <>
                    <div className="value-md" style={{ marginBottom: 6 }}>{linkedContacts.length}</div>
                    <p className="body-text">{linkedContacts.slice(0, 4).map((c) => c.business_name).join(', ') || 'No contacts yet.'}{linkedContacts.length > 4 ? '…' : ''}</p>
                  </>
                )}
              </Rollup>
            </div>
          </div>
        )}

        {/* ============ 2. EXCALIDRAW ============ */}
        {tab === 'Excalidraw' && (
          <Suspense fallback={<div className="placeholder" style={{ minHeight: 300 }}><Spinner large /></div>}>
            <ExcalidrawBoard initialScene={project.excalidraw || null} onPersist={persistScene} />
          </Suspense>
        )}

        {/* ============ 3. BOARD ============ */}
        {tab === 'Board' && (
          <div className="kanban">
            {KANBAN_COLUMNS.map((col) => {
              const items = projectTasks.filter((t) => t.column_name === col);
              return (
                <div className="kanban-col" key={col}>
                  <div className="kanban-col-head"><span>{col}</span><span className="kanban-col-count">{items.length}</span></div>
                  {items.map((t) => (
                    <div className="kanban-card" key={t.id} style={{ cursor: 'default' }}>
                      <span className="kanban-card-title">{t.title}</span>
                      <Badge variant={t.priority}>{t.priority}</Badge>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {/* ============ 4. NOTES ============ */}
        {tab === 'Notes' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <button className="btn btn--sm btn--accent" onClick={addNote}><i className="ti ti-plus" /> Add note</button>
            </div>
            {notesList.length === 0 && <p className="body-text">No notes yet. Pinned notes surface on the Project Dashboard.</p>}
            {notesList.map((n) => (
              <Card className="card-section" static key={n.id}>
                <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                  <input className="input" value={n.title || ''} onChange={(e) => patchNote(n.id, { title: e.target.value })} placeholder="Note title" style={{ flex: 1 }} />
                  <button
                    className={`btn btn--ghost btn--icon ${n.pinned ? 'text-accent' : ''}`}
                    onClick={() => patchNote(n.id, { pinned: !n.pinned })}
                    title={n.pinned ? 'Unpin from Dashboard' : 'Pin to Dashboard'}
                  >
                    <i className={`ti ${n.pinned ? 'ti-pin-filled' : 'ti-pin'}`} />
                  </button>
                  <button className="btn btn--ghost btn--icon" onClick={() => setPreview((p) => ({ ...p, [n.id]: !p[n.id] }))} title={preview[n.id] ? 'Edit' : 'Preview'}>
                    <i className={`ti ${preview[n.id] ? 'ti-pencil' : 'ti-eye'}`} />
                  </button>
                  <button className="btn btn--ghost btn--icon" onClick={() => delNote(n.id)} title="Delete note"><i className="ti ti-trash" /></button>
                </div>
                {preview[n.id] ? (
                  <div className="ai-result" style={{ borderColor: 'var(--border-bright)' }}>
                    <ReactMarkdown>{n.content || '_Empty note._'}</ReactMarkdown>
                  </div>
                ) : (
                  <textarea className="textarea" style={{ minHeight: 140 }} value={n.content || ''} onChange={(e) => patchNote(n.id, { content: e.target.value })} placeholder="Write in Markdown…" />
                )}
                {n.updated_at && <div className="list-row-meta mt-16">Updated {formatDate(n.updated_at)}</div>}
              </Card>
            ))}
          </div>
        )}

        {/* ============ 5. FILES & LINKS ============ */}
        {tab === 'Files & Links' && (
          <div>
            <div className="toolbar">
              <input className="input" placeholder="Label" value={newLink.title} onChange={(e) => setNewLink({ ...newLink, title: e.target.value })} style={{ width: 180 }} />
              <input className="input" placeholder="https://…" value={newLink.url} onChange={(e) => setNewLink({ ...newLink, url: e.target.value })} style={{ flex: 1, minWidth: 200 }} />
              <div className="segmented">
                <button className={newLink.type === 'link' ? 'active' : ''} onClick={() => setNewLink({ ...newLink, type: 'link' })}>Link</button>
                <button className={newLink.type === 'file' ? 'active' : ''} onClick={() => setNewLink({ ...newLink, type: 'file' })}>File</button>
              </div>
              <button className="btn btn--accent" onClick={addEntry} disabled={!newLink.title.trim() || !newLink.url.trim()}>
                <i className="ti ti-plus" /> Add
              </button>
            </div>
            {entries.length === 0 && <p className="body-text">No files or links yet. Add a URL with a label above.</p>}
            {entries.map((f, i) => (
              <div className="list-row" key={i}>
                <i className={`ti ${f.type === 'file' ? 'ti-file' : 'ti-link'}`} style={{ color: 'var(--accent)' }} />
                <a className="list-row-title" href={f.url} target="_blank" rel="noreferrer">{f.title}</a>
                <span className="list-row-meta">{f.url}</span>
                {f.added_at && <span className="list-row-meta">{formatDate(f.added_at)}</span>}
                <button className="btn btn--ghost btn--icon" onClick={() => removeEntry(i)} title="Remove"><i className="ti ti-x" /></button>
              </div>
            ))}
          </div>
        )}

        {/* ============ 6. PEOPLE ============ */}
        {tab === 'People' && (
          <div>
            <div className="field" style={{ maxWidth: 340 }}>
              <label className="field-label">Linked CRM page</label>
              <div className="row">
                <select
                  className="select"
                  value={project.crm_board_id || ''}
                  onChange={(e) => patch({ crm_board_id: e.target.value || null })}
                >
                  <option value="">— Not linked —</option>
                  {crmBoards.rows.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                {project.crm_board_id && (
                  <button className="btn btn--icon" title="Open CRM page" onClick={() => navigate(`/crm/${project.crm_board_id}`)}>
                    <i className="ti ti-external-link" />
                  </button>
                )}
              </div>
            </div>

            {!project.crm_board_id ? (
              <p className="body-text">Link this project to a CRM page to see its contacts here. Records stay in sync with the CRM module.</p>
            ) : linkedContacts.length === 0 ? (
              <p className="body-text">No contacts on the linked CRM page yet.</p>
            ) : (
              linkedContacts.map((c) => (
                <div className="list-row" key={c.id}>
                  <i className="ti ti-user" style={{ color: 'var(--accent)' }} />
                  <span className="list-row-title">{c.business_name}</span>
                  {c.email && <span className="list-row-meta">{c.email}</span>}
                  {c.lead_temp && <Badge variant={c.lead_temp}>{c.lead_temp}</Badge>}
                </div>
              ))
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
