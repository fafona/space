-- Opt-in receipt capture via a NEW wrapper only. No source-table trigger,
-- legacy function replacement, historical backfill, email or push delivery.
begin;
set local lock_timeout='3s';
do $notice_prerequisites$
declare installed boolean;t text;
begin
  if to_regclass('public.faolla_schema_migrations') is null or to_regclass('public.merchant_attendance_leave_requests') is null
    or to_regclass('public.merchant_attendance_leave_entries') is null
    or to_regprocedure('public.faolla_attendance_leave_v1(jsonb,uuid,jsonb,boolean)') is null
    or to_regprocedure('public.faolla_attendance_leave_summary_v1(public.merchant_attendance_leave_requests,integer)') is null
    or to_regprocedure('public.faolla_attendance_events_append_only_v1()') is null then raise exception 'merchant_attendance_leave_notifications_prerequisite_required';end if;
  if not exists(select 1 from public.faolla_schema_migrations where version=202610030122 and name='merchant_attendance_leave_requests') then
    raise exception 'merchant_attendance_leave_notifications_prerequisite_required';end if;
  select exists(select 1 from public.faolla_schema_migrations where version=202610040125 and name='merchant_attendance_leave_notifications') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610040125 and name<>'merchant_attendance_leave_notifications') then
    raise exception 'merchant_attendance_leave_notifications_installation_conflict';end if;
  foreach t in array array['merchant_attendance_leave_notifications','merchant_attendance_leave_notification_reads'] loop
    if installed<>(to_regclass('public.'||t) is not null) then raise exception 'merchant_attendance_leave_notifications_installation_conflict';end if;
  end loop;
  if installed<>(to_regprocedure('public.faolla_attendance_leave_notify_v1(jsonb,uuid,jsonb,boolean)') is not null)
    or installed<>(to_regprocedure('public.faolla_attendance_leave_notifications_v1(jsonb,uuid,jsonb,boolean)') is not null) then
    raise exception 'merchant_attendance_leave_notifications_installation_conflict';end if;
end;
$notice_prerequisites$;

create table if not exists public.merchant_attendance_leave_notifications (
  merchant_id text not null,notification_id uuid not null,request_id uuid not null,worker_id uuid not null,employee_id uuid not null,recipient_auth_user_id uuid not null,
  revision smallint not null,action text not null,decided_at timestamptz not null check(isfinite(decided_at)),
  primary key(merchant_id,notification_id),unique(merchant_id,request_id,revision),
  foreign key(merchant_id,request_id) references public.merchant_attendance_leave_requests(merchant_id,request_id),
  foreign key(merchant_id,notification_id) references public.merchant_attendance_leave_entries(merchant_id,operation_id),
  check((revision=2 and action in('approve','reject')) or (revision=3 and action='cancel'))
);
create index if not exists attendance_leave_notifications_recipient_idx on public.merchant_attendance_leave_notifications
  (merchant_id,worker_id,employee_id,recipient_auth_user_id,decided_at desc,notification_id desc);
create table if not exists public.merchant_attendance_leave_notification_reads (
  merchant_id text not null,notification_id uuid not null,worker_id uuid not null,employee_id uuid not null,recipient_auth_user_id uuid not null,
  read_at timestamptz not null check(isfinite(read_at)),primary key(merchant_id,notification_id),
  foreign key(merchant_id,notification_id) references public.merchant_attendance_leave_notifications(merchant_id,notification_id)
);
alter table public.merchant_attendance_leave_notifications enable row level security;
alter table public.merchant_attendance_leave_notification_reads enable row level security;
revoke all on public.merchant_attendance_leave_notifications,public.merchant_attendance_leave_notification_reads from public,anon,authenticated,service_role;
do $notice_triggers$
declare t text;
begin
  foreach t in array array['merchant_attendance_leave_notifications','merchant_attendance_leave_notification_reads'] loop
    if not exists(select 1 from pg_trigger where tgrelid=('public.'||t)::regclass and tgname=t||'_immutable') then
      execute format('create trigger %I before update or delete on public.%I for each row execute function public.faolla_attendance_events_append_only_v1()',t||'_immutable',t);end if;
    if not exists(select 1 from pg_trigger where tgrelid=('public.'||t)::regclass and tgname=t||'_no_truncate') then
      execute format('create trigger %I before truncate on public.%I for each statement execute function public.faolla_attendance_events_append_only_v1()',t||'_no_truncate',t);end if;
  end loop;
end;
$notice_triggers$;

-- Same signature and result as122, but ONLY explicit owner decisions are accepted.
-- VOLATILE is essential: the source-existence statement runs AFTER a possible
-- settings-lock wait and must observe the preceding writer's committed receipt.
create or replace function public.faolla_attendance_leave_notify_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare site text;op uuid;rid uuid;existed boolean;result jsonb;checked jsonb;
  source public.merchant_attendance_leave_entries%rowtype;request_row public.merchant_attendance_leave_requests%rowtype;
  u text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_auth_user_id is null or p_allow_write is null or p_query is null or jsonb_typeof(p_query)<>'object'
    or p_command is null or jsonb_typeof(p_command)<>'object' then raise exception 'attendance_invalid_request';end if;
  if (select count(*) from jsonb_object_keys(p_query))<>6 or not(p_query ?& array['siteId','access','requestId','operationId','beforeAt','beforeId'])
    or jsonb_typeof(p_query->'siteId')<>'string' or coalesce(p_query->>'siteId','') !~ '^\d{8}$' or p_query->'access' is distinct from '"owner"'::jsonb
    or jsonb_typeof(p_query->'requestId')<>'string' or coalesce(p_query->>'requestId','') !~ u
    or p_query->'operationId'<>'null'::jsonb or p_query->'beforeAt'<>'null'::jsonb or p_query->'beforeId'<>'null'::jsonb then raise exception 'attendance_invalid_request';end if;
  if (select count(*) from jsonb_object_keys(p_command))<>5 or not(p_command ?& array['operationId','action','reason','requestId','expectedRevision'])
    or jsonb_typeof(p_command->'operationId')<>'string' or coalesce(p_command->>'operationId','') !~ u
    or jsonb_typeof(p_command->'action')<>'string' or coalesce(p_command->>'action','') not in('approve','reject','cancel')
    or p_command->'requestId' is distinct from p_query->'requestId'
    or p_command->'expectedRevision' is distinct from to_jsonb(case when p_command->>'action'='cancel' then 2 else 1 end)
    or jsonb_typeof(p_command->'reason')<>'string' or char_length(p_command->>'reason') not between 1 and 200
    or p_command->>'reason'<>btrim(p_command->>'reason',U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff')
    or p_command->>'reason' ~ '[[:cntrl:]\u007f-\u009f]' then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';op:=(p_command->>'operationId')::uuid;rid:=(p_query->>'requestId')::uuid;
  perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  perform 1 from public.merchant_attendance_settings where merchant_id=site for update;
  if not found then raise exception 'attendance_settings_required';end if;
  select exists(select 1 from public.merchant_attendance_leave_entries where merchant_id=site and operation_id=op) into existed;
  result:=public.faolla_attendance_leave_v1(p_query,p_auth_user_id,p_command,p_allow_write);
  -- A pre-existing source, including one produced while capture was disabled,
  -- is never backfilled by a retry. Reads never call this wrapper.
  if existed then return result;end if;
  begin
    select * into source from public.merchant_attendance_leave_entries where merchant_id=site and operation_id=op;
    select * into request_row from public.merchant_attendance_leave_requests where merchant_id=site and request_id=rid;
    if source.operation_id is null or request_row.request_id is null or source.request_id<>rid or source.actor_auth_user_id<>p_auth_user_id
      or source.command is distinct from p_command or source.action<>p_command->>'action'
      or source.revision<>(p_command->>'expectedRevision')::integer+1 or request_row.actor_auth_user_id=p_auth_user_id
      or result->'receipt'->'command' is distinct from p_command or result->'receipt'->>'requestId' is distinct from rid::text
      or result->'receipt'->'revision' is distinct from to_jsonb(source.revision) or result->'receipt'->'item' is distinct from source.snapshot then
      raise exception 'attendance_leave_invalid';end if;
    checked:=public.faolla_attendance_leave_summary_v1(request_row,source.revision);
    if checked is distinct from source.snapshot then raise exception 'attendance_leave_invalid';end if;
    insert into public.merchant_attendance_leave_notifications(merchant_id,notification_id,request_id,worker_id,employee_id,recipient_auth_user_id,revision,action,decided_at)
      values(site,op,rid,request_row.worker_id,request_row.employee_id,request_row.actor_auth_user_id,source.revision,source.action,source.recorded_at);
  exception when others then
    -- Re-raising makes the preceding original decision roll back as well.
    -- Never swallow capture failures or return an approval without its projection.
    raise exception 'attendance_leave_invalid';
  end;
  return result;
end;
$$;
revoke all on function public.faolla_attendance_leave_notify_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_leave_notify_v1(jsonb,uuid,jsonb,boolean) to service_role;

-- Private, bounded source verification. Historical approvers need not still be
-- current owners; original122 validated their authority at the decision time.
create or replace function public.faolla_attendance_leave_notification_detail_v1(p public.merchant_attendance_leave_notifications)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare request_row public.merchant_attendance_leave_requests%rowtype;source public.merchant_attendance_leave_entries%rowtype;
  read_row public.merchant_attendance_leave_notification_reads%rowtype;current_item jsonb;historical_item jsonb;
begin
  select * into request_row from public.merchant_attendance_leave_requests where merchant_id=p.merchant_id and request_id=p.request_id;
  select * into source from public.merchant_attendance_leave_entries where merchant_id=p.merchant_id and operation_id=p.notification_id;
  if request_row.request_id is null or source.operation_id is null or source.request_id<>p.request_id or source.revision<>p.revision or source.action<>p.action
    or source.recorded_at<>p.decided_at or request_row.worker_id<>p.worker_id or request_row.employee_id<>p.employee_id
    or request_row.actor_auth_user_id<>p.recipient_auth_user_id then raise exception 'attendance_notification_invalid';end if;
  current_item:=public.faolla_attendance_leave_summary_v1(request_row);
  historical_item:=public.faolla_attendance_leave_summary_v1(request_row,p.revision);
  if historical_item is distinct from source.snapshot or historical_item->>'status' is distinct from
    (case p.action when 'approve' then 'approved' when 'reject' then 'rejected' when 'cancel' then 'cancelled' end)
    or (p.action='approve' and not(current_item->>'status'='approved' and current_item->'revision'='2'::jsonb or current_item->>'status'='cancelled' and current_item->'revision'='3'::jsonb))
    or (p.action='reject' and (current_item->>'status'<>'rejected' or current_item->'revision'<>'2'::jsonb))
    or (p.action='cancel' and (current_item->>'status'<>'cancelled' or current_item->'revision'<>'3'::jsonb)) then raise exception 'attendance_notification_invalid';end if;
  select * into read_row from public.merchant_attendance_leave_notification_reads where merchant_id=p.merchant_id and notification_id=p.notification_id;
  if read_row.notification_id is not null and (read_row.worker_id<>p.worker_id or read_row.employee_id<>p.employee_id or read_row.recipient_auth_user_id<>p.recipient_auth_user_id
    or read_row.read_at<p.decided_at) then raise exception 'attendance_notification_invalid';end if;
  return jsonb_build_object('notificationId',p.notification_id,'requestId',p.request_id,'revision',p.revision,
    'type',case p.action when 'approve' then 'approved' when 'reject' then 'rejected' when 'cancel' then 'approval_cancelled' end,
    'decidedAt',to_char(p.decided_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'startAt',historical_item->>'startAt','endAt',historical_item->>'endAt','timeZone',historical_item->>'timeZone',
    'readAt',to_char(read_row.read_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'currentStatus',current_item->>'status','currentRevision',current_item->'revision');
exception when others then raise exception 'attendance_notification_invalid';
end;
$$;
revoke all on function public.faolla_attendance_leave_notification_detail_v1(public.merchant_attendance_leave_notifications) from public,anon,authenticated,service_role;

create or replace function public.faolla_attendance_leave_notifications_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;k text;expected_employee uuid;expected_worker uuid;nid uuid;cursor_at timestamptz;cursor_id uuid;
  e public.merchant_enterprise_employees%rowtype;r public.merchant_enterprise_roles%rowtype;w public.merchant_attendance_workers%rowtype;
  target public.merchant_attendance_leave_notifications%rowtype;candidate public.merchant_attendance_leave_notifications%rowtype;
  detail jsonb;items jsonb:='[]';item jsonb;result jsonb;next_cursor jsonb;rows_seen integer:=0;
  u text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_auth_user_id is null or p_allow_write is null or p_query is null or jsonb_typeof(p_query)<>'object' then raise exception 'attendance_invalid_request';end if;
  if (select count(*) from jsonb_object_keys(p_query))<>6 or not(p_query ?& array['siteId','expectedEmployeeId','expectedWorkerId','notificationId','beforeAt','beforeId'])
    or jsonb_typeof(p_query->'siteId')<>'string' or coalesce(p_query->>'siteId','') !~ '^\d{8}$'
    or jsonb_typeof(p_query->'expectedEmployeeId')<>'string' or coalesce(p_query->>'expectedEmployeeId','') !~ u then raise exception 'attendance_invalid_request';end if;
  foreach k in array array['expectedWorkerId','notificationId','beforeId'] loop
    if p_query->k<>'null'::jsonb and (jsonb_typeof(p_query->k)<>'string' or coalesce(p_query->>k,'') !~ u) then raise exception 'attendance_invalid_request';end if;
  end loop;
  site:=p_query->>'siteId';expected_employee:=(p_query->>'expectedEmployeeId')::uuid;expected_worker:=(p_query->>'expectedWorkerId')::uuid;
  nid:=(p_query->>'notificationId')::uuid;cursor_id:=(p_query->>'beforeId')::uuid;
  if p_query->'beforeAt'<>'null'::jsonb then
    if jsonb_typeof(p_query->'beforeAt')<>'string' or coalesce(p_query->>'beforeAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$' then raise exception 'attendance_invalid_request';end if;
    cursor_at:=(p_query->>'beforeAt')::timestamptz;
    if not isfinite(cursor_at) or to_char(cursor_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')<>p_query->>'beforeAt' then raise exception 'attendance_invalid_request';end if;
  end if;
  if (cursor_at is null)<>(cursor_id is null) or cursor_at is not null and nid is not null
    or (cursor_at is not null or nid is not null) and expected_worker is null then raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
    if jsonb_typeof(p_command)<>'object' then raise exception 'attendance_invalid_request';end if;
    if (select count(*) from jsonb_object_keys(p_command))<>2 or not(p_command ?& array['action','notificationId'])
      or p_command->'action' is distinct from '"mark_read"'::jsonb or p_command->'notificationId' is distinct from p_query->'notificationId'
      or nid is null or expected_worker is null or cursor_at is not null then raise exception 'attendance_invalid_request';end if;
  end if;
  perform 1 from public.merchants where id=site for share;
  if not found then raise exception 'attendance_access_denied';end if;
  if p_command is null then perform 1 from public.merchant_attendance_settings where merchant_id=site for share;
  else perform 1 from public.merchant_attendance_settings where merchant_id=site for update;end if;
  if not found then raise exception 'attendance_settings_required';end if;
  select * into e from public.merchant_enterprise_employees where merchant_id=site and auth_user_id=p_auth_user_id for share;
  if not found or e.status<>'active' or e.id<>expected_employee then raise exception 'attendance_access_denied';end if;
  select * into r from public.merchant_enterprise_roles where merchant_id=site and id=e.role_id for share;
  if not found or r.status<>'active' or not public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions)
    or not('attendance.self.view'=any(r.permissions)) then raise exception 'attendance_access_denied';end if;
  select * into w from public.merchant_attendance_workers where merchant_id=site and employee_id=e.id for share;
  if expected_worker is not null and expected_worker is distinct from w.id then raise exception 'attendance_worker_changed';end if;
  if nid is not null then
    select * into target from public.merchant_attendance_leave_notifications where merchant_id=site and notification_id=nid
      and worker_id=w.id and employee_id=e.id and recipient_auth_user_id=p_auth_user_id;
    if not found then raise exception 'attendance_notification_not_found';end if;
    detail:=public.faolla_attendance_leave_notification_detail_v1(target);
    if p_command is not null and detail->'readAt'='null'::jsonb then
      if not p_allow_write then raise exception 'attendance_platform_paused';end if;
      insert into public.merchant_attendance_leave_notification_reads(merchant_id,notification_id,worker_id,employee_id,recipient_auth_user_id,read_at)
        values(site,nid,w.id,e.id,p_auth_user_id,greatest(clock_timestamp(),target.decided_at)) on conflict(merchant_id,notification_id) do nothing;
      detail:=public.faolla_attendance_leave_notification_detail_v1(target);
      if detail->'readAt'='null'::jsonb then raise exception 'attendance_notification_invalid';end if;
    end if;
  elsif w.id is not null then
    for candidate in select * from public.merchant_attendance_leave_notifications n where n.merchant_id=site and n.worker_id=w.id and n.employee_id=e.id
      and n.recipient_auth_user_id=p_auth_user_id and (cursor_at is null or (n.decided_at,n.notification_id)<(cursor_at,cursor_id))
      order by n.decided_at desc,n.notification_id desc limit 26 loop
      rows_seen:=rows_seen+1;exit when rows_seen=26;
      item:=public.faolla_attendance_leave_notification_detail_v1(candidate)-'currentStatus'-'currentRevision';items:=items||jsonb_build_array(item);
      next_cursor:=jsonb_build_object('at',to_char(candidate.decided_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'id',candidate.notification_id);
    end loop;
  end if;
  result:=jsonb_build_object('protocol','leave-notifications-v1','siteId',site,'actorId',p_auth_user_id,'employeeId',e.id,'workerId',w.id,
    'items',items,'nextCursor',case when rows_seen=26 then next_cursor else null end,'detail',detail);
  if octet_length(result::text)>131072 then raise exception 'attendance_notification_invalid';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_parameter_value then raise exception 'attendance_invalid_request';
end;
$$;
revoke all on function public.faolla_attendance_leave_notifications_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_leave_notifications_v1(jsonb,uuid,jsonb,boolean) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610040125,'merchant_attendance_leave_notifications') on conflict(version) do nothing;
do $notice_postconditions$
declare t regclass;r text;p regprocedure;
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610040125 and name='merchant_attendance_leave_notifications') then
    raise exception 'merchant_attendance_leave_notifications_registry_postcondition_failed';end if;
  foreach p in array array['public.faolla_attendance_leave_notify_v1(jsonb,uuid,jsonb,boolean)'::regprocedure,'public.faolla_attendance_leave_notifications_v1(jsonb,uuid,jsonb,boolean)'::regprocedure] loop
    if not has_function_privilege('service_role',p,'EXECUTE') or has_function_privilege('anon',p,'EXECUTE') or has_function_privilege('authenticated',p,'EXECUTE') then
      raise exception 'merchant_attendance_leave_notifications_acl_postcondition_failed';end if;
  end loop;
  foreach t in array array['public.merchant_attendance_leave_notifications'::regclass,'public.merchant_attendance_leave_notification_reads'::regclass] loop
    if not (select relrowsecurity from pg_class where oid=t) then raise exception 'merchant_attendance_leave_notifications_acl_postcondition_failed';end if;
    foreach r in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(r,'public.faolla_attendance_leave_notification_detail_v1(public.merchant_attendance_leave_notifications)','EXECUTE')
        or exists(select 1 from pg_class c where c.oid=t and (pg_has_role(r,c.relowner,'USAGE')
          or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where case when a.grantee=0 then true else pg_has_role(r,a.grantee,'USAGE') end))) then
        raise exception 'merchant_attendance_leave_notifications_acl_postcondition_failed';end if;
    end loop;
  end loop;
end;
$notice_postconditions$;
notify pgrst, 'reload schema';
commit;
