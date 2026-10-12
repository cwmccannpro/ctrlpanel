// ============================================================
// CTRLpanel — embedded Excalidraw canvas (per project)
// Lazy-loaded from ProjectDetail so the main bundle stays lean.
// On change (debounced) the full scene (elements, appState, files) is
// serialized and handed to onPersist along with a small webp thumbnail
// the Project Dashboard uses as a preview. A save is also flushed
// immediately when the tab is hidden/closed or the canvas unmounts, so a
// quick refresh right after drawing doesn't lose the last stroke.
//
// The stored scene never includes scroll/zoom (Excalidraw strips the viewport
// when serializing), so on open we scroll to the saved content — otherwise a
// drawing that lives away from the origin loads as an apparently empty canvas.
// A full-screen toggle expands the canvas to the whole window (Fullscreen API
// where available, with a fixed-position overlay as the fallback).
//
// Excalidraw fires onChange very frequently (pointer moves, selection,
// cursor blink), so we gate all work behind a cheap content signature and
// keep every callback identity stable via refs — otherwise the parent's
// re-render after each save would loop back in and strobe the UI.
// ============================================================
import { useRef, useCallback, useEffect, useState } from 'react';
import { Excalidraw, serializeAsJSON, exportToBlob } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

const SAVE_DEBOUNCE_MS = 1200;

// Cheap signature of drawable content — changes only when elements actually
// change (count + per-element version), ignoring cursor/selection noise.
const sceneSig = (elements = []) => {
  let sig = `${elements.length}`;
  for (const el of elements) sig += `:${el.id}.${el.version}`;
  return sig;
};

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });

export default function ExcalidrawBoard({ initialScene, onPersist }) {
  // Capture once — initialData is only read on mount, and we don't want our
  // own persists (which update the project row) to look like fresh props.
  const initial = useRef(
    initialScene
      ? { ...initialScene, appState: { ...(initialScene.appState || {}) }, scrollToContent: true }
      : null
  ).current;
  // Signature seed must come from the stored elements, not the wrapped copy.
  const storedElements = initialScene?.elements || [];

  // Keep the latest onPersist in a ref so our callbacks never change identity
  // (and thus never re-subscribe onChange / re-run the unload effect).
  const onPersistRef = useRef(onPersist);
  onPersistRef.current = onPersist;

  const timer = useRef(null);
  const pending = useRef(null); // latest { elements, appState, files } not yet saved
  // Signature already committed to the DB — seed from the loaded scene so the
  // mount-time onChange doesn't look like a fresh edit.
  const savedSig = useRef(sceneSig(storedElements));
  const [status, setStatus] = useState('saved'); // 'saved' | 'pending' | 'saving' | 'error'
  const [errorMsg, setErrorMsg] = useState('');
  const [full, setFull] = useState(false);
  const rootRef = useRef(null);

  const runSave = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const snap = pending.current;
    if (!snap) return;
    const { elements, appState, files } = snap;
    const sig = sceneSig(elements);

    // Serialize the scene — this is the critical data. serializeAsJSON strips
    // non-serializable state (collaborators etc.).
    let scene;
    try {
      scene = JSON.parse(serializeAsJSON(elements, appState, files, 'local'));
    } catch (err) {
      console.error('[Excalidraw] serialize failed', err);
      setErrorMsg('Could not serialize the drawing.');
      setStatus('error');
      return;
    }

    // Preview thumbnail is best-effort — a failure here must NOT block the save.
    let preview = null;
    if (elements?.some((el) => !el.isDeleted)) {
      try {
        const blob = await exportToBlob({
          elements,
          appState: { ...appState, exportWithDarkMode: true },
          files,
          mimeType: 'image/webp',
          quality: 0.6,
          maxWidthOrHeight: 480,
        });
        preview = await blobToDataUrl(blob);
      } catch (err) {
        console.warn('[Excalidraw] preview generation failed (saving scene anyway)', err);
      }
    }

    try {
      setStatus('saving');
      const result = await onPersistRef.current(scene, preview);
      if (result?.error) throw result.error;
      savedSig.current = sig;
      setErrorMsg('');
      // Only clear pending if nothing newer arrived while we were saving.
      if (pending.current === snap) {
        pending.current = null;
        setStatus('saved');
      }
    } catch (err) {
      console.error('[Excalidraw] save failed', err);
      setErrorMsg(err?.message || 'Save failed.');
      setStatus('error');
    }
  }, []);

  const handleChange = useCallback(
    (elements, appState, files) => {
      const sig = sceneSig(elements);
      // No real content change (just cursor/selection/hover) → ignore entirely.
      if (sig === savedSig.current && !pending.current) return;
      if (sig === savedSig.current) {
        // Reverted back to the saved state before the debounce fired.
        pending.current = null;
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        setStatus('saved');
        return;
      }
      pending.current = { elements, appState, files };
      setStatus('pending');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(runSave, SAVE_DEBOUNCE_MS);
    },
    [runSave]
  );

  // Safety net: flush any pending save when the tab is hidden (about to
  // refresh/close) or when leaving this project's Excalidraw tab. Mount-once.
  useEffect(() => {
    const onHide = () => {
      if (document.hidden && pending.current) runSave();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      if (pending.current) runSave();
    };
  }, [runSave]);

  const enterFull = useCallback(() => {
    setFull(true);
    // Real browser full screen when allowed; the CSS overlay covers the rest.
    rootRef.current?.requestFullscreen?.().catch(() => {});
  }, []);
  const exitFull = useCallback(() => {
    setFull(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, []);

  // Excalidraw only re-measures its canvas on window resize, so nudge it after
  // the container changes size (again once the browser's full-screen settles).
  useEffect(() => {
    const nudge = () => window.dispatchEvent(new Event('resize'));
    const raf = requestAnimationFrame(nudge);
    const later = setTimeout(nudge, 250);
    return () => { cancelAnimationFrame(raf); clearTimeout(later); };
  }, [full]);

  // Esc in browser full screen leaves it without going through exitFull.
  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement) setFull(false); };
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);

  return (
    <div ref={rootRef} className={full ? 'excalidraw-board excalidraw-board--full' : 'excalidraw-board'}>
      <div className="excalidraw-savebar">
        {status === 'saving' && <span className="muted">Saving…</span>}
        {status === 'pending' && <span className="muted">Unsaved changes…</span>}
        {status === 'saved' && <span className="muted"><i className="ti ti-check" /> Saved</span>}
        {status === 'error' && (
          <span className="row" style={{ gap: 6, color: 'var(--red)' }} title={errorMsg}>
            <i className="ti ti-alert-triangle" /> Couldn't save{errorMsg ? ` — ${errorMsg}` : ''}
            <button className="btn btn--ghost btn--sm" onClick={runSave}>Retry</button>
          </span>
        )}
        <button
          className="btn btn--ghost btn--sm"
          onClick={full ? exitFull : enterFull}
          title={full ? 'Exit full screen' : 'Full screen'}
          aria-label={full ? 'Exit full screen' : 'Full screen'}
        >
          <i className={`ti ${full ? 'ti-arrows-minimize' : 'ti-arrows-maximize'}`} /> {full ? 'Exit full screen' : 'Full screen'}
        </button>
      </div>
      <div className="excalidraw-wrap">
        <Excalidraw theme="dark" initialData={initial} onChange={handleChange} />
      </div>
    </div>
  );
}
