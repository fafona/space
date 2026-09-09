begin;

-- Extend the legacy JSON transaction boundary without moving any old records.
-- All settings/coupon writers must use this RPC; drain old direct writers first.
do $redemption_preflight$
begin
  if exists (select 1 from public.faolla_schema_migrations
              where version = 202609080046 and name <> 'redemption_atomic_mutation') then
    raise exception 'redemption_migration_registry_conflict';
  end if;
  if not exists (select 1 from public.faolla_schema_migrations
                  where version = 202609080045 and name = 'order_membership_atomic_mutation')
     or to_regprocedure('public.faolla_commit_order_membership_v1(text,jsonb)') is null then
    raise exception 'redemption_transaction_dependency_missing';
  end if;
end;
$redemption_preflight$;

-- Preserve every 045 target and its ordering/monotonic behavior. Only these
-- additional exact merchant-owned data/history slugs are added to its scope.
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
         '__merchant_memberships_history_backup__:' || new.merchant_id,
         '__merchant_membership_settings__:' || new.merchant_id,
         '__merchant_membership_settings_history__:' || new.merchant_id,
         '__merchant_membership_settings_history_backup__:' || new.merchant_id,
         '__merchant_coupons__:' || new.merchant_id,
         '__merchant_coupons_history__:' || new.merchant_id,
         '__merchant_coupons_history_backup__:' || new.merchant_id
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

do $redemption_timestamp_preflight$
begin
  if not exists (select 1 from pg_catalog.pg_trigger
                  where tgrelid = 'public.pages'::regclass
                    and tgname = 'zzzz_faolla_order_membership_monotonic'
                    and tgenabled in ('O', 'A') and tgtype::integer = 19
                    and tgfoid = 'public.faolla_order_membership_monotonic_timestamp()'::regprocedure)
     or exists (select 1 from pg_catalog.pg_trigger
                 where tgrelid = 'public.pages'::regclass and not tgisinternal
                   and tgenabled <> 'D' and (tgtype::integer & 19) = 19
                   and tgname > 'zzzz_faolla_order_membership_monotonic') then
    raise exception 'redemption_timestamp_trigger_order_invalid';
  end if;
end;
$redemption_timestamp_preflight$;

-- This is a durable completion receipt, not a saved request/response document.
-- No names, email addresses, cart payloads or authentication tokens are stored.
create table if not exists public.faolla_redemption_operations (
  merchant_id text not null check (merchant_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  operation_id text not null check (operation_id ~ '^[A-Za-z0-9_.:-]{1,120}$'),
  membership_id text not null check (length(btrim(membership_id)) between 1 and 160),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  committed_at timestamptz not null default clock_timestamp(),
  primary key (merchant_id, operation_id)
);
alter table public.faolla_redemption_operations enable row level security;

do $redemption_receipt_schema$
begin
  if (select count(*) from pg_catalog.pg_attribute
       where attrelid = 'public.faolla_redemption_operations'::regclass
         and attnum > 0 and not attisdropped) <> 5
     or exists (select 1 from (values
          ('merchant_id', 'text'::regtype), ('operation_id', 'text'::regtype),
          ('membership_id', 'text'::regtype), ('fingerprint', 'text'::regtype),
          ('committed_at', 'timestamptz'::regtype)
        ) expected(name, type_oid)
        where not exists (select 1 from pg_catalog.pg_attribute actual
          where actual.attrelid = 'public.faolla_redemption_operations'::regclass
            and actual.attname = expected.name and actual.atttypid = expected.type_oid
            and actual.attnotnull and not actual.attisdropped))
     or not exists (select 1 from pg_catalog.pg_constraint c
                     where c.conrelid = 'public.faolla_redemption_operations'::regclass
                       and c.contype = 'p' and c.convalidated
                       and c.conkey = array[
                         (select attnum from pg_catalog.pg_attribute where attrelid = c.conrelid and attname = 'merchant_id'),
                         (select attnum from pg_catalog.pg_attribute where attrelid = c.conrelid and attname = 'operation_id')
                       ]::smallint[]) then
    raise exception 'redemption_receipt_schema_invalid';
  end if;
end;
$redemption_receipt_schema$;

create or replace function public.faolla_get_redemption_operation_v1(
  p_site_id text,
  p_operation_id text,
  p_fingerprint text,
  p_membership_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $redemption_lookup$
declare
  v_receipt public.faolla_redemption_operations%rowtype;
begin
  if p_site_id is null or p_site_id !~ '^[A-Za-z0-9_-]{1,64}$' then
    raise exception 'invalid_site_id';
  end if;
  if p_operation_id is null or p_operation_id !~ '^[A-Za-z0-9_.:-]{1,120}$'
     or p_fingerprint is null or p_fingerprint !~ '^[0-9a-fA-F]{64}$'
     or p_membership_id is null or length(btrim(p_membership_id)) not between 1 and 160
     or p_membership_id <> btrim(p_membership_id) then
    raise exception 'invalid_redemption_mutation';
  end if;
  select * into v_receipt from public.faolla_redemption_operations
   where merchant_id = p_site_id and operation_id = p_operation_id;
  if not found then return jsonb_build_object('committed', false); end if;
  if v_receipt.fingerprint <> lower(p_fingerprint) or v_receipt.membership_id <> p_membership_id then
    raise exception 'redemption_operation_conflict';
  end if;
  return jsonb_build_object('committed', true, 'membershipId', v_receipt.membership_id);
end;
$redemption_lookup$;

create or replace function public.faolla_commit_redemption_v1(
  p_site_id text,
  p_mutation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $redemption_transaction$
declare
  v_domain text;
  v_slug text;
  v_part jsonb;
  v_next jsonb;
  v_before jsonb;
  v_record jsonb;
  v_item jsonb;
  v_field text;
  v_value numeric;
  v_expected_stamp timestamptz;
  v_stamp timestamptz := date_trunc('milliseconds', clock_timestamp());
  v_stamp_text text;
  v_row public.pages%rowtype;
  v_saved public.pages%rowtype;
  v_count integer;
  v_affected integer;
  v_change boolean;
  v_writes jsonb := '[]'::jsonb;
  v_histories jsonb := '[]'::jsonb;
  v_conditions jsonb := '[]'::jsonb;
  v_condition jsonb;
  v_write jsonb;
  v_versions jsonb := '{}'::jsonb;
  v_result_stamp timestamptz;
  v_history jsonb;
  v_history_slug text;
  v_history_limit integer;
  v_entry jsonb;
  v_entries jsonb;
  v_primary_entries jsonb;
  v_pass integer;
  v_has_operation boolean;
  v_operation jsonb;
  v_receipt public.faolla_redemption_operations%rowtype;
  v_saved_receipt public.faolla_redemption_operations%rowtype;
begin
  if p_site_id is null or p_site_id !~ '^[A-Za-z0-9_-]{1,64}$' then
    raise exception 'invalid_site_id';
  end if;
  if p_mutation is null or jsonb_typeof(p_mutation) <> 'object' then
    raise exception 'invalid_redemption_mutation';
  end if;
  if not (p_mutation ? 'settings' or p_mutation ? 'coupons' or p_mutation ? 'operation')
     or exists (select 1 from jsonb_object_keys(p_mutation) k
                 where k not in ('settings', 'coupons', 'memberships', 'operation')) then
    raise exception 'invalid_redemption_mutation';
  end if;
  -- Validate the envelope even when returning an already committed operation.
  foreach v_domain in array array['settings', 'coupons', 'memberships'] loop
    if not (p_mutation ? v_domain) then continue; end if;
    v_part := p_mutation -> v_domain;
    if jsonb_typeof(v_part) is distinct from 'object' then
      raise exception 'invalid_redemption_mutation';
    end if;
    if not (v_part ? 'expectedUpdatedAt')
       or jsonb_typeof(v_part -> 'expectedUpdatedAt') not in ('string', 'null')
       or jsonb_typeof(v_part -> 'next') is distinct from (case when v_domain = 'settings' then 'object' else 'array' end)
       or exists (select 1 from jsonb_object_keys(v_part) k where k not in ('expectedUpdatedAt', 'next')) then
      raise exception 'invalid_redemption_mutation';
    end if;
    begin
      v_expected_stamp := (v_part ->> 'expectedUpdatedAt')::timestamptz;
      if v_expected_stamp is not null and not isfinite(v_expected_stamp) then
        raise exception 'invalid_redemption_mutation';
      end if;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'invalid_redemption_mutation';
    end;
    if v_domain = 'settings' then
      if v_part #>> '{next,siteId}' is distinct from p_site_id then
        raise exception 'invalid_redemption_mutation';
      end if;
    elsif exists (select 1 from jsonb_array_elements(v_part -> 'next') r
                   where jsonb_typeof(r) <> 'object' or r ->> 'siteId' is distinct from p_site_id
                      or jsonb_typeof(r -> 'id') is distinct from 'string' or btrim(r ->> 'id') = '') then
      raise exception 'invalid_redemption_mutation';
    end if;
  end loop;
  v_has_operation := p_mutation ? 'operation';
  if v_has_operation then
    v_operation := p_mutation -> 'operation';
    if jsonb_typeof(v_operation) is distinct from 'object'
       or not (p_mutation ? 'settings' and p_mutation ? 'memberships') then
      raise exception 'invalid_redemption_mutation';
    end if;
    if exists (select 1 from jsonb_object_keys(v_operation) k where k not in ('id', 'fingerprint', 'membershipId'))
       or jsonb_typeof(v_operation -> 'id') is distinct from 'string'
       or (v_operation ->> 'id') !~ '^[A-Za-z0-9_.:-]{1,120}$'
       or jsonb_typeof(v_operation -> 'fingerprint') is distinct from 'string'
       or (v_operation ->> 'fingerprint') !~ '^[0-9a-fA-F]{64}$'
       or jsonb_typeof(v_operation -> 'membershipId') is distinct from 'string'
       or length(btrim(v_operation ->> 'membershipId')) not between 1 and 160
       or v_operation ->> 'membershipId' <> btrim(v_operation ->> 'membershipId')
       or (select count(*) from jsonb_array_elements(p_mutation #> '{memberships,next}') r
            where r ->> 'id' = v_operation ->> 'membershipId') <> 1 then
      raise exception 'invalid_redemption_mutation';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('faolla-order-membership:' || p_site_id, 0));
  if v_has_operation then
    select * into v_receipt from public.faolla_redemption_operations
     where merchant_id = p_site_id and operation_id = v_operation ->> 'id' for update;
    if found then
      if v_receipt.fingerprint <> lower(v_operation ->> 'fingerprint')
         or v_receipt.membership_id <> v_operation ->> 'membershipId' then
        raise exception 'redemption_operation_conflict';
      end if;
      return jsonb_build_object('updatedAt', v_receipt.committed_at, 'replayed', true,
        'versions', '{}'::jsonb, 'membershipId', v_receipt.membership_id);
    end if;
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger
                  where tgrelid = 'public.pages'::regclass
                    and tgname = 'zzzz_faolla_order_membership_monotonic'
                    and tgenabled in ('O', 'A') and tgtype::integer = 19
                    and tgfoid = 'public.faolla_order_membership_monotonic_timestamp()'::regprocedure)
     or exists (select 1 from pg_catalog.pg_trigger
                 where tgrelid = 'public.pages'::regclass and not tgisinternal
                   and tgenabled <> 'D' and (tgtype::integer & 19) = 19
                   and tgname > 'zzzz_faolla_order_membership_monotonic') then
    raise exception 'redemption_timestamp_trigger_order_invalid';
  end if;

  foreach v_domain in array array['settings', 'coupons'] loop
    if not (p_mutation ? v_domain) then continue; end if;
    v_part := p_mutation -> v_domain;
    v_next := v_part -> 'next';
    v_expected_stamp := (v_part ->> 'expectedUpdatedAt')::timestamptz;
    v_slug := case when v_domain = 'settings' then '__merchant_membership_settings__:' else '__merchant_coupons__:' end || p_site_id;
    v_count := 0;
    v_before := 'null'::jsonb;
    v_versions := v_versions || jsonb_build_object(v_domain, null);
    for v_row in select * from public.pages where slug = v_slug order by id for update loop
      v_count := v_count + 1;
      if v_count > 1 or v_row.merchant_id is distinct from p_site_id then
        raise exception 'redemption_store_ambiguous';
      end if;
      if v_row.blocks is null
         or jsonb_typeof(v_row.blocks) is distinct from (case when v_domain = 'settings' then 'object' else 'array' end)
         or v_row.updated_at is null or not isfinite(v_row.updated_at) then
        raise exception 'redemption_store_corrupt';
      end if;
      v_before := v_row.blocks;
      v_stamp := greatest(v_stamp, v_row.updated_at + interval '1 millisecond');
      v_versions := v_versions || jsonb_build_object(v_domain, v_row.updated_at);
    end loop;
    if (v_count = 1 and (v_expected_stamp is null or v_row.updated_at is distinct from v_expected_stamp))
       or (v_count = 0 and v_expected_stamp is not null) then
      if v_domain = 'settings' then raise exception 'merchant_membership_settings_conflict';
      else raise exception 'merchant_coupons_conflict'; end if;
    end if;
    if v_domain = 'settings' then
      if v_count = 1 and (v_before ->> 'siteId' is distinct from p_site_id
          or jsonb_typeof(v_before -> 'redemptionItems') is distinct from 'array'
          or jsonb_typeof(v_before -> 'redemptionStockOperationIds') is distinct from 'array') then
        raise exception 'redemption_store_corrupt';
      end if;
      foreach v_field in array array['redemptionItems', 'redemptionCategories', 'rechargePlans', 'levels', 'redemptionStockOperationIds'] loop
        if jsonb_typeof(v_next -> v_field) is distinct from 'array' then raise exception 'invalid_redemption_mutation'; end if;
      end loop;
      foreach v_field in array array['printSettings', 'growthRules', 'pointsRules'] loop
        if jsonb_typeof(v_next -> v_field) is distinct from 'object' then raise exception 'invalid_redemption_mutation'; end if;
      end loop;
      if exists (select 1 from jsonb_array_elements(v_next -> 'redemptionStockOperationIds') r
                  where jsonb_typeof(r) <> 'string' or length(r #>> '{}') not between 1 and 180)
         or jsonb_array_length(v_next -> 'redemptionStockOperationIds') > 1000 then
        raise exception 'invalid_redemption_mutation';
      end if;
      foreach v_field in array array['redemptionItems', 'redemptionCategories', 'rechargePlans', 'levels'] loop
        if exists (select 1 from jsonb_array_elements(v_next -> v_field) r
                    where jsonb_typeof(r) <> 'object' or jsonb_typeof(r -> 'id') is distinct from 'string'
                       or length(btrim(r ->> 'id')) not between 1 and 120)
           or exists (select 1 from jsonb_array_elements(v_next -> v_field) r group by r ->> 'id' having count(*) > 1) then
          raise exception 'invalid_redemption_mutation';
        end if;
      end loop;
      for v_item in select value from jsonb_array_elements(v_next -> 'redemptionItems') loop
        if jsonb_typeof(v_item -> 'enabled') is distinct from 'boolean' then raise exception 'invalid_redemption_mutation'; end if;
        foreach v_field in array array['stock', 'pointsCost', 'referenceAmount', 'memberPrice', 'taxRate'] loop
          if not (v_item ? v_field) or jsonb_typeof(v_item -> v_field) not in ('number', 'null') then
            raise exception 'invalid_redemption_mutation';
          end if;
          if jsonb_typeof(v_item -> v_field) = 'null' then continue; end if;
          v_value := (v_item ->> v_field)::numeric;
          if v_value < 0 or v_value > (case when v_field in ('stock', 'pointsCost') then 9007199254740991 else 90071992547409.91 end)
             or (v_field in ('stock', 'pointsCost') and trunc(v_value) <> v_value)
             or (v_field in ('referenceAmount', 'memberPrice') and round(v_value, 2) <> v_value)
             or (v_field = 'taxRate' and v_value > 100) then
            raise exception 'invalid_redemption_mutation';
          end if;
        end loop;
      end loop;
      -- Check the old inventory before normalization can hide malformed stock.
      if v_count = 1 then
        for v_item in select value from jsonb_array_elements(v_before -> 'redemptionItems') loop
          if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item -> 'id') is distinct from 'string'
             or not (v_item ? 'stock') or jsonb_typeof(v_item -> 'stock') not in ('number', 'null') then
            raise exception 'redemption_store_corrupt';
          end if;
          if jsonb_typeof(v_item -> 'stock') = 'number'
             and ((v_item ->> 'stock')::numeric not between 0 and 9007199254740991
               or trunc((v_item ->> 'stock')::numeric) <> (v_item ->> 'stock')::numeric) then
            raise exception 'redemption_store_corrupt';
          end if;
        end loop;
        if exists (select 1 from jsonb_array_elements(v_before -> 'redemptionItems') r group by r ->> 'id' having count(*) > 1) then
          raise exception 'redemption_store_ambiguous';
        end if;
      end if;
      v_change := v_count = 0 or (v_before - 'updatedAt') is distinct from (v_next - 'updatedAt');
    else
      if v_count = 1 and exists (select 1 from jsonb_array_elements(v_before) r
          where jsonb_typeof(r) <> 'object' or r ->> 'siteId' is distinct from p_site_id
             or jsonb_typeof(r -> 'id') is distinct from 'string'
             or jsonb_typeof(r -> 'claimEvents') is distinct from 'array'
             or jsonb_typeof(r -> 'redeemEvents') is distinct from 'array') then
        raise exception 'redemption_store_corrupt';
      end if;
      if v_count = 1 and exists (select 1 from jsonb_array_elements(v_before) r group by r ->> 'id' having count(*) > 1) then
        raise exception 'redemption_store_ambiguous';
      end if;
      for v_record in select value from jsonb_array_elements(v_next) loop
        if length(btrim(v_record ->> 'id')) not between 1 and 160
           or jsonb_typeof(v_record -> 'code') is distinct from 'string' or btrim(v_record ->> 'code') = ''
           or coalesce(v_record ->> 'status', '') not in ('active', 'paused', 'archived')
           or coalesce(v_record ->> 'discountType', '') not in (
             'amount_off', 'percent_off', 'threshold_amount_off', 'product_voucher',
             'stored_value', 'exchange_voucher', 'ticket_voucher', 'points_voucher')
           or jsonb_typeof(v_record -> 'claimEvents') is distinct from 'array'
           or jsonb_typeof(v_record -> 'redeemEvents') is distinct from 'array' then
          raise exception 'invalid_redemption_mutation';
        end if;
        foreach v_field in array array['totalQuantity', 'claimedCount', 'usedCount'] loop
          if jsonb_typeof(v_record -> v_field) is distinct from 'number' then raise exception 'invalid_redemption_mutation'; end if;
          v_value := (v_record ->> v_field)::numeric;
          if v_value not between 0 and 9007199254740991 or trunc(v_value) <> v_value then raise exception 'invalid_redemption_mutation'; end if;
        end loop;
        foreach v_field in array array['discountValue', 'minimumAmount', 'productAmount', 'maxDiscountAmount', 'claimMinSpendAmount', 'claimTriggerAmount'] loop
          if not (v_record ? v_field) then continue; end if;
          if jsonb_typeof(v_record -> v_field) is distinct from 'number' then raise exception 'invalid_redemption_mutation'; end if;
          v_value := (v_record ->> v_field)::numeric;
          if v_value not between 0 and 90071992547409.91 or round(v_value, 2) <> v_value then raise exception 'invalid_redemption_mutation'; end if;
        end loop;
        foreach v_field in array array['claimEvents', 'redeemEvents'] loop
          if exists (select 1 from jsonb_array_elements(v_record -> v_field) r
              where jsonb_typeof(r) <> 'object' or jsonb_typeof(r -> 'id') is distinct from 'string'
                 or btrim(r ->> 'id') = '' or jsonb_typeof(r -> 'settlementCode') is distinct from 'string'
                 or btrim(r ->> 'settlementCode') = '')
             or exists (select 1 from jsonb_array_elements(v_record -> v_field) r group by r ->> 'id' having count(*) > 1)
             or exists (select 1 from jsonb_array_elements(v_record -> v_field) r group by r ->> 'settlementCode' having count(*) > 1) then
            raise exception 'invalid_redemption_mutation';
          end if;
        end loop;
      end loop;
      if exists (select 1 from jsonb_array_elements(v_next) r group by r ->> 'id' having count(*) > 1)
         or exists (select 1 from jsonb_array_elements(v_next) r group by upper(r ->> 'code') having count(*) > 1) then
        raise exception 'invalid_redemption_mutation';
      end if;
      v_change := case when v_count = 0 then jsonb_array_length(v_next) > 0 else v_before is distinct from v_next end;
    end if;
    if not v_change then
      v_conditions := v_conditions || jsonb_build_array(case when v_count = 0
        then jsonb_build_object('slug', v_slug, 'absent', true)
        else jsonb_build_object('slug', v_slug, 'id', v_row.id, 'blocks', v_before, 'updated_at', v_row.updated_at) end);
      continue;
    end if;
    v_writes := v_writes || jsonb_build_array(jsonb_build_object('slug', v_slug, 'blocks', v_next, 'domain', v_domain));
    v_histories := v_histories || jsonb_build_array(jsonb_build_object(
      'slug', case when v_domain = 'settings' then '__merchant_membership_settings_history__:' else '__merchant_coupons_history__:' end || p_site_id,
      'backupSlug', case when v_domain = 'settings' then '__merchant_membership_settings_history_backup__:' else '__merchant_coupons_history_backup__:' end || p_site_id,
      'source', case when v_domain = 'settings' then 'membership-settings' else 'merchant-coupons' end,
      'maxEntries', case when v_domain = 'settings' then 240 else 30 end, 'before', v_before, 'after', v_next));
  end loop;

  v_stamp_text := to_char(v_stamp at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
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
        if v_count > 1 or v_row.merchant_id is distinct from p_site_id then raise exception 'redemption_store_ambiguous'; end if;
        if v_row.blocks is null or jsonb_typeof(v_row.blocks) <> 'object'
           or v_row.blocks ->> 'siteId' is distinct from p_site_id
           or jsonb_typeof(v_row.blocks -> 'entries') is distinct from 'array' then raise exception 'redemption_store_corrupt'; end if;
        v_entries := v_row.blocks -> 'entries';
        for v_record in select value from jsonb_array_elements(v_entries) loop
          if jsonb_typeof(v_record) <> 'object' or v_record ->> 'siteId' is distinct from p_site_id
             or jsonb_typeof(v_record -> 'id') is distinct from 'string' or btrim(v_record ->> 'id') = ''
             or jsonb_typeof(v_record -> 'at') is distinct from 'string' then raise exception 'redemption_store_corrupt'; end if;
          begin
            if not isfinite((v_record ->> 'at')::timestamptz) then raise exception 'redemption_store_corrupt'; end if;
          exception when invalid_datetime_format or datetime_field_overflow then raise exception 'redemption_store_corrupt';
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
      v_writes := v_writes || jsonb_build_array(jsonb_build_object('slug', v_history_slug,
        'blocks', jsonb_build_object('siteId', p_site_id, 'updatedAt', v_stamp_text, 'entries', v_entries)));
    end loop;
  end loop;

  if p_mutation ? 'memberships' then
    -- A function call, not a second network transaction: any later failure here
    -- also rolls back all member data/history written by the existing 045 RPC.
    perform public.faolla_commit_order_membership_v1(p_site_id,
      jsonb_build_object('memberships', p_mutation -> 'memberships'));
    v_versions := v_versions || jsonb_build_object('memberships', null);
    foreach v_slug in array array[
      '__merchant_memberships__:' || p_site_id,
      '__merchant_memberships_history__:' || p_site_id,
      '__merchant_memberships_history_backup__:' || p_site_id
    ] loop
      v_count := 0;
      for v_row in select * from public.pages where slug = v_slug order by id for update loop
        v_count := v_count + 1;
        if v_count > 1 or v_row.merchant_id is distinct from p_site_id then raise exception 'redemption_store_ambiguous'; end if;
        if v_slug = '__merchant_memberships__:' || p_site_id then
          if v_row.blocks is distinct from (p_mutation #> '{memberships,next}') then raise exception 'redemption_mutation_not_persisted'; end if;
          v_versions := v_versions || jsonb_build_object('memberships', v_row.updated_at);
        end if;
        v_conditions := v_conditions || jsonb_build_array(jsonb_build_object('slug', v_slug,
          'id', v_row.id, 'blocks', v_row.blocks, 'updated_at', v_row.updated_at));
      end loop;
      if v_count = 0 then v_conditions := v_conditions || jsonb_build_array(jsonb_build_object('slug', v_slug, 'absent', true)); end if;
    end loop;
  end if;

  for v_write in select value from jsonb_array_elements(v_writes) loop
    select * into v_row from public.pages where merchant_id = p_site_id and slug = v_write ->> 'slug' for update;
    if found then
      update public.pages set blocks = v_write -> 'blocks', updated_at = v_stamp
       where id = v_row.id and merchant_id = p_site_id and slug = v_write ->> 'slug'
       returning * into v_saved;
      get diagnostics v_affected = row_count;
      if v_affected <> 1 or v_saved.updated_at is null or not isfinite(v_saved.updated_at)
         or v_saved.updated_at < v_stamp or (v_row.updated_at is not null and v_saved.updated_at <= v_row.updated_at) then
        raise exception 'redemption_mutation_not_persisted';
      end if;
    else
      insert into public.pages(merchant_id, slug, blocks, updated_at)
      values(p_site_id, v_write ->> 'slug', v_write -> 'blocks', v_stamp) returning * into v_saved;
      get diagnostics v_affected = row_count;
      if v_affected <> 1 or v_saved.updated_at is null or not isfinite(v_saved.updated_at) or v_saved.updated_at < v_stamp then
        raise exception 'redemption_mutation_not_persisted';
      end if;
    end if;
    if v_saved.merchant_id is distinct from p_site_id or v_saved.slug is distinct from (v_write ->> 'slug')
       or v_saved.blocks is distinct from (v_write -> 'blocks') then raise exception 'redemption_mutation_not_persisted'; end if;
    v_conditions := v_conditions || jsonb_build_array(jsonb_build_object('slug', v_saved.slug,
      'id', v_saved.id, 'blocks', v_saved.blocks, 'updated_at', v_saved.updated_at));
    if v_write ? 'domain' then
      v_versions := v_versions || jsonb_build_object(v_write ->> 'domain', v_saved.updated_at);
    end if;
  end loop;
  if v_has_operation then
    insert into public.faolla_redemption_operations(merchant_id, operation_id, membership_id, fingerprint)
    values(p_site_id, v_operation ->> 'id', v_operation ->> 'membershipId', lower(v_operation ->> 'fingerprint'))
    returning * into v_saved_receipt;
    get diagnostics v_affected = row_count;
    if v_affected <> 1 or v_saved_receipt.merchant_id is distinct from p_site_id
       or v_saved_receipt.operation_id is distinct from (v_operation ->> 'id')
       or v_saved_receipt.membership_id is distinct from (v_operation ->> 'membershipId')
       or v_saved_receipt.fingerprint is distinct from lower(v_operation ->> 'fingerprint')
       or v_saved_receipt.committed_at is null or not isfinite(v_saved_receipt.committed_at) then
      raise exception 'redemption_mutation_not_persisted';
    end if;
    select * into v_receipt from public.faolla_redemption_operations
     where merchant_id = p_site_id and operation_id = v_operation ->> 'id';
    if not found or v_receipt is distinct from v_saved_receipt then raise exception 'redemption_mutation_not_persisted'; end if;
  end if;
  -- After all domain/history/receipt triggers ran, check the entire post-state,
  -- including read-only domains and every member history row written by 045.
  for v_condition in select value from jsonb_array_elements(v_conditions) loop
    select count(*) into v_count from public.pages where slug = v_condition ->> 'slug';
    if v_condition ->> 'absent' = 'true' then
      if v_count <> 0 then raise exception 'redemption_mutation_not_persisted'; end if;
    elsif v_count <> 1 or not exists (select 1 from public.pages
       where id = (v_condition ->> 'id')::uuid and merchant_id = p_site_id
         and slug = v_condition ->> 'slug' and blocks = v_condition -> 'blocks'
         and updated_at is not distinct from (v_condition ->> 'updated_at')::timestamptz) then
      raise exception 'redemption_mutation_not_persisted';
    end if;
  end loop;
  select max(value::timestamptz) into v_result_stamp from jsonb_each_text(v_versions);
  return jsonb_build_object('updatedAt', coalesce(v_result_stamp, v_stamp), 'replayed', false, 'versions', v_versions)
    || case when v_has_operation then jsonb_build_object('membershipId', v_operation ->> 'membershipId') else '{}'::jsonb end;
end;
$redemption_transaction$;

-- Remove default/drift grants from just the new RPCs and receipt table.
-- Service code can invoke the functions but cannot forge or remove receipts.
do $redemption_acl$
declare
  v_function regprocedure;
  v_grantee record;
begin
  foreach v_function in array array[
    'public.faolla_commit_redemption_v1(text,jsonb)'::regprocedure,
    'public.faolla_get_redemption_operation_v1(text,text,text,text)'::regprocedure
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
  for v_grantee in
    select distinct acl.grantee, role_metadata.rolname
      from pg_catalog.pg_class metadata
      cross join lateral pg_catalog.aclexplode(coalesce(metadata.relacl, pg_catalog.acldefault('r', metadata.relowner))) acl
      left join pg_catalog.pg_roles role_metadata on role_metadata.oid = acl.grantee
     where metadata.oid = 'public.faolla_redemption_operations'::regclass and acl.grantee <> metadata.relowner
  loop
    if v_grantee.grantee = 0 then revoke all on table public.faolla_redemption_operations from public cascade;
    else execute format('revoke all on table public.faolla_redemption_operations from %I cascade', v_grantee.rolname); end if;
  end loop;
  for v_grantee in
    select distinct attribute.attname, acl.grantee, role_metadata.rolname
      from pg_catalog.pg_class metadata
      join pg_catalog.pg_attribute attribute on attribute.attrelid = metadata.oid and attribute.attnum > 0 and not attribute.attisdropped
      cross join lateral pg_catalog.aclexplode(attribute.attacl) acl
      left join pg_catalog.pg_roles role_metadata on role_metadata.oid = acl.grantee
     where metadata.oid = 'public.faolla_redemption_operations'::regclass and acl.grantee <> metadata.relowner
  loop
    if v_grantee.grantee = 0 then execute format('revoke all (%I) on table public.faolla_redemption_operations from public cascade', v_grantee.attname);
    else execute format('revoke all (%I) on table public.faolla_redemption_operations from %I cascade', v_grantee.attname, v_grantee.rolname); end if;
  end loop;
end;
$redemption_acl$;

revoke all on table public.faolla_redemption_operations from public, anon, authenticated, service_role;
revoke all on function public.faolla_commit_redemption_v1(text, jsonb) from public, anon, authenticated;
revoke all on function public.faolla_get_redemption_operation_v1(text, text, text, text) from public, anon, authenticated;
revoke all on function public.faolla_order_membership_monotonic_timestamp() from public, anon, authenticated, service_role;
grant execute on function public.faolla_commit_redemption_v1(text, jsonb) to service_role;
grant execute on function public.faolla_get_redemption_operation_v1(text, text, text, text) to service_role;

insert into public.faolla_schema_migrations(version, name)
values (202609080046, 'redemption_atomic_mutation')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
commit;
