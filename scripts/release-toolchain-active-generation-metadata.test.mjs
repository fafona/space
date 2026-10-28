import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {assertActiveMetadataOnlyDelta,assertActiveCorrectedObservationProgress,correctActiveBookingCompatibleMetadata,acceptActiveIncidentMetadataInCi} from './release-toolchain-active-generation-metadata.mjs';
import {ACTIVE_BOOKING_INCIDENT as P,ACTIVE_BOOKING_METADATA as M} from './release-toolchain-active-generation-contract.mjs';
import {sha256} from './release-toolchain-contracts.mjs';
function observations(){const before={oldOperationId:P.operationId,metadataCorrected:false,activeMetadataSha256:sha256(M.beforeText),publicationAuthority:false,historicalPause:{observedAt:'before',legacyPid:P.legacyPid},recordProof:{observedAt:'before',sequenceSha256:'a'.repeat(64)},publicProof:[{origin:'https://faolla.com',status:200,buildId:P.compatibleRollback,attempts:1}],database:{systemIdentifier:'7612049595342295079',databaseOid:'5',serverVersionNum:'150008',generation:P.generation,active:true,protocol:2,revision:'0',commands:0,mailJobs:0,savedBookingRowsSha256:'c'.repeat(64)},processesSha256:'b'.repeat(64),observedAt:'before'},after=structuredClone(before);after.metadataCorrected=true;after.activeMetadataSha256=sha256(M.afterText);after.observedAt='after';after.historicalPause.observedAt='after';after.recordProof.observedAt='after';after.publicProof[0].attempts=2;return{before,after};}
test('metadata is bound to the exact observed old bytes and the actual compatible port, not another release',()=>{
 assert.equal(sha256(M.beforeText),'20f06d98ce7cdbe9b3003b23d63967458842a144afd77ca04e249c38827c297b');const actual=JSON.parse(M.afterText);assert.equal(actual.target,P.compatibleRollback);assert.equal(actual.port,3110);assert.equal(Object.keys(actual).length,4);
});
test('metadata correction never changes database identity, generation or process facts',()=>{
 const {before,after}=observations();assert.equal(assertActiveMetadataOnlyDelta(before,after),true);
 for(const mutate of [v=>v.database.generation='foreign',v=>v.database.active=false,v=>v.processesSha256='changed',v=>v.historicalPause.legacyPid++,v=>v.publicProof[0].buildId=P.candidate,v=>v.recordProof.sequenceSha256='changed',v=>v.activeMetadataSha256='bad',v=>v.metadataCorrected=false,v=>v.publicationAuthority=true,v=>v.extra=true]){const changed=structuredClone(after);mutate(changed);assert.throws(()=>assertActiveMetadataOnlyDelta(before,changed));}
});
test('normal live bookings may progress during metadata and persistence proof without restoring an older snapshot',()=>{
 const {before,after}=observations();after.database={...after.database,revision:'1',commands:1,savedBookingRowsSha256:'d'.repeat(64)};assert.equal(assertActiveMetadataOnlyDelta(before,after),true);
 const latest=structuredClone(after);latest.database={...latest.database,revision:'2',commands:2,savedBookingRowsSha256:'e'.repeat(64)};assert.equal(assertActiveCorrectedObservationProgress(after,latest),true);
 assert.throws(()=>assertActiveCorrectedObservationProgress(latest,after));const changed=structuredClone(latest);changed.processesSha256='foreign';assert.throws(()=>assertActiveCorrectedObservationProgress(after,changed));
});
test('serialized locks and green preservation JSON cannot perform production correction',async()=>{await assert.rejects(correctActiveBookingCompatibleMetadata({lock:{deployFd:3},toolRevision:'a'.repeat(40),preserved:{verified:true}}));});
test('ordinary local use cannot run the disposable metadata profile',async()=>{if(process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||process.env.FAOLLA_RELEASE_PRODUCTION_EQ!=='1'||process.platform!=='linux'||process.getuid?.()!==0)await assert.rejects(acceptActiveIncidentMetadataInCi());});
test('metadata actuator is fixed-path, preservation-bound, one-attempt and cannot route, save PM2 or clear state',()=>{
 const source=readFileSync(new URL('./release-toolchain-active-generation-metadata.mjs',import.meta.url),'utf8');
 for(const token of ['verifyActiveBookingIncidentPreservation({lock,toolRevision,window})','inspectActiveBookingIncidentAfterMetadata({window})',"file:'/var/lib/faolla-online-release/active.json'",'metadata-correction-intent.json','bookingHostReplace(file,beforeText,afterText','metadata-before-observation.json','metadata-after-observation.json','attempt_replay_forbidden','resultNotAutomaticallyRestored:true'])assert.ok(source.includes(token),token);
 assert.doesNotMatch(source,/rmdirSync|unlinkSync|renameSync|process\.kill|bookingHostSql|pm2.*save|while\(/);
 const runner=readFileSync(new URL('./release-toolchain-active-generation-lock-acceptance.mjs',import.meta.url),'utf8');assert.ok(runner.includes('await acceptActiveIncidentMetadataInCi()'));
});
