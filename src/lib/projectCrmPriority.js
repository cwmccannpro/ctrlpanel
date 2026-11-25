import { crmFollowups } from './dashboardStats.js';
import { dayKey } from './helpers.js';

const aliases = {
  name: ['company', 'company name', 'business', 'business name', 'organization', 'organisation', 'name', 'contact', 'contact name', 'client', 'lead', 'lead name', 'prospect', 'email'],
  next: ['next follow up', 'next follow up date', 'follow up', 'follow up date', 'followup', 'followup date', 'follow up due', 'next contact', 'next contact date', 'next touch', 'next touch date', 'next action date', 'due', 'due date'],
  last: ['last touch', 'last touch date', 'last contact', 'last contact date', 'last contacted', 'last follow up', 'last activity'],
  temperature: ['lead temp', 'lead temperature', 'temperature', 'warmth'],
  priority: ['priority', 'lead priority'],
  status: ['status', 'stage', 'lead status', 'pipeline stage'],
};
const RANK = { urgent: 0, critical: 0, p0: 0, high: 1, hot: 1, p1: 1, medium: 2, warm: 2, p2: 2, low: 3, cold: 3, p3: 3 };
const CLOSED = /^(done|completed?|closed(?: won| lost)?|won|lost|converted|archived|inactive|unqualified|do not contact)$/;
const normalize = (value = '') => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function sheetDay(text = '') {
  const value = text.trim();
  const parts = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T ])/);
  if (parts) {
    const [, year, month, day] = parts;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    return date.getMonth() === Number(month) - 1 && date.getDate() === Number(day) ? dayKey(date) : '';
  }
  if (!/^(?:\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}\b|[a-z]{3,9}\.?\s+\d{1,2}[,\s]+\d{4}\b|\d{1,2}\s+[a-z]{3,9}\.?\s+\d{4}\b)/i.test(value)) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : dayKey(date);
}

function scheduledLabel(due, today) {
  return due === today ? 'Due today' : 'Overdue';
}

export function sheetCrmPriorities(sheet, today = new Date(), limit = 5) {
  const headers = sheet.headers.map(normalize);
  const columns = Object.fromEntries(Object.entries(aliases).map(([key, names]) => [
    key, names.map((name) => headers.indexOf(name)).find((index) => index >= 0) ?? -1,
  ]));
  const hasSignals = columns.next >= 0 || columns.last >= 0 || columns.priority >= 0 || columns.temperature >= 0;
  const currentDay = dayKey(today);
  const entries = [];

  for (const row of sheet.rows) {
    const cell = (key) => row.cells[columns[key]]?.trim() || '';
    const name = cell('name');
    if (!name || CLOSED.test(normalize(cell('status')))) continue;

    const dueText = cell('next');
    const due = sheetDay(dueText);
    if (dueText && (!due || due > currentDay)) continue;

    const priority = normalize(cell('priority'));
    const temperature = normalize(cell('temperature')) || priority;
    const temp = ['hot', 'warm', 'cold'].includes(temperature)
      ? temperature[0].toUpperCase() + temperature.slice(1) : '';
    const rank = (Object.hasOwn(RANK, priority) ? RANK[priority] : undefined)
      ?? (Object.hasOwn(RANK, temperature) ? RANK[temperature] : 4);
    const lastText = cell('last');
    const last = sheetDay(lastText);
    const followup = !due && (last || temp) && crmFollowups({
      contacts: [{ business_name: name, last_touch: last, lead_temp: temp }], today,
    }).queue[0];
    if (!due && !followup && (rank > 1 || lastText)) continue;

    entries.push({
      id: row.row, name, due, rank, temp, priority: cell('priority'), since: followup?.since ?? null,
      label: due ? scheduledLabel(due, currentDay) : followup ? followup.since == null ? 'No last touch' : `${followup.since}d since contact` : 'High priority',
    });
  }
  entries.sort((a, b) => Number(!a.due) - Number(!b.due) || a.rank - b.rank || a.due.localeCompare(b.due)
    || (b.since ?? Infinity) - (a.since ?? Infinity) || a.name.localeCompare(b.name));
  return { rows: entries.slice(0, limit), total: entries.length, hasSignals: hasSignals && columns.name >= 0 };
}
