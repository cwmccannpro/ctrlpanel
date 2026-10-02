import { Router } from 'express';
import { contextRequest } from '../knowledge.js';
const router=Router();
router.all('/notes',async(req,res)=>{
  try {
    const headers=new Headers();headers.set('authorization',req.get('authorization')||'');
    res.json(await contextRequest(req.method,new URL(req.originalUrl,'http://localhost'),headers,req.body));
  } catch(e) { res.status(e.status||500).json({error:e.message||'Context sync failed.'}); }
});
export default router;
