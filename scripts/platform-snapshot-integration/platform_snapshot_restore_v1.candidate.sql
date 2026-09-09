-- OFFLINE CANDIDATE ONLY. Supplemental to platform_snapshot_atomic_v1.candidate.sql.
-- Source binding is not a durable restore receipt or an ABA fence. Old writers
-- must still be drained before cutover. This file is not a registered migration.
begin;

do $platform_snapshot_restore_prerequisites$
begin
  if to_regprocedure('public.faolla_read_platform_snapshot_rows_v1(text)') is null
     or to_regprocedure('public.faolla_commit_platform_snapshot_rows_v1(text,jsonb,jsonb)') is null then
    raise exception 'platform_snapshot_atomic_install_conflict';
  end if;
exception when others then
  raise exception using errcode = 'P0001', message = 'platform_snapshot_atomic_install_conflict';
end;
$platform_snapshot_restore_prerequisites$;

create or replace function public.faolla_read_platform_snapshot_restore_v1(p_scope text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set timezone = 'UTC'
as $platform_snapshot_restore_read$
declare
  v_catalog jsonb;
  v_target jsonb;
  v_error text;
begin
  if p_scope is null or p_scope not in ('user_manage', 'support_messages') then
    raise exception 'platform_snapshot_atomic_invalid_request';
  end if;
  -- Use the EXISTING writer lock domain, never a separate restore lock. All
  -- participating writes are excluded across the two reads. Catalog slugs sort
  -- before either target scope; each v1 reader locks its rows in C slug/id order.
  perform pg_advisory_xact_lock(hashtextextended('faolla-platform-snapshot-atomic-v1', 0));
  v_catalog := public.faolla_read_platform_snapshot_rows_v1('backup_catalog');
  v_target := public.faolla_read_platform_snapshot_rows_v1(p_scope);
  return jsonb_build_object('version', 1, 'scope', p_scope, 'catalog', v_catalog, 'target', v_target);
exception when others then
  get stacked diagnostics v_error = message_text;
  if v_error not in ('platform_snapshot_atomic_invalid_request', 'platform_snapshot_atomic_store_corrupt') then
    v_error := 'platform_snapshot_atomic_store_corrupt';
  end if;
  raise exception using errcode = 'P0001', message = v_error;
end;
$platform_snapshot_restore_read$;

create or replace function public.faolla_commit_platform_snapshot_restore_v1(
  p_scope text, p_catalog_expected jsonb, p_target_expected jsonb, p_writes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set timezone = 'UTC'
as $platform_snapshot_restore_commit$
declare
  v_catalog_slugs text[] := array['__platform_admin_data_backup__', '__platform_admin_data_backup_backup__'];
  v_target_count integer;
  v_index integer;
  v_entry jsonb;
  v_expected_row jsonb;
  v_actual_row jsonb;
  v_expected_timestamp timestamptz;
  v_actual_timestamp timestamptz;
  v_catalog_before jsonb;
  v_target_saved jsonb;
  v_after jsonb;
  v_present_count integer := 0;
  v_seen_ids text[] := array[]::text[];
  v_error text;
  v_target_commit_started boolean := false;
begin
  case p_scope
    when 'user_manage' then v_target_count := 6;
    when 'support_messages' then v_target_count := 3;
    else raise exception 'platform_snapshot_atomic_invalid_request';
  end case;
  if p_catalog_expected is null or p_target_expected is null or p_writes is null
     or jsonb_typeof(p_catalog_expected) is distinct from 'array'
     or jsonb_typeof(p_target_expected) is distinct from 'array'
     or jsonb_typeof(p_writes) is distinct from 'array'
     or jsonb_array_length(p_catalog_expected) <> 2
     or jsonb_array_length(p_target_expected) <> v_target_count
     or jsonb_array_length(p_writes) <> v_target_count
     or octet_length(p_catalog_expected::text)::bigint + octet_length(p_target_expected::text)::bigint
        + octet_length(p_writes::text)::bigint > 67108864 then
    raise exception 'platform_snapshot_atomic_invalid_request';
  end if;

  -- Catalog is a complete READ dependency, not a write set. Validate it before
  -- any lock or nested DML, including nullable timestamps and absent copies.
  for v_index in 0 .. 1 loop
    v_entry := p_catalog_expected -> v_index;
    v_expected_row := v_entry -> 'row';
    if jsonb_typeof(v_entry) is distinct from 'object'
       or not (v_entry ?& array['slug', 'row'])
       or v_entry - array['slug', 'row'] <> '{}'::jsonb
       or jsonb_typeof(v_entry -> 'slug') is distinct from 'string'
       or v_entry ->> 'slug' is distinct from v_catalog_slugs[v_index + 1] then
      raise exception 'platform_snapshot_atomic_invalid_request';
    end if;
    if v_expected_row is distinct from 'null'::jsonb then
      if jsonb_typeof(v_expected_row) is distinct from 'object'
         or not (v_expected_row ?& array['id', 'blocks', 'updatedAt'])
         or v_expected_row - array['id', 'blocks', 'updatedAt'] <> '{}'::jsonb
         or jsonb_typeof(v_expected_row -> 'id') is distinct from 'string'
         or (v_expected_row ->> 'id') !~ '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
         or (v_expected_row ->> 'id') = any(v_seen_ids)
         or jsonb_typeof(v_expected_row -> 'blocks') is distinct from 'array'
         or (v_expected_row -> 'updatedAt' is distinct from 'null'::jsonb
           and (jsonb_typeof(v_expected_row -> 'updatedAt') is distinct from 'string'
             or (v_expected_row ->> 'updatedAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$')) then
        raise exception 'platform_snapshot_atomic_invalid_request';
      end if;
      v_expected_timestamp := (v_expected_row ->> 'updatedAt')::timestamptz;
      if v_expected_timestamp is not null and not isfinite(v_expected_timestamp) then
        raise exception 'platform_snapshot_atomic_invalid_request';
      end if;
      v_seen_ids := array_append(v_seen_ids, v_expected_row ->> 'id');
      v_present_count := v_present_count + 1;
    end if;
  end loop;
  -- Reads may report a missing catalog. A restore cannot originate from two
  -- confirmed missing copies; do not create an empty source as a side effect.
  if v_present_count = 0 then raise exception 'platform_snapshot_atomic_invalid_request'; end if;

  perform pg_advisory_xact_lock(hashtextextended('faolla-platform-snapshot-atomic-v1', 0));
  v_catalog_before := public.faolla_read_platform_snapshot_rows_v1('backup_catalog');
  for v_index in 0 .. 1 loop
    v_expected_row := p_catalog_expected -> v_index -> 'row';
    v_actual_row := v_catalog_before -> 'rows' -> v_index -> 'row';
    if v_expected_row = 'null'::jsonb or v_actual_row = 'null'::jsonb then
      if v_expected_row is distinct from v_actual_row then raise exception 'platform_snapshot_atomic_conflict'; end if;
    else
      v_expected_timestamp := (v_expected_row ->> 'updatedAt')::timestamptz;
      v_actual_timestamp := (v_actual_row ->> 'updatedAt')::timestamptz;
      if v_expected_row ->> 'id' is distinct from v_actual_row ->> 'id'
         or v_expected_row -> 'blocks' is distinct from v_actual_row -> 'blocks'
         or v_expected_timestamp is distinct from v_actual_timestamp then
        raise exception 'platform_snapshot_atomic_conflict';
      end if;
    end if;
  end loop;

  -- The nested v1 commit validates the complete target expectation and writes,
  -- performs target CAS, and verifies every affected row and final timestamp.
  -- It reacquires the same transaction advisory lock (which is reentrant).
  v_target_commit_started := true;
  v_target_saved := public.faolla_commit_platform_snapshot_rows_v1(p_scope, p_target_expected, p_writes);
  v_after := public.faolla_read_platform_snapshot_restore_v1(p_scope);
  -- A target AFTER trigger must not silently edit/remove/create a source row.
  -- Source rows are never rewritten, including a confirmed missing copy. Also
  -- recheck the target against the ACTUAL nested receipt after the source read.
  if v_after -> 'catalog' is distinct from v_catalog_before
     or v_after -> 'target' is distinct from v_target_saved then
    raise exception 'platform_snapshot_atomic_write_unconfirmed';
  end if;
  return v_after;
exception when others then
  get stacked diagnostics v_error = message_text;
  if v_target_commit_started then
    -- Preserve only an explicit nested pre-write conflict. All other failures
    -- after delegation conservatively report unconfirmed; no second attempt.
    if v_error <> 'platform_snapshot_atomic_conflict' then
      v_error := 'platform_snapshot_atomic_write_unconfirmed';
    end if;
  elsif v_error not in ('platform_snapshot_atomic_invalid_request', 'platform_snapshot_atomic_conflict', 'platform_snapshot_atomic_store_corrupt') then
    v_error := 'platform_snapshot_atomic_invalid_request';
  end if;
  -- Re-raising from this outer block rolls back a successful nested commit too.
  raise exception using errcode = 'P0001', message = v_error;
end;
$platform_snapshot_restore_commit$;

-- Normalize ACL drift on the TWO supplemental functions only. Do not change
-- existing v1 functions, table privileges, policies, indexes or deployment gates.
do $platform_snapshot_restore_acl$
declare
  v_function regprocedure;
  v_grantee record;
begin
  foreach v_function in array array[
    'public.faolla_read_platform_snapshot_restore_v1(text)'::regprocedure,
    'public.faolla_commit_platform_snapshot_restore_v1(text,jsonb,jsonb,jsonb)'::regprocedure
  ] loop
    for v_grantee in
      select distinct acl.grantee, role_metadata.rolname
        from pg_catalog.pg_proc metadata
        cross join lateral pg_catalog.aclexplode(coalesce(metadata.proacl, pg_catalog.acldefault('f', metadata.proowner))) acl
        left join pg_catalog.pg_roles role_metadata on role_metadata.oid = acl.grantee
       where metadata.oid = v_function and acl.grantee <> metadata.proowner
    loop
      if v_grantee.grantee = 0 then execute format('revoke all on function %s from public cascade', v_function);
      else execute format('revoke all on function %s from %I cascade', v_function, v_grantee.rolname); end if;
    end loop;
  end loop;
end;
$platform_snapshot_restore_acl$;
revoke all on function public.faolla_read_platform_snapshot_restore_v1(text) from public, anon, authenticated;
revoke all on function public.faolla_commit_platform_snapshot_restore_v1(text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.faolla_read_platform_snapshot_restore_v1(text) to service_role;
grant execute on function public.faolla_commit_platform_snapshot_restore_v1(text, jsonb, jsonb, jsonb) to service_role;

commit;
