import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MICRO_NUTRIENTS, nutritionEntry, nutritionMicros, micronutrientTotals, micronutrientGoals, nutrientProgress } from '../src/lib/nutrition.js';
import { nutritionOpenApi } from '../src/lib/nutritionIntegration.js';

const meal = { food_name: 'Meal', calories: 500, protein: 30, carbs: 50, fat: 20 };
test('micro intake validates amounts, keeps zero, and omits unknown values', () => {
  assert.deepEqual(nutritionMicros({ iron: '2.555', vitamin_d: null, fiber: '', sodium: 0 }), { iron: 2.56, sodium: 0 });
  for (const value of [-1, NaN, Infinity, true, '  ', 'twenty', 100001]) assert.throws(() => nutritionMicros({ iron: value }));
  for (const value of [null, [], 'text']) assert.throws(() => nutritionMicros(value));
  assert.throws(() => nutritionMicros({ vitaminD: 10 }), /Unknown micronutrient/);
  assert.deepEqual(nutritionEntry({ ...meal, micros: { calcium: 125 } }).micros, { calcium: 125 });
  assert.equal(nutritionEntry(meal).micros, undefined, 'legacy logs remain supported');
});
test('micro totals distinguish absent, zero, full and partial meal coverage', () => {
  const totals = micronutrientTotals([{ micros: { iron: 2, sodium: 0 } }, { micros: { iron: 3 } }, meal]);
  assert.deepEqual(totals.iron, { amount: 5, reported: 2, meals: 3 });
  assert.deepEqual(totals.sodium, { amount: 0, reported: 1, meals: 3 });
  assert.deepEqual(totals.calcium, { amount: null, reported: 0, meals: 3 });
  assert.equal(micronutrientTotals([]).iron.amount, null);
  assert.deepEqual(micronutrientTotals([{ micros: { iron: 1.2 } }, { micros: { iron: 2.3 } }]).iron, { amount: 3.5, reported: 2, meals: 2 });
});
test('FDA reference goals support small decimals, overrides and disabled targets', () => {
  assert.equal(micronutrientGoals().vitamin_b12, 2.4);
  assert.equal(micronutrientGoals().calcium, 1300);
  assert.equal(micronutrientGoals({ micros: { iron: 8, sodium: 0 } }).iron, 8);
  assert.equal(micronutrientGoals({ micros: { sodium: 0 } }).sodium, 0);
  assert.equal(MICRO_NUTRIENTS.find((field) => field.key === 'sodium').limit, true);
});
test('progress caps its visual width while preserving excess and handles absent/disabled data', () => {
  assert.deepEqual(nutrientProgress(20, 40), { known: true, hasTarget: true, percent: 50, width: 50 });
  assert.deepEqual(nutrientProgress(60, 40), { known: true, hasTarget: true, percent: 150, width: 100 });
  assert.equal(nutrientProgress(null, 40).percent, null);
  assert.equal(nutrientProgress(0, 40).percent, 0);
  assert.equal(nutrientProgress(20, 0).percent, null);
  assert.equal(nutrientProgress(20, NaN).width, 0);
});
test('GPT contract exposes micro units without making them required or seeding missing zeros', () => {
  const schemas = nutritionOpenApi('https://ctrlpanel.example.com').components.schemas;
  assert.ok(!schemas.NutritionEntry.required.includes('micros'));
  assert.equal(schemas.Micronutrients.additionalProperties, false);
  assert.match(schemas.Micronutrients.properties.vitamin_a.description, /mcg RAE/);
  assert.match(schemas.Micronutrients.properties.folate.description, /mcg DFE/);
  assert.match(schemas.Micronutrients.properties.niacin.description, /mg NE/);
  assert.deepEqual(schemas.Totals.properties.micros.properties.iron.type, ['number', 'null']);
});
