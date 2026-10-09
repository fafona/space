//181 boundary witness only. Caller owns the existing synthetic PG/schema.
//Past events and unverified133 identity bindings below are constrained synthetic
//history, NOT actual past clock RPCs. Approvals/revisions/scope grants use the
//real existing writers. Each small scenario rolls back; no original h row changes.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';

const require=createRequire(import.meta.url);
const fid=n=>id(181100000+n);
const ownPrefix='00000000-0000-4000-8000-0001811';
const lines=value=>value.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
const dayOffset=(day,n)=>new Date(Date.parse(day+'T00:00:00.000Z')+n*86400000).toISOString().slice(0,10);
const at=(day,time)=>day+'T'+time+':00.000000Z';
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
const withoutObservation=raw=>{const copy=structuredClone(raw);delete copy.base.asOf;return copy;};
function fingerprint(names,oldOnly=false){
  assert(names.length&&new Set(names).size===names.length);
  return '(select md5(jsonb_object_agg(name,rows order by name)::text) from ('+names.map(name=>{
    assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name));
    return `select ${quote(name)} name,(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]') from public.${name} r${oldOnly?` where position(${quote(ownPrefix)} in to_jsonb(r)::text)=0`:''}) rows`;
  }).join(' union all ')+') session_boundary_rows)';
}

export async function verifyPeriodSessionBoundariesNative({d,native,scope,h}){
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true&&h.syntheticHistoricalRows===10);
  assert.equal(typeof native?.querySteps,'function');assert.equal(typeof d?.tableCatalog,'function');
  const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));
  assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);assert.equal(h.slot.timeZone,'UTC');
  assert.equal(h.workerId,d.otherWorker);assert.equal(h.employeeId,d.otherEmployee);assert.equal(h.employeeAuthUserId,d.otherAuth);
  const {projectPeriodClosureSource}=require('../../src/lib/merchantAttendancePeriodClosure.server.ts');
  const {parseUnifiedSource}=require('../../src/lib/merchantAttendanceUnifiedTimesheet.ts');
  const baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog(),names=d.inventory();
  const allHash=fingerprint(names),oldHash=fingerprint(names,true);
  const site=quote(d.site),owner=quote(d.owner),workerId=fid(1),employeeId=fid(2),authId=fid(3),roleId=fid(4);
  const worker=quote(workerId),employee=quote(employeeId),auth=quote(authId),location=quote(h.slot.locationId);
  const day=dayOffset(h.slot.workDate,-2),next=dayOffset(day,1),range={fromDate:day,throughDate:day};
  const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
  const initial=`do $boundary_initial$ begin
    assert exists(select 1 from public.faolla_schema_migrations where version=202610050153),'boundary_requires153';
    assert ${allHash}=${oldHash},'boundary_id_namespace_unused';
    assert (select time_zone from public.merchant_attendance_settings where merchant_id=${site})='UTC','boundary_saved_utc';
    assert ${quote(at(next,'12:00'))}::timestamptz<clock_timestamp(),'boundary_proposals_are_past';
    assert not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and t.tgenabled<>'O'),'boundary_guards_enabled';
  end;$boundary_initial$;`;
  const setup=`insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions)
    values(${quote(roleId)},${site},'Synthetic181 boundary self',array['enterprise.view','attendance.self.view','attendance.self.request']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status)
    values(${employee},${site},${auth},'synthetic181-boundary@example.test','Synthetic181 boundary worker',${quote(roleId)},'active');
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id)
    values(${worker},${site},${employee},'SYNTHETIC181-BOUNDARY','Synthetic181 boundary worker',${location});
    insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values(${site},${worker},'2000-01-01');`;
  const seed=(start,end,sequence=1,endEmployee=employeeId,endLocation=h.slot.locationId)=>{
    const startId=fid(100+sequence),operationId=fid(200+sequence);
    // Validate this complete seed, then restore deferred FK/constraint-trigger
    // timing for later actual writers in the SAME outer transaction.094 links
    // decision/effect only after both inserts; the final flush validates them.
    return `insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,break_paid,occurred_at,received_at,time_zone,actor_employee_id)
      values(${quote(startId)},${site},${worker},${location},${quote(operationId)},${sequence},'clock_in','web',null,${quote(start)},${quote(start)},'UTC',${employee})
      ${end===null?'':`,(${quote(fid(101+sequence))},${site},${worker},${quote(endLocation)},${quote(fid(201+sequence))},${sequence+1},'clock_out','web',null,${quote(end)},${quote(end)},'UTC',${quote(endEmployee)})`};
      insert into public.merchant_attendance_shift_rule_bindings(merchant_id,start_event_id,worker_id,operation_id,sequence,location_id,occurred_at,event_time_zone,
        channel,request_auth_user_id,employee_id,employee_auth_user_id,worker_version,settings_version,status,reason,source_id,algorithm_version,binding_policy,recorded_at)
      values(${site},${quote(startId)},${worker},${quote(operationId)},${sequence},${location},${quote(start)},'UTC','self',${auth},${employee},${auth},
        (select version from public.merchant_attendance_workers where merchant_id=${site} and id=${worker}),
        (select version from public.merchant_attendance_settings where merchant_id=${site}),'unverified','source_unavailable',null,
        'personal-group-enterprise-point-v1','clock-in-whole-shift-v1',${quote(start)});set constraints all immediate;set constraints all deferred;`;
  };
  const sourceQuery=(r,access)=>({siteId:d.site,access,workerId,...r});
  const reportQuery=(r,access)=>access==='owner'?{access,workerId,...r}:{access,workerId:null,locationId:null,expectedWorkerId:workerId,...r};
  const report=(r,access)=>`public.faolla_attendance_unified_report_v1(${site},${access==='owner'?owner:auth},${json(reportQuery(r,access))})`;
  const source=(r,access,who=access==='owner'?d.owner:authId)=>`public.faolla_attendance_period_source_v1(${json(sourceQuery(r,access))},${quote(who)})`;
  const read=(label,reader,access,r,expression)=>`${prefix}select jsonb_build_object('kind','before_read','hash',${allHash});set local role service_role;
    select jsonb_build_object('kind','read','label',${quote(label)},'reader',${quote(reader)},'access',${quote(access)},'range',${json(r)},'raw',${expression});
    ${prefix}select jsonb_build_object('kind','after_read','hash',${allHash});`;
  const successful=(label,r=range)=>['owner','self'].flatMap(access=>['report','source'].map(kind=>
    read(label,kind,access,r,kind==='report'?report(r,access):source(r,access))));
  const reject=(label,expression,error)=>`${prefix}select jsonb_build_object('kind','before_failure','hash',${allHash});set local role service_role;
    do $boundary_reject$ begin begin perform ${expression};raise exception 'boundary_expected_failure_missing';
      exception when raise_exception then if sqlerrm<>${quote(error)} then raise;end if;end;end;$boundary_reject$;
    ${prefix}select jsonb_build_object('kind','rejection','label',${quote(label)},'error',${quote(error)});
    select jsonb_build_object('kind','after_failure','hash',${allHash});`;
  const checks=[],sizes=[];let positiveReads=0,rejectedReads=0;
  async function scenario(label,steps,verify){
    const mark=kind=>prefix+`select jsonb_build_object('kind',${quote(kind)},'hash',${oldHash});`;
    const statements=['begin;'+prefix+initial+mark('old_before')+setup,...steps.map(s=>prefix+s),mark('old_after')+'set constraints all immediate;rollback;'];
    assert(statements.length<=24,'boundary_bounded_steps');let output;
    try{output=lines(await native.querySteps(statements.map(sql=>scope.sql(sql))));}
    catch(error){throw new Error('period_session_boundary_failed:'+label+':'+String(error?.message??error),{cause:error});}
    finally{
      assert.equal(d.fingerprint(),baseline,'boundary_rollback:'+label);assert.equal(d.definitions(),definitions,'boundary_definitions:'+label);
      assert.equal(d.tableCatalog(),catalog,'boundary_catalog:'+label);
    }
    assert.equal(output[0].kind,'old_before');assert.equal(output.at(-1).kind,'old_after');assert.equal(output[0].hash,output.at(-1).hash,'boundary_original_facts_untouched');
    for(let i=0;i<output.length;i++)if(['read','rejection'].includes(output[i].kind)){
      const success=output[i].kind==='read';assert.equal(output[i-1].kind,success?'before_read':'before_failure');assert.equal(output[i+1].kind,success?'after_read':'after_failure');
      assert.equal(output[i-1].hash,output[i+1].hash,'boundary_reader_or_failure_wrote_rows');if(success)positiveReads++;else rejectedReads++;
    }
    verify(output);checks.push(label);
  }
  function verifySuccess(output,label,{count=1,originalUs,selectedUs,open=false,correction=null,r=range}={}){
    const rows=output.filter(x=>x.kind==='read'&&x.label===label);assert.equal(rows.length,4);
    const grouped=Object.fromEntries(rows.map(x=>[x.access+x.reader,x.raw]));
    for(const access of ['owner','self']){
      const raw=grouped[access+'source'],direct=grouped[access+'report'];
      assert.equal(direct.complete,true);assert.equal(raw.complete,true);assert.deepEqual(direct.missing,[]);
      assert.equal(direct.base.items.length,count);assert.deepEqual(withoutObservation(raw.report),withoutObservation(direct));
      assert.equal(raw.employeeId,employeeId);assert.equal(raw.employeeAuthUserId,authId);assert.equal(raw.context.plans.sessions.length,count);
      assert.equal(hash(raw.sourceText),raw.sourceFingerprint);assert.deepEqual(JSON.parse(raw.sourceText),raw.sourceCanonical);
      const sourceBytes=Buffer.byteLength(raw.sourceText,'utf8'),rawBytes=Buffer.byteLength(JSON.stringify(raw),'utf8');assert(sourceBytes<=1048576&&rawBytes<=4194304);
      sizes.push({label,access,sourceBytes,rawBytes});
      const projected=projectPeriodClosureSource(raw,{...sourceQuery(r,access),mode:'preview',periodId:null,operationId:null,version:null});
      const computed=projected.artifact.report;
      assert.equal(computed.base.rows.length,count);assert.equal(computed.base.openSessionCount,open?1:0);
      assert.equal(computed.totals.original.workedUs,originalUs);assert.equal(computed.totals.selected.workedUs,selectedUs);
      assert.equal(projected.blockers.includes('open_session'),open);
      if(count){
        const item=direct.base.items[0],row=computed.base.rows[0];assert.equal(item.startEventId,fid(101));
        assert.equal(item.events[0].id,fid(101));assert.equal(item.events.length,open?1:2);
        assert.equal(row.original.endAt===null,open);assert.equal(row.selected.endAt===null,open);
        assert.equal(row.correction?.operationId??null,correction);
        if(correction)assert.equal(raw.context.plans.sessions[0].item.effect.operationId,correction);
      }
      for(const session of raw.context.plans.sessions){
        assert.equal(session.ruleBinding.status,'unverified');assert.equal(session.ruleBinding.reason,'source_unavailable');
        assert.equal(session.relation,null);assert.equal(session.adoption,null);assert.equal(session.planRuleApproval,null);
      }
    }
    assert.equal(grouped.ownersource.sourceFingerprint,grouped.selfsource.sourceFingerprint);
    assert.deepEqual(grouped.ownersource.sourceCanonical,grouped.selfsource.sourceCanonical);
  }
  await scenario('cross_boundary_preceding',[seed(at(dayOffset(day,-1),'23:00'),at(day,'01:00')),...successful('cross_boundary')],rows=>{
    verifySuccess(rows,'cross_boundary',{originalUs:3600000000,selectedUs:3600000000});
    for(const row of rows.filter(x=>x.kind==='read'))assert.equal((row.reader==='source'?row.raw.report:row.raw).base.items[0].events[0].occurredAt,at(dayOffset(day,-1),'23:00'));
  });
  await scenario('closed_exactly_at_period_start',[seed(at(dayOffset(day,-1),'22:00'),at(day,'00:00')),...successful('half_open_exclusion')],rows=>
    verifySuccess(rows,'half_open_exclusion',{count:0,originalUs:0,selectedUs:0}));
  await scenario('very_old_still_open',[seed(at(dayOffset(day,-45),'08:00'),null),...successful('old_open')],rows=>
    verifySuccess(rows,'old_open',{originalUs:0,selectedUs:0,open:true}));

  const perform=expression=>`do $boundary_rpc$ begin perform ${expression};end;$boundary_rpc$;`;
  const policy=fid(300),requestId=fid(301),approvalId=fid(302),revisionId=fid(303),revisionApproval=fid(304);
  const policyRevision=`(select revision from public.merchant_attendance_correction_controls where merchant_id=${site} and operation_id=${quote(policy)})`;
  //095 stores the submitted command unchanged;093 requires its proposal to
  //already equal082's canonical UTC6 JSON, not merely the same instant at UTC3.
  const proposal=(date)=>({startAt:at(date,'09:00'),endAt:at(date,'11:00'),breaks:[]});
  const cQuery=json({mode:'detail',expectedWorkerId:workerId,requestId,operationId:null});
  const policyStep=perform(`public.faolla_attendance_correction_controls_v2(${site},${owner},jsonb_build_object('action','set_policy','operationId',${quote(policy)},
    'expectedRevision',(select coalesce(max(revision),0) from public.merchant_attendance_correction_controls where merchant_id=${site}),
    'expectedSettingsVersion',(select version from public.merchant_attendance_settings where merchant_id=${site}),
    'reason','Synthetic181 isolated boundary policy','submissionWindowDays',365),null,null,true)`);
  const submit=perform(`public.faolla_attendance_correction_self_v3(${site},${auth},${cQuery},
    ${json({action:'submit',operationId:requestId,expectedRevision:0,reason:'Synthetic181 move original outside period',startEventId:fid(101),expectedLastEventId:fid(102),proposal:proposal(next)})}
      ||jsonb_build_object('expectedPolicyRevision',${policyRevision}),true)`);
  const approve=`do $boundary_approve$ declare r jsonb;begin
    r:=public.faolla_attendance_correction_decide_v2(${site},${owner},${quote(requestId)},null,null,true);
    if (r->>'canApprove')::boolean is distinct from true then raise exception 'boundary_correction_not_approvable:%',r->'blockers';end if;
    perform public.faolla_attendance_correction_decide_v2(${site},${owner},${quote(requestId)},jsonb_build_object('action','approve','operationId',${quote(approvalId)},
      'requestId',${quote(requestId)},'expectedRevision',(r->'review'->'item'->>'revision')::bigint,'expectedEvidence',r->>'evidenceToken','reason','Synthetic181 actual approval'),null,true);
  end;$boundary_approve$;`;
  const revQuery=(mode,request=null)=>json({mode,expectedWorkerId:workerId,baseRequestId:requestId,requestId:request,operationId:null});
  const revise=`do $boundary_revise$ declare r jsonb;c jsonb;begin
    r:=public.faolla_attendance_revision_self_v2(${site},${auth},${revQuery('prepare')},null,true);
    c:=jsonb_build_object('action','submit','operationId',${quote(revisionId)},'expectedRevision',(r->>'revision')::bigint,
      'expectedBaseOperationId',${quote(approvalId)},'expectedEffectiveOperationId',r->'current'->>'operationId','expectedPolicyRevision',${policyRevision},
      'reason','Synthetic181 restore current selection inside','proposal',${json(proposal(day))});
    assert public.faolla_attendance_correction_proposal_v1(c->'proposal',clock_timestamp())=c->'proposal','boundary_revision_proposal_not_canonical';
    perform public.faolla_attendance_revision_self_v2(${site},${auth},${revQuery('detail',revisionId)},c,true);
  end;$boundary_revise$;`;
  const approveRevision=`do $boundary_revision_approve$ declare r jsonb;begin
    r:=public.faolla_attendance_revision_decide_v2(${site},${owner},${quote(revisionId)},null,null,true);
    if (r->>'canApprove')::boolean is distinct from true then raise exception 'boundary_revision_not_approvable:%',r->'blockers';end if;
    -- The decision wraps revision_owner_review_v3: its review is one level
    -- deeper than the ordinary correction decision, not r.review.item.
    assert jsonb_typeof(r->'review'->'submittedRevision')='number'
      and r->'review'->'submittedRevision'=r->'review'->'review'->'item'->'revision','boundary_revision_preflight_shape';
    perform public.faolla_attendance_revision_decide_v2(${site},${owner},${quote(revisionId)},jsonb_build_object('action','approve','operationId',${quote(revisionApproval)},
      'requestId',${quote(revisionId)},'expectedRevision',(r->'review'->>'submittedRevision')::bigint,'expectedEvidence',r->>'evidenceToken',
      'expectedBaseOperationId',r->'current'->>'operationId','reason','Synthetic181 actual latest revision'),null,true);
  end;$boundary_revision_approve$;`;
  const nextRange={fromDate:next,throughDate:next};
  await scenario('actual_approved_movement_and_latest_revision',[
    seed(at(day,'08:00'),at(day,'10:00')),policyStep,submit,approve,
    ...successful('original_inside_current_outside'),...successful('original_outside_current_inside',nextRange),
    revise,approveRevision,...successful('latest_revision_inside'),...successful('superseded_effect_ignored',nextRange),
  ],rows=>{
    verifySuccess(rows,'original_inside_current_outside',{originalUs:7200000000,selectedUs:0,correction:approvalId});
    verifySuccess(rows,'original_outside_current_inside',{originalUs:0,selectedUs:7200000000,correction:approvalId,r:nextRange});
    verifySuccess(rows,'latest_revision_inside',{originalUs:7200000000,selectedUs:7200000000,correction:revisionApproval});
    verifySuccess(rows,'superseded_effect_ignored',{count:0,originalUs:0,selectedUs:0,r:nextRange});
    for(const row of rows.filter(x=>x.kind==='read'&&x.label==='latest_revision_inside')){
      const effect=(row.reader==='source'?row.raw.report:row.raw).base.items[0].effect;
      assert.equal(effect.revision,2);assert.equal(effect.lineage.rootOperationId,approvalId);assert.equal(effect.lineage.previousOperationId,approvalId);
    }
  });
  const otherEmployee=fid(10),otherAuth=fid(11);
  await scenario('mixed_historical_employee_fails_closed',[
    `insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status)
      values(${quote(otherEmployee)},${site},${quote(otherAuth)},'synthetic181-other@example.test','Synthetic181 other employee',${quote(roleId)},'active');`,
    seed(at(day,'08:00'),at(day,'10:00'),1,otherEmployee),
    read('mixed_self_filtered','report','self',range,report(range,'self')),
    ...['owner','self'].map(access=>reject('mixed_'+access,source(range,access),'attendance_period_source_identity_changed')),
  ],rows=>{assert.equal(rows.find(x=>x.kind==='read').raw.base.items.length,0);assert.equal(rows.filter(x=>x.kind==='rejection').length,2);});
  await scenario('changed_auth_does_not_reassign_history',[
    seed(at(day,'08:00'),at(day,'10:00')),
    `update public.merchant_enterprise_employees set auth_user_id=${quote(otherAuth)} where merchant_id=${site} and id=${employee};`,
    reject('rebound_owner',source(range,'owner'),'attendance_period_source_identity_changed'),
    reject('rebound_self',source(range,'self',otherAuth),'attendance_period_source_identity_changed'),
    reject('prior_auth',source(range,'self',authId),'attendance_access_denied'),
  ],rows=>assert.equal(rows.filter(x=>x.kind==='rejection').length,3));

  const manager=fid(20),managerAuth=fid(21),managerRole=fid(22),otherLocation=fid(23),grant=fid(24);
  const managerQuery={access:'manager',workerId,locationId:h.slot.locationId,expectedWorkerId:null,...range};
  const managerReport=q=>`public.faolla_attendance_unified_report_v1(${site},${quote(managerAuth)},${json(q)})`;
  const managerSetup=`insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions)
    values(${quote(managerRole)},${site},'Synthetic181 boundary manager',array['enterprise.view','attendance.records.view']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status)
    values(${quote(manager)},${site},${quote(managerAuth)},'synthetic181-manager@example.test','Synthetic181 manager',${quote(managerRole)},'active');
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone) values(${quote(otherLocation)},${site},'Synthetic181 outside scope','UTC');`;
  const scopePut=perform(`public.faolla_attendance_scopes_v1(${site},${owner},${quote(manager)},${json({action:'put',operationId:fid(25),expectedRevision:0,grantId:grant,
    grant:{workerIds:[workerId],locationIds:[h.slot.locationId],validFrom:'2000-01-01T00:00:00.000Z',validUntil:null}})},null)`);
  await scenario('manager_complete_location_and_live_grant',[
    managerSetup,seed(at(day,'08:00'),at(day,'09:00')),seed(at(day,'10:00'),at(day,'11:00'),3,employeeId,otherLocation),scopePut,
    read('manager_complete_only','report','manager',range,managerReport(managerQuery)),
    reject('manager_ungranted_location',managerReport({...managerQuery,locationId:otherLocation}),'attendance_access_denied'),
    `update public.merchant_attendance_scope_grants set valid_until=clock_timestamp()-interval '1 second' where merchant_id=${site} and employee_id=${quote(manager)} and id=${quote(grant)};`,
    reject('manager_expired_grant',managerReport(managerQuery),'attendance_access_denied'),
    `update public.merchant_attendance_scope_grants set valid_from=clock_timestamp()+interval '1 day',valid_until=null where merchant_id=${site} and employee_id=${quote(manager)} and id=${quote(grant)};`,
    reject('manager_future_grant',managerReport(managerQuery),'attendance_access_denied'),
  ],rows=>{
    const raw=rows.find(x=>x.kind==='read').raw,parsed=parseUnifiedSource(raw,{...managerQuery,siteId:d.site});
    assert.equal(raw.base.coverage,'authorized-complete-sessions-v1');assert.deepEqual(raw.base.items.map(x=>x.startEventId),[fid(101)]);
    assert.equal(parsed.totals.selected.workedUs,3600000000);assert(!JSON.stringify(raw).includes(fid(103)));assert(!JSON.stringify(raw).includes(otherLocation));
    assert.equal(rows.filter(x=>x.kind==='rejection').length,3);
  });
  assert.equal(checks.length,7);assert.equal(positiveReads,30);assert.equal(rejectedReads,8);
  return {checks,outerRollbackTransactions:checks.length,positiveReads,expectedRejectedReads:rejectedReads,sourceSizes:sizes,
    actualCorrectionApprovals:1,actualRevisionApprovals:1,actualScopePuts:1,actualClockRpcs:0,
    syntheticHistoryAndIdentityBindings:true,ownerSelfCanonicalEqual:true,allReadsAndFailuresZeroWrites:true,
    allOriginalFactsUntouched:true,allFactsDefinitionsCatalogRestored:true,
    noncoverage:['No historical clock authenticity claim','No new DST/date policy','No new limits or widened manager permissions','No production data or runtime ownership']};
}
