//207 caller-owned acceptance. Three APPEND-ONLY synthetic historical schedule
//rows, not an actual past publication. Every subsequent leave/adoption/review/
//period request uses its real RPC. No old rows/guards/clocks are rewritten.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
const require=createRequire(import.meta.url);
export async function verifyPosthocFullLeaveNative({d,h,native,scope,next},{onPrepared=null}={}){
  assert(onPrepared===null||typeof onPrepared==='function','full_leave_onPrepared_must_be_a_function');
  assert(d.syntheticOnly&&h.syntheticOnly);assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
  const publication=next(),slotId=next(),periodId=next(),{exec}=d;
  const before=d.fingerprint(d.inventory().filter(t=>!['merchant_attendance_schedule_commands','merchant_attendance_schedule_slots','merchant_attendance_schedule_publication_evidence'].includes(t)));
  const defs=d.definitions(),catalog=d.tableCatalog();
  const slot=JSON.parse(exec(`do $full_leave_history$
    declare s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
      loc public.merchant_attendance_locations%rowtype;v public.merchant_attendance_schedule_slots%rowtype;r bigint;a timestamptz;b timestamptz;t timestamptz;pair jsonb;
    begin
      assert current_user='postgres';
      perform 1 from public.merchants where id=${quote(d.site)} and user_id=${quote(d.owner)} for share;assert found;
      select * into s from public.merchant_attendance_settings where merchant_id=${quote(d.site)} for update;
      select * into w from public.merchant_attendance_workers where merchant_id=${quote(d.site)} and id=${quote(h.workerId)} for update;
      select * into e from public.merchant_enterprise_employees where merchant_id=${quote(d.site)} and id=w.employee_id for share;
      select * into loc from public.merchant_attendance_locations where merchant_id=${quote(d.site)} and id=w.default_location_id for share;
      assert w.active and e.status='active' and e.id=${quote(h.employeeId)} and e.auth_user_id=${quote(h.employeeAuthUserId)} and loc.time_zone='UTC';
      a:=(((clock_timestamp() at time zone 'UTC')::date-3)::timestamp+interval '14 hours') at time zone 'UTC';b:=a+interval '2 hours';t:=a-interval '48 hours';
      assert not exists(select 1 from public.merchant_attendance_schedule_slots where merchant_id=${quote(d.site)} and worker_id=w.id and start_at<b and end_at>a);
      assert not exists(select 1 from public.merchant_attendance_events where merchant_id=${quote(d.site)} and worker_id=w.id and occurred_at>=a and occurred_at<b);
      select coalesce(max(revision),0)+1 into r from public.merchant_attendance_schedule_commands where merchant_id=${quote(d.site)};
      pair:=jsonb_build_array(to_char(a at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),to_char(b at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
      insert into public.merchant_attendance_schedule_commands(merchant_id,revision,operation_id,actor_auth_user_id,query,command,recorded_at)
        values(${quote(d.site)},r,${quote(publication)},${quote(d.owner)},jsonb_build_object('siteId',${quote(d.site)},'access','owner','workerId',w.id,'fromDate',to_char(a at time zone 'UTC','YYYY-MM-DD'),'throughDate',to_char(a at time zone 'UTC','YYYY-MM-DD'),'operationId',null),
        jsonb_build_object('operationId',${quote(publication)},'expectedRevision',r-1,'expectedSettingsVersion',s.version,'reason','Synthetic207 historical schedule only','action','publish','locationId',loc.id,'timeZone','UTC','slots',jsonb_build_array(pair)),t);
      insert into public.merchant_attendance_schedule_slots(merchant_id,id,revision,worker_id,employee_id,worker_name,location_id,location_name,time_zone,work_date,start_at,end_at)
        values(${quote(d.site)},${quote(slotId)},r,w.id,e.id,w.display_name,loc.id,loc.name,'UTC',(a at time zone 'UTC')::date,a,b) returning * into v;
      insert into public.merchant_attendance_schedule_publication_evidence(merchant_id,revision,operation_id,actor_auth_user_id,worker_id,employee_id,employee_auth_user_id,identity_status,worker_version,location_id,location_version,settings_version,time_zone,slots,published_at,recorded_at,capture_policy)
        values(${quote(d.site)},r,${quote(publication)},${quote(d.owner)},w.id,e.id,e.auth_user_id,'bound',w.version,loc.id,loc.version,s.version,'UTC',jsonb_build_array(jsonb_build_object('id',v.id,'workDate',to_char(v.work_date,'YYYY-MM-DD'),'startAt',pair->0,'endAt',pair->1)),t,t,'publish-identity-context-v1');
    end;$full_leave_history$;set constraints all immediate;select public.faolla_attendance_self_schedule_slot_v1(v)->'slot' from public.merchant_attendance_schedule_slots v where merchant_id=${quote(d.site)} and id=${quote(slotId)};`));
  assert(slot.hasPublicationEvidence);assert.equal(d.definitions(),defs);assert.equal(d.tableCatalog(),catalog);
  assert.equal(d.fingerprint(d.inventory().filter(t=>!['merchant_attendance_schedule_commands','merchant_attendance_schedule_slots','merchant_attendance_schedule_publication_evidence'].includes(t))),before);
  const call=x=>JSON.parse(exec('set local role service_role;select '+x+';'));
  const {parsePlanExceptionResult}=require('../../src/lib/merchantAttendancePlanExceptions.ts');
  const {projectPlanPosthocResult}=require('../../src/lib/merchantAttendancePlanPosthoc.server.ts');
  const rq=(mode='detail',access='owner',op=null)=>({siteId:d.site,access,mode,workerId:h.workerId,slotId,operationId:op,beforeAt:null,beforeId:null});
  const review=(query=rq(),command=null)=>parsePlanExceptionResult(call('public.faolla_attendance_plan_exception_posthoc_review_v1('+json(query)+','+quote(query.access==='owner'?d.owner:h.employeeAuthUserId)+','+json(command)+',true,true,true,true)'),query,{authUserId:query.access==='owner'?d.owner:h.employeeAuthUserId},command);
  const decision=(value,outcome)=>({operationId:next(),expectedRevision:value.detail.revision,expectedFingerprint:value.detail.current.fingerprint,employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,outcome,note:'Synthetic207 full approved leave is not normal attendance'});
  const legacy=review();assert.notEqual(legacy.detail.current.protocol,'plan-exception-source-v3');assert.equal(legacy.detail.current.eligible,false);
  const first=decision(legacy,'follow_up');review(rq('decide','owner',first.operationId),first);
  exec("update public.merchant_enterprise_roles set permissions=array(select distinct p from unnest(permissions||array['attendance.self.leave']) p order by p) where merchant_id="+quote(d.site)+' and id=(select role_id from public.merchant_enterprise_employees where merchant_id='+quote(d.site)+' and id='+quote(h.employeeId)+');');
  const {executeLeave}=require('../../src/lib/merchantAttendanceLeave.server.ts');
  const leaveService={rpc:async(name,a)=>{assert.equal(name,'faolla_attendance_leave_v1');try{return {data:call('public.'+name+'('+json(a.p_query)+','+quote(a.p_auth_user_id)+','+json(a.p_command)+','+a.p_allow_write+')'),error:null};}catch(error){const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}}};
  const leave=(access,command=null,requestId=null)=>executeLeave({query:{siteId:d.site,access,requestId,operationId:null,beforeAt:null,beforeId:null},command,authUserId:access==='owner'?d.owner:h.employeeAuthUserId,allowWrite:true},leaveService);
  const settings=await leave('self'),requestId=next();
  await leave('self',{operationId:requestId,action:'submit',reason:'Synthetic207 full leave application',expectedWorkerId:h.workerId,expectedSettingsVersion:settings.settingsVersion,timeZone:slot.timeZone,startAt:slot.startAt,endAt:slot.endAt});
  await leave('owner',{operationId:next(),action:'approve',requestId,expectedRevision:1,reason:'Synthetic207 actual approved full leave'},requestId);
  const aq={siteId:d.site,workerId:h.workerId,slotId,mode:'detail',operationId:null};
  const adopt=c=>projectPlanPosthocResult(call('public.faolla_attendance_plan_posthoc_adoption_v1('+json(aq)+','+quote(d.owner)+','+json(c)+',true)'),aq,d.owner,c);
  const available=adopt(null);assert(available.preview.eligible,JSON.stringify(available.preview.blockers));
  adopt({action:'apply',operationId:next(),expectedRevision:available.revision,expectedFingerprint:available.preview.fingerprint,employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,reason:'Synthetic207 explicitly activate leave-aware policy without adopting work',sources:[]});
  const full=review();assert.equal(full.detail.current.state,'not_applicable');assert(full.detail.current.eligible);assert.deepEqual(full.detail.current.leaveEdges.work,[]);
  const all=()=>d.fingerprint(d.inventory());
  const read=(query=rq())=>{const beforeRead=all(),value=review(query);assert.equal(all(),beforeRead,'full_leave_read_zero_writes');return value;};
  const {executePeriodClosures}=require('../../src/lib/merchantAttendancePeriodClosure.server.ts');
  const pq=(mode='preview',access='owner',pid=null)=>({siteId:d.site,access,workerId:h.workerId,fromDate:slot.workDate,throughDate:slot.workDate,mode,periodId:pid,operationId:null,version:null});
  const ps={rpc:async(name,a)=>{assert(['faolla_attendance_period_closure_v1','faolla_attendance_period_closure_source_v1'].includes(name));try{return {data:call('public.'+name+'('+json(a.p_query)+','+quote(a.p_auth_user_id)+(name==='faolla_attendance_period_closure_v1'?','+json(a.p_command)+','+json(a.p_artifact)+','+a.p_allow_write:'')+')'),error:null};}catch(error){const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}}};
  const period=(query,command=null)=>executePeriodClosures({query,command,authUserId:query.access==='owner'?d.owner:h.employeeAuthUserId,moduleEnabled:true},ps);
  const pc=(action,v=null,fingerprint=null)=>({action,operationId:next(),periodId,expectedRevision:v?.period.revision??0,expectedVersion:v?.period.currentVersion??0,expectedFingerprint:v?.artifact.sourceFingerprint??fingerprint,reason:'Synthetic207 full leave first period'});
  const periodArchive=()=>{const beforeRead=all(),value=call('public.faolla_attendance_period_closure_v1('+json({...pq('export','owner',periodId),version:1})+','+quote(d.owner)+',null,null,false)');assert.equal(all(),beforeRead,'full_leave_archive_zero_writes');return value;};
  let closed=null,sealedArchive=null,sealStarted=false,reopenStarted=false,cancelStarted=false;
  const seal=async()=>{
    assert.equal(sealStarted,false,'full_leave_seal_once');sealStarted=true;
    const current=read();assert.equal(current.detail.revision,full.detail.revision+1);
    assert.equal(current.detail.latestDecision.outcome,'not_applicable');assert.equal(current.detail.stale,false);
    assert.equal(current.detail.current.fingerprint,full.detail.current.fingerprint);
    const preview=await period(pq());assert.deepEqual(preview.preview.blockers,[]);assert.equal(preview.preview.artifact.source.sourceVersion,'attendance-period-source-v3');
    closed=await period(pq('detail','owner',periodId),pc('send',null,preview.preview.artifact.sourceFingerprint));
    closed=await period(pq('detail','self',periodId),pc('confirm',closed));
    closed=await period(pq('detail','owner',periodId),pc('seal',closed));assert(closed.period.sealed);
    assert.equal(read().detail.stale,false);sealedArchive=periodArchive();return closed;
  };
  const reopen=async()=>{
    assert.equal(reopenStarted,false,'full_leave_reopen_once');reopenStarted=true;
    const current=await period(pq('detail','owner',periodId));assert(current.period.sealed);
    return period(pq('detail','owner',periodId),pc('reopen',current));
  };
  const cancel=async()=>{
    assert.equal(cancelStarted,false,'full_leave_cancel_once');cancelStarted=true;
    return leave('owner',{operationId:next(),action:'cancel',requestId,expectedRevision:2,reason:'Synthetic207 existing administrative cancellation'},requestId);
  };
  //209 is opt-in: the callback runs only after real122 approval and real171
  //apply[]. It must save via the actual parent UI and seal via real149. Its
  //operation ID is merely a lookup key, never accepted as proof of success.
  //The parent injects its separate old155 archive guard; periodArchive is this
  //new full-leave version and does not exist until seal() completes.
  let final,browserResult=null;
  if(onPrepared===null){
    final=decision(full,'not_applicable');review(rq('decide','owner',final.operationId),final);
  }else{
    const completed=await onPrepared({d,h:{...h,slot,query:{siteId:d.site,workerId:h.workerId,slotId}},native,scope,next,
      selected:[],rq,review,read,make:decision,all,period,pq,periodId,requestId,seal,reopen,cancel,periodArchive});
    assert(completed&&typeof completed.operationId==='string','full_leave_callback_requires_saved_operation_id');
    const recovered=read(rq('recover','owner',completed.operationId));assert(recovered.receipt,'full_leave_callback_operation_must_exist');
    final=recovered.receipt.command;assert.equal(final.outcome,'not_applicable');
    assert.equal(final.expectedRevision,full.detail.revision);assert.equal(final.expectedFingerprint,full.detail.current.fingerprint);
    assert.equal(recovered.receipt.item.revision,full.detail.revision+1);assert.equal(recovered.detail.revision,recovered.receipt.item.revision);
    assert.equal(recovered.detail.latestDecision.operationId,completed.operationId);assert.equal(recovered.detail.latestDecision.readAt,null);
    assert.equal(sealStarted,true,'full_leave_callback_must_seal');assert(closed?.period.sealed&&sealedArchive);
    assert.equal(reopenStarted,false);assert.equal(cancelStarted,false);
    const stillApproved=await leave('owner',null,requestId);assert.equal(stillApproved.detail.status,'approved');assert.equal(stillApproved.detail.revision,2);
    const stillSealed=await period(pq('detail','owner',periodId));assert(stillSealed.period.sealed);assert.equal(stillSealed.sourceChanged,false);
    assert.equal(periodArchive().artifactText,sealedArchive.artifactText);assert.equal(periodArchive().artifactSha256,sealedArchive.artifactSha256);
    browserResult=completed.browserResult;
  }
  assert.equal(read(rq('detail','self')).detail.latestDecision.evidence.evaluation.state,'not_applicable');
  const notification=JSON.parse(exec('select jsonb_agg(to_jsonb(n)) from public.merchant_attendance_event_notifications n where merchant_id='+quote(d.site)+' and operation_id='+quote(final.operationId)+';'));assert.equal(notification.length,1);
  const {parseEventNotificationsResult}=require('../../src/lib/merchantAttendanceEventNotifications.ts');
  const nq={siteId:d.site,expectedEmployeeId:h.employeeId,expectedWorkerId:h.workerId,notificationId:notification[0].notification_id,beforeAt:null,beforeId:null};
  assert.equal(parseEventNotificationsResult(call('public.faolla_attendance_event_notifications_v1('+json(nq)+','+quote(h.employeeAuthUserId)+',null,false)'),nq,h.employeeAuthUserId).detail.type,'not_applicable');
  if(onPrepared===null)await seal();
  //122 administrative cancellation remains allowed;150 never froze leave.
  //Do not widen that successful policy merely to satisfy a test assumption.
  //A changed live source must be visible while saved bytes stay immutable and
  //fresh adoption/decisions still require explicit period reopening.
  await cancel();
  const changed=review();assert(changed.detail.stale);assert.notEqual(changed.detail.current.state,'not_applicable');
  const changedPeriod=await period(pq('detail','owner',periodId));assert(changedPeriod.period.sealed);assert.equal(changedPeriod.sourceChanged,true);
  assert.equal(periodArchive().artifactText,sealedArchive.artifactText);assert.equal(periodArchive().artifactSha256,sealedArchive.artifactSha256);
  assert.equal(review(rq('detail','self')).detail.latestDecision.outcome,'not_applicable');
  const follow=decision(changed,'follow_up'),beforeDenied=d.fingerprint(d.inventory());
  assert.throws(()=>review(rq('decide','owner',follow.operationId),follow),/attendance_period_sealed/);assert.equal(d.fingerprint(d.inventory()),beforeDenied);
  await reopen();
  assert.equal(review(rq('decide','owner',follow.operationId),follow).detail.latestDecision.outcome,'follow_up');
  assert((await period(pq('preview','owner',periodId))).preview.blockers.includes('unresolved_review'));
  assert.equal(review(rq('recover','owner',final.operationId)).receipt.item.outcome,'not_applicable');
  native.pass('207 full leave: three disclosed synthetic schedule rows; real leave approval, empty adoption, not_applicable decision/message, first period seal, later cancel invalidates live source without rewriting archive');
  return {syntheticScheduleRows:3,actualPastPublication:false,actualLeaveApproval:true,actualNotApplicableDecision:true,actualFirstPeriodSeal:true,cancelInvalidates:true,...(onPrepared===null?{}:{browserResult})};
}
