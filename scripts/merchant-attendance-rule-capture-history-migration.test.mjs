// Static contracts only; runtime is performed separately in an owned namespace.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const filename='202610040132_merchant_attendance_rule_capture_history.sql';
const source=readFileSync(new URL(`./supabase-migrations/${filename}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const clean=source.replace(/--[^\n]*/g,'');
const start=clean.indexOf('create or replace function public.faolla_attendance_rule_capture_history_v1(');
const rpc=clean.slice(start,clean.indexOf('$$;',start)+3);
const ordered=(...parts)=>{let position=-1;for(const part of parts){const next=rpc.indexOf(part,position+1);assert(next>position,part);position=next;}};

test('132 adds exactly one read-only function and registry row, with no table/index/old-writer changes',()=>{
  assert.deepEqual(validateMigrationSource(filename,source),[]);
  assert.deepEqual([...clean.matchAll(/create or replace function public\.(\w+)/g)].map(match=>match[1]),['faolla_attendance_rule_capture_history_v1']);
  assert.deepEqual([...clean.matchAll(/insert into public\.(\w+)/g)].map(match=>match[1]),['faolla_schema_migrations']);
  assert.doesNotMatch(clean,/\b(?:create\s+(?:table|index)|alter\s+table|update\s+public\.|delete\s+from|truncate|drop|lock\s+table)\b/i);
  assert.doesNotMatch(rpc,/\b(?:insert|update|delete|truncate|execute|pg_advisory|offset)\b/i);
});

test('132 checks064/131 and required private helpers; conflicting/partial install is rejected and reapply registered',()=>{
  for(const fragment of ["202609290064::bigint,'merchant_attendance_owner_configuration'","202610040131::bigint,'merchant_attendance_rule_captures'",
    'public.faolla_attendance_rule_capture_command_v1(jsonb)','public.faolla_attendance_group_text_v1(text,integer,integer)',
    "installed<>(to_regprocedure('public.faolla_attendance_rule_capture_history_v1(jsonb,uuid)') is not null)",
    'merchant_attendance_rule_capture_history_installation_conflict',"values(202610040132,'merchant_attendance_rule_capture_history') on conflict(version) do nothing"])assert(clean.includes(fragment));
});

test('query is exact7, continuation allnull/allnonnull, canonical microsecondUTC with no userpage size',()=>{
  for(const fragment of ['jsonb_object_keys(p_query))<>7',"array['siteId','workerId','asOf','beforeAt','beforeId','expectedEmployeeId','expectedEmployeeAuthUserId']",
    "array['asOf','beforeAt','beforeId','expectedEmployeeId','expectedEmployeeAuthUserId']","(p_query->k<>'null'::jsonb)<>continuation",
    "to_char((p_query->>k)::timestamptz at time zone 'UTC',stamp_format)<>", 'if before_at>cutoff', 'if cutoff>read_at'])assert(rpc.includes(fragment));
  assert.doesNotMatch(rpc,/pageSize|limitSize|p_query->>'(?:limit|offset)'/);
});

test('currentowner and dualidentity are locked/rechecked in131 order; active state and pause do not block lists',()=>{
  ordered('perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share',
    'select * into s from public.merchant_attendance_settings where merchant_id=site for share',
    'select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for share',
    'select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share',
    "if w.employee_id is null or e.id is null or e.auth_user_id is null", "p_query->>'expectedEmployeeId' is distinct from w.employee_id::text",
    "p_query->>'expectedEmployeeAuthUserId' is distinct from e.auth_user_id::text", 'read_at:=clock_timestamp()');
  assert.doesNotMatch(rpc,/for update|p_module|p_allow|if not w.active|if e.status|s.enabled/i);
});

test('eligible cursor anchor binds currentactor worker bothidentities and exacttimestamp before page selection',()=>{
  ordered('perform 1 from public.merchant_attendance_rule_capture_operations o',
    'o.actor_auth_user_id=p_auth_user_id and o.employee_id=w.employee_id and o.employee_auth_user_id=e.auth_user_id',
    'o.operation_id=before_id and o.recorded_at=before_at and o.recorded_at<=cutoff',
    "if not found then raise exception 'attendance_invalid_request'", 'for row_item in');
  for(const fragment of ['where o.merchant_id=site and o.worker_id=wid and o.actor_auth_user_id=p_auth_user_id',
    'and o.employee_id=w.employee_id and o.employee_auth_user_id=e.auth_user_id and o.recorded_at<=cutoff',
    '(o.recorded_at,o.operation_id)<(before_at,before_id)','order by o.recorded_at desc,o.operation_id desc limit 26'])assert(rpc.includes(fragment));
});

test('metadata-only projection avoids source bodies/hash or131/130 execution and uses composite binding join',()=>{
  assert.doesNotMatch(rpc,/source_text|sourceText|semantic_sha|sha256\(|faolla_attendance_rule_captures_v1\(|faolla_attendance_rule_sources_v1\(|select\s+a\.\*/i);
  for(const fragment of ['a.merchant_id=o.merchant_id and a.source_id=o.source_id','a.worker_id=o.worker_id and a.actor_auth_user_id=o.actor_auth_user_id',
    'a.employee_id=o.employee_id and a.employee_auth_user_id=o.employee_auth_user_id','row_item.source_bytes not between 1 and 1048576',
    'row_item.source_read_at>row_item.observed_at or row_item.observed_at>row_item.recorded_at'])assert(rpc.includes(fragment));
});

test('26th metadata row emits cursor from last25th item, all fields bounded64KiB and no applicationclaim',()=>{
  ordered('n:=n+1;if n=26 then',"'beforeAt',item->>'recordedAt','beforeId',item->>'operationId'",'exit;end if;',
    "item:=jsonb_build_object('operationId'",'items:=items||jsonb_build_array(item)');
  for(const fragment of ["'protocol','rule-capture-history-v1','readOnly',true","'applied',false,'historicalApplicationProven',false",
    "'workerActive',w.active,'employeeActive',e.status='active'","'nextCursor',cursor_item","octet_length(convert_to(result::text,'UTF8'))>65536"])assert(rpc.includes(fragment));
});

test('only service role gains execution; no old grants and public/anon/authenticated denial is asserted',()=>{
  assert.equal((clean.match(/grant execute/g)||[]).length,1);assert.equal((clean.match(/revoke all/g)||[]).length,1);
  assert(clean.includes('revoke all on function public.faolla_attendance_rule_capture_history_v1(jsonb,uuid) from public,anon,authenticated,service_role'));
  assert(clean.includes('grant execute on function public.faolla_attendance_rule_capture_history_v1(jsonb,uuid) to service_role'));
  assert(clean.includes("a.grantee=0 and a.privilege_type='EXECUTE'"));assert(clean.includes('merchant_attendance_rule_capture_history_acl_postcondition_failed'));
});
