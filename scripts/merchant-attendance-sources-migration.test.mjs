// Source contracts only. Root separately owns real PostgreSQL acceptance.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const name='202610040128_merchant_attendance_sources.sql';
const sql=readFileSync(new URL(`./supabase-migrations/${name}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const clean=sql.replace(/--[^\n]*/g,'');
const helper=clean.slice(clean.indexOf('create or replace function public.faolla_attendance_sources_schedule_v1'),clean.indexOf('create or replace function public.faolla_attendance_sources_v1'));
const body=clean.slice(clean.indexOf('create or replace function public.faolla_attendance_sources_v1'),clean.indexOf('revoke all on function public.faolla_attendance_sources_schedule_v1'));
function ordered(...parts){let prior=-1;for(const part of parts){const at=body.indexOf(part,prior+1);assert(at>prior,`missing/out-of-order ${part}`);prior=at;}}

test('128 registers an additive read-only function migration without old writers, data, tables or indexes',()=>{
  assert.deepEqual(validateMigrationSource(name,sql),[]);
  assert.deepEqual([...clean.matchAll(/create or replace function public\.(\w+)/g)].map(match=>match[1]),['faolla_attendance_sources_schedule_v1','faolla_attendance_sources_v1']);
  assert.deepEqual([...clean.matchAll(/insert into public\.(\w+)/g)].map(match=>match[1]),['faolla_schema_migrations']);
  assert.doesNotMatch(clean,/\b(?:update public|delete from|create table|create index|create trigger|alter table|drop|truncate)\b/i);
  assert(clean.includes("values(202610040128,'merchant_attendance_sources') on conflict(version) do nothing"));
  for(const id of ['202610010093','202610010099','202610010103','202610030122','202610030123','202610030124','202610040127'])assert(clean.includes(id+'::bigint'));
  assert(clean.includes('merchant_attendance_sources_installation_conflict'));
  assert(clean.includes('installed<>(to_regprocedure(p) is not null)'));
});

test('query is exact owner single-worker seven inclusive dates with no command or caller-controlled access',()=>{
  assert(body.includes('faolla_attendance_sources_v1(p_query jsonb,p_auth_user_id uuid)'));
  assert(body.includes("array['siteId','workerId','fromDate','throughDate']"));
  assert(body.includes('jsonb_object_keys(p_query))<>4'));
  assert(body.includes('last_day-first_day not between 0 and 6'));
  assert(body.includes("faolla_attendance_group_date_v1(p_query->>'fromDate')"));
  assert.doesNotMatch(body,/p_command|p_allow_write|s\.enabled|default_location_id|\bset_config\(/);
});

test('existing unified owner authorization and retained locks precede every additional source read',()=>{
  ordered("attendance:=public.faolla_attendance_unified_report_v1(site,p_auth_user_id,(p_query-'siteId')||jsonb_build_object('access','owner'))",
    'select * into s from public.merchant_attendance_settings where merchant_id=site for share',
    'select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for share',
    'assignment_candidates:=array(select', 'for gid in select', 'schedule_candidates:=array(select', 'leave_candidates:=array(select', 'calendar_candidates:=array(select');
  assert.doesNotMatch(body,/language plpgsql stable/);
  assert(body.includes("attendance->'complete' is distinct from 'true'::jsonb"));
  assert(body.includes("base->>'workerId' is distinct from wid::text"));
  assert(body.includes("read_at<(base->>'asOf')::timestamptz"));
});

test('assignment candidates retain cancellation history and original open range then precisely filter original UTC bounds',()=>{
  ordered('a.original_ends_on is null or a.original_ends_on>=first_day-2', 'order by a.assignment_id limit 101',
    'assignment_limited:=cardinality(assignment_candidates)>100', 'faolla_attendance_group_assignment_detail_v1(assignment)',
    'faolla_attendance_control_day_boundary_v1(assignment.starts_on,assignment.time_zone)',
    'faolla_attendance_control_day_boundary_v1(assignment.original_ends_on+1,assignment.time_zone)',
    'if interval_from_at>=to_at or interval_to_at<=from_at then continue', 'faolla_attendance_group_checked_v1(g)');
  const assignments=body.slice(body.indexOf('assignment_candidates:=array(select'),body.indexOf('rule_limited:='));
  assert.doesNotMatch(assignments,/status\s*(?:=|<>)|g\.active|w\.active|a\.ends_on/);
  assert(body.includes('rule_limited:=assignment_limited'));
});

test('rule carry-in comes from effective-time publications not a latest-operation page and both fanout limits fail closed',()=>{
  for(const part of ['cardinality(group_ids)+1>100','p.effective_at<=from_at','order by p.effective_at desc limit 1',
    'p.effective_at>from_at and p.effective_at<to_at','order by p.effective_at limit 101','wd.published_revision=p.revision',
    'faolla_attendance_rule_stream_checked_v1(stream)','publication_count>100 then rule_limited:=true;rule_items:=',
    'faolla_attendance_rule_receipt_v1(publication)',"'groupId',gid,'revision',head_revision,'publications',publication_items"])assert(body.includes(part),part);
  assert(body.includes('head_revision:=0'));
  assert(body.includes('x.stream_key=scope_key'));
  assert.doesNotMatch(body,/stream_key=stream_key|limit 25|limit 26/);
});

test('interval candidate caps precede endpoint filtering and summaries retain cancelled and historical identities',()=>{
  ordered("p.start_at>=from_at-interval '24 hours'",'order by p.start_at,p.end_at limit 101',
    'schedule_limited:=cardinality(schedule_candidates)>100','if not schedule_limited then','if slot.end_at<=from_at then continue',
    "p.start_at>=from_at-interval '8784 hours'",'order by p.start_at,p.end_at limit 101',
    'leave_limited:=cardinality(leave_candidates)>100','if not leave_limited then','if leave_request.end_at<=from_at then continue',
    'faolla_attendance_leave_summary_v1(leave_request)');
  assert(body.includes("'workerId',leave_request.worker_id,'employeeId',leave_request.employee_id,'summary',summary"));
  assert(body.includes("'operationId',leave_entry.operation_id,'recordedAt'"));
  assert.doesNotMatch(body,/leave_request\.reason|leave_entry\.command|leave_request\.employee_id\s*=|where[^;]*status='approved'/);
});

test('schedule helper validates original and cancellation commands but only emits the existing thirteen entry fields',()=>{
  for(const part of ['where merchant_id=p.merchant_id and revision=p.revision',"original.command->>'action' is distinct from 'publish'",
    'jsonb_array_length(original.command->\'slots\') not between 1 and 32','if matches<>1',
    "cancelled.command->>'action' is distinct from 'cancel'","cancelled.command->>'slotId' is distinct from p.id::text",
    'not isfinite(cancelled.recorded_at)','cancelled.recorded_at<original.recorded_at'])assert(helper.includes(part),part);
  // 099 checks a captured pre-insert clock, not the later receipt timestamp.
  assert.doesNotMatch(helper,/(?:original|cancelled)\.recorded_at\s*>=\s*p\.start_at/);
  const output=helper.slice(helper.indexOf('return jsonb_build_object'));
  assert.deepEqual([...output.matchAll(/(?<=[(,])\s*'([A-Za-z]+)',/g)].map(match=>match[1]),[
    'id','workerId','workerName','locationId','locationName','timeZone','workDate','startAt','endAt','revision','cancelled','reason','cancelReason']);
});

test('calendar only uses actual raw, missing and schedule locations and limits unknown location coverage',()=>{
  for(const part of ['calendar_limited:=schedule_limited',"jsonb_array_elements(base->'items')", "jsonb_array_elements(row_item->'events')",
    "jsonb_array_elements(attendance->'missing')",'jsonb_array_elements(schedule_items)','cardinality(location_ids)>100',
    'c.location_id is null or c.location_id=any(location_ids)','c.from_date<=last_day+2 and c.through_date>=first_day-2',
    'calendar_limited:=cardinality(calendar_candidates)>100','faolla_attendance_calendar_summary_v1(calendar_entry)',
    'faolla_attendance_control_day_boundary_v1(calendar_entry.through_date+1,calendar_entry.time_zone)'])assert(body.includes(part),part);
  assert.doesNotMatch(body,/default_location|employment_period|notification/);
});

test('all four collections detect101 before validating any discarded row while exactly100 remains complete',()=>{
  for(const [name,target,validator] of [
    ['assignment','assignment','faolla_attendance_group_assignment_detail_v1(assignment)'],
    ['schedule','slot','faolla_attendance_sources_schedule_v1(slot)'],
    ['leave','leave_request','faolla_attendance_leave_summary_v1(leave_request)'],
    ['calendar','calendar_entry','faolla_attendance_calendar_summary_v1(calendar_entry)'],
  ]){
    ordered(`${name}_candidates:=array(select`, 'limit 101);', `${name}_limited:=cardinality(${name}_candidates)>100;`,
      `if not ${name}_limited then`, `foreach ${target} in array ${name}_candidates loop`, validator);
    const scan=body.slice(body.indexOf(`${name}_candidates:=array(select`),body.indexOf(`${name}_limited:=cardinality(${name}_candidates)>100;`));
    assert.doesNotMatch(scan,/faolla_attendance_\w+\(/,'preflight must not execute per-row validation/boundary functions');
  }
  assert.doesNotMatch(body,/cardinality\(\w+_candidates\)>=100|n>100 then/);
  for(const name of ['assignment','schedule','leave','calendar'])assert(body.includes(`${name}_items jsonb:='[]'`));
});

test('per-invocation boundary cache includes both zone and date without caching source validation or raising timeouts',()=>{
  assert(body.includes("boundary_cache jsonb:='{}'"));
  for(const [row,date,target] of [
    ['assignment','starts_on','interval_from_at'],['assignment','original_ends_on+1','interval_to_at'],
    ['calendar_entry','from_date','interval_from_at'],['calendar_entry','through_date+1','interval_to_at'],
  ])ordered(`boundary_key:=jsonb_build_array(${row}.time_zone,${row}.${date})::text;`,
    `${target}:=(boundary_cache->>boundary_key)::timestamptz;`, `if ${target} is null then`,
    `${target}:=public.faolla_attendance_control_day_boundary_v1(${row}.${date},${row}.time_zone);`,
    `boundary_cache:=boundary_cache||jsonb_build_object(boundary_key,${target});`);
  assert.equal((body.match(/boundary_cache:=/g)||[]).length,4);
  assert.doesNotMatch(clean,/statement_timeout|set_config|create.*function public\.faolla_attendance_control_day_boundary_v1/);
  assert.equal((body.match(/if interval_from_at>=to_at or interval_to_at<=from_at then continue/g)||[]).length,2);
});

test('exact raw envelope keeps original unified attendance, explicit limited sections, canonical precision and one MiB bound',()=>{
  const output=body.slice(body.indexOf("result:=jsonb_build_object('protocol'"),body.indexOf('if octet_length'));
  const top=output.slice(0,output.indexOf("'assignments'"));
  assert.deepEqual([...top.matchAll(/(?<=[(,])\s*'([A-Za-z]+)',/g)].map(match=>match[1]),['protocol','siteId','actorId','fromDate','throughDate','worker','settingsVersion','timeZone','fromAt','toAt','readAt','attendance']);
  for(const section of ['assignments','rules','schedule','leave','calendar'])assert(output.includes(`'${section}',jsonb_build_object('limited',`));
  assert(body.includes('SS.MS"Z"'));assert(body.includes('SS.US"Z"'));
  assert(body.includes("octet_length(result::text)>1048576 then raise exception 'attendance_sources_too_large'"));
});

test('only the new reauthorizing RPC is service-executable and private helper ACL is checked',()=>{
  assert.equal((clean.match(/grant execute/g)||[]).length,1);
  assert(clean.includes('grant execute on function public.faolla_attendance_sources_v1(jsonb,uuid) to service_role'));
  assert(clean.includes('revoke all on function public.faolla_attendance_sources_schedule_v1(public.merchant_attendance_schedule_slots) from public,anon,authenticated,service_role'));
  assert(clean.includes("has_function_privilege(r,'public.faolla_attendance_sources_schedule_v1(public.merchant_attendance_schedule_slots)','EXECUTE')"));
  assert(clean.includes("notify pgrst, 'reload schema'"));
});
