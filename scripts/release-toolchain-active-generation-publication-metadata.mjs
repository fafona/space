// Pure construction of NEW publication metadata. It consumes the explicit
// historical-active handoff grammar; it cannot fabricate activation or a pause,
// write state, mint an execution scope, or turn historical evidence into now.
import {assertActiveBookingRetentionHandoff} from './booking-handoff-active-retention.mjs';
import {ACTIVE_BOOKING_INCIDENT as P} from './release-toolchain-active-generation-contract.mjs';
import {retentionHash} from './online-release-retention-policy.mjs';
import {requireToolchain as need} from './release-toolchain-contracts.mjs';
const location=value=>Object.fromEntries(['target','name','directory','port'].map(key=>[key,value[key]]));
export function activeBookingPublicationMetadata({history,handoff,cohort}){
 need(Array.isArray(history?.entries)&&history.entries.length>0,'evidence_invalid');
 assertActiveBookingRetentionHandoff({handoff,prior:history.entries.at(-1),previousSha256:history.headSha256,active:cohort?.active,rollback:cohort?.rollback,processes:cohort?.processes,toolRevision:handoff?.evidence?.toolRevision,completedAt:handoff?.evidence?.completedAt});
 const original=JSON.parse(handoff.originalStageText),state={...original,...location(cohort.active),status:'active',activatedAt:handoff.evidence.completedAt,baseline:P.compatibleRollback,
  oldName:cohort.rollback.name,oldDirectory:cohort.rollback.directory,oldPort:cohort.rollback.port,bookingHandoffSha256:retentionHash(handoff),bookingOriginalStageSha256:handoff.evidence.priorStageSha256};
 return{state,stateText:JSON.stringify(state,null,2),activeText:JSON.stringify(location(cohort.active))};
}
