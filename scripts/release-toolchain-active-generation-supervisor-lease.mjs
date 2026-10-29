// Read-only inherited-lease admission for the NEW active-generation supervisor.
// Does not mint the normal held-lock token, signal a process, recover traffic,
// write metadata, persist PM2 or enable a worker. Those actors remain separate.
import {assertSameReparentableNodeProcess} from './release-toolchain-process-identity.mjs';
import * as fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {isDeepStrictEqual} from 'node:util';
import {ACTIVE_BOOKING_INCIDENT as P,assertActiveBookingWindow} from './release-toolchain-active-generation-contract.mjs';
import {captureProcessFact} from './check-production-runtime-supervision.mjs';import {inspectPinnedExecutionSource,ownedReleasePath,collectRemoteReleaseReview} from './release-toolchain-source.mjs';
import {bookingHostRead} from './booking-handoff-host-io.mjs';import {canonicalJson,sha256,requireToolchain as need,exactKeys} from './release-toolchain-contracts.mjs';
import {expectedProcessState} from './release-toolchain-process-birth.mjs';
const ROOT='/var/lib/faolla-booking-active-publications/'+P.candidate,DEPLOY='/www/wwwroot/merchant-space.deploy.lock',OPERATION='/var/lib/faolla-maintenance/merchant-space/operation.lock',caps=new WeakMap();
const source=path.dirname(path.dirname(fileURLToPath(import.meta.url))),toolRevision=path.basename(source),same=(a,b)=>need(isDeepStrictEqual(a,b),'owned_resource_changed'),hash=/^[a-f0-9]{64}$/;
const read=file=>{const text=bookingHostRead(file),value=JSON.parse(text);same(text,canonicalJson(value)+'\n');return value;};
const lockIdentity=value=>Object.fromEntries(['dev','ino','uid','mode','nlink'].map(key=>[key,value[key]]));
const sourceIdentity=value=>Object.fromEntries(['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'].map(key=>[key,value[key]]));
// Shared READ-ONLY physical primitive, also used by the owned native runner.
// A true result does not mint either a formal or a normal held-lock capability.
export function assertActualActiveSupervisorKernelIdentity({deploy,operation}){
 need(process.platform==='linux'&&process.getuid?.()===0,'unsupported_runtime');
 for(const [value,key,mode,links]of [[deploy,'file',0o100600,1],[operation,'directory',0o40700,2]]){exactKeys(value,[key,'identity']);exactKeys(value.identity,['dev','ino','uid','mode','nlink']);need(Object.values(value.identity).every(Number.isSafeInteger)&&value.identity.dev>=0&&value.identity.ino>0&&value.identity.uid===0&&value.identity.mode===mode&&value.identity.nlink===links,'evidence_invalid');}
 same(lockIdentity(fs.fstatSync(3)),deploy.identity);same(lockIdentity(ownedReleasePath(deploy.file,{privateMode:true})),deploy.identity);same(fs.readlinkSync('/proc/self/fd/3'),deploy.file);need(/lock:.*FLOCK\s+ADVISORY\s+WRITE/.test(fs.readFileSync('/proc/self/fdinfo/3','utf8')),'owned_resource_changed');
 same(lockIdentity(ownedReleasePath(operation.directory,{directory:true,privateMode:true})),operation.identity);same(fs.readdirSync(operation.directory),[]);return true;
}
export function assertActiveBookingSupervisorLease(lease){
 exactKeys(lease,['schemaVersion','kind','candidate','compatibleRollback','generation','toolRevision','toolInventorySha256','directory','window','parent','deploy','operation','publicationAttemptSha256','routingPlanSha256','ingressPlanSha256','workerPreparationSha256','closedIncidentSha256','publicationAuthority']);
 need(lease.schemaVersion===2&&lease.kind==='booking-already-active-independent-supervisor'&&lease.candidate===P.candidate&&lease.compatibleRollback===P.compatibleRollback&&lease.generation===P.generation&&/^[a-f0-9]{40}$/.test(lease.toolRevision??'')&&lease.toolRevision!==P.toolRevision&&lease.publicationAuthority===false,'evidence_invalid');
 assertActiveBookingWindow(lease.window,{nowMs:Date.parse(lease.window?.startedAt)});need(lease.directory===ROOT+'/'+lease.window.id&&['toolInventorySha256','publicationAttemptSha256','routingPlanSha256','ingressPlanSha256','workerPreparationSha256','closedIncidentSha256'].every(key=>hash.test(lease[key]??'')),'evidence_invalid');
 exactKeys(lease.deploy,['file','identity']);exactKeys(lease.operation,['directory','identity']);same(lease.deploy.file,DEPLOY);same(lease.operation.directory,OPERATION);
 for(const [field,mode,links]of [['deploy',0o100600,1],['operation',0o40700,2]]){const id=lease[field].identity;exactKeys(id,['dev','ino','uid','mode','nlink']);need(Object.values(id).every(Number.isSafeInteger)&&id.dev===64769&&id.ino>0&&id.uid===0&&id.mode===mode&&id.nlink===links,'evidence_invalid');}
 need(lease.deploy.identity.ino===814869&&lease.operation.identity.ino!==3566178,'evidence_invalid');
 const parent=lease.parent;exactKeys(parent,['pid','parentPid','startTicks','processIdentity','uid','cwd','cwdIdentity','executable','executableIdentity','commandLine','commandLineDigest']);need(Number.isSafeInteger(parent?.pid)&&parent.pid>1&&parent.uid===0&&/^[1-9][0-9]*$/.test(parent.startTicks??'')&&parent.executable==='/usr/bin/node'&&parent.cwd==='/var/lib/faolla-online-code/'+lease.toolRevision,'evidence_invalid');
 same(parent.commandLine,['/usr/bin/node',parent.cwd+'/scripts/release-toolchain-active-generation-publish-entry.mjs','publish']);same(parent.commandLineDigest,sha256(parent.commandLine.join('\0')+'\0'));return true;
}
const parentState=expectedProcessState;
function verify(value,{requireParentGone=false}={}){
 const {lease,directory}=value;assertActiveBookingSupervisorLease(lease);need(Date.now()>=Date.parse(lease.window.startedAt)&&Date.now()<=Date.parse(lease.window.deadlineAt)+60000,'evidence_stale');
 const currentSelf=captureProcessFact(process.pid);assertSameReparentableNodeProcess(value.self,currentSelf);same(sha256(bookingHostRead(directory+'/supervisor-lease.json')),value.leaseSha256);
 for(const [file,identity]of value.sourceWitnesses)same(sourceIdentity(fs.lstatSync(file)),identity);
 assertActualActiveSupervisorKernelIdentity({deploy:lease.deploy,operation:lease.operation});
 for(const [name,key]of [['publication-attempt.json','publicationAttemptSha256'],['routing-plan.json','routingPlanSha256'],['ingress-plan.json','ingressPlanSha256'],['worker-completed.json','workerPreparationSha256']])same(sha256(bookingHostRead(directory+'/'+name)),lease[key]);
 const attempt=read(directory+'/publication-attempt.json'),worker=read(directory+'/worker-completed.json');need(attempt.kind==='active-booking-publication-attempt'&&attempt.toolRevision===toolRevision&&attempt.inventorySha256===lease.toolInventorySha256&&attempt.closedIncidentSha256===lease.closedIncidentSha256&&worker.kind==='active-booking-gated-worker-source-replaced'&&worker.toolRevision===toolRevision&&worker.inventorySha256===lease.toolInventorySha256&&worker.closedIncidentSha256===lease.closedIncidentSha256&&worker.gateNeverOpened===true&&worker.webProcessesChanged===false&&worker.businessDataWrittenByTool===false&&worker.mailEnabled===false&&worker.publicationAuthority===false,'evidence_invalid');assertSameReparentableNodeProcess(attempt.controller,lease.parent);same(attempt.window,lease.window);same(worker.window,lease.window);
 const state=parentState(lease.parent);need(state!=='reused'&&(!requireParentGone||state==='absent'),'owned_resource_changed');return state;
}
export async function adoptActiveBookingSupervisorInheritedLease(){
 need(process.platform==='linux'&&process.getuid?.()===0&&process.execPath==='/usr/bin/node'&&source==='/var/lib/faolla-online-code/'+toolRevision&&process.cwd()===source&&process.argv.length===3,'unsupported_runtime');
 const id=process.argv[2];need(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id??'')&&id!==P.operationId,'invalid_contract');const self=captureProcessFact(process.pid);same(self.commandLine,['/usr/bin/node',source+'/scripts/release-toolchain-active-generation-supervisor-entry.mjs',id]);
 const directory=ROOT+'/'+id;ownedReleasePath(directory,{directory:true,privateMode:true});const lease=read(directory+'/supervisor-lease.json');assertActiveBookingSupervisorLease(lease);need(lease.toolRevision===toolRevision&&lease.directory===directory,'source_changed');
 const launched=read(directory+'/supervisor-spawned.json');need(launched.kind==='active-booking-supervisor-spawned'&&launched.leaseSha256===sha256(bookingHostRead(directory+'/supervisor-lease.json')),'evidence_invalid');assertSameReparentableNodeProcess(launched.process,self);need(launched.process.parentPid===lease.parent.pid,'evidence_invalid');
 const pinned=inspectPinnedExecutionSource({revision:toolRevision,directory:source});same(pinned.inventorySha256,lease.toolInventorySha256);await collectRemoteReleaseReview(toolRevision);
 const sourceWitnesses=new Map();for(const row of pinned.rows){if(row.file.startsWith('public/downloads/'))continue;const file=source+'/'+row.file;sourceWitnesses.set(file,sourceIdentity(ownedReleasePath(file)));for(let parent=path.dirname(file);parent.startsWith(source);parent=path.dirname(parent))if(!sourceWitnesses.has(parent))sourceWitnesses.set(parent,sourceIdentity(ownedReleasePath(parent,{directory:true})));}
 const value={lease,directory,self,leaseSha256:sha256(bookingHostRead(directory+'/supervisor-lease.json')),inventorySha256:pinned.inventorySha256,sourceWitnesses};verify(value);const capability=Object.freeze({kind:'active-booking-supervisor-inherited-capability'});caps.set(capability,value);return capability;
}
export function assertActiveBookingSupervisorInheritedLease(capability,options){const value=caps.get(capability);need(value,'invalid_contract');return verify(value,options);}
export function inspectActiveBookingSupervisorInheritedLease(capability){const value=caps.get(capability);need(value,'invalid_contract');const state=verify(value);return{lease:structuredClone(value.lease),parentState:state,publicationAuthority:false};}
