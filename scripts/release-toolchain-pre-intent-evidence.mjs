// Connect-only evidence for the exact old pre-intent refusal. No writer,
// signal, lease constructor, activation or process-control API is imported.
import * as fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import pins,{PRE_INTENT as H,PRE_INTENT_FILES} from './release-toolchain-pre-intent-pins.mjs';
import cohortPins from './release-toolchain-preconnect-pins.mjs';
import {assertPinnedPreIntentRefusal} from './release-toolchain-pre-intent-contract.mjs';
import {ACTIVE_BOOKING_INCIDENT as P,ACTIVE_BOOKING_METADATA as M,assertActiveBookingDatabaseProgress} from './release-toolchain-active-generation-contract.mjs';
import {inspectPinnedExecutionSource,ownedReleasePath,collectRemoteReleaseReview} from './release-toolchain-source.mjs';
import {validateAttendanceBackupEvidence} from './attendance-production-database-migrations.mjs';
import {collectActiveBookingLegacyHost,collectFormalBookingPm2Registry} from './release-toolchain-pm2-observation.mjs';
import {processBirth} from './release-toolchain-process-birth.mjs';
import {readOnlineRetentionHistory} from './online-release-retention.mjs';
import {proveRecoveryTargets} from './release-toolchain-recovery-probe.mjs';
import {bookingHandoffActivationSnapshotSql} from './booking-handoff-activation.mjs';
import {bookingHostRead,bookingHostSql} from './booking-handoff-host-io.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
const same=(a,b)=>need(isDeepStrictEqual(a,b),'owned_resource_changed');
const fact=s=>Object.fromEntries(['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'].map(k=>[k,s[k]]));
const digest=p=>sha256(bookingHostRead(p,{binary:true}));
const read=p=>{const text=bookingHostRead(p),value=JSON.parse(text);same(text,canonicalJson(value)+'\n');return value;};
let review;
export const preIntentPinsSha256=()=>sha256(canonicalJson(pins));
function directory(expected,location,renamed){
 const actual=fact(ownedReleasePath(location,{directory:true,privateMode:true}));
 if(renamed){const{ctimeMs:a,...left}=actual,{ctimeMs:b,...right}=expected.identity;void a;void b;same(left,right);}else same(actual,expected.identity);
}
export function assertPreIntentOriginalOperation(location=pins.operation.directory,{archived=false}={}){
 need(location===pins.operation.directory||new RegExp('^'+H.root+'/[a-f0-9-]{36}/operation\\.lock$').test(location),'invalid_path');
 directory(pins.operation,location,archived);same(fs.readdirSync(location),[]);return true;
}
export function readPinnedPreIntentFailure(location=pins.publication.directory){
 need(location===pins.publication.directory||new RegExp('^'+H.root+'/[a-f0-9-]{36}/publication$').test(location),'invalid_path');
 directory(pins.publication,location,location!==pins.publication.directory);same(fs.readdirSync(location).sort(),[...PRE_INTENT_FILES].sort());
 for(const[name,pin]of Object.entries(pins.publication.files)){const file=location+'/'+name;same(fact(ownedReleasePath(file,{privateMode:true})),pin.identity);same(digest(file),pin.sha256);}
 const source=inspectPinnedExecutionSource({revision:H.toolRevision,directory:'/var/lib/faolla-online-code/'+H.toolRevision});same(source.inventorySha256,H.inventorySha256);
 const birth=processBirth(H.controllerPid),records={attempt:read(location+'/publication-attempt.json'),failure:read(location+'/controller-exit-unconfirmed.json'),publicationFailure:read(location+'/publication-unconfirmed.json'),readiness:read(location+'/rollback-readiness.json'),names:fs.readdirSync(location),controllerGone:birth===null||birth.startTicks!==H.controllerStartTicks||birth.zombie};
 const proof=assertPinnedPreIntentRefusal(records);same(records.attempt.backupDirectory,pins.backup.directory);
 for(const[name,pin]of Object.entries(pins.backup.files)){const file=pins.backup.directory+'/'+name;same(fact(ownedReleasePath(file,{privateMode:true})),pin.identity);if(name!=='database.tar.enc')same(digest(file),pin.sha256);}
 same(digest(H.preConnectClosedDirectory+'/closed.json'),H.preConnectClosedSha256);
 return{records,proof,location,pinsSha256:preIntentPinsSha256(),source};
}
export async function verifyPinnedPreIntentHistory(location){
 const result=readPinnedPreIntentFailure(location);
 if(!review||Date.now()-Date.parse(review.createdAt)>600000){review=await collectRemoteReleaseReview(H.toolRevision,{production:false});same(review.runs.map(v=>v.runId),[40927041499,40927041530]);need(review.productionEligible===false,'evidence_invalid');}
 const b=pins.backup.directory,backup=await validateAttendanceBackupEvidence({target:H.toolRevision,backup:b+'/database.tar.enc',createReport:b+'/backup-create.json',verifyReport:b+'/backup-verify.json'});
 same(backup.archiveSha256,pins.backup.files['database.tar.enc'].sha256);return result;
}
// Original 8607 proof is interpreted by its own immutable grammar/qualification,
// never relabelled as a current-source qualification or held-lock capability.
export async function verifyOriginalPreConnectClosure(preparedWorker){
 const source=inspectPinnedExecutionSource({revision:H.toolRevision,directory:'/var/lib/faolla-online-code/'+H.toolRevision});same(source.inventorySha256,H.inventorySha256);
 const original=await import('file:///var/lib/faolla-online-code/'+H.toolRevision+'/scripts/release-toolchain-preconnect-closure.mjs');
 const proof=await original.verifyClosedPreConnectAbort(H.toolRevision,preparedWorker);
 same(proof.directory,H.preConnectClosedDirectory);same(proof.sha256,H.preConnectClosedSha256);same(proof.qualificationSha256,H.preConnectQualificationSha256);return proof;
}
export async function observeUnchangedPreIntentHost(databaseBefore,{preparedWorker=null,verify=()=>{}}={}){
 const actual=collectActiveBookingLegacyHost(),physical=collectFormalBookingPm2Registry();
 if(preparedWorker){same(actual,preparedWorker.after.legacy);same(physical.filteredRegistry,preparedWorker.physical.filteredRegistry);}
 const cohort=preparedWorker?preparedWorker.priorCohort:actual,registry=preparedWorker?preparedWorker.priorRegistry:physical.filteredRegistry;
 const hashes={processesSha256:sha256(canonicalJson(cohort.processes)),identitiesSha256:sha256(canonicalJson(cohort.identityProofs)),registrySha256:sha256(canonicalJson(registry)),rawSha256:sha256(canonicalJson(cohort.raw))};
 for(const key of Object.keys(hashes))same(hashes[key],cohortPins.cohort[key]);need(physical.rows.length===25,'owned_resource_changed');
 const check=()=>{verify();same(bookingHostRead('/var/lib/faolla-online-release/active.json'),M.afterText);same(digest('/var/lib/faolla-online-release/'+P.candidate+'/state.json'),'7ba13be0b859c918a71481b469596d6f2ef430ba61b1fc1946471812fb5651d3');same(digest('/var/lib/faolla-online-release/'+P.compatibleRollback+'/state.json'),'12a7590d9de39d10179d0b60d3730c0451c5ad9e2b9a6d22044a77fe0861be3d');same(readOnlineRetentionHistory().headSha256,'77ea9068d2c634f146f0f53be465ba9cb13ad335417cbc8f2228fd6bc5cef6cb');need(!fs.existsSync('/var/lib/faolla-booking-handoff/'+P.candidate+'/worker-enabled.json'),'attempt_unknown');};
 check();const publicProof=await proveRecoveryTargets({origins:['https://faolla.com','https://launch.faolla.com'],target:P.compatibleRollback,operationId:randomUUID(),verify:check,deadlineAtMs:Date.now()+30000});
 const database=JSON.parse(bookingHostSql(bookingHandoffActivationSnapshotSql));assertActiveBookingDatabaseProgress(databaseBefore,database,{systemIdentifier:'7612049595342295079',databaseOid:'5'});same(collectActiveBookingLegacyHost(),actual);same(collectFormalBookingPm2Registry().filteredRegistry,physical.filteredRegistry);check();
 return{...hashes,database,publicProof,actualRoute:P.compatibleRollback,actualWorkerUnchanged:preparedWorker===null,gateEnabled:false,processControlPerformed:false,mailEnabled:false,publicationAuthority:false,observedAt:new Date().toISOString()};
}
export async function observePreIntentUnchanged({publicationDirectory=pins.publication.directory,operationDirectory=pins.operation.directory,archivedOperation=false,preparedWorker=null}={}){
 const history=await verifyPinnedPreIntentHistory(publicationDirectory);assertPreIntentOriginalOperation(operationDirectory,{archived:archivedOperation});const prior=await verifyOriginalPreConnectClosure(preparedWorker),current=await observeUnchangedPreIntentHost(history.records.attempt.database,{preparedWorker});readPinnedPreIntentFailure(publicationDirectory);assertPreIntentOriginalOperation(operationDirectory,{archived:archivedOperation});
 return{...current,kind:'fixed-pre-worker-intent-unchanged-observation',pinsSha256:history.pinsSha256,proof:history.proof,originalPreConnectClosureSha256:prior.sha256,publicationAuthority:false};
}
export async function observePreIntentForInstallation(){need(!fs.existsSync(H.root),'attempt_unknown');return observePreIntentUnchanged();}
