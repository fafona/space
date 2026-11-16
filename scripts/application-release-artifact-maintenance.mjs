// Separately approved, one-target historical artifact maintenance. No process
// control, publication, database access or historical-state rewrite is exposed.
import * as fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {collectRemoteReleaseReview, assertReviewFresh, inspectPinnedExecutionSource, ownedReleasePath, sourceGit} from './release-toolchain-source.mjs';
import {observeReleaseResources} from './online-release-cache-cleanup.mjs';
import {readOnlineRetentionHistory} from './online-release-retention.mjs';
import {inspectOnlineRetentionWindow} from './online-release-retention-policy.mjs';
import {assertOnlineRetentionPersistedProcesses} from './online-release-retention-writer.mjs';
import {withOnlineToolPreparationLocks} from './prepare-online-release-tool.mjs';
import {assertNoRetiredArtifactReferences} from './online-release-artifact-cleanup.mjs';
import {buildRetiredBackupReplacement} from './online-release-artifact-policy.mjs';
import {captureRetiredArtifactTree, applyRetiredArtifactTree} from './online-release-artifact-tree.mjs';
import {assertArtifactMaintenanceScope, historicalArtifactContext, assertHistoricalStoppedDump,
  executeHistoricalArtifactMaintenance, maintenanceHash} from './application-release-artifact-maintenance-policy.mjs';

const APP='/www/wwwroot/merchant-space', AUDIT='/var/lib/faolla-historical-artifact-reclaim';
const ACTIVE='/var/lib/faolla-online-release/active.json', MAIN='/root/.pm2/dump.pm2', BACKUP=MAIN+'.bak';
const SHA=/^[a-f0-9]{40}$/, ID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/, HASH=/^[a-f0-9]{64}$/;
const need=(v,c)=>{if(!v)throw Error('artifact_maintenance_'+c);};
const same=(a,b,c)=>need(isDeepStrictEqual(a,b),c);
const json=v=>JSON.stringify(v,null,2)+'\n';
const read=(name,privateMode=true)=>{const s=ownedReleasePath(name,{privateMode});need(s.size>0&&s.size<=32*1024**2,'file_size');return fs.readFileSync(name);};
const parse=name=>JSON.parse(read(name));
const exists=name=>{try{fs.lstatSync(name);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const sync=name=>{const fd=fs.openSync(name,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
function write(name,bytes){
  ownedReleasePath(path.dirname(name),{directory:true,privateMode:true});
  const fd=fs.openSync(name,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}sync(path.dirname(name));same(read(name),Buffer.from(bytes),'write_readback');
}
function ensureAudit(){
  if(!exists(AUDIT)){ownedReleasePath('/var/lib',{directory:true});fs.mkdirSync(AUDIT,{mode:0o700});sync('/var/lib');}
  ownedReleasePath(AUDIT,{directory:true,privateMode:true});
}
function command(program,args){
  const r=spawnSync(program,args,{encoding:'utf8',env:{...process.env,PM2_HOME:'/root/.pm2'},timeout:60000,maxBuffer:32*1024**2});
  need(r.status===0&&!r.signal&&!r.error,'observation_command');return r.stdout;
}
function dump(name){return read(name,false);}
function disk(){const s=fs.statfsSync(APP);return {availableBytes:s.bavail*s.bsize};}
function ownSource(revision,activeTarget){
  const directory='/var/lib/faolla-online-code/'+revision;
  need(path.dirname(path.dirname(fileURLToPath(import.meta.url)))===directory,'source_path');
  const source=inspectPinnedExecutionSource({revision,directory});
  need(sourceGit(APP,['rev-parse','origin/main']).toString().trim()===revision,'main_changed');
  sourceGit(APP,['merge-base','--is-ancestor',activeTarget,revision]);
  const files=sourceGit(APP,['diff','--name-only',activeTarget,revision]).toString().trim().split('\n').filter(Boolean);
  assertArtifactMaintenanceScope(files);return source;
}
function snapshot(revision,victimTarget){
  const observation=observeReleaseResources(revision),history=readOnlineRetentionHistory(),active=parse(ACTIVE);
  const window=inspectOnlineRetentionWindow({history,actualActive:active,current:observation.pm2});
  const context=historicalArtifactContext({victimTarget,history,observation,active,window});
  return {observation,context,history};
}
function recovery(context,history,observation){
  const mainBytes=dump(MAIN),backupBytes=dump(BACKUP),main=JSON.parse(mainBytes),backup=JSON.parse(backupBytes);
  const live=JSON.parse(command('pm2',['jlist']));
  assertOnlineRetentionPersistedProcesses(live,main,{processes:observation.pm2});
  assertHistoricalStoppedDump(main,context);
  let effective=backup,expectedBackup=backupBytes,changed=false;
  try{assertHistoricalStoppedDump(backup,context);}catch{
    const latest=history.entries.at(-1);
    // Only the exact most recent original retirement may repair its own stale
    // backup row. Older online/recovery rows are blockers, never projected away.
    need(latest.kind==='retire'&&latest.victim?.target===context.victimTarget,'backup_not_stopped');
    const replacement=buildRetiredBackupReplacement({main,backup,certificate:latest});
    need(replacement.changed,'backup_not_stopped');effective=replacement.replacement;
    expectedBackup=Buffer.from(json(effective));changed=true;assertHistoricalStoppedDump(effective,context);
  }
  assertOnlineRetentionPersistedProcesses(live,effective,{processes:observation.pm2});
  const references={main,backup:effective,consumers:[...new Set(observation.pm2.filter(p=>p.status==='online').map(p=>p.cwd))]};
  assertNoRetiredArtifactReferences(context.directory,references);
  return {mainBytes,backupBytes,expectedBackup,changed,references};
}
export async function artifactMaintenanceMain(args=process.argv.slice(2)){
  const [action,revision,id,approvedHash,...extra]=args;
  need(process.platform==='linux'&&process.getuid?.()===0&&process.execPath==='/usr/bin/node'&&extra.length===0,'invocation');
  need(SHA.test(revision??'')&&['inspect','apply'].includes(action),'arguments');
  need(action==='inspect'?SHA.test(id??'')&&approvedHash===undefined:ID.test(id??'')&&HASH.test(approvedHash??''),'arguments');
  const source='/var/lib/faolla-online-code/'+revision;
  need(process.argv[1]===source+'/scripts/application-release-artifact-maintenance.mjs'&&process.cwd()===source,'entry');
  const review=await collectRemoteReleaseReview(revision);assertReviewFresh(review,revision);
  const active=parse(ACTIVE);ownSource(revision,active.target);
  // Use the actual published application's immutable independent auditor. This
  // source-only maintenance revision is never relabelled as a future app build.
  if(action==='inspect'){
    inspectPinnedExecutionSource({revision:active.target,directory:'/var/lib/faolla-online-code/'+active.target});
    const auditor=await import('file:///var/lib/faolla-online-code/'+active.target+'/scripts/application-release-audit.mjs');
    await auditor.observeApplicationRelease(active.target);
  }
  return withOnlineToolPreparationLocks({deployLock:APP+'.deploy.lock',maintenance:'/var/lib/faolla-maintenance/merchant-space'},()=>{
    assertReviewFresh(review,revision);ownSource(revision,active.target);same(parse(ACTIVE),active,'active_changed');
    ensureAudit();
    if(action==='inspect'){
      const {observation,context,history}=snapshot(revision,id),saved=recovery(context,history,observation);
      const tree=captureRetiredArtifactTree(context.directory,id);
      same(snapshot(revision,id).observation,observation,'observation_changed');
      same(dump(MAIN),saved.mainBytes,'main_changed');same(dump(BACKUP),saved.backupBytes,'backup_changed');
      const plan={version:1,kind:'historical-retired-artifact-maintenance-plan',toolRevision:revision,context,tree,observation,
        mainSha256:maintenanceHash(saved.mainBytes),backupSha256:maintenanceHash(saved.backupBytes),
        replacementSha256:maintenanceHash(saved.expectedBackup),backupRepair:saved.changed,createdAt:new Date().toISOString()};
      const planId=randomUUID(),location=AUDIT+'/'+planId;fs.mkdirSync(location,{mode:0o700});sync(AUDIT);
      const bytes=json(plan);write(location+'/plan.json',bytes);
      return {kind:plan.kind,planId,sha256:maintenanceHash(bytes),victimTarget:id,directory:context.directory,
        activeTarget:context.activeTarget,rollbackTarget:context.rollbackTarget,backupRepair:saved.changed,
        generatedAllocatedBytes:tree.generated.dependencies.allocatedBytes+(tree.generated.webpack?.allocatedBytes??0),deletedNothing:true};
    }
    const location=AUDIT+'/'+id;ownedReleasePath(location,{directory:true,privateMode:true});
    const bytes=read(location+'/plan.json');need(maintenanceHash(bytes)===approvedHash,'plan_hash');const plan=JSON.parse(bytes);
    need(plan.version===1&&plan.kind==='historical-retired-artifact-maintenance-plan'&&plan.toolRevision===revision&&SHA.test(plan.context?.victimTarget??''),'plan');
    const age=Date.now()-Date.parse(plan.createdAt);need(Number.isFinite(age)&&age>=0&&age<=86400000,'plan_age');
    same(fs.readdirSync(location),['plan.json'],'attempt_already_started');
    const before=snapshot(revision,plan.context.victimTarget);same(before.context,plan.context,'context_changed');
    same(before.observation,plan.observation,'observation_changed');
    const saved=recovery(before.context,before.history,before.observation);
    need(maintenanceHash(saved.mainBytes)===plan.mainSha256&&maintenanceHash(saved.backupBytes)===plan.backupSha256&&
      maintenanceHash(saved.expectedBackup)===plan.replacementSha256&&saved.changed===plan.backupRepair,'recovery_changed');
    same(captureRetiredArtifactTree(plan.context.directory,plan.context.victimTarget),plan.tree,'tree_changed');
    let repaired=false;const beforeDisk=disk();
    const verify=()=>{
      assertReviewFresh(review,revision);same(parse(ACTIVE),active,'active_changed');
      same(snapshot(revision,plan.context.victimTarget).observation,plan.observation,'observation_changed');
      same(dump(MAIN),saved.mainBytes,'main_changed');same(dump(BACKUP),repaired?saved.expectedBackup:saved.backupBytes,'backup_changed');
      assertNoRetiredArtifactReferences(plan.context.directory,saved.references);
    };
    const result=executeHistoricalArtifactMaintenance(plan,{
      verify,begin:()=>write(location+'/prepared.json',json({version:1,planSha256:approvedHash,beforeDisk,at:new Date().toISOString()})),
      preserve:()=>{write(location+'/original-dump.pm2',saved.mainBytes);write(location+'/original-dump.pm2.bak',saved.backupBytes);},
      repairBackup:()=>{
        if(saved.changed){
          same(dump(MAIN),saved.mainBytes,'main_changed');same(dump(BACKUP),saved.backupBytes,'backup_changed');
          const temporary=BACKUP+'.historical-'+id;
          // /root/.pm2 has the established owned-directory contract, not the
          // private evidence-directory contract; never chmod its existing files.
          ownedReleasePath(path.dirname(BACKUP),{directory:true});
          const fd=fs.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
          try{fs.writeFileSync(fd,saved.expectedBackup);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}sync(path.dirname(BACKUP));
          same(read(temporary),saved.expectedBackup,'backup_temp');
          same(dump(MAIN),saved.mainBytes,'main_changed');same(dump(BACKUP),saved.backupBytes,'backup_changed');
          fs.renameSync(temporary,BACKUP);sync(path.dirname(BACKUP));same(dump(BACKUP),saved.expectedBackup,'backup_repair');
        }
        repaired=true;write(location+'/backup-verified.json',json({changed:saved.changed,sha256:plan.replacementSha256}));
      },
      apply:applyRetiredArtifactTree,
      complete:result=>write(location+'/completed.json',json({version:1,kind:'historical-retired-artifact-maintenance-completed',
        planSha256:approvedHash,context:plan.context,result,beforeDisk,afterDisk:disk(),at:new Date().toISOString()})),
      failed:failure=>write(location+'/failed.json',json({...failure,planSha256:approvedHash,automaticRetryAllowed:false,at:new Date().toISOString()})),
    });
    return {status:'completed',planId:id,victimTarget:plan.context.victimTarget,activeTarget:plan.context.activeTarget,
      rollbackTarget:plan.context.rollbackTarget,removedAllocatedBytes:result.removedAllocatedBytes,beforeDisk,afterDisk:disk(),
      instantRollback:false,processesChanged:false,routesChanged:false,businessDataWritten:false};
  });
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  artifactMaintenanceMain().then(v=>console.log(json(v)),error=>{
    const prefix=String(error?.message??'').split(':')[0],known=new Set(['unsafe_owner_or_device','unsafe_type','unsafe_mode','external_hardlink',
      'worktree_dirty','source_blob_changed','source_mode_changed','unknown_extra_directory','unknown_extra_file','external_generated_symlink',
      'external_generated_symlink_chain','unexpected_runtime_link','unsafe_preserved_link','missing_required_recovery_file','missing_dependencies_or_already_reclaimed']);
    console.error(json({kind:'historical-artifact-maintenance-refused',code:/^artifact_maintenance_[a-z_]+$/.test(error?.message??'')
      ?error.message:known.has(prefix)?prefix:'artifact_maintenance_refused',errorSha256:maintenanceHash(String(error?.message)),automaticRetryAllowed:false}));
    process.exitCode=1;
  });
}
