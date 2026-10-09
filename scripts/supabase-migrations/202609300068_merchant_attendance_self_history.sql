-- Bounded self history. Read-only; no role, employee or event backfill.
begin;
set local lock_timeout = '3s';
create function public.faolla_attendance_self_history_v1(p_site_id text,p_auth_user_id uuid,p_query jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_employee public.merchant_enterprise_employees%rowtype; v_role public.merchant_enterprise_roles%rowtype;
  v_worker public.merchant_attendance_workers%rowtype;
  v_from timestamptz; v_to timestamptz; v_now timestamptz; v_as_of timestamptz; v_cursor_at timestamptz; v_cursor_id uuid;
  v_rows jsonb; v_next jsonb:='null'::jsonb;
  v_uuid text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_query is null or jsonb_typeof(p_query)<>'object'
    then raise exception 'attendance_invalid_request'; end if;
  if (select count(*) from jsonb_object_keys(p_query))<>6
    or not(p_query ?& array['fromAt','toAt','expectedWorkerId','asOf','cursorAt','cursorId'])
    then raise exception 'attendance_invalid_request'; end if;
  v_from:=public.faolla_attendance_instant_v1(p_query->>'fromAt'); v_to:=public.faolla_attendance_instant_v1(p_query->>'toAt');
  if v_to<=v_from or v_to-v_from>interval '31 days' then raise exception 'attendance_invalid_request'; end if;
  if (p_query->'expectedWorkerId'<>'null'::jsonb and coalesce(p_query->>'expectedWorkerId','') !~ v_uuid)
    or (p_query->'cursorId'<>'null'::jsonb and coalesce(p_query->>'cursorId','') !~ v_uuid)
    or ((p_query->'cursorId'='null'::jsonb)<>(p_query->'cursorAt'='null'::jsonb))
    or (p_query->'cursorId'<>'null'::jsonb and (p_query->'asOf'='null'::jsonb or p_query->'expectedWorkerId'='null'::jsonb))
    then raise exception 'attendance_invalid_request'; end if;
  v_cursor_id:=(p_query->>'cursorId')::uuid;
  if v_cursor_id is not null then v_cursor_at:=public.faolla_attendance_instant_v1(p_query->>'cursorAt'); end if;
  -- Match the existing authorization lock order. History does not require a
  -- current work interval, enabled worker/location or an enabled punch channel.
  perform 1 from public.merchants where id=p_site_id for share;
  if not found then raise exception 'attendance_access_denied'; end if;
  perform 1 from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  if not found then raise exception 'attendance_settings_required'; end if;
  select * into v_employee from public.merchant_enterprise_employees
    where merchant_id=p_site_id and auth_user_id=p_auth_user_id for share;
  if not found or v_employee.status<>'active' then raise exception 'attendance_access_denied'; end if;
  select * into v_role from public.merchant_enterprise_roles where merchant_id=p_site_id and id=v_employee.role_id for share;
  if not found or v_role.status<>'active' or not public.faolla_valid_merchant_enterprise_permissions_v1(v_role.permissions)
    or not ('attendance.self.view'=any(v_role.permissions)) then raise exception 'attendance_access_denied'; end if;
  select * into v_worker from public.merchant_attendance_workers where merchant_id=p_site_id and employee_id=v_employee.id for share;
  if not found then raise exception 'attendance_access_denied'; end if;
  -- A precondition for continuity, never the target identity lookup.
  if p_query->'expectedWorkerId'<>'null'::jsonb and v_worker.id<>(p_query->>'expectedWorkerId')::uuid
    then raise exception 'attendance_worker_changed'; end if;
  v_now:=clock_timestamp();
  v_as_of:=case when p_query->'asOf'='null'::jsonb then v_now else public.faolla_attendance_instant_v1(p_query->>'asOf') end;
  if v_as_of>v_now or (v_cursor_id is not null and (v_cursor_at<v_from or v_cursor_at>=least(v_to,v_as_of)))
    then raise exception 'attendance_invalid_request'; end if;
  select coalesce(jsonb_agg(j order by occurred_at desc,id desc),'[]'::jsonb) into v_rows from (
    select e.id,e.occurred_at,jsonb_build_object('id',e.id,'workerId',e.worker_id,'locationId',e.location_id,
      'workerName',v_worker.display_name,'workerNo',v_worker.worker_no,'locationName',l.name,
      'sequence',e.sequence,'action',e.action,'source',e.source,'timeZone',e.time_zone,'breakPaid',e.break_paid,
      'occurredAt',to_char(e.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) j
    from public.merchant_attendance_events e
    join public.merchant_attendance_locations l on l.merchant_id=e.merchant_id and l.id=e.location_id
    where e.merchant_id=p_site_id and e.worker_id=v_worker.id and e.occurred_at>=v_from and e.occurred_at<least(v_to,v_as_of)
      and (v_cursor_id is null or (e.occurred_at,e.id)<(v_cursor_at,v_cursor_id))
    order by e.occurred_at desc,e.id desc limit 51) page;
  if jsonb_array_length(v_rows)>50 then
    v_rows:=v_rows-50; v_next:=jsonb_build_object('occurredAt',v_rows->49->>'occurredAt','id',v_rows->49->>'id');
  end if;
  return jsonb_build_object('siteId',p_site_id,'employeeId',v_employee.id,'workerId',v_worker.id,
    'asOf',to_char(v_as_of at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'items',v_rows,'nextCursor',v_next);
exception when invalid_text_representation then raise exception 'attendance_invalid_request';
end; $$;
revoke all on function public.faolla_attendance_self_history_v1(text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_self_history_v1(text,uuid,jsonb) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202609300068,'merchant_attendance_self_history') on conflict(version) do nothing;
commit;
