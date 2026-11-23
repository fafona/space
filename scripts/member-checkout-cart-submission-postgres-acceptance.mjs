// New synthetic TEMP cluster, actual original 045/046 writers + immutable
// checkout guards. No app .env, production URL, real user, Stripe or mail.
import assert from 'node:assert/strict';import test from 'node:test';
import {readFile,mkdtemp} from 'node:fs/promises';import {createRequire} from 'node:module';import {tmpdir} from 'node:os';
import path from 'node:path';import {pathToFileURL} from 'node:url';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import net from 'node:net';import {randomUUID} from 'node:crypto';
import fixtures from './fixtures/member-checkout-cart-quote.ts';import quote from '../src/lib/merchantCheckoutCartQuote.server.ts';
import planner from '../src/lib/merchantCheckoutCartSubmissionPlan.server.ts';import service from '../src/lib/merchantCheckoutCartSubmission.server.ts';
import orders from '../src/lib/merchantOrders.ts';import oldPlanner from '../src/lib/merchantCheckoutSubmissionPlan.server.ts';
import reporting from '../src/lib/merchantCheckoutReporting.server.ts';import reportDto from '../src/lib/merchantCheckoutReporting.ts';import cashPlanner from '../src/lib/merchantCheckoutOnSiteSubmissionPlan.server.ts';
import {pendingIntentAcceptance} from './fixtures/member-checkout-pending-intent-acceptance.mjs';

test('whole product cart commit/recover/cancel uses original PostgreSQL writers atomically',{timeout:120000},async t=>{
 const runtime=path.resolve(process.env.FAOLLA_BOOKING_TEST_RUNTIME_DIR||'.missing-test-runtime'),relative=path.relative(tmpdir(),runtime);
 assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(runtime).startsWith('faolla-booking-pg-'));
 const requireTest=createRequire(path.join(runtime,'test-loader.cjs')),pgRoot=path.join(runtime,'node_modules/@embedded-postgres/windows-x64');
 assert.equal(JSON.parse(await readFile(path.join(pgRoot,'package.json'),'utf8')).version,'17.10.0-beta.17');assert.equal(JSON.parse(await readFile(path.join(runtime,'node_modules/pg/package.json'),'utf8')).version,'8.23.1');
 const {Client}=requireTest('pg'),binaries=await import(pathToFileURL(path.join(pgRoot,'dist/index.js')).href),exec=promisify(execFile);
 const evidence=await mkdtemp(path.join(tmpdir(),'faolla-checkout-cart-submit-test-')),cluster=path.join(evidence,'cluster');
 const socket=net.createServer();await new Promise((resolve,reject)=>{socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve);});const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
 let started=false,config;const clients=[];const one=async(c,sql,args=[])=>(await c.query(sql,args)).rows[0];
 const connect=async role=>{const c=new Client(config);await c.connect();clients.push(c);if(role)await c.query(`set role ${role}`);return c;};
 try{
  await exec(binaries.initdb,['-D',cluster,'-U','cart_submit_admin','-A','trust','--encoding=UTF8','--locale=C'],{windowsHide:true,timeout:60000});
  await exec(binaries.pg_ctl,['-D',cluster,'-l',path.join(evidence,'postgres.log'),'-w','-t','30','-o',`-h 127.0.0.1 -p ${port} -c shared_buffers=16MB -c max_connections=12`,'start'],{windowsHide:true,timeout:45000});started=true;
  config={host:'127.0.0.1',port,user:'cart_submit_admin',database:'postgres',password:'',ssl:false,connectionTimeoutMillis:5000,statement_timeout:15000,query_timeout:20000,application_name:'faolla-cart-submit-isolated'};
  const admin=await connect(),a=await connect(),b=await connect();assert.equal(path.resolve((await one(admin,'show data_directory')).data_directory).toLowerCase(),path.resolve(cluster).toLowerCase());
  await admin.query(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
   create table public.pages(id uuid primary key default gen_random_uuid(),merchant_id text,slug text,blocks jsonb,updated_at timestamptz default clock_timestamp());
   create table public.faolla_schema_migrations(version bigint primary key,name text not null);grant usage on schema public to anon,authenticated,service_role;grant select,insert,update,delete on pages to service_role;
   create function public.set_pages_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end;$$;
   create trigger set_pages_updated_at before update on pages for each row execute function public.set_pages_updated_at();`);
  const definitions=async()=> (await admin.query(`select oid::regprocedure::text name,pg_get_functiondef(oid) definition from pg_proc where oid in
   ('public.faolla_commit_redemption_v1(text,jsonb)'::regprocedure,'public.faolla_commit_order_membership_v1(text,jsonb)'::regprocedure,
    'faolla_checkout_design.commit_bundle(text,text,text,text,jsonb)'::regprocedure,'faolla_checkout_design.cancel_bundle(text,text,text,text)'::regprocedure,
    'faolla_checkout_design.guard_legacy_resource_final_state()'::regprocedure,'public.faolla_member_checkout_reporting_v1(text,jsonb)'::regprocedure,
    'public.faolla_member_checkout_reporting_v2(text,jsonb)'::regprocedure,'public.faolla_member_checkout_original_resource_v1(text,text,text,text)'::regprocedure) order by name`)).rows;
  for(const file of ['scripts/supabase-migrations/202609080045_order_membership_atomic_mutation.sql','scripts/supabase-migrations/202609080046_redemption_atomic_mutation.sql',
   'scripts/supabase-migrations/202610250211_booking_atomic_preparation.sql','scripts/supabase-migrations/202610250212_booking_atomic_runtime.sql','scripts/supabase-migrations/202611050213_booking_atomic_safeupdate_singleton.sql',
   'database/proposals/20261122_member_checkout_design.sql','database/proposals/20261122_member_checkout_catalog.sql','database/proposals/20261122_member_checkout_bundle.sql',
   'database/proposals/20261122_member_checkout_cancellation.sql','database/proposals/20261122_member_checkout_queries.sql','database/proposals/20261123_member_checkout_legacy_boundary.sql',
   'database/proposals/20261123_member_checkout_on_site_pending.sql','database/proposals/20261123_member_checkout_on_site_cancellation.sql','database/proposals/20261122_member_checkout_submission.sql',
   'database/proposals/20261123_member_checkout_on_site_submission.sql','database/proposals/20261123_member_checkout_reporting.sql','database/proposals/20261123_member_checkout_presentation.sql',
   'database/proposals/20261123_member_checkout_on_site_management.sql','database/proposals/20261123_member_checkout_cart_quote.sql'])await admin.query(await readFile(path.resolve(file),'utf8'));
  const beforeDefinitions=await definitions();
  for(const file of ['database/proposals/20261123_member_checkout_cart_submission.sql','database/proposals/20261123_member_checkout_cart_cancellation.sql','database/proposals/20261123_member_checkout_cart_presentation.sql'])await admin.query(await readFile(path.resolve(file),'utf8'));
  assert.deepEqual(await definitions(),beforeDefinitions,'all original financial and guard functions remain byte-identical');
  const site='10909994',memberSlug=`__merchant_memberships__:${site}`,settingsSlug=`__merchant_membership_settings__:${site}`,couponSlug=`__merchant_coupons__:${site}`;
  for(const table of ['bundle_pilots','cart_quote_pilots'])await admin.query(`insert into faolla_checkout_design.${table}(site_id,enabled) values($1,true)`,[site]);
  const page=slug=>one(admin,'select * from pages where merchant_id=$1 and slug=$2',[site,slug]);
  const savePage=async row=>{const found=await one(admin,'select id from pages where merchant_id is not distinct from $1 and slug is not distinct from $2',[row.merchant_id,row.slug]);
   if(found)await admin.query('update pages set blocks=$2 where id=$1',[found.id,JSON.stringify(row.blocks)]);else await admin.query('insert into pages(id,merchant_id,slug,blocks) values($1,$2,$3,$4)',[row.id,row.merchant_id,row.slug,JSON.stringify(row.blocks)]);};
  const all=async()=>({pages:(await admin.query('select * from pages order by id')).rows,operations:(await admin.query('select * from faolla_redemption_operations order by operation_id')).rows,
   receipts:(await admin.query('select * from faolla_checkout_design.bundle_results order by operation_key')).rows,cancellations:(await admin.query('select * from faolla_checkout_design.bundle_cancellations order by operation_key')).rows,
   returns:(await admin.query('select * from faolla_checkout_design.bundle_coupon_returns order by redeem_event_id')).rows,collections:(await admin.query('select * from faolla_checkout_design.on_site_collections order by operation_key')).rows});
  const seed=async(method='points',change=()=>{},count=2)=>{
   const f=fixtures.cartQuoteFixture(method,count);change(f);for(const row of [...f.snapshot.sourceRows,...f.snapshot.domainRows])await savePage(row);
   let version=(await one(admin,'select public.faolla_member_checkout_catalog_snapshot_v1($1) as result',[site])).result.version;
   for(let i=0;i<f.offers.length;i++){
    const previous=await one(admin,`select h.offer_id from faolla_checkout_design.offer_heads h join faolla_checkout_design.offer_versions v using(site_id,offer_id,revision) where h.site_id=$1 and v.source_key=$2`,[site,f.offers[i].checkoutBinding.sourceKey]);
    if(previous){f.offers[i].id=previous.offer_id;f.request.lines[i].offerId=previous.offer_id;}
    const next=randomUUID();await admin.query('select public.faolla_member_checkout_catalog_save_v1($1,$2,$3,$4,$5)',[site,version,next,'owner:synthetic-owner',f.offers[i]]);version=next;
   }
   f.refresh();const request={...f.request,nonce:randomUUID(),confirmationHash:'0'.repeat(64),customer:{name:'Synthetic',title:'Mx',email:'synthetic@example.invalid',phone:'000',note:''}};
   return{...f,request};
  };
  const input=f=>({request:f.request,principal:f.principal,authorize:async()=>f.principal,enabled:()=>true});
  const read=async(f,c=admin)=>{const id=planner.cartSubmissionIdentity(f.request,f.principal),qid=planner.cartSelectionIdentity(id,f.principal);
   return(await one(c,'select public.faolla_member_checkout_cart_submission_snapshot_v1($1,$2,$3,$4,$5,$6) as result',[site,id.operationKey,id.principalKey,id.requestHash,qid.requestHash,JSON.stringify(qid.request.lines.map(l=>l.offerId))])).result;};
  const prepare=async(f,c=admin)=>{
   let id=planner.cartSubmissionIdentity(f.request,f.principal),snapshot=(await read(f,c)).snapshot;
   const q=await quote.quoteCheckoutCartSnapshot(snapshot.quoteSnapshot,planner.cartSelectionIdentity(id,f.principal),f.principal);f.request.confirmationHash=planner.cartConfirmationHash(q,f.principal);
   id=planner.cartSubmissionIdentity(f.request,f.principal);snapshot=(await read(f,c)).snapshot;
   return{id,...await planner.planCartSubmission(snapshot,id,f.principal)};
  };
  const commit=(p,c=a)=>one(c,'select public.faolla_member_checkout_cart_commit_v1($1,$2,$3,$4,$5,$6,$7) as result',
   [site,p.id.operationKey,p.id.principalKey,p.id.requestHash,p.snapshot,p.plan,p.notAfter]);
  const readResult=(f,c=admin)=>{const id=planner.cartSubmissionIdentity(f.request,f.principal);return one(c,'select public.faolla_member_checkout_cart_result_v1($1,$2,$3) as result',[site,id.operationKey,id.principalKey]);};
  const rpc=c=>async(name,args,signal)=>{assert.ok(signal instanceof AbortSignal);try{
   const spec={faolla_member_checkout_cart_submission_snapshot_v1:['$1,$2,$3,$4,$5,$6',['p_site_id','p_operation_key','p_principal_key','p_request_hash','p_quote_request_hash','p_offer_ids']],
    faolla_member_checkout_cart_commit_v1:['$1,$2,$3,$4,$5,$6,$7',['p_site_id','p_operation_key','p_principal_key','p_request_hash','p_snapshot','p_plan','p_not_after']],
    faolla_member_checkout_cart_result_v1:['$1,$2,$3',['p_site_id','p_operation_key','p_principal_key']],faolla_member_checkout_cart_cancel_v1:['$1,$2,$3,$4,$5',['p_site_id','p_operation_key','p_principal_key','p_expected_updated_at','p_not_after']]};
   assert.ok(spec[name]);const [placeholders,keys]=spec[name],values=keys.map(k=>k==='p_offer_ids'?JSON.stringify(args[k]):args[k]);
   return{data:(await one(c,`select public.${name}(${placeholders}) as result`,values)).result,error:null};
  }catch(error){return{data:null,error:{message:error.message}};}};
  const submit=async f=>{const preview=await service.previewCartSubmission(input(f),rpc(admin));f.request.confirmationHash=preview.confirmationHash;return service.submitCartCheckout(input(f),rpc(a));};
  const cancel=async(f,c=a)=>{const r=(await readResult(f)).result;return one(c,'select public.faolla_member_checkout_cart_cancel_v1($1,$2,$3,$4,$5) as result',
   [site,r.operationKey,planner.cartSubmissionIdentity(f.request,f.principal).principalKey,r.resource.updatedAt,new Date(Date.now()+12000).toISOString()]);};
  const temporary=async(name,table,timing,body,run)=>{await admin.query(`create function ${name}() returns trigger language plpgsql as $$begin ${body} return new;end;$$;create trigger ${name} ${timing} on ${table} for each row execute function ${name}();`);
   try{return await run();}finally{await admin.query(`drop trigger ${name} on ${table};drop function ${name}()`);}};
  await t.test('new cart write gate is independently default closed',async()=>{
   const f=await seed(),before=await all();await assert.rejects(read(f),/checkout_disabled/);assert.deepEqual(await all(),before);
   await admin.query('insert into faolla_checkout_design.cart_submission_pilots(site_id,enabled) values($1,true)',[site]);
  });
  await t.test('actual service commits every product, points, coupon and stock as one original, preserving unrelated orders',async()=>{
   const legacy={...orders.createMerchantOrder({siteId:site,blockId:'legacy',customer:{name:'Old',phone:'000',email:'old@example.invalid'},items:[{productId:'old',name:'Old',quantity:1,unitPrice:4}]},{id:'legacy-synthetic-order',createdAt:new Date().toISOString()}),futurePrivate:{preserved:true}};
   await savePage({id:randomUUID(),merchant_id:site,slug:`__merchant_orders__:${site}`,blocks:[legacy]});
   for(const method of ['points','on_site']){
    const f=await seed(method,x=>{x.request.lines[0].couponClaims=[{couponId:x.coupons[0].id,claimEventId:x.coupons[0].claimEvents[0].id}];}),memberBefore=(await page(memberSlug)).blocks;
    const r=await submit(f);assert.equal(r.result.lines.length,2);assert.equal(r.result.capturedMinor,0);assert.equal(r.result.method,method);assert.equal(r.result.reviewRequired,false);
    assert.equal(r.result.totalPoints,method==='points'?180:null);assert.equal(r.result.dueMinor,method==='on_site'?2300:null);
    const members=(await page(memberSlug)).blocks,stock=(await page(settingsSlug)).blocks.redemptionItems;assert.equal(members[0].pointBalance,method==='points'?820:1000);
    if(method==='on_site')assert.deepEqual(members,memberBefore);assert.equal(stock[0].stock,4);assert.equal(stock[1].stock,4);
    assert.equal((await page(couponSlug)).blocks[0].redeemEvents.length,1);
    const rows=(await admin.query("select blocks from pages where merchant_id=$1 and slug~'^__merchant_orders__:'",[site])).rows.flatMap(r=>r.blocks);
    assert.deepEqual(rows.find(r=>r.id===legacy.id),legacy);assert.ok(!/PRIVATE|private-cart|couponClaims|stockItemId|pointTransactionId|example.invalid/.test(JSON.stringify(r)));
   }
  });
  await t.test('same original nonce raced on two connections creates one order and one set of debits',async()=>{
   const f=await seed(),p=await prepare(f),r=await Promise.all([commit(p,a),commit(p,b)]);assert.deepEqual(r.map(x=>x.result.replayed).sort(),[false,true]);
   assert.equal((await page(memberSlug)).blocks[0].pointBalance,800);assert.equal((await page(memberSlug)).blocks[0].transactions.filter(t=>t.operatorId===`customer:${f.principal.accountId}`).length,2);
  });
  await t.test('cash-only cart needs no point entitlement or balance and leaves member/settings bytes unchanged with unlimited stock',async()=>{
   const f=await seed('on_site',x=>{x.member.pointBalance=0;x.settings.pointsRules.birthdayPoints=500;
    x.offers.forEach(o=>o.unitPoints=null);x.settings.redemptionItems.forEach(i=>i.stock=null);
    x.site.permissionConfig.allowPointsRedemption=false;x.snapshot.sourceRows[0].blocks=x.root();});
   const beforeMember=(await page(memberSlug)).blocks,beforeSettings=(await page(settingsSlug)).blocks;
   const r=await submit(f);assert.equal(r.result.dueMinor,2500);assert.equal(r.result.totalPoints,null);
   assert.deepEqual((await page(memberSlug)).blocks,beforeMember);assert.deepEqual((await page(settingsSlug)).blocks,beforeSettings);
   await cancel(f);assert.deepEqual((await page(memberSlug)).blocks,beforeMember);assert.deepEqual((await page(settingsSlug)).blocks,beforeSettings);
  });
  await t.test('different nonces competing for the same balance cannot both debit',async()=>{
   const f=await seed('points',x=>x.member.pointBalance=250),p=await prepare(f),other={...f,request:{...f.request,nonce:randomUUID()}};const q=await prepare(other);
   const r=await Promise.allSettled([commit(p,a),commit(q,b)]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal((await page(memberSlug)).blocks[0].pointBalance,50);
  });
  await t.test('shared stock pool is debited/released once for the total cart quantity',async()=>{
   const f=await seed('on_site',x=>{x.offers[1].checkoutBinding.stockItemId='stock-0';x.settings.redemptionItems[0].stock=2;});await submit(f);
   assert.equal((await page(settingsSlug)).blocks.redemptionItems[0].stock,0);await cancel(f);assert.equal((await page(settingsSlug)).blocks.redemptionItems[0].stock,2);
  });
  await t.test('late ledger failure rolls back already written member, coupons, stocks, order and histories together',async()=>{
   const f=await seed('points',x=>x.request.lines[0].couponClaims=[{couponId:x.coupons[0].id,claimEventId:x.coupons[0].claimEvents[0].id}]),p=await prepare(f),before=await all();
   await temporary('test_cart_fail','faolla_checkout_design.bundle_results','before insert',"if new.receipt->>'purpose'='product_cart' then raise exception 'synthetic_cart_failure';end if;",async()=>{
    await assert.rejects(commit(p),/synthetic_cart_failure/);assert.deepEqual(await all(),before);
   });
  });
  await t.test('crossing deadline inside an original writer rolls back every effect, not inverse compensation',async()=>{
   const f=await seed(),p=await prepare(f);p.notAfter=new Date(Date.now()+450).toISOString();const before=await all();
   await temporary('test_cart_delay','faolla_checkout_design.bundle_results','after insert',"if new.receipt->>'purpose'='product_cart' then perform pg_sleep(0.65);end if;",async()=>{
    await assert.rejects(commit(p),/checkout_quote_expired/);assert.deepEqual(await all(),before);
   });
  });
  await t.test('lock wait crossing the trusted deadline cannot dispatch a late cart debit',async()=>{
   const f=await seed(),p=await prepare(f);p.notAfter=new Date(Date.now()+450).toISOString();const before=await all();
   await a.query('begin');await a.query("select pg_advisory_xact_lock(hashtextextended('faolla-order-membership:'||$1,0))",[site]);
   const pending=commit(p,b);pending.catch(()=>{});
   try{const until=Date.now()+1500;let blocked=false;while(Date.now()<until){blocked=(await one(admin,"select wait_event='advisory' blocked from pg_stat_activity where pid=$1",[b.processID]))?.blocked;if(blocked)break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(blocked,true);await admin.query('select pg_sleep(0.6)');}finally{await a.query('rollback');}
   await assert.rejects(pending,/checkout_quote_expired/);assert.deepEqual(await all(),before);
  });
  await t.test('a new publication inserted during the inner write rolls back all writes including that inserted source',async()=>{
   const f=await seed(),p=await prepare(f),before=await all();
   await temporary('test_cart_source_insert','faolla_checkout_design.bundle_results','after insert',`if new.receipt->>'purpose'='product_cart' then insert into public.pages(merchant_id,slug,blocks) values('${site}','late-cart-source','[]');end if;`,async()=>{
    await assert.rejects(commit(p),/checkout_conflict/);assert.deepEqual(await all(),before);
   });
  });
  await t.test('source/stock/member/coupon changes after preparation refuse the whole old cart',async()=>{
   for(const kind of ['source','stock','member','coupon']){
    const f=await seed(),p=await prepare(f);
    const row=kind==='source'?f.snapshot.sourceRows[1]:f.snapshot.domainRows[kind==='member'?0:kind==='stock'?1:2];
    if(kind==='source')row.blocks=[...row.blocks,{id:'new-source',type:'text',props:{}}];
    if(kind==='stock')row.blocks.redemptionItems[0].stock=0;if(kind==='member')row.blocks[0].status='left';if(kind==='coupon')row.blocks[0].status='paused';
    await savePage(row);const before=await all();await assert.rejects(commit(p),/checkout_conflict/);assert.deepEqual(await all(),before);
   }
  });
  await t.test('lost actual commit response is recovered read-only from the original nonce without a second financial write',async()=>{
   const f=await seed();const preview=await service.previewCartSubmission(input(f),rpc(admin));f.request.confirmationHash=preview.confirmationHash;let writes=0;
   await assert.rejects(service.submitCartCheckout(input(f),async(name,args,signal)=>{const r=await rpc(a)(name,args,signal);if(name.includes('commit')){writes++;assert.equal(r.error,null);throw new Error('lost');}return r;}),/checkout_unconfirmed/);
   const before=await all(),r=await service.recoverCartCheckout({siteId:site,nonce:f.request.nonce},input(f),rpc(b));assert.equal(r.totalPoints,200);assert.equal(writes,1);assert.deepEqual(await all(),before);
  });
  await t.test('zero-point/zero-cash coupon covered original never invents a debit or captured payment',async()=>{
   for(const method of ['points','on_site']){
    const f=await seed(method,x=>{x.coupons[0].discountValue=method==='points'?100:10;x.request.lines[0].couponClaims=[{couponId:x.coupons[0].id,claimEventId:x.coupons[0].claimEvents[0].id}];},1);
    const r=await submit(f);assert.equal(method==='points'?r.result.totalPoints:r.result.dueMinor,0);assert.equal(r.result.couponCount,1);assert.equal(r.result.capturedMinor,0);
    assert.deepEqual((await page(memberSlug)).blocks[0].transactions,[]);await cancel(f);assert.equal((await page(couponSlug)).blocks[0].redeemEvents.length,0);
   }
  });
  await t.test('mixed original per-line return policies restore only eligible points/coupon with exact growth and all original stock',async()=>{
   const f=await seed('points',x=>{x.settings.growthRules.spendPointGrowth=0.33;x.offers[1].checkoutBinding.pointsReturnOnCancel=false;x.offers[1].couponReturnOnCancel=false;
    x.request.lines.forEach((l,i)=>l.couponClaims=[{couponId:x.coupons[i].id,claimEventId:x.coupons[i].claimEvents[0].id}]);});
   await submit(f);const id=planner.cartSubmissionIdentity(f.request,f.principal),original=(await one(admin,'select receipt from faolla_checkout_design.bundle_results where site_id=$1 and operation_key=$2',[site,id.operationKey])).receipt;
   const expected=original.lines.filter(l=>l.returnPoints).reduce((s,l)=>s+l.points,0);assert.equal(expected,80);
   const r=(await cancel(f)).result.result;assert.equal(r.cancellation.pointsReturned,80);assert.equal(r.cancellation.couponsReturned,1);assert.equal(r.cancellation.stockReleased,2);
   const member=(await page(memberSlug)).blocks[0];assert.equal(member.pointBalance,920);assert.equal(member.growthValue,26.4);assert.equal(member.transactions.filter(t=>t.status==='cancelled').length,1);
   const before=await all();await cancel(f,b);assert.deepEqual(await all(),before);
  });
  await t.test('concurrent cancels issue one original return; membership leave and current offer disable do not rewrite the frozen policy',async()=>{
   const f=await seed();await submit(f);const members=(await page(memberSlug)).blocks;members[0].status='left';await savePage({merchant_id:site,slug:memberSlug,blocks:members});
   await admin.query('update faolla_checkout_design.offer_heads set enabled=false where site_id=$1',[site]);
   const r=await Promise.all([cancel(f,a),cancel(f,b)]);assert.deepEqual(r.map(x=>x.result.replayed).sort(),[false,true]);assert.equal((await page(memberSlug)).blocks[0].pointBalance,1000);assert.equal((await page(memberSlug)).blocks[0].status,'left');
  });
  await t.test('returning an original coupon never extends its expiry or removes another redemption',async()=>{
   const f=await seed('on_site',x=>x.request.lines[0].couponClaims=[{couponId:x.coupons[0].id,claimEventId:x.coupons[0].claimEvents[0].id}]);await submit(f);
   const coupons=(await page(couponSlug)).blocks;coupons[0].claimEvents[0].validUntil='2000-01-01T00:00:00Z';
   const foreign={...coupons[0].redeemEvents[0],id:randomUUID(),claimEventId:'foreign-claim',settlementCode:'FOREIGN-CODE'};coupons[0].redeemEvents.push(foreign);coupons[0].usedCount++;
   await savePage({merchant_id:site,slug:couponSlug,blocks:coupons});const originalClaim=structuredClone(coupons[0].claimEvents[0]);
   await cancel(f);const after=(await page(couponSlug)).blocks[0];assert.deepEqual(after.claimEvents[0],originalClaim);assert.deepEqual(after.redeemEvents,[foreign]);assert.equal(after.usedCount,1);
  });
  await t.test('late cancel failure rolls back refunds, stock, coupon return history and resource cancellation together',async()=>{
   const f=await seed('points',x=>x.request.lines[0].couponClaims=[{couponId:x.coupons[0].id,claimEventId:x.coupons[0].claimEvents[0].id}]);await submit(f);const before=await all();
   await temporary('test_cart_cancel_fail','faolla_checkout_design.bundle_cancellations','after insert',"if new.receipt->'version'='3'::jsonb then raise exception 'synthetic_cancel_failure';end if;",async()=>{
    await assert.rejects(cancel(f),/synthetic_cancel_failure/);assert.deepEqual(await all(),before);
   });
  });
  await t.test('cancel lock wait crossing its deadline cannot return points or release stock late',async()=>{
   const f=await seed();await submit(f);const r=(await readResult(f)).result,before=await all(),id=planner.cartSubmissionIdentity(f.request,f.principal);
   await a.query('begin');await a.query("select pg_advisory_xact_lock(hashtextextended('faolla-order-membership:'||$1,0))",[site]);
   const pending=one(b,'select public.faolla_member_checkout_cart_cancel_v1($1,$2,$3,$4,$5) result',[site,id.operationKey,id.principalKey,r.resource.updatedAt,new Date(Date.now()+450).toISOString()]);pending.catch(()=>{});
   try{const until=Date.now()+1500;let blocked=false;while(Date.now()<until){blocked=(await one(admin,"select wait_event='advisory' blocked from pg_stat_activity where pid=$1",[b.processID]))?.blocked;if(blocked)break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(blocked,true);await admin.query('select pg_sleep(0.6)');}finally{await a.query('rollback');}
   await assert.rejects(pending,/checkout_quote_expired/);assert.deepEqual(await all(),before);
  });
  await t.test('existing final-state guard blocks old raw cancel/reprice/delete; completion remains distinct from cash collection',async()=>{
   const f=await seed('on_site'),r=await submit(f),c=await connect('service_role'),before=await all();
   for(const change of ["jsonb_set(o,'{status}','\"cancelled\"')","jsonb_set(o,'{totalAmount}','999')"]){
    await assert.rejects(c.query(`update pages p set blocks=(select jsonb_agg(case when o->>'id'=$2 then ${change} else o end) from jsonb_array_elements(p.blocks) o) where p.merchant_id=$1 and p.slug~'^__merchant_orders__:'`,[site,r.result.resourceId]),/checkout_original_cancellation_required|checkout_change_requires_review/);
    assert.deepEqual(await all(),before);
   }
   await assert.rejects(c.query("delete from pages where merchant_id=$1 and slug~'^__merchant_orders__:'",[site]),/checkout_resource_locked/);
   await c.query(`update pages p set blocks=(select jsonb_agg(case when o->>'id'=$2 then jsonb_set(o,'{status}','"completed"') else o end) from jsonb_array_elements(p.blocks) o) where p.merchant_id=$1 and p.slug~'^__merchant_orders__:'`,[site,r.result.resourceId]);
   const current=(await readResult(f)).result;assert.equal(current.resource.status,'completed');assert.equal(current.capturedMinor,0);assert.equal(current.cancellationAvailable,false);await assert.rejects(cancel(f),/checkout_cancellation_not_allowed/);
  });
  await t.test('shared ledger prevents switching the same original nonce between cart and the actual old single-offer submission',async()=>{
   const f=await seed(),first=f.request.lines[0];const request={siteId:site,...first,nonce:f.request.nonce,confirmationHash:'0'.repeat(64),method:'points',customer:f.request.customer};
   let id=oldPlanner.checkoutSubmissionIdentity(request,f.principal);
   const readOld=async()=>(await one(admin,'select public.faolla_member_checkout_submission_snapshot_v2($1,$2,$3,$4,$5) as result',[site,id.operationKey,id.principalKey,id.requestHash,first.offerId])).result;
   const snap=(await readOld()).snapshot;request.confirmationHash=(await oldPlanner.quoteCheckoutSubmissionSnapshot(snap,id,f.principal)).confirmationHash;
   id=oldPlanner.checkoutSubmissionIdentity(request,f.principal);const current=(await readOld()).snapshot,p=await oldPlanner.planCheckoutSubmission(current,id,f.principal);
   await one(a,'select public.faolla_member_checkout_submission_commit_v2($1,$2,$3,$4,$5,$6,$7) as result',[site,id.operationKey,id.principalKey,id.requestHash,current,p.plan,p.notAfter]);
   const before=await all();await assert.rejects(read(f),/checkout_operation_conflict/);assert.deepEqual(await all(),before);
  });
  await t.test('foreign principals, fake receipts, malformed plans and all API roles cannot access private cart finance',async()=>{
   const f=await seed(),p=await prepare(f),before=await all();
   await assert.rejects(commit({...p,plan:{...p.plan,terms:{...p.plan.terms,totalPoints:1}}}),/checkout_invalid_plan/);assert.deepEqual(await all(),before);
   const alias=structuredClone(p.plan);alias.lines[1].pointTransactionId=alias.lines[0].pointTransactionId;
   await assert.rejects(commit({...p,plan:alias}),/checkout_invalid_plan/);assert.deepEqual(await all(),before);
   const oldPolicy=structuredClone(p.plan);oldPolicy.terms.cancellationPolicy={returnPoints:true,returnCoupons:true,advanceMinutes:0,cancellableUntil:null};
   await assert.rejects(commit({...p,plan:oldPolicy}),/checkout_invalid_plan/);assert.deepEqual(await all(),before);
   for(const role of ['anon','authenticated','service_role']){const c=await connect(role);for(const signature of ['faolla_member_checkout_cart_submission_snapshot_v1(text,text,text,text,text,jsonb)','faolla_member_checkout_cart_commit_v1(text,text,text,text,jsonb,jsonb,text)','faolla_member_checkout_cart_cancel_v1(text,text,text,text,text)','faolla_member_checkout_cart_result_v1(text,text,text)'])
    assert.equal((await one(c,'select has_function_privilege(current_user,$1,\'EXECUTE\') as allowed',[`public.${signature}`])).allowed,false);
    await assert.rejects(c.query('select * from faolla_checkout_design.cart_submission_pilots'),/permission denied/);}
   assert.deepEqual(await definitions(),beforeDefinitions);
  });
  await t.test('wrong customer cannot read or cancel a committed cart even knowing the original nonce',async()=>{
   const f=await seed();await submit(f);const id=planner.cartSubmissionIdentity(f.request,f.principal),wrong='account:50010106:cart-foreign-synthetic',r=(await readResult(f)).result,before=await all();
   assert.equal((await one(admin,'select public.faolla_member_checkout_cart_result_v1($1,$2,$3) result',[site,id.operationKey,wrong])).result,null);
   await assert.rejects(one(a,'select public.faolla_member_checkout_cart_cancel_v1($1,$2,$3,$4,$5)',[site,id.operationKey,wrong,r.resource.updatedAt,new Date(Date.now()+12000).toISOString()]),/checkout_not_found/);
   assert.deepEqual(await all(),before);
  });
  await t.test('version-three report reads actual points/cash carts and old points originals in exact order without writing or private fields',async()=>{
   const f=await seed(),p=(await submit(f)).result,g=await seed('on_site');g.request.lines[0].couponClaims=[{couponId:g.coupons[0].id,claimEventId:g.coupons[0].claimEvents[0].id}];const c=(await submit(g)).result;
   const old=await one(admin,"select resource_kind kind,resource_id id from faolla_checkout_design.bundle_results where receipt->'version'='1'::jsonb limit 1");assert.ok(old);
   const scope={siteId:site,resources:[{kind:'order',id:c.resourceId},{kind:'order',id:'unlinked-read-only'},old,{kind:'order',id:p.resourceId}]},before=await all();
   const s=await reporting.readCartCheckoutReporting(scope,async(name,args)=>{assert.equal(name,'faolla_member_checkout_reporting_v3');return{data:(await one(admin,'select public.faolla_member_checkout_reporting_v3($1,$2) result',[args.p_site_id,JSON.stringify(args.p_resources)])).result,error:null};});
   assert.equal(s.version,3);assert.equal(s.rows[0].cart.method,'on_site');assert.equal(s.rows[0].cart.grossMinor,2500);assert.equal(s.rows[0].cart.dueMinor,2300);assert.equal(s.rows[0].onSite,undefined);
   assert.equal(s.rows[1].result,null);assert.equal(s.rows[1].cart,undefined);assert.equal(s.rows[2].result.version,1);assert.equal(s.rows[3].cart.method,'points');assert.equal(s.rows[3].cart.totalPoints,200);
   assert.ok(!/memberId|customerAccountId|principalKey|claimEvents|redeemEvents|pointTransactionId|stockItemId|PRIVATE-CLAIM|example.invalid/.test(JSON.stringify(s)));assert.deepEqual(await all(),before);
  });
  await t.test('actual old cash single remains a version-two projection inside new mixed report and personal resource lookup',async()=>{
   const f=await seed('on_site'),first=f.request.lines[0],request={siteId:site,...first,nonce:randomUUID(),confirmationHash:'0'.repeat(64),method:'on_site',customer:f.request.customer};
   let id=cashPlanner.onSiteSubmissionIdentity(request,f.principal);
   const readOld=async()=>(await one(admin,'select public.faolla_member_checkout_on_site_snapshot_v1($1,$2,$3,$4,$5) result',[site,id.operationKey,id.principalKey,id.requestHash,first.offerId])).result;
   const raw=(await readOld()).snapshot;request.confirmationHash=cashPlanner.quoteOnSiteSubmissionSnapshot(raw,id,f.principal).confirmationHash;id=cashPlanner.onSiteSubmissionIdentity(request,f.principal);
   const snapshot=(await readOld()).snapshot,p=cashPlanner.planOnSiteSubmission(snapshot,id,f.principal),r=(await one(a,'select public.faolla_member_checkout_on_site_commit_v1($1,$2,$3,$4,$5,$6,$7) result',[site,id.operationKey,id.principalKey,id.requestHash,snapshot,p.plan,p.notAfter])).result.result;
   const before=await all(),scope={siteId:site,resources:[{kind:'order',id:r.terms.resourceId}]};
   const report=reportDto.parseCheckoutReportingSnapshot((await one(admin,'select public.faolla_member_checkout_reporting_v3($1,$2) result',[site,JSON.stringify(scope.resources)])).result,scope);
   assert.equal(report.rows[0].cart,undefined);assert.equal(report.rows[0].onSite.version,2);assert.equal(report.rows[0].onSite.terms.dueMinor,r.terms.dueMinor);
   const personal=(await one(admin,'select public.faolla_member_checkout_original_resource_v2($1,$2,$3,$4) result',[site,'order',r.terms.resourceId,id.principalKey])).result;
   assert.equal(personal.kind,'single');assert.equal(personal.original.method,'on_site');assert.equal(personal.original.result.version,2);assert.deepEqual(await all(),before);
  });
  await t.test('personal cart resource projection is strictly own-principal scoped even when the resource key is known',async()=>{
   const f=await seed(),r=(await submit(f)).result,id=planner.cartSubmissionIdentity(f.request,f.principal),before=await all();
   const read=async(s,k,principal)=>(await one(admin,'select public.faolla_member_checkout_original_resource_v2($1,$2,$3,$4) result',[s,k,r.resourceId,principal])).result;
   const own=await read(site,'order',id.principalKey);assert.equal(own.kind,'cart');assert.equal(own.result.resourceId,r.resourceId);assert.equal(own.result.lines.length,2);
   assert.equal(await read(site,'order','account:50010106:foreign-synthetic-user'),null);assert.equal(await read('10909993','order',id.principalKey),null);assert.equal(await read(site,'booking',id.principalKey),null);
   assert.ok(!/memberId|customerAccountId|principalKey|claimEvents|redeemEvents|PRIVATE-CLAIM|example.invalid/.test(JSON.stringify(own)));assert.deepEqual(await all(),before);
  });
  await t.test('completed cart stays unpaid; cancelled cart reports only actual frozen point/coupon returns',async()=>{
   const f=await seed('on_site'),r=(await submit(f)).result;
   await a.query(`update pages p set blocks=(select jsonb_agg(case when o->>'id'=$2 then jsonb_set(o,'{status}','"completed"') else o end) from jsonb_array_elements(p.blocks) o) where p.merchant_id=$1 and p.slug~'^__merchant_orders__:'`,[site,r.resourceId]);
   const scope={siteId:site,resources:[{kind:'order',id:r.resourceId}]},raw=(await one(admin,'select public.faolla_member_checkout_reporting_v3($1,$2) result',[site,JSON.stringify(scope.resources)])).result;
   const current=reportDto.parseCheckoutReportingSnapshot(raw,scope).rows[0];assert.equal(current.cart.resource.status,'completed');assert.equal(current.cart.capturedMinor,0);assert.equal(current.cart.cancellationAvailable,false);
   const g=await seed('points',f=>{f.offers[1].checkoutBinding.pointsReturnOnCancel=false;});await submit(g);await cancel(g);
   const closed=(await readResult(g)).result,cancelled=(await one(admin,'select public.faolla_member_checkout_original_resource_v2($1,$2,$3,$4) result',[site,'order',closed.resourceId,planner.cartSubmissionIdentity(g.request,g.principal).principalKey])).result;
   assert.equal(cancelled.result.closed,true);assert.equal(cancelled.result.cancellation.pointsReturned,100);assert.equal(cancelled.result.totalPoints,200);
  });
  await t.test('a changed source visible inside a rolled-back test transaction is review-required, never ordinary unpaid',async()=>{
   const f=await seed('on_site'),r=(await submit(f)).result,before=await all(),scope={siteId:site,resources:[{kind:'order',id:r.resourceId}]};
   // Deferred original final-state guard remains installed. Never commit this
   // deliberately inconsistent synthetic record; no guard is disabled.
   await a.query('begin');try{
    await a.query(`update pages p set blocks=(select jsonb_agg(case when o->>'id'=$2 then jsonb_set(o,'{totalAmount}','999') else o end) from jsonb_array_elements(p.blocks) o) where p.merchant_id=$1 and p.slug~'^__merchant_orders__:'`,[site,r.resourceId]);
    const raw=(await one(a,'select public.faolla_member_checkout_reporting_v3($1,$2) result',[site,JSON.stringify(scope.resources)])).result,s=reportDto.parseCheckoutReportingSnapshot(raw,scope);
    assert.equal(s.rows[0].cart.reviewRequired,true);assert.equal(s.rows[0].termsMatch,false);assert.equal(s.rows[0].cart.cancellationAvailable,false);assert.equal(reportDto.checkoutReportingNeedsReview(s.rows[0]),true);
   }finally{await a.query('rollback');}assert.deepEqual(await all(),before);
  });
  await t.test('fifty bounded report references include a real twenty-line cart with no partial totals or data writes',async()=>{
   const f=await seed('points',f=>{f.member.pointBalance=10000;},20),r=(await submit(f)).result,resources=[{kind:'order',id:r.resourceId},...Array.from({length:49},(_,i)=>({kind:'order',id:`unlinked-${i}`}))],before=await all();
   const raw=(await one(admin,'select public.faolla_member_checkout_reporting_v3($1,$2) result',[site,JSON.stringify(resources)])).result,s=reportDto.parseCheckoutReportingSnapshot(raw,{siteId:site,resources});
   assert.equal(s.rows.length,50);assert.equal(s.rows[0].cart.lines.length,20);assert.equal(s.rows[0].cart.totalPoints,2000);assert.ok(s.rows.slice(1).every(r=>r.result===null&&!r.cart&&!r.onSite));assert.deepEqual(await all(),before);
   await assert.rejects(one(admin,'select public.faolla_member_checkout_reporting_v3($1,$2)',[site,JSON.stringify([...resources,{kind:'order',id:'overflow'}])]),/checkout_reporting_invalid/);
  });
  await t.test('new read projections are STABLE invokers, denied to every API role, with all prior writers/readers unchanged',async()=>{
   for(const role of ['anon','authenticated','service_role']){const c=await connect(role);for(const signature of ['faolla_member_checkout_reporting_v3(text,jsonb)','faolla_member_checkout_original_resource_v2(text,text,text,text)'])
    assert.equal((await one(c,'select has_function_privilege(current_user,$1,\'EXECUTE\') allowed',[`public.${signature}`])).allowed,false);
    await assert.rejects(c.query('select public.faolla_member_checkout_reporting_v3($1,$2)',[site,JSON.stringify([{kind:'order',id:'any'}])]),/permission denied/);}
   const definitionsNew=(await admin.query("select provolatile,prosecdef from pg_proc where oid in ('public.faolla_member_checkout_reporting_v3(text,jsonb)'::regprocedure,'public.faolla_member_checkout_original_resource_v2(text,text,text,text)'::regprocedure)")).rows;
   assert.equal(definitionsNew.length,2);assert.ok(definitionsNew.every(r=>r.provolatile==='s'&&r.prosecdef===false));assert.deepEqual(await definitions(),beforeDefinitions);
  });
  await pendingIntentAcceptance({t,admin,a,b,site,one,seed,prepare,commit,cancel,all,temporary,connect,definitions,beforeDefinitions,
   sql:async()=> (await Promise.all(['database/proposals/20261123_member_checkout_pending_intents.sql','database/proposals/20261123_member_checkout_intent_review.sql'].map(file=>readFile(path.resolve(file),'utf8')))).join('\n')});
  console.log(`CART_SUBMISSION_EVIDENCE=${evidence}`);
 }finally{
  await Promise.all(clients.map(c=>c.end().catch(()=>{})));if(started){const lines=(await readFile(path.join(cluster,'postmaster.pid'),'utf8')).split(/\r?\n/);
   assert.equal(path.resolve(lines[1]).toLowerCase(),path.resolve(cluster).toLowerCase());assert.equal(Number(lines[3]),port);
   await exec(binaries.pg_ctl,['-D',cluster,'-w','-t','30','stop','-m','fast'],{windowsHide:true,timeout:45000});}
  console.log(`CART_SUBMISSION_CLUSTER_STOPPED=${evidence}`);
 }
});
