-- Opt-in ordinary-self clock-in selection. A selected plan is not automatic
-- matching, attendance classification, a plan-start rule freeze or payroll.
-- Old clocks, schedule/cancel writers and historical operations are unchanged.
begin;
set local lock_timeout='3s';

do $self_schedule_prerequisites$
declare installed boolean;v bigint;n text;t text;p text;
begin
  if to_regclass('public.faolla_schema_migrations') is null then raise exception 'merchant_attendance_self_schedule_prerequisite_required';end if;
  for v,n in select * from (values
    (202610020111::bigint,'merchant_attendance_self_clock_identity'),(202610040134::bigint,'merchant_attendance_bound_clocks'),
    (202610050136::bigint,'merchant_attendance_schedule_publication_evidence')) required(version,name) loop
    if not exists(select 1 from public.faolla_schema_migrations where version=v and name=n) then
      raise exception 'merchant_attendance_self_schedule_prerequisite_required';end if;
  end loop;
  foreach t in array array['merchant_attendance_settings','merchant_attendance_workers','merchant_enterprise_employees','merchant_attendance_locations',
    'merchant_attendance_events','merchant_attendance_schedule_commands','merchant_attendance_schedule_slots','merchant_attendance_schedule_cancellations',
    'merchant_attendance_schedule_publication_evidence','attendance_schedule_worker_date_idx'] loop
    if to_regclass('public.'||t) is null then raise exception 'merchant_attendance_self_schedule_prerequisite_required';end if;
  end loop;
  foreach p in array array['public.faolla_attendance_self_v1(text,uuid,jsonb,uuid)','public.faolla_attendance_self_bound_v1(text,uuid,jsonb,uuid)',
    'public.faolla_attendance_schedule_publication_slots_v1(jsonb)','public.faolla_attendance_events_append_only_v1()'] loop
    if to_regprocedure(p) is null then raise exception 'merchant_attendance_self_schedule_prerequisite_required';end if;
  end loop;
  select exists(select 1 from public.faolla_schema_migrations where version=202610050137 and name='merchant_attendance_self_schedule') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610050137 and name<>'merchant_attendance_self_schedule') then
    raise exception 'merchant_attendance_self_schedule_installation_conflict';end if;
  if installed<>(to_regclass('public.merchant_attendance_shift_schedule_relations') is not null) then
    raise exception 'merchant_attendance_self_schedule_installation_conflict';end if;
  foreach p in array array['public.faolla_attendance_self_schedule_slot_v1(public.merchant_attendance_schedule_slots)',
    'public.faolla_attendance_self_schedule_guard_v1()','public.faolla_attendance_self_schedule_v1(text,uuid,jsonb,jsonb,uuid,boolean,boolean)'] loop
    if installed<>(to_regprocedure(p) is not null) then raise exception 'merchant_attendance_self_schedule_installation_conflict';end if;
  end loop;
end;
$self_schedule_prerequisites$;

-- Internal bounded source projection. All lookups are by existing PK/unique
-- keys; at most32 original command pairs and32 publication references. Saved
-- UTC/workDate labels are not recomputed with today's timezone database.
create or replace function public.faolla_attendance_self_schedule_slot_v1(p public.merchant_attendance_schedule_slots)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare published public.merchant_attendance_schedule_commands%rowtype;cancelled public.merchant_attendance_schedule_commands%rowtype;
  cancellation public.merchant_attendance_schedule_cancellations%rowtype;evidence public.merchant_attendance_schedule_publication_evidence%rowtype;
  slot_item jsonb;publication_item jsonb:=null;cancellation_item jsonb:=null;pair jsonb;matches integer;has_evidence boolean:=false;
begin
  if p.id is null or p.revision<1 or not isfinite(p.start_at) or not isfinite(p.end_at) or p.end_at<=p.start_at or p.end_at-p.start_at>interval '24 hours'
    or date_trunc('minute',p.start_at)<>p.start_at or date_trunc('minute',p.end_at)<>p.end_at
    or p.work_date not between date '2000-01-01' and date '2100-12-31' or char_length(p.location_name) not between 1 and 120
    or p.location_name<>btrim(p.location_name) or p.location_name ~ '[[:cntrl:]]' or char_length(p.time_zone) not between 1 and 100
    or p.time_zone<>btrim(p.time_zone) or p.time_zone ~ '[[:cntrl:]]' then raise exception 'attendance_self_schedule_invalid';end if;
  select * into published from public.merchant_attendance_schedule_commands c where c.merchant_id=p.merchant_id and c.revision=p.revision;
  if published.operation_id is null or published.actor_auth_user_id is null or not isfinite(published.recorded_at)
    or jsonb_typeof(published.command) is distinct from 'object' or jsonb_typeof(published.query) is distinct from 'object' then
    raise exception 'attendance_self_schedule_invalid';end if;
  if (select count(*) from jsonb_object_keys(published.command))<>8
    or not(published.command ?& array['operationId','expectedRevision','expectedSettingsVersion','reason','action','locationId','timeZone','slots'])
    or published.command->>'operationId' is distinct from published.operation_id::text or published.command->>'action' is distinct from 'publish'
    or published.command->'expectedRevision' is distinct from to_jsonb(p.revision-1)
    or published.command->>'locationId' is distinct from p.location_id::text or published.command->>'timeZone' is distinct from p.time_zone
    or (select count(*) from jsonb_object_keys(published.query))<>6
    or not(published.query ?& array['siteId','access','workerId','fromDate','throughDate','operationId'])
    or published.query->>'siteId' is distinct from p.merchant_id or published.query->>'workerId' is distinct from p.worker_id::text
    or published.query->>'access' is distinct from 'owner' or published.query->'operationId' is distinct from 'null'::jsonb
    or jsonb_typeof(published.command->'slots') is distinct from 'array' then raise exception 'attendance_self_schedule_invalid';end if;
  if jsonb_array_length(published.command->'slots') not between 1 and 32 then raise exception 'attendance_self_schedule_invalid';end if;
  pair:=jsonb_build_array(to_char(p.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),to_char(p.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  select count(*) into matches from jsonb_array_elements(published.command->'slots') x where x.value=pair;
  if matches<>1 then raise exception 'attendance_self_schedule_invalid';end if;
  select * into evidence from public.merchant_attendance_schedule_publication_evidence e where e.merchant_id=p.merchant_id and e.revision=p.revision;
  if found then
    if evidence.operation_id is distinct from published.operation_id or evidence.actor_auth_user_id is distinct from published.actor_auth_user_id
      or evidence.worker_id is distinct from p.worker_id or evidence.employee_id is distinct from p.employee_id
      or evidence.location_id is distinct from p.location_id or evidence.time_zone is distinct from p.time_zone
      or evidence.published_at is distinct from published.recorded_at or not isfinite(evidence.recorded_at)
      or published.command->'expectedSettingsVersion' is distinct from to_jsonb(evidence.settings_version)
      or evidence.capture_policy is distinct from 'publish-identity-context-v1'
      or (evidence.employee_auth_user_id is null and evidence.identity_status is distinct from 'unbound')
      or (evidence.employee_auth_user_id is not null and evidence.identity_status is distinct from 'bound')
      or public.faolla_attendance_schedule_publication_slots_v1(evidence.slots) is distinct from true then raise exception 'attendance_self_schedule_invalid';end if;
    select count(*) into matches from jsonb_array_elements(evidence.slots) x where x.value=jsonb_build_object('id',p.id,
      'workDate',to_char(p.work_date,'YYYY-MM-DD'),'startAt',pair->0,'endAt',pair->1);
    if matches<>1 then raise exception 'attendance_self_schedule_invalid';end if;
    has_evidence:=evidence.employee_auth_user_id is not null;
    publication_item:=jsonb_build_object('operationId',evidence.operation_id,'revision',evidence.revision,'actorId',evidence.actor_auth_user_id,
      'employeeId',evidence.employee_id,'employeeAuthUserId',evidence.employee_auth_user_id,'identityStatus',evidence.identity_status,
      'workerVersion',evidence.worker_version,'locationVersion',evidence.location_version,'settingsVersion',evidence.settings_version,
      'timeZone',evidence.time_zone,'publishedAt',to_char(evidence.published_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'recordedAt',to_char(evidence.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'capturePolicy',evidence.capture_policy);
  end if;
  select * into cancellation from public.merchant_attendance_schedule_cancellations c where c.merchant_id=p.merchant_id and c.slot_id=p.id;
  if found then
    select * into cancelled from public.merchant_attendance_schedule_commands c where c.merchant_id=p.merchant_id and c.revision=cancellation.revision;
    if cancelled.operation_id is null or cancelled.revision<=p.revision or not isfinite(cancelled.recorded_at)
      or jsonb_typeof(cancelled.command) is distinct from 'object' or jsonb_typeof(cancelled.query) is distinct from 'object' then
      raise exception 'attendance_self_schedule_invalid';end if;
    if (select count(*) from jsonb_object_keys(cancelled.command))<>6
      or not(cancelled.command ?& array['operationId','expectedRevision','expectedSettingsVersion','reason','action','slotId'])
      or cancelled.command->>'action' is distinct from 'cancel' or cancelled.command->>'slotId' is distinct from p.id::text
      or cancelled.command->>'operationId' is distinct from cancelled.operation_id::text
      or cancelled.command->'expectedRevision' is distinct from to_jsonb(cancelled.revision-1)
      or (select count(*) from jsonb_object_keys(cancelled.query))<>6
      or not(cancelled.query ?& array['siteId','access','workerId','fromDate','throughDate','operationId'])
      or cancelled.query->>'siteId' is distinct from p.merchant_id or cancelled.query->>'workerId' is distinct from p.worker_id::text
      or cancelled.query->>'access' is distinct from 'owner' or cancelled.query->'operationId' is distinct from 'null'::jsonb then
      raise exception 'attendance_self_schedule_invalid';end if;
    cancellation_item:=jsonb_build_object('revision',cancelled.revision,'operationId',cancelled.operation_id,'actorId',cancelled.actor_auth_user_id,
      'recordedAt',to_char(cancelled.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  end if;
  slot_item:=jsonb_build_object('id',p.id,'revision',p.revision,'locationId',p.location_id,'locationName',p.location_name,'timeZone',p.time_zone,
    'workDate',to_char(p.work_date,'YYYY-MM-DD'),'startAt',pair->0,'endAt',pair->1,'cancelled',cancellation_item is not null,'hasPublicationEvidence',has_evidence);
  return jsonb_build_object('slot',slot_item,'publication',publication_item,'cancellation',cancellation_item);
end;
$$;
revoke all on function public.faolla_attendance_self_schedule_slot_v1(public.merchant_attendance_schedule_slots) from public,anon,authenticated,service_role;

create table if not exists public.merchant_attendance_shift_schedule_relations (
  merchant_id text not null check(merchant_id ~ '^\d{8}$'),start_event_id uuid not null references public.merchant_attendance_events(id),
  worker_id uuid not null,operation_id uuid not null,sequence bigint not null check(sequence between 1 and 9007199254740991),
  location_id uuid not null,occurred_at timestamptz not null check(isfinite(occurred_at)),event_time_zone text not null,
  employee_id uuid not null,employee_auth_user_id uuid not null,worker_version bigint not null,location_version bigint not null,settings_version bigint not null,
  selection jsonb null,slot_id uuid null,slot_revision bigint null,schedule_revision bigint not null check(schedule_revision between 0 and 9007199254740990),
  status text not null check(status in('linked','unselected','unverified')),reason text null,
  slot_snapshot jsonb null,publication_snapshot jsonb null,cancellation_snapshot jsonb null,
  recorded_at timestamptz not null check(isfinite(recorded_at)),binding_policy text not null check(binding_policy='employee-explicit-clock-in-v1'),
  primary key(merchant_id,start_event_id),unique(start_event_id),unique(merchant_id,worker_id,operation_id),
  foreign key(merchant_id,worker_id,operation_id) references public.merchant_attendance_events(merchant_id,worker_id,operation_id),
  foreign key(merchant_id,slot_id) references public.merchant_attendance_schedule_slots(merchant_id,id),
  check(worker_version between 1 and 9007199254740991 and location_version between 1 and 9007199254740991 and settings_version between 1 and 9007199254740991),
  check(char_length(event_time_zone) between 1 and 100 and event_time_zone=btrim(event_time_zone) and event_time_zone !~ '[[:cntrl:]]'),
  check((status='unselected' and reason is null and selection is null and slot_id is null and slot_revision is null
      and slot_snapshot is null and publication_snapshot is null and cancellation_snapshot is null)
    or (status in('linked','unverified') and selection is not null and slot_id is not null and slot_revision is not null and slot_revision between 1 and schedule_revision and slot_snapshot is not null
      and selection=jsonb_build_object('slotId',slot_id,'revision',slot_revision)
      and ((status='linked' and reason is null and publication_snapshot is not null and cancellation_snapshot is null)
        or (status='unverified' and reason is not null and reason in('publication_missing','cancelled','location_changed','outside_window'))))),
  check(octet_length(convert_to(coalesce(slot_snapshot,'null'::jsonb)::text,'UTF8'))<=4096
    and octet_length(convert_to(coalesce(publication_snapshot,'null'::jsonb)::text,'UTF8'))<=4096
    and octet_length(convert_to(coalesce(cancellation_snapshot,'null'::jsonb)::text,'UTF8'))<=2048)
);

-- Defend event/operation composite references and exact source snapshots even
-- against a malformed privileged INSERT. No trigger is installed on old tables.
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
    or ev.actor_employee_id is distinct from new.employee_id or ev.action<>'clock_in' or ev.source<>'web'
    or ev.occurred_at<>ev.received_at then raise exception 'attendance_self_schedule_invalid';end if;
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
revoke all on function public.faolla_attendance_self_schedule_guard_v1() from public,anon,authenticated,service_role;
alter table public.merchant_attendance_shift_schedule_relations enable row level security;
revoke all on public.merchant_attendance_shift_schedule_relations from public,anon,authenticated,service_role;
do $self_schedule_triggers$
begin
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_shift_schedule_relations'::regclass and tgname='attendance_self_schedule_insert') then
    create trigger attendance_self_schedule_insert before insert on public.merchant_attendance_shift_schedule_relations for each row execute function public.faolla_attendance_self_schedule_guard_v1();end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_shift_schedule_relations'::regclass and tgname='attendance_self_schedule_immutable') then
    create trigger attendance_self_schedule_immutable before update or delete on public.merchant_attendance_shift_schedule_relations for each row execute function public.faolla_attendance_events_append_only_v1();end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_shift_schedule_relations'::regclass and tgname='attendance_self_schedule_no_truncate') then
    create trigger attendance_self_schedule_no_truncate before truncate on public.merchant_attendance_shift_schedule_relations for each statement execute function public.faolla_attendance_events_append_only_v1();end if;
end;
$self_schedule_triggers$;

create or replace function public.faolla_attendance_self_schedule_v1(p_site_id text,p_auth_user_id uuid,p_command jsonb default null,
  p_selection jsonb default null,p_operation_id uuid default null,p_allow_write boolean default false,p_bind_rules boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare clock_result jsonb;selected jsonb:=nullif(p_selection,'null'::jsonb);choices jsonb;association jsonb:=null;entries jsonb:='[]';result jsonb;
  worker public.merchant_attendance_workers%rowtype;employee public.merchant_enterprise_employees%rowtype;location public.merchant_attendance_locations%rowtype;
  settings public.merchant_attendance_settings%rowtype;ev public.merchant_attendance_events%rowtype;slot public.merchant_attendance_schedule_slots%rowtype;
  saved public.merchant_attendance_shift_schedule_relations%rowtype;context jsonb;slot_item jsonb;publication_item jsonb;cancellation_item jsonb;
  candidates public.merchant_attendance_schedule_slots[];head bigint;day_now date;first_day date;last_day date;zone text;limited boolean:=false;
  status_name text;reason_name text;current_cancelled boolean;
  u constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_allow_write is null or p_bind_rules is null then
    raise exception 'attendance_invalid_request';end if;
  if p_command is null then
    if selected is not null then raise exception 'attendance_invalid_request';end if;
  else
    if jsonb_typeof(p_command) is distinct from 'object' or p_operation_id is not null then raise exception 'attendance_invalid_request';end if;
    if (select count(*) from jsonb_object_keys(p_command))<>5
      or not(p_command ?& array['operationId','locationId','action','expectedSequence','expectedWorkerId'])
      or p_command->>'action' is distinct from 'clock_in' then raise exception 'attendance_invalid_request';end if;
    if selected is not null then
      if jsonb_typeof(selected) is distinct from 'object' then raise exception 'attendance_invalid_request';end if;
      if (select count(*) from jsonb_object_keys(selected))<>2 or not(selected ?& array['slotId','revision'])
        or jsonb_typeof(selected->'slotId') is distinct from 'string' or coalesce(selected->>'slotId','') !~ u
        or jsonb_typeof(selected->'revision') is distinct from 'number' or coalesce(selected->>'revision','') !~ '^[1-9][0-9]{0,15}$'
        or (selected->>'revision')::numeric>9007199254740990 then raise exception 'attendance_invalid_request';end if;
    end if;
    -- Feature rollback forbids every POST, including replay. Authorized GET
    -- receipt recovery remains available and never falls back to an old POST.
    if not p_allow_write then raise exception 'attendance_self_schedule_disabled';end if;
  end if;
  -- Old111/134 retain settings SHARE, employee/role SHARE and worker UPDATE
  -- (SHARE for GET) until commit. Do not upgrade settings or add a reverse-order
  -- merchant lock. Rule binding has its OWN existing153 gate, passed explicitly.
  if p_bind_rules then clock_result:=public.faolla_attendance_self_bound_v1(p_site_id,p_auth_user_id,p_command,p_operation_id);
  else clock_result:=public.faolla_attendance_self_v1(p_site_id,p_auth_user_id,p_command,p_operation_id);end if;
  if clock_result->'replayed' is distinct from 'true'::jsonb and clock_result->'replayed' is distinct from 'false'::jsonb then
    raise exception 'attendance_self_schedule_invalid';end if;
  select * into worker from public.merchant_attendance_workers w where w.merchant_id=p_site_id and w.id=(clock_result->>'workerId')::uuid;
  select * into employee from public.merchant_enterprise_employees e where e.merchant_id=p_site_id and e.id=worker.employee_id;
  select * into location from public.merchant_attendance_locations l where l.merchant_id=p_site_id and l.id=worker.default_location_id for share;
  select * into settings from public.merchant_attendance_settings s where s.merchant_id=p_site_id;
  if worker.id is null or employee.id is null or employee.auth_user_id is distinct from p_auth_user_id or settings.merchant_id is null then
    raise exception 'attendance_access_denied';end if;
  select coalesce(max(c.revision),0) into head from public.merchant_attendance_schedule_commands c where c.merchant_id=p_site_id;
  choices:=jsonb_build_object('timeZone',null,'fromDate',null,'throughDate',null,'revision',head,'limited',false,'entries','[]'::jsonb);

  if clock_result->'receipt'<>'null'::jsonb then
    select * into ev from public.merchant_attendance_events where id=(clock_result->'receipt'->>'id')::uuid;
    if ev.id is null or ev.merchant_id is distinct from p_site_id or ev.worker_id is distinct from worker.id or ev.actor_employee_id is distinct from employee.id then
      raise exception 'attendance_self_schedule_invalid';end if;
    select * into saved from public.merchant_attendance_shift_schedule_relations where merchant_id=p_site_id and start_event_id=ev.id;
    if found then
      if saved.worker_id is distinct from worker.id or saved.operation_id is distinct from ev.operation_id or saved.employee_id is distinct from employee.id
        or saved.employee_auth_user_id is distinct from p_auth_user_id then raise exception 'attendance_access_denied';end if;
      if p_command is not null and saved.selection is distinct from selected then raise exception 'attendance_operation_conflict';end if;
    elsif p_command is not null and clock_result->'replayed'='false'::jsonb then
      if ev.action<>'clock_in' or ev.source<>'web' or ev.location_id is distinct from location.id
        or ev.operation_id::text is distinct from p_command->>'operationId' then raise exception 'attendance_self_schedule_invalid';end if;
      status_name:='unselected';reason_name:=null;
      if selected is not null then
        select * into slot from public.merchant_attendance_schedule_slots where merchant_id=p_site_id and id=(selected->>'slotId')::uuid;
        if slot.id is null or slot.worker_id is distinct from worker.id or slot.employee_id is distinct from employee.id then raise exception 'attendance_access_denied';end if;
        if slot.revision is distinct from (selected->>'revision')::bigint then raise exception 'attendance_invalid_request';end if;
        context:=public.faolla_attendance_self_schedule_slot_v1(slot);
        if context->'publication'->>'employeeAuthUserId' is not null and context->'publication'->>'employeeAuthUserId'<>p_auth_user_id::text then
          raise exception 'attendance_access_denied';end if;
        slot_item:=context->'slot';publication_item:=nullif(context->'publication','null'::jsonb);cancellation_item:=nullif(context->'cancellation','null'::jsonb);
        day_now:=(ev.occurred_at at time zone ev.time_zone)::date;
        reason_name:=case when (slot_item->>'cancelled')::boolean then 'cancelled'
          when slot.location_id<>ev.location_id then 'location_changed' when slot.work_date<day_now-1 or slot.work_date>day_now+1 then 'outside_window'
          when not (slot_item->>'hasPublicationEvidence')::boolean then 'publication_missing' else null end;
        status_name:=case when reason_name is null then 'linked' else 'unverified' end;
      end if;
      insert into public.merchant_attendance_shift_schedule_relations(merchant_id,start_event_id,worker_id,operation_id,sequence,location_id,occurred_at,event_time_zone,
        employee_id,employee_auth_user_id,worker_version,location_version,settings_version,selection,slot_id,slot_revision,schedule_revision,status,reason,
        slot_snapshot,publication_snapshot,cancellation_snapshot,recorded_at,binding_policy)
        values(p_site_id,ev.id,worker.id,ev.operation_id,ev.sequence,ev.location_id,ev.occurred_at,ev.time_zone,
          employee.id,p_auth_user_id,worker.version,location.version,settings.version,selected,slot.id,slot.revision,head,status_name,reason_name,
          slot_item,publication_item,cancellation_item,clock_timestamp(),'employee-explicit-clock-in-v1') returning * into saved;
    end if;
    -- A legacy operation with no relation is never backfilled, even if this POST
    -- now supplies a selection. 111 has already authorized/validated its replay.
    if saved.start_event_id is not null then
      if ev.action<>'clock_in' or saved.sequence is distinct from ev.sequence or saved.location_id is distinct from ev.location_id
        or saved.occurred_at is distinct from ev.occurred_at or saved.event_time_zone is distinct from ev.time_zone then raise exception 'attendance_self_schedule_invalid';end if;
      current_cancelled:=null;
      if saved.slot_id is not null then
        select * into slot from public.merchant_attendance_schedule_slots where merchant_id=p_site_id and id=saved.slot_id;
        if slot.id is null or slot.worker_id is distinct from saved.worker_id or slot.employee_id is distinct from saved.employee_id or slot.revision is distinct from saved.slot_revision then
          raise exception 'attendance_self_schedule_invalid';end if;
        context:=public.faolla_attendance_self_schedule_slot_v1(slot);current_cancelled:=(context->'slot'->>'cancelled')::boolean;
      end if;
      association:=jsonb_build_object('startEventId',saved.start_event_id,'operationId',saved.operation_id,'selection',saved.selection,'status',saved.status,'reason',saved.reason,
        'slot',saved.slot_snapshot,'observedRevision',saved.schedule_revision,'recordedAt',to_char(saved.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'currentCancelled',current_cancelled);
    end if;
  elsif p_command is not null then raise exception 'attendance_self_schedule_invalid';end if;

  -- Explicit state/receipt GET may also offer a bounded self-only list. First
  -- cap existing index candidates, THEN inspect identities/current location;
  -- filtering before LIMIT could scan unlimited cancelled/old-identity history.
  if p_command is null and p_allow_write and location.id is not null then
    zone:=location.time_zone;day_now:=(clock_timestamp() at time zone zone)::date;
    first_day:=greatest(day_now-1,date '2000-01-01');last_day:=least(day_now+1,date '2100-12-31');
    if first_day>last_day then raise exception 'attendance_self_schedule_invalid';end if;
    candidates:=array(select x from public.merchant_attendance_schedule_slots x where x.merchant_id=p_site_id and x.worker_id=worker.id
      and x.work_date between first_day and last_day order by x.work_date,x.start_at,x.id limit 101);
    limited:=cardinality(candidates)>100;
    if not limited then
      foreach slot in array candidates loop
        if slot.employee_id<>employee.id or slot.location_id<>location.id then continue;end if;
        context:=public.faolla_attendance_self_schedule_slot_v1(slot);
        if context->'publication'->>'employeeAuthUserId' is not null and context->'publication'->>'employeeAuthUserId'<>p_auth_user_id::text then continue;end if;
        entries:=entries||jsonb_build_array(context->'slot');
      end loop;
    end if;
    choices:=jsonb_build_object('timeZone',zone,'fromDate',to_char(first_day,'YYYY-MM-DD'),'throughDate',to_char(last_day,'YYYY-MM-DD'),
      'revision',head,'limited',limited,'entries',entries);
    if octet_length(convert_to(choices::text,'UTF8'))>48000 then
      -- Complete-or-unavailable, never a prefix advertised as a complete list.
      choices:=jsonb_build_object('timeZone',zone,'fromDate',to_char(first_day,'YYYY-MM-DD'),'throughDate',to_char(last_day,'YYYY-MM-DD'),
        'revision',head,'limited',true,'entries','[]'::jsonb);
    end if;
  end if;
  result:=jsonb_build_object('protocol','self-schedule-v1','clock',clock_result,'choices',choices,'association',association);
  if octet_length(convert_to(result::text,'UTF8'))>65536 then raise exception 'attendance_self_schedule_invalid';end if;
  return result;
  -- No exception subtransaction/catch: a failure of required association
  -- persistence must roll back the new event and optional133 binding together.
end;
$$;
revoke all on function public.faolla_attendance_self_schedule_v1(text,uuid,jsonb,jsonb,uuid,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_self_schedule_v1(text,uuid,jsonb,jsonb,uuid,boolean,boolean) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610050137,'merchant_attendance_self_schedule') on conflict(version) do nothing;

do $self_schedule_postconditions$
declare r text;p text;trigger_name text;trigger_function regprocedure;trigger_type smallint;
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610050137 and name='merchant_attendance_self_schedule')
    or not exists(select 1 from pg_class where oid='public.merchant_attendance_shift_schedule_relations'::regclass and relrowsecurity) then
    raise exception 'merchant_attendance_self_schedule_registry_postcondition_failed';end if;
  for trigger_name,trigger_function,trigger_type in select * from (values
    ('attendance_self_schedule_insert','public.faolla_attendance_self_schedule_guard_v1()'::regprocedure,7::smallint),
    ('attendance_self_schedule_immutable','public.faolla_attendance_events_append_only_v1()'::regprocedure,27::smallint),
    ('attendance_self_schedule_no_truncate','public.faolla_attendance_events_append_only_v1()'::regprocedure,34::smallint)
  ) wanted(name,fn,kind) loop
    if not exists(select 1 from pg_trigger t where t.tgrelid='public.merchant_attendance_shift_schedule_relations'::regclass
      and t.tgname=trigger_name and t.tgfoid=trigger_function::oid and t.tgtype=trigger_type and t.tgenabled in('O','A')
      and not t.tgisinternal and t.tgqual is null and t.tgnargs=0) then raise exception 'merchant_attendance_self_schedule_trigger_conflict';end if;
  end loop;
  foreach r in array array['anon','authenticated','service_role'] loop
    if exists(select 1 from pg_class c where c.oid='public.merchant_attendance_shift_schedule_relations'::regclass
      and (pg_has_role(r,c.relowner,'USAGE') or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
        where case when a.grantee=0 then true else pg_has_role(r,a.grantee,'USAGE') end))) then raise exception 'merchant_attendance_self_schedule_acl_postcondition_failed';end if;
    foreach p in array array['public.faolla_attendance_self_schedule_slot_v1(public.merchant_attendance_schedule_slots)','public.faolla_attendance_self_schedule_guard_v1()'] loop
      if has_function_privilege(r,p,'EXECUTE') then raise exception 'merchant_attendance_self_schedule_acl_postcondition_failed';end if;
    end loop;
  end loop;
  if not has_function_privilege('service_role','public.faolla_attendance_self_schedule_v1(text,uuid,jsonb,jsonb,uuid,boolean,boolean)','EXECUTE')
    or has_function_privilege('anon','public.faolla_attendance_self_schedule_v1(text,uuid,jsonb,jsonb,uuid,boolean,boolean)','EXECUTE')
    or has_function_privilege('authenticated','public.faolla_attendance_self_schedule_v1(text,uuid,jsonb,jsonb,uuid,boolean,boolean)','EXECUTE') then
    raise exception 'merchant_attendance_self_schedule_acl_postcondition_failed';end if;
  if exists(select 1 from pg_proc f cross join lateral aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where
    f.oid in('public.faolla_attendance_self_schedule_slot_v1(public.merchant_attendance_schedule_slots)'::regprocedure,
      'public.faolla_attendance_self_schedule_guard_v1()'::regprocedure,'public.faolla_attendance_self_schedule_v1(text,uuid,jsonb,jsonb,uuid,boolean,boolean)'::regprocedure)
    and a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'merchant_attendance_self_schedule_acl_postcondition_failed';end if;
end;
$self_schedule_postconditions$;
notify pgrst, 'reload schema';
commit;
