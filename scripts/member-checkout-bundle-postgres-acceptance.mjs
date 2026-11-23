// Real multi-connection PostgreSQL, NEW synthetic TEMP cluster only.
// Reuses the repository's already-installed pinned booking-test runtime.
// No app .env, remote URL, production rows or real email/provider calls.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,mkdtemp} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import net from 'node:net';
import {randomUUID,createHash} from 'node:crypto';
import membership from '../src/lib/merchantMemberships.ts';
import settings from '../src/lib/merchantMembershipSettings.ts';
import coupons from '../src/lib/merchantCoupons.ts';
import configurationStore from '../src/lib/merchantCheckoutConfigurationStore.server.ts';
import memberPoints from '../src/lib/merchantMemberships.server.ts';
import resultStore from '../src/lib/merchantMemberCheckoutResult.server.ts';
import resultRoute from '../src/app/api/member-checkout/result/route-handler.ts';
import submissionPlan from '../src/lib/merchantCheckoutSubmissionPlan.server.ts';
import submission from '../src/lib/merchantCheckoutSubmission.server.ts';
import submitRoute from '../src/app/api/member-checkout/submit/route-handler.ts';
import recoverRoute from '../src/app/api/member-checkout/recover/route-handler.ts';
import previewRoute from '../src/app/api/member-checkout/preview/route-handler.ts';
import checkoutClient from '../src/lib/merchantCheckoutClient.ts';
import reportingStore from '../src/lib/merchantCheckoutReporting.server.ts';
import reporting from '../src/lib/merchantCheckoutReporting.ts';
import reportingRoute from '../src/app/api/merchant-checkout/settlements/route-handler.ts';
import legacyBoundary from '../src/lib/merchantCheckoutLegacyBoundary.server.ts';
import resourceRoute from '../src/app/api/member-checkout/resource/route-handler.ts';
import entryRoute from '../src/app/api/member-checkout/entry/route-handler.ts';
import entryStore from '../src/lib/merchantCheckoutEntry.server.ts';
import legacyOrderRoute from '../src/app/api/orders/route-handler.ts';
import legacyOrders from '../src/lib/merchantOrders.server.ts';
import orderRecords from '../src/lib/merchantOrders.ts';
import checkoutSources from '../src/lib/merchantCheckoutSources.server.ts';
import bookingRules from '../src/lib/merchantBookingRules.ts';
import workbench from '../src/lib/merchantBookingWorkbench.ts';
import bookingTime from '../src/lib/merchantBookingTime.ts';
import platformSnapshot from '../src/lib/platformMerchantSnapshot.ts';
import platformControl from '../src/data/platformControlStore.ts';
import {onSitePendingPostgresCases} from './member-checkout-on-site-postgres-cases.mjs';

test('private composite proposal uses actual legacy PostgreSQL transactions, never separate financial commits',{timeout:120000},async t=>{
 const runtime=path.resolve(process.env.FAOLLA_BOOKING_TEST_RUNTIME_DIR||'.missing-test-runtime');
 const relative=path.relative(tmpdir(),runtime);
 assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(runtime).startsWith('faolla-booking-pg-'));
 const requireTest=createRequire(path.join(runtime,'test-loader.cjs'));
 const pgRoot=path.join(runtime,'node_modules/@embedded-postgres/windows-x64');
 assert.equal(JSON.parse(await readFile(path.join(pgRoot,'package.json'),'utf8')).version,'17.10.0-beta.17');
 assert.equal(JSON.parse(await readFile(path.join(runtime,'node_modules/pg/package.json'),'utf8')).version,'8.23.1');
 const {Client}=requireTest('pg'),binaries=await import(pathToFileURL(path.join(pgRoot,'dist/index.js')).href),exec=promisify(execFile);
 const evidence=await mkdtemp(path.join(tmpdir(),'faolla-checkout-bundle-test-')),cluster=path.join(evidence,'cluster');
 const socket=net.createServer();await new Promise((resolve,reject)=>{socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve);});
 const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
 const clients=[];let started=false,config;
 const connect=async role=>{const client=new Client(config);await client.connect();clients.push(client);if(role)await client.query(`set role ${role}`);return client;};
 const one=async(client,sql,args=[])=>(await client.query(sql,args)).rows[0];
 const site='10909095',accountId='50010105',userId='customer-synthetic',principal=`account:${accountId}:${userId}`;
 const op=()=>createHash('sha256').update(randomUUID()).digest('hex');
 const hash=op(),at=new Date().toISOString(),memberSlug=`__merchant_memberships__:${site}`,couponSlug=`__merchant_coupons__:${site}`,settingsSlug=`__merchant_membership_settings__:${site}`,bookingSlug='__merchant_booking_records__:v1';
 try{
  await exec(binaries.initdb,['-D',cluster,'-U','checkout_test_admin','-A','trust','--encoding=UTF8','--locale=C'],{windowsHide:true,timeout:60000});
  await exec(binaries.pg_ctl,['-D',cluster,'-l',path.join(evidence,'postgres.log'),'-w','-t','30','-o',`-h 127.0.0.1 -p ${port} -c shared_buffers=16MB -c max_connections=12`,'start'],{windowsHide:true,timeout:45000});started=true;
  config={host:'127.0.0.1',port,user:'checkout_test_admin',database:'postgres',password:'',ssl:false,connectionTimeoutMillis:5000,statement_timeout:15000,query_timeout:20000,application_name:'faolla-checkout-isolated'};
  const admin=await connect();assert.equal(path.resolve((await one(admin,'show data_directory')).data_directory).toLowerCase(),path.resolve(cluster).toLowerCase());
  await admin.query(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
   create table public.pages(id uuid primary key default gen_random_uuid(),merchant_id text,slug text,blocks jsonb,updated_at timestamptz default clock_timestamp());
   create table public.faolla_schema_migrations(version bigint primary key,name text not null);
   grant usage on schema public to anon,authenticated,service_role;grant select,insert,update,delete on pages to service_role;
   create function public.set_pages_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end;$$;
   create trigger set_pages_updated_at before update on pages for each row execute function public.set_pages_updated_at();`);
  const member=membership.normalizeMerchantMembershipRecord({id:'member-synthetic',siteId:site,accountId,userId,status:'active',pointBalance:1000,balanceAmount:0,growthValue:0,joinedAt:at,updatedAt:at});
  const foreign={...member,id:'foreign-member',accountId:'50010106',userId:'foreign-user',futureField:{unchanged:true}};
  const coupon=coupons.normalizeMerchantCouponRecord({id:'coupon-synthetic',code:'TEST',siteId:site,title:'Synthetic points voucher',discountType:'points_voucher',discountValue:100,
   createdAt:at,updatedAt:at,claimEvents:[{id:'claim-synthetic',at,accountId,userId,email:'synthetic@example.invalid',customerName:'Synthetic',code:'',settlementType:'qr',settlementCode:'SYNTHETIC-CODE',validUntil:null}]});
  const configSettings=settings.createEmptyMerchantMembershipSettings(site);configSettings.redemptionItems=[{id:'item-synthetic',categoryId:'',code:'ITEM',barcode:'',name:'Synthetic item',imageUrl:'',iconName:'',description:'',enabled:true,pointsCost:500,referenceAmount:null,memberPrice:null,taxRate:null,stock:10,pointProduct:true,recommended:false,sort:0}];
  const foreignBooking={id:'foreign-booking',siteId:'10909096',createdAt:at,editToken:'f'.repeat(36),status:'active',futureField:{unchanged:true}};
  for(const [merchant,slug,blocks] of [[site,memberSlug,[member,foreign]],[site,couponSlug,[coupon]],[site,settingsSlug,configSettings],['__faolla_booking_persistence__',bookingSlug,{version:1,records:[foreignBooking]}]]){
   await admin.query('insert into pages(merchant_id,slug,blocks) values($1,$2,$3)',[merchant,slug,JSON.stringify(blocks)]);
  }
  for(const file of ['scripts/supabase-migrations/202609080045_order_membership_atomic_mutation.sql','scripts/supabase-migrations/202609080046_redemption_atomic_mutation.sql','scripts/supabase-migrations/202610250211_booking_atomic_preparation.sql','scripts/supabase-migrations/202610250212_booking_atomic_runtime.sql','scripts/supabase-migrations/202611050213_booking_atomic_safeupdate_singleton.sql','database/proposals/20261122_member_checkout_design.sql','database/proposals/20261122_member_checkout_catalog.sql','database/proposals/20261122_member_checkout_bundle.sql','database/proposals/20261122_member_checkout_cancellation.sql','database/proposals/20261122_member_checkout_queries.sql','database/proposals/20261122_member_checkout_submission.sql','database/proposals/20261123_member_checkout_reporting.sql']){
   await admin.query(await readFile(path.resolve(file),'utf8'));
  }
  // Install the new cash-only proposal alongside ALL existing points cases.
  // The owner-audit table it references is installed by the legacy-boundary
  // proposal below, before any owner cash command is exercised.
  await admin.query(await readFile(path.resolve('database/proposals/20261123_member_checkout_on_site_cancellation.sql'),'utf8'));
  // Test-only admin activation in this freshly created owned synthetic cluster.
  // No equivalent application endpoint or production activation exists.
  await admin.query('update faolla_booking_atomic_control set active=true where singleton');
  await admin.query('insert into faolla_checkout_design.bundle_pilots(site_id,enabled) values($1,true)',[site]);
  const a=await connect(),b=await connect();
  const all=async()=>({pages:(await admin.query('select * from pages order by slug,id')).rows,commands:(await admin.query('select * from faolla_booking_atomic_commands order by command_key')).rows,
   operations:(await admin.query('select * from faolla_redemption_operations order by operation_id')).rows,results:(await admin.query('select * from faolla_checkout_design.bundle_results order by operation_key')).rows,
   cancellations:(await admin.query('select * from faolla_checkout_design.bundle_cancellations order by operation_key')).rows,
   returns:(await admin.query('select * from faolla_checkout_design.bundle_coupon_returns order by redeem_event_id')).rows});
  const prepared=async({points=400,withCoupon=true,withStock=true,kind='booking',id=`synthetic-${randomUUID()}`}={})=>{
   const stamp=await one(admin,'select to_jsonb(updated_at) as stamp from pages where slug=$1',[memberSlug]);
   const plan={settingsVersion:(await one(admin,'select to_jsonb(updated_at) as stamp from pages where slug=$1',[settingsSlug])).stamp,
    membership:{id:member.id,expectedUpdatedAt:stamp.stamp,transactions:points?[{id:`tx-${randomUUID()}`,type:'redeem',status:'completed',at,pointDelta:-points,balanceDelta:0,growthDelta:0,note:'Synthetic member checkout',operatorId:`customer:${accountId}`,cancelledAt:null,cancellationNote:'',cancelledBy:'',cancellationOperationMarker:'',relatedTransactionId:'',adjustmentKind:''}]:[]},
    receipt:{version:1,resourceKind:kind,resourceId:id,totalPoints:points,couponCount:withCoupon?1:0}};
   assert.ok(stamp.stamp);
   if(withCoupon){plan.couponReturnOnCancel=true;plan.coupons={expectedUpdatedAt:(await one(admin,'select to_jsonb(updated_at) as stamp from pages where slug=$1',[couponSlug])).stamp,claims:[{couponId:coupon.id,claimEventId:'claim-synthetic'}]};}
   if(withStock)plan.stock={expectedUpdatedAt:(await one(admin,'select to_jsonb(updated_at) as stamp from pages where slug=$1',[settingsSlug])).stamp,deltas:[{itemId:'item-synthetic',quantity:1}]};
   if(kind==='booking'){
    const state=await one(admin,'select generation,revision::text from faolla_booking_atomic_control where singleton');
    plan.booking={...state,record:{id,siteId:site,siteName:'Synthetic',customerAccountId:accountId,customerUserId:userId,createdAt:at,updatedAt:at,status:'active',appointmentAt:'2030-02-01T12:00',editToken:randomUUID(),store:'Synthetic',item:'Session',title:'',customerName:'Synthetic',email:'synthetic@example.invalid',phone:'',note:''},mailJobs:[]};
   }else{
    const versions=(await one(admin,`select coalesce(jsonb_agg(jsonb_build_object('id',id,'slug',slug,'updatedAt',updated_at) order by slug,id),'[]'::jsonb) as rows from pages where slug=$1 or slug~$2`,[`__merchant_orders__:${site}`,`^__merchant_orders__:${site}:chunk:[0-9]+$`])).rows;
    plan.order={expectedVersions:versions,record:{id,siteId:site,siteName:'Synthetic',customerAccountId:accountId,customerUserId:userId,createdAt:at,updatedAt:at,status:'pending',items:[],totalQuantity:1,totalAmount:0}};
   }
   return plan;
  };
  const commit=async(client,key,plan,who=principal)=>(await one(client,'select faolla_checkout_design.commit_bundle($1,$2,$3,$4,$5) as result',[site,key,who,hash,plan])).result;
  await t.test('two connections with one nonce deduct and redeem exactly once, with one booking and durable receipt',async()=>{
   const plan=await prepared(),key=op();const result=await Promise.all([commit(a,key,plan),commit(b,key,plan)]);
   assert.deepEqual(result.map(r=>r.replayed).sort(),[false,true]);assert.deepEqual(result[0].receipt,result[1].receipt);
   const members=(await one(admin,'select blocks from pages where slug=$1',[memberSlug])).blocks;
   assert.equal(members[0].pointBalance,600);assert.equal(members[0].transactions.length,1);assert.deepEqual(members[1],foreign);
   const saved=(await one(admin,'select blocks from pages where slug=$1',[couponSlug])).blocks[0];assert.equal(saved.usedCount,1);assert.equal(saved.redeemEvents.length,1);
   assert.equal(result[0].receipt.couponReturnOnCancel,true);assert.deepEqual(result[0].receipt.couponUses,[{couponId:coupon.id,claimEventId:'claim-synthetic',redeemEventId:saved.redeemEvents[0].id}]);
   assert.equal((await one(admin,'select blocks from pages where slug=$1',[settingsSlug])).blocks.redemptionItems[0].stock,9);
   const records=(await one(admin,'select blocks from pages where slug=$1',[bookingSlug])).blocks.records;
   assert.equal(records.length,2);assert.deepEqual(records.find(r=>r.id==='foreign-booking'),foreignBooking);
   const before=await all();await assert.rejects(commit(a,key,plan,'account:50010106:other-synthetic'),/checkout_operation_conflict/);assert.deepEqual(await all(),before);
  });
  await t.test('late booking validation failure rolls back member/stock/history/receipt writes',async()=>{
   const plan=await prepared({points:100,withCoupon:false});plan.booking.mailJobs=[{invalid:'late failure'}];
   const before=await all();await assert.rejects(commit(a,op(),plan),/booking_atomic_invalid_mail_intent/);assert.deepEqual(await all(),before);
  });
  await t.test('reused coupon cannot deduct more points or create another booking',async()=>{
   const plan=await prepared({points:100}),before=await all();await assert.rejects(commit(a,op(),plan),/checkout_coupon_unavailable/);assert.deepEqual(await all(),before);
  });
  await t.test('two separately prepared requests competing for one balance admit only one and preserve all foreign records',async()=>{
   const first=await prepared({points:500,withCoupon:false}),second=await prepared({points:500,withCoupon:false});
   const result=await Promise.allSettled([commit(a,op(),first),commit(b,op(),second)]);
   assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.match(result.find(r=>r.status==='rejected').reason.message,/checkout_conflict/);
   assert.equal((await one(admin,'select blocks from pages where slug=$1',[memberSlug])).blocks[0].pointBalance,100);
   const retry=await prepared({points:500,withCoupon:false}),before=await all();await assert.rejects(commit(a,op(),retry),/checkout_insufficient_points/);assert.deepEqual(await all(),before);
  });
  await t.test('actual old cashier mutation shares the original lock and prevents a stale new debit',async()=>{
   const plan=await prepared({points:50,withCoupon:false});
   const before=(await one(admin,'select blocks,to_jsonb(updated_at) as stamp from pages where slug=$1',[memberSlug]));
   const next=structuredClone(before.blocks);next[0].pointBalance-=10;
   await a.query('select public.faolla_commit_order_membership_v1($1,$2)',[site,{memberships:{expectedUpdatedAt:before.stamp,next}}]);
   const state=await all();await assert.rejects(commit(b,op(),plan),/checkout_conflict/);assert.deepEqual(await all(),state);
  });
  await t.test('points product order and member mutation commit together without rewriting unrelated orders',async()=>{
   const plan=await prepared({points:50,withCoupon:false,withStock:false,kind:'order'});const result=await commit(a,op(),plan);
   assert.equal(result.receipt.resourceKind,'order');assert.equal((await one(admin,'select blocks from pages where slug=$1',[memberSlug])).blocks[0].pointBalance,40);
   assert.equal((await one(admin,'select blocks from pages where slug=$1',[`__merchant_orders__:${site}:chunk:0`])).blocks[0].id,plan.receipt.resourceId);
  });
  await t.test('a stale order version fails AFTER member preparation and rolls back all financial writes',async()=>{
   const plan=await prepared({points:10,withCoupon:false,kind:'order'});plan.order.expectedVersions=[];
   const before=await all();await assert.rejects(commit(a,op(),plan),/checkout_conflict/);assert.deepEqual(await all(),before);
  });
  await t.test('voucher-only booking uses zero points and preserves original expiry and every unrelated claim',async()=>{
   const stored=await one(admin,'select blocks,to_jsonb(updated_at) as stamp from pages where slug=$1',[couponSlug]);
   const next=structuredClone(stored.blocks);next[0].claimEvents.push({...next[0].claimEvents[0],id:'claim-voucher-only',settlementCode:'SYNTHETIC-VOUCHER-ONLY',validUntil:'2030-12-31T00:00:00Z'});
   await admin.query('select public.faolla_commit_redemption_v1($1,$2)',[site,{coupons:{expectedUpdatedAt:stored.stamp,next}}]);
   const memberBefore=(await one(admin,'select blocks from pages where slug=$1',[memberSlug])).blocks;
   const plan=await prepared({points:0});plan.coupons.claims[0].claimEventId='claim-voucher-only';plan.couponReturnOnCancel=false;
   const result=await commit(a,op(),plan);assert.equal(result.receipt.totalPoints,0);assert.equal(result.receipt.couponReturnOnCancel,false);
   assert.deepEqual((await one(admin,'select blocks from pages where slug=$1',[memberSlug])).blocks[0].transactions,memberBefore[0].transactions);
   assert.equal((await one(admin,'select blocks from pages where slug=$1',[memberSlug])).blocks[0].pointBalance,40);
   const saved=(await one(admin,'select blocks from pages where slug=$1',[couponSlug])).blocks[0];
   assert.deepEqual(saved.claimEvents,next[0].claimEvents);assert.equal(saved.usedCount,2);
  });
  await t.test('coupon checkout without an explicit merchant return decision cannot write',async()=>{
   const plan=await prepared({points:0});delete plan.couponReturnOnCancel;
   const before=await all();await assert.rejects(commit(a,op(),plan),/checkout_coupon_policy_required/);assert.deepEqual(await all(),before);
  });
  await t.test('one remaining stock is won by only one connection; a fresh second attempt cannot debit',async()=>{
   const stored=await one(admin,'select blocks,to_jsonb(updated_at) as stamp from pages where slug=$1',[settingsSlug]);
   const next=structuredClone(stored.blocks);next.redemptionItems[0].stock=1;
   await admin.query('select public.faolla_commit_redemption_v1($1,$2)',[site,{settings:{expectedUpdatedAt:stored.stamp,next}}]);
   const plans=await Promise.all([prepared({points:10,withCoupon:false}),prepared({points:10,withCoupon:false})]);
   const results=await Promise.allSettled([commit(a,op(),plans[0]),commit(b,op(),plans[1])]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
   const before=await all();await assert.rejects(commit(a,op(),await prepared({points:10,withCoupon:false})),/checkout_quantity_unavailable/);assert.deepEqual(await all(),before);
  });
  await t.test('legacy high point balances keep their original safe-integer range',async()=>{
   const stored=await one(admin,'select blocks,to_jsonb(updated_at) as stamp from pages where slug=$1',[memberSlug]);
   const next=structuredClone(stored.blocks);next[0].pointBalance=200000000;
   await admin.query('select public.faolla_commit_order_membership_v1($1,$2)',[site,{memberships:{expectedUpdatedAt:stored.stamp,next}}]);
   await commit(a,op(),await prepared({points:10,withCoupon:false,withStock:false}));
   assert.equal((await one(admin,'select blocks from pages where slug=$1',[memberSlug])).blocks[0].pointBalance,199999990);
  });
  await t.test('real catalog adapter saves settings separately and two owners editing one version cannot overwrite each other',async()=>{
   const rpc=client=>({rpc:async(name,args)=>{
    try{
     if(name==='faolla_member_checkout_catalog_snapshot_v1')return{data:(await one(client,'select public.faolla_member_checkout_catalog_snapshot_v1($1) as result',[args.p_site_id])).result,error:null};
     assert.equal(name,'faolla_member_checkout_catalog_save_v1');
     return{data:(await one(client,'select public.faolla_member_checkout_catalog_save_v1($1,$2,$3,$4,$5) as result',[args.p_site_id,args.p_expected_version,args.p_next_version,args.p_actor_key,args.p_offer])).result,error:null};
    }catch(error){return{data:null,error:{message:error.message}};}
   }});
   const offerId=randomUUID(),rev=randomUUID(),v1=randomUUID();
   const offer={version:1,id:offerId,revision:rev,siteId:site,enabled:false,title:'Synthetic configured session',maxQuantity:2,
    source:{kind:'booking',blockId:'synthetic-booking',serviceId:offerId,timeZone:'Europe/Madrid'},cash:{currency:'eur',unitAmountMinor:10000,initialPolicy:{mode:'full'}},unitPoints:500,allowOnSite:true,couponReturnOnCancel:true,
    checkoutBinding:{sourceKey:'a'.repeat(64),sourceVersion:'b'.repeat(64),viewport:'mobile',store:'Synthetic',item:'Play',stockItemId:null,voucherCouponIds:[],durationMinutes:60,pointsReturnOnCancel:true,cancellationAdvanceMinutes:60}};
   const input={siteId:site,expectedVersion:null,nextVersion:v1,actorKey:'owner:synthetic-owner',offer},before=await all();
   const first=await configurationStore.saveCheckoutConfiguration(input,rpc(a));assert.equal(first.version,v1);assert.deepEqual(await all(),before);
   const updates=await Promise.allSettled([configurationStore.saveCheckoutConfiguration({...input,expectedVersion:v1,nextVersion:randomUUID(),offer:{...offer,revision:randomUUID(),unitPoints:700}},rpc(a)),
    configurationStore.saveCheckoutConfiguration({...input,expectedVersion:v1,nextVersion:randomUUID(),offer:{...offer,revision:randomUUID(),unitPoints:900}},rpc(b))]);
   assert.equal(updates.filter(value=>value.status==='fulfilled').length,1);assert.match(updates.find(value=>value.status==='rejected').reason.message,/checkout_configuration_conflict/);
   const current=await configurationStore.loadCheckoutConfiguration(site,rpc(admin));assert.equal(current.offers.length,1);assert.ok([700,900].includes(current.offers[0].unitPoints));
   const historical=(await one(admin,'select snapshot from faolla_checkout_design.offer_versions where site_id=$1 and revision=$2',[site,rev])).snapshot;
   assert.equal(historical.unitPoints,500);assert.deepEqual(await configurationStore.saveCheckoutConfiguration(input,rpc(a)),first);assert.deepEqual(await all(),before);
  });
  await t.test('existing expiry, discount and growth benefits compose with the booking; a late failure rolls ALL benefits back',async()=>{
   // Reset ONLY this owned synthetic fixture, never a real member history.
   const memberRow=await one(admin,'select blocks,to_jsonb(updated_at) as stamp from pages where slug=$1',[memberSlug]);
   const configRow=await one(admin,'select blocks,to_jsonb(updated_at) as stamp from pages where slug=$1',[settingsSlug]);
   const currentTime=new Date(),now=currentTime.toISOString(),birthday=`${String(currentTime.getMonth()+1).padStart(2,'0')}-${String(currentTime.getDate()).padStart(2,'0')}`;
   const oldDate=new Date(currentTime.getTime()-100*86400000).toISOString();
   const original=membership.normalizeMerchantMembershipRecord({...memberRow.blocks[0],birthday,pointBalance:1000,growthValue:50,levelId:'silver',transactions:[
    {id:'policy-recent-credit',type:'recharge',at:now,pointDelta:600,balanceDelta:0,growthDelta:50,operatorId:'owner'},
    {id:'policy-expired-credit',type:'recharge',at:oldDate,pointDelta:400,balanceDelta:0,growthDelta:0,operatorId:'owner'}]});
   assert.ok(original);
   const policy=settings.normalizeMerchantMembershipSettings(site,{...configRow.blocks,growthRules:{spendPointGrowth:0.5,annualRecalculate:false},
    pointsRules:{birthdayPoints:10,pointsNeverExpire:false,pointsValidDays:30},levels:[
     {id:'silver',name:'Silver',requiredGrowthValue:0,enabled:true,benefit:{pointDiscount:'9折',oneTimeGiftPoints:20,recurringGiftPoints:30,birthdayGiftPoints:40}},
     {id:'gold',name:'Gold',requiredGrowthValue:100,enabled:true,benefit:{pointDiscount:'8折',oneTimeGiftPoints:100}}]});
   await admin.query('select public.faolla_commit_order_membership_v1($1,$2)',[site,{memberships:{expectedUpdatedAt:memberRow.stamp,next:[original,...memberRow.blocks.slice(1)]}}]);
   await admin.query('select public.faolla_commit_redemption_v1($1,$2)',[site,{settings:{expectedUpdatedAt:configRow.stamp,next:policy}}]);
   const available=memberPoints.prepareMemberCheckoutAvailablePoints({membership:original,settings:policy,now,unitPoints:101,quantity:2});
   assert.equal(available.spendablePoints,700);assert.equal(available.grossPoints,182);assert.equal(available.expiredPoints,400);
   const key=op(),debit=memberPoints.prepareMemberCheckoutPointDebit({original,prepared:available.membership,settings:policy,points:182,couponCount:0,accountId,userId,operationKey:key,now,title:'Policy fixture'});
   const plan=await prepared({points:182,withCoupon:false,withStock:false});
   plan.membership={...plan.membership,...debit.mutation};plan.booking.mailJobs=[{invalid:'late policy failure'}];
   const before=await all();await assert.rejects(commit(a,key,plan),/booking_atomic_invalid_mail_intent/);assert.deepEqual(await all(),before);
   plan.booking.mailJobs=[];
   const result=await Promise.all([commit(a,key,plan),commit(b,key,plan)]);
   assert.deepEqual(result.map(r=>r.replayed).sort(),[false,true]);
   const saved=(await one(admin,'select blocks from pages where slug=$1',[memberSlug])).blocks;
   assert.equal(saved[0].pointBalance,618);assert.equal(saved[0].growthValue,141);assert.equal(saved[0].levelId,'gold');
   assert.deepEqual(saved[0].transactions,debit.membership.transactions);assert.deepEqual(saved.slice(1),memberRow.blocks.slice(1));
   assert.equal(saved[0].transactions.filter(tx=>tx.note.includes(`[op:member-self-checkout:${key}]`)).length,1);
  });
  await t.test('point state, level and transaction IDs cannot contradict the composite ledger',async()=>{
   for(const variant of ['balance','level','duplicate','old-id','growth-without-state']){
    const plan=await prepared({points:1,withCoupon:false,withStock:false}),before=await all();
    const member=(await one(admin,'select blocks from pages where slug=$1',[memberSlug])).blocks[0];
    plan.membership.nextState={pointBalance:member.pointBalance-1,growthValue:member.growthValue,levelId:member.levelId};
    if(variant==='balance')plan.membership.nextState.pointBalance+=100;
    if(variant==='level')plan.membership.nextState.levelId='unknown';
    if(variant==='duplicate')plan.membership.transactions.push({...plan.membership.transactions[0]});
    if(variant==='old-id')plan.membership.transactions[0].id=member.transactions[0].id;
    if(variant==='growth-without-state'){delete plan.membership.nextState;plan.membership.transactions[0].growthDelta=1;}
    await assert.rejects(commit(a,op(),plan),/checkout_invalid_plan/);assert.deepEqual(await all(),before);
   }
  });
  const configure=async({returnPoints=true,returnCoupons=true,kind='booking',points=10,withCoupon=true,withStock=true,id}={})=>{
   const couponRow=await one(admin,'select blocks,to_jsonb(updated_at) as stamp from pages where slug=$1',[couponSlug]),claimId=`claim-${randomUUID()}`;
   const couponNext=structuredClone(couponRow.blocks);couponNext[0].expiresAt=null;
   couponNext[0].claimEvents.push({...couponNext[0].claimEvents[0],id:claimId,settlementCode:`CODE-${randomUUID()}`,validUntil:'2035-12-31T00:00:00Z'});
   const settingsRow=await one(admin,'select blocks,to_jsonb(updated_at) as stamp from pages where slug=$1',[settingsSlug]);
   const settingNext=structuredClone(settingsRow.blocks);settingNext.redemptionItems[0].stock=2;
   await admin.query('select public.faolla_commit_redemption_v1($1,$2)',[site,{coupons:{expectedUpdatedAt:couponRow.stamp,next:couponNext},settings:{expectedUpdatedAt:settingsRow.stamp,next:settingNext}}]);
   const offerId=randomUUID(),revision=randomUUID();
   const offer={version:1,id:offerId,revision,siteId:site,enabled:true,title:'Cancellation fixture',maxQuantity:2,
    source:kind==='booking'?{kind,blockId:'synthetic-booking',serviceId:offerId,timeZone:'Europe/Madrid'}:{kind,blockId:'synthetic-product',collectionId:'synthetic-collection',productId:'synthetic-product'},
    cash:{currency:'eur',unitAmountMinor:10000,initialPolicy:{mode:'full'}},unitPoints:points||10,allowOnSite:true,couponReturnOnCancel:returnCoupons,
    checkoutBinding:{sourceKey:op(),sourceVersion:op(),viewport:'mobile',...(kind==='booking'?{store:'Synthetic',item:'Play'}:{}),stockItemId:withStock?'item-synthetic':null,voucherCouponIds:[],durationMinutes:60,pointsReturnOnCancel:returnPoints,cancellationAdvanceMinutes:60}};
   const current=(await one(admin,'select public.faolla_member_checkout_catalog_snapshot_v1($1) as result',[site])).result;
   await admin.query('select public.faolla_member_checkout_catalog_save_v1($1,$2,$3,$4,$5)',[site,current.version,randomUUID(),'owner:synthetic-owner',offer]);
   const plan=await prepared({points,withCoupon,withStock,kind,...(id?{id}:{})});plan.offer={id:offerId,revision};
   if(withCoupon){plan.coupons.claims[0].claimEventId=claimId;plan.couponReturnOnCancel=returnCoupons;}
   return{plan,offer,key:op(),claimId};
  };
  const cancel=async(client,f,who=principal,expected=f.plan[f.offer.source.kind].record.updatedAt)=>(await one(client,
   'select faolla_checkout_design.cancel_bundle($1,$2,$3,$4) as result',[site,f.key,who,expected])).result;
  await t.test('two cancellations restore points/stock/coupon exactly once using the original policy after merchant edits',async()=>{
   const f=await configure(),beforeMember=(await one(admin,'select blocks from pages where slug=$1',[memberSlug])).blocks;
   const original=await commit(a,f.key,f.plan);assert.equal(original.receipt.cancellationPolicy.returnPoints,true);
   const current=(await one(admin,'select public.faolla_member_checkout_catalog_snapshot_v1($1) as result',[site])).result;
   await admin.query('select public.faolla_member_checkout_catalog_save_v1($1,$2,$3,$4,$5)',[site,current.version,randomUUID(),'owner:synthetic-owner',
    {...f.offer,enabled:false,revision:randomUUID(),unitPoints:900,couponReturnOnCancel:false,checkoutBinding:{...f.offer.checkoutBinding,pointsReturnOnCancel:false}}]);
   const originalCoupons=(await one(admin,'select blocks from pages where slug=$1',[couponSlug])).blocks;
   const couponExpired=structuredClone(originalCoupons);couponExpired[0].expiresAt=new Date(Date.now()-1000).toISOString();
   couponExpired[0].claimEvents.find(c=>c.id===f.claimId).validUntil=new Date(Date.now()-1000).toISOString();
   await admin.query('select public.faolla_commit_redemption_v1($1,$2)',[site,{coupons:{expectedUpdatedAt:(await one(admin,'select to_jsonb(updated_at) as stamp from pages where slug=$1',[couponSlug])).stamp,next:couponExpired}}]);
   const result=await Promise.all([cancel(a,f),cancel(b,f)]);assert.deepEqual(result.map(r=>r.replayed).sort(),[false,true]);
   assert.deepEqual(result[0].receipt,result[1].receipt);assert.equal(result[0].receipt.pointsReturned,10);assert.equal(result[0].receipt.couponsReturned,1);assert.equal(result[0].receipt.stockReleased,1);
   const saved=(await one(admin,'select blocks from pages where slug=$1',[memberSlug])).blocks;
   assert.equal(saved[0].pointBalance,beforeMember[0].pointBalance);assert.deepEqual(saved.slice(1),beforeMember.slice(1));
   assert.equal(saved[0].transactions.filter(tx=>tx.note.includes(`[member-checkout-return:${f.key}]`)).length,1);
   assert.equal(saved[0].transactions.find(tx=>tx.id===f.plan.membership.transactions[0].id).status,'cancelled');
   assert.equal((await one(admin,'select blocks from pages where slug=$1',[settingsSlug])).blocks.redemptionItems[0].stock,2);
   const returned=(await one(admin,'select blocks from pages where slug=$1',[couponSlug])).blocks[0];
   assert.deepEqual(returned.claimEvents,couponExpired[0].claimEvents);assert.equal(returned.expiresAt,couponExpired[0].expiresAt);
   assert.equal(returned.redeemEvents.some(r=>r.id===original.receipt.couponUses[0].redeemEventId),false);
   assert.deepEqual((await one(admin,'select original_redemption from faolla_checkout_design.bundle_coupon_returns where site_id=$1 and redeem_event_id=$2',[site,original.receipt.couponUses[0].redeemEventId])).original_redemption,
    originalCoupons[0].redeemEvents.find(r=>r.id===original.receipt.couponUses[0].redeemEventId));
   const before=await all();await assert.rejects(cancel(a,f,'account:50010106:foreign-synthetic'),/checkout_not_found/);assert.deepEqual(await all(),before);
  });
  await t.test('merchant may retain points and coupons; zero-point voucher cancellation never invents a point refund',async()=>{
   for(const points of [0,10]){
    const f=await configure({returnPoints:false,returnCoupons:false,points});await commit(a,f.key,f.plan);
    const before=(await one(admin,'select blocks from pages where slug=$1',[memberSlug])).blocks;
    const couponsBefore=(await one(admin,'select blocks from pages where slug=$1',[couponSlug])).blocks;
    const result=await cancel(a,f);assert.equal(result.receipt.pointsReturned,0);assert.equal(result.receipt.couponsReturned,0);assert.equal(result.receipt.stockReleased,1);
    assert.deepEqual((await one(admin,'select blocks from pages where slug=$1',[memberSlug])).blocks,before);
    assert.deepEqual((await one(admin,'select blocks from pages where slug=$1',[couponSlug])).blocks,couponsBefore);
   }
  });
  await t.test('late cancellation storage failure rolls back point refund, stock release, coupon history and refund facts together',async()=>{
   const f=await configure({id:'forced-cancel-failure'});await commit(a,f.key,f.plan);
   await admin.query(`create function public.synthetic_cancel_failure() returns trigger language plpgsql as $$begin
    if new.slug='__merchant_booking_records__:v1' and exists(select 1 from jsonb_array_elements(new.blocks->'records') r where r->>'id'='forced-cancel-failure' and r->>'status'='cancelled') then raise exception 'synthetic_cancel_late_failure';end if;return new;end;$$;
    create trigger synthetic_cancel_failure before update on public.pages for each row execute function public.synthetic_cancel_failure();`);
   const before=await all();await assert.rejects(cancel(a,f),/synthetic_cancel_late_failure/);assert.deepEqual(await all(),before);
   await admin.query('drop trigger synthetic_cancel_failure on public.pages;drop function public.synthetic_cancel_failure()');
   assert.equal((await cancel(a,f)).replayed,false);
  });
  await t.test('stale resource, completed booking, cancellation deadline and unbound legacy receipt fail without financial writes',async()=>{
   const stale=await configure({withCoupon:false,withStock:false});await commit(a,stale.key,stale.plan);
   let before=await all();await assert.rejects(cancel(a,stale,principal,'stale'),/checkout_conflict/);assert.deepEqual(await all(),before);
   const complete=await configure({withCoupon:false,withStock:false});await commit(a,complete.key,complete.plan);
   const raw=(await one(admin,'select blocks from pages where slug=$1',[bookingSlug])).blocks;
   raw.records.find(r=>r.id===complete.plan.booking.record.id).status='completed';
   // Model completion THROUGH the original atomic writer, retaining its
   // active-generation fence rather than bypassing it with direct pages IO.
   const control=await one(admin,'select generation,revision::text from faolla_booking_atomic_control where singleton');
   const bookingRows=(await one(admin,'select public.faolla_booking_atomic_rows_v1() as rows')).rows;
   await admin.query('select public.faolla_booking_atomic_commit_v1($1,$2,$3,$4)',[site,op(),op(),
    {...control,rows:bookingRows,next:raw,result:{syntheticCompleted:true},mailJobs:[]}]);before=await all();
   await assert.rejects(cancel(a,complete),/checkout_cancellation_not_allowed/);assert.deepEqual(await all(),before);
   const late=await configure({withCoupon:false,withStock:false});late.plan.booking.record.appointmentAt='2020-01-01T12:00';await commit(a,late.key,late.plan);before=await all();
   await assert.rejects(cancel(a,late),/checkout_cancellation_deadline/);assert.deepEqual(await all(),before);
   const legacy=await prepared({points:1,withCoupon:false,withStock:false}),key=op();await commit(a,key,legacy);before=await all();
   await assert.rejects(a.query('select faolla_checkout_design.cancel_bundle($1,$2,$3,$4)',[site,key,principal,at]),/checkout_cancellation_review_required/);assert.deepEqual(await all(),before);
  });
  await t.test('order cancellation restores only its actual debit and original member even after leaving membership',async()=>{
   const f=await configure({kind:'order',withCoupon:false}),prior=(await one(admin,'select blocks from pages where slug=$1',[memberSlug])).blocks;
   await commit(a,f.key,f.plan);
   const current=await one(admin,'select blocks,to_jsonb(updated_at) as stamp from pages where slug=$1',[memberSlug]);current.blocks[0].status='left';
   await admin.query('select public.faolla_commit_order_membership_v1($1,$2)',[site,{memberships:{expectedUpdatedAt:current.stamp,next:current.blocks}}]);
   const result=await cancel(a,f);assert.equal(result.receipt.pointsReturned,10);
   const saved=(await one(admin,'select blocks from pages where slug=$1',[memberSlug])).blocks;
   assert.equal(saved[0].pointBalance,prior[0].pointBalance);assert.equal(saved[0].status,'left');assert.deepEqual(saved.slice(1),prior.slice(1));
   assert.equal((await one(admin,'select blocks from pages where slug=$1',[`__merchant_orders__:${site}:chunk:0`])).blocks.find(o=>o.id===f.plan.order.record.id).status,'cancelled');
   // Restore only the synthetic fixture for later tests.
   const row=await one(admin,'select blocks,to_jsonb(updated_at) as stamp from pages where slug=$1',[memberSlug]);row.blocks[0].status='active';
   await admin.query('select public.faolla_commit_order_membership_v1($1,$2)',[site,{memberships:{expectedUpdatedAt:row.stamp,next:row.blocks}}]);
  });
  await t.test('returning an already reused coupon never cancels its later use and refund history is immutable',async()=>{
   const first=await configure({withStock:false,points:1});await commit(a,first.key,first.plan);await cancel(a,first);
   const next=await configure({withStock:false,points:1});next.plan.coupons.claims[0].claimEventId=first.claimId;await commit(a,next.key,next.plan);
   const before=await all();assert.equal((await cancel(a,first)).replayed,true);assert.deepEqual(await all(),before);
   const saved=(await one(admin,'select blocks from pages where slug=$1',[couponSlug])).blocks[0];
   assert.ok(saved.redeemEvents.some(r=>r.claimEventId===first.claimId&&r.note.includes(next.key)));
   await assert.rejects(admin.query('delete from faolla_checkout_design.bundle_cancellations where operation_key=$1',[first.key]),/checkout_history_immutable/);
   await assert.rejects(admin.query('update faolla_checkout_design.bundle_coupon_returns set original_redemption=$1 where operation_key=$2',[{},first.key]),/checkout_history_immutable/);
   assert.deepEqual(await all(),before);
  });
  await t.test('refunded spend removes its original growth without another level gift or unrelated member change',async()=>{
   for(const annual of [false,true]){
   const f=await configure({withCoupon:false,withStock:false,points:101});
   const before=(await one(admin,'select blocks from pages where slug=$1',[memberSlug])).blocks;
   const policyRow=await one(admin,'select blocks,to_jsonb(updated_at) as stamp from pages where slug=$1',[settingsSlug]),policy=policyRow.blocks,now=new Date().toISOString();
   policy.growthRules.annualRecalculate=annual;
   await admin.query('select public.faolla_commit_redemption_v1($1,$2)',[site,{settings:{expectedUpdatedAt:policyRow.stamp,next:policy}}]);
   f.plan.settingsVersion=(await one(admin,'select to_jsonb(updated_at) as stamp from pages where slug=$1',[settingsSlug])).stamp;
   const available=memberPoints.prepareMemberCheckoutAvailablePoints({membership:before[0],settings:policy,now,unitPoints:101,quantity:1});
   const debit=memberPoints.prepareMemberCheckoutPointDebit({original:before[0],prepared:available.membership,settings:policy,points:available.grossPoints,couponCount:0,accountId,userId,operationKey:f.key,now,title:'Growth return'});
   f.plan.membership={...f.plan.membership,...debit.mutation};f.plan.receipt.totalPoints=available.grossPoints;await commit(a,f.key,f.plan);
   const result=await cancel(a,f);assert.equal(result.receipt.pointsReturned,available.grossPoints);
   const saved=(await one(admin,'select blocks from pages where slug=$1',[memberSlug])).blocks;
   assert.equal(saved[0].growthValue,available.membership.growthValue);assert.equal(saved[0].pointBalance,available.spendablePoints);assert.deepEqual(saved.slice(1),before.slice(1));
   assert.equal(saved[0].transactions.filter(tx=>tx.note.includes('[level-one-time:gold]')).length,available.membership.transactions.filter(tx=>tx.note.includes('[level-one-time:gold]')).length);
   }
  });
  await t.test('an order completed by the original writer during cancellation cannot receive a stale refund',async()=>{
   const f=await configure({kind:'order'});await commit(a,f.key,f.plan);const before=await all();
   await a.query('begin');
   let pending;
   try{
    await a.query("select pg_advisory_xact_lock(hashtextextended('faolla-order-membership:'||$1,0))",[site]);
    pending=cancel(b,f).then(value=>({value}),error=>({error}));
    let waiting=false;
    for(let i=0;i<200;i++){
     waiting=(await one(admin,"select wait_event_type='Lock' and wait_event='advisory' as waiting from pg_stat_activity where pid=$1",[b.processID]))?.waiting===true;
     if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(waiting,true,'wait for the ACTUAL original member/order lock, not a zero-millisecond timer');
    const rows=(await one(a,`select jsonb_agg(jsonb_build_object('id',id,'slug',slug,'blocks',blocks,'updated_at',updated_at) order by slug,id) as rows
     from pages where slug=$1 or slug~$2`,[`__merchant_orders__:${site}`,`^__merchant_orders__:${site}:chunk:[0-9]+$`])).rows;
    const records=structuredClone(rows.filter(r=>r.slug.includes(':chunk:')).flatMap(r=>r.blocks));const record=records.find(r=>r.id===f.plan.order.record.id);
    record.status='completed';record.updatedAt=new Date().toISOString();
    await a.query('select public.faolla_commit_order_membership_v1($1,$2)',[site,{orders:{expectedRows:rows,next:records}}]);await a.query('commit');
    const outcome=await pending;assert.ok(outcome.error);assert.match(outcome.error.message,/order_update_conflict|checkout_conflict|checkout_cancellation_not_allowed/);
    const final=await all();assert.deepEqual(final.cancellations,before.cancellations);assert.deepEqual(final.returns,before.returns);
    assert.deepEqual(final.pages.find(r=>r.slug===memberSlug).blocks,before.pages.find(r=>r.slug===memberSlug).blocks);
    assert.deepEqual(final.pages.find(r=>r.slug===couponSlug).blocks,before.pages.find(r=>r.slug===couponSlug).blocks);
    assert.deepEqual(final.pages.find(r=>r.slug===settingsSlug).blocks,before.pages.find(r=>r.slug===settingsSlug).blocks);
   }catch(error){await a.query('rollback');if(pending)await pending;throw error;}
  });
  await t.test('changed original booking time is not silently refunded under its earlier immutable terms',async()=>{
   const f=await configure({withCoupon:false,withStock:false});await commit(a,f.key,f.plan);
   const state=await one(admin,'select generation,revision::text from faolla_booking_atomic_control where singleton');
   const rows=(await one(admin,'select public.faolla_booking_atomic_rows_v1() as rows')).rows;
   const raw=structuredClone(rows.find(r=>r.slug===bookingSlug).blocks);raw.records.find(r=>r.id===f.plan.booking.record.id).appointmentAt='2020-01-01T12:00';
   await admin.query('select public.faolla_booking_atomic_commit_v1($1,$2,$3,$4)',[site,op(),op(),{...state,rows,next:raw,result:{syntheticChanged:true},mailJobs:[]}]);
   const before=await all();await assert.rejects(cancel(a,f),/checkout_cancellation_review_required/);assert.deepEqual(await all(),before);
   const read=(await one(admin,'select public.faolla_member_checkout_result_v2($1,$2,$3) as result',[site,f.key,principal])).result;
   assert.equal(read.cancellationAvailable,false);
  });
  await t.test('cancellation adds only the actual original debit to the current balance, preserving a later original-cashier spend',async()=>{
   const f=await configure({withCoupon:false,withStock:false});await commit(a,f.key,f.plan);
   const row=await one(admin,'select blocks,to_jsonb(updated_at) as stamp from pages where slug=$1',[memberSlug]);
   const next=structuredClone(row.blocks);next[0].pointBalance-=5;
   const tx={...f.plan.membership.transactions[0],id:`cashier-${randomUUID()}`,pointDelta:-5,note:'Synthetic later cashier spend'};
   next[0].transactions.unshift(tx);
   await a.query('select public.faolla_commit_order_membership_v1($1,$2)',[site,{memberships:{expectedUpdatedAt:row.stamp,next}}]);
   const result=await cancel(b,f);assert.equal(result.receipt.pointsReturned,10);
   const final=(await one(admin,'select blocks from pages where slug=$1',[memberSlug])).blocks;
   assert.equal(final[0].pointBalance,row.blocks[0].pointBalance-5+10);assert.deepEqual(final[0].transactions.find(t=>t.id===tx.id),tx);assert.deepEqual(final.slice(1),row.blocks.slice(1));
  });
  await t.test('actual customer result/cancel HTTP handler and adapter reach the real isolated SQL, with safe projections and read-only reconciliation',async()=>{
   const f=await configure();await commit(a,f.key,f.plan);
   const rpc=async(name,args)=>{try{
    const sql=name==='faolla_member_checkout_result_v2'?'select public.faolla_member_checkout_result_v2($1,$2,$3) as result':
     name==='faolla_member_checkout_cancel_v2'?'select public.faolla_member_checkout_cancel_v2($1,$2,$3,$4) as result':null;
    assert.ok(sql);return{data:(await one(a,sql,[args.p_site_id,args.p_operation_key,args.p_principal_key,...(name.includes('cancel')?[args.p_expected_updated_at]:[])])).result,error:null};
   }catch(error){return{data:null,error:{message:error.message}};}};
   const deps={enabled:()=>true,session:async()=>({accountId,userId,servicePaused:false,user:{id:userId,email_confirmed_at:at}}),
    read:input=>resultStore.readMemberCheckoutResult(input,rpc),cancel:input=>resultStore.cancelMemberCheckout(input,rpc)};
   const url=`https://synthetic.faolla.invalid/api/member-checkout/result?siteId=${site}&operationKey=${f.key}`;
   const before=await all(),response=await resultRoute.handleMemberCheckoutResult(new Request(url),deps);
   assert.equal(response.status,200);const read=await response.json();assert.equal(read.result.cancellationAvailable,true);assert.deepEqual(await all(),before);
   assert.ok(!/membershipId|pointTransactions|couponUses|settlementCode|principalKey|customer-synthetic/.test(JSON.stringify(read)));
   const request=new Request('https://synthetic.faolla.invalid/api/member-checkout/cancel',{method:'POST',headers:{origin:'https://synthetic.faolla.invalid','content-type':'application/json'},
    body:JSON.stringify({siteId:site,operationKey:f.key,expectedUpdatedAt:read.result.resource.updatedAt})});
   const cancelled=await resultRoute.handleMemberCheckoutResult(request,deps);assert.equal(cancelled.status,200);assert.equal((await cancelled.json()).cancellation.pointsReturned,10);
   const final=await resultStore.readMemberCheckoutResult({siteId:site,operationKey:f.key,principalKey:principal},rpc);
   assert.equal(final.closed,true);assert.equal(final.resource.status,'cancelled');assert.equal(final.cancellationAvailable,false);assert.equal(final.cancellation.couponsReturned,1);
   assert.equal(await resultStore.readMemberCheckoutResult({siteId:site,operationKey:f.key,principalKey:'account:50010106:foreign-synthetic'},rpc),null);
  });
  const defaultFixtureSite=site;
  const submissionFixture=async({kind='booking',couponAmount=20,stock=2,withCoupon=true,testSite=defaultFixtureSite}={})=>{
   const site=testSite,memberSlug=`__merchant_memberships__:${site}`,settingsSlug=`__merchant_membership_settings__:${site}`,couponSlug=`__merchant_coupons__:${site}`;
   const stamp=new Date().toISOString(),blockId=`submit-${kind}-${randomUUID()}`,appointmentAt=`${bookingTime.bookingWallTimeAt(new Date(Date.now()+3*86400000),'Europe/Madrid').slice(0,10)}T12:00`;
   const blocks=[kind==='booking'?{id:blockId,type:'booking',props:{bookingStoreOptions:['Synthetic'],bookingItemOptions:['Play'],bookingTitleOptions:['Mx'],bookingTimeSlotRules:[{timeRange:'10:00-18:00',maxBookings:1}]}}:
    {id:blockId,type:'product',props:{products:[]}}];
   const catalog=kind==='order'?{revision:1,updatedAt:stamp,pricePrefix:'€',categories:[],products:[{id:'submit-product',code:'P',name:'Synthetic product',description:'',price:'10.00',imageUrl:'',thumbnailUrl:'',tag:'',availability:'available'}],
    collections:[{id:'submit-collection',blockId,viewport:'shared',productIds:['submit-product']}]}:null;
   const source=checkoutSources.buildCheckoutSourceChoices({siteId:site,siteName:'Synthetic',blocks,catalog,allowBooking:kind==='booking',allowOrder:kind==='order'})[0];
   const savePage=async(merchant,slug,value)=>{const found=await one(admin,'select id from pages where merchant_id is not distinct from $1 and slug=$2',[merchant,slug]);
    if(found)await admin.query('update pages set blocks=$2 where id=$1',[found.id,JSON.stringify(value)]);
    else await admin.query('insert into pages(merchant_id,slug,blocks) values($1,$2,$3)',[merchant,slug,JSON.stringify(value)]);};
   const permissionConfig={...platformControl.createDefaultMerchantPermissionConfig(),allowBookingBlock:true,allowProductBlock:true,allowOrderManagement:true,allowMembershipManagement:true,allowPointsRedemption:true,allowCouponModule:true};
   const siteView=platformSnapshot.buildPlatformMerchantSnapshotSite({id:site,name:'Synthetic',status:'online',serviceExpiresAt:'2099-01-01T00:00:00Z',permissionConfig});assert.ok(siteView);
   await savePage(null,'__platform_merchant_snapshot__',platformSnapshot.buildPlatformMerchantSnapshotBlocks(platformSnapshot.normalizePlatformMerchantSnapshotPayload({revision:randomUUID(),snapshot:[siteView],defaultSortRule:'created_desc',merchantConfigHistoryBySiteId:{}})));
   await savePage(site,'synthetic-checkout-public',blocks);
   if(catalog)await savePage(site,`__merchant_catalog__:${site}`,{kind:'merchant_catalog',siteId:site,catalog});
   if(kind==='booking'){
    for(const [key,property,value]of [['rules','snapshots',bookingRules.buildMerchantBookingRulesSnapshot(site,blocks,stamp)],['workbench','settingsBySiteId',{...workbench.createDefaultMerchantBookingWorkbenchSettings(),timeZone:'Europe/Madrid'}]]){
     const slug=key==='rules'?'__merchant_booking_rules__:v1':'__merchant_booking_workbench__:v1',current=(await one(admin,'select blocks from pages where slug=$1',[slug]))?.blocks??{version:1,[property]:{}};
     await admin.query('select public.faolla_booking_atomic_configuration_v2($1,$2,$3)',[site,key,{...current,[property]:{...current[property],[site]:value}}]);
    }
   }
   const memberRow=await one(admin,'select blocks,to_jsonb(updated_at) as stamp from pages where slug=$1',[memberSlug]),settingsRow=await one(admin,'select blocks,to_jsonb(updated_at) as stamp from pages where slug=$1',[settingsSlug]),couponRow=await one(admin,'select blocks,to_jsonb(updated_at) as stamp from pages where slug=$1',[couponSlug]);
   const nextMember=membership.normalizeMerchantMembershipRecord({...memberRow.blocks[0],status:'active',pointBalance:1000,growthValue:0,levelId:'',birthday:'',transactions:[]});
   const nextSettings=settings.createEmptyMerchantMembershipSettings(site);nextSettings.redemptionItems=[{...configSettings.redemptionItems[0],pointsCost:100,stock}];
   const couponId=`submit-coupon-${randomUUID()}`,claimId=`submit-claim-${randomUUID()}`;
   const nextCoupon=coupons.normalizeMerchantCouponRecord({id:couponId,siteId:site,code:`SB${randomUUID().replaceAll('-','').slice(0,16)}`,title:'Synthetic submission voucher',discountType:'points_voucher',discountValue:couponAmount,usageScenarios:['points_redemption'],createdAt:stamp,updatedAt:stamp,
    claimEvents:[{id:claimId,at:stamp,accountId,userId,email:'synthetic@example.invalid',customerName:'Synthetic',code:'',settlementType:'qr',settlementCode:`PRIVATE-${randomUUID()}`,validUntil:null}]});assert.ok(nextCoupon);
   await admin.query('select public.faolla_commit_redemption_v1($1,$2)',[site,{memberships:{expectedUpdatedAt:memberRow.stamp,next:[nextMember,...memberRow.blocks.slice(1)]},settings:{expectedUpdatedAt:settingsRow.stamp,next:nextSettings},coupons:{expectedUpdatedAt:couponRow.stamp,next:[nextCoupon,...couponRow.blocks]}}]);
   const offerId=randomUUID(),revision=randomUUID(),offer={version:1,id:offerId,revision,siteId:site,enabled:true,title:'Synthetic submission',maxQuantity:kind==='booking'?1:5,
    source:kind==='booking'?{kind,blockId,serviceId:offerId,timeZone:'Europe/Madrid'}:{kind,blockId,collectionId:source.collectionId,productId:source.productId},cash:{currency:'eur',unitAmountMinor:1000,initialPolicy:{mode:'full'}},unitPoints:100,allowOnSite:true,couponReturnOnCancel:true,
    checkoutBinding:{sourceKey:source.key,sourceVersion:source.sourceVersion,viewport:source.viewport,...(kind==='booking'?{store:source.store,item:source.item}:{}),stockItemId:'item-synthetic',voucherCouponIds:[],durationMinutes:60,pointsReturnOnCancel:true,cancellationAdvanceMinutes:60}};
   const current=(await one(admin,'select public.faolla_member_checkout_catalog_snapshot_v1($1) as result',[site])).result;
   await admin.query('select public.faolla_member_checkout_catalog_save_v1($1,$2,$3,$4,$5)',[site,current.version,randomUUID(),'owner:synthetic-owner',offer]);
   const request={siteId:site,offerId,offerRevision:revision,quantity:1,...(kind==='booking'?{appointmentAt}:{}),couponClaims:withCoupon?[{couponId,claimEventId:claimId}]:[],method:'points',nonce:randomUUID(),confirmationHash:'0'.repeat(64),customer:{name:'Synthetic',title:'Mx',email:'synthetic@example.invalid',phone:'000000000',note:''}};
   const identity=submissionPlan.checkoutSubmissionIdentity(request,{accountId,userId}),snapshot=(await one(admin,'select public.faolla_member_checkout_submission_snapshot_v2($1,$2,$3,$4,$5) as result',[site,identity.operationKey,principal,identity.requestHash,offerId])).result.snapshot;
   const view=await submissionPlan.quoteCheckoutSubmissionSnapshot(snapshot,identity,{accountId,userId});assert.equal(view.quote.options[0].totalPoints,100-(withCoupon?couponAmount:0));assert.ok(view.confirmationHash);
   request.confirmationHash=view.confirmationHash;
   return{request,offer,blockId,savePage,siteView};
  };
  const submitRpc=client=>async(name,args)=>{try{
   const sql=name==='faolla_member_checkout_submission_snapshot_v2'?'select public.faolla_member_checkout_submission_snapshot_v2($1,$2,$3,$4,$5) as result':
    name==='faolla_member_checkout_submission_commit_v2'?'select public.faolla_member_checkout_submission_commit_v2($1,$2,$3,$4,$5,$6,$7) as result':null;assert.ok(sql);
   return{data:(await one(client,sql,[args.p_site_id,args.p_operation_key,args.p_principal_key,args.p_request_hash,...(name.includes('snapshot')?[args.p_offer_id]:[args.p_snapshot,args.p_plan,args.p_not_after])])).result,error:null};
  }catch(error){return{data:null,error:{message:error.message}};}};
  const submit=(f,client=a,override)=>submission.submitMemberCheckout({request:f.request,principal:{accountId,userId},authorize:async()=>({accountId,userId})},override??submitRpc(client));
  const submitSnapshot=async f=>{const identity=submissionPlan.checkoutSubmissionIdentity(f.request,{accountId,userId});
   const raw=(await submitRpc(admin)('faolla_member_checkout_submission_snapshot_v2',{p_site_id:identity.siteId,p_operation_key:identity.operationKey,p_principal_key:principal,p_request_hash:identity.requestHash,p_offer_id:f.offer.id})).data;
   assert.equal(raw.replayed,false);const snapshot=submissionPlan.parseCheckoutSubmissionSnapshot(raw.snapshot,identity),planned=await submissionPlan.planCheckoutSubmission(snapshot,identity,{accountId,userId});return{identity,snapshot,...planned};};
  const commitPrepared=(f,client=b)=>one(client,'select public.faolla_member_checkout_submission_commit_v2($1,$2,$3,$4,$5,$6,$7) as result',[site,f.identity.operationKey,principal,f.identity.requestHash,f.snapshot,f.plan,f.notAfter]);
  const recover=async f=>{
   const response=await recoverRoute.handleMemberCheckoutRecover(new Request('https://synthetic.faolla.invalid/api/member-checkout/recover',{method:'POST',headers:{origin:'https://synthetic.faolla.invalid','content-type':'application/json'},body:JSON.stringify({siteId:site,nonce:f.request.nonce})}),
    {enabled:()=>true,session:async()=>({accountId,userId,servicePaused:false,user:{id:userId,email_confirmed_at:at}}),read:input=>resultStore.readMemberCheckoutResult(input,async(name,args)=>{
     assert.equal(name,'faolla_member_checkout_result_v2');return{data:(await one(admin,'select public.faolla_member_checkout_result_v2($1,$2,$3) as result',[args.p_site_id,args.p_operation_key,args.p_principal_key])).result,error:null};
    })});
   assert.equal(response.status,200);return response.json();
  };
  await t.test('public module entry HTTP resolves saved catalog IDs against actual PostgreSQL configuration and published sources without touching financial rows',async()=>{
   for(const kind of ['booking','order']){
    const f=await submissionFixture({kind}),query={siteId:site,kind,blockId:f.blockId,viewport:f.offer.checkoutBinding.viewport},before=await all();
    const connection={rpc:async(name,args)=>{assert.equal(name,'faolla_member_checkout_catalog_snapshot_v1');return{data:(await one(a,'select public.faolla_member_checkout_catalog_snapshot_v1($1) as result',[args.p_site_id])).result,error:null};}};
    const response=await entryRoute.handleCheckoutEntry(new Request('https://synthetic.faolla.invalid/api/member-checkout/entry',{method:'POST',headers:{origin:'https://synthetic.faolla.invalid','content-type':'application/json'},body:JSON.stringify(query)}),{
     enabled:()=>true,session:async()=>({accountId,userId,servicePaused:false,user:{id:userId,email_confirmed_at:at}}),
     read:input=>entryStore.readCheckoutEntryOffers(input,{enabled:()=>true,sites:async()=>[f.siteView],configuration:id=>configurationStore.loadCheckoutConfiguration(id,connection),
      published:async id=>({siteId:id,slug:'synthetic-checkout-public',orderManagementEnabled:true,blocks:(await one(a,'select blocks from pages where merchant_id=$1 and slug=$2',[id,'synthetic-checkout-public'])).blocks}),
      catalog:async id=>(await one(a,'select blocks from pages where merchant_id=$1 and slug=$2',[id,`__merchant_catalog__:${id}`])).blocks.catalog})});
    assert.equal(response.status,200);const payload=await response.json();assert.equal(payload.entry.accountId,accountId);assert.equal(payload.entry.offers.length,1);
    assert.equal(payload.entry.offers[0].offerId,f.offer.id);assert.equal(payload.entry.offers[0].offerRevision,f.offer.revision);
    assert.ok(!/unitPoints|stock|claimEventId|couponUses|principalKey|membershipId|cashMinor|customer-synthetic/.test(JSON.stringify(payload)));assert.deepEqual(await all(),before);
   }
  });
  await t.test('actual submission HTTP and trusted snapshot planner commit points, coupon, finite stock and appointment once',async()=>{
   const f=await submissionFixture(),before=await all(),deps={enabled:()=>true,session:async()=>({accountId,userId,servicePaused:false,user:{id:userId,email_confirmed_at:at}}),submit:input=>submission.submitMemberCheckout(input,submitRpc(a))};
   const request=()=>new Request('https://synthetic.faolla.invalid/api/member-checkout/submit',{method:'POST',headers:{origin:'https://synthetic.faolla.invalid','content-type':'application/json'},body:JSON.stringify(f.request)});
   const response=await submitRoute.handleMemberCheckoutSubmit(request(),deps);assert.equal(response.status,200);const first=await response.json();assert.equal(first.result.totalPoints,80);assert.equal(first.result.couponCount,1);assert.equal(first.result.resource.status,'active');
   assert.ok(!/member-synthetic|customer-synthetic|PRIVATE|pointTransactions|editToken|principalKey|sourceRows/.test(JSON.stringify(first)));
   const saved=await all();assert.equal(saved.pages.find(row=>row.slug===memberSlug).blocks[0].pointBalance,920);
   assert.deepEqual(saved.pages.find(row=>row.slug===memberSlug).blocks.slice(1),before.pages.find(row=>row.slug===memberSlug).blocks.slice(1));
   assert.equal(saved.pages.find(row=>row.slug===settingsSlug).blocks.redemptionItems[0].stock,1);
   const replay=await submitRoute.handleMemberCheckoutSubmit(request(),deps);assert.equal(replay.status,200);assert.equal((await replay.json()).replayed,true);assert.deepEqual(await all(),saved);
  });
  await t.test('a lost actual commit response is recovered read-only from the original nonce after offer disable and membership leave',async()=>{
   const f=await submissionFixture(),before=await all();
   await assert.rejects(submit(f,a,async(name,args)=>{const response=await submitRpc(a)(name,args);if(name.includes('commit')&&!response.error)throw new Error('synthetic lost response');return response;}),/checkout_unconfirmed/);
   const committed=await all();assert.equal(committed.results.length,before.results.length+1);assert.equal(committed.pages.find(row=>row.slug===memberSlug).blocks[0].pointBalance,920);
   await admin.query('update faolla_checkout_design.offer_heads set enabled=false where site_id=$1 and offer_id=$2',[site,f.offer.id]);
   const row=await one(admin,'select blocks,to_jsonb(updated_at) as stamp from pages where slug=$1',[memberSlug]),left=structuredClone(row.blocks);left[0].status='left';
   await admin.query('select public.faolla_commit_order_membership_v1($1,$2)',[site,{memberships:{expectedUpdatedAt:row.stamp,next:left}}]);
   const saved=await all(),recovered=await recover(f);assert.equal(recovered.state,'confirmed');assert.equal(recovered.result.totalPoints,80);
   assert.equal(recovered.result.operationKey,submissionPlan.checkoutSubmissionIdentity(f.request,{accountId,userId}).operationKey);
   const replay=await submit(f);assert.equal(replay.replayed,true);assert.deepEqual(replay.result,recovered.result);assert.deepEqual(await all(),saved);
  });
  await t.test('a read during an actually blocked submission is unconfirmed, then resolves the same original without another write',async()=>{
   const f=await submissionFixture(),before=await all();await a.query('begin');let pending;
   try{
    await a.query("select pg_advisory_xact_lock(hashtextextended('faolla-order-membership:'||$1,0))",[site]);pending=submit(f,b).then(value=>({value}),error=>({error}));
    let waiting=false;for(let i=0;i<200;i++){waiting=(await one(admin,"select wait_event_type='Lock' and wait_event='advisory' as waiting from pg_stat_activity where pid=$1",[b.processID]))?.waiting===true;if(waiting)break;await new Promise(resolve=>setTimeout(resolve,5));}
    assert.equal(waiting,true);assert.deepEqual(await recover(f),{ok:true,state:'unconfirmed'});assert.deepEqual(await all(),before);
    await a.query('commit');const result=await pending;assert.ok(result.value,result.error?.message);const recovered=await recover(f);
    assert.equal(recovered.state,'confirmed');assert.deepEqual(recovered.result,result.value.result);assert.equal((await all()).results.length,before.results.length+1);
   }catch(error){await a.query('rollback');if(pending)await pending;throw error;}
  });
  await t.test('distinct customer nonces competing for one appointment cannot both debit or consume coupons',async()=>{
   const f=await submissionFixture({withCoupon:false}),second={...f,request:{...f.request,nonce:randomUUID()}},before=await all();
   const outcomes=await Promise.allSettled([submit(f,a),submit(second,b)]);assert.equal(outcomes.filter(value=>value.status==='fulfilled').length,1);
   const saved=await all();assert.equal(saved.results.length,before.results.length+1);assert.equal(saved.pages.find(row=>row.slug===memberSlug).blocks[0].pointBalance,900);
   assert.equal(saved.pages.find(row=>row.slug===bookingSlug).blocks.records.filter(row=>row.bookingBlockId===f.blockId).length,1);
   await assert.rejects(submit({...f,request:{...f.request,nonce:randomUUID()}},b),/checkout_quantity_unavailable/);assert.deepEqual(await all(),saved);
  });
  await t.test('changed authoritative permissions or published source after preparation reject the entire old bundle',async()=>{
   for(const mode of ['permission','source','member','stock','coupon']){
    const f=await submissionFixture(),prepared=await submitSnapshot(f);
    if(mode==='permission'||mode==='source'){
     const slug=mode==='permission'?'__platform_merchant_snapshot__':'synthetic-checkout-public',row=await one(admin,'select id,blocks from pages where slug=$1',[slug]),next=structuredClone(row.blocks);
     if(mode==='permission')next[0].props.publishedMerchantSnapshot[0].permissionConfig.allowPointsRedemption=false;else next[0].props.bookingStoreOptions=['Changed'];
     await admin.query('update pages set blocks=$2 where id=$1',[row.id,JSON.stringify(next)]);
    }else{
     const slug=mode==='member'?memberSlug:mode==='stock'?settingsSlug:couponSlug,row=await one(admin,'select blocks,to_jsonb(updated_at) as stamp from pages where slug=$1',[slug]),next=structuredClone(row.blocks);
     if(mode==='member')next[0].pointBalance-=5;if(mode==='stock')next.redemptionItems[0].stock=0;if(mode==='coupon')next[0].status='paused';
     await admin.query(mode==='member'?'select public.faolla_commit_order_membership_v1($1,$2)':'select public.faolla_commit_redemption_v1($1,$2)',[site,{[mode==='member'?'memberships':mode==='stock'?'settings':'coupons']:{expectedUpdatedAt:row.stamp,next}}]);
    }
    const before=await all();await assert.rejects(commitPrepared(prepared),/checkout_conflict/);assert.deepEqual(await all(),before);
   }
  });
  await t.test('late appointment storage failure rolls back every trusted-prepared financial change',async()=>{
   const f=await submissionFixture(),prepared=await submitSnapshot(f);prepared.plan.booking.mailJobs=[{invalid:'synthetic late failure'}];
   const before=await all();await assert.rejects(commitPrepared(prepared),/booking_atomic_invalid_mail_intent/);assert.deepEqual(await all(),before);
  });
  await t.test('deadline is checked again after a real member lock wait and cannot permit a late debit',async()=>{
   const f=await submissionFixture(),prepared=await submitSnapshot(f);prepared.notAfter=new Date(Date.now()+1200).toISOString();const before=await all();
   await a.query('begin');let pending;
   try{
    await a.query("select pg_advisory_xact_lock(hashtextextended('faolla-order-membership:'||$1,0))",[site]);pending=commitPrepared(prepared,b).then(value=>({value}),error=>({error}));
    let waiting=false;for(let i=0;i<200;i++){waiting=(await one(admin,"select wait_event_type='Lock' and wait_event='advisory' as waiting from pg_stat_activity where pid=$1",[b.processID]))?.waiting===true;if(waiting)break;await new Promise(resolve=>setTimeout(resolve,5));}
    assert.equal(waiting,true);await admin.query('select pg_sleep(greatest(0,extract(epoch from ($1::timestamptz-clock_timestamp())))+0.05)',[prepared.notAfter]);await a.query('commit');const result=await pending;assert.match(result.error?.message??'',/checkout_quote_expired/);assert.deepEqual(await all(),before);
   }catch(error){await a.query('rollback');if(pending)await pending;throw error;}
  });
  await t.test('points product order is not cash paid and cancellation returns its exact original points/coupon/stock',async()=>{
   const f=await submissionFixture({kind:'order'}),result=await submit(f);
   assert.equal(result.result.resourceKind,'order');const rows=(await admin.query('select blocks from pages where slug~$1',[`^__merchant_orders__:${site}:chunk:[0-9]+$`])).rows.flatMap(row=>row.blocks),order=rows.find(row=>row.id===result.result.resourceId);
   assert.equal(order.totalAmount,0);assert.equal(order.totalQuantity,1);assert.equal(order.items[0].unitPrice,0);assert.equal(order.customerAccountId,accountId);
   const cancelled=(await one(admin,'select public.faolla_member_checkout_cancel_v2($1,$2,$3,$4) as result',[site,result.result.operationKey,principal,result.result.resource.updatedAt])).result;
   assert.equal(cancelled.receipt.pointsReturned,80);assert.equal(cancelled.receipt.couponsReturned,1);assert.equal(cancelled.receipt.stockReleased,1);
   assert.equal((await one(admin,'select blocks from pages where slug=$1',[memberSlug])).blocks[0].pointBalance,1000);
  });
  await t.test('crossing the trusted deadline inside inner storage rolls back every effect instead of returning an expired success',async()=>{
   const f=await submissionFixture(),prepared=await submitSnapshot(f),before=await all();prepared.notAfter=new Date(Date.now()+1200).toISOString();
   await admin.query(`create function public.synthetic_submit_delay() returns trigger language plpgsql as $$begin
    if new.slug='${memberSlug}' then perform pg_sleep(greatest(0,extract(epoch from ('${prepared.notAfter}'::timestamptz-clock_timestamp())))+0.05);end if;return new;end;$$;
    create trigger synthetic_submit_delay after update on public.pages for each row execute function public.synthetic_submit_delay();`);
   try{await assert.rejects(commitPrepared(prepared),/checkout_quote_expired/);assert.deepEqual(await all(),before);}
   finally{await admin.query('drop trigger synthetic_submit_delay on public.pages;drop function public.synthetic_submit_delay()');}
  });
  await t.test('fully coupon covered submission creates a real appointment but no invented point debit or cash charge',async()=>{
   const f=await submissionFixture({couponAmount:100}),result=await submit(f);assert.equal(result.result.totalPoints,0);assert.equal(result.result.couponCount,1);
   assert.equal((await one(admin,'select blocks from pages where slug=$1',[memberSlug])).blocks[0].pointBalance,1000);
  });
  await t.test('a newer published-row insert during the write is detected and rolls the transaction back',async()=>{
   const f=await submissionFixture(),prepared=await submitSnapshot(f),before=await all();
   await admin.query(`create function public.synthetic_submit_phantom() returns trigger language plpgsql as $$begin
    if new.slug='${memberSlug}' then insert into public.pages(merchant_id,slug,blocks) values('${site}','synthetic-phantom','[]'::jsonb);end if;return new;end;$$;
    create trigger synthetic_submit_phantom after update on public.pages for each row execute function public.synthetic_submit_phantom();`);
   try{await assert.rejects(commitPrepared(prepared),/checkout_conflict/);assert.deepEqual(await all(),before);}finally{await admin.query('drop trigger synthetic_submit_phantom on public.pages;drop function public.synthetic_submit_phantom()');}
  });
  await t.test('actual new frontend controller reaches HTTP handlers and real SQL, then restores a lost response using only its durable nonce',async()=>{
   const f=await submissionFixture(),before=await all(),stored=new Map(),paths=[],storage={getItem:key=>stored.get(key)??null,setItem:(key,value)=>{stored.set(key,value);},removeItem:key=>{stored.delete(key);}};
   const session=async()=>({accountId,userId,servicePaused:false,user:{id:userId,email_confirmed_at:at}});
   const request=async(path,body,signal)=>{
    paths.push(path);const req=new Request(`https://synthetic.faolla.invalid${path}`,{method:'POST',headers:{origin:'https://synthetic.faolla.invalid','content-type':'application/json'},body:JSON.stringify(body),signal});let response;
    if(path.endsWith('/preview'))response=await previewRoute.handleMemberCheckoutPreview(req,{enabled:()=>true,session,preview:async input=>{
     const identity=submissionPlan.checkoutSubmissionIdentity({...input.request,nonce:randomUUID(),method:'points',confirmationHash:'0'.repeat(64),customer:f.request.customer},{accountId,userId});
     const snapshot=(await submitRpc(admin)('faolla_member_checkout_submission_snapshot_v2',{p_site_id:site,p_operation_key:identity.operationKey,p_principal_key:principal,p_request_hash:identity.requestHash,p_offer_id:f.offer.id})).data.snapshot;
     return submissionPlan.quoteCheckoutSubmissionSnapshot(snapshot,identity,{accountId,userId});
    }});
    else if(path.endsWith('/submit'))response=await submitRoute.handleMemberCheckoutSubmit(req,{enabled:()=>true,session,submit:input=>submission.submitMemberCheckout(input,submitRpc(a))});
    else{assert.equal(path,'/api/member-checkout/recover');response=await recoverRoute.handleMemberCheckoutRecover(req,{enabled:()=>true,session,read:input=>resultStore.readMemberCheckoutResult(input,async(name,args)=>{
     assert.equal(name,'faolla_member_checkout_result_v2');return{data:(await one(admin,'select public.faolla_member_checkout_result_v2($1,$2,$3) as result',[args.p_site_id,args.p_operation_key,args.p_principal_key])).result,error:null};
    })});}
    const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));
    if(path.endsWith('/submit'))throw new Error('synthetic response lost AFTER real commit');return value;
   };
   const options={siteId:site,accountId,storage,request,exclusive:async(_key,run)=>{await run();return true;},randomNonce:()=>f.request.nonce};
   const controller=checkoutClient.createCheckoutClientController(options);await controller.activate();
   const selection={siteId:site,offerId:f.offer.id,offerRevision:f.offer.revision,quantity:1,appointmentAt:f.request.appointmentAt,couponClaims:f.request.couponClaims};
   await controller.preview(selection);assert.equal(controller.getSnapshot().quote.points,80);assert.deepEqual(await all(),before);
   await controller.submit(f.request.customer);assert.equal(controller.getSnapshot().phase,'unconfirmed');
   const committed=await all();assert.equal(committed.results.length,before.results.length+1);assert.equal(committed.pages.find(row=>row.slug===memberSlug).blocks[0].pointBalance,920);
   assert.equal(stored.size,1);const persisted=[...stored.values()][0];assert.deepEqual(JSON.parse(persisted),{version:1,nonce:f.request.nonce});assert.ok(!/synthetic|customer|coupon|member|Private/.test(persisted));
   controller.deactivate();const restored=checkoutClient.createCheckoutClientController(options);await restored.activate();assert.equal(restored.getSnapshot().phase,'confirmed');assert.equal(restored.getSnapshot().result.totalPoints,80);
   assert.deepEqual(paths.map(value=>value.split('/').pop()),['preview','submit','recover']);assert.deepEqual(await all(),committed);restored.deactivate();
  });
  await t.test('merchant report HTTP and real SQL use a single snapshot, preserve request order, tenant boundaries and exact returns without writes',async()=>{
   const f=await configure({withCoupon:false,withStock:false});await commit(a,f.key,f.plan);
   const ref={kind:'booking',id:f.plan.booking.record.id},scope={siteId:site,resources:[{kind:'order',id:'legacy-unlinked'},ref,{kind:'order',id:ref.id}]};
   const rpc=async(name,args)=>{assert.equal(name,'faolla_member_checkout_reporting_v1');return{data:(await one(a,'select public.faolla_member_checkout_reporting_v1($1,$2) as result',[args.p_site_id,JSON.stringify(args.p_resources)])).result,error:null};};
   const actor={type:'owner',siteId:site,authUserId:'synthetic-owner',principalKey:'owner:synthetic-owner',authorizationVersion:'owner'};
   const deps={enabled:()=>true,actor:async()=>actor,site:async()=>({id:site,status:'online',serviceExpiresAt:'2099-01-01T00:00:00Z'}),read:input=>reportingStore.readCheckoutReporting(input,rpc)};
   const request=()=>new Request('https://synthetic.faolla.invalid/api/merchant-checkout/settlements',{method:'POST',headers:{origin:'https://synthetic.faolla.invalid','content-type':'application/json'},body:JSON.stringify(scope)});
   const before=await all(),response=await reportingRoute.handleCheckoutReporting(request(),deps);assert.equal(response.status,200);
   const snapshot=(await response.json()).snapshot;assert.deepEqual(snapshot.rows.map(r=>({kind:r.kind,id:r.id})),scope.resources);assert.deepEqual(await all(),before);
   assert.equal(snapshot.rows[0].result,null);assert.equal(snapshot.rows[2].result,null);assert.equal(snapshot.rows[1].termsMatch,true);
   assert.equal(snapshot.rows[1].result.totalPoints,10);assert.equal(reporting.checkoutReportingNeedsReview(snapshot.rows[1]),false);
   assert.ok(!/membershipId|pointTransactions|couponUses|settlementCode|principalKey|customer-synthetic|editToken/.test(JSON.stringify(snapshot)));
   const foreign=await reportingStore.readCheckoutReporting({siteId:'10909096',resources:[ref]},rpc);assert.equal(foreign.rows[0].result,null);
   await cancel(a,f);const afterCancel=await all(),returned=await reportingStore.readCheckoutReporting(scope,rpc);
   assert.equal(returned.rows[1].result.closed,true);assert.equal(returned.rows[1].result.cancellation.pointsReturned,10);assert.equal(returned.rows[1].result.resource.status,'cancelled');
   assert.equal(reporting.checkoutReportingNeedsReview(returned.rows[1]),false);assert.deepEqual(await all(),afterCancel);
  });
  await t.test('real product report reads original order chunks without the dropped marker, shows no cash payment, and retains coupons under the original policy',async()=>{
   const f=await configure({kind:'order',returnCoupons:false});
   // Submission fixtures replaced the coupon document above. Keep this new
   // test bound to its actual freshly added claim, not the earlier fixture ID.
   f.plan.coupons.claims[0].couponId=(await one(admin,'select blocks from pages where slug=$1',[couponSlug])).blocks[0].id;
   await commit(a,f.key,f.plan);
   assert.equal(f.plan.order.record.totalAmount,0);assert.equal(f.plan.order.record.checkoutOperationKey,undefined);
   const scope={siteId:site,resources:[{kind:'order',id:f.plan.order.record.id}]};
   const read=async()=>reporting.parseCheckoutReportingSnapshot((await one(admin,'select public.faolla_member_checkout_reporting_v1($1,$2) as result',[site,JSON.stringify(scope.resources)])).result,scope).rows[0];
   const before=await all(),original=await read();assert.deepEqual(await all(),before);
   assert.equal(original.termsMatch,true);assert.equal(original.result.resource.status,'pending');assert.equal(original.result.totalPoints,10);
   assert.equal(reporting.checkoutReportingSettlement(original).method,'points');assert.ok(!/totalMinor|capturedMinor|currency|membershipId|pointTransactions|couponUses|settlementCode/.test(JSON.stringify(original)));
   await cancel(a,f);const after=await all(),returned=await read();assert.deepEqual(await all(),after);
   assert.equal(returned.result.cancellation.pointsReturned,10);assert.equal(returned.result.cancellation.couponsReturned,0);
   assert.equal(returned.result.cancellationPolicy.returnCoupons,false);assert.equal(reporting.checkoutReportingNeedsReview(returned),false);
  });
  await t.test('merchant report flags actual old-writer cancellation, changed terms and changed identity; existing deletion/duplicate guards stay intact',async()=>{
   const f=await configure({withCoupon:false,withStock:false});await commit(a,f.key,f.plan);
   const scope={siteId:site,resources:[{kind:'booking',id:f.plan.booking.record.id}]};
   const read=async()=>reporting.parseCheckoutReportingSnapshot((await one(admin,'select public.faolla_member_checkout_reporting_v1($1,$2) as result',[site,JSON.stringify(scope.resources)])).result,scope).rows[0];
   const original=(await one(admin,'select blocks from pages where slug=$1',[bookingSlug])).blocks;
   const write=async next=>{const state=await one(admin,'select generation,revision::text from faolla_booking_atomic_control where singleton');
    const rows=(await one(admin,'select public.faolla_booking_atomic_rows_v1() as rows')).rows;
    return admin.query('select public.faolla_booking_atomic_commit_v1($1,$2,$3,$4)',[site,op(),op(),{...state,rows,next,result:{syntheticReportFixture:true},mailJobs:[]}]);};
   for(const mode of ['cancelled','terms','identity']){
    const next=structuredClone(original),record=next.records.find(r=>r.id===scope.resources[0].id);
    if(mode==='cancelled')record.status='cancelled';if(mode==='terms')record.item='Changed outside checkout';if(mode==='identity')record.customerAccountId='50010106';
    // Simulate existing legacy writers in this isolated owned database only.
    await write(next);
    const row=await read();assert.equal(row.result.closed,false);assert.equal(row.result.cancellation,null);assert.equal(row.result.totalPoints,10);
    assert.equal(reporting.checkoutReportingNeedsReview(row),true);if(mode==='identity')assert.equal(row.result.resource,null);
   }
   await write(original);assert.equal(reporting.checkoutReportingNeedsReview(await read()),false);
   for(const mode of ['duplicate','missing']){
    const next=structuredClone(original),before=await all();
    if(mode==='duplicate')next.records.push({...next.records.find(r=>r.id===scope.resources[0].id)});else next.records=next.records.filter(r=>r.id!==scope.resources[0].id);
    await assert.rejects(write(next),/booking_atomic_invalid_records|booking_atomic_scope_violation/);assert.deepEqual(await all(),before);
   }
  });
  await t.test('report rejects malformed/unbounded keys in SQL as well as HTTP and performs no writes',async()=>{
   const before=await all();for(const resources of [null,{},[],[{kind:'booking',id:'test',paid:true}],[{kind:'booking',id:'test'},{kind:'booking',id:'test'}],Array.from({length:51},(_,i)=>({kind:'order',id:`test-${i}`}))]){
    await assert.rejects(admin.query('select public.faolla_member_checkout_reporting_v1($1,$2)',[site,JSON.stringify(resources)]),/checkout_reporting_invalid/);
   }assert.deepEqual(await all(),before);
  });
  // Install the NEW proposal only in this owned test cluster, after the old
  // diagnostic cases have established why the additional boundary is needed.
  await admin.query(await readFile(path.resolve('database/proposals/20261123_member_checkout_legacy_boundary.sql'),'utf8'));
  const oldBookingWrite=async next=>{const state=await one(admin,'select generation,revision::text from faolla_booking_atomic_control where singleton');
   const rows=(await one(admin,'select public.faolla_booking_atomic_rows_v1() as rows')).rows;
   return admin.query('select public.faolla_booking_atomic_commit_v1($1,$2,$3,$4)',[site,op(),op(),{...state,rows,next,result:{syntheticGuard:true},mailJobs:[]}]);};
  const oldOrderWrite=async edit=>{const rows=(await one(admin,`select coalesce(jsonb_agg(jsonb_build_object('id',id,'slug',slug,'blocks',blocks,'updated_at',updated_at) order by slug,id),'[]'::jsonb) as rows
    from pages where merchant_id=$1 and (slug=$2 or slug~$3)`,[site,`__merchant_orders__:${site}`,`^__merchant_orders__:${site}:chunk:[0-9]+$`])).rows;
   const records=structuredClone(rows.filter(r=>r.slug.includes(':chunk:')||!rows.some(c=>c.slug.includes(':chunk:'))).flatMap(r=>r.blocks));edit(records);
   return admin.query('select public.faolla_commit_order_membership_v1($1,$2)',[site,{orders:{expectedRows:rows,next:records}}]);};
  const boundaryRpc=client=>async(name,args)=>{try{
   const params=name==='faolla_checkout_resource_link_v1'?[args.p_site_id,args.p_kind,args.p_id,args.p_principal_key]:
    name==='faolla_checkout_merchant_cancel_v1'?[args.p_site_id,args.p_operation_key,args.p_actor_key,args.p_expected_updated_at]:
     name==='faolla_member_checkout_cancel_v2'?[args.p_site_id,args.p_operation_key,args.p_principal_key,args.p_expected_updated_at]:null;
   assert.ok(params);const sql={faolla_checkout_resource_link_v1:'select public.faolla_checkout_resource_link_v1($1,$2,$3,$4) as result',
    faolla_checkout_merchant_cancel_v1:'select public.faolla_checkout_merchant_cancel_v1($1,$2,$3,$4) as result',faolla_member_checkout_cancel_v2:'select public.faolla_member_checkout_cancel_v2($1,$2,$3,$4) as result'}[name];
   return{data:(await one(client,sql,params)).result,error:null};
  }catch(error){return{data:null,error:{message:error.message}};}};
  const owner={type:'owner',siteId:site,authUserId:'synthetic-owner',principalKey:'owner:synthetic-owner',authorizationVersion:'owner',businessPermissions:[],collaborationPermissions:[]};
  const boundaryDeps={enabled:()=>true,anyEnabled:()=>true,actor:async()=>owner,session:async()=>({accountId,userId,servicePaused:false,user:{id:userId,email_confirmed_at:at}}),rpc:()=>boundaryRpc(a)};
  const boundaryInput=(kind,id)=>({request:new Request('https://synthetic.faolla.invalid/api/orders'),mode:'merchant',siteId:site,kind,ids:[id],action:'cancel',actor:owner});
  await t.test('personal original-record entry HTTP uses actual private SQL, not legacy email ownership, and performs no writes',async()=>{
   for(const kind of ['booking','order']){
    const f=await configure({kind,withCoupon:false,withStock:false});await commit(a,f.key,f.plan);
    const resourceId=f.plan.receipt.resourceId,before=await all(),origin='https://synthetic.faolla.invalid';
    const request=new Request(`${origin}/api/member-checkout/resource?siteId=${site}&kind=${kind}&id=${resourceId}`,{headers:{origin,'x-checkout-account-scope':accountId}});
    const response=await resourceRoute.handlePersonalCheckoutResource(request,input=>legacyBoundary.readPersonalCheckoutResource(input,boundaryDeps));
    assert.equal(response.status,200);const payload=await response.json();assert.equal(payload.result.operationKey,f.key);assert.equal(payload.result.resourceId,resourceId);
    assert.ok(!/editToken|principalKey|membershipId|customerName|couponUses/.test(JSON.stringify(payload)));assert.deepEqual(await all(),before);
    const foreignDeps={...boundaryDeps,session:async()=>({accountId:'50010106',userId:'wrong-synthetic',servicePaused:false,user:{email_confirmed_at:at}})};
    const foreign=await resourceRoute.handlePersonalCheckoutResource(new Request(request,{headers:{origin}}),input=>legacyBoundary.readPersonalCheckoutResource(input,foreignDeps));
    assert.equal(foreign.status,404);assert.deepEqual(await all(),before);
   }
  });
  await t.test('final-state booking boundary rejects old cancellation, reschedule and owner changes with complete rollback, while business confirmation stays operational',async()=>{
   const f=await configure({withCoupon:false,withStock:false});await commit(a,f.key,f.plan);
   for(const mode of ['cancel','time','item','identity','zone']){
    const before=await all(),next=structuredClone(before.pages.find(r=>r.slug===bookingSlug).blocks),r=next.records.find(r=>r.id===f.plan.booking.record.id);
    if(mode==='cancel')r.status='cancelled';if(mode==='time')r.appointmentAt='2031-01-01T12:00';if(mode==='item')r.item='Other';if(mode==='identity')r.customerAccountId='50010106';if(mode==='zone')r.appointmentTimeZone='UTC';
    await assert.rejects(oldBookingWrite(next),/checkout_original_cancellation_required|checkout_change_requires_review|checkout_resource_locked/);assert.deepEqual(await all(),before);
   }
   const next=structuredClone((await one(admin,'select blocks from pages where slug=$1',[bookingSlug])).blocks);next.records.find(r=>r.id===f.plan.booking.record.id).status='confirmed';
   const members=(await one(admin,'select blocks from pages where slug=$1',[memberSlug])).blocks;await oldBookingWrite(next);
   assert.deepEqual((await one(admin,'select blocks from pages where slug=$1',[memberSlug])).blocks,members);
   await admin.query('select public.faolla_checkout_merchant_cancel_v1($1,$2,$3,$4)',[site,f.key,owner.principalKey,f.plan.booking.record.updatedAt]);
   const cancelled=await all(),restored=structuredClone(cancelled.pages.find(r=>r.slug===bookingSlug).blocks);restored.records.find(r=>r.id===f.plan.booking.record.id).status='active';
   await assert.rejects(oldBookingWrite(restored),/checkout_original_cancellation_required/);assert.deepEqual(await all(),cancelled);
  });
  await t.test('new order final-state constraint protects prices, cancellation and identity through the ACTUAL old writer and direct API-role page writes',async()=>{
   const f=await configure({kind:'order',withCoupon:false,withStock:false});await commit(a,f.key,f.plan);
   for(const mode of ['cancel','price','identity']){
    const before=await all();await assert.rejects(oldOrderWrite(rows=>{const r=rows.find(r=>r.id===f.plan.order.record.id);if(mode==='cancel')r.status='cancelled';if(mode==='price')r.totalAmount=100;if(mode==='identity')r.customerUserId='other-user';}),/checkout_original_cancellation_required|checkout_change_requires_review|checkout_resource_locked/);assert.deepEqual(await all(),before);
   }
   const direct=await connect('service_role'),row=(await admin.query('select * from pages where merchant_id=$1 and slug~$2',[site,`^__merchant_orders__:${site}:chunk:[0-9]+$`])).rows.find(row=>row.blocks.some(r=>r.id===f.plan.order.record.id));
   const before=await all(),blocks=structuredClone(row.blocks);blocks.find(r=>r.id===f.plan.order.record.id).status='cancelled';
   await assert.rejects(direct.query('update public.pages set blocks=$2 where id=$1',[row.id,JSON.stringify(blocks)]),/checkout_original_cancellation_required/);assert.deepEqual(await all(),before);
   // An unrelated legacy record in the same page remains editable.
   const legacy=structuredClone(row.blocks);legacy.push({id:`legacy-guard-${randomUUID()}`,siteId:site,status:'pending',items:[],totalQuantity:0,totalAmount:0});
   await direct.query('update public.pages set blocks=$2 where id=$1',[row.id,JSON.stringify(legacy)]);
   assert.equal((await one(admin,'select blocks from pages where id=$1',[row.id])).blocks.length,row.blocks.length+1);
  });
  await t.test('owner/customer cancellation race has one original refund and an honest immutable owner audit',async()=>{
   const f=await configure({withCoupon:false,withStock:false});await commit(a,f.key,f.plan);
   const results=await Promise.all([cancel(a,f),one(b,'select public.faolla_checkout_merchant_cancel_v1($1,$2,$3,$4) as result',[site,f.key,owner.principalKey,f.plan.booking.record.updatedAt]).then(r=>r.result)]);
   assert.deepEqual(results.map(r=>r.replayed).sort(),[false,true]);assert.deepEqual(results[0].receipt,results[1].receipt);
   assert.equal(results[0].receipt.pointsReturned,10);
   const audits=(await admin.query('select actor_key from faolla_checkout_design.merchant_cancellation_actors where operation_key=$1',[f.key])).rows;
   assert.equal(audits.length,results[1].replayed?0:1);if(audits.length)assert.equal(audits[0].actor_key,owner.principalKey);
  });
  await t.test('a deferred late resource failure rolls back the already prepared owner refund, coupon/stock facts, cancellation receipt AND audit',async()=>{
   const f=await configure({withCoupon:false,withStock:false});await commit(a,f.key,f.plan);const before=await all();
   await admin.query(`create function public.synthetic_late_checkout_change() returns trigger language plpgsql as $$begin
    if new.slug='${bookingSlug}' and exists(select 1 from jsonb_array_elements(new.blocks->'records') r where r->>'id'='${f.plan.booking.record.id}' and r->>'status'='cancelled') then
      new.blocks:=jsonb_set(new.blocks,'{records}',(select jsonb_agg(case when r->>'id'='${f.plan.booking.record.id}' then r||'{"item":"late tamper"}'::jsonb else r end order by n) from jsonb_array_elements(new.blocks->'records') with ordinality t(r,n)));
    end if;return new;end;$$;create trigger synthetic_late_checkout_change before update on pages for each row execute function public.synthetic_late_checkout_change();`);
   try{await assert.rejects(admin.query('select public.faolla_checkout_merchant_cancel_v1($1,$2,$3,$4)',[site,f.key,owner.principalKey,f.plan.booking.record.updatedAt]),/checkout_change_requires_review/);
    assert.deepEqual(await all(),before);assert.equal((await one(admin,'select count(*)::int as n from faolla_checkout_design.merchant_cancellation_actors where operation_key=$1',[f.key])).n,0);
   }finally{await admin.query('drop trigger synthetic_late_checkout_change on pages;drop function public.synthetic_late_checkout_change()');}
  });
  await t.test('trusted new submissions still commit with the guard, and actual old order HTTP cancellation reaches the original ledger once without legacy writes',async()=>{
   for(const kind of ['booking','order']){
    const f=await submissionFixture({kind}),submitted=await submit(f);assert.equal(submitted.result.totalPoints,80);
    const input=boundaryInput(kind,submitted.result.resourceId);
    let result;
    if(kind==='booking')result=await legacyBoundary.bridgeLegacyCheckoutMutation(input,boundaryDeps);
    else{
     const beforeBusiness=await all(),memberBefore=beforeBusiness.pages.find(r=>r.slug===memberSlug).blocks;
     let preparedMembers=0;
     const orderRpc=async(name,args)=>{try{
      if(name==='faolla_member_checkout_reporting_v1')return{data:(await one(a,'select public.faolla_member_checkout_reporting_v1($1,$2) as result',[args.p_site_id,JSON.stringify(args.p_resources)])).result,error:null};
      assert.equal(name,'faolla_commit_order_membership_v1');return{data:(await one(a,'select public.faolla_commit_order_membership_v1($1,$2) as result',[args.p_site_id,args.p_mutation])).result,error:null};
     }catch(error){return{data:null,error:{message:error.message}};}};
     const completionDeps={createClient:()=>({rpc:orderRpc}),loadOrders:async()=>{
      const rows=(await admin.query('select * from pages where merchant_id=$1 and (slug=$2 or slug~$3) order by slug,id',[site,`__merchant_orders__:${site}`,`^__merchant_orders__:${site}:chunk:[0-9]+$`])).rows;
      const records=rows.filter(r=>r.slug.includes(':chunk:')||!rows.some(c=>c.slug.includes(':chunk:'))).flatMap(r=>r.blocks);
      return{siteId:site,orders:orderRecords.normalizeMerchantOrderRecords(records),storageRows:rows.map(r=>({...r,updated_at:r.updated_at.toISOString()})),updatedAt:null};},
      pointTransitions:ts=>legacyBoundary.legacyCheckoutPointTransitions(ts,{enabled:()=>true,rpc:()=>orderRpc}),
      prepareMemberships:async()=>{preparedMembers++;throw new Error('new paid order must not use old points preparation');},
      saveOrders:(client,input)=>legacyBoundary.saveCheckoutAwareMerchantOrders(client,input,{enabled:()=>true,rpc:()=>orderRpc}),
      mirrorOrders:async()=>({status:'written',count:1}),mirrorMemberships:async()=>{throw new Error('no new legacy member write');}};
     const completed=await legacyOrders.updateMerchantOrderBySite({siteId:site,orderId:submitted.result.resourceId,status:'completed',assertAuthorizationCurrent:async()=>{}},completionDeps);
     assert.equal(completed.status,'completed');assert.equal(preparedMembers,0);assert.deepEqual((await one(admin,'select blocks from pages where slug=$1',[memberSlug])).blocks,memberBefore);
     await legacyOrders.updateMerchantOrderBySite({siteId:site,orderId:submitted.result.resourceId,status:'confirmed',assertAuthorizationCurrent:async()=>{}},completionDeps);
     let legacyWrites=0;const response=await legacyOrderRoute.handleMerchantOrderPatch(new Request('https://synthetic.faolla.invalid/api/orders',{method:'PATCH',headers:{origin:'https://synthetic.faolla.invalid','content-type':'application/json'},body:JSON.stringify({siteId:site,orderId:submitted.result.resourceId,action:'cancel'})}),
      {resolveAdminSession:async()=>({merchantId:site,actor:owner,assertAuthorizationCurrent:async()=>{}}),isManagementEnabled:async()=>true,checkoutBridge:input=>legacyBoundary.bridgeLegacyCheckoutMutation(input,boundaryDeps),updateOrder:async()=>{legacyWrites++;throw new Error('old writer forbidden');}});
     assert.equal(response.status,200);const payload=await response.json();assert.equal(payload.order.status,'cancelled');assert.equal(legacyWrites,0);result={record:payload.order};
    }
    assert.equal(result.record.status,'cancelled');assert.ok(!/editToken|PRIVATE|principalKey|membershipId/.test(JSON.stringify(result)));
    const receipt=(await one(admin,'select receipt from faolla_checkout_design.bundle_cancellations where site_id=$1 and operation_key=$2',[site,submitted.result.operationKey])).receipt;
    assert.equal(receipt.pointsReturned,80);assert.equal(receipt.couponsReturned,1);
    assert.equal((await one(admin,'select actor_key from faolla_checkout_design.merchant_cancellation_actors where site_id=$1 and operation_key=$2',[site,submitted.result.operationKey])).actor_key,owner.principalKey);
    const final=await all();await legacyBoundary.bridgeLegacyCheckoutMutation(input,boundaryDeps);assert.deepEqual(await all(),final);
   }
  });
  await t.test('private legacy lookup rejects cross-customer and cannot be called as a generic unscoped booking index',async()=>{
   const f=await configure({withCoupon:false,withStock:false});await commit(a,f.key,f.plan);const before=await all();
   await assert.rejects(admin.query('select public.faolla_checkout_resource_link_v1($1,$2,$3,$4)',[site,'booking',f.plan.booking.record.id,'account:50010106:wrong-synthetic']),/checkout_not_found/);
   await assert.rejects(admin.query('select public.faolla_checkout_resource_link_v1($1,$2,$3,$4)',[null,'booking',f.plan.booking.record.id,null]),/checkout_unauthorized/);
   assert.deepEqual(await all(),before);
  });
  await t.test('all browser/API roles are denied the private composition function and tables',async()=>{
   for(const role of ['anon','authenticated','service_role']){
    const client=await connect(role);
    await assert.rejects(client.query('select * from faolla_checkout_design.bundle_results'),/permission denied/);
    await assert.rejects(client.query('select faolla_checkout_design.commit_bundle($1,$2,$3,$4,$5)',[site,op(),principal,hash,{}]),/permission denied/);
    await assert.rejects(client.query('select public.faolla_member_checkout_catalog_snapshot_v1($1)',[site]),/permission denied/);
    await assert.rejects(client.query('select faolla_checkout_design.cancel_bundle($1,$2,$3,$4)',[site,op(),principal,at]),/permission denied/);
    await assert.rejects(client.query('select * from faolla_checkout_design.bundle_coupon_returns'),/permission denied/);
    await assert.rejects(client.query('select public.faolla_member_checkout_result_v2($1,$2,$3)',[site,op(),principal]),/permission denied/);
    await assert.rejects(client.query('select public.faolla_member_checkout_cancel_v2($1,$2,$3,$4)',[site,op(),principal,at]),/permission denied/);
    await assert.rejects(client.query('select public.faolla_member_checkout_reporting_v1($1,$2)',[site,JSON.stringify([{kind:'booking',id:'test'}])]),/permission denied/);
    await assert.rejects(client.query('select public.faolla_checkout_resource_link_v1($1,$2,$3,$4)',[site,'booking','test',principal]),/permission denied/);
    await assert.rejects(client.query('select public.faolla_checkout_merchant_cancel_v1($1,$2,$3,$4)',[site,op(),owner.principalKey,at]),/permission denied/);
    await assert.rejects(client.query('select * from faolla_checkout_design.merchant_cancellation_actors'),/permission denied/);
    await assert.rejects(client.query('select public.faolla_member_checkout_submission_snapshot_v2($1,$2,$3,$4,$5)',[site,op(),principal,op(),randomUUID()]),/permission denied/);
    await assert.rejects(client.query('select public.faolla_member_checkout_submission_commit_v2($1,$2,$3,$4,$5,$6,$7)',[site,op(),principal,op(),{},{},at]),/permission denied/);
   }
  });
  await onSitePendingPostgresCases(t,{admin,a,b,one,all,site,accountId,userId,principal,op,submissionFixture,submitSnapshot,memberSlug,settingsSlug,couponSlug,bookingSlug,connect});
  await t.test('new cash read/cancel cannot consume or replay an existing points result or points cancellation',async()=>{
   const original=await one(admin,"select * from faolla_checkout_design.bundle_results where receipt->'version'='1'::jsonb order by operation_key limit 1");assert.ok(original);
   const before=await all();
   assert.equal((await one(admin,'select public.faolla_member_checkout_on_site_result_v1($1,$2,$3) as result',[original.site_id,original.operation_key,original.principal_key])).result,null);
   await assert.rejects(admin.query('select public.faolla_member_checkout_on_site_cancel_v1($1,$2,$3,$4)',[original.site_id,original.operation_key,original.principal_key,at]),/checkout_cancellation_review_required/);
   assert.deepEqual(await all(),before);
  });
  assert.equal((await one(admin,'select count(*)::int as n from faolla_checkout_design.on_site_collections')).n,0,'existing points/unpaid workflows must not manufacture cash collection facts');
  console.log(`[member-checkout-pg] PostgreSQL ${(await one(admin,'show server_version')).server_version}; private checks finished (status in TAP); evidence: ${evidence}`);
 }finally{
  await Promise.all(clients.map(client=>client.end().catch(()=>{})));
  if(started){const pid=(await readFile(path.join(cluster,'postmaster.pid'),'utf8')).split(/\r?\n/);assert.equal(path.resolve(pid[1]).toLowerCase(),path.resolve(cluster).toLowerCase());
   await exec(binaries.pg_ctl,['-D',cluster,'-w','-t','30','-m','fast','stop'],{windowsHide:true,timeout:45000});console.log(`[member-checkout-pg] stopped owned synthetic cluster; retained ${evidence}`);}
 }
});
