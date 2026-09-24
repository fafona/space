begin;

-- Approved 2026-09-24: derived owner badge summary for fafona only. No order,
-- membership, history, authorization or legacy commit RPC is rewritten.
-- This lock and enrollment are in the trigger-install transaction: a writer
-- that began before enrollment must finish before capture is installed.
set local lock_timeout = '5s';
set local statement_timeout = '5s';
lock table public.pages in share row exclusive mode;

do $preflight$
begin
  if exists (select 1 from public.faolla_schema_migrations
              where version = 202609240052 and name <> 'order_attention_pilot') then
    raise exception 'order_attention_registry_conflict';
  end if;
end;
$preflight$;

create table if not exists public.faolla_order_attention_pilot (
  merchant_id text primary key check (merchant_id = '10000000'),
  schema_version integer not null default 1 check (schema_version = 1),
  epoch uuid not null default pg_catalog.gen_random_uuid(),
  generation bigint not null default 0 check (generation >= 0),
  enabled boolean not null default false,
  payload jsonb,
  projected_at timestamptz,
  check (payload is null or (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 16384))
);
alter table public.faolla_order_attention_pilot enable row level security;
-- Do not add public policies, table access, or arbitrary-merchant enrollment.
revoke all on public.faolla_order_attention_pilot from public, anon, authenticated, service_role;

insert into public.faolla_order_attention_pilot(merchant_id) values ('10000000')
on conflict (merchant_id) do update
  set epoch = pg_catalog.gen_random_uuid(),
      generation = public.faolla_order_attention_pilot.generation + 1,
      enabled = false, payload = null, projected_at = null;
-- Reapplying this migration never enables traffic or trusts a preexisting
-- projection. Enable/disable operations must also replace epoch, advance
-- generation and clear payload atomically; never reset the counter alone.

create or replace function public.faolla_invalidate_order_attention_pilot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $invalidate$
begin
  -- Capture both identities on rename/owner changes, including incorrectly
  -- scoped rows. Prefix matching also covers trailing whitespace accepted by
  -- the legacy JS slug normalizer. Non-order pages never touch the singleton.
  if (tg_op <> 'INSERT' and starts_with(old.slug, '__merchant_orders__:10000000'))
     or (tg_op <> 'DELETE' and starts_with(new.slug, '__merchant_orders__:10000000')) then
    update public.faolla_order_attention_pilot
       set generation = generation + 1, payload = null, projected_at = null
     where merchant_id = '10000000';
  end if;
  return null;
end;
$invalidate$;

create or replace function public.faolla_clear_order_attention_pilot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $clear_summary$
begin
  update public.faolla_order_attention_pilot
     set generation = generation + 1, payload = null, projected_at = null
   where merchant_id = '10000000';
  return null;
end;
$clear_summary$;

drop trigger if exists faolla_order_attention_invalidate on public.pages;
create constraint trigger faolla_order_attention_invalidate
after insert or update or delete on public.pages
deferrable initially deferred
for each row execute function public.faolla_invalidate_order_attention_pilot();
alter table public.pages enable always trigger faolla_order_attention_invalidate;

drop trigger if exists faolla_order_attention_clear on public.pages;
create trigger faolla_order_attention_clear
before truncate on public.pages
for each statement execute function public.faolla_clear_order_attention_pilot();
alter table public.pages enable always trigger faolla_order_attention_clear;

create or replace function public.faolla_order_attention_capture_ready()
returns boolean
language sql stable
security definer
set search_path = pg_catalog, public
as $capture_ready$
  select exists (select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.pages'::regclass and not tgisinternal
      and tgname = 'faolla_order_attention_invalidate' and tgenabled = 'A'
      and tgtype = 29 and tgqual is null
      and tgdeferrable and tginitdeferred and tgnargs = 0 and tgattr = ''::int2vector
      and tgfoid = 'public.faolla_invalidate_order_attention_pilot()'::regprocedure)
  and exists (select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.pages'::regclass and not tgisinternal
      and tgname = 'faolla_order_attention_clear' and tgenabled = 'A'
      and tgtype = 34 and tgqual is null
      and not tgdeferrable and not tginitdeferred and tgnargs = 0 and tgattr = ''::int2vector
      and tgfoid = 'public.faolla_clear_order_attention_pilot()'::regprocedure);
$capture_ready$;

-- STABLE supplies the calling query's ONE MVCC snapshot for both generation
-- and source rows. No source/summary row locks and no booking/V1 side effects.
-- p_source is for a service-side backfill/reconciliation, never a browser RPC.
-- Read/publish are separate transactions, never called inside a transaction
-- that writes pages: deferred invalidation has not run there until COMMIT.
-- Capture errors must not be swallowed into a committed stale projection.
-- Missing/changed capture objects disable summary reads; privileged restore,
-- trigger disable/re-enable, or object recreation requires an explicit epoch
-- reset and reconciliation before re-enabling this pilot. A current catalog
-- check cannot establish continuity across a past disabled-trigger interval.
create or replace function public.faolla_read_order_attention_v1(
  p_site_id text, p_source boolean default false
)
returns jsonb
language plpgsql stable
security definer
set search_path = pg_catalog, public
set statement_timeout = '5s'
as $read_summary$
declare
  v_state public.faolla_order_attention_pilot%rowtype;
  v_page record;
  v_rows jsonb[] := array[]::jsonb[];
  v_bytes bigint := 0;
  v_count integer := 0;
begin
  if p_site_id is distinct from '10000000' or not public.faolla_order_attention_capture_ready()
     or not exists (select 1 from public.merchants where id = p_site_id) then
    return jsonb_build_object('state', 'unavailable');
  end if;
  select * into v_state from public.faolla_order_attention_pilot where merchant_id = p_site_id;
  if not found or v_state.schema_version <> 1 then
    return jsonb_build_object('state', 'unavailable');
  end if;
  if not v_state.enabled and p_source is not true then
    return jsonb_build_object('state', 'disabled');
  end if;
  if v_state.payload is not null and p_source is not true then
    return jsonb_build_object('state', 'ready', 'epoch', v_state.epoch::text,
      'generation', v_state.generation::text, 'payload', v_state.payload);
  end if;
  for v_page in select id, merchant_id, slug, blocks, updated_at from public.pages
     where (merchant_id = p_site_id and starts_with(slug, '__merchant_orders__:10000000'))
        or slug = '__merchant_orders__:10000000'
        or starts_with(slug, '__merchant_orders__:10000000:')
     order by slug, id limit 513 loop
    v_count := v_count + 1;
    v_bytes := v_bytes + octet_length(v_page.blocks::text);
    if v_count > 512 or v_bytes > 8388608 or v_page.merchant_id is distinct from p_site_id
       or v_page.slug !~ '^__merchant_orders__:10000000(:chunk:[0-9]+)?$'
       or jsonb_typeof(v_page.blocks) is distinct from 'array' then
      return jsonb_build_object('state', 'unavailable');
    end if;
    v_rows := array_append(v_rows, to_jsonb(v_page));
  end loop;
  return jsonb_build_object('state', 'source', 'epoch', v_state.epoch::text,
    'generation', v_state.generation::text,
    'enabled', v_state.enabled, 'rows', to_jsonb(v_rows));
end;
$read_summary$;

-- A late rebuild can only publish against its exact generation. A competing
-- source writer either invalidates before this CAS (rejected) or after it in
-- its own transaction (dirty). Never lock source rows after this summary row.
create or replace function public.faolla_publish_order_attention_v1(
  p_site_id text, p_epoch uuid, p_generation text, p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set lock_timeout = '1s'
set statement_timeout = '5s'
as $publish_summary$
declare
  v_generation bigint;
  v_count numeric;
  v_latest jsonb;
begin
  if p_site_id is distinct from '10000000' or p_epoch is null or p_generation is null
     or p_generation !~ '^(0|[1-9][0-9]{0,18})$'
     or not public.faolla_order_attention_capture_ready()
     or not exists (select 1 from public.merchants where id = p_site_id) then
    return jsonb_build_object('state', 'unavailable');
  end if;
  if p_generation::numeric > 9223372036854775807 then
    return jsonb_build_object('state', 'unavailable');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or octet_length(p_payload::text) > 16384
     or jsonb_typeof(p_payload -> 'count') is distinct from 'number'
     or not (p_payload ? 'latest')
     or exists (select 1 from jsonb_object_keys(p_payload) k where k not in ('count', 'latest')) then
    raise exception 'invalid_order_attention_payload';
  end if;
  v_count := (p_payload ->> 'count')::numeric;
  v_latest := p_payload -> 'latest';
  if v_count < 0 or v_count > 1000000 or trunc(v_count) <> v_count
     or (v_count = 0 and v_latest <> 'null'::jsonb)
     or (v_count > 0 and jsonb_typeof(v_latest) <> 'object') then
    raise exception 'invalid_order_attention_payload';
  end if;
  if v_count > 0 then
    if not (v_latest ?& array['key', 'title', 'body', 'url', 'createdAt'])
       or exists (select 1 from jsonb_object_keys(v_latest) k
                   where k not in ('key', 'title', 'body', 'url', 'createdAt'))
       or exists (select 1 from jsonb_each(v_latest) x where jsonb_typeof(x.value) <> 'string')
       or not starts_with(v_latest ->> 'key', 'order:')
       or v_latest ->> 'url' is distinct from '/10000000?mobileTab=business&businessSection=orders&appShell=faolla' then
      raise exception 'invalid_order_attention_payload';
    end if;
  end if;
  update public.faolla_order_attention_pilot set payload = p_payload, projected_at = clock_timestamp()
    where merchant_id = p_site_id and epoch = p_epoch and schema_version = 1
      and generation = p_generation::bigint and payload is null
    returning generation into v_generation;
  if not found then return jsonb_build_object('state', 'conflict'); end if;
  return jsonb_build_object('state', 'published', 'epoch', p_epoch::text, 'generation', v_generation::text);
end;
$publish_summary$;

-- Remove unexpected inherited default grants as well as known browser roles.
do $private_acl$
declare
  v_function regprocedure;
  v_grantee record;
begin
  for v_grantee in select distinct acl.grantee, r.rolname
    from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) acl
    left join pg_catalog.pg_roles r on r.oid = acl.grantee
    where c.oid = 'public.faolla_order_attention_pilot'::regclass and acl.grantee <> c.relowner
  loop
    execute format('revoke all on public.faolla_order_attention_pilot from %s cascade',
      case when v_grantee.grantee = 0 then 'public' else quote_ident(v_grantee.rolname) end);
  end loop;
  -- Table REVOKE alone leaves separately granted column privileges intact on
  -- a replay. Remove only this derived table's non-owner column grants too.
  for v_grantee in select distinct a.attname, acl.grantee, r.rolname
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    cross join lateral pg_catalog.aclexplode(a.attacl) acl
    left join pg_catalog.pg_roles r on r.oid = acl.grantee
    where c.oid = 'public.faolla_order_attention_pilot'::regclass
      and a.attnum > 0 and not a.attisdropped and acl.grantee <> c.relowner
  loop
    execute format('revoke select (%1$I), insert (%1$I), update (%1$I), references (%1$I) on public.faolla_order_attention_pilot from %2$s cascade',
      v_grantee.attname,
      case when v_grantee.grantee = 0 then 'public' else quote_ident(v_grantee.rolname) end);
  end loop;
  foreach v_function in array array[
    'public.faolla_invalidate_order_attention_pilot()'::regprocedure,
    'public.faolla_clear_order_attention_pilot()'::regprocedure,
    'public.faolla_order_attention_capture_ready()'::regprocedure,
    'public.faolla_read_order_attention_v1(text,boolean)'::regprocedure,
    'public.faolla_publish_order_attention_v1(text,uuid,text,jsonb)'::regprocedure
  ] loop
    for v_grantee in select distinct acl.grantee, r.rolname
      from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
      left join pg_catalog.pg_roles r on r.oid = acl.grantee
      where p.oid = v_function and acl.grantee <> p.proowner
    loop
      execute format('revoke all on function %s from %s cascade', v_function,
        case when v_grantee.grantee = 0 then 'public' else quote_ident(v_grantee.rolname) end);
    end loop;
  end loop;
end;
$private_acl$;

grant execute on function public.faolla_read_order_attention_v1(text,boolean) to service_role;
grant execute on function public.faolla_publish_order_attention_v1(text,uuid,text,jsonb) to service_role;

insert into public.faolla_schema_migrations(version, name)
values (202609240052, 'order_attention_pilot') on conflict (version) do nothing;
notify pgrst, 'reload schema';
commit;
