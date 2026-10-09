-- Unreleased diagnostic channel only. Never issues a punch/evidence token.
begin;
set local lock_timeout = '3s';
alter table public.merchant_attendance_settings
  add column location_check_enabled boolean not null default false;

-- Raw device coordinates never reach this RPC or an attendance table.
create function public.faolla_attendance_location_policy_v1(
  p_site_id text,p_auth_user_id uuid,p_expected_worker_id uuid,p_expected_location_id uuid,p_expected_versions jsonb default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_settings public.merchant_attendance_settings%rowtype;
  v_employee public.merchant_enterprise_employees%rowtype; v_role public.merchant_enterprise_roles%rowtype;
  v_worker public.merchant_attendance_workers%rowtype; v_location public.merchant_attendance_locations%rowtype;
  v_now timestamptz; v_date date; v_key text;
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_expected_worker_id is null or p_expected_location_id is null
    then raise exception 'attendance_invalid_request'; end if;
  if p_expected_versions is not null then
    if jsonb_typeof(p_expected_versions)<>'object' then raise exception 'attendance_invalid_request'; end if;
    if (select count(*) from jsonb_object_keys(p_expected_versions))<>3
      or not(p_expected_versions ?& array['settingsVersion','workerVersion','locationVersion']) then raise exception 'attendance_invalid_request'; end if;
    foreach v_key in array array['settingsVersion','workerVersion','locationVersion'] loop
      if jsonb_typeof(p_expected_versions->v_key)<>'number' or coalesce(p_expected_versions->>v_key,'') !~ '^[1-9][0-9]{0,15}$'
        then raise exception 'attendance_invalid_request'; end if;
      if (p_expected_versions->>v_key)::numeric>9007199254740991 then raise exception 'attendance_invalid_request'; end if;
    end loop;
  end if;
  perform 1 from public.merchants where id=p_site_id for share;
  if not found then raise exception 'attendance_access_denied'; end if;
  select * into v_settings from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  if not found or not v_settings.enabled then raise exception 'attendance_disabled'; end if;
  if not v_settings.location_check_enabled then raise exception 'attendance_location_check_disabled'; end if;
  if not v_settings.web_clock_enabled then raise exception 'attendance_web_disabled'; end if;
  select * into v_employee from public.merchant_enterprise_employees where merchant_id=p_site_id and auth_user_id=p_auth_user_id for share;
  if not found or v_employee.status<>'active' then raise exception 'attendance_access_denied'; end if;
  select * into v_role from public.merchant_enterprise_roles where merchant_id=p_site_id and id=v_employee.role_id for share;
  if not found or v_role.status<>'active' or not public.faolla_valid_merchant_enterprise_permissions_v1(v_role.permissions)
    or not('attendance.self.view'=any(v_role.permissions)) or not('attendance.self.clock'=any(v_role.permissions))
    then raise exception 'attendance_access_denied'; end if;
  select * into v_worker from public.merchant_attendance_workers where merchant_id=p_site_id and employee_id=v_employee.id for share;
  if not found or not v_worker.active then raise exception 'attendance_access_denied'; end if;
  if v_worker.id<>p_expected_worker_id then raise exception 'attendance_worker_changed'; end if;
  if v_worker.default_location_id is distinct from p_expected_location_id then raise exception 'attendance_location_denied'; end if;
  select * into v_location from public.merchant_attendance_locations where merchant_id=p_site_id and id=v_worker.default_location_id for share;
  if not found or not v_location.active then raise exception 'attendance_location_denied'; end if;
  if v_location.radius_meters is null then raise exception 'attendance_location_not_configured'; end if;
  if p_expected_versions is not null and (
    (p_expected_versions->>'settingsVersion')::bigint<>v_settings.version or
    (p_expected_versions->>'workerVersion')::bigint<>v_worker.version or
    (p_expected_versions->>'locationVersion')::bigint<>v_location.version) then raise exception 'attendance_location_policy_changed'; end if;
  v_now:=date_trunc('milliseconds',clock_timestamp());
  v_date:=(v_now at time zone v_settings.time_zone)::date;
  if (select count(*) from public.merchant_attendance_employment_periods where merchant_id=p_site_id and worker_id=v_worker.id
    and starts_on<=v_date and (ends_on is null or ends_on>=v_date))<>1 then raise exception 'attendance_not_employed'; end if;
  return jsonb_build_object('siteId',p_site_id,'employeeId',v_employee.id,'workerId',v_worker.id,'locationId',v_location.id,
    'settingsVersion',v_settings.version,'workerVersion',v_worker.version,'locationVersion',v_location.version,
    'checkedAt',to_char(v_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'maxAgeMs',60000,'diagnosticOnly',true,'punchRecorded',false,
    'fence',jsonb_build_object('latitude',v_location.latitude,'longitude',v_location.longitude,'radiusMeters',v_location.radius_meters,'maxAgeMs',60000));
end; $$;
revoke all on function public.faolla_attendance_location_policy_v1(text,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_location_policy_v1(text,uuid,uuid,uuid,jsonb) to service_role;
comment on function public.faolla_attendance_location_policy_v1(text,uuid,uuid,uuid,jsonb) is
  'Server-only policy read for an unreleased location diagnostic. Rechecks current password-authenticated self identity supplied by API. No evidence, receipt or punch authorization token; future punch RPC must revalidate atomically.';
insert into public.faolla_schema_migrations(version,name) values(202609300071,'merchant_attendance_location_precheck') on conflict(version) do nothing;
commit;
