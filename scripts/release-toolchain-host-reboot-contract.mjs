// Explicit host-boot recovery. A PM2 restart, changed application definition or
// newly registered process is NOT a host reboot. No host I/O or authority here.
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
export const HOST_REBOOT_KIND='host-reboot';
export const REBOOT_WORKER_NAME='merchant-space-booking-atomic-f274ad615550';
const need=(v,c)=>{if(!v)throw Error('host_reboot_'+c);};
const same=(a,b,c='changed')=>need(isDeepStrictEqual(a,b),c);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const instant=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const keys=(v,k)=>same(Object.keys(v??{}).sort(),[...k].sort(),'shape');
export const rebootHash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
export function assertDifferentHostBoot(previous,current){need(uuid(previous)&&uuid(current)&&previous!==current,'boot');return true;}
function canonical(v){return Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;}
const location=a=>Object.fromEntries(['target','name','directory','port'].map(k=>[k,a[k]]));
const script=revision=>'/var/lib/faolla-online-code/'+revision+'/scripts/booking-atomic-worker.mjs';
function cohort(rows){
 need(Array.isArray(rows)&&rows.length>0&&rows.length<=128,'cohort');
 need(new Set(rows.map(p=>p.name)).size===rows.length&&new Set(rows.map(p=>p.pmId)).size===rows.length,'cohort');
 for(const p of rows)need(typeof p.name==='string'&&Number.isSafeInteger(p.pmId)&&p.pmId>=0&&['online','stopped'].includes(p.status)&&Number.isSafeInteger(p.pid)&&(p.status==='online'?p.pid>0:p.pid===0)&&hash(p.environmentSha256),'process');
 need(new Set(rows.filter(p=>p.pid).map(p=>p.pid)).size===rows.filter(p=>p.pid).length,'cohort');
}
export function assertRebootEnvironmentProof(proof,before,after){
 keys(proof,['name','beforeSha256','afterSha256','beforeStableSha256','afterStableSha256','beforeUniqueId','afterUniqueId']);
 need(proof.name===before.name&&proof.name===after.name&&proof.beforeSha256===before.environmentSha256&&proof.afterSha256===after.environmentSha256&&hash(proof.beforeStableSha256)&&proof.beforeStableSha256===proof.afterStableSha256&&uuid(proof.beforeUniqueId)&&uuid(proof.afterUniqueId),'environment');
 // PM2 may regenerate unique_id or retain it. No other environment field is
 // excluded, including credentials, URLs, mail flags, timezone and pause gates.
}
export function assertHostBootCohort(before,after,proofs){
 cohort(before);cohort(after);need(before.length===after.length&&Array.isArray(proofs)&&proofs.length===before.length&&new Set(proofs.map(p=>p.name)).size===proofs.length,'cohort');
 for(const old of before){
  const current=after.find(p=>p.name===old.name);need(current,'cohort');
  assertRebootEnvironmentProof(proofs.find(p=>p.name===old.name),old,current);
  const restartCount=old.status==='online'?0:old.restartCount;
  need(Number.isSafeInteger(current.restartCount)&&current.restartCount===restartCount,'resurrection_counter');
  // IDs/PIDs and the manager's restart counter are rebound from an observed
  // different kernel boot. created_at and every launch/configuration field stay.
  same(current,{...old,pmId:current.pmId,pid:current.pid,restartCount,environmentSha256:current.environmentSha256},'definition');
 }
 return true;
}
export function assertHostRebootContext(r,prior,head){
 keys(r,['version','kind','previousBootId','bootId','priorHistoryHead','oldDumpSha256','oldBootReceiptSha256','sourceInventorySha256','nativeEvidenceSha256','gateSha256','publicationCertificateSha256','protectedHostSha256','environmentProofs','resurrectedProcesses','identities','daemon','window','mailEnabled']);
 assertDifferentHostBoot(r.previousBootId,r.bootId);
 need(r.version===1&&r.kind==='verified-host-boot-rebind'&&r.priorHistoryHead===head&&r.mailEnabled===false,'boot');
 for(const key of ['oldDumpSha256','oldBootReceiptSha256','sourceInventorySha256','nativeEvidenceSha256','gateSha256','publicationCertificateSha256','protectedHostSha256'])need(hash(r[key]),'evidence');
 const w=r.window;keys(w,['id','startedAt','deadlineAt']);need(uuid(w.id)&&instant(w.startedAt)&&instant(w.deadlineAt)&&Date.parse(w.deadlineAt)-Date.parse(w.startedAt)===600000,'window');
 assertHostBootCohort(prior.processes,r.resurrectedProcesses,r.environmentProofs);
 need(r.daemon?.bootId===r.bootId&&r.daemon.uid===0&&r.daemon.pid>0&&/^[1-9]\d*$/.test(r.daemon.startTicks??''),'daemon');
 const online=r.resurrectedProcesses.filter(p=>p.status==='online');need(Array.isArray(r.identities)&&r.identities.length===online.length&&new Set(r.identities.map(p=>p.name)).size===online.length,'identities');
 for(const p of online){const f=r.identities.find(f=>f.name===p.name);need(f&&f.pid===p.pid&&f.uid===0&&f.parentPid===r.daemon.pid&&f.cwd===p.cwd&&f.executable==='/usr/bin/node'&&/^[1-9]\d*$/.test(f.startTicks??'')&&hash(f.commandSha256)&&hash(f.environmentSha256),'identity');}
 const worker=r.resurrectedProcesses.find(p=>p.name===REBOOT_WORKER_NAME);need(worker?.status==='online'&&worker.backgroundPaused==='0'&&worker.automationEnabled==='0'&&worker.invitationEnabled==='0'&&worker.args.length===0&&worker.nodeArgs.length===0&&/^\/var\/lib\/faolla-online-code\/[a-f0-9]{40}\/scripts\/booking-atomic-worker\.mjs$/.test(worker.executable),'worker');
 return true;
}
export function assertHostRebootOnlyWorkerDelta(r,after,revision){
 cohort(after);need(sha(revision)&&after.length===r.resurrectedProcesses.length,'worker');
 const old=r.resurrectedProcesses.find(p=>p.name===REBOOT_WORKER_NAME),next=after.find(p=>p.name===REBOOT_WORKER_NAME);need(next&&next.pid>0&&next.pid!==old.pid&&next.restartCount===old.restartCount+1&&next.executable===script(revision)&&next.executable!==old.executable,'worker_delta');
 need(Number.isSafeInteger(next.createdAt)&&(next.createdAt===old.createdAt||next.createdAt>=Date.parse(r.window.startedAt)&&next.createdAt<=Date.parse(r.window.deadlineAt)),'worker_delta');
 same(next,{...old,pid:next.pid,restartCount:old.restartCount+1,executable:script(revision),createdAt:next.createdAt},'worker_delta');
 for(const p of r.resurrectedProcesses.filter(p=>p.name!==REBOOT_WORKER_NAME))same(after.find(n=>n.name===p.name),p,'other_process');return true;
}
export function assertHostRebootTransition(c,prior,head){
 const r=c.hostReboot;assertHostRebootContext(r,prior,head);
 need(c.kind===HOST_REBOOT_KIND&&c.toolRevision&&c.previousSha256===head&&c.victim===null&&c.stoppedProcess===null&&c.rollbackProof===undefined&&c.workerRelease===undefined&&c.bookingHandoff===undefined&&c.applicationRelease===undefined,'binding');
 same(location(c.active),location(prior.active),'website');same(location(c.rollback),location(prior.rollback),'website');
 assertHostRebootOnlyWorkerDelta(r,c.processes,c.toolRevision);
 for(const a of [c.active,c.rollback])same(a.process,c.processes.find(p=>p.name===a.name),'website');
 if(c.completedAt!==undefined)need(instant(c.completedAt)&&Date.parse(c.completedAt)>=Date.parse(r.window.startedAt)&&Date.parse(c.completedAt)<=Date.parse(r.window.deadlineAt),'completion_time');
 return true;
}
const OBS=['version','policy','kind','sequence','previousSha256','legacySha256','rollingHeadSha256','rollingHistorySha256','toolRevision','active','rollback','victim','hostReboot','processes','workerIdentity','persistenceSha256'];
export function assertHostRebootPlan(before,history){
 keys(before,OBS);const prior=history.entries.at(-1);need(prior&&before.version===2&&before.policy===history.policy&&before.kind===HOST_REBOOT_KIND&&before.sequence===history.entries.length+1&&before.previousSha256===history.headSha256&&sha(before.toolRevision)&&before.victim===null,'plan');
 assertHostRebootContext(before.hostReboot,prior,history.headSha256);
 for(const k of ['legacySha256','rollingHeadSha256','rollingHistorySha256'])same(before[k],prior[k],'root');
 for(const k of ['active','rollback']){same(location(before[k]),location(prior[k]),'website');same(before[k].process,before.hostReboot.resurrectedProcesses.find(p=>p.name===before[k].name),'website');}
 same(before.processes,before.hostReboot.resurrectedProcesses,'plan');same(before.workerIdentity,before.hostReboot.identities.find(p=>p.name===REBOOT_WORKER_NAME),'identity');need(before.persistenceSha256===null,'plan');return true;
}
export function assertHostRebootCompletion(before,after,history){
 assertHostRebootPlan(before,history);keys(after,OBS);assertHostRebootOnlyWorkerDelta(before.hostReboot,after.processes,before.toolRevision);
 const worker=after.processes.find(p=>p.name===REBOOT_WORKER_NAME);need(after.workerIdentity?.pid===worker.pid&&after.workerIdentity.uid===0&&after.workerIdentity.parentPid===before.hostReboot.daemon.pid&&after.workerIdentity.startTicks!==before.workerIdentity.startTicks&&/^[1-9]\d*$/.test(after.workerIdentity.startTicks??'')&&hash(after.persistenceSha256),'completion');
 same({...after,processes:before.processes,workerIdentity:before.workerIdentity,persistenceSha256:null},before,'completion');return true;
}
// Resolve ALL certified identity edges in chronological order, including
// stopped registrations. Exact equality prevents name-only or cyclic rebinding.
export function resolveCertifiedProcess(old,replacements){
 let current=old;const seen=new Set([rebootHash(old)]);
 for(const row of replacements)if(isDeepStrictEqual(current,row.before)&&!isDeepStrictEqual(row.before,row.after)){const digest=rebootHash(row.after);need(!seen.has(digest),'replacement_cycle');seen.add(digest);current=row.after;}
 return current;
}
export function hostRebootReplacements(c,prior){
 if(c.kind!==HOST_REBOOT_KIND)return[];
 return [...prior.processes.map(before=>({before,after:c.hostReboot.resurrectedProcesses.find(p=>p.name===before.name)})),
  ...c.hostReboot.resurrectedProcesses.filter(p=>p.name===REBOOT_WORKER_NAME).map(before=>({before,after:c.processes.find(p=>p.name===before.name)}))];
}
export function latestBookingVerifierCertificate(history){return history.entries.filter(c=>c.kind==='booking-worker'||c.kind===HOST_REBOOT_KIND).at(-1);}
