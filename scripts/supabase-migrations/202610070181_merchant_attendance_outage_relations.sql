--222 Explicit pair references only. No merge, transitive inference, copying of
--confirmation, changes to 176-180 functions, work, evidence, period or archive.
begin;
set local lock_timeout='3s';
do $outage_relations_prerequisites$
declare installed boolean;n text;p record;r text;
begin
  if to_regclass('public.faolla_schema_migrations') is null
    or not exists(select 1 from public.faolla_schema_migrations where version=202610070180 and name='merchant_attendance_outage_subject')
    or to_regprocedure('public.faolla_attendance_outage_declaration_v1(public.merchant_attendance_outage_declarations)') is null
    or to_regprocedure('public.faolla_attendance_events_append_only_v1()') is null then raise exception 'merchant_attendance_outage_relations_prerequisite_required';end if;
  select exists(select 1 from public.faolla_schema_migrations where version=202610070181 and name='merchant_attendance_outage_relations') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610070181 and name<>'merchant_attendance_outage_relations')
    or installed<>(to_regclass('public.merchant_attendance_outage_relation_operations') is not null) then raise exception 'merchant_attendance_outage_relations_installation_conflict';end if;
  foreach n in array array['faolla_attendance_outage_relation_command_v1','faolla_attendance_outage_relation_hash_v1','faolla_attendance_outage_relation_evidence_v1',
    'faolla_attendance_outage_relation_entry_v1','faolla_attendance_outage_relation_guard_v1','faolla_attendance_outage_relations_v1'] loop
    if (select count(*) from pg_proc where pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass) and proname=n)<>(case when installed then 1 else 0 end) then
      raise exception 'merchant_attendance_outage_relations_installation_conflict';end if;
    if installed then
      select * into p from pg_proc where pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass) and proname=n;
      if p.prokind<>'f' or p.proretset or p.proargmodes is not null or p.proparallel<>'u'
        or p.proowner<>(select oid from pg_roles where rolname=current_user)
        or p.prosecdef<>(n in('faolla_attendance_outage_relations_v1','faolla_attendance_outage_relation_guard_v1'))
        or p.proconfig is distinct from array['search_path=pg_catalog']::text[] then raise exception 'merchant_attendance_outage_relations_function_conflict';end if;
      foreach r in array array['anon','authenticated','service_role'] loop
        if has_function_privilege(r,p.oid,'EXECUTE') is distinct from (r='service_role' and n='faolla_attendance_outage_relations_v1') then raise exception 'merchant_attendance_outage_relations_permission_conflict';end if;
      end loop;
      if exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.privilege_type='EXECUTE'
        and a.grantee<>p.proowner and not(a.grantee=(select oid from pg_roles where rolname='service_role') and n='faolla_attendance_outage_relations_v1')) then raise exception 'merchant_attendance_outage_relations_permission_conflict';end if;
    end if;
  end loop;
end;
$outage_relations_prerequisites$;

create or replace function public.faolla_attendance_outage_relation_command_v1(p jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
begin
  if p is null or octet_length(convert_to(p::text,'UTF8'))>8192 or jsonb_typeof(p->'action') is distinct from 'string' or p->>'action' not in('apply','revoke')
    or public.faolla_attendance_shift_rule_binding_object_v1(p,(case when p->>'action'='apply' then array['action','operationId','expectedRevision','expectedFingerprint','kind','reason']
      else array['action','operationId','expectedRevision','expectedFingerprint','reason'] end)) is distinct from true
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'operationId','uuid') is distinct from true
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'expectedRevision','head') is distinct from true
    or (p->>'expectedRevision')::numeric not between (case when p->>'action'='apply' then 0 else 1 end) and (case when p->>'action'='apply' then 98 else 99 end)
    or jsonb_typeof(p->'expectedFingerprint') is distinct from 'string' or p->>'expectedFingerprint'!~'^[0-9a-f]{64}$'
    or jsonb_typeof(p->'reason') is distinct from 'string'
    or public.faolla_attendance_group_text_v1(p->>'reason',1,1000) is distinct from true then return false;end if;
  return p->>'action'='revoke' or (jsonb_typeof(p->'kind')='string' and p->>'kind' in('possible_duplicate','complementary'));
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$$;
--Orientation is deliberately retained in this original-operation identity.
create or replace function public.faolla_attendance_outage_relation_hash_v1(p_site text,p_declaration uuid,p_related uuid,p jsonb)
returns text language sql immutable set search_path=pg_catalog as $$
  select encode(sha256(convert_to('['||string_agg(value::text,',' order by ordinal)||']','UTF8')),'hex')
  from jsonb_array_elements(jsonb_build_array(p_site,'owner',p_declaration,p_related,p->'action',p->'operationId',p->'expectedRevision',p->'expectedFingerprint',
    case when p->>'action'='apply' then p->'kind' else 'null'::jsonb end,p->'reason')) with ordinality a(value,ordinal);
$$;
--Only immutable176 declaration projections and current personnel counters.
--Explicit UTC projection in176 avoids session-timezone dependent fingerprints.
create or replace function public.faolla_attendance_outage_relation_evidence_v1(p_left public.merchant_attendance_outage_declarations,p_right public.merchant_attendance_outage_declarations,
  p_worker_version bigint,p_employee_version bigint,p_generation bigint)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
begin
  if p_left.declaration_id is null or p_right.declaration_id is null or p_left.merchant_id<>p_right.merchant_id or p_left.declaration_id>=p_right.declaration_id
    or row(p_left.worker_id,p_left.employee_id,p_left.employee_auth_user_id) is distinct from row(p_right.worker_id,p_right.employee_id,p_right.employee_auth_user_id)
    or p_worker_version is null or p_worker_version<1 or p_employee_version is null or p_employee_version<1 or p_generation is null or p_generation<0 then raise exception 'attendance_outage_relations_invalid';end if;
  return jsonb_build_object('protocol','outage-relation-evidence-v1','siteId',p_left.merchant_id,'workerId',p_left.worker_id,'employeeId',p_left.employee_id,'employeeAuthUserId',p_left.employee_auth_user_id,
    'workerVersion',p_worker_version,'employeeVersion',p_employee_version,'generation',p_generation,'declarations',jsonb_build_array(
      jsonb_build_object('declarationId',p_left.declaration_id,'operationId',p_left.operation_id,'fingerprint',encode(sha256(convert_to(public.faolla_attendance_outage_declaration_v1(p_left)::text,'UTF8')),'hex')),
      jsonb_build_object('declarationId',p_right.declaration_id,'operationId',p_right.operation_id,'fingerprint',encode(sha256(convert_to(public.faolla_attendance_outage_declaration_v1(p_right)::text,'UTF8')),'hex'))));
end;
$$;

create table if not exists public.merchant_attendance_outage_relation_operations(
  merchant_id text not null,left_declaration_id uuid not null,right_declaration_id uuid not null,
  declaration_id uuid not null,related_declaration_id uuid not null,operation_id uuid not null,
  revision integer not null check(revision between 1 and 100),actor_auth_user_id uuid not null,
  action text not null check(action in('apply','revoke')),kind text not null check(kind in('possible_duplicate','complementary')),
  command jsonb not null,command_fingerprint text not null check(command_fingerprint~'^[0-9a-f]{64}$'),
  evidence jsonb,source_fingerprint text not null check(source_fingerprint~'^[0-9a-f]{64}$'),recorded_at timestamptz not null check(isfinite(recorded_at)),
  primary key(merchant_id,operation_id),unique(merchant_id,left_declaration_id,right_declaration_id,revision),
  foreign key(merchant_id,left_declaration_id) references public.merchant_attendance_outage_declarations(merchant_id,declaration_id),
  foreign key(merchant_id,right_declaration_id) references public.merchant_attendance_outage_declarations(merchant_id,declaration_id),
  check(left_declaration_id<right_declaration_id and least(declaration_id,related_declaration_id)=left_declaration_id and greatest(declaration_id,related_declaration_id)=right_declaration_id),
  check((public.faolla_attendance_outage_relation_command_v1(command) is true and command->>'operationId'=operation_id::text and command->>'action'=action
    and (command->>'expectedRevision')::integer=revision-1 and command->>'expectedFingerprint'=source_fingerprint
    and command_fingerprint=public.faolla_attendance_outage_relation_hash_v1(merchant_id,declaration_id,related_declaration_id,command)) is true),
  check(((action='apply' and revision<=99 and kind=command->>'kind' and evidence is not null and octet_length(convert_to(evidence::text,'UTF8'))<=8192
      and source_fingerprint=encode(sha256(convert_to(evidence::text,'UTF8')),'hex')) or (action='revoke' and evidence is null and revision>=2)) is true)
);
alter table public.merchant_attendance_outage_relation_operations enable row level security;
-- Revoke the bootstrap role only when it is not the private table owner.
do $pilot_private_table_bootstrap_acl$
declare target regclass;
begin
  for target in
    select c.oid::regclass from pg_catalog.pg_class c
    where c.oid=any(array[
      'public.merchant_attendance_outage_relation_operations'::regclass
    ]) and c.relowner<>(select oid from pg_catalog.pg_roles where rolname='postgres')
  loop
    execute format('revoke all privileges on table %s from postgres',target);
  end loop;
end;
$pilot_private_table_bootstrap_acl$;

revoke all on public.merchant_attendance_outage_relation_operations from public,anon,authenticated,service_role;
create index if not exists attendance_outage_relation_right_idx on public.merchant_attendance_outage_relation_operations(merchant_id,right_declaration_id,left_declaration_id,revision);

create or replace function public.faolla_attendance_outage_relation_entry_v1(p public.merchant_attendance_outage_relation_operations)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare l public.merchant_attendance_outage_declarations%rowtype;r public.merchant_attendance_outage_declarations%rowtype;
  previous public.merchant_attendance_outage_relation_operations%rowtype;ev jsonb;k text;
begin
  select * into l from public.merchant_attendance_outage_declarations where merchant_id=p.merchant_id and declaration_id=p.left_declaration_id;
  select * into r from public.merchant_attendance_outage_declarations where merchant_id=p.merchant_id and declaration_id=p.right_declaration_id;
  if l.declaration_id is null or r.declaration_id is null or l.declaration_id>=r.declaration_id
    or row(l.worker_id,l.employee_id,l.employee_auth_user_id) is distinct from row(r.worker_id,r.employee_id,r.employee_auth_user_id)
    or p.recorded_at<greatest(l.recorded_at,r.recorded_at) or not isfinite(p.recorded_at)
    or least(p.declaration_id,p.related_declaration_id)<>p.left_declaration_id or greatest(p.declaration_id,p.related_declaration_id)<>p.right_declaration_id
    or public.faolla_attendance_outage_relation_command_v1(p.command) is distinct from true or p.revision not between 1 and 100
    or p.command->>'operationId'<>p.operation_id::text or p.command->>'action'<>p.action or p.kind not in('possible_duplicate','complementary')
    or (p.command->>'expectedRevision')::integer<>p.revision-1 or p.command->>'expectedFingerprint'<>p.source_fingerprint
    or p.command_fingerprint<>public.faolla_attendance_outage_relation_hash_v1(p.merchant_id,p.declaration_id,p.related_declaration_id,p.command) then raise exception 'attendance_outage_relations_invalid';end if;
  if p.revision>1 then
    select * into previous from public.merchant_attendance_outage_relation_operations where merchant_id=p.merchant_id and left_declaration_id=p.left_declaration_id and right_declaration_id=p.right_declaration_id and revision=p.revision-1;
    if previous.operation_id is null or previous.recorded_at>p.recorded_at then raise exception 'attendance_outage_relations_invalid';end if;
  elsif p.action<>'apply' then raise exception 'attendance_outage_relations_invalid';end if;
  if p.action='revoke' then
    if previous.action is distinct from 'apply' or p.kind is distinct from previous.kind or p.source_fingerprint is distinct from previous.source_fingerprint or p.evidence is not null then raise exception 'attendance_outage_relations_invalid';end if;
  elsif p.action='apply' then
    if p.revision>99 or p.kind is distinct from p.command->>'kind'
      or public.faolla_attendance_shift_rule_binding_object_v1(p.evidence,array['protocol','siteId','workerId','employeeId','employeeAuthUserId','workerVersion','employeeVersion','generation','declarations']) is distinct from true then raise exception 'attendance_outage_relations_invalid';end if;
    foreach k in array array['workerVersion','employeeVersion','generation'] loop
      if public.faolla_attendance_shift_rule_binding_scalar_v1(p.evidence->k,(case when k='generation' then 'head' else 'version' end)) is distinct from true then raise exception 'attendance_outage_relations_invalid';end if;
    end loop;
    ev:=public.faolla_attendance_outage_relation_evidence_v1(l,r,(p.evidence->>'workerVersion')::bigint,(p.evidence->>'employeeVersion')::bigint,(p.evidence->>'generation')::bigint);
    if ev is distinct from p.evidence or p.source_fingerprint<>encode(sha256(convert_to(ev::text,'UTF8')),'hex') then raise exception 'attendance_outage_relations_invalid';end if;
  else raise exception 'attendance_outage_relations_invalid';end if;
  return jsonb_build_object('pair',jsonb_build_array(p.left_declaration_id,p.right_declaration_id),'operationId',p.operation_id,'revision',p.revision,'action',p.action,'kind',p.kind,
    'actorId',p.actor_auth_user_id,'reason',p.command->'reason','evidence',p.evidence,'sourceText',(case when p.evidence is null then null else p.evidence::text end),
    'fingerprint',p.source_fingerprint,'recordedAt',to_char(p.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end;
$$;
create or replace function public.faolla_attendance_outage_relation_guard_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare target uuid;count_pairs integer;
begin
  perform public.faolla_attendance_outage_relation_entry_v1(new);
  --Counts EVER-associated pairs; revoking never frees a capacity slot.
  foreach target in array array[new.left_declaration_id,new.right_declaration_id] loop
    select count(*) into count_pairs from (select distinct left_declaration_id,right_declaration_id from public.merchant_attendance_outage_relation_operations
      where merchant_id=new.merchant_id and (left_declaration_id=target or right_declaration_id=target) limit 26) pairs;
    if count_pairs>25 then raise exception 'attendance_outage_relations_limit';end if;
  end loop;
  return new;
end;
$$;
do $outage_relations_triggers$
begin
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_outage_relation_operations'::regclass and tgname='attendance_outage_relation_immutable') then
    create trigger attendance_outage_relation_immutable before update or delete on public.merchant_attendance_outage_relation_operations for each row execute function public.faolla_attendance_events_append_only_v1();end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_outage_relation_operations'::regclass and tgname='attendance_outage_relation_no_truncate') then
    create trigger attendance_outage_relation_no_truncate before truncate on public.merchant_attendance_outage_relation_operations for each statement execute function public.faolla_attendance_events_append_only_v1();end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_outage_relation_operations'::regclass and tgname='attendance_outage_relation_valid') then
    create trigger attendance_outage_relation_valid after insert on public.merchant_attendance_outage_relation_operations for each row execute function public.faolla_attendance_outage_relation_guard_v1();end if;
end;
$outage_relations_triggers$;

create or replace function public.faolla_attendance_outage_relations_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;access_name text;mode_name text;did uuid;related uuid;left_id uuid;right_id uuid;op uuid;self_worker uuid;before_rev integer;keys text[];
  d public.merchant_attendance_outage_declarations%rowtype;l public.merchant_attendance_outage_declarations%rowtype;r public.merchant_attendance_outage_declarations%rowtype;
  w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;s public.merchant_attendance_settings%rowtype;
  role_row public.merchant_enterprise_roles%rowtype;epoch public.merchant_attendance_account_epochs%rowtype;
  head public.merchant_attendance_outage_relation_operations%rowtype;saved public.merchant_attendance_outage_relation_operations%rowtype;row_item public.merchant_attendance_outage_relation_operations%rowtype;
  revision_no integer:=0;current_item jsonb;preview jsonb;receipt jsonb;items jsonb:='[]';history jsonb:='[]';truncated boolean:=false;can_write boolean:=false;
  entry jsonb;evidence jsonb;fp text;kind_name text;generation_no bigint;identity_ok boolean;eligible boolean;blocks text[]:=array[]::text[];pair_count integer;target uuid;n integer:=0;result jsonb;
  fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_auth_user_id is null or p_allow_write is null or p_query is null or octet_length(convert_to(p_query::text,'UTF8'))>4096
    or jsonb_typeof(p_query->'siteId') is distinct from 'string' or p_query->>'siteId'!~'^[0-9]{8}$'
    or jsonb_typeof(p_query->'access') is distinct from 'string' or p_query->>'access' not in('owner','self')
    or jsonb_typeof(p_query->'mode') is distinct from 'string' or p_query->>'mode' not in('list','detail','history','recover')
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'declarationId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';access_name:=p_query->>'access';mode_name:=p_query->>'mode';did:=(p_query->>'declarationId')::uuid;
  keys:=array['siteId','access','mode','declarationId']||(case when mode_name='list' then array[]::text[] else array['relatedDeclarationId'] end)
    ||(case mode_name when 'history' then array['beforeRevision'] when 'recover' then array['operationId'] else array[]::text[] end);
  if public.faolla_attendance_shift_rule_binding_object_v1(p_query,keys) is distinct from true then raise exception 'attendance_invalid_request';end if;
  if mode_name<>'list' then
    if public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'relatedDeclarationId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
    related:=(p_query->>'relatedDeclarationId')::uuid;if related=did then raise exception 'attendance_invalid_request';end if;
    left_id:=least(did,related);right_id:=greatest(did,related);
  end if;
  if mode_name='history' then
    if p_query->'beforeRevision'<>'null'::jsonb and (public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'beforeRevision','version') is distinct from true or (p_query->>'beforeRevision')::numeric>101) then raise exception 'attendance_invalid_request';end if;
    before_rev:=(p_query->>'beforeRevision')::integer;
  elsif mode_name='recover' then
    if access_name<>'owner' or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'operationId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;op:=(p_query->>'operationId')::uuid;
  end if;
  if p_command is not null then
    if mode_name<>'detail' or access_name<>'owner' or public.faolla_attendance_outage_relation_command_v1(p_command) is distinct from true then raise exception 'attendance_invalid_request';end if;op:=(p_command->>'operationId')::uuid;
  end if;
  perform 1 from public.merchants where id=site and (access_name='self' or user_id=p_auth_user_id) for share;
  if not found then raise exception 'attendance_access_denied';end if;
  select * into s from public.merchant_attendance_settings where merchant_id=site for update;
  if not found then raise exception 'attendance_settings_required';end if;
  if access_name='self' then
    --Resolve only the lock target from Auth; authorize the locked current pair
    --before testing any declaration ID or revealing a related pair's existence.
    select x.id into self_worker from public.merchant_attendance_workers x join public.merchant_enterprise_employees y
      on y.merchant_id=x.merchant_id and y.id=x.employee_id where x.merchant_id=site and y.auth_user_id=p_auth_user_id;
    select * into w from public.merchant_attendance_workers where merchant_id=site and id=self_worker for update;
    select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;
    if w.id is null or e.id is null or e.auth_user_id is distinct from p_auth_user_id or e.status is distinct from 'active' then raise exception 'attendance_access_denied';end if;
    select * into role_row from public.merchant_enterprise_roles where merchant_id=site and id=e.role_id for share;
    if role_row.id is null or role_row.status<>'active' or public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions) is distinct from true
      or not role_row.permissions @> array['enterprise.view','attendance.self.view','attendance.self.request']::text[] then raise exception 'attendance_access_denied';end if;
  end if;
  select * into d from public.merchant_attendance_outage_declarations where merchant_id=site and declaration_id=did
    and (access_name='owner' or row(worker_id,employee_id,employee_auth_user_id)=row(w.id,e.id,p_auth_user_id));
  if d.declaration_id is null then raise exception 'attendance_outage_relations_not_found';end if;
  if related is not null then
    select * into l from public.merchant_attendance_outage_declarations where merchant_id=site and declaration_id=left_id
      and (access_name='owner' or row(worker_id,employee_id,employee_auth_user_id)=row(w.id,e.id,p_auth_user_id));
    select * into r from public.merchant_attendance_outage_declarations where merchant_id=site and declaration_id=right_id
      and (access_name='owner' or row(worker_id,employee_id,employee_auth_user_id)=row(w.id,e.id,p_auth_user_id));
    if l.declaration_id is null or r.declaration_id is null then raise exception 'attendance_outage_relations_not_found';end if;
    if row(l.worker_id,l.employee_id,l.employee_auth_user_id) is distinct from row(r.worker_id,r.employee_id,r.employee_auth_user_id) then raise exception 'attendance_outage_relations_blocked';end if;
  end if;
  --Current owner and exact original direction, before current personnel state,
  --rollout, capacity or CAS. No employee confirms or inherits another receipt.
  if op is not null then
    select * into saved from public.merchant_attendance_outage_relation_operations where merchant_id=site and operation_id=op;
    if saved.operation_id is not null then
      if saved.actor_auth_user_id<>p_auth_user_id or saved.left_declaration_id<>left_id or saved.right_declaration_id<>right_id then raise exception 'attendance_access_denied';end if;
      if saved.declaration_id<>did or saved.related_declaration_id<>related or (p_command is not null and saved.command is distinct from p_command) then raise exception 'attendance_operation_conflict';end if;
      entry:=public.faolla_attendance_outage_relation_entry_v1(saved);revision_no:=saved.revision;
      receipt:=jsonb_build_object('operationId',saved.operation_id,'commandFingerprint',saved.command_fingerprint,'entry',entry);
    elsif mode_name='recover' then raise exception 'attendance_outage_relations_not_found';end if;
  end if;
  if receipt is null then
    if access_name='owner' then
      select * into w from public.merchant_attendance_workers where merchant_id=site and id=d.worker_id for update;
      select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;
    end if;
    identity_ok:=row(w.id,w.employee_id,e.id,e.auth_user_id) is not distinct from row(d.worker_id,d.employee_id,d.employee_id,d.employee_auth_user_id);
    if access_name='self' and not identity_ok then raise exception 'attendance_access_denied';end if;
    --Stable canonical order, same parent settings/worker/employee lock hierarchy.
    perform 1 from public.merchant_attendance_outage_declarations where merchant_id=site and declaration_id=any(array[did,related]) order by declaration_id for share;
    select * into epoch from public.merchant_attendance_account_epochs where merchant_id=site and employee_id=d.employee_id;
    generation_no:=coalesce(epoch.generation,0);
    if mode_name='list' then
      for row_item in select x.* from (select distinct on(left_declaration_id,right_declaration_id) a.* from public.merchant_attendance_outage_relation_operations a
        where merchant_id=site and (left_declaration_id=did or right_declaration_id=did) order by left_declaration_id,right_declaration_id,revision desc) x
        order by (case when x.left_declaration_id=did then x.right_declaration_id else x.left_declaration_id end) limit 26 loop
        n:=n+1;if n>25 then raise exception 'attendance_outage_relations_too_large';end if;
        entry:=public.faolla_attendance_outage_relation_entry_v1(row_item);items:=items||jsonb_build_array(entry-'evidence'-'sourceText');
      end loop;
    else
      select * into head from public.merchant_attendance_outage_relation_operations where merchant_id=site and left_declaration_id=left_id and right_declaration_id=right_id order by revision desc limit 1;
      revision_no:=coalesce(head.revision,0);
      if head.operation_id is not null then current_item:=public.faolla_attendance_outage_relation_entry_v1(head);end if;
      if mode_name='history' then
        current_item:=null;
        for row_item in select * from public.merchant_attendance_outage_relation_operations where merchant_id=site and left_declaration_id=left_id and right_declaration_id=right_id
          and (before_rev is null or revision<before_rev) order by revision desc limit 26 loop
          n:=n+1;if n>25 then truncated:=true;exit;end if;
          entry:=public.faolla_attendance_outage_relation_entry_v1(row_item);history:=history||jsonb_build_array(entry-'evidence'-'sourceText');
        end loop;
      else
        if not identity_ok then blocks:=array_append(blocks,'identity_changed');
        else
          evidence:=public.faolla_attendance_outage_relation_evidence_v1(l,r,w.version,e.version,generation_no);fp:=encode(sha256(convert_to(evidence::text,'UTF8')),'hex');
          if not w.active then blocks:=array_append(blocks,'worker_inactive');end if;
          if e.status<>'active' then blocks:=array_append(blocks,'employee_inactive');end if;
          if coalesce(epoch.paused,false) then blocks:=array_append(blocks,'account_suspended');end if;
        end if;
        if not s.enabled then blocks:=array_append(blocks,'settings_disabled');end if;
        if revision_no>=99 then blocks:=array_append(blocks,'revision_limit');end if;
        if head.operation_id is null then
          foreach target in array array[left_id,right_id] loop
            select count(*) into pair_count from (select distinct left_declaration_id,right_declaration_id from public.merchant_attendance_outage_relation_operations
              where merchant_id=site and (left_declaration_id=target or right_declaration_id=target) limit 26) pairs;
            if pair_count>=25 then blocks:=array_append(blocks,'pair_limit');end if;
          end loop;
        end if;
        select coalesce(array_agg(distinct value order by value),array[]::text[]) into blocks from unnest(blocks) value;
        eligible:=evidence is not null and cardinality(blocks)=0;
        preview:=jsonb_build_object('fingerprint',fp,'evidence',evidence,'sourceText',(case when evidence is null then null else evidence::text end),'eligible',eligible,'blockers',to_jsonb(blocks));
        if p_command is not null then
          if not p_allow_write then raise exception 'attendance_outage_relations_disabled';end if;
          if revision_no<>(p_command->>'expectedRevision')::integer then raise exception 'attendance_outage_relations_changed';end if;
          if revision_no>=100 or (p_command->>'action'='apply' and ('revision_limit'=any(blocks) or 'pair_limit'=any(blocks))) then raise exception 'attendance_outage_relations_limit';end if;
          if p_command->>'action'='revoke' then
            if head.action is distinct from 'apply' or head.source_fingerprint is distinct from p_command->>'expectedFingerprint' then raise exception 'attendance_outage_relations_changed';end if;
            evidence:=null;fp:=head.source_fingerprint;kind_name:=head.kind;
          else
            if not s.enabled then raise exception 'attendance_platform_paused';end if;
            if not eligible then raise exception 'attendance_outage_relations_blocked';end if;
            if fp is distinct from p_command->>'expectedFingerprint' then raise exception 'attendance_outage_relations_changed';end if;kind_name:=p_command->>'kind';
          end if;
          insert into public.merchant_attendance_outage_relation_operations(merchant_id,left_declaration_id,right_declaration_id,declaration_id,related_declaration_id,operation_id,revision,actor_auth_user_id,action,kind,command,command_fingerprint,evidence,source_fingerprint,recorded_at)
            values(site,left_id,right_id,did,related,op,revision_no+1,p_auth_user_id,p_command->>'action',kind_name,p_command,public.faolla_attendance_outage_relation_hash_v1(site,did,related,p_command),evidence,fp,clock_timestamp()) returning * into saved;
          entry:=public.faolla_attendance_outage_relation_entry_v1(saved);revision_no:=saved.revision;receipt:=jsonb_build_object('operationId',op,'commandFingerprint',saved.command_fingerprint,'entry',entry);current_item:=null;preview:=null;
        else can_write:=access_name='owner' and p_allow_write and (eligible or (head.action='apply' and revision_no<100));can_write:=coalesce(can_write,false);
        end if;
      end if;
    end if;
  end if;
  result:=jsonb_build_object('protocol','attendance-outage-relations-v1','siteId',site,'access',access_name,'mode',mode_name,'actorId',p_auth_user_id,'declarationId',did,'relatedDeclarationId',related,
    'readAt',to_char(clock_timestamp() at time zone 'UTC',fmt),'canWrite',can_write,'items',items,'revision',revision_no,'current',current_item,'preview',preview,'history',history,'historyTruncated',truncated,'receipt',receipt);
  if octet_length(convert_to(result::text,'UTF8'))>262144 then raise exception 'attendance_outage_relations_too_large';end if;
  return result;
end;
$$;

revoke all on function public.faolla_attendance_outage_relation_command_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_outage_relation_hash_v1(text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_outage_relation_evidence_v1(public.merchant_attendance_outage_declarations,public.merchant_attendance_outage_declarations,bigint,bigint,bigint) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_outage_relation_entry_v1(public.merchant_attendance_outage_relation_operations) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_outage_relation_guard_v1() from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_outage_relations_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_outage_relations_v1(jsonb,uuid,jsonb,boolean) to service_role;
do $outage_relations_permissions$
declare p record;f record;r text;priv text;t regclass:='public.merchant_attendance_outage_relation_operations'::regclass;idx record;
begin
  for f in select * from (values
    ('faolla_attendance_outage_relation_command_v1','jsonb','boolean',array['p'],'i',0,false,'plpgsql'),
    ('faolla_attendance_outage_relation_hash_v1','text,uuid,uuid,jsonb','text',array['p_site','p_declaration','p_related','p'],'i',0,false,'sql'),
    ('faolla_attendance_outage_relation_evidence_v1','public.merchant_attendance_outage_declarations,public.merchant_attendance_outage_declarations,bigint,bigint,bigint','jsonb',array['p_left','p_right','p_worker_version','p_employee_version','p_generation'],'s',0,false,'plpgsql'),
    ('faolla_attendance_outage_relation_entry_v1','public.merchant_attendance_outage_relation_operations','jsonb',array['p'],'v',0,false,'plpgsql'),
    ('faolla_attendance_outage_relation_guard_v1','','trigger',null::text[],'v',0,true,'plpgsql'),
    ('faolla_attendance_outage_relations_v1','jsonb,uuid,jsonb,boolean','jsonb',array['p_query','p_auth_user_id','p_command','p_allow_write'],'v',2,true,'plpgsql')) a(name,args,return_type,names,volatility,defaults,definer,language_name) loop
    select x.*,l.lanname into p from pg_proc x join pg_language l on l.oid=x.prolang where x.oid=to_regprocedure('public.'||f.name||'('||f.args||')');
    if p.oid is null or p.prokind<>'f' or p.proretset or p.proargmodes is not null or p.proparallel<>'u' or p.lanname<>f.language_name or p.provolatile::text<>f.volatility
      or p.proowner<>(select oid from pg_roles where rolname=current_user) or p.prosecdef<>f.definer or p.proconfig is distinct from array['search_path=pg_catalog']::text[]
      or p.proargnames is distinct from f.names or p.pronargs<>coalesce(cardinality(f.names),0) or p.pronargdefaults<>f.defaults or p.prorettype<>f.return_type::regtype
      or (select count(*) from pg_proc x where x.pronamespace=p.pronamespace and x.proname=p.proname)<>1 then raise exception 'merchant_attendance_outage_relations_function_conflict';end if;
    foreach r in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(r,p.oid,'EXECUTE') is distinct from (r='service_role' and f.name='faolla_attendance_outage_relations_v1') then raise exception 'merchant_attendance_outage_relations_permission_conflict';end if;
    end loop;
    if exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.privilege_type='EXECUTE'
      and a.grantee<>p.proowner and not(a.grantee=(select oid from pg_roles where rolname='service_role') and f.name='faolla_attendance_outage_relations_v1')) then raise exception 'merchant_attendance_outage_relations_permission_conflict';end if;
  end loop;
  if not (select relrowsecurity from pg_class where oid=t) or exists(select 1 from pg_policy where polrelid=t)
    or exists(select 1 from pg_class x cross join lateral aclexplode(coalesce(x.relacl,acldefault('r',x.relowner))) a where x.oid=t and a.grantee<>x.relowner) then raise exception 'merchant_attendance_outage_relations_permission_conflict';end if;
  foreach r in array array['anon','authenticated','service_role'] loop
    for priv in select a.privilege_type from pg_class c cross join lateral aclexplode(acldefault('r',c.relowner)) a where c.oid=t loop
      if has_table_privilege(r,t,priv) then raise exception 'merchant_attendance_outage_relations_permission_conflict';end if;
    end loop;
  end loop;
  if (select count(*) from pg_trigger where tgrelid=t and not tgisinternal)<>3 or (select count(*) from pg_trigger where tgrelid=t and not tgisinternal and tgenabled='O' and (
    (tgname='attendance_outage_relation_immutable' and tgtype=27 and tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure)
    or (tgname='attendance_outage_relation_no_truncate' and tgtype=34 and tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure)
    or (tgname='attendance_outage_relation_valid' and tgtype=5 and tgfoid='public.faolla_attendance_outage_relation_guard_v1()'::regprocedure)))<>3 then raise exception 'merchant_attendance_outage_relations_installation_conflict';end if;
  select i.*,c.relname,am.amname into idx from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam where i.indexrelid=to_regclass('public.attendance_outage_relation_right_idx');
  if idx.indexrelid is null or idx.indrelid<>t or idx.amname<>'btree' or not idx.indisvalid or not idx.indisready or idx.indisunique or idx.indpred is not null or idx.indexprs is not null
    or (select array_agg(a.attname::text order by k.ordinal) from unnest(idx.indkey::smallint[]) with ordinality k(num,ordinal) join pg_attribute a on a.attrelid=t and a.attnum=k.num)
      is distinct from array['merchant_id','right_declaration_id','left_declaration_id','revision']::text[] then raise exception 'merchant_attendance_outage_relations_installation_conflict';end if;
end;
$outage_relations_permissions$;
insert into public.faolla_schema_migrations(version,name) values(202610070181,'merchant_attendance_outage_relations') on conflict(version) do nothing;
notify pgrst, 'reload schema';
commit;
