// Prints what the browser must download up front vs. on demand.
//   npm run build && node scripts/bundle-report.mjs
//
// "Initial" = the entry chunk plus every chunk it statically imports (what a first
// visit pays for). Everything else is lazy: fetched when a page/feature needs it.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const assets = join(dist, 'assets');
const kb = (n) => `${(n / 1024).toFixed(1)} kB`;

const files = readdirSync(assets).filter((f) => f.endsWith('.js') || f.endsWith('.css'));
const info = Object.fromEntries(
  files.map((f) => {
    const buf = readFileSync(join(assets, f));
    return [f, { size: statSync(join(assets, f)).size, gzip: gzipSync(buf).length, code: f.endsWith('.js') ? buf.toString('utf8') : '' }];
  })
);

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const entry = html.match(/src="\/assets\/([^"]+\.js)"/)?.[1];
const initial = new Set();
const visit = (name) => {
  if (!info[name] || initial.has(name)) return;
  initial.add(name);
  // Static imports look like `from"./x.js"` / `import"./x.js"`; dynamic ones are import("./x.js").
  for (const m of info[name].code.matchAll(/(?:from|import)\s*["']\.\/([^"']+\.js)["']/g)) visit(m[1]);
};
visit(entry);
// CSS referenced from index.html is initial too.
for (const m of html.matchAll(/href="\/assets\/([^"]+\.css)"/g)) initial.add(m[1]);

const row = ([name, v]) => `  ${kb(v.size).padStart(10)}  ${kb(v.gzip).padStart(10)} gz  ${name}`;
const sum = (names) => names.reduce((a, n) => ({ size: a.size + info[n].size, gzip: a.gzip + info[n].gzip }), { size: 0, gzip: 0 });
const sorted = Object.entries(info).sort((a, b) => b[1].size - a[1].size);

const init = [...initial];
const t = sum(init);
console.log(`\nINITIAL (first visit): ${kb(t.size)} raw, ${kb(t.gzip)} gzip across ${init.length} files`);
sorted.filter(([n]) => initial.has(n)).forEach((e) => console.log(row(e)));

const lazy = Object.keys(info).filter((n) => !initial.has(n));
const l = sum(lazy);
console.log(`\nLAZY (on demand): ${kb(l.size)} raw across ${lazy.length} files — largest:`);
sorted.filter(([n]) => !initial.has(n)).slice(0, 8).forEach((e) => console.log(row(e)));
console.log(`\nentry: ${entry}\n`);

// Machine-readable for tests/budgets.
if (process.argv.includes('--json')) console.log(JSON.stringify({ entry, initialGzip: t.gzip, initialRaw: t.size, files: init }));
