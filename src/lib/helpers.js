// ============================================================
// CTRLpanel — date / number / string / theme helpers
// ============================================================

/* ---- Accent color theming ---- */
export const ACCENT_OPTIONS = [
  { name: 'Red', value: '#e11d48' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Green', value: '#10b981' },
  { name: 'Purple', value: '#8b5cf6' },
  { name: 'Gold', value: '#f59e0b' },
  { name: 'Teal', value: '#14b8a6' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Pink', value: '#ec4899' },
];

const ACCENT_KEY = 'ctrlpanel-accent';

// Convert #rrggbb to "r, g, b"
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

// Apply an accent color to :root, updating accent + dim + glow.
export function applyAccent(hex) {
  const root = document.documentElement;
  const rgb = hexToRgb(hex);
  root.style.setProperty('--accent', hex);
  root.style.setProperty('--accent-dim', `rgba(${rgb}, 0.12)`);
  root.style.setProperty('--accent-glow', `rgba(${rgb}, 0.25)`);
}

export function getSavedAccent() {
  return localStorage.getItem(ACCENT_KEY) || '#e11d48';
}

export function saveAccent(hex) {
  localStorage.setItem(ACCENT_KEY, hex);
  applyAccent(hex);
}

// Load the saved accent on app start and apply it to :root.
export function loadAccent() {
  applyAccent(getSavedAccent());
}

/* ---- Display preferences ---- */
export const FONT_SIZES = { Small: '15px', Medium: '16px', Large: '18px' };

// Apply the saved font size on app start.
export function loadDisplayPrefs() {
  const font = localStorage.getItem('ctrlpanel-font') || 'Medium';
  document.documentElement.style.setProperty('--font-scale', FONT_SIZES[font] || '16px');
}

/* ---- Greeting / time ---- */
export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function formatClock(date = new Date()) {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatLongDate(date = new Date()) {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function relativeDay(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const today = new Date();
  const diff = Math.round((d.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return `In ${diff} days`;
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  return formatDate(dateStr);
}

/* ---- Numbers / currency ---- */
export function currency(n, opts = {}) {
  const value = Number(n) || 0;
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  });
}

export function compactCurrency(n) {
  const value = Number(n) || 0;
  if (Math.abs(value) >= 1000) {
    return '$' + (value / 1000).toFixed(1) + 'k';
  }
  return currency(value);
}

export function percent(n, digits = 1) {
  return `${(Number(n) || 0).toFixed(digits)}%`;
}

export function number(n) {
  return (Number(n) || 0).toLocaleString('en-US');
}

export function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

/* ---- Strings ---- */
export function initials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

export function truncate(str = '', len = 60) {
  return str.length > len ? str.slice(0, len - 1) + '…' : str;
}
