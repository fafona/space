-- Bounded owner-only basic configuration/scope snapshot export. No backfill.
begin;
set local lock_timeout='3s';
create function public.faolla_attendance_audit_export_v1(p_site_id text,p_auth_user_id uuid,p_query jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
  m public.merchants%rowtype; v_source text; v_from timestamptz; v_to timestamptz;
  v_as_of timestamptz; v_rows jsonb; v_result jsonb;
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null
    or p_query is null or jsonb_typeof(p_query)<>'object'
    or (select count(*) from jsonb_object_keys(p_query))<>3
    or not(p_query ?& array['source','fromAt','toAt'])
    or jsonb_typeof(p_query->'source')<>'string'
    or jsonb_typeof(p_query->'fromAt')<>'string' or jsonb_typeof(p_query->'toAt')<>'string'
    then raise exception 'attendance_invalid_request'; end if;
  v_source:=p_query->>'source';
  if v_source not in ('config','scope') then raise exception 'attendance_invalid_request'; end if;
  v_from:=public.faolla_attendance_instant_v1(p_query->>'fromAt');
  v_to:=public.faolla_attendance_instant_v1(p_query->>'toAt');
  if v_to<=v_from or v_to-v_from>interval '31 days' then raise exception 'attendance_invalid_request'; end if;
  -- Same current-owner boundary as audit viewing; no employee export grant.
  -- Ownership changes serialize against this lock until this transaction ends.
  select * into m from public.merchants where id=p_site_id for share;
  if not found or not coalesce(p_auth_user_id=any(array[m.user_id,m.auth_user_id,m.owner_user_id,m.owner_id,m.auth_id,m.created_by,m.created_by_user_id]),false)
    then raise exception 'attendance_access_denied'; end if;
  v_as_of:=clock_timestamp();
  -- ONE SQL statement reads receipts and their snapshots together. Do not build
  -- an export by stitching independently authorized cursor/detail requests.
  with receipts as materialized (
    (select recorded_at,operation_id,command->>'kind' kind,version,
      (command->'values'->>'id')::uuid target_id,null::uuid employee_id,actor_auth_user_id,before_value,after_value
      from public.merchant_attendance_config_operations
      where v_source='config' and merchant_id=p_site_id and recorded_at>=v_from and recorded_at<least(v_to,v_as_of)
      order by recorded_at desc,operation_id desc limit 251)
    union all
    (select recorded_at,operation_id,'grant_'||(command->>'action'),revision,
      (command->>'grantId')::uuid,employee_id,actor_auth_user_id,before_value,after_value
      from public.merchant_attendance_scope_operations
      where v_source='scope' and merchant_id=p_site_id and recorded_at>=v_from and recorded_at<least(v_to,v_as_of)
      order by recorded_at desc,operation_id desc limit 251)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'item',jsonb_build_object('operationId',operation_id,
      'recordedAt',to_char(recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'kind',kind,'version',version,'targetId',target_id,'employeeId',employee_id,
      'actorRef',md5('attendance-audit:'||p_site_id||':'||actor_auth_user_id::text),'byCurrentOwner',actor_auth_user_id=p_auth_user_id),
    'before',public.faolla_attendance_audit_value_v1(kind,before_value,true,target_id),
    'after',public.faolla_attendance_audit_value_v1(kind,after_value,false,target_id)
  ) order by recorded_at desc,operation_id desc),'[]'::jsonb) into v_rows from receipts;
  if jsonb_array_length(v_rows)>250 then raise exception 'attendance_export_too_large'; end if;
  v_result:=jsonb_build_object('siteId',p_site_id,'source',v_source,'schemaVersion',1,
    'fromAt',to_char(v_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'toAt',to_char(v_to at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'asOf',to_char(v_as_of at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'count',jsonb_array_length(v_rows),'rows',v_rows);
  -- Leave headroom for the HTTP envelope under the 2 MiB client transport cap.
  if octet_length(v_result::text)>1572864 then raise exception 'attendance_export_too_large'; end if;
  return v_result;
end; $$;
revoke all on function public.faolla_attendance_audit_export_v1(text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_audit_export_v1(text,uuid,jsonb) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202609300080,'merchant_attendance_audit_export') on conflict(version) do nothing;
commit;
