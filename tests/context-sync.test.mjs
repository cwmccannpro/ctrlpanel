import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { contextRequest, validateContext } from '../backend/knowledge.js';

const raw='ctpk_'+'a'.repeat(48), headers=new Headers({authorization:`Bearer ${raw}`});
const note={external_key:'research/decisions',folder:'Research',title:'Decisions',content:'# Context'};
function fakeClient({owner='user-a',writeError=null}={}) {
  const calls=[];
  return {calls,from(table){const query={select(){return query;},eq(k,v){calls.push([table,k,v]);return query;},order(){return query;},gt(){return query;},limit(){return Promise.resolve({data:[],error:null});},maybeSingle(){return Promise.resolve({data:owner?{user_id:owner}:null,error:null});}};return query;},async rpc(name,args){calls.push([name,args]);return {data:{id:'note-a',...args},error:writeError};}};
}
test('normalizes folder separators and rejects traversal and invalid bodies',()=>{
  assert.equal(validateContext({...note,folder:'Research\\ Ideas / Drafts'}).folder,'Research/Ideas/Drafts');
  for(const body of [{...note,folder:'../Secrets'},{...note,content:7},{...note,external_key:''},{...note,expected_updated_at:'yesterday'}])assert.throws(()=>validateContext(body));
});
test('save ownership comes from key, never from a supplied user_id',async()=>{
  const client=fakeClient();await contextRequest('POST',new URL('https://example.com/api/knowledge/notes'),headers,{...note,user_id:'victim'},client);
  assert.equal(client.calls.at(-1)[1].p_user,'user-a');
  assert.ok(client.calls[0][2]!==raw);assert.equal(client.calls[0][2].length,64);
});
test('revoked keys cannot read notes',async()=>{
  const client=fakeClient({owner:null});
  await assert.rejects(contextRequest('GET',new URL('https://example.com/api/knowledge/notes'),headers,null,client),e=>e.status===401);
  assert.equal(client.calls.length,1);
});
test('reads always constrain ownership and folder',async()=>{
  const client=fakeClient();await contextRequest('GET',new URL('https://example.com/api/knowledge/notes?folder=Prompts'),headers,null,client);
  assert.ok(client.calls.some(c=>c[0]==='knowledge_notes'&&c[1]==='user_id'&&c[2]==='user-a'));
  assert.ok(client.calls.some(c=>c[1]==='folder'&&c[2]==='Prompts'));
});
test('stale versions become an actionable conflict without retrying overwrite',async()=>{
  const client=fakeClient({writeError:{code:'40001',message:'Read and merge first'}});
  await assert.rejects(contextRequest('POST',new URL('https://example.com'),headers,note,client),e=>e.status===409);
  assert.equal(client.calls.filter(c=>c[0]==='save_context_note').length,1);
});
test('MCP bridge handshakes, lists tools and reports missing setup as tool error',async()=>{
  const child=spawn(process.execPath,['tools/ctrlpanel-mcp.mjs'],{env:{...process.env,CTRLPANEL_URL:'',CTRLPANEL_CONTEXT_KEY:''}});
  let output='';child.stdout.on('data',chunk=>output+=chunk);
  child.stdin.end([{jsonrpc:'2.0',id:1,method:'initialize'}, {jsonrpc:'2.0',method:'notifications/initialized'}, {jsonrpc:'2.0',id:2,method:'tools/list'}, {jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'read_context',arguments:{}}}].map(JSON.stringify).join('\n')+'\n');
  await new Promise((resolve,reject)=>{child.on('exit',code=>code===0?resolve():reject(new Error(`exit ${code}`)));child.on('error',reject);});
  const responses=output.trim().split('\n').map(JSON.parse);
  assert.equal(responses.length,3);assert.equal(responses[0].result.serverInfo.name,'ctrlpanel-context');
  assert.deepEqual(responses[1].result.tools.map(t=>t.name),['read_context','save_context','initialize_prompts']);
  assert.equal(responses[2].result.isError,true);
});
