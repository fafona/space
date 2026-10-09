-- Ordinary-self actual plan-approval reference. Original111/134/137 remain
--unchanged. Three committed CHECK stages preserve all three existing channels
--until the short atomic helper/RPC installation. No new table or backfill.
begin;
set local lock_timeout='3s';
do $self_schedule_adoption_prerequisites$
declare installed boolean;v bigint;n text;p text;c record;
begin
  for v,n in select * from (values
    (202610020111::bigint,'merchant_attendance_self_clock_identity'),(202610040134::bigint,'merchant_attendance_bound_clocks'),
    (202610050137::bigint,'merchant_attendance_self_schedule'),(202610050140::bigint,'merchant_attendance_plan_rule_approvals'),
    (202610050143::bigint,'merchant_attendance_pin_schedule')) required(version,name) loop
    if not exists(select 1 from public.faolla_schema_migrations where version=v and name=n) then raise exception 'merchant_attendance_self_schedule_adoption_prerequisite_required';end if;
  end loop;
  foreach p in array array['public.faolla_attendance_self_schedule_v1(text,uuid,jsonb,jsonb,uuid,boolean,boolean)',
    'public.faolla_attendance_self_schedule_slot_v1(public.merchant_attendance_schedule_slots)',
    'public.faolla_attendance_shift_plan_adoption_v1(public.merchant_attendance_shift_schedule_relations,uuid,uuid,boolean,text)',
    'public.faolla_attendance_shift_plan_adoption_guard_v1()',
    'public.faolla_attendance_location_schedule_receipt_v1(public.merchant_attendance_shift_schedule_relations,uuid)',
    'public.faolla_attendance_onsite_schedule_receipt_v1(public.merchant_attendance_shift_schedule_relations,uuid)',
    'public.faolla_attendance_pin_schedule_receipt_v1(public.merchant_attendance_shift_schedule_relations,uuid)'] loop
    if to_regprocedure(p) is null then raise exception 'merchant_attendance_self_schedule_adoption_prerequisite_required';end if;
  end loop;
  select exists(select 1 from public.faolla_schema_migrations where version=202610050144 and name='merchant_attendance_self_schedule_adoption') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610050144 and name<>'merchant_attendance_self_schedule_adoption') then
    raise exception 'merchant_attendance_self_schedule_adoption_installation_conflict';end if;
  foreach p in array array['public.faolla_attendance_self_schedule_receipt_v1(public.merchant_attendance_shift_schedule_relations,uuid)',
    'public.faolla_attendance_self_schedule_adoption_v1(text,uuid,jsonb,jsonb,uuid,boolean,boolean)'] loop
    if installed<>(to_regprocedure(p) is not null) then raise exception 'merchant_attendance_self_schedule_adoption_installation_conflict';end if;
  end loop;
  select x.*,regexp_replace(pg_get_expr(x.conbin,x.conrelid),'\s+','','g') expr into c from pg_constraint x
    where x.conrelid='public.merchant_attendance_shift_plan_adoptions'::regclass and x.conname='attendance_shift_plan_adoptions_channels_v3';
  if installed then
    if c.oid is not null then raise exception 'merchant_attendance_self_schedule_adoption_constraint_conflict';end if;
  elsif c.oid is null or c.contype<>'c' or not c.convalidated or c.connoinherit or c.expr<>'(channel=ANY(ARRAY[''location''::text,''onsite''::text,''pin''::text]))'
    or c.conkey is distinct from array[(select attnum from pg_attribute where attrelid=c.conrelid and attname='channel')] then
    raise exception 'merchant_attendance_self_schedule_adoption_constraint_conflict';end if;
  select x.*,regexp_replace(pg_get_expr(x.conbin,x.conrelid),'\s+','','g') expr into c from pg_constraint x
    where x.conrelid='public.merchant_attendance_shift_plan_adoptions'::regclass and x.conname='attendance_shift_plan_adoptions_channels_v4';
  if c.oid is not null and (c.contype<>'c' or c.connoinherit or c.expr<>'(channel=ANY(ARRAY[''location''::text,''onsite''::text,''pin''::text,''self''::text]))'
    or c.conkey is distinct from array[(select attnum from pg_attribute where attrelid=c.conrelid and attname='channel')]) then
    raise exception 'merchant_attendance_self_schedule_adoption_constraint_conflict';end if;
  if installed and (c.oid is null or not c.convalidated) then raise exception 'merchant_attendance_self_schedule_adoption_constraint_conflict';end if;
  if c.oid is null then
    alter table public.merchant_attendance_shift_plan_adoptions add constraint attendance_shift_plan_adoptions_channels_v4 check(channel in('location','onsite','pin','self')) not valid;
  end if;
end;
$self_schedule_adoption_prerequisites$;
commit;

-- The validation scan holds no preceding ADD/DROP ACCESS EXCLUSIVE lock.
begin;
set local lock_timeout='3s';
alter table public.merchant_attendance_shift_plan_adoptions validate constraint attendance_shift_plan_adoptions_channels_v4;
do $self_schedule_adoption_validation$
begin
  if not exists(select 1 from pg_constraint c where c.conrelid='public.merchant_attendance_shift_plan_adoptions'::regclass
    and c.conname='attendance_shift_plan_adoptions_channels_v4' and c.contype='c' and c.convalidated and not c.connoinherit
    and regexp_replace(pg_get_expr(c.conbin,c.conrelid),'\s+','','g')='(channel=ANY(ARRAY[''location''::text,''onsite''::text,''pin''::text,''self''::text]))'
    and c.conkey=array[(select attnum from pg_attribute where attrelid=c.conrelid and attname='channel')]) then
    raise exception 'merchant_attendance_self_schedule_adoption_constraint_conflict';end if;
end;
$self_schedule_adoption_validation$;
commit;

begin;
set local lock_timeout='3s';
do $self_schedule_adoption_cutover$
declare old_constraint record;
begin
  if not exists(select 1 from pg_constraint c where c.conrelid='public.merchant_attendance_shift_plan_adoptions'::regclass
    and c.conname='attendance_shift_plan_adoptions_channels_v4' and c.contype='c' and c.convalidated and not c.connoinherit
    and regexp_replace(pg_get_expr(c.conbin,c.conrelid),'\s+','','g')='(channel=ANY(ARRAY[''location''::text,''onsite''::text,''pin''::text,''self''::text]))'
    and c.conkey=array[(select attnum from pg_attribute where attrelid=c.conrelid and attname='channel')]) then
    raise exception 'merchant_attendance_self_schedule_adoption_constraint_conflict';end if;
  select x.*,regexp_replace(pg_get_expr(x.conbin,x.conrelid),'\s+','','g') expr into old_constraint from pg_constraint x
    where x.conrelid='public.merchant_attendance_shift_plan_adoptions'::regclass and x.conname='attendance_shift_plan_adoptions_channels_v3';
  if old_constraint.oid is not null then
    if old_constraint.contype<>'c' or not old_constraint.convalidated or old_constraint.connoinherit or old_constraint.expr<>'(channel=ANY(ARRAY[''location''::text,''onsite''::text,''pin''::text]))'
      or old_constraint.conkey is distinct from array[(select attnum from pg_attribute where attrelid=old_constraint.conrelid and attname='channel')] then
      raise exception 'merchant_attendance_self_schedule_adoption_constraint_conflict';end if;
    alter table public.merchant_attendance_shift_plan_adoptions drop constraint attendance_shift_plan_adoptions_channels_v3;
  elsif not exists(select 1 from public.faolla_schema_migrations where version=202610050144 and name='merchant_attendance_self_schedule_adoption') then
    raise exception 'merchant_attendance_self_schedule_adoption_installation_conflict';end if;
end;
$self_schedule_adoption_cutover$;


-- Ordinary self has no separate channel receipt. Only a fresh137 result may
--create its sidecar; this proof binds the immutable137 relation and excludes
--every existing other-channel receipt. It does not backfill unknown history.
create or replace function public.faolla_attendance_self_schedule_receipt_v1(p public.merchant_attendance_shift_schedule_relations,p_auth uuid)
returns void language plpgsql set search_path=pg_catalog as $$
declare ev public.merchant_attendance_events%rowtype;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
  slot public.merchant_attendance_schedule_slots%rowtype;context jsonb;current_cancellation jsonb;
  was_cancelled boolean;current_cancelled boolean;expected_reason text;
begin
  select * into ev from public.merchant_attendance_events where id=p.start_event_id;
  select * into w from public.merchant_attendance_workers where merchant_id=p.merchant_id and id=p.worker_id;
  select * into e from public.merchant_enterprise_employees where merchant_id=p.merchant_id and id=p.employee_id;
  if p_auth is null or w.id is null or e.id is null or w.employee_id is distinct from p.employee_id
    or e.auth_user_id is distinct from p_auth or p.employee_auth_user_id is distinct from p_auth then raise exception 'attendance_access_denied';end if;
  if ev.id is null or ev.action<>'clock_in' or ev.occurred_at<>ev.received_at
    or date_trunc('milliseconds',ev.occurred_at)<>ev.occurred_at
    or row(ev.merchant_id,ev.worker_id,ev.operation_id,ev.sequence,ev.location_id,ev.occurred_at,ev.time_zone,ev.actor_employee_id)
      is distinct from row(p.merchant_id,p.worker_id,p.operation_id,p.sequence,p.location_id,p.occurred_at,p.event_time_zone,p.employee_id)
    or p.binding_policy<>'employee-explicit-clock-in-v1' or not isfinite(p.recorded_at) then raise exception 'attendance_self_schedule_adoption_invalid';end if;
  if ev.source<>'web'
    or exists(select 1 from public.merchant_attendance_location_clock_notices where event_id=ev.id)
    or exists(select 1 from public.merchant_attendance_location_results where event_id=ev.id)
    or exists(select 1 from public.merchant_attendance_onsite_receipts where event_id=ev.id)
    or exists(select 1 from public.merchant_attendance_pin_clock_receipts where event_id=ev.id)
    or exists(select 1 from public.merchant_attendance_shift_plan_adoptions where merchant_id=p.merchant_id and start_event_id=ev.id and channel<>'self') then
    raise exception 'attendance_operation_conflict';end if;
  if p.selection is null then
    if p.status<>'unselected' or p.reason is not null or p.slot_id is not null or p.slot_revision is not null
      or p.slot_snapshot is not null or p.publication_snapshot is not null or p.cancellation_snapshot is not null then
      raise exception 'attendance_self_schedule_adoption_invalid';end if;
    return;
  end if;
  select * into slot from public.merchant_attendance_schedule_slots where merchant_id=p.merchant_id and id=p.slot_id;
  if slot.id is null or slot.worker_id is distinct from p.worker_id or slot.employee_id is distinct from p.employee_id
    or slot.revision is distinct from p.slot_revision or p.slot_revision>p.schedule_revision
    or p.selection is distinct from jsonb_build_object('slotId',slot.id,'revision',slot.revision) then
    raise exception 'attendance_self_schedule_adoption_invalid';end if;
  context:=public.faolla_attendance_self_schedule_slot_v1(slot);
  if context->'publication'->>'employeeAuthUserId' is not null and context->'publication'->>'employeeAuthUserId'<>p_auth::text then
    raise exception 'attendance_access_denied';end if;
  if (p.slot_snapshot-'cancelled') is distinct from ((context->'slot')-'cancelled')
    or p.publication_snapshot is distinct from nullif(context->'publication','null'::jsonb) then raise exception 'attendance_self_schedule_adoption_invalid';end if;
  was_cancelled:=(p.slot_snapshot->>'cancelled')::boolean;current_cancelled:=(context->'slot'->>'cancelled')::boolean;
  current_cancellation:=nullif(context->'cancellation','null'::jsonb);
  if was_cancelled then
    if not current_cancelled or p.cancellation_snapshot is null or p.cancellation_snapshot is distinct from current_cancellation
      or (current_cancellation->>'revision')::bigint>p.schedule_revision then raise exception 'attendance_self_schedule_adoption_invalid';end if;
  elsif p.cancellation_snapshot is not null or current_cancelled and (current_cancellation->>'revision')::bigint<=p.schedule_revision then
    raise exception 'attendance_self_schedule_adoption_invalid';end if;
  -- Keep the insertion-time window decision; do not reinterpret saved zones.
  expected_reason:=case when was_cancelled then 'cancelled' when slot.location_id<>ev.location_id then 'location_changed'
    when p.reason='outside_window' then 'outside_window' when not (context->'slot'->>'hasPublicationEvidence')::boolean then 'publication_missing' else null end;
  if p.reason is distinct from expected_reason or p.status is distinct from (case when expected_reason is null then 'linked' else 'unverified' end) then
    raise exception 'attendance_self_schedule_adoption_invalid';end if;
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
  if p_channel is null or p_channel not in('location','onsite','pin','self') then raise exception 'attendance_onsite_schedule_invalid';end if;
  invalid_code:=case when p_channel='location' then 'attendance_location_schedule_invalid' when p_channel='onsite' then 'attendance_onsite_schedule_invalid' when p_channel='pin' then 'attendance_pin_schedule_invalid' else 'attendance_self_schedule_adoption_invalid' end;
  if p_current is null or p_current and p_approval_id is not null then raise exception '%',invalid_code;end if;
  if p_channel='location' then perform public.faolla_attendance_location_schedule_receipt_v1(p,p_auth);
  elsif p_channel='onsite' then perform public.faolla_attendance_onsite_schedule_receipt_v1(p,p_auth);
  elsif p_channel='pin' then perform public.faolla_attendance_pin_schedule_receipt_v1(p,p_auth);
  else perform public.faolla_attendance_self_schedule_receipt_v1(p,p_auth);end if;
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
  invalid_code:=case when new.channel='self' then 'attendance_self_schedule_adoption_invalid' when new.channel='pin' then 'attendance_pin_schedule_invalid' when new.channel='onsite' then 'attendance_onsite_schedule_invalid' else 'attendance_location_schedule_invalid' end;
  select * into rel from public.merchant_attendance_shift_schedule_relations where merchant_id=new.merchant_id and start_event_id=new.start_event_id;
  if rel.start_event_id is null or row(new.worker_id,new.operation_id,new.employee_id,new.employee_auth_user_id,new.slot_id,new.recorded_at)
    is distinct from row(rel.worker_id,rel.operation_id,rel.employee_id,rel.employee_auth_user_id,rel.slot_id,rel.recorded_at)
    or new.channel not in('location','onsite','pin','self') then raise exception '%',invalid_code;end if;
  expected:=public.faolla_attendance_shift_plan_adoption_v1(rel,new.employee_auth_user_id,null,true,new.channel);
  if new.adoption is distinct from expected or new.approval_operation_id::text is distinct from expected->'approval'->>'operationId' then
    raise exception '%',invalid_code;end if;
  return new;
end;
$$;

create or replace function public.faolla_attendance_self_schedule_adoption_v1(p_site_id text,p_auth_user_id uuid,p_command jsonb default null,
  p_selection jsonb default null,p_operation_id uuid default null,p_allow_write boolean default false,p_bind_rules boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare base jsonb;clock_result jsonb;adoption jsonb:=null;result jsonb;selected jsonb:=nullif(p_selection,'null'::jsonb);
  ev public.merchant_attendance_events%rowtype;saved public.merchant_attendance_shift_schedule_relations%rowtype;
  proof public.merchant_attendance_shift_plan_adoptions%rowtype;fresh boolean:=false;
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null
    or p_allow_write is null or p_bind_rules is null then raise exception 'attendance_invalid_request';end if;
  if p_command is null then
    if selected is not null then raise exception 'attendance_invalid_request';end if;
  else
    if p_operation_id is not null or not public.faolla_attendance_shift_rule_binding_object_v1(p_command,
      array['operationId','locationId','action','expectedSequence','expectedWorkerId'])
      or p_command->>'action' is distinct from 'clock_in' then raise exception 'attendance_invalid_request';end if;
    if selected is not null and (not public.faolla_attendance_shift_rule_binding_object_v1(selected,array['slotId','revision'])
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(selected->'slotId','uuid')
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(selected->'revision','version')) then raise exception 'attendance_invalid_request';end if;
    if not p_allow_write then raise exception 'attendance_self_schedule_adoption_disabled';end if;
  end if;
  -- Exactly one137 call retains111's settings SHARE, employee/role SHARE and
  --worker UPDATE (SHARE for reads). No reverse merchant lock or owner RPC.
  --An operation-only GET does not enumerate today's candidates.
  base:=public.faolla_attendance_self_schedule_v1(p_site_id,p_auth_user_id,p_command,p_selection,p_operation_id,
    case when p_command is null and p_operation_id is not null then false else p_allow_write end,p_bind_rules);
  if not public.faolla_attendance_shift_rule_binding_object_v1(base,array['protocol','clock','choices','association'])
    or base->>'protocol' is distinct from 'self-schedule-v1' then raise exception 'attendance_self_schedule_adoption_invalid';end if;
  clock_result:=base->'clock';
  if clock_result->'replayed' is distinct from 'true'::jsonb and clock_result->'replayed' is distinct from 'false'::jsonb then
    raise exception 'attendance_self_schedule_adoption_invalid';end if;
  if clock_result->'receipt'<>'null'::jsonb then
    select * into ev from public.merchant_attendance_events where id=(clock_result->'receipt'->>'id')::uuid;
    if ev.id is null or ev.merchant_id is distinct from p_site_id or ev.worker_id::text is distinct from clock_result->>'workerId'
      or ev.operation_id::text is distinct from clock_result->'receipt'->>'operationId' then raise exception 'attendance_self_schedule_adoption_invalid';end if;
    --111 deliberately supports same-member cross-channel old receipts. The new
    --protocol must NOT label them ordinary self, even on read-only recovery.
    if ev.source<>'web'
      or exists(select 1 from public.merchant_attendance_location_clock_notices where event_id=ev.id)
      or exists(select 1 from public.merchant_attendance_location_results where event_id=ev.id)
      or exists(select 1 from public.merchant_attendance_onsite_receipts where event_id=ev.id)
      or exists(select 1 from public.merchant_attendance_pin_clock_receipts where event_id=ev.id) then raise exception 'attendance_operation_conflict';end if;
    -- Original111 checks only action/location on replay. The new protocol binds
    --all five original command values, without changing legacy111/137 semantics.
    if p_command is not null and p_command is distinct from jsonb_build_object('operationId',ev.operation_id,'locationId',ev.location_id,
      'action',ev.action,'expectedSequence',ev.sequence-1,'expectedWorkerId',ev.worker_id) then raise exception 'attendance_operation_conflict';end if;
    select * into saved from public.merchant_attendance_shift_schedule_relations where merchant_id=p_site_id and start_event_id=ev.id;
    select * into proof from public.merchant_attendance_shift_plan_adoptions where merchant_id=p_site_id and start_event_id=ev.id;
    if proof.start_event_id is not null and proof.channel<>'self' then raise exception 'attendance_operation_conflict';end if;
    fresh:=p_command is not null and clock_result->'replayed'='false'::jsonb;
    if saved.start_event_id is not null then
      perform public.faolla_attendance_self_schedule_receipt_v1(saved,p_auth_user_id);
      if saved.selection is distinct from selected and p_command is not null then raise exception 'attendance_operation_conflict';end if;
      if base->'association'='null'::jsonb or base->'association'->>'startEventId' is distinct from saved.start_event_id::text
        or base->'association'->>'operationId' is distinct from saved.operation_id::text then raise exception 'attendance_self_schedule_adoption_invalid';end if;
      if fresh then
        if proof.start_event_id is not null then raise exception 'attendance_self_schedule_adoption_invalid';end if;
        adoption:=public.faolla_attendance_shift_plan_adoption_v1(saved,p_auth_user_id,null,true,'self');
        insert into public.merchant_attendance_shift_plan_adoptions(merchant_id,start_event_id,worker_id,operation_id,employee_id,employee_auth_user_id,
          channel,slot_id,approval_operation_id,adoption,recorded_at)
          values(p_site_id,ev.id,saved.worker_id,saved.operation_id,saved.employee_id,saved.employee_auth_user_id,
            'self',saved.slot_id,(adoption->'approval'->>'operationId')::uuid,adoption,saved.recorded_at) returning * into proof;
      end if;
      if proof.start_event_id is not null then
        if row(proof.worker_id,proof.operation_id,proof.employee_id,proof.employee_auth_user_id,proof.slot_id,proof.recorded_at)
          is distinct from row(saved.worker_id,saved.operation_id,saved.employee_id,saved.employee_auth_user_id,saved.slot_id,saved.recorded_at) then
          raise exception 'attendance_self_schedule_adoption_invalid';end if;
        adoption:=public.faolla_attendance_shift_plan_adoption_v1(saved,p_auth_user_id,proof.approval_operation_id,false,'self');
        if proof.adoption is distinct from adoption then raise exception 'attendance_self_schedule_adoption_invalid';end if;
      end if;
    elsif proof.start_event_id is not null or base->'association'<>'null'::jsonb then raise exception 'attendance_self_schedule_adoption_invalid';end if;
    -- Only a fresh137 write may collect. An old137/plain self receipt can be
    --read as legacy (including its old relation), but never backfilled on POST.
    if fresh and (saved.start_event_id is null or proof.start_event_id is null or adoption is null) then raise exception 'attendance_self_schedule_adoption_invalid';end if;
    if p_command is not null and (saved.start_event_id is null or proof.start_event_id is null or adoption is null) then
      raise exception 'attendance_operation_conflict';end if;
  elsif p_command is not null or base->'association'<>'null'::jsonb then raise exception 'attendance_self_schedule_adoption_invalid';end if;
  result:=jsonb_build_object('protocol','self-schedule-adoption-v1','clock',clock_result,'choices',base->'choices','association',base->'association','adoption',adoption);
  if octet_length(convert_to(result::text,'UTF8'))>65536 then raise exception 'attendance_self_schedule_adoption_invalid';end if;
  return result;
  -- No exception subtransaction: mandatory reference failures roll back the
  --new clock,137 relation and optional133 binding together. No PIN lease here.
end;
$$;

revoke all on function public.faolla_attendance_self_schedule_receipt_v1(public.merchant_attendance_shift_schedule_relations,uuid),
  public.faolla_attendance_shift_plan_adoption_v1(public.merchant_attendance_shift_schedule_relations,uuid,uuid,boolean,text),
  public.faolla_attendance_shift_plan_adoption_guard_v1(),
  public.faolla_attendance_self_schedule_adoption_v1(text,uuid,jsonb,jsonb,uuid,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_self_schedule_adoption_v1(text,uuid,jsonb,jsonb,uuid,boolean,boolean) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610050144,'merchant_attendance_self_schedule_adoption') on conflict(version) do nothing;
do $self_schedule_adoption_postconditions$
declare r text;p text;fn regprocedure;trig text;kind smallint;
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610050144 and name='merchant_attendance_self_schedule_adoption') then
    raise exception 'merchant_attendance_self_schedule_adoption_registry_postcondition_failed';end if;
  if exists(select 1 from pg_constraint where conrelid='public.merchant_attendance_shift_plan_adoptions'::regclass and conname='attendance_shift_plan_adoptions_channels_v3')
    or not exists(select 1 from pg_constraint c where c.conrelid='public.merchant_attendance_shift_plan_adoptions'::regclass
      and c.conname='attendance_shift_plan_adoptions_channels_v4' and c.contype='c' and c.convalidated and not c.connoinherit
      and regexp_replace(pg_get_expr(c.conbin,c.conrelid),'\s+','','g')='(channel=ANY(ARRAY[''location''::text,''onsite''::text,''pin''::text,''self''::text]))'
      and c.conkey=array[(select attnum from pg_attribute where attrelid=c.conrelid and attname='channel')]) then
    raise exception 'merchant_attendance_self_schedule_adoption_constraint_conflict';end if;
  if not exists(select 1 from pg_class where oid='public.merchant_attendance_shift_plan_adoptions'::regclass and relrowsecurity)
    or exists(select 1 from pg_policy where polrelid='public.merchant_attendance_shift_plan_adoptions'::regclass) then
    raise exception 'merchant_attendance_self_schedule_adoption_rls_postcondition_failed';end if;
  for trig,fn,kind in select * from (values
    ('attendance_shift_plan_adoption_insert','public.faolla_attendance_shift_plan_adoption_guard_v1()'::regprocedure,7::smallint),
    ('attendance_shift_plan_adoption_immutable','public.faolla_attendance_events_append_only_v1()'::regprocedure,27::smallint),
    ('attendance_shift_plan_adoption_no_truncate','public.faolla_attendance_events_append_only_v1()'::regprocedure,34::smallint)) expected(name,func,type) loop
    if not exists(select 1 from pg_trigger t where t.tgrelid='public.merchant_attendance_shift_plan_adoptions'::regclass and t.tgname=trig
      and not t.tgisinternal and t.tgfoid=fn::oid and t.tgtype=kind and t.tgenabled in('O','A') and t.tgqual is null and t.tgnargs=0) then
      raise exception 'merchant_attendance_self_schedule_adoption_trigger_conflict';end if;
  end loop;
  foreach r in array array['anon','authenticated','service_role'] loop
    if exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      where c.oid='public.merchant_attendance_shift_plan_adoptions'::regclass and (a.grantee=0 or pg_has_role(r,a.grantee,'USAGE')))
      or exists(select 1 from pg_attribute c cross join lateral aclexplode(c.attacl) a
        where c.attrelid='public.merchant_attendance_shift_plan_adoptions'::regclass and c.attnum>0 and not c.attisdropped
          and (a.grantee=0 or pg_has_role(r,a.grantee,'USAGE'))) then raise exception 'merchant_attendance_self_schedule_adoption_acl_postcondition_failed';end if;
    foreach p in array array['public.faolla_attendance_self_schedule_receipt_v1(public.merchant_attendance_shift_schedule_relations,uuid)',
      'public.faolla_attendance_shift_plan_adoption_v1(public.merchant_attendance_shift_schedule_relations,uuid,uuid,boolean,text)',
      'public.faolla_attendance_shift_plan_adoption_guard_v1()'] loop
      if has_function_privilege(r,p,'EXECUTE') then raise exception 'merchant_attendance_self_schedule_adoption_acl_postcondition_failed';end if;
    end loop;
    foreach p in array array['public.faolla_attendance_self_schedule_adoption_v1(text,uuid,jsonb,jsonb,uuid,boolean,boolean)',
      'public.faolla_attendance_self_schedule_v1(text,uuid,jsonb,jsonb,uuid,boolean,boolean)',
      'public.faolla_attendance_self_v1(text,uuid,jsonb,uuid)',
      'public.faolla_attendance_self_bound_v1(text,uuid,jsonb,uuid)',
      'public.faolla_attendance_location_schedule_v1(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean,jsonb,boolean,boolean)',
      'public.faolla_attendance_onsite_schedule_v1(text,uuid,jsonb,jsonb,uuid,boolean,jsonb,boolean,boolean)',
      'public.faolla_attendance_pin_schedule_v1(text,uuid,text,text,uuid,boolean,jsonb,boolean,jsonb,boolean,boolean)'] loop
      if has_function_privilege(r,p,'EXECUTE') is distinct from (r='service_role') then raise exception 'merchant_attendance_self_schedule_adoption_acl_postcondition_failed';end if;
    end loop;
  end loop;
  if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid in('public.faolla_attendance_self_schedule_receipt_v1(public.merchant_attendance_shift_schedule_relations,uuid)'::regprocedure,
      'public.faolla_attendance_shift_plan_adoption_v1(public.merchant_attendance_shift_schedule_relations,uuid,uuid,boolean,text)'::regprocedure,
      'public.faolla_attendance_shift_plan_adoption_guard_v1()'::regprocedure,
      'public.faolla_attendance_self_schedule_adoption_v1(text,uuid,jsonb,jsonb,uuid,boolean,boolean)'::regprocedure)
      and a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'merchant_attendance_self_schedule_adoption_acl_postcondition_failed';end if;
end;
$self_schedule_adoption_postconditions$;
commit;
