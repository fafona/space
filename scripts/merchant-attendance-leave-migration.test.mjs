// Static contracts only. Actual SQL evidence belongs to the owned native runner.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';
const name='202610030122_merchant_attendance_leave_requests.sql';
const sql=readFileSync(new URL(`./supabase-migrations/${name}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const clean=sql.replace(/--[^\n]*/g,''),body=clean.slice(clean.indexOf('create or replace function public.faolla_attendance_leave_v1'),clean.indexOf('revoke all on function public.faolla_attendance_leave_v1'));
const ordered=(...parts)=>{let at=-1;for(const s of parts){const n=body.indexOf(s,at+1);assert(n>at,`missing/out-of-order ${s}`);at=n;}};

test('122 is an additive transaction with061/121 prerequisites, conflict guards and unchanged migration checker acceptance',()=>{
  assert.deepEqual(validateMigrationSource(name,sql),[]);
  assert.match(clean,/begin;\nset local lock_timeout='3s';/);
  for(const s of ['version=202609290061','version=202610030121','merchant_attendance_leave_installation_conflict'])assert(clean.includes(s));
  assert.deepEqual([...clean.matchAll(/create table if not exists public\.(\w+)/g)].map(m=>m[1]),['merchant_attendance_leave_requests','merchant_attendance_leave_entries']);
  assert.doesNotMatch(clean,/\b(drop|delete from|disable trigger|owner to|create policy)\b/i);
  assert.doesNotMatch(body,/merchant_attendance_(?:events\b|schedule_|missing_|correction_|effect_)|payroll|balance/);
  for(const match of clean.matchAll(/insert into public\.(\w+)/g))assert(['merchant_attendance_leave_requests','merchant_attendance_leave_entries','faolla_schema_migrations'].includes(match[1]));
});

test('two immutable ledgers preserve same-tenant four identities and atomic submit/receipt with bounded terminal revisions',()=>{
  for(const s of ['worker_id uuid not null,employee_id uuid not null,actor_auth_user_id uuid not null','unique(merchant_id,request_id,revision)',
    "revision=1 and action='submit' and operation_id=request_id","revision=2 and action in ('withdraw','approve','reject')","revision=3 and action='cancel'",'deferrable initially deferred',
    'foreign key(merchant_id,worker_id)','foreign key(merchant_id,employee_id)','command jsonb not null,snapshot jsonb not null'])assert(clean.includes(s));
  assert.match(clean,/before update or delete on public\.%I/);assert.match(clean,/before truncate on public\.%I/);
  assert(clean.includes('faolla_attendance_events_append_only_v1()'));
  assert.doesNotMatch(body,/\bupdate public\./);
  assert.match(clean,/attendance_leave_self_list_idx[\s\S]*?merchant_id,worker_id,employee_id,actor_auth_user_id,submitted_at desc,request_id desc/);
});

test('query exact6 and commands exact8/5 reject cursor mixing, noncanonical timestamps, noninteger versions and private extra keys',()=>{
  assert(body.includes("array['siteId','access','requestId','operationId','beforeAt','beforeId']"));assert(body.includes('jsonb_object_keys(p_query))<>6'));
  assert(body.includes('(cursor_at is null)<>(cursor_id is null)'));assert(body.includes('cursor_at is not null and (target_id is not null or op is not null)'));
  assert(body.includes("array['expectedWorkerId','expectedSettingsVersion','timeZone','startAt','endAt']"));assert(body.includes('jsonb_object_keys(p_command))<>8'));assert(body.includes('jsonb_object_keys(p_command))<>5'));
  assert(body.includes("jsonb_typeof(p_command->'expectedSettingsVersion')<>'number'"));assert(body.includes('::numeric>9007199254740990'));
  assert(body.includes('T\\d{2}:\\d{2}:00\\.000Z$'));assert(body.includes('SS.US'));assert(body.includes("p_command->>'requestId'<>target_id::text"));
  assert(body.includes("to_jsonb(case when action_name='cancel' then 2 else 1 end)"));assert(body.includes('[[:cntrl:]\\u007f-\\u009f]'));assert(body.includes('\\feff'));
});

test('authorization/locks and current four identities precede exact actor replay, which precedes pause and fresh state checks',()=>{
  ordered('perform 1 from public.merchants','if p_command is null then select * into s','else select * into s','select * into e','select * into r','select * into w',
    'select * into receipt_row','receipt_row.actor_auth_user_id<>p_auth_user_id','receipt_row.command is distinct from p_command',
    'target.worker_id is distinct from w.id','if not p_allow_write');
  assert(body.includes("if p_command is not null then raise exception 'attendance_operation_conflict';end if;receipt_row:=null;"));
  assert(body.includes("raise exception 'attendance_leave_not_found'"));
  assert(body.includes("can_submit:=coalesce(w.active and 'attendance.self.leave'=any(r.permissions),false)"));
  assert(body.includes("if mode='self' and not('attendance.self.leave'=any(r.permissions))"));
  assert(body.includes("if mode='owner' and target.actor_auth_user_id=p_auth_user_id then raise exception 'attendance_access_denied'"));
  assert.doesNotMatch(body,/s\.enabled|web_clock_enabled|attendance\.self\.clock|attendance\.self\.request/);
});

test('submit uses settings timezone and employment local days, while approval rechecks binding and half-open approved-only overlap',()=>{
  assert(body.includes("p_command->>'timeZone'<>s.time_zone"));assert(body.includes("b-a>interval '366 days'"));
  assert(body.includes("(target.end_at-interval '1 microsecond')"));assert(body.includes('coverage<>1'));assert(body.includes('generate_series(first_day::timestamp,last_day::timestamp'));
  assert(body.includes('review_e.auth_user_id=target.actor_auth_user_id and review_w.employee_id=target.employee_id and review_w.active'));
  assert(body.includes("review_r.status='active'"));assert(body.includes("'attendance.self.view'=any(review_r.permissions)"));
  assert(!body.includes("'attendance.self.leave'=any(review_r.permissions)"));
  assert(body.includes('p.start_at<target.end_at and p.end_at>target.start_at'));assert(body.includes("d.revision=2 and d.action='approve'"));assert(body.includes('c.revision=3'));
  ordered("if action_name='submit' and not employment_ok","if action_name='approve' then","if not binding_ok","if not employment_ok","if overlap_found");
  assert(body.includes("can_cancel:=mode='owner' and target.actor_auth_user_id<>p_auth_user_id and item->>'status'='approved'"));
});

test('private summary checks chain and historical snapshots; public list never projects reasons or auth and self filtering precedes26 probe',()=>{
  const helper=clean.slice(clean.indexOf('create or replace function public.faolla_attendance_leave_summary_v1'),clean.indexOf('revoke all on function public.faolla_attendance_leave_summary_v1'));
  for(const s of ['n>3 or entry.revision<>n',"n=3 and (entry.action<>'cancel' or prior_action<>'approve')",'entry.snapshot is distinct from item',"raise exception 'attendance_leave_invalid'",'p_revision=n'])assert(helper.includes(s));
  assert(body.includes('public.faolla_attendance_leave_summary_v1(target,receipt_row.revision)'));
  assert(body.includes("if p_command is null and p_query->'requestId'='null'::jsonb and p_query->'operationId'='null'::jsonb then"));
  const listing=body.slice(body.indexOf('for candidate in select * from public.merchant_attendance_leave_requests p'));
  assert.match(listing,/p\.worker_id=w\.id and p\.employee_id=e\.id and p\.actor_auth_user_id=p_auth_user_id[\s\S]*?limit 26 loop/);
  assert(listing.includes('row_count:=row_count+1;exit when row_count=26;'));
  assert(listing.includes('row_count=26 then next_cursor else null'));assert.doesNotMatch(listing,/reason|history/);
  assert(body.includes("'command',receipt_row.command,'item',item,'requestId',receipt_row.request_id,'revision',receipt_row.revision"));
  assert(body.includes('octet_length(result::text)>131072'));
});

test('service-only public RPC and private helper have no direct table privileges, including effective inherited grants',()=>{
  assert.equal((clean.match(/enable row level security/g)||[]).length,2);
  assert(clean.includes('revoke all on public.merchant_attendance_leave_requests,public.merchant_attendance_leave_entries from public,anon,authenticated,service_role'));
  assert.equal((clean.match(/grant execute/g)||[]).length,1);
  assert(clean.includes('grant execute on function public.faolla_attendance_leave_v1(jsonb,uuid,jsonb,boolean) to service_role'));
  assert(clean.includes('revoke all on function public.faolla_attendance_leave_summary_v1(public.merchant_attendance_leave_requests,integer) from public,anon,authenticated,service_role'));
  assert(clean.includes("aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))"));assert(clean.includes("pg_has_role(role_name,c.relowner,'USAGE')"));
  assert(clean.includes("case when a.grantee=0 then true else pg_has_role(role_name,a.grantee,'USAGE') end"));
  assert(clean.includes("values(202610030122,'merchant_attendance_leave_requests') on conflict(version) do nothing"));assert(clean.includes("notify pgrst, 'reload schema'"));
});
