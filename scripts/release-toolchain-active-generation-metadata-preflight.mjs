// Read-only provenance checks shared by admission and final assembly. No
// actuator, capability, synthetic process receipt or rewritten historical time.
import {isDeepStrictEqual} from 'node:util';
import {ACTIVE_BOOKING_INCIDENT as P,ACTIVE_BOOKING_METADATA as M} from './release-toolchain-active-generation-contract.mjs';
import {ACTIVE_BOOKING_HISTORICAL_PINS_SHA256,assertActiveBookingHistoricalFreshness} from './booking-handoff-active-retention.mjs';
import {reviewedActiveBookingHistoricalEvidence} from './release-toolchain-active-generation-publication-metadata.mjs';
import {bookingHostRead} from './booking-handoff-host-io.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
const ROOT='/var/lib/faolla-booking-handoff/'+P.candidate,RELEASE='/var/lib/faolla-online-release',read=p=>JSON.parse(bookingHostRead(p)),same=(a,b)=>need(isDeepStrictEqual(a,b),'evidence_invalid');
export function readActiveBookingHistoricalEvidence(closed){
 const old=read(closed.directory+'/current-observation.json');
 return{operationId:P.operationId,originalToolRevision:P.toolRevision,originalWindow:P.originalWindow,evidencePinsSha256:ACTIVE_BOOKING_HISTORICAL_PINS_SHA256,activationText:bookingHostRead(ROOT+'/activation.json'),ruleRepairText:bookingHostRead(ROOT+'/rule-repair.json'),closedReceiptText:bookingHostRead(closed.directory+'/closed.json'),legacyTermination:{oldPid:1590381,successorPid:P.legacyPid,signal:'SIGINT',exitCode:130,recordSequenceSha256:old.recordProof.sequenceSha256,observedAt:old.recordProof.observedAt}};
}
export function preflightActiveBookingPublicationMetadata({closed,qualification,toolRevision,window,history}){
 const proof=qualification.proof;need(proof?.toolRevision===toolRevision&&proof.kind==='active-incident-formal-qualification-completed','source_changed');
 const originalStageText=bookingHostRead(ROOT+'/primary-original-stage.json'),historical=reviewedActiveBookingHistoricalEvidence(readActiveBookingHistoricalEvidence(closed),qualification),at=new Date().toISOString();
 assertActiveBookingHistoricalFreshness(historical,{toolRevision,window,completedAt:at,closedIncidentSha256:closed.closedSha256,nativeAcceptanceSha256:qualification.sha256});
 const stage=JSON.parse(originalStageText),prior=history.entries.at(-1);same(originalStageText,JSON.stringify(stage,null,2));need(prior?.active.target===P.legacyBaseline&&stage.status==='database-ready'&&stage.target===P.candidate&&stage.baseline===P.legacyBaseline&&stage.retentionHeadSha256===history.headSha256,'evidence_invalid');same(stage.processes,prior.processes);same(stage.previousActive,Object.fromEntries(['target','name','directory','port'].map(k=>[k,prior.active[k]])));
 same(bookingHostRead(RELEASE+'/'+P.candidate+'/state.json'),originalStageText);same(bookingHostRead(RELEASE+'/active.json'),M.afterText);
 return{kind:'active-booking-publication-metadata-provenance-preflight',toolRevision,window,closedIncidentSha256:closed.closedSha256,qualificationSha256:qualification.sha256,qualificationCompletedAt:proof.completedAt,historicalClosureCompletedAt:JSON.parse(historical.closedReceiptText).completedAt,originalStageSha256:sha256(originalStageText),historicalEvidenceSha256:sha256(canonicalJson(historical)),observedAt:at,processControlPerformed:false,metadataWritten:false,businessDataWritten:false,publicationAuthority:false};
}
