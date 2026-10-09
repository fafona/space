import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const original=read('./supabase-migrations/202610010107_merchant_attendance_pin_clock.sql');
const sql=read('./supabase-migrations/202610020112_merchant_attendance_pin_clock_identity.sql');
const withoutComments=text=>text.replace(/--[^\n]*/g,'');
const normalize=text=>withoutComments(text).replace(/\s+/g,' ').trim();
const code=withoutComments(sql);
const functionText=text=>{
  const match=text.match(/create(?: or replace)? function public\.faolla_attendance_pin_clock_v1\([\s\S]*?\nend;\$\$;/);
  assert(match,'established PIN-clock RPC must have its complete definition');return match[0];
};
const body=withoutComments(functionText(sql));
const guard="if last_row.id is not null and last_row.actor_employee_id is distinct from w.employee_id then\n      raise exception 'attendance_access_denied';\n    end if;";
const signature='public.faolla_attendance_pin_clock_v1(text,uuid,text,text,uuid,boolean,jsonb,boolean)';
const ordered=(text,...parts)=>{
  let previous=-1;
  for(const part of parts){const at=text.indexOf(part,previous+1);assert(at>previous,`missing/out-of-order SQL: ${part}`);previous=at;}
};

test('112 replaces only the existing PIN RPC and idempotent ledger with the established service-only ACL',()=>{
  assert.equal((code.match(/create or replace function/g)||[]).length,1);
  assert.match(body,/p_site text,p_terminal uuid,p_secret_hash text,p_no text,p_lease uuid,p_verified boolean,p_request jsonb,p_allow_new boolean/);
  assert.match(body,/returns jsonb language plpgsql security definer set search_path=pg_catalog/);
  assert.doesNotMatch(code,/\b(?:create table|create index|create trigger|alter table|drop|truncate|delete from|update public\.|grant select)\b/i);
  const outside=code.replace(body,'');
  assert.deepEqual([...outside.matchAll(/insert into ([\w.]+)/g)].map(match=>match[1]),['public.faolla_schema_migrations']);
  assert.deepEqual([...outside.matchAll(/revoke all on function ([^;]+);/g)].map(match=>match[1]),[`${signature} from public,anon,authenticated,service_role`]);
  assert.deepEqual([...outside.matchAll(/grant execute on function ([^;]+);/g)].map(match=>match[1]),[`${signature} to service_role`]);
  assert.match(code,/values \(202610020112,'merchant_attendance_pin_clock_identity'\) on conflict\(version\) do nothing/);
  assert.match(code,/^\s*begin;/);assert.match(code,/set local lock_timeout='3s'/);assert.match(code,/commit;\s*$/);
});

test('the complete 107 function is identical after removing only the approved latest guard and expected-error addition',()=>{
  assert.equal(body.split(guard).length,2);
  assert.equal(body.split("if sqlerrm in ('attendance_access_denied',").length,2);
  const reverted=body.replace(guard,'').replace("if sqlerrm in ('attendance_access_denied',","if sqlerrm in (")
    .replace('create or replace function','create function');
  assert.equal(normalize(reverted),normalize(functionText(original)));
  assert.equal((body.match(/'attendance_access_denied'/g)||[]).length,2);
});

test('latest identity check is unconditional between the unfiltered last-row lookup and any derived state, receipt or append',()=>{
  const start=body.indexOf('select * into last_row from public.merchant_attendance_events');
  const end=body.indexOf('seq:=coalesce(last_row.sequence,0)',start);
  assert.equal(normalize(body.slice(start,end)),normalize(`select * into last_row from public.merchant_attendance_events where merchant_id=p_site and worker_id=w.id order by sequence desc limit 1;
    ${guard}`));
  ordered(body,"raise exception 'attendance_worker_changed'",'select * into last_row',guard,'seq:=coalesce(last_row.sequence,0)',
    'status_now:=case','select * into receipt','replayed:=c is not null;',"return jsonb_build_object('siteId'");
  ordered(body,guard,'if c is not null and not replayed then','insert into public.merchant_attendance_events');
  assert.doesNotMatch(body.slice(start,end),/last_row\.(?:id|action)\s*:=|source|clock_out|coalesce\([^)]*actor_employee_id/);
});

test('finish consumes the lease before the guarded business subtransaction and the new denial is returned inside its existing catch',()=>{
  const inner='begin\n    select * into s from public.merchant_attendance_settings';
  ordered(body,'select lease_expires into lease_until','checked:=public.faolla_attendance_pin_finish_v1(',
    "if checked->>'verified'<>'true' then return jsonb_build_object('error','attendance_pin_denied');end if;",inner,
    guard,'exception when raise_exception then',"if sqlerrm in ('attendance_access_denied','attendance_pin_denied'",
    "return jsonb_build_object('error',sqlerrm);",'end if;raise;');
  assert.equal((body.match(/faolla_attendance_pin_finish_v1\(/g)||[]).length,1);
  assert.doesNotMatch(body,/faolla_attendance_pin_begin_v1|update public\.merchant_attendance_pin_attempts|lease_id\s*:=/);
  const errors=text=>functionText(text).match(/if sqlerrm in \(([\s\S]*?)\) then/)[1].match(/'attendance_[a-z_]+'/g);
  assert.deepEqual(errors(sql),["'attendance_access_denied'",...errors(original)]);
});

test('an absent latest row retains the empty-worker path, while OTHER/null actor rows cannot be filtered or disguised as off',()=>{
  assert.match(body,/if last_row\.id is not null and last_row\.actor_employee_id is distinct from w\.employee_id then/);
  assert.match(body,/seq:=coalesce\(last_row\.sequence,0\);status_now:=case when last_row\.id is null or last_row\.action='clock_out' then 'off'/);
  assert.doesNotMatch(body,/where[^;]*actor_employee_id|last_row\.source|last_row\s*:=\s*null|last_row\.id\s*:=\s*null/);
  assert.match(body,/select \* into w from public\.merchant_attendance_workers where merchant_id=p_site and lower\(btrim\(worker_no\)\)=lower\(p_no\)/);
  assert.match(body,/w\.employee_id is distinct from \(c->>'expectedEmployeeId'\)::uuid/);
  assert.match(body,/values\(p_site,w\.id,t\.location_id,op,seq\+1,action_now,'kiosk',[\s\S]*now_at,now_at,l\.time_zone,w\.employee_id\) returning \* into receipt/);
});

test('the existing strict older PIN receipt binding and exact-command replay remain unchanged',()=>{
  const receiptSection=text=>normalize(functionText(text).slice(functionText(text).indexOf('select * into receipt'),functionText(text).indexOf("now_at:=date_trunc('milliseconds'")));
  assert.equal(receiptSection(sql),receiptSection(original));
  assert.match(body,/binding\.event_id is null or binding\.terminal_id<>p_terminal or binding\.employee_id<>w\.employee_id/);
  assert.match(body,/receipt\.actor_employee_id is distinct from w\.employee_id or receipt\.source<>'kiosk'/);
  assert.match(body,/c is not null and binding\.command<>c\) then raise exception 'attendance_operation_conflict'/);
  assert.equal((body.match(/insert into public\.merchant_attendance_events\(/g)||[]).length,1);
  assert.equal((body.match(/insert into public\.merchant_attendance_pin_clock_receipts /g)||[]).length,1);
});

test('time, pause, geofence, employment and the response shape preserve their established successful paths',()=>{
  ordered(body,'replayed:=c is not null;',"now_at:=date_trunc('milliseconds',clock_timestamp())",'clock_timestamp()>=lease_until',
    "when l.radius_meters is not null then 'attendance_location_verification_required'",'merchant_attendance_employment_periods',
    'if c is not null and not replayed then','if seq<>expected',"if p_allow_new is distinct from true and action_now in ('clock_in','break_start')",
    "if last_row.id is not null and now_at<last_row.occurred_at",'insert into public.merchant_attendance_events');
  const response=text=>normalize(functionText(text).slice(functionText(text).indexOf("return jsonb_build_object('siteId'"),functionText(text).indexOf('exception when raise_exception then')));
  assert.equal(response(sql),response(original));
  for(const name of ['attendance_already_clocked_in','attendance_not_working','attendance_not_on_break','attendance_break_must_end','attendance_not_clocked_in'])
    assert(body.includes(`raise exception '${name}'`));
  assert.doesNotMatch(body,/faolla_attendance_self_v1|faolla_attendance_onsite_|faolla_attendance_location_clock/);
});
