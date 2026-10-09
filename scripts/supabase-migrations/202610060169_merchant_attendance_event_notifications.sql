--200 opt-in event capture. Original writers, results,125 notices and159 acks
--remain unchanged. Only fresh successful source operations acquire a capture.
begin;
set local lock_timeout='3s';

do $event_notification_prerequisites$
declare x record;n text;installed boolean;
begin
  if to_regclass('public.faolla_schema_migrations') is null then raise exception 'merchant_attendance_event_notifications_prerequisite_required';end if;
  for x in select * from (values
    (202610050136::bigint,'merchant_attendance_schedule_publication_evidence'),
    (202610060156::bigint,'merchant_attendance_work_arrangements'),
    (202610060159::bigint,'merchant_attendance_work_arrangement_exceptions'),
    (202610060162::bigint,'merchant_attendance_application_delegation'),
    (202610060167::bigint,'merchant_attendance_schedule_delegation')) p(version,name) loop
    if not exists(select 1 from public.faolla_schema_migrations m where m.version=x.version and m.name=x.name) then
      raise exception 'merchant_attendance_event_notifications_prerequisite_required';end if;
  end loop;
  if exists(select 1 from public.faolla_schema_migrations where version=202610060169 and name<>'merchant_attendance_event_notifications') then
    raise exception 'merchant_attendance_event_notifications_installation_conflict';end if;
  select exists(select 1 from public.faolla_schema_migrations where version=202610060169 and name='merchant_attendance_event_notifications') into installed;
  foreach n in array array['merchant_attendance_event_notifications','merchant_attendance_event_notification_reads'] loop
    if installed<>(to_regclass('public.'||n) is not null) then raise exception 'merchant_attendance_event_notifications_installation_conflict';end if;
  end loop;
  foreach n in array array['faolla_attendance_event_notification_source_v1','faolla_attendance_event_notification_verify_v1',
    'faolla_attendance_event_notification_guard_v1','faolla_attendance_event_notification_capture_v1','faolla_attendance_event_notification_detail_v1',
    'faolla_attendance_schedule_event_v1','faolla_attendance_schedule_delegation_event_v1','faolla_attendance_work_arrangement_event_v1',
    'faolla_attendance_delegated_applications_event_v1','faolla_attendance_plan_exception_review_event_v1','faolla_attendance_event_notifications_v1'] loop
    if installed<>exists(select 1 from pg_proc where pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass) and proname=n) then
      raise exception 'merchant_attendance_event_notifications_installation_conflict';end if;
  end loop;
end;
$event_notification_prerequisites$;

create table if not exists public.merchant_attendance_event_notifications(
  merchant_id text not null check(merchant_id~'^[0-9]{8}$'),notification_id uuid not null default gen_random_uuid(),
  source_category text not null,operation_id uuid not null,source_id uuid not null,source_revision bigint null,event_type text not null,
  worker_id uuid not null,employee_id uuid not null,recipient_auth_user_id uuid null,
  capture_status text not null,unavailable_reason text null,actor_auth_user_id uuid not null,occurred_at timestamptz not null,summary jsonb not null,
  primary key(merchant_id,notification_id),unique(merchant_id,source_category,operation_id),
  unique(merchant_id,notification_id,worker_id,employee_id,recipient_auth_user_id),
  foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id),
  foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id),
  check((source_category='schedule' and event_type in('published','cancelled') and source_revision is null)
    or (source_category='work_arrangement' and source_revision is not null and ((event_type in('approved','rejected') and source_revision=2) or (event_type='approval_cancelled' and source_revision=3)))
    or (source_category='plan_exception' and source_revision is not null and event_type in('confirmed','excused','follow_up') and source_revision between 1 and 9007199254740990)),
  check((capture_status='ready' and recipient_auth_user_id is not null and unavailable_reason is null)
    or (capture_status='recipient_unavailable' and source_category='schedule' and recipient_auth_user_id is null and unavailable_reason is not null and unavailable_reason='publication_identity_unproven')),
  check(isfinite(occurred_at) and jsonb_typeof(summary)='object' and octet_length(convert_to(summary::text,'UTF8'))<=16384)
);
create index if not exists attendance_event_notifications_recipient_idx on public.merchant_attendance_event_notifications
  (merchant_id,worker_id,employee_id,recipient_auth_user_id,occurred_at desc,notification_id desc) where capture_status='ready';
create table if not exists public.merchant_attendance_event_notification_reads(
  merchant_id text not null,notification_id uuid not null,worker_id uuid not null,employee_id uuid not null,recipient_auth_user_id uuid not null,
  read_at timestamptz not null check(isfinite(read_at)),primary key(merchant_id,notification_id),
  foreign key(merchant_id,notification_id,worker_id,employee_id,recipient_auth_user_id)
    references public.merchant_attendance_event_notifications(merchant_id,notification_id,worker_id,employee_id,recipient_auth_user_id)
);

--Strict, bounded historical source reconstruction. It never asks a current
--grant, role, employment, setting, timezone catalogue or current owner to prove
--an old recipient. The summary is the specified source revision, not its head.
create or replace function public.faolla_attendance_event_notification_source_v1(p_site text,p_category text,p_operation uuid)
returns jsonb language plpgsql volatile set search_path=pg_catalog as $$
declare sc public.merchant_attendance_schedule_commands%rowtype;slot public.merchant_attendance_schedule_slots%rowtype;
  publication public.merchant_attendance_schedule_publication_evidence%rowtype;
  req public.merchant_attendance_work_arrangement_requests%rowtype;entry public.merchant_attendance_work_arrangement_entries%rowtype;
  case_row public.merchant_attendance_plan_exception_cases%rowtype;decision public.merchant_attendance_plan_exception_entries%rowtype;
  authority public.merchant_attendance_application_delegation_decisions%rowtype;
  source_id uuid;source_revision bigint;worker uuid;employee uuid;recipient uuid;actor uuid;occurred timestamptz;kind text;command jsonb;
  summary jsonb;checked jsonb;segments jsonb:='[]';n integer:=0;first_publication bigint;
  fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_site is null or p_site!~'^[0-9]{8}$' or p_operation is null or p_category is null then raise exception 'attendance_event_notification_invalid';end if;
  if p_category='schedule' then
    select * into sc from public.merchant_attendance_schedule_commands where merchant_id=p_site and operation_id=p_operation;
    if sc.operation_id is null or sc.command->>'action' not in('publish','cancel') or sc.actor_auth_user_id is null
      or public.faolla_attendance_schedule_delegation_command_v1(jsonb_build_object('expectedGrantRevision',1,'decision',sc.command),'delegate') is distinct from true
      or sc.command->>'operationId' is distinct from p_operation::text then raise exception 'attendance_event_notification_invalid';end if;
    if sc.command->>'action'='publish' then
      kind:='published';source_id:=p_operation;
    else kind:='cancelled';source_id:=(sc.command->>'slotId')::uuid;end if;
    for slot in select s.* from public.merchant_attendance_schedule_slots s where s.merchant_id=p_site
      and ((kind='published' and s.revision=sc.revision) or (kind='cancelled' and s.id=source_id)) order by s.start_at,s.id limit 33 loop
      n:=n+1;if n>32 then raise exception 'attendance_event_notification_invalid';end if;
      checked:=public.faolla_attendance_self_schedule_slot_v1(slot);
      if kind='cancelled' and (checked->'cancellation'->>'operationId' is distinct from p_operation::text
        or checked->'cancellation'->>'actorId' is distinct from sc.actor_auth_user_id::text) then raise exception 'attendance_event_notification_invalid';end if;
      if n=1 then worker:=slot.worker_id;employee:=slot.employee_id;first_publication:=slot.revision;
        select * into publication from public.merchant_attendance_schedule_publication_evidence where merchant_id=p_site and revision=slot.revision;
        recipient:=publication.employee_auth_user_id;
      elsif slot.worker_id is distinct from worker or slot.employee_id is distinct from employee or slot.revision is distinct from first_publication then
        raise exception 'attendance_event_notification_invalid';end if;
      segments:=segments||jsonb_build_array(jsonb_build_object('slotId',slot.id,'startAt',to_char(slot.start_at at time zone 'UTC',fmt),
        'endAt',to_char(slot.end_at at time zone 'UTC',fmt),'timeZone',slot.time_zone));
    end loop;
    if n=0 or kind='cancelled' and n<>1 or kind='published' and n<>jsonb_array_length(sc.command->'slots') then raise exception 'attendance_event_notification_invalid';end if;
    summary:=jsonb_build_object('segments',segments);actor:=sc.actor_auth_user_id;occurred:=sc.recorded_at;command:=sc.command;
  elsif p_category='work_arrangement' then
    select * into entry from public.merchant_attendance_work_arrangement_entries where merchant_id=p_site and operation_id=p_operation;
    if entry.operation_id is null or entry.action not in('approve','reject','cancel') then raise exception 'attendance_event_notification_invalid';end if;
    select * into req from public.merchant_attendance_work_arrangement_requests where merchant_id=p_site and request_id=entry.request_id;
    checked:=public.faolla_attendance_work_arrangement_summary_v1(req,entry.revision);
    if checked is distinct from entry.snapshot then raise exception 'attendance_event_notification_invalid';end if;
    select * into authority from public.merchant_attendance_application_delegation_decisions where merchant_id=p_site and operation_id=p_operation;
    if authority.operation_id is not null then
      perform public.faolla_attendance_application_delegation_receipt_v1(authority);
      if authority.category<>'work_arrangement' or authority.request_id<>req.request_id then raise exception 'attendance_event_notification_invalid';end if;
    end if;
    source_id:=req.request_id;source_revision:=entry.revision;worker:=req.worker_id;employee:=req.employee_id;recipient:=req.actor_auth_user_id;
    actor:=entry.actor_auth_user_id;occurred:=entry.recorded_at;command:=entry.command;
    kind:=case entry.action when 'approve' then 'approved' when 'reject' then 'rejected' else 'approval_cancelled' end;
    summary:=jsonb_build_object('kind',req.kind,'startAt',to_char(req.start_at at time zone 'UTC',fmt),'endAt',to_char(req.end_at at time zone 'UTC',fmt),'timeZone',req.time_zone);
  elsif p_category='plan_exception' then
    select * into decision from public.merchant_attendance_plan_exception_entries where merchant_id=p_site and operation_id=p_operation;
    if decision.operation_id is null or decision.kind is distinct from 'decision' then raise exception 'attendance_event_notification_invalid';end if;
    perform public.faolla_attendance_plan_exception_review_entry_v1(decision);
    select * into case_row from public.merchant_attendance_plan_exception_cases where merchant_id=p_site and case_id=decision.case_id;
    source_id:=case_row.case_id;source_revision:=decision.revision;worker:=case_row.worker_id;employee:=case_row.employee_id;recipient:=case_row.employee_auth_user_id;
    actor:=decision.actor_auth_user_id;occurred:=decision.recorded_at;command:=decision.command;kind:=decision.command->>'outcome';
    if actor=recipient then raise exception 'attendance_event_notification_invalid';end if;
    summary:=jsonb_build_object('slotId',case_row.slot_id,'startAt',to_char(case_row.slot_start_at at time zone 'UTC',fmt),
      'endAt',to_char(case_row.slot_end_at at time zone 'UTC',fmt),'timeZone',case_row.time_zone,'outcome',kind);
  else raise exception 'attendance_event_notification_invalid';end if;
  if source_id is null or worker is null or employee is null or actor is null or occurred is null or not isfinite(occurred)
    or recipient is null and p_category<>'schedule' or summary is null or octet_length(convert_to(summary::text,'UTF8'))>16384 then
    raise exception 'attendance_event_notification_invalid';end if;
  return jsonb_build_object('sourceId',source_id,'sourceRevision',source_revision,'type',kind,'workerId',worker,'employeeId',employee,
    'recipientAuthUserId',recipient,'captureStatus',case when recipient is null then 'recipient_unavailable' else 'ready' end,
    'unavailableReason',case when recipient is null then 'publication_identity_unproven' else null end,'actorId',actor,
    'occurredAt',to_char(occurred at time zone 'UTC',fmt),'summary',summary,'command',command);
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then raise exception 'attendance_event_notification_invalid';
end;
$$;

create or replace function public.faolla_attendance_event_notification_verify_v1(p public.merchant_attendance_event_notifications)
returns void language plpgsql volatile set search_path=pg_catalog as $$
declare source jsonb;
begin
  source:=public.faolla_attendance_event_notification_source_v1(p.merchant_id,p.source_category,p.operation_id);
  if p.notification_id is null or jsonb_build_object('sourceId',p.source_id,'sourceRevision',p.source_revision,'type',p.event_type,
    'workerId',p.worker_id,'employeeId',p.employee_id,'recipientAuthUserId',p.recipient_auth_user_id,'captureStatus',p.capture_status,
    'unavailableReason',p.unavailable_reason,'actorId',p.actor_auth_user_id,'occurredAt',to_char(p.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'summary',p.summary) is distinct from source-'command' then raise exception 'attendance_event_notification_invalid';end if;
end;
$$;

create or replace function public.faolla_attendance_event_notification_guard_v1()
returns trigger language plpgsql set search_path=pg_catalog as $$
declare notice public.merchant_attendance_event_notifications%rowtype;
begin
  if tg_table_name='merchant_attendance_event_notifications' then
    perform public.faolla_attendance_event_notification_verify_v1(new);
  else
    select * into notice from public.merchant_attendance_event_notifications where merchant_id=new.merchant_id and notification_id=new.notification_id;
    if notice.notification_id is null or notice.capture_status<>'ready'
      or (notice.worker_id,notice.employee_id,notice.recipient_auth_user_id) is distinct from (new.worker_id,new.employee_id,new.recipient_auth_user_id)
      or new.read_at<notice.occurred_at then raise exception 'attendance_event_notification_invalid';end if;
  end if;
  return new;
end;
$$;

create or replace function public.faolla_attendance_event_notification_capture_v1(p_site text,p_category text,p_operation uuid,p_actor uuid,p_command jsonb)
returns void language plpgsql volatile set search_path=pg_catalog as $$
declare source jsonb;
begin
  source:=public.faolla_attendance_event_notification_source_v1(p_site,p_category,p_operation);
  if source->>'actorId' is distinct from p_actor::text or source->'command' is distinct from p_command then raise exception 'attendance_event_notification_invalid';end if;
  --No ON CONFLICT suppression: duplicate or inconsistent fresh capture is a
  --fault. Wrappers have already serialized and excluded original operations.
  insert into public.merchant_attendance_event_notifications(merchant_id,source_category,operation_id,source_id,source_revision,event_type,
    worker_id,employee_id,recipient_auth_user_id,capture_status,unavailable_reason,actor_auth_user_id,occurred_at,summary)
  values(p_site,p_category,p_operation,(source->>'sourceId')::uuid,(source->>'sourceRevision')::bigint,source->>'type',
    (source->>'workerId')::uuid,(source->>'employeeId')::uuid,(source->>'recipientAuthUserId')::uuid,source->>'captureStatus',source->>'unavailableReason',
    p_actor,(source->>'occurredAt')::timestamptz,source->'summary');
end;
$$;

create or replace function public.faolla_attendance_event_notification_detail_v1(p public.merchant_attendance_event_notifications)
returns jsonb language plpgsql volatile set search_path=pg_catalog as $$
declare r public.merchant_attendance_event_notification_reads%rowtype;
begin
  perform public.faolla_attendance_event_notification_verify_v1(p);
  if p.capture_status<>'ready' then raise exception 'attendance_event_notification_invalid';end if;
  select * into r from public.merchant_attendance_event_notification_reads where merchant_id=p.merchant_id and notification_id=p.notification_id;
  if r.notification_id is not null and ((r.worker_id,r.employee_id,r.recipient_auth_user_id) is distinct from (p.worker_id,p.employee_id,p.recipient_auth_user_id)
    or r.read_at<p.occurred_at) then raise exception 'attendance_event_notification_invalid';end if;
  return jsonb_build_object('notificationId',p.notification_id,'sourceCategory',p.source_category,'sourceOperationId',p.operation_id,'sourceId',p.source_id,
    'sourceRevision',p.source_revision,'type',p.event_type,'occurredAt',to_char(p.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'readAt',case when r.notification_id is null then null else to_char(r.read_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,'summary',p.summary);
end;
$$;

--099 and136 share the settings write lock. The separate evidence selection is
--server supplied and preserves the old independent publication-evidence flag.
create or replace function public.faolla_attendance_schedule_event_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false,p_capture_publication_evidence boolean default false)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare site text;op uuid;existed boolean;result jsonb;
begin
  if p_capture_publication_evidence is null then raise exception 'attendance_invalid_request';end if;
  if p_query->>'access'='owner' and p_command is not null and p_command->>'action' in('publish','cancel')
    and jsonb_typeof(p_query->'siteId')='string' and p_query->>'siteId'~'^[0-9]{8}$'
    and public.faolla_attendance_shift_rule_binding_scalar_v1(p_command->'operationId','uuid') is true then
    site:=p_query->>'siteId';op:=(p_command->>'operationId')::uuid;
    perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;
    perform 1 from public.merchant_attendance_settings where merchant_id=site for update;
    select exists(select 1 from public.merchant_attendance_schedule_commands where merchant_id=site and operation_id=op) into existed;
  end if;
  if p_capture_publication_evidence then result:=public.faolla_attendance_schedule_evidenced_v1(p_query,p_auth_user_id,p_command,p_allow_write);
  else result:=public.faolla_attendance_schedule_v1(p_query,p_auth_user_id,p_command,p_allow_write);end if;
  if op is not null and not existed then
    perform public.faolla_attendance_event_notification_capture_v1(site,'schedule',op,p_auth_user_id,p_command);
  end if;
  return result;
end;
$$;

create or replace function public.faolla_attendance_schedule_delegation_event_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare site text;op uuid;existed boolean;result jsonb;
begin
  if p_query->>'access'='delegate' and p_command is not null and p_command->'decision'->>'action' in('publish','cancel')
    and jsonb_typeof(p_query->'siteId')='string' and p_query->>'siteId'~'^[0-9]{8}$'
    and public.faolla_attendance_shift_rule_binding_scalar_v1(p_command->'decision'->'operationId','uuid') is true then
    site:=p_query->>'siteId';op:=(p_command->'decision'->>'operationId')::uuid;
    perform 1 from public.merchants where id=site for share;
    perform 1 from public.merchant_attendance_settings where merchant_id=site for update;
    select exists(select 1 from public.merchant_attendance_schedule_commands where merchant_id=site and operation_id=op) into existed;
  end if;
  result:=public.faolla_attendance_schedule_delegation_v1(p_query,p_auth_user_id,p_command,p_allow_write);
  if op is not null and not existed then
    perform public.faolla_attendance_event_notification_capture_v1(site,'schedule',op,p_auth_user_id,p_command->'decision');
  end if;
  return result;
end;
$$;

create or replace function public.faolla_attendance_work_arrangement_event_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare site text;op uuid;existed boolean;result jsonb;
begin
  if p_query->>'access'='owner' and p_command is not null and p_command->>'action' in('approve','reject','cancel')
    and jsonb_typeof(p_query->'siteId')='string' and p_query->>'siteId'~'^[0-9]{8}$'
    and public.faolla_attendance_shift_rule_binding_scalar_v1(p_command->'operationId','uuid') is true then
    site:=p_query->>'siteId';op:=(p_command->>'operationId')::uuid;
    perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;
    perform 1 from public.merchant_attendance_settings where merchant_id=site for update;
    select exists(select 1 from public.merchant_attendance_work_arrangement_entries where merchant_id=site and operation_id=op) into existed;
  end if;
  result:=public.faolla_attendance_work_arrangement_v1(p_query,p_auth_user_id,p_command,p_allow_write);
  if op is not null and not existed then
    perform public.faolla_attendance_event_notification_capture_v1(site,'work_arrangement',op,p_auth_user_id,p_command);
  end if;
  return result;
end;
$$;

create or replace function public.faolla_attendance_delegated_applications_event_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false,p_capture_notifications boolean default false)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare site text;op uuid;existed boolean;result jsonb;category text;
begin
  if p_query->>'access'='delegate' and p_command is not null and p_command->'decision'->>'action' in('approve','reject')
    and jsonb_typeof(p_query->'siteId')='string' and p_query->>'siteId'~'^[0-9]{8}$'
    and public.faolla_attendance_shift_rule_binding_scalar_v1(p_command->'decision'->'operationId','uuid') is true
    and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'grantId','uuid') is true then
    site:=p_query->>'siteId';
    perform 1 from public.merchants where id=site for share;
    perform 1 from public.merchant_attendance_settings where merchant_id=site for update;
    select g.category into category from public.merchant_attendance_application_delegations g where g.merchant_id=site and g.grant_id=(p_query->>'grantId')::uuid;
    if category='work_arrangement' then
      op:=(p_command->'decision'->>'operationId')::uuid;
      select exists(select 1 from public.merchant_attendance_work_arrangement_entries where merchant_id=site and operation_id=op) into existed;
    end if;
  end if;
  --Leave's captured_notification and125 provenance are not reinterpreted.
  result:=public.faolla_attendance_delegated_applications_v1(p_query,p_auth_user_id,p_command,p_allow_write,p_capture_notifications);
  if op is not null and not existed then
    perform public.faolla_attendance_event_notification_capture_v1(site,'work_arrangement',op,p_auth_user_id,p_command->'decision');
  end if;
  return result;
end;
$$;

create or replace function public.faolla_attendance_plan_exception_review_event_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare site text;op uuid;existed boolean;result jsonb;w public.merchant_attendance_workers%rowtype;
begin
  if p_query->>'access'='owner' and p_query->>'mode'='decide' and p_command is not null
    and jsonb_typeof(p_query->'siteId')='string' and p_query->>'siteId'~'^[0-9]{8}$'
    and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'workerId','uuid') is true
    and public.faolla_attendance_shift_rule_binding_scalar_v1(p_command->'operationId','uuid') is true then
    site:=p_query->>'siteId';op:=(p_command->>'operationId')::uuid;
    --Exactly159's existing lock prefix. Never upgrade settings after a source
    --read, nor take the advisory lock ahead of worker/member locks.
    perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;
    perform 1 from public.merchant_attendance_settings where merchant_id=site for share;
    select * into w from public.merchant_attendance_workers where merchant_id=site and id=(p_query->>'workerId')::uuid for share;
    if w.employee_id is not null then perform 1 from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;end if;
    perform pg_advisory_xact_lock(hashtextextended('faolla:attendance-plan-exception-review:v1:'||site,0));
    select exists(select 1 from public.merchant_attendance_plan_exception_entries where merchant_id=site and operation_id=op)
      or exists(select 1 from public.merchant_attendance_plan_exception_reads where merchant_id=site and operation_id=op) into existed;
  end if;
  result:=public.faolla_attendance_plan_exception_review_v1(p_query,p_auth_user_id,p_command,p_allow_write);
  if op is not null and not existed then
    perform public.faolla_attendance_event_notification_capture_v1(site,'plan_exception',op,p_auth_user_id,p_command);
  end if;
  return result;
end;
$$;

create or replace function public.faolla_attendance_event_notifications_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare site text;k text;expected_employee uuid;expected_worker uuid;employee_uuid uuid;nid uuid;cursor_id uuid;cursor_at timestamptz;
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;
  e public.merchant_enterprise_employees%rowtype;r public.merchant_enterprise_roles%rowtype;
  target public.merchant_attendance_event_notifications%rowtype;candidate public.merchant_attendance_event_notifications%rowtype;
  items jsonb:='[]';detail jsonb;item jsonb;next_cursor jsonb;result jsonb;seen integer:=0;can_mark boolean:=false;
begin
  if p_auth_user_id is null or p_allow_write is null
    or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','expectedEmployeeId','expectedWorkerId','notificationId','beforeAt','beforeId']) is distinct from true
    or octet_length(convert_to(p_query::text,'UTF8'))>4096
    or jsonb_typeof(p_query->'siteId') is distinct from 'string' or coalesce(p_query->>'siteId','')!~'^[0-9]{8}$'
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'expectedEmployeeId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  foreach k in array array['expectedWorkerId','notificationId','beforeId'] loop
    if p_query->k<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->k,'uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  end loop;
  if p_query->'beforeAt'<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'beforeAt','stamp6') is distinct from true then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';expected_employee:=(p_query->>'expectedEmployeeId')::uuid;expected_worker:=(p_query->>'expectedWorkerId')::uuid;
  nid:=(p_query->>'notificationId')::uuid;cursor_id:=(p_query->>'beforeId')::uuid;cursor_at:=(p_query->>'beforeAt')::timestamptz;
  if (cursor_id is null)<>(cursor_at is null) or nid is not null and cursor_id is not null
    or expected_worker is null and (nid is not null or cursor_id is not null) then raise exception 'attendance_invalid_request';end if;
  if p_command is not null and (public.faolla_attendance_shift_rule_binding_object_v1(p_command,array['action','notificationId']) is distinct from true
    or p_command->>'action' is distinct from 'mark_read' or p_command->'notificationId' is distinct from p_query->'notificationId'
    or nid is null or cursor_id is not null or expected_worker is null) then raise exception 'attendance_invalid_request';end if;
  perform 1 from public.merchants where id=site for share;
  if not found then raise exception 'attendance_access_denied';end if;
  if p_command is null then select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  else select * into s from public.merchant_attendance_settings where merchant_id=site for update;end if;
  if s.merchant_id is null then raise exception 'attendance_settings_required';end if;
  --Locate without locking, then align worker-before-employee with capture and
  --account lifecycle paths. Re-read the same member/Auth under SHARE.
  select id into employee_uuid from public.merchant_enterprise_employees where merchant_id=site and auth_user_id=p_auth_user_id;
  if employee_uuid is null then raise exception 'attendance_access_denied';end if;
  select * into w from public.merchant_attendance_workers where merchant_id=site and employee_id=employee_uuid for share;
  select * into e from public.merchant_enterprise_employees where merchant_id=site and id=employee_uuid for share;
  if e.id is null or e.id<>expected_employee or e.auth_user_id is distinct from p_auth_user_id or e.status<>'active' then raise exception 'attendance_access_denied';end if;
  select * into r from public.merchant_enterprise_roles where merchant_id=site and id=e.role_id for share;
  if r.id is null or r.status<>'active' or public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions) is distinct from true
    or not(r.permissions @> array['enterprise.view','attendance.self.view']::text[]) then raise exception 'attendance_access_denied';end if;
  if expected_worker is not null and expected_worker is distinct from w.id then raise exception 'attendance_worker_changed';end if;
  if w.id is not null and w.employee_id is distinct from e.id then raise exception 'attendance_worker_changed';end if;
  can_mark:=p_allow_write and s.enabled and w.id is not null;
  if nid is not null then
    select * into target from public.merchant_attendance_event_notifications where merchant_id=site and notification_id=nid
      and capture_status='ready' and worker_id=w.id and employee_id=e.id and recipient_auth_user_id=p_auth_user_id;
    if target.notification_id is null then raise exception 'attendance_event_notification_not_found';end if;
    detail:=public.faolla_attendance_event_notification_detail_v1(target);
    if p_command is not null and detail->'readAt'='null'::jsonb then
      if not can_mark then raise exception 'attendance_platform_paused';end if;
      insert into public.merchant_attendance_event_notification_reads(merchant_id,notification_id,worker_id,employee_id,recipient_auth_user_id,read_at)
        values(site,nid,w.id,e.id,p_auth_user_id,greatest(clock_timestamp(),target.occurred_at)) on conflict(merchant_id,notification_id) do nothing;
      detail:=public.faolla_attendance_event_notification_detail_v1(target);
      if detail->'readAt'='null'::jsonb then raise exception 'attendance_event_notification_invalid';end if;
    end if;
  elsif w.id is not null then
    for candidate in select * from public.merchant_attendance_event_notifications n where n.merchant_id=site and n.capture_status='ready'
      and n.worker_id=w.id and n.employee_id=e.id and n.recipient_auth_user_id=p_auth_user_id
      and (cursor_at is null or (n.occurred_at,n.notification_id)<(cursor_at,cursor_id)) order by n.occurred_at desc,n.notification_id desc limit 26 loop
      seen:=seen+1;exit when seen=26;
      item:=public.faolla_attendance_event_notification_detail_v1(candidate)-'summary';items:=items||jsonb_build_array(item);
      next_cursor:=jsonb_build_object('at',to_char(candidate.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'id',candidate.notification_id);
    end loop;
  end if;
  result:=jsonb_build_object('protocol','event-notifications-v1','siteId',site,'actorId',p_auth_user_id,'employeeId',e.id,'workerId',w.id,
    'items',items,'nextCursor',case when seen=26 then next_cursor else null end,'detail',detail,'canMarkRead',can_mark);
  if octet_length(convert_to(result::text,'UTF8'))>131072 then raise exception 'attendance_event_notification_too_large';end if;
  return result;
end;
$$;

do $event_notification_storage$
declare t regclass;
begin
  foreach t in array array['public.merchant_attendance_event_notifications'::regclass,'public.merchant_attendance_event_notification_reads'::regclass] loop
    execute format('alter table %s enable row level security',t);
    execute format('revoke all on %s from public,anon,authenticated,service_role',t);
    if not exists(select 1 from pg_trigger where tgrelid=t and tgname='attendance_event_notification_immutable') then
      execute format('create trigger attendance_event_notification_immutable before update or delete on %s for each row execute function public.faolla_attendance_events_append_only_v1()',t);end if;
    if not exists(select 1 from pg_trigger where tgrelid=t and tgname='attendance_event_notification_no_truncate') then
      execute format('create trigger attendance_event_notification_no_truncate before truncate on %s for each statement execute function public.faolla_attendance_events_append_only_v1()',t);end if;
    if not exists(select 1 from pg_trigger where tgrelid=t and tgname='attendance_event_notification_source_guard') then
      execute format('create trigger attendance_event_notification_source_guard after insert on %s for each row execute function public.faolla_attendance_event_notification_guard_v1()',t);end if;
  end loop;
end;
$event_notification_storage$;

do $event_notification_acl$
declare f regprocedure;
begin
  foreach f in array array[
    'public.faolla_attendance_event_notification_source_v1(text,text,uuid)'::regprocedure,
    'public.faolla_attendance_event_notification_verify_v1(public.merchant_attendance_event_notifications)'::regprocedure,
    'public.faolla_attendance_event_notification_guard_v1()'::regprocedure,
    'public.faolla_attendance_event_notification_capture_v1(text,text,uuid,uuid,jsonb)'::regprocedure,
    'public.faolla_attendance_event_notification_detail_v1(public.merchant_attendance_event_notifications)'::regprocedure,
    'public.faolla_attendance_schedule_event_v1(jsonb,uuid,jsonb,boolean,boolean)'::regprocedure,
    'public.faolla_attendance_schedule_delegation_event_v1(jsonb,uuid,jsonb,boolean)'::regprocedure,
    'public.faolla_attendance_work_arrangement_event_v1(jsonb,uuid,jsonb,boolean)'::regprocedure,
    'public.faolla_attendance_delegated_applications_event_v1(jsonb,uuid,jsonb,boolean,boolean)'::regprocedure,
    'public.faolla_attendance_plan_exception_review_event_v1(jsonb,uuid,jsonb,boolean)'::regprocedure,
    'public.faolla_attendance_event_notifications_v1(jsonb,uuid,jsonb,boolean)'::regprocedure] loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
    if f::text !~ 'faolla_attendance_event_notification_(source|verify|guard|capture|detail)_v1' then
      execute format('grant execute on function %s to service_role',f);end if;
  end loop;
end;
$event_notification_acl$;

insert into public.faolla_schema_migrations(version,name) values(202610060169,'merchant_attendance_event_notifications') on conflict(version) do nothing;
do $event_notification_postconditions$
declare t regclass;f regprocedure;r text;privilege_name text;
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610060169 and name='merchant_attendance_event_notifications') then
    raise exception 'merchant_attendance_event_notifications_registry_postcondition_failed';end if;
  foreach t in array array['public.merchant_attendance_event_notifications'::regclass,'public.merchant_attendance_event_notification_reads'::regclass] loop
    if not (select relrowsecurity from pg_class where oid=t) or (select count(*) from pg_trigger where tgrelid=t and not tgisinternal and tgenabled='O'
      and tgname in('attendance_event_notification_immutable','attendance_event_notification_no_truncate','attendance_event_notification_source_guard'))<>3 then
      raise exception 'merchant_attendance_event_notifications_acl_postcondition_failed';end if;
    foreach r in array array['anon','authenticated','service_role'] loop
      for privilege_name in select distinct a.privilege_type from pg_catalog.pg_class c
        cross join lateral pg_catalog.aclexplode(pg_catalog.acldefault('r',c.relowner)) a where c.oid=t loop
        if has_table_privilege(r,t,privilege_name) then raise exception 'merchant_attendance_event_notifications_acl_postcondition_failed';end if;
      end loop;
    end loop;
  end loop;
  foreach f in array array['public.faolla_attendance_schedule_event_v1(jsonb,uuid,jsonb,boolean,boolean)'::regprocedure,
    'public.faolla_attendance_schedule_delegation_event_v1(jsonb,uuid,jsonb,boolean)'::regprocedure,
    'public.faolla_attendance_work_arrangement_event_v1(jsonb,uuid,jsonb,boolean)'::regprocedure,
    'public.faolla_attendance_delegated_applications_event_v1(jsonb,uuid,jsonb,boolean,boolean)'::regprocedure,
    'public.faolla_attendance_plan_exception_review_event_v1(jsonb,uuid,jsonb,boolean)'::regprocedure,
    'public.faolla_attendance_event_notifications_v1(jsonb,uuid,jsonb,boolean)'::regprocedure] loop
    if not has_function_privilege('service_role',f,'EXECUTE') or has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
      or not(select prosecdef and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid=f) then
      raise exception 'merchant_attendance_event_notifications_acl_postcondition_failed';end if;
  end loop;
end;
$event_notification_postconditions$;
notify pgrst, 'reload schema';
commit;
