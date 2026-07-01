import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import Card from '../components/shared/Card.jsx';
import Badge from '../components/shared/Badge.jsx';
import { useRows } from '../lib/useData.js';
import { update as sbUpdate, insert as sbInsert, remove as sbRemove } from '../lib/supabase.js';
import { KANBAN_COLUMNS } from '../lib/mockData.js';

const STATUSES = ['Active', 'Paused', 'Complete'];
const TABS = ['Overview', 'Board', 'Notes', 'Files', 'Contacts'];
const statusVariant = { Active: 'green', Paused: 'warm', Complete: 'accent' };
let tmpId = 0;

export default function Projects() {
  const { rows: projects, setRows: setProjects } = useRows('projects', []);
  const { rows: tasks } = useRows('tasks', []);
  const { rows: contacts } = useRows('crm_contacts', []);
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState('Overview');
  const [preview, setPreview] = useState(false);

  // Default selection to the first project once loaded
  useEffect(() => {
    if (!selectedId && projects.length) setSelectedId(projects[0].id);
  }, [projects, selectedId]);

  const project = projects.find((p) => p.id === selectedId) || null;

  const patch = (changes) => {
    setProjects((prev) => prev.map((p) => (p.id === project.id ? { ...p, ...changes } : p)));
    sbUpdate('projects', project.id, changes);
  };

  const addProject = () => {
    const name = prompt('Project name?');
    if (!name) return;
    const created = { id: `new-${Date.now()}-${tmpId++}`, name, status: 'Active', color: '#e11d48', description: '', goal: '', notes: '', files: [] };
    setProjects((prev) => [...prev, created]);
    sbInsert('projects', [{ name, status: 'Active', color: '#e11d48' }]);
    setSelectedId(created.id);
  };

  const deleteProject = () => {
    if (!project) return;
    if (!confirm(`Delete project "${project.name}"?`)) return;
    sbRemove('projects', project.id);
    setProjects((prev) => prev.filter((p) => p.id !== project.id));
    setSelectedId(null);
  };

  const addFile = () => {
    const title = prompt('Link title?');
    if (!title) return;
    const url = prompt('URL?') || '#';
    patch({ files: [...(project.files || []), { title, url }] });
  };

  const projectTasks = project ? tasks.filter((t) => t.project_id === project.name) : [];

  return (
    <div className="fade-in" style={{ height: '100%' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Projects</h1>
          <div className="page-header-sub">{projects.length} projects</div>
        </div>
        <button className="btn btn--accent" onClick={addProject}>
          <i className="ti ti-plus" /> Add Project
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="placeholder">
          <i className="ti ti-folder" />
          <h2>No projects yet</h2>
          <p>Create your first project to start organizing work, notes, files, and contacts.</p>
          <button className="btn btn--accent" onClick={addProject}><i className="ti ti-plus" /> Add Project</button>
        </div>
      ) : (
        <div className="split">
          {/* Left: project list */}
          <Card className="card-section" static style={{ overflowY: 'auto' }}>
            {projects.map((p) => (
              <div key={p.id} className={`split-list-item ${p.id === selectedId ? 'active' : ''}`} onClick={() => setSelectedId(p.id)}>
                <div className="row">
                  <span className="list-row-dot" style={{ background: p.color }} />
                  <span style={{ color: 'var(--text-primary)', fontSize: 13 }}>{p.name}</span>
                </div>
                <Badge variant={statusVariant[p.status]}>{p.status}</Badge>
              </div>
            ))}
          </Card>

          {/* Right: tabbed detail */}
          {project && (
            <Card className="card-section" static style={{ overflowY: 'auto' }}>
              <div className="spread">
                <div className="tabs" style={{ flex: 1 }}>
                  {TABS.map((t) => (
                    <div key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</div>
                  ))}
                </div>
                <button className="btn btn--ghost btn--icon" onClick={deleteProject} title="Delete project"><i className="ti ti-trash" /></button>
              </div>

              {tab === 'Overview' && (
                <div>
                  <div className="field">
                    <label className="field-label">Name</label>
                    <input className="input" value={project.name} onChange={(e) => patch({ name: e.target.value })} />
                  </div>
                  <div className="grid grid-2">
                    <div className="field">
                      <label className="field-label">Status</label>
                      <select className="select" value={project.status} onChange={(e) => patch({ status: e.target.value })}>
                        {STATUSES.map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label className="field-label">Color</label>
                      <input type="color" className="input" style={{ height: 38, padding: 4 }} value={project.color} onChange={(e) => patch({ color: e.target.value })} />
                    </div>
                  </div>
                  <div className="field">
                    <label className="field-label">Description</label>
                    <textarea className="textarea" value={project.description || ''} onChange={(e) => patch({ description: e.target.value })} />
                  </div>
                  <div className="field">
                    <label className="field-label">Goal</label>
                    <input className="input" value={project.goal || ''} onChange={(e) => patch({ goal: e.target.value })} />
                  </div>
                </div>
              )}

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

              {tab === 'Notes' && (
                <div>
                  <div className="spread" style={{ marginBottom: 8 }}>
                    <span className="section-label">Markdown notes</span>
                    <button className="btn btn--ghost btn--sm" onClick={() => setPreview((p) => !p)}>
                      <i className={`ti ${preview ? 'ti-pencil' : 'ti-eye'}`} /> {preview ? 'Edit' : 'Preview'}
                    </button>
                  </div>
                  {preview ? (
                    <div className="ai-result" style={{ borderColor: 'var(--border-bright)' }}>
                      <ReactMarkdown>{project.notes || '_No notes yet._'}</ReactMarkdown>
                    </div>
                  ) : (
                    <textarea className="textarea" style={{ minHeight: 220 }} value={project.notes || ''} onChange={(e) => patch({ notes: e.target.value })} placeholder="Write notes in Markdown…" />
                  )}
                </div>
              )}

              {tab === 'Files' && (
                <div>
                  <button className="btn btn--sm" onClick={addFile} style={{ marginBottom: 12 }}><i className="ti ti-plus" /> Add link</button>
                  {(project.files || []).length === 0 && <p className="body-text">No files linked yet.</p>}
                  {(project.files || []).map((f, i) => (
                    <div className="list-row" key={i}>
                      <i className="ti ti-link" style={{ color: 'var(--accent)' }} />
                      <a className="list-row-title" href={f.url} target="_blank" rel="noreferrer">{f.title}</a>
                      <span className="list-row-meta">{f.url}</span>
                    </div>
                  ))}
                </div>
              )}

              {tab === 'Contacts' && (
                <div>
                  {contacts.length === 0 && <p className="body-text">No CRM contacts yet. Add them on the CRM page.</p>}
                  {contacts.slice(0, 5).map((c) => (
                    <div className="list-row" key={c.id}>
                      <i className="ti ti-user" style={{ color: 'var(--accent)' }} />
                      <span className="list-row-title">{c.business_name}</span>
                      <Badge variant={c.lead_temp}>{c.lead_temp}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
