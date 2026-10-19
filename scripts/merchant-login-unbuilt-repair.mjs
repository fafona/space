// One reviewed unbuilt-candidate continuation. Original application and runtime
// bytes stay sealed; only the synthetic test subprocess gets a clean environment.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {LOGIN_UNBUILT_REPAIR as p,LOGIN_UNBUILT_REPAIR_FILES as allowed,
 LOGIN_UNBUILT_REPAIR_PATHS as paths,LOGIN_UNBUILT_REPAIR_PRESERVED as pins,
 LOGIN_UNBUILT_REPAIR_ABSENT as absent,assertLoginUnbuiltRepairReceipt,
 assertLoginUnbuiltRepairToolScope,assertLoginUnbuiltState,loginUnitTestEnvironment} from './merchant-login-unbuilt-repair-policy.mjs';
import {createOnlineReleaseToolPlan,verifyOnlineReleaseTool,verifyOnlineToolBootstrap,
 executeOnlineReleaseToolPlan,assertOnlineToolNoPending,withOnlineToolPreparationLocks,
 assertOnlineToolOwnedPath,runOnlineToolGit} from './prepare-online-release-tool.mjs';
import {attendanceRepairTreeFingerprint} from './attendance-staged-tool-repair.mjs';
import {readOnlineRetentionHistory} from './online-release-retention.mjs';
import {assertOnlineRetentionPublication} from './online-release-retention-policy.mjs';
import {normalizeRetirementProcess,assertExistingPm2Directory} from './online-release-retirement.mjs';
import {WEB_RELEASE_FILES,WEB_RELEASE_PROXY,WEB_RELEASE_MARKER} from './web-presentation-release-policy.mjs';
import {LOGIN_RELEASE_LANE,LOGIN_FOCUSED_TESTS,buildLoginReleaseCandidate} from './merchant-login-release-policy.mjs';
export {loginUnitTestEnvironment,p as LOGIN_UNBUILT_REPAIR};
const APP='/www/wwwroot/merchant-space',ROOT=fileURLToPath(new URL('../',import.meta.url));
const maintenance='/var/lib/faolla-maintenance/merchant-space';
const receiptFile=`${p.operation}/${p.receiptName}`,originalFile=`${p.operation}/${p.originalStateCopyName}`;
const attemptFile=`${p.operation}/${p.attemptName}`,resultFile=`${p.operation}/${p.resultName}`;
const sha=x=>createHash('sha256').update(x).digest('hex');
const need=(x,code)=>{if(!x)throw Error(`merchant_login_unbuilt_${code}`);};
const same=(a,b,code)=>need(isDeepStrictEqual(a,b),code);
const git=(dir,args)=>runOnlineToolGit(dir,args).toString('utf8').trim();
const commandEnvironment={PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',HOME:'/root',PM2_HOME:'/root/.pm2',LANG:'C.UTF-8',LC_ALL:'C.UTF-8'};
function exists(file){try{fs.lstatSync(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
function ownedFile(file,{privateMode=false,allowEmpty=false,maxBytes=16*1024**2}={}){
 assertOnlineToolOwnedPath(file,'file');const before=fs.lstatSync(file);
 need(before.nlink===1&&(before.size>0||allowEmpty&&before.size===0)&&before.size<=maxBytes&&(!privateMode||(before.mode&0o777)===0o600),'file_invalid');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const opened=fs.fstatSync(fd),bytes=fs.readFileSync(fd),after=fs.fstatSync(fd),linked=fs.lstatSync(file);
  for(const k of ['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'])need([opened,after,linked].every(s=>s[k]===before[k]),'file_changed');
  need(bytes.length===before.size,'file_changed');return bytes;
 }finally{fs.closeSync(fd);}
}
function command(name,args){const r=spawnSync(name,args,{encoding:'utf8',env:commandEnvironment,timeout:60000,maxBuffer:16*1024**2});need(r.status===0&&!r.signal&&!r.error,'observation_failed');return r.stdout;}
function daemon(){
 assertExistingPm2Directory();const bytes=ownedFile('/root/.pm2/pm2.pid'),id=bytes.toString().trim();
 need(/^[1-9]\d*$/.test(id)&&fs.lstatSync(`/proc/${id}`).uid===0,'daemon_changed');
 const cmd=fs.readFileSync(`/proc/${id}/cmdline`);need(cmd.length<4096&&cmd.toString().replace(/\0+$/,'')==='PM2 v6.0.14: God Daemon (/root/.pm2)','daemon_changed');
 need(ownedFile('/root/.pm2/pm2.pid').equals(bytes),'daemon_changed');return {id,fileSha256:sha(bytes),commandSha256:sha(cmd)};
}
function pm(){const before=daemon(),value=JSON.parse(command('pm2',['jlist']));same(daemon(),before,'daemon_changed');return value;}
function seal(file,bytes){
 assertOnlineToolOwnedPath(path.dirname(file));need((fs.lstatSync(path.dirname(file)).mode&0o777)===0o700,'operation_mode');
 const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const directory=fs.openSync(path.dirname(file),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
 try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
 need(ownedFile(file,{privateMode:true}).equals(Buffer.from(bytes)),'sealed_file_changed');
}
export function loginUnbuiltRepairImportClosure(readSource){
 const seen=new Set();function visit(name){if(seen.has(name))return;need(/^scripts\/[a-z0-9-]+\.mjs$/.test(name),'bootstrap_import');seen.add(name);
  for(const m of readSource(name).matchAll(/(?:^|(?<=[;\r\n]))\s*(?:import\s+(?:[^;]*?\s+from\s+)?|export\s+[^;]*?\s+from\s+)['"]([^'"]+)['"]\s*;?/gm)){
   if(m[1].startsWith('node:'))continue;need(m[1].startsWith('./'),'bootstrap_import');visit(path.posix.normalize(path.posix.join(path.posix.dirname(name),m[1])));
  }
 }visit('scripts/merchant-login-unbuilt-repair.mjs');return [...seen].sort();
}
function sourceInputs(revision){return runOnlineToolGit(APP,['ls-tree','-r','-z',revision]).toString('utf8').split('\0').filter(Boolean).filter(row=>!allowed.includes(row.slice(row.indexOf('\t')+1))).join('\0');}
function verifySource(revision,rootDir,{bootstrap=false}={}){
 need(process.platform==='linux'&&process.getuid?.()===0&&/^[a-f0-9]{40}$/.test(revision??'')&&![p.target,p.baseline].includes(revision),'invocation');
 const directory=path.resolve(rootDir);assertOnlineToolOwnedPath(directory);assertOnlineToolOwnedPath(APP);
 need(git(APP,['rev-parse','origin/main'])===revision&&git(directory,['rev-parse','HEAD'])===revision&&git(directory,['rev-parse','--abbrev-ref','HEAD'])==='HEAD'&&!git(directory,['status','--porcelain=v1','--untracked-files=all']),'tool_source_changed');
 git(APP,['merge-base','--is-ancestor',p.target,revision]);
 if(!bootstrap){need(directory===`/var/lib/faolla-online-code/${revision}`,'tool_location');verifyOnlineReleaseTool(createOnlineReleaseToolPlan(revision));}
 else{
  need(directory===`/var/lib/faolla-online-bootstrap/${revision}`,'bootstrap_location');
  const files=loginUnbuiltRepairImportClosure(name=>runOnlineToolGit(APP,['show',`${revision}:${name}`]).toString('utf8'));
  const sparse=path.resolve(directory,git(directory,['rev-parse','--git-path','info/sparse-checkout']));
  need(ownedFile(sparse).toString()===files.map(n=>`/${n}`).join('\n')+'\n'&&git(directory,['config','--worktree','--get','core.sparseCheckout'])==='true'&&git(directory,['config','--worktree','--get','core.sparseCheckoutCone'])==='false'&&git(directory,['config','--worktree','--get','index.sparse'])==='false','bootstrap_sparse');
  const entries=new Set(['.git']);for(const name of files){need(ownedFile(`${directory}/${name}`).equals(runOnlineToolGit(APP,['show',`${revision}:${name}`])),'bootstrap_blob');const pieces=name.split('/');while(pieces.length){entries.add(pieces.join('/'));pieces.pop();}}
  const walk=(full,prefix='')=>{for(const e of fs.readdirSync(full,{withFileTypes:true})){const name=prefix+e.name;need(entries.has(name)&&!e.isSymbolicLink(),'bootstrap_entry');assertOnlineToolOwnedPath(path.join(full,e.name),e.isDirectory()?'directory':'file');if(e.isDirectory())walk(path.join(full,e.name),name+'/');}};walk(directory);
  verifyOnlineToolBootstrap(createOnlineReleaseToolPlan(revision),`${directory}/scripts/prepare-online-release-tool.mjs`);
 }
 const changed=git(APP,['diff','--no-renames','--name-status',p.target,revision]).split('\n').filter(Boolean).map(row=>{const [status,name,...extra]=row.split('\t');need(['A','M'].includes(status)&&extra.length===0,'tool_scope');return name;}).sort();
 assertLoginUnbuiltRepairToolScope(changed);const original=sourceInputs(p.target),current=sourceInputs(revision);
 need(current===original&&sha(current)===p.sourceInputsSha256,'application_inputs_changed');
 return {toolRevision:revision,changedToolFiles:changed,sourceInputsSha256:sha(current)};
}
function candidateSource(){
 need(git(p.directory,['rev-parse','HEAD'])===p.target&&!git(p.directory,['status','--porcelain=v1','--untracked-files=all']),'candidate_source_changed');
 const rows=runOnlineToolGit(APP,['ls-tree','-r','-z',p.target]).toString('utf8').split('\0').filter(Boolean);
 for(const row of rows){const m=/^(100644|100755) blob ([a-f0-9]{40})\t([^\0]+)$/.exec(row);need(m&&!m[3].startsWith('/')&&!m[3].includes('\\')&&!/[\r\n]/.test(m[3])&&m[3].split('/').every(n=>n&&!['.','..'].includes(n)),'candidate_source_invalid');const bytes=ownedFile(`${p.directory}/${m[3]}`,{maxBytes:256*1024**2,allowEmpty:true});need(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')===m[2],'candidate_source_changed');}
 need(rows.length>0&&sha(sourceInputs(p.target))===p.sourceInputsSha256,'application_inputs_changed');
}
function observe(phase='unbuilt',{sealed=false}={}){
 need(['unbuilt','built','ready'].includes(phase),'phase');assertOnlineToolOwnedPath(p.operation);assertOnlineToolOwnedPath(p.directory);
 need((fs.lstatSync(p.operation).mode&0o777)===0o700,'operation_mode');
 const current=ownedFile(paths['state.json'],{privateMode:true}),original=sealed?ownedFile(originalFile,{privateMode:true}):current;
 need(sha(original)===p.stateSha256,'original_state_changed');const state=JSON.parse(current);
 const proofBytes=phase==='unbuilt'?null:ownedFile(`${p.operation}/attendance-build-proof.json`,{privateMode:true});
 assertLoginUnbuiltState(state,JSON.parse(original),{phase,...(proofBytes?{buildProofSha256:sha(proofBytes)}:{})});
 candidateSource();
 const preserved={};for(const [name,file] of Object.entries(paths)){const bytes=name==='state.json'?original:ownedFile(file,{privateMode:name!=='package-lock.json'});preserved[name]=sha(bytes);}same(preserved,pins,'preserved_evidence_changed');
 const dependency=attendanceRepairTreeFingerprint(`${p.directory}/node_modules`,{allowInternalLinks:true});same(dependency,p.dependency,'dependencies_changed');same(dependency,attendanceRepairTreeFingerprint(`${state.oldDirectory}/node_modules`,{allowInternalLinks:true}),'baseline_dependencies_changed');
 if(phase==='unbuilt'){
  for(const file of absent)need(!exists(file),'build_or_database_attempt_exists');
  need(command('systemctl',['show',`faolla-attendance-build-${p.target}.service`,'--property=LoadState','--value']).trim()==='not-found','build_attempt_exists');
 }else{
  const proof=JSON.parse(proofBytes);need(proof.target===p.target&&proof.buildId===ownedFile(`${p.directory}/.next/BUILD_ID`).toString().trim()&&proof.guardedCommand==='npm run build'&&proof.memoryBytes===4294967296&&proof.heapMiB===3072&&proof.cpuQuotaPercent===100&&proof.tasks===128&&proof.seconds===1200&&proof.privateNetworkVerified===true&&proof.swapBytes===0,'build_proof_changed');
 }
 for(const file of absent.filter(n=>/database|compatibility|migration-/.test(n)))need(!exists(file),'database_attempt_exists');
 const active=ownedFile('/var/lib/faolla-online-release/active.json',{privateMode:true}),maintenanceBytes=ownedFile(`${maintenance}/state.json`,{privateMode:true});
 need(sha(active)===p.activeSha256&&sha(maintenanceBytes)===p.maintenanceSha256&&JSON.parse(maintenanceBytes).phase==='ended'&&sha(ownedFile(WEB_RELEASE_MARKER))===p.markerSha256,'formal_configuration_changed');
 for(const name of WEB_RELEASE_FILES)need(sha(ownedFile(`${WEB_RELEASE_PROXY}/${name}`))===state.configs[name].oldHash,'proxy_changed');
 const history=readOnlineRetentionHistory();need(history.headSha256===p.retentionHeadSha256,'retention_changed');
 if(phase!=='ready'){
  need(!new RegExp(`(?:^|\\s)\\S+:${p.port}(?=\\s|$)`,'m').test(command('ss',['-ltnH'])),'candidate_port_occupied');
  const dump=JSON.parse(ownedFile('/root/.pm2/dump.pm2'));
  need(Array.isArray(dump)&&!dump.some(x=>x.name===p.name||x.pm_cwd===p.directory),'candidate_persisted_before_start');
 }
 const all=pm(),processes=all.map(normalizeRetirementProcess);assertOnlineRetentionPublication({history,state,actualActive:JSON.parse(active),current:processes,action:'status'});
 const own=all.find(x=>x.name===p.name);let candidate=null;
 if(phase!=='ready')need(!own,'candidate_already_started');
 else{
  need(own&&own.pid>0&&own.pm2_env.status==='online'&&own.pm2_env.pm_cwd===p.directory&&fs.realpathSync(`/proc/${own.pid}/cwd`)===p.directory,'candidate_process_changed');
  candidate={process:normalizeRetirementProcess(own),environmentSha256:sha(fs.readFileSync(`/proc/${own.pid}/environ`)),commandSha256:sha(fs.readFileSync(`/proc/${own.pid}/cmdline`)),executable:fs.realpathSync(`/proc/${own.pid}/exe`)};
 }
 same(pm().map(normalizeRetirementProcess),processes,'process_changed_during_observation');
 for(const [name,file] of Object.entries(paths))need(sha(ownedFile(name==='state.json'&&sealed?originalFile:file,{privateMode:name!=='package-lock.json'}))===pins[name],'evidence_changed_during_observation');
 need(ownedFile(paths['state.json'],{privateMode:true}).equals(current)&&ownedFile('/var/lib/faolla-online-release/active.json',{privateMode:true}).equals(active)&&ownedFile(`${maintenance}/state.json`,{privateMode:true}).equals(maintenanceBytes),'state_changed_during_observation');
 return {stateText:current.toString(),stateSha256:sha(current),originalStateText:original.toString(),preservedFiles:preserved,dependencySha256:dependency.sha256,buildProofSha256:proofBytes?sha(proofBytes):null,candidate};
}
function checkedReceipt(rootDir){
 const bytes=ownedFile(receiptFile,{privateMode:true}),receipt=JSON.parse(bytes);assertLoginUnbuiltRepairReceipt(receipt,{target:p.target});
 const source=verifySource(receipt.toolRevision,rootDir);same(source.changedToolFiles,receipt.changedToolFiles,'receipt_source_changed');return {bytes,receipt,source};
}
function checkedAttempt(checked){
 const bytes=ownedFile(attemptFile,{privateMode:true}),value=JSON.parse(bytes);
 need(typeof value.startedAt==='string'&&new Date(value.startedAt).toISOString()===value.startedAt,'attempt_invalid');
 same(value,{schemaVersion:1,target:p.target,toolRevision:checked.receipt.toolRevision,receiptSha256:sha(checked.bytes),originalStateSha256:p.stateSha256,startedAt:value.startedAt},'attempt_changed');
 return sha(bytes);
}
export function assertLoginUnbuiltRepairCandidate({target,rootDir=ROOT,phase='unbuilt',requireResult=phase==='ready'}={}){
 need(target===p.target,'receipt_target');const checked=checkedReceipt(rootDir),observation=observe(phase,{sealed:true});
 need(ownedFile(receiptFile,{privateMode:true}).equals(checked.bytes),'receipt_changed');
 if(phase!=='unbuilt')checkedAttempt(checked);
 if(requireResult){const raw=ownedFile(resultFile,{privateMode:true}),value=JSON.parse(raw);need(typeof value.completedAt==='string'&&new Date(value.completedAt).toISOString()===value.completedAt,'result_invalid');const built=attendanceRepairTreeFingerprint(`${p.directory}/.next`,{exclude:['cache','trace']});same(value,{schemaVersion:1,toolRevision:checked.receipt.toolRevision,receiptSha256:sha(checked.bytes),attemptSha256:checkedAttempt(checked),readyStateSha256:observation.stateSha256,buildProofSha256:observation.buildProofSha256,builtOutputSha256:built.sha256,dependencySha256:observation.dependencySha256,candidate:observation.candidate,completedAt:value.completedAt},'result_changed');need(ownedFile(resultFile,{privateMode:true}).equals(raw),'result_changed');}
 return {...checked,observation};
}
export function prepareLoginUnbuiltToolRepair(revision,confirm){
 need(confirm==='approved-merchant-login-unbuilt-test-environment-repair','approval_required');const source=verifySource(revision,ROOT,{bootstrap:true});
 for(const file of [receiptFile,originalFile,attemptFile,resultFile])need(!exists(file),'repair_evidence_exists');const initial=observe();
 return withOnlineToolPreparationLocks({deployLock:`${APP}.deploy.lock`,maintenance},()=>{
  same(verifySource(revision,ROOT,{bootstrap:true}),source,'source_changed_during_preparation');const before=observe();same(before,initial,'candidate_changed_before_preparation');
  const receipt={schemaVersion:1,kind:'merchant-login-unbuilt-test-environment-repair',target:p.target,baseline:p.baseline,toolRevision:revision,originalStateSha256:p.stateSha256,sourceInputsSha256:p.sourceInputsSha256,dependencySha256:before.dependencySha256,preservedFiles:before.preservedFiles,activeSha256:p.activeSha256,maintenanceSha256:p.maintenanceSha256,markerSha256:p.markerSha256,retentionHeadSha256:p.retentionHeadSha256,changedToolFiles:source.changedToolFiles,approvedTestEnvironmentIsolation:true,preparedAt:new Date().toISOString()};
  assertLoginUnbuiltRepairReceipt(receipt,{target:p.target,toolRevision:revision});assertOnlineToolNoPending({fixedLoginUnbuiltRepairReceipt:receipt});
  const mask=process.umask(0o077);let prepared;try{prepared=executeOnlineReleaseToolPlan(createOnlineReleaseToolPlan(revision));}finally{process.umask(mask);}
  same(verifySource(revision,prepared.directory),source,'prepared_source_changed');same(observe(),before,'candidate_changed_during_preparation');
  seal(originalFile,Buffer.from(before.originalStateText));seal(receiptFile,JSON.stringify(receipt,null,2)+'\n');same(observe('unbuilt',{sealed:true}),before,'candidate_changed_after_preparation');
  return {status:'merchant-login-unbuilt-repair-prepared',target:p.target,toolRevision:revision,receiptSha256:sha(ownedFile(receiptFile,{privateMode:true})),productionDatabaseChanged:false,trafficChanged:false,applicationSourcesChanged:false,source:prepared};
 });
}
/** Pure sequencing adapter used by unit tests; only the production wrapper
 * below constructs these capabilities. Failure leaves the one-shot attempt. */
export async function executeLoginUnbuiltResume(ports){
 await ports.check();await ports.begin();await ports.verify();await ports.tests();await ports.check();await ports.verify();
 await ports.build();await ports.verifyBuilt();await ports.checkBuilt();await ports.verify();await ports.start();
 let ready=false;for(let i=0;i<25;i++){try{await ports.smoke();ready=true;break;}catch{}await ports.wait(1000);}need(ready,'candidate_not_ready');
 await ports.ready();await ports.complete();
}
export async function resumeLoginUnbuiltCandidate(state,{rootDir=ROOT,verifyBefore,runTests,verifyBuilt,start,smoke,ready}={}){
 need(state.target===p.target&&state.lane===LOGIN_RELEASE_LANE,'resume_target');let checked,attemptSha256;
 const check=()=>{checked=assertLoginUnbuiltRepairCandidate({target:p.target,rootDir});same(JSON.parse(checked.observation.stateText),state,'resume_state_changed');if(attemptSha256)need(checkedAttempt(checked)===attemptSha256,'attempt_changed');};
 await executeLoginUnbuiltResume({check,verify:verifyBefore,
  begin:()=>{need(!exists(attemptFile)&&!exists(resultFile),'resume_already_attempted');seal(attemptFile,JSON.stringify({schemaVersion:1,target:p.target,toolRevision:checked.receipt.toolRevision,receiptSha256:sha(checked.bytes),originalStateSha256:p.stateSha256,startedAt:new Date().toISOString()},null,2)+'\n');attemptSha256=checkedAttempt(checked);},
  tests:()=>runTests([`${rootDir}/scripts/merchant-login-unbuilt-repair-policy.test.mjs`,`${rootDir}/scripts/merchant-login-unbuilt-repair.test.mjs`,...LOGIN_FOCUSED_TESTS,'src/lib/merchantBusinessCardQrPreview.test.ts','src/lib/canonicalSuperAdminRequest.test.ts','scripts/online-traffic-release.test.mjs'],loginUnitTestEnvironment()),
  build:()=>{const mask=process.umask(0o022);try{buildLoginReleaseCandidate({lane:state.lane,baseline:state.baseline,directory:state.directory,target:state.target,operation:p.operation,environment:JSON.parse(ownedFile(paths['runtime.json'],{privateMode:true}))});}finally{process.umask(mask);}},
  verifyBuilt,checkBuilt:()=>assertLoginUnbuiltRepairCandidate({target:p.target,rootDir,phase:'built'}),start,smoke,ready,wait:ms=>new Promise(r=>setTimeout(r,ms)),
  complete:()=>{const check=assertLoginUnbuiltRepairCandidate({target:p.target,rootDir,phase:'ready',requireResult:false});need(checkedAttempt(check)===attemptSha256,'attempt_changed');const built=attendanceRepairTreeFingerprint(`${p.directory}/.next`,{exclude:['cache','trace']});seal(resultFile,JSON.stringify({schemaVersion:1,toolRevision:check.receipt.toolRevision,receiptSha256:sha(check.bytes),attemptSha256,readyStateSha256:check.observation.stateSha256,buildProofSha256:check.observation.buildProofSha256,builtOutputSha256:built.sha256,dependencySha256:check.observation.dependencySha256,candidate:check.observation.candidate,completedAt:new Date().toISOString()},null,2)+'\n');assertLoginUnbuiltRepairCandidate({target:p.target,rootDir,phase:'ready'});}
 });
}
export function loginUnbuiltRepairMain(args=process.argv.slice(2)){need(args.length===3&&args[0]==='prepare','invocation');return prepareLoginUnbuiltToolRepair(args[1],args[2]);}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{console.log(JSON.stringify(loginUnbuiltRepairMain()));}catch(e){console.error(/^merchant_login_unbuilt_[a-z_]+$/.test(e.message)?e.message:'merchant_login_unbuilt_unverified');process.exitCode=1;}}
