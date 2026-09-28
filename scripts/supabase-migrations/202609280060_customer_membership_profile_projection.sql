begin;

-- Additive customer-directory transport projection only. No business data,
-- policies, writers, indexes, triggers or source ownership are changed.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $customer_membership_profile_preflight$
begin
  if pg_catalog.to_regclass('public.pages') is null
     or pg_catalog.to_regclass('public.faolla_schema_migrations') is null
     or (select count(*) from pg_catalog.pg_roles
          where rolname in ('anon', 'authenticated', 'service_role')) <> 3 then
    raise exception 'customer_membership_profile_dependency_missing';
  end if;
  if exists (select 1 from public.faolla_schema_migrations
              where version = 202609280060 and name <> 'customer_membership_profile_projection') then
    raise exception 'customer_membership_profile_registry_conflict';
  end if;
end;
$customer_membership_profile_preflight$;

create or replace function public.faolla_customer_membership_profiles_v1(p_site_id text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $customer_membership_profile_read$
declare
  v_result jsonb;
begin
  -- The caller supplies the already established merchant scope. This RPC does
  -- not authenticate a merchant; only the server service role may execute it.
  if p_site_id is null or length(p_site_id) <> 8 or p_site_id !~ '^[0-9]{8}$' then
    raise exception 'customer_membership_profile_invalid_site_id';
  end if;

  -- Cardinality, ownership, safety checks and projection share ONE statement
  -- snapshot. There is deliberately no arbitrary ordering/winner for duplicate
  -- pages. Global slug ambiguity also falls back to the unchanged legacy reader.
  with candidates as materialized (
    select page.id, page.merchant_id, page.slug, page.blocks, page.updated_at
      from public.pages as page
     where page.slug = '__merchant_memberships__:' || p_site_id
     limit 2
  ), eligible as materialized (
    select candidate.*
      from candidates as candidate
     where (select count(*) from candidates) = 1
       and candidate.merchant_id = p_site_id
       and jsonb_typeof(candidate.blocks) = 'array'
       and not exists (
         select 1
           from jsonb_array_elements(case
             when jsonb_typeof(candidate.blocks) = 'array' then candidate.blocks
             else '[]'::jsonb
           end) as member(value)
           cross join lateral jsonb_array_elements(case
             when jsonb_typeof(member.value) = 'object'
               and jsonb_typeof(member.value -> 'transactions') = 'array'
             then member.value -> 'transactions'
             else '[]'::jsonb
           end) as tx(value)
          where jsonb_typeof(tx.value) = 'object'
            and (jsonb_typeof(tx.value -> 'balanceDelta') in ('array', 'object')
              or jsonb_typeof(tx.value -> 'growthDelta') in ('array', 'object'))
       )
  ), projected as (
    select jsonb_build_object(
      'id', eligible.id,
      'slug', eligible.slug,
      'blocks', (
        select coalesce(jsonb_agg(case
          when jsonb_typeof(member.value) = 'object'
          then jsonb_set(member.value, '{transactions}', '[]'::jsonb, true)
          else member.value
        end order by member.ordinality), '[]'::jsonb)
          from jsonb_array_elements(eligible.blocks) with ordinality as member(value, ordinality)
      ),
      'updated_at', to_jsonb(eligible.updated_at)
    ) as row_payload
    from eligible
  )
  select coalesce(
    (select jsonb_build_object(
      'version', 1, 'status', 'projected', 'siteId', p_site_id,
      'rows', jsonb_build_array(projected.row_payload)
    ) from projected),
    jsonb_build_object('version', 1, 'status', 'fallback', 'siteId', p_site_id)
  ) into v_result;

  -- Do not parse dates/amounts or filter/deduplicate memberships here. Complex
  -- money takes the full legacy path, including invalid-date early exits and
  -- errors in foreign/overwritten records. The server retains both original
  -- profile-normalization passes and never exposes this view to a writer.
  return v_result;
end;
$customer_membership_profile_read$;

-- CREATE OR REPLACE preserves ACLs; reset every non-owner grant on this one
-- function, including replay-time drift/default privileges, then grant exactly
-- the service role. Existing functions, page SELECT ACLs and defaults stay put.
do $customer_membership_profile_acl$
declare
  v_function regprocedure := 'public.faolla_customer_membership_profiles_v1(text)'::regprocedure;
  v_grantee record;
begin
  for v_grantee in
    select distinct acl.grantee, role_metadata.rolname
      from pg_catalog.pg_proc as metadata
      cross join lateral pg_catalog.aclexplode(coalesce(metadata.proacl,
        pg_catalog.acldefault('f', metadata.proowner))) as acl
      left join pg_catalog.pg_roles as role_metadata on role_metadata.oid = acl.grantee
     where metadata.oid = v_function and acl.grantee <> metadata.proowner
  loop
    if v_grantee.grantee = 0 then
      execute format('revoke all on function %s from public cascade', v_function);
    else
      execute format('revoke all on function %s from %I cascade', v_function, v_grantee.rolname);
    end if;
  end loop;
end;
$customer_membership_profile_acl$;

revoke all on function public.faolla_customer_membership_profiles_v1(text) from public, anon, authenticated;
grant execute on function public.faolla_customer_membership_profiles_v1(text) to service_role;

insert into public.faolla_schema_migrations(version, name)
values (202609280060, 'customer_membership_profile_projection')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
commit;
