begin;

set local lock_timeout = '2s';
set local statement_timeout = '10s';

-- Existing atomic writers take this same singleton lock. Briefly serialize
-- the definition change without stopping the site or pausing any worker.
do $serialize$
begin
  perform 1 from public.faolla_booking_atomic_control where singleton for update;
  if not found then raise exception 'booking_atomic_safeupdate_control_missing'; end if;
end;
$serialize$;

create temporary table faolla_booking_safeupdate_before on commit drop as
select
  (select to_jsonb(c) from public.faolla_booking_atomic_control c where singleton) as control,
  (select md5(coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb)::text)
     from public.pages p where p.merchant_id = '__faolla_booking_persistence__') as pages_md5,
  (select jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef)
     from pg_catalog.pg_proc where oid = 'public.faolla_booking_atomic_commit_v1(text,text,text,jsonb)'::regprocedure) as metadata;

-- Online correction for PostgREST sessions using pg-safeupdate.
-- Preserve the existing transaction protocol, private ACLs and all business data.
-- Only the revision update is narrowed to the already locked singleton primary key.
do $source_guard$
begin
  if not exists (
    select 1 from pg_catalog.pg_proc
    where oid = 'public.faolla_booking_atomic_commit_v1(text,text,text,jsonb)'::regprocedure
      and md5(replace(prosrc, chr(13), '')) = '310b382802e94af2997b1b9751fab0bc'
      and prosecdef
      and proconfig = array['search_path=pg_catalog, public']::text[]
  ) then
    raise exception 'booking_atomic_safeupdate_source_mismatch';
  end if;
end;
$source_guard$;

create or replace function public.faolla_booking_atomic_commit_v1(p_site_id text, p_command_key text, p_request_hash text, p_mutation jsonb)
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
  v_context jsonb;
  v_configuration_key text;
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
     or exists (select 1 from jsonb_object_keys(p_mutation) k where k not in ('generation', 'revision', 'rows', 'next', 'result', 'mailJobs', 'configuration'))
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
       or exists (select 1 from jsonb_object_keys(v_job) k where k not in ('bookingId', 'kind', 'message', 'context'))
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
       or ((v_job->>'kind') not in ('push','created_push') and (jsonb_typeof(v_job#>'{message,recipient}') is distinct from 'string'
       or length(v_job#>>'{message,recipient}') not between 3 and 320
       or (v_job#>>'{message,recipient}') !~ '^[^[:space:]<>@,;]+@[^[:space:]<>@,;]+[.][^[:space:]<>@,;]+$'
       or (v_job#>>'{message,replyTo}' is not null
         and (length(v_job#>>'{message,replyTo}') > 320
           or (v_job#>>'{message,replyTo}') !~ '^[^[:space:]<>@,;]+@[^[:space:]<>@,;]+[.][^[:space:]<>@,;]+$')))) then
      raise exception 'booking_atomic_invalid_mail_intent';
    end if;
    v_context := v_job->'context';
    if jsonb_typeof(v_context) is distinct from 'object'
       or octet_length(v_context::text) > 65536
       or exists(select 1 from jsonb_object_keys(v_context) k where k not in ('eventId','senderName','merchantDisplayName','extraMessage','booking'))
       or coalesce(v_context->>'eventId','') !~ '^evt-[0-9a-f]{16}$'
       or jsonb_typeof(v_context->'booking') is distinct from 'object'
       or not ((v_context->'booking') ?& array['id','siteId','siteName','store','item','appointmentAt','title','customerName','email','phone','note','status'])
       or exists(select 1 from jsonb_each(v_context->'booking') f where f.key not in
         ('id','siteId','siteName','store','item','appointmentAt','appointmentTimeZone','title','customerName','email','phone','note','status') or jsonb_typeof(f.value)<>'string')
       or exists(select 1 from jsonb_each(v_context) f where f.key in ('senderName','merchantDisplayName','extraMessage') and jsonb_typeof(f.value)<>'string')
       or coalesce(v_context->>'senderName','') ~ '[[:cntrl:]]'
       or not exists(select 1 from jsonb_array_elements(v_next) r where r->>'id'=v_job->>'bookingId' and r->>'siteId'=p_site_id
         and not exists(select 1 from jsonb_each(v_context->'booking') f where r->f.key is distinct from f.value)
         and exists(select 1 from jsonb_array_elements(coalesce(r->'timeline','[]'::jsonb)) e
           where e->>'id'=v_context->>'eventId' and e->>'delivery'='queued')) then
      raise exception 'booking_atomic_invalid_mail_context';
    end if;
    insert into public.faolla_booking_mail_jobs(site_id, command_key, ordinal, booking_id, kind, message, delivery_context)
      values (p_site_id, p_command_key, v_ordinal, v_job->>'bookingId', v_job->>'kind', v_job->'message', v_context);
    v_ordinal := v_ordinal + 1;
  end loop;
  if p_mutation ? 'configuration' then
    if jsonb_typeof(p_mutation->'configuration') is distinct from 'object' then raise exception 'booking_atomic_invalid_configuration'; end if;
    for v_configuration_key in select jsonb_object_keys(p_mutation->'configuration') loop
      perform public.faolla_booking_atomic_configuration_v2(p_site_id,v_configuration_key,p_mutation->'configuration'->v_configuration_key);
    end loop;
  end if;
  update public.faolla_booking_atomic_control set revision = revision + 1
    where singleton = v_control.singleton;
  return jsonb_build_object('replayed', false, 'result', p_mutation->'result');
end;
$commit_booking$;

do $unchanged$
begin
  if (select to_jsonb(c) from public.faolla_booking_atomic_control c where singleton)
       is distinct from (select control from pg_temp.faolla_booking_safeupdate_before)
     or (select md5(coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb)::text)
          from public.pages p where p.merchant_id = '__faolla_booking_persistence__')
       is distinct from (select pages_md5 from pg_temp.faolla_booking_safeupdate_before)
     or (select jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef)
          from pg_catalog.pg_proc where oid = 'public.faolla_booking_atomic_commit_v1(text,text,text,jsonb)'::regprocedure)
       is distinct from (select metadata from pg_temp.faolla_booking_safeupdate_before) then
    raise exception 'booking_atomic_safeupdate_postcondition_failed';
  end if;
end;
$unchanged$;

insert into public.faolla_schema_migrations(version,name)
  values (202611050213, 'booking_atomic_safeupdate_singleton');
commit;
