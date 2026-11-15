import { useMemo } from 'react';
import { useAuth } from '../components/AuthProvider.jsx';
import { sanitizeFeeds } from './icalFeeds.js';

// The signed-in user's saved .ics feeds (stable identity until they change).
export function useIcalFeeds() {
  const { settings } = useAuth();
  const raw = settings?.ui_preferences?.calendar?.feeds;
  return useMemo(() => sanitizeFeeds(raw), [raw]);
}
