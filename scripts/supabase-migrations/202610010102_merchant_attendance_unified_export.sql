-- Unreleased additive candidate. No old export/reader/writer replacement.
begin;
set local lock_timeout='3s';
create table public.merchant_attendance_unified_exports (
  merchant_id text not null,operation_id uuid not null,actor_auth_user_id uuid not null,
  actor_employee_id uuid,access text not null check(access in ('owner','self','manager')),
  query jsonb not null check(jsonb_typeof(query)='object' and octet_length(query::text)<=2048),
  worker_id uuid not null,location_id uuid,
  as_of timestamptz not null check(isfinite(as_of)),recorded_at timestamptz not null check(isfinite(recorded_at) and recorded_at>=as_of),
  source_sha256 text not null check(source_sha256~'^[0-9a-f]{64}$'),source_bytes integer not null check(source_bytes between 1 and 1048576),
  session_count integer not null check(session_count between 0 and 100),missing_count integer not null check(missing_count between 0 and 100),
  check(session_count+missing_count<=100),primary key(merchant_id,operation_id),
  foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id) on delete restrict,
  check((access='owner')=(actor_employee_id is null)),check((access='manager')=(location_id is not null))
);
create index attendance_unified_export_actor_idx on public.merchant_attendance_unified_exports(merchant_id,actor_auth_user_id,recorded_at desc,operation_id desc);
alter table public.merchant_attendance_unified_exports enable row level security;
revoke all on public.merchant_attendance_unified_exports from public,anon,authenticated,service_role;
create trigger attendance_unified_export_no_rewrite before update or delete on public.merchant_attendance_unified_exports for each row execute function public.faolla_attendance_events_append_only_v1();
create trigger attendance_unified_export_no_truncate before truncate on public.merchant_attendance_unified_exports for each statement execute function public.faolla_attendance_events_append_only_v1();
create function public.faolla_attendance_unified_export_v1(p_site_id text,p_auth_user_id uuid,p_operation_id uuid,p_query jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare e public.merchant_enterprise_employees%rowtype;r public.merchant_enterprise_roles%rowtype;
  rec public.merchant_attendance_unified_exports%rowtype;mode text;report jsonb;base jsonb;receipt jsonb;replayed boolean:=false;expires timestamptz;
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_operation_id is null
    or p_operation_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_query is null or jsonb_typeof(p_query)<>'object' or octet_length(p_query::text)>2048
    or (select count(*) from jsonb_object_keys(p_query))<>8
    or not(p_query ?& array['access','workerId','locationId','expectedWorkerId','fromDate','throughDate','expectedTimeZone','expectedScopeRevision'])
    or coalesce(p_query->>'access','') not in ('owner','self','manager')
    or jsonb_typeof(p_query->'expectedTimeZone')<>'string' or char_length(p_query->>'expectedTimeZone') not between 1 and 100
    then raise exception 'attendance_invalid_request';end if;
  mode:=p_query->>'access';
  if mode='manager' then
    if jsonb_typeof(p_query->'expectedScopeRevision')<>'number' or (p_query->>'expectedScopeRevision') !~ '^[1-9][0-9]{0,15}$'
      or (p_query->>'expectedScopeRevision')::bigint>9007199254740990 then raise exception 'attendance_invalid_request';end if;
  elsif p_query->'expectedScopeRevision'<>'null'::jsonb then raise exception 'attendance_invalid_request';end if;
  if mode='owner' and (p_query->'locationId'<>'null'::jsonb or p_query->'expectedWorkerId'<>'null'::jsonb)
    or mode='self' and (p_query->'expectedWorkerId'='null'::jsonb or p_query->'workerId'<>'null'::jsonb or p_query->'locationId'<>'null'::jsonb)
    then raise exception 'attendance_invalid_request';end if;
  -- Preserve reader lock order; independent export permission is held for the
  -- whole transaction, including replays and waiting for a duplicate operation.
  perform 1 from public.merchants where id=p_site_id and (mode<>'owner' or user_id=p_auth_user_id) for share;
  if not found then raise exception 'attendance_access_denied';end if;
  perform 1 from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  if not found then raise exception 'attendance_settings_required';end if;
  if mode<>'owner' then
    select * into e from public.merchant_enterprise_employees where merchant_id=p_site_id and auth_user_id=p_auth_user_id for share;
    if not found or e.status<>'active' then raise exception 'attendance_access_denied';end if;
    select * into r from public.merchant_enterprise_roles where merchant_id=p_site_id and id=e.role_id for share;
    if not found or r.status<>'active' or not public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions)
      or not((case when mode='self' then 'attendance.self.export' else 'attendance.reports.export' end)=any(r.permissions))
      then raise exception 'attendance_export_denied';end if;
  end if;
  report:=public.faolla_attendance_unified_report_v1(p_site_id,p_auth_user_id,
    case when mode='owner' then p_query-array['locationId','expectedWorkerId','expectedTimeZone','expectedScopeRevision'] else p_query-array['expectedTimeZone','expectedScopeRevision'] end);
  base:=report->'base';
  if base->>'timeZone'<>p_query->>'expectedTimeZone' then raise exception 'attendance_report_zone_changed';end if;
  if mode='manager' and base->'scopeRevision'<>p_query->'expectedScopeRevision' then raise exception 'attendance_version_conflict';end if;
  expires:=(base->>'accessValidUntil')::timestamptz;
  if expires is not null and clock_timestamp()>=expires then raise exception 'attendance_access_denied';end if;
  -- Metadata only, in a separate namespace from legacy exports. No full report,
  -- CSV, names, reasons or coordinates retained by the export receipt.
  insert into public.merchant_attendance_unified_exports(merchant_id,operation_id,actor_auth_user_id,actor_employee_id,access,query,
    worker_id,location_id,as_of,recorded_at,source_sha256,source_bytes,session_count,missing_count)
  values(p_site_id,p_operation_id,p_auth_user_id,e.id,mode,p_query,(base->>'workerId')::uuid,
    case when mode='manager' then (base->>'locationId')::uuid else null end,(base->>'asOf')::timestamptz,clock_timestamp(),
    encode(sha256(convert_to(report::text,'UTF8')),'hex'),octet_length(report::text),jsonb_array_length(base->'items'),jsonb_array_length(report->'missing'))
  on conflict(merchant_id,operation_id) do nothing returning * into rec;
  if not found then
    replayed:=true;select * into rec from public.merchant_attendance_unified_exports where merchant_id=p_site_id and operation_id=p_operation_id;
    if rec.actor_auth_user_id<>p_auth_user_id or rec.actor_employee_id is distinct from e.id or rec.query<>p_query then raise exception 'attendance_operation_conflict';end if;
  end if;
  if expires is not null and clock_timestamp()>=expires then raise exception 'attendance_access_denied';end if;
  receipt:=jsonb_build_object('operationId',rec.operation_id,'siteId',rec.merchant_id,'access',rec.access,'workerId',rec.worker_id,'locationId',rec.location_id,
    'fromDate',rec.query->'fromDate','throughDate',rec.query->'throughDate','timeZone',rec.query->'expectedTimeZone','scopeRevision',rec.query->'expectedScopeRevision',
    'asOf',to_char(rec.as_of at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'recordedAt',to_char(rec.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'sourceSha256',rec.source_sha256,'sourceBytes',rec.source_bytes,'sessionCount',rec.session_count,'missingCount',rec.missing_count,'sourceCount',rec.session_count+rec.missing_count,
    'reportVersion','attendance-unified-v1','schemaVersion',1,'status','source_read','downloadConfirmed',false);
  return jsonb_build_object('receipt',receipt,'replayed',replayed,'report',case when replayed then 'null'::jsonb else report end);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end; $$;
revoke all on function public.faolla_attendance_unified_export_v1(text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_unified_export_v1(text,uuid,uuid,jsonb) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610010102,'merchant_attendance_unified_export') on conflict(version) do nothing;
commit;
