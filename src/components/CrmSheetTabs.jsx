import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Spinner from './shared/Spinner.jsx';
import { sheets } from '../lib/api.js';
import { getCachedMeta, setCachedMeta } from '../lib/sheetsCache.js';

const NO_TABS = [];

function readPins(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    return Array.isArray(saved) ? [...new Set(saved.filter(Number.isInteger))] : [];
  } catch {
    return [];
  }
}

export default function CrmSheetTabs({ board, onSetup, Problem, Table }) {
  const id = board.spreadsheet_id;
  const pinKey = `crm-sheet-pins:v1:${board.id}:${id}`;
  const [pins, setPins] = useState(() => readPins(pinKey));
  const [meta, setMeta] = useState(() => getCachedMeta(id));
  const [metaError, setMetaError] = useState(null);
  const [revision, setRevision] = useState(0);
  const [workspace, setWorkspace] = useState(null);
  const panelId = useId();
  const picker = useRef(null);
  const strip = useRef(null);
  const pendingFocus = useRef(null);
  const tabId = (sheetId) => `${panelId}-tab-${sheetId}`;
  const refreshMeta = useCallback(() => setRevision((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setMetaError(null);
    sheets.meta(id).then((next) => {
      if (!alive) return;
      setCachedMeta(id, next);
      setMeta(next);
    }).catch((error) => {
      if (alive) setMetaError(error);
    });
    return () => { alive = false; };
  }, [id, revision]);

  const tabs = meta?.sheets ?? NO_TABS;
  const byId = new Map(tabs.map((tab) => [tab.sheetId, tab]));
  const initial = tabs.find((tab) => tab.title === board.sheet_name) ?? tabs[0];
  const openIds = (workspace?.open ?? (initial ? [initial.sheetId] : [])).filter((key) => byId.has(key));
  const activeId = openIds.includes(workspace?.active) ? workspace.active : (openIds[0] ?? null);
  const active = byId.get(activeId);
  const pinnedTabs = pins.map((key) => byId.get(key)).filter(Boolean);

  useEffect(() => {
    const next = pendingFocus.current;
    pendingFocus.current = null;
    if (next === 'picker') {
      picker.current?.focus();
    } else {
      const button = document.getElementById(`${panelId}-tab-${next ?? activeId}`);
      if (next != null) button?.focus({ preventScroll: true });
      if (button && strip.current) {
        const tab = button.parentElement.getBoundingClientRect();
        const viewport = strip.current.getBoundingClientRect();
        if (tab.right > viewport.right) strip.current.scrollLeft += tab.right - viewport.right;
        else if (tab.left < viewport.left) strip.current.scrollLeft -= viewport.left - tab.left;
      }
    }
  }, [workspace, activeId, panelId]);

  function open(sheetId, focus = false) {
    if (focus) pendingFocus.current = sheetId;
    setWorkspace({ open: openIds.includes(sheetId) ? openIds : [...openIds, sheetId], active: sheetId });
  }

  function close(sheetId) {
    const index = openIds.indexOf(sheetId);
    const remaining = openIds.filter((key) => key !== sheetId);
    const neighbor = remaining[index] ?? remaining[index - 1];
    const next = activeId === sheetId ? neighbor ?? null : activeId;
    pendingFocus.current = next ?? 'picker';
    setWorkspace({ open: remaining, active: next });
  }

  function onTabKey(event, sheetId) {
    const index = openIds.indexOf(sheetId);
    let next;
    switch (event.key) {
      case 'ArrowRight': next = openIds[(index + 1) % openIds.length]; break;
      case 'ArrowLeft': next = openIds[(index + openIds.length - 1) % openIds.length]; break;
      case 'Home': next = openIds[0]; break;
      case 'End': next = openIds.at(-1); break;
      case 'Delete':
        event.preventDefault();
        close(sheetId);
        return;
      default: return;
    }
    event.preventDefault();
    open(next, true);
  }

  function togglePin(sheetId) {
    const next = pins.includes(sheetId) ? pins.filter((key) => key !== sheetId) : [...pins, sheetId];
    setPins(next);
    try { localStorage.setItem(pinKey, JSON.stringify(next)); }
    catch { /* Pins still work for the current visit. */ }
  }

  if (!meta && metaError) return <Problem error={metaError} onRetry={refreshMeta} onSetup={onSetup} />;
  if (!meta) return <div className="crm-empty" role="status"><Spinner /><span>Loading sheets…</span></div>;
  if (!tabs.length) return <Problem error={new Error('This spreadsheet has no sheets.')} onRetry={refreshMeta} onSetup={onSetup} />;

  const isPinned = pins.includes(activeId);
  return (
    <>
      <div className="crm-sheet-navigation">
        {openIds.length > 0 && (
          <div className="crm-sheet-tabstrip" ref={strip} role="tablist" aria-label="Open sheets">
            {openIds.map((key) => {
              const tab = byId.get(key);
              const selected = key === activeId;
              return (
                <div key={key} role="presentation" className={`crm-sheet-tab${selected ? ' is-active' : ''}`}
                  onAuxClick={(e) => { if (e.button === 1) close(key); }}>
                  <button type="button" role="tab" id={tabId(key)} aria-selected={selected}
                    aria-controls={selected ? panelId : undefined} tabIndex={selected ? 0 : -1}
                    title={tab.title} onClick={() => open(key)} onKeyDown={(e) => onTabKey(e, key)}>
                    <i className={`ti ${pins.includes(key) ? 'ti-pin' : 'ti-table'}`} aria-hidden="true" />
                    <span>{tab.title}</span>
                  </button>
                  <button type="button" className="crm-sheet-close" aria-label={`Close ${tab.title}`} title={`Close ${tab.title}`} onClick={() => close(key)}>
                    <i className="ti ti-x" aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div className="crm-sheet-picker">
          <select ref={picker} className="select" aria-label="All sheets" value={activeId ?? ''} onChange={(e) => open(Number(e.target.value))}>
            <option value="" disabled>Open a sheet…</option>
            {tabs.map((tab) => <option key={tab.sheetId} value={tab.sheetId}>{tab.title}</option>)}
          </select>
          <button type="button" className="btn btn--ghost btn--icon" aria-label="Pin current sheet" aria-pressed={isPinned}
            title={isPinned ? 'Unpin current sheet' : 'Pin current sheet'} disabled={!active} onClick={() => togglePin(activeId)}>
            <i className={`ti ${isPinned ? 'ti-pin-filled' : 'ti-pin'}`} aria-hidden="true" />
          </button>
        </div>
        {pinnedTabs.length > 0 && (
          <div className="crm-sheet-pins" role="group" aria-label="Pinned sheets">
            <span className="crm-sheet-pin-label">Pinned</span>
            {pinnedTabs.map((tab) => (
              <button key={tab.sheetId} type="button" className="btn btn--sm crm-sheet-pin"
                aria-current={tab.sheetId === activeId ? 'true' : undefined} title={tab.title}
                onClick={() => open(tab.sheetId)}>
                <i className="ti ti-pin" aria-hidden="true" /> <span>{tab.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {metaError && <p className="body-text crm-error" role="alert">Couldn’t refresh the sheet list. <button className="btn btn--sm btn--ghost" onClick={refreshMeta}>Try again</button></p>}
      {active ? (
        <div role="tabpanel" id={panelId} aria-labelledby={tabId(activeId)}>
          <Table key={`${activeId}:${active.title}`} board={board} tab={active} onSetup={onSetup} onRefreshMeta={refreshMeta} />
        </div>
      ) : (
        <div className="crm-empty">
          <i className="ti ti-table" aria-hidden="true" />
          <p>No sheets open</p>
          <span>Choose a sheet from the dropdown to open it here.</span>
        </div>
      )}
    </>
  );
}
