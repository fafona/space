// NEW owned Windows TEMP PostgreSQL ONLY. No .env, production URL, registry
// reservation, gateway credential or release entry. All data is synthetic.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,mkdtemp,writeFile,realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import net from 'node:net';
import {randomUUID} from 'node:crypto';
import {loadInstallationPlan} from './member-checkout-installation-plan.mjs';
import {loadCheckout047Revision} from './member-checkout-047-revision.mjs';
import {loadCheckout047Compatibility,readCheckout047Compatibility,inspectCheckout047Compatibility} from './member-checkout-047-compatibility.mjs';
import fixtures from './fixtures/member-checkout-cart-quote.ts';
import quote from '../src/lib/merchantCheckoutCartQuote.server.ts';
import planner from '../src/lib/merchantCheckoutCartSubmissionPlan.server.ts';

test('registered 047 plus a separate private new-checkout compatibility revision',{timeout:120000},async t=>{
 assert.equal(process.platform,'win32');
 for(const key of Object.keys(process.env))if(/SUPABASE|STRIPE|SMTP|DATABASE_URL|^PGHOST$|^PGPORT$|^PGPASSWORD$|^PGDATABASE$/.test(key))
  assert.ok(!process.env[key],'configured_backend_environment_refused:'+key);
 const runtime=path.resolve(process.env.FAOLLA_BOOKING_TEST_RUNTIME_DIR||'.missing-test-runtime'),relative=path.relative(tmpdir(),runtime);
 assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(runtime).startsWith('faolla-booking-pg-'));
 assert.equal((await realpath(runtime)).toLowerCase(),runtime.toLowerCase());
 const pgRoot=path.join(runtime,'node_modules/@embedded-postgres/windows-x64');
 assert.equal(JSON.parse(await readFile(path.join(pgRoot,'package.json'),'utf8')).version,'17.10.0-beta.17');
 assert.equal(JSON.parse(await readFile(path.join(runtime,'node_modules/pg/package.json'),'utf8')).version,'8.23.1');
 const {Client}=createRequire(path.join(runtime,'test-loader.cjs'))('pg');
 const binaries=await import(pathToFileURL(path.join(pgRoot,'dist/index.js')).href),exec=promisify(execFile);
 const evidence=await mkdtemp(path.join(tmpdir(),'faolla-checkout-047-test-')),cluster=path.join(evidence,'cluster');
 const reserved=net.createServer();await new Promise((resolve,reject)=>{reserved.once('error',reject);reserved.listen(0,'127.0.0.1',resolve);});
 const port=reserved.address().port;await new Promise(resolve=>reserved.close(resolve));
 const report={version:1,scope:'owned-local-pg17-047-revision-not-production-or-real-auth',checks:[],passed:false,cleanupPassed:false,failure:null,
  forbiddenFetches:0,productionMutations:false,productionAuthorized:false,deploymentReady:false};
 const savedFetch=globalThis.fetch;globalThis.fetch=async()=>{report.forbiddenFetches++;throw Error('owned_047_external_fetch_refused');};
 const clients=[];let started=false,admin;
 const one=async(sql,args=[])=>(await admin.query(sql,args)).rows[0];
 const check=async(name,run)=>{let ok=false;await t.test(name,async()=>{await admin.query('BEGIN');try{await run();ok=true;report.checks.push({name,passed:true});}
  catch(error){report.checks.push({name,passed:false});throw error;}finally{await admin.query('ROLLBACK');}});assert.equal(ok,true,'047_required_check_failed');};
 const scoped=async(role,sql,args=[])=>{
  assert.ok(['faolla_checkout_runtime','faolla_checkout_executor','service_role','anon','authenticated'].includes(role));
  await admin.query('SAVEPOINT scoped_call');
  try{await admin.query(`SET LOCAL SESSION AUTHORIZATION ${role}`);
   assert.deepEqual(await one('select current_user::text actor,session_user::text session'),{actor:role,session:role});
   const result=await admin.query(sql,args);await admin.query('SET LOCAL SESSION AUTHORIZATION DEFAULT');await admin.query('RELEASE SAVEPOINT scoped_call');return result;
  }catch(error){await admin.query('ROLLBACK TO SAVEPOINT scoped_call');await admin.query('RELEASE SAVEPOINT scoped_call');throw error;}
 };
 const call=async(name,args)=>(await scoped('faolla_checkout_runtime','select public.faolla_checkout_runtime_v1($1,$2::jsonb) result',[name,JSON.stringify(args)])).rows[0].result;
 const state=async()=>{
  const result={};for(const row of (await admin.query("select schemaname,tablename from pg_tables where schemaname in ('public','faolla_checkout_design') order by schemaname,tablename")).rows){
   assert.match(row.tablename,/^[a-z0-9_]+$/);result[row.schemaname+'.'+row.tablename]=(await admin.query(`select to_jsonb(t) row from ${row.schemaname}.${row.tablename} t order by to_jsonb(t)::text`)).rows;
  }return result;
 };
 const atomicFailure=async(run,match)=>{
  const before=await state();await admin.query('SAVEPOINT expected_failure');
  try{await assert.rejects(async()=>{await run();await admin.query('SET CONSTRAINTS ALL IMMEDIATE');},match);}
  finally{await admin.query('ROLLBACK TO SAVEPOINT expected_failure');await admin.query('RELEASE SAVEPOINT expected_failure');}
  assert.deepEqual(await state(),before);
 };
 try{
  await exec(binaries.initdb,['-D',cluster,'-U','checkout_047_admin','-A','trust','--encoding=UTF8','--locale=C'],{windowsHide:true,timeout:60000});
  await exec(binaries.pg_ctl,['-D',cluster,'-l',path.join(evidence,'postgres.log'),'-w','-t','30','-o',`-h 127.0.0.1 -p ${port} -c shared_buffers=16MB -c max_connections=12`,'start'],{windowsHide:true,timeout:45000});started=true;
  admin=new Client({host:'127.0.0.1',port,user:'checkout_047_admin',database:'postgres',password:'',ssl:false,connectionTimeoutMillis:5000,
   statement_timeout:15000,query_timeout:20000,application_name:'owned-checkout-047-only'});await admin.connect();clients.push(admin);
  assert.equal(path.resolve((await one('SHOW data_directory')).data_directory).toLowerCase(),path.resolve(cluster).toLowerCase());
  await admin.query(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
   create table public.pages(id uuid primary key default gen_random_uuid(),merchant_id text,slug text,blocks jsonb,updated_at timestamptz default clock_timestamp());
   create table public.faolla_schema_migrations(version bigint primary key,name text not null);
   grant usage on schema public to anon,authenticated,service_role;grant select,insert,update,delete on public.pages to service_role;
   create function public.set_pages_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end;$$;
   create trigger set_pages_updated_at before update on public.pages for each row execute function public.set_pages_updated_at();`);
  await admin.query('insert into public.pages(merchant_id,slug,blocks) values($1,$2,$3)',
   ['__faolla_booking_persistence__','__merchant_booking_records__:v1',{version:1,records:[]}]);
  const plan=await loadInstallationPlan(),revision=await loadCheckout047Revision();report.revision=revision.material;report.revisionSha256=revision.sha256;
  for(const source of plan.originals){await admin.query(source.source);if(source.file.includes('202609080046_'))await admin.query(revision.legacySql);}
  const legacy=()=>admin.query(`select p.oid::text oid,p.oid::regprocedure::text signature,
   encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') definition,p.proacl::text acl
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and p.proname like 'faolla_%'
    and p.proname!~'^faolla_(member_checkout_|checkout_)' order by p.oid`).then(value=>value.rows);
  const beforeLegacy=await legacy();
  for(const step of plan.steps)await admin.query('BEGIN;'+step.body+'COMMIT;');
  // Runtime adds EXECUTE on the ordinary v1 wrapper, not the 047 internal writer.
  const runtimeLegacy=await legacy();
  const definitions=rows=>rows.map(row=>({oid:row.oid,signature:row.signature,definition:row.definition}));
  assert.deepEqual(definitions(runtimeLegacy),definitions(beforeLegacy));
  await admin.query(revision.adapterSql);for(const patch of revision.patches)await admin.query(patch.sql);
  assert.deepEqual(await legacy(),runtimeLegacy,'new adapter never edits an old function or its ACL');
  const site='10909994',memberSlug='__merchant_memberships__:'+site,settingsSlug='__merchant_membership_settings__:'+site,couponSlug='__merchant_coupons__:'+site;
  await check('independent 047 metadata covers all legacy functions/defaults and the private runtime/audit boundary',async()=>{
   const contract=await loadCheckout047Compatibility(),metadata=await readCheckout047Compatibility((sql,args)=>admin.query(sql,args),contract);
   const result=inspectCheckout047Compatibility(contract,metadata.catalog,metadata.legacyDetails);assert.deepEqual(result.issues,[]);
   assert.equal(result.protocolObjectsMatch,true);assert.equal(result.deploymentReady,false);
  });
  const page=async slug=>(await one('select *,to_jsonb(updated_at) stamp from public.pages where slug=$1',[slug]));
  const seed=async(method='points',change=()=>{})=>{
   const f=fixtures.cartQuoteFixture(method,2);change(f);
   for(const row of [...f.snapshot.sourceRows,...f.snapshot.domainRows])await admin.query('insert into public.pages(id,merchant_id,slug,blocks) values($1,$2,$3,$4)',[row.id,row.merchant_id,row.slug,JSON.stringify(row.blocks)]);
   for(const table of ['bundle_pilots','intent_pilots','cart_quote_pilots','cart_submission_pilots'])
    await admin.query(`insert into faolla_checkout_design.${table}(site_id,enabled) values($1,true)`,[site]);
   let version=(await one('select public.faolla_member_checkout_catalog_snapshot_v1($1) result',[site])).result.version;
   for(const offer of f.offers){const next=randomUUID();await admin.query('select public.faolla_member_checkout_catalog_save_v1($1,$2,$3,$4,$5)',[site,version,next,'owner:synthetic-owner',offer]);version=next;}
   f.refresh();f.request={...f.request,nonce:randomUUID(),confirmationHash:'0'.repeat(64),customer:{name:'Synthetic',title:'Mx',email:'synthetic@example.invalid',phone:'000',note:''}};
   return f;
  };
  const prepare=async f=>{
   const read=async()=>{const id=planner.cartSubmissionIdentity(f.request,f.principal),qid=planner.cartSelectionIdentity(id,f.principal);
    return(await call('faolla_member_checkout_cart_submission_snapshot_v1',{p_site_id:site,p_operation_key:id.operationKey,p_principal_key:id.principalKey,
     p_request_hash:id.requestHash,p_quote_request_hash:qid.requestHash,p_offer_ids:qid.request.lines.map(line=>line.offerId)})).snapshot;};
   let id=planner.cartSubmissionIdentity(f.request,f.principal),snapshot=await read();
   const q=await quote.quoteCheckoutCartSnapshot(snapshot.quoteSnapshot,planner.cartSelectionIdentity(id,f.principal),f.principal);
   f.request.confirmationHash=planner.cartConfirmationHash(q,f.principal);id=planner.cartSubmissionIdentity(f.request,f.principal);snapshot=await read();
   return {id,...await planner.planCartSubmission(snapshot,id,f.principal)};
  };
  const commit=p=>call('faolla_member_checkout_cart_commit_v1',{p_site_id:site,p_operation_key:p.id.operationKey,p_principal_key:p.id.principalKey,p_request_hash:p.id.requestHash,p_snapshot:p.snapshot,p_plan:p.plan,p_not_after:p.notAfter});
  const read=p=>call('faolla_member_checkout_cart_result_v1',{p_site_id:site,p_operation_key:p.id.operationKey,p_principal_key:p.id.principalKey});
  const cancel=async p=>{const r=await read(p);return call('faolla_member_checkout_cart_cancel_v1',{p_site_id:site,p_operation_key:p.id.operationKey,p_principal_key:p.id.principalKey,
   p_expected_updated_at:r.resource.updatedAt,p_not_after:new Date(Date.now()+12000).toISOString()});};
  const oldCashier=async(f,chosenId)=>{
   const memberPage=await page(memberSlug),settingsPage=await page(settingsSlug),id=chosenId??'legacy-047:'+randomUUID(),operator='owner:synthetic-cashier',stamp=new Date().toISOString();
   const quote={totalQuantity:1,grossPoints:100,totalPoints:100,couponPointDiscountTotal:0,couponCount:0,
    lines:[{code:'S0',name:'Synthetic stock',categoryName:'',quantity:1,unitPoints:100,subtotalPoints:100,couponDiscountLabel:'',couponPointDiscount:0}]};
   const operation={id,membershipId:f.member.id,fingerprint:'b'.repeat(64)},request={membershipId:f.member.id,items:[{redemptionItemId:'stock-0',quantity:1}],
    note:'Synthetic legacy cashier',settingsVersion:settingsPage.stamp,couponVersion:null,quote};
   const nextMembers=structuredClone(memberPage.blocks),nextSettings=structuredClone(settingsPage.blocks),tx=randomUUID();
   nextMembers[0].pointBalance-=100;nextMembers[0].transactions.push({id:tx,type:'redeem',status:'completed',at:stamp,pointDelta:-100,balanceDelta:0,growthDelta:0,
    note:request.note+' [op:member-redemption-checkout:'+id+']',operatorId:operator,cancelledAt:null,cancellationNote:'',cancelledBy:'',cancellationOperationMarker:'',relatedTransactionId:'',adjustmentKind:''});
   nextSettings.redemptionItems[0].stock--;nextSettings.redemptionStockOperationIds.push('[op:member-redemption-stock:'+id+']');
   const mutation={operation,settings:{expectedUpdatedAt:settingsPage.stamp,next:nextSettings},memberships:{expectedUpdatedAt:memberPage.stamp,next:nextMembers}};
   const result={version:1,operationId:id,siteId:site,membershipId:f.member.id,createdAt:stamp,transactionId:tx,
    beforePointBalance:memberPage.blocks[0].pointBalance,afterPointBalance:nextMembers[0].pointBalance,...quote,note:request.note};
   const rpc=async(action,args)=>(await scoped('service_role',action,args)).rows[0];
   return {id,operator,request,stage:()=>rpc('select public.faolla_stage_redemption_checkout_v1($1,$2,$3,$4) result',[site,operator,operation,request]),
    commit:()=>rpc('select public.faolla_commit_redemption_v2($1,$2,$3,$4) result',[site,operator,mutation,result]),
    get:()=>rpc('select public.faolla_get_redemption_checkout_v1($1,$2,$3) result',[site,operator,id]),
    cancel:()=>rpc('select public.faolla_cancel_redemption_checkout_v1($1,$2,$3) result',[site,operator,id]),
    ack:()=>rpc('select public.faolla_ack_redemption_checkout_v1($1,$2,$3) result',[site,operator,id])};
  };
  await check('six exact legacy prerequisites, all rollout gates closed, no grants to the internal writer',async()=>{
   assert.equal((await one('select count(*)::int n from public.faolla_schema_migrations')).n,6);
   for(const table of plan.expected.tables.filter(table=>table.endsWith('_pilots')))assert.equal((await one('select count(*)::int n from '+table+' where enabled')).n,0);
   for(const role of ['anon','authenticated','service_role','faolla_checkout_runtime','faolla_checkout_executor'])
    assert.equal((await one("select has_function_privilege($1,'public.faolla_commit_redemption_internal_v1(text,jsonb)','EXECUTE') allowed",[role])).allowed,false);
   assert.equal((await one("select pg_has_role('faolla_checkout_runtime','faolla_checkout_executor','MEMBER') allowed")).allowed,false);
  });
  await check('API roles and runtime cannot call the bridge, audit or internal writer directly',async()=>{
   for(const role of ['anon','authenticated','service_role','faolla_checkout_runtime']){
    await atomicFailure(()=>scoped(role,"select faolla_checkout_design.commit_redemption_047('10909994',$1,$2,'payment','{}')",['a'.repeat(64),'account:50010105:cart-synthetic-only']),e=>e.code==='42501');
    await atomicFailure(()=>scoped(role,'select * from faolla_checkout_design.redemption_047_audits'),e=>e.code==='42501');
   }
   await atomicFailure(()=>call('commit_redemption_047',{}),/checkout_runtime_forbidden/);
  });
  await check('whole cart points, coupon and stock commit and replay through the actual restricted dispatcher',async()=>{
   const f=await seed('points',x=>{x.request.lines[0].couponClaims=[{couponId:x.coupons[0].id,claimEventId:x.coupons[0].claimEvents[0].id}];});
   const p=await prepare(f),r=await commit(p);await admin.query('SET CONSTRAINTS ALL IMMEDIATE');
   assert.equal(r.result.totalPoints,180);assert.equal((await page(memberSlug)).blocks[0].pointBalance,820);
   assert.equal((await page(settingsSlug)).blocks.redemptionItems[0].stock,4);assert.equal((await page(couponSlug)).blocks[0].usedCount,1);
   assert.equal((await one('select count(*)::int n from faolla_checkout_design.redemption_047_audits')).n,1);
   const before=await state();assert.equal((await commit(p)).replayed,true);assert.deepEqual(await state(),before);
   assert.equal((await one('select count(*)::int n from public.faolla_redemption_checkouts')).n,0);
  });
  await check('original cancellation returns points, coupon and stock once, without extending the original coupon',async()=>{
   const f=await seed('points',x=>{x.request.lines[0].couponClaims=[{couponId:x.coupons[0].id,claimEventId:x.coupons[0].claimEvents[0].id}];});
   const p=await prepare(f),claims=(await page(couponSlug)).blocks[0].claimEvents;await commit(p);
   await admin.query('update faolla_checkout_design.bundle_pilots set enabled=false where site_id=$1',[site]);
   await admin.query('update faolla_checkout_design.cart_submission_pilots set enabled=false where site_id=$1',[site]);
   await cancel(p);await admin.query('SET CONSTRAINTS ALL IMMEDIATE');
   assert.equal((await page(memberSlug)).blocks[0].pointBalance,1000);assert.equal((await page(settingsSlug)).blocks.redemptionItems[0].stock,5);
   assert.deepEqual((await page(couponSlug)).blocks[0].claimEvents,claims);assert.equal((await page(couponSlug)).blocks[0].usedCount,0);
   assert.deepEqual((await admin.query('select phase,points::int points from faolla_checkout_design.redemption_047_audits order by phase')).rows,[{phase:'payment',points:180},{phase:'return',points:180}]);
   const before=await state();assert.equal((await cancel(p)).replayed,true);assert.deepEqual(await state(),before);
  });
  await check('merchant no-return policy retains original points/coupon while releasing stock',async()=>{
   const f=await seed('points',x=>{x.request.lines[0].couponClaims=[{couponId:x.coupons[0].id,claimEventId:x.coupons[0].claimEvents[0].id}];for(const offer of x.offers){offer.couponReturnOnCancel=false;offer.checkoutBinding.pointsReturnOnCancel=false;}});
   const p=await prepare(f);await commit(p);await cancel(p);await admin.query('SET CONSTRAINTS ALL IMMEDIATE');
   assert.equal((await page(memberSlug)).blocks[0].pointBalance,820);assert.equal((await page(couponSlug)).blocks[0].usedCount,1);
   assert.equal((await page(settingsSlug)).blocks.redemptionItems[0].stock,5);assert.equal((await one('select count(*)::int n from faolla_checkout_design.redemption_047_audits')).n,1);
  });
  await check('a full coupon exchange deducts zero points and returns only the original coupons once',async()=>{
   const f=await seed('points',x=>{for(let i=0;i<x.coupons.length;i++){x.coupons[i].discountValue=100;
    x.request.lines[i].couponClaims=[{couponId:x.coupons[i].id,claimEventId:x.coupons[i].claimEvents[0].id}];}});
   const p=await prepare(f);assert.equal((await commit(p)).result.totalPoints,0);assert.equal((await page(memberSlug)).blocks[0].pointBalance,1000);
   assert.equal((await page(memberSlug)).blocks[0].transactions.length,0);assert.deepEqual((await page(couponSlug)).blocks.map(c=>c.usedCount),[1,1]);
   await cancel(p);await admin.query('SET CONSTRAINTS ALL IMMEDIATE');assert.deepEqual((await page(couponSlug)).blocks.map(c=>c.usedCount),[0,0]);
   assert.equal((await page(memberSlug)).blocks[0].pointBalance,1000);assert.equal((await one('select count(*)::int n from faolla_checkout_design.redemption_047_audits')).n,1);
   const before=await state();assert.equal((await cancel(p)).replayed,true);assert.deepEqual(await state(),before);
  });
  await check('on-site cart retains the ordinary 047 stock/coupon path and never creates a financial bridge audit',async()=>{
   const f=await seed('on_site',x=>{x.request.lines[0].couponClaims=[{couponId:x.coupons[0].id,claimEventId:x.coupons[0].claimEvents[0].id}];});
   const before=(await page(memberSlug)).blocks,p=await prepare(f);const r=await commit(p);assert.equal(r.result.dueMinor,2300);
   await cancel(p);await admin.query('SET CONSTRAINTS ALL IMMEDIATE');assert.deepEqual((await page(memberSlug)).blocks,before);
   assert.equal((await one('select count(*)::int n from faolla_checkout_design.redemption_047_audits')).n,0);
  });
  for(const kind of ['booking','order'])await check('private single '+kind+' points composition and original return use the separate bridge',async()=>{
   const f=await seed(),p=await prepare(f),settingsPage=await page(settingsSlug),memberPage=await page(memberSlug),stamp=new Date().toISOString();
   const offer={version:1,siteId:site,id:randomUUID(),revision:randomUUID(),enabled:true,source:{kind,timeZone:'Europe/Madrid'},couponReturnOnCancel:true,
    checkoutBinding:{pointsReturnOnCancel:true,cancellationAdvanceMinutes:60}};
   await admin.query('insert into faolla_checkout_design.offer_versions(site_id,offer_id,revision,source_kind,source_key,snapshot) values($1,$2,$3,$4,$5,$6)',[site,offer.id,offer.revision,kind,'synthetic-047-'+kind,offer]);
   await admin.query('insert into faolla_checkout_design.offer_heads(site_id,offer_id,revision,enabled) values($1,$2,$3,true)',[site,offer.id,offer.revision]);
   const id='synthetic-'+randomUUID(),record=kind==='order'?{...p.plan.record,id,checkoutOperationKey:p.id.operationKey}:
    {id,siteId:site,customerAccountId:f.principal.accountId,customerUserId:f.principal.userId,createdAt:stamp,updatedAt:stamp,status:'active',
     appointmentAt:'2030-02-01T12:00',appointmentTimeZone:'Europe/Madrid',editToken:randomUUID(),store:'Synthetic',item:'Play',title:'Mx',customerName:'Synthetic',email:'synthetic@example.invalid',phone:'000',note:'',bookingBlockId:'synthetic-047',bookingViewport:'desktop'};
   const input={settingsVersion:settingsPage.stamp,membership:{...p.plan.membership,expectedUpdatedAt:memberPage.stamp},
    receipt:{version:1,resourceKind:kind,resourceId:id,totalPoints:200,couponCount:0},offer:{id:offer.id,revision:offer.revision},
    stock:{expectedUpdatedAt:settingsPage.stamp,deltas:[{itemId:'stock-0',quantity:1}]}};
   if(kind==='booking'){await admin.query('update public.faolla_booking_atomic_control set active=true where singleton');
    const control=await one('select generation::text generation,revision::text revision from public.faolla_booking_atomic_control where singleton');input.booking={...control,record,mailJobs:[]};
   }else input.order={expectedVersions:[],record};
   const commitSingle=()=>scoped('faolla_checkout_executor','select faolla_checkout_design.commit_bundle($1,$2,$3,$4,$5) result',[site,p.id.operationKey,p.id.principalKey,p.id.requestHash,input]);
   assert.equal((await commitSingle()).rows[0].result.replayed,false);assert.equal((await page(memberSlug)).blocks[0].pointBalance,800);
   const before=await state();assert.equal((await commitSingle()).rows[0].result.replayed,true);assert.deepEqual(await state(),before);
   await call('faolla_member_checkout_cancel_v2',{p_site_id:site,p_operation_key:p.id.operationKey,p_principal_key:p.id.principalKey,p_expected_updated_at:record.updatedAt});
   await admin.query('SET CONSTRAINTS ALL IMMEDIATE');assert.equal((await page(memberSlug)).blocks[0].pointBalance,1000);
   assert.equal((await page(settingsSlug)).blocks.redemptionItems[0].stock,5);
   assert.deepEqual((await admin.query('select phase,points::int points from faolla_checkout_design.redemption_047_audits order by phase')).rows,[{phase:'payment',points:200},{phase:'return',points:200}]);
  });
  await check('original cashier stage/commit/replay/get/ack stays operational without creating new bridge rows',async()=>{
   const f=await seed(),old=await oldCashier(f);assert.equal((await old.stage()).result.checkout.status,'pending');
   assert.equal((await old.commit()).result.replayed,false);assert.equal((await page(memberSlug)).blocks[0].pointBalance,900);
   const before=await state();assert.equal((await old.commit()).result.replayed,true);assert.deepEqual(await state(),before);
   assert.equal((await old.get()).result.checkout.status,'committed');await old.ack();await admin.query('SET CONSTRAINTS ALL IMMEDIATE');
   assert.ok((await old.get()).result.checkout.acknowledgedAt);assert.equal((await one('select count(*)::int n from faolla_checkout_design.redemption_047_audits')).n,0);
  });
  await check('a staged old cashier is not stolen or acknowledged by a new checkout; stale commit remains rejected',async()=>{
   const f=await seed(),old=await oldCashier(f);await old.stage();
   const context=await one('select to_jsonb(t) value from public.faolla_redemption_checkouts t where merchant_id=$1 and operation_id=$2',[site,old.id]);
   await commit(await prepare(f));assert.deepEqual(await one('select to_jsonb(t) value from public.faolla_redemption_checkouts t where merchant_id=$1 and operation_id=$2',[site,old.id]),context);
   await atomicFailure(()=>old.commit(),/merchant_memberships_conflict|redemption_checkout_quote_changed|merchant_membership_settings_conflict/);
   assert.equal((await old.cancel()).result.checkout.status,'cancelled');await old.ack();await admin.query('SET CONSTRAINTS ALL IMMEDIATE');
   assert.equal((await page(memberSlug)).blocks[0].pointBalance,800);assert.ok((await old.get()).result.checkout.acknowledgedAt);
  });
  await check('a colliding old cashier operation ID cannot be consumed by the new financial bridge',async()=>{
   const f=await seed(),p=await prepare(f),old=await oldCashier(f,'self-checkout:'+p.id.operationKey);await old.stage();
   await atomicFailure(()=>commit(p),/checkout_047_context_required/);
   assert.equal((await old.get()).result.checkout.status,'pending');assert.equal((await page(memberSlug)).blocks[0].pointBalance,1000);
  });
  await check('a late ledger rejection rolls every member/coupon/stock/history/bridge write back',async()=>{
   const f=await seed('points',x=>{x.request.lines[0].couponClaims=[{couponId:x.coupons[0].id,claimEventId:x.coupons[0].claimEvents[0].id}];}),p=await prepare(f);
   await admin.query("create function public.test_047_fail() returns trigger language plpgsql as $$begin raise exception 'owned_047_late_failure';end;$$;create trigger test_047_fail before insert on faolla_checkout_design.bundle_results for each row execute function public.test_047_fail()");
   await atomicFailure(()=>commit(p),/owned_047_late_failure/);
  });
  await check('a mismatched final original fingerprint is rejected by deferred evidence and rolls back all writes',async()=>{
   const f=await seed(),p=await prepare(f);
   await admin.query("create function public.test_047_wrong_hash() returns trigger language plpgsql as $$begin new.request_hash:=repeat('c',64);return new;end;$$;create trigger test_047_wrong_hash before insert on faolla_checkout_design.bundle_results for each row execute function public.test_047_wrong_hash()");
   await atomicFailure(()=>commit(p),/checkout_047_context_required/);
  });
  await check('the new audit cannot be updated/deleted and executor cannot forge one directly',async()=>{
   const p=await prepare(await seed());await commit(p);await admin.query('SET CONSTRAINTS ALL IMMEDIATE');
   await atomicFailure(()=>admin.query('update faolla_checkout_design.redemption_047_audits set points=0'),/checkout_history_immutable/);
   await atomicFailure(()=>admin.query('delete from faolla_checkout_design.redemption_047_audits'),/checkout_history_immutable/);
   await atomicFailure(()=>scoped('faolla_checkout_executor',"insert into faolla_checkout_design.redemption_047_audits values('10909994',$1,'return',$2,'private-cart-member',null,200,$1)",[p.id.operationKey,p.id.principalKey]),e=>e.code==='42501');
  });
  await check('the deferred bridge refuses a standalone financial call without a matching new original',async()=>{
   const f=await seed(),p=await prepare(f),memberPage=await page(memberSlug),settingsPage=await page(settingsSlug);
   const next=structuredClone(memberPage.blocks);next[0].pointBalance-=100;next[0].transactions.push({id:randomUUID(),type:'redeem',status:'completed',at:new Date().toISOString(),pointDelta:-100,balanceDelta:0,growthDelta:0,note:'Synthetic',operatorId:'customer:'+f.principal.accountId});
   const mutation={operation:{id:'self-checkout:'+p.id.operationKey,fingerprint:p.id.requestHash,membershipId:f.member.id},
    settings:{expectedUpdatedAt:settingsPage.stamp,next:settingsPage.blocks},memberships:{expectedUpdatedAt:memberPage.stamp,next}};
   let writerReached=false;
   await atomicFailure(async()=>{await scoped('faolla_checkout_executor','select faolla_checkout_design.commit_redemption_047($1,$2,$3,$4,$5)',[site,p.id.operationKey,p.id.principalKey,'payment',mutation]);writerReached=true;},
    e=>e.message==='checkout_047_context_required'||e.code==='23503'&&e.constraint==='redemption_047_audits_site_id_operation_key_fkey');
   assert.equal(writerReached,true,'refusal must be the deferred original proof, not an earlier malformed fixture');
  });
  await check('old v1 still refuses financial envelopes; all old definitions/ACL and frozen sources remain unchanged',async()=>{
   await atomicFailure(()=>scoped('service_role',"select public.faolla_commit_redemption_v1('10909994',$1)",[{operation:{},settings:{},memberships:{next:[]}}]),/redemption_checkout_context_required/);
   assert.deepEqual(await legacy(),runtimeLegacy);assert.equal((await loadCheckout047Revision()).sha256,revision.sha256);
  });
  let committedOk=false;
  await t.test('physically committed original and cancellation replay on fresh connections without another debit or refund',async()=>{
   const reconnect=async()=>{
    await admin.end();const previous=admin;clients.splice(clients.indexOf(previous),1);
    admin=new Client({host:'127.0.0.1',port,user:'checkout_047_admin',database:'postgres',password:'',ssl:false,connectionTimeoutMillis:5000,
     statement_timeout:15000,query_timeout:20000,application_name:'owned-checkout-047-recovery'});await admin.connect();clients.push(admin);
    assert.equal(path.resolve((await one('SHOW data_directory')).data_directory).toLowerCase(),path.resolve(cluster).toLowerCase());
   };
   try{
    await admin.query('BEGIN');const f=await seed('points',x=>{x.request.lines[0].couponClaims=[{couponId:x.coupons[0].id,claimEventId:x.coupons[0].claimEvents[0].id}];});
    const p=await prepare(f);await commit(p);await admin.query('COMMIT');const committed=await state();
    // Discard the application result, NOT an emulated TCP/power-loss claim.
    await reconnect();await admin.query('BEGIN');assert.equal((await read(p)).totalPoints,180);assert.equal((await commit(p)).replayed,true);await admin.query('COMMIT');
    assert.deepEqual(await state(),committed);await admin.query('BEGIN');await cancel(p);await admin.query('COMMIT');const returned=await state();
    await reconnect();await admin.query('BEGIN');assert.equal((await cancel(p)).replayed,true);await admin.query('COMMIT');assert.deepEqual(await state(),returned);
    assert.equal((await page(memberSlug)).blocks[0].pointBalance,1000);assert.equal((await one('select count(*)::int n from faolla_checkout_design.redemption_047_audits')).n,2);
    committedOk=true;report.checks.push({name:'physically committed original and cancellation replay on fresh connections',passed:true});
   }catch(error){report.checks.push({name:'physically committed original and cancellation replay on fresh connections',passed:false});throw error;}
   finally{await admin.query('ROLLBACK');}
  });
  assert.equal(committedOk,true,'047_committed_recovery_required');
  assert.equal(report.forbiddenFetches,0);report.passed=true;
 }catch(error){report.failure={name:error.name,code:/^[A-Z0-9_]{1,40}$/.test(error.code??'')?error.code:null,message:'owned_047_acceptance_failed'};throw error;}
 finally{
  await Promise.all(clients.map(client=>client.end().catch(()=>{})));
  if(started){const pid=(await readFile(path.join(cluster,'postmaster.pid'),'utf8')).split(/\r?\n/);
   assert.equal(path.resolve(pid[1]).toLowerCase(),path.resolve(cluster).toLowerCase());assert.equal(Number(pid[3]),port);
   await exec(binaries.pg_ctl,['-D',cluster,'-w','-t','30','-m','fast','stop'],{windowsHide:true,timeout:45000});report.cleanupPassed=true;}
  await writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  globalThis.fetch=savedFetch;
  console.log('CHECKOUT_047_EVIDENCE='+evidence);console.log('CHECKOUT_047_OWNED_CLUSTER_STOPPED='+String(report.cleanupPassed));
 }
});
