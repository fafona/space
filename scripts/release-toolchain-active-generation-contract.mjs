// Explicitly approved active-generation continuation. These are pure contracts
// and sequencing seams, NOT production admission or a caller-supplied actuator.
// Existing inactive handoff, history and failure receipts stay immutable.
import {isDeepStrictEqual} from 'node:util';
import {BOOKING_HANDOFF_CANDIDATE as C,BOOKING_HANDOFF_APPLICATION as A,BOOKING_HANDOFF_BASELINE as B,assertBookingHandoffWindow} from './booking-handoff-policy.mjs';
export const ACTIVE_BOOKING_INCIDENT=Object.freeze({operationId:'b49808d6-1950-4cb4-b029-97086873d7a7',toolRevision:'0fdad28d24245a84f7ced1656b5e1f2313bee0e7',generation:'9b85e75c-f474-4b17-b2a5-75601f7940b4',candidate:C,compatibleRollback:A,legacyBaseline:B,legacyPid:3902224,legacyRestartCount:1,privateWorkerPid:3889167,originalWindow:Object.freeze({id:'b49808d6-1950-4cb4-b029-97086873d7a7',startedAt:'2026-10-28T18:49:45.425Z',deadlineAt:'2026-10-28T18:59:45.425Z'})});
const need=(v,c)=>{if(!v)throw Error('active_booking_'+c);},object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const hash=/^[a-f0-9]{64}(?![\s\S])/;
function keys(v,n){need(object(v)&&isDeepStrictEqual(Object.keys(v).sort(),[...n].sort()),'shape');}
export function assertActiveBookingWindow(window,{nowMs=Date.now()}={}){
 const result=assertBookingHandoffWindow(window,{nowMs});need(window.id!==ACTIVE_BOOKING_INCIDENT.operationId&&result.deadlineAtMs-result.startedAtMs===600000&&result.startedAtMs>Date.parse(ACTIVE_BOOKING_INCIDENT.originalWindow.deadlineAt),'new_window_required');return result;
}
export function assertActiveBookingDatabase(database,{systemIdentifier,databaseOid,generation=ACTIVE_BOOKING_INCIDENT.generation}={}){
 keys(database,['systemIdentifier','databaseOid','serverVersionNum','generation','revision','protocol','active','savedBookingRowsSha256','commands','mailJobs']);
 need(/^[1-9][0-9]{0,19}(?![\s\S])/.test(systemIdentifier??'')&&/^[1-9][0-9]{0,9}(?![\s\S])/.test(databaseOid??'')&&database.systemIdentifier===systemIdentifier&&database.databaseOid===databaseOid&&database.serverVersionNum==='150008'&&database.active===true&&database.protocol===2&&database.generation===generation&&/^(0|[1-9][0-9]*)(?![\s\S])/.test(database.revision)&&hash.test(database.savedBookingRowsSha256)&&['commands','mailJobs'].every(k=>Number.isSafeInteger(database[k])&&database[k]>=0),'active_database');
 return true;
}
export function assertActiveBookingHistoricalEvidence({lease,activation,originalPause,recoveryAttempt,failure}){
 const p=ACTIVE_BOOKING_INCIDENT;need(lease?.toolRevision===p.toolRevision&&isDeepStrictEqual(lease.window,p.originalWindow)&&originalPause?.window?.id===p.operationId&&failure?.operationId===p.operationId&&recoveryAttempt?.operationId===p.operationId,'incident_binding');
 need(activation?.before?.active===false&&activation?.after?.active===true&&activation.before.protocol===2&&activation.before.generation===p.generation,'historical_activation');
 need(isDeepStrictEqual(activation.after,{...activation.before,active:true}),'historical_activation_delta');
 need(originalPause.before?.legacy?.pid===1590381&&originalPause.before.legacy.backgroundPaused==='0','original_legacy');
 const old=recoveryAttempt.before?.processes?.filter(v=>v.name==='merchant-space');need(old?.length===1&&old[0].pid===p.legacyPid&&old[0].backgroundPaused==='1'&&old[0].restartCount===p.legacyRestartCount,'observed_paused_successor');
 const observed=Date.parse(recoveryAttempt.startedAt);need(Number.isFinite(observed)&&observed>=Date.parse(lease.window.startedAt)&&observed<Date.parse(lease.window.deadlineAt),'historical_observation');
 // No normal completion is inferred from this historical interrupted attempt.
 return{kind:'historical-active-booking-incident',operationId:p.operationId,generation:p.generation,publicationCompleted:false,publicationAuthority:false};
}
export const ACTIVE_RECONCILIATION_STEPS=Object.freeze(['inspect','sourceAndCi','freshBackup','freshCompatibility','begin','preserveFailureEvidence','reconcileMetadata','persistProcesses','verifyPostconditions','sealClosure','archiveOldOperation','complete']);
export const ACTIVE_PUBLICATION_STEPS=Object.freeze(['inspect','sourceAndCi','freshBackup','freshCompatibility','freshRollbackReadiness','prepareGatedWorker','admit','armSupervisor','gateAndDrain','routePrimary','unfence','publicProof','publicationMetadata','persistProcesses','certificate','enableBookingWorker','finishSupervisor','finalAudit']);
export const ACTIVE_RECOVERY_STEPS=Object.freeze(['inspect','parentGone','databaseBarrier','disableBookingWorker','routeCompatibleRollback','unfence','publicProof','publicationMetadata','persistProcesses','complete']);
async function sequence(steps,operations){
 let last,stage='startup';try{for(const name of steps){stage=name;await operations.assertHeld();if(operations.progress)await operations.progress(name);last=await operations[name]();await operations.assertHeld();}return last;
 }catch(error){if(operations.failure)try{await operations.failure(error,stage);}catch{/* Original error and unknown result must survive diagnostic failure. */}throw error;}
}
export const executeActiveBookingReconciliation=operations=>sequence(ACTIVE_RECONCILIATION_STEPS,operations);
export const executeActiveBookingPublication=operations=>sequence(ACTIVE_PUBLICATION_STEPS,operations);
export const executeActiveBookingRecovery=operations=>sequence(ACTIVE_RECOVERY_STEPS,operations);
