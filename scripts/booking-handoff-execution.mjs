// Actual preflight, narrow gate/drain and the single repair+activation executor.
// No stage/build, generic deployment, mail setup or automatic mutation retry.
import * as fs from 'node:fs';
import {drainAndProbeIngress} from './release-toolchain-ingress.mjs';
import {reviewedBookingExecution} from './release-toolchain-authority.mjs';
import {requireBookingAdmission} from './release-toolchain-admission-context.mjs';
import {spawnSync} from 'node:child_process';
import {BOOKING_HANDOFF_CANDIDATE as CANDIDATE,BOOKING_HANDOFF_APPLICATION as APPLICATION,BOOKING_HANDOFF_BASELINE as BASELINE,
 assertBookingHandoffWindow,assertBookingAtomicActivationTransition} from './booking-handoff-policy.mjs';
import {BOOKING_HANDOFF_ROOT as ROOT,verifyBookingAtomicRuntimeCohort} from './booking-handoff-runtime.mjs';
import {collectBookingLegacyHost} from './booking-handoff-legacy.mjs';
import {BOOKING_INGRESS_VHOST,BOOKING_INGRESS_MAIN_SHA256,bookingIngressRestorationText} from './booking-handoff-ingress.mjs';
import {assertBookingRoutingCurrent} from './booking-handoff-routing.mjs';
import {bookingHandoffActivationSnapshotSql} from './booking-handoff-activation.mjs';
import {guardedProductionBookingRepairActivationSql,planBookingRuleOptionRepair} from './booking-handoff-rule-repair.mjs';
import {decryptBookingRuleOriginals,validateBookingOriginalBackupDataset} from './booking-handoff-rule-backup.mjs';
import {assertOnlineRetentionHeldLocks} from './online-release-retention-writer.mjs';
import {readOnlineRetentionHistory} from './online-release-retention.mjs';
import {retentionCanonicalText,retentionHash} from './online-release-retention-policy.mjs';
import {parseRetirementSockets} from './online-release-retirement.mjs';
import {WEB_RELEASE_FILES,WEB_RELEASE_PROXY} from './web-presentation-release-policy.mjs';
import {bookingPublicationBackupRequest,validateBookingPublicationBackupEvidence as validateAttendanceBackupEvidence} from './booking-ready-backup.mjs';
import {acquireProductionMigrationLock} from './apply-production-database-migrations.mjs';
import {runOnlineToolGit} from './prepare-online-release-tool.mjs';
import {assertBookingHostInvocation,bookingHostRead as read,bookingHostRun as run,bookingHostSql as sql,bookingHostWriteOnce as write,
 bookingHostReplace as replace,bookingHostHash as hash,bookingHostEqual as equal,bookingHostNeed as need,BOOKING_HOST_RELEASE as RELEASE} from './booking-handoff-host-io.mjs';

const ORIGINAL='/var/lib/faolla-booking-rule-repair-iGmntL',ORIGINAL_SEAL='5b33a8d867eff2c0ed620fb7e3e288ca86baadd7c9d821e668f156850d916095';
const OWNER='__faolla_booking_persistence__',NGINX='/www/server/nginx/sbin/nginx';
const quote=v=>"'"+v.replaceAll("'","''")+"'";
const protectedSlugs=['records','rules','workbench'].flatMap(k=>['__merchant_booking_'+k+'__:v1','__merchant_booking_'+k+'__:v1:backup']);
export const BOOKING_HANDOFF_DATASET_SQL=`begin isolation level repeatable read read only;set local statement_timeout='8s';set local lock_timeout='2s';
select jsonb_build_object('bookingRows',(select jsonb_agg(to_jsonb(p) order by slug,id) from public.pages p where slug in (${protectedSlugs.map(quote).join(',')})),
 'publishedRows',(select jsonb_agg(jsonb_build_object('row',to_jsonb(p),'rowSha256',encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex')) order by merchant_id,id)
  from public.pages p where merchant_id in (select jsonb_object_keys(blocks->'snapshots') from public.pages where merchant_id='${OWNER}' and slug='__merchant_booking_rules__:v1') and (slug is null or left(slug,2)<>'__')),
 'rulesRowSha256',(select encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') from public.pages p where merchant_id='${OWNER}' and slug='__merchant_booking_rules__:v1'),
 'registry',(select jsonb_agg(jsonb_build_object('version',version::text,'name',name) order by version) from public.faolla_schema_migrations));rollback;`;
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const contentHash=v=>hash(JSON.stringify(canonical(v)));

export function assertBookingOriginalsMatchLive(original,live){
 validateBookingOriginalBackupDataset(original);equal(live.bookingRows,original.bookingRows,'original_booking_rows_changed');
 equal(live.publishedRows.map(p=>p.row),original.publishedRows,'original_published_rows_changed');
 equal(live.registry.slice(0,209),original.registry,'original_registry_changed');
 equal(live.registry.slice(209),[{version:'202610250211',name:'booking_atomic_preparation'},{version:'202610250212',name:'booking_atomic_runtime'}],'inactive_registry');
 return true;
}
function originals(){
 const seal=read(ORIGINAL+'/verified.json');need(hash(seal)===ORIGINAL_SEAL,'original_backup_seal');const report=JSON.parse(seal);
 const archive=read(ORIGINAL+'/originals.enc',{binary:true}),key=read(ORIGINAL+'/originals.key',{binary:true});
 need(hash(archive)===report.archiveSha256&&archive.length===report.archiveBytes,'original_backup_archive');
 const raw=decryptBookingRuleOriginals(archive,key);need(hash(raw)===report.originalSha256,'original_backup_decryption');
 const dataset=JSON.parse(raw);validateBookingOriginalBackupDataset(dataset);return dataset;
}
// Only the two independently pinned pure application helpers are loaded. No
// server module, instrumentation, .env loader, API credential or network access.
export const BOOKING_HANDOFF_PURE_PROBE=String.raw`
import{readFileSync}from'node:fs';import{createRequire}from'node:module';
globalThis.fetch=()=>{throw Error('pure_probe_network_forbidden');};
const input=JSON.parse(readFileSync(0,'utf8')),root=process.cwd(),{require:load}=createRequire(root+'/package.json')('tsx/cjs/api');
const rules=load(root+'/src/lib/merchantBookingRules.ts',root+'/package.json'),wb=load(root+'/src/lib/merchantBookingWorkbench.ts',root+'/package.json');
const snapshots=input.publishedRows.map(p=>rules.buildMerchantBookingRulesSnapshot(p.row.merchant_id,p.row.blocks,input.publishedAt[p.row.merchant_id]));
let eligible=0;const begin=Date.parse(input.observedAt),end=Date.parse(input.throughAt);
for(const r of input.records){const settings=wb.normalizeMerchantBookingWorkbenchSettings(input.settings[r.siteId]);let due=false;
 for(let at=begin;at<=end&&!due;at=Math.min(at+1000,end)){const now=new Date(at);
  due=!!(wb.getMerchantBookingAutoStatusAtAppointmentTime(r,settings,now)||wb.shouldMarkMerchantBookingNoShow(r,settings,now)||
   wb.getMerchantBookingDueReminderOffset(r,settings.merchantReminderOffsetsMinutes,now)||wb.getMerchantBookingDueReminderOffset(r,settings.customerReminderOffsetsMinutes,now));
  if(at===end)break;}
 if(due)eligible++;
}console.log(JSON.stringify({snapshots,automationEligibleRecords:eligible,observedAt:input.observedAt,throughAt:input.throughAt}));`;

function liveDatasetAndPure(throughAt){
 const live=JSON.parse(sql(BOOKING_HANDOFF_DATASET_SQL));assertBookingOriginalsMatchLive(originals(),live);
 const row=k=>live.bookingRows.find(p=>p.slug==='__merchant_booking_'+k+'__:v1'),rules=row('rules'),records=row('records').blocks,workbench=row('workbench').blocks;
 const legacy=collectBookingLegacyHost();
 for(const [name,file]of [['records','merchant-bookings.json'],['rules','merchant-booking-rules.json'],['workbench','merchant-booking-workbench.json']])
  equal(JSON.parse(read(legacy.legacy.cwd+'/.runtime/'+file,{privateMode:false})),row(name).blocks,'legacy_cache_changed');
 const directory='/www/wwwroot/merchant-space.web-releases/'+CANDIDATE.slice(0,12)+'-online',observedAt=new Date().toISOString();
 const source=()=>{need(runOnlineToolGit(directory,['rev-parse','HEAD']).toString().trim()===CANDIDATE&&
  !runOnlineToolGit(directory,['status','--porcelain=v1','--untracked-files=all']).toString().trim(),'pure_probe_source');};source();
 const input={publishedRows:live.publishedRows,publishedAt:Object.fromEntries(Object.entries(rules.blocks.snapshots).map(([id,s])=>[id,s.publishedAt])),
  records:records.records,settings:workbench.settingsBySiteId,observedAt,throughAt};
 const result=spawnSync('/usr/bin/node',['--input-type=module','-e',BOOKING_HANDOFF_PURE_PROBE],{cwd:directory,input:JSON.stringify(input),encoding:'utf8',timeout:15000,maxBuffer:8*1024**2,
  env:{PATH:'/usr/bin:/bin',HOME:'/root',NODE_ENV:'test',TSX_TSCONFIG_PATH:directory+'/tsconfig.json'}});
 source();need(result.status===0&&!result.error&&!result.signal&&result.stderr==='','pure_probe_unconfirmed');const pure=JSON.parse(result.stdout.trim());
 need(pure.automationEligibleRecords===0&&pure.observedAt===observedAt&&pure.throughAt===throughAt,'legacy_automation_eligible');
 const plan=planBookingRuleOptionRepair({rulesRow:{...rules,rowSha256:live.rulesRowSha256},publishedRows:live.publishedRows.map(p=>({...p.row,rowSha256:p.rowSha256})),
  buildSnapshot:(id,blocks,publishedAt)=>{const source=live.publishedRows.find(p=>p.row.merchant_id===id);equal(blocks,source.row.blocks,'probe_blocks');
   const found=pure.snapshots.filter(s=>s.siteId===id);need(found.length===1&&found[0].publishedAt===publishedAt,'probe_snapshot');return found[0];}});
 return {live,pure,plan,legacy};
}
function networkProof(){
 const raw=JSON.parse(run('nft',['-j','list','ruleset']));
 const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,k==='counter'&&v[k]&&typeof v[k]==='object'?
  Object.fromEntries(Object.keys(v[k]).filter(n=>!['packets','bytes'].includes(n)).map(n=>[n,v[k][n]])):stable(v[k])])):v;
 const digest=hash(JSON.stringify(stable(raw)));need(digest==='3d9704bd1d9d2144ec9468252d53e4e56f2104d4f196daa8a5999d20484ab384','network_policy_changed');return digest;
}
function nginxWorkers(){
 const rows=[];for(const name of fs.readdirSync('/proc').filter(n=>/^[1-9][0-9]*$/.test(n))){try{
  const cmd=fs.readFileSync('/proc/'+name+'/cmdline','utf8').replace(/\0+$/,'');if(!/^nginx: worker process(?: is shutting down)?$/.test(cmd))continue;
  need(fs.realpathSync('/proc/'+name+'/exe')===NGINX,'foreign_nginx_worker');const text=fs.readFileSync('/proc/'+name+'/stat','utf8');rows.push({pid:Number(name),startTicks:text.slice(text.lastIndexOf(')')+2).split(/\s+/)[19]});
 }catch(e){if(!['ENOENT','ESRCH'].includes(e.code))throw e;}}need(rows.length>0,'nginx_workers_missing');return rows;
}
const sameWorker=p=>{try{const text=fs.readFileSync('/proc/'+p.pid+'/stat','utf8');return text.slice(text.lastIndexOf(')')+2).split(/\s+/)[19]===p.startTicks;}catch(e){if(['ENOENT','ESRCH'].includes(e.code))return false;throw e;}};
const currentRouting=()=>Object.fromEntries(WEB_RELEASE_FILES.map(f=>[f,read(WEB_RELEASE_PROXY+'/'+f,{privateMode:false})]));
const now=()=>new Date().toISOString();

export async function inspectBookingHandoffPreflight(options){
 const {lock,toolRevision}=options;const invocation=assertBookingHostInvocation(options),cohort=verifyBookingAtomicRuntimeCohort(options);
 if(reviewedBookingExecution(toolRevision))requireBookingAdmission(toolRevision);
 const originalStageText=read(ROOT+'/primary-original-stage.json'),stage=JSON.parse(originalStageText),history=readOnlineRetentionHistory();
 need(stage.status==='database-ready'&&stage.target===CANDIDATE&&stage.retentionHeadSha256===history.headSha256&&history.entries.at(-1)?.active.target===BASELINE,'stage_predecessor');
 const inactiveText=read(RELEASE+'/'+CANDIDATE+'/booking-database-inactive.json'),inactive=JSON.parse(inactiveText),compatibilityText=read(RELEASE+'/'+CANDIDATE+'/booking-compatibility.json');
 need(hash(inactiveText)===stage.bookingDatabaseProofSha256&&inactive.status==='installed-inactive'&&inactive.atomicActive===false&&
  inactive.compatibilitySha256===hash(compatibilityText),'inactive_evidence');
 const backup=await validateAttendanceBackupEvidence(bookingPublicationBackupRequest(CANDIDATE,RELEASE+'/'+CANDIDATE));
 need(backup.archiveSha256===inactive.backupSha256,'full_backup_changed');
 const data=liveDatasetAndPure(new Date(Date.now()+600000).toISOString()),before=JSON.parse(sql(bookingHandoffActivationSnapshotSql));
 if(reviewedBookingExecution(toolRevision))equal(before,requireBookingAdmission(toolRevision).databaseBefore,'fresh_admission_database_changed');
 assertBookingAtomicActivationTransition(before,{...before,active:true});need(data.legacy.legacy.pid===1590381&&data.legacy.legacy.backgroundPaused==='0','original_timer');
 equal(data.legacy.legacy,history.entries.at(-1).processes.find(p=>p.name==='merchant-space'),'original_timer_history');
 const readiness={schemaVersion:1,kind:'booking-atomic-rollback-ready',candidate:CANDIDATE,target:APPLICATION,stateText:read(RELEASE+'/'+APPLICATION+'/state.json'),
  buildEvidenceSha256:hash(read(RELEASE+'/'+APPLICATION+'/attendance-build-proof.json')),runtimeSha256:hash(read(RELEASE+'/'+APPLICATION+'/atomic-runtime.json')),
  environmentFileSha256:hash(read(cohort.rollback.directory+'/.env.local')),compatibilitySha256:hash(compatibilityText)};
 const preflight={schemaVersion:1,kind:'booking-handoff-preflight',toolRevision,toolClosureSha256:invocation.toolClosureSha256,databaseBefore:before,
  legacyBefore:data.legacy.legacy,legacyRawSha256:hash(retentionCanonicalText(data.legacy.raw)),legacyConfiguredSha256:hash(retentionCanonicalText(data.legacy.configured)),
  activeFileText:read(RELEASE+'/active.json'),priorRetentionHeadSha256:history.headSha256,priorStageSha256:hash(originalStageText),compatibilitySha256:hash(compatibilityText),
  backupSha256:backup.archiveSha256,originalBackupSealSha256:ORIGINAL_SEAL,ruleRepairPlanSha256:data.plan.planSha256,networkPolicySha256:networkProof(),
  savedDatasetSha256:contentHash(data.live),automationEligibleRecords:data.pure.automationEligibleRecords,automationCheckedThrough:data.pure.throughAt,completedAt:now()};
 need(JSON.parse(preflight.activeFileText).target===BASELINE,'active_predecessor');assertOnlineRetentionHeldLocks(lock);
 return {preflight,repairPlan:data.plan,readiness};
}
export async function prepareBookingHandoffPreflight(options){
 const {preflight,repairPlan,readiness}=await inspectBookingHandoffPreflight(options);assertOnlineRetentionHeldLocks(options.lock);
 write(ROOT+'/rule-repair-plan.json',retentionCanonicalText(repairPlan));write(ROOT+'/rollback-readiness.json',retentionCanonicalText(readiness));write(ROOT+'/preflight.json',retentionCanonicalText(preflight));return preflight;
}

export async function executeBookingIngressDrain(operations,plan){
 const {window}=plan;assertBookingHandoffWindow(window,{nowMs:operations.nowMs()});
 // A successful reload and one 503 can coexist with an old worker returning
 // 200 on an already accepted connection. Drain the captured generation FIRST;
 // then prove every protected route. Neither condition alone permits activation.
 await drainAndProbeIngress(operations,{startedAtMs:Date.parse(window.startedAt),deadlineAtMs:Date.parse(window.startedAt)+90000,window});
 const data=await operations.automation();need(data.automationEligibleRecords===0&&Date.parse(data.throughAt)>=Date.parse(window.deadlineAt),'automation_drain');
 const receipt={schemaVersion:1,kind:'booking-legacy-ingress-drained',window,oldWorkersRemaining:0,applicationConnections:0,
  automationEligibleRecords:data.automationEligibleRecords,automationCheckedThrough:data.throughAt,datasetSha256:data.datasetSha256,completedAt:operations.now()};
 await operations.complete(receipt);return receipt;
}
export async function installAndDrainBookingIngress(options){
 assertBookingHostInvocation(options);const gateText=read(ROOT+'/ingress-plan.json'),gate=JSON.parse(gateText),routing=JSON.parse(read(ROOT+'/routing-plan.json'));
 bookingIngressRestorationText(gate,gate.afterText);equal(gate.window,routing.window,'gate_window');const preflight=JSON.parse(read(ROOT+'/preflight.json'));
 const authorize=()=>{assertOnlineRetentionHeldLocks(options.lock);assertBookingHandoffWindow(gate.window,{nowMs:Date.now()});
  equal(read(ROOT+'/ingress-plan.json'),gateText,'gate_plan_changed');need(hash(read('/www/server/nginx/conf/nginx.conf',{privateMode:false}))===BOOKING_INGRESS_MAIN_SHA256,'nginx_main_changed');
  const armed=JSON.parse(read(ROOT+'/watchdog-armed.json')),lease=JSON.parse(read(ROOT+'/watchdog-lease.json'));
  need(armed.leaseSha256===retentionHash(lease)&&lease.window.id===gate.window.id,'watchdog_not_armed');
  const root='/proc/'+armed.process.pid,stat=fs.readFileSync(root+'/stat','utf8'),fields=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/),
   actual={pid:armed.process.pid,uid:fs.lstatSync(root).uid,startTicks:fields[19],executable:fs.realpathSync(root+'/exe'),cwd:fs.realpathSync(root+'/cwd'),commandSha256:hash(fs.readFileSync(root+'/cmdline'))};
  equal(actual,armed.process,'watchdog_process_changed');need(fs.readlinkSync(root+'/fd/3')===lease.deploy.file,'watchdog_not_alive');
  const fd=fs.statSync(root+'/fd/3');equal(Object.fromEntries(['dev','ino','uid','mode','nlink'].map(k=>[k,fd[k]])),lease.deploy.identity,'watchdog_lock_changed');};
 return executeBookingIngressDrain({now,nowMs:()=>Date.now(),authorize,workers:nginxWorkers,
  begin:attempt=>{authorize();equal(read(BOOKING_INGRESS_VHOST,{privateMode:false}),gate.beforeText,'gate_before');assertBookingRoutingCurrent(routing,currentRouting());
   equal(currentRouting(),routing.before,'routing_before');networkProof();write(ROOT+'/ingress-install-attempt.json',retentionCanonicalText(attempt));},
  install:()=>{authorize();replace(BOOKING_INGRESS_VHOST,gate.beforeText,gate.afterText,gate.window.id+'-gate');},syntax:()=>run(NGINX,['-t']),reload:()=>run(NGINX,['-s','reload']),
  probeGate:async()=>{for(const origin of ['https://faolla.com','https://launch.faolla.com'])for(const [method,uri]of [['GET','/api/bookings'],['POST','/api/publish'],['POST','/api/personal-guest-merge']]){
   const response=await fetch(origin+uri+'?bookingHandoff='+gate.window.id,{method,redirect:'manual',headers:{Connection:'close'},signal:AbortSignal.timeout(2000)}),value=await response.json();
   need(response.status===503&&value.error==='booking_temporarily_paused'&&value.operation===gate.window.id,'gate_public_probe');}},
  drain:workers=>{authorize();const sockets=parseRetirementSockets(run('ss',['-ltnpH']),run('ss',['-tnpH']));
   return {oldWorkersRemaining:workers.filter(sameWorker).length,applicationConnections:sockets.established.filter(s=>s.localPort===3000||s.localPort>=3101&&s.localPort<=3110).length};},
  wait:ms=>new Promise(r=>setTimeout(r,ms)),automation:()=>{authorize();const data=liveDatasetAndPure(gate.window.deadlineAt);
   need(contentHash(data.live)===preflight.savedDatasetSha256&&data.plan.planSha256===preflight.ruleRepairPlanSha256,'drain_dataset_changed');
   equal(JSON.parse(sql(bookingHandoffActivationSnapshotSql)),preflight.databaseBefore,'drain_database_changed');return {...data.pure,datasetSha256:contentHash(data.live)};},
  complete:receipt=>{authorize();write(ROOT+'/legacy-drain.json',retentionCanonicalText(receipt));},
 },gate);
}

export async function executeBookingRepairActivation(operations){
 await operations.authorize();const before=await operations.snapshot(),admission=await operations.admission(before);
 await operations.begin({before,...admission,startedAt:operations.now()});await operations.authorize();equal(await operations.snapshot(),before,'activation_before_changed');
 // A lost acknowledgement must terminate this attempt, never resend SQL.
 const output=await operations.commit();need(typeof output==='string','activation_output');const lines=output.trim().split(/\r?\n/);need(lines.length===2,'activation_receipts');
 const activation=JSON.parse(lines[0]),repair=JSON.parse(lines[1]);assertBookingAtomicActivationTransition(activation.before,activation.after);
 equal({...activation.before,savedBookingRowsSha256:before.savedBookingRowsSha256},before,'activation_identity_changed');
 need(repair.beforeSavedRowsSha256===before.savedBookingRowsSha256&&repair.afterSavedRowsSha256===activation.before.savedBookingRowsSha256&&
  repair.schemaVersion===1&&repair.kind==='booking-rule-missing-options'&&repair.planSha256===admission.planSha256&&repair.backupSealSha256===admission.backupSealSha256,'activation_repair_binding');
 equal(await operations.snapshot(),activation.after,'activation_fresh_read');await operations.complete({activation,repair});return {activation,repair};
}
export async function activateRepairedBookingAuthority(options){
 assertBookingHostInvocation(options);const migration=await acquireProductionMigrationLock();
 try{
  const gate=JSON.parse(read(ROOT+'/ingress-plan.json')),routing=JSON.parse(read(ROOT+'/routing-plan.json')),preflight=JSON.parse(read(ROOT+'/preflight.json')),
   drain=JSON.parse(read(ROOT+'/legacy-drain.json')),plan=JSON.parse(read(ROOT+'/rule-repair-plan.json'));
  const authorize=()=>{assertOnlineRetentionHeldLocks(options.lock);const bounds=assertBookingHandoffWindow(gate.window,{nowMs:Date.now()});need(bounds.deadlineAtMs-Date.now()>=120000,'activation_recovery_reserve');
   bookingIngressRestorationText(gate,read(BOOKING_INGRESS_VHOST,{privateMode:false}));equal(gate.window,routing.window,'activation_window');
   assertBookingRoutingCurrent(routing,currentRouting(),{phase:'armed'});verifyBookingAtomicRuntimeCohort(options);};
  const before=JSON.parse(sql(bookingHandoffActivationSnapshotSql));equal(before,preflight.databaseBefore,'activation_preflight');
  const statement=guardedProductionBookingRepairActivationSql({before,plan,backupSealSha256:ORIGINAL_SEAL});
  return await executeBookingRepairActivation({now,authorize,snapshot:()=>JSON.parse(sql(bookingHandoffActivationSnapshotSql)),
   admission:async observed=>{equal(observed,before,'activation_observation');equal(drain.window,gate.window,'activation_drain_window');
    need(drain.automationEligibleRecords===0&&drain.datasetSha256===preflight.savedDatasetSha256&&Date.now()-Date.parse(drain.completedAt)<30000,'activation_drain_stale');
    const data=liveDatasetAndPure(gate.window.deadlineAt);need(contentHash(data.live)===preflight.savedDatasetSha256,'activation_dataset_changed');equal(data.plan,plan,'activation_plan_changed');
    const backup=await validateAttendanceBackupEvidence(bookingPublicationBackupRequest(CANDIDATE,RELEASE+'/'+CANDIDATE));
    need(backup.archiveSha256===preflight.backupSha256,'activation_full_backup_changed');return {window:gate.window,planSha256:plan.planSha256,backupSealSha256:ORIGINAL_SEAL,sqlSha256:hash(statement)};},
   begin:attempt=>{authorize();write(ROOT+'/activation-attempt.json',retentionCanonicalText(attempt));},
   commit:()=>{authorize();return sql(statement,{timeout:30000});},complete:({activation,repair})=>{assertOnlineRetentionHeldLocks(options.lock);
    write(ROOT+'/activation.json',retentionCanonicalText(activation));write(ROOT+'/rule-repair.json',retentionCanonicalText(repair));},
  });
 }finally{await migration.release();}
}

export async function closeBookingIngress(options){
 assertBookingHostInvocation(options);const gate=JSON.parse(read(ROOT+'/ingress-plan.json'));assertBookingHandoffWindow(gate.window,{nowMs:Date.now()});
 const original=bookingIngressRestorationText(gate,read(BOOKING_INGRESS_VHOST,{privateMode:false}));
 write(ROOT+'/ingress-close-attempt.json',retentionCanonicalText({window:gate.window,at:now()}));assertOnlineRetentionHeldLocks(options.lock);
 replace(BOOKING_INGRESS_VHOST,gate.afterText,original,gate.window.id+'-close');run(NGINX,['-t']);run(NGINX,['-s','reload']);
 equal(read(BOOKING_INGRESS_VHOST,{privateMode:false}),gate.beforeText,'ingress_close_readback');
 const receipt={schemaVersion:1,kind:'booking-only-ingress-completed',window:gate.window,closed:true,beforeSha256:gate.beforeSha256,completedAt:now()};
 assertBookingHandoffWindow(gate.window,{nowMs:Date.parse(receipt.completedAt)});write(ROOT+'/ingress-receipt.json',retentionCanonicalText(receipt));return receipt;
}
