// One cryptographically pinned, pre-mutation refusal; never a generic retry.
import {isDeepStrictEqual} from 'node:util';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
import {ACTIVE_BOOKING_INCIDENT as P,assertActiveBookingDatabaseProgress} from './release-toolchain-active-generation-contract.mjs';
import preIntentPins from './release-toolchain-pre-intent-pins.mjs';
import {assertProcWitnessHistoricalBinding} from './release-toolchain-proc-witness-contract.mjs';
import {assertOriginRecoveryHistoricalBinding} from './release-toolchain-origin-recovery-contract.mjs';
export const PRE_ROUTE=Object.freeze({toolRevision:'dc80eacba6b3c6a78b271f88786372b026efd7dc',inventorySha256:'c46b751a2ca5af917a7e36ceb6bc595caffb2d65c0e6b761c7acdf4cb5afcbf4',windowId:'75b442b3-b569-43bf-a219-70e75fc650bd',closedDirectory:'/var/lib/faolla-booking-active-closures/b49808d6-1950-4cb4-b029-97086873d7a7/28c52817-ff38-49bd-94b7-ccd570c4d71b',closedSha256:'223c7799299cd1086e704eeae5871274fa05cb32c9ec7ce94e1b0e36a08c823a',qualificationSha256:'9f9609daabcf2f73f0943d55623a099826bdc88d9c3fb694dbb2d40239dba925',archive:'/var/lib/faolla-booking-pre-route-continuations/75b442b3-b569-43bf-a219-70e75fc650bd'});
export function isPinnedPriorClosedReceipt(text){let v;try{v=JSON.parse(text);}catch{return false;}return text===canonicalJson(v)+'\n'&&sha256(text)===PRE_ROUTE.closedSha256&&v.toolRevision===PRE_ROUTE.toolRevision;}
export function assertPreRouteRefusal({attempt,failure,names,controllerGone}){
 need(isDeepStrictEqual([...names].sort(),['publication-attempt.json','rollback-readiness.json'])&&controllerGone===true,'attempt_unknown');
 need(attempt.kind==='active-booking-publication-attempt'&&attempt.toolRevision===PRE_ROUTE.toolRevision&&attempt.inventorySha256===PRE_ROUTE.inventorySha256&&attempt.closedDirectory===PRE_ROUTE.closedDirectory&&attempt.closedIncidentSha256===PRE_ROUTE.closedSha256&&attempt.qualificationSha256===PRE_ROUTE.qualificationSha256&&attempt.window.id===PRE_ROUTE.windowId&&attempt.activationReplayAllowed===false&&attempt.legacyRestartAllowed===false&&attempt.mailEnabled===false&&attempt.publicationAuthority===false,'evidence_invalid');
 need(failure.kind==='active-booking-controller-exit-unconfirmed'&&failure.stage==='freshRollbackReadiness'&&failure.mutationPossible===false&&failure.independentSupervisorMayBeActive===false&&failure.automaticRetryAllowed===false&&failure.mailEnabled===false&&failure.publicationAuthority===false&&isDeepStrictEqual(failure.window,attempt.window)&&failure.diagnostic?.code==='observation_mismatch'&&failure.diagnostic.toolRevision===PRE_ROUTE.toolRevision,'evidence_invalid');return true;
}
export function assertClosedSourceObservationProgress(before,after){
 need(before.kind==='closed-active-incident-current-observation'&&before.evidenceToolRevision===PRE_ROUTE.toolRevision&&after.evidenceToolRevision===PRE_ROUTE.toolRevision&&before.closedSha256===PRE_ROUTE.closedSha256&&after.closedSha256===PRE_ROUTE.closedSha256,'evidence_invalid');
 assertActiveBookingDatabaseProgress(before.database,after.database,{systemIdentifier:'7612049595342295079',databaseOid:'5'});
 const strip=v=>{const {database,observedAt,publicProof,...stable}=v;void database;const at=Date.parse(observedAt);need(Number.isFinite(at)&&new Date(at).toISOString()===observedAt,'evidence_invalid');need(Array.isArray(publicProof)&&publicProof.length===2&&new Set(publicProof.map(p=>p.origin)).size===2&&publicProof.every(p=>['https://faolla.com','https://launch.faolla.com'].includes(p.origin)&&p.status===200&&p.buildId===P.compatibleRollback),'evidence_invalid');return stable;};
 need(isDeepStrictEqual(strip(before),strip(after))&&Date.parse(after.observedAt)>=Date.parse(before.observedAt),'observation_mismatch');return true;
}
export function assertQualificationForClosedSource(qualification,closed){
 if(closed.originRecoveryHistoricalBinding)assertOriginRecoveryHistoricalBinding(closed.originRecoveryHistoricalBinding);
 if(closed.procWitnessHistoricalBinding)assertProcWitnessHistoricalBinding(closed.procWitnessHistoricalBinding,closed.toolRevision);
 if(closed.preIntentHistoricalBinding){
  const h=closed.preIntentHistoricalBinding;
  need(h.priorToolRevision==='8607f9d21980f8330cba46eb13c7e8f5d99a8485'&&h.priorInventorySha256==='43fe04f0fb2fb15e64294f26d53fb35de1a16e5ce55e9cdba0bd9d076598892c'&&h.priorPreConnectClosureSha256==='04d60ef9627122594d58dabacb7ae636218c467cc5269a547d77574b0a9886a3'&&h.priorPreConnectQualificationSha256==='04342395f3bda4aab3d4fa0c8a568d5264a0075401962234883c9174fd59ab4f'&&h.originalOperationInode===2624956&&h.pinsSha256===sha256(canonicalJson(preIntentPins))&&closed.toolRevision!==h.priorToolRevision,'evidence_invalid');
  if(closed.preIntentQualificationSha256)need(qualification.sha256===closed.preIntentQualificationSha256,'evidence_invalid');
 }
 if(closed.preConnectQualificationSha256)need(qualification.sha256===closed.preConnectQualificationSha256,'evidence_invalid');
 if(closed.preControlQualificationSha256)need(qualification.sha256===closed.preControlQualificationSha256,'evidence_invalid');
 if(!closed.evidenceToolRevision){need(qualification.sha256===closed.qualificationSha256,'evidence_invalid');return true;}
 need(closed.evidenceToolRevision===PRE_ROUTE.toolRevision&&closed.evidenceInventorySha256===PRE_ROUTE.inventorySha256&&closed.closedSha256===PRE_ROUTE.closedSha256&&closed.qualificationSha256===PRE_ROUTE.qualificationSha256&&qualification.proof.toolRevision===closed.toolRevision&&qualification.proof.inventorySha256===closed.inventorySha256&&qualification.proof.toolRevision!==PRE_ROUTE.toolRevision,'evidence_invalid');return true;
}
