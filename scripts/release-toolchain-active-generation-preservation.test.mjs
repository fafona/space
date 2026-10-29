import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {preserveActiveBookingIncidentEvidence,acceptActiveIncidentPreservationInCi} from './release-toolchain-active-generation-preservation.mjs';
test('caller JSON, a serialized lock and an arbitrary path cannot start production preservation',async()=>{
 const start=Date.now();await assert.rejects(preserveActiveBookingIncidentEvidence({lock:{deployFd:3},toolRevision:'a'.repeat(40),directory:'/tmp/caller',incident:{passed:true},window:{id:'10000000-0000-4000-8000-000000000001',startedAt:new Date(start).toISOString(),deadlineAt:new Date(start+600000).toISOString()}}));
});
test('the vault CI runner is unavailable outside its closed disposable environment',async()=>{
 if(process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||process.env.FAOLLA_RELEASE_PRODUCTION_EQ!=='1'||process.platform!=='linux'||process.getuid?.()!==0)await assert.rejects(acceptActiveIncidentPreservationInCi());
});
test('production preservation re-observes the real incident and only copies into a new fixed audit directory',()=>{
 const source=readFileSync(new URL('./release-toolchain-active-generation-preservation.mjs',import.meta.url),'utf8'),start=source.indexOf('export async function preserveActiveBookingIncidentEvidence'),end=source.indexOf('export async function acceptActiveIncidentPreservationInCi'),production=source.slice(start,end);
 for(const token of ['assertOnlineRetentionHeldLocks(lock)','reviewedBookingExecution(toolRevision)','await inspectActiveBookingIncident({window})','/var/lib/faolla-booking-active-closures','P.operationId','window.id','pins:ACTIVE_INCIDENT_FILES','engine.begin();engine.copy();','incidentClosed:false','applicationPublished:false'])assert.ok(production.includes(token),token);
 assert.doesNotMatch(production,/rmSync|unlinkSync|rmdirSync|renameSync|bookingHostSql|process\.kill|pm2|enableMail/);
 assert.ok(source.includes('originalFilesRetained:true,incidentClosed:false,publicationAuthority:false'));
});
test('vault methods are one-attempt, exclusive writes with source and destination identity rechecks',()=>{
 const source=readFileSync(new URL('./release-toolchain-active-generation-preservation.mjs',import.meta.url),'utf8');
 for(const token of ['copyAttempted=true','sealAttempted=true','beginAttempted=true','sourceNames','snapshots.get(pin[0])','new TextDecoder','exactText(actual.bytes)','privateDir(destination)','fs.readdirSync(destination)','bookingHostWriteOnce','engine.seal()'])assert.ok(source.includes(token),token);
 const workflow=readFileSync(new URL('../.github/workflows/release-toolchain.yml',import.meta.url),'utf8');assert.ok(workflow.includes('release-toolchain-active-vault-evidence.tar'));
 const runner=readFileSync(new URL('./release-toolchain-active-generation-lock-acceptance.mjs',import.meta.url),'utf8');assert.ok(runner.includes('await acceptActiveIncidentPreservationInCi()'));
});
