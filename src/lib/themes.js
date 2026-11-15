// Theme registry + helpers. Pure apart from touching <html> / localStorage when
// called, so the registry can be unit-tested with `node --test`.
//
// A theme swaps surface / border / text tokens (src/styles/themes.css); the
// accent colour is separate and stays the user's own pick. "system" follows the
// OS: Light when it prefers light, otherwise the default dark.

export const DEFAULT_THEME = 'crimson';
export const THEME_KEY = 'ctrlpanel-theme';

// `preview` colours drive the little swatch in Settings (they mirror themes.css).
export const THEMES = [
  { id: 'crimson', label: 'Crimson', scheme: 'dark', note: 'Warm near-black', preview: { base: '#0a0808', surface: '#141010', text: '#f0e8e8', muted: '#8a7070' } },
  { id: 'midnight', label: 'Midnight', scheme: 'dark', note: 'Deep blue-black', preview: { base: '#070a12', surface: '#0d121c', text: '#e7ecf6', muted: '#7384a3' } },
  { id: 'graphite', label: 'Graphite', scheme: 'dark', note: 'Neutral charcoal', preview: { base: '#0b0b0d', surface: '#131316', text: '#ededf0', muted: '#8c8c96' } },
  { id: 'forest', label: 'Forest', scheme: 'dark', note: 'Green-tinted dark', preview: { base: '#070b09', surface: '#0d1411', text: '#e6f0ea', muted: '#6e8c7b' } },
  { id: 'amoled', label: 'AMOLED', scheme: 'dark', note: 'True black', preview: { base: '#000000', surface: '#080808', text: '#f2f2f2', muted: '#8a8a8a' } },
  { id: 'light', label: 'Light', scheme: 'light', note: 'Warm paper', preview: { base: '#f4f1ec', surface: '#ffffff', text: '#1d1816', muted: '#6a5e5a' } },
  { id: 'system', label: 'System', scheme: 'auto', note: 'Match your device', preview: null },
];

export const THEME_IDS = THEMES.map((t) => t.id);

/** The browser-chrome colour (address bar / installed-app title bar) for a concrete theme. */
export const themeColor = (id) => THEMES.find((t) => t.id === id)?.preview?.base || THEMES[0].preview.base;

export const isTheme = (id) => THEME_IDS.includes(id);

/** The concrete theme to paint: "system" resolves from the OS preference. */
export function resolveTheme(id, prefersLight = false) {
  if (id === 'system') return prefersLight ? 'light' : DEFAULT_THEME;
  return isTheme(id) ? id : DEFAULT_THEME;
}

export function getSavedTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return isTheme(saved) ? saved : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

const prefersLight = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;

/** Paint a theme on <html>. Safe to call repeatedly. */
export function applyTheme(id) {
  const resolved = resolveTheme(id, prefersLight());
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themeChoice = isTheme(id) ? id : DEFAULT_THEME;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor(resolved));
}

export function saveTheme(id) {
  const next = isTheme(id) ? id : DEFAULT_THEME;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch { /* private mode: still applies for this session */ }
  applyTheme(next);
}

let watching = false;

/** Apply the saved theme on app start and follow OS changes while on "system". */
export function loadTheme() {
  applyTheme(getSavedTheme());
  if (watching || typeof matchMedia !== 'function') return;
  watching = true;
  matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => {
    if (getSavedTheme() === 'system') applyTheme('system');
  });
}
