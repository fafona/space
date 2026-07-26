begin;

create or replace function public.faolla_upsert_merchant_order_v1(
  p_order jsonb,
  p_items jsonb,
  p_event jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_merchant_id text;
  v_order_id text;
  v_previous_status text;
begin
  if jsonb_typeof(p_order) <> 'object' then
    raise exception 'invalid_order_payload';
  end if;

  v_merchant_id := nullif(btrim(p_order ->> 'merchant_id'), '');
  v_order_id := nullif(btrim(p_order ->> 'id'), '');
  if v_merchant_id is null or v_order_id is null then
    raise exception 'invalid_order_identity';
  end if;

  select status
    into v_previous_status
    from public.merchant_orders
   where merchant_id = v_merchant_id
     and id = v_order_id;

  insert into public.merchant_orders (
    merchant_id,
    id,
    customer_id,
    site_name,
    block_id,
    client_request_id,
    status,
    currency,
    price_prefix,
    total_quantity,
    total_amount_minor,
    customer_snapshot,
    source_snapshot,
    confirmed_at,
    completed_at,
    cancelled_at,
    printed_at,
    print_count,
    merchant_touched_at,
    created_at,
    updated_at
  )
  values (
    v_merchant_id,
    v_order_id,
    null,
    coalesce(p_order ->> 'site_name', ''),
    coalesce(p_order ->> 'block_id', ''),
    nullif(btrim(p_order ->> 'client_request_id'), ''),
    coalesce(nullif(btrim(p_order ->> 'status'), ''), 'pending'),
    coalesce(nullif(upper(btrim(p_order ->> 'currency')), ''), 'EUR'),
    coalesce(p_order ->> 'price_prefix', ''),
    greatest(0, coalesce((p_order ->> 'total_quantity')::integer, 0)),
    greatest(0, coalesce((p_order ->> 'total_amount_minor')::bigint, 0)),
    coalesce(p_order -> 'customer_snapshot', '{}'::jsonb),
    coalesce(p_order -> 'source_snapshot', '{}'::jsonb),
    nullif(p_order ->> 'confirmed_at', '')::timestamptz,
    nullif(p_order ->> 'completed_at', '')::timestamptz,
    nullif(p_order ->> 'cancelled_at', '')::timestamptz,
    nullif(p_order ->> 'printed_at', '')::timestamptz,
    greatest(0, coalesce((p_order ->> 'print_count')::integer, 0)),
    nullif(p_order ->> 'merchant_touched_at', '')::timestamptz,
    coalesce(nullif(p_order ->> 'created_at', '')::timestamptz, now()),
    coalesce(nullif(p_order ->> 'updated_at', '')::timestamptz, now())
  )
  on conflict (merchant_id, id) do update
  set
    site_name = excluded.site_name,
    block_id = excluded.block_id,
    client_request_id = excluded.client_request_id,
    status = excluded.status,
    currency = excluded.currency,
    price_prefix = excluded.price_prefix,
    total_quantity = excluded.total_quantity,
    total_amount_minor = excluded.total_amount_minor,
    customer_snapshot = excluded.customer_snapshot,
    source_snapshot = excluded.source_snapshot,
    confirmed_at = excluded.confirmed_at,
    completed_at = excluded.completed_at,
    cancelled_at = excluded.cancelled_at,
    printed_at = excluded.printed_at,
    print_count = excluded.print_count,
    merchant_touched_at = excluded.merchant_touched_at,
    updated_at = excluded.updated_at;

  delete from public.merchant_order_items
   where merchant_id = v_merchant_id
     and order_id = v_order_id;

  insert into public.merchant_order_items (
    merchant_id,
    order_id,
    line_number,
    product_id,
    code,
    name,
    description,
    image_url,
    tag,
    quantity,
    unit_amount_minor,
    subtotal_amount_minor,
    unit_price_text,
    source_snapshot
  )
  select
    v_merchant_id,
    v_order_id,
    item.ordinality::smallint,
    coalesce(item.value ->> 'product_id', ''),
    coalesce(item.value ->> 'code', ''),
    coalesce(item.value ->> 'name', ''),
    coalesce(item.value ->> 'description', ''),
    coalesce(item.value ->> 'image_url', ''),
    coalesce(item.value ->> 'tag', ''),
    greatest(1, coalesce((item.value ->> 'quantity')::integer, 1)),
    greatest(0, coalesce((item.value ->> 'unit_amount_minor')::bigint, 0)),
    greatest(0, coalesce((item.value ->> 'subtotal_amount_minor')::bigint, 0)),
    coalesce(item.value ->> 'unit_price_text', ''),
    coalesce(item.value -> 'source_snapshot', '{}'::jsonb)
  from jsonb_array_elements(
    case
      when jsonb_typeof(p_items) = 'array' then p_items
      else '[]'::jsonb
    end
  ) with ordinality as item(value, ordinality);

  if jsonb_typeof(p_event) = 'object'
     and nullif(btrim(p_event ->> 'idempotency_key'), '') is not null then
    insert into public.merchant_order_events (
      merchant_id,
      order_id,
      event_type,
      from_status,
      to_status,
      actor_id,
      idempotency_key,
      payload,
      created_at
    )
    values (
      v_merchant_id,
      v_order_id,
      coalesce(nullif(btrim(p_event ->> 'event_type'), ''), 'legacy_shadow_sync'),
      coalesce(nullif(btrim(p_event ->> 'from_status'), ''), v_previous_status),
      nullif(btrim(p_event ->> 'to_status'), ''),
      coalesce(p_event ->> 'actor_id', ''),
      btrim(p_event ->> 'idempotency_key'),
      coalesce(p_event -> 'payload', '{}'::jsonb),
      coalesce(nullif(p_event ->> 'created_at', '')::timestamptz, now())
    )
    on conflict (merchant_id, idempotency_key) do nothing;
  end if;
end;
$$;

create or replace function public.faolla_upsert_merchant_orders_v1(
  p_mutations jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mutation jsonb;
  v_count integer := 0;
begin
  if jsonb_typeof(p_mutations) <> 'array' then
    raise exception 'invalid_order_mutations_payload';
  end if;

  for v_mutation in
    select value
      from jsonb_array_elements(p_mutations)
  loop
    perform public.faolla_upsert_merchant_order_v1(
      v_mutation -> 'order',
      v_mutation -> 'items',
      v_mutation -> 'event'
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.faolla_upsert_merchant_order_v1(jsonb, jsonb, jsonb) from public;
revoke all on function public.faolla_upsert_merchant_orders_v1(jsonb) from public;
grant execute on function public.faolla_upsert_merchant_orders_v1(jsonb) to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202607250002, 'order_shadow_write_rpc')
on conflict (version) do nothing;

commit;
