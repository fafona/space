begin;

-- Still inactive after installation. This adds the reviewed application/worker
-- protocol, NOT an activation path. Reconcile legacy/local stores and quiesce
-- every incompatible writer and timer before a separately approved cutover.
do $inactive_upgrade$
begin
  if exists(select 1 from public.faolla_booking_atomic_control where active) then
    raise exception 'booking_atomic_upgrade_requires_inactive';
  end if;
end;
$inactive_upgrade$;
alter table public.faolla_booking_atomic_control add column protocol integer not null default 2 check (protocol = 2);
alter table public.faolla_booking_mail_jobs add column delivery_context jsonb not null default '{}'::jsonb;
alter table public.faolla_booking_mail_jobs add column delivery_error text;
alter table public.faolla_booking_mail_jobs add column subject text;
alter table public.faolla_booking_mail_jobs add column attempts integer not null default 0 check (attempts between 0 and 3);
alter table public.faolla_booking_mail_jobs add column not_before timestamptz not null default clock_timestamp();
alter table public.faolla_booking_mail_jobs drop constraint faolla_booking_mail_jobs_kind_check;
alter table public.faolla_booking_mail_jobs add constraint faolla_booking_mail_jobs_kind_check check (kind in ('status','reminder','manual','push','created_push'));
alter table public.faolla_booking_mail_jobs drop constraint faolla_booking_mail_jobs_state_check;
alter table public.faolla_booking_mail_jobs add constraint faolla_booking_mail_jobs_state_check check (state in ('pending','dispatching','sent','failed','unconfirmed','skipped'));
create unique index faolla_booking_notification_event_unique on public.faolla_booking_mail_jobs(site_id,(delivery_context->>'eventId'))
  where delivery_context ? 'eventId';

create function public.faolla_booking_atomic_read_v2()
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $read$
declare v_control public.faolla_booking_atomic_control%rowtype;
begin
  select * into strict v_control from public.faolla_booking_atomic_control for update;
  if not v_control.active then raise exception 'booking_atomic_inactive'; end if;
  return jsonb_build_object('generation',v_control.generation,'revision',v_control.revision::text,
    'protocol',v_control.protocol,'rows',public.faolla_booking_atomic_rows_v1());
end;
$read$;

-- Recovery is keyed by the server-bound principal + unpredictable request nonce.
-- Control lock serializes with in-flight commits. HTTP never accepts a raw
-- command key or principal from the browser, and never places it in a URL.
create function public.faolla_booking_command_result_v2(p_site_id text,p_command_key text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $recover$
begin
  perform 1 from public.faolla_booking_atomic_control where active and protocol=2 for update;
  if not found then raise exception 'booking_atomic_inactive'; end if;
  return (select result from public.faolla_booking_atomic_commands where site_id=p_site_id and command_key=p_command_key);
end;
$recover$;

create function public.faolla_booking_atomic_configuration_v2(p_site_id text, p_key text, p_next jsonb)
returns void language plpgsql security definer set search_path = pg_catalog, public
as $configuration$
declare
  v_slug text;
  v_property text;
  v_before jsonb;
  v_page public.pages%rowtype;
  v_backup public.pages%rowtype;
  v_capability text := current_setting('faolla.booking_atomic_write',true);
begin
  if p_key not in ('rules','workbench') then raise exception 'booking_atomic_invalid_configuration'; end if;
  v_slug := case p_key when 'rules' then '__merchant_booking_rules__:v1' else '__merchant_booking_workbench__:v1' end;
  v_property := case p_key when 'rules' then 'snapshots' else 'settingsBySiteId' end;
  select * into v_page from public.pages where slug = v_slug for update;
  v_before := coalesce(v_page.blocks,jsonb_build_object('version',1,v_property,'{}'::jsonb));
  if jsonb_typeof(p_next) is distinct from 'object' or p_next->'version' is distinct from '1'::jsonb
     or jsonb_typeof(p_next->v_property) is distinct from 'object'
     or jsonb_typeof(v_before->v_property) is distinct from 'object'
     or not ((p_next->v_property) ? p_site_id)
     or exists(select 1 from jsonb_object_keys(p_next) k where k not in ('version',v_property))
     or ((v_before->v_property) - p_site_id) is distinct from ((p_next->v_property) - p_site_id)
     or octet_length((p_next->v_property->p_site_id)::text) > 1048576 then
    raise exception 'booking_atomic_invalid_configuration';
  end if;
  perform set_config('faolla.booking_atomic_write','v1',true);
  if v_page.id is not null then
    select * into v_backup from public.pages where slug = v_slug || ':backup' for update;
    if found then
      update public.pages set blocks=v_page.blocks,updated_at=clock_timestamp() where id=v_backup.id;
    else
      insert into public.pages(merchant_id,slug,blocks,updated_at)
        values('__faolla_booking_persistence__',v_slug || ':backup',v_page.blocks,clock_timestamp());
    end if;
    update public.pages set blocks=p_next,updated_at=clock_timestamp() where id=v_page.id;
  else
    insert into public.pages(merchant_id,slug,blocks,updated_at)
      values('__faolla_booking_persistence__',v_slug,p_next,clock_timestamp());
  end if;
  perform set_config('faolla.booking_atomic_write',coalesce(v_capability,''),true);
end;
$configuration$;

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
  update public.faolla_booking_atomic_control set revision = revision + 1;
  return jsonb_build_object('replayed', false, 'result', p_mutation->'result');
end;
$commit_booking$;

create or replace function public.faolla_booking_mail_claim_v1(p_site_id text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $claim$
declare v_job public.faolla_booking_mail_jobs%rowtype;
begin
  if not exists(select 1 from public.faolla_booking_atomic_control where active and protocol=2) then raise exception 'booking_atomic_inactive'; end if;
  if p_site_id is null or p_site_id !~ '^[A-Za-z0-9_-]{1,64}$' then raise exception 'booking_atomic_invalid_command'; end if;
  update public.faolla_booking_mail_jobs set state='unconfirmed',settled_at=clock_timestamp(),delivery_error='dispatch_lease_expired'
    where site_id=p_site_id and state='dispatching' and lease_until <= clock_timestamp();
  select * into v_job from public.faolla_booking_mail_jobs where site_id=p_site_id and state='pending'
    and not_before <= clock_timestamp() and attempts < 3 order by created_at,id for update skip locked limit 1;
  if not found then return null; end if;
  update public.faolla_booking_mail_jobs set state='dispatching',attempts=attempts+1,lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds'
    where id=v_job.id returning * into v_job;
  return to_jsonb(v_job);
end;
$claim$;

create function public.faolla_booking_mail_settle_v2(p_site_id text,p_id uuid,p_lease_id uuid,p_state text,p_receipt text,p_error text,p_subject text,p_retry_seconds integer)
returns boolean language plpgsql security definer set search_path = pg_catalog, public
as $settle$
declare v_count integer;
begin
  if not exists(select 1 from public.faolla_booking_atomic_control where active and protocol=2) then raise exception 'booking_atomic_inactive'; end if;
  if p_state is null or p_state not in ('sent','failed','unconfirmed','skipped','pending')
     or (p_state='sent' and (p_receipt is null or length(p_receipt) not between 1 and 256 or p_receipt ~ '[[:cntrl:]]'))
     or (p_state<>'sent' and p_receipt is not null)
     or (p_state='pending' and (p_retry_seconds is null or p_retry_seconds not between 1 and 3600 or p_error is distinct from 'provider_rate_limited'))
     or (p_state<>'pending' and p_retry_seconds is not null)
     or length(coalesce(p_error,'')) > 200 or coalesce(p_error,'') ~ '[[:cntrl:]]'
     or length(coalesce(p_subject,'')) > 500 or coalesce(p_subject,'') ~ '[[:cntrl:]]' then raise exception 'booking_atomic_invalid_settlement'; end if;
  update public.faolla_booking_mail_jobs set state=p_state,provider_receipt=p_receipt,delivery_error=p_error,subject=p_subject,
    settled_at=case when p_state='pending' then null else clock_timestamp() end,
    not_before=case when p_state='pending' then clock_timestamp()+make_interval(secs=>p_retry_seconds) else not_before end
    where site_id=p_site_id and id=p_id and state='dispatching' and lease_id=p_lease_id and lease_until > clock_timestamp()
      and (p_state<>'pending' or attempts<3);
  get diagnostics v_count=row_count;
  return v_count=1;
end;
$settle$;

-- Privacy-safe delivery projection only; never returns frozen customer payload,
-- service keys, private tokens, recipients, or management URLs to a browser.
create function public.faolla_booking_mail_states_v2(p_site_id text,p_booking_ids text[])
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $states$
begin
  if cardinality(p_booking_ids) > 1000 then raise exception 'booking_atomic_invalid_command'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('bookingId',booking_id,'eventId',delivery_context->>'eventId',
    'state',case when state='dispatching' and lease_until<=clock_timestamp() then 'unconfirmed' else state end,
    'at',coalesce(settled_at,created_at),'subject',subject,'error',delivery_error))
    from public.faolla_booking_mail_jobs where site_id=p_site_id and booking_id=any(p_booking_ids)), '[]'::jsonb);
end;
$states$;

revoke all on function public.faolla_booking_atomic_read_v2(), public.faolla_booking_atomic_configuration_v2(text,text,jsonb),
  public.faolla_booking_command_result_v2(text,text),
  public.faolla_booking_mail_settle_v2(text,uuid,uuid,text,text,text,text,integer), public.faolla_booking_mail_states_v2(text,text[])
  from public,anon,authenticated,service_role;
revoke all on function public.faolla_booking_mail_settle_v1(text,uuid,uuid,text,text) from service_role;
grant execute on function public.faolla_booking_atomic_read_v2(),public.faolla_booking_mail_settle_v2(text,uuid,uuid,text,text,text,text,integer),
  public.faolla_booking_command_result_v2(text,text),
  public.faolla_booking_mail_states_v2(text,text[]) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610250212,'booking_atomic_runtime');
commit;
