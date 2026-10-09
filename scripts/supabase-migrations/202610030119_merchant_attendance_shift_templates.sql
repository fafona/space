-- Default-off owner daily shift pattern library. No workers, dates, timezone,
-- weekly roster, attendance facts or existing schedule functions are changed.
begin;
set local lock_timeout='3s';

do $shift_templates_prerequisites$
declare installed boolean;
begin
  if to_regclass('public.faolla_schema_migrations') is null or to_regclass('public.merchants') is null
    or to_regclass('public.merchant_attendance_settings') is null
    or to_regprocedure('public.faolla_attendance_events_append_only_v1()') is null then
    raise exception 'merchant_attendance_shift_templates_prerequisite_required';
  end if;
  if not exists(select 1 from public.faolla_schema_migrations where version=202609290061 and name='merchant_attendance_foundation') then
    raise exception 'merchant_attendance_shift_templates_prerequisite_required';
  end if;
  select exists(select 1 from public.faolla_schema_migrations where version=202610030119 and name='merchant_attendance_shift_templates') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610030119 and name<>'merchant_attendance_shift_templates')
    or not installed and (to_regclass('public.merchant_attendance_shift_templates') is not null
      or to_regclass('public.merchant_attendance_shift_template_operations') is not null
      or to_regprocedure('public.faolla_attendance_shift_templates_v1(jsonb,uuid,jsonb,boolean)') is not null)
    or installed and (to_regclass('public.merchant_attendance_shift_templates') is null
      or to_regclass('public.merchant_attendance_shift_template_operations') is null
      or to_regprocedure('public.faolla_attendance_shift_templates_v1(jsonb,uuid,jsonb,boolean)') is null) then
    raise exception 'merchant_attendance_shift_templates_installation_conflict';
  end if;
end;
$shift_templates_prerequisites$;

create table if not exists public.merchant_attendance_shift_templates (
  merchant_id text not null references public.merchant_attendance_settings(merchant_id) on delete restrict,
  template_id uuid not null,revision bigint not null check(revision between 1 and 9007199254740990),
  name text not null check(char_length(name) between 1 and 80
    and name=btrim(name,U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff')
    and name !~ '[[:cntrl:]\u007f-\u009f]'),
  segments jsonb not null check(jsonb_typeof(segments)='array' and jsonb_array_length(segments) between 1 and 4),
  archived boolean not null default false,updated_at timestamptz not null check(isfinite(updated_at)),
  primary key(merchant_id,template_id)
);
create index if not exists attendance_shift_templates_list_idx
  on public.merchant_attendance_shift_templates(merchant_id,archived,template_id desc);
create table if not exists public.merchant_attendance_shift_template_operations (
  merchant_id text not null,operation_id uuid not null,template_id uuid not null,actor_auth_user_id uuid not null,
  command jsonb not null check(jsonb_typeof(command)='object'),snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
  recorded_at timestamptz not null check(isfinite(recorded_at)),
  primary key(merchant_id,operation_id),
  foreign key(merchant_id,template_id) references public.merchant_attendance_shift_templates(merchant_id,template_id) on delete restrict
);
alter table public.merchant_attendance_shift_templates enable row level security;
alter table public.merchant_attendance_shift_template_operations enable row level security;
revoke all on public.merchant_attendance_shift_templates,public.merchant_attendance_shift_template_operations from public,anon,authenticated,service_role;
do $shift_templates_triggers$
begin
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_shift_template_operations'::regclass and tgname='attendance_shift_template_operations_immutable') then
    create trigger attendance_shift_template_operations_immutable before update or delete on public.merchant_attendance_shift_template_operations
      for each row execute function public.faolla_attendance_events_append_only_v1();
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_shift_template_operations'::regclass and tgname='attendance_shift_template_operations_no_truncate') then
    create trigger attendance_shift_template_operations_no_truncate before truncate on public.merchant_attendance_shift_template_operations
      for each statement execute function public.faolla_attendance_events_append_only_v1();
  end if;
end;
$shift_templates_triggers$;

create or replace function public.faolla_attendance_shift_templates_v1(
  p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  site text;view_name text;cursor_id uuid;op uuid;target_id uuid;expected bigint;action_name text;
  value jsonb;segment jsonb;k text;name_value text;start_min integer;end_min integer;prior_end integer;prior_start integer;
  current_row public.merchant_attendance_shift_templates%rowtype;
  receipt_row public.merchant_attendance_shift_template_operations%rowtype;
  item jsonb;items jsonb:='[]';receipt jsonb:='null';next_cursor uuid;count_rows integer:=0;now_at timestamptz;
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_auth_user_id is null or p_allow_write is null or p_query is null or jsonb_typeof(p_query)<>'object' then raise exception 'attendance_invalid_request';end if;
  if (select count(*) from jsonb_object_keys(p_query))<>4 or not(p_query ?& array['siteId','view','cursorId','operationId'])
    or jsonb_typeof(p_query->'siteId')<>'string' or coalesce(p_query->>'siteId','') !~ '^\d{8}$'
    or jsonb_typeof(p_query->'view')<>'string' or coalesce(p_query->>'view','') not in ('active','archived') then raise exception 'attendance_invalid_request';end if;
  foreach k in array array['cursorId','operationId'] loop
    if p_query->k<>'null'::jsonb and (jsonb_typeof(p_query->k)<>'string' or coalesce(p_query->>k,'') !~ uuid_pattern) then raise exception 'attendance_invalid_request';end if;
  end loop;
  site:=p_query->>'siteId';view_name:=p_query->>'view';cursor_id:=(p_query->>'cursorId')::uuid;op:=(p_query->>'operationId')::uuid;
  if cursor_id is not null and op is not null then raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
    if cursor_id is not null or op is not null or jsonb_typeof(p_command)<>'object' then raise exception 'attendance_invalid_request';end if;
    if (select count(*) from jsonb_object_keys(p_command))<>5 or not(p_command ?& array['operationId','templateId','expectedRevision','action','template'])
      or jsonb_typeof(p_command->'action')<>'string' or coalesce(p_command->>'action','') not in ('save','archive')
      or jsonb_typeof(p_command->'expectedRevision')<>'number' or coalesce(p_command->>'expectedRevision','') !~ '^(0|[1-9][0-9]{0,15})$'
      or (p_command->>'expectedRevision')::numeric>9007199254740989 then raise exception 'attendance_invalid_request';end if;
    foreach k in array array['operationId','templateId'] loop
      if jsonb_typeof(p_command->k)<>'string' or coalesce(p_command->>k,'') !~ uuid_pattern then raise exception 'attendance_invalid_request';end if;
    end loop;
    op:=(p_command->>'operationId')::uuid;target_id:=(p_command->>'templateId')::uuid;expected:=(p_command->>'expectedRevision')::bigint;action_name:=p_command->>'action';
    if action_name='archive' then
      if expected<1 or p_command->'template'<>'null'::jsonb then raise exception 'attendance_invalid_request';end if;
    else
      if expected=0 and target_id<>op then raise exception 'attendance_invalid_request';end if;
      value:=p_command->'template';
      if jsonb_typeof(value)<>'object' then raise exception 'attendance_invalid_request';end if;
      if (select count(*) from jsonb_object_keys(value))<>2 or not(value ?& array['name','segments'])
        or jsonb_typeof(value->'name')<>'string' or jsonb_typeof(value->'segments')<>'array' then raise exception 'attendance_invalid_request';end if;
      name_value:=value->>'name';
      if char_length(name_value) not between 1 and 80
        or name_value<>btrim(name_value,U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff')
        or name_value ~ '[[:cntrl:]\u007f-\u009f]'
        or jsonb_array_length(value->'segments') not between 1 and 4 then raise exception 'attendance_invalid_request';end if;
      prior_end:=null;prior_start:=null;
      for segment in select v from jsonb_array_elements(value->'segments') v loop
        if jsonb_typeof(segment)<>'object' then raise exception 'attendance_invalid_request';end if;
        if (select count(*) from jsonb_object_keys(segment))<>3 or not(segment ?& array['start','end','nextDay'])
          or jsonb_typeof(segment->'start')<>'string' or jsonb_typeof(segment->'end')<>'string' or jsonb_typeof(segment->'nextDay')<>'boolean'
          or coalesce(segment->>'start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          or coalesce(segment->>'end','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'attendance_invalid_request';end if;
        start_min:=substring(segment->>'start',1,2)::integer*60+substring(segment->>'start',4,2)::integer;
        end_min:=substring(segment->>'end',1,2)::integer*60+substring(segment->>'end',4,2)::integer+case when (segment->>'nextDay')::boolean then 1440 else 0 end;
        if end_min<=start_min or end_min>start_min+1440 or start_min<=prior_start or start_min<prior_end then raise exception 'attendance_invalid_request';end if;
        prior_start:=start_min;prior_end:=end_min;
      end loop;
    end if;
  end if;

  -- Membership ownership never comes from a historic receipt. The settings row
  -- serializes every write, including the100-active limit, with existing writers.
  perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  if p_command is null then perform 1 from public.merchant_attendance_settings where merchant_id=site for share;
  else perform 1 from public.merchant_attendance_settings where merchant_id=site for update;end if;
  if not found then raise exception 'attendance_settings_required';end if;
  if op is not null then
    select * into receipt_row from public.merchant_attendance_shift_template_operations where merchant_id=site and operation_id=op;
    if receipt_row.operation_id is not null and receipt_row.actor_auth_user_id is distinct from p_auth_user_id then
      if p_command is not null then raise exception 'attendance_operation_conflict';end if;
      receipt_row:=null;
    end if;
  end if;
  if p_command is not null then
    if receipt_row.operation_id is not null then
      if receipt_row.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
    else
      if not p_allow_write then raise exception 'attendance_platform_paused';end if;
      select * into current_row from public.merchant_attendance_shift_templates where merchant_id=site and template_id=target_id for update;
      if expected=0 then
        if current_row.template_id is not null then raise exception 'attendance_version_conflict';end if;
        if (select count(*) from public.merchant_attendance_shift_templates where merchant_id=site and not archived)>=100 then raise exception 'attendance_template_limit';end if;
      else
        if current_row.template_id is null then raise exception 'attendance_not_available';end if;
        if current_row.archived then raise exception 'attendance_template_archived';end if;
        if current_row.revision<>expected then raise exception 'attendance_version_conflict';end if;
      end if;
      now_at:=clock_timestamp();
      if expected=0 then
        insert into public.merchant_attendance_shift_templates(merchant_id,template_id,revision,name,segments,archived,updated_at)
          values(site,target_id,1,name_value,value->'segments',false,now_at) returning * into current_row;
      elsif action_name='save' then
        update public.merchant_attendance_shift_templates set revision=expected+1,name=name_value,segments=value->'segments',updated_at=now_at
          where merchant_id=site and template_id=target_id returning * into current_row;
      else
        update public.merchant_attendance_shift_templates set revision=expected+1,archived=true,updated_at=now_at
          where merchant_id=site and template_id=target_id returning * into current_row;
      end if;
      item:=jsonb_build_object('templateId',current_row.template_id,'revision',current_row.revision,
        'template',jsonb_build_object('name',current_row.name,'segments',current_row.segments),'archived',current_row.archived,
        'updatedAt',to_char(current_row.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
      insert into public.merchant_attendance_shift_template_operations(merchant_id,operation_id,template_id,actor_auth_user_id,command,snapshot,recorded_at)
        values(site,op,target_id,p_auth_user_id,p_command,item,now_at) returning * into receipt_row;
    end if;
  end if;
  if receipt_row.operation_id is not null then receipt:=jsonb_build_object('command',receipt_row.command,'item',receipt_row.snapshot);end if;
  for current_row in select * from public.merchant_attendance_shift_templates where merchant_id=site and archived=(view_name='archived')
    and (cursor_id is null or template_id<cursor_id) order by template_id desc limit 21 loop
    count_rows:=count_rows+1;exit when count_rows=21;
    items:=items||jsonb_build_array(jsonb_build_object('templateId',current_row.template_id,'revision',current_row.revision,
      'template',jsonb_build_object('name',current_row.name,'segments',current_row.segments),'archived',current_row.archived,
      'updatedAt',to_char(current_row.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
    next_cursor:=current_row.template_id;
  end loop;
  return jsonb_build_object('siteId',site,'view',view_name,'items',items,'nextCursor',case when count_rows=21 then next_cursor else null end,'receipt',receipt);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end;
$$;

revoke all on function public.faolla_attendance_shift_templates_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_shift_templates_v1(jsonb,uuid,jsonb,boolean) to service_role;
insert into public.faolla_schema_migrations(version,name)
values(202610030119,'merchant_attendance_shift_templates') on conflict(version) do nothing;
do $shift_templates_postconditions$
declare t regclass;r text;
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610030119 and name='merchant_attendance_shift_templates') then raise exception 'merchant_attendance_shift_templates_registry_postcondition_failed';end if;
  if not has_function_privilege('service_role','public.faolla_attendance_shift_templates_v1(jsonb,uuid,jsonb,boolean)','EXECUTE')
    or has_function_privilege('anon','public.faolla_attendance_shift_templates_v1(jsonb,uuid,jsonb,boolean)','EXECUTE')
    or has_function_privilege('authenticated','public.faolla_attendance_shift_templates_v1(jsonb,uuid,jsonb,boolean)','EXECUTE') then raise exception 'merchant_attendance_shift_templates_acl_postcondition_failed';end if;
  foreach t in array array['public.merchant_attendance_shift_templates'::regclass,'public.merchant_attendance_shift_template_operations'::regclass] loop
    if not (select relrowsecurity from pg_class where oid=t) then raise exception 'merchant_attendance_shift_templates_acl_postcondition_failed';end if;
    foreach r in array array['anon','authenticated','service_role'] loop
      -- Reject ownership as well as every effective table grant, including
      -- defaults, PUBLIC and privileges inherited without SET ROLE.
      if exists(select 1 from pg_class c where c.oid=t and (
        pg_has_role(r,c.relowner,'USAGE')
        or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
          where case when a.grantee=0 then true else pg_has_role(r,a.grantee,'USAGE') end)
      )) then raise exception 'merchant_attendance_shift_templates_acl_postcondition_failed';end if;
    end loop;
  end loop;
end;
$shift_templates_postconditions$;
notify pgrst, 'reload schema';
commit;
