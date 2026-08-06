-- Immutable merchant poll ballots. Poll definitions remain part of the
-- published page payload; this table stores concurrent public submissions.

begin;

create table if not exists public.merchant_poll_ballots (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null references public.merchants(id) on delete restrict,
  poll_id text not null check (char_length(poll_id) between 1 and 96),
  block_id text not null default '' check (char_length(block_id) <= 160),
  participant_key_hash text not null
    check (participant_key_hash ~ '^sha256:[0-9a-f]{64}$'),
  participant_type text not null check (participant_type in ('member', 'guest')),
  participant_name text not null default '' check (char_length(participant_name) <= 120),
  anonymous boolean not null default false,
  answers jsonb not null default '[]'::jsonb
    check (jsonb_typeof(answers) = 'array' and pg_column_size(answers) <= 131072),
  poll_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(poll_snapshot) = 'object' and pg_column_size(poll_snapshot) <= 131072),
  created_at timestamptz not null default statement_timestamp(),
  constraint merchant_poll_ballots_participant_unique
    unique (merchant_id, poll_id, participant_key_hash)
);

create index if not exists merchant_poll_ballots_poll_created_idx
  on public.merchant_poll_ballots(merchant_id, poll_id, created_at desc, id desc);

alter table public.merchant_poll_ballots enable row level security;

revoke all on table public.merchant_poll_ballots from public, anon, authenticated, service_role;
grant select, insert on table public.merchant_poll_ballots to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202608060027, 'merchant_poll_ballots')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
