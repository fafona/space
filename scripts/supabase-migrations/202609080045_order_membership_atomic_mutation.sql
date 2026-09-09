begin;

-- Additive legacy-store transaction boundary. No data is migrated or repaired.
-- Drain every old direct pages writer before enabling the new application.
do $transaction_preflight$
begin
  if exists (select 1 from public.faolla_schema_migrations
              where version = 202609080045 and name <> 'order_membership_atomic_mutation') then
    raise exception 'order_membership_migration_registry_conflict';
  end if;
end;
$transaction_preflight$;

-- The baseline set_pages_updated_at trigger overwrites an UPDATE timestamp
-- with now(). Run after it, and only for the exact merchant-owned data/history
-- slugs in this transaction. No global timestamp trigger is changed/disabled.
create or replace function public.faolla_order_membership_monotonic_timestamp()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $monotonic_timestamp$
begin
  if new.merchant_id is not null
     and new.merchant_id ~ '^[A-Za-z0-9_-]{1,64}$'
     and (
       new.slug = '__merchant_orders__:' || new.merchant_id
       or new.slug ~ ('^__merchant_orders__:' || new.merchant_id || ':chunk:[0-9]+$')
       or new.slug = any(array[
         '__merchant_memberships__:' || new.merchant_id,
         '__merchant_orders_history_v2__:' || new.merchant_id,
         '__merchant_orders_history_backup_v2__:' || new.merchant_id,
         '__merchant_memberships_history__:' || new.merchant_id,
         '__merchant_memberships_history_backup__:' || new.merchant_id
       ])
     ) then
    new.updated_at := greatest(
      date_trunc('milliseconds', clock_timestamp()),
      old.updated_at + interval '1 millisecond',
      new.updated_at
    );
  end if;
  return new;
end;
$monotonic_timestamp$;

drop trigger if exists zzzz_faolla_order_membership_monotonic on public.pages;
create trigger zzzz_faolla_order_membership_monotonic
before update on public.pages
for each row execute function public.faolla_order_membership_monotonic_timestamp();

do $timestamp_trigger_preflight$
begin
  if exists (select 1 from pg_catalog.pg_trigger
              where tgrelid = 'public.pages'::regclass and not tgisinternal
                and tgenabled <> 'D' and (tgtype::integer & 19) = 19
                and tgname > 'zzzz_faolla_order_membership_monotonic') then
    raise exception 'order_membership_timestamp_trigger_order_invalid';
  end if;
end;
$timestamp_trigger_preflight$;

create or replace function public.faolla_commit_order_membership_v1(
  p_site_id text,
  p_mutation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $order_membership_transaction$
declare
  v_has_orders boolean;
  v_has_memberships boolean;
  v_write_memberships boolean := false;
  v_orders_slug text;
  v_memberships_slug text;
  v_orders_pattern text;
  v_rows jsonb := '[]'::jsonb;
  v_expected jsonb;
  v_expected_row jsonb;
  v_row public.pages%rowtype;
  v_membership_row public.pages%rowtype;
  v_existing_memberships boolean := false;
  v_count integer;
  v_affected integer;
  v_record jsonb;
  v_before_orders jsonb := '[]'::jsonb;
  v_next_orders jsonb;
  v_before_memberships jsonb := 'null'::jsonb;
  v_next_memberships jsonb;
  v_expected_stamp timestamptz;
  v_stamp timestamptz := date_trunc('milliseconds', clock_timestamp());
  v_stamp_text text;
  v_result_stamp timestamptz;
  v_chunk jsonb;
  v_before_chunk jsonb;
  v_before_chunks jsonb := '[]'::jsonb;
  v_after_chunks jsonb := '[]'::jsonb;
  v_previous_chunk_map jsonb;
  v_next_chunk_map jsonb;
  v_stored_chunk_map jsonb;
  v_index integer;
  v_chunk_count integer;
  v_before_chunk_count integer;
  v_desired_slugs text[] := array[]::text[];
  v_writes jsonb := '[]'::jsonb;
  v_histories jsonb := '[]'::jsonb;
  v_history jsonb;
  v_entry jsonb;
  v_primary_entries jsonb;
  v_entries jsonb;
  v_history_payload jsonb;
  v_history_slug text;
  v_history_limit integer;
  v_pass integer;
  v_write jsonb;
  v_saved public.pages%rowtype;
begin
  if p_site_id is null or p_site_id !~ '^[A-Za-z0-9_-]{1,64}$' then
    raise exception 'invalid_site_id';
  end if;
  if p_mutation is null or jsonb_typeof(p_mutation) <> 'object'
     or not (p_mutation ? 'orders' or p_mutation ? 'memberships')
     or exists (select 1 from jsonb_object_keys(p_mutation) k where k not in ('orders', 'memberships')) then
    raise exception 'invalid_order_membership_mutation';
  end if;
  v_has_orders := p_mutation ? 'orders';
  v_has_memberships := p_mutation ? 'memberships';
  v_orders_slug := '__merchant_orders__:' || p_site_id;
  v_orders_pattern := '^' || v_orders_slug || ':chunk:[0-9]+$';
  v_memberships_slug := '__merchant_memberships__:' || p_site_id;

  -- Hash collisions only serialize unrelated merchants; they cannot expose data.
  perform pg_advisory_xact_lock(hashtextextended('faolla-order-membership:' || p_site_id, 0));
  if not exists (select 1 from pg_catalog.pg_trigger
                  where tgrelid = 'public.pages'::regclass
                    and tgname = 'zzzz_faolla_order_membership_monotonic'
                    and tgenabled in ('O', 'A')
                    and tgfoid = 'public.faolla_order_membership_monotonic_timestamp()'::regprocedure
                    and tgtype::integer = 19)
     or exists (select 1 from pg_catalog.pg_trigger
                 where tgrelid = 'public.pages'::regclass and not tgisinternal
                   and tgenabled <> 'D' and (tgtype::integer & 19) = 19
                   and tgname > 'zzzz_faolla_order_membership_monotonic') then
    raise exception 'order_membership_timestamp_trigger_order_invalid';
  end if;

  if v_has_orders then
    if jsonb_typeof(p_mutation -> 'orders') is distinct from 'object'
       or jsonb_typeof(p_mutation #> '{orders,expectedRows}') is distinct from 'array'
       or jsonb_typeof(p_mutation #> '{orders,next}') is distinct from 'array'
       or exists (select 1 from jsonb_object_keys(p_mutation -> 'orders') k
                   where k not in ('expectedRows', 'next')) then
      raise exception 'invalid_order_membership_mutation';
    end if;
    v_expected := p_mutation #> '{orders,expectedRows}';
    v_next_orders := p_mutation #> '{orders,next}';
    for v_expected_row in select value from jsonb_array_elements(v_expected) loop
      if jsonb_typeof(v_expected_row) is distinct from 'object'
         or jsonb_typeof(v_expected_row -> 'id') is distinct from 'string'
         or (v_expected_row ->> 'id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
         or jsonb_typeof(v_expected_row -> 'slug') is distinct from 'string'
         or not ((v_expected_row ->> 'slug') = v_orders_slug or (v_expected_row ->> 'slug') ~ v_orders_pattern)
         or not (v_expected_row ? 'blocks' and v_expected_row ? 'updated_at')
         or jsonb_typeof(v_expected_row -> 'updated_at') not in ('string', 'null') then
        raise exception 'invalid_order_membership_mutation';
      end if;
    end loop;
    if exists (select 1 from jsonb_array_elements(v_expected) r group by lower(r ->> 'id') having count(*) > 1)
       or exists (select 1 from jsonb_array_elements(v_expected) r group by r ->> 'slug' having count(*) > 1) then
      raise exception 'invalid_order_membership_mutation';
    end if;
    for v_row in select * from public.pages
                   where slug = v_orders_slug or slug ~ v_orders_pattern
                   order by slug, id for update loop
      if v_row.merchant_id is distinct from p_site_id then
        raise exception 'order_membership_store_ambiguous';
      end if;
      if v_row.blocks is null or jsonb_typeof(v_row.blocks) <> 'array'
         or (v_row.updated_at is not null and not isfinite(v_row.updated_at)) then
        raise exception 'order_membership_store_corrupt';
      end if;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'id', v_row.id::text, 'slug', v_row.slug, 'blocks', v_row.blocks, 'updated_at', v_row.updated_at));
      v_stamp := greatest(v_stamp, v_row.updated_at + interval '1 millisecond');
    end loop;
    if exists (select 1 from jsonb_array_elements(v_rows) r group by r ->> 'slug' having count(*) > 1)
       or exists (select 1 from jsonb_array_elements(v_rows) r where (r ->> 'slug') ~ v_orders_pattern
                    group by substring(r ->> 'slug' from ':chunk:([0-9]+)$')::numeric having count(*) > 1) then
      raise exception 'order_membership_store_ambiguous';
    end if;
    if jsonb_array_length(v_rows) <> jsonb_array_length(v_expected) then
      raise exception 'order_update_conflict';
    end if;
    for v_expected_row in select value from jsonb_array_elements(v_expected) loop
      begin
        v_expected_stamp := (v_expected_row ->> 'updated_at')::timestamptz;
        if v_expected_stamp is not null and not isfinite(v_expected_stamp) then
          raise exception 'invalid_order_membership_mutation';
        end if;
      exception when invalid_datetime_format or datetime_field_overflow then
        raise exception 'invalid_order_membership_mutation';
      end;
      if not exists (select 1 from jsonb_array_elements(v_rows) r
                      where (r ->> 'id')::uuid = (v_expected_row ->> 'id')::uuid
                        and r ->> 'slug' = v_expected_row ->> 'slug'
                        and r -> 'blocks' = v_expected_row -> 'blocks'
                        and (r ->> 'updated_at')::timestamptz is not distinct from v_expected_stamp) then
        raise exception 'order_update_conflict';
      end if;
    end loop;
    -- Preserve the current reader's precedence: chunks supersede a legacy base.
    select coalesce(jsonb_agg(item.value order by
        case when r ->> 'slug' = v_orders_slug then -1 else substring(r ->> 'slug' from ':chunk:([0-9]+)$')::numeric end,
        item.ordinality), '[]'::jsonb)
      into v_before_orders
      from jsonb_array_elements(v_rows) r
      cross join lateral jsonb_array_elements(r -> 'blocks') with ordinality item
     where (r ->> 'slug') <> v_orders_slug
        or not exists (select 1 from jsonb_array_elements(v_rows) c where (c ->> 'slug') ~ v_orders_pattern);
    -- Validate existing scope too: never silently discard another tenant's data.
    if exists (select 1 from jsonb_array_elements(v_rows) r,
                 lateral jsonb_array_elements(r -> 'blocks') item
                where jsonb_typeof(item) <> 'object' or item ->> 'siteId' is distinct from p_site_id
                   or jsonb_typeof(item -> 'id') is distinct from 'string' or btrim(item ->> 'id') = '') then
      raise exception 'order_membership_store_corrupt';
    end if;
    if exists (select 1 from jsonb_array_elements(v_before_orders) r group by r ->> 'id' having count(*) > 1) then
      raise exception 'order_membership_store_ambiguous';
    end if;
    for v_record in select value from jsonb_array_elements(v_next_orders) loop
      if jsonb_typeof(v_record) is distinct from 'object'
         or jsonb_typeof(v_record -> 'id') is distinct from 'string'
         or btrim(v_record ->> 'id') = '' or length(v_record ->> 'id') > 160
         or v_record ->> 'siteId' is distinct from p_site_id
         or jsonb_typeof(v_record -> 'items') is distinct from 'array'
         or coalesce(v_record ->> 'status', '') not in ('pending', 'confirmed', 'completed', 'cancelled')
         or jsonb_typeof(v_record -> 'totalAmount') is distinct from 'number'
         or jsonb_typeof(v_record -> 'totalQuantity') is distinct from 'number' then
        raise exception 'invalid_order_membership_mutation';
      end if;
      if (v_record ->> 'totalAmount')::numeric not between 0 and 90071992547409.91
         or round((v_record ->> 'totalAmount')::numeric, 2) <> (v_record ->> 'totalAmount')::numeric
         or (v_record ->> 'totalQuantity')::numeric not between 0 and 99900
         or trunc((v_record ->> 'totalQuantity')::numeric) <> (v_record ->> 'totalQuantity')::numeric
         or jsonb_array_length(v_record -> 'items') > 100 then
        raise exception 'invalid_order_membership_mutation';
      end if;
    end loop;
    if exists (select 1 from jsonb_array_elements(v_next_orders) r group by r ->> 'id' having count(*) > 1) then
      raise exception 'invalid_order_membership_mutation';
    end if;
  end if;

  if v_has_memberships then
    if jsonb_typeof(p_mutation -> 'memberships') is distinct from 'object'
       or not ((p_mutation -> 'memberships') ? 'expectedUpdatedAt')
       or jsonb_typeof(p_mutation #> '{memberships,expectedUpdatedAt}') not in ('string', 'null')
       or jsonb_typeof(p_mutation #> '{memberships,next}') is distinct from 'array'
       or exists (select 1 from jsonb_object_keys(p_mutation -> 'memberships') k
                   where k not in ('expectedUpdatedAt', 'next')) then
      raise exception 'invalid_order_membership_mutation';
    end if;
    v_count := 0;
    for v_row in select * from public.pages where slug = v_memberships_slug order by id for update loop
      v_count := v_count + 1;
      if v_row.merchant_id is distinct from p_site_id or v_count > 1 then
        raise exception 'order_membership_store_ambiguous';
      end if;
      v_membership_row := v_row;
    end loop;
    v_existing_memberships := v_count = 1;
    begin
      v_expected_stamp := (p_mutation #>> '{memberships,expectedUpdatedAt}')::timestamptz;
      if v_expected_stamp is not null and not isfinite(v_expected_stamp) then
        raise exception 'invalid_order_membership_mutation';
      end if;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'invalid_order_membership_mutation';
    end;
    if (v_existing_memberships and (v_expected_stamp is null
          or v_membership_row.updated_at is distinct from v_expected_stamp))
       or (not v_existing_memberships and v_expected_stamp is not null) then
      raise exception 'merchant_memberships_conflict';
    end if;
    if v_existing_memberships then
      if v_membership_row.blocks is null or jsonb_typeof(v_membership_row.blocks) <> 'array'
         or v_membership_row.updated_at is null or not isfinite(v_membership_row.updated_at) then
        raise exception 'order_membership_store_corrupt';
      end if;
      v_before_memberships := v_membership_row.blocks;
      v_stamp := greatest(v_stamp, v_membership_row.updated_at + interval '1 millisecond');
      if exists (select 1 from jsonb_array_elements(v_before_memberships) r
                  where jsonb_typeof(r) <> 'object' or r ->> 'siteId' is distinct from p_site_id
                     or jsonb_typeof(r -> 'id') is distinct from 'string' or btrim(r ->> 'id') = '') then
        raise exception 'order_membership_store_corrupt';
      end if;
      if exists (select 1 from jsonb_array_elements(v_before_memberships) r group by r ->> 'id' having count(*) > 1) then
        raise exception 'order_membership_store_ambiguous';
      end if;
    end if;
    v_next_memberships := p_mutation #> '{memberships,next}';
    for v_record in select value from jsonb_array_elements(v_next_memberships) loop
      if jsonb_typeof(v_record) is distinct from 'object'
         or jsonb_typeof(v_record -> 'id') is distinct from 'string'
         or btrim(v_record ->> 'id') = '' or length(v_record ->> 'id') > 160
         or v_record ->> 'siteId' is distinct from p_site_id
         or coalesce(v_record ->> 'status', '') not in ('active', 'left')
         or jsonb_typeof(v_record -> 'transactions') is distinct from 'array'
         or jsonb_typeof(v_record -> 'pointBalance') is distinct from 'number'
         or jsonb_typeof(v_record -> 'balanceAmount') is distinct from 'number'
         or jsonb_typeof(v_record -> 'growthValue') is distinct from 'number' then
        raise exception 'invalid_order_membership_mutation';
      end if;
      if (v_record ->> 'pointBalance')::numeric not between 0 and 9007199254740991
         or trunc((v_record ->> 'pointBalance')::numeric) <> (v_record ->> 'pointBalance')::numeric
         or (v_record ->> 'balanceAmount')::numeric not between 0 and 90071992547409.91
         or round((v_record ->> 'balanceAmount')::numeric, 2) <> (v_record ->> 'balanceAmount')::numeric
         or (v_record ->> 'growthValue')::numeric not between 0 and 90071992547409.91
         or round((v_record ->> 'growthValue')::numeric, 2) <> (v_record ->> 'growthValue')::numeric then
        raise exception 'invalid_order_membership_mutation';
      end if;
      if exists (select 1 from jsonb_array_elements(v_record -> 'transactions') t
                  where jsonb_typeof(t) <> 'object' or jsonb_typeof(t -> 'id') is distinct from 'string'
                     or btrim(t ->> 'id') = '')
         or exists (select 1 from jsonb_array_elements(v_record -> 'transactions') t group by t ->> 'id' having count(*) > 1) then
        raise exception 'invalid_order_membership_mutation';
      end if;
    end loop;
    if exists (select 1 from jsonb_array_elements(v_next_memberships) r group by r ->> 'id' having count(*) > 1) then
      raise exception 'invalid_order_membership_mutation';
    end if;
    v_write_memberships := case when v_existing_memberships
      then v_next_memberships is distinct from v_before_memberships
      else jsonb_array_length(v_next_memberships) > 0 end;
  end if;

  v_stamp_text := to_char(v_stamp at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  if v_has_orders then
    v_chunk_count := (jsonb_array_length(v_next_orders) + 99) / 100;
    v_before_chunk_count := (jsonb_array_length(v_before_orders) + 99) / 100;
    select coalesce(jsonb_object_agg(chunk_index::text, items), '{}'::jsonb) into v_next_chunk_map
      from (select (ordinality - 1) / 100 as chunk_index, jsonb_agg(value order by ordinality) as items
              from jsonb_array_elements(v_next_orders) with ordinality
             group by (ordinality - 1) / 100) chunks;
    select coalesce(jsonb_object_agg(chunk_index::text, items), '{}'::jsonb) into v_previous_chunk_map
      from (select (ordinality - 1) / 100 as chunk_index, jsonb_agg(value order by ordinality) as items
              from jsonb_array_elements(v_before_orders) with ordinality
             group by (ordinality - 1) / 100) chunks;
    select coalesce(jsonb_object_agg(r ->> 'slug', r -> 'blocks'), '{}'::jsonb) into v_stored_chunk_map
      from jsonb_array_elements(v_rows) r;
    for v_index in 0..greatest(v_chunk_count, v_before_chunk_count) - 1 loop
      v_chunk := coalesce(v_next_chunk_map -> v_index::text, '[]'::jsonb);
      v_before_chunk := coalesce(v_previous_chunk_map -> v_index::text, '[]'::jsonb);
      if v_chunk is distinct from v_before_chunk then
        v_before_chunks := v_before_chunks || jsonb_build_array(jsonb_build_object('index', v_index, 'orders', v_before_chunk));
        v_after_chunks := v_after_chunks || jsonb_build_array(jsonb_build_object('index', v_index, 'orders', v_chunk));
      end if;
      if v_index < v_chunk_count then
        v_desired_slugs := array_append(v_desired_slugs, v_orders_slug || ':chunk:' || v_index);
        if (v_stored_chunk_map -> (v_orders_slug || ':chunk:' || v_index)) is distinct from v_chunk then
          v_writes := v_writes || jsonb_build_array(jsonb_build_object('slug', v_orders_slug || ':chunk:' || v_index, 'blocks', v_chunk));
        end if;
      end if;
    end loop;
    if jsonb_array_length(v_after_chunks) > 0 then
      v_histories := v_histories || jsonb_build_array(jsonb_build_object(
        'slug', '__merchant_orders_history_v2__:' || p_site_id,
        'backupSlug', '__merchant_orders_history_backup_v2__:' || p_site_id,
        'source', 'merchant-orders-chunks-v2', 'maxEntries', 20,
        'before', jsonb_build_object('format', 'merchant-order-chunks-v2', 'siteId', p_site_id,
          'totalOrders', jsonb_array_length(v_before_orders), 'chunks', v_before_chunks),
        'after', jsonb_build_object('format', 'merchant-order-chunks-v2', 'siteId', p_site_id,
          'totalOrders', jsonb_array_length(v_next_orders), 'chunks', v_after_chunks)));
    end if;
  end if;
  if v_write_memberships then
    v_writes := v_writes || jsonb_build_array(jsonb_build_object('slug', v_memberships_slug, 'blocks', v_next_memberships));
    v_histories := v_histories || jsonb_build_array(jsonb_build_object(
      'slug', '__merchant_memberships_history__:' || p_site_id,
      'backupSlug', '__merchant_memberships_history_backup__:' || p_site_id,
      'source', 'merchant-memberships', 'maxEntries', 240,
      'before', v_before_memberships, 'after', v_next_memberships));
  end if;

  -- Primary history and its backup are part of this same transaction. A failed
  -- main write or backup write leaves neither balances nor phantom audit rows.
  for v_history in select value from jsonb_array_elements(v_histories) loop
    v_history_limit := (v_history ->> 'maxEntries')::integer;
    v_entry := jsonb_build_object('id', p_site_id || ':' || v_stamp_text || ':' ||
      (v_history ->> 'source') || ':' || gen_random_uuid()::text,
      'siteId', p_site_id, 'at', v_stamp_text, 'source', v_history ->> 'source',
      'before', v_history -> 'before', 'after', v_history -> 'after');
    v_primary_entries := jsonb_build_array(v_entry);
    for v_pass in 0..1 loop
      v_history_slug := case when v_pass = 0 then v_history ->> 'slug' else v_history ->> 'backupSlug' end;
      v_count := 0;
      v_entries := '[]'::jsonb;
      for v_row in select * from public.pages where slug = v_history_slug order by id for update loop
        v_count := v_count + 1;
        if v_row.merchant_id is distinct from p_site_id or v_count > 1 then
          raise exception 'order_membership_store_ambiguous';
        end if;
        if v_row.blocks is null or jsonb_typeof(v_row.blocks) <> 'object'
           or v_row.blocks ->> 'siteId' is distinct from p_site_id
           or jsonb_typeof(v_row.blocks -> 'entries') is distinct from 'array' then
          raise exception 'order_membership_store_corrupt';
        end if;
        v_entries := v_row.blocks -> 'entries';
        for v_record in select value from jsonb_array_elements(v_entries) loop
          if jsonb_typeof(v_record) <> 'object' or v_record ->> 'siteId' is distinct from p_site_id
             or jsonb_typeof(v_record -> 'id') is distinct from 'string' or btrim(v_record ->> 'id') = ''
             or jsonb_typeof(v_record -> 'at') is distinct from 'string' then
            raise exception 'order_membership_store_corrupt';
          end if;
          begin
            if not isfinite((v_record ->> 'at')::timestamptz) then
              raise exception 'order_membership_store_corrupt';
            end if;
          exception when invalid_datetime_format or datetime_field_overflow then
            raise exception 'order_membership_store_corrupt';
          end;
        end loop;
      end loop;
      select coalesce(jsonb_agg(entry order by (entry ->> 'at')::timestamptz desc, entry ->> 'id' desc), '[]'::jsonb)
        into v_entries from (
          select entry from (
            select distinct on (value ->> 'id') value as entry
              from jsonb_array_elements(v_primary_entries || v_entries) with ordinality
             order by value ->> 'id', ordinality
          ) deduped order by (entry ->> 'at')::timestamptz desc, entry ->> 'id' desc limit v_history_limit
        ) limited;
      if v_pass = 0 then v_primary_entries := v_entries; end if;
      v_history_payload := jsonb_build_object('siteId', p_site_id, 'updatedAt', v_stamp_text, 'entries', v_entries);
      v_writes := v_writes || jsonb_build_array(jsonb_build_object('slug', v_history_slug, 'blocks', v_history_payload));
    end loop;
  end loop;

  for v_write in select value from jsonb_array_elements(v_writes) loop
    select * into v_row from public.pages where merchant_id = p_site_id and slug = v_write ->> 'slug' for update;
    if found then
      update public.pages set blocks = v_write -> 'blocks', updated_at = v_stamp
       where id = v_row.id and merchant_id = p_site_id and slug = v_write ->> 'slug'
       returning * into v_saved;
      get diagnostics v_affected = row_count;
      if v_affected <> 1 or v_saved.updated_at is null or not isfinite(v_saved.updated_at)
         or v_saved.updated_at < v_stamp or (v_row.updated_at is not null and v_saved.updated_at <= v_row.updated_at) then
        raise exception 'order_membership_mutation_not_persisted';
      end if;
    else
      insert into public.pages(merchant_id, slug, blocks, updated_at)
      values(p_site_id, v_write ->> 'slug', v_write -> 'blocks', v_stamp) returning * into v_saved;
      get diagnostics v_affected = row_count;
      if v_affected <> 1 or v_saved.updated_at is null or not isfinite(v_saved.updated_at) or v_saved.updated_at < v_stamp then
        raise exception 'order_membership_mutation_not_persisted';
      end if;
    end if;
    -- RETURNING is not enough if an AFTER trigger rewrites/deletes the row.
    select * into v_row from public.pages where id = v_saved.id;
    if not found or v_row.merchant_id is distinct from p_site_id
       or v_row.slug is distinct from (v_write ->> 'slug')
       or v_row.blocks is distinct from (v_write -> 'blocks')
       or v_row.updated_at is distinct from v_saved.updated_at then
      raise exception 'order_membership_mutation_not_persisted';
    end if;
    if (v_write_memberships and v_row.slug = v_memberships_slug) or not v_write_memberships then
      v_result_stamp := greatest(v_result_stamp, v_row.updated_at);
    end if;
  end loop;
  if v_has_orders then
    for v_expected_row in select value from jsonb_array_elements(v_rows)
                           where not ((value ->> 'slug') = any(v_desired_slugs)) loop
      delete from public.pages where id = (v_expected_row ->> 'id')::uuid
        and merchant_id = p_site_id and slug = v_expected_row ->> 'slug';
      get diagnostics v_affected = row_count;
      if v_affected <> 1 or exists (select 1 from public.pages where id = (v_expected_row ->> 'id')::uuid) then
        raise exception 'order_membership_mutation_not_persisted';
      end if;
    end loop;
  end if;
  -- Also catch a later write's trigger altering an earlier write in this plan.
  for v_write in select value from jsonb_array_elements(v_writes) loop
    select count(*) into v_count from public.pages
     where slug = v_write ->> 'slug';
    if v_count <> 1 or not exists (select 1 from public.pages
       where merchant_id = p_site_id and slug = v_write ->> 'slug'
         and blocks = v_write -> 'blocks' and updated_at >= v_stamp) then
      raise exception 'order_membership_mutation_not_persisted';
    end if;
  end loop;
  if v_has_orders and (select count(*) from public.pages
       where slug = v_orders_slug or slug ~ v_orders_pattern) <> cardinality(v_desired_slugs) then
    raise exception 'order_membership_mutation_not_persisted';
  end if;
  if v_has_orders and exists (select 1 from public.pages
       where (slug = v_orders_slug or slug ~ v_orders_pattern)
         and (merchant_id is distinct from p_site_id or not (slug = any(v_desired_slugs))
           or blocks is distinct from (v_next_chunk_map -> substring(slug from ':chunk:([0-9]+)$')))) then
    raise exception 'order_membership_mutation_not_persisted';
  end if;
  return jsonb_build_object('updatedAt', coalesce(v_result_stamp,
    case when v_has_memberships and v_existing_memberships then v_membership_row.updated_at end, v_stamp));
end;
$order_membership_transaction$;

-- Normalize only the two new function ACLs, including unexpected inherited
-- default grants. Existing platform defaults/readiness allowlists stay intact.
do $transaction_rpc_acl$
declare
  v_function regprocedure;
  v_grantee record;
begin
  foreach v_function in array array[
    'public.faolla_commit_order_membership_v1(text,jsonb)'::regprocedure,
    'public.faolla_order_membership_monotonic_timestamp()'::regprocedure
  ] loop
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
  end loop;
end;
$transaction_rpc_acl$;

revoke all on function public.faolla_commit_order_membership_v1(text, jsonb) from public, anon, authenticated;
revoke all on function public.faolla_order_membership_monotonic_timestamp() from public, anon, authenticated, service_role;
grant execute on function public.faolla_commit_order_membership_v1(text, jsonb) to service_role;

insert into public.faolla_schema_migrations(version, name)
values (202609080045, 'order_membership_atomic_mutation')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
commit;
