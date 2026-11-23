// Actual proposal + trusted quote service, synthetic loopback TEMP DB ONLY.
// No env loading, remote URL, real account data, writes through app or Stripe.
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
import cart from '../src/lib/merchantCheckoutCartQuote.server.ts';
import fixtures from './fixtures/member-checkout-cart-quote.ts';

test('cart read-only proposal and service on owned synthetic PostgreSQL', {timeout:120000}, async t=>{
 const runtime=path.resolve(process.env.FAOLLA_BOOKING_TEST_RUNTIME_DIR||'.missing-test-runtime'),relative=path.relative(tmpdir(),runtime);
 assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(runtime).startsWith('faolla-booking-pg-'));
 const requireTest=createRequire(path.join(runtime,'test-loader.cjs')),pgRoot=path.join(runtime,'node_modules/@embedded-postgres/windows-x64');
 assert.equal(JSON.parse(await readFile(path.join(pgRoot,'package.json'),'utf8')).version,'17.10.0-beta.17');
 assert.equal(JSON.parse(await readFile(path.join(runtime,'node_modules/pg/package.json'),'utf8')).version,'8.23.1');
 const {Client}=requireTest('pg'),binaries=await import(pathToFileURL(path.join(pgRoot,'dist/index.js')).href),exec=promisify(execFile);
 const evidence=await mkdtemp(path.join(tmpdir(),'faolla-checkout-cart-quote-test-')),cluster=path.join(evidence,'cluster');
 const socket=net.createServer();await new Promise((resolve,reject)=>{socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve);});
 const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));let started=false,config;const clients=[];
 const one=async(c,sql,args=[])=>(await c.query(sql,args)).rows[0];
 const connect=async role=>{const c=new Client(config);await c.connect();clients.push(c);if(role)await c.query(`set role ${role}`);return c;};
 try{
  await exec(binaries.initdb,['-D',cluster,'-U','cart_quote_admin','-A','trust','--encoding=UTF8','--locale=C'],{windowsHide:true,timeout:60000});
  await exec(binaries.pg_ctl,['-D',cluster,'-l',path.join(evidence,'postgres.log'),'-w','-t','30','-o',`-h 127.0.0.1 -p ${port} -c shared_buffers=16MB -c max_connections=12`,'start'],{windowsHide:true,timeout:45000});started=true;
  config={host:'127.0.0.1',port,user:'cart_quote_admin',database:'postgres',password:'',ssl:false,connectionTimeoutMillis:5000,statement_timeout:15000,query_timeout:20000,application_name:'faolla-cart-quote-isolated'};
  const admin=await connect(),a=await connect(),b=await connect();
  assert.equal(path.resolve((await one(admin,'show data_directory')).data_directory).toLowerCase(),path.resolve(cluster).toLowerCase());
  await admin.query(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
   create table public.pages(id uuid primary key default gen_random_uuid(),merchant_id text,slug text,blocks jsonb,updated_at timestamptz default clock_timestamp());
   create table public.faolla_schema_migrations(version bigint primary key,name text not null);
   grant usage on schema public to anon,authenticated,service_role;grant select,insert,update,delete on pages to service_role;
   create function public.set_pages_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end;$$;
   create trigger set_pages_updated_at before update on pages for each row execute function public.set_pages_updated_at();`);
  for(const file of ['scripts/supabase-migrations/202609080045_order_membership_atomic_mutation.sql','scripts/supabase-migrations/202609080046_redemption_atomic_mutation.sql',
   'scripts/supabase-migrations/202610250211_booking_atomic_preparation.sql','scripts/supabase-migrations/202610250212_booking_atomic_runtime.sql','scripts/supabase-migrations/202611050213_booking_atomic_safeupdate_singleton.sql',
   'database/proposals/20261122_member_checkout_design.sql','database/proposals/20261122_member_checkout_catalog.sql','database/proposals/20261122_member_checkout_bundle.sql',
   'database/proposals/20261122_member_checkout_cancellation.sql','database/proposals/20261122_member_checkout_queries.sql','database/proposals/20261123_member_checkout_legacy_boundary.sql',
   'database/proposals/20261123_member_checkout_on_site_pending.sql','database/proposals/20261123_member_checkout_on_site_cancellation.sql',
   'database/proposals/20261122_member_checkout_submission.sql','database/proposals/20261123_member_checkout_on_site_submission.sql',
   'database/proposals/20261123_member_checkout_reporting.sql','database/proposals/20261123_member_checkout_presentation.sql','database/proposals/20261123_member_checkout_on_site_management.sql',
   'database/proposals/20261123_member_checkout_cart_quote.sql'])await admin.query(await readFile(path.resolve(file),'utf8'));
  const site='10909994',memberSlug=`__merchant_memberships__:${site}`;
  await admin.query('insert into faolla_checkout_design.bundle_pilots(site_id,enabled) values($1,true)',[site]);
  const savePage=async row=>{
   const found=await one(admin,'select id from pages where merchant_id is not distinct from $1 and slug is not distinct from $2',[row.merchant_id,row.slug]);
   if(found)await admin.query('update pages set blocks=$2 where id=$1',[found.id,JSON.stringify(row.blocks)]);
   else await admin.query('insert into pages(id,merchant_id,slug,blocks) values($1,$2,$3,$4)',[row.id,row.merchant_id,row.slug,JSON.stringify(row.blocks)]);
  };
  const seed=async(method='points')=>{
   const f=fixtures.cartQuoteFixture(method);for(const row of [...f.snapshot.sourceRows,...f.snapshot.domainRows])await savePage(row);
   let version=(await one(admin,'select public.faolla_member_checkout_catalog_snapshot_v1($1) as result',[site])).result.version;
   // New synthetic offers use the SAME immutable source keys. Reuse a source's
   // stable ID, but create a new revision through the actual catalog writer.
   for(let i=0;i<f.offers.length;i++){
    const previous=await one(admin,`select h.offer_id from faolla_checkout_design.offer_heads h join faolla_checkout_design.offer_versions v using(site_id,offer_id,revision)
      where h.site_id=$1 and v.source_key=$2`,[site,f.offers[i].checkoutBinding.sourceKey]);
    if(previous){f.offers[i].id=previous.offer_id;f.request.lines[i].offerId=previous.offer_id;}
    const next=randomUUID();await admin.query('select public.faolla_member_checkout_catalog_save_v1($1,$2,$3,$4,$5)',[site,version,next,'owner:synthetic-owner',f.offers[i]]);version=next;
   }
   f.refresh();return f;
  };
  const read=async(f,c=admin,ids=f.identity().request.lines.map(line=>line.offerId))=>(await one(c,'select public.faolla_member_checkout_cart_quote_snapshot_v1($1,$2,$3,$4) as result',
    [site,f.identity().principalKey,f.identity().requestHash,JSON.stringify(ids)])).result;
  const all=async()=>({pages:(await admin.query('select * from pages order by id')).rows,
   control:(await admin.query('select * from faolla_booking_atomic_control')).rows,commands:(await admin.query('select * from faolla_booking_atomic_commands order by command_key')).rows,
   operations:(await admin.query('select * from faolla_redemption_operations order by operation_id')).rows,
   results:(await admin.query('select * from faolla_checkout_design.bundle_results order by operation_key')).rows,
   cancellations:(await admin.query('select * from faolla_checkout_design.bundle_cancellations order by operation_key')).rows,
   returns:(await admin.query('select * from faolla_checkout_design.bundle_coupon_returns order by redeem_event_id')).rows,
   collections:(await admin.query('select * from faolla_checkout_design.on_site_collections order by operation_key')).rows,
   settlements:(await admin.query('select * from faolla_checkout_design.settlements order by operation_key')).rows,
   facts:(await admin.query('select * from faolla_checkout_design.facts order by id')).rows,
   offers:(await admin.query('select * from faolla_checkout_design.offer_heads order by offer_id')).rows});
  let calls=0;
  const rpc=client=>async(name,args,signal)=>{
   assert.ok(signal instanceof AbortSignal);assert.equal(name,'faolla_member_checkout_cart_quote_snapshot_v1');calls++;
   try{return{data:(await one(client,'select public.faolla_member_checkout_cart_quote_snapshot_v1($1,$2,$3,$4) as result',
     [args.p_site_id,args.p_principal_key,args.p_request_hash,JSON.stringify(args.p_offer_ids)])).result,error:null};}
   catch(error){return{data:null,error:{message:error.message}};}
  };
  const preview=(f,client=admin)=>cart.previewCheckoutCart({request:f.request,principal:f.principal,authorize:async()=>f.principal,enabled:()=>true},rpc(client));
  await t.test('separate quote gate defaults closed and cannot be opened by an existing checkout pilot',async()=>{
   const f=await seed(),before=await all();await assert.rejects(read(f),/checkout_disabled/);assert.deepEqual(await all(),before);
   await admin.query('insert into faolla_checkout_design.cart_quote_pilots(site_id) values($1)',[site]);await assert.rejects(read(f),/checkout_disabled/);
   await admin.query('update faolla_checkout_design.cart_quote_pilots set enabled=true where site_id=$1',[site]);
  });
  await t.test('actual SQL snapshot and trusted points service produce one safe total and change no business tables',async()=>{
   const f=await seed();await savePage({id:randomUUID(),merchant_id:site,slug:`__merchant_orders__:${site}`,blocks:[{id:'private-old-order',privateContact:'do-not-read-for-quote'}]});
   const raw=await read(f);assert.equal(raw.domainRows.some(row=>row.slug.startsWith('__merchant_orders__')),false);
   const before=await all();calls=0;const q=await preview(f);assert.equal(q.duePoints,200);assert.equal(q.methodAvailable,true);assert.equal(calls,1);
   assert.equal(q.canSubmit,false);assert.ok(!/PRIVATE|private-cart|sourceRows|principalKey|example.invalid/.test(JSON.stringify(q)));assert.deepEqual(await all(),before);
  });
  await t.test('each line is affordable but whole-cart points are insufficient',async()=>{
   const f=await seed();f.member.pointBalance=150;await savePage(f.snapshot.domainRows[0]);const before=await all(),q=await preview(f);
   assert.equal(q.duePoints,200);assert.equal(q.methodAvailable,false);assert.equal(q.reason,'insufficient_points');assert.deepEqual(await all(),before);
  });
  await t.test('cash quote consumes neither points nor coupons and uses integer EUR totals',async()=>{
   const f=await seed('on_site');f.request.lines[0].couponClaims=[{couponId:f.coupons[0].id,claimEventId:f.coupons[0].claimEvents[0].id}];f.refresh();
   const before=await all(),q=await preview(f);assert.equal(q.grossMinor,2500);assert.equal(q.discountMinor,200);assert.equal(q.dueMinor,2300);assert.equal(q.capturedMinor,0);
   assert.equal(q.duePoints,null);assert.deepEqual(await all(),before);
  });
  await t.test('JSONB key ordering cannot corrupt selected points coupon validation',async()=>{
   const f=await seed();f.request.lines[0].couponClaims=[{couponId:f.coupons[0].id,claimEventId:f.coupons[0].claimEvents[0].id}];f.refresh();
   const before=await all(),q=await preview(f);assert.equal(q.duePoints,180);assert.equal(q.couponCount,1);assert.deepEqual(await all(),before);
  });
  await t.test('shared stock is checked against the whole original snapshot',async()=>{
   const f=await seed();f.offers[1].checkoutBinding.stockItemId='stock-0';f.settings.redemptionItems[0].stock=1;
   let version=(await one(admin,'select public.faolla_member_checkout_catalog_snapshot_v1($1) as result',[site])).result.version;
   f.offers[1].revision=randomUUID();f.request.lines[1].offerRevision=f.offers[1].revision;
   await admin.query('select public.faolla_member_checkout_catalog_save_v1($1,$2,$3,$4,$5)',[site,version,randomUUID(),'owner:synthetic-owner',f.offers[1]]);await savePage(f.snapshot.domainRows[1]);
   const before=await all();await assert.rejects(preview(f),/checkout_quantity_unavailable/);assert.deepEqual(await all(),before);
  });
  await t.test('global points-voucher cap cannot be bypassed by allocating a claim to each product',async()=>{
   const f=await seed();f.request.lines.forEach((line,i)=>line.couponClaims=[{couponId:f.coupons[i].id,claimEventId:f.coupons[i].claimEvents[0].id}]);
   f.coupons[0].pointsVoucherMaxPerRedemption=1;await savePage(f.snapshot.domainRows[2]);const before=await all();
   await assert.rejects(preview(f),/checkout_coupon_stack_not_allowed/);assert.deepEqual(await all(),before);
  });
  await t.test('one STABLE outer statement sees the old offer, member and publication together despite a concurrent commit',async()=>{
   const f=await seed(),old=await read(f),gate=73501941;
   await a.query('begin');await a.query('select pg_advisory_xact_lock($1)',[gate]);
   const pending=b.query(`select public.faolla_member_checkout_cart_quote_snapshot_v1($1,$2,$3,
    (select $4::jsonb from pg_advisory_xact_lock($5))) as result`,[site,f.identity().principalKey,f.identity().requestHash,JSON.stringify(f.identity().request.lines.map(line=>line.offerId)),gate]);
   // Install a rejection handler immediately; preserve the original assertion.
   pending.catch(()=>{});
   try{
    const limit=Date.now()+2500;let blocked=false;
    while(Date.now()<limit){blocked=(await one(admin,"select wait_event='advisory' as blocked from pg_stat_activity where pid=$1",[b.processID]))?.blocked;
     if(blocked)break;await new Promise(resolve=>setTimeout(resolve,15));}
    assert.equal(blocked,true,'read has actually started and is waiting at the argument barrier');
    await admin.query('begin');
    await admin.query("update pages set blocks=jsonb_set(blocks,'{0,pointBalance}','777') where merchant_id=$1 and slug=$2",[site,memberSlug]);
    await admin.query("update pages set blocks=blocks||'[{}]'::jsonb where merchant_id=$1 and slug='synthetic-cart-public'",[site]);
    await admin.query('update faolla_checkout_design.offer_heads set enabled=false where site_id=$1',[site]);await admin.query('commit');
   }finally{await a.query('rollback');}
   const actual=(await pending).rows[0].result;
   assert.deepEqual(actual.offers,old.offers);assert.deepEqual(actual.domainRows,old.domainRows);assert.deepEqual(actual.sourceRows,old.sourceRows);
   const q=await cart.quoteCheckoutCartSnapshot(actual,f.identity(),f.principal);assert.equal(q.ownPointBalance,1000);assert.equal(q.duePoints,200);
   // It is only a preview, not proof the now-disabled source may be submitted.
   await assert.rejects(read(f),/checkout_offer_not_found/);
  });
  await t.test('old raw quote is no financial token and later fresh reads see changed stock and membership',async()=>{
   const f=await seed(),old=await read(f);f.member.status='left';await savePage(f.snapshot.domainRows[0]);
   const before=await all();await assert.rejects(preview(f),/checkout_membership_unavailable/);
   assert.equal((await cart.quoteCheckoutCartSnapshot(old,f.identity(),f.principal)).canSubmit,false);assert.deepEqual(await all(),before);
  });
  await t.test('invalid/foreign offer selection and API roles cannot expose raw pages',async()=>{
   const f=await seed(),ids=f.identity().request.lines.map(line=>line.offerId);
   for(const bad of [[],[ids[0],ids[0]],[randomUUID()],Array(21).fill(ids[0]),['bad'],[1]])await assert.rejects(read(f,admin,bad),/checkout_invalid_cart|checkout_offer_not_found/);
   for(const role of ['anon','authenticated','service_role']){
    const c=await connect(role);assert.equal((await one(c,"select has_function_privilege(current_user,'public.faolla_member_checkout_cart_quote_snapshot_v1(text,text,text,jsonb)','EXECUTE') as allowed")).allowed,false);
    await assert.rejects(read(f,c),/permission denied/);await assert.rejects(c.query('select * from faolla_checkout_design.cart_quote_pilots'),/permission denied/);
   }
   const meta=await one(admin,"select provolatile,prosecdef from pg_proc where oid='public.faolla_member_checkout_cart_quote_snapshot_v1(text,text,text,jsonb)'::regprocedure");
   assert.equal(meta.provolatile,'s');assert.equal(meta.prosecdef,false);
  });
  console.log(`CART_QUOTE_EVIDENCE=${evidence}`);
 }finally{
  await Promise.all(clients.map(c=>c.end().catch(()=>{})));
  if(started){const postmaster=(await readFile(path.join(cluster,'postmaster.pid'),'utf8')).split(/\r?\n/);
   assert.equal(path.resolve(postmaster[1]).toLowerCase(),path.resolve(cluster).toLowerCase());assert.equal(Number(postmaster[3]),port);
   await exec(binaries.pg_ctl,['-D',cluster,'-w','-t','30','stop','-m','fast'],{windowsHide:true,timeout:45000});}
  console.log(`CART_QUOTE_CLUSTER_STOPPED=${evidence}`);
 }
});
