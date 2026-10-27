import { useEffect, useId, useRef } from 'react';

// Uses CTRLpanel's shared modal classes with focus containment for hardware
// configuration. Keep keyboard focus in the dialog and restore its trigger.
export default function RoomDialog({ title, onClose, children }) {
  const titleId = useId();
  const panel = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const trigger = document.activeElement;
    const focusable = () => [...panel.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')];
    (panel.current.querySelector('input, select') || focusable()[0] || panel.current).focus();
    function onKey(e) {
      if (e.key === 'Escape') close.current?.();
      if (e.key !== 'Tab') return;
      const elements = focusable();
      if (!elements.length) { e.preventDefault(); panel.current.focus(); return; }
      const first = elements[0], last = elements.at(-1);
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); trigger?.focus(); };
  }, []);
  return <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
    <div ref={panel} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <div className="modal-header"><h3 id={titleId} className="modal-title">{title}</h3><button className="btn btn--ghost btn--icon" onClick={onClose} disabled={!onClose} aria-label="Close"><i aria-hidden="true" className="ti ti-x" /></button></div>
      <div className="modal-body">{children}</div>
    </div>
  </div>;
}
