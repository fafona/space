//191 Inert, caller-owned PostgreSQL security probes. Never starts an environment.
//Genuine old submit/new grant fixture facts are disclosed. Every permission,
//identity and new-CHECK fault injection is rolled back; no production mutation.
import assert from 'node:assert/strict';
import {assertLifecycleSandbox,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';

function factHashSql(names){
  assert(names.length>0&&new Set(names).size===names.length);
  return '(select md5(jsonb_object_agg(name,rows order by name)::text) from ('+names.map(name=>{
    assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name));
    return 'select '+quote(name)+" name,(select coalesce(jsonb_agg(to_jsonb(application_security_row) order by to_jsonb(application_security_row)::text),'[]') from public."+name+' application_security_row) rows';
  }).join(' union all ')+') security_rows)';
}
export async function verifyApplicationDelegationSecurityNative(ctx){
  const {d,h,native,scope,ownerQuery,delegateQuery,expr,raw,read,reject,submit,grant,detail,decide,post,next,fingerprint,delegateAuth,delegateEmployee,approved}=ctx;
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);
  assert.equal(typeof native?.querySteps,'function');assert.equal(typeof d.guard,'string');
  assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
  assert.equal(scope.schema,d.owned.schema);assert.match(scope.schema,/^attendance_race_[a-f0-9]{32}$/);
  assert.notEqual(delegateAuth,h.employeeAuthUserId);assert.notEqual(delegateEmployee,h.employeeId);
  for(const value of [delegateAuth,delegateEmployee,h.employeeId,h.employeeAuthUserId,h.workerId])assert.match(value,/^[0-9a-f-]{36}$/);
  for(const method of [ownerQuery,delegateQuery,expr,raw,read,reject,submit,grant,detail,decide,post,next,fingerprint])assert.equal(typeof method,'function');

  //Only real old RPC submits and new owner grant RPCs create successful facts.
  const pending=await submit('leave');
  const ownGrant=grant('leave',{includePending:true});raw(ownerQuery(),ownGrant);
  const pendingView=detail(ownGrant.operationId,pending);assert(pendingView.canApprove&&!pendingView.blocked&&!pendingView.sealed);
  const remote=await submit('work_arrangement','remote');
  const hiddenTrip=await submit('work_arrangement','trip',{startAt:remote.startAt,endAt:remote.endAt});
  const hiddenLeave=await submit('leave','trip',{startAt:remote.startAt,endAt:remote.endAt});
  const remoteGrant=grant('work_arrangement',{includePending:true,kinds:['remote']});raw(ownerQuery(),remoteGrant);
  const now=Date.now(),stamp=ms=>new Date(ms).toISOString().replace('Z','000Z');
  const expired=grant('leave',{includePending:true,validFrom:stamp(now-7200000),validUntil:stamp(now-3600000)});
  const future=grant('leave',{includePending:true,validFrom:stamp(now+3600000),validUntil:stamp(now+7200000)});
  raw(ownerQuery(),expired);raw(ownerQuery(),future);
  const allGrants=read(delegateQuery()).grants;
  assert(!allGrants.some(g=>g.grantId===expired.operationId||g.grantId===future.operationId));
  const pendingQuery=delegateQuery({mode:'detail',grantId:ownGrant.operationId,requestId:pending.requestId});
  for(const g of [expired,future])reject('attendance_access_denied',{...pendingQuery,grantId:g.operationId});
  reject('attendance_application_delegation_disabled',pendingQuery,null,false);
  assert.deepEqual(read(approved.recovery,false).receipt,approved.receipt);
  assert.equal(approved.receipt.commandFingerprint,fingerprint(approved.query,approved.command));
  assert.equal(approved.receipt.actorId,delegateAuth);
  //Category scope does not discover an ID from the other request table.
  reject('attendance_application_delegation_not_found',{...pendingQuery,requestId:remote.requestId});
  reject('attendance_access_denied',delegateQuery({mode:'detail',grantId:remoteGrant.operationId,requestId:hiddenTrip.requestId}));

  const names=d.inventory(),allHash=factHashSql(names),baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();
  const role=JSON.parse(d.exec(`select jsonb_build_object('id',role_id) from public.merchant_enterprise_employees where merchant_id=${quote(d.site)} and id=${quote(delegateEmployee)};`)).id;
  assert.match(role,/^[0-9a-f-]{36}$/);
  const site=quote(d.site),roleId=quote(role),newDelegateAuth=next(),newMemberAuth=next();
  const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
  let denials=0,readChecks=0;
  const negative=(expression,error,label)=>{
    denials++;
    return `do $application_security_denial$ declare before_hash text;begin before_hash:=${allHash};
      begin set local role service_role;perform ${expression};reset role;raise exception '191_expected_denial_missing';
      exception when raise_exception then reset role;if sqlerrm<>${quote(error)} then raise;end if;end;
      assert ${allHash}=before_hash,${quote('191_denial_zero_writes_'+label)};
    end;$application_security_denial$;`;
  };
  const recover=label=>{
    readChecks++;
    return `do $application_security_recovery$ declare before_hash text;r jsonb;begin before_hash:=${allHash};
      set local role service_role;r:=${expr(approved.recovery,null,false)};reset role;
      assert r->'receipt'=${json(approved.receipt)},${quote('191_minimal_recovery_'+label)};
      assert r->'detail'='null'::jsonb and r->'grants'='[]'::jsonb and r->'items'='[]'::jsonb
        and r->'nextId'='null'::jsonb and r->'nextCursor'='null'::jsonb,'191_recovery_no_body_or_cursor';
      assert (select count(*) from jsonb_object_keys(r->'receipt'))=9,'191_minimal_receipt_exact9';
      assert not (r->'receipt' ?| array['command','reason','workerName','startAt','endAt']),'191_recovery_private_absent';
      assert ${allHash}=before_hash,${quote('191_recovery_zero_writes_'+label)};
    end;$application_security_recovery$;`;
  };
  const operationAbsent=op=>`not exists(select 1 from public.merchant_attendance_leave_entries where merchant_id=${site} and operation_id=${quote(op)})
    and not exists(select 1 from public.merchant_attendance_leave_notifications where merchant_id=${site} and notification_id=${quote(op)})
    and not exists(select 1 from public.merchant_attendance_application_delegation_decisions where merchant_id=${site} and operation_id=${quote(op)})`;
  const positive=decide(ownGrant.operationId,pending,pendingView),withoutNotification=decide(ownGrant.operationId,pending,pendingView);
  const sidecarFault=decide(ownGrant.operationId,pending,pendingView),notificationFault=decide(ownGrant.operationId,pending,pendingView);
  const pendingPost=post(ownGrant.operationId,pending);
  const positiveProbe=(command,capture)=>`do $application_security_positive$ declare before_hash text;r jsonb;begin before_hash:=${allHash};
    begin
      set local role service_role;r:=${expr(pendingPost,command,true,delegateAuth,capture)};reset role;
      assert r->'receipt'->>'commandFingerprint'=${quote(fingerprint(pendingPost,command))},'191_real_receipt_exact_hash';
      assert r->'receipt'->>'actorId'=${quote(delegateAuth)} and r->'receipt'->>'status'='approved','191_real_delegate_actor';
      assert exists(select 1 from public.merchant_attendance_leave_entries where merchant_id=${site} and operation_id=${quote(command.decision.operationId)}
        and actor_auth_user_id=${quote(delegateAuth)} and command=${json(command.decision)}),'191_real_old_exact_terminal';
      assert exists(select 1 from public.merchant_attendance_application_delegation_decisions where merchant_id=${site} and operation_id=${quote(command.decision.operationId)}
        and captured_notification=${capture}),'191_real_authority_capture_choice';
      assert (select count(*) from public.merchant_attendance_leave_notifications where merchant_id=${site} and notification_id=${quote(command.decision.operationId)})=${capture?1:0},'191_notification_flag_respected';
      raise exception using errcode='P1911',message='191_positive_subtransaction_rollback';
    exception when sqlstate 'P1911' then reset role;end;
    assert ${operationAbsent(command.decision.operationId)},'191_positive_all_three_rows_rolled_back';
    assert ${allHash}=before_hash,'191_positive_all_facts_restored';
  end;$application_security_positive$;`;
  const injected=(table,constraint,command)=>`alter table public.${table} add constraint ${constraint} check(${table.endsWith('_notifications')?'notification_id':'operation_id'}<>${quote(command.decision.operationId)}::uuid) not valid;
    do $application_security_fault$ declare before_hash text;failed_constraint text;failed_table text;caught boolean:=false;begin
      before_hash:=${allHash};
      begin set local role service_role;perform ${expr(pendingPost,command,true,delegateAuth,true)};reset role;raise exception '191_expected_check_failure';
      exception when check_violation then reset role;get stacked diagnostics failed_constraint=constraint_name,failed_table=table_name;
        assert failed_constraint=${quote(constraint)} and failed_table=${quote(table)},'191_exact_injected_check_23514';caught:=true;end;
      assert caught,'191_fault_reached';
      assert ${operationAbsent(command.decision.operationId)},'191_terminal_notification_authority_atomic_rollback';
      assert not exists(select 1 from public.merchant_attendance_leave_entries where merchant_id=${site} and request_id=${quote(pending.requestId)} and revision=2),'191_fault_request_still_pending';
      assert ${allHash}=before_hash,'191_fault_all_facts_unchanged';
    end;$application_security_fault$;`;
  const privacyQuery=delegateQuery({mode:'detail',grantId:remoteGrant.operationId,requestId:remote.requestId});
  const tripGrant=grant('work_arrangement',{includePending:true,kinds:['trip']});
  const privacyOperation=next();
  //Fresh evidence is obtained inside this role/scope observation, not copied
  //from the browser or another grant. The outer command remains exact4.
  const privacyCommand={grantId:remoteGrant.operationId,expectedGrantRevision:1,expectedEvidenceFingerprint:'0'.repeat(64),
    decision:{action:'approve',operationId:privacyOperation,requestId:remote.requestId,expectedRevision:1,reason:'Synthetic191 privacy blocked approval',expectedConflictsFingerprint:'0'.repeat(64),confirmConflicts:true}};
  const privacyApproval=`public.faolla_attendance_delegated_applications_v1(${json(post(remoteGrant.operationId,remote))},${quote(delegateAuth)},
    jsonb_set(jsonb_set(${json(privacyCommand)},'{expectedEvidenceFingerprint}',r->'detail'->'evidenceFingerprint'),'{decision,expectedConflictsFingerprint}',r->'detail'->'conflictsFingerprint'),true,false)`;
  const privacy=prefix+`savepoint privacy_scope;
    update public.merchant_enterprise_roles set permissions=array_remove(permissions,'attendance.leave.review') where merchant_id=${site} and id=${roleId};
    do $application_security_privacy$ declare before_hash text;r jsonb;begin before_hash:=${allHash};
      set local role service_role;r:=${expr(privacyQuery)};reset role;
      assert r->'detail'->'blocked'='true'::jsonb and r->'detail'->'canApprove'='false'::jsonb and r->'detail'->'canReject'='true'::jsonb,'191_hidden_category_kind_block';
      assert not exists(select 1 from jsonb_array_elements(r->'detail'->'conflicts') x where x->>'source'='application'),'191_hidden_application_summaries_absent';
      assert position(${quote(hiddenTrip.requestId)} in r::text)=0 and position(${quote(hiddenLeave.requestId)} in r::text)=0,'191_hidden_application_ids_absent';
      assert position(${quote(hiddenTrip.reason)} in (r->'detail'->'conflicts')::text)=0,'191_hidden_application_reason_absent';
      begin set local role service_role;perform ${privacyApproval};reset role;raise exception '191_hidden_conflict_approval_expected';
      exception when raise_exception then reset role;if sqlerrm<>'attendance_access_denied' then raise;end if;end;
      assert not exists(select 1 from public.merchant_attendance_work_arrangement_entries where merchant_id=${site} and operation_id=${quote(privacyOperation)}),'191_hidden_approval_no_terminal';
      assert ${allHash}=before_hash,'191_privacy_reads_and_denial_zero_writes';
    end;$application_security_privacy$;
    set local role service_role;select ${expr(ownerQuery(),tripGrant)};reset role;
    do $application_security_kind_disclosure$ declare before_hash text;r jsonb;begin before_hash:=${allHash};
      set local role service_role;r:=${expr(privacyQuery)};reset role;
      assert r->'detail'->'blocked'='true'::jsonb,'191_still_hidden_leave_blocks';
      assert (select count(*) from jsonb_array_elements(r->'detail'->'conflicts') x where x->>'source'='application' and x->>'kind'='trip')=1,'191_explicit_kind_grant_minimal_summary';
      assert not exists(select 1 from jsonb_array_elements(r->'detail'->'conflicts') x where x->>'kind'='leave'),'191_category_not_granted_by_kind';
      assert not exists(select 1 from jsonb_array_elements(r->'detail'->'conflicts') x where (select count(*) from jsonb_object_keys(x))<>5 or x ?| array['id','requestId','reason','locationId']),'191_conflict_exact5';
      assert ${allHash}=before_hash,'191_kind_disclosure_read_zero_writes';
    end;$application_security_kind_disclosure$;
    update public.merchant_enterprise_roles set permissions=array(select distinct p from unnest(permissions||array['attendance.leave.review']) p order by p) where merchant_id=${site} and id=${roleId};
    do $application_security_category_disclosure$ declare before_hash text;r jsonb;begin before_hash:=${allHash};
      set local role service_role;r:=${expr(privacyQuery)};reset role;
      assert r->'detail'->'blocked'='false'::jsonb and r->'detail'->'canApprove'='true'::jsonb,'191_explicit_category_and_kind_no_hidden_conflict';
      assert (select count(*) from jsonb_array_elements(r->'detail'->'conflicts') x where x->>'source'='application')=2,'191_only_two_authorized_application_summaries';
      assert ${allHash}=before_hash,'191_category_disclosure_read_zero_writes';
    end;$application_security_category_disclosure$;rollback to privacy_scope;release privacy_scope;`;
  const stages=[
    'begin;'+prefix+`do $application_security_owned$ declare n text;t oid;begin
      assert current_user='postgres','191_owned_postgres';
      foreach n in array array['merchant_attendance_application_delegation_decisions','merchant_attendance_leave_notifications','merchant_attendance_leave_entries'] loop
        t:=to_regclass('public.'||n);
        assert exists(select 1 from pg_class where oid=t and relnamespace=${d.owned.oid} and relowner::regrole::text='postgres'),'191_owned_fault_tables';
        assert not exists(select 1 from pg_trigger where tgrelid=t and tgenabled<>'O'),'191_existing_triggers_enabled';
        assert not exists(select 1 from pg_constraint where conrelid=t and not convalidated),'191_existing_constraints_valid';
      end loop;
      assert not exists(select 1 from pg_constraint where connamespace=${d.owned.oid} and conname in('application_delegation_sidecar_probe','application_delegation_notification_probe')),'191_fault_constraints_initially_absent';
    end;$application_security_owned$;`,
    prefix+'savepoint revoked_permission;'+`update public.merchant_enterprise_roles set permissions=array_remove(permissions,'attendance.leave.review') where merchant_id=${site} and id=${roleId};`
      +negative(expr(pendingQuery),'attendance_access_denied','permission')+recover('permission_revoked')+'rollback to revoked_permission;release revoked_permission;',
    prefix+'savepoint inactive_delegate;'+`update public.merchant_enterprise_employees set status='disabled' where merchant_id=${site} and id=${quote(delegateEmployee)};`
      +negative(expr(pendingQuery),'attendance_access_denied','inactive')+recover('inactive')+'rollback to inactive_delegate;release inactive_delegate;',
    prefix+'savepoint delegate_rebinding;'+`update public.merchant_enterprise_employees set auth_user_id=${quote(newDelegateAuth)} where merchant_id=${site} and id=${quote(delegateEmployee)};`
      +negative(expr(approved.recovery,null,false),'attendance_access_denied','old_delegate_auth')
      +negative(expr(approved.recovery,null,false,newDelegateAuth),'attendance_access_denied','new_delegate_auth')+'rollback to delegate_rebinding;release delegate_rebinding;',
    prefix+'savepoint applicant_rebinding;'+`update public.merchant_enterprise_employees set auth_user_id=${quote(newMemberAuth)} where merchant_id=${site} and id=${quote(h.employeeId)};`
      +negative(expr(pendingQuery),'attendance_access_denied','applicant_auth')+recover('historical_receipt_not_target_body')+'rollback to applicant_rebinding;release applicant_rebinding;',
    privacy,
    prefix+positiveProbe(positive,true)+positiveProbe(withoutNotification,false),
    //NOT VALID skips existing rows only; every fresh notification/authority
    //INSERT still reaches the named23514 constraint. Nothing is disabled.
    prefix+injected('merchant_attendance_application_delegation_decisions','application_delegation_sidecar_probe',sidecarFault),
    prefix+injected('merchant_attendance_leave_notifications','application_delegation_notification_probe',notificationFault),
    prefix+'set constraints all immediate;rollback;',
  ];
  assert(stages.length===10);
  try{await native.querySteps(stages.map((sql,index)=>scope.sql(`--application_security_stage_${index+1}\n`+sql)));}
  catch(error){throw new Error('application_delegation_security_failed: '+String(error),{cause:error});}
  finally{
    assert.equal(d.fingerprint(),baseline,'191_all_mutation_probes_rolled_back');
    assert.equal(d.definitions(),definitions,'191_definitions_unchanged');
    assert.equal(d.tableCatalog(),catalog,'191_fault_constraints_removed_by_rollback');
  }
  assert.deepEqual(read(approved.recovery,false).receipt,approved.receipt);
  native.pass('current permissions/identity/validity and scoped minimal conflicts; exact minimal recovery; actual optional notification plus mandatory authority CHECK23514 failures roll back whole approval');
  return {rollbackGroups:1,stages:10,permissionIdentityDenials:denials,outsideRuntimeScopeDenials:5,readonlyRecoveryChecks:readChecks+2,
    genuineSubmitFixtures:4,genuineGrantFixtures:4,expiry:'real owner-created expired and not-yet-valid grants; no artificial waiting',
    categoryAndKindPrivacy:true,receiptFingerprintCrossChecked:true,featureOffAndRevokedRecovery:true,notificationFlagBothWays:true,
    injectedFailures:['authority_check_violation_23514','notification_check_violation_23514'],allThreeApprovalRowsAtomic:true,
    factsDefinitionsCatalogRestored:true,lifecycleRace:false,productionAccess:false,
    fixture:'Four genuine old-RPC submits and four genuine new owner grants remain as disclosed sandbox facts; all permission/Auth changes, extra privacy grant, positive approvals and injected new CHECK constraints roll back. No copied successful ledger or disabled guards.'};
}
