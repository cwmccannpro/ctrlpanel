import { supabase } from './supabase.js';
import { normalizeNote } from './noteShape.js';

export function wikiLinks(content = '') {
  // Code examples are not graph edges.
  return [...content.replace(/```[\s\S]*?```|`[^`]*`/g, '').matchAll(/\[\[([^\]]+)\]\]/g)]
    .map((m) => m[1].split('|')[0].split('#')[0].trim()).filter(Boolean);
}
export function resolveNote(notes, target) {
  const key = target.toLowerCase();
  return notes.find(n => n.id === target) || notes.find(n => `${n.folder ? `${n.folder}/` : ''}${n.title}`.toLowerCase() === key)
    || notes.find(n => n.title.toLowerCase() === key)
    || notes.find(n => (n.aliases || []).some(alias => alias.toLowerCase() === key));
}
export function graphEdges(notes) {
  return notes.flatMap(n => [...new Set(wikiLinks(n.content).map(t => resolveNote(notes, t)?.id).filter(id => id && id !== n.id))]
    .map(target => ({ source: n.id, target })));
}
export async function loadNotes() {
  if (!supabase) throw new Error('Connect Supabase to use Knowledge Base.');
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('knowledge_notes').select('*').order('id').range(offset, offset + 499);
    if (error) throw new Error(error.message);
    rows.push(...data.map(normalizeNote));
    if (data.length < 500) return rows;
  }
}
export async function saveNote(note, previous) {
  if (!supabase) throw new Error('Connect Supabase to save notes.');
  const payload = { title: note.title.trim(), content: note.content, folder: note.folder.trim(), tags: note.tags,
    external_key: note.external_key || previous?.external_key || null,
    project_id: note.project_id || null, pinned: !!note.pinned, updated_at: new Date().toISOString(),
    aliases: [...new Set([...(previous?.aliases || []), ...(previous && (previous.title !== note.title.trim() || previous.folder !== note.folder.trim())
      ? [previous.title, `${previous.folder ? `${previous.folder}/` : ''}${previous.title}`] : [])])] };
  if (!payload.title) throw new Error('Give this note a title before saving.');
  const query = previous
    ? supabase.from('knowledge_notes').update(payload).eq('id', previous.id).eq('updated_at', previous.updated_at)
    : supabase.from('knowledge_notes').insert(payload);
  const { data, error } = await query.select().single();
  if (error) throw new Error(previous && error.code === 'PGRST116' ? 'This note changed in another window. Copy your edits, then reload before saving.' : error.message);
  return normalizeNote(data);
}
export async function deleteNote(id) {
  const { error } = await supabase.from('knowledge_notes').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
export async function saveSessionContext(input) {
  if (!supabase) throw new Error('Supabase is not configured.');
  if (!input.external_key || typeof input.title !== 'string' || typeof input.folder !== 'string' || typeof input.content !== 'string') throw new Error('external_key, title, folder and content are required.');
  const {data:previous,error}=await supabase.from('knowledge_notes').select('*').eq('external_key',input.external_key).maybeSingle();
  if(error)throw new Error(error.message);
  if(previous && previous.content===input.content && previous.title===input.title && previous.folder===input.folder)return previous;
  if(previous && previous.updated_at!==input.expected_updated_at)throw new Error('Context changed. Read the note and merge before updating.');
  if(!previous && input.expected_updated_at)throw new Error('Note no longer exists. Read before saving.');
  return saveNote({...previous,...input,tags:previous?.tags||[]},previous);
}
export function subscribeKnowledge(userId, refresh) {
  if (!supabase || !userId) return () => {};
  const channel = supabase.channel(`knowledge-${crypto.randomUUID()}`)
    .on('postgres_changes', {event:'*',schema:'public',table:'knowledge_notes',filter:`user_id=eq.${userId}`},refresh).subscribe();
  return () => { supabase.removeChannel(channel); };
}
export function downloadMarkdown(note) {
  const url = URL.createObjectURL(new Blob([note.content], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `${note.title.replace(/[\\/:*?"<>|]/g, '-')}.md`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
