// The one approved, independently recovered gate/drain failure. These are
// immutable historical facts, NEVER a new lease or a generic retry policy.
import {isDeepStrictEqual} from 'node:util';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
import {ACTIVE_BOOKING_INCIDENT as P,assertActiveBookingWindow} from './release-toolchain-active-generation-contract.mjs';
export const ORIGIN_RECOVERY=Object.freeze({
 priorTool:'168561aacf3356467facbd4f65e0c0b50ab4e4aa',inventorySha256:'8ccfac51f3774af0dd5b547bd48901acddfe3c6858b615ae8c5dc64436aea57c',
 operationId:'592b3195-8dc8-4b34-a0cf-bde4b1834063',operationInode:2624959,workerPid:416022,workerRestarts:6,
 publication:'/var/lib/faolla-booking-active-publications/'+P.candidate+'/592b3195-8dc8-4b34-a0cf-bde4b1834063',
 root:'/var/lib/faolla-booking-origin-recovery-closures/592b3195-8dc8-4b34-a0cf-bde4b1834063',
 manifestSha256:'8354c3f37f4cc98d572500e63031f028ba2a254a741c7a333052680a58db334a',
 failedStateSha256:'a9976dbebe63f812b0e3c447e7b8a2f5c5fffc577b2a8ef7606bdcbe11697b06',
 originalStateSha256:'7ba13be0b859c918a71481b469596d6f2ef430ba61b1fc1946471812fb5651d3',
 qualification:'/var/lib/faolla-booking-active-qualifications/b49808d6-1950-4cb4-b029-97086873d7a7/168561aacf3356467facbd4f65e0c0b50ab4e4aa/attempt_1793341794078_2859aae9-b538-4389-ae99-ff4ac9fa532a',
 qualificationSha256:'35993a28f98e5d5a538cc1646616b0bd179615477ce93ad35d30ce0bf420bcab',
 retentionHeadSha256:'77ea9068d2c634f146f0f53be465ba9cb13ad335417cbc8f2228fd6bc5cef6cb'
});
const H=ORIGIN_RECOVERY,same=(a,b)=>need(isDeepStrictEqual(a,b),'evidence_invalid');
export function assertOriginRecoveredFailure({lease,finished,recovery,failure,attempt,worker,saved,hashes},{nowMs=Date.now()}={}){
 need(lease?.toolRevision===H.priorTool&&lease.directory===H.publication&&lease.window?.id===H.operationId&&lease.toolInventorySha256===H.inventorySha256,'evidence_invalid');
 same(lease.window,{id:H.operationId,startedAt:'2026-10-30T07:04:57.130Z',deadlineAt:'2026-10-30T07:14:57.130Z'});
 need(finished?.kind==='active-booking-supervisor-finished'&&finished.outcome==='recovered-failure'&&finished.commit===null&&recovery?.kind==='active-booking-publication-recovered'&&failure?.stage==='gateAndDrain'&&failure.diagnostic?.code==='gate_not_confirmed'&&failure.automaticRetryAllowed===false,'evidence_invalid');same(finished.recovery,recovery);
 for(const v of [finished,recovery,attempt,worker]){same(v.window,lease.window);need(v.toolRevision===H.priorTool,'evidence_invalid');}
 for(const key of ['workerGateOpen','activationPerformed','legacyRestartPerformed','businessDataWritten','mailEnabled','publicationAuthority'])need(recovery[key]===false,'evidence_invalid');need(recovery.actualRoute===P.compatibleRollback&&saved?.receipt?.saved===true&&saved.receipt.peerVerified===true&&worker.gateNeverOpened===true&&worker.before.pid===P.privateWorkerPid&&worker.after.pid===H.workerPid&&worker.after.pmId===27&&worker.after.restartCount===H.workerRestarts&&worker.after.executable==='/var/lib/faolla-online-code/'+H.priorTool+'/scripts/booking-atomic-worker.mjs','evidence_invalid');
 same(worker.attemptSha256,hashes.attempt);same(lease.workerPreparationSha256,hashes.worker);same(recovery.persistenceSha256,hashes.saved);
 same(lease.operation.identity,{dev:64769,ino:H.operationInode,uid:0,mode:0o40700,nlink:2});
 const at=Date.parse(finished.finishedAt??finished.at??finished.completedAt);need(Number.isFinite(at)&&at<=nowMs&&at>=Date.parse(lease.window.startedAt),'evidence_invalid');
 // Validate the OLD window at the actual recorded recovery event. Do not
 // extend it, fake Date.now, or treat historical success as live admission.
 assertActiveBookingWindow(lease.window,{nowMs:at});return true;
}
export const originRecoveryHistoricalBinding=()=>({kind:'fixed-origin-gate-failure-recovered-history',priorToolRevision:H.priorTool,priorInventorySha256:H.inventorySha256,priorOperationId:H.operationId,priorEvidenceManifestSha256:H.manifestSha256,priorQualificationSha256:H.qualificationSha256,priorWorkerPid:H.workerPid,priorWorkerRestarts:H.workerRestarts,originalLeaseNotRenewed:true,publicationAuthority:false});
export function assertOriginRecoveryHistoricalBinding(value){same(value,originRecoveryHistoricalBinding());return true;}
export function assertOriginRecoveryMetadataDelta(failedText,originalText){
 need(sha256(failedText)===H.failedStateSha256&&sha256(originalText)===H.originalStateSha256,'evidence_invalid');const failed=JSON.parse(failedText),original=JSON.parse(originalText);same(failed,{...original,status:'booking-active-generation-cutover-failed',bookingRecoveryTarget:P.compatibleRollback,bookingRecoveryOperationId:H.operationId,bookingRecoveryAt:failed.bookingRecoveryAt});need(typeof failed.bookingRecoveryAt==='string'&&new Date(failed.bookingRecoveryAt).toISOString()===failed.bookingRecoveryAt,'evidence_invalid');return{failedStateSha256:H.failedStateSha256,originalStateSha256:H.originalStateSha256,applicationBuildUnchanged:true,businessDataWritten:false,publicationAuthority:false};
}
export const originRecoveryProofSha256=()=>sha256(canonicalJson(originRecoveryHistoricalBinding()));
