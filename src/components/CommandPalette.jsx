import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useWorkspace } from './WorkspaceProvider.jsx';
import { useToast } from './Toaster.jsx';
import { useMasterController } from './MasterController.jsx';
import { AGENTS } from '../lib/agentRegistry.js';
import { channelLabel } from '../lib/helpers.js';
import { insert, remove, queryTable } from '../lib/supabase.js';
import { saveNote } from '../lib/knowledge.js';
import { notifyDataChanged } from '../lib/useData.js';
import { projectForBoard } from '../lib/links.js';
import { AI_ACTIONS } from '../lib/prompts.js';
import {
  PAGES, dayKey, formatDue, parseCapture, rankItems, readCaptureBoard, writeCaptureBoard, taskRowFromCapture,
} from '../lib/commandPalette.js';
import '../styles/overlays.css';

// Ctrl/⌘+K from anywhere: jump to any page, project, note or task, tick a habit
// for today, or capture a task / note without leaving the current screen.
const PaletteContext = createContext({ open() {}, close() {}, isOpen: false, modKey: 'Ctrl' });

export function useCommandPalette() {
  return useContext(PaletteContext);
}

const RECENT_KEY = 'ctrlpanel-palette-recent';
const GROUP_ORDER = ['Recent', 'Ask', 'Habits', 'Go to', 'Projects', 'Boards', 'CRM', 'Agents', 'Socials', 'Notes', 'Tasks'];
const EMPTY_GROUPS = new Set(['Recent', 'Ask', 'Habits', 'Go to', 'Projects']);
const GROUP_CAP = { Tasks: 6, Notes: 6 };

const readJson = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* private mode / quota: recents are a convenience only */ }
};

const EMPTY_REMOTE = { tasks: [], notes: [], habits: [], logs: {}, loaded: false };

// Tasks, notes and habits for the palette (RLS-scoped, small selects).
async function loadRemote(today) {
  const [tasks, notes, habits, logs] = await Promise.all([
    queryTable('tasks', { select: 'id,title,board_id,column_name,due_date', order: 'created_at', limit: 300 }),
    queryTable('knowledge_notes', { select: 'id,title,folder,pinned,updated_at,project_id', order: 'updated_at', limit: 300 }),
    queryTable('habits', { select: 'id,name,active', order: 'created_at', ascending: true, limit: 100 }),
    queryTable('habit_logs', { select: 'id,habit_id', filters: { log_date: today }, limit: 200 }),
  ]);
  return {
    tasks: tasks.data || [],
    notes: notes.data || [],
    habits: (habits.data || []).filter((h) => h.active !== false),
    logs: Object.fromEntries((logs.data || []).map((l) => [l.habit_id, l.id])),
    loaded: true,
  };
}

export function CommandPaletteProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  const modKey = useMemo(() => (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl'), []);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  // Last fetched palette data. Lives with the signed-in shell, so it is gone on sign-out.
  const cacheRef = useRef(null);

  // Warm the cache shortly after load so the first Ctrl+K already has data.
  useEffect(() => {
    const timer = setTimeout(() => {
      loadRemote(dayKey(new Date())).then((data) => { cacheRef.current = data; }).catch(() => {});
    }, 1200);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const value = useMemo(() => ({ open, close, isOpen, modKey }), [open, close, isOpen, modKey]);
  return (
    <PaletteContext.Provider value={value}>
      {children}
      {isOpen && <Palette onClose={close} modKey={modKey} cacheRef={cacheRef} />}
    </PaletteContext.Provider>
  );
}

function Palette({ onClose, modKey, cacheRef }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const toast = useToast();
  const mc = useMasterController();
  const { projects, crmBoards, todoBoards, socials } = useWorkspace();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState(cacheRef.current || EMPTY_REMOTE);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const returnFocus = useRef(document.activeElement);
  const today = useMemo(() => dayKey(new Date()), []);

  useEffect(() => {
    inputRef.current?.focus();
    const prev = returnFocus.current;
    return () => prev?.focus?.();
  }, []);

  // Show the cached data instantly, then revalidate on every open.
  useEffect(() => {
    let alive = true;
    loadRemote(today)
      .then((data) => {
        cacheRef.current = data;
        if (alive) setRemote(data);
      })
      .catch(() => alive && setRemote((r) => ({ ...r, loaded: true })));
    return () => {
      alive = false;
    };
  }, [today, cacheRef]);

  const realBoards = useMemo(() => todoBoards.rows.filter((b) => !String(b.id).startsWith('tmp-')), [todoBoards.rows]);

  /* ---------------- Actions ---------------- */

  // Where a captured task lands: the board on screen, else the last one
  // captured to, else the first.
  const board = useMemo(() => {
    const onScreen = pathname.startsWith('/todo/') ? pathname.split('/')[2] : null;
    const remembered = readCaptureBoard();
    return realBoards.find((b) => b.id === onScreen) || realBoards.find((b) => b.id === remembered) || realBoards[0] || null;
  }, [pathname, realBoards]);

  const createTask = (capture) => {
    const row = taskRowFromCapture(capture, board);
    const dest = board ? `/todo/${board.id}` : '/todo';
    insert('tasks', [row]).then(({ data, error }) => {
      if (error || !data?.[0]) {
        toast({ tone: 'error', message: `Couldn't add the task: ${error?.message || 'unknown error'}` });
        return;
      }
      if (board) writeCaptureBoard(board.id);
      patchCache((c) => ({ ...c, tasks: [data[0], ...c.tasks] }));
      notifyDataChanged('tasks');
      const extras = [capture.priority, capture.due && formatDue(capture.due)].filter(Boolean).join(' · ');
      toast({
        message: `Added to ${board?.name || 'To Do'}: ${capture.title}${extras ? ` (${extras})` : ''}`,
        action: { label: 'Open', onClick: () => navigate(dest) },
      });
    });
  };

  const createNote = async (title) => {
    try {
      const saved = await saveNote({ title, content: '', folder: '', tags: [], project_id: null });
      patchCache((c) => ({ ...c, notes: [saved, ...c.notes] }));
      notifyDataChanged('knowledge_notes');
      navigate(`/knowledge?note=${saved.id}`);
      toast(`Created note: ${saved.title}`);
    } catch (e) {
      toast({ tone: 'error', message: e.message || "Couldn't create the note." });
    }
  };

  // Keep the shared cache in step with what the palette just wrote, so the next
  // open (which shows cached data first) never acts on stale state.
  const patchCache = (fn) => {
    if (cacheRef.current) cacheRef.current = fn(cacheRef.current);
  };
  const setHabitLog = (habitId, logId) =>
    patchCache((c) => {
      const logs = { ...c.logs };
      if (logId) logs[habitId] = logId;
      else delete logs[habitId];
      return { ...c, logs };
    });

  const toggleHabit = async (habit) => {
    const logId = remote.logs[habit.id];
    if (logId) {
      const { error } = await remove('habit_logs', logId);
      if (error) return toast({ tone: 'error', message: `Couldn't update ${habit.name}: ${error.message}` });
      setHabitLog(habit.id, null);
      notifyDataChanged('habit_logs');
      toast(`Unmarked: ${habit.name}`);
      return;
    }
    const { data, error } = await insert('habit_logs', [{ habit_id: habit.id, log_date: today, completed: true }]);
    if (error || !data?.[0]) return toast({ tone: 'error', message: `Couldn't log ${habit.name}: ${error?.message || 'unknown error'}` });
    setHabitLog(habit.id, data[0].id);
    notifyDataChanged('habit_logs');
    toast({
      message: `Done today: ${habit.name}`,
      action: {
        label: 'Undo',
        onClick: async () => {
          await remove('habit_logs', data[0].id);
          setHabitLog(habit.id, null);
          notifyDataChanged('habit_logs');
        },
      },
    });
  };

  /* ---------------- Items ---------------- */

  const items = useMemo(() => {
    const go = (to) => () => navigate(to);
    const nav = (id, group, label, to, icon, hint = '', keywords = '') => ({ id, group, label, to, icon, hint, keywords, run: go(to) });
    const list = [];

    PAGES.forEach((p) => list.push(nav(`page:${p.to}`, 'Go to', p.label, p.to, p.icon, '', p.keywords)));
    projects.rows
      .filter((p) => !String(p.id).startsWith('tmp-'))
      .forEach((p) => list.push(nav(`project:${p.id}`, 'Projects', p.name || 'Untitled', `/projects/${p.id}`, 'ti-folder', p.status || 'Project')));
    realBoards.forEach((b) => list.push(nav(`board:${b.id}`, 'Boards', b.name || 'Untitled', `/todo/${b.id}`, 'ti-layout-kanban', 'To Do board')));
    crmBoards.rows
      .filter((b) => !String(b.id).startsWith('tmp-'))
      .forEach((b) => list.push(nav(`crm:${b.id}`, 'CRM', b.name || 'Untitled', `/crm/${b.id}`, 'ti-users', 'CRM page')));
    AGENTS.forEach((a) => list.push(nav(`agent:${a.key}`, 'Agents', a.name, a.to, a.icon, 'Agent', a.description)));
    socials.channels.forEach((c) => list.push(nav(`channel:${c.id}`, 'Socials', channelLabel(c), `/socials/youtube/${c.id}`, 'ti-brand-youtube', 'YouTube channel')));

    remote.notes.forEach((n) => {
      const proj = projects.rows.find((p) => p.id === n.project_id);
      const hint = [proj?.name, n.folder].filter(Boolean).join(' · ') || 'Note';
      list.push(nav(`note:${n.id}`, 'Notes', n.title, `/knowledge?note=${n.id}`, n.pinned ? 'ti-pin' : 'ti-note', hint));
    });
    remote.tasks
      .filter((t) => t.column_name !== 'Done')
      .forEach((t) => {
        const board = realBoards.find((b) => b.id === t.board_id);
        const project = projectForBoard(projects.rows, t.board_id);
        const hint = [project?.name || board?.name, t.due_date && `due ${formatDue(t.due_date)}`].filter(Boolean).join(' · ');
        list.push(nav(`task:${t.id}`, 'Tasks', t.title, t.board_id ? `/todo/${t.board_id}` : '/todo', 'ti-checkbox', hint || t.column_name || 'Task'));
      });

    // One-tap AI prompts (Plan my day, Weekly review, …) go straight to the Master Controller.
    AI_ACTIONS.forEach((a) => list.push({ id: `ai:${a.id}`, group: 'Ask', label: a.label, icon: a.icon, hint: 'Master Controller', keywords: 'ai assistant claude plan', run: () => mc.send(a.prompt()) }));

    remote.habits.forEach((h) => {
      const done = Boolean(remote.logs[h.id]);
      list.push({
        id: `habit:${h.id}`,
        group: 'Habits',
        label: h.name,
        icon: done ? 'ti-circle-check' : 'ti-circle',
        hint: done ? 'Done today — Enter to undo' : 'Mark done today',
        done,
        run: () => toggleHabit(h),
      });
    });
    return list;
    // toggleHabit closes over remote.logs / today only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects.rows, realBoards, crmBoards.rows, socials.channels, remote, navigate, mc.send]);

  const trimmed = query.trim();
  const capture = useMemo(() => parseCapture(trimmed), [trimmed]);

  const groups = useMemo(() => {
    let out;
    if (!trimmed) {
      const recent = readJson(RECENT_KEY, []).map((r) => ({ ...r, group: 'Recent', run: () => navigate(r.to) }));
      const pool = [
        ...recent,
        ...items.filter((i) => i.group === 'Habits' && !i.done),
        ...items.filter((i) => EMPTY_GROUPS.has(i.group) && i.group !== 'Habits'),
      ];
      out = bucket(pool.map((item, index) => ({ item, score: 0, index })));
    } else {
      out = bucket(rankItems(items, trimmed));
    }

    if (trimmed) {
      const create = [];
      if (capture.title) {
        const extras = [capture.priority, capture.due && formatDue(capture.due), board && `→ ${board.name}`]
          .filter(Boolean)
          .join(' · ');
        create.push({
          id: 'create:task',
          group: 'Create',
          label: `Add task “${capture.title}”`,
          icon: 'ti-plus',
          hint: extras || '→ To Do',
          run: () => createTask(capture),
        });
      }
      create.push({
        id: 'create:note',
        group: 'Create',
        label: `New note “${trimmed}”`,
        icon: 'ti-file-plus',
        hint: 'Knowledge Base',
        run: () => createNote(trimmed),
      });
      out.push({ name: 'Create', rows: create });
    }
    return out;
    // createTask / createNote are recreated each render; they only read stable context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, trimmed, capture, board]);

  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const activeIdx = Math.min(active, Math.max(0, flat.length - 1));

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, groups]);

  const choose = (item) => {
    if (!item) return;
    onClose();
    if (item.to) {
      const recent = readJson(RECENT_KEY, []).filter((r) => r.id !== item.id);
      const { id, label, to, icon, hint } = item;
      writeJson(RECENT_KEY, [{ id, label, to, icon, hint }, ...recent].slice(0, 5));
    }
    item.run();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((activeIdx + 1) % Math.max(1, flat.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((activeIdx - 1 + flat.length) % Math.max(1, flat.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if ((e.ctrlKey || e.metaKey) && capture.title) {
        onClose();
        createTask(capture);
      } else if (!remote.loaded && flat[activeIdx]?.group === 'Create') {
        // Results are still loading: a fast typist's Enter must not create something by accident.
      } else {
        choose(flat[activeIdx]);
      }
    } else if (e.key === 'Tab') {
      e.preventDefault(); // keep focus in the palette
    }
  };

  let row = -1;
  return (
    <div className="cmdk-overlay" onMouseDown={onClose}>
      <div
        className="cmdk"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="cmdk-input-row">
          <i className="ti ti-search" />
          <input
            ref={inputRef}
            className="cmdk-input"
            value={query}
            placeholder="Jump anywhere, or type a task…  Call dentist @fri !high"
            spellCheck={false}
            autoComplete="off"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-autocomplete="list"
            aria-activedescendant={flat.length ? `cmdk-opt-${activeIdx}` : undefined}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
          />
          <kbd className="cmdk-kbd">esc</kbd>
        </div>

        <div className="cmdk-list" id="cmdk-list" role="listbox" ref={listRef}>
          {groups.map((g) => (
            <div key={g.name} role="group" aria-label={g.name}>
              <div className="cmdk-group" aria-hidden="true">{g.name}</div>
              {g.rows.map((item) => {
                row += 1;
                const i = row;
                return (
                  <div
                    key={item.id}
                    id={`cmdk-opt-${i}`}
                    role="option"
                    aria-selected={i === activeIdx}
                    data-active={i === activeIdx}
                    className={`cmdk-item ${i === activeIdx ? 'active' : ''}`}
                    onMouseMove={() => i !== activeIdx && setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(item)}
                  >
                    <i className={`ti ${item.icon || 'ti-point'}`} />
                    <span className="cmdk-item-label">{item.label}</span>
                    {item.hint && <span className="cmdk-item-hint">{item.hint}</span>}
                  </div>
                );
              })}
            </div>
          ))}
          {!flat.length && <div className="cmdk-empty">Nothing here yet.</div>}
        </div>

        <div className="cmdk-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> select</span>
          {!remote.loaded && <span className="cmdk-loading">Loading your tasks &amp; notes…</span>}
          {trimmed
            ? <span><kbd>{modKey}</kbd><kbd>↵</kbd> add as task</span>
            : <span className="cmdk-tip">Tip: end a task with <b>@fri</b>, <b>@tomorrow</b> or <b>!high</b></span>}
        </div>
      </div>
    </div>
  );
}

// Group ranked rows, best-matching group first (ties follow GROUP_ORDER), capped per group.
function bucket(ranked) {
  const byGroup = new Map();
  for (const r of ranked) {
    if (!byGroup.has(r.item.group)) byGroup.set(r.item.group, { name: r.item.group, rows: [], top: r.score });
    byGroup.get(r.item.group).rows.push(r.item);
  }
  const order = (name) => {
    const i = GROUP_ORDER.indexOf(name);
    return i === -1 ? GROUP_ORDER.length : i;
  };
  return [...byGroup.values()]
    .sort((a, b) => b.top - a.top || order(a.name) - order(b.name))
    .map((g) => ({ name: g.name, rows: g.rows.slice(0, GROUP_CAP[g.name] || 8) }));
}
