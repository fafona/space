// Static source contracts only; actual SQL authorization/concurrency is tested
// separately by the root-owned native acceptance, not by these string checks.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const filename='202610050138_merchant_attendance_shift_check.sql';
const source=readFileSync(new URL(`./supabase-migrations/${filename}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const clean=source.replace(/--[^\n]*/g,'');
const rpc='faolla_attendance_shift_check_v1';
const start=clean.indexOf(`create or replace function public.${rpc}(`);
const body=clean.slice(start,clean.indexOf('$$;',start)+3);
const contains=(text,...parts)=>{for(const part of parts)assert(text.includes(part),part);};
const ordered=(text,...parts)=>{let position=-1;for(const part of parts){const next=text.indexOf(part,position+1);assert(next>position,part);position=next;}};
const old=name=>readFileSync(new URL(`./supabase-migrations/${name}`,import.meta.url),'utf8');

test('138 adds one read RPC and registration only without replacing old SQL or creating tables/indexes',()=>{
  assert.deepEqual(validateMigrationSource(filename,source),[]);
  assert.deepEqual([...clean.matchAll(/create or replace function public\.(\w+)/g)].map(m=>m[1]),[rpc]);
  assert.deepEqual([...clean.matchAll(/insert into public\.(\w+)/g)].map(m=>m[1]),['faolla_schema_migrations']);
  assert.doesNotMatch(clean,/\b(?:create\s+(?:table|index|trigger)|alter\s+table|drop|delete\s+from|update\s+public\.|lock\s+table)\b/i);
  assert.doesNotMatch(body,/\b(?:insert\s+into|update\s+public\.|delete\s+from|for\s+update|for\s+no\s+key\s+update)\b/i);
});

test('named093095135137 prerequisites and partial-install conflicts are checked before the new function',()=>{
  contains(clean,"(202610010093::bigint,'merchant_attendance_versioned_reports')","(202610040135::bigint,'merchant_attendance_shift_rule_binding_reader')",
    "(202610010095::bigint,'merchant_attendance_revision_cycles')",
    "(202610050137::bigint,'merchant_attendance_self_schedule')",'merchant_attendance_shift_check_prerequisite_required',
    "version=202610050138 and name<>'merchant_attendance_shift_check'","installed<>(to_regprocedure('public.faolla_attendance_shift_check_v1(jsonb,uuid)') is not null)");
  assert(clean.indexOf('$shift_check_prerequisites$;')<start);
});

test('exact query and current-owner dual identity are delegated to135 before any source lookup, with retained SHARE locks',()=>{
  contains(body,`${rpc}(p_query jsonb,p_auth_user_id uuid)`,'returns jsonb language plpgsql security definer set search_path=pg_catalog');
  ordered(body,'binding:=public.faolla_attendance_shift_rule_binding_v1(p_query,p_auth_user_id);','observed:=clock_timestamp();','select * into first_event');
  assert.doesNotMatch(body,/faolla_attendance_self(?:_schedule|_session|_bound)?_v1\(/);
  const reader=old('202610040135_merchant_attendance_shift_rule_binding_reader.sql');
  contains(reader,"array['siteId','workerId','startEventId']",'user_id=p_auth_user_id for share',
    'merchant_attendance_settings where merchant_id=site for share','merchant_attendance_workers where merchant_id=site and id=wid for share',
    'merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share');
  assert.doesNotMatch(body,/\bfor share\b|\badvisory|\bset_config\b|\block_timeout/);
});

test('observation is server-derived after authorization locks and binds original start metadata',()=>{
  contains(body,"observed<(binding->>'readAt')::timestamptz",'first_event.actor_employee_id is distinct from employee',
    "first_event.sequence is distinct from (binding->'event'->>'sequence')::bigint",
    "first_event.occurred_at is distinct from (binding->'event'->>'occurredAt')::timestamptz",
    "first_event.operation_id::text is distinct from binding->'event'->>'operationId'",
    "x.sequence=first_event.sequence-1 and x.action='clock_out'");
});

test('the sequence probe is2003 bounded and accepts at most2002 complete events without returning a prefix',()=>{
  contains(body,'candidates:=array(select x from public.merchant_attendance_events x where x.merchant_id=site and x.worker_id=wid',
    'and x.sequence>=first_event.sequence order by x.sequence limit 2003','if cardinality(candidates)=0',
    "if event_count>2002 then raise exception 'attendance_shift_check_too_large'","if state_name='completed' then exit;end if;");
  ordered(body,'foreach ev in array candidates loop','event_count:=event_count+1;','if event_count>2002',"if state_name='completed' then exit;end if;",'into events from unnest(candidates)');
  assert.doesNotMatch(body,/events\s*:=\s*events\s*\|\||\boffset\b/);
});

test('every event rechecks historical employee identity, monotonic sequence/time, source and state transition',()=>{
  contains(body,"if ev.actor_employee_id is distinct from employee then raise exception 'attendance_shift_rule_binding_identity_changed'",
    'ev.sequence<>previous_sequence+1','ev.occurred_at<previous_at or ev.occurred_at>observed',"ev.source not in('web','kiosk')",
    "ev.action='break_start' and ev.break_paid is null","ev.action<>'break_start' and ev.break_paid is not null",
    "ev.action='break_start' and state_name='working'","ev.action='break_end' and state_name='break'","ev.action='clock_out' and state_name='working'");
  contains(body,'select * into tail_event from public.merchant_attendance_events x where x.merchant_id=site and x.worker_id=wid order by x.sequence desc limit 1;',
    'is distinct from row(last_id,previous_sequence,last_at,employee)');
  assert.doesNotMatch(body,/ev\.occurred_at<=previous_at|coalesce\([^\n]*clock_out/);
});

test('original projection has exactly the established eight event keys and does not copy private employee credentials',()=>{
  const projection=body.slice(body.indexOf('select jsonb_agg('),body.indexOf('into events from unnest'));
  assert.deepEqual([...projection.matchAll(/'([a-z][A-Za-z]*)',/g)].map(m=>m[1]),['id','locationId','sequence','action','occurredAt','timeZone','breakPaid','source']);
  assert.doesNotMatch(projection,/actor_employee_id|auth_user_id|received_at/);
  contains(body,"last_at-first_event.occurred_at>interval '744 hours'");
});

test('effect lookup uses exact original root and latest indexed revision before a constant-depth current-view read',()=>{
  ordered(body,'select * into root_effect from public.merchant_attendance_correction_effects x where x.merchant_id=site and x.worker_id=wid and x.start_event_id=eid;',
    'select * into latest from public.merchant_attendance_effect_versions x where x.merchant_id=site and x.root_request_id=root_effect.request_id',
    'order by x.revision desc limit 1;',
    'select * into effect from public.merchant_attendance_effect_current_v2 x where x.merchant_id=site',
    'and x.root_request_id=root_effect.request_id and x.revision=coalesce(latest.revision,1);',
    'effect_json:=public.faolla_attendance_effect_evidence_v2(effect,observed);');
  contains(body,'and x.root_request_id=root_effect.request_id and x.revision=latest.revision-1;');
  assert.doesNotMatch(body,/with\s+recursive|faolla_attendance_(?:period_report|sources|unified_report)_v/);
});

test('approved effect requires the same current employee, original closed tail, original zone and validated root/previous lineage',()=>{
  contains(body,'effect.employee_id is distinct from employee','effect.original_last_event_id is distinct from last_id::text',
    "state_name<>'completed'",'effect.time_zone is distinct from first_event.time_zone','effect.recorded_at<last_at or effect.recorded_at>observed',
    'original_request.actor_auth_user_id is distinct from member_auth','latest.previous_operation_id is distinct from expected_previous',
    'effect.previous_operation_id is distinct from expected_previous','revision_request.actor_auth_user_id is distinct from member_auth',
    "coalesce(revision_request.command->>'expectedEffectiveOperationId',revision_request.base_operation_id::text) is distinct from expected_previous::text");
});

test('relation is only an original event PK lookup, rechecks dual identity, policy and complete original clock facts',()=>{
  contains(body,'select * into saved from public.merchant_attendance_shift_schedule_relations x where x.merchant_id=site and x.start_event_id=eid;',
    'saved.employee_id is distinct from employee or saved.employee_auth_user_id is distinct from member_auth',
    'row(saved.worker_id,saved.operation_id,saved.sequence,saved.location_id,saved.occurred_at,saved.event_time_zone)',
    "saved.binding_policy<>'employee-explicit-clock-in-v1'","first_event.source<>'web'",'first_event.occurred_at<>first_event.received_at');
  assert.doesNotMatch(body,/saved\.recorded_at\s*<\s*first_event\.occurred_at/);
});

test('explicit none and selected source snapshots are validated without current-version equality or current-plan substitution',()=>{
  contains(body,"if saved.status<>'unselected' or saved.reason is not null or saved.slot_id is not null or saved.slot_revision is not null",
    'slot.worker_id is distinct from wid or slot.employee_id is distinct from employee or slot.revision is distinct from saved.slot_revision',
    "saved.selection is distinct from jsonb_build_object('slotId',slot.id,'revision',slot.revision)",
    'context:=public.faolla_attendance_self_schedule_slot_v1(slot);',"saved.slot_snapshot-'cancelled' is distinct from current_slot-'cancelled'",
    'saved.publication_snapshot is distinct from current_publication');
  assert.doesNotMatch(body,/default_location_id|attendance_schedule_worker_date_idx|saved\.worker_version\s*(?:<>|is distinct from)\s*\(?binding/);
});

test('original versus later cancellation uses immutable schedule revisions, not wallclock chronology or rewritten snapshots',()=>{
  contains(body,'saved.cancellation_snapshot is distinct from current_cancellation',
    "(current_cancellation->>'revision')::bigint>saved.schedule_revision",
    "is_cancelled and (current_cancellation->>'revision')::bigint<=saved.schedule_revision",
    "'slot',saved.slot_snapshot,'observedRevision',saved.schedule_revision","'currentCancelled',is_cancelled");
  assert.doesNotMatch(body,/current_cancellation->>'recordedAt'|saved\.slot_snapshot\s*:=/);
});

test('old outside-window reason remains historical; no current timezone/threshold/leave/payroll inference is introduced',()=>{
  contains(body,"when saved.reason='outside_window' then 'outside_window'",
    "saved.status is distinct from (case when expected_reason is null then 'linked' else 'unverified' end)");
  assert.doesNotMatch(body,/at time zone (?!'UTC')|day_boundary|pg_timezone|lateGraceMinutes|openSpanWarningMinutes|completedBreakMinimumMinutes|merchant_attendance_leave|payroll/);
});

test('oneMiB full source envelope is bounded, has exact six keys, preserves raw135 bytes and oldeffect JSON',()=>{
  contains(body,"result:=jsonb_build_object('protocol','shift-check-source-v1','binding',binding,'asOf',to_char(observed at time zone 'UTC',stamp_format),",
    "'events',events,'effect',effect_json,'relation',relation)","octet_length(convert_to(result::text,'UTF8'))>1048576",
    "raise exception 'attendance_shift_check_invalid'","raise exception 'attendance_shift_check_too_large'");
  assert.doesNotMatch(body,/source_text\s*:=|sourceText.*jsonb|jsonb_set\(binding/);
});

test('only service-role can execute the new RPC and reapply checks registry/definition/public ACL without mutating old grants',()=>{
  contains(clean,`revoke all on function public.${rpc}(jsonb,uuid) from public,anon,authenticated,service_role;`,
    `grant execute on function public.${rpc}(jsonb,uuid) to service_role;`,
    "values(202610050138,'merchant_attendance_shift_check') on conflict(version) do nothing",
    "and prosecdef and provolatile='v' and proconfig=array['search_path=pg_catalog']", "is distinct from (r='service_role')", "a.grantee=0 and a.privilege_type='EXECUTE'");
  assert.deepEqual([...clean.matchAll(/(?:revoke all|grant execute) on function public\.(\w+)/g)].map(m=>m[1]),[rpc,rpc]);
});
