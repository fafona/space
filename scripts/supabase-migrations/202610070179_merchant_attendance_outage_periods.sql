--215 Relevant outage review context and fresh-send gate only. No changes to
--work calculations, raw sources, old migrations, archives, or outage writers.
--This local, unexposed foundation uses a normal index in the guarded transaction.
--Production publication requires an independent data-size/lock preflight.
begin;
set local lock_timeout='3s';
do $outage_period_prerequisites$
declare installed boolean;signature text;meta record;role_name text;service_allowed boolean;
begin
  if to_regclass('public.faolla_schema_migrations') is null
    or not exists(select 1 from public.faolla_schema_migrations where version=202610060175 and name='merchant_attendance_plan_posthoc_periods')
    or not exists(select 1 from public.faolla_schema_migrations where version=202610070178 and name='merchant_attendance_outage_reviews')
    or to_regprocedure('public.faolla_attendance_outage_review_basis_v1(public.merchant_attendance_outage_declarations,bigint,bigint,bigint,boolean)') is null
    or to_regprocedure('public.faolla_attendance_outage_review_entry_v1(public.merchant_attendance_outage_review_operations)') is null
    or to_regprocedure('public.faolla_attendance_outage_review_proposal_v1(public.merchant_attendance_outage_review_operations)') is null then raise exception 'merchant_attendance_outage_periods_prerequisite_required';end if;
  select exists(select 1 from public.faolla_schema_migrations where version=202610070179 and name='merchant_attendance_outage_periods') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610070179 and name<>'merchant_attendance_outage_periods')
    or installed<>(to_regprocedure('public.faolla_attendance_outage_period_context_v1(text,uuid,uuid,uuid,timestamp with time zone,timestamp with time zone)') is not null)
    or not installed and exists(select 1 from pg_proc where pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass) and proname='faolla_attendance_outage_period_context_v1') then
    raise exception 'merchant_attendance_outage_periods_installation_conflict';end if;
  if installed then
    signature:='public.faolla_attendance_outage_period_context_v1(text,uuid,uuid,uuid,timestamp with time zone,timestamp with time zone)';
    select p.*,l.lanname into meta from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(signature);
    if meta.oid is null or meta.prokind<>'f' or meta.lanname<>'plpgsql' or meta.prosecdef or meta.proretset
      or meta.proargmodes is not null or meta.proparallel<>'u' or meta.pronargs<>6 or meta.pronargdefaults<>0 or meta.prorettype<>'jsonb'::regtype
      or meta.provolatile<>'v' or meta.proconfig is distinct from array['search_path=pg_catalog']::text[]
      or meta.proargnames is distinct from array['p_site','p_worker','p_employee','p_employee_auth','p_from','p_to']::text[]
      or (select count(*) from pg_proc p where p.pronamespace=meta.pronamespace and p.proname=meta.proname)<>1 then raise exception 'merchant_attendance_outage_periods_function_conflict';end if;
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(role_name,signature,'EXECUTE') then raise exception 'merchant_attendance_outage_periods_function_conflict';end if;
    end loop;
    if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=meta.oid
      and a.privilege_type='EXECUTE' and a.grantee<>p.proowner) then raise exception 'merchant_attendance_outage_periods_function_conflict';end if;
  end if;
  foreach signature in array array['public.faolla_attendance_period_closure_source_base_v1(jsonb,uuid)',
    'public.faolla_attendance_period_closure_source_v1(jsonb,uuid)','public.faolla_attendance_period_closure_v1(jsonb,uuid,jsonb,jsonb,boolean)'] loop
    select p.*,l.lanname into meta from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(signature);
    if meta.oid is null or meta.prokind<>'f' or meta.lanname<>'plpgsql' or not meta.prosecdef or meta.proretset
      or meta.proargmodes is not null or meta.proparallel<>'u' or meta.pronargs<>(case when signature like '%boolean)' then 5 else 2 end)
      or meta.prorettype<>'jsonb'::regtype or meta.provolatile<>'v' or meta.proconfig is distinct from array['search_path=pg_catalog']::text[]
      or meta.pronargdefaults<>(case when signature like '%boolean)' then 3 else 0 end)
      or meta.proargnames is distinct from (case when signature like '%boolean)' then array['p_query','p_auth_user_id','p_command','p_artifact','p_allow_write']::text[] else array['p_query','p_auth_user_id']::text[] end) then
      raise exception 'merchant_attendance_outage_periods_function_conflict';end if;
    service_allowed:=signature<>'public.faolla_attendance_period_closure_source_base_v1(jsonb,uuid)';
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(role_name,signature,'EXECUTE') is distinct from (role_name='service_role' and service_allowed) then raise exception 'merchant_attendance_outage_periods_function_conflict';end if;
    end loop;
    if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=meta.oid
      and a.privilege_type='EXECUTE' and a.grantee<>p.proowner and (not service_allowed or a.grantee<>(select oid from pg_roles where rolname='service_role'))) then raise exception 'merchant_attendance_outage_periods_function_conflict';end if;
  end loop;
end;
$outage_period_prerequisites$;

do $outage_period_index_preflight$
declare idx oid:=to_regclass('public.attendance_outage_declaration_period_idx');
begin
  if idx is null and exists(select 1 from public.faolla_schema_migrations where version=202610070179) then raise exception 'merchant_attendance_outage_periods_index_conflict';end if;
  if idx is not null and not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam
    where i.indexrelid=idx and i.indrelid='public.merchant_attendance_outage_declarations'::regclass and am.amname='btree'
      and i.indisvalid and i.indisready and i.indislive and not i.indisunique and not i.indisexclusion and i.indnatts=5 and i.indnkeyatts=5
      and i.indexprs is not null and i.indpred is null
      and pg_get_indexdef(idx,1,true)='merchant_id' and pg_get_indexdef(idx,2,true)='worker_id' and pg_get_indexdef(idx,5,true)='declaration_id'
      and regexp_replace(replace(pg_get_indexdef(idx,3,true),'::text',''),'[[:space:]()]','','g')='declared_interval->>''startAt'''
      and regexp_replace(replace(pg_get_indexdef(idx,4,true),'::text',''),'[[:space:]()]','','g')='declared_interval->>''endAt'''
      and not exists(select 1 from unnest(i.indoption::smallint[]) option_bits where option_bits<>0)
      and i.indcollation[0]=(select attcollation from pg_attribute where attrelid=i.indrelid and attname='merchant_id') and i.indcollation[1]=0 and i.indcollation[4]=0
      and i.indcollation[2]=(select oid from pg_collation where collnamespace='pg_catalog'::regnamespace and collname='default')
      and i.indcollation[3]=i.indcollation[2]
      and not exists(select 1 from unnest(i.indclass::oid[]) with ordinality classes(opclass_id,position) where opclass_id is distinct from
        (select oc.oid from pg_opclass oc where oc.opcnamespace='pg_catalog'::regnamespace and oc.opcmethod=am.oid and oc.opcdefault
          and oc.opcname=case classes.position when 2 then 'uuid_ops' when 5 then 'uuid_ops' else 'text_ops' end))) then raise exception 'merchant_attendance_outage_periods_index_conflict';end if;
end;
$outage_period_index_preflight$;
--176 stores canonical fixed-width UTC6 endpoints. Text extraction is immutable;
--do not make a session-timezone-dependent timestamptz cast an index expression.
create index if not exists attendance_outage_declaration_period_idx on public.merchant_attendance_outage_declarations
  (merchant_id,worker_id,(declared_interval->>'startAt'),(declared_interval->>'endAt'),declaration_id);

--PRIVATE: the175 collector already authorizes owner/self and holds merchant
--SHARE -> settings UPDATE -> worker UPDATE -> employee SHARE. No impersonated
--owner, new self.request permission, rollout flag, or caller-chosen frame.
create or replace function public.faolla_attendance_outage_period_context_v1(p_site text,p_worker uuid,p_employee uuid,p_employee_auth uuid,p_from timestamptz,p_to timestamptz)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare ids uuid[];did uuid;d public.merchant_attendance_outage_declarations%rowtype;
  w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;epoch public.merchant_attendance_account_epochs%rowtype;
  head public.merchant_attendance_outage_review_operations%rowtype;proposal_row public.merchant_attendance_outage_review_operations%rowtype;
  response_row public.merchant_attendance_outage_review_operations%rowtype;current_item jsonb;proposal_item jsonb;response_item jsonb;
  basis jsonb;blocks jsonb;status_item jsonb;items jsonb:='[]';generation_no bigint;revision_no integer;version_no integer;
  source_ready boolean;is_resolved boolean;failure text;fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_site is null or p_site!~'^[0-9]{8}$' or p_worker is null or p_employee is null or p_employee_auth is null
    or p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_from>=p_to then raise exception 'attendance_period_source_invalid';end if;
  --Choose the relevant worker/time scope BEFORE cap, then check every saved
  --identity. A replacement binding must not silently filter out an old claim.
  ids:=array(select x.declaration_id from public.merchant_attendance_outage_declarations x
    where x.merchant_id=p_site and x.worker_id=p_worker
      and x.declared_interval->>'startAt'<to_char(p_to at time zone 'UTC',fmt)
      and x.declared_interval->>'endAt'>to_char(p_from at time zone 'UTC',fmt)
    order by x.declaration_id limit 101);
  if cardinality(ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  if cardinality(ids)=0 then return items;end if;
  select * into w from public.merchant_attendance_workers where merchant_id=p_site and id=p_worker;
  select * into e from public.merchant_enterprise_employees where merchant_id=p_site and id=w.employee_id;
  if row(w.id,w.employee_id,e.id,e.auth_user_id) is distinct from row(p_worker,p_employee,p_employee,p_employee_auth) then raise exception 'attendance_period_source_identity_changed';end if;
  select * into epoch from public.merchant_attendance_account_epochs where merchant_id=p_site and employee_id=p_employee;
  generation_no:=coalesce(epoch.generation,0);
  foreach did in array ids loop
    select * into d from public.merchant_attendance_outage_declarations where merchant_id=p_site and declaration_id=did;
    if row(d.worker_id,d.employee_id,d.employee_auth_user_id) is distinct from row(p_worker,p_employee,p_employee_auth) then raise exception 'attendance_period_source_identity_changed';end if;
    if public.faolla_attendance_outage_interval_v1(d.declared_interval) is distinct from true then raise exception 'attendance_period_source_invalid';end if;
    current_item:=null;proposal_item:=null;response_item:=null;
    select * into head from public.merchant_attendance_outage_review_operations where merchant_id=p_site and declaration_id=did order by revision desc limit 1;
    revision_no:=coalesce(head.revision,0);version_no:=coalesce(head.result_version,0);
    select * into proposal_row from public.merchant_attendance_outage_review_operations where merchant_id=p_site and declaration_id=did
      and result_version=version_no and action='propose' order by revision desc limit 1;
    select * into response_row from public.merchant_attendance_outage_review_operations where merchant_id=p_site and declaration_id=did
      and result_version=version_no and action in('confirm','dispute') order by revision desc limit 1;
    if head.operation_id is not null then
      current_item:=public.faolla_attendance_outage_review_entry_v1(head);
      if proposal_row.operation_id is null then raise exception 'attendance_period_source_invalid';end if;
      proposal_item:=public.faolla_attendance_outage_review_proposal_v1(proposal_row)-'sourceText';
      if response_row.operation_id is not null then response_item:=public.faolla_attendance_outage_review_entry_v1(response_row);end if;
    elsif proposal_row.operation_id is not null or response_row.operation_id is not null then raise exception 'attendance_period_source_invalid';end if;
    basis:=public.faolla_attendance_outage_review_basis_v1(d,w.version,e.version,generation_no,true);
    blocks:=basis->'blockers';
    if not coalesce(w.active,false) or e.status is distinct from 'active' then blocks:=blocks||'"employee_unavailable"'::jsonb;end if;
    if coalesce(epoch.paused,false) then blocks:=blocks||'"account_suspended"'::jsonb;end if;
    if proposal_row.operation_id is null then blocks:=blocks||'"result_missing"'::jsonb;
    else
      if row(basis->>'linkOperationId',basis->>'linkRevision',basis->>'linkFingerprint') is distinct from
        row(proposal_row.evidence->>'linkOperationId',proposal_row.evidence->>'linkRevision',proposal_row.evidence->>'linkFingerprint') then blocks:=blocks||'"link_changed"'::jsonb;end if;
      if basis->>'fingerprint' is distinct from proposal_row.result_fingerprint then blocks:=blocks||'"result_changed"'::jsonb;end if;
    end if;
    --Exactly178's read-state predicate, without actor-dependent capability flags.
    source_ready:=proposal_row.operation_id is not null and blocks='[]'::jsonb;
    if response_row.action='dispute' then blocks:=blocks||'"disputed"'::jsonb;
    elsif response_row.action is distinct from 'confirm' then blocks:=blocks||'"unconfirmed"'::jsonb;end if;
    if head.action='reopen' then blocks:=blocks||'"reopened"'::jsonb;end if;
    select coalesce(jsonb_agg(value order by value),'[]') into blocks from (select distinct value from jsonb_array_elements(blocks)) b;
    is_resolved:=coalesce(head.action='resolve' and source_ready and response_row.action='confirm',false);
    status_item:=jsonb_build_object('basisFingerprint',basis->'fingerprint','linkOperationId',basis->'linkOperationId','linkRevision',basis->'linkRevision',
      'linkFingerprint',basis->'linkFingerprint','blockers',blocks,'resolved',is_resolved);
    items:=items||jsonb_build_array(jsonb_build_object('declarationId',did,'workerId',d.worker_id,'employeeId',d.employee_id,'employeeAuthUserId',d.employee_auth_user_id,
      'interval',d.declared_interval,'revision',revision_no,'resultVersion',version_no,'current',current_item,'proposal',proposal_item,'response',response_item,'status',status_item));
    if octet_length(convert_to(items::text,'UTF8'))>1048576 then raise exception 'attendance_period_source_too_large';end if;
  end loop;
  return items;
exception when raise_exception then
  get stacked diagnostics failure=message_text;
  if failure in('attendance_outage_links_too_large','attendance_outage_review_too_large') then raise exception 'attendance_period_source_too_large';
  elsif failure in('attendance_outage_links_invalid','attendance_outage_links_not_found','attendance_outage_review_invalid','attendance_outage_review_not_found') then raise exception 'attendance_period_source_invalid';
  else raise;end if;
end;
$$;

--179 replacements below are copied from175 with the strictly named changes.

create or replace function public.faolla_attendance_period_closure_source_base_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  site text;wid uuid;access_name text;first_day date;last_day date;range_from timestamptz;range_to timestamptz;observed timestamptz;read_at timestamptz;
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;emp public.merchant_enterprise_employees%rowtype;role_row public.merchant_enterprise_roles%rowtype;
  report jsonb;base jsonb;result jsonb;canonical jsonb;source_text text;day_items jsonb:='[]';d date;a timestamptz;b timestamptz;
  item jsonb;child jsonb;summary jsonb;context jsonb;plans jsonb:='[]';sessions jsonb:='[]';reviews jsonb:='[]';leaves jsonb:='[]';calendars jsonb:='[]';missing jsonb:='[]';pending jsonb:='[]';
  flags text[]:='{}';blockers jsonb;ids uuid[];other_ids uuid[];candidate_ids uuid[];session_ids uuid[]:='{}';report_ids uuid[]:='{}';place_ids uuid[]:='{}';place uuid;target_id uuid;
  ev public.merchant_attendance_events%rowtype;endpoint public.merchant_attendance_events%rowtype;eff public.merchant_attendance_effect_current_v2%rowtype;
  slot_row public.merchant_attendance_schedule_slots%rowtype;relation_row public.merchant_attendance_shift_schedule_relations%rowtype;
  leave_row public.merchant_attendance_leave_requests%rowtype;leave_op public.merchant_attendance_leave_entries%rowtype;
  calendar_row public.merchant_attendance_calendar_entries%rowtype;calendar_op public.merchant_attendance_calendar_operations%rowtype;
  missing_row public.merchant_attendance_missing_requests%rowtype;missing_first public.merchant_attendance_missing_entries%rowtype;missing_op public.merchant_attendance_missing_entries%rowtype;
  missing_base_ids uuid[];missing_child_ids uuid[];missing_parent public.merchant_attendance_missing_requests%rowtype;missing_root public.merchant_attendance_missing_requests%rowtype;
  missing_parent_approval public.merchant_attendance_missing_entries%rowtype;missing_proposal jsonb;
  correction_row public.merchant_attendance_correction_entries%rowtype;correction_tail public.merchant_attendance_correction_entries%rowtype;
  revision_row public.merchant_attendance_revision_requests%rowtype;revision_tail public.merchant_attendance_revision_requests%rowtype;root_effect public.merchant_attendance_correction_effects%rowtype;
  case_row public.merchant_attendance_plan_exception_cases%rowtype;review_head public.merchant_attendance_plan_exception_entries%rowtype;
  rule_stream public.merchant_attendance_plan_rule_streams%rowtype;rule_operation public.merchant_attendance_plan_rule_operations%rowtype;current_approval jsonb;
  decision_row public.merchant_attendance_plan_exception_entries%rowtype;note_row public.merchant_attendance_plan_exception_entries%rowtype;read_row public.merchant_attendance_plan_exception_reads%rowtype;
  current_source jsonb;status_name text;bounds jsonb:='{}';cache_key text;boundary_date date;total_events integer:=0;expected_report_count integer:=0;

  missing_approved_ids uuid[];missing_edge_ids uuid[];missing_sibling_ids uuid[];missing_is_current boolean;
  missing_successor public.merchant_attendance_missing_requests%rowtype;missing_successor_first public.merchant_attendance_missing_entries%rowtype;
  missing_successor_approval public.merchant_attendance_missing_entries%rowtype;missing_checked_approval public.merchant_attendance_missing_entries%rowtype;
  fixed_head public.merchant_attendance_period_closures%rowtype;fixed_artifact public.merchant_attendance_period_artifacts%rowtype;
  fixed_version public.merchant_attendance_period_versions%rowtype;fixed_body jsonb;current_body jsonb;fixed_frame jsonb;fixed_day jsonb;fixed_pid uuid;fixed_index integer:=0;
  fixed_previous timestamptz;
  --175 posthoc declarations begin.
  posthoc_head public.merchant_attendance_plan_posthoc_operations%rowtype;posthoc_context jsonb:='[]';posthoc_snapshot jsonb;has_posthoc boolean:=false;
  --175 posthoc declarations end.
  fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','access','workerId','fromDate','throughDate','periodId']) is distinct from true
    or p_auth_user_id is null or coalesce(p_query->>'siteId','')!~'^\d{8}$' or jsonb_typeof(p_query->'siteId')<>'string'
    or jsonb_typeof(p_query->'access') is distinct from 'string' or p_query->>'access' not in('owner','self') or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'workerId','uuid') is distinct from true
    or public.faolla_attendance_group_date_v1(p_query->>'fromDate') is distinct from true or public.faolla_attendance_group_date_v1(p_query->>'throughDate') is distinct from true then raise exception 'attendance_invalid_request';end if;
  if p_query->'periodId'<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'periodId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  fixed_pid:=(p_query->>'periodId')::uuid;
  site:=p_query->>'siteId';wid:=(p_query->>'workerId')::uuid;access_name:=p_query->>'access';first_day:=(p_query->>'fromDate')::date;last_day:=(p_query->>'throughDate')::date;
  if last_day-first_day not between 0 and 30 then raise exception 'attendance_invalid_request';end if;
  perform 1 from public.merchants where id=site and (access_name='self' or user_id=p_auth_user_id) for share;
  if not found then raise exception 'attendance_access_denied';end if;
  --175 acquire the eventual173 lock level before worker/case reads.
  select * into s from public.merchant_attendance_settings where merchant_id=site for update;
  -- First match self without locks to avoid locking another person's worker;
  -- recheck the authenticated identity under the employee lock below.
  if access_name='self' and not exists(select 1 from public.merchant_attendance_workers x join public.merchant_enterprise_employees e
    on e.merchant_id=x.merchant_id and e.id=x.employee_id where x.merchant_id=site and x.id=wid and e.auth_user_id=p_auth_user_id) then raise exception 'attendance_access_denied';end if;
  select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for update;
  if not found then raise exception 'attendance_worker_not_found';end if;
  select * into emp from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;
  if emp.id is null or emp.auth_user_id is null then raise exception 'attendance_period_source_identity_changed';end if;
  if access_name='self' then
    if emp.auth_user_id<>p_auth_user_id or emp.status<>'active' then raise exception 'attendance_access_denied';end if;
    select * into role_row from public.merchant_enterprise_roles where merchant_id=site and id=emp.role_id for share;
    if role_row.status is distinct from 'active' or public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions) is distinct from true
      or not('enterprise.view'=any(role_row.permissions)) or not('attendance.self.view'=any(role_row.permissions)) then raise exception 'attendance_access_denied';end if;
  end if;
  if s.merchant_id is null then raise exception 'attendance_settings_required';end if;
  --155 fixed frame begins. The caller supplies only an identity, never a zone,
  -- UTC interval, day boundary, session setting, or impersonated owner.
  if fixed_pid is not null then
    select * into fixed_head from public.merchant_attendance_period_closures where merchant_id=site and period_id=fixed_pid;
  end if;
  if fixed_head.period_id is null then
    -- A first send has a new UUID but no saved frame yet. Preserve154 exactly.
    return public.faolla_attendance_period_source_v1(p_query-'periodId',p_auth_user_id);
  end if;
  if fixed_head.worker_id<>wid or fixed_head.from_date<>first_day or fixed_head.through_date<>last_day then raise exception 'attendance_access_denied';end if;
  if fixed_head.employee_id<>emp.id or fixed_head.employee_auth_user_id<>emp.auth_user_id then raise exception 'attendance_period_identity_changed';end if;
  select * into fixed_version from public.merchant_attendance_period_versions where merchant_id=site and period_id=fixed_pid and version=1;
  select * into fixed_artifact from public.merchant_attendance_period_artifacts where merchant_id=site and period_id=fixed_pid and artifact_id=fixed_version.artifact_id;
  fixed_body:=public.faolla_attendance_period_artifact_checked_v1(fixed_artifact);
  perform public.faolla_attendance_period_summary_v1(fixed_head,fixed_body);
  if fixed_version.version is distinct from 1 or coalesce(fixed_body->'source'->>'sourceVersion','') not in ('attendance-period-source-v1','attendance-period-source-v2','attendance-period-source-v3','attendance-period-source-v4')
    or fixed_body->'source'->>'siteId' is distinct from site or fixed_body->'source'->>'workerId' is distinct from wid::text
    or fixed_body->'source'->>'employeeId' is distinct from emp.id::text or fixed_body->'source'->>'employeeAuthUserId' is distinct from emp.auth_user_id::text
    or fixed_body->'source'->>'sourceFingerprint' is not null
    or fixed_artifact.source_fingerprint is distinct from encode(sha256(convert_to((fixed_body->'source')::text,'UTF8')),'hex')
    or fixed_body->'source'->>'fromDate' is distinct from first_day::text or fixed_body->'source'->>'throughDate' is distinct from last_day::text
    or fixed_body->'source'->>'timeZone' is distinct from fixed_head.time_zone
    or fixed_body->'source'->>'fromAt' is distinct from to_char(fixed_head.start_at at time zone 'UTC',fmt)
    or fixed_body->'source'->>'toAt' is distinct from to_char(fixed_head.end_at at time zone 'UTC',fmt)
    or fixed_body->'dayBoundaries' is distinct from fixed_body->'source'->'dayBoundaries'
    or jsonb_array_length(fixed_body->'dayBoundaries')<>last_day-first_day+1 then raise exception 'attendance_period_closure_invalid';end if;
  -- Authoritative first-version civil dates must be ordered, gapless and exactly
  -- cover the saved UTC head. A skipped date has equal endpoints, not a missing
  -- row. No current PostgreSQL timezone lookup is used to validate old days.
  for fixed_day in select value from jsonb_array_elements(fixed_body->'dayBoundaries') loop
    if public.faolla_attendance_shift_rule_binding_object_v1(fixed_day,array['date','fromAt','toAt','skipped']) is distinct from true
      or fixed_day->>'date' is distinct from (first_day+fixed_index)::text
      or public.faolla_attendance_shift_rule_binding_scalar_v1(fixed_day->'fromAt','stamp6') is distinct from true
      or public.faolla_attendance_shift_rule_binding_scalar_v1(fixed_day->'toAt','stamp6') is distinct from true
      or jsonb_typeof(fixed_day->'skipped') is distinct from 'boolean' then raise exception 'attendance_period_closure_invalid';end if;
    a:=(fixed_day->>'fromAt')::timestamptz;b:=(fixed_day->>'toAt')::timestamptz;
    if a>b or fixed_day->'skipped' is distinct from to_jsonb(a=b)
      or fixed_index=0 and a is distinct from fixed_head.start_at
      or fixed_index>0 and a is distinct from fixed_previous then raise exception 'attendance_period_closure_invalid';end if;
    fixed_previous:=b;fixed_index:=fixed_index+1;
  end loop;
  if fixed_previous is distinct from fixed_head.end_at
    or fixed_body->'dayBoundaries'->0->'skipped' is distinct from 'false'::jsonb
    or fixed_body->'dayBoundaries'->-1->'skipped' is distinct from 'false'::jsonb then raise exception 'attendance_period_closure_invalid';end if;
  -- Later versions may change business sources, never this period's frame.
  select * into fixed_version from public.merchant_attendance_period_versions where merchant_id=site and period_id=fixed_pid and version=fixed_head.current_version;
  select * into fixed_artifact from public.merchant_attendance_period_artifacts where merchant_id=site and period_id=fixed_pid and artifact_id=fixed_version.artifact_id;
  current_body:=public.faolla_attendance_period_artifact_checked_v1(fixed_artifact);
  perform public.faolla_attendance_period_summary_v1(fixed_head,current_body);
  if current_body->'dayBoundaries' is distinct from fixed_body->'dayBoundaries'
    or current_body->'source'->'dayBoundaries' is distinct from fixed_body->'dayBoundaries'
    or fixed_artifact.source_fingerprint is distinct from encode(sha256(convert_to((current_body->'source')::text,'UTF8')),'hex') then raise exception 'attendance_period_closure_invalid';end if;
  fixed_frame:=jsonb_build_object('timeZone',fixed_head.time_zone,'fromAt',to_char(fixed_head.start_at at time zone 'UTC',fmt),'toAt',to_char(fixed_head.end_at at time zone 'UTC',fmt));
  --155 fixed frame ends.
  report:=public.faolla_attendance_period_closure_unified_report_v1(site,p_auth_user_id,case when access_name='owner' then
    jsonb_build_object('access','owner','workerId',wid,'fromDate',first_day,'throughDate',last_day) else
    jsonb_build_object('access','self','workerId',null,'locationId',null,'expectedWorkerId',wid,'fromDate',first_day,'throughDate',last_day) end,fixed_frame);
  base:=report->'base';range_from:=(base->>'fromAt')::timestamptz;range_to:=(base->>'toAt')::timestamptz;observed:=(base->>'asOf')::timestamptz;
  if base->>'siteId' is distinct from site or base->>'workerId' is distinct from wid::text or base->>'employeeId' is distinct from emp.id::text
    or report->>'access' is distinct from access_name or report->>'complete' is distinct from 'true' or base->>'complete' is distinct from 'true'
    or report->>'payrollReady' is distinct from 'false' then raise exception 'attendance_period_source_invalid';end if;
  if range_to>observed then flags:=array_append(flags,'period_in_progress');end if;
  day_items:=fixed_body->'dayBoundaries';
  -- Mirror the unfiltered owner candidate set. The scoped reader may silently
  -- omit a mixed-identity session; compare the complete private set explicitly.
  candidate_ids:=array(with inside as(select x.id from public.merchant_attendance_events x where x.merchant_id=site and x.worker_id=wid and x.action='clock_in'
      and x.occurred_at>=range_from and x.occurred_at<range_to order by x.occurred_at,x.sequence limit 101),
    preceding as(select x.id from public.merchant_attendance_events x where x.merchant_id=site and x.worker_id=wid and x.action='clock_in'
      and x.occurred_at<range_from order by x.occurred_at desc,x.sequence desc limit 1),
    moved as(select x.start_event_id id from public.merchant_attendance_effect_current_v2 x where x.merchant_id=site and x.worker_id=wid
      and x.start_at>=range_from-interval '744 hours' and x.start_at<range_to and x.end_at>range_from order by x.start_at,x.start_event_id limit 101)
    select id from (select id from inside union select id from preceding union select id from moved) all_candidates order by id limit 102);
  for ev in select x.* from public.merchant_attendance_events x where x.merchant_id=site and x.id=any(candidate_ids) order by x.sequence loop
    select * into endpoint from (select x.* from public.merchant_attendance_events x where x.merchant_id=site and x.worker_id=wid and x.sequence>=ev.sequence order by x.sequence limit 2003) tail
      where tail.action='clock_out' order by tail.sequence limit 1;
    select * into eff from public.merchant_attendance_effect_current_v2 x where x.merchant_id=site and x.worker_id=wid and x.start_event_id=ev.id;
    if not(ev.occurred_at<range_to and (ev.occurred_at>=range_from or coalesce(endpoint.occurred_at,observed)>range_from))
      and not(coalesce(eff.start_at<range_to and eff.end_at>range_from,false)) then continue;end if;
    if expected_report_count>=100 then raise exception 'attendance_period_source_too_large';end if;
    child:=public.faolla_attendance_period_session_v1(site,wid,ev.id,emp.id,emp.auth_user_id,observed);
    if not exists(select 1 from jsonb_array_elements(base->'items') x where x.value->>'startEventId'=ev.id::text) then raise exception 'attendance_period_source_identity_changed';end if;
    expected_report_count:=expected_report_count+1;report_ids:=array_append(report_ids,ev.id);session_ids:=array_append(session_ids,ev.id);sessions:=sessions||jsonb_build_array(child);
    total_events:=total_events+jsonb_array_length(child->'item'->'events');
    if child->'item'->'events'->-1->>'action'<>'clock_out' then flags:=array_append(flags,'open_session');end if;
  end loop;
  if expected_report_count<>jsonb_array_length(base->'items') or total_events>4000 then raise exception 'attendance_period_source_too_large';end if;

  -- Full original plan membership, including cancelled plans and associations
  -- whose original/latest endpoints moved outside this period. No auto matching.
  ids:=array(select x.id from public.merchant_attendance_schedule_slots x where x.merchant_id=site and x.worker_id=wid
    and x.start_at>=range_from-interval '24 hours' and x.start_at<range_to and x.end_at>range_from order by x.start_at,x.end_at limit 101);
  if cardinality(ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  for slot_row in select x.* from public.merchant_attendance_schedule_slots x where x.merchant_id=site and x.id=any(ids) order by x.id loop
    if slot_row.end_at<=range_from then continue;end if;
    if slot_row.employee_id<>emp.id then raise exception 'attendance_period_source_identity_changed';end if;
    item:=public.faolla_attendance_self_schedule_slot_v1(slot_row);
    if item->'publication'->>'employeeAuthUserId' is null then raise exception 'attendance_period_source_identity_unproven';end if;
    if item->'publication'->>'employeeId' is distinct from emp.id::text or item->'publication'->>'employeeAuthUserId' is distinct from emp.auth_user_id::text then
      raise exception 'attendance_period_source_identity_changed';end if;
    current_approval:=null;
    select * into rule_stream from public.merchant_attendance_plan_rule_streams x where x.merchant_id=site and x.slot_id=slot_row.id;
    if rule_stream.slot_id is not null then
      if row(rule_stream.worker_id,rule_stream.employee_id,rule_stream.employee_auth_user_id) is distinct from row(wid,emp.id,emp.auth_user_id) then raise exception 'attendance_period_source_identity_changed';end if;
      select * into rule_operation from public.merchant_attendance_plan_rule_operations x where x.merchant_id=site and x.slot_id=slot_row.id and x.revision=rule_stream.revision;
      if rule_operation.operation_id is null then raise exception 'attendance_period_source_invalid';end if;
      current_approval:=public.faolla_attendance_period_plan_rule_v1(site,wid,slot_row.id,emp.id,emp.auth_user_id,rule_operation.operation_id);
    end if;
    plans:=plans||jsonb_build_array(item||jsonb_build_object('currentApproval',current_approval));
    other_ids:=array(select x.start_event_id from public.merchant_attendance_shift_schedule_relations x where x.merchant_id=site and x.slot_id=slot_row.id and x.slot_id is not null order by x.start_event_id limit 11);
    if cardinality(other_ids)>10 then raise exception 'attendance_period_source_too_large';end if;
    foreach target_id in array other_ids loop
      if target_id=any(session_ids) then continue;end if;
      child:=public.faolla_attendance_period_session_v1(site,wid,target_id,emp.id,emp.auth_user_id,observed);
      sessions:=sessions||jsonb_build_array(child);session_ids:=array_append(session_ids,target_id);total_events:=total_events+jsonb_array_length(child->'item'->'events');
      if cardinality(session_ids)>100 or total_events>4000 then raise exception 'attendance_period_source_too_large';end if;
      if child->'item'->'events'->-1->>'action'<>'clock_out' then flags:=array_append(flags,'open_session');end if;
    end loop;
  end loop;
  select coalesce(jsonb_agg(value order by value->'item'->>'startEventId'),'[]'::jsonb) into sessions from jsonb_array_elements(sessions);

  -- Leave retains current terminal state, not a payroll deduction/excuse.
  ids:=array(select x.request_id from public.merchant_attendance_leave_requests x where x.merchant_id=site and x.worker_id=wid
    and x.start_at>=range_from-interval '8784 hours' and x.start_at<range_to and x.end_at>range_from order by x.start_at,x.end_at limit 101);
  if cardinality(ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  for leave_row in select x.* from public.merchant_attendance_leave_requests x where x.merchant_id=site and x.request_id=any(ids) order by x.request_id loop
    if leave_row.end_at<=range_from then continue;end if;
    if leave_row.employee_id<>emp.id or leave_row.actor_auth_user_id<>emp.auth_user_id then raise exception 'attendance_period_source_identity_changed';end if;
    summary:=public.faolla_attendance_leave_summary_v1(leave_row);
    select * into leave_op from public.merchant_attendance_leave_entries x where x.merchant_id=site and x.request_id=leave_row.request_id and x.revision=(summary->>'revision')::integer;
    leaves:=leaves||jsonb_build_array(jsonb_build_object('workerId',wid,'employeeId',emp.id,'employeeAuthUserId',emp.auth_user_id,'summary',summary,
      'operationId',leave_op.operation_id,'recordedAt',to_char(leave_op.recorded_at at time zone 'UTC',fmt)));
    if summary->>'status'='submitted' then flags:=array_append(flags,'pending_leave');end if;
  end loop;
  -- Saved locations only. No current default location and no unrelated people.
  place_ids:=array(select distinct id from (select (event->>'locationId')::uuid id from jsonb_array_elements(sessions) r cross join lateral jsonb_array_elements(r->'item'->'events') event
    union all select (value->>'locationId')::uuid from jsonb_array_elements(report->'missing')
    union all select (value->'slot'->>'locationId')::uuid from jsonb_array_elements(plans)) places where id is not null order by id limit 101);
  if cardinality(place_ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  -- Date indexes narrow each saved scope; they are only a conservative UTC
  -- superset. Do NOT cap that superset: only precise saved-zone overlaps count.
  -- The existing local cache avoids repeating STABLE/tzdata boundary work for
  -- equal (zone,date). No UTC/tzdata expression is falsely declared immutable.
  for calendar_row in
    select candidates.* from (
      select x.* from public.merchant_attendance_calendar_entries x where x.merchant_id=site and x.location_id is null
        and x.from_date>=(range_from at time zone 'UTC')::date-367 and x.from_date<=(range_to at time zone 'UTC')::date+2
        and x.through_date>=(range_from at time zone 'UTC')::date-2
      union all
      select x.* from public.merchant_attendance_calendar_entries x where x.merchant_id=site and x.location_id=any(place_ids)
        and x.from_date>=(range_from at time zone 'UTC')::date-367 and x.from_date<=(range_to at time zone 'UTC')::date+2
        and x.through_date>=(range_from at time zone 'UTC')::date-2
    ) candidates order by candidates.entry_id
  loop
    foreach boundary_date in array array[calendar_row.from_date,calendar_row.through_date+1] loop
      cache_key:=jsonb_build_array(calendar_row.time_zone,boundary_date)::text;
      if not(bounds ? cache_key) then bounds:=bounds||jsonb_build_object(cache_key,to_char(public.faolla_attendance_control_day_boundary_v1(boundary_date,calendar_row.time_zone) at time zone 'UTC',fmt));end if;
    end loop;
    a:=(bounds->>jsonb_build_array(calendar_row.time_zone,calendar_row.from_date)::text)::timestamptz;b:=(bounds->>jsonb_build_array(calendar_row.time_zone,calendar_row.through_date+1)::text)::timestamptz;
    if a>=range_to or b<=range_from then continue;end if;
    if jsonb_array_length(calendars)>=100 then raise exception 'attendance_period_source_too_large';end if;
    summary:=public.faolla_attendance_calendar_summary_v1(calendar_row);
    select * into calendar_op from public.merchant_attendance_calendar_operations x where x.merchant_id=site and x.entry_id=calendar_row.entry_id and x.revision=(summary->>'revision')::integer;
    calendars:=calendars||jsonb_build_array(jsonb_build_object('summary',summary,'operationId',calendar_op.operation_id,'fromAt',to_char(a at time zone 'UTC',fmt),'toAt',to_char(b at time zone 'UTC',fmt),'recordedAt',to_char(calendar_op.recorded_at at time zone 'UTC',fmt)));
  end loop;

  -- Relevant missing facts retain the151 exact UTC window. A direct pending
  -- revision can move OUT of that window while replacing an approved parent
  -- which is still counted in this period. Include that request, not its hours.
  -- No recursive/root expansion: once an approved successor is outside, its
  -- own outside pending successor does not affect an old ancestor's period.
  missing_base_ids:=array(select x.request_id from public.merchant_attendance_missing_requests x where x.merchant_id=site and x.worker_id=wid
    and x.start_at>=range_from-interval '24 hours' and x.start_at<range_to and x.end_at>range_from order by x.start_at,x.end_at limit 101);
  if cardinality(missing_base_ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  missing_child_ids:=array(
    select child.request_id from unnest(missing_base_ids) relevant_parent(request_id)
    cross join lateral(
      select x.request_id from public.merchant_attendance_missing_requests x
      where x.merchant_id=site and x.supersedes_request_id=relevant_parent.request_id and x.supersedes_request_id is not null
        and not exists(select 1 from public.merchant_attendance_missing_entries terminal
          where terminal.merchant_id=x.merchant_id and terminal.request_id=x.request_id and terminal.revision=2)
      order by x.request_id limit 101
    ) child order by child.request_id limit 101);
  -- Do not filter the new child candidates by worker/Auth: an invalid saved
  -- relationship must be rejected, not silently omitted from a complete source.
  ids:=array(select distinct candidate.request_id from unnest(missing_base_ids||missing_child_ids) candidate(request_id) order by candidate.request_id limit 101);
  if cardinality(ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  for missing_row in select x.* from public.merchant_attendance_missing_requests x where x.merchant_id=site and x.request_id=any(ids) order by x.request_id loop
    if row(missing_row.worker_id,missing_row.employee_id,missing_row.actor_auth_user_id) is distinct from row(wid,emp.id,emp.auth_user_id) then
      raise exception 'attendance_period_source_identity_changed';end if;
    select * into missing_first from public.merchant_attendance_missing_entries x where x.merchant_id=site and x.request_id=missing_row.request_id and x.revision=1;
    select * into missing_op from public.merchant_attendance_missing_entries x where x.merchant_id=site and x.request_id=missing_row.request_id order by x.revision desc limit 1;
    if missing_first.operation_id is distinct from missing_row.request_id or missing_first.action is distinct from 'submit'
      or missing_first.actor_auth_user_id is distinct from emp.auth_user_id or missing_first.command->'proposal' is distinct from missing_row.proposal
      or missing_op.revision not between 1 and 2 or missing_op.recorded_at<missing_first.recorded_at then raise exception 'attendance_period_source_invalid';end if;
    -- Validate every pending revision we actually return, including an in-window
    -- child whose approved parent is outside. This checks saved UTC/identity and
    -- immutable receipt linkage only: no current employment/timezone/policy
    -- eligibility, and no owner impersonation or old writer invocation.
    if missing_row.supersedes_request_id is not null and missing_op.revision=1 then
      select * into missing_parent from public.merchant_attendance_missing_requests x
        where x.merchant_id=site and x.request_id=missing_row.supersedes_request_id;
      if missing_parent.request_id is null then raise exception 'attendance_period_source_invalid';end if;
      if row(missing_parent.worker_id,missing_parent.employee_id,missing_parent.actor_auth_user_id) is distinct from row(wid,emp.id,emp.auth_user_id) then
        raise exception 'attendance_period_source_identity_changed';end if;
      select * into missing_parent_approval from public.merchant_attendance_missing_entries x
        where x.merchant_id=site and x.request_id=missing_parent.request_id and x.revision=2;
      if missing_parent_approval.action is distinct from 'approve'
        or missing_parent_approval.operation_id is distinct from missing_row.supersedes_operation_id
        or missing_row.root_request_id is distinct from coalesce(missing_parent.root_request_id,missing_parent.request_id)
        or missing_row.location_id is distinct from missing_parent.location_id or missing_row.time_zone is distinct from missing_parent.time_zone
        or missing_parent_approval.recorded_at>=missing_row.submitted_at
        or exists(select 1 from public.merchant_attendance_missing_requests successor
          join public.merchant_attendance_missing_entries approved on approved.merchant_id=successor.merchant_id and approved.request_id=successor.request_id
            and approved.revision=2 and approved.action='approve'
          where successor.merchant_id=site and successor.supersedes_request_id=missing_parent.request_id)
        or exists(select 1 from public.merchant_attendance_missing_requests sibling
          where sibling.merchant_id=site and sibling.supersedes_request_id=missing_parent.request_id and sibling.request_id<>missing_row.request_id
            and not exists(select 1 from public.merchant_attendance_missing_entries terminal
              where terminal.merchant_id=sibling.merchant_id and terminal.request_id=sibling.request_id and terminal.revision=2)) then
        raise exception 'attendance_period_source_invalid';end if;
      select * into missing_root from public.merchant_attendance_missing_requests x
        where x.merchant_id=site and x.request_id=missing_row.root_request_id;
      if missing_root.request_id is null or missing_root.root_request_id is not null or missing_root.supersedes_request_id is not null then
        raise exception 'attendance_period_source_invalid';end if;
      if row(missing_root.worker_id,missing_root.employee_id,missing_root.actor_auth_user_id) is distinct from row(wid,emp.id,emp.auth_user_id) then
        raise exception 'attendance_period_source_identity_changed';end if;
      if public.faolla_attendance_shift_rule_binding_object_v1(missing_first.command,
          array['action','operationId','reason','expectedWorkerId','expectedSettingsVersion','expectedPolicyRevision','locationId','timeZone','proposal','supersedesRequestId','expectedApprovalOperationId']) is distinct from true
        or missing_first.command->>'action' is distinct from 'revise'
        or missing_first.command->>'operationId' is distinct from missing_row.request_id::text
        or missing_first.command->>'expectedWorkerId' is distinct from missing_row.worker_id::text
        or missing_first.command->>'supersedesRequestId' is distinct from missing_row.supersedes_request_id::text
        or missing_first.command->>'expectedApprovalOperationId' is distinct from missing_row.supersedes_operation_id::text
        or missing_first.command->>'locationId' is distinct from missing_row.location_id::text
        or missing_first.command->>'timeZone' is distinct from missing_row.time_zone
        or missing_first.command->>'reason' is distinct from missing_row.reason
        or missing_first.command->'expectedPolicyRevision' is distinct from to_jsonb(missing_row.policy_revision)
        or jsonb_typeof(missing_first.command->'expectedSettingsVersion') is distinct from 'number'
        or coalesce(missing_first.command->>'expectedSettingsVersion','')!~'^[1-9][0-9]{0,15}$'
        or (missing_first.command->>'expectedSettingsVersion')::numeric>9007199254740989
        or missing_first.recorded_at is distinct from missing_row.submitted_at
        or missing_op.operation_id is distinct from missing_first.operation_id then raise exception 'attendance_period_source_invalid';end if;
      begin
        missing_proposal:=public.faolla_attendance_correction_proposal_v1(missing_row.proposal,missing_row.submitted_at);
      exception when raise_exception then raise exception 'attendance_period_source_invalid';end;
      if missing_proposal is distinct from missing_row.proposal or jsonb_array_length(missing_proposal->'breaks')>8
        or public.faolla_attendance_instant_v1(missing_proposal->>'startAt') is distinct from missing_row.start_at
        or public.faolla_attendance_instant_v1(missing_proposal->>'endAt') is distinct from missing_row.end_at then raise exception 'attendance_period_source_invalid';end if;
    end if;
    status_name:=case missing_op.action when 'submit' then 'submitted' when 'approve' then 'approved' when 'reject' then 'rejected' when 'withdraw' then 'withdrawn' end;
    if status_name is null then raise exception 'attendance_period_source_invalid';end if;
    --154 direct-approved-edge validation begins.
    -- Do not enumerate/cap lifetime root history. A direct approval makes the
    -- parent historical even if that child was later superseded. Never filter
    -- by worker/Auth/root/date before validation: an invalid edge must not hide.
    -- LIMIT2 is a duplicate witness, not a constant-cost scan claim: rejected/
    -- withdrawn siblings can still require indexed probes under the deadline.
    missing_approved_ids:=array(select successor.request_id
      from public.merchant_attendance_missing_requests successor
      join public.merchant_attendance_missing_entries approved
        on approved.merchant_id=successor.merchant_id and approved.request_id=successor.request_id
          and approved.revision=2 and approved.action='approve'
      where successor.merchant_id=site and successor.supersedes_request_id=missing_row.request_id
        and successor.supersedes_request_id is not null limit 2);
    if cardinality(missing_approved_ids)>1 then raise exception 'attendance_period_source_invalid';end if;
    missing_is_current:=status_name='approved' and cardinality(missing_approved_ids)=0;
    missing_edge_ids:=missing_approved_ids;
    -- A returned approved revision may itself have an out-of-period parent.
    -- Validate that incoming edge too; at most two local edges, never recurse.
    if status_name='approved' and missing_row.supersedes_request_id is not null then
      missing_edge_ids:=array_append(missing_edge_ids,missing_row.request_id);
    end if;
    for missing_successor in select successor.* from public.merchant_attendance_missing_requests successor
      where successor.merchant_id=site and successor.request_id=any(missing_edge_ids) order by successor.request_id loop
      if row(missing_successor.worker_id,missing_successor.employee_id,missing_successor.actor_auth_user_id)
        is distinct from row(wid,emp.id,emp.auth_user_id) then raise exception 'attendance_period_source_identity_changed';end if;
      select * into missing_parent from public.merchant_attendance_missing_requests parent
        where parent.merchant_id=site and parent.request_id=missing_successor.supersedes_request_id;
      if missing_parent.request_id is null then raise exception 'attendance_period_source_invalid';end if;
      if row(missing_parent.worker_id,missing_parent.employee_id,missing_parent.actor_auth_user_id)
        is distinct from row(wid,emp.id,emp.auth_user_id) then raise exception 'attendance_period_source_identity_changed';end if;
      select * into missing_parent_approval from public.merchant_attendance_missing_entries approval
        where approval.merchant_id=site and approval.request_id=missing_parent.request_id and approval.revision=2;
      select * into missing_successor_first from public.merchant_attendance_missing_entries submission
        where submission.merchant_id=site and submission.request_id=missing_successor.request_id and submission.revision=1;
      select * into missing_successor_approval from public.merchant_attendance_missing_entries approval
        where approval.merchant_id=site and approval.request_id=missing_successor.request_id and approval.revision=2;
      if missing_parent_approval.action is distinct from 'approve'
        or missing_parent_approval.operation_id is distinct from missing_successor.supersedes_operation_id
        or missing_successor.root_request_id is distinct from coalesce(missing_parent.root_request_id,missing_parent.request_id)
        or missing_successor.location_id is distinct from missing_parent.location_id
        or missing_successor.time_zone is distinct from missing_parent.time_zone
        or missing_parent_approval.recorded_at>=missing_successor.submitted_at
        or missing_successor_approval.action is distinct from 'approve'
        or missing_successor_approval.recorded_at<missing_successor.submitted_at
        --103 explicitly prohibits a revision approval before its submission,
        -- but makes no corresponding monotonic-clock promise for an initial root.
        or (missing_parent.supersedes_request_id is not null and missing_parent_approval.recorded_at<missing_parent.submitted_at) then
        raise exception 'attendance_period_source_invalid';end if;
      select * into missing_root from public.merchant_attendance_missing_requests root_row
        where root_row.merchant_id=site and root_row.request_id=missing_successor.root_request_id;
      if missing_root.request_id is null or missing_root.root_request_id is not null
        or missing_root.supersedes_request_id is not null or missing_root.supersedes_operation_id is not null then
        raise exception 'attendance_period_source_invalid';end if;
      if row(missing_root.worker_id,missing_root.employee_id,missing_root.actor_auth_user_id)
        is distinct from row(wid,emp.id,emp.auth_user_id) then raise exception 'attendance_period_source_identity_changed';end if;
      -- The incoming edge's parent might not be one of our returned rows.
      -- Validate uniqueness there too; no current-head/current-owner test.
      missing_sibling_ids:=array(select sibling.request_id from public.merchant_attendance_missing_requests sibling
        join public.merchant_attendance_missing_entries approved
          on approved.merchant_id=sibling.merchant_id and approved.request_id=sibling.request_id
            and approved.revision=2 and approved.action='approve'
        where sibling.merchant_id=site and sibling.supersedes_request_id=missing_parent.request_id
          and sibling.supersedes_request_id is not null limit 2);
      if cardinality(missing_sibling_ids)<>1 or missing_sibling_ids[1] is distinct from missing_successor.request_id then
        raise exception 'attendance_period_source_invalid';end if;
      if missing_successor_first.operation_id is distinct from missing_successor.request_id
        or missing_successor_first.action is distinct from 'submit'
        or missing_successor_first.actor_auth_user_id is distinct from missing_successor.actor_auth_user_id
        or missing_successor_first.recorded_at is distinct from missing_successor.submitted_at
        or missing_successor_first.command->'proposal' is distinct from missing_successor.proposal
        or public.faolla_attendance_shift_rule_binding_object_v1(missing_successor_first.command,
          array['action','operationId','reason','expectedWorkerId','expectedSettingsVersion','expectedPolicyRevision','locationId','timeZone','proposal','supersedesRequestId','expectedApprovalOperationId']) is distinct from true
        or missing_successor_first.command->>'action' is distinct from 'revise'
        or missing_successor_first.command->>'operationId' is distinct from missing_successor.request_id::text
        or missing_successor_first.command->>'expectedWorkerId' is distinct from missing_successor.worker_id::text
        or missing_successor_first.command->>'supersedesRequestId' is distinct from missing_parent.request_id::text
        or missing_successor_first.command->>'expectedApprovalOperationId' is distinct from missing_parent_approval.operation_id::text
        or missing_successor_first.command->>'locationId' is distinct from missing_successor.location_id::text
        or missing_successor_first.command->>'timeZone' is distinct from missing_successor.time_zone
        or missing_successor_first.command->>'reason' is distinct from missing_successor.reason
        or jsonb_typeof(missing_successor_first.command->'reason') is distinct from 'string'
        or char_length(missing_successor.reason) not between 1 and 200 or missing_successor.reason<>btrim(missing_successor.reason)
        or missing_successor.reason ~ '[[:cntrl:]]'
        or missing_successor_first.command->'expectedPolicyRevision' is distinct from to_jsonb(missing_successor.policy_revision)
        or jsonb_typeof(missing_successor_first.command->'expectedSettingsVersion') is distinct from 'number'
        or coalesce(missing_successor_first.command->>'expectedSettingsVersion','')!~'^[1-9][0-9]{0,15}$'
        or (missing_successor_first.command->>'expectedSettingsVersion')::numeric>9007199254740989 then
        raise exception 'attendance_period_source_invalid';end if;
      begin
        missing_proposal:=public.faolla_attendance_correction_proposal_v1(missing_successor.proposal,missing_successor.submitted_at);
      exception when raise_exception then raise exception 'attendance_period_source_invalid';end;
      if missing_proposal is distinct from missing_successor.proposal or jsonb_array_length(missing_proposal->'breaks')>8
        or public.faolla_attendance_instant_v1(missing_proposal->>'startAt') is distinct from missing_successor.start_at
        or public.faolla_attendance_instant_v1(missing_proposal->>'endAt') is distinct from missing_successor.end_at then
        raise exception 'attendance_period_source_invalid';end if;
      -- Both approval receipts bind their actual request and operation. Their
      -- historical owner may differ from today's caller/owner, but cannot be the
      -- applicant itself. Do not revalidate old evidenceTokens against today.
      for missing_checked_approval in select approval.* from public.merchant_attendance_missing_entries approval
        where approval.merchant_id=site and approval.operation_id in(missing_parent_approval.operation_id,missing_successor_approval.operation_id) loop
        if missing_checked_approval.actor_auth_user_id=emp.auth_user_id
          or public.faolla_attendance_shift_rule_binding_object_v1(missing_checked_approval.command,
            array['action','operationId','requestId','expectedRevision','evidenceToken','reason']) is distinct from true
          or missing_checked_approval.command->>'action' is distinct from 'approve'
          or missing_checked_approval.command->>'operationId' is distinct from missing_checked_approval.operation_id::text
          or missing_checked_approval.command->>'requestId' is distinct from missing_checked_approval.request_id::text
          or missing_checked_approval.command->'expectedRevision' is distinct from '1'::jsonb
          or jsonb_typeof(missing_checked_approval.command->'evidenceToken') is distinct from 'string'
          or coalesce(missing_checked_approval.command->>'evidenceToken','')!~'^[a-f0-9]{32}$'
          or jsonb_typeof(missing_checked_approval.command->'reason') is distinct from 'string'
          or char_length(missing_checked_approval.command->>'reason') not between 1 and 200
          or (missing_checked_approval.command->>'reason')<>btrim(missing_checked_approval.command->>'reason')
          or (missing_checked_approval.command->>'reason') ~ '[[:cntrl:]]' then
          raise exception 'attendance_period_source_invalid';end if;
      end loop;
    end loop;
    --154 direct-approved-edge validation ends.
    missing:=missing||jsonb_build_array(jsonb_build_object('requestId',missing_row.request_id,'operationId',missing_op.operation_id,'revision',missing_op.revision,'status',status_name,
      'startAt',to_char(missing_row.start_at at time zone 'UTC',fmt),'endAt',to_char(missing_row.end_at at time zone 'UTC',fmt),'recordedAt',to_char(missing_op.recorded_at at time zone 'UTC',fmt),
      'supersedesRequestId',missing_row.supersedes_request_id,'rootRequestId',coalesce(missing_row.root_request_id,missing_row.request_id),
      'isCurrentApproved',missing_is_current));
    if status_name='submitted' then flags:=array_append(flags,'pending_missing');end if;
  end loop;

  -- A pending head can affect this period either via its original/current
  -- session (including a proposal moving OUT), or via a proposal moving IN.
  -- Each related stream/root is point-read at its latest revision. Range arms
  -- use the new partial UTC expression indexes; superseded/withdrawn/decided
  -- submissions do not consume the 100 truly-related pending-request budget.
  ids:=array(
    with related as (
      select head.request_id from unnest(session_ids) related_session(start_event_id)
      cross join lateral(
        select x.request_id,x.action from public.merchant_attendance_correction_entries x
        where x.merchant_id=site and x.worker_id=wid and x.start_event_id=related_session.start_event_id
        order by x.revision desc limit 1
      ) head
      where head.action='submit' and not exists(
        select 1 from public.merchant_attendance_correction_decisions decided where decided.merchant_id=site and decided.request_id=head.request_id)
    ), moved as (
      select x.request_id from public.merchant_attendance_correction_entries x
      where x.merchant_id=site and x.worker_id=wid and x.action='submit'
        and public.faolla_attendance_instant_v1(x.proposal->>'startAt')>=range_from-interval '744 hours'
        and public.faolla_attendance_instant_v1(x.proposal->>'startAt')<range_to
        and public.faolla_attendance_instant_v1(x.proposal->>'endAt')>range_from
        and not exists(select 1 from public.merchant_attendance_correction_entries newer
          where newer.merchant_id=x.merchant_id and newer.worker_id=x.worker_id and newer.start_event_id=x.start_event_id and newer.revision>x.revision)
        and not exists(select 1 from public.merchant_attendance_correction_decisions decided
          where decided.merchant_id=x.merchant_id and decided.request_id=x.request_id)
    )
    select request_id from (select request_id from related union select request_id from moved) relevant order by request_id limit 101);
  other_ids:=array(
    with related as (
      select head.request_id from unnest(session_ids) related_session(start_event_id)
      join public.merchant_attendance_correction_effects root on root.merchant_id=site and root.worker_id=wid and root.start_event_id=related_session.start_event_id
      cross join lateral(
        select x.request_id,x.action from public.merchant_attendance_revision_requests x
        where x.merchant_id=site and x.base_request_id=root.request_id order by x.revision desc limit 1
      ) head
      where head.action='submit' and not exists(
        select 1 from public.merchant_attendance_revision_decisions decided where decided.merchant_id=site and decided.request_id=head.request_id)
    ), moved as (
      select x.request_id from public.merchant_attendance_revision_requests x
      where x.merchant_id=site and x.worker_id=wid and x.action='submit'
        and public.faolla_attendance_instant_v1(x.command->'proposal'->>'startAt')>=range_from-interval '744 hours'
        and public.faolla_attendance_instant_v1(x.command->'proposal'->>'startAt')<range_to
        and public.faolla_attendance_instant_v1(x.command->'proposal'->>'endAt')>range_from
        and not exists(select 1 from public.merchant_attendance_revision_requests newer
          where newer.merchant_id=x.merchant_id and newer.base_request_id=x.base_request_id and newer.revision>x.revision)
        and not exists(select 1 from public.merchant_attendance_revision_decisions decided
          where decided.merchant_id=x.merchant_id and decided.request_id=x.request_id)
    )
    select request_id from (select request_id from related union select request_id from moved) relevant order by request_id limit 101);
  if cardinality(ids)>100 or cardinality(other_ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  for correction_row in select x.* from public.merchant_attendance_correction_entries x where x.merchant_id=site and x.request_id=any(ids) and x.action='submit' order by x.request_id loop
    select * into correction_tail from public.merchant_attendance_correction_entries x where x.merchant_id=site and x.request_id=correction_row.request_id order by x.revision desc limit 1;
    if correction_tail.action<>'submit' or exists(select 1 from public.merchant_attendance_correction_decisions x where x.merchant_id=site and x.request_id=correction_row.request_id) then continue;end if;
    a:=(correction_row.proposal->>'startAt')::timestamptz;b:=(correction_row.proposal->>'endAt')::timestamptz;
    if not(correction_row.start_event_id=any(session_ids)) and (a>=range_to or b<=range_from) then continue;end if;
    if correction_row.employee_id<>emp.id or correction_row.actor_auth_user_id<>emp.auth_user_id then raise exception 'attendance_period_source_identity_changed';end if;
    if public.faolla_attendance_correction_proposal_v1(correction_row.proposal,correction_row.recorded_at) is distinct from correction_row.proposal then raise exception 'attendance_period_source_invalid';end if;
    pending:=pending||jsonb_build_array(jsonb_build_object('kind','correction','requestId',correction_row.request_id,'operationId',correction_row.operation_id,'revision',correction_row.revision,
      'startEventId',correction_row.start_event_id,'startAt',correction_row.proposal->'startAt','endAt',correction_row.proposal->'endAt','recordedAt',to_char(correction_row.recorded_at at time zone 'UTC',fmt)));
  end loop;
  for revision_row in select x.* from public.merchant_attendance_revision_requests x where x.merchant_id=site and x.request_id=any(other_ids) and x.action='submit' order by x.request_id loop
    select * into revision_tail from public.merchant_attendance_revision_requests x where x.merchant_id=site and x.request_id=revision_row.request_id order by x.revision desc limit 1;
    if revision_tail.action<>'submit' or exists(select 1 from public.merchant_attendance_revision_decisions x where x.merchant_id=site and x.request_id=revision_row.request_id) then continue;end if;
    select * into root_effect from public.merchant_attendance_correction_effects x where x.merchant_id=site and x.request_id=revision_row.base_request_id;
    a:=(revision_row.command->'proposal'->>'startAt')::timestamptz;b:=(revision_row.command->'proposal'->>'endAt')::timestamptz;
    if not(root_effect.start_event_id=any(session_ids)) and (a>=range_to or b<=range_from) then continue;end if;
    if revision_row.employee_id<>emp.id or revision_row.actor_auth_user_id<>emp.auth_user_id then raise exception 'attendance_period_source_identity_changed';end if;
    if root_effect.worker_id is distinct from wid or root_effect.start_event_id is null
      or public.faolla_attendance_correction_proposal_v1(revision_row.command->'proposal',revision_row.recorded_at) is distinct from revision_row.command->'proposal' then raise exception 'attendance_period_source_invalid';end if;
    pending:=pending||jsonb_build_array(jsonb_build_object('kind','revision','requestId',revision_row.request_id,'operationId',revision_row.operation_id,'revision',revision_row.revision,
      'startEventId',root_effect.start_event_id,'startAt',revision_row.command->'proposal'->'startAt','endAt',revision_row.command->'proposal'->'endAt','recordedAt',to_char(revision_row.recorded_at at time zone 'UTC',fmt)));
  end loop;
  if jsonb_array_length(pending)>100 then raise exception 'attendance_period_source_too_large';end if;
  if jsonb_array_length(pending)>0 then flags:=array_append(flags,'pending_correction');end if;

  -- Only the complete already-collected plan membership is relevant: plans in
  -- this period plus saved plan references of original/latest related sessions.
  -- At most 200 distinct IDs (100 plans + 100 sessions), each looked up through
  -- existing147 UNIQUE(merchant_id,slot_id). Unrelated lifetime cases do not
  -- consume the period's 100-case budget; no history scan or silent truncation.
  other_ids:=array(select distinct candidate.slot_id from (
    select (value->'slot'->>'id')::uuid slot_id from jsonb_array_elements(plans)
    union all select (value->'relation'->'slot'->>'id')::uuid slot_id from jsonb_array_elements(sessions)
  ) candidate where candidate.slot_id is not null order by candidate.slot_id);
  if cardinality(other_ids)>200 then raise exception 'attendance_period_source_too_large';end if;
  ids:=array(select picked.case_id from unnest(other_ids) selected(slot_id)
    cross join lateral(select x.case_id from public.merchant_attendance_plan_exception_cases x
      where x.merchant_id=site and x.slot_id=selected.slot_id limit 1) picked
    order by picked.case_id limit 101);
  if cardinality(ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  for case_row in select x.* from public.merchant_attendance_plan_exception_cases x where x.merchant_id=site and x.case_id=any(ids) order by x.case_id loop
    if row(case_row.worker_id,case_row.employee_id,case_row.employee_auth_user_id) is distinct from row(wid,emp.id,emp.auth_user_id) then raise exception 'attendance_period_source_identity_changed';end if;
    select * into review_head from public.merchant_attendance_plan_exception_entries x where x.merchant_id=site and x.case_id=case_row.case_id order by x.revision desc limit 1;
    select * into decision_row from public.merchant_attendance_plan_exception_entries x where x.merchant_id=site and x.case_id=case_row.case_id and x.kind='decision' order by x.revision desc limit 1;
    select * into note_row from public.merchant_attendance_plan_exception_entries x where x.merchant_id=site and x.case_id=case_row.case_id and x.kind='note' order by x.revision desc limit 1;
    select * into read_row from public.merchant_attendance_plan_exception_reads x where x.merchant_id=site and x.decision_operation_id=decision_row.operation_id;
    if review_head.operation_id is null or decision_row.operation_id is null then raise exception 'attendance_period_source_invalid';end if;
    --175 posthoc snapshot begins. Point-read the current head without filtering
    --historical identities away; self sees saved facts, never owner observations.
    select * into posthoc_head from public.merchant_attendance_plan_posthoc_operations x
      where x.merchant_id=site and x.slot_id=case_row.slot_id order by x.revision desc limit 1;
    if posthoc_head.operation_id is not null then
      if row(posthoc_head.case_id,posthoc_head.worker_id,posthoc_head.employee_id,posthoc_head.employee_auth_user_id)
        is distinct from row(case_row.case_id,wid,emp.id,emp.auth_user_id) then raise exception 'attendance_period_source_identity_changed';end if;
      posthoc_snapshot:=public.faolla_attendance_plan_posthoc_operation_v1(posthoc_head);
      posthoc_context:=posthoc_context||jsonb_build_array(jsonb_build_object('slotId',case_row.slot_id,'revision',posthoc_head.revision,
        'current',posthoc_snapshot,'selected',posthoc_head.selected,'approval',posthoc_head.approval));
      has_posthoc:=true;
    elsif decision_row.evidence->>'policy'='owner-confirmed-plan-edges-posthoc-v3' then
      --A v3 decision cannot legitimately outlive its append-only171 ledger.
      raise exception 'attendance_period_source_invalid';
    end if;
    --175 posthoc snapshot ends.
    item:=public.faolla_attendance_plan_exception_review_entry_v1(decision_row);
    summary:=case when note_row.operation_id is null then null else public.faolla_attendance_plan_exception_review_entry_v1(note_row) end;
    reviews:=reviews||jsonb_build_array(jsonb_build_object('caseId',case_row.case_id,'slotId',case_row.slot_id,'revision',review_head.revision,'latestDecision',item,'latestNote',summary,
      'read',case when read_row.operation_id is null then null else jsonb_build_object('operationId',read_row.operation_id,'decisionOperationId',read_row.decision_operation_id,'readAt',to_char(read_row.read_at at time zone 'UTC',fmt)) end));
    -- Validation is deliberately outside canonical content. A self read cannot
    -- call146 as the owner.149 owner send/seal performs the real fresh check.
    if access_name='self' then flags:=array_append(flags,'unresolved_review');
    else
      --175 formal dispatch begins. A new171 head also invalidates an OLD saved
      --decision; dispatch cannot depend only on the saved evidence policy.
      if posthoc_head.operation_id is not null or decision_row.evidence->>'policy'='owner-confirmed-plan-edges-posthoc-v3' then
        --175 translate only known source failures; authorization and unknown failures propagate.
        begin
        current_source:=public.faolla_attendance_plan_posthoc_formal_source_v1(jsonb_build_object('siteId',site,'workerId',wid,'slotId',case_row.slot_id),p_auth_user_id);
        exception when raise_exception then
          if sqlerrm=any(array['attendance_plan_posthoc_formal_invalid','attendance_plan_posthoc_evaluation_invalid',
            'attendance_plan_posthoc_adoption_invalid','attendance_plan_posthoc_adoption_changed']) then raise exception 'attendance_period_source_invalid';
          elsif sqlerrm=any(array['attendance_plan_posthoc_formal_too_large','attendance_plan_posthoc_evaluation_too_large',
            'attendance_plan_posthoc_adoption_too_large']) then raise exception 'attendance_period_source_too_large';
          elsif sqlerrm='attendance_worker_changed' then raise exception 'attendance_period_source_identity_changed';
          else raise;end if;
        end;
      else
      current_source:=public.faolla_attendance_plan_exception_source_v1(jsonb_build_object('siteId',site,'workerId',wid,'slotId',case_row.slot_id),p_auth_user_id);
      end if;
      --175 formal dispatch ends.
      if decision_row.command->>'outcome'='follow_up' or note_row.revision>decision_row.revision
        or decision_row.evidence->>'fingerprint' is distinct from current_source->>'fingerprint' then flags:=array_append(flags,'unresolved_review');end if;
    end if;
  end loop;
  read_at:=clock_timestamp();if read_at<observed then raise exception 'attendance_period_source_invalid';end if;
  select coalesce(jsonb_agg(to_jsonb(reason) order by ord),'[]'::jsonb) into blockers from unnest(array['period_in_progress','open_session','pending_correction','pending_missing','pending_leave','unresolved_review']) with ordinality t(reason,ord) where reason=any(flags);
  context:=jsonb_build_object('pendingCorrections',pending,'missing',missing,'leave',leaves,'calendar',calendars,'plans',jsonb_build_object('items',plans,'sessions',sessions),'reviews',reviews);
  --175 canonical posthoc begins. Only opted-in related facts add this key.
  if has_posthoc then
    select jsonb_agg(head_rows.value order by head_rows.value->>'slotId') into posthoc_context
      from jsonb_array_elements(posthoc_context) head_rows(value);
    context:=context||jsonb_build_object('posthoc',posthoc_context);
  end if;
  --175 canonical posthoc ends.
  result:=jsonb_build_object('sourceVersion',case when has_posthoc then 'attendance-period-source-v3' else 'attendance-period-source-v1' end,'siteId',site,'workerId',wid,'employeeId',emp.id,'employeeAuthUserId',emp.auth_user_id,
    'timeZone',fixed_head.time_zone,'fromDate',first_day,'throughDate',last_day,'fromAt',base->'fromAt','toAt',base->'toAt','readAt',to_char(read_at at time zone 'UTC',fmt),
    'dayBoundaries',day_items,'report',report,'context',context,'blockers',blockers,'complete',true,'validation',case when access_name='owner' then 'owner_checked' else 'self_not_checked' end);
  canonical:=public.faolla_attendance_period_canonical_v1(result);source_text:=canonical::text;
  if octet_length(convert_to(source_text,'UTF8'))>1048576 then raise exception 'attendance_period_source_too_large';end if;
  result:=result||jsonb_build_object('sourceCanonical',canonical,'sourceText',source_text,'sourceFingerprint',encode(sha256(convert_to(source_text,'UTF8')),'hex'));
  -- Internal SQL envelope carries raw and canonical material for server-side
  -- verification. The HTTP service projects a smaller archive artifact.
  if octet_length(convert_to(result::text,'UTF8'))>4194304 then raise exception 'attendance_period_source_too_large';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then raise exception 'attendance_period_source_invalid';
end;
$$;

create or replace function public.faolla_attendance_period_closure_source_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;arrangements jsonb;outages jsonb;canonical jsonb;source_text text;
begin
  --175's collector authorizes and retains its original fixed-frame locks.
  result:=public.faolla_attendance_period_closure_source_base_v1(p_query,p_auth_user_id);
  arrangements:=public.faolla_attendance_work_arrangement_context_v1(
    result->>'siteId',(result->>'workerId')::uuid,(result->>'employeeId')::uuid,(result->>'employeeAuthUserId')::uuid,
    (result->>'fromAt')::timestamptz,(result->>'toAt')::timestamptz);
  outages:=public.faolla_attendance_outage_period_context_v1(
    result->>'siteId',(result->>'workerId')::uuid,(result->>'employeeId')::uuid,(result->>'employeeAuthUserId')::uuid,
    (result->>'fromAt')::timestamptz,(result->>'toAt')::timestamptz);
  if arrangements='[]'::jsonb and outages='[]'::jsonb then return result;end if;
  if arrangements<>'[]'::jsonb then
    result:=jsonb_set(result,'{context,workArrangements}',arrangements)||jsonb_build_object('sourceVersion',case when result->>'sourceVersion'='attendance-period-source-v3' then 'attendance-period-source-v3' else 'attendance-period-source-v2' end);
    if exists(select 1 from jsonb_array_elements(arrangements) x where x->>'status'='submitted') then
      result:=jsonb_set(result,'{blockers}',(result->'blockers')||'["pending_work_arrangement"]'::jsonb);
    end if;
  end if;
  --No synthetic empty section and no v4 upgrade for an unrelated old period.
  if outages<>'[]'::jsonb then
    result:=jsonb_set(result,'{context,outages}',outages)||jsonb_build_object('sourceVersion','attendance-period-source-v4');
    if exists(select 1 from jsonb_array_elements(outages) x where x->'status'->'resolved' is distinct from 'true'::jsonb) then
      result:=jsonb_set(result,'{blockers}',(result->'blockers')||'["unresolved_outage"]'::jsonb);
    end if;
  end if;
  canonical:=public.faolla_attendance_period_canonical_v1(result);source_text:=canonical::text;
  if octet_length(convert_to(source_text,'UTF8'))>1048576 then raise exception 'attendance_period_source_too_large';end if;
  return result||jsonb_build_object('sourceCanonical',canonical,'sourceText',source_text,'sourceFingerprint',encode(sha256(convert_to(source_text,'UTF8')),'hex'));
end;
$$;

create or replace function public.faolla_attendance_period_closure_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_artifact jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  site text;access_name text;mode_name text;wid uuid;pid uuid;op uuid;requested_version integer;first_day date;last_day date;action_name text;
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;r public.merchant_enterprise_roles%rowtype;
  c public.merchant_attendance_period_closures%rowtype;listed public.merchant_attendance_period_closures%rowtype;
  saved public.merchant_attendance_period_entries%rowtype;entry_row public.merchant_attendance_period_entries%rowtype;
  a public.merchant_attendance_period_artifacts%rowtype;v public.merchant_attendance_period_versions%rowtype;
  source_result jsonb;source_query jsonb;artifact_json jsonb;artifact_text text;artifact_size integer;common jsonb;history jsonb:='[]';items jsonb:='[]';summary jsonb;
  replayed boolean:=false;changed boolean;is_new boolean;new_version boolean;now_at timestamptz;prior_at timestamptz;fmt text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
  n integer;bytes_total bigint;k text;self_employee uuid;expected_worker jsonb;expected_period jsonb;
begin
  if p_auth_user_id is null or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','access','workerId','fromDate','throughDate','mode','periodId','operationId','version']) is distinct from true
    or octet_length(p_query::text)>2048 then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';access_name:=p_query->>'access';mode_name:=p_query->>'mode';
  if jsonb_typeof(p_query->'siteId') is distinct from 'string' or jsonb_typeof(p_query->'access') is distinct from 'string'
    or jsonb_typeof(p_query->'mode') is distinct from 'string' or length(site)<>8 or site!~'^[0-9]{8}$'
    or access_name not in('owner','self') or mode_name not in('list','preview','detail','recover','export') then raise exception 'attendance_invalid_request';end if;
  foreach k in array array['workerId','periodId','operationId'] loop
    if k<>'workerId' and p_query->k='null'::jsonb then continue;end if;
    if jsonb_typeof(p_query->k) is distinct from 'string' or length(p_query->>k)<>36
      or (p_query->>k)!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'attendance_invalid_request';end if;
  end loop;
  foreach k in array array['fromDate','throughDate'] loop
    if jsonb_typeof(p_query->k) is distinct from 'string' or length(p_query->>k)<>10 or (p_query->>k)!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or (p_query->>k)::date::text is distinct from p_query->>k then raise exception 'attendance_invalid_request';end if;
  end loop;
  wid:=(p_query->>'workerId')::uuid;pid:=(p_query->>'periodId')::uuid;op:=(p_query->>'operationId')::uuid;
  first_day:=(p_query->>'fromDate')::date;last_day:=(p_query->>'throughDate')::date;
  if first_day<date '2000-01-01' or last_day>date '2100-12-31' or last_day-first_day not between 0 and 30 then raise exception 'attendance_invalid_request';end if;
  if p_query->'version'<>'null'::jsonb then
    if jsonb_typeof(p_query->'version') is distinct from 'number' or (p_query->>'version')!~'^[1-9][0-9]?$' then raise exception 'attendance_invalid_request';end if;
    requested_version:=(p_query->>'version')::integer;
    if requested_version>20 then raise exception 'attendance_invalid_request';end if;
  end if;
  if mode_name='list' and (pid is not null or op is not null or requested_version is not null)
    or mode_name='preview' and (op is not null or requested_version is not null)
    or mode_name in('detail','recover','export') and pid is null
    or (mode_name='recover')<>(op is not null) or mode_name='export' and requested_version is null then raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
    if public.faolla_attendance_period_closure_command_v1(p_command) is distinct from true or mode_name<>'detail' or requested_version is not null
      or p_command->>'periodId' is distinct from pid::text then raise exception 'attendance_invalid_request';end if;
    action_name:=p_command->>'action';op:=(p_command->>'operationId')::uuid;
    if (access_name='self')<>(action_name in('confirm','dispute')) then raise exception 'attendance_access_denied';end if;
  end if;
  if p_artifact is not null and action_name is distinct from 'send' then raise exception 'attendance_invalid_request';end if;

  -- Same serialization boundary as every correction/missing writer and150.
  perform 1 from public.merchants where id=site and (access_name='self' or user_id=p_auth_user_id) for share;
  if not found then raise exception 'attendance_access_denied';end if;
  --175 current-source reads must take settings UPDATE before worker UPDATE.
  --Fixed export, recovery, historical detail and list keep their old read lock.
  if p_command is null and mode_name<>'preview' and not(mode_name='detail' and p_query->'version'='null'::jsonb) then select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  else select * into s from public.merchant_attendance_settings where merchant_id=site for update;end if;
  if not found then raise exception 'attendance_settings_required';end if;
  if access_name='self' then
    select id into self_employee from public.merchant_enterprise_employees where merchant_id=site and auth_user_id=p_auth_user_id;
    if self_employee is null then raise exception 'attendance_access_denied';end if;
  end if;
  --148 itself uses worker UPDATE. Acquire that mode up front, never upgrade a
  --held worker SHARE when preview/detail subsequently call148.
  select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for update;
  if not found then if access_name='self' then raise exception 'attendance_access_denied';else raise exception 'attendance_worker_not_found';end if;end if;
  select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;
  if w.employee_id is null or e.id is null or e.auth_user_id is null then raise exception 'attendance_period_identity_changed';end if;
  if access_name='self' then
    if e.id<>self_employee or e.auth_user_id<>p_auth_user_id or e.status<>'active' then raise exception 'attendance_access_denied';end if;
    select * into r from public.merchant_enterprise_roles where merchant_id=site and id=e.role_id for share;
    if r.status is distinct from 'active' or public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions) is distinct from true
      or not('enterprise.view'=any(r.permissions)) or not('attendance.self.view'=any(r.permissions))
      or mode_name='export' and not('attendance.self.export'=any(r.permissions)) then raise exception 'attendance_access_denied';end if;
  end if;
  source_query:=jsonb_build_object('siteId',site,'access',access_name,'workerId',wid,'fromDate',first_day,'throughDate',last_day,'periodId',pid);
  if pid is not null then
    select * into c from public.merchant_attendance_period_closures where merchant_id=site and period_id=pid;
    if c.period_id is not null then
      if c.worker_id<>wid or c.from_date<>first_day or c.through_date<>last_day then raise exception 'attendance_access_denied';end if;
      if c.employee_id<>e.id or c.employee_auth_user_id<>e.auth_user_id then raise exception 'attendance_period_identity_changed';end if;
    end if;
  end if;
  if op is not null then
    select * into saved from public.merchant_attendance_period_entries where merchant_id=site and operation_id=op;
    if saved.operation_id is not null then
      if saved.period_id<>pid or saved.actor_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;
      if c.period_id is null then raise exception 'attendance_period_closure_invalid';end if;
      if p_command is not null and saved.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
      replayed:=true;
    elsif mode_name='recover' then raise exception 'attendance_operation_not_found';end if;
  end if;

  if mode_name='list' then
    for listed in select * from public.merchant_attendance_period_closures where merchant_id=site and worker_id=wid
      and from_date=first_day and through_date=last_day order by opened_at desc,period_id desc limit 21 loop
      if jsonb_array_length(items)>=20 then raise exception 'attendance_period_limit';end if;
      if listed.employee_id<>e.id or listed.employee_auth_user_id<>e.auth_user_id then raise exception 'attendance_period_identity_changed';end if;
      select * into a from public.merchant_attendance_period_artifacts where merchant_id=site and period_id=listed.period_id
        and artifact_id=(select artifact_id from public.merchant_attendance_period_versions where merchant_id=site and period_id=listed.period_id and version=listed.current_version);
      items:=items||jsonb_build_array(public.faolla_attendance_period_summary_v1(listed,public.faolla_attendance_period_artifact_checked_v1(a)));
    end loop;
    return jsonb_build_object('protocol','period-closure-v1','siteId',site,'workerId',wid,'actorId',p_auth_user_id,'access',access_name,
      'readAt',to_char(clock_timestamp() at time zone 'UTC',fmt),'kind','list','items',items);
  end if;
  if mode_name='preview' then
    if pid is not null and c.period_id is null then raise exception 'attendance_period_not_found';end if;
    if c.period_id is not null then
      select * into a from public.merchant_attendance_period_artifacts where merchant_id=site and period_id=pid
        and artifact_id=(select artifact_id from public.merchant_attendance_period_versions where merchant_id=site and period_id=pid and version=c.current_version);
      summary:=public.faolla_attendance_period_summary_v1(c,public.faolla_attendance_period_artifact_checked_v1(a));
    end if;
    source_result:=public.faolla_attendance_period_closure_source_v1(source_query,p_auth_user_id);
    return jsonb_build_object('protocol','period-closure-v1','siteId',site,'workerId',wid,'actorId',p_auth_user_id,'access',access_name,
      'readAt',to_char(clock_timestamp() at time zone 'UTC',fmt),'kind','preview','period',summary,'source',source_result);
  end if;

  if p_command is not null and saved.operation_id is null then
    -- Reopen only removes this independent gate, not084 or the old deadline.
    -- It remains available to the current owner when the module is paused.
    if action_name<>'reopen' and (not coalesce(p_allow_write,false) or not s.enabled) then raise exception 'attendance_platform_paused';end if;
    if access_name='self' and not('attendance.self.request'=any(r.permissions)) then raise exception 'attendance_access_denied';end if;
    is_new:=c.period_id is null;
    if is_new and action_name<>'send' then raise exception 'attendance_period_not_found';end if;
    if (p_command->>'expectedRevision')::integer<>coalesce(c.revision,0) or (p_command->>'expectedVersion')::integer<>coalesce(c.current_version,0) then raise exception 'attendance_version_conflict';end if;
    if coalesce(c.revision,0)>=100 or coalesce(c.revision,0)>=99 and action_name<>'reopen' then raise exception 'attendance_period_limit';end if;
    if action_name='send' then
      if c.sealed then raise exception 'attendance_period_sealed';end if;
      if p_artifact is null then raise exception 'attendance_invalid_request';end if;
      source_result:=public.faolla_attendance_period_closure_source_v1(source_query,p_auth_user_id);
      --179 also blocks relevant unresolved outage reviews before a fresh send.
      --Other old blockers retain their old review/seal semantics.
      if (source_result->'blockers' ? 'period_in_progress' or source_result->'blockers' ? 'unresolved_outage') then raise exception 'attendance_period_blocked';end if;
      if source_result->>'sourceFingerprint' is distinct from p_command->>'expectedFingerprint'
        or p_artifact->>'sourceFingerprint' is distinct from source_result->>'sourceFingerprint'
        or p_artifact->'source' is distinct from source_result->'sourceCanonical' then raise exception 'attendance_period_source_changed';end if;
      expected_worker:=jsonb_build_object('workerId',wid,'employeeId',e.id,'employeeAuthUserId',e.auth_user_id,'workerName',w.display_name,'workerNo',w.worker_no);
      expected_period:=jsonb_build_object('fromDate',first_day,'throughDate',last_day,'timeZone',source_result->'timeZone','startAt',source_result->'fromAt','endAt',source_result->'toAt');
      if p_artifact->'worker' is distinct from expected_worker or p_artifact->'period' is distinct from expected_period
        or p_artifact->'dayBoundaries' is distinct from source_result->'dayBoundaries'
        or p_artifact->'report'->>'access' is distinct from 'owner'
        or p_artifact->'report'->'base'->>'workerId' is distinct from wid::text
        or p_artifact->'report'->'base'->>'employeeId' is distinct from e.id::text
        or p_artifact->'report'->'base'->>'fromAt' is distinct from source_result->>'fromAt'
        or p_artifact->'report'->'base'->>'toAt' is distinct from source_result->>'toAt' then raise exception 'attendance_period_closure_invalid';end if;
      -- Validate every fresh supplied body, even if this source fingerprint can
      -- reuse an existing immutable artifact (or need no new logical version).
      artifact_text:=p_artifact::text;artifact_size:=octet_length(convert_to(artifact_text,'UTF8'));
      if artifact_size>2097152 then raise exception 'attendance_period_source_too_large';end if;
      a.merchant_id:=site;a.period_id:=pid;a.artifact_id:=op;a.source_fingerprint:=source_result->>'sourceFingerprint';
      a.artifact_text:=artifact_text;a.artifact_sha256:=encode(sha256(convert_to(artifact_text,'UTF8')),'hex');a.artifact_bytes:=artifact_size;
      perform public.faolla_attendance_period_artifact_checked_v1(a);
      if not is_new and expected_period is distinct from jsonb_build_object('fromDate',c.from_date,'throughDate',c.through_date,'timeZone',c.time_zone,
        'startAt',to_char(c.start_at at time zone 'UTC',fmt),'endAt',to_char(c.end_at at time zone 'UTC',fmt)) then raise exception 'attendance_period_source_changed';end if;
      now_at:=clock_timestamp();
      if now_at<(source_result->>'readAt')::timestamptz or c.updated_at>now_at then raise exception 'attendance_version_conflict';end if;
      if is_new then
        if exists(select 1 from public.merchant_attendance_period_closures where merchant_id=site and worker_id=wid
          and start_at<(source_result->>'toAt')::timestamptz and end_at>(source_result->>'fromAt')::timestamptz) then raise exception 'attendance_period_overlap';end if;
        select count(*) into n from (select 1 from public.merchant_attendance_period_closures where merchant_id=site limit 1000) bounded;
        if n>=1000 then raise exception 'attendance_period_limit';end if;
        select count(*) into n from (select 1 from public.merchant_attendance_period_closures where merchant_id=site and worker_id=wid limit 200) bounded;
        if n>=200 then raise exception 'attendance_period_limit';end if;
        insert into public.merchant_attendance_period_closures(merchant_id,period_id,worker_id,employee_id,employee_auth_user_id,from_date,through_date,time_zone,start_at,end_at,
          revision,current_version,state,sealed,confirmed_version,unresolved_dispute,opened_at,updated_at)
          values(site,pid,wid,e.id,e.auth_user_id,first_day,last_day,source_result->>'timeZone',(source_result->>'fromAt')::timestamptz,(source_result->>'toAt')::timestamptz,
            1,1,'review',false,null,false,now_at,now_at) returning * into c;
        new_version:=true;
      else
        select * into v from public.merchant_attendance_period_versions where merchant_id=site and period_id=pid and version=c.current_version;
        select * into a from public.merchant_attendance_period_artifacts where merchant_id=site and artifact_id=v.artifact_id;
        artifact_json:=public.faolla_attendance_period_artifact_checked_v1(a);
        if a.source_fingerprint=source_result->>'sourceFingerprint' and artifact_json->'source' is distinct from source_result->'sourceCanonical' then
          raise exception 'attendance_period_closure_invalid';end if;
        new_version:=c.state='open' or a.source_fingerprint<>source_result->>'sourceFingerprint';
        if new_version and c.current_version>=20 then raise exception 'attendance_period_limit';end if;
      end if;
      if new_version then
        select * into a from public.merchant_attendance_period_artifacts where merchant_id=site and period_id=pid and source_fingerprint=source_result->>'sourceFingerprint';
        if a.artifact_id is null then
          select coalesce(sum(artifact_bytes),0) into bytes_total from public.merchant_attendance_period_artifacts where merchant_id=site;
          if bytes_total+artifact_size>67108864 then raise exception 'attendance_period_limit';end if;
          a.merchant_id:=site;a.period_id:=pid;a.artifact_id:=op;a.source_fingerprint:=source_result->>'sourceFingerprint';
          a.artifact_text:=artifact_text;a.artifact_sha256:=encode(sha256(convert_to(artifact_text,'UTF8')),'hex');a.artifact_bytes:=artifact_size;a.recorded_at:=now_at;
          perform public.faolla_attendance_period_artifact_checked_v1(a);
          insert into public.merchant_attendance_period_artifacts select (a).*;
        else
          artifact_json:=public.faolla_attendance_period_artifact_checked_v1(a);
          if artifact_json->'source' is distinct from source_result->'sourceCanonical' then raise exception 'attendance_period_closure_invalid';end if;
        end if;
        if not is_new then c.current_version:=c.current_version+1;end if;
        insert into public.merchant_attendance_period_versions(merchant_id,period_id,version,artifact_id,operation_id,recorded_at)
          values(site,pid,c.current_version,a.artifact_id,op,now_at);
        c.confirmed_version:=null;c.state:=case when c.unresolved_dispute then 'disputed' else 'review' end;
      end if;
    else
      select * into v from public.merchant_attendance_period_versions where merchant_id=site and period_id=pid and version=c.current_version;
      select * into a from public.merchant_attendance_period_artifacts where merchant_id=site and period_id=pid and artifact_id=v.artifact_id;
      artifact_json:=public.faolla_attendance_period_artifact_checked_v1(a);
      if action_name in('confirm','seal') then
        if c.sealed then raise exception 'attendance_period_sealed';end if;
        if c.state='open' then raise exception 'attendance_period_not_confirmed';end if;
        if p_command->>'expectedFingerprint' is distinct from a.source_fingerprint then raise exception 'attendance_period_source_changed';end if;
        source_result:=public.faolla_attendance_period_closure_source_v1(source_query,p_auth_user_id);
        if source_result->>'sourceFingerprint' is distinct from a.source_fingerprint
          or source_result->'sourceCanonical' is distinct from artifact_json->'source' then raise exception 'attendance_period_source_changed';end if;
        if action_name='confirm' then c.confirmed_version:=c.current_version;c.unresolved_dispute:=false;c.state:='confirmed';
        else
          if source_result->>'validation' is distinct from 'owner_checked' or source_result->'blockers' is distinct from '[]'::jsonb then raise exception 'attendance_period_blocked';end if;
          if c.confirmed_version is distinct from c.current_version or c.unresolved_dispute then raise exception 'attendance_period_not_confirmed';end if;
          c.sealed:=true;c.state:='sealed';
        end if;
      elsif action_name='dispute' then
        c.unresolved_dispute:=true;if not c.sealed then c.state:='disputed';end if;
      elsif action_name='reopen' then
        if not c.sealed then raise exception 'attendance_period_not_sealed';end if;
        c.sealed:=false;c.state:='open';c.confirmed_version:=null;
      end if;
      -- respond appends an owner explanation only; it cannot clear a dispute,
      -- invent the employee's confirmation or rewrite a sealed version.
      now_at:=clock_timestamp();
      if c.updated_at>now_at or source_result is not null and now_at<(source_result->>'readAt')::timestamptz then raise exception 'attendance_version_conflict';end if;
    end if;
    c.revision:=(p_command->>'expectedRevision')::integer+1;c.updated_at:=now_at;
    insert into public.merchant_attendance_period_entries(merchant_id,period_id,operation_id,revision,version,actor_auth_user_id,action,command,recorded_at)
      values(site,pid,op,c.revision,c.current_version,p_auth_user_id,action_name,p_command,now_at) returning * into saved;
    update public.merchant_attendance_period_closures set revision=c.revision,current_version=c.current_version,state=c.state,sealed=c.sealed,
      confirmed_version=c.confirmed_version,unresolved_dispute=c.unresolved_dispute,updated_at=c.updated_at where merchant_id=site and period_id=pid;
  end if;

  if c.period_id is null then raise exception 'attendance_period_not_found';end if;
  if requested_version is null then requested_version:=case when replayed then saved.version else c.current_version end;end if;
  if replayed and requested_version<>saved.version then raise exception 'attendance_invalid_request';end if;
  select * into v from public.merchant_attendance_period_versions where merchant_id=site and period_id=pid and version=requested_version;
  if v.version is null then raise exception 'attendance_period_not_found';end if;
  select * into a from public.merchant_attendance_period_artifacts where merchant_id=site and period_id=pid and artifact_id=v.artifact_id;
  artifact_json:=public.faolla_attendance_period_artifact_checked_v1(a);
  summary:=public.faolla_attendance_period_summary_v1(c,artifact_json);
  for entry_row in select * from public.merchant_attendance_period_entries where merchant_id=site and period_id=pid order by revision limit 101 loop
    if entry_row.revision<>jsonb_array_length(history)+1 or entry_row.version>c.current_version or entry_row.recorded_at<c.opened_at
      or entry_row.recorded_at>c.updated_at or prior_at>entry_row.recorded_at then raise exception 'attendance_period_closure_invalid';end if;
    history:=history||jsonb_build_array(public.faolla_attendance_period_entry_v1(entry_row));prior_at:=entry_row.recorded_at;
  end loop;
  if jsonb_array_length(history)<>c.revision then raise exception 'attendance_period_closure_invalid';end if;
  select count(*) into n from public.merchant_attendance_period_versions where merchant_id=site and period_id=pid;
  if n<>c.current_version then raise exception 'attendance_period_closure_invalid';end if;
  -- Recovery, export, historical version reads and all completed writes return
  -- the stored bytes without collecting current sources or consulting tzdata.
  if p_command is null and mode_name='detail' and p_query->'version'='null'::jsonb then
    begin
      source_result:=public.faolla_attendance_period_closure_source_v1(source_query,p_auth_user_id);
      changed:=source_result->>'sourceFingerprint' is distinct from a.source_fingerprint;
    exception when raise_exception then
      -- A current source that cannot now be collected does not erase a saved
      -- archive or strand reopening. Authorization and unknown errors still fail.
      if sqlerrm=any(array['attendance_period_source_invalid','attendance_period_source_too_large',
        'attendance_period_source_identity_changed','attendance_period_identity_unproven',
        'attendance_period_source_identity_unproven','attendance_report_invalid_data',
        'attendance_report_too_large','attendance_report_reconciliation_required','attendance_session_invalid_records']) then
        changed:=null;
      else raise;end if;
    end;
  end if;
  common:=jsonb_build_object('protocol','period-closure-v1','siteId',site,'workerId',wid,'actorId',p_auth_user_id,'access',access_name,
    'readAt',to_char(clock_timestamp() at time zone 'UTC',fmt));
  return common||jsonb_build_object('kind','detail','period',summary,'artifact',artifact_json,'artifactText',a.artifact_text,
    'artifactSha256',a.artifact_sha256,'artifactBytes',a.artifact_bytes,'artifactVersion',requested_version,'history',history,
    'sourceChanged',changed,'operation',public.faolla_attendance_period_entry_v1(saved),'replayed',replayed);
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
  raise exception 'attendance_invalid_request';
end;
$$;

revoke all on function public.faolla_attendance_outage_period_context_v1(text,uuid,uuid,uuid,timestamp with time zone,timestamp with time zone) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_period_closure_source_base_v1(jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_period_closure_source_v1(jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_period_closure_v1(jsonb,uuid,jsonb,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_period_closure_source_v1(jsonb,uuid) to service_role;
grant execute on function public.faolla_attendance_period_closure_v1(jsonb,uuid,jsonb,jsonb,boolean) to service_role;
do $outage_period_postconditions$
declare signature text;meta record;role_name text;service_allowed boolean;
begin
  foreach signature in array array['public.faolla_attendance_period_closure_source_base_v1(jsonb,uuid)',
    'public.faolla_attendance_period_closure_source_v1(jsonb,uuid)','public.faolla_attendance_period_closure_v1(jsonb,uuid,jsonb,jsonb,boolean)'] loop
    select p.*,l.lanname into meta from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(signature);
    if meta.oid is null or meta.prokind<>'f' or meta.lanname<>'plpgsql' or not meta.prosecdef or meta.proretset
      or meta.proargmodes is not null or meta.proparallel<>'u' or meta.pronargs<>(case when signature like '%boolean)' then 5 else 2 end)
      or meta.prorettype<>'jsonb'::regtype or meta.provolatile<>'v' or meta.proconfig is distinct from array['search_path=pg_catalog']::text[]
      or meta.pronargdefaults<>(case when signature like '%boolean)' then 3 else 0 end)
      or meta.proargnames is distinct from (case when signature like '%boolean)' then array['p_query','p_auth_user_id','p_command','p_artifact','p_allow_write']::text[] else array['p_query','p_auth_user_id']::text[] end) then
      raise exception 'merchant_attendance_outage_periods_function_conflict';end if;
    service_allowed:=signature<>'public.faolla_attendance_period_closure_source_base_v1(jsonb,uuid)';
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(role_name,signature,'EXECUTE') is distinct from (role_name='service_role' and service_allowed) then raise exception 'merchant_attendance_outage_periods_function_conflict';end if;
    end loop;
    if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=meta.oid
      and a.privilege_type='EXECUTE' and a.grantee<>p.proowner and (not service_allowed or a.grantee<>(select oid from pg_roles where rolname='service_role'))) then raise exception 'merchant_attendance_outage_periods_function_conflict';end if;
  end loop;
  signature:='public.faolla_attendance_outage_period_context_v1(text,uuid,uuid,uuid,timestamp with time zone,timestamp with time zone)';
  select p.*,l.lanname into meta from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(signature);
  if meta.oid is null or meta.prokind<>'f' or meta.lanname<>'plpgsql' or meta.prosecdef or meta.proretset
    or meta.proargmodes is not null or meta.proparallel<>'u' or meta.pronargs<>6 or meta.pronargdefaults<>0 or meta.prorettype<>'jsonb'::regtype
    or meta.provolatile<>'v' or meta.proconfig is distinct from array['search_path=pg_catalog']::text[]
    or meta.proargnames is distinct from array['p_site','p_worker','p_employee','p_employee_auth','p_from','p_to']::text[]
    or (select count(*) from pg_proc p where p.pronamespace=meta.pronamespace and p.proname=meta.proname)<>1 then raise exception 'merchant_attendance_outage_periods_function_conflict';end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
    if has_function_privilege(role_name,signature,'EXECUTE') then raise exception 'merchant_attendance_outage_periods_function_conflict';end if;
  end loop;
  if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=meta.oid
    and a.privilege_type='EXECUTE' and a.grantee<>p.proowner) then raise exception 'merchant_attendance_outage_periods_function_conflict';end if;
end;
$outage_period_postconditions$;
do $outage_period_index_ready$
declare idx oid:=to_regclass('public.attendance_outage_declaration_period_idx');
begin
  if idx is null then raise exception 'merchant_attendance_outage_periods_index_conflict';end if;
  if idx is not null and not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam
    where i.indexrelid=idx and i.indrelid='public.merchant_attendance_outage_declarations'::regclass and am.amname='btree'
      and i.indisvalid and i.indisready and i.indislive and not i.indisunique and not i.indisexclusion and i.indnatts=5 and i.indnkeyatts=5
      and i.indexprs is not null and i.indpred is null
      and pg_get_indexdef(idx,1,true)='merchant_id' and pg_get_indexdef(idx,2,true)='worker_id' and pg_get_indexdef(idx,5,true)='declaration_id'
      and regexp_replace(replace(pg_get_indexdef(idx,3,true),'::text',''),'[[:space:]()]','','g')='declared_interval->>''startAt'''
      and regexp_replace(replace(pg_get_indexdef(idx,4,true),'::text',''),'[[:space:]()]','','g')='declared_interval->>''endAt'''
      and not exists(select 1 from unnest(i.indoption::smallint[]) option_bits where option_bits<>0)
      and i.indcollation[0]=(select attcollation from pg_attribute where attrelid=i.indrelid and attname='merchant_id') and i.indcollation[1]=0 and i.indcollation[4]=0
      and i.indcollation[2]=(select oid from pg_collation where collnamespace='pg_catalog'::regnamespace and collname='default')
      and i.indcollation[3]=i.indcollation[2]
      and not exists(select 1 from unnest(i.indclass::oid[]) with ordinality classes(opclass_id,position) where opclass_id is distinct from
        (select oc.oid from pg_opclass oc where oc.opcnamespace='pg_catalog'::regnamespace and oc.opcmethod=am.oid and oc.opcdefault
          and oc.opcname=case classes.position when 2 then 'uuid_ops' when 5 then 'uuid_ops' else 'text_ops' end))) then raise exception 'merchant_attendance_outage_periods_index_conflict';end if;
end;
$outage_period_index_ready$;
insert into public.faolla_schema_migrations(version,name) values(202610070179,'merchant_attendance_outage_periods') on conflict(version) do nothing;
notify pgrst,'reload schema';
commit;
