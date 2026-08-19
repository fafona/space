\set ON_ERROR_STOP on

-- Minimal Supabase-owned objects needed by supabase-init.sql. This fixture is
-- intentionally local to the disposable integration database; it never
-- connects to, copies, or mutates a real Supabase project.
create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    create role supabase_admin login noinherit superuser createdb createrole
      replication bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit nobypassrls;
  end if;
  if not exists (
    select 1 from pg_roles where rolname = 'supabase_storage_admin'
  ) then
    create role supabase_storage_admin nologin noinherit nobypassrls;
  end if;
  if not exists (
    select 1 from pg_roles where rolname = 'cli_login_postgres'
  ) then
    create role cli_login_postgres login noinherit nobypassrls;
  end if;
end
$$;

alter role anon nologin inherit nobypassrls;
alter role authenticated nologin inherit nobypassrls;
alter role service_role nologin inherit bypassrls;
alter role supabase_admin login noinherit superuser createdb createrole
  replication bypassrls;
alter role authenticator login noinherit nosuperuser nocreatedb nocreaterole
  noreplication nobypassrls;
alter role supabase_storage_admin nologin noinherit nosuperuser nocreatedb
  nocreaterole noreplication nobypassrls;
alter role cli_login_postgres login noinherit nosuperuser nocreatedb
  nocreaterole noreplication nobypassrls;
grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres;
grant authenticator to supabase_storage_admin;
set role supabase_admin;
grant postgres to cli_login_postgres;
reset role;
grant usage on schema public to anon, authenticated, service_role;

-- Mirror the hosted Supabase function defaults that exposed historical RPCs
-- to API roles even when their migrations only revoked PUBLIC. The 039
-- acceptance must prove it removes these direct legacy grants and also
-- normalizes the creators' global (all-schema) future defaults.
alter default privileges for role postgres
  grant execute on functions to public, anon, authenticated, service_role;
alter default privileges for role supabase_admin
  grant execute on functions to public, anon, authenticated, service_role;

create schema if not exists auth;
create schema if not exists storage;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    jsonb_strip_nulls(jsonb_build_object(
      'sub', nullif(current_setting('request.jwt.claim.sub', true), ''),
      'email', nullif(current_setting('request.jwt.claim.email', true), '')
    )),
    '{}'::jsonb
  )
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key,
  name text not null unique,
  public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id) on delete cascade,
  name text not null default '',
  owner uuid null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;
