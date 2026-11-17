// A read-only inspector of ONE preserved, rolled-back candidate. It cannot
// finish, activate, recover, stop, restart, save, migrate or issue a release receipt.
import * as fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {inspectPinnedExecutionSource,assertUnchangedApplicationSource,sourceGit,parseSourceTree,ownedReleasePath} from './release-toolchain-source.mjs';
import {APPLICATION_RELEASE_LANE,APPLICATION_RELEASE_MANIFEST,assertApplicationReleaseManifest,assertRecordedSchemaDatabase} from './application-release-compatibility.mjs';
import {applicationPublicationProof} from './application-release-publication-proof.mjs';
import {captureApplicationHistoryObservation} from './application-release-history-observation.mjs';
import {inspectOnlineRetentionWindow} from './online-release-retention-policy.mjs';
import {assertOnlineRetentionPersistedProcesses} from './online-release-retention-writer.mjs';
import {withPinnedFormalPm2Process} from './release-toolchain-proc-witness.mjs';
import {collectFormalBookingPm2Registry} from './release-toolchain-pm2-observation.mjs';
import {normalizeResurrectedRetirementProcess as normalizeProcess} from './release-toolchain-process-observation.mjs';
import {assertBookingAtomicWorkerEnvironment,assertBookingAtomicWorkerGate} from './booking-atomic-worker.mjs';
import {assertBookingWorkerExecutionRevision} from './release-toolchain-worker-release-contract.mjs';
import {latestBookingVerifierCertificate,REBOOT_WORKER_NAME} from './release-toolchain-host-reboot-contract.mjs';
import {readNaturalWorkerCycle} from './release-toolchain-worker-release-host.mjs';
import {proveRecoveryTargets} from './release-toolchain-recovery-probe.mjs';
import {bookingHostRead} from './booking-handoff-host-io.mjs';
import {WEB_RELEASE_PROXY,WEB_RELEASE_FILES,webReleaseRuntimeEnvironment} from './web-presentation-release-policy.mjs';
import {observeApplicationFinalization,applicationFinalizationFailure} from './application-release-finalization-diagnostics.mjs';
import {withApplicationCliLifetime} from './application-release-cli-lifetime.mjs';

export const RETAINED_DIAGNOSTIC=Object.freeze({
 target:'a1f3b29cb345b7a804e8a1e5a062c74bcb7fbbf2',
 baseline:'110b022d08d56d51aa86e650f83ced75e4b31cc6',
 historyHead:'e7b9fd1e445f523f39486373ec784adb93e97a0aefe7495782a44e39f9afc95d',
 port:3109,workerPid:1981274,
});
export const RETAINED_DIAGNOSTIC_STEPS=Object.freeze(['source','state','history','build','runtime','manifest','schema','window','worker','persistence','routing','private-version','public-version','worker-cycles','final-witness']);
const ROOT='/var/lib/faolla-online-release',SOURCES='/var/lib/faolla-online-code',REPOSITORY='/www/wwwroot/merchant-space';
const TARGET=RETAINED_DIAGNOSTIC.target,BASELINE=RETAINED_DIAGNOSTIC.baseline,OP=ROOT+'/'+TARGET;
const need=(value,code)=>{if(!value)throw Error('application_retained_diagnostic_'+code);};
const same=(a,b,code)=>need(isDeepStrictEqual(a,b),code);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=file=>JSON.parse(bookingHostRead(file));
const bytesIdentity=stat=>['dev','ino','mode','uid','nlink','size','mtimeNs','ctimeNs'].map(key=>String(stat[key]));

// Test composition only: no production path, permission, writer or caller JSON.
export async function executeRetainedDiagnostic(operations,{emit,clock}={}){
 need(operations&&typeof operations.verify==='function'&&RETAINED_DIAGNOSTIC_STEPS.every(step=>typeof operations[step]==='function'),'invocation');
 return observeApplicationFinalization(TARGET,'retained',async mark=>{
  const checks={};
  for(const step of RETAINED_DIAGNOSTIC_STEPS){mark('retained-'+step);checks[step]=await operations[step]();await operations.verify();}
  return{kind:'application-retained-candidate-readonly-diagnostic',target:TARGET,baseline:BASELINE,checks,
   diagnosticCompleted:true,publicationAuthority:false,publicationCompleted:false,originalPublicationAuditAdmissible:false,
   businessDataWritten:false,processControlPerformed:false,routeChanged:false,existingBuildModified:false,mailEnabled:false,at:new Date().toISOString()};
 },{emit,clock});
}
export function assertRetainedDiagnosticInvocation({argv,platform,uid,executable,version,entry}){
 const match=/^\/var\/lib\/faolla-online-code\/([a-f0-9]{40})\/scripts\/application-release-retained-diagnostic\.mjs$/.exec(entry??'');
 need(platform==='linux'&&uid===0&&executable==='/usr/bin/node'&&version==='v20.20.1'&&Array.isArray(argv)&&argv.length===2&&argv[1]===entry&&match,'invocation');
 return{toolRevision:match[1],directory:SOURCES+'/'+match[1]};
}
export async function probeRetainedVersion(port){
 need(Number.isSafeInteger(port)&&port>0&&port<=65535,'version_scope');
 return new Promise((resolve,reject)=>{
  let settled=false,response,timer;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error){response?.destroy();request.destroy();reject(error);}else resolve(value);};
  const request=http.request({hostname:'127.0.0.1',port,path:'/api/app-web-version',method:'GET',agent:false,maxHeaderSize:16384,
   headers:{Host:'www.faolla.com',Connection:'close','X-Forwarded-Proto':'https'}},incoming=>{
   response=incoming;let size=0;const chunks=[];
   incoming.on('data',chunk=>{size+=chunk.length;if(size>4096)finish(Error('application_retained_diagnostic_version_body_limit'));else chunks.push(chunk);});
   incoming.on('aborted',()=>finish(Error('application_retained_diagnostic_version_probe')));
   incoming.on('error',()=>finish(Error('application_retained_diagnostic_version_probe')));
   incoming.on('end',()=>{if(settled)return;try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));need(incoming.statusCode===200&&value?.ok===true&&/^[a-f0-9]{40}$/.test(value.buildId??''),'version_probe');finish(null,{status:200,buildId:value.buildId});}catch{finish(Error('application_retained_diagnostic_version_probe'));}});
  });
  request.on('error',()=>finish(Error('application_retained_diagnostic_version_probe')));
  timer=setTimeout(()=>finish(Error('application_retained_diagnostic_version_timeout')),5000);request.end();
 });
}
function fileWitness(files){
 const sample=({file,privateMode=true})=>{
  ownedReleasePath(file,{privateMode});const before=fs.lstatSync(file,{bigint:true}),fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{const opened=fs.fstatSync(fd,{bigint:true});same(bytesIdentity(before),bytesIdentity(opened),'file_changed');need(before.size<=32n*1024n**2n,'file_changed');const bytes=fs.readFileSync(fd);same(bytesIdentity(fs.fstatSync(fd,{bigint:true})),bytesIdentity(before),'file_changed');same(bytesIdentity(fs.lstatSync(file,{bigint:true})),bytesIdentity(before),'file_changed');return[bytesIdentity(before),digest(bytes)];}finally{fs.closeSync(fd);}
 };
 const original=files.map(sample);return()=>same(files.map(sample),original,'file_changed');
}
export async function runRetainedDiagnostic(){
 const invocation=assertRetainedDiagnosticInvocation({argv:process.argv,platform:process.platform,uid:process.getuid?.(),executable:process.execPath,version:process.version,entry:fileURLToPath(import.meta.url)});
 need(!fs.existsSync('/var/lib/faolla-maintenance/merchant-space/operation.lock'),'busy');
 return withPinnedFormalPm2Process(async verifyPeer=>{
  let tool,application,state,active,historyObservation,history,certificate,snapshot,current,worker,manifest,manifestProof,witness;
  const gateFile='/var/lib/faolla-booking-handoff/f274ad615550c83717aa7af2ad32339608e6f8aa/worker-enabled.json';
  const operations={
   source:async()=>{
    tool=inspectPinnedExecutionSource({revision:invocation.toolRevision,directory:invocation.directory});
    application=inspectPinnedExecutionSource({revision:TARGET,directory:SOURCES+'/'+TARGET});
    assertUnchangedApplicationSource(TARGET,application.rows,tool.rows);
    return{toolRevision:invocation.toolRevision,applicationUnchanged:true,dependenciesUnchanged:true,migrationsUnchanged:true};
   },
   state:async()=>{
    state=read(OP+'/state.json');active=read(ROOT+'/active.json');
    need(state.target===TARGET&&state.baseline===BASELINE&&state.lane===APPLICATION_RELEASE_LANE&&state.status==='rolled-back'&&state.port===RETAINED_DIAGNOSTIC.port&&state.directory==='/www/wwwroot/merchant-space.web-releases/'+TARGET.slice(0,12)+'-online'&&state.name==='merchant-space-online-'+TARGET.slice(0,12),'state');
    same(active,state.previousActive??{target:BASELINE,port:state.oldPort,directory:state.oldDirectory,name:state.oldName},'active');need(active.target===BASELINE&&!state.applicationCompletion,'state');
    witness=fileWitness([
     ...[OP+'/state.json',ROOT+'/active.json','/var/lib/faolla-online-retention.head.json','/root/.pm2/dump.pm2',OP+'/attendance-build-proof.json',OP+'/runtime.json',state.directory+'/.env.local',gateFile].map(file=>({file})),
     ...WEB_RELEASE_FILES.flatMap(file=>[{file:WEB_RELEASE_PROXY+'/'+file,privateMode:false},{file:OP+'/before-'+file},{file:OP+'/after-'+file}]),
    ]);return{candidateState:'rolled-back',actualActiveTarget:active.target,originalPublicationAuditAdmissible:false};
   },
   history:async()=>{
    historyObservation=captureApplicationHistoryObservation();history=historyObservation.history;certificate=history.entries.at(-1);
    need(history.headSha256===RETAINED_DIAGNOSTIC.historyHead&&certificate?.active.target===TARGET&&certificate.rollback.target===BASELINE,'history');
    snapshot=collectFormalBookingPm2Registry();current=snapshot.rows.map(normalizeProcess);
    return{entries:history.entries.length,headSha256:history.headSha256};
   },
   build:async()=>{
    const build=read(OP+'/attendance-build-proof.json');
    need(sourceGit(state.directory,['rev-parse','HEAD']).toString().trim()===TARGET&&!sourceGit(state.directory,['status','--porcelain=v1','--untracked-files=all']).toString().trim(),'build');
    need(digest(bookingHostRead(OP+'/attendance-build-proof.json'))===state.applicationBuildProofSha256&&build.target===TARGET&&build.buildId===bookingHostRead(state.directory+'/.next/BUILD_ID',{privateMode:false}).trim()&&build.memoryBytes===4*1024**3&&build.heapMiB===3072&&build.cpuQuotaPercent===100&&build.tasks===128&&build.seconds===1200&&build.swapBytes===0&&build.privateNetworkVerified===true,'build');
    return{originalBuildVerified:true,rebuildPerformed:false};
   },
   runtime:async()=>{
    need(digest(bookingHostRead(OP+'/runtime.json'))===state.applicationRuntimeSha256&&digest(bookingHostRead(state.directory+'/.env.local'))===state.applicationEnvironmentFileSha256,'runtime');
    const candidate=snapshot.rows.find(row=>row.name===state.name);need(candidate?.pid>0&&candidate.pm2_env.status==='online'&&candidate.pm2_env.pm_cwd===state.directory,'runtime');
    const runtime=read(OP+'/runtime.json'),physical=webReleaseRuntimeEnvironment(fs.readFileSync('/proc/'+candidate.pid+'/environ','utf8'));
    for(const values of [runtime,candidate.pm2_env,physical])need(values.FAOLLA_WEB_BUILD_ID===TARGET&&values.NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID===TARGET&&values.FAOLLA_BACKGROUND_JOBS_PAUSED==='1'&&values.MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED==='0'&&values.MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED==='0'&&!values.RESEND_API_KEY&&!values.BOOKING_CONFIRMATION_EMAIL_FROM,'runtime');
    return{runtimeBindingsVerified:true,candidateBackgroundPaused:true,mailEnabled:false};
   },
   manifest:async()=>{
    manifest=JSON.parse(sourceGit(REPOSITORY,['show',TARGET+':'+APPLICATION_RELEASE_MANIFEST]));
    manifestProof=assertApplicationReleaseManifest(manifest,{baseline:BASELINE,baselineRows:parseSourceTree(sourceGit(REPOSITORY,['ls-tree','-r','-z',BASELINE])),targetRows:application.rows});
    const publication=applicationPublicationProof(history,TARGET);
    need(publication.manifestSha256===manifestProof.manifestSha256&&state.applicationManifestSha256===manifestProof.manifestSha256,'manifest');
    return{manifestSha256:manifestProof.manifestSha256};
   },
   schema:async()=>{const value=assertRecordedSchemaDatabase(manifest);return{kind:value.kind,databaseExecutionPerformed:false,businessDataWritten:false};},
   window:async()=>{const value=inspectOnlineRetentionWindow({history,actualActive:active,current});need(value.phase==='rolled-back'&&value.active.target===BASELINE&&!value.mayRetire&&!value.mayRollback,'window');return{phase:value.phase,publicationAuthority:false};},
   worker:async()=>{
    const workerCertificate=latestBookingVerifierCertificate(history);need(workerCertificate,'worker');
    worker=snapshot.rows.find(row=>row.name===(workerCertificate.workerRelease?.priorWorker.name??REBOOT_WORKER_NAME));
    need(worker?.pid===RETAINED_DIAGNOSTIC.workerPid&&worker.pm2_env.status==='online'&&worker.pm2_env.pm_exec_path===SOURCES+'/'+workerCertificate.toolRevision+'/scripts/booking-atomic-worker.mjs','worker');
    assertBookingAtomicWorkerEnvironment(worker.pm2_env);const gate=read(gateFile);
    assertBookingWorkerExecutionRevision({gate,history,toolRevision:workerCertificate.toolRevision});
    assertBookingAtomicWorkerGate({gate,history,actualActive:active,current,toolRevision:gate.toolRevision});
    const context=workerCertificate.workerRelease??workerCertificate.hostReboot;
    need(digest(bookingHostRead(gateFile))===context.gateSha256,'worker_gate');
    const source=inspectPinnedExecutionSource({revision:workerCertificate.toolRevision,directory:SOURCES+'/'+workerCertificate.toolRevision});
    need(source.inventorySha256===(context.inventorySha256??context.sourceInventorySha256),'worker_source');
    return{pid:worker.pid,sourceAndGateVerified:true,processControlPerformed:false};
   },
   persistence:async()=>{assertOnlineRetentionPersistedProcesses(snapshot.rows,read('/root/.pm2/dump.pm2'),{processes:current.slice().sort((a,b)=>a.pmId-b.pmId)});return{savedAndActualProcessesMatch:true};},
   routing:async()=>{
    for(const file of WEB_RELEASE_FILES){need(digest(bookingHostRead(WEB_RELEASE_PROXY+'/'+file,{privateMode:false}))===state.configs[file]?.oldHash&&digest(bookingHostRead(OP+'/before-'+file))===state.configs[file].oldHash&&digest(bookingHostRead(OP+'/after-'+file))===state.configs[file].newHash,'routing');}
    return{currentRoutesMatchVerifiedRollback:true,routeChanged:false};
   },
   'private-version':async()=>{const value=await probeRetainedVersion(state.port);need(value.buildId===TARGET,'private_version');return value;},
   'public-version':()=>proveRecoveryTargets({origins:['https://faolla.com','https://launch.faolla.com'],target:BASELINE,operationId:randomUUID(),verify:operations.verify,deadlineAtMs:Date.now()+30000}),
   'worker-cycles':async()=>{const value=readNaturalWorkerCycle(worker,Date.parse(certificate.completedAt),2);need(value,'worker_cycles');return value;},
   'final-witness':async()=>{historyObservation.finish();historyObservation=null;witness();verifyPeer();inspectPinnedExecutionSource({revision:invocation.toolRevision,directory:invocation.directory});inspectPinnedExecutionSource({revision:TARGET,directory:SOURCES+'/'+TARGET});need(!fs.existsSync('/var/lib/faolla-maintenance/merchant-space/operation.lock'),'busy');return{allObservedFilesAndProcessesUnchanged:true};},
   verify:async()=>{verifyPeer();witness?.();historyObservation?.verify();if(current)same(collectFormalBookingPm2Registry().rows.map(normalizeProcess),current,'runtime');},
  };
  return executeRetainedDiagnostic(operations,{emit:value=>console.error(JSON.stringify(value))});
 });
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 await withApplicationCliLifetime(()=>runRetainedDiagnostic()).then(value=>console.log(JSON.stringify(value)),error=>{
  console.error(JSON.stringify({kind:'application-retained-candidate-diagnostic-refused',...applicationFinalizationFailure(error),publicationAuthority:false,publicationCompleted:false}));process.exitCode=1;
 });
}
