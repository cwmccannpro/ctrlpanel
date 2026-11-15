// ============================================================
// CTRLpanel — Services quick-links bar (reusable, controlled)
// A reorderable row of links to the services a project uses (GitHub repo,
// Cloudflare project, Supabase project, …). Add from presets or fully custom,
// mark paid services with a "Paid" tag, drag to reorder, edit/remove.
//
// Controlled: pass `value` (array of { id, label, url, icon, paid }) and
// `onChange(next)` — the parent decides where it's persisted. On a project
// page that's the project row's `service_links` column.
// ============================================================
import { useState, useEffect } from 'react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Modal from './shared/Modal.jsx';

const newId = () => `svc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

// One-click starting points. Users can add custom entries too.
const PRESETS = [
  { label: 'GitHub', icon: 'ti-brand-github', url: 'https://github.com', paid: false },
  { label: 'Cloudflare', icon: 'ti-brand-cloudflare', url: 'https://dash.cloudflare.com', paid: false },
  { label: 'Supabase', icon: 'ti-brand-supabase', url: 'https://supabase.com/dashboard', paid: false },
  { label: 'Vercel', icon: 'ti-brand-vercel', url: 'https://vercel.com/dashboard', paid: false },
  { label: 'Netlify', icon: 'ti-brand-netlify', url: 'https://app.netlify.com', paid: false },
  { label: 'Stripe', icon: 'ti-brand-stripe', url: 'https://dashboard.stripe.com', paid: true },
  { label: 'Anthropic', icon: 'ti-sparkles', url: 'https://console.anthropic.com', paid: true },
  { label: 'OpenAI', icon: 'ti-brand-openai', url: 'https://platform.openai.com', paid: true },
  { label: 'Figma', icon: 'ti-brand-figma', url: 'https://figma.com', paid: false },
  { label: 'Notion', icon: 'ti-brand-notion', url: 'https://notion.so', paid: false },
  { label: 'AWS', icon: 'ti-brand-aws', url: 'https://console.aws.amazon.com', paid: true },
  { label: 'Linear', icon: 'ti-brand-linear', url: 'https://linear.app', paid: true },
];

// Icon choices for the add/edit modal (brand marks + a few generics).
const ICON_CHOICES = [
  'ti-brand-github', 'ti-brand-gitlab', 'ti-brand-cloudflare', 'ti-brand-supabase',
  'ti-brand-vercel', 'ti-brand-netlify', 'ti-brand-aws', 'ti-brand-google',
  'ti-brand-firebase', 'ti-brand-stripe', 'ti-brand-openai', 'ti-sparkles',
  'ti-brand-figma', 'ti-brand-notion', 'ti-brand-slack', 'ti-brand-discord',
  'ti-brand-linear', 'ti-brand-npm', 'ti-brand-docker', 'ti-brand-python',
  'ti-cloud', 'ti-database', 'ti-server', 'ti-terminal-2',
  'ti-credit-card', 'ti-chart-bar', 'ti-mail', 'ti-world',
];

function normalizeUrl(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

function Chip({ item, editing, onEdit, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const inner = (
    <>
      <i className={`ti ${item.icon || 'ti-link'} service-chip__icon`} />
      <span className="service-chip__label">{item.label}</span>
      {item.paid && <span className="service-chip__paid">Paid</span>}
    </>
  );

  if (editing) {
    return (
      <div ref={setNodeRef} style={style} className="service-chip service-chip--editing" {...attributes} {...listeners}>
        {inner}
        <button
          className="service-chip__btn"
          title="Edit"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onEdit(item); }}
        >
          <i className="ti ti-pencil" />
        </button>
        <button
          className="service-chip__btn"
          title="Remove"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onRemove(item.id); }}
        >
          <i className="ti ti-x" />
        </button>
      </div>
    );
  }

  return (
    <a className="service-chip" href={item.url} target="_blank" rel="noopener noreferrer" title={item.url}>
      {inner}
    </a>
  );
}

function EditModal({ draft, onSave, onClose }) {
  const [label, setLabel] = useState(draft.label || '');
  const [url, setUrl] = useState(draft.url || '');
  const [icon, setIcon] = useState(draft.icon || 'ti-world');
  const [paid, setPaid] = useState(!!draft.paid);

  const save = () => {
    if (!label.trim() || !url.trim()) return;
    onSave({ ...draft, label: label.trim(), url: normalizeUrl(url), icon, paid });
  };

  return (
    <Modal title={draft.id ? 'Edit service' : 'Add a service'} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div className="section-label" style={{ marginBottom: 4 }}>Name</div>
          <input className="input" placeholder="e.g. GitHub" value={label} autoFocus
            onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        </div>
        <div>
          <div className="section-label" style={{ marginBottom: 4 }}>URL</div>
          <input className="input" placeholder="github.com/your-org" value={url}
            onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        </div>
        <div>
          <div className="section-label" style={{ marginBottom: 6 }}>Icon</div>
          <div className="service-icon-grid">
            {ICON_CHOICES.map((ic) => (
              <button key={ic} type="button" className={`service-icon-pick ${icon === ic ? 'active' : ''}`} onClick={() => setIcon(ic)} title={ic}>
                <i className={`ti ${ic}`} />
              </button>
            ))}
          </div>
        </div>
        <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
          <div className={`switch ${paid ? 'on' : ''}`} onClick={() => setPaid((v) => !v)} />
          <span className="body-text" style={{ color: 'var(--text-primary)' }}>Paid service — show a “Paid” tag</span>
        </label>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--accent" onClick={save} disabled={!label.trim() || !url.trim()}>
            {draft.id ? 'Save' : 'Add service'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function ServiceLinks({ value = [], onChange, label = 'Services' }) {
  const [links, setLinks] = useState(() => (Array.isArray(value) ? value : []));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null); // open modal when set
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Keep local state in sync when the parent's value changes.
  useEffect(() => {
    setLinks(Array.isArray(value) ? value : []);
  }, [value]);

  // Optimistic local update + hand the new array to the parent to persist.
  const apply = (next) => {
    setLinks(next);
    onChange?.(next);
  };

  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const oldIndex = links.findIndex((l) => l.id === active.id);
    const newIndex = links.findIndex((l) => l.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    apply(arrayMove(links, oldIndex, newIndex));
  };

  const remove = (id) => apply(links.filter((l) => l.id !== id));
  const addPreset = (p) => apply([...links, { ...p, id: newId() }]);

  const saveDraft = (data) => {
    if (data.id && links.some((l) => l.id === data.id)) {
      apply(links.map((l) => (l.id === data.id ? data : l)));
    } else {
      apply([...links, { ...data, id: newId() }]);
    }
    setDraft(null);
  };

  // Presets not already added (by label) — offered as quick-adds.
  const remainingPresets = PRESETS.filter((p) => !links.some((l) => l.label.toLowerCase() === p.label.toLowerCase()));

  return (
    <div className="services-bar">
      <div className="services-head">
        <div className="section-label">{label}</div>
        <div className="row" style={{ gap: 6 }}>
          {links.length > 0 && (
            <button className={`btn btn--ghost btn--sm ${editing ? 'btn--accent' : ''}`} onClick={() => setEditing((v) => !v)}>
              <i className={`ti ${editing ? 'ti-check' : 'ti-arrows-move'}`} /> {editing ? 'Done' : 'Arrange'}
            </button>
          )}
          <button className="btn btn--ghost btn--sm" onClick={() => setDraft({ icon: 'ti-world', paid: false })}>
            <i className="ti ti-plus" /> Add
          </button>
        </div>
      </div>

      {links.length === 0 ? (
        <div className="services-empty">
          <span className="list-row-meta">Quick links to the services your projects use. Add one, or start with:</span>
          <div className="services-preset-row">
            {PRESETS.slice(0, 6).map((p) => (
              <button key={p.label} className="service-chip service-chip--add" onClick={() => addPreset(p)}>
                <i className={`ti ${p.icon} service-chip__icon`} />
                <span className="service-chip__label">{p.label}</span>
                <i className="ti ti-plus service-chip__plus" />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={links.map((l) => l.id)} strategy={rectSortingStrategy}>
            <div className="services-chips">
              {links.map((item) => (
                <Chip key={item.id} item={item} editing={editing} onEdit={setDraft} onRemove={remove} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {editing && remainingPresets.length > 0 && (
        <div className="services-preset-row" style={{ marginTop: 10 }}>
          <span className="list-row-meta" style={{ alignSelf: 'center' }}>Add:</span>
          {remainingPresets.map((p) => (
            <button key={p.label} className="service-chip service-chip--add" onClick={() => addPreset(p)}>
              <i className={`ti ${p.icon} service-chip__icon`} />
              <span className="service-chip__label">{p.label}</span>
              <i className="ti ti-plus service-chip__plus" />
            </button>
          ))}
        </div>
      )}

      {draft && <EditModal draft={draft} onSave={saveDraft} onClose={() => setDraft(null)} />}
    </div>
  );
}
