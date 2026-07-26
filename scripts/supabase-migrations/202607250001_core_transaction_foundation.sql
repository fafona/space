-- Core transaction foundation.
-- This migration is additive: it does not change any existing application read
-- or write path and does not remove data from public.pages.

begin;

create extension if not exists pgcrypto;

create table if not exists public.faolla_schema_migrations (
  version bigint primary key,
  name text not null,
  applied_at timestamptz not null default now()
);

create or replace function public.faolla_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.faolla_touch_versioned_row()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  new.version = old.version + 1;
  return new;
end;
$$;

create or replace function public.faolla_is_merchant_owner(target_merchant_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.merchants merchant
    where merchant.id = target_merchant_id
      and (
        (
          auth.uid() is not null
          and (
            merchant.id = auth.uid()::text
            or merchant.user_id = auth.uid()
            or merchant.auth_user_id = auth.uid()
            or merchant.owner_user_id = auth.uid()
            or merchant.owner_id = auth.uid()
            or merchant.auth_id = auth.uid()
            or merchant.created_by = auth.uid()
            or merchant.created_by_user_id = auth.uid()
          )
        )
        or (
          nullif(lower(coalesce(auth.jwt()->>'email', '')), '') is not null
          and (
            lower(coalesce(merchant.email, '')) = lower(coalesce(auth.jwt()->>'email', ''))
            or lower(coalesce(merchant.owner_email, '')) = lower(coalesce(auth.jwt()->>'email', ''))
            or lower(coalesce(merchant.contact_email, '')) = lower(coalesce(auth.jwt()->>'email', ''))
            or lower(coalesce(merchant.user_email, '')) = lower(coalesce(auth.jwt()->>'email', ''))
          )
        )
      )
  );
$$;

revoke all on function public.faolla_is_merchant_owner(text) from public;
grant execute on function public.faolla_is_merchant_owner(text) to authenticated;

create table if not exists public.merchant_customers (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null references public.merchants(id) on delete restrict,
  legacy_membership_id text null,
  member_no text null,
  account_id text null,
  auth_user_id text null,
  guest_hash text null,
  email text null,
  phone text null,
  display_name text not null default '',
  status text not null default 'active'
    check (status in ('active', 'merged', 'archived')),
  merged_into_id uuid null,
  profile jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchant_customers_merchant_id_id_unique unique (merchant_id, id),
  constraint merchant_customers_merged_into_fk
    foreign key (merchant_id, merged_into_id)
    references public.merchant_customers(merchant_id, id)
    on delete restrict,
  constraint merchant_customers_not_self_merged
    check (merged_into_id is null or merged_into_id <> id)
);

create index if not exists merchant_customers_merchant_updated_idx
  on public.merchant_customers(merchant_id, updated_at desc);
create index if not exists merchant_customers_account_idx
  on public.merchant_customers(merchant_id, account_id)
  where account_id is not null;
create index if not exists merchant_customers_auth_user_idx
  on public.merchant_customers(merchant_id, auth_user_id)
  where auth_user_id is not null;
create index if not exists merchant_customers_email_idx
  on public.merchant_customers(merchant_id, lower(email))
  where email is not null;
create index if not exists merchant_customers_phone_idx
  on public.merchant_customers(merchant_id, phone)
  where phone is not null;

create table if not exists public.merchant_orders (
  merchant_id text not null references public.merchants(id) on delete restrict,
  id text not null,
  customer_id uuid null,
  site_name text not null default '',
  block_id text not null default '',
  client_request_id text null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'completed', 'cancelled')),
  currency char(3) not null default 'EUR',
  price_prefix text not null default '€',
  total_quantity integer not null default 0 check (total_quantity >= 0),
  total_amount_minor bigint not null default 0 check (total_amount_minor >= 0),
  customer_snapshot jsonb not null default '{}'::jsonb,
  source_snapshot jsonb not null default '{}'::jsonb,
  confirmed_at timestamptz null,
  completed_at timestamptz null,
  cancelled_at timestamptz null,
  printed_at timestamptz null,
  print_count integer not null default 0 check (print_count >= 0),
  merchant_touched_at timestamptz null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (merchant_id, id),
  constraint merchant_orders_customer_fk
    foreign key (merchant_id, customer_id)
    references public.merchant_customers(merchant_id, id)
    on delete restrict
);

create unique index if not exists merchant_orders_client_request_unique_idx
  on public.merchant_orders(merchant_id, client_request_id)
  where client_request_id is not null and client_request_id <> '';
create index if not exists merchant_orders_status_created_idx
  on public.merchant_orders(merchant_id, status, created_at desc);
create index if not exists merchant_orders_customer_created_idx
  on public.merchant_orders(merchant_id, customer_id, created_at desc)
  where customer_id is not null;
create index if not exists merchant_orders_updated_idx
  on public.merchant_orders(merchant_id, updated_at desc);

create table if not exists public.merchant_order_items (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null,
  order_id text not null,
  line_number smallint not null check (line_number > 0),
  product_id text not null default '',
  code text not null default '',
  name text not null default '',
  description text not null default '',
  image_url text not null default '',
  tag text not null default '',
  quantity integer not null check (quantity > 0),
  unit_amount_minor bigint not null check (unit_amount_minor >= 0),
  subtotal_amount_minor bigint not null check (subtotal_amount_minor >= 0),
  unit_price_text text not null default '',
  source_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchant_order_items_order_fk
    foreign key (merchant_id, order_id)
    references public.merchant_orders(merchant_id, id)
    on delete cascade,
  constraint merchant_order_items_line_unique
    unique (merchant_id, order_id, line_number)
);

create index if not exists merchant_order_items_product_idx
  on public.merchant_order_items(merchant_id, product_id)
  where product_id <> '';

create table if not exists public.merchant_order_events (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null,
  order_id text not null,
  event_type text not null,
  from_status text null,
  to_status text null,
  actor_id text not null default '',
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint merchant_order_events_order_fk
    foreign key (merchant_id, order_id)
    references public.merchant_orders(merchant_id, id)
    on delete cascade,
  constraint merchant_order_events_idempotency_unique
    unique (merchant_id, idempotency_key)
);

create index if not exists merchant_order_events_order_created_idx
  on public.merchant_order_events(merchant_id, order_id, created_at desc);

create table if not exists public.merchant_account_ledger (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null references public.merchants(id) on delete restrict,
  customer_id uuid null,
  account_type text not null
    check (account_type in ('stored_value', 'points', 'growth')),
  delta bigint not null check (delta <> 0),
  balance_after bigint null check (balance_after is null or balance_after >= 0),
  currency char(3) null,
  entry_type text not null,
  reference_type text not null default '',
  reference_id text not null default '',
  idempotency_key text not null,
  reverses_entry_id uuid null,
  actor_id text not null default '',
  note text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint merchant_account_ledger_merchant_id_id_unique unique (merchant_id, id),
  constraint merchant_account_ledger_customer_fk
    foreign key (merchant_id, customer_id)
    references public.merchant_customers(merchant_id, id)
    on delete restrict,
  constraint merchant_account_ledger_reversal_fk
    foreign key (merchant_id, reverses_entry_id)
    references public.merchant_account_ledger(merchant_id, id)
    on delete restrict,
  constraint merchant_account_ledger_idempotency_unique
    unique (merchant_id, idempotency_key),
  constraint merchant_account_ledger_currency_check
    check (
      (account_type = 'stored_value' and currency is not null)
      or (account_type <> 'stored_value' and currency is null)
    )
);

create index if not exists merchant_account_ledger_customer_created_idx
  on public.merchant_account_ledger(merchant_id, customer_id, created_at desc)
  where customer_id is not null;
create index if not exists merchant_account_ledger_reference_idx
  on public.merchant_account_ledger(merchant_id, reference_type, reference_id)
  where reference_id <> '';

create table if not exists public.merchant_idempotency_keys (
  merchant_id text not null references public.merchants(id) on delete restrict,
  idempotency_key text not null,
  operation text not null,
  request_hash text not null,
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'failed')),
  response_status integer null,
  response_body jsonb null,
  locked_until timestamptz null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (merchant_id, idempotency_key)
);

create index if not exists merchant_idempotency_expiry_idx
  on public.merchant_idempotency_keys(expires_at);

create table if not exists public.merchant_outbox_events (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null references public.merchants(id) on delete restrict,
  event_key text not null,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz null,
  locked_by text null,
  completed_at timestamptz null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchant_outbox_events_event_key_unique
    unique (merchant_id, event_key)
);

create index if not exists merchant_outbox_events_pending_idx
  on public.merchant_outbox_events(status, available_at, created_at)
  where status in ('pending', 'failed');

drop trigger if exists merchant_customers_touch_version on public.merchant_customers;
create trigger merchant_customers_touch_version
before update on public.merchant_customers
for each row
execute function public.faolla_touch_versioned_row();

drop trigger if exists merchant_orders_touch_version on public.merchant_orders;
create trigger merchant_orders_touch_version
before update on public.merchant_orders
for each row
execute function public.faolla_touch_versioned_row();

drop trigger if exists merchant_order_items_touch_updated_at on public.merchant_order_items;
create trigger merchant_order_items_touch_updated_at
before update on public.merchant_order_items
for each row
execute function public.faolla_touch_updated_at();

drop trigger if exists merchant_idempotency_touch_updated_at on public.merchant_idempotency_keys;
create trigger merchant_idempotency_touch_updated_at
before update on public.merchant_idempotency_keys
for each row
execute function public.faolla_touch_updated_at();

drop trigger if exists merchant_outbox_touch_updated_at on public.merchant_outbox_events;
create trigger merchant_outbox_touch_updated_at
before update on public.merchant_outbox_events
for each row
execute function public.faolla_touch_updated_at();

alter table public.faolla_schema_migrations enable row level security;
alter table public.merchant_customers enable row level security;
alter table public.merchant_orders enable row level security;
alter table public.merchant_order_items enable row level security;
alter table public.merchant_order_events enable row level security;
alter table public.merchant_account_ledger enable row level security;
alter table public.merchant_idempotency_keys enable row level security;
alter table public.merchant_outbox_events enable row level security;

grant select on public.merchant_customers to authenticated;
grant select on public.merchant_orders to authenticated;
grant select on public.merchant_order_items to authenticated;
grant select on public.merchant_order_events to authenticated;
grant select on public.merchant_account_ledger to authenticated;

drop policy if exists merchant_customers_owner_read on public.merchant_customers;
create policy merchant_customers_owner_read on public.merchant_customers
for select to authenticated
using (public.faolla_is_merchant_owner(merchant_id));

drop policy if exists merchant_orders_owner_read on public.merchant_orders;
create policy merchant_orders_owner_read on public.merchant_orders
for select to authenticated
using (public.faolla_is_merchant_owner(merchant_id));

drop policy if exists merchant_order_items_owner_read on public.merchant_order_items;
create policy merchant_order_items_owner_read on public.merchant_order_items
for select to authenticated
using (public.faolla_is_merchant_owner(merchant_id));

drop policy if exists merchant_order_events_owner_read on public.merchant_order_events;
create policy merchant_order_events_owner_read on public.merchant_order_events
for select to authenticated
using (public.faolla_is_merchant_owner(merchant_id));

drop policy if exists merchant_account_ledger_owner_read on public.merchant_account_ledger;
create policy merchant_account_ledger_owner_read on public.merchant_account_ledger
for select to authenticated
using (public.faolla_is_merchant_owner(merchant_id));

insert into public.faolla_schema_migrations (version, name)
values (202607250001, 'core_transaction_foundation')
on conflict (version) do nothing;

commit;
