import { useEffect, useState } from 'react';
import '../styles/overlays.css';

/** A slim bar while the device has no connection, so failed saves/loads aren't a mystery. */
export default function OfflineBanner() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  if (online) return null;
  return (
    <div className="offline-banner" role="status">
      <i className="ti ti-wifi-off" /> You’re offline — what’s already loaded still works, but changes won’t save until you’re back.
    </div>
  );
}
