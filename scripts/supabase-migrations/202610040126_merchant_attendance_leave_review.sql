-- Owner-only discovery of pending leave, bounded by scanned candidates rather
-- than by matches. No snapshot, total count, source writes or source index change.
begin;
set local lock_timeout='3s';
do $review_prerequisites$
declare installed boolean;
begin
  if to_regclass('public.faolla_schema_migrations') is null
    or to_regclass('public.merchants') is null or to_regclass('public.merchant_attendance_settings') is null
    or to_regclass('public.merchant_attendance_leave_requests') is null or to_regclass('public.merchant_attendance_leave_entries') is null
    or to_regclass('public.attendance_leave_owner_list_idx') is null
    or to_regprocedure('public.faolla_attendance_leave_v1(jsonb,uuid,jsonb,boolean)') is null
    or to_regprocedure('public.faolla_attendance_leave_summary_v1(public.merchant_attendance_leave_requests,integer)') is null then
    raise exception 'merchant_attendance_leave_review_prerequisite_required';end if;
  if not exists(select 1 from public.faolla_schema_migrations where version=202610030122 and name='merchant_attendance_leave_requests') then
    raise exception 'merchant_attendance_leave_review_prerequisite_required';end if;
  select exists(select 1 from public.faolla_schema_migrations where version=202610040126 and name='merchant_attendance_leave_review') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610040126 and name<>'merchant_attendance_leave_review')
    or installed<>(to_regprocedure('public.faolla_attendance_leave_review_v1(jsonb,uuid)') is not null) then
    raise exception 'merchant_attendance_leave_review_installation_conflict';end if;
end;
$review_prerequisites$;

create or replace function public.faolla_attendance_leave_review_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare site text;cursor_at timestamptz;cursor_id uuid;candidate public.merchant_attendance_leave_requests%rowtype;
  item jsonb;items jsonb:='[]';result jsonb;next_cursor jsonb;rows_seen integer:=0;
begin
  if p_auth_user_id is null or p_query is null or jsonb_typeof(p_query)<>'object' then raise exception 'attendance_invalid_request';end if;
  if (select count(*) from jsonb_object_keys(p_query))<>3 or not(p_query ?& array['siteId','afterAt','afterId'])
    or jsonb_typeof(p_query->'siteId')<>'string' or coalesce(p_query->>'siteId','') !~ '^[0-9]{8}$' then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';
  if p_query->'afterId'<>'null'::jsonb then
    if jsonb_typeof(p_query->'afterId')<>'string'
      or coalesce(p_query->>'afterId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'attendance_invalid_request';end if;
    cursor_id:=(p_query->>'afterId')::uuid;
  end if;
  if p_query->'afterAt'<>'null'::jsonb then
    if jsonb_typeof(p_query->'afterAt')<>'string'
      or coalesce(p_query->>'afterAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' then
      raise exception 'attendance_invalid_request';end if;
    cursor_at:=(p_query->>'afterAt')::timestamptz;
    if not isfinite(cursor_at) or to_char(cursor_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')<>p_query->>'afterAt' then
      raise exception 'attendance_invalid_request';end if;
  end if;
  if (cursor_at is null)<>(cursor_id is null) then raise exception 'attendance_invalid_request';end if;

  -- Match the original writer lock order; once settings SHARE is held, normal
  -- source decisions cannot change underneath this bounded read.
  perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  perform 1 from public.merchant_attendance_settings where merchant_id=site for share;
  if not found then raise exception 'attendance_settings_required';end if;
  for candidate in select p.* from public.merchant_attendance_leave_requests p
    where p.merchant_id=site and (cursor_at is null or (p.submitted_at,p.request_id)>(cursor_at,cursor_id))
    order by p.submitted_at asc,p.request_id asc limit 51 loop
    rows_seen:=rows_seen+1;
    exit when rows_seen=51;
    item:=public.faolla_attendance_leave_summary_v1(candidate);
    if jsonb_typeof(item) is distinct from 'object' or (select count(*) from jsonb_object_keys(item))<>8
      or not(item ?& array['requestId','workerName','startAt','endAt','timeZone','submittedAt','revision','status'])
      or item->>'requestId' is distinct from candidate.request_id::text
      or item->>'status' not in('submitted','withdrawn','approved','rejected','cancelled') then
      raise exception 'attendance_leave_review_invalid';end if;
    if item->>'status'='submitted' then
      if item->'revision' is distinct from '1'::jsonb then raise exception 'attendance_leave_review_invalid';end if;
      items:=items||jsonb_build_array(item);
    end if;
    next_cursor:=jsonb_build_object('at',to_char(candidate.submitted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'id',candidate.request_id);
  end loop;
  result:=jsonb_build_object('protocol','leave-review-v1','siteId',site,'ownerId',p_auth_user_id,'items',items,
    'scanned',least(rows_seen,50),'nextCursor',case when rows_seen=51 then next_cursor else null end);
  if octet_length(result::text)>131072 then raise exception 'attendance_leave_review_invalid';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_parameter_value then
  raise exception 'attendance_invalid_request';
end;
$$;
revoke all on function public.faolla_attendance_leave_review_v1(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_leave_review_v1(jsonb,uuid) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610040126,'merchant_attendance_leave_review') on conflict(version) do nothing;
do $review_postconditions$
declare f regprocedure:='public.faolla_attendance_leave_review_v1(jsonb,uuid)'::regprocedure;
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610040126 and name='merchant_attendance_leave_review') then
    raise exception 'merchant_attendance_leave_review_registry_postcondition_failed';end if;
  if not has_function_privilege('service_role',f,'EXECUTE') or has_function_privilege('anon',f,'EXECUTE')
    or has_function_privilege('authenticated',f,'EXECUTE')
    or exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=f and a.grantee=0)
    or not exists(select 1 from pg_proc where oid=f and prosecdef and proconfig=array['search_path=pg_catalog']) then
    raise exception 'merchant_attendance_leave_review_acl_postcondition_failed';end if;
end;
$review_postconditions$;
notify pgrst, 'reload schema';
commit;
