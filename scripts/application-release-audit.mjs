// Independent read-only acceptance. No process control, RPC mutation, database
// write, lock cleanup, route replacement or success-marker creation is exposed.
import * as fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {APPLICATION_RELEASE_LANE,APPLICATION_RELEASE_MANIFEST,assertApplicationReleaseManifest} from './application-release-policy.mjs';
import {inspectPinnedExecutionSource,parseSourceTree,sourceGit,ownedReleasePath} from './release-toolchain-source.mjs';
import {readOnlineRetentionHistory} from './online-release-retention.mjs';
import {inspectOnlineRetentionWindow} from './online-release-retention-policy.mjs';
import {assertOnlineRetentionPersistedProcesses} from './online-release-retention-writer.mjs';
import {withPinnedFormalPm2Process} from './release-toolchain-proc-witness.mjs';
import {collectFormalBookingPm2Registry} from './release-toolchain-pm2-observation.mjs';
import {normalizeRetirementProcess} from './online-release-retirement.mjs';
import {assertBookingAtomicWorkerGate,assertBookingAtomicWorkerEnvironment} from './booking-atomic-worker.mjs';
import {assertBookingWorkerExecutionRevision} from './release-toolchain-worker-release-contract.mjs';
import {readNaturalWorkerCycle} from './release-toolchain-worker-release-host.mjs';
import {proveRecoveryTargets} from './release-toolchain-recovery-probe.mjs';
import {bookingHostRead} from './booking-handoff-host-io.mjs';
import {WEB_RELEASE_PROXY,WEB_RELEASE_FILES} from './web-presentation-release-policy.mjs';
const ROOT='/var/lib/faolla-online-release',REPOSITORY='/www/wwwroot/merchant-space';
const need=(value,reason)=>{if(!value)throw Error('application_release_audit_'+reason);};
const same=(a,b,reason)=>need(isDeepStrictEqual(a,b),reason);
const read=file=>JSON.parse(bookingHostRead(file));
const digest=text=>createHash('sha256').update(text).digest('hex');
const location=value=>Object.fromEntries(['target','name','directory','port'].map(key=>[key,value[key]]));

export async function observeApplicationRelease(target,{requireCompletion=true}={}){
 need(process.platform==='linux'&&process.getuid?.()===0&&/^[a-f0-9]{40}$/.test(target??''),'invocation');
 const source=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
 need(source==='/var/lib/faolla-online-code/'+target,'source');
 const tool=inspectPinnedExecutionSource({revision:target,directory:source});
 return withPinnedFormalPm2Process(async verify=>{
  const state=read(ROOT+'/'+target+'/state.json'),history=readOnlineRetentionHistory(),certificate=history.entries.at(-1),active=read(ROOT+'/active.json');
  need(state.target===target&&state.status==='active'&&state.lane===APPLICATION_RELEASE_LANE&&certificate?.active.target===target,'not_active');
  same(location(state),active,'metadata');
  need(sourceGit(state.directory,['rev-parse','HEAD']).toString().trim()===target&&
    !sourceGit(state.directory,['status','--porcelain=v1','--untracked-files=all']).toString().trim(),'candidate_source');
  const build=read(ROOT+'/'+target+'/attendance-build-proof.json');
  need(digest(bookingHostRead(ROOT+'/'+target+'/attendance-build-proof.json'))===state.applicationBuildProofSha256&&build.target===target&&
    build.buildId===bookingHostRead(state.directory+'/.next/BUILD_ID',{privateMode:false}).trim()&&build.memoryBytes===4*1024**3&&
    build.heapMiB===3072&&build.cpuQuotaPercent===100&&build.tasks===128&&build.seconds===1200&&build.swapBytes===0&&build.privateNetworkVerified===true,'build_proof');
  need(digest(bookingHostRead(ROOT+'/'+target+'/runtime.json'))===state.applicationRuntimeSha256&&
    digest(bookingHostRead(state.directory+'/.env.local'))===state.applicationEnvironmentFileSha256,'runtime');
  const manifest=JSON.parse(sourceGit(REPOSITORY,['show',target+':'+APPLICATION_RELEASE_MANIFEST]));
  const proof=assertApplicationReleaseManifest(manifest,{baseline:state.baseline,baselineRows:parseSourceTree(sourceGit(REPOSITORY,['ls-tree','-r','-z',state.baseline])),targetRows:tool.rows});
  need(certificate.applicationRelease?.manifestSha256===proof.manifestSha256&&state.applicationManifestSha256===proof.manifestSha256,'manifest');
  if(requireCompletion)need(state.applicationCompletion?.status==='completed'&&state.applicationCompletion.certificateSha256===history.headSha256&&state.applicationCompletion.workerPid>0,'completion_missing');
  const snapshot=collectFormalBookingPm2Registry(),current=snapshot.rows.map(normalizeRetirementProcess);
  const window=inspectOnlineRetentionWindow({history,actualActive:active,current});
  need(window.phase==='stable'&&window.active.target===target&&window.stableRollback.target===state.baseline,'retained_window');
  const workerCertificate=history.entries.filter(entry=>entry.kind==='booking-worker').at(-1);
  need(workerCertificate,'worker_certificate');
  const worker=snapshot.rows.find(row=>row.name===workerCertificate.workerRelease.priorWorker.name);
  need(worker?.pid>0&&worker.pm2_env.status==='online'&&worker.pm2_env.pm_exec_path==='/var/lib/faolla-online-code/'+workerCertificate.toolRevision+'/scripts/booking-atomic-worker.mjs','worker');
  assertBookingAtomicWorkerEnvironment(worker.pm2_env);
  const gateFile='/var/lib/faolla-booking-handoff/'+workerCertificate.workerRelease.candidate+'/worker-enabled.json';
  const gate=read(gateFile);assertBookingWorkerExecutionRevision({gate,history,toolRevision:workerCertificate.toolRevision});
  assertBookingAtomicWorkerGate({gate,history,actualActive:active,current,toolRevision:gate.toolRevision});
  need(digest(bookingHostRead(gateFile))===workerCertificate.workerRelease.gateSha256,'worker_gate');
  const workerSource=inspectPinnedExecutionSource({revision:workerCertificate.toolRevision,directory:'/var/lib/faolla-online-code/'+workerCertificate.toolRevision});
  need(workerSource.inventorySha256===workerCertificate.workerRelease.inventorySha256,'worker_source');
  for(const file of WEB_RELEASE_FILES)need(digest(bookingHostRead(WEB_RELEASE_PROXY+'/'+file,{privateMode:false}))===state.configs[file]?.newHash,'routing');
  const dump=read('/root/.pm2/dump.pm2');assertOnlineRetentionPersistedProcesses(snapshot.rows,dump,{processes:current.slice().sort((a,b)=>a.pmId-b.pmId)});
  const identity=fs.readFileSync('/proc/'+worker.pid+'/stat','utf8').split(')').slice(1).join(')').trim().split(/\s+/)[19];
  ownedReleasePath('/proc/'+worker.pid,{directory:true});
  const verifyUnchanged=()=>{
   verify();same(readOnlineRetentionHistory(),history,'history_changed');same(read(ROOT+'/active.json'),active,'active_changed');
   same(collectFormalBookingPm2Registry().rows.map(normalizeRetirementProcess),current,'processes_changed');
   need(fs.readFileSync('/proc/'+worker.pid+'/stat','utf8').split(')').slice(1).join(')').trim().split(/\s+/)[19]===identity,'worker_replaced');
  };
  const publicProof=await proveRecoveryTargets({origins:['https://faolla.com','https://launch.faolla.com'],target,operationId:randomUUID(),verify:verifyUnchanged,deadlineAtMs:Date.now()+30000});
  const cycle=readNaturalWorkerCycle(worker,Date.parse(certificate.completedAt),2);
  need(cycle,'worker_cycles_pending');verifyUnchanged();
  if(requireCompletion)need(state.applicationCompletion.workerPid===worker.pid,'completion_worker');
  return{kind:'ordinary-application-release-readonly-verified',target,baseline:state.baseline,certificateSha256:history.headSha256,
   manifestSha256:proof.manifestSha256,workerPid:worker.pid,naturalCycle:cycle,publicProof,savedProcessConfigurationVerified:true,
   rollbackRetained:true,otherProcessesUnchanged:true,businessDataWrittenByAudit:false,mailEnabled:false,at:new Date().toISOString()};
 });
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const [target,...extra]=process.argv.slice(2);
 if(extra.length)throw Error('application_release_audit_invocation');
 observeApplicationRelease(target).then(value=>console.log(JSON.stringify(value)),error=>{console.error(JSON.stringify({kind:'application-release-audit-refused',code:/^[a-z_]{1,160}$/.test(error?.message??'')?error.message:'unconfirmed'}));process.exitCode=1;});
}
