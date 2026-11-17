import { useEffect, useRef, useState } from 'react';
import { sendDriveCommand } from './drive.js';

export function useDriveLocation(native) {
  const [location, setLocation] = useState(null);
  const [message, setMessage] = useState('');
  const watch = useRef(null);
  const stop = () => { if (watch.current !== null) navigator.geolocation?.clearWatch(watch.current); watch.current = null; };
  useEffect(() => stop, []);
  const enable = () => {
    if (window.CTRLDrive) { sendDriveCommand('location'); return; }
    if (!navigator.geolocation) { setMessage('Location is not available in this browser.'); return; }
    stop(); setMessage('Waiting for location…');
    watch.current = navigator.geolocation.watchPosition(p => {
      setLocation({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy, speed: p.coords.speed, bearing: p.coords.heading, timestamp: p.timestamp }); setMessage('');
    }, () => { setMessage('Allow location access to show the live map.'); }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 });
  };
  return { location: native.available ? native.location : location, message: native.available ? native.locationMessage : message, enable };
}
