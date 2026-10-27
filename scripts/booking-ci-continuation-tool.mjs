// Source-only preparation of the separately approved fixed CI successor.
// No application build, process signal, SQL, cleanup or old evidence overwrite.
import * as fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {BOOKING_CI_BASE as BASE,BOOKING_CI_VERIFIED_SOURCE as VERIFIED,BOOKING_CI_RECEIPT as RECEIPT,
 BOOKING_CI_EVIDENCE,BOOKING_CI_FILES,bookingCiInputs,assertBookingCiToolDelta,assertBookingCurrentToolClosure,assertBookingCiReceipt} from './booking-ci-continuation-policy.mjs';
import {BOOKING_FORMAL_PRIOR_TOOL as PRIOR,BOOKING_FORMAL_FILES,assertBookingFormalToolDelta} from './booking-formal-backup-policy.mjs';
import {readBookingFormalFile as read,observeBookingFormalContinuation,assertBookingFormalPreserved} from './booking-formal-backup-tool.mjs';
import {BOOKING_HANDOFF_CANDIDATE as C} from './booking-handoff-policy.mjs';
import {BOOKING_REGISTRY_ORIGINAL_TOOL} from './booking-registry-tool-policy.mjs';
import {assertBookingRegistryToolNoPending} from './booking-handoff-pending.mjs';
import {verifyHistoricalOnlineTool} from './online-release-tool-retention.mjs';
import {createOnlineReleaseToolPlan,verifyOnlineReleaseTool,verifyOnlineToolBootstrap,executeOnlineReleaseToolPlan,
 assertOnlineToolOwnedPath,runOnlineToolGit,withOnlineToolPreparationLocks} from './prepare-online-release-tool.mjs';
const APP='/www/wwwroot/merchant-space',OP='/var/lib/faolla-online-release/'+C;
const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url))),SELF='scripts/booking-ci-continuation-tool.mjs';
const need=(v,c)=>{if(!v)throw Error('booking_ci_continuation_'+c);};
const hash=x=>createHash('sha256').update(x).digest('hex');
const same=(a,b,c)=>need(isDeepStrictEqual(a,b),c);
const git=(cwd,args)=>runOnlineToolGit(cwd,args).toString().trim();
const rows=revision=>runOnlineToolGit(APP,['ls-tree','-r','-z',revision]).toString().split('\0').filter(Boolean);
const changes=(before,after)=>git(APP,['diff','--no-renames','--name-status',before,after]).split('\n').filter(Boolean).map(row=>{
 const [status,name,...extra]=row.split('\t');need(['M','A'].includes(status)&&!extra.length,'source_delta');return name;
});
export function bookingCiToolImportClosure(readSource){
 const seen=new Set();function visit(file){if(seen.has(file))return;need(/^scripts\/[a-z0-9-]+\.mjs$/.test(file),'import_path');seen.add(file);
  for(const m of readSource(file).matchAll(/(?:^|(?<=[;\r\n]))\s*(?:import\s+(?:[^;]*?\s+from\s+)?|export\s+[^;]*?\s+from\s+)['"]([^'"]+)['"]\s*;?/gm)){
   if(m[1].startsWith('node:'))continue;need(m[1].startsWith('./'),'import_path');visit(path.posix.normalize(path.posix.join(path.posix.dirname(file),m[1])));
  }
 }visit(SELF);return [...seen].sort();
}
export function assertBookingCiKernelEvidence(){
 const bytes=Object.fromEntries(Object.entries(BOOKING_CI_EVIDENCE).map(([name,pin])=>{
  const value=read(OP+'/'+name);need(hash(value)===pin,'kernel_evidence_digest');return [name,value];
 }));
 const decode=value=>value.toString('utf16le').replace(/^\uFEFF/,'');
 const log=decode(bytes['booking-ci-kernel7-job.log']),metadata=JSON.parse(decode(bytes['booking-ci-kernel7-run.json']));
 need(metadata.attempt===9&&metadata.headSha===VERIFIED&&metadata.status==='completed','kernel_evidence_identity');
 const job=metadata.jobs?.find(j=>j.databaseId===122344176257);
 need(job?.conclusion==='success'&&job.status==='completed'&&job.url==='https://github.com/fafona/space/actions/runs/40523080088/job/122344176257','kernel_evidence_job');
 for(const label of ['Initialize Bridge Netfilter Module on Disposable CI Host Only','Run Real Ingress Rules Only Inside New Network Namespace'])
  need(job.steps.some(s=>s.name===label&&s.status==='completed'&&s.conclusion==='success'),'kernel_evidence_step');
 need(log.includes('Version: 20261025.353.1')&&log.includes('ingress-preflight os=ubuntu:24.04 kernel=7.0.0-1017-azure'),'kernel_evidence_host');
 const reports=log.split(/\r?\n/).flatMap(line=>{
  const start=line.indexOf('{"ok":');if(start<0)return [];try{return [JSON.parse(line.slice(start))];}catch{return [];}
 });
 need(reports.some(r=>r.ok===true&&r.groups===7&&r.namespaceIsolated===true&&r.kernelRelease==='7.0.0-1017-azure'&&
  r.planSha256==='63b3225a508d3191fe7c0c0e61c02ea0afa46ce9120a4c7f2d77da0ab84069a7'&&r.nginxEvidence==='synthetic_config_and_requests_only'),'kernel_evidence_acceptance');
 // This binds the genuine ingress job ONLY, not the failed aggregate old run.
 return hash(JSON.stringify(BOOKING_CI_EVIDENCE));
}
function verifySource(toolRevision,directory,{bootstrap=false}={}){
 need(process.platform==='linux'&&process.getuid?.()===0&&/^[a-f0-9]{40}$/.test(toolRevision??'')&&![PRIOR,BASE,VERIFIED].includes(toolRevision),'invocation');
 need(git(APP,['rev-parse','origin/main'])===toolRevision&&git(directory,['rev-parse','HEAD'])===toolRevision&&
  git(directory,['rev-parse','--abbrev-ref','HEAD'])==='HEAD'&&!git(directory,['status','--porcelain=v1','--untracked-files=all']),'source_identity');
 git(APP,['merge-base','--is-ancestor',BASE,toolRevision]);git(APP,['merge-base','--is-ancestor',VERIFIED,toolRevision]);
 const oldInputs=revision=>rows(revision).filter(r=>!BOOKING_FORMAL_FILES.includes(r.slice(r.indexOf('\t')+1))).join('\0');
 assertBookingFormalToolDelta({files:changes(PRIOR,BASE),originalInputs:oldInputs(PRIOR),currentInputs:oldInputs(BASE)});
 const sourceInputsSha256=assertBookingCiToolDelta({files:changes(BASE,toolRevision),originalInputs:bookingCiInputs(rows(BASE)),
  currentInputs:bookingCiInputs(rows(toolRevision)),readBlob:f=>runOnlineToolGit(APP,['show',toolRevision+':'+f])});
 verifyHistoricalOnlineTool(createOnlineReleaseToolPlan(PRIOR),toolRevision);
 const plan=createOnlineReleaseToolPlan(toolRevision);verifyOnlineToolBootstrap(plan,directory+'/scripts/prepare-online-release-tool.mjs');
 if(bootstrap){
  need(directory==='/var/lib/faolla-online-bootstrap/'+toolRevision,'bootstrap_path');
  const files=bookingCiToolImportClosure(f=>runOnlineToolGit(APP,['show',toolRevision+':'+f]).toString());
  const sparse=path.resolve(directory,git(directory,['rev-parse','--git-path','info/sparse-checkout']));
  need(read(sparse,{privateMode:false}).toString()===files.map(f=>'/'+f).join('\n')+'\n'&&
   git(directory,['config','--worktree','--get','core.sparseCheckout'])==='true'&&git(directory,['config','--worktree','--get','core.sparseCheckoutCone'])==='false'&&
   git(directory,['config','--worktree','--get','index.sparse'])==='false','bootstrap_sparse');
  const entries=new Set(['.git']);for(const f of files){same(read(directory+'/'+f,{privateMode:false}),runOnlineToolGit(APP,['show',toolRevision+':'+f]),'bootstrap_blob');
   const pieces=f.split('/');while(pieces.length){entries.add(pieces.join('/'));pieces.pop();}}
  function walk(dir,prefix=''){for(const e of fs.readdirSync(dir,{withFileTypes:true})){need(entries.has(prefix+e.name)&&!e.isSymbolicLink(),'bootstrap_entry');assertOnlineToolOwnedPath(dir+'/'+e.name,e.isDirectory()?'directory':'file');if(e.isDirectory())walk(dir+'/'+e.name,prefix+e.name+'/');}}walk(directory);
 }else{need(directory==='/var/lib/faolla-online-code/'+toolRevision,'tool_path');verifyOnlineReleaseTool(plan);}
 const files=git(APP,['diff','--name-only',C,toolRevision]).split('\n');
 const toolClosureSha256=assertBookingCurrentToolClosure({baseline:C,files,readBlob:f=>runOnlineToolGit(APP,['show',toolRevision+':'+f])});
 need(BOOKING_CI_FILES.every(f=>files.includes(f)),'closure');
 return {sourceInputsSha256,toolClosureSha256};
}
export function assertBookingCiToolSource(toolRevision){
 const source=verifySource(toolRevision,ROOT),receipt=JSON.parse(read(OP+'/'+RECEIPT));assertBookingCiReceipt(receipt,toolRevision);
 same(source,{sourceInputsSha256:receipt.sourceInputsSha256,toolClosureSha256:receipt.toolClosureSha256},'receipt_source');
 need(receipt.kernelEvidenceSha256===assertBookingCiKernelEvidence(),'receipt_kernel');
 need(receipt.preservedSha256===assertBookingFormalPreserved(),'receipt_preserved');
 return source;
}
export function assertBookingCiContinuation({toolRevision,phase='staged'}){
 assertBookingCiToolSource(toolRevision);return observeBookingFormalContinuation(phase);
}
export function assertBookingCiRuntimeContinuation({toolRevision,primary,rollback}){
 assertBookingCiContinuation({toolRevision,phase:'database-ready'});
 need(primary.bookingReviewedStage?.toolRevision===BOOKING_REGISTRY_ORIGINAL_TOOL&&
  primary.bookingReviewedStage.toolClosureSha256==='1660fac7e48e5e18d11b439f01626d8f0823afebfb1eed00035cbef51caf65fa'&&
  rollback.toolRevision===BOOKING_REGISTRY_ORIGINAL_TOOL,'original_build_tool');return BOOKING_REGISTRY_ORIGINAL_TOOL;
}
function seal(value){
 assertOnlineToolOwnedPath(OP);need((fs.lstatSync(OP).mode&0o777)===0o700,'private_parent');
 const file=OP+'/'+RECEIPT,bytes=Buffer.from(JSON.stringify(value,null,2)+'\n'),fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const parent=fs.openSync(OP,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}same(read(file),bytes,'seal');
}
export function prepareBookingCiTool(toolRevision,confirmation){
 need(confirmation==='approved-booking-ci-only-continuation','approval');const source=verifySource(toolRevision,ROOT,{bootstrap:true});
 return withOnlineToolPreparationLocks({deployLock:APP+'.deploy.lock',maintenance:'/var/lib/faolla-maintenance/merchant-space'},()=>{
  same(verifySource(toolRevision,ROOT,{bootstrap:true}),source,'source_changed');
  const before=observeBookingFormalContinuation(),kernelEvidenceSha256=assertBookingCiKernelEvidence();assertBookingRegistryToolNoPending();
  try{fs.lstatSync(OP+'/'+RECEIPT);need(false,'existing_attempt');}catch(e){if(e.code!=='ENOENT')throw e;}
  const receipt={schemaVersion:1,kind:'booking-ci-continuation-tool',priorTool:PRIOR,base:BASE,verifiedCiSource:VERIFIED,toolRevision,
   ...source,preservedSha256:before.formalPreservedSha256,kernelEvidenceSha256,preparedAt:new Date().toISOString()};
  assertBookingCiReceipt(receipt,toolRevision);const mask=process.umask(0o077);let prepared;
  try{prepared=executeOnlineReleaseToolPlan(createOnlineReleaseToolPlan(toolRevision));}finally{process.umask(mask);}
  same(verifySource(toolRevision,prepared.directory),source,'prepared_source');same(observeBookingFormalContinuation(),before,'before_after_changed');
  need(assertBookingCiKernelEvidence()===kernelEvidenceSha256,'kernel_changed');assertBookingRegistryToolNoPending();
  seal(receipt);same(observeBookingFormalContinuation(),before,'after_seal_changed');
  need(assertBookingCiKernelEvidence()===kernelEvidenceSha256,'kernel_changed');
  return {kind:'booking-ci-continuation-tool-prepared',toolRevision,applicationRebuilt:false,productionDatabaseChanged:false,trafficChanged:false};
 });
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{
 need(process.argv.length===5&&process.argv[2]==='prepare','arguments');console.log(JSON.stringify(prepareBookingCiTool(process.argv[3],process.argv[4])));
}catch(e){console.error(/^booking_ci_continuation_[a-z_]+$/.test(e.message)?e.message:'booking_ci_continuation_unverified');process.exitCode=1;}}
