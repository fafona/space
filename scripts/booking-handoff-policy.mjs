// User-approved 2026-10-26: PURE contract for the single booking-task handoff.
// No command, process signal, database write, history rewrite or activation is
// exposed here. Existing release paths stay strict; a separate reviewed
// retention adapter may append the single explicitly authorized handoff.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

export const BOOKING_HANDOFF_APPLICATION='6c5d5df31d06b43929e5ba5e6f3978dd51f1c6b0';
export const BOOKING_HANDOFF_CANDIDATE='5110bf673d69b117fd0d0d19c5d7d6a9121b704c';
export const BOOKING_HANDOFF_BASELINE='52f602c0734284d81a19f4cdf9cdbf3766aa1834';
export const BOOKING_HANDOFF_LEGACY_DIRECTORY='/www/wwwroot/merchant-space.releases/e3e685852a63-20260922183053';
export const BOOKING_HANDOFF_MAX_MS=600000;
export const BOOKING_HANDOFF_TOOL_FILES=Object.freeze([
 'scripts/booking-handoff-policy.mjs','scripts/booking-handoff-policy.test.mjs',
 'scripts/online-traffic-release.mjs','scripts/online-traffic-release.test.mjs',
 'scripts/booking-handoff-retention.mjs','scripts/booking-handoff-retention.test.mjs',
 'scripts/online-release-retention-policy.mjs','scripts/online-release-retention.mjs',
 'scripts/online-release-retention.test.mjs','scripts/test-support/booking-handoff-retention-fixture.mjs',
 'scripts/online-release-cache-cleanup.mjs','scripts/online-release-cache-cleanup.test.mjs',
 'scripts/booking-atomic-worker.mjs','scripts/booking-atomic-worker.test.mjs',
 'scripts/attendance-staged-tool-repair.test.mjs','scripts/online-unpublished-candidate.test.mjs',
]);
const hex=/^[a-f0-9]{64}(?![\s\S])/,sha=/^[a-f0-9]{40}(?![\s\S])/;
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}(?![\s\S])/;
const fail=code=>{throw Error('booking_handoff_'+code);};
const need=(value,code)=>{if(!value)fail(code);};
const equal=(a,b,code)=>need(isDeepStrictEqual(a,b),code);
const hash=value=>createHash('sha256').update(value).digest('hex');
const positive=value=>Number.isSafeInteger(value)&&value>0;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exactKeys=(value,keys,code)=>{need(object(value),code);equal(Object.keys(value).sort(),[...keys].sort(),code);};
function time(value){need(typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value,'timestamp');return Date.parse(value);}

export function assertBookingHandoffToolClosure({baseline,files,readBlob}){
 need(baseline===BOOKING_HANDOFF_CANDIDATE&&Array.isArray(files)&&new Set(files).size===files.length&&
  files.length===BOOKING_HANDOFF_TOOL_FILES.length&&BOOKING_HANDOFF_TOOL_FILES.every(file=>files.includes(file)),'tool_scope');
 return hash(JSON.stringify([...files].sort().map(file=>[file,hash(readBlob(file))])));
}
export function assertBookingReviewedStageIdentity(value){
 const {requestedAction,target,baseline,toolRevision,currentMain,toolHead,toolDirectory,toolClean,ancestorVerified}=value;
 need(requestedAction==='stage-booking-reviewed-candidate'&&target===BOOKING_HANDOFF_CANDIDATE&&baseline===BOOKING_HANDOFF_BASELINE&&
  sha.test(toolRevision??'')&&toolRevision!==target&&currentMain===toolRevision&&toolHead===toolRevision&&
  toolDirectory==='/var/lib/faolla-online-code/'+toolRevision&&toolClean===true&&ancestorVerified===true,'reviewed_stage_identity');
 need(hex.test(value.toolClosureSha256??''),'reviewed_stage_closure');return true;
}
export function assertBookingHandoffWindow(value,{nowMs}={}){
 exactKeys(value,['id','startedAt','deadlineAt'],'window_shape');need(uuid.test(value.id),'window_id');
 const start=time(value.startedAt),deadline=time(value.deadlineAt);
 need(deadline>start&&deadline-start<=BOOKING_HANDOFF_MAX_MS,'window_bound');
 if(nowMs!==undefined)need(Number.isFinite(nowMs)&&nowMs>=start&&nowMs<deadline,'window_expired');
 return {startedAtMs:start,deadlineAtMs:deadline};
}
export function assertBookingLegacyTaskTransition(before,after){
 need(object(before)&&object(after)&&before.name==='merchant-space'&&before.pid===1590381&&before.port===3000&&
  before.cwd===BOOKING_HANDOFF_LEGACY_DIRECTORY&&before.executable===before.cwd+'/node_modules/next/dist/bin/next'&&
  before.status==='online'&&before.backgroundPaused==='0'&&before.watch===false&&
  (before.cronRestart===null||before.cronRestart===false||before.cronRestart==='0')&&
  before.shutdownWithMessage===false&&[undefined,''].includes(before.manualSignalHandle)&&
  Number.isSafeInteger(before.pmId)&&before.pmId>=0&&Number.isSafeInteger(before.restartCount)&&before.restartCount>=0&&
  hex.test(before.environmentSha256??''),'legacy_identity');
 need(positive(after.pid)&&after.pid!==before.pid&&after.backgroundPaused==='1'&&
  after.restartCount===before.restartCount+1&&hex.test(after.environmentSha256??'')&&
  after.environmentSha256!==before.environmentSha256,'legacy_transition');
 const mutable=['pid','backgroundPaused','restartCount','environmentSha256'];
 const rest=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!mutable.includes(key)));
 equal(rest(after),rest(before),'legacy_unrelated_change');
 return true;
}
export function assertBookingLegacyEnvironmentTransition(before,after){
 need(object(before)&&object(after)&&before.FAOLLA_BACKGROUND_JOBS_PAUSED==='0'&&after.FAOLLA_BACKGROUND_JOBS_PAUSED==='1','legacy_environment');
 const rest=value=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='FAOLLA_BACKGROUND_JOBS_PAUSED').sort(([a],[b])=>a.localeCompare(b)));
 equal(rest(after),rest(before),'legacy_environment_other_change');
 // This is not authority to configure mail or to pause the independent
 // enterprise/outbox process. The host must bind both actual /proc and PM2 env.
 need(!before.RESEND_API_KEY&&!after.RESEND_API_KEY&&!before.BOOKING_CONFIRMATION_EMAIL_FROM&&!after.BOOKING_CONFIRMATION_EMAIL_FROM,'email_not_disabled');
 return true;
}
export function assertBookingHandoffProcessSet({before,after,legacyBefore,legacyAfter,added}){
 need(Array.isArray(before)&&Array.isArray(after)&&Array.isArray(added)&&added.length===3,'process_set');
 const unique=rows=>rows.every(p=>object(p)&&typeof p.name==='string')&&new Set(rows.map(p=>p.name)).size===rows.length;
 need(unique(before)&&unique(after)&&unique(added),'duplicate_process');
 equal(before.find(p=>p.name==='merchant-space'),legacyBefore,'legacy_before_changed');
 assertBookingLegacyTaskTransition(legacyBefore,legacyAfter);
 need(added.every(p=>!before.some(old=>old.name===p.name)&&p.status==='online'&&positive(p.pid)), 'added_process_identity');
 equal(added.map(p=>p.name).sort(),[
  'merchant-space-online-'+BOOKING_HANDOFF_CANDIDATE.slice(0,12),
  'merchant-space-online-'+BOOKING_HANDOFF_APPLICATION.slice(0,12),
  'merchant-space-booking-atomic-'+BOOKING_HANDOFF_CANDIDATE.slice(0,12),
 ].sort(),'added_process_scope');
 need(after.length===before.length+3,'process_count');
 for(const p of before)equal(after.find(row=>row.name===p.name),p.name==='merchant-space'?legacyAfter:p,'retained_process_changed');
 for(const p of added)equal(after.find(row=>row.name===p.name),p,'added_process_changed');
 need(new Set(after.filter(p=>p.status==='online').map(p=>p.pid)).size===after.filter(p=>p.status==='online').length,'duplicate_pid');
 return true;
}
function anchor(value,target){
 exactKeys(value,['target','name','directory','port','process'],'anchor_shape');
 need(value.target===target&&value.name==='merchant-space-online-'+target.slice(0,12)&&
  value.directory==='/www/wwwroot/merchant-space.web-releases/'+target.slice(0,12)+'-online'&&
  Number.isSafeInteger(value.port)&&value.port>=3103&&value.port<=3110,'anchor');
 const p=value.process;
 need(object(p)&&p.name===value.name&&p.cwd===value.directory&&p.port===value.port&&p.status==='online'&&positive(p.pid)&&
  p.backgroundPaused==='1'&&p.automationEnabled==='0'&&p.invitationEnabled==='0','anchor_process');
}
export function assertBookingAtomicCohort({active,rollback,runtimeByName}){
 anchor(active,BOOKING_HANDOFF_CANDIDATE);anchor(rollback,BOOKING_HANDOFF_APPLICATION);
 need(active.port!==rollback.port&&active.process.pid!==rollback.process.pid&&active.process.pmId!==rollback.process.pmId,'cohort_distinct');
 exactKeys(runtimeByName,[active.name,rollback.name],'cohort_runtime_set');
 for(const a of [active,rollback]){
  const v=runtimeByName[a.name];need(object(v)&&v.MERCHANT_BOOKING_STORAGE_MODE==='atomic-v2'&&
   v.MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED==='0'&&v.FAOLLA_BACKGROUND_JOBS_PAUSED==='1'&&
   v.MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED==='0'&&v.MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED==='0'&&
   v.FAOLLA_WEB_BUILD_ID===a.target&&v.NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID===a.target&&v.PORT===String(a.port)&&
   v.PWD===a.directory&&!v.RESEND_API_KEY&&!v.BOOKING_CONFIRMATION_EMAIL_FROM,'cohort_runtime');
 }
 return true;
}
export function assertBookingAtomicActivationTransition(before,after){
 const keys=['systemIdentifier','databaseOid','serverVersionNum','generation','revision','protocol','active',
  'savedBookingRowsSha256','commands','mailJobs'];
 for(const v of [before,after]){
  exactKeys(v,keys,'database_shape');need(v.systemIdentifier==='7612049595342295079'&&v.databaseOid==='5'&&
   v.serverVersionNum==='150008'&&uuid.test(v.generation)&&v.revision==='0'&&v.protocol===2&&
   hex.test(v.savedBookingRowsSha256)&&v.commands===0&&v.mailJobs===0,'database_identity');
 }
 equal({...after,active:false},before,'database_saved_data_changed');need(before.active===false&&after.active===true,'database_activation');
 return true;
}
export function assertBookingHandoffEvidence(value){
 const hashes=['priorRetentionHeadSha256','priorStageSha256','sourceClosureSha256','preflightSha256','compatibilitySha256',
  'backupSha256','ingressGateSha256','legacyDrainSha256','rollbackReadinessSha256','activationSha256','recoveryPlanSha256'];
 exactKeys(value,['schemaVersion','kind','candidate','baseline','application','toolRevision','window','completedAt',...hashes],'evidence_shape');
 need(value.schemaVersion===1&&value.kind==='booking-task-handoff'&&value.candidate===BOOKING_HANDOFF_CANDIDATE&&
  value.baseline===BOOKING_HANDOFF_BASELINE&&value.application===BOOKING_HANDOFF_APPLICATION&&sha.test(value.toolRevision??'')&&
  hashes.every(k=>hex.test(value[k]??'')),'evidence_identity');
 assertBookingHandoffWindow(value.window,{nowMs:time(value.completedAt)});
 return true;
}
