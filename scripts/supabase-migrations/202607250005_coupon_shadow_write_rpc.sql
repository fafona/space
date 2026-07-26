begin;

create table if not exists public.merchant_coupons (
  merchant_id text not null references public.merchants(id) on delete restrict,
  id text not null,
  code text not null default '',
  title text not null default '',
  status text not null default 'active'
    check (status in ('active', 'paused', 'archived')),
  discount_type text not null
    check (
      discount_type in (
        'amount_off',
        'percent_off',
        'threshold_amount_off',
        'product_voucher',
        'stored_value',
        'exchange_voucher',
        'ticket_voucher',
        'points_voucher'
      )
    ),
  discount_value numeric(18, 4) not null default 0 check (discount_value >= 0),
  minimum_amount numeric(18, 4) not null default 0 check (minimum_amount >= 0),
  total_quantity integer not null default 0 check (total_quantity >= 0),
  claimed_count integer not null default 0 check (claimed_count >= 0),
  used_count integer not null default 0 check (used_count >= 0),
  starts_at timestamptz null,
  expires_at timestamptz null,
  configuration jsonb not null default '{}'::jsonb,
  source_snapshot jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (merchant_id, id)
);

create index if not exists merchant_coupons_status_updated_idx
  on public.merchant_coupons(merchant_id, status, updated_at desc);
create index if not exists merchant_coupons_code_idx
  on public.merchant_coupons(merchant_id, code);

create table if not exists public.merchant_coupon_claims (
  merchant_id text not null,
  id text not null,
  coupon_id text not null,
  customer_id uuid null,
  settlement_type text not null
    check (settlement_type in ('qr', 'barcode')),
  settlement_code_hash text null,
  claim_code_hash text null,
  status text not null default 'claimed'
    check (status in ('claimed', 'redeemed')),
  customer_snapshot jsonb not null default '{}'::jsonb,
  source_snapshot jsonb not null default '{}'::jsonb,
  claimed_at timestamptz not null,
  valid_until timestamptz null,
  source_updated_at timestamptz not null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (merchant_id, id),
  constraint merchant_coupon_claims_coupon_fk
    foreign key (merchant_id, coupon_id)
    references public.merchant_coupons(merchant_id, id)
    on delete cascade,
  constraint merchant_coupon_claims_customer_fk
    foreign key (merchant_id, customer_id)
    references public.merchant_customers(merchant_id, id)
    on delete restrict
);

create index if not exists merchant_coupon_claims_coupon_claimed_idx
  on public.merchant_coupon_claims(merchant_id, coupon_id, claimed_at desc);
create index if not exists merchant_coupon_claims_customer_claimed_idx
  on public.merchant_coupon_claims(merchant_id, customer_id, claimed_at desc)
  where customer_id is not null;
create index if not exists merchant_coupon_claims_settlement_hash_idx
  on public.merchant_coupon_claims(merchant_id, settlement_code_hash)
  where settlement_code_hash is not null;

create table if not exists public.merchant_coupon_redemptions (
  merchant_id text not null,
  id text not null,
  coupon_id text not null,
  claim_id text not null,
  customer_id uuid null,
  state text not null default 'active'
    check (state in ('active', 'released')),
  settlement_code_hash text null,
  operator_id text not null default '',
  note text not null default '',
  source_snapshot jsonb not null default '{}'::jsonb,
  redeemed_at timestamptz not null,
  released_at timestamptz null,
  source_updated_at timestamptz not null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (merchant_id, id),
  constraint merchant_coupon_redemptions_coupon_fk
    foreign key (merchant_id, coupon_id)
    references public.merchant_coupons(merchant_id, id)
    on delete cascade,
  constraint merchant_coupon_redemptions_claim_fk
    foreign key (merchant_id, claim_id)
    references public.merchant_coupon_claims(merchant_id, id)
    on delete restrict,
  constraint merchant_coupon_redemptions_customer_fk
    foreign key (merchant_id, customer_id)
    references public.merchant_customers(merchant_id, id)
    on delete restrict
);

create index if not exists merchant_coupon_redemptions_coupon_redeemed_idx
  on public.merchant_coupon_redemptions(merchant_id, coupon_id, redeemed_at desc);
create index if not exists merchant_coupon_redemptions_claim_idx
  on public.merchant_coupon_redemptions(merchant_id, claim_id);
create index if not exists merchant_coupon_redemptions_state_updated_idx
  on public.merchant_coupon_redemptions(merchant_id, state, updated_at desc);

create table if not exists public.merchant_coupon_events (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null,
  coupon_id text not null,
  event_id text not null,
  event_type text not null,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint merchant_coupon_events_coupon_fk
    foreign key (merchant_id, coupon_id)
    references public.merchant_coupons(merchant_id, id)
    on delete cascade,
  constraint merchant_coupon_events_event_unique
    unique (merchant_id, coupon_id, event_id),
  constraint merchant_coupon_events_idempotency_unique
    unique (merchant_id, idempotency_key)
);

create index if not exists merchant_coupon_events_coupon_created_idx
  on public.merchant_coupon_events(merchant_id, coupon_id, created_at desc);

drop trigger if exists merchant_coupons_touch_version on public.merchant_coupons;
create trigger merchant_coupons_touch_version
before update on public.merchant_coupons
for each row
execute function public.faolla_touch_versioned_row();

drop trigger if exists merchant_coupon_claims_touch_version on public.merchant_coupon_claims;
create trigger merchant_coupon_claims_touch_version
before update on public.merchant_coupon_claims
for each row
execute function public.faolla_touch_versioned_row();

drop trigger if exists merchant_coupon_redemptions_touch_version on public.merchant_coupon_redemptions;
create trigger merchant_coupon_redemptions_touch_version
before update on public.merchant_coupon_redemptions
for each row
execute function public.faolla_touch_versioned_row();

alter table public.merchant_coupons enable row level security;
alter table public.merchant_coupon_claims enable row level security;
alter table public.merchant_coupon_redemptions enable row level security;
alter table public.merchant_coupon_events enable row level security;

grant select on public.merchant_coupons to authenticated;
grant select on public.merchant_coupon_claims to authenticated;
grant select on public.merchant_coupon_redemptions to authenticated;
grant select on public.merchant_coupon_events to authenticated;

drop policy if exists merchant_coupons_owner_read on public.merchant_coupons;
create policy merchant_coupons_owner_read on public.merchant_coupons
for select to authenticated
using (public.faolla_is_merchant_owner(merchant_id));

drop policy if exists merchant_coupon_claims_owner_read on public.merchant_coupon_claims;
create policy merchant_coupon_claims_owner_read on public.merchant_coupon_claims
for select to authenticated
using (public.faolla_is_merchant_owner(merchant_id));

drop policy if exists merchant_coupon_redemptions_owner_read on public.merchant_coupon_redemptions;
create policy merchant_coupon_redemptions_owner_read on public.merchant_coupon_redemptions
for select to authenticated
using (public.faolla_is_merchant_owner(merchant_id));

drop policy if exists merchant_coupon_events_owner_read on public.merchant_coupon_events;
create policy merchant_coupon_events_owner_read on public.merchant_coupon_events
for select to authenticated
using (public.faolla_is_merchant_owner(merchant_id));

create or replace function public.faolla_resolve_merchant_customer_v1(
  p_merchant_id text,
  p_customer jsonb,
  p_source text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id text;
  v_auth_user_id text;
  v_guest_hash text;
  v_email text;
  v_phone text;
  v_identity_lock text;
  v_customer_id uuid;
  v_customer_updated_at timestamptz;
begin
  if jsonb_typeof(p_customer) <> 'object' then
    return null;
  end if;
  if nullif(btrim(p_customer ->> 'merchant_id'), '') is distinct from p_merchant_id then
    raise exception 'customer_merchant_mismatch:%', coalesce(nullif(btrim(p_source), ''), 'v1');
  end if;

  v_account_id := nullif(btrim(p_customer ->> 'account_id'), '');
  v_auth_user_id := nullif(btrim(p_customer ->> 'auth_user_id'), '');
  v_guest_hash := nullif(btrim(p_customer ->> 'guest_hash'), '');
  v_email := nullif(lower(btrim(p_customer ->> 'email')), '');
  v_phone := nullif(btrim(p_customer ->> 'phone'), '');
  v_customer_updated_at := coalesce(
    nullif(p_customer ->> 'updated_at', '')::timestamptz,
    now()
  );
  v_identity_lock := coalesce(
    'account:' || v_account_id,
    'auth:' || v_auth_user_id,
    'guest:' || v_guest_hash,
    'email:' || v_email,
    'phone:' || v_phone
  );
  if v_identity_lock is null then
    return null;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'faolla-customer:' || p_merchant_id || ':' || v_identity_lock,
      0
    )
  );

  select customer.id
    into v_customer_id
    from public.merchant_customers customer
   where customer.merchant_id = p_merchant_id
     and (
       (v_account_id is not null and customer.account_id = v_account_id)
       or (v_auth_user_id is not null and customer.auth_user_id = v_auth_user_id)
       or (v_guest_hash is not null and customer.guest_hash = v_guest_hash)
       or (v_email is not null and lower(customer.email) = v_email)
       or (v_phone is not null and customer.phone = v_phone)
     )
   order by
     case
       when v_account_id is not null and customer.account_id = v_account_id then 1
       when v_auth_user_id is not null and customer.auth_user_id = v_auth_user_id then 2
       when v_guest_hash is not null and customer.guest_hash = v_guest_hash then 3
       when v_email is not null and lower(customer.email) = v_email then 4
       else 5
     end,
     customer.created_at asc
   limit 1
   for update;

  if v_customer_id is null then
    insert into public.merchant_customers (
      merchant_id,
      account_id,
      auth_user_id,
      guest_hash,
      email,
      phone,
      display_name,
      status,
      profile,
      created_at,
      updated_at
    )
    values (
      p_merchant_id,
      v_account_id,
      v_auth_user_id,
      v_guest_hash,
      v_email,
      v_phone,
      coalesce(p_customer ->> 'display_name', ''),
      'active',
      coalesce(p_customer -> 'profile', '{}'::jsonb),
      coalesce(nullif(p_customer ->> 'created_at', '')::timestamptz, now()),
      v_customer_updated_at
    )
    returning id into v_customer_id;
  else
    update public.merchant_customers customer
       set account_id = coalesce(customer.account_id, v_account_id),
           auth_user_id = coalesce(customer.auth_user_id, v_auth_user_id),
           guest_hash = coalesce(customer.guest_hash, v_guest_hash),
           email = case
             when v_customer_updated_at >= customer.updated_at
               then coalesce(v_email, customer.email)
             else customer.email
           end,
           phone = case
             when v_customer_updated_at >= customer.updated_at
               then coalesce(v_phone, customer.phone)
             else customer.phone
           end,
           display_name = case
             when v_customer_updated_at >= customer.updated_at
               then coalesce(
                 nullif(p_customer ->> 'display_name', ''),
                 customer.display_name
               )
             else customer.display_name
           end,
           profile = case
             when v_customer_updated_at >= customer.updated_at
               then customer.profile || coalesce(p_customer -> 'profile', '{}'::jsonb)
             else customer.profile
           end,
           updated_at = greatest(customer.updated_at, v_customer_updated_at)
     where customer.id = v_customer_id;
  end if;

  return v_customer_id;
end;
$$;

revoke all on function public.faolla_resolve_merchant_customer_v1(text, jsonb, text) from public;
grant execute on function public.faolla_resolve_merchant_customer_v1(text, jsonb, text) to service_role;

create or replace function public.faolla_upsert_merchant_coupons_v1(
  p_mutations jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mutation jsonb;
  v_coupon jsonb;
  v_claim jsonb;
  v_redemption jsonb;
  v_event jsonb;
  v_release_id text;
  v_merchant_id text;
  v_coupon_id text;
  v_claim_id text;
  v_customer_id uuid;
  v_incoming_updated_at timestamptz;
  v_existing_updated_at timestamptz;
  v_count integer := 0;
begin
  if jsonb_typeof(p_mutations) <> 'array' then
    raise exception 'invalid_coupon_mutations_payload';
  end if;

  for v_mutation in
    select value
      from jsonb_array_elements(p_mutations)
  loop
    v_coupon := v_mutation -> 'coupon';
    if jsonb_typeof(v_coupon) <> 'object' then
      raise exception 'invalid_coupon_payload';
    end if;

    v_merchant_id := nullif(btrim(v_coupon ->> 'merchant_id'), '');
    v_coupon_id := nullif(btrim(v_coupon ->> 'id'), '');
    if v_merchant_id is null or v_coupon_id is null then
      raise exception 'invalid_coupon_identity';
    end if;
    v_incoming_updated_at := coalesce(
      nullif(v_coupon ->> 'updated_at', '')::timestamptz,
      now()
    );
    v_existing_updated_at := null;
    select coupon.updated_at
      into v_existing_updated_at
      from public.merchant_coupons coupon
     where coupon.merchant_id = v_merchant_id
       and coupon.id = v_coupon_id
     for update;

    if v_existing_updated_at is not null
       and v_existing_updated_at > v_incoming_updated_at then
      v_count := v_count + 1;
      continue;
    end if;

    insert into public.merchant_coupons (
      merchant_id,
      id,
      code,
      title,
      status,
      discount_type,
      discount_value,
      minimum_amount,
      total_quantity,
      claimed_count,
      used_count,
      starts_at,
      expires_at,
      configuration,
      source_snapshot,
      created_at,
      updated_at
    )
    values (
      v_merchant_id,
      v_coupon_id,
      coalesce(v_coupon ->> 'code', ''),
      coalesce(v_coupon ->> 'title', ''),
      coalesce(nullif(btrim(v_coupon ->> 'status'), ''), 'active'),
      coalesce(nullif(btrim(v_coupon ->> 'discount_type'), ''), 'amount_off'),
      coalesce((v_coupon ->> 'discount_value')::numeric, 0),
      coalesce((v_coupon ->> 'minimum_amount')::numeric, 0),
      coalesce((v_coupon ->> 'total_quantity')::integer, 0),
      coalesce((v_coupon ->> 'claimed_count')::integer, 0),
      coalesce((v_coupon ->> 'used_count')::integer, 0),
      nullif(v_coupon ->> 'starts_at', '')::timestamptz,
      nullif(v_coupon ->> 'expires_at', '')::timestamptz,
      coalesce(v_coupon -> 'configuration', '{}'::jsonb),
      coalesce(v_coupon -> 'source_snapshot', '{}'::jsonb),
      coalesce(nullif(v_coupon ->> 'created_at', '')::timestamptz, now()),
      v_incoming_updated_at
    )
    on conflict (merchant_id, id) do update
    set
      code = excluded.code,
      title = excluded.title,
      status = excluded.status,
      discount_type = excluded.discount_type,
      discount_value = excluded.discount_value,
      minimum_amount = excluded.minimum_amount,
      total_quantity = excluded.total_quantity,
      claimed_count = excluded.claimed_count,
      used_count = excluded.used_count,
      starts_at = excluded.starts_at,
      expires_at = excluded.expires_at,
      configuration = excluded.configuration,
      source_snapshot = excluded.source_snapshot,
      updated_at = excluded.updated_at
    where excluded.updated_at >= merchant_coupons.updated_at;

    if jsonb_typeof(v_mutation -> 'claims') = 'array' then
      for v_claim in
        select value
          from jsonb_array_elements(v_mutation -> 'claims')
      loop
        v_claim_id := nullif(btrim(v_claim ->> 'id'), '');
        if v_claim_id is null then
          raise exception 'invalid_coupon_claim_identity';
        end if;
        v_customer_id := public.faolla_resolve_merchant_customer_v1(
          v_merchant_id,
          v_claim -> 'customer',
          'coupon'
        );

        insert into public.merchant_coupon_claims (
          merchant_id,
          id,
          coupon_id,
          customer_id,
          settlement_type,
          settlement_code_hash,
          claim_code_hash,
          status,
          customer_snapshot,
          source_snapshot,
          claimed_at,
          valid_until,
          source_updated_at,
          updated_at
        )
        values (
          v_merchant_id,
          v_claim_id,
          v_coupon_id,
          v_customer_id,
          coalesce(nullif(btrim(v_claim ->> 'settlement_type'), ''), 'qr'),
          nullif(btrim(v_claim ->> 'settlement_code_hash'), ''),
          nullif(btrim(v_claim ->> 'claim_code_hash'), ''),
          coalesce(nullif(btrim(v_claim ->> 'status'), ''), 'claimed'),
          coalesce(v_claim -> 'customer_snapshot', '{}'::jsonb),
          coalesce(v_claim -> 'source_snapshot', '{}'::jsonb),
          coalesce(nullif(v_claim ->> 'claimed_at', '')::timestamptz, now()),
          nullif(v_claim ->> 'valid_until', '')::timestamptz,
          coalesce(
            nullif(v_claim ->> 'source_updated_at', '')::timestamptz,
            v_incoming_updated_at
          ),
          coalesce(
            nullif(v_claim ->> 'source_updated_at', '')::timestamptz,
            v_incoming_updated_at
          )
        )
        on conflict (merchant_id, id) do update
        set
          customer_id = coalesce(excluded.customer_id, merchant_coupon_claims.customer_id),
          settlement_type = excluded.settlement_type,
          settlement_code_hash = excluded.settlement_code_hash,
          claim_code_hash = excluded.claim_code_hash,
          status = excluded.status,
          customer_snapshot = excluded.customer_snapshot,
          source_snapshot = excluded.source_snapshot,
          valid_until = excluded.valid_until,
          source_updated_at = excluded.source_updated_at,
          updated_at = excluded.updated_at
        where excluded.source_updated_at >= merchant_coupon_claims.source_updated_at;
      end loop;
    end if;

    if jsonb_typeof(v_mutation -> 'redemptions') = 'array' then
      for v_redemption in
        select value
          from jsonb_array_elements(v_mutation -> 'redemptions')
      loop
        if nullif(btrim(v_redemption ->> 'id'), '') is null
           or nullif(btrim(v_redemption ->> 'claim_id'), '') is null then
          raise exception 'invalid_coupon_redemption_identity';
        end if;

        select claim.customer_id
          into v_customer_id
          from public.merchant_coupon_claims claim
         where claim.merchant_id = v_merchant_id
           and claim.id = btrim(v_redemption ->> 'claim_id');
        if not found then
          raise exception 'coupon_redemption_claim_not_found';
        end if;

        insert into public.merchant_coupon_redemptions (
          merchant_id,
          id,
          coupon_id,
          claim_id,
          customer_id,
          state,
          settlement_code_hash,
          operator_id,
          note,
          source_snapshot,
          redeemed_at,
          released_at,
          source_updated_at,
          updated_at
        )
        values (
          v_merchant_id,
          btrim(v_redemption ->> 'id'),
          v_coupon_id,
          btrim(v_redemption ->> 'claim_id'),
          v_customer_id,
          'active',
          nullif(btrim(v_redemption ->> 'settlement_code_hash'), ''),
          coalesce(v_redemption ->> 'operator_id', ''),
          coalesce(v_redemption ->> 'note', ''),
          coalesce(v_redemption -> 'source_snapshot', '{}'::jsonb),
          coalesce(nullif(v_redemption ->> 'redeemed_at', '')::timestamptz, now()),
          null,
          coalesce(
            nullif(v_redemption ->> 'source_updated_at', '')::timestamptz,
            v_incoming_updated_at
          ),
          coalesce(
            nullif(v_redemption ->> 'source_updated_at', '')::timestamptz,
            v_incoming_updated_at
          )
        )
        on conflict (merchant_id, id) do update
        set
          customer_id = coalesce(excluded.customer_id, merchant_coupon_redemptions.customer_id),
          state = 'active',
          settlement_code_hash = excluded.settlement_code_hash,
          operator_id = excluded.operator_id,
          note = excluded.note,
          source_snapshot = excluded.source_snapshot,
          redeemed_at = excluded.redeemed_at,
          released_at = null,
          source_updated_at = excluded.source_updated_at,
          updated_at = excluded.updated_at
        where excluded.source_updated_at >= merchant_coupon_redemptions.source_updated_at;

        update public.merchant_coupon_claims claim
           set status = 'redeemed',
               source_updated_at = greatest(
                 claim.source_updated_at,
                 v_incoming_updated_at
               ),
               updated_at = greatest(claim.updated_at, v_incoming_updated_at)
         where claim.merchant_id = v_merchant_id
           and claim.id = btrim(v_redemption ->> 'claim_id');
      end loop;
    end if;

    if jsonb_typeof(v_mutation -> 'released_redemption_ids') = 'array' then
      for v_release_id in
        select value #>> '{}'
          from jsonb_array_elements(v_mutation -> 'released_redemption_ids')
      loop
        v_claim_id := null;
        update public.merchant_coupon_redemptions redemption
           set state = 'released',
               released_at = v_incoming_updated_at,
               source_updated_at = greatest(
                 redemption.source_updated_at,
                 v_incoming_updated_at
               ),
               updated_at = greatest(redemption.updated_at, v_incoming_updated_at)
         where redemption.merchant_id = v_merchant_id
           and redemption.coupon_id = v_coupon_id
           and redemption.id = btrim(v_release_id)
           and redemption.state = 'active'
           and redemption.source_updated_at <= v_incoming_updated_at
        returning redemption.claim_id into v_claim_id;

        if v_claim_id is not null
           and not exists (
             select 1
               from public.merchant_coupon_redemptions active_redemption
              where active_redemption.merchant_id = v_merchant_id
                and active_redemption.claim_id = v_claim_id
                and active_redemption.state = 'active'
           ) then
          update public.merchant_coupon_claims claim
             set status = 'claimed',
                 source_updated_at = greatest(
                   claim.source_updated_at,
                   v_incoming_updated_at
                 ),
                 updated_at = greatest(claim.updated_at, v_incoming_updated_at)
           where claim.merchant_id = v_merchant_id
             and claim.id = v_claim_id;
        end if;
      end loop;
    end if;

    if jsonb_typeof(v_mutation -> 'events') = 'array' then
      for v_event in
        select value
          from jsonb_array_elements(v_mutation -> 'events')
      loop
        if nullif(btrim(v_event ->> 'event_id'), '') is null
           or nullif(btrim(v_event ->> 'idempotency_key'), '') is null then
          raise exception 'invalid_coupon_event_identity';
        end if;
        insert into public.merchant_coupon_events (
          merchant_id,
          coupon_id,
          event_id,
          event_type,
          idempotency_key,
          payload,
          created_at
        )
        values (
          v_merchant_id,
          v_coupon_id,
          btrim(v_event ->> 'event_id'),
          coalesce(nullif(btrim(v_event ->> 'event_type'), ''), 'legacy_coupon'),
          btrim(v_event ->> 'idempotency_key'),
          coalesce(v_event -> 'payload', '{}'::jsonb),
          coalesce(nullif(v_event ->> 'created_at', '')::timestamptz, now())
        )
        on conflict (merchant_id, idempotency_key) do nothing;
      end loop;
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.faolla_upsert_merchant_coupons_v1(jsonb) from public;
grant execute on function public.faolla_upsert_merchant_coupons_v1(jsonb) to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202607250005, 'coupon_shadow_write_rpc')
on conflict (version) do nothing;

commit;
