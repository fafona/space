// Registered only inside the existing identity-checked, owned TEMP cluster.
// Actual old single/venue/cart writers; no synthetic financial receipts,
// production identity, disabled constraints, role grants or live IO.
import assert from 'node:assert/strict';import {randomUUID}from'node:crypto';
import oldModule from '../../src/lib/merchantCheckoutSubmissionPlan.server.ts';
import cashModule from '../../src/lib/merchantCheckoutOnSiteSubmissionPlan.server.ts';
import intentModule from '../../src/lib/merchantCheckoutPendingIntent.server.ts';
import httpModule from '../../src/lib/merchantCheckoutIntentHttp.server.ts';
const old=oldModule,cash=cashModule;
export async function pendingIntentAcceptance(p){
 const {t,admin,a,b,site,one,seed,prepare,commit,cancel,all,temporary,connect,definitions,beforeDefinitions}=p;
 await admin.query(await p.sql());let principalIndex=0;
 const seedOwn=(method='points',change=()=>{})=>seed(method,f=>{const accountId=String(59000000+(++principalIndex)),userId=`intent-synthetic-${principalIndex}`;
  Object.assign(f.principal,{accountId,userId});Object.assign(f.member,{accountId,userId});for(const c of f.coupons)for(const claim of c.claimEvents)Object.assign(claim,{accountId,userId});
  f.snapshot.principalKey=`account:${accountId}:${userId}`;change(f);});
 const scope=f=>`account:${f.principal.accountId}:${f.principal.userId}`;
 const read=(f,c=admin)=>one(c,'select public.faolla_member_checkout_pending_intent_v1($1,$2) result',[site,scope(f)]).then(r=>r.result);
 const review=(f,op,c=admin)=>one(c,'select public.faolla_member_checkout_intent_review_v1($1,$2,$3) result',[site,op,scope(f)]).then(r=>r.result);
 const guarded=(p,c=a)=>one(c,'select public.faolla_member_checkout_intent_cart_commit_v1($1,$2,$3,$4,$5,$6,$7) result',[site,p.id.operationKey,p.id.principalKey,p.id.requestHash,p.snapshot,p.plan,p.notAfter]);
 const ack=(f,pending,c=a,overrides={})=>{const x={...pending,...overrides};return one(c,'select public.faolla_member_checkout_acknowledge_intent_v1($1,$2,$3,$4,$5,$6) result',
  [site,x.operationKey,scope(f),x.generation,x.reviewHash,x.deadline??new Date(Date.now()+11000).toISOString()]).then(r=>r.result);};
 const state=async()=>({...await all(),claims:(await admin.query('select * from faolla_checkout_design.intent_claims order by site_id,principal_key,generation')).rows,
  acknowledgements:(await admin.query('select * from faolla_checkout_design.intent_acknowledgements order by site_id,operation_key')).rows});
 const another=f=>({...f,request:{...structuredClone(f.request),nonce:randomUUID()}});
 const single=async(f,method)=>{const first=f.request.lines[0],request={siteId:site,...first,nonce:randomUUID(),confirmationHash:'0'.repeat(64),method,customer:f.request.customer};
  const m=method==='points'?old:cash,identity=()=>method==='points'?m.checkoutSubmissionIdentity(request,f.principal):m.onSiteSubmissionIdentity(request,f.principal);
  let id=identity();const name=method==='points'?'faolla_member_checkout_submission_snapshot_v2':'faolla_member_checkout_on_site_snapshot_v1';
  const snapshot=async()=>(await one(admin,`select public.${name}($1,$2,$3,$4,$5) result`,[site,id.operationKey,id.principalKey,id.requestHash,first.offerId])).result.snapshot;
  const initial=await snapshot(),quote=method==='points'?await m.quoteCheckoutSubmissionSnapshot(initial,id,f.principal):m.quoteOnSiteSubmissionSnapshot(initial,id,f.principal);
  request.confirmationHash=quote.confirmationHash;id=identity();const current=await snapshot(),planned=method==='points'?await m.planCheckoutSubmission(current,id,f.principal):m.planOnSiteSubmission(current,id,f.principal);
  const commitName=method==='points'?'faolla_member_checkout_submission_commit_v2':'faolla_member_checkout_on_site_commit_v1';
  const dispatch=()=>one(a,`select public.${commitName}($1,$2,$3,$4,$5,$6,$7) result`,[site,id.operationKey,id.principalKey,id.requestHash,current,planned.plan,planned.notAfter]);
  return {id,dispatch};};
 await t.test('intent enrollment defaults off and leaves the actual old financial commit successful without metadata',async()=>{
  const f=await seedOwn(),prepared=await prepare(f),beforeOff=await state();
  await assert.rejects(read(f),/checkout_intent_disabled/);await assert.rejects(guarded(prepared),/checkout_intent_disabled/);assert.deepEqual(await state(),beforeOff);
  await commit(prepared);assert.equal((await admin.query('select * from faolla_checkout_design.intent_claims')).rowCount,0);
  // An untracked cutover is review-required, never arbitrarily adopted/acked.
  await assert.rejects(read(f),/checkout_intent_review_required/);
  await admin.query('insert into faolla_checkout_design.intent_pilots(site_id,enabled) values($1,true)',[site]);
  const g=another(f),next=await prepare(g),before=await state();await assert.rejects(commit(next),/checkout_intent_review_required/);assert.deepEqual(await state(),before);
 });
 await t.test('another device without the nonce reads the exact original; a new nonce rolls back every second financial effect until explicit ack',async()=>{
  const f=await seedOwn(),first=await prepare(f);await commit(first);const before=await state(),pending=(await read(f,b)).pending;
  assert.equal(pending.operationKey,first.id.operationKey);assert.equal(pending.generation,1);assert.equal(pending.original.kind,'cart');assert.equal(pending.reviewRequired,false);
  assert.ok(!/nonce|principalKey|memberId|PRIVATE|couponClaims|example.invalid|customerAccountId/.test(JSON.stringify(pending)));
  const g=another(f),next=await prepare(g);await assert.rejects(commit(next,b),/checkout_original_pending/);assert.deepEqual(await state(),before);
  const released=await ack(f,pending);assert.equal(released.replayed,false);assert.equal((await read(f)).pending,null);
  const after=await state();assert.deepEqual(after.pages,before.pages);assert.deepEqual(after.operations,before.operations);assert.deepEqual(after.receipts,before.receipts);
  await commit(next,b);const current=(await read(f)).pending;assert.equal(current.generation,2);assert.equal(current.operationKey,next.id.operationKey);
  assert.equal((await ack(f,pending)).replayed,true);assert.equal((await read(f)).pending.operationKey,current.operationKey,'old ack replay never releases a newer original');
  await ack(f,current);assert.equal((await read(f)).pending,null);
 });
 await t.test('points single, venue single and whole cart share the same durable generation without replacing any old writer',async()=>{
  const f=await seedOwn(),points=await single(f,'points');await points.dispatch();let pending=(await read(f)).pending;
  assert.equal(pending.original.kind,'single');assert.equal(pending.original.original.method,'points');assert.equal(pending.generation,1);
  let prepared=await prepare(another(f)),before=await state();await assert.rejects(commit(prepared),/checkout_original_pending/);assert.deepEqual(await state(),before);await ack(f,pending);
  const venue=await single(f,'on_site');await venue.dispatch();pending=(await read(f)).pending;assert.equal(pending.generation,2);assert.equal(pending.original.original.method,'on_site');
  prepared=await prepare(another(f));before=await state();await assert.rejects(commit(prepared),/checkout_original_pending/);assert.deepEqual(await state(),before);await ack(f,pending);
  const cart=await prepare(another(f));await commit(cart);pending=(await read(f)).pending;assert.equal(pending.generation,3);assert.equal(pending.original.kind,'cart');
  before=await state();assert.equal((await points.dispatch()).result.replayed,true);assert.deepEqual(await state(),before);assert.equal((await read(f)).pending.generation,3);await ack(f,pending);
 });
 await t.test('in-flight original never looks absent and read/ack do not wait indefinitely behind its site lock',async()=>{
  const f=await seedOwn(),prepared=await prepare(f);await a.query('begin');
  try{await commit(prepared,a);await assert.rejects(read(f,b),/checkout_intent_busy/);await assert.rejects(ack(f,{operationKey:prepared.id.operationKey,generation:1,reviewHash:'a'.repeat(64)},b),/checkout_intent_busy/);}
  finally{await a.query('commit');}
  const pending=(await read(f)).pending;assert.equal(pending.operationKey,prepared.id.operationKey);await ack(f,pending);
 });
 await t.test('a retained transaction snapshot cannot report a newly committed original as absent or acknowledge stale state',async()=>{
  const f=await seedOwn(),prepared=await prepare(f);
  await b.query('begin isolation level repeatable read');
  try{await b.query('select count(*) from faolla_checkout_design.intent_claims');await commit(prepared,a);await assert.rejects(read(f,b),/checkout_intent_unavailable/);}
  finally{await b.query('rollback');}
  const pending=(await read(f)).pending;
  await b.query('begin isolation level serializable');
  try{await assert.rejects(ack(f,pending,b),/checkout_intent_unavailable/);}finally{await b.query('rollback');}
  assert.equal((await read(f)).pending.operationKey,pending.operationKey);await ack(f,pending);
 });
 await t.test('concurrent device acknowledgements append once and a later replay cannot release the next generation',async()=>{
  const f=await seedOwn(),prepared=await prepare(f);await commit(prepared);const pending=(await read(f)).pending;
  const responses=await Promise.allSettled([ack(f,pending,a),ack(f,pending,b)]);
  assert.ok(responses.some(r=>r.status==='fulfilled'));
  for(const response of responses)if(response.status==='rejected')assert.match(response.reason.message,/checkout_intent_busy/);
  assert.equal((await admin.query('select * from faolla_checkout_design.intent_acknowledgements where site_id=$1 and operation_key=$2',[site,pending.operationKey])).rowCount,1);
  const next=await prepare(another(f));await commit(next);assert.equal((await ack(f,pending)).replayed,true);
  const current=(await read(f)).pending;assert.equal(current.generation,2);assert.equal(current.operationKey,next.id.operationKey);await ack(f,current);
 });
 await t.test('wrong owner, operation, generation or stale review cannot acknowledge or release the current original',async()=>{
  const f=await seedOwn('on_site'),prepared=await prepare(f);await commit(prepared);const pending=(await read(f)).pending,before=await state();
  const foreign={...f,principal:{accountId:'58889999',userId:'foreign-intent-user'}};assert.equal((await read(foreign)).pending,null);
  for(const [principal,change,code]of[[foreign,{},/checkout_intent_not_found/],[f,{operationKey:'f'.repeat(64)},/checkout_intent_not_found/],[f,{generation:pending.generation+1},/checkout_intent_not_found/],
   [f,{reviewHash:(pending.reviewHash[0]==='a'?'b':'a')+pending.reviewHash.slice(1)},/checkout_intent_changed/],[f,{deadline:'2000-01-01T00:00:00Z'},/checkout_intent_expired/]])await assert.rejects(ack(principal,pending,a,change),code);
  assert.deepEqual(await state(),before);
  await a.query(`update pages p set blocks=(select jsonb_agg(case when o->>'id'=$2 then jsonb_set(o,'{status}','"completed"') else o end) from jsonb_array_elements(p.blocks) o) where p.merchant_id=$1 and p.slug~'^__merchant_orders__:'`,[site,pending.original.result.resourceId]);
  await assert.rejects(ack(f,pending),/checkout_intent_changed/);const fresh=(await read(f)).pending;assert.equal(fresh.original.result.capturedMinor,0);assert.equal(fresh.original.result.resource.status,'completed');await ack(f,fresh);
 });
 await t.test('a review-required original remains blocked and no inconsistent synthetic update is committed',async()=>{
  const f=await seedOwn(),prepared=await prepare(f);await commit(prepared);const pending=(await read(f)).pending,before=await state();
  await a.query('begin');try{await a.query(`update pages p set blocks=(select jsonb_agg(case when o->>'id'=$2 then jsonb_set(o,'{totalAmount}','999') else o end) from jsonb_array_elements(p.blocks) o) where p.merchant_id=$1 and p.slug~'^__merchant_orders__:'`,[site,pending.original.result.resourceId]);
   const changed=(await read(f,a)).pending;assert.equal(changed.reviewRequired,true);await assert.rejects(ack(f,changed,a),/checkout_intent_review_required/);
  }finally{await a.query('rollback');}assert.deepEqual(await state(),before);await ack(f,pending);
 });
 await t.test('failure after claim insertion rolls back the entire financial transaction and its pending metadata',async()=>{
  const f=await seedOwn(),prepared=await prepare(f),before=await state();
  await temporary('test_intent_claim_failure','faolla_checkout_design.intent_claims','after insert',"raise exception 'synthetic_intent_failure';",async()=>{
   await assert.rejects(commit(prepared),/synthetic_intent_failure/);assert.deepEqual(await state(),before);assert.equal((await read(f)).pending,null);
  });
 });
 await t.test('failure after acknowledgement insertion leaves that same original pending without any financial or metadata change',async()=>{
  const f=await seedOwn(),prepared=await prepare(f);await commit(prepared);const pending=(await read(f)).pending,before=await state();
  await temporary('test_intent_ack_failure','faolla_checkout_design.intent_acknowledgements','after insert',"raise exception 'synthetic_ack_failure';",async()=>{
   await assert.rejects(ack(f,pending),/synthetic_ack_failure/);assert.deepEqual(await state(),before);assert.equal((await read(f)).pending.operationKey,pending.operationKey);
  });
  await ack(f,pending);assert.equal((await read(f)).pending,null);
 });
 await t.test('cancelled original is retained until explicit ack and disabling enrollment cannot bypass an enrolled principal',async()=>{
  const f=await seedOwn(),prepared=await prepare(f);await commit(prepared);await cancel(f);let pending=(await read(f)).pending;assert.equal(pending.original.result.closed,true);
  const next=await prepare(another(f));await admin.query('update faolla_checkout_design.intent_pilots set enabled=false where site_id=$1',[site]);
  try{const before=await state();await assert.rejects(commit(next),/checkout_original_pending/);assert.deepEqual(await state(),before);await ack(f,pending);await commit(next);
   pending=(await read(f)).pending;assert.equal(pending.generation,2);await ack(f,pending);
  }finally{await admin.query('update faolla_checkout_design.intent_pilots set enabled=true where site_id=$1',[site]);}
 });
 await t.test('claim and acknowledgement are immutable, every API role is denied, and all original functions remain byte-identical',async()=>{
  const before=await state();for(const table of ['intent_claims','intent_acknowledgements'])for(const action of ['update','delete'])await assert.rejects(admin.query(action==='update'?`update faolla_checkout_design.${table} set site_id=site_id`:`delete from faolla_checkout_design.${table}`),/checkout_history_immutable/);
  const tables=(await admin.query("select c.relrowsecurity,c.relforcerowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='faolla_checkout_design' and c.relname in ('intent_pilots','intent_claims','intent_acknowledgements')")).rows;
  assert.equal(tables.length,3);assert.ok(tables.every(r=>r.relrowsecurity&&r.relforcerowsecurity));
  assert.equal((await one(admin,"select count(*)::int n from pg_catalog.pg_policies where schemaname='faolla_checkout_design' and tablename in ('intent_pilots','intent_claims','intent_acknowledgements')")).n,0);
  const functions=(await admin.query("select p.prosecdef,p.provolatile,p.proconfig,p.proname from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where (n.nspname='public' and p.proname in ('faolla_member_checkout_pending_intent_v1','faolla_member_checkout_acknowledge_intent_v1')) or (n.nspname='faolla_checkout_design' and p.proname in ('claim_checkout_intent','intent_original_view'))")).rows;
  assert.equal(functions.length,4);for(const fn of functions){assert.equal(fn.prosecdef,false);assert.equal(fn.provolatile,fn.proname==='intent_original_view'?'s':'v');assert.deepEqual(fn.proconfig,['search_path=pg_catalog']);}
  for(const role of ['anon','authenticated','service_role']){const c=await connect(role);try{for(const signature of ['faolla_member_checkout_pending_intent_v1(text,text)','faolla_member_checkout_acknowledge_intent_v1(text,text,text,bigint,text,text)'])assert.equal((await one(c,"select has_function_privilege(current_user,$1,'EXECUTE') allowed",[`public.${signature}`])).allowed,false);
   for(const table of ['intent_pilots','intent_claims','intent_acknowledgements'])await assert.rejects(c.query(`select * from faolla_checkout_design.${table}`),/permission denied/);
   await assert.rejects(c.query('select public.faolla_member_checkout_pending_intent_v1($1,$2)',[site,'account:59000001:intent-synthetic-1']),/permission denied/);}finally{await c.end();}}
  assert.deepEqual(await state(),before);assert.deepEqual(await definitions(),beforeDefinitions);
 });
 await t.test('cart projection remains safe under join reordering and never treats a malformed target order page as ordinary unpaid',async()=>{
  const f=await seedOwn(),prepared=await prepare(f);await commit(prepared);const pending=(await read(f)).pending,before=await state();
  const project=c=>one(c,'select public.faolla_member_checkout_cart_result_v1($1,$2,$3) result',[site,pending.operationKey,scope(f)]).then(r=>r.result);
  assert.ok((await admin.query("select * from pages where merchant_id=$1 and jsonb_typeof(blocks)='object'",[site])).rowCount>0);
  for(const planner of ['enable_nestloop','enable_hashjoin','enable_mergejoin']){await b.query('begin');try{
   await b.query(`set local ${planner}=off`);const result=await project(b);assert.equal(result.resourceId,pending.original.result.resourceId);assert.equal(result.reviewRequired,false);
  }finally{await b.query('rollback');}}
  await b.query('begin');try{const targets=(await b.query(`select p.id from pages p cross join lateral jsonb_array_elements(case when jsonb_typeof(p.blocks)='array' then p.blocks else '[]'::jsonb end) r
   where p.merchant_id=$1 and r->>'id'=$2 and (p.slug~('^__merchant_orders__:'||$1||':chunk:[0-9]+$') or p.slug='__merchant_orders__:'||$1
    and not exists(select 1 from pages chunks where chunks.merchant_id=$1 and chunks.slug~('^__merchant_orders__:'||$1||':chunk:[0-9]+$')))`,[site,pending.original.result.resourceId])).rows;
   assert.equal(targets.length,1);const changed=await b.query("update pages set blocks='{\"syntheticMalformedOrder\":true}'::jsonb where id=$1",[targets[0].id]);assert.equal(changed.rowCount,1);
   const result=await project(b);assert.equal(result.reviewRequired,true);assert.equal(result.resource,null);assert.equal(result.cancellationAvailable,false);
  }finally{await b.query('rollback');}
  assert.deepEqual(await state(),before);await ack(f,pending);
 });
 await t.test('bounded injected server service reads and explicitly acknowledges the actual private PostgreSQL projection',async()=>{
  const f=await seedOwn(),prepared=await prepare(f);await commit(prepared);let calls=0;
  const rpc=async(name,args,signal)=>{assert.ok(signal instanceof AbortSignal);calls++;const spec=name==='faolla_member_checkout_pending_intent_v1'?['$1,$2',['p_site_id','p_principal_key']]:['$1,$2,$3,$4,$5,$6',['p_site_id','p_operation_key','p_principal_key','p_generation','p_review_hash','p_not_after']];
   try{return{data:(await one(b,`select public.${name}(${spec[0]}) result`,spec[1].map(k=>args[k]))).result,error:null};}catch(error){return{data:null,error:{message:error.message}};}};
  const ports={principal:f.principal,authorize:async()=>f.principal},readResult=await intentModule.readPendingCheckoutIntent({siteId:site},ports,rpc);assert.equal(readResult.pending.generation,1);
  const {operationKey,generation,reviewHash}=readResult.pending,before=await all(),result=await intentModule.acknowledgePendingCheckoutIntent({siteId:site,operationKey,generation,reviewHash},ports,rpc);
  assert.equal(result.acknowledged,true);assert.equal(calls,2);assert.deepEqual(await all(),before);assert.equal((await read(f)).pending,null);
 });
 await t.test('protected wrapper commits one original and durable review recovers a lost ack without releasing a newer generation',async()=>{
  const f=await seedOwn(),prepared=await prepare(f);await guarded(prepared);let current=(await read(f)).pending;
  const initial=(await review(f,current.operationKey,b)).review;assert.equal(initial.acknowledged,false);assert.equal(initial.generation,1);
  await ack(f,current);const before=await all(),proof=(await review(f,current.operationKey,b)).review;
  assert.equal(proof.acknowledged,true);assert.equal((await read(f)).pending,null);assert.deepEqual(await all(),before);
  const next=await prepare(another(f));await guarded(next);current=(await read(f)).pending;assert.equal(current.generation,2);
  assert.equal((await review(f,initial.operationKey)).review.acknowledged,true);assert.equal((await read(f)).pending.operationKey,next.id.operationKey);
  const foreign={...f,principal:{accountId:'58889999',userId:'foreign-intent-user'}};assert.equal((await review(foreign,current.operationKey)).review,null);
  assert.equal((await review(f,'f'.repeat(64))).review,null);await ack(f,current);
 });
 await t.test('protected first commit cannot bypass disabled enrollment; enrolled replay/recovery works after closing it',async()=>{
  const f=await seedOwn(),prepared=await prepare(f);await admin.query('update faolla_checkout_design.intent_pilots set enabled=false where site_id=$1',[site]);
  try{const before=await state();await assert.rejects(guarded(prepared),/checkout_intent_disabled/);assert.deepEqual(await state(),before);}
  finally{await admin.query('update faolla_checkout_design.intent_pilots set enabled=true where site_id=$1',[site]);}
  await guarded(prepared);const pending=(await read(f)).pending;await admin.query('update faolla_checkout_design.intent_pilots set enabled=false where site_id=$1',[site]);
  try{const before=await state();assert.equal((await guarded(prepared)).result.replayed,true);assert.deepEqual(await state(),before);
   assert.equal((await review(f,pending.operationKey)).review.acknowledged,false);await ack(f,pending);
  }finally{await admin.query('update faolla_checkout_design.intent_pilots set enabled=true where site_id=$1',[site]);}
 });
 await t.test('new review is busy during uncommitted finance and rejects retained snapshots without granting any API role',async()=>{
  const f=await seedOwn(),prepared=await prepare(f);await a.query('begin');try{await guarded(prepared,a);await assert.rejects(review(f,prepared.id.operationKey,b),/checkout_intent_busy/);}finally{await a.query('commit');}
  await b.query('begin isolation level repeatable read');try{await assert.rejects(review(f,prepared.id.operationKey,b),/checkout_intent_unavailable/);}finally{await b.query('rollback');}
  for(const role of ['anon','authenticated','service_role']){const c=await connect(role);try{for(const fn of ['faolla_member_checkout_intent_review_v1(text,text,text)','faolla_member_checkout_intent_cart_commit_v1(text,text,text,text,jsonb,jsonb,text)'])
    assert.equal((await one(c,"select has_function_privilege(current_user,$1,'EXECUTE') allowed",[`public.${fn}`])).allowed,false);
   await assert.rejects(review(f,prepared.id.operationKey,c),/permission denied/);
  }finally{await c.end();}}
  const attrs=(await admin.query("select prosecdef,proconfig from pg_proc where oid in ('public.faolla_member_checkout_intent_review_v1(text,text,text)'::regprocedure,'public.faolla_member_checkout_intent_cart_commit_v1(text,text,text,text,jsonb,jsonb,text)'::regprocedure)")).rows;
  assert.equal(attrs.length,2);assert.ok(attrs.every(fn=>!fn.prosecdef&&JSON.stringify(fn.proconfig)===JSON.stringify(['search_path=pg_catalog'])));await ack(f,(await read(f)).pending);
 });
 await t.test('actual new HTTP adapters read and acknowledge PostgreSQL-owned originals and recover the durable proof without business writes',async()=>{
  const f=await seedOwn(),prepared=await prepare(f);await guarded(prepared);const pending=(await read(f)).pending,at=new Date().toISOString();let calls=0;
  const call=async(name,args,signal)=>{assert.ok(signal instanceof AbortSignal);calls++;const keys=name.endsWith('pending_intent_v1')?['p_site_id','p_principal_key']:name.endsWith('intent_review_v1')?['p_site_id','p_operation_key','p_principal_key']:['p_site_id','p_operation_key','p_principal_key','p_generation','p_review_hash','p_not_after'];
   try{return{data:(await one(b,`select public.${name}(${keys.map((_,i)=>'$'+(i+1)).join(',')}) result`,keys.map(k=>args[k]))).result,error:null};}catch(error){return{data:null,error:{message:error.message}};}};
  const origin='https://intent.synthetic.invalid',session={...f.principal,servicePaused:false,user:{email_confirmed_at:at}},deps={enabled:()=>true,session:async()=>session,call};
  const request=body=>new Request(origin+'/api/member-checkout/intent/test',{method:'POST',headers:{origin,'content-type':'application/json','x-checkout-account-scope':f.principal.accountId},body:JSON.stringify(body)});
  const before=await all(),first=await httpModule.handleCheckoutIntent('pending',request({siteId:site}),deps);assert.equal(first.status,200);assert.equal((await first.json()).snapshot.pending.operationKey,pending.operationKey);
  const coordinates={siteId:site,operationKey:pending.operationKey,generation:pending.generation,reviewHash:pending.reviewHash};
  assert.equal((await httpModule.handleCheckoutIntent('acknowledge',request(coordinates),deps)).status,200);
  const recovered=await httpModule.handleCheckoutIntent('review',request({siteId:site,operationKey:pending.operationKey}),deps);assert.equal(recovered.status,200);assert.equal((await recovered.json()).review.acknowledged,true);
  assert.equal(calls,3);assert.deepEqual(await all(),before);
 });
}
