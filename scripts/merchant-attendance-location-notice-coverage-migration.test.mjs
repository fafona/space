// SQL source contracts only. No PostgreSQL, network or fixture mutations occur
// here; the separate owned-sandbox runner verifies actual SQL behavior and ACLs.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=name=>readFileSync(new URL('./supabase-migrations/'+name,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const sql=read('202610030115_merchant_attendance_location_notice_coverage.sql');
const original=read('202609300076_merchant_attendance_location_notices.sql');
const name='faolla_attendance_location_notice_coverage_v1',signature=`public.${name}(text,uuid,jsonb)`;
const strip=value=>value.replace(/--[^\n]*/g,'');
const compact=value=>strip(value).replace(/\s+/g,' ').trim();
const definition=sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`))?.[0];
assert(definition,'complete coverage function required');
const body=strip(definition),outside=strip(sql.replace(definition,''));
const ordered=(value,...parts)=>{
  let previous=-1;for(const part of parts){const at=value.indexOf(part,previous+1);assert(at>previous,`missing/out-of-order SQL fragment: ${part}`);previous=at;}
};
const candidates=body.match(/with candidates as materialized \(([\s\S]*?)\n  \), totals as \(/)?.[1];
const totals=body.match(/\), totals as \(([\s\S]*?)\n  \), page_window as materialized \(/)?.[1];
assert(candidates&&totals,'one shared materialized candidate set required');
const output=body.slice(body.indexOf("  select jsonb_build_object(\n    'siteId'"),body.indexOf('  return result;'));

test('115 is an additive bounded-lock migration requiring original076 tables, permission predicate and exact ledger',()=>{
  const pre=sql.slice(0,sql.indexOf(definition));
  assert.match(strip(pre),/^\s*begin;\nset local lock_timeout='3s';/);
  for(const table of ['faolla_schema_migrations','merchants','merchant_attendance_settings','merchant_attendance_locations',
    'merchant_attendance_workers','merchant_enterprise_employees','merchant_enterprise_roles',
    'merchant_attendance_location_notices','merchant_attendance_location_notice_acknowledgements'])
    assert(pre.includes(`to_regclass('public.${table}') is null`));
  assert(pre.includes("to_regprocedure('public.faolla_valid_merchant_enterprise_permissions_v1(text[])') is null"));
  assert.match(pre,/where version=202609300076 and name='merchant_attendance_location_notices'/);
  assert.equal((strip(sql).match(/create or replace function/g)??[]).length,1);
  assert.match(body,/p_site_id text,p_auth_user_id uuid,p_query jsonb\n\) returns jsonb language plpgsql security definer set search_path=pg_catalog/);
  assert.doesNotMatch(strip(sql),/\b(?:create table|create index|create trigger|create role|alter table|alter role|owner to|drop|truncate|delete from|update public\.|merge)\b/i);
  assert.doesNotMatch(body,/\b(?:insert into|update|delete|truncate|merge|execute|call)\b/i);
  assert.deepEqual([...outside.matchAll(/insert into ([\w.]+)/g)].map(match=>match[1]),['public.faolla_schema_migrations']);
});

test('request has exactly five fields, valid UUIDs, and all-null or all-integer fences without cursor-only reads',()=>{
  const prefix=body.slice(body.indexOf('begin\n'),body.indexOf('  select * into m'));
  assert.match(prefix,/p_site_id is null or p_site_id !~ '\^\\d\{8\}\$' or p_auth_user_id is null/);
  assert.match(prefix,/p_query is null or jsonb_typeof\(p_query\)<>'object'/);
  assert.match(prefix,/jsonb_object_keys\(p_query\)\)<>5/);
  assert.match(prefix,/array\['locationId','expectedNoticeRevision','expectedSettingsVersion','expectedLocationVersion','cursorWorkerId'\]/);
  assert.match(prefix,/jsonb_typeof\(p_query->'locationId'\)<>'string'/);
  assert.match(prefix,/jsonb_typeof\(p_query->'cursorWorkerId'\)<>'string'/);
  assert.match(prefix,/fenced:=p_query->'expectedNoticeRevision'<>'null'::jsonb;/);
  assert.match(prefix,/if not fenced then\s+if p_query->'expectedSettingsVersion'<>'null'::jsonb\s+or p_query->'expectedLocationVersion'<>'null'::jsonb\s+or p_query->'cursorWorkerId'<>'null'::jsonb then/);
  assert.match(prefix,/foreach k in array array\['expectedNoticeRevision','expectedSettingsVersion','expectedLocationVersion'\]/);
  assert.match(prefix,/jsonb_typeof\(p_query->k\)<>'number'/);
  assert.match(prefix,/!~ '\^\(0\|\[1-9\]\[0-9\]\{0,15\}\)\$'/);
  assert.match(prefix,/case when k='expectedNoticeRevision' then 9007199254740990 else 9007199254740991 end/);
  assert.match(prefix,/k<>'expectedNoticeRevision' and \(p_query->>k\)::numeric=0/);
  assert.match(prefix,/cursor_worker:=\(p_query->>'cursorWorkerId'\)::uuid;/);
  assert.doesNotMatch(prefix,/coalesce\(p_query->>'expected|p_command|p_allow|access|auth_user_id.*p_query/);
});

test('seven owner aliases authorize before location/roster disclosure and preserve the existing notice writer lock order',()=>{
  const aliases=value=>value.match(/array\[\s*(m\.user_id,m\.auth_user_id,m\.owner_user_id,m\.owner_id,m\.auth_id,m\.created_by,m\.created_by_user_id)\]/)?.[1];
  assert(aliases(body));assert.equal(aliases(body),aliases(original));
  ordered(body,'select * into m from public.merchants where id=p_site_id for share;',
    "raise exception 'attendance_access_denied';",'select * into s from public.merchant_attendance_settings where merchant_id=p_site_id for share;',
    "raise exception 'attendance_settings_required';",'select * into l from public.merchant_attendance_locations where merchant_id=p_site_id and id=loc for share;',
    "raise exception 'attendance_location_denied';",'select * into n from public.merchant_attendance_location_notices','with candidates as materialized');
  assert.match(body,/if not found or not coalesce\(p_auth_user_id=any\(array\[/);
  assert.match(body,/m\.created_by_user_id\]\),false\) then/);
  assert.match(original,/if a='owner' and p_command is not null then select \* into s from public\.merchant_attendance_settings where merchant_id=p_site_id for update;/);
  assert.doesNotMatch(body,/attendance\.records\.view|merchant_attendance_scopes|p_access|access='manager'|p_auth_user_id=\s*e\./);
  const called=[...body.matchAll(/public\.(faolla_[a-z0-9_]+)\(/g)].map(match=>match[1]);
  assert.deepEqual(called,[name,'faolla_valid_merchant_enterprise_permissions_v1'],'no invocation of an existing write-capable RPC');
});

test('revision fences bind notice/settings/location but do not pretend to pin a historical roster or clock enablement',()=>{
  ordered(body,'where merchant_id=p_site_id and location_id=loc order by revision desc limit 1;',
    "if fenced and ((p_query->>'expectedNoticeRevision')::bigint<>coalesce(n.revision,0)",
    "or (p_query->>'expectedSettingsVersion')::bigint<>s.version",
    "or (p_query->>'expectedLocationVersion')::bigint<>l.version)",
    "raise exception 'attendance_version_conflict';",'notice_current:=', 'observed_at:=clock_timestamp();','with candidates as materialized');
  const noticeCurrent=body.match(/notice_current:=([\s\S]*?);/)?.[1];assert(noticeCurrent);
  const oldCurrent=original.match(/notice_current:=([\s\S]*?);/)?.[1];assert(oldCurrent);
  assert.equal(compact(noticeCurrent),compact(oldCurrent.replaceAll('latest.','n.')));
  assert.doesNotMatch(body,/s\.enabled|web_clock_enabled|location_clock_enabled|employment_period|attendance\.self\.clock|draft_revision|location_policy_drafts/);
  assert.doesNotMatch(body,/observed_at\s*[<>]=?|asOf|p_query.*observedAt/);
});

test('all currently assigned workers form the denominator; exclusion priority and self-view eligibility are exact',()=>{
  assert.match(candidates,/where w\.merchant_id=p_site_id and w\.default_location_id=loc\s*$/);
  assert.match(candidates,/left join public\.merchant_enterprise_employees e on e\.merchant_id=w\.merchant_id and e\.id=w\.employee_id/);
  assert.match(candidates,/left join public\.merchant_enterprise_roles r on r\.merchant_id=e\.merchant_id and r\.id=e\.role_id/);
  const eligibility=candidates.match(/case[\s\S]*?end as exclusion/)?.[0];assert(eligibility);
  assert.equal(compact(eligibility),compact(`case
    when not w.active then 'worker_inactive'
    when e.id is null or e.status<>'active' or e.auth_user_id is null then 'employee_unavailable'
    when r.id is null or r.status<>'active'
      or not coalesce(public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions),false)
      or not coalesce('attendance.self.view'=any(r.permissions),false) then 'role_unavailable'
    else null end as exclusion`));
  assert.doesNotMatch(candidates,/\binner join\b|w\.active\s+and|where e\.|where r\.|l\.active|notice_current|limit|cursor_worker/);
  assert.match(totals,/count\(\*\) as assigned,count\(\*\) filter\(where exclusion is null\) as eligible/);
  assert.match(totals,/count\(\*\) filter\(where exclusion is not null\) as excluded/);
});

test('ACK identity matches the latest published version and current account, while inactive rows may retain their exact historical ACK',()=>{
  const ack=candidates.slice(candidates.indexOf('left join public.merchant_attendance_location_notice_acknowledgements'),candidates.indexOf('\n    where w.'));
  assert.equal(compact(ack),compact(`left join public.merchant_attendance_location_notice_acknowledgements a
    on n.action='publish' and a.merchant_id=p_site_id and a.location_id=loc and a.notice_revision=n.revision
    and a.worker_id=w.id and a.employee_id=e.id and a.actor_auth_user_id=e.auth_user_id
    and a.recorded_at>=n.recorded_at`));
  assert.match(candidates,/a\.recorded_at as acknowledged_at/);assert.doesNotMatch(ack,/exclusion|w\.active|e\.status|r\.status|notice_current|\bor\b/);
  assert.match(totals,/case when n\.action='publish' then count\(\*\) filter\(where exclusion is null and acknowledged_at is not null\) else null end as confirmed/);
  assert.match(totals,/case when n\.action='publish' then count\(\*\) filter\(where exclusion is null and acknowledged_at is null\) else null end as pending/);
  assert.doesNotMatch(totals,/notice_current|coalesce|cursor_worker|page_window|page_rows/);
  assert.match(output,/'acknowledgedAt',case when acknowledged_at is null then null else to_char\(acknowledged_at/);
});

test('one materialized candidate statement supplies exact totals and a bounded UUID50+1 page with the last visible cursor',()=>{
  assert.equal((body.match(/with candidates as materialized/g)??[]).length,1);
  assert.equal((body.match(/from public\.merchant_attendance_workers/g)??[]).length,1);
  assert.match(totals,/from candidates\s*$/);
  assert.match(body,/page_window as materialized \(\s+select \* from candidates where cursor_worker is null or worker_id>cursor_worker order by worker_id limit 51\s+\)/);
  assert.match(body,/page_rows as materialized \(\s+select \* from page_window order by worker_id limit 50\s+\)/);
  assert.match(output,/order by worker_id\),'\[\]'::jsonb\) from page_rows/);
  assert.match(output,/'nextCursor',case when \(select count\(\*\) from page_window\)>50\s+then \(select worker_id from page_rows order by worker_id desc limit 1\) else null end/);
  assert.match(output,/\) into result from totals;\s*$/);
  assert.doesNotMatch(body,/\boffset\b|order by (?:display_name|worker_no)|limit\s+(?:100|200|500)/i);
});

test('response is a fixed safe projection without auth IDs, email, coordinates, tokens, operation identifiers or whole-row JSON',()=>{
  const keys=[...output.matchAll(/'([A-Za-z][A-Za-z0-9]*)',/g)].map(match=>match[1]).filter(key=>key!=='UTC');
  assert.deepEqual(keys,['siteId','location','id','name','active','version','settingsVersion','notice','revision','action','recordedAt',
    'noticeCurrent','observedAt','counts','assigned','eligible','excluded','confirmed','pending','items','workerId','workerNo',
    'displayName','employeeId','eligible','exclusion','acknowledgedAt','nextCursor']);
  assert.doesNotMatch(output,/auth_user_id|actor_auth|email|latitude|longitude|token|operation_id|operationId|command|to_jsonb|row_to_json|\bselect \*/);
  assert.match(output,/'notice',case when n\.revision is null then null else jsonb_build_object/);
  assert.equal((output.match(/HH24:MI:SS\.US/g)??[]).length,3,'notice/observation/ACK timestamps preserve PostgreSQL microseconds');
  const errors=[...body.matchAll(/raise exception '([a-z_]+)'/g)].map(match=>match[1]);
  assert.deepEqual(new Set(errors),new Set(['attendance_invalid_request','attendance_access_denied','attendance_settings_required','attendance_location_denied','attendance_version_conflict']));
  assert.doesNotMatch(body,/exception when others|exception when raise_exception/);
});

test('only this service RPC and idempotent115 ledger are installed, preserving original function owners and all table privileges',()=>{
  assert.deepEqual([...outside.matchAll(/revoke all on function ([\s\S]*?);/g)].map(match=>compact(match[1])),[`${signature} from public,anon,authenticated,service_role`]);
  assert.deepEqual([...outside.matchAll(/grant execute on function ([\s\S]*?);/g)].map(match=>compact(match[1])),[`${signature} to service_role`]);
  assert.doesNotMatch(outside,/grant (?:select|insert|update|delete|all)|alter function|owner to|revoke all on table|create policy/i);
  assert.match(outside,/values\(202610030115,'merchant_attendance_location_notice_coverage'\) on conflict\(version\) do nothing/);
  assert.match(outside,/where version=202610030115 and name='merchant_attendance_location_notice_coverage'/);
  for(const role of ['service_role','anon','authenticated'])assert(outside.includes(`has_function_privilege('${role}','${signature}','EXECUTE')`));
  assert.match(outside,/raise exception 'merchant_attendance_notice_coverage_registry_postcondition_failed'/);
  assert.match(outside,/raise exception 'merchant_attendance_notice_coverage_acl_postcondition_failed'/);
  ordered(outside,'on conflict(version) do nothing;','do $notice_coverage_postconditions$',"notify pgrst, 'reload schema';",'commit;');
  assert.match(outside,/commit;\s*$/);
});
