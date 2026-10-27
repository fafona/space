// One approved already-built successor. The shared DR generator and validator
// keep their current-main-only contract. This independent binding proves which
// unchanged application build that real tool-source backup protects.
import * as fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {BOOKING_HANDOFF_CANDIDATE as C,BOOKING_HANDOFF_BASELINE as B} from './booking-handoff-policy.mjs';
import {BOOKING_BUILT_SMOKE_PINS as P} from './booking-built-smoke-repair-policy.mjs';
import {BOOKING_REGISTRY_RECEIPT,BOOKING_REGISTRY_ORIGINAL_TOOL} from './booking-registry-tool-policy.mjs';
import {assertBookingRegistryToolSource} from './booking-registry-tool.mjs';
import {attendanceRepairTreeFingerprint as tree} from './attendance-staged-tool-repair.mjs';
import {validateAttendanceBackupEvidence} from './attendance-production-database-migrations.mjs';
import {assertOnlineToolOwnedPath,runOnlineToolGit} from './prepare-online-release-tool.mjs';
import {assertOnlineRetentionHeldLocks} from './online-release-retention-writer.mjs';
const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url))),APP='/www/wwwroot/merchant-space';
const OP='/var/lib/faolla-online-release/'+C,FILE=OP+'/booking-registry-backup-binding.json';
const input=()=>({target:C,backup:OP+'/database.tar.enc',createReport:OP+'/backup-create.json',verifyReport:OP+'/backup-verify.json'});
const hash=x=>createHash('sha256').update(x).digest('hex');
const need=(v,c)=>{if(!v)throw Error('booking_registry_backup_'+c);};
const same=(a,b,c)=>need(isDeepStrictEqual(a,b),c);
function read(file,{privateMode=true}={}){
 assertOnlineToolOwnedPath(file,'file');const before=fs.lstatSync(file);
 need(before.nlink===1&&before.size>0&&before.size<=256*1024**2&&(!privateMode||(before.mode&0o777)===0o600),'file');
 const id=s=>['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'].map(k=>s[k]);
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{
  same(id(fs.fstatSync(fd)),id(before),'file_replaced');const bytes=fs.readFileSync(fd);
  same(id(fs.fstatSync(fd)),id(before),'file_changed');same(id(fs.lstatSync(file)),id(before),'file_changed');return bytes;
 }finally{fs.closeSync(fd);}
}
function observe(){
 const toolRevision=path.basename(ROOT);need(process.platform==='linux'&&process.getuid?.()===0&&ROOT==='/var/lib/faolla-online-code/'+toolRevision,'invocation');
 const source=assertBookingRegistryToolSource(toolRevision),pin=P.pair.find(p=>p.target===C),directory=APP+'.web-releases/'+C.slice(0,12)+'-online';
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
 return {candidate:C,baseline:B,toolRevision,...source,registryToolReceiptSha256:hash(read(OP+'/'+BOOKING_REGISTRY_RECEIPT)),
  application:{target:C,tree:git(['rev-parse','HEAD^{tree}']),originalBuildTool:BOOKING_REGISTRY_ORIGINAL_TOOL,
   buildProofSha256:pin.files['attendance-build-proof.json'],environmentSha256:pin.envSha256,dependenciesSha256:pin.dependencies.sha256,builtOutputSha256:pin.built.sha256},
  createReportSha256:hash(read(input().createReport)),verifyReportSha256:hash(read(input().verifyReport))};
}
export function assertBookingRegistryBackupBinding(value,observed,backup){
 same(value,{schemaVersion:1,kind:'booking-registry-backup-binding',...observed,backup,completedAt:value?.completedAt},'binding');
 need(typeof value.completedAt==='string'&&Number.isFinite(Date.parse(value.completedAt))&&Date.parse(value.completedAt)>=Date.parse(backup.createdAt)&&
  Date.parse(value.completedAt)<=Date.now()+60000,'timestamp');return true;
}
export async function sealBookingRegistryBackupBinding(options){
 need(arguments.length===1&&options&&Object.keys(options).join(',')==='lock','arguments');assertOnlineRetentionHeldLocks(options.lock);const before=observe();
 const backup=await validateAttendanceBackupEvidence({...input(),target:before.toolRevision});
 same(observe(),before,'source_changed');
 const value={schemaVersion:1,kind:'booking-registry-backup-binding',...before,backup,completedAt:new Date().toISOString()};
 assertBookingRegistryBackupBinding(value,before,backup);assertOnlineToolOwnedPath(OP);need((fs.lstatSync(OP).mode&0o777)===0o700,'private_parent');
 assertOnlineRetentionHeldLocks(options.lock);const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n'),fd=fs.openSync(FILE,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const parent=fs.openSync(OP,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
 same(read(FILE),bytes,'seal');return {kind:value.kind,candidate:C,toolRevision:before.toolRevision,archiveSha256:backup.archiveSha256};
}
export async function validateBookingPublicationBackupEvidence(request){
 // Old callers and old lanes retain their exact shared validation. A missing,
 // invalid or changed binding can never become a permissive source-SHA option.
 if(request?.target!==C||!fs.existsSync(FILE))return validateAttendanceBackupEvidence(request);
 same(request,input(),'scope');const observed=observe(),value=JSON.parse(read(FILE));
 const backup=await validateAttendanceBackupEvidence({...request,target:observed.toolRevision});
 assertBookingRegistryBackupBinding(value,observed,backup);same(observe(),observed,'source_changed');return backup;
}
