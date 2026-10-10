import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getTaskDrag, setTaskDrag } from '../src/lib/taskDrag.js';

// The drag is shared between dashboard panels, so the store (not React state) is the contract.
test('the dragged task is shared and cleared', () => {
  assert.equal(getTaskDrag(), null);
  const drag = { taskId: 't1', mins: 30, grabMin: 10, from: 'panel', title: 'Write brief' };
  setTaskDrag(drag);
  assert.equal(getTaskDrag(), drag);
  setTaskDrag(null);
  assert.equal(getTaskDrag(), null);
});

test('accepts an updater function like useState', () => {
  setTaskDrag({ taskId: 't1', mins: 30 });
  setTaskDrag((d) => ({ ...d, mins: 45 }));
  assert.equal(getTaskDrag().mins, 45);
  setTaskDrag(null);
});
