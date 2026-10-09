// Source contracts only. PostgreSQL execution, index plans and real lock races
// belong to the separate caller-owned native acceptance, not these tests.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const filename='202610050139_merchant_attendance_plan_coverage.sql';
const source=readFileSync(new URL(`./supabase-migrations/${filename}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const clean=source.replace(/--[^\n]*/g,'');
const rpc='faolla_attendance_plan_coverage_v1',index='attendance_shift_schedule_slot_idx';
const start=clean.indexOf(`create or replace function public.${rpc}(`),body=clean.slice(start,clean.indexOf('$$;',start)+3);
const contains=(text,...parts)=>{for(const part of parts)assert(text.includes(part),part);};
const ordered=(text,...parts)=>{let position=-1;for(const part of parts){const next=text.indexOf(part,position+1);assert(next>position,part);position=next;}};
const old=name=>readFileSync(new URL(`./supabase-migrations/${name}`,import.meta.url),'utf8');

test('139 adds only one partial index, one read RPC and registration; old tables/functions/grants stay intact',()=>{
  assert.deepEqual(validateMigrationSource(filename,source),[]);
  assert.deepEqual([...clean.matchAll(/create or replace function public\.(\w+)/g)].map(m=>m[1]),[rpc]);
  assert.deepEqual([...clean.matchAll(/create index concurrently if not exists (\w+)/g)].map(m=>m[1]),[index]);
  assert.deepEqual([...clean.matchAll(/insert into public\.(\w+)/g)].map(m=>m[1]),['faolla_schema_migrations']);
  assert.doesNotMatch(clean,/\b(?:create\s+(?:table|trigger)|alter\s+table|drop|delete\s+from|update\s+public\.|lock\s+table)\b/i);
  assert.doesNotMatch(body,/\b(?:insert\s+into|for\s+update|for\s+no\s+key\s+update|pg_advisory|set_config)\b/i);
});
test('explicit135137138 prerequisites and function/registry conflicts precede any index build',()=>{
  contains(clean,"(202610040135::bigint,'merchant_attendance_shift_rule_binding_reader')",
    "(202610050137::bigint,'merchant_attendance_self_schedule')","(202610050138::bigint,'merchant_attendance_shift_check')",
    "version=202610050139 and name<>'merchant_attendance_plan_coverage'",
    "installed<>(to_regprocedure('public.faolla_attendance_plan_coverage_v1(jsonb,uuid)') is not null)",
    "if installed and idx is null then raise exception 'merchant_attendance_plan_coverage_installation_conflict'");
  ordered(clean,'$plan_coverage_prerequisites$;','commit;',`create index concurrently if not exists ${index}`,
    "begin;\nset local lock_timeout='3s';",'$plan_coverage_index_ready$;',`create or replace function public.${rpc}(`,
    "values(202610050139,'merchant_attendance_plan_coverage')");
  assert.equal((clean.match(/set local lock_timeout='3s'/g)??[]).length,2);
  assert.doesNotMatch(clean,/reindex|set\s+(?!local\b)(?:lock_timeout|statement_timeout)|disable\s+trigger|session_replication_role/i);
});
test('both index checks reject wrong keys/predicate/default operators/collations and invalid concurrent remnants',()=>{
  for(const marker of ['i.indisvalid and i.indisready and i.indislive','not i.indisunique and not i.indisexclusion',
    "pg_get_expr(i.indpred,i.indrelid)='(slot_id IS NOT NULL)'",'i.indexprs is null and i.indnatts=3 and i.indnkeyatts=3',
    "pg_get_indexdef(idx,1,true)='merchant_id'","pg_get_indexdef(idx,2,true)='slot_id'","pg_get_indexdef(idx,3,true)='start_event_id'",
    'unnest(i.indoption::smallint[])','unnest(i.indclass::oid[]) with ordinality','not opc.opcdefault',
    'i.indcollation[0]','i.indcollation[1]=0 and i.indcollation[2]=0'])assert.equal(clean.split(marker).length-1,2,marker);
  contains(clean,`on public.merchant_attendance_shift_schedule_relations(merchant_id,slot_id,start_event_id) where slot_id is not null;`);
});
test('exact bounded three-key query reuses strict canonical scalars with no user page size or clock input',()=>{
  contains(body,`${rpc}(p_query jsonb,p_auth_user_id uuid)`,"array['siteId','workerId','slotId']",
    "octet_length(convert_to(p_query::text,'UTF8'))>4096","p_query->'workerId','uuid'","p_query->'slotId','uuid'",
    "then raise exception 'attendance_invalid_request'");
  assert.doesNotMatch(body,/p_command|p_allow_write|p_module_enabled|p_query->>'(?:asOf|limit|offset|fromDate)'/);
});
test('independent owner authorization and merchant/settings/worker/employee SHARE locks precede even empty-set enumeration',()=>{
  ordered(body,'from public.merchants where id=site and user_id=p_auth_user_id for share;',
    'from public.merchant_attendance_settings where merchant_id=site for share;',
    'from public.merchant_attendance_workers where merchant_id=site and id=wid for share;',
    'from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;',
    'read_started:=clock_timestamp();','select * into slot','candidates:=array(', 'foreach saved in array candidates loop');
  contains(body,"if w.employee_id is null or e.id is null or e.auth_user_id is null then raise exception 'attendance_shift_rule_binding_identity_changed'",
    "if not found then raise exception 'attendance_access_denied'");
  assert.doesNotMatch(body,/if not w\.active|if not s\.enabled|e\.status\s*(?:<>|is distinct from)\s*'active'/);
});
test('slot is exact tenant-worker-id and historical employee plus any present publication dual identity must match',()=>{
  contains(body,'where x.merchant_id=site and x.worker_id=wid and x.id=sid;',
    "if slot.id is null then raise exception 'attendance_plan_coverage_not_found'",
    "if slot.employee_id is distinct from e.id then raise exception 'attendance_shift_rule_binding_identity_changed'",
    'context:=public.faolla_attendance_self_schedule_slot_v1(slot);',"publication:=nullif(context->'publication','null'::jsonb)",
    "publication is not null and (publication->>'employeeId' is distinct from e.id::text",
    "publication->>'employeeAuthUserId' is distinct from e.auth_user_id::text");
  assert.doesNotMatch(body,/default_location_id|faolla_attendance_(?:sources|unified_report|schedule|self)_v1\(/);
});
test('index-aligned eleven sentinel probes all relations before ten-cap and never filters shifted or unverified sessions out',()=>{
  const probe=body.slice(body.indexOf('candidates:=array('),body.indexOf('foreach saved in array candidates loop'));
  contains(probe,'where x.merchant_id=site and x.slot_id=sid and x.slot_id is not null order by x.start_event_id limit 11',
    "if cardinality(candidates)>10 then raise exception 'attendance_plan_coverage_too_large'");
  assert.doesNotMatch(probe,/x\.worker_id|x\.status|occurred_at|start_at|end_at|work_date|offset/i);
  ordered(body,'if cardinality(candidates)>10','foreach saved in array candidates loop','child:=public.faolla_attendance_shift_check_v1(');
});
test('each relation validates current dual identity and exact original selection before actual138 call',()=>{
  contains(body,'saved.worker_id is distinct from wid or saved.employee_id is distinct from e.id or saved.employee_auth_user_id is distinct from e.auth_user_id',
    "saved.selection is distinct from jsonb_build_object('slotId',sid,'revision',slot.revision)","saved.status not in('linked','unverified')",
    "child:=public.faolla_attendance_shift_check_v1(jsonb_build_object('siteId',site,'workerId',wid,'startEventId',saved.start_event_id),p_auth_user_id)");
  assert.doesNotMatch(body,/\bupdate\s+|jsonb_set\(|faolla_attendance_bind_shift_rules|faolla_attendance_rule_sources_v/);
});
test('child cross-links worker, original start, stored snapshot and current cancellation without overwriting historical status',()=>{
  contains(body,"child->'binding'->'worker' is distinct from worker_item",
    "child->'binding'->'event'->>'startEventId' is distinct from saved.start_event_id::text",
    "child_relation->'selection' is distinct from saved.selection","child_relation->>'status' is distinct from saved.status",
    "child_relation->'slot' is distinct from saved.slot_snapshot","((child_relation->'slot')-'cancelled') is distinct from (slot_item-'cancelled')",
    "child_relation->'currentCancelled' is distinct from slot_item->'cancelled'");
  assert.doesNotMatch(body,/saved\.status\s*:=|child_relation\s*:=\s*jsonb_build|slot_item\s*:=\s*jsonb_set/);
});
test('aggregate2002 event and oneMiB caps fail closed without emitting an incomplete prefix',()=>{
  contains(body,"event_count:=event_count+jsonb_array_length(child->'events')",
    "if event_count>2002 then raise exception 'attendance_plan_coverage_too_large'",
    "octet_length(convert_to(sessions::text,'UTF8'))>1048576","octet_length(convert_to(result::text,'UTF8'))>1048576");
  ordered(body,'if event_count>2002','sessions:=sessions||jsonb_build_array(child);','read_completed:=clock_timestamp();','return result;');
  assert.doesNotMatch(body,/\bexit\b|\bcontinue\b|limit\s+10(?:\D|$)|rangeLimited|partialResult/);
});
test('outer observation encloses actual distinct child stamps and preserves raw138 without timezone reconstruction',()=>{
  contains(body,'read_started:=clock_timestamp();last_observation:=read_started;',
    'child_observation<read_started',"(child->'binding'->>'readAt')::timestamptz<read_started",
    "(child->'binding'->>'readAt')::timestamptz>child_observation",'last_observation:=greatest(last_observation,child_observation);',
    'read_completed<last_observation','sessions:=sessions||jsonb_build_array(child)');
  assert.doesNotMatch(body,/jsonb_set|at time zone (?!'UTC')|day_boundary|pg_timezone|lateGraceMinutes|merchant_attendance_leave/);
});
test('source envelope has exact eight keys, existing eight worker keys, and unmodified137 current slot projection',()=>{
  // JSON extraction must finish before JSONB key subtraction; otherwise PostgreSQL
  // resolves the two unknown string literals as the operands of subtraction.
  contains(body,"((child_relation->'slot')-'cancelled') is distinct from (slot_item-'cancelled')");
  const result=body.slice(body.indexOf('result:=jsonb_build_object('),body.indexOf("if octet_length(convert_to(result::text"));
  assert.deepEqual([...result.matchAll(/'([a-z][A-Za-z]*)',/g)].map(m=>m[1]),
    ['protocol','siteId','actorId','worker','slot','readStartedAt','readCompletedAt','sessions']);
  const worker=body.slice(body.indexOf('worker_item:=jsonb_build_object('),body.indexOf('select * into slot'));
  assert.deepEqual([...worker.matchAll(/'([a-z][A-Za-z]*)',/g)].map(m=>m[1]),
    ['workerId','workerName','workerNo','employeeId','employeeAuthUserId','version','active','employeeActive']);
  contains(body,"slot_item:=context->'slot'","'protocol','plan-coverage-source-v1'","stamp_format constant text:='YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'");
});
test('read lock rationale is checked against unchanged real schedule, clock and correction writer sources',()=>{
  const schedule=old('202610010099_merchant_attendance_schedule.sql');
  const clock=old('202610020111_merchant_attendance_self_clock_identity.sql');
  const decision=old('202609300086_merchant_attendance_correction_decisions.sql');
  const revision=old('202610010095_merchant_attendance_revision_cycles.sql');
  contains(schedule,'from public.merchant_attendance_settings where merchant_id=site for update;');
  contains(clock,'from public.merchant_attendance_settings where merchant_id=p_site_id for share;',
    'where merchant_id=p_site_id and employee_id=v_employee.id for update;');
  assert.match(decision,/merchant_attendance_settings[\s\S]*?for update/);
  assert.match(revision,/merchant_attendance_settings[\s\S]*?for update/);
});
test('newRPC alone is granted to service-role and final registry/security/PUBLIC ACL are checked atomically',()=>{
  contains(clean,`revoke all on function public.${rpc}(jsonb,uuid) from public,anon,authenticated,service_role;`,
    `grant execute on function public.${rpc}(jsonb,uuid) to service_role;`,
    "values(202610050139,'merchant_attendance_plan_coverage') on conflict(version) do nothing",
    "and prosecdef and provolatile='v' and proconfig=array['search_path=pg_catalog']",
    "is distinct from (r='service_role')","a.grantee=0 and a.privilege_type='EXECUTE'");
  assert.deepEqual([...clean.matchAll(/(?:revoke all|grant execute) on function public\.(\w+)/g)].map(m=>m[1]),[rpc,rpc]);
});
