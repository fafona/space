import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {openActiveBookingPublicationScope,inspectActiveBookingPublicationScope,prepareActiveBookingPublicationWorker} from './release-toolchain-active-generation-publication-scope.mjs';
test('JSON admission cannot create, inspect or advance the active publication scope',async()=>{
 const fake={kind:'active-booking-publication-private-scope',lock:{deployFd:3},toolRevision:'a'.repeat(40),window:{id:'10000000-0000-4000-8000-000000000001'},ready:true};assert.throws(()=>inspectActiveBookingPublicationScope(fake));await assert.rejects(prepareActiveBookingPublicationWorker(fake));await assert.rejects(openActiveBookingPublicationScope(fake));
});
test('the new private scope binds actual source, completed closure, a fresh full backup, unchanged builds and independent active routing qualification',()=>{
 const value=readFileSync(new URL('./release-toolchain-active-generation-publication-scope.mjs',import.meta.url),'utf8');for(const token of ['new WeakMap()','captureProcessFact(process.pid)','release-toolchain-active-generation-publish-entry.mjs','inspectClosedActiveBookingIncidentUnderHeldLocks','validateAttendanceBackupEvidence','observeBookingReadyApplication()','verifyLatestActiveBookingQualification','qualification.activeRouting.sha256','observeActiveBookingRollbackReadiness','fs.readdirSync(parent).length===0','worker-attempted','worker-prepared','automaticRetryAllowed:false'])assert.ok(value.includes(token),token);
 assert.doesNotMatch(value,/process\.kill|guardedProductionBookingRepairActivationSql|bookingHostReplace|persistPm2Dump|worker-enabled.*bookingHostWriteOnce/);
});
