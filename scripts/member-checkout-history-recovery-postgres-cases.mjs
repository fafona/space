// Owned TEMP-cluster harness only. Actual HTTP -> new read-only proposal ->
// existing complete projections. Synthetic sessions; no grants or live DB.
import assert from 'node:assert/strict';import{randomUUID}from'node:crypto';
import http from'../src/lib/merchantCheckoutHistoryRecovery.server.ts';
import service from'../src/lib/merchantCheckoutCartSubmission.server.ts';
export async function historyRecoveryCases(t,{admin,a,b,seed,submit,state,site,one,dispatch,pending,ack}){
 const origin='https://history-recovery-pg.synthetic.invalid',sql='select public.faolla_member_checkout_history_original_v1($1,$2,$3) result';
 const request=(nonce,account)=>new Request(`${origin}/api/member-checkout/history/recover`,{method:'POST',headers:{origin,'content-type':'application/json','x-checkout-account-scope':account},body:JSON.stringify({siteId:site,nonce})});
 const invoke=async(f,nonce=f.request.nonce,client=a)=>{
  const session={...f.principal,servicePaused:false,user:{email_confirmed_at:new Date().toISOString()}};
  return http.handleCheckoutHistoryRecovery(request(nonce,session.accountId),{enabled:()=>true,session:async()=>session,call:async(name,args)=>{
   assert.equal(name,'faolla_member_checkout_history_original_v1');try{return{data:(await one(client,sql,[args.p_site_id,args.p_operation_key,args.p_principal_key])).result,error:null};}
   catch(error){return{data:null,error:{message:error.message}};}
  }});
 };
 await t.test('retained nonce finds exact originals even after acknowledgement, newer pending claims and closed enrollment; all tables remain unchanged',async()=>{
  for(const method of ['points','on_site']){
   const f=await seed(method),oldNonce=f.request.nonce,first=(await submit(f)).result;await ack(f);
   f.request.nonce=randomUUID();const newer=(await submit(f)).result;assert.equal((await pending(f)).operationKey,newer.operationKey);
   await admin.query('update faolla_checkout_design.intent_pilots set enabled=false where site_id=$1',[site]);
   try{const before=await state();for(let i=0;i<2;i++){
     const response=await invoke(f,oldNonce);assert.equal(response.status,200);const value=await response.json();assert.equal(value.readOnly,true);
     assert.equal(value.recovery.operationKey,first.operationKey);assert.equal(value.recovery.original.result.method,method);assert.equal(value.recovery.reviewRequired,false);
     assert.ok(!JSON.stringify(value).includes(oldNonce));
    }
    const other={...f,principal:{accountId:'59999997',userId:'another-history-nonce-synthetic'}};
    const response=await invoke(other,oldNonce);assert.equal(response.status,200);assert.equal((await response.json()).recovery.original,null);
    assert.equal((await pending(f)).operationKey,newer.operationKey);assert.deepEqual(await state(),before);
   }finally{await admin.query('update faolla_checkout_design.intent_pilots set enabled=true where site_id=$1',[site]);}
  }
 });
 await t.test('untracked original is read without inventing a claim; source changes stay review-required and missing nonce stays unconfirmed',async()=>{
  await admin.query('update faolla_checkout_design.intent_pilots set enabled=false where site_id=$1',[site]);
  try{const f=await seed('points'),input={request:f.request,principal:f.principal,authorize:async()=>f.principal,enabled:()=>true};
   const raw=async(name,args)=>{if(name==='faolla_member_checkout_cart_commit_v1'){
    try{return{data:(await one(a,'select public.faolla_member_checkout_cart_commit_v1($1,$2,$3,$4,$5,$6,$7) result',[site,args.p_operation_key,args.p_principal_key,args.p_request_hash,args.p_snapshot,args.p_plan,args.p_not_after])).result,error:null};}
    catch(error){return{data:null,error:{message:error.message}};}}
    return dispatch(admin)(name,args);
   };
   const quote=await service.previewCartSubmission(input,raw);f.request.confirmationHash=quote.confirmationHash;const result=(await service.submitCartCheckout(input,raw)).result;
   const before=await state();assert.equal((await one(admin,'select count(*)::int n from faolla_checkout_design.intent_claims where site_id=$1 and operation_key=$2',[site,result.operationKey])).n,0);
   const response=await invoke(f);assert.equal(response.status,200);assert.equal((await response.json()).recovery.operationKey,result.operationKey);
   const absent=await invoke(f,randomUUID());assert.equal(absent.status,200);assert.equal((await absent.json()).recovery.original,null);assert.deepEqual(await state(),before);
   await admin.query('begin');try{
    await admin.query("update public.pages set blocks=(select jsonb_agg(case when r->>'id'=$2 then jsonb_set(r,'{totalAmount}','999'::jsonb) else r end) from jsonb_array_elements(blocks) r) where merchant_id=$1 and slug like $3",[site,result.resourceId,`__merchant_orders__:${site}%`]);
    const stable=await state(),changed=await invoke(f,f.request.nonce,admin);assert.equal(changed.status,200);assert.equal((await changed.json()).recovery.reviewRequired,true);assert.deepEqual(await state(),stable);
   }finally{await admin.query('rollback');}
  }finally{await admin.query('update faolla_checkout_design.intent_pilots set enabled=true where site_id=$1',[site]);}
 });
 await t.test('read-only lookup refuses busy writers, retained snapshots and API roles with no persisted side effects or added privileges',async()=>{
  const f=await seed(),result=(await submit(f)).result,before=await state(),principal=`account:${f.principal.accountId}:${f.principal.userId}`;
  await b.query('begin');try{await b.query("select pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||$1,0))",[site]);
   assert.equal((await invoke(f)).status,503);assert.deepEqual(await state(),before);
  }finally{await b.query('rollback');}
  await a.query('begin isolation level repeatable read');try{await assert.rejects(one(a,sql,[site,result.operationKey,principal]),/checkout_history_unavailable/);}finally{await a.query('rollback');}
  for(const role of ['anon','authenticated','service_role']){
   assert.equal((await one(admin,"select has_function_privilege($1,'public.faolla_member_checkout_history_original_v1(text,text,text)','EXECUTE') allowed",[role])).allowed,false);
   await a.query(`set role ${role}`);try{await assert.rejects(one(a,sql,[site,result.operationKey,principal]),/permission denied/);}finally{await a.query('reset role');}
  }assert.deepEqual(await state(),before);
 });
}
