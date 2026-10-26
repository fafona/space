// Failure recovery only. Never activates/deactivates DB authority, restores old
// booking JSON, enables mail, appends a success certificate or replays a restart.
import * as fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {BOOKING_HANDOFF_CANDIDATE as CANDIDATE,BOOKING_HANDOFF_APPLICATION as APPLICATION,BOOKING_HANDOFF_BASELINE as BASELINE} from './booking-handoff-policy.mjs';
import {BOOKING_HANDOFF_ROOT as ROOT} from './booking-handoff-runtime.mjs';
import {assertBookingWatchdogLease,assertBookingWatchdogInheritedLease} from './booking-handoff-watchdog.mjs';
import {assertBookingAtomicRoutingPlan,assertBookingRoutingCurrent} from './booking-handoff-routing.mjs';
import {bookingIngressRestorationText,BOOKING_INGRESS_VHOST} from './booking-handoff-ingress.mjs';
import {collectBookingLegacyHost,bookingLegacyPauseTransition,executeBookingLegacyPause,invokeBookingLegacyPause,waitBookingLegacyPauseSettled} from './booking-handoff-legacy.mjs';
import {retentionCanonicalText} from './online-release-retention-policy.mjs';
import {normalizeRetirementProcess,parseRetirementSockets,assertExistingPm2Directory} from './online-release-retirement.mjs';
import {assertOnlineRetentionPersistedProcesses} from './online-release-retention-writer.mjs';
import {WEB_RELEASE_FILES,WEB_RELEASE_PROXY} from './web-presentation-release-policy.mjs';
import {assertOnlineToolOwnedPath,runOnlineToolGit} from './prepare-online-release-tool.mjs';
import {BOOKING_PROTECTED_SLUGS} from './booking-publication-database.mjs';

const RELEASE='/var/lib/faolla-online-release',CONTAINER='0a7358f7310a33feeb9bfad9142530ff3f44882234ecbc35763135f9c1bfd416';
const hash=v=>createHash('sha256').update(v).digest('hex'),need=(v,c)=>{if(!v)throw Error('booking_recovery_'+c);},equal=(a,b,c)=>need(isDeepStrictEqual(a,b),c);
const environment=()=>({PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',HOME:'/root',PM2_HOME:'/root/.pm2',LANG:'C.UTF-8',LC_ALL:'C.UTF-8'});
function run(bin,args,options={}){const r=spawnSync(bin,args,{encoding:'utf8',env:environment(),timeout:10000,maxBuffer:32*1024**2,windowsHide:true,...options});need(r.status===0&&!r.error&&!r.signal,'command_unconfirmed');return r.stdout;}
const exists=file=>{try{fs.lstatSync(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
function read(file,privateMode=true){assertOnlineToolOwnedPath(file,'file');const s=fs.lstatSync(file);need(s.size>0&&s.size<=32*1024**2&&(!privateMode||(s.mode&0o777)===0o600),'file');
  const id=s=>Object.fromEntries(['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'].map(k=>[k,s[k]]));const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{equal(id(fs.fstatSync(fd)),id(s),'file_replaced');const b=fs.readFileSync(fd);equal(id(fs.fstatSync(fd)),id(s),'file_changed');equal(id(fs.lstatSync(file)),id(s),'file_replaced');need(b.length===s.size,'file_changed');return b.toString('utf8');}finally{fs.closeSync(fd);}}
function sync(dir){const fd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function write(file,text){assertOnlineToolOwnedPath(path.dirname(file));const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}sync(path.dirname(file));equal(read(file),text,'write_readback');}
function replace(file,before,after,suffix){equal(read(file,false),before,'before_changed');if(before===after)return;const temporary=file+'.booking-'+suffix+'.tmp';write(temporary,after);equal(read(file,false),before,'before_changed');fs.renameSync(temporary,file);sync(path.dirname(file));equal(read(file,false),after,'replacement_readback');}
function fact(pid){need(Number.isSafeInteger(pid)&&pid>0,'pid');const root='/proc/'+pid,s=fs.readFileSync(root+'/stat','utf8'),end=s.lastIndexOf(')'),f=s.slice(end+2).trim().split(/\s+/);need(end>0&&/^\d+$/.test(f[19]??'')&&fs.lstatSync(root).uid===0,'process');return {pid,uid:0,parentPid:Number(f[1]),startTicks:f[19],cwd:fs.realpathSync(root+'/cwd'),executable:fs.realpathSync(root+'/exe'),commandSha256:hash(fs.readFileSync(root+'/cmdline'))};}
function rawEnv(pid){const v={};for(const item of fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').filter(Boolean)){const at=item.indexOf('=');need(at>0&&!Object.hasOwn(v,item.slice(0,at)),'raw_environment');v[item.slice(0,at)]=item.slice(at+1);}return v;}
const location=s=>Object.fromEntries(['target','name','directory','port'].map(k=>[k,s[k]]));

const savedRows=`(select encode(sha256(convert_to(count(*)::text||':'||coalesce(string_agg(h,'' order by h collate "C"),''),'UTF8')),'hex') from
 (select encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') h from public.pages p where slug in
 (${BOOKING_PROTECTED_SLUGS.map(s=>"'"+s+"'").join(',')})) saved)`;
export const BOOKING_RECOVERY_BARRIER_SQL=`begin;set local lock_timeout='45s';set local statement_timeout='50s';
lock table public.pages,public.faolla_booking_atomic_control,public.faolla_booking_atomic_commands,public.faolla_booking_mail_jobs in share row exclusive mode;
select jsonb_build_object('systemIdentifier',(select system_identifier::text from pg_control_system()),
 'databaseOid',(select oid::text from pg_database where datname=current_database()),'serverVersionNum',current_setting('server_version_num'),
 'databaseName',current_database(),'currentUser',current_user,'primary',not pg_is_in_recovery(),
 'active',active,'protocol',protocol,'generation',generation::text,'savedBookingRowsSha256',${savedRows}) from public.faolla_booking_atomic_control;
rollback;`;
// The barrier waits for the complete repair+flip transaction, including its
// commit or rollback. A plain MVCC SELECT false while an old writer is in flight
// is NOT sufficient to authorize a return to the legacy runtime.
export function selectBookingRecoveryTarget(database,legacy){
  return database?.active===false&&database.barrierCompleted===true&&legacy.originalIntact===true&&database.activationCommitted!==true&&
    (database.activationAttempted===false||database.activationAttempted===true&&database.originalRowsUntouched===true)?'baseline':'rollback';
}
export async function executeBookingFailureRecovery(operations,lease){
  assertBookingWatchdogLease(lease);return executeBookingFailureRecoverySequence(operations,lease);
}
// The native fixture uses this IO sequence with its OWN real process/FD/DB
// identities, never a fabricated production PID, lock token or system identifier.
export async function executeBookingFailureRecoverySequence(operations,lease){
  await operations.verify();await operations.parentGone();
  const before=await operations.capture(),database=await operations.databaseBarrier(),legacy=await operations.legacyState(),phase=selectBookingRecoveryTarget(database,legacy);
  await operations.begin({schemaVersion:1,kind:'booking-window-failure-recovery-attempt',operationId:lease.window.id,phase,before,database,legacy,startedAt:operations.now()});
  await operations.disableBookingWorker();let legacyPause={confirmed:legacy.paused===true,attempted:false};
  if(phase==='rollback'&&database.active===true&&!legacyPause.confirmed)legacyPause=await operations.pauseLegacyOnce(database);
  await operations.route(phase);await operations.unfence();const publicProof=await operations.publicProof(phase);
  await operations.publicationMetadata(phase);await operations.persistProcesses();
  const completedAt=operations.now(),receipt={schemaVersion:1,kind:'booking-window-failure-recovery',operationId:lease.window.id,phase,
    target:phase==='baseline'?BASELINE:APPLICATION,database,legacyPause,publicProof,gateClosed:true,normalHandoffCompleted:false,completedAt,
    withinAuthorizedWindow:Date.parse(completedAt)<Date.parse(lease.window.deadlineAt)};
  await operations.complete(receipt);return receipt;
}

function productionOperations(lease){
  const verify=()=>assertBookingWatchdogInheritedLease(lease,{requireParentGone:true});verify();
  const routingText=read(ROOT+'/routing-plan.json'),plan=JSON.parse(routingText);assertBookingAtomicRoutingPlan(plan);equal(plan.window,lease.window,'routing_window');
  const gateText=read(ROOT+'/ingress-plan.json'),gate=JSON.parse(gateText);bookingIngressRestorationText(gate,gate.afterText);equal(gate.window,lease.window,'ingress_window');
  const preflight=JSON.parse(read(ROOT+'/preflight.json'));need(preflight.databaseBefore?.active===false&&preflight.databaseBefore.protocol===2,'preflight_database');
  const pm=args=>{
    assertExistingPm2Directory();const pid=Number(fs.readFileSync('/root/.pm2/pm2.pid','utf8').trim()),before=fact(pid);
    need(fs.readFileSync('/proc/'+pid+'/cmdline','utf8').replace(/\0+$/,'')==='PM2 v6.0.14: God Daemon (/root/.pm2)','pm2_daemon');
    const result=run('/usr/bin/node',['/usr/lib/node_modules/pm2/bin/pm2',...args]);equal(fact(pid),before,'pm2_daemon_changed');return result;
  };
  const rollbackReady=()=>{
    const all=JSON.parse(pm(['jlist'])),raw=all.find(p=>p.name===plan.rollback.name),p=normalizeRetirementProcess(raw),f=fact(p.pid);
    need(p.status==='online'&&p.cwd===plan.rollback.directory&&p.port===plan.rollback.port&&p.executable===p.cwd+'/node_modules/next/dist/bin/next'&&p.interpreter==='/usr/bin/node'&&
      p.backgroundPaused==='1'&&p.automationEnabled==='0'&&p.invitationEnabled==='0'&&p.watch===false&&p.shutdownWithMessage===false&&[null,false,'0'].includes(p.cronRestart)&&
      [undefined,''].includes(p.manualSignalHandle)&&p.execMode==='fork_mode'&&f.cwd===p.cwd&&f.executable==='/usr/bin/node','rollback_process');
    equal(p.args,['start','-H','127.0.0.1','-p',String(p.port)],'rollback_args');equal(p.nodeArgs,[],'rollback_args');
    need(runOnlineToolGit(p.cwd,['rev-parse','HEAD']).toString().trim()===APPLICATION&&!runOnlineToolGit(p.cwd,['status','--porcelain=v1','--untracked-files=all']).toString().trim(),'rollback_source');
    const attempt=JSON.parse(read(ROOT+'/runtime-attempt.json')),saved=JSON.parse(read(RELEASE+'/'+APPLICATION+'/atomic-runtime.json')),actual=rawEnv(p.pid);
    equal(saved,attempt.plan.runtimeByName[p.name],'rollback_runtime_changed');for(const [k,v]of Object.entries(saved))need(actual[k]===v,'rollback_actual_environment');
    need(actual.MERCHANT_BOOKING_STORAGE_MODE==='atomic-v2'&&actual.MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED==='0'&&!actual.RESEND_API_KEY&&!actual.BOOKING_CONFIRMATION_EMAIL_FROM,'rollback_storage');
    const sockets=parseRetirementSockets(run('ss',['-ltnpH']),run('ss',['-tnpH']));equal(sockets.listeners.filter(s=>s.port===p.port||s.pid===p.pid),[{address:'127.0.0.1',port:p.port,pid:p.pid}],'rollback_listener');
    return {process:p,identity:f};
  };
  const current=()=>Object.fromEntries(WEB_RELEASE_FILES.map(f=>[f,read(WEB_RELEASE_PROXY+'/'+f,false)]));
  const databaseBarrier=()=>{
    verify();const container=JSON.parse(run('docker',['inspect','--format','{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"running":{{json .State.Running}},"mounts":{{json .Mounts}}}',CONTAINER]));
    need(container.id===CONTAINER&&container.name==='/supabase-db'&&container.running===true&&container.image==='sha256:8613ba8eab946dff6674a2db6aab75b80aa101da39035fe20f62b0c7591ab35d'&&
      container.mounts?.some(m=>m.Type==='bind'&&m.Source==='/opt/supabase/docker/volumes/db/data'&&m.RW===true),'database_container');
    const r=spawnSync('docker',['exec','-i',CONTAINER,'sh','-lc','export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql --username=supabase_admin --dbname=postgres --no-password --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1 --set=VERBOSITY=sqlstate'],
      {input:BOOKING_RECOVERY_BARRIER_SQL,env:environment(),encoding:'utf8',timeout:55000,maxBuffer:65536,windowsHide:true});
    if(r.status!==0||r.error||r.signal)return {active:null,barrierCompleted:false,result:'unknown'};
    const value=JSON.parse(r.stdout.trim());need(value.systemIdentifier==='7612049595342295079'&&value.databaseOid==='5'&&value.serverVersionNum==='150008'&&value.databaseName==='postgres'&&
      value.currentUser==='supabase_admin'&&value.primary===true&&value.protocol===2&&typeof value.active==='boolean'&&value.generation===preflight.databaseBefore.generation,'database_generation');
    const attempted=exists(ROOT+'/activation-attempt.json'),attempt=attempted?JSON.parse(read(ROOT+'/activation-attempt.json')):null;
    const committed=exists(ROOT+'/activation.json')&&JSON.parse(read(ROOT+'/activation.json')).after?.active===true;
    return {...value,barrierCompleted:true,activationAttempted:attempted,activationCommitted:committed,
      originalRowsUntouched:attempted&&attempt.before?.savedBookingRowsSha256===value.savedBookingRowsSha256};
  };
  const pauseLegacyOnce=async()=>{
    verify();let attempt;
    if(exists(ROOT+'/legacy-restart-attempt.json')){
      attempt=JSON.parse(read(ROOT+'/legacy-restart-attempt.json'));equal(attempt.window,lease.window,'restart_window');
      let after;
      try{after=collectBookingLegacyHost();}catch(error){if(!['booking_legacy_pause_legacy_host','booking_legacy_pause_legacy_os_host'].includes(error.message)&&!['ENOENT','ESRCH'].includes(error.code))throw error;}
      if(after?.legacy.backgroundPaused!=='1'){
        try{after=await waitBookingLegacyPauseSettled(lease.window,verify);}catch(error){if(!['booking_legacy_pause_restart_not_settled','booking_handoff_window_expired'].includes(error.message))throw error;return {confirmed:false,attempted:true,result:'prior_restart_unknown_no_retry'};}
      }
      if(Date.now()>=Date.parse(lease.window.deadlineAt))return {confirmed:false,attempted:true,result:'prior_restart_observed_after_window_no_retry'};
      const transition=bookingLegacyPauseTransition(attempt.before,after,lease.window,new Date().toISOString());
      if(!exists(ROOT+'/legacy-runtime-transition.json'))write(ROOT+'/legacy-runtime-transition.json',retentionCanonicalText(transition));
      return {confirmed:true,attempted:true,result:'existing_attempt_verified_without_replay'};
    }
    const drain=JSON.parse(read(ROOT+'/legacy-drain.json'));need(drain.window.id===lease.window.id&&drain.automationEligibleRecords===0,'legacy_drain');
    if(Date.now()>=Date.parse(lease.window.deadlineAt)-60000)return {confirmed:false,attempted:false,result:'insufficient_time_no_restart'};
    const observed=collectBookingLegacyHost();equal(observed.legacy,preflight.legacyBefore,'legacy_preflight');
    need(hash(retentionCanonicalText(observed.raw))===preflight.legacyRawSha256&&hash(retentionCanonicalText(observed.configured))===preflight.legacyConfiguredSha256,'legacy_environment');
    try{
      await executeBookingLegacyPause({now:()=>new Date().toISOString(),observe:()=>collectBookingLegacyHost(),admit:()=>verify(),
        begin:a=>{verify();write(ROOT+'/legacy-restart-attempt.json',retentionCanonicalText(a));},
        restart:before=>{verify();const ack=invokeBookingLegacyPause(before);write(ROOT+'/legacy-restart-rpc-ack.json',retentionCanonicalText(ack));return ack;},
        settled:()=>waitBookingLegacyPauseSettled(lease.window,verify),complete:value=>{verify();write(ROOT+'/legacy-runtime-transition.json',retentionCanonicalText(value));},
      },lease.window);return {confirmed:true,attempted:true,result:'single_restart_verified'};
    }catch(error){
      if(!['booking_legacy_pause_restart_outcome_unknown','booking_legacy_pause_restart_not_settled','booking_handoff_window_expired'].includes(error.message))throw error;
      // No second RPC. A lost acknowledgement may still have changed the
      // process, so only re-read the actual result of the existing attempt.
      const saved=JSON.parse(read(ROOT+'/legacy-restart-attempt.json'));
      try{const after=await waitBookingLegacyPauseSettled(lease.window,verify),transition=bookingLegacyPauseTransition(saved.before,after,lease.window,new Date().toISOString());
        write(ROOT+'/legacy-runtime-transition.json',retentionCanonicalText(transition));return {confirmed:true,attempted:true,result:'unknown_rpc_resolved_by_read_only_proof'};
      }catch(next){if(!['booking_legacy_pause_restart_not_settled','booking_handoff_window_expired'].includes(next.message))throw next;return {confirmed:false,attempted:true,result:'restart_unknown_no_retry'};}
    }
  };
  return {verify,now:()=>new Date().toISOString(),parentGone:()=>verify(),
    capture:()=>{verify();assertBookingRoutingCurrent(plan,current());return {proxyHashes:Object.fromEntries(Object.entries(current()).map(([k,v])=>[k,hash(v)])),activeFileText:read(RELEASE+'/active.json'),processes:JSON.parse(pm(['jlist'])).map(normalizeRetirementProcess)};},
    databaseBarrier,
    legacyState:()=>{try{const legacy=collectBookingLegacyHost();return {paused:legacy.legacy.backgroundPaused==='1',originalIntact:isDeepStrictEqual(legacy.legacy,preflight.legacyBefore)&&
      hash(retentionCanonicalText(legacy.raw))===preflight.legacyRawSha256&&hash(retentionCanonicalText(legacy.configured))===preflight.legacyConfiguredSha256};}
      catch(error){if(!['booking_legacy_pause_legacy_host','booking_legacy_pause_legacy_os_host'].includes(error.message)&&!['ENOENT','ESRCH'].includes(error.code))throw error;return {paused:false,originalIntact:false,result:'legacy_process_unsettled'};}},
    begin:proof=>{verify();write(ROOT+'/watchdog-recovery-attempt.json',retentionCanonicalText(proof));},
    disableBookingWorker:()=>{
      verify();const gateFile=ROOT+'/worker-enabled.json';if(!exists(gateFile))return;
      const text=read(gateFile),value=JSON.parse(text);need(value.kind==='booking-atomic-worker-gate'&&value.candidate===CANDIDATE&&value.toolRevision===lease.toolRevision&&value.generation===preflight.databaseBefore.generation,'worker_gate_not_owned');
      write(ROOT+'/worker-gate-before-recovery.json',text);fs.renameSync(gateFile,ROOT+'/worker-disabled-by-recovery.json');sync(ROOT);
    },pauseLegacyOnce,
    route:phase=>{
      verify();if(phase==='rollback')rollbackReady();const before=current();assertBookingRoutingCurrent(plan,before);const target=phase==='baseline'?plan.before:plan.phases.rollback;
      for(const file of WEB_RELEASE_FILES){verify();replace(WEB_RELEASE_PROXY+'/'+file,before[file],target[file],lease.window.id+'-recovery');}
      equal(current(),target,'routing_readback');run('/www/server/nginx/sbin/nginx',['-t']);run('/www/server/nginx/sbin/nginx',['-s','reload']);
    },
    unfence:()=>{
      verify();const before=read(BOOKING_INGRESS_VHOST,false);if(before!==gate.beforeText){const after=bookingIngressRestorationText(gate,before);replace(BOOKING_INGRESS_VHOST,before,after,lease.window.id+'-recovery');
        run('/www/server/nginx/sbin/nginx',['-t']);run('/www/server/nginx/sbin/nginx',['-s','reload']);}
      need(read(BOOKING_INGRESS_VHOST,false)===gate.beforeText,'ingress_readback');
    },
    publicProof:async phase=>{
      const target=phase==='baseline'?BASELINE:APPLICATION,proof=[];
      for(const origin of ['https://faolla.com','https://launch.faolla.com']){
        let confirmed=false;for(let i=0;i<10&&!confirmed;i++){
          verify();try{const r=await fetch(origin+'/api/app-web-version?bookingRecovery='+lease.window.id,{cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(1000)}),v=await r.json();confirmed=r.status===200&&v.ok===true&&v.buildId===target;}catch{/* read-only probe only */}
          if(!confirmed)await new Promise(r=>setTimeout(r,100));
        }need(confirmed,'public_not_recovered');proof.push({origin,status:200,buildId:target});
      }return proof;
    },
    publicationMetadata:phase=>{
      verify();const before=read(RELEASE+'/active.json'),actual=JSON.parse(before),baseline=JSON.parse(preflight.activeFileText);
      const allowed=[baseline,plan.primary,plan.rollback];need(allowed.some(a=>isDeepStrictEqual(location(actual),location(a)))&&Object.keys(actual).length===4,'active_file_not_owned');
      const next=phase==='baseline'?preflight.activeFileText:JSON.stringify(plan.rollback);write(ROOT+'/active-file-before-recovery.json',before);
      replace(RELEASE+'/active.json',before,next,lease.window.id+'-recovery');
      const stateFile=RELEASE+'/'+CANDIDATE+'/state.json',text=read(stateFile),state=JSON.parse(text);equal(location(state),plan.primary,'primary_state_not_owned');
      need(['database-ready','booking-handoff-switching','active'].includes(state.status),'primary_state_changed');
      write(ROOT+'/primary-state-before-recovery.json',text);
      const failed=JSON.stringify({...state,status:'booking-cutover-failed',bookingRecoveryTarget:phase==='baseline'?BASELINE:APPLICATION,bookingRecoveryOperationId:lease.window.id,bookingRecoveryAt:new Date().toISOString()},null,2);
      replace(stateFile,text,failed,lease.window.id+'-recovery');
    },
    persistProcesses:()=>{
      verify();const raw=JSON.parse(pm(['jlist'])),current=raw.map(normalizeRetirementProcess).sort((a,b)=>a.pmId-b.pmId);
      write(ROOT+'/pm2-dump-before-recovery.json',read('/root/.pm2/dump.pm2',false));write(ROOT+'/pm2-save-recovery-attempt.json',retentionCanonicalText({processes:current,at:new Date().toISOString()}));
      pm(['save']);assertOnlineRetentionPersistedProcesses(JSON.parse(pm(['jlist'])),JSON.parse(read('/root/.pm2/dump.pm2',false)),{processes:current});
    },
    complete:receipt=>{verify();write(ROOT+'/watchdog-recovery.json',retentionCanonicalText(receipt));},
  };
}

async function productionRecovery(){
  need(process.platform==='linux'&&process.getuid?.()===0&&process.argv.length===2,'invocation');
  const lease=JSON.parse(read(ROOT+'/watchdog-lease.json'));assertBookingWatchdogInheritedLease(lease,{requireParentGone:true});
  const expected='/var/lib/faolla-online-code/'+lease.toolRevision+'/scripts/booking-handoff-recovery.mjs';need(fileURLToPath(import.meta.url)===expected,'source_path');
  const armed=JSON.parse(read(ROOT+'/watchdog-armed.json')),self=fact(process.pid),supervisor=fact(armed.process.pid);
  need(self.parentPid===armed.process.pid,'supervisor_parent');equal(Object.fromEntries(Object.keys(armed.process).map(k=>[k,supervisor[k]])),armed.process,'supervisor_changed');
  await executeBookingFailureRecovery(productionOperations(lease),lease);
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){productionRecovery().catch(()=>{console.error('booking_recovery_unconfirmed');process.exitCode=1;});}
