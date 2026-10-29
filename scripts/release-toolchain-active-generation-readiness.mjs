// New read-only rollback observation. No timestamp rewriting, build, process
// control or reuse of old readiness as a newly performed observation.
import * as fs from 'node:fs';import {isDeepStrictEqual} from 'node:util';
import {ACTIVE_BOOKING_INCIDENT as P,assertActiveBookingWindow} from './release-toolchain-active-generation-contract.mjs';
import {ACTIVE_ROLLBACK_REVALIDATED_KIND,ACTIVE_ROLLBACK_ORIGINAL_READINESS_SHA256,assertActiveBookingRollbackReadiness} from './release-toolchain-active-generation-readiness-contract.mjs';
import {inspectClosedActiveBookingIncidentUnderHeldLocks} from './release-toolchain-active-generation-closed-incident.mjs';
import {verifyLatestActiveBookingQualification} from './release-toolchain-active-generation-qualification.mjs';
import {observeBookingCompatibility} from './release-toolchain-booking-admission.mjs';
import {observeBookingReadyApplication} from './booking-ready-backup.mjs';
import {reviewedBookingExecution} from './release-toolchain-authority.mjs';
import {assertOnlineRetentionHeldLocks} from './online-release-retention-writer.mjs';
import {assertBookingRollbackReadiness} from './booking-handoff-retention.mjs';
import {assertBookingAtomicCohort} from './booking-handoff-policy.mjs';
import {normalizeRetirementProcess} from './online-release-retirement.mjs';
import {collectFormalBookingPm2Registry} from './release-toolchain-pm2-observation.mjs';
import {captureProcessFact} from './check-production-runtime-supervision.mjs';
import {webReleaseRuntimeEnvironment} from './web-presentation-release-policy.mjs';
import {bookingHostRead} from './booking-handoff-host-io.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
import {rollingHash} from './online-release-rolling-policy.mjs';
const ROOT='/var/lib/faolla-booking-handoff/'+P.candidate,RELEASE='/var/lib/faolla-online-release';
const same=(a,b)=>need(isDeepStrictEqual(a,b),'observation_mismatch'),location=value=>Object.fromEntries(['target','name','directory','port'].map(key=>[key,value[key]]));
async function localBuild(target,port,verify){
 verify();const response=await fetch('http://127.0.0.1:'+port+'/api/app-web-version',{headers:{Host:'www.faolla.com',Connection:'close'},redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(5000)});
 need(response.status===200,'operation_unconfirmed');const reader=response.body?.getReader();need(reader,'operation_unconfirmed');let bytes=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true});
 try{for(;;){const part=await reader.read();if(part.done){text+=decoder.decode();break;}bytes+=part.value.byteLength;need(bytes<=4096,'evidence_invalid');text+=decoder.decode(part.value,{stream:true});}}finally{await reader.cancel().catch(()=>{});}
 const value=JSON.parse(text);need(value.ok===true&&value.buildId===target,'observation_mismatch');verify();return{origin:'http://127.0.0.1:'+port,status:200,ok:true,buildId:target};
}
export async function observeActiveBookingRollbackReadiness({lock,toolRevision,window}){
 assertOnlineRetentionHeldLocks(lock);assertActiveBookingWindow(window);const authority=reviewedBookingExecution(toolRevision);need(authority?.prepared.activeIncidentClosed?.oldOperationId===P.operationId&&authority.prepared.activeIncidentClosed.toolRevision===toolRevision,'evidence_invalid');
 const held=()=>{assertOnlineRetentionHeldLocks(lock);assertActiveBookingWindow(window);need(reviewedBookingExecution(toolRevision)===authority,'source_changed');};
 const closed=await inspectClosedActiveBookingIncidentUnderHeldLocks({lock,toolRevision});same(closed.closedSha256,authority.prepared.activeIncidentClosed.closedSha256);const qualification=verifyLatestActiveBookingQualification({lock,toolRevision});same(qualification.sha256,closed.qualificationSha256);
 const compatibilitySha256=rollingHash(observeBookingCompatibility(qualification.native));same(observeBookingReadyApplication(),authority.prepared.application);held();
 const physical=collectFormalBookingPm2Registry(),processes=physical.rows.map(normalizeRetirementProcess),anchors={},runtimeByName={};
 for(const target of [P.candidate,P.compatibleRollback]){const state=JSON.parse(bookingHostRead(RELEASE+'/'+target+'/state.json')),row=processes.find(process=>process.name===state.name);need(row?.status==='online','owned_resource_changed');anchors[target]={...location(state),process:row};const saved=JSON.parse(bookingHostRead(RELEASE+'/'+target+'/atomic-runtime.json')),actual=webReleaseRuntimeEnvironment(fs.readFileSync('/proc/'+row.pid+'/environ','utf8'));for(const [key,value]of Object.entries(saved))same(actual[key],value);runtimeByName[state.name]=actual;}
 assertBookingAtomicCohort({active:anchors[P.candidate],rollback:anchors[P.compatibleRollback],runtimeByName});const rollback=anchors[P.compatibleRollback],identity=captureProcessFact(rollback.process.pid);
 const originalText=bookingHostRead(ROOT+'/rollback-readiness.json');need(sha256(originalText)===ACTIVE_ROLLBACK_ORIGINAL_READINESS_SHA256,'evidence_invalid');const original=JSON.parse(originalText),stateText=bookingHostRead(RELEASE+'/'+P.compatibleRollback+'/state.json');same(original.stateText,stateText);
 // Verify the historical proof in its ORIGINAL window, not the new one.
 assertBookingRollbackReadiness(original,rollback,{window:P.originalWindow,compatibilitySha256:original.compatibilitySha256,rollbackReadinessSha256:rollingHash(original)});
 const pins={buildEvidenceSha256:sha256(bookingHostRead(RELEASE+'/'+P.compatibleRollback+'/attendance-build-proof.json')),runtimeSha256:sha256(bookingHostRead(RELEASE+'/'+P.compatibleRollback+'/atomic-runtime.json')),environmentFileSha256:sha256(bookingHostRead(rollback.directory+'/.env.local',{binary:true}))};for(const [key,value]of Object.entries(pins))same(original[key],value);
 const verify=()=>{held();same(captureProcessFact(rollback.process.pid),identity);same(bookingHostRead(RELEASE+'/'+P.compatibleRollback+'/state.json'),stateText);same(sha256(bookingHostRead(ROOT+'/rollback-readiness.json')),ACTIVE_ROLLBACK_ORIGINAL_READINESS_SHA256);};
 const http=await localBuild(P.compatibleRollback,rollback.port,verify);same(collectFormalBookingPm2Registry().filteredRegistry,physical.filteredRegistry);verify();
 const readiness={schemaVersion:2,kind:ACTIVE_ROLLBACK_REVALIDATED_KIND,candidate:P.candidate,target:P.compatibleRollback,stateText,...pins,compatibilitySha256,originalReadinessSha256:ACTIVE_ROLLBACK_ORIGINAL_READINESS_SHA256,window,observedAt:new Date().toISOString(),processSha256:sha256(canonicalJson(rollback.process)),http};
 assertActiveBookingRollbackReadiness(readiness,rollback,{schemaVersion:2,kind:'booking-active-generation-handoff',window,completedAt:readiness.observedAt,compatibilitySha256,rollbackReadinessSha256:rollingHash(readiness)});verify();return{readiness,rollback,compatibilitySha256,publicationAuthority:false};
}
