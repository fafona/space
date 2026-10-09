//207 local-only full review/employee/period acceptance. Reuses the explicitly
//owned stopped synthetic PG15; no production, new cluster, full build or UI.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {runPlanPosthocNative} from './merchant-attendance-plan-posthoc-native.mjs';
import {prepareAttendanceEmployeeManagement} from './merchant-attendance-employee-management-fixture.mjs';
import {lifecycleJson as json,lifecycleRace} from './merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {verifyPosthocFullLeaveNative} from './fixtures/attendance-plan-posthoc-full-leave-native.mjs';
import {createPosthocRecoveryEventsGuard} from './fixtures/attendance-posthoc-recovery-events-native.mjs';
import {createPosthocAdministrativeEventsGuard} from './fixtures/attendance-posthoc-administrative-events-native.mjs';
import {createPosthocReminderEventsGuard} from './fixtures/attendance-posthoc-reminder-events-native.mjs';
const require=createRequire(import.meta.url),rpc='faolla_attendance_plan_exception_posthoc_review_v1';
const beforeEnterprise=['202610060160_merchant_attendance_missing_delegation.sql','202610060161_merchant_attendance_missing_delegation_permission.sql',
  '202610060162_merchant_attendance_application_delegation.sql','202610060163_merchant_attendance_application_delegation_permissions.sql'];
const afterEnterprise=['202610060164_merchant_attendance_account_suspensions.sql','202610060166_merchant_attendance_employment_lifecycle.sql',
  '202610030120_merchant_attendance_schedule_overview.sql','202610060167_merchant_attendance_schedule_delegation.sql',
  '202610060168_merchant_attendance_schedule_delegation_permissions.sql','202610060169_merchant_attendance_event_notifications.sql',
  '202610060170_merchant_attendance_plan_clearance.sql','202610060172_merchant_attendance_plan_posthoc_evaluation.sql',
  '202610060173_merchant_attendance_plan_posthoc_formal_source.sql'];
const reviewMigration='202610060174_merchant_attendance_plan_posthoc_reviews.sql';
//Keep the name explicit: installation must never infer arbitrary SQL from disk.
const periodMigration='202610060175_merchant_attendance_plan_posthoc_periods.sql';

export async function runPlanPosthocReviewNative(args,after=null,{onFullLeavePrepared=null}={}){
  assert(after===null||typeof after==='function','posthoc_review_extension_invalid');
  assert(onFullLeavePrepared===null||typeof onFullLeavePrepared==='function','posthoc_full_leave_extension_invalid');
  return runPlanPosthocNative(args,async ctx=>{
    const {d,h,native,scope,next,all,archive,oldArchive,period,pq,read:adoptionRead,save:adoptionSave,make:adoptionMake,selected}=ctx,{exec}=d;
    const install=name=>{const source=readFileSync(path.join(native.root,'scripts/supabase-migrations',name),'utf8');
      if(/create index concurrently/i.test(source)){exec('select 1;');return native.query(scope.sql(source));}return ctx.install(name);};
    let stage='prerequisites',reads=0,rejections=0;
    const env={FAOLLA_ATTENDANCE_PLAN_POSTHOC_REVIEW_ENABLED:'1',FAOLLA_ATTENDANCE_PLAN_POSTHOC_REVIEW_SITE_IDS:d.site,
      FAOLLA_ATTENDANCE_PLAN_CLEARANCE_ENABLED:'1',FAOLLA_ATTENDANCE_PLAN_CLEARANCE_SITE_IDS:d.site,
      FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_ENABLED:'1',FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_SITES:d.site};
    const prior=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
    try{
      for(const name of beforeEnterprise)install(name);
      await prepareAttendanceEmployeeManagement(native,scope);
      exec("insert into public.faolla_schema_migrations(version,name) values(202608020019,'merchant_enterprise_audit');");
      for(const name of afterEnterprise)install(name);
      const originalTables=['merchant_attendance_events','merchant_attendance_shift_schedule_relations','merchant_attendance_shift_plan_adoptions','merchant_attendance_plan_rule_operations','merchant_attendance_plan_rule_artifacts'];
      const originalFacts=d.fingerprint(originalTables),periodBefore=await period(pq());
      const originalRecoveryEvents=createPosthocRecoveryEventsGuard({d,h,originalTables,originalFacts});
      const administrativeEvents=createPosthocAdministrativeEventsGuard({d,h,originalTables,originalFacts});
      const reminderEvents=createPosthocReminderEventsGuard({d,h,originalTables,originalFacts,administrativeEvents});
      let recoveryEventsRegistered=false;
      const recoveryEvents=Object.freeze({
        register(){assert(!administrativeEvents.isArmed(),'posthoc_event_capabilities_cannot_mix');originalRecoveryEvents.register();recoveryEventsRegistered=true;},
        verify:originalRecoveryEvents.verify,
      });
      const posthocAdministrativeEvents=Object.freeze({
        arm(){assert(!recoveryEventsRegistered,'posthoc_event_capabilities_cannot_mix');administrativeEvents.arm();},
        seal:administrativeEvents.seal,
      });
      const posthocReminderEvents=Object.freeze({
        arm(){assert(!recoveryEventsRegistered,'posthoc_event_capabilities_cannot_mix');reminderEvents.arm();},
        seal:reminderEvents.seal,
      });
      const originalRows=after?Object.fromEntries(originalTables.map(table=>[table,JSON.parse(exec('select coalesce(jsonb_agg(to_jsonb(t)),\'[]\') from public.'+table+' t;'))])):null;
      const call=expression=>JSON.parse(exec('set local role service_role;select '+expression+';'));
      const q=(mode='detail',access='owner',op=null)=>({siteId:d.site,access,mode,workerId:h.workerId,slotId:h.slot.id,operationId:op,beforeAt:null,beforeId:null});
      const legacyQuery={...q(),workerId:d.worker,slotId:d.slots.main.id};
      const legacyBefore=call('public.faolla_attendance_plan_exception_clearance_v1('+json(legacyQuery)+','+quote(d.owner)+',null,false,false,false)');
      stage='installation';const tables=d.inventory().filter(t=>t!=='faolla_schema_migrations'),facts=d.fingerprint(tables);
      install(reviewMigration);install(periodMigration);assert.equal(d.fingerprint(tables),facts);
      const installed=all(),defs=d.definitions(),catalog=d.tableCatalog();install(reviewMigration);install(periodMigration);
      assert.equal(all(),installed);assert.equal(d.definitions(),defs);assert.equal(d.tableCatalog(),catalog);
      const expression=(query,command=null,{auth=query.access==='owner'?d.owner:h.employeeAuthUserId,allow=true,posthoc=true,clearance=true,capture=false}={})=>
        'public.'+rpc+'('+json(query)+','+quote(auth)+','+json(command)+','+allow+','+posthoc+','+clearance+','+capture+')';
      const raw=(query=q(),command=null,options={})=>call(expression(query,command,options));
      const {parsePlanExceptionResult}=require('../src/lib/merchantAttendancePlanExceptions.ts');
      const {executePlanExceptions}=require('../src/lib/merchantAttendancePlanExceptions.server.ts');
      const parse=(value,query,command=null)=>parsePlanExceptionResult(value,query,{authUserId:query.access==='owner'?d.owner:h.employeeAuthUserId},command);
      const read=(query=q(),options={})=>{const before=all(),value=parse(raw(query,null,options),query);assert.equal(all(),before);reads++;return value;};
      const make=(value,outcome='confirmed')=>({operationId:next(),expectedRevision:value.detail.revision,expectedFingerprint:value.detail.current.fingerprint,
        employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,outcome,note:'Synthetic207 explicit formal decision, not payroll'});
      const submit=(command,options={})=>{const query=q('decide','owner',command.operationId);return parse(raw(query,command,options),query,command);};
      const reject=(exp,pattern)=>{const before=all();assert.throws(()=>call(exp),new RegExp('ERROR:\\s+(?:'+pattern+')(?:\\s|$)'));assert.equal(all(),before);rejections++;};
      const acl=JSON.parse(exec("select jsonb_build_object('service',has_function_privilege('service_role','public."+rpc+"(jsonb,uuid,jsonb,boolean,boolean,boolean,boolean)','EXECUTE'),'anon',has_function_privilege('anon','public."+rpc+"(jsonb,uuid,jsonb,boolean,boolean,boolean,boolean)','EXECUTE'),'authenticated',has_function_privilege('authenticated','public."+rpc+"(jsonb,uuid,jsonb,boolean,boolean,boolean,boolean)','EXECUTE'));"));
      assert.deepEqual(acl,{service:true,anon:false,authenticated:false});
      const legacyAfter=raw(legacyQuery,null,{allow:false,posthoc:false,clearance:false});
      const scrub=value=>JSON.parse(JSON.stringify(value,(key,v)=>key==='readAt'&&v!==null?'read-time':v));
      assert.deepEqual(scrub(legacyAfter),scrub(legacyBefore));
      //Detached compact shapes cross-check both independent validators. These
      //inputs are not database authorization; the actual writer below still
      //collects and verifies its own immutable source inside the transaction.
      const {createPlanPosthocFormalCases}=require('./fixtures/attendance-plan-posthoc-formal-cases.ts');
      const {posthocReviewEvidence,posthocReviewSource}=require('./fixtures/attendance-plan-posthoc-review-model.ts');
      const compactCases=createPlanPosthocFormalCases().filter(x=>x.facts.source.posthoc.current!==null).map(x=>({name:x.group,evidence:posthocReviewEvidence({
        protocol:'plan-exception-source-v3',siteId:x.facts.siteId,actorId:x.facts.actorId,worker:x.facts.worker,slot:x.facts.slot,readAt:x.facts.readAt,
        source:{protocol:'plan-exception-evidence-v3',policy:'owner-confirmed-plan-edges-posthoc-v3',evaluation:x.facts.source},fingerprint:x.facts.fingerprint,...x.expectedDerived5})}));
      compactCases.push({name:'adopted',evidence:posthocReviewEvidence(posthocReviewSource({adopted:true}))});
      for(const mixed of ['session-first','missing-first'])compactCases.push({name:mixed,evidence:posthocReviewEvidence(posthocReviewSource({mixed}))});
      const compactMatrix=JSON.parse(exec('select jsonb_agg(jsonb_build_object(\'name\',v.value->\'name\',\'valid\',public.faolla_attendance_plan_exception_review_evidence_v1(v.value->\'evidence\')) order by v.n) from jsonb_array_elements('+json(compactCases)+') with ordinality v(value,n);'));
      assert(compactMatrix.every(x=>x.valid===true),JSON.stringify(compactMatrix.filter(x=>!x.valid)));
      const initial=read();assert.equal(initial.detail.current.protocol,'plan-exception-source-v3');assert(initial.detail.stale);assert(initial.detail.current.eligible,JSON.stringify(initial.detail.current.blockers));
      assert((await period(pq())).preview.blockers.includes('unresolved_review'));
      const command=make(initial),query=q('decide','owner',command.operationId);
      reject(expression(query,command,{posthoc:false}),'attendance_plan_exception_posthoc_disabled');
      for(const old of ['faolla_attendance_plan_exception_review_v1','faolla_attendance_plan_exception_review_event_v1','faolla_attendance_plan_exception_clearance_v1']){
        reject('public.'+old+'('+json(query)+','+quote(d.owner)+','+json(command)+',true'+(old.endsWith('clearance_v1')?',true,true':'')+')','attendance_plan_exception_posthoc_disabled');
      }
      reject(expression(query,command,{auth:h.employeeAuthUserId}),'attendance_access_denied');
      native.pass('207174/175 idempotent migrations; old no-ledger wire exact; old writers cannot bypass default-off v3 gate');

      stage='atomic-save-and-race';const beforeFailure=all(),beforeFailureDefs=d.definitions(),beforeFailureCatalog=d.tableCatalog();
      exec("create function public.attendance_posthoc_capture_fail_test() returns trigger language plpgsql as $$ begin raise exception 'synthetic_posthoc_capture_failure' using errcode='23514';end;$$;create trigger attendance_posthoc_capture_fail_test before insert on public.merchant_attendance_event_notifications for each row execute function public.attendance_posthoc_capture_fail_test();");
      try{assert.throws(()=>raw(query,command,{capture:true}),/synthetic_posthoc_capture_failure/);assert.equal(all(),beforeFailure);}
      finally{exec('drop trigger attendance_posthoc_capture_fail_test on public.merchant_attendance_event_notifications;drop function public.attendance_posthoc_capture_fail_test();');}
      assert.equal(d.definitions(),beforeFailureDefs);assert.equal(d.tableCatalog(),beforeFailureCatalog);
      const losing={...command,operationId:next()};
      const race=await lifecycleRace({connect:()=>native.connect(),query:s=>native.query(s),sql:scope.sql},'set local role service_role;select '+expression(query,command,{capture:true})+';',
        'set local role service_role;select '+expression(q('decide','owner',losing.operationId),losing,{capture:true})+';');
      assert(race.witnessed);assert.match(String(race.right.error),/attendance_version_conflict|attendance_plan_exception_revision_conflict/);
      const saved=read(q('recover','owner',command.operationId));assert.equal(saved.receipt.item.evidence.policy,'owner-confirmed-plan-edges-posthoc-v3');
      assert.equal(saved.receipt.item.evidence.evaluation.posthoc.current.operationId,initial.detail.current.source.evaluation.posthoc.current.operationId);
      const frozen=all();assert.deepEqual(submit(command,{allow:false,posthoc:false,clearance:false,capture:true}).receipt,saved.receipt);assert.equal(all(),frozen);
      const captured=JSON.parse(exec('select jsonb_agg(to_jsonb(n)) from public.merchant_attendance_event_notifications n where merchant_id='+quote(d.site)+' and operation_id='+quote(command.operationId)+';'));
      assert.equal(captured.length,1);assert.equal(exec('select count(*) from public.merchant_attendance_event_notifications where merchant_id='+quote(d.site)+' and operation_id='+quote(losing.operationId)+';'),'0');
      stage='service-and-self';const service={rpc:async(name,a)=>{assert.equal(name,rpc);try{return {data:raw(a.p_query,a.p_command,{auth:a.p_auth_user_id,allow:a.p_allow_write,posthoc:a.p_allow_posthoc,clearance:a.p_allow_clearance,capture:a.p_capture_notifications}),error:null};}catch(e){const code=String(e).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw e;return {data:null,error:{message:code}};}}};
      const self=await executePlanExceptions({query:q('detail','self'),authUserId:h.employeeAuthUserId,moduleEnabled:true},service);
      assert.equal(self.detail.current,null);assert.equal(self.detail.currentValidation,'not_checked');assert.deepEqual(self.detail.latestDecision.evidence,saved.receipt.item.evidence);
      const nq={siteId:d.site,expectedEmployeeId:h.employeeId,expectedWorkerId:h.workerId,notificationId:captured[0].notification_id,beforeAt:null,beforeId:null};
      const {parseEventNotificationsResult}=require('../src/lib/merchantAttendanceEventNotifications.ts');
      const notice=()=>parseEventNotificationsResult(call('public.faolla_attendance_event_notifications_v1('+json(nq)+','+quote(h.employeeAuthUserId)+',null,false)'),nq,h.employeeAuthUserId);
      assert.equal(notice().detail.type,'confirmed');assert.equal(notice().detail.readAt,null);
      const ack={operationId:next(),decisionOperationId:command.operationId};parse(raw(q('ack','self',ack.operationId),ack),q('ack','self',ack.operationId),ack);
      assert.equal(notice().detail.readAt,null,'business acknowledgement must not mark event message read');
      const note={operationId:next(),expectedRevision:self.detail.revision,decisionOperationId:command.operationId,note:'Synthetic207 employee requests another review'};
      parse(raw(q('note','self',note.operationId),note),q('note','self',note.operationId),note);
      assert((await period(pq())).preview.blockers.includes('unresolved_review'));
      native.pass('207 actual v3 decision+atomic capture, exact PID race, paused replay, self saved evidence and note/ack');

      stage='period-reconfirmation-and-seal';const second=make(read(),'excused');submit(second,{capture:true});
      const ready=await period(pq());assert.deepEqual(ready.preview.blockers,[]);assert.equal(ready.preview.artifact.source.sourceVersion,'attendance-period-source-v3');
      assert.deepEqual(ready.preview.artifact.report.totals,periodBefore.preview.artifact.report.totals);
      const periodIds=JSON.parse(exec('select jsonb_agg(period_id) from public.merchant_attendance_period_closures where merchant_id='+quote(d.site)+' and worker_id='+quote(h.workerId)+';'));assert.equal(periodIds.length,1);const periodId=periodIds[0];
      const pc=(action,value,fingerprint=value.artifact.sourceFingerprint)=>({action,operationId:next(),periodId,expectedRevision:value.period.revision,expectedVersion:value.period.currentVersion,expectedFingerprint:fingerprint,reason:'Synthetic207 explicit formal period lifecycle'});
      let closed=await period(pq('detail','owner',periodId));closed=await period(pq('detail','owner',periodId),pc('send',closed,ready.preview.artifact.sourceFingerprint));
      closed=await period(pq('detail','self',periodId),pc('confirm',closed));closed=await period(pq('detail','owner',periodId),pc('seal',closed));assert(closed.period.sealed);
      const sealedSource=read();assert.equal(sealedSource.detail.stale,false);assert.equal(sealedSource.detail.current.fingerprint,second.expectedFingerprint);
      const sealedCommand=make(sealedSource);reject(expression(q('decide','owner',sealedCommand.operationId),sealedCommand),'attendance_period_sealed|attendance_plan_exception_review_blocked');
      const adopted=adoptionRead(),freshApply=adoptionMake(adopted,selected);
      reject('public.faolla_attendance_plan_posthoc_adoption_v1('+json(ctx.q())+','+quote(d.owner)+','+json(freshApply)+',true)','attendance_period_sealed|attendance_plan_posthoc_adoption_blocked');
      assert.equal(archive().artifactText,oldArchive.artifactText);assert.equal(archive().artifactSha256,oldArchive.artifactSha256);
      native.pass('207 real period resend, employee confirmation and owner seal; saved v3 parses; sealed fingerprint stable and fresh writes refused');

      stage='reopen-and-revoke';closed=await period(pq('detail','owner',periodId),pc('reopen',closed));
      const beforeRevoke=read(),ledger=adoptionRead();adoptionSave({action:'revoke',operationId:next(),expectedRevision:ledger.revision,expectedFingerprint:ledger.current.sourceFingerprint,
        employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,reason:'Synthetic207 revoke invalidates saved review and period'});
      const revoked=read();assert.equal(revoked.detail.current.protocol,'plan-exception-source-v3');assert(revoked.detail.current.blockers.includes('posthoc_inactive'));assert(revoked.detail.stale);
      assert.notEqual(revoked.detail.current.fingerprint,beforeRevoke.detail.current.fingerprint);assert((await period(pq())).preview.blockers.includes('unresolved_review'));
      reject(expression(q('decide','owner',next()),{...second,operationId:next(),expectedRevision:revoked.detail.revision}),'attendance_invalid_request');
      const stale={...second,operationId:next(),expectedRevision:revoked.detail.revision};reject(expression(q('decide','owner',stale.operationId),stale),'attendance_plan_exception_review_source_changed');
      const off=process.env.FAOLLA_ATTENDANCE_PLAN_POSTHOC_REVIEW_ENABLED;process.env.FAOLLA_ATTENDANCE_PLAN_POSTHOC_REVIEW_ENABLED='0';
      try{const historical=await executePlanExceptions({query:q('detail','self'),authUserId:h.employeeAuthUserId,moduleEnabled:false},service);assert.equal(historical.detail.latestDecision.outcome,'excused');}
      finally{process.env.FAOLLA_ATTENDANCE_PLAN_POSTHOC_REVIEW_ENABLED=off;}
      assert.equal(d.fingerprint(originalTables),originalFacts);assert.equal(archive().artifactText,oldArchive.artifactText);assert.equal(archive().artifactSha256,oldArchive.artifactSha256);
      native.pass('207 revoke invalidates current case/period while paused self history, original punches/fixed approvals and old155 bytes stay intact');
      stage='full-leave';const fullLeave=await verifyPosthocFullLeaveNative({d,h,native,scope,next},{
        onPrepared:onFullLeavePrepared?full=>onFullLeavePrepared({...full,archive,oldArchive,registerRecoveryCoverageEvents:recoveryEvents.register,posthocAdministrativeEvents,posthocReminderEvents}):null,
      });
      const {syntheticRecoveryEvents,syntheticAdministrativeEvents,syntheticReminderEvents=0}=(()=>{
        if(reminderEvents.isArmed()){const footprint=reminderEvents.verify();return {syntheticRecoveryEvents:0,syntheticAdministrativeEvents:footprint.administrativeEvents,syntheticReminderEvents:footprint.reminderEvents};}
        if(administrativeEvents.isArmed())return {syntheticRecoveryEvents:0,syntheticAdministrativeEvents:administrativeEvents.verify()};
        const syntheticRecoveryEvents=recoveryEvents.verify();return {syntheticRecoveryEvents,syntheticAdministrativeEvents:0};
      })();assert.equal(archive().artifactText,oldArchive.artifactText);
      stage='optional-owned-extension';
      const extension=after?await after({d,h,native,scope,next,all,archive,oldArchive,period,pq,selected,read,make,submit,raw,q,adoptionRead,adoptionSave,adoptionMake}):null;
      if(after){
        //An owned extension may append disclosed synthetic historical fixtures,
        //but every pre-existing protected row must still exist byte-for-byte.
        for(const table of originalTables)assert.equal(exec('select '+json(originalRows[table])+' <@ coalesce(jsonb_agg(to_jsonb(t)),\'[]\'::jsonb) from public.'+table+' t;'),'t','posthoc_extension_changed_original_rows:'+table);
      }else if(!administrativeEvents.isArmed())assert.equal(d.fingerprint(originalTables),originalFacts);
      if(reminderEvents.isArmed())reminderEvents.verify();else if(administrativeEvents.isArmed())administrativeEvents.verify();
      assert.equal(archive().artifactText,oldArchive.artifactText);assert.equal(archive().artifactSha256,oldArchive.artifactSha256);
      return {phase:207,reads,rejections,actualFormalDecision:true,atomicCapture:true,casRace:true,actualPeriodReseal:true,oldArchivePreserved:true,originalFactsUnchanged:true,
        fullLeave,syntheticRecoveryEvents,...(syntheticAdministrativeEvents?{syntheticAdministrativeEvents}:{}),...(reminderEvents.isArmed()?{syntheticReminderEvents,reminderFootprintProtection:reminderEvents.summary()}:{}),browser:false,newCluster:false,production:false,deployed:false,...(after?{extension}:{})};
    }catch(error){throw new Error('207:'+stage+':'+String(error?.stack??error),{cause:error});}
    finally{for(const [key,value]of Object.entries(prior)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runPlanPosthocReviewNative(process.argv.slice(2)).then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(JSON.stringify({error:'plan_posthoc_review_native_failed',detail:error?.stack??String(error)}));process.exitCode=1;});
