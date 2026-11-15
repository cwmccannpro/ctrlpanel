import { useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthProvider.jsx';
import { useWorkspace } from './WorkspaceProvider.jsx';
import { sidebarNavigation, sidebarItemVisible } from '../lib/sidebarNavigation.js';
import '../styles/sidebarVisibility.css';

export default function SidebarVisibility({ autoFocus = false }) {
  const { settings, updateUiPreferences } = useAuth();
  const { projects, crmBoards, socials } = useWorkspace();
  const navigation = sidebarNavigation({ projects: projects.rows, crmBoards: crmBoards.rows, socials, settings });
  const visibility = settings?.ui_preferences?.sidebarVisibility || {};
  const pendingRef = useRef(false);
  const restoreFocusRef = useRef(null);
  const [pending, setPending] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const shown = (id) => sidebarItemVisible(pending ? { ...visibility, ...pending } : visibility, id);

  useEffect(() => {
    if (!pending && restoreFocusRef.current) {
      restoreFocusRef.current.focus();
      restoreFocusRef.current = null;
    }
  }, [pending]);

  const save = async (patch) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    restoreFocusRef.current = document.activeElement;
    setPending(patch);
    setStatus('Saving…');
    setError('');
    try {
      await updateUiPreferences('sidebarVisibility', patch);
      setStatus('Saved');
    } catch (err) {
      setStatus('');
      setError(`Couldn’t save sidebar choices: ${err.message}`);
    } finally {
      pendingRef.current = false;
      setPending(null);
    }
  };

  const toggle = (id, label, { child = false, disabled = false, icon, focus = false } = {}) => (
    <label className={`sidebar-visibility-row ${child ? 'sidebar-visibility-row--child' : ''} ${disabled ? 'is-disabled' : ''}`} key={id}>
      {icon && <i className={`ti ${icon}`} aria-hidden="true" />}
      <span>{label}</span>
      <input
        type="checkbox"
        checked={shown(id)}
        onChange={(e) => save({ [id]: e.target.checked })}
        disabled={disabled}
        aria-label={`Show ${label} in sidebar`}
        autoFocus={focus}
      />
    </label>
  );

  return (
    <div className="sidebar-visibility">
      <p className="body-text">Show or hide each section and its pages in the sidebar. Your choices save automatically; hidden pages stay available through search and dashboard panels.</p>
      <div className="sidebar-visibility-tools">
        <span className="list-row-meta">Settings stays visible so you can restore sections.</span>
        <button
          className="btn btn--sm"
          type="button"
          onClick={() => save(Object.fromEntries(Object.keys(visibility).map((id) => [id, true])))}
          disabled={!settings || !!pending || !Object.values(visibility).includes(false)}
        >Show all</button>
      </div>
      <fieldset disabled={!settings || !!pending} aria-busy={!!pending}>
        <legend className="sr-only">Visible sidebar sections</legend>
        {navigation.links.map((link, i) => toggle(link.to, link.label, { icon: link.icon, focus: autoFocus && i === 0 }))}
        {navigation.folders.map((folder) => (
          <div className="sidebar-visibility-group" key={folder.id}>
            {toggle(folder.id, folder.label, { icon: folder.icon })}
            {folder.items.map((item) => toggle(item.to, item.label, { child: true, disabled: !shown(folder.id) }))}
          </div>
        ))}
      </fieldset>
      <span className="list-row-meta" role="status">{settings ? status : 'Loading section choices…'}</span>
      {error && <p className="text-red" role="alert">{error}</p>}
    </div>
  );
}
