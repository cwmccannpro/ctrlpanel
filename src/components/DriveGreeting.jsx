import { useEffect, useState } from 'react';
import { formatClock, formatLongDate, greeting } from '../lib/helpers.js';

/** "Good evening, Name" with the live date and time, as on the full dashboard. Ticks on its own. */
export default function DriveGreeting({ name }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) setNow(new Date()); }, 1000);
    return () => clearInterval(timer);
  }, []);
  return <div className="drive-hello"><strong>{greeting(now)}{name ? `, ${name}` : ''}</strong><span>{formatLongDate(now)} · {formatClock(now)}</span></div>;
}
