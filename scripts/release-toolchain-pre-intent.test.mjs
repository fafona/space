import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{spawnSync}from'node:child_process';import{fileURLToPath}from'node:url';
import pins,{PRE_INTENT as H,PRE_INTENT_FILES}from'./release-toolchain-pre-intent-pins.mjs';
import{preIntentInstallGitPlan,preIntentObserverUrl,retainedBookingSourceUrl}from'./release-toolchain-pre-intent-install.mjs';
import{closePreIntentAbort}from'./release-toolchain-pre-intent-closure.mjs';
import{withPreIntentAbortPreparationLocks,archivePreIntentAbortOperation,releasePreIntentAbortOperation,preIntentAbortLockProfile,preIntentAbortArchiveWitness,acceptPreIntentAbortClosureInCi}from'./online-release-retention-writer.mjs';
import{preIntentHistoricalBinding}from'./release-toolchain-pre-intent-profile.mjs';
import{PRE_ROUTE,assertQualificationForClosedSource}from'./release-toolchain-pre-route-contract.mjs';
import{executePreIntentQualificationAndClose,ensurePinnedPreIntentReconciledBeforePublication}from'./release-toolchain-pre-intent-orchestrator.mjs';
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
test('single canonical orchestration uses separate qualification/closure windows and never proceeds after a failed stage',async()=>{
 for(const failure of['qualifyOrVerifyExisting','closeWithNewWindow','auditReleasedClosure',null]){
  const seen=[],receipt={kind:'synthetic-closed'},operations={};for(const name of['qualifyOrVerifyExisting','closeWithNewWindow','auditReleasedClosure'])operations[name]=()=>{seen.push(name);if(name===failure)throw Error('fixed-refusal');return receipt;};
  if(failure)await assert.rejects(executePreIntentQualificationAndClose(operations),{message:'fixed-refusal'});else assert.equal(await executePreIntentQualificationAndClose(operations),receipt);
  const names=['qualifyOrVerifyExisting','closeWithNewWindow','auditReleasedClosure'];assert.deepEqual(seen,failure?names.slice(0,names.indexOf(failure)+1):names);
 }
 await assert.rejects(ensurePinnedPreIntentReconciledBeforePublication('a'.repeat(40)));
 const source=read('./release-toolchain-pre-intent-orchestrator.mjs');assert.ok(source.includes('fs.existsSync(root)?verifyLatestActiveBookingQualification'));assert.equal((source.match(/withPreIntentAbortPreparationLocks\(\{toolRevision\}/g)??[]).length,2);assert.doesNotMatch(source,/set.*deadlineAt|automaticRetryAllowed:true|force|skipChecks/);
});
test('foreign JSON cannot acquire the new pinned scope or archive/release its operation',async()=>{
 const options={lock:{deployFd:3,operationDirectory:pins.operation.directory},toolRevision:'a'.repeat(40),window:{id:'fake'}};
 for(const action of[closePreIntentAbort,archivePreIntentAbortOperation,releasePreIntentAbortOperation])await assert.rejects(action(options));
 assert.throws(()=>preIntentAbortLockProfile(options.lock));assert.throws(()=>preIntentAbortArchiveWitness(options.lock));await assert.rejects(withPreIntentAbortPreparationLocks({toolRevision:options.toolRevision},()=>assert.fail('work entered')));await assert.rejects(acceptPreIntentAbortClosureInCi());
});
test('new bootstrap uses complete checkout and original 8607 physical readers, no application/ref/process mutations',()=>{
 const revision='a'.repeat(40),plan=preIntentInstallGitPlan(revision),source=read('./release-toolchain-pre-intent-install.mjs');assert.equal(plan.length,5);assert.deepEqual(plan.at(-1).args,['read-tree','-mu','HEAD']);assert.throws(()=>preIntentInstallGitPlan(H.toolRevision));
 for(const token of['ino:2624956','collectRemoteReleaseReview(revision)','assertRetainedBookingSource(APP','checkPin(pins.publication)','workerIntentAbsent===true','observePreIntentForInstallation()','installation_replay','assertReviewFresh(review,revision)'])assert.ok(source.includes(token),token);
 assert.doesNotMatch(source,/process\.kill|persistPm2Dump|bookingHostReplace|set active=|update-ref|rmdirSync|unlinkSync|rmSync/);
 const calls=[],url=preIntentObserverUrl((cwd,args)=>{calls.push({cwd,args});return Buffer.from(read('./'+args[1].split(':scripts/')[1]));},revision),text=Buffer.from(url.split(',')[1],'base64').toString('utf8');assert.equal(calls.length,3);assert.doesNotMatch(text,/from\s*['"]\.\//);assert.ok(text.includes('/var/lib/faolla-online-code/'+H.toolRevision+'/scripts/release-toolchain-source.mjs'));
 const binding=retainedBookingSourceUrl((cwd,args)=>Buffer.from(read('./'+args[1].split(':scripts/')[1])),revision),bindingText=Buffer.from(binding.split(',')[1],'base64').toString('utf8');assert.ok(bindingText.includes('/var/lib/faolla-online-code/'+H.toolRevision+'/scripts/release-toolchain-source.mjs'));assert.throws(()=>preIntentObserverUrl(()=>Buffer.alloc(0),revision));
});
test('source bridge preserves complete current verifier and original historical qualification without relabelling either',()=>{
 const profile=read('./release-toolchain-pre-intent-profile.mjs'),evidence=read('./release-toolchain-pre-intent-evidence.mjs'),scope=read('./release-toolchain-active-generation-publication-scope.mjs');
 assert.ok(profile.includes('inspectPostSaveWithPinnedSource(toolRevision,heldLock,preparedWorker)'));assert.ok(evidence.includes('original.verifyClosedPreConnectAbort(H.toolRevision,preparedWorker)'));assert.ok(scope.includes('fs.readdirSync(parent).length===0'));
 const closed={evidenceToolRevision:PRE_ROUTE.toolRevision,evidenceInventorySha256:PRE_ROUTE.inventorySha256,closedSha256:PRE_ROUTE.closedSha256,qualificationSha256:PRE_ROUTE.qualificationSha256,toolRevision:'a'.repeat(40),inventorySha256:'b'.repeat(64),preIntentHistoricalBinding:preIntentHistoricalBinding(),preIntentQualificationSha256:'c'.repeat(64)},qualification={sha256:'c'.repeat(64),proof:{toolRevision:closed.toolRevision,inventorySha256:closed.inventorySha256}};
 assert.equal(assertQualificationForClosedSource(qualification,closed),true);
 for(const mutate of[v=>v.preIntentHistoricalBinding.priorToolRevision='f'.repeat(40),v=>v.preIntentHistoricalBinding.priorPreConnectQualificationSha256='f'.repeat(64),v=>v.preIntentHistoricalBinding.pinsSha256='f'.repeat(64),v=>v.preIntentHistoricalBinding.originalOperationInode++,v=>v.preIntentQualificationSha256=H.preConnectQualificationSha256]){const v=structuredClone(closed);mutate(v);assert.throws(()=>assertQualificationForClosedSource(qualification,v));}
});
test('entry has no resource/skip/publish action and both runtime/CI profiles retain all four old files',()=>{
 const entry=read('./release-toolchain-pre-intent-entry.mjs'),closure=read('./release-toolchain-pre-intent-closure.mjs'),writer=read('./online-release-retention-writer.mjs');assert.ok(entry.includes("['qualify','close']"));assert.ok(entry.includes('withPreIntentAbortPreparationLocks'));assert.doesNotMatch(entry,/--force|skipChecks|reset\(|publish\(/);assert.doesNotMatch(closure,/unlinkSync|rmSync|rmdirSync|bookingHostSql|process\.kill|persistPm2Dump/);assert.ok(writer.includes('allFourOriginalFilesRetained:true'));assert.ok(writer.includes('readRefusalDidNotCreateEvidence:true'));assert.deepEqual(Object.keys(pins.publication.files).sort(),[...PRE_INTENT_FILES].sort());
 for(const args of[[],['qualify'],['close'],['close','--skip'],['publish']]){const result=spawnSync(process.execPath,[fileURLToPath(new URL('./release-toolchain-pre-intent-entry.mjs',import.meta.url)),...args],{encoding:'utf8',timeout:5000});assert.equal(result.status,1);assert.match(result.stderr,/applicationPublished/);}
});
