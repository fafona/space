// NEW owned synthetic TEMP cluster only. No .env, production URL, Stripe/mail.
// Private kernel + injected result adapter acceptance, not a released HTTP UI.
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
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import membership from '../src/lib/merchantMemberships.ts';
import settings from '../src/lib/merchantMembershipSettings.ts';
import coupons from '../src/lib/merchantCoupons.ts';
import orders from '../src/lib/merchantOrders.ts';
import bookingTime from '../src/lib/merchantBookingTime.ts';
import pending from '../src/lib/merchantCheckoutOnSitePending.server.ts';
import results from '../src/lib/merchantCheckoutOnSiteResult.server.ts';

test('cash original cancellation and result use real original writers and immutable facts in isolated PostgreSQL',{timeout:120000},async t=>{
 const runtime=path.resolve(process.env.FAOLLA_BOOKING_TEST_RUNTIME_DIR||'.missing-test-runtime'),relative=path.relative(tmpdir(),runtime);
 assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(runtime).startsWith('faolla-booking-pg-'));
 const requireTest=createRequire(path.join(runtime,'test-loader.cjs')),pgRoot=path.join(runtime,'node_modules/@embedded-postgres/windows-x64');
 assert.equal(JSON.parse(await readFile(path.join(pgRoot,'package.json'),'utf8')).version,'17.10.0-beta.17');
 assert.equal(JSON.parse(await readFile(path.join(runtime,'node_modules/pg/package.json'),'utf8')).version,'8.23.1');
 const {Client}=requireTest('pg'),binaries=await import(pathToFileURL(path.join(pgRoot,'dist/index.js')).href),exec=promisify(execFile);
 const evidence=await mkdtemp(path.join(tmpdir(),'faolla-checkout-cash-cancel-test-')),cluster=path.join(evidence,'cluster');
 const socket=net.createServer();await new Promise((resolve,reject)=>{socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve);});
 const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));let started=false,config;const clients=[];
 const one=async(c,sql,args=[])=>(await c.query(sql,args)).rows[0];
 const connect=async role=>{const c=new Client(config);await c.connect();clients.push(c);if(role)await c.query(`set role ${role}`);return c;};
 const site='10909997',accountId='50010105',userId='cash-customer-synthetic',principal=`account:${accountId}:${userId}`,actor='owner:synthetic-owner';
 const memberSlug=`__merchant_memberships__:${site}`,settingsSlug=`__merchant_membership_settings__:${site}`,couponSlug=`__merchant_coupons__:${site}`,bookingSlug='__merchant_booking_records__:v1';
 const op=()=>createHash('sha256').update(randomUUID()).digest('hex');
 try{
  await exec(binaries.initdb,['-D',cluster,'-U','cash_test_admin','-A','trust','--encoding=UTF8','--locale=C'],{windowsHide:true,timeout:60000});
  await exec(binaries.pg_ctl,['-D',cluster,'-l',path.join(evidence,'postgres.log'),'-w','-t','30','-o',`-h 127.0.0.1 -p ${port} -c shared_buffers=16MB -c max_connections=12`,'start'],{windowsHide:true,timeout:45000});started=true;
  config={host:'127.0.0.1',port,user:'cash_test_admin',database:'postgres',password:'',ssl:false,connectionTimeoutMillis:5000,statement_timeout:15000,query_timeout:20000,application_name:'faolla-cash-cancel-isolated'};
  const admin=await connect(),a=await connect(),b=await connect();
  assert.equal(path.resolve((await one(admin,'show data_directory')).data_directory).toLowerCase(),path.resolve(cluster).toLowerCase());
  await admin.query(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
   create table public.pages(id uuid primary key default gen_random_uuid(),merchant_id text,slug text,blocks jsonb,updated_at timestamptz default clock_timestamp());
   create table public.faolla_schema_migrations(version bigint primary key,name text not null);
   grant usage on schema public to anon,authenticated,service_role;grant select,insert,update,delete on pages to service_role;
   create function public.set_pages_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end;$$;
   create trigger set_pages_updated_at before update on pages for each row execute function public.set_pages_updated_at();`);
  const at=new Date().toISOString(),member=membership.normalizeMerchantMembershipRecord({id:'cash-cancel-member',siteId:site,accountId,userId,status:'active',pointBalance:1000,balanceAmount:33,growthValue:4,joinedAt:at,updatedAt:at});assert.ok(member);
  const seedSettings=settings.createEmptyMerchantMembershipSettings(site);
  seedSettings.redemptionItems=[{id:'cash-stock',categoryId:'',code:'ITEM',barcode:'',name:'Synthetic',imageUrl:'',iconName:'',description:'',enabled:true,pointsCost:100,referenceAmount:null,memberPrice:null,taxRate:null,stock:10,pointProduct:true,recommended:false,sort:0}];
  for(const [merchant,slug,blocks]of [[site,memberSlug,[{...member,futurePrivate:{preserved:true}},{...member,id:'foreign-member',accountId:'50010106',userId:'foreign-customer'}]],
   [site,settingsSlug,seedSettings],[site,couponSlug,[]],['__faolla_booking_persistence__',bookingSlug,{version:1,records:[]}]])
   await admin.query('insert into pages(merchant_id,slug,blocks) values($1,$2,$3)',[merchant,slug,JSON.stringify(blocks)]);
  for(const file of ['scripts/supabase-migrations/202609080045_order_membership_atomic_mutation.sql','scripts/supabase-migrations/202609080046_redemption_atomic_mutation.sql',
   'scripts/supabase-migrations/202610250211_booking_atomic_preparation.sql','scripts/supabase-migrations/202610250212_booking_atomic_runtime.sql','scripts/supabase-migrations/202611050213_booking_atomic_safeupdate_singleton.sql',
   'database/proposals/20261122_member_checkout_design.sql','database/proposals/20261122_member_checkout_catalog.sql','database/proposals/20261122_member_checkout_bundle.sql',
   'database/proposals/20261122_member_checkout_cancellation.sql','database/proposals/20261122_member_checkout_queries.sql','database/proposals/20261123_member_checkout_legacy_boundary.sql',
   'database/proposals/20261123_member_checkout_on_site_pending.sql','database/proposals/20261123_member_checkout_on_site_cancellation.sql'])await admin.query(await readFile(path.resolve(file),'utf8'));
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
   audits:(await admin.query('select * from faolla_checkout_design.merchant_cancellation_actors order by operation_key')).rows,
   collections:(await admin.query('select * from faolla_checkout_design.on_site_collections order by operation_key')).rows});
  const fixture=async({kind='booking',returnCoupons=true,withCoupon=true,withStock=true,covered=false,expiredPolicy=false}={})=>{
   const stamp=new Date().toISOString(),members=await page(memberSlug),config=await page(settingsSlug),couponRow=await page(couponSlug),nextMembers=structuredClone(members.blocks);
   nextMembers[0].status='active';const nextSettings=structuredClone(config.blocks);nextSettings.redemptionItems[0].stock=10;
   const coupon=coupons.normalizeMerchantCouponRecord({id:`coupon-${randomUUID()}`,siteId:site,code:`CO${randomUUID().replaceAll('-','').slice(0,16)}`,title:'Synthetic cash coupon',status:'active',
    discountType:'amount_off',discountValue:covered?10:2,usageScenarios:['order_cart'],createdAt:stamp,updatedAt:stamp,
    claimEvents:[{id:`claim-${randomUUID()}`,at:stamp,accountId,userId,email:'synthetic@example.invalid',customerName:'Synthetic',code:'',settlementType:'qr',settlementCode:`PRIVATE-${randomUUID()}`,validUntil:'2099-01-01T00:00:00Z'}]});assert.ok(coupon);
   await admin.query('select public.faolla_commit_redemption_v1($1,$2)',[site,{settings:{expectedUpdatedAt:config.stamp,next:nextSettings},memberships:{expectedUpdatedAt:members.stamp,next:nextMembers},coupons:{expectedUpdatedAt:couponRow.stamp,next:[coupon,...couponRow.blocks]}}]);
   const id=randomUUID(),revision=randomUUID(),blockId=`synthetic-block-${randomUUID()}`,offer={version:1,id,revision,siteId:site,enabled:true,title:'Synthetic cash',maxQuantity:1,
    source:kind==='booking'?{kind,blockId,serviceId:id,timeZone:'Europe/Madrid'}:{kind,blockId,collectionId:'synthetic-collection',productId:'synthetic-product'},
    cash:{currency:'eur',unitAmountMinor:1000,initialPolicy:{mode:'full'}},unitPoints:null,allowOnSite:true,couponReturnOnCancel:returnCoupons,
    checkoutBinding:{sourceKey:op(),sourceVersion:op(),viewport:'desktop',...(kind==='booking'?{store:'Synthetic',item:'Play'}:{}),stockItemId:withStock?'cash-stock':null,
     voucherCouponIds:[],durationMinutes:60,pointsReturnOnCancel:false,cancellationAdvanceMinutes:expiredPolicy?120:60}};
   const current=(await one(admin,'select public.faolla_member_checkout_catalog_snapshot_v1($1) as result',[site])).result;
   await admin.query('select public.faolla_member_checkout_catalog_save_v1($1,$2,$3,$4,$5)',[site,current.version,randomUUID(),actor,offer]);
   const resourceId=`synthetic-${randomUUID()}`,key=op(),hash=op(),selection={offerId:id,offerRevision:revision,quantity:1,...(kind==='booking'?{slotKey:'synthetic-slot'}:{}),
    couponClaims:withCoupon?[{couponId:coupon.id,claimEventId:coupon.claimEvents[0].id}]:[]};
   const updatedMembers=await page(memberSlug),updatedCoupons=await page(couponSlug),updatedSettings=await page(settingsSlug);
   const payment=pending.prepareOnSitePendingTerms({siteId:site,offer,selection,principal:{accountId,userId},membership:updatedMembers.blocks[0],coupons:updatedCoupons.blocks,tags:[],now:new Date().toISOString(),resourceId});
   let resource;
   if(kind==='booking'){
    const state=await one(admin,'select generation,revision::text from faolla_booking_atomic_control where singleton');
    resource={...state,mailJobs:[],record:{id:resourceId,siteId:site,siteName:'Synthetic',customerAccountId:accountId,customerUserId:userId,customerLoginEmail:'',customerGuestHash:'',
     bookingBlockId:blockId,bookingViewport:'desktop',store:'Synthetic',item:'Play',title:'Mx',customerName:'Synthetic',email:'synthetic@example.invalid',phone:'000000000',note:'',
     appointmentAt:bookingTime.bookingWallTimeAt(new Date(Date.now()+(expiredPolicy?90*60000:3*86400000)),'Europe/Madrid'),appointmentTimeZone:'Europe/Madrid',status:'active',
     createdAt:stamp,updatedAt:stamp,merchantTouchedAt:'',editToken:randomBytes(18).toString('hex'),customerReminderProcessedMinutes:[],merchantReminderProcessedMinutes:[],
     checkoutOperationKey:key,timeline:[{id:`checkout-${key}`,actor:'customer',kind:'created',at:stamp}]}};
   }else{
    const versions=(await one(admin,`select coalesce(jsonb_agg(jsonb_build_object('id',id,'slug',slug,'updatedAt',updated_at) order by slug,id),'[]'::jsonb) as rows
     from pages where merchant_id=$1 and (slug=$2 or slug~$3)`,[site,`__merchant_orders__:${site}`,`^__merchant_orders__:${site}:chunk:[0-9]+$`])).rows;
    resource={expectedVersions:versions,record:{...orders.createMerchantOrder({siteId:site,siteName:'Synthetic',blockId,customerAccountId:accountId,customerUserId:userId,
     customer:{name:'Synthetic',title:'Mx',email:'synthetic@example.invalid',phone:'000000000',note:''},pricePrefix:'€',items:[{productId:'synthetic-product',code:'P',name:'Synthetic',quantity:1,unitPrice:10}]},
     {id:resourceId,createdAt:stamp,updatedAt:stamp}),checkoutOperationKey:key}};
   }
   const plan={offer:payment.offer,quantity:1,membership:{id:payment.membershipId,expectedUpdatedAt:updatedMembers.stamp},settingsVersion:updatedSettings.stamp,[kind]:resource,receipt:payment.receipt,
    ...(withCoupon?{coupons:{expectedUpdatedAt:updatedCoupons.stamp,claims:payment.couponClaims}}:{})};
   await admin.query('select faolla_checkout_design.commit_on_site_pending($1,$2,$3,$4,$5,$6)',[site,key,principal,hash,plan,new Date(Date.now()+25000).toISOString()]);
   return{siteId:site,operationKey:key,kind,resourceId,expectedUpdatedAt:stamp,coupon,plan,offer};
  };
  const rawRead=(f,c=admin,who=principal)=>one(c,'select public.faolla_member_checkout_on_site_result_v1($1,$2,$3) as result',[site,f.operationKey,who]).then(r=>r.result);
  const cancel=(f,c=a)=>one(c,'select public.faolla_member_checkout_on_site_cancel_v1($1,$2,$3,$4) as result',[site,f.operationKey,principal,f.expectedUpdatedAt]).then(r=>r.result);
  const ownerCancel=(f,c=b)=>one(c,'select public.faolla_checkout_on_site_merchant_cancel_v1($1,$2,$3,$4) as result',[site,f.operationKey,actor,f.expectedUpdatedAt]).then(r=>r.result);
  const collect=(f,c=a)=>c.query('insert into faolla_checkout_design.on_site_collections(site_id,operation_key,amount_minor,currency,actor_key) values($1,$2,$3,$4,$5)',[site,f.operationKey,f.plan.receipt.dueMinor,'eur',actor]);
  const editPolicy=async(f,returnCoupons)=>{
   const current=(await one(admin,'select public.faolla_member_checkout_catalog_snapshot_v1($1) as result',[site])).result;
   await admin.query('select public.faolla_member_checkout_catalog_save_v1($1,$2,$3,$4,$5)',[site,current.version,randomUUID(),actor,{...f.offer,revision:randomUUID(),couponReturnOnCancel:returnCoupons}]);
  };
  const readAdapter=f=>results.readOnSiteCheckoutResult({siteId:site,operationKey:f.operationKey},{authorize:async()=>({accountId,userId}),call:async(name,args)=>{
   assert.equal(name,'faolla_member_checkout_on_site_result_v1');return{data:(await one(admin,'select public.faolla_member_checkout_on_site_result_v1($1,$2,$3) as result',[args.p_site_id,args.p_operation_key,args.p_principal_key])).result,error:null};
  }});
  await t.test('actual cash result adapter is read-only, tenant/customer scoped and strips all private coupon/member/source data',async()=>{
   for(const kind of ['booking','order']){
    const f=await fixture({kind}),before=await all(),view=await readAdapter(f);assert.equal(view.terms.dueMinor,800);assert.equal(view.terms.capturedMinor,0);assert.equal(view.collection,null);assert.equal(view.cancellationAvailable,true);
    assert.deepEqual(await all(),before);assert.ok(!/PRIVATE|cash-cancel-member|couponUses|stockUses|principal_key|editToken|customerGuestHash|futurePrivate/.test(JSON.stringify(view)));
    assert.equal(await rawRead(f,admin,'account:50010106:foreign-customer'),null);assert.equal((await one(admin,'select public.faolla_member_checkout_on_site_result_v1($1,$2,$3) as result',['10909996',f.operationKey,principal])).result,null);
    assert.deepEqual(await all(),before);
   }
  });
  await t.test('two customers cancelling the same original return one coupon/stock once with no cash/points/member mutation',async()=>{
   const f=await fixture(),before=await all(),outcomes=await Promise.all([cancel(f,a),cancel(f,b)]),after=await all();
   assert.deepEqual(outcomes.map(r=>r.replayed).sort(),[false,true]);assert.deepEqual(outcomes[0].receipt,outcomes[1].receipt);
   assert.equal(outcomes[0].receipt.cashReturnedMinor,0);assert.equal(outcomes[0].receipt.pointsReturned,0);assert.equal(outcomes[0].receipt.couponsReturned,1);assert.equal(outcomes[0].receipt.stockReleased,1);
   assert.deepEqual(after.pages.find(r=>r.slug===memberSlug),before.pages.find(r=>r.slug===memberSlug));assert.deepEqual(after.operations,before.operations);
   assert.equal((await page(settingsSlug)).blocks.redemptionItems[0].stock,10);assert.equal(after.returns.length,before.returns.length+1);assert.equal(after.cancellations.length,before.cancellations.length+1);
   const coupon=(await page(couponSlug)).blocks.find(c=>c.id===f.coupon.id);assert.equal(coupon.usedCount,0);assert.deepEqual(coupon.claimEvents,f.coupon.claimEvents);
   const view=await readAdapter(f);assert.equal(view.closed,true);assert.equal(view.resource.status,'cancelled');assert.equal(view.cancellationAvailable,false);
  });
  await t.test('owner/customer race has one audited original cancellation, not a second coupon return',async()=>{
   for(const kind of ['booking','order']){
    const f=await fixture({kind}),before=await all(),outcomes=await Promise.all([cancel(f,a),ownerCancel(f,b)]),after=await all();
    assert.deepEqual(outcomes.map(r=>r.replayed).sort(),[false,true]);assert.deepEqual(outcomes[0].receipt,outcomes[1].receipt);
    assert.equal(after.returns.length,before.returns.length+1);assert.equal(after.audits.length,before.audits.length+(outcomes[1].replayed?0:1));
    assert.deepEqual(after.pages.find(r=>r.slug===memberSlug),before.pages.find(r=>r.slug===memberSlug));
   }
  });
  await t.test('an owner-initiated cancellation creates one immutable actor audit, and customer/owner replays add none',async()=>{
   const f=await fixture({kind:'order'}),before=await all(),result=await ownerCancel(f);assert.equal(result.replayed,false);
   const after=await all();assert.equal(after.audits.length,before.audits.length+1);assert.equal(after.audits.find(r=>r.operation_key===f.operationKey).actor_key,actor);
   assert.equal((await cancel(f)).replayed,true);assert.equal((await ownerCancel(f)).replayed,true);assert.deepEqual(await all(),after);
   await assert.rejects(admin.query('delete from faolla_checkout_design.merchant_cancellation_actors where operation_key=$1',[f.operationKey]),/checkout_history_immutable/);
   assert.deepEqual(await all(),after);
  });
  await t.test('original return policy survives later offer disable, pilot disable and membership leave; expiry is never extended',async()=>{
   const f=await fixture(),couponRow=await page(couponSlug),next=structuredClone(couponRow.blocks),record=next.find(c=>c.id===f.coupon.id);record.expiresAt='2000-01-01T00:00:00Z';record.claimEvents[0].validUntil='2000-01-01T00:00:00Z';
   await admin.query('select public.faolla_commit_redemption_v1($1,$2)',[site,{coupons:{expectedUpdatedAt:couponRow.stamp,next}}]);
   const members=await page(memberSlug),left=structuredClone(members.blocks);left[0].status='left';await admin.query('select public.faolla_commit_order_membership_v1($1,$2)',[site,{memberships:{expectedUpdatedAt:members.stamp,next:left}}]);
   await editPolicy(f,false);await admin.query('update faolla_checkout_design.offer_heads set enabled=false where site_id=$1 and offer_id=$2',[site,f.offer.id]);await admin.query('update faolla_checkout_design.bundle_pilots set enabled=false where site_id=$1',[site]);
   try{const before=await page(memberSlug),closed=await cancel(f);assert.equal(closed.receipt.couponsReturned,1);assert.deepEqual(await page(memberSlug),before);
    const saved=(await page(couponSlug)).blocks.find(c=>c.id===f.coupon.id);assert.deepEqual(saved.claimEvents,record.claimEvents);assert.equal(saved.expiresAt,record.expiresAt);assert.equal(saved.usedCount,0);
   }finally{await admin.query('update faolla_checkout_design.bundle_pilots set enabled=true where site_id=$1',[site]);}
  });
  await t.test('merchant no-return policy retains the original coupon; a coupon-only purchase never creates cash or points refunds',async()=>{
   const f=await fixture({kind:'order',returnCoupons:false,covered:true});await editPolicy(f,true);
   const before=await page(couponSlug),memberBefore=await page(memberSlug),result=await cancel(f);
   assert.equal(result.receipt.couponsReturned,0);assert.equal(result.receipt.cashReturnedMinor,0);assert.equal(result.receipt.pointsReturned,0);assert.deepEqual(await page(couponSlug),before);assert.deepEqual(await page(memberSlug),memberBefore);
   assert.equal((await readAdapter(f)).terms.paymentState,'coupon_covered');
  });
  await t.test('lost actual cancellation response recovers read-only from the same original with no automatic retry',async()=>{
   const f=await fixture();let calls=0;
   await assert.rejects(results.cancelOnSiteCheckout({siteId:site,operationKey:f.operationKey,expectedUpdatedAt:f.expectedUpdatedAt},{authorize:async()=>({accountId,userId}),call:async(name,args)=>{
    assert.equal(name,'faolla_member_checkout_on_site_cancel_v1');calls++;await one(a,'select public.faolla_member_checkout_on_site_cancel_v1($1,$2,$3,$4) as result',[args.p_site_id,args.p_operation_key,args.p_principal_key,args.p_expected_updated_at]);throw new Error('synthetic lost response');
   }}),/checkout_unconfirmed/);assert.equal(calls,1);
   const before=await all(),recovered=await readAdapter(f);assert.equal(recovered.closed,true);assert.deepEqual(await all(),before);assert.equal((await cancel(f)).replayed,true);assert.deepEqual(await all(),before);
  });
  await t.test('replaying cancellation after a later reuse does not remove the new redemption or return another coupon',async()=>{
   const f=await fixture();await cancel(f);const row=await page(couponSlug),next=structuredClone(row.blocks),coupon=next.find(c=>c.id===f.coupon.id),claim=coupon.claimEvents[0];
   coupon.usedCount=1;coupon.redeemEvents=[{id:randomUUID(),at:new Date().toISOString(),claimEventId:claim.id,settlementCode:claim.settlementCode,accountId,userId,operatorId:'synthetic-later-redemption',note:'Later independent use'}];
   await admin.query('select public.faolla_commit_redemption_v1($1,$2)',[site,{coupons:{expectedUpdatedAt:row.stamp,next}}]);const before=await all();assert.equal((await cancel(f)).replayed,true);assert.deepEqual(await all(),before);
  });
  await t.test('old booking/order restore paths cannot reopen a cancelled cash original or spend its returned coupon again',async()=>{
   for(const kind of ['booking','order']){
    const f=await fixture({kind});await cancel(f);const before=await all();
    if(kind==='booking'){
     const state=await one(admin,'select generation,revision::text from faolla_booking_atomic_control where singleton'),rows=(await one(admin,'select public.faolla_booking_atomic_rows_v1() as rows')).rows,next=structuredClone((await page(bookingSlug)).blocks);
     next.records.find(r=>r.id===f.resourceId).status='active';
     await assert.rejects(admin.query('select public.faolla_booking_atomic_commit_v1($1,$2,$3,$4)',[site,op(),op(),{...state,rows,next,result:{syntheticRestore:true},mailJobs:[]}]),/checkout_original_cancellation_required/);
    }else{
     const rows=(await one(admin,`select jsonb_agg(jsonb_build_object('id',id,'slug',slug,'blocks',blocks,'updated_at',updated_at) order by slug,id) as rows from pages
      where merchant_id=$1 and (slug=$2 or slug~$3)`,[site,`__merchant_orders__:${site}`,`^__merchant_orders__:${site}:chunk:[0-9]+$`])).rows;
     const records=structuredClone(rows.filter(r=>r.slug.includes(':chunk:')||!rows.some(c=>c.slug.includes(':chunk:'))).flatMap(r=>r.blocks));records.find(r=>r.id===f.resourceId).status='pending';
     await assert.rejects(admin.query('select public.faolla_commit_order_membership_v1($1,$2)',[site,{orders:{expectedRows:rows,next:records}}]),/checkout_original_cancellation_required/);
    }
    assert.deepEqual(await all(),before);
   }
  });
  await t.test('wrong customer, stale resource, elapsed original cutoff and completed business state cannot return anything',async()=>{
   const f=await fixture();let before=await all();await assert.rejects(one(a,'select public.faolla_member_checkout_on_site_cancel_v1($1,$2,$3,$4)',[site,f.operationKey,'account:50010106:foreign-customer',f.expectedUpdatedAt]),/checkout_not_found/);
   await assert.rejects(cancel({...f,expectedUpdatedAt:'2000-01-01T00:00:00Z'}),/checkout_conflict/);assert.deepEqual(await all(),before);
   const elapsed=await fixture({expiredPolicy:true});before=await all();assert.equal((await readAdapter(elapsed)).cancellationAvailable,false);await assert.rejects(cancel(elapsed),/checkout_cancellation_deadline/);assert.deepEqual(await all(),before);
   const order=await fixture({kind:'order'}),orderRows=(await admin.query('select * from pages where merchant_id=$1 and slug~$2 order by slug,id',[site,`^__merchant_orders__:${site}:chunk:[0-9]+$`])).rows;
   const records=structuredClone(orderRows.flatMap(r=>r.blocks));records.find(r=>r.id===order.resourceId).status='completed';
   await admin.query('select public.faolla_commit_order_membership_v1($1,$2)',[site,{orders:{expectedRows:orderRows.map(r=>({id:r.id,slug:r.slug,blocks:r.blocks,updated_at:r.updated_at.toISOString()})),next:records}}]);
   before=await all();await assert.rejects(cancel(order),/checkout_cancellation_not_allowed/);assert.deepEqual(await all(),before);assert.equal((await readAdapter(order)).collection,null);
  });
  await t.test('late original writer failure rolls back coupon returns, stock, histories, cancel receipt and owner audit',async()=>{
   const f=await fixture(),before=await all();await admin.query(`create function public.synthetic_cash_cancel_failure() returns trigger language plpgsql as $$begin
    if new.slug='${bookingSlug}' then raise exception 'synthetic_cash_cancel_failure';end if;return new;end;$$;
    create trigger synthetic_cash_cancel_failure before update on pages for each row execute function public.synthetic_cash_cancel_failure();`);
   try{await assert.rejects(ownerCancel(f),/synthetic_cash_cancel_failure/);assert.deepEqual(await all(),before);}
   finally{await admin.query('drop trigger synthetic_cash_cancel_failure on pages;drop function public.synthetic_cash_cancel_failure()');}
  });
  await t.test('cancellation waits for the real member lock and preserves a later original-cashier member update exactly',async()=>{
   const f=await fixture();await a.query('begin');let pendingCancel;
   try{
    await a.query("select pg_advisory_xact_lock(hashtextextended('faolla-order-membership:'||$1,0))",[site]);pendingCancel=cancel(f,b).then(value=>({value}),error=>({error}));
    let waiting=false;for(let i=0;i<200;i++){waiting=(await one(admin,"select wait_event_type='Lock' and wait_event='advisory' as waiting from pg_stat_activity where pid=$1",[b.processID]))?.waiting===true;if(waiting)break;await new Promise(resolve=>setTimeout(resolve,5));}
    assert.equal(waiting,true);const row=await page(memberSlug),next=structuredClone(row.blocks);next[0].pointBalance=777;
    await a.query('select public.faolla_commit_order_membership_v1($1,$2)',[site,{memberships:{expectedUpdatedAt:row.stamp,next}}]);await a.query('commit');
    const memberAfterCashier=await page(memberSlug),outcome=await pendingCancel;assert.ok(outcome.value,outcome.error?.message);assert.deepEqual(await page(memberSlug),memberAfterCashier);assert.equal(memberAfterCashier.blocks[0].pointBalance,777);
   }catch(error){await a.query('rollback');if(pendingCancel)await pendingCancel;throw error;}
  });
  await t.test('a missing original stock or changed coupon owner requires review without partial restoration',async()=>{
   for(const mode of ['stock','coupon']){
    const f=await fixture(),row=await page(mode==='stock'?settingsSlug:couponSlug),next=structuredClone(row.blocks);
    if(mode==='stock')next.redemptionItems=[];else next.find(c=>c.id===f.coupon.id).claimEvents[0].accountId='50010106';
    await admin.query('select public.faolla_commit_redemption_v1($1,$2)',[site,{[mode==='stock'?'settings':'coupons']:{expectedUpdatedAt:row.stamp,next}}]);
    const before=await all();await assert.rejects(cancel(f),/checkout_cancellation_review_required/);assert.deepEqual(await all(),before);
    // Restore only this synthetic fixture's settings for subsequent cases.
    if(mode==='stock'){const current=await page(settingsSlug);await admin.query('select public.faolla_commit_redemption_v1($1,$2)',[site,{settings:{expectedUpdatedAt:current.stamp,next:row.blocks}}]);}
   }
  });
  await t.test('recorded cash requires a separate refund path and is immutable; ordinary completion never records payment',async()=>{
   const f=await fixture({kind:'order'});await collect(f);const before=await all(),view=await readAdapter(f);assert.equal(view.collection.amountMinor,800);assert.equal(view.cancellationAvailable,false);assert.equal(view.terms.capturedMinor,0);
   await assert.rejects(cancel(f),/checkout_cancellation_requires_refund/);assert.deepEqual(await all(),before);
   await assert.rejects(admin.query('delete from faolla_checkout_design.on_site_collections where operation_key=$1',[f.operationKey]),/checkout_history_immutable/);assert.deepEqual(await all(),before);
  });
  await t.test('a cancelled original cannot subsequently record cash; cash registration and cancel serialize through the same lock',async()=>{
   const f=await fixture({kind:'order'});await cancel(f);const before=await all();await assert.rejects(collect(f),/checkout_collection_not_allowed/);assert.deepEqual(await all(),before);
   const racing=await fixture({kind:'order'}),outcomes=await Promise.allSettled([cancel(racing,a),collect(racing,b)]);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
   const view=await readAdapter(racing);assert.notEqual(view.closed,Boolean(view.collection));assert.ok(view.closed||view.collection);
  });
  await t.test('zero-due coupon coverage and incorrect amounts cannot be logged as received cash',async()=>{
   const covered=await fixture({covered:true}),before=await all();await assert.rejects(collect(covered));assert.deepEqual(await all(),before);
   const f=await fixture(),saved=await all();await assert.rejects(admin.query('insert into faolla_checkout_design.on_site_collections(site_id,operation_key,amount_minor,currency,actor_key) values($1,$2,799,$3,$4)',[site,f.operationKey,'eur',actor]),/checkout_collection_not_allowed/);assert.deepEqual(await all(),saved);
  });
  await t.test('all new SQL entrypoints and facts remain invoker-only/API-denied',async()=>{
   assert.equal((await one(admin,"select count(*)::int as n from pg_proc where proname in ('cancel_on_site_pending','guard_on_site_collection','faolla_member_checkout_on_site_result_v1','faolla_member_checkout_on_site_cancel_v1','faolla_checkout_on_site_merchant_cancel_v1') and prosecdef")).n,0);
   for(const role of ['anon','authenticated','service_role']){
    const c=await connect(role);
    await assert.rejects(c.query('select public.faolla_member_checkout_on_site_result_v1($1,$2,$3)',[site,op(),principal]),/permission denied/);
    await assert.rejects(c.query('select public.faolla_member_checkout_on_site_cancel_v1($1,$2,$3,$4)',[site,op(),principal,at]),/permission denied/);
    await assert.rejects(c.query('select public.faolla_checkout_on_site_merchant_cancel_v1($1,$2,$3,$4)',[site,op(),actor,at]),/permission denied/);
    await assert.rejects(c.query('select faolla_checkout_design.cancel_on_site_pending($1,$2,$3,$4)',[site,op(),principal,at]),/permission denied/);
    await assert.rejects(c.query('select * from faolla_checkout_design.on_site_collections'),/permission denied/);
   }
  });
  console.log(`[cash-cancel-pg] PostgreSQL ${(await one(admin,'show server_version')).server_version}; checks finished (status in TAP); evidence: ${evidence}`);
 }finally{
  await Promise.all(clients.map(c=>c.end().catch(()=>{})));
  if(started){const pid=(await readFile(path.join(cluster,'postmaster.pid'),'utf8')).split(/\r?\n/);assert.equal(path.resolve(pid[1]).toLowerCase(),path.resolve(cluster).toLowerCase());
   await exec(binaries.pg_ctl,['-D',cluster,'-w','-t','30','-m','fast','stop'],{windowsHide:true,timeout:45000});console.log(`[cash-cancel-pg] stopped owned cluster; retained ${evidence}`);}
 }
});
