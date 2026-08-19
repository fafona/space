-- Establish a positive, database-owned authorization source for ordinary
-- Faolla accounts. This migration is deliberately shadow-only: no existing
-- login, route, RLS policy, merchant row, Auth metadata, or staff guard reads
-- from these objects yet, and no production identity is backfilled.

begin;

do $$
begin
  if to_regclass('public.merchants') is null
     or to_regclass('public.merchant_enterprise_staff_identities') is null
     or to_regclass('public.faolla_schema_migrations') is null
     or to_regclass('auth.users') is null then
    raise exception 'ordinary_account_authorization_prerequisite_missing';
  end if;

  if exists (
    select 1
      from (values
        ('public', 'merchants', 'id'),
        ('public', 'merchants', 'email'),
        ('public', 'merchants', 'user_id'),
        ('public', 'merchants', 'auth_user_id'),
        ('public', 'merchants', 'owner_user_id'),
        ('public', 'merchants', 'owner_id'),
        ('public', 'merchants', 'auth_id'),
        ('public', 'merchants', 'created_by'),
        ('public', 'merchants', 'created_by_user_id'),
        ('public', 'merchants', 'owner_email'),
        ('public', 'merchants', 'contact_email'),
        ('public', 'merchants', 'user_email'),
        ('public', 'merchant_enterprise_staff_identities', 'auth_user_id'),
        ('auth', 'users', 'id'),
        ('auth', 'users', 'email'),
        ('auth', 'users', 'raw_app_meta_data'),
        ('auth', 'users', 'raw_user_meta_data')
      ) as required_column(schema_name, table_name, column_name)
     where not exists (
       select 1
         from pg_catalog.pg_class as table_relation
         join pg_catalog.pg_namespace as table_namespace
           on table_namespace.oid = table_relation.relnamespace
         join pg_catalog.pg_attribute as table_attribute
           on table_attribute.attrelid = table_relation.oid
          and table_attribute.attname = required_column.column_name
          and not table_attribute.attisdropped
        where table_namespace.nspname = required_column.schema_name
          and table_relation.relname = required_column.table_name
     )
  ) then
    raise exception 'ordinary_account_authorization_prerequisite_missing';
  end if;
end;
$$;

create table if not exists public.faolla_personal_accounts (
  auth_user_id uuid not null,
  personal_account_id text not null,
  status text not null default 'active',
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint faolla_personal_accounts_personal_account_id_safe
    check (
      personal_account_id = btrim(
        personal_account_id,
        U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
      )
      and char_length(personal_account_id) between 1 and 128
      and octet_length(personal_account_id) <= 512
      and personal_account_id !~ '[[:cntrl:]]'
      and personal_account_id !~ U&'[\007F-\009F]'
    ),
  constraint faolla_personal_accounts_status_valid
    check (status in ('active', 'disabled')),
  constraint faolla_personal_accounts_version_valid
    check (version >= 1),
  constraint faolla_personal_accounts_timestamps_valid
    check (updated_at >= created_at)
);

do $$
begin
  if exists (
    select 1
      from (values
        ('auth_user_id'),
        ('personal_account_id'),
        ('status'),
        ('version'),
        ('created_at'),
        ('updated_at')
      ) as required_column(column_name)
     where not exists (
       select 1
         from pg_catalog.pg_class as table_relation
         join pg_catalog.pg_namespace as table_namespace
           on table_namespace.oid = table_relation.relnamespace
         join pg_catalog.pg_attribute as table_attribute
           on table_attribute.attrelid = table_relation.oid
          and table_attribute.attname = required_column.column_name
          and not table_attribute.attisdropped
        where table_namespace.nspname = 'public'
          and table_relation.relname = 'faolla_personal_accounts'
     )
  ) or exists (
    select 1
      from (values
        ('faolla_personal_accounts_personal_account_id_safe'),
        ('faolla_personal_accounts_status_valid'),
        ('faolla_personal_accounts_version_valid'),
        ('faolla_personal_accounts_timestamps_valid')
      ) as required_constraint(constraint_name)
     where not exists (
       select 1
         from pg_catalog.pg_constraint as table_constraint
         join pg_catalog.pg_class as table_relation
           on table_relation.oid = table_constraint.conrelid
         join pg_catalog.pg_namespace as table_namespace
           on table_namespace.oid = table_relation.relnamespace
        where table_namespace.nspname = 'public'
          and table_relation.relname = 'faolla_personal_accounts'
          and table_constraint.conname =
            required_constraint.constraint_name
          and table_constraint.contype = 'c'
          and table_constraint.convalidated
     )
  ) then
    raise exception 'ordinary_account_authorization_personal_table_invalid';
  end if;
end;
$$;

alter table public.faolla_personal_accounts enable row level security;
revoke all on table public.faolla_personal_accounts
  from public, anon, authenticated, service_role;

create or replace function
  public.faolla_guard_personal_account_binding_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'personal_account_binding_delete_forbidden';
  end if;
  if new.auth_user_id is distinct from old.auth_user_id
     or new.personal_account_id is distinct from old.personal_account_id
     or new.created_at is distinct from old.created_at then
    raise exception 'personal_account_binding_identity_immutable';
  end if;
  if new.status is not distinct from old.status then
    raise exception 'personal_account_binding_status_transition_invalid';
  end if;
  if new.version <> old.version + 1 then
    raise exception 'personal_account_binding_version_conflict';
  end if;
  new.updated_at := greatest(statement_timestamp(), old.updated_at);
  return new;
end;
$$;

revoke all on function public.faolla_guard_personal_account_binding_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists faolla_personal_accounts_binding_guard
  on public.faolla_personal_accounts;
create trigger faolla_personal_accounts_binding_guard
before update or delete on public.faolla_personal_accounts
for each row execute function public.faolla_guard_personal_account_binding_v1();
alter table public.faolla_personal_accounts
  enable always trigger faolla_personal_accounts_binding_guard;

commit;

-- A failed concurrent build can leave an invalid same-named index. The
-- production migration runner retains its session advisory lock between these
-- boundaries, so an unregistered retry may safely replace these exact targets.
drop index concurrently if exists
  public.faolla_personal_accounts_auth_user_id_uidx;
create unique index concurrently
  faolla_personal_accounts_auth_user_id_uidx
  on public.faolla_personal_accounts(auth_user_id);

drop index concurrently if exists
  public.faolla_personal_accounts_personal_account_id_uidx;
create unique index concurrently
  faolla_personal_accounts_personal_account_id_uidx
  on public.faolla_personal_accounts(personal_account_id);

begin;

set local quote_all_identifiers = off;

create or replace function
  public.faolla_resolve_ordinary_account_authorization_v1(
    p_auth_user_id uuid
  )
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
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
     where p_auth_user_id = any(array_remove(array[
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
   where p_auth_user_id = any(array_remove(array[
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

create or replace function
  public.faolla_get_ordinary_account_authorization_readiness_v1()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
begin
  with runtime_text_rules as materialized (
    -- Exact ECMAScript WhiteSpace + LineTerminator set used by
    -- String.trim() and \s in the deployed Node runtime.
    select
      U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'::text
        as js_trim_chars
  ), merchant_rows as materialized (
    select
      merchant.id,
      (
        nullif(btrim(merchant.email, text_rules.js_trim_chars), '')
          is not null
        or nullif(
          btrim(merchant.owner_email, text_rules.js_trim_chars), ''
        ) is not null
        or nullif(
          btrim(merchant.contact_email, text_rules.js_trim_chars), ''
        ) is not null
        or nullif(
          btrim(merchant.user_email, text_rules.js_trim_chars), ''
        ) is not null
      ) as has_email_alias,
      alias_summary.alias_count,
      alias_summary.bound_auth_user_id,
      auth_user.id is not null as auth_user_exists
    from public.merchants as merchant
    cross join runtime_text_rules as text_rules
    cross join lateral (
      select
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
    ) as alias_summary
    left join auth.users as auth_user
      on auth_user.id = alias_summary.bound_auth_user_id
  ), merchant_summary as materialized (
    select
      count(*)::integer as record_count,
      count(*) filter (
        where alias_count = 1
          and auth_user_exists
          and id ~ '^[0-9]{8}$'
      )::integer as consistent_binding_count,
      count(*) filter (where alias_count > 1)::integer
        as alias_conflict_count,
      count(*) filter (
        where alias_count = 0 and has_email_alias
      )::integer as email_only_count,
      count(*) filter (
        where alias_count = 0 and not has_email_alias
      )::integer as unbound_count,
      count(*) filter (
        where alias_count = 1 and not auth_user_exists
      )::integer as orphan_binding_count,
      count(*) filter (where id !~ '^[0-9]{8}$')::integer
        as invalid_merchant_id_count
    from merchant_rows
  ), merchant_multi_owner_summary as materialized (
    select count(*)::integer as auth_user_count
      from (
        select merchant_row.bound_auth_user_id
          from merchant_rows as merchant_row
         where merchant_row.alias_count = 1
           and merchant_row.auth_user_exists
           and merchant_row.id ~ '^[0-9]{8}$'
         group by merchant_row.bound_auth_user_id
        having count(*) > 1
      ) as multi_owner
  ), auth_metadata_string_values as materialized (
    -- readMetadataString ignores every non-string JSON value. Strip those
    -- values once so every ->> lookup below has identical runtime semantics.
    select
      auth_user.id as auth_user_id,
      nullif(lower(btrim(
        auth_user.email,
        text_rules.js_trim_chars
      )), '') as normalized_email,
      text_rules.js_trim_chars,
      coalesce(app_strings.metadata, '{}'::jsonb) as app_metadata,
      coalesce(user_strings.metadata, '{}'::jsonb) as user_metadata
      from auth.users as auth_user
      cross join runtime_text_rules as text_rules
      cross join lateral (
        select jsonb_object_agg(entry.key, entry.value) as metadata
          from jsonb_each(case
            when jsonb_typeof(auth_user.raw_app_meta_data) = 'object'
              then auth_user.raw_app_meta_data
            else '{}'::jsonb
          end) as entry(key, value)
         where jsonb_typeof(entry.value) = 'string'
      ) as app_strings
      cross join lateral (
        select jsonb_object_agg(entry.key, entry.value) as metadata
          from jsonb_each(case
            when jsonb_typeof(auth_user.raw_user_meta_data) = 'object'
              then auth_user.raw_user_meta_data
            else '{}'::jsonb
          end) as entry(key, value)
         where jsonb_typeof(entry.value) = 'string'
      ) as user_strings
  ), auth_metadata_raw as materialized (
    select
      auth_user.auth_user_id,
      nullif(btrim(coalesce(
        auth_user.app_metadata ->> 'account_type',
        auth_user.app_metadata ->> 'accountType'
      ), auth_user.js_trim_chars), '') as app_account_type,
      nullif(btrim(coalesce(
        auth_user.user_metadata ->> 'account_type',
        auth_user.user_metadata ->> 'accountType'
      ), auth_user.js_trim_chars), '') as user_account_type,
      nullif(btrim(coalesce(
        auth_user.app_metadata ->> 'personal_id',
        auth_user.app_metadata ->> 'personalId'
      ), auth_user.js_trim_chars), '') as app_explicit_personal_id,
      nullif(btrim(coalesce(
        auth_user.user_metadata ->> 'personal_id',
        auth_user.user_metadata ->> 'personalId'
      ), auth_user.js_trim_chars), '') as user_explicit_personal_id,
      nullif(btrim(coalesce(
        auth_user.app_metadata ->> 'account_id',
        auth_user.app_metadata ->> 'accountId',
        auth_user.app_metadata ->> 'login_id',
        auth_user.app_metadata ->> 'loginId'
      ), auth_user.js_trim_chars), '') as app_account_id,
      nullif(btrim(coalesce(
        auth_user.user_metadata ->> 'account_id',
        auth_user.user_metadata ->> 'accountId',
        auth_user.user_metadata ->> 'login_id',
        auth_user.user_metadata ->> 'loginId'
      ), auth_user.js_trim_chars), '') as user_account_id,
      auth_user.normalized_email,
      auth_user.js_trim_chars,
      auth_user.app_metadata,
      auth_user.user_metadata
    from auth_metadata_string_values as auth_user
  ), auth_metadata_choices as materialized (
    select
      auth_metadata.*,
      coalesce(
        nullif(btrim(
          auth_metadata.user_metadata ->> 'account_type',
          auth_metadata.js_trim_chars
        ), ''),
        nullif(btrim(
          auth_metadata.user_metadata ->> 'accountType',
          auth_metadata.js_trim_chars
        ), ''),
        nullif(btrim(
          auth_metadata.app_metadata ->> 'account_type',
          auth_metadata.js_trim_chars
        ), ''),
        nullif(btrim(
          auth_metadata.app_metadata ->> 'accountType',
          auth_metadata.js_trim_chars
        ), '')
      ) as legacy_type_candidate,
      coalesce(
        nullif(btrim(
          auth_metadata.user_metadata ->> 'personal_id',
          auth_metadata.js_trim_chars
        ), ''),
        nullif(btrim(
          auth_metadata.user_metadata ->> 'personalId',
          auth_metadata.js_trim_chars
        ), ''),
        nullif(btrim(
          auth_metadata.app_metadata ->> 'personal_id',
          auth_metadata.js_trim_chars
        ), ''),
        nullif(btrim(
          auth_metadata.app_metadata ->> 'personalId',
          auth_metadata.js_trim_chars
        ), '')
      ) as legacy_personal_hint,
      coalesce(
        nullif(btrim(auth_metadata.user_metadata ->> 'merchant_id', auth_metadata.js_trim_chars), ''),
        nullif(btrim(auth_metadata.user_metadata ->> 'merchantId', auth_metadata.js_trim_chars), ''),
        nullif(btrim(auth_metadata.user_metadata ->> 'merchantID', auth_metadata.js_trim_chars), ''),
        nullif(btrim(auth_metadata.app_metadata ->> 'merchant_id', auth_metadata.js_trim_chars), ''),
        nullif(btrim(auth_metadata.app_metadata ->> 'merchantId', auth_metadata.js_trim_chars), ''),
        nullif(btrim(auth_metadata.app_metadata ->> 'merchantID', auth_metadata.js_trim_chars), '')
      ) as legacy_platform_merchant_hint,
      coalesce(
        nullif(btrim(auth_metadata.user_metadata ->> 'merchant_id', auth_metadata.js_trim_chars), ''),
        nullif(btrim(auth_metadata.user_metadata ->> 'merchantId', auth_metadata.js_trim_chars), ''),
        nullif(btrim(auth_metadata.user_metadata ->> 'merchantID', auth_metadata.js_trim_chars), ''),
        nullif(btrim(auth_metadata.user_metadata ->> 'login_id', auth_metadata.js_trim_chars), ''),
        nullif(btrim(auth_metadata.user_metadata ->> 'loginId', auth_metadata.js_trim_chars), ''),
        nullif(btrim(auth_metadata.app_metadata ->> 'merchant_id', auth_metadata.js_trim_chars), ''),
        nullif(btrim(auth_metadata.app_metadata ->> 'merchantId', auth_metadata.js_trim_chars), ''),
        nullif(btrim(auth_metadata.app_metadata ->> 'merchantID', auth_metadata.js_trim_chars), ''),
        nullif(btrim(auth_metadata.app_metadata ->> 'login_id', auth_metadata.js_trim_chars), ''),
        nullif(btrim(auth_metadata.app_metadata ->> 'loginId', auth_metadata.js_trim_chars), '')
      ) as legacy_merchant_hint,
      coalesce(
        nullif(btrim(auth_metadata.user_metadata ->> 'account_id', auth_metadata.js_trim_chars), ''),
        nullif(btrim(auth_metadata.user_metadata ->> 'accountId', auth_metadata.js_trim_chars), ''),
        nullif(btrim(auth_metadata.user_metadata ->> 'personal_id', auth_metadata.js_trim_chars), ''),
        nullif(btrim(auth_metadata.user_metadata ->> 'personalId', auth_metadata.js_trim_chars), ''),
        nullif(btrim(auth_metadata.user_metadata ->> 'merchant_id', auth_metadata.js_trim_chars), ''),
        nullif(btrim(auth_metadata.user_metadata ->> 'merchantId', auth_metadata.js_trim_chars), ''),
        nullif(btrim(auth_metadata.user_metadata ->> 'merchantID', auth_metadata.js_trim_chars), ''),
        nullif(btrim(auth_metadata.user_metadata ->> 'login_id', auth_metadata.js_trim_chars), ''),
        nullif(btrim(auth_metadata.user_metadata ->> 'loginId', auth_metadata.js_trim_chars), ''),
        nullif(btrim(auth_metadata.app_metadata ->> 'account_id', auth_metadata.js_trim_chars), ''),
        nullif(btrim(auth_metadata.app_metadata ->> 'accountId', auth_metadata.js_trim_chars), ''),
        nullif(btrim(auth_metadata.app_metadata ->> 'personal_id', auth_metadata.js_trim_chars), ''),
        nullif(btrim(auth_metadata.app_metadata ->> 'personalId', auth_metadata.js_trim_chars), ''),
        nullif(btrim(auth_metadata.app_metadata ->> 'merchant_id', auth_metadata.js_trim_chars), ''),
        nullif(btrim(auth_metadata.app_metadata ->> 'merchantId', auth_metadata.js_trim_chars), ''),
        nullif(btrim(auth_metadata.app_metadata ->> 'merchantID', auth_metadata.js_trim_chars), ''),
        nullif(btrim(auth_metadata.app_metadata ->> 'login_id', auth_metadata.js_trim_chars), ''),
        nullif(btrim(auth_metadata.app_metadata ->> 'loginId', auth_metadata.js_trim_chars), '')
      ) as legacy_account_id_candidate
    from auth_metadata_raw as auth_metadata
  ), auth_metadata_legacy as materialized (
    select
      auth_metadata.*,
      case
        when auth_metadata.legacy_type_candidate in ('merchant', 'personal')
          then auth_metadata.legacy_type_candidate
        when auth_metadata.legacy_personal_hint is not null then 'personal'
        when auth_metadata.legacy_platform_merchant_hint is not null
          then 'merchant'
        else null
      end as legacy_account_type
    from auth_metadata_choices as auth_metadata
  ), merchant_positive_bindings as materialized (
    select
      merchant_row.bound_auth_user_id as auth_user_id,
      merchant_row.id as merchant_id
      from merchant_rows as merchant_row
     where merchant_row.alias_count = 1
       and merchant_row.auth_user_exists
       and merchant_row.id ~ '^[0-9]{8}$'
  ), merchant_metadata_legacy_bindings as materialized (
    -- readMerchantIdFromMetadata reads user metadata before app metadata and
    -- accepts these five aliases in this exact order, regardless of the
    -- platform account_type hint.
    select
      auth_metadata.auth_user_id,
      auth_metadata.legacy_merchant_hint as merchant_id
      from auth_metadata_legacy as auth_metadata
     where auth_metadata.legacy_merchant_hint ~ '^[0-9]{8}$'
  ), merchant_email_legacy_bindings as materialized (
    -- Current list/session/RLS paths normalize Auth email and, in the broadest
    -- authorization paths, trim and case-fold the merchant-side aliases too.
    -- Use that security-relevant union so readiness can over-report but never
    -- miss an email authorization that the positive resolver will remove.
    select distinct
      auth_metadata.auth_user_id,
      merchant.id as merchant_id
      from auth_metadata_legacy as auth_metadata
      join public.merchants as merchant
        on lower(btrim(
          merchant.email,
          auth_metadata.js_trim_chars
        )) = auth_metadata.normalized_email
        or lower(btrim(
          merchant.owner_email,
          auth_metadata.js_trim_chars
        )) =
          auth_metadata.normalized_email
        or lower(btrim(
          merchant.contact_email,
          auth_metadata.js_trim_chars
        )) =
          auth_metadata.normalized_email
        or lower(btrim(
          merchant.user_email,
          auth_metadata.js_trim_chars
        )) =
          auth_metadata.normalized_email
     where auth_metadata.normalized_email is not null
       and merchant.id ~ '^[0-9]{8}$'
  ), merchant_metadata_without_positive as materialized (
    select distinct legacy_binding.auth_user_id
      from merchant_metadata_legacy_bindings as legacy_binding
     where not exists (
       select 1
         from merchant_positive_bindings as positive_binding
        where positive_binding.auth_user_id = legacy_binding.auth_user_id
          and positive_binding.merchant_id = legacy_binding.merchant_id
     )
  ), merchant_email_without_positive as materialized (
    select distinct legacy_binding.auth_user_id
      from merchant_email_legacy_bindings as legacy_binding
     where not exists (
       select 1
         from merchant_positive_bindings as positive_binding
        where positive_binding.auth_user_id = legacy_binding.auth_user_id
          and positive_binding.merchant_id = legacy_binding.merchant_id
     )
  ), merchant_legacy_without_positive as materialized (
    select metadata_gap.auth_user_id
      from merchant_metadata_without_positive as metadata_gap
    union
    select email_gap.auth_user_id
      from merchant_email_without_positive as email_gap
  ), merchant_legacy_gap_summary as materialized (
    select
      (select count(*)::integer
         from merchant_metadata_without_positive)
        as metadata_without_positive_binding_auth_user_count,
      (select count(*)::integer
         from merchant_email_without_positive)
        as email_without_positive_binding_auth_user_count,
      (select count(*)::integer
         from merchant_legacy_without_positive)
        as legacy_without_positive_binding_auth_user_count
  ), personal_metadata as materialized (
    select
      auth_metadata.auth_user_id,
      auth_metadata.app_account_type,
      auth_metadata.user_account_type,
      auth_metadata.js_trim_chars,
      nullif(translate(coalesce(
        auth_metadata.app_explicit_personal_id,
        case
          when auth_metadata.app_account_type = 'personal'
            then auth_metadata.app_account_id
          else null
        end
      ), auth_metadata.js_trim_chars, ''), '') as app_personal_id,
      nullif(translate(coalesce(
        auth_metadata.user_explicit_personal_id,
        case
          when auth_metadata.user_account_type = 'personal'
            then auth_metadata.user_account_id
          else null
        end
      ), auth_metadata.js_trim_chars, ''), '') as user_personal_id,
      case
        when auth_metadata.legacy_account_type = 'personal' then
          nullif(translate(
            auth_metadata.legacy_account_id_candidate,
            auth_metadata.js_trim_chars,
            ''
          ), '')
        else null
      end as effective_personal_id,
      (
        app_type_alias.has_conflict
        or app_id_alias.has_conflict
      ) as app_alias_conflict,
      (
        user_type_alias.has_conflict
        or user_id_alias.has_conflict
      ) as user_alias_conflict,
      app_id_alias.has_unsafe_value as app_has_unsafe_id_alias,
      user_id_alias.has_unsafe_value as user_has_unsafe_id_alias,
      (
        auth_metadata.legacy_personal_hint is not null
        and auth_metadata.legacy_account_type is distinct from 'personal'
      ) as metadata_type_conflict,
      (
        auth_metadata.legacy_account_type = 'personal'
      ) as is_personal
    from auth_metadata_legacy as auth_metadata
    cross join lateral (
      select count(distinct lower(btrim(
        type_alias.value,
        auth_metadata.js_trim_chars
      ))) > 1
        as has_conflict
      from unnest(array[
        auth_metadata.app_metadata ->> 'account_type',
        auth_metadata.app_metadata ->> 'accountType'
      ]::text[]) as type_alias(value)
     where nullif(btrim(
       type_alias.value,
       auth_metadata.js_trim_chars
     ), '') is not null
    ) as app_type_alias
    cross join lateral (
      select count(distinct lower(btrim(
        type_alias.value,
        auth_metadata.js_trim_chars
      ))) > 1
        as has_conflict
      from unnest(array[
        auth_metadata.user_metadata ->> 'account_type',
        auth_metadata.user_metadata ->> 'accountType'
      ]::text[]) as type_alias(value)
     where nullif(btrim(
       type_alias.value,
       auth_metadata.js_trim_chars
     ), '') is not null
    ) as user_type_alias
    cross join lateral (
      select
        count(distinct nullif(translate(
          id_alias.value,
          auth_metadata.js_trim_chars,
          ''
        ), '')) > 1
          as has_conflict,
        coalesce(bool_or(
          id_alias.value is not null
          and (
            id_alias.value <> btrim(
              id_alias.value,
              auth_metadata.js_trim_chars
            )
            or char_length(id_alias.value) not between 1 and 128
            or octet_length(id_alias.value) > 512
            or id_alias.value ~ '[[:cntrl:]]'
            or id_alias.value ~ U&'[\007F-\009F]'
          )
        ), false) as has_unsafe_value
      from unnest(array[
        auth_metadata.app_metadata ->> 'account_id',
        auth_metadata.app_metadata ->> 'accountId',
        auth_metadata.app_metadata ->> 'personal_id',
        auth_metadata.app_metadata ->> 'personalId',
        auth_metadata.app_metadata ->> 'merchant_id',
        auth_metadata.app_metadata ->> 'merchantId',
        auth_metadata.app_metadata ->> 'merchantID',
        auth_metadata.app_metadata ->> 'login_id',
        auth_metadata.app_metadata ->> 'loginId'
      ]::text[]) as id_alias(value)
    ) as app_id_alias
    cross join lateral (
      select
        count(distinct nullif(translate(
          id_alias.value,
          auth_metadata.js_trim_chars,
          ''
        ), '')) > 1
          as has_conflict,
        coalesce(bool_or(
          id_alias.value is not null
          and (
            id_alias.value <> btrim(
              id_alias.value,
              auth_metadata.js_trim_chars
            )
            or char_length(id_alias.value) not between 1 and 128
            or octet_length(id_alias.value) > 512
            or id_alias.value ~ '[[:cntrl:]]'
            or id_alias.value ~ U&'[\007F-\009F]'
          )
        ), false) as has_unsafe_value
      from unnest(array[
        auth_metadata.user_metadata ->> 'account_id',
        auth_metadata.user_metadata ->> 'accountId',
        auth_metadata.user_metadata ->> 'personal_id',
        auth_metadata.user_metadata ->> 'personalId',
        auth_metadata.user_metadata ->> 'merchant_id',
        auth_metadata.user_metadata ->> 'merchantId',
        auth_metadata.user_metadata ->> 'merchantID',
        auth_metadata.user_metadata ->> 'login_id',
        auth_metadata.user_metadata ->> 'loginId'
      ]::text[]) as id_alias(value)
    ) as user_id_alias
  ), personal_metadata_duplicate_summary as materialized (
    select count(*)::integer as duplicate_id_group_count
      from (
        select personal_metadata_row.effective_personal_id
          from personal_metadata as personal_metadata_row
         where personal_metadata_row.is_personal
           and personal_metadata_row.effective_personal_id is not null
         group by personal_metadata_row.effective_personal_id
        having count(*) > 1
      ) as duplicate_personal_id
  ), personal_summary as materialized (
    select
      (select count(*)::integer
         from public.faolla_personal_accounts)
        as canonical_binding_count,
      (select count(*)::integer
         from public.faolla_personal_accounts as personal_account
        where personal_account.status = 'active')
        as canonical_active_binding_count,
      (select count(*)::integer
         from public.faolla_personal_accounts as personal_account
        where personal_account.status = 'disabled')
        as canonical_disabled_binding_count,
      (select count(*)::integer
         from public.faolla_personal_accounts as personal_account
         left join auth.users as auth_user
           on auth_user.id = personal_account.auth_user_id
        where auth_user.id is null)
        as canonical_orphan_count,
      (select count(*)::integer
         from personal_metadata as metadata
        where metadata.is_personal)
        as metadata_principal_count,
      (select count(*)::integer
         from personal_metadata as metadata
         left join public.faolla_personal_accounts as personal_account
           on personal_account.auth_user_id = metadata.auth_user_id
        where metadata.is_personal
          and personal_account.auth_user_id is null)
        as metadata_without_canonical_binding_count,
      (select count(*)::integer
         from public.faolla_personal_accounts as personal_account
         left join personal_metadata as metadata
           on metadata.auth_user_id = personal_account.auth_user_id
        where coalesce(metadata.is_personal, false) = false)
        as canonical_without_metadata_count,
      (select count(*)::integer
         from personal_metadata as metadata
         left join public.faolla_personal_accounts as personal_account
           on personal_account.auth_user_id = metadata.auth_user_id
        where metadata.metadata_type_conflict
          or (
            metadata.is_personal
            and (
              metadata.app_account_type is distinct from
                metadata.user_account_type
              or metadata.app_alias_conflict
              or metadata.user_alias_conflict
              or metadata.app_personal_id is distinct from
                metadata.user_personal_id
              or (
                personal_account.personal_account_id is not null
                and personal_account.personal_account_id is distinct from
                  metadata.effective_personal_id
              )
            )
          )) as metadata_divergence_count,
      (select count(*)::integer
         from personal_metadata as metadata
        where metadata.metadata_type_conflict)
        as metadata_type_conflict_count,
      (select count(*)::integer
         from personal_metadata as metadata
        where metadata.is_personal
          and metadata.effective_personal_id is null)
        as metadata_missing_id_count,
      (select count(*)::integer
         from personal_metadata as metadata
        where metadata.is_personal
          and metadata.effective_personal_id is not null
          and (
            metadata.app_has_unsafe_id_alias
            or metadata.user_has_unsafe_id_alias
            or
            metadata.effective_personal_id <> btrim(
              metadata.effective_personal_id,
              metadata.js_trim_chars
            )
            or char_length(metadata.effective_personal_id) not between 1 and 128
            or octet_length(metadata.effective_personal_id) > 512
            or metadata.effective_personal_id ~ '[[:cntrl:]]'
            or metadata.effective_personal_id ~ U&'[\007F-\009F]'
          )) as unsafe_metadata_id_count
  ), personal_auth_ids as materialized (
    select personal_account.auth_user_id
      from public.faolla_personal_accounts as personal_account
    union
    select metadata.auth_user_id
      from personal_metadata as metadata
     where metadata.is_personal
  ), merchant_auth_aliases as materialized (
    select distinct merchant_alias.alias_id as auth_user_id
      from public.merchants as merchant
      cross join lateral unnest(array[
        merchant.user_id,
        merchant.auth_user_id,
        merchant.owner_user_id,
        merchant.owner_id,
        merchant.auth_id,
        merchant.created_by,
        merchant.created_by_user_id
      ]::uuid[]) as merchant_alias(alias_id)
     where merchant_alias.alias_id is not null
  ), cross_account_summary as materialized (
    select count(*)::integer as auth_user_count
      from (
        select distinct merchant_row.bound_auth_user_id
          from merchant_rows as merchant_row
          join personal_auth_ids as personal_identity
            on personal_identity.auth_user_id =
              merchant_row.bound_auth_user_id
         where merchant_row.alias_count = 1
      ) as overlapping_auth_user
  ), account_identifier_collision_summary as materialized (
    -- Personal IDs and merchant IDs share the current global allocator
    -- namespace. Disabled personal bindings remain reserved identities.
    select count(*)::integer as collision_count
      from public.faolla_personal_accounts as personal_account
      join public.merchants as merchant
        on merchant.id = personal_account.personal_account_id
  ), ordinary_auth_ids as materialized (
    select merchant_identity.auth_user_id
      from merchant_auth_aliases as merchant_identity
    union
    select personal_identity.auth_user_id
      from personal_auth_ids as personal_identity
  ), staff_overlap_summary as materialized (
    select count(*)::integer as auth_user_count
      from ordinary_auth_ids as ordinary_identity
      join public.merchant_enterprise_staff_identities as staff_identity
        on staff_identity.auth_user_id = ordinary_identity.auth_user_id
  )
  select jsonb_build_object(
    'schemaVersion', 1,
    'asOf', to_char(
      statement_timestamp() at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'readyForCutover', (
      merchant_summary.alias_conflict_count = 0
      and merchant_summary.email_only_count = 0
      and merchant_summary.unbound_count = 0
      and merchant_summary.orphan_binding_count = 0
      and merchant_summary.invalid_merchant_id_count = 0
      and merchant_legacy_gap_summary
        .metadata_without_positive_binding_auth_user_count = 0
      and merchant_legacy_gap_summary
        .email_without_positive_binding_auth_user_count = 0
      and merchant_legacy_gap_summary
        .legacy_without_positive_binding_auth_user_count = 0
      and personal_summary.canonical_orphan_count = 0
      and personal_summary.metadata_without_canonical_binding_count = 0
      and personal_metadata_duplicate_summary.duplicate_id_group_count = 0
      and personal_summary.metadata_divergence_count = 0
      and personal_summary.metadata_type_conflict_count = 0
      and personal_summary.metadata_missing_id_count = 0
      and personal_summary.unsafe_metadata_id_count = 0
      and cross_account_summary.auth_user_count = 0
      and account_identifier_collision_summary.collision_count = 0
      and staff_overlap_summary.auth_user_count = 0
    ),
    'merchant', jsonb_build_object(
      'recordCount', merchant_summary.record_count,
      'consistentBindingCount', merchant_summary.consistent_binding_count,
      'multiMerchantAuthUserCount',
        merchant_multi_owner_summary.auth_user_count,
      'aliasConflictCount', merchant_summary.alias_conflict_count,
      'emailOnlyCount', merchant_summary.email_only_count,
      'unboundCount', merchant_summary.unbound_count,
      'orphanBindingCount', merchant_summary.orphan_binding_count,
      'invalidMerchantIdCount', merchant_summary.invalid_merchant_id_count,
      'metadataWithoutPositiveBindingAuthUserCount',
        merchant_legacy_gap_summary
          .metadata_without_positive_binding_auth_user_count,
      'emailWithoutPositiveBindingAuthUserCount',
        merchant_legacy_gap_summary
          .email_without_positive_binding_auth_user_count,
      'legacyWithoutPositiveBindingAuthUserCount',
        merchant_legacy_gap_summary
          .legacy_without_positive_binding_auth_user_count
    ),
    'personal', jsonb_build_object(
      'canonicalBindingCount', personal_summary.canonical_binding_count,
      'canonicalActiveBindingCount',
        personal_summary.canonical_active_binding_count,
      'canonicalDisabledBindingCount',
        personal_summary.canonical_disabled_binding_count,
      'canonicalOrphanCount', personal_summary.canonical_orphan_count,
      'metadataPrincipalCount', personal_summary.metadata_principal_count,
      'metadataWithoutCanonicalBindingCount',
        personal_summary.metadata_without_canonical_binding_count,
      'canonicalWithoutMetadataCount',
        personal_summary.canonical_without_metadata_count,
      'duplicateMetadataIdGroupCount',
        personal_metadata_duplicate_summary.duplicate_id_group_count,
      'metadataDivergenceCount',
        personal_summary.metadata_divergence_count,
      'metadataTypeConflictCount',
        personal_summary.metadata_type_conflict_count,
      'metadataMissingIdCount', personal_summary.metadata_missing_id_count,
      'unsafeMetadataIdCount', personal_summary.unsafe_metadata_id_count
    ),
    'security', jsonb_build_object(
      'crossAccountTypeOverlapCount',
        cross_account_summary.auth_user_count,
      'accountIdentifierCollisionCount',
        account_identifier_collision_summary.collision_count,
      'staffRegistryOverlapCount', staff_overlap_summary.auth_user_count
    )
  )
    into v_result
    from merchant_summary
    cross join merchant_multi_owner_summary
    cross join merchant_legacy_gap_summary
    cross join personal_summary
    cross join personal_metadata_duplicate_summary
    cross join cross_account_summary
    cross join account_identifier_collision_summary
    cross join staff_overlap_summary;

  return v_result;
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

-- Registration is the commit marker. Verify both concurrent unique indexes,
-- table isolation, service-only execution, and the aggregate-only readiness
-- response first so a failed attempt remains safely retryable.
do $$
declare
  v_auth_user_index_valid boolean := false;
  v_personal_id_index_valid boolean := false;
  v_table_rls_enabled boolean := false;
  v_binding_guard_enabled boolean := false;
  v_readiness jsonb;
begin
  select
    index_metadata.indisready
    and index_metadata.indisvalid
    and index_metadata.indislive
    and index_metadata.indisunique
    and not index_metadata.indisprimary
    and not index_metadata.indisexclusion
    and index_metadata.indpred is null
    and index_metadata.indexprs is null
    and index_metadata.indnatts = 1
    and index_metadata.indnkeyatts = 1
    and index_relation.relkind = 'i'
    and table_namespace.nspname = 'public'
    and table_relation.relname = 'faolla_personal_accounts'
    and access_method.amname = 'btree'
    and index_metadata.indkey[0] = auth_user_id_attribute.attnum
    and not coalesce(
      pg_index_column_has_property(index_relation.oid, 1, 'desc'),
      false
    )
    into v_auth_user_index_valid
    from pg_catalog.pg_class as index_relation
    join pg_catalog.pg_namespace as index_namespace
      on index_namespace.oid = index_relation.relnamespace
    join pg_catalog.pg_index as index_metadata
      on index_metadata.indexrelid = index_relation.oid
    join pg_catalog.pg_class as table_relation
      on table_relation.oid = index_metadata.indrelid
    join pg_catalog.pg_namespace as table_namespace
      on table_namespace.oid = table_relation.relnamespace
    join pg_catalog.pg_am as access_method
      on access_method.oid = index_relation.relam
    join pg_catalog.pg_attribute as auth_user_id_attribute
      on auth_user_id_attribute.attrelid = table_relation.oid
     and auth_user_id_attribute.attname = 'auth_user_id'
     and not auth_user_id_attribute.attisdropped
   where index_namespace.nspname = 'public'
     and index_relation.relname =
       'faolla_personal_accounts_auth_user_id_uidx';

  select
    index_metadata.indisready
    and index_metadata.indisvalid
    and index_metadata.indislive
    and index_metadata.indisunique
    and not index_metadata.indisprimary
    and not index_metadata.indisexclusion
    and index_metadata.indpred is null
    and index_metadata.indexprs is null
    and index_metadata.indnatts = 1
    and index_metadata.indnkeyatts = 1
    and index_relation.relkind = 'i'
    and table_namespace.nspname = 'public'
    and table_relation.relname = 'faolla_personal_accounts'
    and access_method.amname = 'btree'
    and index_metadata.indkey[0] = personal_id_attribute.attnum
    and not coalesce(
      pg_index_column_has_property(index_relation.oid, 1, 'desc'),
      false
    )
    into v_personal_id_index_valid
    from pg_catalog.pg_class as index_relation
    join pg_catalog.pg_namespace as index_namespace
      on index_namespace.oid = index_relation.relnamespace
    join pg_catalog.pg_index as index_metadata
      on index_metadata.indexrelid = index_relation.oid
    join pg_catalog.pg_class as table_relation
      on table_relation.oid = index_metadata.indrelid
    join pg_catalog.pg_namespace as table_namespace
      on table_namespace.oid = table_relation.relnamespace
    join pg_catalog.pg_am as access_method
      on access_method.oid = index_relation.relam
    join pg_catalog.pg_attribute as personal_id_attribute
      on personal_id_attribute.attrelid = table_relation.oid
     and personal_id_attribute.attname = 'personal_account_id'
     and not personal_id_attribute.attisdropped
   where index_namespace.nspname = 'public'
     and index_relation.relname =
       'faolla_personal_accounts_personal_account_id_uidx';

  select table_relation.relrowsecurity
    into v_table_rls_enabled
    from pg_catalog.pg_class as table_relation
    join pg_catalog.pg_namespace as table_namespace
      on table_namespace.oid = table_relation.relnamespace
   where table_namespace.nspname = 'public'
     and table_relation.relname = 'faolla_personal_accounts';

  select
    trigger_metadata.tgenabled = 'A'
    and trigger_metadata.tgtype = 27
    and not trigger_metadata.tgisinternal
    into v_binding_guard_enabled
    from pg_catalog.pg_trigger as trigger_metadata
    join pg_catalog.pg_class as table_relation
      on table_relation.oid = trigger_metadata.tgrelid
    join pg_catalog.pg_namespace as table_namespace
      on table_namespace.oid = table_relation.relnamespace
   where table_namespace.nspname = 'public'
     and table_relation.relname = 'faolla_personal_accounts'
     and trigger_metadata.tgname =
       'faolla_personal_accounts_binding_guard';

  if not coalesce(v_auth_user_index_valid, false)
     or not coalesce(v_personal_id_index_valid, false)
     or not coalesce(v_table_rls_enabled, false)
     or not coalesce(v_binding_guard_enabled, false) then
    raise exception 'ordinary_account_authorization_schema_invalid';
  end if;

  if has_function_privilege(
       'anon',
       'public.faolla_resolve_ordinary_account_authorization_v1(uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.faolla_resolve_ordinary_account_authorization_v1(uuid)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.faolla_resolve_ordinary_account_authorization_v1(uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.faolla_get_ordinary_account_authorization_readiness_v1()',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.faolla_get_ordinary_account_authorization_readiness_v1()',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.faolla_get_ordinary_account_authorization_readiness_v1()',
       'EXECUTE'
     ) then
    raise exception 'ordinary_account_authorization_grant_invalid';
  end if;

  v_readiness :=
    public.faolla_get_ordinary_account_authorization_readiness_v1();
  if coalesce(jsonb_typeof(v_readiness), '') <> 'object'
     or not (v_readiness ?& array[
       'schemaVersion',
       'asOf',
       'readyForCutover',
       'merchant',
       'personal',
       'security'
     ])
     or coalesce(jsonb_typeof(v_readiness -> 'merchant'), '') <> 'object'
     or coalesce(jsonb_typeof(v_readiness -> 'personal'), '') <> 'object'
     or coalesce(jsonb_typeof(v_readiness -> 'security'), '') <> 'object' then
    raise exception 'ordinary_account_authorization_readiness_invalid';
  end if;
end;
$$;

insert into public.faolla_schema_migrations (version, name)
values (202608190035, 'ordinary_account_authorization_foundation')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
