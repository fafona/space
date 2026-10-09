-- Unreleased. Independent export permissions, no role backfill.
begin;
set local lock_timeout='3s';
create or replace function public.faolla_valid_merchant_enterprise_permissions_v1(
  p_permissions text[]
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  with permission_catalog(permission, dependencies) as (
    values
      ('enterprise.view'::text, array[]::text[]),
      ('tasks.view', array['enterprise.view']::text[]),
      ('tasks.create', array['enterprise.view', 'tasks.view']::text[]),
      ('tasks.update', array['enterprise.view', 'tasks.view']::text[]),
      ('tasks.assign', array['enterprise.view', 'tasks.view']::text[]),
      ('tasks.archive', array['enterprise.view', 'tasks.view']::text[]),
      ('orders.linked.view', array['enterprise.view', 'tasks.view']::text[]),
      ('boards.manage', array['enterprise.view', 'tasks.view']::text[]),
      ('employees.view', array['enterprise.view', 'roles.view']::text[]),
      ('employees.manage', array['enterprise.view', 'employees.view', 'roles.view']::text[]),
      ('roles.view', array['enterprise.view']::text[]),
      ('roles.manage', array['enterprise.view', 'roles.view']::text[]),
      ('workflows.view', array['enterprise.view']::text[]),
      ('workflows.manage', array['enterprise.view', 'workflows.view']::text[]),
      ('workflows.publish', array['enterprise.view', 'workflows.view']::text[]),
      ('automations.view', array['enterprise.view', 'tasks.view', 'workflows.view']::text[]),
      (
        'automations.manage',
        array[
          'enterprise.view',
          'tasks.view',
          'tasks.create',
          'tasks.assign',
          'workflows.view',
          'automations.view',
          'roles.view',
          'employees.view'
        ]::text[]
      ),
      ('audit.view', array['enterprise.view']::text[]),
      ('attendance.records.view', array['enterprise.view']::text[]),
      ('attendance.self.export', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.reports.export', array['enterprise.view', 'attendance.records.view']::text[]),
      ('attendance.self.view', array['enterprise.view']::text[]),
      ('attendance.self.clock', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.self.request', array['enterprise.view', 'attendance.self.view']::text[]),
      ('redemptions.view', array[]::text[]),
      ('redemptions.customer_data.view', array['redemptions.view']::text[]),
      (
        'redemptions.checkout',
        array['redemptions.view', 'redemptions.customer_data.view']::text[]
      ),
      (
        'redemptions.recharge',
        array['redemptions.view', 'redemptions.customer_data.view']::text[]
      ),
      (
        'redemptions.recharge.cancel',
        array[
          'redemptions.view',
          'redemptions.customer_data.view',
          'redemptions.recharge'
        ]::text[]
      ),
      ('redemptions.catalog.manage', array['redemptions.view']::text[]),
      ('redemptions.print', array['redemptions.view']::text[]),
      ('bookings.view', array[]::text[]),
      ('bookings.customer_data.view', array['bookings.view']::text[]),
      (
        'bookings.update',
        array['bookings.view', 'bookings.customer_data.view']::text[]
      ),
      ('bookings.status.manage', array['bookings.view']::text[]),
      (
        'bookings.email.send',
        array['bookings.view', 'bookings.customer_data.view']::text[]
      ),
      ('bookings.analytics.view', array['bookings.view']::text[]),
      ('bookings.export', array['bookings.view']::text[]),
      ('bookings.settings.manage', array['bookings.view']::text[]),
      ('bookings.automation.manage', array['bookings.view']::text[]),
      ('bookings.calendar.manage', array['bookings.view']::text[]),
      ('orders.view', array[]::text[]),
      ('orders.customer_data.view', array['orders.view']::text[]),
      ('orders.status.manage', array['orders.view']::text[]),
      ('orders.complete', array['orders.view']::text[]),
      ('orders.items.update', array['orders.view']::text[]),
      ('orders.print', array['orders.view']::text[]),
      ('orders.analytics.view', array['orders.view']::text[]),
      ('orders.export', array['orders.view']::text[]),
      (
        'orders.export.customer_data',
        array['orders.view', 'orders.customer_data.view', 'orders.export']::text[]
      ),
      ('orders.catalog.view', array['orders.view']::text[]),
      (
        'orders.catalog.manage',
        array['orders.view', 'orders.catalog.view']::text[]
      ),
      ('conversations.view', array[]::text[]),
      ('conversations.search', array['conversations.view']::text[]),
      (
        'conversations.start',
        array['conversations.view', 'conversations.search']::text[]
      ),
      ('conversations.send', array['conversations.view']::text[]),
      ('members.view', array[]::text[]),
      ('members.customer_data.view', array['members.view']::text[]),
      ('members.account.view', array['members.view']::text[]),
      (
        'members.account.adjust',
        array['members.view', 'members.account.view']::text[]
      ),
      (
        'members.allergens.manage',
        array['members.view', 'members.customer_data.view']::text[]
      ),
      ('members.insights.view', array['members.view']::text[]),
      ('members.settings.manage', array['members.view']::text[])
  ),
  requested_permissions(permission) as (
    select item.permission
      from unnest(coalesce(p_permissions, '{}'::text[])) as item(permission)
  )
  select
    p_permissions is not null
    and cardinality(p_permissions) = (
      select count(distinct requested.permission)::integer
        from requested_permissions as requested
    )
    and not exists (
      select 1
        from requested_permissions as requested
        left join permission_catalog as catalog
          on catalog.permission = requested.permission
       where catalog.permission is null
    )
    and not exists (
      select 1
        from permission_catalog as catalog
       where catalog.permission = any(p_permissions)
         and not (catalog.dependencies <@ p_permissions)
    );
$$;
create table public.merchant_attendance_report_exports (
  merchant_id text not null,operation_id uuid not null,actor_auth_user_id uuid not null,
  actor_employee_id uuid,access text not null check(access in ('owner','self','manager')),
  query jsonb not null check(jsonb_typeof(query)='object' and octet_length(query::text)<=2048),
  worker_id uuid not null,location_id uuid,
  as_of timestamptz not null check(isfinite(as_of)),recorded_at timestamptz not null check(isfinite(recorded_at) and recorded_at>=as_of),
  source_sha256 text not null check(source_sha256~'^[0-9a-f]{64}$'),
  source_bytes integer not null check(source_bytes between 1 and 1048576),
  session_count integer not null check(session_count between 0 and 100),
  primary key(merchant_id,operation_id),
  foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id) on delete restrict,
  check((access='owner')=(actor_employee_id is null)),
  check((access='manager')=(location_id is not null))
);
create index attendance_report_export_actor_idx on public.merchant_attendance_report_exports(merchant_id,actor_auth_user_id,recorded_at desc,operation_id desc);
alter table public.merchant_attendance_report_exports enable row level security;
revoke all on public.merchant_attendance_report_exports from public,anon,authenticated,service_role;
create trigger attendance_report_export_no_rewrite before update or delete on public.merchant_attendance_report_exports for each row execute function public.faolla_attendance_events_append_only_v1();
create trigger attendance_report_export_no_truncate before truncate on public.merchant_attendance_report_exports for each statement execute function public.faolla_attendance_events_append_only_v1();

create function public.faolla_attendance_period_export_v1(p_site_id text,p_auth_user_id uuid,p_operation_id uuid,p_query jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
  e public.merchant_enterprise_employees%rowtype;r public.merchant_enterprise_roles%rowtype;
  rec public.merchant_attendance_report_exports%rowtype;
  access text;report jsonb;replayed boolean:=false;until_at timestamptz;receipt jsonb;
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_operation_id is null
    or p_operation_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_query is null or jsonb_typeof(p_query)<>'object' or octet_length(p_query::text)>2048
    or (select count(*) from jsonb_object_keys(p_query))<>8
    or not(p_query ?& array['access','workerId','locationId','expectedWorkerId','fromDate','throughDate','expectedTimeZone','expectedScopeRevision'])
    or coalesce(p_query->>'access','') not in ('owner','self','manager')
    or jsonb_typeof(p_query->'expectedTimeZone')<>'string' or char_length(p_query->>'expectedTimeZone') not between 1 and 100
    then raise exception 'attendance_invalid_request';end if;
  access:=p_query->>'access';
  if access='manager' then
    if jsonb_typeof(p_query->'expectedScopeRevision')<>'number' or (p_query->>'expectedScopeRevision') !~ '^[1-9][0-9]{0,15}$'
      or (p_query->>'expectedScopeRevision')::bigint>9007199254740990 then raise exception 'attendance_invalid_request';end if;
  elsif p_query->'expectedScopeRevision'<>'null'::jsonb then raise exception 'attendance_invalid_request';end if;
  if access='owner' and (p_query->'locationId'<>'null'::jsonb or p_query->'expectedWorkerId'<>'null'::jsonb)
    or access='self' and p_query->'expectedWorkerId'='null'::jsonb then raise exception 'attendance_invalid_request';end if;

  -- Keep the original reader lock order. Extra export permission is checked
  -- under the same role lock, then the established reader rechecks full scope.
  perform 1 from public.merchants where id=p_site_id and (access<>'owner' or user_id=p_auth_user_id) for share;
  if not found then raise exception 'attendance_access_denied';end if;
  perform 1 from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  if access<>'owner' then
    select * into e from public.merchant_enterprise_employees where merchant_id=p_site_id and auth_user_id=p_auth_user_id for share;
    if not found or e.status<>'active' then raise exception 'attendance_access_denied';end if;
    select * into r from public.merchant_enterprise_roles where merchant_id=p_site_id and id=e.role_id for share;
    if not found or r.status<>'active' or not public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions)
      or not((case when access='self' then 'attendance.self.export' else 'attendance.reports.export' end)=any(r.permissions))
      then raise exception 'attendance_export_denied';end if;
  end if;
  if access='owner' then
    report:=public.faolla_attendance_period_report_v1(p_site_id,p_auth_user_id,p_query-array['access','locationId','expectedWorkerId','expectedTimeZone','expectedScopeRevision']);
  else
    report:=public.faolla_attendance_scoped_period_report_v1(p_site_id,p_auth_user_id,p_query-array['expectedTimeZone','expectedScopeRevision']);
  end if;
  if report->>'timeZone'<>p_query->>'expectedTimeZone' then raise exception 'attendance_report_zone_changed';end if;
  if access='manager' and report->'scopeRevision'<>p_query->'expectedScopeRevision' then raise exception 'attendance_version_conflict';end if;
  until_at:=(report->>'accessValidUntil')::timestamptz;
  if until_at is not null and clock_timestamp()>=until_at then raise exception 'attendance_access_denied';end if;

  -- Metadata-only receipt: no report JSON, CSV, names, addresses or coordinates.
  -- Concurrent identical IDs insert once. A replay never regenerates different
  -- evidence under the earlier ID, nor returns the earlier export's contents.
  insert into public.merchant_attendance_report_exports(merchant_id,operation_id,actor_auth_user_id,actor_employee_id,access,query,
    worker_id,location_id,as_of,recorded_at,source_sha256,source_bytes,session_count)
  values(p_site_id,p_operation_id,p_auth_user_id,e.id,access,p_query,
    (report->>'workerId')::uuid,case when access='manager' then (report->>'locationId')::uuid else null end,
    (report->>'asOf')::timestamptz,clock_timestamp(),encode(sha256(convert_to(report::text,'UTF8')),'hex'),octet_length(report::text),jsonb_array_length(report->'items'))
  on conflict(merchant_id,operation_id) do nothing returning * into rec;
  if not found then
    replayed:=true;select * into rec from public.merchant_attendance_report_exports where merchant_id=p_site_id and operation_id=p_operation_id;
    if rec.actor_auth_user_id<>p_auth_user_id or rec.query<>p_query then raise exception 'attendance_operation_conflict';end if;
  end if;
  if until_at is not null and clock_timestamp()>=until_at then raise exception 'attendance_access_denied';end if;
  receipt:=jsonb_build_object('operationId',rec.operation_id,'siteId',rec.merchant_id,'access',rec.access,'workerId',rec.worker_id,'locationId',rec.location_id,
    'fromDate',rec.query->'fromDate','throughDate',rec.query->'throughDate','timeZone',rec.query->'expectedTimeZone','scopeRevision',rec.query->'expectedScopeRevision',
    'asOf',to_char(rec.as_of at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'recordedAt',to_char(rec.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'sourceSha256',rec.source_sha256,'sourceBytes',rec.source_bytes,
    'sessionCount',rec.session_count,'schemaVersion',1,'status','source_read','downloadConfirmed',false);
  return jsonb_build_object('receipt',receipt,'replayed',replayed,'report',case when replayed then 'null'::jsonb else report end);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end; $$;
revoke all on function public.faolla_attendance_period_export_v1(text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_period_export_v1(text,uuid,uuid,jsonb) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610010090,'merchant_attendance_period_export') on conflict(version) do nothing;
commit;
