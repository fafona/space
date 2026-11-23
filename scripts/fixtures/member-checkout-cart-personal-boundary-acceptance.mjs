// Actual legacy HTTP handler + private SQL in the existing owned TEMP cluster.
// Only login/session metadata and transport are synthetic. No real accounts.
import assert from 'node:assert/strict';
import boundary from '../../src/lib/merchantCheckoutLegacyBoundary.server.ts';
import route from '../../src/app/api/orders/route-handler.ts';
export async function cartPersonalBoundaryAcceptance(p){
 const {t,admin,a,b,site,one,seed,submit,all,temporary,definitions,beforeDefinitions}=p;
 const originals=async()=>(await admin.query("select oid::regprocedure::text name,pg_get_functiondef(oid) definition from pg_proc where oid in ('public.faolla_member_checkout_cart_cancel_v1(text,text,text,text,text)'::regprocedure,'public.faolla_checkout_cart_resource_link_v1(text,text)'::regprocedure,'public.faolla_checkout_cart_merchant_cancel_v1(text,text,text,text,text)'::regprocedure) order by name")).rows;
 const beforeOriginals=await originals();await admin.query(await p.sql());
 const state=async()=>({...await all(),actors:(await admin.query('select * from faolla_checkout_design.merchant_cancellation_actors order by site_id,operation_key')).rows});
 const principal=f=>`account:${f.principal.accountId}:${f.principal.userId}`;
 const read=(r,f,c=admin,key=principal(f))=>one(c,'select public.faolla_checkout_cart_personal_resource_link_v1($1,$2,$3) result',[site,r.resourceId,key]).then(r=>r.result);
 const session=f=>({...f.principal,user:{email_confirmed_at:'2026-11-23T10:00:00Z'},servicePaused:false});
 const dispatch=c=>async(name,args)=>{
  const keys={faolla_checkout_cart_personal_resource_link_v1:['p_site_id','p_id','p_principal_key'],faolla_member_checkout_cart_cancel_v1:['p_site_id','p_operation_key','p_principal_key','p_expected_updated_at','p_not_after']}[name];assert.ok(keys,`unexpected SQL dispatch ${name}`);
  try{return{data:(await one(c,`select public.${name}(${keys.map((_,i)=>`$${i+1}`).join(',')}) result`,keys.map(k=>args[k]))).result,error:null};}catch(error){return{data:null,error:{message:error.message}};}
 };
 const request=(r,extra={})=>new Request('https://personal.synthetic.invalid/api/orders',{method:'PATCH',headers:{origin:'https://personal.synthetic.invalid','content-type':'application/json'},body:JSON.stringify({scope:'personal',siteId:site,orderId:r.resourceId,action:'cancel',...extra})});
 const http=(f,r,c=a,mutate=x=>x,extra={})=>{const resolved=session(f);return route.handleMerchantOrderPatch(request(r,extra),{
  resolvePersonalSession:async()=>resolved,checkoutBridge:input=>boundary.bridgeLegacyCheckoutMutation(input,mutate({enabled:()=>true,cartPersonalEnabled:()=>true,session:async()=>resolved,rpc:()=>dispatch(c)})),
  cancelPersonalOrder:async()=>{throw Error('unpaid legacy writer must not run');}});};
 await t.test('personal private link proves exact original account before returning a cart; unlinked and old singles keep old lookup',async()=>{
  const f=await seed(),r=(await submit(f)).result,before=await state(),link=await read(r,f);
  assert.equal(link.cart.operationKey,r.operationKey);assert.equal(link.record.customerAccountId,f.principal.accountId);assert.equal(link.record.customerUserId,f.principal.userId);
  await assert.rejects(read(r,f,admin,`account:99999999:${f.principal.userId}`),/checkout_not_found/);
  await assert.rejects(read(r,f,admin,`account:${f.principal.accountId}:foreign-synthetic-user`),/checkout_not_found/);
  await assert.rejects(read(r,f,admin,'owner:synthetic-owner'),/checkout_unauthorized/);
  assert.equal(await read({resourceId:'not-linked'},f),null);
  const old=await one(admin,"select resource_id from faolla_checkout_design.bundle_results where receipt->'version'='1'::jsonb and resource_kind='order' limit 1");assert.ok(old);assert.equal(await read({resourceId:old.resource_id},f),null);
  assert.deepEqual(await state(),before);
 });
 await t.test('actual personal order PATCH cancels full points/coupon/cash originals once with frozen per-line rules and no fabricated owner audit',async()=>{
  for(const method of ['points','on_site']){
   const f=await seed(method,x=>{x.offers[1].checkoutBinding.pointsReturnOnCancel=false;x.request.lines[0].couponClaims=[{couponId:x.coupons[0].id,claimEventId:x.coupons[0].claimEvents[0].id}];}),r=(await submit(f)).result;
   const response=await http(f,r);assert.equal(response.status,200,JSON.stringify(await response.clone().json()));const body=await response.json();assert.equal(body.order.status,'cancelled');assert.ok(!/operationKey|pointTransactionId|PRIVATE/.test(JSON.stringify(body)));
   const final=(await read(r,f)).cart;assert.equal(final.closed,true);assert.equal(final.cancellation.couponsReturned,1);assert.equal(final.cancellation.stockReleased,2);
   assert.equal(final.cancellation.pointsReturned,method==='points'?final.lines.filter(l=>l.returnPoints).reduce((s,l)=>s+l.points,0):0);
   assert.equal(await one(admin,'select * from faolla_checkout_design.merchant_cancellation_actors where site_id=$1 and operation_key=$2',[site,r.operationKey]),undefined);
   const before=await state();assert.equal((await http(f,r)).status,200);assert.deepEqual(await state(),before);
  }
 });
 await t.test('stale personal UI and recorded cash cannot trigger an unpaid cancellation or change any data',async()=>{
  const f=await seed('on_site'),r=(await submit(f)).result,before=await state();
  const stale=await http(f,r,a,x=>x,{expectedUpdatedAt:'2020-01-01T00:00:00Z'});assert.equal(stale.status,409);assert.equal((await stale.json()).error,'checkout_conflict');assert.deepEqual(await state(),before);
  await one(a,'select public.faolla_checkout_cart_collect_v1($1,$2,$3,$4,$5,$6)',[site,r.operationKey,'owner:synthetic-owner',r.resource.updatedAt,r.dueMinor,new Date(Date.now()+11000).toISOString()]);
  const paid=await state(),response=await http(f,r);assert.equal(response.status,409);assert.equal((await response.json()).error,'checkout_cancellation_requires_refund');assert.deepEqual(await state(),paid);
 });
 await t.test('two personal requests racing the same original return points/coupons/stock at most once',async()=>{
  const f=await seed(),r=(await submit(f)).result,responses=await Promise.all([http(f,r,a),http(f,r,b)]);assert.ok(responses.some(r=>r.status===200));assert.ok(responses.every(r=>[200,503].includes(r.status)));
  assert.equal((await read(r,f)).cart.closed,true);assert.equal((await admin.query('select * from faolla_checkout_design.bundle_cancellations where site_id=$1 and operation_key=$2',[site,r.operationKey])).rowCount,1);
  const members=(await one(admin,'select blocks from pages where merchant_id=$1 and slug=$2',[site,`__merchant_memberships__:${site}`])).blocks;assert.equal(members[0].pointBalance,1000);
  const before=await state();assert.equal((await http(f,r)).status,200);assert.deepEqual(await state(),before);
 });
 await t.test('personal/owner cancellation race records only the true winner and never overwrites attribution on replay',async()=>{
  const f=await seed(),r=(await submit(f)).result;
  const [personal,owner]=await Promise.all([http(f,r,a),one(b,'select public.faolla_checkout_cart_merchant_cancel_v1($1,$2,$3,$4,$5) result',[site,r.operationKey,'owner:synthetic-owner',r.resource.updatedAt,new Date(Date.now()+11000).toISOString()])]);
  assert.ok([200,503].includes(personal.status));assert.equal((await read(r,f)).cart.closed,true);
  const audit=await one(admin,'select * from faolla_checkout_design.merchant_cancellation_actors where site_id=$1 and operation_key=$2',[site,r.operationKey]);
  assert.equal(audit?.actor_key,owner.result.replayed?undefined:'owner:synthetic-owner');const before=await state();assert.equal((await http(f,r)).status,200);assert.deepEqual(await state(),before);
 });
 await t.test('lost personal HTTP response remains unknown; later original reread recovers without a second cancel',async()=>{
  const f=await seed(),r=(await submit(f)).result;let writes=0;
  const response=await http(f,r,a,d=>({...d,rpc:()=>async(name,args)=>{const out=await dispatch(a)(name,args);if(name==='faolla_member_checkout_cart_cancel_v1'){writes++;assert.equal(out.error,null);throw Error('synthetic lost response');}return out;}}));
  assert.equal(response.status,503);assert.equal((await response.json()).error,'checkout_unconfirmed');assert.equal((await read(r,f)).cart.closed,true);
  const before=await state();assert.equal((await http(f,r)).status,200);assert.equal(writes,1);assert.deepEqual(await state(),before);
 });
 await t.test('actual old HTTP cancellation failure rolls back original point/coupon/stock/order mutations together',async()=>{
  const f=await seed('points',x=>x.request.lines[0].couponClaims=[{couponId:x.coupons[0].id,claimEventId:x.coupons[0].claimEvents[0].id}]),r=(await submit(f)).result,before=await state();
  await temporary('test_personal_cart_cancel_fail','faolla_checkout_design.bundle_cancellations','before insert',"raise exception 'synthetic_personal_cancel_failure';",async()=>{
   const response=await http(f,r);assert.equal(response.status,503);assert.equal((await response.json()).error,'checkout_unconfirmed');assert.deepEqual(await state(),before);
  });
 });
 await t.test('private personal lookup rejects every API role/non-read-committed snapshot and leaves all prior SQL definitions unchanged',async()=>{
  const f=await seed(),r=(await submit(f)).result,before=await state();
  for(const role of ['anon','authenticated','service_role']){await a.query(`set role ${role}`);try{
   assert.equal((await one(a,"select has_function_privilege(current_user,'public.faolla_checkout_cart_personal_resource_link_v1(text,text,text)','EXECUTE') allowed")).allowed,false);await assert.rejects(read(r,f,a),/permission denied/);
  }finally{await a.query('reset role');}}
  await a.query('begin isolation level repeatable read');try{await assert.rejects(read(r,f,a),/checkout_unavailable/);}finally{await a.query('rollback');}
  assert.deepEqual(await state(),before);assert.deepEqual(await definitions(),beforeDefinitions);assert.deepEqual(await originals(),beforeOriginals);
  const fn=await one(admin,"select provolatile,prosecdef,proconfig from pg_proc where oid='public.faolla_checkout_cart_personal_resource_link_v1(text,text,text)'::regprocedure");
  assert.equal(fn.provolatile,'v');assert.equal(fn.prosecdef,false);assert.ok(fn.proconfig.includes('search_path=pg_catalog'));
 });
}
