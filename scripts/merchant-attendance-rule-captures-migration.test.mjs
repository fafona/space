// Static contracts only; actual PostgreSQL behavior is checked separately.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const filename='202610040131_merchant_attendance_rule_captures.sql';
const sql=readFileSync(new URL(`./supabase-migrations/${filename}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const clean=sql.replace(/--[^\n]*/g,'');
const fn=name=>{const start=clean.indexOf(`create or replace function public.${name}(`);assert(start>=0);return clean.slice(start,clean.indexOf('$$;',start)+3);};
const rpc=fn('faolla_attendance_rule_captures_v1'),command=fn('faolla_attendance_rule_capture_command_v1'),source=fn('faolla_attendance_rule_capture_source_v1');
const ordered=(...parts)=>{let pos=-1;for(const part of parts){const next=rpc.indexOf(part,pos+1);assert(next>pos,part);pos=next;}};

test('131 is additive, registers exactly two new tables and three new functions, with no old writer or business table mutations',()=>{
  assert.deepEqual(validateMigrationSource(filename,sql),[]);
  assert.deepEqual([...clean.matchAll(/create table if not exists public\.(\w+)/g)].map(match=>match[1]),['merchant_attendance_rule_capture_artifacts','merchant_attendance_rule_capture_operations']);
  assert.deepEqual([...clean.matchAll(/create or replace function public\.(\w+)/g)].map(match=>match[1]),['faolla_attendance_rule_capture_command_v1','faolla_attendance_rule_capture_source_v1','faolla_attendance_rule_captures_v1']);
  assert.doesNotMatch(clean,/\b(?:update public\.|delete from|drop table|lock table)\b/i);
  assert.deepEqual([...clean.matchAll(/insert into public\.(\w+)/g)].map(match=>match[1]),['merchant_attendance_rule_capture_artifacts','merchant_attendance_rule_capture_operations','faolla_schema_migrations']);
  assert.deepEqual([...clean.matchAll(/references public\.(\w+)/g)].map(match=>match[1]),['merchant_attendance_rule_capture_artifacts','merchant_attendance_rule_capture_operations']);
});

test('131 checks dependencies and complete installation before idempotent reapply',()=>{
  for(const pair of ["202609290064::bigint,'merchant_attendance_owner_configuration'","202610030124::bigint,'merchant_attendance_groups'",
    "202610040127::bigint,'merchant_attendance_rule_versions'","202610040129::bigint,'merchant_attendance_personal_rules'","202610040130::bigint,'merchant_attendance_rule_sources'"])assert(clean.includes(pair));
  for(const fragment of ['installed<>(to_regclass','installed<>(to_regprocedure','merchant_attendance_rule_captures_installation_conflict',
    "'pg_catalog.sha256(bytea)'","values(202610040131,'merchant_attendance_rule_captures') on conflict(version) do nothing"])assert(clean.includes(fragment));
});

test('query requires exact site worker and non-null operation; command is six-key, civil1to7, reason1to200 and no uploaded source',()=>{
  for(const fragment of ['jsonb_object_keys(p_query))<>3',"array['siteId','workerId','operationId']","jsonb_typeof(p_query->'operationId')<>'string'",
    "p_command->>'operationId'<>op::text"])assert(rpc.includes(fragment));
  for(const fragment of ['jsonb_object_keys(p))<>6',"array['operationId','fromDate','throughDate','reason','employeeId','employeeAuthUserId']",
    'last_day-first_day between 0 and 6',"faolla_attendance_group_text_v1(p->>'reason',1,200)",'4096'])assert(command.includes(fragment));
  assert.doesNotMatch(command,/time_zone|day_start|timezone|valid_zone|rule_sources_v1/);
});

test('owner settings worker employee SHARE order precedes merchant-only advisory lock with no settings lock upgrade',()=>{
  ordered('perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share',
    'select * into s from public.merchant_attendance_settings where merchant_id=site for share',
    'select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for share',
    'select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share',
    "pg_advisory_xact_lock(hashtextextended('faolla:attendance-rule-captures:v1:'||site,0))",'select * into saved');
  assert.doesNotMatch(rpc,/for update|lock table|pg_advisory_lock\(/i);
});

test('exact original recovery checks actor worker and dual identity before command, pause quotas and fresh source collection',()=>{
  ordered('if saved.worker_id<>wid or saved.actor_auth_user_id<>p_auth_user_id',
    'saved.employee_id is distinct from w.employee_id or saved.employee_auth_user_id is distinct from e.auth_user_id',
    'saved.command is distinct from p_command','elsif p_command is not null then','if not p_module_enabled',
    'if not w.active or e.id is null',"if n>=1000",'raw:=public.faolla_attendance_rule_sources_v1');
  assert.equal((rpc.match(/faolla_attendance_rule_sources_v1\(/g)||[]).length,1);
  assert(rpc.includes("raise exception 'attendance_access_denied'"));assert(rpc.includes("raise exception 'attendance_operation_conflict'"));
});

test('new sources are collected by130 and any limited section aborts before insertion',()=>{
  ordered('raw:=public.faolla_attendance_rule_sources_v1',"raw->'assignments'->'limited'", "raw->'rules'->'limited'", "raw->'personal'->'limited'",
    "raise exception 'attendance_rule_capture_incomplete'",'insert into public.merchant_attendance_rule_capture_artifacts');
  assert.doesNotMatch(rpc,/p_command\s*->>?\s*'(?:source|sourceText|sourceSha256|resolution)'/);
});

test('original PG text uses actualUTF8bytes andSHA256, semantic digest excludes onlyreadAt and collisions compare completeJSONB',()=>{
  for(const fragment of ["source_text:=raw::text;source_bytes:=octet_length(convert_to(source_text,'UTF8'))",
    "source_digest:=encode(sha256(convert_to(source_text,'UTF8')),'hex')", "encode(sha256(convert_to((raw-'readAt')::text,'UTF8')),'hex')",
    'a.worker_id=wid and a.actor_auth_user_id=p_auth_user_id and a.semantic_sha256=semantic_digest',
    "artifact.source_text::jsonb-'readAt' is distinct from raw-'readAt'"])assert(rpc.includes(fragment));
  assert(rpc.includes("'sourceText',artifact.source_text"));assert.doesNotMatch(rpc,/'sourceText',\s*(?:payload|raw)::text/);
});

test('worker and merchant byte/count limits plus1000operation limit are serialized and never delete evidence',()=>{
  for(const fragment of ['limit 1000','if n>=1000','limit 51','if n>=50 or b+source_bytes>8388608','limit 501','if n>=500 or b+source_bytes>67108864'])assert(rpc.includes(fragment));
  ordered('select * into artifact from public.merchant_attendance_rule_capture_artifacts a','if found then',"artifact.source_text::jsonb-'readAt'",'else','limit 51','limit 501','insert into public.merchant_attendance_rule_capture_artifacts');
  assert.doesNotMatch(rpc,/delete|truncate|on conflict/i);
});

test('artifact checks bind bytes identity and sourceReadAt without re-evaluating saved timezone conversions',()=>{
  for(const fragment of ["p_bytes<>octet_length(convert_to(p_text,'UTF8'))","p_digest<>encode(sha256(convert_to(p_text,'UTF8')),'hex')",
    "v->'worker'->>'employeeAuthUserId' is distinct from p_employee_auth::text","v->>'actorId' is distinct from p_actor::text",
    'jsonb_object_keys(v))<>14',"v->>'readAt' is distinct from to_char(p_read_at at time zone 'UTC'",'1048576'])assert(source.includes(fragment));
  assert.doesNotMatch(source,/valid_zone|day_start|rule_sources_v1\(|current_setting|clock_timestamp/);
  assert(source.includes("p_semantic_digest !~ '^[0-9a-f]{64}$'"));assert.doesNotMatch(source,/\(v-'readAt'\)::text/);
  assert(clean.includes('attendance_rule_capture_first_operation_fk'));assert(clean.includes('deferrable initially deferred'));
});

test('receipt retains first source timestamp but each operation gets a fresh observedAt and recordedAt; never claims application',()=>{
  for(const fragment of ['observed_at:=(raw->>\'readAt\')::timestamptz','stamp:=clock_timestamp()',
    'observed_at<artifact.source_read_at','saved.recorded_at<saved.observed_at',"'observedAt',to_char(saved.observed_at",
    "'sourceReadAt',to_char(artifact.source_read_at","'canonicalFormat','pg-jsonb-text-utf8-v1'","'applied',false,'historicalApplicationProven',false",
    "'protocol','candidate-rule-captures-v1'",'receipt:=null'])assert(rpc.includes(fragment));
  assert.doesNotMatch(rpc,/resolveCandidate|resolution|worked_us|elapsed_us|lockedPeriod/);
});

test('both tables are private RLS and immutable; only RPC service execution is granted',()=>{
  assert.equal((clean.match(/grant execute/g)||[]).length,1);
  for(const table of ['artifacts','operations'])assert(clean.includes(`alter table public.merchant_attendance_rule_capture_${table} enable row level security`));
  for(const fragment of ['before update or delete on public.%I','before truncate on public.%I','faolla_attendance_events_append_only_v1()',
    'grant execute on function public.faolla_attendance_rule_captures_v1(jsonb,uuid,jsonb,boolean) to service_role',
    'merchant_attendance_rule_captures_acl_postcondition_failed',"a.grantee=0 and a.privilege_type='EXECUTE'"])assert(clean.includes(fragment));
});
