// Fresh owned Linux CI files + an embedded SQL registry. Not native PG 15.8,
// complete 38-step installation, production storage or a real gateway test.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fork} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {assertIsolatedCi} from './member-checkout-real-auth-support.mjs';

test('owned full-registry durable files, worker interruption and SQL receipt reconciliation',{timeout:300000},async t=>{
 const owned=assertIsolatedCi();assert.equal(owned.profileName,'current-auth');assert.equal(process.env.FAOLLA_CHECKOUT_FULL_REGISTRY_EVIDENCE_ACCEPTANCE,'1');
 const {PGlite}=await import('@electric-sql/pglite');
 const {ownedFullRegistryEvidenceFixture}=await import('./fixtures/member-checkout-full-registry-evidence-fixture.mjs');
 const {openCheckoutEvidenceStorage}=await import('./member-checkout-evidence-storage.mjs');
 const fixture=await ownedFullRegistryEvidenceFixture(),parent=fs.mkdtempSync(path.join(fs.realpathSync(tmpdir()),'faolla-checkout-evidence-test-full-registry-'));
 fs.chmodSync(parent,0o700);const roots={dataRoot:path.join(parent,'data'),locatorRoot:path.join(parent,'locators')};for(const root of Object.values(roots))fs.mkdirSync(root,{mode:0o700});
 const evidence=path.join(process.env.RUNNER_TEMP,'faolla-full-registry-file-evidence');fs.mkdirSync(evidence,{mode:0o700});
 const report={version:1,commit:process.env.GITHUB_SHA,scope:'owned-linux-files-and-embedded-registry-not-production',checks:[],workers:[],passed:false,cleanupPassed:false,
  nativePrivateFileOperations:true,registryEngine:'PGlite',nativePostgresInstallationValidated:false,wholeInstallerInterrupted:false,realDatabaseConnectionIdentityValidated:false,
  fullProductionGatewayValidated:false,persistentProductionStorageValidated:false,hostBackupRestoreValidated:false,powerLossValidated:false,productionReadPerformed:false,
  productionAuthorized:false,deploymentReady:false,stripeEnabled:false};
 const db=new PGlite(),children=new Set();let inserts=0;
 const sha=value=>createHash('sha256').update(value).digest('hex');
 const fileHashes=()=>{const files={};for(const name of fs.readdirSync(roots.dataRoot))for(const leaf of fs.readdirSync(path.join(roots.dataRoot,name)))files[name+'/'+leaf]=sha(fs.readFileSync(path.join(roots.dataRoot,name,leaf)));for(const name of fs.readdirSync(roots.locatorRoot))files['locators/'+name]=sha(fs.readFileSync(path.join(roots.locatorRoot,name)));return files;};
 const check=async(name,fn)=>{let passed=false;await t.test(name,async()=>{await fn();passed=true;});report.checks.push({name,passed});assert.equal(passed,true,'owned_full_registry_stage_failed');};
 async function worker(request,killAfterReady=false,expectRefusal=false){
  const child=fork(new URL('./fixtures/member-checkout-full-registry-evidence-worker.mjs',import.meta.url),[JSON.stringify({...request,roots,hold:killAfterReady})],{stdio:['ignore','pipe','pipe','ipc'],execArgv:[]});children.add(child);
  let reply,stdout='',stderr='',forced=false;
  child.stdout.on('data',b=>{stdout+=b;if(stdout.length>65536)child.kill('SIGKILL');});child.stderr.on('data',b=>{stderr+=b;if(stderr.length>65536)child.kill('SIGKILL');});
  const timer=setTimeout(()=>{forced=true;child.kill('SIGKILL');},60000);
  child.on('message',m=>{reply=m;if(killAfterReady&&m.kind==='owned-full-registry-file-worker-complete')child.kill('SIGKILL');});
  const ended=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));}).finally(()=>{clearTimeout(timer);children.delete(child);});
  report.workers.push({...ended,forced,stdoutBytes:Buffer.byteLength(stdout),stderrBytes:Buffer.byteLength(stderr),expectedKill:killAfterReady,expectedRefusal:expectRefusal});
  assert.equal(forced,false);assert.equal(stdout,'');assert.equal(stderr,'');
  if(expectRefusal){assert.equal(ended.code,1);assert.equal(ended.signal,null);assert.equal(reply?.kind,'owned-full-registry-file-worker-refused');return;}
  assert.equal(reply?.kind,'owned-full-registry-file-worker-complete');
  if(killAfterReady){assert.equal(ended.code,null);assert.equal(ended.signal,'SIGKILL');}else{assert.equal(ended.code,0);assert.equal(ended.signal,null);}
  return reply.result;
 }
 async function currentRaw(prepared,committed){
  const raw=fixture.currentRaw(prepared,committed,110),{rows}=await db.query('SELECT version,name FROM owned_migrations ORDER BY version');
  raw.core.registry={count:rows.length,entries:rows.map(({version,name})=>({version,nameSha256:sha(name)}))};return raw;
 }
 let prepared,operationId=randomUUID(),ready,committedRaw;
 try{
  await db.exec('CREATE TABLE owned_migrations(version text PRIMARY KEY,name text NOT NULL)');
  for(const r of fixture.originalRegistry)await db.query('INSERT INTO owned_migrations VALUES($1,$2)',[r.version,r.name]);
  await check('prepared bytes and independent locator survive intentional worker SIGKILL after durable writes',async()=>{
   ready=await worker({action:'prepare',operationId},true);assert.equal(ready.stage,'prepared');
   const store=openCheckoutEvidenceStorage(roots);try{
    const locator=store.locate(operationId,'prepared');assert.equal(sha(locator),ready.locatorSha256);
    const data=store.read(locator);assert.equal(data.locator.binding.sourceBundleSha256,fixture.sourceDraft.digest);assert.equal(data.locator.artifacts.length,3);
    const {verifyCheckoutFullRegistryPrepared}=await import('./member-checkout-full-registry-result.mjs');
    prepared=verifyCheckoutFullRegistryPrepared({...fixture,operationId,preparedWire:data.artifacts.prepared,expectedSha256:ready.preparedSha256});
   }finally{store.close();}
   for(const leaf of ['source.json','baseline.json','prepared.json']){const s=fs.lstatSync(path.join(roots.dataRoot,operationId,leaf));assert.equal(s.mode&0o7777,0o600);assert.equal(s.nlink,1);}
  });
  await check('independent reopened worker reports original uncommitted registry without writing confirmation or replaying SQL',async()=>{
   const hashes=fileHashes(),r=await worker({action:'reconcile',stage:'prepared',operationId,currentRaw:await currentRaw(prepared,false)});
   assert.equal(r.status,'not-committed-original');assert.equal(r.confirmationAppended,false);assert.equal(r.ddlReplayAllowed,false);assert.equal(r.databaseStatementsExecuted,0);assert.deepEqual(fileHashes(),hashes);
  });
  await check('both receipts commit atomically in the owned SQL engine, then native confirmation survives worker SIGKILL',async()=>{
   await db.exec('BEGIN');for(const r of ready.receipts){await db.query('INSERT INTO owned_migrations VALUES($1,$2)',[r.version,r.name]);inserts++;}await db.exec('COMMIT');
   committedRaw=await currentRaw(prepared,true);const r=await worker({action:'reconcile',stage:'prepared',operationId,currentRaw:committedRaw},true);
   assert.equal(r.status,'committed-original');assert.equal(r.confirmationAppended,true);assert.equal(r.preparedSha256,ready.preparedSha256);assert.equal(inserts,2);
  });
  await check('new worker reopens the exact independent confirmation and performs no new file writes or receipt inserts',async()=>{
   const hashes=fileHashes(),r=await worker({action:'reconcile',stage:'confirmed',operationId,currentRaw:committedRaw});
   assert.equal(r.alreadyConfirmed,true);assert.equal(r.confirmationAppended,false);assert.equal(r.databaseStatementsExecuted,0);assert.deepEqual(fileHashes(),hashes);assert.equal(inserts,2);
  });
  await check('partial receipt pair, changed catalogue and post-confirmation rollback all refuse without new evidence writes',async()=>{
   for(const change of [r=>{r.core.registry.entries.pop();r.core.registry.count--;},r=>r.core.schemas.push({name:'unexpected'}),r=>{r.core.registry=structuredClone(fixture.before.data.core.registry);r.core.schemas=structuredClone(fixture.before.data.core.schemas);}]){
    const raw=structuredClone(committedRaw);change(raw);const hashes=fileHashes();await worker({action:'reconcile',stage:'confirmed',operationId,currentRaw:raw},false,true);assert.deepEqual(fileHashes(),hashes);
   }
  });
  await check('missing prepared file and independent locator refuse, preserving originals under retained names rather than recreating them',async()=>{
   for(const file of [path.join(roots.dataRoot,operationId,'prepared.json'),path.join(roots.locatorRoot,operationId+'.prepared.json')]){
    assert.ok(path.resolve(file).startsWith(parent+path.sep));const retained=file+'.retained';fs.renameSync(file,retained);
    try{const hashes=fileHashes();await worker({action:'reconcile',stage:'confirmed',operationId,currentRaw:committedRaw},false,true);assert.equal(fs.existsSync(file),false);assert.deepEqual(fileHashes(),hashes);}finally{fs.renameSync(retained,file);}
   }
  });
  await check('unsafe file permissions refuse without repairing modes or replacing the prepared result',async()=>{
   const file=path.join(roots.dataRoot,operationId,'prepared.json');fs.chmodSync(file,0o644);
   try{const hashes=fileHashes();await worker({action:'reconcile',stage:'confirmed',operationId,currentRaw:committedRaw},false,true);assert.equal(fs.lstatSync(file).mode&0o7777,0o644);assert.deepEqual(fileHashes(),hashes);}finally{fs.chmodSync(file,0o600);}
  });
  report.receiptInsertions=inserts;report.registryCount=(await db.query('SELECT count(*)::int n FROM owned_migrations')).rows[0].n;assert.equal(report.registryCount,216);report.passed=true;
 }finally{
  for(const child of children)child.kill('SIGKILL');await db.close();report.cleanupPassed=children.size===0&&db.closed===true;
  fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 }
 assert.equal(report.cleanupPassed,true);
});
