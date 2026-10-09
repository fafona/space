//205 inert extension. The caller owns the existing synthetic schema/runtime and
//its final cleanup. Both new missing rows are created by actual103 services;
//there is no hand-written request/approval, policy bypass or simulated success.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';

const require=createRequire(import.meta.url),fmt='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
function preservedSql(names,requestId,approvalId){
  assert(names.length>0&&new Set(names).size===names.length);
  return '(select md5(jsonb_object_agg(name,rows order by name)::text) from ('+names.map(name=>{
    assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name)&&name.length<=63);
    const where=name==='merchant_attendance_missing_requests'?' where preserved_rows.request_id<>'+quote(requestId)
      :name==='merchant_attendance_missing_entries'?' where preserved_rows.operation_id not in('+[requestId,approvalId].map(quote).join(',')+')':'';
    return 'select '+quote(name)+" name,(select coalesce(jsonb_agg(to_jsonb(preserved_rows) order by to_jsonb(preserved_rows)::text),'[]') from public."+name+' preserved_rows'+where+') rows';
  }).join(' union all ')+') posthoc_changed_original_rows)';
}

export async function checkPosthocChangedNative({d,h,native,scope,evaluate,selected,next}){
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true&&h.syntheticHistoricalRows===10,'posthoc_changed_synthetic_context_required');
  assert.equal(typeof native?.query,'function');assert.equal(typeof scope?.sql,'function');assert.equal(typeof d.exec,'function');
  assert.equal(typeof d.guard,'string');assert.equal(typeof evaluate,'function');assert.equal(typeof next,'function');
  assert.match(scope.schema,/^attendance_race_[a-f0-9]{32}$/);
  const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
  assert.equal(h.workerId,d.otherWorker);assert.equal(h.employeeId,d.otherEmployee);assert.equal(h.employeeAuthUserId,d.otherAuth);
  assert.equal(h.slot.locationId,d.location);assert.equal(h.slot.timeZone,'UTC');
  assert(Array.isArray(selected)&&selected.length===2&&selected.some(r=>r.kind==='session'));
  const savedRef=selected.find(r=>r.kind==='missing');assert(savedRef);assert.equal(savedRef.requestId,id(204715));assert.equal(savedRef.rootRequestId,id(204715));
  const requestId=next(),approvalId=next();
  for(const value of [requestId,approvalId,d.owner,h.workerId,h.employeeId,h.employeeAuthUserId,d.location])assert.match(value,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(new Set([requestId,approvalId,savedRef.requestId,savedRef.approvalOperationId]).size,4);
  const exec=sql=>d.exec("reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard+sql);
  const names=d.inventory(),definitions=d.definitions(),catalog=d.tableCatalog(),all=()=>d.fingerprint(names);
  const preserve=preservedSql(names,requestId,approvalId),original=exec('select '+preserve+';');
  const counts=()=>JSON.parse(exec("select jsonb_build_object('requests',(select count(*) from public.merchant_attendance_missing_requests),'entries',(select count(*) from public.merchant_attendance_missing_entries));"));
  const beforeCounts=counts();
  exec(`do $posthoc_changed_guard$ begin
    assert current_user='postgres','posthoc_changed_owned_setup_required';
    assert not exists(select 1 from public.merchant_attendance_missing_requests where merchant_id=${quote(d.site)} and request_id=${quote(requestId)}),'posthoc_changed_fresh_request';
    assert not exists(select 1 from public.merchant_attendance_missing_entries where merchant_id=${quote(d.site)} and operation_id in(${quote(requestId)},${quote(approvalId)})),'posthoc_changed_fresh_operations';
    assert exists(select 1 from public.merchant_attendance_missing_current_v1 where merchant_id=${quote(d.site)} and request_id=${quote(savedRef.requestId)} and worker_id=${quote(h.workerId)} and employee_id=${quote(h.employeeId)} and actor_auth_user_id=${quote(h.employeeAuthUserId)}),'posthoc_changed_actual_current_parent';
    assert not exists(select 1 from pg_trigger where tgrelid in('public.merchant_attendance_missing_requests'::regclass,'public.merchant_attendance_missing_entries'::regclass) and tgenabled<>'O'),'posthoc_changed_triggers_enabled';
    assert not exists(select 1 from pg_constraint where conrelid in('public.merchant_attendance_missing_requests'::regclass,'public.merchant_attendance_missing_entries'::regclass) and not convalidated),'posthoc_changed_constraints_enabled';
  end;$posthoc_changed_guard$;`);
  const timing=JSON.parse(exec(`select jsonb_build_object('today',(clock_timestamp() at time zone 'UTC')::date,
    'startAt',to_char((${quote(h.slot.endAt)}::timestamptz+interval '5 minutes') at time zone 'UTC',${quote(fmt)}),
    'endAt',to_char((${quote(h.slot.endAt)}::timestamptz+interval '10 minutes') at time zone 'UTC',${quote(fmt)}),
    'past',${quote(h.slot.endAt)}::timestamptz+interval '10 minutes'<clock_timestamp());`));
  assert.equal(timing.past,true,'posthoc_changed_proposal_must_already_be_past');
  for(const key of ['startAt','endAt'])assert.match(timing[key],/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
  assert(Date.parse(timing.startAt)>Date.parse(h.slot.endAt));assert.equal(Date.parse(timing.endAt)-Date.parse(timing.startAt),300000);
  let readCount=0,writeCount=0;
  const checkedEvaluation=async()=>{const before=all(),result=await evaluate();assert.equal(all(),before,'posthoc_changed_evaluation_zero_writes');readCount++;return result;};
  const initial=await checkedEvaluation();assert.equal(initial.state,'required',JSON.stringify(initial.blockers));
  assert.equal(initial.source.posthoc.current.action,'apply');assert.deepEqual(initial.source.posthoc.current.sources,selected);
  const originalPosthoc=initial.source.posthoc,originalApproval=initial.source.approval;
  const originalSnapshot=originalPosthoc.selected.find(c=>c.reference.kind==='missing');assert(originalSnapshot);assert.deepEqual(originalSnapshot.reference,savedRef);
  assert.equal(Date.parse(originalSnapshot.selected.endAt)-Date.parse(originalSnapshot.selected.startAt),300000,'same five-minute selected duration');
  const {executeAttendanceMissing}=require('../../src/lib/merchantAttendanceMissing.server.ts');
  const service={rpc:async(name,args)=>{
    assert.equal(name,'faolla_attendance_missing_v1');assert.equal(args.p_allow_write,true);
    try{return {data:JSON.parse(exec(`set local role service_role;select public.faolla_attendance_missing_v1(${json(args.p_query)},${quote(args.p_auth_user_id)},${json(args.p_command)},true);`)),error:null};}
    catch(error){const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}
  }};
  const query=(access,request=null)=>({siteId:d.site,access,fromDate:timing.today,throughDate:timing.today,requestId:request,operationId:null,beforeAt:null,beforeId:null});
  const call=(q,c=null)=>executeAttendanceMissing({query:q,command:c,authUserId:q.access==='owner'?d.owner:h.employeeAuthUserId,allowWrite:true},service);
  const read=async q=>{const before=all(),result=await call(q);assert.equal(all(),before,'posthoc_changed_missing_read_zero_writes');readCount++;return result;};
  const home=await read(query('self',savedRef.requestId));
  assert(home.canRequest&&home.workerId===h.workerId&&home.employeeId===h.employeeId&&home.locationId===d.location&&home.timeZone==='UTC');
  assert(home.policyRevision>0&&home.detail.lineage.canRevise,'existing configured policy/current parent must allow actual revision');
  assert.equal(home.detail.lineage.currentRequestId,savedRef.requestId);assert.equal(home.detail.lineage.currentApprovalOperationId,savedRef.approvalOperationId);
  const revise={action:'revise',operationId:requestId,reason:'Synthetic205 actual missing revision moves outside the selected plan',
    expectedWorkerId:h.workerId,expectedSettingsVersion:home.settingsVersion,expectedPolicyRevision:home.policyRevision,locationId:d.location,timeZone:'UTC',
    proposal:{startAt:timing.startAt,endAt:timing.endAt,breaks:[]},supersedesRequestId:savedRef.requestId,expectedApprovalOperationId:savedRef.approvalOperationId};
  const submitted=await call(query('self'),revise);writeCount++;
  assert.deepEqual(submitted.receipt.command,revise);assert.equal(submitted.detail.status,'submitted');assert.equal(submitted.detail.lineage.rootRequestId,savedRef.rootRequestId);
  const pending=await checkedEvaluation();assert.equal(pending.state,'blocked');
  assert.deepEqual(pending.source.posthoc,originalPosthoc,'pending revision cannot change saved adoption snapshot');
  assert(pending.source.resolutionBlockers.includes('source_unavailable'));assert(pending.blockers.includes('pending_missing'));
  const pendingObservation=pending.source.observations.find(o=>o.reference.kind==='missing');assert(pendingObservation);
  assert.deepEqual(pendingObservation.reference,savedRef);assert.deepEqual(pendingObservation.current.reference,savedRef);
  assert(pendingObservation.current.blockers.includes('pending_missing'));assert.equal(pendingObservation.current.available,false);
  assert(!pending.source.basis.context.missing.items.some(m=>m.requestId===requestId),'moved-out pending is absent from old interval context');
  const review=await read(query('owner',requestId));assert.equal(review.detail.status,'submitted');
  assert(review.detail.canApprove,'real103 must approve without weakening old guards: '+JSON.stringify(review.detail.issues));assert.deepEqual(review.detail.issues,[]);
  const approve={action:'approve',operationId:approvalId,requestId,expectedRevision:1,evidenceToken:review.detail.evidenceToken,
    reason:'Synthetic205 actual owner approves replacement, no automatic post-hoc adoption'};
  const approved=await call(query('owner',requestId),approve);writeCount++;
  assert.deepEqual(approved.receipt.command,approve);assert.equal(approved.detail.status,'approved');
  const self=await read(query('self',requestId));assert.equal(self.detail.lineage.currentRequestId,requestId);assert.equal(self.detail.lineage.currentApprovalOperationId,approvalId);
  const changed=await checkedEvaluation();assert.equal(changed.state,'blocked');
  assert(changed.source.resolutionBlockers.includes('source_changed'));assert(changed.blockers.includes('source_changed'));
  assert.deepEqual(changed.source.posthoc,originalPosthoc,'approved replacement cannot rewrite or silently reapply saved source');
  assert.deepEqual(changed.source.approval,originalApproval,'fixed140 remains the saved reference');
  const observed=changed.source.observations.find(o=>o.reference.kind==='missing');assert(observed);assert.deepEqual(observed.reference,savedRef);
  assert.deepEqual(observed.current.reference,{kind:'missing',requestId,rootRequestId:savedRef.rootRequestId,approvalOperationId:approvalId});
  assert.deepEqual(observed.current.selected,{startAt:timing.startAt,endAt:timing.endAt});assert.equal(observed.current.original,null);
  assert(observed.blockers.includes('source_changed'));assert(observed.current.blockers.includes('source_outside_plan'));assert.equal(observed.current.available,false);
  assert(changed.blockers.includes('session_outside_plan')||changed.blockers.includes('source_outside_plan'));
  assert(!changed.source.basis.context.missing.items.some(m=>m.requestId===requestId),'current point read must not be limited to old plan context');
  assert.notEqual(changed.fingerprint,pending.fingerprint);assert.notEqual(pending.fingerprint,initial.fingerprint);
  assert.equal(exec('select '+preserve+';'),original,'only exact real103 new request/entries may change');
  const afterCounts=counts();assert.equal(afterCounts.requests,beforeCounts.requests+1);assert.equal(afterCounts.entries,beforeCounts.entries+2);
  assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  native.pass('205 actual103 moved-out missing revision: pending remains blocked; latest approval is observed but saved adoption/fixed140 stay unchanged; exact new-row write set');
  return {actualRevisionCommands:writeCount,zeroWriteReads:readCount,pendingMovedOutBlocked:true,approvedReplacementObserved:true,
    savedAdoptionUnchanged:true,fixed140Unchanged:true,originalFactsPreservedExceptExactNewMissingRows:true,sameFiveMinuteDuration:true,
    callerOwnsRuntimeAndCleanup:true,syntheticContextOnly:true};
}
