// Backup producer and application payload are separate identities. No shared
// backup format, validator, Git observation or legacy entry is overridden.
import * as fs from 'node:fs';import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {canonicalJson,sha256,assertApplication,ToolchainError,requireToolchain as need} from './release-toolchain-contracts.mjs';
import {reviewedBookingExecution} from './release-toolchain-authority.mjs';
import {sourceGit,inspectOwnedDetachedSource,ownedReleasePath} from './release-toolchain-source.mjs';
import {assertOnlineRetentionHeldLocks} from './online-release-retention-writer.mjs';
import {createProductionDatabaseBackup} from './create-production-database-backup.mjs';
import {withVerifiedProductionDatabaseBackup} from './verify-production-database-backup.mjs';
import {validateAttendanceBackupEvidence} from './attendance-production-database-migrations.mjs';
import {bookingHostRead,bookingHostRun,bookingHostWriteOnce} from './booking-handoff-host-io.mjs';
import {BOOKING_HANDOFF_CANDIDATE as C,BOOKING_HANDOFF_APPLICATION as A} from './booking-handoff-policy.mjs';
const ROOT='/var/lib/faolla-booking-handoff/'+C+'/toolchain-admission/',REPO='/www/wwwroot/merchant-space',REMOTE='https://github.com/fafona/space.git';
const seal=(file,value)=>bookingHostWriteOnce(file,canonicalJson(value)+'\n');
const same=(a,b)=>need(canonicalJson(a)===canonicalJson(b),'observation_mismatch');
export function backupProducerGitPlan({revision,producer}){
 need(/^[a-f0-9]{40}$/.test(revision??'')&&typeof producer==='string'&&producer.startsWith(ROOT)&&/^\d{13}-[a-f0-9-]{36}\/producer-source$/.test(producer.slice(ROOT.length)),'invalid_path');
 return [
  {cwd:path.dirname(producer),args:['clone','--shared','--no-hardlinks','--no-checkout',REPO,producer]},
  {cwd:producer,args:['remote','set-url','origin',REMOTE]},
  // This really fetches current main into the NEW repository; no fabricated
  // ref response, origin/main override or formal-repository fetch is used.
  {cwd:producer,args:['fetch','--no-tags','origin','main:refs/remotes/origin/main']},
  {cwd:producer,args:['sparse-checkout','set','--no-cone','--stdin'],input:'/*\n!/public/downloads/\n'},
  {cwd:producer,args:['checkout','--detach',revision]},
 ];
}
const BACKUP_FAILURE_CODES=new Set(['backup_source_sha_mismatch','backup_source_origin_main_mismatch','backup_source_not_detached','backup_source_repository_mismatch','backup_source_worktree_dirty','self_hosted_topology_unavailable','database_container_unavailable','file_storage_container_unavailable','storage_persistent_mount_unavailable','backup_already_running','database_identity_probe_invalid','database_dump_failed','postgres_config_backup_failed','storage_backup_failed','supabase_config_backup_failed','app_config_backup_failed','database_identity_changed_during_backup','backup_source_changed_during_backup','database_backup_failed','manifest_source_identity_invalid','manifest_recovery_content_invalid']);
export function backupProducerFailure(error,site){
 need(['source','create','verify','binding'].includes(site),'invalid_contract');let code='operation_unconfirmed';
 try{const d=Object.getOwnPropertyDescriptor(error,'code');if(d&&Object.hasOwn(d,'value')&&BACKUP_FAILURE_CODES.has(d.value))code=d.value;}catch{}
 return {kind:'release-toolchain-backup-producer-failure',site,code,detailsRedacted:true};
}
export function assertProducerApplicationBackupBinding({toolRevision,producer,application,applicationBuilds,backup,payloadEnvironmentSha256}){
 assertApplication(application);need(/^[a-f0-9]{40}$/.test(toolRevision??'')&&/^[a-f0-9]{64}$/.test(producer?.inventorySha256??'')&&/^[a-f0-9]{64}$/.test(backup?.archiveSha256??''),'invalid_contract');
 need(producer.revision===toolRevision&&producer.originMainSha===toolRevision&&backup.source.sha===toolRevision&&backup.source.originMainSha===toolRevision&&backup.source.repository==='fafona/space','backup_source_mismatch');
 same(Object.keys(applicationBuilds).sort(),[C,A].sort());need(applicationBuilds[A]?.target===A,'build_binding_mismatch');
 need(application.revision===C&&applicationBuilds[C]?.target===C&&payloadEnvironmentSha256===applicationBuilds[C].environmentSha256&&/^[a-f0-9]{64}$/.test(payloadEnvironmentSha256),'build_binding_mismatch');
 return {kind:'release-toolchain-backup-producer-application-binding',producer,application,applicationBuilds,payloadEnvironmentSha256,
  archive:{schemaVersion:1,algorithm:'sha256',domain:'backup-archive',representation:'bytes-v1',value:backup.archiveSha256}};
}
export function backupPassphraseFileText(passphrase){need(typeof passphrase==='string'&&/^[A-Za-z0-9_-]{64}$/.test(passphrase),'invalid_contract');return passphrase+'\n';}
export async function createReviewedBookingBackup({lock,toolRevision,directory}){
 assertOnlineRetentionHeldLocks(lock);const authority=reviewedBookingExecution(toolRevision);need(authority,'source_changed');ownedReleasePath(directory,{directory:true,privateMode:true});
 const producerDirectory=directory+'/producer-source',plan=backupProducerGitPlan({revision:toolRevision,producer:producerDirectory}),backupPath=directory+'/database.tar.enc',appDirectory='/www/wwwroot/merchant-space.web-releases/'+C.slice(0,12)+'-online';let site='source';
 try{
  for(const step of plan){assertOnlineRetentionHeldLocks(lock);reviewedBookingExecution(toolRevision);sourceGit(step.cwd,step.args,step.input);}
  fs.chmodSync(producerDirectory,0o700);
  const observe=()=>{const actual=inspectOwnedDetachedSource({revision:toolRevision,directory:producerDirectory,repository:producerDirectory});same(actual.inventorySha256,authority.tool.inventorySha256);
   const originMainSha=sourceGit(producerDirectory,['rev-parse','refs/remotes/origin/main']).toString().trim();need(originMainSha===toolRevision,'source_changed');
   need(sourceGit(producerDirectory,['config','--get','remote.origin.url']).toString().trim()===REMOTE,'source_changed');return {revision:toolRevision,directory:producerDirectory,originMainSha,inventorySha256:actual.inventorySha256};};
  const producer=observe();seal(directory+'/backup-producer-source.json',producer);site='create';
  const passphrase=randomBytes(48).toString('base64url');bookingHostWriteOnce(directory+'/backup.key',backupPassphraseFileText(passphrase));
  const created=await createProductionDatabaseBackup({outputPath:backupPath,passphrase,appDirectory,sourceDirectory:producerDirectory,sourceRepository:'fafona/space',sourceSha:toolRevision,
   env:{...process.env,FAOLLA_DATABASE_CONTAINER:'supabase-db',FAOLLA_STORAGE_CONTAINER:'supabase-storage'}});seal(directory+'/backup-create.json',created);
  site='verify';const verified=await withVerifiedProductionDatabaseBackup({inputPath:backupPath,passphrase,onVerified:({directory:extracted})=>{
   // Read secret bytes only into the hash; never log or persist their content.
   const bytes=bookingHostRun('tar',['-xOzf',extracted+'/app-config.tar.gz','.env.local'],{encoding:null,maxBuffer:1024**2});return sha256(bytes);
  }});seal(directory+'/backup-verify.json',verified.report);site='binding';
  const backup=await validateAttendanceBackupEvidence({target:toolRevision,backup:backupPath,createReport:directory+'/backup-create.json',verifyReport:directory+'/backup-verify.json'});
  same(observe(),producer);need(sha256(bookingHostRead(appDirectory+'/.env.local',{binary:true}))===verified.callbackResult,'build_binding_mismatch');
  const binding=assertProducerApplicationBackupBinding({toolRevision,producer,application:authority.application,applicationBuilds:authority.prepared.application,backup,payloadEnvironmentSha256:verified.callbackResult});
  seal(directory+'/backup-application-binding.json',binding);assertOnlineRetentionHeldLocks(lock);reviewedBookingExecution(toolRevision);return {backup,binding};
 }catch(error){const failure=backupProducerFailure(error,site);seal(directory+'/backup-producer-failure.json',{...failure,at:new Date().toISOString()});if(failure.code==='backup_source_origin_main_mismatch')throw new ToolchainError('backup_source_mismatch');throw error;}
}
