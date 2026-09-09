-- OFFLINE CANDIDATE ONLY. Install after the two frozen snapshot candidates.
-- Durable metadata confirms one operation, not current state, ABA protection or
-- compatibility with old writers. No cleanup/TTL or registered migration here.
begin;

do $platform_snapshot_receipts_install$
declare
  v_table oid;
  v_columns text[];
  v_check text;
  v_function regprocedure;
begin
  if to_regprocedure('pg_catalog.sha256(bytea)') is null
     or to_regprocedure('public.faolla_read_platform_snapshot_restore_v1(text)') is null
     or to_regprocedure('public.faolla_commit_platform_snapshot_restore_v1(text,jsonb,jsonb,jsonb)') is null then
    raise exception 'platform_snapshot_atomic_install_conflict';
  end if;
  v_table := to_regclass('public.faolla_platform_snapshot_restore_receipts');
  if v_table is null then
    create table public.faolla_platform_snapshot_restore_receipts (
      operation_id uuid not null,
      actor_key text not null,
      scope text not null,
      backup_id text not null,
      confirmation_token text not null,
      plan_hash text not null,
      result_hash text not null,
      committed_at timestamptz not null,
      constraint faolla_platform_snapshot_restore_receipts_pkey primary key (operation_id),
      constraint faolla_platform_snapshot_restore_receipts_metadata_check check (
        actor_key ~ '^[0-9a-f]{64}$'
        and scope = any (array['user_manage', 'support_messages'])
        and backup_id = btrim(backup_id) and char_length(backup_id) >= 1 and char_length(backup_id) <= 500
        and confirmation_token ~ '^v1\.[0-9a-f]{64}$'
        and plan_hash ~ '^[0-9a-f]{64}$' and result_hash ~ '^[0-9a-f]{64}$'
        and isfinite(committed_at)
      )
    );
    v_table := 'public.faolla_platform_snapshot_restore_receipts'::regclass;
  end if;
  -- Do not silently adopt an unrelated, weakened or expanded table. ACL/RLS
  -- drift can be repaired, but physical schema, constraints and owners cannot.
  if not exists (select 1 from pg_class where oid = v_table and relkind = 'r' and relpersistence = 'p'
       and not relispartition and reloftype = 0 and relowner = current_user::regrole)
     or exists (select 1 from pg_inherits where inhrelid = v_table or inhparent = v_table)
     or exists (select 1 from pg_policy where polrelid = v_table)
     or exists (select 1 from pg_trigger where tgrelid = v_table and not tgisinternal)
     or exists (select 1 from pg_rewrite where ev_class = v_table)
     or exists (select 1 from pg_attrdef where adrelid = v_table)
     or exists (select 1 from pg_attribute where attrelid = v_table and attnum > 0 and attisdropped)
     or exists (select 1 from pg_attribute a join pg_type t on t.oid = a.atttypid
       where a.attrelid = v_table and a.attnum > 0 and (t.typnamespace <> 'pg_catalog'::regnamespace
         or a.atttypmod <> -1 or a.attndims <> 0 or a.attcollation <> t.typcollation)) then
    raise exception 'platform_snapshot_atomic_install_conflict';
  end if;
  select array_agg(a.attname || ':' || t.typname || ':' || a.attnotnull::text || ':' || a.attidentity || ':' || a.attgenerated order by a.attnum)
    into v_columns from pg_attribute a join pg_type t on t.oid = a.atttypid
   where a.attrelid = v_table and a.attnum > 0 and not a.attisdropped;
  if v_columns is distinct from array['operation_id:uuid:true::', 'actor_key:text:true::', 'scope:text:true::',
      'backup_id:text:true::', 'confirmation_token:text:true::', 'plan_hash:text:true::',
      'result_hash:text:true::', 'committed_at:timestamptz:true::']
     or (select count(*) from pg_constraint where conrelid = v_table) <> 2
     or not exists (select 1 from pg_constraint where conrelid = v_table
       and conname = 'faolla_platform_snapshot_restore_receipts_pkey' and contype = 'p'
       and convalidated and not condeferrable and conkey = array[1]::smallint[])
     or (select count(*) from pg_index where indrelid = v_table) <> 1
     or not exists (select 1 from pg_index where indrelid = v_table
       and indisvalid and indisready and indisunique and indisprimary) then
    raise exception 'platform_snapshot_atomic_install_conflict';
  end if;
  select lower(regexp_replace(pg_get_constraintdef(oid), '[[:space:]()]|::text', '', 'g')) into v_check
    from pg_constraint where conrelid = v_table and conname = 'faolla_platform_snapshot_restore_receipts_metadata_check'
     and contype = 'c' and convalidated and not connoinherit;
  if v_check is distinct from lower(regexp_replace($expected_check$CHECK (
      actor_key ~ '^[0-9a-f]{64}$'
      and scope = ANY (ARRAY['user_manage', 'support_messages'])
      and backup_id = btrim(backup_id) and char_length(backup_id) >= 1 and char_length(backup_id) <= 500
      and confirmation_token ~ '^v1\.[0-9a-f]{64}$'
      and plan_hash ~ '^[0-9a-f]{64}$' and result_hash ~ '^[0-9a-f]{64}$'
      and isfinite(committed_at)
    )$expected_check$, '[[:space:]()]|::text', '', 'g')) then
    raise exception 'platform_snapshot_atomic_install_conflict';
  end if;
  foreach v_function in array array[
    to_regprocedure('public.faolla_read_platform_snapshot_restore_receipt_v1(text,text,text,text,text)'),
    to_regprocedure('public.faolla_commit_platform_snapshot_restore_receipt_v1(text,text,text,text,text,jsonb,jsonb,jsonb)')
  ] loop
    if v_function is not null and not exists (select 1 from pg_proc where oid = v_function and proowner = current_user::regrole) then
      raise exception 'platform_snapshot_atomic_install_conflict';
    end if;
  end loop;
exception when others then
  raise exception using errcode = 'P0001', message = 'platform_snapshot_atomic_install_conflict';
end;
$platform_snapshot_receipts_install$;

alter table public.faolla_platform_snapshot_restore_receipts enable row level security;

create or replace function public.faolla_read_platform_snapshot_restore_receipt_v1(
  p_operation_id text, p_actor_key text, p_scope text, p_backup_id text, p_confirmation_token text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set timezone = 'UTC'
as $platform_snapshot_receipt_read$
declare
  v_row public.faolla_platform_snapshot_restore_receipts%rowtype;
  v_receipt jsonb;
  v_error text;
begin
  if p_operation_id is null or p_operation_id !~ '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
     or p_actor_key is null or p_actor_key !~ '^[0-9a-f]{64}$'
     or p_scope is null or p_scope not in ('user_manage', 'support_messages')
     or p_backup_id is null or p_backup_id <> btrim(p_backup_id) or char_length(p_backup_id) not between 1 and 500
     or p_confirmation_token is null or p_confirmation_token !~ '^v1\.[0-9a-f]{64}$' then
    raise exception 'platform_snapshot_atomic_invalid_request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('faolla-platform-snapshot-atomic-v1', 0));
  select * into v_row from public.faolla_platform_snapshot_restore_receipts
   where operation_id = p_operation_id::uuid and actor_key = p_actor_key and scope = p_scope
     and backup_id = p_backup_id and confirmation_token = p_confirmation_token;
  if not found then
    -- Includes an uncommitted/rolled-back/other-actor operation. Missing is
    -- UNKNOWN, never evidence that a new attempt is safe. No target read/write.
    return jsonb_build_object('version', 1, 'receipt', null);
  end if;
  if v_row.plan_hash !~ '^[0-9a-f]{64}$' or v_row.result_hash !~ '^[0-9a-f]{64}$' or not isfinite(v_row.committed_at) then
    raise exception 'platform_snapshot_atomic_store_corrupt';
  end if;
  v_receipt := jsonb_build_object('version', 1, 'operationId', v_row.operation_id::text, 'actorKey', v_row.actor_key,
    'scope', v_row.scope, 'backupId', v_row.backup_id, 'confirmationToken', v_row.confirmation_token,
    'planHash', v_row.plan_hash, 'resultHash', v_row.result_hash, 'committedAt', v_row.committed_at);
  return jsonb_build_object('version', 1, 'receipt', v_receipt);
exception when others then
  get stacked diagnostics v_error = message_text;
  if v_error not in ('platform_snapshot_atomic_invalid_request', 'platform_snapshot_atomic_store_corrupt') then
    v_error := 'platform_snapshot_atomic_store_corrupt';
  end if;
  raise exception using errcode = 'P0001', message = v_error;
end;
$platform_snapshot_receipt_read$;

create or replace function public.faolla_commit_platform_snapshot_restore_receipt_v1(
  p_operation_id text, p_actor_key text, p_scope text, p_backup_id text, p_confirmation_token text,
  p_catalog_expected jsonb, p_target_expected jsonb, p_writes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set timezone = 'UTC'
as $platform_snapshot_receipt_commit$
declare
  v_target_count integer;
  v_plan_hash text;
  v_result_hash text;
  v_committed_at timestamptz;
  v_existing public.faolla_platform_snapshot_restore_receipts%rowtype;
  v_saved public.faolla_platform_snapshot_restore_receipts%rowtype;
  v_receipt jsonb;
  v_result jsonb;
  v_after jsonb;
  v_error text;
  v_restore_started boolean := false;
  v_restore_returned boolean := false;
begin
  if p_operation_id is null or p_operation_id !~ '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
     or p_actor_key is null or p_actor_key !~ '^[0-9a-f]{64}$'
     or p_scope is null or p_scope not in ('user_manage', 'support_messages')
     or p_backup_id is null or p_backup_id <> btrim(p_backup_id) or char_length(p_backup_id) not between 1 and 500
     or p_confirmation_token is null or p_confirmation_token !~ '^v1\.[0-9a-f]{64}$' then
    raise exception 'platform_snapshot_atomic_invalid_request';
  end if;
  v_target_count := case p_scope when 'user_manage' then 6 else 3 end;
  if p_catalog_expected is null or p_target_expected is null or p_writes is null
     or jsonb_typeof(p_catalog_expected) is distinct from 'array'
     or jsonb_typeof(p_target_expected) is distinct from 'array'
     or jsonb_typeof(p_writes) is distinct from 'array'
     or jsonb_array_length(p_catalog_expected) <> 2
     or jsonb_array_length(p_target_expected) <> v_target_count or jsonb_array_length(p_writes) <> v_target_count
     or octet_length(jsonb_build_object('operationId', p_operation_id, 'actorKey', p_actor_key, 'scope', p_scope,
       'backupId', p_backup_id, 'confirmationToken', p_confirmation_token, 'catalogExpected', p_catalog_expected,
       'targetExpected', p_target_expected, 'writes', p_writes)::text)::bigint > 67108864 then
    raise exception 'platform_snapshot_atomic_invalid_request';
  end if;
  -- JSONB key order is canonical; the exact submitted physical plan, including
  -- row versions and write payloads, is bound. No normalization/plan regeneration.
  v_plan_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'catalogExpected', p_catalog_expected, 'targetExpected', p_target_expected, 'writes', p_writes)::text, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('faolla-platform-snapshot-atomic-v1', 0));
  select * into v_existing from public.faolla_platform_snapshot_restore_receipts where operation_id = p_operation_id::uuid for update;
  if found then
    if v_existing.actor_key is distinct from p_actor_key or v_existing.scope is distinct from p_scope
       or v_existing.backup_id is distinct from p_backup_id or v_existing.confirmation_token is distinct from p_confirmation_token
       or v_existing.plan_hash is distinct from v_plan_hash then
      raise exception 'platform_snapshot_atomic_conflict';
    end if;
    if v_existing.result_hash !~ '^[0-9a-f]{64}$' or not isfinite(v_existing.committed_at) then
      raise exception 'platform_snapshot_atomic_store_corrupt';
    end if;
    v_receipt := jsonb_build_object('version', 1, 'operationId', v_existing.operation_id::text, 'actorKey', v_existing.actor_key,
      'scope', v_existing.scope, 'backupId', v_existing.backup_id, 'confirmationToken', v_existing.confirmation_token,
      'planHash', v_existing.plan_hash, 'resultHash', v_existing.result_hash, 'committedAt', v_existing.committed_at);
    -- History has already been committed. Never read or rewrite today's target
    -- and never return stale business data for the browser to reapply.
    return jsonb_build_object('version', 1, 'receipt', v_receipt, 'result', null, 'replayed', true);
  end if;

  v_restore_started := true;
  v_result := public.faolla_commit_platform_snapshot_restore_v1(p_scope, p_catalog_expected, p_target_expected, p_writes);
  v_restore_returned := true;
  v_result_hash := encode(pg_catalog.sha256(convert_to((v_result -> 'target')::text, 'UTF8')), 'hex');
  v_committed_at := clock_timestamp();
  insert into public.faolla_platform_snapshot_restore_receipts(operation_id, actor_key, scope, backup_id,
    confirmation_token, plan_hash, result_hash, committed_at)
  values(p_operation_id::uuid, p_actor_key, p_scope, p_backup_id, p_confirmation_token, v_plan_hash, v_result_hash, v_committed_at);
  -- Receipt triggers can change either side of the prior nested transaction.
  -- Recheck actual source/target AND immutable metadata after all effects.
  v_after := public.faolla_read_platform_snapshot_restore_v1(p_scope);
  if v_after is distinct from v_result then raise exception 'platform_snapshot_atomic_write_unconfirmed'; end if;
  select * into v_saved from public.faolla_platform_snapshot_restore_receipts where operation_id = p_operation_id::uuid;
  if not found or v_saved.operation_id is distinct from p_operation_id::uuid
     or v_saved.actor_key is distinct from p_actor_key or v_saved.scope is distinct from p_scope
     or v_saved.backup_id is distinct from p_backup_id or v_saved.confirmation_token is distinct from p_confirmation_token
     or v_saved.plan_hash is distinct from v_plan_hash or v_saved.result_hash is distinct from v_result_hash
     or v_saved.committed_at is distinct from v_committed_at then
    raise exception 'platform_snapshot_atomic_write_unconfirmed';
  end if;
  v_receipt := jsonb_build_object('version', 1, 'operationId', v_saved.operation_id::text, 'actorKey', v_saved.actor_key,
    'scope', v_saved.scope, 'backupId', v_saved.backup_id, 'confirmationToken', v_saved.confirmation_token,
    'planHash', v_saved.plan_hash, 'resultHash', v_saved.result_hash, 'committedAt', v_saved.committed_at);
  return jsonb_build_object('version', 1, 'receipt', v_receipt, 'result', v_result, 'replayed', false);
exception when others then
  get stacked diagnostics v_error = message_text;
  if v_restore_returned then
    v_error := 'platform_snapshot_atomic_write_unconfirmed';
  elsif v_restore_started then
    if v_error <> 'platform_snapshot_atomic_conflict' then v_error := 'platform_snapshot_atomic_write_unconfirmed'; end if;
  elsif v_error not in ('platform_snapshot_atomic_invalid_request', 'platform_snapshot_atomic_conflict', 'platform_snapshot_atomic_store_corrupt') then
    v_error := 'platform_snapshot_atomic_write_unconfirmed';
  end if;
  raise exception using errcode = 'P0001', message = v_error;
end;
$platform_snapshot_receipt_commit$;

-- Both functions execute as the installer/owner; no role receives direct table
-- privileges. Repair custom/PUBLIC/column ACL drift too, not just known roles.
do $platform_snapshot_receipts_acl$
declare
  v_function regprocedure;
  v_grantee record;
  v_column record;
begin
  for v_grantee in
    select distinct acl.grantee, roles.rolname from pg_class metadata
      cross join lateral aclexplode(coalesce(metadata.relacl, acldefault('r', metadata.relowner))) acl
      left join pg_roles roles on roles.oid = acl.grantee
     where metadata.oid = 'public.faolla_platform_snapshot_restore_receipts'::regclass and acl.grantee <> metadata.relowner
  loop
    if v_grantee.grantee = 0 then revoke all on table public.faolla_platform_snapshot_restore_receipts from public cascade;
    else execute format('revoke all on table public.faolla_platform_snapshot_restore_receipts from %I cascade', v_grantee.rolname); end if;
  end loop;
  for v_column in
    select a.attname, acl.grantee, roles.rolname from pg_attribute a
      join pg_class c on c.oid = a.attrelid cross join lateral aclexplode(a.attacl) acl
      left join pg_roles roles on roles.oid = acl.grantee
     where a.attrelid = 'public.faolla_platform_snapshot_restore_receipts'::regclass and a.attnum > 0 and not a.attisdropped and acl.grantee <> c.relowner
  loop
    if v_column.grantee = 0 then
      execute format('revoke all (%I) on table public.faolla_platform_snapshot_restore_receipts from public cascade', v_column.attname);
    else
      execute format('revoke all (%I) on table public.faolla_platform_snapshot_restore_receipts from %I cascade', v_column.attname, v_column.rolname);
    end if;
  end loop;
  foreach v_function in array array[
    'public.faolla_read_platform_snapshot_restore_receipt_v1(text,text,text,text,text)'::regprocedure,
    'public.faolla_commit_platform_snapshot_restore_receipt_v1(text,text,text,text,text,jsonb,jsonb,jsonb)'::regprocedure
  ] loop
    for v_grantee in
      select distinct acl.grantee, roles.rolname from pg_proc metadata
        cross join lateral aclexplode(coalesce(metadata.proacl, acldefault('f', metadata.proowner))) acl
        left join pg_roles roles on roles.oid = acl.grantee where metadata.oid = v_function and acl.grantee <> metadata.proowner
    loop
      if v_grantee.grantee = 0 then execute format('revoke all on function %s from public cascade', v_function);
      else execute format('revoke all on function %s from %I cascade', v_function, v_grantee.rolname); end if;
    end loop;
  end loop;
end;
$platform_snapshot_receipts_acl$;
revoke all on table public.faolla_platform_snapshot_restore_receipts from public, anon, authenticated, service_role;
revoke all on function public.faolla_read_platform_snapshot_restore_receipt_v1(text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.faolla_commit_platform_snapshot_restore_receipt_v1(text,text,text,text,text,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.faolla_read_platform_snapshot_restore_receipt_v1(text,text,text,text,text) to service_role;
grant execute on function public.faolla_commit_platform_snapshot_restore_receipt_v1(text,text,text,text,text,jsonb,jsonb,jsonb) to service_role;

commit;
