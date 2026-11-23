// Only called inside the existing owned, identity-checked TEMP PostgreSQL
// cluster. Actor/session/service metadata are explicitly synthetic; financial
// writers, locks, constraints, legacy PATCH and CAS adapters are actual code.
import assert from 'node:assert/strict';
import boundary from '../../src/lib/merchantCheckoutLegacyBoundary.server.ts';
import route from '../../src/app/api/orders/route-handler.ts';
import orders from '../../src/lib/merchantOrders.ts';
export async function cartManagementAcceptance(p){
 const {t,admin,a,b,site,one,seed,submit,cancel,all,temporary,definitions,beforeDefinitions}=p;
 const originalDefinitions=async()=>(await admin.query("select oid::regprocedure::text name,pg_get_functiondef(oid) definition from pg_proc where oid in ('public.faolla_member_checkout_cart_cancel_v1(text,text,text,text,text)'::regprocedure,'public.faolla_member_checkout_cart_commit_v1(text,text,text,text,jsonb,jsonb,text)'::regprocedure) order by name")).rows;
 const originalCart=await originalDefinitions();await admin.query(await p.sql());
 const state=async()=>({...await all(),actors:(await admin.query('select * from faolla_checkout_design.merchant_cancellation_actors order by site_id,operation_key')).rows});
 const audit=op=>one(admin,'select * from faolla_checkout_design.merchant_cancellation_actors where site_id=$1 and operation_key=$2',[site,op]);
 const link=(id,c=admin,s=site)=>one(c,'select public.faolla_checkout_cart_resource_link_v1($1,$2) result',[s,id]).then(x=>x.result);
 const ownerCancel=(r,c=a,actor='owner:synthetic-owner',deadline=new Date(Date.now()+11000).toISOString())=>one(c,'select public.faolla_checkout_cart_merchant_cancel_v1($1,$2,$3,$4,$5) result',[site,r.operationKey,actor,r.resource.updatedAt,deadline]).then(x=>x.result);
 const actor={type:'owner',siteId:site,authUserId:'synthetic-owner',principalKey:'owner:synthetic-owner',authorizationVersion:'owner',authorizationSource:'database',businessPermissions:[],collaborationPermissions:[],displayName:'Synthetic owner',email:'owner@synthetic.invalid'};
 const dispatch=c=>async(name,args)=>{
  const specs={faolla_checkout_cart_resource_link_v1:['p_site_id','p_id'],faolla_checkout_cart_merchant_cancel_v1:['p_site_id','p_operation_key','p_actor_key','p_expected_updated_at','p_not_after'],faolla_member_checkout_reporting_v3:['p_site_id','p_resources']};
  assert.ok(specs[name],`unexpected SQL dispatch ${name}`);const keys=specs[name];
  try{return{data:(await one(c,`select public.${name}(${keys.map((_,i)=>`$${i+1}`).join(',')}) result`,keys.map(k=>k==='p_resources'?JSON.stringify(args[k]):args[k]))).result,error:null};}
  catch(error){return{data:null,error:{message:error.message}};}
 };
 const overrides=(f,c=a)=>({enabled:()=>true,cartEnabled:()=>true,actor:async()=>actor,cartSite:async()=>f.site,rpc:()=>dispatch(c)});
 const request=id=>new Request('https://merchant.synthetic.invalid/api/orders',{method:'PATCH',headers:{origin:'https://merchant.synthetic.invalid','content-type':'application/json'},body:JSON.stringify({siteId:site,orderId:id,action:'cancel'})});
 await t.test('private cart link reads one authoritative original without writing; old singles and ordinary orders retain old bridge',async()=>{
  const f=await seed(),r=(await submit(f)).result,before=await state(),x=await link(r.resourceId);
  assert.equal(x.cart.operationKey,r.operationKey);assert.equal(x.record.id,r.resourceId);assert.equal(x.record.customerAccountId,f.principal.accountId);assert.equal(x.refundRequired,false);
  assert.equal(await link('not-linked'),null);assert.equal(await link(r.resourceId,admin,'10909993'),null);
  const old=await one(admin,"select resource_id from faolla_checkout_design.bundle_results where receipt->'version'='1'::jsonb and resource_kind='order' limit 1");assert.ok(old);assert.equal(await link(old.resource_id),null);
  assert.deepEqual(await state(),before);
 });
 await t.test('actual old merchant PATCH cancels the whole points/cash original and records the actual owner with frozen per-line returns',async()=>{
  for(const method of ['points','on_site']){
   const f=await seed(method,x=>{x.offers[1].checkoutBinding.pointsReturnOnCancel=false;x.request.lines[0].couponClaims=[{couponId:x.coupons[0].id,claimEventId:x.coupons[0].claimEvents[0].id}];}),r=(await submit(f)).result;
   let rawWrites=0;const deps={resolveAdminSession:async()=>({merchantId:site,actor,assertAuthorizationCurrent:async()=>{}}),isManagementEnabled:async()=>true,
    checkoutBridge:input=>boundary.bridgeLegacyCheckoutMutation(input,overrides(f)),updateOrder:async()=>{rawWrites++;throw Error('legacy raw cancellation must not run');}};
   const response=await route.handleMerchantOrderPatch(request(r.resourceId),deps);assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
   assert.equal((await response.json()).order.status,'cancelled');assert.equal(rawWrites,0);
   const final=(await link(r.resourceId)).cart;assert.equal(final.closed,true);assert.equal(final.capturedMinor,0);
   assert.equal(final.cancellation.pointsReturned,method==='points'?final.lines.filter(l=>l.returnPoints).reduce((s,l)=>s+l.points,0):0);
   assert.equal(final.cancellation.couponsReturned,1);assert.equal(final.cancellation.stockReleased,2);assert.equal((await audit(r.operationKey)).actor_key,actor.principalKey);
   const before=await state();assert.equal((await route.handleMerchantOrderPatch(request(r.resourceId),deps)).status,200);assert.deepEqual(await state(),before);
  }
 });
 await t.test('two owners racing cancellation append one immutable attribution and one set of financial returns',async()=>{
  const f=await seed(),r=(await submit(f)).result,x=await Promise.all([ownerCancel(r,a,'owner:synthetic-owner-a'),ownerCancel(r,b,'owner:synthetic-owner-b')]);
  assert.deepEqual(x.map(x=>x.replayed).sort(),[false,true]);assert.equal((await admin.query('select * from faolla_checkout_design.bundle_cancellations where site_id=$1 and operation_key=$2',[site,r.operationKey])).rowCount,1);
  const first=(await audit(r.operationKey)).actor_key;assert.ok(['owner:synthetic-owner-a','owner:synthetic-owner-b'].includes(first));const before=await state();
  assert.equal((await ownerCancel(r,b,'owner:synthetic-later')).replayed,true);assert.deepEqual(await state(),before);assert.equal((await audit(r.operationKey)).actor_key,first);
  await assert.rejects(admin.query('update faolla_checkout_design.merchant_cancellation_actors set actor_key=$3 where site_id=$1 and operation_key=$2',[site,r.operationKey,'owner:synthetic-later']),/immutable/);
  await assert.rejects(admin.query('delete from faolla_checkout_design.merchant_cancellation_actors where site_id=$1 and operation_key=$2',[site,r.operationKey]),/immutable/);
 });
 await t.test('a safe-looking post-write read error is unknown over actual PATCH; reread recovers the committed cancellation without another write',async()=>{
  const f=await seed(),r=(await submit(f)).result,original=dispatch(a);let wrote=false,writes=0;
  const deps=overrides(f);deps.rpc=()=>async(name,args)=>{
   if(wrote&&name==='faolla_checkout_cart_resource_link_v1')return{data:null,error:{message:'checkout_conflict'}};
   const response=await original(name,args);if(name==='faolla_checkout_cart_merchant_cancel_v1'){wrote=true;writes++;}return response;
  };
  const http={resolveAdminSession:async()=>({merchantId:site,actor,assertAuthorizationCurrent:async()=>{}}),isManagementEnabled:async()=>true,
   checkoutBridge:input=>boundary.bridgeLegacyCheckoutMutation(input,deps),updateOrder:async()=>{throw Error('never raw fallback');}};
  const unknown=await route.handleMerchantOrderPatch(request(r.resourceId),http);assert.equal(unknown.status,503);assert.equal((await unknown.json()).error,'checkout_unconfirmed');
  assert.equal((await link(r.resourceId)).cart.closed,true);assert.equal((await audit(r.operationKey)).actor_key,actor.principalKey);const before=await state();
  deps.rpc=()=>original;assert.equal((await route.handleMerchantOrderPatch(request(r.resourceId),http)).status,200);assert.equal(writes,1);assert.deepEqual(await state(),before);
 });
 await t.test('a customer-cancelled original is a read-only merchant replay, never falsely attributed to the owner',async()=>{
  const f=await seed(),r=(await submit(f)).result;await cancel(f);const before=await state();assert.equal((await ownerCancel(r)).replayed,true);assert.equal(await audit(r.operationKey),undefined);assert.deepEqual(await state(),before);
 });
 await t.test('failure appending the owner attribution rolls back every already-written point/coupon/stock/order return',async()=>{
  const f=await seed('points',x=>x.request.lines[0].couponClaims=[{couponId:x.coupons[0].id,claimEventId:x.coupons[0].claimEvents[0].id}]),r=(await submit(f)).result,before=await state();
  await temporary('test_cart_owner_failure','faolla_checkout_design.merchant_cancellation_actors','before insert',"raise exception 'synthetic_owner_audit_failure';",async()=>{
   await assert.rejects(ownerCancel(r),/synthetic_owner_audit_failure/);assert.deepEqual(await state(),before);
  });
 });
 await t.test('owner audit delay and same-site lock waits crossing the original deadline roll back all effects',async()=>{
  const f=await seed(),r=(await submit(f)).result,before=await state();
  await temporary('test_cart_owner_delay','faolla_checkout_design.merchant_cancellation_actors','after insert','perform pg_sleep(0.65);',async()=>{
   await assert.rejects(ownerCancel(r,a,actor.principalKey,new Date(Date.now()+450).toISOString()),/checkout_quote_expired/);assert.deepEqual(await state(),before);
  });
  await a.query('begin');await a.query("select pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||$1,0))",[site]);
  const pending=ownerCancel(r,b,actor.principalKey,new Date(Date.now()+450).toISOString());pending.catch(()=>{});
  try{let blocked=false;const until=Date.now()+1500;while(Date.now()<until){blocked=(await one(admin,"select wait_event='advisory' blocked from pg_stat_activity where pid=$1",[b.processID]))?.blocked;if(blocked)break;await new Promise(resolve=>setTimeout(resolve,10));}
   assert.equal(blocked,true);await assert.rejects(link(r.resourceId,admin),/checkout_unavailable/);await admin.query('select pg_sleep(0.6)');}finally{await a.query('rollback');}
  await assert.rejects(pending,/checkout_quote_expired/);assert.deepEqual(await state(),before);
 });
 await t.test('old operational completion through the actual guarded CAS preserves cart items and never creates a cash receipt or loyalty award',async()=>{
  const f=await seed('on_site'),r=(await submit(f)).result,source=(await admin.query("select * from pages where merchant_id=$1 and slug~'^__merchant_orders__:'",[site])).rows;
  const raw=source.flatMap(r=>Array.isArray(r.blocks)?r.blocks:[]),normalized=orders.normalizeMerchantOrderRecords(raw),previous=normalized.find(o=>o.id===r.resourceId),next={...previous,status:'completed',completedAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  const input={request:request(r.resourceId),mode:'merchant',siteId:site,kind:'order',ids:[r.resourceId],action:'complete',actor,assertAuthorizationCurrent:async()=>{}};
  assert.equal(await boundary.bridgeLegacyCheckoutMutation(input,overrides(f)),null);
  assert.deepEqual(await boundary.legacyCheckoutPointTransitions([{previous,next}],overrides(f)),[]);
  const before=await state(),client={from:()=>{throw Error('no direct writes');},rpc:dispatch(a)};
  client.rpc=async(name,args)=>{assert.equal(name,'faolla_commit_order_membership_v1');return{data:(await one(a,'select public.faolla_commit_order_membership_v1($1,$2) result',[args.p_site_id,args.p_mutation])).result,error:null};};
  const saved=await boundary.saveCheckoutAwareMerchantOrders(client,{siteId:site,orders:normalized.map(o=>o.id===next.id?next:o),expectedRows:source},overrides(f));assert.equal(saved.error,null);
  const final=await link(r.resourceId);assert.equal(final.cart.resource.status,'completed');assert.equal(final.cart.capturedMinor,0);assert.equal(final.cart.cancellationAvailable,false);
  assert.deepEqual(final.record.items,raw.find(o=>o.id===r.resourceId).items);const after=await state();
  assert.deepEqual(after.operations,before.operations);assert.deepEqual(after.receipts,before.receipts);assert.deepEqual(after.collections,before.collections);
  // The proven CAS intentionally appends its order history/backup on a status
  // save. Those business histories are not membership/financial effects.
  const businessPage=row=>row.slug.startsWith('__merchant_orders__:')||row.slug===`__merchant_orders_history_v2__:${site}`||row.slug===`__merchant_orders_history_backup_v2__:${site}`;
  assert.deepEqual(after.pages.filter(p=>!businessPage(p)),before.pages.filter(p=>!businessPage(p)));
  assert.deepEqual(after.cancellations,before.cancellations);assert.deepEqual(after.returns,before.returns);assert.deepEqual(after.actors,before.actors);
  await assert.rejects(ownerCancel(final.cart),/checkout_cancellation_not_allowed/);
 });
 await t.test('private functions deny all API roles, require read-committed and owner identity grammar; original functions remain byte-identical',async()=>{
  const f=await seed(),r=(await submit(f)).result,before=await state();
  for(const role of ['anon','authenticated','service_role']){await a.query(`set role ${role}`);try{
   for(const sig of ['faolla_checkout_cart_resource_link_v1(text,text)','faolla_checkout_cart_merchant_cancel_v1(text,text,text,text,text)'])assert.equal((await one(a,"select has_function_privilege(current_user,$1,'EXECUTE') allowed",[`public.${sig}`])).allowed,false);
   await assert.rejects(link(r.resourceId,a),/permission denied/);await assert.rejects(ownerCancel(r,a),/permission denied/);
  }finally{await a.query('reset role');}}
  await assert.rejects(ownerCancel(r,a,'employee:synthetic-employee'),/checkout_unauthorized/);
  await a.query('begin isolation level repeatable read');try{await assert.rejects(link(r.resourceId,a),/checkout_unavailable/);}finally{await a.query('rollback');}
  assert.deepEqual(await state(),before);assert.deepEqual(await definitions(),beforeDefinitions);assert.deepEqual(await originalDefinitions(),originalCart);
  const functions=(await admin.query("select provolatile,prosecdef,proconfig from pg_proc where oid in ('public.faolla_checkout_cart_resource_link_v1(text,text)'::regprocedure,'public.faolla_checkout_cart_merchant_cancel_v1(text,text,text,text,text)'::regprocedure)")).rows;
  assert.equal(functions.length,2);assert.ok(functions.every(f=>f.provolatile==='v'&&!f.prosecdef&&f.proconfig.includes('search_path=pg_catalog')));
 });
}
