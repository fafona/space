// Fixed, independently reviewed source-only worker recovery. No web switch,
// application build, database write, manual automation tick or mail activation.
import * as fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {REGISTRY_RECOVERY as P,registryAdapterContext,registryRecoveryHash as hash,assertRegistryRecoveryHistory,assertRegistryRecoverySourceDelta} from './release-toolchain-registry-recovery-policy.mjs';
import {collectRemoteReleaseReview,assertReviewFresh,inspectPinnedExecutionSource,parseSourceTree,sourceGit,ownedReleasePath} from './release-toolchain-source.mjs';
import {withPinnedFormalPm2Process} from './release-toolchain-proc-witness.mjs';
import {withRetainedApplicationAttestation} from './release-toolchain-application-attestation.mjs';
import {collectFormalBookingPm2Registry} from './release-toolchain-pm2-observation.mjs';
import {normalizeResurrectedRetirementProcess as normalize} from './release-toolchain-process-observation.mjs';
import {readOnlineRetentionHistory,buildOnlineRetentionPreparation,buildOnlineRetentionReceipt} from './online-release-retention.mjs';
import {retentionCanonicalText,retentionHash,inspectOnlineRetentionWindow,assertOnlineRetentionHistory,onlineRetentionHeadRecord} from './online-release-retention-policy.mjs';
import {withOnlineRetentionLocks,assertOnlineRetentionHeldLocks,createOnlineRetentionJournal} from './online-release-retention-writer.mjs';
import {assertBookingWorkerOnlyDelta,assertBookingWorkerExecutionRevision} from './release-toolchain-worker-release-contract.mjs';
import {assertBookingAtomicWorkerEnvironment,assertBookingAtomicWorkerGate} from './booking-atomic-worker.mjs';
import {captureProcessFact} from './check-production-runtime-supervision.mjs';
import {captureFileContinuity} from './release-toolchain-file-continuity.mjs';
import {bookingHostRead,bookingHostWriteOnce,bookingHostSync,bookingHostEnvironment} from './booking-handoff-host-io.mjs';
import {bookingWorkerProtectedFilePlan,readNaturalWorkerCycle} from './release-toolchain-worker-release-host.mjs';
import {bookingReadyWorkerConfiguration,assertBookingReadyWorkerRawTransition} from './booking-ready-worker.mjs';
import {bookingLegacyRpcExpected} from './booking-handoff-legacy.mjs';
import {stablePm2RegistryRow,assertCompletePm2DumpSet} from './release-toolchain-pm2-transition.mjs';
import {captureCapacityPm2DumpTarget,persistCapacityPm2Dump,verifyCapacityPm2Dump,inspectCapacityPm2Registry} from './release-toolchain-registry-capacity-adapter.mjs';
import {captureTrustedPython,verifyTrustedPython} from './production-maintenance-trusted-python.mjs';
import {verifyWorkerEntryCiArtifact} from './release-toolchain-worker-release-ci.mjs';
import {proveRecoveryTargets} from './release-toolchain-recovery-probe.mjs';
const source=path.dirname(path.dirname(fileURLToPath(import.meta.url))),revision=path.basename(source);
const ROOT='/var/lib/faolla-booking-registry-recovery',RELEASE='/var/lib/faolla-online-release',NAME='merchant-space-booking-atomic-f274ad615550',HANDOFF='/var/lib/faolla-booking-handoff/f274ad615550c83717aa7af2ad32339608e6f8aa';
const need=(v,c)=>{if(!v)throw Error('booking_registry_recovery_'+c);},same=(a,b)=>need(isDeepStrictEqual(a,b),'changed');
const read=p=>JSON.parse(bookingHostRead(p)),seal=(d,n,v)=>bookingHostWriteOnce(d+'/'+n,retentionCanonicalText(v)),pause=ms=>new Promise(r=>setTimeout(r,ms));
const boot=()=>fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
const diagnosticFacts=new WeakMap();
const PHASES=new Set(['invocation','admission','manager-witness','application-attestation','locks','attempt-absence','history','physical','incident','process-binding','gate-binding','official-ci','capacity-binding','protected-file-plan','file-continuity','protected-host','retention-head','context','before-record','preparation-validation','final-preflight','readonly-complete','recovery-directory','preflight','worker-source-transition','settlement','persistence','natural-cycles']);
const SYSTEM_CODES=new Set(['ENOENT','EACCES','EPERM','EEXIST','ENOSPC','EMFILE','ENFILE','EIO','ETIMEDOUT','ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN','ABORT_ERR','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_SOCKET']);
const ERROR_NAMES=new Set(['Error','TypeError','RangeError','SyntaxError','AbortError','TimeoutError','ToolchainError']);
// Fixed guard-code families, never arbitrary messages, paths, RPC output,
// registry rows, environment values or stacks. Digits in PM2 codes matter.
export function registryRecoveryFailureReport(error,{action='unknown',phase='unobserved'}={}){
 const message=typeof error?.message==='string'?error.message:'',code=/^(?:booking_registry_recovery|release_toolchain|release_proc_directory_witness|release_static_attestation|online_retention|online_rolling|booking_host|booking_ready_backup|booking_dependency|booking_atomic_worker|booking_ready_worker|booking_handoff|booking_worker_release|host_reboot_manager)_[a-z0-9_]{1,120}$/.test(message)?message:'unconfirmed';
 return{kind:'booking-registry-recovery-refused',code,action:['inspect','publish','audit','finish'].includes(action)?action:'unknown',phase:PHASES.has(phase)?phase:'unobserved',errorName:ERROR_NAMES.has(error?.name)?error.name:'Error',...(SYSTEM_CODES.has(error?.code)?{systemCode:error.code}:{}),...(SYSTEM_CODES.has(error?.cause?.code)?{causeCode:error.cause.code}:{}),errorSha256:hash(message),automaticRetryAllowed:false,mailEnabled:false};
}
async function diagnosed(action,work){
 let phase='invocation';
 const progress=next=>{need(PHASES.has(next),'diagnostic_phase');phase=next;if(process.argv[1]===source+'/scripts/release-toolchain-registry-recovery.mjs')console.error(JSON.stringify({kind:'booking-registry-recovery-step',action,phase,at:new Date().toISOString()}));};
 try{return await work(progress);}catch(error){if(error&&typeof error==='object')diagnosticFacts.set(error,{action,phase});throw error;}
}
function raw(pid){return Object.fromEntries(fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').filter(Boolean).map(r=>{const i=r.indexOf('=');need(i>0,'environment');return[r.slice(0,i),r.slice(i+1)];}));}
function identity(pid){const p=captureProcessFact(pid);return{pid:p.pid,uid:p.uid,startTicks:p.startTicks,parentPid:p.parentPid,cwd:p.cwd,executable:p.executable,commandSha256:p.commandLineDigest,environmentSha256:hash(fs.readFileSync('/proc/'+pid+'/environ'))};}
function physical(){
 const snapshot=collectFormalBookingPm2Registry(),worker=snapshot.rows.find(v=>v.name===NAME);need(worker?.pid>0&&worker.pm_id===24&&worker.pm2_env.status==='online','worker');
 const processes=snapshot.rows.map(normalize).sort((a,b)=>a.pmId-b.pmId),workerIdentity=identity(worker.pid),environment=raw(worker.pid),configured=bookingReadyWorkerConfiguration(worker.pm2_env);
 assertBookingAtomicWorkerEnvironment(environment);assertBookingAtomicWorkerEnvironment(worker.pm2_env.env);
 need(workerIdentity.parentPid===snapshot.daemon.pid&&workerIdentity.uid===0&&workerIdentity.executable==='/usr/bin/node'&&workerIdentity.cwd===worker.pm2_env.pm_cwd,'worker_identity');
 return{snapshot,worker,processes,workerIdentity,raw:environment,configured,
  others:snapshot.rows.filter(v=>v.name!==NAME).map(v=>({row:stablePm2RegistryRow(v),...(v.pid>0?{identity:identity(v.pid)}:{})}))};
}
function protectedFiles(history){
 const plans=new Map(bookingWorkerProtectedFilePlan().map(p=>[p.file,p]));
 for(const f of [RELEASE+'/'+P.target+'/state.json'])plans.set(f,{file:f,privateMode:true});
 for(const a of [history.entries.at(-1).active,history.entries.at(-1).rollback]){
  plans.set(a.directory+'/.env.local',{file:a.directory+'/.env.local',privateMode:true});
  plans.set(a.directory+'/.next/BUILD_ID',{file:a.directory+'/.next/BUILD_ID',privateMode:false});
  need(sourceGit(a.directory,['rev-parse','HEAD']).toString().trim()===a.target&&!sourceGit(a.directory,['status','--porcelain=v1','--untracked-files=all']).toString().trim(),'website_source');
 }
 return [...plans.values()];
}
async function admission(action){
 need(process.platform==='linux'&&process.getuid?.()===0&&process.execPath==='/usr/bin/node'&&process.version==='v20.20.1'&&source==='/var/lib/faolla-online-code/'+revision&&/^[a-f0-9]{40}$/.test(revision)&&process.cwd()===source&&process.argv.length===3&&process.argv[1]===source+'/scripts/release-toolchain-registry-recovery.mjs'&&process.argv[2]===action,'invocation');
 same(captureProcessFact(process.pid).commandLine,['/usr/bin/node',source+'/scripts/release-toolchain-registry-recovery.mjs',action]);
 const review=await collectRemoteReleaseReview(revision),inventory=inspectPinnedExecutionSource({revision,directory:source});assertReviewFresh(review,revision);
 const inputs=assertRegistryRecoverySourceDelta(parseSourceTree(sourceGit('/www/wwwroot/merchant-space',['ls-tree','-r','-z',P.target])),inventory.rows);
 return{review,inventory,inputs};
}
// The exact pre-mutation checks are shared by inspect and publish. This helper
// is private: callers cannot supply facts, reuse its result or acquire authority
// from a green inspection report. It cannot lock, write, restart or persist.
async function prepareRegistryRecoveryPreflight(admitted,verifyDaemon,progress){
  progress('attempt-absence');
  const directory=ROOT+'/'+revision;need(!fs.existsSync(directory),'attempt_replay_forbidden');
  progress('history');const history=readOnlineRetentionHistory();assertOnlineRetentionHistory(history);
  progress('physical');const original=physical();
  progress('incident');const gateText=bookingHostRead(HANDOFF+'/worker-enabled.json'),gate=JSON.parse(gateText);
  need(boot()===P.bootId&&hash(gateText)===P.gateSha256&&hash(bookingHostRead(RELEASE+'/active.json'))===P.activeSha256&&hash(bookingHostRead(RELEASE+'/'+P.target+'/state.json'))===P.failedStateSha256,'incident');
  progress('process-binding');
  same(original.processes,history.entries.at(-1).processes);inspectOnlineRetentionWindow({history,actualActive:read(RELEASE+'/active.json'),current:original.processes});
  progress('gate-binding');
  assertBookingWorkerExecutionRevision({gate,history,toolRevision:P.priorToolRevision});
  assertBookingAtomicWorkerGate({gate,history,actualActive:read(RELEASE+'/active.json'),current:original.processes,toolRevision:gate.toolRevision});
  progress('official-ci');
  const ci=await verifyWorkerEntryCiArtifact({revision,review:admitted.review,file:'/var/lib/faolla-booking-worker-admissions/'+revision+'/ci-evidence.zip',source});
  progress('capacity-binding');
  const capacity=ci.report.registryCapacity;need(capacity?.kind==='real-pm2-large-registry-capacity-verified'&&capacity.toolRevision===revision&&capacity.rawBytes>1048576&&capacity.rawBytes<=4194304&&capacity.maximumFrameBytes===4194304&&capacity.actualPrivatePm2===true&&capacity.completeRegistryRead===true&&capacity.originalReaderRefused===true&&capacity.allOriginalRowsUnchanged===true&&capacity.rawEnvironmentsNotLogged===true&&capacity.formalHostTouched===false&&capacity.publicationAuthority===false,'native_capacity_evidence');
  same(capacity.sourceHashes,Object.fromEntries(['release-toolchain-registry-capacity.py','release-toolchain-pm2-observation.mjs','production-maintenance-pm2-control.py'].map(n=>[n,hash(fs.readFileSync(source+'/scripts/'+n))])));
  progress('protected-file-plan');const files=protectedFiles(history);
  progress('file-continuity');const continuity=captureFileContinuity({files:[...files.map(p=>p.file),...admitted.inventory.rows.filter(p=>!p.file.startsWith('public/downloads/')).map(p=>source+'/'+p.file)]}),protectedHash=()=>hash(retentionCanonicalText({files:files.map(p=>[p.file,hash(bookingHostRead(p.file,{privateMode:p.privateMode}))]),others:physical().others}));
  progress('protected-host');const protectedHostSha256=protectedHash();
  progress('retention-head');const initialHeadHash=hash(bookingHostRead('/var/lib/faolla-online-retention.head.json')),startedAt=new Date().toISOString(),window={id:randomUUID(),startedAt,deadlineAt:new Date(Date.parse(startedAt)+600000).toISOString()};
  const verifyPrepared=committed=>{verifyDaemon();assertReviewFresh(admitted.review,revision);continuity.assertUnchanged();need(boot()===P.bootId&&Date.now()<Date.parse(window.deadlineAt),'window');same(protectedHash(),protectedHostSha256);same(hash(bookingHostRead('/var/lib/faolla-online-retention.head.json')),committed?hash(retentionCanonicalText(onlineRetentionHeadRecord(committed))):initialHeadHash);};
  progress('context');
  const context={version:2,kind:'booking-worker-source-only',candidate:gate.candidate,toolRevision:revision,priorToolRevision:P.priorToolRevision,priorWorker:original.processes.find(p=>p.name===NAME),gateSha256:P.gateSha256,publicationCertificateSha256:gate.certificateSha256,inventorySha256:admitted.inventory.inventorySha256,nativeEvidenceSha256:hash(retentionCanonicalText(ci)),protectedHostSha256,window,mailEnabled:false,registryAdapter:registryAdapterContext()};
  assertRegistryRecoveryHistory(history,context);
  progress('before-record');
  const prior=history.entries.at(-1),before={...Object.fromEntries(['version','policy','legacySha256','rollingHeadSha256','rollingHistorySha256','active','rollback','victim'].map(k=>[k,structuredClone(prior[k])])),kind:'booking-worker',sequence:history.entries.length+1,previousSha256:history.headSha256,toolRevision:revision,workerRelease:context,processes:original.processes,workerIdentity:original.workerIdentity,protectedHostSha256,persistenceSha256:null};
  progress('preparation-validation');buildOnlineRetentionPreparation(before,{version:2,process:null},history,new Date().toISOString());
  progress('final-preflight');verifyPrepared(null);
  return{directory,history,original,gate,protectedHostSha256,startedAt,window,context,before,verifyPrepared};
}
export async function inspectRegistryRecovery(){
 return diagnosed('inspect',async progress=>{
  progress('admission');const admitted=await admission('inspect');
  progress('manager-witness');return withPinnedFormalPm2Process(verifyDaemon=>{
   progress('application-attestation');return withRetainedApplicationAttestation(async()=>{
    const prepared=await prepareRegistryRecoveryPreflight(admitted,verifyDaemon,progress),{history,original}=prepared;
    progress('readonly-complete');
    return{kind:'booking-registry-recovery-inspected',revision,historyHead:history.headSha256,workerPid:original.worker.pid,workerRestarts:original.worker.pm2_env.restart_time,rows:original.processes.length,maximumFrameBytes:4194304,inputs:admitted.inputs,sourceInventorySha256:admitted.inventory.inventorySha256,completePreflightVerified:true,readOnly:true,mutationPerformed:false,publicationAuthority:false};
   });
  });
 });
}
export async function publishRegistryRecovery(){
 return diagnosed('publish',async progress=>{
  progress('admission');const admitted=await admission('publish');
  progress('manager-witness');return withPinnedFormalPm2Process(verifyDaemon=>{
   progress('application-attestation');return withRetainedApplicationAttestation(()=>{
    progress('locks');return withOnlineRetentionLocks(async lock=>{
  const {directory,history,original,gate,startedAt,window,context,before,verifyPrepared}=await prepareRegistryRecoveryPreflight(admitted,verifyDaemon,progress);
  let attempted=false,committed=null,phase='preflight';
  const check=()=>{assertOnlineRetentionHeldLocks(lock);verifyPrepared(committed);};
  progress('recovery-directory');
  if(!fs.existsSync(ROOT)){ownedReleasePath('/var/lib',{directory:true});fs.mkdirSync(ROOT,{mode:0o700});bookingHostSync('/var/lib');}ownedReleasePath(ROOT,{directory:true,privateMode:true});fs.mkdirSync(directory,{mode:0o700});bookingHostSync(ROOT);
  try{
   check();seal(directory,'intent.json',{kind:P.kind,revision,historyHead:history.headSha256,context,before,inputs:admitted.inputs,at:startedAt});
   // Keep the original dump and backup as private immutable evidence before
   // the one source-only mutation; never disclose these credential-bearing files.
   for(const [file,name]of [['/root/.pm2/dump.pm2','dump.pm2.before'],['/root/.pm2/dump.pm2.bak','dump.pm2.bak.before']])if(fs.existsSync(file))bookingHostWriteOnce(directory+'/'+name,bookingHostRead(file,{privateMode:false}));
   const preparation=buildOnlineRetentionPreparation(before,{version:2,process:null},history,new Date().toISOString()),journal=createOnlineRetentionJournal(history);
   journal.begin();journal.write('prepared.json',preparation.preparedText);journal.write('before.json',preparation.beforeText);journal.write('recovery-pm2.json',preparation.recoveryText);
   const expected=bookingLegacyRpcExpected({...original.worker,pm2_env:{...original.worker.pm2_env,args:original.worker.pm2_env.args??[],node_args:original.worker.pm2_env.node_args??[]}}),attempt={kind:'booking-registry-capacity-restart-attempt',revision,context,expected,controller:captureProcessFact(process.pid),at:new Date().toISOString()};
   check();seal(directory,'worker-attempt.json',attempt);attempted=true;phase='worker-source-transition';progress(phase);
   const python=captureTrustedPython();verifyTrustedPython(python);const result=spawnSync(python.target.path,['-I','-S','-B',source+'/scripts/release-toolchain-registry-recovery-pm2.py'],{input:JSON.stringify({daemon:original.snapshot.daemonPeer,process:processPeer(original.worker.pid),expected,revision,attemptSha256:hash(bookingHostRead(directory+'/worker-attempt.json'))}),encoding:'utf8',timeout:35000,killSignal:'SIGKILL',maxBuffer:524288,cwd:source,env:bookingHostEnvironment(),stdio:['pipe','pipe','pipe',lock.deployFd]});verifyTrustedPython(python);
   need(result.status===0&&!result.error&&!result.signal&&result.stderr==='','restart_unconfirmed');seal(directory,'worker-ack.json',JSON.parse(result.stdout));
   let settled;phase='settlement';progress(phase);
   for(let i=0;i<100;i++){check();const actual=physical();try{assertBookingWorkerOnlyDelta(original.processes,actual.processes,context);assertBookingReadyWorkerRawTransition(original.raw,actual.raw,original.configured,actual.configured);settled=actual;break;}catch{await pause(100);}}
   need(settled,'worker_unsettled');
   const {commandLine,...daemon}=captureProcessFact(original.snapshot.daemon.pid),bootId=boot();same(commandLine,['PM2 v6.0.14: God Daemon (/root/.pm2)']);
   phase='persistence';progress(phase);const registry=await inspectCapacityPm2Registry(daemon,bootId);same(registry,settled.snapshot.filteredRegistry);assertCompletePm2DumpSet(settled.snapshot.rows,registry);const target=await captureCapacityPm2DumpTarget(daemon,bootId);check();
   const persisted=await persistCapacityPm2Dump(daemon,bootId,registry,target);seal(directory,'persistence.json',persisted);need(await verifyCapacityPm2Dump(daemon,bootId,registry,persisted),'persistence');check();
   const after={...before,processes:settled.processes,workerIdentity:settled.workerIdentity,persistenceSha256:hash(bookingHostRead(directory+'/persistence.json'))};
   const receipt=buildOnlineRetentionReceipt(before,after,{version:2,process:null},history,{preparedAt:JSON.parse(preparation.preparedText).preparedAt,completedAt:new Date().toISOString()});journal.write('after.json',receipt.files.get('after.json'));journal.write('certificate.json',receipt.files.get('certificate.json'));committed=journal.complete(receipt.certificate);phase='natural-cycles';progress(phase);
   let natural=null;const naturalStart=Date.now();while(Date.now()-naturalStart<160000){check();same(physical().processes,settled.processes);natural=readNaturalWorkerCycle(settled.worker,Date.parse(receipt.certificate.completedAt),2);if(natural)break;await pause(5000);}need(natural,'natural_cycles_unconfirmed');
   const publicProof=await proveRecoveryTargets({origins:['https://faolla.com','https://launch.faolla.com'],target:P.baseline,operationId:window.id,verify:check,deadlineAtMs:Math.min(Date.now()+30000,Date.parse(window.deadlineAt))});
   check();same(readOnlineRetentionHistory(),committed);need(await verifyCapacityPm2Dump(daemon,bootId,registry,persisted),'persistence');assertBookingWorkerExecutionRevision({gate,history:committed,toolRevision:revision});assertBookingAtomicWorkerGate({gate,history:committed,actualActive:read(RELEASE+'/active.json'),current:physical().processes,toolRevision:gate.toolRevision});
   const completed={kind:'booking-registry-recovery-completed',revision,certificateSha256:retentionHash(receipt.certificate),workerPid:settled.worker.pid,workerRestarts:settled.worker.pm2_env.restart_time,naturalCycle:natural,publicProof,originalGateUnchanged:true,websiteUnchanged:true,otherProcessesUnchanged:true,applicationRebuilt:false,mailEnabled:false,at:new Date().toISOString()};seal(directory,'completed.json',completed);return completed;
  }catch(error){seal(directory,'unconfirmed.json',{kind:'booking-registry-recovery-unconfirmed',revision,phase,attempted,certificateCommitted:!!committed,errorSha256:hash(String(error?.message)),automaticRetryAllowed:false,mailEnabled:false,at:new Date().toISOString()});throw error;}
    });
   });
  });
 });
}
// Read-only re-audit, or completion-only sealing after an interrupted observer.
// Neither action can invoke a restart, persist a dump, change history or retry
// a failed mutation. A complete committed certificate is mandatory first.
export async function auditRegistryRecovery(action='audit'){
 need(['audit','finish'].includes(action),'action');const admitted=await admission(action);
 const observe=async()=>withPinnedFormalPm2Process(verifyDaemon=>withRetainedApplicationAttestation(async()=>{
  const directory=ROOT+'/'+revision,intent=read(directory+'/intent.json'),history=readOnlineRetentionHistory(),certificate=history.entries.at(-1),actual=physical(),gate=read(HANDOFF+'/worker-enabled.json');
  need(intent.kind===P.kind&&intent.revision===revision&&intent.context.inventorySha256===admitted.inventory.inventorySha256&&history.entries.length===66&&certificate.kind==='booking-worker'&&certificate.toolRevision===revision&&certificate.previousSha256===P.historyHead,'committed_recovery');
  same(certificate.workerRelease,intent.context);same(actual.processes,certificate.processes);
  need(boot()===P.bootId&&hash(bookingHostRead(RELEASE+'/active.json'))===P.activeSha256&&hash(bookingHostRead(RELEASE+'/'+P.target+'/state.json'))===P.failedStateSha256&&hash(bookingHostRead(HANDOFF+'/worker-enabled.json'))===P.gateSha256,'incident');
  const files=protectedFiles(history),frozen=captureFileContinuity({files:files.map(p=>p.file)}),expectedProtected=intent.context.protectedHostSha256;
  const check=()=>{verifyDaemon();frozen.assertUnchanged();assertReviewFresh(admitted.review,revision);same(hash(retentionCanonicalText({files:files.map(p=>[p.file,hash(bookingHostRead(p.file,{privateMode:p.privateMode}))]),others:physical().others})),expectedProtected);};
  check();assertBookingWorkerExecutionRevision({gate,history,toolRevision:revision});assertBookingAtomicWorkerGate({gate,history,actualActive:read(RELEASE+'/active.json'),current:actual.processes,toolRevision:gate.toolRevision});
  const natural=readNaturalWorkerCycle(actual.worker,Date.parse(certificate.completedAt),2);need(natural,'natural_cycles_unconfirmed');
  const {commandLine,...daemon}=captureProcessFact(actual.snapshot.daemon.pid);same(commandLine,['PM2 v6.0.14: God Daemon (/root/.pm2)']);
  const persisted=read(directory+'/persistence.json'),afterFile='/var/lib/faolla-online-retention/000066/after.json',afterText=bookingHostRead(afterFile);need(hash(afterText)===certificate.afterSha256&&JSON.parse(afterText).persistenceSha256===hash(bookingHostRead(directory+'/persistence.json')),'persisted_binding');
  need(await verifyCapacityPm2Dump(daemon,boot(),actual.snapshot.filteredRegistry,persisted),'persistence');
  const publicProof=await proveRecoveryTargets({origins:['https://faolla.com','https://launch.faolla.com'],target:P.baseline,operationId:randomUUID(),verify:check,deadlineAtMs:Date.now()+30000});check();same(readOnlineRetentionHistory(),history);
  const proof={kind:'booking-registry-recovery-completed',revision,certificateSha256:history.headSha256,workerPid:actual.worker.pid,workerRestarts:actual.worker.pm2_env.restart_time,naturalCycle:natural,publicProof,originalGateUnchanged:true,websiteUnchanged:true,otherProcessesUnchanged:true,applicationRebuilt:false,mailEnabled:false,completionMode:'independent-audit-no-restart',at:new Date().toISOString()};
  if(action==='finish'){
   if(fs.existsSync(directory+'/completed.json')){const completed=read(directory+'/completed.json');need(completed.kind===proof.kind&&completed.revision===revision&&completed.certificateSha256===history.headSha256&&completed.workerPid===actual.worker.pid&&completed.workerRestarts===actual.worker.pm2_env.restart_time,'completion_changed');}
   else seal(directory,'completed.json',proof);
  }
  return{...proof,completionReceiptPresent:fs.existsSync(directory+'/completed.json'),readOnly:action==='audit'};
 }));
 return action==='finish'?withOnlineRetentionLocks(observe):observe();
}
function processPeer(pid){const p=captureProcessFact(pid),s=fs.statSync('/proc/'+pid+'/exe',{bigint:true});return{pid,uid:p.uid,startTicks:p.startTicks,bootId:boot(),executable:p.executable,executableIdentity:['dev','ino','size','mtimeNs','ctimeNs','nlink','uid','mode'].map(k=>String(s[k])).join(':')};}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const action=process.argv[2];Promise.resolve().then(()=>{need(['inspect','publish','audit','finish'].includes(action),'action');return action==='inspect'?inspectRegistryRecovery():action==='publish'?publishRegistryRecovery():auditRegistryRecovery(action);}).then(v=>console.log(JSON.stringify(v)),e=>{console.error(JSON.stringify(registryRecoveryFailureReport(e,diagnosticFacts.get(e)??{action})));process.exitCode=1;});
}
