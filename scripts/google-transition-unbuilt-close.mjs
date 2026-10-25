// One approved, immutable resource-rejected attempt; sidecar-only closure.
import * as fs from 'node:fs';
import {readFileSync,readdirSync,lstatSync,realpathSync,readlinkSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {assertOnlineToolOwnedPath,runOnlineToolGit,createOnlineReleaseToolPlan,verifyOnlineReleaseTool} from './prepare-online-release-tool.mjs';
import {unpublishedCandidateImportClosure} from './online-unpublished-candidate.mjs';
import {withOnlineRetentionLocks} from './online-release-retention-writer.mjs';
import {normalizeRetirementProcess,assertExistingPm2Directory} from './online-release-retirement.mjs';
import {readOnlineRetentionHistory} from './online-release-retention.mjs';
import {assertOnlineRetentionPublication} from './online-release-retention-policy.mjs';
import {WEB_RELEASE_PROXY,WEB_RELEASE_MARKER} from './web-presentation-release-policy.mjs';
import {GOOGLE_UNBUILT_CLOSURE as incident,GOOGLE_UNBUILT_ABSENT_PATHS as absentPaths,
 GOOGLE_UNBUILT_PRESERVED_FILES as preservedPaths,createGoogleUnbuiltClosureReceipt,assertGoogleUnbuiltClosureReceipt} from './google-transition-unbuilt-close-policy.mjs';
const APP='/www/wwwroot/merchant-space',MAINTENANCE='/var/lib/faolla-maintenance/merchant-space';
const SHA=/^[a-f0-9]{40}(?![\s\S])/,MAX_BYTES=32*1024*1024,RECEIPT='unpublished-termination.json';
const fail=code=>{throw Error('google_unbuilt_'+code);};
const hash=value=>createHash('sha256').update(value).digest('hex');
const equal=(a,b,code)=>{if(!isDeepStrictEqual(a,b))fail(code);};
const exists=name=>{try{fs.lstatSync(name);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const git=(cwd,args)=>runOnlineToolGit(cwd,args).toString('utf8').trim();
const bookingResumeOwnedPath=assertOnlineToolOwnedPath;
function command(name,args,{input,limit=MAX_BYTES,timeout=20000}={}){
  const r=spawnSync(name,args,{encoding:'utf8',input,env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/root',PM2_HOME:'/root/.pm2',LANG:'C.UTF-8',LC_ALL:'C.UTF-8'},timeout,maxBuffer:limit,windowsHide:true});
  if(r.status!==0||r.error||r.signal)fail('observation_command_failed');return r.stdout;
}
function readOwned(name,privateMode=true){
  assertOnlineToolOwnedPath(name,'file');const s=fs.lstatSync(name);
  if(s.size<1||s.size>MAX_BYTES||privateMode&&(s.mode&0o777)!==0o600)fail('evidence_file_invalid');
  const fd=fs.openSync(name,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{const before=fs.fstatSync(fd),bytes=fs.readFileSync(fd),after=fs.fstatSync(fd),actual=fs.lstatSync(name);
    for(const key of ['dev','ino','mode','uid','nlink','size','mtimeMs','ctimeMs'])if(before[key]!==s[key]||after[key]!==s[key]||actual[key]!==s[key])fail('evidence_file_changed');
    return bytes;
  }finally{fs.closeSync(fd);}
}

function referenceAbsent(value,p=incident){
  if(JSON.stringify(value).includes(p.directory)||JSON.stringify(value).includes(p.name))fail('candidate_reference_present');
}
function inspectProcessReferences(p=incident){
  for(const name of fs.readdirSync('/proc').filter(name=>/^[1-9][0-9]*$/.test(name))){
    const base=`/proc/${name}`;
    try{
      let cwd;try{cwd=fs.readlinkSync(`${base}/cwd`);}catch(error){if(!['ENOENT','ESRCH'].includes(error.code))throw error;}
      if(cwd===p.directory||cwd?.startsWith(p.directory+'/'))fail('candidate_process_present');
      for(const leaf of ['cmdline','maps']){
        const bytes=fs.readFileSync(`${base}/${leaf}`);if(bytes.includes(p.directory)||bytes.includes(p.name))fail('candidate_process_present');
      }
      for(const fd of fs.readdirSync(`${base}/fd`)){
        let target;try{target=fs.readlinkSync(`${base}/fd/${fd}`);}catch(error){if(['ENOENT','ESRCH'].includes(error.code))continue;throw error;}
        if(target===p.directory||target.startsWith(p.directory+'/'))fail('candidate_process_present');
      }
    }catch(error){if(['ENOENT','ESRCH'].includes(error.code))continue;throw error;}
  }
  return true;
}

function verifySource(p=incident){
  const revision=git(APP,['rev-parse','origin/main']);if(!SHA.test(revision)||revision===p.target)fail('tool_not_new_main');
  const directory=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  if(directory===`/var/lib/faolla-online-code/${revision}`){verifyOnlineReleaseTool(createOnlineReleaseToolPlan(revision));return revision;}
  if(directory!==`/var/lib/faolla-online-bootstrap/${revision}`)fail('tool_directory_invalid');
  assertOnlineToolOwnedPath(directory);if(git(directory,['rev-parse','HEAD'])!==revision||git(directory,['status','--porcelain=v1','--untracked-files=all']))fail('tool_source_changed');
  git(APP,['merge-base','--is-ancestor',p.target,revision]);
  const files=unpublishedCandidateImportClosure(name=>runOnlineToolGit(APP,['show',`${revision}:${name}`]).toString('utf8'),['scripts/google-transition-unbuilt-close.mjs','scripts/prepare-online-release-tool.mjs']);
  const patterns=files.map(name=>`/${name}`).join('\n')+'\n';
  const patternFile=path.resolve(directory,git(directory,['rev-parse','--git-path','info/sparse-checkout']));
  if(readOwned(patternFile,false).toString('utf8')!==patterns||git(directory,['config','--worktree','--get','core.sparseCheckout'])!=='true'||git(directory,['config','--worktree','--get','core.sparseCheckoutCone'])!=='false'||git(directory,['config','--worktree','--get','index.sparse'])!=='false')fail('bootstrap_sparse_changed');
  const head=path.resolve(directory,git(directory,['rev-parse','--git-path','HEAD']));if(readOwned(head,false).toString('utf8').trim()!==revision)fail('bootstrap_not_detached');
  const allowed=new Set(['.git']);for(const name of files){const parts=name.split('/');while(parts.length){allowed.add(parts.join('/'));parts.pop();}
    if(!readOwned(`${directory}/${name}`,false).equals(runOnlineToolGit(APP,['show',`${revision}:${name}`])))fail('bootstrap_blob_changed');}
  const walk=(full,prefix='')=>{for(const e of fs.readdirSync(full,{withFileTypes:true})){const rel=prefix+e.name;if(!allowed.has(rel)||e.isSymbolicLink())fail('bootstrap_unexpected_entry');assertOnlineToolOwnedPath(`${full}/${e.name}`,e.isDirectory()?'directory':'file');if(e.isDirectory())walk(`${full}/${e.name}`,rel+'/');}};walk(directory);
  const index=git(directory,['ls-files','-t','-z']).split('\0').filter(Boolean);if(index.some(row=>(files.includes(row.slice(2))?'H':'S')!==row[0])||index.filter(row=>row[0]==='H').length!==files.length)fail('bootstrap_index_changed');
  return revision;
}

function bookingResumeDependencies(directory){
 bookingResumeOwnedPath(directory);const digest=createHash('sha256');
 function walk(path,relative=''){
  for(const name of readdirSync(path).sort()){
   const full=`${path}/${name}`,key=relative?`${relative}/${name}`:name,st=lstatSync(full);
   if(st.uid!==0)fail('booking_stage_resume_dependency_owner_changed');
   if(st.isSymbolicLink()){
    if(!realpathSync(full).startsWith(`${directory}/`))fail('booking_stage_resume_dependency_link_escaped');
    digest.update(JSON.stringify([key,'link',readlinkSync(full)]));
   }else{
    if(st.mode&0o022)fail('booking_stage_resume_dependency_writable');
    if(st.isDirectory()){digest.update(JSON.stringify([key,'directory',st.mode&0o777]));walk(full,key);}
    else if(st.isFile())digest.update(JSON.stringify([key,'file',st.mode&0o777,hash(readFileSync(full))]));
    else fail('booking_stage_resume_dependency_type_invalid');
   }
  }
 }
 walk(directory);return digest.digest('hex');
}

export async function observeGoogleUnbuilt(toolRevision){
 const p=incident;assertOnlineToolOwnedPath(p.operation);assertOnlineToolOwnedPath(p.directory);
 if((fs.lstatSync(p.operation).mode&0o777)!==0o700)fail('operation_mode_changed');
 const stateText=readOwned(p.operation+'/state.json').toString('utf8'),s=JSON.parse(stateText);
 if(hash(stateText)!==p.stateSha256)fail('original_state_changed');
 if(git(p.directory,['rev-parse','HEAD'])!==p.target||git(p.directory,['status','--porcelain=v1','--untracked-files=all']))fail('candidate_source_changed');
 for(const f of absentPaths)if(exists(f))fail('execution_trace_present');
 const preservedFiles=Object.fromEntries(Object.entries(preservedPaths).map(([key,file])=>[key,hash(readOwned(file))]));
 const expected=['state.json','runtime.json',...p.proxyFiles.flatMap(f=>['before-'+f,'after-'+f]),...(exists(p.operation+'/'+RECEIPT)?[RECEIPT]:[])].sort();
 equal(fs.readdirSync(p.operation).sort(),expected,'operation_entries_changed');
 const log=readOwned(p.stageLog).toString('utf8');
 for(const [key,value] of [['tests',526],['pass',526],['fail',0],['skipped',0],['cancelled',0]])
  if(!new RegExp('^# '+key+' '+value+'$','m').test(log))fail('diagnostic_changed');
 if(!/online_build_started[\s\S]*attendance_build_resource_admission_rejected/.test(log))fail('diagnostic_changed');
 const dependenciesSha256=bookingResumeDependencies(p.directory+'/node_modules');
 if(dependenciesSha256!==s.googleTransitionDependenciesSha256||bookingResumeDependencies(s.oldDirectory+'/node_modules')!==dependenciesSha256)fail('dependencies_changed');
 assertExistingPm2Directory();const raw=JSON.parse(command('pm2',['jlist']));referenceAbsent(raw);
 const processes=raw.map(normalizeRetirementProcess);equal(processes,s.processes,'retained_process_changed');
 for(const name of ['/root/.pm2/dump.pm2','/root/.pm2/dump.pm2.bak'])referenceAbsent(JSON.parse(readOwned(name,false).toString('utf8')));
 assertOnlineToolOwnedPath('/root/.pm2/logs');
 if(fs.readdirSync('/root/.pm2/logs').some(name=>name.includes(p.name)))fail('candidate_pm2_log_present');
 const processReferencesAbsent=inspectProcessReferences();
 if(new RegExp(':'+p.port+'\\s').test(command('/usr/sbin/ss',['-ltnH'])))fail('candidate_port_in_use');
 const unit='faolla-attendance-build-'+p.target+'.service';
 if(command('systemctl',['show',unit,'--property=LoadState','--value']).trim()!=='not-found')fail('build_unit_present');
 if(command('journalctl',['--quiet','--no-pager','--output=json','--since='+s.startedAt.slice(0,19).replace('T',' ')+' UTC','--unit',unit]).trim())fail('build_journal_present');
 const activeText=readOwned('/var/lib/faolla-online-release/active.json').toString('utf8'),active=JSON.parse(activeText);
 equal(active,s.previousActive,'active_changed');
 const maintenanceText=readOwned(MAINTENANCE+'/state.json').toString('utf8'),markerSha256=hash(readOwned(WEB_RELEASE_MARKER,false));
 const baseDirectory=fs.realpathSync(APP+'.current'),proxyHashes=Object.fromEntries(p.proxyFiles.map(f=>[f,hash(readOwned(WEB_RELEASE_PROXY+'/'+f,false))]));
 const history=readOnlineRetentionHistory();assertOnlineRetentionPublication({history,state:s,actualActive:active,current:processes,action:'status'});
 const response=await fetch('http://127.0.0.1:'+s.oldPort+'/api/app-web-version',{headers:{Host:'www.faolla.com',Connection:'close'},redirect:'manual',signal:AbortSignal.timeout(10000)});
 if(response.status!==200||(await response.json()).buildId!==p.baseline)fail('baseline_version_changed');
 return {stateText,evidence:{schemaVersion:1,target:p.target,baseline:p.baseline,operation:p.operation,observedAt:new Date().toISOString(),stateSha256:hash(stateText),
  sourceHead:p.target,sourceClean:true,absentPaths:[...absentPaths],buildUnit:{name:unit,loadState:'not-found',journalEmpty:true},
  activeText,processes,baseDirectory,maintenanceText,markerSha256,proxyHashes,retentionHeadSha256:history.headSha256,preservedFiles,
  processReferencesAbsent,pm2DumpReferencesAbsent:true,portVacant:true,dependenciesSha256,diagnosticTests:526,diagnosticPasses:526,
  diagnosticFailures:0,diagnosticSkipped:0,diagnosticCancelled:0,buildAttemptOccurred:false,databaseExecutionTracesAbsent:true}};
}
function durableReceipt(receipt,p=incident){
  const name=`${p.operation}/${RECEIPT}`,text=JSON.stringify(receipt,null,2)+'\n';
  const fd=fs.openSync(name,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const dir=fs.openSync(p.operation,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
  equal(readOwned(name),Buffer.from(text),'receipt_readback_changed');
}

export async function executeGoogleUnbuiltClosure(ops,{dryRun=false}={}){
 const before=await ops.observe(),receipt=ops.create({...before,toolRevision:ops.revision,terminatedAt:ops.now()});
 const after=await ops.observe(),stable=e=>{const value=structuredClone(e);delete value.evidence.observedAt;return value;};
 equal(stable(after),stable(before),'observation_changed');
 if(dryRun)return {status:'eligible-unpublished',target:incident.target,persistentEvidenceWrites:0,originalStateUnchanged:true};
 await ops.write(receipt);
 const final=await ops.observe();equal(stable(final),stable(before),'post_close_observation_changed');
 ops.assert({stateText:final.stateText,receipt,preservedFiles:final.evidence.preservedFiles,absentPaths:final.evidence.absentPaths});
 return {status:'ended-unpublished',target:incident.target,originalStateUnchanged:true,failedFilesRetained:true,productionDataChanged:false,trafficSwitched:false};
}
export async function googleUnbuiltClosureMain(argv=process.argv.slice(2)){
 if(process.platform!=='linux'||process.getuid?.()!==0||!(argv.length===1&&argv[0]==='dry-run'||argv.length===2&&argv[0]==='end'&&argv[1]==='approved-end-unbuilt-8fabf8078a15'))fail('invocation_invalid');
 const revision=verifySource();
 return withOnlineRetentionLocks(async()=>{
  if(verifySource()!==revision)fail('tool_changed');
  if(exists(incident.operation+'/'+RECEIPT))fail('already_closed_no_retry');
  return executeGoogleUnbuiltClosure({revision,observe:()=>observeGoogleUnbuilt(revision),create:createGoogleUnbuiltClosureReceipt,
   now:()=>new Date().toISOString(),write:receipt=>durableReceipt(receipt),assert:assertGoogleUnbuiltClosureReceipt},{dryRun:argv[0]==='dry-run'});
 });
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 try{console.log(JSON.stringify(await googleUnbuiltClosureMain()));}catch(e){console.error(/^google_unbuilt_[a-z_]+$/.test(e.message)?e.message:'google_unbuilt_unverified');process.exitCode=1;}
}
