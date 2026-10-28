import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {reconcileActiveBookingIncidentUnderHeldLocks,verifyActiveBookingClosure} from './release-toolchain-active-generation-closure.mjs';
import {archiveActiveBookingClosureOperation,releaseActiveBookingClosureOperation,activeBookingArchiveWitness,assertActiveBookingIncidentHeldWindow,assertReleasedActiveBookingScope} from './online-release-retention-writer.mjs';
import {inspectActiveBookingIncidentWithArchivedOperation} from './release-toolchain-active-generation-incident.mjs';
import {verifyActiveBookingArchivedProcessPersistence} from './release-toolchain-active-generation-persistence.mjs';
test('green closures, old incident IDs and serialized FDs cannot reconcile, archive, release or attest a formal archive',async()=>{
 const options={lock:{deployFd:3},toolRevision:'a'.repeat(40),window:{id:'10000000-0000-4000-8000-000000000001'},closure:{verified:true}};
 for(const act of [reconcileActiveBookingIncidentUnderHeldLocks,verifyActiveBookingClosure,archiveActiveBookingClosureOperation,releaseActiveBookingClosureOperation,inspectActiveBookingIncidentWithArchivedOperation,verifyActiveBookingArchivedProcessPersistence])await assert.rejects(act(options));
 assert.throws(()=>activeBookingArchiveWitness(options.lock));assert.throws(()=>assertActiveBookingIncidentHeldWindow(options.lock,options.window));assert.throws(()=>assertReleasedActiveBookingScope(options.lock,'a'.repeat(64)));
});
test('fixed formal closure entry refuses ordinary invocation and resource/skip/publication arguments',()=>{
 const entry=new URL('./release-toolchain-active-generation-close-entry.mjs',import.meta.url),text=readFileSync(entry,'utf8');
 for(const token of ['withReviewedBookingExecution','withActiveBookingIncidentPreparationLocks','verifyActiveBookingIncidentPreparation',"['qualify','reconcile']",'process.argv.length===3',"process.cwd()===directory",'applicationPublished:false'])assert.ok(text.includes(token),token);
 assert.doesNotMatch(text,/args\.includes|--force|--skip|allowPending|\.pop\(/);
 if(process.platform!=='linux'||process.getuid?.()!==0){const result=spawnSync(process.execPath,[fileURLToPath(entry),'reconcile'],{encoding:'utf8',timeout:10000,windowsHide:true});assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,1);assert.equal(JSON.parse(result.stderr).applicationPublished,false);}
});
test('formal closure independently qualifies then binds fresh backup and verified physical evidence before archive and owned release',()=>{
 const text=readFileSync(new URL('./release-toolchain-active-generation-closure.mjs',import.meta.url),'utf8');
 for(const token of ['scopes=new WeakMap','verifyLatestActiveBookingQualification','createReviewedBookingBackup','admissionFileFact','verifyActiveBookingIncidentPreservation','verifyActiveBookingMetadataCorrection','verifyActiveBookingProcessPersistence','verifyActiveBookingArchivedProcessPersistence','executeActiveBookingReconciliation','assertActiveBookingIncidentHeldWindow','await releaseActiveBookingClosureOperation(options)','assertReleasedActiveBookingScope','originalOperationInodeRetained:true','applicationPublished:false','activationReplayed:false','businessDataWritten:false','mailEnabled:false','scopes.delete(lock)'])assert.ok(text.includes(token),token);
 assert.doesNotMatch(text,/bookingHostReplace|guardedProductionBookingActivationSql|pauseLegacyBookingHost|pm2.*(?:restart|save)|process\.kill|fs\.(?:renameSync|rmdirSync|rmSync|unlinkSync)/);
 assert.ok(text.includes('bookingHostSql(bookingHandoffActivationSnapshotSql)'));assert.ok(text.includes('await proveRecoveryTargets'));
});
test('archive observer requires a real private archive transition; preparation and archived observations stay separate',()=>{
 const text=readFileSync(new URL('./release-toolchain-active-generation-incident.mjs',import.meta.url),'utf8'),writer=readFileSync(new URL('./online-release-retention-writer.mjs',import.meta.url),'utf8');
 for(const token of ['activeBookingArchiveWitness(lock)','archivedOperation.destination','lease.operation.identity','archivedOperation.replacement','originalOperationArchived','collectActiveBookingIncident({window,metadataCorrected:true});'])assert.ok(text.includes(token),token);
 assert.ok(writer.includes('structuredClone({...archive,window:held.activeWindow'));assert.ok(writer.includes('held.activeScopeReleased'));assert.ok(writer.includes('completed.archiveSha256!==digest(readOwned(closure.directory'));
});
