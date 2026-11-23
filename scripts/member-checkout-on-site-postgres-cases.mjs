// Extra PRIVATE-kernel cases in the existing owned TEMP PostgreSQL harness.
// No HTTP/Next.js/permission/source adapter for cash is claimed by these tests.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import terms from '../src/lib/merchantCheckoutOnSitePending.server.ts';
import coupons from '../src/lib/merchantCoupons.ts';
import membership from '../src/lib/merchantMemberships.ts';
import settings from '../src/lib/merchantMembershipSettings.ts';
import pointResult from '../src/lib/merchantMemberCheckoutResult.ts';

export async function onSitePendingPostgresCases(t,ctx){
 const {admin,a,b,one,accountId,userId,principal,op,submissionFixture,submitSnapshot,bookingSlug,connect}=ctx;
 await admin.query(await readFile(new URL('../database/proposals/20261123_member_checkout_on_site_pending.sql',import.meta.url),'utf8'));
 // A DIFFERENT synthetic merchant keeps the existing 50 cases and ALL their
 // evidence intact, without repeatedly growing the same old history chain.
 const site='10909998',memberSlug=`__merchant_memberships__:${site}`,settingsSlug=`__merchant_membership_settings__:${site}`,couponSlug=`__merchant_coupons__:${site}`,stamp=new Date().toISOString();
 const member=membership.normalizeMerchantMembershipRecord({id:'cash-member-synthetic',siteId:site,accountId,userId,status:'active',pointBalance:1000,balanceAmount:0,growthValue:0,joinedAt:stamp,updatedAt:stamp});assert.ok(member);
 for(const [slug,blocks]of [[memberSlug,[member]],[settingsSlug,settings.createEmptyMerchantMembershipSettings(site)],[couponSlug,[]]])
  await admin.query('insert into pages(merchant_id,slug,blocks) values($1,$2,$3)',[site,slug,JSON.stringify(blocks)]);
 await admin.query('insert into faolla_checkout_design.bundle_pilots(site_id,enabled) values($1,true)',[site]);
 // Previous cases accumulate large immutable history documents. Hash EVERY
 // original row server-side, including histories/audits/control; only transfer
 // the few current documents needed for field assertions. No evidence/row is
 // deleted and no timeout/assertion is removed to make this test fit.
 const tables=['public.pages','public.faolla_booking_atomic_commands','public.faolla_booking_atomic_control','public.faolla_redemption_operations',
  'faolla_checkout_design.bundle_results','faolla_checkout_design.bundle_cancellations','faolla_checkout_design.bundle_coupon_returns',
  'faolla_checkout_design.merchant_cancellation_actors','faolla_checkout_design.offer_heads','faolla_checkout_design.offer_versions','faolla_checkout_design.bundle_pilots'];
 const fingerprintSql=`select jsonb_build_object(${tables.map(table=>`'${table}',(select encode(sha256(convert_to(coalesce(string_agg(h,'' order by h),''),'UTF8')),'hex') from (select encode(sha256(convert_to(row_to_json(r)::text,'UTF8')),'hex') as h from ${table} r) x)`).join(',')}) as fingerprint`;
 const all=async()=>({fingerprint:(await one(admin,fingerprintSql)).fingerprint,
  pages:(await admin.query('select * from pages where slug=any($1::text[]) order by slug,id',[[memberSlug,settingsSlug,couponSlug,bookingSlug]])).rows,
  results:(await admin.query('select operation_key from faolla_checkout_design.bundle_results order by operation_key')).rows,
  operations:(await admin.query('select operation_id from faolla_redemption_operations order by operation_id')).rows});
 const fixture=async({kind='booking',withCoupon=true,stock=2,covered=false}={})=>{
  // Reuse ONLY synthetic authoritative offer/source/resource construction from
  // the existing point fixture; do not call its commit or reuse its finances.
  const original=await submissionFixture({kind,withCoupon:false,stock,testSite:site}),prepared=await submitSnapshot(original);
  let selected=[];
  if(withCoupon){
   const current=await one(admin,'select blocks,to_jsonb(updated_at) as stamp from pages where slug=$1',[couponSlug]);
   const coupon=coupons.normalizeMerchantCouponRecord({id:`cash-coupon-${randomUUID()}`,siteId:site,code:`CA${randomUUID().replaceAll('-','').slice(0,16)}`,title:'Synthetic cash coupon',status:'active',
    discountType:'amount_off',discountValue:covered?10:2,usageScenarios:['order_cart'],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
    claimEvents:[{id:`cash-claim-${randomUUID()}`,at:new Date().toISOString(),accountId,userId,email:'synthetic@example.invalid',customerName:'Synthetic',code:'',settlementType:'qr',settlementCode:`PRIVATE-CASH-${randomUUID()}`,validUntil:null}]});assert.ok(coupon);
   await admin.query('select public.faolla_commit_redemption_v1($1,$2)',[site,{coupons:{expectedUpdatedAt:current.stamp,next:[coupon,...current.blocks]}}]);
   selected=[{couponId:coupon.id,claimEventId:coupon.claimEvents[0].id}];
  }
  const member=await one(admin,'select blocks,to_jsonb(updated_at) as stamp from pages where slug=$1',[memberSlug]),couponRow=await one(admin,'select blocks,to_jsonb(updated_at) as stamp from pages where slug=$1',[couponSlug]);
  const payment=terms.prepareOnSitePendingTerms({siteId:site,offer:original.offer,selection:{...prepared.identity.request.selection,couponClaims:selected},
   principal:{accountId,userId},membership:member.blocks[0],coupons:couponRow.blocks,tags:[],now:new Date().toISOString(),resourceId:prepared.plan.receipt.resourceId});
  const resource=structuredClone(prepared.plan[kind]);
  if(kind==='order'){
   resource.record.items[0]={...resource.record.items[0],unitPrice:10,unitPriceText:'€10.00',subtotal:10};resource.record.totalAmount=10;
  }
  const plan={offer:payment.offer,quantity:payment.quantity,membership:{id:payment.membershipId,expectedUpdatedAt:member.stamp},settingsVersion:prepared.plan.settingsVersion,
   [kind]:resource,receipt:payment.receipt,...(selected.length?{coupons:{expectedUpdatedAt:couponRow.stamp,claims:selected}}:{})};
  return{original,prepared,plan,key:prepared.identity.operationKey,hash:op(),notAfter:new Date(Date.now()+25000).toISOString()};
 };
 const commit=async(f,client=a)=>(await one(client,'select faolla_checkout_design.commit_on_site_pending($1,$2,$3,$4,$5,$6) as result',[site,f.key,principal,f.hash,f.plan,f.notAfter])).result;
 const page=(state,slug)=>state.pages.find(row=>row.slug===slug);
 await t.test('private on-site booking and order save due amounts, preserve member bytes and never create paid/point receipts',async()=>{
  for(const kind of ['booking','order']){
   const f=await fixture({kind,withCoupon:false}),before=await all(),result=await commit(f),after=await all();
   assert.equal(result.replayed,false);assert.equal(result.receipt.dueMinor,1000);assert.equal(result.receipt.capturedMinor,0);assert.equal(result.receipt.totalPoints,null);
   assert.equal(result.receipt.paymentState,'unpaid');assert.equal(result.receipt.cancellationPolicy.returnPoints,false);
   assert.deepEqual(page(after,memberSlug),page(before,memberSlug));assert.deepEqual(after.operations,before.operations);
   assert.equal(page(after,settingsSlug).blocks.redemptionItems[0].stock,1);assert.deepEqual(page(after,couponSlug),page(before,couponSlug));
   assert.ok(!/PRIVATE|membershipId|couponUses/.test(JSON.stringify(terms.parseOnSitePendingReceipt(result.receipt))));
   const pointView=(await one(admin,'select public.faolla_member_checkout_result_v2($1,$2,$3) as result',[site,f.key,principal])).result;
   assert.throws(()=>pointResult.parseMemberCheckoutResult(pointView,{siteId:site,operationKey:f.key}),/checkout_invalid_response/);
  }
 });
 await t.test('two real connections with the same cash nonce consume one coupon/stock and create one original resource',async()=>{
  const f=await fixture(),before=await all(),results=await Promise.all([commit(f,a),commit(f,b)]),after=await all();
  assert.deepEqual(results.map(r=>r.replayed).sort(),[false,true]);assert.deepEqual(results[0].receipt,results[1].receipt);
  assert.equal(results[0].receipt.discountMinor,200);assert.equal(results[0].receipt.dueMinor,800);assert.equal(results[0].receipt.capturedMinor,0);
  assert.deepEqual(page(after,memberSlug),page(before,memberSlug));assert.deepEqual(after.operations,before.operations);assert.equal(after.results.length,before.results.length+1);
  const row=page(after,couponSlug).blocks.find(c=>c.id===f.plan.coupons.claims[0].couponId);assert.equal(row.usedCount,1);assert.equal(row.redeemEvents.length,1);
  assert.equal(page(after,bookingSlug).blocks.records.filter(r=>r.id===f.plan.receipt.resourceId).length,1);
  const saved=await all();await admin.query('update faolla_checkout_design.offer_heads set enabled=false where site_id=$1 and offer_id=$2',[site,f.plan.offer.id]);
  const disabled=await all();assert.equal((await commit(f)).replayed,true);assert.deepEqual(await all(),disabled);assert.equal(saved.results.length,disabled.results.length);
 });
 await t.test('fully coupon-covered cash checkout has zero captured money and no debit, gift or expiry transaction',async()=>{
  const f=await fixture({covered:true}),before=await all(),result=await commit(f),after=await all();
  assert.equal(result.receipt.paymentState,'coupon_covered');assert.equal(result.receipt.dueMinor,0);assert.equal(result.receipt.capturedMinor,0);
  assert.equal(result.receipt.totalPoints,null);assert.deepEqual(page(after,memberSlug),page(before,memberSlug));assert.deepEqual(after.operations,before.operations);
 });
 await t.test('unlimited stock without coupons changes no settings, coupons or membership document',async()=>{
  const f=await fixture({kind:'order',withCoupon:false,stock:null}),before=await all();await commit(f);const after=await all();
  for(const slug of [memberSlug,settingsSlug,couponSlug])assert.deepEqual(page(after,slug),page(before,slug));
  assert.deepEqual(after.operations,before.operations);assert.equal(after.results.length,before.results.length+1);
 });
 await t.test('cash orders competing for one finite stock cannot both create a pending order',async()=>{
  const first=await fixture({kind:'order',withCoupon:false,stock:1}),second={...first,key:op(),hash:op(),plan:structuredClone(first.plan)};
  second.plan.order.record.id=`synthetic-cash-${randomUUID()}`;second.plan.receipt.resourceId=second.plan.order.record.id;
  const outcomes=await Promise.allSettled([commit(first,a),commit(second,b)]);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  assert.match(outcomes.find(r=>r.status==='rejected').reason.message,/checkout_conflict|checkout_quantity_unavailable/);
  const before=await all();assert.equal(page(before,settingsSlug).blocks.redemptionItems[0].stock,0);
  second.key=op();second.plan.settingsVersion=(await one(admin,'select to_jsonb(updated_at) as stamp from pages where slug=$1',[settingsSlug])).stamp;
  await assert.rejects(commit(second),/checkout_quantity_unavailable/);assert.deepEqual(await all(),before);
 });
 await t.test('a shared original key cannot switch from cash to points or points to cash and debit again',async()=>{
  const cash=await fixture({withCoupon:false});await commit(cash);let before=await all();
  await assert.rejects(one(admin,'select faolla_checkout_design.commit_bundle($1,$2,$3,$4,$5)',[site,cash.key,principal,cash.prepared.identity.requestHash,cash.prepared.plan]),/checkout_operation_conflict/);assert.deepEqual(await all(),before);
  const point=await fixture({withCoupon:false});await one(admin,'select public.faolla_member_checkout_submission_commit_v2($1,$2,$3,$4,$5,$6,$7)',
   [site,point.key,principal,point.prepared.identity.requestHash,point.prepared.snapshot,point.prepared.plan,point.prepared.notAfter]);before=await all();
  await assert.rejects(commit(point),/checkout_operation_conflict/);assert.deepEqual(await all(),before);
 });
 await t.test('cash terms reject captured amounts, point balances, inconsistent totals/discounts and expired commit deadlines',async()=>{
  const f=await fixture({withCoupon:false});
  for(const mutate of [p=>p.receipt.capturedMinor=1,p=>p.receipt.totalPoints=0,p=>p.receipt.grossMinor=999,
   p=>p.receipt.dueMinor=0,p=>p.membership.transactions=[],p=>p.quantity=2,p=>p.receipt.discountMinor=1]){
   const changed={...f,plan:structuredClone(f.plan)};mutate(changed.plan);const before=await all();await assert.rejects(commit(changed));assert.deepEqual(await all(),before);
  }
  for(const deadline of [new Date(Date.now()-1).toISOString(),new Date(Date.now()+60000).toISOString()]){
   const before=await all();await assert.rejects(commit({...f,notAfter:deadline}),/checkout_quote_expired/);assert.deepEqual(await all(),before);
  }
 });
 await t.test('late original order failure rolls back already prepared cash coupon/stock/history writes',async()=>{
  const f=await fixture({kind:'order'});f.plan.order.expectedVersions=[];const before=await all();
  await assert.rejects(commit(f),/checkout_conflict/);assert.deepEqual(await all(),before);
 });
 await t.test('late original booking failure rolls back all cash facts without compensation',async()=>{
  const f=await fixture(),before=await all();
  // Force an actual original writer failure after coupon/stock preparation.
  await admin.query(`create function public.synthetic_cash_storage_failure() returns trigger language plpgsql as $$begin
   if new.slug='${bookingSlug}' then raise exception 'synthetic_cash_storage_failure';end if;return new;end;$$;
   create trigger synthetic_cash_storage_failure before update on pages for each row execute function public.synthetic_cash_storage_failure();`);
  try{await assert.rejects(commit(f),/synthetic_cash_storage_failure/);assert.deepEqual(await all(),before);}
  finally{await admin.query('drop trigger synthetic_cash_storage_failure on pages;drop function public.synthetic_cash_storage_failure()');}
 });
 await t.test('stale member, settings and coupon snapshots fail atomically against actual legacy writers',async()=>{
  for(const mode of ['member','settings','coupon']){
   const f=await fixture(),slug=mode==='member'?memberSlug:mode==='settings'?settingsSlug:couponSlug,current=await one(admin,'select blocks,to_jsonb(updated_at) as stamp from pages where slug=$1',[slug]);
   const next=structuredClone(current.blocks);
   if(mode==='member')next[0].status='left';else if(mode==='settings')next.redemptionItems[0].stock=0;else next[0].status='paused';
   await admin.query(mode==='member'?'select public.faolla_commit_order_membership_v1($1,$2)':'select public.faolla_commit_redemption_v1($1,$2)',[site,{[mode==='member'?'memberships':mode==='settings'?'settings':'coupons']:{expectedUpdatedAt:current.stamp,next}}]);
   const before=await all();await assert.rejects(commit(f),/checkout_conflict/);assert.deepEqual(await all(),before);
  }
 });
 await t.test('used coupon is rejected even with the refreshed physical CAS version',async()=>{
  const f=await fixture(),current=await one(admin,'select blocks,to_jsonb(updated_at) as stamp from pages where slug=$1',[couponSlug]),next=structuredClone(current.blocks),row=next.find(c=>c.id===f.plan.coupons.claims[0].couponId),claim=row.claimEvents[0];
  row.redeemEvents=[{id:randomUUID(),at:new Date().toISOString(),claimEventId:claim.id,settlementCode:claim.settlementCode,accountId,userId,operatorId:'synthetic-merchant',note:''}];row.usedCount=1;
  await admin.query('select public.faolla_commit_redemption_v1($1,$2)',[site,{coupons:{expectedUpdatedAt:current.stamp,next}}]);
  f.plan.coupons.expectedUpdatedAt=(await one(admin,'select to_jsonb(updated_at) as stamp from pages where slug=$1',[couponSlug])).stamp;
  const before=await all();await assert.rejects(commit(f),/checkout_coupon_unavailable/);assert.deepEqual(await all(),before);
 });
 await t.test('claim expiry reached inside the original writer rolls back the coupon, pending resource and stock',async()=>{
  const f=await fixture(),row=await one(admin,'select blocks,to_jsonb(updated_at) as stamp from pages where slug=$1',[couponSlug]),next=structuredClone(row.blocks);
  const expiry=new Date(Date.now()+3000).toISOString();
  next.find(c=>c.id===f.plan.coupons.claims[0].couponId).claimEvents[0].validUntil=expiry;
  await admin.query('select public.faolla_commit_redemption_v1($1,$2)',[site,{coupons:{expectedUpdatedAt:row.stamp,next}}]);
  f.plan.coupons.expectedUpdatedAt=(await one(admin,'select to_jsonb(updated_at) as stamp from pages where slug=$1',[couponSlug])).stamp;
  const before=await all();
  await admin.query(`create function public.synthetic_cash_expiry_wait() returns trigger language plpgsql as $$begin
   if new.slug='${bookingSlug}' then perform pg_sleep(greatest(0,extract(epoch from ('${expiry}'::timestamptz-clock_timestamp())))+0.05);end if;return new;end;$$;
   create trigger synthetic_cash_expiry_wait before update on pages for each row execute function public.synthetic_cash_expiry_wait();`);
  try{await assert.rejects(commit(f),/checkout_quote_expired/);assert.deepEqual(await all(),before);}
  finally{await admin.query('drop trigger synthetic_cash_expiry_wait on pages;drop function public.synthetic_cash_expiry_wait()');}
 });
 await t.test('cash deadline is checked after the real original member lock wait, not just before waiting',async()=>{
  const f=await fixture();f.notAfter=new Date(Date.now()+1200).toISOString();const before=await all();await a.query('begin');let pending;
  try{
   await a.query("select pg_advisory_xact_lock(hashtextextended('faolla-order-membership:'||$1,0))",[site]);pending=commit(f,b).then(value=>({value}),error=>({error}));
   let waiting=false;for(let i=0;i<200;i++){waiting=(await one(admin,"select wait_event_type='Lock' and wait_event='advisory' as waiting from pg_stat_activity where pid=$1",[b.processID]))?.waiting===true;if(waiting)break;await new Promise(resolve=>setTimeout(resolve,5));}
   assert.equal(waiting,true);await admin.query('select pg_sleep(greatest(0,extract(epoch from ($1::timestamptz-clock_timestamp())))+0.05)',[f.notAfter]);await a.query('commit');
   const outcome=await pending;assert.match(outcome.error?.message??'',/checkout_quote_expired/);assert.deepEqual(await all(),before);
  }catch(error){await a.query('rollback');if(pending)await pending;throw error;}
 });
 await t.test('deferred existing guard protects cash resources; points-only cancellation refuses cash without any writes',async()=>{
  const f=await fixture(),saved=await commit(f),before=await all(),pageRow=page(before,bookingSlug),next=structuredClone(pageRow.blocks);
  next.records.find(r=>r.id===f.plan.receipt.resourceId).item='tampered';
  await assert.rejects(admin.query('update pages set blocks=$2 where id=$1',[pageRow.id,JSON.stringify(next)]),/booking_atomic_legacy_writer_fenced/);assert.deepEqual(await all(),before);
  const state=await one(admin,'select generation,revision::text from faolla_booking_atomic_control where singleton'),rows=(await one(admin,'select public.faolla_booking_atomic_rows_v1() as rows')).rows;
  await assert.rejects(admin.query('select public.faolla_booking_atomic_commit_v1($1,$2,$3,$4)',[site,op(),op(),{...state,rows,next,result:{syntheticCashGuard:true},mailJobs:[]}]),/checkout_change_requires_review/);assert.deepEqual(await all(),before);
  await assert.rejects(one(admin,'select faolla_checkout_design.cancel_bundle($1,$2,$3,$4)',[site,f.key,principal,f.plan.booking.record.updatedAt]),/checkout_cancellation_review_required/);assert.deepEqual(await all(),before);
  assert.equal(saved.receipt.capturedMinor,0);
 });
 await t.test('all application roles are denied the private cash kernel',async()=>{
  for(const role of ['anon','authenticated','service_role']){
   const client=await connect(role);
   await assert.rejects(client.query('select faolla_checkout_design.commit_on_site_pending($1,$2,$3,$4,$5,$6)',[site,op(),principal,op(),{},new Date().toISOString()]),/permission denied/);
  }
 });
}
