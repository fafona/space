-- Unreleased candidate. Approved by user 2026-10-01: add missing revisions and
-- prevent subsequent correction approvals overlapping an approved declaration.
-- No historical row rewrite/backfill; old commands/receipts remain readable.
begin;
set local lock_timeout='3s';
alter table public.merchant_attendance_missing_requests
  add column supersedes_request_id uuid,
  add column supersedes_operation_id uuid,
  add column root_request_id uuid,
  add constraint attendance_missing_parent_fk foreign key(merchant_id,supersedes_request_id) references public.merchant_attendance_missing_requests(merchant_id,request_id),
  add constraint attendance_missing_parent_operation_fk foreign key(merchant_id,supersedes_operation_id) references public.merchant_attendance_missing_entries(merchant_id,operation_id),
  add constraint attendance_missing_root_fk foreign key(merchant_id,root_request_id) references public.merchant_attendance_missing_requests(merchant_id,request_id),
  add constraint attendance_missing_lineage_shape check(
    (supersedes_request_id is null and supersedes_operation_id is null and root_request_id is null) or
    (supersedes_request_id is not null and supersedes_operation_id is not null and root_request_id is not null and supersedes_request_id<>request_id and root_request_id<>request_id));
create index attendance_missing_parent_idx on public.merchant_attendance_missing_requests(merchant_id,supersedes_request_id) where supersedes_request_id is not null;
create index attendance_missing_root_idx on public.merchant_attendance_missing_requests(merchant_id,(coalesce(root_request_id,request_id)));

create view public.merchant_attendance_missing_current_v1 as
select r.* from public.merchant_attendance_missing_requests r
join public.merchant_attendance_missing_entries d on d.merchant_id=r.merchant_id and d.request_id=r.request_id and d.action='approve'
where not exists(select 1 from public.merchant_attendance_missing_requests child
  join public.merchant_attendance_missing_entries approved on approved.merchant_id=child.merchant_id and approved.request_id=child.request_id and approved.action='approve'
  where child.merchant_id=r.merchant_id and child.supersedes_request_id=r.request_id);
revoke all on public.merchant_attendance_missing_current_v1 from public,anon,authenticated,service_role;

create function public.faolla_attendance_missing_lineage_v1(p public.merchant_attendance_missing_requests,p_actor uuid,p_owner boolean) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare current_row public.merchant_attendance_missing_requests%rowtype;op uuid;can_revise boolean:=false;
begin
  select * into current_row from public.merchant_attendance_missing_current_v1 r where r.merchant_id=p.merchant_id
    and coalesce(r.root_request_id,r.request_id)=coalesce(p.root_request_id,p.request_id);
  select operation_id into op from public.merchant_attendance_missing_entries where merchant_id=p.merchant_id and request_id=current_row.request_id and action='approve';
  if not p_owner and p.actor_auth_user_id=p_actor and current_row.request_id=p.request_id then
    select exists(select 1 from public.merchant_attendance_workers w join public.merchant_enterprise_employees e on e.merchant_id=w.merchant_id and e.id=w.employee_id
      join public.merchant_enterprise_roles r on r.merchant_id=e.merchant_id and r.id=e.role_id
      join public.merchant_attendance_locations l on l.merchant_id=w.merchant_id and l.id=w.default_location_id
      where w.merchant_id=p.merchant_id and w.id=p.worker_id and w.active and e.id=p.employee_id and e.auth_user_id=p_actor and e.status='active'
        and r.status='active' and 'attendance.self.request'=any(r.permissions) and l.active and l.id=p.location_id and l.time_zone=p.time_zone)
      and not exists(select 1 from public.merchant_attendance_missing_requests child where child.merchant_id=p.merchant_id and child.supersedes_request_id=p.request_id
        and not exists(select 1 from public.merchant_attendance_missing_entries d where d.merchant_id=child.merchant_id and d.request_id=child.request_id and d.revision=2))
    into can_revise;
  end if;
  return jsonb_build_object('rootRequestId',coalesce(p.root_request_id,p.request_id),'supersedesRequestId',p.supersedes_request_id,
    'currentRequestId',current_row.request_id,'currentApprovalOperationId',op,'canRevise',can_revise);
end; $$;
revoke all on function public.faolla_attendance_missing_lineage_v1(public.merchant_attendance_missing_requests,uuid,boolean) from public,anon,authenticated,service_role;
create or replace function public.faolla_attendance_missing_review_v1(p public.merchant_attendance_missing_requests,p_actor uuid,p_owner boolean) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
  d public.merchant_attendance_missing_entries%rowtype;issues text[]:='{}';tail bigint;prior_action text;settings_rev bigint;controls_rev bigint;
  first_day date;last_day date;day date;coverage integer;token text;lineage jsonb;parent public.merchant_attendance_missing_requests%rowtype;
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
  if exists(select 1 from public.merchant_attendance_missing_requests x where x.merchant_id=p.merchant_id and x.worker_id=p.worker_id
    and x.request_id<>p.request_id and x.request_id is distinct from p.supersedes_request_id and x.start_at<p.end_at and x.end_at>p.start_at
    and (not exists(select 1 from public.merchant_attendance_missing_entries t where t.merchant_id=x.merchant_id and t.request_id=x.request_id and t.revision=2)
      or exists(select 1 from public.merchant_attendance_missing_current_v1 c where c.merchant_id=x.merchant_id and c.request_id=x.request_id)))
    then issues:=array_append(issues,'missing_overlap');end if;
  if p.supersedes_request_id is not null then
    select * into parent from public.merchant_attendance_missing_current_v1 c where c.merchant_id=p.merchant_id and c.request_id=p.supersedes_request_id;
    -- A decided revision is historical, not a failed pending application.
    if d.operation_id is null and (parent.request_id is null or not exists(select 1 from public.merchant_attendance_missing_entries a
      where a.merchant_id=p.merchant_id and a.request_id=parent.request_id and a.action='approve' and a.operation_id=p.supersedes_operation_id)) then issues:=array_append(issues,'revision_base_changed');end if;
    if exists(select 1 from public.merchant_attendance_missing_requests old join public.merchant_attendance_correction_periods locked
      on locked.merchant_id=old.merchant_id and locked.locked and locked.start_at<old.end_at and locked.end_at>old.start_at
      where old.merchant_id=p.merchant_id and old.request_id=p.supersedes_request_id) then issues:=array_append(issues,'revision_base_locked');end if;
  end if;
  if exists(select 1 from public.merchant_attendance_correction_periods where merchant_id=p.merchant_id and locked and start_at<p.end_at and end_at>p.start_at) then issues:=array_append(issues,'period_locked');end if;
  select version into settings_rev from public.merchant_attendance_settings where merchant_id=p.merchant_id;
  select coalesce(max(revision),0) into controls_rev from public.merchant_attendance_correction_controls where merchant_id=p.merchant_id;
  lineage:=public.faolla_attendance_missing_lineage_v1(p,p_actor,p_owner);
  token:=md5(jsonb_build_array(p.request_id,issues,settings_rev,controls_rev,w.version,e.version,tail,lineage)::text);
  return public.faolla_attendance_missing_summary_v1(p)||jsonb_build_object('reason',p.reason,'proposal',p.proposal,'locationName',p.location_name,'timeZone',p.time_zone,
    'policyRevision',p.policy_revision,'deadlineAt',to_char(p.deadline_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'terminal',case when d.operation_id is null then null else jsonb_build_object('reason',d.command->>'reason','recordedAt',to_char(d.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) end,
    'lineage',lineage,'issues',to_jsonb(issues),'evidenceToken',token,'canApprove',p_owner and cardinality(issues)=0,'canReject',p_owner and d.operation_id is null and not('self_review'=any(issues)));
end; $$;
revoke all on function public.faolla_attendance_missing_review_v1(public.merchant_attendance_missing_requests,uuid,boolean) from public,anon,authenticated,service_role;

create or replace function public.faolla_attendance_missing_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
<<missing_call>>
declare site text;mode text;from_day date;through_day date;request_id uuid;op uuid;cursor_at timestamptz;cursor_id uuid;now_at timestamptz;can_request boolean:=false;
  s public.merchant_attendance_settings%rowtype;e public.merchant_enterprise_employees%rowtype;r public.merchant_enterprise_roles%rowtype;
  w public.merchant_attendance_workers%rowtype;l public.merchant_attendance_locations%rowtype;policy public.merchant_attendance_correction_controls%rowtype;
  parent public.merchant_attendance_missing_requests%rowtype;root_start timestamptz;
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
    if v_action in ('submit','revise') then
      if mode<>'self' or request_id is not null or (select count(*) from jsonb_object_keys(p_command))<>(case when v_action='revise' then 11 else 9 end)
        or not(p_command ?& array['expectedWorkerId','expectedSettingsVersion','expectedPolicyRevision','locationId','timeZone','proposal']) then raise exception 'attendance_invalid_request';end if;
      foreach k in array array['expectedWorkerId','locationId'] loop if coalesce(p_command->>k,'') !~ uuid_pattern then raise exception 'attendance_invalid_request';end if;end loop;
      foreach k in array array['expectedSettingsVersion','expectedPolicyRevision'] loop
        if jsonb_typeof(p_command->k)<>'number' or coalesce(p_command->>k,'') !~ '^[1-9][0-9]{0,15}$' or (p_command->>k)::numeric>9007199254740989 then raise exception 'attendance_invalid_request';end if;
      end loop;
      if v_action='revise' and (coalesce(p_command->>'supersedesRequestId','') !~ uuid_pattern or coalesce(p_command->>'expectedApprovalOperationId','') !~ uuid_pattern) then raise exception 'attendance_invalid_request';end if;
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
    if target.request_id is null and coalesce(v_action,'') not in ('submit','revise') then raise exception 'attendance_missing_not_found';end if;
    if target.request_id is not null and mode='self' and (target.employee_id<>e.id or target.actor_auth_user_id<>p_auth_user_id) then raise exception 'attendance_access_denied';end if;
  end if;
  if p_command is not null and receipt.operation_id is null then
    if not p_allow_write and v_action<>'withdraw' then raise exception 'attendance_platform_paused';end if;
    if v_action in ('submit','revise') then
      if not can_request then raise exception 'attendance_access_denied';end if;
      if (p_command->>'expectedWorkerId')::uuid<>w.id or (p_command->>'locationId')::uuid<>l.id or jsonb_typeof(p_command->'timeZone') is distinct from 'string' or p_command->>'timeZone'<>l.time_zone then raise exception 'attendance_worker_changed';end if;
      if (p_command->>'expectedSettingsVersion')::bigint<>s.version then raise exception 'attendance_version_conflict';end if;
      if policy.revision is null then raise exception 'attendance_correction_policy_required';end if;
      if (p_command->>'expectedPolicyRevision')::bigint<>policy.revision then raise exception 'attendance_correction_policy_changed';end if;
      if v_action='revise' then
        select * into parent from public.merchant_attendance_missing_current_v1 c where c.merchant_id=site and c.request_id=(p_command->>'supersedesRequestId')::uuid;
        if parent.request_id is null then raise exception 'attendance_missing_revision_stale';end if;
        if parent.worker_id<>w.id or parent.employee_id<>e.id or parent.actor_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;
        if parent.location_id<>l.id or parent.time_zone<>l.time_zone then raise exception 'attendance_worker_changed';end if;
        if not exists(select 1 from public.merchant_attendance_missing_entries d where d.merchant_id=site and d.request_id=parent.request_id
          and d.action='approve' and d.operation_id=(p_command->>'expectedApprovalOperationId')::uuid and d.recorded_at<now_at) then raise exception 'attendance_missing_revision_stale';end if;
        if exists(select 1 from public.merchant_attendance_missing_requests child where child.merchant_id=site and child.supersedes_request_id=parent.request_id
          and not exists(select 1 from public.merchant_attendance_missing_entries d where d.merchant_id=site and d.request_id=child.request_id and d.revision=2))
          then raise exception 'attendance_missing_revision_pending';end if;
        if parent.proposal=p_command->'proposal' then raise exception 'attendance_missing_revision_unchanged';end if;
        target.supersedes_request_id:=parent.request_id;target.supersedes_operation_id:=(p_command->>'expectedApprovalOperationId')::uuid;
        target.root_request_id:=coalesce(parent.root_request_id,parent.request_id);
      end if;
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
      if v_action='revise' then
        select root_row.start_at into root_start from public.merchant_attendance_missing_requests root_row where root_row.merchant_id=site and root_row.request_id=target.root_request_id;
        target.deadline_at:=least(target.deadline_at,public.faolla_attendance_control_day_boundary_v1((root_start at time zone (policy.payload->>'timeZone'))::date+(policy.payload->>'submissionWindowDays')::integer+1,policy.payload->>'timeZone'));
      end if;
      target.start_at:=a;target.end_at:=b;target.submitted_at:=now_at;
      if now_at>=target.deadline_at then raise exception 'attendance_correction_window_expired';end if;
      detail:=public.faolla_attendance_missing_review_v1(target,p_auth_user_id,false);
      if detail->'issues'<>'[]'::jsonb then raise exception 'attendance_missing_conflict';end if;
      insert into public.merchant_attendance_missing_requests select (target).*;
    else
      detail:=public.faolla_attendance_missing_review_v1(target,p_auth_user_id,mode='owner');
      if detail->>'status'<>'submitted' then raise exception 'attendance_missing_closed';end if;
      if target.supersedes_request_id is not null and now_at<target.submitted_at then raise exception 'attendance_missing_basis_changed';end if;
      if v_action<>'withdraw' then
        if p_command->>'evidenceToken'<>detail->>'evidenceToken' then raise exception 'attendance_missing_basis_changed';end if;
        if (v_action='approve' and detail->'canApprove'<>'true'::jsonb) or (v_action='reject' and detail->'canReject'<>'true'::jsonb) then raise exception 'attendance_missing_conflict';end if;
      end if;
    end if;
    insert into public.merchant_attendance_missing_entries(merchant_id,operation_id,request_id,revision,action,actor_auth_user_id,command,recorded_at)
      values(site,op,request_id,case when v_action in ('submit','revise') then 1 else 2 end,case when v_action='revise' then 'submit' else v_action end,p_auth_user_id,p_command,now_at) returning * into receipt;
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
create or replace function public.faolla_attendance_unified_report_v1(p_site_id text,p_auth_user_id uuid,p_query jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare mode text;base jsonb;result jsonb;items jsonb:='[]';worker uuid;viewer uuid;location uuid;
  from_at timestamptz;to_at timestamptz;as_of timestamptz;expires timestamptz;row_count integer;
  p public.merchant_attendance_missing_requests%rowtype;decision public.merchant_attendance_missing_entries%rowtype;
  prior_action text;
begin
  if p_query is null or jsonb_typeof(p_query)<>'object' or not(p_query ? 'access') then raise exception 'attendance_invalid_request';end if;
  mode:=p_query->>'access';
  -- Delegate original-source collection AND authorization to the unchanged exact
  -- owner/self/scoped protocol, not to an impersonated owner or JS post-filter.
  if mode='owner' then
    base:=public.faolla_attendance_period_report_v2(p_site_id,p_auth_user_id,p_query-'access');
  elsif mode in ('self','manager') then
    base:=public.faolla_attendance_scoped_period_report_v2(p_site_id,p_auth_user_id,p_query);
  else raise exception 'attendance_invalid_request';end if;
  worker:=(base->>'workerId')::uuid;viewer:=(base->>'viewerEmployeeId')::uuid;location:=(base->>'locationId')::uuid;
  from_at:=(base->>'fromAt')::timestamptz;to_at:=(base->>'toAt')::timestamptz;as_of:=(base->>'asOf')::timestamptz;expires:=(base->>'accessValidUntil')::timestamptz;
  -- Original reader retains owner/settings/role/scope/worker locks until this
  -- enclosing transaction ends. Missing decisions take the settings UPDATE lock.
  row_count:=jsonb_array_length(base->'items');
  for p in select r.* from public.merchant_attendance_missing_current_v1 r
    join public.merchant_attendance_missing_entries d on d.merchant_id=r.merchant_id and d.request_id=r.request_id and d.action='approve' and d.revision=2
    where r.merchant_id=p_site_id and r.worker_id=worker and r.start_at>=from_at-interval '24 hours' and r.start_at<to_at and r.end_at>from_at
      and (mode='owner' or mode='self' and r.employee_id=viewer and r.actor_auth_user_id=p_auth_user_id or mode='manager' and r.location_id=location)
    order by r.start_at,r.request_id limit 101
  loop
    row_count:=row_count+1;if row_count>100 then raise exception 'attendance_report_too_large';end if;
    select * into decision from public.merchant_attendance_missing_entries d where d.merchant_id=p.merchant_id and d.request_id=p.request_id and d.revision=2;
    if p.submitted_at>as_of or decision.recorded_at>as_of or decision.action<>'approve' then raise exception 'attendance_report_invalid_data';end if;
    -- Historical approval stays valid after offboarding/location deactivation or
    -- later period locks. Only conflicting time sources block this read. Never
    -- silently drop a conflicting approved declaration or count it twice.
    select action into prior_action from public.merchant_attendance_events where merchant_id=p.merchant_id and worker_id=p.worker_id and occurred_at<=p.start_at order by occurred_at desc,sequence desc limit 1;
    if (prior_action is not null and prior_action<>'clock_out') or exists(select 1 from public.merchant_attendance_events where merchant_id=p.merchant_id and worker_id=p.worker_id and occurred_at>p.start_at and occurred_at<p.end_at)
      or exists(select 1 from public.merchant_attendance_effect_current_v2 where merchant_id=p.merchant_id and worker_id=p.worker_id and start_at<p.end_at and end_at>p.start_at)
      or exists(select 1 from public.merchant_attendance_missing_current_v1 other join public.merchant_attendance_missing_entries d on d.merchant_id=other.merchant_id and d.request_id=other.request_id and d.action='approve' and d.revision=2
        where other.merchant_id=p.merchant_id and other.worker_id=p.worker_id and other.request_id<>p.request_id and other.start_at<p.end_at and other.end_at>p.start_at)
      then raise exception 'attendance_report_reconciliation_required';end if;
    items:=items||jsonb_build_array(jsonb_build_object('source','missing-approved','requestId',p.request_id,'operationId',decision.operation_id,'workerId',p.worker_id,
      'employeeId',case when mode='self' then p.employee_id else null end,'workerName',p.worker_name,'locationId',p.location_id,'locationName',p.location_name,
      'timeZone',p.time_zone,'policyRevision',p.policy_revision,'proposal',p.proposal,
      'submittedAt',to_char(p.submitted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'approvedAt',to_char(decision.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  end loop;
  result:=jsonb_build_object('version','attendance-unified-v1','access',mode,'base',base,'missing',items,'complete',true,'payrollReady',false);
  if octet_length(result::text)>1048576 then raise exception 'attendance_report_too_large';end if;
  -- A short manager grant may expire while collecting evidence. No stale grant.
  if expires is not null and clock_timestamp()>=expires then raise exception 'attendance_access_denied';end if;
  return result;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end; $$;
revoke all on function public.faolla_attendance_unified_report_v1(text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_unified_report_v1(text,uuid,jsonb) to service_role;
create or replace function public.faolla_attendance_decision_checks_v2(p_site text,r jsonb) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare a jsonb:=r->'application';e jsonb:=r->'evidence';issues text[]:='{}';x text;
  from_at timestamptz;to_at timestamptz;zone text;first_day date;last_day date;day date;
  left_at timestamptz;right_at timestamptz;n integer;coverage integer;effective public.merchant_attendance_effect_current_v2%rowtype;
  controls_revision bigint;tail_id uuid;effect_id uuid;token text;can_reject boolean;
begin
  if a->'item'->>'status'<>'submitted' then issues:=array_append(issues,'withdrawn');end if;
  if exists(select 1 from public.merchant_attendance_correction_decisions where merchant_id=p_site and request_id=(r->'item'->>'requestId')::uuid) then issues:=array_append(issues,'already_decided');end if;
  if e->'bindingCurrent'<>'true'::jsonb then issues:=array_append(issues,'binding_changed');end if;
  if e->'ownApplication'='true'::jsonb then issues:=array_append(issues,'self_review');end if;
  can_reject:=cardinality(issues)=0;
  if e->'currentBasis'='null'::jsonb then issues:=array_append(issues,'basis_unavailable');
  else
    if e->'currentBasis'->'events'<>a->'basis'->'events' then issues:=array_append(issues,'basis_changed');end if;
    if e->'currentBasis'->'events'->-1->>'action'<>'clock_out' then issues:=array_append(issues,'open_session');end if;
    if e->'previous'<>'null'::jsonb and (a->'proposal'->>'startAt')::timestamptz<(e->'previous'->>'occurredAt')::timestamptz then issues:=array_append(issues,'overlap_previous');end if;
    if e->'next'<>'null'::jsonb and (a->'proposal'->>'endAt')::timestamptz>(e->'next'->>'occurredAt')::timestamptz then issues:=array_append(issues,'overlap_next');end if;
  end if;
  for x in select jsonb_array_elements_text(a->'rules'->'issues') loop issues:=array_append(issues,'rule_'||x);end loop;
  from_at:=(a->'proposal'->>'startAt')::timestamptz;to_at:=(a->'proposal'->>'endAt')::timestamptz;zone:=a->'basis'->'events'->0->>'timeZone';
  first_day:=(from_at at time zone zone)::date;last_day:=((to_at-interval '1 microsecond') at time zone zone)::date;
  if first_day<date '2000-01-01' or last_day>date '2100-12-31' or last_day-first_day not between 0 and 32 then issues:=array_append(issues,'declaration_range');
  elsif e->'employmentTruncated'='true'::jsonb then issues:=array_append(issues,'employment_limit');
  else
    for n in 0..(last_day-first_day) loop
      day:=first_day+n;left_at:=public.faolla_attendance_control_day_boundary_v1(day,zone);right_at:=public.faolla_attendance_control_day_boundary_v1(day+1,zone);
      -- Skip nonexistent local dates and include only actual half-open proposal coverage.
      if right_at>left_at and left_at<to_at and right_at>from_at then
        select count(*) into coverage from jsonb_array_elements(e->'employmentPeriods') p where (p->>'startsOn')::date<=day and (p->'endsOn'='null'::jsonb or (p->>'endsOn')::date>=day);
        if coverage=0 and not('employment_gap'=any(issues)) then issues:=array_append(issues,'employment_gap');end if;
        if coverage>1 and not('employment_ambiguous'=any(issues)) then issues:=array_append(issues,'employment_ambiguous');end if;
      end if;
    end loop;
  end if;
  if exists(select 1 from public.merchant_attendance_effect_current_v2 where merchant_id=p_site and worker_id=(r->'item'->>'workerId')::uuid and start_event_id=(r->'item'->>'startEventId')::uuid) then issues:=array_append(issues,'already_effective');end if;
  -- Latest effective spans are nonoverlapping under the same settings UPDATE lock.
  select * into effective from public.merchant_attendance_effect_current_v2 where merchant_id=p_site and worker_id=(r->'item'->>'workerId')::uuid
    and start_at<to_at order by start_at desc limit 1;
  if effective.request_id is not null and effective.end_at>from_at then issues:=array_append(issues,'effective_overlap');end if;
  if exists(select 1 from public.merchant_attendance_missing_current_v1 m where m.merchant_id=p_site and m.worker_id=(r->'item'->>'workerId')::uuid
    and m.start_at<to_at and m.end_at>from_at) then issues:=array_append(issues,'missing_overlap');end if;
  select coalesce(max(revision),0) into controls_revision from public.merchant_attendance_correction_controls where merchant_id=p_site;
  select id into tail_id from public.merchant_attendance_events where merchant_id=p_site and worker_id=(r->'item'->>'workerId')::uuid order by sequence desc limit 1;
  select operation_id into effect_id from public.merchant_attendance_effect_current_v2 where merchant_id=p_site and worker_id=(r->'item'->>'workerId')::uuid order by recorded_at desc,operation_id desc limit 1;
  -- Optimistic comparison only, NOT a capability or authorization token. Recheck all conditions on every write.
  token:=md5(jsonb_build_object('item',r->'item','original',a->'basis'->'events','current',e->'currentBasis'->'events',
    'evidence',e-'currentBasis','rules',(a->'rules')-'checkedAt','controlsRevision',controls_revision,'tailId',tail_id,'effectId',effect_id)::text);
  token:=md5(jsonb_build_array(token,issues)::text);
  return jsonb_build_object('evidenceToken',token,'blockers',to_jsonb(issues),'canApprove',cardinality(issues)=0,'canReject',can_reject);
end; $$;
revoke all on function public.faolla_attendance_decision_checks_v2(text,jsonb) from public,anon,authenticated,service_role;

create or replace function public.faolla_attendance_revision_review_checks_v2(p_site text,r jsonb,p_base_start uuid) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare a jsonb:=r->'application';e jsonb:=r->'evidence';issues text[]:='{}';x text;can_reject boolean;
  from_at timestamptz;to_at timestamptz;zone text;first_day date;last_day date;day date;left_at timestamptz;right_at timestamptz;n integer;coverage integer;
  other_effect public.merchant_attendance_effect_current_v2%rowtype;controls_revision bigint;tail_id uuid;effect_id uuid;token text;
begin
  if a->'item'->>'status'<>'submitted' then issues:=array_append(issues,'withdrawn');end if;
  if e->'bindingCurrent'<>'true'::jsonb then issues:=array_append(issues,'binding_changed');end if;
  if e->'ownApplication'='true'::jsonb then issues:=array_append(issues,'self_review');end if;
  can_reject:=cardinality(issues)=0;
  if e->'currentBasis'='null'::jsonb then issues:=array_append(issues,'basis_unavailable');
  else
    if e->'currentBasis'->'events'<>a->'basis'->'events' then issues:=array_append(issues,'basis_changed');end if;
    if e->'currentBasis'->'events'->-1->>'action'<>'clock_out' then issues:=array_append(issues,'open_session');end if;
    if e->'previous'<>'null'::jsonb and (a->'proposal'->>'startAt')::timestamptz<(e->'previous'->>'occurredAt')::timestamptz then issues:=array_append(issues,'overlap_previous');end if;
    if e->'next'<>'null'::jsonb and (a->'proposal'->>'endAt')::timestamptz>(e->'next'->>'occurredAt')::timestamptz then issues:=array_append(issues,'overlap_next');end if;
  end if;
  for x in select jsonb_array_elements_text(a->'rules'->'issues') loop issues:=array_append(issues,'rule_'||x);end loop;
  from_at:=(a->'proposal'->>'startAt')::timestamptz;to_at:=(a->'proposal'->>'endAt')::timestamptz;zone:=a->'basis'->'events'->0->>'timeZone';
  first_day:=(from_at at time zone zone)::date;last_day:=((to_at-interval '1 microsecond') at time zone zone)::date;
  if first_day<date '2000-01-01' or last_day>date '2100-12-31' or last_day-first_day not between 0 and 32 then issues:=array_append(issues,'declaration_range');
  elsif e->'employmentTruncated'='true'::jsonb then issues:=array_append(issues,'employment_limit');
  else
    for n in 0..(last_day-first_day) loop
      day:=first_day+n;left_at:=public.faolla_attendance_control_day_boundary_v1(day,zone);right_at:=public.faolla_attendance_control_day_boundary_v1(day+1,zone);
      if right_at>left_at and left_at<to_at and right_at>from_at then
        select count(*) into coverage from jsonb_array_elements(e->'employmentPeriods') p where (p->>'startsOn')::date<=day and (p->'endsOn'='null'::jsonb or (p->>'endsOn')::date>=day);
        if coverage=0 and not('employment_gap'=any(issues)) then issues:=array_append(issues,'employment_gap');end if;
        if coverage>1 and not('employment_ambiguous'=any(issues)) then issues:=array_append(issues,'employment_ambiguous');end if;
      end if;
    end loop;
  end if;
  -- Current effective spans are mutually nonoverlapping under settings UPDATE lock.
  -- Exclude only this shift's old approval, then test the nearest other start.
  select * into other_effect from public.merchant_attendance_effect_current_v2 where merchant_id=p_site and worker_id=(r->'item'->>'workerId')::uuid
    and start_event_id<>p_base_start and start_at<to_at order by start_at desc limit 1;
  if other_effect.request_id is not null and other_effect.end_at>from_at then issues:=array_append(issues,'effective_overlap');end if;
  if exists(select 1 from public.merchant_attendance_missing_current_v1 m where m.merchant_id=p_site and m.worker_id=(r->'item'->>'workerId')::uuid
    and m.start_at<to_at and m.end_at>from_at) then issues:=array_append(issues,'missing_overlap');end if;
  select coalesce(max(revision),0) into controls_revision from public.merchant_attendance_correction_controls where merchant_id=p_site;
  select id into tail_id from public.merchant_attendance_events where merchant_id=p_site and worker_id=(r->'item'->>'workerId')::uuid order by sequence desc limit 1;
  select operation_id into effect_id from public.merchant_attendance_effect_current_v2 where merchant_id=p_site and worker_id=(r->'item'->>'workerId')::uuid order by recorded_at desc,operation_id desc limit 1;
  token:=md5(jsonb_build_object('item',r->'item','original',a->'basis'->'events','current',e->'currentBasis'->'events',
    'evidence',e-'currentBasis','rules',(a->'rules')-'checkedAt','controlsRevision',controls_revision,'tailId',tail_id,'effectId',effect_id)::text);
  token:=md5(jsonb_build_array(token,issues)::text);
  return jsonb_build_object('evidenceToken',token,'blockers',to_jsonb(issues),'canReject',can_reject);
end; $$;
revoke all on function public.faolla_attendance_revision_review_checks_v2(text,jsonb,uuid) from public,anon,authenticated,service_role;


-- Storage guard covers old approved-correction writers too; applications keep
-- existing error vocabulary. Settings lock serializes both approval directions.
create function public.faolla_attendance_missing_effect_guard_v1() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  perform 1 from public.merchant_attendance_settings where merchant_id=new.merchant_id for update;
  if not found then raise exception 'attendance_settings_required';end if;
  if exists(select 1 from public.merchant_attendance_missing_current_v1 m where m.merchant_id=new.merchant_id and m.worker_id=new.worker_id
    and m.start_at<new.end_at and m.end_at>new.start_at) then raise exception 'attendance_correction_decision_blocked';end if;
  return new;
end; $$;
revoke all on function public.faolla_attendance_missing_effect_guard_v1() from public,anon,authenticated,service_role;
create trigger attendance_correction_missing_guard after insert on public.merchant_attendance_correction_effects
  for each row execute function public.faolla_attendance_missing_effect_guard_v1();
create trigger attendance_revision_missing_guard after insert on public.merchant_attendance_effect_versions
  for each row execute function public.faolla_attendance_missing_effect_guard_v1();
insert into public.faolla_schema_migrations(version,name) values(202610010103,'merchant_attendance_missing_revisions') on conflict(version) do nothing;
commit;
