// Read-only fixed refusal inspection. No process control, lease creation or
// business writes. Private worker environment values NEVER leave this reader.
import * as fs from'node:fs';import{isDeepStrictEqual}from'node:util';
import pins from'./release-toolchain-pre-control-pins.mjs';
import{PRE_CONTROL as H,PRE_CONTROL_FILES,assertFixedPreControlRefusal}from'./release-toolchain-pre-control-contract.mjs';
import{PRE_ROUTE}from'./release-toolchain-pre-route-contract.mjs';
import{verifyPinnedPreRouteHistory}from'./release-toolchain-pre-route-evidence.mjs';
import{ACTIVE_BOOKING_INCIDENT as P,ACTIVE_BOOKING_METADATA as M,assertActiveBookingDatabaseProgress}from'./release-toolchain-active-generation-contract.mjs';
import{inspectPinnedExecutionSource,ownedReleasePath,collectRemoteReleaseReview}from'./release-toolchain-source.mjs';
import{collectActiveBookingLegacyHost,collectFormalBookingPm2Registry}from'./release-toolchain-pm2-observation.mjs';
import{bookingReadyWorkerConfiguration}from'./booking-ready-worker.mjs';
import{verifyPinnedPostSaveHistory,verifyPostSaveCurrentProcesses}from'./release-toolchain-post-save-evidence.mjs';
import{validateAttendanceBackupEvidence}from'./attendance-production-database-migrations.mjs';
import{readOnlineRetentionHistory}from'./online-release-retention.mjs';
import{processBirth}from'./release-toolchain-process-birth.mjs';
import{bookingHostRead,bookingHostSql}from'./booking-handoff-host-io.mjs';
import{bookingHandoffActivationSnapshotSql}from'./booking-handoff-activation.mjs';
import{canonicalJson,sha256,requireToolchain as need}from'./release-toolchain-contracts.mjs';
const OP=pins.operation.directory,same=(a,b)=>need(isDeepStrictEqual(a,b),'owned_resource_changed'),read=p=>{const t=bookingHostRead(p),v=JSON.parse(t);same(t,canonicalJson(v)+'\n');return v;},digest=p=>sha256(bookingHostRead(p,{binary:true})),fact=s=>Object.fromEntries(['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'].map(k=>[k,s[k]]));
let review;
export const preControlPinsSha256=()=>sha256(canonicalJson(pins));
// Source is already independently inventoried and root-owned, but Git source
// files are 0644. Do not weaken the default 0600 reader for private evidence.
export function readOwnedSourceHelperSha256(filename){ownedReleasePath(filename);return sha256(bookingHostRead(filename,{binary:true,privateMode:false}));}
function directoryPin(expected,location,{renamed=false}={}){const a=fact(ownedReleasePath(location,{directory:true,privateMode:true})),b=expected.identity;if(renamed){const{ctimeMs:x,...left}=a,{ctimeMs:y,...right}=b;void x;void y;same(left,right);}else same(a,b);}
export function readPinnedPreControlFailure(location=pins.publication.directory){
 need(location===pins.publication.directory||new RegExp('^'+H.root+'/[a-f0-9-]{36}/publication$').test(location),'invalid_path');directoryPin(pins.publication,location,{renamed:location!==pins.publication.directory});same(fs.readdirSync(location).sort(),[...PRE_CONTROL_FILES].sort());
 for(const[name,v]of Object.entries(pins.publication.files)){const file=location+'/'+name;same(fact(ownedReleasePath(file,{privateMode:true})),v.identity);same(digest(file),v.sha256);}
 const source=inspectPinnedExecutionSource({revision:H.toolRevision,directory:'/var/lib/faolla-online-code/'+H.toolRevision});same(source.inventorySha256,H.inventorySha256);same(readOwnedSourceHelperSha256(pins.helper.filename),H.helperSha256);
 const records={publication:read(location+'/publication-attempt.json'),worker:read(location+'/worker-attempt.json'),failure:read(location+'/controller-exit-unconfirmed.json'),workerFailure:read(location+'/worker-unconfirmed.json'),publicationFailure:read(location+'/publication-unconfirmed.json'),closedText:bookingHostRead(PRE_ROUTE.closedDirectory+'/closed.json'),helperSha256:H.helperSha256,names:fs.readdirSync(location)};
 const proof=assertFixedPreControlRefusal(records),birth=processBirth(H.controllerPid);need(birth===null||birth.startTicks!==H.controllerStartTicks||birth.zombie,'owned_resource_changed');
 for(const name of ['active-publication-backup-attempt.json','backup-application-binding.json','backup-create.json','backup-producer-source.json','backup-verify.json','backup.key']){const file=pins.backup.directory+'/'+name,v=pins.backup.files[name];same(fact(ownedReleasePath(file,{privateMode:true})),v.identity);same(digest(file),v.sha256);}same(fact(ownedReleasePath(pins.backup.directory+'/database.tar.enc',{privateMode:true})),pins.backup.files['database.tar.enc'].identity);
 return{records,proof,source,pinsSha256:preControlPinsSha256(),location};
}
export async function verifyPinnedPreControlHistory(location){
 need(verifyPinnedPreRouteHistory().archived===true,'evidence_invalid');
 const result=readPinnedPreControlFailure(location);if(!review||Date.now()-Date.parse(review.createdAt)>600000){review=await collectRemoteReleaseReview(H.toolRevision,{production:false});same(review.runs.map(v=>v.runId),[40871753916,40871753880]);need(review.productionEligible===false,'evidence_invalid');}
 const b=pins.backup.directory,backup=await validateAttendanceBackupEvidence({target:H.toolRevision,backup:b+'/database.tar.enc',createReport:b+'/backup-create.json',verifyReport:b+'/backup-verify.json'});same(backup.archiveSha256,pins.backup.files['database.tar.enc'].sha256);return result;
}
export function assertPreControlOriginalOperation(location=OP,{archived=false}={}){need(location===OP||new RegExp('^'+H.root+'/[a-f0-9-]{36}/operation\\.lock$').test(location),'invalid_path');const s=ownedReleasePath(location,{directory:true,privateMode:true});if(archived)same(Object.fromEntries(['dev','ino','uid','mode'].map(k=>[k,s[k]])),Object.fromEntries(['dev','ino','uid','mode'].map(k=>[k,pins.operation.identity[k]])));else same(fact(s),pins.operation.identity);same(fs.readdirSync(location),[]);return true;}
export async function observePreControlUnchanged({publicationDirectory=pins.publication.directory,operationDirectory=OP,archivedOperation=false,preparedWorker=null}={}){
 const history=await verifyPinnedPreControlHistory(publicationDirectory);assertPreControlOriginalOperation(operationDirectory,{archived:archivedOperation});
 const physical=collectFormalBookingPm2Registry(),cohort=collectActiveBookingLegacyHost(),original=preparedWorker?preparedWorker.priorCohort:cohort,registry=preparedWorker?preparedWorker.priorRegistry:physical.filteredRegistry,configured=preparedWorker?preparedWorker.before.configured:bookingReadyWorkerConfiguration(physical.rows.find(r=>r.pm_id===27).pm2_env);
 same(original,history.records.worker.before.legacy);same(registry,history.records.worker.before.registry);same(configured,history.records.worker.before.configured);same(physical.rows.length,25);
 const prior=await verifyPinnedPostSaveHistory();await verifyPostSaveCurrentProcesses(prior,{physical,priorRegistry:preparedWorker?.priorRegistry??null});
 same(bookingHostRead('/var/lib/faolla-online-release/active.json'),M.afterText);same(digest('/var/lib/faolla-online-release/'+P.candidate+'/state.json'),'7ba13be0b859c918a71481b469596d6f2ef430ba61b1fc1946471812fb5651d3');same(digest('/var/lib/faolla-online-release/'+P.compatibleRollback+'/state.json'),'12a7590d9de39d10179d0b60d3730c0451c5ad9e2b9a6d22044a77fe0861be3d');need(!fs.existsSync('/var/lib/faolla-booking-handoff/'+P.candidate+'/worker-enabled.json'),'attempt_unknown');same(readOnlineRetentionHistory().headSha256,'77ea9068d2c634f146f0f53be465ba9cb13ad335417cbc8f2228fd6bc5cef6cb');
 const database=JSON.parse(bookingHostSql(bookingHandoffActivationSnapshotSql));assertActiveBookingDatabaseProgress(history.records.worker.database,database,{systemIdentifier:'7612049595342295079',databaseOid:'5'});
 return{kind:'fixed-pre-control-unchanged-current-observation',pinsSha256:history.pinsSha256,proof:history.proof,processesSha256:sha256(canonicalJson(original.processes)),identitiesSha256:sha256(canonicalJson(original.identityProofs)),registrySha256:sha256(canonicalJson(registry)),rawSha256:sha256(canonicalJson(original.raw)),database,actualRoute:P.compatibleRollback,actualWorkerUnchanged:preparedWorker===null,priorFailureCohortUnchanged:true,gateEnabled:false,businessDataWrittenByTool:false,publicationAuthority:false,observedAt:new Date().toISOString()};
}
// Bootstrap preflight only; a data report is never lock or close authority.
export async function observePreControlForInstallation(){need(!fs.existsSync(H.root),'attempt_unknown');return observePreControlUnchanged();}
