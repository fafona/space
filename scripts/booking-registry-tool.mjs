// Source-only successor preparation + read-only continuity. No build, SQL,
// process, traffic, cleanup or historical receipt mutation is exposed here.
import * as fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {BOOKING_REGISTRY_PRIOR_TOOL as PRIOR,BOOKING_REGISTRY_ORIGINAL_TOOL as ORIGINAL,
 BOOKING_REGISTRY_RECEIPT as RECEIPT,BOOKING_REGISTRY_PRESERVED as PRESERVED,BOOKING_REGISTRY_TOOL_FILES as ALLOWED,
 BOOKING_REGISTRY_STAGED_SHA256,assertBookingRegistryToolDelta,assertBookingRegistryToolReceipt} from './booking-registry-tool-policy.mjs';
import {BOOKING_HANDOFF_CANDIDATE as C,assertBookingHandoffToolClosure} from './booking-handoff-policy.mjs';
import {BOOKING_COMPATIBILITY_PRIOR_TOOL as SMOKE,BOOKING_COMPATIBILITY_RECEIPT,assertBookingCompatibilityToolReceipt} from './booking-compatibility-tool-policy.mjs';
import {observeBookingCompatibilityContinuation} from './booking-compatibility-tool.mjs';
import {assertBookingRegistryToolNoPending} from './booking-handoff-pending.mjs';
import {verifyHistoricalOnlineTool} from './online-release-tool-retention.mjs';
import {createOnlineReleaseToolPlan,verifyOnlineReleaseTool,verifyOnlineToolBootstrap,executeOnlineReleaseToolPlan,
 assertOnlineToolOwnedPath,runOnlineToolGit,withOnlineToolPreparationLocks} from './prepare-online-release-tool.mjs';
const APP='/www/wwwroot/merchant-space',OP='/var/lib/faolla-online-release/'+C;
const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url))),SELF='scripts/booking-registry-tool.mjs';
const need=(v,c)=>{if(!v)throw Error('booking_registry_tool_'+c);};
const hash=x=>createHash('sha256').update(x).digest('hex');
const same=(a,b,c)=>need(isDeepStrictEqual(a,b),c);
function read(file,{privateMode=true}={}){
 assertOnlineToolOwnedPath(file,'file');const s=fs.lstatSync(file);
 need(s.nlink===1&&s.size>0&&s.size<=256*1024**2&&(!privateMode||(s.mode&0o777)===0o600),'file');
 const identity=x=>['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'].map(k=>x[k]);
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{
  same(identity(fs.fstatSync(fd)),identity(s),'file_replaced');const bytes=fs.readFileSync(fd);
  same(identity(fs.fstatSync(fd)),identity(s),'file_changed');same(identity(fs.lstatSync(file)),identity(s),'file_changed');need(bytes.length===s.size,'file_changed');return bytes;
 }finally{fs.closeSync(fd);}
}
const git=(cwd,args)=>runOnlineToolGit(cwd,args).toString().trim();
const sourceInputs=revision=>runOnlineToolGit(APP,['ls-tree','-r','-z',revision]).toString().split('\0').filter(Boolean)
 .filter(row=>!ALLOWED.includes(row.slice(row.indexOf('\t')+1))).join('\0');
export function bookingRegistryToolImportClosure(readSource){
 const seen=new Set();function visit(file){if(seen.has(file))return;need(/^scripts\/[a-z0-9-]+\.mjs$/.test(file),'import_path');seen.add(file);
  for(const match of readSource(file).matchAll(/(?:^|(?<=[;\r\n]))\s*(?:import\s+(?:[^;]*?\s+from\s+)?|export\s+[^;]*?\s+from\s+)['"]([^'"]+)['"]\s*;?/gm)){
   if(match[1].startsWith('node:'))continue;need(match[1].startsWith('./'),'import_path');visit(path.posix.normalize(path.posix.join(path.posix.dirname(file),match[1])));
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
 const sourceInputsSha256=assertBookingRegistryToolDelta({files:changes,originalInputs:sourceInputs(PRIOR),currentInputs:sourceInputs(toolRevision)});
 // Verify the complete immutable predecessor, not a rewritten old receipt.
 verifyHistoricalOnlineTool(createOnlineReleaseToolPlan(PRIOR),toolRevision);
 verifyHistoricalOnlineTool(createOnlineReleaseToolPlan(SMOKE),toolRevision);
 const plan=createOnlineReleaseToolPlan(toolRevision);verifyOnlineToolBootstrap(plan,directory+'/scripts/prepare-online-release-tool.mjs');
 if(bootstrap){
  need(directory==='/var/lib/faolla-online-bootstrap/'+toolRevision,'bootstrap_path');
  const files=bookingRegistryToolImportClosure(f=>runOnlineToolGit(APP,['show',toolRevision+':'+f]).toString());
  const sparse=path.resolve(directory,git(directory,['rev-parse','--git-path','info/sparse-checkout']));
  need(read(sparse,{privateMode:false}).toString()===files.map(f=>'/'+f).join('\n')+'\n'&&
   git(directory,['config','--worktree','--get','core.sparseCheckout'])==='true'&&git(directory,['config','--worktree','--get','core.sparseCheckoutCone'])==='false'&&
   git(directory,['config','--worktree','--get','index.sparse'])==='false','bootstrap_sparse');
  const entries=new Set(['.git']);for(const f of files){same(read(directory+'/'+f,{privateMode:false}),runOnlineToolGit(APP,['show',toolRevision+':'+f]),'bootstrap_blob');
   const pieces=f.split('/');while(pieces.length){entries.add(pieces.join('/'));pieces.pop();}}
  function walk(dir,prefix=''){for(const e of fs.readdirSync(dir,{withFileTypes:true})){need(entries.has(prefix+e.name)&&!e.isSymbolicLink(),'bootstrap_entry');assertOnlineToolOwnedPath(dir+'/'+e.name,e.isDirectory()?'directory':'file');if(e.isDirectory())walk(dir+'/'+e.name,prefix+e.name+'/');}}walk(directory);
 }else{need(directory==='/var/lib/faolla-online-code/'+toolRevision,'tool_path');verifyOnlineReleaseTool(plan);}
 const files=git(APP,['diff','--name-only',C,toolRevision]).split('\n');
 return {sourceInputsSha256,toolClosureSha256:assertBookingHandoffToolClosure({baseline:C,files,readBlob:f=>runOnlineToolGit(APP,['show',toolRevision+':'+f])})};
}
export function observeBookingRegistryContinuation(phase='staged'){
 need(['staged','database-ready'].includes(phase),'phase');
 const pair=observeBookingCompatibilityContinuation(phase);
 for(const [file,digest]of Object.entries(PRESERVED))need(hash(read(OP+'/'+file))===digest,'preserved_evidence');
 assertBookingCompatibilityToolReceipt(JSON.parse(read(OP+'/'+BOOKING_COMPATIBILITY_RECEIPT)),PRIOR);
 if(phase==='staged')need(hash(read(OP+'/state.json'))===BOOKING_REGISTRY_STAGED_SHA256,'staged_state');
 else need(hash(read(OP+'/booking-database-inactive.json'))===JSON.parse(read(OP+'/state.json')).bookingDatabaseProofSha256,'database_proof');
 const failed=JSON.parse(read(OP+'/booking-compatibility-adapter-attempt.json'));
 need(failed.target===C&&failed.database==='faolla_booking_compat_b274ad615550'&&failed.productionDataCopied===false&&
  failed.pilotId==='0d0a85a8ff50b585f690ba80a56d7d215adca2df1fa7c820840ff3389687d907'&&failed.pilotSystemIdentifier==='7694613959029145639','failed_attempt_identity');
 return {...pair,preservedSha256:hash(JSON.stringify(PRESERVED))};
}
function seal(file,value){
 assertOnlineToolOwnedPath(OP);need((fs.lstatSync(OP).mode&0o777)===0o700,'private_parent');
 const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const parent=fs.openSync(OP,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}same(read(file),bytes,'seal');
}
export function assertBookingRegistryToolSource(toolRevision){
 const source=verifySource(toolRevision,ROOT),receipt=JSON.parse(read(OP+'/'+RECEIPT));assertBookingRegistryToolReceipt(receipt,toolRevision);
 same(source,{sourceInputsSha256:receipt.sourceInputsSha256,toolClosureSha256:receipt.toolClosureSha256},'receipt_source');
 return source;
}
export function assertBookingRegistryContinuation({toolRevision,phase='staged'}){
 assertBookingRegistryToolSource(toolRevision);
 return {...observeBookingRegistryContinuation(phase),originalTool:ORIGINAL};
}
export function assertBookingRegistryRuntimeContinuation({toolRevision,primary,rollback}){
 const proof=assertBookingRegistryContinuation({toolRevision,phase:'database-ready'});
 need(primary.bookingReviewedStage?.toolRevision===ORIGINAL&&primary.bookingReviewedStage.toolClosureSha256==='1660fac7e48e5e18d11b439f01626d8f0823afebfb1eed00035cbef51caf65fa'&&rollback.toolRevision===ORIGINAL,'original_build_tool');return proof.originalTool;
}
export function prepareBookingRegistryTool(toolRevision,confirmation){
 need(confirmation==='approved-booking-registry-key-order-repair','approval');const source=verifySource(toolRevision,ROOT,{bootstrap:true});
 return withOnlineToolPreparationLocks({deployLock:APP+'.deploy.lock',maintenance:'/var/lib/faolla-maintenance/merchant-space'},()=>{
  same(verifySource(toolRevision,ROOT,{bootstrap:true}),source,'source_changed');const before=observeBookingRegistryContinuation();assertBookingRegistryToolNoPending();
  try{fs.lstatSync(OP+'/'+RECEIPT);need(false,'existing_attempt');}catch(e){if(e.code!=='ENOENT')throw e;}
  const receipt={schemaVersion:1,kind:'booking-registry-tool',priorTool:PRIOR,originalTool:ORIGINAL,toolRevision,...source,preservedSha256:before.preservedSha256,preparedAt:new Date().toISOString()};
  assertBookingRegistryToolReceipt(receipt,toolRevision);
  const mask=process.umask(0o077);let prepared;try{prepared=executeOnlineReleaseToolPlan(createOnlineReleaseToolPlan(toolRevision));}finally{process.umask(mask);}
  same(verifySource(toolRevision,prepared.directory),source,'prepared_source');same(observeBookingRegistryContinuation(),before,'before_after_changed');assertBookingRegistryToolNoPending();
  seal(OP+'/'+RECEIPT,receipt);same(observeBookingRegistryContinuation(),before,'after_seal_changed');
  return {kind:'booking-registry-tool-prepared',toolRevision,applicationRebuilt:false,productionDatabaseChanged:false,trafficChanged:false};
 });
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{
 need(process.argv.length===5&&process.argv[2]==='prepare','arguments');console.log(JSON.stringify(prepareBookingRegistryTool(process.argv[3],process.argv[4])));
}catch(e){console.error(/^booking_registry_tool_[a-z_]+$/.test(e.message)?e.message:'booking_registry_tool_unverified');process.exitCode=1;}}
