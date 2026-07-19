import { useState, useEffect, useRef, useCallback } from 'react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Card from '../components/shared/Card.jsx';
import Modal from '../components/shared/Modal.jsx';
import { useMasterController } from '../components/MasterController.jsx';
import { useAuth } from '../components/AuthProvider.jsx';
import { saveUserSettings } from '../lib/supabase.js';
import { WIDGETS, WIDGETS_BY_ID, DEFAULT_WIDGETS, sizeFor } from '../components/dashboardWidgets.jsx';
import { greeting, formatClock, formatLongDate, clamp } from '../lib/helpers.js';

const COLS = 12;      // board grid columns — keep in sync with CSS grid-template-columns
const ROW_H = 84;     // one row unit (px) — keep in sync with CSS grid-auto-rows
const GAP = 12;       // board gap (px) — keep in sync with CSS gap
const MAX_H = 12;

let uidSeq = 0;
const newUid = () => `wg-${Date.now()}-${uidSeq++}`;

// Accept every saved shape: legacy string[] entries, legacy 6-column sized
// objects (no `v` — widths are doubled onto the 12-column board), and the
// current v2 objects that also carry per-widget `cfg`.
function normalizeLayout(arr) {
  return (arr || [])
    .map((it, i) => {
      if (typeof it === 'string') return { uid: `w${i}-${it}`, id: it, ...sizeFor(it), cfg: {} };
      if (it && it.id) {
        const d = sizeFor(it.id);
        const w = it.w != null && !it.v ? Number(it.w) * 2 : Number(it.w) || d.w;
        return {
          uid: it.uid || `w${i}-${it.id}`,
          id: it.id,
          w: clamp(w || d.w, 1, COLS),
          h: clamp(Number(it.h) || d.h, 1, MAX_H),
          cfg: it.cfg && typeof it.cfg === 'object' ? it.cfg : {},
        };
      }
      return null;
    })
    .filter(Boolean);
}

function ChatBar() {
  const { send } = useMasterController();
  const [text, setText] = useState('');
  const submit = () => {
    if (!text.trim()) return;
    send(text);
    setText('');
  };
  return (
    <Card className="mc-bar master-controller-input" static>
      <i className="ti ti-sparkles mc-bar-icon" />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="Ask the Master Controller anything…"
      />
      <button className="mc-send" onClick={submit} disabled={!text.trim()} aria-label="Send">
        <i className="ti ti-arrow-up" />
      </button>
    </Card>
  );
}

function SortableWidget({ item, onRemove, onResizeStart, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.uid });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    '--w': item.w,
    '--h': item.h,
    zIndex: isDragging ? 30 : undefined,
    opacity: isDragging ? 0.8 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} className="widget">
      <button className="widget-grip" {...attributes} {...listeners} title="Drag to move">
        <i className="ti ti-grip-vertical" />
      </button>
      <button className="widget-remove" onClick={() => onRemove(item.uid)} title="Remove widget">
        <i className="ti ti-x" />
      </button>
      {children}
      <div className="widget-resize" onPointerDown={(e) => onResizeStart(item.uid, e)} title="Drag to resize" />
    </div>
  );
}

export default function Dashboard() {
  const { displayName, user, settings } = useAuth();
  const [now, setNow] = useState(new Date());
  const [picker, setPicker] = useState(false);
  const [widgets, setWidgets] = useState(() => normalizeLayout(DEFAULT_WIDGETS));
  const boardRef = useRef(null);
  const loadedRef = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Load the saved layout once (later edits are local + saved silently, so we
  // don't resync/remount widgets on every settings refresh).
  useEffect(() => {
    if (loadedRef.current) return;
    if (Array.isArray(settings?.dashboard_widgets)) {
      setWidgets(normalizeLayout(settings.dashboard_widgets));
      loadedRef.current = true;
    }
  }, [settings?.dashboard_widgets]);

  const save = useCallback(
    (list) => {
      if (user?.id) {
        saveUserSettings(user.id, { dashboard_widgets: list.map(({ id, w, h, cfg }) => ({ id, w, h, cfg, v: 2 })) }).catch(() => {});
      }
    },
    [user?.id]
  );

  const apply = (updater) =>
    setWidgets((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      save(next);
      return next;
    });

  const addWidget = (id) => {
    apply((prev) => [...prev, { uid: newUid(), id, ...sizeFor(id), cfg: {} }]);
    setPicker(false);
  };
  const removeWidget = (uid) => apply((prev) => prev.filter((w) => w.uid !== uid));
  // Per-widget settings (view mode, board filter, …) saved with the layout.
  const updateCfg = (uid, patch) =>
    apply((prev) => prev.map((w) => (w.uid === uid ? { ...w, cfg: { ...w.cfg, ...patch } } : w)));

  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    apply((prev) => {
      const from = prev.findIndex((w) => w.uid === active.id);
      const to = prev.findIndex((w) => w.uid === over.id);
      return arrayMove(prev, from, to);
    });
  };

  // ---- Corner-drag resize (snaps to grid units) ----
  const onResizeStart = (uid, e) => {
    e.preventDefault();
    e.stopPropagation();
    const board = boardRef.current;
    const item = widgets.find((w) => w.uid === uid);
    if (!board || !item) return;
    const colW = (board.clientWidth - GAP * (COLS - 1)) / COLS;
    const start = { x: e.clientX, y: e.clientY, w: item.w, h: item.h };

    const onMove = (ev) => {
      const dw = Math.round((ev.clientX - start.x) / (colW + GAP));
      const dh = Math.round((ev.clientY - start.y) / (ROW_H + GAP));
      setWidgets((prev) =>
        prev.map((w) =>
          w.uid === uid ? { ...w, w: clamp(start.w + dw, 1, COLS), h: clamp(start.h + dh, 1, MAX_H) } : w
        )
      );
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setWidgets((prev) => {
        save(prev);
        return prev;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: '100%' }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <div className="dash-greeting">{greeting(now)}, {displayName}</div>
          <div className="dash-clock">{formatLongDate(now)} · {formatClock(now)}</div>
        </div>
        <button className="btn btn--accent btn--sm" onClick={() => setPicker(true)}>
          <i className="ti ti-plus" /> Add Widget
        </button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={widgets.map((w) => w.uid)} strategy={rectSortingStrategy}>
          <div className="widget-board" ref={boardRef}>
            {widgets.map((item) => {
              const def = WIDGETS_BY_ID[item.id];
              if (!def) return null;
              const C = def.Component;
              return (
                <SortableWidget key={item.uid} item={item} onRemove={removeWidget} onResizeStart={onResizeStart}>
                  <C cfg={item.cfg} onCfg={(patch) => updateCfg(item.uid, patch)} />
                </SortableWidget>
              );
            })}
            <button className="widget-add-tile" onClick={() => setPicker(true)}>
              <i className="ti ti-plus" />
              <span>Add Widget</span>
            </button>
          </div>
        </SortableContext>
      </DndContext>

      <ChatBar />

      {picker && (
        <Modal title="Add a Widget" onClose={() => setPicker(false)}>
          <div className="widget-picker">
            {WIDGETS.filter((w) => !w.hidden).map((w) => (
              <button className="widget-pick" key={w.id} onClick={() => addWidget(w.id)}>
                <i className={`ti ${w.icon}`} />
                <span>{w.title}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
