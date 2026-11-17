import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
const source = resolve('dist-android');
const target = resolve('android/app/src/main/assets/web');
await stat(resolve(source, 'tablet.html'));
// Fixed, repo-owned generated directory only.
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
console.log(`Packaged ${ (await readdir(source)).length } web entries into Android assets.`);
