// Fresh live checks only. Historical evidence is fully verified immediately
// before the publication window and again after the gated worker transition.
// This reader cannot mint publication authority, control a process or renew a window.
import {isDeepStrictEqual} from 'node:util';
import {ACTIVE_BOOKING_INCIDENT as P,assertActiveBookingWindow,assertActiveBookingDatabaseProgress} from './release-toolchain-active-generation-contract.mjs';
import {ACTIVE_INCIDENT_ROOT} from './release-toolchain-active-generation-incident.mjs';
import {assertOnlineRetentionHeldLocks} from './online-release-retention-writer.mjs';
import {reviewedBookingExecution} from './release-toolchain-authority.mjs';
import {observeUnchangedPreIntentHost} from './release-toolchain-pre-intent-evidence.mjs';
import {assertBookingRoutingCurrent} from './booking-handoff-routing.mjs';
import {WEB_RELEASE_FILES,WEB_RELEASE_PROXY} from './web-presentation-release-policy.mjs';
import {BOOKING_FORMAL_PILOT_IDS} from './booking-formal-backup-policy.mjs';
import {bookingHostRead,bookingHostRun} from './booking-handoff-host-io.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
const same=(a,b)=>need(isDeepStrictEqual(a,b),'observation_mismatch');
export async function observeActiveBookingWorkerCurrentPreflight({lock,toolRevision,window,databaseBefore}){
 assertOnlineRetentionHeldLocks(lock);assertActiveBookingWindow(window);const authority=reviewedBookingExecution(toolRevision);
 need(authority?.prepared.activeIncidentClosed?.toolRevision===toolRevision,'source_changed');
 const verify=()=>{
  assertOnlineRetentionHeldLocks(lock);assertActiveBookingWindow(window);need(reviewedBookingExecution(toolRevision)===authority,'source_changed');
  const routing=JSON.parse(bookingHostRead(ACTIVE_INCIDENT_ROOT+'/routing-plan.json')),ingress=JSON.parse(bookingHostRead(ACTIVE_INCIDENT_ROOT+'/ingress-plan.json'));
  same(bookingHostRead(ingress.file,{privateMode:false}),ingress.beforeText);
  assertBookingRoutingCurrent(routing,Object.fromEntries(WEB_RELEASE_FILES.map(name=>[name,bookingHostRead(WEB_RELEASE_PROXY+'/'+name,{privateMode:false})])),{phase:'rollback'});
  const pilots=bookingHostRun('docker',['inspect','--format','{{json .State.Running}}',...BOOKING_FORMAL_PILOT_IDS]).trim().split('\n');
  need(pilots.length===5&&pilots.every(value=>value==='false'),'owned_resource_changed');
 };
 verify();let current;if(authority.prepared.recoveredPublication){const{observeRecoveredPublicationWorkerPreflight}=await import('./release-toolchain-recovered-publication-host.mjs');current=await observeRecoveredPublicationWorkerPreflight({lock,toolRevision});}else if(authority.prepared.originRecovered){const{observeOriginRecoveryWorkerPreflight}=await import('./release-toolchain-origin-recovery-closure.mjs');current=await observeOriginRecoveryWorkerPreflight({lock,toolRevision});}else current=await observeUnchangedPreIntentHost(databaseBefore,{verify});verify();
 return{kind:'active-booking-worker-current-preflight',toolRevision,inventorySha256:authority.tool.inventorySha256,window:structuredClone(window),databaseBeforeSha256:sha256(canonicalJson(databaseBefore)),current,proxyRollbackVerified:true,ingressRestored:true,formalPilotsStopped:true,processControlPerformed:false,processSavePerformed:false,businessDataWritten:false,mailEnabled:false,publicationAuthority:false};
}
// Proof reader only. A serialized report never substitutes for the live reader
// above or the actual private publication scope.
export function assertActiveBookingWorkerCurrentPreflight(proof,{toolRevision,inventorySha256,window,databaseBefore}){
 need(proof?.kind==='active-booking-worker-current-preflight'&&proof.toolRevision===toolRevision&&proof.inventorySha256===inventorySha256,'evidence_invalid');same(proof.window,window);same(proof.databaseBeforeSha256,sha256(canonicalJson(databaseBefore)));
 for(const key of ['proxyRollbackVerified','ingressRestored','formalPilotsStopped'])need(proof[key]===true,'evidence_invalid');
 for(const key of ['processControlPerformed','processSavePerformed','businessDataWritten','mailEnabled','publicationAuthority'])need(proof[key]===false,'evidence_invalid');
 const current=proof.current;need(current?.actualRoute===P.compatibleRollback&&current.actualWorkerUnchanged===true,'evidence_invalid');
 for(const key of ['gateEnabled','processControlPerformed','mailEnabled','publicationAuthority'])need(current[key]===false,'evidence_invalid');
 const at=Date.parse(current.observedAt);need(Number.isFinite(at)&&new Date(at).toISOString()===current.observedAt&&at<=Date.now(),'evidence_invalid');assertActiveBookingWindow(window,{nowMs:at});
 assertActiveBookingDatabaseProgress(databaseBefore,current.database,{systemIdentifier:'7612049595342295079',databaseOid:'5'});
 need(Array.isArray(current.publicProof)&&current.publicProof.length===2&&new Set(current.publicProof.map(p=>p.origin)).size===2&&current.publicProof.every(p=>['https://faolla.com','https://launch.faolla.com'].includes(p.origin)&&p.status===200&&p.buildId===P.compatibleRollback),'evidence_invalid');return true;
}
