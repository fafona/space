-- OFFLINE CANDIDATE ONLY. Install after the three frozen snapshot candidates.
-- No DML or business payload: this observes a committed receipt and the current
-- physical target vector under the existing transaction advisory lock. Base
-- reads use FOR UPDATE: this is NOT a PostgreSQL READ ONLY transaction function.
-- A match is not browser application, absence of intervening writes/ABA, future
-- stability, or coordination with legacy writers that ignore the shared lock.
begin;

do $platform_snapshot_inspection_install$
declare
  v_function regprocedure;
begin
  if to_regprocedure('pg_catalog.sha256(bytea)') is null then
    raise exception 'platform_snapshot_atomic_install_conflict';
  end if;
  foreach v_function in array array[
    to_regprocedure('public.faolla_read_platform_snapshot_restore_receipt_v1(text,text,text,text,text)'),
    to_regprocedure('public.faolla_read_platform_snapshot_rows_v1(text)')
  ] loop
    if v_function is null or not exists (
      select 1 from pg_proc where oid = v_function and proowner = current_user::regrole
        and prorettype = 'jsonb'::regtype and prosecdef and prokind = 'f'
    ) then
      raise exception 'platform_snapshot_atomic_install_conflict';
    end if;
  end loop;
  v_function := to_regprocedure('public.faolla_inspect_platform_snapshot_restore_receipt_v1(text,text,text,text,text)');
  if v_function is not null and not exists (
    select 1 from pg_proc where oid = v_function and proowner = current_user::regrole
  ) then
    raise exception 'platform_snapshot_atomic_install_conflict';
  end if;
exception when others then
  raise exception using errcode = 'P0001', message = 'platform_snapshot_atomic_install_conflict';
end;
$platform_snapshot_inspection_install$;

create or replace function public.faolla_inspect_platform_snapshot_restore_receipt_v1(
  p_operation_id text, p_actor_key text, p_scope text, p_backup_id text, p_confirmation_token text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set timezone = 'UTC'
set lock_timeout = '5s'
as $platform_snapshot_receipt_inspection$
declare
  v_lookup jsonb;
  v_receipt jsonb;
  v_target jsonb;
  v_target_hash text;
  v_error text;
begin
  -- The frozen reader validates the binding before taking this same advisory
  -- transaction lock. Nested calls retain the lock until the caller completes.
  v_lookup := public.faolla_read_platform_snapshot_restore_receipt_v1(
    p_operation_id, p_actor_key, p_scope, p_backup_id, p_confirmation_token
  );
  if v_lookup is null or jsonb_typeof(v_lookup) is distinct from 'object'
     or v_lookup -> 'version' is distinct from '1'::jsonb
     or not (v_lookup ? 'receipt')
     or v_lookup - array['version', 'receipt'] <> '{}'::jsonb then
    raise exception 'platform_snapshot_atomic_store_corrupt';
  end if;
  v_receipt := v_lookup -> 'receipt';
  if v_receipt = 'null'::jsonb then
    -- Missing/foreign is UNKNOWN; do not inspect or repair any target/catalog.
    return jsonb_build_object('version', 1, 'receipt', null, 'inspection', null);
  end if;
  if jsonb_typeof(v_receipt) is distinct from 'object'
     or v_receipt ->> 'resultHash' is null
     or v_receipt ->> 'resultHash' !~ '^[0-9a-f]{64}$' then
    raise exception 'platform_snapshot_atomic_store_corrupt';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('faolla-platform-snapshot-atomic-v1', 0));
  -- Read only the target scope. A later changed/missing/corrupt backup catalog
  -- cannot invalidate an already committed receipt's target comparison.
  v_target := public.faolla_read_platform_snapshot_rows_v1(p_scope);
  if v_target is null or jsonb_typeof(v_target) is distinct from 'object'
     or v_target -> 'version' is distinct from '1'::jsonb
     or v_target ->> 'scope' is distinct from p_scope
     or jsonb_typeof(v_target -> 'rows') is distinct from 'array'
     or v_target - array['version', 'scope', 'rows'] <> '{}'::jsonb then
    raise exception 'platform_snapshot_atomic_store_corrupt';
  end if;
  -- Exactly the frozen commit's PostgreSQL jsonb::text hash, including physical
  -- row ids and timestamp precision. Do not substitute JavaScript JSON encoding.
  v_target_hash := encode(pg_catalog.sha256(convert_to(v_target::text, 'UTF8')), 'hex');
  return jsonb_build_object('version', 1, 'receipt', v_receipt,
    'inspection', jsonb_build_object('version', 1, 'observedAt', clock_timestamp(),
      'targetState', case when v_target_hash = v_receipt ->> 'resultHash'
        then 'matches_commit' else 'differs_from_commit' end,
      'targetHash', v_target_hash));
exception when others then
  get stacked diagnostics v_error = message_text;
  if v_error not in ('platform_snapshot_atomic_invalid_request', 'platform_snapshot_atomic_store_corrupt') then
    v_error := 'platform_snapshot_atomic_store_corrupt';
  end if;
  -- Includes lock_timeout: an error is never fabricated into a missing receipt.
  raise exception using errcode = 'P0001', message = v_error;
end;
$platform_snapshot_receipt_inspection$;

-- Repair this new function's ACL, including grants to arbitrary API roles.
-- No dependency function/table grants or registered migration are modified.
do $platform_snapshot_inspection_acl$
declare
  v_function regprocedure := 'public.faolla_inspect_platform_snapshot_restore_receipt_v1(text,text,text,text,text)'::regprocedure;
  v_grantee record;
begin
  for v_grantee in
    select distinct acl.grantee, roles.rolname from pg_proc metadata
    cross join lateral aclexplode(coalesce(metadata.proacl, acldefault('f', metadata.proowner))) acl
    left join pg_roles roles on roles.oid = acl.grantee
    where metadata.oid = v_function and acl.grantee <> metadata.proowner
  loop
    if v_grantee.grantee = 0 then
      execute format('revoke all on function %s from public cascade', v_function);
    else
      execute format('revoke all on function %s from %I cascade', v_function, v_grantee.rolname);
    end if;
  end loop;
end;
$platform_snapshot_inspection_acl$;

revoke all on function public.faolla_inspect_platform_snapshot_restore_receipt_v1(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.faolla_inspect_platform_snapshot_restore_receipt_v1(text,text,text,text,text) to service_role;
commit;
