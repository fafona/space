// Source contracts only; actual PostgreSQL acceptance has a separate owned runner.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const sql=readFileSync(new URL('./supabase-migrations/202610030118_merchant_attendance_self_requests.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
const strip=s=>s.replace(/--[^\n]*/g,'');
const fn=sql.match(/create or replace function[\s\S]*?\n\$\$;/)?.[0];assert(fn);
const body=strip(fn),outside=strip(sql.replace(fn,'')),signature='public.faolla_attendance_self_requests_v1(text,uuid,jsonb)';
const ordered=(source,...pieces)=>{let at=-1;for(const piece of pieces){const next=source.indexOf(piece,at+1);assert(next>at,`missing or out of order: ${piece}`);at=next;}};

test('118 is additive and read-only, adds only two identity indexes and preserves existing writers and data',()=>{
  assert.match(outside,/begin;\nset local lock_timeout='3s';/);
  assert.equal((strip(sql).match(/create or replace function/g)||[]).length,1);
  assert.doesNotMatch(body,/\b(insert|update|delete|truncate|execute|call|merge)\b/i);
  assert.doesNotMatch(strip(sql),/\b(create table|alter table|create trigger|drop|owner to|disable trigger)\b/i);
  assert.equal((outside.match(/create index if not exists/g)||[]).length,2);
  assert.equal((outside.match(/merchant_id,worker_id,employee_id,actor_auth_user_id/g)||[]).length,2);
  assert(outside.includes("where action='submit'"));
  assert(outside.includes("to_regclass('public.attendance_revision_self_identity_history_idx') is null"));
  assert.deepEqual([...outside.matchAll(/insert into ([\w.]+)/g)].map(m=>m[1]),['public.faolla_schema_migrations']);
  for(const version of ['202609300086','202610010103','202610030116'])assert(outside.includes(`version=${version}`));
  assert.match(sql,/concurrent-index rollout/);
});

test('query validates exactly eight keys, both identity pins, kind/status and canonical complete cursor triplet',()=>{
  const input=body.slice(0,body.indexOf('perform 1 from public.merchants'));
  assert.match(input,/jsonb_object_keys\(p_query\)\)<>8/);
  assert(input.includes("array['expectedEmployeeId','expectedWorkerId','kind','status','asOf','cursorAt','cursorKind','cursorId']"));
  assert(input.includes("foreach k in array array['expectedEmployeeId','expectedWorkerId']"));
  assert(input.includes("('all','submitted','approved','rejected','withdrawn')"));
  for(const key of ['cursorKind','cursorId'])assert(input.includes(`(p_query->'cursorAt'='null'::jsonb)<>(p_query->'${key}'='null'::jsonb)`));
  assert(input.includes("v_kind<>'all' and v_cursor_kind<>v_kind"));assert(input.includes('[0-9]{6}Z$'));
  assert.match(body,/if v_asof>v_now then raise exception 'attendance_invalid_request'/);
  assert.match(body,/if v_cursor_at>v_asof then raise exception 'attendance_invalid_request'/);
});

test('every page shares locks in established order and requires only active membership/role+self.view with both current pins',()=>{
  ordered(body,'perform 1 from public.merchants','perform 1 from public.merchant_attendance_settings','select * into emp','select * into role_row','select * into worker','v_now:=clock_timestamp();','for candidate in select');
  assert.equal((body.match(/for share;/g)||[]).length,5);
  assert(body.includes("emp.status<>'active' or emp.id<>(p_query->>'expectedEmployeeId')::uuid then raise exception 'attendance_access_denied'"));
  assert(body.includes("worker.id<>(p_query->>'expectedWorkerId')::uuid then raise exception 'attendance_worker_changed'"));
  assert(body.includes("not coalesce('attendance.self.view'=any(role_row.permissions),false)"));
  assert(body.includes('not coalesce(public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions),false)'));
  assert.doesNotMatch(body,/worker\.active|self\.clock|self\.request|web_clock_enabled|platform_enabled|p_allow_write|employment_period|\buser_id=p_auth_user_id for share/);
});

test('four identities filter before three51 probes, bounded merge scans50 and full DESC tuple advances before status filtering',()=>{
  const scan=body.slice(body.indexOf('for candidate in select'),body.indexOf('v_count:=v_count+1'));
  for(const predicate of ['merchant_id=p_site_id','worker_id=worker.id','employee_id=emp.id','actor_auth_user_id=p_auth_user_id'])assert.equal(scan.split(predicate).length-1,3);
  assert.equal((scan.match(/limit 51/g)||[]).length,4);assert.equal((scan.match(/union all/g)||[]).length,2);
  assert.match(scan,/order by recorded_at desc,kind_rank desc,request_id desc limit 51 loop/);
  for(const rank of [1,2,3])assert(scan.includes(`${rank},request_id)<(v_cursor_at,v_cursor_rank,v_cursor)`));
  assert.doesNotMatch(scan,/not exists|decision|status|offset/i);
  ordered(body,'v_count:=v_count+1;exit when v_count=51;','v_next:=jsonb_build_object(',"if candidate.kind='correction'","if v_status<>'all' and v_state<>v_status then continue;end if;",'v_items:=');
  assert.match(body,/'scanned',least\(v_count,50\)/);assert.match(body,/'nextCursor',case when v_count=51 then v_next else 'null'::jsonb end/);
});

test('correction/revision roots and original clock-in identities are checked without full session recomputation',()=>{
  for(const check of ['ct.worker_id is distinct from c.worker_id','ct.employee_id is distinct from c.employee_id',
    'ct.actor_auth_user_id is distinct from c.actor_auth_user_id','ct.start_event_id is distinct from c.start_event_id',
    'base.worker_id is distinct from worker.id','original.worker_id is distinct from worker.id',
    'original.employee_id is distinct from emp.id','original.actor_auth_user_id is distinct from p_auth_user_id',
    'base.start_event_id is distinct from original.start_event_id','vd.base_request_id is distinct from v.base_request_id',
    'vd.worker_id is distinct from v.worker_id','vd.request_revision<>v.revision'])assert(body.includes(check));
  assert(body.includes("id=v_start_event and merchant_id=p_site_id and worker_id=worker.id and action='clock_in' and actor_employee_id=emp.id"));
  assert(body.includes('cd.recorded_at<c.recorded_at'));assert(body.includes('vd.recorded_at<v.recorded_at'));
  assert.doesNotMatch(body,/cd\.recorded_at<=c\.recorded_at|vd\.recorded_at<=v\.recorded_at/);
  assert.doesNotMatch(body,/faolla_attendance_(self_session|correction_basis|self_v1)|effect_current|recursive/);
});

test('missing revisions validate exact submit receipt, original root/parent identity and parent approval before terminal status selection',()=>{
  for(const check of ['ms.operation_id is distinct from m.request_id','ms.actor_auth_user_id is distinct from m.actor_auth_user_id',
    'ms.recorded_at is distinct from m.submitted_at','parent.worker_id is distinct from worker.id','parent.employee_id is distinct from emp.id',
    'parent.actor_auth_user_id is distinct from p_auth_user_id','root_row.worker_id is distinct from worker.id',
    'root_row.employee_id is distinct from emp.id','root_row.actor_auth_user_id is distinct from p_auth_user_id',
    'root_row.supersedes_request_id is not null','root_row.root_request_id is not null',
    'coalesce(parent.root_request_id,parent.request_id) is distinct from m.root_request_id',
    'approval.request_id is distinct from parent.request_id',"approval.action is distinct from 'approve'",'approval.recorded_at>m.submitted_at'])assert(body.includes(check));
  assert(body.includes('revision=2 and recorded_at<=v_asof'));
  assert(body.includes("mt.action='withdraw' and mt.actor_auth_user_id is distinct from m.actor_auth_user_id"));
  assert.doesNotMatch(body,/missing_current/);
  assert.equal((body.match(/then continue;/g)||[]).length,1,'only final status filtering skips; corruption never yields a partial page');
});

test('projection contains only twelve summary and nine envelope fields with128KiB output cap',()=>{
  const item=body.slice(body.indexOf('v_items:=v_items||'),body.indexOf('\n  end loop;',body.indexOf('v_items:=v_items||')));
  const envelope=body.slice(body.indexOf('result:=jsonb_build_object'));
  const keys=s=>[...s.matchAll(/'([A-Za-z][A-Za-z0-9]*)',/g)].map(m=>m[1]).filter(k=>k!=='UTC');
  assert.deepEqual(keys(item),['kind','requestId','rootRequestId','workerId','employeeId','workerName','workerNo','submittedAt','proposedStartAt','proposedEndAt','status','closedAt']);
  assert.deepEqual(keys(envelope),['protocol','readOnly','siteId','employeeId','workerId','asOf','items','scanned','nextCursor']);
  assert.doesNotMatch(item+envelope,/to_jsonb|row_to_json|reason|command|email|actor_auth|evidenceToken|operationId|canApprove/);
  assert.match(envelope,/octet_length\(result::text\)>131072/);assert.match(envelope,/attendance_self_requests_too_large/);
  assert.match(body,/raise exception 'attendance_self_requests_invalid'/);
});

test('service-only ACL, exact idempotent registry and original function owner are preserved',()=>{
  assert.match(body,/security definer set search_path=pg_catalog/);
  assert(outside.includes(`revoke all on function ${signature} from public,anon,authenticated,service_role;`));
  assert(outside.includes(`grant execute on function ${signature} to service_role;`));assert.equal((outside.match(/grant execute/g)||[]).length,1);
  assert.doesNotMatch(outside,/grant (select|all|insert|update|delete)|alter function|owner to|create policy/i);
  assert(outside.includes("values(202610030118,'merchant_attendance_self_requests') on conflict(version) do nothing"));
  for(const role of ['service_role','anon','authenticated'])assert(outside.includes(`has_function_privilege('${role}','${signature}','EXECUTE')`));
  ordered(outside,'on conflict(version) do nothing;','do $self_requests_postconditions$',"notify pgrst, 'reload schema';",'commit;');
});
