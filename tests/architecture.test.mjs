import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');
const walk = (dir) =>
  readdirSync(join(root, dir)).flatMap((name) => {
    const rel = join(dir, name);
    return statSync(join(root, rel)).isDirectory() ? walk(rel) : [rel];
  });

/* ---------------- lazy pages ---------------- */

const routes = read('src/routes.jsx');

test('every page is lazy-loaded: no static page imports in routes.jsx', () => {
  assert.equal(/^import \w+ from '\.\/pages\//m.test(routes), false, 'a page is imported eagerly');
  assert.match(routes, /import \{ lazy \} from 'react'/);
});

test('every page file is registered as a lazy route (and nothing is orphaned)', () => {
  const pages = walk('src/pages')
    .filter((f) => f.endsWith('.jsx'))
    .map((f) => relative('src', f).split('\\').join('/'))
    .filter((f) => !/^pages\/(Login|Register)\.jsx$/.test(f)); // auth screens are loaded by main.jsx
  for (const page of pages) assert.ok(routes.includes(`import('./${page}')`), `${page} is not routed`);
});

test('idle prefetch covers every page except the landing page', () => {
  const loaders = [...routes.matchAll(/^  (\w+): \(\) => import\(/gm)].map((m) => m[1]);
  const prefetched = [...routes.slice(routes.indexOf('export const pageLoaders')).matchAll(/loaders\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual([...loaders].filter((n) => n !== 'Dashboard').sort(), [...prefetched].sort());
});

/* ---------------- crash containment ---------------- */

test('a page crash cannot take the shell down: boundary + suspense in App, errorElement on the route', () => {
  const app = read('src/App.jsx');
  assert.match(app, /<ErrorBoundary resetKey=\{pathname\}>\s*<Suspense fallback=\{<PageLoading \/>\}>\s*<Outlet \/>/);
  assert.match(read('src/main.jsx'), /errorElement: <RouteError \/>/);
});

/* ---------------- theming guard ---------------- */

test('no component or stylesheet hardcodes the default theme colours (use var(--token))', () => {
  const files = [...walk('src'), ...walk('scripts')].filter((f) => /\.(jsx?|css)$/.test(f));
  const allowed = [
    'src/styles/globals.css', // where the tokens are defined
    'src/styles/themes.css',
    'src/lib/themes.js', // theme registry (swatch previews)
    'scripts/make-icons.mjs', // the app icon is a fixed brand mark
  ].map((f) => f.split('/').join('\\'));
  const offenders = [];
  for (const f of files) {
    if (allowed.includes(f) || allowed.includes(f.split('\\').join('/'))) continue;
    read(f.split('\\').join('/')).split('\n').forEach((line, i) => {
      if (!/#(0a0808|141010|1a1414|1e1818|2a2020|f0e8e8|8a7070|3d2e2e)\b/i.test(line)) return;
      // Intentional: the "System" theme swatch (half dark, half light) and a fixed workout-type chip colour.
      if (/theme-preview--auto|linear-gradient\(90deg, #0a0808|Rest: '#3d2e2e'|Chart chrome/.test(line)) return;
      offenders.push(`${f.split('\\').join('/')}:${i + 1}: ${line.trim().slice(0, 80)}`);
    });
  }
  assert.deepEqual(offenders, [], `hardcoded theme colours:\n${offenders.join('\n')}`);
});

/* ---------------- bundle budget (only when a build exists) ---------------- */

test('first visit stays small: initial JS+CSS under 200 kB gzip (needs `npm run build`)', { skip: !existsSync(join(root, 'dist/index.html')) }, () => {
  const out = execFileSync('node', ['scripts/bundle-report.mjs', '--json'], { cwd: root, encoding: 'utf8' });
  const info = JSON.parse(out.trim().split('\n').pop());
  assert.ok(info.initialGzip < 200 * 1024, `initial download is ${(info.initialGzip / 1024).toFixed(1)} kB gzip (budget 200 kB)`);
  // The heavy libraries must stay out of the entry path.
  for (const heavy of ['excalidraw', 'mermaid', 'cytoscape', 'katex', 'subset-shared', 'generateCategoricalChart']) {
    assert.ok(!info.files.some((f) => f.includes(heavy)), `${heavy} leaked into the initial bundle`);
  }
});
