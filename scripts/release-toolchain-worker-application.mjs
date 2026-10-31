// Read-only admission and sealed post-certificate continuation, never a retry
// of the old attempt. Credentials remain only in the task's process memory.
import * as fs from 'node:fs';import {spawnSync} from 'node:child_process';
import {WORKER_APPLICATION_INCIDENT as P,workerApplicationIncidentSha256,assertWorkerApplicationIncident} from './release-toolchain-worker-application-contract.mjs';
import {bookingHostRead} from './booking-handoff-host-io.mjs';
import {ownedReleasePath,inspectPinnedExecutionSource} from './release-toolchain-source.mjs';
import {readOnlineRetentionHistory} from './online-release-retention.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
import {verifyPm2Dump} from './production-maintenance-pm2-adapter.mjs';
import {observeBookingWorkerPhysical} from './release-toolchain-worker-release-host.mjs';
import {inspectWorkerDatabaseFailureFiles} from './release-toolchain-worker-database.mjs';
import {proveRecoveryTargets} from './release-toolchain-recovery-probe.mjs';
const C='f274ad615550c83717aa7af2ad32339608e6f8aa',ROOT='/var/lib/faolla-booking-worker-releases',OP='/var/lib/faolla-maintenance/merchant-space/operation.lock',read=file=>JSON.parse(bookingHostRead(file));
export function inspectWorkerApplicationFailureFiles(){
 inspectWorkerDatabaseFailureFiles();const root=ROOT+'/'+P.tool;ownedReleasePath(root,{directory:true,privateMode:true});const names=fs.readdirSync(root).sort();need(canonicalJson(names)===canonicalJson(Object.keys(P.files).sort()),'scope_changed');
 const files=Object.fromEntries(names.map(name=>[name,sha256(bookingHostRead(root+'/'+name,{binary:true}))]));need(canonicalJson(files)===canonicalJson(P.files),'scope_changed');return files;
}
export async function observeWorkerApplicationIncident(){
 const files=inspectWorkerApplicationFailureFiles(),history=readOnlineRetentionHistory(),prior=history.entries.at(-1),actual=observeBookingWorkerPhysical(),old=ROOT+'/'+P.tool;
 need(inspectPinnedExecutionSource({revision:P.tool,directory:'/var/lib/faolla-online-code/'+P.tool}).inventorySha256===P.inventory,'source_changed');
 const st=ownedReleasePath(OP,{directory:true,privateMode:true}),operation=Object.fromEntries(['dev','ino','uid','mode'].map(key=>[key,st[key]]));
 let originalControllerExited=true;try{const text=fs.readFileSync('/proc/'+P.controller.pid+'/stat','utf8');originalControllerExited=text.slice(text.lastIndexOf(')')+2).trim().split(/\s+/)[19]!==P.controller.startTicks;}catch(e){if(!['ENOENT','ESRCH'].includes(e.code))throw e;}
 const failure=read(old+'/unconfirmed.json'),saved=read(old+'/persistence-completed.json');
 const value={files,historyHead:history.headSha256,sequence:history.entries.length,tool:prior.toolRevision,pid:actual.worker.pid,restarts:actual.worker.pm2_env.restart_time,operation,operationEmpty:fs.readdirSync(OP).length===0,originalControllerExited,phase:failure.phase,certificateCommitted:failure.certificateCommitted,completed:fs.existsSync(old+'/completed.json'),mailEnabled:failure.mailEnabled,allProcessesMatch:canonicalJson(actual.processes)===canonicalJson(prior.processes),savedDumpVerified:await verifyPm2Dump(saved.daemon,saved.bootId,saved.registry,saved.receipt),protectedHostMatch:actual.protectedHostSha256===prior.workerRelease.protectedHostSha256};
 assertWorkerApplicationIncident(value);need(!actual.raw.SUPABASE_SERVICE_ROLE_KEY&&!actual.raw.NEXT_SUPABASE_SERVICE_ROLE_KEY,'scope_changed');
 return {kind:'booking-worker-application-incident-observed',incidentSha256:workerApplicationIncidentSha256(),historyHead:history.headSha256,operation,workerIdentity:actual.workerIdentity,protectedHostSha256:actual.protectedHostSha256,mailEnabled:false};
}
export async function probeWorkerApplicationBeforeRestart(source,environment){
 need(/^\/var\/lib\/faolla-online-code\/[a-f0-9]{40}$/.test(source),'source_changed');
 const env={...environment};for(const key of ['NODE_CHANNEL_FD','NODE_CHANNEL_SERIALIZATION_MODE','NODE_UNIQUE_ID'])delete env[key];
 const program='const {probeConfiguredBookingWorkerDatabase}=await import('+JSON.stringify('file://'+source+'/scripts/booking-atomic-worker.mjs')+');console.log(JSON.stringify(await probeConfiguredBookingWorkerDatabase()));';
 const result=spawnSync('/usr/bin/node',['--input-type=module','--eval',program,'--','faolla-worker-application-readonly-preflight'],{env,cwd:'/www/wwwroot/merchant-space.web-releases/'+C.slice(0,12)+'-online',encoding:'utf8',timeout:30000,maxBuffer:262144,windowsHide:true});
 need(result.status===0&&!result.error&&!result.signal,'database_preflight_unconfirmed');let proof;try{proof=JSON.parse(result.stdout);}catch{need(false,'database_preflight_unconfirmed');}
 need(proof?.kind==='booking-worker-database-readonly-probe-verified'&&proof.credentialConfigured===true&&proof.sourceEnvironmentSha256===P.environmentSha256&&proof.protocol===2&&proof.generation==='9b85e75c-f474-4b17-b2a5-75601f7940b4'&&proof.otherSettingsLoaded===false&&proof.mailEnabled===false&&proof.tickDispatched===false&&proof.businessDataWritten===false,'database_preflight_unconfirmed');
 return {...proof,diagnosticBytes:Buffer.byteLength(result.stderr),diagnosticSha256:sha256(result.stderr)};
}
export async function verifyWorkerApplicationClosure({toolRevision,window}){
 need(/^[a-f0-9]{40}$/.test(toolRevision)&&toolRevision!==P.tool,'source_changed');inspectWorkerApplicationFailureFiles();
 const directory=ROOT+'/'+toolRevision,done=read(directory+'/completed.json'),closure=read(directory+'/application-closure.json'),history=readOnlineRetentionHistory(),certificate=history.entries.at(-1),prior=history.entries.at(-2),actual=observeBookingWorkerPhysical(),saved=read(directory+'/persistence-completed.json');
 need(prior.toolRevision===P.tool&&history.entries.length===P.sequence+1&&certificate.kind==='booking-worker'&&certificate.toolRevision===toolRevision&&certificate.previousSha256===P.head&&closure.incidentSha256===workerApplicationIncidentSha256()&&closure.completedSha256===sha256(bookingHostRead(directory+'/completed.json'))&&closure.certificateSha256===history.headSha256&&closure.mailEnabled===false&&closure.publicationAuthority===false,'scope_changed');
 const probe=read(directory+'/database-preflight.json');need(closure.databasePreflightSha256===sha256(bookingHostRead(directory+'/database-preflight.json'))&&closure.sourceEnvironmentSha256===P.environmentSha256&&probe.sourceEnvironmentSha256===P.environmentSha256&&probe.credentialConfigured===true&&probe.protocol===2&&probe.generation==='9b85e75c-f474-4b17-b2a5-75601f7940b4'&&probe.tickDispatched===false&&probe.businessDataWritten===false&&probe.mailEnabled===false,'evidence_invalid');
 need(canonicalJson(window)===canonicalJson(certificate.workerRelease.window)&&done.toolRevision===toolRevision&&done.certificateSha256===history.headSha256&&done.naturalCycle.status==='completed'&&done.naturalCycle.completedCyclesObserved>=2&&Date.parse(done.naturalCycle.at)-Date.parse(done.naturalCycle.firstCompletedAt)>=60000&&done.mailEnabled===false&&canonicalJson(actual.processes)===canonicalJson(certificate.processes)&&actual.protectedHostSha256===certificate.workerRelease.protectedHostSha256,'operation_unconfirmed');
 need(await verifyPm2Dump(saved.daemon,saved.bootId,saved.registry,saved.receipt)===true,'operation_unconfirmed');
 return {directory,sha256:sha256(bookingHostRead(directory+'/application-closure.json'))};
}
export async function verifyWorkerApplicationPublicRoute(observation){
 return proveRecoveryTargets({origins:['https://faolla.com','https://launch.faolla.com'],target:C,operationId:'00000000-0000-4000-8000-000000000023',verify:()=>{need(readOnlineRetentionHistory().headSha256===observation.historyHead,'scope_changed');},deadlineAtMs:Date.now()+30000});
}
