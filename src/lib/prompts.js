// One-tap prompts for the Master Controller. It already has a fresh snapshot of the
// account and read tools (query_records, calendar tools…), so these only say WHAT to
// do and HOW to answer. They carry today's date so "today" can't be misread.

const stamp = (now) =>
  `${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}, ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;

/** Time-block today from the calendar, due/overdue tasks and undone habits. */
export function planMyDayPrompt(now = new Date()) {
  return [
    `Plan my day. It is ${stamp(now)}.`,
    '',
    'Use my real data (check it with your tools; do not guess):',
    '1. Today\'s calendar events — treat them as fixed.',
    '2. Overdue tasks and tasks due today (not in a Done column), with their priorities.',
    '3. Habits I have not checked off today.',
    '',
    'Then give me a realistic time-blocked plan for the rest of today:',
    '- Start from the current time; leave gaps between blocks and a real lunch break.',
    '- Put the highest-priority and overdue work first, in focused blocks of 25–90 minutes.',
    '- Slot the remaining habits where they fit.',
    '- If there is more than fits today, say what you would move and why.',
    '',
    'Keep it short (a list of times and what to do). Do not create or change anything yet — end by asking if I want any of it added as tasks.',
  ].join('\n');
}

/** A short spoken-style recap of the week plus what to focus on next. */
export function weeklyReviewPrompt(now = new Date()) {
  return [
    `Run my weekly review. It is ${stamp(now)}.`,
    '',
    'Look at the last 7 days compared with the 7 before, using my real data:',
    '- Habits: completion and any streak I am on or just lost.',
    '- Tasks: what was due, what got done, and what is overdue now.',
    '- Training, nutrition and weight if I logged them; spending against budget if I track it.',
    '',
    'Reply with: 3 wins, 2–3 things that slipped (and one honest reason each), and the 3 most important things for next week based on what is due and what I keep postponing.',
    'Be specific, use my numbers, and keep it under 250 words. Then ask whether to save it as a note.',
  ].join('\n');
}

/** What is late, and the smallest next step for each. */
export function overduePrompt(now = new Date()) {
  return [
    `What is overdue? It is ${stamp(now)}.`,
    'List every task past its due date (not in a Done column) from my real data, oldest first, with its board.',
    'For each, suggest the smallest next step I could take in 10 minutes, and flag any that look safe to drop.',
    'Do not change anything; ask which ones to reschedule or delete.',
  ].join('\n');
}

export const AI_ACTIONS = [
  { id: 'plan-day', label: 'Plan my day', icon: 'ti-calendar-time', prompt: planMyDayPrompt },
  { id: 'weekly-review', label: 'Weekly review', icon: 'ti-report', prompt: weeklyReviewPrompt },
  { id: 'overdue', label: 'What’s overdue?', icon: 'ti-alarm', prompt: overduePrompt },
];
