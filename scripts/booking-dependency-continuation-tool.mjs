// Source-only preparation of the separately approved fixed CI successor.
// No application build, process signal, SQL, cleanup or old evidence overwrite.
import * as fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {BOOKING_DEPENDENCY_BASE as BASE,BOOKING_DEPENDENCY_RECEIPT as RECEIPT,BOOKING_DEPENDENCY_STATES as STATES,
 BOOKING_DEPENDENCY_STOPPED as STOPPED,bookingDependencyInputs,assertBookingDependencyToolDelta,assertBookingDependencyToolClosure,assertBookingDependencyReceipt} from './booking-dependency-continuation-policy.mjs';
import {BOOKING_CI_BASE as CI_BASE,BOOKING_CI_INPUTS_SHA256,BOOKING_CI_RECEIPT,bookingCiInputs,assertBookingCiToolDelta,assertBookingCurrentToolClosure,assertBookingCiReceipt} from './booking-ci-continuation-policy.mjs';
import {assertBookingCiKernelEvidence} from './booking-ci-continuation-tool.mjs';
import {BOOKING_FORMAL_PRIOR_TOOL as PRIOR,BOOKING_FORMAL_FILES,assertBookingFormalToolDelta} from './booking-formal-backup-policy.mjs';
import {readBookingFormalFile as read,observeBookingFormalContinuation,assertBookingFormalPreserved} from './booking-formal-backup-tool.mjs';
import {BOOKING_HANDOFF_CANDIDATE as C} from './booking-handoff-policy.mjs';
import {BOOKING_REGISTRY_ORIGINAL_TOOL} from './booking-registry-tool-policy.mjs';
import {assertBookingDependencyToolNoPending} from './booking-dependency-pending.mjs';
import {bookingModeAwareDependencies,BOOKING_DEPENDENCY_MODE_SHA256} from './booking-dependency-fingerprint.mjs';
import {verifyHistoricalOnlineTool} from './online-release-tool-retention.mjs';
import {createOnlineReleaseToolPlan,verifyOnlineReleaseTool,verifyOnlineToolBootstrap,executeOnlineReleaseToolPlan,
 assertOnlineToolOwnedPath,runOnlineToolGit,withOnlineToolPreparationLocks} from './prepare-online-release-tool.mjs';
const APP='/www/wwwroot/merchant-space',OP='/var/lib/faolla-online-release/'+C;
const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url))),SELF='scripts/booking-dependency-continuation-tool.mjs';
const need=(v,c)=>{if(!v)throw Error('booking_dependency_continuation_'+c);};
const hash=x=>createHash('sha256').update(x).digest('hex');
const same=(a,b,c)=>need(isDeepStrictEqual(a,b),c);
const git=(cwd,args)=>runOnlineToolGit(cwd,args).toString().trim();
const rows=revision=>runOnlineToolGit(APP,['ls-tree','-r','-z',revision]).toString().split('\0').filter(Boolean);
const changes=(before,after)=>git(APP,['diff','--no-renames','--name-status',before,after]).split('\n').filter(Boolean).map(row=>{
 const [status,name,...extra]=row.split('\t');need(['M','A'].includes(status)&&!extra.length,'source_delta');return name;
});
export function bookingDependencyToolImportClosure(readSource){
 const seen=new Set();function visit(file){if(seen.has(file))return;need(/^scripts\/[a-z0-9-]+\.mjs$/.test(file),'import_path');seen.add(file);
  for(const m of readSource(file).matchAll(/(?:^|(?<=[;\r\n]))\s*(?:import\s+(?:[^;]*?\s+from\s+)?|export\s+[^;]*?\s+from\s+)['"]([^'"]+)['"]\s*;?/gm)){
   if(m[1].startsWith('node:'))continue;need(m[1].startsWith('./'),'import_path');visit(path.posix.normalize(path.posix.join(path.posix.dirname(file),m[1])));
  }
 }visit(SELF);return [...seen].sort();
}
function verifySource(toolRevision,directory,{bootstrap=false}={}){
 need(process.platform==='linux'&&process.getuid?.()===0&&/^[a-f0-9]{40}$/.test(toolRevision??'')&&![PRIOR,BASE,CI_BASE].includes(toolRevision),'invocation');
 need(git(APP,['rev-parse','origin/main'])===toolRevision&&git(directory,['rev-parse','HEAD'])===toolRevision&&
  git(directory,['rev-parse','--abbrev-ref','HEAD'])==='HEAD'&&!git(directory,['status','--porcelain=v1','--untracked-files=all']),'source_identity');
 git(APP,['merge-base','--is-ancestor',BASE,toolRevision]);git(APP,['merge-base','--is-ancestor',CI_BASE,BASE]);
 const oldInputs=revision=>rows(revision).filter(r=>!BOOKING_FORMAL_FILES.includes(r.slice(r.indexOf('\t')+1))).join('\0');
 assertBookingFormalToolDelta({files:changes(PRIOR,CI_BASE),originalInputs:oldInputs(PRIOR),currentInputs:oldInputs(CI_BASE)});
 assertBookingCiToolDelta({files:changes(CI_BASE,BASE),originalInputs:bookingCiInputs(rows(CI_BASE)),
  currentInputs:bookingCiInputs(rows(BASE)),readBlob:f=>runOnlineToolGit(APP,['show',BASE+':'+f])});
 const sourceInputsSha256=assertBookingDependencyToolDelta({files:changes(BASE,toolRevision),originalInputs:bookingDependencyInputs(rows(BASE)),
  currentInputs:bookingDependencyInputs(rows(toolRevision)),readBlob:f=>runOnlineToolGit(APP,['show',toolRevision+':'+f])});
 const priorFiles=git(APP,['diff','--name-only',C,BASE]).split('\n'),prior=JSON.parse(read(OP+'/'+BOOKING_CI_RECEIPT));
 assertBookingCiReceipt(prior,BASE);
 same({sourceInputsSha256:BOOKING_CI_INPUTS_SHA256,toolClosureSha256:assertBookingCurrentToolClosure({baseline:C,files:priorFiles,
  readBlob:f=>runOnlineToolGit(APP,['show',BASE+':'+f])})},{sourceInputsSha256:prior.sourceInputsSha256,toolClosureSha256:prior.toolClosureSha256},'prior_source');
 verifyHistoricalOnlineTool(createOnlineReleaseToolPlan(BASE),toolRevision);
 verifyHistoricalOnlineTool(createOnlineReleaseToolPlan(PRIOR),toolRevision);
 const plan=createOnlineReleaseToolPlan(toolRevision);verifyOnlineToolBootstrap(plan,directory+'/scripts/prepare-online-release-tool.mjs');
 if(bootstrap){
  need(directory==='/var/lib/faolla-online-bootstrap/'+toolRevision,'bootstrap_path');
  const files=bookingDependencyToolImportClosure(f=>runOnlineToolGit(APP,['show',toolRevision+':'+f]).toString());
  const sparse=path.resolve(directory,git(directory,['rev-parse','--git-path','info/sparse-checkout']));
  need(read(sparse,{privateMode:false}).toString()===files.map(f=>'/'+f).join('\n')+'\n'&&
   git(directory,['config','--worktree','--get','core.sparseCheckout'])==='true'&&git(directory,['config','--worktree','--get','core.sparseCheckoutCone'])==='false'&&
   git(directory,['config','--worktree','--get','index.sparse'])==='false','bootstrap_sparse');
  const entries=new Set(['.git']);for(const f of files){same(read(directory+'/'+f,{privateMode:false}),runOnlineToolGit(APP,['show',toolRevision+':'+f]),'bootstrap_blob');
   const pieces=f.split('/');while(pieces.length){entries.add(pieces.join('/'));pieces.pop();}}
  function walk(dir,prefix=''){for(const e of fs.readdirSync(dir,{withFileTypes:true})){need(entries.has(prefix+e.name)&&!e.isSymbolicLink(),'bootstrap_entry');assertOnlineToolOwnedPath(dir+'/'+e.name,e.isDirectory()?'directory':'file');if(e.isDirectory())walk(dir+'/'+e.name,prefix+e.name+'/');}}walk(directory);
 }else{need(directory==='/var/lib/faolla-online-code/'+toolRevision,'tool_path');verifyOnlineReleaseTool(plan);}
 const files=git(APP,['diff','--name-only',C,toolRevision]).split('\n');
 const toolClosureSha256=assertBookingDependencyToolClosure({baseline:C,files,readBlob:f=>runOnlineToolGit(APP,['show',toolRevision+':'+f])});
 return {sourceInputsSha256,toolClosureSha256};
}
// Archive pin checks are streamed. The stopped primary state is instead
// witnessed by an exclusive byte-for-byte copy once runtime status may change.
function evidence({liveStates=false}={}){
 for(const [file,pin]of Object.entries(STOPPED)){
  if(file===OP+'/state.json')continue;
  assertOnlineToolOwnedPath(file,'file');const st=fs.lstatSync(file);
  need(st.nlink===1&&(st.mode&0o777)===0o600&&st.size===pin.bytes,'preserved_file');
  const id=v=>['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'].map(k=>v[k]),fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW),h=createHash('sha256'),buffer=Buffer.alloc(256*1024);let count=0;
  try{same(id(fs.fstatSync(fd)),id(st),'preserved_replaced');for(;;){const n=fs.readSync(fd,buffer,0,buffer.length,null);if(!n)break;count+=n;h.update(buffer.subarray(0,n));}
   same(id(fs.fstatSync(fd)),id(st),'preserved_changed');same(id(fs.lstatSync(file)),id(st),'preserved_changed');need(count===pin.bytes&&h.digest('hex')===pin.sha256,'preserved_digest');
  }finally{fs.closeSync(fd);}
 }
 for(const pin of Object.values(STATES))need(hash(read(liveStates?'/var/lib/faolla-online-release/'+pin.target+'/state.json':OP+'/'+pin.file))===pin.sha256,'original_state');
 assertBookingFormalPreserved();assertBookingCiKernelEvidence();return hash(JSON.stringify(STOPPED));
}
function originalPhase(){
 const before=observeBookingFormalContinuation('database-ready');evidence({liveStates:true});
 for(const pin of Object.values(STATES)){
  const op='/var/lib/faolla-online-release/'+pin.target;
  need(!fs.existsSync(op+'/atomic-runtime.json'),'existing_runtime');
  need(bookingModeAwareDependencies(APP+'.web-releases/'+pin.target.slice(0,12)+'-online/node_modules')===BOOKING_DEPENDENCY_MODE_SHA256,'dependency_mode');
 }
 need(!fs.existsSync('/var/lib/faolla-booking-handoff/'+C),'existing_runtime');return before;
}
export function assertBookingDependencyToolSource(toolRevision){
 const source=verifySource(toolRevision,ROOT),receipt=JSON.parse(read(OP+'/'+RECEIPT));assertBookingDependencyReceipt(receipt,toolRevision);
 same(source,{sourceInputsSha256:receipt.sourceInputsSha256,toolClosureSha256:receipt.toolClosureSha256},'receipt_source');
 need(receipt.stoppedEvidenceSha256===evidence(),'receipt_evidence');return source;
}
export function assertBookingDependencyContinuation({toolRevision}){
 assertBookingDependencyToolSource(toolRevision);return originalPhase();
}
export function assertBookingDependencyRuntimeContinuation({toolRevision,primary,rollback}){
 assertBookingDependencyContinuation({toolRevision});
 need(primary.bookingReviewedStage?.toolRevision===BOOKING_REGISTRY_ORIGINAL_TOOL&&
  primary.bookingReviewedStage.toolClosureSha256==='1660fac7e48e5e18d11b439f01626d8f0823afebfb1eed00035cbef51caf65fa'&&
  rollback.toolRevision===BOOKING_REGISTRY_ORIGINAL_TOOL,'original_build_tool');return BOOKING_REGISTRY_ORIGINAL_TOOL;
}
function seal(name,bytes){
 assertOnlineToolOwnedPath(OP);need((fs.lstatSync(OP).mode&0o777)===0o700,'private_parent');
 const file=OP+'/'+name,fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const parent=fs.openSync(OP,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}same(read(file),bytes,'seal');
}
export function prepareBookingDependencyTool(toolRevision,confirmation){
 need(confirmation==='approved-booking-dependency-binding-continuation','approval');const source=verifySource(toolRevision,ROOT,{bootstrap:true});
 return withOnlineToolPreparationLocks({deployLock:APP+'.deploy.lock',maintenance:'/var/lib/faolla-maintenance/merchant-space'},()=>{
  same(verifySource(toolRevision,ROOT,{bootstrap:true}),source,'source_changed');
  const before=originalPhase();assertBookingDependencyToolNoPending();
  for(const name of [RECEIPT,...Object.values(STATES).map(p=>p.file)]){
   try{fs.lstatSync(OP+'/'+name);need(false,'existing_attempt');}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  const originals=Object.values(STATES).map(p=>({pin:p,bytes:read('/var/lib/faolla-online-release/'+p.target+'/state.json')}));
  const receipt={schemaVersion:1,kind:'booking-dependency-continuation-tool',priorTool:BASE,toolRevision,...source,
   stoppedEvidenceSha256:hash(JSON.stringify(STOPPED)),preparedAt:new Date().toISOString()};
  assertBookingDependencyReceipt(receipt,toolRevision);const mask=process.umask(0o077);let prepared;
  try{prepared=executeOnlineReleaseToolPlan(createOnlineReleaseToolPlan(toolRevision));}finally{process.umask(mask);}
  same(verifySource(toolRevision,prepared.directory),source,'prepared_source');same(originalPhase(),before,'before_after_changed');assertBookingDependencyToolNoPending();
  for(const {pin,bytes}of originals){need(hash(bytes)===pin.sha256,'original_state');seal(pin.file,bytes);}
  need(evidence()===receipt.stoppedEvidenceSha256,'evidence_changed');same(originalPhase(),before,'before_seal_changed');
  seal(RECEIPT,Buffer.from(JSON.stringify(receipt,null,2)+'\n'));same(originalPhase(),before,'after_seal_changed');
  return {kind:receipt.kind+'-prepared',toolRevision,applicationRebuilt:false,productionDatabaseChanged:false,trafficChanged:false};
 });
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{
 need(process.argv.length===5&&process.argv[2]==='prepare','arguments');console.log(JSON.stringify(prepareBookingDependencyTool(process.argv[3],process.argv[4])));
}catch(e){console.error(/^booking_dependency_continuation_[a-z_]+$/.test(e.message)?e.message:'booking_dependency_continuation_unverified');process.exitCode=1;}}
