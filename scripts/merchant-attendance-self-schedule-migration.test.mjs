// Static source contracts, not PostgreSQL behavioral or concurrency proof.
// Runtime belongs to the separate root-owned synthetic native acceptance.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const filename='202610050137_merchant_attendance_self_schedule.sql';
const source=readFileSync(new URL(`./supabase-migrations/${filename}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const clean=source.replace(/--[^\n]*/g,'');
const table='merchant_attendance_shift_schedule_relations',rpc='faolla_attendance_self_schedule_v1';
const slotHelper='faolla_attendance_self_schedule_slot_v1',guard='faolla_attendance_self_schedule_guard_v1';
const fn=name=>{const start=clean.indexOf(`create or replace function public.${name}(`);assert(start>=0);return clean.slice(start,clean.indexOf('$$;',start)+3);};
const ordered=(text,...parts)=>{let position=-1;for(const part of parts){const next=text.indexOf(part,position+1);assert(next>position,part);position=next;}};
const contains=(text,parts)=>{for(const part of parts)assert(text.includes(part),part);};

test('137 adds one relation table and three new functions only, without altering old tables, writers or SQL protocols',()=>{
  assert.deepEqual(validateMigrationSource(filename,source),[]);
  assert.deepEqual([...clean.matchAll(/create table if not exists public\.(\w+)/g)].map(m=>m[1]),[table]);
  assert.deepEqual([...clean.matchAll(/create or replace function public\.(\w+)/g)].map(m=>m[1]),[slotHelper,guard,rpc]);
  assert.deepEqual([...clean.matchAll(/insert into public\.(\w+)/g)].map(m=>m[1]),[table,'faolla_schema_migrations']);
  assert.deepEqual([...clean.matchAll(/alter table public\.(\w+)/g)].map(m=>m[1]),[table]);
  assert.doesNotMatch(clean,/\b(?:drop|create\s+index|lock\s+table|update\s+public\.|delete\s+from)\b/i);
});

test('exact111/134/136 prerequisites and registry/object conflicts prevent partial or mistaken installation',()=>{
  contains(clean,["202610020111::bigint,'merchant_attendance_self_clock_identity'","202610040134::bigint,'merchant_attendance_bound_clocks'",
    "202610050136::bigint,'merchant_attendance_schedule_publication_evidence'",'public.faolla_attendance_self_v1(text,uuid,jsonb,uuid)',
    'public.faolla_attendance_self_bound_v1(text,uuid,jsonb,uuid)','public.faolla_attendance_schedule_publication_slots_v1(jsonb)',
    "installed<>(to_regclass('public.merchant_attendance_shift_schedule_relations') is not null)",'installed<>(to_regprocedure(p) is not null)',
    "name<>'merchant_attendance_self_schedule'","values(202610050137,'merchant_attendance_self_schedule') on conflict(version) do nothing"]);
});

test('new exact seven-argument RPC defaults both independent write/bind flags off and accepts only original clock-in command plus minimal selection',()=>{
  const body=fn(rpc);
  contains(body,['p_site_id text,p_auth_user_id uuid,p_command jsonb default null','p_selection jsonb default null,p_operation_id uuid default null,p_allow_write boolean default false,p_bind_rules boolean default false',
    "array['operationId','locationId','action','expectedSequence','expectedWorkerId']",'jsonb_object_keys(p_command))<>5',"p_command->>'action' is distinct from 'clock_in'",
    "array['slotId','revision']",'jsonb_object_keys(selected))<>2',"(selected->>'revision')::numeric>9007199254740990"]);
  assert.doesNotMatch(body,/p_command\s*(?:-(?!>)|\|\|)|p_command\s*:=|jsonb_set\(p_command|expectedEmployeeAuth|p_actor/);
});

test('feature rollback blocks every POST but does not block authorized GET receipt recovery or invoke any fallback POST',()=>{
  const body=fn(rpc);
  ordered(body,'if p_command is null then','if selected is not null then raise exception',
    "if not p_allow_write then raise exception 'attendance_self_schedule_disabled';end if;",'if p_bind_rules then clock_result:=');
  assert(body.includes('if p_command is null and p_allow_write and location.id is not null then'));
  assert.doesNotMatch(body,/\bexception\s+when\b|attendance_platform_paused|retry|perform public\.faolla_attendance_self_v1/);
});

test('rule retention uses only the independent existing gate; original settings/worker lock order is never upgraded or reversed',()=>{
  const body=fn(rpc);
  contains(body,['if p_bind_rules then clock_result:=public.faolla_attendance_self_bound_v1(p_site_id,p_auth_user_id,p_command,p_operation_id)',
    'else clock_result:=public.faolla_attendance_self_v1(p_site_id,p_auth_user_id,p_command,p_operation_id)']);
  assert.equal((body.match(/clock_result\s*:=/g)||[]).length,2);
  assert.doesNotMatch(body,/for update|from public\.merchants|pg_advisory|faolla_attendance_bind_shift_rules_v1|faolla_attendance_rule_sources_v1/);
  const old=readFileSync(new URL('./supabase-migrations/202610020111_merchant_attendance_self_clock_identity.sql',import.meta.url),'utf8');
  ordered(old,'merchant_attendance_settings where merchant_id=p_site_id for share',
    'where merchant_id=p_site_id and auth_user_id=p_auth_user_id for share','where merchant_id=p_site_id and employee_id=v_employee.id for update');
});

test('existing event is authorized by old RPC first; same-operation selection cannot change and legacy absence is never backfilled',()=>{
  const body=fn(rpc);
  ordered(body,'clock_result:=public.faolla_attendance_self_v1',`select * into saved from public.${table}`,
    "saved.employee_auth_user_id is distinct from p_auth_user_id then raise exception 'attendance_access_denied'",
    "saved.selection is distinct from selected then raise exception 'attendance_operation_conflict'",
    "elsif p_command is not null and clock_result->'replayed'='false'::jsonb then",`insert into public.${table}`);
  assert.equal((body.match(new RegExp(`insert into public\\.${table}`,'g'))||[]).length,1);
  assert.doesNotMatch(body,/on conflict|\bexception\s+when\b|saved\.selection\s*:=/);
});

test('foreign absent historical employee or known historical Auth selections fail closed before business reasons',()=>{
  const body=fn(rpc);
  ordered(body,"id=(selected->>'slotId')::uuid",
    "slot.id is null or slot.worker_id is distinct from worker.id or slot.employee_id is distinct from employee.id then raise exception 'attendance_access_denied'",
    "slot.revision is distinct from (selected->>'revision')::bigint then raise exception 'attendance_invalid_request'",
    "context->'publication'->>'employeeAuthUserId'<>p_auth_user_id::text then",
    "reason_name:=case when (slot_item->>'cancelled')::boolean then 'cancelled'");
  assert.doesNotMatch(body,/employee\.auth_user_id\s*:=|coalesce\([^\n]*employeeAuthUserId[^\n]*p_auth/);
});

test('selected own-plan business states are closed and preserve real clocks rather than silently selecting a substitute',()=>{
  for(const body of [fn(rpc),fn(guard)])contains(body,["then 'cancelled'","then 'location_changed'","then 'outside_window'","then 'publication_missing'","then 'linked' else 'unverified'"]);
  const body=fn(rpc);
  contains(body,["status_name:='unselected';reason_name:=null;",'slot.work_date<day_now-1 or slot.work_date>day_now+1']);
  assert.doesNotMatch(body,/nearest|extract\(epoch|lateGrace|start_at\s*[<>]=?\s*ev\.occurred_at|end_at\s*[<>]=?\s*ev\.occurred_at/);
});

test('relation uniqueness is per original event and operation, never per slot; both explicit none and historical snapshots are immutable',()=>{
  contains(clean,['primary key(merchant_id,start_event_id),unique(start_event_id),unique(merchant_id,worker_id,operation_id)',
    'references public.merchant_attendance_events(id)','references public.merchant_attendance_events(merchant_id,worker_id,operation_id)',
    'references public.merchant_attendance_schedule_slots(merchant_id,id)',"status='unselected' and reason is null and selection is null and slot_id is null and slot_revision is null",
    "status='unverified' and reason is not null",'slot_revision is not null',"binding_policy='employee-explicit-clock-in-v1'",
    'worker.version,location.version,settings.version,selected,slot.id,slot.revision,head,status_name,reason_name']);
  assert.doesNotMatch(clean,/unique\([^)]*slot_id|unique\([^)]*slot_revision/i);
});

test('insert guard cross-checks original event/channel, current dual identity and versions, exact ledger head and source snapshots',()=>{
  const body=fn(guard);
  contains(body,['ev.operation_id is distinct from new.operation_id','ev.worker_id is distinct from new.worker_id',"ev.action<>'clock_in' or ev.source<>'web'",
    'ev.occurred_at<>ev.received_at','e.auth_user_id is distinct from new.employee_auth_user_id','w.version is distinct from new.worker_version',
    'l.version is distinct from new.location_version','s.version is distinct from new.settings_version','head is distinct from new.schedule_revision',
    "context->'slot' is distinct from new.slot_snapshot","nullif(context->'publication','null'::jsonb) is distinct from new.publication_snapshot",
    "nullif(context->'cancellation','null'::jsonb) is distinct from new.cancellation_snapshot",'new.reason is distinct from expected_reason']);
  assert.doesNotMatch(body,/new\.recorded_at\s*[<>]=?\s*ev\.occurred_at/);
  assert.match(body,/new\.status is distinct from \(case when expected_reason is null then 'linked' else 'unverified' end\) then/);
  assert.doesNotMatch(body,/is distinct from case\b/);
});

test('saved slot helper validates immutable command/cancel/publication references without recalculating saved UTC or historical timezone rules',()=>{
  const body=fn(slotHelper);
  contains(body,['jsonb_array_length(published.command->\'slots\') not between 1 and 32','where x.value=pair','if matches<>1 then',
    'evidence.operation_id is distinct from published.operation_id','evidence.employee_id is distinct from p.employee_id',
    'evidence.published_at is distinct from published.recorded_at','public.faolla_attendance_schedule_publication_slots_v1(evidence.slots)',
    'has_evidence:=evidence.employee_auth_user_id is not null',"cancelled.command->'expectedRevision' is distinct from to_jsonb(cancelled.revision-1)",
    "cancelled.command->>'slotId' is distinct from p.id::text"]);
  assert.doesNotMatch(body,/pg_timezone_names|valid_zone|at time zone p\.time_zone|now\(|clock_timestamp|for update/);
});

test('candidate101 cap precedes identity/location filters, matches the existing worker/date index order and never leaks partial or foreign rows',()=>{
  const body=fn(rpc);
  ordered(body,'candidates:=array(select x from public.merchant_attendance_schedule_slots x',
    'x.work_date between first_day and last_day order by x.work_date,x.start_at,x.id limit 101','limited:=cardinality(candidates)>100','if not limited then',
    'if slot.employee_id<>employee.id or slot.location_id<>location.id then continue;end if;',
    "context->'publication'->>'employeeAuthUserId'<>p_auth_user_id::text then continue;end if;",'entries:=entries||');
  contains(body,["first_day:=greatest(day_now-1,date '2000-01-01')","last_day:=least(day_now+1,date '2100-12-31')",
    "'revision',head,'limited',limited,'entries',entries","octet_length(convert_to(choices::text,'UTF8'))>48000",
    "'revision',head,'limited',true,'entries','[]'::jsonb"]);
  const old=readFileSync(new URL('./supabase-migrations/202610010099_merchant_attendance_schedule.sql',import.meta.url),'utf8');
  assert(old.includes('attendance_schedule_worker_date_idx on public.merchant_attendance_schedule_slots(merchant_id,worker_id,work_date,start_at,id)'));
});

test('GET reports cancellation dynamically while preserving original selection slot flags observed revision and recordedAt',()=>{
  const body=fn(rpc);
  contains(body,["current_cancelled:=(context->'slot'->>'cancelled')::boolean", "'selection',saved.selection,'status',saved.status,'reason',saved.reason",
    "'slot',saved.slot_snapshot,'observedRevision',saved.schedule_revision",'to_char(saved.recorded_at',"'currentCancelled',current_cancelled"]);
  assert.doesNotMatch(body,/saved\.(?:slot_snapshot|schedule_revision|recorded_at)\s*:=|update\s+public/);
});

test('bounded wire keeps clock unchanged and emits only agreed public choice/association fields, not private identities/publication graphs',()=>{
  const body=fn(rpc);
  contains(body,["'protocol','self-schedule-v1','clock',clock_result,'choices',choices,'association',association",
    "octet_length(convert_to(result::text,'UTF8'))>65536", "'timeZone',null,'fromDate',null,'throughDate',null,'revision',head,'limited',false,'entries','[]'::jsonb"]);
  const projection=body.slice(body.indexOf("association:=jsonb_build_object"),body.indexOf('end if;',body.indexOf("association:=jsonb_build_object")));
  assert.doesNotMatch(projection,/employee_auth|publication_snapshot|cancellation_snapshot|worker_version|sourceText/);
});

test('private relation and helpers are RLS/direct-ACL denied; append-only and insert triggers are validated without silent repair',()=>{
  contains(clean,[`alter table public.${table} enable row level security`,`revoke all on public.${table} from public,anon,authenticated,service_role`,
    `before insert on public.${table}`,`before update or delete on public.${table}`,`before truncate on public.${table}`,
    't.tgfoid=trigger_function::oid','t.tgtype=trigger_type',"t.tgenabled in('O','A')",'t.tgqual is null and t.tgnargs=0',
    'merchant_attendance_self_schedule_trigger_conflict',"pg_has_role(r,a.grantee,'USAGE')","a.grantee=0 and a.privilege_type='EXECUTE'"]);
  assert.equal((clean.match(/grant execute/g)||[]).length,1);
  assert(clean.includes(`grant execute on function public.${rpc}(text,uuid,jsonb,jsonb,uuid,boolean,boolean) to service_role`));
  assert.doesNotMatch(clean,/create policy|grant\s+(?:select|insert|update|all)|disable trigger|session_replication_role/i);
});
