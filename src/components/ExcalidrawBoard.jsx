// ============================================================
// CTRLpanel — embedded Excalidraw canvas (per project)
// Lazy-loaded from ProjectDetail so the main bundle stays lean.
// On change (debounced) the full scene (elements, appState, files) is
// serialized and handed to onPersist along with a small webp thumbnail
// the Project Dashboard uses as a preview.
// ============================================================
import { useRef, useCallback } from 'react';
import { Excalidraw, serializeAsJSON, exportToBlob } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

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
  const initial = useRef(initialScene || null).current;
  const timer = useRef(null);
  const lastSaved = useRef(null);

  const handleChange = useCallback(
    (elements, appState, files) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        try {
          // serializeAsJSON strips non-serializable state (collaborators etc.)
          const json = serializeAsJSON(elements, appState, files, 'local');
          if (json === lastSaved.current) return; // nothing actually changed
          lastSaved.current = json;
          const scene = JSON.parse(json);

          let preview = null;
          if (elements?.some((el) => !el.isDeleted)) {
            const blob = await exportToBlob({
              elements,
              appState: { ...appState, exportWithDarkMode: true },
              files,
              mimeType: 'image/webp',
              quality: 0.6,
              maxWidthOrHeight: 480,
            });
            preview = await blobToDataUrl(blob);
          }
          onPersist(scene, preview);
        } catch {
          /* keep editing; retry on next change */
        }
      }, 1200);
    },
    [onPersist]
  );

  return (
    <div className="excalidraw-wrap">
      <Excalidraw theme="dark" initialData={initial} onChange={handleChange} />
    </div>
  );
}
