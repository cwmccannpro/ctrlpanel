import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureVaultIdentity,
  noteHash,
  parseVaultFile,
  remoteRelativePath,
  resolveProject,
  serializeVaultFile,
  vaultDecision,
} from '../tools/vaultSyncCore.mjs';

const project={id:'11111111-1111-4111-8111-111111111111',name:'Project Alpha'};
const remote={external_key:'vault/key',title:'Decision log',folder:'Projects/Project Alpha',content:'# Remote',project_id:project.id,updated_at:'2026-10-06T12:00:00Z'};

test('frontmatter metadata round-trips while unrelated Obsidian properties survive',()=>{
  const source='---\ntags: [work]\ncssclasses: wide\nctrlpanel_key: "vault/key"\n---\n# Body\n';
  const parsed=parseVaultFile(source,'Projects/Project Alpha/Decision log.md');
  assert.equal(parsed.external_key,'vault/key');
  const output=serializeVaultFile({...parsed,project_id:project.id,project_name:project.name,remote_updated_at:remote.updated_at},parsed);
  assert.match(output,/tags: \[work\]/);assert.match(output,/cssclasses: wide/);assert.match(output,/ctrlpanel_project_id: "11111111/);
  assert.equal(parseVaultFile(output,parsed.relativePath).content,'# Body\n');
});

test('project folders and frontmatter resolve to owned CTRLpanel projects',()=>{
  const byFolder=parseVaultFile('# Note','Projects/Project Alpha/Note.md');
  assert.equal(resolveProject(byFolder,[project]).id,project.id);
  const explicit={...byFolder,relativePath:'Inbox/Note.md',project_name:'project alpha'};
  assert.equal(resolveProject(explicit,[project]).id,project.id);
});

test('new files get stable vault identities and remote paths stay inside the vault',()=>{
  const note=ensureVaultIdentity(parseVaultFile('Text','Inbox/Idea.md'));
  assert.match(note.external_key,/^vault\/[0-9a-f-]{36}$/);
  assert.equal(remoteRelativePath(remote,[project]),'Projects/Project Alpha/Decision log.md');
  assert.equal(remoteRelativePath({...remote,folder:'../Secrets',title:'Bad/name'},[]),'Secrets/Bad-name.md');
});

test('two-way decisions push, pull and conflict without blind overwrites',()=>{
  const local={...parseVaultFile('# Local','Projects/Project Alpha/Decision log.md'),external_key:'vault/key',project_id:project.id};
  assert.equal(vaultDecision(local,null,null),'create');
  assert.equal(vaultDecision(local,remote,null),'conflict');
  assert.equal(vaultDecision(local,remote,{local_hash:'different',remote_updated_at:remote.updated_at}),'push');
  const baseline={...local,content:'# Baseline'};
  const sameLocal={...baseline,remote_updated_at:'2026-10-05T12:00:00Z'};
  const changedRemote={...remote,content:'# Changed remote'};
  const previous={local_hash:noteHash(baseline),remote_updated_at:'2026-10-05T12:00:00Z'};
  assert.equal(vaultDecision(sameLocal,changedRemote,previous),'pull');
  assert.equal(vaultDecision(local,changedRemote,previous),'conflict');
});
