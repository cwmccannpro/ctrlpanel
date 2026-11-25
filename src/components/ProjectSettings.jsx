import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './AuthProvider.jsx';
import { useWorkspace } from './WorkspaceProvider.jsx';
import Modal from './shared/Modal.jsx';
import { columnsOf } from '../lib/boards.js';
import { KANBAN_COLUMNS } from '../lib/mockData.js';
import { projectCrmPath } from '../lib/projectRoutes.js';

const STATUSES = ['Active', 'Paused', 'Complete'];

export default function ProjectSettings({ project, onSave, onDelete, onClose }) {
  const formId = useId();
  const { user } = useAuth();
  const { todoBoards, crmBoards, projects } = useWorkspace();
  const [initial] = useState(() => ({
    name: project.name || '',
    status: project.status || 'Active',
    todo_board_id: project.todo_board_id || '',
    todo_column_name: project.todo_column_name || '',
    crm_board_id: project.crm_board_id || '',
  }));
  const [draft, setDraft] = useState(initial);
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');

  const boards = todoBoards.rows.filter((board) => board.user_id === user?.id && !board.id.startsWith('tmp-'));
  const crmPages = crmBoards.rows.filter((page) => !page.id.startsWith('tmp-'));
  const board = boards.find((option) => option.id === draft.todo_board_id);
  const columns = board ? columnsOf(board, KANBAN_COLUMNS) : [];
  const todoChanged = draft.todo_board_id !== initial.todo_board_id || draft.todo_column_name !== initial.todo_column_name;
  const changes = {};
  if (draft.name.trim() !== initial.name.trim()) changes.name = draft.name.trim();
  if (draft.status !== initial.status) changes.status = draft.status;
  if (draft.crm_board_id !== initial.crm_board_id) changes.crm_board_id = draft.crm_board_id || null;
  if (todoChanged) {
    changes.todo_board_id = draft.todo_board_id || null;
    changes.todo_column_name = draft.todo_column_name || null;
  }
  const canSave = !pending && Boolean(draft.name.trim()) && Object.keys(changes).length > 0
    && (!todoChanged || !draft.todo_board_id || columns.includes(draft.todo_column_name));

  function change(fields) {
    setError('');
    setDraft((previous) => ({ ...previous, ...fields }));
  }

  async function run(action, save) {
    setPending(action);
    setError('');
    try {
      await save();
      onClose();
    } catch (reason) {
      setError(reason.message || 'Could not update this project. Try again.');
    } finally {
      setPending('');
    }
  }

  const close = () => { if (!pending) onClose(); };

  return (
    <Modal title="Project settings" className="project-settings" onClose={close} footer={<>
      <button type="button" className="btn btn--danger project-delete" disabled={!!pending} onClick={() => {
        if (window.confirm(`Delete project “${project.name}”?`)) run('delete', onDelete);
      }}>{pending === 'delete' ? 'Deleting…' : 'Delete project'}</button>
      <button type="button" className="btn btn--ghost" disabled={!!pending} onClick={close}>Cancel</button>
      <button type="submit" form={formId} className="btn btn--accent" disabled={!canSave}>
        {pending === 'save' ? 'Saving…' : 'Save changes'}
      </button>
    </>}>
      <form id={formId} aria-busy={!!pending} onSubmit={(event) => {
        event.preventDefault();
        if (canSave) run('save', () => onSave(changes));
      }}>
        <div className="project-settings-details">
          <label className="field"><span className="field-label">Project name</span>
            <input className="input" value={draft.name} disabled={!!pending} onChange={(event) => change({ name: event.target.value })} required autoFocus />
          </label>
          <label className="field"><span className="field-label">Status</span>
            <select className="select" value={draft.status} disabled={!!pending} onChange={(event) => change({ status: event.target.value })}>
              {!STATUSES.includes(draft.status) && <option>{draft.status}</option>}
              {STATUSES.map((status) => <option key={status}>{status}</option>)}
            </select>
          </label>
        </div>

        <fieldset className="project-settings-section">
          <legend>To Do</legend>
          <div className="project-settings-board">
            <label className="field"><span className="field-label">Board</span>
              <select className="select" value={draft.todo_board_id} disabled={!!pending || todoBoards.loading}
                onChange={(event) => change({ todo_board_id: event.target.value, todo_column_name: '' })}>
                <option value="">Not linked</option>
                {draft.todo_board_id && !board && <option value={draft.todo_board_id} disabled>Current board</option>}
                {boards.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
              </select>
            </label>
            <label className="field"><span className="field-label">Column</span>
              <select className="select" value={columns.includes(draft.todo_column_name) ? draft.todo_column_name : ''}
                disabled={!!pending || todoBoards.loading || !board}
                onChange={(event) => change({ todo_column_name: event.target.value })}>
                <option value="">Choose a column</option>
                {columns.map((name) => <option key={name}>{name}</option>)}
              </select>
            </label>
          </div>
          {todoBoards.loading ? <p className="body-text">Loading To Do boards…</p>
            : todoBoards.error ? <p className="project-error" role="alert">Could not load To Do boards. <button className="btn btn--ghost" type="button" onClick={todoBoards.reload}>Retry</button></p>
            : !boards.length && <p className="body-text">Create a board in <Link to="/todo">To Do</Link> to link a column.</p>}
        </fieldset>

        <fieldset className="project-settings-section">
          <legend>CRM</legend>
          <label className="field"><span className="field-label">CRM page</span>
            <select className="select" value={draft.crm_board_id} disabled={!!pending || crmBoards.loading}
              onChange={(event) => change({ crm_board_id: event.target.value })}>
              <option value="">Off</option>
              {draft.crm_board_id && !crmPages.some((option) => option.id === draft.crm_board_id) &&
                <option value={draft.crm_board_id} disabled>Current CRM page</option>}
              {crmPages.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
          </label>
          {crmBoards.loading ? <p className="body-text">Loading CRM pages…</p>
            : crmBoards.error ? <p className="project-error" role="alert">Could not load CRM pages. <button className="btn btn--ghost" type="button" onClick={crmBoards.reload}>Retry</button></p>
            : !crmPages.length && <p className="body-text">Create a page in <Link to={projectCrmPath(projects.rows)}>Unassigned CRM</Link> to link it here.</p>}
        </fieldset>

        {error && <p className="project-error" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}
