begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Cut over only after browser publishing uses the authenticated server API.
-- Old cached browsers must fail closed; this is not a global maintenance fence.
-- Preserve every row, SELECT grant, read policy, service-role grant and other
-- relation. Never follow an inherited grant into an unknown role or CASCADE.
do $pages_client_write_acl$
declare
  v_pages oid := pg_catalog.to_regclass('public.pages');
  v_registry oid := pg_catalog.to_regclass('public.faolla_schema_migrations');
  v_role record;
  v_column record;
  v_before jsonb;
  v_after jsonb;
begin
  if v_pages is null or v_registry is null
     or not exists (select 1 from pg_catalog.pg_class where oid = v_pages and relkind = 'r')
     or not exists (select 1 from pg_catalog.pg_class where oid = v_registry and relkind = 'r')
     or (select count(*) from pg_catalog.pg_roles where rolname in ('anon', 'authenticated', 'service_role')) <> 3 then
    raise exception 'pages_client_write_acl_dependency_missing';
  end if;
  if exists (select 1 from public.faolla_schema_migrations where version = 202609090048
              and name <> 'pages_client_write_acl') then
    raise exception 'pages_client_write_acl_registry_conflict';
  end if;
  if exists (select 1 from (values
      (202609080044::bigint, 'qr_token_atomic_mutation'),
      (202609080045::bigint, 'order_membership_atomic_mutation'),
      (202609080046::bigint, 'redemption_atomic_mutation'),
      (202609080047::bigint, 'redemption_checkout_context')
    ) required(version, name)
    where not exists (select 1 from public.faolla_schema_migrations actual
                       where actual.version = required.version and actual.name = required.name))
     or pg_catalog.to_regprocedure('public.faolla_mutate_qr_token_v1(text,text,text)') is null
     or pg_catalog.to_regprocedure('public.faolla_commit_order_membership_v1(text,jsonb)') is null
     or pg_catalog.to_regprocedure('public.faolla_commit_redemption_v1(text,jsonb)') is null
     or pg_catalog.to_regprocedure('public.faolla_commit_redemption_v2(text,text,jsonb,jsonb)') is null then
    raise exception 'pages_client_write_acl_dependency_missing';
  end if;

  -- Bound the ACL cutover against concurrent table DDL/DML. Maintenance must
  -- already exclude old writers; this short lock is not a lasting write fence.
  lock table public.pages in access exclusive mode;

  select jsonb_object_agg(r.rolname, jsonb_build_object(
    'select', pg_catalog.has_table_privilege(r.oid, v_pages, 'SELECT'),
    'columns', (select jsonb_object_agg(a.attname, jsonb_build_object(
      'select', pg_catalog.has_column_privilege(r.oid, v_pages, a.attnum, 'SELECT'),
      'insert', case when r.rolname = 'service_role' then pg_catalog.has_column_privilege(r.oid, v_pages, a.attnum, 'INSERT') else null end,
      'update', case when r.rolname = 'service_role' then pg_catalog.has_column_privilege(r.oid, v_pages, a.attnum, 'UPDATE') else null end))
      from pg_catalog.pg_attribute a where a.attrelid = v_pages and a.attnum > 0 and not a.attisdropped),
    'insert', case when r.rolname = 'service_role' then pg_catalog.has_table_privilege(r.oid, v_pages, 'INSERT') else null end,
    'update', case when r.rolname = 'service_role' then pg_catalog.has_table_privilege(r.oid, v_pages, 'UPDATE') else null end,
    'delete', case when r.rolname = 'service_role' then pg_catalog.has_table_privilege(r.oid, v_pages, 'DELETE') else null end))
    into v_before from pg_catalog.pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role');

  revoke insert, update, delete on table public.pages from public, anon, authenticated;
  -- A table-level REVOKE does not remove independent column-level grants.
  for v_column in select attname from pg_catalog.pg_attribute
    where attrelid = v_pages and attnum > 0 and not attisdropped order by attnum
  loop
    execute pg_catalog.format('revoke insert (%I), update (%I) on table public.pages from public, anon, authenticated',
                              v_column.attname, v_column.attname);
  end loop;

  for v_role in select oid from pg_catalog.pg_roles where rolname in ('anon', 'authenticated')
  loop
    if exists (select 1 from pg_catalog.pg_class where oid = v_pages and relowner = v_role.oid)
       or pg_catalog.has_table_privilege(v_role.oid, v_pages, 'INSERT')
       or pg_catalog.has_table_privilege(v_role.oid, v_pages, 'UPDATE')
       or pg_catalog.has_table_privilege(v_role.oid, v_pages, 'DELETE')
       or pg_catalog.has_any_column_privilege(v_role.oid, v_pages, 'INSERT')
       or pg_catalog.has_any_column_privilege(v_role.oid, v_pages, 'UPDATE') then
      raise exception 'pages_client_write_acl_effective_write_remains';
    end if;
  end loop;

  select jsonb_object_agg(r.rolname, jsonb_build_object(
    'select', pg_catalog.has_table_privilege(r.oid, v_pages, 'SELECT'),
    'columns', (select jsonb_object_agg(a.attname, jsonb_build_object(
      'select', pg_catalog.has_column_privilege(r.oid, v_pages, a.attnum, 'SELECT'),
      'insert', case when r.rolname = 'service_role' then pg_catalog.has_column_privilege(r.oid, v_pages, a.attnum, 'INSERT') else null end,
      'update', case when r.rolname = 'service_role' then pg_catalog.has_column_privilege(r.oid, v_pages, a.attnum, 'UPDATE') else null end))
      from pg_catalog.pg_attribute a where a.attrelid = v_pages and a.attnum > 0 and not a.attisdropped),
    'insert', case when r.rolname = 'service_role' then pg_catalog.has_table_privilege(r.oid, v_pages, 'INSERT') else null end,
    'update', case when r.rolname = 'service_role' then pg_catalog.has_table_privilege(r.oid, v_pages, 'UPDATE') else null end,
    'delete', case when r.rolname = 'service_role' then pg_catalog.has_table_privilege(r.oid, v_pages, 'DELETE') else null end))
    into v_after from pg_catalog.pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role');
  if v_after is distinct from v_before then
    raise exception 'pages_client_write_acl_preserved_privilege_changed';
  end if;

  insert into public.faolla_schema_migrations(version, name)
  values (202609090048, 'pages_client_write_acl')
  on conflict (version) do nothing;
  if not exists (select 1 from public.faolla_schema_migrations
                  where version = 202609090048 and name = 'pages_client_write_acl') then
    raise exception 'pages_client_write_acl_registry_conflict';
  end if;
end;
$pages_client_write_acl$;

notify pgrst, 'reload schema';
commit;
