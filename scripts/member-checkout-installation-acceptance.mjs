// Fresh GitHub-hosted service DB ONLY. No production connector or installer.
// Tests the frozen proposal bundle's atomicity/receipt semantics, not a formal
// migration version, full Supabase clone or production traffic promotion.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,chmod} from 'node:fs/promises';
import path from 'node:path';
import {assertIsolatedCi,database,databasePort,safeError} from './member-checkout-real-auth-support.mjs';
import {assertOwnedLifecycleTarget} from './member-checkout-runtime-lifecycle-cases.mjs';
import {loadInstallationPlan} from './member-checkout-installation-plan.mjs';
import {createInstallationSourceBundle,verifyInstallationSourceBundle,installationBundleSummary} from './member-checkout-installation-bundle.mjs';
import {readInstallationPreflight,assertInstallationTarget,assertInstallationPreflight,installationPreflightSummary} from './member-checkout-installation-preflight.mjs';
import {observeInstallationSeal,assertInstallationSealObservation,prepareInstallationSeal,verifyInstallationSeal,installationSealSummary,
 sealRegistryVersion,installationSealRegistryName,installationSealRegistryDigest} from './member-checkout-installation-seal.mjs';
import {createInstallationSealJournal,openInstallationSealJournal,installationSealFileName} from './member-checkout-installation-seal-journal.mjs';
import {createInstallationReview,installationReviewSummary} from './member-checkout-installation-review.mjs';
import {loadInstallationSupplement,observeInstallationSupplement,installationSupplementSummary} from './member-checkout-installation-supplement.mjs';
import {readCompatibilityCatalog,inspectCompatibilityCatalog} from './member-checkout-compatibility-check.mjs';
import {createOwnedCheckoutData} from './fixtures/member-checkout-real-auth-database.mjs';
import submission from '../src/lib/merchantCheckoutSubmission.server.ts';
import points from '../src/lib/merchantCheckoutSubmissionPlan.server.ts';

const markerVersion='999999990001'; // Explicitly synthetic, NOT a production migration reservation.
test('owned atomic installation, interruption, idempotency and retained financial rollback', {timeout:180000}, async t=>{
 const owned=assertIsolatedCi();assert.equal(owned.profileName,'current-auth');
 const ackMode=process.env.FAOLLA_CHECKOUT_INSTALLATION_ACK_MODE??'normal';assert.ok(['normal','commit-unknown'].includes(ackMode),'installation_ack_mode_invalid');
 const evidence=path.join(process.env.RUNNER_TEMP,'faolla-install-evidence');await mkdir(evidence);
 const requirePg=createRequire(path.join(process.env.RUNNER_TEMP,'faolla-install-tools/pg-client/package.json'));
 const {Client}=requirePg('pg');const clients=new Set();let opened=0,closed=0;
 const report={version:1,commit:process.env.GITHUB_SHA,ackMode,scope:'owned-ci-atomic-installation-not-production',checks:[],passed:false,cleanupPassed:false,failure:null};
 const open=async()=>{
  assertIsolatedCi();const db=new Client({host:'127.0.0.1',port:databasePort,database,user:'checkout_ci_admin',password:'disposable-checkout-ci-only',ssl:false,
   connectionTimeoutMillis:5000,query_timeout:20000,statement_timeout:15000,application_name:'checkout-ci-installation'});
  assertOwnedLifecycleTarget(db);await db.connect();clients.add(db);opened++;
  assert.deepEqual((await db.query(`select current_database() db,current_user::text actor,
   (select pg_get_userbyid(datdba) from pg_database where datname=current_database()) owner,
   current_setting('server_version_num') version`)).rows[0],{db:database,actor:'checkout_ci_admin',owner:'checkout_ci_admin',version:'150008'});
  return db;
 };
 const close=async db=>{if(clients.has(db)){await db.end();clients.delete(db);closed++;}};
 const check=async(name,run)=>{let success=false;await t.test(name,async()=>{try{await run();success=true;report.checks.push({name,passed:true});}catch(e){report.checks.push({name,passed:false});throw e;}});assert.equal(success,true,'required installation prerequisite failed: '+name);};
 let observer;
 try{
  const sourceBundle=await createInstallationSourceBundle(),packageFile=path.join(evidence,'installation-bundle.private.json');
  await writeFile(packageFile,sourceBundle.wire,{flag:'wx',mode:0o600});
  const bundle=await verifyInstallationSourceBundle(await readFile(packageFile,'utf8'));
  const journal=createInstallationSealJournal();let committedSeal,conflictingJournalFile;
  const plan=await loadInstallationPlan();report.planSha256=plan.digest;report.application=plan.material.application;
  report.installationBundle=installationBundleSummary(bundle);
  assert.equal(bundle.material.planSha256,plan.digest);assert.equal(bundle.receipt.version,markerVersion);
  assert.equal(bundle.receipt.name,'ci_only_checkout_bundle_'+bundle.digest);
  const markerName=bundle.receipt.name;observer=await open();
  const registry=db=>db.query('select version::text version,name from public.faolla_schema_migrations order by version').then(r=>r.rows);
  const roleState=db=>db.query(`select oid::text oid,rolname::text name,rolsuper,rolcanlogin,rolinherit,rolcreaterole,rolcreatedb,rolbypassrls,rolreplication
   from pg_roles order by rolname`).then(r=>r.rows);
  const memberships=db=>db.query(`select a.rolname::text parent,b.rolname::text child,m.admin_option from pg_auth_members m
   join pg_roles a on a.oid=m.roleid join pg_roles b on b.oid=m.member order by parent,child`).then(r=>r.rows);
  const catalogue=db=>readCompatibilityCatalog(sql=>db.query(sql));
  const state=async db=>({catalogue:await catalogue(db),registry:await registry(db),roles:await roleState(db),memberships:await memberships(db),
   defaultAcls:(await db.query('select to_jsonb(d) value from pg_default_acl d order by oid')).rows,
   identities:(await db.query(`select 'relation' kind,c.oid::text oid,n.nspname::text namespace,c.relname::text name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','faolla_checkout_design')
    union all select 'function',p.oid::text,n.nspname::text,p.proname::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','faolla_checkout_design')
    union all select 'trigger',t.oid::text,n.nspname::text,t.tgname::text from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','faolla_checkout_design') order by kind,namespace,name,oid`)).rows,
   pages:(await db.query('select to_jsonb(p) value from public.pages p order by id')).rows});
  const installed=async db=>{
   const inspected=inspectCompatibilityCatalog(plan.expected,await catalogue(db));assert.deepEqual(inspected.issues,[]);assert.equal(inspected.deploymentReady,false);
   const rows=(await roleState(db)).filter(r=>['faolla_checkout_runtime','faolla_checkout_executor'].includes(r.name));assert.equal(rows.length,2);
   for(const r of rows){for(const key of ['rolsuper','rolcanlogin','rolinherit','rolcreaterole','rolcreatedb','rolreplication'])assert.equal(r[key],false);assert.equal(r.rolbypassrls,r.name==='faolla_checkout_executor');}
   assert.equal((await memberships(db)).filter(r=>/^faolla_checkout_/.test(r.parent)||/^faolla_checkout_/.test(r.child)).length,0);
   assert.deepEqual((await db.query(`select pg_get_userbyid(proowner)::text owner from pg_proc
    where oid='public.faolla_checkout_runtime_v1(text,jsonb)'::regprocedure`)).rows[0],{owner:'faolla_checkout_executor'});
   for(const role of ['anon','authenticated','service_role','faolla_checkout_runtime']){
    assert.equal((await db.query("select has_function_privilege($1,'public.faolla_checkout_runtime_v1(text,jsonb)','EXECUTE') allowed",[role])).rows[0].allowed,role==='faolla_checkout_runtime');
    assert.equal((await db.query("select has_schema_privilege($1,'faolla_checkout_design','USAGE') allowed",[role])).rows[0].allowed,false);
   }
   for(const table of [...plan.expected.tables,'public.pages','public.faolla_booking_atomic_control'])
    assert.equal((await db.query("select has_table_privilege('faolla_checkout_runtime',$1,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') allowed",[table])).rows[0].allowed,false);
   for(const role of ['faolla_checkout_runtime','faolla_checkout_executor'])
    assert.equal((await db.query("select has_schema_privilege($1,'public','CREATE') allowed",[role])).rows[0].allowed,false);
   // Do not mistake API-role-only inspection for complete ACL inspection.
   // An unrelated global default grantee must also fail the atomic install.
   const unexpected=(await db.query(`with allowed as (select oid from pg_roles where rolname in ('checkout_ci_admin','faolla_checkout_executor')),
    grants as (
     select a.grantee from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a where n.nspname='faolla_checkout_design'
     union all select a.grantee from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where n.nspname='faolla_checkout_design' and c.relkind='r'
     union all select a.grantee from pg_attribute v join pg_class c on c.oid=v.attrelid join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(v.attacl) a where n.nspname='faolla_checkout_design'
     union all select a.grantee from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where (n.nspname='faolla_checkout_design' or n.nspname='public' and (p.proname like 'faolla_member_checkout_%' or p.proname like 'faolla_checkout_%'))
       and not (p.oid='public.faolla_checkout_runtime_v1(text,jsonb)'::regprocedure and a.grantee=(select oid from pg_roles where rolname='faolla_checkout_runtime')))
    select count(*)::int n from grants where grantee not in (select oid from allowed)`)).rows[0].n;
   assert.equal(unexpected,0,'installation_unapproved_grantee');
  };
  await check('fresh owned old-schema fixture contains only the five pinned legacy prerequisites',async()=>{
   assert.equal((await observer.query("select count(*)::int n from pg_tables where schemaname not in ('pg_catalog','information_schema')")).rows[0].n,0);
   assert.equal((await observer.query("select count(*)::int n from pg_roles where rolname in ('anon','authenticated','service_role','faolla_checkout_runtime','faolla_checkout_executor')")).rows[0].n,0);
   await observer.query(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
    create table public.pages(id uuid primary key default gen_random_uuid(),merchant_id text,slug text,blocks jsonb,updated_at timestamptz default clock_timestamp());
    create table public.faolla_schema_migrations(version bigint primary key,name text not null);
    grant usage on schema public to anon,authenticated,service_role;grant select,insert,update,delete on public.pages to service_role;
    create function public.set_pages_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end;$$;
    create trigger set_pages_updated_at before update on public.pages for each row execute function public.set_pages_updated_at();`);
   await observer.query('insert into public.pages(merchant_id,slug,blocks) values($1,$2,$3)',['__faolla_booking_persistence__','__merchant_booking_records__:v1',{version:1,records:[]}]);
   for(const original of plan.originals)await observer.query(original.source);
   assert.deepEqual(await registry(observer),plan.registry);
  });
  const baseline=await state(observer),oldRoles=baseline.roles,oldMemberships=baseline.memberships;
  const previewPreflight=async()=>{
   await observer.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   try{
    await observer.query("SET LOCAL statement_timeout='5s';SET LOCAL lock_timeout='1s';SET LOCAL search_path=pg_catalog,public");
    return await readInstallationPreflight(sql=>observer.query(sql),bundle);
   }finally{await observer.query('ROLLBACK');}
  };
  const preflight=await previewPreflight();report.installationPreflight=installationPreflightSummary(preflight);
  const previewSeal=async()=>{
   await observer.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   try{await observer.query("SET LOCAL statement_timeout='5s';SET LOCAL lock_timeout='1s';SET LOCAL search_path=pg_catalog,public");
    return await observeInstallationSeal(sql=>observer.query(sql),bundle);
   }finally{await observer.query('ROLLBACK');}
  };
  const sealBaseline=await previewSeal();assertInstallationPreflight(preflight,sealBaseline.core);
  await check('read-only supplement matches all original function definitions and guards on the real owned PG',async()=>{
   const contract=await loadInstallationSupplement(bundle);
   // Docker's published loopback port does not imply that PostgreSQL sees a
   // loopback peer. Read OUR owned connection's server-observed address only.
   const peer=(await observer.query('select inet_client_addr()::text address')).rows[0].address;
   await observer.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   try{await observer.query("SET LOCAL statement_timeout='5s';SET LOCAL lock_timeout='1s';SET LOCAL search_path=pg_catalog,public");
    const supplement=await observeInstallationSupplement(sql=>observer.query(sql),contract,bundle,[peer]);
    report.installationSupplement=installationSupplementSummary(contract,supplement);
    assert.equal(report.installationSupplement.legacyDefinitionsMatch,true);assert.equal(report.installationSupplement.legacyFunctions,15);
    assert.equal(report.installationSupplement.legacyTriggers,3);assert.equal(report.installationSupplement.gatewayStatus,'observed-session-login');
    assert.equal(supplement.data.gatewayLogins[0].role,'checkout_ci_admin');
    assert.equal(report.installationSupplement.gatewayGrantAuthorized,false);assert.equal(report.installationSupplement.productionAuthorized,false);
    const unmatched=await observeInstallationSupplement(sql=>observer.query(sql),contract,bundle,['192.0.2.240']);
    assert.equal(installationSupplementSummary(contract,unmatched).gatewayStatus,'not-observed');
    report.installationSupplement.ownedPeerMatched=true;report.installationSupplement.wrongPeerRefused=true;
    assertInstallationSealObservation(sealBaseline,supplement.seal);
   }finally{await observer.query('ROLLBACK');}
   assert.deepEqual(await state(observer),baseline);
  });
  await check('offline production review keeps the five-source CI fixture distinct from a real complete registry and never authorizes installation',async()=>{
   const reviewed=await createInstallationReview(sealBaseline.core,bundle,{
    captureSha256:createHash('sha256').update(JSON.stringify(sealBaseline.core.data)).digest('hex'),publicBuild:process.env.GITHUB_SHA});
   report.installationReview=installationReviewSummary(reviewed);
   assert.equal(report.installationReview.registeredSources,5);assert.equal(report.installationReview.unregisteredSources,210);
   assert.equal(report.installationReview.productionAuthorized,false);assert.equal(report.installationReview.deploymentReady,false);
   assert.deepEqual(await state(observer),baseline);
  });
  const install=async(fault,bundleFile=packageFile)=>{
   const approved=await verifyInstallationSourceBundle(await readFile(bundleFile,'utf8'));
   assert.equal(approved.digest,bundle.digest,'installation_bundle_changed');
   const db=await open();let applied=0,commitDispatched=false;
   try{
    await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='1s';SET LOCAL statement_timeout='15s';SET LOCAL search_path=pg_catalog,public;SET LOCAL standard_conforming_strings=on");
    assert.equal((await db.query('select pg_try_advisory_xact_lock(20261125,6064) locked')).rows[0].locked,true,'installation_busy');
    const currentSeal=await observeInstallationSeal(sql=>db.query(sql),approved),currentPreflight=currentSeal.core;
    assertInstallationTarget(preflight,currentPreflight);
    const rows=await registry(db),receipt=rows.find(r=>r.version===markerVersion),sealReceipt=rows.find(r=>r.version===sealRegistryVersion);
    if(receipt){
     assert.equal(receipt.name,markerName,'installation_receipt_conflict');assert.ok(sealReceipt,'installation_seal_receipt_missing');
     assert.deepEqual(rows.filter(r=>![markerVersion,sealRegistryVersion].includes(r.version)),plan.registry);
     await installed(db);
     const digest=installationSealRegistryDigest(sealReceipt.name);
     // This trusted root is locally owned; a database row never chooses a path.
     const reopened=openInstallationSealJournal(journal.root);
     verifyInstallationSeal(reopened.read(digest),{expectedSha256:digest,before:sealBaseline,current:currentSeal,bundle:approved});
     await db.query('COMMIT');return{status:'already_installed',applied};
    }
    assert.equal(sealReceipt,undefined,'installation_source_receipt_missing');
    assert.deepEqual(rows,plan.registry,'installation_registry_changed');
    assert.deepEqual(inspectCompatibilityCatalog(plan.prerequisites,await catalogue(db)).issues,['schema_boundary_changed'],'installation_prerequisite_catalogue_changed');
    assert.equal((await db.query("select count(*)::int n from pg_roles where rolname in ('faolla_checkout_runtime','faolla_checkout_executor')")).rows[0].n,0,'installation_role_collision');
    assertInstallationPreflight(preflight,currentPreflight);
    assertInstallationSealObservation(sealBaseline,currentSeal);
    for(const step of approved.material.steps){await db.query(step.body);applied++;
     if(fault==='middle'&&applied===16)await db.query('select 1/0');}
    await installed(db);
    const after=await observeInstallationSeal(sql=>db.query(sql),approved),seal=prepareInstallationSeal(sealBaseline,after,approved);
    if(fault==='journal-collision'){
     conflictingJournalFile=path.join(journal.root,installationSealFileName(seal.digest));
     await writeFile(conflictingJournalFile,'retained-conflict',{flag:'wx',mode:0o600});
    }
    journal.write(seal); // Exclusive durable prepare and readback BEFORE database COMMIT.
    await db.query('insert into public.faolla_schema_migrations(version,name) values($1,$2),($3,$4)',
     [markerVersion,markerName,sealRegistryVersion,installationSealRegistryName(seal.digest)]);
    verifyInstallationSeal(journal.read(seal.digest),{expectedSha256:seal.digest,before:sealBaseline,
     current:await observeInstallationSeal(sql=>db.query(sql),approved),bundle:approved});
    if(fault==='before-commit'){await close(db);throw Object.assign(Error('owned_connection_closed_before_commit'),{code:'OWNED_CI_DISCONNECT'});}
    commitDispatched=true;
    // A real post-COMMIT error, not a simulated TCP loss or proof of power-loss durability.
    await db.query(fault==='after-commit'?'COMMIT; SELECT 1/0':'COMMIT');return{status:'installed',applied};
   }catch(error){if(!commitDispatched)await db.query('ROLLBACK').catch(()=>{});throw error;}
   finally{await close(db);}
  };
  await check('a separate readonly preview has the same source/target/metadata binding without reading business rows',async()=>{
   const again=await previewPreflight();assert.equal(again.data.context.readOnly,true);assert.equal(again.data.context.isolation,'repeatable read');
   assertInstallationPreflight(preflight,again);assert.deepEqual(await state(observer),baseline);
  });
  await check('a rehashed package with altered SQL is refused before any installer connection or DDL',async()=>{
   const material=JSON.parse(sourceBundle.wire).material,hash=value=>createHash('sha256').update(value).digest('hex');
   material.steps[0].body+='\nSELECT 1;';material.steps[0].bodySha256=hash(material.steps[0].body);
   // Parsed canonical key order is retained; this is a valid self-hashed wire,
   // not merely malformed JSON. Only the independent local source check rejects it.
   const forged=path.join(evidence,'installation-bundle-forged.private.json');
   await writeFile(forged,JSON.stringify({material,sha256:hash(JSON.stringify(material))}),{flag:'wx',mode:0o600});
   const connections=opened;await assert.rejects(install(null,forged),/^Error: installation_bundle_unapproved$/);
   assert.equal(opened,connections);assert.deepEqual(await state(observer),baseline);
  });
  await check('mid-bundle database error rolls back all new objects, grants and registration without modifying old rows',async()=>{
   await assert.rejects(install('middle'),e=>e.code==='22012');assert.deepEqual(await state(observer),baseline);
  });
  await check('disconnect after all DDL and receipt insertion leaves neither roles nor half-installed schema',async()=>{
   await assert.rejects(install('before-commit'),e=>e.code==='OWNED_CI_DISCONNECT');assert.deepEqual(await state(observer),baseline);
  });
  await check('exclusive journal collision rolls back the full database attempt and retains conflicting evidence',async()=>{
   await assert.rejects(install('journal-collision'),e=>e.code==='EEXIST');assert.deepEqual(await state(observer),baseline);
   assert.equal(await readFile(conflictingJournalFile,'utf8'),'retained-conflict');
   assertInstallationSealObservation(sealBaseline,await previewSeal());
  });
  await check('held installer lock refuses a second attempt before DDL or registry changes',async()=>{
   await observer.query('BEGIN');await observer.query('select pg_advisory_xact_lock(20261125,6064)');
   try{await assert.rejects(install(),/installation_busy/);}finally{await observer.query('ROLLBACK');}
   assert.deepEqual(await state(observer),baseline);
  });
  await check('an extra registry entry changes the complete preflight and is never ignored or deleted by installation',async()=>{
   const version='999999990002',name='ci_only_preflight_extra_registry';
   await observer.query('insert into public.faolla_schema_migrations(version,name) values($1,$2)',[version,name]);
   try{
    const before=await state(observer),changed=await previewPreflight();assert.equal(changed.data.registry.count,preflight.data.registry.count+1);
    assert.throws(()=>assertInstallationPreflight(preflight,changed),/installation_preflight_changed/);
    await assert.rejects(install(),/installation_registry_changed/);assert.deepEqual(await state(observer),before);
    assertInstallationPreflight(changed,await previewPreflight());
   }finally{assert.equal((await observer.query('delete from public.faolla_schema_migrations where version=$1 and name=$2',[version,name])).rowCount,1);}
   assertInstallationPreflight(preflight,await previewPreflight());assert.deepEqual(await state(observer),baseline);
  });
  await check('scoped legacy table constraint drift is refused before checkout DDL without repairing the reviewed table',async()=>{
   await observer.query('alter table public.pages add constraint ci_only_preflight_shape check (true) not valid');
   try{
    const before=await state(observer),changed=await previewPreflight();
    assert.throws(()=>assertInstallationPreflight(preflight,changed),/installation_preflight_changed/);
    await assert.rejects(install(),/installation_preflight_changed/);assert.deepEqual(await state(observer),before);
    assertInstallationPreflight(changed,await previewPreflight());
   }finally{await observer.query('alter table public.pages drop constraint ci_only_preflight_shape');}
   assertInstallationPreflight(preflight,await previewPreflight());assert.deepEqual(await state(observer),baseline);
  });
  await check('ordinary API role attribute drift is refused before checkout DDL without changing the role',async()=>{
   assert.equal(oldRoles.find(r=>r.name==='service_role').rolinherit,true);
   await observer.query('alter role service_role noinherit');
   try{
    const before=await state(observer),changed=await previewPreflight();
    assert.throws(()=>assertInstallationPreflight(preflight,changed),/installation_preflight_changed/);
    await assert.rejects(install(),/installation_preflight_changed/);assert.deepEqual(await state(observer),before);
    assertInstallationPreflight(changed,await previewPreflight());
   }finally{await observer.query('alter role service_role inherit');}
   assertInstallationPreflight(preflight,await previewPreflight());assert.deepEqual(await state(observer),baseline);
  });
  await check('unrelated global default function grantee is detected before checkout DDL and never silently revoked',async()=>{
   await observer.query('alter default privileges grant execute on functions to pg_read_all_data');
   try{const before=await state(observer),changed=await previewPreflight();
    assert.throws(()=>assertInstallationPreflight(preflight,changed),/installation_preflight_changed/);
    await assert.rejects(install(),/installation_preflight_changed/);assert.deepEqual(await state(observer),before);
    assertInstallationPreflight(changed,await previewPreflight());}
   finally{await observer.query('alter default privileges revoke execute on functions from pg_read_all_data');}
   assertInstallationPreflight(preflight,await previewPreflight());
   assert.deepEqual(await state(observer),baseline);
  });
  await check('legacy trigger drift invisible to the old preflight is refused before checkout DDL',async()=>{
   await observer.query('alter table public.pages disable trigger set_pages_updated_at');
   try{assertInstallationPreflight(preflight,await previewPreflight());const before=await state(observer);
    await assert.rejects(install(),/installation_seal_precondition_changed/);assert.deepEqual(await state(observer),before);
   }finally{await observer.query('alter table public.pages enable trigger set_pages_updated_at');}
   assertInstallationSealObservation(sealBaseline,await previewSeal());
  });
  await check('single committed installation preserves old data and API roles, keeps pilots off and records exact source digest',async()=>{
   if(ackMode==='commit-unknown'){
    await assert.rejects(install('after-commit'),e=>e.code==='22012');
    const committed=await state(observer),connections=opened;
    assert.deepEqual(await install(),{status:'already_installed',applied:0});assert.equal(opened,connections+1);
    assert.deepEqual(await state(observer),committed);report.commitRecoveredWithoutReapply=true;
   }else assert.deepEqual(await install(),{status:'installed',applied:33});
   await installed(observer);
   assert.deepEqual((await roleState(observer)).filter(r=>!r.name.startsWith('faolla_checkout_')),oldRoles);
   assert.deepEqual(await memberships(observer),oldMemberships);assert.deepEqual((await state(observer)).pages,baseline.pages);
   for(const table of ['bundle_pilots','intent_pilots','cart_quote_pilots','cart_submission_pilots','cart_collection_pilots','unused_reference_pilots','original_service_pilots'])
    assert.equal((await observer.query(`select count(*)::int n from faolla_checkout_design.${table}`)).rows[0].n,0);
   const rows=await registry(observer),sealReceipt=rows.find(r=>r.version===sealRegistryVersion),digest=installationSealRegistryDigest(sealReceipt.name);
   committedSeal=verifyInstallationSeal(journal.read(digest),{expectedSha256:digest,before:sealBaseline,current:await previewSeal(),bundle});
   report.installationSeal=installationSealSummary(committedSeal);
   assert.deepEqual(rows,[...plan.registry,{version:markerVersion,name:markerName},{version:sealRegistryVersion,name:sealReceipt.name}]);
  });
  await check('exact repeat performs no DDL and preserves receipt, object identities, rows and grants',async()=>{
   const before=await state(observer);assert.deepEqual(await install(),{status:'already_installed',applied:0});assert.deepEqual(await state(observer),before);
  });
  await check('conflicting receipt is refused without rewriting the receipt or repairing metadata',async()=>{
   await observer.query('update public.faolla_schema_migrations set name=$2 where version=$1',[markerVersion,'ci_only_conflicting_receipt']);
   try{const before=await state(observer);await assert.rejects(install(),/installation_receipt_conflict/);assert.deepEqual(await state(observer),before);}
   finally{await observer.query('update public.faolla_schema_migrations set name=$2 where version=$1',[markerVersion,markerName]);}
  });
  await check('existing schema without the exact receipt is refused instead of reapplying a partial install',async()=>{
   await observer.query('delete from public.faolla_schema_migrations where version=any($1::bigint[])',[[markerVersion,sealRegistryVersion]]);
   try{const before=await state(observer);await assert.rejects(install(),/installation_prerequisite_catalogue_changed/);assert.deepEqual(await state(observer),before);}
   finally{await observer.query('insert into public.faolla_schema_migrations(version,name) values($1,$2),($3,$4)',
    [markerVersion,markerName,sealRegistryVersion,installationSealRegistryName(committedSeal.digest)]);}
  });
  await check('either half of the atomic receipt pair missing refuses all reapplication',async()=>{
   for(const [version,name,reason] of [[markerVersion,markerName,/installation_source_receipt_missing/],
    [sealRegistryVersion,installationSealRegistryName(committedSeal.digest),/installation_seal_receipt_missing/]]){
    await observer.query('delete from public.faolla_schema_migrations where version=$1',[version]);
    try{const before=await state(observer);await assert.rejects(install(),reason);assert.deepEqual(await state(observer),before);}
    finally{await observer.query('insert into public.faolla_schema_migrations(version,name) values($1,$2)',[version,name]);}
   }
  });
  await check('full result seal detects a new private constraint that the old function and ACL checker accepts',async()=>{
   await observer.query('alter table faolla_checkout_design.bundle_pilots add constraint ci_only_post_shape check (true) not valid');
   try{await installed(observer);const before=await state(observer);await assert.rejects(install(),/installation_seal_unconfirmed/);assert.deepEqual(await state(observer),before);}
   finally{await observer.query('alter table faolla_checkout_design.bundle_pilots drop constraint ci_only_post_shape');}
  });
  await check('full result seal detects disabling a legacy trigger without repairing it',async()=>{
   await observer.query('alter table public.pages disable trigger set_pages_updated_at');
   try{await installed(observer);const before=await state(observer);await assert.rejects(install(),/installation_seal_unconfirmed/);assert.deepEqual(await state(observer),before);}
   finally{await observer.query('alter table public.pages enable trigger set_pages_updated_at');}
  });
  await check('full result seal detects an otherwise hidden legacy policy',async()=>{
   await observer.query('create policy ci_only_post_policy on public.pages using (true)');
   try{await installed(observer);const before=await state(observer);await assert.rejects(install(),/installation_seal_unconfirmed/);assert.deepEqual(await state(observer),before);}
   finally{await observer.query('drop policy ci_only_post_policy on public.pages');}
  });
  await check('legacy trigger function body drift is sealed even outside the faolla function-name prefix',async()=>{
   await observer.query('create or replace function public.set_pages_updated_at() returns trigger language plpgsql as $$begin new.updated_at=clock_timestamp();return new;end;$$');
   try{await installed(observer);const before=await state(observer);await assert.rejects(install(),/installation_seal_unconfirmed/);assert.deepEqual(await state(observer),before);}
   finally{await observer.query('create or replace function public.set_pages_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end;$$');}
  });
  await check('missing private journal never regenerates evidence from a mutable database receipt',async()=>{
   const file=path.join(journal.root,installationSealFileName(committedSeal.digest)),retained=file+'.retained';
   await rename(file,retained);
   try{const before=await state(observer);await assert.rejects(install(),e=>e.code==='ENOENT');assert.deepEqual(await state(observer),before);}
   finally{await writeFile(file,await readFile(retained),{flag:'wx',mode:0o600});}
  });
  await check('publicly readable journal evidence is refused without changing its permissions',async()=>{
   const file=path.join(journal.root,installationSealFileName(committedSeal.digest));await chmod(file,0o644);
   try{const before=await state(observer);await assert.rejects(install(),/installation_journal_file_privacy/);assert.deepEqual(await state(observer),before);}
   finally{await chmod(file,0o600);}
  });
  await check('a self-rehashed wrong catalogue journal and matching database seal name do not approve changed evidence',async()=>{
   const value=JSON.parse(committedSeal.wire),canonical=input=>JSON.stringify(input,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)
    ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
   value.material.catalogSha256='0'.repeat(64);value.sha256=createHash('sha256').update(canonical(value.material)).digest('hex');
   await writeFile(path.join(journal.root,installationSealFileName(value.sha256)),canonical(value),{flag:'wx',mode:0o600});
   await observer.query('update public.faolla_schema_migrations set name=$2 where version=$1',[sealRegistryVersion,installationSealRegistryName(value.sha256)]);
   try{const before=await state(observer);await assert.rejects(install(),/installation_seal_unconfirmed/);assert.deepEqual(await state(observer),before);}
   finally{await observer.query('update public.faolla_schema_migrations set name=$2 where version=$1',[sealRegistryVersion,installationSealRegistryName(committedSeal.digest)]);}
  });
  await check('security drift after installation is refused rather than silently re-granted or repaired',async()=>{
   await observer.query('grant execute on function public.faolla_checkout_runtime_v1(text,jsonb) to PUBLIC');
   try{const before=await state(observer);await assert.rejects(install());assert.deepEqual(await state(observer),before);}
   finally{await observer.query('revoke execute on function public.faolla_checkout_runtime_v1(text,jsonb) from PUBLIC');}
  });
  await check('an unrelated role cannot receive dispatcher execution behind the original API-role checks',async()=>{
   await observer.query('grant execute on function public.faolla_checkout_runtime_v1(text,jsonb) to pg_read_all_data');
   try{const before=await state(observer);await assert.rejects(install(),/installation_unapproved_grantee/);assert.deepEqual(await state(observer),before);}
   finally{await observer.query('revoke execute on function public.faolla_checkout_runtime_v1(text,jsonb) from pg_read_all_data');}
  });
  const runtimeCall=async(name,args)=>{
   const db=await open();try{await db.query('BEGIN');await db.query('SET LOCAL SESSION AUTHORIZATION faolla_checkout_runtime');
    assert.equal((await db.query('select current_user::text name')).rows[0].name,'faolla_checkout_runtime');
    const value=(await db.query('select public.faolla_checkout_runtime_v1($1,$2) result',[name,args])).rows[0].result;await db.query('COMMIT');return value;
   }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{await close(db);}
  };
  const financial=await createOwnedCheckoutData(observer,runtimeCall),f=await financial.seed(randomUUID());
  const rpc=async(name,args)=>{try{return{data:await runtimeCall(name,args),error:null};}catch(error){return{data:null,error:{message:error.message}};}};
  const nonce=randomUUID(),initial={...f.selection,method:'points',nonce,confirmationHash:'0'.repeat(64),customer:f.customer};
  const identity=points.checkoutSubmissionIdentity(initial,f.principal),read=await runtimeCall('faolla_member_checkout_submission_snapshot_v2',{
   p_site_id:financial.site,p_operation_key:identity.operationKey,p_principal_key:identity.principalKey,p_request_hash:identity.requestHash,p_offer_id:f.offer.id});
  const quote=await points.quoteCheckoutSubmissionSnapshot(points.parseCheckoutSubmissionSnapshot(read.snapshot,identity),identity,f.principal);
  const request={...initial,confirmationHash:quote.confirmationHash};
  const submit=request=>submission.submitMemberCheckout({request,principal:f.principal,authorize:async()=>f.principal},rpc);
  await check('installed least-privilege entry commits a real points/coupon booking and retains it across exact reinstallation',async()=>{
   const result=await submit(request);assert.equal(result.replayed,false);assert.equal(result.result.totalPoints,80);
   assert.equal((await financial.page(`__merchant_memberships__:${financial.site}`)).blocks[0].pointBalance,920);
   const before=await financial.state();assert.deepEqual(await install(),{status:'already_installed',applied:0});assert.deepEqual(await financial.state(),before);
   assert.equal((await submit(request)).replayed,true);assert.deepEqual(await financial.state(),before);
  });
  await check('closing creation retains the paid original, balance, coupon and immutable history while refusing a new order',async()=>{
   await observer.query('update faolla_checkout_design.bundle_pilots set enabled=false where site_id=$1',[financial.site]);
   const before=await financial.state();assert.equal((await submit(request)).replayed,true);
   await assert.rejects(submit({...request,nonce:randomUUID()}),/checkout_disabled/);assert.deepEqual(await financial.state(),before);
   assert.deepEqual(await install(),{status:'already_installed',applied:0});assert.deepEqual(await financial.state(),before);
  });
  report.passed=report.checks.every(c=>c.passed);
 }catch(error){report.failure=safeError(error);throw error;}
 finally{
  let cleanupFailures=0;
  for(const client of [...clients])try{await close(client);}catch{cleanupFailures++;}
  report.cleanupPassed=clients.size===0&&opened===closed&&cleanupFailures===0;
  report.openedConnections=opened;report.closedConnections=closed;report.cleanupFailures=cleanupFailures;report.remainingConnections=clients.size;
  if(!report.cleanupPassed)report.failure??={name:'Error',code:'OWNED_INSTALL_CLOSE_FAILED'};
  report.passed=report.passed&&report.cleanupPassed&&report.failure===null;
  await writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
  assert.equal(report.cleanupPassed,true);
 }
});
