import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {ownedActiveReconciliationScope,loadOwnedActiveReconciliationCase,createOwnedActiveReconciliationCases,ownedActiveReconciliationBoundary,activeReconciliationCaseLocation,ACTIVE_LAB_CASES} from './release-toolchain-active-generation-owned-lab.mjs';
import {runOwnedActiveReconciliationCase,verifyOwnedActiveReconciliationClosure} from './release-toolchain-active-generation-reconciliation.mjs';
import {ownedActiveReconciliationHeldChecker,archiveOwnedActiveReconciliationOperation,releaseOwnedActiveReconciliationOperation} from './online-release-retention-writer.mjs';
test('serialized green resources, held locks, closures and incident IDs cannot grant owned or formal authority',async()=>{
 const fake={kind:'owned-active-reconciliation-capability',verified:true,deployFd:3,directory:'/root/.pm2',publicationAuthority:true};
 assert.throws(()=>ownedActiveReconciliationScope(fake));assert.throws(()=>ownedActiveReconciliationHeldChecker(fake,fake));
 await assert.rejects(runOwnedActiveReconciliationCase(fake));await assert.rejects(verifyOwnedActiveReconciliationClosure(fake,fake));await assert.rejects(archiveOwnedActiveReconciliationOperation(fake,fake));await assert.rejects(releaseOwnedActiveReconciliationOperation(fake,fake));assert.throws(()=>ownedActiveReconciliationBoundary(fake,'after-save'));
});
test('owned capability cannot be reconstructed on an ordinary local or production invocation',async()=>{
 if(process.platform!=='linux'||process.getuid?.()!==0||process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||process.env.FAOLLA_RELEASE_PRODUCTION_EQ!=='1'){
  assert.throws(()=>loadOwnedActiveReconciliationCase('/var/lib/faolla-active-reconciliation-ci-fixture/normal'));await assert.rejects(createOwnedActiveReconciliationCases('/var/lib/faolla-eq-fixture'));
 }
});
test('case configuration always includes the derived root, including on Windows hosts, without conferring a capability',()=>{
 const directory='/var/lib/faolla-active-reconciliation-ci-test123/normal',value=activeReconciliationCaseLocation(directory);
 assert.deepEqual(value,{root:'/var/lib/faolla-active-reconciliation-ci-test123',directory});assert.ok(Object.isFrozen(value));assert.throws(()=>ownedActiveReconciliationScope(value));
 for(const value of [undefined,null,{},'/root/.pm2','/var/lib/faolla-active-reconciliation-ci-test123/../normal',directory+'/'])assert.throws(()=>activeReconciliationCaseLocation(value));
 const text=readFileSync(new URL('./release-toolchain-active-generation-owned-lab.mjs',import.meta.url),'utf8');assert.ok(text.includes('const s={...owner,...location,rootIdentity'));
});
test('complete owned acceptance is mandatory inside the real Next PM2 test and retains reports',()=>{
 const runner=readFileSync(new URL('./release-toolchain-pm2-real-acceptance.mjs',import.meta.url),'utf8'),workflow=readFileSync(new URL('../.github/workflows/release-toolchain.yml',import.meta.url),'utf8');
 assert.ok(runner.includes("await acceptOwnedActiveReconciliation(root)"));assert.ok(runner.indexOf('await acceptOwnedActiveReconciliation(root)')<runner.indexOf('passed=true'));
 assert.ok(workflow.includes('release-toolchain-active-reconciliation-evidence.tar'));assert.deepEqual(ACTIVE_LAB_CASES,['normal','after-metadata','after-save','after-archive','controller-death-after-metadata','controller-death-after-save','controller-death-after-archive']);
});
test('owned acceptance shares the real physical engines without a formal CLI or production fake receipt',()=>{
 const text=readFileSync(new URL('./release-toolchain-active-generation-reconciliation.mjs',import.meta.url),'utf8');
 for(const token of ['executeActiveBookingReconciliation','preserveOwnedActiveReconciliationEvidence(capability,lock,window)','correctOwnedActiveReconciliationMetadata(capability,lock,window)','persistOwnedActiveReconciliationProcesses(capability,lock,window)','archiveOwnedActiveReconciliationOperation(capability,lock)','releaseOwnedActiveReconciliationOperation(capability,lock)','verifyPm2Dump(daemon,boot,registry,persisted.receipt)','formalPublicationAccepted:false','formalIncidentClosed:false','attempt_replay_forbidden'])assert.ok(text.includes(token),token);
 assert.doesNotMatch(text,/reconcileActiveBookingIncidentUnderHeldLocks|guardedProductionBookingActivationSql|pauseOriginalOnce|enableBookingWorker|--allow|force/);
});
test('separate entry finishes module evaluation before a dynamic self import; the old inline topology exits 13',()=>{
 const fixture=new URL('./test-support/release-toolchain-self-import-fixture.mjs',import.meta.url),old=spawnSync(process.execPath,[fileURLToPath(fixture),'--old-inline-entry'],{encoding:'utf8',timeout:5000,maxBuffer:65536,windowsHide:true});
 assert.equal(old.error,undefined);assert.equal(old.signal,null);assert.equal(old.status,13);
 const fixed=spawnSync(process.execPath,['--input-type=module','--eval',`const engine=await import(${JSON.stringify(fixture.href)});if(await engine.verifySelfImportAfterEvaluation()!=='fully-evaluated')throw Error('not_ready');`],{encoding:'utf8',timeout:5000,maxBuffer:65536,windowsHide:true});
 assert.equal(fixed.error,undefined);assert.equal(fixed.signal,null);assert.equal(fixed.status,0,fixed.stderr);
 const engine=readFileSync(new URL('./release-toolchain-active-generation-reconciliation.mjs',import.meta.url),'utf8'),entry=readFileSync(new URL('./release-toolchain-active-generation-reconciliation-case.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(engine,/await runOwnedActiveReconciliationCase\(loadOwned/);assert.ok(engine.includes("[CHILD,s.directory]"));assert.ok(entry.includes("import {runOwnedActiveReconciliationCase}"));
});
