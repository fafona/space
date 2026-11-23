// Independent owned TEMP cluster: avoids extending the existing 120s cart
// acceptance window. Actual legacy POST/creator, CAS, intent and cart writers;
// synthetic sessions/catalog IO only, DNT disables analytics, no live clients.
import assert from 'node:assert/strict';import test from 'node:test';
import{readFile,mkdtemp}from'node:fs/promises';import{createRequire}from'node:module';import{tmpdir}from'node:os';
import path from'node:path';import{pathToFileURL}from'node:url';import{execFile}from'node:child_process';import{promisify}from'node:util';import net from'node:net';import{randomUUID}from'node:crypto';
import fixtures from'./fixtures/member-checkout-cart-quote.ts';
import service from'../src/lib/merchantCheckoutCartSubmission.server.ts';import boundary from'../src/lib/merchantCheckoutLegacyBoundary.server.ts';
import creator from'../src/lib/merchantOrders.server.ts';import orders from'../src/lib/merchantOrders.ts';import route from'../src/app/api/orders/route-handler.ts';
import {legacyBookingIntentCases} from './member-checkout-legacy-booking-intent-postgres-cases.mjs';
import {closedGateOrderCases} from './member-checkout-closed-gate-creation-postgres-cases.mjs';
import {retainedOrderCases} from './member-checkout-retained-orders-postgres-cases.mjs';

test('ordinary order creation cannot bypass an enrolled original pending review',{timeout:120000},async t=>{
 const runtime=path.resolve(process.env.FAOLLA_BOOKING_TEST_RUNTIME_DIR||'.missing-test-runtime'),relative=path.relative(tmpdir(),runtime);
 assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(runtime).startsWith('faolla-booking-pg-'));
 const requireTest=createRequire(path.join(runtime,'test-loader.cjs')),pgRoot=path.join(runtime,'node_modules/@embedded-postgres/windows-x64');
 assert.equal(JSON.parse(await readFile(path.join(pgRoot,'package.json'),'utf8')).version,'17.10.0-beta.17');assert.equal(JSON.parse(await readFile(path.join(runtime,'node_modules/pg/package.json'),'utf8')).version,'8.23.1');
 const{Client}=requireTest('pg'),binaries=await import(pathToFileURL(path.join(pgRoot,'dist/index.js')).href),exec=promisify(execFile);
 const evidence=await mkdtemp(path.join(tmpdir(),'faolla-checkout-order-intent-test-')),cluster=path.join(evidence,'cluster'),socket=net.createServer();
 await new Promise((resolve,reject)=>{socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve);});const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
 const clients=[];let started=false,config;const one=async(c,sql,args=[])=>(await c.query(sql,args)).rows[0];
 const connect=async()=>{const c=new Client(config);await c.connect();clients.push(c);return c;};
 try{
  await exec(binaries.initdb,['-D',cluster,'-U','legacy_intent_admin','-A','trust','--encoding=UTF8','--locale=C'],{windowsHide:true,timeout:60000});
  await exec(binaries.pg_ctl,['-D',cluster,'-l',path.join(evidence,'postgres.log'),'-w','-t','30','-o',`-h 127.0.0.1 -p ${port} -c shared_buffers=16MB -c max_connections=12`,'start'],{windowsHide:true,timeout:45000});started=true;
  config={host:'127.0.0.1',port,user:'legacy_intent_admin',database:'postgres',password:'',ssl:false,connectionTimeoutMillis:5000,statement_timeout:15000,query_timeout:20000,application_name:'faolla-legacy-order-intent-isolated'};
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
   'database/proposals/20261123_member_checkout_cart_submission.sql','database/proposals/20261123_member_checkout_cart_cancellation.sql','database/proposals/20261123_member_checkout_cart_presentation.sql','database/proposals/20261123_member_checkout_pending_intents.sql','database/proposals/20261123_member_checkout_intent_review.sql'])await admin.query(await readFile(path.resolve(file),'utf8'));
  const definitions=async()=>(await admin.query("select p.oid::regprocedure::text name,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','faolla_checkout_design') and p.prokind='f' and p.proname not in ('faolla_checkout_legacy_order_commit_v1','faolla_checkout_legacy_booking_commit_v1','guard_closed_gate_creation') order by name")).rows;
  const beforeDefinitions=await definitions();await admin.query(await readFile(path.resolve('database/proposals/20261123_member_checkout_legacy_order_intent.sql'),'utf8'));
  await admin.query(await readFile(path.resolve('database/proposals/20261123_member_checkout_legacy_booking_intent.sql'),'utf8'));
  await admin.query(await readFile(path.resolve('database/proposals/20261123_member_checkout_closed_gate_creation.sql'),'utf8'));
  const site='10909994';let principalIndex=0;for(const table of ['bundle_pilots','cart_quote_pilots','cart_submission_pilots'])await admin.query(`insert into faolla_checkout_design.${table}(site_id,enabled) values($1,true)`,[site]);
  const savePage=async row=>{const found=await one(admin,'select id from pages where merchant_id is not distinct from $1 and slug is not distinct from $2',[row.merchant_id,row.slug]);
   if(found)await admin.query('update pages set blocks=$2 where id=$1',[found.id,JSON.stringify(row.blocks)]);else await admin.query('insert into pages(id,merchant_id,slug,blocks) values($1,$2,$3,$4)',[row.id,row.merchant_id,row.slug,JSON.stringify(row.blocks)]);};
  const seed=async(method='points')=>{
   const f=fixtures.cartQuoteFixture(method),accountId=String(58000000+(++principalIndex)),userId=`ordinary-synthetic-${principalIndex}`;
   Object.assign(f.principal,{accountId,userId});Object.assign(f.member,{accountId,userId});for(const c of f.coupons)for(const claim of c.claimEvents)Object.assign(claim,{accountId,userId});f.snapshot.principalKey=`account:${accountId}:${userId}`;
   for(const row of [...f.snapshot.sourceRows,...f.snapshot.domainRows])await savePage(row);
   let version=(await one(admin,'select public.faolla_member_checkout_catalog_snapshot_v1($1) result',[site])).result.version;
   for(let i=0;i<f.offers.length;i++){const previous=await one(admin,'select v.offer_id from faolla_checkout_design.offer_heads h join faolla_checkout_design.offer_versions v using(site_id,offer_id,revision) where h.site_id=$1 and v.source_key=$2',[site,f.offers[i].checkoutBinding.sourceKey]);
    if(previous){f.offers[i].id=previous.offer_id;f.request.lines[i].offerId=previous.offer_id;}const next=randomUUID();await admin.query('select public.faolla_member_checkout_catalog_save_v1($1,$2,$3,$4,$5)',[site,version,next,'owner:synthetic-owner',f.offers[i]]);version=next;}
   f.refresh();f.request={...f.request,nonce:randomUUID(),confirmationHash:'0'.repeat(64),customer:{name:'Synthetic',title:'Mx',email:'synthetic@example.invalid',phone:'000',note:''}};return f;
  };
  const dispatch=c=>async(name,args)=>{
   const keys={faolla_member_checkout_cart_submission_snapshot_v1:['p_site_id','p_operation_key','p_principal_key','p_request_hash','p_quote_request_hash','p_offer_ids'],faolla_member_checkout_cart_commit_v1:['p_site_id','p_operation_key','p_principal_key','p_request_hash','p_snapshot','p_plan','p_not_after'],faolla_member_checkout_reporting_v3:['p_site_id','p_resources'],
    faolla_checkout_legacy_order_commit_v1:['p_site_id','p_mutation','p_not_after'],faolla_commit_order_membership_v1:['p_site_id','p_mutation']}[name];assert.ok(keys,`unexpected dispatch ${name}`);
   const actual=name==='faolla_member_checkout_cart_commit_v1'?'faolla_member_checkout_intent_cart_commit_v1':name;
   try{return{data:(await one(c,`select public.${actual}(${keys.map((_,i)=>'$'+(i+1)).join(',')}) result`,keys.map(k=>['p_offer_ids','p_resources'].includes(k)?JSON.stringify(args[k]):args[k]))).result,error:null};}catch(error){return{data:null,error:{message:error.message}};}
  };
  const submit=async(f,c=a)=>{const input={request:f.request,principal:f.principal,authorize:async()=>f.principal,enabled:()=>true};const preview=await service.previewCartSubmission(input,dispatch(admin));f.request.confirmationHash=preview.confirmationHash;return service.submitCartCheckout(input,dispatch(c));};
  const rows=async()=> (await admin.query("select id,slug,blocks,updated_at from pages where merchant_id=$1 and (slug=$2 or slug~$3) order by slug,id",[site,`__merchant_orders__:${site}`,`^__merchant_orders__:${site}:chunk:[0-9]+$`])).rows;
  const records=rs=>{const chunks=rs.filter(r=>r.slug.includes(':chunk:'));return(chunks.length?chunks:rs).flatMap(r=>r.blocks);};
  const state=async()=>{const value={};for(const row of(await admin.query("select schemaname,tablename from pg_tables where schemaname in ('public','faolla_checkout_design') order by schemaname,tablename")).rows){assert.match(row.tablename,/^[a-z0-9_]+$/);value[`${row.schemaname}.${row.tablename}`]=(await admin.query(`select to_jsonb(t) r from ${row.schemaname}.${row.tablename} t order by to_jsonb(t)::text`)).rows;}return value;};
  const pending=f=>one(admin,'select public.faolla_member_checkout_pending_intent_v1($1,$2) result',[site,`account:${f.principal.accountId}:${f.principal.userId}`]).then(x=>x.result.pending);
  const ack=async f=>{const r=await pending(f);return one(admin,'select public.faolla_member_checkout_acknowledge_intent_v1($1,$2,$3,$4,$5,$6) result',[site,r.operationKey,`account:${f.principal.accountId}:${f.principal.userId}`,r.generation,r.reviewHash,new Date(Date.now()+11000).toISOString()]);};
  const newInput=f=>({siteId:site,blockId:f.blocks[0].id,clientRequestId:randomUUID(),customerAccountId:f.principal.accountId,customerUserId:f.principal.userId,customerLoginEmail:'synthetic@example.invalid',customer:f.request.customer,items:[{productId:'product-0',name:'Synthetic',quantity:1,unitPrice:10}],pricePrefix:'€'});
  const ordinary=async(f,{input=newInput(f),c=a,lose=false,intent=true}={})=>{
   let mirror=0,calls=0,lastMutation;const client={from:()=>{throw Error('no raw page writes');},rpc:async(name,args)=>{calls++;lastMutation=args.p_mutation;const result=await dispatch(c)(name,args);if(lose&&result.error===null)throw Error('synthetic lost ordinary result');return result;}};
   const deps={createClient:()=>client,loadOrders:async()=>{const storageRows=await rows();return{siteId:site,orders:orders.normalizeMerchantOrderRecords(records(storageRows)),storageRows,updatedAt:null};},
    saveOrders:(client,input)=>boundary.saveCheckoutAwareMerchantOrders(client,input,{enabled:()=>true,cartEnabled:()=>true,intentEnabled:()=>intent,cashEnabled:()=>true,rpc:()=>dispatch(c)}),mirrorOrders:async()=>{mirror++;return{status:'disabled',count:0};}};
   return{create:()=>creator.createMerchantOrderRecord(input,deps),input,deps,stats:()=>({mirror,calls}),mutation:()=>lastMutation};
  };
  const http=async(f,options={})=>{const x=await ordinary(f,options),origin='https://ordinary-order.synthetic.invalid',session={...f.principal,email:'synthetic@example.invalid',user:{email_confirmed_at:new Date().toISOString()},servicePaused:false};let notifications=0;
   const response=await route.handleMerchantOrderPost(new Request(origin+'/api/orders',{method:'POST',headers:{origin,'content-type':'application/json',dnt:'1'},body:JSON.stringify({...x.input,customerAccountId:'99999999',customerUserId:'forged',items:[{productId:'product-0',quantity:1}]})}),{
    loadSnapshotSite:async()=>f.site,loadOperatingCatalog:async()=>null,loadPublishedSite:async()=>({siteId:site,slug:'synthetic',blocks:[{id:f.blocks[0].id,type:'product',props:{productPricePrefix:'€',products:[{id:'product-0',name:'Synthetic',price:'10'}]}}]}),resolvePersonalSession:async()=>session,
    createOrder:input=>{assert.equal(input.customerAccountId,f.principal.accountId);assert.equal(input.customerUserId,f.principal.userId);return creator.createMerchantOrderRecord(input,x.deps);},notifyOrderCreated:async()=>{notifications++;}});
   return{response,notifications,stats:x.stats};
  };
  await t.test('database enrollment defaults closed and ordinary creation does not invent a checkout receipt or claim',async()=>{
   const f=await seed(),x=await ordinary(f),before=await state();const result=await x.create();assert.equal(result.status,'pending');assert.equal(x.stats().calls,1);
   const after=await state();for(const key of Object.keys(before).filter(k=>k!=='public.pages'))assert.deepEqual(after[key],before[key],key);
   await admin.query('insert into faolla_checkout_design.intent_pilots(site_id,enabled) values($1,true)',[site]);
  });
  await t.test('actual ordinary creator refuses a pending points/venue original; explicit acknowledgement permits one ordinary order without changing the original',async()=>{
   for(const method of ['points','on_site']){const f=await seed(method),r=(await submit(f)).result,x=await ordinary(f),before=await state();await assert.rejects(x.create(),/checkout_original_pending/);assert.deepEqual(x.stats(),{mirror:0,calls:1});assert.deepEqual(await state(),before);
    await ack(f);const original=await one(admin,'select * from faolla_checkout_design.bundle_results where site_id=$1 and operation_key=$2',[site,r.operationKey]);const successful=await ordinary(f);const result=await successful.create();assert.equal(result.status,'pending');assert.deepEqual(await one(admin,'select * from faolla_checkout_design.bundle_results where site_id=$1 and operation_key=$2',[site,r.operationKey]),original);
    const stable=await state(),replay=await successful.create();assert.equal(replay.id,result.id);assert.deepEqual(await state(),stable);assert.equal(successful.stats().calls,1);
   }
  });
  await t.test('closing new enrollment cannot bypass an existing pending claim; a guest or another account remains an ordinary order',async()=>{
   const f=await seed();await submit(f);await admin.query('update faolla_checkout_design.intent_pilots set enabled=false where site_id=$1',[site]);try{
    const x=await ordinary(f),before=await state();await assert.rejects(x.create(),/checkout_original_pending/);assert.deepEqual(await state(),before);
    for(const identity of [{customerAccountId:'',customerUserId:'',customerLoginEmail:''},{customerAccountId:'59999999',customerUserId:'other-synthetic'}]){const x=await ordinary(f,{input:{...newInput(f),...identity}});assert.equal((await x.create()).status,'pending');}
   }finally{await admin.query('update faolla_checkout_design.intent_pilots set enabled=true where site_id=$1',[site]);}
  });
  await t.test('an untracked old financial original is review-required, never implicitly adopted or acknowledged by ordinary creation',async()=>{
   await admin.query('update faolla_checkout_design.intent_pilots set enabled=false where site_id=$1',[site]);const f=await seed(),input={request:f.request,principal:f.principal,authorize:async()=>f.principal,enabled:()=>true};
   const raw=async(name,args)=>{if(name==='faolla_member_checkout_cart_commit_v1'){try{return{data:(await one(a,'select public.faolla_member_checkout_cart_commit_v1($1,$2,$3,$4,$5,$6,$7) result',[site,args.p_operation_key,args.p_principal_key,args.p_request_hash,args.p_snapshot,args.p_plan,args.p_not_after])).result,error:null};}catch(error){return{data:null,error:{message:error.message}};}}return dispatch(admin)(name,args);};
   try{const q=await service.previewCartSubmission(input,raw);f.request.confirmationHash=q.confirmationHash;await service.submitCartCheckout(input,raw);}finally{await admin.query('update faolla_checkout_design.intent_pilots set enabled=true where site_id=$1',[site]);}
   const x=await ordinary(f),before=await state();await assert.rejects(x.create(),/checkout_intent_review_required/);assert.deepEqual(await state(),before);
  });
  await t.test('a concurrent financial commit rejects the actual ordinary creator stale sequence without overwriting the new original',async()=>{
   const f=await seed(),x=await ordinary(f,{c:b});await a.query('begin');let result,waiting;
   try{result=await submit(f,a);waiting=x.create();waiting.catch(()=>{});let blocked=false;const until=Date.now()+2000;while(Date.now()<until){blocked=(await one(admin,"select wait_event='advisory' blocked from pg_stat_activity where pid=$1",[b.processID]))?.blocked;if(blocked)break;await new Promise(r=>setTimeout(r,10));}assert.equal(blocked,true);}finally{await a.query('commit');}
   const before=await state();await assert.rejects(waiting,/order_update_conflict/);assert.equal(x.mutation().orders.next[0].id,result.result.resourceId,'both actual creators allocated the same next sequence from the old snapshot');assert.deepEqual(await state(),before);assert.equal((await pending(f)).operationKey,result.result.operationKey);assert.deepEqual(x.stats(),{mirror:0,calls:1});
   const refreshed=await ordinary(f);await assert.rejects(refreshed.create(),/checkout_original_pending/);assert.deepEqual(await state(),before);
  });
  await t.test('actual legacy HTTP rejects another order using the verified session, not forged body identity',async()=>{
   const f=await seed();await submit(f);const before=await state(),x=await http(f);
   assert.equal(x.response.status,409);assert.equal((await x.response.json()).error,'checkout_original_pending');assert.equal(x.response.headers.get('cache-control'),'private, no-store');
   assert.equal(x.notifications,0);assert.deepEqual(x.stats(),{mirror:0,calls:1});assert.deepEqual(await state(),before);
  });
  await t.test('lost ordinary POST acknowledgement stays unknown; explicit same-request replay returns the one persisted order',async()=>{
   const f=await seed(),input=newInput(f),before=await state(),lost=await http(f,{input,lose:true});
   assert.equal(lost.response.status,503);const body=await lost.response.json();assert.equal(body.error,'checkout_create_unconfirmed');assert.ok(!JSON.stringify(body).includes('synthetic lost'));assert.equal(lost.notifications,0);assert.deepEqual(lost.stats(),{mirror:0,calls:1});
   const persisted=records(await rows()).filter(r=>r.clientRequestId===input.clientRequestId);assert.equal(persisted.length,1);
   const after=await state();for(const key of Object.keys(before).filter(k=>k!=='public.pages'))assert.deepEqual(after[key],before[key],key);
   const retry=await http(f,{input});assert.equal(retry.response.status,200);assert.equal((await retry.response.json()).order.id,persisted[0].id);assert.deepEqual(retry.stats(),{mirror:1,calls:0});assert.equal(retry.notifications,1);assert.deepEqual(await state(),after);
  });
  const mutation=async f=>({orders:{expectedRows:await rows(),next:[orders.createMerchantOrder(newInput(f),{id:`O-synthetic-${randomUUID()}`,createdAt:new Date().toISOString()}),...records(await rows())]}});
  await t.test('distinct ordinary ID waiting at the final private CAS sees a newly committed pending intent under READ COMMITTED',async()=>{
   const f=await seed(),m=await mutation(f);await a.query('begin');let waiting;
   try{await submit(f,a);waiting=one(b,'select public.faolla_checkout_legacy_order_commit_v1($1,$2,$3)',[site,m,new Date(Date.now()+11000).toISOString()]);waiting.catch(()=>{});
    let blocked=false;const until=Date.now()+2000;while(Date.now()<until){blocked=(await one(admin,"select wait_event='advisory' blocked from pg_stat_activity where pid=$1",[b.processID]))?.blocked;if(blocked)break;await new Promise(r=>setTimeout(r,10));}assert.equal(blocked,true);
   }finally{await a.query('commit');}
   const before=await state();await assert.rejects(waiting,/checkout_original_pending/);assert.deepEqual(await state(),before);
  });
  await t.test('late history side effects and history exceptions roll the entire ordinary CAS back',async()=>{
   for(const failure of ['deadline','history']){const f=await seed(),m=await mutation(f),before=await state();
    await admin.query(`create function public.synthetic_order_history_failure() returns trigger language plpgsql as $$begin if new.slug='__merchant_orders_history_v2__:${site}' then ${failure==='deadline'?'perform pg_sleep(0.65);':"raise exception 'synthetic_history_rejected';"} end if;return new;end;$$;
     create trigger synthetic_order_history_failure after insert or update on public.pages for each row execute function public.synthetic_order_history_failure();`);
    try{await assert.rejects(one(a,'select public.faolla_checkout_legacy_order_commit_v1($1,$2,$3)',[site,m,new Date(Date.now()+(failure==='deadline'?450:11000)).toISOString()]),failure==='deadline'?/checkout_intent_expired/:/synthetic_history_rejected/);assert.deepEqual(await state(),before);}
    finally{await admin.query('drop trigger synthetic_order_history_failure on public.pages;drop function public.synthetic_order_history_failure();');}
   }
  });
  await t.test('ordinary intent adapter retains original stale-store CAS and linked-cart financial change protections',async()=>{
   const f=await seed(),m=await mutation(f);m.orders.expectedRows=[];const before=await state();
   await assert.rejects(one(a,'select public.faolla_checkout_legacy_order_commit_v1($1,$2,$3)',[site,m,new Date(Date.now()+11000).toISOString()]),/order_update_conflict/);assert.deepEqual(await state(),before);
   const original=(await submit(f)).result,rs=await rows(),next=structuredClone(records(rs)),linked=next.find(r=>original.resourceId===r.id);assert.ok(linked);linked.totalAmount+=1;
   const pendingState=await state();await assert.rejects(one(a,'select public.faolla_checkout_legacy_order_commit_v1($1,$2,$3)',[site,{orders:{expectedRows:rs,next}},new Date(Date.now()+11000).toISOString()]),/checkout_change_requires_review/);assert.deepEqual(await state(),pendingState);
  });
  await t.test('closing the application intent gate cannot let the original order CAS create past a durable pending claim',async()=>{
   const f=await seed();await submit(f);const x=await ordinary(f,{intent:false}),before=await state();
   await assert.rejects(x.create(),/checkout_original_pending/);assert.equal(x.stats().calls,1);assert.equal(x.stats().mirror,0);assert.deepEqual(await state(),before);
  });
  await retainedOrderCases(t,{admin,a,seed,submit,state,site,one,rows,records,dispatch});
  await closedGateOrderCases(t,{admin,a,b,seed,submit,ack,state,site,one,rows,records,newInput,ordinary,http,mutation});
  await legacyBookingIntentCases(t,{admin,a,b,seed,submit,pending,ack,state,site,one,evidence});
  await t.test('all API roles and retained snapshots are denied and every old SQL definition remains byte-identical',async()=>{
   const before=await state();for(const role of ['anon','authenticated','service_role']){await a.query(`set role ${role}`);try{assert.equal((await one(a,"select has_function_privilege(current_user,'public.faolla_checkout_legacy_order_commit_v1(text,jsonb,text)','EXECUTE') allowed")).allowed,false);await assert.rejects(one(a,'select public.faolla_checkout_legacy_order_commit_v1($1,$2,$3)',[site,{},new Date(Date.now()+11000).toISOString()]),/permission denied/);}finally{await a.query('reset role');}}
   await a.query('begin isolation level repeatable read');try{await assert.rejects(one(a,'select public.faolla_checkout_legacy_order_commit_v1($1,$2,$3)',[site,{},new Date(Date.now()+11000).toISOString()]),/checkout_intent_unavailable/);}finally{await a.query('rollback');}
   assert.deepEqual(await state(),before);assert.deepEqual(await definitions(),beforeDefinitions);
  });
  console.log(`LEGACY_ORDER_INTENT_EVIDENCE=${evidence}`);
 }finally{
  await Promise.all(clients.map(c=>c.end().catch(()=>{})));if(started){const lines=(await readFile(path.join(cluster,'postmaster.pid'),'utf8')).split(/\r?\n/);assert.equal(path.resolve(lines[1]).toLowerCase(),path.resolve(cluster).toLowerCase());assert.equal(Number(lines[3]),port);await exec(binaries.pg_ctl,['-D',cluster,'-w','-t','30','stop','-m','fast'],{windowsHide:true,timeout:45000});}
  console.log(`LEGACY_ORDER_INTENT_CLUSTER_STOPPED=${evidence}`);
 }
});
