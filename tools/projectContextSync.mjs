import { randomUUID } from 'node:crypto';
import { readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { containsSecret, hash, normalizeProjectMarkdown, noteHash } from './contentContext.mjs';

export function projectFileDecision(note, remote, baseline) {
  if (!remote) return 'create';
  const local = note.twoWay.body;
  const incoming = normalizeProjectMarkdown(remote.content);
  if (incoming === local) return 'unchanged';
  if (typeof baseline?.bodyHash !== 'string') {
    // The old bridge appended a generated footer. Only replace a known copy.
    if (incoming === note.content || noteHash(remote) === baseline) return 'update';
    return 'conflict';
  }
  if (hash(incoming) === baseline.bodyHash) return 'update';
  if (hash(local) === baseline.bodyHash) return 'pull';
  return 'conflict';
}

export async function writeProjectFile(file, incoming) {
  const assertUnchanged = async () => {
    if (await realpath(file.source) !== file.canonical || await readFile(file.canonical, 'utf8') !== file.original) {
      throw new Error('Local file changed during sync. Retry to compare both versions.');
    }
  };
  const body = normalizeProjectMarkdown(incoming);
  if (containsSecret(body)) throw new Error('The Context note appears to contain credentials.');
  const newline = file.original.includes('\r\n') ? '\r\n' : '\n';
  const next = (file.original.startsWith('\uFEFF') ? '\uFEFF' : '') + body.replace(/\n/g, newline);
  if (Buffer.byteLength(next) > file.maxBytes) throw new Error('The Context note exceeds the local file size limit.');
  await assertUnchanged();
  const temporary = `${file.canonical}.${randomUUID()}.local`;
  const { mode } = await stat(file.canonical);
  try {
    await writeFile(temporary, next, { encoding: 'utf8', flag: 'wx', mode });
    await assertUnchanged();
    await rename(temporary, file.canonical);
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
