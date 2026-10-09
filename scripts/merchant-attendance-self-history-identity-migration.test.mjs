import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import test from 'node:test';
import {checkAttendanceSelfHistoryIdentityNative} from './merchant-attendance-self-history-identity-native-checks.mjs';

const migrations=new URL('./supabase-migrations/',import.meta.url);
const sql=readFileSync(new URL('202610020110_merchant_attendance_self_history_identity.sql',migrations),'utf8');
const code=sql.replace(/--[^\n]*/g,'');
const history=code.slice(code.indexOf('create or replace function public.faolla_attendance_self_history_v1'),code.indexOf('create or replace function public.faolla_attendance_self_session_v1'));
const session=code.slice(code.indexOf('create or replace function public.faolla_attendance_self_session_v1'));
const ordered=(text,...pieces)=>{
  let previous=-1;for(const piece of pieces){const at=text.indexOf(piece,previous+1);assert(at>previous,`missing/out-of-order ${piece}`);previous=at;}
};

test('110 replaces only the two established read signatures and retains idempotent ledger plus service-only ACLs',()=>{
  assert.equal([...code.matchAll(/create or replace function/g)].length,2);
  assert.doesNotMatch(code,/\b(?:create table|create index|alter table|drop |truncate|update public\.|delete from|grant select)\b/i);
  assert.deepEqual([...code.matchAll(/insert into ([\w.]+)/g)].map(match=>match[1]),['public.faolla_schema_migrations']);
  for(const signature of ['faolla_attendance_self_history_v1(text,uuid,jsonb)','faolla_attendance_self_session_v1(text,uuid,uuid)']){
    assert(code.includes(`revoke all on function public.${signature} from public,anon,authenticated,service_role;`));
    assert(code.includes(`grant execute on function public.${signature} to service_role;`));
  }
  assert.equal([...code.matchAll(/language plpgsql security definer set search_path=pg_catalog/g)].length,2);
  assert.match(code,/values\(202610020110,'merchant_attendance_self_history_identity'\) on conflict\(version\) do nothing/);
  assert.match(code,/^\s*begin;/);assert.match(code,/commit;\s*$/);
});

test('both reads retain server-auth-to-employee mapping, permission and established authorization lock order',()=>{
  for(const body of [history,session]){
    ordered(body,'from public.merchants','from public.merchant_attendance_settings','into v_employee','into v_role','into v_worker','v_now:=clock_timestamp()');
    assert.match(body,/merchant_id=p_site_id and auth_user_id=p_auth_user_id for share/);
    assert.match(body,/merchant_id=p_site_id and employee_id=v_employee.id for share/);
    assert.match(body,/v_employee.status<>'active'/);assert.match(body,/v_role.status<>'active'/);
    assert.match(body,/faolla_valid_merchant_enterprise_permissions_v1\(v_role.permissions\)/);assert.match(body,/'attendance.self.view'=any\(v_role.permissions\)/);
    assert.doesNotMatch(body,/attendance\.self\.clock|not v_worker\.active|web_clock_enabled|not .*\.enabled|actor_auth_user_id/);
  }
});

test('history applies exact employee identity before cursor and limit without changing page or envelope protocol',()=>{
  ordered(history,'and e.actor_employee_id=v_employee.id','and (v_cursor_id is null','order by e.occurred_at desc,e.id desc limit 51','v_rows:=v_rows-50');
  assert.match(history,/jsonb_object_keys\(p_query\)\)<>6/);
  assert.match(history,/array\['fromAt','toAt','expectedWorkerId','asOf','cursorAt','cursorId'\]/);
  assert.match(history,/v_worker.id<>\(p_query->>'expectedWorkerId'\)::uuid/);
  assert.match(history,/attendance_worker_changed/);assert.match(history,/v_to-v_from>interval '31 days'/);
  assert.match(history,/\(e.occurred_at,e.id\)<\(v_cursor_at,v_cursor_id\)/);
  assert.match(history,/YYYY-MM-DD"T"HH24:MI:SS.US"Z"/);
  assert.match(history,/'asOf'.*\n?.*'items',v_rows,'nextCursor',v_next/);
  const projection=history.slice(history.indexOf("jsonb_build_object('id'"),history.indexOf('from public.merchant_attendance_events e'));
  assert.doesNotMatch(projection,/actor_employee_id|auth_user_id|operation_id/);
});

test('session checks unfiltered complete bounded segment and cannot splice out an unknown actor or clock-out',()=>{
  assert.match(session,/v_start.actor_employee_id is distinct from v_employee.id/);
  assert.equal([...session.matchAll(/order by sequence limit 2003/g)].length,2);
  assert.match(session,/bool_or\(e.actor_employee_id is distinct from v_employee.id\)/);
  assert.match(session,/source,actor_employee_id from public.merchant_attendance_events/);
  assert.match(session,/and \(v_end_sequence is null or sequence<=v_end_sequence\)/);
  assert.doesNotMatch(session,/where[^;]*actor_employee_id\s*=|and\s+actor_employee_id\s*=/);
  ordered(session,'v_start.actor_employee_id is distinct','select sequence into v_end_sequence','select bool_or','into v_identity_unconfirmed,v_rows',
    'if coalesce(v_identity_unconfirmed,true) or jsonb_array_length(v_rows)>2002',"then raise exception 'attendance_session_not_found'",'if v_start.sequence>1');
});

test('all over-limit or identity-uncertain segments share not-found before structural errors, with no partial response',()=>{
  assert.match(session,/if coalesce\(v_identity_unconfirmed,true\) or jsonb_array_length\(v_rows\)>2002\s+then raise exception 'attendance_session_not_found'/);
  assert.doesNotMatch(session,/attendance_session_too_large|limit 2002|v_rows\s*:=\s*v_rows-/);
  assert(session.indexOf('if coalesce(v_identity_unconfirmed,true)')<session.indexOf('attendance_session_invalid_records'));
  assert(session.indexOf('attendance_session_invalid_records')<session.indexOf('return jsonb_build_object'));
  assert.match(session,/'events',v_rows/);
  const projection=session.slice(session.indexOf('jsonb_agg(jsonb_build_object'),session.indexOf('into v_identity_unconfirmed,v_rows'));
  assert.doesNotMatch(projection,/actor_employee_id|operation_id|auth_user_id/);
});

test('no later replacement bypasses the new ownership boundary and current PIN/onsite writers remain attributable',()=>{
  const definitions=[];
  for(const file of readdirSync(migrations).filter(file=>file.endsWith('.sql')).sort()){
    const source=readFileSync(new URL(file,migrations),'utf8');
    for(const match of source.matchAll(/create(?: or replace)? function public\.(faolla_attendance_self_(?:history|session)_v1)\(/g))definitions.push({file,name:match[1]});
  }
  for(const name of ['faolla_attendance_self_history_v1','faolla_attendance_self_session_v1'])
    assert.equal(definitions.filter(entry=>entry.name===name).at(-1).file,'202610020110_merchant_attendance_self_history_identity.sql');
  const pin=readFileSync(new URL('202610010107_merchant_attendance_pin_clock.sql',migrations),'utf8');
  const onsite=readFileSync(new URL('202610010108_merchant_attendance_onsite_qr.sql',migrations),'utf8');
  assert.match(pin,/insert into public.merchant_attendance_events\([^;]*actor_employee_id\)[\s\S]*?values\([^;]*w.employee_id\)/);
  assert.match(onsite,/insert into public.merchant_attendance_events\([^;]*actor_employee_id\)[\s\S]*?values\([^;]*e.id\)/);
});

test('native checker only constructs owned, bounded transaction steps and independently named acceptance assertions',async()=>{
  let statements=null,snapshots=0;const passed=[];
  // Construction probe only: mock setup inspections and emitted assertion labels,
  // not business results. This cannot establish that any SQL assertion passed.
  const exec=statement=>{
    if(statement.includes("'marker',obj_description"))return JSON.stringify({schema:'attendance_race_'+'a'.repeat(32),owner:'postgres',marker:'faolla-synthetic-concurrency:00000000-0000-4000-8000-000000000001'});
    if(statement.includes('select count(*) from public.merchants'))return '0';
    if(statement.includes("'events',(select")){snapshots++;return 'unchanged opaque baseline';}
    throw Error('Unexpected native setup inspection');
  };
  await checkAttendanceSelfHistoryIdentityNative({exec,pass:label=>passed.push(label),querySteps:async steps=>{
    statements=steps;
    const match=steps.at(-1).match(/select '((?:[^']|'')*)'::jsonb;rollback;/);assert(match,'final evidence must be selected before rollback');
    return match[1].replaceAll("''","'");
  }});
  assert.equal(snapshots,2);assert.equal(passed.length,8);assert(statements.length<=100);assert.match(statements[0],/^begin;/);
  const combined=statements.join('\n');assert.match(combined,/statement_timeout='10s'/);assert.match(combined,/rollback to savepoint identity_bulk/);
  for(const statement of statements){
    for(const range of statement.matchAll(/generate_series\((\d+),(\d+)\)/g))assert(Number(range[2])-Number(range[1])+1<=50);
    for(const insert of statement.matchAll(/insert into public\.merchant_attendance_events\([^)]+\) values\s*([\s\S]+?);/g))
      assert([...insert[1].matchAll(/\('00000000/g)].length<=50);
  }
  assert.match(combined,/full supported segment/);assert.match(combined,/first microsecond boundary/);assert.match(combined,/new binding never inherits former actor/);
  assert.doesNotMatch(combined,/update public\.merchant_attendance_events|delete from public\.merchant_attendance_events|disable trigger|session_replication_role/);
  const source=readFileSync(new URL('./merchant-attendance-self-history-identity-native-checks.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/dotenv|DATABASE_URL|SUPABASE_|spawn\(|createClient|listen\(/);
});

test('native checker refuses unowned namespaces and occupied tenant IDs before transaction execution',async()=>{
  let ran=false;
  await assert.rejects(checkAttendanceSelfHistoryIdentityNative({exec:()=>JSON.stringify({schema:'public',owner:'postgres',marker:'not-owned'}),
    querySteps:async()=>{ran=true;},pass:()=>{}}),/self_identity_native_owned_schema_required/);assert.equal(ran,false);
  const exec=statement=>statement.includes("'marker',obj_description")
    ?JSON.stringify({schema:'attendance_race_'+'a'.repeat(32),owner:'postgres',marker:'faolla-synthetic-concurrency:00000000-0000-4000-8000-000000000001'}):'1';
  await assert.rejects(checkAttendanceSelfHistoryIdentityNative({exec,querySteps:async()=>{ran=true;},pass:()=>{}}),/self_identity_native_tenants_exist/);assert.equal(ran,false);
});
