-- Candidate only. An explicit capability, not a personnel/location grant.
-- Existing role rows and all previous catalog entries remain unchanged.
begin;
set local lock_timeout='3s';

do $correction_permission_prerequisite$
declare installed boolean; existing_definition pg_proc%rowtype;
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610080189 and name='merchant_attendance_correction_delegation') then
    raise exception 'merchant_attendance_correction_delegation_prerequisite_required';
  end if;
  if exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name<>'merchant_attendance_correction_delegation_permission') then
    raise exception 'merchant_attendance_correction_delegation_installation_conflict';
  end if;
  select exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission') into installed;
  select * into existing_definition from pg_proc where oid=to_regprocedure('public.faolla_valid_merchant_enterprise_permissions_v1(text[])');
  if existing_definition.oid is null or existing_definition.proowner<>(select oid from pg_roles where rolname=current_user)
    or existing_definition.prosecdef or existing_definition.provolatile<>'i'
    or existing_definition.proconfig is distinct from array['search_path=pg_catalog, public']
    or md5(replace(existing_definition.prosrc,E'\r\n',E'\n')) is distinct from
      (case when installed then '9f6804368bcda77f14791f08d73d365b' else 'c009b4c0749d431e570711baefbb7dff' end) then
    raise exception 'merchant_attendance_correction_delegation_permission_drift';
  end if;
end;
$correction_permission_prerequisite$;

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
      ('attendance.self.leave', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.self.work_arrangement', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.missing.review', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.correction.review', array['enterprise.view']::text[]),
      ('attendance.leave.review', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.work_arrangement.review', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.schedule.publish', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.schedule.cancel', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.period.view', array['enterprise.view']::text[]),
      ('attendance.period.send', array['enterprise.view', 'attendance.period.view']::text[]),
      ('attendance.period.respond', array['enterprise.view', 'attendance.period.view']::text[]),
      ('attendance.period.seal', array['enterprise.view', 'attendance.period.view']::text[]),
      ('attendance.period.reopen', array['enterprise.view', 'attendance.period.view']::text[]),
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

insert into public.faolla_schema_migrations(version,name) values(202610080190,'merchant_attendance_correction_delegation_permission') on conflict(version) do nothing;
notify pgrst, 'reload schema';
commit;
