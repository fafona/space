import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration=read('scripts/supabase-migrations/202610010091_merchant_attendance_revision_requests.sql');
test('revision ledger is additive, service-only and immutable; no existing approval or report is replaced',()=>{
  assert.match(migration,/create table public\.merchant_attendance_revision_requests/);
  assert.match(migration,/enable row level security/);
  assert.match(migration,/revoke all on public\.merchant_attendance_revision_requests from public,anon,authenticated,service_role/);
  assert.match(migration,/before update or delete/);assert.match(migration,/before truncate/);
  assert(!/create or replace|drop (?:function|table)|(?:update|delete from) public\./i.test(migration));
  assert.deepEqual([...migration.matchAll(/insert into public\.(\w+)/g)].map(m=>m[1]),['merchant_attendance_revision_requests','faolla_schema_migrations']);
  assert.deepEqual([...migration.matchAll(/create function public\.(\w+)/g)].map(m=>m[1]),['faolla_attendance_revision_rules_v1','faolla_attendance_revision_self_v1']);
  assert.match(migration,/'approvalAvailable',false,'effectiveChanged',false/);
});
test('new requests check original, approved and proposed periods under one settings lock and keep original date deadline',()=>{
  assert.match(migration,/anchor:=\(original_start at time zone/);
  assert.match(migration,/start_at<original_end and end_at>original_start/);
  for(const v of ['p_base','p_proposal'])assert(migration.includes(`start_at<(${v}->>'endAt')::timestamptz and end_at>(${v}->>'startAt')::timestamptz`));
  assert.match(migration,/where merchant_id=p_site_id for update/);
  assert.match(migration,/basis->'events' is distinct from original\.basis->'events'/);
  assert.match(migration,/rules->'policy'->>'revision'<>p_command->>'expectedPolicyRevision'/);
  assert.match(migration,/base\.operation_id::text<>p_command->>'expectedBaseOperationId'/);
});
test('receipt recovery precedes paused permission gate, binds original actor and does not duplicate basis snapshots',()=>{
  assert(migration.indexOf('if receipt.command<>p_command')<migration.indexOf('if not can_request'));
  assert.match(migration,/original\.actor_auth_user_id is distinct from p_auth_user_id/);
  assert.match(migration,/head\.actor_auth_user_id<>p_auth_user_id/);
  for(const table of ['entries','decisions'])assert(migration.includes(`exists(select 1 from public.merchant_attendance_correction_${table} where merchant_id=p_site_id and operation_id=op)`));
  const table=migration.slice(migration.indexOf('create table '),migration.indexOf('create unique index'));
  assert.match(table,/command jsonb/);assert(!/basis jsonb|result jsonb|snapshot jsonb/.test(table));
  assert.match(migration,/octet_length\(result::text\)>196608/);
});
test('dedicated revision endpoint remains default off and does not expose an approval command',()=>{
  const route=read('src/app/api/merchant-enterprise/attendance/revision-requests/route-handler.ts');
  for(const flag of ['REVISION_REQUESTS','CORRECTIONS','SELF'])assert(route.includes(`process.env.FAOLLA_ATTENDANCE_${flag}_ENABLED==="1"`));
  assert.match(route,/requireMerchantEnterprisePasswordAuthentication\(context\)/);assert.match(route,/await deps\.entitlement\(query\.siteId\)/);
  const protocol=read('src/lib/merchantAttendanceRevision.ts');
  assert.match(protocol,/approvalAvailable:false;effectiveChanged:false/);
  assert.match(protocol,/c\.action!=="submit"&&c\.action!=="withdraw"/);
  assert(!/setInterval|localStorage|sessionStorage/.test(route+protocol));
});
