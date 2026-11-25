import { lazy, Suspense, useCallback, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import Badge from '../components/shared/Badge.jsx';
import Spinner from '../components/shared/Spinner.jsx';
import ProjectSettings from '../components/ProjectSettings.jsx';
import { useWorkspace } from '../components/WorkspaceProvider.jsx';
import { projectPath } from '../lib/projectRoutes.js';
import '../styles/projects.css';

const ProjectDashboard = lazy(() => import('../components/ProjectDashboard.jsx'));
const ProjectResources = lazy(() => import('../components/ProjectResources.jsx'));
const ExcalidrawBoard = lazy(() => import('../components/ExcalidrawBoard.jsx'));
const KnowledgeBase = lazy(() => import('./KnowledgeBase.jsx'));
const ProjectCrm = lazy(() => import('../components/ProjectCrm.jsx'));

const TABS = [
  { id: '', label: 'Project Dashboard', icon: 'ti-layout-dashboard' },
  { id: 'crm', label: 'CRM', icon: 'ti-address-book' },
  { id: 'excalidraw', label: 'Excalidraw', icon: 'ti-pencil' },
  { id: 'context', label: 'Context', icon: 'ti-notebook' },
];
const statusVariant = { Active: 'green', Paused: 'warm', Complete: 'accent' };

export default function ProjectDetail() {
  const { id, tab = '' } = useParams();
  const { projects } = useWorkspace();
  const project = projects.rows.find((row) => row.id === id);

  if (!project) {
    return (
      <div className="placeholder fade-in">
        <i className="ti ti-folder-off" />
        <h2>{projects.loading ? 'Loading project…' : projects.error ? 'Could not load this project' : 'Project not found'}</h2>
        {!projects.loading && <Link className="btn" to="/projects">Back to Projects</Link>}
      </div>
    );
  }
  if (!TABS.some((item) => item.id === tab)) return <Navigate replace to={projectPath(id)} />;
  return <ProjectWorkspace key={id} project={project} tab={tab} />;
}

function ProjectWorkspace({ project, tab }) {
  const navigate = useNavigate();
  const { projects } = useWorkspace();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsTrigger = useRef(null);
  const id = project.id;
  const crmEnabled = Boolean(project.crm_board_id);
  const activeTab = tab === 'crm' && !crmEnabled ? '' : tab;
  const updateProject = projects.patch;
  const patch = useCallback(async (changes) => {
    const result = await updateProject(id, changes);
    if (result.error) throw new Error(result.error.message);
    return result;
  }, [id, updateProject]);
  const persistScene = useCallback((scene, thumbnail) => updateProject(
    id, thumbnail ? { excalidraw: scene, excalidraw_preview: thumbnail } : { excalidraw: scene }
  ), [id, updateProject]);

  function openSettings(event) {
    settingsTrigger.current = event.currentTarget;
    setSettingsOpen(true);
  }

  function closeSettings() {
    setSettingsOpen(false);
    requestAnimationFrame(() => settingsTrigger.current?.focus());
  }

  async function saveSettings(changes) {
    await patch(changes);
    if (changes.crm_board_id === null && tab === 'crm') navigate(projectPath(id), { replace: true });
  }

  async function deleteProject() {
    const { error } = await projects.remove(id);
    if (error) throw new Error(error.message);
    navigate('/projects');
  }

  return (
    <div className="project-workspace fade-in">
      <header className="project-heading">
        <Link className="btn btn--ghost project-back" to="/projects"><i className="ti ti-arrow-left" /> Projects</Link>
        <div className="project-title-row">
          <div className="project-identity">
            <h1 className="page-title">{project.name}</h1>
            {project.status && <Badge variant={statusVariant[project.status]}>{project.status}</Badge>}
          </div>
          <button className="btn btn--ghost project-settings-trigger" type="button" aria-haspopup="dialog" onClick={openSettings}>
            <i className="ti ti-settings" aria-hidden="true" /> Settings
          </button>
        </div>
        <nav className="tabs project-tabs" aria-label="Project sections">
          {TABS.filter(({ id: section }) => section !== 'crm' || crmEnabled).map(({ id: section, label, icon }) => (
            <Link key={section} className={`tab${section === activeTab ? ' active' : ''}`} aria-current={section === activeTab ? 'page' : undefined} to={projectPath(id, section)}>
              <i className={`ti ${icon}`} aria-hidden="true" />{label}
            </Link>
          ))}
        </nav>
      </header>

      <div className="project-tab-content">
        <Suspense fallback={<div className="placeholder project-loading"><Spinner large /></div>}>
          {activeTab === '' && <ProjectDashboard project={project} patch={patch} />}
          {activeTab === 'crm' && <ProjectCrm project={project} onBoardChange={(boardId) => saveSettings({ crm_board_id: boardId })} />}
          {activeTab === 'excalidraw' && <ExcalidrawBoard initialScene={project.excalidraw || null} onPersist={persistScene} />}
          {activeTab === 'context' && <div className="project-context">
            <KnowledgeBase projectId={id} />
            <ProjectResources project={project} patch={patch} />
          </div>}
        </Suspense>
      </div>
      {settingsOpen && <ProjectSettings project={project} onSave={saveSettings} onDelete={deleteProject} onClose={closeSettings} />}
    </div>
  );
}
