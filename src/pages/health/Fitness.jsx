import { useState } from 'react';
import Card from '../../components/shared/Card.jsx';
import Modal from '../../components/shared/Modal.jsx';
import { useCrud } from '../../lib/useData.js';
import { DAYS, WORKOUT_TYPES, WORKOUT_COLORS } from '../../lib/mockData.js';
import { formatDate } from '../../lib/helpers.js';

const blankExercise = () => ({ name: '', sets: '', reps: '', weight: '' });
const day = (ts) => (ts || '').slice(0, 10);

export default function Fitness() {
  const schedule = useCrud('fitness_schedule');
  const logs = useCrud('workout_logs', 'completed_at');
  const [logging, setLogging] = useState(null);

  const scheduleMap = {};
  schedule.rows.forEach((r) => { scheduleMap[r.day_of_week] = r; });

  const cycleDay = (dow) => {
    const row = scheduleMap[dow];
    if (row) {
      const idx = WORKOUT_TYPES.indexOf(row.workout_type);
      schedule.patch(row.id, { workout_type: WORKOUT_TYPES[(idx + 1) % WORKOUT_TYPES.length] });
    } else {
      schedule.add({ day_of_week: dow, workout_type: WORKOUT_TYPES[0] });
    }
  };

  // Heatmap: last 52 weeks (364 days)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 363; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  const countByDay = {};
  logs.rows.forEach((w) => {
    const d = day(w.completed_at);
    if (d) countByDay[d] = (countByDay[d] || 0) + 1;
  });
  const workoutDays = new Set(Object.keys(countByDay));

  let currentStreak = 0;
  const cur = new Date(today);
  while (workoutDays.has(cur.toISOString().slice(0, 10))) { currentStreak++; cur.setDate(cur.getDate() - 1); }
  let longest = 0, run = 0;
  days.forEach((ds) => { if (workoutDays.has(ds)) { run++; longest = Math.max(longest, run); } else run = 0; });
  const thisMonth = [...workoutDays].filter((ds) => { const dt = new Date(ds); return dt.getMonth() === today.getMonth() && dt.getFullYear() === today.getFullYear(); }).length;

  const heatColor = (v) => (v === 0 ? {} : { background: 'var(--accent)', opacity: Math.min(0.3 + v * 0.25, 1) });

  const saveWorkout = () => {
    logs.add({
      workout_type: logging.type,
      completed_at: new Date(`${logging.date}T12:00:00`).toISOString(),
      exercises: logging.exercises.filter((e) => e.name),
      notes: logging.notes || null,
    });
    setLogging(null);
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">Fitness</h1>
          <div className="page-header-sub">Weekly split & consistency</div>
        </div>
        <button className="btn btn--accent" onClick={() => setLogging({ date: new Date().toISOString().slice(0, 10), type: 'Push', exercises: [blankExercise()], notes: '' })}>
          <i className="ti ti-plus" /> Log Workout
        </button>
      </div>

      <Card className="card-section" static>
        <div className="card-section-title">Weekly Schedule <span className="muted">click a day to change</span></div>
        <div className="schedule-grid">
          {DAYS.map((dow) => {
            const type = scheduleMap[dow]?.workout_type || 'Rest';
            return (
              <div key={dow} className="schedule-day" style={{ borderColor: WORKOUT_COLORS[type] }} onClick={() => cycleDay(dow)}>
                <span className="schedule-day-name">{dow}</span>
                <span className="schedule-day-type" style={{ color: WORKOUT_COLORS[type] }}>{type}</span>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid grid-3">
        <Card className="stat-card"><div className="stat-card-head"><span className="section-label">Current Streak</span><i className="ti ti-flame" /></div><div className="stat-card-value">{currentStreak} days</div></Card>
        <Card className="stat-card"><div className="stat-card-head"><span className="section-label">Longest Streak</span><i className="ti ti-trophy" /></div><div className="stat-card-value">{longest} days</div></Card>
        <Card className="stat-card"><div className="stat-card-head"><span className="section-label">This Month</span><i className="ti ti-calendar" /></div><div className="stat-card-value">{thisMonth} workouts</div></Card>
      </div>

      <Card className="card-section" static>
        <div className="card-section-title">Past 52 Weeks</div>
        <div className="heatmap">
          {days.map((ds) => (
            <div key={ds} className="heatmap-cell" style={heatColor(countByDay[ds] || 0)} title={countByDay[ds] ? `${ds}: ${countByDay[ds]} workout(s)` : ds} />
          ))}
        </div>
      </Card>

      <Card className="card-section" static>
        <div className="card-section-title">Recent Workouts</div>
        {logs.rows.length === 0 && <p className="body-text">No workouts logged yet.</p>}
        {[...logs.rows].reverse().slice(0, 8).map((w) => (
          <div className="list-row" key={w.id}>
            <span className="list-row-time">{formatDate(w.completed_at)}</span>
            <span className="badge" style={{ color: WORKOUT_COLORS[w.workout_type], borderColor: WORKOUT_COLORS[w.workout_type] }}>{w.workout_type}</span>
            <span className="list-row-title">{(w.exercises || []).length} exercises</span>
            <button className="btn btn--ghost btn--icon" onClick={() => logs.remove(w.id)} title="Delete"><i className="ti ti-x" /></button>
          </div>
        ))}
      </Card>

      {logging && (
        <Modal
          title="Log Workout"
          onClose={() => setLogging(null)}
          footer={<><button className="btn btn--ghost" onClick={() => setLogging(null)}>Cancel</button><button className="btn btn--accent" onClick={saveWorkout}>Save</button></>}
        >
          <div className="grid grid-2">
            <div className="field"><label className="field-label">Date</label><input className="input" type="date" value={logging.date} onChange={(e) => setLogging({ ...logging, date: e.target.value })} /></div>
            <div className="field"><label className="field-label">Type</label><select className="select" value={logging.type} onChange={(e) => setLogging({ ...logging, type: e.target.value })}>{WORKOUT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
          </div>
          <label className="field-label">Exercises</label>
          {logging.exercises.map((ex, i) => (
            <div className="toolbar" key={i} style={{ marginBottom: 8 }}>
              <input className="input" placeholder="Exercise" value={ex.name} onChange={(e) => setLogging({ ...logging, exercises: logging.exercises.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} style={{ flex: 2 }} />
              <input className="input" placeholder="Sets" value={ex.sets} onChange={(e) => setLogging({ ...logging, exercises: logging.exercises.map((x, j) => (j === i ? { ...x, sets: e.target.value } : x)) })} style={{ width: 60 }} />
              <input className="input" placeholder="Reps" value={ex.reps} onChange={(e) => setLogging({ ...logging, exercises: logging.exercises.map((x, j) => (j === i ? { ...x, reps: e.target.value } : x)) })} style={{ width: 60 }} />
              <input className="input" placeholder="Wt" value={ex.weight} onChange={(e) => setLogging({ ...logging, exercises: logging.exercises.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)) })} style={{ width: 60 }} />
            </div>
          ))}
          <button className="btn btn--ghost btn--sm" onClick={() => setLogging({ ...logging, exercises: [...logging.exercises, blankExercise()] })}>
            <i className="ti ti-plus" /> Add exercise
          </button>
        </Modal>
      )}
    </div>
  );
}
