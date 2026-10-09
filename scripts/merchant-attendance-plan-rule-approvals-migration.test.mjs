// Static source contracts, not PostgreSQL execution or concurrency proof.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const filename='202610050140_merchant_attendance_plan_rule_approvals.sql';
const source=readFileSync(new URL('./supabase-migrations/'+filename,import.meta.url),'utf8').replaceAll('\r\n','\n');
const sql=source.replace(/--[^\n]*/g,'');
const functions=['command','fields','source','point','same','preview','approvals'];
const functionName=name=>'faolla_attendance_plan_rule_'+name+'_v1';
const body=name=>{
  const at=sql.indexOf('create or replace function public.'+functionName(name)+'(');
  assert(at>=0,name);return sql.slice(at,sql.indexOf('$$;',at)+3);
};
const rpc=body('approvals');
const contains=(text,...parts)=>{for(const part of parts)assert(text.includes(part),part);};
const ordered=(text,...parts)=>{let at=-1;for(const part of parts){const next=text.indexOf(part,at+1);assert(next>at,part);at=next;}};
const old=name=>readFileSync(new URL('./supabase-migrations/'+name,import.meta.url),'utf8');

test('140 adds seven functions, three private tables and no old writes',()=>{
  assert.deepEqual(validateMigrationSource(filename,source),[]);
  assert.deepEqual([...sql.matchAll(/create or replace function public\.(\w+)/g)].map(x=>x[1]),functions.map(functionName));
  assert.deepEqual([...sql.matchAll(/create table if not exists public\.(\w+)/g)].map(x=>x[1]),
    ['merchant_attendance_plan_rule_artifacts','merchant_attendance_plan_rule_operations','merchant_attendance_plan_rule_streams']);
  for(const hit of sql.matchAll(/\b(?:insert into|alter table|references|revoke all on)\s+public\.(\w+)/g)){
    assert(hit[1]==='faolla_schema_migrations'||hit[1].startsWith('merchant_attendance_plan_rule_'),hit[1]);
  }
  assert.doesNotMatch(sql,/\b(?:drop|delete from|truncate table|lock table|create extension)\b/i);
  assert.doesNotMatch(rpc,/faolla_attendance_(?:self|schedule|groups|personal_rules|rules|bind_shift_rules)_v1\(/);
});
test('dependencies, registry and orphan conflicts precede new schema',()=>{
  contains(sql,"(202610040130::bigint,'merchant_attendance_rule_sources')","(202610040133::bigint,'merchant_attendance_shift_rule_bindings')",
    "(202610040135::bigint,'merchant_attendance_shift_rule_binding_reader')","(202610050136::bigint,'merchant_attendance_schedule_publication_evidence')",
    "(202610050137::bigint,'merchant_attendance_self_schedule')","(202610050139::bigint,'merchant_attendance_plan_coverage')",
    "to_regclass('public.attendance_shift_schedule_slot_idx') is null","installed<>(to_regclass('public.'||t) is not null)",
    "installed<>(to_regprocedure(p) is not null)","version=202610050140 and name<>'merchant_attendance_plan_rule_approvals'");
  ordered(sql,'$plan_rules_prerequisites$;','create or replace function public.'+functionName('command'));
});
test('exact modes and command accept no client rules/source payload',()=>{
  contains(rpc,"array['siteId','workerId','slotId','mode','operationId']","mode_name in('preview','read')",
    "p_query->'operationId'<>'null'::jsonb or p_command is not null","mode_name='recover' and p_command is not null",
    "mode_name='approve' and (p_command is null","p_command->>'operationId' is distinct from op::text");
  contains(body('command'),"array['operationId','expectedRevision','expectedFingerprint','employeeId','employeeAuthUserId','reason']",
    "'^[0-9a-f]{64}$'","<9007199254740990","octet_length(convert_to(p::text,'UTF8'))>4096");
  assert.doesNotMatch(rpc,/p_command->(?:>)?'(?:rules|source|timeZone|asOf|startAt|endAt)'/);
});
test('identity SHARE order precedes new advisory serialization without old lock upgrade',()=>{
  ordered(rpc,'from public.merchants where id=site and user_id=p_auth_user_id for share;',
    'from public.merchant_attendance_settings where merchant_id=site for share;',
    'from public.merchant_attendance_workers where merchant_id=site and id=wid for share;',
    'from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;',
    "if mode_name='approve' then perform pg_advisory_xact_lock(",'select * into stream');
  assert.doesNotMatch(rpc,/for update|for no key update|pg_advisory_lock|pg_sleep/);
  contains(rpc,"'faolla:attendance-plan-rule-approvals:v1:'||site","where x.merchant_id=site and x.worker_id=wid and x.id=sid",
    "publication->>'employeeAuthUserId' is distinct from e.auth_user_id::text");
});
test('locking rationale matches unchanged actual124127129 writers and137 clock mutex',()=>{
  for(const name of ['202610030124_merchant_attendance_groups.sql','202610040127_merchant_attendance_rule_versions.sql',
    '202610040129_merchant_attendance_personal_rules.sql']){
    contains(old(name),'from public.merchant_attendance_settings where merchant_id=site for update;');
  }
  contains(old('202610020111_merchant_attendance_self_clock_identity.sql'),
    'where merchant_id=p_site_id and employee_id=v_employee.id for update;');
  contains(rpc,'where r.merchant_id=site and r.slot_id=sid and r.slot_id is not null limit 1');
});
test('exact original replay precedes pause, active, time, CAS, source work and quotas',()=>{
  ordered(rpc,"mode_name in('recover','approve')",'select * into saved',
    'saved.worker_id<>wid or saved.slot_id<>sid or saved.actor_auth_user_id<>p_auth_user_id',
    "saved.command is distinct from p_command then raise exception 'attendance_operation_conflict'",
    "if mode_name='preview' or mode_name='approve' and saved.operation_id is null then",
    "if not p_module_enabled or not s.enabled then raise exception 'attendance_platform_paused'",
    "p_command->>'expectedRevision')::bigint<>head",'raw:=public.faolla_attendance_rule_sources_v1(',
    "if n>=1000 then raise exception 'attendance_plan_rule_limit'");
  contains(rpc,"elsif mode_name='read' and head>0 then","where x.merchant_id=site and x.slot_id=sid and x.revision=head",
    "if mode_name='recover' then","head:=stream.revision;");
});
test('current-owner read and original-actor recovery remain separate with current dual identity',()=>{
  contains(rpc,"if w.employee_id is null or e.id is null or e.auth_user_id is null",
    'stream.worker_id is distinct from wid or stream.employee_id is distinct from e.id or stream.employee_auth_user_id is distinct from e.auth_user_id',
    'saved.worker_id<>wid or saved.slot_id<>sid or saved.actor_auth_user_id<>p_auth_user_id',"elsif mode_name='read' and head>0 then");
  const archive=rpc.slice(rpc.indexOf('if saved.operation_id is not null then'),rpc.indexOf('read_at:=clock_timestamp();'));
  assert.doesNotMatch(archive,/saved\.actor_auth_user_id\s*(?:<>|is distinct from)\s*p_auth_user_id/);
  assert.doesNotMatch(archive,/rule_sources_v1|day_start|rule_end|at time zone s\.|valid_zone/);
});
test('new preview blockers include pause,136, cancellation, inactivity, time and explicit association',()=>{
  contains(rpc,"jsonb_build_array('module_paused')","jsonb_build_array('worker_inactive')","jsonb_build_array('publication_missing')",
    "jsonb_build_array('cancelled')","jsonb_build_array('started')","jsonb_build_array('associated')",
    "if jsonb_array_length(blockers)>0 then","'source',null","if not p_module_enabled or not s.enabled then blockers");
  assert.doesNotMatch(rpc,/slot\.location_id\s*(?:<>|is distinct from)\s*w\.default_location_id/);
});
test('SQL derives enterprise-local lookup from immutable slot UTC then re-reads and binds130 context',()=>{
  contains(rpc,"first_day:=(slot.start_at at time zone s.time_zone)::date",
    "last_day:=((slot.end_at-interval '1 microsecond') at time zone s.time_zone)::date",
    "raw:=public.faolla_attendance_rule_sources_v1(jsonb_build_object('siteId',site,'workerId',wid",
    "raw->'worker' is distinct from worker_item","raw->'settingsVersion' is distinct from to_jsonb(s.version)",
    "'locationVersion',publication->'locationVersion'");
  assert.doesNotMatch(rpc,/first_day:=slot\.work_date|now\(\)|transaction_timestamp/);
});
test('known internal boundaries only; normalization caches saved dates and no limited source becomes absence',()=>{
  const preview=body('preview');
  contains(preview,"raw->'assignments'->'limited' is distinct from 'false'::jsonb","raw->'rules'->'limited' is distinct from 'false'::jsonb",
    "raw->'personal'->'limited' is distinct from 'false'::jsonb","jsonb_build_array('source_incomplete')",
    "d->>'status'='cancelled' then continue","cache_key:=jsonb_build_array('start'","cache_key:=jsonb_build_array('end'",
    "where value->'withdrawal'='null'::jsonb","where x>start_at and x<end_at order by x",
    'previous_point:=first_point','faolla_attendance_plan_rule_same_v1(previous_point,next_point)',
    'previous_point:=next_point',"jsonb_build_array('source_switch')");
});
test('point selects future plan instant, uses half-open intervals and excludes withdrawals',()=>{
  const point=body('point');
  contains(point,"(row_item->>'_fromAt')::timestamptz>p_at","(row_item->>'_toAt')::timestamptz<=p_at",
    "(value->>'effectiveAt')::timestamptz<=p_at","order by (value->>'effectiveAt')::timestamptz desc limit 1",
    "row_item->'withdrawal'<>'null'::jsonb","(d->>'fromAt')::timestamptz>p_at","(d->>'toAt')::timestamptz<=p_at");
  assert.doesNotMatch(point,/clock_timestamp|current_date|now\(\)|from public\./);
});
test('only late/early preserve inherited disabled zero unknown, with separate plan policy',()=>{
  const fields=body('fields');
  contains(fields,"array['lateGraceMinutes','earlyGraceMinutes']","'openSpanWarningMinutes',jsonb_build_object('mode','inherit')",
    "'completedBreakMinimumMinutes',jsonb_build_object('mode','inherit')","faolla_attendance_shift_rule_fields_v1(graph)");
  contains(body('point'),"'protocol','plan-rule-point-v1'","'policy','owner-approved-plan-start-v1'");
  assert.doesNotMatch(fields,/coalesce\([^;]*,\s*0|clock-in-whole-shift|applied/);
});
test('switch comparison uses consulted prefix, provenance and explicit unused-only exception',()=>{
  const same=body('same');
  contains(same,"array['lateGraceMinutes','earlyGraceMinutes']","for i in 0..2 loop",
    "x->'mode' is distinct from y->'mode'","x->'minutes' is distinct from y->'minutes'",
    "layer='group' and (a->'source'->'assignment') is distinct from (b->'source'->'assignment')",
    "ar->'lateGraceMinutes' is distinct from br->'lateGraceMinutes'","ar->'earlyGraceMinutes' is distinct from br->'earlyGraceMinutes'",
    "or ar is not distinct from br then return false","if x->>'mode' in('value','disabled') then exit");
});
test('source fingerprint/CAS and final locked clock checks never claim commit timestamps',()=>{
  contains(rpc,"preview->>'fingerprint' is distinct from p_command->>'expectedFingerprint'",
    "then raise exception 'attendance_plan_rule_source_conflict'","head+1","on conflict(merchant_id,slot_id) do update set revision=excluded.revision");
  ordered(rpc,'source_size:=octet_length','stamp:=clock_timestamp();','if stamp>=slot.start_at',
    'insert into public.merchant_attendance_plan_rule_operations','insert into public.merchant_attendance_plan_rule_streams');
  assert.doesNotMatch(sql,/pg_xact_commit_timestamp|track_commit_timestamp|set_config/);
});
test('compact content equality dedup and bounded quota do not clone whole source history',()=>{
  contains(rpc,"x.worker_id=wid and x.source_sha256=fingerprint","artifact.source is distinct from source",
    'limit 51','n>=50 or b+source_size>8388608','limit 501','n>=500 or b+source_size>67108864','limit 1000',
    'artifact.source_id,observed_at,stamp');
  contains(sql,'deferrable initially deferred','attendance_plan_rule_first_operation_fk');
  assert.doesNotMatch(sql,/source_text|capture_artifacts|shift_rule_sources|delete\s+from/i);
});
test('archive UTF8 hash/size, source graph and timestamp cross-links are rechecked within32/64KiB caps',()=>{
  contains(body('source'),"octet_length(convert_to(p::text,'UTF8'))>32768","p->'fields' is not distinct from public.faolla_attendance_plan_rule_fields_v1(p)");
  contains(rpc,"artifact.source_sha256 is distinct from encode(sha256(convert_to(artifact.source::text,'UTF8')),'hex')",
    "artifact.source_bytes is distinct from octet_length(convert_to(artifact.source::text,'UTF8'))",
    'saved.observed_at>saved.recorded_at or saved.recorded_at>=slot.start_at',
    "(source_item->>'recordedAt')::timestamptz>saved.observed_at","(artifact.source->>'settingsVersion')::bigint>s.version",
    "octet_length(convert_to(result::text,'UTF8'))>65536");
  assert.doesNotMatch(body('source'),/at time zone|valid_zone|pg_timezone|\b(?:select|perform)\b/);
});
test('RLS and exact enabled append-only triggers deny direct role access to all new tables',()=>{
  contains(sql,'enable row level security','from public,anon,authenticated,service_role;',
    'before update or delete','before truncate','and relrowsecurity','from pg_policy',
    "pg_has_role(r,c.relowner,'USAGE')","aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))",
    "tgenabled='O'","tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure","then 27 else 34 end");
});
test('only the newRPC grants service execute; helper definitions ACL and registry are checked on reapply',()=>{
  assert.deepEqual([...sql.matchAll(/grant execute on function public\.(\w+)/g)].map(x=>x[1]),[functionName('approvals')]);
  contains(sql,"values(202610050140,'merchant_attendance_plan_rule_approvals') on conflict(version) do nothing",
    "proconfig=array['search_path=pg_catalog']","prosecdef=(p like '%plan_rule_approvals_v1%')",
    "r='service_role' and p like '%plan_rule_approvals_v1%'","a.grantee=0 and a.privilege_type='EXECUTE'");
});
