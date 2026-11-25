// Separate fresh PG 15.8 service. No changes to the two existing installation runs.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,writeFile} from 'node:fs/promises';
import {assertCheckout047InterruptionCi,checkout047InterruptionEnvironment,interruptionPhases} from './member-checkout-047-interruption-support.mjs';
import {database,databasePort,safeError} from './member-checkout-real-auth-support.mjs';
import {assertOwnedLifecycleTarget} from './member-checkout-runtime-lifecycle-cases.mjs';
import {loadInstallationPlan} from './member-checkout-installation-plan.mjs';
import {createCheckout047InstallationBundle,checkout047InstallationBundleSummary,observeCheckout047Installation} from './member-checkout-047-installation.mjs';
import {assertCheckout047InstalledPrivileges} from './member-checkout-047-installation-privileges.mjs';
import {openCheckoutEvidenceStorage} from './member-checkout-evidence-storage.mjs';
import {beginCheckout047Evidence,reopenCheckout047Evidence,confirmCheckout047Evidence} from './member-checkout-047-evidence.mjs';
import {createOwned047FileBackup,restoreOwned047FileBackup} from './member-checkout-047-owned-backup.mjs';
import {createOwnedCheckoutData} from './fixtures/member-checkout-real-auth-database.mjs';
import submission from '../src/lib/merchantCheckoutSubmission.server.ts';
import points from '../src/lib/merchantCheckoutSubmissionPlan.server.ts';

test('owned full-installer process death and original-directory file backup recovery',{timeout:300000},async t=>{
 assertCheckout047InterruptionCi();const evidence=path.join(process.env.RUNNER_TEMP,'faolla-interruption-047-evidence');await mkdir(evidence);
 const {Client}=createRequire(path.join(process.env.RUNNER_TEMP,'faolla-install-tools/pg-client/package.json'))('pg');
 const clients=new Set(),children=new Set();let opened=0,closed=0,observer,store,committedLocator,committedRoots,committedCurrent;
 const report={version:1,commit:process.env.GITHUB_SHA,scope:'owned-ci-full-installer-interruption-not-production',checks:[],installerProcesses:[],passed:false,cleanupPassed:false,failure:null};
 const open=async()=>{assertCheckout047InterruptionCi();const db=new Client({host:'127.0.0.1',port:databasePort,database,user:'checkout_ci_admin',password:'disposable-checkout-ci-only',ssl:false,connectionTimeoutMillis:5000,query_timeout:20000,statement_timeout:15000,application_name:'checkout-ci-interruption-observer'});
  assertOwnedLifecycleTarget(db);await db.connect();clients.add(db);opened++;
  assert.deepEqual((await db.query(`SELECT current_database() db,CURRENT_USER::text actor,(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) owner,current_setting('server_version_num') version`)).rows[0],{db:database,actor:'checkout_ci_admin',owner:'checkout_ci_admin',version:'150008'});
  await db.query('SET search_path=pg_catalog,public');return db;};
 const close=async db=>{if(clients.has(db)){await db.end();clients.delete(db);closed++;}};
 const check=async(name,run)=>{let ok=false;await t.test(name,async()=>{try{await run();ok=true;report.checks.push({name,passed:true});}catch(error){report.checks.push({name,passed:false});throw error;}});assert.equal(ok,true,'owned_047_interruption_prerequisite_failed');};
 const provision=()=>{const parent=fs.mkdtempSync(path.join(fs.realpathSync(tmpdir()),'faolla-checkout-evidence-test-'));fs.chmodSync(parent,0o700);const roots={dataRoot:path.join(parent,'data'),locatorRoot:path.join(parent,'locators')};for(const root of Object.values(roots))fs.mkdirSync(root,{mode:0o700});return roots;};
 const backupRoot=()=>{const root=fs.mkdtempSync(path.join(fs.realpathSync(tmpdir()),'faolla-checkout-backup-test-'));fs.chmodSync(root,0o700);return root;};
 try{
  const bundle=await createCheckout047InstallationBundle(),plan=await loadInstallationPlan();report.application=bundle.material.application;report.bundle=checkout047InstallationBundleSummary(bundle);observer=await open();
  const observe=db=>observeCheckout047Installation((sql,args)=>db.query(sql,args),bundle);
  const readonly=async()=>{const db=await open();try{await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await db.query("SET LOCAL statement_timeout='5s';SET LOCAL lock_timeout='1s'");const result=await observe(db);await db.query('ROLLBACK');return result;}finally{await close(db);}};
  const state=async()=>({metadataSha256:(await observe(observer)).sha256,pages:(await observer.query('SELECT to_jsonb(t) r FROM public.pages t ORDER BY id')).rows,pending:(await observer.query('SELECT to_jsonb(t) r FROM public.faolla_redemption_checkouts t ORDER BY merchant_id,operation_id')).rows,operations:(await observer.query('SELECT to_jsonb(t) r FROM public.faolla_redemption_operations t ORDER BY merchant_id,operation_id')).rows});
  await check('fresh owned fixture has six exact legacy prerequisites and only synthetic retained business rows',async()=>{
   assert.equal((await observer.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")).rows[0].n,0);
   assert.equal((await observer.query("SELECT count(*)::int n FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','faolla_checkout_runtime','faolla_checkout_executor')")).rows[0].n,0);
   await observer.query(`CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE TABLE public.pages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id text,slug text,blocks jsonb,updated_at timestamptz DEFAULT clock_timestamp());
    CREATE TABLE public.faolla_schema_migrations(version bigint PRIMARY KEY,name text NOT NULL);GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;GRANT SELECT,INSERT,UPDATE,DELETE ON public.pages TO service_role;
    CREATE FUNCTION public.set_pages_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.updated_at=now();RETURN NEW;END;$$;
    CREATE TRIGGER set_pages_updated_at BEFORE UPDATE ON public.pages FOR EACH ROW EXECUTE FUNCTION public.set_pages_updated_at();`);
   await observer.query('INSERT INTO public.pages(merchant_id,slug,blocks) VALUES($1,$2,$3)',['__faolla_booking_persistence__','__merchant_booking_records__:v1',{version:1,records:[]}]);
   for(const original of plan.originals)await observer.query(original.source);await observer.query(bundle.contract.revision.legacySql);
   await observer.query(`INSERT INTO public.faolla_redemption_checkouts(merchant_id,operator_id,operation_id,fingerprint,membership_id,request,status) VALUES('10909991','owner:synthetic','old-pending',$1,'synthetic-legacy-member','{}','pending')`,['a'.repeat(64)]);
   assert.deepEqual((await observer.query('SELECT version::text version,name FROM public.faolla_schema_migrations ORDER BY version')).rows,bundle.material.prerequisites.registry);
  });
  const baseline=await state(),before=await readonly();
  for(const phase of interruptionPhases)await check('SIGKILL full installer at '+phase+' retains evidence and never automatically reapplies',async()=>{
   const roots=provision(),ownedStore=openCheckoutEvidenceStorage(roots),initial=beginCheckout047Evidence(ownedStore,bundle,before),operationId=initial.data.locator.binding.operationId;
   ownedStore.close();const child=fork(new URL('./member-checkout-047-interruption-worker.mjs',import.meta.url),[],{env:checkout047InterruptionEnvironment(),stdio:['ignore','ignore','ignore','ipc']});children.add(child);
   const exited=once(child,'exit'),timer=setTimeout(()=>child.kill('SIGKILL'),40000);let checkpoint,result;
   try{
    const response=Promise.race([once(child,'message').then(([v])=>v),exited.then(()=>{throw Error('owned_047_installer_exited_before_checkpoint');})]);child.send({roots,operationId,phase});checkpoint=await response;
    assert.equal(checkpoint.kind,'owned-047-installation-checkpoint');assert.equal(checkpoint.phase,phase);assert.equal(checkpoint.operationId,operationId);assert.equal(checkpoint.pid,child.pid);assert.equal(checkpoint.applied,38);assert.ok(Number.isSafeInteger(checkpoint.backendPid)&&checkpoint.backendPid>0);
    assert.equal(child.kill('SIGKILL'),true);result=await exited;assert.deepEqual(result,[null,'SIGKILL']);
   }finally{clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}children.delete(child);}
   const deadline=Date.now()+5000;let remaining;
   do{remaining=(await observer.query("SELECT count(*)::int n FROM pg_stat_activity WHERE pid=$1 AND datname=$2 AND application_name='checkout-ci-installation-047-interruption'",[checkpoint.backendPid,database])).rows[0].n;if(remaining===0)break;await new Promise(resolve=>setTimeout(resolve,25));}while(Date.now()<deadline);
   assert.equal(remaining,0,'owned_047_killed_backend_not_reaped');report.installerProcesses.push({phase,applied:38,requested:'SIGKILL',observedSignal:result[1],exitCode:result[0],remainingBackend:remaining});
   const reopened=openCheckoutEvidenceStorage(roots);
   try{
    if(phase==='after-ddl'){assert.throws(()=>reopened.locate(operationId,'prepared'));assert.equal(reopened.locate(operationId,'initial'),initial.locatorWire);assert.deepEqual(await state(),baseline);}
    else{
     const locator=reopened.locate(operationId,'prepared'),context=await reopenCheckout047Evidence(reopened,locator),current=await readonly();
     if(phase!=='after-commit'){assert.throws(()=>confirmCheckout047Evidence(context,current),/seal_unconfirmed/);assert.deepEqual(await state(),baseline);assert.throws(()=>reopened.locate(operationId,'confirmed'));}
     else{committedLocator=locator;committedRoots=roots;committedCurrent=current;for(const key of ['pages','pending','operations'])assert.deepEqual((await state())[key],baseline[key]);assert.equal(current.data.core.registry.count,8);}
    }
   }finally{reopened.close();}
  });
  const committedState=await state();store=openCheckoutEvidenceStorage(committedRoots);
  await check('commit without installer acknowledgement is independently confirmable without executing installation SQL',async()=>{
   const context=await reopenCheckout047Evidence(store,committedLocator),verified=confirmCheckout047Evidence(context,committedCurrent);assert.equal(verified.databaseStatementsExecuted,0);assert.equal(verified.alreadyConfirmed,false);
   const again=confirmCheckout047Evidence(await reopenCheckout047Evidence(store,verified.locatorWire),await readonly());assert.equal(again.alreadyConfirmed,true);assert.equal(again.locatorWire,verified.locatorWire);assert.deepEqual(await state(),committedState);committedLocator=verified.locatorWire;
   report.sealSha256=verified.sealSha256;
  });
  let ticket;
  await check('independent file backup refuses conflicts, tampering and root rebinding before writes',async()=>{
   ticket=createOwned047FileBackup(store,committedLocator,backupRoot());assert.throws(()=>restoreOwned047FileBackup({...ticket},committedRoots),/receipt_unverified/);
   assert.throws(()=>restoreOwned047FileBackup(ticket,committedRoots),/conflict_retained/);const other=provision();assert.throws(()=>restoreOwned047FileBackup(ticket,other),/rebinding_refused/);assert.deepEqual(fs.readdirSync(other.dataRoot),[]);assert.deepEqual(fs.readdirSync(other.locatorRoot),[]);
   const corrupt=createOwned047FileBackup(store,committedLocator,backupRoot());fs.writeFileSync(path.join(corrupt.root,corrupt.file),'{}');assert.throws(()=>restoreOwned047FileBackup(corrupt,committedRoots));
   const missing=createOwned047FileBackup(store,committedLocator,backupRoot());fs.renameSync(path.join(missing.root,missing.file),path.join(missing.root,missing.file+'.retained'));assert.throws(()=>restoreOwned047FileBackup(missing,committedRoots));assert.deepEqual(await state(),committedState);
  });
  await check('missing all original files fails closed, then explicit owned backup restores exact bytes in original directories without database replay',async()=>{
   const image=store.read(committedLocator),id=image.locator.binding.operationId;
   for(const item of image.locator.artifacts){const file=path.join(committedRoots.dataRoot,id,item.kind+'.json');fs.renameSync(file,file+'.retained');}
   for(const stage of ['initial','prepared','confirmed']){const file=path.join(committedRoots.locatorRoot,id+'.'+stage+'.json');fs.renameSync(file,file+'.retained');}
   assert.throws(()=>store.locate(id,'confirmed'));await assert.rejects(reopenCheckout047Evidence(store,committedLocator));assert.deepEqual(await state(),committedState);
   const restored=restoreOwned047FileBackup(ticket,committedRoots);assert.equal(restored.restoredFiles,7);assert.equal(restored.originalDirectoryIdentitiesPreserved,true);assert.equal(restored.hostLossRecoveryProved,false);
   const result=confirmCheckout047Evidence(await reopenCheckout047Evidence(store,store.locate(id,'confirmed')),await readonly());assert.equal(result.alreadyConfirmed,true);assert.equal(result.locatorWire,committedLocator);assert.equal(result.databaseStatementsExecuted,0);assert.deepEqual(await state(),committedState);
   report.fileBackup={...restored,independentFileRead:true,missingEvidenceRefused:true,reconfirmedOriginal:true,ddlReplays:0,hostBackupRestoreTested:false,powerLossTested:false};
  });
  await check('recovered installation keeps exact effective privileges, pilots closed and all legacy rows unchanged',async()=>{
   report.privileges=await assertCheckout047InstalledPrivileges((sql,args)=>observer.query(sql,args),bundle);
   for(const table of ['bundle_pilots','intent_pilots','cart_quote_pilots','cart_submission_pilots','cart_collection_pilots','unused_reference_pilots','original_service_pilots'])assert.equal((await observer.query(`SELECT count(*)::int n FROM faolla_checkout_design.${table}`)).rows[0].n,0);
   for(const key of ['pages','pending','operations'])assert.deepEqual((await state())[key],baseline[key]);
  });
  const runtimeCall=async(name,args)=>{const db=await open();try{await db.query('BEGIN');await db.query('SET LOCAL SESSION AUTHORIZATION faolla_checkout_runtime');const result=(await db.query('SELECT public.faolla_checkout_runtime_v1($1,$2) result',[name,args])).rows[0].result;await db.query('COMMIT');return result;}catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}finally{await close(db);}};
  const financial=await createOwnedCheckoutData(observer,runtimeCall),f=await financial.seed(randomUUID()),rpc=async(name,args)=>{try{return {data:await runtimeCall(name,args),error:null};}catch(error){return {data:null,error:{message:error.message}};}};
  const initial={...f.selection,method:'points',nonce:randomUUID(),confirmationHash:'0'.repeat(64),customer:f.customer},identity=points.checkoutSubmissionIdentity(initial,f.principal);
  const snapshot=await runtimeCall('faolla_member_checkout_submission_snapshot_v2',{p_site_id:financial.site,p_operation_key:identity.operationKey,p_principal_key:identity.principalKey,p_request_hash:identity.requestHash,p_offer_id:f.offer.id});
  const quote=await points.quoteCheckoutSubmissionSnapshot(points.parseCheckoutSubmissionSnapshot(snapshot.snapshot,identity),identity,f.principal),request={...initial,confirmationHash:quote.confirmationHash},submit=value=>submission.submitMemberCheckout({request:value,principal:f.principal,authorize:async()=>f.principal},rpc);
  await check('after actual installer deaths and file restore a points-coupon booking commits once and replay never debits twice',async()=>{
   const result=await submit(request);assert.equal(result.replayed,false);assert.equal(result.result.totalPoints,80);assert.equal((await financial.page(`__merchant_memberships__:${financial.site}`)).blocks[0].pointBalance,920);
   const current=await financial.state();assert.equal((await submit(request)).replayed,true);assert.deepEqual(await financial.state(),current);assert.equal((await observer.query("SELECT count(*)::int n FROM faolla_checkout_design.redemption_047_audits WHERE phase='payment'")).rows[0].n,1);
  });
  await check('closing new purchases after recovery preserves the paid original and old pending cashier row',async()=>{
   await observer.query('UPDATE faolla_checkout_design.bundle_pilots SET enabled=false WHERE site_id=$1',[financial.site]);const current=await financial.state();assert.equal((await submit(request)).replayed,true);await assert.rejects(submit({...request,nonce:randomUUID()}),/checkout_disabled/);assert.deepEqual(await financial.state(),current);assert.deepEqual((await state()).pending,baseline.pending);
  });
  report.passed=report.checks.every(v=>v.passed);report.productionAuthorized=false;report.deploymentReady=false;report.persistentProductionStorageVerified=false;
 }catch(error){report.failure=safeError(error);throw error;}finally{
  let failures=0;for(const child of children){try{const exited=once(child,'exit');if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}}catch{failures++;}}children.clear();
  try{store?.close();}catch{failures++;}for(const db of [...clients])try{await close(db);}catch{failures++;}
  report.openedConnections=opened;report.closedConnections=closed;report.remainingConnections=clients.size;report.remainingChildren=children.size;report.cleanupFailures=failures;report.cleanupPassed=opened===closed&&clients.size===0&&failures===0;
  report.passed=report.passed&&report.cleanupPassed&&report.failure===null;await writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});assert.equal(report.cleanupPassed,true);
 }
});
