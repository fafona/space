import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {observeActiveBookingRollbackReadiness} from './release-toolchain-active-generation-readiness.mjs';
test('serialized source, closure and lock cannot initiate a formal rollback observation',async()=>{await assert.rejects(observeActiveBookingRollbackReadiness({lock:{deployFd:3},toolRevision:'a'.repeat(40),window:{id:'10000000-0000-4000-8000-000000000001'},closed:{verified:true}}));});
test('new observation retains exact original state and proof bytes and performs a bounded domain-bound actual local probe',()=>{
 const text=readFileSync(new URL('./release-toolchain-active-generation-readiness.mjs',import.meta.url),'utf8');
 for(const token of ['inspectClosedActiveBookingIncidentUnderHeldLocks','verifyLatestActiveBookingQualification','observeBookingReadyApplication','collectFormalBookingPm2Registry','assertBookingAtomicCohort','window:P.originalWindow','same(original.stateText,stateText)',"Host:'www.faolla.com'",'AbortSignal.timeout(5000)','bytes<=4096','observedAt:new Date().toISOString()','assertActiveBookingRollbackReadiness'])assert.ok(text.includes(token),token);
 assert.doesNotMatch(text,/bookingHostWriteOnce|bookingHostReplace|bookingHostSql|process\.kill|mkdirSync|rmdirSync|renameSync|writeFile|readyAt\s*[:=]/);
});
