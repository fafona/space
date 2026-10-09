-- One current-owner original-shift read, not a new clock/calculation writer.
--135 retains authorization/settings/worker/employee SHARE locks for this whole
-- transaction. No table, index, old definition, timezone replay or grant changes.
begin;
set local lock_timeout='3s';

do $shift_check_prerequisites$
declare installed boolean;dependency record;p text;t text;
begin
  if to_regclass('public.faolla_schema_migrations') is null then raise exception 'merchant_attendance_shift_check_prerequisite_required';end if;
  for dependency in select * from (values
    (202610010093::bigint,'merchant_attendance_versioned_reports'),
    (202610010095::bigint,'merchant_attendance_revision_cycles'),
    (202610040135::bigint,'merchant_attendance_shift_rule_binding_reader'),
    (202610050137::bigint,'merchant_attendance_self_schedule')) d(version,name) loop
    if not exists(select 1 from public.faolla_schema_migrations m where m.version=dependency.version and m.name=dependency.name) then
      raise exception 'merchant_attendance_shift_check_prerequisite_required';end if;
  end loop;
  foreach t in array array['merchant_attendance_events','merchant_attendance_correction_effects','merchant_attendance_effect_versions',
    'merchant_attendance_effect_current_v2','merchant_attendance_correction_entries','merchant_attendance_revision_requests',
    'merchant_attendance_shift_schedule_relations','merchant_attendance_schedule_slots','merchant_attendance_schedule_commands'] loop
    if to_regclass('public.'||t) is null then raise exception 'merchant_attendance_shift_check_prerequisite_required';end if;
  end loop;
  foreach p in array array['public.faolla_attendance_shift_rule_binding_v1(jsonb,uuid)',
    'public.faolla_attendance_effect_evidence_v2(public.merchant_attendance_effect_current_v2,timestamp with time zone)',
    'public.faolla_attendance_self_schedule_slot_v1(public.merchant_attendance_schedule_slots)'] loop
    if to_regprocedure(p) is null then raise exception 'merchant_attendance_shift_check_prerequisite_required';end if;
  end loop;
  select exists(select 1 from public.faolla_schema_migrations where version=202610050138 and name='merchant_attendance_shift_check') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610050138 and name<>'merchant_attendance_shift_check')
    or installed<>(to_regprocedure('public.faolla_attendance_shift_check_v1(jsonb,uuid)') is not null) then
    raise exception 'merchant_attendance_shift_check_installation_conflict';end if;
end;
$shift_check_prerequisites$;

create or replace function public.faolla_attendance_shift_check_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  binding jsonb;site text;wid uuid;eid uuid;employee uuid;member_auth uuid;observed timestamptz;
  first_event public.merchant_attendance_events%rowtype;ev public.merchant_attendance_events%rowtype;tail_event public.merchant_attendance_events%rowtype;
  candidates public.merchant_attendance_events[];events jsonb:='[]'::jsonb;event_count integer:=0;
  previous_sequence bigint;previous_at timestamptz;last_id uuid;last_at timestamptz;state_name text:='off';
  root_effect public.merchant_attendance_correction_effects%rowtype;latest public.merchant_attendance_effect_versions%rowtype;
  previous_effect public.merchant_attendance_effect_versions%rowtype;effect public.merchant_attendance_effect_current_v2%rowtype;
  original_request public.merchant_attendance_correction_entries%rowtype;revision_request public.merchant_attendance_revision_requests%rowtype;
  effect_json jsonb:=null;expected_previous uuid;expected_previous_at timestamptz;
  saved public.merchant_attendance_shift_schedule_relations%rowtype;slot public.merchant_attendance_schedule_slots%rowtype;
  context jsonb;current_slot jsonb;current_publication jsonb;current_cancellation jsonb;relation jsonb:=null;
  was_cancelled boolean;is_cancelled boolean;expected_reason text;result jsonb;
  stamp_format constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  -- The existing owner reader validates EXACT siteId/workerId/startEventId and
  -- current historical dual identity. Never call a self RPC as an owner/member.
  binding:=public.faolla_attendance_shift_rule_binding_v1(p_query,p_auth_user_id);
  site:=p_query->>'siteId';wid:=(p_query->>'workerId')::uuid;eid:=(p_query->>'startEventId')::uuid;
  employee:=(binding->'worker'->>'employeeId')::uuid;member_auth:=(binding->'worker'->>'employeeAuthUserId')::uuid;
  observed:=clock_timestamp();
  if not isfinite(observed) or observed<(binding->>'readAt')::timestamptz then raise exception 'attendance_shift_check_invalid';end if;
  select * into first_event from public.merchant_attendance_events x where x.merchant_id=site and x.worker_id=wid and x.id=eid;
  if first_event.id is null or first_event.action<>'clock_in' or first_event.actor_employee_id is distinct from employee
    or first_event.sequence is distinct from (binding->'event'->>'sequence')::bigint
    or first_event.occurred_at is distinct from (binding->'event'->>'occurredAt')::timestamptz
    or first_event.location_id::text is distinct from binding->'event'->>'locationId'
    or first_event.time_zone is distinct from binding->'event'->>'timeZone'
    or first_event.operation_id::text is distinct from binding->'event'->>'operationId' then raise exception 'attendance_shift_check_invalid';end if;
  if first_event.sequence>1 and not exists(select 1 from public.merchant_attendance_events x
    where x.merchant_id=site and x.worker_id=wid and x.sequence=first_event.sequence-1 and x.action='clock_out') then
    raise exception 'attendance_shift_check_invalid';end if;
  -- Existing unique(merchant_id,worker_id,sequence) bounds the probe, including
  -- a2003rd sentinel. Stop at the first real clock_out; never append an asOf one.
  candidates:=array(select x from public.merchant_attendance_events x where x.merchant_id=site and x.worker_id=wid
    and x.sequence>=first_event.sequence order by x.sequence limit 2003);
  if cardinality(candidates)=0 then raise exception 'attendance_shift_check_invalid';end if;
  previous_sequence:=first_event.sequence-1;previous_at:=first_event.occurred_at;
  foreach ev in array candidates loop
    event_count:=event_count+1;
    if event_count>2002 then raise exception 'attendance_shift_check_too_large';end if;
    if ev.actor_employee_id is distinct from employee then raise exception 'attendance_shift_rule_binding_identity_changed';end if;
    if ev.sequence<>previous_sequence+1 or ev.sequence not between 1 and 9007199254740991
      or not isfinite(ev.occurred_at) or ev.occurred_at<previous_at or ev.occurred_at>observed
      or ev.occurred_at<timestamptz '2000-01-01 00:00:00+00' or ev.occurred_at>=timestamptz '2101-01-01 00:00:00+00'
      or ev.source not in('web','kiosk') or ev.location_id is null or char_length(ev.time_zone) not between 1 and 100
      or ev.time_zone<>btrim(ev.time_zone) or ev.time_zone ~ '[[:cntrl:]]'
      or (ev.action='break_start' and ev.break_paid is null) or (ev.action<>'break_start' and ev.break_paid is not null) then
      raise exception 'attendance_shift_check_invalid';end if;
    if event_count=1 then
      if ev.id<>eid or ev.action<>'clock_in' then raise exception 'attendance_shift_check_invalid';end if;state_name:='working';
    elsif ev.action='break_start' and state_name='working' then state_name:='break';
    elsif ev.action='break_end' and state_name='break' then state_name:='working';
    elsif ev.action='clock_out' and state_name='working' then state_name:='completed';
    else raise exception 'attendance_shift_check_invalid';end if;
    previous_sequence:=ev.sequence;previous_at:=ev.occurred_at;last_id:=ev.id;last_at:=ev.occurred_at;
    if state_name='completed' then exit;end if;
  end loop;
  select jsonb_agg(jsonb_build_object('id',x.id,'locationId',x.location_id,'sequence',x.sequence,'action',x.action,
    'occurredAt',to_char(x.occurred_at at time zone 'UTC',stamp_format),'timeZone',x.time_zone,'breakPaid',x.break_paid,'source',x.source) order by x.sequence)
    into events from unnest(candidates) x where x.sequence<=previous_sequence;
  if state_name<>'completed' then
    --111 derives state from the indexed immutable tail, not a mutable cache.
    select * into tail_event from public.merchant_attendance_events x where x.merchant_id=site and x.worker_id=wid order by x.sequence desc limit 1;
    if row(tail_event.id,tail_event.sequence,tail_event.occurred_at,tail_event.actor_employee_id)
      is distinct from row(last_id,previous_sequence,last_at,employee) then raise exception 'attendance_shift_check_invalid';end if;
  end if;
  if state_name='completed' and last_at-first_event.occurred_at>interval '744 hours' then raise exception 'attendance_shift_check_too_large';end if;

  -- PK root lookup, one reverse-PK latest revision, then one exact view member.
  -- No broad employee/date query or traversal of the complete revision history.
  select * into root_effect from public.merchant_attendance_correction_effects x where x.merchant_id=site and x.worker_id=wid and x.start_event_id=eid;
  if root_effect.request_id is not null then
    select * into latest from public.merchant_attendance_effect_versions x where x.merchant_id=site and x.root_request_id=root_effect.request_id
      order by x.revision desc limit 1;
    select * into effect from public.merchant_attendance_effect_current_v2 x where x.merchant_id=site
      and x.root_request_id=root_effect.request_id and x.revision=coalesce(latest.revision,1);
    if effect.request_id is null or effect.worker_id is distinct from wid or effect.start_event_id is distinct from eid
      or effect.employee_id is distinct from employee or effect.original_last_event_id is distinct from last_id::text
      or state_name<>'completed' or effect.time_zone is distinct from first_event.time_zone
      or not isfinite(effect.recorded_at) or effect.recorded_at<last_at or effect.recorded_at>observed
      or effect.root_operation_id is distinct from root_effect.operation_id or effect.root_recorded_at is distinct from root_effect.recorded_at
      or root_effect.recorded_at<last_at then raise exception 'attendance_shift_check_invalid';end if;
    select * into original_request from public.merchant_attendance_correction_entries x where x.merchant_id=site and x.operation_id=root_effect.request_id and x.action='submit';
    if original_request.operation_id is null or original_request.worker_id is distinct from wid or original_request.start_event_id is distinct from eid
      or original_request.employee_id is distinct from employee or original_request.actor_auth_user_id is distinct from member_auth
      or original_request.basis->'events'->0->>'id' is distinct from eid::text
      or original_request.basis->'events'->-1->>'id' is distinct from last_id::text then raise exception 'attendance_shift_check_invalid';end if;
    if latest.operation_id is null then
      if effect.revision<>1 or effect.request_id is distinct from root_effect.request_id or effect.operation_id is distinct from root_effect.operation_id
        or effect.previous_operation_id is not null then raise exception 'attendance_shift_check_invalid';end if;
    else
      if latest.revision=2 then expected_previous:=root_effect.operation_id;expected_previous_at:=root_effect.recorded_at;
      else
        select * into previous_effect from public.merchant_attendance_effect_versions x where x.merchant_id=site
          and x.root_request_id=root_effect.request_id and x.revision=latest.revision-1;
        if previous_effect.operation_id is null or previous_effect.worker_id is distinct from wid or previous_effect.start_event_id is distinct from eid then
          raise exception 'attendance_shift_check_invalid';end if;
        expected_previous:=previous_effect.operation_id;expected_previous_at:=previous_effect.recorded_at;
      end if;
      select * into revision_request from public.merchant_attendance_revision_requests x where x.merchant_id=site and x.operation_id=latest.request_id and x.action='submit';
      if latest.worker_id is distinct from wid or latest.start_event_id is distinct from eid or latest.revision<2
        or latest.previous_operation_id is distinct from expected_previous or latest.recorded_at<=expected_previous_at
        or effect.operation_id is distinct from latest.operation_id or effect.request_id is distinct from latest.request_id
        or effect.previous_operation_id is distinct from expected_previous
        or revision_request.operation_id is null or revision_request.base_request_id is distinct from root_effect.request_id
        or revision_request.worker_id is distinct from wid or revision_request.employee_id is distinct from employee
        or revision_request.actor_auth_user_id is distinct from member_auth
        or coalesce(revision_request.command->>'expectedEffectiveOperationId',revision_request.base_operation_id::text) is distinct from expected_previous::text
        or revision_request.recorded_at<=expected_previous_at or revision_request.recorded_at>=latest.recorded_at then
        raise exception 'attendance_shift_check_invalid';end if;
    end if;
    effect_json:=public.faolla_attendance_effect_evidence_v2(effect,observed);
  end if;

  --137's event key is bounded. Missing is not synthesized from today's plans.
  select * into saved from public.merchant_attendance_shift_schedule_relations x where x.merchant_id=site and x.start_event_id=eid;
  if saved.start_event_id is not null then
    if saved.employee_id is distinct from employee or saved.employee_auth_user_id is distinct from member_auth then
      raise exception 'attendance_shift_rule_binding_identity_changed';end if;
    if row(saved.worker_id,saved.operation_id,saved.sequence,saved.location_id,saved.occurred_at,saved.event_time_zone)
      is distinct from row(wid,first_event.operation_id,first_event.sequence,first_event.location_id,first_event.occurred_at,first_event.time_zone)
      or first_event.source<>'web' or first_event.occurred_at<>first_event.received_at
      or saved.binding_policy<>'employee-explicit-clock-in-v1' or not isfinite(saved.recorded_at) or saved.recorded_at>observed
      or saved.worker_version not between 1 and 9007199254740991 or saved.location_version not between 1 and 9007199254740991
      or saved.settings_version not between 1 and 9007199254740991 or saved.schedule_revision not between 0 and 9007199254740990
      or saved.schedule_revision>0 and not exists(select 1 from public.merchant_attendance_schedule_commands x where x.merchant_id=site and x.revision=saved.schedule_revision) then
      raise exception 'attendance_shift_check_invalid';end if;
    is_cancelled:=null;
    if saved.selection is null then
      if saved.status<>'unselected' or saved.reason is not null or saved.slot_id is not null or saved.slot_revision is not null
        or saved.slot_snapshot is not null or saved.publication_snapshot is not null or saved.cancellation_snapshot is not null then
        raise exception 'attendance_shift_check_invalid';end if;
    else
      select * into slot from public.merchant_attendance_schedule_slots x where x.merchant_id=site and x.id=saved.slot_id;
      if slot.id is null or slot.worker_id is distinct from wid or slot.employee_id is distinct from employee or slot.revision is distinct from saved.slot_revision
        or saved.slot_revision>saved.schedule_revision or saved.selection is distinct from jsonb_build_object('slotId',slot.id,'revision',slot.revision)
        or saved.status not in('linked','unverified') or jsonb_typeof(saved.slot_snapshot) is distinct from 'object'
        or jsonb_typeof(saved.slot_snapshot->'cancelled') is distinct from 'boolean' then raise exception 'attendance_shift_check_invalid';end if;
      context:=public.faolla_attendance_self_schedule_slot_v1(slot);
      current_slot:=context->'slot';current_publication:=nullif(context->'publication','null'::jsonb);current_cancellation:=nullif(context->'cancellation','null'::jsonb);
      if current_publication->>'employeeAuthUserId' is not null and current_publication->>'employeeAuthUserId'<>member_auth::text then
        raise exception 'attendance_shift_rule_binding_identity_changed';end if;
      if saved.slot_snapshot-'cancelled' is distinct from current_slot-'cancelled'
        or saved.publication_snapshot is distinct from current_publication then raise exception 'attendance_shift_check_invalid';end if;
      was_cancelled:=(saved.slot_snapshot->>'cancelled')::boolean;is_cancelled:=(current_slot->>'cancelled')::boolean;
      if was_cancelled then
        if not is_cancelled or saved.cancellation_snapshot is null or saved.cancellation_snapshot is distinct from current_cancellation
          or (current_cancellation->>'revision')::bigint>saved.schedule_revision then raise exception 'attendance_shift_check_invalid';end if;
      elsif saved.cancellation_snapshot is not null or is_cancelled and (current_cancellation->>'revision')::bigint<=saved.schedule_revision then
        raise exception 'attendance_shift_check_invalid';end if;
      -- Outside-window was checked by137 at insertion using the THEN-available
      -- zone database. Preserve that immutable decision, do not reinterpret it.
      expected_reason:=case when was_cancelled then 'cancelled' when slot.location_id<>first_event.location_id then 'location_changed'
        when saved.reason='outside_window' then 'outside_window' when not (current_slot->>'hasPublicationEvidence')::boolean then 'publication_missing' else null end;
      if saved.reason is distinct from expected_reason or saved.status is distinct from (case when expected_reason is null then 'linked' else 'unverified' end) then
        raise exception 'attendance_shift_check_invalid';end if;
    end if;
    relation:=jsonb_build_object('startEventId',saved.start_event_id,'operationId',saved.operation_id,'selection',saved.selection,'status',saved.status,
      'reason',saved.reason,'slot',saved.slot_snapshot,'observedRevision',saved.schedule_revision,
      'recordedAt',to_char(saved.recorded_at at time zone 'UTC',stamp_format),'currentCancelled',is_cancelled);
  end if;
  result:=jsonb_build_object('protocol','shift-check-source-v1','binding',binding,'asOf',to_char(observed at time zone 'UTC',stamp_format),
    'events',events,'effect',effect_json,'relation',relation);
  if octet_length(convert_to(result::text,'UTF8'))>1048576 then raise exception 'attendance_shift_check_too_large';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
  raise exception 'attendance_shift_check_invalid';
end;
$$;
revoke all on function public.faolla_attendance_shift_check_v1(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_shift_check_v1(jsonb,uuid) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610050138,'merchant_attendance_shift_check') on conflict(version) do nothing;

do $shift_check_postconditions$
declare r text;
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610050138 and name='merchant_attendance_shift_check') then
    raise exception 'merchant_attendance_shift_check_registry_postcondition_failed';end if;
  if not exists(select 1 from pg_proc where oid='public.faolla_attendance_shift_check_v1(jsonb,uuid)'::regprocedure
    and prosecdef and provolatile='v' and proconfig=array['search_path=pg_catalog']) then raise exception 'merchant_attendance_shift_check_definition_postcondition_failed';end if;
  foreach r in array array['anon','authenticated','service_role'] loop
    if has_function_privilege(r,'public.faolla_attendance_shift_check_v1(jsonb,uuid)','EXECUTE') is distinct from (r='service_role') then
      raise exception 'merchant_attendance_shift_check_acl_postcondition_failed';end if;
  end loop;
  if exists(select 1 from pg_proc f cross join lateral aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
    where f.oid='public.faolla_attendance_shift_check_v1(jsonb,uuid)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') then
    raise exception 'merchant_attendance_shift_check_acl_postcondition_failed';end if;
end;
$shift_check_postconditions$;
notify pgrst, 'reload schema';
commit;
