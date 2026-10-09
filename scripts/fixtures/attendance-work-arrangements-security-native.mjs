//187 Caller-owned synthetic security probes. Never launches PostgreSQL. One
//rollback-only authorization group plus one real, future, two-connection race.
//The race deliberately leaves its own request + submit/approve entries; these
//are disclosed fixture facts, not a claim that the whole probe is read-only.
import assert from 'node:assert/strict';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json,lifecycleRace} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';

function hashSql(names,excludeRequest=null){
  assert(names.length>0&&new Set(names).size===names.length);
  return '(select md5(jsonb_object_agg(name,rows order by name)::text) from ('+names.map(name=>{
    assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name));
    const where=excludeRequest&&['merchant_attendance_work_arrangement_requests','merchant_attendance_work_arrangement_entries'].includes(name)
      ?' where request_id<>'+quote(excludeRequest):'';
    return 'select '+quote(name)+" name,(select coalesce(jsonb_agg(to_jsonb(work_arrangement_security_row) order by to_jsonb(work_arrangement_security_row)::text),'[]') from public."+name+' work_arrangement_security_row'+where+') rows';
  }).join(' union all ')+') security_rows)';
}
export async function verifyWorkArrangementSecurityNative({d,native,scope,h,work,wq}){
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true&&h.syntheticHistoricalRows===10);
  assert.equal(typeof native?.querySteps,'function');assert.equal(typeof native?.connect,'function');assert.equal(typeof work,'function');assert.equal(typeof wq,'function');
  const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
  assert.equal(h.workerId,d.otherWorker);assert.equal(h.employeeId,d.otherEmployee);assert.equal(h.employeeAuthUserId,d.otherAuth);
  const names=d.inventory(),allHash=hashSql(names),baseline=d.fingerprint(),defs=d.definitions(),catalog=d.tableCatalog();
  const home=await work(wq());assert.equal(d.fingerprint(),baseline,'security_home_read_wrote');
  assert(home.canSubmit&&home.workerId===h.workerId&&home.employeeId===h.employeeId&&home.actorId===h.employeeAuthUserId,'security_current_self_required');
  const site=quote(d.site),employee=quote(h.employeeId),auth=quote(h.employeeAuthUserId),owner=quote(d.owner);
  const role=JSON.parse(d.exec(`select jsonb_build_object('id',role_id) from public.merchant_enterprise_employees where merchant_id=${site} and id=${employee};`)).id;
  assert.match(role,/^[0-9a-f-]{36}$/);
  const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
  const query=(access='self',patch={})=>({...wq(access),...patch});
  const call=(q,actor,command=null,allow=true)=>`public.faolla_attendance_work_arrangement_v1(${json(q)},${quote(actor)},${json(command)},${allow})`;
  const span={kind:'remote',timeZone:home.timeZone,startAt:new Date(Date.parse(h.slot.startAt)+10*86400000).toISOString(),endAt:new Date(Date.parse(h.slot.endAt)+10*86400000).toISOString()};
  const command=n=>({action:'submit',operationId:id(n),reason:'Synthetic187 security arrangement',expectedWorkerId:h.workerId,
    expectedSettingsVersion:home.settingsVersion,expectedPolicyRevision:home.policy.revision,...span});
  const original=command(187800001),requestId=original.operationId,ownerDetail=query('owner',{requestId});let rejectionChecks=0;
  const negative=(expression,error)=>{
    rejectionChecks++;
    return `do $security_rejection$ declare before_hash text;begin before_hash:=${allHash};
      begin set local role service_role;perform ${expression};reset role;raise exception 'security_expected_rejection_missing';
      exception when others then reset role;if sqlerrm<>${quote(error)} then raise;end if;end;
      assert ${allHash}=before_hash,'security_rejected_rpc_left_writes';end;$security_rejection$;`;
  };
  const initial=`do $security_acl$ declare signature text;target oid;begin
    assert exists(select 1 from public.faolla_schema_migrations where version=202610060156 and name='merchant_attendance_work_arrangements'),'security156_required';
    target:=to_regprocedure('public.faolla_attendance_work_arrangement_v1(jsonb,uuid,jsonb,boolean)');
    assert has_function_privilege('service_role',target,'execute') and not has_function_privilege('anon',target,'execute') and not has_function_privilege('authenticated',target,'execute'),'security_public_rpc_acl';
    foreach signature in array array['public.faolla_attendance_work_arrangement_command_v1(jsonb)',
      'public.faolla_attendance_work_arrangement_summary_v1(public.merchant_attendance_work_arrangement_requests,integer)',
      'public.faolla_attendance_work_arrangement_context_v1(text,uuid,uuid,uuid,timestamptz,timestamptz)',
      'public.faolla_attendance_work_arrangement_conflicts_v1(text,uuid,uuid,uuid,timestamptz,timestamptz,uuid)'] loop
      target:=to_regprocedure(signature);assert target is not null,'security_private_helper_missing';
      assert not has_function_privilege('service_role',target,'execute') and not has_function_privilege('anon',target,'execute') and not has_function_privilege('authenticated',target,'execute'),'security_private_helper_acl';
    end loop;
    assert not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and t.tgenabled<>'O'),'security_constraints_enabled';
  end;$security_acl$;`;
  const approve={action:'approve',operationId:id(187800002),requestId,expectedRevision:1,reason:'Synthetic187 owner review',expectedConflictsFingerprint:'0'.repeat(64),confirmConflicts:true};
  const approveCurrent=`do $security_bad_binding$ declare review jsonb;cmd jsonb;before_hash text;begin
    before_hash:=${allHash};set local role service_role;review:=${call(ownerDetail,d.owner)};reset role;
    assert review->'detail'->'issues' ? 'binding_changed','security_expected_binding_issue';
    assert review->'detail'->'conflicts'='[]'::jsonb,'security_replacement_conflicts_not_disclosed';
    cmd:=${json(approve)}||jsonb_build_object('expectedConflictsFingerprint',review->'detail'->'conflictsFingerprint');
    begin set local role service_role;perform public.faolla_attendance_work_arrangement_v1(${json(ownerDetail)},${owner},cmd,true);reset role;
      raise exception 'security_expected_binding_rejection_missing';exception when others then reset role;if sqlerrm<>'attendance_work_arrangement_binding_changed' then raise;end if;end;
    assert ${allHash}=before_hash,'security_identity_rejection_wrote';end;$security_bad_binding$;`;
  rejectionChecks++;
  const stages=[
    'begin;'+prefix+initial+`set local role service_role;do $security_submit$ begin perform ${call(query(),h.employeeAuthUserId,original)};end;$security_submit$;reset role;`,
    prefix+'savepoint independent_permission;'+`update public.merchant_enterprise_roles set permissions=array_remove(permissions,'attendance.self.work_arrangement') where merchant_id=${site} and id=${quote(role)};`
      +negative(call(query(),h.employeeAuthUserId,command(187800003)),'attendance_access_denied')
      +`do $security_permission_recovery$ declare before_hash text;r jsonb;begin before_hash:=${allHash};set local role service_role;r:=${call(query('self',{operationId:requestId}),h.employeeAuthUserId,null,false)};reset role;
        assert r->'receipt'->'command'=${json(original)},'security_old_receipt_recovery_without_new_permission';assert ${allHash}=before_hash,'security_recovery_wrote';end;$security_permission_recovery$;rollback to independent_permission;release independent_permission;`,
    prefix+'savepoint view_revoked;'+`update public.merchant_enterprise_roles set permissions=array['enterprise.view'] where merchant_id=${site} and id=${quote(role)};`
      +negative(call(query('self',{operationId:requestId}),h.employeeAuthUserId,null,false),'attendance_access_denied')+'rollback to view_revoked;release view_revoked;',
    prefix+negative(call(query('owner',{operationId:requestId}),d.owner,null,false),'attendance_operation_conflict'),
    prefix+'savepoint identity_changed;'+`update public.merchant_enterprise_employees set auth_user_id=${quote(id(187800004))} where merchant_id=${site} and id=${employee};`
      +negative(call(query('self',{operationId:requestId}),h.employeeAuthUserId,null,false),'attendance_access_denied')
      +negative(call(query('self',{requestId}),id(187800004),null,false),'attendance_work_arrangement_not_found')+approveCurrent
      +'rollback to identity_changed;release identity_changed;',
    prefix+'savepoint self_owner;'+`update public.merchants set user_id=${auth} where id=${site};`
      +negative(call(ownerDetail,h.employeeAuthUserId,approve),'attendance_access_denied')+'rollback to self_owner;release self_owner;',
    prefix+`do $security_final$ begin assert (select count(*) from public.merchant_attendance_work_arrangement_entries where merchant_id=${site} and request_id=${quote(requestId)})=1,'security_only_rollback_submit';end;$security_final$;set constraints all immediate;rollback;`,
  ];
  assert(stages.length<=10);try{await native.querySteps(stages.map(s=>scope.sql(s)));}
  finally{assert.equal(d.fingerprint(),baseline,'security_rollback_restore');assert.equal(d.definitions(),defs);assert.equal(d.tableCatalog(),catalog);}

  // A dedicated future request avoids altering the period/exception main flow.
  // Its history is real (not a synthesized race result), and the actual waiter
  // must be blocked by the exact holder PID before the holder can commit.
  const raceCommand=command(187800100),raceId=raceCommand.operationId;
  const protectedBefore=d.exec('select '+hashSql(names,raceId)+';');
  await work(query(),raceCommand);const beforeRead=d.fingerprint(),review=await work(query('owner',{requestId:raceId}));
  assert.equal(d.fingerprint(),beforeRead,'race_review_wrote');assert(review.detail.canApprove,'race_owner_can_approve');
  const approveRace={...approve,operationId:id(187800101),requestId:raceId,expectedConflictsFingerprint:review.detail.conflictsFingerprint};
  const withdrawRace={action:'withdraw',operationId:id(187800102),requestId:raceId,expectedRevision:1,reason:'Synthetic187 simultaneous withdraw'};
  const race=await lifecycleRace({connect:()=>native.connect(),query:sql=>native.query(sql),sql:scope.sql},
    prefix+'set local role service_role;select '+call(query('owner',{requestId:raceId}),d.owner,approveRace)+';',
    prefix+'set local role service_role;select '+call(query('self',{requestId:raceId}),h.employeeAuthUserId,withdrawRace)+';');
  assert.equal(race.witnessed,true);assert(race.right.error,'race_loser_must_reject');
  assert.match(String(race.right.error),/ERROR:\s+attendance_work_arrangement_closed(?:\s|$)/);
  const winner=JSON.parse(race.left);assert.equal(winner.receipt.command.operationId,approveRace.operationId);assert.equal(winner.receipt.item.status,'approved');
  const terminal=JSON.parse(d.exec(`select jsonb_build_object('requests',(select count(*) from public.merchant_attendance_work_arrangement_requests where merchant_id=${site} and request_id=${quote(raceId)}),
    'entries',(select count(*) from public.merchant_attendance_work_arrangement_entries where merchant_id=${site} and request_id=${quote(raceId)}),
    'loser',(select count(*) from public.merchant_attendance_work_arrangement_entries where merchant_id=${site} and operation_id=${quote(withdrawRace.operationId)}));`));
  assert.deepEqual(terminal,{requests:1,entries:2,loser:0});assert.equal(d.exec('select '+hashSql(names,raceId)+';'),protectedBefore,'race_changed_other_facts');
  assert.equal(d.definitions(),defs);assert.equal(d.tableCatalog(),catalog);
  native.pass('work arrangement private ACL/current identity/revoked permission/original recovery/self approval and exact PID approve-withdraw serialization');
  return {rollbackGroups:1,rollbackSubmitCommands:1,rejectionChecks,readonlyRecoveryChecks:1,actualRaceConnections:2,exactPidLockWitness:true,
    raceRequestRows:1,raceEntryRows:2,loserEntryRows:0,otherFactsPreserved:true,definitionsPreserved:true,tableCatalogPreserved:true,
    historicalIdentitySetup:'owned rollback-only auth rebinding',sealCompetition:false,productionAccess:false};
}
