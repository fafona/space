//174 caller-owned local acceptance ONLY. Importing this file starts nothing.
//099 rejects past publication and140 rejects past approval. These ten new rows
//are explicitly SYNTHETIC HISTORY, not actual past publications, approvals or
//clock requests. They exercise the real stored constraints and146 reader; no
//trigger, constraint, prior immutable row, function or system clock is changed.
import assert from 'node:assert/strict';
import {assertLifecycleSandbox,lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';

const ids=Object.freeze({publication:id(174700),slot:id(174701),approval:id(174702),
  rulePublication:id(174703),startEvent:id(174704),endEvent:id(174705),clockIn:id(174706),clockOut:id(174707)});
const targets=Object.freeze({
  merchant_attendance_schedule_commands:['operation_id',[ids.publication],1],
  merchant_attendance_schedule_slots:['id',[ids.slot],1],
  merchant_attendance_schedule_publication_evidence:['operation_id',[ids.publication],1],
  merchant_attendance_plan_rule_artifacts:['source_id',[ids.approval],1],
  merchant_attendance_plan_rule_operations:['operation_id',[ids.approval],1],
  merchant_attendance_plan_rule_streams:['slot_id',[ids.slot],1],
  merchant_attendance_events:['id',[ids.startEvent,ids.endEvent],2],
  merchant_attendance_shift_schedule_relations:['start_event_id',[ids.startEvent],1],
  merchant_attendance_shift_plan_adoptions:['start_event_id',[ids.startEvent],1],
});
function oldRowsFingerprintSql(names){
  assert(names.length>0&&new Set(names).size===names.length);
  return '(select md5(jsonb_object_agg(name,rows order by name)::text) from ('+names.map(name=>{
    assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name)&&name.length<=63);
    const target=targets[name],where=target?' where r.'+target[0]+' not in('+target[1].map(quote).join(',')+')':'';
    return 'select '+quote(name)+" name,(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]') from public."+name+' r'+where+') rows';
  }).join(' union all ')+') original_rows)';
}
const countsSql=()=> 'select jsonb_build_object('+Object.keys(targets).map(name=>quote(name)+
  ',(select count(*) from public.'+name+')').join(',')+');';

export async function seedPlanExceptionHistoryNative({d,native,scope}){
  assert(d?.syntheticOnly===true&&typeof d.exec==='function'&&typeof d.guard==='string');
  assert(typeof native?.query==='function'&&typeof scope?.sql==='function');
  assert.match(scope.schema,/^attendance_race_[a-f0-9]{32}$/);
  const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));
  assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
  assert.match(d.site,/^\d{8}$/);
  for(const value of [d.owner,d.otherWorker,d.otherEmployee,d.otherAuth,d.location])assert.match(value,/^[0-9a-f-]{36}$/);
  const names=d.inventory();for(const table of Object.keys(targets))assert(names.includes(table));
  const definitions=d.definitions(),catalog=d.tableCatalog(),oldRows=oldRowsFingerprintSql(names);
  const originalFingerprint=d.exec('select '+oldRows+';'),beforeCounts=JSON.parse(d.exec(countsSql()));
  const tableChecks=Object.entries(targets).map(([name,[key,values]])=>
    "assert exists(select 1 from pg_class c where c.oid='public."+name+"'::regclass and c.relnamespace="+owned.oid+
    " and c.relowner::regrole::text='postgres' and c.relrowsecurity),'history_owned_private_table_required';"+
    "assert not exists(select 1 from pg_constraint c where c.conrelid='public."+name+"'::regclass and not c.convalidated),'history_constraints_must_remain_valid';"+
    "assert not exists(select 1 from pg_trigger t where t.tgrelid='public."+name+"'::regclass and t.tgenabled<>'O'),'history_triggers_must_remain_enabled';"+
    'assert not exists(select 1 from public.'+name+' where '+key+' in('+values.map(quote).join(',')+")),'history_seed_requires_new_ids';").join('\n');
  // Same owned transaction: all ten rows commit together, or none do. The
  // archived rule-publication reference is itself synthetic (a fresh UUID),
  // never a false attribution to an existing127 operation with different rules.
  const seed=JSON.parse(d.exec(`
    do $history_seed$
    declare
      history_worker public.merchant_attendance_workers%rowtype;
      history_employee public.merchant_enterprise_employees%rowtype;
      history_location public.merchant_attendance_locations%rowtype;
      history_settings public.merchant_attendance_settings%rowtype;
      history_slot public.merchant_attendance_schedule_slots%rowtype;
      history_relation public.merchant_attendance_shift_schedule_relations%rowtype;
      plan_start timestamptz;plan_finish timestamptz;clock_start timestamptz;clock_finish timestamptz;
      publication_at timestamptz;approval_at timestamptz;new_revision bigint;
      pair jsonb;slot_refs jsonb;slot_context jsonb;rule_source jsonb;source_hash text;adoption jsonb;
      fmt3 constant text:='YYYY-MM-DD"T"HH24:MI:SS.MS"Z"';
      fmt6 constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
    begin
      ${tableChecks}
      assert current_user='postgres','history_seed_requires_owned_postgres';
      perform 1 from public.merchants where id=${quote(d.site)} and user_id=${quote(d.owner)} for share;
      assert found,'history_current_owner_required';
      select * into history_settings from public.merchant_attendance_settings where merchant_id=${quote(d.site)} for update;
      select * into history_worker from public.merchant_attendance_workers where merchant_id=${quote(d.site)} and id=${quote(d.otherWorker)} for update;
      select * into history_employee from public.merchant_enterprise_employees where merchant_id=${quote(d.site)} and id=history_worker.employee_id for share;
      select * into history_location from public.merchant_attendance_locations where merchant_id=${quote(d.site)} and id=history_worker.default_location_id for share;
      assert history_worker.id=${quote(d.otherWorker)} and history_worker.employee_id=${quote(d.otherEmployee)}
        and history_employee.auth_user_id=${quote(d.otherAuth)} and history_worker.active and history_employee.status='active'
        and history_location.id=${quote(d.location)} and history_location.time_zone='UTC' and history_settings.version>0,
        'history_existing_current_bound_worker_required';
      assert not exists(select 1 from public.merchant_attendance_events where merchant_id=${quote(d.site)} and worker_id=history_worker.id),
        'history_worker_must_have_no_prior_events';
      plan_start:=(((clock_timestamp() at time zone 'UTC')::date-2)::timestamp+interval '8 hours') at time zone 'UTC';
      plan_finish:=plan_start+interval '2 hours';clock_start:=plan_start+interval '15 minutes';clock_finish:=plan_finish-interval '25 minutes';
      publication_at:=plan_start-interval '48 hours';approval_at:=plan_start-interval '1 hour';
      select coalesce(max(c.revision),0)+1 into new_revision from public.merchant_attendance_schedule_commands c where c.merchant_id=${quote(d.site)};
      pair:=jsonb_build_array(to_char(plan_start at time zone 'UTC',fmt3),to_char(plan_finish at time zone 'UTC',fmt3));
      insert into public.merchant_attendance_schedule_commands(merchant_id,revision,operation_id,actor_auth_user_id,query,command,recorded_at)
        values(${quote(d.site)},new_revision,${quote(ids.publication)},${quote(d.owner)},
          jsonb_build_object('siteId',${quote(d.site)},'access','owner','workerId',history_worker.id,'fromDate',to_char(plan_start at time zone 'UTC','YYYY-MM-DD'),
            'throughDate',to_char(plan_start at time zone 'UTC','YYYY-MM-DD'),'operationId',null),
          jsonb_build_object('operationId',${quote(ids.publication)},'expectedRevision',new_revision-1,'expectedSettingsVersion',history_settings.version,
            'reason','Synthetic historical fixture, not an actual past publication','action','publish','locationId',history_location.id,'timeZone','UTC','slots',jsonb_build_array(pair)),publication_at);
      insert into public.merchant_attendance_schedule_slots(merchant_id,id,revision,worker_id,employee_id,worker_name,location_id,location_name,time_zone,work_date,start_at,end_at)
        values(${quote(d.site)},${quote(ids.slot)},new_revision,history_worker.id,history_employee.id,history_worker.display_name,
          history_location.id,history_location.name,'UTC',(plan_start at time zone 'UTC')::date,plan_start,plan_finish) returning * into history_slot;
      slot_refs:=jsonb_build_array(jsonb_build_object('id',history_slot.id,'workDate',to_char(history_slot.work_date,'YYYY-MM-DD'),'startAt',pair->0,'endAt',pair->1));
      insert into public.merchant_attendance_schedule_publication_evidence(merchant_id,revision,operation_id,actor_auth_user_id,worker_id,employee_id,employee_auth_user_id,
        identity_status,worker_version,location_id,location_version,settings_version,time_zone,slots,published_at,recorded_at,capture_policy)
        values(${quote(d.site)},new_revision,${quote(ids.publication)},${quote(d.owner)},history_worker.id,history_employee.id,history_employee.auth_user_id,
          'bound',history_worker.version,history_location.id,history_location.version,history_settings.version,'UTC',slot_refs,publication_at,publication_at,'publish-identity-context-v1');
      slot_context:=public.faolla_attendance_self_schedule_slot_v1(history_slot);
      assert slot_context->'slot'->'hasPublicationEvidence'='true'::jsonb,'history_publication_must_validate';
      rule_source:=jsonb_build_object('protocol','plan-rule-point-v1','policy','owner-approved-plan-start-v1','siteId',${quote(d.site)},
        'workerId',history_worker.id,'employeeId',history_employee.id,'employeeAuthUserId',history_employee.auth_user_id,
        'workerVersion',history_worker.version,'settingsVersion',history_settings.version,'timeZone','UTC',
        'slot',jsonb_build_object('id',history_slot.id,'revision',history_slot.revision,'locationId',history_location.id,
          'locationVersion',history_location.version,'timeZone','UTC','startAt',pair->0,'endAt',pair->1),
        'assignment',null,'group',null,'personal',jsonb_build_object('revision',0,'approval',null),
        'enterprise',jsonb_build_object('revision',2,'publication',jsonb_build_object('operationId',${quote(ids.rulePublication)},'revision',2,
          'actorId',${quote(d.owner)},'recordedAt',to_char((plan_start-interval '72 hours') at time zone 'UTC',fmt6),
          'effectiveAt',to_char((plan_start-interval '24 hours') at time zone 'UTC',fmt3),
          'rules',jsonb_build_object('lateGraceMinutes',jsonb_build_object('mode','value','minutes',0),'earlyGraceMinutes',jsonb_build_object('mode','value','minutes',10)))));
      rule_source:=rule_source||jsonb_build_object('fields',public.faolla_attendance_plan_rule_fields_v1(rule_source));
      assert public.faolla_attendance_plan_rule_source_v1(rule_source),'history_fixed_source_must_validate';
      source_hash:=encode(sha256(convert_to(rule_source::text,'UTF8')),'hex');
      insert into public.merchant_attendance_plan_rule_artifacts(merchant_id,source_id,worker_id,slot_id,employee_id,employee_auth_user_id,source,source_sha256,source_bytes)
        values(${quote(d.site)},${quote(ids.approval)},history_worker.id,history_slot.id,history_employee.id,history_employee.auth_user_id,
          rule_source,source_hash,octet_length(convert_to(rule_source::text,'UTF8')));
      insert into public.merchant_attendance_plan_rule_operations(merchant_id,operation_id,worker_id,slot_id,revision,actor_auth_user_id,
        employee_id,employee_auth_user_id,command,source_id,observed_at,recorded_at)
        values(${quote(d.site)},${quote(ids.approval)},history_worker.id,history_slot.id,1,${quote(d.owner)},history_employee.id,history_employee.auth_user_id,
          jsonb_build_object('operationId',${quote(ids.approval)},'expectedRevision',0,'expectedFingerprint',source_hash,'employeeId',history_employee.id,
            'employeeAuthUserId',history_employee.auth_user_id,'reason','Synthetic historical fixture, not an actual past approval'),${quote(ids.approval)},approval_at,approval_at);
      insert into public.merchant_attendance_plan_rule_streams(merchant_id,slot_id,worker_id,employee_id,employee_auth_user_id,revision)
        values(${quote(d.site)},history_slot.id,history_worker.id,history_employee.id,history_employee.auth_user_id,1);
      insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,break_paid,occurred_at,received_at,time_zone,actor_employee_id)
        values(${quote(ids.startEvent)},${quote(d.site)},history_worker.id,history_location.id,${quote(ids.clockIn)},1,'clock_in','web',null,clock_start,clock_start,'UTC',history_employee.id),
          (${quote(ids.endEvent)},${quote(d.site)},history_worker.id,history_location.id,${quote(ids.clockOut)},2,'clock_out','web',null,clock_finish,clock_finish,'UTC',history_employee.id);
      insert into public.merchant_attendance_shift_schedule_relations(merchant_id,start_event_id,worker_id,operation_id,sequence,location_id,occurred_at,event_time_zone,
        employee_id,employee_auth_user_id,worker_version,location_version,settings_version,selection,slot_id,slot_revision,schedule_revision,status,reason,
        slot_snapshot,publication_snapshot,cancellation_snapshot,recorded_at,binding_policy)
        values(${quote(d.site)},${quote(ids.startEvent)},history_worker.id,${quote(ids.clockIn)},1,history_location.id,clock_start,'UTC',history_employee.id,
          history_employee.auth_user_id,history_worker.version,history_location.version,history_settings.version,jsonb_build_object('slotId',history_slot.id,'revision',new_revision),
          history_slot.id,new_revision,new_revision,'linked',null,slot_context->'slot',slot_context->'publication',null,clock_start,'employee-explicit-clock-in-v1') returning * into history_relation;
      adoption:=public.faolla_attendance_shift_plan_adoption_v1(history_relation,history_employee.auth_user_id,null,true,'self');
      assert adoption->>'status'='adopted' and adoption->'approval'->>'operationId'=${quote(ids.approval)},'history_fixed_adoption_must_validate';
      insert into public.merchant_attendance_shift_plan_adoptions(merchant_id,start_event_id,worker_id,operation_id,employee_id,employee_auth_user_id,
        channel,slot_id,approval_operation_id,adoption,recorded_at)
        values(${quote(d.site)},${quote(ids.startEvent)},history_worker.id,${quote(ids.clockIn)},history_employee.id,history_employee.auth_user_id,
          'self',history_slot.id,${quote(ids.approval)},adoption,clock_start);
    end;
    $history_seed$;
    set constraints all immediate;
    select jsonb_build_object('slot',public.faolla_attendance_self_schedule_slot_v1(s)->'slot','sourceSha256',a.source_sha256)
      from public.merchant_attendance_schedule_slots s join public.merchant_attendance_plan_rule_artifacts a
        on a.merchant_id=s.merchant_id and a.slot_id=s.id where s.merchant_id=${quote(d.site)} and s.id=${quote(ids.slot)};
  `));
  assert.equal(d.exec('select '+oldRows+';'),originalFingerprint,'history_seed_changed_existing_rows');
  assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  const afterCounts=JSON.parse(d.exec(countsSql()));
  for(const [name,[,,count]] of Object.entries(targets))assert.equal(afterCounts[name]-beforeCounts[name],count,'history_seed_unexpected_row_count:'+name);
  const query={siteId:d.site,workerId:d.otherWorker,slotId:ids.slot};
  const readFingerprint=d.fingerprint();
  const sourceRaw=JSON.parse(d.exec('set local role service_role;select public.faolla_attendance_plan_exception_source_v1('+quote(JSON.stringify(query))+'::jsonb,'+quote(d.owner)+');'));
  assert.equal(d.fingerprint(),readFingerprint,'history_source_read_wrote_rows');
  assert.equal(sourceRaw.eligible,true);assert.deepEqual(sourceRaw.blockers,[]);
  assert.deepEqual(sourceRaw.candidate.late,{state:'triggered',minutes:0,rawDeltaUs:'900000000',excessUs:'900000000'});
  assert.deepEqual(sourceRaw.candidate.early,{state:'triggered',minutes:10,rawDeltaUs:'1500000000',excessUs:'900000000'});
  return {query,slot:seed.slot,ownerId:d.owner,employeeId:d.otherEmployee,employeeAuthUserId:d.otherAuth,
    workerId:d.otherWorker,startEventId:ids.startEvent,lastEventId:ids.endEvent,operationId:ids.clockIn,
    approvalOperationId:ids.approval,sourceId:ids.approval,sourceSha256:seed.sourceSha256,sourceRaw,
    syntheticHistoricalRows:10,syntheticOnly:true,actualHistoricalPublication:false,actualHistoricalApproval:false,actualClockRequests:false,
    existingRowsUnchanged:true,definitionsAndCatalogUnchanged:true,allConstraintsAndTriggersEnabled:true,actualSourceRead:true,
    fixtureDisclosure:'Ten append-only synthetic historical rows under all existing guards; not an actual past publication, approval or clock-in. The146 read is real SQL.',
    callerOwnsRuntimeAndCleanup:true};
}
