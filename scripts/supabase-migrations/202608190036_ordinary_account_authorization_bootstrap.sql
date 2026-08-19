-- Add service-only positive create/bootstrap operations before any legacy
-- ordinary-account authorization path is removed. This migration is
-- deliberately additive so production can backfill canonical identities and
-- deploy positive resolver consumers before the later RLS cutover.

begin;

set local quote_all_identifiers = off;

do $$
begin
  if to_regclass('auth.users') is null
     or to_regclass('public.merchants') is null
     or to_regclass('public.pages') is null
     or to_regclass('public.faolla_personal_accounts') is null
     or to_regclass('public.merchant_enterprise_staff_identities') is null
     or to_regclass('public.faolla_schema_migrations') is null
     or to_regprocedure(
       'public.faolla_resolve_ordinary_account_authorization_v1(uuid)'
     ) is null
     or to_regprocedure(
       'public.faolla_guard_personal_account_binding_v1()'
     ) is null
     or to_regprocedure(
       'public.faolla_get_ordinary_account_authorization_readiness_v1()'
     ) is null
     or not exists (
       select 1
         from public.faolla_schema_migrations as migration
        where migration.version = 202608190035
          and migration.name =
            'ordinary_account_authorization_foundation'
     ) then
    raise exception 'ordinary_account_bootstrap_prerequisite_missing';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'service_role'
  ) or not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'authenticated'
  ) or not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'anon'
  ) then
    raise exception 'ordinary_account_bootstrap_role_missing';
  end if;

  if exists (
    select 1
      from public.faolla_schema_migrations as migration
     where migration.version = 202608190036
       and migration.name <>
         'ordinary_account_authorization_bootstrap'
  ) then
    raise exception 'ordinary_account_bootstrap_registry_conflict';
  end if;
end;
$$;

-- Migration 035 can be installed while quote_all_identifiers is enabled by
-- an external runner. Normalize the inherited guard configuration explicitly
-- and make the canonical table owner-only before any new positive writer is
-- exposed. REVOKE CASCADE removes grants delegated through a custom role.
alter table public.faolla_personal_accounts
  owner to current_user;
alter function public.faolla_guard_personal_account_binding_v1()
  owner to current_user;
alter function public.faolla_guard_personal_account_binding_v1()
  set search_path = pg_catalog, public;
alter function public.faolla_get_ordinary_account_authorization_readiness_v1()
  set search_path = pg_catalog, public;

do $$
declare
  v_table_oid oid := 'public.faolla_personal_accounts'::regclass;
  v_table_owner oid;
  v_grantee record;
begin
  select table_metadata.relowner
    into v_table_owner
    from pg_catalog.pg_class as table_metadata
   where table_metadata.oid = v_table_oid;

  for v_grantee in
    select distinct table_acl.grantee, grantee_role.rolname
      from pg_catalog.aclexplode(coalesce(
        (select table_acl_metadata.relacl
           from pg_catalog.pg_class as table_acl_metadata
          where table_acl_metadata.oid = v_table_oid),
        pg_catalog.acldefault('r', v_table_owner)
      )) as table_acl
      left join pg_catalog.pg_roles as grantee_role
        on grantee_role.oid = table_acl.grantee
     where table_acl.grantee <> v_table_owner
  loop
    if v_grantee.grantee = 0 then
      revoke all privileges on table public.faolla_personal_accounts
        from public cascade;
    else
      execute format(
        'revoke all privileges on table public.faolla_personal_accounts from %I cascade',
        v_grantee.rolname
      );
    end if;
  end loop;

  -- Table-level REVOKE does not remove grants made directly on columns.
  -- Remove every non-owner column grantee as a separate ACL surface, with
  -- CASCADE so privileges delegated through a custom API role disappear too.
  for v_grantee in
    select
      column_acl.grantee,
      grantee_role.rolname,
      string_agg(
        format('%I', table_column.attname),
        ', ' order by table_column.attnum
      ) as column_names
      from pg_catalog.pg_attribute as table_column
      cross join lateral pg_catalog.aclexplode(
        table_column.attacl
      ) as column_acl
      left join pg_catalog.pg_roles as grantee_role
        on grantee_role.oid = column_acl.grantee
     where table_column.attrelid = v_table_oid
       and table_column.attnum > 0
       and not table_column.attisdropped
       and column_acl.grantee <> v_table_owner
     group by column_acl.grantee, grantee_role.rolname
  loop
    if v_grantee.grantee = 0 then
      execute format(
        'revoke all privileges (%s) on table public.faolla_personal_accounts from public cascade',
        v_grantee.column_names
      );
    else
      execute format(
        'revoke all privileges (%s) on table public.faolla_personal_accounts from %I cascade',
        v_grantee.column_names,
        v_grantee.rolname
      );
    end if;
  end loop;
end;
$$;

revoke all privileges on table public.faolla_personal_accounts
  from public, anon, authenticated, service_role;

drop function if exists
  public.faolla_bind_ordinary_account_authorization_v1(uuid, text, text);

-- `site-main` is the platform-wide site sentinel, not an ordinary merchant.
-- Keep the resolver envelope unchanged, but reject any attempt to interpret
-- its operational Auth alias as an ordinary account binding.
create or replace function
  public.faolla_resolve_ordinary_account_authorization_v1(
    p_auth_user_id uuid
  )
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_system_site_id constant text := 'site-main';
  v_merchant_ids text[] := array[]::text[];
  v_personal_account_id text := null;
  v_personal_status text := null;
begin
  if p_auth_user_id is null then
    raise exception 'invalid_ordinary_account_authorization_query';
  end if;

  if not exists (
    select 1
      from auth.users as auth_user
     where auth_user.id = p_auth_user_id
  ) then
    raise exception 'ordinary_account_auth_user_not_found';
  end if;

  if exists (
    select 1
      from public.merchant_enterprise_staff_identities as staff_identity
     where staff_identity.auth_user_id = p_auth_user_id
  ) then
    raise exception 'ordinary_account_staff_identity_forbidden';
  end if;

  if exists (
    select 1
      from public.merchants as merchant
     where merchant.id = v_system_site_id
       and p_auth_user_id = any(array_remove(array[
         merchant.user_id,
         merchant.auth_user_id,
         merchant.owner_user_id,
         merchant.owner_id,
         merchant.auth_id,
         merchant.created_by,
         merchant.created_by_user_id
       ]::uuid[], null::uuid))
  ) then
    raise exception 'ordinary_account_system_site_forbidden';
  end if;

  if exists (
    select 1
      from public.merchants as merchant
     where merchant.id <> v_system_site_id
       and p_auth_user_id = any(array_remove(array[
         merchant.user_id,
         merchant.auth_user_id,
         merchant.owner_user_id,
         merchant.owner_id,
         merchant.auth_id,
         merchant.created_by,
         merchant.created_by_user_id
       ]::uuid[], null::uuid))
       and (
         merchant.id !~ '^[0-9]{8}$'
         or (
           select count(distinct alias_id)
             from unnest(array[
               merchant.user_id,
               merchant.auth_user_id,
               merchant.owner_user_id,
               merchant.owner_id,
               merchant.auth_id,
               merchant.created_by,
               merchant.created_by_user_id
             ]::uuid[]) as merchant_alias(alias_id)
            where merchant_alias.alias_id is not null
         ) <> 1
       )
  ) then
    raise exception 'ordinary_account_merchant_binding_conflict';
  end if;

  select coalesce(
    array_agg(merchant.id order by merchant.id),
    array[]::text[]
  )
    into v_merchant_ids
    from public.merchants as merchant
   where merchant.id <> v_system_site_id
     and p_auth_user_id = any(array_remove(array[
       merchant.user_id,
       merchant.auth_user_id,
       merchant.owner_user_id,
       merchant.owner_id,
       merchant.auth_id,
       merchant.created_by,
       merchant.created_by_user_id
     ]::uuid[], null::uuid));

  select personal_account.personal_account_id, personal_account.status
    into v_personal_account_id, v_personal_status
    from public.faolla_personal_accounts as personal_account
   where personal_account.auth_user_id = p_auth_user_id;

  -- Canonical personal IDs use the product-owned eight-digit allocation
  -- range. 035 intentionally kept a wider shadow constraint for discovery,
  -- but the positive resolver must never authorize an out-of-range row.
  if v_personal_account_id is not null
     and (
       v_personal_account_id !~ '^[0-9]{8}$'
       or case
         when v_personal_account_id ~ '^[0-9]{8}$' then
           v_personal_account_id::bigint not between 50010105 and 59999999
         else true
       end
     ) then
    raise exception 'ordinary_account_personal_binding_conflict';
  end if;

  if cardinality(v_merchant_ids) > 0
     and v_personal_account_id is not null then
    raise exception 'ordinary_account_principal_type_conflict';
  end if;

  if cardinality(v_merchant_ids) > 0 then
    return jsonb_build_object(
      'schemaVersion', 1,
      'status', 'resolved',
      'accountType', 'merchant',
      'merchantIds', to_jsonb(v_merchant_ids),
      'personalAccountId', null
    );
  end if;

  if v_personal_account_id is not null then
    return jsonb_build_object(
      'schemaVersion', 1,
      'status', case
        when v_personal_status = 'active' then 'resolved'
        else 'disabled'
      end,
      'accountType', 'personal',
      'merchantIds', '[]'::jsonb,
      'personalAccountId', v_personal_account_id
    );
  end if;

  return jsonb_build_object(
    'schemaVersion', 1,
    'status', 'unbound',
    'accountType', null,
    'merchantIds', '[]'::jsonb,
    'personalAccountId', null
  );
end;
$$;

-- Staff registration and ordinary-account creation share one advisory lock
-- domain. The staff INSERT statement already holds RowExclusive on the staff
-- registry before this trigger runs, so the ordinary writers deliberately do
-- not take a conflicting table lock on that registry. Both directions then
-- lock personal followed by merchants and fail closed without a lock cycle.
create or replace function
  public.faolla_guard_staff_identity_ordinary_exclusion_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'faolla:ordinary-account-binding-v1',
      0
    )
  );
  lock table
    public.faolla_personal_accounts,
    public.merchants
    in share row exclusive mode;

  if exists (
    select 1
      from public.merchants as system_site
     where system_site.id = 'site-main'
       and new.auth_user_id = any(array[
         system_site.user_id,
         system_site.auth_user_id,
         system_site.owner_user_id,
         system_site.owner_id,
         system_site.auth_id,
         system_site.created_by,
         system_site.created_by_user_id
       ]::uuid[])
  ) then
    raise exception 'merchant_enterprise_staff_identity_conflict';
  end if;

  if exists (
       select 1
         from public.faolla_personal_accounts as personal_account
        where personal_account.auth_user_id = new.auth_user_id
     )
     or exists (
       select 1
         from public.merchants as merchant
        where merchant.id <> 'site-main'
          and new.auth_user_id = any(array[
          merchant.user_id,
          merchant.auth_user_id,
          merchant.owner_user_id,
          merchant.owner_id,
          merchant.auth_id,
          merchant.created_by,
          merchant.created_by_user_id
        ]::uuid[])
     ) then
    raise exception 'merchant_enterprise_staff_identity_conflict';
  end if;

  return new;
end;
$$;

revoke all on function
  public.faolla_guard_staff_identity_ordinary_exclusion_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists merchant_enterprise_staff_ordinary_exclusion
  on public.merchant_enterprise_staff_identities;
create trigger merchant_enterprise_staff_ordinary_exclusion
before insert on public.merchant_enterprise_staff_identities
for each row execute function
  public.faolla_guard_staff_identity_ordinary_exclusion_v1();
alter table public.merchant_enterprise_staff_identities
  enable always trigger merchant_enterprise_staff_ordinary_exclusion;

-- Auth deletion is intentionally fail-closed until a future retirement flow
-- atomically removes every ordinary binding first. A DELETE already owns the
-- target Auth row when this trigger takes the shared advisory/table lock
-- sequence, mirroring ordinary writers that lock the Auth row first.
create or replace function
  public.faolla_guard_auth_user_ordinary_account_delete_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'faolla:ordinary-account-binding-v1',
      0
    )
  );
  lock table
    public.faolla_personal_accounts,
    public.merchants
    in share row exclusive mode;

  if exists (
       select 1
         from public.faolla_personal_accounts as personal_account
        where personal_account.auth_user_id = old.id
     )
     or exists (
       select 1
         from public.merchants as merchant
        where merchant.id <> 'site-main'
          and old.id = any(array[
          merchant.user_id,
          merchant.auth_user_id,
          merchant.owner_user_id,
          merchant.owner_id,
          merchant.auth_id,
          merchant.created_by,
          merchant.created_by_user_id
        ]::uuid[])
     ) then
    raise exception 'ordinary_account_auth_user_delete_forbidden';
  end if;

  return old;
end;
$$;

revoke all on function
  public.faolla_guard_auth_user_ordinary_account_delete_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists faolla_auth_users_ordinary_delete_guard
  on auth.users;
create trigger faolla_auth_users_ordinary_delete_guard
before delete on auth.users
for each row execute function
  public.faolla_guard_auth_user_ordinary_account_delete_v1();
alter table auth.users
  enable always trigger faolla_auth_users_ordinary_delete_guard;

create or replace function
  public.faolla_create_ordinary_account_authorization_v1(
    p_auth_user_id uuid,
    p_account_type text,
    p_account_id text
  )
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_js_trim_chars constant text :=
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  v_system_site_id constant text := 'site-main';
  v_account_type text;
  v_account_id text;
  v_existing jsonb;
  v_existing_merchant public.merchants%rowtype;
  v_alias_count integer := 0;
  v_alias_value_count integer := 0;
  v_email text := null;
begin
  if p_auth_user_id is null then
    raise exception 'invalid_ordinary_account_binding';
  end if;

  v_account_type := lower(
    btrim(coalesce(p_account_type, ''), v_js_trim_chars)
  );
  v_account_id := btrim(coalesce(p_account_id, ''), v_js_trim_chars);

  if v_account_type not in ('merchant', 'personal')
     or v_account_id = ''
     or char_length(v_account_id) > 128
     or octet_length(v_account_id) > 512
     or v_account_id ~ '[[:cntrl:]]'
     or v_account_id ~ U&'[\007F-\009F]' then
    raise exception 'invalid_ordinary_account_binding';
  end if;

  if v_account_id = v_system_site_id then
    raise exception 'ordinary_account_system_site_forbidden';
  end if;

  if v_account_type = 'merchant'
     and v_account_id !~ '^[0-9]{8}$' then
    raise exception 'invalid_ordinary_merchant_id';
  end if;

  if v_account_type = 'personal'
     and v_account_id !~ '^[0-9]{8}$' then
    raise exception 'invalid_ordinary_personal_id';
  end if;

  if v_account_type = 'personal'
     and v_account_id::bigint not between 50010105 and 59999999 then
    raise exception 'invalid_ordinary_personal_id';
  end if;

  -- Lock the Auth row before entering the shared advisory/table lock domain.
  -- This serializes both new and idempotent responses against Auth DELETE;
  -- the delete guard takes the same remaining lock order after its row lock.
  select nullif(lower(btrim(auth_user.email, v_js_trim_chars)), '')
    into v_email
    from auth.users as auth_user
   where auth_user.id = p_auth_user_id
   for key share;
  if not found then
    raise exception 'ordinary_account_auth_user_not_found';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'faolla:ordinary-account-binding-v1',
      0
    )
  );
  lock table
    public.faolla_personal_accounts,
    public.merchants
    in share row exclusive mode;

  if exists (
    select 1
      from public.merchants as system_site
     where system_site.id = v_system_site_id
       and p_auth_user_id = any(array[
         system_site.user_id,
         system_site.auth_user_id,
         system_site.owner_user_id,
         system_site.owner_id,
         system_site.auth_id,
         system_site.created_by,
         system_site.created_by_user_id
       ]::uuid[])
  ) then
    raise exception 'ordinary_account_system_site_forbidden';
  end if;

  if exists (
    select 1
      from public.merchant_enterprise_staff_identities as staff_identity
     where staff_identity.auth_user_id = p_auth_user_id
  ) then
    raise exception 'ordinary_account_staff_identity_forbidden';
  end if;

  v_existing :=
    public.faolla_resolve_ordinary_account_authorization_v1(
      p_auth_user_id
    );

  if coalesce(v_existing ->> 'accountType', '') <> ''
     and v_existing ->> 'accountType' <> v_account_type then
    raise exception 'ordinary_account_principal_type_conflict';
  end if;

  -- The 035 resolver deliberately tolerates one non-null UUID alias while
  -- operators discover legacy rows. Positive creation is stricter: an auth
  -- principal with any partial merchant row must be backfilled before this RPC
  -- can bless that row or create another merchant.
  if v_account_type = 'merchant'
     and exists (
       select 1
         from public.merchants as merchant
         cross join lateral (
           select
             count(merchant_alias.alias_id)::integer as alias_value_count,
             count(distinct merchant_alias.alias_id)::integer as alias_count
           from unnest(array[
             merchant.user_id,
             merchant.auth_user_id,
             merchant.owner_user_id,
             merchant.owner_id,
             merchant.auth_id,
             merchant.created_by,
             merchant.created_by_user_id
           ]::uuid[]) as merchant_alias(alias_id)
         ) as merchant_aliases
        where p_auth_user_id = any(array[
          merchant.user_id,
          merchant.auth_user_id,
          merchant.owner_user_id,
          merchant.owner_id,
          merchant.auth_id,
          merchant.created_by,
          merchant.created_by_user_id
        ]::uuid[])
          and (
            merchant_aliases.alias_value_count <> 7
            or merchant_aliases.alias_count <> 1
          )
     ) then
    raise exception 'ordinary_account_merchant_binding_conflict';
  end if;

  if v_account_type = 'personal' then
    if exists (
      select 1
        from public.merchants as merchant
       where merchant.id = v_account_id
    ) then
      raise exception 'ordinary_account_identifier_collision';
    end if;

    if coalesce(v_existing ->> 'accountType', '') = 'personal' then
      if v_existing ->> 'status' = 'disabled' then
        raise exception 'ordinary_account_personal_disabled';
      end if;
      if v_existing ->> 'personalAccountId' <> v_account_id then
        raise exception 'ordinary_account_binding_conflict';
      end if;
      return public.faolla_resolve_ordinary_account_authorization_v1(
        p_auth_user_id
      );
    end if;

    if exists (
      select 1
        from public.faolla_personal_accounts as personal_account
       where personal_account.personal_account_id = v_account_id
         and personal_account.auth_user_id <> p_auth_user_id
    ) then
      raise exception 'ordinary_account_binding_conflict';
    end if;

    insert into public.faolla_personal_accounts (
      auth_user_id,
      personal_account_id,
      status
    ) values (
      p_auth_user_id,
      v_account_id,
      'active'
    );

    return public.faolla_resolve_ordinary_account_authorization_v1(
      p_auth_user_id
    );
  end if;

  if exists (
    select 1
      from public.faolla_personal_accounts as personal_account
     where personal_account.personal_account_id = v_account_id
  ) then
    raise exception 'ordinary_account_identifier_collision';
  end if;

  select merchant.*
    into v_existing_merchant
    from public.merchants as merchant
   where merchant.id = v_account_id
   for update;

  if found then
    select
      count(distinct merchant_alias.alias_id)::integer,
      count(merchant_alias.alias_id)::integer
      into v_alias_count, v_alias_value_count
      from unnest(array[
        v_existing_merchant.user_id,
        v_existing_merchant.auth_user_id,
        v_existing_merchant.owner_user_id,
        v_existing_merchant.owner_id,
        v_existing_merchant.auth_id,
        v_existing_merchant.created_by,
        v_existing_merchant.created_by_user_id
      ]::uuid[]) as merchant_alias(alias_id)
     where merchant_alias.alias_id is not null;

    if v_alias_count <> 1
       or v_alias_value_count <> 7
       or exists (
         select 1
           from unnest(array[
             v_existing_merchant.user_id,
             v_existing_merchant.auth_user_id,
             v_existing_merchant.owner_user_id,
             v_existing_merchant.owner_id,
             v_existing_merchant.auth_id,
             v_existing_merchant.created_by,
             v_existing_merchant.created_by_user_id
           ]::uuid[]) as merchant_alias(alias_id)
          where merchant_alias.alias_id is distinct from p_auth_user_id
       ) then
      raise exception 'ordinary_account_binding_conflict';
    end if;
  else
    insert into public.merchants (
      id,
      name,
      email,
      owner_email,
      contact_email,
      user_email,
      user_id,
      auth_user_id,
      owner_user_id,
      owner_id,
      auth_id,
      created_by,
      created_by_user_id
    ) values (
      v_account_id,
      '',
      v_email,
      v_email,
      v_email,
      v_email,
      p_auth_user_id,
      p_auth_user_id,
      p_auth_user_id,
      p_auth_user_id,
      p_auth_user_id,
      p_auth_user_id,
      p_auth_user_id
    );
  end if;

  return public.faolla_resolve_ordinary_account_authorization_v1(
    p_auth_user_id
  );
end;
$$;

create or replace function
  public.faolla_bootstrap_ordinary_account_authorization_v1(
    p_auth_user_id uuid,
    p_account_type text
  )
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_js_trim_chars constant text :=
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  v_account_type text;
  v_existing jsonb;
  v_candidate bigint;
  v_candidate_id text;
  v_rules jsonb := '[]'::jsonb;
  v_block_end bigint := null;
  v_locked_auth_user_id uuid;
begin
  if p_auth_user_id is null then
    raise exception 'invalid_ordinary_account_bootstrap';
  end if;

  v_account_type := lower(
    btrim(coalesce(p_account_type, ''), v_js_trim_chars)
  );
  if v_account_type not in ('merchant', 'personal') then
    raise exception 'invalid_ordinary_account_bootstrap';
  end if;

  select auth_user.id
    into v_locked_auth_user_id
    from auth.users as auth_user
   where auth_user.id = p_auth_user_id
   for key share;
  if not found then
    raise exception 'ordinary_account_auth_user_not_found';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'faolla:ordinary-account-binding-v1',
      0
    )
  );
  lock table
    public.faolla_personal_accounts,
    public.merchants
    in share row exclusive mode;
  if exists (
    select 1
      from public.merchants as system_site
     where system_site.id = 'site-main'
       and p_auth_user_id = any(array[
         system_site.user_id,
         system_site.auth_user_id,
         system_site.owner_user_id,
         system_site.owner_id,
         system_site.auth_id,
         system_site.created_by,
         system_site.created_by_user_id
       ]::uuid[])
  ) then
    raise exception 'ordinary_account_system_site_forbidden';
  end if;
  if exists (
    select 1
      from public.merchant_enterprise_staff_identities as staff_identity
     where staff_identity.auth_user_id = p_auth_user_id
  ) then
    raise exception 'ordinary_account_staff_identity_forbidden';
  end if;

  v_existing :=
    public.faolla_resolve_ordinary_account_authorization_v1(
      p_auth_user_id
    );

  if coalesce(v_existing ->> 'accountType', '') <> '' then
    if v_existing ->> 'accountType' <> v_account_type then
      raise exception 'ordinary_account_principal_type_conflict';
    end if;
    if v_account_type = 'personal'
       and v_existing ->> 'status' = 'disabled' then
      raise exception 'ordinary_account_personal_disabled';
    end if;
    if v_account_type = 'merchant'
       and exists (
         select 1
           from public.merchants as merchant
           cross join lateral (
             select
               count(merchant_alias.alias_id)::integer as alias_value_count,
               count(distinct merchant_alias.alias_id)::integer as alias_count
             from unnest(array[
               merchant.user_id,
               merchant.auth_user_id,
               merchant.owner_user_id,
               merchant.owner_id,
               merchant.auth_id,
               merchant.created_by,
               merchant.created_by_user_id
             ]::uuid[]) as merchant_alias(alias_id)
           ) as merchant_aliases
          where p_auth_user_id = any(array[
            merchant.user_id,
            merchant.auth_user_id,
            merchant.owner_user_id,
            merchant.owner_id,
            merchant.auth_id,
            merchant.created_by,
            merchant.created_by_user_id
          ]::uuid[])
            and (
              merchant_aliases.alias_value_count <> 7
              or merchant_aliases.alias_count <> 1
            )
       ) then
      raise exception 'ordinary_account_merchant_binding_conflict';
    end if;
    return v_existing;
  end if;

  if v_account_type = 'personal' then
    v_candidate := 50010105;
    loop
      if v_candidate > 59999999 then
        raise exception 'ordinary_personal_account_id_exhausted';
      end if;
      v_candidate_id := v_candidate::text;
      if not exists (
           select 1
             from public.faolla_personal_accounts as personal_account
            where personal_account.personal_account_id = v_candidate_id
         )
         and not exists (
           select 1
             from public.merchants as merchant
            where merchant.id = v_candidate_id
         ) then
        exit;
      end if;
      v_candidate := v_candidate + 1;
    end loop;

    return public.faolla_create_ordinary_account_authorization_v1(
      p_auth_user_id,
      'personal',
      v_candidate_id
    );
  end if;

  select case
    when jsonb_typeof(rule_page.blocks) = 'array'
      then rule_page.blocks
    when jsonb_typeof(rule_page.blocks -> 'rules') = 'array'
      then rule_page.blocks -> 'rules'
    else '[]'::jsonb
  end
    into v_rules
    from public.pages as rule_page
   where rule_page.merchant_id is null
     and rule_page.slug = 'merchant-id-rules'
   order by rule_page.updated_at desc, rule_page.id
   limit 1;
  v_rules := coalesce(v_rules, '[]'::jsonb);

  v_candidate := 10000000;
  loop
    if v_candidate between 50010105 and 59999999 then
      v_candidate := 60000000;
    end if;
    if v_candidate > 99999999 then
      raise exception 'ordinary_merchant_account_id_exhausted';
    end if;

    v_candidate_id := v_candidate::text;
    select max(
      case merchant_rule.value ->> 'type'
        when 'exact' then case
          when merchant_rule.value ->> 'expression' = v_candidate_id
            then v_candidate
          else null
        end
        when 'range' then case
          when coalesce(
                 merchant_rule.value ->> 'intervalStart', ''
               ) ~ '^[0-9]+$'
           and coalesce(
                 merchant_rule.value ->> 'intervalEnd', ''
               ) ~ '^[0-9]+$'
            then case
              when v_candidate between
                (merchant_rule.value ->> 'intervalStart')::bigint
                and (merchant_rule.value ->> 'intervalEnd')::bigint
                then (merchant_rule.value ->> 'intervalEnd')::bigint
              else null
            end
          else null
        end
        when 'pattern' then case
          when coalesce(
                 merchant_rule.value ->> 'expression', ''
               ) ~ '^[0-9*]{8}$'
           and v_candidate_id like replace(
             merchant_rule.value ->> 'expression',
             '*',
             '_'
           ) then case
             when char_length(
                    merchant_rule.value ->> 'expression'
                  ) - char_length(rtrim(
                    merchant_rule.value ->> 'expression',
                    '*'
                  )) > 0 then (
               left(
                 v_candidate_id,
                 char_length(rtrim(
                   merchant_rule.value ->> 'expression',
                   '*'
                 ))
               ) || repeat(
                 '9',
                 char_length(
                   merchant_rule.value ->> 'expression'
                 ) - char_length(rtrim(
                   merchant_rule.value ->> 'expression',
                   '*'
                 ))
               )
             )::bigint
             else v_candidate
           end
          else null
        end
        else null
      end
    )
      into v_block_end
      from jsonb_array_elements(v_rules) as merchant_rule(value);

    if v_block_end is not null then
      v_candidate := greatest(v_candidate + 1, v_block_end + 1);
      continue;
    end if;

    if not exists (
         select 1
           from public.merchants as merchant
          where merchant.id = v_candidate_id
       )
       and not exists (
         select 1
           from public.faolla_personal_accounts as personal_account
          where personal_account.personal_account_id = v_candidate_id
       ) then
      exit;
    end if;
    v_candidate := v_candidate + 1;
  end loop;

  return public.faolla_create_ordinary_account_authorization_v1(
    p_auth_user_id,
    'merchant',
    v_candidate_id
  );
end;
$$;

create or replace function
  public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_system_site_id constant text := 'site-main';
  v_merchant_record_count integer := 0;
  v_merchant_authoritative_count integer := 0;
  v_merchant_invalid_count integer := 0;
  v_personal_record_count integer := 0;
  v_personal_orphan_count integer := 0;
  v_personal_invalid_count integer := 0;
  v_personal_auth_duplicate_count integer := 0;
  v_personal_id_duplicate_count integer := 0;
  v_cross_account_count integer := 0;
  v_identifier_collision_count integer := 0;
  v_staff_overlap_count integer := 0;
  v_system_site_principal_overlap_count integer := 0;
  v_schema_ready boolean := false;
  v_acl_ready boolean := false;
  v_ready boolean := false;
begin
  with merchant_rows as materialized (
    select
      merchant.id,
      merchant_aliases.alias_value_count,
      merchant_aliases.alias_count,
      merchant_aliases.bound_auth_user_id,
      auth_user.id is not null as auth_user_exists
    from public.merchants as merchant
    cross join lateral (
      select
        count(merchant_alias.alias_id)::integer as alias_value_count,
        count(distinct merchant_alias.alias_id)::integer as alias_count,
        (array_agg(
          distinct merchant_alias.alias_id
          order by merchant_alias.alias_id
        ) filter (where merchant_alias.alias_id is not null))[1]
          as bound_auth_user_id
      from unnest(array[
        merchant.user_id,
        merchant.auth_user_id,
        merchant.owner_user_id,
        merchant.owner_id,
        merchant.auth_id,
        merchant.created_by,
        merchant.created_by_user_id
      ]::uuid[]) as merchant_alias(alias_id)
    ) as merchant_aliases
    left join auth.users as auth_user
      on auth_user.id = merchant_aliases.bound_auth_user_id
    where merchant.id <> v_system_site_id
  ), merchant_summary as materialized (
    select
      count(*)::integer as record_count,
      count(*) filter (
        where id ~ '^[0-9]{8}$'
          and alias_value_count = 7
          and alias_count = 1
          and auth_user_exists
      )::integer as authoritative_count,
      count(*) filter (
        where id !~ '^[0-9]{8}$'
           or alias_value_count <> 7
           or alias_count <> 1
           or not auth_user_exists
      )::integer as invalid_count
    from merchant_rows
  ), personal_rows as materialized (
    select
      personal_account.auth_user_id,
      personal_account.personal_account_id,
      auth_user.id is not null as auth_user_exists,
      (
        personal_account.status not in ('active', 'disabled')
        or personal_account.version < 1
        or personal_account.updated_at < personal_account.created_at
        or personal_account.personal_account_id = ''
        or char_length(personal_account.personal_account_id) > 128
        or octet_length(personal_account.personal_account_id) > 512
        or personal_account.personal_account_id ~ '[[:cntrl:]]'
        or personal_account.personal_account_id ~ U&'[\007F-\009F]'
        or personal_account.personal_account_id !~ '^[0-9]{8}$'
        or case
          when personal_account.personal_account_id ~ '^[0-9]{8}$' then
            personal_account.personal_account_id::bigint
              not between 50010105 and 59999999
          else true
        end
      ) as invalid_row
    from public.faolla_personal_accounts as personal_account
    left join auth.users as auth_user
      on auth_user.id = personal_account.auth_user_id
  ), personal_summary as materialized (
    select
      count(*)::integer as record_count,
      count(*) filter (where not auth_user_exists)::integer as orphan_count,
      count(*) filter (where invalid_row)::integer as invalid_count
    from personal_rows
  ), personal_auth_duplicates as materialized (
    select count(*)::integer as duplicate_count
      from (
        select personal_row.auth_user_id
          from personal_rows as personal_row
         group by personal_row.auth_user_id
        having count(*) > 1
      ) as duplicate_auth_user
  ), personal_id_duplicates as materialized (
    select count(*)::integer as duplicate_count
      from (
        select personal_row.personal_account_id
          from personal_rows as personal_row
         group by personal_row.personal_account_id
        having count(*) > 1
      ) as duplicate_personal_id
  ), merchant_principals as materialized (
    select distinct merchant_row.bound_auth_user_id as auth_user_id
      from merchant_rows as merchant_row
     where merchant_row.bound_auth_user_id is not null
  ), personal_principals as materialized (
    select distinct personal_row.auth_user_id
      from personal_rows as personal_row
  ), system_site_principals as materialized (
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
     where system_site.id = v_system_site_id
       and system_alias.auth_user_id is not null
  ), ordinary_merchant_alias_principals as materialized (
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
     where ordinary_merchant.id <> v_system_site_id
       and ordinary_alias.auth_user_id is not null
  ), cross_account_summary as materialized (
    select count(*)::integer as overlap_count
      from merchant_principals as merchant_principal
      join personal_principals as personal_principal
        using (auth_user_id)
  ), identifier_collision_summary as materialized (
    select count(*)::integer as collision_count
      from public.merchants as merchant
      join personal_rows as personal_row
        on personal_row.personal_account_id = merchant.id
  ), ordinary_principals as materialized (
    select merchant_principal.auth_user_id
      from merchant_principals as merchant_principal
    union
    select personal_principal.auth_user_id
      from personal_principals as personal_principal
  ), staff_overlap_summary as materialized (
    select count(*)::integer as overlap_count
      from ordinary_principals as ordinary_principal
      join public.merchant_enterprise_staff_identities as staff_identity
        on staff_identity.auth_user_id = ordinary_principal.auth_user_id
  ), system_site_overlap_summary as materialized (
    select count(*)::integer as overlap_count
      from system_site_principals as system_principal
      join (
        select ordinary_merchant.auth_user_id
          from ordinary_merchant_alias_principals as ordinary_merchant
        union
        select personal_principal.auth_user_id
          from personal_principals as personal_principal
        union
        select system_staff_identity.auth_user_id
          from public.merchant_enterprise_staff_identities
            as system_staff_identity
      ) as ordinary_principal
        using (auth_user_id)
  )
  select
    merchant_summary.record_count,
    merchant_summary.authoritative_count,
    merchant_summary.invalid_count,
    personal_summary.record_count,
    personal_summary.orphan_count,
    personal_summary.invalid_count,
    personal_auth_duplicates.duplicate_count,
    personal_id_duplicates.duplicate_count,
    cross_account_summary.overlap_count,
    identifier_collision_summary.collision_count,
    staff_overlap_summary.overlap_count,
    system_site_overlap_summary.overlap_count
    into
      v_merchant_record_count,
      v_merchant_authoritative_count,
      v_merchant_invalid_count,
      v_personal_record_count,
      v_personal_orphan_count,
      v_personal_invalid_count,
      v_personal_auth_duplicate_count,
      v_personal_id_duplicate_count,
      v_cross_account_count,
      v_identifier_collision_count,
      v_staff_overlap_count,
      v_system_site_principal_overlap_count
    from merchant_summary
    cross join personal_summary
    cross join personal_auth_duplicates
    cross join personal_id_duplicates
    cross join cross_account_summary
    cross join identifier_collision_summary
    cross join staff_overlap_summary
    cross join system_site_overlap_summary;

  select
    personal_table.relkind = 'r'
    and personal_table.relpersistence = 'p'
    and coalesce(personal_table.relrowsecurity, false)
    and not exists (
      select 1
        from (values
          (
            'public.faolla_personal_accounts_auth_user_id_uidx',
            'auth_user_id'
          ),
          (
            'public.faolla_personal_accounts_personal_account_id_uidx',
            'personal_account_id'
          )
        ) as expected_index(index_name, column_name)
       where not exists (
         select 1
           from pg_catalog.pg_index as index_metadata
           join pg_catalog.pg_class as index_relation
             on index_relation.oid = index_metadata.indexrelid
           join pg_catalog.pg_am as index_method
             on index_method.oid = index_relation.relam
          where index_metadata.indexrelid = to_regclass(
            expected_index.index_name
          )
            and index_metadata.indrelid = personal_table.oid
            and index_metadata.indisunique
            and not index_metadata.indisprimary
            and not index_metadata.indisexclusion
            and index_metadata.indimmediate
            and index_metadata.indisvalid
            and index_metadata.indisready
            and index_metadata.indislive
            and index_metadata.indpred is null
            and index_metadata.indexprs is null
            and index_metadata.indnkeyatts = 1
            and index_metadata.indnatts = 1
            and index_method.amname = 'btree'
            and not exists (
              select 1
                from unnest(
                  index_metadata.indclass::oid[]
                ) with ordinality as index_operator_class(
                  operator_class_oid,
                  ordinality
                )
                join unnest(
                  index_metadata.indkey::smallint[]
                ) with ordinality as index_column(attnum, ordinality)
                  using (ordinality)
                join pg_catalog.pg_attribute as table_attribute
                  on table_attribute.attrelid = personal_table.oid
                 and table_attribute.attnum = index_column.attnum
                left join pg_catalog.pg_opclass as operator_class
                  on operator_class.oid =
                    index_operator_class.operator_class_oid
               where operator_class.oid is null
                  or operator_class.opcmethod <> index_relation.relam
                  or operator_class.opcintype <> table_attribute.atttypid
                  or not operator_class.opcdefault
            )
            and not exists (
              select 1
                from unnest(
                  index_metadata.indcollation::oid[]
                ) with ordinality as index_collation(
                  collation_oid,
                  ordinality
                )
                join unnest(
                  index_metadata.indkey::smallint[]
                ) with ordinality as index_column(attnum, ordinality)
                  using (ordinality)
                join pg_catalog.pg_attribute as table_attribute
                  on table_attribute.attrelid = personal_table.oid
                 and table_attribute.attnum = index_column.attnum
               where index_collation.collation_oid is distinct from
                 table_attribute.attcollation
            )
            and not exists (
              select 1
                from unnest(
                  index_metadata.indoption::smallint[]
                ) as index_option(option_bits)
               where index_option.option_bits <> 0
            )
            and (
              select array_agg(
                table_attribute.attname::text
                order by index_column.ordinality
              )
                from unnest(
                  index_metadata.indkey::smallint[]
                ) with ordinality as index_column(attnum, ordinality)
                join pg_catalog.pg_attribute as table_attribute
                  on table_attribute.attrelid = personal_table.oid
                 and table_attribute.attnum = index_column.attnum
            ) = array[expected_index.column_name]::text[]
       )
    )
    and not exists (
      select 1
        from (values
          (
            'faolla_personal_accounts_personal_account_id_safe',
            array['personal_account_id']::text[],
            'safe_id'
          ),
          (
            'faolla_personal_accounts_status_valid',
            array['status']::text[],
            'status'
          ),
          (
            'faolla_personal_accounts_version_valid',
            array['version']::text[],
            'version'
          ),
          (
            'faolla_personal_accounts_timestamps_valid',
            array['updated_at', 'created_at']::text[],
            'timestamps'
          )
        ) as expected_constraint(
          constraint_name,
          column_names,
          constraint_kind
        )
       where not exists (
         select 1
           from pg_catalog.pg_constraint as constraint_metadata
           cross join lateral (
             select
               lower(pg_catalog.pg_get_expr(
                 constraint_metadata.conbin,
                 constraint_metadata.conrelid,
                 true
               )) as raw_expression,
               regexp_replace(
                 lower(pg_catalog.pg_get_expr(
                   constraint_metadata.conbin,
                   constraint_metadata.conrelid,
                   true
                 )),
                 '[[:space:]()]',
                 '',
                 'g'
               ) as normalized_expression,
               lower(pg_catalog.pg_get_constraintdef(
                 constraint_metadata.oid,
                 true
               )) as constraint_definition
           ) as constraint_expression
          where constraint_metadata.conrelid = personal_table.oid
            and constraint_metadata.conname =
              expected_constraint.constraint_name
            and constraint_metadata.contype = 'c'
            and constraint_metadata.convalidated
            and not constraint_metadata.connoinherit
            and constraint_expression.constraint_definition like 'check%'
            and (
              select array_agg(
                table_attribute.attname::text
                order by constraint_column.ordinality
              )
                from unnest(
                  constraint_metadata.conkey
                ) with ordinality as constraint_column(attnum, ordinality)
                join pg_catalog.pg_attribute as table_attribute
                  on table_attribute.attrelid = personal_table.oid
                 and table_attribute.attnum = constraint_column.attnum
            ) = expected_constraint.column_names
            and case expected_constraint.constraint_kind
              when 'status' then
                constraint_expression.normalized_expression =
                  'status=anyarray[''active''::text,''disabled''::text]'
              when 'version' then
                constraint_expression.normalized_expression = 'version>=1'
              when 'timestamps' then
                constraint_expression.normalized_expression =
                  'updated_at>=created_at'
              when 'safe_id' then
                constraint_expression.raw_expression !~
                  '(^|[[:space:]()])or([[:space:]()]|$)'
                and constraint_expression.raw_expression !~
                  '(^|[[:space:]()])not([[:space:]()]|$)'
                and position(
                  'personal_account_id=btrim' in
                  constraint_expression.normalized_expression
                ) > 0
                and position(
                  'char_lengthpersonal_account_id>=1' in
                  constraint_expression.normalized_expression
                ) > 0
                and position(
                  'char_lengthpersonal_account_id<=128' in
                  constraint_expression.normalized_expression
                ) > 0
                and position(
                  'octet_lengthpersonal_account_id<=512' in
                  constraint_expression.normalized_expression
                ) > 0
                and position(
                  '[[:cntrl:]]' in
                  constraint_expression.normalized_expression
                ) > 0
                and (
                  length(constraint_expression.normalized_expression) -
                  length(replace(
                    constraint_expression.normalized_expression,
                    'personal_account_id!~',
                    ''
                  ))
                ) / length('personal_account_id!~') = 2
                and (
                  length(constraint_expression.normalized_expression) -
                  length(replace(
                    constraint_expression.normalized_expression,
                    'and',
                    ''
                  ))
                ) / length('and') = 5
                and (
                  length(constraint_expression.normalized_expression) -
                  length(replace(
                    constraint_expression.normalized_expression,
                    'btrim',
                    ''
                  ))
                ) / length('btrim') = 1
                and (
                  length(constraint_expression.normalized_expression) -
                  length(replace(
                    constraint_expression.normalized_expression,
                    'char_length',
                    ''
                  ))
                ) / length('char_length') = 2
                and (
                  length(constraint_expression.normalized_expression) -
                  length(replace(
                    constraint_expression.normalized_expression,
                    'octet_length',
                    ''
                  ))
                ) / length('octet_length') = 1
              else false
            end
       )
    )
    and not exists (
      select 1
        from (values
          (
            'public.faolla_personal_accounts',
            'faolla_personal_accounts_binding_guard',
            'public.faolla_guard_personal_account_binding_v1()',
            27
          ),
          (
            'public.merchant_enterprise_staff_identities',
            'merchant_enterprise_staff_ordinary_exclusion',
            'public.faolla_guard_staff_identity_ordinary_exclusion_v1()',
            7
          ),
          (
            'auth.users',
            'faolla_auth_users_ordinary_delete_guard',
            'public.faolla_guard_auth_user_ordinary_account_delete_v1()',
            11
          )
        ) as expected_trigger(
          relation_name,
          trigger_name,
          function_name,
          trigger_type
        )
       where not exists (
         select 1
           from pg_catalog.pg_trigger as trigger_metadata
          where trigger_metadata.tgrelid = to_regclass(
            expected_trigger.relation_name
          )
            and trigger_metadata.tgname = expected_trigger.trigger_name
            and trigger_metadata.tgfoid = to_regprocedure(
              expected_trigger.function_name
            )
            and trigger_metadata.tgenabled = 'A'
            and trigger_metadata.tgtype = expected_trigger.trigger_type
            and trigger_metadata.tgnargs = 0
            and trigger_metadata.tgattr = ''::int2vector
            and trigger_metadata.tgqual is null
            and not trigger_metadata.tgisinternal
       )
    )
    into v_schema_ready
    from pg_catalog.pg_class as personal_table
   where personal_table.oid = to_regclass(
     'public.faolla_personal_accounts'
   );
  v_schema_ready := coalesce(v_schema_ready, false);

  v_acl_ready :=
    to_regprocedure(
      'public.faolla_bind_ordinary_account_authorization_v1(uuid,text,text)'
    ) is null
    and not has_function_privilege(
      'anon',
      'public.faolla_resolve_ordinary_account_authorization_v1(uuid)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.faolla_resolve_ordinary_account_authorization_v1(uuid)',
      'EXECUTE'
    )
    and has_function_privilege(
      'service_role',
      'public.faolla_resolve_ordinary_account_authorization_v1(uuid)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.faolla_create_ordinary_account_authorization_v1(uuid,text,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.faolla_create_ordinary_account_authorization_v1(uuid,text,text)',
      'EXECUTE'
    )
    and has_function_privilege(
      'service_role',
      'public.faolla_create_ordinary_account_authorization_v1(uuid,text,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.faolla_bootstrap_ordinary_account_authorization_v1(uuid,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.faolla_bootstrap_ordinary_account_authorization_v1(uuid,text)',
      'EXECUTE'
    )
    and has_function_privilege(
      'service_role',
      'public.faolla_bootstrap_ordinary_account_authorization_v1(uuid,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()',
      'EXECUTE'
    )
    and has_function_privilege(
      'service_role',
      'public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()',
      'EXECUTE'
    )
    and not exists (
      select 1
        from (values
          (
            'public.faolla_resolve_ordinary_account_authorization_v1(uuid)',
            'v',
            true,
            'jsonb'
          ),
          (
            'public.faolla_get_ordinary_account_authorization_readiness_v1()',
            'v',
            true,
            'jsonb'
          ),
          (
            'public.faolla_create_ordinary_account_authorization_v1(uuid,text,text)',
            'v',
            true,
            'jsonb'
          ),
          (
            'public.faolla_bootstrap_ordinary_account_authorization_v1(uuid,text)',
            'v',
            true,
            'jsonb'
          ),
          (
            'public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()',
            's',
            true,
            'jsonb'
          ),
          (
            'public.faolla_guard_personal_account_binding_v1()',
            'v',
            false,
            'trigger'
          ),
          (
            'public.faolla_guard_staff_identity_ordinary_exclusion_v1()',
            'v',
            false,
            'trigger'
          ),
          (
            'public.faolla_guard_auth_user_ordinary_account_delete_v1()',
            'v',
            false,
            'trigger'
          )
        ) as expected_function(
          function_name,
          volatility,
          service_role_allowed,
          return_type
        )
        left join pg_catalog.pg_proc as function_metadata
          on function_metadata.oid = to_regprocedure(
            expected_function.function_name
          )
       where function_metadata.oid is null
          or function_metadata.proowner <> current_user::regrole
          or not function_metadata.prosecdef
          or function_metadata.prokind <> 'f'
          or function_metadata.proretset
          or function_metadata.prorettype <>
            to_regtype(expected_function.return_type)
          or function_metadata.prolang <> (
            select language_metadata.oid
              from pg_catalog.pg_language as language_metadata
             where language_metadata.lanname = 'plpgsql'
          )
          or function_metadata.provolatile::text <>
            expected_function.volatility
          or function_metadata.proconfig is distinct from
            array['search_path=pg_catalog, public']::text[]
          or exists (
            select 1
              from pg_catalog.aclexplode(coalesce(
                function_metadata.proacl,
                pg_catalog.acldefault(
                  'f',
                  function_metadata.proowner
                )
              )) as function_acl
              left join pg_catalog.pg_roles as allowed_role
                on allowed_role.rolname = 'service_role'
             where function_acl.privilege_type = 'EXECUTE'
               and function_acl.grantee <>
                 function_metadata.proowner
               and (
                 not expected_function.service_role_allowed
                 or function_acl.grantee <> allowed_role.oid
               )
          )
          or (
            expected_function.service_role_allowed
            and not exists (
              select 1
                from pg_catalog.aclexplode(coalesce(
                  function_metadata.proacl,
                  pg_catalog.acldefault(
                    'f',
                    function_metadata.proowner
                  )
                )) as function_acl
                join pg_catalog.pg_roles as allowed_role
                  on allowed_role.oid = function_acl.grantee
                 and allowed_role.rolname = 'service_role'
                where function_acl.privilege_type = 'EXECUTE'
                  and not function_acl.is_grantable
            )
          )
    )
    and coalesce((
      select personal_acl_table.relowner = current_user::regrole
        from pg_catalog.pg_class as personal_acl_table
       where personal_acl_table.oid = to_regclass(
         'public.faolla_personal_accounts'
       )
    ), false)
    and not exists (
      select 1
        from pg_catalog.pg_class as personal_acl_table
       where personal_acl_table.oid = to_regclass(
         'public.faolla_personal_accounts'
       )
         and exists (
           (
             select *
               from pg_catalog.aclexplode(coalesce(
                 personal_acl_table.relacl,
                 pg_catalog.acldefault(
                   'r', personal_acl_table.relowner
                 )
               ))
             except
             select *
               from pg_catalog.aclexplode(pg_catalog.acldefault(
                 'r', personal_acl_table.relowner
               ))
           )
           union all
           (
             select *
               from pg_catalog.aclexplode(pg_catalog.acldefault(
                 'r', personal_acl_table.relowner
               ))
             except
             select *
               from pg_catalog.aclexplode(coalesce(
                 personal_acl_table.relacl,
                 pg_catalog.acldefault(
                   'r', personal_acl_table.relowner
                 )
               ))
           )
         )
    )
    and not exists (
      select 1
        from pg_catalog.pg_class as personal_acl_table
        join pg_catalog.pg_attribute as personal_column
          on personal_column.attrelid = personal_acl_table.oid
         and personal_column.attnum > 0
         and not personal_column.attisdropped
        cross join lateral pg_catalog.aclexplode(
          personal_column.attacl
        ) as personal_column_acl
       where personal_acl_table.oid = to_regclass(
         'public.faolla_personal_accounts'
       )
         and personal_column_acl.grantee <>
           personal_acl_table.relowner
    );

  v_ready :=
    v_merchant_invalid_count = 0
    and v_personal_orphan_count = 0
    and v_personal_invalid_count = 0
    and v_personal_auth_duplicate_count = 0
    and v_personal_id_duplicate_count = 0
    and v_cross_account_count = 0
    and v_identifier_collision_count = 0
    and v_staff_overlap_count = 0
    and v_system_site_principal_overlap_count = 0
    and v_schema_ready
    and v_acl_ready;

  return jsonb_build_object(
    'schemaVersion', 1,
    'asOf', to_char(
      statement_timestamp() at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'readyForCutover', v_ready,
    'merchant', jsonb_build_object(
      'recordCount', v_merchant_record_count,
      'authoritativeBindingCount', v_merchant_authoritative_count,
      'invalidBindingCount', v_merchant_invalid_count
    ),
    'personal', jsonb_build_object(
      'canonicalBindingCount', v_personal_record_count,
      'canonicalOrphanCount', v_personal_orphan_count,
      'invalidCanonicalCount', v_personal_invalid_count,
      'duplicateAuthUserCount', v_personal_auth_duplicate_count,
      'duplicatePersonalAccountIdCount', v_personal_id_duplicate_count
    ),
    'security', jsonb_build_object(
      'crossAccountTypeOverlapCount', v_cross_account_count,
      'accountIdentifierCollisionCount', v_identifier_collision_count,
      'staffRegistryOverlapCount', v_staff_overlap_count,
      'systemSitePrincipalOverlapCount',
        v_system_site_principal_overlap_count
    ),
    'invariants', jsonb_build_object(
      'schemaReady', v_schema_ready,
      'aclReady', v_acl_ready
    )
  );
end;
$$;

-- CREATE OR REPLACE preserves the prior owner and ACL. Normalize both, then
-- revoke every explicit/default grantee (including custom API roles) before
-- adding back the one service bridge. Trigger guards remain owner-only.
alter function
  public.faolla_resolve_ordinary_account_authorization_v1(uuid)
  owner to current_user;
alter function
  public.faolla_get_ordinary_account_authorization_readiness_v1()
  owner to current_user;
alter function
  public.faolla_create_ordinary_account_authorization_v1(uuid, text, text)
  owner to current_user;
alter function
  public.faolla_bootstrap_ordinary_account_authorization_v1(uuid, text)
  owner to current_user;
alter function
  public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()
  owner to current_user;
alter function
  public.faolla_guard_personal_account_binding_v1()
  owner to current_user;
alter function
  public.faolla_guard_staff_identity_ordinary_exclusion_v1()
  owner to current_user;
alter function
  public.faolla_guard_auth_user_ordinary_account_delete_v1()
  owner to current_user;

do $$
declare
  v_function record;
  v_grantee record;
begin
  for v_function in
    select function_spec.signature, function_metadata.oid,
           function_metadata.proowner
      from (values
        ('public.faolla_resolve_ordinary_account_authorization_v1(uuid)'),
        ('public.faolla_get_ordinary_account_authorization_readiness_v1()'),
        ('public.faolla_create_ordinary_account_authorization_v1(uuid,text,text)'),
        ('public.faolla_bootstrap_ordinary_account_authorization_v1(uuid,text)'),
        ('public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()'),
        ('public.faolla_guard_personal_account_binding_v1()'),
        ('public.faolla_guard_staff_identity_ordinary_exclusion_v1()'),
        ('public.faolla_guard_auth_user_ordinary_account_delete_v1()')
      ) as function_spec(signature)
      join pg_catalog.pg_proc as function_metadata
        on function_metadata.oid = to_regprocedure(function_spec.signature)
  loop
    for v_grantee in
      select distinct function_acl.grantee, grantee_role.rolname
        from pg_catalog.aclexplode(coalesce(
          (select function_acl_metadata.proacl
             from pg_catalog.pg_proc as function_acl_metadata
            where function_acl_metadata.oid = v_function.oid),
          pg_catalog.acldefault('f', v_function.proowner)
        )) as function_acl
        left join pg_catalog.pg_roles as grantee_role
          on grantee_role.oid = function_acl.grantee
       where function_acl.privilege_type = 'EXECUTE'
         and function_acl.grantee <> v_function.proowner
    loop
      if v_grantee.grantee = 0 then
        execute format(
          'revoke all on function %s from public cascade',
          v_function.signature
        );
      else
        execute format(
          'revoke all on function %s from %I cascade',
          v_function.signature,
          v_grantee.rolname
        );
      end if;
    end loop;
  end loop;
end;
$$;

revoke all on function
  public.faolla_resolve_ordinary_account_authorization_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.faolla_resolve_ordinary_account_authorization_v1(uuid)
  to service_role;

revoke all on function
  public.faolla_get_ordinary_account_authorization_readiness_v1()
  from public, anon, authenticated, service_role;
grant execute on function
  public.faolla_get_ordinary_account_authorization_readiness_v1()
  to service_role;

revoke all on function
  public.faolla_create_ordinary_account_authorization_v1(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function
  public.faolla_create_ordinary_account_authorization_v1(uuid, text, text)
  to service_role;

revoke all on function
  public.faolla_bootstrap_ordinary_account_authorization_v1(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function
  public.faolla_bootstrap_ordinary_account_authorization_v1(uuid, text)
  to service_role;

revoke all on function
  public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()
  from public, anon, authenticated, service_role;
grant execute on function
  public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()
  to service_role;

do $$
declare
  v_readiness jsonb;
begin
  if to_regprocedure(
       'public.faolla_bind_ordinary_account_authorization_v1(uuid,text,text)'
     ) is not null
     or has_function_privilege(
       'anon',
       'public.faolla_create_ordinary_account_authorization_v1(uuid,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.faolla_create_ordinary_account_authorization_v1(uuid,text,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.faolla_create_ordinary_account_authorization_v1(uuid,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.faolla_bootstrap_ordinary_account_authorization_v1(uuid,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.faolla_bootstrap_ordinary_account_authorization_v1(uuid,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.faolla_bootstrap_ordinary_account_authorization_v1(uuid,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()',
       'EXECUTE'
     ) then
    raise exception 'ordinary_account_bootstrap_grant_invalid';
  end if;

  v_readiness :=
    public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1();
  if coalesce(jsonb_typeof(v_readiness), '') <> 'object'
     or v_readiness ->> 'schemaVersion' <> '1'
     or coalesce(jsonb_typeof(v_readiness -> 'readyForCutover'), '') <>
       'boolean'
     or v_readiness #>> '{invariants,schemaReady}' <> 'true'
     or v_readiness #>> '{invariants,aclReady}' <> 'true' then
    raise exception 'ordinary_account_authoritative_readiness_invalid';
  end if;
end;
$$;

insert into public.faolla_schema_migrations (version, name)
values (202608190036, 'ordinary_account_authorization_bootstrap')
on conflict (version) do nothing;

do $$
begin
  if not exists (
    select 1
      from public.faolla_schema_migrations as migration
     where migration.version = 202608190036
       and migration.name = 'ordinary_account_authorization_bootstrap'
  ) then
    raise exception 'ordinary_account_bootstrap_registry_invalid';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
