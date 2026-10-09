// Source-contract tests only; real144 installation and transaction tests are
// root-owned. Historical migrations are read, never rewritten by this test.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';
const file='202610050144_merchant_attendance_self_schedule_adoption.sql';
const read=name=>readFileSync(new URL(`./supabase-migrations/${name}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const strip=text=>text.replace(/--[^\n]*/g,''),compact=text=>text.replace(/\s+/g,' ').trim();
const source=read(file),clean=strip(source),old143=strip(read('202610050143_merchant_attendance_pin_schedule.sql'));
const old137=strip(read('202610050137_merchant_attendance_self_schedule.sql'));
const fn=(name,text=clean)=>{const start=text.indexOf(`create or replace function public.${name}(`);assert(start>=0,name);return text.slice(start,text.indexOf('$$;',start)+3);};
const contains=(text,...parts)=>{for(const part of parts)assert(text.includes(part),part);};
const ordered=(text,...parts)=>{let at=-1;for(const part of parts){const next=text.indexOf(part,at+1);assert(next>at,part);at=next;}};
const receipt='faolla_attendance_self_schedule_receipt_v1',common='faolla_attendance_shift_plan_adoption_v1',
  guard='faolla_attendance_shift_plan_adoption_guard_v1',rpc='faolla_attendance_self_schedule_adoption_v1';
const body=fn(rpc),proof=fn(receipt),table='merchant_attendance_shift_plan_adoptions';

test('144 adds only self proof/RPC and replaces the two shared helpers; old clocks/readers and storage stay unchanged',()=>{
  assert.deepEqual(validateMigrationSource(file,source),[]);
  assert.deepEqual([...clean.matchAll(/create or replace function public\.(\w+)/g)].map(x=>x[1]),[receipt,common,guard,rpc]);
  assert.deepEqual([...clean.matchAll(/insert into public\.(\w+)/g)].map(x=>x[1]),[table,'faolla_schema_migrations']);
  assert.doesNotMatch(clean,/create\s+(?:table|index)|update\s+public\.|delete\s+from|drop\s+(?:table|function|index)/i);
  assert.deepEqual([...new Set([...clean.matchAll(/alter table public\.(\w+)/g)].map(x=>x[1]))],[table]);
});

test('three transactions validate four-channel replacement before dropping the exact validated143 CHECK',()=>{
  assert.equal((clean.match(/^begin;/gm)||[]).length,3);assert.equal((clean.match(/^commit;/gm)||[]).length,3);
  assert.equal((clean.match(/set local lock_timeout='3s';/g)||[]).length,3);
  ordered(clean,"add constraint attendance_shift_plan_adoptions_channels_v4 check(channel in('location','onsite','pin','self')) not valid",'commit;',
    'validate constraint attendance_shift_plan_adoptions_channels_v4','commit;',
    'drop constraint attendance_shift_plan_adoptions_channels_v3',`create or replace function public.${receipt}`,
    "values(202610050144,'merchant_attendance_self_schedule_adoption')",'commit;');
  assert.equal((clean.match(/drop constraint /g)||[]).length,1);
  assert.doesNotMatch(clean,/statement_timeout|lock\s+table|session_replication_role|disable trigger/);
});

test('registry/ABI/catalog checks allow correct partial installation only; no unassigned record alias collision',()=>{
  contains(clean,"202610020111::bigint,'merchant_attendance_self_clock_identity'","202610050137::bigint,'merchant_attendance_self_schedule'",
    "202610050143::bigint,'merchant_attendance_pin_schedule'",'installed<>(to_regprocedure(p) is not null)',
    "name<>'merchant_attendance_self_schedule_adoption'","on conflict(version) do nothing",
    "c.expr<>'(channel=ANY(ARRAY[''location''::text,''onsite''::text,''pin''::text]))'",
    "c.expr<>'(channel=ANY(ARRAY[''location''::text,''onsite''::text,''pin''::text,''self''::text]))'",
    'not c.convalidated','c.connoinherit','c.conkey is distinct from array[','installed and (c.oid is null or not c.convalidated)',
    'declare old_constraint record;','expr into old_constraint from pg_constraint x');
  for(const match of clean.matchAll(/do \$(\w+)\$([\s\S]*?)\$\1\$;/g)){
    const block=match[2],declaration=block.slice(0,block.indexOf('begin'));
    for(const variable of declaration.matchAll(/\b(\w+)\s+record\b/g))
      assert.doesNotMatch(block,new RegExp('\\b(?:from|join)\\s+[\\w.]+\\s+(?:as\\s+)?'+variable[1]+'\\b','i'));
  }
});

test('RPC exactly preserves137 arguments, onlyclock-in command schema and independent binding opt-in',()=>{
  contains(body,'p_site_id text,p_auth_user_id uuid,p_command jsonb default null',
    'p_selection jsonb default null,p_operation_id uuid default null,p_allow_write boolean default false,p_bind_rules boolean default false',
    "array['operationId','locationId','action','expectedSequence','expectedWorkerId']","p_command->>'action' is distinct from 'clock_in'",
    "selected,array['slotId','revision']","selected->'revision','version'");
  ordered(body,'if p_command is null then',"if not p_allow_write then raise exception 'attendance_self_schedule_adoption_disabled'",
    'base:=public.faolla_attendance_self_schedule_v1');
  assert.doesNotMatch(body,/p_expected_employee|p_current_owner|p_approval_id|p_source|p_command\s*:=/);
});

test('exactly one137 call keeps original locks and mandatory failures atomic, without PIN-style exception handling',()=>{
  assert.equal((body.match(/public\.faolla_attendance_self_schedule_v1\(/g)||[]).length,1);
  contains(body,'base:=public.faolla_attendance_self_schedule_v1(p_site_id,p_auth_user_id,p_command,p_selection,p_operation_id,',
    'case when p_command is null and p_operation_id is not null then false else p_allow_write end,p_bind_rules)');
  assert.doesNotMatch(body,/exception\s+when|for update|for share|pg_advisory|from public\.merchants|faolla_attendance_plan_rule_approvals_v1\(/);
  const self=read('202610020111_merchant_attendance_self_clock_identity.sql');
  ordered(self,'from public.merchant_attendance_settings where merchant_id=p_site_id for share',
    'where merchant_id=p_site_id and auth_user_id=p_auth_user_id for share',
    'where merchant_id=p_site_id and employee_id=v_employee.id for update','insert into public.merchant_attendance_events');
  contains(fn('faolla_attendance_self_schedule_v1',old137),'if p_bind_rules then clock_result:=public.faolla_attendance_self_bound_v1',
    "if not p_allow_write then raise exception 'attendance_self_schedule_disabled'");
});

test('self requires exact immutable relation/event and current dual identity, never an inferred login from web source',()=>{
  contains(proof,'w.employee_id is distinct from p.employee_id','e.auth_user_id is distinct from p_auth','p.employee_auth_user_id is distinct from p_auth',
    "ev.action<>'clock_in' or ev.occurred_at<>ev.received_at","date_trunc('milliseconds',ev.occurred_at)<>ev.occurred_at",
    'row(ev.merchant_id,ev.worker_id,ev.operation_id,ev.sequence,ev.location_id,ev.occurred_at,ev.time_zone,ev.actor_employee_id)',
    "p.binding_policy<>'employee-explicit-clock-in-v1' or not isfinite(p.recorded_at)");
  assert.doesNotMatch(proof,/p_verified|request_auth_user_id|clock_timestamp|at time zone|recorded_at\s*[<>]/);
});

test('both GET and POST exclude every existing nonself channel before adoption, including sidecar-only conflicts',()=>{
  for(const part of [proof,body]){
    contains(part,"ev.source<>'web'",'merchant_attendance_location_clock_notices where event_id=ev.id',
      'merchant_attendance_location_results where event_id=ev.id','merchant_attendance_onsite_receipts where event_id=ev.id',
      'merchant_attendance_pin_clock_receipts where event_id=ev.id',"raise exception 'attendance_operation_conflict'");
  }
  contains(proof,"start_event_id=ev.id and channel<>'self'");
  contains(body,"if proof.start_event_id is not null and proof.channel<>'self' then raise exception 'attendance_operation_conflict'");
  ordered(body,"if clock_result->'receipt'<>'null'::jsonb then","if ev.source<>'web'",'if p_command is not null and p_command is distinct from');
});

test('new replay binds all five command values, especially expectedSequence omitted by old111 replay',()=>{
  contains(body,"p_command is distinct from jsonb_build_object('operationId',ev.operation_id,'locationId',ev.location_id,",
    "'action',ev.action,'expectedSequence',ev.sequence-1,'expectedWorkerId',ev.worker_id)",
    "saved.selection is distinct from selected and p_command is not null then raise exception 'attendance_operation_conflict'");
  const self=strip(read('202610020111_merchant_attendance_self_clock_identity.sql'));
  const replay=self.slice(self.indexOf('if v_receipt.id is not null then'),self.indexOf('v_replayed := true;'));
  contains(replay,'v_receipt.action<>v_action or v_receipt.location_id<>v_location_id');
  assert.doesNotMatch(replay,/v_expected|expectedSequence/);
});

test('only fresh137 clock-in can create one mandatory sidecar; legacy GET retains old relation with null adoption',()=>{
  ordered(body,"fresh:=p_command is not null and clock_result->'replayed'='false'::jsonb",'if fresh then',
    "saved,p_auth_user_id,null,true,'self'",`insert into public.${table}`);
  contains(body,"adoption jsonb:=null","if proof.start_event_id is not null then",
    "saved,p_auth_user_id,proof.approval_operation_id,false,'self'",'if proof.adoption is distinct from adoption',
    'if fresh and (saved.start_event_id is null or proof.start_event_id is null or adoption is null)',
    'if p_command is not null and (saved.start_event_id is null or proof.start_event_id is null or adoption is null)',
    "'association',base->'association','adoption',adoption");
  assert.equal((body.match(/insert into public\./g)||[]).length,1);
});

test('bounded historical publication/cancellation checks preserve saved outside-window outcome without current tz reinterpretation',()=>{
  contains(proof,'from public.merchant_attendance_schedule_slots where merchant_id=p.merchant_id and id=p.slot_id',
    "context:=public.faolla_attendance_self_schedule_slot_v1(slot)",
    "(p.slot_snapshot-'cancelled') is distinct from ((context->'slot')-'cancelled')",
    "p.publication_snapshot is distinct from nullif(context->'publication','null'::jsonb)",
    "p.cancellation_snapshot is distinct from current_cancellation","(current_cancellation->>'revision')::bigint>p.schedule_revision",
    "current_cancelled and (current_cancellation->>'revision')::bigint<=p.schedule_revision",
    "when p.reason='outside_window' then 'outside_window'");
  assert.doesNotMatch(proof,/order by|generate_series|date_trunc\('day'|at time zone|faolla_attendance_rule_sources_v1/);
  assert.deepEqual([...clean.matchAll(/->\s*'[^']+'\s*(?:-(?!>)|[+*/])/g)].map(x=>x[0]),[]);
});

test('143 location onsite and PIN adoption semantics are text-equivalent after removing only self dispatch',()=>{
  const normalized=fn(common).replace("p_channel not in('location','onsite','pin','self')","p_channel not in('location','onsite','pin')")
    .replace("when p_channel='pin' then 'attendance_pin_schedule_invalid' else 'attendance_self_schedule_adoption_invalid'","else 'attendance_pin_schedule_invalid'")
    .replace("elsif p_channel='pin' then perform public.faolla_attendance_pin_schedule_receipt_v1(p,p_auth);\n  else perform public.faolla_attendance_self_schedule_receipt_v1(p,p_auth);end if;",
      "else perform public.faolla_attendance_pin_schedule_receipt_v1(p,p_auth);end if;");
  assert.equal(compact(normalized),compact(fn(common,old143)));
  const normalizedGuard=fn(guard).replace("when new.channel='self' then 'attendance_self_schedule_adoption_invalid' ",'')
    .replace("new.channel not in('location','onsite','pin','self')","new.channel not in('location','onsite','pin')");
  assert.equal(compact(normalizedGuard),compact(fn(guard,old143)));
});

test('140 saved approval source verification and fixed original reference remain shared, not reselected on recovery',()=>{
  const c=fn(common);
  contains(c,'if p_current then','elsif target is not null then',
    "f.source_sha256 is distinct from encode(sha256(convert_to(f.source::text,'UTF8')),'hex')",
    "f.source_bytes is distinct from octet_length(convert_to(f.source::text,'UTF8'))",
    "public.faolla_attendance_plan_rule_source_v1(f.source) is distinct from true",
    "'policy','explicit-plan-approval-at-clock-in-v1'");
  const ref=c.slice(c.indexOf("state_name:='adopted'"));
  assert.doesNotMatch(ref,/'source',|'command',|sourceText|secret|verifier|salt|token/);
});

test('output preserves original clock/choices/association, bounds total64KiB, recovery suppresses candidate enumeration',()=>{
  contains(body,"array['protocol','clock','choices','association']","base->>'protocol' is distinct from 'self-schedule-v1'",
    "'protocol','self-schedule-adoption-v1','clock',clock_result,'choices',base->'choices','association',base->'association','adoption',adoption",
    "octet_length(convert_to(result::text,'UTF8'))>65536");
  const old=fn('faolla_attendance_self_schedule_v1',old137);
  contains(old,'order by x.work_date,x.start_at,x.id limit 101','limited:=cardinality(candidates)>100',
    "octet_length(convert_to(choices::text,'UTF8'))>48000");
  assert.doesNotMatch(body,/candidates:=|jsonb_agg|array_agg|select \* into.*plan_rule_operations/);
});

test('private helpers/table stay denied, existing append-only triggers and all channel public ACLs are checked',()=>{
  contains(clean,'relrowsecurity','pg_policy','t.tgfoid=fn::oid and t.tgtype=kind',"t.tgenabled in('O','A')",'t.tgqual is null and t.tgnargs=0',
    'aclexplode(c.attacl)',"pg_has_role(r,a.grantee,'USAGE')","a.grantee=0 and a.privilege_type='EXECUTE'",
    "'public.faolla_attendance_self_schedule_v1(text,uuid,jsonb,jsonb,uuid,boolean,boolean)'",
    "'public.faolla_attendance_pin_schedule_v1(text,uuid,text,text,uuid,boolean,jsonb,boolean,jsonb,boolean,boolean)'",
    "'public.faolla_attendance_onsite_schedule_v1(text,uuid,jsonb,jsonb,uuid,boolean,jsonb,boolean,boolean)'");
  assert.equal((clean.match(/grant execute/g)||[]).length,1);
  contains(clean,`grant execute on function public.${rpc}(text,uuid,jsonb,jsonb,uuid,boolean,boolean) to service_role`);
  assert.doesNotMatch(clean,/create policy|grant\s+(?:all|select|insert|update)/i);
});

