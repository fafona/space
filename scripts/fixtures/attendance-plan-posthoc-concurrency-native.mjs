//208 inert, caller-owned concurrency acceptance. No runtime is started here.
//Real writers create every request, approval, adoption, review and period entry.
//Only a second past adjacent plan's SIX new rows are disclosed synthetic history;
//they are not actual past publication/approval. Original history is never edited.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleJson as json,lifecycleRace} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';

const require=createRequire(import.meta.url);
const move=(stamp,minutes)=>new Date(Date.parse(stamp)+minutes*60000).toISOString().replace('Z','000Z');
function factsSql(names,site,excluded={}){
  assert(names.length&&new Set(names).size===names.length);
  return '(select md5(jsonb_object_agg(name,rows order by name)::text) from ('+names.map(name=>{
    assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name));
    const filters=(excluded[name]??[]).map(([key,ids])=>{
      assert(/^[a-z_]+$/.test(key)&&ids.length);return `(${key} in(${ids.map(quote).join(',')}))`;
    });
    const where=filters.length?` where not(merchant_id=${quote(site)} and (${filters.join(' or ')}))`:'';
    return 'select '+quote(name)+" name,(select coalesce(jsonb_agg(to_jsonb(posthoc_race_row) order by to_jsonb(posthoc_race_row)::text),'[]') from public."+name+' posthoc_race_row'+where+') rows';
  }).join(' union all ')+') posthoc_race_tables)';
}

export async function verifyPlanPosthocConcurrencyNative(ctx){
  const {d,h,native,scope,next,archive,oldArchive,period,pq,selected}=ctx;
  assert(d?.syntheticOnly&&h?.syntheticOnly&&typeof d.guard==='string');
  assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);assert.equal(scope.schema,d.owned.schema);
  for(const port of [next,archive,period,pq,native.connect])assert.equal(typeof port,'function');
  assert.equal(h.workerId,d.otherWorker);assert.equal(h.employeeAuthUserId,d.otherAuth);assert.equal(h.slot.timeZone,'UTC');
  const sessionRef=selected.find(r=>r.kind==='session'),missingRef=selected.find(r=>r.kind==='missing');assert(sessionRef&&missingRef);
  const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
  const exec=sql=>d.exec(prefix+sql),site=quote(d.site),owner=quote(d.owner),auth=quote(h.employeeAuthUserId),worker=quote(h.workerId);
  const names=d.inventory(),defs=d.definitions(),catalog=d.tableCatalog(),hash=factsSql(names,d.site),all=()=>exec('select '+hash+';');
  const periodRows=JSON.parse(exec(`select jsonb_agg(to_jsonb(p)) from public.merchant_attendance_period_closures p where merchant_id=${site} and worker_id=${worker} and from_date=${quote(h.slot.workDate)}::date and through_date=${quote(h.slot.workDate)}::date;`));
  assert.equal(periodRows.length,1);const periodId=periodRows[0].period_id;assert.equal(periodRows[0].sealed,false);
  const additions={merchant_attendance_period_closures:[['period_id',[periodId]]],
    merchant_attendance_plan_posthoc_claims:[['source_id',[sessionRef.startEventId,missingRef.rootRequestId]]]};
  const protectedBefore=exec('select '+factsSql(names,d.site,additions)+';');
  const allow=(table,key,id)=>{const list=additions[table]??=[];let entry=list.find(v=>v[0]===key);if(!entry){entry=[key,[]];list.push(entry);}if(!entry[1].includes(id))entry[1].push(id);};
  const operation=(table,key='operation_id')=>{const id=next();allow(table,key,id);return id;};
  const call=expression=>JSON.parse(exec('set local role service_role;select '+expression+';'));
  let reads=0;const readOnly=fn=>{const before=all(),v=fn();assert.equal(all(),before,'208_read_zero_writes');reads++;return v;};
  const {parsePlanExceptionResult}=require('../../src/lib/merchantAttendancePlanExceptions.ts');
  const {projectPlanPosthocResult}=require('../../src/lib/merchantAttendancePlanPosthoc.server.ts');
  const {parseCurrentCorrectionDecision}=require('../../src/lib/merchantAttendanceCurrentCorrectionDecision.ts');
  const {executeAttendanceMissing}=require('../../src/lib/merchantAttendanceMissing.server.ts');
  const {executeLeave}=require('../../src/lib/merchantAttendanceLeave.server.ts');
  const rq=(slotId=h.slot.id,mode='detail',op=null)=>({siteId:d.site,access:'owner',mode,workerId:h.workerId,slotId,operationId:op,beforeAt:null,beforeId:null});
  const reviewExpression=(q,c=null)=>`public.faolla_attendance_plan_exception_posthoc_review_v1(${json(q)},${owner},${json(c)},true,true,true,false)`;
  const review=(slotId=h.slot.id)=>readOnly(()=>{const q=rq(slotId);return parsePlanExceptionResult(call(reviewExpression(q)),q,{authUserId:d.owner});});
  const decision=(view,outcome='follow_up')=>({operationId:operation('merchant_attendance_plan_exception_entries'),expectedRevision:view.detail.revision,
    expectedFingerprint:view.detail.current.fingerprint,employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,outcome,note:'Synthetic208 explicit concurrent formal review'});
  const decide=(c,slotId=h.slot.id)=>{const q=rq(slotId,'decide',c.operationId);return parsePlanExceptionResult(call(reviewExpression(q,c)),q,{authUserId:d.owner},c);};
  const aq=(slotId=h.slot.id)=>({siteId:d.site,workerId:h.workerId,slotId,mode:'detail',operationId:null});
  const adoptionExpression=(q,c=null)=>`public.faolla_attendance_plan_posthoc_adoption_v1(${json(q)},${owner},${json(c)},true)`;
  const adoption=(slotId=h.slot.id)=>readOnly(()=>projectPlanPosthocResult(call(adoptionExpression(aq(slotId))),aq(slotId),d.owner,null));
  const applyCommand=(view,sources)=>({action:'apply',operationId:operation('merchant_attendance_plan_posthoc_operations'),expectedRevision:view.revision,
    expectedFingerprint:view.preview.fingerprint,employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,reason:'Synthetic208 explicit latest source choice',sources});
  const adopt=(c,slotId=h.slot.id)=>projectPlanPosthocResult(call(adoptionExpression(aq(slotId),c)),aq(slotId),d.owner,c);
  const release=(slotId=h.slot.id)=>{const v=adoption(slotId);assert.equal(v.current.action,'apply');return adopt({action:'revoke',operationId:operation('merchant_attendance_plan_posthoc_operations'),
    expectedRevision:v.revision,expectedFingerprint:v.current.sourceFingerprint,employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,reason:'Synthetic208 explicit claim release'},slotId);};
  const latestRefs=()=>{
    const v=adoption();assert(v.preview.eligible,JSON.stringify(v.preview.blockers));
    return [sessionRef,missingRef].map(old=>{const c=v.preview.candidates.find(x=>x.reference.kind===old.kind&&(old.kind==='session'?x.reference.startEventId===old.startEventId:x.reference.rootRequestId===old.rootRequestId));assert(c?.available,JSON.stringify(c));return c.reference;});
  };
  const reapply=()=>{const refs=latestRefs(),v=adoption();adopt(applyCommand(v,refs));return refs;};
  const oldBytes=archive();assert.equal(oldBytes.artifactText,oldArchive.artifactText);assert.equal(oldBytes.artifactSha256,oldArchive.artifactSha256);
  const totals=(await period(pq())).preview.artifact.report.totals;
  reapply();assert(review().detail.current.eligible);
  const raceResults=[];
  async function race(label,winner,loser,error){
    //The left transaction holds its REAL successful writer's locks. The
    //shared helper proves the exact waiting PID is blocked by that backend.
    const raced=await lifecycleRace({connect:()=>native.connect(),query:sql=>native.query(sql),sql:scope.sql},
      prefix+`set local role service_role;do $posthoc_winner$ begin perform ${winner};end;$posthoc_winner$;reset role;set constraints all immediate;select ${hash};`,
      prefix+'set local role service_role;select '+loser+';');
    assert.equal(raced.witnessed,true,label);assert(raced.right.error,label);
    assert.match(String(raced.right.error),new RegExp('ERROR:\\s+'+error+'(?:\\s|$)'),label);
    const committedHash=String(raced.left).trim().split(/\r?\n/).at(-1);assert.match(committedHash,/^[0-9a-f]{32}$/);
    assert.equal(all(),committedHash,label+':failed_waiter_zero_residue');
    assert.equal(archive().artifactText,oldBytes.artifactText);assert.equal(archive().artifactSha256,oldBytes.artifactSha256);
    raceResults.push({label,error,exactPid:true,failedWaiterZeroWrites:true});
  }
  const rpcService=name=>({rpc:async(actual,a)=>{assert.equal(actual,name);try{return {data:call(`public.${actual}(${json(a.p_query)},${quote(a.p_auth_user_id)},${json(a.p_command)},${a.p_allow_write})`),error:null};}
    catch(error){const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}}});

  //122 approval changes leave geometry while the pre-submit174 command waits.
  const lq=(access,requestId=null)=>({siteId:d.site,access,requestId,operationId:null,beforeAt:null,beforeId:null});
  const leave=(q,c=null)=>executeLeave({query:q,command:c,authUserId:q.access==='owner'?d.owner:h.employeeAuthUserId,allowWrite:true},rpcService('faolla_attendance_leave_v1'));
  const preLeave=review(),staleLeave=decision(preLeave),leaveId=operation('merchant_attendance_leave_requests','request_id');allow('merchant_attendance_leave_entries','operation_id',leaveId);
  const leaveHome=await leave(lq('self'));assert(leaveHome.canSubmit);
  await leave(lq('self'),{action:'submit',operationId:leaveId,expectedWorkerId:h.workerId,expectedSettingsVersion:leaveHome.settingsVersion,timeZone:'UTC',
    startAt:move(h.slot.endAt,-5).slice(0,23)+'Z',endAt:h.slot.endAt,reason:'Synthetic208 leave geometry competition'});
  const leaveApprove={action:'approve',operationId:operation('merchant_attendance_leave_entries'),requestId:leaveId,expectedRevision:1,reason:'Synthetic208 actual leave approval holder'};
  assert(review().detail.current.blockers.includes('leave_pending'));
  await race('leave_approve_vs_review',`public.faolla_attendance_leave_v1(${json(lq('owner',leaveId))},${owner},${json(leaveApprove)},true)`,
    reviewExpression(rq(h.slot.id,'decide',staleLeave.operationId),staleLeave),'attendance_plan_exception_review_source_changed');
  const leaveRead=await leave(lq('owner',leaveId));assert.equal(leaveRead.detail.status,'approved');assert.notEqual(review().detail.current.fingerprint,preLeave.detail.current.fingerprint);
  await leave(lq('owner',leaveId),{action:'cancel',operationId:operation('merchant_attendance_leave_entries'),requestId:leaveId,expectedRevision:2,reason:'Synthetic208 restore current leave context without deleting history'});

  //086/096 actual first correction for the separately proved unassociated
  //session, with same duration. No hand-written effect or approval is used.
  const priorCorrection=review(),staleCorrection=decision(priorCorrection),correctionId=operation('merchant_attendance_correction_entries');
  allow('merchant_attendance_correction_rule_bindings','request_id',correctionId);
  const cq={mode:'detail',expectedWorkerId:h.workerId,requestId:correctionId,operationId:null};
  const prepared=readOnly(()=>call(`public.faolla_attendance_correction_self_v3(${site},${auth},${json({mode:'prepare',expectedWorkerId:h.workerId,startEventId:sessionRef.startEventId})},null,true)`));
  assert.equal(prepared.pendingRequestId,null);assert.equal(prepared.revision,0,'208_unassociated_session_has_no_prior_correction');
  const policy=Number(exec(`select max(revision) from public.merchant_attendance_correction_controls where merchant_id=${site} and action='set_policy';`));assert(Number.isSafeInteger(policy)&&policy>0);
  const correction={action:'submit',operationId:correctionId,expectedRevision:0,expectedPolicyRevision:policy,reason:'Synthetic208 shift five-minute selected source one minute',
    startEventId:sessionRef.startEventId,expectedLastEventId:sessionRef.lastEventId,proposal:{startAt:move(h.slot.endAt,-19),endAt:move(h.slot.endAt,-14),breaks:[]}};
  assert.equal(call(`public.faolla_attendance_correction_self_v3(${site},${auth},${json(cq)},${json(correction)},true)`).item.requestId,correctionId);
  const correctionView=readOnly(()=>parseCurrentCorrectionDecision(call(`public.faolla_attendance_correction_decide_v2(${site},${owner},${quote(correctionId)},null,null,true)`),{siteId:d.site,requestId:correctionId,operationId:null}));
  assert(correctionView.canApprove,JSON.stringify(correctionView.blockers));
  const correctionApprove={action:'approve',operationId:operation('merchant_attendance_correction_decisions'),requestId:correctionId,
    expectedRevision:correctionView.review.application.item.revision,expectedEvidence:correctionView.evidenceToken,reason:'Synthetic208 actual correction approval holder'};
  allow('merchant_attendance_correction_effects','operation_id',correctionApprove.operationId);
  assert(review().detail.current.blockers.includes('pending_correction'));
  await race('correction_approve_vs_review',`public.faolla_attendance_correction_decide_v2(${site},${owner},${quote(correctionId)},${json(correctionApprove)},null,true)`,
    reviewExpression(rq(h.slot.id,'decide',staleCorrection.operationId),staleCorrection),'attendance_plan_exception_review_source_changed');
  assert(review().detail.current.blockers.includes('source_changed'));reapply();assert(review().detail.current.eligible);

  //Two orientations, both using the actual149/175 period state machine. A
  //new decision changes period canonical content, even if formal source fp is
  //unchanged; a sealed period rejects a fresh decision, not saved recovery.
  const pc=(action,v,fp=v.artifact.sourceFingerprint)=>{const operationId=operation('merchant_attendance_period_entries');
    if(action==='send'){allow('merchant_attendance_period_artifacts','artifact_id',operationId);allow('merchant_attendance_period_versions','operation_id',operationId);}
    return {action,operationId,periodId,expectedRevision:v.period.revision,expectedVersion:v.period.currentVersion,expectedFingerprint:fp,reason:'Synthetic208 explicit period concurrency'};};
  const periodExpression=(command)=>`public.faolla_attendance_period_closure_v1(${json(pq('detail','owner',periodId))},${owner},${json(command)},null,true)`;
  const confirmCurrent=async()=>{
    decide(decision(review(),'confirmed'));const preview=await period(pq());assert.deepEqual(preview.preview.blockers,[]);
    let v=await period(pq('detail','owner',periodId));v=await period(pq('detail','owner',periodId),pc('send',v,preview.preview.artifact.sourceFingerprint));
    return period(pq('detail','self',periodId),pc('confirm',v));
  };
  let confirmed=await confirmCurrent();const sealFirst=pc('seal',confirmed),afterSeal=decision(review(),'confirmed');
  await race('period_seal_vs_review',periodExpression(sealFirst),reviewExpression(rq(h.slot.id,'decide',afterSeal.operationId),afterSeal),'attendance_period_sealed');
  let closed=await period(pq('detail','owner',periodId));assert(closed.period.sealed);assert.equal(review().detail.stale,false);
  closed=await period(pq('detail','owner',periodId),pc('reopen',closed));assert.equal(closed.period.sealed,false);
  confirmed=await confirmCurrent();const staleSeal=pc('seal',confirmed),reviewFirst=decision(review(),'confirmed');
  await race('review_vs_period_seal',reviewExpression(rq(h.slot.id,'decide',reviewFirst.operationId),reviewFirst),periodExpression(staleSeal),'attendance_period_source_changed');
  closed=await period(pq('detail','owner',periodId));assert.equal(closed.period.sealed,false);assert.equal(closed.sourceChanged,true);

  //103 actual successor keeps five minutes but crosses the adjacent plans'
  //boundary. Saved selected references remain stale until explicit new apply.
  const today=exec("select (clock_timestamp() at time zone 'UTC')::date::text;"),mq=(access,requestId=null)=>({siteId:d.site,access,fromDate:today,throughDate:today,requestId,operationId:null,beforeAt:null,beforeId:null});
  const missing=(q,c=null)=>executeAttendanceMissing({query:q,command:c,authUserId:q.access==='owner'?d.owner:h.employeeAuthUserId,allowWrite:true},rpcService('faolla_attendance_missing_v1'));
  async function prepareMissing(parent,proposal){
    const before=all(),home=await missing(mq('self',parent.requestId));assert.equal(all(),before);reads++;
    assert(home.detail.lineage.canRevise);assert.equal(home.detail.lineage.currentApprovalOperationId,parent.approvalOperationId);
    const requestId=operation('merchant_attendance_missing_requests','request_id');allow('merchant_attendance_missing_entries','operation_id',requestId);
    const command={action:'revise',operationId:requestId,expectedWorkerId:h.workerId,expectedSettingsVersion:home.settingsVersion,expectedPolicyRevision:home.policyRevision,
      locationId:d.location,timeZone:'UTC',proposal,supersedesRequestId:parent.requestId,expectedApprovalOperationId:parent.approvalOperationId,reason:'Synthetic208 actual current missing successor'};
    assert.equal((await missing(mq('self'),command)).detail.status,'submitted');
    const beforeReview=all(),v=await missing(mq('owner',requestId));assert.equal(all(),beforeReview);reads++;assert(v.detail.canApprove,JSON.stringify(v.detail.issues));
    const approve={action:'approve',operationId:operation('merchant_attendance_missing_entries'),requestId,expectedRevision:1,evidenceToken:v.detail.evidenceToken,reason:'Synthetic208 actual missing approval holder'};
    return {approve,query:mq('owner',requestId),reference:{kind:'missing',requestId,rootRequestId:parent.rootRequestId,approvalOperationId:approve.operationId}};
  }
  const beforeMissing=review(),staleMissing=decision(beforeMissing);
  const revised=await prepareMissing(missingRef,{startAt:move(h.slot.endAt,-1),endAt:move(h.slot.endAt,4),breaks:[]});
  assert(review().detail.current.blockers.includes('pending_missing'));
  await race('missing_approve_vs_review',`public.faolla_attendance_missing_v1(${json(revised.query)},${owner},${json(revised.approve)},true)`,
    reviewExpression(rq(h.slot.id,'decide',staleMissing.operationId),staleMissing),'attendance_plan_exception_review_source_changed');
  assert.equal((await missing(mq('owner',revised.reference.requestId))).detail.status,'approved');
  const changed=review();assert(changed.detail.current.blockers.includes('source_changed'));
  assert.deepEqual(changed.detail.current.source.evaluation.posthoc.selected,beforeMissing.detail.current.source.evaluation.posthoc.selected);
  release();

  //Only these six new rows are synthetic historical preconditions. The second
  //plan is half-open adjacent, NOT an overlapping impossible owner publication.
  const publication=operation('merchant_attendance_schedule_commands'),slotId=operation('merchant_attendance_schedule_slots','id'),approval=operation('merchant_attendance_plan_rule_operations');
  allow('merchant_attendance_schedule_publication_evidence','operation_id',publication);allow('merchant_attendance_plan_rule_artifacts','source_id',approval);allow('merchant_attendance_plan_rule_streams','slot_id',slotId);
  const secondSlot=JSON.parse(exec(`set constraints all deferred;do $posthoc_adjacent_history$
    declare s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
      l public.merchant_attendance_locations%rowtype;v public.merchant_attendance_schedule_slots%rowtype;source jsonb;source_hash text;pair jsonb;r bigint;a timestamptz;b timestamptz;t timestamptz;approved timestamptz;
    begin
      assert current_user='postgres';perform 1 from public.merchants where id=${site} and user_id=${owner} for share;assert found;
      select * into s from public.merchant_attendance_settings where merchant_id=${site} for update;
      select * into w from public.merchant_attendance_workers where merchant_id=${site} and id=${worker} for update;
      select * into e from public.merchant_enterprise_employees where merchant_id=${site} and id=w.employee_id for share;
      select * into l from public.merchant_attendance_locations where merchant_id=${site} and id=${quote(d.location)} for share;
      assert w.active and e.id=${quote(h.employeeId)} and e.auth_user_id=${auth} and e.status='active' and l.time_zone='UTC';
      a:=${quote(h.slot.endAt)}::timestamptz;b:=a+interval '1 hour';t:=a-interval '48 hours';approved:=a-interval '30 minutes';assert b<clock_timestamp();
      assert not exists(select 1 from public.merchant_attendance_schedule_slots where merchant_id=${site} and worker_id=w.id and start_at<b and end_at>a),'208_adjacent_history_no_overlap';
      select coalesce(max(revision),0)+1 into r from public.merchant_attendance_schedule_commands where merchant_id=${site};
      pair:=jsonb_build_array(to_char(a at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),to_char(b at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
      insert into public.merchant_attendance_schedule_commands(merchant_id,revision,operation_id,actor_auth_user_id,query,command,recorded_at)
        values(${site},r,${quote(publication)},${owner},jsonb_build_object('siteId',${site},'access','owner','workerId',w.id,'fromDate',to_char(a at time zone 'UTC','YYYY-MM-DD'),'throughDate',to_char(a at time zone 'UTC','YYYY-MM-DD'),'operationId',null),
          jsonb_build_object('operationId',${quote(publication)},'expectedRevision',r-1,'expectedSettingsVersion',s.version,'reason','Synthetic208 historical adjacent plan only','action','publish','locationId',l.id,'timeZone','UTC','slots',jsonb_build_array(pair)),t);
      insert into public.merchant_attendance_schedule_slots(merchant_id,id,revision,worker_id,employee_id,worker_name,location_id,location_name,time_zone,work_date,start_at,end_at)
        values(${site},${quote(slotId)},r,w.id,e.id,w.display_name,l.id,l.name,'UTC',(a at time zone 'UTC')::date,a,b) returning * into v;
      insert into public.merchant_attendance_schedule_publication_evidence(merchant_id,revision,operation_id,actor_auth_user_id,worker_id,employee_id,employee_auth_user_id,identity_status,worker_version,location_id,location_version,settings_version,time_zone,slots,published_at,recorded_at,capture_policy)
        values(${site},r,${quote(publication)},${owner},w.id,e.id,e.auth_user_id,'bound',w.version,l.id,l.version,s.version,'UTC',jsonb_build_array(jsonb_build_object('id',v.id,'workDate',to_char(v.work_date,'YYYY-MM-DD'),'startAt',pair->0,'endAt',pair->1)),t,t,'publish-identity-context-v1');
      select x.source into source from public.merchant_attendance_plan_rule_artifacts x where x.merchant_id=${site} and x.source_id=${quote(h.sourceId)};assert found;
      source:=jsonb_set(source,'{slot}',(source->'slot')||jsonb_build_object('id',v.id,'revision',r,'startAt',pair->0,'endAt',pair->1));
      assert public.faolla_attendance_plan_rule_source_v1(source);source_hash:=encode(sha256(convert_to(source::text,'UTF8')),'hex');
      insert into public.merchant_attendance_plan_rule_artifacts(merchant_id,source_id,worker_id,slot_id,employee_id,employee_auth_user_id,source,source_sha256,source_bytes)
        values(${site},${quote(approval)},w.id,v.id,e.id,e.auth_user_id,source,source_hash,octet_length(convert_to(source::text,'UTF8')));
      insert into public.merchant_attendance_plan_rule_operations(merchant_id,operation_id,worker_id,slot_id,revision,actor_auth_user_id,employee_id,employee_auth_user_id,command,source_id,observed_at,recorded_at)
        values(${site},${quote(approval)},w.id,v.id,1,${owner},e.id,e.auth_user_id,jsonb_build_object('operationId',${quote(approval)},'expectedRevision',0,'expectedFingerprint',source_hash,'employeeId',e.id,'employeeAuthUserId',e.auth_user_id,'reason','Synthetic208 historical fixed approval only'),${quote(approval)},approved,approved);
      insert into public.merchant_attendance_plan_rule_streams(merchant_id,slot_id,worker_id,employee_id,employee_auth_user_id,revision) values(${site},v.id,w.id,e.id,e.auth_user_id,1);
      perform public.faolla_attendance_period_plan_rule_v1(${site},w.id,v.id,e.id,e.auth_user_id,${quote(approval)});
    end;$posthoc_adjacent_history$;set constraints all immediate;
    select public.faolla_attendance_self_schedule_slot_v1(s)->'slot' from public.merchant_attendance_schedule_slots s where merchant_id=${site} and id=${quote(slotId)};`));
  assert.equal(secondSlot.startAt,h.slot.endAt);assert(secondSlot.hasPublicationEvidence);
  const firstCase=decision(review(slotId));allow('merchant_attendance_plan_exception_cases','case_id',firstCase.operationId);decide(firstCase,slotId);
  const leftView=adoption(),rightView=adoption(slotId),leftApply=applyCommand(leftView,latestRefs()),rightApply=applyCommand(rightView,[revised.reference]);
  assert(leftView.preview.eligible&&rightView.preview.eligible);
  assert(rightView.preview.candidates.find(c=>c.reference.kind==='missing'&&c.reference.rootRequestId===missingRef.rootRequestId)?.available);
  await race('two_plans_same_missing_root',adoptionExpression(aq(),leftApply),adoptionExpression(aq(slotId),rightApply),'attendance_plan_posthoc_adoption_changed');
  const contested=adoption(slotId).preview.candidates.find(c=>c.reference.kind==='missing'&&c.reference.rootRequestId===missingRef.rootRequestId);
  assert(contested.blockers.includes('claimed_elsewhere'));assert.equal(contested.claim.slotId,h.slot.id);
  assert.equal(exec(`select count(*) from public.merchant_attendance_plan_posthoc_claims where merchant_id=${site} and kind='missing' and source_id=${quote(missingRef.rootRequestId)};`),'1');
  const beforeRetry=all();assert.throws(()=>adopt(applyCommand(adoption(slotId),[revised.reference]),slotId),/attendance_plan_posthoc_adoption_blocked/);assert.equal(all(),beforeRetry);
  release();adopt(applyCommand(adoption(slotId),[revised.reference]),slotId);release(slotId);
  const restored=await prepareMissing(revised.reference,{startAt:move(h.slot.endAt,-10),endAt:move(h.slot.endAt,-5),breaks:[]});
  assert.equal((await missing(restored.query,restored.approve)).detail.status,'approved');reapply();assert(review().detail.current.eligible);
  assert.equal((await period(pq('detail','owner',periodId))).period.sealed,false);
  assert.deepEqual((await period(pq())).preview.artifact.report.totals,totals,'208_same_duration_declared_sources_do_not_change_total_minutes');
  assert.equal(exec('select '+factsSql(names,d.site,additions)+';'),protectedBefore,'208_all_preexisting_rows_preserved_except_exact_claim_and_period_projections');
  assert.equal(d.definitions(),defs);assert.equal(d.tableCatalog(),catalog);assert.equal(archive().artifactText,oldBytes.artifactText);assert.equal(archive().artifactSha256,oldBytes.artifactSha256);
  native.pass('208 six exact-PID races: leave/correction/missing versus174, both period-seal directions, adjacent-plan root contention; original history/archive preserved');
  return {races:raceResults,zeroWriteReads:reads,syntheticHistoryRows:6,actualPastPublication:false,actualPastApproval:false,
    syntheticHistory:{merchant_attendance_schedule_commands:{key:'operation_id',id:publication},merchant_attendance_schedule_slots:{key:'id',id:slotId},
      merchant_attendance_schedule_publication_evidence:{key:'operation_id',id:publication},merchant_attendance_plan_rule_artifacts:{key:'source_id',id:approval},
      merchant_attendance_plan_rule_operations:{key:'operation_id',id:approval},merchant_attendance_plan_rule_streams:{key:'slot_id',id:slotId}},
    actualCorrectionAndMissingAndLeave:true,actualPeriodSeal:true,explicitClaimRelease:true,originalRowsPreservedExceptExactMutableProjections:true,
    originalArchiveBytesPreserved:true,sameSelectedDuration:true,finalMainSourceEligible:true,finalPeriodSealed:false,callerOwnsRuntimeAndCleanup:true};
}
