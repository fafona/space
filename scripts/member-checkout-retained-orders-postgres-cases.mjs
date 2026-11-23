// Invoked only by the owned TEMP-cluster entry point. Real receipt projection,
// old order updater and CAS; synthetic authorization, zero production clients.
import assert from 'node:assert/strict';
import boundary from '../src/lib/merchantCheckoutLegacyBoundary.server.ts';
import creator from '../src/lib/merchantOrders.server.ts';
import orders from '../src/lib/merchantOrders.ts';
import membership from '../src/lib/merchantMemberships.server.ts';

export async function retainedOrderCases(t,{admin,a,seed,submit,state,site,one,rows,records,dispatch}){
 const ordinaryState=state=>Object.fromEntries(Object.entries(state).map(([key,value])=>[key,key==='public.pages'
  ?value.filter(({r})=>r.merchant_id!==site||!r.slug.startsWith('__merchant_orders')):value]));
 const harness=(id,{failRead=0,failCommit=false,batch=false}={})=>{
  let reads=0,writes=0,mirrors=0;const sent=[];
  const read=()=>async(name,args)=>{assert.equal(name,'faolla_member_checkout_reporting_v3');reads++;if(reads===failRead)return{data:null,error:{message:'synthetic unavailable'}};return dispatch(admin)(name,args);};
  const client={from:()=>{throw Error('no direct pages or live client');},rpc:async(name,args)=>{assert.equal(name,'faolla_commit_order_membership_v1');writes++;sent.push(args.p_mutation);
   if(failCommit)return{data:null,error:{message:'order_update_conflict'}};return dispatch(a)(name,args);}};
  const gates={enabled:()=>false,cashEnabled:()=>false,cartEnabled:()=>false,intentEnabled:()=>false,rpc:read};
  const deps={createClient:()=>client,loadOrders:async()=>{const storageRows=await rows();return{siteId:site,orders:orders.normalizeMerchantOrderRecords(records(storageRows)),updatedAt:null,storageRows};},
   pointTransitions:(transitions,_overrides,source)=>boundary.legacyCheckoutPointTransitions(transitions,gates,source),
   // The old preparer legitimately receives a repeated no-op completion; its
   // real early exit must still perform zero membership/settings IO.
   prepareMemberships:transitions=>membership.prepareMerchantMembershipPointsForOrderTransitions(transitions,{
    loadMemberships:async()=>assert.fail('no legacy membership read/award/reversal for an original'),loadSettings:async()=>assert.fail('no legacy membership settings read')}),
   saveOrders:(client,input)=>boundary.saveCheckoutAwareMerchantOrders(client,input,gates),
   mirrorMemberships:async()=>assert.fail('no membership mirror'),mirrorOrders:async()=>{mirrors++;return{status:'disabled',count:0};}};
  return{run:()=>batch?creator.updateMerchantOrdersBatchBySite({siteId:site,orderIds:[id],status:'completed'},deps):creator.updateMerchantOrderBySite({siteId:site,orderId:id,status:'completed'},deps),
   stats:()=>({reads,writes,mirrors}),sent};
 };
 await t.test('closed application gates retain actual points and venue original JSON through single/batch old order CAS without gifts',async()=>{
  for(const method of ['points','on_site'])for(const batch of [false,true]){
   const f=await seed(method),r=(await submit(f)).result,source=await rows(),next=structuredClone(records(source)),raw=next.find(x=>x.id===r.resourceId);assert.ok(raw);
   raw.futurePrivate={retained:'synthetic-only'};await one(a,'select public.faolla_commit_order_membership_v1($1,$2) result',[site,{orders:{expectedRows:source,next}}]);
   const before=await state(),h=harness(r.resourceId,{batch});await h.run();assert.equal(h.stats().writes,1);assert.equal(h.stats().mirrors,1);assert.ok(h.stats().reads>=2);
   const saved=records(await rows()).find(x=>x.id===r.resourceId);assert.equal(saved.status,'completed');assert.equal(saved.checkoutOperationKey,r.operationKey);assert.deepEqual(saved.items,raw.items);assert.deepEqual(saved.futurePrivate,raw.futurePrivate);
   assert.deepEqual(ordinaryState(await state()),ordinaryState(before),'membership, coupons, stock, receipts and claims are unchanged');
   assert.equal(h.sent[0].memberships,undefined);assert.deepEqual(h.sent[0].orders.next.find(x=>x.id===r.resourceId),saved);
   const stable=await state();const repeated=harness(r.resourceId,{batch});await repeated.run();assert.deepEqual(ordinaryState(await state()),ordinaryState(stable));
  }
 });
 await t.test('closed-gate original lookup and original CAS conflicts prevent all mirrors and preserve the whole isolated database',async()=>{
  const f=await seed(),r=(await submit(f)).result;
  for(const options of [{failRead:1},{failRead:2},{failCommit:true}]){
   const before=await state(),h=harness(r.resourceId,options);await assert.rejects(h.run(),options.failCommit?/order_update_conflict/:/checkout_unavailable/);
   assert.deepEqual(await state(),before);assert.equal(h.stats().mirrors,0);assert.equal(h.stats().writes,options.failCommit?1:0);
  }
 });
 await t.test('closed-gate old whole-store save cannot remove or reprice an original even with ordinary normalized input',async()=>{
  const source=await rows(),values=orders.normalizeMerchantOrderRecords(records(source)),marked=records(source).find(x=>x.checkoutOperationKey);assert.ok(marked);
  const client={from:()=>assert.fail('no page write'),rpc:async()=>assert.fail('must reject before CAS')},gates={enabled:()=>false,rpc:()=>dispatch(admin)};
  const before=await state();await assert.rejects(boundary.saveCheckoutAwareMerchantOrders(client,{siteId:site,orders:values.filter(r=>r.id!==marked.id),expectedRows:source},gates),/checkout_resource_locked/);
  const changed=structuredClone(values);changed.find(r=>r.id===marked.id).items[0].unitPrice+=1;
  await assert.rejects(boundary.saveCheckoutAwareMerchantOrders(client,{siteId:site,orders:changed,expectedRows:source},gates),/checkout_change_requires_review/);assert.deepEqual(await state(),before);
 });
}
