-- Opt-in location clock-in: explicit schedule relation and immutable approved
-- plan reference. Original113/134 clocks and all previous readers stay intact.
begin;
set local lock_timeout='3s';

do $location_schedule_prerequisites$
declare installed boolean;v bigint;n text;t text;p text;
begin
  if to_regclass('public.faolla_schema_migrations') is null then raise exception 'merchant_attendance_location_schedule_prerequisite_required';end if;
  for v,n in select * from (values
    (202610020113::bigint,'merchant_attendance_location_receipt_identity'),(202610040134::bigint,'merchant_attendance_bound_clocks'),
    (202610050137::bigint,'merchant_attendance_self_schedule'),(202610050140::bigint,'merchant_attendance_plan_rule_approvals')) required(version,name) loop
    if not exists(select 1 from public.faolla_schema_migrations where version=v and name=n) then raise exception 'merchant_attendance_location_schedule_prerequisite_required';end if;
  end loop;
  foreach t in array array['merchant_attendance_settings','merchant_attendance_workers','merchant_enterprise_employees','merchant_attendance_locations',
    'merchant_attendance_events','merchant_attendance_location_results','merchant_attendance_location_clock_notices',
    'merchant_attendance_schedule_slots','merchant_attendance_schedule_commands','merchant_attendance_shift_schedule_relations',
    'merchant_attendance_plan_rule_streams','merchant_attendance_plan_rule_operations','merchant_attendance_plan_rule_artifacts','attendance_schedule_worker_date_idx'] loop
    if to_regclass('public.'||t) is null then raise exception 'merchant_attendance_location_schedule_prerequisite_required';end if;
  end loop;
  foreach p in array array['public.faolla_attendance_location_clock_v2(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean)',
    'public.faolla_attendance_location_clock_bound_v1(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean)',
    'public.faolla_attendance_self_schedule_slot_v1(public.merchant_attendance_schedule_slots)',
    'public.faolla_attendance_plan_rule_source_v1(jsonb)','public.faolla_attendance_plan_rule_command_v1(jsonb)',
    'public.faolla_attendance_shift_rule_binding_object_v1(jsonb,text[])','public.faolla_attendance_shift_rule_binding_scalar_v1(jsonb,text)',
    'public.faolla_attendance_events_append_only_v1()'] loop
    if to_regprocedure(p) is null then raise exception 'merchant_attendance_location_schedule_prerequisite_required';end if;
  end loop;
  select exists(select 1 from public.faolla_schema_migrations where version=202610050141 and name='merchant_attendance_location_schedule') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610050141 and name<>'merchant_attendance_location_schedule')
    or installed<>(to_regclass('public.merchant_attendance_shift_plan_adoptions') is not null) then
    raise exception 'merchant_attendance_location_schedule_installation_conflict';end if;
  foreach p in array array['public.faolla_attendance_location_schedule_receipt_v1(public.merchant_attendance_shift_schedule_relations,uuid)',
    'public.faolla_attendance_location_plan_adoption_v1(public.merchant_attendance_shift_schedule_relations,uuid,uuid,boolean)',
    'public.faolla_attendance_shift_plan_adoption_guard_v1()',
    'public.faolla_attendance_location_schedule_v1(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean,jsonb,boolean,boolean)'] loop
    if installed<>(to_regprocedure(p) is not null) then raise exception 'merchant_attendance_location_schedule_installation_conflict';end if;
  end loop;
end;
$location_schedule_prerequisites$;

-- Shared compact sidecar. Never duplicate140 rule bodies or owner reasons.
-- Only the new location entry point can append in this migration. Other
-- channels require a separately authorized implementation, not an inferred tag.
create table if not exists public.merchant_attendance_shift_plan_adoptions(
  merchant_id text not null check(merchant_id~'^\d{8}$'),start_event_id uuid not null,worker_id uuid not null,operation_id uuid not null,
  employee_id uuid not null,employee_auth_user_id uuid not null,channel text not null check(channel='location'),
  slot_id uuid null,approval_operation_id uuid null,adoption jsonb not null,recorded_at timestamptz not null check(isfinite(recorded_at)),
  primary key(merchant_id,start_event_id),unique(start_event_id),unique(merchant_id,worker_id,operation_id),
  foreign key(merchant_id,start_event_id) references public.merchant_attendance_shift_schedule_relations(merchant_id,start_event_id),
  foreign key(merchant_id,worker_id,operation_id) references public.merchant_attendance_events(merchant_id,worker_id,operation_id),
  foreign key(merchant_id,slot_id) references public.merchant_attendance_schedule_slots(merchant_id,id),
  foreign key(merchant_id,approval_operation_id) references public.merchant_attendance_plan_rule_operations(merchant_id,operation_id),
  check(jsonb_typeof(adoption)='object' and octet_length(convert_to(adoption::text,'UTF8'))<=4096)
);

-- Original channel proof, including original version assertions. Current
-- identity is required, but historical versions are not rewritten to current.
create or replace function public.faolla_attendance_location_schedule_receipt_v1(p public.merchant_attendance_shift_schedule_relations,p_auth uuid)
returns void language plpgsql set search_path=pg_catalog as $$
declare ev public.merchant_attendance_events%rowtype;n public.merchant_attendance_location_clock_notices%rowtype;
  r public.merchant_attendance_location_results%rowtype;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
begin
  select * into ev from public.merchant_attendance_events where id=p.start_event_id;
  select * into n from public.merchant_attendance_location_clock_notices where event_id=p.start_event_id;
  select * into r from public.merchant_attendance_location_results where event_id=p.start_event_id;
  select * into w from public.merchant_attendance_workers where merchant_id=p.merchant_id and id=p.worker_id;
  select * into e from public.merchant_enterprise_employees where merchant_id=p.merchant_id and id=p.employee_id;
  if p_auth is null or e.id is null or w.id is null or w.employee_id is distinct from p.employee_id
    or e.auth_user_id is distinct from p_auth or p.employee_auth_user_id is distinct from p_auth then raise exception 'attendance_access_denied';end if;
  if ev.id is null or n.event_id is null or r.event_id is null or ev.action<>'clock_in' or ev.source<>'web' or ev.occurred_at<>ev.received_at
    or row(ev.merchant_id,ev.worker_id,ev.operation_id,ev.sequence,ev.location_id,ev.occurred_at,ev.time_zone,ev.actor_employee_id)
      is distinct from row(p.merchant_id,p.worker_id,p.operation_id,p.sequence,p.location_id,p.occurred_at,p.event_time_zone,p.employee_id)
    or row(n.merchant_id,n.worker_id,n.employee_id,n.location_id) is distinct from row(p.merchant_id,p.worker_id,p.employee_id,p.location_id)
    or n.safe_finish is distinct from false or n.notice_revision is null
    or not public.faolla_attendance_shift_rule_binding_object_v1(n.command,array['operationId','locationId','action','expectedSequence','settingsVersion','workerVersion','locationVersion','noticeRevision','safeFinish'])
    or n.command->>'operationId' is distinct from p.operation_id::text or n.command->>'action' is distinct from 'clock_in'
    or n.command->>'locationId' is distinct from p.location_id::text or n.command->'expectedSequence' is distinct from to_jsonb(p.sequence-1)
    or n.command->'safeFinish' is distinct from 'false'::jsonb or n.command->'noticeRevision' is distinct from to_jsonb(n.notice_revision)
    or row(r.settings_version,r.worker_version,r.location_version) is distinct from row(p.settings_version,p.worker_version,p.location_version)
    or n.command->'settingsVersion' is distinct from to_jsonb(p.settings_version) or n.command->'workerVersion' is distinct from to_jsonb(p.worker_version)
    or n.command->'locationVersion' is distinct from to_jsonb(p.location_version)
    or p.binding_policy<>'employee-explicit-clock-in-v1' then raise exception 'attendance_location_schedule_invalid';end if;
end;
$$;

-- p_current=true is used only after113 has retained worker UPDATE. That lock
-- excludes140 approval's worker SHARE, including an as-yet absent stream, so
-- no advisory lock, lock upgrade or owner impersonation is needed here.
-- Archived reads instead validate the exact saved immutable approval reference.
create or replace function public.faolla_attendance_location_plan_adoption_v1(p public.merchant_attendance_shift_schedule_relations,p_auth uuid,
  p_approval_id uuid,p_current boolean)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare stream public.merchant_attendance_plan_rule_streams%rowtype;a public.merchant_attendance_plan_rule_operations%rowtype;
  f public.merchant_attendance_plan_rule_artifacts%rowtype;w public.merchant_attendance_workers%rowtype;s public.merchant_attendance_settings%rowtype;
  ref jsonb;state_name text;why text;target uuid:=p_approval_id;layer text;item jsonb;
  fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_current is null or p_current and p_approval_id is not null then raise exception 'attendance_location_schedule_invalid';end if;
  perform public.faolla_attendance_location_schedule_receipt_v1(p,p_auth);
  if p.status='unselected' then state_name:='unselected';
  elsif p.status='unverified' then state_name:='unverified';why:=p.reason;
  elsif p.status='linked' then
    if p_current then
      select * into stream from public.merchant_attendance_plan_rule_streams x where x.merchant_id=p.merchant_id and x.slot_id=p.slot_id;
      if found then
        if row(stream.worker_id,stream.employee_id,stream.employee_auth_user_id) is distinct from row(p.worker_id,p.employee_id,p.employee_auth_user_id) then
          raise exception 'attendance_access_denied';end if;
        select * into a from public.merchant_attendance_plan_rule_operations x where x.merchant_id=p.merchant_id and x.slot_id=p.slot_id and x.revision=stream.revision;
        if a.operation_id is null then raise exception 'attendance_location_schedule_invalid';end if;target:=a.operation_id;
      end if;
    elsif target is not null then
      select * into a from public.merchant_attendance_plan_rule_operations x where x.merchant_id=p.merchant_id and x.operation_id=target;
      if a.operation_id is null then raise exception 'attendance_location_schedule_invalid';end if;
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
        or a.recorded_at>=(p.slot_snapshot->>'startAt')::timestamptz then raise exception 'attendance_location_schedule_invalid';end if;
      foreach layer in array array['personal','group','enterprise'] loop
        item:=case when layer='personal' then f.source->layer->'approval' else f.source->layer->'publication' end;
        if item is not null and item<>'null'::jsonb and (item->>'recordedAt')::timestamptz>a.observed_at then raise exception 'attendance_location_schedule_invalid';end if;
      end loop;
      -- Approval was visible under the worker mutex. Wall-clock metadata is
      -- preserved; no cross-entity monotonic/commit-time assertion is invented.
      state_name:='adopted';ref:=jsonb_build_object('operationId',a.operation_id,'revision',a.revision,'sourceId',a.source_id,
        'sourceSha256',f.source_sha256,'recordedAt',to_char(a.recorded_at at time zone 'UTC',fmt));
    end if;
  else raise exception 'attendance_location_schedule_invalid';end if;
  if p.status<>'linked' and target is not null then raise exception 'attendance_location_schedule_invalid';end if;
  return jsonb_build_object('startEventId',p.start_event_id,'operationId',p.operation_id,'channel','location',
    'employeeId',p.employee_id,'employeeAuthUserId',p.employee_auth_user_id,'status',state_name,'reason',why,'approval',ref,
    'recordedAt',to_char(p.recorded_at at time zone 'UTC',fmt),'policy','explicit-plan-approval-at-clock-in-v1');
end;
$$;

create or replace function public.faolla_attendance_shift_plan_adoption_guard_v1()
returns trigger language plpgsql set search_path=pg_catalog as $$
declare rel public.merchant_attendance_shift_schedule_relations%rowtype;expected jsonb;
begin
  select * into rel from public.merchant_attendance_shift_schedule_relations where merchant_id=new.merchant_id and start_event_id=new.start_event_id;
  if rel.start_event_id is null or row(new.worker_id,new.operation_id,new.employee_id,new.employee_auth_user_id,new.slot_id,new.recorded_at)
    is distinct from row(rel.worker_id,rel.operation_id,rel.employee_id,rel.employee_auth_user_id,rel.slot_id,rel.recorded_at)
    or new.channel<>'location' then raise exception 'attendance_location_schedule_invalid';end if;
  expected:=public.faolla_attendance_location_plan_adoption_v1(rel,new.employee_auth_user_id,null,true);
  if new.adoption is distinct from expected or new.approval_operation_id::text is distinct from expected->'approval'->>'operationId' then
    raise exception 'attendance_location_schedule_invalid';end if;
  return new;
end;
$$;
alter table public.merchant_attendance_shift_plan_adoptions enable row level security;
revoke all on public.merchant_attendance_shift_plan_adoptions from public,anon,authenticated,service_role;
do $location_schedule_triggers$
begin
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_shift_plan_adoptions'::regclass and tgname='attendance_shift_plan_adoption_insert') then
    create trigger attendance_shift_plan_adoption_insert before insert on public.merchant_attendance_shift_plan_adoptions for each row execute function public.faolla_attendance_shift_plan_adoption_guard_v1();end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_shift_plan_adoptions'::regclass and tgname='attendance_shift_plan_adoption_immutable') then
    create trigger attendance_shift_plan_adoption_immutable before update or delete on public.merchant_attendance_shift_plan_adoptions for each row execute function public.faolla_attendance_events_append_only_v1();end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_shift_plan_adoptions'::regclass and tgname='attendance_shift_plan_adoption_no_truncate') then
    create trigger attendance_shift_plan_adoption_no_truncate before truncate on public.merchant_attendance_shift_plan_adoptions for each statement execute function public.faolla_attendance_events_append_only_v1();end if;
end;
$location_schedule_triggers$;

create or replace function public.faolla_attendance_location_schedule_v1(
  p_site_id text,p_auth_user_id uuid,p_expected_worker_id uuid,p_command jsonb default null,p_operation_id uuid default null,
  p_assertion jsonb default null,p_allow_new_sessions boolean default false,p_require_clock boolean default false,
  p_selection jsonb default null,p_allow_schedule boolean default false,p_bind_rules boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare clock_result jsonb;selected jsonb:=nullif(p_selection,'null'::jsonb);choices jsonb;association jsonb;adoption jsonb;entries jsonb:='[]';result jsonb;
  worker public.merchant_attendance_workers%rowtype;employee public.merchant_enterprise_employees%rowtype;location public.merchant_attendance_locations%rowtype;
  settings public.merchant_attendance_settings%rowtype;ev public.merchant_attendance_events%rowtype;slot public.merchant_attendance_schedule_slots%rowtype;
  saved public.merchant_attendance_shift_schedule_relations%rowtype;proof public.merchant_attendance_shift_plan_adoptions%rowtype;
  context jsonb;slot_item jsonb;publication_item jsonb;cancellation_item jsonb;candidates public.merchant_attendance_schedule_slots[];
  head bigint;day_now date;first_day date;last_day date;zone text;limited boolean:=false;fresh boolean:=false;
  status_name text;reason_name text;current_cancelled boolean;was_cancelled boolean;current_cancellation jsonb;
  fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_expected_worker_id is null
    or p_allow_schedule is null or p_bind_rules is null or p_allow_new_sessions is null or p_require_clock is null then raise exception 'attendance_invalid_request';end if;
  if p_command is null then
    if selected is not null then raise exception 'attendance_invalid_request';end if;
  else
    if p_operation_id is not null or jsonb_typeof(p_command) is distinct from 'object'
      or p_command->>'action' is distinct from 'clock_in' or p_command->'safeFinish' is distinct from 'false'::jsonb then raise exception 'attendance_invalid_request';end if;
    if selected is not null and (not public.faolla_attendance_shift_rule_binding_object_v1(selected,array['slotId','revision'])
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(selected->'slotId','uuid')
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(selected->'revision','version')) then raise exception 'attendance_invalid_request';end if;
    -- Rollback disables EVERY POST; the original-number GET stays available.
    if not p_allow_schedule then raise exception 'attendance_location_schedule_disabled';end if;
  end if;
  -- Exactly one old entry call, preserving113's own validation, notice/safe-
  -- finish semantics and all retained locks. No settings upgrade/owner call.
  if p_bind_rules then clock_result:=public.faolla_attendance_location_clock_bound_v1(p_site_id,p_auth_user_id,p_expected_worker_id,p_command,p_operation_id,p_assertion,p_allow_new_sessions,p_require_clock);
  else clock_result:=public.faolla_attendance_location_clock_v2(p_site_id,p_auth_user_id,p_expected_worker_id,p_command,p_operation_id,p_assertion,p_allow_new_sessions,p_require_clock);end if;
  if clock_result->'replayed' is distinct from 'true'::jsonb and clock_result->'replayed' is distinct from 'false'::jsonb then raise exception 'attendance_location_schedule_invalid';end if;
  select * into worker from public.merchant_attendance_workers where merchant_id=p_site_id and id=p_expected_worker_id;
  select * into employee from public.merchant_enterprise_employees where merchant_id=p_site_id and id=worker.employee_id;
  select * into settings from public.merchant_attendance_settings where merchant_id=p_site_id;
  select * into location from public.merchant_attendance_locations where merchant_id=p_site_id and id=worker.default_location_id for share;
  if worker.id is null or employee.id is null or employee.auth_user_id is distinct from p_auth_user_id or settings.merchant_id is null
    or clock_result->>'workerId' is distinct from worker.id::text then raise exception 'attendance_access_denied';end if;
  select coalesce(max(c.revision),0) into head from public.merchant_attendance_schedule_commands c where c.merchant_id=p_site_id;
  choices:=jsonb_build_object('timeZone',null,'fromDate',null,'throughDate',null,'revision',head,'limited',false,'entries','[]'::jsonb);
  if clock_result->'receipt'<>'null'::jsonb then
    select * into ev from public.merchant_attendance_events where id=(clock_result->'receipt'->>'id')::uuid;
    if ev.id is null or ev.merchant_id is distinct from p_site_id or ev.worker_id is distinct from worker.id or ev.actor_employee_id is distinct from employee.id then raise exception 'attendance_location_schedule_invalid';end if;
    select * into saved from public.merchant_attendance_shift_schedule_relations where merchant_id=p_site_id and start_event_id=ev.id;
    if found then
      if saved.worker_id is distinct from worker.id or saved.operation_id is distinct from ev.operation_id or saved.employee_id is distinct from employee.id
        or saved.employee_auth_user_id is distinct from p_auth_user_id then raise exception 'attendance_access_denied';end if;
      if p_command is not null and saved.selection is distinct from selected then raise exception 'attendance_operation_conflict';end if;
    elsif p_command is not null and clock_result->'replayed'='false'::jsonb then
      fresh:=true;
      if ev.action<>'clock_in' or ev.source<>'web' or ev.location_id is distinct from location.id or ev.operation_id::text is distinct from p_command->>'operationId' then
        raise exception 'attendance_location_schedule_invalid';end if;
      status_name:='unselected';reason_name:=null;
      if selected is not null then
        select * into slot from public.merchant_attendance_schedule_slots where merchant_id=p_site_id and id=(selected->>'slotId')::uuid;
        if slot.id is null or slot.worker_id is distinct from worker.id or slot.employee_id is distinct from employee.id then raise exception 'attendance_access_denied';end if;
        if slot.revision is distinct from (selected->>'revision')::bigint then raise exception 'attendance_invalid_request';end if;
        context:=public.faolla_attendance_self_schedule_slot_v1(slot);
        if context->'publication'->>'employeeAuthUserId' is not null and context->'publication'->>'employeeAuthUserId'<>p_auth_user_id::text then raise exception 'attendance_access_denied';end if;
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
        values(p_site_id,ev.id,worker.id,ev.operation_id,ev.sequence,ev.location_id,ev.occurred_at,ev.time_zone,employee.id,p_auth_user_id,
          worker.version,location.version,settings.version,selected,slot.id,slot.revision,head,status_name,reason_name,
          slot_item,publication_item,cancellation_item,clock_timestamp(),'employee-explicit-clock-in-v1') returning * into saved;
      adoption:=public.faolla_attendance_location_plan_adoption_v1(saved,p_auth_user_id,null,true);
      insert into public.merchant_attendance_shift_plan_adoptions(merchant_id,start_event_id,worker_id,operation_id,employee_id,employee_auth_user_id,
        channel,slot_id,approval_operation_id,adoption,recorded_at)
        values(p_site_id,ev.id,worker.id,ev.operation_id,employee.id,p_auth_user_id,'location',saved.slot_id,
          (adoption->'approval'->>'operationId')::uuid,adoption,saved.recorded_at) returning * into proof;
    end if;
    -- Legacy receipts are not backfilled, even when a new selection is sent.
    if saved.start_event_id is not null then
      perform public.faolla_attendance_location_schedule_receipt_v1(saved,p_auth_user_id);
      current_cancelled:=null;
      if saved.slot_id is not null then
        select * into slot from public.merchant_attendance_schedule_slots where merchant_id=p_site_id and id=saved.slot_id;
        if slot.id is null or slot.worker_id is distinct from saved.worker_id or slot.employee_id is distinct from saved.employee_id or slot.revision is distinct from saved.slot_revision then
          raise exception 'attendance_location_schedule_invalid';end if;
        context:=public.faolla_attendance_self_schedule_slot_v1(slot);current_cancelled:=(context->'slot'->>'cancelled')::boolean;
        if context->'publication'->>'employeeAuthUserId' is not null and context->'publication'->>'employeeAuthUserId'<>p_auth_user_id::text then raise exception 'attendance_access_denied';end if;
        if (saved.slot_snapshot-'cancelled') is distinct from ((context->'slot')-'cancelled')
          or saved.publication_snapshot is distinct from nullif(context->'publication','null'::jsonb) then raise exception 'attendance_location_schedule_invalid';end if;
        current_cancellation:=nullif(context->'cancellation','null'::jsonb);was_cancelled:=(saved.slot_snapshot->>'cancelled')::boolean;
        if was_cancelled then
          if not current_cancelled or saved.cancellation_snapshot is null or saved.cancellation_snapshot is distinct from current_cancellation
            or (current_cancellation->>'revision')::bigint>saved.schedule_revision then raise exception 'attendance_location_schedule_invalid';end if;
        elsif saved.cancellation_snapshot is not null or current_cancelled and (current_cancellation->>'revision')::bigint<=saved.schedule_revision then
          raise exception 'attendance_location_schedule_invalid';end if;
        -- Keep the insertion-time outside_window decision, without new tzdata.
        reason_name:=case when was_cancelled then 'cancelled' when slot.location_id<>ev.location_id then 'location_changed'
          when saved.reason='outside_window' then 'outside_window' when not (context->'slot'->>'hasPublicationEvidence')::boolean then 'publication_missing' else null end;
        if saved.reason is distinct from reason_name or saved.status is distinct from (case when reason_name is null then 'linked' else 'unverified' end) then
          raise exception 'attendance_location_schedule_invalid';end if;
      end if;
      association:=jsonb_build_object('startEventId',saved.start_event_id,'operationId',saved.operation_id,'selection',saved.selection,'status',saved.status,'reason',saved.reason,
        'slot',saved.slot_snapshot,'observedRevision',saved.schedule_revision,'recordedAt',to_char(saved.recorded_at at time zone 'UTC',fmt),'currentCancelled',current_cancelled);
      if not fresh then select * into proof from public.merchant_attendance_shift_plan_adoptions where merchant_id=p_site_id and start_event_id=ev.id;end if;
      if proof.start_event_id is not null then
        if row(proof.worker_id,proof.operation_id,proof.employee_id,proof.employee_auth_user_id,proof.slot_id,proof.recorded_at)
          is distinct from row(saved.worker_id,saved.operation_id,saved.employee_id,saved.employee_auth_user_id,saved.slot_id,saved.recorded_at)
          or proof.channel<>'location' then raise exception 'attendance_location_schedule_invalid';end if;
        adoption:=public.faolla_attendance_location_plan_adoption_v1(saved,p_auth_user_id,proof.approval_operation_id,false);
        if proof.adoption is distinct from adoption then raise exception 'attendance_location_schedule_invalid';end if;
      end if;
    end if;
    if p_command is not null and proof.start_event_id is null then raise exception 'attendance_operation_conflict';end if;
  elsif p_command is not null then raise exception 'attendance_location_schedule_invalid';end if;
  if fresh and (association is null or adoption is null) then raise exception 'attendance_location_schedule_invalid';end if;
  -- The same bounded candidates as137, available only for a currently legal
  -- new clock-in. Recovery remains available while feature/channel is off.
  if p_command is null and p_operation_id is null and p_allow_schedule and p_allow_new_sessions and location.id is not null and clock_result->'channelEnabled'='true'::jsonb
    and clock_result->'state'->>'status'='off' then
    zone:=location.time_zone;day_now:=(clock_timestamp() at time zone zone)::date;
    first_day:=greatest(day_now-1,date '2000-01-01');last_day:=least(day_now+1,date '2100-12-31');
    if first_day>last_day then raise exception 'attendance_location_schedule_invalid';end if;
    candidates:=array(select x from public.merchant_attendance_schedule_slots x where x.merchant_id=p_site_id and x.worker_id=worker.id
      and x.work_date between first_day and last_day order by x.work_date,x.start_at,x.id limit 101);
    limited:=cardinality(candidates)>100;
    if not limited then foreach slot in array candidates loop
      if slot.employee_id<>employee.id or slot.location_id<>location.id then continue;end if;
      context:=public.faolla_attendance_self_schedule_slot_v1(slot);
      if context->'publication'->>'employeeAuthUserId' is not null and context->'publication'->>'employeeAuthUserId'<>p_auth_user_id::text then continue;end if;
      entries:=entries||jsonb_build_array(context->'slot');
    end loop;end if;
    choices:=jsonb_build_object('timeZone',zone,'fromDate',to_char(first_day,'YYYY-MM-DD'),'throughDate',to_char(last_day,'YYYY-MM-DD'),'revision',head,'limited',limited,'entries',entries);
    if octet_length(convert_to(choices::text,'UTF8'))>48000 then choices:=jsonb_build_object('timeZone',zone,'fromDate',to_char(first_day,'YYYY-MM-DD'),
      'throughDate',to_char(last_day,'YYYY-MM-DD'),'revision',head,'limited',true,'entries','[]'::jsonb);end if;
  end if;
  -- Raw113 private fence fields remain server-only; HTTP must use the existing
  -- strict public location projection, not return this nested raw clock blindly.
  result:=jsonb_build_object('protocol','location-schedule-v1','clock',clock_result,'choices',choices,'association',association,'adoption',adoption);
  if octet_length(convert_to(result::text,'UTF8'))>65536 then raise exception 'attendance_location_schedule_invalid';end if;
  return result;
  -- No EXCEPTION wrapper: required relation/sidecar failures roll back the
  -- original new event, location receipts and optional133 binding together.
end;
$$;

revoke all on function public.faolla_attendance_location_schedule_receipt_v1(public.merchant_attendance_shift_schedule_relations,uuid),
  public.faolla_attendance_location_plan_adoption_v1(public.merchant_attendance_shift_schedule_relations,uuid,uuid,boolean),
  public.faolla_attendance_shift_plan_adoption_guard_v1(),
  public.faolla_attendance_location_schedule_v1(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean,jsonb,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_location_schedule_v1(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean,jsonb,boolean,boolean) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610050141,'merchant_attendance_location_schedule') on conflict(version) do nothing;

do $location_schedule_postconditions$
declare r text;p text;fn regprocedure;trig text;kind smallint;
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610050141 and name='merchant_attendance_location_schedule') then
    raise exception 'merchant_attendance_location_schedule_registry_postcondition_failed';end if;
  if not exists(select 1 from pg_class where oid='public.merchant_attendance_shift_plan_adoptions'::regclass and relrowsecurity)
    or exists(select 1 from pg_policy where polrelid='public.merchant_attendance_shift_plan_adoptions'::regclass) then
    raise exception 'merchant_attendance_location_schedule_rls_postcondition_failed';end if;
  for trig,fn,kind in select * from (values
    ('attendance_shift_plan_adoption_insert','public.faolla_attendance_shift_plan_adoption_guard_v1()'::regprocedure,7::smallint),
    ('attendance_shift_plan_adoption_immutable','public.faolla_attendance_events_append_only_v1()'::regprocedure,27::smallint),
    ('attendance_shift_plan_adoption_no_truncate','public.faolla_attendance_events_append_only_v1()'::regprocedure,34::smallint)) expected(name,func,type) loop
    if not exists(select 1 from pg_trigger t where t.tgrelid='public.merchant_attendance_shift_plan_adoptions'::regclass and t.tgname=trig
      and not t.tgisinternal and t.tgfoid=fn::oid and t.tgtype=kind and t.tgenabled in('O','A') and t.tgqual is null and t.tgnargs=0) then
      raise exception 'merchant_attendance_location_schedule_trigger_conflict';end if;
  end loop;
  foreach r in array array['anon','authenticated','service_role'] loop
    if exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      where c.oid='public.merchant_attendance_shift_plan_adoptions'::regclass and (a.grantee=0 or pg_has_role(r,a.grantee,'USAGE'))) then
      raise exception 'merchant_attendance_location_schedule_acl_postcondition_failed';end if;
    if exists(select 1 from pg_attribute c cross join lateral aclexplode(c.attacl) a
      where c.attrelid='public.merchant_attendance_shift_plan_adoptions'::regclass and c.attnum>0 and not c.attisdropped
        and (a.grantee=0 or pg_has_role(r,a.grantee,'USAGE'))) then raise exception 'merchant_attendance_location_schedule_acl_postcondition_failed';end if;
    foreach p in array array['public.faolla_attendance_location_schedule_receipt_v1(public.merchant_attendance_shift_schedule_relations,uuid)',
      'public.faolla_attendance_location_plan_adoption_v1(public.merchant_attendance_shift_schedule_relations,uuid,uuid,boolean)',
      'public.faolla_attendance_shift_plan_adoption_guard_v1()'] loop
      if has_function_privilege(r,p,'EXECUTE') then raise exception 'merchant_attendance_location_schedule_acl_postcondition_failed';end if;
    end loop;
    if has_function_privilege(r,'public.faolla_attendance_location_schedule_v1(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean,jsonb,boolean,boolean)','EXECUTE') is distinct from (r='service_role') then
      raise exception 'merchant_attendance_location_schedule_acl_postcondition_failed';end if;
  end loop;
  if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid in('public.faolla_attendance_location_schedule_receipt_v1(public.merchant_attendance_shift_schedule_relations,uuid)'::regprocedure,
      'public.faolla_attendance_location_plan_adoption_v1(public.merchant_attendance_shift_schedule_relations,uuid,uuid,boolean)'::regprocedure,
      'public.faolla_attendance_shift_plan_adoption_guard_v1()'::regprocedure,
      'public.faolla_attendance_location_schedule_v1(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean,jsonb,boolean,boolean)'::regprocedure)
      and a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'merchant_attendance_location_schedule_acl_postcondition_failed';end if;
end;
$location_schedule_postconditions$;
commit;
