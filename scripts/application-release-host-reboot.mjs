// Fixed, reviewed host-reboot recovery before ordinary publication. No website
// restart/routing change, migration execution, mail activation or legacy replay.
import * as fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {collectRemoteReleaseReview,assertReviewFresh,inspectPinnedExecutionSource,ownedReleasePath,sourceGit,parseSourceTree} from './release-toolchain-source.mjs';
import {APPLICATION_RELEASE_MANIFEST,assertApplicationReleaseManifest,assertRecordedSchemaDatabase} from './application-release-compatibility.mjs';
import {readOnlineRetentionHistory,buildOnlineRetentionReceipt} from './online-release-retention.mjs';
import {retentionCanonicalText,retentionHash,inspectOnlineRetentionWindow} from './online-release-retention-policy.mjs';
import {assertHostRebootPlan,assertHostBootCohort,assertHostRebootOnlyWorkerDelta,latestBookingVerifierCertificate,REBOOT_WORKER_NAME as NAME,rebootHash} from './release-toolchain-host-reboot-contract.mjs';
import {executeHostRebootRecovery} from './release-toolchain-host-reboot-state.mjs';
import {createHostRebootTailJournal} from './release-toolchain-host-reboot-journal.mjs';
import {withPinnedFormalPm2Process} from './release-toolchain-proc-witness.mjs';
import {withRetainedApplicationAttestation} from './release-toolchain-application-attestation.mjs';
import {captureFileContinuity} from './release-toolchain-file-continuity.mjs';
import {collectFormalBookingPm2Registry} from './release-toolchain-pm2-observation.mjs';
import {normalizeResurrectedRetirementProcess as normalizeRetirementProcess,assertResurrectedManagerDefinition} from './release-toolchain-process-observation.mjs';
import {bookingHostRead,bookingHostWriteOnce,bookingHostSync,bookingHostEnvironment} from './booking-handoff-host-io.mjs';
import {bookingWorkerProtectedFilePlan,readNaturalWorkerCycle} from './release-toolchain-worker-release-host.mjs';
import {assertBookingAtomicWorkerEnvironment,assertBookingAtomicWorkerGate} from './booking-atomic-worker.mjs';
import {assertBookingWorkerExecutionRevision} from './release-toolchain-worker-release-contract.mjs';
import {captureProcessFact} from './check-production-runtime-supervision.mjs';
import {bookingLegacyRpcExpected} from './booking-handoff-legacy.mjs';
import {bookingReadyWorkerConfiguration,assertBookingReadyWorkerRawTransition} from './booking-ready-worker.mjs';
import {verifyWorkerEntryCiArtifact} from './release-toolchain-worker-release-ci.mjs';
import {captureTrustedPython,verifyTrustedPython} from './production-maintenance-trusted-python.mjs';
import {captureResurrectedPm2DumpTarget as capturePm2DumpTarget,persistResurrectedPm2Dump as persistPm2Dump,verifyResurrectedPm2Dump as verifyPm2Dump,inspectResurrectedPm2Registry as inspectPm2Registry} from './release-toolchain-resurrection-pm2-adapter.mjs';
import {assertCompletePm2DumpSet,stablePm2RegistryRow} from './release-toolchain-pm2-transition.mjs';
import {proveRecoveryTargets} from './release-toolchain-recovery-probe.mjs';
const ROOT='/var/lib/faolla-host-reboots',RETENTION='/var/lib/faolla-online-retention',RELEASE='/var/lib/faolla-online-release',DEPLOY='/www/wwwroot/merchant-space.deploy.lock';
const C='f274ad615550c83717aa7af2ad32339608e6f8aa',GATE='/var/lib/faolla-booking-handoff/'+C+'/worker-enabled.json';
const source=path.dirname(path.dirname(fileURLToPath(import.meta.url))),revision=path.basename(source);
const need=(v,c)=>{if(!v)throw Error('host_reboot_'+c);},same=(a,b,c='changed')=>need(isDeepStrictEqual(a,b),c);
const digest=v=>createHash('sha256').update(v).digest('hex'),read=p=>JSON.parse(bookingHostRead(p));
const seal=(d,n,v)=>bookingHostWriteOnce(d+'/'+n,retentionCanonicalText(v));
const pause=ms=>new Promise(r=>setTimeout(r,ms)),boot=()=>fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
const exists=p=>{try{fs.lstatSync(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
function identity(pid){const p='/proc/'+pid,s=fs.readFileSync(p+'/stat','utf8'),f=s.slice(s.lastIndexOf(')')+2).trim().split(/\s+/);need(fs.lstatSync(p).uid===0&&f[0]!=='Z','process');return{pid,uid:0,startTicks:f[19],parentPid:Number(f[1]),cwd:fs.realpathSync(p+'/cwd'),executable:fs.realpathSync(p+'/exe'),commandSha256:digest(fs.readFileSync(p+'/cmdline')),environmentSha256:digest(fs.readFileSync(p+'/environ'))};}
function rawEnv(pid){const v={};for(const row of fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').filter(Boolean)){const i=row.indexOf('=');need(i>0&&!Object.hasOwn(v,row.slice(0,i)),'environment');v[row.slice(0,i)]=row.slice(i+1);}return v;}
function peer(pid){const f=identity(pid),s=fs.statSync('/proc/'+pid+'/exe',{bigint:true});return{pid,uid:0,startTicks:f.startTicks,bootId:boot(),executable:f.executable,executableIdentity:['dev','ino','size','mtimeNs','ctimeNs','nlink','uid','mode'].map(k=>String(s[k])).join(':')};}
function physical(){
 const snapshot=collectFormalBookingPm2Registry(),worker=snapshot.rows.find(p=>p.name===NAME);need(worker?.pid>0&&worker.pm2_env.status==='online','worker');
 const environment=rawEnv(worker.pid);assertBookingAtomicWorkerEnvironment(worker.pm2_env.env);assertBookingAtomicWorkerEnvironment(environment);
 return{snapshot,worker,processes:snapshot.rows.map(normalizeRetirementProcess).sort((a,b)=>a.pmId-b.pmId),identities:snapshot.rows.filter(p=>p.pid>0).map(p=>({name:p.name,...identity(p.pid)})),workerIdentity:{name:NAME,...identity(worker.pid)},raw:environment,configured:bookingReadyWorkerConfiguration(worker.pm2_env)};
}
function oldBootEvidence(history){
 const cert=latestBookingVerifierCertificate(history);need(cert,'prior_verifier');
 const dir=cert.kind==='host-reboot'?ROOT+'/'+cert.hostReboot.bootId:'/var/lib/faolla-booking-worker-releases/'+cert.toolRevision;
 const bytes=bookingHostRead(dir+'/persistence-completed.json');
 const after=read(RETENTION+'/'+String(cert.sequence).padStart(6,'0')+'/after.json');need(digest(bytes)===after.persistenceSha256,'old_boot_receipt');
 const receipt=JSON.parse(bytes);need(receipt.bootId&&receipt.receipt?.saved===true&&receipt.receipt.peerVerified===true&&receipt.receipt.pm2Version==='6.0.14','old_boot_receipt');
 return{bootId:receipt.bootId,sha256:digest(bytes)};
}
function environmentProofs(history,actual,dump){
 const prior=history.entries.at(-1);need(dump.length===prior.processes.length&&new Set(dump.map(p=>p.name)).size===dump.length,'dump_cohort');
 return prior.processes.map(old=>{
  const saved=dump.find(e=>e.name===old.name),row=actual.snapshot.rows.find(e=>e.name===old.name);need(saved&&row,'dump_cohort');
  const previous=normalizeRetirementProcess({name:old.name,pm_id:old.pmId,pid:old.pid,pm2_env:saved});same(previous,old,'saved_definition');
  return assertResurrectedManagerDefinition({saved,current:row.pm2_env,before:old,after:normalizeRetirementProcess(row),home:'/root/.pm2'});
 });
}
async function deployLock(work){
 ownedReleasePath(DEPLOY,{privateMode:true});const fd=fs.openSync(DEPLOY,fs.constants.O_RDWR|fs.constants.O_NOFOLLOW);
 try{const st=fs.fstatSync(fd);same([st.dev,st.ino],[fs.lstatSync(DEPLOY).dev,fs.lstatSync(DEPLOY).ino],'lock');const r=spawnSync('flock',['--nonblock','3'],{stdio:['ignore','pipe','pipe',fd],env:bookingHostEnvironment(),timeout:10000});need(r.status===0&&!r.error&&!r.signal,'lock_busy');
  need(!exists('/var/lib/faolla-maintenance/merchant-space/operation.lock'),'foreign_operation');return await work(fd);
 }finally{fs.closeSync(fd);}
}
function privateDirectory(p){if(!exists(p)){ownedReleasePath(path.dirname(p),{directory:true});fs.mkdirSync(p,{mode:0o700});bookingHostSync(path.dirname(p));}ownedReleasePath(p,{directory:true,privateMode:true});}
export async function reconcileApplicationHostBoot(){
 need(process.platform==='linux'&&process.getuid?.()===0&&process.execPath==='/usr/bin/node'&&source==='/var/lib/faolla-online-code/'+revision&&/^[a-f0-9]{40}$/.test(revision)&&process.cwd()===source&&process.argv.length===3&&process.argv[1]===source+'/scripts/application-release-host-reboot.mjs'&&process.argv[2]==='reconcile','invocation');
 return withPinnedFormalPm2Process(async verifyDaemon=>{
  const review=await collectRemoteReleaseReview(revision),inventory=inspectPinnedExecutionSource({revision,directory:source});assertReviewFresh(review,revision);
  const manifest=JSON.parse(fs.readFileSync(source+'/'+APPLICATION_RELEASE_MANIFEST,'utf8'));
  assertApplicationReleaseManifest(manifest,{baseline:manifest.baseline,baselineRows:parseSourceTree(sourceGit('/www/wwwroot/merchant-space',['ls-tree','-r','-z',manifest.baseline])),targetRows:inventory.rows});assertRecordedSchemaDatabase(manifest);
  return deployLock(async fd=>{
   verifyDaemon();privateDirectory(ROOT);const directory=ROOT+'/'+boot();
   if(!exists(directory)||exists(directory+'/completed.json')){
    const history=readOnlineRetentionHistory(),actual=physical(),active=read(RELEASE+'/active.json');
    // The normal same-boot path does not mutate or create recovery evidence.
    try{inspectOnlineRetentionWindow({history,actualActive:active,current:actual.processes});return{kind:'host-boot-stable',changed:false};}catch(error){if(!String(error.message).startsWith('online_retention_'))throw error;}
   }
   return withRetainedApplicationAttestation(async()=>{
    privateDirectory(directory);let intent,history,actual,tailJournal,receipt;
    const reference=exists(directory+'/intent.json')?read(directory+'/intent.json').before:readOnlineRetentionHistory().entries.at(-1);
    const anchors=[reference.active,reference.rollback],filePlans=new Map(bookingWorkerProtectedFilePlan().map(p=>[p.file,p])),sourceFiles=[],trees=[];
    for(const a of anchors){
     need(sourceGit(a.directory,['rev-parse','HEAD']).toString().trim()===a.target&&!sourceGit(a.directory,['status','--porcelain=v1','--untracked-files=all']).toString().trim(),'website_source');
     need(bookingHostRead(a.directory+'/.next/BUILD_ID',{privateMode:false}).trim()===a.target,'website_build');
     for(const file of [RELEASE+'/'+a.target+'/state.json',a.directory+'/.env.local'])filePlans.set(file,{file,privateMode:true});
     for(const row of parseSourceTree(sourceGit(a.directory,['ls-tree','-r','-z',a.target])))if(!row.file.startsWith('public/downloads/'))sourceFiles.push(a.directory+'/'+row.file);
     trees.push({root:a.directory+'/node_modules',allowInternalLinks:true},{root:a.directory+'/.next',exclude:['cache','trace']});
    }
    const files=[...filePlans.values()],continuity=captureFileContinuity({files:[...new Set([...files.map(p=>p.file),...sourceFiles])],trees});
    const protectedHash=()=>{const now=physical();return rebootHash({files:Object.fromEntries(files.map(({file,privateMode})=>[file,digest(bookingHostRead(file,{privateMode}))])),otherManagerRows:now.snapshot.rows.filter(p=>p.name!==NAME).map(stablePm2RegistryRow),otherIdentities:now.identities.filter(p=>p.name!==NAME)});};
    const check=()=>{verifyDaemon();continuity.assertUnchanged();assertReviewFresh(review,revision);need(boot()===path.basename(directory),'boot_changed');if(intent)same(protectedHash(),intent.before.hostReboot.protectedHostSha256,'protected_files');};
    const prefix=()=>tailJournal?tailJournal.prefix():readOnlineRetentionHistory();
    const settled=()=>{check();const now=physical();assertHostRebootOnlyWorkerDelta(intent.before.hostReboot,now.processes,revision);if(intent.before.hostReboot.verifierAction==='retain'){same(now.workerIdentity,intent.before.workerIdentity,'retained_verifier_identity');same(now.raw,intent.original.raw,'retained_environment');same(now.configured,intent.original.configured,'retained_configuration');}else assertBookingReadyWorkerRawTransition(intent.original.raw,now.raw,intent.original.configured,now.configured);return now;};
    const result=await executeHostRebootRecovery({
     admit:async()=>{
      if(exists(directory+'/intent.json')){
       intent=read(directory+'/intent.json');need(intent.kind==='reviewed-host-reboot-intent'&&intent.before.toolRevision===revision&&intent.before.hostReboot.bootId===boot(),'intent_scope');
       history=intent.history;assertHostRebootPlan(intent.before,history);
       if(exists(directory+'/certificate-receipt.json')){const saved=read(directory+'/certificate-receipt.json');receipt={certificate:saved.certificate,files:new Map(saved.files)};tailJournal=createHostRebootTailJournal({history,receipt,directory});}
       same(prefix().headSha256,receipt&&prefix().headSha256===retentionHash(receipt.certificate)?retentionHash(receipt.certificate):history.headSha256,'history');check();return intent;
      }
      history=readOnlineRetentionHistory();const prior=history.entries.at(-1),oldBoot=oldBootEvidence(history);need(oldBoot.bootId!==boot()&&read(RELEASE+'/active.json').target===prior.active.target,'boot_not_changed');
      actual=physical();const dumpText=bookingHostRead('/root/.pm2/dump.pm2',{privateMode:false}),dump=JSON.parse(dumpText),proofs=environmentProofs(history,actual,dump);assertHostBootCohort(prior.processes,actual.processes,proofs);
      const oldVerifier=latestBookingVerifierCertificate(history),oldContext=oldVerifier.workerRelease??oldVerifier.hostReboot;
      const oldSource=inspectPinnedExecutionSource({revision:oldVerifier.toolRevision,directory:'/var/lib/faolla-online-code/'+oldVerifier.toolRevision});need(oldSource.inventorySha256===(oldContext.inventorySha256??oldContext.sourceInventorySha256),'old_verifier_source');
      const verifierAction=oldVerifier.toolRevision===revision?'retain':'upgrade';
      const gateText=bookingHostRead(GATE),gate=JSON.parse(gateText);
      let ci;
      if(verifierAction==='retain'&&oldVerifier.kind==='host-reboot'){
       ci=read(ROOT+'/'+oldVerifier.hostReboot.bootId+'/intent.json').ci;
       need(ci?.revision===revision&&rebootHash(ci)===oldVerifier.hostReboot.nativeEvidenceSha256,'retained_native_evidence');
      }else ci=await verifyWorkerEntryCiArtifact({revision,review,file:'/var/lib/faolla-booking-worker-admissions/'+revision+'/ci-evidence.zip',source});
      const native=ci.report.hostReboot;need(native?.kind==='real-pm2-resurrection-contract-verified'&&native.realPm2Version==='6.0.14'&&['realProcessesObserved','actualDumpResurrected','stoppedRegistrationPreserved','wholeEnvironmentVerified','sameKernelBootRefused','kernelRebootNotSimulated','allOwnedProcessesStopped','actualPersistenceAfterResurrection','unmodifiedSharedValidators','managerIdsActuallyReassigned','stoppedPidPathHistorical'].every(k=>native[k]===true)&&native.productionAuthority===false&&native.formalHostTouched===false,'native_reboot_evidence');
      for(const file of ['release-toolchain-host-reboot-native.mjs','release-toolchain-host-reboot-contract.mjs','release-toolchain-host-reboot-pm2.py','release-toolchain-resurrection-pm2.py','release-toolchain-resurrection-pm2-adapter.mjs','release-toolchain-process-observation.mjs'])need(native.sourceHashes?.[file]===digest(fs.readFileSync(source+'/scripts/'+file)),'native_reboot_source');
      const startedAt=new Date().toISOString(),window={id:randomUUID(),startedAt,deadlineAt:new Date(Date.parse(startedAt)+600000).toISOString()};
      const hostReboot={version:1,kind:'verified-host-boot-rebind',verifierAction,previousBootId:oldBoot.bootId,bootId:boot(),priorHistoryHead:history.headSha256,oldDumpSha256:digest(dumpText),oldBootReceiptSha256:oldBoot.sha256,sourceInventorySha256:inventory.inventorySha256,nativeEvidenceSha256:rebootHash(ci),gateSha256:digest(gateText),publicationCertificateSha256:gate.certificateSha256,protectedHostSha256:protectedHash(),environmentProofs:proofs,resurrectedProcesses:actual.processes,identities:actual.identities,daemon:actual.snapshot.daemonPeer,window,mailEnabled:false};
      const before={...Object.fromEntries(['version','policy','legacySha256','rollingHeadSha256','rollingHistorySha256','victim'].map(k=>[k,structuredClone(prior[k])])),kind:'host-reboot',sequence:history.entries.length+1,previousSha256:history.headSha256,toolRevision:revision,active:{...prior.active,process:actual.processes.find(p=>p.name===prior.active.name)},rollback:{...prior.rollback,process:actual.processes.find(p=>p.name===prior.rollback.name)},hostReboot,processes:actual.processes,workerIdentity:actual.workerIdentity,persistenceSha256:null};
      assertHostRebootPlan(before,history);intent={kind:'reviewed-host-reboot-intent',before,history,review,ci,inventorySha256:inventory.inventorySha256,original:{raw:actual.raw,configured:actual.configured},at:startedAt,mailEnabled:false};
      bookingHostWriteOnce(directory+'/dump.pm2.before',dumpText);seal(directory,'intent.json',intent);check();same(physical().processes,actual.processes,'pre_attempt_changed');return intent;
     },
     hasRestartAttempt:()=>intent.before.hostReboot.verifierAction==='retain'||exists(directory+'/worker-attempt.json'),
     recordRestartAttempt:()=>{check();const now=physical();same(now.processes,intent.before.processes,'pre_attempt_changed');const binding={kind:'host-reboot-restart-binding',revision,before:intent.before,intentSha256:digest(bookingHostRead(directory+'/intent.json'))};if(!exists(directory+'/restart-binding.json'))seal(directory,'restart-binding.json',binding);else same(read(directory+'/restart-binding.json'),binding,'restart_binding');const expected=bookingLegacyRpcExpected({...now.worker,pm2_env:{...now.worker.pm2_env,args:now.worker.pm2_env.args??[],node_args:now.worker.pm2_env.node_args??[]}});seal(directory,'worker-attempt.json',{kind:'host-reboot-verifier-restart-attempt',revision,bindingSha256:digest(bookingHostRead(directory+'/restart-binding.json')),window:intent.before.hostReboot.window,controller:captureProcessFact(process.pid),expected,process:peer(now.worker.pid),daemon:now.snapshot.daemonPeer,at:new Date().toISOString()});},
     restartVerifierOnce:()=>{check();const attempt=read(directory+'/worker-attempt.json'),python=captureTrustedPython();verifyTrustedPython(python);const r=spawnSync(python.target.path,['-I','-S','-B',source+'/scripts/release-toolchain-host-reboot-pm2.py'],{input:JSON.stringify({daemon:attempt.daemon,process:attempt.process,expected:attempt.expected,revision,attemptSha256:digest(bookingHostRead(directory+'/worker-attempt.json'))}),encoding:'utf8',timeout:35000,maxBuffer:262144,stdio:['pipe','pipe','pipe',fd],env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'},cwd:source});verifyTrustedPython(python);need(r.status===0&&!r.signal&&!r.error&&r.stderr==='','restart_outcome_unconfirmed');need(JSON.parse(r.stdout).acknowledged===true,'restart_outcome_unconfirmed');seal(directory,'worker-ack.json',JSON.parse(r.stdout));},
     verifySettledVerifier:async()=>{let last;const started=Date.now();while(Date.now()-started<30000){try{const now=settled();if(!exists(directory+'/worker-settled.json'))seal(directory,'worker-settled.json',{processes:now.processes,workerIdentity:now.workerIdentity,at:new Date().toISOString()});else{const saved=read(directory+'/worker-settled.json');same(saved.processes,now.processes,'settlement');same(saved.workerIdentity,now.workerIdentity,'settlement');}return now;}catch(error){last=error;await pause(500);}}throw last;},
     ensurePersistence:async(_intent,now)=>{
      check();const {commandLine,...daemon}=captureProcessFact(now.snapshot.daemonPeer.pid);same(commandLine,['PM2 v6.0.14: God Daemon (/root/.pm2)']);const bootId=boot(),registry=await inspectPm2Registry(daemon,bootId);same(registry,now.snapshot.filteredRegistry,'registry');assertCompletePm2DumpSet(now.snapshot.rows,registry);
      if(exists(directory+'/persistence-completed.json')){const saved=read(directory+'/persistence-completed.json');same(saved.registry,registry,'registry');need(await verifyPm2Dump(daemon,bootId,registry,saved.receipt)===true,'persistence');return saved;}
      const target=await capturePm2DumpTarget(daemon,bootId);if(!exists(directory+'/persistence-attempt.json'))seal(directory,'persistence-attempt.json',{daemon,bootId,registry,target,at:new Date().toISOString()});
      else{const old=read(directory+'/persistence-attempt.json');same(old.daemon,daemon,'daemon');same(old.registry,registry,'registry');}
      // The guarded save adapter compares the full live registry and exact dump
      // target. A resumed save writes the same configuration, not another restart.
      check();const saved=await persistPm2Dump(daemon,bootId,registry,target);need(await verifyPm2Dump(daemon,bootId,registry,saved)===true,'persistence');settled();const proof={kind:'host-reboot-processes-persisted',daemon,bootId,registry,receipt:saved,at:new Date().toISOString(),mailEnabled:false};seal(directory,'persistence-completed.json',proof);return proof;
     },
     ensureCertificate:()=>{
      check();const now=settled();if(!receipt){const after={...structuredClone(intent.before),processes:now.processes,workerIdentity:now.workerIdentity,persistenceSha256:digest(bookingHostRead(directory+'/persistence-completed.json'))};const preparedAt=intent.at;receipt=buildOnlineRetentionReceipt(intent.before,after,{version:2,process:null},history,{preparedAt,completedAt:new Date().toISOString()});seal(directory,'certificate-receipt.json',{certificate:receipt.certificate,files:[...receipt.files]});tailJournal=createHostRebootTailJournal({history,receipt,directory});}
      return tailJournal.commit();
     },
     auditNaturalCyclesAndPublicRoute:async(_intent,committed)=>{
      const gate=read(GATE),deadline=Date.now()+180000;let cycle;
      while(Date.now()<deadline){check();same(readOnlineRetentionHistory(),committed,'history');const now=settled();cycle=readNaturalWorkerCycle(now.worker,Date.parse(receipt.certificate.completedAt),2);if(cycle)break;await pause(1000);}need(cycle,'natural_cycles_pending');
      const publicProof=await proveRecoveryTargets({origins:['https://faolla.com','https://launch.faolla.com'],target:intent.before.active.target,operationId:intent.before.hostReboot.window.id,verify:check,deadlineAtMs:Date.now()+30000});
      const end=settled();assertBookingAtomicWorkerGate({gate,history:committed,actualActive:read(RELEASE+'/active.json'),current:end.processes,toolRevision:gate.toolRevision});assertBookingWorkerExecutionRevision({gate,history:committed,toolRevision:revision});
      const saved=read(directory+'/persistence-completed.json');need(await verifyPm2Dump(saved.daemon,saved.bootId,saved.registry,saved.receipt)===true,'persistence');
      return{kind:'host-reboot-recovery-verified',bootId:boot(),revision,certificateSha256:committed.headSha256,naturalCycle:cycle,publicProof,websiteUnchanged:true,otherProcessesUnchanged:true,originalGateUnchanged:true,mailEnabled:false,at:new Date().toISOString()};
     },
     complete:(_intent,_certificate,proof)=>{if(!exists(directory+'/completed.json'))seal(directory,'completed.json',proof);else need(read(directory+'/completed.json').certificateSha256===proof.certificateSha256,'completion');},
    });return result;
   });
  });
 });
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)reconcileApplicationHostBoot().then(v=>console.log(JSON.stringify(v)),e=>{console.error(JSON.stringify({kind:'host-reboot-recovery-refused',code:/^[a-z_]{1,160}$/.test(e?.message??'')?e.message:'unconfirmed',evidenceRetained:true,automaticRestartReplay:false}));process.exitCode=1;});
