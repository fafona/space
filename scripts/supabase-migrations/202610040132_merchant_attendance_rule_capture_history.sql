-- Current-owner/current-dual-identity archive discovery only. The timestamp
-- cutoff is not a frozen snapshot. Metadata never proves historical application.
begin;
set local lock_timeout='3s';

do $rule_capture_history_prerequisites$
declare installed boolean;v bigint;n text;p text;
begin
  if to_regclass('public.faolla_schema_migrations') is null then raise exception 'merchant_attendance_rule_capture_history_prerequisite_required';end if;
  for v,n in select * from (values
    (202609290064::bigint,'merchant_attendance_owner_configuration'),(202610040131::bigint,'merchant_attendance_rule_captures')) x(version,name) loop
    if not exists(select 1 from public.faolla_schema_migrations where version=v and name=n) then raise exception 'merchant_attendance_rule_capture_history_prerequisite_required';end if;
  end loop;
  if to_regclass('public.merchant_attendance_rule_capture_operations') is null or to_regclass('public.merchant_attendance_rule_capture_artifacts') is null then
    raise exception 'merchant_attendance_rule_capture_history_prerequisite_required';end if;
  foreach p in array array['public.faolla_attendance_rule_capture_command_v1(jsonb)','public.faolla_attendance_group_text_v1(text,integer,integer)'] loop
    if to_regprocedure(p) is null then raise exception 'merchant_attendance_rule_capture_history_prerequisite_required';end if;
  end loop;
  select exists(select 1 from public.faolla_schema_migrations where version=202610040132 and name='merchant_attendance_rule_capture_history') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610040132 and name<>'merchant_attendance_rule_capture_history')
    or installed<>(to_regprocedure('public.faolla_attendance_rule_capture_history_v1(jsonb,uuid)') is not null) then
    raise exception 'merchant_attendance_rule_capture_history_installation_conflict';end if;
end;
$rule_capture_history_prerequisites$;

create or replace function public.faolla_attendance_rule_capture_history_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;wid uuid;continuation boolean;k text;cutoff timestamptz;before_at timestamptz;before_id uuid;read_at timestamptz;
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
  row_item record;items jsonb:='[]'::jsonb;item jsonb;cursor_item jsonb:=null;result jsonb;n integer:=0;
  u constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  stamp_format constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_auth_user_id is null or p_query is null or jsonb_typeof(p_query)<>'object' or octet_length(convert_to(p_query::text,'UTF8'))>4096
    or (select count(*) from jsonb_object_keys(p_query))<>7
    or not(p_query ?& array['siteId','workerId','asOf','beforeAt','beforeId','expectedEmployeeId','expectedEmployeeAuthUserId'])
    or jsonb_typeof(p_query->'siteId')<>'string' or coalesce(p_query->>'siteId','') !~ '^\d{8}$'
    or jsonb_typeof(p_query->'workerId')<>'string' or coalesce(p_query->>'workerId','') !~ u then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';wid:=(p_query->>'workerId')::uuid;continuation:=p_query->'asOf'<>'null'::jsonb;
  foreach k in array array['asOf','beforeAt','beforeId','expectedEmployeeId','expectedEmployeeAuthUserId'] loop
    if (p_query->k<>'null'::jsonb)<>continuation then raise exception 'attendance_invalid_request';end if;
  end loop;
  if continuation then
    foreach k in array array['beforeId','expectedEmployeeId','expectedEmployeeAuthUserId'] loop
      if jsonb_typeof(p_query->k)<>'string' or coalesce(p_query->>k,'') !~ u then raise exception 'attendance_invalid_request';end if;
    end loop;
    foreach k in array array['asOf','beforeAt'] loop
      if jsonb_typeof(p_query->k)<>'string' or coalesce(p_query->>k,'') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$'
        or to_char((p_query->>k)::timestamptz at time zone 'UTC',stamp_format)<>p_query->>k then raise exception 'attendance_invalid_request';end if;
    end loop;
    cutoff:=(p_query->>'asOf')::timestamptz;before_at:=(p_query->>'beforeAt')::timestamptz;before_id:=(p_query->>'beforeId')::uuid;
    if before_at>cutoff then raise exception 'attendance_invalid_request';end if;
  end if;

  -- Retain131's lock order, without upgrading locks or invoking a source reader.
  perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  if not found then raise exception 'attendance_settings_required';end if;
  select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for share;
  if not found then raise exception 'attendance_worker_not_found';end if;
  if w.employee_id is not null then select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;end if;
  if w.employee_id is null or e.id is null or e.auth_user_id is null then raise exception 'attendance_rule_capture_identity_changed';end if;
  if continuation and (p_query->>'expectedEmployeeId' is distinct from w.employee_id::text
    or p_query->>'expectedEmployeeAuthUserId' is distinct from e.auth_user_id::text) then raise exception 'attendance_rule_capture_identity_changed';end if;
  if not public.faolla_attendance_group_text_v1(w.display_name,1,120) or not public.faolla_attendance_group_text_v1(w.worker_no,1,40)
    or w.employee_id::text !~ u or e.auth_user_id::text !~ u then raise exception 'attendance_rule_capture_history_invalid';end if;
  read_at:=clock_timestamp();
  if continuation then
    if cutoff>read_at then raise exception 'attendance_invalid_request';end if;
    -- A caller cannot invent an offset or borrow another actor/identity's row.
    perform 1 from public.merchant_attendance_rule_capture_operations o where o.merchant_id=site and o.worker_id=wid
      and o.actor_auth_user_id=p_auth_user_id and o.employee_id=w.employee_id and o.employee_auth_user_id=e.auth_user_id
      and o.operation_id=before_id and o.recorded_at=before_at and o.recorded_at<=cutoff;
    if not found then raise exception 'attendance_invalid_request';end if;
  else cutoff:=read_at;end if;

  -- The existing merchant primary key plus131's1000-operation quota bounds the
  -- metadata scan. No new index/table; do not project or validate stored bodies.
  for row_item in
    select o.operation_id,o.source_id,o.actor_auth_user_id,o.employee_id,o.employee_auth_user_id,o.command,o.observed_at,o.recorded_at,
      a.source_id as artifact_id,a.source_read_at,a.source_sha256,a.source_bytes
    from public.merchant_attendance_rule_capture_operations o
    left join public.merchant_attendance_rule_capture_artifacts a on a.merchant_id=o.merchant_id and a.source_id=o.source_id
      and a.worker_id=o.worker_id and a.actor_auth_user_id=o.actor_auth_user_id and a.employee_id=o.employee_id and a.employee_auth_user_id=o.employee_auth_user_id
    where o.merchant_id=site and o.worker_id=wid and o.actor_auth_user_id=p_auth_user_id
      and o.employee_id=w.employee_id and o.employee_auth_user_id=e.auth_user_id and o.recorded_at<=cutoff
      and (not continuation or (o.recorded_at,o.operation_id)<(before_at,before_id))
    order by o.recorded_at desc,o.operation_id desc limit 26
  loop
    n:=n+1;if n=26 then
      cursor_item:=jsonb_build_object('asOf',to_char(cutoff at time zone 'UTC',stamp_format),'beforeAt',item->>'recordedAt','beforeId',item->>'operationId',
        'expectedEmployeeId',w.employee_id,'expectedEmployeeAuthUserId',e.auth_user_id);exit;end if;
    if row_item.artifact_id is null or row_item.source_id::text !~ u or not public.faolla_attendance_rule_capture_command_v1(row_item.command)
      or row_item.command->>'operationId' is distinct from row_item.operation_id::text
      or row_item.command->>'employeeId' is distinct from w.employee_id::text or row_item.command->>'employeeAuthUserId' is distinct from e.auth_user_id::text
      or row_item.source_sha256 !~ '^[0-9a-f]{64}$' or row_item.source_bytes not between 1 and 1048576
      or not isfinite(row_item.source_read_at) or not isfinite(row_item.observed_at) or not isfinite(row_item.recorded_at)
      or row_item.source_read_at>row_item.observed_at or row_item.observed_at>row_item.recorded_at then raise exception 'attendance_rule_capture_history_invalid';end if;
    item:=jsonb_build_object('operationId',row_item.operation_id,'sourceId',row_item.source_id,'actorId',row_item.actor_auth_user_id,'command',row_item.command,
      'observedAt',to_char(row_item.observed_at at time zone 'UTC',stamp_format),'recordedAt',to_char(row_item.recorded_at at time zone 'UTC',stamp_format),
      'sourceReadAt',to_char(row_item.source_read_at at time zone 'UTC',stamp_format),'sourceSha256',row_item.source_sha256,'sourceBytes',row_item.source_bytes,
      'applied',false,'historicalApplicationProven',false);
    items:=items||jsonb_build_array(item);
  end loop;
  read_at:=clock_timestamp();if read_at<cutoff then raise exception 'attendance_rule_capture_history_invalid';end if;
  result:=jsonb_build_object('protocol','rule-capture-history-v1','readOnly',true,'siteId',site,'actorId',p_auth_user_id,'workerId',wid,
    'employeeId',w.employee_id,'employeeAuthUserId',e.auth_user_id,'workerName',w.display_name,'workerNo',w.worker_no,'workerActive',w.active,'employeeActive',e.status='active',
    'asOf',to_char(cutoff at time zone 'UTC',stamp_format),'readAt',to_char(read_at at time zone 'UTC',stamp_format),'items',items,'nextCursor',cursor_item);
  if octet_length(convert_to(result::text,'UTF8'))>65536 then raise exception 'attendance_rule_capture_history_too_large';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then raise exception 'attendance_invalid_request';
end;
$$;
revoke all on function public.faolla_attendance_rule_capture_history_v1(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_rule_capture_history_v1(jsonb,uuid) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610040132,'merchant_attendance_rule_capture_history') on conflict(version) do nothing;
do $rule_capture_history_postconditions$
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610040132 and name='merchant_attendance_rule_capture_history') then
    raise exception 'merchant_attendance_rule_capture_history_registry_postcondition_failed';end if;
  if not has_function_privilege('service_role','public.faolla_attendance_rule_capture_history_v1(jsonb,uuid)','EXECUTE')
    or has_function_privilege('anon','public.faolla_attendance_rule_capture_history_v1(jsonb,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.faolla_attendance_rule_capture_history_v1(jsonb,uuid)','EXECUTE')
    or exists(select 1 from pg_proc f cross join lateral aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
      where f.oid='public.faolla_attendance_rule_capture_history_v1(jsonb,uuid)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') then
    raise exception 'merchant_attendance_rule_capture_history_acl_postcondition_failed';end if;
end;
$rule_capture_history_postconditions$;
notify pgrst, 'reload schema';
commit;
