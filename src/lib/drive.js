import { dayKey, ACCENT_OPTIONS } from './helpers.js';
import { doneColumn } from './commandPalette.js';
import { THEMES } from './themes.js';
import { sidebarNavigation } from './sidebarNavigation.js';

export const DRIVE_FACES = ['digital', 'analog', 'minimal', 'split', 'date', 'orbit', 'maps', 'directions', 'spotify', 'compass', 'speed', 'tasks', 'habits'];
export const DRIVE_PAGES = ['Dashboard', 'All sections', 'Map', 'Music'];
export const DRIVE_THEMES = THEMES.filter(t => t.preview);
export const FACE_LABELS = { digital: 'Digital', analog: 'Classic hands', minimal: 'Minimal', split: 'Stacked clock', date: 'Calendar', orbit: 'Orbit clock', maps: 'Live map', directions: 'Turn directions', spotify: 'Spotify', compass: 'Travel heading', speed: 'Speed estimate', tasks: 'CTRLpanel tasks', habits: 'CTRLpanel habits' };
const navigation = sidebarNavigation();
export const DRIVE_SECTIONS = [...navigation.links.filter(l => l.to !== '/drive'), ...navigation.folders.map(f => ({ to: f.indexTo, label: f.label, icon: f.icon })), { to: '/settings', label: 'Settings', icon: 'ti-settings' }];
export function drivePreferences(value = {}) {
  return { face: DRIVE_FACES.includes(value?.face) ? value.face : 'digital',
    theme: DRIVE_THEMES.some(t => t.id === value?.theme) ? value.theme : 'amoled',
    accent: ACCENT_OPTIONS.some(a => a.value === value?.accent) ? value.accent : ACCENT_OPTIONS[0].value };
}
export function driveThemeStyle(preferences) {
  const p = drivePreferences(preferences);
  const palette = DRIVE_THEMES.find(t => t.id === p.theme).preview;
  return { '--bg-base': palette.base, '--bg-surface': palette.surface, '--bg-elevated': palette.surface,
    '--text-primary': palette.text, '--text-secondary': palette.muted,
    '--border': `color-mix(in srgb, ${palette.text} 12%, ${palette.base})`,
    '--border-bright': `color-mix(in srgb, ${palette.text} 20%, ${palette.base})`,
    '--accent': p.accent, '--accent-dim': `${p.accent}20`, colorScheme: p.theme === 'light' ? 'light' : 'dark' };
}
export function swipePage(page, dx, dy, count = DRIVE_PAGES.length) {
  if (Math.abs(dx) < 65 || Math.abs(dx) < Math.abs(dy) * 1.5) return page;
  return Math.max(0, Math.min(count - 1, page + (dx < 0 ? 1 : -1)));
}
export function driveSummary(data, now = new Date()) {
  const today = dayKey(now);
  const boards = new Map(data.boards.map(b => [b.id, b]));
  const tasks = data.tasks.filter(t => t.column_name !== doneColumn(boards.get(t.board_id)))
    .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
  const habits = data.habits.filter(h => h.active !== false);
  const completed = new Set(data.logs.filter(l => l.log_date === today && l.completed).map(l => l.habit_id));
  return { tasks, due: tasks.filter(t => t.due_date && t.due_date <= today), habits,
    completed: habits.filter(h => completed.has(h.id)).length };
}

// Images from the Android app (album art, Maps turn arrows) are only ever inline base64 PNG/JPEG.
const DATA_IMAGE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
export function driveImage(value, max = 600000) {
  return typeof value === 'string' && value.length <= max && DATA_IMAGE.test(value) ? value : null;
}

// Maneuver from Google Maps' instruction text, for when Android gives no arrow image.
export const TURN_KINDS = ['straight', 'left', 'right', 'slight-left', 'slight-right', 'sharp-left', 'sharp-right', 'uturn', 'merge', 'roundabout', 'arrive'];
export function turnKind(...parts) {
  const t = parts.filter(Boolean).join(' ').toLowerCase();
  const side = /\bleft\b/.test(t) ? 'left' : /\bright\b/.test(t) ? 'right' : '';
  if (/u-?turn/.test(t)) return 'uturn';
  if (/roundabout|traffic circle|rotary/.test(t)) return 'roundabout';
  if (/arriv|destination|on the (left|right)$/.test(t)) return 'arrive';
  if (/\bmerge\b/.test(t)) return 'merge';
  if (side && /sharp/.test(t)) return `sharp-${side}`;
  if (side && /slight|bear|keep|exit|ramp|fork/.test(t)) return `slight-${side}`;
  if (/exit|ramp/.test(t)) return 'slight-right';
  if (side && /turn|onto|\bleft\b|\bright\b/.test(t)) return side;
  return 'straight';
}

/** Where the track is now. `at` is when the position was received; time runs on only while playing. */
export function trackProgress(music, now = Date.now()) {
  const duration = Number(music?.duration);
  if (!(duration > 0)) return null;
  const base = Number(music.position) || 0;
  const elapsed = Math.max(0, Math.min(duration, base + (music.playing && Number.isFinite(music.at) ? Math.max(0, now - music.at) : 0)));
  return { elapsed, duration, remaining: duration - elapsed, fraction: elapsed / duration };
}
export function trackTime(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/**
 * Whether the Android app can read Maps and Spotify. Both come through Android notification
 * access; without it the cards stay empty with no other sign of why.
 * 'browser' (no Android app), 'unsupported', 'off', 'connecting' (granted, listener not bound yet) or 'ready'.
 * Older APKs send only `access` (meaning connected), which reads as 'off' or 'ready'.
 */
export function driveAccess(native) {
  if (!native?.available) return 'browser';
  if (native.supported === false) return 'unsupported';
  if (!native.access) return 'off';
  return native.connected === false ? 'connecting' : 'ready';
}
/** Message for an empty Next turn ('maps') or Spotify ('music') card, or null when nothing is wrong. */
export function driveAccessNotice(state, kind) {
  if (state === 'unsupported') return { text: 'This tablet’s Android doesn’t allow notification access, so Drive can’t read Maps or Spotify.', action: false };
  if (state === 'off') return { text: `Turn on notification access for CTRLpanel Drive to show ${kind === 'maps' ? 'your next turn' : 'what’s playing'}.`, action: true };
  // Spotify only needs access to be on; Maps turns need the listener connected.
  if (state === 'connecting' && kind === 'maps') return { text: 'Reconnecting to Android notifications…', action: true };
  return null;
}

// No arbitrary native intents, URLs, script execution or credential transfer.
const COMMANDS = new Set(['state', 'maps', 'spotify', 'playPause', 'next', 'previous', 'permissions', 'ctrlpanel', 'location', 'voiceMaps', 'voiceMusic']);
export function sendDriveCommand(command) {
  if (!COMMANDS.has(command)) return false;
  if (window.CTRLDrive?.postMessage) { window.CTRLDrive.postMessage(command); return true; }
  if (command === 'maps') window.open('https://www.google.com/maps', '_blank', 'noopener,noreferrer');
  if (command === 'spotify') window.open('https://open.spotify.com', '_blank', 'noopener,noreferrer');
  if (command === 'ctrlpanel') window.location.assign('/');
  return false;
}
export function driveRequest(command, query) {
  if (!['navigate', 'musicSearch'].includes(command) || typeof query !== 'string') return null;
  const text = query.trim();
  if (!text || text.length > 200 || /[\u0000-\u001f]/.test(text)) return null;
  return { command, query: text };
}
/** Seek Spotify to `ms` in the current track (Android app only). */
export function driveSeek(ms) {
  if (typeof ms !== 'number') return null;
  const position = Math.round(ms);
  return Number.isFinite(position) && position >= 0 && position <= 86400000 ? { command: 'seek', position } : null;
}
export function sendDriveSeek(ms) {
  const request = driveSeek(ms);
  if (!request || !window.CTRLDrive?.postMessage) return false;
  window.CTRLDrive.postMessage(JSON.stringify(request));
  return true;
}
export function sendDriveRequest(command, query) {
  const request = driveRequest(command, query);
  if (!request) return false;
  if (window.CTRLDrive?.postMessage) { window.CTRLDrive.postMessage(JSON.stringify(request)); return true; }
  const url = command === 'navigate' ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(request.query)}&travelmode=driving` : `https://open.spotify.com/search/${encodeURIComponent(request.query)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}
