// Local owned-schema setup only. Password authentication/acceptance is synthetic;
// all attendance events and receipts must come later from actual UI handlers.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {assertLifecycleSandbox,lifecycleId as id} from './merchant-attendance-lifecycle-native-support.mjs';

const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const consts=freeze({site:'99990001',employees:{a:id(101),b:id(102)},workers:{a:id(201),b:id(202)},authUsers:{a:id(1),b:id(2)},place:id(301),
  labels:{a:'合成员工甲',b:'合成员工乙',workerA:'SYNTHETIC-103',workerB:'SYNTHETIC-109-B'}});
const migrationNames=['202609300068_merchant_attendance_self_history.sql','202610020110_merchant_attendance_self_history_identity.sql'];
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";

export function accountSwitchFixturePlan(root){
  assert.equal(typeof root,'string');assert(path.isAbsolute(root),'account_switch_absolute_root_required');
  return migrationNames.map(name=>({name,source:readFileSync(path.join(root,'scripts/supabase-migrations',name),'utf8')}));
}

export function redactAccountSwitchDiagnostics(value){
  return String(value instanceof Error?value.stack??value.message:value)
    .replaceAll('Synthetic-attendance-only!','[synthetic-password-redacted]')
    .replace(/eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[jwt-redacted]')
    .replace(/((?:access_token|refresh_token|password)\s*["']?\s*[:=]\s*["']?)[^\s"',}]+/gi,'$1[auth-value-redacted]');
}

export async function prepareAttendanceAccountSwitch(native,scope){
  assert.equal(typeof native.query,'function');assert.equal(typeof scope.sql,'function');
  const exec=source=>native.query(scope.sql(source)),owned=assertLifecycleSandbox(exec);
  assert.equal(scope.schema,owned.schema,'account_switch_scope_mismatch');
  const plan=accountSwitchFixturePlan(native.root),c=consts;
  const ownedGuard=`do $owned$ begin
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.oid='public.merchants'::regclass and c.oid=${owned.tableOid} and n.oid=${owned.oid}
        and n.nspname=${literal(owned.schema)} and n.nspowner::regrole::text='postgres'
        and obj_description(n.oid,'pg_namespace')=${literal(owned.marker)})
      then raise exception 'account_switch_owned_schema_required';end if;
  end;$owned$;`;
  const bindingGuard=`do $binding$ begin
    if to_regclass('public.merchant_enterprise_audit_events') is not null
      or (select count(*) from public.merchants)<>1
      or not exists(select 1 from public.merchants where id='${c.site}' and user_id='${id(99)}')
      or (select count(*) from public.merchant_enterprise_roles)<>3
      or (select count(*) from public.merchant_enterprise_employees)<>1
      or (select count(*) from public.merchant_attendance_workers)<>1
      or (select count(*) from public.merchant_attendance_locations)<>1
      or (select count(*) from public.merchant_attendance_settings)<>1
      or (select count(*) from public.merchant_attendance_employment_periods)<>1
      or exists(select 1 from public.merchant_attendance_events)
      or not exists(select 1 from public.merchant_enterprise_employees e
        join public.merchant_enterprise_roles r on r.merchant_id=e.merchant_id and r.id=e.role_id
        join public.merchant_attendance_workers w on w.merchant_id=e.merchant_id and w.employee_id=e.id
        join public.merchant_attendance_locations l on l.merchant_id=w.merchant_id and l.id=w.default_location_id
        join public.merchant_attendance_settings s on s.merchant_id=e.merchant_id
        where e.merchant_id='${c.site}' and e.id='${c.employees.a}' and e.auth_user_id='${c.authUsers.a}'
          and e.status='active' and e.accepted_at is not null and e.display_name=${literal(c.labels.a)}
          and r.id='${id(30)}' and r.status='active'
          and r.permissions @> array['enterprise.view','attendance.self.view','attendance.self.clock']::text[]
          and public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions)
          and w.id='${c.workers.a}' and w.active and w.worker_no=${literal(c.labels.workerA)}
          and l.id='${c.place}' and l.active and l.latitude is null and l.longitude is null and l.radius_meters is null
          and s.enabled and s.web_clock_enabled)
      or not exists(select 1 from public.merchant_attendance_employment_periods
        where merchant_id='${c.site}' and worker_id='${c.workers.a}' and starts_on='2000-01-01' and ends_on is null)
      or to_regprocedure('public.faolla_attendance_self_session_v1(text,uuid,uuid)') is null
      or to_regprocedure('public.faolla_attendance_self_v1(text,uuid,jsonb,uuid)') is null
      then raise exception 'account_switch_initial_binding_required';end if;
  end;$binding$;`;
  const snapshot=`reset role;select jsonb_build_object(
    'merchants',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'[]')) from public.merchants t),
    'roles',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'[]')) from public.merchant_enterprise_roles t),
    'employees',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'[]')) from public.merchant_enterprise_employees t where id<>'${c.employees.b}'),
    'workers',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'[]')) from public.merchant_attendance_workers t where id<>'${c.workers.b}'),
    'employment',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'[]')) from public.merchant_attendance_employment_periods t where worker_id<>'${c.workers.b}'),
    'settings',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by merchant_id)::text,'[]')) from public.merchant_attendance_settings t),
    'locations',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'[]')) from public.merchant_attendance_locations t),
    'events',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'[]')) from public.merchant_attendance_events t),
    'configOperations',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by operation_id)::text,'[]')) from public.merchant_attendance_config_operations t),
    'scopeOperations',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by operation_id)::text,'[]')) from public.merchant_attendance_scope_operations t));`;
  const before=exec(snapshot);
  const seed=`begin;reset role;${ownedGuard}${bindingGuard}
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,accepted_at)
      values('${c.employees.b}','${c.site}','${c.authUsers.b}','employee-b@example.test',${literal(c.labels.b)},'${id(30)}','active',clock_timestamp());
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id,active)
      values('${c.workers.b}','${c.site}','${c.employees.b}',${literal(c.labels.workerB)},${literal(c.labels.b)},'${c.place}',true);
    insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on)
      values('${c.site}','${c.workers.b}','2000-01-01');
    commit;`;
  const qualify=source=>{const result=scope.sql(source);assert(!/\bpublic\./.test(result),'account_switch_qualifier_required');return result;};
  // The files retain their own original transactions and service-only ACLs.
  // Recheck namespace/binding immediately before each original migration and seed.
  const steps=[...plan.flatMap(item=>[qualify(`begin;reset role;${ownedGuard}${bindingGuard}commit;`),qualify(item.source)]),qualify(seed)];
  if(typeof native.querySteps==='function')await native.querySteps(steps);else for(const step of steps)native.query(step);
  assert.equal(exec(snapshot),before,'account_switch_preparation_changed_original_facts');
  const result=JSON.parse(exec(`reset role;select jsonb_build_object(
    'employees',(select count(*) from public.merchant_enterprise_employees),
    'workers',(select count(*) from public.merchant_attendance_workers),
    'employment',(select count(*) from public.merchant_attendance_employment_periods),
    'events',(select count(*) from public.merchant_attendance_events),
    'managementAuditAbsent',to_regclass('public.merchant_enterprise_audit_events') is null,
    'employeeB',(select count(*) from public.merchant_enterprise_employees where merchant_id='${c.site}' and id='${c.employees.b}'
      and auth_user_id='${c.authUsers.b}' and email='employee-b@example.test' and display_name=${literal(c.labels.b)}
      and role_id='${id(30)}' and status='active' and accepted_at is not null),
    'workerB',(select count(*) from public.merchant_attendance_workers where merchant_id='${c.site}' and id='${c.workers.b}'
      and employee_id='${c.employees.b}' and worker_no=${literal(c.labels.workerB)} and display_name=${literal(c.labels.b)} and default_location_id='${c.place}' and active),
    'employmentB',(select count(*) from public.merchant_attendance_employment_periods where merchant_id='${c.site}' and worker_id='${c.workers.b}' and starts_on='2000-01-01' and ends_on is null),
    'serviceFunctions',(select count(*) from unnest(array['faolla_attendance_self_history_v1(text,uuid,jsonb)','faolla_attendance_self_session_v1(text,uuid,uuid)']) f(signature)
      where has_function_privilege('service_role','public.'||f.signature,'EXECUTE')),
    'browserFunctions',(select count(*) from unnest(array['faolla_attendance_self_history_v1(text,uuid,jsonb)','faolla_attendance_self_session_v1(text,uuid,uuid)']) f(signature)
      where has_function_privilege('anon','public.'||f.signature,'EXECUTE') or has_function_privilege('authenticated','public.'||f.signature,'EXECUTE')));`));
  assert.deepEqual(result,{employees:2,workers:2,employment:2,events:0,managementAuditAbsent:true,employeeB:1,workerB:1,employmentB:1,serviceFunctions:2,browserFunctions:0},'account_switch_preparation_mismatch');
  return {consts,sourceMigrations:plan.map(item=>item.name),syntheticOnly:true,seededEmployees:1,seededWorkers:1,seededEvents:0};
}
