// Only the owning disposable-CI parent can request one fixed operation or kill
// this WHOLE installer. No production CLI, arbitrary SQL, DSN or resume command.
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {assertFullRegistryInstallationCi,assertFullRegistryInstallationRequest,readFullRegistryInstallationInput} from './member-checkout-full-registry-installation-support.mjs';
import {database,databasePort} from './member-checkout-real-auth-support.mjs';

export async function runFullRegistryNativeWorker(request,progress={phase:'guard',applied:0,queries:0,opened:0,closed:0,commitDispatches:0}){
 assertFullRegistryInstallationRequest(request);assert.ok(process.send&&process.connected);assert.ok(process.getuid()>0);
 const input=readFullRegistryInstallationInput(request);progress.phase='source';
 const {nativeFullRegistrySource}=await import('./fixtures/member-checkout-full-registry-native-source.mjs');
 const {sourceDraft,bundle,before}=await nativeFullRegistrySource(input.metadata);assert.equal(sourceDraft.digest,input.sourceDraftSha256);
 const {openCheckoutEvidenceStorage}=await import('./member-checkout-evidence-storage.mjs');
 const {reopenCheckoutFullRegistryEvidence,appendCheckoutFullRegistryPrepared,confirmCheckoutFullRegistryEvidence}=await import('./member-checkout-full-registry-evidence.mjs');
 const {observeCheckout047Installation,assertCheckout047InstallationObservation}=await import('./member-checkout-047-installation.mjs');
 const {prepareCheckoutFullRegistryResult,checkoutFullRegistryOwnedReceipts}=await import('./member-checkout-full-registry-result.mjs');
 const {assertCheckout047InstalledPrivileges}=await import('./member-checkout-047-installation-privileges.mjs');
 const {assertOwnedLifecycleTarget}=await import('./member-checkout-runtime-lifecycle-cases.mjs');
 const store=openCheckoutEvidenceStorage(request.roots);let db;
 try{
  progress.phase='evidence';
  const locator=store.locate(request.operationId,request.stage),context=await reopenCheckoutFullRegistryEvidence(store,locator,{sourceDraft,bundle});
  assert.equal(context.before.sha256,before.sha256);
  // Missing or unsafe private evidence is rejected BEFORE opening a connection.
  progress.phase='connect';
  const require=createRequire(path.join(process.env.RUNNER_TEMP,'faolla-full-native-tools/pg-client/package.json'));
  assert.equal(require('pg/package.json').version,'8.23.1');const {Client}=require('pg');
  db=new Client({host:'127.0.0.1',port:databasePort,database,user:'checkout_ci_admin',password:'disposable-checkout-ci-only',ssl:false,
   connectionTimeoutMillis:5000,query_timeout:20000,statement_timeout:15000,application_name:'checkout-ci-full-registry-native-worker'});
  assertOwnedLifecycleTarget(db);await db.connect();progress.opened++;
  const query=async(sql,args)=>{progress.queries++;return db.query(sql,args);};
  assert.deepEqual((await query(`SELECT current_database() db,CURRENT_USER::text actor,(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) owner,current_setting('server_version_num') version`)).rows[0],
   {db:database,actor:'checkout_ci_admin',owner:'checkout_ci_admin',version:'150008'});
  const backendPid=(await query('SELECT pg_backend_pid() pid')).rows[0].pid;
  const checkpoint=async phase=>{
   progress.phase=phase;
   await new Promise((resolve,reject)=>process.send({kind:'full-native-checkpoint',operationId:request.operationId,pid:process.pid,backendPid,...progress},e=>e?reject(e):resolve()));
   // Intentional test interruption: no continuation or automatic retry exists.
   await new Promise(()=>{});
  };
  if(request.action==='recover'){
   progress.phase='readonly-recovery';
   await query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await query("SET LOCAL lock_timeout='1s';SET LOCAL statement_timeout='5s';SET LOCAL search_path=pg_catalog,public");
   const current=await observeCheckout047Installation(query,bundle);
   const privileges=current.data.core.registry.count===216?await assertCheckout047InstalledPrivileges(query,bundle):null;
   const result=confirmCheckoutFullRegistryEvidence(context,current);await query('ROLLBACK');
   return {result,backendPid,registryCount:current.data.core.registry.count,metadataSha256:current.sha256,privileges,mutationStatements:0};
  }
  progress.phase='baseline';
  await query('BEGIN ISOLATION LEVEL REPEATABLE READ READ WRITE');
  await query("SET LOCAL lock_timeout='1s';SET LOCAL statement_timeout='15s';SET LOCAL search_path=pg_catalog,public;SET LOCAL standard_conforming_strings=on");
  assert.equal((await query('SELECT pg_try_advisory_xact_lock(20261125,6064) locked')).rows[0].locked,true);
  assertCheckout047InstallationObservation(before,await observeCheckout047Installation(query,bundle));
  assert.equal((await query("SELECT count(*)::int n FROM pg_roles WHERE rolname IN ('faolla_checkout_runtime','faolla_checkout_executor')")).rows[0].n,0);
  progress.phase='ddl';
  for(const step of bundle.material.steps){await query(step.body);progress.applied++;if(request.phase==='after34'&&progress.applied===34)await query('SELECT 1/0');}
  assert.equal(progress.applied,38);progress.phase='privileges';
  const privileges=await assertCheckout047InstalledPrivileges(query,bundle);
  progress.phase='prepare';
  const after=await observeCheckout047Installation(query,bundle),prepared=prepareCheckoutFullRegistryResult({sourceDraft,bundle,before,after,operationId:request.operationId});
  const preparedLocator=appendCheckoutFullRegistryPrepared(context,prepared);assert.equal(store.read(preparedLocator).artifacts.prepared,prepared.wire);
  const receipts=checkoutFullRegistryOwnedReceipts(prepared);assert.equal(receipts.length,2);progress.phase='receipts';
  await query('INSERT INTO public.faolla_schema_migrations(version,name) VALUES($1,$2),($3,$4)',[receipts[0].version,receipts[0].name,receipts[1].version,receipts[1].name]);
  if(request.phase==='before-commit')await checkpoint('before-commit');
  progress.phase='commit';progress.commitDispatches++;
  if(request.phase==='commit-unknown'){
   await assert.rejects(query('COMMIT; SELECT 1/0'),error=>error.code==='22012');
   await checkpoint('commit-unknown');
  }
  await query('COMMIT');
  return {backendPid,privileges,preparedSha256:prepared.digest,preparedLocator,receiptInsertions:2,confirmationAppended:false};
 }catch(error){if(db&&progress.opened)await db.query('ROLLBACK').catch(()=>{});throw error;}
 finally{try{if(db){await db.end();if(progress.opened)progress.closed++;}}finally{store.close();}}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{assertFullRegistryInstallationCi();assert.ok(process.send&&process.connected);assert.ok(process.getuid()>0);}catch{process.exit(71);}
 let finished=false;process.once('disconnect',()=>{if(!finished)process.exit(72);});setTimeout(()=>process.exit(73),60000).unref();
 let used=false;process.on('message',async request=>{if(used)return;used=true;
  const progress={phase:'guard',applied:0,queries:0,opened:0,closed:0,commitDispatches:0};
  let reply;
  try{reply={kind:'full-native-complete',result:await runFullRegistryNativeWorker(request,progress),...progress};}
  catch(error){reply={kind:'full-native-refused',...progress,errorCode:/^[0-9A-Z]{5}$/.test(error?.code??'')?error.code:'REFUSED'};process.exitCode=1;}
  process.send(reply,error=>{if(error){process.exit(74);return;}finished=true;process.disconnect();});
 });
}
