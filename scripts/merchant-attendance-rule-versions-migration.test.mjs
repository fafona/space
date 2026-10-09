// Source-only contracts. Real PostgreSQL execution is a separate native check.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateMigrationSource } from './check-supabase-migrations.mjs';

const filename = '202610040127_merchant_attendance_rule_versions.sql';
const sql = readFileSync(new URL(`./supabase-migrations/${filename}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const clean = sql.replace(/--[^\n]*/g, '');
const body = clean.slice(clean.indexOf('create or replace function public.faolla_attendance_rules_v1('), clean.indexOf('do $rules_acl$'));
const tables = ['merchant_attendance_rule_streams', 'merchant_attendance_rule_operations'];
function ordered(...parts) {
  let offset = -1;
  for (const part of parts) { const found = body.indexOf(part, offset + 1); assert(found > offset, `missing/out-of-order ${part}`); offset = found; }
}

test('127 adds only two independent tables and registry; prerequisite/conflict and reapply gates remain explicit', () => {
  assert.deepEqual(validateMigrationSource(filename, sql), []);
  assert.deepEqual([...clean.matchAll(/create table if not exists public\.(\w+)/g)].map(match => match[1]), tables);
  for (const match of clean.matchAll(/(?:insert into|update) public\.(\w+)/g)) assert([...tables, 'faolla_schema_migrations'].includes(match[1]));
  assert(clean.includes("version=202609290064 and name='merchant_attendance_owner_configuration'"));
  assert(clean.includes("version=202610030124 and name='merchant_attendance_groups'"));
  assert(clean.includes('merchant_attendance_rule_versions_installation_conflict'));
  assert(clean.includes("values(202610040127,'merchant_attendance_rule_versions') on conflict(version) do nothing"));
  assert.doesNotMatch(clean, /\b(drop|delete from|disable trigger|owner to|create policy)\b/i);
  assert.doesNotMatch(body, /s\.enabled|merchant_attendance_(?:events\b|schedule_|leave_|calendar_|missing_|correction_|effect_)|merchant_enterprise_/);
});

test('strict query and command fields preserve independent target and revision scope', () => {
  for (const part of ["array['siteId','groupId','operationId','beforeRevision']", 'jsonb_object_keys(p_query))<>4',
    'if op is not null and before_rev is not null', 'if op is not null or before_rev is not null', "key:=coalesce(gid::text,'enterprise')",
    "p_command->'expectedGroupRevision'='null'::jsonb", '::numeric>9007199254740989', '::numeric>9007199254740990',
    "(p->>'publishedRevision')::numeric>(p->>'expectedRevision')::numeric"]) assert(clean.includes(part), part);
  assert(clean.includes("n<>8 or not(p ?& array['expectedSettingsVersion','expectedGroupRevision','timeZone'])"));
  assert(clean.includes("n<>5 or not(p ? 'publishedRevision')"));
});

test('all four fields distinguish inherit, disabled and bounded explicit integer values without defaults', () => {
  const helper = clean.slice(clean.indexOf('create or replace function public.faolla_attendance_rule_values_v1'), clean.indexOf('create or replace function public.faolla_attendance_rule_day_start_v1'));
  for (const part of ["array['lateGraceMinutes','earlyGraceMinutes','openSpanWarningMinutes','completedBreakMinimumMinutes']", 'jsonb_object_keys(p))<>4',
    "v->>'mode' in('inherit','disabled')", 'if n<>1', "v->>'mode'='value'", 'n<>2', 'then 0 else 1 end', "then 44640 else 1440 end", "'^(0|[1-9][0-9]{0,4})$'"]) assert(helper.includes(part), part);
});

test('current ownership, serialized settings, target and exact receipt checks precede new write eligibility', () => {
  ordered('perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share', 'if p_command is null then select * into s',
    'else select * into s', 'select * into g', 'select * into existing',
    "existing.stream_key<>key or existing.actor_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied'",
    "existing.command is distinct from p_command then raise exception 'attendance_operation_conflict'",
    'receipt:=public.faolla_attendance_rule_receipt_v1(existing)', 'if p_command is not null and receipt is null then',
    'if not p_allow_write', "(p_command->>'expectedRevision')::bigint<>current_rev", "if action_name in('save_draft','publish') then",
    "if gid is not null and not g.active then raise exception 'attendance_rule_group_inactive'");
  assert(clean.includes('primary key(merchant_id,operation_id)'));
});

test('publication uses saved context, earliest actual local-day lower bound and post-lock clock; withdraw cannot rewrite draft', () => {
  const day = clean.slice(clean.indexOf('create or replace function public.faolla_attendance_rule_day_start_v1'), clean.indexOf('create or replace function public.faolla_attendance_rule_command_v1'));
  for (const part of ['-129600000;hi:=lo+259200000', 'while lo<hi loop', 'middle:=lo+(hi-lo)/2', '(instant at time zone z)::date<d', '(instant at time zone z)::date<>d then return null']) assert(day.includes(part));
  ordered('else select * into s', 'select * into saved', 'saved.settings_version<>s.version', 'pub.effective_at>=boundary',
    'wd.published_revision=pub.revision', 'stamp:=clock_timestamp()', "(p_command->>'effectiveOn')::date<=today or boundary<=stamp", 'stamp>=target.effective_at', 'insert into public.merchant_attendance_rule_streams');
  assert(body.includes('entry.rules:=saved.rules'));
  assert(body.includes('entry.published_revision:=target.revision;entry.draft_revision_after:=stream.draft_revision'));
  assert.doesNotMatch(body, /\bnow\(\)|transaction_timestamp\(/);
});

test('head/draft/source/withdraw target are receipt-linked; immutable operations reject update delete and truncate', () => {
  for (const part of ['attendance_rule_head_receipt_fk', 'attendance_rule_draft_receipt_fk', 'unique(merchant_id,stream_key,revision,action)',
    'foreign key(merchant_id,stream_key,source_draft_revision,draft_action)', 'foreign key(merchant_id,stream_key,published_revision,published_action)',
    'foreign key(merchant_id,stream_key,draft_revision_after,draft_action)', 'deferrable initially deferred',
    'before update or delete on public.merchant_attendance_rule_operations', 'before truncate on public.merchant_attendance_rule_operations',
    'create unique index if not exists attendance_rule_withdrawals_idx']) assert(clean.includes(part), part);
  const helpers = clean.slice(clean.indexOf('create or replace function public.faolla_attendance_rule_receipt_v1'), clean.indexOf('create or replace function public.faolla_attendance_rules_v1('));
  assert.doesNotMatch(helpers, /language plpgsql stable/, 'validation sees writes from this transaction');
  for (const part of ['p.snapshot is distinct from expected', 'previous.draft_revision_after is distinct from source.revision',
    'p.draft_revision_after is distinct from previous.draft_revision_after', 'last_op.draft_revision_after is distinct from p.draft_revision',
    "source.command->'expectedSettingsVersion' is distinct from to_jsonb(source.settings_version)"]) assert(helpers.includes(part));
});

test('immutable receipt excludes derived withdrawal marker, while bounded history includes it and the original actor', () => {
  const item = clean.slice(clean.indexOf('create or replace function public.faolla_attendance_rule_item_v1'), clean.indexOf('create or replace function public.faolla_attendance_rule_receipt_v1'));
  assert(item.includes("'actorId',p.actor_auth_user_id"));
  assert(item.includes('SS.US"Z"')); assert(item.includes('SS.MS"Z"'));
  assert(!item.includes('withdrawnByRevision'));
  assert(body.includes('order by revision desc limit 26')); assert(body.includes('exit when count_seen=26'));
  assert(body.includes("entry.snapshot||jsonb_build_object('withdrawnByRevision',withdrawn_by)"));
  assert(body.includes('case when count_seen=26 then next_before else null end'));
  assert(body.includes('octet_length(result::text)>131072'));
});

test('both tables and all helpers remain private; service role receives only the reauthorizing RPC', () => {
  assert.equal((clean.match(/enable row level security/g) || []).length, 2);
  assert.equal((clean.match(/grant execute/g) || []).length, 1);
  assert(clean.includes('grant execute on function public.faolla_attendance_rules_v1(jsonb,uuid,jsonb,boolean) to service_role'));
  assert(clean.includes("execute format('revoke all on function %s from public,anon,authenticated,service_role',p)"));
  assert(clean.includes("pg_has_role(r,c.relowner,'USAGE')"));
  assert(clean.includes("aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))"));
  assert(clean.includes("case when a.grantee=0 then true else pg_has_role(r,a.grantee,'USAGE') end"));
  assert(clean.includes("notify pgrst, 'reload schema'"));
});
