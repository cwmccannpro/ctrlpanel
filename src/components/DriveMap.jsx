import { useEffect, useRef, useState } from 'react';
import { currentDriveLocation, driveHeading, driveMapStyle } from '../lib/driveMap.js';

// MapLibre (~250 kB gzip) loads only when a map is first shown.
let mapLibre;
const loadMapLibre = () => (mapLibre ||= Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')])
  .then(([m]) => m.default || m)
  .catch((error) => { mapLibre = null; throw error; }));

/**
 * Live north-up vector street map that follows the device. `compact` is the
 * non-interactive dial face; `full` is the Drive "Map" page. Dragging the map
 * stops following until Recenter is pressed.
 */
export default function DriveMap({ location, onEnable, message, light = false, compact = false, full = false }) {
  const node = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const [follow, setFollow] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const fix = currentDriveLocation(location);
  const heading = driveHeading(fix);

  // Create the map once there is a location to show.
  useEffect(() => {
    if (!fix || map.current) return undefined;
    let cancelled = false;
    setStatus('loading');
    loadMapLibre().then((ml) => {
      if (cancelled || !node.current || map.current) return;
      const m = new ml.Map({
        container: node.current, style: driveMapStyle(light), center: [fix.longitude, fix.latitude], zoom: full ? 16 : 15,
        attributionControl: false, interactive: !compact, dragRotate: false, pitchWithRotate: false, touchPitch: false, fadeDuration: 150,
      });
      if (!compact) m.touchZoomRotate.disableRotation();
      m.addControl(new ml.AttributionControl({ compact: !full }), 'bottom-right');
      // Compact attribution opens expanded; start it collapsed to the (i) button so it doesn't cover the road.
      if (!full) m.once('idle', () => { const a = m.getContainer().querySelector('.maplibregl-ctrl-attrib'); a?.classList.remove('maplibregl-compact-show'); a?.removeAttribute('open'); });
      const el = document.createElement('div');
      el.className = 'drive-puck';
      el.setAttribute('aria-label', 'Your location');
      el.innerHTML = '<i class="drive-puck-cone"></i><span class="drive-puck-halo"></span><b></b>';
      marker.current = new ml.Marker({ element: el }).setLngLat([fix.longitude, fix.latitude]).addTo(m);
      m.on('dragstart', () => setFollow(false));
      m.once('load', () => setStatus('ready'));
      m.on('error', () => { if (!m.isStyleLoaded()) setStatus('error'); });
      map.current = m;
    }).catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [Boolean(fix), attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { map.current?.remove(); map.current = null; marker.current = null; }, []);

  // Keep the canvas sized to its box (page and layout changes).
  useEffect(() => {
    const observer = new ResizeObserver(() => map.current?.resize());
    observer.observe(node.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => { map.current?.setStyle(driveMapStyle(light)); }, [light]);

  // Move the marker and, while following, glide the map with it.
  useEffect(() => {
    if (!map.current || !marker.current || !fix) return;
    marker.current.setLngLat([fix.longitude, fix.latitude]);
    const el = marker.current.getElement();
    el.classList.toggle('has-heading', heading != null);
    el.style.setProperty('--heading', `${heading ?? 0}deg`);
    if (follow) map.current.easeTo({ center: [fix.longitude, fix.latitude], duration: 900, easing: (t) => t });
  }, [fix?.latitude, fix?.longitude, heading, follow, status]); // eslint-disable-line react-hooks/exhaustive-deps

  const created = status === 'loading' || status === 'ready';
  return <div className={`drive-live-map ${compact ? 'drive-live-map--compact' : ''} ${full ? 'drive-live-map--full' : ''} ${light ? 'drive-live-map--light' : ''}`} aria-label="Live location street map" data-no-swipe>
    <div ref={node} className="drive-map-canvas" />
    {!fix && !created && <div className="drive-map-wait"><span>{message || (location ? 'Location is out of date' : 'Your location, right here')}</span><button onClick={onEnable}>Enable live map</button></div>}
    {!fix && created && <div className="drive-map-status">Location paused</div>}
    {status === 'error' && <div className="drive-map-status">Map unavailable <button onClick={() => { map.current?.remove(); map.current = null; setStatus('idle'); setAttempt((a) => a + 1); }}>Retry</button></div>}
    {created && !compact && <div className="drive-map-zoom">
      <button aria-label="Zoom in" onClick={() => map.current?.zoomIn()}>+</button>
      <button aria-label="Zoom out" onClick={() => map.current?.zoomOut()}>−</button>
      {!follow && <button aria-label="Recenter on your location" onClick={() => setFollow(true)}>◎</button>}
    </div>}
  </div>;
}
