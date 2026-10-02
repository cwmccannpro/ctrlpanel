import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const fail = (message, status=400) => Object.assign(new Error(message), { status });
export function validateContext(body) {
  if (!body || typeof body !== 'object') throw fail('A JSON note is required.');
  for (const field of ['external_key','title','folder','content']) if (typeof body[field] !== 'string') throw fail(`${field} must be text.`);
  const value={external_key:body.external_key.trim(),title:body.title.trim(),folder:body.folder.replace(/\\/g,'/').split('/').map(x=>x.trim()).filter(Boolean).join('/'),content:body.content,expected_updated_at:body.expected_updated_at || null};
  if (!value.external_key || value.external_key.length>200 || !value.title || value.title.length>300) throw fail('A stable external_key and title are required (200 / 300 character limits).');
  if(value.folder.length>500 || value.folder.split('/').some(x=>x==='.'||x==='..') || /[\x00-\x1f]/.test(value.folder)) throw fail('Invalid folder path.');
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
    return {notes:data.slice(0,100),next_cursor:data.length>100?data[99].id:null};
  }
  if(method!=='POST')throw fail('Method not allowed.',405);
  const note=validateContext(body);
  const {data,error:writeError}=await client.rpc('save_context_note',{p_user:key.user_id,p_key:note.external_key,p_title:note.title,p_folder:note.folder,p_content:note.content,p_expected:note.expected_updated_at});
  if(writeError)throw fail(writeError.code==='40001'?writeError.message:'Could not save context.',writeError.code==='40001'?409:500);
  return {ok:true,note:data};
}
