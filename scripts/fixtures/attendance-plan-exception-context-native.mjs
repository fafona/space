//174 inert, caller-owned rollback probes. Calendar/leave/correction facts below
//are made by their actual RPCs against the explicitly synthetic historical h.
//No past publication, real employee login or actual historical clock is claimed.
import assert from 'node:assert/strict';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';

function fingerprintRowsSql(names){
  assert(names.length>0&&new Set(names).size===names.length);
  return names.map(name=>{
    assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name)&&name.length<=63);
    return 'select '+quote(name)+" name,(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]') from public."+name+' r) rows';
  }).join(' union all ');
}
function fingerprintSql(names){return '(select md5(jsonb_object_agg(name,rows order by name)::text) from ('+fingerprintRowsSql(names)+') context_probe_rows)';}
// Failure diagnostics contain only table names, counts and hashes, never row
// values/reasons/source bodies. Use exactly the same overall hash as above.
function fingerprintDetailsSql(names){
  return "(select jsonb_build_object('fingerprint',md5(jsonb_object_agg(name,rows order by name)::text),"+
    "'tables',jsonb_object_agg(name,jsonb_build_object('count',jsonb_array_length(rows),'hash',md5(rows::text)) order by name),"+
    "'session',jsonb_build_object('role',current_user,'timeZone',current_setting('TimeZone'),'dateStyle',current_setting('DateStyle'))) from ("+
    fingerprintRowsSql(names)+') context_probe_rows)';
}
function assertFingerprints(before,after,label){
  assert.deepEqual(after.session,before.session,label+':fingerprint_session_changed');
  const changed=[...new Set([...Object.keys(before.tables),...Object.keys(after.tables)])].sort()
    .filter(name=>JSON.stringify(before.tables[name])!==JSON.stringify(after.tables[name]))
    .map(name=>({table:name,before:before.tables[name]??null,after:after.tables[name]??null}));
  assert.equal(after.fingerprint,before.fingerprint,label+':protected_table_changes:'+JSON.stringify(changed));
  assert.equal(changed.length,0,label+':per_table_hash_disagreement');
}
const lines=output=>output.trim()?output.trim().split(/\r?\n/).map(line=>JSON.parse(line)):[];
const stamp6=value=>{assert.match(value,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);return value.replace(/Z$/,'000Z');};
const plusMinutes=(value,minutes)=>stamp6(new Date(Date.parse(value)+minutes*60000).toISOString());
const perform=expression=>'do $actual_rpc$ begin perform '+expression+';end;$actual_rpc$;';

export async function verifyPlanExceptionContextNative({d,native,scope,h,project}){
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true&&h.syntheticHistoricalRows===10);
  assert(typeof project==='function'&&typeof native?.querySteps==='function'&&typeof scope?.sql==='function');
  const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));
  assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
  assert.match(scope.schema,/^attendance_race_[a-f0-9]{32}$/);
  assert.deepEqual(h.query,{siteId:d.site,workerId:d.otherWorker,slotId:h.slot.id});
  assert.equal(h.employeeId,d.otherEmployee);assert.equal(h.employeeAuthUserId,d.otherAuth);assert.equal(h.slot.timeZone,'UTC');
  assert.equal(h.sourceRaw.eligible,true);assert.deepEqual(h.sourceRaw.blockers,[]);
  const names=d.inventory(),allFingerprint=fingerprintSql(names),baseline=d.fingerprint(),defs=d.definitions(),catalog=d.tableCatalog();
  const site=quote(d.site),owner=quote(d.owner),auth=quote(h.employeeAuthUserId),worker=quote(h.workerId),employee=quote(h.employeeId);
  const sourceCall='public.faolla_attendance_plan_exception_source_v1('+json(h.query)+','+owner+')';
  // Normalize only local serialization, not the clock or writer validation.
  // Different psql connections must not hash different timestamptz renderings.
  const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
  const checkExisting=`do $context_guard$ begin
    assert exists(select 1 from public.merchant_attendance_workers w join public.merchant_enterprise_employees e on e.merchant_id=w.merchant_id and e.id=w.employee_id
      where w.merchant_id=${site} and w.id=${worker} and e.id=${employee} and e.auth_user_id=${auth} and w.active and e.status='active'),'context_current_identity_required';
    assert not exists(select 1 from public.merchant_attendance_correction_entries where merchant_id=${site} and start_event_id=${quote(h.startEventId)}),'context_initial_correction_must_be_empty';
    assert not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and t.tgenabled<>'O'),'context_triggers_must_remain_enabled';
  end;$context_guard$;`;
  const readStep=label=>prefix+`select jsonb_build_object('kind','before','label',${quote(label)},'fingerprint',${allFingerprint});
    set local role service_role;select jsonb_build_object('kind','source','label',${quote(label)},'raw',${sourceCall});
    ${prefix}select jsonb_build_object('kind','after','label',${quote(label)},'fingerprint',${allFingerprint});`;
  let sourceReads=0,scenarios=0;
  const run=async({label,steps,writes,verify})=>{
    assert.match(label,/^[a-z_]+$/);
    const protectedNames=names.filter(name=>!writes.includes(name));
    for(const name of writes)assert(names.includes(name),label+':context_table_missing:'+name);
    const protectedFingerprint=fingerprintDetailsSql(protectedNames);
    const protectedBefore=JSON.parse(d.exec(prefix+'select '+protectedFingerprint+';'));
    const stamp=kind=>prefix+`select jsonb_build_object('kind',${quote(kind)},'label',${quote(label)},'details',${protectedFingerprint});`;
    const finalStep=stamp('protected_after')+'rollback;';
    const statements=['begin;'+prefix+checkExisting+stamp('protected_before'),...steps,finalStep];
    assert(statements.length<=16);
    let output;
    try{output=lines(await native.querySteps(statements.map(step=>scope.sql(step))));}
    catch(error){throw new Error('context_scenario_sql_failed:'+label+':'+String(error?.message??error),{cause:error});}
    finally{
      // querySteps closes its one owned session even on a statement failure,
      // rolling back its still-open transaction. No timeout is relaxed here.
      assert.equal(d.fingerprint(),baseline,label+':context_probe_did_not_roll_back');
      assert.equal(d.definitions(),defs,label+':context_probe_changed_function_definitions');
      assert.equal(d.tableCatalog(),catalog,label+':context_probe_changed_constraints_or_triggers');
    }
    const transactionBefore=output.shift(),protectedResult=output.pop();
    assert.equal(transactionBefore.kind,'protected_before',label);assert.equal(transactionBefore.label,label);
    assert.equal(protectedResult.kind,'protected_after',label);assert.equal(protectedResult.label,label);
    assertFingerprints(protectedBefore,transactionBefore.details,label+':external_vs_transaction_start');
    assertFingerprints(transactionBefore.details,protectedResult.details,label+':transaction_writes');
    assert.equal(output.length%3,0,label+':output_triplets');const projected=[];
    for(let i=0;i<output.length;i+=3){
      const [before,row,after]=output.slice(i,i+3);
      assert.equal(before.kind,'before');assert.equal(row.kind,'source');assert.equal(after.kind,'after');
      assert.equal(before.label,row.label);assert.equal(after.label,row.label);assert.equal(before.fingerprint,after.fingerprint,label+':'+row.label+':context_source_read_wrote_rows');
      let view;try{view=await project(row.raw,h.query,d.owner);}catch(error){throw new Error('context_projection_failed:'+label+':'+row.label+':'+String(error?.message??error),{cause:error});}
      assert.equal(view.worker.workerId,h.workerId);assert.equal(view.slot.id,h.slot.id);
      assert.deepEqual(view.candidate.original,h.sourceRaw.candidate.original,'context_read_changed_original_edges');
      assert.deepEqual(view.source.approval,h.sourceRaw.source.approval,'context_read_changed_fixed_plan_approval');
      assert.notEqual(view.fingerprint,h.sourceRaw.fingerprint,'context_change_missing_from_source_fingerprint');
      projected.push({label:row.label,view});sourceReads++;
    }
    try{await verify(projected);}catch(error){throw new Error('context_scenario_verification_failed:'+label+':'+String(error?.message??error),{cause:error});}scenarios++;
  };
  // Synthetic authorization setup is scoped to h's current role and rolled
  // back, not a production role grant. No source/event/rule row is edited.
  const permission=needed=>prefix+`update public.merchant_enterprise_roles r set permissions=array_append(r.permissions,${quote(needed)})
    where r.merchant_id=${site} and r.id=(select e.role_id from public.merchant_enterprise_employees e where e.merchant_id=${site} and e.id=${employee})
      and not(${quote(needed)}=any(r.permissions));`;
  const blocked=(view,reason)=>{
    assert.equal(view.eligible,false);assert.deepEqual(view.blockers,[reason]);
    for(const key of ['late','early'])assert.deepEqual(view.candidate[key],{state:'blocked',minutes:null,rawDeltaUs:null,excessUs:null});
  };
  const settingsVersion=`(select s.version from public.merchant_attendance_settings s where s.merchant_id=${site})`;
  const locationVersion=`(select l.version from public.merchant_attendance_locations l where l.merchant_id=${site} and l.id=${quote(h.slot.locationId)})`;
  const calendarQuery={siteId:d.site,locationId:h.slot.locationId,fromDate:null,throughDate:null,entryId:null,operationId:null,beforeAt:null,beforeId:null};
  const calendarCommand={operationId:id(174800),action:'create',reason:'Synthetic174 rollback calendar conflict',kind:'closure',title:'Synthetic rollback closure',
    fromDate:h.slot.workDate,throughDate:h.slot.workDate,expectedSettingsVersion:1,locationId:h.slot.locationId,expectedLocationVersion:1,timeZone:'UTC'};
  await run({label:'calendar_entry',writes:['merchant_attendance_calendar_entries','merchant_attendance_calendar_operations'],steps:[
    prefix+'set local role service_role;'+perform('public.faolla_attendance_calendar_v1('+json(calendarQuery)+','+owner+','+json(calendarCommand)+
      "||jsonb_build_object('expectedSettingsVersion',"+settingsVersion+",'expectedLocationVersion',"+locationVersion+'),true)'),
    readStep('calendar_entry'),
  ],verify:([{view}])=>{
    blocked(view,'calendar_entry');assert.equal(view.source.context.calendar.items.length,1);
    assert.equal(view.source.context.calendar.items[0].entryId,id(174800));assert.equal(view.source.context.calendar.items[0].status,'created');
  }});

  const leaveQuery=(access='self',requestId=null)=>({siteId:d.site,access,requestId,operationId:null,beforeAt:null,beforeId:null});
  const leaveSubmit=n=>({operationId:id(n),action:'submit',reason:'Synthetic174 rollback historical leave',expectedWorkerId:h.workerId,
    expectedSettingsVersion:1,timeZone:'UTC',startAt:h.slot.startAt,endAt:h.slot.endAt});
  const submitStep=n=>prefix+'set local role service_role;'+perform('public.faolla_attendance_leave_v1('+json(leaveQuery())+','+auth+','+
    json(leaveSubmit(n))+"||jsonb_build_object('expectedSettingsVersion',"+settingsVersion+'),true)');
  const leaveWrites=['merchant_enterprise_roles','merchant_attendance_leave_requests','merchant_attendance_leave_entries'];
  await run({label:'leave_pending',writes:leaveWrites,steps:[permission('attendance.self.leave'),submitStep(174801),readStep('leave_pending')],verify:([{view}])=>{
    blocked(view,'leave_pending');assert.equal(view.source.context.leave.items.length,1);
    assert.equal(view.source.context.leave.items[0].requestId,id(174801));assert.equal(view.source.context.leave.items[0].status,'submitted');
  }});
  const approveLeave={operationId:id(174803),action:'approve',reason:'Synthetic174 rollback owner leave approval',requestId:id(174802),expectedRevision:1};
  await run({label:'leave_approved',writes:leaveWrites,steps:[permission('attendance.self.leave'),submitStep(174802),
    prefix+'set local role service_role;'+perform('public.faolla_attendance_leave_v1('+json(leaveQuery('owner',id(174802)))+','+owner+','+json(approveLeave)+',true)'),
    readStep('leave_approved'),
  ],verify:([{view}])=>{
    blocked(view,'leave_approved');assert.equal(view.source.context.leave.items.length,1);
    assert.equal(view.source.context.leave.items[0].operationId,id(174803));assert.equal(view.source.context.leave.items[0].status,'approved');
  }});

  const rootRequest=id(174805),rootApproval=id(174806),revisionRequest=id(174807),revisionApproval=id(174808);
  const firstProposal={startAt:plusMinutes(h.slot.startAt,10),endAt:plusMinutes(h.slot.endAt,-20),breaks:[]};
  const finalProposal={startAt:stamp6(h.slot.startAt),endAt:stamp6(h.slot.endAt),breaks:[]};
  const policyRevision=`(select c.revision from public.merchant_attendance_correction_controls c where c.merchant_id=${site} and c.operation_id=${quote(id(174804))})`;
  const initialCommand={action:'submit',operationId:rootRequest,expectedRevision:0,expectedPolicyRevision:1,
    reason:'Synthetic174 real correction against synthetic original',startEventId:h.startEventId,expectedLastEventId:h.lastEventId,proposal:firstProposal};
  //086 self_v3 ->085 self_v2 appends this policy binding on the initial
  //submission (not133/134 clock-rule binding, and not the095 revision). Permit
  //exactly that one new root-request row and independently protect every old
  //row in this table; the broad scenario write list alone is insufficient.
  const bindingTable='merchant_attendance_correction_rule_bindings';
  const bindingBefore=JSON.parse(d.exec(prefix+`select jsonb_build_object('count',count(*),
    'hash',md5(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]')::text),
    'targetExists',coalesce(bool_or(r.merchant_id=${site} and r.request_id=${quote(rootRequest)}),false)) from public.${bindingTable} r;`));
  assert.equal(bindingBefore.targetExists,false,'latest_approved_correction:policy_binding_target_must_be_new');
  assert(Number.isSafeInteger(bindingBefore.count)&&bindingBefore.count>=0);assert.match(bindingBefore.hash,/^[a-f0-9]{32}$/);
  const verifyPolicyBinding=prefix+`do $context_policy_binding$ begin
    assert (select count(*) from public.${bindingTable})=${bindingBefore.count+1},'context_exactly_one_new_correction_rule_binding_required';
    assert (select md5(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]')::text) from public.${bindingTable} r
      where not(r.merchant_id=${site} and r.request_id=${quote(rootRequest)}))=${quote(bindingBefore.hash)},'context_existing_correction_rule_bindings_changed';
    assert exists(select 1 from public.${bindingTable} b
      join public.merchant_attendance_correction_entries e on e.merchant_id=b.merchant_id and e.operation_id=b.request_id
      join public.merchant_attendance_correction_controls p on p.merchant_id=b.merchant_id and p.revision=b.policy_revision
      join public.merchant_attendance_correction_decisions a on a.merchant_id=e.merchant_id and a.request_id=e.request_id
      where b.merchant_id=${site} and b.request_id=${quote(rootRequest)} and e.request_id=b.request_id
        and e.worker_id=${worker} and e.employee_id=${employee} and e.actor_auth_user_id=${auth}
        and e.start_event_id=${quote(h.startEventId)} and e.action='submit' and e.revision=1
        and e.basis->'events'->-1->>'id'=${quote(h.lastEventId)} and b.recorded_at=e.recorded_at
        and p.operation_id=${quote(id(174804))} and p.action='set_policy' and p.payload->'submissionWindowDays'='365'::jsonb
        and b.policy_revision=${policyRevision}
        and b.command=(${json(initialCommand)}||jsonb_build_object('expectedPolicyRevision',b.policy_revision))
        and e.command=(b.command-'expectedPolicyRevision') and a.operation_id=${quote(rootApproval)} and a.action='approve'),
      'context_correction_rule_binding_must_match_exact_history_request_policy_and_approval';
  end;$context_policy_binding$;`;
  const correctionWrites=['merchant_enterprise_roles','merchant_attendance_correction_controls','merchant_attendance_correction_entries',
    'merchant_attendance_correction_decisions','merchant_attendance_correction_effects','merchant_attendance_revision_requests',
    'merchant_attendance_revision_decisions','merchant_attendance_effect_versions',bindingTable];
  await run({label:'latest_approved_correction',writes:correctionWrites,steps:[permission('attendance.self.request'),
    // Building the CAS command reads the private control ledger under the
    // owned fixture role. The write itself is still the original public RPC.
    prefix+perform(`public.faolla_attendance_correction_controls_v2(${site},${owner},jsonb_build_object(
      'action','set_policy','operationId',${quote(id(174804))},'expectedRevision',(select coalesce(max(c.revision),0) from public.merchant_attendance_correction_controls c where c.merchant_id=${site}),
      'expectedSettingsVersion',${settingsVersion},'reason','Synthetic174 rollback correction window','submissionWindowDays',365),null,null,true)`),
    prefix+perform(`public.faolla_attendance_correction_self_v3(${site},${auth},${json({mode:'detail',expectedWorkerId:h.workerId,requestId:rootRequest,operationId:null})},
      ${json(initialCommand)}||jsonb_build_object('expectedPolicyRevision',${policyRevision}),true)`),
    prefix+`set local role service_role;do $initial_approval$ declare review jsonb;command jsonb;begin
      review:=public.faolla_attendance_correction_decide_v1(${site},${owner},${quote(rootRequest)},null,null,true);
      assert review->>'canApprove'='true','context_initial_correction_not_approvable';
      command:=jsonb_build_object('action','approve','operationId',${quote(rootApproval)},'requestId',${quote(rootRequest)},'expectedRevision',1,
        'expectedEvidence',review->>'evidenceToken','reason','Synthetic174 rollback initial approval');
      perform public.faolla_attendance_correction_decide_v1(${site},${owner},${quote(rootRequest)},command,null,true);end;$initial_approval$;`,
    readStep('initial_approved_correction'),
    //095 v2 remains private. As in the existing native fixtures, construction
    //uses only the owned postgres role; the actual146 read uses service_role.
    prefix+`do $latest_submit$ declare prepared jsonb;command jsonb;begin
      prepared:=public.faolla_attendance_revision_self_v2(${site},${auth},${json({mode:'prepare',expectedWorkerId:h.workerId,baseRequestId:rootRequest,requestId:null,operationId:null})},null,true);
      command:=jsonb_build_object('action','submit','operationId',${quote(revisionRequest)},'expectedRevision',(prepared->>'revision')::bigint,
        'expectedBaseOperationId',${quote(rootApproval)},'expectedEffectiveOperationId',prepared->'current'->>'operationId','expectedPolicyRevision',${policyRevision},
        'reason','Synthetic174 rollback latest correction','proposal',${json(finalProposal)});
      perform public.faolla_attendance_revision_self_v2(${site},${auth},${json({mode:'detail',expectedWorkerId:h.workerId,baseRequestId:rootRequest,requestId:revisionRequest,operationId:null})},command,true);
    end;$latest_submit$;`,
    prefix+`do $latest_approval$ declare review jsonb;command jsonb;begin
      review:=public.faolla_attendance_revision_decide_v2(${site},${owner},${quote(revisionRequest)},null,null,true);
      assert review->>'canApprove'='true','context_latest_correction_not_approvable';
      command:=jsonb_build_object('action','approve','operationId',${quote(revisionApproval)},'requestId',${quote(revisionRequest)},
        'expectedRevision',(review->'review'->>'submittedRevision')::bigint,'expectedEvidence',review->>'evidenceToken',
        'expectedBaseOperationId',review->'current'->>'operationId','reason','Synthetic174 rollback latest approval');
      perform public.faolla_attendance_revision_decide_v2(${site},${owner},${quote(revisionRequest)},command,null,true);end;$latest_approval$;`,
    readStep('latest_approved_correction'),
    verifyPolicyBinding,
  ],verify:rows=>{
    assert.equal(rows.length,2);const first=rows[0].view,latest=rows[1].view;
    for(const view of [first,latest]){assert.equal(view.eligible,true);assert.deepEqual(view.blockers,[]);assert.equal(view.source.sessions.length,1);}
    assert.equal(first.source.sessions[0].effect.revision,1);assert.equal(first.source.sessions[0].effect.operationId,rootApproval);
    assert.deepEqual(first.candidate.selected,{startAt:firstProposal.startAt,endAt:firstProposal.endAt});
    assert.equal(first.candidate.late.state,'triggered');assert.equal(first.candidate.early.state,'triggered');
    assert.equal(latest.source.sessions[0].effect.revision,2);assert.equal(latest.source.sessions[0].effect.operationId,revisionApproval);
    assert.equal(latest.source.sessions[0].effect.previousOperationId,rootApproval);assert.equal(latest.source.sessions[0].effect.rootRequestId,rootRequest);
    assert.deepEqual(latest.candidate.selected,{startAt:finalProposal.startAt,endAt:finalProposal.endAt});
    assert.deepEqual(latest.candidate.late,{state:'not_triggered',minutes:0,rawDeltaUs:'0',excessUs:'0'});
    assert.deepEqual(latest.candidate.early,{state:'not_triggered',minutes:10,rawDeltaUs:'0',excessUs:'0'});
    assert.notEqual(first.fingerprint,latest.fingerprint,'latest_effect_not_part_of_fingerprint');
  }});
  return {scenarios,sourceReads,actualCalendarCreates:1,actualLeaveSubmissions:2,actualLeaveApprovals:1,
    actualCorrectionSubmissions:1,actualCorrectionApprovals:1,actualRevisionSubmissions:1,actualRevisionApprovals:1,
    exactNewCorrectionPolicyBindings:1,existingCorrectionPolicyBindingsUnchanged:true,
    rollbackTransactions:4,allRollbackFingerprintsUnchanged:true,readFingerprintsUnchanged:true,definitionsAndCatalogUnchanged:true,
    syntheticOnly:true,realAuthentication:false,syntheticRolePermissionsWithinRollback:true,
    fixtureDisclosure:'Real calendar/leave/086/095 RPCs over the explicitly synthetic ended plan and original events. Role permission setup and policy are local rollback-only; no historical real-world publication or attendance is claimed.',
    callerOwnsRuntimeAndCleanup:true};
}
