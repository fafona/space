-- OFFLINE CANDIDATE ONLY. Not an automatic migration and not wired into any route.
-- The old direct pages writers MUST be switched/drained before a production cutover.
-- This primitive preserves caller-prepared JSON exactly; it does not implement
-- directory/history merging, support V1 mirroring, business validation or restore receipts.
begin;

do $platform_snapshot_preflight$
declare
  v_slugs text[] := array[
    '__platform_admin_data_backup__', '__platform_admin_data_backup_backup__',
    '__platform_merchant_config_archive__', '__platform_merchant_config_archive_backup__',
    '__platform_merchant_snapshot__', '__platform_merchant_snapshot_backup__',
    '__platform_merchant_snapshot_history__', '__platform_merchant_snapshot_history_backup__',
    '__platform_support_inbox__', '__platform_support_inbox_history__', '__platform_support_inbox_history_backup__'
  ];
begin
  -- The index installation is serialized with concurrent DML, without repairing
  -- ambiguous old records or borrowing a merchant-owned internal-looking row.
  lock table public.pages in share row exclusive mode;
  if exists (select 1 from public.pages where slug = any(v_slugs) and merchant_id is not null)
     or exists (select 1 from public.pages where merchant_id is null and slug = any(v_slugs)
                 group by slug having count(*) > 1) then
    raise exception 'platform_snapshot_atomic_install_conflict';
  end if;
exception when others then
  raise exception using errcode = 'P0001', message = 'platform_snapshot_atomic_install_conflict';
end;
$platform_snapshot_preflight$;

create unique index if not exists pages_platform_snapshot_atomic_unique_idx
  on public.pages(slug) where merchant_id is null and slug = any(array[
    '__platform_admin_data_backup__', '__platform_admin_data_backup_backup__',
    '__platform_merchant_config_archive__', '__platform_merchant_config_archive_backup__',
    '__platform_merchant_snapshot__', '__platform_merchant_snapshot_backup__',
    '__platform_merchant_snapshot_history__', '__platform_merchant_snapshot_history_backup__',
    '__platform_support_inbox__', '__platform_support_inbox_history__', '__platform_support_inbox_history_backup__'
  ]::text[]);

do $platform_snapshot_index_postcondition$
declare
  v_slugs text[] := array[
    '__platform_admin_data_backup__', '__platform_admin_data_backup_backup__',
    '__platform_merchant_config_archive__', '__platform_merchant_config_archive_backup__',
    '__platform_merchant_snapshot__', '__platform_merchant_snapshot_backup__',
    '__platform_merchant_snapshot_history__', '__platform_merchant_snapshot_history_backup__',
    '__platform_support_inbox__', '__platform_support_inbox_history__', '__platform_support_inbox_history_backup__'
  ];
  v_expected_predicate text;
begin
  select '((merchant_id IS NULL) AND (slug = ANY (ARRAY[' || string_agg(quote_literal(slug) || '::text', ', ' order by ord) || '])))'
    into v_expected_predicate from unnest(v_slugs) with ordinality as items(slug, ord);
  if not exists (
    select 1 from pg_catalog.pg_index as metadata
     where metadata.indexrelid = to_regclass('public.pages_platform_snapshot_atomic_unique_idx')
       and metadata.indrelid = 'public.pages'::regclass
       and metadata.indisunique and metadata.indisvalid and metadata.indisready
       and metadata.indnkeyatts = 1 and metadata.indnatts = 1 and metadata.indexprs is null
       and pg_catalog.pg_get_indexdef(metadata.indexrelid, 1, true) = 'slug'
       and pg_catalog.pg_get_expr(metadata.indpred, metadata.indrelid) = v_expected_predicate
  ) then raise exception 'platform_snapshot_atomic_install_conflict'; end if;
exception when others then
  raise exception using errcode = 'P0001', message = 'platform_snapshot_atomic_install_conflict';
end;
$platform_snapshot_index_postcondition$;

create or replace function public.faolla_read_platform_snapshot_rows_v1(p_scope text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set timezone = 'UTC'
as $platform_snapshot_read$
declare
  v_slugs text[];
  v_observed jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_slug text;
  v_entry jsonb;
  v_count integer;
  v_error text;
begin
  case p_scope
    when 'user_manage' then v_slugs := array[
      '__platform_merchant_config_archive__', '__platform_merchant_config_archive_backup__',
      '__platform_merchant_snapshot__', '__platform_merchant_snapshot_backup__',
      '__platform_merchant_snapshot_history__', '__platform_merchant_snapshot_history_backup__'];
    when 'support_messages' then v_slugs := array[
      '__platform_support_inbox__', '__platform_support_inbox_history__', '__platform_support_inbox_history_backup__'];
    when 'backup_catalog' then v_slugs := array['__platform_admin_data_backup__', '__platform_admin_data_backup_backup__'];
    else raise exception 'platform_snapshot_atomic_invalid_request';
  end case;

  -- One lock domain because user_manage includes the shared configuration archive.
  -- Existing legacy direct writers do not participate in this advisory lock.
  perform pg_advisory_xact_lock(hashtextextended('faolla-platform-snapshot-atomic-v1', 0));
  -- The complete observation uses ONE SQL statement, coordinated by the shared
  -- advisory lock for participating callers. Under READ COMMITTED, waiting on
  -- a legacy row writer can expose its newer row version: this is NOT a claim
  -- of atomic reads against old writers which bypass the shared protocol.
  with selected as materialized (
    select id, slug, merchant_id, blocks, updated_at from public.pages
     where slug = any(v_slugs) order by slug collate "C", id for update
  )
  select coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'owner', merchant_id,
      'row', jsonb_build_object('id', id::text, 'blocks', blocks, 'updatedAt', to_jsonb(updated_at)))
      order by slug collate "C", id), '[]'::jsonb)
    into v_observed from selected;

  foreach v_slug in array v_slugs loop
    select count(*) into v_count from jsonb_array_elements(v_observed) as entries(value) where value ->> 'slug' = v_slug;
    if v_count > 1 then raise exception 'platform_snapshot_atomic_store_corrupt'; end if;
    select value into v_entry from jsonb_array_elements(v_observed) as entries(value) where value ->> 'slug' = v_slug;
    if v_count = 1 then
      if v_entry -> 'owner' is distinct from 'null'::jsonb
         or jsonb_typeof(v_entry -> 'row' -> 'blocks') is distinct from
           (case when v_slug in ('__platform_support_inbox_history__', '__platform_support_inbox_history_backup__') then 'object' else 'array' end) then
        raise exception 'platform_snapshot_atomic_store_corrupt';
      end if;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('slug', v_slug, 'row', v_entry -> 'row'));
    else
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('slug', v_slug, 'row', null));
    end if;
  end loop;
  return jsonb_build_object('version', 1, 'scope', p_scope, 'rows', v_rows);
exception when others then
  get stacked diagnostics v_error = message_text;
  if v_error not in ('platform_snapshot_atomic_invalid_request', 'platform_snapshot_atomic_store_corrupt') then
    v_error := 'platform_snapshot_atomic_store_corrupt';
  end if;
  raise exception using errcode = 'P0001', message = v_error;
end;
$platform_snapshot_read$;

create or replace function public.faolla_commit_platform_snapshot_rows_v1(
  p_scope text, p_expected jsonb, p_writes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set timezone = 'UTC'
as $platform_snapshot_commit$
declare
  v_slugs text[];
  v_index integer;
  v_slug text;
  v_expected_entry jsonb;
  v_expected_row jsonb;
  v_write jsonb;
  v_actual jsonb;
  v_actual_row jsonb;
  v_after jsonb;
  v_actual_timestamp timestamptz;
  v_expected_timestamp timestamptz;
  v_affected integer;
  v_saved public.pages%rowtype;
  v_saved_ids jsonb := '{}'::jsonb;
  v_saved_versions jsonb := '{}'::jsonb;
  v_error text;
  v_write_started boolean := false;
begin
  case p_scope
    when 'user_manage' then v_slugs := array[
      '__platform_merchant_config_archive__', '__platform_merchant_config_archive_backup__',
      '__platform_merchant_snapshot__', '__platform_merchant_snapshot_backup__',
      '__platform_merchant_snapshot_history__', '__platform_merchant_snapshot_history_backup__'];
    when 'support_messages' then v_slugs := array[
      '__platform_support_inbox__', '__platform_support_inbox_history__', '__platform_support_inbox_history_backup__'];
    when 'backup_catalog' then v_slugs := array['__platform_admin_data_backup__', '__platform_admin_data_backup_backup__'];
    else raise exception 'platform_snapshot_atomic_invalid_request';
  end case;
  if p_expected is null or p_writes is null or jsonb_typeof(p_expected) is distinct from 'array'
     or jsonb_typeof(p_writes) is distinct from 'array'
     or jsonb_array_length(p_expected) <> cardinality(v_slugs)
     or jsonb_array_length(p_writes) <> cardinality(v_slugs)
     or octet_length(p_expected::text)::bigint + octet_length(p_writes::text)::bigint > 67108864 then
    raise exception 'platform_snapshot_atomic_invalid_request';
  end if;

  -- Validate the complete, fixed-order physical read/write sets BEFORE any DML.
  for v_index in 0 .. cardinality(v_slugs) - 1 loop
    v_slug := v_slugs[v_index + 1];
    v_expected_entry := p_expected -> v_index;
    v_expected_row := v_expected_entry -> 'row';
    v_write := p_writes -> v_index;
    if jsonb_typeof(v_expected_entry) is distinct from 'object'
       or not (v_expected_entry ?& array['slug', 'row'])
       or v_expected_entry - array['slug', 'row'] <> '{}'::jsonb
       or v_expected_entry ->> 'slug' is distinct from v_slug
       or jsonb_typeof(v_write) is distinct from 'object'
       or not (v_write ?& array['slug', 'blocks'])
       or v_write - array['slug', 'blocks'] <> '{}'::jsonb
       or v_write ->> 'slug' is distinct from v_slug
       or jsonb_typeof(v_write -> 'blocks') is distinct from
         (case when v_slug in ('__platform_support_inbox_history__', '__platform_support_inbox_history_backup__') then 'object' else 'array' end) then
      raise exception 'platform_snapshot_atomic_invalid_request';
    end if;
    if v_expected_row is distinct from 'null'::jsonb then
      if jsonb_typeof(v_expected_row) is distinct from 'object'
         or not (v_expected_row ?& array['id', 'blocks', 'updatedAt'])
         or v_expected_row - array['id', 'blocks', 'updatedAt'] <> '{}'::jsonb
         or jsonb_typeof(v_expected_row -> 'id') is distinct from 'string'
         or coalesce(v_expected_row ->> 'id', '') = ''
         or v_expected_row ->> 'id' <> btrim(v_expected_row ->> 'id')
         or jsonb_typeof(v_expected_row -> 'blocks') is distinct from
           (case when v_slug in ('__platform_support_inbox_history__', '__platform_support_inbox_history_backup__') then 'object' else 'array' end)
         or (v_expected_row -> 'updatedAt' is distinct from 'null'::jsonb
           and (jsonb_typeof(v_expected_row -> 'updatedAt') is distinct from 'string'
             or (v_expected_row ->> 'updatedAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}')) then
        raise exception 'platform_snapshot_atomic_invalid_request';
      end if;
      -- Validate timestamp conversion before taking locks/writing; comparisons
      -- below use timestamptz semantics rather than arbitrary JSON formatting.
      v_expected_timestamp := (v_expected_row ->> 'updatedAt')::timestamptz;
      if v_expected_timestamp is not null and not isfinite(v_expected_timestamp) then
        raise exception 'platform_snapshot_atomic_invalid_request';
      end if;
    end if;
  end loop;

  v_actual := public.faolla_read_platform_snapshot_rows_v1(p_scope);
  for v_index in 0 .. cardinality(v_slugs) - 1 loop
    v_expected_row := p_expected -> v_index -> 'row';
    v_actual_row := v_actual -> 'rows' -> v_index -> 'row';
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

  for v_index in 0 .. cardinality(v_slugs) - 1 loop
    v_slug := v_slugs[v_index + 1];
    v_actual_row := v_actual -> 'rows' -> v_index -> 'row';
    v_write := p_writes -> v_index -> 'blocks';
    if v_actual_row <> 'null'::jsonb and v_actual_row -> 'blocks' = v_write then
      v_saved_ids := v_saved_ids || jsonb_build_object(v_slug, v_actual_row ->> 'id');
      v_saved_versions := v_saved_versions || jsonb_build_object(v_slug, v_actual_row -> 'updatedAt');
      continue;
    end if;
    v_write_started := true;
    if v_actual_row = 'null'::jsonb then
      insert into public.pages(merchant_id, slug, blocks) values (null, v_slug, v_write) returning * into v_saved;
    else
      update public.pages set blocks = v_write
       where id::text = v_actual_row ->> 'id' and merchant_id is null and slug = v_slug
       returning * into v_saved;
    end if;
    get diagnostics v_affected = row_count;
    if v_affected <> 1 or v_saved.id is null or v_saved.merchant_id is not null
       or (v_actual_row <> 'null'::jsonb and v_saved.id::text is distinct from v_actual_row ->> 'id')
       or v_saved.slug is distinct from v_slug or v_saved.blocks is distinct from v_write then
      raise exception 'platform_snapshot_atomic_write_unconfirmed';
    end if;
    v_saved_ids := v_saved_ids || jsonb_build_object(v_slug, v_saved.id::text);
    v_saved_versions := v_saved_versions || jsonb_build_object(v_slug, to_jsonb(v_saved.updated_at));
  end loop;

  -- Recheck the ENTIRE physical read/write set after the final row/trigger.
  -- A later trigger changing an earlier row cannot produce a false success.
  v_after := public.faolla_read_platform_snapshot_rows_v1(p_scope);
  for v_index in 0 .. cardinality(v_slugs) - 1 loop
    v_slug := v_slugs[v_index + 1];
    v_actual_row := v_after -> 'rows' -> v_index -> 'row';
    if v_actual_row = 'null'::jsonb
       or v_actual_row ->> 'id' is distinct from v_saved_ids ->> v_slug
       or (v_actual_row ->> 'updatedAt')::timestamptz is distinct from (v_saved_versions ->> v_slug)::timestamptz
       or v_actual_row -> 'blocks' is distinct from p_writes -> v_index -> 'blocks' then
      raise exception 'platform_snapshot_atomic_write_unconfirmed';
    end if;
  end loop;
  return v_after;
exception when others then
  get stacked diagnostics v_error = message_text;
  if v_write_started then
    v_error := 'platform_snapshot_atomic_write_unconfirmed';
  elsif v_error not in ('platform_snapshot_atomic_invalid_request', 'platform_snapshot_atomic_conflict', 'platform_snapshot_atomic_store_corrupt') then
    v_error := 'platform_snapshot_atomic_invalid_request';
  end if;
  -- PL/pgSQL exception unwinding rolls back all row/trigger mutations in this call.
  -- Do not return SQLERRM, DETAIL, payloads, compensating writes, or partial success.
  raise exception using errcode = 'P0001', message = v_error;
end;
$platform_snapshot_commit$;

-- Normalize ACL drift on these TWO functions only; do not widen any existing
-- enterprise cutover allowlist or the existing pages table grants/policies.
do $platform_snapshot_function_acl$
declare
  v_function regprocedure;
  v_grantee record;
begin
  foreach v_function in array array[
    'public.faolla_read_platform_snapshot_rows_v1(text)'::regprocedure,
    'public.faolla_commit_platform_snapshot_rows_v1(text,jsonb,jsonb)'::regprocedure
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
$platform_snapshot_function_acl$;
revoke all on function public.faolla_read_platform_snapshot_rows_v1(text) from public, anon, authenticated;
revoke all on function public.faolla_commit_platform_snapshot_rows_v1(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.faolla_read_platform_snapshot_rows_v1(text) to service_role;
grant execute on function public.faolla_commit_platform_snapshot_rows_v1(text, jsonb, jsonb) to service_role;

commit;
