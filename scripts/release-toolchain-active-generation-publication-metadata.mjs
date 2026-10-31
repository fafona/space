// Pure construction of NEW publication metadata. It consumes the explicit
// historical-active handoff grammar; it cannot fabricate activation or a pause,
// write state, mint an execution scope, or turn historical evidence into now.
import {assertActiveBookingRetentionHandoff,ACTIVE_BOOKING_HANDOFF_KIND,ACTIVE_BOOKING_HISTORICAL_PINS_SHA256} from './booking-handoff-active-retention.mjs';
import {ACTIVE_BOOKING_INCIDENT as P} from './release-toolchain-active-generation-contract.mjs';
import {retentionHash} from './online-release-retention-policy.mjs';
import {requireToolchain as need,sha256,exactKeys,canonicalJson} from './release-toolchain-contracts.mjs';
import {BOOKING_HANDOFF_CANDIDATE_CLOSURE_SHA256} from './booking-handoff-policy.mjs';import {rollingHash} from './online-release-rolling-policy.mjs';
const location=value=>Object.fromEntries(['target','name','directory','port'].map(key=>[key,value[key]]));
export function reviewedActiveBookingHistoricalEvidence(historical,qualification){
 if(qualification?.proof===undefined)return historical;
 const qualificationText=canonicalJson(qualification.proof)+'\n';need(sha256(qualificationText)===qualification.sha256,'evidence_invalid');
 return{...historical,freshReview:{kind:'retained-active-provenance-review-v1',qualificationText}};
}
// Shared pure assembly from the exact scope-evidence API shape. In particular,
// backup is the validated backup itself, NOT the producer's {backup,binding}.
export function assembleActiveBookingPublicationHandoff({evidence,history,cohort,databaseAfter,originalStageText,historical,hashes,completedAt}){
 exactKeys(hashes,['preflightSha256','ingressGateSha256','activeDrainSha256','recoveryPlanSha256','persistenceSha256','workerPreparationSha256']);need(typeof evidence?.backup?.archiveSha256==='string'&&typeof evidence?.qualification?.sha256==='string','evidence_invalid');
 const e={schemaVersion:2,kind:ACTIVE_BOOKING_HANDOFF_KIND,candidate:P.candidate,baseline:P.legacyBaseline,application:P.compatibleRollback,toolRevision:evidence.toolRevision,window:evidence.window,completedAt,priorRetentionHeadSha256:history.headSha256,priorStageSha256:sha256(originalStageText),sourceClosureSha256:BOOKING_HANDOFF_CANDIDATE_CLOSURE_SHA256,compatibilitySha256:rollingHash(evidence.compatibility),backupSha256:evidence.backup.archiveSha256,rollbackReadinessSha256:rollingHash(evidence.readiness.readiness),closureSha256:evidence.closed.closureSha256,closedIncidentSha256:evidence.closed.closedSha256,nativeAcceptanceSha256:evidence.qualification.sha256,historicalEvidencePinsSha256:ACTIVE_BOOKING_HISTORICAL_PINS_SHA256,...hashes};
 const prior=history.entries.at(-1),handoff={evidence:e,originalStageText,legacyBefore:prior.processes.find(value=>value.name==='merchant-space'),legacyAfter:cohort.processes.find(value=>value.name==='merchant-space'),added:cohort.processes.filter(value=>!prior.processes.some(old=>old.name===value.name)),runtimeByName:cohort.runtimeByName,databaseBefore:evidence.databaseBefore,databaseAfter,rollbackReadiness:evidence.readiness.readiness,ruleRepair:JSON.parse(historical.ruleRepairText),historical:reviewedActiveBookingHistoricalEvidence(historical,evidence.qualification)};
 activeBookingPublicationMetadata({history,handoff,cohort});return handoff;
}
export function activeBookingPublicationMetadata({history,handoff,cohort}){
 need(Array.isArray(history?.entries)&&history.entries.length>0,'evidence_invalid');
 assertActiveBookingRetentionHandoff({handoff,prior:history.entries.at(-1),previousSha256:history.headSha256,active:cohort?.active,rollback:cohort?.rollback,processes:cohort?.processes,toolRevision:handoff?.evidence?.toolRevision,completedAt:handoff?.evidence?.completedAt});
 const original=JSON.parse(handoff.originalStageText),state={...original,...location(cohort.active),status:'active',activatedAt:handoff.evidence.completedAt,baseline:P.compatibleRollback,
  oldName:cohort.rollback.name,oldDirectory:cohort.rollback.directory,oldPort:cohort.rollback.port,bookingHandoffSha256:retentionHash(handoff),bookingOriginalStageSha256:handoff.evidence.priorStageSha256};
 return{state,stateText:JSON.stringify(state,null,2),activeText:JSON.stringify(location(cohort.active))};
}
