import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {qualifyActiveBookingIncident,verifyLatestActiveBookingQualification} from './release-toolchain-active-generation-qualification.mjs';
test('JSON qualifications and serialized held locks cannot start or select formal active qualification',async()=>{
 const fake={lock:{deployFd:3},toolRevision:'a'.repeat(40),window:{id:'10000000-0000-4000-8000-000000000001'},qualification:{allPassed:true}};
 await assert.rejects(qualifyActiveBookingIncident(fake));assert.throws(()=>verifyLatestActiveBookingQualification(fake));
});
test('active qualification uses actual isolated runner, actual interruption and current metadata plus immutable builds',()=>{
 const text=readFileSync(new URL('./release-toolchain-active-generation-qualification.mjs',import.meta.url),'utf8');
 for(const token of ['assertOnlineRetentionHeldLocks(lock)','reviewedBookingExecution(toolRevision)','inspectActiveBookingIncident({window})','await runFullActiveToolchainRehearsal()','await rehearseFullActiveToolchainInterruption()','await acceptOwnedActiveRouting()','verifyOwnedActiveRoutingAcceptance','activeRoutingNativeRoot','activeRoutingNativeSha256','verifyQualificationFiles','verifyFullInterruptionReport','observeBookingCompatibility','observeBookingReadyApplication()','assertActiveBookingObservedHostProgress','await refreshReviewedBookingExecution(toolRevision)','fixed-active-incident-connect-only'])assert.ok(text.includes(token),token);
 assert.doesNotMatch(text,/pm2.*(?:restart|save)|bookingHostSql|bookingHostReplace|process\.kill|renameSync|unlinkSync|rmdirSync|rmSync|allowPending/);
});
test('new active observation never replaces the original inactive observer or permits caller resource arguments',()=>{
 const runner=readFileSync(new URL('./release-toolchain-full-rehearsal.mjs',import.meta.url),'utf8'),interrupt=readFileSync(new URL('./release-toolchain-full-interrupt.mjs',import.meta.url),'utf8'),entry=readFileSync(new URL('./release-toolchain-full-active-rehearsal.mjs',import.meta.url),'utf8'),workflow=readFileSync(new URL('../.github/workflows/release-toolchain.yml',import.meta.url),'utf8');
 for(const token of ["connectOnly?collectFormalBookingPm2Registry().rows",'runFullToolchainRehearsalProfile(false)','runFullToolchainRehearsalProfile(true)','captureActiveToolchainProductionSnapshot'])assert.ok(runner.includes(token),token);
 assert.ok(interrupt.includes('rehearseFullToolchainInterruptionProfile(false)'));assert.ok(interrupt.includes('rehearseFullToolchainInterruptionProfile(true)'));assert.ok(entry.includes("process.argv[2]==='--interrupt'"));
 assert.ok(workflow.includes('Full Active-Profile Isolated Handoff And Interruption'));const start=workflow.indexOf('- name: Full Active-Profile'),step=workflow.slice(start,workflow.indexOf('- name:',start+1));assert.doesNotMatch(step,/continue-on-error|if:/);
});
test('choosing the active host observation cannot shadow the actual database snapshot function',()=>{
 const text=readFileSync(new URL('./release-toolchain-full-rehearsal.mjs',import.meta.url),'utf8'),body=text.slice(text.indexOf('async function runFullToolchainRehearsalProfile'),text.indexOf('export const runFullToolchainRehearsal='));
 assert.ok(body.includes('const hostSnapshot=activeProfile?captureActiveToolchainProductionSnapshot:production'));assert.ok(body.includes('const actual=snapshot(database)'));assert.ok(body.includes('equal(hostSnapshot(),formal'));assert.doesNotMatch(body,/\b(?:const|let|var)\s+snapshot\b/);
});

test('qualification advances its refusal stage after routing without omitting any final check',()=>{
 const text=readFileSync(new URL('./release-toolchain-active-generation-qualification.mjs',import.meta.url),'utf8');
 let prior=text.indexOf("stage='already-active-routing-and-controller-death'");
 for(const stage of ['compatibility','application-readback','after-observation','observation-continuity','final-source-and-ci']){
  const at=text.indexOf("stage='"+stage+"'",prior+1);assert.ok(at>prior,stage);prior=at;
 }
 assert.ok(text.indexOf('await refreshReviewedBookingExecution(toolRevision);held();',prior)>prior);
 assert.ok(text.includes("'production-maintenance-pm2-adapter.mjs'"));
});
