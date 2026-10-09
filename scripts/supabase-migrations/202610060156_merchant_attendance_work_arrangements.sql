--187 independent work arrangements. No old writer, permission function, report,
-- artifact, clock or leave mutation.157 separately enables the new permission.
begin;
set local lock_timeout='3s';
do $work_arrangement_prerequisites$
declare dependency record;installed boolean;n text;
begin
  if to_regclass('public.faolla_schema_migrations') is null then raise exception 'merchant_attendance_work_arrangements_prerequisite_required';end if;
  for dependency in select * from (values
    (202609290061::bigint,'merchant_attendance_foundation'),(202610030122::bigint,'merchant_attendance_leave_requests'),
    (202610050137::bigint,'merchant_attendance_self_schedule'),(202610050149::bigint,'merchant_attendance_period_closure'),
    (202610050150::bigint,'merchant_attendance_period_seal_guards')) d(version,name) loop
    if not exists(select 1 from public.faolla_schema_migrations m where m.version=dependency.version and m.name=dependency.name) then
      raise exception 'merchant_attendance_work_arrangements_prerequisite_required';end if;
  end loop;
  foreach n in array array['public.faolla_attendance_period_assert_open_v1(text,uuid,jsonb)',
    'public.faolla_attendance_self_schedule_slot_v1(public.merchant_attendance_schedule_slots)',
    'public.faolla_attendance_leave_summary_v1(public.merchant_attendance_leave_requests,integer)',
    'public.faolla_attendance_events_append_only_v1()','public.faolla_attendance_shift_rule_binding_object_v1(jsonb,text[])',
    'public.faolla_attendance_shift_rule_binding_scalar_v1(jsonb,text)'] loop
    if to_regprocedure(n) is null then raise exception 'merchant_attendance_work_arrangements_prerequisite_required';end if;
  end loop;
  if exists(select 1 from public.faolla_schema_migrations where version=202610060156 and name<>'merchant_attendance_work_arrangements') then
    raise exception 'merchant_attendance_work_arrangements_installation_conflict';end if;
  select exists(select 1 from public.faolla_schema_migrations where version=202610060156 and name='merchant_attendance_work_arrangements') into installed;
  foreach n in array array['merchant_attendance_work_arrangement_requests','merchant_attendance_work_arrangement_entries','merchant_attendance_work_arrangement_policies'] loop
    if installed<>(to_regclass('public.'||n) is not null) then raise exception 'merchant_attendance_work_arrangements_installation_conflict';end if;
  end loop;
  foreach n in array array['faolla_attendance_work_arrangement_command_v1','faolla_attendance_work_arrangement_policy_v1',
    'faolla_attendance_work_arrangement_summary_v1','faolla_attendance_work_arrangement_context_v1',
    'faolla_attendance_work_arrangement_conflicts_v1','faolla_attendance_work_arrangement_v1'] loop
    if installed<>exists(select 1 from pg_proc where pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass) and proname=n) then
      raise exception 'merchant_attendance_work_arrangements_installation_conflict';end if;
  end loop;
end;
$work_arrangement_prerequisites$;

create or replace function public.faolla_attendance_work_arrangement_command_v1(p jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare action_name text;k text;a timestamptz;b timestamptz;
begin
  if p is null or jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>4096 then return false;end if;
  action_name:=p->>'action';
  if public.faolla_attendance_shift_rule_binding_scalar_v1(p->'operationId','uuid') is distinct from true
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'reason','reason') is distinct from true then return false;end if;
  if action_name='submit' then
    if public.faolla_attendance_shift_rule_binding_object_v1(p,array['action','operationId','reason','expectedWorkerId','expectedSettingsVersion','expectedPolicyRevision','kind','timeZone','startAt','endAt']) is distinct from true
      or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'expectedWorkerId','uuid') is distinct from true
      or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'expectedSettingsVersion','version') is distinct from true
      or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'expectedPolicyRevision','head') is distinct from true
      or jsonb_typeof(p->'kind') is distinct from 'string' or p->>'kind' not in('trip','field','remote')
      or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'timeZone','zone') is distinct from true then return false;end if;
    foreach k in array array['startAt','endAt'] loop
      if public.faolla_attendance_shift_rule_binding_scalar_v1(p->k,'stamp3') is distinct from true
        or date_trunc('minute',(p->>k)::timestamptz)<>(p->>k)::timestamptz then return false;end if;
    end loop;
    a:=(p->>'startAt')::timestamptz;b:=(p->>'endAt')::timestamptz;
    return b>a and b-a<=interval '366 days';
  elsif action_name='set_policy' then
    return public.faolla_attendance_shift_rule_binding_object_v1(p,array['action','operationId','reason','expectedRevision','retrospectiveDays']) is true
      and public.faolla_attendance_shift_rule_binding_scalar_v1(p->'expectedRevision','head') is true
      and jsonb_typeof(p->'retrospectiveDays')='number' and p->>'retrospectiveDays'~'^(0|[1-9][0-9]{0,2})$'
      and (p->>'retrospectiveDays')::integer between 0 and 365;
  elsif action_name in('withdraw','reject','cancel','approve') then
    if public.faolla_attendance_shift_rule_binding_object_v1(p,case when action_name='approve' then
      array['action','operationId','reason','requestId','expectedRevision','expectedConflictsFingerprint','confirmConflicts']
      else array['action','operationId','reason','requestId','expectedRevision'] end) is distinct from true
      or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'requestId','uuid') is distinct from true
      or p->'expectedRevision' is distinct from to_jsonb(case when action_name='cancel' then 2 else 1 end) then return false;end if;
    if action_name='approve' then
      return jsonb_typeof(p->'expectedConflictsFingerprint')='string' and p->>'expectedConflictsFingerprint'~'^[0-9a-f]{64}$'
        and length(p->>'expectedConflictsFingerprint')=64 and jsonb_typeof(p->'confirmConflicts')='boolean';
    end if;
    return true;
  end if;
  return false;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then return false;
end;
$$;

create table if not exists public.merchant_attendance_work_arrangement_policies(
  merchant_id text not null references public.merchants(id),operation_id uuid not null,revision bigint not null,
  previous_revision bigint,retrospective_days integer not null,actor_auth_user_id uuid not null,command jsonb not null,recorded_at timestamptz not null,
  primary key(merchant_id,revision),unique(merchant_id,operation_id),
  foreign key(merchant_id,previous_revision) references public.merchant_attendance_work_arrangement_policies(merchant_id,revision),
  check(revision between 1 and 9007199254740990 and (revision=1 and previous_revision is null or revision>1 and previous_revision=revision-1)),
  check(retrospective_days between 0 and 365 and isfinite(recorded_at)),
  check(public.faolla_attendance_work_arrangement_command_v1(command) is true and command->>'action'='set_policy'
    and command->>'operationId'=operation_id::text and (command->>'expectedRevision')::bigint=revision-1
    and (command->>'retrospectiveDays')::integer=retrospective_days)
);
create table if not exists public.merchant_attendance_work_arrangement_requests(
  merchant_id text not null,request_id uuid not null,worker_id uuid not null,employee_id uuid not null,actor_auth_user_id uuid not null,
  worker_name text not null,kind text not null,time_zone text not null,start_at timestamptz not null,end_at timestamptz not null,
  reason text not null,settings_version bigint not null,policy_revision bigint not null,retrospective_days integer not null,submitted_at timestamptz not null,
  primary key(merchant_id,request_id),
  foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id),
  foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id),
  check(public.faolla_attendance_group_text_v1(worker_name,1,120) is true and public.faolla_attendance_group_text_v1(reason,1,200) is true),
  check(kind in('trip','field','remote') and public.faolla_attendance_valid_zone_v1(time_zone)),
  check(isfinite(start_at) and isfinite(end_at) and isfinite(submitted_at) and end_at>start_at and end_at-start_at<=interval '366 days'
    and date_trunc('minute',start_at)=start_at and date_trunc('minute',end_at)=end_at),
  check((start_at at time zone time_zone)::date between date '2000-01-01' and date '2100-12-31'
    and (end_at at time zone time_zone)::date between date '2000-01-01' and date '2100-12-31'),
  check(settings_version between 1 and 9007199254740990 and policy_revision between 0 and 9007199254740990
    and retrospective_days between 0 and 365 and (policy_revision<>0 or retrospective_days=30))
);
create index if not exists attendance_work_arrangement_self_idx on public.merchant_attendance_work_arrangement_requests
  (merchant_id,worker_id,employee_id,actor_auth_user_id,submitted_at desc,request_id desc);
create index if not exists attendance_work_arrangement_owner_idx on public.merchant_attendance_work_arrangement_requests(merchant_id,submitted_at desc,request_id desc);
create index if not exists attendance_work_arrangement_overlap_idx on public.merchant_attendance_work_arrangement_requests(merchant_id,worker_id,start_at,end_at);
create table if not exists public.merchant_attendance_work_arrangement_entries(
  merchant_id text not null,operation_id uuid not null,request_id uuid not null,revision smallint not null,
  action text not null,actor_auth_user_id uuid not null,command jsonb not null,snapshot jsonb not null,recorded_at timestamptz not null,
  primary key(merchant_id,operation_id),unique(merchant_id,request_id,revision),
  foreign key(merchant_id,request_id) references public.merchant_attendance_work_arrangement_requests(merchant_id,request_id),
  check(revision=1 and action='submit' and operation_id=request_id or revision=2 and action in('withdraw','approve','reject') or revision=3 and action='cancel'),
  check(public.faolla_attendance_work_arrangement_command_v1(command) is true
    and command->>'action'=action and command->>'operationId'=operation_id::text
    and (revision=1 or command->>'requestId'=request_id::text and (command->>'expectedRevision')::integer=revision-1)),
  check(jsonb_typeof(snapshot)='object' and isfinite(recorded_at))
);
do $work_arrangement_storage$
declare t text;
begin
  if not exists(select 1 from pg_constraint where conrelid='public.merchant_attendance_work_arrangement_requests'::regclass and conname='attendance_work_arrangement_submit_fk') then
    alter table public.merchant_attendance_work_arrangement_requests add constraint attendance_work_arrangement_submit_fk
      foreign key(merchant_id,request_id) references public.merchant_attendance_work_arrangement_entries(merchant_id,operation_id) deferrable initially deferred;
  end if;
  foreach t in array array['merchant_attendance_work_arrangement_requests','merchant_attendance_work_arrangement_entries','merchant_attendance_work_arrangement_policies'] loop
    if not exists(select 1 from pg_trigger where tgrelid=('public.'||t)::regclass and tgname=t||'_immutable') then
      execute format('create trigger %I before update or delete on public.%I for each row execute function public.faolla_attendance_events_append_only_v1()',t||'_immutable',t);
    end if;
    if not exists(select 1 from pg_trigger where tgrelid=('public.'||t)::regclass and tgname=t||'_no_truncate') then
      execute format('create trigger %I before truncate on public.%I for each statement execute function public.faolla_attendance_events_append_only_v1()',t||'_no_truncate',t);
    end if;
  end loop;
end;
$work_arrangement_storage$;
alter table public.merchant_attendance_work_arrangement_requests enable row level security;
alter table public.merchant_attendance_work_arrangement_entries enable row level security;
alter table public.merchant_attendance_work_arrangement_policies enable row level security;
revoke all on public.merchant_attendance_work_arrangement_requests,public.merchant_attendance_work_arrangement_entries,public.merchant_attendance_work_arrangement_policies from public,anon,authenticated,service_role;

create or replace function public.faolla_attendance_work_arrangement_policy_v1(p public.merchant_attendance_work_arrangement_policies)
returns jsonb language plpgsql set search_path=pg_catalog as $$
begin
  if p.operation_id is null then return jsonb_build_object('operationId',null,'revision',0,'retrospectiveDays',30,'actorId',null,'recordedAt',null);end if;
  if public.faolla_attendance_work_arrangement_command_v1(p.command) is distinct from true or p.command->>'action'<>'set_policy'
    or p.command->>'operationId' is distinct from p.operation_id::text or (p.command->>'expectedRevision')::bigint is distinct from p.revision-1
    or (p.command->>'retrospectiveDays')::integer is distinct from p.retrospective_days then raise exception 'attendance_work_arrangement_invalid';end if;
  return jsonb_build_object('operationId',p.operation_id,'revision',p.revision,'retrospectiveDays',p.retrospective_days,'actorId',p.actor_auth_user_id,
    'recordedAt',to_char(p.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end;
$$;

create or replace function public.faolla_attendance_work_arrangement_summary_v1(p public.merchant_attendance_work_arrangement_requests,p_revision integer default null)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare entry public.merchant_attendance_work_arrangement_entries%rowtype;policy_row public.merchant_attendance_work_arrangement_policies%rowtype;
  n integer:=0;prior_action text;prior_at timestamptz;item jsonb;result jsonb;status_name text;
begin
  if p.request_id is null then raise exception 'attendance_work_arrangement_invalid';end if;
  if p.policy_revision>0 then
    select * into policy_row from public.merchant_attendance_work_arrangement_policies where merchant_id=p.merchant_id and revision=p.policy_revision;
    if policy_row.operation_id is null or policy_row.retrospective_days<>p.retrospective_days then raise exception 'attendance_work_arrangement_invalid';end if;
    perform public.faolla_attendance_work_arrangement_policy_v1(policy_row);
  elsif p.retrospective_days<>30 then raise exception 'attendance_work_arrangement_invalid';end if;
  for entry in select * from public.merchant_attendance_work_arrangement_entries where merchant_id=p.merchant_id and request_id=p.request_id order by revision limit 4 loop
    n:=n+1;
    if n>3 or entry.revision<>n or entry.recorded_at<p.submitted_at or entry.recorded_at<prior_at
      or public.faolla_attendance_work_arrangement_command_v1(entry.command) is distinct from true
      or entry.command->>'operationId' is distinct from entry.operation_id::text or entry.command->>'action' is distinct from entry.action then raise exception 'attendance_work_arrangement_invalid';end if;
    if n=1 then
      if entry.action<>'submit' or entry.operation_id<>p.request_id or entry.actor_auth_user_id<>p.actor_auth_user_id or entry.recorded_at<>p.submitted_at
        or entry.command->>'expectedWorkerId' is distinct from p.worker_id::text or entry.command->>'timeZone' is distinct from p.time_zone
        or entry.command->>'reason' is distinct from p.reason or entry.command->>'kind' is distinct from p.kind
        or (entry.command->>'expectedSettingsVersion')::bigint is distinct from p.settings_version
        or (entry.command->>'expectedPolicyRevision')::bigint is distinct from p.policy_revision
        or entry.command->>'startAt' is distinct from to_char(p.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        or entry.command->>'endAt' is distinct from to_char(p.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') then raise exception 'attendance_work_arrangement_invalid';end if;
    else
      if entry.command->>'requestId' is distinct from p.request_id::text or entry.command->'expectedRevision' is distinct from to_jsonb(n-1)
        or n=2 and entry.action not in('withdraw','approve','reject') or n=3 and (entry.action<>'cancel' or prior_action<>'approve')
        or entry.action='withdraw' and entry.actor_auth_user_id<>p.actor_auth_user_id
        or entry.action='approve' and entry.actor_auth_user_id=p.actor_auth_user_id then raise exception 'attendance_work_arrangement_invalid';end if;
    end if;
    status_name:=case entry.action when 'submit' then 'submitted' when 'withdraw' then 'withdrawn' when 'approve' then 'approved' when 'reject' then 'rejected' when 'cancel' then 'cancelled' end;
    item:=jsonb_build_object('requestId',p.request_id,'workerId',p.worker_id,'employeeId',p.employee_id,'employeeAuthUserId',p.actor_auth_user_id,'workerName',p.worker_name,
      'kind',p.kind,'startAt',to_char(p.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'endAt',to_char(p.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'timeZone',p.time_zone,'submittedAt',to_char(p.submitted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'policyRevision',p.policy_revision,'retrospectiveDays',p.retrospective_days,'revision',n,'status',status_name);
    if entry.snapshot is distinct from item then raise exception 'attendance_work_arrangement_invalid';end if;
    if p_revision is null or p_revision=n then result:=item;end if;
    prior_action:=entry.action;prior_at:=entry.recorded_at;
  end loop;
  if n=0 or result is null or p_revision is not null and p_revision not between 1 and n then raise exception 'attendance_work_arrangement_invalid';end if;
  return result;
end;
$$;

-- Private ABI: caller already authorized and holds settings then worker locks.
-- All relevant statuses are retained; wrong historical identity is not filtered.
create or replace function public.faolla_attendance_work_arrangement_context_v1(p_site text,p_worker uuid,p_employee uuid,p_member_auth uuid,p_from timestamptz,p_to timestamptz)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare req public.merchant_attendance_work_arrangement_requests%rowtype;item jsonb;history jsonb;items jsonb:='[]';
begin
  if p_site is null or p_site!~'^[0-9]{8}$' or p_worker is null or p_employee is null or p_member_auth is null
    or p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_from>=p_to then raise exception 'attendance_work_arrangement_invalid';end if;
  for req in select * from public.merchant_attendance_work_arrangement_requests x where x.merchant_id=p_site and x.worker_id=p_worker
    and x.start_at>=p_from-interval '8784 hours' and x.start_at<p_to and x.end_at>p_from order by x.start_at,x.request_id limit 101 loop
    if jsonb_array_length(items)>=100 then raise exception 'attendance_work_arrangement_too_large';end if;
    if req.employee_id<>p_employee or req.actor_auth_user_id<>p_member_auth then raise exception 'attendance_work_arrangement_binding_changed';end if;
    item:=public.faolla_attendance_work_arrangement_summary_v1(req);
    select jsonb_agg(jsonb_build_object('operationId',e.operation_id,'revision',e.revision,'action',e.action,'actorId',e.actor_auth_user_id,
      'reason',e.command->'reason','recordedAt',to_char(e.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'command',e.command) order by e.revision)
      into history from public.merchant_attendance_work_arrangement_entries e where e.merchant_id=p_site and e.request_id=req.request_id;
    items:=items||jsonb_build_array(item||jsonb_build_object('reason',req.reason,'history',history));
  end loop;
  if octet_length(convert_to(items::text,'UTF8'))>1048576 then raise exception 'attendance_work_arrangement_too_large';end if;
  return items;
end;
$$;

create or replace function public.faolla_attendance_work_arrangement_conflicts_v1(p_site text,p_worker uuid,p_employee uuid,p_member_auth uuid,p_start timestamptz,p_end timestamptz,p_exclude uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare req public.merchant_attendance_work_arrangement_requests%rowtype;leave_row public.merchant_attendance_leave_requests%rowtype;
  slot_row public.merchant_attendance_schedule_slots%rowtype;item jsonb;checked jsonb;items jsonb:='[]';
begin
  for req in select x.* from public.merchant_attendance_work_arrangement_requests x where x.merchant_id=p_site and x.worker_id=p_worker
    and x.request_id is distinct from p_exclude and x.start_at>=p_start-interval '8784 hours' and x.start_at<p_end and x.end_at>p_start
    and not exists(select 1 from public.merchant_attendance_work_arrangement_entries e where e.merchant_id=x.merchant_id and e.request_id=x.request_id and e.action in('withdraw','reject','cancel'))
    order by x.start_at,x.request_id limit 101 loop
    if jsonb_array_length(items)>=100 then raise exception 'attendance_work_arrangement_too_large';end if;
    if req.employee_id<>p_employee or req.actor_auth_user_id<>p_member_auth then raise exception 'attendance_work_arrangement_binding_changed';end if;
    item:=public.faolla_attendance_work_arrangement_summary_v1(req);
    if item->>'status' not in('submitted','approved') then raise exception 'attendance_work_arrangement_invalid';end if;
    items:=items||jsonb_build_array(jsonb_build_object('source','work_arrangement','id',req.request_id,'status',item->'status','revision',item->'revision','kind',req.kind,
      'startAt',item->'startAt','endAt',item->'endAt','timeZone',req.time_zone));
  end loop;
  for leave_row in select x.* from public.merchant_attendance_leave_requests x where x.merchant_id=p_site and x.worker_id=p_worker
    and x.start_at>=p_start-interval '8784 hours' and x.start_at<p_end and x.end_at>p_start
    and not exists(select 1 from public.merchant_attendance_leave_entries e where e.merchant_id=x.merchant_id and e.request_id=x.request_id and e.action in('withdraw','reject','cancel'))
    order by x.start_at,x.request_id limit 101 loop
    if jsonb_array_length(items)>=100 then raise exception 'attendance_work_arrangement_too_large';end if;
    if leave_row.employee_id<>p_employee or leave_row.actor_auth_user_id<>p_member_auth then raise exception 'attendance_work_arrangement_binding_changed';end if;
    item:=public.faolla_attendance_leave_summary_v1(leave_row);
    if item->>'status' not in('submitted','approved') then raise exception 'attendance_work_arrangement_invalid';end if;
    items:=items||jsonb_build_array(jsonb_build_object('source','leave','id',leave_row.request_id,'status',item->'status','revision',item->'revision','kind',null,
      'startAt',item->'startAt','endAt',item->'endAt','timeZone',leave_row.time_zone));
  end loop;
  for slot_row in select x.* from public.merchant_attendance_schedule_slots x where x.merchant_id=p_site and x.worker_id=p_worker
    and x.start_at>=p_start-interval '24 hours' and x.start_at<p_end and x.end_at>p_start
    and not exists(select 1 from public.merchant_attendance_schedule_cancellations c where c.merchant_id=x.merchant_id and c.slot_id=x.id)
    order by x.start_at,x.id limit 101 loop
    if jsonb_array_length(items)>=100 then raise exception 'attendance_work_arrangement_too_large';end if;
    if slot_row.employee_id<>p_employee then raise exception 'attendance_work_arrangement_binding_changed';end if;
    checked:=public.faolla_attendance_self_schedule_slot_v1(slot_row);
    if checked->'slot'->'cancelled' is distinct from 'false'::jsonb
      or checked->'publication'->>'employeeAuthUserId' is not null and checked->'publication'->>'employeeAuthUserId'<>p_member_auth::text then raise exception 'attendance_work_arrangement_binding_changed';end if;
    items:=items||jsonb_build_array(jsonb_build_object('source','schedule','id',slot_row.id,'status','scheduled','revision',slot_row.revision,'kind',null,
      'startAt',to_char(slot_row.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'endAt',to_char(slot_row.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'timeZone',slot_row.time_zone));
  end loop;
  select coalesce(jsonb_agg(value order by value->>'source',value->>'id'),'[]') into items from jsonb_array_elements(items);
  return items;
end;
$$;

create or replace function public.faolla_attendance_work_arrangement_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;access_name text;target_id uuid;op uuid;cursor_at timestamptz;cursor_id uuid;action_name text;k text;target_worker uuid;
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;emp public.merchant_enterprise_employees%rowtype;role_row public.merchant_enterprise_roles%rowtype;
  req public.merchant_attendance_work_arrangement_requests%rowtype;candidate public.merchant_attendance_work_arrangement_requests%rowtype;
  entry public.merchant_attendance_work_arrangement_entries%rowtype;policy_row public.merchant_attendance_work_arrangement_policies%rowtype;saved_policy public.merchant_attendance_work_arrangement_policies%rowtype;
  policy jsonb;preview_input jsonb;preview_result jsonb;item jsonb;detail jsonb;receipt jsonb;items jsonb:='[]';next_cursor jsonb;history jsonb;result jsonb;
  conflicts jsonb:='[]';conflicts_hash text;issues text[]:='{}';sealed boolean:=false;binding_ok boolean:=false;employment_ok boolean:=true;window_ok boolean:=true;
  can_submit boolean:=false;can_withdraw boolean:=false;can_approve boolean:=false;can_reject boolean:=false;can_cancel boolean:=false;recovered boolean:=false;
  now_at timestamptz;first_day date;last_day date;day date;coverage integer;seen integer:=0;a timestamptz;b timestamptz;zone text;kind_name text;expected integer;
  fmt3 constant text:='YYYY-MM-DD"T"HH24:MI:SS.MS"Z"';fmt6 constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_auth_user_id is null or p_allow_write is null or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','access','requestId','operationId','beforeAt','beforeId','preview']) is distinct from true
    or octet_length(p_query::text)>4096 or jsonb_typeof(p_query->'siteId') is distinct from 'string' or p_query->>'siteId'!~'^[0-9]{8}$'
    or length(p_query->>'siteId')<>8 or jsonb_typeof(p_query->'access') is distinct from 'string' or p_query->>'access' not in('owner','self') then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';access_name:=p_query->>'access';
  foreach k in array array['requestId','operationId','beforeId'] loop
    if p_query->k<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->k,'uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  end loop;
  if p_query->'beforeAt'<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'beforeAt','stamp6') is distinct from true then raise exception 'attendance_invalid_request';end if;
  target_id:=(p_query->>'requestId')::uuid;op:=(p_query->>'operationId')::uuid;cursor_id:=(p_query->>'beforeId')::uuid;cursor_at:=(p_query->>'beforeAt')::timestamptz;
  if (cursor_at is null)<>(cursor_id is null) or cursor_at is not null and (target_id is not null or op is not null) then raise exception 'attendance_invalid_request';end if;
  if p_query->'preview'<>'null'::jsonb then
    preview_input:=p_query->'preview';
    if access_name<>'self' or target_id is not null or op is not null or cursor_at is not null or p_command is not null
      or public.faolla_attendance_shift_rule_binding_object_v1(preview_input,array['kind','timeZone','startAt','endAt']) is distinct from true then raise exception 'attendance_invalid_request';end if;
    if public.faolla_attendance_work_arrangement_command_v1(preview_input||jsonb_build_object('action','submit','operationId','00000000-0000-4000-8000-000000000001',
      'reason','preview','expectedWorkerId','00000000-0000-4000-8000-000000000001','expectedSettingsVersion',1,'expectedPolicyRevision',0)) is distinct from true then raise exception 'attendance_invalid_request';end if;
  end if;
  if p_command is not null then
    if op is not null or cursor_at is not null or preview_input is not null or public.faolla_attendance_work_arrangement_command_v1(p_command) is distinct from true then raise exception 'attendance_invalid_request';end if;
    op:=(p_command->>'operationId')::uuid;action_name:=p_command->>'action';
    if (action_name in('submit','withdraw'))<>(access_name='self') then raise exception 'attendance_access_denied';end if;
    if action_name in('submit','set_policy') then
      if target_id is not null then raise exception 'attendance_invalid_request';end if;
      if action_name='submit' then target_id:=op;end if;
    elsif p_command->>'requestId' is distinct from target_id::text then raise exception 'attendance_invalid_request';end if;
  end if;
  perform 1 from public.merchants where id=site and (access_name='self' or user_id=p_auth_user_id) for share;
  if not found then raise exception 'attendance_access_denied';end if;
  if p_command is null then select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  else select * into s from public.merchant_attendance_settings where merchant_id=site for update;end if;
  if s.merchant_id is null then raise exception 'attendance_settings_required';end if;
  if op is not null then
    select * into entry from public.merchant_attendance_work_arrangement_entries where merchant_id=site and operation_id=op;
    select * into saved_policy from public.merchant_attendance_work_arrangement_policies where merchant_id=site and operation_id=op;
    if entry.operation_id is not null and saved_policy.operation_id is not null then raise exception 'attendance_work_arrangement_invalid';end if;
    if entry.operation_id is not null then
      if entry.actor_auth_user_id<>p_auth_user_id or (entry.action in('submit','withdraw'))<>(access_name='self')
        or target_id is not null and target_id<>entry.request_id then raise exception 'attendance_operation_conflict';end if;
      if p_command is not null and entry.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
      target_id:=entry.request_id;recovered:=true;
    elsif saved_policy.operation_id is not null then
      if access_name<>'owner' or saved_policy.actor_auth_user_id<>p_auth_user_id or target_id is not null
        or p_command is not null and saved_policy.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
      recovered:=true;
    end if;
  end if;
  if target_id is not null then select * into req from public.merchant_attendance_work_arrangement_requests where merchant_id=site and request_id=target_id;end if;
  if access_name='self' then
    select x.id into target_worker from public.merchant_attendance_workers x join public.merchant_enterprise_employees e on e.merchant_id=x.merchant_id and e.id=x.employee_id
      where x.merchant_id=site and e.auth_user_id=p_auth_user_id;
  elsif req.request_id is not null then target_worker:=req.worker_id;end if;
  if target_worker is not null then
    select * into w from public.merchant_attendance_workers where merchant_id=site and id=target_worker for update;
    select * into emp from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;
    select * into role_row from public.merchant_enterprise_roles where merchant_id=site and id=emp.role_id for share;
  end if;
  if access_name='self' then
    if emp.id is null then
      select * into emp from public.merchant_enterprise_employees where merchant_id=site and auth_user_id=p_auth_user_id for share;
      select * into role_row from public.merchant_enterprise_roles where merchant_id=site and id=emp.role_id for share;
    end if;
    if emp.id is null or emp.auth_user_id is distinct from p_auth_user_id or emp.status<>'active' or role_row.status is distinct from 'active'
      or public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions) is distinct from true
      or not('enterprise.view'=any(role_row.permissions)) or not('attendance.self.view'=any(role_row.permissions)) then raise exception 'attendance_access_denied';end if;
    if req.request_id is not null and (req.worker_id is distinct from w.id or req.employee_id<>emp.id or req.actor_auth_user_id<>p_auth_user_id) then raise exception 'attendance_work_arrangement_not_found';end if;
  end if;
  if target_id is not null and req.request_id is null and action_name is distinct from 'submit' and not(op is not null and p_query->'requestId'='null'::jsonb) then raise exception 'attendance_work_arrangement_not_found';end if;
  select * into policy_row from public.merchant_attendance_work_arrangement_policies where merchant_id=site order by revision desc limit 1;
  policy:=public.faolla_attendance_work_arrangement_policy_v1(policy_row);
  now_at:=clock_timestamp();
  can_submit:=coalesce(access_name='self' and w.active and 'attendance.self.work_arrangement'=any(role_row.permissions) and p_allow_write and s.enabled,false);
  if recovered then
    -- Recover the exact immutable operation before new policy/time/conflict/seal
    -- gates. No later business state is misrepresented as a checked detail.
    if saved_policy.operation_id is not null then
      receipt:=jsonb_build_object('command',saved_policy.command,'item',null,'policy',public.faolla_attendance_work_arrangement_policy_v1(saved_policy));
    else
      receipt:=jsonb_build_object('command',entry.command,'item',public.faolla_attendance_work_arrangement_summary_v1(req,entry.revision),'policy',null);
    end if;
  else
    if p_command is not null and (not p_allow_write or not s.enabled) then raise exception 'attendance_platform_paused';end if;
    if action_name='set_policy' then
      if (p_command->>'expectedRevision')::bigint<>(policy->>'revision')::bigint then raise exception 'attendance_version_conflict';end if;
      if (policy->>'revision')::bigint>=9007199254740990 or policy_row.recorded_at>now_at then raise exception 'attendance_version_conflict';end if;
      insert into public.merchant_attendance_work_arrangement_policies(merchant_id,operation_id,revision,previous_revision,retrospective_days,actor_auth_user_id,command,recorded_at)
        values(site,op,(policy->>'revision')::bigint+1,nullif((policy->>'revision')::bigint,0),(p_command->>'retrospectiveDays')::integer,p_auth_user_id,p_command,now_at) returning * into policy_row;
      policy:=public.faolla_attendance_work_arrangement_policy_v1(policy_row);receipt:=jsonb_build_object('command',p_command,'item',null,'policy',policy);
    else
      if action_name='submit' then
        if not can_submit then raise exception 'attendance_access_denied';end if;
        if (p_command->>'expectedWorkerId')::uuid is distinct from w.id then raise exception 'attendance_worker_changed';end if;
        if (p_command->>'expectedSettingsVersion')::bigint<>s.version or p_command->>'timeZone'<>s.time_zone
          or (p_command->>'expectedPolicyRevision')::bigint<>(policy->>'revision')::bigint then raise exception 'attendance_version_conflict';end if;
        if req.request_id is not null then raise exception 'attendance_operation_conflict';end if;
        req.merchant_id:=site;req.request_id:=op;req.worker_id:=w.id;req.employee_id:=emp.id;req.actor_auth_user_id:=p_auth_user_id;req.worker_name:=w.display_name;
        req.kind:=p_command->>'kind';req.time_zone:=s.time_zone;req.start_at:=(p_command->>'startAt')::timestamptz;req.end_at:=(p_command->>'endAt')::timestamptz;
        req.reason:=p_command->>'reason';req.settings_version:=s.version;req.policy_revision:=(policy->>'revision')::bigint;req.retrospective_days:=(policy->>'retrospectiveDays')::integer;req.submitted_at:=now_at;
      elsif req.request_id is not null then
        item:=public.faolla_attendance_work_arrangement_summary_v1(req);
        if p_command is not null then
          expected:=(p_command->>'expectedRevision')::integer;
          if item->>'revision'<>expected::text or (action_name='cancel' and item->>'status'<>'approved')
            or action_name<>'cancel' and item->>'status'<>'submitted' then raise exception 'attendance_work_arrangement_closed';end if;
          if action_name='withdraw' and not('attendance.self.work_arrangement'=any(role_row.permissions)) then raise exception 'attendance_access_denied';end if;
          if action_name='approve' and req.actor_auth_user_id=p_auth_user_id then raise exception 'attendance_access_denied';end if;
        end if;
      end if;
      if req.request_id is not null or preview_input is not null then
        if preview_input is not null then
          if w.id is null then raise exception 'attendance_worker_not_found';end if;
          if preview_input->>'timeZone'<>s.time_zone then raise exception 'attendance_version_conflict';end if;
          a:=(preview_input->>'startAt')::timestamptz;b:=(preview_input->>'endAt')::timestamptz;zone:=s.time_zone;kind_name:=preview_input->>'kind';
        else a:=req.start_at;b:=req.end_at;zone:=req.time_zone;kind_name:=req.kind;end if;
        if not public.faolla_attendance_valid_zone_v1(zone) or (a at time zone zone)::date not between date '2000-01-01' and date '2100-12-31'
          or (b at time zone zone)::date not between date '2000-01-01' and date '2100-12-31' then raise exception 'attendance_invalid_request';end if;
        binding_ok:=coalesce(w.active and emp.status='active' and role_row.status='active' and public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions)
          and 'attendance.self.view'=any(role_row.permissions) and (preview_input is not null or w.employee_id=req.employee_id and emp.auth_user_id=req.actor_auth_user_id),false);
        first_day:=(a at time zone zone)::date;last_day:=((b-interval '1 microsecond') at time zone zone)::date;
        for day in select generate_series(first_day::timestamp,last_day::timestamp,interval '1 day')::date loop
          if ((day::timestamp at time zone zone) at time zone zone)::date<>day then continue;end if;
          select count(*) into coverage from public.merchant_attendance_employment_periods where merchant_id=site and worker_id=w.id and starts_on<=day and (ends_on is null or ends_on>=day);
          if coverage<>1 then employment_ok:=false;exit;end if;
        end loop;
        window_ok:=first_day>=(now_at at time zone s.time_zone)::date-(policy->>'retrospectiveDays')::integer;
        sealed:=exists(select 1 from public.merchant_attendance_period_closures c where c.merchant_id=site and c.worker_id=w.id and c.sealed and c.start_at<b and c.end_at>a);
        -- A replaced identity may be reviewed/rejected/cancelled by the owner, never used
        -- to reveal the replacement member's conflicts or approve the old request.
        -- Closing actions do not inspect new conflicts: unrelated later volume
        -- must not strand an authorized withdrawal/rejection/cancellation.
        if binding_ok and (action_name is null or action_name in('submit','approve')) then
          conflicts:=public.faolla_attendance_work_arrangement_conflicts_v1(site,w.id,emp.id,emp.auth_user_id,a,b,req.request_id);
        end if;
        conflicts_hash:=encode(sha256(convert_to(conflicts::text,'UTF8')),'hex');
        if not binding_ok then issues:=array_append(issues,'binding_changed');end if;
        if not employment_ok then issues:=array_append(issues,'employment_gap');end if;
        if (preview_input is not null or action_name='submit') and not window_ok then issues:=array_append(issues,'outside_window');end if;
        if jsonb_array_length(conflicts)>0 then issues:=array_append(issues,'conflicts');end if;
        if sealed then issues:=array_append(issues,'sealed');end if;
        if preview_input is not null then
          preview_result:=jsonb_build_object('kind',kind_name,'timeZone',zone,'startAt',preview_input->'startAt','endAt',preview_input->'endAt','conflicts',conflicts,
            'conflictsFingerprint',conflicts_hash,'sealed',sealed,'issues',to_jsonb(issues),'canSubmit',can_submit and binding_ok and employment_ok and window_ok and not sealed);
        else
          if p_command is not null then
            if action_name in('submit','approve','cancel') then
              perform public.faolla_attendance_period_assert_open_v1(site,w.id,jsonb_build_array(jsonb_build_object('startAt',to_char(a at time zone 'UTC',fmt6),'endAt',to_char(b at time zone 'UTC',fmt6))));
            end if;
            if action_name='submit' and not window_ok then raise exception 'attendance_work_arrangement_outside_window';end if;
            if action_name in('submit','approve') and not employment_ok then raise exception 'attendance_work_arrangement_outside_employment';end if;
            if action_name='approve' then
              if not binding_ok then raise exception 'attendance_work_arrangement_binding_changed';end if;
              if p_command->>'expectedConflictsFingerprint' is distinct from conflicts_hash then raise exception 'attendance_work_arrangement_conflicts_changed';end if;
              if jsonb_array_length(conflicts)>0 and p_command->'confirmConflicts'<>'true'::jsonb then raise exception 'attendance_work_arrangement_conflict_confirmation_required';end if;
            end if;
            if action_name='submit' then insert into public.merchant_attendance_work_arrangement_requests select (req).*;expected:=0;
            else expected:=(p_command->>'expectedRevision')::integer;end if;
            if now_at<req.submitted_at or exists(select 1 from public.merchant_attendance_work_arrangement_entries e where e.merchant_id=site and e.request_id=req.request_id and e.recorded_at>now_at) then raise exception 'attendance_version_conflict';end if;
            item:=jsonb_build_object('requestId',req.request_id,'workerId',req.worker_id,'employeeId',req.employee_id,'employeeAuthUserId',req.actor_auth_user_id,'workerName',req.worker_name,'kind',req.kind,
              'startAt',to_char(a at time zone 'UTC',fmt3),'endAt',to_char(b at time zone 'UTC',fmt3),'timeZone',req.time_zone,'submittedAt',to_char(req.submitted_at at time zone 'UTC',fmt6),
              'policyRevision',req.policy_revision,'retrospectiveDays',req.retrospective_days,'revision',expected+1,
              'status',case action_name when 'submit' then 'submitted' when 'withdraw' then 'withdrawn' when 'approve' then 'approved' when 'reject' then 'rejected' when 'cancel' then 'cancelled' end);
            insert into public.merchant_attendance_work_arrangement_entries(merchant_id,operation_id,request_id,revision,action,actor_auth_user_id,command,snapshot,recorded_at)
              values(site,op,req.request_id,expected+1,action_name,p_auth_user_id,p_command,item,now_at) returning * into entry;
            receipt:=jsonb_build_object('command',entry.command,'item',item,'policy',null);
          end if;
          item:=public.faolla_attendance_work_arrangement_summary_v1(req);
          select jsonb_agg(jsonb_build_object('operationId',e.operation_id,'revision',e.revision,'action',e.action,'actorId',e.actor_auth_user_id,'reason',e.command->'reason',
            'recordedAt',to_char(e.recorded_at at time zone 'UTC',fmt6),'command',e.command) order by e.revision) into history
            from public.merchant_attendance_work_arrangement_entries e where e.merchant_id=site and e.request_id=req.request_id;
          can_withdraw:=coalesce(access_name='self' and 'attendance.self.work_arrangement'=any(role_row.permissions) and item->>'status'='submitted' and p_allow_write and s.enabled,false);
          can_reject:=access_name='owner' and item->>'status'='submitted' and p_allow_write and s.enabled;
          can_approve:=can_reject and req.actor_auth_user_id<>p_auth_user_id and binding_ok and employment_ok and not sealed;
          can_cancel:=access_name='owner' and item->>'status'='approved' and p_allow_write and s.enabled and not sealed;
          detail:=item||jsonb_build_object('reason',req.reason,'history',history,'conflicts',conflicts,'conflictsFingerprint',conflicts_hash,'sealed',sealed,'issues',to_jsonb(issues),
            'canWithdraw',can_withdraw,'canApprove',can_approve,'canReject',can_reject,'canCancel',can_cancel);
          if action_name in('withdraw','reject','cancel') then detail:=null;end if;
        end if;
      end if;
    end if;
    if p_command is null and preview_input is null and target_id is null and op is null then
      for candidate in select * from public.merchant_attendance_work_arrangement_requests x where x.merchant_id=site
        and (access_name='owner' or x.worker_id=w.id and x.employee_id=emp.id and x.actor_auth_user_id=p_auth_user_id)
        and (cursor_at is null or (x.submitted_at,x.request_id)<(cursor_at,cursor_id)) order by x.submitted_at desc,x.request_id desc limit 26 loop
        seen:=seen+1;exit when seen=26;
        items:=items||jsonb_build_array(public.faolla_attendance_work_arrangement_summary_v1(candidate));
        next_cursor:=jsonb_build_object('at',to_char(candidate.submitted_at at time zone 'UTC',fmt6),'id',candidate.request_id);
      end loop;
    end if;
  end if;
  result:=jsonb_build_object('protocol','work-arrangement-v1','siteId',site,'access',access_name,'actorId',p_auth_user_id,
    'employeeId',case when access_name='self' then emp.id else null end,'workerId',case when access_name='self' then w.id else null end,
    'timeZone',s.time_zone,'settingsVersion',s.version,'canSubmit',can_submit,'policy',policy,'items',items,
    'nextCursor',case when seen=26 then next_cursor else null end,'detail',detail,'receipt',receipt,'preview',preview_result,'readAt',to_char(clock_timestamp() at time zone 'UTC',fmt6));
  if octet_length(convert_to(result::text,'UTF8'))>131072 then raise exception 'attendance_work_arrangement_too_large';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then raise exception 'attendance_invalid_request';
end;
$$;

revoke all on function public.faolla_attendance_work_arrangement_command_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_work_arrangement_policy_v1(public.merchant_attendance_work_arrangement_policies) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_work_arrangement_summary_v1(public.merchant_attendance_work_arrangement_requests,integer) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_work_arrangement_context_v1(text,uuid,uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_work_arrangement_conflicts_v1(text,uuid,uuid,uuid,timestamptz,timestamptz,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_work_arrangement_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_work_arrangement_v1(jsonb,uuid,jsonb,boolean) to service_role;
do $work_arrangement_postconditions$
declare t regclass;n text;p regprocedure;role_name text;spec record;
begin
  foreach t in array array['public.merchant_attendance_work_arrangement_requests'::regclass,'public.merchant_attendance_work_arrangement_entries'::regclass,
    'public.merchant_attendance_work_arrangement_policies'::regclass] loop
    if not(select relrowsecurity from pg_class where oid=t) or exists(select 1 from pg_policy where polrelid=t)
      or not exists(select 1 from pg_trigger g join pg_class c on c.oid=g.tgrelid where g.tgrelid=t and g.tgname=c.relname||'_immutable' and not g.tgisinternal
        and g.tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure and g.tgenabled='O' and g.tgnargs=0 and g.tgqual is null and g.tgtype=27)
      or not exists(select 1 from pg_trigger g join pg_class c on c.oid=g.tgrelid where g.tgrelid=t and g.tgname=c.relname||'_no_truncate' and not g.tgisinternal
        and g.tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure and g.tgenabled='O' and g.tgnargs=0 and g.tgqual is null and g.tgtype=34) then
      raise exception 'merchant_attendance_work_arrangements_storage_postcondition_failed';end if;
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if exists(select 1 from pg_class c where c.oid=t and (pg_has_role(role_name,c.relowner,'USAGE') or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
        where case when a.grantee=0 then true else pg_has_role(role_name,a.grantee,'USAGE') end))) then raise exception 'merchant_attendance_work_arrangements_acl_postcondition_failed';end if;
    end loop;
  end loop;
  if not exists(select 1 from pg_constraint where conrelid='public.merchant_attendance_work_arrangement_requests'::regclass
    and conname='attendance_work_arrangement_submit_fk' and contype='f' and convalidated and condeferrable and condeferred
    and confrelid='public.merchant_attendance_work_arrangement_entries'::regclass
    and conkey=array[(select attnum from pg_attribute where attrelid=conrelid and attname='merchant_id'),(select attnum from pg_attribute where attrelid=conrelid and attname='request_id')]::smallint[]
    and confkey=array[(select attnum from pg_attribute where attrelid=confrelid and attname='merchant_id'),(select attnum from pg_attribute where attrelid=confrelid and attname='operation_id')]::smallint[]) then
    raise exception 'merchant_attendance_work_arrangements_storage_postcondition_failed';end if;
  for spec in select * from (values
    ('attendance_work_arrangement_self_idx',array['merchant_id','worker_id','employee_id','actor_auth_user_id','submitted_at','request_id'],array[0,0,0,0,3,3]),
    ('attendance_work_arrangement_owner_idx',array['merchant_id','submitted_at','request_id'],array[0,3,3]),
    ('attendance_work_arrangement_overlap_idx',array['merchant_id','worker_id','start_at','end_at'],array[0,0,0,0])) x(index_name,keys,options) loop
    if not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam
      where c.oid=to_regclass('public.'||spec.index_name) and c.relkind='i' and am.amname='btree'
        and i.indrelid='public.merchant_attendance_work_arrangement_requests'::regclass and i.indisvalid and i.indisready and i.indislive
        and not i.indisunique and not i.indisexclusion and i.indpred is null and i.indexprs is null
        and i.indnkeyatts=cardinality(spec.keys) and i.indnatts=i.indnkeyatts
        and not exists(select 1 from generate_subscripts(spec.keys,1) z where
          (select attname from pg_attribute where attrelid=i.indrelid and attnum=i.indkey[z-1]) is distinct from spec.keys[z]
          or i.indoption[z-1]<>spec.options[z]
          or i.indcollation[z-1] is distinct from (select attcollation from pg_attribute where attrelid=i.indrelid and attnum=i.indkey[z-1])
          or not exists(select 1 from pg_opclass opc join pg_attribute a on a.attrelid=i.indrelid and a.attnum=i.indkey[z-1]
            where opc.oid=i.indclass[z-1] and opc.opcnamespace='pg_catalog'::regnamespace and opc.opcdefault and opc.opcmethod=c.relam and opc.opcintype=a.atttypid))) then
      raise exception 'merchant_attendance_work_arrangements_storage_postcondition_failed';end if;
  end loop;
  foreach n in array array['public.faolla_attendance_work_arrangement_command_v1(jsonb)',
    'public.faolla_attendance_work_arrangement_policy_v1(public.merchant_attendance_work_arrangement_policies)',
    'public.faolla_attendance_work_arrangement_summary_v1(public.merchant_attendance_work_arrangement_requests,integer)',
    'public.faolla_attendance_work_arrangement_context_v1(text,uuid,uuid,uuid,timestamptz,timestamptz)',
    'public.faolla_attendance_work_arrangement_conflicts_v1(text,uuid,uuid,uuid,timestamptz,timestamptz,uuid)'] loop
    p:=to_regprocedure(n);
    if p is null or not exists(select 1 from pg_proc where oid=p and not prosecdef and proconfig=array['search_path=pg_catalog']) then raise exception 'merchant_attendance_work_arrangements_acl_postcondition_failed';end if;
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(role_name,p,'EXECUTE') then raise exception 'merchant_attendance_work_arrangements_acl_postcondition_failed';end if;
    end loop;
  end loop;
  p:='public.faolla_attendance_work_arrangement_v1(jsonb,uuid,jsonb,boolean)'::regprocedure;
  if not exists(select 1 from pg_proc where oid=p and prosecdef and proconfig=array['search_path=pg_catalog'])
    or not has_function_privilege('service_role',p,'EXECUTE') or has_function_privilege('anon',p,'EXECUTE') or has_function_privilege('authenticated',p,'EXECUTE') then
    raise exception 'merchant_attendance_work_arrangements_acl_postcondition_failed';end if;
end;
$work_arrangement_postconditions$;
insert into public.faolla_schema_migrations(version,name) values(202610060156,'merchant_attendance_work_arrangements') on conflict(version) do nothing;
commit;
