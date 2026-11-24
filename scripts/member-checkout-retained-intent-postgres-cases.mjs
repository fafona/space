// Only called by the ownership-checked TEMP PostgreSQL harness. Real original
// commits, exact HTTP principal, real private SQL, no credentials or live data.
import assert from 'node:assert/strict';import{randomUUID}from'node:crypto';
import service from'../src/lib/merchantCheckoutCartSubmission.server.ts';
import http from'../src/lib/merchantCheckoutRetainedIntent.server.ts';
export async function retainedIntentCases(t,{admin,a,b,seed,state,site,one,dispatch}){
 const principal=f=>`account:${f.principal.accountId}:${f.principal.userId}`;
 const untracked=async(method='points',count=1)=>{
  await admin.query('update faolla_checkout_design.intent_pilots set enabled=false where site_id=$1',[site]);
  try{const f=await seed(method),originals=[];
   const call=async(name,args)=>{if(name!=='faolla_member_checkout_cart_commit_v1')return dispatch(admin)(name,args);
    try{return{data:(await one(a,'select public.faolla_member_checkout_cart_commit_v1($1,$2,$3,$4,$5,$6,$7) result',[site,args.p_operation_key,args.p_principal_key,args.p_request_hash,args.p_snapshot,args.p_plan,args.p_not_after])).result,error:null};}
    catch(error){return{data:null,error:{message:error.message}};}};
   for(let i=0;i<count;i++){f.request.nonce=randomUUID();const input={request:f.request,principal:f.principal,authorize:async()=>f.principal,enabled:()=>true};
    const q=await service.previewCartSubmission(input,call);f.request.confirmationHash=q.confirmationHash;originals.push({nonce:f.request.nonce,result:(await service.submitCartCheckout(input,call)).result});}
   return{f,originals};
  }finally{await admin.query('update faolla_checkout_design.intent_pilots set enabled=true where site_id=$1',[site]);}
 };
 const call=c=>async(name,args)=>{assert.ok(['faolla_member_checkout_retained_intent_review_v1','faolla_member_checkout_register_retained_intent_v1'].includes(name));
  const keys=name.endsWith('register_retained_intent_v1')?['p_site_id','p_operation_key','p_principal_key','p_review_hash','p_not_after']:['p_site_id','p_operation_key','p_principal_key'];
  try{return{data:(await one(c,`select public.${name}(${keys.map((_,i)=>'$'+(i+1)).join(',')}) result`,keys.map(k=>args[k]))).result,error:null};}catch(error){return{data:null,error:{message:error.message}};}};
 const invoke=(f,nonce,hash,c=a)=>{const origin='https://retained-intent-pg.synthetic.invalid',session={...f.principal,servicePaused:false,user:{email_confirmed_at:new Date().toISOString()}};
  return http.handleRetainedCheckoutIntent(hash!==undefined,new Request(origin+'/api/member-checkout/intent/test',{method:'POST',headers:{origin,'content-type':'application/json','x-checkout-account-scope':f.principal.accountId},body:JSON.stringify({siteId:site,nonce,...(hash===undefined?{}:{reviewHash:hash})})}),{enabled:()=>true,session:async()=>session,call:call(c)});
 };
 const proposal=async(f,o,c=a)=>{const response=await invoke(f,o.nonce,undefined,c);assert.equal(response.status,200);const body=await response.json();assert.equal(body.readOnly,true);return body.proposal;};
 const unchanged=(before,after,except=[])=>{for(const k of Object.keys(before))if(!except.includes(k))assert.deepEqual(after[k],before[k],k);};
 const mutable=['faolla_checkout_design.intent_claims','faolla_checkout_design.retained_intent_registrations'];
 await t.test('explicit registration reads exact existing points/venue originals and only appends a claim plus immutable audit; acknowledgement remains separate',async()=>{
  for(const method of ['points','on_site']){const{f,originals:[o]}=await untracked(method),before=await state(),p=await proposal(f,o);assert.equal(p.original.result.operationKey,o.result.operationKey);assert.equal(p.reviewRequired,false);assert.deepEqual(await state(),before);
   const response=await invoke(f,o.nonce,p.reviewHash);assert.equal(response.status,200);const body=await response.json();assert.equal(body.registration.replayed,false);assert.equal(body.registration.review.acknowledged,false);assert.equal(body.registration.review.original.result.method,method);
   const after=await state();unchanged(before,after,mutable);assert.equal(after[mutable[0]].length,before[mutable[0]].length+1);assert.equal(after[mutable[1]].length,before[mutable[1]].length+1);
   assert.equal((await one(admin,'select public.faolla_member_checkout_pending_intent_v1($1,$2) result',[site,principal(f)])).result.pending.operationKey,o.result.operationKey);
   const stable=await state(),again=await invoke(f,o.nonce,p.reviewHash);assert.equal(again.status,200);assert.equal((await again.json()).registration.replayed,true);assert.deepEqual(await state(),stable);
   await one(admin,'select public.faolla_member_checkout_acknowledge_intent_v1($1,$2,$3,$4,$5,$6)',[site,o.result.operationKey,principal(f),body.registration.review.generation,p.reviewHash,new Date(Date.now()+11000).toISOString()]);
   assert.equal((await one(admin,'select public.faolla_member_checkout_pending_intent_v1($1,$2) result',[site,principal(f)])).result.pending,null);
  }
 });
 await t.test('registration never adopts a missing/foreign/changed/manual original, stale deadline or disabled enrollment',async()=>{
  const{f,originals:[o]}=await untracked(),p=await proposal(f,o),before=await state();
  const foreign={...f,principal:{accountId:'59999996',userId:'foreign-retained-synthetic'}};
  assert.equal((await invoke(f,randomUUID(),p.reviewHash)).status,409);assert.equal((await invoke(foreign,o.nonce,p.reviewHash)).status,409);
  assert.equal((await invoke(f,o.nonce,'b'.repeat(64))).status,409);
  await assert.rejects(one(a,'select public.faolla_member_checkout_register_retained_intent_v1($1,$2,$3,$4,$5)',[site,o.result.operationKey,principal(f),p.reviewHash,new Date(Date.now()-1).toISOString()]),/checkout_intent_expired/);assert.deepEqual(await state(),before);
  await admin.query('begin');try{await admin.query("update public.pages set blocks=(select jsonb_agg(case when r->>'id'=$2 then jsonb_set(r,'{totalAmount}','999'::jsonb) else r end) from jsonb_array_elements(blocks) r) where merchant_id=$1 and slug like $3",[site,o.result.resourceId,`__merchant_orders__:${site}%`]);
   const stable=await state();assert.equal((await proposal(f,o,admin)).reviewRequired,true);await admin.query('savepoint refused_registration');
   const refused=await invoke(f,o.nonce,p.reviewHash,admin);await admin.query('rollback to savepoint refused_registration');assert.equal(refused.status,409);assert.deepEqual(await state(),stable);
  }finally{await admin.query('rollback');}
  await admin.query('update faolla_checkout_design.intent_pilots set enabled=false where site_id=$1',[site]);try{const stable=await state();assert.equal((await invoke(f,o.nonce,p.reviewHash)).status,409);assert.deepEqual(await state(),stable);}
  finally{await admin.query('update faolla_checkout_design.intent_pilots set enabled=true where site_id=$1',[site]);}
 });
 await t.test('two untracked originals are never collapsed into latest; another unresolved claim blocks registration and remaining originals still block new work',async()=>{
  const{f,originals:[first,second]}=await untracked('on_site',2),p1=await proposal(f,first),p2=await proposal(f,second);
  const r1=await(await invoke(f,first.nonce,p1.reviewHash)).json(),before=await state();assert.equal((await invoke(f,second.nonce,p2.reviewHash)).status,409);assert.deepEqual(await state(),before);
  await assert.rejects(one(a,'select public.faolla_member_checkout_pending_intent_v1($1,$2)',[site,principal(f)]),/checkout_intent_review_required/);
  await one(admin,'select public.faolla_member_checkout_acknowledge_intent_v1($1,$2,$3,$4,$5,$6)',[site,first.result.operationKey,principal(f),r1.registration.review.generation,p1.reviewHash,new Date(Date.now()+11000).toISOString()]);
  await assert.rejects(one(a,'select public.faolla_member_checkout_pending_intent_v1($1,$2)',[site,principal(f)]),/checkout_intent_review_required/);
  const response=await invoke(f,second.nonce,p2.reviewHash);assert.equal(response.status,200);const r2=await response.json();assert.equal(r2.registration.review.generation,r1.registration.review.generation+1);
 });
 await t.test('busy/concurrent requests, repeatable-read snapshots and all API roles cannot duplicate or mutate retained registration',async()=>{
  const{f,originals:[o]}=await untracked(),p=await proposal(f,o),before=await state();
  await b.query('begin');try{await b.query("select pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||$1,0))",[site]);assert.equal((await invoke(f,o.nonce,p.reviewHash)).status,409);assert.deepEqual(await state(),before);}finally{await b.query('rollback');}
  await a.query('begin isolation level repeatable read');try{await assert.rejects(one(a,'select public.faolla_member_checkout_retained_intent_review_v1($1,$2,$3)',[site,o.result.operationKey,principal(f)]),/checkout_intent_unavailable/);}finally{await a.query('rollback');}
  const pair=await Promise.all([invoke(f,o.nonce,p.reviewHash,a),invoke(f,o.nonce,p.reviewHash,b)]);assert.ok(pair.some(r=>r.status===200));assert.ok(pair.every(r=>[200,409].includes(r.status)));
  unchanged(before,await state(),mutable);assert.equal((await one(admin,'select count(*)::int n from faolla_checkout_design.retained_intent_registrations where site_id=$1 and operation_key=$2',[site,o.result.operationKey])).n,1);
  const stable=await state();await assert.rejects(admin.query('delete from faolla_checkout_design.retained_intent_registrations where site_id=$1 and operation_key=$2',[site,o.result.operationKey]),/checkout_history_immutable/);
  for(const role of ['anon','authenticated','service_role'])for(const sig of ['public.faolla_member_checkout_retained_intent_review_v1(text,text,text)','public.faolla_member_checkout_register_retained_intent_v1(text,text,text,text,text)'])
   assert.equal((await one(admin,"select has_function_privilege($1,$2,'EXECUTE') allowed",[role,sig])).allowed,false);
  for(const role of ['anon','authenticated','service_role'])assert.equal((await one(admin,"select has_table_privilege($1,'faolla_checkout_design.retained_intent_registrations','SELECT,INSERT,UPDATE,DELETE') allowed",[role])).allowed,false);
  assert.deepEqual(await state(),stable);
 });
}
