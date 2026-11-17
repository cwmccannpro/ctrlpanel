import { useMemo } from 'react';
import { eventsForDay } from './calendarView.js';
import { nutritionDay, nutritionDayRange, nutritionGoals, nutritionTotals } from './nutrition.js';
import { dayLoad } from './taskBlocks.js';
import { upNext } from './upNext.js';
import { useCalendarEvents } from './useCalendarEvents.js';
import { useMealTimeZone } from './useMealTimeZone.js';
import { useNutritionRows } from './useNutritionRows.js';
import { useTaskPlanner } from './useTaskPlanner.js';

/**
 * Today for the Drive dashboard, from the same sources as the main dashboard:
 * the Day Plan's Now/Next (calendar events + scheduled To Do blocks) and the
 * Nutrition panel's macro totals and targets (meal timezone respected).
 */
export function useDriveToday(now) {
  const events = useCalendarEvents();
  const planner = useTaskPlanner();
  const timeZone = useMealTimeZone();
  const meals = useNutritionRows('nutrition_logs', 'logged_at,calories,protein,carbs,fat', 'logged_at', nutritionDayRange(now, timeZone));
  const goals = useNutritionRows('user_goals', '*', 'updated_at');

  const items = useMemo(() => [...events, ...planner.items], [events, planner.items]);
  const plan = useMemo(() => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { ...upNext(eventsForDay(items, date), { now }), free: Math.max(0, dayLoad(items, date).free) };
  }, [items, now]);

  const day = nutritionDay(now, timeZone);
  const macros = useMemo(() => ({
    totals: nutritionTotals(meals.rows.filter((meal) => nutritionDay(meal.logged_at, timeZone) === day)),
    goals: nutritionGoals(goals.rows.at(-1)),
    loading: meals.loading,
    error: meals.error,
  }), [meals.rows, meals.loading, meals.error, goals.rows, day, timeZone]);

  return { plan, macros };
}
