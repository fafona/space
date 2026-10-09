//193 inert restore qualification probes. ONE outer rollback in the caller's
//owned synthetic namespace. Genuine status RPCs create the pause; no successful
//receipt is copied or forged. Configuration perturbations are test-only facts.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
const require=createRequire(import.meta.url);
const fid=n=>id(193910000+n);
function factHashSql(names){
  assert(names.length&&new Set(names).size===names.length);
  return '(select md5(jsonb_object_agg(ars_name,ars_rows order by ars_name)::text) from ('+names.map(name=>{
    assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name));
    return `select ${quote(name)} ars_name,(select coalesce(jsonb_agg(to_jsonb(ars_row) order by to_jsonb(ars_row)::text),'[]') from public.${name} ars_row) ars_rows`;
  }).join(' union all ')+') ars_tables)';
}
export function accountSuspensionRestoreSecurityPlan({site,owner,employeeId,employeeAuthUserId,workerId,nonOwner,otherSite}){
  assert(/^\d{8}$/.test(site)&&/^\d{8}$/.test(otherSite)&&site!==otherSite);
  for(const value of [owner,employeeId,employeeAuthUserId,workerId,nonOwner])assert(/^[0-9a-f-]{36}$/.test(value));
  assert.notEqual(owner,nonOwner);
  return {site,owner,employeeId,employeeAuthUserId,workerId,nonOwner,otherSite,stopOperation:fid(1),activeOperation:fid(2),restoreOperation:fid(3),replacementAuth:fid(4),
    variants:[['auth_replaced','binding_changed'],['worker_binding_removed','binding_changed'],['role_clock_revoked','role_invalid'],
      ['settings_disabled','settings_disabled'],['location_disabled','location_invalid'],['employment_ended','employment_invalid']]};
}
export async function verifyAccountSuspensionRestoreSecurityNative({d,h,native,scope}){
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true&&typeof native?.querySteps==='function');
  const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);assert.equal(scope.schema,owned.schema);
  const baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();
  const other=JSON.parse(d.exec(`select jsonb_build_object('site',(select m.id from public.merchants m where m.id<>${quote(d.site)}
    and not coalesce(${quote(d.owner)}::uuid=any(array[m.user_id,m.auth_user_id,m.owner_user_id,m.owner_id,m.auth_id,m.created_by,m.created_by_user_id]),false) order by m.id limit 1));`));
  assert.equal(d.fingerprint(),baseline,'restore_security_discovery_zero_writes');
  const p=accountSuspensionRestoreSecurityPlan({site:d.site,owner:d.owner,employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,workerId:h.workerId,nonOwner:h.employeeAuthUserId,otherSite:other.site});
  const site=quote(p.site),owner=quote(p.owner),employee=quote(p.employeeId),worker=quote(p.workerId),hash=factHashSql(d.inventory());
  const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
  const q="current_setting('qa_restore_security.query')::jsonb",command="current_setting('qa_restore_security.command')::jsonb";
  const rpc=(query=q,actor=owner,c='null')=>`public.faolla_attendance_account_suspensions_v1(${query},${actor},${c},true)`;
  const status=(state,op)=>`public.faolla_update_merchant_enterprise_employee_v1(jsonb_build_object('merchant_id',${site},'employee_id',${employee},
    'expected_version',v,'actor_type','owner','actor_id',${owner},'status',${quote(state)},'attendance_operation_id',${quote(op)},'attendance_suspension_enabled',true)${state==='disabled'?"||jsonb_build_object('offboarding_mode','unassign')":''})`;
  const prepare=`begin;${prefix}
    do $restore_security_prepare$ declare v bigint;r jsonb;receipt jsonb;dq jsonb;dc jsonb;begin
      assert exists(select 1 from public.faolla_schema_migrations where version=202610060164),'restore_security164_required';
      assert not exists(select 1 from public.merchant_enterprise_employees where auth_user_id=${quote(p.replacementAuth)}),'restore_security_new_auth_unused';
      assert exists(select 1 from public.merchant_enterprise_employees e join public.merchant_attendance_workers w on w.merchant_id=e.merchant_id and w.employee_id=e.id
        where e.merchant_id=${site} and e.id=${employee} and e.auth_user_id=${quote(p.employeeAuthUserId)} and e.status='active' and e.accepted_at is not null and w.id=${worker} and w.active),'restore_security_current_active_same_identity';
      assert not exists(select 1 from public.merchant_attendance_account_epochs where merchant_id=${site} and employee_id=${employee} and paused),'restore_security_no_prior_open_pause';
      select version into v from public.merchant_enterprise_employees where merchant_id=${site} and id=${employee};
      set local role service_role;r:=${status('disabled',p.stopOperation)};reset role;
      assert r->'employee'->>'status'='disabled','restore_security_real_stop';
      select version into v from public.merchant_enterprise_employees where merchant_id=${site} and id=${employee};
      set local role service_role;r:=${status('active',p.activeOperation)};
      receipt:=${rpc(json({siteId:p.site,mode:'recover-status',afterId:null,suspensionId:null,operationId:p.stopOperation}))};
      dq:=jsonb_build_object('siteId',${site},'mode','detail','afterId',null,'suspensionId',receipt->'statusReceipt'->'suspensionId','operationId',null);
      r:=${rpc('dq')};reset role;
      assert r->'detail'->'canRestore'='true'::jsonb and r->'detail'->'blockers'='[]'::jsonb,'restore_security_real_restore_eligible';
      assert r->'detail'->'suspension'->>'employeeAuthUserId'=${quote(p.employeeAuthUserId)} and r->'detail'->'suspension'->>'workerId'=${quote(p.workerId)},'restore_security_saved_identity';
      dc:=jsonb_build_object('action','restore','operationId',${quote(p.restoreOperation)},'suspensionId',dq->'suspensionId',
        'expectedGeneration',r->'detail'->'suspension'->'generation','workerId',r->'detail'->'suspension'->'workerId',
        'expectedWorkerVersion',r->'detail'->'workerVersion','expectedEmployeeVersion',r->'detail'->'employeeVersion',
        'employeeId',${employee},'employeeAuthUserId',${quote(p.employeeAuthUserId)},'reason','Synthetic193 original identity restoration security');
      perform set_config('qa_restore_security.query',dq::text,true);perform set_config('qa_restore_security.command',dc::text,true);
      perform set_config('qa_restore_security.result',r::text,true);
    end;$restore_security_prepare$;set constraints all immediate;
    select jsonb_build_object('kind','eligible','query',${q},'value',current_setting('qa_restore_security.result')::jsonb,'command',${command});`;
  const mutations={
    auth_replaced:`update public.merchant_enterprise_employees set auth_user_id=${quote(p.replacementAuth)} where merchant_id=${site} and id=${employee};`,
    worker_binding_removed:`update public.merchant_attendance_workers set employee_id=null where merchant_id=${site} and id=${worker};`,
    role_clock_revoked:`update public.merchant_enterprise_roles set permissions=array_remove(permissions,'attendance.self.clock') where merchant_id=${site}
      and id=(select role_id from public.merchant_enterprise_employees where merchant_id=${site} and id=${employee});`,
    settings_disabled:`update public.merchant_attendance_settings set enabled=false where merchant_id=${site};`,
    location_disabled:`update public.merchant_attendance_locations set active=false where merchant_id=${site}
      and id=(select default_location_id from public.merchant_attendance_workers where merchant_id=${site} and id=${worker});`,
    employment_ended:`do $restore_security_employment$ declare today date;n integer;begin
      select (clock_timestamp() at time zone time_zone)::date into today from public.merchant_attendance_settings where merchant_id=${site};
      assert (select count(*) from public.merchant_attendance_employment_periods where merchant_id=${site} and worker_id=${worker} and starts_on<today and (ends_on is null or ends_on>=today))=1,'restore_security_endable_current_period';
      update public.merchant_attendance_employment_periods set ends_on=today-1 where merchant_id=${site} and worker_id=${worker} and starts_on<today and (ends_on is null or ends_on>=today);
      get diagnostics n=row_count;assert n=1,'restore_security_one_employment_ended';
    end;$restore_security_employment$;`,
  };
  const blocked=(label,blocker)=>`${prefix}savepoint ${label};${mutations[label]}set constraints all immediate;
    do $restore_security_blocked$ declare before_hash text;r jsonb;dc jsonb;begin
      before_hash:=${hash};set local role service_role;r:=${rpc()};reset role;
      assert r->'detail'->'canRestore'='false'::jsonb and r->'detail'->'blockers' ? ${quote(blocker)},${quote('restore_security_actual_blocker_'+label)};
      --Match current CAS where still present so a stale member/role version is
      --not mistaken for proof of the qualification guard. A missing binding has
      --no valid worker version; retain its original command and report that fact.
      dc:=jsonb_set(${command},'{expectedEmployeeVersion}',r->'detail'->'employeeVersion');
      if r->'detail'->'workerVersion'<>'null'::jsonb then dc:=jsonb_set(dc,'{expectedWorkerVersion}',r->'detail'->'workerVersion');end if;
      begin set local role service_role;perform ${rpc(q,owner,'dc')};reset role;raise exception 'restore_security_expected_denial_missing';
      exception when raise_exception then reset role;if sqlerrm<>'attendance_account_suspension_changed' then raise;end if;end;
      assert not exists(select 1 from public.merchant_attendance_account_restores where merchant_id=${site} and operation_id=${quote(p.restoreOperation)}),'restore_security_no_restore_receipt';
      assert ${hash}=before_hash,${quote('restore_security_zero_writes_'+label)};
      perform set_config('qa_restore_security.result',r::text,true);perform set_config('qa_restore_security.attempt',dc::text,true);
    end;$restore_security_blocked$;
    select jsonb_build_object('kind','blocked','label',${quote(label)},'blocker',${quote(blocker)},'query',${q},'value',current_setting('qa_restore_security.result')::jsonb,'command',current_setting('qa_restore_security.attempt')::jsonb);
    rollback to ${label};release ${label};`;
  const denied=(label,query,actor)=>`${prefix}do $restore_security_authority$ declare before_hash text;begin
    before_hash:=${hash};begin set local role service_role;perform ${rpc(query,actor)};reset role;raise exception 'restore_security_expected_access_denial';
      exception when raise_exception then reset role;if sqlerrm<>'attendance_access_denied' then raise;end if;end;
    assert ${hash}=before_hash,${quote('restore_security_access_zero_writes_'+label)};
    end;$restore_security_authority$;select jsonb_build_object('kind','denied','label',${quote(label)});`;
  const steps=[prepare,...p.variants.map(([label,blocker])=>blocked(label,blocker)),
    denied('non_owner',q,quote(p.nonOwner))+denied('other_merchant',`jsonb_set(${q},'{siteId}',to_jsonb(${quote(p.otherSite)}::text))`,owner),
    `${prefix}set constraints all immediate;rollback;`];
  assert(steps.length<=10);let rows;const failures=[];
  try{rows=(await native.querySteps(steps.map((step,index)=>scope.sql(`--restore_security_stage_${index+1}\n`+step)))).trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));}
  catch(error){failures.push(error);}
  finally{for(const [label,run,expected] of [['restore_security_all_facts',()=>d.fingerprint(),baseline],['restore_security_definitions',()=>d.definitions(),definitions],['restore_security_catalog',()=>d.tableCatalog(),catalog]]){
    try{assert.equal(run(),expected,label);}catch(error){failures.push(error);}}}
  if(failures.length)throw new AggregateError(failures,'account_suspension_restore_security_failed: '+failures.map(error=>error.message).join(' | '));
  const {parseAccountSuspensionResult,parseAccountSuspensionCommand}=require('../../src/lib/merchantAttendanceAccountSuspension.ts');
  assert.equal(rows.filter(r=>r.kind==='eligible').length,1);assert.equal(rows.filter(r=>r.kind==='blocked').length,6);assert.equal(rows.filter(r=>r.kind==='denied').length,2);
  for(const row of rows.filter(r=>r.kind!=='denied')){const parsed=parseAccountSuspensionResult(row.value,row.query,p.owner);parseAccountSuspensionCommand(row.command);
    assert.equal(parsed.detail.canRestore,row.kind==='eligible');assert.equal(parsed.receipt,null);if(row.kind==='blocked')assert(parsed.detail.blockers.includes(row.blocker));}
  native.pass('six current restoration qualification changes fail closed with parsed detail and zero-write rejections; non-owner/cross-merchant reads rejected; all probes roll back');
  return {outerRollbackTransactions:1,realEmployeeStatusWrites:2,realRestoreWrites:0,qualificationScenarios:p.variants.map(([label])=>label),
    qualificationReads:7,qualificationRejections:6,accessRejections:2,allDetailsStrictlyParsed:true,currentVersionsUsedWhenPresent:true,
    missingWorkerCannotSupplyCurrentCas:true,oldImmutableTailNotMutated:true,oldTailIdentityDamageSimulated:false,
    allFactsDefinitionsCatalogRestored:true,fixture:'One genuine stop and one genuine membership reactivation, with six explicitly synthetic reversible current-state perturbations. No old event update, fabricated receipt, disabled guard, new environment or production access.'};
}
