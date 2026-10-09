//202 synthetic, caller-owned acceptance. Importing starts no environment.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json,lifecycleRace} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {verifyPlanClearanceBoundariesNative} from './attendance-plan-clearance-boundaries-native.mjs';
const require=createRequire(import.meta.url),migration='202610060170_merchant_attendance_plan_clearance.sql';
const review='faolla_attendance_plan_exception_review_v1',clearance='faolla_attendance_plan_exception_clearance_v1',eventReview='faolla_attendance_plan_exception_review_event_v1';
const expression=(name,q,auth,c=null,allow=true,clear=false,capture=false)=>`public.${name}(${json(q)},${quote(auth)},${json(c)},${allow}${name===clearance?`,${clear},${capture}`:''})`;
export async function verifyPlanClearanceNative(ctx,browserCheck=null){
  const {d,h,native,scope,install,period,pq,pc,periodId}=ctx,{exec}=d;
  assert(d.syntheticOnly&&h.syntheticOnly);assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
  const core=require('../../src/lib/merchantAttendancePlanExceptions.ts'),sourceCore=require('../../src/lib/merchantAttendancePlanExceptions.server.ts');
  const notices=require('../../src/lib/merchantAttendanceEventNotifications.ts');
  let phase='old-case',n=202100000,reads=0,rejections=0;
  const next=()=>id(++n),all=()=>d.fingerprint(d.inventory());
  const call=exp=>JSON.parse(exec('set local role service_role;select '+exp+';'));
  const rq=(mode='detail',access='owner',op=null)=>({siteId:d.site,access,mode,workerId:h.workerId,slotId:h.slot.id,operationId:op,beforeAt:null,beforeId:null});
  const raw=(q,c=null,{name=review,auth=q.access==='owner'?d.owner:h.employeeAuthUserId,allow=true,enabled=false,capture=false}={})=>
    call(expression(name,q,auth,c,allow,enabled,capture));
  const read=(q=rq(),options={})=>{const before=all(),r=core.parsePlanExceptionResult(raw(q,null,options),q,{authUserId:options.auth??(q.access==='owner'?d.owner:h.employeeAuthUserId)});assert.equal(all(),before);reads++;return r;};
  const make=(r,outcome='cleared',operationId=next())=>({operationId,expectedRevision:r.detail.revision,expectedFingerprint:r.detail.current.fingerprint,
    employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,outcome,note:'Synthetic202 explicit owner review, not payroll'});
  const submit=(c,options={})=>{const q=rq('decide','owner',c.operationId);return core.parsePlanExceptionResult(raw(q,c,{name:clearance,enabled:true,...options}),q,{authUserId:d.owner},c);};
  const reject=(exp,pattern)=>{const before=all();assert.throws(()=>call(exp),new RegExp('ERROR:\\s+(?:'+pattern+')(?:\\s|$)'));assert.equal(all(),before);rejections++;};
  const source=()=>{const before=all(),r=sourceCore.projectPlanExceptionSource(call(`public.faolla_attendance_plan_exception_source_v1(${json(h.query)},${quote(d.owner)})`),h.query,d.owner);assert.equal(all(),before);reads++;return r;};
  const captureRows=op=>JSON.parse(exec(`select coalesce(jsonb_agg(to_jsonb(x) order by notification_id),'[]') from public.merchant_attendance_event_notifications x where merchant_id=${quote(d.site)}${op?` and operation_id=${quote(op)}`:''};`));
  const originalFacts=d.fingerprint(['merchant_attendance_events','merchant_attendance_shift_schedule_relations','merchant_attendance_shift_plan_adoptions','merchant_attendance_plan_rule_operations','merchant_attendance_plan_rule_artifacts']);
  const nq=id=>({siteId:d.site,expectedEmployeeId:h.employeeId,expectedWorkerId:h.workerId,notificationId:id,beforeAt:null,beforeId:null});
  const notification=(id=null,c=null)=>{const q=nq(id),before=c?null:all(),r=notices.parseEventNotificationsResult(call(`public.faolla_attendance_event_notifications_v1(${json(q)},${quote(h.employeeAuthUserId)},${json(c)},true)`),q,h.employeeAuthUserId,c);if(!c){assert.equal(all(),before);reads++;}return r;};
  try{
    const initial=read();assert.equal(initial.detail.revision,0);assert(initial.detail.current.eligible);
    const oldCommand=make(initial,'follow_up'),oldSaved=submit(oldCommand,{name:eventReview,capture:false});
    assert.equal(oldSaved.detail.revision,1);assert.equal(captureRows(oldCommand.operationId).length,1);
    phase='migration';const tables=d.inventory().filter(x=>x!=='faolla_schema_migrations'),beforeInstall=d.fingerprint(tables);install(migration);
    assert.equal(d.fingerprint(tables),beforeInstall);assert.deepEqual(d.inventory().filter(x=>x!=='faolla_schema_migrations'),tables);
    const installed=all(),definitions=d.definitions(),catalog=d.tableCatalog();install(migration);assert.equal(all(),installed);assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
    assert.deepEqual(read(rq('recover','owner',oldCommand.operationId)).receipt,oldSaved.receipt);
    const acl=JSON.parse(exec(`select jsonb_build_object('service',has_function_privilege('service_role','public.${clearance}(jsonb,uuid,jsonb,boolean,boolean,boolean)','EXECUTE'),
      'privateEngine',has_function_privilege('service_role','public.faolla_attendance_plan_exception_clearance_execute_v1(jsonb,uuid,jsonb,boolean,boolean,boolean)','EXECUTE'),
      'anon',has_function_privilege('anon','public.${clearance}(jsonb,uuid,jsonb,boolean,boolean,boolean)','EXECUTE'),'authenticated',has_function_privilege('authenticated','public.${clearance}(jsonb,uuid,jsonb,boolean,boolean,boolean)','EXECUTE'));`));
    assert.deepEqual(acl,{service:true,privateEngine:false,anon:false,authenticated:false});
    const stillTriggered=make(read());reject(expression(clearance,rq('decide','owner',stillTriggered.operationId),d.owner,stillTriggered,true,true,true),'attendance_plan_exception_review_blocked');
    native.pass('202170 additive/reentry facts stable; old169 notification/159 receipt retained; triggered source cannot clear');

    phase='real-correction';let current=await period(pq('detail','owner',periodId));
    current=await period(pq('detail','owner',periodId),pc('reopen',current));assert.equal(current.period.sealed,false);
    const policyOp=next();exec(`select public.faolla_attendance_correction_controls_v2(${quote(d.site)},${quote(d.owner)},jsonb_build_object(
      'action','set_policy','operationId',${quote(policyOp)},'expectedRevision',(select coalesce(max(revision),0) from public.merchant_attendance_correction_controls where merchant_id=${quote(d.site)}),
      'expectedSettingsVersion',(select version from public.merchant_attendance_settings where merchant_id=${quote(d.site)}),'reason','Synthetic202 correction window','submissionWindowDays',365),null,null,true);`);
    const policyRevision=Number(exec(`select revision from public.merchant_attendance_correction_controls where merchant_id=${quote(d.site)} and operation_id=${quote(policyOp)};`));
    const six=v=>new Date(Date.parse(v)).toISOString().replace('Z','000Z'),move=(v,min)=>six(new Date(Date.parse(v)+min*60000).toISOString());
    const firstProposal={startAt:move(h.slot.startAt,10),endAt:move(h.slot.endAt,-20),breaks:[]};
    const finalProposal={startAt:six(h.slot.startAt),endAt:six(h.slot.endAt),breaks:[]};
    const rootRequest=next(),rootApproval=next();
    call(`public.faolla_attendance_correction_self_v3(${quote(d.site)},${quote(h.employeeAuthUserId)},${json({mode:'detail',expectedWorkerId:h.workerId,requestId:rootRequest,operationId:null})},${json({action:'submit',operationId:rootRequest,expectedRevision:0,expectedPolicyRevision:policyRevision,reason:'Synthetic202 actual correction',startEventId:h.startEventId,expectedLastEventId:h.lastEventId,proposal:firstProposal})},true)`);
    const reviewCorrection=call(`public.faolla_attendance_correction_decide_v1(${quote(d.site)},${quote(d.owner)},${quote(rootRequest)},null,null,true)`);assert(reviewCorrection.canApprove);
    call(`public.faolla_attendance_correction_decide_v1(${quote(d.site)},${quote(d.owner)},${quote(rootRequest)},${json({action:'approve',operationId:rootApproval,requestId:rootRequest,expectedRevision:1,expectedEvidence:reviewCorrection.evidenceToken,reason:'Synthetic202 actual initial approval'})},null,true)`);
    assert.equal(source().candidate.late.state,'triggered');
    const revise=proposal=>{
      const prepared=JSON.parse(exec(`select public.faolla_attendance_revision_self_v2(${quote(d.site)},${quote(h.employeeAuthUserId)},${json({mode:'prepare',expectedWorkerId:h.workerId,baseRequestId:rootRequest,requestId:null,operationId:null})},null,true);`));
      const request=next(),approval=next(),command={action:'submit',operationId:request,expectedRevision:prepared.revision,expectedBaseOperationId:rootApproval,
        expectedEffectiveOperationId:prepared.current.operationId,expectedPolicyRevision:policyRevision,reason:'Synthetic202 actual subsequent correction',proposal};
      exec(`select public.faolla_attendance_revision_self_v2(${quote(d.site)},${quote(h.employeeAuthUserId)},${json({mode:'detail',expectedWorkerId:h.workerId,baseRequestId:rootRequest,requestId:request,operationId:null})},${json(command)},true);`);
      const view=JSON.parse(exec(`select public.faolla_attendance_revision_decide_v2(${quote(d.site)},${quote(d.owner)},${quote(request)},null,null,true);`));assert(view.canApprove);
      const decision={action:'approve',operationId:approval,requestId:request,expectedRevision:view.review.submittedRevision,expectedEvidence:view.evidenceToken,
        expectedBaseOperationId:view.current.operationId,reason:'Synthetic202 actual latest approval'};
      exec(`select public.faolla_attendance_revision_decide_v2(${quote(d.site)},${quote(d.owner)},${quote(request)},${json(decision)},null,true);`);
      return {request,approval};
    };
    const finalRevision=revise(finalProposal),normal=source();assert(normal.eligible);assert.equal(normal.candidate.late.state,'not_triggered');assert.equal(normal.candidate.early.state,'not_triggered');
    assert.equal(normal.source.sessions[0].effect.operationId,finalRevision.approval);assert.deepEqual(normal.candidate.original,h.sourceRaw.candidate.original);
    const oldView=read(),cleared=make(oldView),cq=rq('decide','owner',cleared.operationId);
    reject(expression(review,cq,d.owner,cleared),'attendance_plan_exception_clearance_disabled');
    reject(expression(eventReview,cq,d.owner,cleared),'attendance_plan_exception_clearance_disabled');
    reject(expression(clearance,cq,d.owner,cleared,true,false,true),'attendance_plan_exception_clearance_disabled');
    const previewBlocked=await period(pq('preview','owner',periodId));assert(previewBlocked.preview.blockers.includes('unresolved_review'));
    native.pass('202 real initial correction and approved revision remove both triggers; raw facts fixed; old writer/capture cannot bypass clearance flag; period remains blocked');

    phase='atomic-capture';const beforeFailure=all(),beforeFailureDefs=d.definitions(),beforeFailureCatalog=d.tableCatalog();
    exec("create function public.attendance_clearance_fail_test() returns trigger language plpgsql as $$ begin raise exception 'synthetic_clearance_capture_failure' using errcode='23514';end;$$; create trigger attendance_clearance_fail_test before insert on public.merchant_attendance_event_notifications for each row execute function public.attendance_clearance_fail_test();");
    try{assert.throws(()=>submit(cleared,{capture:true}),/synthetic_clearance_capture_failure/);assert.equal(all(),beforeFailure);}
    finally{exec('drop trigger attendance_clearance_fail_test on public.merchant_attendance_event_notifications;drop function public.attendance_clearance_fail_test();');}
    assert.equal(d.definitions(),beforeFailureDefs);assert.equal(d.tableCatalog(),beforeFailureCatalog);
    phase='same-case-race';const losing={...cleared,operationId:next()};
    const race=await lifecycleRace({connect:()=>native.connect(),query:s=>native.query(s),sql:scope.sql},
      `set local role service_role;select ${expression(clearance,cq,d.owner,cleared,true,true,true)};`,
      `set local role service_role;select ${expression(clearance,rq('decide','owner',losing.operationId),d.owner,losing,true,true,true)};`);
    assert(race.witnessed);assert(race.right.error);assert.match(String(race.right.error),/attendance_version_conflict|attendance_plan_exception_revision_conflict/);
    const saved=read(rq('recover','owner',cleared.operationId));assert.equal(saved.receipt.item.outcome,'cleared');assert.equal(saved.receipt.item.revision,2);assert.equal(captureRows(cleared.operationId).length,1);
    const replayFacts=all();for(const name of [review,eventReview,clearance])assert.deepEqual(submit(cleared,{name,allow:false,enabled:false,capture:true}).receipt,saved.receipt);assert.equal(all(),replayFacts);
    assert.equal(captureRows(losing.operationId).length,0);
    const notice=captureRows(cleared.operationId)[0];assert.equal(notification(notice.notification_id).detail.type,'cleared');
    const self=read(rq('detail','self'));assert.equal(self.detail.latestDecision.outcome,'cleared');
    native.pass('202 final notification23514 rolls decision back; exact PID race accepts one clearance; all three entry replays work paused without duplicate');

    phase='explicit-read-note';const ack={operationId:next(),decisionOperationId:cleared.operationId};raw(rq('ack','self',ack.operationId),ack);
    notification(notice.notification_id,{action:'mark_read',notificationId:notice.notification_id});
    const note={operationId:next(),expectedRevision:2,decisionOperationId:cleared.operationId,note:'Synthetic202 employee asks for a second review'};raw(rq('note','self',note.operationId),note);
    assert((await period(pq('preview','owner',periodId))).preview.blockers.includes('unresolved_review'));
    const nextDecision=make(read());submit(nextDecision,{capture:true});assert.equal(read().detail.revision,4);
    const ready=await period(pq('preview','owner',periodId));assert.deepEqual(ready.preview.blockers,[]);
    current=await period(pq('detail','owner',periodId));current=await period(pq('detail','owner',periodId),pc('send',current,ready.preview.artifact.sourceFingerprint));
    current=await period(pq('detail','self',periodId),pc('confirm',current));current=await period(pq('detail','owner',periodId),pc('seal',current));assert(current.period.sealed);
    assert(JSON.stringify(current.artifact.source.context.reviews).includes('cleared'));
    native.pass('202 employee note invalidates prior clearance; explicit second review and fresh period confirmation/seal complete; saved context retains cleared');

    phase='source-change';current=await period(pq('detail','owner',periodId),pc('reopen',current));
    //A different valid proposal within the saved ten-minute early grace still
    //changes evidence; old clearance must not silently carry across.
    const changedRevision=revise({...finalProposal,endAt:move(h.slot.endAt,-1)}),changedSource=source();
    assert.equal(changedSource.source.sessions[0].effect.operationId,changedRevision.approval);
    assert.equal(changedSource.candidate.early.state,'not_triggered');assert.equal(read().detail.stale,true);
    assert((await period(pq('preview','owner',periodId))).preview.blockers.includes('unresolved_review'));
    const outdated={...nextDecision,operationId:next(),expectedRevision:read().detail.revision};reject(expression(clearance,rq('decide','owner',outdated.operationId),d.owner,outdated,true,true,true),'attendance_plan_exception_review_source_changed');
    const beforeIdentity=all();
    for(const actor of [d.auth,id(202999901)])reject(expression(review,rq(),actor),'attendance_access_denied');
    assert.equal(all(),beforeIdentity);
    assert.equal(d.fingerprint(['merchant_attendance_events','merchant_attendance_shift_schedule_relations','merchant_attendance_shift_plan_adoptions','merchant_attendance_plan_rule_operations','merchant_attendance_plan_rule_artifacts']),originalFacts);
    native.pass('202 later actual correction requires fresh clearance; stale fingerprint and other identities reject; original events/relations/fixed approvals unchanged');

    phase='clearance-boundaries';const boundaries=await verifyPlanClearanceBoundariesNative({d,h,native,scope,read,rq,make,expression,review,clearance,eventReview,
      source,all,reject,next,submit,call,rootRequest,rootApproval,policyRevision,finalProposal,move});
    phase='integration-browser';const ports=buildPorts({d,h,call,all});
    const env={FAOLLA_ATTENDANCE_PLAN_CLEARANCE_ENABLED:'1',FAOLLA_ATTENDANCE_PLAN_CLEARANCE_SITE_IDS:d.site,
      FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_ENABLED:'1',FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_SITES:d.site,
      FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_READ_ENABLED:'1',FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_READ_SITES:d.site};
    const prior=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));let browser;
    try{Object.assign(process.env,env);browser=browserCheck?await browserCheck(ports):null;}
    finally{for(const [k,v] of Object.entries(prior)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
    assert.equal(d.fingerprint(['merchant_attendance_events','merchant_attendance_shift_schedule_relations','merchant_attendance_shift_plan_adoptions','merchant_attendance_plan_rule_operations','merchant_attendance_plan_rule_artifacts']),originalFacts);
    return {reads,rejections,actualCorrections:1,actualRevisionApprovals:2,exactPidRaces:1,notificationFailureRollback:true,employeeNoteRequiresReview:true,
      actualPeriodReseal:true,boundaries,browser,syntheticHistoricalPrerequisites:10,actualHistoricalClock:false,production:false,deployed:false};
  }catch(error){throw new Error('clearance_phase='+phase+':'+String(error),{cause:error});}
}

function buildPorts({d,h,call,all}){
  const {executePlanExceptions}=require('../../src/lib/merchantAttendancePlanExceptions.server.ts');
  const {handlePlanExceptions}=require('../../src/app/api/merchant-enterprise/attendance/plan-exceptions/route-handler.ts');
  const {executeAttendanceAdmin}=require('../../src/lib/merchantAttendanceAdmin.server.ts');
  const {handleAttendanceAdmin}=require('../../src/app/api/merchant-enterprise/attendance/admin/route-handler.ts');
  const {executeAttendanceSelf}=require('../../src/lib/merchantAttendanceSelf.server.ts');
  const {handleAttendanceSelf}=require('../../src/app/api/merchant-enterprise/attendance/self/route-handler.ts');
  const {executeEventNotifications}=require('../../src/lib/merchantAttendanceEventNotifications.server.ts');
  const {handleEventNotifications}=require('../../src/app/api/merchant-enterprise/attendance/event-notifications/route-handler.ts');
  const allowed=new Set([review,eventReview,clearance,'faolla_attendance_admin_v1','faolla_attendance_self_v1','faolla_attendance_self_bound_v1','faolla_attendance_event_notifications_v1']);
  const service={rpc:async(name,a)=>{assert(allowed.has(name),'unexpected_clearance_browser_rpc:'+name);const parts=Object.entries(a).map(([k,v])=>{
    assert(/^p_[a-z_]+$/.test(k));const value=v===null?'null':typeof v==='boolean'?String(v):typeof v==='object'?json(v):quote(v);return k+'=>'+value;});
    try{return {data:call(`public.${name}(${parts.join(',')})`),error:null};}catch(error){const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}}};
  const auth=id=>async()=>({user:{id},authenticationMethods:['password']}),common={enabled:()=>true,siteEnabled:()=>true,allow:()=>true,
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}})};
  const handleAdmin=req=>{assert.equal(req.method,'GET');return handleAttendanceAdmin(req,{...common,authenticate:auth(d.owner),execute:i=>executeAttendanceAdmin(i,service)});};
  const handleSelf=req=>{assert.equal(req.method,'GET');return handleAttendanceSelf(req,{...common,authenticate:auth(h.employeeAuthUserId),execute:i=>executeAttendanceSelf(i,service)});};
  // Request-local test policy only narrows the real process-level exact-site
  // gate; it never enables it or changes the historical/read RPC selection.
  const handleException=(req,access='owner',overrides={})=>handlePlanExceptions(req,{...common,authenticate:auth(access==='owner'?d.owner:h.employeeAuthUserId),
    execute:i=>executePlanExceptions(i,{rpc:(name,a)=>service.rpc(name,name===clearance&&overrides.clearanceEnabled===false?{...a,p_allow_clearance:false}:a)})});
  const handleNotifications=req=>handleEventNotifications(req,{...common,authenticate:auth(h.employeeAuthUserId),execute:i=>executeEventNotifications(i,service)});
  return {scope:d.owned,subject:{site:d.site,owner:d.owner,employee:h.employeeId,auth:h.employeeAuthUserId,worker:h.workerId,slotId:h.slot.id},handleAdmin,handleSelf,handleException,handleNotifications,
    fingerprint:all,actualHandlerServiceSql:true,syntheticAuth:true};
}
