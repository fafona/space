-- Attendance foundation only. No existing employee/configuration backfill.
-- No runtime write grants or public clock API until atomic authorization,
-- idempotency and policy enforcement are implemented and verified.
begin;

create or replace function public.faolla_attendance_valid_zone_v1(p_zone text)
returns boolean language sql stable set search_path = pg_catalog as $$
  select p_zone is not null and char_length(p_zone) <= 100
    and (p_zone = 'UTC' or p_zone ~ '^[A-Za-z_+-]+(/[A-Za-z0-9_+-]+)+$')
    and exists (select 1 from pg_catalog.pg_timezone_names where name = p_zone);
$$;
revoke all on function public.faolla_attendance_valid_zone_v1(text) from public, anon, authenticated, service_role;

create table if not exists public.merchant_attendance_settings (
  merchant_id text primary key references public.merchants(id) on delete restrict,
  enabled boolean not null default false,
  time_zone text not null check (public.faolla_attendance_valid_zone_v1(time_zone)),
  version bigint not null default 1 check (version between 1 and 9007199254740991),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.merchant_attendance_locations (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null references public.merchant_attendance_settings(merchant_id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  time_zone text not null check (public.faolla_attendance_valid_zone_v1(time_zone)),
  active boolean not null default false,
  latitude double precision null,
  longitude double precision null,
  radius_meters double precision null,
  version bigint not null default 1 check (version between 1 and 9007199254740991),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_id, id),
  constraint merchant_attendance_location_fence_check check (
    (latitude is null and longitude is null and radius_meters is null)
    or (latitude is not null and longitude is not null and radius_meters is not null
      and latitude between -90 and 90 and longitude between -180 and 180
      and radius_meters between 1 and 100000)
  )
);

create table if not exists public.merchant_attendance_workers (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null references public.merchant_attendance_settings(merchant_id) on delete restrict,
  employee_id uuid null,
  worker_no text not null check (char_length(btrim(worker_no)) between 1 and 40),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  active boolean not null default false,
  default_location_id uuid null,
  version bigint not null default 1 check (version between 1 and 9007199254740991),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_id, id),
  foreign key (merchant_id, employee_id)
    references public.merchant_enterprise_employees(merchant_id, id) on delete restrict,
  foreign key (merchant_id, default_location_id)
    references public.merchant_attendance_locations(merchant_id, id) on delete restrict
);
create unique index if not exists merchant_attendance_worker_number_unique_idx
  on public.merchant_attendance_workers(merchant_id, lower(btrim(worker_no)));
create unique index if not exists merchant_attendance_worker_employee_unique_idx
  on public.merchant_attendance_workers(merchant_id, employee_id) where employee_id is not null;

create table if not exists public.merchant_attendance_employment_periods (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null,
  worker_id uuid not null,
  starts_on date not null check (starts_on between date '2000-01-01' and date '2100-12-31'),
  ends_on date null check (ends_on between date '2000-01-01' and date '2100-12-31'),
  created_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on),
  unique (merchant_id, worker_id, starts_on),
  foreign key (merchant_id, worker_id)
    references public.merchant_attendance_workers(merchant_id, id) on delete restrict
);
create unique index if not exists merchant_attendance_employment_open_unique_idx
  on public.merchant_attendance_employment_periods(merchant_id, worker_id) where ends_on is null;

create table if not exists public.merchant_attendance_events (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null,
  worker_id uuid not null,
  location_id uuid not null,
  operation_id uuid not null,
  sequence bigint not null check (sequence between 1 and 9007199254740991),
  action text not null check (action in ('clock_in', 'break_start', 'break_end', 'clock_out')),
  source text not null check (source in ('web', 'kiosk')),
  break_paid boolean null,
  occurred_at timestamptz not null default clock_timestamp() check (isfinite(occurred_at)),
  received_at timestamptz not null default clock_timestamp() check (isfinite(received_at)),
  time_zone text not null check (public.faolla_attendance_valid_zone_v1(time_zone)),
  constraint merchant_attendance_event_break_check check (
    (action = 'break_start' and break_paid is not null) or (action <> 'break_start' and break_paid is null)
  ),
  unique (merchant_id, worker_id, operation_id),
  unique (merchant_id, worker_id, sequence),
  foreign key (merchant_id, worker_id)
    references public.merchant_attendance_workers(merchant_id, id) on delete restrict,
  foreign key (merchant_id, location_id)
    references public.merchant_attendance_locations(merchant_id, id) on delete restrict
);
create index if not exists merchant_attendance_events_worker_time_idx
  on public.merchant_attendance_events(merchant_id, worker_id, occurred_at desc, id desc);
create index if not exists merchant_attendance_events_merchant_time_idx
  on public.merchant_attendance_events(merchant_id, occurred_at desc, id desc);

create or replace function public.faolla_attendance_events_append_only_v1()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  raise exception using errcode = '42501', message = 'attendance_events_append_only';
end;
$$;
revoke all on function public.faolla_attendance_events_append_only_v1() from public, anon, authenticated, service_role;

drop trigger if exists merchant_attendance_events_no_rewrite on public.merchant_attendance_events;
create trigger merchant_attendance_events_no_rewrite
before update or delete on public.merchant_attendance_events
for each row execute function public.faolla_attendance_events_append_only_v1();
drop trigger if exists merchant_attendance_events_no_truncate on public.merchant_attendance_events;
create trigger merchant_attendance_events_no_truncate
before truncate on public.merchant_attendance_events
for each statement execute function public.faolla_attendance_events_append_only_v1();

alter table public.merchant_attendance_settings enable row level security;
alter table public.merchant_attendance_locations enable row level security;
alter table public.merchant_attendance_workers enable row level security;
alter table public.merchant_attendance_employment_periods enable row level security;
alter table public.merchant_attendance_events enable row level security;

revoke all on public.merchant_attendance_settings from public, anon, authenticated, service_role;
revoke all on public.merchant_attendance_locations from public, anon, authenticated, service_role;
revoke all on public.merchant_attendance_workers from public, anon, authenticated, service_role;
revoke all on public.merchant_attendance_employment_periods from public, anon, authenticated, service_role;
revoke all on public.merchant_attendance_events from public, anon, authenticated, service_role;
grant select on public.merchant_attendance_settings to service_role;
grant select on public.merchant_attendance_locations to service_role;
grant select on public.merchant_attendance_workers to service_role;
grant select on public.merchant_attendance_employment_periods to service_role;
grant select on public.merchant_attendance_events to service_role;

comment on table public.merchant_attendance_events is
  'Original attendance facts. No runtime write path in foundation. Corrections must be append-only; lawful retention/erasure requires a separately authorized process.';

insert into public.faolla_schema_migrations (version, name)
values (202609290061, 'merchant_attendance_foundation')
on conflict (version) do nothing;

commit;
