-- Versioned employee-visible notices, NOT activation of location collection.
begin;
set local lock_timeout='3s';
create table public.merchant_attendance_location_notices (
  merchant_id text not null,
  location_id uuid not null,
  revision bigint not null check(revision between 1 and 9007199254740990),
  action text not null check(action in ('publish','withdraw')),
  draft_revision bigint,
  operation_id uuid not null,
  actor_auth_user_id uuid not null,
  command jsonb not null check(jsonb_typeof(command)='object'),
  template_version integer not null default 1 check(template_version=1),
  recorded_at timestamptz not null check(isfinite(recorded_at)),
  primary key(merchant_id,location_id,revision), unique(merchant_id,operation_id),
  foreign key(merchant_id,location_id) references public.merchant_attendance_locations(merchant_id,id) on delete restrict,
  foreign key(merchant_id,location_id,draft_revision) references public.merchant_attendance_location_policy_drafts(merchant_id,location_id,revision) on delete restrict,
  check((action='publish' and draft_revision is not null) or (action='withdraw' and draft_revision is null))
);
create table public.merchant_attendance_location_notice_acknowledgements (
  merchant_id text not null,
  location_id uuid not null,
  notice_revision bigint not null,
  employee_id uuid not null,
  worker_id uuid not null,
  operation_id uuid not null,
  actor_auth_user_id uuid not null,
  command jsonb not null check(jsonb_typeof(command)='object'),
  recorded_at timestamptz not null check(isfinite(recorded_at)),
  primary key(merchant_id,employee_id,worker_id,location_id,notice_revision), unique(merchant_id,operation_id),
  foreign key(merchant_id,location_id,notice_revision) references public.merchant_attendance_location_notices(merchant_id,location_id,revision) on delete restrict,
  foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id) on delete restrict,
  foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id) on delete restrict
);
alter table public.merchant_attendance_location_notices enable row level security;
alter table public.merchant_attendance_location_notice_acknowledgements enable row level security;
revoke all on public.merchant_attendance_location_notices,public.merchant_attendance_location_notice_acknowledgements from public,anon,authenticated,service_role;
create trigger merchant_attendance_location_notices_no_rewrite before update or delete on public.merchant_attendance_location_notices
  for each row execute function public.faolla_attendance_events_append_only_v1();
create trigger merchant_attendance_location_notices_no_truncate before truncate on public.merchant_attendance_location_notices
  for each statement execute function public.faolla_attendance_events_append_only_v1();
create trigger merchant_attendance_location_ack_no_rewrite before update or delete on public.merchant_attendance_location_notice_acknowledgements
  for each row execute function public.faolla_attendance_events_append_only_v1();
create trigger merchant_attendance_location_ack_no_truncate before truncate on public.merchant_attendance_location_notice_acknowledgements
  for each statement execute function public.faolla_attendance_events_append_only_v1();

create function public.faolla_attendance_location_notice_v1(p_site_id text,p_auth_user_id uuid,p_query jsonb,p_command jsonb default null,p_allow_publish boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  m public.merchants%rowtype; s public.merchant_attendance_settings%rowtype; l public.merchant_attendance_locations%rowtype;
  emp public.merchant_enterprise_employees%rowtype; role_row public.merchant_enterprise_roles%rowtype; w public.merchant_attendance_workers%rowtype;
  draft public.merchant_attendance_location_policy_drafts%rowtype; published_draft public.merchant_attendance_location_policy_drafts%rowtype;
  latest public.merchant_attendance_location_notices%rowtype; owner_receipt public.merchant_attendance_location_notices%rowtype;
  ack_receipt public.merchant_attendance_location_notice_acknowledgements%rowtype;
  a text; act text; loc uuid; expected_worker uuid; op uuid; k text; now_at timestamptz; ack_at timestamptz;
  current_json jsonb; draft_json jsonb; receipt_json jsonb; notice_current boolean:=false; can_publish boolean:=false;
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_allow_publish is null or p_query is null or jsonb_typeof(p_query)<>'object'
    then raise exception 'attendance_invalid_request'; end if;
  if (select count(*) from jsonb_object_keys(p_query))<>4 or not(p_query ?& array['access','locationId','expectedWorkerId','operationId'])
    or coalesce(p_query->>'access','') not in ('owner','self') or coalesce(p_query->>'locationId','') !~ uuid_pattern
    or (p_query->'operationId'<>'null'::jsonb and coalesce(p_query->>'operationId','') !~ uuid_pattern)
    then raise exception 'attendance_invalid_request'; end if;
  a:=p_query->>'access';loc:=(p_query->>'locationId')::uuid;op:=(p_query->>'operationId')::uuid;
  if (a='owner' and p_query->'expectedWorkerId'<>'null'::jsonb) or (a='self' and coalesce(p_query->>'expectedWorkerId','') !~ uuid_pattern)
    then raise exception 'attendance_invalid_request'; end if;
  expected_worker:=(p_query->>'expectedWorkerId')::uuid;
  if p_command is not null then
    if jsonb_typeof(p_command)<>'object' or op is not null then raise exception 'attendance_invalid_request'; end if;
    act:=p_command->>'action';
    if (a='self' and (act is distinct from 'acknowledge' or (select count(*) from jsonb_object_keys(p_command))<>3
        or not(p_command ?& array['action','operationId','expectedRevision'])))
      or (a='owner' and (coalesce(act,'') not in ('publish','withdraw') or (select count(*) from jsonb_object_keys(p_command))<>7
        or not(p_command ?& array['action','operationId','expectedRevision','draftRevision','expectedSettingsVersion','expectedLocationVersion','reason'])))
      or coalesce(p_command->>'operationId','') !~ uuid_pattern then raise exception 'attendance_invalid_request'; end if;
    foreach k in array case when a='owner' then array['expectedRevision','expectedSettingsVersion','expectedLocationVersion'] else array['expectedRevision'] end loop
      if jsonb_typeof(p_command->k)<>'number' or coalesce(p_command->>k,'') !~ '^(0|[1-9][0-9]{0,15})$'
        or (p_command->>k)::numeric>(case when a='self' then 9007199254740990 else 9007199254740989 end) or (k<>'expectedRevision' and (p_command->>k)::numeric=0)
        or (a='self' and (p_command->>k)::numeric=0) then raise exception 'attendance_invalid_request'; end if;
    end loop;
    if a='owner' then
      if jsonb_typeof(p_command->'reason')<>'string' or char_length(btrim(p_command->>'reason')) not between 1 and 240
        or p_command->>'reason'<>btrim(p_command->>'reason') or p_command->>'reason' ~ '[[:cntrl:]]'
        or (act='withdraw' and p_command->'draftRevision'<>'null'::jsonb)
        or (act='publish' and (jsonb_typeof(p_command->'draftRevision')<>'number' or coalesce(p_command->>'draftRevision','') !~ '^[1-9][0-9]{0,15}$'
          or (p_command->>'draftRevision')::numeric>9007199254740990)) then raise exception 'attendance_invalid_request'; end if;
    end if;
    op:=(p_command->>'operationId')::uuid;
  end if;
  select * into m from public.merchants where id=p_site_id for share;
  if not found then raise exception 'attendance_access_denied'; end if;
  if a='owner' and not coalesce(p_auth_user_id=any(array[m.user_id,m.auth_user_id,m.owner_user_id,m.owner_id,m.auth_id,m.created_by,m.created_by_user_id]),false)
    then raise exception 'attendance_access_denied'; end if;
  -- Owner publication serializes with draft saves/config changes and self ACKs.
  if a='owner' and p_command is not null then select * into s from public.merchant_attendance_settings where merchant_id=p_site_id for update;
  else select * into s from public.merchant_attendance_settings where merchant_id=p_site_id for share; end if;
  if not found then raise exception 'attendance_settings_required'; end if;
  if a='self' then
    select * into emp from public.merchant_enterprise_employees where merchant_id=p_site_id and auth_user_id=p_auth_user_id for share;
    if not found or emp.status<>'active' then raise exception 'attendance_access_denied'; end if;
    select * into role_row from public.merchant_enterprise_roles where merchant_id=p_site_id and id=emp.role_id for share;
    if not found or role_row.status<>'active' or not public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions)
      or not('attendance.self.view'=any(role_row.permissions)) then raise exception 'attendance_access_denied'; end if;
    if p_command is null then select * into w from public.merchant_attendance_workers where merchant_id=p_site_id and employee_id=emp.id for share;
    else select * into w from public.merchant_attendance_workers where merchant_id=p_site_id and employee_id=emp.id for update; end if;
    if not found then raise exception 'attendance_access_denied'; end if;
    if w.id<>expected_worker then raise exception 'attendance_worker_changed'; end if;
    if w.default_location_id is distinct from loc then raise exception 'attendance_location_denied'; end if;
  end if;
  select * into l from public.merchant_attendance_locations where merchant_id=p_site_id and id=loc for share;
  if not found then raise exception 'attendance_location_denied'; end if;
  select * into latest from public.merchant_attendance_location_notices where merchant_id=p_site_id and location_id=loc order by revision desc limit 1;
  select * into draft from public.merchant_attendance_location_policy_drafts where merchant_id=p_site_id and location_id=loc order by revision desc limit 1;
  if a='owner' then
    select * into owner_receipt from public.merchant_attendance_location_notices where merchant_id=p_site_id and operation_id=op;
    if owner_receipt.revision is not null and (owner_receipt.location_id<>loc or owner_receipt.actor_auth_user_id<>p_auth_user_id) then
      if p_command is not null then raise exception 'attendance_operation_conflict'; end if; owner_receipt:=null;
    end if;
    if p_command is not null then
      if owner_receipt.revision is not null then
        if owner_receipt.command<>p_command then raise exception 'attendance_operation_conflict'; end if;
      else
        if coalesce(latest.revision,0)<>(p_command->>'expectedRevision')::bigint then raise exception 'attendance_version_conflict'; end if;
        if act='publish' then
          if not p_allow_publish then raise exception 'attendance_platform_paused'; end if;
          if not l.active then raise exception 'attendance_location_denied'; end if;
          if draft.revision is null or draft.revision<>(p_command->>'draftRevision')::bigint
            or s.version<>(p_command->>'expectedSettingsVersion')::bigint or l.version<>(p_command->>'expectedLocationVersion')::bigint
            or s.version<>(draft.command->>'expectedSettingsVersion')::bigint or l.version<>(draft.command->>'expectedLocationVersion')::bigint
            then raise exception 'attendance_version_conflict'; end if;
          if latest.action='publish' and latest.draft_revision=draft.revision then raise exception 'attendance_notice_unchanged'; end if;
        elsif latest.action is distinct from 'publish' then raise exception 'attendance_notice_unavailable'; end if;
        now_at:=greatest(clock_timestamp(),latest.recorded_at,draft.recorded_at);
        begin
          insert into public.merchant_attendance_location_notices(merchant_id,location_id,revision,action,draft_revision,operation_id,actor_auth_user_id,command,recorded_at)
            values(p_site_id,loc,coalesce(latest.revision,0)+1,act,(p_command->>'draftRevision')::bigint,op,p_auth_user_id,p_command,now_at) returning * into owner_receipt;
        exception when unique_violation then raise exception 'attendance_operation_conflict'; end;
        latest:=owner_receipt;
      end if;
    end if;
  end if;
  notice_current:=coalesce(latest.action='publish' and l.active and (latest.command->>'expectedSettingsVersion')::bigint=s.version
    and (latest.command->>'expectedLocationVersion')::bigint=l.version,false);
  if a='self' then
    select * into ack_receipt from public.merchant_attendance_location_notice_acknowledgements where merchant_id=p_site_id and operation_id=op;
    if ack_receipt.operation_id is not null and (ack_receipt.location_id<>loc or ack_receipt.employee_id<>emp.id or ack_receipt.worker_id<>w.id or ack_receipt.actor_auth_user_id<>p_auth_user_id) then
      if p_command is not null then raise exception 'attendance_operation_conflict'; end if; ack_receipt:=null;
    end if;
    if p_command is not null then
      if ack_receipt.operation_id is not null then
        if ack_receipt.command<>p_command then raise exception 'attendance_operation_conflict'; end if;
      else
        if not notice_current or not w.active then raise exception 'attendance_notice_unavailable'; end if;
        if latest.revision<>(p_command->>'expectedRevision')::bigint then raise exception 'attendance_version_conflict'; end if;
        if exists(select 1 from public.merchant_attendance_location_notice_acknowledgements where merchant_id=p_site_id and employee_id=emp.id
          and worker_id=w.id and location_id=loc and notice_revision=latest.revision) then raise exception 'attendance_notice_already_acknowledged'; end if;
        begin
          insert into public.merchant_attendance_location_notice_acknowledgements(merchant_id,location_id,notice_revision,employee_id,worker_id,operation_id,actor_auth_user_id,command,recorded_at)
            values(p_site_id,loc,latest.revision,emp.id,w.id,op,p_auth_user_id,p_command,greatest(clock_timestamp(),latest.recorded_at)) returning * into ack_receipt;
        exception when unique_violation then raise exception 'attendance_operation_conflict'; end;
      end if;
    end if;
    if latest.action='publish' then select recorded_at into ack_at from public.merchant_attendance_location_notice_acknowledgements
      where merchant_id=p_site_id and employee_id=emp.id and worker_id=w.id and location_id=loc and notice_revision=latest.revision; end if;
    if ack_receipt.operation_id is not null then receipt_json:=jsonb_build_object('operationId',ack_receipt.operation_id,'action','acknowledge',
      'revision',ack_receipt.notice_revision,'draftRevision',null,'reason',null,'recordedAt',to_char(ack_receipt.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')); end if;
  else
    if owner_receipt.revision is not null then receipt_json:=jsonb_build_object('operationId',owner_receipt.operation_id,'action',owner_receipt.action,
      'revision',owner_receipt.revision,'draftRevision',owner_receipt.draft_revision,'reason',owner_receipt.command->'reason',
      'recordedAt',to_char(owner_receipt.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')); end if;
    if draft.revision is not null then draft_json:=jsonb_build_object('revision',draft.revision,'values',draft.command->'values'); end if;
    can_publish:=coalesce(p_allow_publish and l.active and draft.revision is not null
      and (draft.command->>'expectedSettingsVersion')::bigint=s.version and (draft.command->>'expectedLocationVersion')::bigint=l.version
      and not(latest.action='publish' and latest.draft_revision=draft.revision),false);
    -- NULL latest is the ordinary first publication case.
    if latest.revision is null then can_publish:=coalesce(p_allow_publish and l.active and draft.revision is not null
      and (draft.command->>'expectedSettingsVersion')::bigint=s.version and (draft.command->>'expectedLocationVersion')::bigint=l.version,false); end if;
  end if;
  if latest.revision is not null then
    if latest.action='publish' then select * into published_draft from public.merchant_attendance_location_policy_drafts where merchant_id=p_site_id and location_id=loc and revision=latest.draft_revision; end if;
    current_json:=jsonb_build_object('revision',latest.revision,'action',latest.action,'draftRevision',latest.draft_revision,'templateVersion',latest.template_version,
      'recordedAt',to_char(latest.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'reason',latest.command->'reason',
      'values',case when latest.action='publish' then (published_draft.command->'values')-'latitude'-'longitude' else null end);
  end if;
  return jsonb_build_object('siteId',p_site_id,'access',a,'employeeId',emp.id,'workerId',w.id,'operationalChanged',false,
    'location',jsonb_build_object('id',loc,'name',l.name,'active',l.active,'version',l.version),'settingsVersion',s.version,
    'current',current_json,'draft',draft_json,'noticeCurrent',notice_current,'canPublish',can_publish,
    'canWithdraw',a='owner' and coalesce(latest.action='publish',false),'canAcknowledge',a='self' and notice_current and coalesce(w.active,false) and ack_at is null,
    'acknowledgedAt',case when ack_at is null then null else to_char(ack_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,'receipt',receipt_json);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end; $$;
revoke all on function public.faolla_attendance_location_notice_v1(text,uuid,jsonb,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_location_notice_v1(text,uuid,jsonb,jsonb,boolean) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202609300076,'merchant_attendance_location_notices') on conflict(version) do nothing;
commit;
