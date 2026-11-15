import { useAuth } from '../components/AuthProvider.jsx';
import { nutritionTimeZone } from './nutrition.js';

// The timezone saved under Settings → Nutrition, or the device's when it is unset or invalid.
export function useMealTimeZone() {
  const { settings } = useAuth();
  const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
  try { return nutritionTimeZone(settings?.ui_preferences?.nutrition?.timeZone || device); }
  catch { return device; }
}
