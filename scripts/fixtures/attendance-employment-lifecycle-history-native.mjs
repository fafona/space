//196 historical preconditions are explicitly synthetic INSERTs, not an assertion
//that an overnight close occurred. Only166 rejoin,164 restore,111 fresh clocks
//and subsequent reads execute real RPCs. ONE transaction, all rows rolled back.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
const require=createRequire(import.meta.url),fid=n=>id(196900000+n);
const factHash=names=>`(select md5(jsonb_object_agg(elh_name,elh_rows order by elh_name)::text) from (${names.map(name=>{
  assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name));
  return `select ${quote(name)} elh_name,(select coalesce(jsonb_agg(to_jsonb(elh_row) order by to_jsonb(elh_row)::text),'[]') from public.${name} elh_row) elh_rows`;
}).join(' union all ')}) elh_tables)`;
export async function verifyEmploymentLifecycleHistoricalRejoin({d,h,native,scope}){
  assert(d.syntheticOnly&&h.syntheticOnly);assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
  const names=d.inventory(),all=()=>d.fingerprint(names),baseline=all(),defs=d.definitions(),catalog=d.tableCatalog();
  const indexes=()=>d.exec(`select md5(coalesce(string_agg(indexdef,'' order by indexname),'')) from pg_indexes where schemaname=${quote(scope.schema)};`),oldIndexes=indexes();
  const site='99990179',owner=d.owner,employee=fid(1),auth=fid(2),worker=fid(3),role=fid(4),location=fid(5),period=fid(6),suspension=fid(7),closed=fid(8),start=fid(9),end=fid(10),rejoin=fid(11),restore=fid(12);
  const q={siteId:site,mode:'detail',workerId:worker,afterId:null,afterRevision:null,operationId:null};
  const rq={siteId:site,mode:'recover',workerId:null,afterId:null,afterRevision:null,operationId:rejoin};
  const query=json(q),hash=factHash(names),prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
  const rpc=(querySql=query,command='null')=>`public.faolla_attendance_employment_lifecycle_v1(${querySql},${quote(owner)},${command},true)`;
  const stage=(label,sql)=>`${prefix}${sql}set constraints all immediate;set constraints all deferred;select jsonb_build_object('kind','stage','label',${quote(label)});`;
  const steps=['begin;'+stage('synthetic_closed_off_history',`
    do $elh_seed$ declare yesterday date:=(clock_timestamp() at time zone 'UTC')::date-1;c jsonb;begin
      assert not exists(select 1 from public.merchants where id=${quote(site)}),'elh_unused_synthetic_site';
      insert into public.merchants(id,user_id,name,email) values(${quote(site)},${quote(owner)},'Synthetic196 historical premise','synthetic196-history@example.test');
      insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled,web_break_paid,version) values(${quote(site)},'UTC',true,true,false,2);
      insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values(${quote(role)},${quote(site)},'Synthetic196 history role',array['enterprise.view','attendance.self.view','attendance.self.clock','attendance.self.export']);
      insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,accepted_at,version)
        values(${quote(employee)},${quote(site)},${quote(auth)},'synthetic196-history-member@example.test','Synthetic historical member',${quote(role)},'active',yesterday::timestamp at time zone 'UTC',3);
      insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values(${quote(location)},${quote(site)},'Synthetic historical place','UTC',true);
      insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id,active,version)
        values(${quote(worker)},${quote(site)},${quote(employee)},'SYNTHETIC196-HISTORY','Synthetic historical worker',${quote(location)},false,3);
      insert into public.merchant_attendance_employment_periods(id,merchant_id,worker_id,starts_on,ends_on) values(${quote(period)},${quote(site)},${quote(worker)},'2000-01-01',yesterday);
      insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,break_paid,occurred_at,received_at,time_zone,actor_employee_id)
        values(${quote(start)},${quote(site)},${quote(worker)},${quote(location)},${quote(fid(13))},1,'clock_in','web',null,(yesterday+time '08:00') at time zone 'UTC',(yesterday+time '08:00') at time zone 'UTC','UTC',${quote(employee)}),
        (${quote(end)},${quote(site)},${quote(worker)},${quote(location)},${quote(fid(14))},2,'clock_out','web',null,(yesterday+time '16:00') at time zone 'UTC',(yesterday+time '16:00') at time zone 'UTC','UTC',${quote(employee)});
      insert into public.merchant_attendance_account_suspensions(merchant_id,suspension_id,employee_id,employee_auth_user_id,employee_name,generation,worker_id,worker_name,was_active,worker_version,employee_version,
        original_event_id,original_sequence,original_action,original_actor_employee_id,actor_auth_user_id,actor_employee_id,pin_revision_before,pin_revision_after,pin_invalidated,delegations_invalidated,recorded_at)
        values(${quote(site)},${quote(suspension)},${quote(employee)},${quote(auth)},'Synthetic historical member',1,${quote(worker)},'Synthetic historical worker',true,1,2,
          ${quote(end)},2,'clock_out',${quote(employee)},${quote(owner)},null,null,null,false,true,(yesterday+time '17:00') at time zone 'UTC');
      insert into public.merchant_attendance_account_epochs(merchant_id,employee_id,generation,suspension_id,paused,updated_at)
        values(${quote(site)},${quote(employee)},1,${quote(suspension)},true,(yesterday+time '17:00') at time zone 'UTC');
      c:=jsonb_build_object('action','close','operationId',${quote(closed)},'workerId',${quote(worker)},'employeeId',${quote(employee)},'employeeAuthUserId',${quote(auth)},
        'expectedWorkerVersion',2,'expectedEmployeeVersion',2,'expectedSettingsVersion',1,'expectedRevision',0,'expectedPeriodId',${quote(period)},'suspensionId',${quote(suspension)},'expectedGeneration',1,
        'expectedDate',yesterday::text,'reason','Synthetic historical close premise, not a real overnight action');
      insert into public.merchant_attendance_employment_operations(merchant_id,operation_id,worker_id,employee_id,employee_auth_user_id,actor_auth_user_id,revision,action,period_id,starts_on,ends_on,
        suspension_id,generation,time_zone,command,command_fingerprint,recorded_at)
        values(${quote(site)},${quote(closed)},${quote(worker)},${quote(employee)},${quote(auth)},${quote(owner)},1,'close',${quote(period)},'2000-01-01',yesterday,${quote(suspension)},1,'UTC',c,
          public.faolla_attendance_employment_hash_v1(${quote(site)},c),(yesterday+time '18:00') at time zone 'UTC');
      perform set_config('qa_elh.old_events',(select jsonb_agg(to_jsonb(el_event) order by sequence)::text from public.merchant_attendance_events el_event where merchant_id=${quote(site)}),true);
    end;$elh_seed$;`),
    stage('current_read_zero_writes',`do $elh_read$ declare before_hash text;r jsonb;c jsonb;begin
      before_hash:=${hash};set local role service_role;r:=${rpc()};reset role;assert ${hash}=before_hash,'elh_read_wrote';
      assert r->'detail'->'canRejoin'='true'::jsonb and r->'detail'->>'currentAction'='clock_out','elh_real_current_readiness';
      c:=jsonb_build_object('action','rejoin','operationId',${quote(rejoin)},'workerId',${quote(worker)},'employeeId',${quote(employee)},'employeeAuthUserId',${quote(auth)},
        'expectedWorkerVersion',r->'detail'->'worker'->'version','expectedEmployeeVersion',r->'detail'->'worker'->'employeeVersion','expectedSettingsVersion',r->'detail'->'settingsVersion',
        'expectedRevision',r->'detail'->'revision','expectedPeriodId',${quote(period)},'suspensionId',${quote(suspension)},'expectedGeneration',1,'expectedDate',r->'detail'->>'today','reason','Synthetic196 real rejoin after historical off premise');
      perform set_config('qa_elh.command',c::text,true);
    end;$elh_read$;`),
    stage('actual_rejoin',`set local role service_role;select jsonb_build_object('kind','rejoin','command',current_setting('qa_elh.command')::jsonb,'result',${rpc(query,"current_setting('qa_elh.command')::jsonb")});reset role;`),
    stage('actual_restore',`do $elh_restore$ declare r jsonb;c jsonb;before_hash text;begin
      before_hash:=${hash};set local role service_role;r:=public.faolla_attendance_account_suspensions_v1(${json({siteId:site,mode:'detail',afterId:null,suspensionId:suspension,operationId:null})},${quote(owner)},null,true);reset role;
      assert ${hash}=before_hash,'elh_restore_preview_wrote';assert r->'detail'->'canRestore'='true'::jsonb,'elh_restore_eligible';
      c:=jsonb_build_object('action','restore','operationId',${quote(restore)},'suspensionId',${quote(suspension)},'expectedGeneration',1,'workerId',${quote(worker)},
        'expectedWorkerVersion',r->'detail'->'workerVersion','expectedEmployeeVersion',r->'detail'->'employeeVersion','employeeId',${quote(employee)},'employeeAuthUserId',${quote(auth)},'reason','Synthetic196 actual restore after real rejoin');
      set local role service_role;r:=public.faolla_attendance_account_suspensions_v1(${json({siteId:site,mode:'detail',afterId:null,suspensionId:suspension,operationId:null})},${quote(owner)},c,true);reset role;
      assert r->'receipt'->'workerActive'='true'::jsonb,'elh_actual_restored';
    end;$elh_restore$;`),
    stage('actual_new_shift',`set local role service_role;do $elh_clock$ declare r jsonb;begin
      r:=public.faolla_attendance_self_v1(${quote(site)},${quote(auth)},${json({operationId:fid(15),expectedWorkerId:worker,locationId:location,action:'clock_in',expectedSequence:2})},null);
      assert r->'state'->>'status'='working' and r->'receipt'->>'sequence'='3','elh_new_shift_not_old_tail';
      r:=public.faolla_attendance_self_v1(${quote(site)},${quote(auth)},${json({operationId:fid(16),expectedWorkerId:worker,locationId:location,action:'clock_out',expectedSequence:3})},null);
      assert r->'state'->>'status'='off' and r->'receipt'->>'sequence'='4','elh_new_shift_finished';
    end;$elh_clock$;reset role;`),
    stage('original_history_and_recover',`do $elh_final$ declare before_hash text;r jsonb;begin
      assert (select jsonb_agg(to_jsonb(el_event) order by sequence) from public.merchant_attendance_events el_event where merchant_id=${quote(site)} and sequence<=2)=current_setting('qa_elh.old_events')::jsonb,'elh_original_history_unchanged';
      before_hash:=${hash};set local role service_role;r:=${rpc(json(rq))};reset role;assert ${hash}=before_hash,'elh_recovery_wrote';
      assert r->'receipt'->>'operationId'=${quote(rejoin)},'elh_real_rejoin_receipt';
      set local role service_role;r:=public.faolla_attendance_period_report_v2(${quote(site)},${quote(owner)},jsonb_build_object('workerId',${quote(worker)},'fromDate',((clock_timestamp() at time zone 'UTC')::date-1)::text,'throughDate',((clock_timestamp() at time zone 'UTC')::date-1)::text));reset role;
      assert jsonb_array_length(r->'items')=1 and jsonb_array_length(r->'items'->0->'events')=2,'elh_old_period_original_session';assert ${hash}=before_hash,'elh_old_report_wrote';
    end;$elh_final$;`),prefix+'set constraints all immediate;rollback;'];
  let rows;
  try{rows=(await native.querySteps(steps.map(scope.sql))).split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));}
  finally{assert.equal(all(),baseline,'elh_all_facts_rollback');assert.equal(d.definitions(),defs);assert.equal(d.tableCatalog(),catalog);assert.equal(indexes(),oldIndexes);}
  const actual=rows.find(x=>x.kind==='rejoin');assert(actual);
  const {parseEmploymentLifecycleResult,employmentLifecycleCommandFingerprint}=require('../../src/lib/merchantAttendanceEmploymentLifecycle.ts');
  const result=parseEmploymentLifecycleResult(actual.result,q,owner,actual.command);assert.equal(result.receipt.commandFingerprint,await employmentLifecycleCommandFingerprint(site,actual.command));
  native.pass('synthetic historical closed/off premise; actual166 rejoin,164 restore,111 new sequence and old report preserved; full outer rollback');
  return {syntheticHistoricalPrerequisites:true,actualHistoricalClose:false,realRejoin:true,realRestore:true,realNewClockActions:2,oldRawEventsPreserved:true,rollbackRestored:true};
}
