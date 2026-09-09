begin;

-- Durable cashier confirmation context and an immutable authoritative result.
-- Apply only after 046 and drain all older checkout writers before rollout.
-- Do not expire, delete or silently acknowledge pending/terminal contexts.
do $preflight$
begin
  if exists (select 1 from public.faolla_schema_migrations where version = 202609080047
             and name <> 'redemption_checkout_context') then
    raise exception 'redemption_checkout_migration_registry_conflict';
  end if;
  if not exists (select 1 from public.faolla_schema_migrations where version = 202609080046
                  and name = 'redemption_atomic_mutation')
     or to_regprocedure('public.faolla_commit_redemption_v1(text,jsonb)') is null then
    raise exception 'redemption_checkout_dependency_missing';
  end if;
  if to_regprocedure('public.faolla_commit_redemption_internal_v1(text,jsonb)') is null then
    alter function public.faolla_commit_redemption_v1(text,jsonb)
      rename to faolla_commit_redemption_internal_v1;
  elsif not exists (select 1 from public.faolla_schema_migrations where version = 202609080047
                    and name = 'redemption_checkout_context') then
    raise exception 'redemption_checkout_internal_function_conflict';
  end if;
end;
$preflight$;

create table if not exists public.faolla_redemption_checkouts (
  merchant_id text not null check (merchant_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  operator_id text not null check (operator_id = btrim(operator_id) and length(operator_id) between 1 and 120),
  operation_id text not null check (operation_id ~ '^[A-Za-z0-9_.:-]{1,120}$'),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  membership_id text not null check (membership_id = btrim(membership_id) and length(membership_id) between 1 and 160),
  request jsonb not null check (jsonb_typeof(request) = 'object' and octet_length(request::text) <= 262144),
  status text not null check (status in ('pending', 'committed', 'cancelled')),
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  acknowledged_at timestamptz,
  primary key (merchant_id, operation_id),
  check ((status = 'committed' and result is not null and jsonb_typeof(result) = 'object')
         or (status <> 'committed' and result is null)),
  check (acknowledged_at is null or status in ('committed', 'cancelled')),
  check (isfinite(created_at) and isfinite(updated_at) and updated_at >= created_at),
  check (acknowledged_at is null or (isfinite(acknowledged_at) and acknowledged_at >= created_at))
);
alter table public.faolla_redemption_checkouts enable row level security;
create unique index if not exists faolla_redemption_checkouts_unacknowledged_idx
  on public.faolla_redemption_checkouts(merchant_id, operator_id)
  where acknowledged_at is null;

do $schema$
begin
  if (select count(*) from pg_catalog.pg_attribute where attrelid = 'public.faolla_redemption_checkouts'::regclass
       and attnum > 0 and not attisdropped) <> 11
     or exists (select 1 from (values
        ('merchant_id', 'text'::regtype, true), ('operator_id', 'text'::regtype, true),
        ('operation_id', 'text'::regtype, true), ('fingerprint', 'text'::regtype, true),
        ('membership_id', 'text'::regtype, true), ('request', 'jsonb'::regtype, true),
        ('status', 'text'::regtype, true), ('result', 'jsonb'::regtype, false),
        ('created_at', 'timestamptz'::regtype, true), ('updated_at', 'timestamptz'::regtype, true),
        ('acknowledged_at', 'timestamptz'::regtype, false)
       ) expected(name, type_oid, required)
       where not exists (select 1 from pg_catalog.pg_attribute a
         where a.attrelid = 'public.faolla_redemption_checkouts'::regclass and a.attname = expected.name
           and a.atttypid = expected.type_oid and a.attnotnull = expected.required and not a.attisdropped))
     or not exists (select 1 from pg_catalog.pg_index i
       where i.indrelid = 'public.faolla_redemption_checkouts'::regclass and i.indisprimary and i.indisvalid
         and pg_get_indexdef(i.indexrelid) like '%(merchant_id, operation_id)')
     or not exists (select 1 from pg_catalog.pg_index i
       where i.indexrelid = 'public.faolla_redemption_checkouts_unacknowledged_idx'::regclass
         and i.indrelid = 'public.faolla_redemption_checkouts'::regclass and i.indisunique and i.indisvalid
         and pg_get_indexdef(i.indexrelid) like '%(merchant_id, operator_id) WHERE (acknowledged_at IS NULL)') then
    raise exception 'redemption_checkout_schema_invalid';
  end if;
end;
$schema$;

-- Internal validators/formatters have no API EXECUTE grant (including service).
create or replace function public.faolla_redemption_checkout_identity_internal(
  p_site_id text, p_operator_id text, p_operation_id text default null
) returns void language plpgsql set search_path = pg_catalog, public as $identity$
begin
  if p_site_id is null or p_site_id !~ '^[A-Za-z0-9_-]{1,64}$' then raise exception 'invalid_site_id'; end if;
  if p_operator_id is null or p_operator_id <> btrim(p_operator_id) or length(p_operator_id) not between 1 and 120
     or (p_operation_id is not null and p_operation_id !~ '^[A-Za-z0-9_.:-]{1,120}$') then
    raise exception 'invalid_redemption_checkout';
  end if;
end;
$identity$;

create or replace function public.faolla_redemption_checkout_json_internal(p_row public.faolla_redemption_checkouts)
returns jsonb language sql stable set search_path = pg_catalog, public as $context$
  select jsonb_build_object('operationId', p_row.operation_id, 'fingerprint', p_row.fingerprint,
    'membershipId', p_row.membership_id, 'request', p_row.request, 'status', p_row.status,
    'result', p_row.result, 'createdAt', p_row.created_at, 'acknowledgedAt', p_row.acknowledged_at);
$context$;

create or replace function public.faolla_redemption_checkout_quote_internal(p_quote jsonb)
returns void language plpgsql set search_path = pg_catalog, public as $quote$
declare
  v_key text; v_line jsonb; v_gross numeric := 0; v_discount numeric := 0; v_quantity numeric := 0;
begin
  if jsonb_typeof(p_quote) is distinct from 'object'
     or not (p_quote ?& array['grossPoints','couponPointDiscountTotal','totalPoints','totalQuantity','couponCount','lines'])
     or exists (select 1 from jsonb_object_keys(p_quote) k where k <> all(array[
       'grossPoints','couponPointDiscountTotal','totalPoints','totalQuantity','couponCount','lines']))
     or jsonb_typeof(p_quote -> 'lines') is distinct from 'array' then raise exception 'invalid_redemption_checkout'; end if;
  if jsonb_array_length(p_quote -> 'lines') not between 1 and 100 then raise exception 'invalid_redemption_checkout'; end if;
  foreach v_key in array array['grossPoints','couponPointDiscountTotal','totalPoints','totalQuantity','couponCount'] loop
    if jsonb_typeof(p_quote -> v_key) is distinct from 'number' then raise exception 'invalid_redemption_checkout'; end if;
    if (p_quote ->> v_key)::numeric < 0 or (p_quote ->> v_key)::numeric > 9007199254740991
       or trunc((p_quote ->> v_key)::numeric) <> (p_quote ->> v_key)::numeric then raise exception 'invalid_redemption_checkout'; end if;
  end loop;
  for v_line in select value from jsonb_array_elements(p_quote -> 'lines') loop
    if jsonb_typeof(v_line) is distinct from 'object'
       or not (v_line ?& array['code','name','categoryName','quantity','unitPoints','subtotalPoints','couponDiscountLabel','couponPointDiscount'])
       or exists (select 1 from jsonb_object_keys(v_line) k where k <> all(array[
         'code','name','categoryName','quantity','unitPoints','subtotalPoints','couponDiscountLabel','couponPointDiscount'])) then
      raise exception 'invalid_redemption_checkout';
    end if;
    foreach v_key in array array['code','name','categoryName','couponDiscountLabel'] loop
      if jsonb_typeof(v_line -> v_key) is distinct from 'string' or length(v_line ->> v_key) > 200 then
        raise exception 'invalid_redemption_checkout';
      end if;
    end loop;
    if btrim(v_line ->> 'name') = '' then raise exception 'invalid_redemption_checkout'; end if;
    foreach v_key in array array['quantity','unitPoints','subtotalPoints','couponPointDiscount'] loop
      if jsonb_typeof(v_line -> v_key) is distinct from 'number' then raise exception 'invalid_redemption_checkout'; end if;
      if (v_line ->> v_key)::numeric < 0 or (v_line ->> v_key)::numeric > 9007199254740991
         or trunc((v_line ->> v_key)::numeric) <> (v_line ->> v_key)::numeric then raise exception 'invalid_redemption_checkout'; end if;
    end loop;
    if (v_line ->> 'quantity')::numeric not between 1 and 9999
       or (v_line ->> 'subtotalPoints')::numeric <> (v_line ->> 'quantity')::numeric * (v_line ->> 'unitPoints')::numeric then
      raise exception 'invalid_redemption_checkout';
    end if;
    -- Voucher rows may have zero subtotal: their discount applies to other rows.
    v_gross := v_gross + (v_line ->> 'subtotalPoints')::numeric;
    v_discount := v_discount + (v_line ->> 'couponPointDiscount')::numeric;
    v_quantity := v_quantity + (v_line ->> 'quantity')::numeric;
  end loop;
  if v_gross <> (p_quote ->> 'grossPoints')::numeric or v_discount <> (p_quote ->> 'couponPointDiscountTotal')::numeric
     or v_discount > v_gross or v_quantity <> (p_quote ->> 'totalQuantity')::numeric
     or (p_quote ->> 'totalPoints')::numeric <> v_gross - v_discount
     or (p_quote ->> 'couponCount')::numeric > v_quantity then raise exception 'invalid_redemption_checkout'; end if;
end;
$quote$;

create or replace function public.faolla_redemption_checkout_request_internal(p_operation jsonb, p_request jsonb)
returns void language plpgsql set search_path = pg_catalog, public as $request$
declare v_key text; v_item jsonb; v_stamp timestamptz;
begin
  if jsonb_typeof(p_operation) is distinct from 'object'
     or not (p_operation ?& array['id','fingerprint','membershipId'])
     or exists (select 1 from jsonb_object_keys(p_operation) k where k <> all(array['id','fingerprint','membershipId']))
     or jsonb_typeof(p_operation -> 'id') is distinct from 'string' or (p_operation ->> 'id') !~ '^[A-Za-z0-9_.:-]{1,120}$'
     or jsonb_typeof(p_operation -> 'fingerprint') is distinct from 'string' or (p_operation ->> 'fingerprint') !~ '^[0-9a-fA-F]{64}$'
     or jsonb_typeof(p_operation -> 'membershipId') is distinct from 'string'
     or (p_operation ->> 'membershipId') <> btrim(p_operation ->> 'membershipId')
     or length(p_operation ->> 'membershipId') not between 1 and 160 then raise exception 'invalid_redemption_checkout'; end if;
  if jsonb_typeof(p_request) is distinct from 'object' or octet_length(p_request::text) > 262144
     or not (p_request ?& array['membershipId','items','note','settingsVersion','couponVersion','quote'])
     or exists (select 1 from jsonb_object_keys(p_request) k where k <> all(array[
       'membershipId','items','note','settingsVersion','couponVersion','quote']))
     or p_request -> 'membershipId' is distinct from p_operation -> 'membershipId'
     or jsonb_typeof(p_request -> 'items') is distinct from 'array'
     or jsonb_typeof(p_request -> 'note') is distinct from 'string' or length(p_request ->> 'note') > 1000 then
    raise exception 'invalid_redemption_checkout';
  end if;
  if jsonb_array_length(p_request -> 'items') not between 1 and 100 then raise exception 'invalid_redemption_checkout'; end if;
  foreach v_key in array array['settingsVersion','couponVersion'] loop
    if jsonb_typeof(p_request -> v_key) not in ('null','string') then raise exception 'invalid_redemption_checkout'; end if;
    if jsonb_typeof(p_request -> v_key) = 'string' then
      begin
        v_stamp := (p_request ->> v_key)::timestamptz;
        if v_stamp is null or not isfinite(v_stamp) then raise exception 'invalid_redemption_checkout'; end if;
      exception when invalid_datetime_format or datetime_field_overflow then raise exception 'invalid_redemption_checkout'; end;
    end if;
  end loop;
  for v_item in select value from jsonb_array_elements(p_request -> 'items') loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or exists (select 1 from jsonb_object_keys(v_item) k where k <> all(array[
         'redemptionItemId','quantity','customName','customCode','customPoints','couponId','couponClaimId',
         'couponSettlementCode','couponTitle','couponDiscountLabel']))
       or jsonb_typeof(v_item -> 'quantity') is distinct from 'number' then raise exception 'invalid_redemption_checkout'; end if;
    if (v_item ->> 'quantity')::numeric not between 1 and 9999
       or trunc((v_item ->> 'quantity')::numeric) <> (v_item ->> 'quantity')::numeric then raise exception 'invalid_redemption_checkout'; end if;
    foreach v_key in array array['redemptionItemId','customName','customCode','couponId','couponClaimId',
      'couponSettlementCode','couponTitle','couponDiscountLabel'] loop
      if v_item ? v_key and (jsonb_typeof(v_item -> v_key) is distinct from 'string' or length(v_item ->> v_key) > 200) then
        raise exception 'invalid_redemption_checkout';
      end if;
    end loop;
    if v_item ? 'customPoints' then
      if jsonb_typeof(v_item -> 'customPoints') is distinct from 'number' then raise exception 'invalid_redemption_checkout'; end if;
      if (v_item ->> 'customPoints')::numeric not between 0 and 9007199254740991
         or trunc((v_item ->> 'customPoints')::numeric) <> (v_item ->> 'customPoints')::numeric then raise exception 'invalid_redemption_checkout'; end if;
    end if;
    if coalesce(btrim(v_item ->> 'redemptionItemId'), '') = '' and
       (coalesce(btrim(v_item ->> 'customName'), '') = '' or
        (coalesce((v_item ->> 'customPoints')::numeric, 0) <= 0 and coalesce(btrim(v_item ->> 'couponSettlementCode'), '') = '')) then
      raise exception 'invalid_redemption_checkout';
    end if;
  end loop;
  perform public.faolla_redemption_checkout_quote_internal(p_request -> 'quote');
end;
$request$;

-- Retain the old public name for all ordinary settings/coupon saves only.
-- An old checkout cannot bypass pending/cancelled state through the 046 API.
create or replace function public.faolla_commit_redemption_v1(p_site_id text, p_mutation jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $ordinary$
begin
  if jsonb_typeof(p_mutation) is distinct from 'object'
     or not (p_mutation ?| array['settings','coupons'])
     or exists (select 1 from jsonb_object_keys(p_mutation) k where k <> all(array['settings','coupons'])) then
    raise exception 'redemption_checkout_context_required';
  end if;
  return public.faolla_commit_redemption_internal_v1(p_site_id, p_mutation);
end;
$ordinary$;

create or replace function public.faolla_stage_redemption_checkout_v1(
  p_site_id text, p_operator_id text, p_operation jsonb, p_request jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $stage$
declare
  v_row public.faolla_redemption_checkouts%rowtype; v_saved public.faolla_redemption_checkouts%rowtype;
  v_affected integer; v_stamp timestamptz := clock_timestamp();
begin
  perform public.faolla_redemption_checkout_identity_internal(p_site_id,p_operator_id,p_operation ->> 'id');
  perform public.faolla_redemption_checkout_request_internal(p_operation,p_request);
  perform pg_advisory_xact_lock(hashtextextended('faolla-order-membership:' || p_site_id,0));
  select * into v_row from public.faolla_redemption_checkouts where merchant_id = p_site_id
    and operation_id = p_operation ->> 'id' for update;
  if found then
    if v_row.operator_id is distinct from p_operator_id or v_row.membership_id is distinct from p_operation ->> 'membershipId'
       or v_row.fingerprint is distinct from lower(p_operation ->> 'fingerprint')
       or (v_row.request - array['settingsVersion','couponVersion','quote']) is distinct from
          (p_request - array['settingsVersion','couponVersion','quote']) then raise exception 'redemption_operation_conflict'; end if;
    if v_row.request is distinct from p_request then raise exception 'redemption_checkout_quote_changed'; end if;
    return jsonb_build_object('checkout',public.faolla_redemption_checkout_json_internal(v_row));
  end if;
  if exists (select 1 from public.faolla_redemption_operations where merchant_id = p_site_id and operation_id = p_operation ->> 'id') then
    raise exception 'redemption_legacy_operation_requires_review';
  end if;
  if exists (select 1 from public.faolla_redemption_checkouts where merchant_id = p_site_id and operator_id = p_operator_id
              and acknowledged_at is null) then raise exception 'redemption_pending_checkout_exists'; end if;
  insert into public.faolla_redemption_checkouts(merchant_id,operator_id,operation_id,fingerprint,membership_id,
    request,status,result,created_at,updated_at,acknowledged_at)
  values(p_site_id,p_operator_id,p_operation ->> 'id',lower(p_operation ->> 'fingerprint'),p_operation ->> 'membershipId',
    p_request,'pending',null,v_stamp,v_stamp,null) returning * into v_saved;
  get diagnostics v_affected = row_count;
  if v_affected <> 1 or v_saved.merchant_id is distinct from p_site_id or v_saved.operator_id is distinct from p_operator_id
     or v_saved.operation_id is distinct from p_operation ->> 'id' or v_saved.fingerprint is distinct from lower(p_operation ->> 'fingerprint')
     or v_saved.membership_id is distinct from p_operation ->> 'membershipId' or v_saved.request is distinct from p_request
     or v_saved.status is distinct from 'pending' or v_saved.result is not null or v_saved.acknowledged_at is not null
     or v_saved.created_at is distinct from v_stamp or v_saved.updated_at is distinct from v_stamp then
    raise exception 'redemption_checkout_mutation_not_persisted';
  end if;
  select * into v_row from public.faolla_redemption_checkouts where merchant_id = p_site_id and operation_id = p_operation ->> 'id';
  if not found or v_row is distinct from v_saved then raise exception 'redemption_checkout_mutation_not_persisted'; end if;
  if exists (select 1 from public.faolla_redemption_operations where merchant_id = p_site_id and operation_id = p_operation ->> 'id') then
    raise exception 'redemption_checkout_mutation_not_persisted';
  end if;
  return jsonb_build_object('checkout',public.faolla_redemption_checkout_json_internal(v_row));
end;
$stage$;

create or replace function public.faolla_get_redemption_checkout_v1(
  p_site_id text, p_operator_id text, p_operation_id text default null
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $get$
declare v_row public.faolla_redemption_checkouts%rowtype;
begin
  perform public.faolla_redemption_checkout_identity_internal(p_site_id,p_operator_id,p_operation_id);
  perform pg_advisory_xact_lock(hashtextextended('faolla-order-membership:' || p_site_id,0));
  select * into v_row from public.faolla_redemption_checkouts where merchant_id = p_site_id and operator_id = p_operator_id
    and ((p_operation_id is null and acknowledged_at is null) or operation_id = p_operation_id);
  if not found then return jsonb_build_object('checkout',null); end if;
  return jsonb_build_object('checkout',public.faolla_redemption_checkout_json_internal(v_row));
end;
$get$;

create or replace function public.faolla_redemption_checkout_terminal_internal(
  p_site_id text, p_operator_id text, p_operation_id text, p_ack boolean
) returns jsonb language plpgsql set search_path = pg_catalog, public as $terminal$
declare
  v_row public.faolla_redemption_checkouts%rowtype; v_expected public.faolla_redemption_checkouts%rowtype;
  v_saved public.faolla_redemption_checkouts%rowtype; v_affected integer;
begin
  perform public.faolla_redemption_checkout_identity_internal(p_site_id,p_operator_id,p_operation_id);
  if p_operation_id is null then raise exception 'invalid_redemption_checkout'; end if;
  perform pg_advisory_xact_lock(hashtextextended('faolla-order-membership:' || p_site_id,0));
  select * into v_row from public.faolla_redemption_checkouts where merchant_id = p_site_id
    and operation_id = p_operation_id for update;
  if not found then raise exception 'redemption_checkout_not_found'; end if;
  if v_row.operator_id is distinct from p_operator_id then raise exception 'redemption_operation_conflict'; end if;
  if p_ack and v_row.status = 'pending' then raise exception 'redemption_checkout_not_terminal'; end if;
  if (p_ack and v_row.acknowledged_at is not null) or (not p_ack and v_row.status <> 'pending') then
    return jsonb_build_object('checkout',public.faolla_redemption_checkout_json_internal(v_row));
  end if;
  if not p_ack and exists (select 1 from public.faolla_redemption_operations where merchant_id = p_site_id and operation_id = p_operation_id) then
    raise exception 'redemption_legacy_operation_requires_review';
  end if;
  v_expected := v_row;
  v_expected.updated_at := greatest(clock_timestamp(),v_row.updated_at + interval '1 millisecond');
  if p_ack then v_expected.acknowledged_at := v_expected.updated_at; else v_expected.status := 'cancelled'; end if;
  update public.faolla_redemption_checkouts set status = v_expected.status,
    acknowledged_at = v_expected.acknowledged_at, updated_at = v_expected.updated_at
    where merchant_id = p_site_id and operation_id = p_operation_id returning * into v_saved;
  get diagnostics v_affected = row_count;
  if v_affected <> 1 or v_saved is distinct from v_expected then raise exception 'redemption_checkout_mutation_not_persisted'; end if;
  select * into v_saved from public.faolla_redemption_checkouts where merchant_id = p_site_id and operation_id = p_operation_id;
  if not found or v_saved is distinct from v_expected then raise exception 'redemption_checkout_mutation_not_persisted'; end if;
  return jsonb_build_object('checkout',public.faolla_redemption_checkout_json_internal(v_saved));
end;
$terminal$;

create or replace function public.faolla_cancel_redemption_checkout_v1(p_site_id text,p_operator_id text,p_operation_id text)
returns jsonb language sql security definer set search_path = pg_catalog, public as $cancel$
  select public.faolla_redemption_checkout_terminal_internal(p_site_id,p_operator_id,p_operation_id,false);
$cancel$;
create or replace function public.faolla_ack_redemption_checkout_v1(p_site_id text,p_operator_id text,p_operation_id text)
returns jsonb language sql security definer set search_path = pg_catalog, public as $ack$
  select public.faolla_redemption_checkout_terminal_internal(p_site_id,p_operator_id,p_operation_id,true);
$ack$;

create or replace function public.faolla_commit_redemption_v2(
  p_site_id text,p_operator_id text,p_mutation jsonb,p_result jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $commit_checkout$
declare
  v_row public.faolla_redemption_checkouts%rowtype; v_expected public.faolla_redemption_checkouts%rowtype;
  v_saved public.faolla_redemption_checkouts%rowtype; v_receipt public.faolla_redemption_operations%rowtype;
  v_operation jsonb; v_quote jsonb; v_key text; v_domain text; v_pin text; v_stamp timestamptz;
  v_member_page public.pages%rowtype; v_coupon_page public.pages%rowtype;
  v_old jsonb; v_next jsonb; v_tx jsonb; v_old_tx jsonb; v_coupon jsonb; v_old_coupon jsonb; v_event jsonb;
  v_new_events jsonb; v_retained_events jsonb; v_actual_retained_events jsonb; v_old_events_by_id jsonb;
  v_coupon_count integer := 0; v_coupon_changes integer; v_item_coupon_count integer;
  v_point_delta numeric := 0; v_redeem_count integer := 0; v_count integer; v_affected integer;
  v_saved_domains jsonb; v_actual_domains jsonb; v_commit jsonb; v_slugs text[];
begin
  perform public.faolla_redemption_checkout_identity_internal(p_site_id,p_operator_id,p_mutation #>> '{operation,id}');
  if jsonb_typeof(p_mutation) is distinct from 'object'
     or not (p_mutation ?& array['operation','settings','memberships'])
     or exists (select 1 from jsonb_object_keys(p_mutation) k where k <> all(array['operation','settings','memberships','coupons']))
     or jsonb_typeof(p_mutation -> 'operation') is distinct from 'object' then raise exception 'invalid_redemption_checkout'; end if;
  v_operation := p_mutation -> 'operation';
  if not (v_operation ?& array['id','fingerprint','membershipId'])
     or exists (select 1 from jsonb_object_keys(v_operation) k where k <> all(array['id','fingerprint','membershipId']))
     or jsonb_typeof(v_operation -> 'id') is distinct from 'string' or (v_operation ->> 'id') !~ '^[A-Za-z0-9_.:-]{1,120}$'
     or jsonb_typeof(v_operation -> 'fingerprint') is distinct from 'string' or (v_operation ->> 'fingerprint') !~ '^[0-9a-fA-F]{64}$'
     or jsonb_typeof(v_operation -> 'membershipId') is distinct from 'string'
     or length(v_operation ->> 'membershipId') not between 1 and 160 then raise exception 'invalid_redemption_checkout'; end if;
  perform pg_advisory_xact_lock(hashtextextended('faolla-order-membership:' || p_site_id,0));
  select * into v_row from public.faolla_redemption_checkouts where merchant_id = p_site_id
    and operation_id = v_operation ->> 'id' for update;
  if not found then
    if exists (select 1 from public.faolla_redemption_operations where merchant_id = p_site_id and operation_id = v_operation ->> 'id') then
      raise exception 'redemption_legacy_operation_requires_review';
    end if;
    raise exception 'redemption_checkout_context_required';
  end if;
  if v_row.operator_id is distinct from p_operator_id or v_row.membership_id is distinct from v_operation ->> 'membershipId'
     or v_row.fingerprint is distinct from lower(v_operation ->> 'fingerprint') then raise exception 'redemption_operation_conflict'; end if;
  if v_row.status = 'cancelled' then raise exception 'redemption_checkout_cancelled'; end if;
  if v_row.status = 'committed' then
    if v_row.result is null or not exists (select 1 from public.faolla_redemption_operations
       where merchant_id = p_site_id and operation_id = v_row.operation_id and membership_id = v_row.membership_id
         and fingerprint = v_row.fingerprint) then raise exception 'redemption_checkout_store_corrupt'; end if;
    return jsonb_build_object('replayed',true,'result',v_row.result,'versions','{}'::jsonb,'updatedAt',v_row.updated_at);
  end if;
  if v_row.status <> 'pending' or v_row.result is not null or v_row.acknowledged_at is not null then raise exception 'redemption_checkout_store_corrupt'; end if;
  if exists (select 1 from public.faolla_redemption_operations where merchant_id = p_site_id and operation_id = v_row.operation_id) then
    raise exception 'redemption_legacy_operation_requires_review';
  end if;
  perform public.faolla_redemption_checkout_request_internal(v_operation,v_row.request);
  if jsonb_typeof(p_result) is distinct from 'object' or octet_length(p_result::text) > 262144
     or not (p_result ?& array['version','operationId','siteId','membershipId','createdAt','transactionId','beforePointBalance',
       'afterPointBalance','totalQuantity','grossPoints','couponPointDiscountTotal','totalPoints','couponCount','note','lines'])
     or exists (select 1 from jsonb_object_keys(p_result) k where k <> all(array[
       'version','operationId','siteId','membershipId','createdAt','transactionId','beforePointBalance','afterPointBalance',
       'totalQuantity','grossPoints','couponPointDiscountTotal','totalPoints','couponCount','note','lines']))
     or p_result -> 'version' is distinct from '1'::jsonb
     or p_result -> 'operationId' is distinct from to_jsonb(v_row.operation_id) or p_result -> 'siteId' is distinct from to_jsonb(p_site_id)
     or p_result -> 'membershipId' is distinct from to_jsonb(v_row.membership_id) or p_result -> 'note' is distinct from v_row.request -> 'note'
     or jsonb_typeof(p_result -> 'transactionId') is distinct from 'string' or length(btrim(p_result ->> 'transactionId')) not between 1 and 160
     or jsonb_typeof(p_result -> 'createdAt') is distinct from 'string'
     or (p_result ->> 'createdAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
    raise exception 'invalid_redemption_checkout';
  end if;
  begin
    v_stamp := (p_result ->> 'createdAt')::timestamptz;
    if not isfinite(v_stamp) then raise exception 'invalid_redemption_checkout'; end if;
  exception when invalid_datetime_format or datetime_field_overflow then raise exception 'invalid_redemption_checkout'; end;
  foreach v_key in array array['beforePointBalance','afterPointBalance'] loop
    if jsonb_typeof(p_result -> v_key) is distinct from 'number' then raise exception 'invalid_redemption_checkout'; end if;
    if (p_result ->> v_key)::numeric not between 0 and 9007199254740991
       or trunc((p_result ->> v_key)::numeric) <> (p_result ->> v_key)::numeric then raise exception 'invalid_redemption_checkout'; end if;
  end loop;
  v_quote := p_result - array['version','operationId','siteId','membershipId','createdAt','transactionId','beforePointBalance','afterPointBalance','note'];
  perform public.faolla_redemption_checkout_quote_internal(v_quote);
  if v_quote is distinct from v_row.request -> 'quote' then raise exception 'redemption_checkout_quote_changed'; end if;
  foreach v_domain in array array['settings','coupons'] loop
    v_pin := case when v_domain = 'settings' then 'settingsVersion' else 'couponVersion' end;
    if p_mutation ? v_domain then
      if jsonb_typeof(p_mutation -> v_domain) is distinct from 'object'
         or not (p_mutation -> v_domain ?& array['expectedUpdatedAt','next'])
         or jsonb_typeof(p_mutation #> array[v_domain,'expectedUpdatedAt']) not in ('null','string') then
        raise exception 'invalid_redemption_checkout';
      end if;
      begin
        if (p_mutation #>> array[v_domain,'expectedUpdatedAt'])::timestamptz is distinct from (v_row.request ->> v_pin)::timestamptz then
          raise exception 'redemption_checkout_quote_changed';
        end if;
      exception when invalid_datetime_format or datetime_field_overflow then raise exception 'invalid_redemption_checkout'; end;
    elsif v_row.request -> v_pin is distinct from 'null'::jsonb then raise exception 'redemption_checkout_quote_changed'; end if;
  end loop;

  -- Bind the receipt to the actual debit. Level-up gifts may be added in the
  -- same checkout, therefore validate the net new transaction delta as well.
  if jsonb_typeof(p_mutation #> '{memberships,next}') is distinct from 'array' then raise exception 'invalid_redemption_checkout'; end if;
  if not (p_mutation -> 'memberships' ? 'expectedUpdatedAt')
     or jsonb_typeof(p_mutation #> '{memberships,expectedUpdatedAt}') is distinct from 'string' then
    raise exception 'merchant_memberships_conflict';
  end if;
  select count(*) into v_count from public.pages where slug = '__merchant_memberships__:' || p_site_id;
  if v_count <> 1 then raise exception 'merchant_memberships_conflict'; end if;
  select * into v_member_page from public.pages where slug = '__merchant_memberships__:' || p_site_id for update;
  if v_member_page.merchant_id is distinct from p_site_id or jsonb_typeof(v_member_page.blocks) is distinct from 'array' then
    raise exception 'redemption_checkout_store_corrupt';
  end if;
  begin
    if v_member_page.updated_at is distinct from (p_mutation #>> '{memberships,expectedUpdatedAt}')::timestamptz then
      raise exception 'merchant_memberships_conflict';
    end if;
  exception when invalid_datetime_format or datetime_field_overflow then raise exception 'invalid_redemption_checkout'; end;
  if jsonb_array_length(v_member_page.blocks) <> jsonb_array_length(p_mutation #> '{memberships,next}') then raise exception 'invalid_redemption_checkout'; end if;
  select count(*) into v_count from jsonb_array_elements(v_member_page.blocks) m where m ->> 'id' = v_row.membership_id;
  if v_count <> 1 then raise exception 'merchant_memberships_conflict'; end if;
  select value into v_old from jsonb_array_elements(v_member_page.blocks) where value ->> 'id' = v_row.membership_id;
  select count(*) into v_count from jsonb_array_elements(p_mutation #> '{memberships,next}') m where m ->> 'id' = v_row.membership_id;
  if v_count <> 1 then raise exception 'invalid_redemption_checkout'; end if;
  select value into v_next from jsonb_array_elements(p_mutation #> '{memberships,next}') where value ->> 'id' = v_row.membership_id;
  if v_old ->> 'siteId' is distinct from p_site_id or v_next ->> 'siteId' is distinct from p_site_id
     or v_old ->> 'status' is distinct from 'active' or v_next ->> 'status' is distinct from 'active'
     or v_old -> 'pointBalance' is distinct from p_result -> 'beforePointBalance'
     or v_next -> 'pointBalance' is distinct from p_result -> 'afterPointBalance'
     or v_old -> 'balanceAmount' is distinct from v_next -> 'balanceAmount'
     or (p_result ->> 'beforePointBalance')::numeric < (p_result ->> 'totalPoints')::numeric
     or jsonb_typeof(v_old -> 'transactions') is distinct from 'array'
     or jsonb_typeof(v_next -> 'transactions') is distinct from 'array' then raise exception 'invalid_redemption_checkout'; end if;
  if exists (select 1 from jsonb_array_elements(v_member_page.blocks) old_member
    where old_member ->> 'id' <> v_row.membership_id and not exists (
      select 1 from jsonb_array_elements(p_mutation #> '{memberships,next}') next_member where next_member = old_member)) then
    raise exception 'invalid_redemption_checkout';
  end if;
  for v_old_tx in select value from jsonb_array_elements(v_old -> 'transactions') loop
    if not exists (select 1 from jsonb_array_elements(v_next -> 'transactions') next_tx where next_tx = v_old_tx) then
      raise exception 'invalid_redemption_checkout';
    end if;
  end loop;
  for v_tx in select value from jsonb_array_elements(v_next -> 'transactions') loop
    if exists (select 1 from jsonb_array_elements(v_old -> 'transactions') old_tx where old_tx ->> 'id' = v_tx ->> 'id') then continue; end if;
    if jsonb_typeof(v_tx -> 'pointDelta') is distinct from 'number' then raise exception 'invalid_redemption_checkout'; end if;
    if (v_tx ->> 'pointDelta')::numeric not between -9007199254740991 and 9007199254740991
       or trunc((v_tx ->> 'pointDelta')::numeric) <> (v_tx ->> 'pointDelta')::numeric
       or v_tx -> 'balanceDelta' is distinct from '0'::jsonb
       or (v_tx ->> 'id' is distinct from p_result ->> 'transactionId' and (v_tx ->> 'pointDelta')::numeric < 0) then
      raise exception 'invalid_redemption_checkout';
    end if;
    v_point_delta := v_point_delta + (v_tx ->> 'pointDelta')::numeric;
    if v_tx ->> 'id' = p_result ->> 'transactionId' then
      v_redeem_count := v_redeem_count + 1;
      if v_tx ->> 'type' is distinct from 'redeem' or v_tx ->> 'status' is distinct from 'completed'
         or v_tx ->> 'operatorId' is distinct from p_operator_id
         or (v_tx ->> 'pointDelta')::numeric <> -(p_result ->> 'totalPoints')::numeric
         or (v_tx ->> 'at')::timestamptz is distinct from v_stamp
         or position('[op:member-redemption-checkout:' || v_row.operation_id || ']' in coalesce(v_tx ->> 'note','')) = 0 then
        raise exception 'invalid_redemption_checkout';
      end if;
    end if;
  end loop;
  if v_redeem_count <> 1 or (p_result ->> 'afterPointBalance')::numeric <> (p_result ->> 'beforePointBalance')::numeric + v_point_delta then
    raise exception 'invalid_redemption_checkout';
  end if;
  select count(*) into v_item_coupon_count from jsonb_array_elements(v_row.request -> 'items') i
    where coalesce(btrim(i ->> 'couponSettlementCode'),'') <> '';
  if v_item_coupon_count <> (p_result ->> 'couponCount')::integer
     or exists (select 1 from jsonb_array_elements(v_row.request -> 'items') i
       where coalesce(btrim(i ->> 'couponSettlementCode'),'') <> '' and i -> 'quantity' is distinct from '1'::jsonb)
     or ((p_result ->> 'couponCount')::numeric > 0) is distinct from (p_mutation ? 'coupons') then
    raise exception 'invalid_redemption_checkout';
  end if;
  if p_mutation ? 'coupons' then
    if jsonb_typeof(p_mutation #> '{coupons,next}') is distinct from 'array' then raise exception 'invalid_redemption_checkout'; end if;
    select count(*) into v_count from public.pages where slug = '__merchant_coupons__:' || p_site_id;
    if v_count <> 1 then raise exception 'merchant_coupons_conflict'; end if;
    select * into v_coupon_page from public.pages where slug = '__merchant_coupons__:' || p_site_id for update;
    if v_coupon_page.merchant_id is distinct from p_site_id or jsonb_typeof(v_coupon_page.blocks) is distinct from 'array' then
      raise exception 'redemption_checkout_store_corrupt';
    end if;
    if jsonb_array_length(v_coupon_page.blocks) <> jsonb_array_length(p_mutation #> '{coupons,next}') then
      raise exception 'invalid_redemption_checkout';
    end if;
    begin
      if v_coupon_page.updated_at is distinct from (p_mutation #>> '{coupons,expectedUpdatedAt}')::timestamptz then
        raise exception 'merchant_coupons_conflict';
      end if;
    exception when invalid_datetime_format or datetime_field_overflow then raise exception 'invalid_redemption_checkout'; end;
    for v_coupon in select value from jsonb_array_elements(p_mutation #> '{coupons,next}') loop
      select count(*) into v_count from jsonb_array_elements(v_coupon_page.blocks) c where c ->> 'id' = v_coupon ->> 'id';
      if v_count <> 1 then raise exception 'invalid_redemption_checkout'; end if;
      select value into v_old_coupon from jsonb_array_elements(v_coupon_page.blocks) where value ->> 'id' = v_coupon ->> 'id';
      if jsonb_typeof(v_coupon -> 'redeemEvents') is distinct from 'array'
         or jsonb_typeof(v_old_coupon -> 'redeemEvents') is distinct from 'array' then raise exception 'invalid_redemption_checkout'; end if;
      if exists (select 1 from jsonb_array_elements(v_old_coupon -> 'redeemEvents') e
           where jsonb_typeof(e) is distinct from 'object' or jsonb_typeof(e -> 'id') is distinct from 'string'
             or btrim(e ->> 'id') = '')
         or exists (select 1 from jsonb_array_elements(v_old_coupon -> 'redeemEvents') e
           group by e ->> 'id' having count(*) > 1) then raise exception 'redemption_checkout_store_corrupt'; end if;
      if jsonb_array_length(v_coupon -> 'redeemEvents') > 5000
         or exists (select 1 from jsonb_array_elements(v_coupon -> 'redeemEvents') e
           where jsonb_typeof(e) is distinct from 'object' or jsonb_typeof(e -> 'id') is distinct from 'string'
             or btrim(e ->> 'id') = '')
         or exists (select 1 from jsonb_array_elements(v_coupon -> 'redeemEvents') e
           group by e ->> 'id' having count(*) > 1) then raise exception 'invalid_redemption_checkout'; end if;
      -- Index IDs once. Scanning a 5000-event array twice for every retained
      -- event is quadratic and can exceed the transaction timeout.
      select coalesce(jsonb_object_agg(value ->> 'id',true),'{}'::jsonb) into v_old_events_by_id
        from jsonb_array_elements(v_old_coupon -> 'redeemEvents');
      select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb) into v_actual_retained_events
        from jsonb_array_elements(v_coupon -> 'redeemEvents') with ordinality
        where v_old_events_by_id ? (value ->> 'id');
      v_coupon_changes := 0;
      v_new_events := '[]'::jsonb;
      for v_event in select value from jsonb_array_elements(v_coupon -> 'redeemEvents')
        where not (v_old_events_by_id ? (value ->> 'id')) loop
        if v_event ->> 'operatorId' is distinct from p_operator_id
           or position('[op:member-redemption-checkout:' || v_row.operation_id || ']' in coalesce(v_event ->> 'note','')) = 0
           or exists (select 1 from jsonb_array_elements(v_old_coupon -> 'redeemEvents') e
             where e ->> 'claimEventId' = v_event ->> 'claimEventId' or e ->> 'settlementCode' = v_event ->> 'settlementCode')
           or exists (select 1 from jsonb_array_elements(v_new_events) e
             where e ->> 'id' = v_event ->> 'id' or e ->> 'claimEventId' = v_event ->> 'claimEventId'
               or e ->> 'settlementCode' = v_event ->> 'settlementCode')
           or not exists (select 1 from jsonb_array_elements(v_row.request -> 'items') i
             where i ->> 'couponSettlementCode' = v_event ->> 'settlementCode'
               and (coalesce(i ->> 'couponId','') = '' or i ->> 'couponId' = v_coupon ->> 'id')
               and (coalesce(i ->> 'couponClaimId','') = '' or i ->> 'couponClaimId' = v_event ->> 'claimEventId')) then
          raise exception 'invalid_redemption_checkout';
        end if;
        v_coupon_changes := v_coupon_changes + 1;
        v_new_events := v_new_events || jsonb_build_array(v_event);
      end loop;
      -- The JS normalizer sorts by event time before applying its 5000 limit.
      -- Clock skew can put a new event between older stored events. Preserve
      -- the exact old subsequence, without incorrectly requiring new first.
      -- If future-dated events evict a new event entirely, the count check below
      -- remains fail-closed; that anomalous history requires explicit review.
      select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb) into v_retained_events
        from jsonb_array_elements(v_old_coupon -> 'redeemEvents') with ordinality
        where ordinality <= greatest(5000 - v_coupon_changes,0);
      if v_actual_retained_events is distinct from v_retained_events then
        raise exception 'invalid_redemption_checkout';
      end if;
      if (v_coupon ->> 'usedCount')::numeric is distinct from (v_old_coupon ->> 'usedCount')::numeric + v_coupon_changes then
        raise exception 'invalid_redemption_checkout';
      end if;
      v_coupon_count := v_coupon_count + v_coupon_changes;
    end loop;
    if v_coupon_count <> (p_result ->> 'couponCount')::integer then raise exception 'invalid_redemption_checkout'; end if;
  end if;
  v_commit := public.faolla_commit_redemption_internal_v1(p_site_id,p_mutation);
  if v_commit -> 'replayed' is distinct from 'false'::jsonb then raise exception 'redemption_legacy_operation_requires_review'; end if;
  v_slugs := array['__merchant_memberships__:' || p_site_id,'__merchant_memberships_history__:' || p_site_id,
    '__merchant_memberships_history_backup__:' || p_site_id,'__merchant_membership_settings__:' || p_site_id,
    '__merchant_membership_settings_history__:' || p_site_id,'__merchant_membership_settings_history_backup__:' || p_site_id];
  if p_mutation ? 'coupons' then v_slugs := v_slugs || array['__merchant_coupons__:' || p_site_id,
    '__merchant_coupons_history__:' || p_site_id,'__merchant_coupons_history_backup__:' || p_site_id]; end if;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.slug,p.id),'[]'::jsonb) into v_saved_domains from public.pages p where p.slug = any(v_slugs);
  select * into v_receipt from public.faolla_redemption_operations where merchant_id = p_site_id and operation_id = v_row.operation_id;
  if not found then raise exception 'redemption_checkout_mutation_not_persisted'; end if;
  v_expected := v_row; v_expected.status := 'committed'; v_expected.result := p_result;
  v_expected.updated_at := greatest(clock_timestamp(),v_row.updated_at + interval '1 millisecond');
  update public.faolla_redemption_checkouts set status = 'committed',result = p_result,updated_at = v_expected.updated_at
    where merchant_id = p_site_id and operation_id = v_row.operation_id returning * into v_saved;
  get diagnostics v_affected = row_count;
  if v_affected <> 1 or v_saved is distinct from v_expected then raise exception 'redemption_checkout_mutation_not_persisted'; end if;
  select * into v_saved from public.faolla_redemption_checkouts where merchant_id = p_site_id and operation_id = v_row.operation_id;
  if not found or v_saved is distinct from v_expected then raise exception 'redemption_checkout_mutation_not_persisted'; end if;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.slug,p.id),'[]'::jsonb) into v_actual_domains from public.pages p where p.slug = any(v_slugs);
  if v_actual_domains is distinct from v_saved_domains or not exists (select 1 from public.faolla_redemption_operations r
     where r.merchant_id = p_site_id and r.operation_id = v_row.operation_id and r is not distinct from v_receipt) then
    raise exception 'redemption_checkout_mutation_not_persisted';
  end if;
  return jsonb_build_object('replayed',false,'result',p_result,'versions',v_commit -> 'versions','updatedAt',v_expected.updated_at);
end;
$commit_checkout$;

-- Normalize grants only for this migration's exact functions/table. Internal
-- renamed 046 implementation must lose the inherited service_role EXECUTE.
do $acl$
declare v_function regprocedure; v_grantee record;
begin
  foreach v_function in array array[
    'public.faolla_commit_redemption_internal_v1(text,jsonb)'::regprocedure,
    'public.faolla_commit_redemption_v1(text,jsonb)'::regprocedure,
    'public.faolla_redemption_checkout_identity_internal(text,text,text)'::regprocedure,
    'public.faolla_redemption_checkout_json_internal(public.faolla_redemption_checkouts)'::regprocedure,
    'public.faolla_redemption_checkout_quote_internal(jsonb)'::regprocedure,
    'public.faolla_redemption_checkout_request_internal(jsonb,jsonb)'::regprocedure,
    'public.faolla_redemption_checkout_terminal_internal(text,text,text,boolean)'::regprocedure,
    'public.faolla_stage_redemption_checkout_v1(text,text,jsonb,jsonb)'::regprocedure,
    'public.faolla_get_redemption_checkout_v1(text,text,text)'::regprocedure,
    'public.faolla_cancel_redemption_checkout_v1(text,text,text)'::regprocedure,
    'public.faolla_ack_redemption_checkout_v1(text,text,text)'::regprocedure,
    'public.faolla_commit_redemption_v2(text,text,jsonb,jsonb)'::regprocedure
  ] loop
    for v_grantee in select distinct acl.grantee,role_metadata.rolname from pg_catalog.pg_proc metadata
      cross join lateral pg_catalog.aclexplode(coalesce(metadata.proacl,pg_catalog.acldefault('f',metadata.proowner))) acl
      left join pg_catalog.pg_roles role_metadata on role_metadata.oid = acl.grantee
      where metadata.oid = v_function and acl.grantee <> metadata.proowner
    loop
      if v_grantee.grantee = 0 then execute format('revoke all on function %s from public cascade',v_function);
      else execute format('revoke all on function %s from %I cascade',v_function,v_grantee.rolname); end if;
    end loop;
  end loop;
  for v_grantee in select distinct acl.grantee,role_metadata.rolname from pg_catalog.pg_class metadata
    cross join lateral pg_catalog.aclexplode(coalesce(metadata.relacl,pg_catalog.acldefault('r',metadata.relowner))) acl
    left join pg_catalog.pg_roles role_metadata on role_metadata.oid = acl.grantee
    where metadata.oid = 'public.faolla_redemption_checkouts'::regclass and acl.grantee <> metadata.relowner
  loop
    if v_grantee.grantee = 0 then revoke all on table public.faolla_redemption_checkouts from public cascade;
    else execute format('revoke all on table public.faolla_redemption_checkouts from %I cascade',v_grantee.rolname); end if;
  end loop;
  for v_grantee in select distinct attribute.attname,acl.grantee,role_metadata.rolname from pg_catalog.pg_class metadata
    join pg_catalog.pg_attribute attribute on attribute.attrelid = metadata.oid and attribute.attnum > 0 and not attribute.attisdropped
    cross join lateral pg_catalog.aclexplode(attribute.attacl) acl
    left join pg_catalog.pg_roles role_metadata on role_metadata.oid = acl.grantee
    where metadata.oid = 'public.faolla_redemption_checkouts'::regclass and acl.grantee <> metadata.relowner
  loop
    if v_grantee.grantee = 0 then execute format('revoke all (%I) on table public.faolla_redemption_checkouts from public cascade',v_grantee.attname);
    else execute format('revoke all (%I) on table public.faolla_redemption_checkouts from %I cascade',v_grantee.attname,v_grantee.rolname); end if;
  end loop;
end;
$acl$;

revoke all on table public.faolla_redemption_checkouts from public,anon,authenticated,service_role;
revoke all on function public.faolla_commit_redemption_internal_v1(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.faolla_commit_redemption_v1(text,jsonb) to service_role;
grant execute on function public.faolla_stage_redemption_checkout_v1(text,text,jsonb,jsonb) to service_role;
grant execute on function public.faolla_get_redemption_checkout_v1(text,text,text) to service_role;
grant execute on function public.faolla_cancel_redemption_checkout_v1(text,text,text) to service_role;
grant execute on function public.faolla_ack_redemption_checkout_v1(text,text,text) to service_role;
grant execute on function public.faolla_commit_redemption_v2(text,text,jsonb,jsonb) to service_role;

insert into public.faolla_schema_migrations(version,name) values(202609080047,'redemption_checkout_context')
on conflict (version) do nothing;
notify pgrst, 'reload schema';
commit;
