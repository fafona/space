-- Independent correction-rule/period-lock configuration. No approval or raw-time changes.
begin;
set local lock_timeout='3s';
create table public.merchant_attendance_correction_controls (
  merchant_id text not null references public.merchant_attendance_settings(merchant_id) on delete restrict,
  revision bigint not null check(revision between 1 and 9007199254740990),
  operation_id uuid not null, actor_auth_user_id uuid not null,
  action text not null check(action in ('set_policy','lock_period','unlock_period')),
  reason text not null check(char_length(reason) between 1 and 500),
  command jsonb not null check(jsonb_typeof(command)='object'),
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  recorded_at timestamptz not null check(isfinite(recorded_at)),
  primary key(merchant_id,revision),unique(merchant_id,operation_id)
);
create index attendance_correction_policy_idx on public.merchant_attendance_correction_controls(merchant_id,recorded_at desc,revision desc) where action='set_policy';
create table public.merchant_attendance_correction_periods (
  merchant_id text not null,period_id uuid not null,last_revision bigint not null,
  from_date date not null,through_date date not null,time_zone text not null,
  start_at timestamptz not null,end_at timestamptz not null,locked boolean not null,
  primary key(merchant_id,period_id),
  foreign key(merchant_id,last_revision) references public.merchant_attendance_correction_controls(merchant_id,revision) on delete restrict,
  check(from_date>=date '2000-01-01' and through_date<=date '2100-12-31' and through_date>=from_date and through_date-from_date<366),
  check(isfinite(start_at) and isfinite(end_at) and start_at<end_at)
);
create index attendance_correction_locked_period_idx on public.merchant_attendance_correction_periods(merchant_id,start_at) where locked;
alter table public.merchant_attendance_correction_controls enable row level security;
alter table public.merchant_attendance_correction_periods enable row level security;
revoke all on public.merchant_attendance_correction_controls,public.merchant_attendance_correction_periods from public,anon,authenticated,service_role;
create trigger attendance_correction_controls_no_rewrite before update or delete on public.merchant_attendance_correction_controls
  for each row execute function public.faolla_attendance_events_append_only_v1();
create trigger attendance_correction_controls_no_truncate before truncate on public.merchant_attendance_correction_controls
  for each statement execute function public.faolla_attendance_events_append_only_v1();

-- Match the browser's first-instant-of-local-date arithmetic, including midnight DST and skipped dates.
create function public.faolla_attendance_control_day_boundary_v1(p_date date,p_zone text) returns timestamptz
language plpgsql stable set search_path=pg_catalog as $$
declare lo bigint;hi bigint;mid bigint;begin
  if p_date is null or p_zone is null or not exists(select 1 from pg_timezone_names where name=p_zone) then raise exception 'attendance_invalid_time_zone';end if;
  lo:=(extract(epoch from p_date::timestamp at time zone 'UTC')*1000)::bigint-129600000;hi:=lo+259200000;
  while lo<hi loop
    mid:=lo+(hi-lo)/2;
    if (to_timestamp(mid::double precision/1000) at time zone p_zone)::date<p_date then lo:=mid+1;else hi:=mid;end if;
  end loop;
  return to_timestamp(lo::double precision/1000);
end; $$;
revoke all on function public.faolla_attendance_control_day_boundary_v1(date,text) from public,anon,authenticated,service_role;

create function public.faolla_attendance_control_entry_v1(p public.merchant_attendance_correction_controls) returns jsonb
language sql immutable set search_path=pg_catalog as $$
  select case when p.revision is null then null else jsonb_build_object('revision',p.revision,'operationId',p.operation_id,'action',p.action,
    'recordedAt',to_char(p.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'reason',p.reason,'values',p.payload) end;
$$;
revoke all on function public.faolla_attendance_control_entry_v1(public.merchant_attendance_correction_controls) from public,anon,authenticated,service_role;

create function public.faolla_attendance_correction_controls_v1(p_site_id text,p_auth_user_id uuid,p_command jsonb default null,
  p_operation_id uuid default null,p_before_revision bigint default null,p_allow_write boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare s public.merchant_attendance_settings%rowtype;head public.merchant_attendance_correction_controls%rowtype;
  receipt public.merchant_attendance_correction_controls%rowtype;policy public.merchant_attendance_correction_controls%rowtype;
  period public.merchant_attendance_correction_periods%rowtype;op uuid;v_action text;payload jsonb;now_at timestamptz;
  first_day date;last_day date;from_at timestamptz;to_at timestamptz;k text;expected bigint;entries jsonb;periods jsonb;next_before bigint;row_count integer;
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_allow_write is null
    or (p_before_revision is not null and (p_before_revision<1 or p_before_revision>9007199254740989)) then raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
    if p_operation_id is not null or p_before_revision is not null or jsonb_typeof(p_command)<>'object' then raise exception 'attendance_invalid_request';end if;
    v_action:=p_command->>'action';
    if coalesce(v_action,'') not in ('set_policy','lock_period','unlock_period') or coalesce(p_command->>'operationId','') !~ uuid_pattern
      or not(p_command ?& array['action','operationId','expectedRevision','expectedSettingsVersion','reason'])
      or (select count(*) from jsonb_object_keys(p_command))<>(case when v_action='lock_period' then 7 else 6 end) then raise exception 'attendance_invalid_request';end if;
    foreach k in array array['expectedRevision','expectedSettingsVersion'] loop
      if jsonb_typeof(p_command->k)<>'number' or coalesce(p_command->>k,'') !~ '^(0|[1-9][0-9]{0,15})$' then raise exception 'attendance_invalid_request';end if;
      if (p_command->>k)::numeric>9007199254740989 or (k='expectedSettingsVersion' and (p_command->>k)::numeric<1) then raise exception 'attendance_invalid_request';end if;
    end loop;
    if jsonb_typeof(p_command->'reason')<>'string' or char_length(btrim(p_command->>'reason')) not between 1 and 500
      or (p_command->>'reason')<>btrim(p_command->>'reason') or (p_command->>'reason') ~ '[[:cntrl:]]' then raise exception 'attendance_invalid_request';end if;
    if v_action='set_policy' then
      if not(p_command ? 'submissionWindowDays') or jsonb_typeof(p_command->'submissionWindowDays')<>'number'
        or coalesce(p_command->>'submissionWindowDays','') !~ '^(0|[1-9][0-9]{0,2})$' or (p_command->>'submissionWindowDays')::int>365 then raise exception 'attendance_invalid_request';end if;
    elsif v_action='lock_period' then
      if not(p_command ?& array['fromDate','throughDate']) or jsonb_typeof(p_command->'fromDate')<>'string' or jsonb_typeof(p_command->'throughDate')<>'string'
        or (p_command->>'fromDate') !~ '^\d{4}-\d{2}-\d{2}$' or (p_command->>'throughDate') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'attendance_invalid_request';end if;
      first_day:=(p_command->>'fromDate')::date;last_day:=(p_command->>'throughDate')::date;
      if first_day<date '2000-01-01' or last_day>date '2100-12-31' or first_day>last_day or last_day-first_day>=366 then raise exception 'attendance_invalid_request';end if;
    elsif not(p_command ? 'periodId') or coalesce(p_command->>'periodId','') !~ uuid_pattern then raise exception 'attendance_invalid_request';end if;
    op:=(p_command->>'operationId')::uuid;
  end if;
  perform 1 from public.merchants where id=p_site_id and user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  if p_command is null then select * into s from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  else select * into s from public.merchant_attendance_settings where merchant_id=p_site_id for update;end if;
  if not found then raise exception 'attendance_settings_required';end if;
  select * into head from public.merchant_attendance_correction_controls where merchant_id=p_site_id order by revision desc limit 1;
  select * into receipt from public.merchant_attendance_correction_controls where merchant_id=p_site_id and operation_id=coalesce(op,p_operation_id);
  if receipt.revision is not null and receipt.actor_auth_user_id<>p_auth_user_id then
    if p_command is not null then raise exception 'attendance_operation_conflict';end if;receipt:=null;
  end if;
  now_at:=clock_timestamp();
  if p_command is not null then
    if receipt.revision is not null then
      if receipt.command<>p_command then raise exception 'attendance_operation_conflict';end if;
    else
      if not p_allow_write then raise exception 'attendance_platform_paused';end if;
      if (p_command->>'expectedRevision')::bigint<>coalesce(head.revision,0) or (p_command->>'expectedSettingsVersion')::bigint<>s.version
        or head.recorded_at>=now_at then raise exception 'attendance_version_conflict';end if;
      expected:=coalesce(head.revision,0)+1;
      if v_action='set_policy' then payload:=jsonb_build_object('submissionWindowDays',p_command->'submissionWindowDays','timeZone',s.time_zone);
      elsif v_action='lock_period' then
        from_at:=public.faolla_attendance_control_day_boundary_v1(first_day,s.time_zone);
        to_at:=public.faolla_attendance_control_day_boundary_v1(last_day+1,s.time_zone);
        if (from_at at time zone s.time_zone)::date<>first_day or
          (public.faolla_attendance_control_day_boundary_v1(last_day,s.time_zone) at time zone s.time_zone)::date<>last_day
          or from_at>=to_at then raise exception 'attendance_local_date_does_not_exist';end if;
        if to_at>now_at then raise exception 'attendance_period_future';end if;
        if exists(select 1 from public.merchant_attendance_correction_periods where merchant_id=p_site_id and locked and start_at<to_at and end_at>from_at) then raise exception 'attendance_period_overlap';end if;
        if (select count(*) from (select 1 from public.merchant_attendance_correction_periods where merchant_id=p_site_id and locked limit 200) bounded)>=200 then raise exception 'attendance_period_limit';end if;
        payload:=jsonb_build_object('periodId',op,'fromDate',first_day,'throughDate',last_day,'timeZone',s.time_zone,
          'startAt',to_char(from_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'endAt',to_char(to_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
      else
        select * into period from public.merchant_attendance_correction_periods where merchant_id=p_site_id and period_id=(p_command->>'periodId')::uuid and locked;
        if not found then raise exception 'attendance_period_not_locked';end if;
        payload:=jsonb_build_object('periodId',period.period_id,'fromDate',period.from_date,'throughDate',period.through_date,'timeZone',period.time_zone,
          'startAt',to_char(period.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'endAt',to_char(period.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
      end if;
      insert into public.merchant_attendance_correction_controls(merchant_id,revision,operation_id,actor_auth_user_id,action,reason,command,payload,recorded_at)
        values(p_site_id,expected,op,p_auth_user_id,v_action,p_command->>'reason',p_command,payload,now_at) returning * into receipt;head:=receipt;
      if v_action='lock_period' then
        insert into public.merchant_attendance_correction_periods(merchant_id,period_id,last_revision,from_date,through_date,time_zone,start_at,end_at,locked)
          values(p_site_id,op,expected,first_day,last_day,s.time_zone,from_at,to_at,true);
      elsif v_action='unlock_period' then update public.merchant_attendance_correction_periods set locked=false,last_revision=expected where merchant_id=p_site_id and period_id=period.period_id;end if;
    end if;
  end if;
  select * into policy from public.merchant_attendance_correction_controls where merchant_id=p_site_id and action='set_policy' order by recorded_at desc,revision desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('periodId',p.period_id,'revision',p.last_revision,'fromDate',p.from_date,'throughDate',p.through_date,'timeZone',p.time_zone,
    'startAt',to_char(p.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'endAt',to_char(p.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) order by p.start_at),'[]'::jsonb),count(*)
    into periods,row_count from (select * from public.merchant_attendance_correction_periods where merchant_id=p_site_id and locked order by start_at limit 201) p;
  if row_count>200 then raise exception 'attendance_period_limit';end if;
  select coalesce(jsonb_agg(public.faolla_attendance_control_entry_v1(page.t) order by (page.t).revision desc) filter(where rn<=25),'[]'::jsonb),
    case when count(*)=26 then min((page.t).revision) filter(where rn<=25) else null end into entries,next_before
    from (select c as t,row_number() over(order by c.revision desc) rn from public.merchant_attendance_correction_controls c where merchant_id=p_site_id
      and (p_before_revision is null or revision<p_before_revision) order by revision desc limit 26) page;
  return jsonb_build_object('siteId',p_site_id,'asOf',to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'controlsOnly',true,'approvalAvailable',false,'rulesEnforced',false,'revision',coalesce(head.revision,0),'settingsVersion',s.version,'timeZone',s.time_zone,
    'policy',public.faolla_attendance_control_entry_v1(policy),'activePeriods',periods,'entries',entries,'nextBeforeRevision',next_before,
    'receipt',public.faolla_attendance_control_entry_v1(receipt));
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
  when datetime_field_overflow then raise exception 'attendance_invalid_date';
end; $$;
revoke all on function public.faolla_attendance_correction_controls_v1(text,uuid,jsonb,uuid,bigint,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_correction_controls_v1(text,uuid,jsonb,uuid,bigint,boolean) to service_role;

-- Internal precheck for the future decision transaction. Never a reusable approval token.
-- Caller must still authenticate, validate the full immutable application/basis, and check effective revisions.
create function public.faolla_attendance_correction_control_check_v1(p_site text,p_original_start timestamptz,p_original_end timestamptz,
  p_proposed_start timestamptz,p_proposed_end timestamptz,p_submitted_at timestamptz) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare policy public.merchant_attendance_correction_controls%rowtype;deadline timestamptz;anchor date;issues text[]:='{}';periods jsonb;
begin
  if p_site is null or p_site !~ '^\d{8}$' or p_original_start is null or p_proposed_start is null or p_proposed_end is null or p_submitted_at is null
    or not isfinite(p_original_start) or not isfinite(p_proposed_start) or not isfinite(p_proposed_end) or not isfinite(p_submitted_at)
    or p_proposed_end<=p_proposed_start or p_submitted_at<p_original_start or p_proposed_end>p_submitted_at
    or (p_original_end is not null and (not isfinite(p_original_end) or p_original_end<p_original_start)) then raise exception 'attendance_invalid_request';end if;
  perform 1 from public.merchant_attendance_settings where merchant_id=p_site for share;
  if not found then raise exception 'attendance_settings_required';end if;
  select * into policy from public.merchant_attendance_correction_controls where merchant_id=p_site and action='set_policy' and recorded_at<=p_submitted_at order by recorded_at desc,revision desc limit 1;
  if policy.revision is null then issues:=array_append(issues,'policy_missing_at_submission');
  else
    anchor:=(p_original_start at time zone (policy.payload->>'timeZone'))::date;
    if anchor<date '2000-01-01' or anchor>date '2100-12-31' then issues:=array_append(issues,'unsupported_declaration');
    else
      deadline:=public.faolla_attendance_control_day_boundary_v1(anchor+(policy.payload->>'submissionWindowDays')::integer+1,policy.payload->>'timeZone');
      if p_submitted_at>=deadline then issues:=array_append(issues,'submission_window_expired');end if;
    end if;
  end if;
  if p_original_end is null then issues:=array_append(issues,'original_session_open');end if;
  select coalesce(jsonb_agg(period_id order by start_at),'[]'::jsonb) into periods from (select period_id,start_at
    from public.merchant_attendance_correction_periods where merchant_id=p_site and locked and
      ((start_at<p_proposed_end and end_at>p_proposed_start) or
       (p_original_end is not null and start_at<p_original_end and end_at>p_original_start) or
       ((p_original_end is null or p_original_end=p_original_start) and start_at<=p_original_start and end_at>p_original_start))
    order by start_at limit 201) matches;
  if jsonb_array_length(periods)>200 then issues:=array_append(issues,'period_limit');periods:='[]'::jsonb;
  elsif jsonb_array_length(periods)>0 then issues:=array_append(issues,'period_locked');end if;
  return jsonb_build_object('approvalAvailable',false,'policyRevision',policy.revision,
    'deadlineAt',case when deadline is null then null else to_char(deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
    'issues',to_jsonb(issues),'lockedPeriodIds',periods);
end; $$;
revoke all on function public.faolla_attendance_correction_control_check_v1(text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz) from public,anon,authenticated,service_role;
insert into public.faolla_schema_migrations(version,name) values(202609300084,'merchant_attendance_correction_controls') on conflict(version) do nothing;
commit;
