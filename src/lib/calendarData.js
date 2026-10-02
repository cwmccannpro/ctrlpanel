import { supabase } from './supabase.js';

// Fetch only events overlapping the visible range, paging beyond the server's
// default row cap. Date boundaries are local midnights converted to ISO.
export async function loadCalendarEvents(from, until) {
  if (!supabase) throw new Error('Connect your database to load saved events.');
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('calendar_events').select('*')
      .lt('starts_at', until)
      .or(`ends_at.gt.${from},and(ends_at.is.null,starts_at.gte.${from})`)
      .order('id').range(offset, offset + 499);
    if (error) throw new Error('Saved events could not load. Check your database connection.');
    rows.push(...data);
    if (data.length < 500) return rows;
  }
}
