// Source contracts, not a claim that PostgreSQL has executed the migration.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const sql=readFileSync(new URL('./supabase-migrations/202610030117_merchant_attendance_owner_backlog.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
const strip=s=>s.replace(/--[^\n]*/g,'');
const fn=sql.match(/create or replace function[\s\S]*?\n\$\$;/)?.[0];assert(fn);
const body=strip(fn),outside=strip(sql.replace(fn,''));
const signature='public.faolla_attendance_owner_backlog_v1(text,uuid,jsonb)';
const ordered=(source,...pieces)=>{let at=-1;for(const piece of pieces){const next=source.indexOf(piece,at+1);assert(next>at,`missing or out of order: ${piece}`);at=next;}};

test('117 is one additive read-only function, preserving old writers/tables/indexes and exact prerequisites',()=>{
  assert.match(outside,/begin;\nset local lock_timeout='3s';/);
  assert.equal((strip(sql).match(/create or replace function/g)||[]).length,1);
  assert.doesNotMatch(body,/\b(insert|update|delete|truncate|execute|call|merge)\b/i);
  assert.doesNotMatch(strip(sql),/\b(create table|create index|alter table|create trigger|drop|owner to|disable trigger)\b/i);
  assert.deepEqual([...outside.matchAll(/insert into ([\w.]+)/g)].map(m=>m[1]),['public.faolla_schema_migrations']);
  for(const version of ['202609300086','202610010097','202610010103'])assert(outside.includes(`version=${version}`));
  for(const table of ['merchants','merchant_attendance_settings','merchant_attendance_workers','merchant_attendance_correction_entries',
    'merchant_attendance_correction_decisions','merchant_attendance_correction_effects','merchant_attendance_revision_requests',
    'merchant_attendance_revision_decisions','merchant_attendance_missing_requests','merchant_attendance_missing_entries'])
    assert(outside.includes(`to_regclass('public.${table}') is null`));
});

test('query has five exact typed keys, complete triplet cursor and canonical microsecond asOf fence',()=>{
  const input=body.slice(0,body.indexOf('perform 1 from public.merchants'));
  assert.match(input,/jsonb_object_keys\(p_query\)\)<>5/);
  assert(input.includes("array['kind','asOf','cursorAt','cursorKind','cursorId']"));
  for(const key of ['kind','cursorKind','cursorId'])assert(input.includes(`jsonb_typeof(p_query->'${key}')<>'string'`));
  assert(input.includes("(p_query->'cursorAt'='null'::jsonb)<>(p_query->'cursorKind'='null'::jsonb)"));
  assert(input.includes("(p_query->'cursorAt'='null'::jsonb)<>(p_query->'cursorId'='null'::jsonb)"));
  assert(input.includes("foreach k in array array['asOf','cursorAt']"));assert(input.includes('[0-9]{6}Z$'));
  assert(input.includes("v_kind<>'all' and v_cursor_kind<>v_kind"));
  assert.match(body,/if v_asof>v_now then raise exception 'attendance_invalid_request'/);
  assert.match(body,/if v_cursor_at>v_asof then raise exception 'attendance_invalid_request'/);
});

test('every page authenticates the current merchant owner with the existing settings SHARE fence',()=>{
  ordered(body,'perform 1 from public.merchants where id=p_site_id and user_id=p_auth_user_id for share;',
    "raise exception 'attendance_access_denied'",'perform 1 from public.merchant_attendance_settings where merchant_id=p_site_id for share;',
    "raise exception 'attendance_settings_required'",'v_now:=clock_timestamp();','for candidate in select');
  assert.doesNotMatch(body,/worker\.active|employee\.status|self\.clock|self\.view|self\.request|web_clock_enabled|platform_enabled|p_allow_write|employment_period/);
});

test('three indexed51 candidate probes merge to51 before terminal filtering and advance by the last scanned triple',()=>{
  const scan=body.slice(body.indexOf('for candidate in select'),body.indexOf('v_count:=v_count+1'));
  assert.equal((scan.match(/limit 51/g)||[]).length,4);
  assert.equal((scan.match(/union all/g)||[]).length,2);
  assert.equal((scan.match(/merchant_id=p_site_id/g)||[]).length,3);
  assert.equal((scan.match(/action='submit'/g)||[]).length,2);
  assert.match(scan,/order by recorded_at asc,kind_rank asc,request_id asc limit 51 loop/);
  assert.doesNotMatch(scan,/not exists|decision|entries.*revision=2|pending|offset/i);
  for(const rank of [1,2,3])assert(scan.includes(`${rank},request_id)>(v_cursor_at,v_cursor_rank,v_cursor)`));
  ordered(body,'v_count:=v_count+1;exit when v_count=51;','v_next:=jsonb_build_object(',"if candidate.kind='correction'",'if not pending then continue;end if;','v_items:=');
  assert.match(body,/'scanned',least\(v_count,50\)/);
  assert.match(body,/'nextCursor',case when v_count=51 then v_next else 'null'::jsonb end/);
});

test('correction and revision terminals validate immutable historical identities rather than current employee binding',()=>{
  for(const pair of ['ct.worker_id is distinct from c.worker_id','ct.employee_id is distinct from c.employee_id',
    'ct.actor_auth_user_id is distinct from c.actor_auth_user_id','ct.start_event_id is distinct from c.start_event_id',
    'original.worker_id is distinct from v.worker_id','original.employee_id is distinct from v.employee_id',
    'original.actor_auth_user_id is distinct from v.actor_auth_user_id','vt.base_request_id is distinct from v.base_request_id',
    'vt.employee_id is distinct from v.employee_id','vt.actor_auth_user_id is distinct from v.actor_auth_user_id',
    'vd.worker_id is distinct from v.worker_id','vd.base_request_id is distinct from v.base_request_id'])assert(body.includes(pair));
  assert(body.includes('cd.request_revision<>c.revision or cd.recorded_at<=c.recorded_at'));
  assert(body.includes('vd.request_revision<>v.revision or vd.recorded_at<=v.recorded_at'));
  assert(body.includes("pending:=ct.action='submit' and cd.operation_id is null"));
  assert(body.includes("pending:=vt.action='submit' and vd.operation_id is null"));
  assert.doesNotMatch(body,/effect_current|current_effect|actor_auth_user_id=p_auth_user_id/);
});

test('missing requests include revisions and require exact original submit receipt, with terminal cut off by asOf',()=>{
  const missing=body.slice(body.indexOf('select * into m from'),body.indexOf('select * into worker from'));
  assert.match(missing,/revision=1;/);
  assert.match(missing,/revision=2 and recorded_at<=v_asof;/);
  assert(missing.includes('ms.operation_id is distinct from m.request_id'));
  assert(missing.includes("ms.action is distinct from 'submit'"));
  assert(missing.includes('ms.actor_auth_user_id is distinct from m.actor_auth_user_id'));
  assert(missing.includes('ms.recorded_at is distinct from m.submitted_at'));
  assert(missing.includes("mt.action='withdraw' and mt.actor_auth_user_id is distinct from m.actor_auth_user_id"));
  assert(missing.includes('pending:=mt.operation_id is null'));
  assert.doesNotMatch(missing,/root_request_id is null|supersedes_request_id is null|missing_current/);
});

test('only nine safe item fields and eight envelope fields are returned with a128KiB cap',()=>{
  const item=body.slice(body.indexOf('v_items:=v_items||'),body.indexOf('\n  end loop;',body.indexOf('v_items:=v_items||')));
  assert.deepEqual([...item.matchAll(/'([A-Za-z][A-Za-z0-9]*)',/g)].map(m=>m[1]).filter(k=>k!=='UTC'),
    ['kind','requestId','workerId','workerName','workerNo','submittedAt','proposedStartAt','proposedEndAt','status']);
  const envelope=body.slice(body.indexOf('result:=jsonb_build_object'));
  assert.deepEqual([...envelope.matchAll(/'([A-Za-z][A-Za-z0-9]*)',/g)].map(m=>m[1]).filter(k=>k!=='UTC'),
    ['protocol','readOnly','siteId','ownerId','asOf','items','scanned','nextCursor']);
  assert.doesNotMatch(item+envelope,/to_jsonb|row_to_json|reason|command|email|actor_auth|evidenceToken|operationId|canApprove|count\(/);
  assert.match(envelope,/octet_length\(result::text\)>131072/);
  assert.match(body,/raise exception 'attendance_owner_backlog_invalid'/);
});

test('service-only execute, idempotent exact registry and preserved function owner are checked',()=>{
  assert.match(body,/security definer set search_path=pg_catalog/);
  assert(outside.includes(`revoke all on function ${signature} from public,anon,authenticated,service_role;`));
  assert(outside.includes(`grant execute on function ${signature} to service_role;`));
  assert.equal((outside.match(/grant execute/g)||[]).length,1);
  assert.doesNotMatch(outside,/grant (select|all|insert|update|delete)|alter function|owner to|create policy/i);
  assert(outside.includes("values(202610030117,'merchant_attendance_owner_backlog') on conflict(version) do nothing"));
  for(const role of ['service_role','anon','authenticated'])assert(outside.includes(`has_function_privilege('${role}','${signature}','EXECUTE')`));
  ordered(outside,'on conflict(version) do nothing;','do $owner_backlog_postconditions$',"notify pgrst, 'reload schema';",'commit;');
});
