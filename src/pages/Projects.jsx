import { useNavigate } from 'react-router-dom';
import Card from '../components/shared/Card.jsx';
import Badge from '../components/shared/Badge.jsx';
import { useWorkspace } from '../components/WorkspaceProvider.jsx';

const statusVariant = { Active: 'green', Paused: 'warm', Complete: 'accent' };

export default function Projects() {
  const { projects } = useWorkspace();
  const navigate = useNavigate();

  const addProject = async () => {
    const name = prompt('Project name?');
    if (!name) return;
    const created = await projects.add({ name, status: 'Active', color: '#e11d48', description: '', goal: '', notes: '', files: [] });
    if (created?.id) navigate(`/projects/${created.id}`);
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Projects</h1>
          <div className="page-header-sub">{projects.rows.length} projects</div>
        </div>
        <button className="btn btn--accent" onClick={addProject}><i className="ti ti-plus" /> Add Project</button>
      </div>

      {projects.rows.length === 0 ? (
        <div className="placeholder">
          <i className="ti ti-folder" />
          <h2>No projects yet</h2>
          <p>Create your first project. Each one gets its own page — selectable from the sidebar — with tasks, notes, files, and contacts.</p>
          <button className="btn btn--accent" onClick={addProject}><i className="ti ti-plus" /> Add Project</button>
        </div>
      ) : (
        <div className="grid grid-3">
          {projects.rows.map((p) => (
            <Card key={p.id} className="card-section" onClick={() => navigate(`/projects/${p.id}`)} style={{ cursor: 'pointer' }}>
              <div className="spread" style={{ marginBottom: 8 }}>
                <div className="row">
                  <span className="list-row-dot" style={{ background: p.color }} />
                  <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)' }}>{p.name}</span>
                </div>
                <Badge variant={statusVariant[p.status]}>{p.status}</Badge>
              </div>
              <p className="body-text" style={{ minHeight: 34 }}>{p.description || 'No description yet.'}</p>
              {p.goal && <div className="list-row-meta" style={{ marginTop: 8 }}><i className="ti ti-target" /> {p.goal}</div>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
