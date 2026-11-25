// ============================================================
// CTRLpanel — Dashboard (dynamic, card-less layout engine)
//
// A horizontally extensible canvas: as many columns of panels as you like (up to
// MAX_COLS), each with its own width. The canvas scrolls both ways — hold the middle
// mouse button (wheel click) and drag to pan, or use Shift+wheel, a trackpad or the
// arrow buttons. Every panel can be dragged (within a column or across columns),
// height-resized and removed; new ones come from the Add panel picker; columns can be
// added, reordered, widened and removed in Customize mode. The whole layout is saved
// per user in `user_settings.dashboard_widgets` (shape: lib/dashboardLayout.js).
//
// Outside Customize the columns fuse into one seamless surface (no per-panel or per-column
// separation). Named layouts ("configurations") can be saved from Customize → Saved layouts
// and appear as buttons left of "Capture context"; pressing Done writes the edits back to the
// active one.
//
// Panels themselves live in components/dashboardPanels.jsx.
// ============================================================
import { Fragment, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  DndContext, DragOverlay, closestCorners, PointerSensor, useSensor, useSensors, useDroppable,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Modal from '../components/shared/Modal.jsx';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import DashboardLayouts from '../components/DashboardLayouts.jsx';
import { useAuth } from '../components/AuthProvider.jsx';
import { useToast } from '../components/Toaster.jsx';
import { saveUserSettings } from '../lib/supabase.js';
import { PANELS, PANELS_BY_ID, DEFAULT_LAYOUT, LAYOUTS } from '../components/dashboardPanels.jsx';
import { financeDebtEnabled } from '../lib/financeSheet.js';
import { greeting, formatClock, formatLongDate, clamp } from '../lib/helpers.js';
import {
  DEFAULT_COL_W, MAX_COLS, addColumn, addConfig, moveColumn, moveConfig, normalizeConfigs, normalizeWidths,
  overflowInfo, removeColumn, removeConfig, renameConfig, scrollStep, serializeLayout, setColumnWidth,
  updateConfigLayout, widthsFromPercent,
} from '../lib/dashboardLayout.js';
import { scrollParent, useMiddleClickPan } from '../lib/useMiddleClickPan.js';

const MIN_PANEL_H = 90;
const MAX_PANEL_H = 900;

let uidSeq = 0;
const newUid = (id) => `${id}-${Date.now()}-${uidSeq++}`;

/* ---------- layout normalization ---------- */
const makeItem = (id, cfg = {}, h = null) => ({ uid: newUid(id), id, cfg, h });

function defaultColumns(layout = DEFAULT_LAYOUT) {
  return layout.map((ids) => ids.filter((id) => PANELS_BY_ID[id]).map((id) => makeItem(id)));
}

const idsOf = (cols) => JSON.stringify(cols.map((col) => (Array.isArray(col) ? col.map((it) => it?.id) : [])));
// A saved layout nobody has customized: no panel has a height or settings.
const untouched = (cols) =>
  cols.every((col) => Array.isArray(col) && col.every((it) => !(Number(it.h) > 0) && !Object.keys(it.cfg || {}).length));

const cleanColumn = (col) =>
  (Array.isArray(col) ? col : [])
    .filter((it) => it && PANELS_BY_ID[it.id])
    .map((it) => ({
      uid: it.uid || newUid(it.id),
      id: it.id,
      cfg: it.cfg && typeof it.cfg === 'object' ? it.cfg : {},
      h: Number(it.h) > 0 ? clamp(Number(it.h), MIN_PANEL_H, MAX_PANEL_H) : null,
    }));

/**
 * Saved layout → `{ columns, widths }`. Accepts the current shape (v7), the previous
 * percentage-based one (v6, converted to pixels using the canvas width) and the older
 * board-panel arrays (v4/v5).
 */
function normalize(saved, containerWidth, configs = []) {
  const fresh = (layout) => {
    const columns = defaultColumns(layout);
    return { columns, widths: normalizeWidths(undefined, columns.length) };
  };
  if (!saved || Array.isArray(saved)) return fresh();

  // A saved layout is active: the live layout is that configuration (or a Customize draft of
  // it) — take it exactly as stored, never through the default-layout migrations below.
  const activeConfig = configs.find((c) => c.id === saved.active);
  if (activeConfig) {
    if (!Array.isArray(saved.columns) || !saved.columns.length) return { columns: activeConfig.columns, widths: activeConfig.widths };
    const columns = saved.columns.slice(0, MAX_COLS).map(cleanColumn);
    return { columns, widths: normalizeWidths(saved.widths, columns.length) };
  }

  if (Array.isArray(saved.columns) && saved.columns.length) {
    const oldDefault = [['board', 'board', 'board'], ['networth', 'cashflow', 'investing', 'youtube'], ['habits_grid', 'habits_trend', 'macros', 'supplements', 'fitness']];
    if (idsOf(saved.columns) === JSON.stringify(oldDefault)) return fresh();
    // Still on the previous default (now the Work layout, with or without the retired
    // Opportunities panel) and never customized -> move to Today.
    const oldWork = [['quick_add', 'upcoming_tasks', 'board'], ['schedule', 'projects'], ['knowledge', 'opportunities', 'crm']];
    if ([LAYOUTS.work, oldWork].some((l) => idsOf(saved.columns) === JSON.stringify(l)) && untouched(saved.columns)) return fresh();

    const columns = saved.columns.slice(0, MAX_COLS).map(cleanColumn);
    const widths = Array.isArray(saved.widths)
      ? normalizeWidths(saved.widths, columns.length)
      : widthsFromPercent(saved.cols, columns.length, containerWidth); // v6 percentages
    return { columns, widths };
  }

  // v4/v5: { panels: [{board_id, column}], options: {...} } → rebuild.
  if (Array.isArray(saved.panels)) {
    const o = saved.options || {};
    const left = saved.panels.map((p) => makeItem('board', { board_id: p.board_id, column: p.column }));
    const columns = [
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
    return { columns, widths: normalizeWidths(undefined, columns.length) };
  }
  return fresh();
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
function Column({ index, count, width, items, editing, onRemove, onHeight, onCfg, onAdd, onMoveCol, onRemoveCol }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col-${index}` });
  // The width is a minimum: spare room is shared out in proportion to it (see styles).
  return (
    <div
      ref={setNodeRef}
      className={`dash2-surface dash2-col ${isOver ? 'is-over' : ''}`}
      style={{ flex: `${width} 0 ${width}px`, minWidth: width }}
    >
      {editing && (
        <div className="dash2-colbar">
          <span className="dash2-colbar-name">Column {index + 1}</span>
          <button className="dash2-tool" title="Move column left" aria-label="Move column left" disabled={index === 0} onClick={() => onMoveCol(index, -1)}>
            <i className="ti ti-chevron-left" />
          </button>
          <button className="dash2-tool" title="Move column right" aria-label="Move column right" disabled={index === count - 1} onClick={() => onMoveCol(index, 1)}>
            <i className="ti ti-chevron-right" />
          </button>
          <button
            className="dash2-tool"
            title="Remove column (its panels move to the neighbouring column)"
            aria-label="Remove column"
            disabled={count === 1}
            onClick={() => onRemoveCol(index)}
          >
            <i className="ti ti-trash" />
          </button>
        </div>
      )}
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
              <ErrorBoundary fallback={(retry) => (
                <div className="dash2-panel-note" role="alert">
                  {def.title} couldn’t load.{' '}
                  <button className="btn btn--sm" onClick={retry}>Try again</button>
                </div>
              )}>
                <C cfg={item.cfg} onCfg={(patch) => onCfg(item.uid, patch)} />
              </ErrorBoundary>
            </PanelShell>
          );
        })}
      </SortableContext>
      {editing && items.length === 0 && <div className="dash2-col-empty">Drop a panel here</div>}
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
  const [widths, setWidths] = useState(null);
  const [editing, setEditing] = useState(false);
  const [configs, setConfigs] = useState([]); // saved layouts: [{ id, name, columns, widths }]
  const [active, setActive] = useState(null); // id of the saved layout on screen, if any
  const [layoutsOpen, setLayoutsOpen] = useState(false);
  const toast = useToast();
  const [picker, setPicker] = useState(null); // column index when open (columns.length = a new column)
  const [panelQuery, setPanelQuery] = useState('');
  const openPicker = (column) => { setPanelQuery(''); setPicker(column); };
  const [activeId, setActiveId] = useState(null);
  const [nav, setNav] = useState({ overflowing: false, canLeft: false, canRight: false });

  const pageRef = useRef(null);
  const canvasRef = useRef(null);
  const rowRef = useRef(null);
  const initRef = useRef(false);
  const saveQueue = useRef(Promise.resolve());
  // Mirrors of the layout state. A cross-column move is applied during
  // onDragOver, so the render closure can lag behind by the time onDragEnd
  // persists; these always hold what was last set. State updaters stay pure —
  // saving from inside one would fire twice under StrictMode.
  const columnsRef = useRef(null);
  const widthsRef = useRef(null);
  const configsRef = useRef([]);
  const activeRef = useRef(null);
  const editingRef = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // Load saved layout once settings arrive.
  useEffect(() => {
    if (initRef.current || !settings) return;
    const saved = settings.dashboard_widgets;
    const savedConfigs = normalizeConfigs(saved?.configs, cleanColumn);
    const { columns: cols, widths: w } = normalize(saved, canvasRef.current?.clientWidth || 0, savedConfigs);
    const act = savedConfigs.some((c) => c.id === saved?.active) ? saved.active : null;
    columnsRef.current = cols;
    widthsRef.current = w;
    configsRef.current = savedConfigs;
    activeRef.current = act;
    setColumns(cols);
    setWidths(w);
    setConfigs(savedConfigs);
    setActive(act);
    initRef.current = true;
  }, [settings]);

  const setConfigList = (next, nextActive = activeRef.current) => {
    configsRef.current = next;
    activeRef.current = next.some((c) => c.id === nextActive) ? nextActive : null;
    setConfigs(next);
    setActive(activeRef.current);
  };

  const persist = (nextColumns, nextWidths) => {
    if (!user?.id) return;
    const cols = nextColumns ?? columnsRef.current ?? [];
    const w = nextWidths ?? widthsRef.current ?? [];
    // Outside Customize the active saved layout follows the live one (panel settings, Day Plan
    // height…). Customize edits are a draft until Done, so "Save as new" can fork from them.
    if (activeRef.current && !editingRef.current) {
      setConfigList(updateConfigLayout(configsRef.current, activeRef.current, cols, w));
    }
    const payload = serializeLayout(cols, w, { configs: configsRef.current, active: activeRef.current });
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

  // Replace columns + widths together (column add / remove / move, layout presets).
  const commit = (nextColumns, nextWidths) => {
    columnsRef.current = nextColumns;
    widthsRef.current = nextWidths;
    setColumns(nextColumns);
    setWidths(nextWidths);
    persist(nextColumns, nextWidths);
  };

  /* ---- panel ops ---- */
  const removePanel = (uid) => apply((prev) => prev.map((c) => c.filter((i) => i.uid !== uid)));
  const setPanelCfg = (uid, patch) =>
    apply((prev) => prev.map((c) => c.map((i) => (i.uid === uid ? { ...i, cfg: { ...i.cfg, ...patch } } : i))));
  const setPanelHeight = (uid, h, save) =>
    apply((prev) => prev.map((c) => c.map((i) => (i.uid === uid ? { ...i, h } : i))), save);

  /* ---- canvas scrolling ---- */
  const scrollToEnd = () => requestAnimationFrame(() => canvasRef.current?.scrollTo({ left: canvasRef.current.scrollWidth, behavior: 'smooth' }));

  const updateNav = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const next = overflowInfo(c.scrollLeft, c.clientWidth, c.scrollWidth);
    setNav((prev) => (prev.overflowing === next.overflowing && prev.canLeft === next.canLeft && prev.canRight === next.canRight ? prev : next));
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return undefined;
    updateNav();
    c.addEventListener('scroll', updateNav, { passive: true });
    let ro;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(updateNav);
      ro.observe(c);
      if (rowRef.current) ro.observe(rowRef.current);
    }
    window.addEventListener('resize', updateNav);
    return () => {
      c.removeEventListener('scroll', updateNav);
      ro?.disconnect();
      window.removeEventListener('resize', updateNav);
    };
  }, [updateNav, columns?.length, widths]);

  const scrollByColumn = (dir) => {
    const c = canvasRef.current;
    if (!c) return;
    const step = (widthsRef.current?.[0] || DEFAULT_COL_W) + 16;
    c.scrollTo({ left: scrollStep(c.scrollLeft, c.clientWidth, c.scrollWidth, dir, step), behavior: 'smooth' });
  };

  // Middle-click + drag pans the canvas in both directions. When the canvas isn't
  // scrollable itself (phones stack the columns) the page's own scroller is panned.
  useMiddleClickPan(pageRef, () => {
    const c = canvasRef.current;
    if (!c) return {};
    if (c.scrollWidth > c.clientWidth + 1 || c.scrollHeight > c.clientHeight + 1) return { x: c, y: c };
    return { y: scrollParent(c) };
  });

  /* ---- column ops ---- */
  const addCol = () => {
    const r = addColumn(columnsRef.current, widthsRef.current);
    commit(r.columns, r.widths);
    scrollToEnd();
  };
  const removeCol = (i) => {
    const r = removeColumn(columnsRef.current, widthsRef.current, i);
    commit(r.columns, r.widths);
  };
  const moveCol = (i, dir) => {
    const r = moveColumn(columnsRef.current, widthsRef.current, i, dir);
    commit(r.columns, r.widths);
  };
  const applyLayout = (key) => {
    const cols = defaultColumns(LAYOUTS[key]);
    commit(cols, normalizeWidths(undefined, cols.length));
  };

  /* ---- saved layouts ---- */
  const startEditing = () => { editingRef.current = true; setEditing(true); };
  const finishEditing = () => {
    editingRef.current = false;
    setEditing(false);
    setLayoutsOpen(false);
    persist(); // writes the edits back to the active saved layout
  };
  const switchConfig = (id) => {
    const cfg = configsRef.current.find((c) => c.id === id);
    if (!cfg || id === activeRef.current) return;
    activeRef.current = id;
    setActive(id);
    commit(cfg.columns, cfg.widths);
  };
  const saveConfigAs = (name) => {
    const r = addConfig(configsRef.current, name, columnsRef.current || [], widthsRef.current || []);
    if (!r.id) return false;
    setConfigList(r.configs, r.id);
    persist();
    return true;
  };
  const changeConfigs = (next) => { setConfigList(next); persist(); };
  const deleteConfig = (id) => {
    const before = configsRef.current;
    const wasActive = activeRef.current;
    const gone = before.find((c) => c.id === id);
    changeConfigs(removeConfig(before, id));
    toast({
      message: `Deleted the “${gone?.name || 'layout'}” layout`,
      action: { label: 'Undo', onClick: () => { setConfigList(before, wasActive); persist(); } },
    });
  };

  const addPanel = (colIndex, id) => {
    let cols = columnsRef.current || [];
    let w = widthsRef.current || [];
    let target = colIndex;
    if (colIndex >= cols.length) {
      // "New column": append one, then drop the panel into it.
      const r = addColumn(cols, w);
      cols = r.columns;
      w = r.widths;
      target = cols.length - 1;
      scrollToEnd();
    }
    commit(cols.map((c, i) => (i === target ? [...c, makeItem(id)] : c)), w);
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

  const persistLatest = () => persist(columnsRef.current, widthsRef.current);

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

  /* ---- column width resize (drag the divider to the right of a column) ---- */
  const startResize = (idx) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const colEl = rowRef.current?.querySelectorAll(':scope > .dash2-surface')[idx];
    // Start from the width actually on screen (a column may be stretched to fill spare room).
    const startW = colEl?.getBoundingClientRect().width ?? widthsRef.current[idx];
    const startX = e.clientX;
    const onMove = (ev) => {
      const next = setColumnWidth(widthsRef.current, idx, startW + (ev.clientX - startX));
      widthsRef.current = next;
      setWidths(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      persist(columnsRef.current, widthsRef.current);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const includeDebt = financeDebtEnabled(settings);
  const shown = (columns || [[], [], []]).map((items) => items.filter((item) => includeDebt || item.id !== 'finance_debt'));
  const shownWidths = widths || normalizeWidths(undefined, shown.length);
  const used = useMemo(() => new Set(shown.flat().map((i) => i.id)), [shown]);
  const activeItem = activeId ? shown.flat().find((i) => i.uid === activeId) : null;
  const pickerPanels = useMemo(() => {
    const terms = panelQuery.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return PANELS.filter((panel) => {
      if (!includeDebt && panel.id === 'finance_debt') return false;
      const text = `${panel.title} ${panel.group} ${panel.description || ''} ${!includeDebt && panel.id === 'networth' ? 'total assets' : ''}`.toLowerCase();
      return terms.every((term) => text.includes(term));
    });
  }, [panelQuery, includeDebt]);
  const groups = [...new Set(pickerPanels.map((panel) => panel.group))];

  return (
    <div className="fade-in dash2-page" ref={pageRef}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <div className="dash-greeting">{greeting(now)}, {displayName}</div>
          <div className="dash-clock">{formatLongDate(now)} · {formatClock(now)}</div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {nav.overflowing && (
            <div className="dash2-pan" title="Middle-click and drag to pan · Shift+wheel scrolls sideways">
              <button className="btn btn--sm btn--ghost btn--icon" aria-label="Scroll columns left" disabled={!nav.canLeft} onClick={() => scrollByColumn(-1)}>
                <i className="ti ti-chevron-left" />
              </button>
              <button className="btn btn--sm btn--ghost btn--icon" aria-label="Scroll columns right" disabled={!nav.canRight} onClick={() => scrollByColumn(1)}>
                <i className="ti ti-chevron-right" />
              </button>
            </div>
          )}
          {!editing && configs.length > 0 && (
            <div className="segmented dash2-configs" role="group" aria-label="Saved layouts">
              {configs.map((c) => (
                <button
                  key={c.id}
                  className={c.id === active ? 'active' : ''}
                  aria-pressed={c.id === active}
                  title={c.id === active ? `${c.name} (showing)` : `Switch to ${c.name}`}
                  onClick={() => switchConfig(c.id)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
          <Link className="btn btn--sm" to="/context"><i className="ti ti-notebook" /> Capture context</Link>
          {editing && (
            <button className="btn btn--sm" onClick={() => setLayoutsOpen(true)}>
              <i className="ti ti-bookmarks" /> Saved layouts
            </button>
          )}
          {editing && ['today', 'work'].map((key) => (
            <button key={key} className="btn btn--sm" onClick={() => applyLayout(key)}>
              {key === 'today' ? 'Today layout' : 'Work layout'}
            </button>
          ))}
          {editing && shown.length < MAX_COLS && (
            <button className="btn btn--sm" onClick={addCol}>
              <i className="ti ti-layout-columns" /> Add column
            </button>
          )}
          {editing && (
            <button className="btn btn--sm" onClick={() => openPicker(0)}>
              <i className="ti ti-plus" /> Add panel
            </button>
          )}
          <button
            className={`btn btn--sm ${editing ? 'btn--accent' : ''}`}
            onClick={editing ? finishEditing : startEditing}
            title={editing
              ? (active ? `Finish editing and save to “${configs.find((c) => c.id === active)?.name}”` : 'Finish editing')
              : 'Customize dashboard'}
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
        <div className="dash2-canvas" ref={canvasRef}>
          <div className={`dash2 ${editing ? 'is-editing' : 'is-seamless'}`} ref={rowRef}>
            {shown.map((items, i) => (
              <Fragment key={i}>
                {i > 0 && (editing
                  ? <div className="dash2-divider" onPointerDown={startResize(i - 1)} title="Drag to resize" />
                  : <div className="dash2-divider" aria-hidden="true" />)}
                <Column
                  index={i}
                  count={shown.length}
                  width={shownWidths[i]}
                  items={items}
                  editing={editing}
                  onRemove={removePanel}
                  onHeight={setPanelHeight}
                  onCfg={setPanelCfg}
                  onAdd={openPicker}
                  onMoveCol={moveCol}
                  onRemoveCol={removeCol}
                />
              </Fragment>
            ))}
            {editing && shown.length < MAX_COLS && (
              <button className="dash2-addcol" onClick={addCol}>
                <i className="ti ti-plus" />
                <span>Add column</span>
              </button>
            )}
          </div>
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

      {layoutsOpen && (
        <DashboardLayouts
          configs={configs}
          active={active}
          onClose={() => setLayoutsOpen(false)}
          onSaveAs={saveConfigAs}
          onRename={(id, name) => changeConfigs(renameConfig(configsRef.current, id, name))}
          onMove={(id, dir) => changeConfigs(moveConfig(configsRef.current, id, dir))}
          onDelete={deleteConfig}
        />
      )}

      {picker !== null && (
        <Modal title="Add a panel" onClose={() => setPicker(null)} className="dash2-picker-modal">
          <div className="field">
            <label className="field-label" htmlFor="dashboard-panel-search">Find a panel</label>
            <input id="dashboard-panel-search" className="input" type="search" placeholder="Search nutrition, tasks, finance…" value={panelQuery} onChange={(event) => setPanelQuery(event.target.value)} autoFocus />
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label className="field-label">Column</label>
            <div className="segmented" style={{ flexWrap: 'wrap' }}>
              {shown.map((_, i) => (
                <button key={i} className={picker === i ? 'active' : ''} onClick={() => setPicker(i)}>
                  {i + 1}
                </button>
              ))}
              {shown.length < MAX_COLS && (
                <button className={picker >= shown.length ? 'active' : ''} onClick={() => setPicker(shown.length)}>
                  + New
                </button>
              )}
            </div>
          </div>
          <p className="dash2-panel-note" role="status">{pickerPanels.length} panel options · Add any panel to your chosen column.</p>
          {groups.length === 0 && <p className="dash2-panel-note">No panels match that search. Try a feature name or clear the search.</p>}
          {groups.map((g) => (
            <div key={g} style={{ marginBottom: 14 }}>
              <div className="section-label" style={{ marginBottom: 6 }}>{g}</div>
              <div className="dash2-picker">
                {pickerPanels.filter((p) => p.group === g).map((p) => (
                  <button key={p.id} className="dash2-pick" aria-label={!includeDebt && p.id === 'networth' ? 'Total Assets' : p.title} onClick={() => addPanel(picker, p.id)}>
                    <i className={`ti ${p.icon}`} aria-hidden="true" />
                    <span className="dash2-pick-copy"><strong>{!includeDebt && p.id === 'networth' ? 'Total Assets' : p.title}</strong>{p.description && <small>{p.description}</small>}</span>
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
