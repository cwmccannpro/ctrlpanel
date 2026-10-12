import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const fail = (message, status=400) => Object.assign(new Error(message), { status });
export function validateContext(body) {
  if (!body || typeof body !== 'object') throw fail('A JSON note is required.');
  for (const field of ['external_key','title','folder','content']) if (typeof body[field] !== 'string') throw fail(`${field} must be text.`);
  const hasProject=Object.prototype.hasOwnProperty.call(body,'project_id');
  const projectId=hasProject ? (body.project_id || null) : undefined;
  const noteId=body.note_id || null;
  const value={external_key:body.external_key.trim(),title:body.title.trim(),folder:body.folder.replace(/\\/g,'/').split('/').map(x=>x.trim()).filter(Boolean).join('/'),content:body.content,expected_updated_at:body.expected_updated_at || null,project_id:projectId,set_project:hasProject,note_id:noteId};
  if (!value.external_key || value.external_key.length>200 || !value.title || value.title.length>300) throw fail('A stable external_key and title are required (200 / 300 character limits).');
  if(value.folder.length>500 || value.folder.split('/').some(x=>x==='.'||x==='..') || /[\x00-\x1f]/.test(value.folder)) throw fail('Invalid folder path.');
  if(projectId!==undefined && projectId!==null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)) throw fail('project_id must be a UUID or null.');
  if(noteId!==null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(noteId)) throw fail('note_id must be a UUID.');
  if(new TextEncoder().encode(value.content).length>750000) throw fail('A note can contain up to 750 KB of Markdown.',413);
  if(value.expected_updated_at && !Number.isFinite(Date.parse(value.expected_updated_at))) throw fail('Invalid expected_updated_at.');
  return value;
}
function admin() {
  const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw fail('Context sync is not configured on the server.',503);
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
export async function contextRequest(method, url, headers, body, client=admin()) {
  const raw=(headers.get('authorization')||'').replace(/^Bearer /,'');
  if(!/^ctpk_[a-f0-9]{48}$/.test(raw))throw fail('Invalid context key.',401);
  const hash=createHash('sha256').update(raw).digest('hex');
  const {data:key,error}=await client.from('knowledge_api_keys').select('user_id').eq('key_hash',hash).maybeSingle();
  if(error)throw fail('Context sync database is unavailable. Apply the schema and check server credentials.',503);
  if(!key)throw fail('Invalid or revoked context key.',401);
  if(method==='GET') {
    let query=client.from('knowledge_notes').select('*').eq('user_id',key.user_id).order('id');
    if(url.searchParams.has('folder'))query=query.eq('folder',url.searchParams.get('folder'));
    if(url.searchParams.has('external_key'))query=query.eq('external_key',url.searchParams.get('external_key'));
    if(url.searchParams.has('after'))query=query.gt('id',url.searchParams.get('after'));
    const {data,error}=await query.limit(101);
    if(error)throw fail('Could not read context.',500);
    let projects;
    if(url.searchParams.get('include_projects')==='1') {
      const result=await client.from('projects').select('id,name,status').eq('user_id',key.user_id).order('name').limit(500);
      if(result.error)throw fail('Could not read projects.',500);
      projects=result.data || [];
    }
    return {notes:data.slice(0,100),next_cursor:data.length>100?data[99].id:null,...(projects?{projects}:{})};
  }
  if(method!=='POST')throw fail('Method not allowed.',405);
  const note=validateContext(body);
  let expected=note.expected_updated_at;
  if(note.note_id) {
    const claimed=await client.rpc('claim_context_note',{p_user:key.user_id,p_note:note.note_id,p_key:note.external_key,p_expected:expected});
    if(claimed.error) {
      if(claimed.error.code==='40001'||claimed.error.code==='23505')throw fail('This note changed or is already linked; read the latest note before claiming it.',409);
      if(claimed.error.code==='42501')throw fail('Note is unavailable.',403);
      if(claimed.error.code==='PGRST202'||/claim_context_note/i.test(claimed.error.message||''))throw fail('Vault sync needs the latest Knowledge migration.',503);
      throw fail('Could not link the note to the vault.',500);
    }
    expected=claimed.data?.updated_at || expected;
  }
  const args={p_user:key.user_id,p_key:note.external_key,p_title:note.title,p_folder:note.folder,p_content:note.content,p_project:note.project_id ?? null,p_set_project:note.set_project,p_expected:expected};
  let {data,error:writeError}=await client.rpc('save_context_note_v2',args);
  // Keep non-project context clients working during the additive migration's
  // deployment window. Project-aware writes require the v2 RPC so ownership
  // can be checked atomically by Postgres.
  if(writeError && !note.set_project && (writeError.code==='PGRST202'||/save_context_note_v2/i.test(writeError.message||''))) {
    ({data,error:writeError}=await client.rpc('save_context_note',{p_user:key.user_id,p_key:note.external_key,p_title:note.title,p_folder:note.folder,p_content:note.content,p_expected:note.expected_updated_at}));
  }
  if(writeError) {
    if(writeError.code==='40001')throw fail(writeError.message,409);
    if(writeError.code==='42501')throw fail(writeError.message,403);
    if(note.set_project && (writeError.code==='PGRST202'||/save_context_note_v2/i.test(writeError.message||'')))throw fail('Project-aware context sync needs the latest Knowledge migration.',503);
    throw fail('Could not save context.',500);
  }
  return {ok:true,note:data};
}
