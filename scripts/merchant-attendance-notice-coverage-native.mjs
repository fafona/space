// Local synthetic SQL acceptance only. This runner reuses the named stopped
// cluster and its existing owned-namespace facility; it creates no cluster or
// database. All synthetic personnel changes below roll back. Publication/ACK
// use original073/076 RPCs; report reads use service_role and original115.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';

const site='99990001',foreign='99990002',owner=id(99),foreignOwner=id(98),place=id(301),otherPlace=id(302),foreignPlace=id(398);
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const migrationNames=Object.freeze(['202609300073_merchant_attendance_location_policy_drafts.sql',
  '202609300076_merchant_attendance_location_notices.sql','202610030115_merchant_attendance_location_notice_coverage.sql']);
const rpc='faolla_attendance_location_notice_coverage_v1';
let diagnosticPhase='entry';
const labels=Object.freeze([
  'coverage unpublished roster has no inferred confirmations or pending count',
  'coverage original publication and explicit view-only employee ACK yield exactly one confirmation',
  'coverage UUID pagination includes all57 current assignments once with complete counts on each page',
  'coverage excludes inactive/unbound/unavailable/view-denied rows without requiring self.clock',
  'coverage unpublished draft preserves current ACK; settings/location fences reject stale pages',
  'coverage current employee/worker/account identity changes do not inherit an earlier ACK',
  'coverage withdrawal removes confirmation counts; republish never inherits the previous revision ACK',
  'coverage owner/tenant/protocol and browser/private-table ACL denials remain closed',
  'coverage all report reads preserve every business table and all synthetic changes roll back',
]);
const query=(overrides={})=>({locationId:place,expectedNoticeRevision:null,expectedSettingsVersion:null,expectedLocationVersion:null,cursorWorkerId:null,...overrides});
const call=(q=query(),actor=owner,tenant=site)=>`public.${rpc}('${tenant}','${actor}',${json(q)})`;
const denied=(code,expression)=>`begin perform ${expression};raise exception 'coverage_unexpected_acceptance';
  exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;`;
const rows=table=>`(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.${table} t)`;

export function noticeCoverageNativeFailure(error){
  const message=error instanceof Error?error.message:'';
  const allowed=new Set(['attendance_invalid_request','attendance_access_denied','attendance_settings_required',
    'attendance_location_denied','attendance_version_conflict','attendance_notice_unavailable',
    'attendance_notice_already_acknowledged','attendance_notice_unchanged','attendance_operation_conflict',
    'merchant_attendance_notice_coverage_prerequisite_required','merchant_attendance_notice_coverage_registry_postcondition_failed',
    'merchant_attendance_notice_coverage_acl_postcondition_failed']);
  const rawCode=message.match(/ERROR:\s+([a-z_]+)(?=\r?\n|$)/)?.[1];
  const line=message.match(/PL\/pgSQL function [^\r\n]*? line ([1-9][0-9]{0,5})\b/)?.[1];
  return {error:'notice_coverage_native_failed',phase:diagnosticPhase,
    code:rawCode&&allowed.has(rawCode)?rawCode:'local_check_failed',sourceLine:line?Number(line):null};
}

export function noticeCoverageMigrationPlan(root,scope){
  assert.equal(typeof root,'string');assert(path.isAbsolute(root));
  assert(scope&&/^attendance_race_[a-f0-9]{32}$/.test(scope.schema)&&typeof scope.sql==='function');
  return migrationNames.map(name=>{
    const source=readFileSync(path.join(root,'scripts/supabase-migrations',name),'utf8');
    const body=source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');
    const statement=scope.sql(body);
    assert(!/\bpublic\./.test(statement)&&!/search_path\s*(?:=|to)\s*(?:pg_catalog,\s*)?public\b/.test(statement));
    return {name,source,body,statement};
  });
}

function ownedGuard(owned){
  assert(/^attendance_race_[a-f0-9]{32}$/.test(owned.schema)&&owned.owner==='postgres');
  assert(Number.isSafeInteger(owned.oid)&&owned.oid>0&&Number.isSafeInteger(owned.tableOid)&&owned.tableOid>0);
  assert(/^faolla-synthetic-concurrency:[a-f0-9-]{36}$/.test(owned.marker));
  return `do $owned$ begin if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.oid='public.merchants'::regclass and c.oid=${owned.tableOid} and n.oid=${owned.oid}
    and n.nspname=${quote(owned.schema)} and n.nspowner::regrole::text='postgres'
    and obj_description(n.oid,'pg_namespace')=${quote(owned.marker)})
    then raise exception 'coverage_native_owned_schema_required';end if;end;$owned$;`;
}

/** Pure SQL construction. The returned statements have not executed. */
export function noticeCoverageNativePlan(owned,tables){
  const guard=ownedGuard(owned);
  assert(Array.isArray(tables)&&tables.length>0&&new Set(tables).size===tables.length);
  for(const table of tables)assert(typeof table==='string'&&/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(table)&&table.length<=63);
  for(const table of ['merchants','merchant_enterprise_roles','merchant_enterprise_employees','merchant_attendance_workers',
    'merchant_attendance_settings','merchant_attendance_locations','merchant_attendance_events',
    'merchant_attendance_location_policy_drafts','merchant_attendance_location_notices','merchant_attendance_location_notice_acknowledgements'])assert(tables.includes(table));
  const fingerprint=`(select md5(jsonb_build_object(${tables.map(table=>`${quote(table)},${rows(table)}`).join(',')})::text))`;
  const people=Array.from({length:56},(_,index)=>({employeeId:id(101+index),authId:index===54?null:id(index+1),
    status:index===54?'invited':index===51?'disabled':'active',roleId:id(index===53?31:index===55?32:30)}));
  // 51 eligible, then unbound / disabled employee / inactive worker / no self
  // view / null Auth binding / archived role. All57 are assigned to location A.
  const workers=Array.from({length:57},(_,index)=>({id:id(201+index),employee:index===51?null:people[index<51?index:index-1],
    active:index!==53}));
  const batch=(values,render)=>Array.from({length:Math.ceil(values.length/50)},(_,index)=>render(values.slice(index*50,index*50+50)));
  const seed=[`begin;reset role;${guard}
    do $fresh$ begin assert not exists(select 1 from public.merchants),'coverage_native_fresh_namespace_required';end;$fresh$;
    insert into public.merchants(id,user_id) values('${site}','${owner}'),('${foreign}','${foreignOwner}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled)
      values('${site}','UTC',false,false),('${foreign}','UTC',false,false);
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values
      ('${place}','${site}','Synthetic coverage A','UTC',true),('${otherPlace}','${site}','Synthetic coverage B','UTC',true),
      ('${foreignPlace}','${foreign}','Synthetic foreign coverage','UTC',true);
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions,status) values
      ('${id(30)}','${site}','Coverage view-only',array['enterprise.view','attendance.self.view'],'active'),
      ('${id(31)}','${site}','Coverage without view',array['enterprise.view'],'active'),
      ('${id(32)}','${site}','Coverage archived',array['enterprise.view','attendance.self.view'],'archived');`,
    ...batch(people,chunk=>`insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values
      ${chunk.map((person)=>`('${person.employeeId}','${site}',${person.authId?quote(person.authId):'null'},'coverage-${person.employeeId.slice(-3)}@example.test','Synthetic coverage employee','${person.roleId}','${person.status}')`).join(',')};`),
    ...batch(workers,chunk=>`insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id,active) values
      ${chunk.map(worker=>`('${worker.id}','${site}',${worker.employee?quote(worker.employee.employeeId):'null'},'COVERAGE-${worker.id.slice(-3)}','Synthetic coverage worker','${place}',${worker.active})`).join(',')};`),
    `insert into public.merchant_attendance_workers(id,merchant_id,worker_no,display_name,default_location_id,active) values
      ('${id(299)}','${site}','COVERAGE-OTHER-LOCATION','Synthetic other location','${otherPlace}',true),
      ('${id(998)}','${foreign}','COVERAGE-FOREIGN','Synthetic foreign worker','${foreignPlace}',true);
    create temp table coverage_read_baseline(value text) on commit drop;
    insert into coverage_read_baseline values(${fingerprint});`];
  const readCheck=code=>`update coverage_read_baseline set value=${fingerprint};
    set local role service_role;do $check$ declare a jsonb;b jsonb;r jsonb;all_ids uuid[]:=array[]::uuid[];begin
      assert current_user='service_role','coverage_native_service_role_required';${code}
    end;$check$;reset role;
    do $unchanged$ begin assert (select value from coverage_read_baseline)=${fingerprint},'coverage_read_changed_business_facts';end;$unchanged$;`;
  const values={purpose:'Synthetic coverage',notice:'Synthetic version one',contact:'Synthetic contact',alternative:'Manual review',
    retentionDays:30,latitude:37.3,longitude:-5.9,radiusMeters:100};
  const draft=(operation,revision)=>`public.faolla_attendance_location_policy_draft_v1('${site}','${owner}','${place}',
    ${json({operationId:id(operation),expectedRevision:revision,expectedSettingsVersion:1,expectedLocationVersion:1,values:{...values,notice:`Synthetic version ${revision+1}`}})},null,true)`;
  const notice=(command,access='owner',actor=owner)=>`public.faolla_attendance_location_notice_v1('${site}','${actor}',
    ${json({access,locationId:place,expectedWorkerId:access==='self'?id(201):null,operationId:null})},${json(command)},true)`;
  const publish=(operation,revision,draftRevision)=>({action:'publish',operationId:id(operation),expectedRevision:revision,draftRevision,
    expectedSettingsVersion:1,expectedLocationVersion:1,reason:'Synthetic coverage publication'});
  const firstFence={expectedNoticeRevision:1,expectedSettingsVersion:1,expectedLocationVersion:1};
  const stats=(confirmed,pending)=>json({assigned:57,eligible:51,excluded:6,confirmed,pending});
  const steps=[
    readCheck(`a:=${call()};assert a->'notice'='null'::jsonb and a->'noticeCurrent'='false'::jsonb,'unpublished notice';
      assert a->'counts'=${stats(null,null)},'unpublished counts';
      assert not exists(select 1 from jsonb_array_elements(a->'items') t where t->'acknowledgedAt'<>'null'::jsonb),'unpublished ACK projection';`),
    `set local role service_role;do $write$ begin perform ${draft(801,0)};perform ${notice(publish(802,0,1))};
      perform ${notice({action:'acknowledge',operationId:id(803),expectedRevision:1},'self',id(1))};end;$write$;reset role;`,
    readCheck(`a:=${call()};assert a->'counts'=${stats(1,50)},'one actual ACK';
      assert a->'noticeCurrent'='true'::jsonb and a->'notice'->>'revision'='1','current publish';
      assert a->'items'->0->>'workerId'='${id(201)}' and a->'items'->0->>'eligible'='true'
        and a->'items'->0->'acknowledgedAt'<>'null'::jsonb,'view-only acknowledged employee';`),
    readCheck(`a:=${call()};assert jsonb_array_length(a->'items')=50 and a->>'nextCursor'='${id(250)}','first50';
      for r in select value from jsonb_array_elements(a->'items') loop all_ids:=array_append(all_ids,(r->>'workerId')::uuid);end loop;
      b:=${call(query({...firstFence,cursorWorkerId:id(250)}))};
      assert b->'counts'=a->'counts' and jsonb_array_length(b->'items')=7 and b->'nextCursor'='null'::jsonb,'remaining7 complete totals';
      for r in select value from jsonb_array_elements(b->'items') loop all_ids:=array_append(all_ids,(r->>'workerId')::uuid);end loop;
      assert all_ids=array[${workers.map(worker=>quote(worker.id)+'::uuid').join(',')}],'every assigned UUID exactly once';
      a:=${call(query({...firstFence,cursorWorkerId:id(257)}))};
      assert a->'items'='[]'::jsonb and a->'nextCursor'='null'::jsonb and a->'counts'=${stats(1,50)},'empty trailing page';`),
    readCheck(`a:=${call(query({...firstFence,cursorWorkerId:id(250)}))};
      assert a->'items'->0->>'eligible'='true','last view-only worker remains eligible';
      assert (select jsonb_agg(t->'exclusion' order by t->>'workerId') from jsonb_array_elements(a->'items') t) =
        '[null,"employee_unavailable","employee_unavailable","worker_inactive","role_unavailable","employee_unavailable","role_unavailable"]'::jsonb,'exclusion order and null auth';
      assert a->'counts'=${stats(1,50)},'exclusions do not shrink assigned denominator';`),
    `set local role service_role;do $write$ begin perform ${draft(804,1)};end;$write$;reset role;`,
    readCheck(`a:=${call(query(firstFence))};assert a->'noticeCurrent'='true'::jsonb and a->'counts'=${stats(1,50)},'new unpublished draft keeps original publication';`),
    `savepoint settings_change;update public.merchant_attendance_settings set version=version+1 where merchant_id='${site}';`,
    readCheck(`a:=${call()};assert a->'noticeCurrent'='false'::jsonb and a->'counts'=${stats(1,50)},'stale publication retains historical version ACK';
      ${denied('attendance_version_conflict',call(query(firstFence)))}`),
    'rollback to savepoint settings_change;',
    `savepoint location_change;update public.merchant_attendance_locations set version=version+1 where id='${place}';`,
    readCheck(`a:=${call()};assert a->'noticeCurrent'='false'::jsonb,'location version stale';${denied('attendance_version_conflict',call(query(firstFence)))}`),
    'rollback to savepoint location_change;',
    `savepoint current_auth;update public.merchant_enterprise_employees set auth_user_id='${id(880)}' where id='${id(101)}';`,
    readCheck(`a:=${call()};assert a->'counts'=${stats(0,51)} and a->'items'->0->'acknowledgedAt'='null'::jsonb,'new current auth cannot inherit ACK';`),
    'rollback to savepoint current_auth;',
    `savepoint current_binding;update public.merchant_attendance_workers set employee_id=null where id='${id(201)}';
      update public.merchant_attendance_workers set employee_id='${id(101)}' where id='${id(202)}';
      update public.merchant_attendance_workers set employee_id='${id(102)}' where id='${id(201)}';`,
    readCheck(`a:=${call()};assert a->'counts'=${stats(0,51)} and a->'items'->0->'acknowledgedAt'='null'::jsonb
      and a->'items'->1->'acknowledgedAt'='null'::jsonb,'new employee and worker tuple cannot inherit ACK';`),
    'rollback to savepoint current_binding;',
    `savepoint historical_inactive;update public.merchant_attendance_workers set active=false where id='${id(201)}';`,
    readCheck(`a:=${call()};assert a->'counts'=${json({assigned:57,eligible:50,excluded:7,confirmed:0,pending:50})},'ineligible ACK not counted as confirmed';
      assert a->'items'->0->>'exclusion'='worker_inactive' and a->'items'->0->'acknowledgedAt'<>'null'::jsonb,'exact inactive history remains visible';`),
    'rollback to savepoint historical_inactive;',
    `set local role service_role;do $write$ begin perform ${notice({...publish(805,1,null),action:'withdraw',reason:'Synthetic withdrawal'})};end;$write$;reset role;`,
    readCheck(`a:=${call()};assert a->'notice'->>'action'='withdraw' and a->'counts'=${stats(null,null)},'withdrawn has no pending interpretation';
      assert not exists(select 1 from jsonb_array_elements(a->'items') t where t->'acknowledgedAt'<>'null'::jsonb),'withdrawn no prior ACK';
      ${denied('attendance_version_conflict',call(query(firstFence)))}`),
    `set local role service_role;do $write$ begin perform ${notice(publish(806,2,2))};end;$write$;reset role;`,
    readCheck(`a:=${call()};assert a->'notice'->>'revision'='3' and a->'noticeCurrent'='true'::jsonb and a->'counts'=${stats(0,51)},'republish requires new revision ACK';`),
    readCheck(`${denied('attendance_access_denied',call(query(),id(1)))}
      ${denied('attendance_access_denied',call(query(),foreignOwner))}
      ${denied('attendance_access_denied',call(query({locationId:foreignPlace}),owner,foreign))}
      ${denied('attendance_location_denied',call(query({locationId:foreignPlace})))}
      ${denied('attendance_location_denied',call(query({locationId:id(999)})))}
      a:=${call(query({locationId:otherPlace}))};assert a->'counts'=${json({assigned:1,eligible:0,excluded:1,confirmed:null,pending:null})},'other location no cross-count';
      ${[null,{}, {...query(),extra:true},{...query(),cursorWorkerId:id(201)}, {...query(),expectedNoticeRevision:0},
        {...query(),expectedNoticeRevision:'3',expectedSettingsVersion:1,expectedLocationVersion:1},
        {...query(),expectedNoticeRevision:3,expectedSettingsVersion:0,expectedLocationVersion:1},
        {...query(),expectedNoticeRevision:3,expectedSettingsVersion:1,expectedLocationVersion:true},
        {...query(),locationId:7}].map(q=>denied('attendance_invalid_request',call(q))).join('\n')}`),
    ...['anon','authenticated'].map(role=>`set local role ${role};do $acl$ begin
      begin perform ${call()};raise exception 'coverage_browser_execute_allowed';exception when insufficient_privilege then null;end;
      end;$acl$;reset role;`),
    `set local role service_role;do $acl$ begin
      ${['merchant_attendance_location_notices','merchant_attendance_location_notice_acknowledgements'].map(table=>`begin
        perform 1 from public.${table};raise exception 'coverage_private_table_read_allowed';exception when insufficient_privilege then null;end;`).join('\n')}
      end;$acl$;reset role;
      do $final$ begin
        assert (select count(*) from public.merchant_attendance_events)=0,'coverage_never_punched';
        assert (select count(*) from public.merchant_attendance_location_policy_drafts)=2,'only actual draft writes';
        assert (select count(*) from public.merchant_attendance_location_notices)=3,'only actual notice writes';
        assert (select count(*) from public.merchant_attendance_location_notice_acknowledgements)=1,'only actual employee ACK';
      end;$final$;
      select ${json(labels)};rollback;`,
  ];
  return {site,owner,place,people,workers,labels:[...labels],fingerprint,guard,seed,steps};
}

function installCoverageDependencies(native,scope){
  diagnosticPhase='dependency-check';
  assert.equal(typeof native.query,'function');assert.equal(typeof native.querySteps,'function');
  const raw=source=>native.query(scope.sql(source)),owned=assertLifecycleSandbox(raw);
  assert.equal(scope.schema,owned.schema);const guard=ownedGuard(owned);
  const checked=source=>{
    assert.deepEqual(assertLifecycleSandbox(raw),owned,'coverage_native_namespace_changed');
    const begin=/^(\s*begin(?:\s+read\s+only)?\s*;)/i;
    return raw(begin.test(source)?source.replace(begin,`$1reset role;${guard}\n`):`begin;reset role;${guard}\n${source}\ncommit;`);
  };
  checked(`do $absent$ begin assert to_regclass('public.merchant_attendance_location_policy_drafts') is null
    and to_regclass('public.merchant_attendance_location_notices') is null
    and to_regprocedure('public.${rpc}(text,uuid,jsonb)') is null,'coverage_native_fresh_dependencies_required';end;$absent$;`);
  const migrations=noticeCoverageMigrationPlan(native.root,scope);
  for(const [index,migration] of migrations.entries()){
    diagnosticPhase=['install073','install076','install115'][index];checked(migration.body);
  }
  const tables=JSON.parse(checked(`select coalesce(jsonb_agg(relname order by relname),'[]'::jsonb) from pg_class
    where relnamespace=${owned.oid} and relkind in('r','p');`));
  const plan=noticeCoverageNativePlan(owned,tables);
  const before=checked(`select ${plan.fingerprint};`);
  const acl=()=>checked(`select jsonb_build_object('definition',pg_get_functiondef(p.oid),'owner',p.proowner::regrole::text,'acl',p.proacl)
    from pg_proc p where p.oid='public.${rpc}(text,uuid,jsonb)'::regprocedure;`);
  const originalAcl=acl();diagnosticPhase='reapply115';checked(migrations.at(-1).body);
  assert.equal(acl(),originalAcl,'coverage_migration_reapply_changed_function_acl');
  assert.equal(checked(`select ${plan.fingerprint};`),before,'coverage_migration_reapply_changed_business_facts');
  assert.deepEqual(assertLifecycleSandbox(raw),owned,'coverage_native_namespace_changed');
  return {owned,plan,checked,before};
}

// Optional live-scope reuse for the actual browser panel. This commits only the
// explicit synthetic prestate and original policy/publish/ACK calls into the
// caller-owned namespace; its outer finally must remove that exact namespace.
// No events are seeded or written. Report/parent-notice reads must leave this
// returned full-table fingerprint unchanged.
export async function prepareNoticeCoverageNativeFixture(native,scope){
  const {owned,plan,checked}=installCoverageDependencies(native,scope);
  diagnosticPhase='browser-fixture-seed';
  await native.querySteps([...plan.seed,plan.steps[1],'commit;'].map(scope.sql));
  const expectedCounts={assigned:57,eligible:51,excluded:6,confirmed:1,pending:50};
  const initial=JSON.parse(checked(`set local role service_role;select ${call()};`));
  assert.deepEqual(initial.counts,expectedCounts,'coverage_browser_fixture_initial_counts');
  return {site,owner,place,other:otherPlace,exec:checked,owned,queryInput:query,counts:expectedCounts,
    fingerprint:()=>checked(`select ${plan.fingerprint};`)};
}

export async function checkAttendanceNoticeCoverageNative(native,scope){
  assert.equal(typeof native.pass,'function');
  const {plan,checked,before}=installCoverageDependencies(native,scope);
  diagnosticPhase='native-cases';
  const result=await native.querySteps([...plan.seed,...plan.steps].map(scope.sql));
  assert.deepEqual(JSON.parse(result),labels,'coverage_native_all_assertions_required');
  diagnosticPhase='rollback-oracle';
  assert.equal(checked(`select ${plan.fingerprint};`),before,'coverage_native_seed_or_case_not_rolled_back');
  for(const label of labels)native.pass(label);
  return {checks:labels.length,seedRolledBack:true,workerCount:57,clockWrites:0,syntheticOnly:true};
}

export async function runAttendanceNoticeCoverageNative(args){
  return runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,
    scope=>checkAttendanceNoticeCoverageNative(native,scope)));
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))){
  runAttendanceNoticeCoverageNative(process.argv.slice(2)).catch(error=>{console.error(JSON.stringify(noticeCoverageNativeFailure(error)));process.exitCode=1;});
}
