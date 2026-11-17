import DriveGlyph from './DriveGlyph.jsx';
import { driveImage, turnKind } from '../lib/drive.js';

// Maneuver arrows (48×48), used when Google Maps' own arrow image isn't available.
const ARROWS = {
  straight: 'M24 42V8M13 19 24 8l11 11',
  left: 'M32 42V24a8 8 0 0 0-8-8H10M18 8l-8 8 8 8',
  right: 'M16 42V24a8 8 0 0 1 8-8h14M30 8l8 8-8 8',
  'slight-left': 'M30 42V28L15 13M15 25V13h12',
  'slight-right': 'M18 42V28l15-15M21 13h12v12',
  'sharp-left': 'M32 42V12L13 31M13 20v11h11',
  'sharp-right': 'M16 42V12l19 19M24 31h11V20',
  uturn: 'M34 42V20a10 10 0 0 0-20 0v14M6 26l8 8 8-8',
  merge: 'M24 42V26M12 8c0 10 12 10 12 18M36 8c0 10-12 10-12 18M18 14l-6-6-2 8',
  roundabout: 'M24 42V29M24 29a8 8 0 1 0-8-8M16 21v-8M16 13l-5 5M16 13l5 5',
  arrive: 'M24 43s12-12 12-21a12 12 0 0 0-24 0c0 9 12 21 12 21ZM24 26a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
};

/**
 * Next-turn card from the Google Maps navigation notification: the turn arrow,
 * the distance (Maps puts it in the title) and the instruction. Nothing but a
 * dim icon when no route is running.
 */
export default function DriveDirections({ maps }) {
  if (!maps?.title && !maps?.text) return <div className="drive-idle" aria-label="No active route"><DriveGlyph name="maps" /></div>;
  const icon = driveImage(maps.icon, 200000);
  const kind = turnKind(maps.title, maps.text);
  return (
    <div className="drive-turn" role="status">
      <div className="drive-turn-icon" aria-hidden="true">
        {icon ? <span className="drive-turn-img" style={{ WebkitMaskImage: `url("${icon}")`, maskImage: `url("${icon}")` }} />
          : <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d={ARROWS[kind]} /></svg>}
      </div>
      <div className="drive-turn-text">
        <strong>{maps.title || maps.text}</strong>
        {maps.title && maps.text && <span>{maps.text}</span>}
        {maps.subtext && <small>{maps.subtext}</small>}
      </div>
    </div>
  );
}
