import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {withActiveBookingIncidentPreparationLocks,acceptActiveIncidentPreparationLocksInCi,assertOnlineRetentionHeldLocks} from './online-release-retention-writer.mjs';
test('a serialized green incident or unreviewed tool cannot mint a production preparation lock',async()=>{
 let work=false;await assert.rejects(withActiveBookingIncidentPreparationLocks({toolRevision:'a'.repeat(40),incident:{verified:true},allowPending:true},()=>{work=true;}));assert.equal(work,false);
 assert.throws(()=>assertOnlineRetentionHeldLocks({deployFd:3,operationDirectory:'/var/lib/faolla-maintenance/merchant-space/operation.lock'}));
});
test('ordinary local invocations cannot select the disposable lock scope',async()=>{
 if(process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||process.env.FAOLLA_RELEASE_PRODUCTION_EQ!=='1'||process.platform!=='linux'||process.getuid?.()!==0)await assert.rejects(acceptActiveIncidentPreparationLocksInCi());
});
test('the separate active preparation scope preserves the old directory on every exit and does not weaken the old lock creator',()=>{
 const text=readFileSync(new URL('./online-release-retention-writer.mjs',import.meta.url),'utf8'),start=text.indexOf('async function withExistingOperationPreparation'),end=text.indexOf('export async function withActiveBookingIncidentPreparationLocks',start),scope=text.slice(start,end);
 for(const token of ["spawnSync('flock'",'fs.constants.O_NOFOLLOW','await observe(window)','assertExistingOperationScopeHeld(token)','fs.closeSync(fd)','heldLocks.delete(token)'])assert.ok(scope.includes(token),token);
 assert.doesNotMatch(scope,/rmdirSync|renameSync|unlinkSync|rmSync|mkdirSync|chmodSync/);
 const oldStart=text.indexOf('export async function withOnlineRetentionLocks'),old=text.slice(oldStart,start);
 assert.ok(old.includes('io.mkdirSync(operation, {mode: 0o700})'));assert.ok(old.includes('io.rmdirSync(operation)'));
 const production=text.slice(end,text.indexOf('export async function acceptActiveIncidentPreparationLocksInCi',end));
 for(const token of ['reviewedBookingExecution(toolRevision)','inspectActiveBookingIncident({window})','deployLock:DEPLOY_LOCK,operation:OPERATION_LOCK','assertHeldLocks(token)'])assert.ok(production.includes(token),token);
});
test('real kernel acceptance is a required CI step and retains its own audit reports',()=>{
 const text=readFileSync(new URL('../.github/workflows/release-toolchain.yml',import.meta.url),'utf8');
 for(const token of ['Active Incident Existing Operation Kernel Lock Acceptance','release-toolchain-active-generation-lock-acceptance.mjs','release-toolchain-active-lock-evidence.tar'])assert.ok(text.includes(token),token);
 const start=text.indexOf('- name: Active Incident Existing Operation Kernel Lock Acceptance'),step=text.slice(start,text.indexOf('- name:',start+1));assert.doesNotMatch(step,/continue-on-error|if:/);
});
