-- Additive self-only, read-only cross-root revision history. No copied ledger,
-- changed attendance facts, table grants or changes to097/095 successful paths.
-- The ordinary index build is transactional and lock-timeout bounded. On a large
-- deployed ledger, assess build duration and an approved concurrent-index rollout
-- separately; this candidate does not authorize a production index deployment.
begin;
set local lock_timeout='3s';

do $self_revision_history_prerequisites$
begin
  if to_regclass('public.faolla_schema_migrations') is null
    or to_regclass('public.merchants') is null
    or to_regclass('public.merchant_attendance_settings') is null
    or to_regclass('public.merchant_enterprise_employees') is null
    or to_regclass('public.merchant_enterprise_roles') is null
    or to_regclass('public.merchant_attendance_workers') is null
    or to_regclass('public.merchant_attendance_revision_requests') is null
    or to_regclass('public.merchant_attendance_revision_decisions') is null
    or to_regclass('public.merchant_attendance_correction_effects') is null
    or to_regclass('public.merchant_attendance_correction_entries') is null
    or to_regprocedure('public.faolla_valid_merchant_enterprise_permissions_v1(text[])') is null
    or to_regprocedure('public.faolla_attendance_instant_v1(text)') is null then
    raise exception 'merchant_attendance_self_revision_history_prerequisite_required';
  end if;
  if not exists(select 1 from public.faolla_schema_migrations where version=202610010095 and name='merchant_attendance_revision_cycles')
    or not exists(select 1 from public.faolla_schema_migrations where version=202610010097 and name='merchant_attendance_revision_history') then
    raise exception 'merchant_attendance_self_revision_history_prerequisite_required';
  end if;
end;
$self_revision_history_prerequisites$;

create index if not exists attendance_revision_self_identity_history_idx
  on public.merchant_attendance_revision_requests
  (merchant_id,worker_id,employee_id,actor_auth_user_id,recorded_at desc,request_id desc)
  where action='submit';

create or replace function public.faolla_attendance_self_revision_history_v1(
  p_site_id text,p_auth_user_id uuid,p_query jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  emp public.merchant_enterprise_employees%rowtype;
  role_row public.merchant_enterprise_roles%rowtype;
  worker public.merchant_attendance_workers%rowtype;
  base public.merchant_attendance_correction_effects%rowtype;
  original public.merchant_attendance_correction_entries%rowtype;
  r public.merchant_attendance_revision_requests%rowtype;
  tail public.merchant_attendance_revision_requests%rowtype;
  d public.merchant_attendance_revision_decisions%rowtype;
  v_worker uuid;v_status text;v_now timestamptz;v_asof timestamptz;
  v_cursor_at timestamptz;v_cursor uuid;k text;v_instant timestamptz;
  v_count integer:=0;v_items jsonb:='[]';v_next jsonb:='null';v_state text;v_closed timestamptz;result jsonb;
  v_uuid text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null
    or p_query is null or jsonb_typeof(p_query)<>'object' then
    raise exception 'attendance_invalid_request';
  end if;
  if (select count(*) from jsonb_object_keys(p_query))<>5
    or not(p_query ?& array['expectedWorkerId','status','asOf','cursorAt','cursorId'])
    or jsonb_typeof(p_query->'expectedWorkerId')<>'string' or coalesce(p_query->>'expectedWorkerId','') !~ v_uuid
    or jsonb_typeof(p_query->'status')<>'string' or coalesce(p_query->>'status','') not in ('all','submitted','approved','rejected','withdrawn')
    or (p_query->'cursorAt'='null'::jsonb)<>(p_query->'cursorId'='null'::jsonb)
    or (p_query->'cursorId'<>'null'::jsonb and
      (jsonb_typeof(p_query->'cursorId')<>'string' or coalesce(p_query->>'cursorId','') !~ v_uuid)) then
    raise exception 'attendance_invalid_request';
  end if;
  foreach k in array array['asOf','cursorAt'] loop
    if p_query->k<>'null'::jsonb then
      if jsonb_typeof(p_query->k)<>'string'
        or coalesce(p_query->>k,'') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' then
        raise exception 'attendance_invalid_request';
      end if;
      v_instant:=public.faolla_attendance_instant_v1(p_query->>k);
      if to_char(v_instant at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')<>p_query->>k then
        raise exception 'attendance_invalid_request';
      end if;
    end if;
  end loop;
  v_worker:=(p_query->>'expectedWorkerId')::uuid;v_status:=p_query->>'status';
  if p_query->'cursorId'<>'null'::jsonb and p_query->'asOf'='null'::jsonb then
    raise exception 'attendance_invalid_request';
  end if;

  -- Recheck current identity on every page, including a pinned asOf. SHARE on
  -- settings agrees with the existing revision writers' UPDATE fence.
  perform 1 from public.merchants where id=p_site_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  perform 1 from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  if not found then raise exception 'attendance_settings_required';end if;
  select * into emp from public.merchant_enterprise_employees where merchant_id=p_site_id and auth_user_id=p_auth_user_id for share;
  if not found or emp.status<>'active' then raise exception 'attendance_access_denied';end if;
  select * into role_row from public.merchant_enterprise_roles where merchant_id=p_site_id and id=emp.role_id for share;
  if not found or role_row.status<>'active'
    or not coalesce(public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions),false)
    or not coalesce('attendance.self.view'=any(role_row.permissions),false) then
    raise exception 'attendance_access_denied';
  end if;
  select * into worker from public.merchant_attendance_workers where merchant_id=p_site_id and employee_id=emp.id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  if worker.id<>v_worker then raise exception 'attendance_worker_changed';end if;
  v_now:=clock_timestamp();v_asof:=v_now;
  if p_query->'asOf'<>'null'::jsonb then v_asof:=public.faolla_attendance_instant_v1(p_query->>'asOf');end if;
  if v_asof>v_now then raise exception 'attendance_invalid_request';end if;
  if p_query->'cursorId'<>'null'::jsonb then
    v_cursor:=(p_query->>'cursorId')::uuid;v_cursor_at:=public.faolla_attendance_instant_v1(p_query->>'cursorAt');
    if v_cursor_at>v_asof then raise exception 'attendance_invalid_request';end if;
  end if;

  -- Identity is filtered before the index-backed51-candidate probe. Root and
  -- terminal validation apply to at most50; skipped roots/statuses still count
  -- as scanned, so an empty intermediate page does not cause an unbounded scan.
  for r in select * from public.merchant_attendance_revision_requests
    where merchant_id=p_site_id and worker_id=worker.id and employee_id=emp.id and actor_auth_user_id=p_auth_user_id
      and action='submit' and recorded_at<=v_asof
      and (v_cursor is null or (recorded_at,request_id)<(v_cursor_at,v_cursor))
    order by recorded_at desc,request_id desc limit 51 loop
    v_count:=v_count+1;exit when v_count=51;
    v_next:=jsonb_build_object('recordedAt',to_char(r.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'requestId',r.request_id);
    select * into base from public.merchant_attendance_correction_effects
      where merchant_id=p_site_id and request_id=r.base_request_id and worker_id=worker.id;
    if not found then continue;end if;
    select * into original from public.merchant_attendance_correction_entries
      where merchant_id=p_site_id and operation_id=base.request_id and action='submit';
    if not found or original.worker_id is distinct from worker.id
      or original.employee_id is distinct from emp.id or original.actor_auth_user_id is distinct from p_auth_user_id then
      continue;
    end if;
    select * into tail from public.merchant_attendance_revision_requests
      where merchant_id=p_site_id and request_id=r.request_id and recorded_at<=v_asof order by revision desc limit 1;
    select * into d from public.merchant_attendance_revision_decisions
      where merchant_id=p_site_id and request_id=r.request_id and recorded_at<=v_asof;
    -- Same terminal consistency boundary as097, with null-safe identities.
    if tail.revision is null or tail.base_request_id is distinct from r.base_request_id
      or tail.employee_id is distinct from r.employee_id or tail.worker_id is distinct from r.worker_id
      or tail.actor_auth_user_id is distinct from r.actor_auth_user_id or tail.recorded_at<r.recorded_at
      or d.operation_id is not null and (tail.action<>'submit' or d.base_request_id is distinct from r.base_request_id
        or d.worker_id is distinct from r.worker_id or d.request_revision<>r.revision or d.recorded_at<=r.recorded_at) then
      raise exception 'attendance_revision_history_invalid';
    end if;
    v_state:=case when tail.action='withdraw' then 'withdrawn' when d.action='approve' then 'approved' when d.action='reject' then 'rejected' else 'submitted' end;
    v_closed:=case when tail.action='withdraw' then tail.recorded_at else d.recorded_at end;
    if v_status<>'all' and v_state<>v_status then continue;end if;
    v_items:=v_items||jsonb_build_array(jsonb_build_object('requestId',r.request_id,'rootRequestId',r.base_request_id,'workerId',r.worker_id,'employeeId',r.employee_id,
      'workerName',worker.display_name,'workerNo',worker.worker_no,'submittedRevision',r.revision,'submittedAt',to_char(r.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'proposedStartAt',r.command->'proposal'->'startAt','proposedEndAt',r.command->'proposal'->'endAt','status',v_state,
      'closedAt',case when v_closed is null then null else to_char(v_closed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,'decisionOperationId',d.operation_id));
  end loop;
  result:=jsonb_build_object('protocol','self-revision-history-v1','readOnly',true,'siteId',p_site_id,'employeeId',emp.id,'workerId',worker.id,
    'asOf',to_char(v_asof at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'items',v_items,'scanned',least(v_count,50),
    'nextCursor',case when v_count=51 then v_next else 'null'::jsonb end);
  if octet_length(result::text)>131072 then raise exception 'attendance_revision_history_too_large';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
  raise exception 'attendance_invalid_request';
end;
$$;

revoke all on function public.faolla_attendance_self_revision_history_v1(text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_self_revision_history_v1(text,uuid,jsonb) to service_role;
insert into public.faolla_schema_migrations(version,name)
values(202610030116,'merchant_attendance_self_revision_history') on conflict(version) do nothing;
do $self_revision_history_postconditions$
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610030116 and name='merchant_attendance_self_revision_history') then
    raise exception 'merchant_attendance_self_revision_history_registry_postcondition_failed';
  end if;
  if not has_function_privilege('service_role','public.faolla_attendance_self_revision_history_v1(text,uuid,jsonb)','EXECUTE')
    or has_function_privilege('anon','public.faolla_attendance_self_revision_history_v1(text,uuid,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.faolla_attendance_self_revision_history_v1(text,uuid,jsonb)','EXECUTE') then
    raise exception 'merchant_attendance_self_revision_history_acl_postcondition_failed';
  end if;
  if not exists(select 1 from pg_index i where i.indexrelid=to_regclass('public.attendance_revision_self_identity_history_idx')
    and i.indrelid='public.merchant_attendance_revision_requests'::regclass and i.indisvalid and i.indisready
    and not i.indisunique and i.indnkeyatts=6 and i.indnatts=6
    and array(select a.attname::text from unnest(i.indkey) with ordinality k(attnum,pos)
      join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum order by k.pos)=
      array['merchant_id','worker_id','employee_id','actor_auth_user_id','recorded_at','request_id']
    and i.indoption::text='0 0 0 0 3 3'
    and pg_get_expr(i.indpred,i.indrelid)='(action = ''submit''::text)') then
    raise exception 'merchant_attendance_self_revision_history_index_postcondition_failed';
  end if;
end;
$self_revision_history_postconditions$;
notify pgrst, 'reload schema';
commit;
