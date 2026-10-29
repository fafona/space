// A new edge from the already-active compatible rollback to C. No armed/B
// phase, activation SQL, legacy restart, file IO or production authority here.
import {isDeepStrictEqual} from 'node:util';
import {assertBookingAtomicRoutingPlan} from './booking-handoff-routing.mjs';
import {ACTIVE_BOOKING_INCIDENT as P,assertActiveBookingWindow} from './release-toolchain-active-generation-contract.mjs';
import {WEB_RELEASE_FILES} from './web-presentation-release-policy.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
export const ACTIVE_ORIGINAL_ROUTING_SHA256='706fdf61115e7c761dd5062d09c8f6efc09a13243e03607669e649c970860601';
const same=(a,b)=>need(isDeepStrictEqual(a,b),'observation_mismatch'),text=value=>canonicalJson(value)+'\n';
export function createActiveBookingRoutingPlan({originalPlan,window}){
 assertBookingAtomicRoutingPlan(originalPlan);
 need(sha256(text(originalPlan))===ACTIVE_ORIGINAL_ROUTING_SHA256,'evidence_invalid');same(originalPlan.window,P.originalWindow);
 // Structural historical verification must not renew or edit a past window.
 assertActiveBookingWindow(window,{nowMs:Date.parse(window?.startedAt)});
 return{schemaVersion:1,kind:'booking-already-active-atomic-routing',window:structuredClone(window),originalPlanSha256:ACTIVE_ORIGINAL_ROUTING_SHA256,
  primary:structuredClone(originalPlan.primary),rollback:structuredClone(originalPlan.rollback),before:structuredClone(originalPlan.phases.rollback),
  phases:{primary:structuredClone(originalPlan.phases.primary),rollback:structuredClone(originalPlan.phases.rollback)}};
}
export function assertActiveBookingRoutingPlan(plan,originalPlan){same(plan,createActiveBookingRoutingPlan({originalPlan,window:plan?.window}));return true;}
export function assertActiveBookingRoutingCurrent(plan,originalPlan,current,{phase}={}){
 assertActiveBookingRoutingPlan(plan,originalPlan);same(Object.keys(current).sort(),[...WEB_RELEASE_FILES].sort());
 if(phase!==undefined){need(['primary','rollback'].includes(phase),'invalid_contract');same(current,plan.phases[phase]);}
 else for(const file of WEB_RELEASE_FILES)need(Object.values(plan.phases).some(value=>value[file]===current[file]),'owned_resource_changed');
 return true;
}
// Operations are an algorithm/testing seam, not a formal host adapter. The real
// adapter must independently prove held kernel locks, source, live supervisor,
// active-generation barrier and booking-only drain before its first rename.
export async function executeActiveBookingRoutingPhase(operations,plan,originalPlan,phase){
 assertActiveBookingRoutingPlan(plan,originalPlan);need(['primary','rollback'].includes(phase),'invalid_contract');
 const before=await operations.read();assertActiveBookingRoutingCurrent(plan,originalPlan,before);
 if(phase==='primary')same(before,plan.before);
 await operations.authorize(phase,plan);await operations.begin({kind:'active-booking-routing-attempt',phase,before,at:operations.now()});
 same(await operations.read(),before);
 for(const file of WEB_RELEASE_FILES)await operations.replace(file,before[file],plan.phases[phase][file]);
 assertActiveBookingRoutingCurrent(plan,originalPlan,await operations.read(),{phase});
 await operations.syntax();await operations.reload();await operations.verify(phase);
 assertActiveBookingRoutingCurrent(plan,originalPlan,await operations.read(),{phase});
 const receipt={schemaVersion:1,kind:'booking-already-active-routing-applied',phase,planSha256:sha256(text(plan)),
  files:Object.fromEntries(WEB_RELEASE_FILES.map(file=>[file,sha256(plan.phases[phase][file])])),activationPerformed:false,legacyRestartPerformed:false,completedAt:operations.now()};
 await operations.complete(receipt);return receipt;
}
