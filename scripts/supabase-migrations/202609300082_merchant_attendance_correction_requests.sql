-- Self declaration/withdrawal only. No approval, effective timesheet or punch edit.
begin;
set local lock_timeout='3s';
create table public.merchant_attendance_correction_entries (
  merchant_id text not null references public.merchant_attendance_settings(merchant_id) on delete restrict,
  worker_id uuid not null, employee_id uuid not null, start_event_id uuid not null references public.merchant_attendance_events(id) on delete restrict,
  revision bigint not null check(revision between 1 and 9007199254740989),
  request_id uuid not null, operation_id uuid not null, actor_auth_user_id uuid not null,
  action text not null check(action in ('submit','withdraw')),
  reason text not null check(char_length(reason) between 1 and 500 and reason=btrim(reason) and reason !~ '[[:cntrl:]]'),
  proposal jsonb, basis jsonb, command jsonb not null check(jsonb_typeof(command)='object'),
  recorded_at timestamptz not null check(isfinite(recorded_at)),
  primary key(merchant_id,worker_id,start_event_id,revision), unique(merchant_id,operation_id),
  foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id) on delete restrict,
  foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id) on delete restrict,
  check((action='submit' and request_id=operation_id and proposal is not null and basis is not null and jsonb_typeof(proposal)='object' and jsonb_typeof(basis)='object')
    or (action='withdraw' and proposal is null and basis is null))
);
create unique index attendance_correction_submit_id_idx on public.merchant_attendance_correction_entries(merchant_id,request_id) where action='submit';
create index attendance_correction_request_revision_idx on public.merchant_attendance_correction_entries(merchant_id,request_id,revision desc);
create index attendance_correction_self_list_idx on public.merchant_attendance_correction_entries(merchant_id,worker_id,actor_auth_user_id,recorded_at desc,request_id desc) where action='submit';
alter table public.merchant_attendance_correction_entries enable row level security;
revoke all on public.merchant_attendance_correction_entries from public,anon,authenticated,service_role;
create trigger attendance_correction_no_rewrite before update or delete on public.merchant_attendance_correction_entries
  for each row execute function public.faolla_attendance_events_append_only_v1();
create trigger attendance_correction_no_truncate before truncate on public.merchant_attendance_correction_entries
  for each statement execute function public.faolla_attendance_events_append_only_v1();

create function public.faolla_attendance_correction_proposal_v1(p_value jsonb,p_now timestamptz) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare a timestamptz;b timestamptz;prev timestamptz;x timestamptz;y timestamptz;r jsonb;items jsonb:='[]';
begin
  if p_value is null or jsonb_typeof(p_value)<>'object' or (select count(*) from jsonb_object_keys(p_value))<>3
    or not(p_value ?& array['startAt','endAt','breaks']) or jsonb_typeof(p_value->'startAt')<>'string'
    or jsonb_typeof(p_value->'endAt')<>'string' or jsonb_typeof(p_value->'breaks')<>'array'
    or jsonb_array_length(p_value->'breaks')>32 then raise exception 'attendance_invalid_request';end if;
  a:=public.faolla_attendance_instant_v1(p_value->>'startAt');b:=public.faolla_attendance_instant_v1(p_value->>'endAt');
  if b<=a or b-a>interval '31 days' or b>p_now then raise exception 'attendance_invalid_request';end if;prev:=a;
  for r in select value from jsonb_array_elements(p_value->'breaks') loop
    if jsonb_typeof(r)<>'object' or (select count(*) from jsonb_object_keys(r))<>3 or not(r ?& array['startAt','endAt','paid'])
      or jsonb_typeof(r->'startAt')<>'string' or jsonb_typeof(r->'endAt')<>'string' or jsonb_typeof(r->'paid')<>'boolean'
      then raise exception 'attendance_invalid_request';end if;
    x:=public.faolla_attendance_instant_v1(r->>'startAt');y:=public.faolla_attendance_instant_v1(r->>'endAt');
    if x<prev or y<=x or y>b then raise exception 'attendance_invalid_request';end if;prev:=y;
    items:=items||jsonb_build_array(jsonb_build_object('startAt',to_char(x at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'endAt',to_char(y at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'paid',r->'paid'));
  end loop;
  return jsonb_build_object('startAt',to_char(a at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'endAt',to_char(b at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'breaks',items);
end; $$;
revoke all on function public.faolla_attendance_correction_proposal_v1(jsonb,timestamptz) from public,anon,authenticated,service_role;

create function public.faolla_attendance_correction_basis_v1(p_site text,p_auth uuid,p_start uuid,p_worker uuid,p_employee uuid) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare v jsonb;e jsonb;prev_seq bigint;prev_at timestamptz;first_at timestamptz;at_time timestamptz;state text:='off';
begin
  v:=public.faolla_attendance_self_session_v1(p_site,p_auth,p_start);
  if v->>'workerId'<>p_worker::text or v->>'employeeId'<>p_employee::text then raise exception 'attendance_worker_changed';end if;
  if jsonb_array_length(v->'events')>202 then raise exception 'attendance_session_too_large';end if;
  for e in select value from jsonb_array_elements(v->'events') loop
    if e->>'source'<>'web' or not exists(select 1 from public.merchant_attendance_events ev
      where ev.id=(e->>'id')::uuid and ev.merchant_id=p_site and ev.worker_id=p_worker and ev.actor_employee_id=p_employee)
      then raise exception 'attendance_correction_unsupported_basis';end if;
    at_time:=public.faolla_attendance_instant_v1(e->>'occurredAt');
    if at_time>public.faolla_attendance_instant_v1(v->>'asOf') then raise exception 'attendance_session_invalid_records';end if;
    if prev_seq is not null and ((e->>'sequence')::bigint<>prev_seq+1 or at_time<prev_at) then raise exception 'attendance_session_invalid_records';end if;
    if prev_seq is null and e->>'action'='clock_in' then state:='working';first_at:=at_time;
    elsif state='working' and e->>'action'='break_start' then state:='break';
    elsif state='break' and e->>'action'='break_end' then state:='working';
    elsif state='working' and e->>'action'='clock_out' then state:='closed';
    else raise exception 'attendance_session_invalid_records';end if;
    prev_seq:=(e->>'sequence')::bigint;prev_at:=at_time;
  end loop;
  if state='closed' and prev_at-first_at>interval '31 days' then raise exception 'attendance_session_span_too_long';end if;
  return v;
end; $$;
revoke all on function public.faolla_attendance_correction_basis_v1(text,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.faolla_attendance_correction_summary_v1(p_first public.merchant_attendance_correction_entries,p_last public.merchant_attendance_correction_entries) returns jsonb
language sql immutable set search_path=pg_catalog as $$
  select jsonb_build_object('requestId',p_first.request_id,'startEventId',p_first.start_event_id,'revision',p_last.revision,
    'status',case p_last.action when 'submit' then 'submitted' else 'withdrawn' end,
    'submittedAt',to_char(p_first.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'startAt',p_first.proposal->'startAt','endAt',p_first.proposal->'endAt');
$$;
revoke all on function public.faolla_attendance_correction_summary_v1(public.merchant_attendance_correction_entries,public.merchant_attendance_correction_entries) from public,anon,authenticated,service_role;

create function public.faolla_attendance_correction_self_v1(p_site_id text,p_auth_user_id uuid,p_query jsonb,p_command jsonb default null,p_platform_enabled boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
  emp public.merchant_enterprise_employees%rowtype;rr public.merchant_enterprise_roles%rowtype;w public.merchant_attendance_workers%rowtype;
  first_entry public.merchant_attendance_correction_entries%rowtype;last_entry public.merchant_attendance_correction_entries%rowtype;
  head public.merchant_attendance_correction_entries%rowtype;receipt public.merchant_attendance_correction_entries%rowtype;r public.merchant_attendance_correction_entries%rowtype;
  v_mode text;v_worker uuid;v_start uuid;v_request uuid;v_operation uuid;v_cursor_at timestamptz;v_cursor uuid;
  v_now timestamptz;v_basis jsonb;v_proposal jsonb;v_common jsonb;v_can boolean;v_count integer:=0;v_items jsonb:='[]';v_next jsonb:='null';
  v_uuid text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_query is null or jsonb_typeof(p_query)<>'object'
    or coalesce(p_query->>'expectedWorkerId','') !~ v_uuid then raise exception 'attendance_invalid_request';end if;
  v_mode:=p_query->>'mode';v_worker:=(p_query->>'expectedWorkerId')::uuid;
  if v_mode='prepare' then
    if p_command is not null or (select count(*) from jsonb_object_keys(p_query))<>3 or not(p_query ?& array['mode','expectedWorkerId','startEventId'])
      or coalesce(p_query->>'startEventId','') !~ v_uuid then raise exception 'attendance_invalid_request';end if;v_start:=(p_query->>'startEventId')::uuid;
  elsif v_mode='detail' then
    if (select count(*) from jsonb_object_keys(p_query))<>4 or not(p_query ?& array['mode','expectedWorkerId','requestId','operationId'])
      or coalesce(p_query->>'requestId','') !~ v_uuid or (p_query->'operationId'<>'null'::jsonb and coalesce(p_query->>'operationId','') !~ v_uuid)
      then raise exception 'attendance_invalid_request';end if;
    v_request:=(p_query->>'requestId')::uuid;v_operation:=(p_query->>'operationId')::uuid;
  elsif v_mode='list' then
    if p_command is not null or (select count(*) from jsonb_object_keys(p_query))<>4 or not(p_query ?& array['mode','expectedWorkerId','cursorAt','cursorId'])
      or ((p_query->'cursorAt'='null'::jsonb)<>(p_query->'cursorId'='null'::jsonb))
      or (p_query->'cursorId'<>'null'::jsonb and coalesce(p_query->>'cursorId','') !~ v_uuid) then raise exception 'attendance_invalid_request';end if;
    v_cursor:=(p_query->>'cursorId')::uuid;if v_cursor is not null then v_cursor_at:=public.faolla_attendance_instant_v1(p_query->>'cursorAt');end if;
  else raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
    if jsonb_typeof(p_command)<>'object' or v_operation is not null or coalesce(p_command->>'action','') not in ('submit','withdraw')
      or coalesce(p_command->>'operationId','') !~ v_uuid or jsonb_typeof(p_command->'expectedRevision')<>'number'
      or coalesce(p_command->>'expectedRevision','') !~ '^(0|[1-9][0-9]{0,15})$' or (p_command->>'expectedRevision')::numeric>9007199254740988
      or jsonb_typeof(p_command->'reason')<>'string' or char_length(btrim(p_command->>'reason')) not between 1 and 500
      or p_command->>'reason'<>btrim(p_command->>'reason') or p_command->>'reason' ~ '[[:cntrl:]]' then raise exception 'attendance_invalid_request';end if;
    v_operation:=(p_command->>'operationId')::uuid;
    if p_command->>'action'='submit' then
      if (select count(*) from jsonb_object_keys(p_command))<>7 or not(p_command ?& array['action','operationId','expectedRevision','reason','startEventId','expectedLastEventId','proposal'])
        or v_request<>v_operation or coalesce(p_command->>'startEventId','') !~ v_uuid or coalesce(p_command->>'expectedLastEventId','') !~ v_uuid
        then raise exception 'attendance_invalid_request';end if;v_start:=(p_command->>'startEventId')::uuid;
    else
      if (select count(*) from jsonb_object_keys(p_command))<>5 or not(p_command ?& array['action','operationId','expectedRevision','reason','requestId'])
        or p_command->>'requestId' is distinct from v_request::text then raise exception 'attendance_invalid_request';end if;
    end if;
  end if;
  perform 1 from public.merchants where id=p_site_id for share;if not found then raise exception 'attendance_access_denied';end if;
  perform 1 from public.merchant_attendance_settings where merchant_id=p_site_id for share;if not found then raise exception 'attendance_settings_required';end if;
  select * into emp from public.merchant_enterprise_employees where merchant_id=p_site_id and auth_user_id=p_auth_user_id for share;
  if not found or emp.status<>'active' then raise exception 'attendance_access_denied';end if;
  select * into rr from public.merchant_enterprise_roles where merchant_id=p_site_id and id=emp.role_id for share;
  if not found or rr.status<>'active' or not public.faolla_valid_merchant_enterprise_permissions_v1(rr.permissions)
    or not('attendance.self.view'=any(rr.permissions)) then raise exception 'attendance_access_denied';end if;
  if p_command is null then select * into w from public.merchant_attendance_workers where merchant_id=p_site_id and employee_id=emp.id for share;
  else select * into w from public.merchant_attendance_workers where merchant_id=p_site_id and employee_id=emp.id for update;end if;
  if not found then raise exception 'attendance_access_denied';end if;if w.id<>v_worker then raise exception 'attendance_worker_changed';end if;
  -- Inactive workers may request historical review; no new clock permission follows.
  v_can:='attendance.self.request'=any(rr.permissions);v_now:=clock_timestamp();
  v_common:=jsonb_build_object('siteId',p_site_id,'employeeId',emp.id,'workerId',w.id,'canRequest',v_can,'mode',v_mode);
  if v_mode='list' then
    for r in select * from public.merchant_attendance_correction_entries
      where merchant_id=p_site_id and worker_id=w.id and actor_auth_user_id=p_auth_user_id and employee_id=emp.id and action='submit'
      and (v_cursor is null or (recorded_at,request_id)<(v_cursor_at,v_cursor)) order by recorded_at desc,request_id desc limit 26
    loop
      v_count:=v_count+1;if v_count=26 then exit;end if;
      select * into last_entry from public.merchant_attendance_correction_entries where merchant_id=p_site_id and request_id=r.request_id order by revision desc limit 1;
      v_items:=v_items||jsonb_build_array(public.faolla_attendance_correction_summary_v1(r,last_entry));
      v_next:=jsonb_build_object('recordedAt',to_char(r.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'requestId',r.request_id);
    end loop;
    return v_common||jsonb_build_object('asOf',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'items',v_items,'nextCursor',case when v_count=26 then v_next else 'null'::jsonb end);
  end if;
  if v_mode='detail' then
    select * into first_entry from public.merchant_attendance_correction_entries where merchant_id=p_site_id and request_id=v_request and action='submit';
    if first_entry.revision is not null and (first_entry.worker_id<>w.id or first_entry.employee_id<>emp.id or first_entry.actor_auth_user_id<>p_auth_user_id)
      then raise exception 'attendance_correction_not_found';end if;
    if first_entry.revision is null and (p_command is null or p_command->>'action'<>'submit') then raise exception 'attendance_correction_not_found';end if;
    if first_entry.revision is not null then v_start:=first_entry.start_event_id;end if;
  end if;
  select * into head from public.merchant_attendance_correction_entries where merchant_id=p_site_id and worker_id=w.id and start_event_id=v_start order by revision desc limit 1;
  if v_mode='prepare' then
    if head.revision is not null and head.actor_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;
    v_basis:=public.faolla_attendance_correction_basis_v1(p_site_id,p_auth_user_id,v_start,w.id,emp.id);
    return v_common||jsonb_build_object('asOf',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'basis',v_basis,
      'revision',coalesce(head.revision,0),'pendingRequestId',case when head.action='submit' then head.request_id else null end);
  end if;
  select * into receipt from public.merchant_attendance_correction_entries where merchant_id=p_site_id and operation_id=v_operation;
  if receipt.revision is not null and (receipt.worker_id<>w.id or receipt.employee_id<>emp.id or receipt.actor_auth_user_id<>p_auth_user_id or receipt.request_id<>v_request) then
    if p_command is not null then raise exception 'attendance_operation_conflict';end if;receipt:=null;
  end if;
  if p_command is not null then
    if receipt.revision is not null then
      if receipt.command<>p_command then raise exception 'attendance_operation_conflict';end if;
    else
      if not v_can then raise exception 'attendance_access_denied';end if;
      if coalesce(head.revision,0)<>(p_command->>'expectedRevision')::bigint then raise exception 'attendance_version_conflict';end if;
      if p_command->>'action'='submit' then
        if head.revision is not null and head.actor_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;
        if not coalesce(p_platform_enabled,false) then raise exception 'attendance_platform_paused';end if;
        if head.action='submit' then raise exception 'attendance_correction_pending';end if;
        v_basis:=public.faolla_attendance_correction_basis_v1(p_site_id,p_auth_user_id,v_start,w.id,emp.id);
        if v_basis->'events'->-1->>'id' is distinct from p_command->>'expectedLastEventId' then raise exception 'attendance_correction_basis_changed';end if;
        v_now:=clock_timestamp();v_proposal:=public.faolla_attendance_correction_proposal_v1(p_command->'proposal',v_now);
      else
        if head.action is distinct from 'submit' or head.request_id<>v_request then raise exception 'attendance_correction_closed';end if;
      end if;
      insert into public.merchant_attendance_correction_entries(merchant_id,worker_id,employee_id,start_event_id,revision,request_id,operation_id,
        actor_auth_user_id,action,reason,proposal,basis,command,recorded_at)
      values(p_site_id,w.id,emp.id,v_start,coalesce(head.revision,0)+1,v_request,v_operation,p_auth_user_id,p_command->>'action',p_command->>'reason',v_proposal,v_basis,p_command,v_now)
      returning * into receipt;
      if receipt.action='submit' then first_entry:=receipt;end if;
    end if;
  end if;
  select * into last_entry from public.merchant_attendance_correction_entries where merchant_id=p_site_id and request_id=v_request order by revision desc limit 1;
  return v_common||jsonb_build_object('asOf',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'item',public.faolla_attendance_correction_summary_v1(first_entry,last_entry),'basis',first_entry.basis,'proposal',first_entry.proposal,'reason',first_entry.reason,
    'withdrawal',case when last_entry.action='withdraw' then jsonb_build_object('reason',last_entry.reason,'recordedAt',to_char(last_entry.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) else null end,
    'receipt',case when receipt.revision is not null then jsonb_build_object('operationId',receipt.operation_id,'requestId',receipt.request_id,'revision',receipt.revision,'action',receipt.action,
      'recordedAt',to_char(receipt.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) else null end);
end; $$;
revoke all on function public.faolla_attendance_correction_self_v1(text,uuid,jsonb,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_correction_self_v1(text,uuid,jsonb,jsonb,boolean) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202609300082,'merchant_attendance_correction_requests') on conflict(version) do nothing;
commit;
