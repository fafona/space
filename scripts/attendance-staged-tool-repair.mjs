// Approved source-only repair. The application stays a535; no build/process/DB/traffic writer here.
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';import {fileURLToPath,pathToFileURL} from 'node:url';
import {ATTENDANCE_STAGED_REPAIR as p,ATTENDANCE_STAGED_REPAIR_FILES as allowed,
 ATTENDANCE_STAGED_REPAIR_PRESERVED as pins,ATTENDANCE_STAGED_FOLLOW_ON as follow,
 ATTENDANCE_STAGED_SEQUENCE_FOLLOW_ON as sequence,
 assertAttendanceStagedRepairReceipt,assertAttendanceStagedFollowOnReceipt,
 assertAttendanceStagedSequenceFollowOnReceipt} from './attendance-staged-tool-repair-policy.mjs';
import {createOnlineReleaseToolPlan,verifyOnlineReleaseTool,verifyOnlineToolBootstrap,executeOnlineReleaseToolPlan,
 assertOnlineToolNoPending,withOnlineToolPreparationLocks,assertOnlineToolOwnedPath,runOnlineToolGit} from './prepare-online-release-tool.mjs';
import {readOnlineRetentionHistory} from './online-release-retention.mjs';
import {assertOnlineRetentionPublication} from './online-release-retention-policy.mjs';
import {normalizeRetirementProcess} from './online-release-retirement.mjs';

const APP='/www/wwwroot/merchant-space',ROOT=fileURLToPath(new URL('../',import.meta.url));
const maintenance='/var/lib/faolla-maintenance/merchant-space',proxy='/www/server/panel/vhost/nginx/proxy/www.faolla.com';
const receiptFile=`${p.operation}/attendance-staged-tool-repair.json`,sha=x=>createHash('sha256').update(x).digest('hex');
const followOnReceiptFile=`${p.operation}/${follow.receiptName}`;
const sequenceFollowOnReceiptFile=`${p.operation}/${sequence.receiptName}`;
const fail=code=>{throw Error(`attendance_staged_repair_${code}`);};
const need=(x,code)=>{if(!x)fail(code);},git=(directory,args)=>runOnlineToolGit(directory,args).toString('utf8').trim();
const same=(a,b,code)=>need(JSON.stringify(a)===JSON.stringify(b),code);
const env={PATH:'/usr/local/bin:/usr/bin:/bin:/usr/sbin',HOME:'/root',PM2_HOME:'/root/.pm2',LANG:'C.UTF-8',LC_ALL:'C.UTF-8'};
function command(name,args){const r=spawnSync(name,args,{encoding:'utf8',env,timeout:60000,maxBuffer:4*1024**2});need(r.status===0&&!r.error&&!r.signal,'observation_failed');return r.stdout;}
function ownedFile(file,{privateMode=false,maxBytes=4*1024**2}={}){
 assertOnlineToolOwnedPath(file,'file');const before=fs.lstatSync(file);
 need(before.nlink===1&&before.size>0&&before.size<=maxBytes&&(!privateMode||(before.mode&0o777)===0o600),'file_invalid');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const opened=fs.fstatSync(fd),bytes=fs.readFileSync(fd),after=fs.fstatSync(fd),linked=fs.lstatSync(file);
  for(const key of ['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'])need([opened,after,linked].every(s=>s[key]===before[key]),'file_changed');
  need(bytes.length===before.size,'file_changed');return bytes;
 }finally{fs.closeSync(fd);}
}
function evidenceExists(file){try{fs.lstatSync(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
export function stagedRepairImportClosure(readSource){
 const seen=new Set();function visit(name){if(seen.has(name))return;
  need(/^scripts\/[a-z0-9-]+\.mjs$/.test(name),'bootstrap_import_invalid');seen.add(name);
  for(const m of readSource(name).matchAll(/(?:^|(?<=[;\r\n]))\s*(?:import\s+(?:[^;]*?\s+from\s+)?|export\s+[^;]*?\s+from\s+)['"]([^'"]+)['"]\s*;?/gm)){
   if(m[1].startsWith('node:'))continue;need(m[1].startsWith('./'),'bootstrap_import_invalid');
   visit(path.posix.normalize(path.posix.join(path.posix.dirname(name),m[1])));
  }
 }visit('scripts/attendance-staged-tool-repair.mjs');return [...seen].sort();
}
function verifySource(revision,rootDir,{bootstrap=false}={}){
 need(process.platform==='linux'&&process.getuid?.()===0&&/^[a-f0-9]{40}$/.test(revision??'')&&revision!==p.target,'invocation');
 const directory=path.resolve(rootDir);assertOnlineToolOwnedPath(directory);assertOnlineToolOwnedPath(APP);
 need(git(APP,['rev-parse','origin/main'])===revision&&git(directory,['rev-parse','HEAD'])===revision&&
  git(directory,['rev-parse','--abbrev-ref','HEAD'])==='HEAD'&&!git(directory,['status','--porcelain=v1','--untracked-files=all']),'source_identity');
 git(APP,['merge-base','--is-ancestor',p.target,revision]);
 if(!bootstrap){need(directory===`/var/lib/faolla-online-code/${revision}`,'source_location');verifyOnlineReleaseTool(createOnlineReleaseToolPlan(revision));}
 else{
  need(directory===`/var/lib/faolla-online-bootstrap/${revision}`,'bootstrap_location');
  const files=stagedRepairImportClosure(n=>runOnlineToolGit(APP,['show',`${revision}:${n}`]).toString('utf8'));
  const patterns=files.map(n=>`/${n}`).join('\n')+'\n';
  const sparse=path.resolve(directory,git(directory,['rev-parse','--git-path','info/sparse-checkout']));
  need(ownedFile(sparse).toString('utf8')===patterns&&git(directory,['config','--worktree','--get','core.sparseCheckout'])==='true'&&
   git(directory,['config','--worktree','--get','core.sparseCheckoutCone'])==='false'&&git(directory,['config','--worktree','--get','index.sparse'])==='false','bootstrap_sparse');
  const entries=new Set(['.git']);for(const name of files){same(ownedFile(`${directory}/${name}`).toString('hex'),runOnlineToolGit(APP,['show',`${revision}:${name}`]).toString('hex'),'bootstrap_blob');const pieces=name.split('/');while(pieces.length){entries.add(pieces.join('/'));pieces.pop();}}
  const walk=(full,prefix='')=>{for(const e of fs.readdirSync(full,{withFileTypes:true})){const n=prefix+e.name;need(entries.has(n)&&!e.isSymbolicLink(),'bootstrap_entry');assertOnlineToolOwnedPath(path.join(full,e.name),e.isDirectory()?'directory':'file');if(e.isDirectory())walk(path.join(full,e.name),n+'/');}};walk(directory);
  verifyOnlineToolBootstrap(createOnlineReleaseToolPlan(revision),`${directory}/scripts/prepare-online-release-tool.mjs`);
 }
 const changes=git(APP,['diff','--no-renames','--name-status',p.target,revision]).split('\n').filter(Boolean).map(row=>{
  const [status,name,...extra]=row.split('\t');need(['M','A'].includes(status)&&extra.length===0&&allowed.includes(name),'source_scope');return name;
 }).sort();need(changes.includes('scripts/attendance-production-052-compatibility.mjs'),'source_scope');
 const inputs=revision=>runOnlineToolGit(APP,['ls-tree','-r','-z',revision]).toString('utf8').split('\0').filter(Boolean).filter(row=>!allowed.includes(row.slice(row.indexOf('\t')+1))).join('\0');
 const original=inputs(p.target),current=inputs(revision);same(current,original,'application_inputs_changed');
 return {toolRevision:revision,changedToolFiles:changes,sourceInputsSha256:sha(current)};
}
export function attendanceRepairTreeFingerprint(root,{exclude=[],allowInternalLinks=false}={}){
 assertOnlineToolOwnedPath(root);const items=[],buffer=Buffer.alloc(256*1024);let total=0;
 const walk=(directory,prefix='')=>{
  const before=fs.lstatSync(directory),names=fs.readdirSync(directory).sort();
  for(const name of names){const relative=prefix+name;if(exclude.includes(relative))continue;const file=path.join(directory,name),s=fs.lstatSync(file);
   need(s.uid===0,'tree_owner');
   if(s.isSymbolicLink()){
    const target=fs.readlinkSync(file),resolved=fs.realpathSync(file);need(allowInternalLinks&&resolved.startsWith(root+'/')&&s.uid===0,'tree_link');
    const linked=fs.lstatSync(file);for(const k of ['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'])need(linked[k]===s[k],'tree_changed');
    need(fs.readlinkSync(file)===target&&fs.realpathSync(file)===resolved,'tree_changed');
    items.push([relative,'link',target]);continue;
   }
   need((s.mode&0o022)===0,'tree_mode');
   if(s.isDirectory()){walk(file,relative+'/');continue;}
   need(s.isFile()&&s.size>=0&&s.size<=256*1024**2&&items.length<200000,'tree_type');total+=s.size;need(total<3*1024**3,'tree_size');
   const h=createHash('sha256'),fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
   try{const opened=fs.fstatSync(fd);for(const k of ['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'])need(opened[k]===s[k],'tree_changed');
    let n,readBytes=0;while((n=fs.readSync(fd,buffer,0,buffer.length,null))>0){readBytes+=n;need(readBytes<=s.size,'tree_changed');h.update(buffer.subarray(0,n));}
    need(readBytes===s.size,'tree_changed');
    const after=fs.fstatSync(fd),linked=fs.lstatSync(file);for(const k of ['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'])need(after[k]===s[k]&&linked[k]===s[k],'tree_changed');
   }finally{fs.closeSync(fd);}items.push([relative,s.size,h.digest('hex')]);
  }
  same(fs.readdirSync(directory).sort(),names,'tree_changed');const after=fs.lstatSync(directory);
  for(const k of ['dev','ino','uid','mode','mtimeMs','ctimeMs'])need(after[k]===before[k],'tree_changed');
 };walk(root);return {sha256:sha(JSON.stringify(items)),files:items.length,bytes:total};
}
function observe(){
 const stateBytes=ownedFile(`${p.operation}/state.json`,{privateMode:true}),state=JSON.parse(stateBytes);
 need(sha(stateBytes)===p.stateSha256&&state.status==='staged'&&state.target===p.target&&state.baseline===p.baseline&&
  state.directory===p.directory&&state.lane==='attendance'&&state.attendanceEnabled===false&&state.attendanceBuildProofSha256===p.buildProofSha256,'candidate_changed');
 assertOnlineToolOwnedPath(p.directory);
 need(git(p.directory,['rev-parse','HEAD'])===p.target&&!git(p.directory,['status','--porcelain=v1','--untracked-files=all']),'candidate_source_changed');
 const preserved={};for(const name of Object.keys(pins)){
  const file=name==='.env.local'?`${p.directory}/${name}`:name==='BUILD_ID'?`${p.directory}/.next/BUILD_ID`:
   name==='stage.log'?`/var/log/faolla-attendance-publication/${p.target}-stage.log`:`${p.operation}/${name}`;
  preserved[name]=sha(ownedFile(file,{privateMode:!['BUILD_ID'].includes(name),maxBytes:8*1024**2}));
 }same(preserved,pins,'preserved_evidence_changed');
 const proof=JSON.parse(ownedFile(`${p.operation}/attendance-build-proof.json`,{privateMode:true}));
 need(proof.target===p.target&&proof.buildId===ownedFile(`${p.directory}/.next/BUILD_ID`).toString('utf8').trim()&&
  proof.guardedCommand==='npm run build'&&proof.memoryBytes===4294967296&&proof.heapMiB===3072&&proof.cpuQuotaPercent===100&&
  proof.tasks===128&&proof.seconds===1200&&proof.privateNetworkVerified===true&&proof.swapBytes===0,'build_proof_changed');
 const activeBytes=ownedFile('/var/lib/faolla-online-release/active.json',{privateMode:true}),active=JSON.parse(activeBytes);
 need(sha(activeBytes)===p.activeSha256&&active.target===p.baseline,'baseline_changed');
 need(sha(ownedFile(`${maintenance}/state.json`,{privateMode:true}))===p.maintenanceSha256&&
  JSON.parse(ownedFile(`${maintenance}/state.json`,{privateMode:true})).phase==='ended','maintenance_changed');
 need(sha(ownedFile(`${proxy}/faolla_web_release.conf`))===p.markerSha256,'marker_changed');
 for(const [name,v] of Object.entries(state.configs))need(sha(ownedFile(`${proxy}/${name}`))===v.oldHash,'proxy_changed');
 const processes=JSON.parse(command('pm2',['jlist'])),history=readOnlineRetentionHistory();
 need(history.headSha256===p.retentionHeadSha256,'retention_changed');
 assertOnlineRetentionPublication({history,state,actualActive:active,current:processes.map(normalizeRetirementProcess),action:'status'});
 const own=processes.find(x=>x.name===state.name);
 need(own?.pm2_env?.pm_cwd===p.directory&&own.pm2_env.status==='online'&&own.pm2_env.FAOLLA_BACKGROUND_JOBS_PAUSED==='1'&&
  own.pm2_env.MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED==='0'&&own.pm2_env.MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED==='0','candidate_process_changed');
 const built=attendanceRepairTreeFingerprint(`${p.directory}/.next`,{exclude:['cache','trace']});need(built.sha256===p.builtOutputSha256,'build_output_changed');
 const dependency=attendanceRepairTreeFingerprint(`${p.directory}/node_modules`,{allowInternalLinks:true});
 // The owned live stable dependency copy is never modified by this operation.
 same(dependency,attendanceRepairTreeFingerprint(`${state.oldDirectory}/node_modules`,{allowInternalLinks:true}),'dependencies_changed');
 need(ownedFile(`${p.directory}/package-lock.json`).equals(runOnlineToolGit(APP,['show',`${p.target}:package-lock.json`])),'dependencies_changed');
 const manifest=JSON.parse(ownedFile(`${p.directory}/scripts/attendance-production-database-migrations.manifest.json`));
 need(sha(ownedFile(`${p.directory}/scripts/attendance-production-database-migrations.manifest.json`))===p.scopeSha256&&manifest.migrations.length===149,'migration_scope');
 for(const m of manifest.migrations)need(sha(ownedFile(`${p.directory}/scripts/supabase-migrations/${m.fileName}`))===m.sha256,'migration_source_changed');
 return {preservedFiles:preserved,builtOutputSha256:built.sha256,dependencySha256:dependency.sha256};
}
function originalFollowOnReceipt(){
 const raw=ownedFile(receiptFile,{privateMode:true}),receipt=JSON.parse(raw);
 need(sha(raw)===follow.previousReceiptSha256,'original_receipt_changed');
 assertAttendanceStagedRepairReceipt(receipt,{target:p.target,toolRevision:follow.previousToolRevision});
 assertOnlineToolOwnedPath(APP);git(APP,['merge-base','--is-ancestor',p.target,follow.previousToolRevision]);
 // Historical Git evidence is not executed and does not weaken the current
 // main/clean/detached gate in verifySource for the effective new tool revision.
 const changes=git(APP,['diff','--no-renames','--name-status',p.target,follow.previousToolRevision]).split('\n').filter(Boolean).map(row=>{
  const [status,name,...extra]=row.split('\t');need(['M','A'].includes(status)&&extra.length===0&&allowed.includes(name),'original_receipt_source');return name;
 }).sort();same(changes,receipt.changedToolFiles,'original_receipt_source');
 const inputs=revision=>runOnlineToolGit(APP,['ls-tree','-r','-z',revision]).toString('utf8').split('\0').filter(Boolean)
  .filter(row=>!allowed.includes(row.slice(row.indexOf('\t')+1))).join('\0');
 const original=inputs(p.target),previous=inputs(follow.previousToolRevision);same(previous,original,'original_receipt_source');
 need(sha(previous)===receipt.sourceInputsSha256,'original_receipt_source');
 return {receipt,receiptSha256:sha(raw)};
}
function archivedFollowOnFailure(){
 const archive=follow.archive;assertOnlineToolOwnedPath(archive.directory);
 const before=fs.lstatSync(archive.directory);need((before.mode&0o777)===0o700,'failure_archive_invalid');
 const names=Object.keys(archive.files).sort();same(fs.readdirSync(archive.directory).sort(),names,'failure_archive_invalid');
 for(const name of names)need(sha(ownedFile(`${archive.directory}/${name}`,{privateMode:true,maxBytes:8*1024**2}))===archive.files[name],'failure_archive_changed');
 same(fs.readdirSync(archive.directory).sort(),names,'failure_archive_changed');const after=fs.lstatSync(archive.directory);
 for(const key of ['dev','ino','uid','mode','mtimeMs','ctimeMs'])need(after[key]===before[key],'failure_archive_changed');
 return archive;
}
function previousSequenceFollowOnReceipt(){
 const original=originalFollowOnReceipt(),raw=ownedFile(followOnReceiptFile,{privateMode:true}),receipt=JSON.parse(raw);
 need(sha(raw)===sequence.previousReceiptSha256,'previous_receipt_changed');
 assertAttendanceStagedFollowOnReceipt(receipt,{originalReceipt:original.receipt,originalReceiptSha256:original.receiptSha256,
  target:p.target,toolRevision:sequence.previousToolRevision});
 git(APP,['merge-base','--is-ancestor',follow.previousToolRevision,sequence.previousToolRevision]);
 const changes=git(APP,['diff','--no-renames','--name-status',p.target,sequence.previousToolRevision]).split('\n').filter(Boolean).map(row=>{
  const [status,name,...extra]=row.split('\t');need(['M','A'].includes(status)&&extra.length===0&&allowed.includes(name),'previous_receipt_source');return name;
 }).sort();same(changes,receipt.effectiveReceipt.changedToolFiles,'previous_receipt_source');
 const inputs=revision=>runOnlineToolGit(APP,['ls-tree','-r','-z',revision]).toString('utf8').split('\0').filter(Boolean)
  .filter(row=>!allowed.includes(row.slice(row.indexOf('\t')+1))).join('\0');
 const baseline=inputs(p.target),previous=inputs(sequence.previousToolRevision);same(previous,baseline,'previous_receipt_source');
 need(sha(previous)===receipt.effectiveReceipt.sourceInputsSha256,'previous_receipt_source');
 archivedFollowOnFailure();need(ownedFile(followOnReceiptFile,{privateMode:true}).equals(raw),'previous_receipt_changed');
 same(originalFollowOnReceipt(),original,'original_receipt_changed');
 return {original,receipt,receiptSha256:sha(raw)};
}
function archivedSequenceFollowOnFailure(){
 const archive=sequence.archive;need(Object.values(archive.files).every(x=>/^[a-f0-9]{64}$/.test(x)),'failure_archive_pending');
 assertOnlineToolOwnedPath(archive.directory);
 const before=fs.lstatSync(archive.directory);need((before.mode&0o777)===0o700,'failure_archive_invalid');
 const names=Object.keys(archive.files).sort();same(fs.readdirSync(archive.directory).sort(),names,'failure_archive_invalid');
 for(const name of names)need(sha(ownedFile(`${archive.directory}/${name}`,{privateMode:true,maxBytes:8*1024**2}))===archive.files[name],'failure_archive_changed');
 same(fs.readdirSync(archive.directory).sort(),names,'failure_archive_changed');const after=fs.lstatSync(archive.directory);
 for(const key of ['dev','ino','uid','mode','mtimeMs','ctimeMs'])need(after[key]===before[key],'failure_archive_changed');
 return archive;
}
export function verifyAttendanceStagedToolRepairReceipt({target,rootDir=ROOT,phase='staged'}={}){
 need(target===p.target&&['staged','migration'].includes(phase),'receipt_target');
 const raw=ownedFile(receiptFile,{privateMode:true}),receipt=JSON.parse(raw);assertAttendanceStagedRepairReceipt(receipt,{target});
 if(evidenceExists(sequenceFollowOnReceiptFile)){
  const previous=previousSequenceFollowOnReceipt(),sequenceRaw=ownedFile(sequenceFollowOnReceiptFile,{privateMode:true}),chain=JSON.parse(sequenceRaw);
  assertAttendanceStagedSequenceFollowOnReceipt(chain,{originalReceipt:previous.original.receipt,originalReceiptSha256:previous.original.receiptSha256,
   previousReceipt:previous.receipt,previousReceiptSha256:previous.receiptSha256,target});
  git(APP,['merge-base','--is-ancestor',sequence.previousToolRevision,chain.effectiveReceipt.toolRevision]);
  archivedSequenceFollowOnFailure();const effective=chain.effectiveReceipt,source=verifySource(effective.toolRevision,rootDir),observed=observe();
  same(source.changedToolFiles,effective.changedToolFiles,'receipt_source_changed');need(source.sourceInputsSha256===effective.sourceInputsSha256,'receipt_source_changed');
  need(observed.dependencySha256===effective.dependencySha256,'receipt_dependencies_changed');
  need(ownedFile(sequenceFollowOnReceiptFile,{privateMode:true}).equals(sequenceRaw),'receipt_changed');archivedSequenceFollowOnFailure();
  same(previousSequenceFollowOnReceipt(),previous,'previous_receipt_changed');
  need(ownedFile(receiptFile,{privateMode:true}).equals(raw),'original_receipt_changed');
  return {receipt:effective,receiptSha256:sha(sequenceRaw),toolRevision:effective.toolRevision,
   originalReceiptSha256:previous.original.receiptSha256,previousReceiptSha256:previous.receiptSha256,receiptKind:chain.kind};
 }
 if(evidenceExists(followOnReceiptFile)){
  const original=originalFollowOnReceipt(),followRaw=ownedFile(followOnReceiptFile,{privateMode:true}),chain=JSON.parse(followRaw);
  assertAttendanceStagedFollowOnReceipt(chain,{originalReceipt:original.receipt,originalReceiptSha256:original.receiptSha256,target});
  git(APP,['merge-base','--is-ancestor',follow.previousToolRevision,chain.effectiveReceipt.toolRevision]);
  archivedFollowOnFailure();const effective=chain.effectiveReceipt,source=verifySource(effective.toolRevision,rootDir),observed=observe();
  same(source.changedToolFiles,effective.changedToolFiles,'receipt_source_changed');need(source.sourceInputsSha256===effective.sourceInputsSha256,'receipt_source_changed');
  need(observed.dependencySha256===effective.dependencySha256,'receipt_dependencies_changed');
  need(ownedFile(followOnReceiptFile,{privateMode:true}).equals(followRaw),'receipt_changed');archivedFollowOnFailure();
  same(originalFollowOnReceipt(),original,'original_receipt_changed');
  return {receipt:effective,receiptSha256:sha(followRaw),toolRevision:effective.toolRevision,
   originalReceiptSha256:original.receiptSha256,receiptKind:chain.kind};
 }
 const source=verifySource(receipt.toolRevision,rootDir),observed=observe();
 same(source.changedToolFiles,receipt.changedToolFiles,'receipt_source_changed');need(source.sourceInputsSha256===receipt.sourceInputsSha256,'receipt_source_changed');
 need(observed.dependencySha256===receipt.dependencySha256,'receipt_dependencies_changed');
 return {receipt,receiptSha256:sha(raw),toolRevision:receipt.toolRevision};
}
export function prepareAttendanceStagedToolRepair(revision,confirm){
 need(confirm==='approved-staged-attendance-tool-repair','approval_required');
 const source=verifySource(revision,ROOT,{bootstrap:true});
 return withOnlineToolPreparationLocks({deployLock:`${APP}.deploy.lock`,maintenance},()=>{
  verifySource(revision,ROOT,{bootstrap:true});need(!fs.existsSync(receiptFile),'receipt_exists');
  for(const name of ['attendance-database-compatibility.json','attendance-compatibility-attempt.json','attendance-compatibility-metadata.sql',
   'attendance-database-progress.json','attendance-database-ready.json'])need(!fs.existsSync(`${p.operation}/${name}`),'database_attempt_exists');
  const before=observe(),receipt={schemaVersion:1,kind:'attendance-staged-tool-repair',target:p.target,baseline:p.baseline,
   toolRevision:revision,originalStateSha256:p.stateSha256,originalBuildProofSha256:p.buildProofSha256,sourceInputsSha256:source.sourceInputsSha256,
   builtOutputSha256:before.builtOutputSha256,scopeSha256:p.scopeSha256,preservedFiles:before.preservedFiles,activeSha256:p.activeSha256,
   maintenanceSha256:p.maintenanceSha256,markerSha256:p.markerSha256,retentionHeadSha256:p.retentionHeadSha256,
   dependencySha256:before.dependencySha256,changedToolFiles:source.changedToolFiles,approvedNoRebuild:true,preparedAt:new Date().toISOString()};
  assertAttendanceStagedRepairReceipt(receipt,{target:p.target,toolRevision:revision});
  assertOnlineToolNoPending({fixedStagedRepairReceipt:receipt});const plan=createOnlineReleaseToolPlan(revision),prior=process.umask(0o077);
  let prepared;try{prepared=executeOnlineReleaseToolPlan(plan);}finally{process.umask(prior);}
  verifySource(revision,prepared.directory);same(observe(),before,'candidate_changed_during_preparation');
  const fd=fs.openSync(receiptFile,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,JSON.stringify(receipt,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const directory=fs.openSync(p.operation,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
  same(JSON.parse(ownedFile(receiptFile,{privateMode:true})),receipt,'receipt_write_changed');
  return {status:'staged-tool-repair-prepared',target:p.target,toolRevision:revision,receiptSha256:sha(ownedFile(receiptFile,{privateMode:true})),
   applicationRebuilt:false,productionDatabaseChanged:false,trafficChanged:false,source:prepared};
 });
}
export function prepareAttendanceStagedToolRepairFollowOn(revision,confirm){
 need(confirm==='approved-staged-attendance-tool-repair-follow-on','approval_required');
 need(revision!==follow.previousToolRevision,'follow_on_revision');const source=verifySource(revision,ROOT,{bootstrap:true});
 git(APP,['merge-base','--is-ancestor',follow.previousToolRevision,revision]);
 return withOnlineToolPreparationLocks({deployLock:`${APP}.deploy.lock`,maintenance},()=>{
  verifySource(revision,ROOT,{bootstrap:true});need(!evidenceExists(followOnReceiptFile),'follow_on_receipt_exists');
  for(const name of ['attendance-database-compatibility.json','attendance-compatibility-attempt.json','attendance-compatibility-metadata.sql',
   'attendance-database-progress.json','attendance-database-ready.json'])need(!evidenceExists(`${p.operation}/${name}`),'database_attempt_exists');
  const original=originalFollowOnReceipt(),archive=archivedFollowOnFailure(),before=observe();
  need(before.dependencySha256===original.receipt.dependencySha256&&source.sourceInputsSha256===original.receipt.sourceInputsSha256,'original_receipt_changed');
  const preparedAt=new Date().toISOString(),effective={schemaVersion:1,kind:'attendance-staged-tool-repair',target:p.target,baseline:p.baseline,
   toolRevision:revision,originalStateSha256:p.stateSha256,originalBuildProofSha256:p.buildProofSha256,sourceInputsSha256:source.sourceInputsSha256,
   builtOutputSha256:before.builtOutputSha256,scopeSha256:p.scopeSha256,preservedFiles:before.preservedFiles,activeSha256:p.activeSha256,
   maintenanceSha256:p.maintenanceSha256,markerSha256:p.markerSha256,retentionHeadSha256:p.retentionHeadSha256,
   dependencySha256:before.dependencySha256,changedToolFiles:source.changedToolFiles,approvedNoRebuild:true,preparedAt};
  const chain={schemaVersion:1,kind:'attendance-staged-tool-repair-follow-on',target:p.target,baseline:p.baseline,
   previousToolRevision:follow.previousToolRevision,previousReceiptSha256:original.receiptSha256,
   failedAttemptArchive:archive,effectiveReceipt:effective,preparedAt};
  assertAttendanceStagedFollowOnReceipt(chain,{originalReceipt:original.receipt,originalReceiptSha256:original.receiptSha256,target:p.target,toolRevision:revision});
  // This is a truthful new effective receipt, not a mutation/relabel of the old file.
  assertOnlineToolNoPending({fixedStagedRepairReceipt:effective});const plan=createOnlineReleaseToolPlan(revision),prior=process.umask(0o077);
  let prepared;try{prepared=executeOnlineReleaseToolPlan(plan);}finally{process.umask(prior);}
  verifySource(revision,prepared.directory);same(observe(),before,'candidate_changed_during_preparation');
  same(originalFollowOnReceipt(),original,'original_receipt_changed');same(archivedFollowOnFailure(),archive,'failure_archive_changed');
  const fd=fs.openSync(followOnReceiptFile,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,JSON.stringify(chain,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const directory=fs.openSync(p.operation,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
  const sealed=ownedFile(followOnReceiptFile,{privateMode:true});same(JSON.parse(sealed),chain,'receipt_write_changed');
  same(originalFollowOnReceipt(),original,'original_receipt_changed');
  return {status:'staged-tool-repair-follow-on-prepared',target:p.target,toolRevision:revision,receiptSha256:sha(sealed),
   originalReceiptSha256:original.receiptSha256,applicationRebuilt:false,productionDatabaseChanged:false,trafficChanged:false,source:prepared};
 });
}
export function prepareAttendanceStagedToolRepairSequenceFollowOn(revision,confirm){
 need(confirm==='approved-staged-attendance-tool-repair-sequence-follow-on','approval_required');
 need(revision!==sequence.previousToolRevision&&revision!==follow.previousToolRevision,'sequence_follow_on_revision');
 const source=verifySource(revision,ROOT,{bootstrap:true});git(APP,['merge-base','--is-ancestor',sequence.previousToolRevision,revision]);
 return withOnlineToolPreparationLocks({deployLock:`${APP}.deploy.lock`,maintenance},()=>{
  verifySource(revision,ROOT,{bootstrap:true});need(!evidenceExists(sequenceFollowOnReceiptFile),'sequence_follow_on_receipt_exists');
  for(const name of ['attendance-database-compatibility.json','attendance-compatibility-attempt.json','attendance-compatibility-metadata.sql',
   'attendance-compatibility-extension-metadata.json','attendance-compatibility-extension-supplement.sql',
   'attendance-database-progress.json','attendance-database-ready.json'])need(!evidenceExists(`${p.operation}/${name}`),'database_attempt_exists');
  const previous=previousSequenceFollowOnReceipt(),archive=archivedSequenceFollowOnFailure(),before=observe();
  need(before.dependencySha256===previous.receipt.effectiveReceipt.dependencySha256&&
   source.sourceInputsSha256===previous.receipt.effectiveReceipt.sourceInputsSha256,'previous_receipt_changed');
  const preparedAt=new Date().toISOString(),effective={schemaVersion:1,kind:'attendance-staged-tool-repair',target:p.target,baseline:p.baseline,
   toolRevision:revision,originalStateSha256:p.stateSha256,originalBuildProofSha256:p.buildProofSha256,sourceInputsSha256:source.sourceInputsSha256,
   builtOutputSha256:before.builtOutputSha256,scopeSha256:p.scopeSha256,preservedFiles:before.preservedFiles,activeSha256:p.activeSha256,
   maintenanceSha256:p.maintenanceSha256,markerSha256:p.markerSha256,retentionHeadSha256:p.retentionHeadSha256,
   dependencySha256:before.dependencySha256,changedToolFiles:source.changedToolFiles,approvedNoRebuild:true,preparedAt};
  const chain={schemaVersion:1,kind:'attendance-staged-tool-repair-sequence-follow-on',target:p.target,baseline:p.baseline,
   previousToolRevision:sequence.previousToolRevision,previousReceiptSha256:previous.receiptSha256,
   failedAttemptArchive:archive,effectiveReceipt:effective,preparedAt};
  assertAttendanceStagedSequenceFollowOnReceipt(chain,{originalReceipt:previous.original.receipt,originalReceiptSha256:previous.original.receiptSha256,
   previousReceipt:previous.receipt,previousReceiptSha256:previous.receiptSha256,target:p.target,toolRevision:revision});
  assertOnlineToolNoPending({fixedStagedRepairReceipt:effective});const plan=createOnlineReleaseToolPlan(revision),prior=process.umask(0o077);
  let prepared;try{prepared=executeOnlineReleaseToolPlan(plan);}finally{process.umask(prior);}
  verifySource(revision,prepared.directory);same(observe(),before,'candidate_changed_during_preparation');
  same(previousSequenceFollowOnReceipt(),previous,'previous_receipt_changed');same(archivedSequenceFollowOnFailure(),archive,'failure_archive_changed');
  const fd=fs.openSync(sequenceFollowOnReceiptFile,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,JSON.stringify(chain,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const directory=fs.openSync(p.operation,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
  const sealed=ownedFile(sequenceFollowOnReceiptFile,{privateMode:true});same(JSON.parse(sealed),chain,'receipt_write_changed');
  same(previousSequenceFollowOnReceipt(),previous,'previous_receipt_changed');same(archivedSequenceFollowOnFailure(),archive,'failure_archive_changed');
  return {status:'staged-tool-repair-sequence-follow-on-prepared',target:p.target,toolRevision:revision,receiptSha256:sha(sealed),
   originalReceiptSha256:previous.original.receiptSha256,previousReceiptSha256:previous.receiptSha256,
   applicationRebuilt:false,productionDatabaseChanged:false,trafficChanged:false,source:prepared};
 });
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{
 const args=process.argv.slice(2);need(args.length===3&&['prepare','prepare-follow-on','prepare-sequence-follow-on'].includes(args[0]),'invocation');
 const prepare=args[0]==='prepare'?prepareAttendanceStagedToolRepair:args[0]==='prepare-follow-on'?
  prepareAttendanceStagedToolRepairFollowOn:prepareAttendanceStagedToolRepairSequenceFollowOn;
 console.log(JSON.stringify(prepare(args[1],args[2])));
}catch(e){console.error(/^attendance_staged_repair_[a-z_]+$/.test(e?.message??'')?e.message:'attendance_staged_repair_unverified');process.exitCode=1;}}
