// Preparation for the separately approved ACTIVE incident. The original
// inactive preparation verifier is unchanged and continues to refuse it.
import {randomUUID} from 'node:crypto';
import {BOOKING_PREPARATION_REVISION} from './release-toolchain-booking-profile.mjs';
import {ACTIVE_BOOKING_INCIDENT as P} from './release-toolchain-active-generation-contract.mjs';
import {ACTIVE_INCIDENT_FILES,inspectActiveBookingIncident} from './release-toolchain-active-generation-incident.mjs';
import {observeBookingReadyApplication} from './booking-ready-backup.mjs';
import {inspectPinnedExecutionSource} from './release-toolchain-source.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
export async function verifyActiveBookingIncidentPreparation(revision){
 need(revision===BOOKING_PREPARATION_REVISION,'source_changed');
 const source=inspectPinnedExecutionSource({revision,directory:'/var/lib/faolla-online-code/'+revision}),start=Date.now(),window={id:randomUUID(),startedAt:new Date(start).toISOString(),deadlineAt:new Date(start+600000).toISOString()};
 await inspectActiveBookingIncident({window});
 const application=observeBookingReadyApplication();need(application[P.candidate]?.target===P.candidate&&application[P.compatibleRollback]?.target===P.compatibleRollback,'build_binding_mismatch');
 // Stable preparation identity, not a reissued old runtime/activation receipt.
 return{revision,inventorySha256:source.inventorySha256,application,activeIncident:{operationId:P.operationId,generation:P.generation,originalTool:P.toolRevision,evidencePinsSha256:sha256(canonicalJson(ACTIVE_INCIDENT_FILES)),databaseAlreadyActive:true,activationReplayAllowed:false,legacyRestartAllowed:false,mailEnabled:false}};
}
