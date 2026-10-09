-- Read-only discovery for scoped report UI. No owner selector, facts or account bindings.
begin;
set local lock_timeout='3s';
create function public.faolla_attendance_scoped_report_context_v1(p_site_id text,p_auth_user_id uuid,p_query jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
  s public.merchant_attendance_settings%rowtype;
  e public.merchant_enterprise_employees%rowtype;r public.merchant_enterprise_roles%rowtype;
  w public.merchant_attendance_workers%rowtype;sc public.merchant_attendance_scopes%rowtype;
  access text;search text;cursor_worker uuid;cursor_location uuid;expected_revision bigint;
  now_at timestamptz;access_until timestamptz;items jsonb:='[]';own_worker jsonb:='null';next_cursor text;result jsonb;
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_query is null or jsonb_typeof(p_query)<>'object'
    or (select count(*) from jsonb_object_keys(p_query))<>4 or not(p_query ?& array['access','search','cursor','scopeRevision'])
    or coalesce(p_query->>'access','') not in ('self','manager') or jsonb_typeof(p_query->'search')<>'string'
    or char_length(p_query->>'search')>80 or (p_query->>'search')~'[[:cntrl:]]'
    then raise exception 'attendance_invalid_request';end if;
  access:=p_query->>'access';search:=lower(btrim(p_query->>'search'));
  if (p_query->'cursor'='null'::jsonb)<>(p_query->'scopeRevision'='null'::jsonb)
    or (access='self' and (search<>'' or p_query->'cursor'<>'null'::jsonb))
    then raise exception 'attendance_invalid_request';end if;
  if p_query->'cursor'<>'null'::jsonb then
    if jsonb_typeof(p_query->'cursor')<>'string' or (p_query->>'cursor') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(p_query->'scopeRevision')<>'number' or (p_query->>'scopeRevision') !~ '^[1-9][0-9]{0,15}$'
      then raise exception 'attendance_invalid_request';end if;
    expected_revision:=(p_query->>'scopeRevision')::bigint;
    if expected_revision>9007199254740990 then raise exception 'attendance_invalid_request';end if;
    cursor_worker:=split_part(p_query->>'cursor','.',1)::uuid;cursor_location:=split_part(p_query->>'cursor','.',2)::uuid;
  end if;
  perform 1 from public.merchants where id=p_site_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  select * into s from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  select * into e from public.merchant_enterprise_employees where merchant_id=p_site_id and auth_user_id=p_auth_user_id for share;
  if not found or e.status<>'active' then raise exception 'attendance_access_denied';end if;
  select * into r from public.merchant_enterprise_roles where merchant_id=p_site_id and id=e.role_id for share;
  if not found or r.status<>'active' or not public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions)
    or not('enterprise.view'=any(r.permissions))
    or not((case when access='self' then 'attendance.self.view' else 'attendance.records.view' end)=any(r.permissions))
    then raise exception 'attendance_access_denied';end if;
  if s.merchant_id is null then raise exception 'attendance_settings_required';end if;
  if access='self' then
    select * into w from public.merchant_attendance_workers where merchant_id=p_site_id and employee_id=e.id for share;
    if not found then raise exception 'attendance_access_denied';end if;
    own_worker:=jsonb_build_object('id',w.id,'label',w.display_name,'detail',w.worker_no);
  else
    select * into sc from public.merchant_attendance_scopes where merchant_id=p_site_id and employee_id=e.id for share;
    if not found then raise exception 'attendance_access_denied';end if;
    if expected_revision is not null and expected_revision<>sc.revision then raise exception 'attendance_version_conflict';end if;
  end if;
  now_at:=clock_timestamp();
  if access='manager' then
    -- Same-grant pairing, never flatten axes. Bound source grants by existing
    -- owner configuration limits (32 x 200 workers x 50 locations), page 25+1.
    -- Conservative minimum expiry invalidates the whole selector even when an
    -- overlapping grant still grants a particular pair. It never extends access.
    select min(valid_until) into access_until from public.merchant_attendance_scope_grants
      where merchant_id=p_site_id and employee_id=e.id and valid_from<=now_at and (valid_until is null or now_at<valid_until);
    with pairs as (
      select distinct sw.worker_id,sl.location_id
      from public.merchant_attendance_scope_grants g
      join public.merchant_attendance_scope_workers sw on sw.merchant_id=g.merchant_id and sw.employee_id=g.employee_id and sw.grant_id=g.id
      join public.merchant_attendance_scope_locations sl on sl.merchant_id=g.merchant_id and sl.employee_id=g.employee_id and sl.grant_id=g.id
      where g.merchant_id=p_site_id and g.employee_id=e.id and g.valid_from<=now_at and (g.valid_until is null or now_at<g.valid_until)
        and (cursor_worker is null or (sw.worker_id,sl.location_id)>(cursor_worker,cursor_location))
    ), page as (
      select p.*,aw.display_name,aw.worker_no,l.name from pairs p
      join public.merchant_attendance_workers aw on aw.merchant_id=p_site_id and aw.id=p.worker_id
      join public.merchant_attendance_locations l on l.merchant_id=p_site_id and l.id=p.location_id
      where search='' or strpos(lower(aw.display_name||' '||aw.worker_no||' '||l.name),search)>0
      order by p.worker_id,p.location_id limit 26
    ) select coalesce(jsonb_agg(jsonb_build_object('workerId',worker_id,'workerName',display_name,'workerNo',worker_no,'locationId',location_id,'locationName',name)
        order by worker_id,location_id),'[]') into items from page;
    if jsonb_array_length(items)>25 then next_cursor:=(items->24->>'workerId')||'.'||(items->24->>'locationId');items:=items-25;end if;
  end if;
  result:=jsonb_build_object('siteId',p_site_id,'access',access,'viewerEmployeeId',e.id,'timeZone',s.time_zone,
    'asOf',to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'accessValidUntil',case when access_until is null then null else to_char(access_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
    'scopeRevision',case when access='manager' then sc.revision else null end,'worker',own_worker,'items',items,'nextCursor',next_cursor);
  if octet_length(result::text)>32768 then raise exception 'attendance_report_too_large';end if;
  if access_until is not null and clock_timestamp()>=access_until then raise exception 'attendance_access_denied';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end; $$;
revoke all on function public.faolla_attendance_scoped_report_context_v1(text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_scoped_report_context_v1(text,uuid,jsonb) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610010089,'merchant_attendance_scoped_report_context') on conflict(version) do nothing;
commit;
