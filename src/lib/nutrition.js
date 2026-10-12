// Shared by the browser and both API runtimes. No browser or database imports.
export const DEFAULT_NUTRITION_GOALS = { calories: 2400, protein: 180, carbs: 250, fat: 80 };
export const NUTRIENTS = [
  { key: 'calories', label: 'Calories', unit: 'kcal', max: 50000 },
  { key: 'protein', label: 'Protein', unit: 'g', max: 10000 },
  { key: 'carbs', label: 'Carbs', unit: 'g', max: 10000 },
  { key: 'fat', label: 'Fat', unit: 'g', max: 10000 },
];

// FDA Daily Values are editable label references, not personalized prescriptions.
// https://www.fda.gov/food/nutrition-facts-label/daily-value-nutrition-and-supplement-facts-labels
export const MICRO_NUTRIENTS = [
  { key: 'fiber', label: 'Fiber', unit: 'g', target: 28, group: 'Other' },
  { key: 'vitamin_d', label: 'Vitamin D', unit: 'mcg', target: 20, group: 'Vitamins' },
  { key: 'calcium', label: 'Calcium', unit: 'mg', target: 1300, group: 'Minerals' },
  { key: 'iron', label: 'Iron', unit: 'mg', target: 18, group: 'Minerals' },
  { key: 'potassium', label: 'Potassium', unit: 'mg', target: 4700, group: 'Minerals' },
  { key: 'magnesium', label: 'Magnesium', unit: 'mg', target: 420, group: 'Minerals' },
  { key: 'vitamin_c', label: 'Vitamin C', unit: 'mg', target: 90, group: 'Vitamins' },
  { key: 'vitamin_b12', label: 'Vitamin B12', unit: 'mcg', target: 2.4, group: 'Vitamins' },
  { key: 'zinc', label: 'Zinc', unit: 'mg', target: 11, group: 'Minerals' },
  { key: 'sodium', label: 'Sodium', unit: 'mg', target: 2300, group: 'Other', limit: true },
  { key: 'vitamin_a', label: 'Vitamin A', unit: 'mcg RAE', target: 900, group: 'Vitamins' },
  { key: 'vitamin_e', label: 'Vitamin E', unit: 'mg', target: 15, group: 'Vitamins' },
  { key: 'vitamin_k', label: 'Vitamin K', unit: 'mcg', target: 120, group: 'Vitamins' },
  { key: 'thiamin', label: 'B1 · Thiamin', unit: 'mg', target: 1.2, group: 'Vitamins' },
  { key: 'riboflavin', label: 'B2 · Riboflavin', unit: 'mg', target: 1.3, group: 'Vitamins' },
  { key: 'niacin', label: 'B3 · Niacin', unit: 'mg NE', target: 16, group: 'Vitamins' },
  { key: 'pantothenic_acid', label: 'B5 · Pantothenic acid', unit: 'mg', target: 5, group: 'Vitamins' },
  { key: 'vitamin_b6', label: 'Vitamin B6', unit: 'mg', target: 1.7, group: 'Vitamins' },
  { key: 'biotin', label: 'B7 · Biotin', unit: 'mcg', target: 30, group: 'Vitamins' },
  { key: 'folate', label: 'Folate', unit: 'mcg DFE', target: 400, group: 'Vitamins' },
  { key: 'choline', label: 'Choline', unit: 'mg', target: 550, group: 'Other' },
  { key: 'phosphorus', label: 'Phosphorus', unit: 'mg', target: 1250, group: 'Minerals' },
  { key: 'iodine', label: 'Iodine', unit: 'mcg', target: 150, group: 'Minerals' },
  { key: 'selenium', label: 'Selenium', unit: 'mcg', target: 55, group: 'Minerals' },
  { key: 'copper', label: 'Copper', unit: 'mg', target: 0.9, group: 'Minerals' },
  { key: 'manganese', label: 'Manganese', unit: 'mg', target: 2.3, group: 'Minerals' },
  { key: 'chromium', label: 'Chromium', unit: 'mcg', target: 35, group: 'Minerals' },
  { key: 'molybdenum', label: 'Molybdenum', unit: 'mcg', target: 45, group: 'Minerals' },
  { key: 'chloride', label: 'Chloride', unit: 'mg', target: 2300, group: 'Minerals' },
  { key: 'saturated_fat', label: 'Saturated fat', unit: 'g', target: 20, group: 'Other', limit: true },
  { key: 'added_sugar', label: 'Added sugar', unit: 'g', target: 50, group: 'Other', limit: true },
  { key: 'cholesterol', label: 'Cholesterol', unit: 'mg', target: 300, group: 'Other', limit: true },
].map((field) => ({ max: 100000, ...field }));
export const ALL_NUTRIENTS = [...NUTRIENTS, ...MICRO_NUTRIENTS];

// A missing value stays missing. Blank form fields remove a value; an explicit
// zero means the nutrient was measured and absent from this meal.
export function nutritionMicros(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Micronutrients must be an object of nutrient amounts.');
  for (const key of Object.keys(value)) {
    if (!MICRO_NUTRIENTS.some((field) => field.key === key)) throw new Error(`Unknown micronutrient: ${key}. Use the listed nutrient keys and units.`);
  }
  return Object.fromEntries(MICRO_NUTRIENTS.filter(({ key }) => value[key] != null && value[key] !== '').map(({ key }) => [key, nutritionNumber(value[key], key)]));
}

export function micronutrientTotals(rows = []) {
  return Object.fromEntries(MICRO_NUTRIENTS.map(({ key }) => {
    const reported = rows.map((row) => row.micros?.[key]).filter((value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0);
    return [key, { amount: reported.length ? Math.round(reported.reduce((sum, value) => sum + Number(value), 0) * 100) / 100 : null, reported: reported.length, meals: rows.length }];
  }));
}

export function micronutrientGoals(row) {
  return Object.fromEntries(MICRO_NUTRIENTS.map(({ key, target }) => [key, row?.micros?.[key] == null ? target : Number(row.micros[key])]));
}

export function nutrientProgress(amount, target) {
  const known = amount != null && Number.isFinite(amount) && amount >= 0;
  const hasTarget = Number.isFinite(target) && target > 0;
  const percent = known && hasTarget ? amount / target * 100 : null;
  return { known, hasTarget, percent, width: percent == null ? 0 : Math.min(100, Math.max(0, percent)) };
}

export const formatNutrient = (value) => value == null ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });

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
  const field = ALL_NUTRIENTS.find((n) => n.key === key);
  if (!field) throw new Error('Unknown nutrient.');
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
    ...(payload.micros !== undefined ? { micros: nutritionMicros(payload.micros) } : {}),
    notes: payload.notes?.trim() || null, photo_url, ...(logged_at ? { logged_at } : {}),
  };
}

export function nutritionTotals(rows = []) {
  return Object.fromEntries(NUTRIENTS.map(({ key }) => [key, Math.round(rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0) * 100) / 100]));
}

export function nutritionGoals(row) {
  return Object.fromEntries(NUTRIENTS.map(({ key }) => [key, row?.[key] == null ? DEFAULT_NUTRITION_GOALS[key] : Number(row[key])]));
}
