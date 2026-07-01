import { useState } from 'react';
import Card from '../../components/shared/Card.jsx';
import Modal from '../../components/shared/Modal.jsx';
import { insert as sbInsert } from '../../lib/supabase.js';
import {
  DAYS,
  WORKOUT_TYPES,
  WORKOUT_COLORS,
  mockSchedule,
  mockHeatmap,
} from '../../lib/mockData.js';

const blankExercise = () => ({ name: '', sets: '', reps: '', weight: '', notes: '' });

export default function Fitness() {
  const [schedule, setSchedule] = useState(mockSchedule);
  const [logging, setLogging] = useState(null);
  const [suggestion, setSuggestion] = useState('');

  // Click a day → cycle to the next workout type
  const cycleDay = (day) => {
    setSchedule((prev) => {
      const idx = WORKOUT_TYPES.indexOf(prev[day]);
      return { ...prev, [day]: WORKOUT_TYPES[(idx + 1) % WORKOUT_TYPES.length] };
    });
  };

  // Consistency stats derived from the heatmap (0 = rest)
  const trailing = [...mockHeatmap];
  let currentStreak = 0;
  for (let i = trailing.length - 1; i >= 0 && trailing[i] > 0; i--) currentStreak++;
  let longest = 0;
  let run = 0;
  for (const v of trailing) {
    run = v > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const thisMonth = trailing.slice(-30).filter((v) => v > 0).length;

  const getSuggestion = () => {
    if (currentStreak >= 5) setSuggestion(`You've trained ${currentStreak} days straight — consider a rest day tomorrow to recover.`);
    else if (currentStreak === 0) setSuggestion('You rested recently. A Push or Pull session would be a strong restart.');
    else setSuggestion(`${currentStreak}-day streak going. Keep the split rolling — next up looks like a good day to train.`);
  };

  const saveWorkout = () => {
    sbInsert('workout_logs', [
      { workout_type: logging.type, completed_at: new Date(logging.date).toISOString(), exercises: logging.exercises, notes: logging.notes },
    ]);
    setLogging(null);
  };

  const heatColor = (v) => (v === 0 ? {} : { background: 'var(--accent)', opacity: 0.3 + v * 0.23 });

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">Fitness</h1>
          <div className="page-header-sub">Weekly split & consistency · demo data</div>
        </div>
        <button className="btn btn--accent" onClick={() => setLogging({ date: new Date().toISOString().slice(0, 10), type: 'Push', exercises: [blankExercise()], notes: '' })}>
          <i className="ti ti-plus" /> Log Workout
        </button>
      </div>

      {/* Weekly schedule */}
      <Card className="card-section" static>
        <div className="card-section-title">Weekly Schedule <span className="muted">click a day to change</span></div>
        <div className="schedule-grid">
          {DAYS.map((day) => (
            <div
              key={day}
              className="schedule-day"
              style={{ borderColor: WORKOUT_COLORS[schedule[day]] }}
              onClick={() => cycleDay(day)}
            >
              <span className="schedule-day-name">{day}</span>
              <span className="schedule-day-type" style={{ color: WORKOUT_COLORS[schedule[day]] }}>
                {schedule[day]}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* Consistency stats */}
      <div className="grid grid-3">
        <Card className="stat-card">
          <div className="stat-card-head"><span className="section-label">Current Streak</span><i className="ti ti-flame" /></div>
          <div className="stat-card-value">{currentStreak} days</div>
        </Card>
        <Card className="stat-card">
          <div className="stat-card-head"><span className="section-label">Longest Streak</span><i className="ti ti-trophy" /></div>
          <div className="stat-card-value">{longest} days</div>
        </Card>
        <Card className="stat-card">
          <div className="stat-card-head"><span className="section-label">This Month</span><i className="ti ti-calendar" /></div>
          <div className="stat-card-value">{thisMonth} workouts</div>
        </Card>
      </div>

      {/* Heatmap */}
      <Card className="card-section" static>
        <div className="card-section-title">Past 52 Weeks</div>
        <div className="heatmap">
          {mockHeatmap.map((v, i) => (
            <div key={i} className="heatmap-cell" style={heatColor(v)} title={v ? `Volume ${v}` : 'Rest'} />
          ))}
        </div>
      </Card>

      {/* Claude suggestion */}
      <Card className="card-section" static>
        <div className="card-section-title">
          <span>Coach Suggestion</span>
          <button className="btn btn--sm" onClick={getSuggestion}>
            <i className="ti ti-sparkles" /> Get suggestion
          </button>
        </div>
        <p className="body-text">{suggestion || 'Tap "Get suggestion" for a recovery recommendation based on your recent training.'}</p>
      </Card>

      {logging && (
        <Modal
          title="Log Workout"
          onClose={() => setLogging(null)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setLogging(null)}>Cancel</button>
              <button className="btn btn--accent" onClick={saveWorkout}>Save</button>
            </>
          }
        >
          <div className="grid grid-2">
            <div className="field">
              <label className="field-label">Date</label>
              <input className="input" type="date" value={logging.date} onChange={(e) => setLogging({ ...logging, date: e.target.value })} />
            </div>
            <div className="field">
              <label className="field-label">Type</label>
              <select className="select" value={logging.type} onChange={(e) => setLogging({ ...logging, type: e.target.value })}>
                {WORKOUT_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <label className="field-label">Exercises</label>
          {logging.exercises.map((ex, i) => (
            <div className="toolbar" key={i} style={{ marginBottom: 8 }}>
              <input className="input" placeholder="Exercise" value={ex.name} onChange={(e) => setLogging({ ...logging, exercises: logging.exercises.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} style={{ flex: 2 }} />
              <input className="input" placeholder="Sets" value={ex.sets} onChange={(e) => setLogging({ ...logging, exercises: logging.exercises.map((x, j) => (j === i ? { ...x, sets: e.target.value } : x)) })} style={{ width: 64 }} />
              <input className="input" placeholder="Reps" value={ex.reps} onChange={(e) => setLogging({ ...logging, exercises: logging.exercises.map((x, j) => (j === i ? { ...x, reps: e.target.value } : x)) })} style={{ width: 64 }} />
              <input className="input" placeholder="Wt" value={ex.weight} onChange={(e) => setLogging({ ...logging, exercises: logging.exercises.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)) })} style={{ width: 64 }} />
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
