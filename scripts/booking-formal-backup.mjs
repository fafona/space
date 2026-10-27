// One approved continuation after a rejected pilot backup. Original files and
// successful compatibility evidence stay in place. Shared DR code is unchanged.
import * as fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {BOOKING_HANDOFF_CANDIDATE as C,BOOKING_HANDOFF_BASELINE as B} from './booking-handoff-policy.mjs';
import {BOOKING_BUILT_SMOKE_PINS as P} from './booking-built-smoke-repair-policy.mjs';
import {BOOKING_FORMAL_DIRECTORY,BOOKING_FORMAL_RECEIPT,BOOKING_FORMAL_PILOT_IDS} from './booking-formal-backup-policy.mjs';
import {BOOKING_REGISTRY_ORIGINAL_TOOL} from './booking-registry-tool-policy.mjs';
import {readBookingFormalFile as read,assertBookingFormalPreserved,assertBookingFormalToolSource,assertBookingFormalContinuation} from './booking-formal-backup-tool.mjs';
import {attendanceRepairTreeFingerprint as tree} from './attendance-staged-tool-repair.mjs';
import {attendanceProductionIdentity as production,loadAttendanceProductionScope,validateAttendanceBackupEvidence} from './attendance-production-database-migrations.mjs';
import {attendanceCompatibilityMetadataContractSql} from './attendance-production-052-compatibility.mjs';
import {BOOKING_MIGRATIONS,bookingDatabaseStateSql,validateBookingDatabaseState,assertBookingCompatibilityProof} from './booking-publication-database.mjs';
import {validateBookingPublicationBackupEvidence as validatePriorBackup} from './booking-registry-backup.mjs';
import {createProductionDatabaseBackup} from './create-production-database-backup.mjs';
import {verifyProductionDatabaseBackup} from './verify-production-database-backup.mjs';
import {runMigrationCommand} from './apply-production-database-migrations.mjs';
import {assertOnlineToolOwnedPath,runOnlineToolGit} from './prepare-online-release-tool.mjs';
import {assertOnlineRetentionHeldLocks} from './online-release-retention-writer.mjs';
const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url))),APP='/www/wwwroot/merchant-space';
const OP='/var/lib/faolla-online-release/'+C,DIR=OP+'/'+BOOKING_FORMAL_DIRECTORY,FILE=DIR+'/application-binding.json';
const need=(v,c)=>{if(!v)throw Error('booking_formal_backup_'+c);};
const hash=x=>createHash('sha256').update(x).digest('hex');
const same=(a,b,c)=>need(isDeepStrictEqual(a,b),c);
export function bookingPublicationBackupRequest(target,operation){
 const directory=target===C&&operation===OP?DIR:operation;
 return {target,backup:directory+'/database.tar.enc',createReport:directory+'/backup-create.json',verifyReport:directory+'/backup-verify.json'};
}
const input=()=>bookingPublicationBackupRequest(C,OP);
function observe(){
 const toolRevision=path.basename(ROOT);need(process.platform==='linux'&&process.getuid?.()===0&&ROOT==='/var/lib/faolla-online-code/'+toolRevision,'invocation');
 const source=assertBookingFormalToolSource(toolRevision),preservedSha256=assertBookingFormalPreserved(),pin=P.pair.find(p=>p.target===C),directory=APP+'.web-releases/'+C.slice(0,12)+'-online';
 const git=args=>runOnlineToolGit(directory,args).toString().trim();
 need(git(['rev-parse','HEAD'])===C&&!git(['status','--porcelain=v1','--untracked-files=all']),'application_source');
 for(const row of runOnlineToolGit(APP,['ls-tree','-r','-z',C]).toString().split('\0').filter(Boolean)){
  const m=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(row);need(m&&!m[3].split('/').some(p=>['','..','.'].includes(p)),'source_entry');
  const bytes=read(directory+'/'+m[3],{privateMode:false});need(createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')===m[2],'application_blob');
 }
 for(const [name,digest]of Object.entries(pin.files))need(hash(read(OP+'/'+(name==='state.json'?'built-smoke-original-state.json':name)))===digest,'application_proof');
 need(hash(read(directory+'/.env.local'))===pin.envSha256,'application_environment');
 same(tree(directory+'/node_modules',{allowInternalLinks:true}),pin.dependencies,'application_dependencies');
 same(tree(directory+'/.next',{exclude:['cache','trace']}),pin.built,'application_build');
 return {candidate:C,baseline:B,toolRevision,...source,preservedSha256,toolReceiptSha256:hash(read(OP+'/'+BOOKING_FORMAL_RECEIPT)),
  application:{target:C,tree:git(['rev-parse','HEAD^{tree}']),originalBuildTool:BOOKING_REGISTRY_ORIGINAL_TOOL,
   buildProofSha256:pin.files['attendance-build-proof.json'],environmentSha256:pin.envSha256,dependenciesSha256:pin.dependencies.sha256,builtOutputSha256:pin.built.sha256},
  compatibilitySha256:hash(read(OP+'/booking-compatibility.json')),compatibilityEvidenceSha256:hash(read(OP+'/booking-compatibility-evidence.json'))};
}
function write(file,value){
 assertOnlineToolOwnedPath(path.dirname(file));need((fs.lstatSync(path.dirname(file)).mode&0o777)===0o700,'private_parent');
 const bytes=Buffer.from(typeof value==='string'?value:JSON.stringify(value,null,2)+'\n'),fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const parent=fs.openSync(path.dirname(file),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}same(read(file),bytes,'seal');
}
async function command(args,sql){
 const r=await runMigrationCommand('docker',args,{input:sql,timeoutMs:30000,outputLimitBytes:4*1024**2});
 need(r.status===0&&!r.timedOut,'command_unconfirmed');return String(r.stdout??'').trim();
}
async function query(sql){
 return command(['exec','-i',production.containerId,'sh','-lc','set -eu; export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql -h 127.0.0.1 -U supabase_admin -d postgres --no-password --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1 --set=VERBOSITY=sqlstate'],sql);
}
export function assertBookingFormalDatabaseSelection({container,state,pilots,metadataContractSha256,expectedMetadataContractSha256}){
 need(container?.id===production.containerId&&container.name==='/'+production.containerName&&container.running===true&&
  container.mounts?.some(m=>m.Type==='bind'&&m.Source===production.dataSource&&m.RW===true),'database_container');
 for(const key of ['databaseName','databaseOid','systemIdentifier','serverVersionNum'])need(state?.[key]===production[key],'database_identity');
 need(Array.isArray(pilots)&&isDeepStrictEqual(pilots.map(p=>p.id).sort(),[...BOOKING_FORMAL_PILOT_IDS].sort())&&pilots.every(p=>p.running===false),'pilots_not_stopped');
 need(/^[a-f0-9]{64}$/.test(metadataContractSha256??'')&&metadataContractSha256===expectedMetadataContractSha256,'compatibility_metadata_changed');return true;
}
async function formalBeforeBackup(){
 const container=JSON.parse(await command(['inspect','--format','{"id":{{json .Id}},"name":{{json .Name}},"running":{{json .State.Running}},"mounts":{{json .Mounts}}}',production.containerId]));
 container.mounts.sort((a,b)=>a.Destination.localeCompare(b.Destination)||a.Source.localeCompare(b.Source));
 const ids=(await command(['ps','-aq','--no-trunc','--filter','label=com.docker.compose.project=faolla-attendance-pilot'])).split('\n').filter(Boolean).sort();same(ids,[...BOOKING_FORMAL_PILOT_IDS].sort(),'pilot_set');
 const pilots=[];for(const id of ids)pilots.push(JSON.parse(await command(['inspect','--format','{"id":{{json .Id}},"running":{{json .State.Running}}}',id])));
 const rootDir=APP+'.web-releases/'+C.slice(0,12)+'-online',{manifest}=await loadAttendanceProductionScope({rootDir});
 const state=validateBookingDatabaseState(JSON.parse(await query(bookingDatabaseStateSql)),manifest);
 const sourceSha256=BOOKING_MIGRATIONS.map(m=>hash(read(rootDir+'/scripts/supabase-migrations/'+m.fileName,{privateMode:false})));
 const proof=JSON.parse(read(OP+'/booking-compatibility.json')),evidence=JSON.parse(read(OP+'/booking-compatibility-evidence.json'));
 assertBookingCompatibilityProof(proof,{target:C,baseline:B,sourceSha256});need(hash(read(OP+'/booking-compatibility-evidence.json'))===proof.evidenceSha256,'compatibility_evidence');
 const metadataContractSha256=JSON.parse(await query(attendanceCompatibilityMetadataContractSql()));
 const facts={container,state,pilots,metadataContractSha256,expectedMetadataContractSha256:evidence.contractSha256};assertBookingFormalDatabaseSelection(facts);return facts;
}
export function assertBookingFormalBackupBinding(value,observed,backup){
 same(value,{schemaVersion:1,kind:'booking-formal-backup-binding',...observed,backup,completedAt:value?.completedAt},'binding');
 need(typeof value.completedAt==='string'&&Number.isFinite(Date.parse(value.completedAt))&&Date.parse(value.completedAt)>=Date.parse(backup.createdAt)&&
  Date.parse(value.completedAt)<=Date.now()+60000,'timestamp');return true;
}
export async function runBookingFormalBackup(options){
 need(arguments.length===1&&options&&Object.keys(options).join(',')==='lock','arguments');assertOnlineRetentionHeldLocks(options.lock);
 const before=observe();assertBookingFormalContinuation({toolRevision:before.toolRevision});const formal=await formalBeforeBackup();
 for(const name of ['booking-install-attempt.json','booking-database-inactive.json','booking-registry-backup-binding.json'])need(!fs.existsSync(OP+'/'+name),'existing_install');
 // mkdir without recursive is exclusive: a partial/failed attempt is retained,
 // never overwritten or silently replayed.
 assertOnlineToolOwnedPath(OP);fs.mkdirSync(DIR,{mode:0o700});assertOnlineToolOwnedPath(DIR);need((fs.lstatSync(DIR).mode&0o777)===0o700,'private_parent');
 write(DIR+'/attempt.json',{schemaVersion:1,kind:'booking-formal-backup-attempt',...before,formal,startedAt:new Date().toISOString()});
 const passphrase=randomBytes(48).toString('base64url');write(DIR+'/backup.key',passphrase);
 const state=JSON.parse(read(OP+'/state.json'));
 const backup=await createProductionDatabaseBackup({outputPath:input().backup,passphrase,appDirectory:state.oldDirectory,sourceDirectory:ROOT,
  sourceRepository:'fafona/space',sourceSha:before.toolRevision,env:{...process.env,FAOLLA_DATABASE_CONTAINER:production.containerName,FAOLLA_STORAGE_CONTAINER:'supabase-storage'}});
 write(input().createReport,backup);
 const checked=await verifyProductionDatabaseBackup({inputPath:input().backup,passphrase});write(input().verifyReport,checked);
 same(await formalBeforeBackup(),formal,'formal_changed');same(observe(),before,'source_changed');assertOnlineRetentionHeldLocks(options.lock);
 const verified=await validateAttendanceBackupEvidence({...input(),target:before.toolRevision});
 const observed={...before,attemptSha256:hash(read(DIR+'/attempt.json')),keySha256:hash(read(DIR+'/backup.key')),
  createReportSha256:hash(read(input().createReport)),verifyReportSha256:hash(read(input().verifyReport))};
 const binding={schemaVersion:1,kind:'booking-formal-backup-binding',...observed,backup:verified,completedAt:new Date().toISOString()};
 assertBookingFormalBackupBinding(binding,observed,verified);write(FILE,binding);same(observe(),before,'source_changed');
 return {kind:binding.kind,candidate:C,toolRevision:before.toolRevision,archiveSha256:verified.archiveSha256,formalDatabase:production.containerName};
}
export async function validateBookingPublicationBackupEvidence(request){
 if(request?.target!==C)return validatePriorBackup(request);
 same(request,input(),'scope');need(fs.existsSync(FILE),'binding_missing');const before=observe();
 const observed={...before,attemptSha256:hash(read(DIR+'/attempt.json')),keySha256:hash(read(DIR+'/backup.key')),
  createReportSha256:hash(read(input().createReport)),verifyReportSha256:hash(read(input().verifyReport))};
 const backup=await validateAttendanceBackupEvidence({...request,target:before.toolRevision});
 assertBookingFormalBackupBinding(JSON.parse(read(FILE)),observed,backup);same(observe(),before,'source_changed');return backup;
}
