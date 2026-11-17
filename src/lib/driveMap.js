export function currentDriveLocation(value, now = Date.now()) {
  if (!value || !Number.isFinite(value.latitude) || !Number.isFinite(value.longitude)
    || Math.abs(value.latitude) > 90 || Math.abs(value.longitude) > 180
    || !Number.isFinite(value.timestamp) || now - value.timestamp > 60000 || value.timestamp > now + 5000) return null;
  return value;
}

// Vector street maps from OpenFreeMap (OpenStreetMap data; free, no key), drawn by MapLibre.
export const DRIVE_MAP_STYLES = { dark: 'https://tiles.openfreemap.org/styles/dark', light: 'https://tiles.openfreemap.org/styles/liberty' };
export const driveMapStyle = (light = false) => DRIVE_MAP_STYLES[light ? 'light' : 'dark'];

/** Heading in degrees for the location marker, only while actually moving (GPS bearing is noise when parked). */
export function driveHeading(fix) {
  return fix && Number.isFinite(fix.bearing) && Number.isFinite(fix.speed) && fix.speed > 1 ? ((fix.bearing % 360) + 360) % 360 : null;
}
