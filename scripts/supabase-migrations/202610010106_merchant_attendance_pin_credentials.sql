-- Local/default-off candidate. Independent PIN credentials + verification ONLY.
-- Never writes punches or creates a browser/employee login session.
begin;
set local lock_timeout='3s';
create table public.merchant_attendance_pin_credentials(
  merchant_id text not null, worker_id uuid not null, employee_id uuid not null,
  revision integer not null check(revision>0), enabled boolean not null,
  salt text, verifier text, changed_at timestamptz not null, created_by uuid not null,
  attempts integer not null default 0 check(attempts between 0 and 10), window_at timestamptz not null,
  primary key(merchant_id,worker_id),
  foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id) on delete restrict,
  foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id) on delete restrict,
  check((enabled and salt ~ '^[0-9a-f]{32}$' and verifier ~ '^[0-9a-f]{64}$' and salt is not null and verifier is not null)
    or (not enabled and salt is null and verifier is null)),
  check(isfinite(changed_at) and isfinite(window_at))
);
create table public.merchant_attendance_pin_audit(
  merchant_id text not null, operation_id uuid not null, worker_id uuid not null, actor uuid not null,
  action text not null check(action in ('set','revoke')), revision integer not null check(revision>0),
  command_hash text not null check(command_hash ~ '^[0-9a-f]{64}$'), recorded_at timestamptz not null,
  primary key(merchant_id,operation_id), unique(merchant_id,worker_id,revision),
  foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id) on delete restrict
);
create index attendance_pin_audit_recent_idx on public.merchant_attendance_pin_audit(merchant_id,worker_id,recorded_at);
create table public.merchant_attendance_pin_attempts(
  merchant_id text not null, terminal_id uuid not null, attempts integer not null check(attempts between 0 and 60), window_at timestamptz not null,
  lease_id uuid, lease_expires timestamptz, worker_id uuid, employee_id uuid, credential_revision integer,
  primary key(merchant_id,terminal_id),
  foreign key(merchant_id,terminal_id) references public.merchant_attendance_terminals(merchant_id,id) on delete restrict,
  check((lease_id is null and lease_expires is null and worker_id is null and employee_id is null and credential_revision is null)
    or (lease_id is not null and lease_expires is not null and worker_id is not null and employee_id is not null and credential_revision is not null))
);
alter table public.merchant_attendance_pin_credentials enable row level security;
alter table public.merchant_attendance_pin_audit enable row level security;
alter table public.merchant_attendance_pin_attempts enable row level security;
-- Revoke the bootstrap role only when it is not the private table owner.
do $pilot_private_table_bootstrap_acl$
declare target regclass;
begin
  for target in
    select c.oid::regclass from pg_catalog.pg_class c
    where c.oid=any(array[
      'public.merchant_attendance_pin_attempts'::regclass,
      'public.merchant_attendance_pin_audit'::regclass,
      'public.merchant_attendance_pin_credentials'::regclass
    ]) and c.relowner<>(select oid from pg_catalog.pg_roles where rolname='postgres')
  loop
    execute format('revoke all privileges on table %s from postgres',target);
  end loop;
end;
$pilot_private_table_bootstrap_acl$;

revoke all on public.merchant_attendance_pin_credentials,public.merchant_attendance_pin_audit,public.merchant_attendance_pin_attempts from public,anon,authenticated,service_role;
create trigger attendance_pin_audit_no_rewrite before update or delete on public.merchant_attendance_pin_audit for each row execute function public.faolla_attendance_events_append_only_v1();
create trigger attendance_pin_audit_no_truncate before truncate on public.merchant_attendance_pin_audit for each statement execute function public.faolla_attendance_events_append_only_v1();

-- Caller already holds settings (shared for verifier, exclusive for owner edits).
-- Resolve from exact work number, then lock current membership/role BEFORE worker.
create function public.faolla_attendance_pin_member_v1(p_site text,p_no text) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;r public.merchant_enterprise_roles%rowtype;
begin
  select * into w from public.merchant_attendance_workers where merchant_id=p_site and lower(btrim(worker_no))=lower(p_no);
  if not found then return null;end if;
  select * into e from public.merchant_enterprise_employees where merchant_id=p_site and id=w.employee_id for share;
  select * into r from public.merchant_enterprise_roles where merchant_id=p_site and id=e.role_id for share;
  select * into w from public.merchant_attendance_workers where merchant_id=p_site and id=w.id for update;
  return jsonb_build_object('workerId',w.id,'employeeId',w.employee_id,'workerNo',w.worker_no,'workerName',w.display_name,
    'ready',coalesce(w.active and e.status='active' and e.auth_user_id is not null and r.status='active'
      and public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions)
      and 'attendance.self.view'=any(r.permissions) and 'attendance.self.clock'=any(r.permissions),false));
end;$$;
revoke all on function public.faolla_attendance_pin_member_v1(text,text) from public,anon,authenticated,service_role;

create function public.faolla_attendance_pin_admin_v1(p_site text,p_auth uuid,p_no text,p_operation uuid,p_command jsonb,p_allow_set boolean) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare m public.merchants%rowtype;member jsonb;c public.merchant_attendance_pin_credentials%rowtype;a public.merchant_attendance_pin_audit%rowtype;
  target uuid;now_at timestamptz;revision_now integer;receipt jsonb:='null';op uuid;command_hash text;
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_site is null or p_site !~ '^\d{8}$' or p_auth is null or p_no is null or p_no<>btrim(p_no) or char_length(p_no) not between 1 and 40 or p_no ~ '[[:cntrl:]]' then raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
    if p_operation is not null or jsonb_typeof(p_command)<>'object' or coalesce(p_command->>'action','') not in ('set','revoke')
      or not(p_command ?& array['action','operationId','expectedRevision','workerId','employeeId','salt','verifier','commandHash']) or (select count(*) from jsonb_object_keys(p_command))<>8
      or coalesce(p_command->>'operationId','') !~ uuid_pattern or coalesce(p_command->>'workerId','') !~ uuid_pattern
      or (p_command->'employeeId'<>'null'::jsonb and coalesce(p_command->>'employeeId','') !~ uuid_pattern)
      or jsonb_typeof(p_command->'expectedRevision')<>'number' or coalesce(p_command->>'expectedRevision','') !~ '^(0|[1-9][0-9]{0,8})$'
      or coalesce(p_command->>'commandHash','') !~ '^[0-9a-f]{64}$'
      or (p_command->>'action'='set' and (coalesce(p_command->>'salt','') !~ '^[0-9a-f]{32}$' or coalesce(p_command->>'verifier','') !~ '^[0-9a-f]{64}$'))
      or (p_command->>'action'='revoke' and (p_command->'salt'<>'null'::jsonb or p_command->'verifier'<>'null'::jsonb)) then raise exception 'attendance_invalid_request';end if;
    op:=(p_command->>'operationId')::uuid;command_hash:=p_command->>'commandHash';
  else op:=p_operation;end if;
  select * into m from public.merchants where id=p_site for share;
  if not found or not coalesce(p_auth=any(array[m.user_id,m.auth_user_id,m.owner_user_id,m.owner_id,m.auth_id,m.created_by,m.created_by_user_id]),false) then raise exception 'attendance_access_denied';end if;
  -- Serialize credential edits (including not-yet-existing rows) with verification.
  if p_command is null then perform 1 from public.merchant_attendance_settings where merchant_id=p_site for share;
  else perform 1 from public.merchant_attendance_settings where merchant_id=p_site for update;end if;
  if not found then raise exception 'attendance_settings_required';end if;
  member:=public.faolla_attendance_pin_member_v1(p_site,p_no);if member is null then raise exception 'attendance_pin_worker_not_found';end if;
  target:=(member->>'workerId')::uuid;now_at:=clock_timestamp();
  select * into c from public.merchant_attendance_pin_credentials where merchant_id=p_site and worker_id=target for update;
  revision_now:=coalesce(c.revision,0);
  if op is not null then select * into a from public.merchant_attendance_pin_audit where merchant_id=p_site and operation_id=op;end if;
  if a.operation_id is not null and (a.worker_id<>target or a.actor<>p_auth) then raise exception 'attendance_operation_conflict';end if;
  if p_command is not null then
    if a.operation_id is not null then
      if a.command_hash<>command_hash then raise exception 'attendance_operation_conflict';end if;
    else
      if revision_now<>(p_command->>'expectedRevision')::integer or target<>(p_command->>'workerId')::uuid
        or member->>'employeeId' is distinct from p_command->>'employeeId' then raise exception 'attendance_pin_changed';end if;
      if c.changed_at>now_at then raise exception 'attendance_time_reversed';end if;
      if (select count(*) from public.merchant_attendance_pin_audit where merchant_id=p_site and worker_id=target and recorded_at>now_at-interval '1 hour')>=20 then raise exception 'attendance_rate_limited';end if;
      if p_command->>'action'='set' then
        if p_allow_set is distinct from true then raise exception 'attendance_platform_paused';end if;
        if member->>'ready'<>'true' then raise exception 'attendance_pin_worker_not_ready';end if;
        insert into public.merchant_attendance_pin_credentials(merchant_id,worker_id,employee_id,revision,enabled,salt,verifier,changed_at,created_by,attempts,window_at)
          values(p_site,target,(member->>'employeeId')::uuid,revision_now+1,true,p_command->>'salt',p_command->>'verifier',now_at,p_auth,0,now_at)
          on conflict(merchant_id,worker_id) do update set employee_id=excluded.employee_id,revision=excluded.revision,enabled=true,salt=excluded.salt,verifier=excluded.verifier,changed_at=excluded.changed_at,created_by=excluded.created_by,attempts=0,window_at=excluded.window_at;
      else
        if c.worker_id is null then raise exception 'attendance_pin_worker_not_ready';end if;
        update public.merchant_attendance_pin_credentials set revision=revision_now+1,enabled=false,salt=null,verifier=null,changed_at=now_at,created_by=p_auth where merchant_id=p_site and worker_id=target;
      end if;
      insert into public.merchant_attendance_pin_audit values(p_site,op,target,p_auth,p_command->>'action',revision_now+1,command_hash,now_at) returning * into a;
      select * into c from public.merchant_attendance_pin_credentials where merchant_id=p_site and worker_id=target;
    end if;
  end if;
  if a.operation_id is not null then receipt:=jsonb_build_object('operationId',a.operation_id,'revision',a.revision,'action',a.action);end if;
  return member||jsonb_build_object('siteId',p_site,'revision',coalesce(c.revision,0),'enabled',coalesce(c.enabled,false),
    'bindingCurrent',c.employee_id is not distinct from (member->>'employeeId')::uuid and c.worker_id is not null,
    'changedAt',to_char(c.changed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'receipt',receipt);
end;$$;
revoke all on function public.faolla_attendance_pin_admin_v1(text,uuid,text,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_pin_admin_v1(text,uuid,text,uuid,jsonb,boolean) to service_role;

-- Reserve one short-lived verification per device. Counters COMMIT before KDF.
-- One row per device and credential, not an ever-growing failed-attempt log.
create function public.faolla_attendance_pin_begin_v1(p_site text,p_terminal uuid,p_secret_hash text,p_no text,p_lease uuid,p_allow boolean) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare device jsonb;member jsonb;d public.merchant_attendance_pin_attempts%rowtype;c public.merchant_attendance_pin_credentials%rowtype;now_at timestamptz;
begin
  if p_allow is distinct from true then raise exception 'attendance_platform_paused';end if;
  if p_lease is null or p_no is null or p_no<>btrim(p_no) or char_length(p_no) not between 1 and 40 or p_no ~ '[[:cntrl:]]' then raise exception 'attendance_invalid_request';end if;
  device:=public.faolla_attendance_terminal_device_v1(p_site,p_terminal,p_secret_hash,null,false);
  if device->>'attendanceEnabled'<>'true' then raise exception 'attendance_disabled';end if;
  insert into public.merchant_attendance_pin_attempts(merchant_id,terminal_id,attempts,window_at) values(p_site,p_terminal,0,clock_timestamp()) on conflict do nothing;
  select * into d from public.merchant_attendance_pin_attempts where merchant_id=p_site and terminal_id=p_terminal for update;
  now_at:=clock_timestamp();
  if now_at<d.window_at then raise exception 'attendance_time_reversed';end if;
  if d.lease_expires>now_at then return jsonb_build_object('limited',true);end if;
  if now_at>=d.window_at+interval '1 minute' then d.attempts:=0;d.window_at:=now_at;end if;
  if d.attempts>=60 then return jsonb_build_object('limited',true);end if;
  update public.merchant_attendance_pin_attempts set attempts=d.attempts+1,window_at=d.window_at,lease_id=null,lease_expires=null,worker_id=null,employee_id=null,credential_revision=null where merchant_id=p_site and terminal_id=p_terminal;
  member:=public.faolla_attendance_pin_member_v1(p_site,p_no);
  select * into c from public.merchant_attendance_pin_credentials where merchant_id=p_site and worker_id=(member->>'workerId')::uuid for update;
  if member is null or member->>'ready'<>'true' or not coalesce(c.enabled,false) or c.employee_id is distinct from (member->>'employeeId')::uuid then return jsonb_build_object('denied',true);end if;
  if now_at<c.window_at or now_at<c.changed_at then raise exception 'attendance_time_reversed';end if;
  if now_at>=c.window_at+interval '15 minutes' then c.attempts:=0;c.window_at:=now_at;end if;
  if c.attempts>=10 then return jsonb_build_object('denied',true);end if;
  update public.merchant_attendance_pin_credentials set attempts=c.attempts+1,window_at=c.window_at where merchant_id=p_site and worker_id=c.worker_id;
  update public.merchant_attendance_pin_attempts set lease_id=p_lease,lease_expires=now_at+interval '30 seconds',worker_id=c.worker_id,employee_id=c.employee_id,credential_revision=c.revision where merchant_id=p_site and terminal_id=p_terminal;
  return jsonb_build_object('workerId',c.worker_id,'employeeId',c.employee_id,'revision',c.revision,'salt',c.salt,'verifier',c.verifier);
end;$$;
revoke all on function public.faolla_attendance_pin_begin_v1(text,uuid,text,text,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_pin_begin_v1(text,uuid,text,text,uuid,boolean) to service_role;

-- Verification result is NOT a punch authorization token. A future clock writer
-- must revalidate and insert the event in this final locked transaction, never
-- trust a browser-provided verified=true. This version cannot create attendance.
create function public.faolla_attendance_pin_finish_v1(p_site text,p_terminal uuid,p_secret_hash text,p_no text,p_lease uuid,p_verified boolean,p_allow boolean) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare device jsonb;member jsonb;d public.merchant_attendance_pin_attempts%rowtype;c public.merchant_attendance_pin_credentials%rowtype;now_at timestamptz;
begin
  if p_allow is distinct from true then raise exception 'attendance_platform_paused';end if;
  device:=public.faolla_attendance_terminal_device_v1(p_site,p_terminal,p_secret_hash,null,false);
  if device->>'attendanceEnabled'<>'true' then raise exception 'attendance_disabled';end if;
  select * into d from public.merchant_attendance_pin_attempts where merchant_id=p_site and terminal_id=p_terminal for update;
  now_at:=clock_timestamp();
  if not found or p_lease is null or d.lease_id is distinct from p_lease or d.lease_expires<=now_at or now_at<d.window_at then return jsonb_build_object('verified',false);end if;
  update public.merchant_attendance_pin_attempts set lease_id=null,lease_expires=null,worker_id=null,employee_id=null,credential_revision=null where merchant_id=p_site and terminal_id=p_terminal;
  if p_verified is distinct from true then return jsonb_build_object('verified',false);end if;
  member:=public.faolla_attendance_pin_member_v1(p_site,p_no);
  select * into c from public.merchant_attendance_pin_credentials where merchant_id=p_site and worker_id=d.worker_id for share;
  if member is null or member->>'ready'<>'true' or member->>'workerId'<>d.worker_id::text or member->>'employeeId'<>d.employee_id::text
    or not coalesce(c.enabled,false) or c.revision<>d.credential_revision or c.employee_id<>d.employee_id or now_at<c.changed_at then return jsonb_build_object('verified',false);end if;
  return jsonb_build_object('verified',true,'workerNo',member->>'workerNo','workerName',member->>'workerName','clockEnabled',false);
end;$$;
revoke all on function public.faolla_attendance_pin_finish_v1(text,uuid,text,text,uuid,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_pin_finish_v1(text,uuid,text,text,uuid,boolean,boolean) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610010106,'merchant_attendance_pin_credentials');
commit;
