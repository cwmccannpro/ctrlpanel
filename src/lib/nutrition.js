// Shared by the browser and both API runtimes. No browser or database imports.
export const DEFAULT_NUTRITION_GOALS = { calories: 2400, protein: 180, carbs: 250, fat: 80 };
export const NUTRIENTS = [
  { key: 'calories', label: 'Calories', unit: 'kcal', max: 50000 },
  { key: 'protein', label: 'Protein', unit: 'g', max: 10000 },
  { key: 'carbs', label: 'Carbs', unit: 'g', max: 10000 },
  { key: 'fat', label: 'Fat', unit: 'g', max: 10000 },
];

export function nutritionTimeZone(value = 'UTC') {
  try { return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone; }
  catch { throw new Error('Choose a valid meal timezone, such as America/New_York.'); }
}

export function nutritionDay(value = new Date(), timeZone = 'UTC') {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type) => parts.find((p) => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function validDay(day) {
  const parsed = new Date(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
    throw new Error('Choose a valid meal date.');
  }
  return day;
}

// Convert wall time in an IANA timezone to an instant. Re-evaluate the offset
// at the candidate instant so DST transitions do not assume a 24-hour day.
export function nutritionTimestamp(day, timeZone, hour = 12) {
  validDay(day);
  const [year, month, date] = day.split('-').map(Number);
  const target = Date.UTC(year, month - 1, date, hour);
  const formatter = new Intl.DateTimeFormat('en', {
    timeZone: nutritionTimeZone(timeZone), year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  let instant = target;
  for (let i = 0; i < 4; i++) {
    const p = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(({ type, value }) => [type, value]));
    const represented = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    const next = instant + target - represented;
    if (next === instant) break;
    instant = next;
  }
  return new Date(instant).toISOString();
}

export function nutritionDayRange(value, timeZone) {
  const day = nutritionDay(value, timeZone);
  const next = new Date(`${day}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { day, start: nutritionTimestamp(day, timeZone, 0), end: nutritionTimestamp(next.toISOString().slice(0, 10), timeZone, 0) };
}

export function nutritionNumber(value, key) {
  const field = NUTRIENTS.find((n) => n.key === key);
  if (value === '' || value == null || !['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) {
    throw new Error(`${field.label} is required.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > field.max) throw new Error(`${field.label} must be between 0 and ${field.max.toLocaleString('en-US')}.`);
  return Math.round((number + number * Number.EPSILON) * 100) / 100;
}

export function nutritionEntry(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Send a meal as a JSON object.');
  const name = payload.food_name ?? payload.meal_name ?? payload.name;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 200) throw new Error('Meal name is required (up to 200 characters).');
  if (payload.notes != null && (typeof payload.notes !== 'string' || payload.notes.length > 3000)) throw new Error('Notes must be text of up to 3,000 characters.');
  let logged_at;
  if (payload.timestamp != null) {
    if (typeof payload.timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(payload.timestamp) || Number.isNaN(Date.parse(payload.timestamp))) {
      throw new Error('timestamp must be an ISO date and time with a timezone offset.');
    }
    validDay(payload.timestamp.slice(0, 10));
    logged_at = new Date(payload.timestamp).toISOString();
  }
  let photo_url = null;
  if (payload.image_url) {
    try {
      const url = new URL(payload.image_url);
      if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 2048) throw new Error();
      photo_url = url.href;
    } catch { throw new Error('image_url must be a valid HTTPS photo URL.'); }
  }
  return {
    meal_name: name.trim(),
    ...Object.fromEntries(NUTRIENTS.map(({ key }) => [key, nutritionNumber(payload[key], key)])),
    notes: payload.notes?.trim() || null, photo_url, ...(logged_at ? { logged_at } : {}),
  };
}

export function nutritionTotals(rows = []) {
  return Object.fromEntries(NUTRIENTS.map(({ key }) => [key, Math.round(rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0) * 100) / 100]));
}

export function nutritionGoals(row) {
  return Object.fromEntries(NUTRIENTS.map(({ key }) => [key, row?.[key] == null ? DEFAULT_NUTRITION_GOALS[key] : Number(row[key])]));
}
