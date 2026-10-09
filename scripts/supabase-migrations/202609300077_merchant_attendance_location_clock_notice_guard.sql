-- Unreleased candidate. Publication never activates a fence or channel.
-- v1 becomes private implementation; service callers must pass the v2 guard.
begin;
set local lock_timeout='3s';
create table public.merchant_attendance_location_clock_notices (
  event_id uuid primary key references public.merchant_attendance_location_results(event_id) on delete restrict,
  merchant_id text not null,
  location_id uuid not null,
  employee_id uuid not null,
  worker_id uuid not null,
  notice_revision bigint null,
  safe_finish boolean not null,
  command jsonb not null check(jsonb_typeof(command)='object'),
  check(safe_finish=(notice_revision is null)),
  foreign key(merchant_id,location_id,notice_revision) references public.merchant_attendance_location_notices(merchant_id,location_id,revision) on delete restrict,
  foreign key(merchant_id,employee_id,worker_id,location_id,notice_revision)
    references public.merchant_attendance_location_notice_acknowledgements(merchant_id,employee_id,worker_id,location_id,notice_revision) on delete restrict
);
alter table public.merchant_attendance_location_clock_notices enable row level security;
revoke all on public.merchant_attendance_location_clock_notices from public,anon,authenticated,service_role;
create trigger merchant_attendance_location_clock_notices_no_rewrite before update or delete
  on public.merchant_attendance_location_clock_notices for each row execute function public.faolla_attendance_events_append_only_v1();
create trigger merchant_attendance_location_clock_notices_no_truncate before truncate
  on public.merchant_attendance_location_clock_notices for each statement execute function public.faolla_attendance_events_append_only_v1();

create function public.faolla_attendance_location_clock_v2(
  p_site_id text,p_auth_user_id uuid,p_expected_worker_id uuid,p_command jsonb default null,p_operation_id uuid default null,
  p_assertion jsonb default null,p_allow_new_sessions boolean default false,p_require_clock boolean default false
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  s public.merchant_attendance_settings%rowtype; w public.merchant_attendance_workers%rowtype;
  e public.merchant_enterprise_employees%rowtype; r public.merchant_enterprise_roles%rowtype;
  l public.merchant_attendance_locations%rowtype; ending public.merchant_attendance_locations%rowtype;
  n public.merchant_attendance_location_notices%rowtype; d public.merchant_attendance_location_policy_drafts%rowtype;
  last_fact public.merchant_attendance_events%rowtype; saved public.merchant_attendance_events%rowtype;
  link public.merchant_attendance_location_clock_notices%rowtype;
  b jsonb; finish jsonb; gate jsonb; receipt_gate jsonb; op uuid; k text; why text; ready boolean;
  safe boolean; replay boolean:=false; stamp timestamptz;
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_expected_worker_id is null
    or p_allow_new_sessions is null or p_require_clock is null then raise exception 'attendance_invalid_request'; end if;
  if p_command is null then
    if p_assertion is not null then raise exception 'attendance_invalid_request'; end if;
    op:=p_operation_id;
  else
    if p_operation_id is not null or jsonb_typeof(p_command)<>'object' then raise exception 'attendance_invalid_request'; end if;
    if (select count(*) from jsonb_object_keys(p_command))<>9 or not(p_command ?& array[
      'operationId','locationId','action','expectedSequence','settingsVersion','workerVersion','locationVersion','noticeRevision','safeFinish'])
      or coalesce(p_command->>'operationId','') !~ uuid_pattern or coalesce(p_command->>'locationId','') !~ uuid_pattern
      or coalesce(p_command->>'action','') not in ('clock_in','clock_out','break_start','break_end')
      or jsonb_typeof(p_command->'safeFinish')<>'boolean' then raise exception 'attendance_invalid_request'; end if;
    safe:=(p_command->>'safeFinish')::boolean;
    foreach k in array array['expectedSequence','settingsVersion','workerVersion','locationVersion'] loop
      if jsonb_typeof(p_command->k)<>'number' or coalesce(p_command->>k,'') !~ '^(0|[1-9][0-9]{0,15})$' then raise exception 'attendance_invalid_request'; end if;
      if (p_command->>k)::numeric>9007199254740991 or (k='expectedSequence' and (p_command->>k)::numeric>=9007199254740991)
        or (k<>'expectedSequence' and (p_command->>k)::numeric=0) then raise exception 'attendance_invalid_request'; end if;
    end loop;
    if safe then
      if p_command->'noticeRevision'<>'null'::jsonb or p_command->>'action' not in ('break_end','clock_out') or p_assertion is not null
        then raise exception 'attendance_invalid_request'; end if;
    else
      if jsonb_typeof(p_command->'noticeRevision')<>'number' or coalesce(p_command->>'noticeRevision','') !~ '^[1-9][0-9]{0,15}$'
        then raise exception 'attendance_invalid_request'; end if;
      if (p_command->>'noticeRevision')::numeric>9007199254740990 then raise exception 'attendance_invalid_request'; end if;
    end if;
    op:=(p_command->>'operationId')::uuid;
  end if;
  -- Same lock order as v1 and notice publication. Lock the worker for writes
  -- before invoking v1, avoiding concurrent SHARE-to-UPDATE upgrades.
  perform 1 from public.merchants where id=p_site_id for share;
  if not found then raise exception 'attendance_access_denied'; end if;
  select * into s from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  if not found then raise exception 'attendance_disabled'; end if;
  select * into e from public.merchant_enterprise_employees where merchant_id=p_site_id and auth_user_id=p_auth_user_id for share;
  if not found or e.status<>'active' then raise exception 'attendance_access_denied'; end if;
  select * into r from public.merchant_enterprise_roles where merchant_id=p_site_id and id=e.role_id for share;
  if not found or r.status<>'active' or not public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions)
    or not('attendance.self.view'=any(r.permissions)) or ((p_command is not null or p_require_clock) and not('attendance.self.clock'=any(r.permissions)))
    then raise exception 'attendance_access_denied'; end if;
  if p_command is null then
    select * into w from public.merchant_attendance_workers where merchant_id=p_site_id and employee_id=e.id for share;
  else
    select * into w from public.merchant_attendance_workers where merchant_id=p_site_id and employee_id=e.id for update;
  end if;
  if not found then raise exception 'attendance_access_denied'; end if;
  if w.id<>p_expected_worker_id then raise exception 'attendance_worker_changed'; end if;
  b:=public.faolla_attendance_location_clock_v1(p_site_id,p_auth_user_id,p_expected_worker_id,null,op,null,p_allow_new_sessions,p_require_clock or p_command is not null);
  select * into l from public.merchant_attendance_locations where merchant_id=p_site_id and id=w.default_location_id for share;
  select * into n from public.merchant_attendance_location_notices where merchant_id=p_site_id and location_id=l.id order by revision desc limit 1;
  if n.action='publish' then
    select * into d from public.merchant_attendance_location_policy_drafts where merchant_id=p_site_id and location_id=l.id and revision=n.draft_revision;
  end if;
  why:=case
    when n.revision is null then 'unpublished'
    when n.action='withdraw' then 'withdrawn'
    when not l.active or (n.command->>'expectedSettingsVersion')::bigint<>s.version
      or (n.command->>'expectedLocationVersion')::bigint<>l.version then 'configuration_changed'
    -- Publishing text is not activation. The existing operational fence must
    -- independently equal the immutable disclosed fence, including raw values.
    when l.latitude is distinct from (d.command->'values'->>'latitude')::double precision
      or l.longitude is distinct from (d.command->'values'->>'longitude')::double precision
      or l.radius_meters is distinct from (d.command->'values'->>'radiusMeters')::integer then 'fence_mismatch'
    when not exists(select 1 from public.merchant_attendance_location_notice_acknowledgements a
      where a.merchant_id=p_site_id and a.location_id=l.id and a.notice_revision=n.revision and a.employee_id=e.id
        and a.worker_id=w.id and a.actor_auth_user_id=p_auth_user_id) then 'acknowledgement_required'
    else 'ready' end;
  ready:=why='ready'; gate:=jsonb_build_object('ready',ready,'reason',why,'revision',n.revision);
  select * into last_fact from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=w.id order by sequence desc limit 1;
  -- An exceptional/manual rebind must not expose or continue another employee's
  -- latest state. Normal management already prohibits historical worker rebinds.
  if last_fact.id is not null and last_fact.actor_employee_id is distinct from e.id then raise exception 'attendance_access_denied'; end if;
  if last_fact.id is not null and last_fact.action<>'clock_out' and last_fact.location_id is distinct from w.default_location_id then
    ready:=false; gate:=jsonb_build_object('ready',false,'reason','shift_location_changed','revision',n.revision);
  end if;
  -- Safe finish is explicit, locationless, and only closes the current employee's
  -- existing location shift. A revoked identity/role still fails above. It never
  -- creates a shift/break or rewrites the start, break pay flag or past timestamps.
  if last_fact.id is not null and last_fact.action<>'clock_out' and last_fact.actor_employee_id=e.id
    and 'attendance.self.clock'=any(r.permissions) and exists(select 1 from public.merchant_attendance_location_results where event_id=last_fact.id) then
    select * into ending from public.merchant_attendance_locations where merchant_id=p_site_id and id=last_fact.location_id for share;
    if ending.id is not null then finish:=jsonb_build_object('locationId',ending.id,'settingsVersion',s.version,'workerVersion',w.version,'locationVersion',ending.version); end if;
  end if;
  if b->'receipt'<>'null'::jsonb then
    select * into link from public.merchant_attendance_location_clock_notices where event_id=(b->'receipt'->>'id')::uuid;
    if p_command is not null then
      -- Never reuse an old-v1 receipt as if it had a notice binding.
      if link.event_id is null or link.command<>p_command then raise exception 'attendance_operation_conflict'; end if;
      replay:=true;
    end if;
  elsif p_command is not null then
    if safe then
      if finish is null then raise exception 'attendance_safe_finish_unavailable'; end if;
      if (p_command->>'expectedSequence')::bigint<>last_fact.sequence then raise exception 'attendance_sequence_conflict'; end if;
      if (p_command->>'locationId')::uuid<>ending.id then raise exception 'attendance_location_denied'; end if;
      if p_command->>'action'='break_end' and last_fact.action<>'break_start' then raise exception 'attendance_not_on_break'; end if;
      if p_command->>'action'='clock_out' and last_fact.action='break_start' then raise exception 'attendance_break_must_end'; end if;
      stamp:=date_trunc('milliseconds',clock_timestamp());
      if stamp<last_fact.occurred_at then raise exception 'attendance_time_reversed'; end if;
      insert into public.merchant_attendance_events(merchant_id,worker_id,location_id,operation_id,sequence,action,source,break_paid,occurred_at,received_at,time_zone,actor_employee_id)
        values(p_site_id,w.id,ending.id,op,last_fact.sequence+1,p_command->>'action','web',null,stamp,stamp,last_fact.time_zone,e.id) returning * into saved;
      insert into public.merchant_attendance_location_results(event_id,settings_version,worker_version,location_version,algorithm_version,reason,needs_review)
        values(saved.id,s.version,w.version,ending.version,1,'not_provided',true);
    else
      if not ready or n.revision<>(p_command->>'noticeRevision')::bigint then raise exception 'attendance_notice_required'; end if;
      b:=public.faolla_attendance_location_clock_v1(p_site_id,p_auth_user_id,p_expected_worker_id,p_command-'noticeRevision'-'safeFinish',null,p_assertion,p_allow_new_sessions,true);
      select * into saved from public.merchant_attendance_events where id=(b->'receipt'->>'id')::uuid;
    end if;
    insert into public.merchant_attendance_location_clock_notices(event_id,merchant_id,location_id,employee_id,worker_id,notice_revision,safe_finish,command)
      values(saved.id,p_site_id,saved.location_id,e.id,w.id,case when safe then null else n.revision end,safe,p_command) returning * into link;
    b:=public.faolla_attendance_location_clock_v1(p_site_id,p_auth_user_id,p_expected_worker_id,null,op,null,p_allow_new_sessions,true);
    -- Last-event-based readiness after a successful close, not a stale pre-write button.
    if saved.action='clock_out' then
      finish:=null; ready:=why='ready'; gate:=jsonb_build_object('ready',ready,'reason',why,'revision',n.revision);
    end if;
    if saved.action in ('clock_in','break_start','break_end') then
      finish:=jsonb_build_object('locationId',saved.location_id,'settingsVersion',s.version,'workerVersion',w.version,'locationVersion',coalesce(ending.version,l.version));
    end if;
  end if;
  if link.event_id is not null then receipt_gate:=jsonb_build_object('noticeRevision',link.notice_revision,'safeFinish',link.safe_finish,
    'command',link.command); end if;
  return b||jsonb_build_object('replayed',replay,'channelEnabled',(b->>'channelEnabled')::boolean and ready,
    'noticeGate',gate,'finish',finish,'receiptGate',receipt_gate);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end; $$;
revoke all on function public.faolla_attendance_location_clock_v2(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_location_clock_v2(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean) to service_role;
revoke all on function public.faolla_attendance_location_clock_v1(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean) from service_role;
comment on table public.merchant_attendance_location_clock_notices is 'Append-only exact notice/ack binding, or explicitly locationless safe shift finish. No GPS, automatic policy activation, payroll approval or consent inference.';
insert into public.faolla_schema_migrations(version,name) values(202609300077,'merchant_attendance_location_clock_notice_guard') on conflict(version) do nothing;
commit;
