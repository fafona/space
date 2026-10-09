-- Default-off whole-missing declarations. Separate reviewed ledger, NOT raw punches
-- or an addition to existing timesheet totals. No existing writer/reader is changed.
begin;
set local lock_timeout='3s';
create table public.merchant_attendance_missing_requests (
  merchant_id text not null, request_id uuid not null, worker_id uuid not null, employee_id uuid not null,
  actor_auth_user_id uuid not null, worker_name text not null, location_id uuid not null, location_name text not null,
  time_zone text not null check(public.faolla_attendance_valid_zone_v1(time_zone)),
  proposal jsonb not null, reason text not null, policy_revision bigint not null, deadline_at timestamptz not null,
  start_at timestamptz not null, end_at timestamptz not null, submitted_at timestamptz not null,
  primary key(merchant_id,request_id),
  foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id),
  foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id),
  foreign key(merchant_id,location_id) references public.merchant_attendance_locations(merchant_id,id),
  foreign key(merchant_id,policy_revision) references public.merchant_attendance_correction_controls(merchant_id,revision),
  check(isfinite(start_at) and isfinite(end_at) and isfinite(submitted_at) and isfinite(deadline_at)),
  check(end_at>start_at and end_at-start_at<=interval '24 hours' and end_at<=submitted_at and submitted_at<deadline_at)
);
create index attendance_missing_self_list_idx on public.merchant_attendance_missing_requests(merchant_id,employee_id,submitted_at desc,request_id desc);
create index attendance_missing_owner_list_idx on public.merchant_attendance_missing_requests(merchant_id,submitted_at desc,request_id desc);
create index attendance_missing_overlap_idx on public.merchant_attendance_missing_requests(merchant_id,worker_id,start_at,end_at);
create table public.merchant_attendance_missing_entries (
  merchant_id text not null, operation_id uuid not null, request_id uuid not null, revision smallint not null,
  action text not null, actor_auth_user_id uuid not null, command jsonb not null, recorded_at timestamptz not null,
  primary key(merchant_id,operation_id), unique(merchant_id,request_id,revision),
  foreign key(merchant_id,request_id) references public.merchant_attendance_missing_requests(merchant_id,request_id),
  check((revision=1 and action='submit' and operation_id=request_id) or (revision=2 and action in ('withdraw','approve','reject'))),
  check(isfinite(recorded_at))
);
alter table public.merchant_attendance_missing_requests add constraint attendance_missing_submit_receipt_fk
  foreign key(merchant_id,request_id) references public.merchant_attendance_missing_entries(merchant_id,operation_id) deferrable initially deferred;
alter table public.merchant_attendance_missing_requests enable row level security;
alter table public.merchant_attendance_missing_entries enable row level security;
revoke all on public.merchant_attendance_missing_requests,public.merchant_attendance_missing_entries from public,anon,authenticated,service_role;
create trigger attendance_missing_request_immutable before update or delete on public.merchant_attendance_missing_requests for each row execute function public.faolla_attendance_events_append_only_v1();
create trigger attendance_missing_request_no_truncate before truncate on public.merchant_attendance_missing_requests for each statement execute function public.faolla_attendance_events_append_only_v1();
create trigger attendance_missing_entry_immutable before update or delete on public.merchant_attendance_missing_entries for each row execute function public.faolla_attendance_events_append_only_v1();
create trigger attendance_missing_entry_no_truncate before truncate on public.merchant_attendance_missing_entries for each statement execute function public.faolla_attendance_events_append_only_v1();

create function public.faolla_attendance_missing_summary_v1(p public.merchant_attendance_missing_requests) returns jsonb
language sql set search_path=pg_catalog as $$
  select jsonb_build_object('requestId',p.request_id,'employeeId',p.employee_id,'workerName',p.worker_name,
    'startAt',to_char(p.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'endAt',to_char(p.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'submittedAt',to_char(p.submitted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'revision',case when d.operation_id is null then 1 else 2 end,
    'status',case d.action when 'withdraw' then 'withdrawn' when 'approve' then 'approved' when 'reject' then 'rejected' else 'submitted' end)
  from (select 1) one left join public.merchant_attendance_missing_entries d on d.merchant_id=p.merchant_id and d.request_id=p.request_id and d.revision=2;
$$;
revoke all on function public.faolla_attendance_missing_summary_v1(public.merchant_attendance_missing_requests) from public,anon,authenticated,service_role;

create function public.faolla_attendance_missing_review_v1(p public.merchant_attendance_missing_requests,p_actor uuid,p_owner boolean) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
  d public.merchant_attendance_missing_entries%rowtype;issues text[]:='{}';tail bigint;prior_action text;settings_rev bigint;controls_rev bigint;
  first_day date;last_day date;day date;coverage integer;token text;
begin
  select * into e from public.merchant_enterprise_employees where merchant_id=p.merchant_id and id=p.employee_id for share;
  select * into w from public.merchant_attendance_workers where merchant_id=p.merchant_id and id=p.worker_id for share;
  select * into d from public.merchant_attendance_missing_entries where merchant_id=p.merchant_id and request_id=p.request_id and revision=2;
  if w.employee_id is distinct from p.employee_id or e.auth_user_id is distinct from p.actor_auth_user_id then issues:=array_append(issues,'binding_changed');end if;
  if not coalesce(w.active,false) or e.status is distinct from 'active' then issues:=array_append(issues,'employee_inactive');end if;
  if p_owner and p.actor_auth_user_id=p_actor then issues:=array_append(issues,'self_review');end if;
  if d.operation_id is not null then issues:=array_append(issues,'terminal');end if;
  first_day:=(p.start_at at time zone p.time_zone)::date;last_day:=((p.end_at-interval '1 microsecond') at time zone p.time_zone)::date;
  if last_day-first_day not between 0 and 2 then issues:=array_append(issues,'employment_gap');
  else for day in select generate_series(first_day::timestamp,last_day::timestamp,interval '1 day')::date loop
    select count(*) into coverage from public.merchant_attendance_employment_periods where merchant_id=p.merchant_id and worker_id=p.worker_id and starts_on<=day and (ends_on is null or ends_on>=day);
    if coverage<>1 then issues:=array_append(issues,'employment_gap');exit;end if;
  end loop;end if;
  select coalesce(max(sequence),0) into tail from public.merchant_attendance_events where merchant_id=p.merchant_id and worker_id=p.worker_id;
  select action into prior_action from public.merchant_attendance_events where merchant_id=p.merchant_id and worker_id=p.worker_id and occurred_at<=p.start_at order by occurred_at desc,sequence desc limit 1;
  if (prior_action is not null and prior_action<>'clock_out') or exists(select 1 from public.merchant_attendance_events where merchant_id=p.merchant_id and worker_id=p.worker_id and occurred_at>p.start_at and occurred_at<p.end_at) then issues:=array_append(issues,'raw_overlap');end if;
  if exists(select 1 from public.merchant_attendance_effect_current_v2 where merchant_id=p.merchant_id and worker_id=p.worker_id and start_at<p.end_at and end_at>p.start_at) then issues:=array_append(issues,'effective_overlap');end if;
  if exists(select 1 from public.merchant_attendance_missing_requests x where x.merchant_id=p.merchant_id and x.worker_id=p.worker_id and x.request_id<>p.request_id and x.start_at<p.end_at and x.end_at>p.start_at
    and not exists(select 1 from public.merchant_attendance_missing_entries t where t.merchant_id=x.merchant_id and t.request_id=x.request_id and t.action in ('withdraw','reject'))) then issues:=array_append(issues,'missing_overlap');end if;
  if exists(select 1 from public.merchant_attendance_correction_periods where merchant_id=p.merchant_id and locked and start_at<p.end_at and end_at>p.start_at) then issues:=array_append(issues,'period_locked');end if;
  select version into settings_rev from public.merchant_attendance_settings where merchant_id=p.merchant_id;
  select coalesce(max(revision),0) into controls_rev from public.merchant_attendance_correction_controls where merchant_id=p.merchant_id;
  token:=md5(jsonb_build_array(p.request_id,issues,settings_rev,controls_rev,w.version,e.version,tail)::text);
  return public.faolla_attendance_missing_summary_v1(p)||jsonb_build_object('reason',p.reason,'proposal',p.proposal,'locationName',p.location_name,'timeZone',p.time_zone,
    'policyRevision',p.policy_revision,'deadlineAt',to_char(p.deadline_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'terminal',case when d.operation_id is null then null else jsonb_build_object('reason',d.command->>'reason','recordedAt',to_char(d.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) end,
    'issues',to_jsonb(issues),'evidenceToken',token,'canApprove',p_owner and cardinality(issues)=0,'canReject',p_owner and d.operation_id is null and not('self_review'=any(issues)));
end; $$;
revoke all on function public.faolla_attendance_missing_review_v1(public.merchant_attendance_missing_requests,uuid,boolean) from public,anon,authenticated,service_role;

create function public.faolla_attendance_missing_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
<<missing_call>>
declare site text;mode text;from_day date;through_day date;request_id uuid;op uuid;cursor_at timestamptz;cursor_id uuid;now_at timestamptz;can_request boolean:=false;
  s public.merchant_attendance_settings%rowtype;e public.merchant_enterprise_employees%rowtype;r public.merchant_enterprise_roles%rowtype;
  w public.merchant_attendance_workers%rowtype;l public.merchant_attendance_locations%rowtype;policy public.merchant_attendance_correction_controls%rowtype;
  target public.merchant_attendance_missing_requests%rowtype;receipt public.merchant_attendance_missing_entries%rowtype;
  detail jsonb;items jsonb;next_cursor jsonb;row_count integer;v_action text;k text;a timestamptz;b timestamptz;prev_at timestamptz;piece jsonb;pa timestamptz;pb timestamptz;
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_auth_user_id is null or p_allow_write is null or jsonb_typeof(p_query) is distinct from 'object'
    or not(p_query ?& array['siteId','access','fromDate','throughDate','requestId','operationId','beforeAt','beforeId'])
    or (select count(*) from jsonb_object_keys(p_query))<>8 then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';mode:=p_query->>'access';
  if jsonb_typeof(p_query->'siteId')<>'string' or coalesce(site,'') !~ '^\d{8}$' or coalesce(mode,'') not in ('owner','self') then raise exception 'attendance_invalid_request';end if;
  foreach k in array array['fromDate','throughDate'] loop
    if jsonb_typeof(p_query->k)<>'string' or coalesce(p_query->>k,'') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'attendance_invalid_request';end if;
  end loop;
  from_day:=(p_query->>'fromDate')::date;through_day:=(p_query->>'throughDate')::date;
  if from_day<date '2000-01-01' or through_day>date '2100-12-31' or through_day-from_day not between 0 and 30 then raise exception 'attendance_invalid_request';end if;
  foreach k in array array['requestId','operationId','beforeId'] loop
    if p_query->k<>'null'::jsonb and coalesce(p_query->>k,'') !~ uuid_pattern then raise exception 'attendance_invalid_request';end if;
  end loop;
  request_id:=(p_query->>'requestId')::uuid;op:=(p_query->>'operationId')::uuid;cursor_id:=(p_query->>'beforeId')::uuid;
  if p_query->'beforeAt'<>'null'::jsonb then
    if coalesce(p_query->>'beforeAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$' then raise exception 'attendance_invalid_request';end if;
    cursor_at:=(p_query->>'beforeAt')::timestamptz;
  end if;
  if (cursor_at is null)<>(cursor_id is null) or cursor_at is not null and (request_id is not null or op is not null) then raise exception 'attendance_invalid_request';end if;
  perform 1 from public.merchants where id=site and (mode='self' or user_id=p_auth_user_id) for share;
  if not found then raise exception 'attendance_access_denied';end if;
  if p_command is null then select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  else select * into s from public.merchant_attendance_settings where merchant_id=site for update;end if;
  if not found then raise exception 'attendance_settings_required';end if;
  if mode='self' then
    select * into e from public.merchant_enterprise_employees where merchant_id=site and auth_user_id=p_auth_user_id for share;
    if not found or e.status<>'active' then raise exception 'attendance_access_denied';end if;
    select * into r from public.merchant_enterprise_roles where merchant_id=site and id=e.role_id for share;
    if not found or r.status<>'active' or not public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions) or not('attendance.self.view'=any(r.permissions)) then raise exception 'attendance_access_denied';end if;
    select * into w from public.merchant_attendance_workers where merchant_id=site and employee_id=e.id for share;
    select * into l from public.merchant_attendance_locations where merchant_id=site and id=w.default_location_id for share;
    can_request:=coalesce(w.active and l.active and 'attendance.self.request'=any(r.permissions),false);
  end if;
  select * into policy from public.merchant_attendance_correction_controls where merchant_id=site and action='set_policy' order by revision desc limit 1;
  now_at:=clock_timestamp();
  if p_command is not null then
    if op is not null or cursor_at is not null or jsonb_typeof(p_command)<>'object'
      or not(p_command ?& array['operationId','action','reason']) or coalesce(p_command->>'operationId','') !~ uuid_pattern
      or jsonb_typeof(p_command->'reason')<>'string' or char_length(p_command->>'reason') not between 1 and 200
      or (p_command->>'reason')<>btrim(p_command->>'reason') or (p_command->>'reason') ~ '[[:cntrl:]]' then raise exception 'attendance_invalid_request';end if;
    op:=(p_command->>'operationId')::uuid;v_action:=p_command->>'action';
    if v_action='submit' then
      if mode<>'self' or request_id is not null or (select count(*) from jsonb_object_keys(p_command))<>9
        or not(p_command ?& array['expectedWorkerId','expectedSettingsVersion','expectedPolicyRevision','locationId','timeZone','proposal']) then raise exception 'attendance_invalid_request';end if;
      foreach k in array array['expectedWorkerId','locationId'] loop if coalesce(p_command->>k,'') !~ uuid_pattern then raise exception 'attendance_invalid_request';end if;end loop;
      foreach k in array array['expectedSettingsVersion','expectedPolicyRevision'] loop
        if jsonb_typeof(p_command->k)<>'number' or coalesce(p_command->>k,'') !~ '^[1-9][0-9]{0,15}$' or (p_command->>k)::numeric>9007199254740989 then raise exception 'attendance_invalid_request';end if;
      end loop;
      request_id:=op;
    elsif v_action in ('withdraw','approve','reject') then
      if request_id is null or coalesce(p_command->>'requestId','')<>request_id::text or p_command->'expectedRevision' is distinct from '1'::jsonb
        or (select count(*) from jsonb_object_keys(p_command))<>(case when v_action='withdraw' then 5 else 6 end)
        or not(p_command ?& array['requestId','expectedRevision']) or (v_action='withdraw')<>(mode='self') then raise exception 'attendance_invalid_request';end if;
      if v_action<>'withdraw' and (not(p_command ? 'evidenceToken') or coalesce(p_command->>'evidenceToken','') !~ '^[a-f0-9]{32}$') then raise exception 'attendance_invalid_request';end if;
    else raise exception 'attendance_invalid_request';end if;
  end if;
  if op is not null then
    select * into receipt from public.merchant_attendance_missing_entries t where t.merchant_id=site and t.operation_id=op;
    if receipt.operation_id is not null and (receipt.actor_auth_user_id<>p_auth_user_id or (receipt.action in ('submit','withdraw'))<>(mode='self') or request_id is not null and request_id<>receipt.request_id) then
      if p_command is not null then raise exception 'attendance_operation_conflict';end if;receipt:=null;
    end if;
    if receipt.operation_id is not null then request_id:=receipt.request_id;end if;
  end if;
  if p_command is not null and receipt.operation_id is not null and receipt.command<>p_command then raise exception 'attendance_operation_conflict';end if;
  if request_id is not null then
    select * into target from public.merchant_attendance_missing_requests t where t.merchant_id=site and t.request_id=missing_call.request_id;
    if target.request_id is null and v_action is distinct from 'submit' then raise exception 'attendance_missing_not_found';end if;
    if target.request_id is not null and mode='self' and (target.employee_id<>e.id or target.actor_auth_user_id<>p_auth_user_id) then raise exception 'attendance_access_denied';end if;
  end if;
  if p_command is not null and receipt.operation_id is null then
    if not p_allow_write and v_action<>'withdraw' then raise exception 'attendance_platform_paused';end if;
    if v_action='submit' then
      if not can_request then raise exception 'attendance_access_denied';end if;
      if (p_command->>'expectedWorkerId')::uuid<>w.id or (p_command->>'locationId')::uuid<>l.id or jsonb_typeof(p_command->'timeZone') is distinct from 'string' or p_command->>'timeZone'<>l.time_zone then raise exception 'attendance_worker_changed';end if;
      if (p_command->>'expectedSettingsVersion')::bigint<>s.version then raise exception 'attendance_version_conflict';end if;
      if policy.revision is null then raise exception 'attendance_correction_policy_required';end if;
      if (p_command->>'expectedPolicyRevision')::bigint<>policy.revision then raise exception 'attendance_correction_policy_changed';end if;
      piece:=p_command->'proposal';
      if jsonb_typeof(piece) is distinct from 'object' or (select count(*) from jsonb_object_keys(piece))<>3 or not(piece ?& array['startAt','endAt','breaks'])
        or jsonb_typeof(piece->'breaks') is distinct from 'array' or jsonb_array_length(piece->'breaks')>8 then raise exception 'attendance_invalid_request';end if;
      foreach k in array array['startAt','endAt'] loop
        if jsonb_typeof(piece->k)<>'string' or coalesce(piece->>k,'') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$'
          or to_char((piece->>k)::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')<>piece->>k then raise exception 'attendance_invalid_request';end if;
      end loop;
      a:=(piece->>'startAt')::timestamptz;b:=(piece->>'endAt')::timestamptz;
      if a>=b or b-a>interval '24 hours' or b>now_at or (a at time zone l.time_zone)::date<date '2000-01-01' or (b at time zone l.time_zone)::date>date '2100-12-31' then raise exception 'attendance_invalid_request';end if;
      prev_at:=a;
      for piece in select value from jsonb_array_elements(p_command->'proposal'->'breaks') loop
        if jsonb_typeof(piece)<>'object' or (select count(*) from jsonb_object_keys(piece))<>3 or not(piece ?& array['startAt','endAt','paid']) or jsonb_typeof(piece->'paid')<>'boolean' then raise exception 'attendance_invalid_request';end if;
        foreach k in array array['startAt','endAt'] loop
          if jsonb_typeof(piece->k)<>'string' or coalesce(piece->>k,'') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$'
            or to_char((piece->>k)::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')<>piece->>k then raise exception 'attendance_invalid_request';end if;
        end loop;
        pa:=(piece->>'startAt')::timestamptz;pb:=(piece->>'endAt')::timestamptz;
        if pa<prev_at or pb<=pa or pb>b then raise exception 'attendance_invalid_request';end if;prev_at:=pb;
      end loop;
      target.merchant_id:=site;target.request_id:=request_id;target.worker_id:=w.id;target.employee_id:=e.id;target.actor_auth_user_id:=p_auth_user_id;target.worker_name:=w.display_name;
      target.location_id:=l.id;target.location_name:=l.name;target.time_zone:=l.time_zone;target.proposal:=p_command->'proposal';target.reason:=p_command->>'reason';
      target.policy_revision:=policy.revision;target.deadline_at:=public.faolla_attendance_control_day_boundary_v1((a at time zone (policy.payload->>'timeZone'))::date+(policy.payload->>'submissionWindowDays')::integer+1,policy.payload->>'timeZone');
      target.start_at:=a;target.end_at:=b;target.submitted_at:=now_at;
      if now_at>=target.deadline_at then raise exception 'attendance_correction_window_expired';end if;
      detail:=public.faolla_attendance_missing_review_v1(target,p_auth_user_id,false);
      if detail->'issues'<>'[]'::jsonb then raise exception 'attendance_missing_conflict';end if;
      insert into public.merchant_attendance_missing_requests select (target).*;
    else
      detail:=public.faolla_attendance_missing_review_v1(target,p_auth_user_id,mode='owner');
      if detail->>'status'<>'submitted' then raise exception 'attendance_missing_closed';end if;
      if v_action<>'withdraw' then
        if p_command->>'evidenceToken'<>detail->>'evidenceToken' then raise exception 'attendance_missing_basis_changed';end if;
        if (v_action='approve' and detail->'canApprove'<>'true'::jsonb) or (v_action='reject' and detail->'canReject'<>'true'::jsonb) then raise exception 'attendance_missing_conflict';end if;
      end if;
    end if;
    insert into public.merchant_attendance_missing_entries(merchant_id,operation_id,request_id,revision,action,actor_auth_user_id,command,recorded_at)
      values(site,op,request_id,case when v_action='submit' then 1 else 2 end,v_action,p_auth_user_id,p_command,now_at) returning * into receipt;
  end if;
  if target.request_id is not null then detail:=public.faolla_attendance_missing_review_v1(target,p_auth_user_id,mode='owner');end if;
  select coalesce(jsonb_agg(t.item order by t.submitted_at desc,t.request_id desc) filter(where n<=25),'[]'::jsonb),count(*),
    (jsonb_agg(jsonb_build_object('at',to_char(t.submitted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'id',t.request_id) order by t.submitted_at desc,t.request_id desc) filter(where n<=25))->24
    into items,row_count,next_cursor from (select p.request_id,p.submitted_at,public.faolla_attendance_missing_summary_v1(p) item,row_number() over(order by p.submitted_at desc,p.request_id desc) n
      from public.merchant_attendance_missing_requests p where p.merchant_id=site and (mode='owner' or (p.employee_id=e.id and p.actor_auth_user_id=p_auth_user_id))
        and p.submitted_at>=(from_day::timestamp at time zone 'UTC') and p.submitted_at<((through_day+1)::timestamp at time zone 'UTC')
        and (cursor_at is null or (p.submitted_at,p.request_id)<(cursor_at,cursor_id)) order by p.submitted_at desc,p.request_id desc limit 26) t;
  return jsonb_build_object('siteId',site,'access',mode,'employeeId',e.id,'workerId',w.id,'locationId',l.id,'timeZone',coalesce(l.time_zone,s.time_zone),'canRequest',can_request,
    'settingsVersion',s.version,'policyRevision',coalesce(policy.revision,0),'fromDate',from_day,'throughDate',through_day,'asOf',to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'items',items,'nextCursor',case when row_count=26 then next_cursor else null end,'detail',detail,
    'receipt',case when receipt.operation_id is null then null else jsonb_build_object('operationId',receipt.operation_id,'requestId',receipt.request_id,'revision',receipt.revision,'command',receipt.command) end,
    'includedInTimesheet',false);
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_parameter_value then raise exception 'attendance_invalid_request';
end; $$;
revoke all on function public.faolla_attendance_missing_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_missing_v1(jsonb,uuid,jsonb,boolean) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610010100,'merchant_attendance_missing_requests') on conflict(version) do nothing;
commit;
