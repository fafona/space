// Static source contracts only; actual PostgreSQL/lease races are root-owned.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';
const file='202610050143_merchant_attendance_pin_schedule.sql';
const read=name=>readFileSync(new URL(`./supabase-migrations/${name}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const strip=text=>text.replace(/--[^\n]*/g,'');
const source=read(file),clean=strip(source),compact=text=>text.replace(/\s+/g,' ').trim();
const fn=(name,text=clean)=>{const at=text.indexOf(`create or replace function public.${name}(`);assert(at>=0,name);return text.slice(at,text.indexOf('$$;',at)+3);};
const contains=(text,...parts)=>{for(const part of parts)assert(text.includes(part),part);};
const ordered=(text,...parts)=>{let at=-1;for(const part of parts){const next=text.indexOf(part,at+1);assert(next>at,part);at=next;}};
const between=(text,start,end)=>{const at=text.indexOf(start);assert(at>=0,start);const stop=text.indexOf(end,at);assert(stop>at,end);return text.slice(at,stop);};
const original=strip(read('202610020112_merchant_attendance_pin_clock_identity.sql'));
const prior=strip(read('202610050142_merchant_attendance_onsite_schedule.sql'));
const old137=strip(read('202610050137_merchant_attendance_self_schedule.sql'));
const old138=strip(read('202610050138_merchant_attendance_shift_check.sql'));
const rpc='faolla_attendance_pin_schedule_v1',receipt='faolla_attendance_pin_schedule_receipt_v1',
  common='faolla_attendance_shift_plan_adoption_v1',guard='faolla_attendance_shift_plan_adoption_guard_v1',
  relation='faolla_attendance_self_schedule_guard_v1',reader='faolla_attendance_shift_check_v1';
const body=fn(rpc),oldBody=fn('faolla_attendance_pin_clock_v1',original);

test('143 adds only two functions and extends exactly four approved definitions with no new tables or old PIN RPC replacement',()=>{
  assert.deepEqual(validateMigrationSource(file,source),[]);
  assert.deepEqual([...clean.matchAll(/create or replace function public\.(\w+)/g)].map(x=>x[1]),[receipt,common,guard,relation,reader,rpc]);
  assert.doesNotMatch(clean,/create\s+(?:table|index)|update\s+public\.|delete\s+from|drop\s+(?:table|function|index)/i);
  assert.deepEqual([...new Set([...clean.matchAll(/alter table public\.(\w+)/g)].map(x=>x[1]))],['merchant_attendance_shift_plan_adoptions']);
  assert.deepEqual([...clean.matchAll(/insert into public\.(\w+)/g)].map(x=>x[1]),
    ['merchant_attendance_events','merchant_attendance_pin_clock_receipts','merchant_attendance_shift_schedule_relations','merchant_attendance_shift_plan_adoptions','faolla_schema_migrations']);
});

test('three committed constraint stages keep validated142 CHECK until atomic helpers and registry cutover',()=>{
  assert.equal((clean.match(/^begin;/gm)||[]).length,3);assert.equal((clean.match(/^commit;/gm)||[]).length,3);
  assert.equal((clean.match(/set local lock_timeout='3s';/g)||[]).length,3);
  ordered(clean,"add constraint attendance_shift_plan_adoptions_channels_v3 check(channel in('location','onsite','pin')) not valid",'commit;',
    'validate constraint attendance_shift_plan_adoptions_channels_v3','commit;',
    'drop constraint attendance_shift_plan_adoptions_channels_v2',`create or replace function public.${receipt}`,
    "values(202610050143,'merchant_attendance_pin_schedule')",'commit;');
  assert.doesNotMatch(clean,/statement_timeout|lock\s+table|session_replication_role|disable trigger/);
});

test('exact catalog and prerequisite checks allow only owned correct partial installs without automatic repair',()=>{
  contains(clean,"202610020112::bigint,'merchant_attendance_pin_clock_identity'","202610050138::bigint,'merchant_attendance_shift_check'",
    "202610050142::bigint,'merchant_attendance_onsite_schedule'","installed<>(to_regprocedure(p) is not null)",
    "name<>'merchant_attendance_pin_schedule'","on conflict(version) do nothing",
    "c.expr<>'(channel=ANY(ARRAY[''location''::text,''onsite''::text]))'",
    "c.expr<>'(channel=ANY(ARRAY[''location''::text,''onsite''::text,''pin''::text]))'",
    'not c.convalidated','c.connoinherit','c.conkey is distinct from array[','installed and (c.oid is null or not c.convalidated)');
  assert.equal((clean.match(/drop constraint /g)||[]).length,1);
  assert.equal((clean.match(/and c\.contype='c' and c\.convalidated and not c\.connoinherit/g)||[]).length,3);
});

test('cutover catalog aliases never shadow an unassigned PLpgSQL record variable',()=>{
  const cutover=between(clean,'do $pin_schedule_cutover$','$pin_schedule_cutover$;');
  contains(cutover,'declare old_constraint record;','from pg_constraint c where c.conrelid=',
    'expr into old_constraint from pg_constraint x','if old_constraint.oid is not null then',
    'attrelid=old_constraint.conrelid');
  assert.doesNotMatch(cutover,/\bc record\b|\binto c\b/);
  for(const match of clean.matchAll(/do \$(\w+)\$([\s\S]*?)\$\1\$;/g)){
    const block=match[2],declaration=block.slice(0,block.indexOf('begin'));
    for(const variable of declaration.matchAll(/\b(\w+)\s+record\b/g)){
      assert.doesNotMatch(block,new RegExp('\\b(?:from|join)\\s+[\\w.]+\\s+(?:as\\s+)?'+variable[1]+'\\b','i'));
    }
  }
});

test('original112 exact input schema and finish authentication remain intact with new command-only selection checks',()=>{
  assert.equal(compact(between(body,'  if p_request is null','  if c is null then')),
    compact(between(oldBody,'  if p_request is null','  select lease_expires')));
  assert.equal(compact(between(body,'  select lease_expires','  begin\n')),
    compact(between(oldBody,'  select lease_expires','  begin\n')));
  contains(body,'p_site text,p_terminal uuid,p_secret_hash text,p_no text,p_lease uuid,p_verified boolean,p_request jsonb,p_allow_new boolean',
    'p_selection jsonb default null,p_allow_schedule boolean default false,p_bind_rules boolean default false',
    "if c->>'action'<>'clock_in'","selected,array['slotId','revision']",'if selected is not null then raise exception');
});

test('full original112 business validation state transitions and original receipt projection are preserved',()=>{
  assert.equal(compact(between(body,'    select * into s','    clock_result:=jsonb_build_object')),
    compact(between(oldBody,'    select * into s',"    return jsonb_build_object('siteId'")));
  assert.equal(compact(between(body,"    clock_result:=jsonb_build_object('siteId'",'    select * into e').replace('clock_result:=','return ')),
    compact(between(oldBody,"    return jsonb_build_object('siteId'",'  exception when raise_exception')));
});

test('lease finish is outside business exception transaction; known new failures return JSON and unknown exceptions rethrow',()=>{
  ordered(body,'checked:=public.faolla_attendance_pin_finish_v1',
    "if checked->>'verified'<>'true' then return jsonb_build_object('error','attendance_pin_denied')",'  begin\n',
    "not p_allow_schedule then raise exception 'attendance_pin_schedule_disabled'",
    'insert into public.merchant_attendance_events','insert into public.merchant_attendance_pin_clock_receipts',
    'insert into public.merchant_attendance_shift_schedule_relations','insert into public.merchant_attendance_shift_plan_adoptions','exception when raise_exception then',
    "return jsonb_build_object('error',sqlerrm)",'raise;');
  assert.equal((body.match(/checked:=public\.faolla_attendance_pin_finish_v1/g)||[]).length,1);
  assert.doesNotMatch(body,/faolla_attendance_pin_clock_(?:v1|bound_v1)\(|when others|when check_violation|when query_canceled|pg_advisory/);
  contains(body,"'attendance_pin_schedule_disabled','attendance_pin_schedule_invalid'","'attendance_self_schedule_invalid','attendance_plan_rule_invalid','attendance_shift_rule_binding_invalid'");
  const oldErrors=between(oldBody,'if sqlerrm in (',') then').match(/'attendance_[a-z_]+'/g);
  for(const error of oldErrors)assert(body.includes(error),error);
});

test('old authentication still locks current membership and worker before data, re-dates lease after any lock wait',()=>{
  const credential=read('202610010106_merchant_attendance_pin_credentials.sql');
  ordered(credential,'from public.merchant_enterprise_employees where merchant_id=p_site and id=w.employee_id for share',
    'from public.merchant_enterprise_roles where merchant_id=p_site and id=e.role_id for share',
    'from public.merchant_attendance_workers where merchant_id=p_site and id=w.id for update');
  ordered(body,'checked:=public.faolla_attendance_pin_finish_v1',"now_at:=date_trunc('milliseconds',clock_timestamp())",'clock_timestamp()>=lease_until','insert into public.merchant_attendance_events');
  contains(body,"p_allow_new is distinct from true and action_now in ('clock_in','break_start')","reason is null and coalesce(p_allow_new,false)");
  assert.doesNotMatch(body,/for update|from public\.merchants|faolla_attendance_plan_rule_approvals_v1\(/);
});

test('PIN proof binds a real107 immutable receipt rather than trusting kiosk or a browser verified claim',()=>{
  const r=fn(receipt);
  contains(r,'from public.merchant_attendance_pin_clock_receipts where event_id=p.start_event_id',
    "ev.action<>'clock_in' or ev.source<>'kiosk' or ev.occurred_at<>ev.received_at",
    'e.auth_user_id is distinct from p_auth','p.employee_auth_user_id is distinct from p_auth',
    "q.command->'expectedSequence' is distinct from to_jsonb(p.sequence-1)",
    "q.command->>'expectedWorkerId' is distinct from p.worker_id::text","q.command->>'expectedEmployeeId' is distinct from p.employee_id::text",
    'merchant_attendance_location_clock_notices','merchant_attendance_location_results','merchant_attendance_onsite_receipts');
  assert.doesNotMatch(r,/p_verified|lease|credential|device_expires|clock_timestamp/);
});

test('137 insert guard preserves every web check and adds only receipt-proven kiosk acceptance',()=>{
  const normalized=fn(relation).replace("ev.source not in('web','kiosk')","ev.source<>'web'")
    .replace("  if ev.source='kiosk' then perform public.faolla_attendance_pin_schedule_receipt_v1(new,new.employee_auth_user_id);end if;\n",'');
  assert.equal(compact(normalized),compact(fn(relation,old137)));
});

test('138 downstream reader preserves old owner locks event completeness correction and relation logic, adds only proof-proven kiosk',()=>{
  const normalized=fn(reader).replace("first_event.source not in('web','kiosk')","first_event.source<>'web'")
    .replace("    if first_event.source='kiosk' then perform public.faolla_attendance_pin_schedule_receipt_v1(saved,member_auth);end if;\n",'');
  assert.equal(compact(normalized),compact(fn(reader,old138)));
});

test('142 common helper and guard retain location/onsite branches exactly while adding PIN dispatch',()=>{
  const normalized=fn(common).replace("p_channel not in('location','onsite','pin')","p_channel not in('location','onsite')")
    .replace("when p_channel='onsite' then 'attendance_onsite_schedule_invalid' else 'attendance_pin_schedule_invalid'","else 'attendance_onsite_schedule_invalid'")
    .replace("elsif p_channel='onsite' then perform public.faolla_attendance_onsite_schedule_receipt_v1(p,p_auth);\n  else perform public.faolla_attendance_pin_schedule_receipt_v1(p,p_auth);end if;",
      "else perform public.faolla_attendance_onsite_schedule_receipt_v1(p,p_auth);end if;");
  assert.equal(compact(normalized),compact(fn(common,prior)));
  const normalizedGuard=fn(guard).replace("when new.channel='pin' then 'attendance_pin_schedule_invalid' ",'')
    .replace("new.channel not in('location','onsite','pin')","new.channel not in('location','onsite')");
  assert.equal(compact(normalizedGuard),compact(fn(guard,prior)));
});

test('fresh optional133 binding and mandatory relation/adoption share the business subtransaction, no owner impersonation',()=>{
  ordered(body,'member_auth:=e.auth_user_id','if c is not null and not replayed and p_bind_rules',
    "public.faolla_attendance_bind_shift_rules_v1(receipt.id,'pin',null)",
    'select * into saved from public.merchant_attendance_shift_schedule_relations',
    "elsif c is not null and clock_result->'replayed'='false'::jsonb then",
    'insert into public.merchant_attendance_shift_schedule_relations','insert into public.merchant_attendance_shift_plan_adoptions','exception when raise_exception');
  contains(body,"clock_timestamp(),'employee-explicit-clock-in-v1'","saved,member_auth,null,true,'pin'","saved,member_auth,proof.approval_operation_id,false,'pin'",
    "saved.selection is distinct from selected then raise exception 'attendance_operation_conflict'",
    "if c is not null and proof.start_event_id is null then raise exception 'attendance_operation_conflict'");
  assert.doesNotMatch(body,/'e-explicit-clock-in-v1'|request_auth_user_id|p_auth_user_id/);
});

test('candidates require authenticated no-operation state and use bounded terminal/default location scope; oversize means limited empty',()=>{
  contains(body,"if c is null and op is null and p_allow_schedule and clock_result->'canStart'='true'::jsonb and status_now='off'",
    'zone:=l.time_zone','order by x.work_date,x.start_at,x.id limit 101','limited:=cardinality(candidates)>100',
    'if slot.employee_id<>e.id or slot.location_id<>l.id then continue;end if;',
    "context->'publication'->>'employeeAuthUserId'<>member_auth::text","octet_length(convert_to(choices::text,'UTF8'))>48000",
    "'limited',true,'entries','[]'::jsonb","octet_length(convert_to(result::text,'UTF8'))>65536");
});

test('wire excludes PIN authentication secrets and rule bodies, preserving explicit null legacy sidecars and cancellation chronology',()=>{
  contains(body,"'protocol','pin-schedule-v1','clock',clock_result,'choices',choices,'association',association,'adoption',adoption",
    "when saved.reason='outside_window' then 'outside_window'",'saved.cancellation_snapshot is distinct from current_cancellation',
    "(saved.slot_snapshot-'cancelled') is distinct from ((context->'slot')-'cancelled')",'if proof.adoption is distinct from adoption');
  const ref=fn(common).slice(fn(common).indexOf("state_name:='adopted'"));
  assert.doesNotMatch(ref,/'source',|'command',|token|nonce|claims|signature|sourceText|lease|secret|verifier|salt/);
  assert.deepEqual([...clean.matchAll(/->\s*'[^']+'\s*(?:-(?!>)|[+*/])/g)].map(x=>x[0]),[]);
});

test('private helpers and both tables remain inaccessible, six existing trigger bindings and old public ACLs are verified',()=>{
  contains(clean,'relrowsecurity','pg_policy','t.tgfoid=fn::oid and t.tgtype=kind',"t.tgenabled in('O','A')",'t.tgqual is null and t.tgnargs=0',
    'aclexplode(c.attacl)',"pg_has_role(r,a.grantee,'USAGE')","a.grantee=0 and a.privilege_type='EXECUTE'",
    "'public.faolla_attendance_pin_clock_v1(text,uuid,text,text,uuid,boolean,jsonb,boolean)'",
    "'public.faolla_attendance_pin_clock_bound_v1(text,uuid,text,text,uuid,boolean,jsonb,boolean)'",
    "'public.faolla_attendance_onsite_schedule_v1(text,uuid,jsonb,jsonb,uuid,boolean,jsonb,boolean,boolean)'");
  assert.equal((clean.match(/grant execute/g)||[]).length,2);
  assert.equal((clean.match(/'public\.faolla_attendance_events_append_only_v1\(\)'::regprocedure/g)||[]).length,4);
  assert.doesNotMatch(clean,/create policy|grant\s+(?:all|select|insert|update)/i);
});
