import { useEffect, useMemo, useState } from 'react';
import Card from '../../components/shared/Card.jsx';
import { useFitnessPlan } from '../../lib/useFitnessPlan.js';
import { useToast } from '../../components/Toaster.jsx';
import {
  PLAN_DAYS, SPLIT_TYPES, blankExercise, cloneExercises, cleanExercises, dayKeyFor,
  dayLabel, dayPlan, moveItem, nextDayKey, planByDay, typeColor,
} from '../../lib/fitnessPlan.js';
import '../../styles/fitness.css';

const draftFrom = (row) => {
  const plan = dayPlan(row);
  return { type: plan.type, notes: plan.notes, exercises: plan.exercises.length ? plan.exercises : [blankExercise()] };
};
const snapshot = (draft) => JSON.stringify({
  type: draft.type.trim(), notes: draft.notes.trim(),
  exercises: cleanExercises(draft.exercises).map(({ id, ...exercise }) => exercise),
});
const countLabel = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;
const exerciseFields = [
  { key: 'name', label: 'Exercise', placeholder: 'Exercise name' },
  { key: 'sets', label: 'Sets', placeholder: '—' },
  { key: 'reps', label: 'Reps', placeholder: 'e.g. 8–10' },
  { key: 'weight', label: 'Weight', placeholder: 'Optional' },
  { key: 'note', label: 'Cue / note', placeholder: 'Tempo, rest, drop sets…' },
];

export default function Fitness() {
  const schedule = useFitnessPlan();
  const toast = useToast();
  const todayKey = dayKeyFor();
  const [selected, setSelected] = useState(todayKey);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const byDay = useMemo(() => planByDay(schedule.rows), [schedule.rows]);
  const row = byDay[selected];
  const plan = dayPlan(row);
  const editing = draft !== null;
  const dirty = editing && snapshot(draft) !== snapshot(draftFrom(row));
  const week = PLAN_DAYS.map((day) => dayPlan(byDay[day.key]));
  const trainingDays = week.filter((day) => day.planned && !day.rest).length;
  const restDays = week.filter((day) => day.rest).length;
  const exerciseCount = week.reduce((total, day) => total + day.exercises.length, 0);
  const tomorrow = dayPlan(byDay[nextDayKey(todayKey)]);
  const color = typeColor(editing ? draft.type : plan.type);
  const available = !schedule.loading && !schedule.error;

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const selectDay = (key) => {
    if (key === selected || saving) return;
    if (dirty && !window.confirm('Discard your unsaved changes to this day?')) return;
    setDraft(null);
    setSaveError('');
    setSelected(key);
  };
  const tabKeyDown = (event, index) => {
    let target;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') target = (index + 1) % 7;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') target = (index + 6) % 7;
    if (event.key === 'Home') target = 0;
    if (event.key === 'End') target = 6;
    if (target === undefined) return;
    event.preventDefault();
    document.getElementById(`fitness-tab-${PLAN_DAYS[target].key}`)?.focus();
  };
  const patchDraft = (changes) => { setSaveError(''); setDraft((current) => ({ ...current, ...changes })); };
  const patchExercise = (index, changes) => {
    setSaveError('');
    setDraft((current) => ({ ...current, exercises: current.exercises.map((exercise, i) => i === index ? { ...exercise, ...changes } : exercise) }));
  };
  const copyFrom = (key) => {
    const source = dayPlan(byDay[key]);
    patchDraft({ type: source.type, notes: source.notes, exercises: source.exercises.length ? cloneExercises(source.exercises) : [blankExercise()] });
  };
  const save = async (event) => {
    event.preventDefault();
    if (saving) return;
    if (!draft.type.trim()) { setSaveError('Give this day a name, or choose Rest.'); document.getElementById('fitness-focus')?.focus(); return; }
    if (draft.exercises.some((exercise) => !exercise.name.trim() && [exercise.sets, exercise.reps, exercise.weight, exercise.note].some((value) => value.trim()))) {
      setSaveError('Add an exercise name for each row with sets, reps, weight, or a note.'); return;
    }
    setSaving(true);
    try {
      await schedule.saveDay(selected, row, { workout_type: draft.type.trim(), exercises: cleanExercises(draft.exercises), notes: draft.notes.trim() || null });
      setDraft(null);
      setSaveError('');
      toast(`${dayLabel(selected)} saved`);
    } catch (err) {
      setSaveError(err?.message || 'Could not save this day. Your changes are still here.');
    } finally { setSaving(false); }
  };
  const clearDay = async () => {
    if (saving || !row || !window.confirm(`Clear the plan for ${dayLabel(selected)}? You can plan it again at any time.`)) return;
    setSaving(true);
    try {
      await schedule.saveDay(selected, row, { workout_type: '', exercises: [], notes: null });
      setDraft(null);
      setSaveError('');
      toast(`${dayLabel(selected)} cleared`);
    } catch (err) { setSaveError(err?.message || 'Could not clear this day.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fade-in fitness">
      <header className="fitness-page-head">
        <div>
          <div className="fitness-eyebrow">Health / Fitness</div>
          <h1>Training plan<span className="fitness-title-dot">.</span></h1>
          <p>Your week, your routine. A little structure for every session.</p>
        </div>
        <button className="btn btn--ghost" disabled={selected === todayKey || saving} onClick={() => selectDay(todayKey)}><i className="ti ti-calendar" aria-hidden="true" /> Today</button>
      </header>

      <div className="fitness-week-label">
        <span className="fitness-eyebrow">Your weekly rhythm</span>
        {available && <span className="fitness-week-summary">{countLabel(trainingDays, 'training day')}<span>·</span>{countLabel(restDays, 'rest day')}<span>·</span>{countLabel(exerciseCount, 'exercise')}</span>}
      </div>
      <div className="fitness-week" role="tablist" aria-label="Training week">
        {PLAN_DAYS.map((day, index) => {
          const saved = dayPlan(byDay[day.key]);
          return (
            <button key={day.key} id={`fitness-tab-${day.key}`} role="tab" aria-selected={selected === day.key} aria-controls="fitness-routine" tabIndex={selected === day.key ? 0 : -1}
              aria-label={`${day.label}${todayKey === day.key ? ', today' : ''}, ${schedule.loading ? 'loading' : schedule.error ? 'unavailable' : saved.type || (saved.planned ? 'Planned' : 'Not planned')}`}
              className={`fitness-day${selected === day.key ? ' is-selected' : ''}${saved.rest ? ' is-rest' : ''}`} style={{ '--day-color': typeColor(saved.type) }}
              disabled={saving} onClick={() => selectDay(day.key)} onKeyDown={(event) => tabKeyDown(event, index)}>
              <span className="fitness-day-name">{day.key}{todayKey === day.key && <span className="fitness-today-dot" aria-hidden="true" />}</span>
              <span className="fitness-day-type" title={saved.type}>{schedule.loading ? '…' : schedule.error ? '—' : saved.type || (saved.planned ? 'Planned' : 'Not planned')}</span>
              <span className="fitness-day-count">{available ? saved.exercises.length ? countLabel(saved.exercises.length, 'exercise') : saved.rest ? 'Recovery' : 'Open day' : ' '}</span>
              <span className="fitness-day-line" aria-hidden="true" />
            </button>
          );
        })}
      </div>

      <Card className="fitness-card" static id="fitness-routine" role="tabpanel" aria-labelledby={`fitness-tab-${selected}`} style={{ '--day-color': color }}>
        {schedule.loading && !editing ? <div className="fitness-empty" role="status"><i className="ti ti-loader" aria-hidden="true" /><h2>Loading your week…</h2></div> : schedule.error && !editing ? (
          <div className="fitness-empty" role="alert"><i className="ti ti-cloud-off" aria-hidden="true" /><h2>Your plan couldn’t load</h2><p>{schedule.error.message || 'Check your connection and try again.'}</p><button className="btn btn--ghost" onClick={schedule.reload}>Try again</button></div>
        ) : <>
          <div className="fitness-head">
            <div className="fitness-session-heading">
              <span className="fitness-session-icon"><i className={`ti ${plan.rest && !editing ? 'ti-bed' : 'ti-barbell'}`} aria-hidden="true" /></span>
              <div><div className="fitness-eyebrow">{dayLabel(selected)}{selected === todayKey ? ' · Today' : ''}{editing ? ' · Editing' : ''}</div><h2 className="fitness-title">{editing ? draft.type.trim() || 'Name your day' : plan.type || (plan.planned ? 'Training' : 'An open day')}</h2></div>
            </div>
            {!editing && <button className="btn btn--ghost fitness-edit-button" onClick={() => { setSaveError(''); setDraft(draftFrom(row)); }}><i className={`ti ${plan.planned ? 'ti-pencil' : 'ti-plus'}`} aria-hidden="true" />{plan.planned ? 'Edit routine' : 'Plan this day'}</button>}
          </div>
          {!editing && <>
            {plan.exercises.length > 0 ? <div className="fitness-routine">
              <div className="fitness-routine-caption"><span>{countLabel(plan.exercises.length, 'exercise')} · In session order</span><span>Sets & reps stay exactly as you plan them</span></div>
              <div className="fitness-list-head" aria-hidden="true"><span>Exercise</span><span>Sets</span><span>Reps</span><span>Weight</span></div>
              <ol className="fitness-list">{plan.exercises.map((exercise, index) => <li className="fitness-ex" key={exercise.id}>
                <span className="fitness-ex-main"><span className="fitness-ex-num" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><span className="fitness-ex-copy"><span className="fitness-ex-name">{exercise.name}</span>{exercise.note && <span className="fitness-ex-meta">{exercise.note}</span>}</span></span>
                <span className="fitness-ex-value"><span className="fitness-mobile-label">Sets</span>{exercise.sets || '—'}</span>
                <span className="fitness-ex-value"><span className="fitness-mobile-label">Reps</span>{exercise.reps || '—'}</span>
                <span className="fitness-ex-value fitness-ex-weight"><span className="fitness-mobile-label">Weight</span>{exercise.weight || '—'}</span>
              </li>)}</ol>
            </div> : <div className={`fitness-empty${plan.rest ? ' fitness-empty--rest' : ''}`}>
              <i className={`ti ${plan.rest ? 'ti-leaf' : 'ti-barbell'}`} aria-hidden="true" /><h3>{plan.rest ? 'Room to recover.' : plan.planned ? 'Build out your session.' : 'Make this day your own.'}</h3>
              <p>{plan.rest ? 'A pause in the plan. Come back ready for your next session.' : plan.planned ? 'Your day is named. Add exercises, sets, and reps when you’re ready.' : 'Choose a focus, add your exercises, or leave space for rest.'}</p>
            </div>}
            {plan.notes && <div className="fitness-notes"><i className="ti ti-notes" aria-hidden="true" /><div><span className="fitness-eyebrow">Session notes</span><p>{plan.notes}</p></div></div>}
            {saveError && <p className="fitness-error" role="alert">{saveError}</p>}
          </>}
          {editing && <form className="fitness-edit" onSubmit={save}>
            <fieldset disabled={saving}>
              {saveError && <p id="fitness-save-error" className="fitness-error" role="alert">{saveError}</p>}
              <div className="fitness-edit-top">
                <div><label className="field-label" htmlFor="fitness-focus">Day focus</label><input id="fitness-focus" className="input" autoFocus placeholder="Name this day" value={draft.type} onChange={(event) => patchDraft({ type: event.target.value })} /></div>
                <div><label className="field-label" htmlFor="fitness-copy">Reuse another day</label><select id="fitness-copy" className="select" value="" onChange={(event) => event.target.value && copyFrom(event.target.value)}><option value="">Choose a saved routine…</option>{PLAN_DAYS.filter((day) => day.key !== selected && dayPlan(byDay[day.key]).planned).map((day) => <option key={day.key} value={day.key}>{day.label} · {dayPlan(byDay[day.key]).type || 'Training'}</option>)}</select></div>
              </div>
              <div className="fitness-chips" aria-label="Suggested day names">{SPLIT_TYPES.map((type) => <button key={type} type="button" className={`fitness-chip${draft.type.trim().toLowerCase() === type.toLowerCase() ? ' is-on' : ''}`} aria-pressed={draft.type.trim().toLowerCase() === type.toLowerCase()} onClick={() => patchDraft({ type })}>{type}</button>)}</div>
              <div className="fitness-ex-editor-head"><div><h3>Exercises</h3><p>In the order you’ll do them. Ranges and “All out” work too.</p></div><button type="button" className="btn btn--ghost btn--sm" onClick={() => patchDraft({ exercises: [...draft.exercises, blankExercise()] })}><i className="ti ti-plus" aria-hidden="true" /> Add exercise</button></div>
              <div className="fitness-editor-rows">{draft.exercises.map((exercise, index) => <div className="fitness-ex-row" key={exercise.id}>
                <span className="fitness-ex-num">{String(index + 1).padStart(2, '0')}</span>
                {exerciseFields.map((field) => <label className={`fitness-edit-field fitness-edit-field--${field.key}`} key={field.key}><span>{field.label}</span><input className="input" placeholder={field.placeholder} aria-label={`Exercise ${index + 1} ${field.label.toLowerCase()}`} value={exercise[field.key]} onChange={(event) => patchExercise(index, { [field.key]: event.target.value })} /></label>)}
                <span className="fitness-ex-actions">
                  <button type="button" className="btn btn--ghost btn--icon" title="Move up" aria-label={`Move exercise ${index + 1} up`} disabled={index === 0} onClick={() => patchDraft({ exercises: moveItem(draft.exercises, index, index - 1) })}><i className="ti ti-chevron-up" aria-hidden="true" /></button>
                  <button type="button" className="btn btn--ghost btn--icon" title="Move down" aria-label={`Move exercise ${index + 1} down`} disabled={index === draft.exercises.length - 1} onClick={() => patchDraft({ exercises: moveItem(draft.exercises, index, index + 1) })}><i className="ti ti-chevron-down" aria-hidden="true" /></button>
                  <button type="button" className="btn btn--ghost btn--icon" title="Remove exercise" aria-label={`Remove exercise ${index + 1}`} onClick={() => patchDraft({ exercises: draft.exercises.filter((_, i) => i !== index) })}><i className="ti ti-x" aria-hidden="true" /></button>
                </span>
              </div>)}</div>
              <label className="field-label fitness-notes-label" htmlFor="fitness-day-notes">Session notes</label><textarea id="fitness-day-notes" className="input" rows={3} placeholder="Warm-up, cues, or anything to remember" value={draft.notes} onChange={(event) => patchDraft({ notes: event.target.value })} />
              <div className="fitness-actions">{plan.planned && <button type="button" className="btn btn--ghost fitness-clear" onClick={clearDay}>Clear day</button>}<span className="fitness-save-state" role="status">{saving ? 'Saving your routine…' : dirty ? 'Unsaved changes' : 'Edit at your own pace'}</span><button type="button" className="btn btn--ghost" onClick={() => { if (!dirty || window.confirm('Discard your unsaved changes?')) { setDraft(null); setSaveError(''); } }}>Cancel</button><button type="submit" className="btn btn--accent">{saving ? 'Saving…' : 'Save routine'}</button></div>
            </fieldset>
          </form>}
          {!editing && <footer className="fitness-card-footer"><span><i className="ti ti-repeat" aria-hidden="true" /> Repeats each week · Edit any day as your routine changes</span>{tomorrow.planned && <span>Tomorrow <strong>{tomorrow.type || 'Training'}</strong></span>}</footer>}
        </>}
      </Card>
    </div>
  );
}
