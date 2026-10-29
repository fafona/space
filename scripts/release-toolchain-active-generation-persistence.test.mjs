import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {ACTIVE_PERSISTENCE_STEPS as steps,executeActiveProcessPersistence,persistActiveBookingCurrentProcesses,verifyActiveBookingProcessPersistence,verifyOwnedActiveReconciliationPersistence,persistActiveBookingPublicationCurrentProcesses,verifyActiveBookingPublicationPersistenceBeforeMetadata} from './release-toolchain-active-generation-persistence.mjs';
test('persistence has one save and independent verification before its completion receipt',async()=>{
 const calls=[],ops=Object.fromEntries(steps.map(s=>[s,async()=>{calls.push(s);return s;}]));ops.assertHeld=()=>{};assert.equal(await executeActiveProcessPersistence(ops),'complete');assert.deepEqual(calls,steps);assert.equal(calls.filter(s=>s==='saveOnce').length,1);
});
for(const failure of steps)test('persistence unknown '+failure+' retains the original cause and never retries saving',async()=>{
 const original=Error(failure),calls=[],ops=Object.fromEntries(steps.map(s=>[s,async()=>{calls.push(s);if(s===failure)throw original;}]));ops.assertHeld=()=>{};ops.failure=()=>{throw Error('diagnostic-failure');};await assert.rejects(executeActiveProcessPersistence(ops),e=>e===original);assert.deepEqual(calls,steps.slice(0,steps.indexOf(failure)+1));
});
test('a serialized lock or green dump JSON cannot perform formal persistence',async()=>{await assert.rejects(persistActiveBookingCurrentProcesses({lock:{deployFd:3},toolRevision:'a'.repeat(40),receipt:{saved:true}}));});
test('normal active publication cannot save or adopt a JSON persistence receipt without its genuine publication scope and actual one-shot factory',async()=>{const fake={scope:{kind:'active-booking-publication-private-scope',saved:true},lock:{deployFd:3},toolRevision:'a'.repeat(40),window:{id:'10000000-0000-4000-8000-000000000001'},receipt:{saved:true}};await assert.rejects(persistActiveBookingPublicationCurrentProcesses(fake));await assert.rejects(verifyActiveBookingPublicationPersistenceBeforeMetadata(fake));});
test('saved receipts without actual private capability cannot pass live formal or owned verification',async()=>{
 await assert.rejects(verifyActiveBookingProcessPersistence({lock:{deployFd:3},toolRevision:'a'.repeat(40),receipt:{saved:true,processCount:25}}));await assert.rejects(verifyOwnedActiveReconciliationPersistence({verified:true},{deployFd:3}));
});
test('production persistence uses only the existing connect-only adapter and keeps both previous dump files privately',()=>{
 const source=readFileSync(new URL('./release-toolchain-active-generation-persistence.mjs',import.meta.url),'utf8');
 for(const token of ['verifyActiveBookingMetadataCorrection({lock,toolRevision,window})','await persistPm2Dump(daemon,bootId,registry,target)','await verifyPm2Dump(daemon,bootId,registry,receipt)','pm2-dump-before.json','pm2-backup-before.json','pm2-persistence-attempt.json','inspectActiveBookingIncidentAfterMetadata({window})','oldDumpNotAutomaticallyRestored:true','processControlPerformed:false','retryAllowed:false'])assert.ok(source.includes(token),token);
 assert.doesNotMatch(source,/spawnSync|\['save'\]|\['jlist'\]|bookingHostSql|process\.kill|rmdirSync|rmSync|renameSync/);
});
