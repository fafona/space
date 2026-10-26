import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as p from './booking-handoff-policy.mjs';
const clone=structuredClone,h=c=>c.repeat(64),uuid='10000000-0000-4000-8000-000000000001';
const window={id:uuid,startedAt:'2026-10-26T10:00:00.000Z',deadlineAt:'2026-10-26T10:10:00.000Z'};
function legacy(){return {name:'merchant-space',pid:1590381,pmId:0,port:3000,cwd:p.BOOKING_HANDOFF_LEGACY_DIRECTORY,
 executable:p.BOOKING_HANDOFF_LEGACY_DIRECTORY+'/node_modules/next/dist/bin/next',status:'online',backgroundPaused:'0',
 watch:false,cronRestart:null,shutdownWithMessage:false,restartCount:4,environmentSha256:h('a'),args:['start','-p','3000'],
 automationEnabled:null,invitationEnabled:null,createdAt:123,killTimeout:1600,interpreter:'/usr/bin/node',execMode:'fork_mode',nodeArgs:[]};}
function changed(){return {...legacy(),pid:999999,backgroundPaused:'1',restartCount:5,createdAt:Date.parse('2026-10-26T10:00:00.500Z'),environmentSha256:h('b')};}
function anchor(target,port,pid){const name='merchant-space-online-'+target.slice(0,12),directory='/www/wwwroot/merchant-space.web-releases/'+target.slice(0,12)+'-online';
 return {target,name,directory,port,process:{name,cwd:directory,port,pid,pmId:pid,status:'online',backgroundPaused:'1',automationEnabled:'0',invitationEnabled:'0'}};}
function cohort(){const active=anchor(p.BOOKING_HANDOFF_CANDIDATE,3104,101),rollback=anchor(p.BOOKING_HANDOFF_APPLICATION,3105,102);return {active,rollback,runtimeByName:Object.fromEntries([active,rollback].map(a=>[a.name,{MERCHANT_BOOKING_STORAGE_MODE:'atomic-v2',MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED:'0',FAOLLA_BACKGROUND_JOBS_PAUSED:'1',MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED:'0',MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED:'0',FAOLLA_WEB_BUILD_ID:a.target,NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID:a.target,PORT:String(a.port),PWD:a.directory}]))};}
test('handoff tools cannot modify approved application, old lanes, dependencies or arbitrary scripts',()=>{
 const files=[...p.BOOKING_HANDOFF_TOOL_FILES],input={baseline:p.BOOKING_HANDOFF_CANDIDATE,files,readBlob:file=>readFileSync(new URL('../'+file,import.meta.url))};
 assert.match(p.assertBookingHandoffToolClosure(input),/^[a-f0-9]{64}$/);
 for(const extra of ['src/lib/merchantBookings.server.ts','package.json','package-lock.json','scripts/supabase-migrations/new.sql','scripts/online-traffic-release-policy.mjs'])assert.throws(()=>p.assertBookingHandoffToolClosure({...input,files:[...files,extra]}));
 for(const file of files)assert.throws(()=>p.assertBookingHandoffToolClosure({...input,files:files.filter(x=>x!==file)}));
 assert.throws(()=>p.assertBookingHandoffToolClosure({...input,baseline:'a'.repeat(40)}));
});
test('staging the original reviewed candidate requires exact newer current-main tool ownership and a complete tooling-only closure',()=>{
 const revision='f'.repeat(40),v={requestedAction:'stage-booking-reviewed-candidate',target:p.BOOKING_HANDOFF_CANDIDATE,baseline:p.BOOKING_HANDOFF_BASELINE,
  toolRevision:revision,currentMain:revision,toolHead:revision,toolDirectory:'/var/lib/faolla-online-code/'+revision,toolClean:true,ancestorVerified:true,toolClosureSha256:h('b')};
 assert.doesNotThrow(()=>p.assertBookingReviewedStageIdentity(v));
 for(const [key,value]of Object.entries({requestedAction:'stage',target:p.BOOKING_HANDOFF_BASELINE,baseline:'a'.repeat(40),toolRevision:p.BOOKING_HANDOFF_CANDIDATE,currentMain:'a'.repeat(40),toolHead:'b'.repeat(40),toolDirectory:'/tmp/forged',toolClean:false,ancestorVerified:false,toolClosureSha256:'bad'}))assert.throws(()=>p.assertBookingReviewedStageIdentity({...v,[key]:value}),undefined,key);
});

test('the replacement candidate is pinned to the separately approved two-file deadline fix, never arbitrary application content',()=>{
 assert.equal(p.BOOKING_HANDOFF_CANDIDATE,'f274ad615550c83717aa7af2ad32339608e6f8aa');
 assert.equal(p.BOOKING_HANDOFF_ORIGINAL_CANDIDATE,'5110bf673d69b117fd0d0d19c5d7d6a9121b704c');
 assert.equal(Object.keys(p.BOOKING_HANDOFF_ATTENDANCE_FIX_PINS).length,2);
 const files=[...Object.keys(p.BOOKING_HANDOFF_ATTENDANCE_FIX_PINS),...Array.from({length:70},(_,i)=>'synthetic-'+i)];
 const value={target:p.BOOKING_HANDOFF_CANDIDATE,baseline:p.BOOKING_HANDOFF_BASELINE,files,
  readBlob:file=>readFileSync(new URL('../'+file,import.meta.url))};
 for(const change of [{target:p.BOOKING_HANDOFF_ORIGINAL_CANDIDATE},{baseline:p.BOOKING_HANDOFF_CANDIDATE},
  {files:files.slice(1)},{files:[...files,files[0]]},{files:[...files.slice(0,-1),files[0]]}])
  assert.throws(()=>p.assertBookingHandoffCandidateClosure({...value,...change}),/candidate_scope/);
 for(const file of Object.keys(p.BOOKING_HANDOFF_ATTENDANCE_FIX_PINS))
  assert.throws(()=>p.assertBookingHandoffCandidateClosure({...value,readBlob:path=>path===file?'changed':value.readBlob(path)}),/candidate_attendance_fix/);
 assert.throws(()=>p.assertBookingHandoffCandidateClosure({...value,readBlob:file=>file.startsWith('synthetic-')?'unreviewed source':value.readBlob(file)}),/candidate_source/);
 // Successful digest comparison is a pure byte binding; the host adapter must
 // read every Git blob itself. No caller-provided success flag is accepted.
 const source=readFileSync(new URL('./booking-handoff-policy.mjs',import.meta.url),'utf8');
 assert.match(source,/digest===BOOKING_HANDOFF_CANDIDATE_CLOSURE_SHA256/);
 assert.equal(p.BOOKING_HANDOFF_ATTENDANCE_FIX_TESTS.includes('src/lib/merchantAttendanceDelegatedConfiguration.server.test.ts'),true);
});
test('ten minute window is explicit, canonical, exclusive at deadline and never extensible',()=>{
 assert.doesNotThrow(()=>p.assertBookingHandoffWindow(window,{nowMs:Date.parse(window.startedAt)}));
 for(const patch of [{id:'x'},{startedAt:'2026-10-26T10:00:00Z'},{deadlineAt:'2026-10-26T10:10:00.001Z'},{deadlineAt:window.startedAt},{unknown:true}])assert.throws(()=>p.assertBookingHandoffWindow({...window,...patch}));
 for(const nowMs of [NaN,Date.parse(window.startedAt)-1,Date.parse(window.deadlineAt),Date.parse(window.deadlineAt)+1])assert.throws(()=>p.assertBookingHandoffWindow(window,{nowMs}));
});
test('only the exact legacy booking host can restart once with only its global background gate changed',()=>{
 assert.doesNotThrow(()=>p.assertBookingLegacyTaskTransition(legacy(),changed()));
 for(const key of Object.keys(legacy()).filter(k=>!['pid','backgroundPaused','restartCount','environmentSha256','createdAt'].includes(k))){const after=changed();after[key]='foreign';assert.throws(()=>p.assertBookingLegacyTaskTransition(legacy(),after),undefined,key);}
 for(const patch of [{pid:1590381},{pid:0},{backgroundPaused:'0'},{restartCount:6},{environmentSha256:h('a')},{createdAt:123},{createdAt:0},{extra:'new'}])assert.throws(()=>p.assertBookingLegacyTaskTransition(legacy(),{...changed(),...patch}));
 for(const patch of [{name:'merchant-space-enterprise-automation-worker'},{cwd:'/foreign'},{pid:1590382},{port:3001},{backgroundPaused:'1'},{watch:true},{manualSignalHandle:'1'}])assert.throws(()=>p.assertBookingLegacyTaskTransition({...legacy(),...patch},changed()));
});
test('configured process environment comparison does not forgive credentials, business flags, mail configuration or key-set drift',()=>{
 const before={KEEP:'private-synthetic',FAOLLA_BACKGROUND_JOBS_PAUSED:'0',MERCHANT_ENTERPRISE_ATTENDANCE_ENABLED:'1'},after={...before,FAOLLA_BACKGROUND_JOBS_PAUSED:'1'};
 assert.doesNotThrow(()=>p.assertBookingLegacyEnvironmentTransition(before,after));
 for(const value of [undefined,'','false','yes','1'])assert.throws(()=>p.assertBookingLegacyEnvironmentTransition({...before,FAOLLA_BACKGROUND_JOBS_PAUSED:value},after));
 for(const patch of [{KEEP:'changed'},{RESEND_API_KEY:'not-allowed'},{BOOKING_CONFIRMATION_EMAIL_FROM:'x@example.invalid'},{MERCHANT_ENTERPRISE_ATTENDANCE_ENABLED:'0'},{EXTRA:'value'}])assert.throws(()=>p.assertBookingLegacyEnvironmentTransition(before,{...after,...patch}));
 const removed={...after};delete removed.KEEP;assert.throws(()=>p.assertBookingLegacyEnvironmentTransition(before,removed));
});

test('actual OS environment binds the pause, three counters and exact first-restart manager metadata observed in the isolated host rehearsal',()=>{
 const configured={KEEP:'synthetic-private',FAOLLA_BACKGROUND_JOBS_PAUSED:'0'},beforePmUptime=Date.parse('2026-10-26T09:00:00.000Z'),afterPmUptime=Date.parse('2026-10-26T10:00:01.000Z');
 const beforeRaw={...configured,created_at:String(legacy().createdAt),pm_uptime:String(beforePmUptime),restart_time:String(legacy().restartCount),unstable_restarts:'0',env:'[object Object]',axm_options:'[object Object]',status:'launching'};
 const afterRaw={...beforeRaw,created_at:String(changed().createdAt),FAOLLA_BACKGROUND_JOBS_PAUSED:'1',pm_uptime:String(afterPmUptime),restart_time:String(changed().restartCount),
  exit_code:'0',node_version:'20.20.1',version:'16.3.4',prev_restart_delay:'0'};
 const value={beforeRaw,afterRaw,beforeConfigured:configured,afterConfigured:{...configured,FAOLLA_BACKGROUND_JOBS_PAUSED:'1'},
  legacyBefore:legacy(),legacyAfter:changed(),beforePmUptime,afterPmUptime,
  beforePmDerived:{exitCode:null,nodeVersion:'20.20.1',version:'16.3.4',previousRestartDelay:null,unstableRestarts:0},
  afterPmDerived:{exitCode:0,nodeVersion:'20.20.1',version:'16.3.4',previousRestartDelay:0,unstableRestarts:0},framework:clone(p.BOOKING_HANDOFF_PM2_PROVENANCE),
  window,observedAt:'2026-10-26T10:00:02.000Z'};
 p.assertBookingLegacyRuntimeEnvironmentTransition(value);
 for(const mutate of [v=>{v.afterRaw.KEEP='changed';},v=>{v.afterRaw.env='changed';},v=>{v.afterRaw.axm_options='changed';},v=>{v.afterRaw.status='online';},
  v=>{v.afterRaw.restart_time='4';},v=>{v.afterRaw.pm_uptime=String(afterPmUptime+1);},v=>{v.afterRaw.EXTRA='new';},
  v=>{v.afterRaw.created_at='123';},v=>{v.afterRaw.exit_code='1';},v=>{v.beforeRaw.exit_code='0';},v=>{v.afterRaw.node_version='20.20.2';},
  v=>{v.afterRaw.version='0.1.0';},v=>{v.afterRaw.prev_restart_delay='1000';},v=>{v.afterRaw.unstable_restarts='1';},
  v=>{v.beforePmDerived.version='0.1.0';},v=>{v.afterPmDerived.exitCode=1;},v=>{v.afterPmDerived.unstableRestarts=1;},
  v=>{v.afterConfigured.version='16.3.4';},v=>{v.legacyAfter.createdAt=Date.parse(v.window.startedAt)-1;v.afterRaw.created_at=String(v.legacyAfter.createdAt);},
  v=>{v.afterConfigured.KEEP='changed';},v=>{v.framework.managerVersion='6.0.15';},v=>{v.framework.nodeVersion='v20.20.2';},
  v=>{v.framework.frameworkSources['lib/God.js']='0'.repeat(64);},v=>{v.framework.frameworkSources['lib/God/Methods.js']='0'.repeat(64);},v=>{v.afterPmUptime=beforePmUptime;v.afterRaw.pm_uptime=String(beforePmUptime);},
  v=>{v.afterPmUptime=Date.parse(v.window.deadlineAt);v.afterRaw.pm_uptime=String(v.afterPmUptime);},v=>{v.observedAt=v.window.deadlineAt;},
  v=>{v.afterRaw.RESEND_API_KEY='forbidden';},v=>{v.legacyAfter.restartCount++;},v=>{v.allowUnsafe=true;}]){
  const v=clone(value);mutate(v);assert.throws(()=>p.assertBookingLegacyRuntimeEnvironmentTransition(v));
 }
});
test('every independent enterprise, outbox, attendance, existing web and rollback process remains byte-for-byte identical',()=>{
 const c=cohort(),other={name:'merchant-space-enterprise-automation-worker',pid:1590531,status:'online',args:['unchanged'],environmentSha256:h('c')};
 const worker={name:'merchant-space-booking-atomic-'+p.BOOKING_HANDOFF_CANDIDATE.slice(0,12),pid:103,status:'online'};
 const added=[c.active.process,c.rollback.process,worker],before=[legacy(),other],after=[changed(),other,...added];
 const input={before:clone(before),after:clone(after),legacyBefore:legacy(),legacyAfter:changed(),added:clone(added)};assert.doesNotThrow(()=>p.assertBookingHandoffProcessSet(input));
 for(const mutate of [v=>{v.after[1].pid++;},v=>{v.after[1].args.push('changed');},v=>{v.after[1].status='stopped';},v=>v.after.pop(),v=>v.after.push({name:'foreign',pid:104,status:'online'}),v=>{v.added[0].name='foreign';},v=>{v.after[3].pid=v.after[2].pid;}]){const v=clone(input);mutate(v);assert.throws(()=>p.assertBookingHandoffProcessSet(v));}
});
test('rollback must be a separately owned actual atomic-compatible process, not the old legacy website',()=>{
 assert.doesNotThrow(()=>p.assertBookingAtomicCohort(cohort()));
 for(const target of ['active','rollback'])for(const key of Object.keys(cohort().runtimeByName[cohort()[target].name])){
  const v=cohort();v.runtimeByName[v[target].name][key]='changed';assert.throws(()=>p.assertBookingAtomicCohort(v),undefined,target+'/'+key);
 }
 for(const mutate of [v=>{v.rollback.target=p.BOOKING_HANDOFF_BASELINE;},v=>{v.rollback.port=v.active.port;},v=>{v.rollback.process.pid=v.active.process.pid;},v=>{v.rollback.process.backgroundPaused='0';},v=>{v.runtimeByName[v.active.name].RESEND_API_KEY='forbidden';},v=>{v.runtimeByName[v.rollback.name].BOOKING_CONFIRMATION_EMAIL_FROM='forbidden';}]){const v=cohort();mutate(v);assert.throws(()=>p.assertBookingAtomicCohort(v));}
});
test('activation may change only inactive to active, never saved bookings, generation, revision, registry identity or queue contents',()=>{
 const before={systemIdentifier:'7612049595342295079',databaseOid:'5',serverVersionNum:'150008',generation:uuid,revision:'0',protocol:2,active:false,savedBookingRowsSha256:h('a'),commands:0,mailJobs:0},after={...before,active:true};
 assert.doesNotThrow(()=>p.assertBookingAtomicActivationTransition(before,after));
 for(const key of Object.keys(before).filter(k=>k!=='active')){const v={...after,[key]:'changed'};assert.throws(()=>p.assertBookingAtomicActivationTransition(before,v),undefined,key);}
 assert.throws(()=>p.assertBookingAtomicActivationTransition(after,after));assert.throws(()=>p.assertBookingAtomicActivationTransition(before,before));
});
test('receipt binds the original candidate, original history and all distinct recovery/readiness evidence hashes',()=>{
 const value={schemaVersion:1,kind:'booking-task-handoff',candidate:p.BOOKING_HANDOFF_CANDIDATE,baseline:p.BOOKING_HANDOFF_BASELINE,application:p.BOOKING_HANDOFF_APPLICATION,toolRevision:'a'.repeat(40),window,completedAt:'2026-10-26T10:01:00.000Z'};
 for(const key of ['priorRetentionHeadSha256','priorStageSha256','sourceClosureSha256','preflightSha256','compatibilitySha256','backupSha256','ingressGateSha256','legacyDrainSha256','rollbackReadinessSha256','activationSha256','recoveryPlanSha256','ruleRepairSha256'])value[key]=h('b');
 assert.doesNotThrow(()=>p.assertBookingHandoffEvidence(value));
 for(const key of Object.keys(value)){const v=clone(value);delete v[key];assert.throws(()=>p.assertBookingHandoffEvidence(v),undefined,key);}
 for(const patch of [{candidate:p.BOOKING_HANDOFF_BASELINE},{completedAt:window.deadlineAt},{extra:'ignored'},{backupSha256:'bad'},{toolRevision:'a'.repeat(40)+'\n'}])assert.throws(()=>p.assertBookingHandoffEvidence({...value,...patch}));
});
