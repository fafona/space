//202 inert, caller-owned boundary acceptance. Never starts an environment.
//Only current synthetic role/Auth/active projections change in the rollback
//group. Historical rules, approvals, events and saved decisions are not edited.
import assert from 'node:assert/strict';
import {assertLifecycleSandbox,lifecycleJson as json,lifecycleRace} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';

function factHashSql(names,site,excluded={}){
  assert(names.length>0&&new Set(names).size===names.length);
  return '(select md5(jsonb_object_agg(name,rows order by name)::text) from ('+names.map(name=>{
    assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name));
    const ids=excluded[name],where=ids?` where not(merchant_id=${quote(site)} and operation_id in(${ids.map(quote).join(',')}))`:'';
    return 'select '+quote(name)+" name,(select coalesce(jsonb_agg(to_jsonb(clearance_boundary_row) order by to_jsonb(clearance_boundary_row)::text),'[]') from public."+name+' clearance_boundary_row'+where+') rows';
  }).join(' union all ')+') clearance_boundary_tables)';
}

export async function verifyPlanClearanceBoundariesNative(ctx){
  const {d,h,native,scope,read,rq,make,expression,review,clearance,eventReview,source,all,next,submit,call,
    rootRequest,rootApproval,policyRevision,finalProposal,move}=ctx;
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);
  assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);assert.equal(scope.schema,d.owned.schema);
  for(const port of [read,rq,make,expression,source,all,next,submit,call,move])assert.equal(typeof port,'function');
  assert.equal(typeof native.querySteps,'function');assert.equal(typeof native.connect,'function');
  assert(Number.isSafeInteger(policyRevision)&&policyRevision>0);
  const initial=read();assert(initial.detail.caseId&&initial.detail.revision>=1&&initial.detail.stale);
  const initialSource=source();assert(initialSource.eligible);
  for(const key of ['late','early'])assert.equal(initialSource.candidate[key].state,'not_triggered');
  const savedGrace=initialSource.source.approval?.source.fields.earlyGraceMinutes;
  assert(savedGrace?.state==='value'&&savedGrace.minutes>=3,'clearance_boundary_saved_grace_required');
  assert.equal(initialSource.candidate.early.rawDeltaUs,'60000000');assert.equal(initialSource.candidate.early.excessUs,'0');
  const site=quote(d.site),owner=quote(d.owner),auth=quote(h.employeeAuthUserId),employee=quote(h.employeeId),worker=quote(h.workerId);
  const names=d.inventory(),hash=factHashSql(names,d.site),definitions=d.definitions(),catalog=d.tableCatalog();
  const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
  const normalized=()=>d.exec(prefix+'select '+hash+';');
  const sourceSql=`public.faolla_attendance_plan_exception_source_v1(${json(h.query)},${owner})`;
  const baseline=all(),normalizedBaseline=normalized();let denials=0,readChecks=0;
  const newAuth=next(),oldDecision=initial.detail.latestDecision.operationId;
  assert.equal(d.exec(`select count(*) from public.merchant_enterprise_employees where auth_user_id=${quote(newAuth)};`),'0');
  const denied=(exp,error,label)=>{
    denials++;
    return `do $clearance_denied$ declare before_hash text;begin before_hash:=${hash};
      begin set local role service_role;perform ${exp};reset role;raise exception 'clearance_expected_denial_missing';
      exception when raise_exception then reset role;if sqlerrm<>${quote(error)} then raise;end if;end;
      assert ${hash}=before_hash,${quote('clearance_denial_zero_writes_'+label)};end;$clearance_denied$;`;
  };
  const currentBlocked=(blocker,label)=>{
    denials++;readChecks++;const command=make(initial),query=rq('decide','owner',command.operationId);
    return `do $clearance_blocked$ declare before_hash text;observed jsonb;begin before_hash:=${hash};
      set local role service_role;observed:=${sourceSql};reset role;
      assert observed->'eligible'='false'::jsonb and observed->'blockers' ? ${quote(blocker)},${quote('clearance_source_blocker_'+label)};
      assert ${hash}=before_hash,'clearance_blocked_source_read_zero_writes';
      begin set local role service_role;perform public.${clearance}(${json(query)},${owner},${json(command)}||jsonb_build_object('expectedFingerprint',observed->>'fingerprint'),true,true,false);
        reset role;raise exception 'clearance_expected_blocked_missing';
      exception when raise_exception then reset role;if sqlerrm<>'attendance_plan_exception_review_blocked' then raise;end if;end;
      assert ${hash}=before_hash,'clearance_blocked_write_zero_writes';end;$clearance_blocked$;`;
  };
  const closedStage=(label,body)=>prefix+`savepoint clearance_boundary_probe;${body}
    rollback to clearance_boundary_probe;release clearance_boundary_probe;
    do $clearance_restored$ begin assert ${hash}=${quote(normalizedBaseline)},${quote('clearance_stage_restored_'+label)};end;$clearance_restored$;`;
  const knownCommand=make(initial),knownQuery=rq('decide','owner',knownCommand.operationId);
  const selfDetail=expression(review,rq('detail','self'),h.employeeAuthUserId,null,false);
  //A real existing schedule with no case, not a fabricated case/slot receipt.
  const missingOperation=next();denials++;
  const missingCase=`do $clearance_missing_case$ declare before_hash text;target record;query jsonb;command jsonb;begin
    select s.id,s.worker_id,e.id employee_id,e.auth_user_id into target from public.merchant_attendance_schedule_slots s
      join public.merchant_attendance_workers w on w.merchant_id=s.merchant_id and w.id=s.worker_id
      join public.merchant_enterprise_employees e on e.merchant_id=w.merchant_id and e.id=w.employee_id
      where s.merchant_id=${site} and e.auth_user_id is not null
        and not exists(select 1 from public.merchant_attendance_plan_exception_cases c where c.merchant_id=s.merchant_id and c.slot_id=s.id)
      order by s.id limit 1;
    assert found,'clearance_existing_casefree_schedule_required';
    query:=${json(rq('decide','owner',missingOperation))}||jsonb_build_object('workerId',target.worker_id,'slotId',target.id);
    command:=${json({...knownCommand,operationId:missingOperation,expectedRevision:1})}||jsonb_build_object('employeeId',target.employee_id,'employeeAuthUserId',target.auth_user_id);
    before_hash:=${hash};begin set local role service_role;perform public.${clearance}(query,${owner},command,true,true,false);reset role;
      raise exception 'clearance_missing_case_was_created';exception when raise_exception then reset role;
      if sqlerrm<>'attendance_plan_exception_review_blocked' then raise;end if;end;
    assert ${hash}=before_hash,'clearance_missing_case_zero_writes';end;$clearance_missing_case$;`;
  const leaveRequest=next(),leaveApproval=next(),leaveQuery=(access,requestId=null)=>({siteId:d.site,access,requestId,operationId:null,beforeAt:null,beforeId:null});
  //Prepare private settings CAS under the owned fixture role, not as a
  //service_role argument subquery. Both actual leave writers use service_role.
  const leaveSetup=`update public.merchant_enterprise_roles set permissions=array(select distinct p from unnest(permissions||array['attendance.self.leave']) p order by p)
    where merchant_id=${site} and id=(select role_id from public.merchant_enterprise_employees where merchant_id=${site} and id=${employee});
    do $clearance_actual_leave$ declare command jsonb;reply jsonb;begin
      select jsonb_build_object('action','submit','operationId',${quote(leaveRequest)},'reason','Synthetic202 actual leave boundary',
        'expectedWorkerId',${worker},'expectedSettingsVersion',version,'timeZone',time_zone,'startAt',${quote(h.slot.startAt)},'endAt',${quote(h.slot.endAt)})
        into command from public.merchant_attendance_settings where merchant_id=${site};
      set local role service_role;reply:=public.faolla_attendance_leave_v1(${json(leaveQuery('self'))},${auth},command,true);
      assert reply->'detail'->>'status'='submitted' and reply->'receipt'->'command'=command,'clearance_actual_leave_submit';
      reply:=public.faolla_attendance_leave_v1(${json(leaveQuery('owner',leaveRequest))},${owner},${json({action:'approve',operationId:leaveApproval,requestId:leaveRequest,expectedRevision:1,reason:'Synthetic202 actual owner leave approval'})},true);
      reset role;assert reply->'detail'->>'status'='approved','clearance_actual_leave_approved';end;$clearance_actual_leave$;`;
  const ownerRecovery=expression(review,rq('recover','owner',oldDecision),d.owner,null,false);
  readChecks++;
  const pausedRecovery=`do $clearance_paused_recovery$ declare before_hash text;reply jsonb;begin before_hash:=${hash};set local role service_role;
    reply:=${ownerRecovery};reset role;assert reply->'receipt'->>'operationId'=${quote(oldDecision)} and reply->'receipt'->'item'->>'outcome'='cleared','clearance_actual_paused_recovery';
    assert ${hash}=before_hash,'clearance_paused_recovery_zero_writes';end;$clearance_paused_recovery$;`;
  const stages=[
    'begin;'+prefix+`do $clearance_boundary_guard$ begin assert current_user='postgres','clearance_owned_role_required';
      assert not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${d.owned.oid} and t.tgenabled<>'O'),'clearance_triggers_enabled';
      assert ${hash}=${quote(normalizedBaseline)},'clearance_initial_normalized_baseline';end;$clearance_boundary_guard$;`,
    closedStage('missing_case',missingCase),
    closedStage('approved_leave',leaveSetup+currentBlocked('leave_approved','actual_approved_leave')),
    closedStage('auth_rebind',`update public.merchant_enterprise_employees set auth_user_id=${quote(newAuth)} where merchant_id=${site} and id=${employee};`
      +denied(expression(clearance,knownQuery,d.owner,knownCommand,true,true,false),'attendance_plan_exception_review_identity_changed','owner_after_rebind')
      +denied(selfDetail,'attendance_access_denied','prior_auth')
      +denied(expression(review,rq('detail','self'),newAuth,null,false),'attendance_plan_exception_review_identity_changed','new_auth_cannot_inherit_case')),
    closedStage('role_withdrawn',`update public.merchant_enterprise_roles set permissions=array['enterprise.view'] where merchant_id=${site}
      and id=(select role_id from public.merchant_enterprise_employees where merchant_id=${site} and id=${employee});`
      +denied(selfDetail,'attendance_access_denied','self_view_withdrawn')),
    closedStage('employee_inactive',`update public.merchant_enterprise_employees set status='disabled' where merchant_id=${site} and id=${employee};`
      +denied(selfDetail,'attendance_access_denied','employee_disabled')+currentBlocked('worker_inactive','employee_disabled')),
    closedStage('worker_inactive',`update public.merchant_attendance_workers set active=false where merchant_id=${site} and id=${worker};`
      +currentBlocked('worker_inactive','worker_disabled')),
    closedStage('module_paused',`update public.merchant_attendance_settings set enabled=false where merchant_id=${site};`
      +denied(expression(clearance,knownQuery,d.owner,knownCommand,true,true,false),'attendance_platform_paused','module_disabled')+pausedRecovery),
    prefix+'set constraints all immediate;rollback;',
  ];
  assert.equal(stages.length,9);assert.equal(denials,10);
  try{await native.querySteps(stages.map(sql=>scope.sql(sql)));}
  finally{assert.equal(all(),baseline,'clearance_boundary_all_facts_restored');assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);}
  const privateSignature='public.faolla_attendance_plan_exception_clearance_execute_v1(jsonb,uuid,jsonb,boolean,boolean,boolean)';
  const privateAcl=JSON.parse(d.exec(`select jsonb_build_object('service',has_function_privilege('service_role',${quote(privateSignature)},'EXECUTE'),
    'anon',has_function_privilege('anon',${quote(privateSignature)},'EXECUTE'),'authenticated',has_function_privilege('authenticated',${quote(privateSignature)},'EXECUTE'));`));
  assert.deepEqual(privateAcl,{service:false,anon:false,authenticated:false});

  //095 v2 writers are deliberately private; use only the already-authorized
  //owned postgres fixture role. No grants or public impersonation are added.
  const raceRequest=next(),raceApproval=next(),resumeRequest=next(),resumeApproval=next(),captureOffOperation=next();
  const additions={merchant_attendance_revision_requests:[raceRequest,resumeRequest],merchant_attendance_revision_decisions:[raceApproval,resumeApproval],
    merchant_attendance_effect_versions:[raceApproval,resumeApproval],merchant_attendance_plan_exception_entries:[captureOffOperation]};
  for(const [table,ids] of Object.entries(additions))assert.equal(d.exec(`select count(*) from public.${table} where merchant_id=${site} and operation_id in(${ids.map(quote).join(',')});`),'0');
  const protectedHash=factHashSql(names,d.site,additions),originalRows=d.exec(prefix+'select '+protectedHash+';');
  const ownedCall=exp=>JSON.parse(d.exec(prefix+'select '+exp+';'));
  const prepareRevision=(request,approval,proposal)=>{
    const before=all(),prepared=ownedCall(`public.faolla_attendance_revision_self_v2(${site},${auth},${json({mode:'prepare',expectedWorkerId:h.workerId,baseRequestId:rootRequest,requestId:null,operationId:null})},null,true)`);
    assert.equal(all(),before,'clearance_revision_prepare_zero_writes');readChecks++;
    const command={action:'submit',operationId:request,expectedRevision:prepared.revision,expectedBaseOperationId:rootApproval,
      expectedEffectiveOperationId:prepared.current.operationId,expectedPolicyRevision:policyRevision,reason:'Synthetic202 actual clearance concurrency revision',proposal};
    const submitted=ownedCall(`public.faolla_attendance_revision_self_v2(${site},${auth},${json({mode:'detail',expectedWorkerId:h.workerId,baseRequestId:rootRequest,requestId:request,operationId:null})},${json(command)},true)`);
    assert.deepEqual(submitted.receipt.command,command);assert.equal(submitted.pendingRequestId,request);
    const beforeReview=all(),view=ownedCall(`public.faolla_attendance_revision_decide_v2(${site},${owner},${quote(request)},null,null,true)`);
    assert.equal(all(),beforeReview,'clearance_revision_review_zero_writes');readChecks++;assert(view.canApprove);
    const decision={action:'approve',operationId:approval,requestId:request,expectedRevision:view.review.submittedRevision,expectedEvidence:view.evidenceToken,
      expectedBaseOperationId:view.current.operationId,reason:'Synthetic202 actual owner concurrency approval'};
    return {decision,sql:`public.faolla_attendance_revision_decide_v2(${site},${owner},${quote(request)},${json(decision)},null,true)`};
  };
  const beforeCorrection=read(),outdated=make(beforeCorrection),raceProposal={...finalProposal,endAt:move(h.slot.endAt,-2)};
  assert.notEqual(beforeCorrection.detail.current.candidate.selected.endAt,raceProposal.endAt,'clearance_race_proposal_must_change');
  const preparedRace=prepareRevision(raceRequest,raceApproval,raceProposal),pending=source();
  assert.equal(pending.eligible,false);assert(pending.blockers.includes('pending_correction'));assert.equal(read().detail.revision,beforeCorrection.detail.revision);
  const race=await lifecycleRace({connect:()=>native.connect(),query:sql=>native.query(sql),sql:scope.sql},
    prefix+`do $clearance_actual_revision$ begin perform ${preparedRace.sql};set constraints all immediate;end;$clearance_actual_revision$;select ${hash};`,
    prefix+`set local role service_role;select ${expression(clearance,rq('decide','owner',outdated.operationId),d.owner,outdated,true,true,true)};`);
  assert.equal(race.witnessed,true);assert(race.right.error);
  assert.match(String(race.right.error),/ERROR:\s+attendance_plan_exception_review_source_changed(?:\s|$)/);
  const winnerHash=String(race.left).trim().split(/\r?\n/).at(-1);assert.match(winnerHash,/^[0-9a-f]{32}$/);
  assert.equal(normalized(),winnerHash,'clearance_waiter_failure_has_no_residue');
  const afterRace=source();assert(afterRace.eligible);assert.equal(afterRace.source.sessions[0].effect.operationId,raceApproval);
  assert.notEqual(afterRace.fingerprint,beforeCorrection.detail.current.fingerprint);
  for(const key of ['late','early'])assert.equal(afterRace.candidate[key].state,'not_triggered');
  assert.equal(read().detail.revision,beforeCorrection.detail.revision);

  const captureOff=make(read(),'cleared',captureOffOperation),saved=submit(captureOff,{capture:false});
  assert.equal(saved.receipt.item.outcome,'cleared');assert.equal(saved.receipt.item.revision,beforeCorrection.detail.revision+1);
  const countCapture=()=>d.exec(`select count(*) from public.merchant_attendance_event_notifications where merchant_id=${site} and operation_id=${quote(captureOffOperation)};`);
  assert.equal(countCapture(),'0');const beforeReplay=all();
  for(const name of [review,eventReview,clearance]){
    const replayed=submit(captureOff,{name,allow:false,enabled:false,capture:true});assert.deepEqual(replayed.receipt,saved.receipt);
  }
  assert.deepEqual(read(rq('recover','owner',captureOffOperation)).receipt,saved.receipt);
  assert.equal(countCapture(),'0');assert.equal(all(),beforeReplay,'clearance_capture_off_original_never_backfilled');
  //Keep the browser's promised starting state: an existing cleared decision,
  //a genuinely newer approved effect, both candidates still within fixed grace.
  const resumed=prepareRevision(resumeRequest,resumeApproval,{...finalProposal,endAt:move(h.slot.endAt,-3)});
  ownedCall(resumed.sql);
  const final=read();assert.equal(final.detail.stale,true);assert.equal(final.detail.latestDecision.operationId,captureOffOperation);
  assert(final.detail.current.eligible);for(const key of ['late','early'])assert.equal(final.detail.current.candidate[key].state,'not_triggered');
  assert.equal(final.detail.current.source.sessions[0].effect.operationId,resumeApproval);
  assert.equal(d.exec(prefix+'select '+protectedHash+';'),originalRows,'clearance_all_preexisting_rows_unchanged');
  for(const [table,ids] of Object.entries(additions))assert.equal(d.exec(`select count(*) from public.${table} where merchant_id=${site} and operation_id in(${ids.map(quote).join(',')});`),String(ids.length));
  assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  native.pass('202 rollback missing-case/approved-leave/Auth/role/inactive/pause boundaries; actual correction-vs-clear exactPID; capture-off replay never backfills');
  return {rollbackGroups:1,rollbackStages:stages.length,denials,readChecks,actualRollbackLeaveCommands:2,actualRevisionSubmissions:2,actualRevisionApprovals:2,
    exactPidCorrectionRace:1,captureOffClearances:1,captureOffReplayEntryPoints:3,privateEngineDenied:true,browserSourceEligibleNotTriggeredAndStale:true,
    disabledOrUnconfiguredHistoricalRuleNativeCovered:false,preexistingRowsDefinitionsCatalogUnchanged:true,production:false,
    disclosure:'Current synthetic Auth/role/active projections and actual leave writes roll back. Two actual private095 revision cycles and one public170 capture-off clearance remain until caller-owned sandbox cleanup; no historical row or saved rule was edited.'};
}
