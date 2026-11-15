// Daily quote for the dashboard. One quote per calendar day, the same all day.
export const QUOTES = [
  { q: 'Discipline equals freedom.', a: 'Jocko Willink' },
  { q: 'We are what we repeatedly do. Excellence, then, is not an act, but a habit.', a: 'Aristotle' },
  { q: 'Take care of your body. It’s the only place you have to live.', a: 'Jim Rohn' },
  { q: 'Success is the sum of small efforts repeated day in and day out.', a: 'Robert Collier' },
  { q: 'The body achieves what the mind believes.', a: 'Napoleon Hill' },
  { q: 'Motivation gets you going, discipline keeps you growing.', a: 'John C. Maxwell' },
  { q: 'The groundwork for all happiness is good health.', a: 'Leigh Hunt' },
  { q: 'Fall in love with the process and the results will come.', a: 'Eric Thomas' },
  { q: 'An investment in knowledge pays the best interest.', a: 'Benjamin Franklin' },
  { q: 'Fear no man, look up to no man. Watch and learn from everyone.', a: 'David Goggins' },
];

/** The quote for a day; `offset` steps through the list (the panel's "next" button). */
export function quoteOfDay(date = new Date(), offset = 0) {
  const doy = Math.floor((new Date(date.getFullYear(), date.getMonth(), date.getDate()) - new Date(date.getFullYear(), 0, 0)) / 86400000);
  const i = (((doy + offset) % QUOTES.length) + QUOTES.length) % QUOTES.length;
  return QUOTES[i];
}
