// Independent owned TEMP cluster for bounded no-nonce history inventory.
// Existing original/booking suite is unchanged in coverage and timeout.
import assert from'node:assert/strict';import test from'node:test';import path from'node:path';import net from'node:net';
import{readFile,mkdtemp}from'node:fs/promises';import{tmpdir}from'node:os';import{createRequire}from'node:module';import{pathToFileURL}from'node:url';import{execFile}from'node:child_process';import{promisify}from'node:util';import{randomUUID}from'node:crypto';
import fixtures from'./fixtures/member-checkout-cart-quote.ts';import{retainedIntentCases}from'./member-checkout-retained-intent-postgres-cases.mjs';
test('isolated history inventory preserves exact original ownership, financial state and all old SQL definitions',{timeout:120000},async t=>{
 const runtime=path.resolve(process.env.FAOLLA_BOOKING_TEST_RUNTIME_DIR||'.missing-test-runtime'),relative=path.relative(tmpdir(),runtime);
 assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(runtime).startsWith('faolla-booking-pg-'));
 const requireTest=createRequire(path.join(runtime,'test-loader.cjs')),pgRoot=path.join(runtime,'node_modules/@embedded-postgres/windows-x64');
 assert.equal(JSON.parse(await readFile(path.join(pgRoot,'package.json'),'utf8')).version,'17.10.0-beta.17');assert.equal(JSON.parse(await readFile(path.join(runtime,'node_modules/pg/package.json'),'utf8')).version,'8.23.1');
 const{Client}=requireTest('pg'),binaries=await import(pathToFileURL(path.join(pgRoot,'dist/index.js')).href),exec=promisify(execFile);
 const evidence=await mkdtemp(path.join(tmpdir(),'faolla-checkout-inventory-test-')),cluster=path.join(evidence,'cluster'),socket=net.createServer();
 await new Promise((resolve,reject)=>{socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve);});const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
 const clients=[];let started=false;const one=async(c,sql,args=[])=>(await c.query(sql,args)).rows[0];
 try{
  await exec(binaries.initdb,['-D',cluster,'-U','inventory_admin','-A','trust','--encoding=UTF8','--locale=C'],{windowsHide:true,timeout:60000});
  await exec(binaries.pg_ctl,['-D',cluster,'-l',path.join(evidence,'postgres.log'),'-w','-t','30','-o',`-h 127.0.0.1 -p ${port} -c shared_buffers=16MB -c max_connections=12`,'start'],{windowsHide:true,timeout:45000});started=true;
  const connect=async()=>{const c=new Client({host:'127.0.0.1',port,user:'inventory_admin',database:'postgres',password:'',ssl:false,connectionTimeoutMillis:5000,statement_timeout:15000,query_timeout:20000,application_name:'faolla-inventory-isolated'});await c.connect();clients.push(c);return c;};
  const admin=await connect(),a=await connect(),b=await connect();assert.equal(path.resolve((await one(admin,'show data_directory')).data_directory).toLowerCase(),path.resolve(cluster).toLowerCase());
  await admin.query(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
   create table public.pages(id uuid primary key default gen_random_uuid(),merchant_id text,slug text,blocks jsonb,updated_at timestamptz default clock_timestamp());
   create table public.faolla_schema_migrations(version bigint primary key,name text not null);grant usage on schema public to anon,authenticated,service_role;grant select,insert,update,delete on pages to service_role;
   create function public.set_pages_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end;$$;
   create trigger set_pages_updated_at before update on pages for each row execute function public.set_pages_updated_at();`);
  for(const file of ['scripts/supabase-migrations/202609080045_order_membership_atomic_mutation.sql','scripts/supabase-migrations/202609080046_redemption_atomic_mutation.sql',
   'scripts/supabase-migrations/202610250211_booking_atomic_preparation.sql','scripts/supabase-migrations/202610250212_booking_atomic_runtime.sql','scripts/supabase-migrations/202611050213_booking_atomic_safeupdate_singleton.sql',
   'database/proposals/20261122_member_checkout_design.sql','database/proposals/20261122_member_checkout_catalog.sql','database/proposals/20261122_member_checkout_bundle.sql','database/proposals/20261122_member_checkout_cancellation.sql','database/proposals/20261122_member_checkout_queries.sql',
   'database/proposals/20261123_member_checkout_legacy_boundary.sql','database/proposals/20261123_member_checkout_on_site_pending.sql','database/proposals/20261123_member_checkout_on_site_cancellation.sql','database/proposals/20261122_member_checkout_submission.sql','database/proposals/20261123_member_checkout_on_site_submission.sql',
   'database/proposals/20261123_member_checkout_reporting.sql','database/proposals/20261123_member_checkout_presentation.sql','database/proposals/20261123_member_checkout_on_site_management.sql','database/proposals/20261123_member_checkout_cart_quote.sql','database/proposals/20261123_member_checkout_cart_collection.sql',
   'database/proposals/20261123_member_checkout_cart_submission.sql','database/proposals/20261123_member_checkout_cart_cancellation.sql','database/proposals/20261123_member_checkout_cart_presentation.sql','database/proposals/20261123_member_checkout_pending_intents.sql','database/proposals/20261123_member_checkout_intent_review.sql','database/proposals/20261124_member_checkout_retained_intent.sql'])await admin.query(await readFile(path.resolve(file),'utf8'));
  const definitions=async()=>(await admin.query("select p.oid::regprocedure::text name,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','faolla_checkout_design') and p.prokind='f' and p.proname<>'faolla_member_checkout_history_inventory_v1' order by name")).rows;
  const beforeDefinitions=await definitions();await admin.query(await readFile(path.resolve('database/proposals/20261124_member_checkout_history_inventory.sql'),'utf8'));
  const site='10909994';let principalIndex=0;for(const table of ['bundle_pilots','cart_quote_pilots','cart_submission_pilots','intent_pilots'])await admin.query(`insert into faolla_checkout_design.${table}(site_id,enabled) values($1,true)`,[site]);
  const savePage=async row=>{const found=await one(admin,'select id from pages where merchant_id is not distinct from $1 and slug is not distinct from $2',[row.merchant_id,row.slug]);
   if(found)await admin.query('update pages set blocks=$2 where id=$1',[found.id,JSON.stringify(row.blocks)]);else await admin.query('insert into pages(id,merchant_id,slug,blocks) values($1,$2,$3,$4)',[row.id,row.merchant_id,row.slug,JSON.stringify(row.blocks)]);};
  const seed=async(method='points')=>{
   const f=fixtures.cartQuoteFixture(method),accountId=String(58000000+(++principalIndex)),userId=`inventory-synthetic-${principalIndex}`;
   Object.assign(f.principal,{accountId,userId});Object.assign(f.member,{accountId,userId});for(const c of f.coupons)for(const claim of c.claimEvents)Object.assign(claim,{accountId,userId});f.snapshot.principalKey=`account:${accountId}:${userId}`;
   for(const row of [...f.snapshot.sourceRows,...f.snapshot.domainRows])await savePage(row);
   let version=(await one(admin,'select public.faolla_member_checkout_catalog_snapshot_v1($1) result',[site])).result.version;
   for(let i=0;i<f.offers.length;i++){const previous=await one(admin,'select v.offer_id from faolla_checkout_design.offer_heads h join faolla_checkout_design.offer_versions v using(site_id,offer_id,revision) where h.site_id=$1 and v.source_key=$2',[site,f.offers[i].checkoutBinding.sourceKey]);
    if(previous){f.offers[i].id=previous.offer_id;f.request.lines[i].offerId=previous.offer_id;}const next=randomUUID();await admin.query('select public.faolla_member_checkout_catalog_save_v1($1,$2,$3,$4,$5)',[site,version,next,'owner:synthetic-owner',f.offers[i]]);version=next;}
   f.refresh();f.request={...f.request,nonce:randomUUID(),confirmationHash:'0'.repeat(64),customer:{name:'Synthetic',title:'Mx',email:'synthetic@example.invalid',phone:'000',note:''}};return f;
  };
  const dispatch=c=>async(name,args)=>{
   const keys={faolla_member_checkout_cart_submission_snapshot_v1:['p_site_id','p_operation_key','p_principal_key','p_request_hash','p_quote_request_hash','p_offer_ids']}[name];assert.ok(keys,`unexpected private RPC ${name}`);
   try{return{data:(await one(c,`select public.${name}(${keys.map((_,i)=>'$'+(i+1)).join(',')}) result`,keys.map(k=>k==='p_offer_ids'?JSON.stringify(args[k]):args[k]))).result,error:null};}catch(error){return{data:null,error:{message:error.message}};}
  };
  const state=async()=>{const value={};for(const row of(await admin.query("select schemaname,tablename from pg_tables where schemaname in ('public','faolla_checkout_design') order by schemaname,tablename")).rows){assert.match(row.tablename,/^[a-z0-9_]+$/);value[`${row.schemaname}.${row.tablename}`]=(await admin.query(`select to_jsonb(t) r from ${row.schemaname}.${row.tablename} t order by to_jsonb(t)::text`)).rows;}return value;};
  const inventoryCases=await retainedIntentCases(t,{admin,a,b,seed,state,site,one,dispatch},{inventoryOnly:true});await inventoryCases();assert.deepEqual(await definitions(),beforeDefinitions);
  console.log(`HISTORY_INVENTORY_POSTGRES_EVIDENCE=${evidence}`);
 }finally{
  await Promise.all(clients.map(c=>c.end().catch(()=>{})));if(started){const lines=(await readFile(path.join(cluster,'postmaster.pid'),'utf8')).split(/\r?\n/);assert.equal(path.resolve(lines[1]).toLowerCase(),path.resolve(cluster).toLowerCase());assert.equal(Number(lines[3]),port);await exec(binaries.pg_ctl,['-D',cluster,'-w','-t','30','stop','-m','fast'],{windowsHide:true,timeout:45000});}
  console.log(`HISTORY_INVENTORY_CLUSTER_STOPPED=${evidence}`);
 }
});
