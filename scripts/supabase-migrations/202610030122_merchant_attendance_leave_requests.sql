-- Independent default-off leave interval ledger. No punches, schedules, reports,
-- payroll, balances or existing request writers are read or changed here.
begin;
set local lock_timeout='3s';
do $leave_prerequisites$
declare installed boolean;
begin
  if to_regclass('public.faolla_schema_migrations') is null
    or to_regprocedure('public.faolla_attendance_events_append_only_v1()') is null
    or to_regprocedure('public.faolla_valid_merchant_enterprise_permissions_v1(text[])') is null then
    raise exception 'merchant_attendance_leave_prerequisite_required';
  end if;
  if not exists(select 1 from public.faolla_schema_migrations where version=202609290061 and name='merchant_attendance_foundation')
    or not exists(select 1 from public.faolla_schema_migrations where version=202610030121 and name='merchant_attendance_leave_permission')
    or not public.faolla_valid_merchant_enterprise_permissions_v1(array['enterprise.view','attendance.self.view','attendance.self.leave']) then
    raise exception 'merchant_attendance_leave_prerequisite_required';
  end if;
  select exists(select 1 from public.faolla_schema_migrations where version=202610030122 and name='merchant_attendance_leave_requests') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610030122 and name<>'merchant_attendance_leave_requests')
    or not installed and (to_regclass('public.merchant_attendance_leave_requests') is not null or to_regclass('public.merchant_attendance_leave_entries') is not null
      or to_regprocedure('public.faolla_attendance_leave_v1(jsonb,uuid,jsonb,boolean)') is not null)
    or installed and (to_regclass('public.merchant_attendance_leave_requests') is null or to_regclass('public.merchant_attendance_leave_entries') is null
      or to_regprocedure('public.faolla_attendance_leave_v1(jsonb,uuid,jsonb,boolean)') is null) then
    raise exception 'merchant_attendance_leave_installation_conflict';
  end if;
end;
$leave_prerequisites$;

create table if not exists public.merchant_attendance_leave_requests (
  merchant_id text not null,request_id uuid not null,worker_id uuid not null,employee_id uuid not null,actor_auth_user_id uuid not null,
  worker_name text not null check(char_length(btrim(worker_name)) between 1 and 120),
  time_zone text not null check(public.faolla_attendance_valid_zone_v1(time_zone)),
  start_at timestamptz not null,end_at timestamptz not null,submitted_at timestamptz not null,
  reason text not null check(char_length(reason) between 1 and 200
    and reason=btrim(reason,U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff')
    and reason !~ '[[:cntrl:]\u007f-\u009f]'),
  primary key(merchant_id,request_id),
  foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id),
  foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id),
  check(isfinite(start_at) and isfinite(end_at) and isfinite(submitted_at)),
  check(date_trunc('minute',start_at)=start_at and date_trunc('minute',end_at)=end_at and end_at>start_at and end_at-start_at<=interval '366 days'),
  check((start_at at time zone time_zone)::date between date '2000-01-01' and date '2100-12-31'
    and (end_at at time zone time_zone)::date between date '2000-01-01' and date '2100-12-31')
);
create index if not exists attendance_leave_self_list_idx on public.merchant_attendance_leave_requests(merchant_id,worker_id,employee_id,actor_auth_user_id,submitted_at desc,request_id desc);
create index if not exists attendance_leave_owner_list_idx on public.merchant_attendance_leave_requests(merchant_id,submitted_at desc,request_id desc);
create index if not exists attendance_leave_overlap_idx on public.merchant_attendance_leave_requests(merchant_id,worker_id,start_at,end_at);
create table if not exists public.merchant_attendance_leave_entries (
  merchant_id text not null,operation_id uuid not null,request_id uuid not null,revision smallint not null,
  action text not null,actor_auth_user_id uuid not null,command jsonb not null,snapshot jsonb not null,recorded_at timestamptz not null,
  primary key(merchant_id,operation_id),unique(merchant_id,request_id,revision),
  foreign key(merchant_id,request_id) references public.merchant_attendance_leave_requests(merchant_id,request_id),
  check((revision=1 and action='submit' and operation_id=request_id)
    or (revision=2 and action in ('withdraw','approve','reject')) or (revision=3 and action='cancel')),
  check(jsonb_typeof(command)='object' and jsonb_typeof(snapshot)='object' and isfinite(recorded_at))
);
do $leave_constraints$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.merchant_attendance_leave_requests'::regclass and conname='attendance_leave_submit_receipt_fk') then
    alter table public.merchant_attendance_leave_requests add constraint attendance_leave_submit_receipt_fk
      foreign key(merchant_id,request_id) references public.merchant_attendance_leave_entries(merchant_id,operation_id) deferrable initially deferred;
  end if;
end;
$leave_constraints$;
alter table public.merchant_attendance_leave_requests enable row level security;
alter table public.merchant_attendance_leave_entries enable row level security;
revoke all on public.merchant_attendance_leave_requests,public.merchant_attendance_leave_entries from public,anon,authenticated,service_role;
do $leave_triggers$
declare t text;
begin
  foreach t in array array['merchant_attendance_leave_requests','merchant_attendance_leave_entries'] loop
    if not exists(select 1 from pg_trigger where tgrelid=('public.'||t)::regclass and tgname=t||'_immutable') then
      execute format('create trigger %I before update or delete on public.%I for each row execute function public.faolla_attendance_events_append_only_v1()',t||'_immutable',t);
    end if;
    if not exists(select 1 from pg_trigger where tgrelid=('public.'||t)::regclass and tgname=t||'_no_truncate') then
      execute format('create trigger %I before truncate on public.%I for each statement execute function public.faolla_attendance_events_append_only_v1()',t||'_no_truncate',t);
    end if;
  end loop;
end;
$leave_triggers$;

-- Private projection also validates the complete immutable transition chain.
-- Historical receipts retain their own revision; they never become a later state.
create or replace function public.faolla_attendance_leave_summary_v1(p public.merchant_attendance_leave_requests,p_revision integer default null)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare entry public.merchant_attendance_leave_entries%rowtype;n integer:=0;state text;prior_action text;prior_at timestamptz;item jsonb;result jsonb;
begin
  for entry in select * from public.merchant_attendance_leave_entries where merchant_id=p.merchant_id and request_id=p.request_id order by revision loop
    n:=n+1;
    if n>3 or entry.revision<>n or entry.recorded_at<p.submitted_at or entry.recorded_at<prior_at
      or entry.command->>'operationId' is distinct from entry.operation_id::text or entry.command->>'action' is distinct from entry.action
      or jsonb_typeof(entry.command->'reason') is distinct from 'string' or char_length(entry.command->>'reason') not between 1 and 200
      or entry.command->>'reason'<>btrim(entry.command->>'reason',U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff')
      or entry.command->>'reason' ~ '[[:cntrl:]\u007f-\u009f]' then raise exception 'attendance_leave_invalid';end if;
    if n=1 then
      if entry.action<>'submit' or entry.operation_id<>p.request_id or entry.actor_auth_user_id<>p.actor_auth_user_id or entry.recorded_at<>p.submitted_at
        or (select count(*) from jsonb_object_keys(entry.command))<>8
        or not(entry.command ?& array['operationId','action','reason','expectedWorkerId','expectedSettingsVersion','timeZone','startAt','endAt'])
        or jsonb_typeof(entry.command->'expectedSettingsVersion') is distinct from 'number'
        or coalesce(entry.command->>'expectedSettingsVersion','') !~ '^[1-9][0-9]{0,15}$'
        or (entry.command->>'expectedSettingsVersion')::numeric>9007199254740990
        or entry.command->>'expectedWorkerId' is distinct from p.worker_id::text or entry.command->>'timeZone' is distinct from p.time_zone
        or entry.command->>'reason' is distinct from p.reason
        or entry.command->>'startAt' is distinct from to_char(p.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        or entry.command->>'endAt' is distinct from to_char(p.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') then raise exception 'attendance_leave_invalid';end if;
    else
      if (select count(*) from jsonb_object_keys(entry.command))<>5 or not(entry.command ?& array['operationId','action','reason','requestId','expectedRevision'])
        or entry.command->>'requestId' is distinct from p.request_id::text or entry.command->'expectedRevision' is distinct from to_jsonb(n-1)
        or n=2 and entry.action not in ('withdraw','approve','reject') or n=3 and (entry.action<>'cancel' or prior_action<>'approve')
        or (entry.action='withdraw') is distinct from (entry.actor_auth_user_id=p.actor_auth_user_id) then raise exception 'attendance_leave_invalid';end if;
    end if;
    state:=case entry.action when 'submit' then 'submitted' when 'withdraw' then 'withdrawn' when 'approve' then 'approved' when 'reject' then 'rejected' when 'cancel' then 'cancelled' end;
    item:=jsonb_build_object('requestId',p.request_id,'workerName',p.worker_name,
      'startAt',to_char(p.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'endAt',to_char(p.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'timeZone',p.time_zone,'submittedAt',to_char(p.submitted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'revision',n,'status',state);
    if entry.snapshot is distinct from item then raise exception 'attendance_leave_invalid';end if;
    if p_revision is null or p_revision=n then result:=item;end if;
    prior_action:=entry.action;prior_at:=entry.recorded_at;
  end loop;
  if n=0 or result is null or p_revision is not null and p_revision not between 1 and n then raise exception 'attendance_leave_invalid';end if;
  return result;
end;
$$;
revoke all on function public.faolla_attendance_leave_summary_v1(public.merchant_attendance_leave_requests,integer) from public,anon,authenticated,service_role;

create or replace function public.faolla_attendance_leave_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
<<leave_call>>
declare site text;mode text;target_id uuid;op uuid;cursor_at timestamptz;cursor_id uuid;k text;action_name text;expected integer;now_at timestamptz;
  s public.merchant_attendance_settings%rowtype;e public.merchant_enterprise_employees%rowtype;r public.merchant_enterprise_roles%rowtype;w public.merchant_attendance_workers%rowtype;
  target public.merchant_attendance_leave_requests%rowtype;candidate public.merchant_attendance_leave_requests%rowtype;receipt_row public.merchant_attendance_leave_entries%rowtype;
  review_e public.merchant_enterprise_employees%rowtype;review_r public.merchant_enterprise_roles%rowtype;review_w public.merchant_attendance_workers%rowtype;
  can_submit boolean:=false;can_withdraw boolean:=false;can_approve boolean:=false;can_reject boolean:=false;can_cancel boolean:=false;
  binding_ok boolean:=false;employment_ok boolean:=false;overlap_found boolean:=false;first_day date;last_day date;day date;coverage integer;
  a timestamptz;b timestamptz;item jsonb;detail jsonb;history jsonb;items jsonb:='[]';receipt jsonb;next_cursor jsonb;row_count integer:=0;result jsonb;
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_auth_user_id is null or p_allow_write is null or p_query is null or jsonb_typeof(p_query)<>'object' then raise exception 'attendance_invalid_request';end if;
  if (select count(*) from jsonb_object_keys(p_query))<>6 or not(p_query ?& array['siteId','access','requestId','operationId','beforeAt','beforeId'])
    or jsonb_typeof(p_query->'siteId')<>'string' or coalesce(p_query->>'siteId','') !~ '^\d{8}$'
    or jsonb_typeof(p_query->'access')<>'string' or coalesce(p_query->>'access','') not in ('self','owner') then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';mode:=p_query->>'access';
  foreach k in array array['requestId','operationId','beforeId'] loop
    if p_query->k<>'null'::jsonb and (jsonb_typeof(p_query->k)<>'string' or coalesce(p_query->>k,'') !~ uuid_pattern) then raise exception 'attendance_invalid_request';end if;
  end loop;
  target_id:=(p_query->>'requestId')::uuid;op:=(p_query->>'operationId')::uuid;cursor_id:=(p_query->>'beforeId')::uuid;
  if p_query->'beforeAt'<>'null'::jsonb then
    if jsonb_typeof(p_query->'beforeAt')<>'string' or coalesce(p_query->>'beforeAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$' then raise exception 'attendance_invalid_request';end if;
    cursor_at:=(p_query->>'beforeAt')::timestamptz;
    if not isfinite(cursor_at) or to_char(cursor_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')<>p_query->>'beforeAt' then raise exception 'attendance_invalid_request';end if;
  end if;
  if (cursor_at is null)<>(cursor_id is null) or cursor_at is not null and (target_id is not null or op is not null) then raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
    if op is not null or cursor_at is not null or jsonb_typeof(p_command)<>'object' then raise exception 'attendance_invalid_request';end if;
    if not(p_command ?& array['operationId','action','reason']) or jsonb_typeof(p_command->'operationId')<>'string'
      or coalesce(p_command->>'operationId','') !~ uuid_pattern or jsonb_typeof(p_command->'action')<>'string'
      or jsonb_typeof(p_command->'reason')<>'string' or char_length(p_command->>'reason') not between 1 and 200
      or p_command->>'reason'<>btrim(p_command->>'reason',U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff')
      or p_command->>'reason' ~ '[[:cntrl:]\u007f-\u009f]' then raise exception 'attendance_invalid_request';end if;
    op:=(p_command->>'operationId')::uuid;action_name:=p_command->>'action';
    if action_name='submit' then
      if mode<>'self' or target_id is not null or (select count(*) from jsonb_object_keys(p_command))<>8
        or not(p_command ?& array['expectedWorkerId','expectedSettingsVersion','timeZone','startAt','endAt'])
        or jsonb_typeof(p_command->'expectedWorkerId')<>'string' or coalesce(p_command->>'expectedWorkerId','') !~ uuid_pattern
        or jsonb_typeof(p_command->'expectedSettingsVersion')<>'number' or coalesce(p_command->>'expectedSettingsVersion','') !~ '^[1-9][0-9]{0,15}$'
        or (p_command->>'expectedSettingsVersion')::numeric>9007199254740990 or jsonb_typeof(p_command->'timeZone')<>'string'
        or not public.faolla_attendance_valid_zone_v1(p_command->>'timeZone') then raise exception 'attendance_invalid_request';end if;
      foreach k in array array['startAt','endAt'] loop
        if jsonb_typeof(p_command->k)<>'string' or coalesce(p_command->>k,'') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$'
          or to_char((p_command->>k)::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>p_command->>k then raise exception 'attendance_invalid_request';end if;
      end loop;
      a:=(p_command->>'startAt')::timestamptz;b:=(p_command->>'endAt')::timestamptz;
      if not isfinite(a) or not isfinite(b) or b<=a or b-a>interval '366 days'
        or (a at time zone (p_command->>'timeZone'))::date not between date '2000-01-01' and date '2100-12-31'
        or (b at time zone (p_command->>'timeZone'))::date not between date '2000-01-01' and date '2100-12-31' then raise exception 'attendance_invalid_request';end if;
      target_id:=op;expected:=0;
    elsif action_name in ('withdraw','approve','reject','cancel') then
      if (select count(*) from jsonb_object_keys(p_command))<>5 or not(p_command ?& array['requestId','expectedRevision'])
        or jsonb_typeof(p_command->'requestId')<>'string' or coalesce(p_command->>'requestId','') !~ uuid_pattern
        or target_id is null or p_command->>'requestId'<>target_id::text
        or p_command->'expectedRevision' is distinct from to_jsonb(case when action_name='cancel' then 2 else 1 end)
        or (action_name='withdraw')<>(mode='self') then raise exception 'attendance_invalid_request';end if;
      expected:=(p_command->>'expectedRevision')::integer;
    else raise exception 'attendance_invalid_request';end if;
  end if;

  perform 1 from public.merchants where id=site and (mode='self' or user_id=p_auth_user_id) for share;
  if not found then raise exception 'attendance_access_denied';end if;
  if p_command is null then select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  else select * into s from public.merchant_attendance_settings where merchant_id=site for update;end if;
  if not found then raise exception 'attendance_settings_required';end if;
  if mode='self' then
    select * into e from public.merchant_enterprise_employees where merchant_id=site and auth_user_id=p_auth_user_id for share;
    if not found or e.status<>'active' then raise exception 'attendance_access_denied';end if;
    select * into r from public.merchant_enterprise_roles where merchant_id=site and id=e.role_id for share;
    if not found or r.status<>'active' or not public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions)
      or not('attendance.self.view'=any(r.permissions)) then raise exception 'attendance_access_denied';end if;
    select * into w from public.merchant_attendance_workers where merchant_id=site and employee_id=e.id for share;
    can_submit:=coalesce(w.active and 'attendance.self.leave'=any(r.permissions),false);
  end if;
  if op is not null then
    select * into receipt_row from public.merchant_attendance_leave_entries where merchant_id=site and operation_id=op;
    if receipt_row.operation_id is not null and (receipt_row.actor_auth_user_id<>p_auth_user_id
      or (receipt_row.action in ('submit','withdraw'))<>(mode='self') or target_id is not null and target_id<>receipt_row.request_id) then
      if p_command is not null then raise exception 'attendance_operation_conflict';end if;receipt_row:=null;
    end if;
    if receipt_row.operation_id is not null then target_id:=receipt_row.request_id;end if;
  end if;
  if p_command is not null and receipt_row.operation_id is not null and receipt_row.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
  if target_id is not null then
    select * into target from public.merchant_attendance_leave_requests where merchant_id=site and request_id=target_id;
    if target.request_id is null and action_name is distinct from 'submit' then raise exception 'attendance_leave_not_found';end if;
    if target.request_id is not null and mode='self' and (target.worker_id is distinct from w.id or target.employee_id is distinct from e.id
      or target.actor_auth_user_id is distinct from p_auth_user_id) then raise exception 'attendance_leave_not_found';end if;
  end if;
  if target.request_id is not null then item:=public.faolla_attendance_leave_summary_v1(target);end if;
  -- All accepted fresh actions, including withdrawal, are paused together.
  if p_command is not null and receipt_row.operation_id is null then
    if not p_allow_write then raise exception 'attendance_platform_paused';end if;
    if action_name='submit' then
      if not can_submit then raise exception 'attendance_access_denied';end if;
      if (p_command->>'expectedWorkerId')::uuid<>w.id then raise exception 'attendance_worker_changed';end if;
      if (p_command->>'expectedSettingsVersion')::bigint<>s.version or p_command->>'timeZone'<>s.time_zone then raise exception 'attendance_version_conflict';end if;
      if target.request_id is not null then raise exception 'attendance_operation_conflict';end if;
      target.merchant_id:=site;target.request_id:=op;target.worker_id:=w.id;target.employee_id:=e.id;target.actor_auth_user_id:=p_auth_user_id;
      target.worker_name:=w.display_name;target.time_zone:=s.time_zone;target.start_at:=a;target.end_at:=b;target.reason:=p_command->>'reason';
    else
      if item->>'revision'<>expected::text or (action_name='cancel' and item->>'status'<>'approved')
        or (action_name<>'cancel' and item->>'status'<>'submitted') then raise exception 'attendance_leave_closed';end if;
      if mode='self' and not('attendance.self.leave'=any(r.permissions)) then raise exception 'attendance_access_denied';end if;
      if mode='owner' and target.actor_auth_user_id=p_auth_user_id then raise exception 'attendance_access_denied';end if;
    end if;
  end if;
  if target.request_id is not null then
    select * into review_e from public.merchant_enterprise_employees where merchant_id=site and id=target.employee_id for share;
    select * into review_r from public.merchant_enterprise_roles where merchant_id=site and id=review_e.role_id for share;
    select * into review_w from public.merchant_attendance_workers where merchant_id=site and id=target.worker_id for share;
    binding_ok:=coalesce(review_e.status='active' and review_e.auth_user_id=target.actor_auth_user_id and review_w.employee_id=target.employee_id and review_w.active
      and review_r.status='active' and public.faolla_valid_merchant_enterprise_permissions_v1(review_r.permissions) and 'attendance.self.view'=any(review_r.permissions),false);
    first_day:=(target.start_at at time zone target.time_zone)::date;last_day:=((target.end_at-interval '1 microsecond') at time zone target.time_zone)::date;
    employment_ok:=true;
    for day in select generate_series(first_day::timestamp,last_day::timestamp,interval '1 day')::date loop
      -- A dateline jump can omit an entire civil day (Apia 2011-12-30).
      -- Ordinary midnight gaps still round-trip to the same date and are checked.
      if ((day::timestamp at time zone target.time_zone) at time zone target.time_zone)::date<>day then continue;end if;
      select count(*) into coverage from public.merchant_attendance_employment_periods where merchant_id=site and worker_id=target.worker_id and starts_on<=day and (ends_on is null or ends_on>=day);
      if coverage<>1 then employment_ok:=false;exit;end if;
    end loop;
    overlap_found:=false;
    for candidate in select p.* from public.merchant_attendance_leave_requests p where p.merchant_id=site and p.worker_id=target.worker_id
      and p.request_id<>target.request_id and p.start_at<target.end_at and p.end_at>target.start_at
      and exists(select 1 from public.merchant_attendance_leave_entries d where d.merchant_id=p.merchant_id and d.request_id=p.request_id and d.revision=2 and d.action='approve')
      and not exists(select 1 from public.merchant_attendance_leave_entries c where c.merchant_id=p.merchant_id and c.request_id=p.request_id and c.revision=3) loop
      if public.faolla_attendance_leave_summary_v1(candidate)->>'status'='approved' then overlap_found:=true;exit;end if;
    end loop;
    if p_command is not null and receipt_row.operation_id is null then
      if action_name='submit' and not employment_ok then raise exception 'attendance_leave_outside_employment';end if;
      if action_name='approve' then
        if not binding_ok then raise exception 'attendance_leave_binding_changed';end if;
        if not employment_ok then raise exception 'attendance_leave_outside_employment';end if;
        if overlap_found then raise exception 'attendance_leave_overlap';end if;
      end if;
      now_at:=clock_timestamp();
      if action_name='submit' then target.submitted_at:=now_at;insert into public.merchant_attendance_leave_requests select (target).*;end if;
      item:=jsonb_build_object('requestId',target.request_id,'workerName',target.worker_name,
        'startAt',to_char(target.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'endAt',to_char(target.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'timeZone',target.time_zone,'submittedAt',to_char(target.submitted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'revision',expected+1,
        'status',case action_name when 'submit' then 'submitted' when 'withdraw' then 'withdrawn' when 'approve' then 'approved' when 'reject' then 'rejected' when 'cancel' then 'cancelled' end);
      insert into public.merchant_attendance_leave_entries(merchant_id,operation_id,request_id,revision,action,actor_auth_user_id,command,snapshot,recorded_at)
        values(site,op,target.request_id,expected+1,action_name,p_auth_user_id,p_command,item,now_at) returning * into receipt_row;
    end if;
    item:=public.faolla_attendance_leave_summary_v1(target);
    can_withdraw:=mode='self' and 'attendance.self.leave'=any(r.permissions) and item->>'status'='submitted';
    can_reject:=mode='owner' and target.actor_auth_user_id<>p_auth_user_id and item->>'status'='submitted';
    can_approve:=can_reject and binding_ok and employment_ok and not overlap_found;
    can_cancel:=mode='owner' and target.actor_auth_user_id<>p_auth_user_id and item->>'status'='approved';
    select jsonb_agg(jsonb_build_object('revision',revision,'action',action,'reason',command->>'reason','recordedAt',to_char(recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) order by revision)
      into history from public.merchant_attendance_leave_entries where merchant_id=site and request_id=target.request_id;
    detail:=item||jsonb_build_object('workerId',target.worker_id,'employeeId',target.employee_id,'reason',target.reason,'history',history,
      'canWithdraw',can_withdraw,'canApprove',can_approve,'canReject',can_reject,'canCancel',can_cancel);
  end if;
  if receipt_row.operation_id is not null then
    item:=public.faolla_attendance_leave_summary_v1(target,receipt_row.revision);
    receipt:=jsonb_build_object('command',receipt_row.command,'item',item,'requestId',receipt_row.request_id,'revision',receipt_row.revision);
  end if;
  if p_command is null and p_query->'requestId'='null'::jsonb and p_query->'operationId'='null'::jsonb then
    for candidate in select * from public.merchant_attendance_leave_requests p where p.merchant_id=site
      and (mode='owner' or (p.worker_id=w.id and p.employee_id=e.id and p.actor_auth_user_id=p_auth_user_id))
      and (cursor_at is null or (p.submitted_at,p.request_id)<(cursor_at,cursor_id)) order by p.submitted_at desc,p.request_id desc limit 26 loop
      row_count:=row_count+1;exit when row_count=26;
      items:=items||jsonb_build_array(public.faolla_attendance_leave_summary_v1(candidate));
      next_cursor:=jsonb_build_object('at',to_char(candidate.submitted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'id',candidate.request_id);
    end loop;
  end if;
  result:=jsonb_build_object('protocol','leave-v1','siteId',site,'access',mode,'actorId',p_auth_user_id,'employeeId',e.id,'workerId',w.id,
    'timeZone',s.time_zone,'settingsVersion',s.version,'canSubmit',can_submit,'items',items,'nextCursor',case when row_count=26 then next_cursor else null end,'detail',detail,'receipt',receipt);
  if octet_length(result::text)>131072 then raise exception 'attendance_leave_invalid';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_parameter_value then raise exception 'attendance_invalid_request';
end;
$$;
revoke all on function public.faolla_attendance_leave_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_leave_v1(jsonb,uuid,jsonb,boolean) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610030122,'merchant_attendance_leave_requests') on conflict(version) do nothing;
do $leave_postconditions$
declare t regclass;role_name text;
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610030122 and name='merchant_attendance_leave_requests') then raise exception 'merchant_attendance_leave_registry_postcondition_failed';end if;
  if not has_function_privilege('service_role','public.faolla_attendance_leave_v1(jsonb,uuid,jsonb,boolean)','EXECUTE')
    or has_function_privilege('anon','public.faolla_attendance_leave_v1(jsonb,uuid,jsonb,boolean)','EXECUTE')
    or has_function_privilege('authenticated','public.faolla_attendance_leave_v1(jsonb,uuid,jsonb,boolean)','EXECUTE') then raise exception 'merchant_attendance_leave_acl_postcondition_failed';end if;
  foreach t in array array['public.merchant_attendance_leave_requests'::regclass,'public.merchant_attendance_leave_entries'::regclass] loop
    if not (select relrowsecurity from pg_class where oid=t) then raise exception 'merchant_attendance_leave_acl_postcondition_failed';end if;
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(role_name,'public.faolla_attendance_leave_summary_v1(public.merchant_attendance_leave_requests,integer)','EXECUTE')
        or exists(select 1 from pg_class c where c.oid=t and (pg_has_role(role_name,c.relowner,'USAGE')
          or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where case when a.grantee=0 then true else pg_has_role(role_name,a.grantee,'USAGE') end))) then
        raise exception 'merchant_attendance_leave_acl_postcondition_failed';
      end if;
    end loop;
  end loop;
end;
$leave_postconditions$;
notify pgrst, 'reload schema';
commit;
