-- Additive/default-off PIN clock. Existing verification and web RPCs unchanged.
begin;
set local lock_timeout='3s';
create table public.merchant_attendance_pin_clock_receipts(
  event_id uuid primary key references public.merchant_attendance_events(id) on delete restrict,
  merchant_id text not null,terminal_id uuid not null,worker_id uuid not null,employee_id uuid not null,operation_id uuid not null,
  command jsonb not null check(jsonb_typeof(command)='object'),
  unique(merchant_id,worker_id,operation_id),
  foreign key(merchant_id,terminal_id) references public.merchant_attendance_terminals(merchant_id,id) on delete restrict,
  foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id) on delete restrict,
  foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id) on delete restrict
);
alter table public.merchant_attendance_pin_clock_receipts enable row level security;
revoke all on public.merchant_attendance_pin_clock_receipts from public,anon,authenticated,service_role;
create trigger attendance_pin_clock_no_rewrite before update or delete on public.merchant_attendance_pin_clock_receipts for each row execute function public.faolla_attendance_events_append_only_v1();
create trigger attendance_pin_clock_no_truncate before truncate on public.merchant_attendance_pin_clock_receipts for each statement execute function public.faolla_attendance_events_append_only_v1();

create function public.faolla_attendance_pin_clock_v1(p_site text,p_terminal uuid,p_secret_hash text,p_no text,p_lease uuid,p_verified boolean,p_request jsonb,p_allow_new boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare checked jsonb;c jsonb;op uuid;action_now text;expected bigint;worker_expected uuid;loc_expected uuid;
  s public.merchant_attendance_settings%rowtype;t public.merchant_attendance_terminals%rowtype;
  w public.merchant_attendance_workers%rowtype;l public.merchant_attendance_locations%rowtype;
  last_row public.merchant_attendance_events%rowtype;receipt public.merchant_attendance_events%rowtype;
  binding public.merchant_attendance_pin_clock_receipts%rowtype;
  seq bigint;status_now text;now_at timestamptz;lease_until timestamptz;today date;replayed boolean:=false;reason text;valid_uuid text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_request is null or jsonb_typeof(p_request)<>'object' or (select count(*) from jsonb_object_keys(p_request))<>2
    or not(p_request ?& array['command','operationId']) then raise exception 'attendance_invalid_request';end if;
  c:=nullif(p_request->'command','null'::jsonb);
  if c is not null then
    if p_request->'operationId'<>'null'::jsonb or jsonb_typeof(c)<>'object' or (select count(*) from jsonb_object_keys(c))<>6
      or not(c ?& array['expectedWorkerId','expectedEmployeeId','operationId','locationId','action','expectedSequence'])
      or coalesce(c->>'action','') not in ('clock_in','break_start','break_end','clock_out')
      or coalesce(c->>'expectedEmployeeId','') !~ valid_uuid or coalesce(c->>'expectedWorkerId','') !~ valid_uuid or coalesce(c->>'operationId','') !~ valid_uuid or coalesce(c->>'locationId','') !~ valid_uuid
      or jsonb_typeof(c->'expectedSequence')<>'number' or coalesce(c->>'expectedSequence','') !~ '^(0|[1-9][0-9]{0,15})$'
      or (c->>'expectedSequence')::numeric>9007199254740990 then raise exception 'attendance_invalid_request';end if;
    op:=(c->>'operationId')::uuid;action_now:=c->>'action';expected:=(c->>'expectedSequence')::bigint;
    worker_expected:=(c->>'expectedWorkerId')::uuid;loc_expected:=(c->>'locationId')::uuid;
  elsif p_request->'operationId'<>'null'::jsonb then
    if coalesce(p_request->>'operationId','') !~ valid_uuid then raise exception 'attendance_invalid_request';end if;
    op:=(p_request->>'operationId')::uuid;
  end if;
  -- Finish consumes the lease and rechecks device/member/role/PIN revision.
  -- Its settings/employee/role/worker locks remain held UNTIL this RPC commits.
  -- true here enables authentication only; p_allow_new separately gates starts.
  select lease_expires into lease_until from public.merchant_attendance_pin_attempts where merchant_id=p_site and terminal_id=p_terminal and lease_id=p_lease;
  checked:=public.faolla_attendance_pin_finish_v1(p_site,p_terminal,p_secret_hash,p_no,p_lease,p_verified,true);
  if checked->>'verified'<>'true' then return jsonb_build_object('error','attendance_pin_denied');end if;
  -- Expected business denials roll back this subtransaction, NOT lease consumption.
  -- Never leave an inserted event without its origin-bound immutable receipt.
  begin
    select * into s from public.merchant_attendance_settings where merchant_id=p_site;
    select * into t from public.merchant_attendance_terminals where merchant_id=p_site and id=p_terminal;
    select * into w from public.merchant_attendance_workers where merchant_id=p_site and lower(btrim(worker_no))=lower(p_no);
    if c is not null and (w.id<>worker_expected or w.employee_id is distinct from (c->>'expectedEmployeeId')::uuid) then raise exception 'attendance_worker_changed';end if;
    select * into l from public.merchant_attendance_locations where merchant_id=p_site and id=t.location_id;
    select * into last_row from public.merchant_attendance_events where merchant_id=p_site and worker_id=w.id order by sequence desc limit 1;
    seq:=coalesce(last_row.sequence,0);status_now:=case when last_row.id is null or last_row.action='clock_out' then 'off' when last_row.action='break_start' then 'break' else 'working' end;
    select * into receipt from public.merchant_attendance_events where merchant_id=p_site and worker_id=w.id and operation_id=op;
    if receipt.id is not null then
      select * into binding from public.merchant_attendance_pin_clock_receipts where event_id=receipt.id;
      if binding.event_id is null or binding.terminal_id<>p_terminal or binding.employee_id<>w.employee_id
        or receipt.actor_employee_id is distinct from w.employee_id or receipt.source<>'kiosk'
        or (c is not null and binding.command<>c) then raise exception 'attendance_operation_conflict';end if;
      replayed:=c is not null;
    end if;
    now_at:=date_trunc('milliseconds',clock_timestamp());today:=(now_at at time zone s.time_zone)::date;
    -- Re-date AFTER any membership/worker lock wait, not just before the wait.
    if lease_until is null or clock_timestamp()>=lease_until or clock_timestamp()<lease_until-interval '30 seconds'
      or now_at>=t.device_expires_at or now_at<t.paired_at then raise exception 'attendance_pin_denied';end if;
    reason:=case when l.id is null or not l.active or w.default_location_id is distinct from t.location_id then 'attendance_location_denied'
      when l.radius_meters is not null then 'attendance_location_verification_required'
      when (select count(*) from public.merchant_attendance_employment_periods where merchant_id=p_site and worker_id=w.id and starts_on<=today and (ends_on is null or ends_on>=today))<>1 then 'attendance_not_employed' else null end;
    if c is not null and not replayed then
      if seq<>expected then raise exception 'attendance_sequence_conflict';end if;
      if loc_expected<>t.location_id then raise exception 'attendance_location_denied';end if;
      if reason is not null then raise exception '%',reason;end if;
      if p_allow_new is distinct from true and action_now in ('clock_in','break_start') then raise exception 'attendance_platform_paused';end if;
      if last_row.id is not null and now_at<last_row.occurred_at then raise exception 'attendance_time_reversed';end if;
      if action_now='clock_in' and status_now<>'off' then raise exception 'attendance_already_clocked_in';end if;
      if action_now='break_start' and status_now<>'working' then raise exception 'attendance_not_working';end if;
      if action_now='break_end' and status_now<>'break' then raise exception 'attendance_not_on_break';end if;
      if action_now='clock_out' and status_now='break' then raise exception 'attendance_break_must_end';end if;
      if action_now='clock_out' and status_now='off' then raise exception 'attendance_not_clocked_in';end if;
      insert into public.merchant_attendance_events(merchant_id,worker_id,location_id,operation_id,sequence,action,source,break_paid,occurred_at,received_at,time_zone,actor_employee_id)
        values(p_site,w.id,t.location_id,op,seq+1,action_now,'kiosk',case when action_now='break_start' then s.web_break_paid else null end,now_at,now_at,l.time_zone,w.employee_id) returning * into receipt;
      insert into public.merchant_attendance_pin_clock_receipts values(receipt.id,p_site,p_terminal,w.id,w.employee_id,op,c);
      last_row:=receipt;seq:=receipt.sequence;status_now:=case when action_now='clock_out' then 'off' when action_now='break_start' then 'break' else 'working' end;
    end if;
    return jsonb_build_object('siteId',p_site,'terminalId',p_terminal,'workerNo',w.worker_no,'workerName',w.display_name,'employeeId',w.employee_id,
      'workerId',w.id,'locationId',t.location_id,'state',jsonb_build_object('sequence',seq,'status',status_now,'lastEvent',public.faolla_attendance_event_receipt_v1(last_row)),
      'receipt',public.faolla_attendance_event_receipt_v1(receipt),'replayed',replayed,'canStart',reason is null and coalesce(p_allow_new,false),'canFinish',reason is null,'blockReason',reason);
  exception when raise_exception then
    if sqlerrm in ('attendance_pin_denied','attendance_worker_changed','attendance_operation_conflict','attendance_sequence_conflict','attendance_location_denied','attendance_location_verification_required',
      'attendance_not_employed','attendance_platform_paused','attendance_time_reversed','attendance_already_clocked_in','attendance_not_working','attendance_not_on_break','attendance_break_must_end','attendance_not_clocked_in') then
      return jsonb_build_object('error',sqlerrm);
    end if;raise;
  end;
end;$$;
revoke all on function public.faolla_attendance_pin_clock_v1(text,uuid,text,text,uuid,boolean,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_pin_clock_v1(text,uuid,text,text,uuid,boolean,jsonb,boolean) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610010107,'merchant_attendance_pin_clock');
commit;
