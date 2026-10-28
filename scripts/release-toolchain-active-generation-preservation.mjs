// Durable evidence preservation only, not incident closure or publication.
// Production entry recollects the fixed incident under an opaque held lock.
import * as fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {ACTIVE_BOOKING_INCIDENT as P,assertActiveBookingWindow} from './release-toolchain-active-generation-contract.mjs';
import {ACTIVE_INCIDENT_ROOT,ACTIVE_INCIDENT_FILES,inspectActiveBookingIncident} from './release-toolchain-active-generation-incident.mjs';
import {ownedReleasePath} from './release-toolchain-source.mjs';
import {reviewedBookingExecution} from './release-toolchain-authority.mjs';
import {assertOnlineRetentionHeldLocks} from './online-release-retention-writer.mjs';
import {bookingHostRead,bookingHostWriteOnce,bookingHostSync} from './booking-handoff-host-io.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
const same=(a,b)=>need(isDeepStrictEqual(a,b),'observation_mismatch');
const fact=s=>Object.fromEntries(['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'].map(k=>[k,s[k]]));
const dirFact=s=>Object.fromEntries(['dev','ino','uid','mode'].map(k=>[k,s[k]]));
const seal=(file,value)=>bookingHostWriteOnce(file,canonicalJson(value)+'\n');
function exactText(bytes){const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);need(Buffer.from(text).equals(bytes),'evidence_invalid');return text;}
function privateDir(file){return dirFact(ownedReleasePath(file,{directory:true,privateMode:true}));}
function readPin(file,pin){
 const before=fact(ownedReleasePath(file,{privateMode:true})),bytes=bookingHostRead(file,{binary:true});
 need(bytes.length===pin[1]&&sha256(bytes)===pin[2],'evidence_invalid');same(fact(fs.lstatSync(file)),before);return{bytes,identity:before};
}
function makePrivate(parent,name){privateDir(parent);const location=parent+'/'+name;fs.mkdirSync(location,{mode:0o700});bookingHostSync(parent);privateDir(location);return location;}

// Shared real filesystem engine. Profiles and paths are constructed ONLY by
// the two closed factories below, never accepted from a CLI/serialized plan.
function vault({source,destination,pins,assertHeld,binding}){
 const sourceIdentity=privateDir(source),sourceNames=fs.readdirSync(source).sort(),snapshots=new Map(pins.map(pin=>[pin[0],readPin(source+'/'+pin[0],pin).identity]));
 const expectedNames=['intent.json'];let begun=false,copied=0,finished=false,beginAttempted=false,copyAttempted=false,sealAttempted=false,destinationIdentity,intent;
 const sourceStable=()=>{assertHeld();same(privateDir(source),sourceIdentity);same(fs.readdirSync(source).sort(),sourceNames);for(const pin of pins)same(readPin(source+'/'+pin[0],pin).identity,snapshots.get(pin[0]));};
 const stable=()=>{sourceStable();need(begun&&!finished,'evidence_invalid');same(privateDir(destination),destinationIdentity);same(fs.readdirSync(destination).sort(),[...expectedNames].sort());same(bookingHostRead(destination+'/intent.json'),canonicalJson(intent)+'\n');for(let i=0;i<copied;i++)readPin(destination+'/'+pins[i][0],pins[i]);assertHeld();};
 return{
  destination,
  begin(){
   need(!beginAttempted,'attempt_replay_forbidden');beginAttempted=true;sourceStable();makePrivate(path.dirname(destination),path.basename(destination));destinationIdentity=privateDir(destination);begun=true;
   intent={kind:'active-booking-incident-evidence-preservation-intent',binding,source,sourceIdentity,files:pins.map(pin=>({name:pin[0],bytes:pin[1],sha256:pin[2],identity:snapshots.get(pin[0])})),createdAt:new Date().toISOString(),publicationAuthority:false};
   seal(destination+'/intent.json',intent);stable();return{intentSha256:sha256(bookingHostRead(destination+'/intent.json'))};
  },
  copy(){
   need(!copyAttempted,'attempt_replay_forbidden');copyAttempted=true;stable();
   for(const pin of pins){stable();const actual=readPin(source+'/'+pin[0],pin);same(actual.identity,snapshots.get(pin[0]));bookingHostWriteOnce(destination+'/'+pin[0],exactText(actual.bytes));expectedNames.push(pin[0]);copied++;stable();}
   return{files:copied};
  },
  seal(){
   need(!sealAttempted,'attempt_replay_forbidden');sealAttempted=true;stable();need(copied===pins.length,'evidence_invalid');
   const value={kind:'active-booking-incident-evidence-preserved',binding,source,destination,sourceIdentity,destinationIdentity,intentSha256:sha256(bookingHostRead(destination+'/intent.json')),files:pins.map(pin=>({name:pin[0],bytes:pin[1],sha256:pin[2]})),originalFilesRetained:true,incidentClosed:false,publicationAuthority:false,completedAt:new Date().toISOString()};
   seal(destination+'/preserved.json',value);expectedNames.push('preserved.json');stable();same(bookingHostRead(destination+'/preserved.json'),canonicalJson(value)+'\n');finished=true;assertHeld();return value;
  },
 };
}

export async function preserveActiveBookingIncidentEvidence({lock,toolRevision,window}){
 assertOnlineRetentionHeldLocks(lock);assertActiveBookingWindow(window);const authority=reviewedBookingExecution(toolRevision);need(authority,'source_changed');
 const current=await inspectActiveBookingIncident({window});
 const held=()=>{assertOnlineRetentionHeldLocks(lock);assertActiveBookingWindow(window);need(reviewedBookingExecution(toolRevision)===authority,'source_changed');};
 held();const parent='/var/lib/faolla-booking-active-closures';
 if(!fs.existsSync(parent)){ownedReleasePath('/var/lib',{directory:true});fs.mkdirSync(parent,{mode:0o700});bookingHostSync('/var/lib');}
 privateDir(parent);const incident=parent+'/'+P.operationId;
 if(!fs.existsSync(incident))makePrivate(parent,P.operationId);privateDir(incident);
 const destination=incident+'/'+window.id,binding={oldOperationId:P.operationId,window,toolRevision,toolInventorySha256:authority.tool.inventorySha256,generation:P.generation,currentObservationSha256:sha256(canonicalJson(current))};
 const engine=vault({source:ACTIVE_INCIDENT_ROOT,destination,pins:ACTIVE_INCIDENT_FILES,assertHeld:held,binding});
 engine.begin();engine.copy();const preserved=engine.seal();held();
 seal(destination+'/current-observation.json',current);held();
 return{kind:preserved.kind,directory:destination,preservedSha256:sha256(bookingHostRead(destination+'/preserved.json')),files:preserved.files.length,originalFilesRetained:true,incidentClosed:false,applicationPublished:false,productionDatabaseMutated:false,publicationAuthority:false};
}

export function verifyActiveBookingIncidentPreservation({lock,toolRevision,window}){
 assertOnlineRetentionHeldLocks(lock);assertActiveBookingWindow(window);const authority=reviewedBookingExecution(toolRevision);need(authority,'source_changed');
 const directory='/var/lib/faolla-booking-active-closures/'+P.operationId+'/'+window.id,read=name=>{const text=bookingHostRead(directory+'/'+name),value=JSON.parse(text);same(text,canonicalJson(value)+'\n');return value;};
 const intent=read('intent.json'),preserved=read('preserved.json'),observation=read('current-observation.json'),binding={oldOperationId:P.operationId,window,toolRevision,toolInventorySha256:authority.tool.inventorySha256,generation:P.generation,currentObservationSha256:sha256(canonicalJson(observation))};
 same(intent.binding,binding);same(preserved.binding,binding);
 need(intent.kind==='active-booking-incident-evidence-preservation-intent'&&preserved.kind==='active-booking-incident-evidence-preserved'&&preserved.source===ACTIVE_INCIDENT_ROOT&&intent.source===ACTIVE_INCIDENT_ROOT&&preserved.destination===directory&&preserved.originalFilesRetained===true&&preserved.incidentClosed===false&&preserved.publicationAuthority===false&&intent.publicationAuthority===false&&preserved.intentSha256===sha256(bookingHostRead(directory+'/intent.json')),'evidence_invalid');
 same(privateDir(ACTIVE_INCIDENT_ROOT),intent.sourceIdentity);same(preserved.sourceIdentity,intent.sourceIdentity);same(privateDir(directory),preserved.destinationIdentity);
 same(preserved.files,ACTIVE_INCIDENT_FILES.map(([name,bytes,sha256])=>({name,bytes,sha256})));
 same(intent.files,ACTIVE_INCIDENT_FILES.map(([name,bytes,sha256])=>({name,bytes,sha256,identity:fact(ownedReleasePath(ACTIVE_INCIDENT_ROOT+'/'+name,{privateMode:true}))})));
 need(observation.oldOperationId===P.operationId&&observation.metadataCorrected===false&&observation.actualRoute===P.compatibleRollback&&observation.productionMutated===false&&observation.publicationAuthority===false&&observation.mailEnabled===false,'evidence_invalid');same(observation.window,window);
 for(const pin of ACTIVE_INCIDENT_FILES){const original=readPin(ACTIVE_INCIDENT_ROOT+'/'+pin[0],pin);readPin(directory+'/'+pin[0],pin);same(observation.files[pin[0]],{...original.identity,sha256:pin[2]});}
 for(const value of [intent.createdAt,preserved.completedAt,observation.observedAt]){const ms=Date.parse(value);need(Number.isFinite(ms)&&new Date(ms).toISOString()===value&&ms>=Date.parse(window.startedAt)&&ms<=Date.now()&&ms<Date.parse(window.deadlineAt),'evidence_invalid');}
 assertOnlineRetentionHeldLocks(lock);need(reviewedBookingExecution(toolRevision)===authority,'source_changed');return{directory,preserved,observation,preservedSha256:sha256(bookingHostRead(directory+'/preserved.json'))};
}

// Same real vault engine, with a non-serializable owned-lab resource profile.
export async function preserveOwnedActiveReconciliationEvidence(capability,lock,window){
 const {ownedActiveReconciliationScope,observeOwnedActiveReconciliation}=await import('./release-toolchain-active-generation-owned-lab.mjs');
 const {assertOwnedActiveReconciliationHeldLocks}=await import('./online-release-retention-writer.mjs');
 const s=ownedActiveReconciliationScope(capability),assertHeld=()=>{ownedActiveReconciliationScope(capability);assertOnlineLabHeld();};
 // Kernel checking is synchronous inside the physical engine; the wrapper
 // captures a private checker only after the asynchronous capability gate.
 await assertOwnedActiveReconciliationHeldLocks(capability,lock);
 const {ownedActiveReconciliationHeldChecker}=await import('./online-release-retention-writer.mjs');const assertOnlineLabHeld=ownedActiveReconciliationHeldChecker(capability,lock);
 const current=await observeOwnedActiveReconciliation(capability),binding={kind:'owned-active-reconciliation-preservation',window,toolRevision:s.toolRevision,inventorySha256:s.inventorySha256,currentObservationSha256:sha256(canonicalJson(current)),publicationAuthority:false};
 const engine=vault({source:s.directory+'/old-evidence',destination:s.directory+'/vault',pins:s.pins,assertHeld,binding});engine.begin();engine.copy();const receipt=engine.seal();seal(s.directory+'/vault/current-observation.json',current);assertHeld();return receipt;
}

// Closed disposable runner. Synthetic pins belong only to its own newly
// created files; no production PID, lease, DB identity or old receipt is faked.
export async function acceptActiveIncidentPreservationInCi(){
 need(process.platform==='linux'&&process.getuid?.()===0&&process.env.GITHUB_ACTIONS==='true'&&process.env.RUNNER_ENVIRONMENT==='github-hosted'&&process.env.FAOLLA_RELEASE_PRODUCTION_EQ==='1'&&!['/root/.pm2/pm2.pid','/var/lib/faolla-online-release/active.json','/www/wwwroot/merchant-space.current'].some(f=>fs.existsSync(f)),'ci_only');
 const root=fs.mkdtempSync('/var/lib/faolla-active-vault-ci-');fs.chmodSync(root,0o700);let stage='prepare';
 seal(root+'/started.json',{kind:'active-incident-vault-ci-started',syntheticInputsOnly:true,at:new Date().toISOString()});
 try{
  const cases=[];const prepare=name=>{const parent=makePrivate(root,name),source=makePrivate(parent,'source');let held=true;
   const pins=[['one.json',Buffer.from('{"synthetic":"private-values-not-logged"}\n')],['two.log',Buffer.from('owned synthetic diagnostic\n')]].map(([file,bytes])=>{bookingHostWriteOnce(source+'/'+file,exactText(bytes));return[file,bytes.length,sha256(bytes)];});
   const binding={kind:'ci-owned-vault-profile',publicationAuthority:false},engine=vault({source,destination:parent+'/vault',pins,binding,assertHeld:()=>need(held,'ci_ownership_lost')});return{parent,source,pins,engine,lose:()=>{held=false;}};};
  const refuse=work=>{let rejected=false;try{work();}catch{rejected=true;}need(rejected,'ci_refusal_missing');};
  stage='actual-copy-and-seal';const success=prepare('normal'),before=success.pins.map(p=>readPin(success.source+'/'+p[0],p).identity);success.engine.begin();success.engine.copy();const result=success.engine.seal();need(result.originalFilesRetained===true&&result.incidentClosed===false&&result.publicationAuthority===false,'ci_authority_leak');same(success.pins.map(p=>readPin(success.source+'/'+p[0],p).identity),before);refuse(()=>success.engine.seal());refuse(()=>success.engine.begin());cases.push('exact-copy-fsync-seal-with-original-inodes-retained');
  stage='uncertain-replay';const repeated=prepare('repeated');repeated.engine.begin();refuse(()=>repeated.engine.begin());need(!fs.existsSync(repeated.parent+'/vault/preserved.json'),'ci_false_seal');cases.push('uncertain-replay-refused');
  stage='source-change';const changed=prepare('changed-source');changed.engine.begin();fs.writeFileSync(changed.source+'/one.json','changed',{flag:'r+'});refuse(()=>changed.engine.copy());need(!fs.existsSync(changed.parent+'/vault/preserved.json'),'ci_false_seal');cases.push('source-change-retains-failed-vault-without-seal');
  stage='destination-change';const destination=prepare('changed-destination');destination.engine.begin();destination.engine.copy();fs.writeFileSync(destination.parent+'/vault/one.json','changed',{flag:'r+'});refuse(()=>destination.engine.seal());need(!fs.existsSync(destination.parent+'/vault/preserved.json'),'ci_false_seal');cases.push('destination-change-refused');
  stage='ownership-loss';const loss=prepare('ownership-loss');loss.engine.begin();loss.engine.copy();loss.lose();refuse(()=>loss.engine.seal());need(!fs.existsSync(loss.parent+'/vault/preserved.json'),'ci_false_seal');cases.push('ownership-loss-refuses-seal');
  stage='symlink-and-hardlink';const linked=prepare('linked-source'),linkedFile=linked.source+'/one.json';fs.renameSync(linkedFile,linked.source+'/original-retained.json');fs.symlinkSync(linked.source+'/original-retained.json',linkedFile);refuse(()=>linked.engine.begin());const hard=prepare('hardlinked-source');fs.linkSync(hard.source+'/one.json',hard.source+'/second-link.json');refuse(()=>hard.engine.begin());cases.push('symlink-and-hardlink-source-refused');
  const report={kind:'active-incident-evidence-vault-native-acceptance',root,cases,realOwnedFiles:true,originalEvidenceRetained:true,failedEvidenceRetained:true,productionMutated:false,publicationAuthority:false,mailEnabled:false,completedAt:new Date().toISOString()};seal(root+'/acceptance.json',report);return report;
 }catch(error){try{const {stageFailureDiagnostic}=await import('./release-toolchain-diagnostics.mjs');seal(root+'/failure.json',{stage,diagnostic:stageFailureDiagnostic(error,{stage:'candidate',toolRevision:path.basename(path.dirname(path.dirname(new URL(import.meta.url).pathname))),knownFiles:['release-toolchain-active-generation-preservation.mjs']}),syntheticInputsOnly:true,at:new Date().toISOString()});}catch{}throw error;}
}
