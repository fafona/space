// Closed CI-only resources: generate a genuine completed save with a failed
// postcondition, then exercise the observational sequence under real flock.
// No production path/PID is accepted and no receipt is a lock capability.
import * as fs from 'node:fs';import {isDeepStrictEqual} from 'node:util';
import {createOwnedPostSaveCases,ownedActiveReconciliationScope,observeOwnedActiveReconciliation,assertOwnedActiveReconciliationDelta,createOwnedPostSaveBackup,sealOwnedLab} from './release-toolchain-active-generation-owned-lab.mjs';
import {runOwnedActiveReconciliationCase} from './release-toolchain-active-generation-reconciliation.mjs';
import {withOwnedActiveReconciliationLocks,ownedActiveReconciliationHeldChecker,archiveOwnedPostSaveOperation,releaseOwnedPostSaveOperation,assertOnlineRetentionHeldLocks} from './online-release-retention-writer.mjs';
import {executePostSaveContinuation} from './release-toolchain-post-save-contract.mjs';
import {assertSameLongLivedDaemon} from './release-toolchain-daemon-identity.mjs';
import {inspectPm2Registry,verifyPm2Dump,pm2RegistryDigest} from './production-maintenance-pm2-adapter.mjs';
import {captureProcessFact} from './check-production-runtime-supervision.mjs';
import {stopOwnedIsolation} from './release-toolchain-isolation.mjs';
import {bookingHostRead,bookingHostSync} from './booking-handoff-host-io.mjs';
import {sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
import {stageFailureDiagnostic} from './release-toolchain-diagnostics.mjs';
const scopes=new WeakMap(),same=(a,b)=>need(isDeepStrictEqual(a,b),'owned_post_save_changed'),hash=file=>sha256(bookingHostRead(file,{binary:true})),read=file=>JSON.parse(bookingHostRead(file));
const fact=file=>{const s=fs.lstatSync(file);return{dev:s.dev,ino:s.ino,uid:s.uid,mode:s.mode,nlink:s.nlink,size:s.size,mtimeMs:s.mtimeMs,ctimeMs:s.ctimeMs};};
const inventory=s=>Object.fromEntries(fs.readdirSync(s.directory+'/vault').sort().map(name=>[name,{...fact(s.directory+'/vault/'+name),sha256:hash(s.directory+'/vault/'+name)}]));
async function savedReadback(s){
 const directory=s.directory+'/vault',saved=read(directory+'/pm2-persistence-completed.json'),attempt=read(directory+'/pm2-persistence-attempt.json');
 need(saved.kind==='active-incident-current-pm2-persistence-completed'&&saved.receipt.saved===true&&saved.receipt.peerVerified===true&&saved.receipt.processCount===3&&saved.publicationAuthority===false&&saved.processControlPerformed===false,'evidence_invalid');same(saved.binding,attempt.binding);same(saved.registrySha256,attempt.registrySha256);same(saved.metadataReceiptSha256,hash(directory+'/metadata-corrected.json'));
 const {commandLine,...daemon}=captureProcessFact(s.daemon.fact.pid),boot=fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();assertSameLongLivedDaemon(daemon,attempt.daemon);same(commandLine,s.daemon.commandLine);same(boot,attempt.bootId);const registry=await inspectPm2Registry(daemon,boot);same(pm2RegistryDigest(registry),saved.registrySha256);need(await verifyPm2Dump(daemon,boot,registry,saved.receipt)===true,'operation_unconfirmed');
 same(bookingHostRead(s.directory+'/active.json'),s.afterText);need(read(s.directory+'/failed.json').stage==='verifyPostconditions'&&!fs.existsSync(directory+'/closure-sealed.json')&&!fs.existsSync(directory+'/operation-archived.json'),'attempt_unknown');return{savedReceiptSha256:hash(directory+'/pm2-persistence-completed.json'),registrySha256:saved.registrySha256,savePerformed:false};
}
export async function verifyOwnedPostSaveClosure(capability,lock){
 const s=ownedActiveReconciliationScope(capability),state=scopes.get(lock);need(state?.capability===capability,'owned_lab_capability_required');state.held();same(inventory(s),state.prior);same(fact(s.directory+'/active.json'),state.metadataFact);same(hash(s.directory+'/active.json'),state.metadataSha256);await savedReadback(s);assertOwnedActiveReconciliationDelta(state.before,await observeOwnedActiveReconciliation(capability));
 const sealed=read(state.directory+'/closure-sealed.json');same(sealed,{kind:'owned-post-save-closure-sealed',window:state.window,prior:state.prior,readbackSha256:hash(state.directory+'/readback.json'),backupSha256:hash(s.directory+'/post-save-backup-verified.json'),metadataWrittenByContinuation:false,processSavePerformedByContinuation:false,publicationAuthority:false});state.held();return{directory:state.directory,sha256:hash(state.directory+'/closure-sealed.json')};
}
async function continueOwned(capability){
 const s=ownedActiveReconciliationScope(capability);need(['post-save','post-save-incomplete'].includes(s.name)&&!fs.existsSync(s.directory+'/post-save-vault'),'attempt_unknown');await savedReadback(s);
 return withOwnedActiveReconciliationLocks(capability,async(lock,{window})=>{
  const held=ownedActiveReconciliationHeldChecker(capability,lock),state={capability,held,window,directory:s.directory+'/post-save-vault',prior:inventory(s),metadataFact:fact(s.directory+'/active.json'),metadataSha256:hash(s.directory+'/active.json')};scopes.set(lock,state);let closure;
  try{const result=await executePostSaveContinuation({assertHeld:held,
   inspect:async()=>{state.before=await observeOwnedActiveReconciliation(capability);await savedReadback(s);let rejected=false;try{assertOnlineRetentionHeldLocks(lock);}catch{rejected=true;}need(rejected,'invalid_contract');},
   sourceAndCi:()=>ownedActiveReconciliationScope(capability),freshBackup:()=>createOwnedPostSaveBackup(capability),freshCompatibility:async()=>assertOwnedActiveReconciliationDelta(state.before,await observeOwnedActiveReconciliation(capability)),claim:()=>need(!fs.existsSync(state.directory),'attempt_replay_forbidden'),
   preserve:()=>{fs.mkdirSync(state.directory,{mode:0o700});bookingHostSync(s.directory);sealOwnedLab(state.directory+'/prior-manifest.json',{prior:state.prior,metadataFact:state.metadataFact,metadataSha256:state.metadataSha256});},
   observeCompletedMetadata:()=>{same(fact(s.directory+'/active.json'),state.metadataFact);same(hash(s.directory+'/active.json'),state.metadataSha256);},
   observeCompletedPersistence:async()=>sealOwnedLab(state.directory+'/readback.json',await savedReadback(s)),verifyPostconditions:async()=>{same(inventory(s),state.prior);assertOwnedActiveReconciliationDelta(state.before,await observeOwnedActiveReconciliation(capability));},
   sealClosure:()=>sealOwnedLab(state.directory+'/closure-sealed.json',{kind:'owned-post-save-closure-sealed',window,prior:state.prior,readbackSha256:hash(state.directory+'/readback.json'),backupSha256:hash(s.directory+'/post-save-backup-verified.json'),metadataWrittenByContinuation:false,processSavePerformedByContinuation:false,publicationAuthority:false}),
   archiveOldOperation:async()=>{closure=await verifyOwnedPostSaveClosure(capability,lock);await archiveOwnedPostSaveOperation(capability,lock);},
   complete:()=>{const value={kind:'owned-post-save-reconciliation-completed',closureSha256:closure.sha256,archiveSha256:hash(state.directory+'/operation-archived.json'),publicationAuthority:false};sealOwnedLab(state.directory+'/reconciliation-completed.json',value);return value;},
   failure:(_error,stage)=>sealOwnedLab(s.directory+'/post-save-failed.json',{stage,automaticRetryAllowed:false,publicationAuthority:false}),
  });await releaseOwnedPostSaveOperation(capability,lock);same(inventory(s),state.prior);same(fact(s.directory+'/active.json'),state.metadataFact);return result;}finally{scopes.delete(lock);}
 });
}
export async function acceptOwnedPostSaveContinuation(pm2Root){
 const resources=await createOwnedPostSaveCases(pm2Root),cases=[];let passed=false;
 try{for(const capability of resources.cases){const s=ownedActiveReconciliationScope(capability),old=fact(s.directory+'/operation.lock');let cause;try{await runOwnedActiveReconciliationCase(capability);}catch(error){cause=error;}need(cause?.message===(s.name==='post-save'?'owned_lab_post_save_postconditions_unknown':'owned_lab_post_save_incomplete_unknown'),'operation_unconfirmed');
  if(s.name==='post-save'){
   const prior=inventory(s);await continueOwned(capability);same(inventory(s),prior);need(!fs.existsSync(s.directory+'/operation.lock')&&fs.lstatSync(s.directory+'/post-save-vault/operation.lock').ino===old.ino&&fs.existsSync(s.directory+'/post-save-vault/replacement-released.json'),'cleanup_unconfirmed');let rejected=false;try{await continueOwned(capability);}catch{rejected=true;}need(rejected,'attempt_replay_forbidden');cases.push('completed-save-adopted-without-rewrite-resave-or-restart');
  }else{need(!fs.existsSync(s.directory+'/vault/pm2-persistence-completed.json'),'evidence_invalid');const prior=inventory(s);let rejected=false;try{await continueOwned(capability);}catch{rejected=true;}need(rejected&&!fs.existsSync(s.directory+'/post-save-vault'),'attempt_unknown');same(inventory(s),prior);same(fact(s.directory+'/operation.lock'),old);cases.push('save-without-durable-completion-refused-and-evidence-retained');}
 }passed=true;}catch(error){sealOwnedLab(resources.root+'/post-save-failure.json',{diagnostic:stageFailureDiagnostic(error,{stage:'rehearsal',toolRevision:resources.tool.revision,knownFiles:['release-toolchain-post-save-native.mjs','release-toolchain-post-save-contract.mjs','release-toolchain-active-generation-reconciliation.mjs','online-release-retention-writer.mjs']}),completedCases:cases,publicationAuthority:false});throw error;}finally{stopOwnedIsolation(resources.isolation);sealOwnedLab(resources.root+'/cleanup-verified.json',{ownedDatabaseStopped:true,privatePm2RetainedForOuterOwnerCleanup:true,filesRetained:true,passed,formalHostTouched:false,publicationAuthority:false});}
 const report={kind:'owned-post-save-continuation-native-acceptance',root:resources.root,cases,realKernelFlock:true,realActivePostgres:true,actualNextAndPm2:true,sameObservationalSequence:true,originalInodeArchived:true,oldFailedEvidenceRetained:true,metadataWrittenByContinuation:false,processSavePerformedByContinuation:false,formalHostTouched:false,publicationAuthority:false,mailEnabled:false};sealOwnedLab(resources.root+'/post-save-acceptance.json',report);return report;
}
