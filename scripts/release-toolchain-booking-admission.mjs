// Fresh admission is collected from real resources. Historical migration
// provenance stays immutable and is NEVER relabelled as a fresh backup/clone.
import * as fs from 'node:fs';import path from 'node:path';import {AsyncLocalStorage} from 'node:async_hooks';import {randomBytes} from 'node:crypto';
import {reviewedBookingExecution} from './release-toolchain-authority.mjs';
import {canonicalJson,sha256,assertFreshEvidence,requireToolchain as need} from './release-toolchain-contracts.mjs';
import {ownedReleasePath} from './release-toolchain-source.mjs';
import {FULL_REHEARSAL_SOURCES} from './release-toolchain-native-inventory.mjs';
import {validateIsolationContainer} from './release-toolchain-isolation.mjs';
import {verifyFullInterruptionReport} from './release-toolchain-full-interrupt.mjs';
import {createProductionDatabaseBackup} from './create-production-database-backup.mjs';
import {verifyProductionDatabaseBackup} from './verify-production-database-backup.mjs';
import {validateDatabaseBackupSourceIdentity} from './database-backup-contract.mjs';
import {attendanceProductionIdentity as production,validateAttendanceBackupEvidence} from './attendance-production-database-migrations.mjs';
import {bookingHistoricalMetadataReadSql,bookingInstalledMetadataReadSql,bookingDefaultPrivilegesReadSql} from './release-toolchain-booking-compatibility.mjs';
import {observeBookingReadyApplication,bookingPublicationBackupRequest} from './booking-ready-backup.mjs';
import {bookingHandoffActivationSnapshotSql} from './booking-handoff-activation.mjs';
import {assertOnlineRetentionHeldLocks} from './online-release-retention-writer.mjs';
import {bookingHostSql,bookingHostRead,bookingHostRun,bookingHostWriteOnce} from './booking-handoff-host-io.mjs';
import {BOOKING_HANDOFF_CANDIDATE as C,BOOKING_HANDOFF_APPLICATION as A} from './booking-handoff-policy.mjs';
const ROOT='/var/lib/faolla-booking-handoff/'+C,OP='/var/lib/faolla-online-release/'+C,context=new AsyncLocalStorage(),issued=new WeakSet();
const read=file=>JSON.parse(bookingHostRead(file)),seal=(file,value)=>bookingHostWriteOnce(file,canonicalJson(value)+'\n');
const same=(a,b)=>need(canonicalJson(a)===canonicalJson(b),'observation_mismatch');
const fact=file=>{const s=ownedReleasePath(file,{privateMode:true});return ['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'].map(k=>s[k]);};
const freeze=value=>{if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;};
export function assertQualificationReport(report,{toolRevision,inventorySha256,nowMs=Date.now()}){
 need(report?.schemaVersion===1&&report.kind==='booking-full-native-handoff-acceptance'&&report.toolRevision===toolRevision&&report.toolInventorySha256===inventorySha256&&
  report.candidate===C&&report.rollback===A&&report.productionMutated===false&&report.originalTimerMutated===false&&report.mailEnabled===false&&report.publicationAuthority===false&&
  report.backupRestoreVerified===true&&report.allFixturesStopped===true&&/^[a-f0-9]{64}$/.test(report.installedMetadataSha256??'')&&/^[a-f0-9]{64}$/.test(report.defaultPrivilegesSha256??'')&&report.postgresServerVersionNum==='150008'&&/^[1-9][0-9]{0,19}$/.test(report.postgresSystemIdentifier??'')&&
  report.postgresSystemIdentifier!==production.systemIdentifier,'evidence_invalid');
 const at=Date.parse(report.completedAt);need(Number.isFinite(at)&&at<=nowMs&&nowMs-at<86400000,'evidence_stale');
 same(Object.keys(report.sourceHashes).sort(),[...FULL_REHEARSAL_SOURCES].sort());
 need(Array.isArray(report.cases)&&report.cases.length===3,'evidence_invalid');
 for(const name of ['normal','controller-death-before-commit','controller-death-after-commit'])need(report.cases.filter(c=>c.name===name&&c.completed===true&&c.elapsedMs>0&&c.elapsedMs<=600000&&c.inheritedKernelLock===true&&c.realNginx===true&&c.realPostgres===true&&c.realProcesses===true&&c.ownedFixturesOnly===true).length===1,'evidence_invalid');
 return true;
}
export function verifyQualificationFiles(root,{toolRevision,inventorySha256}){
 need(/^\/var\/lib\/faolla-booking-full-rehearsal-[A-Za-z0-9]+$/.test(root),'invalid_path');ownedReleasePath(root,{directory:true,privateMode:true});
 const report=read(root+'/acceptance.json');assertQualificationReport(report,{toolRevision,inventorySha256});
 const owner=read(root+'/owner.json');need(owner.kind==='booking-full-native-isolated-owner'&&owner.root===root&&owner.toolRevision===toolRevision&&owner.sourceSha256===report.sourceHashes['release-toolchain-full-rehearsal.mjs'],'evidence_invalid');
 for(const file of FULL_REHEARSAL_SOURCES)need(sha256(bookingHostRead('/var/lib/faolla-online-code/'+toolRevision+'/scripts/'+file,{privateMode:false}))===report.sourceHashes[file],'source_changed');
 for(const c of report.cases){need(c.receiptFile===root+'/cases/'+c.name+'.json'&&sha256(bookingHostRead(c.receiptFile))===c.receiptSha256,'evidence_invalid');const actual=read(c.receiptFile);
  for(const key of ['name','completed','elapsedMs','inheritedKernelLock','realNginx','realPostgres','realProcesses','ownedFixturesOnly'])same(actual[key],c[key]);
  need(actual.allFixturesStopped===true&&actual.gateClosed===true&&actual.rowsPreserved===true&&actual.actualDatabase?.systemIdentifier===report.postgresSystemIdentifier,'evidence_invalid');
  const backup=read(root+'/runtime-'+c.name+'/backup-restore.json');need(backup.restoredRowsEqual===true&&backup.corruptArchiveRefused===true&&backup.productionDatabaseTouched===false,'evidence_invalid');
 }
 need(/^\/var\/lib\/faolla-release-toolchain-isolation-[A-Za-z0-9]+$/.test(report.isolationRoot??''),'invalid_path');const dbOwner=read(report.isolationRoot+'/owner.json'),stopped=read(report.isolationRoot+'/stopped.json');
 need(stopped.stopped===true&&stopped.filesPreserved===true&&stopped.containerId===dbOwner.containerId,'cleanup_unconfirmed');
 const actual=JSON.parse(bookingHostRun('docker',['inspect',dbOwner.containerId]))[0];validateIsolationContainer(actual,dbOwner,{running:false});
 return {root,report,sha256:sha256(bookingHostRead(root+'/acceptance.json'))};
}
export function latestBookingQualification(toolRevision,inventorySha256){
 const directory=ROOT+'/toolchain-qualification/'+toolRevision;ownedReleasePath(directory,{directory:true,privateMode:true});const entries=fs.readdirSync(directory).sort();
 need(entries.length>0&&entries.every(n=>/^attempt_[0-9]{13}_[a-f0-9-]{36}$/.test(n)),'evidence_invalid');const selected=directory+'/'+entries.at(-1),start=read(selected+'/started.json'),proof=read(selected+'/verified.json');
 need(start.toolRevision===toolRevision&&proof.toolRevision===toolRevision,'source_changed');const native=verifyQualificationFiles(proof.root,{toolRevision,inventorySha256});
 same(native.sha256,proof.nativeSha256);const interrupt=verifyFullInterruptionReport(proof.interruptionRoot,{toolRevision});same(interrupt.sha256,proof.interruptionSha256);return {...native,qualificationDirectory:selected,application:proof.application};
}
function fresh(c){need(issued.has(c)&&reviewedBookingExecution(c.toolRevision),'evidence_invalid');assertFreshEvidence(c.proof,{nowMs:Date.now(),maxAgeMs:600000});
 for(const [file,witness]of c.witnesses)same(fact(file),witness);return c;}
export function requireBookingAdmission(toolRevision){const c=fresh(context.getStore());need(c.toolRevision===toolRevision,'source_changed');return c.proof;}
export async function retainedBookingMigrationBackup(request){
 const c=context.getStore();if(!c)return null;fresh(c);same(request,bookingPublicationBackupRequest(C,OP));
 // This digest proves HISTORICAL migration provenance only. Fresh admission is
 // independently mandatory and backed by a separately encrypted current dump.
 need(sha256(bookingHostRead(request.createReport))===c.historical.createReportSha256&&sha256(bookingHostRead(request.verifyReport))===c.historical.verifyReportSha256,'evidence_invalid');
 return c.historical.backup;
}
async function historicalBackup(){
 const request=bookingPublicationBackupRequest(C,OP),create=read(request.createReport),saved=read(request.verifyReport),directory=path.dirname(request.backup);
 ownedReleasePath(request.backup,{privateMode:true});const verified=await verifyProductionDatabaseBackup({inputPath:request.backup,passphrase:bookingHostRead(directory+'/backup.key').trim()});
 same({...verified,checkedAt:saved.checkedAt},saved);same(saved.source,create.source);const validated=validateDatabaseBackupSourceIdentity(create.source,{requireRecoveryContent:true});need(validated.valid,'backup_source_mismatch');
 for(const key of ['containerId','containerName','databaseName','databaseOid','systemIdentifier','serverVersionNum'])same(validated.source.database[key],production[key]);
 need(create.status==='created'&&saved.status==='verified'&&create.outputSha256===saved.inputSha256&&create.outputBytes===saved.inputBytes&&create.createdAt===saved.backupCreatedAt,'evidence_invalid');
 return {createReportSha256:sha256(bookingHostRead(request.createReport)),verifyReportSha256:sha256(bookingHostRead(request.verifyReport)),backup:{archiveSha256:create.outputSha256,archiveBytes:create.outputBytes,createdAt:create.createdAt,source:validated.source,restoreRehearsed:false}};
}
export function observeBookingCompatibility(qualification){
 const contract=JSON.parse(bookingHostSql(bookingHistoricalMetadataReadSql())),installedMetadata=bookingHostSql(bookingInstalledMetadataReadSql),defaults=JSON.parse(bookingHostSql(bookingDefaultPrivilegesReadSql)),originalEvidence=read(OP+'/booking-compatibility-evidence.json'),originalCompatibility=read(OP+'/booking-compatibility.json');
 need(installedMetadata===qualification.report.installedMetadataSha256&&sha256(JSON.stringify(defaults))===qualification.report.defaultPrivilegesSha256,'observation_mismatch');
 need(sha256(bookingHostRead(OP+'/booking-compatibility-evidence.json'))===originalCompatibility.evidenceSha256&&contract===originalEvidence.contractSha256,'observation_mismatch');
 return {contract,installedMetadata,defaultPrivilegesSha256:qualification.report.defaultPrivilegesSha256,historicalCompatibilitySha256:sha256(bookingHostRead(OP+'/booking-compatibility.json'))};
}
export async function collectFreshBookingAdmission({lock,directory,qualification}){
 assertOnlineRetentionHeldLocks(lock);const toolRevision=path.basename(path.dirname(path.dirname(new URL(import.meta.url).pathname))),authority=reviewedBookingExecution(toolRevision);need(authority,'source_changed');
 ownedReleasePath(directory,{directory:true,privateMode:true});same(qualification.application,authority.prepared.application);verifyQualificationFiles(qualification.root,{toolRevision,inventorySha256:authority.tool.inventorySha256});
 const before=JSON.parse(bookingHostSql(bookingHandoffActivationSnapshotSql));need(before.active===false&&before.systemIdentifier===production.systemIdentifier,'database_identity_mismatch');
 const compatibility=observeBookingCompatibility(qualification),{contract,installedMetadata}=compatibility;
 const historical=await historicalBackup(),passphrase=randomBytes(48).toString('base64url'),backupPath=directory+'/database.tar.enc';seal(directory+'/backup.key',passphrase);
 const appDirectory='/www/wwwroot/merchant-space.web-releases/'+C.slice(0,12)+'-online';
 const created=await createProductionDatabaseBackup({outputPath:backupPath,passphrase,appDirectory,sourceDirectory:appDirectory,sourceRepository:'fafona/space',sourceSha:C,
  env:{...process.env,FAOLLA_DATABASE_CONTAINER:'supabase-db',FAOLLA_STORAGE_CONTAINER:'supabase-storage'}});seal(directory+'/backup-create.json',created);
 const checked=await verifyProductionDatabaseBackup({inputPath:backupPath,passphrase});seal(directory+'/backup-verify.json',checked);
 const backup=await validateAttendanceBackupEvidence({target:C,backup:backupPath,createReport:directory+'/backup-create.json',verifyReport:directory+'/backup-verify.json'});
 same(JSON.parse(bookingHostSql(bookingHandoffActivationSnapshotSql)),before);same(observeBookingCompatibility(qualification),compatibility);same(observeBookingReadyApplication(),authority.prepared.application);
 const createdAt=new Date().toISOString(),proof={kind:'release-toolchain-fresh-booking-admission',toolRevision,application:authority.application,applicationBuilds:authority.prepared.application,
  databaseBefore:before,backup:{...backup,archive:{schemaVersion:1,algorithm:'sha256',domain:'backup-archive',representation:'bytes-v1',value:backup.archiveSha256}},historicalBackupArchiveSha256:historical.backup.archiveSha256,
  compatibility:{method:'unchanged-production-structural-contract-and-current-isolated-handoff',currentMetadataContractSha256:contract,installedMetadataSha256:installedMetadata,defaultPrivilegesSha256:qualification.report.defaultPrivilegesSha256,historicalCompatibilitySha256:sha256(bookingHostRead(OP+'/booking-compatibility.json')),nativeAcceptanceSha256:qualification.sha256},
  createdAt,expiresAt:new Date(Date.parse(createdAt)+600000).toISOString(),mailEnabled:false};
 seal(directory+'/admission.json',proof);const original=bookingPublicationBackupRequest(C,OP),witnesses=new Map();
 for(const file of [backupPath,directory+'/backup.key',directory+'/backup-create.json',directory+'/backup-verify.json',directory+'/admission.json',original.backup,original.createReport,original.verifyReport,path.dirname(original.backup)+'/backup.key'])witnesses.set(file,fact(file));
 const c=Object.freeze({toolRevision,proof:freeze(proof),historical:freeze(historical),witnesses});issued.add(c);return c;
}
export function withFreshBookingAdmission(handle,work){const c=fresh(handle);need(typeof work==='function','invalid_contract');return context.run(c,()=>work(c.proof));}
