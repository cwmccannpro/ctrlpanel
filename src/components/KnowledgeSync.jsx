import { useEffect, useState } from 'react';
import Modal from './shared/Modal.jsx';
import { queryTable, insert, remove } from '../lib/supabase.js';
import { CONTEXT_PROMPT } from '../lib/contextPrompt.js';

export default function KnowledgeSync({ onClose, onSaved }) {
  const [keys,setKeys]=useState([]),[name,setName]=useState('Claude Desktop'),[raw,setRaw]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const refresh=async()=>{const r=await queryTable('knowledge_api_keys',{order:'created_at',limit:100});if(r.error)throw new Error(r.error.message);setKeys(r.data);};
  useEffect(()=>{refresh().catch(e=>setError(e.message));},[]);
  const create=async()=>{
    setBusy(true);setError('');
    try {
      const bytes=crypto.getRandomValues(new Uint8Array(24));
      const hex=arr=>Array.from(arr,b=>b.toString(16).padStart(2,'0')).join('');
      const key=`ctpk_${hex(bytes)}`;
      const hash=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key))));
      const r=await insert('knowledge_api_keys',[{name:name.trim()||'Context client',key_prefix:key.slice(0,12),key_hash:hash}]);
      if(r.error)throw new Error(r.error.message);setRaw(key);await refresh();
    }catch(e){setError(e.message);}finally{setBusy(false);}
  };
  const initialize=async()=>{
    setBusy(true);setError('');
    try {
      const existing=await queryTable('knowledge_notes',{filters:{external_key:'ctrlpanel/save-context-prompt'}});
      if(existing.error)throw new Error(existing.error.message);
      if(!existing.data.length){const r=await insert('knowledge_notes',[{external_key:'ctrlpanel/save-context-prompt',folder:'Prompts',title:'Save context to CTRLpanel',content:CONTEXT_PROMPT,tags:['prompts'],pinned:true}]);if(r.error)throw new Error(r.error.message);}
      onSaved();onClose();
    }catch(e){setError(e.message);}finally{setBusy(false);}
  };
  return <Modal title="Context sync" onClose={onClose} wide>
    <p className="body-text">Connect a chat tool on each device. Its key can read and update your Knowledge Base; revoke it here at any time.</p>
    <div className="field" style={{marginTop:18}}><label className="field-label">API endpoint</label><code>{window.location.origin}/api/knowledge/notes</code><p className="body-text">Use your deployed HTTPS address on both computers. Localhost only reaches this computer.</p></div>
    <div className="row"><input className="input" aria-label="Client name" value={name} onChange={e=>setName(e.target.value)}/><button className="btn" disabled={busy} onClick={create}>Create key</button></div>
    {raw&&<div className="field" style={{marginTop:12}}><label className="field-label">Copy this key now; it is shown only here</label><input className="input" readOnly value={raw} aria-label="New context API key" onFocus={e=>e.target.select()}/></div>}
    {keys.map(k=><div className="list-row" key={k.id}><span className="list-row-title">{k.name}</span><code>{k.key_prefix}…</code><button className="btn btn--ghost" disabled={busy} onClick={async()=>{if(!confirm(`Revoke ${k.name}?`))return;try{const r=await remove('knowledge_api_keys',k.id);if(r.error)throw new Error(r.error.message);await refresh();}catch(e){setError(e.message);}}}>Revoke</button></div>)}
    <div className="field" style={{marginTop:24}}><button className="btn btn--accent" disabled={busy} onClick={initialize}>Initialize Prompts folder</button><p className="body-text" style={{marginTop:8}}>Adds the reusable saving instructions once. Existing prompt edits are preserved.</p></div>
    {error&&<p role="alert" className="auth-error">{error}</p>}
  </Modal>;
}
