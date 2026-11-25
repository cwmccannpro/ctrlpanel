import { lazy, Suspense } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Card from '../components/shared/Card.jsx';
import Badge from '../components/shared/Badge.jsx';
import { useWorkspace } from '../components/WorkspaceProvider.jsx';
import { projectCrmPath } from '../lib/projectRoutes.js';

const ProjectCrm = lazy(() => import('../components/ProjectCrm.jsx'));

const statusVariant = { Active: 'green', Paused: 'warm', Complete: 'accent' };

export default function Projects() {
  const { projects } = useWorkspace();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const showCrm = params.get('view') === 'crm';

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
          <h1 className="page-title">{showCrm ? 'Unassigned CRM' : 'Projects'}</h1>
        </div>
        {showCrm
          ? <Link className="btn" to="/projects"><i className="ti ti-arrow-left" /> All projects</Link>
          : <div className="row">
              <Link className="btn btn--ghost" to={projectCrmPath(projects.rows)}><i className="ti ti-address-book" /> Unassigned CRM</Link>
              <button className="btn btn--accent" onClick={addProject}><i className="ti ti-plus" /> Add Project</button>
            </div>}
      </div>

      {showCrm ? <Suspense fallback={<p className="body-text">Loading CRM…</p>}>
        {projects.loading ? <p className="body-text">Loading projects…</p>
          : <ProjectCrm boardId={params.get('board')} onBoardChange={(id) => navigate(projectCrmPath(projects.rows, id))} />}
      </Suspense> : projects.loading ? <p className="body-text">Loading projects…</p>
      : projects.rows.length === 0 ? (
        <div className="placeholder">
          <i className="ti ti-folder" />
          <h2>No projects yet</h2>
          <p>Create a project to bring its CRM, canvas, and Context notes together.</p>
          <button className="btn btn--accent" onClick={addProject}><i className="ti ti-plus" /> Add Project</button>
        </div>
      ) : (
        <div className="grid grid-3">
          {projects.rows.map((p) => (
            <Card key={p.id} className="card-section" onClick={() => navigate(`/projects/${p.id}`)} style={{ cursor: 'pointer' }}>
              <div className="spread" style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{p.name}</span>
                <Badge variant={statusVariant[p.status]}>{p.status}</Badge>
              </div>
              <p className="body-text" style={{ minHeight: 34 }}>{p.description || 'No description yet.'}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
