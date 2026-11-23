// NEW owned loopback TEMP cluster only. No .env, real DB, mail or Stripe.
// Exercises trusted on-site snapshot -> planner -> composite commit, not UI.
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
import {randomUUID} from 'node:crypto';
import membership from '../src/lib/merchantMemberships.ts';
import settings from '../src/lib/merchantMembershipSettings.ts';
import coupons from '../src/lib/merchantCoupons.ts';
import bookingTime from '../src/lib/merchantBookingTime.ts';
import bookingRules from '../src/lib/merchantBookingRules.ts';
import workbench from '../src/lib/merchantBookingWorkbench.ts';
import platformControl from '../src/data/platformControlStore.ts';
import platformSnapshot from '../src/lib/platformMerchantSnapshot.ts';
import sources from '../src/lib/merchantCheckoutSources.server.ts';
import planner from '../src/lib/merchantCheckoutOnSiteSubmissionPlan.server.ts';
import submission from '../src/lib/merchantCheckoutOnSiteSubmission.server.ts';
import points from '../src/lib/merchantCheckoutSubmissionPlan.server.ts';

test('trusted cash submission verifies real published sources and original atomic writers in isolated PostgreSQL',{timeout:120000},async t=>{
 const runtime=path.resolve(process.env.FAOLLA_BOOKING_TEST_RUNTIME_DIR||'.missing-test-runtime'),relative=path.relative(tmpdir(),runtime);
 assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(runtime).startsWith('faolla-booking-pg-'));
 const requireTest=createRequire(path.join(runtime,'test-loader.cjs')),pgRoot=path.join(runtime,'node_modules/@embedded-postgres/windows-x64');
 assert.equal(JSON.parse(await readFile(path.join(pgRoot,'package.json'),'utf8')).version,'17.10.0-beta.17');
 assert.equal(JSON.parse(await readFile(path.join(runtime,'node_modules/pg/package.json'),'utf8')).version,'8.23.1');
 const {Client}=requireTest('pg'),binaries=await import(pathToFileURL(path.join(pgRoot,'dist/index.js')).href),exec=promisify(execFile);
 const evidence=await mkdtemp(path.join(tmpdir(),'faolla-checkout-cash-submit-test-')),cluster=path.join(evidence,'cluster');
 const socket=net.createServer();await new Promise((resolve,reject)=>{socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve);});
 const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));let started=false,config;const clients=[];
 const one=async(c,sql,args=[])=>(await c.query(sql,args)).rows[0];
 const connect=async role=>{const c=new Client(config);await c.connect();clients.push(c);if(role)await c.query(`set role ${role}`);return c;};
 const site='10909996',accountId='50010105',userId='cash-submit-synthetic',principal=`account:${accountId}:${userId}`,actor='owner:synthetic-owner',who={accountId,userId};
 const memberSlug=`__merchant_memberships__:${site}`,settingsSlug=`__merchant_membership_settings__:${site}`,couponSlug=`__merchant_coupons__:${site}`;
 try{
  await exec(binaries.initdb,['-D',cluster,'-U','cash_submit_admin','-A','trust','--encoding=UTF8','--locale=C'],{windowsHide:true,timeout:60000});
  await exec(binaries.pg_ctl,['-D',cluster,'-l',path.join(evidence,'postgres.log'),'-w','-t','30','-o',`-h 127.0.0.1 -p ${port} -c shared_buffers=16MB -c max_connections=12`,'start'],{windowsHide:true,timeout:45000});started=true;
  config={host:'127.0.0.1',port,user:'cash_submit_admin',database:'postgres',password:'',ssl:false,connectionTimeoutMillis:5000,statement_timeout:15000,query_timeout:20000,application_name:'faolla-cash-submit-isolated'};
  const admin=await connect(),a=await connect(),b=await connect();
  assert.equal(path.resolve((await one(admin,'show data_directory')).data_directory).toLowerCase(),path.resolve(cluster).toLowerCase());
  await admin.query(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
   create table public.pages(id uuid primary key default gen_random_uuid(),merchant_id text,slug text,blocks jsonb,updated_at timestamptz default clock_timestamp());
   create table public.faolla_schema_migrations(version bigint primary key,name text not null);
   grant usage on schema public to anon,authenticated,service_role;grant select,insert,update,delete on pages to service_role;
   create function public.set_pages_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end;$$;
   create trigger set_pages_updated_at before update on pages for each row execute function public.set_pages_updated_at();`);
  const at=new Date().toISOString(),member=membership.normalizeMerchantMembershipRecord({id:'cash-submit-member',siteId:site,accountId,userId,status:'active',pointBalance:0,balanceAmount:33,growthValue:4,joinedAt:at,updatedAt:at});assert.ok(member);
  const seedSettings=settings.createEmptyMerchantMembershipSettings(site);
  seedSettings.redemptionItems=[{id:'cash-stock',categoryId:'',code:'ITEM',barcode:'',name:'Synthetic',imageUrl:'',iconName:'',description:'',enabled:true,pointsCost:100,referenceAmount:null,memberPrice:null,taxRate:null,stock:10,pointProduct:true,recommended:false,sort:0}];
  for(const [merchant,slug,blocks]of [[site,memberSlug,[{...member,futurePrivate:{preserved:true}},{...member,id:'foreign-member',accountId:'50010106',userId:'foreign-customer'}]],
   [site,settingsSlug,seedSettings],[site,couponSlug,[]],['__faolla_booking_persistence__','__merchant_booking_records__:v1',{version:1,records:[]}]])
   await admin.query('insert into pages(merchant_id,slug,blocks) values($1,$2,$3)',[merchant,slug,JSON.stringify(blocks)]);
  for(const file of ['scripts/supabase-migrations/202609080045_order_membership_atomic_mutation.sql','scripts/supabase-migrations/202609080046_redemption_atomic_mutation.sql',
   'scripts/supabase-migrations/202610250211_booking_atomic_preparation.sql','scripts/supabase-migrations/202610250212_booking_atomic_runtime.sql','scripts/supabase-migrations/202611050213_booking_atomic_safeupdate_singleton.sql',
   'database/proposals/20261122_member_checkout_design.sql','database/proposals/20261122_member_checkout_catalog.sql','database/proposals/20261122_member_checkout_bundle.sql',
   'database/proposals/20261122_member_checkout_cancellation.sql','database/proposals/20261122_member_checkout_queries.sql','database/proposals/20261123_member_checkout_legacy_boundary.sql',
   'database/proposals/20261123_member_checkout_on_site_pending.sql','database/proposals/20261123_member_checkout_on_site_cancellation.sql',
   'database/proposals/20261122_member_checkout_submission.sql','database/proposals/20261123_member_checkout_on_site_submission.sql'])await admin.query(await readFile(path.resolve(file),'utf8'));
  await admin.query('update faolla_booking_atomic_control set active=true where singleton');
  await admin.query('insert into faolla_checkout_design.bundle_pilots(site_id,enabled) values($1,true)',[site]);
  const page=slug=>one(admin,'select *,to_jsonb(updated_at) as stamp from pages where slug=$1',[slug]);
  const all=async()=>({pages:(await admin.query('select * from pages order by slug,id')).rows,
   commands:(await admin.query('select * from faolla_booking_atomic_commands order by command_key')).rows,
   control:(await admin.query('select * from faolla_booking_atomic_control')).rows,
   operations:(await admin.query('select * from faolla_redemption_operations order by operation_id')).rows,
   results:(await admin.query('select * from faolla_checkout_design.bundle_results order by operation_key')).rows,
   cancellations:(await admin.query('select * from faolla_checkout_design.bundle_cancellations order by operation_key')).rows,
   returns:(await admin.query('select * from faolla_checkout_design.bundle_coupon_returns order by redeem_event_id')).rows,
   collections:(await admin.query('select * from faolla_checkout_design.on_site_collections order by operation_key')).rows});
  const savePage=async(merchant,slug,value)=>{const found=await one(admin,'select id from pages where merchant_id is not distinct from $1 and slug=$2',[merchant,slug]);
   if(found)await admin.query('update pages set blocks=$2 where id=$1',[found.id,JSON.stringify(value)]);
   else await admin.query('insert into pages(merchant_id,slug,blocks) values($1,$2,$3)',[merchant,slug,JSON.stringify(value)]);};
  const rpc=client=>async(name,args,signal)=>{assert.ok(signal instanceof AbortSignal);try{
   const sql=name==='faolla_member_checkout_on_site_snapshot_v1'?'select public.faolla_member_checkout_on_site_snapshot_v1($1,$2,$3,$4,$5) as result':
    name==='faolla_member_checkout_on_site_commit_v1'?'select public.faolla_member_checkout_on_site_commit_v1($1,$2,$3,$4,$5,$6,$7) as result':null;assert.ok(sql);
   return{data:(await one(client,sql,[args.p_site_id,args.p_operation_key,args.p_principal_key,args.p_request_hash,...(name.includes('snapshot')?[args.p_offer_id]:[args.p_snapshot,args.p_plan,args.p_not_after])])).result,error:null};
  }catch(error){return{data:null,error:{message:error.message}};}};
  const fixture=async({kind='booking',withCoupon=true,covered=false,cashOnly=false}={})=>{
   const stamp=new Date().toISOString(),blockId=`cash-${kind}-${randomUUID()}`,appointmentAt=`${bookingTime.bookingWallTimeAt(new Date(Date.now()+3*86400000),'Europe/Madrid').slice(0,10)}T12:00`;
   const blocks=[kind==='booking'?{id:blockId,type:'booking',props:{bookingStoreOptions:['Synthetic'],bookingItemOptions:['Play'],bookingTitleOptions:['Mx'],bookingTimeSlotRules:[{timeRange:'10:00-18:00',maxBookings:1}]}}:{id:blockId,type:'product',props:{products:[]}}];
   const catalog=kind==='order'?{revision:1,updatedAt:stamp,pricePrefix:'€',categories:[],products:[{id:'cash-product',code:'P',name:'Synthetic product',description:'',price:'10.00',imageUrl:'',thumbnailUrl:'',tag:'',availability:'available'}],
    collections:[{id:'cash-collection',blockId,viewport:'shared',productIds:['cash-product']}]}:null;
   const source=sources.buildCheckoutSourceChoices({siteId:site,siteName:'Synthetic',blocks,catalog,allowBooking:kind==='booking',allowOrder:kind==='order'})[0];assert.ok(source);
   const permissionConfig={...platformControl.createDefaultMerchantPermissionConfig(),allowBookingBlock:true,allowProductBlock:true,allowOrderManagement:true,allowMembershipManagement:true,allowPointsRedemption:false,allowCouponModule:withCoupon};
   const siteView=platformSnapshot.buildPlatformMerchantSnapshotSite({id:site,name:'Synthetic',status:'online',serviceExpiresAt:'2099-01-01T00:00:00Z',permissionConfig});assert.ok(siteView);
   const root=()=>platformSnapshot.buildPlatformMerchantSnapshotBlocks(platformSnapshot.normalizePlatformMerchantSnapshotPayload({revision:randomUUID(),snapshot:[siteView],defaultSortRule:'created_desc',merchantConfigHistoryBySiteId:{}}));
   await savePage(null,'__platform_merchant_snapshot__',root());await savePage(site,'cash-synthetic-public',blocks);
   if(catalog)await savePage(site,`__merchant_catalog__:${site}`,{kind:'merchant_catalog',siteId:site,catalog});
   if(kind==='booking')for(const [key,property,value]of [['rules','snapshots',bookingRules.buildMerchantBookingRulesSnapshot(site,blocks,stamp)],['workbench','settingsBySiteId',{...workbench.createDefaultMerchantBookingWorkbenchSettings(),timeZone:'Europe/Madrid'}]]){
    const slug=key==='rules'?'__merchant_booking_rules__:v1':'__merchant_booking_workbench__:v1',current=(await page(slug))?.blocks??{version:1,[property]:{}};
    await admin.query('select public.faolla_booking_atomic_configuration_v2($1,$2,$3)',[site,key,{...current,[property]:{...current[property],[site]:value}}]);
   }
   const members=await page(memberSlug),config=await page(settingsSlug),couponRow=await page(couponSlug),nextMembers=structuredClone(members.blocks);nextMembers[0].status='active';
   const nextSettings=structuredClone(config.blocks);nextSettings.redemptionItems[0].stock=10;
   const coupon=coupons.normalizeMerchantCouponRecord({id:`cash-coupon-${randomUUID()}`,siteId:site,code:`CO${randomUUID().replaceAll('-','').slice(0,16)}`,title:'Synthetic cash coupon',status:'active',
    discountType:'amount_off',discountValue:covered?10:2,usageScenarios:['order_cart'],createdAt:stamp,updatedAt:stamp,
    claimEvents:[{id:`claim-${randomUUID()}`,at:stamp,accountId,userId,email:'synthetic@example.invalid',customerName:'Synthetic',code:'',settlementType:'qr',settlementCode:`PRIVATE-${randomUUID()}`,validUntil:null}]});assert.ok(coupon);
   await admin.query('select public.faolla_commit_redemption_v1($1,$2)',[site,{settings:{expectedUpdatedAt:config.stamp,next:nextSettings},memberships:{expectedUpdatedAt:members.stamp,next:nextMembers},coupons:{expectedUpdatedAt:couponRow.stamp,next:[coupon,...couponRow.blocks]}}]);
   const offerId=randomUUID(),revision=randomUUID(),offer={version:1,id:offerId,revision,siteId:site,enabled:true,title:'Synthetic cash submission',maxQuantity:kind==='booking'?1:5,
    source:kind==='booking'?{kind,blockId,serviceId:offerId,timeZone:'Europe/Madrid'}:{kind,blockId,collectionId:source.collectionId,productId:source.productId},cash:{currency:'eur',unitAmountMinor:1000,initialPolicy:{mode:'full'}},unitPoints:cashOnly?null:100,allowOnSite:true,couponReturnOnCancel:true,
    checkoutBinding:{sourceKey:source.key,sourceVersion:source.sourceVersion,viewport:source.viewport,...(kind==='booking'?{store:source.store,item:source.item}:{}),stockItemId:'cash-stock',voucherCouponIds:[],durationMinutes:60,pointsReturnOnCancel:true,cancellationAdvanceMinutes:60}};
   const current=(await one(admin,'select public.faolla_member_checkout_catalog_snapshot_v1($1) as result',[site])).result;
   await admin.query('select public.faolla_member_checkout_catalog_save_v1($1,$2,$3,$4,$5)',[site,current.version,randomUUID(),actor,offer]);
   const request={siteId:site,offerId,offerRevision:revision,quantity:1,...(kind==='booking'?{appointmentAt}:{}),couponClaims:withCoupon?[{couponId:coupon.id,claimEventId:coupon.claimEvents[0].id}]:[],method:'on_site',nonce:randomUUID(),confirmationHash:'0'.repeat(64),customer:{name:'Synthetic',title:'Mx',email:'synthetic@example.invalid',phone:'000000000',note:''}};
   const preview=await submission.previewOnSiteCheckout({request,principal:who,authorize:async()=>who},rpc(admin));assert.ok(preview.quote);request.confirmationHash=preview.quote.confirmationHash;
   return{request,offer,blockId,siteView,root,coupon};
  };
  const submit=(f,client=a,override)=>submission.submitOnSiteCheckout({request:f.request,principal:who,authorize:async()=>who},override??rpc(client));
  const prepare=async f=>{const identity=planner.onSiteSubmissionIdentity(f.request,who),read=await rpc(admin)('faolla_member_checkout_on_site_snapshot_v1',{p_site_id:site,p_operation_key:identity.operationKey,p_principal_key:principal,p_request_hash:identity.requestHash,p_offer_id:f.offer.id},new AbortController().signal);
   assert.equal(read.error,null);const snapshot=planner.parseOnSiteSubmissionSnapshot(read.data.snapshot,identity);return{identity,snapshot,...planner.planOnSiteSubmission(snapshot,identity,who)};};
  const commit=(p,client=b)=>one(client,'select public.faolla_member_checkout_on_site_commit_v1($1,$2,$3,$4,$5,$6,$7) as result',[site,p.identity.operationKey,principal,p.identity.requestHash,p.snapshot,p.plan,p.notAfter]);
  const readResult=async f=>submission.recoverOnSiteCheckout({siteId:site,nonce:f.request.nonce},{authorize:async()=>who,call:async(name,args,signal)=>{
   assert.ok(signal instanceof AbortSignal);
   assert.equal(name,'faolla_member_checkout_on_site_result_v1');return{data:(await one(admin,'select public.faolla_member_checkout_on_site_result_v1($1,$2,$3) as result',[site,args.p_operation_key,args.p_principal_key])).result,error:null};
  }});

  await t.test('actual booking and product cash submissions keep membership bytes, debit no points, consume one coupon/stock and create an unpaid resource once',async()=>{
   for(const kind of ['booking','order']){
    const f=await fixture({kind}),before=await all(),memberBefore=await page(memberSlug),first=await submit(f);assert.equal(first.result.terms.dueMinor,800);assert.equal(first.result.terms.capturedMinor,0);
    assert.equal(first.result.terms.totalPoints,null);assert.equal(first.result.terms.paymentState,'unpaid');assert.equal(first.result.collection,null);assert.equal(first.result.termsMatch,true);
    assert.deepEqual(await page(memberSlug),memberBefore);assert.equal((await page(settingsSlug)).blocks.redemptionItems[0].stock,9);
    assert.equal((await page(couponSlug)).blocks.find(c=>c.id===f.coupon.id).redeemEvents.length,1);
    assert.equal((await all()).operations.length,before.operations.length);const saved=await all();
    assert.equal((await submit(f)).replayed,true);assert.deepEqual(await all(),saved);
    assert.ok(!/PRIVATE|memberId|cash-submit-synthetic|editToken|sourceRows|principalKey/.test(JSON.stringify(first)));
    if(kind==='order'){
     const rows=(await admin.query('select slug,blocks from pages where merchant_id=$1 and (slug=$2 or slug like $3)',[site,`__merchant_orders__:${site}`,`__merchant_orders__:${site}:chunk:%`])).rows;
     const chunks=rows.filter(row=>row.slug.includes(':chunk:')),orders=(chunks.length?chunks:rows).flatMap(row=>row.blocks),record=orders.find(r=>r.id===first.result.terms.resourceId);
     assert.ok(record);assert.equal(record.totalAmount,10);assert.equal(record.items[0].unitPrice,10);
    }
   }
  });
  await t.test('cash-only with no coupon permission and coupon-covered bookings work without point entitlement or balance',async()=>{
   for(const options of [{cashOnly:true,withCoupon:false},{covered:true}]){
    const f=await fixture(options),before=await page(memberSlug),r=await submit(f);assert.equal(r.result.terms.dueMinor,options.covered?0:1000);
    assert.equal(r.result.terms.paymentState,options.covered?'coupon_covered':'unpaid');assert.deepEqual(await page(memberSlug),before);
   }
  });
  await t.test('lost response is recovered by original nonce after offer disable/member leave; replay still returns the original',async()=>{
   const f=await fixture();let writes=0;
   await assert.rejects(submit(f,a,async(...args)=>{const response=await rpc(a)(...args);if(args[0].includes('commit')&&!response.error){writes++;throw new Error('lost synthetic response');}return response;}),/checkout_unconfirmed/);assert.equal(writes,1);
   await admin.query('update faolla_checkout_design.offer_heads set enabled=false where site_id=$1 and offer_id=$2',[site,f.offer.id]);
   const member=await page(memberSlug),next=structuredClone(member.blocks);next[0].status='left';
   await admin.query('select public.faolla_commit_order_membership_v1($1,$2)',[site,{memberships:{expectedUpdatedAt:member.stamp,next}}]);
   const before=await all(),result=await readResult(f);assert.equal(result.terms.dueMinor,800);assert.equal((await submit(f)).replayed,true);assert.deepEqual(await all(),before);
  });
  await t.test('same original nonce cannot change method or customer intent, and foreign principal cannot read it',async()=>{
   const f=await fixture();await submit(f);const before=await all(),pointIdentity=points.checkoutSubmissionIdentity({...f.request,method:'points'},who);
   assert.equal(pointIdentity.operationKey,planner.onSiteSubmissionIdentity(f.request,who).operationKey);
   await assert.rejects(admin.query('select public.faolla_member_checkout_submission_snapshot_v2($1,$2,$3,$4,$5)',[site,pointIdentity.operationKey,principal,pointIdentity.requestHash,f.offer.id]),/checkout_operation_conflict/);
   await assert.rejects(submit({...f,request:{...f.request,customer:{...f.request.customer,note:'changed'}}}),/checkout_operation_conflict/);
   assert.equal((await one(admin,'select public.faolla_member_checkout_on_site_result_v1($1,$2,$3) as result',[site,pointIdentity.operationKey,'account:50010106:foreign-synthetic'])).result,null);assert.deepEqual(await all(),before);
  });
  await t.test('source permissions, price, coupon, member/settings and booking-vector changes after preparation reject the entire transaction',async()=>{
   for(const scenario of ['permission','published','catalog','coupon','member','stock','booking']){
    const f=await fixture({kind:scenario==='catalog'?'order':'booking'}),p=await prepare(f);
    if(scenario==='permission'){f.siteView.permissionConfig.allowBookingBlock=false;await savePage(null,'__platform_merchant_snapshot__',f.root());}
    if(scenario==='published')await savePage(site,'cash-synthetic-public',[]);
    if(scenario==='catalog'){const row=await page(`__merchant_catalog__:${site}`);row.blocks.catalog.products[0].price='11.00';await savePage(site,row.slug,row.blocks);}
    if(scenario==='coupon'){const row=await page(couponSlug);row.blocks.find(c=>c.id===f.coupon.id).discountValue=3;await savePage(site,row.slug,row.blocks);}
    if(scenario==='member'){const row=await page(memberSlug);row.blocks[0].status='left';await savePage(site,row.slug,row.blocks);}
    if(scenario==='stock'){const row=await page(settingsSlug);row.blocks.redemptionItems[0].stock=0;await savePage(site,row.slug,row.blocks);}
    if(scenario==='booking'){const row=await page('__merchant_booking_workbench__:v1');row.blocks.settingsBySiteId[site].bufferMinutes=5;await admin.query('select public.faolla_booking_atomic_configuration_v2($1,$2,$3)',[site,'workbench',row.blocks]);}
    const before=await all();await assert.rejects(commit(p),/checkout_conflict/);assert.deepEqual(await all(),before);
   }
  });
  await t.test('a competing cash submit from the same snapshot is rejected without coupon/stock/resource side effects',async()=>{
   const f=await fixture(),first=await prepare(f),other=await prepare({...f,request:{...f.request,nonce:randomUUID()}});
   await commit(first);const before=await all();await assert.rejects(commit(other),/checkout_conflict/);assert.deepEqual(await all(),before);
  });
  await t.test('original cancellation restores stock and the original coupon once, never writes membership or cash refund',async()=>{
   const f=await fixture(),r=(await submit(f)).result,before=await page(memberSlug);
   const input=[site,r.operationKey,principal,r.resource.updatedAt],cancel=(await one(a,'select public.faolla_member_checkout_on_site_cancel_v1($1,$2,$3,$4) as result',input)).result;
   assert.equal(cancel.receipt.cashReturnedMinor,0);assert.equal(cancel.receipt.pointsReturned,0);assert.equal(cancel.receipt.couponsReturned,1);
   assert.equal((await page(settingsSlug)).blocks.redemptionItems[0].stock,10);assert.deepEqual(await page(memberSlug),before);
   const saved=await all();assert.equal((await one(b,'select public.faolla_member_checkout_on_site_cancel_v1($1,$2,$3,$4) as result',input)).result.replayed,true);assert.deepEqual(await all(),saved);
  });
  await t.test('new published row inserted inside the inner writer rolls back all effects including the row',async()=>{
   const f=await fixture(),p=await prepare(f);
   await admin.query(`create function test_cash_source_insert() returns trigger language plpgsql as $$begin
    insert into pages(merchant_id,slug,blocks) values('${site}','cash-new-published','[]');return new;end;$$;
    create trigger test_cash_source_insert after insert on faolla_checkout_design.bundle_results for each row execute function test_cash_source_insert();`);
   try{const before=await all();await assert.rejects(commit(p),/checkout_conflict/);assert.deepEqual(await all(),before);}
   finally{await admin.query('drop trigger test_cash_source_insert on faolla_checkout_design.bundle_results;drop function test_cash_source_insert()');}
  });
  await t.test('an expired deadline after an inner write rolls back the whole original transaction',async()=>{
   const f=await fixture(),p=await prepare(f);p.notAfter=new Date(Date.now()+450).toISOString();
   await admin.query(`create function test_cash_delay() returns trigger language plpgsql as $$begin perform pg_sleep(0.8);return new;end;$$;
    create trigger test_cash_delay after insert on faolla_checkout_design.bundle_results for each row execute function test_cash_delay();`);
   try{const before=await all();await assert.rejects(commit(p),/checkout_quote_expired/);assert.deepEqual(await all(),before);}
   finally{await admin.query('drop trigger test_cash_delay on faolla_checkout_design.bundle_results;drop function test_cash_delay()');}
  });
  await t.test('a request waiting for the original operation lock cannot write after its deadline',async()=>{
   const f=await fixture(),p=await prepare(f);p.notAfter=new Date(Date.now()+600).toISOString();await a.query('begin');
   try{
    await a.query("select pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||$1,0))",[site]);const before=await all();
    const pending=commit(p,b).then(()=>null,error=>error);await admin.query('select pg_sleep(0.9)');await a.query('commit');
    assert.match((await pending)?.message??'',/checkout_quote_expired/);assert.deepEqual(await all(),before);
   }finally{await a.query('rollback');}
  });
  await t.test('non-finite or oversized deadlines and wrong raw protocol are rejected without writes',async()=>{
   const f=await fixture(),p=await prepare(f),before=await all();
   for(const value of ['infinity','-infinity',new Date(Date.parse(p.snapshot.databaseNow)+31000).toISOString()])await assert.rejects(commit({...p,notAfter:value}),/checkout_quote_expired/);
   await assert.rejects(commit({...p,snapshot:{...p.snapshot,version:2,method:'points'}}),/checkout_invalid_plan/);assert.deepEqual(await all(),before);
  });
  await t.test('API roles have no execute grants or private schema privileges',async()=>{
   for(const role of ['anon','authenticated','service_role']){
    const c=await connect(role);for(const name of ['faolla_member_checkout_on_site_snapshot_v1(text,text,text,text,text)','faolla_member_checkout_on_site_commit_v1(text,text,text,text,jsonb,jsonb,text)'])
     assert.equal((await one(c,'select has_function_privilege(current_user,$1,\'EXECUTE\') as allowed',[`public.${name}`])).allowed,false);
    await assert.rejects(c.query('select * from faolla_checkout_design.bundle_results'),/permission denied/);
   }
  });
  console.log(`CASH_SUBMISSION_EVIDENCE=${evidence}`);
 }finally{
  await Promise.all(clients.map(c=>c.end().catch(()=>{})));
  if(started){
   const postmaster=(await readFile(path.join(cluster,'postmaster.pid'),'utf8')).split(/\r?\n/);
   assert.equal(path.resolve(postmaster[1]).toLowerCase(),path.resolve(cluster).toLowerCase());assert.equal(Number(postmaster[3]),port);
   await exec(binaries.pg_ctl,['-D',cluster,'-w','-t','30','stop','-m','fast'],{windowsHide:true,timeout:45000});
  }
  console.log(`CASH_SUBMISSION_CLUSTER_STOPPED=${evidence}`);
 }
});
