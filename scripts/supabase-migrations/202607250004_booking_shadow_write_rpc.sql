begin;

create table if not exists public.merchant_bookings (
  merchant_id text not null references public.merchants(id) on delete restrict,
  id text not null,
  customer_id uuid null,
  site_name text not null default '',
  booking_block_id text not null default '',
  booking_viewport text null
    check (booking_viewport is null or booking_viewport in ('desktop', 'mobile')),
  status text not null default 'active'
    check (status in ('active', 'confirmed', 'completed', 'no_show', 'cancelled')),
  store text not null default '',
  item text not null default '',
  appointment_at_local text not null default '',
  title text not null default '',
  customer_snapshot jsonb not null default '{}'::jsonb,
  note text not null default '',
  source_snapshot jsonb not null default '{}'::jsonb,
  merchant_touched_at timestamptz null,
  no_show_marked_at timestamptz null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (merchant_id, id),
  constraint merchant_bookings_customer_fk
    foreign key (merchant_id, customer_id)
    references public.merchant_customers(merchant_id, id)
    on delete restrict
);

create index if not exists merchant_bookings_status_appointment_idx
  on public.merchant_bookings(merchant_id, status, appointment_at_local);
create index if not exists merchant_bookings_customer_created_idx
  on public.merchant_bookings(merchant_id, customer_id, created_at desc)
  where customer_id is not null;
create index if not exists merchant_bookings_updated_idx
  on public.merchant_bookings(merchant_id, updated_at desc);

create table if not exists public.merchant_booking_events (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null,
  booking_id text not null,
  event_id text not null,
  event_type text not null,
  actor text not null default 'system',
  from_status text null,
  to_status text null,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint merchant_booking_events_booking_fk
    foreign key (merchant_id, booking_id)
    references public.merchant_bookings(merchant_id, id)
    on delete cascade,
  constraint merchant_booking_events_event_unique
    unique (merchant_id, booking_id, event_id),
  constraint merchant_booking_events_idempotency_unique
    unique (merchant_id, idempotency_key)
);

create index if not exists merchant_booking_events_booking_created_idx
  on public.merchant_booking_events(merchant_id, booking_id, created_at desc);

drop trigger if exists merchant_bookings_touch_version on public.merchant_bookings;
create trigger merchant_bookings_touch_version
before update on public.merchant_bookings
for each row
execute function public.faolla_touch_versioned_row();

alter table public.merchant_bookings enable row level security;
alter table public.merchant_booking_events enable row level security;

grant select on public.merchant_bookings to authenticated;
grant select on public.merchant_booking_events to authenticated;

drop policy if exists merchant_bookings_owner_read on public.merchant_bookings;
create policy merchant_bookings_owner_read on public.merchant_bookings
for select to authenticated
using (public.faolla_is_merchant_owner(merchant_id));

drop policy if exists merchant_booking_events_owner_read on public.merchant_booking_events;
create policy merchant_booking_events_owner_read on public.merchant_booking_events
for select to authenticated
using (public.faolla_is_merchant_owner(merchant_id));

create or replace function public.faolla_upsert_merchant_bookings_v1(
  p_mutations jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mutation jsonb;
  v_booking jsonb;
  v_customer jsonb;
  v_event jsonb;
  v_merchant_id text;
  v_booking_id text;
  v_account_id text;
  v_auth_user_id text;
  v_guest_hash text;
  v_email text;
  v_phone text;
  v_identity_lock text;
  v_customer_id uuid;
  v_customer_updated_at timestamptz;
  v_count integer := 0;
begin
  if jsonb_typeof(p_mutations) <> 'array' then
    raise exception 'invalid_booking_mutations_payload';
  end if;

  for v_mutation in
    select value
      from jsonb_array_elements(p_mutations)
  loop
    v_booking := v_mutation -> 'booking';
    if jsonb_typeof(v_booking) <> 'object' then
      raise exception 'invalid_booking_payload';
    end if;

    v_merchant_id := nullif(btrim(v_booking ->> 'merchant_id'), '');
    v_booking_id := nullif(btrim(v_booking ->> 'id'), '');
    if v_merchant_id is null or v_booking_id is null then
      raise exception 'invalid_booking_identity';
    end if;

    v_customer_id := null;
    v_customer := v_mutation -> 'customer';
    if jsonb_typeof(v_customer) = 'object' then
      if nullif(btrim(v_customer ->> 'merchant_id'), '') is distinct from v_merchant_id then
        raise exception 'booking_customer_merchant_mismatch';
      end if;

      v_account_id := nullif(btrim(v_customer ->> 'account_id'), '');
      v_auth_user_id := nullif(btrim(v_customer ->> 'auth_user_id'), '');
      v_guest_hash := nullif(btrim(v_customer ->> 'guest_hash'), '');
      v_email := nullif(lower(btrim(v_customer ->> 'email')), '');
      v_phone := nullif(btrim(v_customer ->> 'phone'), '');
      v_customer_updated_at := coalesce(
        nullif(v_customer ->> 'updated_at', '')::timestamptz,
        now()
      );

      v_identity_lock := coalesce(
        'account:' || v_account_id,
        'auth:' || v_auth_user_id,
        'guest:' || v_guest_hash,
        'email:' || v_email,
        'phone:' || v_phone
      );

      if v_identity_lock is not null then
        perform pg_advisory_xact_lock(
          hashtextextended(
            'faolla-booking-customer:' || v_merchant_id || ':' || v_identity_lock,
            0
          )
        );

        select customer.id
          into v_customer_id
          from public.merchant_customers customer
         where customer.merchant_id = v_merchant_id
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
            v_merchant_id,
            v_account_id,
            v_auth_user_id,
            v_guest_hash,
            v_email,
            v_phone,
            coalesce(v_customer ->> 'display_name', ''),
            'active',
            coalesce(v_customer -> 'profile', '{}'::jsonb),
            coalesce(nullif(v_customer ->> 'created_at', '')::timestamptz, now()),
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
                       nullif(v_customer ->> 'display_name', ''),
                       customer.display_name
                     )
                   else customer.display_name
                 end,
                 profile = case
                   when v_customer_updated_at >= customer.updated_at
                     then customer.profile || coalesce(v_customer -> 'profile', '{}'::jsonb)
                   else customer.profile
                 end,
                 updated_at = greatest(customer.updated_at, v_customer_updated_at)
           where customer.id = v_customer_id;
        end if;
      end if;
    end if;

    insert into public.merchant_bookings (
      merchant_id,
      id,
      customer_id,
      site_name,
      booking_block_id,
      booking_viewport,
      status,
      store,
      item,
      appointment_at_local,
      title,
      customer_snapshot,
      note,
      source_snapshot,
      merchant_touched_at,
      no_show_marked_at,
      created_at,
      updated_at
    )
    values (
      v_merchant_id,
      v_booking_id,
      v_customer_id,
      coalesce(v_booking ->> 'site_name', ''),
      coalesce(v_booking ->> 'booking_block_id', ''),
      nullif(btrim(v_booking ->> 'booking_viewport'), ''),
      coalesce(nullif(btrim(v_booking ->> 'status'), ''), 'active'),
      coalesce(v_booking ->> 'store', ''),
      coalesce(v_booking ->> 'item', ''),
      coalesce(v_booking ->> 'appointment_at_local', ''),
      coalesce(v_booking ->> 'title', ''),
      coalesce(v_booking -> 'customer_snapshot', '{}'::jsonb),
      coalesce(v_booking ->> 'note', ''),
      coalesce(v_booking -> 'source_snapshot', '{}'::jsonb),
      nullif(v_booking ->> 'merchant_touched_at', '')::timestamptz,
      nullif(v_booking ->> 'no_show_marked_at', '')::timestamptz,
      coalesce(nullif(v_booking ->> 'created_at', '')::timestamptz, now()),
      coalesce(nullif(v_booking ->> 'updated_at', '')::timestamptz, now())
    )
    on conflict (merchant_id, id) do update
    set
      customer_id = coalesce(excluded.customer_id, merchant_bookings.customer_id),
      site_name = excluded.site_name,
      booking_block_id = excluded.booking_block_id,
      booking_viewport = excluded.booking_viewport,
      status = excluded.status,
      store = excluded.store,
      item = excluded.item,
      appointment_at_local = excluded.appointment_at_local,
      title = excluded.title,
      customer_snapshot = excluded.customer_snapshot,
      note = excluded.note,
      source_snapshot = excluded.source_snapshot,
      merchant_touched_at = excluded.merchant_touched_at,
      no_show_marked_at = excluded.no_show_marked_at,
      updated_at = excluded.updated_at
    where excluded.updated_at >= merchant_bookings.updated_at;

    if jsonb_typeof(v_mutation -> 'events') = 'array' then
      for v_event in
        select value
          from jsonb_array_elements(v_mutation -> 'events')
      loop
        if nullif(btrim(v_event ->> 'event_id'), '') is null
           or nullif(btrim(v_event ->> 'idempotency_key'), '') is null then
          raise exception 'invalid_booking_event_identity';
        end if;

        insert into public.merchant_booking_events (
          merchant_id,
          booking_id,
          event_id,
          event_type,
          actor,
          from_status,
          to_status,
          idempotency_key,
          payload,
          created_at
        )
        values (
          v_merchant_id,
          v_booking_id,
          btrim(v_event ->> 'event_id'),
          coalesce(nullif(btrim(v_event ->> 'event_type'), ''), 'legacy_booking'),
          coalesce(nullif(btrim(v_event ->> 'actor'), ''), 'system'),
          nullif(btrim(v_event ->> 'from_status'), ''),
          nullif(btrim(v_event ->> 'to_status'), ''),
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

revoke all on function public.faolla_upsert_merchant_bookings_v1(jsonb) from public;
grant execute on function public.faolla_upsert_merchant_bookings_v1(jsonb) to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202607250004, 'booking_shadow_write_rpc')
on conflict (version) do nothing;

commit;
