// Owned TEMP PostgreSQL only. Actual financial writer, unchanged legacy
// points preparer and old CAS; no real users, dispatcher, mail or live client.
import assert from 'node:assert/strict';
import memberships from '../src/lib/merchantMemberships.server.ts';
import orders from '../src/lib/merchantOrders.ts';

export async function rollbackRewardCases(t,{admin,a,b,seed,submit,ack,state,site,one,rows,records,ordinary}){
 const memberSlug=`__merchant_memberships__:${site}`;
 const memberRow=()=>one(admin,'select blocks,updated_at::text updated_at from pages where merchant_id=$1 and slug=$2',[site,memberSlug]);
 const cas=(c,mutation)=>one(c,'select public.faolla_commit_order_membership_v1($1,$2) result',[site,mutation]);
 const prepare=async(f,record)=>{const current=await memberRow(),previous=orders.normalizeMerchantOrderRecord(record);assert.ok(previous);
  const completed={...previous,status:'completed',completedAt:new Date().toISOString()};
  const prepared=await memberships.prepareMerchantMembershipPointsForOrderTransitions([{previous,next:completed}],{
   loadMemberships:async()=>({siteId:site,memberships:current.blocks,updatedAt:current.updated_at}),loadSettings:async()=>f.settings,now:()=>new Date().toISOString()});
  assert.ok(prepared);
  return{prepared,current};};
 await t.test('zero-cash points originals stay gift-free; closed-gate venue originals reject old completion and membership-only awards',async()=>{
  for(const method of ['points','on_site']){
   const f=await seed(method);f.settings.pointsRules.paidAmount=1;f.settings.pointsRules.paidPoints=2;
   const original=(await submit(f)).result,source=await rows(),record=records(source).find(r=>r.id===original.resourceId);assert.ok(record);
   const {prepared,current}=await prepare(f,record),ordersMutation={expectedRows:source,next:records(source).map(r=>r.id===record.id?{...r,status:'completed',completedAt:new Date().toISOString()}:r)};
   if(method==='points'){
    assert.equal(record.totalAmount,0);assert.deepEqual(prepared.mutation.next,current.blocks,'actual zero-cash points original does not produce a legacy gift');
    const before=await state();await cas(a,{orders:ordersMutation,memberships:prepared.mutation});const after=await state();
    for(const key of Object.keys(before).filter(k=>k!=='public.pages'))assert.deepEqual(after[key],before[key],key);
    assert.deepEqual((await memberRow()).blocks,current.blocks);continue;
   }
   assert.ok(prepared.mutation.next[0].pointBalance>current.blocks[0].pointBalance);
   const gates=['bundle_pilots','cart_submission_pilots','intent_pilots'],enabled=[];
   try{for(const table of gates){enabled.push((await one(admin,`select enabled from faolla_checkout_design.${table} where site_id=$1`,[site])).enabled);await admin.query(`update faolla_checkout_design.${table} set enabled=false where site_id=$1`,[site]);}
    for(const onlyMembers of [false,true]){
     const before=await state(),mutation={memberships:prepared.mutation,...(onlyMembers?{}:{orders:ordersMutation})};
     await assert.rejects(cas(a,mutation),/checkout_resource_locked/);assert.deepEqual(await state(),before,'orders, balances, coupons, stock, receipts, claims and ALL histories roll back');
    }
   }finally{for(let i=0;i<enabled.length;i++)await admin.query(`update faolla_checkout_design.${gates[i]} set enabled=$2 where site_id=$1`,[site,enabled[i]]);}
  }
 });
 await t.test('ordinary completion gifts remain valid at a merchant with real retained checkout originals',async()=>{
  const f=await seed(),original=(await submit(f)).result;await ack(f);f.settings.pointsRules.paidAmount=1;f.settings.pointsRules.paidPoints=2;
  const order=await(await ordinary(f,{intent:false})).create(),source=await rows(),{prepared,current}=await prepare(f,order),before=await state();
  await cas(a,{memberships:prepared.mutation,orders:{expectedRows:source,next:records(source).map(r=>r.id===order.id?{...r,status:'completed',completedAt:new Date().toISOString()}:r)}});
  const after=await state();for(const key of Object.keys(before).filter(k=>k!=='public.pages'))assert.deepEqual(after[key],before[key],key);
  assert.equal((await memberRow()).blocks[0].pointBalance,current.blocks[0].pointBalance+order.totalAmount*2);
  const saved=records(await rows());assert.equal(saved.find(r=>r.id===order.id).status,'completed');assert.equal(saved.find(r=>r.id===original.resourceId).checkoutOperationKey,original.operationKey);
 });
 await t.test('inverted checkout lock refuses the old membership CAS promptly and rolls back partial history',async()=>{
  const f=await seed('on_site'),original=(await submit(f)).result;f.settings.pointsRules.paidAmount=1;f.settings.pointsRules.paidPoints=2;
  const {prepared}=await prepare(f,records(await rows()).find(r=>r.id===original.resourceId)),before=await state();await a.query('begin');
  try{await a.query("select pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||$1,0))",[site]);await b.query('set statement_timeout=1500');
   await assert.rejects(cas(b,{memberships:prepared.mutation}),error=>{assert.equal(error.message,'checkout_resource_locked');assert.equal(error.code,'P0001');return true;});assert.deepEqual(await state(),before);
  }finally{await a.query('rollback');await b.query('set statement_timeout=15000');}
 });
 await t.test('direct old API-role pages writer cannot use hidden ledger rows to award a venue original',async()=>{
  const f=await seed('on_site'),original=(await submit(f)).result;f.settings.pointsRules.paidAmount=1;f.settings.pointsRules.paidPoints=2;
  const {prepared}=await prepare(f,records(await rows()).find(r=>r.id===original.resourceId)),before=await state();
  assert.equal((await one(admin,"select has_function_privilege('service_role','faolla_checkout_design.guard_legacy_checkout_order_rewards()','EXECUTE') allowed")).allowed,false);
  await a.query('set role service_role');
  try{
   await assert.rejects(a.query('update public.pages set blocks=$3 where merchant_id=$1 and slug=$2',[site,memberSlug,JSON.stringify(prepared.mutation.next)]),/checkout_resource_locked/);
  }finally{await a.query('reset role');}assert.deepEqual(await state(),before);
 });
}
