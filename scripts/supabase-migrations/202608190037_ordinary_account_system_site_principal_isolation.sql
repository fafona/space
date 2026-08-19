-- Remove only Auth principals that simultaneously occupy the platform-wide
-- site sentinel and an ordinary merchant/personal/staff authorization plane.
-- Independent system principals and all contact/content fields are preserved.

begin;

set local quote_all_identifiers = off;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

do $$
declare
  v_registered boolean := false;
  v_existing_update_policy record;
  v_existing_insert_policy record;
  v_update_policy_exists boolean := false;
  v_insert_policy_exists boolean := false;
begin
  if to_regclass('auth.users') is null
     or to_regclass('public.merchants') is null
     or to_regclass('public.faolla_personal_accounts') is null
     or to_regclass('public.merchant_enterprise_staff_identities') is null
     or to_regclass('public.faolla_schema_migrations') is null
     or to_regprocedure(
       'public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()'
     ) is null
     or not exists (
       select 1
         from public.faolla_schema_migrations as migration
        where migration.version = 202608190035
          and migration.name =
            'ordinary_account_authorization_foundation'
     )
     or not exists (
       select 1
         from public.faolla_schema_migrations as migration
        where migration.version = 202608190036
          and migration.name =
            'ordinary_account_authorization_bootstrap'
     ) then
    raise exception 'ordinary_account_system_site_isolation_prerequisite_missing';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_roles as role_metadata
     where role_metadata.rolname = 'authenticated'
       and not role_metadata.rolbypassrls
  )
     or not exists (
       select 1
         from pg_catalog.pg_roles as role_metadata
        where role_metadata.rolname = 'service_role'
          and role_metadata.rolbypassrls
     ) then
    raise exception 'ordinary_account_system_site_isolation_role_invalid';
  end if;

  if exists (
    select 1
      from public.faolla_schema_migrations as migration
     where migration.version = 202608190037
       and migration.name <>
         'ordinary_account_system_site_principal_isolation'
  ) then
    raise exception 'ordinary_account_system_site_isolation_registry_conflict';
  end if;

  select exists (
    select 1
      from public.faolla_schema_migrations as migration
     where migration.version = 202608190037
       and migration.name =
         'ordinary_account_system_site_principal_isolation'
  ) into v_registered;

  if exists (
    select 1
      from (values
        ('id', 'text'::regtype, true),
        ('user_id', 'uuid'::regtype, false),
        ('auth_user_id', 'uuid'::regtype, false),
        ('owner_user_id', 'uuid'::regtype, false),
        ('owner_id', 'uuid'::regtype, false),
        ('auth_id', 'uuid'::regtype, false),
        ('created_by', 'uuid'::regtype, false),
        ('created_by_user_id', 'uuid'::regtype, false)
      ) as expected_column(column_name, type_oid, is_not_null)
     where not exists (
       select 1
         from pg_catalog.pg_attribute as table_attribute
        where table_attribute.attrelid = 'public.merchants'::regclass
          and table_attribute.attname = expected_column.column_name
          and table_attribute.atttypid = expected_column.type_oid
          and table_attribute.attnotnull = expected_column.is_not_null
          and table_attribute.attidentity = ''
          and table_attribute.attgenerated = ''
          and not table_attribute.attisdropped
     )
  ) then
    raise exception 'ordinary_account_system_site_isolation_schema_invalid';
  end if;

  if not coalesce((
    select table_metadata.relkind = 'r'
      and table_metadata.relpersistence = 'p'
      and table_metadata.relrowsecurity
      and table_metadata.relowner = current_user::regrole
      from pg_catalog.pg_class as table_metadata
     where table_metadata.oid = 'public.merchants'::regclass
  ), false)
     or not has_table_privilege(
       'authenticated', 'public.merchants', 'UPDATE'
     )
     or not has_table_privilege(
       'authenticated', 'public.merchants', 'INSERT'
     )
     or not exists (
       select 1
         from pg_catalog.pg_policies as policy
        where policy.schemaname = 'public'
          and policy.tablename = 'merchants'
          and policy.policyname = 'merchants_update_own'
          and policy.permissive = 'PERMISSIVE'
          and policy.roles = array['authenticated']::name[]
          and policy.cmd = 'UPDATE'
     )
     or not exists (
       select 1
         from pg_catalog.pg_policies as policy
        where policy.schemaname = 'public'
          and policy.tablename = 'merchants'
          and policy.policyname = 'merchants_insert_self'
          and policy.permissive = 'PERMISSIVE'
          and policy.roles = array['authenticated']::name[]
          and policy.cmd = 'INSERT'
     ) then
    raise exception 'ordinary_account_system_site_isolation_policy_prerequisite_invalid';
  end if;

  select policy.*
    into v_existing_update_policy
    from pg_catalog.pg_policies as policy
   where policy.schemaname = 'public'
     and policy.tablename = 'merchants'
     and policy.policyname =
       'merchants_system_site_principal_isolation';
  v_update_policy_exists := found;

  if v_update_policy_exists and (
    v_existing_update_policy.permissive <> 'RESTRICTIVE'
    or v_existing_update_policy.roles <> array['authenticated']::name[]
    or v_existing_update_policy.cmd <> 'UPDATE'
    or regexp_replace(
      lower(coalesce(v_existing_update_policy.qual, '')),
      '[[:space:]()]',
      '',
      'g'
    ) <> 'id<>''site-main''::text'
    or regexp_replace(
      lower(coalesce(v_existing_update_policy.with_check, '')),
      '[[:space:]()]',
      '',
      'g'
    ) <> 'id<>''site-main''::text'
  ) then
    raise exception 'ordinary_account_system_site_isolation_policy_conflict';
  end if;

  select policy.*
    into v_existing_insert_policy
    from pg_catalog.pg_policies as policy
   where policy.schemaname = 'public'
     and policy.tablename = 'merchants'
     and policy.policyname =
       'merchants_system_site_principal_insert_isolation';
  v_insert_policy_exists := found;

  if v_insert_policy_exists and (
    v_existing_insert_policy.permissive <> 'RESTRICTIVE'
    or v_existing_insert_policy.roles <>
      array['authenticated']::name[]
    or v_existing_insert_policy.cmd <> 'INSERT'
    or v_existing_insert_policy.qual is not null
    or regexp_replace(
      lower(coalesce(v_existing_insert_policy.with_check, '')),
      '[[:space:]()]',
      '',
      'g'
    ) <> 'id<>''site-main''::text'
  ) then
    raise exception 'ordinary_account_system_site_isolation_policy_conflict';
  end if;

  if v_registered and (
    not v_update_policy_exists or not v_insert_policy_exists
  ) then
    raise exception 'ordinary_account_system_site_isolation_registered_state_invalid';
  end if;
end;
$$;

-- Serialize with every 036 positive ordinary/staff/Auth-delete writer. Those
-- writers take this advisory lock before locking personal accounts followed by
-- merchants; retaining the same order avoids a new lock cycle.
select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'faolla:ordinary-account-binding-v1',
    0
  )
);

lock table
  public.faolla_personal_accounts,
  public.merchants
  in share row exclusive mode;

-- The legacy permissive owner policies still accept UUID and email aliases.
-- These narrow restrictive policies prevent an authenticated session from
-- reattaching a UUID to an existing site-main row or recreating a missing
-- sentinel before the later full RLS cutover. They do not alter SELECT and do
-- not apply to the BYPASSRLS service_role used by platform operations.
do $$
begin
  if not exists (
    select 1
      from pg_catalog.pg_policies as policy
     where policy.schemaname = 'public'
       and policy.tablename = 'merchants'
      and policy.policyname =
         'merchants_system_site_principal_isolation'
  ) then
    create policy merchants_system_site_principal_isolation
    on public.merchants
    as restrictive
    for update
    to authenticated
    using (id <> 'site-main')
    with check (id <> 'site-main');
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_policies as policy
     where policy.schemaname = 'public'
       and policy.tablename = 'merchants'
       and policy.policyname =
         'merchants_system_site_principal_insert_isolation'
  ) then
    create policy merchants_system_site_principal_insert_isolation
    on public.merchants
    as restrictive
    for insert
    to authenticated
    with check (id <> 'site-main');
  end if;
end;
$$;

do $$
declare
  v_before_readiness jsonb;
  v_after_readiness jsonb;
  v_overlap_auth_user_ids uuid[] := array[]::uuid[];
  v_after_overlap_count integer := 0;
  v_before_system_overlap_count integer := 0;
  v_site_before public.merchants%rowtype;
  v_site_after public.merchants%rowtype;
  v_site_existed boolean := false;
  v_expected_update_count integer := 0;
  v_updated_count integer := 0;
begin
  v_before_readiness :=
    public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1();

  if coalesce(jsonb_typeof(v_before_readiness), '') <> 'object'
     or v_before_readiness ->> 'schemaVersion' <> '1'
     or coalesce(
       jsonb_typeof(v_before_readiness -> 'security'),
       ''
     ) <> 'object' then
    raise exception 'ordinary_account_system_site_isolation_readiness_invalid';
  end if;

  with system_site_principals as materialized (
    select distinct system_alias.auth_user_id
      from public.merchants as system_site
      cross join lateral unnest(array[
        system_site.user_id,
        system_site.auth_user_id,
        system_site.owner_user_id,
        system_site.owner_id,
        system_site.auth_id,
        system_site.created_by,
        system_site.created_by_user_id
      ]::uuid[]) as system_alias(auth_user_id)
     where system_site.id = 'site-main'
       and system_alias.auth_user_id is not null
  ), protected_principals as materialized (
    select distinct ordinary_alias.auth_user_id
      from public.merchants as ordinary_merchant
      cross join lateral unnest(array[
        ordinary_merchant.user_id,
        ordinary_merchant.auth_user_id,
        ordinary_merchant.owner_user_id,
        ordinary_merchant.owner_id,
        ordinary_merchant.auth_id,
        ordinary_merchant.created_by,
        ordinary_merchant.created_by_user_id
      ]::uuid[]) as ordinary_alias(auth_user_id)
     where ordinary_merchant.id <> 'site-main'
       and ordinary_alias.auth_user_id is not null
    union
    select personal_account.auth_user_id
      from public.faolla_personal_accounts as personal_account
    union
    select staff_identity.auth_user_id
      from public.merchant_enterprise_staff_identities as staff_identity
  )
  select coalesce(
    array_agg(
      system_principal.auth_user_id
      order by system_principal.auth_user_id
    ),
    array[]::uuid[]
  )
    into v_overlap_auth_user_ids
    from system_site_principals as system_principal
    join protected_principals as protected_principal
      using (auth_user_id);

  begin
    v_before_system_overlap_count :=
      (v_before_readiness #>>
        '{security,systemSitePrincipalOverlapCount}')::integer;
  exception when others then
    raise exception 'ordinary_account_system_site_isolation_readiness_invalid';
  end;

  if v_before_system_overlap_count < 0
     or v_before_system_overlap_count <>
       cardinality(v_overlap_auth_user_ids) then
    raise exception 'ordinary_account_system_site_isolation_overlap_drift';
  end if;

  select system_site.*
    into v_site_before
    from public.merchants as system_site
   where system_site.id = 'site-main';
  v_site_existed := found;

  if v_site_existed then
    select count(*)::integer
      into v_expected_update_count
      from unnest(array[
        v_site_before.user_id,
        v_site_before.auth_user_id,
        v_site_before.owner_user_id,
        v_site_before.owner_id,
        v_site_before.auth_id,
        v_site_before.created_by,
        v_site_before.created_by_user_id
      ]::uuid[]) as site_alias(auth_user_id)
     where site_alias.auth_user_id = any(v_overlap_auth_user_ids);
  end if;

  update public.merchants as system_site
     set user_id = case
           when system_site.user_id = any(v_overlap_auth_user_ids)
             then null
           else system_site.user_id
         end,
         auth_user_id = case
           when system_site.auth_user_id = any(v_overlap_auth_user_ids)
             then null
           else system_site.auth_user_id
         end,
         owner_user_id = case
           when system_site.owner_user_id = any(v_overlap_auth_user_ids)
             then null
           else system_site.owner_user_id
         end,
         owner_id = case
           when system_site.owner_id = any(v_overlap_auth_user_ids)
             then null
           else system_site.owner_id
         end,
         auth_id = case
           when system_site.auth_id = any(v_overlap_auth_user_ids)
             then null
           else system_site.auth_id
         end,
         created_by = case
           when system_site.created_by = any(v_overlap_auth_user_ids)
             then null
           else system_site.created_by
         end,
         created_by_user_id = case
           when system_site.created_by_user_id =
             any(v_overlap_auth_user_ids)
             then null
           else system_site.created_by_user_id
         end
   where system_site.id = 'site-main'
     and v_expected_update_count > 0;

  get diagnostics v_updated_count = row_count;

  if v_updated_count <> (case
       when v_expected_update_count > 0 then 1
       else 0
     end) then
    raise exception 'ordinary_account_system_site_isolation_update_invalid';
  end if;

  select system_site.*
    into v_site_after
    from public.merchants as system_site
   where system_site.id = 'site-main';

  if found <> v_site_existed then
    raise exception 'ordinary_account_system_site_isolation_site_drift';
  end if;

  if v_site_existed and (
    to_jsonb(v_site_after) - array[
      'user_id', 'auth_user_id', 'owner_user_id', 'owner_id', 'auth_id',
      'created_by', 'created_by_user_id', 'updated_at'
    ]::text[]
      is distinct from
    to_jsonb(v_site_before) - array[
      'user_id', 'auth_user_id', 'owner_user_id', 'owner_id', 'auth_id',
      'created_by', 'created_by_user_id', 'updated_at'
    ]::text[]
  ) then
    raise exception 'ordinary_account_system_site_isolation_content_drift';
  end if;

  if v_site_existed and (
    v_site_after.user_id is distinct from case
      when v_site_before.user_id = any(v_overlap_auth_user_ids)
        then null::uuid else v_site_before.user_id end
    or v_site_after.auth_user_id is distinct from case
      when v_site_before.auth_user_id = any(v_overlap_auth_user_ids)
        then null::uuid else v_site_before.auth_user_id end
    or v_site_after.owner_user_id is distinct from case
      when v_site_before.owner_user_id = any(v_overlap_auth_user_ids)
        then null::uuid else v_site_before.owner_user_id end
    or v_site_after.owner_id is distinct from case
      when v_site_before.owner_id = any(v_overlap_auth_user_ids)
        then null::uuid else v_site_before.owner_id end
    or v_site_after.auth_id is distinct from case
      when v_site_before.auth_id = any(v_overlap_auth_user_ids)
        then null::uuid else v_site_before.auth_id end
    or v_site_after.created_by is distinct from case
      when v_site_before.created_by = any(v_overlap_auth_user_ids)
        then null::uuid else v_site_before.created_by end
    or v_site_after.created_by_user_id is distinct from case
      when v_site_before.created_by_user_id = any(v_overlap_auth_user_ids)
        then null::uuid else v_site_before.created_by_user_id end
  ) then
    raise exception 'ordinary_account_system_site_isolation_alias_drift';
  end if;

  with system_site_principals as materialized (
    select distinct system_alias.auth_user_id
      from public.merchants as system_site
      cross join lateral unnest(array[
        system_site.user_id,
        system_site.auth_user_id,
        system_site.owner_user_id,
        system_site.owner_id,
        system_site.auth_id,
        system_site.created_by,
        system_site.created_by_user_id
      ]::uuid[]) as system_alias(auth_user_id)
     where system_site.id = 'site-main'
       and system_alias.auth_user_id is not null
  ), protected_principals as materialized (
    select distinct ordinary_alias.auth_user_id
      from public.merchants as ordinary_merchant
      cross join lateral unnest(array[
        ordinary_merchant.user_id,
        ordinary_merchant.auth_user_id,
        ordinary_merchant.owner_user_id,
        ordinary_merchant.owner_id,
        ordinary_merchant.auth_id,
        ordinary_merchant.created_by,
        ordinary_merchant.created_by_user_id
      ]::uuid[]) as ordinary_alias(auth_user_id)
     where ordinary_merchant.id <> 'site-main'
       and ordinary_alias.auth_user_id is not null
    union
    select personal_account.auth_user_id
      from public.faolla_personal_accounts as personal_account
    union
    select staff_identity.auth_user_id
      from public.merchant_enterprise_staff_identities as staff_identity
  )
  select count(*)::integer
    into v_after_overlap_count
    from system_site_principals as system_principal
    join protected_principals as protected_principal
      using (auth_user_id);

  v_after_readiness :=
    public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1();

  if v_after_overlap_count <> 0
     or coalesce(
       (v_after_readiness #>>
         '{security,systemSitePrincipalOverlapCount}')::integer,
       -1
     ) <> 0
     or (
       (v_after_readiness - 'asOf' - 'readyForCutover') #-
         '{security,systemSitePrincipalOverlapCount}'
     ) is distinct from (
       (v_before_readiness - 'asOf' - 'readyForCutover') #-
         '{security,systemSitePrincipalOverlapCount}'
     ) then
    raise exception 'ordinary_account_system_site_isolation_postcondition_failed';
  end if;
end;
$$;

insert into public.faolla_schema_migrations (version, name)
values (
  202608190037,
  'ordinary_account_system_site_principal_isolation'
)
on conflict (version) do nothing;

do $$
begin
  if not exists (
    select 1
      from public.faolla_schema_migrations as migration
     where migration.version = 202608190037
       and migration.name =
         'ordinary_account_system_site_principal_isolation'
  )
     or not exists (
       select 1
         from pg_catalog.pg_policies as policy
        where policy.schemaname = 'public'
          and policy.tablename = 'merchants'
          and policy.policyname =
            'merchants_system_site_principal_isolation'
          and policy.permissive = 'RESTRICTIVE'
          and policy.roles = array['authenticated']::name[]
          and policy.cmd = 'UPDATE'
          and regexp_replace(
            lower(coalesce(policy.qual, '')),
            '[[:space:]()]',
            '',
            'g'
          ) = 'id<>''site-main''::text'
          and regexp_replace(
            lower(coalesce(policy.with_check, '')),
            '[[:space:]()]',
            '',
            'g'
          ) = 'id<>''site-main''::text'
     )
     or not exists (
       select 1
         from pg_catalog.pg_policies as policy
        where policy.schemaname = 'public'
          and policy.tablename = 'merchants'
          and policy.policyname =
            'merchants_system_site_principal_insert_isolation'
          and policy.permissive = 'RESTRICTIVE'
          and policy.roles = array['authenticated']::name[]
          and policy.cmd = 'INSERT'
          and policy.qual is null
          and regexp_replace(
            lower(coalesce(policy.with_check, '')),
            '[[:space:]()]',
            '',
            'g'
          ) = 'id<>''site-main''::text'
     ) then
    raise exception 'ordinary_account_system_site_isolation_registry_invalid';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
