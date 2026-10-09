-- Default-off read-only candidate. No grants, backfill, copied ledger or totals.
begin;
set local lock_timeout='3s';
create index attendance_revision_owner_history_idx on public.merchant_attendance_revision_requests(merchant_id,recorded_at desc,request_id desc) where action='submit';
create index attendance_revision_root_history_idx on public.merchant_attendance_revision_requests(merchant_id,base_request_id,recorded_at desc,request_id desc) where action='submit';

create function public.faolla_attendance_revision_history_v1(p_site_id text,p_auth_user_id uuid,p_query jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
  emp public.merchant_enterprise_employees%rowtype;role_row public.merchant_enterprise_roles%rowtype;worker public.merchant_attendance_workers%rowtype;
  base public.merchant_attendance_correction_effects%rowtype;original public.merchant_attendance_correction_entries%rowtype;
  r public.merchant_attendance_revision_requests%rowtype;tail public.merchant_attendance_revision_requests%rowtype;d public.merchant_attendance_revision_decisions%rowtype;
  v_access text;v_status text;v_root uuid;v_worker uuid;v_now timestamptz;v_asof timestamptz;v_from timestamptz;v_to timestamptz;
  v_cursor_at timestamptz;v_cursor uuid;v_count integer:=0;v_items jsonb:='[]';v_next jsonb:='null';v_state text;v_closed timestamptz;result jsonb;
  v_uuid text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_query is null or jsonb_typeof(p_query)<>'object'
    or (select count(*) from jsonb_object_keys(p_query))<>8
    or not(p_query ?& array['access','status','asOf','cursorAt','cursorId'])
    or coalesce(p_query->>'access','') not in ('owner','self') or coalesce(p_query->>'status','') not in ('all','submitted','withdrawn','approved','rejected')
    then raise exception 'attendance_invalid_request';end if;
  v_access:=p_query->>'access';v_status:=p_query->>'status';
  -- Both variants have eight fields, including one explicit scope discriminator.
  if v_access='owner' then
    if not(p_query ?& array['fromAt','toAt','scope']) or p_query->>'scope' is distinct from 'submission-period' then raise exception 'attendance_invalid_request';end if;
    v_from:=public.faolla_attendance_instant_v1(p_query->>'fromAt');v_to:=public.faolla_attendance_instant_v1(p_query->>'toAt');
    if v_from>=v_to or v_to-v_from>interval '31 days' or v_from<timestamptz '2000-01-01Z' or v_to>timestamptz '2101-01-01Z' then raise exception 'attendance_invalid_request';end if;
  else
    if not(p_query ?& array['expectedWorkerId','rootRequestId','scope']) or p_query->>'scope' is distinct from 'root-history'
      or coalesce(p_query->>'expectedWorkerId','') !~ v_uuid or coalesce(p_query->>'rootRequestId','') !~ v_uuid then raise exception 'attendance_invalid_request';end if;
    v_worker:=(p_query->>'expectedWorkerId')::uuid;v_root:=(p_query->>'rootRequestId')::uuid;
  end if;
  if (p_query->'cursorAt'='null'::jsonb)<>(p_query->'cursorId'='null'::jsonb)
    or p_query->'cursorId'<>'null'::jsonb and coalesce(p_query->>'cursorId','') !~ v_uuid then raise exception 'attendance_invalid_request';end if;
  perform 1 from public.merchants where id=p_site_id and (v_access='self' or user_id=p_auth_user_id) for share;
  if not found then raise exception 'attendance_access_denied';end if;
  -- Same shared settings fence as detail reads. All revision writers hold UPDATE.
  perform 1 from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  if not found then raise exception 'attendance_settings_required';end if;
  if v_access='self' then
    select * into emp from public.merchant_enterprise_employees where merchant_id=p_site_id and auth_user_id=p_auth_user_id for share;
    if not found or emp.status<>'active' then raise exception 'attendance_access_denied';end if;
    select * into role_row from public.merchant_enterprise_roles where merchant_id=p_site_id and id=emp.role_id for share;
    if not found or role_row.status<>'active' or not public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions) or not('attendance.self.view'=any(role_row.permissions)) then raise exception 'attendance_access_denied';end if;
    select * into worker from public.merchant_attendance_workers where merchant_id=p_site_id and employee_id=emp.id for share;
    if not found then raise exception 'attendance_access_denied';end if;
    if worker.id<>v_worker then raise exception 'attendance_worker_changed';end if;
    select * into base from public.merchant_attendance_correction_effects where merchant_id=p_site_id and request_id=v_root and worker_id=worker.id;
    if not found then raise exception 'attendance_revision_base_not_found';end if;
    select * into original from public.merchant_attendance_correction_entries where merchant_id=p_site_id and operation_id=base.request_id and action='submit';
    if original.employee_id is distinct from emp.id or original.actor_auth_user_id is distinct from p_auth_user_id then raise exception 'attendance_revision_base_not_found';end if;
  end if;
  v_now:=clock_timestamp();v_asof:=v_now;
  if p_query->'asOf'<>'null'::jsonb then v_asof:=public.faolla_attendance_instant_v1(p_query->>'asOf');end if;
  if v_asof>v_now then raise exception 'attendance_invalid_request';end if;
  if p_query->'cursorId'<>'null'::jsonb then
    v_cursor:=(p_query->>'cursorId')::uuid;v_cursor_at:=public.faolla_attendance_instant_v1(p_query->>'cursorAt');
    if p_query->'asOf'='null'::jsonb or v_cursor_at>v_asof or v_access='owner' and (v_cursor_at<v_from or v_cursor_at>=v_to) then raise exception 'attendance_invalid_request';end if;
  end if;
  -- Status filtering is AFTER the bounded candidate scan. Empty nonfinal pages
  -- are explicit, rather than scanning an unbounded history to fill a page.
  -- Separate scope branches let even a generic plan use the appropriate index;
  -- the inactive branch is false, not a tenant-wide post-filter of another root.
  for r in select * from (
    (select * from public.merchant_attendance_revision_requests
      where v_access='owner' and merchant_id=p_site_id and action='submit' and recorded_at<=v_asof and recorded_at>=v_from and recorded_at<v_to
        and (v_cursor is null or (recorded_at,request_id)<(v_cursor_at,v_cursor)) order by recorded_at desc,request_id desc limit 51)
    union all
    (select * from public.merchant_attendance_revision_requests
      where v_access='self' and merchant_id=p_site_id and action='submit' and base_request_id=v_root and worker_id=v_worker and recorded_at<=v_asof
        and (v_cursor is null or (recorded_at,request_id)<(v_cursor_at,v_cursor)) order by recorded_at desc,request_id desc limit 51)
    ) candidates order by recorded_at desc,request_id desc limit 51 loop
    v_count:=v_count+1;exit when v_count=51;
    v_next:=jsonb_build_object('recordedAt',to_char(r.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'requestId',r.request_id);
    if v_access='self' and (r.employee_id<>emp.id or r.actor_auth_user_id<>p_auth_user_id) then continue;end if;
    select * into tail from public.merchant_attendance_revision_requests where merchant_id=p_site_id and request_id=r.request_id and recorded_at<=v_asof order by revision desc limit 1;
    select * into d from public.merchant_attendance_revision_decisions where merchant_id=p_site_id and request_id=r.request_id and recorded_at<=v_asof;
    if tail.revision is null or tail.base_request_id<>r.base_request_id or tail.employee_id<>r.employee_id or tail.worker_id<>r.worker_id
      or tail.actor_auth_user_id<>r.actor_auth_user_id or tail.recorded_at<r.recorded_at
      or d.operation_id is not null and (tail.action<>'submit' or d.base_request_id<>r.base_request_id or d.worker_id<>r.worker_id or d.request_revision<>r.revision or d.recorded_at<=r.recorded_at)
      then raise exception 'attendance_revision_history_invalid';end if;
    v_state:=case when tail.action='withdraw' then 'withdrawn' when d.action='approve' then 'approved' when d.action='reject' then 'rejected' else 'submitted' end;
    v_closed:=case when tail.action='withdraw' then tail.recorded_at else d.recorded_at end;
    if v_status<>'all' and v_state<>v_status then continue;end if;
    select * into worker from public.merchant_attendance_workers where merchant_id=p_site_id and id=r.worker_id;
    if not found then raise exception 'attendance_revision_history_invalid';end if;
    v_items:=v_items||jsonb_build_array(jsonb_build_object('requestId',r.request_id,'rootRequestId',r.base_request_id,'workerId',r.worker_id,'employeeId',r.employee_id,
      'workerName',worker.display_name,'workerNo',worker.worker_no,'submittedRevision',r.revision,'submittedAt',to_char(r.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'proposedStartAt',r.command->'proposal'->'startAt','proposedEndAt',r.command->'proposal'->'endAt','status',v_state,
      'closedAt',case when v_closed is null then null else to_char(v_closed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,'decisionOperationId',d.operation_id));
  end loop;
  result:=jsonb_build_object('protocol','revision-history-v1','readOnly',true,'siteId',p_site_id,'access',v_access,
    'employeeId',case when v_access='self' then emp.id else null end,'workerId',v_worker,'rootRequestId',v_root,
    'asOf',to_char(v_asof at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'scanned',least(v_count,50),'items',v_items,'nextCursor',case when v_count=51 then v_next else 'null'::jsonb end);
  if octet_length(result::text)>131072 then raise exception 'attendance_revision_history_too_large';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end; $$;
revoke all on function public.faolla_attendance_revision_history_v1(text,uuid,jsonb) from public,anon,authenticated,service_role;

insert into public.faolla_schema_migrations(version,name) values(202610010097,'merchant_attendance_revision_history') on conflict(version) do nothing;
commit;
