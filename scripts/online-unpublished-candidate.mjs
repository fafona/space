// Explicit closure of the one approved pre-build incident. No build, migration,
// traffic switch, process stop, deletion, or rewrite of original release state.
import * as fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {assertOnlineToolOwnedPath,runOnlineToolGit,createOnlineReleaseToolPlan,verifyOnlineReleaseTool,
  UNPUBLISHED_CANDIDATE_INCIDENT as incident,UNPUBLISHED_CANDIDATE_ABSENT_PATHS as absentPaths,
  UNPUBLISHED_CANDIDATE_PRESERVED_FILES as preservedPaths,createUnpublishedCandidateTerminationReceipt,
  assertUnpublishedCandidateTerminationReceipt} from './prepare-online-release-tool.mjs';
import {withOnlineRetentionLocks} from './online-release-retention-writer.mjs';
import {normalizeRetirementProcess,assertExistingPm2Directory} from './online-release-retirement.mjs';
import {readOnlineRetentionHistory} from './online-release-retention.mjs';
import {assertOnlineRetentionPublication} from './online-release-retention-policy.mjs';
import {WEB_RELEASE_PROXY,WEB_RELEASE_MARKER} from './web-presentation-release-policy.mjs';

const APP='/www/wwwroot/merchant-space',MAINTENANCE='/var/lib/faolla-maintenance/merchant-space';
const SHA=/^[a-f0-9]{40}(?![\s\S])/;
const DB={containerId:'0a7358f7310a33feeb9bfad9142530ff3f44882234ecbc35763135f9c1bfd416',containerName:'supabase-db',databaseName:'postgres',databaseOid:'5',systemIdentifier:'7612049595342295079',serverVersionNum:'150008',dataSource:'/opt/supabase/docker/volumes/db/data'};
const PILOT_DB='0d0a85a8ff50b585f690ba80a56d7d215adca2df1fa7c820840ff3389687d907';
const RECEIPT='unpublished-termination.json',MAX_BYTES=32*1024*1024;
const fail=code=>{throw Error(`online_unpublished_${code}`);};
const hash=value=>createHash('sha256').update(value).digest('hex');
const equal=(a,b,code)=>{if(!isDeepStrictEqual(a,b))fail(code);};
const exists=name=>{try{fs.lstatSync(name);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const git=(cwd,args)=>runOnlineToolGit(cwd,args).toString('utf8').trim();
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
function referenceAbsent(value){
  if(JSON.stringify(value).includes(incident.directory)||JSON.stringify(value).includes(incident.name))fail('candidate_reference_present');
}
function inspectProcessReferences(){
  for(const name of fs.readdirSync('/proc').filter(name=>/^[1-9][0-9]*$/.test(name))){
    const base=`/proc/${name}`;
    try{
      let cwd;try{cwd=fs.readlinkSync(`${base}/cwd`);}catch(error){if(!['ENOENT','ESRCH'].includes(error.code))throw error;}
      if(cwd===incident.directory||cwd?.startsWith(incident.directory+'/'))fail('candidate_process_present');
      for(const leaf of ['cmdline','maps']){
        const bytes=fs.readFileSync(`${base}/${leaf}`);if(bytes.includes(incident.directory)||bytes.includes(incident.name))fail('candidate_process_present');
      }
      for(const fd of fs.readdirSync(`${base}/fd`)){
        let target;try{target=fs.readlinkSync(`${base}/fd/${fd}`);}catch(error){if(['ENOENT','ESRCH'].includes(error.code))continue;throw error;}
        if(target===incident.directory||target.startsWith(incident.directory+'/'))fail('candidate_process_present');
      }
    }catch(error){if(['ENOENT','ESRCH'].includes(error.code))continue;throw error;}
  }
  return true;
}
export function unpublishedCandidateDatabaseSql(){return `begin read only;set local statement_timeout='8s';set local lock_timeout='3s';
select jsonb_build_object('databaseName',current_database(),'databaseOid',(select oid::text from pg_database where datname=current_database()),
 'systemIdentifier',(select system_identifier::text from pg_control_system()),'serverVersionNum',current_setting('server_version_num'),'primary',not pg_is_in_recovery(),
 'registry',(select jsonb_agg(jsonb_build_object('version',version::text,'name',name) order by version) from public.faolla_schema_migrations),
 'attendanceRelations',(select count(*) from pg_class where relnamespace='public'::regnamespace and relname like 'merchant_attendance_%'),
 'attendanceFunctions',(select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'faolla_attendance_%'))::text;commit;\n`;}
function databaseObservation(toolRevision){
  const inspect=JSON.parse(command('docker',['inspect','--format','{"id":{{json .Id}},"name":{{json .Name}},"running":{{json .State.Running}},"mounts":{{json .Mounts}}}',DB.containerId]));
  if(inspect.id!==DB.containerId||inspect.name!=='/'+DB.containerName||inspect.running!==true||!inspect.mounts.some(m=>m.Type==='bind'&&m.Source===DB.dataSource&&m.RW===true))fail('database_identity_changed');
  const args=id=>['exec','-i',id,'sh','-lc','set -eu; : "${POSTGRES_PASSWORD:?required}"; export PGPASSWORD="$POSTGRES_PASSWORD"; export PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=8000 -c lock_timeout=3000"; exec psql -h 127.0.0.1 -U supabase_admin -d postgres --no-password --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1 --set=VERBOSITY=sqlstate'];
  const v=JSON.parse(command('docker',args(DB.containerId),{input:unpublishedCandidateDatabaseSql()}));
  for(const key of ['databaseName','databaseOid','systemIdentifier','serverVersionNum'])if(v[key]!==DB[key])fail('database_identity_changed');
  const manifestBytes=runOnlineToolGit(APP,['show',`${toolRevision}:scripts/attendance-production-database-migrations.manifest.json`]);
  if(hash(manifestBytes)!=='3518a971c62c0f9a074b94c873078729e3ebe79adb0bd661793d07063d057ce3')fail('database_manifest_changed');
  const manifest=JSON.parse(manifestBytes.toString('utf8'));
  equal(v.registry,manifest.baseline,'database_registry_changed');
  if(v.registry.length!==60||v.registry.at(-1).version!=='202609240052'||v.primary!==true||v.attendanceRelations!==0||v.attendanceFunctions!==0)fail('database_already_changed');
  const pilot=JSON.parse(command('docker',['inspect','--format','{"id":{{json .Id}},"running":{{json .State.Running}}}',PILOT_DB]));
  if(pilot.id!==PILOT_DB||pilot.running!==true)fail('pilot_database_identity_changed');
  const compat=`faolla_attendance_compat_${incident.target.slice(0,12)}`;
  if(command('docker',args(PILOT_DB),{input:`begin read only;select count(*) from pg_database where datname='${compat}';commit;\n`}).trim()!=='0')fail('compatibility_database_present');
  return {identitySha256:hash(JSON.stringify(DB)),registrySha256:hash(JSON.stringify(v.registry)),registryCount:60,registryMaximum:'202609240052',attendanceRelations:0,attendanceFunctions:0};
}
// A helper-only source bootstrap is the established changed-helper installation
// path. Verify the whole static import closure, not merely the entrypoint bytes.
export function unpublishedCandidateImportClosure(readSource,entries=['scripts/online-unpublished-candidate.mjs','scripts/prepare-online-release-tool.mjs']){
  const seen=new Set();function visit(name){
    if(seen.has(name))return;if(!/^scripts\/[a-z0-9-]+\.mjs$/.test(name))fail('bootstrap_import_invalid');seen.add(name);
    for(const match of readSource(name).matchAll(/^\s*(?:import\s+(?:[^;]*?\s+from\s+)?|export\s+[^;]*?\s+from\s+)['"]([^'"]+)['"]\s*;?/gm)){
      const spec=match[1];if(spec.startsWith('node:'))continue;
      if(!spec.startsWith('./'))fail('bootstrap_import_invalid');visit(path.posix.normalize(path.posix.join(path.posix.dirname(name),spec)));
    }
  }for(const name of entries)visit(name);return [...seen].sort();
}
function verifySource(){
  const revision=git(APP,['rev-parse','origin/main']);if(!SHA.test(revision)||revision===incident.target)fail('tool_not_new_main');
  const directory=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  if(directory===`/var/lib/faolla-online-code/${revision}`){verifyOnlineReleaseTool(createOnlineReleaseToolPlan(revision));return revision;}
  if(directory!==`/var/lib/faolla-online-bootstrap/${revision}`)fail('tool_directory_invalid');
  assertOnlineToolOwnedPath(directory);if(git(directory,['rev-parse','HEAD'])!==revision||git(directory,['status','--porcelain=v1','--untracked-files=all']))fail('tool_source_changed');
  git(APP,['merge-base','--is-ancestor',incident.target,revision]);
  const files=unpublishedCandidateImportClosure(name=>runOnlineToolGit(APP,['show',`${revision}:${name}`]).toString('utf8'));
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
async function observe(toolRevision){
  assertOnlineToolOwnedPath(incident.operation);assertOnlineToolOwnedPath(incident.directory);
  const stateText=readOwned(`${incident.operation}/state.json`).toString('utf8'),s=JSON.parse(stateText);
  if(hash(stateText)!==incident.stateSha256)fail('original_state_changed');
  if(git(s.directory,['rev-parse','HEAD'])!==s.target||git(s.directory,['status','--porcelain=v1','--untracked-files=all']))fail('candidate_source_changed');
  for(const name of absentPaths){assertOnlineToolOwnedPath(path.dirname(name)===(s.directory+'/.next')?s.directory:path.dirname(name));if(exists(name))fail('execution_trace_present');}
  const actualPreserved=Object.fromEntries(Object.entries(preservedPaths).map(([key,name])=>[key,hash(readOwned(name))]));
  const entries=fs.readdirSync(incident.operation).sort(),expected=Object.keys(preservedPaths).filter(key=>key!=='.env.local').concat('state.json',exists(`${incident.operation}/${RECEIPT}`)?[RECEIPT]:[]).sort();
  equal(entries,expected,'operation_entries_changed');
  const diag=readOwned(preservedPaths['attendance-stage-focused-diagnostic.tap']).toString('utf8');
  if(!/^# tests 479$/m.test(diag)||!/^# pass 473$/m.test(diag)||!/^# fail 6$/m.test(diag)||/online_build_started/.test(diag))fail('focused_diagnostic_changed');
  assertExistingPm2Directory();const raw=JSON.parse(command('pm2',['jlist']));referenceAbsent(raw);
  const current=raw.map(normalizeRetirementProcess);equal(current,s.processes,'retained_process_changed');
  for(const name of ['/root/.pm2/dump.pm2','/root/.pm2/dump.pm2.bak'])referenceAbsent(JSON.parse(readOwned(name,false).toString('utf8')));
  assertOnlineToolOwnedPath('/root/.pm2/logs');if(fs.readdirSync('/root/.pm2/logs').some(name=>name.includes(s.name)))fail('candidate_pm2_log_present');
  const processReferencesAbsent=inspectProcessReferences();
  const sockets=command('/usr/sbin/ss',['-ltnH']);if(new RegExp(`:${s.port}\\s`).test(sockets))fail('candidate_port_in_use');
  const unit=`faolla-attendance-build-${s.target}.service`;
  if(command('systemctl',['show',unit,'--property=LoadState','--value']).trim()!=='not-found')fail('build_unit_present');
  // systemd 239 cannot parse the ISO T/millisecond/Z spelling. Round down to
  // the preceding whole UTC second so no beginning of this attempt is omitted.
  const journalSince=s.startedAt.slice(0,19).replace('T',' ')+' UTC';
  if(command('journalctl',['--quiet','--no-pager','--output=json',`--since=${journalSince}`,'--unit',unit]).trim())fail('build_journal_present');
  const activeText=readOwned('/var/lib/faolla-online-release/active.json').toString('utf8'),active=JSON.parse(activeText);
  equal(active,s.previousActive,'active_changed');
  const maintenanceText=readOwned(`${MAINTENANCE}/state.json`).toString('utf8');if(hash(maintenanceText)!==s.maintenanceHash||JSON.parse(maintenanceText).phase!=='ended')fail('maintenance_changed');
  const markerSha256=hash(readOwned(WEB_RELEASE_MARKER,false));if(markerSha256!==s.markerHash)fail('marker_changed');
  const baseDirectory=fs.realpathSync(`${APP}.current`);if(baseDirectory!==s.baseDirectory)fail('baseline_link_changed');
  const proxyHashes=Object.fromEntries(incident.proxyFiles.map(name=>[name,hash(readOwned(`${WEB_RELEASE_PROXY}/${name}`,false))]));
  for(const name of incident.proxyFiles)if(proxyHashes[name]!==s.configs[name].oldHash||actualPreserved[`before-${name}`]!==s.configs[name].oldHash||actualPreserved[`after-${name}`]!==s.configs[name].newHash)fail('proxy_changed');
  const history=readOnlineRetentionHistory();assertOnlineRetentionPublication({history,state:s,actualActive:active,current,action:'status'});
  const response=await fetch(`http://127.0.0.1:${s.oldPort}/api/app-web-version`,{headers:{Host:'www.faolla.com',Connection:'close'},redirect:'manual',signal:AbortSignal.timeout(10000)});
  if(response.status!==200||(await response.json()).buildId!==s.baseline)fail('baseline_version_changed');
  return {stateText,evidence:{schemaVersion:1,target:s.target,baseline:s.baseline,operation:incident.operation,observedAt:new Date().toISOString(),stateSha256:hash(stateText),sourceHead:s.target,sourceClean:true,absentPaths:[...absentPaths],buildUnit:{name:unit,loadState:'not-found',journalEmpty:true},activeText,processes:current,baseDirectory,maintenanceText,markerSha256,proxyHashes,retentionHeadSha256:history.headSha256,database:databaseObservation(toolRevision),preservedFiles:actualPreserved,processReferencesAbsent,pm2DumpReferencesAbsent:true,portVacant:true,candidateCompatibilityDatabaseAbsent:true,diagnosticKind:'focused-test-replay',diagnosticFailures:6}};
}
function durableReceipt(receipt){
  const name=`${incident.operation}/${RECEIPT}`,text=JSON.stringify(receipt,null,2)+'\n';
  const fd=fs.openSync(name,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const dir=fs.openSync(incident.operation,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
  equal(readOwned(name),Buffer.from(text),'receipt_readback_changed');
}
export async function closeUnpublishedCandidateMain(argv=process.argv.slice(2)){
  if(process.platform!=='linux'||process.getuid?.()!==0||!(argv.length===1&&argv[0]==='dry-run'||argv.length===2&&argv[0]==='end'&&argv[1]==='approved-end-unpublished-candidate-5b974eb06c85'))fail('invocation_invalid');
  const revision=verifySource();
  return withOnlineRetentionLocks(async()=>{
    if(verifySource()!==revision)fail('tool_changed');
    const before=await observe(revision),receiptPath=`${incident.operation}/${RECEIPT}`;
    if(exists(receiptPath)){
      const receipt=JSON.parse(readOwned(receiptPath).toString('utf8'));
      assertUnpublishedCandidateTerminationReceipt({stateText:before.stateText,receipt,preservedFiles:before.evidence.preservedFiles,absentPaths:before.evidence.absentPaths});
      return {status:'ended-unpublished',target:incident.target,receiptSha256:hash(readOwned(receiptPath)),reused:true,originalStateUnchanged:true};
    }
    const receipt=createUnpublishedCandidateTerminationReceipt({stateText:before.stateText,evidence:before.evidence,toolRevision:revision,terminatedAt:new Date().toISOString()});
    // Re-observe all mutable facts under the same locks before writing once.
    const after=await observe(revision);equal(after.stateText,before.stateText,'original_state_changed');
    const stable=e=>{const v={...e};delete v.observedAt;return v;};equal(stable(after.evidence),stable(before.evidence),'observation_changed');
    if(argv[0]==='dry-run')return {status:'eligible-unpublished',target:incident.target,originalStateUnchanged:true,persistentEvidenceWrites:0,toolRevision:revision};
    durableReceipt(receipt);
    const final=await observe(revision);equal(stable(final.evidence),stable(before.evidence),'post_close_observation_changed');
    assertUnpublishedCandidateTerminationReceipt({stateText:final.stateText,receipt,preservedFiles:final.evidence.preservedFiles,absentPaths:final.evidence.absentPaths});
    return {status:'ended-unpublished',target:incident.target,receiptSha256:hash(readOwned(receiptPath)),originalStateUnchanged:true,failedFilesRetained:true,productionDataChanged:false,trafficSwitched:false};
  });
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{console.log(JSON.stringify(await closeUnpublishedCandidateMain()));}catch(error){console.error(/^online_(?:unpublished|tool|retention)_[a-z_]+$/.test(error?.message??'')?error.message:'online_unpublished_unverified');process.exitCode=1;}}
