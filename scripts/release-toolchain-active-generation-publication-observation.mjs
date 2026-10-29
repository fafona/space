// Independent observation AFTER C is routed and booking ingress is restored.
// The post-metadata path requires the writer's genuine in-memory completed
// context; caller JSON cannot authorize a different active/state file.
import * as fs from 'node:fs';import {isDeepStrictEqual} from 'node:util';
import {ACTIVE_BOOKING_INCIDENT as P,ACTIVE_BOOKING_METADATA as M,assertActiveBookingDatabaseProgress} from './release-toolchain-active-generation-contract.mjs';
import {ACTIVE_INCIDENT_FILES,ACTIVE_INCIDENT_ROOT} from './release-toolchain-active-generation-incident.mjs';
import {activeBookingPublicationEvidence,assertActiveBookingPublicationLockBinding} from './release-toolchain-active-generation-publication-scope.mjs';
import {inspectLiveActiveBookingPublicationSupervisor} from './release-toolchain-active-generation-routing-host.mjs';import {observeActiveBookingPreparedWorker} from './release-toolchain-active-generation-worker.mjs';
import {assertActiveBookingRoutingPlan,assertActiveBookingRoutingCurrent} from './release-toolchain-active-generation-routing.mjs';import {assertActiveBookingIngressPlan} from './release-toolchain-active-generation-ingress.mjs';
import {assertBookingAtomicCohort} from './booking-handoff-policy.mjs';import {webReleaseRuntimeEnvironment,WEB_RELEASE_FILES,WEB_RELEASE_PROXY} from './web-presentation-release-policy.mjs';
import {collectActiveBookingLegacyHost} from './release-toolchain-pm2-observation.mjs';import {normalizeRetirementProcess} from './online-release-retirement.mjs';import {observeBookingReadyApplication} from './booking-ready-backup.mjs';
import {readOnlineRetentionHistory} from './online-release-retention.mjs';import {bookingHostRead,bookingHostSql} from './booking-handoff-host-io.mjs';import {bookingHandoffActivationSnapshotSql} from './booking-handoff-activation.mjs';
import {proveRecoveryTargets} from './release-toolchain-recovery-probe.mjs';import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
const RELEASE='/var/lib/faolla-online-release',ROOT=ACTIVE_INCIDENT_ROOT,same=(a,b)=>need(isDeepStrictEqual(a,b),'observation_mismatch'),read=file=>JSON.parse(bookingHostRead(file));
const location=value=>Object.fromEntries(['target','name','directory','port'].map(key=>[key,value[key]])),digest=file=>sha256(bookingHostRead(file));
export function assertActivePublicationObservationProgress(before,after){
 need(before?.kind==='active-booking-publication-current-observation'&&after?.kind===before.kind,'evidence_invalid');const strip=value=>{const copy=structuredClone(value);delete copy.database;delete copy.observedAt;return copy;};same(strip(before),strip(after));
 const first=Date.parse(before.observedAt),last=Date.parse(after.observedAt);need(Number.isFinite(first)&&Number.isFinite(last)&&new Date(first).toISOString()===before.observedAt&&new Date(last).toISOString()===after.observedAt&&last>=first,'evidence_invalid');assertActiveBookingDatabaseProgress(before.database,after.database,{systemIdentifier:'7612049595342295079',databaseOid:'5'});return true;
}
export async function observeActiveBookingPublicationBeforeMetadata(options){
 return observe(options,null);
}
export async function observeActiveBookingPublicationAfterMetadata(options){
 const {verifyActiveBookingPublicationMetadata}=await import('./release-toolchain-active-generation-publication-metadata-host.mjs');
 const metadata=verifyActiveBookingPublicationMetadata(options);
 return observe(options,metadata);
}
async function observe(options,metadata){
 const {scope,lock,toolRevision,window}=options,admission=assertActiveBookingPublicationLockBinding(scope,{lock,toolRevision,window}),evidence=activeBookingPublicationEvidence(scope);inspectLiveActiveBookingPublicationSupervisor(options);same(evidence.applicationBuilds,observeBookingReadyApplication());
 const directory=admission.directory,plan=read(directory+'/routing-plan.json'),original=read(ROOT+'/routing-plan.json'),gate=read(directory+'/ingress-plan.json'),closedGate=read(directory+'/ingress-completed.json');assertActiveBookingRoutingPlan(plan,original);assertActiveBookingIngressPlan(gate);same(plan.window,window);same(gate.window,window);same(closedGate.window,window);
 const history=metadata?(await import('./release-toolchain-active-generation-certificate.mjs')).activeBookingPublicationPriorHistory(options):readOnlineRetentionHistory();
 need(closedGate.kind==='active-booking-ingress-completed'&&closedGate.closed===true&&closedGate.beforeSha256===gate.beforeSha256&&closedGate.gatePlanSha256===digest(directory+'/ingress-plan.json')&&closedGate.routingReceiptSha256===digest(directory+'/routing-applied-primary.json')&&closedGate.businessDataWritten===false&&closedGate.mailEnabled===false,'evidence_invalid');
 const pins={routingPlanSha256:digest(directory+'/routing-plan.json'),routingReceiptSha256:digest(directory+'/routing-applied-primary.json'),ingressPlanSha256:digest(directory+'/ingress-plan.json'),ingressCompletedSha256:digest(directory+'/ingress-completed.json'),drainSha256:digest(directory+'/drain-completed.json')};
 const check=()=>{inspectLiveActiveBookingPublicationSupervisor(options);same(bookingHostRead(gate.file,{privateMode:false}),gate.beforeText);assertActiveBookingRoutingCurrent(plan,original,Object.fromEntries(WEB_RELEASE_FILES.map(file=>[file,bookingHostRead(WEB_RELEASE_PROXY+'/'+file,{privateMode:false})])),{phase:'primary'});
  if(metadata){same(bookingHostRead(RELEASE+'/active.json'),metadata.activeText);same(bookingHostRead(RELEASE+'/'+P.candidate+'/state.json'),metadata.stateText);same(digest(directory+'/publication-metadata-completed.json'),metadata.metadataSha256);same(digest(directory+'/handoff-proof.json'),metadata.handoffFileSha256);}
  else{same(bookingHostRead(RELEASE+'/active.json'),M.afterText);same(digest(RELEASE+'/'+P.candidate+'/state.json'),'7ba13be0b859c918a71481b469596d6f2ef430ba61b1fc1946471812fb5651d3');}
  same(digest(RELEASE+'/'+P.compatibleRollback+'/state.json'),'12a7590d9de39d10179d0b60d3730c0451c5ad9e2b9a6d22044a77fe0861be3d');
  for(const [name,bytes,hash]of ACTIVE_INCIDENT_FILES){const data=bookingHostRead(ROOT+'/'+name,{binary:true});need(data.length===bytes&&sha256(data)===hash,'evidence_invalid');}const archived=fs.lstatSync(evidence.closed.directory+'/operation.lock');need(archived.dev===64769&&archived.ino===3566178&&archived.uid===0&&archived.mode===0o40700&&fs.readdirSync(evidence.closed.directory+'/operation.lock').length===0,'owned_resource_changed');same(history.headSha256,read(evidence.closed.directory+'/closure-context.json').before.retentionHeadSha256);
  same(pins,{routingPlanSha256:digest(directory+'/routing-plan.json'),routingReceiptSha256:digest(directory+'/routing-applied-primary.json'),ingressPlanSha256:digest(directory+'/ingress-plan.json'),ingressCompletedSha256:digest(directory+'/ingress-completed.json'),drainSha256:digest(directory+'/drain-completed.json')});};check();
 const worker=observeActiveBookingPreparedWorker({lock,toolRevision,window,directory}),processes=worker.physical.rows.map(normalizeRetirementProcess).sort((a,b)=>a.pmId-b.pmId),runtimeByName={},anchors={};
 for(const target of [P.candidate,P.compatibleRollback]){const state=read(RELEASE+'/'+target+'/state.json'),process=processes.find(value=>value.name===state.name);need(process?.status==='online','owned_resource_changed');anchors[target]={...location(state),process};const actual=webReleaseRuntimeEnvironment(fs.readFileSync('/proc/'+process.pid+'/environ','utf8')),saved=read(RELEASE+'/'+target+'/atomic-runtime.json');for(const [key,value]of Object.entries(saved))same(actual[key],value);runtimeByName[state.name]=actual;}
 const cohort={active:anchors[P.candidate],rollback:anchors[P.compatibleRollback],processes,runtimeByName};assertBookingAtomicCohort(cohort);
 const publicProof=await proveRecoveryTargets({origins:['https://faolla.com','https://launch.faolla.com'],target:P.candidate,operationId:window.id,verify:check,deadlineAtMs:Math.min(Date.now()+30000,Date.parse(window.deadlineAt))});
 const physical=collectActiveBookingLegacyHost();same(physical.processes,worker.after.legacy.processes);same(physical.identityProofs,worker.after.legacy.identityProofs);same(physical.raw,worker.after.legacy.raw);
 const database=JSON.parse(bookingHostSql(bookingHandoffActivationSnapshotSql));assertActiveBookingDatabaseProgress(evidence.databaseBefore,database,{systemIdentifier:'7612049595342295079',databaseOid:'5'});check();
 const observation={kind:'active-booking-publication-current-observation',toolRevision,window,closedIncidentSha256:evidence.closed.closedSha256,workerPreparationSha256:worker.receiptSha256,...pins,processesSha256:sha256(canonicalJson(physical.processes)),identitiesSha256:sha256(canonicalJson(physical.identityProofs)),legacyEnvironmentSha256:sha256(canonicalJson(physical.raw)),publicProof:publicProof.map(({origin,status,buildId})=>({origin,status,buildId})),database,observedAt:new Date().toISOString()};
 return{observation,cohort,daemonPeer:worker.physical.daemonPeer,metadataPhase:metadata?'completed':'not-published',metadataSha256:metadata?.metadataSha256??null,publicationAuthority:false};
}
