// Source-only continuation of the EXACT already-ready private cohort.
// No build, signal, SQL write, old-receipt rewrite or process replacement here.
import * as fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {BOOKING_READY_BASE as BASE,BOOKING_READY_RECEIPT as RECEIPT,bookingReadyInputs,assertBookingReadyDelta,assertBookingReadyClosure,assertBookingReadyReceipt} from './booking-ready-policy.mjs';
import {BOOKING_READY_EVIDENCE as EVIDENCE} from './booking-ready-evidence.mjs';
import {BOOKING_DEPENDENCY_BASE as PRIOR,BOOKING_DEPENDENCY_RECEIPT,BOOKING_DEPENDENCY_STOPPED,BOOKING_DEPENDENCY_STATES,
 bookingDependencyInputs,assertBookingDependencyToolDelta,assertBookingDependencyToolClosure,assertBookingDependencyReceipt} from './booking-dependency-continuation-policy.mjs';
import {assertBookingCiKernelEvidence} from './booking-ci-continuation-tool.mjs';
import {BOOKING_CI_BASE as FORMAL,BOOKING_CI_RECEIPT,BOOKING_CI_INPUTS_SHA256,bookingCiInputs,assertBookingCiToolDelta,assertBookingCiReceipt,assertBookingCurrentToolClosure} from './booking-ci-continuation-policy.mjs';
import {BOOKING_FORMAL_PRIOR_TOOL as ORIGINAL,BOOKING_FORMAL_FILES,assertBookingFormalToolDelta} from './booking-formal-backup-policy.mjs';
import {readBookingFormalFile as read,assertBookingFormalPreserved} from './booking-formal-backup-tool.mjs';
import {BOOKING_HANDOFF_CANDIDATE as C,BOOKING_HANDOFF_APPLICATION as A,BOOKING_HANDOFF_BASELINE as B} from './booking-handoff-policy.mjs';
import {verifyHistoricalOnlineTool} from './online-release-tool-retention.mjs';
import {readOnlineRetentionHistory} from './online-release-retention.mjs';
import {observeBookingReadyApplication} from './booking-ready-backup.mjs';
import {collectBookingReadyOriginalCohort} from './booking-ready-runtime.mjs';
import {assertBookingReadyToolNoPending} from './booking-ready-pending.mjs';
import {createOnlineReleaseToolPlan,verifyOnlineReleaseTool,verifyOnlineToolBootstrap,executeOnlineReleaseToolPlan,
 assertOnlineToolOwnedPath,runOnlineToolGit,withOnlineToolPreparationLocks} from './prepare-online-release-tool.mjs';
const APP='/www/wwwroot/merchant-space',OP='/var/lib/faolla-online-release/'+C,ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url))),SELF='scripts/booking-ready-tool.mjs';
const need=(v,c)=>{if(!v)throw Error('booking_ready_tool_'+c);},hash=v=>createHash('sha256').update(v).digest('hex');
const same=(a,b,c)=>need(isDeepStrictEqual(a,b),c),git=(dir,args)=>runOnlineToolGit(dir,args).toString().trim();
const rows=revision=>runOnlineToolGit(APP,['ls-tree','-r','-z',revision]).toString().split('\0').filter(Boolean);
const changes=(before,after)=>git(APP,['diff','--no-renames','--name-status',before,after]).split('\n').filter(Boolean).map(row=>{
 const [status,name,...extra]=row.split('\t');need(['M','A'].includes(status)&&!extra.length,'delta');return name;
});
export function bookingReadyImportClosure(readSource){
 const seen=new Set();function visit(f){if(seen.has(f))return;need(/^scripts\/[a-z0-9-]+\.mjs$/.test(f),'import_path');seen.add(f);
  for(const m of readSource(f).matchAll(/(?:^|(?<=[;\r\n]))\s*(?:import\s+(?:[^;]*?\s+from\s+)?|export\s+[^;]*?\s+from\s+)['"]([^'"]+)['"]\s*;?/gm)){
   if(m[1].startsWith('node:'))continue;need(m[1].startsWith('./'),'import_path');visit(path.posix.normalize(path.posix.join(path.posix.dirname(f),m[1])));
  }
 }visit(SELF);return [...seen].sort();
}
function source(revision,directory,{bootstrap=false}={}){
 need(process.platform==='linux'&&process.getuid?.()===0&&/^[a-f0-9]{40}$/.test(revision??'')&&revision!==BASE,'invocation');
 need(git(APP,['rev-parse','origin/main'])===revision&&git(directory,['rev-parse','HEAD'])===revision&&
 git(directory,['rev-parse','--abbrev-ref','HEAD'])==='HEAD'&&!git(directory,['status','--porcelain=v1','--untracked-files=all']),'source');
 git(APP,['merge-base','--is-ancestor',BASE,revision]);
 const sourceInputsSha256=assertBookingReadyDelta({files:changes(BASE,revision),originalInputs:bookingReadyInputs(rows(BASE)),
 currentInputs:bookingReadyInputs(rows(revision)),readBlob:f=>runOnlineToolGit(APP,['show',revision+':'+f])});
 // Validate the REAL predecessor's raw delta and receipt, never projected rows.
 const formalInputs=revision=>rows(revision).filter(r=>!BOOKING_FORMAL_FILES.includes(r.slice(r.indexOf('\t')+1))).join('\0');
 assertBookingFormalToolDelta({files:changes(ORIGINAL,FORMAL),originalInputs:formalInputs(ORIGINAL),currentInputs:formalInputs(FORMAL)});
 assertBookingCiToolDelta({files:changes(FORMAL,PRIOR),originalInputs:bookingCiInputs(rows(FORMAL)),currentInputs:bookingCiInputs(rows(PRIOR)),
  readBlob:f=>runOnlineToolGit(APP,['show',PRIOR+':'+f])});
 const ci=JSON.parse(read(OP+'/'+BOOKING_CI_RECEIPT));assertBookingCiReceipt(ci,PRIOR);
 same([BOOKING_CI_INPUTS_SHA256,assertBookingCurrentToolClosure({baseline:C,files:git(APP,['diff','--name-only',C,PRIOR]).split('\n'),
  readBlob:f=>runOnlineToolGit(APP,['show',PRIOR+':'+f])})],[ci.sourceInputsSha256,ci.toolClosureSha256],'prior_ci_source');
 const prior=JSON.parse(read(OP+'/'+BOOKING_DEPENDENCY_RECEIPT));assertBookingDependencyReceipt(prior,BASE);
 const oldInputs=assertBookingDependencyToolDelta({files:changes(PRIOR,BASE),originalInputs:bookingDependencyInputs(rows(PRIOR)),
 currentInputs:bookingDependencyInputs(rows(BASE)),readBlob:f=>runOnlineToolGit(APP,['show',BASE+':'+f])});
 const oldClosure=assertBookingDependencyToolClosure({baseline:C,files:git(APP,['diff','--name-only',C,BASE]).split('\n'),readBlob:f=>runOnlineToolGit(APP,['show',BASE+':'+f])});
 same([oldInputs,oldClosure],[prior.sourceInputsSha256,prior.toolClosureSha256],'prior_source');
 for(const old of [BASE,PRIOR,ORIGINAL])verifyHistoricalOnlineTool(createOnlineReleaseToolPlan(old),revision);
 const plan=createOnlineReleaseToolPlan(revision);verifyOnlineToolBootstrap(plan,directory+'/scripts/prepare-online-release-tool.mjs');
 if(bootstrap){
  need(directory==='/var/lib/faolla-online-bootstrap/'+revision,'bootstrap_path');
  const files=bookingReadyImportClosure(f=>runOnlineToolGit(APP,['show',revision+':'+f]).toString()),sparse=path.resolve(directory,git(directory,['rev-parse','--git-path','info/sparse-checkout']));
  need(read(sparse,{privateMode:false}).toString()===files.map(f=>'/'+f).join('\n')+'\n'&&
   git(directory,['config','--worktree','--get','core.sparseCheckout'])==='true'&&git(directory,['config','--worktree','--get','core.sparseCheckoutCone'])==='false'&&
   git(directory,['config','--worktree','--get','index.sparse'])==='false','bootstrap_sparse');
  const entries=new Set(['.git']);for(const f of files){same(read(directory+'/'+f,{privateMode:false}),runOnlineToolGit(APP,['show',revision+':'+f]),'bootstrap_blob');
   const pieces=f.split('/');while(pieces.length){entries.add(pieces.join('/'));pieces.pop();}}
  function walk(dir,prefix=''){for(const e of fs.readdirSync(dir,{withFileTypes:true})){need(entries.has(prefix+e.name)&&!e.isSymbolicLink(),'bootstrap_entry');assertOnlineToolOwnedPath(dir+'/'+e.name,e.isDirectory()?'directory':'file');if(e.isDirectory())walk(dir+'/'+e.name,prefix+e.name+'/');}}walk(directory);
 }else{need(directory==='/var/lib/faolla-online-code/'+revision,'tool_path');verifyOnlineReleaseTool(plan);}
 const toolClosureSha256=assertBookingReadyClosure({baseline:C,files:git(APP,['diff','--name-only',C,revision]).split('\n'),readBlob:f=>runOnlineToolGit(APP,['show',revision+':'+f])});
 return {sourceInputsSha256,toolClosureSha256};
}
export function assertBookingReadyPreserved(){
 const pins={...BOOKING_DEPENDENCY_STOPPED,...EVIDENCE};delete pins[OP+'/state.json'];
 for(const [file,pin]of Object.entries(pins)){
  assertOnlineToolOwnedPath(file,'file');const st=fs.lstatSync(file),mode=pin.mode??0o600;
  need(st.nlink===1&&st.size===pin.bytes&&(st.mode&0o777)===mode,'preserved_file');
  const id=s=>['dev','ino','mode','uid','nlink','size','mtimeMs','ctimeMs'].map(k=>s[k]),fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW),h=createHash('sha256'),buffer=Buffer.alloc(256*1024);let count=0;
  try{same(id(fs.fstatSync(fd)),id(st),'file_replaced');for(;;){const n=fs.readSync(fd,buffer,0,buffer.length,null);if(!n)break;count+=n;h.update(buffer.subarray(0,n));}
   same(id(fs.fstatSync(fd)),id(st),'file_changed');same(id(fs.lstatSync(file)),id(st),'file_replaced');need(count===pin.bytes&&h.digest('hex')===pin.sha256,'preserved_digest');
  }finally{fs.closeSync(fd);}
 }
 for(const pin of Object.values(BOOKING_DEPENDENCY_STATES))need(hash(read(OP+'/'+pin.file))===pin.sha256,'original_build_state');
 assertBookingFormalPreserved();assertBookingCiKernelEvidence();return hash(JSON.stringify(EVIDENCE));
}
export function assertBookingReadySource(revision){
 const actual=source(revision,ROOT),receipt=JSON.parse(read(OP+'/'+RECEIPT)),evidenceSha256=assertBookingReadyPreserved();
 assertBookingReadyReceipt(receipt,revision,evidenceSha256);same(actual,{sourceInputsSha256:receipt.sourceInputsSha256,toolClosureSha256:receipt.toolClosureSha256},'receipt_source');return actual;
}
function original(){
 const cohort=collectBookingReadyOriginalCohort();need(cohort.active.process.pid===829945&&cohort.rollback.process.pid===830123,'private_web_identity');
 const history=readOnlineRetentionHistory();need(history.headSha256==='77ea9068d2c634f146f0f53be465ba9cb13ad335417cbc8f2228fd6bc5cef6cb'&&history.entries.at(-1)?.active.target===B,'history');
 need(JSON.parse(read('/var/lib/faolla-online-release/active.json')).target===B,'public_target');
 need(hash(read(OP+'/state.json'))==='7ba13be0b859c918a71481b469596d6f2ef430ba61b1fc1946471812fb5651d3'&&
 hash(read('/var/lib/faolla-online-release/'+A+'/state.json'))==='12a7590d9de39d10179d0b60d3730c0451c5ad9e2b9a6d22044a77fe0861be3d','ready_states');
 return {cohort,application:observeBookingReadyApplication(),preserved:assertBookingReadyPreserved()};
}
function seal(name,text){
 assertOnlineToolOwnedPath(OP);need((fs.lstatSync(OP).mode&0o777)===0o700,'private_parent');
 const file=OP+'/'+name,fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const parent=fs.openSync(OP,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}same(read(file),Buffer.from(text),'seal');
}
export function prepareBookingReadyTool(revision,confirmation){
 need(confirmation==='approved-booking-native-ready-continuation','approval');const proof=source(revision,ROOT,{bootstrap:true});
 return withOnlineToolPreparationLocks({deployLock:APP+'.deploy.lock',maintenance:'/var/lib/faolla-maintenance/merchant-space'},()=>{
  same(source(revision,ROOT,{bootstrap:true}),proof,'source_changed');const before=original();assertBookingReadyToolNoPending();
  for(const file of [OP+'/'+RECEIPT,'/var/lib/faolla-booking-handoff/'+C+'/ready-worker-attempt.json'])try{fs.lstatSync(file);need(false,'existing_attempt');}catch(e){if(e.code!=='ENOENT')throw e;}
  const receipt={schemaVersion:1,kind:'booking-ready-continuation-tool',priorTool:BASE,toolRevision:revision,...proof,readyEvidenceSha256:before.preserved,preparedAt:new Date().toISOString()};
  assertBookingReadyReceipt(receipt,revision,before.preserved);let prepared;const mask=process.umask(0o077);
  try{prepared=executeOnlineReleaseToolPlan(createOnlineReleaseToolPlan(revision));}finally{process.umask(mask);}
  same(source(revision,prepared.directory),proof,'prepared_source');same(original(),before,'ready_changed');assertBookingReadyToolNoPending();
  seal(RECEIPT,JSON.stringify(receipt,null,2)+'\n');same(original(),before,'after_seal_changed');
  return {kind:receipt.kind+'-prepared',toolRevision:revision,applicationRebuilt:false,webProcessesChanged:false,productionDatabaseChanged:false,trafficChanged:false,mailEnabled:false};
 });
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)try{
 need(process.argv.length===5&&process.argv[2]==='prepare','arguments');console.log(JSON.stringify(prepareBookingReadyTool(process.argv[3],process.argv[4])));
}catch{console.error('booking_ready_tool_unverified_evidence_preserved');process.exitCode=1;}
