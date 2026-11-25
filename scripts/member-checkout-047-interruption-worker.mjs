// The ENTIRE installer below is killed by its owning test parent. No formal CLI.
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {assertCheckout047InterruptionCi,assertCheckout047InterruptionRequest} from './member-checkout-047-interruption-support.mjs';
import {database,databasePort,safeError} from './member-checkout-real-auth-support.mjs';
import {assertOwnedLifecycleTarget} from './member-checkout-runtime-lifecycle-cases.mjs';
import {openCheckoutEvidenceStorage} from './member-checkout-evidence-storage.mjs';
import {reopenCheckout047Evidence,appendCheckout047Prepared} from './member-checkout-047-evidence.mjs';
import {observeCheckout047Installation,assertCheckout047InstallationObservation,prepareCheckout047InstallationSeal,verifyCheckout047InstallationSeal,
 source047RegistryVersion,seal047RegistryVersion,checkout047SealRegistryName} from './member-checkout-047-installation.mjs';
import {assertCheckout047InstalledPrivileges} from './member-checkout-047-installation-privileges.mjs';

export async function runOwnedCheckout047InterruptedInstall(input){
 const {roots,operationId,phase}=assertCheckout047InterruptionRequest(input);assert.ok(process.send&&process.connected);
 const store=openCheckoutEvidenceStorage(roots);let db;
 try{
  const initial=store.locate(operationId,'initial'),context=await reopenCheckout047Evidence(store,initial),{bundle,before}=context;
  const {Client}=createRequire(path.join(process.env.RUNNER_TEMP,'faolla-install-tools/pg-client/package.json'))('pg');
  db=new Client({host:'127.0.0.1',port:databasePort,database,user:'checkout_ci_admin',password:'disposable-checkout-ci-only',ssl:false,
   connectionTimeoutMillis:5000,query_timeout:20000,statement_timeout:15000,application_name:'checkout-ci-installation-047-interruption'});
  assertOwnedLifecycleTarget(db);await db.connect();
  assert.deepEqual((await db.query(`SELECT current_database() db,CURRENT_USER::text actor,(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) owner,current_setting('server_version_num') version`)).rows[0],
   {db:database,actor:'checkout_ci_admin',owner:'checkout_ci_admin',version:'150008'});
  const backendPid=(await db.query('SELECT pg_backend_pid() pid')).rows[0].pid;
  const checkpoint=async point=>{
   if(phase!==point)return;
   await new Promise((resolve,reject)=>process.send({kind:'owned-047-installation-checkpoint',phase:point,operationId,pid:process.pid,backendPid,applied:38},error=>error?reject(error):resolve()));
   // No continuation command exists. Only this child's owner may kill it.
   await new Promise(()=>{});
  };
  await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='1s';SET LOCAL statement_timeout='15s';SET LOCAL search_path=pg_catalog,public;SET LOCAL standard_conforming_strings=on");
  assert.equal((await db.query('SELECT pg_try_advisory_xact_lock(20261125,6064) locked')).rows[0].locked,true);
  const observed=await observeCheckout047Installation((sql,args)=>db.query(sql,args),bundle);assertCheckout047InstallationObservation(before,observed);
  assert.deepEqual((await db.query('SELECT version::text version,name FROM public.faolla_schema_migrations ORDER BY version')).rows,bundle.material.prerequisites.registry);
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_roles WHERE rolname IN ('faolla_checkout_runtime','faolla_checkout_executor')")).rows[0].n,0);
  for(const step of bundle.material.steps)await db.query(step.body);
  await assertCheckout047InstalledPrivileges((sql,args)=>db.query(sql,args),bundle);await checkpoint('after-ddl');
  const seal=prepareCheckout047InstallationSeal(before,await observeCheckout047Installation((sql,args)=>db.query(sql,args),bundle),bundle);
  const locator=appendCheckout047Prepared(context,seal);assert.equal(store.read(locator).artifacts.prepared,seal.wire);await checkpoint('after-prepared');
  await db.query('INSERT INTO public.faolla_schema_migrations(version,name) VALUES($1,$2),($3,$4)',[source047RegistryVersion,bundle.receipt.name,seal047RegistryVersion,checkout047SealRegistryName(seal.digest)]);
  verifyCheckout047InstallationSeal(seal.wire,{expectedSha256:seal.digest,before,current:await observeCheckout047Installation((sql,args)=>db.query(sql,args),bundle),bundle});await checkpoint('before-commit');
  await db.query('COMMIT');await checkpoint('after-commit');throw Error('owned_047_checkpoint_missing');
 }finally{try{await db?.end();}finally{store.close();}}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{assertCheckout047InterruptionCi();assert.ok(process.send&&process.connected);}catch{process.exit(71);}
 process.once('disconnect',()=>process.exit(72));setTimeout(()=>process.exit(73),45000).unref();
 let used=false;process.on('message',async message=>{if(used)return;used=true;
  try{await runOwnedCheckout047InterruptedInstall(message);}catch(error){process.send?.({kind:'owned-047-installation-failed',error:safeError(error)},()=>{process.disconnect();process.exitCode=1;});}
 });
}
