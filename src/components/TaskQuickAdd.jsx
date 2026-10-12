import { useId, useRef, useState } from 'react';
import { insert } from '../lib/supabase.js';
import { notifyDataChanged } from '../lib/useData.js';
import { parseCapture, formatDue } from '../lib/commandPalette.js';
import { saveQuickTask } from '../lib/taskQuickAdd.js';
import { useToast } from './Toaster.jsx';

export default function TaskQuickAdd({ board, column }) {
  const id = useId();
  const toast = useToast();
  const inputRef = useRef(null);
  const pendingRef = useRef(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const capture = parseCapture(text);

  const submit = async (e) => {
    e.preventDefault();
    if (pendingRef.current) return;
    pendingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const task = await saveQuickTask(text, board, column, insert);
      setText('');
      notifyDataChanged('tasks');
      toast(`Added to ${column}: ${task.title}`);
    } catch (err) {
      setError(err.message || 'Couldn’t save the task. Try again.');
    } finally {
      pendingRef.current = false;
      setSaving(false);
      inputRef.current?.focus();
    }
  };

  return (
    <form className="dash2-quick-task" onSubmit={submit} aria-busy={saving}>
      <label className="sr-only" htmlFor={id}>New task in {board.name} · {column}</label>
      <div className="dash2-quick-task-row">
        <input
          id={id}
          ref={inputRef}
          className="input"
          placeholder={`Add to ${column}…`}
          value={text}
          onChange={(e) => { setText(e.target.value); setError(''); }}
          readOnly={saving}
          aria-invalid={!!error}
          aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
          autoComplete="off"
        />
        <button className="btn btn--accent btn--sm" type="submit" disabled={saving || !capture.title} aria-label={`Add task to ${column}`} title={`Add task to ${column}`}>
          <i className={`ti ${saving ? 'ti-hourglass' : 'ti-plus'}`} aria-hidden="true" />
        </button>
      </div>
      <div className="dash2-quick-task-hint" id={`${id}-hint`}>
        {capture.due || capture.priority
          ? <>{capture.due && <span>{formatDue(capture.due)}</span>}{capture.priority && <span>{capture.priority} priority</span>}</>
          : <span>Enter to add · @fri · !high</span>}
      </div>
      {error && <p className="dash2-quick-task-error" id={`${id}-error`} role="alert">{error}</p>}
    </form>
  );
}
