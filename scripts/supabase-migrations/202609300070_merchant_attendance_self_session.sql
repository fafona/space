-- One self-owned clock-in segment, read-only. No events, roles or settings changed.
begin;
set local lock_timeout='3s';
create function public.faolla_attendance_self_session_v1(p_site_id text,p_auth_user_id uuid,p_start_event_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_employee public.merchant_enterprise_employees%rowtype;v_role public.merchant_enterprise_roles%rowtype;
  v_worker public.merchant_attendance_workers%rowtype;v_start public.merchant_attendance_events%rowtype;
  v_rows jsonb;v_now timestamptz;v_end_sequence bigint;
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_start_event_id is null then raise exception 'attendance_invalid_request';end if;
  perform 1 from public.merchants where id=p_site_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  perform 1 from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  if not found then raise exception 'attendance_settings_required';end if;
  select * into v_employee from public.merchant_enterprise_employees where merchant_id=p_site_id and auth_user_id=p_auth_user_id for share;
  if not found or v_employee.status<>'active' then raise exception 'attendance_access_denied';end if;
  select * into v_role from public.merchant_enterprise_roles where merchant_id=p_site_id and id=v_employee.role_id for share;
  if not found or v_role.status<>'active' or not public.faolla_valid_merchant_enterprise_permissions_v1(v_role.permissions)
    or not ('attendance.self.view'=any(v_role.permissions)) then raise exception 'attendance_access_denied';end if;
  select * into v_worker from public.merchant_attendance_workers where merchant_id=p_site_id and employee_id=v_employee.id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  -- Do not accept an employee/worker identity from the caller. Stops concurrent
  -- punches via the shared worker lock; rechecks current binding even for history.
  select * into v_start from public.merchant_attendance_events
    where merchant_id=p_site_id and worker_id=v_worker.id and id=p_start_event_id and action='clock_in';
  if not found then raise exception 'attendance_session_not_found';end if;
  if v_start.sequence>1 and not exists(select 1 from public.merchant_attendance_events
    where merchant_id=p_site_id and worker_id=v_worker.id and sequence=v_start.sequence-1 and action='clock_out')
    then raise exception 'attendance_session_invalid_records';end if;
  v_now:=clock_timestamp();
  -- Bound BOTH the endpoint search and event projection using the existing
  -- (merchant_id,worker_id,sequence) index. No unbounded count or JSON append loop.
  select sequence into v_end_sequence from (
    select sequence,action from public.merchant_attendance_events
    where merchant_id=p_site_id and worker_id=v_worker.id and sequence>=v_start.sequence order by sequence limit 2003
  ) segment where action='clock_out' order by sequence limit 1;
  select jsonb_agg(jsonb_build_object('id',e.id,'locationId',e.location_id,'sequence',e.sequence,'action',e.action,
      'occurredAt',to_char(e.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'timeZone',e.time_zone,'breakPaid',e.break_paid,'source',e.source) order by e.sequence) into v_rows from (
    select id,location_id,sequence,action,occurred_at,time_zone,break_paid,source from public.merchant_attendance_events
    where merchant_id=p_site_id and worker_id=v_worker.id and sequence>=v_start.sequence
      and (v_end_sequence is null or sequence<=v_end_sequence) order by sequence limit 2003
  ) e;
  if jsonb_array_length(v_rows)>2002 then raise exception 'attendance_session_too_large';end if;
  return jsonb_build_object('siteId',p_site_id,'employeeId',v_employee.id,'workerId',v_worker.id,
    'asOf',to_char(v_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'events',v_rows);
end; $$;
revoke all on function public.faolla_attendance_self_session_v1(text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_self_session_v1(text,uuid,uuid) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202609300070,'merchant_attendance_self_session') on conflict(version) do nothing;
commit;
