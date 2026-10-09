// Static installation/protocol contracts only. Actual PostgreSQL, identities
// and concurrency belong to the separate root-owned local acceptance.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const filename='202610050141_merchant_attendance_location_schedule.sql';
const source=readFileSync(new URL(`./supabase-migrations/${filename}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const clean=source.replace(/--[^\n]*/g,'');
const table='merchant_attendance_shift_plan_adoptions',rpc='faolla_attendance_location_schedule_v1';
const receipt='faolla_attendance_location_schedule_receipt_v1',adoption='faolla_attendance_location_plan_adoption_v1',guard='faolla_attendance_shift_plan_adoption_guard_v1';
const signature='text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean,jsonb,boolean,boolean';
const fn=name=>{const start=clean.indexOf(`create or replace function public.${name}(`);assert(start>=0);return clean.slice(start,clean.indexOf('$$;',start)+3);};
const includes=(text,...parts)=>{for(const part of parts)assert(text.includes(part),part);};
const ordered=(text,...parts)=>{let at=-1;for(const part of parts){const next=text.indexOf(part,at+1);assert(next>at,part);at=next;}};
const old=name=>readFileSync(new URL(`./supabase-migrations/${name}`,import.meta.url),'utf8');

test('141 is additive: one compact sidecar and four new functions, old definitions/constraints/ACL untouched',()=>{
  assert.deepEqual(validateMigrationSource(filename,source),[]);
  assert.deepEqual([...clean.matchAll(/create table if not exists public\.(\w+)/g)].map(m=>m[1]),[table]);
  assert.deepEqual([...clean.matchAll(/create or replace function public\.(\w+)/g)].map(m=>m[1]),[receipt,adoption,guard,rpc]);
  assert.deepEqual([...clean.matchAll(/alter table public\.(\w+)/g)].map(m=>m[1]),[table]);
  assert.deepEqual([...clean.matchAll(/insert into public\.(\w+)/g)].map(m=>m[1]),['merchant_attendance_shift_schedule_relations',table,'faolla_schema_migrations']);
  assert.doesNotMatch(clean,/\b(?:drop|lock\s+table|update\s+public\.|delete\s+from|create\s+index)\b/i);
});

test('prerequisites and exact registry/object ownership reject partial and conflicting installations',()=>{
  includes(clean,"202610020113::bigint,'merchant_attendance_location_receipt_identity'","202610040134::bigint,'merchant_attendance_bound_clocks'",
    "202610050137::bigint,'merchant_attendance_self_schedule'","202610050140::bigint,'merchant_attendance_plan_rule_approvals'",
    `installed<>(to_regclass('public.${table}') is not null)`,'installed<>(to_regprocedure(p) is not null)',
    "name<>'merchant_attendance_location_schedule'","values(202610050141,'merchant_attendance_location_schedule') on conflict(version) do nothing",
    'attendance_schedule_worker_date_idx');
});

test('original eight location arguments plus selection and independent flags default off; only nonsafe clock-in writes',()=>{
  const body=fn(rpc);
  includes(body,'p_site_id text,p_auth_user_id uuid,p_expected_worker_id uuid,p_command jsonb default null,p_operation_id uuid default null',
    'p_assertion jsonb default null,p_allow_new_sessions boolean default false,p_require_clock boolean default false',
    'p_selection jsonb default null,p_allow_schedule boolean default false,p_bind_rules boolean default false',
    "p_command->>'action' is distinct from 'clock_in'","p_command->'safeFinish' is distinct from 'false'::jsonb",
    "selected,array['slotId','revision']","selected->'slotId','uuid'","selected->'revision','version'");
  assert.doesNotMatch(body,/p_command\s*(?:-(?!>)|\|\|)|p_command\s*:=|jsonb_set\(p_command/);
});

test('rollback blocks every POST and never falls back; only one original113 or134 branch is called',()=>{
  const body=fn(rpc);
  ordered(body,'if p_command is null then',"if not p_allow_schedule then raise exception 'attendance_location_schedule_disabled'",'if p_bind_rules then clock_result:=');
  includes(body,'clock_result:=public.faolla_attendance_location_clock_bound_v1(p_site_id,p_auth_user_id,p_expected_worker_id,p_command,p_operation_id,p_assertion,p_allow_new_sessions,p_require_clock)',
    'clock_result:=public.faolla_attendance_location_clock_v2(p_site_id,p_auth_user_id,p_expected_worker_id,p_command,p_operation_id,p_assertion,p_allow_new_sessions,p_require_clock)');
  assert.equal((body.match(/clock_result\s*:=/g)||[]).length,2);
  assert.doesNotMatch(body,/\bexception\s+when\b|for update|pg_advisory|from public\.merchants|faolla_attendance_plan_rule_approvals_v1/);
});

test('old worker UPDATE mutex excludes140 approval SHARE without an advisory or reverse merchant lock',()=>{
  const location=old('202610020113_merchant_attendance_location_receipt_identity.sql');
  ordered(location,'from public.merchants where id=p_site_id for share','merchant_attendance_settings where merchant_id=p_site_id for share',
    'where merchant_id=p_site_id and auth_user_id=p_auth_user_id for share','where merchant_id=p_site_id and employee_id=e.id for update');
  const approval=old('202610050140_merchant_attendance_plan_rule_approvals.sql');
  ordered(approval,'merchant_attendance_workers where merchant_id=site and id=wid for share',"if mode_name='approve' then perform pg_advisory_xact_lock",'insert into public.merchant_attendance_plan_rule_operations');
  assert.doesNotMatch(clean,/pg_advisory|faolla_attendance_plan_rule_approvals_v1\(/);
});

test('private collector proves original location channel, command, event and double identity; generic web is not sufficient',()=>{
  const body=fn(receipt);
  includes(body,'merchant_attendance_location_clock_notices where event_id=p.start_event_id','merchant_attendance_location_results where event_id=p.start_event_id',
    "ev.action<>'clock_in' or ev.source<>'web' or ev.occurred_at<>ev.received_at",'e.auth_user_id is distinct from p_auth',
    'p.employee_auth_user_id is distinct from p_auth','n.safe_finish is distinct from false or n.notice_revision is null',
    "n.command->'expectedSequence' is distinct from to_jsonb(p.sequence-1)","n.command->'noticeRevision' is distinct from to_jsonb(n.notice_revision)",
    'row(r.settings_version,r.worker_version,r.location_version) is distinct from row(p.settings_version,p.worker_version,p.location_version)');
  assert.doesNotMatch(body,/w\.version is distinct from p\.worker_version|s\.version is distinct from p\.settings_version/);
});

test('fresh relation and adoption are mandatory one transaction; old POST without sidecar conflicts and GET never backfills',()=>{
  const body=fn(rpc);
  ordered(body,'clock_result:=public.faolla_attendance_location_clock_v2','select * into saved from public.merchant_attendance_shift_schedule_relations',
    "saved.selection is distinct from selected then raise exception 'attendance_operation_conflict'",
    "elsif p_command is not null and clock_result->'replayed'='false'::jsonb then",'fresh:=true;',
    'insert into public.merchant_attendance_shift_schedule_relations',`insert into public.${table}`);
  includes(body,"if p_command is not null and proof.start_event_id is null then raise exception 'attendance_operation_conflict'",
    "if fresh and (association is null or adoption is null) then raise exception 'attendance_location_schedule_invalid'");
  assert.equal((body.match(new RegExp(`insert into public\\.${table}`,'g'))||[]).length,1);
  assert.doesNotMatch(body,/on conflict|\bexception\s+when\b/);
});

test('tenant/worker/historical employee/knownAuth mismatch rejects before business reasons',()=>{
  const body=fn(rpc);
  ordered(body,"id=(selected->>'slotId')::uuid",'slot.id is null or slot.worker_id is distinct from worker.id or slot.employee_id is distinct from employee.id',
    "slot.revision is distinct from (selected->>'revision')::bigint", "context->'publication'->>'employeeAuthUserId'<>p_auth_user_id::text",'reason_name:=case');
  includes(body,"then 'cancelled'","then 'location_changed'","then 'outside_window'","then 'publication_missing'",
    "status_name:='unselected';reason_name:=null;","when saved.reason='outside_window' then 'outside_window'");
});

test('adoption is current head only on insert and exact original immutable reference on recovery, never copied source or owner impersonation',()=>{
  const body=fn(adoption);
  ordered(body,'if p_current then','select * into stream from public.merchant_attendance_plan_rule_streams',
    'x.revision=stream.revision','elsif target is not null then','x.operation_id=target');
  includes(body,"state_name:='not_approved';why:='approval_missing'","state_name:='unselected'","state_name:='unverified';why:=p.reason",
    "state_name:='adopted'","'sourceSha256',f.source_sha256","'policy','explicit-plan-approval-at-clock-in-v1'");
  const projection=body.slice(body.indexOf("state_name:='adopted'"));
  assert.doesNotMatch(projection,/'source',|'command',|'actorId',|sourceText|reason',a\./);
  assert.doesNotMatch(body,/a\.recorded_at\s*[<>]=?\s*p\.occurred_at|p\.recorded_at\s*[<>]=?\s*p\.occurred_at|at time zone.*time_zone/);
});

test('adopted references verify original140 bytes/shape/identity and exact compact seven-key source slot, not the ten-key public slot',()=>{
  const body=fn(adoption);
  includes(body,'public.faolla_attendance_plan_rule_command_v1(a.command) is distinct from true',
    "a.command->>'expectedFingerprint' is distinct from f.source_sha256","encode(sha256(convert_to(f.source::text,'UTF8')),'hex')",
    "f.source_bytes is distinct from octet_length(convert_to(f.source::text,'UTF8'))",'public.faolla_attendance_plan_rule_source_v1(f.source) is distinct from true',
    "'locationVersion',p.publication_snapshot->'locationVersion'","f.source->'slot' is distinct from jsonb_build_object('id'",
    "(f.source->>'workerVersion')::bigint>w.version","(f.source->>'settingsVersion')::bigint>s.version",'a.observed_at>a.recorded_at',
    "a.recorded_at>=(p.slot_snapshot->>'startAt')::timestamptz");
  assert.doesNotMatch(body,/f\.source->'slot'-'cancelled'|faolla_attendance_rule_sources_v1|valid_zone|pg_timezone_names/);
});

test('sidecar is bounded per event with real FK references; append guard recomputes exact current choice',()=>{
  includes(clean,'primary key(merchant_id,start_event_id),unique(start_event_id),unique(merchant_id,worker_id,operation_id)',
    'references public.merchant_attendance_shift_schedule_relations(merchant_id,start_event_id)',
    'references public.merchant_attendance_plan_rule_operations(merchant_id,operation_id)',
    "octet_length(convert_to(adoption::text,'UTF8'))<=4096");
  const body=fn(guard);
  includes(body,'rel.recorded_at',`public.${adoption}(rel,new.employee_auth_user_id,null,true)`,
    "new.adoption is distinct from expected","new.approval_operation_id::text is distinct from expected->'approval'->>'operationId'");
  assert.doesNotMatch(clean,/unique\([^)]*slot_id|source_text\s+text|source\s+jsonb/i);
});

test('only no-operation GET with legal fresh state lists101 bounded candidates; recovery never expands to list',()=>{
  const body=fn(rpc);
  includes(body,"if p_command is null and p_operation_id is null and p_allow_schedule and p_allow_new_sessions and location.id is not null and clock_result->'channelEnabled'='true'::jsonb",
    "and clock_result->'state'->>'status'='off' then");
  ordered(body,'candidates:=array(select x from public.merchant_attendance_schedule_slots',
    'order by x.work_date,x.start_at,x.id limit 101','limited:=cardinality(candidates)>100','if not limited then foreach slot',
    'if slot.employee_id<>employee.id or slot.location_id<>location.id then continue;end if;',"entries:=entries||jsonb_build_array(context->'slot')");
  includes(body,"octet_length(convert_to(choices::text,'UTF8'))>48000","'revision',head,'limited',true,'entries','[]'::jsonb",
    "octet_length(convert_to(result::text,'UTF8'))>65536");
});

test('read preserves immutable adoption and original cancellation while separately reporting current cancellation',()=>{
  const body=fn(rpc);
  includes(body,'saved.cancellation_snapshot is distinct from current_cancellation','(current_cancellation->>\'revision\')::bigint<=saved.schedule_revision',
    "(saved.slot_snapshot-'cancelled') is distinct from ((context->'slot')-'cancelled')", "'currentCancelled',current_cancelled",
    'proof.approval_operation_id,false','if proof.adoption is distinct from adoption',
    "'protocol','location-schedule-v1','clock',clock_result,'choices',choices,'association',association,'adoption',adoption");
  const original=old('202609300072_merchant_attendance_location_clock.sql');
  includes(original,"'internalPolicyFingerprint',v_fingerprint,'internalFence'");
  assert.doesNotMatch(body,/proof\.adoption\s*:=|saved\.slot_snapshot\s*:=|update\s+public/);
});

test('JSON member extraction is parenthesized before deletion/arithmetic to avoid PostgreSQL unknown-literal operator ambiguity',()=>{
  assert.deepEqual([...clean.matchAll(/->\s*'[^']+'\s*(?:-(?!>)|[+*/])/g)].map(match=>match[0]),[]);
  includes(fn(rpc),"((context->'slot')-'cancelled')");
});

test('private RLS/direct ACL and exact enabled append-only trigger postconditions; only RPC is granted to service',()=>{
  includes(clean,`alter table public.${table} enable row level security`,`revoke all on public.${table} from public,anon,authenticated,service_role`,
    `before insert on public.${table}`,`before update or delete on public.${table}`,`before truncate on public.${table}`,
    't.tgfoid=fn::oid and t.tgtype=kind',"t.tgenabled in('O','A')",'t.tgqual is null and t.tgnargs=0',
    'merchant_attendance_location_schedule_trigger_conflict',"pg_has_role(r,a.grantee,'USAGE')","a.grantee=0 and a.privilege_type='EXECUTE'");
  assert.equal((clean.match(/grant execute/g)||[]).length,1);
  assert(clean.includes(`grant execute on function public.${rpc}(${signature}) to service_role`));
  assert.doesNotMatch(clean,/create policy|grant\s+(?:select|insert|update|all)|disable trigger|session_replication_role/i);
});
