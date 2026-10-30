// Explicitly approved active-generation continuation. These are pure contracts
// and sequencing seams, NOT production admission or a caller-supplied actuator.
// Existing inactive handoff, history and failure receipts stay immutable.
import {isDeepStrictEqual} from 'node:util';
import {BOOKING_HANDOFF_CANDIDATE as C,BOOKING_HANDOFF_APPLICATION as A,BOOKING_HANDOFF_BASELINE as B,BOOKING_HANDOFF_PM2_PROVENANCE,assertBookingHandoffWindow,assertBookingLegacyTaskTransition,assertBookingLegacyEnvironmentTransition} from './booking-handoff-policy.mjs';
import {assertManagedPauseEnvironmentDelta} from './release-toolchain-pm2-transition.mjs';
import {sha256} from './release-toolchain-contracts.mjs';
export const ACTIVE_BOOKING_INCIDENT=Object.freeze({operationId:'b49808d6-1950-4cb4-b029-97086873d7a7',toolRevision:'0fdad28d24245a84f7ced1656b5e1f2313bee0e7',generation:'9b85e75c-f474-4b17-b2a5-75601f7940b4',candidate:C,compatibleRollback:A,legacyBaseline:B,legacyPid:3902224,legacyRestartCount:1,privateWorkerPid:3889167,originalWindow:Object.freeze({id:'b49808d6-1950-4cb4-b029-97086873d7a7',startedAt:'2026-10-28T18:49:45.425Z',deadlineAt:'2026-10-28T18:59:45.425Z'})});
export const ACTIVE_BOOKING_METADATA=Object.freeze({
 beforeText:JSON.stringify({target:B,port:3103,directory:'/www/wwwroot/merchant-space.web-releases/'+B.slice(0,12)+'-online',name:'merchant-space-online-'+B.slice(0,12)}),
 afterText:JSON.stringify({target:A,port:3110,directory:'/www/wwwroot/merchant-space.web-releases/'+A.slice(0,12)+'-online',name:'merchant-space-online-'+A.slice(0,12)}),
});
// PM2's daemon-local log uses a different timezone from ISO UTC evidence.
// Preserve literal observed records; never reinterpret their timestamp as UTC.
export const ACTIVE_BOOKING_PM2_RECORDS=Object.freeze([
 '2026-10-29T02:50:22: PM2 log: App [merchant-space:0] exited with code [130] via signal [SIGINT]',
 '2026-10-29T02:50:22: PM2 log: pid=1590381 msg=process killed',
 '2026-10-29T02:50:22: PM2 log: App [merchant-space:0] starting in -fork mode-',
 '2026-10-29T02:50:22: PM2 log: App [merchant-space:0] online',
]);
const need=(v,c)=>{if(!v)throw Error('active_booking_'+c);},object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const hash=/^[a-f0-9]{64}(?![\s\S])/;
function keys(v,n){need(object(v)&&isDeepStrictEqual(Object.keys(v).sort(),[...n].sort()),'shape');}
function iso(value){const ms=Date.parse(value);need(typeof value==='string'&&Number.isFinite(ms)&&new Date(ms).toISOString()===value,'observation_time');return ms;}
export function assertActiveBookingWindow(window,{nowMs=Date.now()}={}){
 const result=assertBookingHandoffWindow(window,{nowMs});need(window.id!==ACTIVE_BOOKING_INCIDENT.operationId&&result.deadlineAtMs-result.startedAtMs===600000&&result.startedAtMs>Date.parse(ACTIVE_BOOKING_INCIDENT.originalWindow.deadlineAt),'new_window_required');return result;
}
export function assertActiveBookingDatabase(database,{systemIdentifier,databaseOid,generation=ACTIVE_BOOKING_INCIDENT.generation}={}){
 keys(database,['systemIdentifier','databaseOid','serverVersionNum','generation','revision','protocol','active','savedBookingRowsSha256','commands','mailJobs']);
 need(/^[1-9][0-9]{0,19}(?![\s\S])/.test(systemIdentifier??'')&&/^[1-9][0-9]{0,9}(?![\s\S])/.test(databaseOid??'')&&database.systemIdentifier===systemIdentifier&&database.databaseOid===databaseOid&&database.serverVersionNum==='150008'&&database.active===true&&database.protocol===2&&database.generation===generation&&typeof database.revision==='string'&&/^(0|[1-9][0-9]{0,18})(?![\s\S])/.test(database.revision)&&BigInt(database.revision)<=9223372036854775807n&&typeof database.savedBookingRowsSha256==='string'&&hash.test(database.savedBookingRowsSha256)&&['commands','mailJobs'].every(k=>Number.isSafeInteger(database[k])&&database[k]>=0),'active_database');
 return true;
}
// Live atomic bookings may advance while metadata/configuration is reconciled.
// This is never permission to restore an older JSON snapshot or replay SQL.
export function assertActiveBookingDatabaseProgress(before,after,identity){
 assertActiveBookingDatabase(before,identity);assertActiveBookingDatabase(after,identity);
 const earlier=BigInt(before.revision),later=BigInt(after.revision);
 need(later>=earlier&&after.commands>=before.commands&&after.mailJobs>=before.mailJobs&&(after.savedBookingRowsSha256===before.savedBookingRowsSha256||later>earlier),'active_database_regression');return true;
}
// Host/configuration comparison only. Metadata transitions are checked by the
// caller separately. Legitimate committed booking progress is not rolled back
// or mistaken for a release-tool mutation; all identity/generation checks stay.
export function assertActiveBookingObservedHostProgress(before,after){
 assertActiveBookingDatabaseProgress(before.database,after.database,{systemIdentifier:'7612049595342295079',databaseOid:'5'});
 const stable=value=>{const copy=structuredClone(value);for(const key of ['observedAt','metadataCorrected','activeMetadataSha256'])delete copy[key];for(const key of ['revision','commands','mailJobs','savedBookingRowsSha256'])delete copy.database[key];delete copy.historicalPause.observedAt;delete copy.recordProof.observedAt;copy.publicProof=copy.publicProof.map(({origin,status,buildId})=>({origin,status,buildId}));return copy;};
 need(isDeepStrictEqual(stable(before),stable(after)),'observed_host_change');return true;
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
export function assertHistoricalPausedBookingHost(value,recordProof,newWindow,{nowMs=Date.now()}={}){
 keys(value,['beforeRaw','afterRaw','beforeConfigured','afterConfigured','legacyBefore','legacyAfter','beforePmUptime','afterPmUptime','beforePmDerived','afterPmDerived','framework','window','observedAt']);
 assertActiveBookingWindow(newWindow,{nowMs});need(isDeepStrictEqual(value.window,ACTIVE_BOOKING_INCIDENT.originalWindow),'historical_window');
 assertBookingLegacyTaskTransition(value.legacyBefore,value.legacyAfter);assertBookingLegacyEnvironmentTransition(value.beforeConfigured,value.afterConfigured);
 assertManagedPauseEnvironmentDelta(value,{framework:BOOKING_HANDOFF_PM2_PROVENANCE,expectedExitCode:130});
 need(value.legacyAfter.pid===ACTIVE_BOOKING_INCIDENT.legacyPid&&value.legacyAfter.restartCount===ACTIVE_BOOKING_INCIDENT.legacyRestartCount,'historical_successor');
 const original=assertBookingHandoffWindow(value.window),observed=iso(value.observedAt);
 need(value.beforePmUptime>=value.legacyBefore.createdAt&&value.beforePmUptime<=original.startedAtMs&&value.legacyAfter.createdAt>=original.startedAtMs&&value.legacyAfter.createdAt<=value.afterPmUptime&&value.afterPmUptime>value.beforePmUptime&&value.afterPmUptime<original.deadlineAtMs&&observed>=iso(newWindow.startedAt)&&observed<=nowMs&&observed<iso(newWindow.deadlineAt),'historical_current_observation');
 keys(recordProof,['kind','file','identity','fromOffset','toOffset','sequenceSha256','observedAt','observationOfExistingRecords','eventTimeNotReissued','publicationAuthority']);
 keys(recordProof.identity,['dev','ino','uid','mode','nlink']);
 const expected=sha256(ACTIVE_BOOKING_PM2_RECORDS.join('\n')+'\n'),r=recordProof;
 need(r.kind==='pm2-existing-record-sequence-observation'&&r.file==='/root/.pm2/pm2.log'&&r.sequenceSha256===expected&&Number.isSafeInteger(r.fromOffset)&&r.fromOffset>=0&&Number.isSafeInteger(r.toOffset)&&r.toOffset<=64*1024**2&&r.toOffset===r.fromOffset+Buffer.byteLength(ACTIVE_BOOKING_PM2_RECORDS.join('\n')+'\n')&&r.identity.uid===0&&r.identity.nlink===1&&Number.isSafeInteger(r.identity.dev)&&r.identity.dev>=0&&Number.isSafeInteger(r.identity.ino)&&r.identity.ino>0&&Number.isSafeInteger(r.identity.mode)&&(r.identity.mode&0o170000)===0o100000&&!(r.identity.mode&0o022)&&r.observationOfExistingRecords===true&&r.eventTimeNotReissued===true&&r.publicationAuthority===false&&iso(r.observedAt)>=iso(newWindow.startedAt)&&iso(r.observedAt)<=observed,'historical_log_observation');
 return{kind:'currently-observed-historical-booking-pause',oldOperationId:ACTIVE_BOOKING_INCIDENT.operationId,observedAt:value.observedAt,legacyPid:value.legacyAfter.pid,paused:true,newRestartPerformed:false,publicationAuthority:false};
}
export const ACTIVE_RECONCILIATION_STEPS=Object.freeze(['inspect','sourceAndCi','freshBackup','freshCompatibility','begin','preserveFailureEvidence','reconcileMetadata','persistProcesses','verifyPostconditions','sealClosure','archiveOldOperation','complete']);
// The new handoff hash includes the actual persistence receipt: persist the
// unchanged live process set BEFORE constructing final publication metadata.
// Otherwise metadata -> handoff -> persistence -> metadata is circular.
export const ACTIVE_PUBLICATION_STEPS=Object.freeze(['inspect','sourceAndCi','freshBackup','freshCompatibility','freshRollbackReadiness','prepareGatedWorker','admit','armSupervisor','gateAndDrain','routePrimary','unfence','publicProof','persistProcesses','publicationMetadata','certificate','enableBookingWorker','finalAudit','finishSupervisor']);
export const ACTIVE_RECOVERY_STEPS=Object.freeze(['inspect','parentGone','databaseBarrier','disableBookingWorker','routeCompatibleRollback','unfence','publicProof','publicationMetadata','persistProcesses','complete']);
async function sequence(steps,operations){
 let last,stage='startup';try{for(const name of steps){stage=name;const started=performance.now();await operations.assertHeld();if(operations.progress)await operations.progress(name);if(operations.stageTiming)await operations.stageTiming({stage:name,phase:'started',elapsedMs:0});last=await operations[name]();await operations.assertHeld();if(operations.stageTiming)await operations.stageTiming({stage:name,phase:'completed',elapsedMs:Math.ceil(performance.now()-started)});}return last;
 }catch(error){if(operations.failure)try{await operations.failure(error,stage);}catch{/* Original error and unknown result must survive diagnostic failure. */}throw error;}
}
export const executeActiveBookingReconciliation=operations=>sequence(ACTIVE_RECONCILIATION_STEPS,operations);
export const executeActiveBookingPublication=operations=>sequence(ACTIVE_PUBLICATION_STEPS,operations);
export const executeActiveBookingRecovery=operations=>sequence(ACTIVE_RECOVERY_STEPS,operations);
