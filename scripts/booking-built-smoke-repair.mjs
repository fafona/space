// Source-only preparation and read-only attestation for ONE already-built pair.
// No build, database, process, traffic, cleanup or maintenance mutation here.
import * as fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {BOOKING_BUILT_SMOKE_PINS as P,BOOKING_BUILT_SMOKE_REPAIR_FILES as ALLOWED,
 BOOKING_BUILT_SMOKE_RECEIPT,BOOKING_BUILT_SMOKE_ORIGINAL,bookingBuiltSmokePinsSha256,
 assertBookingBuiltSmokeToolDelta,assertBookingBuiltSmokeState,assertBookingBuiltSmokeReceipt} from './booking-built-smoke-repair-policy.mjs';
import {createOnlineReleaseToolPlan,verifyOnlineReleaseTool,verifyOnlineToolBootstrap,executeOnlineReleaseToolPlan,
 assertOnlineToolOwnedPath,runOnlineToolGit,withOnlineToolPreparationLocks} from './prepare-online-release-tool.mjs';
import {attendanceRepairTreeFingerprint as tree} from './attendance-staged-tool-repair.mjs';
import {normalizeRetirementProcess} from './online-release-retirement.mjs';
import {readOnlineRetentionHistory} from './online-release-retention.mjs';
import {assertOnlineRetentionPublication} from './online-release-retention-policy.mjs';
import {assertBookingHandoffToolClosure} from './booking-handoff-policy.mjs';
import {assertBookingBuiltSmokeToolNoPending} from './booking-handoff-pending.mjs';
const APP='/www/wwwroot/merchant-space',RELEASE='/var/lib/faolla-online-release';
const A=P.pair[0].target,C=P.pair[1].target,SELF='scripts/booking-built-smoke-repair.mjs';
const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const need=(v,c)=>{if(!v)throw Error('booking_built_smoke_'+c);};
const hash=b=>createHash('sha256').update(b).digest('hex');
const same=(a,b,c)=>need(isDeepStrictEqual(a,b),c);
function read(file,{privateMode=false}={}){
 assertOnlineToolOwnedPath(file,'file');const s=fs.lstatSync(file);
 need(s.nlink===1&&s.size>=0&&s.size<=256*1024**2&&(!privateMode||(s.mode&0o777)===0o600),'file');
 const identity=x=>['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'].map(k=>x[k]);
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{same(identity(fs.fstatSync(fd)),identity(s),'file_replaced');
  const b=fs.readFileSync(fd);same(identity(fs.fstatSync(fd)),identity(s),'file_changed');same(identity(fs.lstatSync(file)),identity(s),'file_changed');need(b.length===s.size,'file_changed');return b;
 }finally{fs.closeSync(fd);}
}
const git=(cwd,args)=>runOnlineToolGit(cwd,args).toString().trim();
function command(bin,args){const r=spawnSync(bin,args,{encoding:'utf8',timeout:15000,maxBuffer:16*1024**2,env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/root',PM2_HOME:'/root/.pm2',LANG:'C.UTF-8'}});need(r.status===0&&!r.error&&!r.signal,'observation');return r.stdout;}
function sourceInputs(revision){return runOnlineToolGit(APP,['ls-tree','-r','-z',revision]).toString().split('\0').filter(Boolean).filter(row=>!ALLOWED.includes(row.slice(row.indexOf('\t')+1))).join('\0');}
export function bookingBuiltSmokeRepairImportClosure(readSource){
 const seen=new Set();function visit(file){if(seen.has(file))return;need(/^scripts\/[a-z0-9-]+\.mjs$/.test(file),'import_path');seen.add(file);
  for(const match of readSource(file).matchAll(/(?:^|(?<=[;\r\n]))\s*(?:import\s+(?:[^;]*?\s+from\s+)?|export\s+[^;]*?\s+from\s+)['"]([^'"]+)['"]\s*;?/gm)){
   if(match[1].startsWith('node:'))continue;need(match[1].startsWith('./'),'import_path');visit(path.posix.normalize(path.posix.join(path.posix.dirname(file),match[1])));
  }
 }visit(SELF);return [...seen].sort();
}
function verifySource(toolRevision,directory,{bootstrap=false}={}){
 need(process.platform==='linux'&&process.getuid?.()===0&&/^[a-f0-9]{40}$/.test(toolRevision??'')&&toolRevision!==P.originalTool,'invocation');
 need(git(APP,['rev-parse','origin/main'])===toolRevision&&git(directory,['rev-parse','HEAD'])===toolRevision&&git(directory,['rev-parse','--abbrev-ref','HEAD'])==='HEAD'&&!git(directory,['status','--porcelain=v1','--untracked-files=all']),'source_identity');
 git(APP,['merge-base','--is-ancestor',P.originalTool,toolRevision]);
 const changes=git(APP,['diff','--no-renames','--name-status',P.originalTool,toolRevision]).split('\n').filter(Boolean).map(row=>{const [status,name,...extra]=row.split('\t');need(['M','A'].includes(status)&&!extra.length,'source_delta');return name;});
 const sourceInputsSha256=assertBookingBuiltSmokeToolDelta({files:changes,originalInputs:sourceInputs(P.originalTool),currentInputs:sourceInputs(toolRevision)});
 const plan=createOnlineReleaseToolPlan(toolRevision);verifyOnlineToolBootstrap(plan,directory+'/scripts/prepare-online-release-tool.mjs');
 if(bootstrap){
  need(directory==='/var/lib/faolla-online-bootstrap/'+toolRevision,'bootstrap_path');
  const files=bookingBuiltSmokeRepairImportClosure(f=>runOnlineToolGit(APP,['show',toolRevision+':'+f]).toString());
  const sparse=path.resolve(directory,git(directory,['rev-parse','--git-path','info/sparse-checkout']));
  need(read(sparse).toString()===files.map(f=>'/'+f).join('\n')+'\n'&&git(directory,['config','--worktree','--get','core.sparseCheckout'])==='true'&&git(directory,['config','--worktree','--get','core.sparseCheckoutCone'])==='false'&&git(directory,['config','--worktree','--get','index.sparse'])==='false','bootstrap_sparse');
  const entries=new Set(['.git']);for(const f of files){same(read(directory+'/'+f),runOnlineToolGit(APP,['show',toolRevision+':'+f]),'bootstrap_blob');const pieces=f.split('/');while(pieces.length){entries.add(pieces.join('/'));pieces.pop();}}
  function walk(dir,prefix=''){for(const e of fs.readdirSync(dir,{withFileTypes:true})){need(entries.has(prefix+e.name)&&!e.isSymbolicLink(),'bootstrap_entry');assertOnlineToolOwnedPath(dir+'/'+e.name,e.isDirectory()?'directory':'file');if(e.isDirectory())walk(dir+'/'+e.name,prefix+e.name+'/');}}walk(directory);
 }else{need(directory==='/var/lib/faolla-online-code/'+toolRevision,'tool_path');verifyOnlineReleaseTool(plan);}
 const all=git(APP,['diff','--name-only',C,toolRevision]).split('\n');const toolClosureSha256=assertBookingHandoffToolClosure({baseline:C,files:all,readBlob:f=>runOnlineToolGit(APP,['show',toolRevision+':'+f])});
 return {toolRevision,sourceInputsSha256,toolClosureSha256,changedToolFiles:changes.sort()};
}
export function observeBookingBuiltSmokePair({phase='preparing'}={}){
 need(process.platform==='linux'&&process.getuid?.()===0,'linux_root');const states={},preserved={};
 for(const pin of P.pair){const op=RELEASE+'/'+pin.target,originalFile=pin.target===C&&phase!=='preparing'?op+'/'+BOOKING_BUILT_SMOKE_ORIGINAL:op+'/state.json';
  const original=read(originalFile,{privateMode:true}),state=JSON.parse(read(op+'/state.json',{privateMode:true}));need(hash(original)===pin.stateSha256,'original_state');
  if(pin.target===C)assertBookingBuiltSmokeState(original.toString(),state,phase);else need(hash(read(op+'/state.json',{privateMode:true}))===pin.stateSha256,'rollback_state');
  need(state.target===pin.target&&state.port===pin.port&&state.directory===APP+'.web-releases/'+pin.target.slice(0,12)+'-online','identity');
  need(git(state.directory,['rev-parse','HEAD'])===pin.target&&!git(state.directory,['status','--porcelain=v1','--untracked-files=all']),'candidate_source');
  // Independently hash every tracked application input; skip-worktree flags cannot hide changes.
  for(const row of runOnlineToolGit(APP,['ls-tree','-r','-z',pin.target]).toString().split('\0').filter(Boolean)){
   const m=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(row);need(m&&!m[3].split('/').some(p=>['','..','.'].includes(p)),'source_entry');
   const bytes=read(state.directory+'/'+m[3]);need(createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')===m[2],'candidate_blob');
  }
  for(const [name,digest]of Object.entries(pin.files)){const file=name==='state.json'?originalFile:op+'/'+name;need(hash(read(file,{privateMode:true}))===digest,'preserved_file');}
  need(hash(read(state.directory+'/.env.local',{privateMode:true}))===pin.envSha256,'environment');
  same(tree(state.directory+'/node_modules',{allowInternalLinks:true}),pin.dependencies,'dependencies');same(tree(state.directory+'/.next',{exclude:['cache','trace']}),pin.built,'built_output');
  const proof=JSON.parse(read(op+'/attendance-build-proof.json',{privateMode:true}));need(proof.target===pin.target&&proof.buildId===read(state.directory+'/.next/BUILD_ID').toString().trim()&&proof.guardedCommand==='npm run build'&&proof.memoryBytes===4294967296&&proof.heapMiB===3072&&proof.cpuQuotaPercent===100&&proof.tasks===128&&proof.seconds===1200&&proof.privateNetworkVerified===true&&proof.swapBytes===0,'build_proof');
  states[pin.target]=state;preserved[pin.target]={stateSha256:pin.stateSha256,dependenciesSha256:pin.dependencies.sha256,builtOutputSha256:pin.built.sha256};
 }
 for(const [file,digest]of Object.entries(P.protectedFiles))need(hash(read(file))===digest,'protected_file');
 const history=readOnlineRetentionHistory();need(history.headSha256===P.retentionHeadSha256,'history');
 const processes=JSON.parse(command('pm2',['jlist'])).map(normalizeRetirementProcess).sort((a,b)=>a.pmId-b.pmId);
 need(hash(JSON.stringify(processes))===P.processesSha256,'processes');
 assertOnlineRetentionPublication({history,state:states[C],actualActive:JSON.parse(read(RELEASE+'/active.json')),current:processes,action:'status'});
 const runtime=JSON.parse(read(RELEASE+'/'+C+'/runtime.json',{privateMode:true}));need(!runtime.RESEND_API_KEY&&!runtime.BOOKING_CONFIRMATION_EMAIL_FROM&&runtime.FAOLLA_BACKGROUND_JOBS_PAUSED==='1'&&runtime.MERCHANT_BOOKING_STORAGE_MODE==='legacy','mail_or_mode');
 for(const target of [A,C])for(const name of ['booking-install-attempt.json','atomic-runtime.json']){try{fs.lstatSync(RELEASE+'/'+target+'/'+name);need(phase==='database-ready'&&target===C&&name==='booking-install-attempt.json','later_attempt_present');}catch(e){if(e.code!=='ENOENT')throw e;}}
 return {preserved,processesSha256:P.processesSha256,retentionHeadSha256:history.headSha256};
}
function seal(file,text){assertOnlineToolOwnedPath(path.dirname(file));need((fs.lstatSync(path.dirname(file)).mode&0o777)===0o700,'private_parent');const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const parent=fs.openSync(path.dirname(file),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}same(read(file,{privateMode:true}),Buffer.from(text),'seal');}
export async function executeBookingBuiltSmokeContinuation(operations){
 const before=await operations.observe('preparing');await operations.bundle();await operations.verify();await operations.smoke();
 same(await operations.observe('preparing'),before,'continuity_changed');await operations.ready();await operations.observe('staged');
}
export function assertBookingBuiltSmokeCandidate({toolRevision,phase='preparing'}){
 const source=verifySource(toolRevision,ROOT),op=RELEASE+'/'+C,receipt=JSON.parse(read(op+'/'+BOOKING_BUILT_SMOKE_RECEIPT,{privateMode:true}));assertBookingBuiltSmokeReceipt(receipt,{toolRevision});
 same(source,{toolRevision:receipt.toolRevision,sourceInputsSha256:receipt.sourceInputsSha256,toolClosureSha256:receipt.toolClosureSha256,changedToolFiles:receipt.changedToolFiles},'receipt_source');
 need(hash(read(op+'/'+BOOKING_BUILT_SMOKE_ORIGINAL,{privateMode:true}))===P.pair[1].stateSha256,'sealed_original');
 const result=observeBookingBuiltSmokePair({phase});if(phase==='database-ready')need(hash(read(op+'/booking-database-inactive.json',{privateMode:true}))===JSON.parse(read(op+'/state.json')).bookingDatabaseProofSha256,'database_proof');
 return {...result,originalTool:P.originalTool,toolClosureSha256:source.toolClosureSha256};
}
export function assertBookingBuiltSmokeRuntimeContinuation({toolRevision,primary,rollback}){
 const proof=assertBookingBuiltSmokeCandidate({toolRevision,phase:'database-ready'});
 need(primary.bookingReviewedStage?.toolRevision===P.originalTool&&primary.bookingReviewedStage.toolClosureSha256==='1660fac7e48e5e18d11b439f01626d8f0823afebfb1eed00035cbef51caf65fa'&&rollback.toolRevision===P.originalTool,'original_build_tool');return proof.originalTool;
}
export function prepareBookingBuiltSmokeRepair(toolRevision,confirmation){
 need(confirmation==='approved-booking-built-smoke-tool-repair','approval');const source=verifySource(toolRevision,ROOT,{bootstrap:true});
 return withOnlineToolPreparationLocks({deployLock:APP+'.deploy.lock',maintenance:'/var/lib/faolla-maintenance/merchant-space'},()=>{
  same(verifySource(toolRevision,ROOT,{bootstrap:true}),source,'source_changed');const before=observeBookingBuiltSmokePair();assertBookingBuiltSmokeToolNoPending();
  const op=RELEASE+'/'+C;for(const name of [BOOKING_BUILT_SMOKE_RECEIPT,BOOKING_BUILT_SMOKE_ORIGINAL]){try{fs.lstatSync(op+'/'+name);need(false,'existing_attempt');}catch(e){if(e.code!=='ENOENT')throw e;}}
  const receipt={schemaVersion:1,kind:'booking-built-smoke-tool-repair',originalTool:P.originalTool,...source,pinsSha256:bookingBuiltSmokePinsSha256,preparedAt:new Date().toISOString()};assertBookingBuiltSmokeReceipt(receipt,{toolRevision});
  const mask=process.umask(0o077);let prepared;try{prepared=executeOnlineReleaseToolPlan(createOnlineReleaseToolPlan(toolRevision));}finally{process.umask(mask);}
  same(verifySource(toolRevision,prepared.directory),source,'prepared_source');same(observeBookingBuiltSmokePair(),before,'before_after_changed');assertBookingBuiltSmokeToolNoPending();
  seal(op+'/'+BOOKING_BUILT_SMOKE_ORIGINAL,read(op+'/state.json',{privateMode:true}));seal(op+'/'+BOOKING_BUILT_SMOKE_RECEIPT,JSON.stringify(receipt,null,2)+'\n');
  same(observeBookingBuiltSmokePair(),before,'after_seal_changed');return {kind:'booking-built-smoke-tool-prepared',toolRevision,applicationRebuilt:false,productionDatabaseChanged:false,trafficChanged:false};
 });
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{need(process.argv.length===5&&process.argv[2]==='prepare','arguments');console.log(JSON.stringify(prepareBookingBuiltSmokeRepair(process.argv[3],process.argv[4])));}catch(e){console.error(/^booking_built_smoke_[a-z_]+$/.test(e.message)?e.message:'booking_built_smoke_unverified');process.exitCode=1;}}
