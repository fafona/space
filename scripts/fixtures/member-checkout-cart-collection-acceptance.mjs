// Actual private PostgreSQL receipts and HTTP/report adapters; only synthetic
// identities/service metadata, in the existing owned TEMP cluster.
import assert from 'node:assert/strict';
import http from '../../src/lib/merchantCheckoutCartCollection.server.ts';
import dto from '../../src/lib/merchantCheckoutCartResult.ts';
import report from '../../src/lib/merchantCheckoutReporting.ts';
import boundary from '../../src/lib/merchantCheckoutLegacyBoundary.server.ts';
import orders from '../../src/lib/merchantOrders.ts';
export async function cartCollectionAcceptance(p){
 const {t,admin,a,b,site,one,seed,submit,cancel,all,temporary,definitions,beforeDefinitions}=p;
 const owner={type:'owner',siteId:site,authUserId:'synthetic-owner',principalKey:'owner:synthetic-owner',authorizationVersion:'owner',authorizationSource:'database',businessPermissions:[],collaborationPermissions:[],displayName:'Synthetic',email:'owner@synthetic.invalid'};
 const originalSingles=async()=>(await admin.query("select oid::regprocedure::text name,pg_get_functiondef(oid) definition from pg_proc where oid in ('public.faolla_checkout_on_site_collect_v1(text,text,text,text,bigint,timestamptz)'::regprocedure,'faolla_checkout_design.guard_on_site_collection()'::regprocedure) order by name")).rows;
 const singles=await originalSingles();
 const state=async()=>({...await all(),actors:(await admin.query('select * from faolla_checkout_design.merchant_cancellation_actors order by site_id,operation_key')).rows});
 const read=(r,c=admin)=>(one(c,'select public.faolla_checkout_cart_collection_read_v1($1,$2) result',[site,r.operationKey])).then(x=>dto.parseCartCheckoutResult(x.result,r));
 const collect=(r,c=a,actor=owner.principalKey,until=new Date(Date.now()+11000).toISOString(),amount=r.dueMinor,stamp=r.resource.updatedAt)=>one(c,'select public.faolla_checkout_cart_collect_v1($1,$2,$3,$4,$5,$6) result',[site,r.operationKey,actor,stamp,amount,until]).then(x=>x.result);
 const call=c=>async(name,args)=>{
  const keys={faolla_checkout_cart_collection_read_v1:['p_site_id','p_operation_key'],faolla_checkout_cart_collect_v1:['p_site_id','p_operation_key','p_actor_key','p_expected_updated_at','p_expected_due_minor','p_not_after']}[name];assert.ok(keys);
  try{return{data:(await one(c,`select public.${name}(${keys.map((_,i)=>`$${i+1}`).join(',')}) result`,keys.map(k=>args[k]))).result,error:null};}catch(error){return{data:null,error:{message:error.message}};}
 };
 const request=r=>new Request('https://cart-collection.synthetic.invalid/api/merchant-checkout/cart/collect',{method:'POST',headers:{origin:'https://cart-collection.synthetic.invalid','content-type':'application/json'},body:JSON.stringify({siteId:site,operationKey:r.operationKey,expectedUpdatedAt:r.resource.updatedAt,expectedDueMinor:r.dueMinor,received:true})});
 const deps=(f,c=a)=>({enabled:()=>true,actor:async()=>owner,site:async()=>f.site,call:call(c)});
 await t.test('cart receipt database enrollment defaults closed, including a direct private insert',async()=>{
  const f=await seed('on_site'),r=(await submit(f)).result,before=await state();
  await assert.rejects(collect(r),/checkout_disabled/);await assert.rejects(a.query('insert into faolla_checkout_design.cart_collections(site_id,operation_key,amount_minor,currency,actor_key) values($1,$2,$3,\'eur\',$4)',[site,r.operationKey,r.dueMinor,owner.principalKey]),/checkout_disabled/);assert.deepEqual(await state(),before);
  await admin.query('insert into faolla_checkout_design.cart_collection_pilots(site_id,enabled) values($1,true)',[site]);
 });
 await t.test('actual owner HTTP records one whole original amount without changing business/member/coupon/stock data; both projections and export show it',async()=>{
  const f=await seed('on_site',f=>f.request.lines[0].couponClaims=[{couponId:f.coupons[0].id,claimEventId:f.coupons[0].claimEvents[0].id}]),r=(await submit(f)).result,before=await state();
  const response=await http.handleCartCollection(request(r),deps(f));assert.equal(response.status,200,JSON.stringify(await response.clone().json()));const receipt=(await response.json()).receipt;
  assert.equal(receipt.amountMinor,2300);assert.equal(receipt.replayed,false);assert.ok(!/actor|principal|memberId|example.invalid/.test(JSON.stringify(receipt)));
  const after=await state();for(const key of Object.keys(before).filter(k=>k!=='cartCollections'))assert.deepEqual(after[key],before[key],key);
  const current=await read(r);assert.equal(current.resource.status,'pending');assert.equal(current.capturedMinor,0);assert.equal(current.collection.amountMinor,2300);assert.equal(current.cancellationAvailable,false);assert.equal(current.reviewRequired,false);
  const resources=[{kind:'order',id:r.resourceId}],snapshot=report.parseCheckoutReportingSnapshot((await one(admin,'select public.faolla_member_checkout_reporting_v3($1,$2) result',[site,JSON.stringify(resources)])).result,{siteId:site,resources});assert.equal(snapshot.rows[0].cart.collection.amountMinor,2300);
  const personal=(await one(admin,'select public.faolla_member_checkout_original_resource_v2($1,$2,$3,$4) result',[site,'order',r.resourceId,`account:${f.principal.accountId}:${f.principal.userId}`])).result;assert.equal(personal.result.collection.amountMinor,2300);
  assert.ok(report.checkoutReportingTsv(snapshot).includes('2300'));const stable=await state();assert.equal((await (await http.handleCartCollection(request(r),deps(f))).json()).receipt.replayed,true);assert.deepEqual(await state(),stable);
 });
 await t.test('concurrent owners append one immutable original receipt; later replay never replaces first attribution',async()=>{
  const f=await seed('on_site'),r=(await submit(f)).result,replies=await Promise.all([collect(r,a,'owner:synthetic-owner-a'),collect(r,b,'owner:synthetic-owner-b')]);assert.deepEqual(replies.map(r=>r.replayed).sort(),[false,true]);
  const row=await one(admin,'select * from faolla_checkout_design.cart_collections where site_id=$1 and operation_key=$2',[site,r.operationKey]);assert.ok(['owner:synthetic-owner-a','owner:synthetic-owner-b'].includes(row.actor_key));
  const before=await state();assert.equal((await collect(r,b,'owner:synthetic-later')).replayed,true);assert.deepEqual(await state(),before);
  await assert.rejects(admin.query('update faolla_checkout_design.cart_collections set amount_minor=1 where site_id=$1 and operation_key=$2',[site,r.operationKey]),/immutable/);
  await assert.rejects(admin.query('delete from faolla_checkout_design.cart_collections where site_id=$1 and operation_key=$2',[site,r.operationKey]),/immutable/);
 });
 await t.test('collection/cancellation race has exactly one winner, with no double interpretation or partial financial return',async()=>{
  const f=await seed('on_site'),r=(await submit(f)).result,attempts=await Promise.allSettled([collect(r,a),cancel(f,b)]);assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
  const current=await read(r);assert.equal(Boolean(current.collection),!current.closed);assert.equal(current.reviewRequired,false);
  const g=await seed('on_site'),paid=(await submit(g)).result;await collect(paid);
  const before=await state();await assert.rejects(cancel(g),/checkout_refund_required/);
  await assert.rejects(one(a,'select public.faolla_checkout_cart_merchant_cancel_v1($1,$2,$3,$4,$5)',[site,paid.operationKey,owner.principalKey,paid.resource.updatedAt,new Date(Date.now()+11000).toISOString()]),/checkout_refund_required/);
  await assert.rejects(admin.query('insert into faolla_checkout_design.bundle_cancellations(site_id,operation_key,principal_key,receipt) select site_id,operation_key,principal_key,\'{}\'::jsonb from faolla_checkout_design.bundle_results where site_id=$1 and operation_key=$2',[site,paid.operationKey]),/checkout_refund_required/);
  assert.deepEqual(await state(),before);
 });
 await t.test('post-insert failure, delayed trigger and lock timeout roll back the receipt and leave every original byte unchanged',async()=>{
  const f=await seed('on_site'),r=(await submit(f)).result,before=await state();
  await temporary('test_cart_collect_fail','faolla_checkout_design.cart_collections','after insert',"raise exception 'synthetic_receipt_failure';",async()=>{await assert.rejects(collect(r),/synthetic_receipt_failure/);assert.deepEqual(await state(),before);});
  await temporary('test_cart_collect_delay','faolla_checkout_design.cart_collections','after insert','perform pg_sleep(0.65);',async()=>{await assert.rejects(collect(r,a,owner.principalKey,new Date(Date.now()+450).toISOString()),/checkout_conflict/);assert.deepEqual(await state(),before);});
  await a.query('begin');await a.query("select pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||$1,0))",[site]);const pending=collect(r,b,owner.principalKey,new Date(Date.now()+450).toISOString());pending.catch(()=>{});
  try{let blocked=false;const until=Date.now()+1500;while(Date.now()<until){blocked=(await one(admin,"select wait_event='advisory' blocked from pg_stat_activity where pid=$1",[b.processID]))?.blocked;if(blocked)break;await new Promise(r=>setTimeout(r,10));}assert.equal(blocked,true);await admin.query('select pg_sleep(0.6)');}finally{await a.query('rollback');}
  await assert.rejects(pending,/checkout_conflict/);assert.deepEqual(await state(),before);
 });
 await t.test('points, zero-cash coupon cover, cancelled and stale/changed amount/version originals cannot be collected',async()=>{
  const f=await seed(),points=(await submit(f)).result;await assert.rejects(collect(points,a,owner.principalKey,undefined,1),/checkout_collection_not_allowed/);
  const z=await seed('on_site',f=>{f.coupons[0].discountValue=10;f.request.lines[0].couponClaims=[{couponId:f.coupons[0].id,claimEventId:f.coupons[0].claimEvents[0].id}];},1),covered=(await submit(z)).result;assert.equal(covered.dueMinor,0);await assert.rejects(collect(covered),/checkout_collection_not_allowed/);
  const g=await seed('on_site'),r=(await submit(g)).result,before=await state();await assert.rejects(collect(r,a,owner.principalKey,undefined,r.dueMinor+1),/checkout_collection_not_allowed/);await assert.rejects(collect(r,a,owner.principalKey,undefined,r.dueMinor,'2000-01-01T00:00:00Z'),/checkout_conflict/);assert.deepEqual(await state(),before);
  await cancel(g);const cancelled=await state();await assert.rejects(collect(r),/checkout_collection_review_required/);assert.deepEqual(await state(),cancelled);
 });
 await t.test('a lost HTTP write result is unknown; explicit original reread recovers without a second receipt',async()=>{
  const f=await seed('on_site'),r=(await submit(f)).result,d=deps(f),original=d.call;let writes=0;
  d.call=async(...args)=>{const out=await original(...args);if(args[0]==='faolla_checkout_cart_collect_v1'){writes++;assert.equal(out.error,null);throw Error('lost');}return out;};
  const unknown=await http.handleCartCollection(request(r),d);assert.equal(unknown.status,503);assert.equal((await unknown.json()).error,'checkout_unconfirmed');const before=await state();
  d.call=original;const recovered=await http.handleCartCollection(request(r),d);assert.equal(recovered.status,200);assert.equal((await recovered.json()).receipt.replayed,true);assert.equal(writes,1);assert.deepEqual(await state(),before);
 });
 await t.test('business completion after receipt uses original CAS without adding benefits or hiding the recorded amount',async()=>{
  const f=await seed('on_site'),r=(await submit(f)).result;await collect(r);const before=await state(),source=(await admin.query("select * from pages where merchant_id=$1 and slug~'^__merchant_orders__:'",[site])).rows;
  const records=orders.normalizeMerchantOrderRecords(source.flatMap(r=>r.blocks)),previous=records.find(o=>o.id===r.resourceId),next={...previous,status:'completed',updatedAt:new Date().toISOString(),completedAt:new Date().toISOString()};
  const d={enabled:()=>true,cartEnabled:()=>true,rpc:()=>async(name,args)=>{assert.equal(name,'faolla_member_checkout_reporting_v3');return{data:(await one(admin,'select public.faolla_member_checkout_reporting_v3($1,$2) result',[site,JSON.stringify(args.p_resources)])).result,error:null};}};
  assert.deepEqual(await boundary.legacyCheckoutPointTransitions([{previous,next}],d),[]);
  const client={rpc:async(name,args)=>{assert.equal(name,'faolla_commit_order_membership_v1');return{data:(await one(a,'select public.faolla_commit_order_membership_v1($1,$2) result',[site,args.p_mutation])).result,error:null};}};
  assert.equal((await boundary.saveCheckoutAwareMerchantOrders(client,{siteId:site,orders:records.map(o=>o.id===r.resourceId?next:o),expectedRows:source},d)).error,null);
  const current=await read(r);assert.equal(current.resource.status,'completed');assert.equal(current.collection.amountMinor,r.dueMinor);assert.equal(current.capturedMinor,0);
  const after=await state();for(const key of ['operations','receipts','returns','collections','cartCollections','cancellations','actors'])assert.deepEqual(after[key],before[key],key);
  assert.deepEqual(after.pages.filter(p=>!p.slug.startsWith('__merchant_orders')),before.pages.filter(p=>!p.slug.startsWith('__merchant_orders')));
 });
 await t.test('every API role is denied; owner grammar/read committed are mandatory and original single functions remain unchanged',async()=>{
  const f=await seed('on_site'),r=(await submit(f)).result,before=await state();
  for(const role of ['anon','authenticated','service_role']){await a.query(`set role ${role}`);try{await assert.rejects(collect(r,a),/permission denied/);await assert.rejects(read(r,a),/permission denied/);
   await assert.rejects(a.query('select * from faolla_checkout_design.cart_collections'),/permission denied/);}finally{await a.query('reset role');}}
  await assert.rejects(collect(r,a,'employee:synthetic-employee'),/checkout_unauthorized/);await a.query('begin isolation level repeatable read');try{await assert.rejects(collect(r,a),/checkout_unavailable/);}finally{await a.query('rollback');}
  assert.deepEqual(await state(),before);assert.deepEqual(await definitions(),beforeDefinitions);assert.deepEqual(await originalSingles(),singles);
 });
}
