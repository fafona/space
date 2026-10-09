--196: owner-only, same-identity close/rejoin. No backfill, clock rewrite,
--automatic account/worker activation, PIN issuance, or delegation revival.
--Only controlled employment chains extend064;164 gets a closed-state gate.
begin;
set local lock_timeout='3s';
do $employment_prerequisites$
declare d record;n text;installed boolean;
begin
  if to_regclass('public.faolla_schema_migrations') is null then raise exception 'merchant_attendance_employment_lifecycle_prerequisite_required';end if;
  for d in select * from (values
    (202609290061::bigint,'merchant_attendance_foundation'),(202609290063::bigint,'merchant_attendance_self_clock'),
    (202609290064::bigint,'merchant_attendance_owner_configuration'),(202610030122::bigint,'merchant_attendance_leave_requests'),
    (202610050137::bigint,'merchant_attendance_self_schedule'),(202610060156::bigint,'merchant_attendance_work_arrangements'),
    (202610060164::bigint,'merchant_attendance_account_suspensions')) v(version,name) loop
    if not exists(select 1 from public.faolla_schema_migrations x where x.version=d.version and x.name=d.name) then raise exception 'merchant_attendance_employment_lifecycle_prerequisite_required';end if;
  end loop;
  if exists(select 1 from public.faolla_schema_migrations where version=202610060166 and name<>'merchant_attendance_employment_lifecycle') then raise exception 'merchant_attendance_employment_lifecycle_installation_conflict';end if;
  select exists(select 1 from public.faolla_schema_migrations where version=202610060166 and name='merchant_attendance_employment_lifecycle') into installed;
  if installed<>(to_regclass('public.merchant_attendance_employment_operations') is not null) then raise exception 'merchant_attendance_employment_lifecycle_installation_conflict';end if;
  foreach n in array array['public.faolla_attendance_admin_v1(text,uuid,jsonb,jsonb,uuid)',
    'public.faolla_attendance_account_detail_v1(public.merchant_attendance_account_suspensions)',
    'public.faolla_attendance_account_hash_v1(jsonb)','public.faolla_attendance_employment_guard_v1()',
    'public.faolla_attendance_self_schedule_slot_v1(public.merchant_attendance_schedule_slots)',
    'public.faolla_attendance_leave_summary_v1(public.merchant_attendance_leave_requests,integer)',
    'public.faolla_attendance_work_arrangement_summary_v1(public.merchant_attendance_work_arrangement_requests,integer)'] loop
    if to_regprocedure(n) is null then raise exception 'merchant_attendance_employment_lifecycle_prerequisite_required';end if;
  end loop;
  foreach n in array array['faolla_attendance_admin_pre166','faolla_attendance_account_detail_pre166',
    'faolla_attendance_employment_command_v1','faolla_attendance_employment_hash_v1','faolla_attendance_employment_chain_v1',
    'faolla_attendance_employment_worker_v1','faolla_attendance_employment_receipt_v1','faolla_attendance_employment_detail_v1',
    'faolla_attendance_employment_config_v1','faolla_attendance_employment_lifecycle_v1'] loop
    if installed<>exists(select 1 from pg_proc where pronamespace=(select relnamespace from pg_class where oid='public.merchants'::regclass) and proname=n) then raise exception 'merchant_attendance_employment_lifecycle_installation_conflict';end if;
  end loop;
end;
$employment_prerequisites$;

--Copy exact legacy implementations without renaming their original OIDs.
--On reentry, the private copies remain the immutable source for narrow patches.
do $employment_legacy_copies$
declare spec record;definition text;needle text;replacement text;
begin
  for spec in select * from (values
    ('faolla_attendance_admin_v1','faolla_attendance_admin_pre166','text,uuid,jsonb,jsonb,uuid'),
    ('faolla_attendance_account_detail_v1','faolla_attendance_account_detail_pre166','public.merchant_attendance_account_suspensions')) v(original,copy,args) loop
    if to_regprocedure('public.'||spec.copy||'('||spec.args||')') is null then
      definition:=pg_get_functiondef(to_regprocedure('public.'||spec.original||'('||spec.args||')'));
      needle:='FUNCTION public.'||spec.original||'(';replacement:='FUNCTION public.'||spec.copy||'(';
      if strpos(definition,needle)=0 then raise exception 'merchant_attendance_employment_lifecycle_installation_conflict';end if;
      execute replace(definition,needle,replacement);
    end if;
  end loop;
end;
$employment_legacy_copies$;

create or replace function public.faolla_attendance_employment_command_v1(p jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare k text;
begin
  if public.faolla_attendance_shift_rule_binding_object_v1(p,array['action','operationId','workerId','employeeId','employeeAuthUserId','expectedWorkerVersion',
    'expectedEmployeeVersion','expectedSettingsVersion','expectedRevision','expectedPeriodId','suspensionId','expectedGeneration','expectedDate','reason']) is distinct from true
    or p->>'action' is null or p->>'action' not in('close','rejoin') or octet_length(p::text)>8192 then return false;end if;
  foreach k in array array['operationId','workerId','employeeId','employeeAuthUserId','expectedPeriodId','suspensionId'] loop
    if public.faolla_attendance_shift_rule_binding_scalar_v1(p->k,'uuid') is distinct from true then return false;end if;
  end loop;
  foreach k in array array['expectedWorkerVersion','expectedEmployeeVersion','expectedSettingsVersion','expectedGeneration'] loop
    if public.faolla_attendance_shift_rule_binding_scalar_v1(p->k,'version') is distinct from true then return false;end if;
  end loop;
  if jsonb_typeof(p->'expectedRevision') is distinct from 'number' or coalesce(p->>'expectedRevision','') !~ '^(0|[1-9][0-9]{0,15})$'
    or (p->>'expectedRevision')::numeric>9007199254740991
    or jsonb_typeof(p->'expectedDate') is distinct from 'string' or coalesce(p->>'expectedDate','') !~ '^\d{4}-\d{2}-\d{2}$'
    or (p->>'expectedDate')::date not between date '2000-01-01' and date '2100-12-31'
    or to_char((p->>'expectedDate')::date,'YYYY-MM-DD')<>p->>'expectedDate'
    or jsonb_typeof(p->'reason') is distinct from 'string' or public.faolla_attendance_group_text_v1(p->>'reason',1,500) is distinct from true
    or p->>'reason'<>btrim(p->>'reason') then return false;end if;
  return true;
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation or numeric_value_out_of_range then return false;
end;
$$;
create or replace function public.faolla_attendance_employment_hash_v1(p_site text,p jsonb)
returns text language sql immutable set search_path=pg_catalog as $$
  select public.faolla_attendance_account_hash_v1(jsonb_build_array('attendance-employment-lifecycle-v1',p_site,p->>'action',p->>'operationId',p->>'workerId',p->>'employeeId',p->>'employeeAuthUserId',
    (p->>'expectedWorkerVersion')::bigint,(p->>'expectedEmployeeVersion')::bigint,(p->>'expectedSettingsVersion')::bigint,(p->>'expectedRevision')::bigint,
    p->>'expectedPeriodId',p->>'suspensionId',(p->>'expectedGeneration')::bigint,p->>'expectedDate',p->>'reason'));
$$;
create table if not exists public.merchant_attendance_employment_operations(
  merchant_id text not null references public.merchant_attendance_settings(merchant_id),operation_id uuid not null,
  worker_id uuid not null,employee_id uuid not null,employee_auth_user_id uuid not null,actor_auth_user_id uuid not null,
  revision bigint not null check(revision between 1 and 199),action text not null check(action in('close','rejoin')),
  period_id uuid not null references public.merchant_attendance_employment_periods(id),starts_on date not null,ends_on date,
  suspension_id uuid not null,generation bigint not null,time_zone text not null,
  command jsonb not null check(public.faolla_attendance_employment_command_v1(command)),command_fingerprint text not null check(command_fingerprint ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null check(isfinite(recorded_at)),
  primary key(merchant_id,operation_id),unique(merchant_id,worker_id,revision),
  foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id),
  foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id),
  foreign key(merchant_id,suspension_id,employee_id,generation) references public.merchant_attendance_account_suspensions(merchant_id,suspension_id,employee_id,generation),
  check(starts_on between date '2000-01-01' and date '2100-12-31' and (ends_on is null or ends_on between starts_on and date '2100-12-31')),
  check((action='close' and ends_on is not null and revision%2=1) or (action='rejoin' and ends_on is null and revision%2=0)),
  check(char_length(time_zone) between 1 and 100 and time_zone=btrim(time_zone) and time_zone !~ '[[:cntrl:]]')
);

create or replace function public.faolla_attendance_employment_receipt_v1(p public.merchant_attendance_employment_operations)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
begin
  if p.operation_id is null then return null;end if;
  if public.faolla_attendance_employment_command_v1(p.command) is distinct from true
    or p.command->>'operationId' is distinct from p.operation_id::text or p.command->>'action' is distinct from p.action
    or p.command->>'workerId' is distinct from p.worker_id::text or p.command->>'employeeId' is distinct from p.employee_id::text
    or p.command->>'employeeAuthUserId' is distinct from p.employee_auth_user_id::text or p.command->'expectedRevision' is distinct from to_jsonb(p.revision-1)
    or p.command->>'suspensionId' is distinct from p.suspension_id::text or p.command->'expectedGeneration' is distinct from to_jsonb(p.generation)
    or p.command_fingerprint is distinct from public.faolla_attendance_employment_hash_v1(p.merchant_id,p.command)
    or (p.action='close' and (p.command->>'expectedDate' is distinct from p.ends_on::text or p.command->>'expectedPeriodId' is distinct from p.period_id::text))
    or (p.action='rejoin' and (p.command->>'expectedDate' is distinct from p.starts_on::text or p.command->>'expectedPeriodId'=p.period_id::text)) then raise exception 'attendance_employment_lifecycle_invalid';end if;
  return jsonb_build_object('operationId',p.operation_id,'actorId',p.actor_auth_user_id,'workerId',p.worker_id,'employeeId',p.employee_id,'employeeAuthUserId',p.employee_auth_user_id,
    'action',p.action,'revision',p.revision,'periodId',p.period_id,'startsOn',p.starts_on::text,'endsOn',p.ends_on::text,
    'recordedAt',to_char(p.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'commandFingerprint',p.command_fingerprint);
end;
$$;

--Bounded full same-worker chain: at most100 periods and199 operations. No
--global employee history, name matching, current-owner test on old receipts,
--or reinterpretation of saved dates with today's timezone rules.
create or replace function public.faolla_attendance_employment_chain_v1(p_site text,p_worker uuid,p_employee uuid,p_auth uuid)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare periods jsonb;ids uuid[];row_p public.merchant_attendance_employment_periods%rowtype;
  entry public.merchant_attendance_employment_operations%rowtype;prior public.merchant_attendance_employment_operations%rowtype;
  pause public.merchant_attendance_account_suspensions%rowtype;n integer:=0;seen uuid[]:='{}';last_end date;valid boolean:=true;limited boolean:=false;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'startsOn',x.starts_on::text,'endsOn',x.ends_on::text) order by x.starts_on,x.id),'[]'::jsonb),array_agg(x.id order by x.starts_on,x.id)
    into periods,ids from (select * from public.merchant_attendance_employment_periods p where p.merchant_id=p_site and p.worker_id=p_worker order by p.starts_on,p.id limit 101) x;
  if jsonb_array_length(periods)>100 then periods:='[]';limited:=true;valid:=false;end if;
  for entry in select * from public.merchant_attendance_employment_operations x where x.merchant_id=p_site and x.worker_id=p_worker order by x.revision limit 201 loop
    n:=n+1;
    if n>199 then limited:=true;valid:=false;exit;end if;
    perform public.faolla_attendance_employment_receipt_v1(entry);
    if entry.revision<>n or entry.employee_id is distinct from p_employee or entry.employee_auth_user_id is distinct from p_auth then valid:=false;end if;
    select * into pause from public.merchant_attendance_account_suspensions x where x.merchant_id=p_site and x.suspension_id=entry.suspension_id;
    if pause.employee_id is distinct from entry.employee_id or pause.employee_auth_user_id is distinct from entry.employee_auth_user_id
      or pause.worker_id is distinct from p_worker or pause.generation is distinct from entry.generation or pause.was_active is null then valid:=false;end if;
    select * into row_p from public.merchant_attendance_employment_periods x where x.merchant_id=p_site and x.worker_id=p_worker and x.id=entry.period_id;
    if row_p.id is null or row_p.starts_on is distinct from entry.starts_on or (entry.action='close' and row_p.ends_on is distinct from entry.ends_on) then valid:=false;end if;
    if entry.action='close' then
      if n>1 and (prior.action<>'rejoin' or prior.period_id<>entry.period_id or prior.starts_on<>entry.starts_on) then valid:=false;end if;
      if n=1 then seen:=array_append(seen,entry.period_id);end if;
    else
      if prior.action is distinct from 'close' or entry.command->>'expectedPeriodId' is distinct from prior.period_id::text
        or entry.starts_on<=prior.ends_on or entry.period_id=any(seen) then valid:=false;end if;
      seen:=array_append(seen,entry.period_id);
    end if;
    prior:=entry;
  end loop;
  if n=0 then
    valid:=not limited and jsonb_array_length(periods)=1 and periods->0->'endsOn'='null'::jsonb;
  else
    if ids is distinct from seen or n<>prior.revision or (prior.action='rejoin' and row_p.ends_on is not null) then valid:=false;end if;
  end if;
  for row_p in select * from public.merchant_attendance_employment_periods p where p.merchant_id=p_site and p.worker_id=p_worker order by p.starts_on,p.id limit 101 loop
    if last_end is not null and row_p.starts_on<=last_end then valid:=false;end if;
    last_end:=coalesce(row_p.ends_on,date '9999-12-31');
  end loop;
  if limited then periods:='[]';end if;
  return jsonb_build_object('revision',coalesce(prior.revision,0),'state',case when n=0 then 'untracked' when prior.action='close' then 'closed' else 'rejoined' end,
    'periods',periods,'valid',coalesce(valid,false),'limited',limited);
end;
$$;

create or replace function public.faolla_attendance_employment_worker_v1(p public.merchant_attendance_workers,e public.merchant_enterprise_employees)
returns jsonb language sql stable set search_path=pg_catalog as $$
  select jsonb_build_object('id',p.id,'employeeId',p.employee_id,'employeeAuthUserId',e.auth_user_id,'workerNo',p.worker_no,'displayName',p.display_name,
    'employeeName',e.display_name,'active',p.active,'version',p.version,'employeeVersion',e.version);
$$;

--Caller holds merchant/settings then worker, then employee. Every supported
--clock/config/application writer conflicts with settings UPDATE on mutation;
--read detail takes worker UPDATE before employee SHARE for a stable tail.
create or replace function public.faolla_attendance_employment_detail_v1(p_site text,p_worker uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;s public.merchant_attendance_settings%rowtype;
  epoch public.merchant_attendance_account_epochs%rowtype;pause public.merchant_attendance_account_suspensions%rowtype;ev public.merchant_attendance_events%rowtype;
  schedule public.merchant_attendance_schedule_slots%rowtype;leave_row public.merchant_attendance_leave_requests%rowtype;work_row public.merchant_attendance_work_arrangement_requests%rowtype;
  now_at timestamptz;today date;chain jsonb;base jsonb:='[]';cb jsonb;rb jsonb;pending jsonb:='[]';limited boolean:=false;
  candidate record;item jsonb;context jsonb;last_period jsonb;count_items integer:=0;pause_json jsonb;
begin
  select * into s from public.merchant_attendance_settings x where x.merchant_id=p_site;
  select * into w from public.merchant_attendance_workers x where x.merchant_id=p_site and x.id=p_worker for update;
  if w.id is null then raise exception 'attendance_worker_not_found';end if;
  select * into e from public.merchant_enterprise_employees x where x.merchant_id=p_site and x.id=w.employee_id for share;
  if s.merchant_id is null then raise exception 'attendance_settings_required';end if;
  if public.faolla_attendance_valid_zone_v1(s.time_zone) is distinct from true then raise exception 'attendance_employment_lifecycle_invalid';end if;
  now_at:=clock_timestamp();today:=(now_at at time zone s.time_zone)::date;
  if today not between date '2000-01-01' and date '2100-12-31' then raise exception 'attendance_employment_lifecycle_invalid';end if;
  chain:=public.faolla_attendance_employment_chain_v1(p_site,w.id,e.id,e.auth_user_id);
  select * into epoch from public.merchant_attendance_account_epochs x where x.merchant_id=p_site and x.employee_id=e.id;
  select * into pause from public.merchant_attendance_account_suspensions x where x.merchant_id=p_site and x.suspension_id=epoch.suspension_id;
  if e.id is null or e.auth_user_id is null or w.employee_id is distinct from e.id
    or (pause.suspension_id is not null and (pause.worker_id is distinct from w.id or pause.employee_id is distinct from e.id or pause.employee_auth_user_id is distinct from e.auth_user_id)) then base:=base||'"binding_changed"'::jsonb;end if;
  if epoch.paused is distinct from true or pause.suspension_id is null or pause.generation is distinct from epoch.generation or pause.was_active is null then base:=base||'"not_paused"'::jsonb;end if;
  if w.active then base:=base||'"worker_active"'::jsonb;end if;
  select * into ev from public.merchant_attendance_events x where x.merchant_id=p_site and x.worker_id=w.id order by x.sequence desc limit 1;
  if (ev.id is not null and ev.actor_employee_id is distinct from e.id)
    or (pause.suspension_id is not null and (ev.id,ev.sequence,ev.action,ev.actor_employee_id) is distinct from (pause.original_event_id,pause.original_sequence,pause.original_action,pause.original_actor_employee_id)) then base:=base||'"state_binding_changed"'::jsonb;end if;
  if ev.id is not null and ev.action<>'clock_out' then base:=base||'"open_session"'::jsonb;end if;
  if (chain->>'limited')::boolean then base:=base||'"history_limit"'::jsonb;
  elsif chain->'valid' is distinct from 'true'::jsonb then base:=base||'"history_uncontrolled"'::jsonb;end if;
  --Filter ended/terminal rows BEFORE the combined sentinel. Existing worker
  --range indexes serve each branch. Identity is checked after selection, not
  --used to hide a conflicting saved identity from the readiness decision.
  for candidate in select z.* from (
    (select x.id,'schedule'::text kind,x.start_at from public.merchant_attendance_schedule_slots x
      where x.merchant_id=p_site and x.worker_id=w.id and x.end_at>now_at
        and not exists(select 1 from public.merchant_attendance_schedule_cancellations c where c.merchant_id=x.merchant_id and c.slot_id=x.id)
      order by x.start_at,x.id limit 101)
    union all
    (select x.request_id,'leave'::text,x.start_at from public.merchant_attendance_leave_requests x
      where x.merchant_id=p_site and x.worker_id=w.id and x.end_at>now_at
        and not exists(select 1 from public.merchant_attendance_leave_entries z where z.merchant_id=x.merchant_id and z.request_id=x.request_id and z.action in('withdraw','reject','cancel'))
      order by x.start_at,x.request_id limit 101)
    union all
    (select x.request_id,x.kind,x.start_at from public.merchant_attendance_work_arrangement_requests x
      where x.merchant_id=p_site and x.worker_id=w.id and x.end_at>now_at
        and not exists(select 1 from public.merchant_attendance_work_arrangement_entries z where z.merchant_id=x.merchant_id and z.request_id=x.request_id and z.action in('withdraw','reject','cancel'))
      order by x.start_at,x.request_id limit 101)
    ) z order by z.start_at,z.kind,z.id limit 101 loop
    count_items:=count_items+1;if count_items>100 then limited:=true;pending:='[]';exit;end if;
    if candidate.kind='schedule' then
      select * into schedule from public.merchant_attendance_schedule_slots x where x.merchant_id=p_site and x.id=candidate.id;
      context:=public.faolla_attendance_self_schedule_slot_v1(schedule);item:=context->'slot';
      if schedule.employee_id is distinct from e.id or (context->'publication' is distinct from 'null'::jsonb and context->'publication'->>'employeeAuthUserId' is distinct from e.auth_user_id::text)
        then if not(base ? 'binding_changed') then base:=base||'"binding_changed"'::jsonb;end if;end if;
      item:=jsonb_build_object('id',schedule.id,'kind','schedule','status','published','startAt',item->'startAt','endAt',item->'endAt','timeZone',schedule.time_zone);
    elsif candidate.kind='leave' then
      select * into leave_row from public.merchant_attendance_leave_requests x where x.merchant_id=p_site and x.request_id=candidate.id;
      item:=public.faolla_attendance_leave_summary_v1(leave_row);
      if leave_row.employee_id is distinct from e.id or leave_row.actor_auth_user_id is distinct from e.auth_user_id then if not(base ? 'binding_changed') then base:=base||'"binding_changed"'::jsonb;end if;end if;
      if item->>'status' not in('submitted','approved') then raise exception 'attendance_employment_lifecycle_invalid';end if;
      item:=jsonb_build_object('id',leave_row.request_id,'kind','leave','status',item->'status',
        'startAt',to_char(leave_row.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'endAt',to_char(leave_row.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'timeZone',leave_row.time_zone);
    else
      select * into work_row from public.merchant_attendance_work_arrangement_requests x where x.merchant_id=p_site and x.request_id=candidate.id;
      item:=public.faolla_attendance_work_arrangement_summary_v1(work_row);
      if work_row.employee_id is distinct from e.id or work_row.actor_auth_user_id is distinct from e.auth_user_id then if not(base ? 'binding_changed') then base:=base||'"binding_changed"'::jsonb;end if;end if;
      if item->>'status' not in('submitted','approved') then raise exception 'attendance_employment_lifecycle_invalid';end if;
      item:=jsonb_build_object('id',work_row.request_id,'kind',work_row.kind,'status',item->'status',
        'startAt',to_char(work_row.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'endAt',to_char(work_row.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'timeZone',work_row.time_zone);
    end if;
    pending:=pending||jsonb_build_array(item);
  end loop;
  if limited then base:=base||'"pending_limit"'::jsonb;elsif count_items>0 then base:=base||'"pending_items"'::jsonb;end if;
  cb:=base;rb:=base;last_period:=chain->'periods'->-1;
  if chain->>'state'='closed' then cb:=cb||'"employment_closed"'::jsonb;
  else rb:=rb||'"employment_open"'::jsonb;end if;
  if last_period is null or last_period->'endsOn'<>'null'::jsonb or (last_period->>'startsOn')::date>today then
    if not(cb ? 'employment_closed') then cb:=cb||'"date_out_of_range"'::jsonb;end if;
  end if;
  if last_period is not null and last_period->'endsOn'<>'null'::jsonb and (last_period->>'endsOn')::date>=today then rb:=rb||'"date_not_after_end"'::jsonb;end if;
  if jsonb_array_length(chain->'periods')>=100 and not(rb ? 'history_limit') then rb:=rb||'"history_limit"'::jsonb;end if;
  if pause.suspension_id is not null and pause.was_active is not null then pause_json:=jsonb_build_object('id',pause.suspension_id,'generation',pause.generation,'wasActive',pause.was_active,'paused',epoch.paused);end if;
  return jsonb_build_object('worker',public.faolla_attendance_employment_worker_v1(w,e),'settingsVersion',s.version,'timeZone',s.time_zone,'today',today::text,
    'readAt',to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'revision',chain->'revision','state',chain->'state','periods',chain->'periods',
    'suspension',pause_json,'originalAction',pause.original_action,'currentAction',ev.action,'canClose',jsonb_array_length(cb)=0,'canRejoin',jsonb_array_length(rb)=0,
    'closeBlockers',cb,'rejoinBlockers',rb,'pending',jsonb_build_object('items',pending,'limited',limited,'historicalPending','not_checked'));
end;
$$;

--No new permission or current identity is inferred from the old owner receipt.
create or replace function public.faolla_attendance_employment_lifecycle_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;mode_name text;wid uuid;after_id uuid;after_revision bigint;op uuid;m public.merchants%rowtype;
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
  prior public.merchant_attendance_employment_operations%rowtype;row_p public.merchant_attendance_employment_periods%rowtype;
  items jsonb:='[]';history jsonb:='[]';detail jsonb;receipt jsonb;result_json jsonb;chain jsonb;next_id uuid;next_revision bigint;stamp timestamptz;today date;
begin
  if p_auth_user_id is null or p_allow_write is null or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','mode','workerId','afterId','afterRevision','operationId']) is distinct from true
    or jsonb_typeof(p_query->'siteId') is distinct from 'string' or coalesce(p_query->>'siteId','') !~ '^\d{8}$'
    or p_query->>'mode' is null or p_query->>'mode' not in('list','detail','history','recover') then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';mode_name:=p_query->>'mode';
  if (p_query->'workerId'<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'workerId','uuid') is distinct from true)
    or (p_query->'afterId'<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'afterId','uuid') is distinct from true)
    or (p_query->'operationId'<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'operationId','uuid') is distinct from true)
    or (p_query->'afterRevision'<>'null'::jsonb and (jsonb_typeof(p_query->'afterRevision') is distinct from 'number' or coalesce(p_query->>'afterRevision','') !~ '^(0|[1-9][0-9]{0,15})$')) then raise exception 'attendance_invalid_request';end if;
  wid:=(p_query->>'workerId')::uuid;after_id:=(p_query->>'afterId')::uuid;op:=(p_query->>'operationId')::uuid;after_revision:=(p_query->>'afterRevision')::bigint;
  if coalesce(after_revision,0)>9007199254740991 or (mode_name in('detail','history'))<>(wid is not null) or (mode_name='recover')<>(op is not null)
    or mode_name<>'list' and after_id is not null or mode_name<>'history' and after_revision is not null
    or (p_command is not null and (mode_name<>'detail' or public.faolla_attendance_employment_command_v1(p_command) is distinct from true or p_command->>'workerId' is distinct from wid::text)) then raise exception 'attendance_invalid_request';end if;
  select * into m from public.merchants x where x.id=site for share;
  if m.id is null then raise exception 'attendance_access_denied';end if;
  if mode_name='recover' then
    select * into prior from public.merchant_attendance_employment_operations x where x.merchant_id=site and x.operation_id=op;
    if prior.operation_id is not null then
      if prior.actor_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;
      receipt:=public.faolla_attendance_employment_receipt_v1(prior);
    end if;
  else
    if not coalesce(p_auth_user_id=any(array[m.user_id,m.auth_user_id,m.owner_user_id,m.owner_id,m.auth_id,m.created_by,m.created_by_user_id]),false) then raise exception 'attendance_access_denied';end if;
    if p_command is null then select * into s from public.merchant_attendance_settings x where x.merchant_id=site for share;
    else select * into s from public.merchant_attendance_settings x where x.merchant_id=site for update;end if;
    if s.merchant_id is null then raise exception 'attendance_settings_required';end if;
    if p_command is not null then
      op:=(p_command->>'operationId')::uuid;
      select * into prior from public.merchant_attendance_employment_operations x where x.merchant_id=site and x.operation_id=op;
      if prior.operation_id is not null then
        if prior.actor_auth_user_id<>p_auth_user_id or prior.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
        receipt:=public.faolla_attendance_employment_receipt_v1(prior);
      else
        if not p_allow_write then raise exception 'attendance_employment_lifecycle_disabled';end if;
        detail:=public.faolla_attendance_employment_detail_v1(site,wid);
        if detail->'worker'->>'employeeId' is distinct from p_command->>'employeeId' or detail->'worker'->>'employeeAuthUserId' is distinct from p_command->>'employeeAuthUserId'
          or detail->'worker'->'version' is distinct from p_command->'expectedWorkerVersion' or detail->'worker'->'employeeVersion' is distinct from p_command->'expectedEmployeeVersion'
          or detail->'settingsVersion' is distinct from p_command->'expectedSettingsVersion' or detail->'revision' is distinct from p_command->'expectedRevision'
          or detail->'suspension'->>'id' is distinct from p_command->>'suspensionId' or detail->'suspension'->'generation' is distinct from p_command->'expectedGeneration'
          or detail->>'today' is distinct from p_command->>'expectedDate' or detail->'periods'->-1->>'id' is distinct from p_command->>'expectedPeriodId' then raise exception 'attendance_employment_lifecycle_changed';end if;
        if detail->(case when p_command->>'action'='close' then 'canClose' else 'canRejoin' end) is distinct from 'true'::jsonb then raise exception 'attendance_employment_lifecycle_blocked';end if;
        if s.version>=9007199254740990 or (p_command->>'expectedWorkerVersion')::bigint>=9007199254740990 then raise exception 'attendance_version_conflict';end if;
        stamp:=clock_timestamp();today:=(stamp at time zone s.time_zone)::date;
        if today::text<>p_command->>'expectedDate' then raise exception 'attendance_employment_lifecycle_changed';end if;
        if p_command->>'action'='close' then
          update public.merchant_attendance_employment_periods set ends_on=today where merchant_id=site and worker_id=wid and id=(p_command->>'expectedPeriodId')::uuid and ends_on is null returning * into row_p;
        else
          insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on,created_at) values(site,wid,today,stamp) returning * into row_p;
        end if;
        if row_p.id is null then raise exception 'attendance_employment_lifecycle_changed';end if;
        insert into public.merchant_attendance_employment_operations(merchant_id,operation_id,worker_id,employee_id,employee_auth_user_id,actor_auth_user_id,revision,action,
          period_id,starts_on,ends_on,suspension_id,generation,time_zone,command,command_fingerprint,recorded_at)
        values(site,op,wid,(p_command->>'employeeId')::uuid,(p_command->>'employeeAuthUserId')::uuid,p_auth_user_id,(p_command->>'expectedRevision')::bigint+1,p_command->>'action',
          row_p.id,row_p.starts_on,row_p.ends_on,(p_command->>'suspensionId')::uuid,(p_command->>'expectedGeneration')::bigint,s.time_zone,p_command,public.faolla_attendance_employment_hash_v1(site,p_command),stamp) returning * into prior;
        chain:=public.faolla_attendance_employment_chain_v1(site,wid,prior.employee_id,prior.employee_auth_user_id);
        if chain->'valid' is distinct from 'true'::jsonb then raise exception 'attendance_employment_lifecycle_invalid';end if;
        update public.merchant_attendance_workers set version=version+1,updated_at=stamp where merchant_id=site and id=wid;
        update public.merchant_attendance_settings set version=version+1,updated_at=stamp where merchant_id=site;
        receipt:=public.faolla_attendance_employment_receipt_v1(prior);detail:=null;
      end if;
    elsif mode_name='detail' then detail:=public.faolla_attendance_employment_detail_v1(site,wid);
    elsif mode_name='history' then
      perform 1 from public.merchant_attendance_workers x where x.merchant_id=site and x.id=wid for share;
      if not found then raise exception 'attendance_worker_not_found';end if;
      for prior in select * from public.merchant_attendance_employment_operations x where x.merchant_id=site and x.worker_id=wid and x.revision>coalesce(after_revision,0) order by x.revision limit 26 loop
        if jsonb_array_length(history)=25 then next_revision:=(history->24->>'revision')::bigint;exit;end if;
        history:=history||jsonb_build_array(public.faolla_attendance_employment_receipt_v1(prior));
      end loop;
    else
      for w in select * from public.merchant_attendance_workers x where x.merchant_id=site and (after_id is null or x.id>after_id) order by x.id limit 26 for share loop
        if jsonb_array_length(items)=25 then next_id:=(items->24->'worker'->>'id')::uuid;exit;end if;
        select * into e from public.merchant_enterprise_employees x where x.merchant_id=site and x.id=w.employee_id for share;
        select * into prior from public.merchant_attendance_employment_operations x where x.merchant_id=site and x.worker_id=w.id order by x.revision desc limit 1;
        select * into row_p from public.merchant_attendance_employment_periods x where x.merchant_id=site and x.worker_id=w.id order by x.starts_on desc,x.id desc limit 1;
        if prior.operation_id is not null then perform public.faolla_attendance_employment_receipt_v1(prior);end if;
        items:=items||jsonb_build_array(jsonb_build_object('worker',public.faolla_attendance_employment_worker_v1(w,e),'revision',coalesce(prior.revision,0),
          'state',case when prior.operation_id is null then 'untracked' when prior.action='close' then 'closed' else 'rejoined' end,
          'period',case when row_p.id is null then null else jsonb_build_object('id',row_p.id,'startsOn',row_p.starts_on::text,'endsOn',row_p.ends_on::text) end));
      end loop;
    end if;
  end if;
  result_json:=jsonb_build_object('siteId',site,'mode',mode_name,'items',items,'nextAfterId',next_id,'detail',detail,'history',history,'nextAfterRevision',next_revision,'receipt',receipt);
  if octet_length(result_json::text)>131072 then raise exception 'attendance_employment_lifecycle_too_large';end if;
  return result_json;
end;
$$;

--The compatibility predicate is called only at064's original history gate:
--same authentication, replay priority, CAS, open-tail and location checks stay.
create or replace function public.faolla_attendance_employment_config_v1(p_site text,p_worker uuid,p_employee uuid,p_start date,p_active boolean)
returns boolean language plpgsql set search_path=pg_catalog as $$
declare e public.merchant_enterprise_employees%rowtype;chain jsonb;last_period jsonb;today date;zone_name text;
begin
  if not exists(select 1 from public.merchant_attendance_employment_operations x where x.merchant_id=p_site and x.worker_id=p_worker) then
    return (select count(*)=1 from public.merchant_attendance_employment_periods x where x.merchant_id=p_site and x.worker_id=p_worker)
      and exists(select 1 from public.merchant_attendance_employment_periods x where x.merchant_id=p_site and x.worker_id=p_worker and x.starts_on=p_start and x.ends_on is null);
  end if;
  select * into e from public.merchant_enterprise_employees x where x.merchant_id=p_site and x.id=p_employee;
  chain:=public.faolla_attendance_employment_chain_v1(p_site,p_worker,e.id,e.auth_user_id);last_period:=chain->'periods'->-1;
  if chain->'valid' is distinct from 'true'::jsonb or e.auth_user_id is null or last_period->>'startsOn' is distinct from p_start::text then return false;end if;
  if chain->>'state'='closed' then return not p_active;end if;
  select time_zone into zone_name from public.merchant_attendance_settings where merchant_id=p_site;
  today:=(clock_timestamp() at time zone zone_name)::date;
  return last_period->'endsOn'='null'::jsonb and (not p_active or p_start<=today);
end;
$$;
do $employment_admin_patch$
declare definition text;needle text;replacement text;
begin
  definition:=pg_get_functiondef('public.faolla_attendance_admin_pre166(text,uuid,jsonb,jsonb,uuid)'::regprocedure);
  needle:=$old$or (select count(*) from public.merchant_attendance_employment_periods where merchant_id=p_site_id and worker_id=v_id)<>1
          or not exists(select 1 from public.merchant_attendance_employment_periods where merchant_id=p_site_id and worker_id=v_id and starts_on=v_start and ends_on is null)$old$;
  replacement:=$new$or not public.faolla_attendance_employment_config_v1(p_site_id,v_id,v_employee.id,v_start,(v_values->>'active')::boolean)$new$;
  definition:=replace(definition,E'\r\n',E'\n');
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'merchant_attendance_employment_lifecycle_installation_conflict';end if;
  definition:=replace(definition,'FUNCTION public.faolla_attendance_admin_pre166(','FUNCTION public.faolla_attendance_admin_v1(');
  execute replace(definition,needle,replacement);
end;
$employment_admin_patch$;

create or replace function public.faolla_attendance_account_detail_v1(p public.merchant_attendance_account_suspensions)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare result_json jsonb;chain jsonb;e public.merchant_enterprise_employees%rowtype;zone_name text;today date;last_period jsonb;
begin
  result_json:=public.faolla_attendance_account_detail_pre166(p);
  if p.worker_id is not null and exists(select 1 from public.merchant_attendance_employment_operations x where x.merchant_id=p.merchant_id and x.worker_id=p.worker_id) then
    select * into e from public.merchant_enterprise_employees x where x.merchant_id=p.merchant_id and x.id=p.employee_id;
    chain:=public.faolla_attendance_employment_chain_v1(p.merchant_id,p.worker_id,e.id,e.auth_user_id);
    select time_zone into zone_name from public.merchant_attendance_settings where merchant_id=p.merchant_id;
    today:=(clock_timestamp() at time zone zone_name)::date;last_period:=chain->'periods'->-1;
    --Outside was_active: a formerly inactive worker cannot clear a closed pause.
    --A later settings-zone change may move the civil date before the new start;
    --controlled restoration still needs the actual current open period today.
    if chain->>'state'='closed' or chain->'valid' is distinct from 'true'::jsonb
      or last_period is null or last_period->'endsOn' is distinct from 'null'::jsonb
      or (last_period->>'startsOn')::date>today or today is null then
      result_json:=jsonb_set(jsonb_set(result_json,'{canRestore}','false'::jsonb),'{blockers}',(result_json->'blockers')||'"employment_closed"'::jsonb);
    end if;
  end if;
  return result_json;
end;
$$;

alter table public.merchant_attendance_employment_operations enable row level security;
revoke all on table public.merchant_attendance_employment_operations from public,anon,authenticated,service_role;
do $employment_immutable$
begin
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_employment_operations'::regclass and tgname='attendance_employment_immutable') then
    create trigger attendance_employment_immutable before update or delete on public.merchant_attendance_employment_operations for each row execute function public.faolla_attendance_events_append_only_v1();end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_employment_operations'::regclass and tgname='attendance_employment_no_truncate') then
    create trigger attendance_employment_no_truncate before truncate on public.merchant_attendance_employment_operations for each statement execute function public.faolla_attendance_events_append_only_v1();end if;
end;
$employment_immutable$;
revoke all on function public.faolla_attendance_admin_pre166(text,uuid,jsonb,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_account_detail_pre166(public.merchant_attendance_account_suspensions) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_employment_command_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_employment_hash_v1(text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_employment_chain_v1(text,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_employment_worker_v1(public.merchant_attendance_workers,public.merchant_enterprise_employees) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_employment_receipt_v1(public.merchant_attendance_employment_operations) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_employment_detail_v1(text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_employment_config_v1(text,uuid,uuid,date,boolean) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_account_detail_v1(public.merchant_attendance_account_suspensions) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_employment_lifecycle_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_employment_lifecycle_v1(jsonb,uuid,jsonb,boolean) to service_role;

do $employment_postconditions$
declare n text;f regprocedure;t regclass:='public.merchant_attendance_employment_operations'::regclass;rpc boolean;columns text[];
begin
  if not exists(select 1 from pg_class where oid=t and relkind='r' and relrowsecurity) or exists(select 1 from pg_policy where polrelid=t)
    or exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid=t and (a.grantee=0 or a.grantee in(select oid from pg_roles where rolname in('anon','authenticated','service_role'))))
    or exists(select 1 from pg_constraint where conrelid=t and not convalidated) then raise exception 'merchant_attendance_employment_lifecycle_installation_conflict';end if;
  select array_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text order by a.attnum) into columns
    from pg_attribute a where a.attrelid=t and a.attnum>0 and not a.attisdropped;
  if columns is distinct from array['merchant_id:text:true','operation_id:uuid:true','worker_id:uuid:true','employee_id:uuid:true','employee_auth_user_id:uuid:true','actor_auth_user_id:uuid:true',
    'revision:bigint:true','action:text:true','period_id:uuid:true','starts_on:date:true','ends_on:date:false','suspension_id:uuid:true','generation:bigint:true','time_zone:text:true',
    'command:jsonb:true','command_fingerprint:text:true','recorded_at:timestamp with time zone:true']
    or (select count(*) from pg_constraint where conrelid=t and contype='f')<>5
    or (select count(*) from pg_constraint where conrelid=t and contype='c')<>8
    or not exists(select 1 from pg_constraint where conrelid=t and contype='p' and conkey=array[1,2]::smallint[])
    or not exists(select 1 from pg_constraint where conrelid=t and contype='u' and conkey=array[1,3,7]::smallint[])
    then raise exception 'merchant_attendance_employment_lifecycle_installation_conflict';end if;
  if not exists(select 1 from pg_trigger where tgrelid=t and tgname='attendance_employment_immutable' and tgenabled='O' and tgtype=27 and tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure)
    or not exists(select 1 from pg_trigger where tgrelid=t and tgname='attendance_employment_no_truncate' and tgenabled='O' and tgtype=34 and tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure) then raise exception 'merchant_attendance_employment_lifecycle_installation_conflict';end if;
  if not exists(select 1 from pg_index i where i.indrelid=t and i.indisunique and i.indisvalid and i.indisready and i.indnkeyatts=3 and i.indnatts=3 and i.indexprs is null and i.indpred is null
    and pg_get_indexdef(i.indexrelid,1,true)='merchant_id' and pg_get_indexdef(i.indexrelid,2,true)='worker_id' and pg_get_indexdef(i.indexrelid,3,true)='revision') then raise exception 'merchant_attendance_employment_lifecycle_installation_conflict';end if;
  foreach n in array array['public.faolla_attendance_admin_pre166(text,uuid,jsonb,jsonb,uuid)',
    'public.faolla_attendance_account_detail_pre166(public.merchant_attendance_account_suspensions)',
    'public.faolla_attendance_employment_command_v1(jsonb)','public.faolla_attendance_employment_hash_v1(text,jsonb)',
    'public.faolla_attendance_employment_chain_v1(text,uuid,uuid,uuid)',
    'public.faolla_attendance_employment_worker_v1(public.merchant_attendance_workers,public.merchant_enterprise_employees)',
    'public.faolla_attendance_employment_receipt_v1(public.merchant_attendance_employment_operations)',
    'public.faolla_attendance_employment_detail_v1(text,uuid)','public.faolla_attendance_employment_config_v1(text,uuid,uuid,date,boolean)',
    'public.faolla_attendance_account_detail_v1(public.merchant_attendance_account_suspensions)',
    'public.faolla_attendance_employment_lifecycle_v1(jsonb,uuid,jsonb,boolean)'] loop
    f:=to_regprocedure(n);rpc:=n='public.faolla_attendance_employment_lifecycle_v1(jsonb,uuid,jsonb,boolean)';
    if f is null or not exists(select 1 from pg_proc where oid=f and proconfig=array['search_path=pg_catalog'])
      or exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=f and (a.grantee=0 or a.grantee in(select oid from pg_roles where rolname in('anon','authenticated'))
        or (not rpc and a.grantee=(select oid from pg_roles where rolname='service_role')))) then raise exception 'merchant_attendance_employment_lifecycle_installation_conflict';end if;
    if rpc and (not has_function_privilege('service_role',f,'EXECUTE') or not exists(select 1 from pg_proc where oid=f and prosecdef)) then raise exception 'merchant_attendance_employment_lifecycle_installation_conflict';end if;
    if not rpc and n<>'public.faolla_attendance_admin_pre166(text,uuid,jsonb,jsonb,uuid)' and exists(select 1 from pg_proc where oid=f and prosecdef) then raise exception 'merchant_attendance_employment_lifecycle_installation_conflict';end if;
  end loop;
  if not has_function_privilege('service_role','public.faolla_attendance_admin_v1(text,uuid,jsonb,jsonb,uuid)','EXECUTE')
    or not exists(select 1 from pg_proc where oid='public.faolla_attendance_admin_v1(text,uuid,jsonb,jsonb,uuid)'::regprocedure and prosecdef and proconfig=array['search_path=pg_catalog'])
    or exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='public.faolla_attendance_admin_v1(text,uuid,jsonb,jsonb,uuid)'::regprocedure
      and (a.grantee=0 or a.grantee in(select oid from pg_roles where rolname in('anon','authenticated')))) then raise exception 'merchant_attendance_employment_lifecycle_installation_conflict';end if;
end;
$employment_postconditions$;
insert into public.faolla_schema_migrations(version,name) values(202610060166,'merchant_attendance_employment_lifecycle') on conflict(version) do nothing;
commit;
