// New owned GitHub-hosted PG 15.8 only. Never a production installer. The six
// prerequisites are created ONLY in this empty fixture; the package never replays them.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,chmod} from 'node:fs/promises';
import path from 'node:path';
import {assertIsolatedCi,database,databasePort,safeError} from './member-checkout-real-auth-support.mjs';
import {assertOwnedLifecycleTarget} from './member-checkout-runtime-lifecycle-cases.mjs';
import {loadInstallationPlan} from './member-checkout-installation-plan.mjs';
import {readCompatibilityCatalog,inspectCompatibilityCatalog} from './member-checkout-compatibility-check.mjs';
import {createCheckout047InstallationBundle,verifyCheckout047InstallationBundle,checkout047InstallationBundleSummary,
 observeCheckout047Installation,assertCheckout047InstallationTarget,assertCheckout047InstallationObservation,
 prepareCheckout047InstallationSeal,verifyCheckout047InstallationSeal,checkout047InstallationSealSummary,
 source047RegistryVersion,seal047RegistryVersion,checkout047SealRegistryName,checkout047SealRegistryDigest} from './member-checkout-047-installation.mjs';
import {createCheckout047InstallationJournal,openCheckout047InstallationJournal,checkout047SealFileName} from './member-checkout-047-installation-journal.mjs';
import {assertCheckout047InstalledPrivileges} from './member-checkout-047-installation-privileges.mjs';
import {createOwnedCheckoutData} from './fixtures/member-checkout-real-auth-database.mjs';
import submission from '../src/lib/merchantCheckoutSubmission.server.ts';
import points from '../src/lib/merchantCheckoutSubmissionPlan.server.ts';

test('independent 047 atomic installation, private seal and retained financial original',{timeout:300000},async t=>{
 const owned=assertIsolatedCi();assert.equal(owned.profileName,'current-auth');
 assert.equal(process.env.FAOLLA_CHECKOUT_047_INSTALLATION_ACCEPTANCE,'1','checkout_047_installation_opt_in_required');
 const ackMode=process.env.FAOLLA_CHECKOUT_INSTALLATION_ACK_MODE??'normal';assert.ok(['normal','commit-unknown'].includes(ackMode));
 const evidence=path.join(process.env.RUNNER_TEMP,'faolla-install-047-evidence');await mkdir(evidence);
 const {Client}=createRequire(path.join(process.env.RUNNER_TEMP,'faolla-install-tools/pg-client/package.json'))('pg');
 const clients=new Set();let opened=0,closed=0,observer;
 const report={version:1,commit:process.env.GITHUB_SHA,ackMode,scope:'owned-ci-047-atomic-installation-not-production',checks:[],passed:false,cleanupPassed:false,failure:null};
 const open=async()=>{
  assertIsolatedCi();const db=new Client({host:'127.0.0.1',port:databasePort,database,user:'checkout_ci_admin',password:'disposable-checkout-ci-only',ssl:false,
   connectionTimeoutMillis:5000,query_timeout:20000,statement_timeout:15000,application_name:'checkout-ci-installation-047'});
  assertOwnedLifecycleTarget(db);await db.connect();clients.add(db);opened++;
  assert.deepEqual((await db.query(`SELECT current_database() db,CURRENT_USER::text actor,(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) owner,
   current_setting('server_version_num') version`)).rows[0],{db:database,actor:'checkout_ci_admin',owner:'checkout_ci_admin',version:'150008'});
  await db.query('SET search_path=pg_catalog,public');return db;
 };
 const close=async db=>{if(clients.has(db)){await db.end();clients.delete(db);closed++;}};
 const check=async(name,run)=>{let ok=false;await t.test(name,async()=>{try{await run();ok=true;report.checks.push({name,passed:true});}catch(e){report.checks.push({name,passed:false});throw e;}});assert.equal(ok,true,'checkout_047_installation_prerequisite_failed:'+name);};
 try{
  const plan=await loadInstallationPlan(),source=await createCheckout047InstallationBundle(),packageFile=path.join(evidence,'source.private.json');
  await writeFile(packageFile,source.wire,{flag:'wx',mode:0o600});const bundle=await verifyCheckout047InstallationBundle(await readFile(packageFile,'utf8'));
  report.application=bundle.material.application;report.bundle=checkout047InstallationBundleSummary(bundle);
  const journal=createCheckout047InstallationJournal();let committedSeal,collisionFile;
  observer=await open();
  const registry=async db=>(await db.query('SELECT version::text version,name FROM public.faolla_schema_migrations ORDER BY version')).rows;
  const observe=db=>observeCheckout047Installation((sql,args)=>db.query(sql,args),bundle);
  const state=async db=>({metadataSha256:(await observe(db)).sha256,pages:(await db.query('SELECT to_jsonb(t) r FROM public.pages t ORDER BY id')).rows,
   pending:(await db.query('SELECT to_jsonb(t) r FROM public.faolla_redemption_checkouts t ORDER BY merchant_id,operation_id')).rows,
   operations:(await db.query('SELECT to_jsonb(t) r FROM public.faolla_redemption_operations t ORDER BY merchant_id,operation_id')).rows});
  const installed=db=>assertCheckout047InstalledPrivileges((sql,args)=>db.query(sql,args),bundle);
  await check('only six exact legacy prerequisites are created in a fresh owned fixture, preserving a synthetic pending cashier row',async()=>{
   assert.equal((await observer.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")).rows[0].n,0);
   assert.equal((await observer.query("SELECT count(*)::int n FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','faolla_checkout_runtime','faolla_checkout_executor')")).rows[0].n,0);
   await observer.query(`CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE TABLE public.pages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id text,slug text,blocks jsonb,updated_at timestamptz DEFAULT clock_timestamp());
    CREATE TABLE public.faolla_schema_migrations(version bigint PRIMARY KEY,name text NOT NULL);
    GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;GRANT SELECT,INSERT,UPDATE,DELETE ON public.pages TO service_role;
    CREATE FUNCTION public.set_pages_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.updated_at=now();RETURN NEW;END;$$;
    CREATE TRIGGER set_pages_updated_at BEFORE UPDATE ON public.pages FOR EACH ROW EXECUTE FUNCTION public.set_pages_updated_at();`);
   await observer.query('INSERT INTO public.pages(merchant_id,slug,blocks) VALUES($1,$2,$3)',['__faolla_booking_persistence__','__merchant_booking_records__:v1',{version:1,records:[]}]);
   for(const original of plan.originals)await observer.query(original.source);await observer.query(bundle.contract.revision.legacySql);
   await observer.query(`INSERT INTO public.faolla_redemption_checkouts(merchant_id,operator_id,operation_id,fingerprint,membership_id,request,status)
    VALUES('10909991','owner:synthetic','old-pending',$1,'synthetic-legacy-member','{}','pending')`,['a'.repeat(64)]);
   assert.deepEqual(await registry(observer),bundle.material.prerequisites.registry);
   assert.deepEqual(inspectCompatibilityCatalog(bundle.prerequisites,await readCompatibilityCatalog(sql=>observer.query(sql))).issues,['schema_boundary_changed']);
  });
  const preview=async()=>{await observer.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{
   await observer.query("SET LOCAL statement_timeout='5s';SET LOCAL lock_timeout='1s'");return await observe(observer);
  }finally{await observer.query('ROLLBACK');}};
  const baseline=await state(observer),before=await preview();
  const install=async(fault,bundleFile=packageFile)=>{
   const approved=await verifyCheckout047InstallationBundle(await readFile(bundleFile,'utf8'));assert.equal(approved.digest,bundle.digest);
   const db=await open();let applied=0,commitDispatched=false;
   try{
    await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='1s';SET LOCAL statement_timeout='15s';SET LOCAL search_path=pg_catalog,public;SET LOCAL standard_conforming_strings=on");
    assert.equal((await db.query('SELECT pg_try_advisory_xact_lock(20261125,6064) locked')).rows[0].locked,true,'checkout_047_installation_busy');
    const current=await observe(db);assertCheckout047InstallationTarget(before,current);
    const rows=await registry(db),receipt=rows.find(v=>v.version===source047RegistryVersion),sealReceipt=rows.find(v=>v.version===seal047RegistryVersion);
    if(receipt){
     assert.equal(receipt.name,bundle.receipt.name,'checkout_047_installation_receipt_conflict');assert.ok(sealReceipt,'checkout_047_installation_seal_missing');
     assert.deepEqual(rows.filter(v=>![source047RegistryVersion,seal047RegistryVersion].includes(v.version)),bundle.material.prerequisites.registry);
     await installed(db);const digest=checkout047SealRegistryDigest(sealReceipt.name),reopened=openCheckout047InstallationJournal(journal.root);
     verifyCheckout047InstallationSeal(reopened.read(digest),{expectedSha256:digest,before,current,bundle:approved});
     await db.query('COMMIT');return {status:'already_installed',applied:0};
    }
    assert.equal(sealReceipt,undefined,'checkout_047_installation_source_missing');assert.deepEqual(rows,bundle.material.prerequisites.registry,'checkout_047_installation_registry_changed');
    assert.deepEqual(inspectCompatibilityCatalog(bundle.prerequisites,await readCompatibilityCatalog(sql=>db.query(sql))).issues,['schema_boundary_changed'],'checkout_047_installation_prerequisites_changed');
    assert.equal((await db.query("SELECT count(*)::int n FROM pg_roles WHERE rolname IN ('faolla_checkout_runtime','faolla_checkout_executor')")).rows[0].n,0,'checkout_047_installation_role_collision');
    assertCheckout047InstallationObservation(before,current);
    for(const step of approved.material.steps){await db.query(step.body);applied++;if(fault==='middle'&&applied===34)await db.query('SELECT 1/0');}
    await installed(db);const seal=prepareCheckout047InstallationSeal(before,await observe(db),approved);
    if(fault==='journal-collision'){collisionFile=path.join(journal.root,checkout047SealFileName(seal.digest));await writeFile(collisionFile,'retained-conflict',{flag:'wx',mode:0o600});}
    journal.write(seal);
    await db.query('INSERT INTO public.faolla_schema_migrations(version,name) VALUES($1,$2),($3,$4)',[source047RegistryVersion,bundle.receipt.name,seal047RegistryVersion,checkout047SealRegistryName(seal.digest)]);
    verifyCheckout047InstallationSeal(journal.read(seal.digest),{expectedSha256:seal.digest,before,current:await observe(db),bundle:approved});
    if(fault==='before-commit'){await close(db);throw Object.assign(Error('owned_047_connection_closed_before_commit'),{code:'OWNED_CI_DISCONNECT'});}
    commitDispatched=true;await db.query(fault==='after-commit'?'COMMIT; SELECT 1/0':'COMMIT');return {status:'installed',applied};
   }catch(error){if(!commitDispatched)await db.query('ROLLBACK').catch(()=>{});throw error;}finally{await close(db);}
  };
  await check('separate readonly snapshot includes both old financial tables and no business rows',async()=>{
   const again=await preview();assert.equal(again.data.core.context.readOnly,true);assert.equal(again.data.core.context.isolation,'repeatable read');
   assertCheckout047InstallationObservation(before,again);assert.deepEqual(await state(observer),baseline);
   for(const name of ['faolla_redemption_checkouts','faolla_redemption_operations'])assert.ok(again.data.core.relations.some(v=>v.namespace==='public'&&v.name===name));
  });
  await check('self-rehashed altered source is refused before opening an installer connection',async()=>{
   const forged=JSON.parse(source.wire);forged.material.steps.at(-1).body+='\nSELECT 1;';forged.material.steps.at(-1).bodySha256=createHash('sha256').update(forged.material.steps.at(-1).body).digest('hex');
   forged.sha256=createHash('sha256').update(JSON.stringify(forged.material)).digest('hex');const file=path.join(evidence,'forged-source.private.json');await writeFile(file,JSON.stringify(forged),{flag:'wx',mode:0o600});
   const count=opened;await assert.rejects(install(null,file),/bundle_unapproved/);assert.equal(opened,count);assert.deepEqual(await state(observer),baseline);
  });
  await check('failure after the private adapter rolls back all 34 applied steps, new grants and tables',async()=>{await assert.rejects(install('middle'),e=>e.code==='22012');assert.deepEqual(await state(observer),baseline);});
  await check('disconnect before commit rolls back the complete package and both synthetic receipts',async()=>{await assert.rejects(install('before-commit'),e=>e.code==='OWNED_CI_DISCONNECT');assert.deepEqual(await state(observer),baseline);});
  await check('exclusive journal collision retains evidence and rolls back the database attempt',async()=>{await assert.rejects(install('journal-collision'),e=>e.code==='EEXIST');assert.equal(await readFile(collisionFile,'utf8'),'retained-conflict');assert.deepEqual(await state(observer),baseline);});
  await check('the original installation lock excludes a concurrent installer without clearing it',async()=>{
   await observer.query('BEGIN');await observer.query('SELECT pg_advisory_xact_lock(20261125,6064)');try{await assert.rejects(install(),/installation_busy/);}finally{await observer.query('ROLLBACK');}assert.deepEqual(await state(observer),baseline);
  });
  for(const [name,change,restore] of [
   ['old checkout constraint',"ALTER TABLE public.faolla_redemption_checkouts ADD CONSTRAINT ci_047_pre_shape CHECK(true) NOT VALID","ALTER TABLE public.faolla_redemption_checkouts DROP CONSTRAINT ci_047_pre_shape"],
   ['ordinary role attributes','ALTER ROLE service_role NOINHERIT','ALTER ROLE service_role INHERIT'],
   ['unrelated default grantee','ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO pg_read_all_data','ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM pg_read_all_data'],
   ['legacy trigger','ALTER TABLE public.pages DISABLE TRIGGER set_pages_updated_at','ALTER TABLE public.pages ENABLE TRIGGER set_pages_updated_at'],
   ['extra registry',"INSERT INTO public.faolla_schema_migrations VALUES(999999990049,'ci_047_extra')","DELETE FROM public.faolla_schema_migrations WHERE version=999999990049 AND name='ci_047_extra'"],
  ])await check('pre-install '+name+' drift is refused without silently repairing it',async()=>{
   await observer.query(change);try{const changed=await state(observer);await assert.rejects(install());assert.deepEqual(await state(observer),changed);}finally{await observer.query(restore);}assert.deepEqual(await state(observer),baseline);
  });
  await check('all 38 steps commit once with original rows unchanged, pilots closed and private effective ACLs verified',async()=>{
   if(ackMode==='commit-unknown'){
    await assert.rejects(install('after-commit'),e=>e.code==='22012');const committed=await state(observer),count=opened;
    assert.deepEqual(await install(),{status:'already_installed',applied:0});assert.equal(opened,count+1);assert.deepEqual(await state(observer),committed);report.commitRecoveredWithoutReapply=true;
   }else assert.deepEqual(await install(),{status:'installed',applied:38});
   report.privileges=await installed(observer);const after=await state(observer);for(const key of ['pages','pending','operations'])assert.deepEqual(after[key],baseline[key]);
   for(const table of ['bundle_pilots','intent_pilots','cart_quote_pilots','cart_submission_pilots','cart_collection_pilots','unused_reference_pilots','original_service_pilots'])assert.equal((await observer.query(`SELECT count(*)::int n FROM faolla_checkout_design.${table}`)).rows[0].n,0);
   const rows=await registry(observer),receipt=rows.find(v=>v.version===seal047RegistryVersion),digest=checkout047SealRegistryDigest(receipt.name);
   committedSeal=verifyCheckout047InstallationSeal(journal.read(digest),{expectedSha256:digest,before,current:await preview(),bundle});report.seal=checkout047InstallationSealSummary(committedSeal);
  });
  await check('exact repeat performs zero DDL and preserves object identities, financial rows and grants',async()=>{const current=await state(observer);assert.deepEqual(await install(),{status:'already_installed',applied:0});assert.deepEqual(await state(observer),current);});
  for(const [version,name,expected] of [[source047RegistryVersion,bundle.receipt.name,/installation_source_missing/],[seal047RegistryVersion,checkout047SealRegistryName(committedSeal.digest),/installation_seal_missing/]])await check('missing receipt '+version+' cannot trigger reapplication',async()=>{
   await observer.query('DELETE FROM public.faolla_schema_migrations WHERE version=$1',[version]);try{const changed=await state(observer);await assert.rejects(install(),expected);assert.deepEqual(await state(observer),changed);}finally{await observer.query('INSERT INTO public.faolla_schema_migrations VALUES($1,$2)',[version,name]);}
  });
  for(const [name,change,restore] of [
   ['audit constraint',"ALTER TABLE faolla_checkout_design.redemption_047_audits ADD CONSTRAINT ci_047_post_shape CHECK(true) NOT VALID","ALTER TABLE faolla_checkout_design.redemption_047_audits DROP CONSTRAINT ci_047_post_shape"],
   ['old checkout index','CREATE INDEX ci_047_checkout_index ON public.faolla_redemption_checkouts(created_at)','DROP INDEX public.ci_047_checkout_index'],
   ['old checkout policy','CREATE POLICY ci_047_post_policy ON public.faolla_redemption_checkouts USING(true)','DROP POLICY ci_047_post_policy ON public.faolla_redemption_checkouts'],
   ['audit deferred guard','ALTER TABLE faolla_checkout_design.redemption_047_audits DISABLE TRIGGER redemption_047_original_required','ALTER TABLE faolla_checkout_design.redemption_047_audits ENABLE TRIGGER redemption_047_original_required'],
   ['renamed internal grant','GRANT EXECUTE ON FUNCTION public.faolla_commit_redemption_internal_v1(text,jsonb) TO faolla_checkout_executor','REVOKE EXECUTE ON FUNCTION public.faolla_commit_redemption_internal_v1(text,jsonb) FROM faolla_checkout_executor'],
   ['unknown dispatcher grantee','GRANT EXECUTE ON FUNCTION public.faolla_checkout_runtime_v1(text,jsonb) TO pg_read_all_data','REVOKE EXECUTE ON FUNCTION public.faolla_checkout_runtime_v1(text,jsonb) FROM pg_read_all_data'],
  ])await check('post-install '+name+' drift is refused, not repaired or re-granted',async()=>{
   await observer.query(change);try{const changed=await state(observer);await assert.rejects(install());assert.deepEqual(await state(observer),changed);}finally{await observer.query(restore);}
  });
  await check('missing private journal refuses rather than regenerating a seal from database metadata',async()=>{
   const file=path.join(journal.root,checkout047SealFileName(committedSeal.digest)),retained=file+'.retained';await rename(file,retained);
   try{const current=await state(observer);await assert.rejects(install(),e=>e.code==='ENOENT');assert.deepEqual(await state(observer),current);}finally{await writeFile(file,await readFile(retained),{flag:'wx',mode:0o600});}
  });
  await check('publicly readable journal evidence refuses without permission repair',async()=>{
   const file=path.join(journal.root,checkout047SealFileName(committedSeal.digest));await chmod(file,0o644);
   try{const current=await state(observer);await assert.rejects(install(),/file_privacy/);assert.deepEqual(await state(observer),current);}finally{await chmod(file,0o600);}
  });
  const runtimeCall=async(name,args)=>{const db=await open();try{await db.query('BEGIN');await db.query('SET LOCAL SESSION AUTHORIZATION faolla_checkout_runtime');
   assert.equal((await db.query('SELECT CURRENT_USER::text actor')).rows[0].actor,'faolla_checkout_runtime');const result=(await db.query('SELECT public.faolla_checkout_runtime_v1($1,$2) result',[name,args])).rows[0].result;await db.query('COMMIT');return result;
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{await close(db);}};
  const financial=await createOwnedCheckoutData(observer,runtimeCall),f=await financial.seed(randomUUID());
  const rpc=async(name,args)=>{try{return {data:await runtimeCall(name,args),error:null};}catch(e){return {data:null,error:{message:e.message}};}};
  const initial={...f.selection,method:'points',nonce:randomUUID(),confirmationHash:'0'.repeat(64),customer:f.customer};
  const identity=points.checkoutSubmissionIdentity(initial,f.principal),read=await runtimeCall('faolla_member_checkout_submission_snapshot_v2',{
   p_site_id:financial.site,p_operation_key:identity.operationKey,p_principal_key:identity.principalKey,p_request_hash:identity.requestHash,p_offer_id:f.offer.id});
  const quote=await points.quoteCheckoutSubmissionSnapshot(points.parseCheckoutSubmissionSnapshot(read.snapshot,identity),identity,f.principal),request={...initial,confirmationHash:quote.confirmationHash};
  const submit=value=>submission.submitMemberCheckout({request:value,principal:f.principal,authorize:async()=>f.principal},rpc);
  await check('fresh installed restricted runtime commits a real points/coupon booking and repeats without a second debit',async()=>{
   const result=await submit(request);assert.equal(result.replayed,false);assert.equal(result.result.totalPoints,80);
   assert.equal((await financial.page(`__merchant_memberships__:${financial.site}`)).blocks[0].pointBalance,920);
   assert.equal((await observer.query("SELECT count(*)::int n FROM faolla_checkout_design.redemption_047_audits WHERE phase='payment'")).rows[0].n,1);
   const current=await financial.state();assert.deepEqual(await install(),{status:'already_installed',applied:0});assert.deepEqual(await financial.state(),current);
   assert.equal((await submit(request)).replayed,true);assert.deepEqual(await financial.state(),current);
  });
  await check('closing new creation preserves the paid original, legacy pending row and financial seal',async()=>{
   await observer.query('UPDATE faolla_checkout_design.bundle_pilots SET enabled=false WHERE site_id=$1',[financial.site]);const current=await financial.state();
   assert.equal((await submit(request)).replayed,true);await assert.rejects(submit({...request,nonce:randomUUID()}),/checkout_disabled/);assert.deepEqual(await financial.state(),current);
   assert.deepEqual(await install(),{status:'already_installed',applied:0});assert.deepEqual(await financial.state(),current);
   assert.deepEqual((await state(observer)).pending,baseline.pending);
  });
  report.passed=report.checks.every(v=>v.passed);
 }catch(error){report.failure=safeError(error);throw error;}finally{
  let failures=0;for(const db of [...clients])try{await close(db);}catch{failures++;}
  report.cleanupPassed=clients.size===0&&opened===closed&&failures===0;report.openedConnections=opened;report.closedConnections=closed;report.remainingConnections=clients.size;report.cleanupFailures=failures;
  if(!report.cleanupPassed)report.failure??={name:'Error',code:'OWNED_047_INSTALL_CLOSE_FAILED'};report.passed=report.passed&&report.cleanupPassed&&report.failure===null;
  await writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});assert.equal(report.cleanupPassed,true);
 }
});
