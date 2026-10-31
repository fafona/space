// A worker-only successor, never a second website publication. Existing
// website certificates, gate bytes, active/rollback files and builds stay put.
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
export const BOOKING_WORKER_RELEASE_KIND='booking-worker';
const C='f274ad615550c83717aa7af2ad32339608e6f8aa',NAME='merchant-space-booking-atomic-'+C.slice(0,12);
const need=(v,c)=>{if(!v)throw Error('booking_worker_release_'+c);},same=(a,b)=>need(isDeepStrictEqual(a,b),'changed');
const sha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v),hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const instant=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)).toISOString()===v;
const keys=(v,k)=>same(Object.keys(v??{}).sort(),k.sort());
const script=revision=>'/var/lib/faolla-online-code/'+revision+'/scripts/booking-atomic-worker.mjs';
export function assertBookingWorkerReleaseContext(value){
 keys(value,['version','kind','candidate','toolRevision','priorToolRevision','priorWorker','gateSha256','publicationCertificateSha256','inventorySha256','nativeEvidenceSha256','protectedHostSha256','window','mailEnabled']);
 need(value.version===1&&value.kind==='booking-worker-source-only'&&value.candidate===C&&sha(value.toolRevision)&&sha(value.priorToolRevision)&&value.toolRevision!==value.priorToolRevision&&value.mailEnabled===false,'context');
 for(const key of ['gateSha256','publicationCertificateSha256','inventorySha256','nativeEvidenceSha256','protectedHostSha256'])need(hash(value[key]),'context');
 const w=value.window;keys(w,['id','startedAt','deadlineAt']);need(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(w.id??'')&&instant(w.startedAt)&&instant(w.deadlineAt)&&Date.parse(w.deadlineAt)-Date.parse(w.startedAt)===600000,'window');
 const p=value.priorWorker;need(p?.name===NAME&&p.pmId===27&&p.pid>0&&p.status==='online'&&p.cwd==='/www/wwwroot/merchant-space.web-releases/'+C.slice(0,12)+'-online'&&p.executable===script(value.priorToolRevision)&&p.interpreter==='/usr/bin/node'&&p.port===null&&p.execMode==='fork_mode'&&p.autorestart===true&&p.watch===false&&[null,false,'0'].includes(p.cronRestart)&&p.backgroundPaused==='0'&&p.automationEnabled==='0'&&p.invitationEnabled==='0'&&p.shutdownWithMessage===false&&p.killTimeout===null&&Number.isSafeInteger(p.restartCount)&&p.restartCount>=0,'worker');
 same(p.args,[]);same(p.nodeArgs,[]);return true;
}
export function assertBookingWorkerOnlyDelta(before,after,context){
 assertBookingWorkerReleaseContext(context);need(Array.isArray(before)&&Array.isArray(after)&&before.length===after.length,'cohort');
 same(before.find(p=>p.name===NAME),context.priorWorker);need(new Set(after.map(p=>p.name)).size===after.length&&new Set(after.map(p=>p.pmId)).size===after.length,'cohort');
 const next=after.find(p=>p.name===NAME),old=context.priorWorker;need(next&&Number.isSafeInteger(next.pid)&&next.pid>0&&next.pid!==old.pid&&next.restartCount===old.restartCount+1&&next.executable===script(context.toolRevision),'transition');
 need(Number.isSafeInteger(next.createdAt)&&(next.createdAt===old.createdAt||next.createdAt>=Date.parse(context.window.startedAt)&&next.createdAt<=Date.parse(context.window.deadlineAt)),'transition');
 same(next,{...old,pid:next.pid,restartCount:old.restartCount+1,executable:script(context.toolRevision),createdAt:next.createdAt});
 for(const p of before.filter(p=>p.name!==NAME))same(after.find(v=>v.name===p.name),p);return true;
}
export function assertBookingWorkerReleaseTransition(c,prior,historyHead){
 const r=c.workerRelease;assertBookingWorkerReleaseContext(r);need(c.kind===BOOKING_WORKER_RELEASE_KIND&&c.toolRevision===r.toolRevision&&c.previousSha256===historyHead,'binding');
 same(c.active,prior.active);same(c.rollback,prior.rollback);need(c.active.target===C&&c.victim===null&&c.stoppedProcess===null&&c.bookingHandoff===undefined&&c.rollbackProof===undefined,'website');
 assertBookingWorkerOnlyDelta(prior.processes,c.processes,r);
 if(c.completedAt!==undefined)need(instant(c.completedAt)&&Date.parse(c.completedAt)>=Date.parse(r.window.startedAt)&&Date.parse(c.completedAt)<=Date.parse(r.window.deadlineAt),'completion_time');return true;
}
export function assertBookingWorkerPublicationBinding(r,history){
 const publication=history.entries.find(c=>c.kind==='booking-handoff'&&createHash('sha256').update(JSON.stringify(canonical(c))).digest('hex')===r.publicationCertificateSha256);
 need(publication&&publication.active.target===C,'publication');
 const expected={schemaVersion:1,kind:'booking-atomic-worker-gate',candidate:C,toolRevision:publication.toolRevision,certificateSha256:r.publicationCertificateSha256,generation:publication.bookingHandoff.databaseAfter.generation,enabled:true};
 need(createHash('sha256').update(JSON.stringify(canonical(expected))+'\n').digest('hex')===r.gateSha256,'publication_gate');return true;
}
const OBSERVATION_KEYS=['version','policy','kind','sequence','previousSha256','legacySha256','rollingHeadSha256','rollingHistorySha256','toolRevision','active','rollback','victim','workerRelease','processes','workerIdentity','protectedHostSha256','persistenceSha256'];
export function assertBookingWorkerReleasePlan(before,history){
 keys(before,OBSERVATION_KEYS);const r=before.workerRelease;assertBookingWorkerReleaseContext(r);const prior=history.entries.at(-1);
 assertBookingWorkerPublicationBinding(r,history);
 need(prior&&before.version===2&&before.policy===history.policy&&before.kind===BOOKING_WORKER_RELEASE_KIND&&before.sequence===history.entries.length+1&&before.previousSha256===history.headSha256&&before.toolRevision===r.toolRevision&&before.victim===null&&before.active.target===C,'plan');
 for(const key of ['legacySha256','rollingHeadSha256','rollingHistorySha256','active','rollback'])same(before[key],prior[key]);
 same(before.processes,prior.processes);same(before.protectedHostSha256,r.protectedHostSha256);need(before.persistenceSha256===null&&before.workerIdentity?.pid===r.priorWorker.pid&&before.workerIdentity.uid===0&&/^\d+$/.test(before.workerIdentity.startTicks??''),'identity');return true;
}
export function assertBookingWorkerReleaseCompletion(before,after,history){
 assertBookingWorkerReleasePlan(before,history);keys(after,OBSERVATION_KEYS);const r=before.workerRelease;
 assertBookingWorkerOnlyDelta(before.processes,after.processes,r);need(after.workerIdentity?.pid===after.processes.find(p=>p.name===NAME).pid&&after.workerIdentity.uid===0&&/^\d+$/.test(after.workerIdentity.startTicks??'')&&after.workerIdentity.startTicks!==before.workerIdentity.startTicks,'identity');
 need(hash(after.persistenceSha256),'persistence');same({...after,processes:before.processes,workerIdentity:before.workerIdentity,persistenceSha256:null},before);return true;
}
export function bookingWorkerReleaseReplacements(history){
 const rows=[];for(const c of history.entries.filter(c=>c.kind===BOOKING_WORKER_RELEASE_KIND)){
  const before=c.workerRelease.priorWorker,after=c.processes.find(p=>p.name===before.name);
  for(const row of rows)if(isDeepStrictEqual(row.after,before))row.after=after;rows.push({before,after});
 }return rows;
}
export function assertBookingWorkerExecutionRevision({gate,history,toolRevision}){
 need(sha(toolRevision),'execution');if(toolRevision===gate.toolRevision)return true;
 const c=history.entries.filter(c=>c.kind===BOOKING_WORKER_RELEASE_KIND).at(-1);need(c&&c.toolRevision===toolRevision&&c.workerRelease.toolRevision===toolRevision&&c.workerRelease.gateSha256===createHash('sha256').update(JSON.stringify(canonical(gate))+'\n').digest('hex')&&c.workerRelease.publicationCertificateSha256===gate.certificateSha256,'execution');return true;
}
function canonical(v){return Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;}
