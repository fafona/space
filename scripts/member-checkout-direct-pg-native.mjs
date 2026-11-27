// Owned disposable databases only. No .env, application switch or installer.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {loadInstallationPlan} from './member-checkout-installation-plan.mjs';
import {loadCheckout047Revision} from './member-checkout-047-revision.mjs';
import {runtimeEntry,executorRole} from './member-checkout-runtime-contract.mjs';
import {createDirectPgProbe} from './member-checkout-direct-pg-probe.mjs';
import fixtures from './fixtures/member-checkout-cart-quote.ts';
import quote from '../src/lib/merchantCheckoutCartQuote.server.ts';
import planner from '../src/lib/merchantCheckoutCartSubmissionPlan.server.ts';
import bookingPlanner from '../src/lib/merchantCheckoutSubmissionPlan.server.ts';
import {createOwnedCheckoutData} from './fixtures/member-checkout-real-auth-database.mjs';

const port=56463,base='faolla_member_checkout_auth_test',login='checkout_direct_probe_login';
const exec=promisify(execFile),sha=s=>createHash('sha256').update(s).digest('hex');
const branch='refs/heads/acceptance/member-checkout-direct-pg-20261127';
function isolatedEnvironment(){
 for(const key of Object.keys(process.env))if(/SUPABASE|STRIPE|SMTP|DATABASE_URL|^PGHOST$|^PGPORT$|^PGPASSWORD$|^PGDATABASE$|^PGUSER$/.test(key))assert.ok(!process.env[key],'backend_environment_refused');
 const hosted=process.platform==='linux';
 if(hosted){assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');assert.equal(process.env.GITHUB_REF,branch);assert.equal(process.env.GITHUB_REPOSITORY,'fafona/space');assert.ok(process.getuid()>0);}
 else{assert.equal(process.platform,'win32');assert.equal(process.env.FAOLLA_CHECKOUT_DIRECT_PG_LOCAL,'1');}
 return hosted;
}
test('owned native direct-LOGIN transport, fixed original financial SQL and recovery',{timeout:180000},async t=>{
 const hosted=isolatedEnvironment(),runtime=hosted?path.join(process.env.RUNNER_TEMP,'checkout-direct-pg-tools'):path.resolve(process.env.FAOLLA_CHECKOUT_DIRECT_PG_TEST_RUNTIME||'.missing-test-runtime');
 if(!hosted){const rel=path.relative(fs.realpathSync(tmpdir()),runtime);assert.ok(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel)&&path.basename(runtime).startsWith('faolla-booking-pg-'));assert.equal(fs.realpathSync(runtime).toLowerCase(),runtime.toLowerCase());}
 assert.equal(JSON.parse(fs.readFileSync(path.join(runtime,'node_modules/pg/package.json'),'utf8')).version,'8.23.1');
 const {Client}=createRequire(path.join(runtime,'package.json'))('pg');
 const parent=hosted?path.join(process.env.RUNNER_TEMP,'checkout-direct-pg-evidence'):fs.mkdtempSync(path.join(tmpdir(),'faolla-checkout-direct-pg-'));
 if(hosted)fs.mkdirSync(parent,{mode:0o700});
 const report={version:1,scope:'owned-native-direct-pg-not-production',commit:process.env.GITHUB_SHA??null,checks:[],passed:false,cleanupPassed:false,
  productionConnected:false,productionChanged:false,productionAuthorized:false,newApplicationTransportInstalled:false,tlsValidated:false,hostRootIsolationProven:false,
  endUserAuthenticationValidated:false,wholeApplicationAcceptanceRepeated:false,stripeEnabled:false,failure:null};
 let pg,started=false,admin;const openClients=new Set(),databases=[],loginPassword=randomBytes(32).toString('base64url'),adminPassword=hosted?'disposable-direct-pg-ci-only':randomBytes(32).toString('base64url');
 const config=(database,user,password,extra={})=>({host:'127.0.0.1',port,database,user,password,ssl:false,options:'',client_encoding:'UTF8',
  connectionTimeoutMillis:3000,query_timeout:15000,statement_timeout:11000,lock_timeout:1000,idle_in_transaction_session_timeout:15000,
  application_name:'checkout-direct-pg-owned-probe',...extra});
 const client=(database=base,user='checkout_ci_admin',password=adminPassword,extra={})=>{
  isolatedEnvironment();assert.ok(database===base||databases.includes(database));
  const c=new Client(config(database,user,password,extra));c.on('error',()=>{});openClients.add(c);const oldEnd=c.end.bind(c);
  c.end=async()=>{await oldEnd();openClients.delete(c);};return c;
 };
 const connect=async(...args)=>{const c=client(...args);await c.connect();return c;};
 const one=async(db,sql,args=[])=>(await db.query(sql,args)).rows[0];
 const check=async(name,run)=>{let passed=false;await t.test(name,async()=>{await run();passed=true;});report.checks.push({name,passed});assert.equal(passed,true,'direct_pg_prerequisite_failed');};
 const probe=(database=base,options={},wrap=c=>c)=>createDirectPgProbe({clientFactory:()=>wrap(client(database,login,loginPassword,options.driver)),...options.transport});
 const result=async(p,name,args)=>{const r=await p.rpc(name,args);if(r.error)throw Error(r.error.message);return r.data;};
 const state=async db=>{
  const found={};for(const row of (await db.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('public','faolla_checkout_design') ORDER BY 1,2")).rows){
   assert.match(row.tablename,/^[a-z0-9_]+$/);found[row.schemaname+'.'+row.tablename]=(await db.query(`SELECT to_jsonb(t) r FROM ${row.schemaname}.${row.tablename} t ORDER BY to_jsonb(t)::text`)).rows;
  }return found;
 };
 const financial=async run=>{
  const name='checkout_direct_pg_test_'+randomBytes(8).toString('hex');assert.match(name,/^checkout_direct_pg_test_[a-f0-9]{16}$/);
  await admin.query(`CREATE DATABASE ${name} TEMPLATE ${base}`);databases.push(name);const db=await connect(name),p=probe(name);
  try{
   const f=fixtures.cartQuoteFixture('points',2);f.request.lines[0].couponClaims=[{couponId:f.coupons[0].id,claimEventId:f.coupons[0].claimEvents[0].id}];
   for(const row of [...f.snapshot.sourceRows,...f.snapshot.domainRows])await db.query('INSERT INTO public.pages(id,merchant_id,slug,blocks) VALUES($1,$2,$3,$4)',[row.id,row.merchant_id,row.slug,JSON.stringify(row.blocks)]);
   for(const table of ['bundle_pilots','intent_pilots','cart_quote_pilots','cart_submission_pilots'])await db.query(`INSERT INTO faolla_checkout_design.${table}(site_id,enabled) VALUES($1,true)`,[f.request.siteId]);
   let version=(await result(p,'faolla_member_checkout_catalog_snapshot_v1',{p_site_id:f.request.siteId})).version;
   for(const offer of f.offers){const next=randomUUID();await result(p,'faolla_member_checkout_catalog_save_v1',{p_site_id:f.request.siteId,p_expected_version:version,p_next_version:next,p_actor_key:'owner:synthetic-owner',p_offer:offer});version=next;}
   f.refresh();f.request={...f.request,nonce:randomUUID(),confirmationHash:'0'.repeat(64),customer:{name:'Synthetic',title:'Mx',email:'test@example.invalid',phone:'000',note:'preserved'}};
   const snapshot=async id=>{
    const qid=planner.cartSelectionIdentity(id,f.principal);
    return(await result(p,'faolla_member_checkout_cart_submission_snapshot_v1',{p_site_id:f.request.siteId,p_operation_key:id.operationKey,p_principal_key:id.principalKey,p_request_hash:id.requestHash,p_quote_request_hash:qid.requestHash,p_offer_ids:qid.request.lines.map(x=>x.offerId)})).snapshot;
   };
   let id=planner.cartSubmissionIdentity(f.request,f.principal),read=await snapshot(id);
   const q=await quote.quoteCheckoutCartSnapshot(read.quoteSnapshot,planner.cartSelectionIdentity(id,f.principal),f.principal);
   f.request.confirmationHash=planner.cartConfirmationHash(q,f.principal);id=planner.cartSubmissionIdentity(f.request,f.principal);read=await snapshot(id);
   const planned=await planner.planCartSubmission(read,id,f.principal),args={p_site_id:f.request.siteId,p_operation_key:id.operationKey,p_principal_key:id.principalKey,p_request_hash:id.requestHash,p_snapshot:planned.snapshot,p_plan:planned.plan,p_not_after:planned.notAfter};
   const recover=(identity=id,transport=p)=>result(transport,'faolla_member_checkout_cart_result_v1',{p_site_id:f.request.siteId,p_operation_key:identity.operationKey,p_principal_key:identity.principalKey});
   const commit=(transport=p,changes={})=>result(transport,'faolla_member_checkout_cart_commit_v1',{...args,...changes});
   const page=async slug=>(await one(db,'SELECT *,to_jsonb(updated_at) stamp FROM public.pages WHERE slug=$1',[slug]));
   await run({name,db,p,f,id,args,planned,commit,recover,page,site:f.request.siteId});
  }finally{await db.end();for(const c of [...openClients])if(c.connectionParameters.database===name)await c.end();await admin.query(`DROP DATABASE ${name}`);databases.splice(databases.indexOf(name),1);}
 };
 try{
  if(!hosted){
   const pgRoot=path.join(runtime,'node_modules/@embedded-postgres/windows-x64');assert.equal(JSON.parse(fs.readFileSync(path.join(pgRoot,'package.json'),'utf8')).version,'17.10.0-beta.17');pg=await import(pathToFileURL(path.join(pgRoot,'dist/index.js')).href);
   const reserve=net.createServer();await new Promise((resolve,reject)=>{reserve.once('error',reject);reserve.listen(port,'127.0.0.1',resolve);});await new Promise(resolve=>reserve.close(resolve));
   const passwordFile=path.join(parent,'synthetic-admin.password');fs.writeFileSync(passwordFile,adminPassword+'\n',{flag:'wx',mode:0o600});
   await exec(pg.initdb,['-D',path.join(parent,'cluster'),'-U','checkout_ci_admin','--auth-local=trust','--auth-host=scram-sha-256','--pwfile='+passwordFile,'--encoding=UTF8','--locale=C'],{windowsHide:true,timeout:60000});
   await exec(pg.pg_ctl,['-D',path.join(parent,'cluster'),'-l',path.join(parent,'postgres.private.log'),'-w','-t','30','-o',`-h 127.0.0.1 -p ${port} -c shared_buffers=16MB -c max_connections=24`,'start'],{windowsHide:true,timeout:45000});started=true;
   const bootstrap=new Client(config('postgres','checkout_ci_admin',adminPassword));bootstrap.on('error',()=>{});await bootstrap.connect();
   try{assert.equal(path.resolve((await one(bootstrap,'SHOW data_directory')).data_directory).toLowerCase(),path.resolve(parent,'cluster').toLowerCase());await bootstrap.query(`CREATE DATABASE ${base}`);}finally{await bootstrap.end();}
  }
  admin=await connect();const version=(await one(admin,"SELECT current_database() db,current_user::text actor,current_setting('server_version_num') version")).version;
  assert.equal(version,hosted?'150008':'170010');report.serverVersion=version;
  assert.deepEqual(await one(admin,'SELECT current_database() db,current_user::text actor'),{db:base,actor:'checkout_ci_admin'});
  assert.equal((await one(admin,"SELECT count(*)::int n FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")).n,0);
  const plan=await loadInstallationPlan(),revision=await loadCheckout047Revision();report.originalPlanSha256=plan.digest;report.original047RevisionSha256=revision.sha256;
  await admin.query(`CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;
   CREATE TABLE public.pages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id text,slug text,blocks jsonb,updated_at timestamptz DEFAULT clock_timestamp());
   CREATE TABLE public.faolla_schema_migrations(version bigint PRIMARY KEY,name text NOT NULL);
   GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;GRANT SELECT,INSERT,UPDATE,DELETE ON public.pages TO service_role;
   CREATE FUNCTION public.set_pages_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.updated_at=now();RETURN NEW;END;$$;
   CREATE TRIGGER set_pages_updated_at BEFORE UPDATE ON public.pages FOR EACH ROW EXECUTE FUNCTION public.set_pages_updated_at();`);
  await admin.query('INSERT INTO public.pages(merchant_id,slug,blocks) VALUES($1,$2,$3)',['__faolla_booking_persistence__','__merchant_booking_records__:v1',{version:1,records:[]}]);
  for(const original of plan.originals)await admin.query(original.source);await admin.query(revision.legacySql);
  for(const step of plan.steps)await admin.query('BEGIN;'+step.body+'COMMIT;');await admin.query(revision.adapterSql);for(const patch of revision.patches)await admin.query(patch.sql);
  const definitions=async(db=admin)=>sha(JSON.stringify((await db.query("SELECT p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','faolla_checkout_design') AND p.prokind='f' ORDER BY 1")).rows));
  const before=await definitions();
  // Only a new role and its explicit grant. No PUBLIC/default or existing role changes.
  await admin.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 6`);
  await admin.query(`ALTER ROLE ${login} PASSWORD '${loginPassword}'`); // Locally generated base64url, never logged/exported.
  await admin.query(`GRANT CONNECT ON DATABASE ${base} TO ${login};GRANT USAGE ON SCHEMA public TO ${login};GRANT EXECUTE ON FUNCTION ${runtimeEntry} TO ${login}`);
  assert.equal(await definitions(),before);report.originalFunctionDefinitionsUnchanged=true;
  await check('actual restricted password LOGIN; wrong password and NOLOGIN executor refuse',async()=>{
   const c=await connect(base,login,loginPassword);assert.deepEqual(await one(c,'SELECT current_user::text actor,session_user::text session'),{actor:login,session:login});await c.end();
   const bad=client(base,login,'wrong-synthetic-password');await assert.rejects(bad.connect(),e=>e.code==='28P01');await bad.end();
   const executor=client(base,executorRole,'wrong-synthetic-password');await assert.rejects(executor.connect(),e=>['28P01','28000'].includes(e.code));await executor.end();
   report.passwordAuthenticationValidated=true;
  });
  await check('no elevated role attributes, membership, table access or alternate financial function execution',async()=>{
   const r=await one(admin,'SELECT rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname=$1',[login]);
   assert.deepEqual(r,{rolsuper:false,rolinherit:false,rolcreaterole:false,rolcreatedb:false,rolreplication:false,rolbypassrls:false,rolcanlogin:true});
   assert.equal((await one(admin,'SELECT count(*)::int n FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=$1) OR roleid=(SELECT oid FROM pg_roles WHERE rolname=$1)',[login])).n,0);
   const leaks=(await admin.query("SELECT p.oid::regprocedure::text signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','faolla_checkout_design') AND p.proname LIKE 'faolla_%' AND p.oid<>$2::regprocedure AND has_function_privilege($1,p.oid,'EXECUTE') ORDER BY 1",[login,runtimeEntry])).rows;
   report.unexpectedBusinessFunctionPrivileges=leaks;assert.deepEqual(leaks,[]);
   for(const {schemaname,tablename} of (await admin.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('public','faolla_checkout_design')")).rows){
    assert.equal((await one(admin,"SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') allowed",[login,schemaname+'.'+tablename])).allowed,false);
   }
   const entry=await one(admin,'SELECT p.prosecdef,p.proconfig,r.rolname::text owner FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid=$1::regprocedure',[runtimeEntry]);
   assert.deepEqual(entry,{prosecdef:true,proconfig:['search_path=pg_catalog, pg_temp'],owner:executorRole});
  });
  await check('direct SQL cannot mutate business data, switch roles, alter dispatcher or create public objects',async()=>{
   const c=await connect(base,login,loginPassword);try{
    for(const sql of ['SELECT * FROM public.pages','UPDATE public.pages SET blocks=blocks','DELETE FROM faolla_checkout_design.bundle_results',`SET ROLE ${executorRole}`,'SET ROLE service_role','CREATE TABLE public.direct_forbidden(id int)','ALTER FUNCTION public.faolla_checkout_runtime_v1(text,jsonb) SECURITY INVOKER',"SELECT public.faolla_commit_redemption_internal_v1('10909994','{}')"])
     await assert.rejects(c.query(sql),e=>e.code==='42501');
    report.publicTemporaryPrivilege=(await one(c,"SELECT has_database_privilege(current_database(),'TEMP') allowed")).allowed;
    // TEMP is inherited from PUBLIC in an ordinary fresh database. Do not
    // silently revoke it for all existing roles or claim all DDL is forbidden.
    await c.query('CREATE TEMP TABLE direct_local_only(id int)');await c.query('DROP TABLE direct_local_only');
    await c.query("CREATE FUNCTION pg_temp.faolla_member_checkout_catalog_snapshot_v1(text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{\"spoofed\":true}'::jsonb $$");
    const actual=await one(c,'SELECT public.faolla_checkout_runtime_v1($1,$2) result',['faolla_member_checkout_catalog_snapshot_v1',{p_site_id:'10909994'}]);
    assert.deepEqual(actual.result,{version:null,offers:[]});
   }finally{await c.end();}
  });
  await check('both application and actual SQL dispatcher reject unknown methods and extra parameters',async()=>{
   const p=probe();assert.throws(()=>p.rpc('faolla_commit_redemption_v1',{}));
   const c=await connect(base,login,loginPassword);try{
    for(const [name,args,message] of [['SELECT 1',{},'checkout_runtime_forbidden'],['faolla_member_checkout_catalog_snapshot_v1',{p_site_id:'10909994',extra:true},'checkout_runtime_invalid_request']])
     await assert.rejects(c.query('SELECT public.faolla_checkout_runtime_v1($1,$2)',[name,args]),e=>e.code==='P0001'&&e.message===message);
   }finally{await c.end();}
  });
  await check('revoking only entry EXECUTE stops an already connected session; original grants remain untouched',async()=>{
   const c=await connect(base,login,loginPassword);try{
    const sql='SELECT public.faolla_checkout_runtime_v1($1,$2)',args=['faolla_member_checkout_catalog_snapshot_v1',{p_site_id:'10909994'}];await c.query(sql,args);
    await admin.query(`REVOKE EXECUTE ON FUNCTION ${runtimeEntry} FROM ${login}`);
    try{await assert.rejects(c.query(sql,args),e=>e.code==='42501');}finally{await admin.query(`GRANT EXECUTE ON FUNCTION ${runtimeEntry} TO ${login}`);}
    await c.query(sql,args);
   }finally{await c.end();}
  });
  // Template must have no active connections while being cloned.
  // CREATE DATABASE TEMPLATE requires all template sessions closed. A separate
  // maintenance connection points only at this harness's already verified cluster.
  await admin.end();
  admin=new Client(config('postgres','checkout_ci_admin',adminPassword));admin.on('error',()=>{});await admin.connect();
  await check('real concurrent commits debit points, coupon and stock only once',()=>financial(async x=>{
   const [a,b]=await Promise.all([x.commit(),x.commit()]);assert.equal(a.result.totalPoints,180);assert.equal([a,b].filter(v=>v.replayed).length,1);
   assert.equal((await x.page('__merchant_memberships__:'+x.site)).blocks[0].pointBalance,820);assert.equal((await x.page('__merchant_membership_settings__:'+x.site)).blocks.redemptionItems[0].stock,4);
   assert.equal((await x.page('__merchant_coupons__:'+x.site)).blocks[0].usedCount,1);assert.equal((await one(x.db,'SELECT count(*)::int n FROM faolla_checkout_design.redemption_047_audits')).n,1);
  }));
  await check('lost commit reply recovers original result without a second debit',()=>financial(async x=>{
   let sent=0;const lossy=probe(x.name,{},c=>{const query=c.query.bind(c);c.query=async q=>{const response=await query(q);if(q.values[0]==='faolla_member_checkout_cart_commit_v1'){sent++;throw Error('synthetic lost reply after actual commit');}return response;};return c;});
   await assert.rejects(x.commit(lossy),/checkout_runtime_unavailable/);const before=await state(x.db),original=await x.recover();assert.equal(original.totalPoints,180);
   assert.equal((await x.commit()).replayed,true);assert.equal(sent,1);assert.deepEqual(await state(x.db),before);
  }));
  await check('wrong original principal and expired deadline refuse with financial state unchanged',()=>financial(async x=>{
   const initial=await state(x.db);
   const r=await x.p.rpc('faolla_member_checkout_cart_commit_v1',{...x.args,p_not_after:new Date(Date.now()-1000).toISOString()});
   assert.equal(r.error?.message,'checkout_quote_expired');assert.deepEqual(await state(x.db),initial);
   await x.commit();const before=await state(x.db);
   assert.equal(await x.recover({...x.id,principalKey:'account:50010106:other-synthetic-user'}),null);assert.deepEqual(await state(x.db),before);
  }));
  await check('stale source version refuses instead of overwriting financial records',()=>financial(async x=>{
   await x.db.query("UPDATE public.pages SET updated_at=clock_timestamp() WHERE slug=$1",['__merchant_membership_settings__:'+x.site]);const before=await state(x.db);
   await assert.rejects(x.commit(),/checkout_|merchant_/);assert.deepEqual(await state(x.db),before);
  }));
  await check('lock timeout rolls back and returns only a generic transport error',()=>financial(async x=>{
   const lock=await connect(x.name);try{await lock.query('BEGIN');await lock.query('SELECT * FROM public.pages WHERE slug=$1 FOR UPDATE',['__merchant_membership_settings__:'+x.site]);const before=await state(x.db);
    await assert.rejects(x.commit(probe(x.name,{driver:{lock_timeout:80,statement_timeout:500},transport:{timeoutMs:1000}})),/checkout_runtime_unavailable/);
    await lock.query('ROLLBACK');assert.deepEqual(await state(x.db),before);
   }finally{await lock.end();}
  }));
  await check('transport timeout discards waiting connection; expired original cannot write after the lock is released',()=>financial(async x=>{
   const lock=await connect(x.name),deadline=Date.now()+180;try{await lock.query('BEGIN');await lock.query('SELECT * FROM public.pages WHERE slug=$1 FOR UPDATE',['__merchant_membership_settings__:'+x.site]);const before=await state(x.db);
    await assert.rejects(x.commit(probe(x.name,{driver:{lock_timeout:800,statement_timeout:1000},transport:{timeoutMs:80}}),{p_not_after:new Date(deadline).toISOString()}),/checkout_runtime_unavailable/);
    await delay(Math.max(0,deadline-Date.now()+30));await lock.query('ROLLBACK');
    const limit=Date.now()+1500;while((await one(x.db,"SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND usename=$1",[login])).n&&Date.now()<limit)await delay(20);
    assert.equal((await one(x.db,"SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND usename=$1",[login])).n,0);assert.deepEqual(await state(x.db),before);
   }finally{await lock.end();}
  }));
  await check('original cancellation refunds points, coupon and stock once without extending validity',()=>financial(async x=>{
   const claims=(await x.page('__merchant_coupons__:'+x.site)).blocks[0].claimEvents;await x.commit();
   const cancel=async()=>{const original=await x.recover();return result(x.p,'faolla_member_checkout_cart_cancel_v1',{p_site_id:x.site,p_operation_key:x.id.operationKey,p_principal_key:x.id.principalKey,p_expected_updated_at:original.resource.updatedAt,p_not_after:new Date(Date.now()+12000).toISOString()});};
   await cancel();const before=await state(x.db);assert.equal((await cancel()).replayed,true);assert.deepEqual(await state(x.db),before);
   assert.equal((await x.page('__merchant_memberships__:'+x.site)).blocks[0].pointBalance,1000);assert.equal((await x.page('__merchant_membership_settings__:'+x.site)).blocks.redemptionItems[0].stock,5);
   assert.deepEqual((await x.page('__merchant_coupons__:'+x.site)).blocks[0].claimEvents,claims);assert.equal((await x.page('__merchant_coupons__:'+x.site)).blocks[0].usedCount,0);
  }));
  await check('real booking with points and coupon uses unchanged single planner and original restricted SQL',async()=>{
   const db=await connect();try{
    const p=probe(),call=(name,args)=>result(p,name,args),data=await createOwnedCheckoutData(db,call),f=await data.seed('direct-pg-booking-only');
    let request={...f.selection,method:'points',nonce:randomUUID(),confirmationHash:'0'.repeat(64),customer:f.customer},id=bookingPlanner.checkoutSubmissionIdentity(request,f.principal);
    const snapshot=async()=>{const r=await call('faolla_member_checkout_submission_snapshot_v2',{p_site_id:data.site,p_operation_key:id.operationKey,p_principal_key:id.principalKey,p_request_hash:id.requestHash,p_offer_id:f.offer.id});return bookingPlanner.parseCheckoutSubmissionSnapshot(r.snapshot,id);};
    const first=await snapshot(),q=await bookingPlanner.quoteCheckoutSubmissionSnapshot(first,id,f.principal);
    request.confirmationHash=q.confirmationHash;id=bookingPlanner.checkoutSubmissionIdentity(request,f.principal);
    const second=await snapshot(),planned=await bookingPlanner.planCheckoutSubmission(second,id,f.principal);
    const args={p_site_id:data.site,p_operation_key:id.operationKey,p_principal_key:id.principalKey,p_request_hash:id.requestHash,p_snapshot:second,p_plan:planned.plan,p_not_after:planned.notAfter};
    const r=await call('faolla_member_checkout_submission_commit_v2',args);assert.equal(r.result.totalPoints,80);const before=await data.state();assert.equal((await call('faolla_member_checkout_submission_commit_v2',args)).replayed,true);assert.deepEqual(await data.state(),before);
    assert.equal((await data.page('__merchant_memberships__:'+data.site)).blocks[0].pointBalance,920);
   }finally{await db.end();}
  });
  const verify=await connect();try{assert.equal(await definitions(verify),before);}finally{await verify.end();}report.passed=true;
 }catch(error){report.failure={code:/^[a-zA-Z0-9_]{1,64}$/.test(error?.code??'')?error.code:'direct_pg_acceptance_failed',message:/^(checkout_|booking_atomic_)[a-z0-9_]{1,100}$/.test(error?.message??'')?error.message:'bounded_native_assertion_failed'};throw error;}
 finally{
  try{for(const c of [...openClients])await c.end();await admin?.end();
   if(started){await exec(pg.pg_ctl,['-D',path.join(parent,'cluster'),'-m','fast','-w','-t','30','stop'],{windowsHide:true,timeout:45000});started=false;}
   report.cleanupPassed=true;
  }finally{fs.writeFileSync(path.join(parent,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({evidence:parent,checks:report.checks.length,passed:report.passed,cleanupPassed:report.cleanupPassed,serverVersion:report.serverVersion}));}
 }
 assert.equal(report.cleanupPassed,true);
});
