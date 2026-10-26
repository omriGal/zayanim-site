import {createHash, timingSafeEqual, randomUUID} from 'node:crypto';
const categories=['breakfast','bbq','alcohol','general'];
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const keys=(x,allowed)=>plain(x)&&Object.keys(x).every(k=>allowed.includes(k));
const text=(x,max)=>typeof x==='string'&&x.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(x);
export function validState(x){
 if(!keys(x,['adults','children','data'])||!Number.isInteger(x.adults)||!Number.isInteger(x.children)||x.adults<0||x.children<0||x.adults>100||x.children>100||!keys(x.data,categories)||categories.some(k=>!x.data[k]))return false;
 let n=0;const ids=new Set();
 for(const k of categories){const s=x.data[k];if(!keys(s,['title','hint','items'])||!text(s.title,200)||!text(s.hint,2000)||!Array.isArray(s.items))return false;
  for(const it of s.items){if(++n>500||!keys(it,['id','name','qty','note','baseQty','scale','done','who'])||!text(it.id,100)||!it.id||ids.has(it.id)||!text(it.name,300)||!it.name.trim()||!text(it.qty,100)||!text(it.baseQty,100)||!text(it.note,2000)||!text(it.who,200)||typeof it.scale!=='boolean'||typeof it.done!=='boolean')return false;ids.add(it.id);}
 }return true;
}
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export function makeHandler({storeFor,env=process.env,uuid=randomUUID}){return async req=>{
 try{
 const url=new URL(req.url);if(env.SYNC_ENABLED!=='true')return reply(503,{error:'Shared storage not enabled'});
 if(!['GET','POST'].includes(req.method))return reply(405,{error:'Method not allowed'});
 if([...url.searchParams.keys()].some(k=>k!=='test')|| (url.searchParams.has('test')&&url.searchParams.get('test')!=='1'))return reply(400,{error:'Invalid parameters'});
 const test=url.searchParams.get('test')==='1';
 if(req.method==='POST'||test){const secret=req.headers.get('X-Edit-Code')||'';const expected=env.EDIT_CODE_SHA256||'';if(!/^[a-f0-9]{64}$/.test(expected))return reply(503,{error:'Edit verifier not configured'});const actual=createHash('sha256').update(secret).digest();if(secret.length<20||secret.length>200||!timingSafeEqual(actual,Buffer.from(expected,'hex')))return reply(401,{error:'Invalid edit code'});}
 // Only same-origin browser mutations. Origin is present on ordinary fetch POSTs.
 if(req.method==='POST'&&req.headers.get('origin')!==url.origin)return reply(403,{error:'Origin not allowed'});
 const store=storeFor(test);const current=await store.getWithMetadata('current',{type:'json',consistency:'strong'});
 if(req.method==='GET')return reply(200,{state:current?.data.state??null,revision:current?.data.revision??null});
 if(!req.headers.get('content-type')?.startsWith('application/json'))return reply(415,{error:'JSON required'});
 if(Number(req.headers.get('content-length')||0)>200000)return reply(413,{error:'Payload too large'});
 // Bound chunked bodies too, rather than trusting Content-Length.
 const reader=req.body?.getReader();let chunks=[],size=0;if(!reader)return reply(400,{error:'Missing body'});
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>200000){await reader.cancel();return reply(413,{error:'Payload too large'});}chunks.push(value);}
 let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return reply(400,{error:'Invalid JSON'});}
 if(!keys(data,['state','revision'])||!validState(data.state)||!(data.revision===null||text(data.revision,100)))return reply(400,{error:'Invalid list'});
 if((current?.data.revision??null)!==data.revision)return reply(409,{error:'List changed. Reload or export your draft before retrying.'});
 const revision=uuid();const next={state:data.state,revision,updatedAt:new Date().toISOString()};
 // Save prior version before a mutation. No backend delete endpoint.
 if(current)await store.setJSON('history/'+current.data.revision,current.data,{onlyIfNew:true});
 const write=await store.setJSON('current',next,current?{onlyIfMatch:current.etag}:{onlyIfNew:true});
 if(!write.modified)return reply(409,{error:'List changed. Your draft has not been overwritten.'});
 return reply(200,{revision});
 }catch{return reply(503,{error:'Storage unavailable. Your local draft is preserved.'});}
};}
