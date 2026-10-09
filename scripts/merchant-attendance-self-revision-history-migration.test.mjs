// Source contracts only; the separate native runner verifies real PostgreSQL.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=name=>readFileSync(new URL(`./supabase-migrations/${name}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const sql=read('202610030116_merchant_attendance_self_revision_history.sql');
const old=read('202610010097_merchant_attendance_revision_history.sql');
const name='faolla_attendance_self_revision_history_v1',signature=`public.${name}(text,uuid,jsonb)`;
const strip=s=>s.replace(/--[^\n]*/g,'');
const compact=s=>strip(s).replace(/\s+/g,' ').trim();
const definition=sql.match(/create or replace function[\s\S]*?\n\$\$;/)?.[0];assert(definition);
const body=strip(definition),outside=strip(sql.replace(definition,''));
const ordered=(source,...parts)=>{let at=-1;for(const part of parts){const next=source.indexOf(part,at+1);assert(next>at,`missing/out-of-order: ${part}`);at=next;}};

test('116 adds one function/index with exact095/097 prerequisites and no old function or data mutations',()=>{
  assert.match(strip(sql),/^\s*begin;\nset local lock_timeout='3s';/);
  for(const table of ['faolla_schema_migrations','merchants','merchant_attendance_settings','merchant_enterprise_employees',
    'merchant_enterprise_roles','merchant_attendance_workers','merchant_attendance_revision_requests','merchant_attendance_revision_decisions',
    'merchant_attendance_correction_effects','merchant_attendance_correction_entries'])assert(sql.includes(`to_regclass('public.${table}') is null`));
  assert.match(sql,/version=202610010095 and name='merchant_attendance_revision_cycles'/);
  assert.match(sql,/version=202610010097 and name='merchant_attendance_revision_history'/);
  assert.equal((outside.match(/create index/g)||[]).length,1);
  assert.equal((strip(sql).match(/create or replace function/g)||[]).length,1);
  assert.doesNotMatch(body,/\b(?:insert|update|delete|truncate|execute|call|merge)\b/i);
  assert.doesNotMatch(strip(sql),/\b(?:create table|alter table|create trigger|drop|owner to|disable trigger)\b/i);
  assert.deepEqual([...outside.matchAll(/insert into ([\w.]+)/g)].map(m=>m[1]),['public.faolla_schema_migrations']);
});

test('query is five exact typed fields with canonical microseconds and pinned paired cursor',()=>{
  const input=body.slice(0,body.indexOf('  perform 1 from public.merchants'));
  assert.match(input,/jsonb_object_keys\(p_query\)\)<>5/);
  assert.match(input,/array\['expectedWorkerId','status','asOf','cursorAt','cursorId'\]/);
  for(const key of ['expectedWorkerId','status','cursorId'])assert(input.includes(`jsonb_typeof(p_query->'${key}')<>'string'`));
  assert.match(input,/not in \('all','submitted','approved','rejected','withdrawn'\)/);
  assert.match(input,/\(p_query->'cursorAt'='null'::jsonb\)<>\(p_query->'cursorId'='null'::jsonb\)/);
  assert.match(input,/foreach k in array array\['asOf','cursorAt'\]/);
  assert(input.includes('[0-9]{6}Z$'));
  assert.match(input,/to_char\(v_instant at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'\)<>p_query->>k/);
  assert.match(input,/p_query->'cursorId'<>'null'::jsonb and p_query->'asOf'='null'::jsonb/);
  assert.match(body,/if v_asof>v_now then raise exception 'attendance_invalid_request'/);
  assert.match(body,/if v_cursor_at>v_asof then raise exception 'attendance_invalid_request'/);
});

test('every page rechecks current active employee and valid self-view role in original SHARE lock order',()=>{
  ordered(body,'perform 1 from public.merchants where id=p_site_id for share;',
    'perform 1 from public.merchant_attendance_settings where merchant_id=p_site_id for share;',
    'select * into emp','auth_user_id=p_auth_user_id for share;',"emp.status<>'active'",
    'select * into role_row',"role_row.status<>'active'",'faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions)',
    "'attendance.self.view'=any(role_row.permissions)",'select * into worker','employee_id=emp.id for share;',
    "if worker.id<>v_worker then raise exception 'attendance_worker_changed'",'v_now:=clock_timestamp();');
  assert.doesNotMatch(body,/worker\.active|self\.clock|self\.request|employment_period|web_clock_enabled|platform_enabled|settings.*enabled|user_id=p_auth_user_id.*merchants/);
});

test('identity index and pre-limit identity filter bound candidates to one currently bound subject',()=>{
  assert.match(outside,/create index if not exists attendance_revision_self_identity_history_idx\s+on public\.merchant_attendance_revision_requests\s+\(merchant_id,worker_id,employee_id,actor_auth_user_id,recorded_at desc,request_id desc\)\s+where action='submit'/);
  const scan=body.slice(body.indexOf('for r in select'),body.indexOf('v_count:=v_count+1'));
  assert.match(scan,/merchant_id=p_site_id and worker_id=worker.id and employee_id=emp.id and actor_auth_user_id=p_auth_user_id/);
  assert.match(scan,/action='submit' and recorded_at<=v_asof/);
  assert.match(scan,/\(recorded_at,request_id\)<\(v_cursor_at,v_cursor\)/);
  assert.match(scan,/order by recorded_at desc,request_id desc limit 51 loop/);
  assert.doesNotMatch(scan,/v_status|\boffset\b|base_request_id=/);
  assert.match(outside,/i\.indisvalid and i\.indisready/);
  assert.match(outside,/i\.indoption::text='0 0 0 0 3 3'/);
  assert.match(outside,/self_revision_history_index_postcondition_failed/);
});

test('each scanned root requires effect ownership and the original submit worker/employee/auth identity before disclosure',()=>{
  ordered(body,'v_count:=v_count+1;exit when v_count=51;','v_next:=jsonb_build_object(',
    'select * into base','request_id=r.base_request_id and worker_id=worker.id;',
    'if not found then continue;end if;','select * into original',"operation_id=base.request_id and action='submit';",
    'original.worker_id is distinct from worker.id','original.employee_id is distinct from emp.id',
    'original.actor_auth_user_id is distinct from p_auth_user_id','continue;','select * into tail');
  assert.doesNotMatch(body,/attendance_revision_base_not_found/);
});

test('terminal validation and thirteen safe item fields retain097 semantics with null-safe identities',()=>{
  const terminal=s=>s.slice(s.indexOf('if tail.revision is null'),s.indexOf("    v_state:=case"));
  const normalize=s=>compact(s).replaceAll(' is distinct from ','<>').replace(/;\s*/g,';');
  assert.equal(normalize(terminal(body)),normalize(terminal(old)));
  const item=s=>s.match(/v_items:=v_items\|\|jsonb_build_array\([\s\S]*?decisionOperationId',d\.operation_id\)\);/)?.[0];
  assert.equal(compact(item(body)),compact(item(old)));
  const output=body.slice(body.indexOf('result:=jsonb_build_object'));
  assert.deepEqual([...output.matchAll(/'([A-Za-z][A-Za-z0-9]*)',/g)].map(m=>m[1]).filter(s=>s!=='UTC'),
    ['protocol','readOnly','siteId','employeeId','workerId','asOf','items','scanned','nextCursor']);
  assert.doesNotMatch(output,/actor_auth|email|to_jsonb|row_to_json|rootRequestId|command/);
  assert.match(output,/octet_length\(result::text\)>131072/);
});

test('status filtering happens after bounded candidate/root/terminal validation and advances even empty pages',()=>{
  ordered(body,'v_count:=v_count+1;exit when v_count=51;', 'v_next:=', 'select * into base', 'select * into tail',
    "raise exception 'attendance_revision_history_invalid'",'v_state:=',"if v_status<>'all' and v_state<>v_status then continue;end if;",'v_items:=');
  assert.match(body,/'scanned',least\(v_count,50\)/);
  assert.match(body,/'nextCursor',case when v_count=51 then v_next else 'null'::jsonb end/);
  assert.doesNotMatch(body,/jsonb_array_length\(v_items\).*limit|while|offset/i);
});

test('only the new service RPC is executable; replaying migration preserves owner, ACL and exact registry',()=>{
  assert.match(body,/security definer set search_path=pg_catalog/);
  assert(outside.includes(`revoke all on function ${signature} from public,anon,authenticated,service_role;`));
  assert(outside.includes(`grant execute on function ${signature} to service_role;`));
  assert.equal((outside.match(/grant execute/g)||[]).length,1);
  assert.doesNotMatch(outside,/grant (select|all|insert|update|delete)|alter function|owner to|create policy/i);
  assert.match(outside,/values\(202610030116,'merchant_attendance_self_revision_history'\) on conflict\(version\) do nothing/);
  for(const role of ['service_role','anon','authenticated'])assert(outside.includes(`has_function_privilege('${role}','${signature}','EXECUTE')`));
  ordered(outside,'on conflict(version) do nothing;','do $self_revision_history_postconditions$',"notify pgrst, 'reload schema';",'commit;');
});
