-- Owner-only, read-only coverage of one location's latest notice revision.
-- ACKs record receipt of that version, not delivery, comprehension or consent.
-- Pagination is a current roster view, not a historical personnel snapshot.
begin;
set local lock_timeout='3s';

do $notice_coverage_prerequisites$
begin
  if to_regclass('public.faolla_schema_migrations') is null
    or to_regclass('public.merchants') is null
    or to_regclass('public.merchant_attendance_settings') is null
    or to_regclass('public.merchant_attendance_locations') is null
    or to_regclass('public.merchant_attendance_workers') is null
    or to_regclass('public.merchant_enterprise_employees') is null
    or to_regclass('public.merchant_enterprise_roles') is null
    or to_regclass('public.merchant_attendance_location_notices') is null
    or to_regclass('public.merchant_attendance_location_notice_acknowledgements') is null
    or to_regprocedure('public.faolla_valid_merchant_enterprise_permissions_v1(text[])') is null then
    raise exception 'merchant_attendance_notice_coverage_prerequisite_required';
  end if;
  if not exists(select 1 from public.faolla_schema_migrations
    where version=202609300076 and name='merchant_attendance_location_notices') then
    raise exception 'merchant_attendance_notice_coverage_prerequisite_required';
  end if;
end;
$notice_coverage_prerequisites$;

create or replace function public.faolla_attendance_location_notice_coverage_v1(
  p_site_id text,p_auth_user_id uuid,p_query jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  m public.merchants%rowtype;
  s public.merchant_attendance_settings%rowtype;
  l public.merchant_attendance_locations%rowtype;
  n public.merchant_attendance_location_notices%rowtype;
  loc uuid; cursor_worker uuid; k text; fenced boolean;
  notice_current boolean; observed_at timestamptz; result jsonb;
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null
    or p_query is null or jsonb_typeof(p_query)<>'object' then
    raise exception 'attendance_invalid_request';
  end if;
  if (select count(*) from jsonb_object_keys(p_query))<>5
    or not(p_query ?& array['locationId','expectedNoticeRevision','expectedSettingsVersion','expectedLocationVersion','cursorWorkerId'])
    or jsonb_typeof(p_query->'locationId')<>'string'
    or coalesce(p_query->>'locationId','') !~ uuid_pattern
    or (p_query->'cursorWorkerId'<>'null'::jsonb and
      (jsonb_typeof(p_query->'cursorWorkerId')<>'string' or coalesce(p_query->>'cursorWorkerId','') !~ uuid_pattern)) then
    raise exception 'attendance_invalid_request';
  end if;
  fenced:=p_query->'expectedNoticeRevision'<>'null'::jsonb;
  if not fenced then
    if p_query->'expectedSettingsVersion'<>'null'::jsonb
      or p_query->'expectedLocationVersion'<>'null'::jsonb
      or p_query->'cursorWorkerId'<>'null'::jsonb then
      raise exception 'attendance_invalid_request';
    end if;
  else
    foreach k in array array['expectedNoticeRevision','expectedSettingsVersion','expectedLocationVersion'] loop
      if jsonb_typeof(p_query->k)<>'number'
        or coalesce(p_query->>k,'') !~ '^(0|[1-9][0-9]{0,15})$' then
        raise exception 'attendance_invalid_request';
      end if;
      if (p_query->>k)::numeric>(case when k='expectedNoticeRevision' then 9007199254740990 else 9007199254740991 end)
        or (k<>'expectedNoticeRevision' and (p_query->>k)::numeric=0) then
        raise exception 'attendance_invalid_request';
      end if;
    end loop;
  end if;
  loc:=(p_query->>'locationId')::uuid;
  cursor_worker:=(p_query->>'cursorWorkerId')::uuid;

  -- Same owner aliases and lock order as the existing notice RPC. Holding the
  -- settings SHARE lock also serializes publication/withdrawal, whose original
  -- writer locks this settings row FOR UPDATE. No employee or ACK is modified.
  select * into m from public.merchants where id=p_site_id for share;
  if not found or not coalesce(p_auth_user_id=any(array[
    m.user_id,m.auth_user_id,m.owner_user_id,m.owner_id,m.auth_id,m.created_by,m.created_by_user_id]),false) then
    raise exception 'attendance_access_denied';
  end if;
  select * into s from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  if not found then raise exception 'attendance_settings_required'; end if;
  select * into l from public.merchant_attendance_locations where merchant_id=p_site_id and id=loc for share;
  if not found then raise exception 'attendance_location_denied'; end if;
  select * into n from public.merchant_attendance_location_notices
    where merchant_id=p_site_id and location_id=loc order by revision desc limit 1;
  if fenced and ((p_query->>'expectedNoticeRevision')::bigint<>coalesce(n.revision,0)
    or (p_query->>'expectedSettingsVersion')::bigint<>s.version
    or (p_query->>'expectedLocationVersion')::bigint<>l.version) then
    raise exception 'attendance_version_conflict';
  end if;
  -- Match original076 notice-current semantics, not operational clock readiness.
  -- A newer unpublished draft alone does not invalidate this published notice.
  notice_current:=coalesce(n.action='publish' and l.active
    and (n.command->>'expectedSettingsVersion')::bigint=s.version
    and (n.command->>'expectedLocationVersion')::bigint=l.version,false);
  observed_at:=clock_timestamp();

  -- One MVCC statement supplies both totals and this page. Later requests may
  -- observe roster/role/binding changes even with unchanged notice fences.
  with candidates as materialized (
    select w.id as worker_id,w.worker_no,w.display_name,w.employee_id,
      case
        when not w.active then 'worker_inactive'
        when e.id is null or e.status<>'active' or e.auth_user_id is null then 'employee_unavailable'
        when r.id is null or r.status<>'active'
          or not coalesce(public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions),false)
          or not coalesce('attendance.self.view'=any(r.permissions),false) then 'role_unavailable'
        else null end as exclusion,
      a.recorded_at as acknowledged_at
    from public.merchant_attendance_workers w
    left join public.merchant_enterprise_employees e on e.merchant_id=w.merchant_id and e.id=w.employee_id
    left join public.merchant_enterprise_roles r on r.merchant_id=e.merchant_id and r.id=e.role_id
    left join public.merchant_attendance_location_notice_acknowledgements a
      on n.action='publish' and a.merchant_id=p_site_id and a.location_id=loc and a.notice_revision=n.revision
      and a.worker_id=w.id and a.employee_id=e.id and a.actor_auth_user_id=e.auth_user_id
      and a.recorded_at>=n.recorded_at
    where w.merchant_id=p_site_id and w.default_location_id=loc
  ), totals as (
    select count(*) as assigned,count(*) filter(where exclusion is null) as eligible,
      count(*) filter(where exclusion is not null) as excluded,
      case when n.action='publish' then count(*) filter(where exclusion is null and acknowledged_at is not null) else null end as confirmed,
      case when n.action='publish' then count(*) filter(where exclusion is null and acknowledged_at is null) else null end as pending
    from candidates
  ), page_window as materialized (
    select * from candidates where cursor_worker is null or worker_id>cursor_worker order by worker_id limit 51
  ), page_rows as materialized (
    select * from page_window order by worker_id limit 50
  )
  select jsonb_build_object(
    'siteId',p_site_id,
    'location',jsonb_build_object('id',l.id,'name',l.name,'active',l.active,'version',l.version),
    'settingsVersion',s.version,
    'notice',case when n.revision is null then null else jsonb_build_object('revision',n.revision,'action',n.action,
      'recordedAt',to_char(n.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) end,
    'noticeCurrent',notice_current,
    'observedAt',to_char(observed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'counts',jsonb_build_object('assigned',totals.assigned,'eligible',totals.eligible,'excluded',totals.excluded,
      'confirmed',totals.confirmed,'pending',totals.pending),
    'items',(select coalesce(jsonb_agg(jsonb_build_object('workerId',worker_id,'workerNo',worker_no,
      'displayName',display_name,'employeeId',employee_id,'eligible',exclusion is null,'exclusion',exclusion,
      'acknowledgedAt',case when acknowledged_at is null then null else to_char(acknowledged_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end)
      order by worker_id),'[]'::jsonb) from page_rows),
    'nextCursor',case when (select count(*) from page_window)>50
      then (select worker_id from page_rows order by worker_id desc limit 1) else null end
  ) into result from totals;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'attendance_invalid_request';
end;
$$;

revoke all on function public.faolla_attendance_location_notice_coverage_v1(text,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_location_notice_coverage_v1(text,uuid,jsonb) to service_role;

insert into public.faolla_schema_migrations(version,name)
values(202610030115,'merchant_attendance_location_notice_coverage') on conflict(version) do nothing;
do $notice_coverage_postconditions$
begin
  if not exists(select 1 from public.faolla_schema_migrations
    where version=202610030115 and name='merchant_attendance_location_notice_coverage') then
    raise exception 'merchant_attendance_notice_coverage_registry_postcondition_failed';
  end if;
  if not has_function_privilege('service_role','public.faolla_attendance_location_notice_coverage_v1(text,uuid,jsonb)','EXECUTE')
    or has_function_privilege('anon','public.faolla_attendance_location_notice_coverage_v1(text,uuid,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.faolla_attendance_location_notice_coverage_v1(text,uuid,jsonb)','EXECUTE') then
    raise exception 'merchant_attendance_notice_coverage_acl_postcondition_failed';
  end if;
end;
$notice_coverage_postconditions$;
notify pgrst, 'reload schema';
commit;
