// ============================================================
// CTRLpanel — Google Calendar integration.
// Full OAuth wiring is added with the Calendar module; until then this
// serves mock events so the Calendar UI is never blank (AGENTS.md rule #8).
// ============================================================

export function isConnected() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function iso(daysFromNow, hour, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

export async function listEvents() {
  // Placeholder events until Google OAuth is connected.
  return {
    connected: isConnected(),
    events: [
      { id: 'e1', title: 'Standup — ViridianAI', start: iso(0, 9), end: iso(0, 9, 30), calendar: 'Work', color: '#e11d48' },
      { id: 'e2', title: 'Client call — Web design proposal', start: iso(0, 13, 30), end: iso(0, 14, 15), calendar: 'Sales', color: '#3b82f6' },
      { id: 'e3', title: 'Gym — Push day', start: iso(0, 16), end: iso(0, 17), calendar: 'Health', color: '#10b981' },
      { id: 'e4', title: 'Deep work — CTRLpanel', start: iso(1, 10), end: iso(1, 12), calendar: 'Work', color: '#e11d48' },
    ],
  };
}

export async function createEvent(event) {
  // Echo back with an id; real insert happens once OAuth is wired.
  return { id: `tmp-${Date.now()}`, ...event, pending: !isConnected() };
}
