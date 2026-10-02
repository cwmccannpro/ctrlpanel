// ============================================================
// CTRLpanel — Dashboard (dynamic, card-less layout engine)
//
// Three columns of panels on seamless surfaces. Every panel can be dragged
// (within a column or across columns), height-resized, and removed; new ones
// come from the Add panel picker. Column widths drag too. The whole layout —
// panel placement, per-panel heights + settings, and column widths — is saved
// per user in `user_settings.dashboard_widgets`.
//
// Panels themselves live in components/dashboardPanels.jsx.
// ============================================================
import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  DndContext, DragOverlay, closestCorners, PointerSensor, useSensor, useSensors, useDroppable,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Modal from '../components/shared/Modal.jsx';
import { useAuth } from '../components/AuthProvider.jsx';
import { saveUserSettings } from '../lib/supabase.js';
import { PANELS, PANELS_BY_ID, DEFAULT_LAYOUT, LAYOUTS } from '../components/dashboardPanels.jsx';
import { greeting, formatClock, formatLongDate, clamp } from '../lib/helpers.js';

const COL_COUNT = 3;
const MIN_PANEL_H = 90;
const MAX_PANEL_H = 900;

let uidSeq = 0;
const newUid = (id) => `${id}-${Date.now()}-${uidSeq++}`;

/* ---------- layout normalization ---------- */
const makeItem = (id, cfg = {}, h = null) => ({ uid: newUid(id), id, cfg, h });

function defaultColumns(layout = DEFAULT_LAYOUT) {
  return layout.map((ids) => ids.filter((id) => PANELS_BY_ID[id]).map((id) => makeItem(id)));
}

const idsOf = (cols) => JSON.stringify(cols.map((col) => (Array.isArray(col) ? col.map((it) => it.id) : [])));
// A saved layout nobody has customized: no panel has a height or settings.
const untouched = (cols) =>
  cols.every((col) => Array.isArray(col) && col.every((it) => !(Number(it.h) > 0) && !Object.keys(it.cfg || {}).length));

// Accepts the current shape plus older saved shapes (v4/v5 board-panel arrays).
function normalize(saved) {
  if (!saved || Array.isArray(saved)) return defaultColumns();

  if (Array.isArray(saved.columns) && saved.columns.length) {
    const oldDefault = [['board', 'board', 'board'], ['networth', 'cashflow', 'investing', 'youtube'], ['habits_grid', 'habits_trend', 'macros', 'supplements', 'fitness']];
    if (idsOf(saved.columns) === JSON.stringify(oldDefault)) return defaultColumns();
    // Still on the previous default (now the Work layout) and never customized -> move to Today.
    if (idsOf(saved.columns) === JSON.stringify(LAYOUTS.work) && untouched(saved.columns)) return defaultColumns();
    const cols = saved.columns.slice(0, COL_COUNT).map((col) =>
      (Array.isArray(col) ? col : [])
        .filter((it) => it && PANELS_BY_ID[it.id])
        .map((it) => ({
          uid: it.uid || newUid(it.id),
          id: it.id,
          cfg: it.cfg && typeof it.cfg === 'object' ? it.cfg : {},
          h: Number(it.h) > 0 ? clamp(Number(it.h), MIN_PANEL_H, MAX_PANEL_H) : null,
        }))
    );
    while (cols.length < COL_COUNT) cols.push([]);
    return cols;
  }

  // v4/v5: { panels: [{board_id, column}], options: {...} } → rebuild.
  if (Array.isArray(saved.panels)) {
    const o = saved.options || {};
    const left = saved.panels.map((p) => makeItem('board', { board_id: p.board_id, column: p.column }));
    return [
      left.length ? left : [makeItem('board')],
      [
        makeItem('networth'),
        makeItem('cashflow', { range: o.cashflowRange }),
        makeItem('investing', { scale: o.investingScale }),
        makeItem('youtube'),
      ],
      [
        makeItem('habits_grid'),
        makeItem('habits_trend', { range: o.habitRange }),
        makeItem('life'),
        makeItem('knowledge'),
        makeItem('supplements'),
        makeItem('fitness'),
      ],
    ];
  }
  return defaultColumns();
}

/* ---------- a single draggable / resizable panel ---------- */
function PanelShell({ item, editing, onRemove, onHeight, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.uid });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };
  const def = PANELS_BY_ID[item.id];

  const startResize = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const el = e.currentTarget.parentElement;
    const startH = item.h || el.getBoundingClientRect().height;
    const onMove = (ev) => onHeight(clamp(startH + (ev.clientY - startY), MIN_PANEL_H, MAX_PANEL_H), false);
    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      onHeight(clamp(startH + (ev.clientY - startY), MIN_PANEL_H, MAX_PANEL_H), true);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div ref={setNodeRef} style={style} className={`dash2-panel ${editing ? 'is-editing' : ''}`}>
      {editing && (
        <div className="dash2-panel-tools">
          <button className="dash2-tool" title={`Move ${def?.title || ''}`} {...attributes} {...listeners}>
            <i className="ti ti-grip-vertical" />
          </button>
          {item.h && (
            <button className="dash2-tool" title="Reset height" onClick={() => onHeight(null, true)}>
              <i className="ti ti-arrow-autofit-height" />
            </button>
          )}
          <button className="dash2-tool" title="Remove panel" onClick={onRemove}>
            <i className="ti ti-x" />
          </button>
        </div>
      )}
      <div className="dash2-panel-body" style={item.h ? { maxHeight: item.h, overflowY: 'auto' } : undefined}>
        {children}
      </div>
      {editing && <div className="dash2-panel-resize" onPointerDown={startResize} title="Drag to set height" />}
    </div>
  );
}

/* ---------- a column surface ---------- */
function Column({ index, items, editing, onRemove, onHeight, onCfg, onAdd }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col-${index}` });
  return (
    <div ref={setNodeRef} className={`dash2-surface dash2-col${index + 1} ${isOver ? 'is-over' : ''}`}>
      <SortableContext items={items.map((i) => i.uid)} strategy={verticalListSortingStrategy}>
        {items.map((item) => {
          const def = PANELS_BY_ID[item.id];
          if (!def) return null;
          const C = def.Component;
          return (
            <PanelShell
              key={item.uid}
              item={item}
              editing={editing}
              onRemove={() => onRemove(item.uid)}
              onHeight={(h, persist) => onHeight(item.uid, h, persist)}
            >
              <C cfg={item.cfg} onCfg={(patch) => onCfg(item.uid, patch)} />
            </PanelShell>
          );
        })}
      </SortableContext>
      {items.length === 0 && <div className="dash2-col-empty">Drop a panel here</div>}
      {editing && (
        <button className="dash2-add" onClick={() => onAdd(index)}>
          <i className="ti ti-plus" /> Add panel
        </button>
      )}
    </div>
  );
}

/* ---------- page ---------- */
export default function Dashboard() {
  const { displayName, user, settings } = useAuth();
  const [now, setNow] = useState(new Date());
  const [columns, setColumns] = useState(null);
  const [cols, setColsW] = useState([34, 33]);
  const [editing, setEditing] = useState(false);
  const [picker, setPicker] = useState(null); // column index when open
  const [activeId, setActiveId] = useState(null);

  const containerRef = useRef(null);
  const initRef = useRef(false);
  const saveQueue = useRef(Promise.resolve());
  // Mirrors of the layout state. A cross-column move is applied during
  // onDragOver, so the render closure can lag behind by the time onDragEnd
  // persists; these always hold what was last set. State updaters stay pure —
  // saving from inside one would fire twice under StrictMode.
  const columnsRef = useRef(null);
  const colsRef = useRef(cols);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // Load saved layout once settings arrive.
  useEffect(() => {
    if (initRef.current || !settings) return;
    const saved = settings.dashboard_widgets;
    const normalized = normalize(saved);
    columnsRef.current = normalized;
    setColumns(normalized);
    if (saved && !Array.isArray(saved) && Array.isArray(saved.cols) && saved.cols.length === 2) {
      colsRef.current = saved.cols;
      setColsW(saved.cols);
    }
    initRef.current = true;
  }, [settings]);

  const persist = (nextColumns, nextCols) => {
    if (!user?.id) return;
    const payload = {
      v: 6,
      cols: nextCols ?? colsRef.current,
      columns: (nextColumns ?? columnsRef.current ?? []).map((col) =>
        col.map(({ uid, id, cfg, h }) => ({ uid, id, cfg, h }))
      ),
    };
    saveQueue.current = saveQueue.current
      .catch(() => {})
      .then(() => saveUserSettings(user.id, { dashboard_widgets: payload }))
      .catch(() => {});
  };

  const apply = (updater, save = true) => {
    const next = typeof updater === 'function' ? updater(columnsRef.current || []) : updater;
    columnsRef.current = next;
    setColumns(next);
    if (save) persist(next);
  };

  /* ---- panel ops ---- */
  const removePanel = (uid) => apply((prev) => prev.map((c) => c.filter((i) => i.uid !== uid)));
  const setPanelCfg = (uid, patch) =>
    apply((prev) => prev.map((c) => c.map((i) => (i.uid === uid ? { ...i, cfg: { ...i.cfg, ...patch } } : i))));
  const setPanelHeight = (uid, h, save) =>
    apply((prev) => prev.map((c) => c.map((i) => (i.uid === uid ? { ...i, h } : i))), save);
  const addPanel = (colIndex, id) => {
    apply((prev) => prev.map((c, i) => (i === colIndex ? [...c, makeItem(id)] : c)));
    setPicker(null);
  };

  /* ---- drag between / within columns ---- */
  const columnOf = (uid) => (columnsRef.current || []).findIndex((c) => c.some((i) => i.uid === uid));
  const colIndexFromOver = (overId) => {
    if (typeof overId === 'string' && overId.startsWith('col-')) return Number(overId.slice(4));
    return columnOf(overId);
  };

  const onDragOver = ({ active, over }) => {
    if (!over) return;
    const from = columnOf(active.id);
    const to = colIndexFromOver(over.id);
    if (from === -1 || to === -1 || from === to) return;
    apply((prev) => {
      const item = prev[from].find((i) => i.uid === active.id);
      if (!item) return prev;
      const next = prev.map((c) => c.filter((i) => i.uid !== active.id));
      const overIdx = next[to].findIndex((i) => i.uid === over.id);
      const at = overIdx === -1 ? next[to].length : overIdx;
      next[to] = [...next[to].slice(0, at), item, ...next[to].slice(at)];
      return next;
    }, false); // saved once the drag ends
  };

  const persistLatest = () => persist(columnsRef.current);

  const onDragEnd = ({ active, over }) => {
    setActiveId(null);
    if (!over) { persistLatest(); return; }
    const col = columnOf(active.id);
    const to = colIndexFromOver(over.id);
    if (col !== -1 && col === to && active.id !== over.id) {
      apply((prev) =>
        prev.map((c, i) => {
          if (i !== col) return c;
          const from = c.findIndex((x) => x.uid === active.id);
          const at = c.findIndex((x) => x.uid === over.id);
          return from === -1 || at === -1 ? c : arrayMove(c, from, at);
        })
      );
      return;
    }
    persistLatest(); // cross-column move already applied in onDragOver
  };

  /* ---- column width resize ---- */
  const startResize = (idx) => (e) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const onMove = (ev) => {
      const pctX = ((ev.clientX - rect.left) / rect.width) * 100;
      const [c1, c2] = colsRef.current;
      const next = idx === 0
        ? [clamp(pctX, 15, 100 - c2 - 15), c2]
        : [c1, clamp(pctX - c1, 15, 100 - c1 - 15)];
      colsRef.current = next;
      setColsW(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      persist(undefined, colsRef.current);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const shown = columns || [[], [], []];
  const used = useMemo(() => new Set(shown.flat().map((i) => i.id)), [shown]);
  const activeItem = activeId ? shown.flat().find((i) => i.uid === activeId) : null;
  const groups = useMemo(() => [...new Set(PANELS.map((p) => p.group))], []);

  return (
    <div className="fade-in dash2-page">
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <div className="dash-greeting">{greeting(now)}, {displayName}</div>
          <div className="dash-clock">{formatLongDate(now)} · {formatClock(now)}</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link className="btn btn--sm" to="/knowledge"><i className="ti ti-notebook" /> Capture context</Link>
          {editing && ['today', 'work'].map((key) => (
            <button
              key={key}
              className="btn btn--sm"
              onClick={() => { const next = defaultColumns(LAYOUTS[key]); columnsRef.current = next; setColumns(next); persistLatest(); }}
            >
              {key === 'today' ? 'Today layout' : 'Work layout'}
            </button>
          ))}
          {editing && (
            <button className="btn btn--sm" onClick={() => setPicker(0)}>
              <i className="ti ti-plus" /> Add panel
            </button>
          )}
          <button
            className={`btn btn--sm ${editing ? 'btn--accent' : ''}`}
            onClick={() => setEditing((v) => !v)}
            title={editing ? 'Finish editing' : 'Customize dashboard'}
          >
            <i className={`ti ${editing ? 'ti-check' : 'ti-layout-grid'}`} /> {editing ? 'Done' : 'Customize'}
          </button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={({ active }) => setActiveId(active.id)}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className={`dash2 ${editing ? 'is-editing' : ''}`} ref={containerRef} style={{ '--c1': `${cols[0]}%`, '--c2': `${cols[1]}%` }}>
          <Column
            index={0} items={shown[0]} editing={editing}
            onRemove={removePanel} onHeight={setPanelHeight} onCfg={setPanelCfg} onAdd={setPicker}
          />
          <div className="dash2-divider" onPointerDown={startResize(0)} title="Drag to resize" />
          <Column
            index={1} items={shown[1]} editing={editing}
            onRemove={removePanel} onHeight={setPanelHeight} onCfg={setPanelCfg} onAdd={setPicker}
          />
          <div className="dash2-divider" onPointerDown={startResize(1)} title="Drag to resize" />
          <Column
            index={2} items={shown[2]} editing={editing}
            onRemove={removePanel} onHeight={setPanelHeight} onCfg={setPanelCfg} onAdd={setPicker}
          />
        </div>

        <DragOverlay dropAnimation={null}>
          {activeItem && (
            <div className="dash2-drag-ghost">
              <i className={`ti ${PANELS_BY_ID[activeItem.id]?.icon || 'ti-box'}`} />
              {PANELS_BY_ID[activeItem.id]?.title || 'Panel'}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {picker !== null && (
        <Modal title="Add a panel" onClose={() => setPicker(null)}>
          <div className="field" style={{ marginBottom: 12 }}>
            <label className="field-label">Column</label>
            <div className="segmented">
              {[0, 1, 2].map((i) => (
                <button key={i} className={picker === i ? 'active' : ''} onClick={() => setPicker(i)}>
                  {['Left', 'Middle', 'Right'][i]}
                </button>
              ))}
            </div>
          </div>
          {groups.map((g) => (
            <div key={g} style={{ marginBottom: 14 }}>
              <div className="section-label" style={{ marginBottom: 6 }}>{g}</div>
              <div className="dash2-picker">
                {PANELS.filter((p) => p.group === g).map((p) => (
                  <button key={p.id} className="dash2-pick" onClick={() => addPanel(picker, p.id)}>
                    <i className={`ti ${p.icon}`} />
                    <span>{p.title}</span>
                    {used.has(p.id) && <i className="ti ti-check dash2-pick-used" title="Already on your dashboard" />}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </Modal>
      )}
    </div>
  );
}
