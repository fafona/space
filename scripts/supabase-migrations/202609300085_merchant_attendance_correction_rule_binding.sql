-- Local/unreleased attendance candidate. No original punch or effective-hours mutation.
-- Switch the application to v2 before enabling attendance; v1 becomes an internal helper.
begin;
set local lock_timeout='3s';
create table public.merchant_attendance_correction_rule_bindings (
  merchant_id text not null, request_id uuid not null,
  policy_revision bigint not null, command jsonb not null check(jsonb_typeof(command)='object'),
  recorded_at timestamptz not null check(isfinite(recorded_at)),
  primary key(merchant_id,request_id),
  foreign key(merchant_id,request_id) references public.merchant_attendance_correction_entries(merchant_id,operation_id) on delete restrict,
  foreign key(merchant_id,policy_revision) references public.merchant_attendance_correction_controls(merchant_id,revision) on delete restrict
);
alter table public.merchant_attendance_correction_rule_bindings enable row level security;
revoke all on public.merchant_attendance_correction_rule_bindings from public,anon,authenticated,service_role;
create trigger attendance_correction_binding_no_rewrite before update or delete on public.merchant_attendance_correction_rule_bindings
  for each row execute function public.faolla_attendance_events_append_only_v1();
create trigger attendance_correction_binding_no_truncate before truncate on public.merchant_attendance_correction_rule_bindings
  for each statement execute function public.faolla_attendance_events_append_only_v1();

-- Authenticated callers hold the settings lock for the entire read/write transaction.
-- No enterprise-wide lock dates/reasons or authentication identifiers reach the employee.
create function public.faolla_attendance_correction_rules_v1(p_site text,p_result jsonb) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare policy public.merchant_attendance_correction_controls%rowtype;
  binding public.merchant_attendance_correction_rule_bindings%rowtype;
  mode text:=p_result->>'mode';kind text;checked timestamptz;submitted timestamptz;
  original_start timestamptz;original_end timestamptz;proposed_start timestamptz;proposed_end timestamptz;
  anchor date;deadline timestamptz;issues text[]:='{}';locked_count integer;
begin
  if mode not in ('prepare','detail') then raise exception 'attendance_invalid_request';end if;
  checked:=public.faolla_attendance_instant_v1(p_result->>'asOf');
  original_start:=public.faolla_attendance_instant_v1(p_result->'basis'->'events'->0->>'occurredAt');
  original_end:=public.faolla_attendance_instant_v1(p_result->'basis'->'events'->-1->>'occurredAt');
  -- An open declaration must also protect all already recorded break facts, not just its first instant.
  if p_result->'basis'->'events'->-1->>'action'<>'clock_out' or original_end=original_start then
    original_end:=original_end+interval '1 microsecond';
  end if;
  if mode='prepare' then
    kind:='preparation';submitted:=checked;
    select * into policy from public.merchant_attendance_correction_controls where merchant_id=p_site and action='set_policy'
      and recorded_at<=checked order by recorded_at desc,revision desc limit 1;
  else
    submitted:=public.faolla_attendance_instant_v1(p_result->'item'->>'submittedAt');
    proposed_start:=public.faolla_attendance_instant_v1(p_result->'proposal'->>'startAt');
    proposed_end:=public.faolla_attendance_instant_v1(p_result->'proposal'->>'endAt');
    select * into binding from public.merchant_attendance_correction_rule_bindings where merchant_id=p_site and request_id=(p_result->'item'->>'requestId')::uuid;
    if binding.request_id is null then kind:='legacy';issues:=array_append(issues,'legacy_unbound');
    else
      kind:='bound';
      select * into policy from public.merchant_attendance_correction_controls where merchant_id=p_site and revision=binding.policy_revision and action='set_policy';
      if policy.revision is null or policy.recorded_at>submitted or binding.recorded_at<>submitted then raise exception 'attendance_invalid_request';end if;
    end if;
  end if;
  if policy.revision is null then
    if kind<>'legacy' then issues:=array_append(issues,'policy_missing');end if;
  else
    anchor:=(original_start at time zone (policy.payload->>'timeZone'))::date;
    if anchor<date '2000-01-01' or anchor>date '2100-12-31' then issues:=array_append(issues,'unsupported_dates');
    else
      deadline:=public.faolla_attendance_control_day_boundary_v1(anchor+(policy.payload->>'submissionWindowDays')::integer+1,policy.payload->>'timeZone');
      if submitted>=deadline then issues:=array_append(issues,'window_expired');end if;
    end if;
  end if;
  if mode='detail' and (proposed_start<timestamptz '2000-01-01T00:00:00Z' or proposed_end>timestamptz '2101-01-01T00:00:00Z') then
    if not('unsupported_dates'=any(issues)) then issues:=array_append(issues,'unsupported_dates');end if;
  end if;
  select count(*) into locked_count from (select 1 from public.merchant_attendance_correction_periods
    where merchant_id=p_site and locked and ((start_at<original_end and end_at>original_start)
      or (proposed_start is not null and start_at<proposed_end and end_at>proposed_start)) limit 201) locks;
  if locked_count>200 then issues:=array_append(issues,'period_limit');locked_count:=200;
  elsif locked_count>0 then issues:=array_append(issues,'period_locked');end if;
  return jsonb_build_object('binding',kind,'checkedAt',p_result->'asOf','approvalAvailable',false,
    'policy',case when policy.revision is null then null else jsonb_build_object('revision',policy.revision,
      'recordedAt',to_char(policy.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'submissionWindowDays',policy.payload->'submissionWindowDays','timeZone',policy.payload->'timeZone') end,
    'deadlineAt',case when deadline is null then null else to_char(deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
    'lockedPeriodCount',locked_count,'issues',to_jsonb(issues));
end; $$;
revoke all on function public.faolla_attendance_correction_rules_v1(text,jsonb) from public,anon,authenticated,service_role;

create function public.faolla_attendance_correction_self_v2(p_site_id text,p_auth_user_id uuid,p_query jsonb,p_command jsonb default null,p_platform_enabled boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r jsonb;rules jsonb;old_operation boolean:=false;op uuid;
  binding public.merchant_attendance_correction_rule_bindings%rowtype;
  policy public.merchant_attendance_correction_controls%rowtype;
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null then raise exception 'attendance_invalid_request';end if;
  if p_command is not null and p_command ? 'expectedPolicyRevision' then
    if p_command->>'action' is distinct from 'submit' or jsonb_typeof(p_command->'expectedPolicyRevision')<>'number'
      or coalesce(p_command->>'expectedPolicyRevision','') !~ '^[1-9][0-9]{0,15}$'
      or (p_command->>'expectedPolicyRevision')::numeric>9007199254740989 then raise exception 'attendance_invalid_request';end if;
  end if;
  -- Match all existing lock orders; acquire UPDATE before employee/worker locks to avoid lock upgrades.
  perform 1 from public.merchants where id=p_site_id for share;
  if p_command is null then perform 1 from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  else perform 1 from public.merchant_attendance_settings where merchant_id=p_site_id for update;end if;
  if p_command->>'action'='submit' then
    op:=(p_command->>'operationId')::uuid;
    select exists(select 1 from public.merchant_attendance_correction_entries where merchant_id=p_site_id and operation_id=op) into old_operation;
  end if;
  -- v1 still owns identity, current permission, normalized body, raw basis and exact receipt checks.
  r:=public.faolla_attendance_correction_self_v1(p_site_id,p_auth_user_id,p_query,p_command-'expectedPolicyRevision',p_platform_enabled);
  if p_command->>'action'='submit' then
    select * into binding from public.merchant_attendance_correction_rule_bindings where merchant_id=p_site_id and request_id=op;
    if old_operation then
      if (binding.request_id is null and p_command ? 'expectedPolicyRevision') or (binding.request_id is not null and binding.command<>p_command)
        then raise exception 'attendance_operation_conflict';end if;
    else
      if not(p_command ? 'expectedPolicyRevision') then raise exception 'attendance_correction_policy_required';end if;
      select * into policy from public.merchant_attendance_correction_controls where merchant_id=p_site_id and action='set_policy'
        and recorded_at<=public.faolla_attendance_instant_v1(r->'item'->>'submittedAt') order by recorded_at desc,revision desc limit 1;
      if policy.revision is null then raise exception 'attendance_correction_policy_required';end if;
      if policy.revision<>(p_command->>'expectedPolicyRevision')::bigint then raise exception 'attendance_correction_policy_changed';end if;
      insert into public.merchant_attendance_correction_rule_bindings(merchant_id,request_id,policy_revision,command,recorded_at)
        values(p_site_id,op,policy.revision,p_command,public.faolla_attendance_instant_v1(r->'item'->>'submittedAt'));
      rules:=public.faolla_attendance_correction_rules_v1(p_site_id,r);
      -- Any rejection rolls back BOTH the v1 append and the binding. No exception swallowing here.
      if rules->'issues' ? 'window_expired' then raise exception 'attendance_correction_window_expired';end if;
      if rules->'issues' ? 'period_locked' then raise exception 'attendance_correction_period_locked';end if;
      if rules->'issues'<>'[]'::jsonb then raise exception 'attendance_correction_rules_unavailable';end if;
    end if;
  end if;
  if r->>'mode'<>'list' then
    if rules is null then rules:=public.faolla_attendance_correction_rules_v1(p_site_id,r);end if;
    r:=r||jsonb_build_object('rules',rules);
  end if;
  return r||jsonb_build_object('rulesEnforced',true);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end; $$;
revoke all on function public.faolla_attendance_correction_self_v1(text,uuid,jsonb,jsonb,boolean) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_correction_self_v2(text,uuid,jsonb,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_correction_self_v2(text,uuid,jsonb,jsonb,boolean) to service_role;

create function public.faolla_attendance_correction_owner_review_v2(p_site_id text,p_auth_user_id uuid,p_query jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r jsonb;a jsonb;
begin
  r:=public.faolla_attendance_correction_owner_review_v1(p_site_id,p_auth_user_id,p_query);
  if r->>'mode'='detail' then
    a:=r->'application';a:=a||jsonb_build_object('rulesEnforced',true,'rules',public.faolla_attendance_correction_rules_v1(p_site_id,a));
    r:=jsonb_set(r,'{application}',a);
  end if;
  return r||jsonb_build_object('rulesEnforced',true);
end; $$;
revoke all on function public.faolla_attendance_correction_owner_review_v1(text,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_correction_owner_review_v2(text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_correction_owner_review_v2(text,uuid,jsonb) to service_role;

create function public.faolla_attendance_correction_controls_v2(p_site_id text,p_auth_user_id uuid,p_command jsonb default null,
  p_operation_id uuid default null,p_before_revision bigint default null,p_allow_write boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
begin
  return public.faolla_attendance_correction_controls_v1(p_site_id,p_auth_user_id,p_command,p_operation_id,p_before_revision,p_allow_write)
    ||jsonb_build_object('rulesEnforced',true);
end; $$;
revoke all on function public.faolla_attendance_correction_controls_v1(text,uuid,jsonb,uuid,bigint,boolean) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_correction_controls_v2(text,uuid,jsonb,uuid,bigint,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_correction_controls_v2(text,uuid,jsonb,uuid,bigint,boolean) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202609300085,'merchant_attendance_correction_rule_binding') on conflict(version) do nothing;
commit;
