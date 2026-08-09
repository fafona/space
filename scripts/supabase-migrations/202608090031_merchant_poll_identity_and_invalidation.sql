-- Add stable public poll/ballot numbers, submission source tracking and
-- reversible ballot invalidation without changing immutable answer payloads.

begin;

create table if not exists public.merchant_poll_identifiers (
  poll_id text primary key check (poll_id ~ '^TP[0-9]{16}$'),
  merchant_id text not null references public.merchants(id) on delete restrict,
  sequence_date date not null,
  sequence_no smallint not null check (sequence_no between 1 and 99),
  created_at timestamptz not null default statement_timestamp(),
  constraint merchant_poll_identifiers_daily_sequence_unique
    unique (merchant_id, sequence_date, sequence_no)
);

alter table public.merchant_poll_identifiers enable row level security;

revoke all on table public.merchant_poll_identifiers from public, anon, authenticated, service_role;
grant select, insert on table public.merchant_poll_identifiers to service_role;

create table if not exists public.merchant_poll_aliases (
  merchant_id text not null references public.merchants(id) on delete restrict,
  alias_poll_id text not null check (char_length(alias_poll_id) between 1 and 96),
  poll_id text not null references public.merchant_poll_identifiers(poll_id) on delete cascade,
  created_at timestamptz not null default statement_timestamp(),
  primary key (merchant_id, alias_poll_id)
);

create index if not exists merchant_poll_aliases_poll_idx
  on public.merchant_poll_aliases(merchant_id, poll_id);

alter table public.merchant_poll_aliases enable row level security;

revoke all on table public.merchant_poll_aliases from public, anon, authenticated, service_role;
grant select, insert on table public.merchant_poll_aliases to service_role;

create or replace function public.allocate_merchant_poll_id(p_merchant_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (statement_timestamp() at time zone 'Europe/Madrid')::date;
  v_sequence integer;
  v_poll_id text;
begin
  if p_merchant_id is null or p_merchant_id !~ '^[0-9]{8}$' then
    raise exception 'invalid_merchant_id';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('merchant-poll:' || p_merchant_id || ':' || v_day::text, 0));

  select coalesce(max(sequence_no), 0) + 1
    into v_sequence
    from public.merchant_poll_identifiers
   where merchant_id = p_merchant_id
     and sequence_date = v_day;

  if v_sequence > 99 then
    raise exception 'merchant_poll_daily_sequence_exhausted';
  end if;

  v_poll_id := 'TP' || p_merchant_id || to_char(v_day, 'YYMMDD') || lpad(v_sequence::text, 2, '0');

  insert into public.merchant_poll_identifiers (
    poll_id,
    merchant_id,
    sequence_date,
    sequence_no
  ) values (
    v_poll_id,
    p_merchant_id,
    v_day,
    v_sequence
  );

  insert into public.merchant_poll_aliases (merchant_id, alias_poll_id, poll_id)
  values (p_merchant_id, v_poll_id, v_poll_id)
  on conflict (merchant_id, alias_poll_id) do nothing;

  return v_poll_id;
end;
$$;

revoke all on function public.allocate_merchant_poll_id(text) from public, anon, authenticated;
grant execute on function public.allocate_merchant_poll_id(text) to service_role;

create or replace function public.resolve_merchant_poll_id(p_merchant_id text, p_aliases text[])
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aliases text[];
  v_existing_count integer;
  v_poll_id text;
begin
  if p_merchant_id is null or p_merchant_id !~ '^[0-9]{8}$' then
    raise exception 'invalid_merchant_id';
  end if;

  select array_agg(distinct btrim(alias_value) order by btrim(alias_value))
    into v_aliases
    from unnest(coalesce(p_aliases, array[]::text[])) as alias_value
   where btrim(alias_value) <> ''
     and char_length(btrim(alias_value)) <= 96;

  if coalesce(array_length(v_aliases, 1), 0) = 0 then
    raise exception 'missing_poll_alias';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('merchant-poll-resolution:' || p_merchant_id, 0));

  select count(distinct alias.poll_id), min(alias.poll_id)
    into v_existing_count, v_poll_id
    from public.merchant_poll_aliases as alias
   where alias.merchant_id = p_merchant_id
     and alias.alias_poll_id = any(v_aliases);

  if v_existing_count > 1 then
    raise exception 'merchant_poll_alias_conflict';
  end if;

  if v_poll_id is null then
    v_poll_id := public.allocate_merchant_poll_id(p_merchant_id);
  end if;

  insert into public.merchant_poll_aliases (merchant_id, alias_poll_id, poll_id)
  select p_merchant_id, alias_value, v_poll_id
    from unnest(array_append(v_aliases, v_poll_id)) as alias_value
  on conflict (merchant_id, alias_poll_id) do nothing;

  return v_poll_id;
end;
$$;

revoke all on function public.resolve_merchant_poll_id(text, text[]) from public, anon, authenticated;
grant execute on function public.resolve_merchant_poll_id(text, text[]) to service_role;

alter table public.merchant_poll_ballots
  add column if not exists ballot_no text,
  add column if not exists source text,
  add column if not exists invalidated_at timestamptz,
  add column if not exists invalidated_by text;

alter table public.merchant_poll_ballots
  drop constraint if exists merchant_poll_ballots_source_check;

alter table public.merchant_poll_ballots
  add constraint merchant_poll_ballots_source_check
  check (source is null or source in ('pc_web', 'mobile_web', 'contact_card'));

with numbered as (
  select
    id,
    merchant_id,
    (created_at at time zone 'Europe/Madrid')::date as sequence_date,
    row_number() over (
      partition by merchant_id, (created_at at time zone 'Europe/Madrid')::date
      order by created_at, id
    ) as sequence_no
  from public.merchant_poll_ballots
  where ballot_no is null
)
update public.merchant_poll_ballots as ballot
   set ballot_no =
     'XP' || numbered.merchant_id || to_char(numbered.sequence_date, 'YYMMDD') || lpad(numbered.sequence_no::text, 5, '0')
  from numbered
 where ballot.id = numbered.id;

alter table public.merchant_poll_ballots
  alter column ballot_no set not null;

alter table public.merchant_poll_ballots
  drop constraint if exists merchant_poll_ballots_ballot_no_format_check;

alter table public.merchant_poll_ballots
  add constraint merchant_poll_ballots_ballot_no_format_check
  check (ballot_no ~ '^XP[0-9]{19}$');

create unique index if not exists merchant_poll_ballots_ballot_no_uidx
  on public.merchant_poll_ballots(ballot_no)
  where ballot_no is not null;

create index if not exists merchant_poll_ballots_active_poll_created_idx
  on public.merchant_poll_ballots(merchant_id, poll_id, created_at desc, id desc)
  where invalidated_at is null;

create or replace function public.assign_merchant_poll_ballot_no()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (coalesce(new.created_at, statement_timestamp()) at time zone 'Europe/Madrid')::date;
  v_sequence integer;
begin
  if new.ballot_no is not null and btrim(new.ballot_no) <> '' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('merchant-ballot:' || new.merchant_id || ':' || v_day::text, 0));

  select coalesce(max(right(ballot_no, 5)::integer), 0) + 1
    into v_sequence
    from public.merchant_poll_ballots
   where merchant_id = new.merchant_id
     and ballot_no like 'XP' || new.merchant_id || to_char(v_day, 'YYMMDD') || '%';

  if v_sequence > 99999 then
    raise exception 'merchant_poll_ballot_daily_sequence_exhausted';
  end if;

  new.ballot_no := 'XP' || new.merchant_id || to_char(v_day, 'YYMMDD') || lpad(v_sequence::text, 5, '0');
  return new;
end;
$$;

drop trigger if exists merchant_poll_ballots_assign_ballot_no on public.merchant_poll_ballots;
create trigger merchant_poll_ballots_assign_ballot_no
before insert on public.merchant_poll_ballots
for each row execute function public.assign_merchant_poll_ballot_no();

grant update (invalidated_at, invalidated_by) on table public.merchant_poll_ballots to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202608090031, 'merchant_poll_identity_and_invalidation')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
