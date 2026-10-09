import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const original=read('./supabase-migrations/202609300077_merchant_attendance_location_clock_notice_guard.sql');
const sql=read('./supabase-migrations/202610020113_merchant_attendance_location_receipt_identity.sql');
const withoutComments=text=>text.replace(/--[^\n]*/g,'');
const normalize=text=>withoutComments(text).replace(/\s+/g,' ').trim();
const code=withoutComments(sql);
const functionText=text=>{
  const match=text.match(/create(?: or replace)? function public\.faolla_attendance_location_clock_v2\([\s\S]*?\nend; \$\$;/);
  assert(match,'complete established location v2 definition required');return match[0];
};
const body=withoutComments(functionText(sql));
const guard="if exists(select 1 from public.merchant_attendance_events\n    where merchant_id=p_site_id and worker_id=w.id and operation_id=op\n      and actor_employee_id is distinct from e.id) then\n    raise exception 'attendance_access_denied';\n  end if;";
const signature=version=>`public.faolla_attendance_location_clock_v${version}(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean)`;
const firstRead='b:=public.faolla_attendance_location_clock_v1(p_site_id,p_auth_user_id,p_expected_worker_id,null,op,null,p_allow_new_sessions,p_require_clock or p_command is not null);';
const workerFence="if w.id<>p_expected_worker_id then raise exception 'attendance_worker_changed'; end if;";
const ordered=(text,...parts)=>{
  let previous=-1;
  for(const part of parts){const at=text.indexOf(part,previous+1);assert(at>previous,`missing/out-of-order SQL: ${part}`);previous=at;}
};

test('113 replaces only public v2, keeps v1 private and appends an idempotent migration ledger without repairing data',()=>{
  assert.equal((code.match(/create or replace function/g)||[]).length,1);
  assert.match(body,/p_site_id text,p_auth_user_id uuid,p_expected_worker_id uuid,p_command jsonb default null,p_operation_id uuid default null/);
  assert.match(body,/p_assertion jsonb default null,p_allow_new_sessions boolean default false,p_require_clock boolean default false/);
  assert.match(body,/returns jsonb language plpgsql security definer set search_path=pg_catalog/);
  assert.doesNotMatch(code,/\b(?:create table|create index|create trigger|alter table|drop|truncate|delete from|update public\.|grant select)\b/i);
  assert.doesNotMatch(code,/create(?: or replace)? function public\.faolla_attendance_location_clock_v1/);
  const outside=code.replace(body,'');
  assert.deepEqual([...outside.matchAll(/insert into ([\w.]+)/g)].map(match=>match[1]),['public.faolla_schema_migrations']);
  assert.deepEqual([...outside.matchAll(/revoke all on function ([^;]+);/g)].map(match=>match[1]),[
    `${signature(2)} from public,anon,authenticated,service_role`,`${signature(1)} from service_role`]);
  assert.deepEqual([...outside.matchAll(/grant execute on function ([^;]+);/g)].map(match=>match[1]),[`${signature(2)} to service_role`]);
  assert.match(code,/values \(202610020113,'merchant_attendance_location_receipt_identity'\) on conflict\(version\) do nothing/);
  assert.match(code,/^\s*begin;/);assert.match(code,/set local lock_timeout='3s'/);assert.match(code,/commit;\s*$/);
});

test('the entire 077 function remains identical after removing exactly the approved original-operation guard',()=>{
  assert.equal(body.split(guard).length,2);
  const reverted=body.replace(guard,'').replace('create or replace function','create function');
  assert.equal(normalize(reverted),normalize(functionText(original)));
  const declarations=text=>normalize(functionText(text).split('\nbegin\n')[0].replace('create or replace function','create function'));
  assert.equal(declarations(sql),declarations(original),'no additional mutable authorization state');
});

test('current merchant/member/role/worker locks and the expected-worker fence precede the guard and every private v1 call',()=>{
  ordered(body,'perform 1 from public.merchants','select * into s from public.merchant_attendance_settings',
    'select * into e from public.merchant_enterprise_employees','select * into r from public.merchant_enterprise_roles',
    'if p_command is null then\n    select * into w',
    'where merchant_id=p_site_id and employee_id=e.id for share;',
    'where merchant_id=p_site_id and employee_id=e.id for update;',workerFence,guard,firstRead);
  const start=body.indexOf(workerFence),end=body.indexOf(firstRead)+firstRead.length;
  assert.equal(normalize(body.slice(start,end)),normalize(`${workerFence}\n${guard}\n${firstRead}`));
  assert.equal((body.match(/b:=public\.faolla_attendance_location_clock_v1\(/g)||[]).length,3);
  for(const match of body.matchAll(/b:=public\.faolla_attendance_location_clock_v1\(/g))assert(match.index>body.indexOf(guard));
});

test('read-only recovery, require-clock preflight and explicit commands share the same resolved original-operation identity check',()=>{
  ordered(body,'if p_command is null then','op:=p_operation_id;',"op:=(p_command->>'operationId')::uuid;",workerFence,guard,firstRead);
  assert.match(guard,/merchant_id=p_site_id and worker_id=w\.id and operation_id=op/);
  assert.match(guard,/actor_employee_id is distinct from e\.id/);
  assert.doesNotMatch(guard,/p_command|p_require_clock|p_allow_new_sessions|safe|source|merchant_attendance_location_results|merchant_attendance_location_clock_notices/);
  assert.doesNotMatch(guard,/coalesce|actor_employee_id\s*=|operation_id\s+is\s+null|return|:=/);
  assert.equal((guard.match(/raise exception/g)||[]).length,1);
  // This exact EXISTS does not reinterpret a genuinely absent/null operation as
  // an identity failure, nor depend on the receipt's location evidence existing.
  assert.equal(normalize(guard),normalize(`if exists(select 1 from public.merchant_attendance_events
    where merchant_id=p_site_id and worker_id=w.id and operation_id=op and actor_employee_id is distinct from e.id) then
    raise exception 'attendance_access_denied'; end if;`));
});

test('view-only receipt reads and the established latest-identity denial remain unchanged',()=>{
  assert.match(body,/not\('attendance.self.view'=any\(r.permissions\)\) or \(\(p_command is not null or p_require_clock\) and not\('attendance.self.clock'=any\(r.permissions\)\)\)/);
  assert.match(body,/if last_fact.id is not null and last_fact.actor_employee_id is distinct from e.id then raise exception 'attendance_access_denied'; end if;/);
  assert.doesNotMatch(body,/receipt\s*:=\s*null|b\s*:=\s*null|last_fact\s*:=\s*null/);
  const errorTail=text=>normalize(functionText(text).slice(functionText(text).indexOf('exception when invalid_text_representation')));
  assert.equal(errorTail(sql),errorTail(original),'identity denial must not be caught or translated to a successful null receipt');
  assert.doesNotMatch(body,/exception when raise_exception|exception when others/);
});

test('same-identity receipts keep exact command replay before policy and safe-finish branches',()=>{
  ordered(body,guard,firstRead,"if b->'receipt'<>'null'::jsonb then",'select * into link',
    "if link.event_id is null or link.command<>p_command then raise exception 'attendance_operation_conflict'",'replay:=true;',
    'elsif p_command is not null then','if safe then',"if finish is null then raise exception 'attendance_safe_finish_unavailable'");
  const receiptTail=text=>normalize(functionText(text).slice(functionText(text).indexOf("if b->'receipt'<>'null'::jsonb then")));
  assert.equal(receiptTail(sql),receiptTail(original));
  assert.equal((body.match(/insert into public\.merchant_attendance_events\(/g)||[]).length,1);
  assert.equal((body.match(/insert into public\.merchant_attendance_location_results\(/g)||[]).length,1);
  assert.equal((body.match(/insert into public\.merchant_attendance_location_clock_notices\(/g)||[]).length,1);
});

test('notice readiness, safe-finish location and original response fields are byte-normalized compatible',()=>{
  const successfulTail=text=>normalize(functionText(text).slice(functionText(text).indexOf(firstRead)));
  assert.equal(successfulTail(sql),successfulTail(original));
  assert.match(body,/last_fact.actor_employee_id=e.id\s+and 'attendance.self.clock'=any\(r.permissions\)/);
  assert.match(body,/where merchant_id=p_site_id and id=last_fact.location_id for share/);
  assert.match(body,/values\(p_site_id,w.id,ending.id,op,last_fact.sequence\+1,p_command->>'action','web',null,stamp,stamp,last_fact.time_zone,e.id\)/);
  assert.match(body,/'noticeGate',gate,'finish',finish,'receiptGate',receipt_gate/);
  assert.match(body,/exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'attendance_invalid_request'/);
});
