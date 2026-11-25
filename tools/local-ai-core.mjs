// Pure pieces of the desktop meal-estimate bridge (tests: tests/localAi.test.mjs).
import { mealEstimateSchema, mealInstructions, mealUserText, validateMealInput } from '../backend/mealPrompt.js';

export const DEFAULT_MODEL = 'qwen2.5vl:7b';
export const BRIDGE_KEY = /^ctla_[a-f0-9]{64}$/;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

// The bridge only ever talks to CTRLpanel and to a model server on this machine.
export function bridgeConfig(raw = {}) {
  const origin = new URL(raw.origin || 'https://ctrlpanel.cwmccann.pro');
  if (origin.protocol !== 'https:' && !LOOPBACK.has(origin.hostname)) throw new Error('origin must be https (or a localhost dev server).');
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search) throw new Error('origin must be a bare https://host.');
  const ollama = new URL(raw.ollama || 'http://127.0.0.1:11434');
  if (!LOOPBACK.has(ollama.hostname)) throw new Error('ollama must be a loopback address on this computer.');
  const model = String(raw.model || DEFAULT_MODEL).trim();
  if (!/^[\w.:/-]{1,100}$/.test(model)) throw new Error('model must be an Ollama model name such as qwen2.5vl:7b.');
  return { origin: origin.origin, ollama: ollama.origin, model, keepAlive: String(raw.keepAlive || '15m') };
}

// Ollama lists "name:tag"; a bare name in config means ":latest".
export function hasModel(tags, model) {
  const want = model.includes(':') ? model : `${model}:latest`;
  return (tags?.models || []).some((m) => m.name === want || m.model === want);
}

// Small models undercount when asked for totals directly. Making them write out
// each component first (the schema fixes key order) and summing in code helps a lot.
const ITEMIZE = ' First list every component in items with its portion in grams and its own calories and macros (include cooking fat, sauces, cheese, dressings and drinks as separate items). The totals are recomputed from items. Set confidence to high only for a nutrition label or an exact known restaurant item.';
const MACROS = ['calories', 'protein', 'carbs', 'fat'];
export function localMealSchema() {
  const base = mealEstimateSchema();
  const num = { type: 'number', minimum: 0 };
  const items = { type: 'array', minItems: 1, maxItems: 20, items: { type: 'object', properties: { name: { type: 'string' }, grams: num, calories: num, protein: num, carbs: num, fat: num }, required: ['name', 'grams', ...MACROS] } };
  const { food_present, food_name, ...rest } = base.properties;
  return { ...base, properties: { food_present, food_name, items, ...rest }, required: ['food_present', 'food_name', 'items', ...base.required.slice(2)] };
}

// Job input (already validated server-side) → Ollama /api/chat request. Revalidated
// here so a tampered relay can't push anything but a meal photo/description.
// num_ctx 4096 keeps a 7B vision model entirely on an 8 GB GPU (8192 spills to CPU).
export function ollamaRequest(jobInput, cfg) {
  const input = validateMealInput(jobInput?.byText ? { description: jobInput.description } :
    { imageBase64: jobInput?.imageBase64, mediaType: jobInput?.mediaType, context: jobInput?.context ?? '' });
  return {
    model: cfg.model, stream: false, keep_alive: cfg.keepAlive, format: localMealSchema(),
    // A full answer is ~300–500 tokens; the cap makes a runaway generation fail in seconds.
    options: { temperature: 0.2, num_ctx: 4096, num_predict: 1200 },
    messages: [
      { role: 'system', content: mealInstructions('local') + ITEMIZE },
      { role: 'user', content: mealUserText(input), ...(input.byText ? {} : { images: [input.imageBase64] }) },
    ],
  };
}

// Ollama reply → raw estimate object (server validates and normalizes it again).
export function parseOllamaReply(reply) {
  const text = reply?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('The model returned no answer.');
  let value;
  try { value = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { throw new Error('The model did not return valid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The model did not return an estimate object.');
  const keep = ['food_present', 'food_name', 'calories', 'protein', 'carbs', 'fat', 'micros', 'confidence', 'notes', 'assumptions'];
  const estimate = Object.fromEntries(keep.filter((k) => value[k] !== undefined).map((k) => [k, value[k]]));
  const items = Array.isArray(value.items) ? value.items.filter((i) => i && typeof i.name === 'string' && MACROS.every((k) => Number.isFinite(Number(i[k])) && Number(i[k]) >= 0)).slice(0, 20) : [];
  if (items.length) {
    // Trust the per-item numbers over the model's own arithmetic.
    for (const k of MACROS) estimate[k] = Math.round(items.reduce((sum, i) => sum + Number(i[k]), 0) * 10) / 10;
    const breakdown = items.map((i) => `${i.name.slice(0, 60)}${Number(i.grams) > 0 ? ` (${Math.round(Number(i.grams))} g)` : ''} ${Math.round(Number(i.calories))} kcal`).join('; ');
    estimate.notes = [typeof estimate.notes === 'string' ? estimate.notes : '', `Breakdown: ${breakdown}.`].filter(Boolean).join(' ').slice(0, 2500);
  }
  if (JSON.stringify(estimate).length > 30000) throw new Error('The model answer was too long.');
  return estimate;
}
