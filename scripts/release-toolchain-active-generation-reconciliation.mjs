// Closed real-IO reconciliation acceptance. It deliberately does NOT expose a
// formal reconciliation or publication CLI before the whole active path has
// qualified. The original inactive path and formal operation remain untouched.
import * as fs from 'node:fs';import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {executeActiveBookingReconciliation} from './release-toolchain-active-generation-contract.mjs';
import {createOwnedActiveReconciliationCases,ownedActiveReconciliationScope,observeOwnedActiveReconciliation,assertOwnedActiveReconciliationDelta,createOwnedActiveReconciliationBackup,ownedActiveReconciliationBoundary,sealOwnedLab} from './release-toolchain-active-generation-owned-lab.mjs';
import {withOwnedActiveReconciliationLocks,ownedActiveReconciliationHeldChecker,archiveOwnedActiveReconciliationOperation,releaseOwnedActiveReconciliationOperation,assertOnlineRetentionHeldLocks} from './online-release-retention-writer.mjs';
import {preserveOwnedActiveReconciliationEvidence} from './release-toolchain-active-generation-preservation.mjs';
import {correctOwnedActiveReconciliationMetadata} from './release-toolchain-active-generation-metadata.mjs';
import {persistOwnedActiveReconciliationProcesses,verifyOwnedActiveReconciliationPersistence} from './release-toolchain-active-generation-persistence.mjs';
import {collectOwnedCiPm2Registry} from './release-toolchain-pm2-observation.mjs';
import {inspectPm2Registry,capturePm2DumpTarget,persistPm2Dump,verifyPm2Dump,pm2RegistryDigest} from './production-maintenance-pm2-adapter.mjs';
import {captureProcessFact} from './check-production-runtime-supervision.mjs';
import {inspectPinnedExecutionSource} from './release-toolchain-source.mjs';
import {stopOwnedIsolation} from './release-toolchain-isolation.mjs';
import {bookingHostRead} from './booking-handoff-host-io.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
import {stageFailureDiagnostic} from './release-toolchain-diagnostics.mjs';
const FILE=fileURLToPath(import.meta.url),SOURCE=path.dirname(path.dirname(FILE));
const CHILD=SOURCE+'/scripts/release-toolchain-active-generation-reconciliation-case.mjs';
const same=(a,b)=>need(isDeepStrictEqual(a,b),'observation_mismatch');
const read=file=>{const text=bookingHostRead(file),value=JSON.parse(text);same(text,canonicalJson(value)+'\n');return value;};
const digest=file=>sha256(bookingHostRead(file,{binary:true}));
const dirIdentity=file=>Object.fromEntries(['dev','ino','uid','mode'].map(k=>[k,fs.lstatSync(file)[k]]));
const CLOSURE_FILES=Object.freeze(['intent.json','preserved.json','current-observation.json','metadata-before-observation.json','metadata-correction-intent.json','metadata-after-observation.json','metadata-corrected.json','pm2-persistence-before-observation.json','pm2-persistence-after-observation.json','pm2-persistence-attempt.json','pm2-persistence-completed.json','pm2-dump-before.json','pm2-backup-before.json']);
const diagnostic=error=>stageFailureDiagnostic(error,{stage:'rehearsal',toolRevision:path.basename(SOURCE),knownFiles:['release-toolchain-active-generation-reconciliation.mjs','release-toolchain-active-generation-owned-lab.mjs','release-toolchain-active-generation-preservation.mjs','release-toolchain-active-generation-metadata.mjs','release-toolchain-active-generation-persistence.mjs','online-release-retention-writer.mjs','release-toolchain-contracts.mjs']});
function closureFiles(s){return Object.fromEntries([...CLOSURE_FILES,...s.pins.map(v=>v[0])].map(name=>[name,digest(s.directory+'/vault/'+name)]));}
export async function verifyOwnedActiveReconciliationClosure(capability,lock){
 const s=ownedActiveReconciliationScope(capability),held=ownedActiveReconciliationHeldChecker(capability,lock);held();
 const directory=s.directory+'/vault',controller=read(s.directory+'/controller.json'),closure=read(directory+'/closure-sealed.json');
 need(!['metadata-correction-failed.json','pm2-persistence-failed.json'].some(name=>fs.existsSync(directory+'/'+name))&&!fs.existsSync(s.directory+'/failed.json'),'operation_unconfirmed');
 same(closure,{kind:'owned-active-reconciliation-closure-sealed',window:controller.window,toolRevision:s.toolRevision,inventorySha256:s.inventorySha256,files:closureFiles(s),backupSha256:digest(s.directory+'/backup-verified.json'),postconditionsSha256:digest(s.directory+'/postconditions.json'),formalIncidentClosed:false,publicationAuthority:false,completedAt:closure.completedAt});
 const now=Date.now();need(Date.parse(closure.completedAt)>=Date.parse(controller.window.startedAt)&&Date.parse(closure.completedAt)<=now&&now<Date.parse(controller.window.deadlineAt),'evidence_stale');
 same(bookingHostRead(s.directory+'/active.json'),s.afterText);
 for(const [name,bytes,hash]of s.pins){const original=bookingHostRead(s.directory+'/old-evidence/'+name,{binary:true}),copy=bookingHostRead(directory+'/'+name,{binary:true});need(original.length===bytes&&sha256(original)===hash&&copy.equals(original),'evidence_invalid');}
 const before=read(directory+'/metadata-before-observation.json'),after=read(directory+'/metadata-after-observation.json');assertOwnedActiveReconciliationDelta(before,after,{metadata:true});
 const persisted=read(directory+'/pm2-persistence-completed.json'),persistenceBefore=read(directory+'/pm2-persistence-before-observation.json'),persistenceAfter=read(directory+'/pm2-persistence-after-observation.json');
 assertOwnedActiveReconciliationDelta(after,persistenceBefore);assertOwnedActiveReconciliationDelta(persistenceBefore,persistenceAfter);
 need(persisted.kind==='active-incident-current-pm2-persistence-completed'&&persisted.receipt.saved===true&&persisted.publicationAuthority===false&&persisted.beforeObservationSha256===sha256(canonicalJson(persistenceBefore))&&persisted.afterObservationSha256===sha256(canonicalJson(persistenceAfter)),'evidence_invalid');
 const {commandLine,...daemon}=captureProcessFact(s.daemon.fact.pid),boot=fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();same(commandLine,s.daemon.commandLine);
 const registry=await inspectPm2Registry(daemon,boot);need(pm2RegistryDigest(registry)===persisted.registrySha256&&await verifyPm2Dump(daemon,boot,registry,persisted.receipt)===true,'operation_unconfirmed');
 assertOwnedActiveReconciliationDelta(persistenceAfter,await observeOwnedActiveReconciliation(capability));await verifyOwnedActiveReconciliationPersistence(capability,lock);held();return{directory,sha256:digest(directory+'/closure-sealed.json')};
}
export async function runOwnedActiveReconciliationCase(capability){
 const s=ownedActiveReconciliationScope(capability);need(!fs.existsSync(s.directory+'/controller.json'),'attempt_replay_forbidden');
 return withOwnedActiveReconciliationLocks(capability,async(lock,{window})=>{
  const held=ownedActiveReconciliationHeldChecker(capability,lock);let productionTokenRejected=false;try{assertOnlineRetentionHeldLocks(lock);}catch{productionTokenRejected=true;}need(productionTokenRejected,'invalid_contract');
  sealOwnedLab(s.directory+'/controller.json',{kind:'owned-active-reconciliation-controller',window,process:captureProcessFact(process.pid),originalOperation:dirIdentity(s.directory+'/operation.lock'),productionTokenRejected,publicationAuthority:false});
  let before,backup,postconditions,closure;const vault=s.directory+'/vault';
  const result=await executeActiveBookingReconciliation({assertHeld:held,
   progress:stage=>sealOwnedLab(s.directory+'/'+stage+'.started.json',{stage,at:new Date().toISOString(),publicationAuthority:false}),
   inspect:async()=>{before=await observeOwnedActiveReconciliation(capability);same(before.activeText,s.beforeText);},
   sourceAndCi:()=>{const actual=inspectPinnedExecutionSource({revision:s.toolRevision,directory:SOURCE});same(actual.inventorySha256,s.inventorySha256);sealOwnedLab(s.directory+'/source-verified.json',{toolRevision:s.toolRevision,inventorySha256:actual.inventorySha256,insideRequiredCiAcceptance:true,wholeCiNotAssertedByThisReport:true,publicationAuthority:false});},
   freshBackup:()=>{backup=createOwnedActiveReconciliationBackup(capability);},
   freshCompatibility:async()=>{assertOwnedActiveReconciliationDelta(before,await observeOwnedActiveReconciliation(capability));need(backup.activeRowsPreserved&&backup.corruptArchiveRefused,'evidence_invalid');sealOwnedLab(s.directory+'/compatibility-verified.json',{kind:'owned-active-compatible-read-preserved',databaseGeneration:before.database.generation,protocol:2,alreadyActive:true,activationReplayed:false,legacyRestarted:false,publicationAuthority:false});},
   begin:()=>sealOwnedLab(s.directory+'/reconciliation-attempt.json',{window,toolRevision:s.toolRevision,backupSha256:digest(s.directory+'/backup-verified.json'),publicationAuthority:false}),
   preserveFailureEvidence:()=>preserveOwnedActiveReconciliationEvidence(capability,lock,window),
   reconcileMetadata:async()=>{await correctOwnedActiveReconciliationMetadata(capability,lock,window);ownedActiveReconciliationBoundary(capability,'after-metadata');},
   persistProcesses:()=>persistOwnedActiveReconciliationProcesses(capability,lock,window),
   verifyPostconditions:async()=>{postconditions=await observeOwnedActiveReconciliation(capability);assertOwnedActiveReconciliationDelta(before,postconditions,{metadata:true});sealOwnedLab(s.directory+'/postconditions.json',postconditions);},
   sealClosure:()=>{sealOwnedLab(vault+'/closure-sealed.json',{kind:'owned-active-reconciliation-closure-sealed',window,toolRevision:s.toolRevision,inventorySha256:s.inventorySha256,files:closureFiles(s),backupSha256:digest(s.directory+'/backup-verified.json'),postconditionsSha256:digest(s.directory+'/postconditions.json'),formalIncidentClosed:false,publicationAuthority:false,completedAt:new Date().toISOString()});},
   archiveOldOperation:async()=>{closure=await verifyOwnedActiveReconciliationClosure(capability,lock);await archiveOwnedActiveReconciliationOperation(capability,lock);ownedActiveReconciliationBoundary(capability,'after-archive');},
   complete:()=>{const value={kind:'owned-active-reconciliation-completed',window,closureSha256:closure.sha256,archiveSha256:digest(vault+'/operation-archived.json'),oldEvidenceRetained:true,formalIncidentClosed:false,publicationAuthority:false,completedAt:new Date().toISOString()};sealOwnedLab(vault+'/reconciliation-completed.json',value);return value;},
   failure:(error,stage)=>{held();sealOwnedLab(s.directory+'/failed.json',{kind:'owned-active-reconciliation-unconfirmed',stage,diagnostic:diagnostic(error),automaticRetryAllowed:false,publicationAuthority:false,at:new Date().toISOString()});},
  });
  await releaseOwnedActiveReconciliationOperation(capability,lock);return result;
 });
}
async function childCase(s){
 const child=spawn('/usr/bin/node',[CHILD,s.directory],{cwd:'/',stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',LC_ALL:'C.UTF-8',GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',FAOLLA_RELEASE_PRODUCTION_EQ:'1'},windowsHide:true});
 let bytes=0;for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{bytes+=chunk.length;});
 let timer;try{return await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal,diagnosticBytes:bytes}));timer=setTimeout(()=>{try{const fact=captureProcessFact(child.pid);need(fact.commandLine[0]==='/usr/bin/node'&&fact.commandLine.includes(CHILD)&&fact.commandLine.includes(s.directory),'owned_resource_changed');process.kill(child.pid,'SIGKILL');}catch(error){reject(error);}reject(Error('owned_lab_child_deadline'));},180000);});}finally{clearTimeout(timer);}
}
export async function acceptOwnedActiveReconciliation(pm2Root){
 const resources=await createOwnedActiveReconciliationCases(pm2Root),results=[];let passed=false;
 try{
  // Prior native test made the first dump; explicitly save the same current
  // private registry once more so BOTH prior dump files exist for preservation.
  const first=ownedActiveReconciliationScope(resources.cases[0]),physical=collectOwnedCiPm2Registry(first.pm2Root),{commandLine,...daemon}=captureProcessFact(physical.daemon.pid),boot=fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();same(commandLine,first.daemon.commandLine);
  const registry=await inspectPm2Registry(daemon,boot),target=await capturePm2DumpTarget(daemon,boot),setup=await persistPm2Dump(daemon,boot,registry,target);need(await verifyPm2Dump(daemon,boot,registry,setup)===true,'operation_unconfirmed');sealOwnedLab(resources.root+'/private-fixture-dump-initialized.json',{setup,fixtureOnly:true,publicationAuthority:false});
  for(const capability of resources.cases){
   const s=ownedActiveReconciliationScope(capability),initial=await observeOwnedActiveReconciliation(capability),old=dirIdentity(s.directory+'/operation.lock');let outcome;
   if(s.name.startsWith('controller-death-')){outcome=await childCase(s);sealOwnedLab(s.directory+'/child-outcome.json',{kind:'owned-active-controller-exit-observed',...outcome,publicationAuthority:false});need(outcome.code===null&&outcome.signal==='SIGKILL'&&outcome.diagnosticBytes<=65536,'operation_unconfirmed');const controller=read(s.directory+'/controller.json');let gone=false;try{captureProcessFact(controller.process.pid);}catch(error){if(['ENOENT','ESRCH'].includes(error.code))gone=true;else throw error;}need(gone,'owned_resource_changed');}
   else{try{outcome=await runOwnedActiveReconciliationCase(capability);need(s.name==='normal','operation_unconfirmed');}catch(error){if(s.name==='normal'||error.message!=='owned_lab_'+s.name.replaceAll('-','_')+'_unknown')throw error;outcome={unknown:true,automaticRetry:false};}}
   const after=await observeOwnedActiveReconciliation(capability);assertOwnedActiveReconciliationDelta(initial,after,{metadata:true});
   const vault=s.directory+'/vault',archived=s.name==='normal'||s.name.endsWith('after-archive'),normal=s.name==='normal';
   same(dirIdentity(archived?vault+'/operation.lock':s.directory+'/operation.lock'),old);
   need(fs.existsSync(vault+'/reconciliation-completed.json')===normal&&fs.existsSync(vault+'/replacement-released.json')===normal,'evidence_invalid');
   need(fs.existsSync(s.directory+'/operation.lock')===!normal,'evidence_invalid');
   need(fs.existsSync(vault+'/pm2-persistence-attempt.json')!==s.name.endsWith('after-metadata'),'evidence_invalid');
   if(s.name.endsWith('after-save'))need(!fs.existsSync(vault+'/pm2-persistence-completed.json')&&!fs.existsSync(vault+'/closure-sealed.json'),'evidence_invalid');
   const probe=spawnSync('flock',['--nonblock',s.directory+'/deploy.lock','true'],{timeout:10000,env:{PATH:'/usr/bin:/bin'}});need(probe.status===0&&!probe.error&&!probe.signal,'cleanup_unconfirmed');
   let replayRefused=false;try{await runOwnedActiveReconciliationCase(capability);}catch{replayRefused=true;}need(replayRefused,'attempt_replay_forbidden');
   const report={kind:'owned-active-reconciliation-case-verified',name:s.name,actualOutcome:outcome,realKernelFlock:true,actualNextProcess:true,persistenceAttempted:fs.existsSync(vault+'/pm2-persistence-attempt.json'),persistenceCompleted:fs.existsSync(vault+'/pm2-persistence-completed.json'),realActivePostgres:true,dumpRestoreVerified:true,oldInodeRetained:true,originalEvidenceRetained:true,replayRefused,processesUnchanged:true,formalHostTouched:false,publicationAuthority:false,at:new Date().toISOString()};sealOwnedLab(s.directory+'/acceptance.json',report);results.push(report);
  }
  same(inspectPinnedExecutionSource({revision:resources.tool.revision??path.basename(SOURCE),directory:SOURCE}).inventorySha256,resources.tool.inventorySha256);passed=true;
 }catch(error){sealOwnedLab(resources.root+'/failure.json',{kind:'owned-active-reconciliation-acceptance-failed',diagnostic:diagnostic(error),completedCases:results.map(r=>r.name),publicationAuthority:false,at:new Date().toISOString()});throw error;}
 finally{stopOwnedIsolation(resources.isolation);sealOwnedLab(resources.root+'/cleanup-verified.json',{ownedDatabaseStopped:true,privatePm2RetainedForOuterOwnerCleanup:true,filesRetained:true,passed,formalHostTouched:false,publicationAuthority:false,at:new Date().toISOString()});}
 const report={kind:'owned-active-reconciliation-native-acceptance',root:resources.root,toolRevision:path.basename(SOURCE),inventorySha256:resources.tool.inventorySha256,cases:results.map(r=>r.name),samePhysicalMetadataVaultPersistenceAndArchiveEngines:true,controllerDeathsObserved:true,formalIncidentClosed:false,formalPublicationAccepted:false,publicationAuthority:false,mailEnabled:false,at:new Date().toISOString()};sealOwnedLab(resources.root+'/acceptance.json',report);return report;
}
