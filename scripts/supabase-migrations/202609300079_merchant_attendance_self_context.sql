-- Unreleased, read-only discovery for the default-off employee location workspace.
-- Pausing punches does not hide the path to an already-open shift's safe finish.
begin;
set local lock_timeout='3s';
create function public.faolla_attendance_self_context_v1(p_site_id text,p_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  e public.merchant_enterprise_employees%rowtype;
  r public.merchant_enterprise_roles%rowtype;
  w public.merchant_attendance_workers%rowtype;
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null then raise exception 'attendance_invalid_request'; end if;
  perform 1 from public.merchants where id=p_site_id for share;
  if not found then raise exception 'attendance_access_denied'; end if;
  perform 1 from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  if not found then raise exception 'attendance_disabled'; end if;
  select * into e from public.merchant_enterprise_employees where merchant_id=p_site_id and auth_user_id=p_auth_user_id for share;
  if not found or e.status<>'active' then raise exception 'attendance_access_denied'; end if;
  select * into r from public.merchant_enterprise_roles where merchant_id=p_site_id and id=e.role_id for share;
  if not found or r.status<>'active' or not public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions)
    or not('attendance.self.view'=any(r.permissions)) then raise exception 'attendance_access_denied'; end if;
  select * into w from public.merchant_attendance_workers where merchant_id=p_site_id and employee_id=e.id for share;
  if not found then raise exception 'attendance_access_denied'; end if;
  -- IDs are routing hints, never authorization or evidence that punching is enabled.
  -- Each downstream RPC revalidates current membership, role and worker binding.
  return jsonb_build_object('siteId',p_site_id,'employeeId',e.id,'workerId',w.id,'locationId',w.default_location_id);
end; $$;
revoke all on function public.faolla_attendance_self_context_v1(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_self_context_v1(text,uuid) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202609300079,'merchant_attendance_self_context') on conflict(version) do nothing;
commit;
