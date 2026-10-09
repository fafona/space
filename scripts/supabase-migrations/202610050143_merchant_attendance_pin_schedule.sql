-- Default-off PIN explicit plan selection. No old112/134 writer replacement.
-- Three separately committed constraint stages preserve the validated old
--location/onsite CHECK until the short atomic helper/RPC installation.
-- A correct interrupted NOT VALID/validated stage may be resumed; unexpected
--catalog definitions fail closed and are never silently repaired.
begin;
set local lock_timeout='3s';
do $pin_schedule_prerequisites$
declare installed boolean;v bigint;n text;p text;c record;
begin
  for v,n in select * from (values
    (202610020112::bigint,'merchant_attendance_pin_clock_identity'),(202610040134::bigint,'merchant_attendance_bound_clocks'),
    (202610050137::bigint,'merchant_attendance_self_schedule'),(202610050138::bigint,'merchant_attendance_shift_check'),
    (202610050140::bigint,'merchant_attendance_plan_rule_approvals'),(202610050142::bigint,'merchant_attendance_onsite_schedule')) required(version,name) loop
    if not exists(select 1 from public.faolla_schema_migrations where version=v and name=n) then raise exception 'merchant_attendance_pin_schedule_prerequisite_required';end if;
  end loop;
  foreach p in array array['public.faolla_attendance_pin_finish_v1(text,uuid,text,text,uuid,boolean,boolean)',
    'public.faolla_attendance_pin_clock_v1(text,uuid,text,text,uuid,boolean,jsonb,boolean)',
    'public.faolla_attendance_pin_clock_bound_v1(text,uuid,text,text,uuid,boolean,jsonb,boolean)',
    'public.faolla_attendance_self_schedule_guard_v1()','public.faolla_attendance_shift_check_v1(jsonb,uuid)',
    'public.faolla_attendance_shift_plan_adoption_v1(public.merchant_attendance_shift_schedule_relations,uuid,uuid,boolean,text)',
    'public.faolla_attendance_shift_plan_adoption_guard_v1()','public.faolla_attendance_bind_shift_rules_v1(uuid,text,uuid)'] loop
    if to_regprocedure(p) is null then raise exception 'merchant_attendance_pin_schedule_prerequisite_required';end if;
  end loop;
  select exists(select 1 from public.faolla_schema_migrations where version=202610050143 and name='merchant_attendance_pin_schedule') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610050143 and name<>'merchant_attendance_pin_schedule') then
    raise exception 'merchant_attendance_pin_schedule_installation_conflict';end if;
  foreach p in array array['public.faolla_attendance_pin_schedule_receipt_v1(public.merchant_attendance_shift_schedule_relations,uuid)',
    'public.faolla_attendance_pin_schedule_v1(text,uuid,text,text,uuid,boolean,jsonb,boolean,jsonb,boolean,boolean)'] loop
    if installed<>(to_regprocedure(p) is not null) then raise exception 'merchant_attendance_pin_schedule_installation_conflict';end if;
  end loop;
  select x.*,regexp_replace(pg_get_expr(x.conbin,x.conrelid),'\s+','','g') expr into c from pg_constraint x
    where x.conrelid='public.merchant_attendance_shift_plan_adoptions'::regclass and x.conname='attendance_shift_plan_adoptions_channels_v2';
  if installed then
    if c.oid is not null then raise exception 'merchant_attendance_pin_schedule_constraint_conflict';end if;
  elsif c.oid is null or c.contype<>'c' or not c.convalidated or c.connoinherit or c.expr<>'(channel=ANY(ARRAY[''location''::text,''onsite''::text]))'
    or c.conkey is distinct from array[(select attnum from pg_attribute where attrelid=c.conrelid and attname='channel')] then
    raise exception 'merchant_attendance_pin_schedule_constraint_conflict';end if;
  select x.*,regexp_replace(pg_get_expr(x.conbin,x.conrelid),'\s+','','g') expr into c from pg_constraint x
    where x.conrelid='public.merchant_attendance_shift_plan_adoptions'::regclass and x.conname='attendance_shift_plan_adoptions_channels_v3';
  if c.oid is not null and (c.contype<>'c' or c.connoinherit or c.expr<>'(channel=ANY(ARRAY[''location''::text,''onsite''::text,''pin''::text]))'
    or c.conkey is distinct from array[(select attnum from pg_attribute where attrelid=c.conrelid and attname='channel')]) then
    raise exception 'merchant_attendance_pin_schedule_constraint_conflict';end if;
  if installed and (c.oid is null or not c.convalidated) then raise exception 'merchant_attendance_pin_schedule_constraint_conflict';end if;
  if c.oid is null then
    alter table public.merchant_attendance_shift_plan_adoptions add constraint attendance_shift_plan_adoptions_channels_v3 check(channel in('location','onsite','pin')) not valid;
  end if;
end;
$pin_schedule_prerequisites$;
commit;

-- The validation scan holds no preceding ADD/DROP ACCESS EXCLUSIVE lock.
begin;
set local lock_timeout='3s';
alter table public.merchant_attendance_shift_plan_adoptions validate constraint attendance_shift_plan_adoptions_channels_v3;
do $pin_schedule_validation$
begin
  if not exists(select 1 from pg_constraint c where c.conrelid='public.merchant_attendance_shift_plan_adoptions'::regclass
    and c.conname='attendance_shift_plan_adoptions_channels_v3' and c.contype='c' and c.convalidated and not c.connoinherit
    and regexp_replace(pg_get_expr(c.conbin,c.conrelid),'\s+','','g')='(channel=ANY(ARRAY[''location''::text,''onsite''::text,''pin''::text]))'
    and c.conkey=array[(select attnum from pg_attribute where attrelid=c.conrelid and attname='channel')]) then
    raise exception 'merchant_attendance_pin_schedule_constraint_conflict';end if;
end;
$pin_schedule_validation$;
commit;

begin;
set local lock_timeout='3s';
do $pin_schedule_cutover$
declare old_constraint record;
begin
  if not exists(select 1 from pg_constraint c where c.conrelid='public.merchant_attendance_shift_plan_adoptions'::regclass
    and c.conname='attendance_shift_plan_adoptions_channels_v3' and c.contype='c' and c.convalidated and not c.connoinherit
    and regexp_replace(pg_get_expr(c.conbin,c.conrelid),'\s+','','g')='(channel=ANY(ARRAY[''location''::text,''onsite''::text,''pin''::text]))'
    and c.conkey=array[(select attnum from pg_attribute where attrelid=c.conrelid and attname='channel')]) then
    raise exception 'merchant_attendance_pin_schedule_constraint_conflict';end if;
  select x.*,regexp_replace(pg_get_expr(x.conbin,x.conrelid),'\s+','','g') expr into old_constraint from pg_constraint x
    where x.conrelid='public.merchant_attendance_shift_plan_adoptions'::regclass and x.conname='attendance_shift_plan_adoptions_channels_v2';
  if old_constraint.oid is not null then
    if old_constraint.contype<>'c' or not old_constraint.convalidated or old_constraint.connoinherit or old_constraint.expr<>'(channel=ANY(ARRAY[''location''::text,''onsite''::text]))'
      or old_constraint.conkey is distinct from array[(select attnum from pg_attribute where attrelid=old_constraint.conrelid and attname='channel')] then
      raise exception 'merchant_attendance_pin_schedule_constraint_conflict';end if;
    alter table public.merchant_attendance_shift_plan_adoptions drop constraint attendance_shift_plan_adoptions_channels_v2;
  elsif not exists(select 1 from public.faolla_schema_migrations where version=202610050143 and name='merchant_attendance_pin_schedule') then
    raise exception 'merchant_attendance_pin_schedule_installation_conflict';end if;
end;
$pin_schedule_cutover$;

-- Current PIN membership is a snapshot identity, not a request login actor.
create or replace function public.faolla_attendance_pin_schedule_receipt_v1(p public.merchant_attendance_shift_schedule_relations,p_auth uuid)
returns void language plpgsql set search_path=pg_catalog as $$
declare ev public.merchant_attendance_events%rowtype;q public.merchant_attendance_pin_clock_receipts%rowtype;
  w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
begin
  select * into ev from public.merchant_attendance_events where id=p.start_event_id;
  select * into q from public.merchant_attendance_pin_clock_receipts where event_id=p.start_event_id;
  select * into w from public.merchant_attendance_workers where merchant_id=p.merchant_id and id=p.worker_id;
  select * into e from public.merchant_enterprise_employees where merchant_id=p.merchant_id and id=p.employee_id;
  if p_auth is null or w.id is null or e.id is null or w.employee_id is distinct from p.employee_id
    or e.auth_user_id is distinct from p_auth or p.employee_auth_user_id is distinct from p_auth then raise exception 'attendance_access_denied';end if;
  if ev.id is null or q.event_id is null or ev.action<>'clock_in' or ev.source<>'kiosk' or ev.occurred_at<>ev.received_at
    or date_trunc('milliseconds',ev.occurred_at)<>ev.occurred_at
    or row(ev.merchant_id,ev.worker_id,ev.operation_id,ev.sequence,ev.location_id,ev.occurred_at,ev.time_zone,ev.actor_employee_id)
      is distinct from row(p.merchant_id,p.worker_id,p.operation_id,p.sequence,p.location_id,p.occurred_at,p.event_time_zone,p.employee_id)
    or row(q.merchant_id,q.worker_id,q.employee_id,q.operation_id) is distinct from row(p.merchant_id,p.worker_id,p.employee_id,p.operation_id)
    or q.terminal_id is null
    or not public.faolla_attendance_shift_rule_binding_object_v1(q.command,array['operationId','locationId','action','expectedSequence','expectedWorkerId','expectedEmployeeId'])
    or q.command->>'operationId' is distinct from p.operation_id::text or q.command->>'action' is distinct from 'clock_in'
    or q.command->>'locationId' is distinct from p.location_id::text or q.command->'expectedSequence' is distinct from to_jsonb(p.sequence-1)
    or coalesce(q.command->>'expectedSequence','')!~'^(0|[1-9][0-9]{0,15})$'
    or q.command->>'expectedWorkerId' is distinct from p.worker_id::text or q.command->>'expectedEmployeeId' is distinct from p.employee_id::text
    or p.binding_policy<>'employee-explicit-clock-in-v1'
    or exists(select 1 from public.merchant_attendance_location_clock_notices where event_id=ev.id)
    or exists(select 1 from public.merchant_attendance_location_results where event_id=ev.id)
    or exists(select 1 from public.merchant_attendance_onsite_receipts where event_id=ev.id) then raise exception 'attendance_pin_schedule_invalid';end if;
  --107's immutable receipt did not store a PIN, lease, hash or credential revision.
  --Authentication happened in106 before the business subtransaction. Never invent
  --historical authentication metadata or require a currently active terminal here.
end;
$$;

create or replace function public.faolla_attendance_shift_plan_adoption_v1(p public.merchant_attendance_shift_schedule_relations,p_auth uuid,
  p_approval_id uuid,p_current boolean,p_channel text)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare stream public.merchant_attendance_plan_rule_streams%rowtype;a public.merchant_attendance_plan_rule_operations%rowtype;
  f public.merchant_attendance_plan_rule_artifacts%rowtype;w public.merchant_attendance_workers%rowtype;s public.merchant_attendance_settings%rowtype;
  ref jsonb;state_name text;why text;target uuid:=p_approval_id;layer text;item jsonb;
  invalid_code text;fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_channel is null or p_channel not in('location','onsite','pin') then raise exception 'attendance_onsite_schedule_invalid';end if;
  invalid_code:=case when p_channel='location' then 'attendance_location_schedule_invalid' when p_channel='onsite' then 'attendance_onsite_schedule_invalid' else 'attendance_pin_schedule_invalid' end;
  if p_current is null or p_current and p_approval_id is not null then raise exception '%',invalid_code;end if;
  if p_channel='location' then perform public.faolla_attendance_location_schedule_receipt_v1(p,p_auth);
  elsif p_channel='onsite' then perform public.faolla_attendance_onsite_schedule_receipt_v1(p,p_auth);
  else perform public.faolla_attendance_pin_schedule_receipt_v1(p,p_auth);end if;
  if p.status='unselected' then state_name:='unselected';
  elsif p.status='unverified' then state_name:='unverified';why:=p.reason;
  elsif p.status='linked' then
    if p_current then
      select * into stream from public.merchant_attendance_plan_rule_streams x where x.merchant_id=p.merchant_id and x.slot_id=p.slot_id;
      if found then
        if row(stream.worker_id,stream.employee_id,stream.employee_auth_user_id) is distinct from row(p.worker_id,p.employee_id,p.employee_auth_user_id) then
          raise exception 'attendance_access_denied';end if;
        select * into a from public.merchant_attendance_plan_rule_operations x where x.merchant_id=p.merchant_id and x.slot_id=p.slot_id and x.revision=stream.revision;
        if a.operation_id is null then raise exception '%',invalid_code;end if;target:=a.operation_id;
      end if;
    elsif target is not null then
      select * into a from public.merchant_attendance_plan_rule_operations x where x.merchant_id=p.merchant_id and x.operation_id=target;
      if a.operation_id is null then raise exception '%',invalid_code;end if;
    end if;
    if target is null then state_name:='not_approved';why:='approval_missing';
    else
      select * into f from public.merchant_attendance_plan_rule_artifacts x where x.merchant_id=p.merchant_id and x.source_id=a.source_id;
      select * into w from public.merchant_attendance_workers where merchant_id=p.merchant_id and id=p.worker_id;
      select * into s from public.merchant_attendance_settings where merchant_id=p.merchant_id;
      if row(a.worker_id,a.slot_id,a.employee_id,a.employee_auth_user_id) is distinct from row(p.worker_id,p.slot_id,p.employee_id,p.employee_auth_user_id)
        or row(f.worker_id,f.slot_id,f.employee_id,f.employee_auth_user_id) is distinct from row(p.worker_id,p.slot_id,p.employee_id,p.employee_auth_user_id) then
        raise exception 'attendance_access_denied';end if;
      if f.source_id is null or public.faolla_attendance_plan_rule_command_v1(a.command) is distinct from true
        or a.command->>'operationId' is distinct from a.operation_id::text or a.command->'expectedRevision' is distinct from to_jsonb(a.revision-1)
        or a.command->>'employeeId' is distinct from p.employee_id::text or a.command->>'employeeAuthUserId' is distinct from p.employee_auth_user_id::text
        or a.command->>'expectedFingerprint' is distinct from f.source_sha256
        or f.source_sha256 is distinct from encode(sha256(convert_to(f.source::text,'UTF8')),'hex')
        or f.source_bytes is distinct from octet_length(convert_to(f.source::text,'UTF8'))
        or public.faolla_attendance_plan_rule_source_v1(f.source) is distinct from true
        or f.source->>'siteId' is distinct from p.merchant_id or f.source->>'workerId' is distinct from p.worker_id::text
        or f.source->>'employeeId' is distinct from p.employee_id::text or f.source->>'employeeAuthUserId' is distinct from p.employee_auth_user_id::text
        or (f.source->>'workerVersion')::bigint>w.version or (f.source->>'settingsVersion')::bigint>s.version
        or f.source->'slot' is distinct from jsonb_build_object('id',p.slot_snapshot->'id','revision',p.slot_snapshot->'revision',
          'locationId',p.slot_snapshot->'locationId','locationVersion',p.publication_snapshot->'locationVersion',
          'timeZone',p.slot_snapshot->'timeZone','startAt',p.slot_snapshot->'startAt','endAt',p.slot_snapshot->'endAt')
        or not isfinite(a.observed_at) or not isfinite(a.recorded_at) or a.observed_at>a.recorded_at
        or a.recorded_at>=(p.slot_snapshot->>'startAt')::timestamptz then raise exception '%',invalid_code;end if;
      foreach layer in array array['personal','group','enterprise'] loop
        item:=case when layer='personal' then f.source->layer->'approval' else f.source->layer->'publication' end;
        if item is not null and item<>'null'::jsonb and (item->>'recordedAt')::timestamptz>a.observed_at then raise exception '%',invalid_code;end if;
      end loop;
      -- Approval was visible under the worker mutex. Wall-clock metadata is
      -- preserved; no cross-entity monotonic/commit-time assertion is invented.
      state_name:='adopted';ref:=jsonb_build_object('operationId',a.operation_id,'revision',a.revision,'sourceId',a.source_id,
        'sourceSha256',f.source_sha256,'recordedAt',to_char(a.recorded_at at time zone 'UTC',fmt));
    end if;
  else raise exception '%',invalid_code;end if;
  if p.status<>'linked' and target is not null then raise exception '%',invalid_code;end if;
  return jsonb_build_object('startEventId',p.start_event_id,'operationId',p.operation_id,'channel',p_channel,
    'employeeId',p.employee_id,'employeeAuthUserId',p.employee_auth_user_id,'status',state_name,'reason',why,'approval',ref,
    'recordedAt',to_char(p.recorded_at at time zone 'UTC',fmt),'policy','explicit-plan-approval-at-clock-in-v1');
end;
$$;

create or replace function public.faolla_attendance_shift_plan_adoption_guard_v1()
returns trigger language plpgsql set search_path=pg_catalog as $$
declare rel public.merchant_attendance_shift_schedule_relations%rowtype;expected jsonb;invalid_code text;
begin
  invalid_code:=case when new.channel='pin' then 'attendance_pin_schedule_invalid' when new.channel='onsite' then 'attendance_onsite_schedule_invalid' else 'attendance_location_schedule_invalid' end;
  select * into rel from public.merchant_attendance_shift_schedule_relations where merchant_id=new.merchant_id and start_event_id=new.start_event_id;
  if rel.start_event_id is null or row(new.worker_id,new.operation_id,new.employee_id,new.employee_auth_user_id,new.slot_id,new.recorded_at)
    is distinct from row(rel.worker_id,rel.operation_id,rel.employee_id,rel.employee_auth_user_id,rel.slot_id,rel.recorded_at)
    or new.channel not in('location','onsite','pin') then raise exception '%',invalid_code;end if;
  expected:=public.faolla_attendance_shift_plan_adoption_v1(rel,new.employee_auth_user_id,null,true,new.channel);
  if new.adoption is distinct from expected or new.approval_operation_id::text is distinct from expected->'approval'->>'operationId' then
    raise exception '%',invalid_code;end if;
  return new;
end;
$$;

create or replace function public.faolla_attendance_self_schedule_guard_v1()
returns trigger language plpgsql set search_path=pg_catalog as $$
declare ev public.merchant_attendance_events%rowtype;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
  l public.merchant_attendance_locations%rowtype;s public.merchant_attendance_settings%rowtype;slot public.merchant_attendance_schedule_slots%rowtype;
  context jsonb;expected_reason text;local_day date;head bigint;
begin
  select * into ev from public.merchant_attendance_events where id=new.start_event_id;
  if ev.id is null or ev.merchant_id is distinct from new.merchant_id or ev.worker_id is distinct from new.worker_id
    or ev.operation_id is distinct from new.operation_id or ev.sequence is distinct from new.sequence or ev.location_id is distinct from new.location_id
    or ev.occurred_at is distinct from new.occurred_at or ev.time_zone is distinct from new.event_time_zone
    or ev.actor_employee_id is distinct from new.employee_id or ev.action<>'clock_in' or ev.source not in('web','kiosk')
    or ev.occurred_at<>ev.received_at then raise exception 'attendance_self_schedule_invalid';end if;
  -- A source label alone cannot authorize a PIN relation.
  if ev.source='kiosk' then perform public.faolla_attendance_pin_schedule_receipt_v1(new,new.employee_auth_user_id);end if;
  select * into w from public.merchant_attendance_workers where merchant_id=new.merchant_id and id=new.worker_id;
  select * into e from public.merchant_enterprise_employees where merchant_id=new.merchant_id and id=new.employee_id;
  select * into l from public.merchant_attendance_locations where merchant_id=new.merchant_id and id=new.location_id;
  select * into s from public.merchant_attendance_settings where merchant_id=new.merchant_id;
  if w.employee_id is distinct from new.employee_id or e.auth_user_id is distinct from new.employee_auth_user_id
    or w.version is distinct from new.worker_version or l.version is distinct from new.location_version or s.version is distinct from new.settings_version then
    raise exception 'attendance_self_schedule_invalid';end if;
  select coalesce(max(c.revision),0) into head from public.merchant_attendance_schedule_commands c where c.merchant_id=new.merchant_id;
  if head is distinct from new.schedule_revision then raise exception 'attendance_self_schedule_invalid';end if;
  if new.selection is null then
    if new.status<>'unselected' then raise exception 'attendance_self_schedule_invalid';end if;
    return new;
  end if;
  select * into slot from public.merchant_attendance_schedule_slots where merchant_id=new.merchant_id and id=new.slot_id;
  if slot.id is null or slot.worker_id is distinct from new.worker_id or slot.employee_id is distinct from new.employee_id
    or slot.revision is distinct from new.slot_revision then raise exception 'attendance_self_schedule_invalid';end if;
  context:=public.faolla_attendance_self_schedule_slot_v1(slot);
  if context->'publication'->>'employeeAuthUserId' is not null and context->'publication'->>'employeeAuthUserId'<>new.employee_auth_user_id::text then
    raise exception 'attendance_self_schedule_invalid';end if;
  if context->'slot' is distinct from new.slot_snapshot or nullif(context->'publication','null'::jsonb) is distinct from new.publication_snapshot
    or nullif(context->'cancellation','null'::jsonb) is distinct from new.cancellation_snapshot then raise exception 'attendance_self_schedule_invalid';end if;
  local_day:=(ev.occurred_at at time zone ev.time_zone)::date;
  expected_reason:=case when (context->'slot'->>'cancelled')::boolean then 'cancelled'
    when slot.location_id<>ev.location_id then 'location_changed' when slot.work_date<local_day-1 or slot.work_date>local_day+1 then 'outside_window'
    when not (context->'slot'->>'hasPublicationEvidence')::boolean then 'publication_missing' else null end;
  if new.reason is distinct from expected_reason or new.status is distinct from (case when expected_reason is null then 'linked' else 'unverified' end) then
    raise exception 'attendance_self_schedule_invalid';end if;
  return new;
end;
$$;

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
      or first_event.source not in('web','kiosk') or first_event.occurred_at<>first_event.received_at
      or saved.binding_policy<>'employee-explicit-clock-in-v1' or not isfinite(saved.recorded_at) or saved.recorded_at>observed
      or saved.worker_version not between 1 and 9007199254740991 or saved.location_version not between 1 and 9007199254740991
      or saved.settings_version not between 1 and 9007199254740991 or saved.schedule_revision not between 0 and 9007199254740990
      or saved.schedule_revision>0 and not exists(select 1 from public.merchant_attendance_schedule_commands x where x.merchant_id=site and x.revision=saved.schedule_revision) then
      raise exception 'attendance_shift_check_invalid';end if;
    if first_event.source='kiosk' then perform public.faolla_attendance_pin_schedule_receipt_v1(saved,member_auth);end if;
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

create or replace function public.faolla_attendance_pin_schedule_v1(p_site text,p_terminal uuid,p_secret_hash text,p_no text,p_lease uuid,p_verified boolean,p_request jsonb,p_allow_new boolean,
  p_selection jsonb default null,p_allow_schedule boolean default false,p_bind_rules boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare checked jsonb;c jsonb;op uuid;action_now text;expected bigint;worker_expected uuid;loc_expected uuid;
  s public.merchant_attendance_settings%rowtype;t public.merchant_attendance_terminals%rowtype;
  w public.merchant_attendance_workers%rowtype;l public.merchant_attendance_locations%rowtype;
  last_row public.merchant_attendance_events%rowtype;receipt public.merchant_attendance_events%rowtype;
  binding public.merchant_attendance_pin_clock_receipts%rowtype;
  seq bigint;status_now text;now_at timestamptz;lease_until timestamptz;today date;replayed boolean:=false;reason text;valid_uuid text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  e public.merchant_enterprise_employees%rowtype;ev public.merchant_attendance_events%rowtype;
  saved public.merchant_attendance_shift_schedule_relations%rowtype;proof public.merchant_attendance_shift_plan_adoptions%rowtype;
  slot public.merchant_attendance_schedule_slots%rowtype;candidates public.merchant_attendance_schedule_slots[];
  member_auth uuid;selected jsonb:=nullif(p_selection,'null'::jsonb);clock_result jsonb;choices jsonb;association jsonb;adoption jsonb;result jsonb;
  context jsonb;slot_item jsonb;publication_item jsonb;cancellation_item jsonb;current_cancellation jsonb;entries jsonb:='[]';
  head bigint;day_now date;first_day date;last_day date;zone text;limited boolean:=false;fresh boolean:=false;
  status_name text;reason_name text;current_cancelled boolean;was_cancelled boolean;
  fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_allow_schedule is null or p_bind_rules is null or p_allow_new is null then raise exception 'attendance_invalid_request';end if;
  if p_request is null or jsonb_typeof(p_request)<>'object' or (select count(*) from jsonb_object_keys(p_request))<>2
    or not(p_request ?& array['command','operationId']) then raise exception 'attendance_invalid_request';end if;
  c:=nullif(p_request->'command','null'::jsonb);
  if c is not null then
    if p_request->'operationId'<>'null'::jsonb or jsonb_typeof(c)<>'object' or (select count(*) from jsonb_object_keys(c))<>6
      or not(c ?& array['expectedWorkerId','expectedEmployeeId','operationId','locationId','action','expectedSequence'])
      or coalesce(c->>'action','') not in ('clock_in','break_start','break_end','clock_out')
      or coalesce(c->>'expectedEmployeeId','') !~ valid_uuid or coalesce(c->>'expectedWorkerId','') !~ valid_uuid or coalesce(c->>'operationId','') !~ valid_uuid or coalesce(c->>'locationId','') !~ valid_uuid
      or jsonb_typeof(c->'expectedSequence')<>'number' or coalesce(c->>'expectedSequence','') !~ '^(0|[1-9][0-9]{0,15})$'
      or (c->>'expectedSequence')::numeric>9007199254740990 then raise exception 'attendance_invalid_request';end if;
    op:=(c->>'operationId')::uuid;action_now:=c->>'action';expected:=(c->>'expectedSequence')::bigint;
    worker_expected:=(c->>'expectedWorkerId')::uuid;loc_expected:=(c->>'locationId')::uuid;
  elsif p_request->'operationId'<>'null'::jsonb then
    if coalesce(p_request->>'operationId','') !~ valid_uuid then raise exception 'attendance_invalid_request';end if;
    op:=(p_request->>'operationId')::uuid;
  end if;
  if c is null then
    if selected is not null then raise exception 'attendance_invalid_request';end if;
  else
    if c->>'action'<>'clock_in' then raise exception 'attendance_invalid_request';end if;
    if selected is not null and (not public.faolla_attendance_shift_rule_binding_object_v1(selected,array['slotId','revision'])
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(selected->'slotId','uuid')
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(selected->'revision','version')) then raise exception 'attendance_invalid_request';end if;
  end if;
  -- Finish consumes the lease and rechecks device/member/role/PIN revision.
  -- Its settings/employee/role/worker locks remain held UNTIL this RPC commits.
  -- true here enables authentication only; p_allow_new separately gates starts.
  select lease_expires into lease_until from public.merchant_attendance_pin_attempts where merchant_id=p_site and terminal_id=p_terminal and lease_id=p_lease;
  checked:=public.faolla_attendance_pin_finish_v1(p_site,p_terminal,p_secret_hash,p_no,p_lease,p_verified,true);
  if checked->>'verified'<>'true' then return jsonb_build_object('error','attendance_pin_denied');end if;
  -- Expected business denials roll back this subtransaction, NOT lease consumption.
  -- Never leave an inserted event without its origin-bound immutable receipt.
  begin
    -- Feature rollback denies new commands AFTER consuming the authenticated
    --lease; it does not turn state/recovery reads into unauthenticated GETs.
    if c is not null and not p_allow_schedule then raise exception 'attendance_pin_schedule_disabled';end if;
    select * into s from public.merchant_attendance_settings where merchant_id=p_site;
    select * into t from public.merchant_attendance_terminals where merchant_id=p_site and id=p_terminal;
    select * into w from public.merchant_attendance_workers where merchant_id=p_site and lower(btrim(worker_no))=lower(p_no);
    if c is not null and (w.id<>worker_expected or w.employee_id is distinct from (c->>'expectedEmployeeId')::uuid) then raise exception 'attendance_worker_changed';end if;
    select * into l from public.merchant_attendance_locations where merchant_id=p_site and id=t.location_id;
    select * into last_row from public.merchant_attendance_events where merchant_id=p_site and worker_id=w.id order by sequence desc limit 1;
    if last_row.id is not null and last_row.actor_employee_id is distinct from w.employee_id then
      raise exception 'attendance_access_denied';
    end if;
    seq:=coalesce(last_row.sequence,0);status_now:=case when last_row.id is null or last_row.action='clock_out' then 'off' when last_row.action='break_start' then 'break' else 'working' end;
    select * into receipt from public.merchant_attendance_events where merchant_id=p_site and worker_id=w.id and operation_id=op;
    if receipt.id is not null then
      select * into binding from public.merchant_attendance_pin_clock_receipts where event_id=receipt.id;
      if binding.event_id is null or binding.terminal_id<>p_terminal or binding.employee_id<>w.employee_id
        or receipt.actor_employee_id is distinct from w.employee_id or receipt.source<>'kiosk'
        or (c is not null and binding.command<>c) then raise exception 'attendance_operation_conflict';end if;
      replayed:=c is not null;
    end if;
    now_at:=date_trunc('milliseconds',clock_timestamp());today:=(now_at at time zone s.time_zone)::date;
    -- Re-date AFTER any membership/worker lock wait, not just before the wait.
    if lease_until is null or clock_timestamp()>=lease_until or clock_timestamp()<lease_until-interval '30 seconds'
      or now_at>=t.device_expires_at or now_at<t.paired_at then raise exception 'attendance_pin_denied';end if;
    reason:=case when l.id is null or not l.active or w.default_location_id is distinct from t.location_id then 'attendance_location_denied'
      when l.radius_meters is not null then 'attendance_location_verification_required'
      when (select count(*) from public.merchant_attendance_employment_periods where merchant_id=p_site and worker_id=w.id and starts_on<=today and (ends_on is null or ends_on>=today))<>1 then 'attendance_not_employed' else null end;
    if c is not null and not replayed then
      if seq<>expected then raise exception 'attendance_sequence_conflict';end if;
      if loc_expected<>t.location_id then raise exception 'attendance_location_denied';end if;
      if reason is not null then raise exception '%',reason;end if;
      if p_allow_new is distinct from true and action_now in ('clock_in','break_start') then raise exception 'attendance_platform_paused';end if;
      if last_row.id is not null and now_at<last_row.occurred_at then raise exception 'attendance_time_reversed';end if;
      if action_now='clock_in' and status_now<>'off' then raise exception 'attendance_already_clocked_in';end if;
      if action_now='break_start' and status_now<>'working' then raise exception 'attendance_not_working';end if;
      if action_now='break_end' and status_now<>'break' then raise exception 'attendance_not_on_break';end if;
      if action_now='clock_out' and status_now='break' then raise exception 'attendance_break_must_end';end if;
      if action_now='clock_out' and status_now='off' then raise exception 'attendance_not_clocked_in';end if;
      insert into public.merchant_attendance_events(merchant_id,worker_id,location_id,operation_id,sequence,action,source,break_paid,occurred_at,received_at,time_zone,actor_employee_id)
        values(p_site,w.id,t.location_id,op,seq+1,action_now,'kiosk',case when action_now='break_start' then s.web_break_paid else null end,now_at,now_at,l.time_zone,w.employee_id) returning * into receipt;
      insert into public.merchant_attendance_pin_clock_receipts values(receipt.id,p_site,p_terminal,w.id,w.employee_id,op,c);
      last_row:=receipt;seq:=receipt.sequence;status_now:=case when action_now='clock_out' then 'off' when action_now='break_start' then 'break' else 'working' end;
    end if;
    clock_result:=jsonb_build_object('siteId',p_site,'terminalId',p_terminal,'workerNo',w.worker_no,'workerName',w.display_name,'employeeId',w.employee_id,
      'workerId',w.id,'locationId',t.location_id,'state',jsonb_build_object('sequence',seq,'status',status_now,'lastEvent',public.faolla_attendance_event_receipt_v1(last_row)),
      'receipt',public.faolla_attendance_event_receipt_v1(receipt),'replayed',replayed,'canStart',reason is null and coalesce(p_allow_new,false),'canFinish',reason is null,'blockReason',reason);
    select * into e from public.merchant_enterprise_employees where merchant_id=p_site and id=w.employee_id;
    member_auth:=e.auth_user_id;
    if e.id is null or member_auth is null then raise exception 'attendance_access_denied';end if;
    if c is not null and not replayed and p_bind_rules then
      if receipt.action<>'clock_in' or receipt.operation_id is distinct from op or receipt.merchant_id is distinct from p_site then
        raise exception 'attendance_shift_rule_binding_invalid';end if;
      perform public.faolla_attendance_bind_shift_rules_v1(receipt.id,'pin',null);
    end if;
    select coalesce(max(x.revision),0) into head from public.merchant_attendance_schedule_commands x where x.merchant_id=p_site;
    choices:=jsonb_build_object('timeZone',null,'fromDate',null,'throughDate',null,'revision',head,'limited',false,'entries','[]'::jsonb);
  if clock_result->'receipt'<>'null'::jsonb then
    select * into ev from public.merchant_attendance_events where id=(clock_result->'receipt'->>'id')::uuid;
    if ev.id is null or ev.merchant_id is distinct from p_site or ev.worker_id is distinct from w.id or ev.actor_employee_id is distinct from e.id then raise exception 'attendance_pin_schedule_invalid';end if;
    select * into saved from public.merchant_attendance_shift_schedule_relations where merchant_id=p_site and start_event_id=ev.id;
    if found then
      if saved.worker_id is distinct from w.id or saved.operation_id is distinct from ev.operation_id or saved.employee_id is distinct from e.id
        or saved.employee_auth_user_id is distinct from member_auth then raise exception 'attendance_access_denied';end if;
      if c is not null and saved.selection is distinct from selected then raise exception 'attendance_operation_conflict';end if;
    elsif c is not null and clock_result->'replayed'='false'::jsonb then
      fresh:=true;
      if ev.action<>'clock_in' or ev.source<>'kiosk' or ev.location_id is distinct from l.id or ev.operation_id::text is distinct from c->>'operationId' then
        raise exception 'attendance_pin_schedule_invalid';end if;
      status_name:='unselected';reason_name:=null;
      if selected is not null then
        select * into slot from public.merchant_attendance_schedule_slots where merchant_id=p_site and id=(selected->>'slotId')::uuid;
        if slot.id is null or slot.worker_id is distinct from w.id or slot.employee_id is distinct from e.id then raise exception 'attendance_access_denied';end if;
        if slot.revision is distinct from (selected->>'revision')::bigint then raise exception 'attendance_invalid_request';end if;
        context:=public.faolla_attendance_self_schedule_slot_v1(slot);
        if context->'publication'->>'employeeAuthUserId' is not null and context->'publication'->>'employeeAuthUserId'<>member_auth::text then raise exception 'attendance_access_denied';end if;
        slot_item:=context->'slot';publication_item:=nullif(context->'publication','null'::jsonb);cancellation_item:=nullif(context->'cancellation','null'::jsonb);
        day_now:=(ev.occurred_at at time zone ev.time_zone)::date;
        reason_name:=case when (slot_item->>'cancelled')::boolean then 'cancelled' when slot.location_id<>ev.location_id then 'location_changed'
          when slot.work_date<day_now-1 or slot.work_date>day_now+1 then 'outside_window'
          when not (slot_item->>'hasPublicationEvidence')::boolean then 'publication_missing' else null end;
        status_name:=case when reason_name is null then 'linked' else 'unverified' end;
      end if;
      insert into public.merchant_attendance_shift_schedule_relations(merchant_id,start_event_id,worker_id,operation_id,sequence,location_id,occurred_at,event_time_zone,
        employee_id,employee_auth_user_id,worker_version,location_version,settings_version,selection,slot_id,slot_revision,schedule_revision,status,reason,
        slot_snapshot,publication_snapshot,cancellation_snapshot,recorded_at,binding_policy)
        values(p_site,ev.id,w.id,ev.operation_id,ev.sequence,ev.location_id,ev.occurred_at,ev.time_zone,e.id,member_auth,
          w.version,l.version,s.version,selected,slot.id,slot.revision,head,status_name,reason_name,
          slot_item,publication_item,cancellation_item,clock_timestamp(),'employee-explicit-clock-in-v1') returning * into saved;
      adoption:=public.faolla_attendance_shift_plan_adoption_v1(saved,member_auth,null,true,'pin');
      insert into public.merchant_attendance_shift_plan_adoptions(merchant_id,start_event_id,worker_id,operation_id,employee_id,employee_auth_user_id,
        channel,slot_id,approval_operation_id,adoption,recorded_at)
        values(p_site,ev.id,w.id,ev.operation_id,e.id,member_auth,'pin',saved.slot_id,
          (adoption->'approval'->>'operationId')::uuid,adoption,saved.recorded_at) returning * into proof;
    end if;
    -- Legacy receipts are not backfilled, even when a new selection is sent.
    if saved.start_event_id is not null then
      perform public.faolla_attendance_pin_schedule_receipt_v1(saved,member_auth);
      current_cancelled:=null;
      if saved.slot_id is not null then
        select * into slot from public.merchant_attendance_schedule_slots where merchant_id=p_site and id=saved.slot_id;
        if slot.id is null or slot.worker_id is distinct from saved.worker_id or slot.employee_id is distinct from saved.employee_id or slot.revision is distinct from saved.slot_revision then
          raise exception 'attendance_pin_schedule_invalid';end if;
        context:=public.faolla_attendance_self_schedule_slot_v1(slot);current_cancelled:=(context->'slot'->>'cancelled')::boolean;
        if context->'publication'->>'employeeAuthUserId' is not null and context->'publication'->>'employeeAuthUserId'<>member_auth::text then raise exception 'attendance_access_denied';end if;
        if (saved.slot_snapshot-'cancelled') is distinct from ((context->'slot')-'cancelled')
          or saved.publication_snapshot is distinct from nullif(context->'publication','null'::jsonb) then raise exception 'attendance_pin_schedule_invalid';end if;
        current_cancellation:=nullif(context->'cancellation','null'::jsonb);was_cancelled:=(saved.slot_snapshot->>'cancelled')::boolean;
        if was_cancelled then
          if not current_cancelled or saved.cancellation_snapshot is null or saved.cancellation_snapshot is distinct from current_cancellation
            or (current_cancellation->>'revision')::bigint>saved.schedule_revision then raise exception 'attendance_pin_schedule_invalid';end if;
        elsif saved.cancellation_snapshot is not null or current_cancelled and (current_cancellation->>'revision')::bigint<=saved.schedule_revision then
          raise exception 'attendance_pin_schedule_invalid';end if;
        -- Keep the insertion-time outside_window decision, without new tzdata.
        reason_name:=case when was_cancelled then 'cancelled' when slot.location_id<>ev.location_id then 'location_changed'
          when saved.reason='outside_window' then 'outside_window' when not (context->'slot'->>'hasPublicationEvidence')::boolean then 'publication_missing' else null end;
        if saved.reason is distinct from reason_name or saved.status is distinct from (case when reason_name is null then 'linked' else 'unverified' end) then
          raise exception 'attendance_pin_schedule_invalid';end if;
      end if;
      association:=jsonb_build_object('startEventId',saved.start_event_id,'operationId',saved.operation_id,'selection',saved.selection,'status',saved.status,'reason',saved.reason,
        'slot',saved.slot_snapshot,'observedRevision',saved.schedule_revision,'recordedAt',to_char(saved.recorded_at at time zone 'UTC',fmt),'currentCancelled',current_cancelled);
      if not fresh then select * into proof from public.merchant_attendance_shift_plan_adoptions where merchant_id=p_site and start_event_id=ev.id;end if;
      if proof.start_event_id is not null then
        if row(proof.worker_id,proof.operation_id,proof.employee_id,proof.employee_auth_user_id,proof.slot_id,proof.recorded_at)
          is distinct from row(saved.worker_id,saved.operation_id,saved.employee_id,saved.employee_auth_user_id,saved.slot_id,saved.recorded_at)
          or proof.channel<>'pin' then raise exception 'attendance_pin_schedule_invalid';end if;
        adoption:=public.faolla_attendance_shift_plan_adoption_v1(saved,member_auth,proof.approval_operation_id,false,'pin');
        if proof.adoption is distinct from adoption then raise exception 'attendance_pin_schedule_invalid';end if;
      end if;
    end if;
    if c is not null and proof.start_event_id is null then raise exception 'attendance_operation_conflict';end if;
  elsif c is not null then raise exception 'attendance_pin_schedule_invalid';end if;
  if fresh and (association is null or adoption is null) then raise exception 'attendance_pin_schedule_invalid';end if;

  -- A successful authenticated state read may offer bounded terminal/default
  --location candidates. Attempts and lease consumption are still intentional.
  if c is null and op is null and p_allow_schedule and clock_result->'canStart'='true'::jsonb and status_now='off' then
    zone:=l.time_zone;day_now:=(clock_timestamp() at time zone zone)::date;
    first_day:=greatest(day_now-1,date '2000-01-01');last_day:=least(day_now+1,date '2100-12-31');
    if first_day>last_day then raise exception 'attendance_pin_schedule_invalid';end if;
    candidates:=array(select x from public.merchant_attendance_schedule_slots x where x.merchant_id=p_site and x.worker_id=w.id
      and x.work_date between first_day and last_day order by x.work_date,x.start_at,x.id limit 101);
    limited:=cardinality(candidates)>100;
    if not limited then foreach slot in array candidates loop
      if slot.employee_id<>e.id or slot.location_id<>l.id then continue;end if;
      context:=public.faolla_attendance_self_schedule_slot_v1(slot);
      if context->'publication'->>'employeeAuthUserId' is not null and context->'publication'->>'employeeAuthUserId'<>member_auth::text then continue;end if;
      entries:=entries||jsonb_build_array(context->'slot');
    end loop;end if;
    choices:=jsonb_build_object('timeZone',zone,'fromDate',to_char(first_day,'YYYY-MM-DD'),'throughDate',to_char(last_day,'YYYY-MM-DD'),'revision',head,'limited',limited,'entries',entries);
    if octet_length(convert_to(choices::text,'UTF8'))>48000 then choices:=jsonb_build_object('timeZone',zone,'fromDate',to_char(first_day,'YYYY-MM-DD'),
      'throughDate',to_char(last_day,'YYYY-MM-DD'),'revision',head,'limited',true,'entries','[]'::jsonb);end if;
  end if;

    result:=jsonb_build_object('protocol','pin-schedule-v1','clock',clock_result,'choices',choices,'association',association,'adoption',adoption);
    if octet_length(convert_to(result::text,'UTF8'))>65536 then raise exception 'attendance_pin_schedule_invalid';end if;
    return result;
  exception when raise_exception then
    if sqlerrm in ('attendance_access_denied','attendance_pin_denied','attendance_worker_changed','attendance_operation_conflict','attendance_sequence_conflict','attendance_location_denied','attendance_location_verification_required',
      'attendance_not_employed','attendance_platform_paused','attendance_time_reversed','attendance_already_clocked_in','attendance_not_working','attendance_not_on_break','attendance_break_must_end','attendance_not_clocked_in',
      'attendance_invalid_request','attendance_pin_schedule_disabled','attendance_pin_schedule_invalid',
      'attendance_self_schedule_invalid','attendance_plan_rule_invalid','attendance_shift_rule_binding_invalid') then
      return jsonb_build_object('error',sqlerrm);
    end if;
    -- Unknown storage, constraint, cancellation or infrastructure errors retain
    --112's outer failure semantics: the whole transaction (including lease)
    --rolls back. Do not disguise these as expected authentication outcomes.
    raise;
  end;
end;$$;

revoke all on function public.faolla_attendance_pin_schedule_receipt_v1(public.merchant_attendance_shift_schedule_relations,uuid),
  public.faolla_attendance_shift_plan_adoption_v1(public.merchant_attendance_shift_schedule_relations,uuid,uuid,boolean,text),
  public.faolla_attendance_shift_plan_adoption_guard_v1(),
  public.faolla_attendance_self_schedule_guard_v1(),
  public.faolla_attendance_pin_schedule_v1(text,uuid,text,text,uuid,boolean,jsonb,boolean,jsonb,boolean,boolean),
  public.faolla_attendance_shift_check_v1(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_pin_schedule_v1(text,uuid,text,text,uuid,boolean,jsonb,boolean,jsonb,boolean,boolean) to service_role;
grant execute on function public.faolla_attendance_shift_check_v1(jsonb,uuid) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610050143,'merchant_attendance_pin_schedule') on conflict(version) do nothing;

do $pin_schedule_postconditions$
declare r text;p text;fn regprocedure;trig text;kind smallint;target text;
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610050143 and name='merchant_attendance_pin_schedule') then
    raise exception 'merchant_attendance_pin_schedule_registry_postcondition_failed';end if;
  if exists(select 1 from pg_constraint where conrelid='public.merchant_attendance_shift_plan_adoptions'::regclass and conname='attendance_shift_plan_adoptions_channels_v2')
    or not exists(select 1 from pg_constraint c where c.conrelid='public.merchant_attendance_shift_plan_adoptions'::regclass
      and c.conname='attendance_shift_plan_adoptions_channels_v3' and c.contype='c' and c.convalidated and not c.connoinherit
    and regexp_replace(pg_get_expr(c.conbin,c.conrelid),'\s+','','g')='(channel=ANY(ARRAY[''location''::text,''onsite''::text,''pin''::text]))'
    and c.conkey=array[(select attnum from pg_attribute where attrelid=c.conrelid and attname='channel')]) then
    raise exception 'merchant_attendance_pin_schedule_constraint_conflict';end if;
  foreach target in array array['merchant_attendance_shift_schedule_relations','merchant_attendance_shift_plan_adoptions'] loop
    if not exists(select 1 from pg_class where oid=('public.'||target)::regclass and relrowsecurity)
      or exists(select 1 from pg_policy where polrelid=('public.'||target)::regclass) then
      raise exception 'merchant_attendance_pin_schedule_rls_postcondition_failed';end if;
  end loop;
  for target,trig,fn,kind in select * from (values
    ('merchant_attendance_shift_schedule_relations','attendance_self_schedule_insert','public.faolla_attendance_self_schedule_guard_v1()'::regprocedure,7::smallint),
    ('merchant_attendance_shift_schedule_relations','attendance_self_schedule_immutable','public.faolla_attendance_events_append_only_v1()'::regprocedure,27::smallint),
    ('merchant_attendance_shift_schedule_relations','attendance_self_schedule_no_truncate','public.faolla_attendance_events_append_only_v1()'::regprocedure,34::smallint),
    ('merchant_attendance_shift_plan_adoptions','attendance_shift_plan_adoption_insert','public.faolla_attendance_shift_plan_adoption_guard_v1()'::regprocedure,7::smallint),
    ('merchant_attendance_shift_plan_adoptions','attendance_shift_plan_adoption_immutable','public.faolla_attendance_events_append_only_v1()'::regprocedure,27::smallint),
    ('merchant_attendance_shift_plan_adoptions','attendance_shift_plan_adoption_no_truncate','public.faolla_attendance_events_append_only_v1()'::regprocedure,34::smallint)) expected(tab,name,func,type) loop
    if not exists(select 1 from pg_trigger t where t.tgrelid=('public.'||target)::regclass and t.tgname=trig
      and not t.tgisinternal and t.tgfoid=fn::oid and t.tgtype=kind and t.tgenabled in('O','A') and t.tgqual is null and t.tgnargs=0) then
      raise exception 'merchant_attendance_pin_schedule_trigger_conflict';end if;
  end loop;
  foreach r in array array['anon','authenticated','service_role'] loop
    foreach target in array array['merchant_attendance_shift_schedule_relations','merchant_attendance_shift_plan_adoptions'] loop
      if exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
        where c.oid=('public.'||target)::regclass and (a.grantee=0 or pg_has_role(r,a.grantee,'USAGE')))
        or exists(select 1 from pg_attribute c cross join lateral aclexplode(c.attacl) a
          where c.attrelid=('public.'||target)::regclass and c.attnum>0 and not c.attisdropped
            and (a.grantee=0 or pg_has_role(r,a.grantee,'USAGE'))) then raise exception 'merchant_attendance_pin_schedule_acl_postcondition_failed';end if;
    end loop;
    foreach p in array array['public.faolla_attendance_pin_schedule_receipt_v1(public.merchant_attendance_shift_schedule_relations,uuid)',
      'public.faolla_attendance_shift_plan_adoption_v1(public.merchant_attendance_shift_schedule_relations,uuid,uuid,boolean,text)',
      'public.faolla_attendance_shift_plan_adoption_guard_v1()',
      'public.faolla_attendance_self_schedule_guard_v1()'] loop
      if has_function_privilege(r,p,'EXECUTE') then raise exception 'merchant_attendance_pin_schedule_acl_postcondition_failed';end if;
    end loop;
    foreach p in array array['public.faolla_attendance_pin_schedule_v1(text,uuid,text,text,uuid,boolean,jsonb,boolean,jsonb,boolean,boolean)',
      'public.faolla_attendance_shift_check_v1(jsonb,uuid)',
      'public.faolla_attendance_pin_clock_v1(text,uuid,text,text,uuid,boolean,jsonb,boolean)',
      'public.faolla_attendance_pin_clock_bound_v1(text,uuid,text,text,uuid,boolean,jsonb,boolean)',
      'public.faolla_attendance_onsite_schedule_v1(text,uuid,jsonb,jsonb,uuid,boolean,jsonb,boolean,boolean)',
      'public.faolla_attendance_location_schedule_v1(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean,jsonb,boolean,boolean)'] loop
      if has_function_privilege(r,p,'EXECUTE') is distinct from (r='service_role') then raise exception 'merchant_attendance_pin_schedule_acl_postcondition_failed';end if;
    end loop;
  end loop;
  if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid in('public.faolla_attendance_pin_schedule_receipt_v1(public.merchant_attendance_shift_schedule_relations,uuid)'::regprocedure,
      'public.faolla_attendance_shift_plan_adoption_v1(public.merchant_attendance_shift_schedule_relations,uuid,uuid,boolean,text)'::regprocedure,
      'public.faolla_attendance_shift_plan_adoption_guard_v1()'::regprocedure,
      'public.faolla_attendance_self_schedule_guard_v1()'::regprocedure,
      'public.faolla_attendance_pin_schedule_v1(text,uuid,text,text,uuid,boolean,jsonb,boolean,jsonb,boolean,boolean)'::regprocedure,
      'public.faolla_attendance_shift_check_v1(jsonb,uuid)'::regprocedure)
      and a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'merchant_attendance_pin_schedule_acl_postcondition_failed';end if;
end;
$pin_schedule_postconditions$;
commit;
