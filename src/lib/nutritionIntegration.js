import { NUTRIENTS } from './nutrition.js';

export function publicNutritionOrigin(value) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      !url.hostname.includes('.') || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':') ||
      /(^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname) ||
      (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) throw new Error();
    return url.origin;
  } catch { throw new Error('Enter your deployed CTRLpanel HTTPS address, without a page path (for example, https://ctrlpanel.example.com).'); }
}

export function nutritionOpenApi(origin) {
  const metrics = Object.fromEntries(NUTRIENTS.map(({ key, label, unit, max }) => [key, { type: 'number', minimum: 0, maximum: max, description: `${label} in ${unit}.` }]));
  const response = (description, schema) => ({ description, content: { 'application/json': { schema } } });
  const error = { $ref: '#/components/schemas/Error' };
  return {
    openapi: '3.1.0', info: { title: 'CTRLpanel Nutrition', version: '2.0.0', description: 'Log meal estimates and read daily totals in your private CTRLpanel.' },
    servers: [{ url: publicNutritionOrigin(origin) }], security: [{ bearerAuth: [] }],
    paths: {
      '/api/nutrition/check': { get: {
        operationId: 'checkNutritionConnection', summary: 'Check connection and read today’s totals',
        description: 'Checks the nutrition key and returns the current day, meal timezone, totals and goals. Does not create a meal.',
        responses: { '200': response('Connected', { $ref: '#/components/schemas/DayResult' }), '401': response('Invalid or revoked key', error), '503': response('Nutrition service unavailable', error) },
      } },
      '/api/nutrition/log': { post: {
        operationId: 'logNutritionEntry', summary: 'Log one meal or food item', 'x-openai-isConsequential': false,
        description: 'Saves one meal with calories and macros. Returns its id, local-day totals and goals. Reuse request_id when retrying the same meal to avoid duplicates.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/NutritionEntry' } } } },
        responses: { '200': response('Meal saved', { $ref: '#/components/schemas/LogResult' }), '400': response('Invalid meal', error), '401': response('Invalid or revoked key', error), '409': response('request_id already used for another meal', error), '503': response('Nutrition service unavailable', error) },
      } },
    },
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      schemas: {
        NutritionEntry: { type: 'object', required: ['food_name', ...NUTRIENTS.map((n) => n.key), 'request_id'], properties: {
          food_name: { type: 'string', maxLength: 200, description: 'Name of the whole meal or food item.' }, ...metrics,
          notes: { type: 'string', maxLength: 3000, description: 'Portions, ingredients, and assumptions. Label photo values as estimates.' },
          timestamp: { type: 'string', format: 'date-time', description: 'When eaten, including timezone offset. Omit for now.' },
          request_id: { type: 'string', minLength: 8, maxLength: 120, description: 'Unique id for this meal, reused unchanged on retries. A different meal needs a new id.' },
        } },
        Totals: { type: 'object', properties: metrics },
        DayResult: { type: 'object', properties: { ok: { type: 'boolean' }, day: { type: 'string' }, timezone: { type: 'string' }, day_totals: { $ref: '#/components/schemas/Totals' }, goals: { $ref: '#/components/schemas/Totals' } } },
        LogResult: { type: 'object', properties: {
          ok: { type: 'boolean' }, replayed: { type: 'boolean' }, day: { type: 'string' }, timezone: { type: 'string' },
          entry: { type: 'object', properties: { id: { type: 'string' }, meal_name: { type: 'string' }, ...metrics, logged_at: { type: 'string', format: 'date-time' } } },
          day_totals: { anyOf: [{ $ref: '#/components/schemas/Totals' }, { type: 'null' }] }, goals: { anyOf: [{ $ref: '#/components/schemas/Totals' }, { type: 'null' }] },
        } },
        Error: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  };
}

export const NUTRITION_GPT_INSTRUCTIONS = `You are my personal meal logger connected to CTRLpanel.
When I send a food photo or ask you to log food, estimate the full meal's calories, protein, carbs and fat. Read nutrition labels when visible and scale by the amount eaten. Ask one brief portion question only if the image is too unclear to estimate. Record visible ingredients, assumed portions and cooking fats in notes, and label photo-based values as estimates.
Call checkNutritionConnection before the first log in a conversation to get the meal timezone and current day. Then call logNutritionEntry with food_name, calories (kcal), protein/carbs/fat (grams), notes and a new unique request_id for each meal. Combine the foods in one photo into one meal entry. Never send an image, base64 data, an invented photo URL, a user_id or a secret key as an action argument.
For food eaten now, omit timestamp so the server uses the current time. For earlier food, use an ISO date-time with the correct timezone offset from the connection check; ask if the intended date is unclear.
Reuse the same request_id and identical meal values for any retry. Never log the same photo again unless I explicitly ask for another serving. If I ask a general nutrition question or say not to log, answer without saving.
Only say "Saved to CTRLpanel" after the action returns ok:true and an entry id. Show the meal estimate and the returned daily totals briefly. If totals are null, confirm the saved meal but say totals are temporarily unavailable. If the action fails, say it wasn't confirmed saved and show the error; never claim success or repeat the meal with a new request_id.
Keep responses short. This GPT is private and only logs to my account.`;
