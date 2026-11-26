// Complete registry + actual relevant prerequisite DDL + immutable 38-step
// installer, durable evidence and independent native PG readers in ONE fixture.
// 214 historical names are NOT a replay/clone of 214 historical DDL migrations.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {fork} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {assertFullRegistryInstallationCi,fullRegistryInstallationEnvironment} from './member-checkout-full-registry-installation-support.mjs';
import {database,databasePort,safeError} from './member-checkout-real-auth-support.mjs';
import {assertOwnedLifecycleTarget} from './member-checkout-runtime-lifecycle-cases.mjs';

test('owned native PG15.8 full-registry atomic installation and durable interrupted recovery',{timeout:300000},async t=>{
 assertFullRegistryInstallationCi();assert.ok(process.getuid()>0);
 const {createCheckout047InstallationBundle,observeCheckout047Installation}=await import('./member-checkout-047-installation.mjs');
 const {loadInstallationPlan}=await import('./member-checkout-installation-plan.mjs');
 const {readReviewedMigrationInventory}=await import('./member-checkout-installation-review.mjs');
 const {loadCheckout047PreinstallContract,observeCheckout047Preinstall,inspectCheckout047Preinstall}=await import('./member-checkout-047-preinstall-review.mjs');
 const {nativeFullRegistrySource}=await import('./fixtures/member-checkout-full-registry-native-source.mjs');
 const {openCheckoutEvidenceStorage}=await import('./member-checkout-evidence-storage.mjs');
 const {beginCheckoutFullRegistryEvidence}=await import('./member-checkout-full-registry-evidence.mjs');
 const {checkoutFullRegistryOwnedReceipts,verifyCheckoutFullRegistryPrepared}=await import('./member-checkout-full-registry-result.mjs');
 const {Client}=createRequire(path.join(process.env.RUNNER_TEMP,'faolla-full-native-tools/pg-client/package.json'))('pg');
 const mode=process.env.FAOLLA_CHECKOUT_FULL_REGISTRY_INSTALLATION_MODE;
 const evidence=path.join(process.env.RUNNER_TEMP,'faolla-full-native-evidence');fs.mkdirSync(evidence,{mode:0o700});
 const clients=new Set(),children=new Set();let opened=0,closed=0,observer,completed;
 const report={version:1,commit:process.env.GITHUB_SHA,mode,scope:'owned-native-full-registry-installer-not-production',checks:[],workers:[],passed:false,cleanupPassed:false,failure:null,
  registryEngine:'PostgreSQL',serverVersion:'150008',nativePostgresInstallationValidated:false,realDatabaseConnectionIdentityValidated:false,wholeInstallerInterrupted:false,
  persistentFullRegistryEvidenceValidated:false,fullHistoricalDdlReplay:false,syntheticGatewayAndAcceptanceReferences:true,
  fullProductionGatewayValidated:false,persistentProductionStorageValidated:false,hostBackupRestoreValidated:false,powerLossValidated:false,
  productionReadPerformed:false,productionAuthorized:false,deploymentReady:false,stripeEnabled:false};
 const sha=value=>createHash('sha256').update(value).digest('hex');
 const open=async()=>{
  assertFullRegistryInstallationCi();
  const db=new Client({host:'127.0.0.1',port:databasePort,database,user:'checkout_ci_admin',password:'disposable-checkout-ci-only',ssl:false,
   connectionTimeoutMillis:5000,query_timeout:20000,statement_timeout:15000,application_name:'checkout-ci-full-registry-native-observer'});
  assertOwnedLifecycleTarget(db);await db.connect();clients.add(db);opened++;
  assert.deepEqual((await db.query(`SELECT current_database() db,CURRENT_USER::text actor,(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) owner,current_setting('server_version_num') version`)).rows[0],
   {db:database,actor:'checkout_ci_admin',owner:'checkout_ci_admin',version:'150008'});
  await db.query('SET search_path=pg_catalog,public');return db;
 };
 const close=async db=>{if(clients.has(db)){await db.end();clients.delete(db);closed++;}};
 const check=async(name,run)=>{let passed=false;await t.test(name,async()=>{await run();passed=true;});report.checks.push({name,passed});assert.equal(passed,true,'full_native_prerequisite_failed');};
 const fileHashes=roots=>{
  const result={};for(const name of fs.readdirSync(roots.dataRoot))for(const leaf of fs.readdirSync(path.join(roots.dataRoot,name)))result[name+'/'+leaf]=sha(fs.readFileSync(path.join(roots.dataRoot,name,leaf)));
  for(const name of fs.readdirSync(roots.locatorRoot))result['locators/'+name]=sha(fs.readFileSync(path.join(roots.locatorRoot,name)));return result;
 };
 async function worker(request,{kill=false,refused=false}={}){
  const child=fork(new URL('./member-checkout-full-registry-installation-worker.mjs',import.meta.url),[],{env:fullRegistryInstallationEnvironment(),execArgv:['--import','tsx'],stdio:['ignore','pipe','pipe','ipc']});children.add(child);
  let reply,stdoutBytes=0,stderrBytes=0,forced=false,plannedKill=false;
  child.stdout.on('data',b=>{stdoutBytes+=b.length;if(stdoutBytes>65536){forced=true;child.kill('SIGKILL');}});
  child.stderr.on('data',b=>{stderrBytes+=b.length;if(stderrBytes>65536){forced=true;child.kill('SIGKILL');}});
  const timer=setTimeout(()=>{forced=true;child.kill('SIGKILL');},60000);
  const endedPromise=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
  child.on('message',m=>{reply=m;if(kill&&m.kind==='full-native-checkpoint'){plannedKill=true;child.kill('SIGKILL');}});
  child.send(request);
  const ended=await endedPromise.finally(()=>{clearTimeout(timer);children.delete(child);});
  report.workers.push({action:request.action,phase:request.phase,stage:request.stage,...ended,forced,plannedKill,expectedRefusal:refused,stdoutBytes,stderrBytes,
   progress:reply?{phase:reply.phase,applied:reply.applied,queries:reply.queries,opened:reply.opened,closed:reply.closed,commitDispatches:reply.commitDispatches,errorCode:reply.errorCode??null}:null});
  assert.equal(forced,false);assert.equal(stdoutBytes,0);assert.equal(stderrBytes,0);
  if(kill){
   assert.equal(plannedKill,true);assert.equal(reply?.kind,'full-native-checkpoint');assert.deepEqual(ended,{code:null,signal:'SIGKILL'});
   assert.equal(reply.pid,child.pid);assert.equal(reply.operationId,request.operationId);assert.equal(reply.phase,request.phase);assert.equal(reply.applied,38);
   const deadline=Date.now()+5000;let remaining;
   do{remaining=(await observer.query("SELECT count(*)::int n FROM pg_stat_activity WHERE pid=$1 AND datname=$2 AND application_name='checkout-ci-full-registry-native-worker'",[reply.backendPid,database])).rows[0].n;if(remaining===0)break;await new Promise(resolve=>setTimeout(resolve,25));}while(Date.now()<deadline);
   assert.equal(remaining,0);return reply;
  }
  assert.equal(ended.signal,null);assert.equal(ended.code,refused?1:0);assert.equal(reply?.kind,refused?'full-native-refused':'full-native-complete');
  assert.equal(reply.opened,reply.closed);return reply;
 }
 try{
  observer=await open();const bundle=await createCheckout047InstallationBundle(),plan=await loadInstallationPlan();
  report.application=bundle.material.application;report.bundleSha256=bundle.digest;
  const observe=db=>observeCheckout047Installation((sql,args)=>db.query(sql,args),bundle);
  const readonly=async()=>{const db=await open();try{await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await db.query("SET LOCAL statement_timeout='5s';SET LOCAL lock_timeout='1s'");const result=await observe(db);await db.query('ROLLBACK');return result;}finally{await close(db);}};
  const business=async()=>({pages:(await observer.query('SELECT to_jsonb(t) r FROM public.pages t ORDER BY id')).rows,
   pending:(await observer.query('SELECT to_jsonb(t) r FROM public.faolla_redemption_checkouts t ORDER BY merchant_id,operation_id')).rows,
   operations:(await observer.query('SELECT to_jsonb(t) r FROM public.faolla_redemption_operations t ORDER BY merchant_id,operation_id')).rows});
  await check('fresh native target has actual six prerequisite DDL, exact 214 inventory names and synthetic retained rows only',async()=>{
   assert.equal((await observer.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")).rows[0].n,0);
   assert.equal((await observer.query("SELECT count(*)::int n FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','authenticator','supabase_auth_admin','faolla_checkout_runtime','faolla_checkout_executor')")).rows[0].n,0);
   await observer.query(`CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE ROLE authenticator LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;CREATE ROLE supabase_auth_admin LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
    CREATE TABLE public.pages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id text,slug text,blocks jsonb,updated_at timestamptz DEFAULT clock_timestamp());
    CREATE TABLE public.faolla_schema_migrations(version bigint PRIMARY KEY,name text NOT NULL);
    GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;GRANT SELECT,INSERT,UPDATE,DELETE ON public.pages TO service_role;
    CREATE FUNCTION public.set_pages_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.updated_at=now();RETURN NEW;END;$$;
    CREATE TRIGGER set_pages_updated_at BEFORE UPDATE ON public.pages FOR EACH ROW EXECUTE FUNCTION public.set_pages_updated_at();`);
   await observer.query('INSERT INTO public.pages(merchant_id,slug,blocks) VALUES($1,$2,$3)',['__faolla_booking_persistence__','__merchant_booking_records__:v1',{version:1,records:[]}]);
   for(const original of plan.originals)await observer.query(original.source);await observer.query(bundle.contract.revision.legacySql);
   assert.deepEqual((await observer.query('SELECT version::text version,name FROM public.faolla_schema_migrations ORDER BY version')).rows,bundle.material.prerequisites.registry);
   const inventory=await readReviewedMigrationInventory(),excluded='scripts/supabase-migrations/202609280060_customer_membership_profile_projection.sql';
   const existing=new Set(bundle.material.prerequisites.registry.map(v=>v.version));let inserted=0;
   for(const entry of inventory.entries.filter(v=>v.file!==excluded)){
    const match=path.basename(entry.file).match(/^([0-9]{12,14})_([a-z0-9_]+)\.sql$/);assert.ok(match);assert.equal(match[1],entry.version);assert.equal(sha(match[2]),entry.nameSha256);
    if(!existing.has(entry.version)){await observer.query('INSERT INTO public.faolla_schema_migrations(version,name) VALUES($1,$2)',[entry.version,match[2]]);inserted++;}
   }
   assert.equal(inserted,208);assert.equal((await observe(observer)).data.core.registry.count,214);report.fixtureHistoricalRegistryRows=214;report.fixturePrerequisiteDdlSources=6;
   await observer.query(`INSERT INTO public.faolla_redemption_checkouts(merchant_id,operator_id,operation_id,fingerprint,membership_id,request,status) VALUES('10909991','owner:synthetic','old-pending',$1,'synthetic-legacy-member','{}','pending')`,['a'.repeat(64)]);
  });
  let metadata,source;
  await check('one real read-only repeatable snapshot binds native target, 26 function definitions, 3 guards, catalog and full registry',async()=>{
   const db=await open();try{
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await db.query("SET LOCAL statement_timeout='5s';SET LOCAL lock_timeout='1s'");
    const contract=await loadCheckout047PreinstallContract(bundle),captured=await observeCheckout047Preinstall((sql,args)=>db.query(sql,args),contract,bundle,['127.0.0.1']);
    const inspected=inspectCheckout047Preinstall(contract,captured);assert.deepEqual(inspected.issues,[]);assert.equal(inspected.functions,26);assert.equal(inspected.triggers,3);
    metadata=captured.data;source=await nativeFullRegistrySource(metadata);assert.equal(source.before.sha256,captured.seal.sha256);
    await db.query('ROLLBACK');report.preinstall={functions:26,guards:3,registry:214,targetSha256:source.before.targetSha256,catalogSha256:source.before.catalogSha256,sourceDraftSha256:source.sourceDraft.digest};
   }finally{await close(db);}
  });
  const baselineBusiness=await business();
  const provision=()=>{
   const parent=fs.mkdtempSync(path.join(fs.realpathSync(tmpdir()),'faolla-checkout-evidence-test-full-native-'));fs.chmodSync(parent,0o700);
   const roots={dataRoot:path.join(parent,'data'),locatorRoot:path.join(parent,'locators')};for(const root of Object.values(roots))fs.mkdirSync(root,{mode:0o700});
   const inputPath=path.join(parent,'input.private.json'),bytes=JSON.stringify({version:1,metadata,sourceDraftSha256:source.sourceDraft.digest});fs.writeFileSync(inputPath,bytes,{flag:'wx',mode:0o600});
   const operationId=randomUUID(),store=openCheckoutEvidenceStorage(roots);try{beginCheckoutFullRegistryEvidence(store,{...source,operationId});}finally{store.close();}
   return {roots,operationId,inputPath,inputSha256:sha(bytes)};
  };
  const install=(operation,phase,options={})=>worker({...operation,action:'install',stage:'initial',phase},options);
  const recover=(operation,stage='prepared',options={})=>worker({...operation,action:'recover',stage,phase:'none'},options);
  const unchanged=async()=>{assert.equal((await readonly()).sha256,source.before.sha256);assert.deepEqual(await business(),baselineBusiness);};
  await check('actual catalog or registry drift refuses before the first DDL without repairing or refreshing the baseline',async()=>{
   const operation=provision(),hashes=fileHashes(operation.roots);
   for(const drift of ['role','registry']){
    if(drift==='role')await observer.query('ALTER ROLE authenticator CONNECTION LIMIT 7');
    else await observer.query("UPDATE public.faolla_schema_migrations SET name=name||'_owned_drift' WHERE version=$1",[bundle.material.prerequisites.registry[0].version]);
    try{const r=await install(operation,'normal',{refused:true});assert.equal(r.phase,'baseline');assert.equal(r.applied,0);assert.equal(r.commitDispatches,0);assert.deepEqual(fileHashes(operation.roots),hashes);}
    finally{if(drift==='role')await observer.query('ALTER ROLE authenticator CONNECTION LIMIT -1');else await observer.query('UPDATE public.faolla_schema_migrations SET name=$2 WHERE version=$1',[bundle.material.prerequisites.registry[0].version,bundle.material.prerequisites.registry[0].name]);}
    await unchanged();
   }
  });
  await check('a real error after 34 fixed DDL steps rolls back schema, roles and original rows while retaining initial evidence',async()=>{
   const operation=provision(),hashes=fileHashes(operation.roots),r=await install(operation,'after34',{refused:true});
   assert.equal(r.errorCode,'22012');assert.equal(r.applied,34);assert.equal(r.commitDispatches,0);assert.deepEqual(fileHashes(operation.roots),hashes);await unchanged();
  });
  await check('whole installer SIGKILL after prepared files and uncommitted receipt pair leaves native original uncommitted and forbids replay',async()=>{
   const operation=provision();await install(operation,'before-commit',{kill:true});const hashes=fileHashes(operation.roots);
   const recovered=await recover(operation);assert.equal(recovered.result.result.status,'not-committed-original');assert.equal(recovered.result.result.confirmationAppended,false);
   assert.equal(recovered.result.result.ddlReplayAllowed,false);assert.equal(recovered.result.mutationStatements,0);assert.deepEqual(fileHashes(operation.roots),hashes);await unchanged();
  });
  await check('separate planned installation commits all 38 steps and exactly two owned receipts with native 93/24/28 ACL validation',async()=>{
   completed=provision();const r=await install(completed,mode,{kill:mode==='commit-unknown'});
   assert.equal(r.applied,38);assert.equal(r.commitDispatches,1);if(mode==='normal'){assert.equal(r.result.receiptInsertions,2);assert.equal(r.result.confirmationAppended,false);}
   const current=await readonly();assert.equal(current.data.core.registry.count,216);assert.deepEqual(await business(),baselineBusiness);
   report.nativePostgresInstallationValidated=true;report.realDatabaseConnectionIdentityValidated=true;report.wholeInstallerInterrupted=true;
  });
  let confirmed,receiptPair;
  await check('new native read-only process confirms the original commit once; another process reopens exactly without writes',async()=>{
   const first=await recover(completed);confirmed=first.result.result;assert.equal(confirmed.status,'committed-original');assert.equal(confirmed.confirmationAppended,true);assert.equal(first.result.mutationStatements,0);
   assert.deepEqual(first.result.privileges,{functions:93,tables:24,guards:28,productionAuthorized:false,deploymentReady:false});
   const hashes=fileHashes(completed.roots),again=await recover(completed,'confirmed');assert.equal(again.result.result.alreadyConfirmed,true);assert.equal(again.result.result.confirmationAppended,false);assert.equal(again.result.result.locatorWire,confirmed.locatorWire);
   assert.notEqual(first.result.backendPid,again.result.backendPid);assert.deepEqual(fileHashes(completed.roots),hashes);
   const store=openCheckoutEvidenceStorage(completed.roots);try{const data=store.read(confirmed.locatorWire);receiptPair=checkoutFullRegistryOwnedReceipts(verifyCheckoutFullRegistryPrepared({...source,operationId:completed.operationId,preparedWire:data.artifacts.prepared,expectedSha256:confirmed.preparedSha256}));}finally{store.close();}
   report.installedContract=first.result.privileges;report.persistentFullRegistryEvidenceValidated=true;
  });
  await check('post-commit installation replay is refused before DDL and cannot duplicate registration or alter original evidence',async()=>{
   const hashes=fileHashes(completed.roots),current=await readonly(),r=await install(completed,'normal',{refused:true});assert.equal(r.applied,0);assert.equal(r.commitDispatches,0);assert.equal(r.phase,'baseline');
   assert.equal((await readonly()).sha256,current.sha256);assert.deepEqual(fileHashes(completed.roots),hashes);
  });
  await check('partial receipt pair and changed native catalog refuse independent recovery without repairing rows or writing new evidence',async()=>{
   const original=await readonly(),hashes=fileHashes(completed.roots),receipt=receiptPair[1];
   await observer.query('DELETE FROM public.faolla_schema_migrations WHERE version=$1 AND name=$2',[receipt.version,receipt.name]);
   try{const r=await recover(completed,'confirmed',{refused:true});assert.equal(r.applied,0);assert.equal(r.phase,'readonly-recovery');assert.equal((await readonly()).data.core.registry.count,215);assert.deepEqual(fileHashes(completed.roots),hashes);}
   finally{await observer.query('INSERT INTO public.faolla_schema_migrations(version,name) VALUES($1,$2)',[receipt.version,receipt.name]);}
   assert.equal((await readonly()).sha256,original.sha256);
   await observer.query('ALTER ROLE authenticator CONNECTION LIMIT 7');
   try{const r=await recover(completed,'confirmed',{refused:true});assert.equal(r.phase,'readonly-recovery');assert.equal((await observer.query("SELECT rolconnlimit FROM pg_roles WHERE rolname='authenticator'")).rows[0].rolconnlimit,7);assert.deepEqual(fileHashes(completed.roots),hashes);}
   finally{await observer.query('ALTER ROLE authenticator CONNECTION LIMIT -1');}
   assert.equal((await readonly()).sha256,original.sha256);
  });
  await check('missing prepared bytes or independent locator refuse before connecting and never regenerate lost evidence',async()=>{
   for(const file of [path.join(completed.roots.dataRoot,completed.operationId,'prepared.json'),path.join(completed.roots.locatorRoot,completed.operationId+'.prepared.json')]){
    const retained=file+'.retained';fs.renameSync(file,retained);
    try{const hashes=fileHashes(completed.roots),r=await recover(completed,'confirmed',{refused:true});assert.equal(r.opened,0);assert.equal(r.queries,0);assert.equal(fs.existsSync(file),false);assert.deepEqual(fileHashes(completed.roots),hashes);}finally{fs.renameSync(retained,file);}
   }
  });
  await check('unsafe mode and changed private input refuse without mode repair or database access',async()=>{
   const prepared=path.join(completed.roots.dataRoot,completed.operationId,'prepared.json');fs.chmodSync(prepared,0o644);
   try{const hashes=fileHashes(completed.roots),r=await recover(completed,'confirmed',{refused:true});assert.equal(r.opened,0);assert.equal(fs.lstatSync(prepared).mode&0o7777,0o644);assert.deepEqual(fileHashes(completed.roots),hashes);}finally{fs.chmodSync(prepared,0o600);}
   const r=await worker({...completed,inputSha256:'0'.repeat(64),action:'recover',phase:'none',stage:'confirmed'},{refused:true});assert.equal(r.phase,'guard');assert.equal(r.opened,0);assert.equal(r.queries,0);
  });
  await check('all creation gates remain closed after installation and original synthetic pending cashier is retained',async()=>{
   for(const table of ['bundle_pilots','intent_pilots'])assert.equal((await observer.query(`SELECT count(*)::int n FROM faolla_checkout_design.${table}`)).rows[0].n,0);
   assert.deepEqual(await business(),baselineBusiness);assert.equal((await readonly()).data.core.registry.count,216);
  });
  const {createOwnedCheckoutData}=await import('./fixtures/member-checkout-real-auth-database.mjs');
  const {nativeCheckoutFinancialExports}=await import('./member-checkout-full-registry-installation-imports.mjs');
  const {submission,points}=nativeCheckoutFinancialExports(await import('../src/lib/merchantCheckoutSubmission.server.ts'),await import('../src/lib/merchantCheckoutSubmissionPlan.server.ts'));
  const runtimeCall=async(name,args)=>{const db=await open();try{await db.query('BEGIN');await db.query('SET LOCAL SESSION AUTHORIZATION faolla_checkout_runtime');const result=(await db.query('SELECT public.faolla_checkout_runtime_v1($1,$2) result',[name,args])).rows[0].result;await db.query('COMMIT');return result;}catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}finally{await close(db);}};
  const financial=await createOwnedCheckoutData(observer,runtimeCall),f=await financial.seed(randomUUID()),rpc=async(name,args)=>{try{return {data:await runtimeCall(name,args),error:null};}catch(error){return {data:null,error:{message:error.message}};}};
  const initial={...f.selection,method:'points',nonce:randomUUID(),confirmationHash:'0'.repeat(64),customer:f.customer},identity=points.checkoutSubmissionIdentity(initial,f.principal);
  const snapshot=await runtimeCall('faolla_member_checkout_submission_snapshot_v2',{p_site_id:financial.site,p_operation_key:identity.operationKey,p_principal_key:identity.principalKey,p_request_hash:identity.requestHash,p_offer_id:f.offer.id});
  const quote=await points.quoteCheckoutSubmissionSnapshot(points.parseCheckoutSubmissionSnapshot(snapshot.snapshot,identity),identity,f.principal),request={...initial,confirmationHash:quote.confirmationHash},submit=value=>submission.submitMemberCheckout({request:value,principal:f.principal,authorize:async()=>f.principal},rpc);
  await check('same recovered native installation executes a points-coupon booking once and original replay does not debit twice',async()=>{
   const result=await submit(request);assert.equal(result.replayed,false);assert.equal(result.result.totalPoints,80);assert.equal((await financial.page(`__merchant_memberships__:${financial.site}`)).blocks[0].pointBalance,920);
   const current=await financial.state();assert.equal((await submit(request)).replayed,true);assert.deepEqual(await financial.state(),current);assert.equal((await observer.query("SELECT count(*)::int n FROM faolla_checkout_design.redemption_047_audits WHERE phase='payment'")).rows[0].n,1);
  });
  await check('closing new creation retains paid original, original pending cashier and independent committed installation confirmation',async()=>{
   await observer.query('UPDATE faolla_checkout_design.bundle_pilots SET enabled=false WHERE site_id=$1',[financial.site]);const current=await financial.state();
   assert.equal((await submit(request)).replayed,true);await assert.rejects(submit({...request,nonce:randomUUID()}),/checkout_disabled/);assert.deepEqual(await financial.state(),current);assert.deepEqual((await business()).pending,baselineBusiness.pending);
   const r=await recover(completed,'confirmed');assert.equal(r.result.result.alreadyConfirmed,true);assert.equal(r.result.result.locatorWire,confirmed.locatorWire);
  });
  report.passed=true;
 }catch(error){report.failure=safeError(error);throw error;}
 finally{
  let failures=0;
  for(const child of children)try{const exited=new Promise(resolve=>child.once('exit',resolve));if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}}catch{failures++;}children.clear();
  for(const db of [...clients])try{await close(db);}catch{failures++;}
  report.openedConnections=opened;report.closedConnections=closed;report.remainingConnections=clients.size;report.remainingChildren=children.size;report.cleanupFailures=failures;
  report.cleanupPassed=opened===closed&&clients.size===0&&failures===0;report.passed=report.passed&&report.cleanupPassed&&report.failure===null;
  fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});assert.equal(report.cleanupPassed,true);
 }
});
