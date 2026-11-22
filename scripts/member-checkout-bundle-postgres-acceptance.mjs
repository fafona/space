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
  for(const file of ['scripts/supabase-migrations/202609080045_order_membership_atomic_mutation.sql','scripts/supabase-migrations/202609080046_redemption_atomic_mutation.sql','scripts/supabase-migrations/202610250211_booking_atomic_preparation.sql','scripts/supabase-migrations/202610250212_booking_atomic_runtime.sql','scripts/supabase-migrations/202611050213_booking_atomic_safeupdate_singleton.sql','database/proposals/20261122_member_checkout_design.sql','database/proposals/20261122_member_checkout_bundle.sql']){
   await admin.query(await readFile(path.resolve(file),'utf8'));
  }
  // Test-only admin activation in this freshly created owned synthetic cluster.
  // No equivalent application endpoint or production activation exists.
  await admin.query('update faolla_booking_atomic_control set active=true where singleton');
  await admin.query('insert into faolla_checkout_design.bundle_pilots(site_id,enabled) values($1,true)',[site]);
  const a=await connect(),b=await connect();
  const all=async()=>({pages:(await admin.query('select * from pages order by slug,id')).rows,commands:(await admin.query('select * from faolla_booking_atomic_commands order by command_key')).rows,
   operations:(await admin.query('select * from faolla_redemption_operations order by operation_id')).rows,results:(await admin.query('select * from faolla_checkout_design.bundle_results order by operation_key')).rows});
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
  await t.test('all browser/API roles are denied the private composition function and tables',async()=>{
   for(const role of ['anon','authenticated','service_role']){
    const client=await connect(role);
    await assert.rejects(client.query('select * from faolla_checkout_design.bundle_results'),/permission denied/);
    await assert.rejects(client.query('select faolla_checkout_design.commit_bundle($1,$2,$3,$4,$5)',[site,op(),principal,hash,{}]),/permission denied/);
   }
  });
  console.log(`[member-checkout-pg] PostgreSQL ${(await one(admin,'show server_version')).server_version}; private checks finished (status in TAP); evidence: ${evidence}`);
 }finally{
  await Promise.all(clients.map(client=>client.end().catch(()=>{})));
  if(started){const pid=(await readFile(path.join(cluster,'postmaster.pid'),'utf8')).split(/\r?\n/);assert.equal(path.resolve(pid[1]).toLowerCase(),path.resolve(cluster).toLowerCase());
   await exec(binaries.pg_ctl,['-D',cluster,'-w','-t','30','-m','fast','stop'],{windowsHide:true,timeout:45000});console.log(`[member-checkout-pg] stopped owned synthetic cluster; retained ${evidence}`);}
 }
});
