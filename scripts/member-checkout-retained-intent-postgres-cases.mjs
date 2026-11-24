// Only called by the ownership-checked TEMP PostgreSQL harness. Real original
// commits, exact HTTP principal, real private SQL, no credentials or live data.
import assert from 'node:assert/strict';import{randomUUID}from'node:crypto';
import service from'../src/lib/merchantCheckoutCartSubmission.server.ts';
import http from'../src/lib/merchantCheckoutRetainedIntent.server.ts';
import pointsPlan from'../src/lib/merchantCheckoutSubmissionPlan.server.ts';
import pointsService from'../src/lib/merchantCheckoutSubmission.server.ts';
import cashService from'../src/lib/merchantCheckoutOnSiteSubmission.server.ts';
import singleClient from'../src/lib/merchantCheckoutSingleIntentClient.ts';
import cartHttp from'../src/lib/merchantCheckoutCartHttp.server.ts';
import intentHttp from'../src/lib/merchantCheckoutIntentHttp.server.ts';
import commonClient from'../src/lib/merchantCheckoutClient.ts';
import inventoryHttp from'../src/lib/merchantCheckoutHistoryInventory.server.ts';
import inventoryDto from'../src/lib/merchantCheckoutHistoryInventory.ts';
export async function retainedIntentCases(t,{admin,a,b,seed,state,site,one,dispatch},{inventoryOnly=false}={}){
 const principal=f=>`account:${f.principal.accountId}:${f.principal.userId}`;
 const untracked=async(method='points',count=1)=>{
  await admin.query('update faolla_checkout_design.intent_pilots set enabled=false where site_id=$1',[site]);
  try{const f=await seed(method),originals=[];
   if(count>5){f.settings.redemptionItems.forEach(item=>{item.stock=count+5;});await admin.query('update public.pages set blocks=$2 where merchant_id=$1 and slug=$3',[site,JSON.stringify(f.settings),`__merchant_membership_settings__:${site}`]);}
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
 // Separate owned-cluster entry runs these larger pagination fixtures. The
 // existing original/booking acceptance keeps all cases and its 120s cap.
 const inventoryCases=async()=>{
 await t.test('no-nonce history inventory reads actual untracked points/venue originals even with purchase/enrollment closed, changes no table and never releases the pending guard',async()=>{
  for(const method of ['points','on_site']){const{f,originals:[o]}=await untracked(method),before=await state(),origin='https://inventory-pg.synthetic.invalid',session={...f.principal,servicePaused:false,user:{email_confirmed_at:new Date().toISOString()}};let reads=0;
   const rpc=async(_name,args)=>{assert.equal(_name,'faolla_member_checkout_history_inventory_v1');reads++;return{data:(await one(a,'select public.faolla_member_checkout_history_inventory_v1($1,$2,$3) result',[args.p_site_id,args.p_principal_key,args.p_after])).result,error:null};};
   const request=()=>new Request(origin+'/api/member-checkout/history/retained',{method:'POST',headers:{origin,'content-type':'application/json','x-checkout-account-scope':f.principal.accountId},body:JSON.stringify({siteId:site,after:null})});
   await admin.query('update faolla_checkout_design.intent_pilots set enabled=false where site_id=$1',[site]);
   try{const response=await inventoryHttp.handleCheckoutHistoryInventory(request(),{enabled:()=>true,session:async()=>session,call:rpc});assert.equal(response.status,200);const body=await response.json();assert.equal(body.readOnly,true);
    const page=inventoryDto.parseCheckoutHistoryInventory(body.inventory,{siteId:site,after:null});assert.equal(page.items.length,1);assert.equal(page.items[0].operationKey,o.result.operationKey);assert.equal(page.items[0].original.kind,'cart');assert.equal(page.nextCursor,null);
    const other=await one(a,'select public.faolla_member_checkout_history_inventory_v1($1,$2,$3) result',[site,`account:${f.principal.accountId}:other-synthetic-user`,null]);assert.deepEqual(other.result.items,[]);
    const noGate=await inventoryHttp.handleCheckoutHistoryInventory(request(),{enabled:()=>false,session:async()=>assert.fail('closed scope'),call:rpc});assert.equal(noGate.status,503);assert.equal(reads,1);
   }finally{await admin.query('update faolla_checkout_design.intent_pilots set enabled=true where site_id=$1',[site]);}
   assert.deepEqual(await state(),before);await assert.rejects(one(a,'select public.faolla_member_checkout_pending_intent_v1($1,$2)',[site,principal(f)]),/checkout_intent_review_required/);
   const p=await proposal(f,o);assert.equal((await invoke(f,o.nonce,p.reviewHash)).status,200);const registered=await state();
   assert.deepEqual((await one(a,'select public.faolla_member_checkout_history_inventory_v1($1,$2,$3) result',[site,principal(f),null])).result.items,[]);assert.deepEqual(await state(),registered);
  }
 });
 await t.test('inventory has bounded exact-principal keyset pages and malformed/foreign cursors cannot add authority',async()=>{
  const{f,originals}=await untracked('on_site',11),o=originals[0],before=await state();
  const page=(after=null,who=principal(f),id=site)=>one(a,'select public.faolla_member_checkout_history_inventory_v1($1,$2,$3) result',[id,who,after]).then(x=>inventoryDto.parseCheckoutHistoryInventory(x.result,{siteId:id,after}));
  const first=await page();assert.equal(first.items.length,10);assert.equal(first.nextCursor,first.items[9].operationKey);
  const second=await page(first.nextCursor);assert.equal(second.items.length,1);assert.equal(second.nextCursor,null);
  assert.deepEqual([...first.items,...second.items].map(x=>x.operationKey),originals.map(x=>x.result.operationKey).sort());
  const last=originals.map(x=>x.result.operationKey).sort().at(-1);assert.deepEqual((await page(last)).items,[]);assert.ok(originals.some(x=>x.result.operationKey===o.result.operationKey));
  assert.deepEqual((await page(null,`account:59999999:other-synthetic-user`)).items,[]);assert.deepEqual((await page(null,principal(f),'10909993')).items,[]);
  await assert.rejects(one(a,'select public.faolla_member_checkout_history_inventory_v1($1,$2,$3) result',[site,principal(f),'INVALID']),/checkout_invalid_request/);assert.deepEqual(await state(),before);
 });
 await t.test('inventory refuses busy/retained snapshots and every API execute grant without changing data',async()=>{
  const{f}=await untracked(),before=await state();await b.query('begin');
  try{await b.query("select pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||$1,0))",[site]);await assert.rejects(one(a,'select public.faolla_member_checkout_history_inventory_v1($1,$2,$3)',[site,principal(f),null]),/checkout_history_busy/);}finally{await b.query('rollback');}
  await a.query('begin isolation level repeatable read');try{await assert.rejects(one(a,'select public.faolla_member_checkout_history_inventory_v1($1,$2,$3)',[site,principal(f),null]),/checkout_history_unavailable/);}finally{await a.query('rollback');}
  for(const role of ['anon','authenticated','service_role']){await a.query(`set role ${role}`);try{assert.equal((await one(a,"select has_function_privilege(current_user,'public.faolla_member_checkout_history_inventory_v1(text,text,text)','EXECUTE') allowed")).allowed,false);await assert.rejects(one(a,'select public.faolla_member_checkout_history_inventory_v1($1,$2,$3)',[site,principal(f),null]),/permission denied/);}finally{await a.query('reset role');}}
  assert.deepEqual(await state(),before);
 });
 };
 if(inventoryOnly)return inventoryCases;
 await t.test('actual single points/venue commit, controller, HTTP registration and explicit acknowledgement preserve all original financial and host facts',async()=>{
  for(const method of ['points','on_site']){
   let f;await admin.query('update faolla_checkout_design.intent_pilots set enabled=false where site_id=$1',[site]);
   const sqlRpc=async(name,args)=>{const keys={faolla_member_checkout_submission_snapshot_v2:['p_site_id','p_operation_key','p_principal_key','p_request_hash','p_offer_id'],faolla_member_checkout_on_site_snapshot_v1:['p_site_id','p_operation_key','p_principal_key','p_request_hash','p_offer_id'],
    faolla_member_checkout_submission_commit_v2:['p_site_id','p_operation_key','p_principal_key','p_request_hash','p_snapshot','p_plan','p_not_after'],faolla_member_checkout_on_site_commit_v1:['p_site_id','p_operation_key','p_principal_key','p_request_hash','p_snapshot','p_plan','p_not_after'],
    faolla_member_checkout_cart_result_v1:['p_site_id','p_operation_key','p_principal_key'],faolla_member_checkout_original_result_v1:['p_site_id','p_operation_key','p_principal_key'],faolla_member_checkout_intent_review_v1:['p_site_id','p_operation_key','p_principal_key'],
    faolla_member_checkout_pending_intent_v1:['p_site_id','p_principal_key'],faolla_member_checkout_history_inventory_v1:['p_site_id','p_principal_key','p_after'],faolla_member_checkout_acknowledge_intent_v1:['p_site_id','p_operation_key','p_principal_key','p_generation','p_review_hash','p_not_after'],
    faolla_member_checkout_retained_intent_review_v1:['p_site_id','p_operation_key','p_principal_key'],faolla_member_checkout_register_retained_intent_v1:['p_site_id','p_operation_key','p_principal_key','p_review_hash','p_not_after']}[name];assert.ok(keys,`unexpected private RPC ${name}`);
    try{return{data:(await one(a,`select public.${name}(${keys.map((_,i)=>'$'+(i+1)).join(',')}) result`,keys.map(k=>args[k]))).result,error:null};}catch(error){return{data:null,error:{message:error.message}};}
   };
   try{f=await seed(method);const offer=f.offers[0],request={siteId:site,offerId:offer.id,offerRevision:offer.revision,quantity:1,couponClaims:[],method,nonce:randomUUID(),confirmationHash:'0'.repeat(64),customer:f.request.customer},input={request,principal:f.principal,authorize:async()=>f.principal};
    if(method==='points'){const identity=pointsPlan.checkoutSubmissionIdentity(request,f.principal),read=await sqlRpc('faolla_member_checkout_submission_snapshot_v2',{p_site_id:site,p_operation_key:identity.operationKey,p_principal_key:identity.principalKey,p_request_hash:identity.requestHash,p_offer_id:offer.id});assert.equal(read.error,null);
     const quoted=await pointsPlan.quoteCheckoutSubmissionSnapshot(pointsPlan.parseCheckoutSubmissionSnapshot(read.data.snapshot,identity),identity,f.principal);request.confirmationHash=quoted.confirmationHash;await pointsService.submitMemberCheckout(input,sqlRpc);
    }else{const quoted=await cashService.previewOnSiteCheckout(input,sqlRpc);request.confirmationHash=quoted.quote.confirmationHash;await cashService.submitOnSiteCheckout(input,sqlRpc);}
    f.request=request;
   }finally{await admin.query('update faolla_checkout_design.intent_pilots set enabled=true where site_id=$1',[site]);}
   const origin='https://single-real-pg.synthetic.invalid',session={...f.principal,servicePaused:false,user:{email_confirmed_at:new Date().toISOString()}},deps={enabled:()=>true,intentEnabled:()=>true,session:async()=>session,call:sqlRpc},paths=[];
   const key=commonClient.checkoutClientStorageKey(site,f.principal.accountId),store=new Map([[key,JSON.stringify({version:1,nonce:f.request.nonce})],['native-form','KEEP booking/member/contact'],['native-cart','KEEP products and note']]),initial=new Map(store),before=await state();
   const request=async(path,body,signal)=>{paths.push(path);const r=new Request(origin+path,{method:'POST',headers:{origin,'content-type':'application/json','x-checkout-account-scope':f.principal.accountId},body:JSON.stringify(body),signal});
    const response=path.endsWith('cart/recover')?await cartHttp.handleCartCheckout('recover',r,deps):path.endsWith('intent/retained-review')?await http.handleRetainedCheckoutIntent(false,r,deps):path.endsWith('intent/register-retained')?await http.handleRetainedCheckoutIntent(true,r,deps):await intentHttp.handleCheckoutIntent(path.endsWith('pending')?'pending':path.endsWith('acknowledge')?'acknowledge':'review',r,deps);
    const value=await response.json();if(!response.ok)throw new commonClient.CheckoutClientError(value.error,response.status);return value;
   };
   const c=(method==='points'?singleClient.createIntentPointsCheckoutController:singleClient.createIntentOnSiteCheckoutController)({siteId:site,accountId:f.principal.accountId,retainedIntentEnabled:true,request,storage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},exclusive:async(_key,run)=>{await run();return true;}});
   try{const response=await inventoryHttp.handleCheckoutHistoryInventory(new Request(origin+'/api/member-checkout/history/retained',{method:'POST',headers:{origin,'content-type':'application/json','x-checkout-account-scope':f.principal.accountId},body:JSON.stringify({siteId:site,after:null})}),deps);
    assert.equal(response.status,200);const page=inventoryDto.parseCheckoutHistoryInventory((await response.json()).inventory,{siteId:site,after:null});assert.equal(page.items.length,1);assert.equal(page.items[0].original.kind,'single');assert.equal(page.items[0].original.original.method,method);assert.deepEqual(await state(),before);
    await c.activate();assert.equal(c.getSnapshot().originalReview.kind,'single');assert.equal(c.getSnapshot().retainedRegistrationRequired,true);assert.deepEqual(await state(),before);
    await c.registerRetained(false);assert.deepEqual(await state(),before);await c.registerRetained(true);assert.equal(c.getSnapshot().retainedRegistrationRequired,false);assert.equal(c.getSnapshot().pending,true);assert.deepEqual(store,initial);unchanged(before,await state(),mutable);
    await c.startAnother();assert.equal(c.getSnapshot().pending,false);assert.equal(store.has(key),false);for(const[k,v]of initial)if(k!==key)assert.equal(store.get(k),v);
    unchanged(before,await state(),[...mutable,'faolla_checkout_design.intent_acknowledgements']);assert.equal(paths.filter(p=>p.endsWith('register-retained')).length,1);assert.equal(paths.filter(p=>p.endsWith('acknowledge')).length,1);assert.equal(paths.some(p=>/\/(preview|submit|cancel)$/.test(p)),false);
   }finally{c.deactivate();}
  }
 });
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
 return inventoryCases;
}
