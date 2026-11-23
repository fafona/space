// Additional isolated synthetic cases only; injected verified owner/customer.
import assert from 'node:assert/strict';
import management from '../src/lib/merchantCheckoutOnSiteCollection.server.ts';
import boundary from '../src/lib/merchantCheckoutLegacyBoundary.server.ts';
import legacyOrders from '../src/lib/merchantOrders.server.ts';
import orderRecords from '../src/lib/merchantOrders.ts';
import orderRoute from '../src/app/api/orders/route-handler.ts';

export async function onSiteManagementCases(t,{admin,a,b,one,all,fixture,page,site,accountId,userId,principal,actor,memberSlug,cancel,rawRead,connect}){
 const owner={type:'owner',siteId:site,authUserId:'synthetic-owner',principalKey:actor,authorizationVersion:'owner',displayName:'Synthetic',email:'synthetic@example.invalid',authorizationSource:'database',businessPermissions:[],collaborationPermissions:[]};
 const origin='https://synthetic.faolla.invalid',session={accountId,userId,servicePaused:false,user:{id:userId,email_confirmed_at:new Date().toISOString()}};
 const statement=(f,who=actor,stamp=f.expectedUpdatedAt,amount=f.plan.receipt.dueMinor,deadline=new Date(Date.now()+12000).toISOString(),client=a)=>
  one(client,'select public.faolla_checkout_on_site_collect_v1($1,$2,$3,$4,$5,$6) as result',[site,f.operationKey,who,stamp,amount,deadline]).then(r=>r.result);
 const rpc=client=>async(name,args)=>{try{
  if(name==='faolla_checkout_resource_link_v2')return{data:(await one(client,'select public.faolla_checkout_resource_link_v2($1,$2,$3,$4) as result',[args.p_site_id,args.p_kind,args.p_id,args.p_principal_key])).result,error:null};
  if(name==='faolla_member_checkout_reporting_v2')return{data:(await one(client,'select public.faolla_member_checkout_reporting_v2($1,$2) as result',[args.p_site_id,JSON.stringify(args.p_resources)])).result,error:null};
  if(name==='faolla_commit_order_membership_v1')return{data:(await one(client,'select public.faolla_commit_order_membership_v1($1,$2) as result',[args.p_site_id,args.p_mutation])).result,error:null};
  assert.ok(['faolla_member_checkout_on_site_cancel_v1','faolla_checkout_on_site_merchant_cancel_v1'].includes(name));
  return{data:(await one(client,`select public.${name}($1,$2,$3,$4) as result`,[args.p_site_id,args.p_operation_key,args.p_principal_key??args.p_actor_key,args.p_expected_updated_at])).result,error:null};
 }catch(error){return{data:null,error:{message:error.message}};}};
 const deps={enabled:()=>true,cashEnabled:()=>true,anyEnabled:()=>true,anyCashEnabled:()=>true,session:async()=>session,actor:async()=>owner,rpc:()=>rpc(a)};
 const bridgeInput=(f,mode='personal')=>({request:new Request(origin+'/api/orders'),mode,siteId:site,kind:f.kind,ids:[f.resourceId],action:'cancel',actor:owner});
 const request=f=>new Request(origin+'/api/merchant-checkout/on-site/collect',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({siteId:site,operationKey:f.operationKey,expectedUpdatedAt:f.expectedUpdatedAt,expectedDueMinor:f.plan.receipt.dueMinor,received:true})});
 const httpDeps=(client=a)=>({enabled:()=>true,actor:async()=>owner,site:async()=>({id:site,status:'online',serviceExpiresAt:'2099-01-01T00:00:00Z',permissionConfig:{allowMembershipManagement:true}}),call:async(args,signal)=>{
  assert.ok(signal instanceof AbortSignal);try{return{data:(await one(client,'select public.faolla_checkout_on_site_collect_v1($1,$2,$3,$4,$5,$6) as result',[args.p_site_id,args.p_operation_key,args.p_actor_key,args.p_expected_updated_at,args.p_expected_due_minor,args.p_not_after])).result,error:null};}catch(error){return{data:null,error:{message:error.message}};}
 }});
 await t.test('actual owner HTTP records original booking/product full cash once, audits the first owner and changes no resource/member/coupon facts',async()=>{
  for(const kind of ['booking','order']){
   const f=await fixture({kind}),before=await all(),response=await management.handleOnSiteCollection(request(f),httpDeps());assert.equal(response.status,200);
   const payload=await response.json();assert.equal(payload.receipt.amountMinor,800);assert.equal(payload.receipt.replayed,false);assert.ok(!/principal|actor|PRIVATE|memberId|customer/.test(JSON.stringify(payload)));
   const after=await all();assert.deepEqual({...after,collections:before.collections},before);assert.equal(after.collections.length,before.collections.length+1);assert.equal(after.collections.find(r=>r.operation_key===f.operationKey).actor_key,actor);
   const replay=await statement(f,'owner:another-synthetic-owner','2000-01-01T00:00:00Z');assert.equal(replay.replayed,true);assert.equal(replay.recordedAt,payload.receipt.recordedAt);assert.deepEqual(await all(),after);
   const view=await rawRead(f);assert.equal(view.collection.amountMinor,800);assert.equal(view.terms.capturedMinor,0);assert.equal(view.cancellationAvailable,false);
   await assert.rejects(boundary.bridgeLegacyCheckoutMutation(bridgeInput(f,'merchant'),deps),/checkout_cancellation_requires_refund/);assert.deepEqual(await all(),after);
  }
 });
 await t.test('two actual owner commands race to one immutable receipt, not two cash facts',async()=>{
  const f=await fixture({kind:'order'}),before=await page(memberSlug),values=await Promise.all([statement(f,actor,f.expectedUpdatedAt,800,undefined,a),statement(f,actor,f.expectedUpdatedAt,800,undefined,b)]);
  assert.deepEqual(values.map(v=>v.replayed).sort(),[false,true]);assert.equal(values[0].recordedAt,values[1].recordedAt);assert.deepEqual(await page(memberSlug),before);
 });
 await t.test('actual old cancellation bridge handles both cash resource kinds for customer and owner; replay never restores twice',async()=>{
  for(const kind of ['booking','order'])for(const mode of ['personal','merchant']){
   const f=await fixture({kind}),memberBefore=await page(memberSlug);let legacyWrites=0,result;
   if(kind==='order'&&mode==='merchant'){
    const response=await orderRoute.handleMerchantOrderPatch(new Request(origin+'/api/orders',{method:'PATCH',headers:{origin,'content-type':'application/json'},body:JSON.stringify({siteId:site,orderId:f.resourceId,action:'cancel'})}),
     {resolveAdminSession:async()=>({merchantId:site,actor:owner,assertAuthorizationCurrent:async()=>{}}),isManagementEnabled:async()=>true,checkoutBridge:input=>boundary.bridgeLegacyCheckoutMutation(input,deps),updateOrder:async()=>{legacyWrites++;throw new Error('legacy cancel forbidden');}});
    assert.equal(response.status,200);result={record:(await response.json()).order};
   }else result=await boundary.bridgeLegacyCheckoutMutation(bridgeInput(f,mode),deps);
   assert.equal(result.record.status,'cancelled');assert.equal(legacyWrites,0);assert.ok(!/PRIVATE|editToken|operationKey/.test(JSON.stringify(result)));assert.deepEqual(await page(memberSlug),memberBefore);
   const before=await all();await boundary.bridgeLegacyCheckoutMutation(bridgeInput(f,mode),deps);assert.deepEqual(await all(),before);
   await assert.rejects(boundary.bridgeLegacyCheckoutMutation({...bridgeInput(f,mode),action:'restore'},deps),/checkout_original_cancellation_required/);
   assert.equal((await rawRead(f)).cancellation.couponsReturned,1);
  }
 });
 await t.test('actual old order completion preserves original cash cart and never gifts points or fabricates receipt; linked batches cannot bypass original cancellation',async()=>{
  const f=await fixture({kind:'order'}),memberBefore=await page(memberSlug);let memberPreparations=0;
  const completionDeps={createClient:()=>({rpc:rpc(a)}),loadOrders:async()=>{
   const rows=(await admin.query('select * from pages where merchant_id=$1 and (slug=$2 or slug~$3) order by slug,id',[site,`__merchant_orders__:${site}`,`^__merchant_orders__:${site}:chunk:[0-9]+$`])).rows;
   const records=rows.filter(r=>r.slug.includes(':chunk:')||!rows.some(c=>c.slug.includes(':chunk:'))).flatMap(r=>r.blocks);
   return{siteId:site,orders:orderRecords.normalizeMerchantOrderRecords(records),storageRows:rows.map(r=>({...r,updated_at:r.updated_at.toISOString()})),updatedAt:null};},
   pointTransitions:ts=>boundary.legacyCheckoutPointTransitions(ts,deps),prepareMemberships:async()=>{memberPreparations++;throw new Error('no legacy financial preparation');},
   saveOrders:(client,input)=>boundary.saveCheckoutAwareMerchantOrders(client,input,deps),mirrorOrders:async()=>({status:'written',count:1}),mirrorMemberships:async()=>{throw new Error('no member write');}};
  const completed=await legacyOrders.updateMerchantOrderBySite({siteId:site,orderId:f.resourceId,status:'completed',assertAuthorizationCurrent:async()=>{}},completionDeps);
  assert.equal(completed.status,'completed');assert.equal(memberPreparations,0);assert.deepEqual(await page(memberSlug),memberBefore);assert.equal((await rawRead(f)).collection,null);
  const saved=await all();await assert.rejects(boundary.bridgeLegacyCheckoutMutation({...bridgeInput(f,'merchant'),ids:[f.resourceId,'unlinked']},deps),/checkout_batch_requires_single/);assert.deepEqual(await all(),saved);
  // Completion is not payment; an explicit receipt is still separately valid.
  const current=await rawRead(f);assert.equal((await statement({...f,expectedUpdatedAt:current.resource.updatedAt})).replayed,false);assert.deepEqual(await page(memberSlug),memberBefore);
 });
 await t.test('recording versus original cancellation has exactly one winner, never a cash receipt plus returned coupon',async()=>{
  for(const kind of ['booking','order']){
   const f=await fixture({kind}),outcomes=await Promise.allSettled([statement(f,actor,f.expectedUpdatedAt,800,undefined,a),cancel(f,b)]);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
   const view=await rawRead(f);assert.notEqual(view.closed,Boolean(view.collection));assert.ok(view.closed||view.collection);
  }
 });
 await t.test('zero due, stale version/amount, foreign scope and a closed original reject with all financial facts unchanged',async()=>{
  const covered=await fixture({covered:true}),beforeCovered=await all();await assert.rejects(statement(covered),/checkout_collection_not_allowed/);assert.deepEqual(await all(),beforeCovered);
  const f=await fixture(),before=await all();for(const args of [[actor,'2000-01-01T00:00:00Z',800],[actor,f.expectedUpdatedAt,799],['employee:synthetic',f.expectedUpdatedAt,800]])await assert.rejects(statement(f,...args));
  await assert.rejects(one(a,'select public.faolla_checkout_on_site_collect_v1($1,$2,$3,$4,$5,$6) as result',['10909996',f.operationKey,actor,f.expectedUpdatedAt,800,new Date(Date.now()+10000).toISOString()]),/checkout_not_found/);assert.deepEqual(await all(),before);
  await cancel(f);const cancelled=await all();await assert.rejects(statement(f),/checkout_collection_review_required/);assert.deepEqual(await all(),cancelled);
 });
 await t.test('a lock-wait crossing the collection deadline cannot register a late receipt',async()=>{
  const f=await fixture({kind:'order'}),before=await all();await a.query('begin');let pending;
  try{
   await a.query("select pg_advisory_xact_lock(hashtextextended('faolla-order-membership:'||$1,0))",[site]);
   pending=statement(f,actor,f.expectedUpdatedAt,800,new Date(Date.now()+300).toISOString(),b).then(value=>({value}),error=>({error}));
   let waiting=false;for(let i=0;i<200;i++){waiting=(await one(admin,"select wait_event_type='Lock' as waiting from pg_stat_activity where pid=$1",[b.processID]))?.waiting===true;if(waiting)break;await new Promise(resolve=>setTimeout(resolve,5));}assert.ok(waiting);
   await new Promise(resolve=>setTimeout(resolve,350));await a.query('commit');const outcome=await pending;assert.match(outcome.error?.message??'',/checkout_conflict/);assert.deepEqual(await all(),before);
  }catch(error){await a.query('rollback');if(pending)await pending;throw error;}
 });
 await t.test('late failure after receipt insert rolls back the complete fact without compensation',async()=>{
  const f=await fixture(),before=await all();await admin.query(`create function public.synthetic_collection_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic_collection_failure';end;$$;create trigger synthetic_collection_failure after insert on faolla_checkout_design.on_site_collections for each row execute function public.synthetic_collection_failure();`);
  try{await assert.rejects(statement(f),/synthetic_collection_failure/);assert.deepEqual(await all(),before);}finally{await admin.query('drop trigger synthetic_collection_failure on faolla_checkout_design.on_site_collections;drop function public.synthetic_collection_failure()');}
 });
 await t.test('a committed owner HTTP receipt with lost response is unknown, recoverable by read, with one actual write',async()=>{
  const f=await fixture({kind:'order'}),ports=httpDeps(),call=ports.call;let writes=0;
  ports.call=async(args,signal)=>{writes++;const result=await call(args,signal);assert.equal(result.error,null);throw new Error('synthetic lost response');};
  const response=await management.handleOnSiteCollection(request(f),ports);assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'checkout_unconfirmed'});assert.equal(writes,1);
  const before=await all();assert.equal((await rawRead(f)).collection.amountMinor,800);assert.deepEqual(await all(),before);
 });
 await t.test('new management functions stay invoker-only and denied to all API roles',async()=>{
  assert.equal((await one(admin,"select count(*)::int as n from pg_proc where proname in ('faolla_checkout_on_site_collect_v1','faolla_checkout_resource_link_v2') and prosecdef")).n,0);
  for(const role of ['anon','authenticated','service_role']){const c=await connect(role);
   await assert.rejects(c.query('select public.faolla_checkout_on_site_collect_v1($1,$2,$3,$4,$5,$6)',[site,'a'.repeat(64),actor,new Date().toISOString(),800,new Date(Date.now()+10000).toISOString()]),/permission denied/);
   await assert.rejects(c.query('select public.faolla_checkout_resource_link_v2($1,$2,$3,$4)',[site,'order','test',principal]),/permission denied/);}
 });
}
