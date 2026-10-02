import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DEFAULT_THEME, THEMES, THEME_IDS, isTheme, resolveTheme } from '../src/lib/themes.js';

const css = readFileSync(new URL('../src/styles/themes.css', import.meta.url), 'utf8');
const globals = readFileSync(new URL('../src/styles/globals.css', import.meta.url), 'utf8');

// Every token a theme must define so no surface falls back to another theme's colour.
const REQUIRED = [
  '--bg-base', '--bg-surface', '--bg-elevated', '--border', '--border-bright',
  '--text-primary', '--text-secondary', '--text-muted', '--tint', '--glass', 'color-scheme',
];

const block = (id) => css.match(new RegExp(`:root\\[data-theme='${id}'\\]\\s*\\{([^}]*)\\}`))?.[1];

test('theme ids are unique and the default exists', () => {
  assert.equal(new Set(THEME_IDS).size, THEME_IDS.length);
  assert.ok(isTheme(DEFAULT_THEME));
  assert.ok(isTheme('system'));
  assert.equal(isTheme('nope'), false);
});

test('every concrete theme (except the default) has a complete CSS block', () => {
  for (const t of THEMES.filter((x) => x.id !== DEFAULT_THEME && x.id !== 'system')) {
    const body = block(t.id);
    assert.ok(body, `missing :root[data-theme='${t.id}'] block`);
    for (const token of REQUIRED) assert.ok(body.includes(token), `${t.id} is missing ${token}`);
    assert.ok(body.includes(`color-scheme: ${t.scheme}`), `${t.id} color-scheme should be ${t.scheme}`);
  }
});

test('the default theme tokens live in globals.css', () => {
  for (const token of REQUIRED.filter((t) => t !== 'color-scheme')) assert.ok(globals.includes(`${token}:`), `globals.css lacks ${token}`);
});

test('swatch previews match the CSS (so Settings shows the real colours)', () => {
  for (const t of THEMES.filter((x) => x.preview && x.id !== DEFAULT_THEME)) {
    const body = block(t.id);
    assert.ok(body.includes(`--bg-base: ${t.preview.base}`), `${t.id} base`);
    assert.ok(body.includes(`--bg-surface: ${t.preview.surface}`), `${t.id} surface`);
    assert.ok(body.includes(`--text-primary: ${t.preview.text}`), `${t.id} text`);
  }
});

test('system resolves from the OS preference; unknown ids fall back', () => {
  assert.equal(resolveTheme('system', true), 'light');
  assert.equal(resolveTheme('system', false), DEFAULT_THEME);
  assert.equal(resolveTheme('midnight', true), 'midnight');
  assert.equal(resolveTheme('bogus'), DEFAULT_THEME);
  assert.equal(resolveTheme(undefined), DEFAULT_THEME);
});

// WCAG contrast of each theme's text tokens on its own surfaces.
const hex = (v) => [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16));
const channel = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const luminance = (v) => { const [r, g, b] = hex(v).map(channel); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const token = (body, name) => body.match(new RegExp(name + ':\\s*(#[0-9a-fA-F]{6})'))[1];

test('themes keep text readable: primary 7:1, secondary 4.5:1, muted 3:1 on base and surface', () => {
  // The default Crimson theme (globals.css) is fixed by the design system and exempt.
  for (const t of THEMES.filter((x) => x.id !== DEFAULT_THEME && x.id !== 'system')) {
    const body = block(t.id);
    for (const surface of ['--bg-base', '--bg-surface']) {
      const bg = token(body, surface);
      assert.ok(contrast(token(body, '--text-primary'), bg) >= 7, `${t.id} primary on ${surface}`);
      assert.ok(contrast(token(body, '--text-secondary'), bg) >= 4.5, `${t.id} secondary on ${surface}`);
      assert.ok(contrast(token(body, '--text-muted'), bg) >= 3, `${t.id} muted on ${surface}`);
    }
  }
});
