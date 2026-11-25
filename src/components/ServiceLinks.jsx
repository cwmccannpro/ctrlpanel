import { useId, useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Modal from './shared/Modal.jsx';

const PRESETS = [
  ['GitHub', 'ti-brand-github', 'https://github.com'],
  ['Cloudflare', 'ti-brand-cloudflare', 'https://dash.cloudflare.com'],
  ['Supabase', 'ti-brand-supabase', 'https://supabase.com/dashboard'],
  ['Vercel', 'ti-brand-vercel', 'https://vercel.com/dashboard'],
  ['Netlify', 'ti-brand-netlify', 'https://app.netlify.com'],
  ['Stripe', 'ti-brand-stripe', 'https://dashboard.stripe.com', true],
  ['Anthropic', 'ti-sparkles', 'https://console.anthropic.com', true],
  ['OpenAI', 'ti-brand-openai', 'https://platform.openai.com', true],
  ['Figma', 'ti-brand-figma', 'https://figma.com'],
  ['Notion', 'ti-brand-notion', 'https://notion.so'],
  ['AWS', 'ti-brand-aws', 'https://console.aws.amazon.com', true],
  ['Linear', 'ti-brand-linear', 'https://linear.app', true],
];
const ICONS = [...PRESETS.map((preset) => preset[1]),
  'ti-brand-gitlab', 'ti-brand-google', 'ti-brand-firebase', 'ti-brand-slack',
  'ti-brand-discord', 'ti-brand-npm', 'ti-brand-docker', 'ti-brand-python',
  'ti-cloud', 'ti-database', 'ti-server', 'ti-terminal-2', 'ti-credit-card', 'ti-chart-bar', 'ti-mail', 'ti-world'];
const groupOf = (item) => (item.group || '').trim();

function serviceUrl(value) {
  const text = (value || '').trim();
  if (!text || (/^[a-z][\w+.-]*:\/\//i.test(text) && !/^https?:\/\//i.test(text))) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    return url.href;
  } catch { return ''; }
}

function ServiceRow({ item, editing, locked, onEdit, onRemove }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } = useSortable({ id: item.id, disabled: !editing || locked });
  const label = <>
    <i className={`ti ${item.icon || 'ti-link'} project-service-icon`} aria-hidden="true" />
    <span className="project-service-name">{item.label}</span>
    {item.paid && <span className="service-chip__paid">Paid</span>}
  </>;
  const url = serviceUrl(item.url);
  if (!editing) return url
    ? <a className="project-service-row" href={url} target="_blank" rel="noreferrer" title={url}>{label}<i className="ti ti-arrow-up-right" aria-hidden="true" /></a>
    : <div className="project-service-row">{label}</div>;

  return <div className="project-service-row" ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
    <button className="btn btn--ghost btn--icon" ref={setActivatorNodeRef} {...attributes} {...listeners} type="button" aria-label={`Reorder ${item.label}`}><i className="ti ti-grip-vertical" /></button>
    {label}
    <button className="btn btn--ghost btn--icon" type="button" aria-label={`Edit ${item.label}`} title="Edit service" disabled={locked} onClick={() => onEdit(item)}><i className="ti ti-pencil" /></button>
    <button className="btn btn--ghost btn--icon" type="button" aria-label={`Remove ${item.label}`} title="Remove service" disabled={locked} onClick={() => onRemove(item.id)}><i className="ti ti-x" /></button>
  </div>;
}

function ServiceForm({ item, groups, onSave, onClose, saving, error }) {
  const groupList = useId();
  const [draft, setDraft] = useState({ label: '', url: '', icon: 'ti-world', paid: false, group: '', ...item });
  const patch = (changes) => setDraft((current) => ({ ...current, ...changes }));
  const url = serviceUrl(draft.url);

  function submit(event) {
    event.preventDefault();
    if (draft.label.trim() && url) onSave({ ...draft, label: draft.label.trim(), url, group: draft.group.trim() });
  }

  return <Modal title={item.id ? 'Edit service' : 'Add service'} onClose={onClose}>
    <form className="project-service-form" onSubmit={submit}>
      {!item.id && <label className="field"><span className="field-label">Preset</span>
        <select className="select" defaultValue="" onChange={(event) => {
          const preset = PRESETS.find(([name]) => name === event.target.value);
          if (!preset) return;
          const [label, icon, url, paid = false] = preset;
          patch({ label, icon, url, paid });
        }}>
          <option value="">Custom service</option>
          {PRESETS.map(([name]) => <option key={name}>{name}</option>)}
        </select>
      </label>}
      <label className="field"><span className="field-label">Name</span><input className="input" autoFocus value={draft.label} onChange={(event) => patch({ label: event.target.value })} required /></label>
      <label className="field"><span className="field-label">URL</span><input className="input" placeholder="https://…" value={draft.url} onChange={(event) => patch({ url: event.target.value })} required /></label>
      <label className="field"><span className="field-label">Group</span><input className="input" list={groupList} placeholder="Choose or name a group" value={draft.group} maxLength={80} onChange={(event) => patch({ group: event.target.value })} /></label>
      <datalist id={groupList}>{groups.filter(Boolean).map((group) => <option key={group} value={group} />)}</datalist>
      <fieldset>
        <legend className="field-label">Icon</legend>
        <div className="service-icon-grid">
          {ICONS.map((icon) => <button key={icon} type="button" aria-label={icon.slice(3).replaceAll('-', ' ')} aria-pressed={draft.icon === icon} className={`service-icon-pick ${draft.icon === icon ? 'active' : ''}`} onClick={() => patch({ icon })}><i className={`ti ${icon}`} /></button>)}
        </div>
      </fieldset>
      <label className="row"><input type="checkbox" checked={draft.paid} onChange={(event) => patch({ paid: event.target.checked })} /> Paid service</label>
      {draft.url.trim() && !url && <p className="project-error" role="alert">Enter a valid web URL.</p>}
      {error && <p className="project-error" role="alert">{error}</p>}
      <div className="project-charter-actions">
        <button className="btn btn--ghost" type="button" disabled={saving} onClick={onClose}>Cancel</button>
        <button className="btn btn--accent" disabled={saving || !draft.label.trim() || !url}>{saving ? 'Saving…' : item.id ? 'Save' : 'Add service'}</button>
      </div>
    </form>
  </Modal>;
}

export default function ServiceLinks({ value, onChange }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const links = Array.isArray(value) ? value : [];
  const groups = [...new Set(links.map(groupOf))];

  function changeDraft(next) {
    if (saving) return;
    setError('');
    setDraft(next);
  }

  async function save(next) {
    if (saving) return false;
    setSaving(true);
    setError('');
    try {
      await onChange(next);
      return true;
    } catch (reason) {
      setError(reason.message || 'Could not save services.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveItem(item) {
    const group = groups.find((name) => name.toLowerCase() === item.group.toLowerCase()) ?? item.group;
    const updated = { ...item, group };
    const next = updated.id
      ? links.map((link) => link.id === updated.id ? updated : link)
      : [...links, { ...updated, id: crypto.randomUUID() }];
    if (await save(next)) setDraft(null);
  }

  function dragEnd({ active, over }) {
    if (!over || over.id === active.id) return;
    const source = links.findIndex((link) => link.id === active.id);
    const target = links.findIndex((link) => link.id === over.id);
    if (source < 0 || target < 0) return;
    save(arrayMove(links.map((link, i) => i === source ? { ...link, group: groupOf(links[target]) } : link), source, target));
  }

  function renameGroup(group) {
    const next = window.prompt('Service group name', group);
    if (next === null || next.trim() === group) return;
    const name = next.trim().slice(0, 80);
    const canonical = groups.find((existing) => existing.toLowerCase() === name.toLowerCase() && existing !== group) ?? name;
    save(links.map((item) => groupOf(item) === group ? { ...item, group: canonical } : item));
  }

  return <div className="project-services">
    <div className="project-services-tools">
      {links.length > 0 && <button className="btn btn--ghost btn--sm" disabled={saving} onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Arrange'}</button>}
      <button className="btn btn--ghost btn--sm" disabled={saving} onClick={() => changeDraft({})}><i className="ti ti-plus" /> Add service</button>
    </div>
    {error && !draft && <p className="project-error" role="alert">{error}</p>}
    {links.length === 0 && <p className="project-widget-empty">No service links yet.</p>}
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}>
      {groups.map((group) => {
        const items = links.filter((item) => groupOf(item) === group);
        return <div className="project-service-group" key={group}>
          {(group || groups.length > 1) && <div className="project-service-group-label">
            <h3>{group || 'Ungrouped'}</h3>
            {editing && <button className="btn btn--ghost btn--icon" disabled={saving} aria-label={`Rename ${group || 'ungrouped services'}`} onClick={() => renameGroup(group)}><i className="ti ti-pencil" /></button>}
          </div>}
          <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
            {items.map((item) => <ServiceRow key={item.id} item={item} editing={editing} locked={saving} onEdit={changeDraft}
              onRemove={(id) => save(links.filter((link) => link.id !== id))} />)}
          </SortableContext>
        </div>;
      })}
    </DndContext>
    {draft && <ServiceForm item={draft} groups={groups} saving={saving} error={error} onClose={() => changeDraft(null)} onSave={saveItem} />}
  </div>;
}
