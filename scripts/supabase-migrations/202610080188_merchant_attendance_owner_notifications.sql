--236 opt-in owner inbox. No source writer, source result, employee inbox,
--confirmation or acknowledgement is replaced. Old operations are never backfilled.
begin;
set local lock_timeout='3s';

do $owner_notification_preflight$
declare prerequisite record;object_name text;installed boolean;function_row record;is_public boolean;
begin
  if to_regclass('public.faolla_schema_migrations') is null then raise exception 'merchant_attendance_owner_notifications_prerequisite_required';end if;
  for prerequisite in select * from (values(202610060169::bigint,'merchant_attendance_event_notifications'),
    (202610060174::bigint,'merchant_attendance_plan_posthoc_reviews'),(202610080183::bigint,'merchant_attendance_period_continuation')) x(version,name) loop
    if not exists(select 1 from public.faolla_schema_migrations m where m.version=prerequisite.version and m.name=prerequisite.name) then
      raise exception 'merchant_attendance_owner_notifications_prerequisite_required';end if;
  end loop;
  select exists(select 1 from public.faolla_schema_migrations where version=202610080188 and name='merchant_attendance_owner_notifications') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610080188 and name<>'merchant_attendance_owner_notifications') then
    raise exception 'merchant_attendance_owner_notifications_installation_conflict';end if;
  foreach object_name in array array['merchant_attendance_owner_notifications','merchant_attendance_owner_notification_reads','merchant_attendance_owner_notification_operations'] loop
    if installed<>(to_regclass('public.'||object_name) is not null) then raise exception 'merchant_attendance_owner_notifications_installation_conflict';end if;
    if installed and exists(select 1 from pg_class c where c.oid=to_regclass('public.'||object_name) and
      (c.relkind<>'r' or c.relowner<>(select oid from pg_roles where rolname=current_user) or not c.relrowsecurity or c.relforcerowsecurity
        or exists(select 1 from pg_policy where polrelid=c.oid)
        or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where a.grantee<>c.relowner))) then
      raise exception 'merchant_attendance_owner_notifications_installation_conflict';end if;
  end loop;
  foreach object_name in array array['faolla_attendance_owner_notification_source_v1','faolla_attendance_owner_notification_verify_v1',
    'faolla_attendance_owner_notification_receipt_v1','faolla_attendance_owner_notification_guard_v1','faolla_attendance_owner_notification_capture_v1',
    'faolla_attendance_owner_notification_item_v1','faolla_attendance_plan_exception_owner_event_v1',
    'faolla_attendance_period_closure_owner_event_v1','faolla_attendance_period_closure_owner_event_v2','faolla_attendance_owner_notifications_v1'] loop
    if (select count(*) from pg_proc p where p.pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass) and p.proname=object_name)
      <>(case when installed then 1 else 0 end) then raise exception 'merchant_attendance_owner_notifications_installation_conflict';end if;
    if installed then
      select * into function_row from pg_proc p where p.pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass) and p.proname=object_name;
      is_public:=object_name in('faolla_attendance_plan_exception_owner_event_v1','faolla_attendance_period_closure_owner_event_v1','faolla_attendance_period_closure_owner_event_v2','faolla_attendance_owner_notifications_v1');
      if function_row.proowner<>(select oid from pg_roles where rolname=current_user) or function_row.prokind<>'f' or function_row.proretset or function_row.proargmodes is not null
        or function_row.proconfig is distinct from array['search_path=pg_catalog'] or function_row.prosecdef<>is_public
        or exists(select 1 from aclexplode(coalesce(function_row.proacl,acldefault('f',function_row.proowner))) a where a.grantee<>function_row.proowner
          and not(is_public and a.grantee=(select oid from pg_roles where rolname='service_role'))) then raise exception 'merchant_attendance_owner_notifications_installation_conflict';end if;
    end if;
  end loop;
end;
$owner_notification_preflight$;

create table if not exists public.merchant_attendance_owner_notifications(
  merchant_id text not null check(merchant_id~'^[0-9]{8}$'),notification_id uuid not null default gen_random_uuid(),
  source_category text not null check(source_category in('plan_exception','period')),operation_id uuid not null,source_id uuid not null,
  source_revision bigint not null check(source_revision between 1 and 9007199254740990),worker_id uuid not null,employee_id uuid not null,
  employee_auth_user_id uuid not null,recipient_auth_user_id uuid not null,occurred_at timestamptz not null check(isfinite(occurred_at)),
  target jsonb not null check(jsonb_typeof(target)='object' and octet_length(convert_to(target::text,'UTF8'))<=1024),
  primary key(merchant_id,notification_id),unique(merchant_id,source_category,operation_id),unique(merchant_id,notification_id,recipient_auth_user_id),
  foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id),
  foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id)
);
create index if not exists attendance_owner_notifications_recipient_idx on public.merchant_attendance_owner_notifications
  (merchant_id,recipient_auth_user_id,occurred_at desc,notification_id desc);
create table if not exists public.merchant_attendance_owner_notification_reads(
  merchant_id text not null,notification_id uuid not null,recipient_auth_user_id uuid not null,read_at timestamptz not null check(isfinite(read_at)),
  primary key(merchant_id,notification_id),unique(merchant_id,notification_id,recipient_auth_user_id,read_at),
  foreign key(merchant_id,notification_id,recipient_auth_user_id)
    references public.merchant_attendance_owner_notifications(merchant_id,notification_id,recipient_auth_user_id)
);
create table if not exists public.merchant_attendance_owner_notification_operations(
  merchant_id text not null,operation_id uuid not null,notification_id uuid not null,actor_auth_user_id uuid not null,
  command jsonb not null check(jsonb_typeof(command)='object' and octet_length(convert_to(command::text,'UTF8'))<=4096),
  read_at timestamptz not null check(isfinite(read_at)),recorded_at timestamptz not null check(isfinite(recorded_at) and recorded_at>=read_at),
  primary key(merchant_id,operation_id),
  foreign key(merchant_id,notification_id,actor_auth_user_id,read_at)
    references public.merchant_attendance_owner_notification_reads(merchant_id,notification_id,recipient_auth_user_id,read_at)
);

--Reconstruct only immutable source identity/frame metadata. No current owner,
--member status, current source calculation, note/reason text or artifact body.
create or replace function public.faolla_attendance_owner_notification_source_v1(p_site text,p_category text,p_operation uuid)
returns jsonb language plpgsql volatile set search_path=pg_catalog as $$
declare note_entry public.merchant_attendance_plan_exception_entries%rowtype;case_row public.merchant_attendance_plan_exception_cases%rowtype;
  period_entry public.merchant_attendance_period_entries%rowtype;period_row public.merchant_attendance_period_closures%rowtype;
  result jsonb;fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_site is null or p_site!~'^[0-9]{8}$' or p_operation is null or p_category is null then raise exception 'attendance_owner_notification_invalid';end if;
  if p_category='plan_exception' then
    select * into note_entry from public.merchant_attendance_plan_exception_entries x where x.merchant_id=p_site and x.operation_id=p_operation;
    if note_entry.operation_id is null or note_entry.kind is distinct from 'note' or note_entry.actor_auth_user_id is distinct from note_entry.employee_auth_user_id then
      raise exception 'attendance_owner_notification_invalid';end if;
    perform public.faolla_attendance_plan_exception_review_entry_v1(note_entry);
    select * into case_row from public.merchant_attendance_plan_exception_cases x where x.merchant_id=p_site and x.case_id=note_entry.case_id;
    result:=jsonb_build_object('sourceId',note_entry.case_id,'sourceRevision',note_entry.revision,'workerId',note_entry.worker_id,
      'employeeId',note_entry.employee_id,'employeeAuthUserId',note_entry.employee_auth_user_id,'occurredAt',to_char(note_entry.recorded_at at time zone 'UTC',fmt),
      'target',jsonb_build_object('slotId',case_row.slot_id));
  elsif p_category='period' then
    select * into period_entry from public.merchant_attendance_period_entries x where x.merchant_id=p_site and x.operation_id=p_operation;
    if period_entry.operation_id is null or period_entry.action is distinct from 'dispute' then raise exception 'attendance_owner_notification_invalid';end if;
    perform public.faolla_attendance_period_entry_v2(period_entry);
    select * into period_row from public.merchant_attendance_period_closures x where x.merchant_id=p_site and x.period_id=period_entry.period_id;
    if period_row.period_id is null or period_entry.actor_auth_user_id is distinct from period_row.employee_auth_user_id
      or not isfinite(period_entry.recorded_at) or period_entry.recorded_at<period_row.opened_at
      or not exists(select 1 from public.merchant_attendance_period_versions v where v.merchant_id=p_site and v.period_id=period_entry.period_id
        and v.version=period_entry.version and v.recorded_at<=period_entry.recorded_at) then raise exception 'attendance_owner_notification_invalid';end if;
    result:=jsonb_build_object('sourceId',period_entry.period_id,'sourceRevision',period_entry.revision,'workerId',period_row.worker_id,
      'employeeId',period_row.employee_id,'employeeAuthUserId',period_row.employee_auth_user_id,'occurredAt',to_char(period_entry.recorded_at at time zone 'UTC',fmt),
      'target',jsonb_build_object('periodId',period_entry.period_id,'fromDate',to_char(period_row.from_date,'YYYY-MM-DD'),'throughDate',to_char(period_row.through_date,'YYYY-MM-DD')));
  else raise exception 'attendance_owner_notification_invalid';end if;
  if result is null or result->>'sourceId' is null or result->>'workerId' is null or result->>'employeeId' is null or result->>'employeeAuthUserId' is null
    or (result->>'sourceRevision')::bigint not between 1 and 9007199254740990 or octet_length(convert_to(result::text,'UTF8'))>2048 then
    raise exception 'attendance_owner_notification_invalid';end if;
  return result;
end;
$$;

create or replace function public.faolla_attendance_owner_notification_verify_v1(p public.merchant_attendance_owner_notifications)
returns void language plpgsql volatile set search_path=pg_catalog as $$
begin
  if p.notification_id is null or p.recipient_auth_user_id is null or jsonb_build_object('sourceId',p.source_id,'sourceRevision',p.source_revision,
    'workerId',p.worker_id,'employeeId',p.employee_id,'employeeAuthUserId',p.employee_auth_user_id,
    'occurredAt',to_char(p.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'target',p.target)
    is distinct from public.faolla_attendance_owner_notification_source_v1(p.merchant_id,p.source_category,p.operation_id) then raise exception 'attendance_owner_notification_invalid';end if;
end;
$$;

--Receipt validation deliberately stops at its immutable read association. A
--former owner gets neither source metadata nor renewed ownership from this.
create or replace function public.faolla_attendance_owner_notification_receipt_v1(p public.merchant_attendance_owner_notification_operations)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
begin
  if p.operation_id is null or p.actor_auth_user_id is null or not isfinite(p.read_at) or not isfinite(p.recorded_at) or p.recorded_at<p.read_at
    or public.faolla_attendance_shift_rule_binding_object_v1(p.command,array['action','operationId','notificationId']) is distinct from true
    or p.command->>'action' is distinct from 'mark_read' or p.command->>'operationId' is distinct from p.operation_id::text
    or p.command->>'notificationId' is distinct from p.notification_id::text
    or not exists(select 1 from public.merchant_attendance_owner_notification_reads r where r.merchant_id=p.merchant_id and r.notification_id=p.notification_id
      and r.recipient_auth_user_id=p.actor_auth_user_id and r.read_at=p.read_at) then raise exception 'attendance_owner_notification_invalid';end if;
  return jsonb_build_object('operationId',p.operation_id,'notificationId',p.notification_id,'actorId',p.actor_auth_user_id,
    'readAt',to_char(p.read_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end;
$$;

create or replace function public.faolla_attendance_owner_notification_guard_v1()
returns trigger language plpgsql volatile set search_path=pg_catalog as $$
declare notice public.merchant_attendance_owner_notifications%rowtype;owner_at_insert uuid;
begin
  if tg_table_name='merchant_attendance_owner_notifications' then
    --Only INSERT proves the then-current recipient. Historical verification
    --must not reinterpret that recipient after a merchant ownership change.
    select m.user_id into owner_at_insert from public.merchants m where m.id=new.merchant_id for share;
    if owner_at_insert is null or new.recipient_auth_user_id is distinct from owner_at_insert then raise exception 'attendance_owner_notification_invalid';end if;
    perform public.faolla_attendance_owner_notification_verify_v1(new);
  elsif tg_table_name='merchant_attendance_owner_notification_reads' then
    select * into notice from public.merchant_attendance_owner_notifications n where n.merchant_id=new.merchant_id and n.notification_id=new.notification_id;
    if notice.notification_id is null or new.recipient_auth_user_id is distinct from notice.recipient_auth_user_id or new.read_at<notice.occurred_at then
      raise exception 'attendance_owner_notification_invalid';end if;
    perform public.faolla_attendance_owner_notification_verify_v1(notice);
  elsif tg_table_name='merchant_attendance_owner_notification_operations' then
    perform public.faolla_attendance_owner_notification_receipt_v1(new);
  else raise exception 'attendance_owner_notification_invalid';end if;
  return new;
end;
$$;

create or replace function public.faolla_attendance_owner_notification_capture_v1(p_site text,p_category text,p_operation uuid,p_actor uuid,p_command jsonb,p_recipient uuid)
returns void language plpgsql volatile set search_path=pg_catalog as $$
declare source_value jsonb;saved_command jsonb;saved_actor uuid;
begin
  source_value:=public.faolla_attendance_owner_notification_source_v1(p_site,p_category,p_operation);
  if p_category='plan_exception' then
    select x.command,x.actor_auth_user_id into saved_command,saved_actor from public.merchant_attendance_plan_exception_entries x where x.merchant_id=p_site and x.operation_id=p_operation;
  else
    select x.command,x.actor_auth_user_id into saved_command,saved_actor from public.merchant_attendance_period_entries x where x.merchant_id=p_site and x.operation_id=p_operation;
  end if;
  if p_actor is null or p_recipient is null or saved_actor is distinct from p_actor or saved_command is distinct from p_command
    or source_value->>'employeeAuthUserId' is distinct from p_actor::text then raise exception 'attendance_owner_notification_invalid';end if;
  --No conflict suppression, no copied source command/text, and no actor !=
  --recipient restriction: a legitimately bound employee can also own the site.
  insert into public.merchant_attendance_owner_notifications(merchant_id,source_category,operation_id,source_id,source_revision,
    worker_id,employee_id,employee_auth_user_id,recipient_auth_user_id,occurred_at,target)
  values(p_site,p_category,p_operation,(source_value->>'sourceId')::uuid,(source_value->>'sourceRevision')::bigint,
    (source_value->>'workerId')::uuid,(source_value->>'employeeId')::uuid,(source_value->>'employeeAuthUserId')::uuid,p_recipient,
    (source_value->>'occurredAt')::timestamptz,source_value->'target');
end;
$$;

create or replace function public.faolla_attendance_owner_notification_item_v1(p public.merchant_attendance_owner_notifications)
returns jsonb language plpgsql volatile set search_path=pg_catalog as $$
declare seen public.merchant_attendance_owner_notification_reads%rowtype;fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  perform public.faolla_attendance_owner_notification_verify_v1(p);
  select * into seen from public.merchant_attendance_owner_notification_reads r where r.merchant_id=p.merchant_id and r.notification_id=p.notification_id;
  if seen.notification_id is not null and (seen.recipient_auth_user_id is distinct from p.recipient_auth_user_id or seen.read_at<p.occurred_at) then
    raise exception 'attendance_owner_notification_invalid';end if;
  return jsonb_build_object('notificationId',p.notification_id,'sourceCategory',p.source_category,'sourceOperationId',p.operation_id,'sourceId',p.source_id,
    'sourceRevision',p.source_revision,'workerId',p.worker_id,'employeeId',p.employee_id,'employeeAuthUserId',p.employee_auth_user_id,
    'occurredAt',to_char(p.occurred_at at time zone 'UTC',fmt),'readAt',case when seen.notification_id is null then null else to_char(seen.read_at at time zone 'UTC',fmt) end,'target',p.target);
end;
$$;

--174 handles self notes through its locked legacy engine too. Wrap the whole
--public call, not just174's owner/posthoc insertion branch. Original returns
--and all independent old gates are passed through unchanged.
create or replace function public.faolla_attendance_plan_exception_owner_event_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,
  p_allow_write boolean default false,p_allow_posthoc boolean default false,p_allow_clearance boolean default false,
  p_capture_notifications boolean default false,p_capture_owner_notifications boolean default false)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare site text;op uuid;recipient uuid;existed boolean;result jsonb;
begin
  if p_capture_owner_notifications is null then raise exception 'attendance_invalid_request';end if;
  if not p_capture_owner_notifications or p_query->>'access' is distinct from 'self' or p_query->>'mode' is distinct from 'note' or p_command is null then
    return public.faolla_attendance_plan_exception_posthoc_review_v1(p_query,p_auth_user_id,p_command,p_allow_write,p_allow_posthoc,p_allow_clearance,p_capture_notifications);end if;
  if jsonb_typeof(p_query->'siteId')='string' and p_query->>'siteId'~'^[0-9]{8}$'
    and public.faolla_attendance_shift_rule_binding_scalar_v1(p_command->'operationId','uuid') is true then
    site:=p_query->>'siteId';op:=(p_command->>'operationId')::uuid;
    select m.user_id into recipient from public.merchants m where m.id=site for share;
    perform 1 from public.merchant_attendance_settings s where s.merchant_id=site for update;
    select exists(select 1 from public.merchant_attendance_plan_exception_entries x where x.merchant_id=site and x.operation_id=op)
      or exists(select 1 from public.merchant_attendance_plan_exception_reads x where x.merchant_id=site and x.operation_id=op) into existed;
  end if;
  result:=public.faolla_attendance_plan_exception_posthoc_review_v1(p_query,p_auth_user_id,p_command,p_allow_write,p_allow_posthoc,p_allow_clearance,p_capture_notifications);
  if op is not null and not existed then perform public.faolla_attendance_owner_notification_capture_v1(site,'plan_exception',op,p_auth_user_id,p_command,recipient);end if;
  return result;
end;
$$;

create or replace function public.faolla_attendance_period_closure_owner_event_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,
  p_artifact jsonb default null,p_allow_write boolean default false,p_capture_owner_notifications boolean default false)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare site text;op uuid;recipient uuid;existed boolean;result jsonb;
begin
  if p_capture_owner_notifications is null then raise exception 'attendance_invalid_request';end if;
  if not p_capture_owner_notifications or p_query->>'access' is distinct from 'self' or p_command is null or p_command->>'action' is distinct from 'dispute' then
    return public.faolla_attendance_period_closure_v1(p_query,p_auth_user_id,p_command,p_artifact,p_allow_write);end if;
  if jsonb_typeof(p_query->'siteId')='string' and p_query->>'siteId'~'^[0-9]{8}$'
    and public.faolla_attendance_shift_rule_binding_scalar_v1(p_command->'operationId','uuid') is true then
    site:=p_query->>'siteId';op:=(p_command->>'operationId')::uuid;
    select m.user_id into recipient from public.merchants m where m.id=site for share;
    perform 1 from public.merchant_attendance_settings s where s.merchant_id=site for update;
    select exists(select 1 from public.merchant_attendance_period_entries x where x.merchant_id=site and x.operation_id=op) into existed;
  end if;
  result:=public.faolla_attendance_period_closure_v1(p_query,p_auth_user_id,p_command,p_artifact,p_allow_write);
  if op is not null and not existed then perform public.faolla_attendance_owner_notification_capture_v1(site,'period',op,p_auth_user_id,p_command,recipient);end if;
  return result;
end;
$$;

create or replace function public.faolla_attendance_period_closure_owner_event_v2(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,
  p_artifact jsonb default null,p_allow_write boolean default false,p_capture_owner_notifications boolean default false)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare site text;op uuid;recipient uuid;existed boolean;result jsonb;
begin
  if p_capture_owner_notifications is null then raise exception 'attendance_invalid_request';end if;
  if not p_capture_owner_notifications or p_query->>'access' is distinct from 'self' or p_command is null or p_command->>'action' is distinct from 'dispute' then
    return public.faolla_attendance_period_closure_v2(p_query,p_auth_user_id,p_command,p_artifact,p_allow_write);end if;
  if jsonb_typeof(p_query->'siteId')='string' and p_query->>'siteId'~'^[0-9]{8}$'
    and public.faolla_attendance_shift_rule_binding_scalar_v1(p_command->'operationId','uuid') is true then
    site:=p_query->>'siteId';op:=(p_command->>'operationId')::uuid;
    select m.user_id into recipient from public.merchants m where m.id=site for share;
    perform 1 from public.merchant_attendance_settings s where s.merchant_id=site for update;
    select exists(select 1 from public.merchant_attendance_period_entries x where x.merchant_id=site and x.operation_id=op) into existed;
  end if;
  result:=public.faolla_attendance_period_closure_v2(p_query,p_auth_user_id,p_command,p_artifact,p_allow_write);
  if op is not null and not existed then perform public.faolla_attendance_owner_notification_capture_v1(site,'period',op,p_auth_user_id,p_command,recipient);end if;
  return result;
end;
$$;

create or replace function public.faolla_attendance_owner_notifications_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare site text;mode_name text;k text;nid uuid;op uuid;cursor_id uuid;cursor_at timestamptz;current_owner uuid;
  settings_row public.merchant_attendance_settings%rowtype;notice public.merchant_attendance_owner_notifications%rowtype;
  candidate public.merchant_attendance_owner_notifications%rowtype;seen public.merchant_attendance_owner_notification_reads%rowtype;
  saved public.merchant_attendance_owner_notification_operations%rowtype;common jsonb;result jsonb;items jsonb:='[]';item jsonb;next_cursor jsonb;
  count_seen integer:=0;fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_auth_user_id is null or p_allow_write is null or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','mode','notificationId','operationId','beforeAt','beforeId']) is distinct from true
    or octet_length(convert_to(p_query::text,'UTF8'))+coalesce(octet_length(convert_to(p_command::text,'UTF8')),0)>4096
    or jsonb_typeof(p_query->'siteId') is distinct from 'string' or coalesce(p_query->>'siteId','')!~'^[0-9]{8}$'
    or jsonb_typeof(p_query->'mode') is distinct from 'string' or p_query->>'mode' not in('list','detail','recover') then raise exception 'attendance_invalid_request';end if;
  foreach k in array array['notificationId','operationId','beforeId'] loop
    if p_query->k<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->k,'uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  end loop;
  if p_query->'beforeAt'<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'beforeAt','stamp6') is distinct from true then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';mode_name:=p_query->>'mode';nid:=(p_query->>'notificationId')::uuid;op:=(p_query->>'operationId')::uuid;
  cursor_id:=(p_query->>'beforeId')::uuid;cursor_at:=(p_query->>'beforeAt')::timestamptz;
  if (cursor_id is null)<>(cursor_at is null) or mode_name='list' and (nid is not null or op is not null)
    or mode_name='detail' and (nid is null or op is not null or cursor_id is not null)
    or mode_name='recover' and (nid is null or op is null or cursor_id is not null) then raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
    if mode_name<>'detail' or public.faolla_attendance_shift_rule_binding_object_v1(p_command,array['action','operationId','notificationId']) is distinct from true
      or p_command->>'action' is distinct from 'mark_read' or p_command->'notificationId' is distinct from p_query->'notificationId'
      or public.faolla_attendance_shift_rule_binding_scalar_v1(p_command->'operationId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
    op:=(p_command->>'operationId')::uuid;
  end if;
  common:=jsonb_build_object('protocol','owner-attendance-notifications-v1','siteId',site,'actorId',p_auth_user_id);
  --Only this GET can outlive ownership or the read/write rollout. No current
  --owner/settings/member/source lookup, no notification body and no new write.
  if mode_name='recover' then
    select * into saved from public.merchant_attendance_owner_notification_operations x where x.merchant_id=site and x.operation_id=op;
    if saved.operation_id is null then return common||jsonb_build_object('kind','receipt','receipt',null);end if;
    if saved.actor_auth_user_id is distinct from p_auth_user_id or saved.notification_id is distinct from nid then raise exception 'attendance_access_denied';end if;
    return common||jsonb_build_object('kind','receipt','receipt',public.faolla_attendance_owner_notification_receipt_v1(saved));
  end if;
  select m.user_id into current_owner from public.merchants m where m.id=site for share;
  if current_owner is null or current_owner is distinct from p_auth_user_id then raise exception 'attendance_access_denied';end if;
  if p_command is null then select * into settings_row from public.merchant_attendance_settings s where s.merchant_id=site for share;
  else select * into settings_row from public.merchant_attendance_settings s where s.merchant_id=site for update;end if;
  if settings_row.merchant_id is null then raise exception 'attendance_settings_required';end if;
  if nid is not null then
    select * into notice from public.merchant_attendance_owner_notifications n where n.merchant_id=site and n.notification_id=nid and n.recipient_auth_user_id=p_auth_user_id;
    if notice.notification_id is null then raise exception 'attendance_owner_notification_not_found';end if;
    if p_command is not null then
      if not p_allow_write or not settings_row.enabled then raise exception 'attendance_platform_paused';end if;
      select * into saved from public.merchant_attendance_owner_notification_operations x where x.merchant_id=site and x.operation_id=op;
      if saved.operation_id is not null then
        if saved.actor_auth_user_id is distinct from p_auth_user_id or saved.notification_id is distinct from nid or saved.command is distinct from p_command then
          raise exception 'attendance_operation_conflict';end if;
        return common||jsonb_build_object('kind','receipt','receipt',public.faolla_attendance_owner_notification_receipt_v1(saved));
      end if;
      perform public.faolla_attendance_owner_notification_verify_v1(notice);
      select * into seen from public.merchant_attendance_owner_notification_reads r where r.merchant_id=site and r.notification_id=nid;
      if seen.notification_id is null then
        insert into public.merchant_attendance_owner_notification_reads(merchant_id,notification_id,recipient_auth_user_id,read_at)
          values(site,nid,p_auth_user_id,greatest(clock_timestamp(),notice.occurred_at)) returning * into seen;
      elsif seen.recipient_auth_user_id is distinct from p_auth_user_id or seen.read_at<notice.occurred_at then raise exception 'attendance_owner_notification_invalid';end if;
      insert into public.merchant_attendance_owner_notification_operations(merchant_id,operation_id,notification_id,actor_auth_user_id,command,read_at,recorded_at)
        values(site,op,nid,p_auth_user_id,p_command,seen.read_at,greatest(clock_timestamp(),seen.read_at)) returning * into saved;
      result:=common||jsonb_build_object('kind','receipt','receipt',public.faolla_attendance_owner_notification_receipt_v1(saved));
    else result:=common||jsonb_build_object('kind','detail','item',public.faolla_attendance_owner_notification_item_v1(notice),'canMarkRead',p_allow_write and settings_row.enabled);end if;
  else
    if cursor_id is not null and not exists(select 1 from public.merchant_attendance_owner_notifications n where n.merchant_id=site
      and n.notification_id=cursor_id and n.recipient_auth_user_id=p_auth_user_id and n.occurred_at=cursor_at) then raise exception 'attendance_invalid_request';end if;
    for candidate in select n.* from public.merchant_attendance_owner_notifications n where n.merchant_id=site and n.recipient_auth_user_id=p_auth_user_id
      and (cursor_at is null or (n.occurred_at,n.notification_id)<(cursor_at,cursor_id)) order by n.occurred_at desc,n.notification_id desc limit 26 loop
      count_seen:=count_seen+1;exit when count_seen=26;
      item:=public.faolla_attendance_owner_notification_item_v1(candidate);items:=items||jsonb_build_array(item);
      next_cursor:=jsonb_build_object('at',to_char(candidate.occurred_at at time zone 'UTC',fmt),'id',candidate.notification_id);
    end loop;
    result:=common||jsonb_build_object('kind','list','items',items,'nextCursor',case when count_seen=26 then next_cursor else null end);
  end if;
  if octet_length(convert_to(result::text,'UTF8'))>131072 then raise exception 'attendance_owner_notification_too_large';end if;
  return result;
end;
$$;

-- Revoke the bootstrap role only when it is not the private table owner.
do $pilot_private_table_bootstrap_acl$
declare target regclass;
begin
  for target in
    select c.oid::regclass from pg_catalog.pg_class c
    where c.oid=any(array[
      'public.merchant_attendance_owner_notifications'::regclass,
      'public.merchant_attendance_owner_notification_reads'::regclass,
      'public.merchant_attendance_owner_notification_operations'::regclass
    ]) and c.relowner<>(select oid from pg_catalog.pg_roles where rolname='postgres')
  loop
    execute format('revoke all privileges on table %s from postgres',target);
  end loop;
end;
$pilot_private_table_bootstrap_acl$;

do $owner_notification_storage$
declare t regclass;
begin
  foreach t in array array['public.merchant_attendance_owner_notifications'::regclass,'public.merchant_attendance_owner_notification_reads'::regclass,
    'public.merchant_attendance_owner_notification_operations'::regclass] loop
    execute format('alter table %s enable row level security',t);
    execute format('revoke all on %s from public,anon,authenticated,service_role',t);
    if not exists(select 1 from pg_trigger where tgrelid=t and tgname='attendance_owner_notification_immutable') then
      execute format('create trigger attendance_owner_notification_immutable before update or delete on %s for each row execute function public.faolla_attendance_events_append_only_v1()',t);end if;
    if not exists(select 1 from pg_trigger where tgrelid=t and tgname='attendance_owner_notification_no_truncate') then
      execute format('create trigger attendance_owner_notification_no_truncate before truncate on %s for each statement execute function public.faolla_attendance_events_append_only_v1()',t);end if;
    if not exists(select 1 from pg_trigger where tgrelid=t and tgname='attendance_owner_notification_insert_guard') then
      execute format('create trigger attendance_owner_notification_insert_guard before insert on %s for each row execute function public.faolla_attendance_owner_notification_guard_v1()',t);end if;
  end loop;
end;
$owner_notification_storage$;

do $owner_notification_acl$
declare f regprocedure;is_public boolean;
begin
  foreach f in array array['public.faolla_attendance_owner_notification_source_v1(text,text,uuid)'::regprocedure,
    'public.faolla_attendance_owner_notification_verify_v1(public.merchant_attendance_owner_notifications)'::regprocedure,
    'public.faolla_attendance_owner_notification_receipt_v1(public.merchant_attendance_owner_notification_operations)'::regprocedure,
    'public.faolla_attendance_owner_notification_guard_v1()'::regprocedure,
    'public.faolla_attendance_owner_notification_capture_v1(text,text,uuid,uuid,jsonb,uuid)'::regprocedure,
    'public.faolla_attendance_owner_notification_item_v1(public.merchant_attendance_owner_notifications)'::regprocedure,
    'public.faolla_attendance_plan_exception_owner_event_v1(jsonb,uuid,jsonb,boolean,boolean,boolean,boolean,boolean)'::regprocedure,
    'public.faolla_attendance_period_closure_owner_event_v1(jsonb,uuid,jsonb,jsonb,boolean,boolean)'::regprocedure,
    'public.faolla_attendance_period_closure_owner_event_v2(jsonb,uuid,jsonb,jsonb,boolean,boolean)'::regprocedure,
    'public.faolla_attendance_owner_notifications_v1(jsonb,uuid,jsonb,boolean)'::regprocedure] loop
    is_public:=(select prosecdef from pg_proc where oid=f);
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
    if is_public then execute format('grant execute on function %s to service_role',f);end if;
    if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
      or has_function_privilege('service_role',f,'EXECUTE')<>is_public
      or not exists(select 1 from pg_proc p where p.oid=f and p.proowner=(select oid from pg_roles where rolname=current_user)
        and p.proconfig=array['search_path=pg_catalog'] and not p.proretset) then raise exception 'merchant_attendance_owner_notifications_acl_postcondition_failed';end if;
  end loop;
end;
$owner_notification_acl$;

do $owner_notification_postconditions$
declare t regclass;item record;actual_columns text;constraint_shape jsonb;function_name text;
begin
  for item in select * from (values
    ('merchant_attendance_owner_notifications','merchant_id:text:true,notification_id:uuid:true,source_category:text:true,operation_id:uuid:true,source_id:uuid:true,source_revision:bigint:true,worker_id:uuid:true,employee_id:uuid:true,employee_auth_user_id:uuid:true,recipient_auth_user_id:uuid:true,occurred_at:timestamp with time zone:true,target:jsonb:true'),
    ('merchant_attendance_owner_notification_reads','merchant_id:text:true,notification_id:uuid:true,recipient_auth_user_id:uuid:true,read_at:timestamp with time zone:true'),
    ('merchant_attendance_owner_notification_operations','merchant_id:text:true,operation_id:uuid:true,notification_id:uuid:true,actor_auth_user_id:uuid:true,command:jsonb:true,read_at:timestamp with time zone:true,recorded_at:timestamp with time zone:true')) x(name,columns_expected) loop
    t:=to_regclass('public.'||item.name);
    select string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text,',' order by a.attnum) into actual_columns
      from pg_attribute a where a.attrelid=t and a.attnum>0 and not a.attisdropped;
    if actual_columns is distinct from item.columns_expected or not exists(select 1 from pg_class c where c.oid=t and c.relkind='r' and c.relrowsecurity and not c.relforcerowsecurity
      and c.relowner=(select oid from pg_roles where rolname=current_user) and not exists(select 1 from pg_policy where polrelid=c.oid)
      and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where a.grantee<>c.relowner)) then
      raise exception 'merchant_attendance_owner_notifications_storage_postcondition_failed';end if;
    if (select count(*) from pg_trigger g where g.tgrelid=t and not g.tgisinternal)<>3 then raise exception 'merchant_attendance_owner_notifications_trigger_postcondition_failed';end if;
    if not exists(select 1 from pg_trigger g where g.tgrelid=t and g.tgname='attendance_owner_notification_immutable' and g.tgenabled='O' and g.tgtype=27
      and g.tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure and g.tgqual is null and g.tgnargs=0)
      or not exists(select 1 from pg_trigger g where g.tgrelid=t and g.tgname='attendance_owner_notification_no_truncate' and g.tgenabled='O' and g.tgtype=34
        and g.tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure and g.tgqual is null and g.tgnargs=0)
      or not exists(select 1 from pg_trigger g where g.tgrelid=t and g.tgname='attendance_owner_notification_insert_guard' and g.tgenabled='O' and g.tgtype=7
        and g.tgfoid='public.faolla_attendance_owner_notification_guard_v1()'::regprocedure and g.tgqual is null and g.tgnargs=0) then
      raise exception 'merchant_attendance_owner_notifications_trigger_postcondition_failed';end if;
  end loop;
  if not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am a on a.oid=c.relam
    where i.indexrelid='public.attendance_owner_notifications_recipient_idx'::regclass and i.indrelid='public.merchant_attendance_owner_notifications'::regclass
      and a.amname='btree' and i.indisvalid and i.indisready and not i.indisunique and i.indnkeyatts=4 and i.indnatts=4
      and i.indkey::text='1 10 11 2' and i.indoption::text='0 0 3 3' and i.indpred is null and i.indexprs is null) then
    raise exception 'merchant_attendance_owner_notifications_index_postcondition_failed';end if;
  --Pin all identity/idempotency keys and reference mappings independently of
  --generated constraint names. Never accept a same-name weakened uniqueness.
  for item in select * from (values
    ('merchant_attendance_owner_notifications','[{"type":"f","keys":["merchant_id","worker_id"],"ref":"merchant_attendance_workers","refkeys":["merchant_id","id"]},{"type":"f","keys":["merchant_id","employee_id"],"ref":"merchant_enterprise_employees","refkeys":["merchant_id","id"]},{"type":"p","keys":["merchant_id","notification_id"],"ref":null,"refkeys":null},{"type":"u","keys":["merchant_id","notification_id","recipient_auth_user_id"],"ref":null,"refkeys":null},{"type":"u","keys":["merchant_id","source_category","operation_id"],"ref":null,"refkeys":null}]'::jsonb),
    ('merchant_attendance_owner_notification_reads','[{"type":"f","keys":["merchant_id","notification_id","recipient_auth_user_id"],"ref":"merchant_attendance_owner_notifications","refkeys":["merchant_id","notification_id","recipient_auth_user_id"]},{"type":"p","keys":["merchant_id","notification_id"],"ref":null,"refkeys":null},{"type":"u","keys":["merchant_id","notification_id","recipient_auth_user_id","read_at"],"ref":null,"refkeys":null}]'::jsonb),
    ('merchant_attendance_owner_notification_operations','[{"type":"f","keys":["merchant_id","notification_id","actor_auth_user_id","read_at"],"ref":"merchant_attendance_owner_notification_reads","refkeys":["merchant_id","notification_id","recipient_auth_user_id","read_at"]},{"type":"p","keys":["merchant_id","operation_id"],"ref":null,"refkeys":null}]'::jsonb)) x(name,expected) loop
    t:=to_regclass('public.'||item.name);
    select jsonb_agg(jsonb_build_object('type',c.contype,
      'keys',array(select a.attname::text from unnest(c.conkey) with ordinality key_column(num,ordinal) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=key_column.num order by key_column.ordinal),
      'ref',r.relname,'refkeys',case when c.contype='f' then array(select a.attname::text from unnest(c.confkey) with ordinality ref_column(num,ordinal)
        join pg_attribute a on a.attrelid=c.confrelid and a.attnum=ref_column.num order by ref_column.ordinal) else null end) order by c.contype,c.conkey) into constraint_shape
      from pg_constraint c left join pg_class r on r.oid=c.confrelid where c.conrelid=t and c.contype in('p','u','f');
    if constraint_shape is distinct from item.expected or exists(select 1 from pg_constraint c where c.conrelid=t and
      (not c.convalidated or c.condeferrable or c.condeferred or c.contype='f' and (c.confupdtype<>'a' or c.confdeltype<>'a' or c.confmatchtype<>'s'))) then
      raise exception 'merchant_attendance_owner_notifications_constraint_postcondition_failed';end if;
  end loop;
  foreach function_name in array array['faolla_attendance_owner_notification_source_v1','faolla_attendance_owner_notification_verify_v1',
    'faolla_attendance_owner_notification_receipt_v1','faolla_attendance_owner_notification_guard_v1','faolla_attendance_owner_notification_capture_v1',
    'faolla_attendance_owner_notification_item_v1','faolla_attendance_plan_exception_owner_event_v1',
    'faolla_attendance_period_closure_owner_event_v1','faolla_attendance_period_closure_owner_event_v2','faolla_attendance_owner_notifications_v1'] loop
    if (select count(*) from pg_proc p where p.pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass) and p.proname=function_name)<>1 then
      raise exception 'merchant_attendance_owner_notifications_installation_conflict';end if;
  end loop;
end;
$owner_notification_postconditions$;

insert into public.faolla_schema_migrations(version,name) values(202610080188,'merchant_attendance_owner_notifications') on conflict(version) do nothing;
notify pgrst, 'reload schema';
commit;
