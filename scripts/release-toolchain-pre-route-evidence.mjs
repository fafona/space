// Read-only history plus a single owned rename. Original receipts and inodes
// remain intact; no closure, metadata/save replay or application mutation.
import * as fs from 'node:fs';import {fileURLToPath} from 'node:url';import path from 'node:path';import{isDeepStrictEqual}from'node:util';
import{PRE_ROUTE as H,assertPreRouteRefusal}from'./release-toolchain-pre-route-contract.mjs';
import{inspectPinnedExecutionSource,ownedReleasePath}from'./release-toolchain-source.mjs';
import{assertOnlineRetentionHeldLocks}from'./online-release-retention-writer.mjs';
import{reviewedBookingExecution}from'./release-toolchain-authority.mjs';
import{processBirth}from'./release-toolchain-process-birth.mjs';
import{bookingHostRead,bookingHostWriteOnce,bookingHostSync}from'./booking-handoff-host-io.mjs';
import{canonicalJson,sha256,requireToolchain as need}from'./release-toolchain-contracts.mjs';
import pins from './release-toolchain-pre-route-pins.mjs';
const same=(a,b)=>need(isDeepStrictEqual(a,b),'owned_resource_changed'),read=p=>JSON.parse(bookingHostRead(p)),fact=s=>Object.fromEntries(['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'].map(k=>[k,s[k]]));
function pinnedDirectory(pin,location,{renamed=false}={}){
 const s=ownedReleasePath(location,{directory:true,privateMode:true}),actual=fact(s),expected=pin.identity;
 if(renamed){const{ctimeMs:a,...left}=actual,{ctimeMs:b,...right}=expected;void a;void b;same(left,right);}else same(actual,expected);
 same(fs.readdirSync(location).sort(),Object.keys(pin.files).sort());
 for(const[name,v]of Object.entries(pin.files)){const p=location+'/'+name;if(v.entries){same(fact(ownedReleasePath(p,{directory:true,privateMode:true})),v.identity);same(fs.readdirSync(p),v.entries);}else{same(fact(ownedReleasePath(p,{privateMode:true})),v.identity);same(sha256(bookingHostRead(p,{binary:true})),v.sha256);}}
 return true;
}
export function verifyPinnedPreRouteHistory(){
 const old=inspectPinnedExecutionSource({revision:H.toolRevision,directory:'/var/lib/faolla-online-code/'+H.toolRevision});same(old.inventorySha256,H.inventorySha256);
 pinnedDirectory(pins.closed,pins.closed.directory);
 const archived=fs.existsSync(H.archive+'/archived.json'),location=archived?H.archive+'/publication':pins.publication.directory;
 if(archived){need(!fs.existsSync(pins.publication.directory),'attempt_unknown');ownedReleasePath(H.archive,{directory:true,privateMode:true});same(fs.readdirSync(H.archive).sort(),['archived.json','intent.json','publication']);const intent=read(H.archive+'/intent.json'),receipt=read(H.archive+'/archived.json');need(intent.kind==='fixed-pre-route-preservation-intent'&&receipt.kind==='fixed-pre-route-preserved'&&receipt.originalDirectory===pins.publication.directory&&receipt.retainedDirectory===location&&receipt.originalInode===pins.publication.identity.ino&&receipt.intentSha256===sha256(bookingHostRead(H.archive+'/intent.json'))&&receipt.formalMutationPerformed===false&&receipt.publicationAuthority===false&&intent.priorToolRevision===H.toolRevision&&intent.closedIncidentSha256===H.closedSha256,'evidence_invalid');}
 else need(!fs.existsSync(H.archive),'attempt_unknown');
 pinnedDirectory(pins.publication,location,{renamed:archived});
 const b=pins.backup.directory;ownedReleasePath(b,{directory:true,privateMode:true});for(const name of ['controller-exit-unconfirmed.json','backup-application-binding.json','backup-create.json','backup-verify.json','backup-producer-source.json','backup.key']){const v=pins.backup.files[name];same(fact(ownedReleasePath(b+'/'+name,{privateMode:true})),v.identity);same(sha256(bookingHostRead(b+'/'+name)),v.sha256);}same(fact(ownedReleasePath(b+'/database.tar.enc',{privateMode:true})),pins.backup.files['database.tar.enc'].identity);
 const attempt=read(location+'/publication-attempt.json'),failure=read(b+'/controller-exit-unconfirmed.json'),birth=processBirth(attempt.controller.pid);need(birth===null||birth.startTicks!==attempt.controller.startTicks||birth.zombie,'owned_resource_changed');
 assertPreRouteRefusal({attempt,failure,names:fs.readdirSync(location),controllerGone:true});
 return{kind:'fixed-pre-route-prior-evidence',archived,location,closedSha256:H.closedSha256,priorToolRevision:H.toolRevision,priorInventorySha256:H.inventorySha256,originalPublicationInode:pins.publication.identity.ino,publicationAuthority:false};
}
export async function inspectPinnedPreRouteClosedIncident(toolRevision,heldLock,preparedWorker){
 need(toolRevision!==H.toolRevision&&path.dirname(path.dirname(fileURLToPath(import.meta.url)))==='/var/lib/faolla-online-code/'+toolRevision,'source_changed');verifyPinnedPreRouteHistory();
 // Import historical validators from the independently byte-verified OLD
 // closure. Its native resource closure is not reinterpreted by new code.
 const{inspectPostSaveWithPinnedSource}=await import('./release-toolchain-post-save-closed.mjs');
 const result=await inspectPostSaveWithPinnedSource(toolRevision,heldLock,preparedWorker);verifyPinnedPreRouteHistory();return result;
}
export async function preservePreRouteRefusal({lock,toolRevision}){
 assertOnlineRetentionHeldLocks(lock);need(reviewedBookingExecution(toolRevision)?.prepared.activeIncidentClosed?.evidenceToolRevision===H.toolRevision,'source_changed');
 const before=verifyPinnedPreRouteHistory();need(!before.archived,'attempt_replay_forbidden');await inspectPinnedPreRouteClosedIncident(toolRevision,lock);assertOnlineRetentionHeldLocks(lock);
 const parent=path.dirname(H.archive);ownedReleasePath('/var/lib',{directory:true});if(!fs.existsSync(parent)){fs.mkdirSync(parent,{mode:0o700});bookingHostSync('/var/lib');}ownedReleasePath(parent,{directory:true,privateMode:true});need(!fs.existsSync(H.archive),'attempt_unknown');fs.mkdirSync(H.archive,{mode:0o700});bookingHostSync(parent);
 const intent={kind:'fixed-pre-route-preservation-intent',toolRevision,priorToolRevision:H.toolRevision,closedIncidentSha256:H.closedSha256,originalDirectory:pins.publication.directory,retainedDirectory:H.archive+'/publication',originalIdentity:pins.publication.identity,formalMutationPerformed:false,publicationAuthority:false,at:new Date().toISOString()};bookingHostWriteOnce(H.archive+'/intent.json',canonicalJson(intent)+'\n');
 pinnedDirectory(pins.publication,pins.publication.directory);assertOnlineRetentionHeldLocks(lock);fs.renameSync(pins.publication.directory,H.archive+'/publication');bookingHostSync(path.dirname(pins.publication.directory));bookingHostSync(H.archive);
 bookingHostWriteOnce(H.archive+'/archived.json',canonicalJson({kind:'fixed-pre-route-preserved',toolRevision,priorToolRevision:H.toolRevision,originalDirectory:pins.publication.directory,retainedDirectory:H.archive+'/publication',originalInode:pins.publication.identity.ino,intentSha256:sha256(bookingHostRead(H.archive+'/intent.json')),formalMutationPerformed:false,publicationAuthority:false,completedAt:new Date().toISOString()})+'\n');assertOnlineRetentionHeldLocks(lock);return verifyPinnedPreRouteHistory();
}
