begin;

-- PREPARATION ONLY. Installation leaves active=false; no booking data is copied,
-- repaired, or converted. There is deliberately no activation RPC.
-- Before any future activation: adapt EVERY booking/config writer and reader,
-- drain old automation (it can send mail BEFORE a rejected write), reconcile
-- local JSON caches, and prove a compatible rollback. An environment flag alone
-- must never activate this protocol. Existing business validation stays in the
-- application and must be repeated against each freshly read snapshot.
do $registry$
begin
  if exists (select 1 from public.faolla_schema_migrations
              where version = 202610250211 and name <> 'booking_atomic_preparation') then
    raise exception 'booking_atomic_registry_conflict';
  end if;
end;
$registry$;

create table public.faolla_booking_atomic_control (
  singleton boolean primary key default true check (singleton),
  generation uuid not null default gen_random_uuid(),
  revision bigint not null default 0 check (revision >= 0),
  active boolean not null default false
);
insert into public.faolla_booking_atomic_control(singleton) values (true);

create table public.faolla_booking_atomic_commands (
  site_id text not null check (site_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  command_key text not null check (command_key ~ '^[0-9a-f]{64}$'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  generation uuid not null,
  revision bigint not null,
  result jsonb not null check (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 131072),
  created_at timestamptz not null default clock_timestamp(),
  primary key (site_id, command_key)
);

-- Private queue, NOT the owner-visible generic outbox. Never store an editToken,
-- credential, or bearer manage URL in a mail intent. No dispatcher is activated.
create table public.faolla_booking_mail_jobs (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  command_key text not null,
  ordinal integer not null check (ordinal between 0 and 99),
  booking_id text not null,
  kind text not null check (kind in ('status', 'reminder', 'manual')),
  message jsonb not null,
  state text not null default 'pending' check (state in ('pending', 'dispatching', 'sent', 'failed', 'unconfirmed')),
  lease_id uuid,
  lease_until timestamptz,
  provider_receipt text,
  created_at timestamptz not null default clock_timestamp(),
  settled_at timestamptz,
  unique (site_id, command_key, ordinal),
  foreign key (site_id, command_key) references public.faolla_booking_atomic_commands(site_id, command_key)
);
create index faolla_booking_mail_pending on public.faolla_booking_mail_jobs(created_at, id) where state = 'pending';

alter table public.faolla_booking_atomic_control enable row level security;
alter table public.faolla_booking_atomic_commands enable row level security;
alter table public.faolla_booking_mail_jobs enable row level security;
revoke all on public.faolla_booking_atomic_control, public.faolla_booking_atomic_commands,
  public.faolla_booking_mail_jobs from public, anon, authenticated, service_role;

create function public.faolla_booking_atomic_pages_guard_v1()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $guard$
declare
  v_protected boolean := false;
begin
  if tg_op = 'TRUNCATE' then
    v_protected := true;
  else
    -- OLD and NEW: changing the slug/tenant must not bypass the fence.
    if tg_op in ('UPDATE', 'DELETE') then
      v_protected := old.slug = any(array[
        '__merchant_booking_records__:v1', '__merchant_booking_records__:v1:backup',
        '__merchant_booking_rules__:v1', '__merchant_booking_rules__:v1:backup',
        '__merchant_booking_workbench__:v1', '__merchant_booking_workbench__:v1:backup']);
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
      v_protected := v_protected or new.slug = any(array[
        '__merchant_booking_records__:v1', '__merchant_booking_records__:v1:backup',
        '__merchant_booking_rules__:v1', '__merchant_booking_rules__:v1:backup',
        '__merchant_booking_workbench__:v1', '__merchant_booking_workbench__:v1:backup']);
    end if;
  end if;
  if v_protected and exists (select 1 from public.faolla_booking_atomic_control where active)
     and current_setting('faolla.booking_atomic_write', true) is distinct from 'v1' then
    raise exception 'booking_atomic_legacy_writer_fenced';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'TRUNCATE' then return null; end if;
  return new;
end;
$guard$;
create trigger faolla_booking_atomic_pages_guard_v1 before insert or update or delete on public.pages
for each row execute function public.faolla_booking_atomic_pages_guard_v1();
create trigger faolla_booking_atomic_pages_clear_guard_v1 before truncate on public.pages
for each statement execute function public.faolla_booking_atomic_pages_guard_v1();

-- Internal helper. Ambiguous/legacy schemas fail closed instead of guessing a
-- primary or auto-restoring an unversioned local/backup copy.
create function public.faolla_booking_atomic_rows_v1()
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $rows$
declare
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id', id::text, 'slug', slug,
      'blocks', blocks, 'updated_at', updated_at) order by slug, id), '[]'::jsonb)
    into v_rows from public.pages where slug = any(array[
      '__merchant_booking_records__:v1', '__merchant_booking_records__:v1:backup',
      '__merchant_booking_rules__:v1', '__merchant_booking_rules__:v1:backup',
      '__merchant_booking_workbench__:v1', '__merchant_booking_workbench__:v1:backup']);
  if exists (select 1 from public.pages where slug = any(array[
        '__merchant_booking_records__:v1', '__merchant_booking_records__:v1:backup',
        '__merchant_booking_rules__:v1', '__merchant_booking_rules__:v1:backup',
        '__merchant_booking_workbench__:v1', '__merchant_booking_workbench__:v1:backup'])
        and merchant_id is distinct from '__faolla_booking_persistence__')
     or exists (select 1 from jsonb_array_elements(v_rows) r group by r->>'slug' having count(*) > 1) then
    raise exception 'booking_atomic_store_ambiguous';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_rows) r where r->>'slug' = '__merchant_booking_records__:v1') then
    raise exception 'booking_atomic_primary_required';
  end if;
  if exists (select 1 from jsonb_array_elements(v_rows) r
       where r->>'slug' = '__merchant_booking_records__:v1'
         and (jsonb_typeof(r#>'{blocks,records}') is distinct from 'array' or r#>'{blocks,version}' is distinct from '1'::jsonb)) then
    raise exception 'booking_atomic_store_corrupt';
  end if;
  return v_rows;
end;
$rows$;

create function public.faolla_booking_atomic_snapshot_v1(p_site_id text, p_command_key text, p_request_hash text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $snapshot$
declare
  v_control public.faolla_booking_atomic_control%rowtype;
  v_command public.faolla_booking_atomic_commands%rowtype;
begin
  if p_site_id is null or p_site_id !~ '^[A-Za-z0-9_-]{1,64}$'
     or p_command_key is null or p_command_key !~ '^[0-9a-f]{64}$'
     or p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'booking_atomic_invalid_command';
  end if;
  -- Serialize reads with commits: revision and all dependency rows agree.
  select * into strict v_control from public.faolla_booking_atomic_control for update;
  if not v_control.active then raise exception 'booking_atomic_inactive'; end if;
  select * into v_command from public.faolla_booking_atomic_commands
    where site_id = p_site_id and command_key = p_command_key;
  if found then
    if v_command.request_hash <> p_request_hash then raise exception 'booking_atomic_key_reused'; end if;
    return jsonb_build_object('replayed', true, 'result', v_command.result);
  end if;
  return jsonb_build_object('replayed', false, 'generation', v_control.generation,
    'revision', v_control.revision::text, 'rows', public.faolla_booking_atomic_rows_v1());
end;
$snapshot$;

create function public.faolla_booking_atomic_commit_v1(p_site_id text, p_command_key text, p_request_hash text, p_mutation jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $commit_booking$
declare
  v_control public.faolla_booking_atomic_control%rowtype;
  v_command public.faolla_booking_atomic_commands%rowtype;
  v_rows jsonb;
  v_before jsonb;
  v_next jsonb;
  v_record jsonb;
  v_previous jsonb;
  v_job jsonb;
  v_ordinal integer := 0;
  v_page public.pages%rowtype;
  v_backup public.pages%rowtype;
  v_capability text := current_setting('faolla.booking_atomic_write', true);
begin
  if p_site_id is null or p_site_id !~ '^[A-Za-z0-9_-]{1,64}$'
     or p_command_key is null or p_command_key !~ '^[0-9a-f]{64}$'
     or p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'booking_atomic_invalid_command';
  end if;
  select * into strict v_control from public.faolla_booking_atomic_control for update;
  if not v_control.active then raise exception 'booking_atomic_inactive'; end if;
  select * into v_command from public.faolla_booking_atomic_commands
    where site_id = p_site_id and command_key = p_command_key;
  if found then
    if v_command.request_hash <> p_request_hash then raise exception 'booking_atomic_key_reused'; end if;
    return jsonb_build_object('replayed', true, 'result', v_command.result);
  end if;
  if jsonb_typeof(p_mutation) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_mutation) k where k not in ('generation', 'revision', 'rows', 'next', 'result', 'mailJobs'))
     or jsonb_typeof(p_mutation->'rows') is distinct from 'array'
     or jsonb_typeof(p_mutation->'result') is distinct from 'object'
     or jsonb_typeof(p_mutation->'mailJobs') is distinct from 'array'
     or jsonb_array_length(p_mutation->'mailJobs') > 100
     or p_mutation#>'{next,version}' is distinct from '1'::jsonb
     or jsonb_typeof(p_mutation#>'{next,records}') is distinct from 'array'
     or exists (select 1 from jsonb_object_keys(p_mutation->'next') k where k not in ('version', 'records')) then
    raise exception 'booking_atomic_invalid_mutation';
  end if;
  v_rows := public.faolla_booking_atomic_rows_v1();
  if p_mutation->>'generation' is distinct from v_control.generation::text
     or p_mutation->>'revision' is distinct from v_control.revision::text
     or p_mutation->'rows' is distinct from v_rows then
    raise exception 'booking_atomic_conflict';
  end if;
  select r#>'{blocks,records}' into v_before from jsonb_array_elements(v_rows) r
    where r->>'slug' = '__merchant_booking_records__:v1';
  v_next := p_mutation#>'{next,records}';
  if exists (select 1 from jsonb_array_elements(v_before || v_next) r
       where jsonb_typeof(r) is distinct from 'object'
          or jsonb_typeof(r->'id') is distinct from 'string' or length(r->>'id') not between 1 and 160
          or btrim(r->>'id') is distinct from r->>'id' or btrim(r->>'id') = ''
          or jsonb_typeof(r->'siteId') is distinct from 'string' or (r->>'siteId') !~ '^[A-Za-z0-9_-]{1,64}$')
     or exists (select 1 from jsonb_array_elements(v_before) r group by r->>'id' having count(*) > 1)
     or exists (select 1 from jsonb_array_elements(v_next) r group by r->>'id' having count(*) > 1) then
    raise exception 'booking_atomic_invalid_records';
  end if;
  -- No deletes, cross-tenant mutations, identity/token transfer, or rewrites of
  -- creation timestamps. Foreign tenant records must remain byte-for-byte JSONB.
  for v_previous in select value from jsonb_array_elements(v_before) loop
    select value into v_record from jsonb_array_elements(v_next) r where r->>'id' = v_previous->>'id';
    if not found or v_record->'siteId' is distinct from v_previous->'siteId'
       or v_record->'createdAt' is distinct from v_previous->'createdAt'
       or v_record->'editToken' is distinct from v_previous->'editToken'
       or (v_previous->>'siteId' <> p_site_id and v_record is distinct from v_previous) then
      raise exception 'booking_atomic_scope_violation';
    end if;
  end loop;
  for v_record in select value from jsonb_array_elements(v_next) loop
    if v_record->>'siteId' = p_site_id
       and coalesce(v_record->>'status', '') not in ('active', 'confirmed', 'completed', 'no_show', 'cancelled') then
      raise exception 'booking_atomic_invalid_records';
    end if;
    if not exists (select 1 from jsonb_array_elements(v_before) r where r->>'id' = v_record->>'id')
       and (v_record->>'siteId' <> p_site_id
         or jsonb_typeof(v_record->'createdAt') is distinct from 'string'
         or length(v_record->>'createdAt') not between 1 and 128
         or jsonb_typeof(v_record->'editToken') is distinct from 'string'
         or length(v_record->>'editToken') not between 32 and 256) then
      raise exception 'booking_atomic_scope_violation';
    end if;
  end loop;
  insert into public.faolla_booking_atomic_commands(site_id, command_key, request_hash, generation, revision, result)
    values (p_site_id, p_command_key, p_request_hash, v_control.generation, v_control.revision + 1, p_mutation->'result');
  -- Late validation is intentional too: any bad intent rolls the ENTIRE command
  -- back, including the ledger and canonical pages write.
  perform set_config('faolla.booking_atomic_write', 'v1', true);
  select * into strict v_page from public.pages where slug = '__merchant_booking_records__:v1' for update;
  select * into v_backup from public.pages where slug = '__merchant_booking_records__:v1:backup' for update;
  if found then
    update public.pages set blocks = v_page.blocks, updated_at = clock_timestamp() where id = v_backup.id;
  else
    insert into public.pages(merchant_id, slug, blocks, updated_at)
      values ('__faolla_booking_persistence__', '__merchant_booking_records__:v1:backup', v_page.blocks, clock_timestamp());
  end if;
  update public.pages set blocks = p_mutation->'next', updated_at = clock_timestamp() where id = v_page.id;
  perform set_config('faolla.booking_atomic_write', coalesce(v_capability, ''), true);
  for v_job in select value from jsonb_array_elements(p_mutation->'mailJobs') loop
    if jsonb_typeof(v_job) is distinct from 'object'
       or exists (select 1 from jsonb_object_keys(v_job) k where k not in ('bookingId', 'kind', 'message'))
       or jsonb_typeof(v_job->'message') is distinct from 'object'
       or octet_length((v_job->'message')::text) > 32768
       or not exists (select 1 from jsonb_array_elements(v_next) r where r->>'id' = v_job->>'bookingId' and r->>'siteId' = p_site_id)
       or exists (select 1 from jsonb_each(v_job->'message') f
          where f.key not in ('recipient', 'locale', 'siteName', 'replyTo', 'appointmentAt', 'appointmentTimeZone',
            'status', 'customerName', 'customerPhone', 'serviceName', 'optionName', 'notes', 'reminderOffsetMinutes')
             or case when f.key = 'reminderOffsetMinutes' then
               case when jsonb_typeof(f.value) = 'number' then
                 (f.value::text)::numeric not between 0 and 525600
                   or trunc((f.value::text)::numeric) <> (f.value::text)::numeric
                 else true end
               else jsonb_typeof(f.value) not in ('string', 'null')
                 or (f.key <> 'notes' and (f.value #>> '{}') ~ '[[:cntrl:]]') end)
       or jsonb_typeof(v_job#>'{message,recipient}') is distinct from 'string'
       or length(v_job#>>'{message,recipient}') not between 3 and 320
       or (v_job#>>'{message,recipient}') !~ '^[^[:space:]<>@,;]+@[^[:space:]<>@,;]+[.][^[:space:]<>@,;]+$'
       or (v_job#>>'{message,replyTo}' is not null
         and (length(v_job#>>'{message,replyTo}') > 320
           or (v_job#>>'{message,replyTo}') !~ '^[^[:space:]<>@,;]+@[^[:space:]<>@,;]+[.][^[:space:]<>@,;]+$')) then
      raise exception 'booking_atomic_invalid_mail_intent';
    end if;
    insert into public.faolla_booking_mail_jobs(site_id, command_key, ordinal, booking_id, kind, message)
      values (p_site_id, p_command_key, v_ordinal, v_job->>'bookingId', v_job->>'kind', v_job->'message');
    v_ordinal := v_ordinal + 1;
  end loop;
  update public.faolla_booking_atomic_control set revision = revision + 1;
  return jsonb_build_object('replayed', false, 'result', p_mutation->'result');
end;
$commit_booking$;

-- Single-attempt claim. An expired/abandoned dispatch is UNCERTAIN, not a new
-- pending job: SMTP/provider timeouts cannot prove delivery failure. No automatic
-- retry or exactly-once external-delivery claim is made by this protocol.
create function public.faolla_booking_mail_claim_v1(p_site_id text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $claim$
declare v_job public.faolla_booking_mail_jobs%rowtype;
begin
  if not exists (select 1 from public.faolla_booking_atomic_control where active) then
    raise exception 'booking_atomic_inactive';
  end if;
  if p_site_id is null or p_site_id !~ '^[A-Za-z0-9_-]{1,64}$' then raise exception 'booking_atomic_invalid_command'; end if;
  update public.faolla_booking_mail_jobs set state = 'unconfirmed', settled_at = clock_timestamp()
    where site_id = p_site_id and state = 'dispatching' and lease_until <= clock_timestamp();
  select * into v_job from public.faolla_booking_mail_jobs
    where site_id = p_site_id and state = 'pending' order by created_at, id for update skip locked limit 1;
  if not found then return null; end if;
  update public.faolla_booking_mail_jobs set state = 'dispatching', lease_id = gen_random_uuid(),
    lease_until = clock_timestamp() + interval '60 seconds' where id = v_job.id returning * into v_job;
  return to_jsonb(v_job);
end;
$claim$;

create function public.faolla_booking_mail_settle_v1(p_site_id text, p_id uuid, p_lease_id uuid, p_state text, p_receipt text)
returns boolean language plpgsql security definer set search_path = pg_catalog, public
as $settle$
declare v_count integer;
begin
  if not exists (select 1 from public.faolla_booking_atomic_control where active) then raise exception 'booking_atomic_inactive'; end if;
  if p_state is null or p_state not in ('sent', 'failed', 'unconfirmed')
     or (p_state = 'sent' and (p_receipt is null or length(p_receipt) not between 1 and 256 or p_receipt ~ '[[:cntrl:]]'))
     or (p_state <> 'sent' and p_receipt is not null) then raise exception 'booking_atomic_invalid_settlement'; end if;
  update public.faolla_booking_mail_jobs set state = p_state, provider_receipt = p_receipt, settled_at = clock_timestamp()
    where site_id = p_site_id and id = p_id and state = 'dispatching' and lease_id = p_lease_id and lease_until > clock_timestamp();
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$settle$;

revoke all on function public.faolla_booking_atomic_pages_guard_v1(), public.faolla_booking_atomic_rows_v1(),
  public.faolla_booking_atomic_snapshot_v1(text,text,text), public.faolla_booking_atomic_commit_v1(text,text,text,jsonb),
  public.faolla_booking_mail_claim_v1(text), public.faolla_booking_mail_settle_v1(text,uuid,uuid,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.faolla_booking_atomic_snapshot_v1(text,text,text),
  public.faolla_booking_atomic_commit_v1(text,text,text,jsonb), public.faolla_booking_mail_claim_v1(text),
  public.faolla_booking_mail_settle_v1(text,uuid,uuid,text,text) to service_role;

insert into public.faolla_schema_migrations(version,name) values (202610250211, 'booking_atomic_preparation');
commit;
