// Shared *validation*, not restart/publication authority. Production supplies
// its fixed process binding; CI supplies a separately owned real PM2 fixture.
// A 130 result needs an independently read, append-bound SIGINT log witness.
import * as fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
const need=(v,c)=>{if(!v)throw Error('booking_handoff_'+c);},equal=(a,b,c)=>need(isDeepStrictEqual(a,b),c);
const hash=v=>createHash('sha256').update(v).digest('hex'),hex=/^[a-f0-9]{64}$/;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,k,c)=>need(object(v)&&isDeepStrictEqual(Object.keys(v).sort(),[...k].sort()),c);
const iso=s=>{const t=Date.parse(s);need(typeof s==='string'&&Number.isFinite(t)&&new Date(t).toISOString()===s,'runtime_time');return t;};
const positive=v=>Number.isSafeInteger(v)&&v>0;
const identity=s=>Object.fromEntries(['dev','ino','uid','mode','nlink'].map(k=>[k,s[k]]));
const LIMIT=64*1024**2;
// A live monitor refresh changes CPU, RSS and heap gauges without a restart or
// configuration mutation. Exclude only those two explicitly named telemetry
// containers; keep every identity, environment and other manager field exact.
export function stablePm2RegistryRow(row){
 need(object(row)&&object(row.pm2_env)&&object(row.pm2_env.axm_monitor),'registry_row');
 keys(row.monit,['cpu','memory'],'registry_metrics');need(Number.isFinite(row.monit.cpu)&&row.monit.cpu>=0&&Number.isSafeInteger(row.monit.memory)&&row.monit.memory>=0,'registry_metrics');
 const {monit,...rest}=row,{axm_monitor,...configured}=row.pm2_env;return{...rest,pm2_env:configured};
}
function ownedLog(file){
 need(process.platform==='linux'&&process.getuid?.()===0&&typeof file==='string'&&file.startsWith('/')&&fs.realpathSync(file)===file,'termination_log_path');
 for(let dir=path.dirname(file);;dir=path.dirname(dir)){const s=fs.lstatSync(dir);need(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===0&&!(s.mode&0o022),'termination_log_ancestor');if(dir==='/')break;}
 const s=fs.lstatSync(file);need(s.isFile()&&!s.isSymbolicLink()&&s.uid===0&&s.nlink===1&&!(s.mode&0o022)&&s.size<=LIMIT,'termination_log_file');return s;
}
function logBytes(file){
 const before=ownedLog(file),fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{equal(identity(fs.fstatSync(fd)),identity(before),'termination_log_replaced');const b=fs.readFileSync(fd),after=fs.fstatSync(fd);equal(identity(after),identity(before),'termination_log_replaced');equal(identity(fs.lstatSync(file)),identity(before),'termination_log_replaced');need(b.length<=LIMIT&&b.length>=before.size&&after.size>=b.length,'termination_log_changed');return {bytes:b,identity:identity(before)};}finally{fs.closeSync(fd);}
}
export function capturePm2TerminationAnchor(file){const r=logBytes(file);return {file,identity:r.identity,offset:r.bytes.length,prefixSha256:hash(r.bytes)};}
// Observation of already-existing exact records, not a pre-restart anchor and
// never a replacement for the fresh SIGINT witness API above.
export function inspectPinnedPm2RecordSequence(file,lines){
 need(Array.isArray(lines)&&lines.length>=2&&lines.length<=8&&lines.every(v=>typeof v==='string'&&v.length>0&&v.length<=512&&!/[\r\n\0]/.test(v)),'historical_record_contract');
 const r=logBytes(file),record=Buffer.from(lines.join('\n')+'\n'),fromOffset=r.bytes.indexOf(record);
 need(fromOffset>=0&&(fromOffset===0||r.bytes[fromOffset-1]===10)&&r.bytes.indexOf(record,fromOffset+1)===-1,'historical_record_not_unique');
 return{kind:'pm2-existing-record-sequence-observation',file,identity:r.identity,fromOffset,toOffset:fromOffset+record.length,sequenceSha256:hash(record),observedAt:new Date().toISOString(),observationOfExistingRecords:true,eventTimeNotReissued:true,publicationAuthority:false};
}
export function assertPm2TerminationEvidence(proof,{before,after,window,observedAt,logFile}){
 keys(proof,['kind','file','identity','fromOffset','toOffset','prefixSha256','recordSha256','beforePid','afterPid','name','pmId','exitCode','signal','observedAt'],'termination_shape');
 need(proof.kind==='pm2-observed-sigint-termination'&&proof.file===logFile&&proof.file.endsWith('/pm2.log')&&proof.beforePid===before.pid&&proof.afterPid===after.pid&&proof.name===before.name&&proof.pmId===before.pmId&&proof.exitCode===130&&proof.signal==='SIGINT','termination_binding');
 keys(proof.identity,['dev','ino','uid','mode','nlink'],'termination_identity');need(proof.identity.uid===0&&proof.identity.nlink===1&&(proof.identity.mode&0o170000)===0o100000&&!(proof.identity.mode&0o022)&&Number.isSafeInteger(proof.identity.dev)&&positive(proof.identity.ino),'termination_identity');
 need(Number.isSafeInteger(proof.fromOffset)&&proof.fromOffset>=0&&Number.isSafeInteger(proof.toOffset)&&proof.toOffset>proof.fromOffset&&proof.toOffset-proof.fromOffset<=256*1024&&proof.toOffset<=LIMIT&&hex.test(proof.prefixSha256)&&hex.test(proof.recordSha256),'termination_bytes');
 const at=iso(proof.observedAt);need(at>=iso(window.startedAt)&&at<iso(window.deadlineAt)&&at<=iso(observedAt),'termination_time');return true;
}
export function inspectPm2SigintTermination(anchor,before,after){
 keys(anchor,['file','identity','offset','prefixSha256'],'termination_anchor');const r=logBytes(anchor.file);equal(r.identity,anchor.identity,'termination_log_replaced');
 need(Number.isSafeInteger(anchor.offset)&&anchor.offset>=0&&r.bytes.length>anchor.offset&&r.bytes.length-anchor.offset<=256*1024&&hash(r.bytes.subarray(0,anchor.offset))===anchor.prefixSha256,'termination_log_prefix_changed');
 // No arbitrary process name is interpolated into a regular expression.
 need(/^[A-Za-z0-9_-]{1,80}$/.test(before.name)&&Number.isSafeInteger(before.pmId)&&before.pmId>=0,'termination_target');
 const token='App ['+before.name+':'+before.pmId+'] exited with code [',lines=r.bytes.subarray(anchor.offset).toString('utf8').split('\n').filter(v=>v.includes(token));
 need(lines.length===1&&lines[0].endsWith(token+'130] via signal [SIGINT]'),'termination_signal_not_observed');
 return {kind:'pm2-observed-sigint-termination',file:anchor.file,identity:r.identity,fromOffset:anchor.offset,toOffset:r.bytes.length,prefixSha256:anchor.prefixSha256,recordSha256:hash(lines[0]+'\n'),beforePid:before.pid,afterPid:after.pid,name:before.name,pmId:before.pmId,exitCode:130,signal:'SIGINT',observedAt:new Date().toISOString()};
}
export function assertManagedPauseEnvironmentDelta(value,{framework,expectedExitCode=0}={}){
 need(expectedExitCode===0||expectedExitCode===130,'runtime_validation_contract');
 const {beforeRaw:before,afterRaw:after,legacyBefore,legacyAfter,beforePmUptime,afterPmUptime}=value;
 equal(value.framework,framework,'pm2_provenance');
 need(framework.nodeVersion==='v20.20.1'&&framework.managerVersion==='6.0.14','pm2_provenance');
 need(object(before)&&object(after)&&Object.values(before).every(v=>typeof v==='string')&&Object.values(after).every(v=>typeof v==='string'),'runtime_environment');
 need(positive(legacyBefore.pid)&&positive(legacyAfter.pid)&&legacyBefore.pid!==legacyAfter.pid&&legacyBefore.status==='online'&&legacyAfter.status==='online'&&legacyBefore.backgroundPaused==='0'&&legacyAfter.backgroundPaused==='1'&&legacyAfter.restartCount===legacyBefore.restartCount+1,'legacy_transition');
 const mutable=['pid','backgroundPaused','restartCount','environmentSha256','createdAt'],restProcess=v=>Object.fromEntries(Object.entries(v).filter(([k])=>!mutable.includes(k)));
 equal(restProcess(legacyBefore),restProcess(legacyAfter),'legacy_unrelated_change');
 const configuredRest=v=>Object.fromEntries(Object.entries(v).filter(([k])=>k!=='FAOLLA_BACKGROUND_JOBS_PAUSED').sort(([a],[b])=>a.localeCompare(b)));
 need(value.beforeConfigured.FAOLLA_BACKGROUND_JOBS_PAUSED==='0'&&value.afterConfigured.FAOLLA_BACKGROUND_JOBS_PAUSED==='1','legacy_environment');equal(configuredRest(value.beforeConfigured),configuredRest(value.afterConfigured),'legacy_environment_other_change');
 need(!value.beforeConfigured.RESEND_API_KEY&&!value.afterConfigured.RESEND_API_KEY&&!value.beforeConfigured.BOOKING_CONFIRMATION_EMAIL_FROM&&!value.afterConfigured.BOOKING_CONFIRMATION_EMAIL_FROM,'email_not_disabled');
 equal(value.beforePmDerived,{exitCode:null,nodeVersion:'20.20.1',version:'16.3.4',previousRestartDelay:null,unstableRestarts:0},'runtime_manager_before');
 equal(value.afterPmDerived,{exitCode:expectedExitCode,nodeVersion:'20.20.1',version:'16.3.4',previousRestartDelay:0,unstableRestarts:0},'runtime_manager_after');
 const added={exit_code:String(expectedExitCode),node_version:'20.20.1',version:'16.3.4',prev_restart_delay:'0'};
 for(const [key,expected]of Object.entries(added))need(!Object.hasOwn(before,key)&&after[key]===expected&&!Object.hasOwn(value.beforeConfigured,key)&&!Object.hasOwn(value.afterConfigured,key),'runtime_manager_collision');
 equal(Object.keys(after).sort(),[...Object.keys(before),...Object.keys(added)].sort(),'runtime_environment_keys');
 need(before.unstable_restarts==='0'&&after.unstable_restarts==='0','runtime_unstable_restart');
 need(before.FAOLLA_BACKGROUND_JOBS_PAUSED==='0'&&after.FAOLLA_BACKGROUND_JOBS_PAUSED==='1'&&!before.RESEND_API_KEY&&!after.RESEND_API_KEY&&!before.BOOKING_CONFIRMATION_EMAIL_FROM&&!after.BOOKING_CONFIRMATION_EMAIL_FROM,'runtime_environment_pause');
 const derived=['FAOLLA_BACKGROUND_JOBS_PAUSED','created_at','pm_uptime','restart_time',...Object.keys(added)];
 const rest=env=>Object.fromEntries(Object.entries(env).filter(([key])=>!derived.includes(key)).sort(([a],[b])=>a.localeCompare(b)));equal(rest(after),rest(before),'runtime_environment_other_change');
 need(before.restart_time===String(legacyBefore.restartCount)&&after.restart_time===String(legacyAfter.restartCount),'runtime_restart_counter');
 need(positive(beforePmUptime)&&positive(afterPmUptime)&&before.pm_uptime===String(beforePmUptime)&&after.pm_uptime===String(afterPmUptime)&&before.created_at===String(legacyBefore.createdAt)&&after.created_at===String(legacyAfter.createdAt),'runtime_start_counter');
 return true;
}
export function assertManagedPauseEnvironmentTransition(value,{framework,assertWindow,expectedExitCode=0,terminationEvidence,logFile}={}){
 need(typeof assertWindow==='function','runtime_validation_contract');assertManagedPauseEnvironmentDelta(value,{framework,expectedExitCode});
 const {legacyBefore,legacyAfter,beforePmUptime,afterPmUptime}=value;
 if(expectedExitCode===130)assertPm2TerminationEvidence(terminationEvidence,{before:legacyBefore,after:legacyAfter,window:value.window,observedAt:value.observedAt,logFile});
 else need(terminationEvidence===undefined,'termination_unexpected');
 const now=iso(value.observedAt),window=assertWindow(value.window,{nowMs:now});
 need(beforePmUptime>=legacyBefore.createdAt&&beforePmUptime<=window.startedAtMs&&legacyAfter.createdAt>=window.startedAtMs&&legacyAfter.createdAt<=afterPmUptime&&afterPmUptime>=window.startedAtMs&&afterPmUptime>beforePmUptime&&afterPmUptime<=now,'runtime_start_bound');return true;
}
