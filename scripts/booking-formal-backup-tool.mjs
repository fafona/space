// Source-only preparation. No process signals, SQL, backup execution, old-file
// overwrite, cleanup or application rebuild is exposed by this entrypoint.
import * as fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {BOOKING_FORMAL_PRIOR_TOOL as PRIOR,BOOKING_FORMAL_RECEIPT as RECEIPT,BOOKING_FORMAL_FILES as ALLOWED,
 BOOKING_FORMAL_PRESERVED as PRESERVED,assertBookingFormalToolDelta,assertBookingFormalToolReceipt} from './booking-formal-backup-policy.mjs';
import {BOOKING_HANDOFF_CANDIDATE as C,assertBookingHandoffToolClosure} from './booking-handoff-policy.mjs';
import {BOOKING_REGISTRY_RECEIPT,BOOKING_REGISTRY_ORIGINAL_TOOL,assertBookingRegistryToolReceipt} from './booking-registry-tool-policy.mjs';
import {observeBookingRegistryContinuation} from './booking-registry-tool.mjs';
import {assertBookingRegistryToolNoPending} from './booking-handoff-pending.mjs';
import {verifyHistoricalOnlineTool} from './online-release-tool-retention.mjs';
import {createOnlineReleaseToolPlan,verifyOnlineReleaseTool,verifyOnlineToolBootstrap,executeOnlineReleaseToolPlan,
 assertOnlineToolOwnedPath,runOnlineToolGit,withOnlineToolPreparationLocks} from './prepare-online-release-tool.mjs';
const APP='/www/wwwroot/merchant-space',OP='/var/lib/faolla-online-release/'+C;
const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url))),SELF='scripts/booking-formal-backup-tool.mjs';
const need=(v,c)=>{if(!v)throw Error('booking_formal_backup_'+c);};
const hash=x=>createHash('sha256').update(x).digest('hex');
const same=(a,b,c)=>need(isDeepStrictEqual(a,b),c);
export function readBookingFormalFile(file,{privateMode=true}={}){
 assertOnlineToolOwnedPath(file,'file');const s=fs.lstatSync(file);
 need(s.nlink===1&&(s.size>0||!privateMode&&s.size===0)&&s.size<=256*1024**2&&(!privateMode||(s.mode&0o777)===0o600),'file');
 const id=x=>['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'].map(k=>x[k]);
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{
  same(id(fs.fstatSync(fd)),id(s),'file_replaced');const bytes=fs.readFileSync(fd);
  same(id(fs.fstatSync(fd)),id(s),'file_changed');same(id(fs.lstatSync(file)),id(s),'file_changed');need(bytes.length===s.size,'file_changed');return bytes;
 }finally{fs.closeSync(fd);}
}
// Stream the retained 549 MiB wrong archive; never load it into RAM or treat it
// as usable formal backup evidence. Exact length/digest and inode checks remain.
export function assertBookingFormalPreserved(){
 for(const [name,pin]of Object.entries(PRESERVED)){
  const file=OP+'/'+name;assertOnlineToolOwnedPath(file,'file');const s=fs.lstatSync(file);
  need(s.nlink===1&&(s.mode&0o777)===0o600&&s.size===pin.bytes,'preserved_file');
  const id=x=>['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'].map(k=>x[k]);
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW),digest=createHash('sha256'),buffer=Buffer.alloc(1024**2);let count=0;
  try{same(id(fs.fstatSync(fd)),id(s),'preserved_replaced');for(;;){const n=fs.readSync(fd,buffer,0,buffer.length,null);if(!n)break;count+=n;digest.update(buffer.subarray(0,n));}
   same(id(fs.fstatSync(fd)),id(s),'preserved_changed');same(id(fs.lstatSync(file)),id(s),'preserved_changed');need(count===pin.bytes&&digest.digest('hex')===pin.sha256,'preserved_digest');
  }finally{fs.closeSync(fd);}
 }
 assertBookingRegistryToolReceipt(JSON.parse(readBookingFormalFile(OP+'/'+BOOKING_REGISTRY_RECEIPT)),PRIOR);
 return hash(JSON.stringify(PRESERVED));
}
const git=(cwd,args)=>runOnlineToolGit(cwd,args).toString().trim();
const inputs=revision=>runOnlineToolGit(APP,['ls-tree','-r','-z',revision]).toString().split('\0').filter(Boolean)
 .filter(row=>!ALLOWED.includes(row.slice(row.indexOf('\t')+1))).join('\0');
export function bookingFormalToolImportClosure(readSource){
 const seen=new Set();function visit(file){if(seen.has(file))return;need(/^scripts\/[a-z0-9-]+\.mjs$/.test(file),'import_path');seen.add(file);
  for(const m of readSource(file).matchAll(/(?:^|(?<=[;\r\n]))\s*(?:import\s+(?:[^;]*?\s+from\s+)?|export\s+[^;]*?\s+from\s+)['"]([^'"]+)['"]\s*;?/gm)){
   if(m[1].startsWith('node:'))continue;need(m[1].startsWith('./'),'import_path');visit(path.posix.normalize(path.posix.join(path.posix.dirname(file),m[1])));
  }
 }visit(SELF);return [...seen].sort();
}
function verifySource(toolRevision,directory,{bootstrap=false}={}){
 need(process.platform==='linux'&&process.getuid?.()===0&&/^[a-f0-9]{40}$/.test(toolRevision??'')&&toolRevision!==PRIOR,'invocation');
 need(git(APP,['rev-parse','origin/main'])===toolRevision&&git(directory,['rev-parse','HEAD'])===toolRevision&&
  git(directory,['rev-parse','--abbrev-ref','HEAD'])==='HEAD'&&!git(directory,['status','--porcelain=v1','--untracked-files=all']),'source_identity');
 git(APP,['merge-base','--is-ancestor',PRIOR,toolRevision]);
 const changes=git(APP,['diff','--no-renames','--name-status',PRIOR,toolRevision]).split('\n').filter(Boolean).map(row=>{
  const [status,name,...extra]=row.split('\t');need(['M','A'].includes(status)&&!extra.length,'source_delta');return name;
 });
 const sourceInputsSha256=assertBookingFormalToolDelta({files:changes,originalInputs:inputs(PRIOR),currentInputs:inputs(toolRevision)});
 verifyHistoricalOnlineTool(createOnlineReleaseToolPlan(PRIOR),toolRevision);
 const plan=createOnlineReleaseToolPlan(toolRevision);verifyOnlineToolBootstrap(plan,directory+'/scripts/prepare-online-release-tool.mjs');
 if(bootstrap){
  need(directory==='/var/lib/faolla-online-bootstrap/'+toolRevision,'bootstrap_path');
  const files=bookingFormalToolImportClosure(f=>runOnlineToolGit(APP,['show',toolRevision+':'+f]).toString());
  const sparse=path.resolve(directory,git(directory,['rev-parse','--git-path','info/sparse-checkout']));
  need(readBookingFormalFile(sparse,{privateMode:false}).toString()===files.map(f=>'/'+f).join('\n')+'\n'&&
   git(directory,['config','--worktree','--get','core.sparseCheckout'])==='true'&&git(directory,['config','--worktree','--get','core.sparseCheckoutCone'])==='false'&&
   git(directory,['config','--worktree','--get','index.sparse'])==='false','bootstrap_sparse');
  const entries=new Set(['.git']);for(const f of files){same(readBookingFormalFile(directory+'/'+f,{privateMode:false}),runOnlineToolGit(APP,['show',toolRevision+':'+f]),'bootstrap_blob');
   const pieces=f.split('/');while(pieces.length){entries.add(pieces.join('/'));pieces.pop();}}
  function walk(dir,prefix=''){for(const e of fs.readdirSync(dir,{withFileTypes:true})){need(entries.has(prefix+e.name)&&!e.isSymbolicLink(),'bootstrap_entry');assertOnlineToolOwnedPath(dir+'/'+e.name,e.isDirectory()?'directory':'file');if(e.isDirectory())walk(dir+'/'+e.name,prefix+e.name+'/');}}walk(directory);
 }else{need(directory==='/var/lib/faolla-online-code/'+toolRevision,'tool_path');verifyOnlineReleaseTool(plan);}
 const files=git(APP,['diff','--name-only',C,toolRevision]).split('\n');
 return {sourceInputsSha256,toolClosureSha256:assertBookingHandoffToolClosure({baseline:C,files,readBlob:f=>runOnlineToolGit(APP,['show',toolRevision+':'+f])})};
}
export function observeBookingFormalContinuation(phase='staged'){
 const pair=observeBookingRegistryContinuation(phase),preservedSha256=assertBookingFormalPreserved();return {...pair,formalPreservedSha256:preservedSha256};
}
export function assertBookingFormalToolSource(toolRevision){
 const source=verifySource(toolRevision,ROOT),receipt=JSON.parse(readBookingFormalFile(OP+'/'+RECEIPT));assertBookingFormalToolReceipt(receipt,toolRevision);
 same(source,{sourceInputsSha256:receipt.sourceInputsSha256,toolClosureSha256:receipt.toolClosureSha256},'receipt_source');return source;
}
export function assertBookingFormalContinuation({toolRevision,phase='staged'}){
 assertBookingFormalToolSource(toolRevision);return observeBookingFormalContinuation(phase);
}
export function assertBookingFormalRuntimeContinuation({toolRevision,primary,rollback}){
 assertBookingFormalContinuation({toolRevision,phase:'database-ready'});
 need(primary.bookingReviewedStage?.toolRevision===BOOKING_REGISTRY_ORIGINAL_TOOL&&primary.bookingReviewedStage.toolClosureSha256==='1660fac7e48e5e18d11b439f01626d8f0823afebfb1eed00035cbef51caf65fa'&&rollback.toolRevision===BOOKING_REGISTRY_ORIGINAL_TOOL,'original_build_tool');return BOOKING_REGISTRY_ORIGINAL_TOOL;
}
function seal(value){
 assertOnlineToolOwnedPath(OP);need((fs.lstatSync(OP).mode&0o777)===0o700,'private_parent');
 const file=OP+'/'+RECEIPT,bytes=Buffer.from(JSON.stringify(value,null,2)+'\n'),fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const parent=fs.openSync(OP,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}same(readBookingFormalFile(file),bytes,'seal');
}
export function prepareBookingFormalTool(toolRevision,confirmation){
 need(confirmation==='approved-booking-formal-backup-continuation','approval');const source=verifySource(toolRevision,ROOT,{bootstrap:true});
 return withOnlineToolPreparationLocks({deployLock:APP+'.deploy.lock',maintenance:'/var/lib/faolla-maintenance/merchant-space'},()=>{
  same(verifySource(toolRevision,ROOT,{bootstrap:true}),source,'source_changed');const before=observeBookingFormalContinuation();assertBookingRegistryToolNoPending();
  try{fs.lstatSync(OP+'/'+RECEIPT);need(false,'existing_attempt');}catch(e){if(e.code!=='ENOENT')throw e;}
  const receipt={schemaVersion:1,kind:'booking-formal-backup-tool',priorTool:PRIOR,toolRevision,...source,preservedSha256:before.formalPreservedSha256,preparedAt:new Date().toISOString()};
  assertBookingFormalToolReceipt(receipt,toolRevision);const mask=process.umask(0o077);let prepared;
  try{prepared=executeOnlineReleaseToolPlan(createOnlineReleaseToolPlan(toolRevision));}finally{process.umask(mask);}
  same(verifySource(toolRevision,prepared.directory),source,'prepared_source');same(observeBookingFormalContinuation(),before,'before_after_changed');assertBookingRegistryToolNoPending();
  seal(receipt);same(observeBookingFormalContinuation(),before,'after_seal_changed');
  return {kind:'booking-formal-backup-tool-prepared',toolRevision,applicationRebuilt:false,productionDatabaseChanged:false,trafficChanged:false};
 });
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{
 need(process.argv.length===5&&process.argv[2]==='prepare','arguments');console.log(JSON.stringify(prepareBookingFormalTool(process.argv[3],process.argv[4])));
}catch(e){console.error(/^booking_formal_backup_[a-z_]+$/.test(e.message)?e.message:'booking_formal_backup_unverified');process.exitCode=1;}}
