import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Lives outside the table scroller so full notes never get clipped by it. */
export default function CrmTextPreview({ id, preview, onEnter, onLeave }) {
  const ref = useRef(null);
  const [position, setPosition] = useState(null);

  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const anchor = preview.anchor.getBoundingClientRect();
    const margin = 12;
    const gap = 6;
    const width = Math.min(480, window.innerWidth - margin * 2);
    const height = Math.min(panel.scrollHeight, 360, window.innerHeight - margin * 2);
    const below = anchor.bottom + gap;
    const top = below + height <= window.innerHeight - margin
      ? below : Math.max(margin, anchor.top - gap - height);
    setPosition({
      left: Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin)),
      top,
      width,
      maxHeight: Math.min(360, window.innerHeight - top - margin),
    });
  }, [preview]);

  return createPortal(
    <div
      ref={ref}
      id={id}
      role="tooltip"
      tabIndex={0}
      className="crm-text-preview"
      style={{ ...position, visibility: position ? 'visible' : 'hidden' }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
    >
      <div className="crm-text-preview-label">{preview.header}</div>
      <div className="crm-text-preview-body">{preview.text}</div>
    </div>,
    document.body
  );
}
