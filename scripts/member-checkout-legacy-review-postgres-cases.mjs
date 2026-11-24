// Invoked only by the ownership-checked TEMP PostgreSQL harness. Synthetic
// creators seed originals; every reviewed read is asserted write-free. No live
// DB, installed migrations, role grants, application flags or data adoption.
import assert from 'node:assert/strict';
import http from '../src/lib/merchantCheckoutLegacyReview.server.ts';
import handoffHttp from '../src/lib/merchantCheckoutLegacyHandoff.server.ts';
import drafts from '../src/lib/merchantCheckoutAccountDraft.ts';import handoffs from '../src/lib/merchantCheckoutLegacyHandoff.ts';
import checkoutClient from '../src/lib/merchantCheckoutClient.ts';
export async function legacyReviewCases(t,{admin,a,b,seed,submit,state,site,one,ordinary,rows,records}){
 const origin='https://legacy-review-pg.synthetic.invalid',sql='select public.faolla_member_checkout_legacy_review_v1($1,$2,$3,$4,$5) result';
 const identity={accountId:'58889999',userId:'legacy-review-isolated-user'},sandbox='10909990',block='products',requestId='legacy-review-request';
 const query={siteId:sandbox,blockId:block,requestId},base={id:'O-review-isolated',siteId:sandbox,blockId:block,clientRequestId:requestId,customerAccountId:identity.accountId,customerUserId:identity.userId,
  status:'pending',createdAt:'2026-11-24T12:00:00+02:00',updatedAt:'2026-11-24T12:00:00.123456+02:00',customer:{name:'PRIVATE',email:'private@example.invalid'},items:[{name:'PRIVATE',quantity:99}],totalAmount:999};
 const args=(q=query,p=identity)=>[q.siteId,q.blockId,q.requestId,`account:${p.accountId}:${p.userId}`,new Date(Date.now()+11000).toISOString()];
 const invoke=async(q=query,p=identity,client=a,handoff=false)=>{
  const session={...p,servicePaused:false,user:{email_confirmed_at:new Date().toISOString()}};
  return (handoff?handoffHttp.handleCheckoutLegacyHandoffReview:http.handleCheckoutLegacyReview)(new Request(origin+(handoff?'/api/member-checkout/legacy/handoff-review':'/api/member-checkout/legacy/review'),{method:'POST',headers:{origin,'content-type':'application/json','x-checkout-account-scope':p.accountId},body:JSON.stringify(q)}),{
   enabled:()=>true,session:async()=>session,call:async(name,v)=>{assert.equal(name,'faolla_member_checkout_legacy_review_v1');assert.deepEqual(Object.keys(v).sort(),['p_block_id','p_not_after','p_principal_key','p_request_id','p_site_id']);
    try{return{data:(await one(client,sql,[v.p_site_id,v.p_block_id,v.p_request_id,v.p_principal_key,v.p_not_after])).result,error:null};}catch(error){return{data:null,error:{message:error.message}};}
   }});
 };
 const save=async(blocks,slug=`__merchant_orders__:${sandbox}`)=>{await admin.query('delete from public.pages where merchant_id=$1',[sandbox]);await admin.query('insert into public.pages(merchant_id,slug,blocks) values($1,$2,$3)',[sandbox,slug,JSON.stringify(blocks)]);};
 const empty=q=>({ok:true,readOnly:true,review:{version:1,...q,order:null}});
 await t.test('legacy read: actual ordinary creator exact dual ownership is readable, wrong/partial identity and block are indistinguishable from absence',async()=>{
  const f=await seed(),x=await ordinary(f),order=await x.create(),q={siteId:site,blockId:x.input.blockId,requestId:x.input.clientRequestId},before=await state();
  const response=await invoke(q,f.principal);assert.equal(response.status,200);const value=await response.json();assert.deepEqual(Object.keys(value.review.order).sort(),['createdAt','id','status','updatedAt']);assert.equal(value.review.order.id,order.id);
  for(const p of [{...f.principal,accountId:'58889998'},{...f.principal,userId:'other-isolated-user'}])assert.deepEqual(await(await invoke(q,p)).json(),empty(q));
  for(const patch of [{blockId:'different'},{requestId:'not-present'},{siteId:'10909992'}]){const other={...q,...patch};assert.deepEqual(await(await invoke(other,f.principal)).json(),empty(other));}
  assert.deepEqual(await state(),before);
 });
 await t.test('explicit handoff recheck uses the actual private SQL and verified session but creates no database acknowledgement or financial side effect',async()=>{
  const f=await seed(),x=await ordinary(f),order=await x.create(),q={siteId:site,blockId:x.input.blockId,requestId:x.input.clientRequestId},before=await state();
  const response=await invoke(q,f.principal,a,true);assert.equal(response.status,200);const value=await response.json();assert.equal(value.readOnly,true);assert.equal(value.review.order.id,order.id);
  assert.deepEqual(Object.keys(value.review.order).sort(),['createdAt','id','status','updatedAt']);assert.deepEqual(await(await invoke(q,{...f.principal,userId:'different-handoff-user'},a,true)).json(),empty(q));assert.deepEqual(await state(),before);
 });
 await t.test('actual ordinary and financial originals coexist: explicit local isolation rechecks SQL while preserving both originals, exact nonce, carts and every database table',async()=>{
  for(const method of ['points','on_site']){const f=await seed(method),x=await ordinary(f),order=await x.create(),result=(await submit(f)).result,q={siteId:site,blockId:x.input.blockId,requestId:x.input.clientRequestId};
   const response=await invoke(q,f.principal);assert.equal(response.status,200);const review=(await response.json()).review;assert.equal(review.order.id,order.id);
   const scope={siteId:site,blockId:q.blockId,accountId:f.principal.accountId},ownedKey=drafts.accountCartStorageKey(scope),nonceKey=checkoutClient.checkoutClientStorageKey(site,f.principal.accountId),legacyKey=`merchant-space:product-cart:v1:${site}:${q.blockId}`;
   const data={items:[],customer:{name:'Owned contact',email:'owned@example.invalid',phone:'123',note:'Keep note'},clientRequestId:''},values=new Map([[ownedKey,JSON.stringify({version:1,scope,revision:3,data})],[nonceKey,JSON.stringify({version:1,nonce:f.request.nonce})],[legacyKey,JSON.stringify({clientRequestId:q.requestId,customer:{name:'PRIVATE unowned'},items:[]})]]),initial=new Map(values),writes=[],before=await state();let reads=0;
   const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>{writes.push(k);values.set(k,v);}},handoff=handoffs.createLegacyCartHandoff(scope,{storage,request:async(path,body,signal)=>{
    assert.equal(path,'/api/member-checkout/legacy/handoff-review');assert.deepEqual(body,q);assert.ok(signal instanceof AbortSignal);reads++;const reply=await invoke(body,f.principal,a,true);assert.equal(reply.status,200);return reply.json();
   }}),c=drafts.createAccountCartDraft(scope,{storage,exclusive:async(key,run)=>{assert.equal(key,nonceKey);await run();return true;},legacyHandoff:handoff,retainFinancialNonceOnHandoff:true});
   try{await c.activate();assert.equal(c.getSnapshot().legacyPending,true);await c.confirmLegacyHandoff(review,true);assert.equal(c.getSnapshot().legacyPending,false);assert.equal(reads,1);assert.deepEqual(writes,[handoff.storageKey]);
    for(const[k,v]of initial)assert.equal(values.get(k),v);assert.deepEqual(c.getSnapshot().data,data);assert.deepEqual(await state(),before);
    const pending=(await one(a,'select public.faolla_member_checkout_pending_intent_v1($1,$2) result',[site,`account:${f.principal.accountId}:${f.principal.userId}`])).result.pending;
    assert.equal(pending.operationKey,result.operationKey);assert.deepEqual(await state(),before);assert.equal(values.get(nonceKey),initial.get(nonceKey));
   }finally{c.deactivate();}
  }
 });
 await t.test('legacy read: canonical chunks override roots; strict raw identities, duplicate requests/IDs and financial marker cannot invent ownership',async()=>{
  await save([base]);let before=await state();const found=await(await invoke()).json();assert.deepEqual(found.review.order,{id:base.id,status:'pending',createdAt:'2026-11-24T10:00:00.000Z',updatedAt:'2026-11-24T10:00:00.123Z'});assert.ok(!JSON.stringify(found).includes('PRIVATE'));assert.deepEqual(await state(),before);
  for(const status of ['pending','confirmed','completed','cancelled']){await save([{...base,status}]);before=await state();assert.equal((await(await invoke()).json()).review.order.status,status);assert.deepEqual(await state(),before);}
  for(const patch of [{customerAccountId:''},{customerUserId:''},{customerAccountId:Number(identity.accountId)},{customerAccountId:' '+identity.accountId},{customerUserId:'other-isolated-user'},{customerAccountId:'58889998',customerLoginEmail:'private@example.invalid'},{checkoutOperationKey:null},{checkoutOperationKey:'f'.repeat(64)},{blockId:'other'},{siteId:'10909992'}]){
   await save([{...base,...patch}]);before=await state();assert.deepEqual(await(await invoke()).json(),empty(query));assert.deepEqual(await state(),before);
  }
  for(const duplicate of [{...base,id:'O-duplicate'},{...base,clientRequestId:'different-request'}]){await save([base,duplicate]);before=await state();assert.deepEqual(await(await invoke()).json(),empty(query));assert.deepEqual(await state(),before);}
  await save([base]);await admin.query('insert into public.pages(merchant_id,slug,blocks) values($1,$2,$3)',[sandbox,`__merchant_orders__:${sandbox}:chunk:0`,'[]']);before=await state();assert.deepEqual(await(await invoke()).json(),empty(query));assert.deepEqual(await state(),before);
 });
 await t.test('legacy read: real ledger linkage still excludes financial records when an isolated raw marker is missing',async()=>{
  const f=await seed(),result=(await submit(f)).result,raw=records(await rows()).find(r=>r.id===result.resourceId);assert.ok(raw);
  await admin.query('begin');try{
   await admin.query("update public.pages set blocks=(select jsonb_agg(case when r->>'id'=$2 then jsonb_set(r-'checkoutOperationKey','{clientRequestId}',to_jsonb($3::text)) else r end) from jsonb_array_elements(blocks) r) where merchant_id=$1 and slug like $4",[site,result.resourceId,requestId,`__merchant_orders__:${site}%`]);
   const q={siteId:site,blockId:raw.blockId,requestId},before=await state();assert.deepEqual(await(await invoke(q,f.principal,admin)).json(),empty(q));assert.deepEqual(await state(),before);
  }finally{await admin.query('rollback');}
 });
 await t.test('legacy read: malformed own facts and store bounds fail unavailable, never normalized into a different order',async()=>{
  for(const value of [[{...base,id:''}],[{...base,status:'paid'}],[{...base,createdAt:'invalid'}],[{...base,createdAt:'2026-02-30T00:00:00Z'}],[{...base,updatedAt:'2026-11-23T00:00:00Z'}],{},Array(10001).fill({}),[{...base,note:'x'.repeat(8388608)}]]){
   await save(value);const before=await state(),response=await invoke();assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'checkout_legacy_review_unavailable'});assert.deepEqual(await state(),before);
  }
  await save([base]);await admin.query("insert into public.pages(merchant_id,slug,blocks) select $1,'__merchant_orders__:'||$1||':chunk:'||n,'[]'::jsonb from generate_series(0,999) n",[sandbox]);const before=await state();assert.equal((await invoke()).status,503);assert.deepEqual(await state(),before);await save([base]);
 });
 await t.test('legacy read: both writer locks, stale deadlines, retained snapshots and all API roles fail closed without writes or grants',async()=>{
  await save([base]);const before=await state();
  for(const prefix of ['faolla-customer-checkout:','faolla-order-membership:']){await b.query('begin');try{await b.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[prefix+sandbox]);assert.equal((await invoke()).status,503);}finally{await b.query('rollback');}}
  for(const deadline of [new Date(Date.now()-1).toISOString(),new Date(Date.now()+30000).toISOString(),'infinity']){const p=args();p[4]=deadline;await assert.rejects(one(a,sql,p),/checkout_legacy_review_expired/);}
  await a.query('begin isolation level repeatable read');try{await assert.rejects(one(a,sql,args()),/checkout_legacy_review_unavailable/);}finally{await a.query('rollback');}
  for(const role of ['anon','authenticated','service_role']){assert.equal((await one(admin,"select has_function_privilege($1,'public.faolla_member_checkout_legacy_review_v1(text,text,text,text,text)','EXECUTE') allowed",[role])).allowed,false);await a.query(`set role ${role}`);try{await assert.rejects(one(a,sql,args()),/permission denied/);}finally{await a.query('reset role');}}
  assert.deepEqual(await state(),before);
 });
}
