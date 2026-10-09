// Source contracts only. Native PostgreSQL acceptance is orchestrated separately.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const filename='202610040133_merchant_attendance_shift_rule_bindings.sql';
const sql=readFileSync(new URL(`./supabase-migrations/${filename}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const clean=sql.replace(/--[^\n]*/g,'');
const fn=name=>{const start=clean.indexOf(`create or replace function public.${name}(`);assert(start>=0);return clean.slice(start,clean.indexOf('$$;',start)+3);};
const fields=fn('faolla_attendance_shift_rule_fields_v1'),valid=fn('faolla_attendance_shift_rule_source_valid_v1'),collect=fn('faolla_attendance_shift_rule_collect_v1'),bind=fn('faolla_attendance_bind_shift_rules_v1');
const ordered=(source,...parts)=>{let pos=-1;for(const part of parts){const next=source.indexOf(part,pos+1);assert(next>pos,part);pos=next;}};

test('133 adds only two private tables and four new helpers; never mutates old business tables or rewrites old functions',()=>{
  assert.deepEqual(validateMigrationSource(filename,sql),[]);
  assert.deepEqual([...clean.matchAll(/create table if not exists public\.(\w+)/g)].map(m=>m[1]),['merchant_attendance_shift_rule_sources','merchant_attendance_shift_rule_bindings']);
  assert.deepEqual([...clean.matchAll(/create or replace function public\.(\w+)/g)].map(m=>m[1]),['faolla_attendance_shift_rule_fields_v1','faolla_attendance_shift_rule_source_valid_v1','faolla_attendance_shift_rule_collect_v1','faolla_attendance_bind_shift_rules_v1']);
  assert.deepEqual([...clean.matchAll(/insert into public\.(\w+)/g)].map(m=>m[1]),['merchant_attendance_shift_rule_sources','merchant_attendance_shift_rule_bindings','merchant_attendance_shift_rule_bindings','faolla_schema_migrations']);
  assert.doesNotMatch(clean,/\b(?:update public\.|delete from|drop table|lock table)\b/i);
  assert.deepEqual([...clean.matchAll(/references public\.(\w+)/g)].map(m=>m[1]),['merchant_attendance_shift_rule_sources']);
  assert.doesNotMatch(clean,/faolla_attendance_rule_(?:sources|captures)_v1\(/);
});

test('dependencies, collision-safe reapply, private helper signatures and registry are explicit',()=>{
  for(const part of ["202609290064::bigint,'merchant_attendance_owner_configuration'","202610030124::bigint,'merchant_attendance_groups'",
    "202610040127::bigint,'merchant_attendance_rule_versions'","202610040129::bigint,'merchant_attendance_personal_rules'",
    "202610040130::bigint,'merchant_attendance_rule_sources'",'public.faolla_attendance_rule_sources_personal_checked_v1(public.merchant_attendance_personal_rule_operations,jsonb)',
    'installed<>(to_regclass','installed<>(to_regprocedure','merchant_attendance_shift_rule_bindings_installation_conflict',
    "values(202610040133,'merchant_attendance_shift_rule_bindings') on conflict(version) do nothing"])assert(clean.includes(part));
  assert(bind.includes('returns void language plpgsql security definer set search_path=pg_catalog'));
});

test('fresh clock-in boundary uses old millisecond precision, no xmin trap or old-fact backfill',()=>{
  for(const part of ["ev.action<>'clock_in'",'ev.occurred_at<>ev.received_at',"ev.received_at<date_trunc('milliseconds',statement_timestamp())",
    'ev.received_at>clock_timestamp()',"p_channel not in('self','location','pin','onsite')", "(p_channel='pin')<>(p_auth_user_id is null)"])assert(bind.includes(part));
  assert.doesNotMatch(bind,/xmin|pg_current_xact_id|for update|for share|\bupdate\b/i);
  ordered(bind,'begin\n    if exists(select 1 from public.merchant_attendance_shift_rule_bindings','point:=public.faolla_attendance_shift_rule_collect_v1');
});

test('all channel receipts are checked and PIN request Auth remains distinct from employee member Auth',()=>{
  for(const part of ['merchant_attendance_pin_clock_receipts','merchant_attendance_onsite_receipts','merchant_attendance_location_clock_notices',
    "channel_receipt->>'worker_id' is distinct from ev.worker_id::text", "channel_receipt->>'employee_id' is distinct from ev.actor_employee_id::text",
    "channel_receipt->'command'->>'operationId' is distinct from ev.operation_id::text", "channel_receipt->'command'->'expectedSequence' is distinct from to_jsonb(ev.sequence-1)",
    "p_channel<>'pin' and p_auth_user_id is distinct from e.auth_user_id",'w.employee_id is distinct from ev.actor_employee_id',
    "if e.id is null or e.auth_user_id is null", "e.status is distinct from 'active'"])assert(collect.includes(part));
  assert(bind.includes('request_auth_user_id,employee_id,employee_auth_user_id'));
  assert(bind.includes('ev.actor_employee_id,member_auth'));
});

test('source reads are independent of owner APIs and acquire no new lock order or settings lock upgrade',()=>{
  assert.doesNotMatch(collect,/for update|for share|pg_advisory|public\.merchants|user_id=p_auth_user_id|faolla_attendance_rule_sources_v1/);
  assert(sql.includes('settings SHARE'));assert(sql.includes('worker UPDATE'));assert(sql.includes('124/127/129 require settings UPDATE'));
});

test('assignment candidates are bounded before expensive work; UTC endpoints and full original/current assignment history are fixed once',()=>{
  ordered(collect,"x.status<>'cancelled'",'limit 101','candidate_count>100','foreach a in array assignment_candidates','faolla_attendance_rule_day_start_v1');
  for(const part of ["x.starts_on<=at_day+2",'x.ends_on>=at_day-2',"jsonb_build_array('start',a.time_zone,a.starts_on)",
    "start_at>ev.occurred_at or end_at<=ev.occurred_at",'attendance_shift_rule_assignment_overlap','faolla_attendance_group_assignment_detail_v1(a)',
    "'fromAt'", "'toAt'", "'originalFromAt'", "'originalToAt'",'a.employee_id is distinct from e.id','attendance_shift_rule_inactive_group'])assert(collect.includes(part));
  assert(collect.includes("date_trunc('milliseconds',a.updated_at)>ev.occurred_at"));
});

test('enterprise/group use indexed latest unwithdrawn publication at the original event instant rather than current time or a history page',()=>{
  for(const part of ["array['enterprise',gid::text]",'faolla_attendance_rule_stream_checked_v1(stream)',"x.action='publish' and x.effective_at<=ev.occurred_at",
    "wd.action='withdraw' and wd.published_revision=publication.revision",'order by x.effective_at desc limit 101','faolla_attendance_rule_receipt_v1(publication)',
    "enterprise_item:=jsonb_build_object('revision',head,'publication',publication_item)"])assert(collect.includes(part));
  ordered(collect,'publication_candidates:=array','limit 101','foreach publication in array publication_candidates','source_count:=source_count+1','source_count>100',"wd.action='withdraw'",'publication_item:=publication.snapshot;exit');
  assert(!collect.includes('source_count+cardinality(publication_candidates)'));
  assert.doesNotMatch(collect,/beforeRevision|limit 25|clock_timestamp\(/);
});

test('personal current dual identity is checked even when no interval covers clock-in; active intervals use exact endpoints and elapsed-hours bound',()=>{
  ordered(collect,'ps.employee_id is distinct from e.id or ps.employee_auth_user_id is distinct from e.auth_user_id','personal_candidates:=array');
  for(const part of ["x.from_at>=ev.occurred_at-interval '816 hours'",'x.from_at<=ev.occurred_at','approval.to_at<=ev.occurred_at',
    "wd.action='withdraw' and wd.approved_revision=approval.revision",'personal_active>1','attendance_shift_rule_personal_overlap',
    'faolla_attendance_rule_sources_personal_checked_v1(approval,personal_check_cache)','source_count>100'])assert(collect.includes(part));
  ordered(collect,'personal_candidates:=array','order by x.from_at,x.to_at limit 101','source_count>100','foreach approval in array personal_candidates',"wd.action='withdraw'");
  assert.doesNotMatch(collect,/interval '34 days'/);
});

test('personal validation reuses130 receipt-equivalent invocation cache for dense withdrawals without an owner source RPC or old helper rewrite',()=>{
  assert(collect.includes("personal_check_cache jsonb:='{}'"));
  for(const name of ['approval','personal_withdrawal'])assert(collect.includes(`personal_check_cache:=public.faolla_attendance_rule_sources_personal_checked_v1(${name},personal_check_cache)`));
  assert.doesNotMatch(collect,/perform public\.faolla_attendance_personal_rule_receipt_v1\(/);
  assert.doesNotMatch(clean,/create or replace function public\.faolla_attendance_rule_sources_personal_checked_v1\(/);
  assert.doesNotMatch(collect,/faolla_attendance_rule_sources_v1\(|set_config\(|current_setting\(/);
});

test('immutable field resolution preserves personal-group-enterprise trace, zero, disabled, inheritance and unconfigured without formal conclusions',()=>{
  for(const part of ["array['personal','group','enterprise']", "selected_state:='unconfigured'", "then 'missing_approval'", "then 'no_assignment'",
    "else 'missing_publication'", "mode_name in('disabled','value')", "when mode_name='value' then choice->'minutes'", "'trace',trace"])assert(fields.includes(part));
  assert.doesNotMatch(fields,/clock_timestamp|day_start|at time zone|select.*from public\.|coalesce\(.*minutes/);
  assert(sql.includes('verified means a complete source selection, NOT normal attendance'));
  assert(clean.includes("'personal-group-enterprise-point-v1'"));assert(clean.includes("'clock-in-whole-shift-v1'"));
});

test('small point graph is exact UTF8 hashed and later validation does not use current timezone rules',()=>{
  for(const part of ['p_bytes not between 1 and 65536',"p_bytes<>octet_length(convert_to(p_text,'UTF8'))","p_hash<>encode(sha256(convert_to(p_text,'UTF8')),'hex')",
    'jsonb_object_keys(p))<>15',"p->'fields' is distinct from public.faolla_attendance_shift_rule_fields_v1(p)"])assert(valid.includes(part));
  assert.doesNotMatch(valid,/valid_zone|day_start|rule_sources_v1|clock_timestamp|at time zone/);
  const point=collect.slice(collect.indexOf("point:=jsonb_build_object('protocol'"));
  assert.doesNotMatch(point,/eventId|observedAt|readAt|occurredAt|clock_timestamp/);
  assert(point.includes("octet_length(convert_to(point::text,'UTF8'))>65536"));
});

test('existing immutable artifact dedup bypasses quota lock; missing artifact is double-checked under nonwaiting merchant lock',()=>{
  ordered(bind,'select * into artifact','if not found then','pg_try_advisory_xact_lock','select * into artifact','if artifact.source_id is null then','if n>=256','insert into public.merchant_attendance_shift_rule_sources','if artifact.source_text<>body');
  assert.equal((bind.match(/select \* into artifact/g)||[]).length,2);
  assert.doesNotMatch(bind,/pg_advisory_xact_lock\(|pg_advisory_lock\(/);
  for(const part of ["'faolla:shift-rule-sources:v1:'||ev.merchant_id",'limit 257','if n>=256 or b+body_bytes>8388608','limit 4097','if n>=4096 or b+body_bytes>67108864'])assert(bind.includes(part));
});

test('source subtransaction failure writes only sanitized unverified with no fake source; catastrophic failures remain fatal',()=>{
  assert.equal((bind.match(/exception when others then/g)||[]).length,2);
  assert.equal((bind.match(/left\(failure_state,2\) in\('08','40','53','54','57','58','XX'\) then raise/g)||[]).length,2);
  for(const part of ["'unverified',reason_name,null", "else 'source_unavailable' end", "then 'source_invalid'",'get stacked diagnostics failure_state=returned_sqlstate'])assert(bind.includes(part));
  assert.doesNotMatch(bind,/raise notice|raise warning|insert.*failure_message|query_canceled|assert_failure/);
  ordered(bind,"'verified',null,artifact.source_id",'exception when others then',"'unverified',reason_name,null",'exception when others then');
});

test('both private tables are immutable RLS, no old-event FK and no service/helper grants; reapply checks trigger effectiveness',()=>{
  assert.doesNotMatch(clean,/grant execute|grant select/);
  for(const suffix of ['sources','bindings'])assert(clean.includes(`alter table public.merchant_attendance_shift_rule_${suffix} enable row level security`));
  for(const part of ['before update or delete on public.%I','before truncate on public.%I',"tgenabled='O' and tgtype=27","tgenabled='O' and tgtype=34",
    'merchant_attendance_shift_rule_bindings_immutable_postcondition_failed','merchant_attendance_shift_rule_bindings_acl_postcondition_failed',
    "a.grantee=0 and a.privilege_type='EXECUTE'",'from public,anon,authenticated,service_role'])assert(clean.includes(part));
  assert(!clean.includes('references public.merchant_attendance_events'));
});
