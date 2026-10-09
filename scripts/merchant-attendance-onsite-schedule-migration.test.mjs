// Static source contracts only, not PostgreSQL or concurrency proof.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const file='202610050142_merchant_attendance_onsite_schedule.sql';
const read=name=>readFileSync(new URL(`./supabase-migrations/${name}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const source=read(file),clean=source.replace(/--[^\n]*/g,'');
const old=read('202610050141_merchant_attendance_location_schedule.sql').replace(/--[^\n]*/g,'');
const fn=(name,text=clean)=>{const at=text.indexOf(`create or replace function public.${name}(`);assert(at>=0,name);return text.slice(at,text.indexOf('$$;',at)+3);};
const contains=(text,...parts)=>{for(const part of parts)assert(text.includes(part),part);};
const ordered=(text,...parts)=>{let at=-1;for(const part of parts){const next=text.indexOf(part,at+1);assert(next>at,part);at=next;}};
const receipt='faolla_attendance_onsite_schedule_receipt_v1',common='faolla_attendance_shift_plan_adoption_v1';
const location='faolla_attendance_location_plan_adoption_v1',guard='faolla_attendance_shift_plan_adoption_guard_v1',rpc='faolla_attendance_onsite_schedule_v1';
const table='merchant_attendance_shift_plan_adoptions';

test('142 adds no table/index or historical writer replacement; only two approved private141 definitions change',()=>{
  assert.deepEqual(validateMigrationSource(file,source),[]);
  assert.deepEqual([...clean.matchAll(/create or replace function public\.(\w+)/g)].map(x=>x[1]),[receipt,common,location,guard,rpc]);
  assert.deepEqual([...clean.matchAll(/insert into public\.(\w+)/g)].map(x=>x[1]),['merchant_attendance_shift_schedule_relations',table,'faolla_schema_migrations']);
  assert.doesNotMatch(clean,/create\s+(?:table|index)|update\s+public\.|delete\s+from|drop\s+(?:table|function|index)/i);
  assert.deepEqual([...new Set([...clean.matchAll(/alter table public\.(\w+)/g)].map(x=>x[1]))],[table]);
});

test('three separate transactions validate the wider CHECK before dropping the old one; every stage retains3s lock timeout',()=>{
  assert.equal((clean.match(/^begin;/gm)||[]).length,3);assert.equal((clean.match(/^commit;/gm)||[]).length,3);
  assert.equal((clean.match(/set local lock_timeout='3s';/g)||[]).length,3);
  ordered(clean,'add constraint attendance_shift_plan_adoptions_channels_v2',"check(channel in('location','onsite')) not valid",'commit;',
    'validate constraint attendance_shift_plan_adoptions_channels_v2','commit;',
    'drop constraint merchant_attendance_shift_plan_adoptions_channel_check',`create or replace function public.${receipt}`,
    "values(202610050142,'merchant_attendance_onsite_schedule')",'commit;');
  assert.doesNotMatch(clean,/statement_timeout|lock\s+table|session_replication_role|disable trigger/);
});

test('constraint catalog checks reject wrong expressions/columns/validation and permit only owned correct partial stages',()=>{
  contains(clean,"old_check.expr<>'(channel=''location''::text)'",'not old_check.convalidated','old_check.connoinherit',
    'old_check.conkey is distinct from array[',"wide_check.expr<>'(channel=ANY(ARRAY[''location''::text,''onsite''::text]))'",
    "installed and (wide_check.oid is null or not wide_check.convalidated)","if wide_check.oid is null then",
    'merchant_attendance_onsite_schedule_constraint_conflict');
  assert.equal((clean.match(/and [cx]\.convalidated and not [cx]\.connoinherit/g)||[]).length,3);
  assert.equal((clean.match(/drop constraint /g)||[]).length,1);
});

test('exact registry and ABI prerequisites protect ownership and repeat installation without backfill',()=>{
  contains(clean,"202610010108::bigint,'merchant_attendance_onsite_qr'","202610040134::bigint,'merchant_attendance_bound_clocks'",
    "202610050137::bigint,'merchant_attendance_self_schedule'","202610050140::bigint,'merchant_attendance_plan_rule_approvals'",
    "202610050141::bigint,'merchant_attendance_location_schedule'",'installed<>(to_regprocedure(p) is not null)',
    "name<>'merchant_attendance_onsite_schedule'","on conflict(version) do nothing");
});

test('new RPC retains original six onsite arguments plus independent opt-in selection/binding flags',()=>{
  const body=fn(rpc);
  contains(body,'p_site text,p_auth uuid,p_claims jsonb,p_command jsonb,p_operation uuid,p_allow_new boolean',
    'p_selection jsonb default null,p_allow_schedule boolean default false,p_bind_rules boolean default false',
    "p_command->>'action' is distinct from 'clock_in'","selected,array['slotId','revision']");
  assert.doesNotMatch(body,/safeFinish|p_assertion|p_expected_worker_id|p_require_clock|p_command\s*(?:-(?!>)|\|\|)|p_claims\s*:=/);
});

test('feature rollback rejects every POST;108/134 are called once without an exception transaction swallowing mandatory failure',()=>{
  const body=fn(rpc);
  ordered(body,'if p_command is null then',"if not p_allow_schedule then raise exception 'attendance_onsite_schedule_disabled'",'if p_bind_rules then clock_result:=');
  contains(body,'clock_result:=public.faolla_attendance_onsite_clock_bound_v1(p_site,p_auth,p_claims,p_command,p_operation,p_allow_new)',
    'clock_result:=public.faolla_attendance_onsite_clock_v1(p_site,p_auth,p_claims,p_command,p_operation,p_allow_new)');
  assert.equal((body.match(/clock_result\s*:=/g)||[]).length,2);
  assert.doesNotMatch(body,/exception\s+when|for update|pg_advisory|from public\.merchants|faolla_attendance_plan_rule_approvals_v1/);
});

test('old108 proves lock-wait expiry and atomic per-worker nonce use; no independent PIN-style consumption is introduced',()=>{
  const original=read('202610010108_merchant_attendance_onsite_qr.sql');
  ordered(original,'from public.merchants where id=p_site for share','merchant_attendance_settings where merchant_id=p_site for share',
    'where merchant_id=p_site and auth_user_id=p_auth for share','where merchant_id=p_site and employee_id=e.id for update',
    "now_at:=date_trunc('milliseconds',clock_timestamp())",'if now_ms>=expires_ms',"then raise exception 'attendance_qr_used'",'insert into public.merchant_attendance_events','insert into public.merchant_attendance_onsite_receipts');
  contains(original,'unique(merchant_id,worker_id,nonce)',"or (p_command is not null and binding.command<>p_command)","receipt.source<>'web'");
  assert.doesNotMatch(fn(rpc),/insert into public\.merchant_attendance_onsite_receipts|lease|nonce_now|terminal_secret|hmac/i);
});

test('shared common location branch is semantically identical to141 after extracting channel dispatch',()=>{
  let normalized=fn(common).replace(`public.${common}(`,`public.${location}(`)
    .replace('p_approval_id uuid,p_current boolean,p_channel text)','p_approval_id uuid,p_current boolean)')
    .replace('invalid_code text;fmt constant text:=','fmt constant text:=')
    .replace("  if p_channel is null or p_channel not in('location','onsite') then raise exception 'attendance_onsite_schedule_invalid';end if;\n",'')
    .replace("  invalid_code:=case when p_channel='location' then 'attendance_location_schedule_invalid' else 'attendance_onsite_schedule_invalid' end;\n",'')
    .replace("if p_channel='location' then perform public.faolla_attendance_location_schedule_receipt_v1(p,p_auth);\n  else perform public.faolla_attendance_onsite_schedule_receipt_v1(p,p_auth);end if;",'perform public.faolla_attendance_location_schedule_receipt_v1(p,p_auth);')
    .replaceAll("raise exception '%',invalid_code","raise exception 'attendance_location_schedule_invalid'")
    .replace("'channel',p_channel","'channel','location'");
  const compact=text=>text.replace(/\s+/g,' ').trim();
  assert.equal(compact(normalized),compact(fn(location,old)));
  contains(fn(location),`return public.${common}(p,p_auth,p_approval_id,p_current,'location')`);
});

test('onsite private proof binds current identity and exact immutable event/QR command/claims, excluding other channel receipts',()=>{
  const body=fn(receipt);
  contains(body,'e.auth_user_id is distinct from p_auth','p.employee_auth_user_id is distinct from p_auth',
    "ev.action<>'clock_in' or ev.source<>'web' or ev.occurred_at<>ev.received_at",
    "q.command->'expectedSequence' is distinct from to_jsonb(p.sequence-1)","q.command->>'expectedWorkerId' is distinct from p.worker_id::text",
    "q.command->>'expectedEmployeeId' is distinct from p.employee_id::text","q.claims->>'terminalId' is distinct from q.terminal_id::text",
    "q.claims->>'nonce' is distinct from q.nonce::text","jsonb_typeof(q.claims->'siteId') is distinct from 'string'",
    'expires-issued<>45000 or event_ms<issued or event_ms>=expires','merchant_attendance_location_results where event_id=ev.id',
    'merchant_attendance_pin_clock_receipts where event_id=ev.id');
  assert.doesNotMatch(body,/clock_timestamp|device_expires|from public\.merchant_attendance_terminals|q\.(?:worker_version|settings_version|location_version)/);
});

test('fresh relation and sidecar are both mandatory; existing no-sidecar POST conflicts and GET never backfills',()=>{
  const body=fn(rpc);
  ordered(body,'select * into saved from public.merchant_attendance_shift_schedule_relations',
    "saved.selection is distinct from selected then raise exception 'attendance_operation_conflict'",
    "elsif p_command is not null and clock_result->'replayed'='false'::jsonb then",'fresh:=true;',
    'insert into public.merchant_attendance_shift_schedule_relations',`insert into public.${table}`);
  contains(body,"if p_command is not null and proof.start_event_id is null then raise exception 'attendance_operation_conflict'",
    'if fresh and (association is null or adoption is null)',"p_auth,'onsite',saved.slot_id",'proof.approval_operation_id,false,\'onsite\'');
});

test('shared guard validates exact channel-aware adoption and preserves location error semantics',()=>{
  const body=fn(guard);
  contains(body,"case when new.channel='onsite' then 'attendance_onsite_schedule_invalid' else 'attendance_location_schedule_invalid' end",
    "new.channel not in('location','onsite')",`public.${common}(rel,new.employee_auth_user_id,null,true,new.channel)`,
    'new.adoption is distinct from expected',"new.approval_operation_id::text is distinct from expected->'approval'->>'operationId'");
});

test('candidate GET is bounded current-default location only; no receipt recovery list and no QR-validation claim',()=>{
  const body=fn(rpc);
  contains(body,'p_command is null and p_operation is null and p_allow_schedule and p_allow_new and settings.enabled and worker.active',
    'location.radius_meters is null',"'attendance.self.clock'=any(role_row.permissions)","clock_result->'state'->>'status'='off'",
    'merchant_attendance_employment_periods','order by x.work_date,x.start_at,x.id limit 101','limited:=cardinality(candidates)>100',
    'if slot.employee_id<>employee.id or slot.location_id<>location.id then continue;end if;',"octet_length(convert_to(choices::text,'UTF8'))>48000");
  const candidates=body.slice(body.indexOf('if p_command is null and p_operation is null'));
  assert.doesNotMatch(candidates,/p_claims|nonce|paired_at|terminal_snapshot/);
});

test('replay preserves historical reasons/cancellation/reference without reselecting or returning tokens/source body',()=>{
  const body=fn(rpc);
  contains(body,"when saved.reason='outside_window' then 'outside_window'",'saved.cancellation_snapshot is distinct from current_cancellation',
    "(saved.slot_snapshot-'cancelled') is distinct from ((context->'slot')-'cancelled')",'if proof.adoption is distinct from adoption',
    "'protocol','onsite-schedule-v1','clock',clock_result,'choices',choices,'association',association,'adoption',adoption",
    "octet_length(convert_to(result::text,'UTF8'))>65536");
  assert.deepEqual([...clean.matchAll(/->\s*'[^']+'\s*(?:-(?!>)|[+*/])/g)].map(x=>x[0]),[]);
  const ref=fn(common).slice(fn(common).indexOf("state_name:='adopted'"));
  assert.doesNotMatch(ref,/'source',|'command',|token|nonce|claims|signature|sourceText/);
});

test('private helpers and shared table remain inaccessible, append guards validated, existing public location grant unchanged',()=>{
  contains(clean,'relrowsecurity','pg_policy','t.tgfoid=fn::oid and t.tgtype=kind',"t.tgenabled in('O','A')",'t.tgqual is null and t.tgnargs=0',
    'aclexplode(c.attacl)',"pg_has_role(r,a.grantee,'USAGE')","a.grantee=0 and a.privilege_type='EXECUTE'",
    "has_function_privilege(r,'public.faolla_attendance_location_schedule_v1(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean,jsonb,boolean,boolean)','EXECUTE')");
  assert.equal((clean.match(/grant execute/g)||[]).length,1);
  contains(clean,`grant execute on function public.${rpc}(text,uuid,jsonb,jsonb,uuid,boolean,jsonb,boolean,boolean) to service_role`);
  assert.doesNotMatch(clean,/create policy|grant\s+(?:all|select|insert|update)/i);
});
