import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import '../styles/overlays.css';

// App-wide toasts: `const toast = useToast(); toast('Saved')` or
// `toast({ message, tone: 'error', action: { label: 'Undo', onClick } })`.
const ToastContext = createContext(null);

const TTL = { default: 4000, error: 7000 };
const ICONS = { success: 'ti-check', error: 'ti-alert-triangle', info: 'ti-info-circle' };

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

function ToastItem({ toast, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), toast.ttl);
    return () => clearTimeout(timer);
  }, [toast.id, toast.ttl, onDismiss]);

  const act = () => {
    toast.action?.onClick?.();
    onDismiss(toast.id);
  };

  return (
    <div className={`toast toast--${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
      <i className={`ti ${ICONS[toast.tone] || ICONS.info}`} />
      <span className="toast-message">{toast.message}</span>
      {toast.action && (
        <button className="toast-action" onClick={act}>{toast.action.label}</button>
      )}
      <button className="toast-close" aria-label="Dismiss" onClick={() => onDismiss(toast.id)}>
        <i className="ti ti-x" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  const push = useCallback((input) => {
    const opts = typeof input === 'string' ? { message: input } : input;
    const tone = opts.tone || 'success';
    const toast = {
      id: ++nextId.current,
      tone,
      message: opts.message,
      action: opts.action,
      ttl: opts.ttl ?? (tone === 'error' ? TTL.error : TTL.default),
    };
    // Keep the stack short: the newest three win.
    setToasts((prev) => [...prev, toast].slice(-3));
    return toast.id;
  }, []);

  const api = useMemo(() => Object.assign(push, { dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" aria-live="polite">
        {toasts.map((t) => <ToastItem key={t.id} toast={t} onDismiss={dismiss} />)}
      </div>
    </ToastContext.Provider>
  );
}
