import { useState } from 'react';
import Modal from './shared/Modal.jsx';

// Field definitions per quick-add type
const FORMS = {
  task: {
    title: 'Add Task',
    icon: 'ti-plus',
    fields: [
      { name: 'title', label: 'Title', type: 'text', placeholder: 'What needs doing?' },
      { name: 'priority', label: 'Priority', type: 'select', options: ['Low', 'Medium', 'High', 'Urgent'] },
      { name: 'due_date', label: 'Due date', type: 'date' },
    ],
  },
  meal: {
    title: 'Log Meal',
    icon: 'ti-salad',
    fields: [
      { name: 'meal_name', label: 'Meal', type: 'text', placeholder: 'e.g. Chicken & rice' },
      { name: 'calories', label: 'Calories', type: 'number' },
      { name: 'protein', label: 'Protein (g)', type: 'number' },
    ],
  },
  expense: {
    title: 'Log Expense',
    icon: 'ti-cash',
    fields: [
      { name: 'amount', label: 'Amount ($)', type: 'number' },
      { name: 'category', label: 'Category', type: 'text', placeholder: 'e.g. Food' },
      { name: 'note', label: 'Note', type: 'text' },
    ],
  },
  event: {
    title: 'Add Event',
    icon: 'ti-calendar-plus',
    fields: [
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'date', label: 'Date', type: 'date' },
      { name: 'time', label: 'Time', type: 'time' },
    ],
  },
};

export default function QuickAdd() {
  const [active, setActive] = useState(null);
  const [values, setValues] = useState({});

  const openForm = (key) => {
    setValues({});
    setActive(key);
  };

  const form = active ? FORMS[active] : null;

  const submit = () => {
    // Placeholder: real persistence wires to Supabase later (AGENTS.md rule #8).
    setActive(null);
  };

  return (
    <>
      <div className="quick-add-bar">
        <button className="btn" onClick={() => openForm('task')}>
          <i className="ti ti-plus" /> Task
        </button>
        <button className="btn" onClick={() => openForm('meal')}>
          <i className="ti ti-salad" /> Log Meal
        </button>
        <button className="btn" onClick={() => openForm('expense')}>
          <i className="ti ti-cash" /> Log Expense
        </button>
        <button className="btn" onClick={() => openForm('event')}>
          <i className="ti ti-calendar-plus" /> Add Event
        </button>
      </div>

      {form && (
        <Modal
          title={form.title}
          onClose={() => setActive(null)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setActive(null)}>
                Cancel
              </button>
              <button className="btn btn--accent" onClick={submit}>
                Save
              </button>
            </>
          }
        >
          {form.fields.map((f) => (
            <div className="field" key={f.name}>
              <label className="field-label">{f.label}</label>
              {f.type === 'select' ? (
                <select
                  className="select"
                  value={values[f.name] || ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                >
                  <option value="" disabled>
                    Select…
                  </option>
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="input"
                  type={f.type}
                  placeholder={f.placeholder}
                  value={values[f.name] || ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                />
              )}
            </div>
          ))}
        </Modal>
      )}
    </>
  );
}
