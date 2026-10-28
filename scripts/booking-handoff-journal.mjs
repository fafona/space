import {assertBookingReadyClosure as assertBookingHandoffToolClosure} from './booking-ready-policy.mjs';
import {reviewedBookingExecution} from './release-toolchain-authority.mjs';
// Actual append-only host collector for the one approved booking handoff.
// No DB mutation, routing change, restart or stop. The worker gate can be
// written only AFTER the complete five-file journal and external head commit.
import * as fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {BOOKING_HANDOFF_APPLICATION as APPLICATION,BOOKING_HANDOFF_CANDIDATE as CANDIDATE,BOOKING_HANDOFF_BASELINE as BASELINE,
  BOOKING_HANDOFF_CANDIDATE_CLOSURE_SHA256,assertBookingHandoffWindow,assertBookingLegacyRuntimeEnvironmentTransition} from './booking-handoff-policy.mjs';
import {BOOKING_RETENTION_KIND} from './booking-handoff-retention.mjs';
import {BOOKING_HANDOFF_ROOT as ROOT} from './booking-handoff-runtime.mjs';
import {assertBookingAtomicRoutingPlan,assertBookingRoutingCurrent} from './booking-handoff-routing.mjs';
import {BOOKING_INGRESS_VHOST_SHA256} from './booking-handoff-ingress.mjs';
import {assertBookingAtomicWorkerEnvironment,assertBookingAtomicWorkerGate} from './booking-atomic-worker.mjs';
import {bookingHandoffActivationSnapshotSql} from './booking-handoff-activation.mjs';
import {assertOnlineToolOwnedPath,createOnlineReleaseToolPlan,verifyOnlineReleaseTool,runOnlineToolGit} from './prepare-online-release-tool.mjs';
import {readOnlineRetentionHistory} from './online-release-retention.mjs';
import {ONLINE_RETENTION_POLICY,retentionHash,retentionCanonicalText} from './online-release-retention-policy.mjs';
import {createOnlineRetentionJournal,executeOnlineRetention,assertOnlineRetentionHeldLocks,assertOnlineRetentionPersistedProcesses} from './online-release-retention-writer.mjs';
import {normalizeRetirementProcess,parseRetirementSockets,assertExistingPm2Directory} from './online-release-retirement.mjs';
import {WEB_RELEASE_FILES,WEB_RELEASE_PROXY,WEB_RELEASE_MARKER,webReleaseRuntimeEnvironment} from './web-presentation-release-policy.mjs';
import {bookingPublicationBackupRequest,validateBookingPublicationBackupEvidence as validateAttendanceBackupEvidence} from './booking-ready-backup.mjs';

const APP='/www/wwwroot/merchant-space',RELEASE='/var/lib/faolla-online-release',CONTAINER='0a7358f7310a33feeb9bfad9142530ff3f44882234ecbc35763135f9c1bfd416';
const need=(v,c)=>{if(!v)throw Error('booking_handoff_journal_'+c);},equal=(a,b,c)=>need(isDeepStrictEqual(a,b),c);
const hash=v=>createHash('sha256').update(v).digest('hex'),sha=/^[a-f0-9]{40}(?![\s\S])/;
const env=()=>({PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',HOME:'/root',PM2_HOME:'/root/.pm2',LANG:'C.UTF-8',LC_ALL:'C.UTF-8'});
function run(bin,args,options={}){const r=spawnSync(bin,args,{encoding:'utf8',env:env(),timeout:10000,maxBuffer:32*1024**2,windowsHide:true,...options});need(r.status===0&&!r.error&&!r.signal,'command_unconfirmed');return r.stdout;}
const identity=s=>Object.fromEntries(['dev','ino','mode','uid','nlink','size','mtimeMs','ctimeMs'].map(k=>[k,s[k]]));
function read(file,privateMode=true){
  assertOnlineToolOwnedPath(file,'file');const st=fs.lstatSync(file);need(st.size>0&&st.size<=32*1024**2&&(!privateMode||(st.mode&0o777)===0o600),'file');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{equal(identity(fs.fstatSync(fd)),identity(st),'file_replaced');const b=fs.readFileSync(fd);equal(identity(fs.fstatSync(fd)),identity(st),'file_changed');equal(identity(fs.lstatSync(file)),identity(st),'file_replaced');need(b.length===st.size,'file_changed');return b.toString('utf8');}finally{fs.closeSync(fd);}
}
function writeOnce(file,text){
  assertOnlineToolOwnedPath(path.dirname(file));need((fs.lstatSync(path.dirname(file)).mode&0o777)===0o700,'private_directory');
  const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const dir=fs.openSync(path.dirname(file),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}equal(read(file),text,'write_readback');
}
function fact(pid){
  need(Number.isSafeInteger(pid)&&pid>0,'pid');const root='/proc/'+pid,s=fs.readFileSync(root+'/stat','utf8'),end=s.lastIndexOf(')'),f=s.slice(end+2).trim().split(/\s+/);
  need(end>0&&/^\d+$/.test(f[19]??'')&&fs.lstatSync(root).uid===0,'process');return {pid,uid:0,parentPid:Number(f[1]),startTicks:f[19],
    cwd:fs.realpathSync(root+'/cwd'),executable:fs.realpathSync(root+'/exe'),commandSha256:hash(fs.readFileSync(root+'/cmdline')),environmentSha256:hash(fs.readFileSync(root+'/environ'))};
}
function rawEnv(pid){
  const result={};for(const v of fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').filter(Boolean)){
    const at=v.indexOf('=');need(at>0&&!Object.hasOwn(result,v.slice(0,at)),'raw_environment');result[v.slice(0,at)]=v.slice(at+1);
  }return result;
}
const location=s=>Object.fromEntries(['target','name','directory','port'].map(k=>[k,s[k]]));
function invocation(lock,toolRevision){
  need(process.platform==='linux'&&process.getuid?.()===0,'linux_root');assertOnlineRetentionHeldLocks(lock);
  const adopted=reviewedBookingExecution(toolRevision);if(adopted)return adopted.tool;
  need(sha.test(toolRevision??'')&&path.dirname(path.dirname(fileURLToPath(import.meta.url)))==='/var/lib/faolla-online-code/'+toolRevision,'tool_path');
  const tool=verifyOnlineReleaseTool(createOnlineReleaseToolPlan(toolRevision));
  const files=runOnlineToolGit(APP,['diff','--name-only',CANDIDATE,toolRevision]).toString().trim().split('\n');
  assertBookingHandoffToolClosure({baseline:CANDIDATE,files,readBlob:f=>runOnlineToolGit(APP,['show',toolRevision+':'+f])});return tool;
}
function liveDatabase(){
  const c=JSON.parse(run('docker',['inspect','--format','{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"running":{{json .State.Running}},"mounts":{{json .Mounts}}}',CONTAINER]));
  need(c.id===CONTAINER&&c.name==='/supabase-db'&&c.running===true&&c.image==='sha256:8613ba8eab946dff6674a2db6aab75b80aa101da39035fe20f62b0c7591ab35d'&&
    c.mounts?.some(m=>m.Type==='bind'&&m.Source==='/opt/supabase/docker/volumes/db/data'&&m.RW===true),'database_container');
  return JSON.parse(run('docker',['exec','-i',CONTAINER,'sh','-lc',
    'export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql --username=supabase_admin --dbname=postgres --no-password --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1 --set=VERBOSITY=sqlstate'],{input:bookingHandoffActivationSnapshotSql,timeout:15000}).trim());
}
function assertLiveGeneration(database,expected){
  need(database?.systemIdentifier==='7612049595342295079'&&database.databaseOid==='5'&&database.serverVersionNum==='150008'&&database.active===true&&
    database.protocol===2&&database.generation===expected.generation&&/^\d+$/.test(database.revision)&&BigInt(database.revision)>=BigInt(expected.revision),'database_active_generation');
  // Real users may legitimately book after ingress reopens. Do not compare
  // current records/revision with the immutable at-commit no-data-loss proof.
}

export async function executeBookingHandoffJournal(operations){
  const history=operations.history();await operations.verifyPrerequisites();await operations.persistProcesses();
  const first=await operations.observe();need(first.kind===BOOKING_RETENTION_KIND,'kind');
  return executeOnlineRetention(operations,first,history);
}

export function createBookingHandoffRetentionOperations({lock,toolRevision}){
  const tool=invocation(lock,toolRevision),proofText=read(ROOT+'/handoff-proof.json'),handoff=JSON.parse(proofText),e=handoff.evidence;
  equal(proofText,retentionCanonicalText(handoff),'proof_encoding');need(e.toolRevision===toolRevision,'proof_tool');
  const prior=readOnlineRetentionHistory();need(prior.entries.at(-1)?.active.target===BASELINE&&prior.headSha256===e.priorRetentionHeadSha256,'predecessor');
  let journal=null,persisted=false;
  const history=()=>journal?journal.prefix():readOnlineRetentionHistory();
  const verifyProof=()=>{
    assertOnlineRetentionHeldLocks(lock);assertBookingHandoffWindow(e.window,{nowMs:Date.now()});equal(read(ROOT+'/handoff-proof.json'),proofText,'proof_changed');
    equal(invocation(lock,toolRevision),tool,'tool_changed');need(e.sourceClosureSha256===BOOKING_HANDOFF_CANDIDATE_CLOSURE_SHA256,'source_closure');
    equal(read(ROOT+'/primary-original-stage.json'),handoff.originalStageText,'original_stage_changed');
    for(const [file,key]of [['preflight.json','preflightSha256'],['ingress-receipt.json','ingressGateSha256'],['legacy-drain.json','legacyDrainSha256'],['recovery-plan.json','recoveryPlanSha256']])
      need(hash(read(ROOT+'/'+file))===e[key],'evidence_changed');
    for(const [file,key,expected]of [['activation.json','activationSha256',{before:handoff.databaseBefore,after:handoff.databaseAfter}],
      ['rule-repair.json','ruleRepairSha256',handoff.ruleRepair],['rollback-readiness.json','rollbackReadinessSha256',handoff.rollbackReadiness]]){
      const value=JSON.parse(read(ROOT+'/'+file));equal(value,expected,'receipt_changed');need(retentionHash(value)===e[key],'receipt_hash');
    }
    need(hash(read(RELEASE+'/'+CANDIDATE+'/booking-compatibility.json'))===e.compatibilitySha256,'compatibility_changed');
    const inactive=JSON.parse(read(RELEASE+'/'+CANDIDATE+'/booking-database-inactive.json'));
    need(inactive.status==='installed-inactive'&&inactive.backupSha256===e.backupSha256,'backup_binding');
    const ingress=JSON.parse(read(ROOT+'/ingress-receipt.json'));
    equal(ingress.window,e.window,'ingress_window');const closedAt=Date.parse(ingress.completedAt);
    need(ingress.schemaVersion===1&&ingress.kind==='booking-only-ingress-completed'&&ingress.window.id===e.window.id&&ingress.closed===true&&
      ingress.beforeSha256===BOOKING_INGRESS_VHOST_SHA256&&ingress.beforeSha256===hash(read('/www/server/panel/vhost/nginx/www.faolla.com.conf',false))&&
      Number.isFinite(closedAt)&&new Date(closedAt).toISOString()===ingress.completedAt&&closedAt>=Date.parse(e.window.startedAt)&&closedAt<=Date.parse(e.completedAt),'ingress_not_closed');
    const routing=JSON.parse(read(ROOT+'/routing-plan.json'));assertBookingAtomicRoutingPlan(routing);equal(routing.window,e.window,'routing_window');
    assertBookingRoutingCurrent(routing,Object.fromEntries(WEB_RELEASE_FILES.map(f=>[f,read(WEB_RELEASE_PROXY+'/'+f,false)])),{phase:'primary'});
    const transition=JSON.parse(read(ROOT+'/legacy-runtime-transition.json'));assertBookingLegacyRuntimeEnvironmentTransition(transition);
    equal(transition.legacyBefore,handoff.legacyBefore,'legacy_before');equal(transition.legacyAfter,handoff.legacyAfter,'legacy_after');
    equal(transition.window,e.window,'legacy_window');
    const rows=JSON.parse(pm(['jlist'])),legacy=rows.find(p=>p.name==='merchant-space');
    equal(normalizeRetirementProcess(legacy),handoff.legacyAfter,'legacy_changed');equal(rawEnv(legacy.pid),transition.afterRaw,'legacy_raw_changed');
    equal(legacy.pm2_env.env,transition.afterConfigured,'legacy_configuration_changed');
    const preflight=JSON.parse(read(ROOT+'/preflight.json'));
    need(preflight.legacyRawSha256===hash(retentionCanonicalText(transition.beforeRaw))&&preflight.legacyConfiguredSha256===hash(retentionCanonicalText(transition.beforeConfigured)),'preflight_legacy_binding');
    assertLiveGeneration(liveDatabase(),handoff.databaseAfter);
  };
  const daemon=()=>{assertExistingPm2Directory();const pid=Number(read('/root/.pm2/pm2.pid',false).trim());const f=fact(pid);
    need(fs.readFileSync('/proc/'+pid+'/cmdline','utf8').replace(/\0+$/,'')==='PM2 v6.0.14: God Daemon (/root/.pm2)','daemon');return f;};
  const initialDaemon=daemon(),pmBinary=fs.realpathSync(run('which',['pm2']).trim());assertOnlineToolOwnedPath(pmBinary,'file');
  need(JSON.parse(read(path.dirname(path.dirname(pmBinary))+'/package.json',false)).version==='6.0.14','pm2_version');
  const pm=args=>{equal(daemon(),initialDaemon,'daemon_changed');const v=run(pmBinary,args);equal(daemon(),initialDaemon,'daemon_changed');return v;};
  const processes=rows=>rows.map(normalizeRetirementProcess).sort((a,b)=>a.pmId-b.pmId);
  const identities=rows=>rows.filter(p=>p.status==='online').map(p=>({name:p.name,...fact(p.pid)})).sort((a,b)=>a.name.localeCompare(b.name));
  const observe=async()=>{
    verifyProof();const prefix=history();equal(prefix,prior,'history_changed');
    const raw=JSON.parse(pm(['jlist'])),current=processes(raw),activeText=read(RELEASE+'/'+CANDIDATE+'/state.json'),activeState=JSON.parse(activeText);
    const active={...location(activeState),process:current.find(p=>p.name===activeState.name)},backText=read(RELEASE+'/'+APPLICATION+'/state.json'),backState=JSON.parse(backText);
    const rollback={...location(backState),process:current.find(p=>p.name===backState.name)};
    const releaseProofs=[];
    for(const a of [active,rollback]){
      need(runOnlineToolGit(a.directory,['rev-parse','HEAD']).toString().trim()===a.target&&!runOnlineToolGit(a.directory,['status','--porcelain=v1','--untracked-files=all']).toString().trim(),'release_source');
      const atomicText=read(RELEASE+'/'+a.target+'/atomic-runtime.json'),saved=JSON.parse(atomicText),actual=webReleaseRuntimeEnvironment(fs.readFileSync('/proc/'+a.process.pid+'/environ','utf8'));
      if(a.target===CANDIDATE){
        const original=JSON.parse(handoff.originalStageText),originalRuntime=read(RELEASE+'/'+CANDIDATE+'/runtime.json');
        need(hash(originalRuntime)===original.bookingRuntimeSha256&&hash(read(a.directory+'/.env.local'))===original.bookingEnvironmentFileSha256&&
          hash(read(RELEASE+'/'+CANDIDATE+'/attendance-build-proof.json'))===original.bookingBuildProofSha256,'primary_build_artifacts');
        equal(saved,{...JSON.parse(originalRuntime),MERCHANT_BOOKING_STORAGE_MODE:'atomic-v2'},'primary_atomic_delta');
      }else{
        need(hash(atomicText)===handoff.rollbackReadiness.runtimeSha256&&hash(read(a.directory+'/.env.local'))===handoff.rollbackReadiness.environmentFileSha256&&
          hash(read(RELEASE+'/'+APPLICATION+'/attendance-build-proof.json'))===handoff.rollbackReadiness.buildEvidenceSha256,'rollback_artifacts');
      }
      for(const [k,v]of Object.entries(saved))need(actual[k]===v,'runtime_changed');
      for(const [k,v]of Object.entries(handoff.runtimeByName[a.name]))need(actual[k]===v,'runtime_receipt_changed');
      need(!actual.RESEND_API_KEY&&!actual.BOOKING_CONFIRMATION_EMAIL_FROM,'mail');
      const response=await fetch('http://127.0.0.1:'+a.port+'/api/app-web-version',{headers:{Host:'www.faolla.com',Connection:'close'},redirect:'manual',signal:AbortSignal.timeout(3000)}),v=await response.json();
      need(response.status===200&&v.ok===true&&v.buildId===a.target,'release_http');
      const stateText=a.target===CANDIDATE?activeText:backText;
      releaseProofs.push({target:a.target,sourceHead:a.target,sourceClean:true,resolvedInterpreter:fs.realpathSync(a.process.interpreter),
        state:JSON.parse(stateText),stateText,stateSha256:hash(stateText),buildSha256:hash(read(a.directory+'/.next/BUILD_ID',false)),
        runtimeSha256:hash(atomicText),environmentSha256:hash(read(a.directory+'/.env.local')),http:{status:response.status,ok:v.ok,buildId:v.buildId}});
    }
    const worker=current.find(p=>p.name==='merchant-space-booking-atomic-'+CANDIDATE.slice(0,12));
    const workerEnv=rawEnv(worker.pid),workerSaved=JSON.parse(read(ROOT+'/worker-runtime.json'));assertBookingAtomicWorkerEnvironment(workerEnv);
    for(const [k,v]of Object.entries(workerSaved))need(workerEnv[k]===v,'worker_environment_changed');
    const maintenanceText=read('/var/lib/faolla-maintenance/merchant-space/state.json');
    for(const origin of ['https://faolla.com','https://launch.faolla.com']){
      const response=await fetch(origin+'/api/app-web-version?bookingHandoff='+e.window.id,{cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(3000)}),value=await response.json();
      need(response.status===200&&value.ok===true&&value.buildId===CANDIDATE,'public_routing_changed');
    }
    runOnlineToolGit(APP,['merge-base','--is-ancestor',APPLICATION,CANDIDATE]);
    const observation={version:2,policy:ONLINE_RETENTION_POLICY,kind:BOOKING_RETENTION_KIND,toolRevision,sequence:prior.entries.length+1,previousSha256:prior.headSha256,
      legacySha256:prior.rollingHistory.legacySha256,rollingHeadSha256:prior.rollingHistory.headSha256,rollingHistorySha256:retentionHash(prior.rollingHistory),
      active,rollback,victim:null,activeFile:JSON.parse(read(RELEASE+'/active.json')),activeState,activeSha256:hash(activeText),processes:current,
      sourceClean:true,sourceInventorySha256:tool.inventorySha256,maintenanceEnded:JSON.parse(maintenanceText).phase==='ended',maintenanceSha256:hash(maintenanceText),
      markerSha256:hash(read(WEB_RELEASE_MARKER,false)),baseDirectory:fs.realpathSync(APP+'.current'),
      proxyHashes:Object.fromEntries(WEB_RELEASE_FILES.map(f=>[f,hash(read(WEB_RELEASE_PROXY+'/'+f,false))])),nginxConfig:run('/www/server/nginx/sbin/nginx',['-T']),
      releaseProofs,identityProofs:identities(current),ancestry:[{older:APPLICATION,newer:CANDIDATE,verified:true}],bookingHandoff:handoff,
      ...parseRetirementSockets(run('ss',['-ltnpH']),run('ss',['-tnpH']))};
    equal(processes(JSON.parse(pm(['jlist']))),current,'process_changed_during_observation');equal(identities(current),observation.identityProofs,'os_identity_changed');
    verifyProof();return observation;
  };
  return {history,observe,now:()=>new Date().toISOString(),wait:ms=>new Promise(r=>setTimeout(r,ms)),
    verifyPrerequisites:async()=>{verifyProof();const backup=await validateAttendanceBackupEvidence(bookingPublicationBackupRequest(CANDIDATE,RELEASE+'/'+CANDIDATE));
      need(backup.archiveSha256===e.backupSha256,'backup_archive_changed');verifyProof();},
    persistProcesses:async()=>{
      verifyProof();need(!persisted,'save_repeated');persisted=true;const before=processes(JSON.parse(pm(['jlist'])));
      writeOnce(ROOT+'/pm2-save-attempt.json',retentionCanonicalText({at:new Date().toISOString(),processes:before}));pm(['save']);
      assertOnlineRetentionPersistedProcesses(JSON.parse(pm(['jlist'])),JSON.parse(read('/root/.pm2/dump.pm2',false)),{processes:before});
    },
    recovery:async()=>({version:2,process:null}),
    begin:(_before,prefix)=>{assertOnlineRetentionHeldLocks(lock);need(!journal,'journal_repeated');equal(prefix,prior,'history_changed');journal=createOnlineRetentionJournal(prior);journal.begin();},
    write:(file,text)=>{assertOnlineRetentionHeldLocks(lock);need(journal,'journal_missing');journal.write(file,text);},
    finalCheck:()=>observe(),
    complete:certificate=>{assertOnlineRetentionHeldLocks(lock);need(journal,'journal_missing');return journal.complete(certificate);},
  };
}

export async function commitBookingHandoffRetention(options){return executeBookingHandoffJournal(createBookingHandoffRetentionOperations(options));}

export function enableCommittedBookingWorker({lock,toolRevision}){
  invocation(lock,toolRevision);const history=readOnlineRetentionHistory(),certificate=history.entries.at(-1);
  need(certificate?.kind===BOOKING_RETENTION_KIND&&certificate.toolRevision===toolRevision,'committed_handoff_required');
  const gate={schemaVersion:1,kind:'booking-atomic-worker-gate',candidate:CANDIDATE,toolRevision,certificateSha256:retentionHash(certificate),
    generation:certificate.bookingHandoff.databaseAfter.generation,enabled:true};
  assertExistingPm2Directory();const pid=Number(read('/root/.pm2/pm2.pid',false).trim()),daemon=fact(pid);
  need(fs.readFileSync('/proc/'+pid+'/cmdline','utf8').replace(/\0+$/,'')==='PM2 v6.0.14: God Daemon (/root/.pm2)','daemon');
  const pmBinary=fs.realpathSync(run('which',['pm2']).trim());assertOnlineToolOwnedPath(pmBinary,'file');
  need(JSON.parse(read(path.dirname(path.dirname(pmBinary))+'/package.json',false)).version==='6.0.14','pm2_version');
  const current=JSON.parse(run(pmBinary,['jlist'])).map(normalizeRetirementProcess),actualActive=JSON.parse(read(RELEASE+'/active.json'));
  equal(fact(pid),daemon,'daemon_changed');
  assertBookingAtomicWorkerGate({gate,history,actualActive,current,toolRevision});assertLiveGeneration(liveDatabase(),certificate.bookingHandoff.databaseAfter);
  equal(readOnlineRetentionHistory(),history,'history_changed');equal(fact(pid),daemon,'daemon_changed');assertOnlineRetentionHeldLocks(lock);
  writeOnce(ROOT+'/worker-enabled.json',retentionCanonicalText(gate));equal(JSON.parse(read(ROOT+'/worker-enabled.json')),gate,'gate_readback');return {certificateSha256:gate.certificateSha256,generation:gate.generation};
}
