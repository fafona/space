--209 formal-exception delegation, additive/default-off. No owner impersonation,
--historic rewrite, new approval semantics, automatic absence or payroll.
begin;
set local lock_timeout='3s';
--BEGIN GENERATED DELEGATED PLAN EXCEPTIONS PREFLIGHT
do $exceptions209_prerequisites$ begin
 if not exists(select 1 from public.faolla_schema_migrations where version=202610080208 and name='merchant_attendance_delegated_revisions')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610050136 and name='merchant_attendance_schedule_publication_evidence')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610060174 and name='merchant_attendance_plan_posthoc_reviews')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080195 and name='merchant_attendance_administrative_closure')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080184 and name='merchant_attendance_period_delegated_source') then raise exception 'merchant_attendance_delegated_plan_exceptions_prerequisite_required';end if;
 if exists(select 1 from public.faolla_schema_migrations where version=202610090209 and name<>'merchant_attendance_delegated_plan_exceptions') then raise exception 'merchant_attendance_delegated_plan_exceptions_installation_conflict';end if;
 end;$exceptions209_prerequisites$;
 create temp table merchant_attendance_settings(merchant_id text primary key) on commit drop;
create temp table merchant_attendance_locations(merchant_id text,id uuid,primary key(merchant_id,id)) on commit drop;
create temp table merchant_attendance_workers(merchant_id text,id uuid,primary key(merchant_id,id)) on commit drop;
create temp table merchant_enterprise_employees(merchant_id text,id uuid,primary key(merchant_id,id)) on commit drop;
create temp table merchant_attendance_events(id uuid primary key) on commit drop;
create temp table merchant_attendance_terminals (
  merchant_id text not null references pg_temp.merchant_attendance_settings(merchant_id) on delete restrict,
  id uuid not null,
  location_id uuid not null,
  label text not null check (char_length(btrim(label)) between 1 and 80 and label !~ '[[:cntrl:]]'),
  time_zone text not null check (public.faolla_attendance_valid_zone_v1(time_zone)),
  created_by uuid not null,
  created_at timestamptz not null check (isfinite(created_at)),
  pair_hash text not null check (pair_hash ~ '^[0-9a-f]{64}$'),
  pair_expires_at timestamptz not null,
  paired_at timestamptz,
  device_hash text check (device_hash ~ '^[0-9a-f]{64}$'),
  device_expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid,
  primary key (merchant_id,id),
  foreign key (merchant_id,location_id) references pg_temp.merchant_attendance_locations(merchant_id,id) on delete restrict,
  check (pair_expires_at = created_at + interval '5 minutes'),
  check ((paired_at is null and device_hash is null and device_expires_at is null)
    or (paired_at is not null and device_hash is not null and device_expires_at is not null
      and paired_at >= created_at and paired_at < pair_expires_at and device_expires_at = paired_at + interval '720 hours')),
  check ((revoked_at is null and revoked_by is null)
    or (revoked_at is not null and revoked_by is not null and isfinite(revoked_at)
      and revoked_at >= coalesce(paired_at,created_at)))
 ) on commit drop;
create temp table merchant_attendance_terminal_audit (
  merchant_id text not null,
  terminal_id uuid not null,
  action text not null check (action in ('create','pair','revoke')),
  actor_auth_user_id uuid,
  recorded_at timestamptz not null check (isfinite(recorded_at)),
  primary key (merchant_id,terminal_id,action),
  foreign key (merchant_id,terminal_id) references pg_temp.merchant_attendance_terminals(merchant_id,id) on delete restrict,
  check ((action='pair')=(actor_auth_user_id is null))
 ) on commit drop;
create temp table merchant_attendance_pin_credentials(
  merchant_id text not null, worker_id uuid not null, employee_id uuid not null,
  revision integer not null check(revision>0), enabled boolean not null,
  salt text, verifier text, changed_at timestamptz not null, created_by uuid not null,
  attempts integer not null default 0 check(attempts between 0 and 10), window_at timestamptz not null,
  primary key(merchant_id,worker_id),
  foreign key(merchant_id,worker_id) references pg_temp.merchant_attendance_workers(merchant_id,id) on delete restrict,
  foreign key(merchant_id,employee_id) references pg_temp.merchant_enterprise_employees(merchant_id,id) on delete restrict,
  check((enabled and salt ~ '^[0-9a-f]{32}$' and verifier ~ '^[0-9a-f]{64}$' and salt is not null and verifier is not null)
    or (not enabled and salt is null and verifier is null)),
  check(isfinite(changed_at) and isfinite(window_at))
 ) on commit drop;
create temp table merchant_attendance_pin_audit(
  merchant_id text not null, operation_id uuid not null, worker_id uuid not null, actor uuid not null,
  action text not null check(action in ('set','revoke')), revision integer not null check(revision>0),
  command_hash text not null check(command_hash ~ '^[0-9a-f]{64}$'), recorded_at timestamptz not null,
  primary key(merchant_id,operation_id), unique(merchant_id,worker_id,revision),
  foreign key(merchant_id,worker_id) references pg_temp.merchant_attendance_workers(merchant_id,id) on delete restrict
 ) on commit drop;
create temp table merchant_attendance_pin_attempts(
  merchant_id text not null, terminal_id uuid not null, attempts integer not null check(attempts between 0 and 60), window_at timestamptz not null,
  lease_id uuid, lease_expires timestamptz, worker_id uuid, employee_id uuid, credential_revision integer,
  primary key(merchant_id,terminal_id),
  foreign key(merchant_id,terminal_id) references pg_temp.merchant_attendance_terminals(merchant_id,id) on delete restrict,
  check((lease_id is null and lease_expires is null and worker_id is null and employee_id is null and credential_revision is null)
    or (lease_id is not null and lease_expires is not null and worker_id is not null and employee_id is not null and credential_revision is not null))
 ) on commit drop;
create temp table merchant_attendance_independent_subjects(
 merchant_id text not null,
 subject_id uuid not null,
 worker_id uuid not null,
 constraint ind196_subjects_kind_ck1 check(kind='independent'),
 kind text not null default 'independent',
 constraint ind196_subjects_state_ck2 check(state in('independent','bound')),
 state text not null,
 enabled boolean not null,
 constraint ind196_subjects_generation_ck3 check(generation between 0 and 9007199254740990),
 generation bigint not null,
 constraint ind196_subjects_revision_ck4 check(revision between 1 and 9007199254740990),
 revision bigint not null,
 created_operation_id uuid not null,
 created_by uuid not null,
 constraint ind196_subjects_created_at_ck5 check(isfinite(created_at)),
 created_at timestamptz not null,
 constraint ind196_subjects_updated_at_ck6 check(isfinite(updated_at) and updated_at>=created_at),
 updated_at timestamptz not null,
 constraint ind196_subjects_pk7 primary key(merchant_id,subject_id),
 constraint ind196_subjects_uq8 unique(merchant_id,worker_id),
 constraint ind196_subjects_fk9 foreign key(merchant_id,worker_id) references pg_temp.merchant_attendance_workers(merchant_id,id) on delete restrict,
 constraint ind196_subjects_ck10 check(state<>'bound' or not enabled)
 ) on commit drop;
create temp table merchant_attendance_independent_entries(
 merchant_id text not null,
 operation_id uuid not null,
 subject_id uuid not null,
 worker_id uuid not null,
 constraint ind196_entries_action_ck1 check(action in('create','enable','disable','issue_pin','revoke_pin','bind_member')),
 action text not null,
 actor_auth_user_id uuid not null,
 command jsonb not null,
 constraint ind196_entries_command_fingerprint_ck2 check(command_fingerprint~'^[0-9a-f]{64}$'),
 command_fingerprint text not null,
 constraint ind196_entries_subject_revision_ck3 check(subject_revision between 1 and 9007199254740990),
 subject_revision bigint not null,
 constraint ind196_entries_generation_ck4 check(generation between 0 and 9007199254740990),
 generation bigint not null,
 constraint ind196_entries_worker_version_ck5 check(worker_version between 1 and 9007199254740990),
 worker_version bigint not null,
 constraint ind196_entries_credential_revision_ck6 check(credential_revision between 0 and 9007199254740990),
 credential_revision bigint,
 credential_id uuid,
 constraint ind196_entries_material_commitment_ck7 check(material_commitment~'^[0-9a-f]{64}$'),
 material_commitment text,
 constraint ind196_entries_recorded_at_ck8 check(isfinite(recorded_at)),
 recorded_at timestamptz not null,
 constraint ind196_entries_pk9 primary key(merchant_id,operation_id),
 constraint ind196_entries_uq10 unique(merchant_id,subject_id,subject_revision),
 constraint ind196_entries_fk11 foreign key(merchant_id,subject_id) references pg_temp.merchant_attendance_independent_subjects(merchant_id,subject_id) on delete restrict,
 constraint ind196_entries_fk12 foreign key(merchant_id,worker_id) references pg_temp.merchant_attendance_workers(merchant_id,id) on delete restrict,
 constraint ind196_entries_ck13 check((action='issue_pin')=(material_commitment is not null)),
 constraint ind196_entries_ck14 check((action='issue_pin')=(credential_id is not null))
 ) on commit drop;
create temp table merchant_attendance_independent_credentials(
 merchant_id text not null,
 subject_id uuid not null,
 credential_id uuid not null,
 worker_id uuid not null,
 constraint ind196_credentials_generation_ck1 check(generation between 0 and 9007199254740990),
 generation bigint not null,
 constraint ind196_credentials_revision_ck2 check(revision between 1 and 9007199254740990),
 revision bigint not null,
 enabled boolean not null,
 salt text,
 verifier text,
 issue_operation_id uuid not null,
 constraint ind196_credentials_changed_at_ck3 check(isfinite(changed_at)),
 changed_at timestamptz not null,
 constraint ind196_credentials_attempts_ck4 check(attempts between 0 and 10),
 attempts integer not null default 0,
 constraint ind196_credentials_window_at_ck5 check(isfinite(window_at)),
 window_at timestamptz not null,
 constraint ind196_credentials_pk6 primary key(merchant_id,subject_id),
 constraint ind196_credentials_uq7 unique(merchant_id,credential_id),
 constraint ind196_credentials_fk8 foreign key(merchant_id,subject_id) references pg_temp.merchant_attendance_independent_subjects(merchant_id,subject_id) on delete restrict,
 constraint ind196_credentials_fk9 foreign key(merchant_id,worker_id) references pg_temp.merchant_attendance_workers(merchant_id,id) on delete restrict,
 constraint ind196_credentials_fk10 foreign key(merchant_id,issue_operation_id) references pg_temp.merchant_attendance_independent_entries(merchant_id,operation_id) deferrable initially deferred,
 constraint ind196_credentials_ck11 check((enabled and salt~'^[0-9a-f]{32}$' and verifier~'^[0-9a-f]{64}$' and salt is not null and verifier is not null)
  or (not enabled and salt is null and verifier is null))
 ) on commit drop;
create temp table merchant_attendance_independent_leases(
 merchant_id text not null,
 terminal_id uuid not null,
 lease_id uuid not null,
 worker_id uuid not null,
 subject_id uuid not null,
 generation bigint not null,
 worker_version bigint not null,
 credential_id uuid not null,
 credential_revision bigint not null,
 constraint ind196_leases_versions_ck check(generation between 0 and 9007199254740990 and worker_version between 1 and 9007199254740990 and credential_revision between 1 and 9007199254740990),
 constraint ind196_leases_budget_window_ck1 check(isfinite(budget_window)),
 budget_window timestamptz not null,
 constraint ind196_leases_budget_ordinal_ck2 check(budget_ordinal between 1 and 60),
 budget_ordinal integer not null,
 constraint ind196_leases_created_at_ck3 check(isfinite(created_at)),
 created_at timestamptz not null,
 expires_at timestamptz not null,
 constraint ind196_leases_pk4 primary key(merchant_id,terminal_id),
 constraint ind196_leases_uq5 unique(merchant_id,lease_id),
 constraint ind196_leases_ck6 check(expires_at=created_at+interval '30 seconds'),
 constraint ind196_leases_fk7 foreign key(merchant_id,terminal_id) references pg_temp.merchant_attendance_terminals(merchant_id,id) on delete restrict,
 constraint ind196_leases_fk8 foreign key(merchant_id,subject_id) references pg_temp.merchant_attendance_independent_subjects(merchant_id,subject_id) on delete restrict,
 constraint ind196_leases_fk9 foreign key(merchant_id,worker_id) references pg_temp.merchant_attendance_workers(merchant_id,id) on delete restrict
 ) on commit drop;
create temp table merchant_attendance_independent_event_sources(
 constraint ind196_event_sources_pk1 primary key(event_id),
 constraint ind196_event_sources_event_id_fk2 foreign key(event_id) references pg_temp.merchant_attendance_events(id) on delete restrict,
 event_id uuid,
 merchant_id text not null,
 subject_id uuid not null,
 worker_id uuid not null,
 operation_id uuid not null,
 constraint ind196_event_sources_generation_ck3 check(generation between 0 and 9007199254740990),
 generation bigint not null,
 credential_id uuid not null,
 constraint ind196_event_sources_credential_revision_ck4 check(credential_revision between 1 and 9007199254740990),
 credential_revision bigint not null,
 credential_issue_operation_id uuid not null,
 terminal_id uuid not null,
 worker_version bigint not null,
 settings_version bigint not null,
 location_version bigint not null,
 constraint ind196_event_sources_versions_ck check(worker_version between 1 and 9007199254740990 and settings_version between 1 and 9007199254740990 and location_version between 1 and 9007199254740990),
 command jsonb not null,
 constraint ind196_event_sources_command_fingerprint_ck5 check(command_fingerprint~'^[0-9a-f]{64}$'),
 command_fingerprint text not null,
 constraint ind196_event_sources_recorded_at_ck6 check(isfinite(recorded_at)),
 recorded_at timestamptz not null,
 constraint ind196_event_sources_uq7 unique(merchant_id,worker_id,operation_id),
 constraint ind196_event_sources_fk8 foreign key(merchant_id,subject_id) references pg_temp.merchant_attendance_independent_subjects(merchant_id,subject_id) on delete restrict,
 constraint ind196_event_sources_fk9 foreign key(merchant_id,worker_id) references pg_temp.merchant_attendance_workers(merchant_id,id) on delete restrict,
 constraint ind196_event_sources_fk10 foreign key(merchant_id,credential_issue_operation_id) references pg_temp.merchant_attendance_independent_entries(merchant_id,operation_id) on delete restrict,
 constraint ind196_event_sources_fk11 foreign key(merchant_id,terminal_id) references pg_temp.merchant_attendance_terminals(merchant_id,id) on delete restrict
 ) on commit drop;
create temp table merchant_attendance_independent_member_bindings(
 merchant_id text not null,
 subject_id uuid not null,
 worker_id uuid not null,
 operation_id uuid not null,
 employee_id uuid not null,
 employee_auth_user_id uuid not null,
 worker_version bigint not null,
 generation bigint not null,
 constraint ind196_member_bindings_versions_ck check(worker_version between 2 and 9007199254740990 and generation between 1 and 9007199254740990),
 constraint ind196_member_bindings_last_independent_event_id_fk1 foreign key(last_independent_event_id) references pg_temp.merchant_attendance_events(id) on delete restrict,
 last_independent_event_id uuid,
 constraint ind196_member_bindings_last_sequence_ck2 check(last_sequence between 0 and 9007199254740990),
 last_sequence bigint not null,
 actor_auth_user_id uuid not null,
 constraint ind196_member_bindings_command_fingerprint_ck3 check(command_fingerprint~'^[0-9a-f]{64}$'),
 command_fingerprint text not null,
 constraint ind196_member_bindings_bound_at_ck4 check(isfinite(bound_at)),
 bound_at timestamptz not null,
 constraint ind196_member_bindings_pk5 primary key(merchant_id,subject_id),
 constraint ind196_member_bindings_uq6 unique(merchant_id,worker_id),
 constraint ind196_member_bindings_uq7 unique(merchant_id,operation_id),
 constraint ind196_member_bindings_fk8 foreign key(merchant_id,subject_id) references pg_temp.merchant_attendance_independent_subjects(merchant_id,subject_id) on delete restrict,
 constraint ind196_member_bindings_fk9 foreign key(merchant_id,operation_id) references pg_temp.merchant_attendance_independent_entries(merchant_id,operation_id) deferrable initially deferred,
 constraint ind196_member_bindings_fk10 foreign key(merchant_id,employee_id) references pg_temp.merchant_enterprise_employees(merchant_id,id) on delete restrict,
 constraint ind196_member_bindings_ck11 check((last_sequence=0)=(last_independent_event_id is null))
 ) on commit drop;
create temp table merchant_attendance_management_delegations(
 merchant_id text not null,
 grant_id uuid not null,
 actor_auth_user_id uuid not null,
 delegate_employee_id uuid not null,
 delegate_auth_user_id uuid not null,
 delegate_generation bigint not null check(delegate_generation between 0 and 9007199254740990),
 delegated_action text not null check(delegated_action=any(array['worker_save','group_save','group_assign','group_end','group_cancel','location_save','rule_draft','rule_publish','rule_withdraw','personal_rule_approve','personal_rule_withdraw','operational_rule_draft','operational_rule_publish','operational_rule_withdraw','terminal_prepare','terminal_revoke','pin_issue','pin_revoke','revision_approve','revision_reject','plan_exception_decide','audit_view','audit_export'])),
 capability text not null check(capability=any(array['attendance.workers.manage','attendance.groups.manage','attendance.locations.manage','attendance.rules.draft','attendance.rules.publish','attendance.rules.withdraw','attendance.terminals.pair','attendance.terminals.revoke','attendance.pin.issue','attendance.pin.revoke','attendance.correction.revision.review','attendance.plan_exception.review','attendance.audit.view','attendance.audit.export'])),
 scope jsonb not null,
 worker_id uuid,
 employee_id uuid,
 employee_auth_user_id uuid,
 employee_generation bigint check(employee_generation between 0 and 9007199254740990),
 valid_from timestamptz not null check(isfinite(valid_from)),
 valid_until timestamptz not null check(isfinite(valid_until) and valid_from<valid_until),
 reason text not null check(char_length(reason) between 1 and 200),
 command jsonb not null,
 command_fingerprint text not null check(command_fingerprint~'^[0-9a-f]{64}$'),
 recorded_at timestamptz not null check(isfinite(recorded_at)),
 constraint management_delegations_pk primary key(merchant_id,grant_id),
 constraint management_delegations_settings_fk foreign key(merchant_id) references pg_temp.merchant_attendance_settings(merchant_id) on delete restrict,
 constraint management_delegations_delegate_fk foreign key(merchant_id,delegate_employee_id) references pg_temp.merchant_enterprise_employees(merchant_id,id) on delete restrict,
 constraint management_delegations_employee_fk foreign key(merchant_id,employee_id) references pg_temp.merchant_enterprise_employees(merchant_id,id) on delete restrict,
 constraint management_delegations_binding_ck check((employee_id is null and employee_auth_user_id is null and employee_generation is null) or (employee_id is not null and employee_auth_user_id is not null and employee_generation is not null and worker_id is not null))
 ) on commit drop;
create temp table merchant_attendance_management_delegation_revocations(
 merchant_id text not null,
 operation_id uuid not null,
 grant_id uuid not null,
 actor_auth_user_id uuid not null,
 reason text not null check(char_length(reason) between 1 and 200),
 command jsonb not null,
 command_fingerprint text not null check(command_fingerprint~'^[0-9a-f]{64}$'),
 recorded_at timestamptz not null check(isfinite(recorded_at)),
 constraint management_revocations_pk primary key(merchant_id,operation_id),
 constraint management_revocations_grant_uq unique(merchant_id,grant_id),
 constraint management_revocations_grant_fk foreign key(merchant_id,grant_id) references pg_temp.merchant_attendance_management_delegations(merchant_id,grant_id) on delete restrict,
 constraint management_revocations_operation_ck check(operation_id<>grant_id)
 ) on commit drop;
create temp table merchant_attendance_management_delegation_operations(
 merchant_id text not null,
 operation_id uuid not null,
 grant_id uuid not null,
 actor_auth_user_id uuid not null,
 delegate_employee_id uuid not null,
 delegate_generation bigint not null check(delegate_generation between 0 and 9007199254740990),
 delegated_action text not null check(delegated_action=any(array['worker_save','group_save','group_assign','group_end','group_cancel','location_save','rule_draft','rule_publish','rule_withdraw','personal_rule_approve','personal_rule_withdraw','operational_rule_draft','operational_rule_publish','operational_rule_withdraw','terminal_prepare','terminal_revoke','pin_issue','pin_revoke','revision_approve','revision_reject','plan_exception_decide','audit_view','audit_export'])),
 business_operation_id uuid not null,
 business_reference_id uuid not null,
 business_revision bigint not null check(business_revision between 1 and 9007199254740990),
 business_fingerprint text not null check(business_fingerprint~'^[0-9a-f]{64}$'),
 command_fingerprint text not null check(command_fingerprint~'^[0-9a-f]{64}$'),
 recorded_at timestamptz not null check(isfinite(recorded_at)),
 constraint management_operations_pk primary key(merchant_id,operation_id),
 constraint management_operations_business_uq unique(merchant_id,delegated_action,business_operation_id),
 constraint management_operations_grant_fk foreign key(merchant_id,grant_id) references pg_temp.merchant_attendance_management_delegations(merchant_id,grant_id) on delete restrict,
 constraint management_operations_employee_fk foreign key(merchant_id,delegate_employee_id) references pg_temp.merchant_enterprise_employees(merchant_id,id) on delete restrict
 ) on commit drop;
create temp table merchant_attendance_delegated_credential_proofs(
 merchant_id text not null,
 operation_id uuid not null,
 command jsonb not null,
 command_fingerprint text not null,
 reference jsonb not null,
 material_commitment text,
 recorded_at timestamptz not null,
 constraint credentials207_proof_pk primary key(merchant_id,operation_id),
 constraint credentials207_proof_operation_fk foreign key(merchant_id,operation_id)
  references pg_temp.merchant_attendance_management_delegation_operations(merchant_id,operation_id) deferrable initially deferred,
 constraint credentials207_command_ck check(jsonb_typeof(command)='object' and octet_length(convert_to(command::text,'UTF8'))<=8192),
 constraint credentials207_hash_ck check(command_fingerprint~'^[0-9a-f]{64}$'),
 constraint credentials207_reference_ck check(jsonb_typeof(reference)='object'),
 constraint credentials207_material_ck check(material_commitment is null or material_commitment~'^[0-9a-f]{64}$'),
 constraint credentials207_material_action_ck check((command->>'action'='pin_issue')=(material_commitment is not null)),
 constraint credentials207_stamp_ck check(isfinite(recorded_at))
 ) on commit drop;
create index merchant_attendance_terminal_created_idx on pg_temp.merchant_attendance_terminals(merchant_id,created_at);
create index attendance_pin_audit_recent_idx on pg_temp.merchant_attendance_pin_audit(merchant_id,worker_id,recorded_at);
create index attendance_independent_lease_subject_idx on pg_temp.merchant_attendance_independent_leases(merchant_id,subject_id,terminal_id);
create index attendance_independent_source_subject_idx on pg_temp.merchant_attendance_independent_event_sources(merchant_id,subject_id,event_id);
create index attendance_management_delegate_idx on pg_temp.merchant_attendance_management_delegations(merchant_id,delegate_employee_id,grant_id);
create index attendance_management_target_idx on pg_temp.merchant_attendance_management_delegations(merchant_id,employee_id,grant_id);
create index attendance_management_action_idx on pg_temp.merchant_attendance_management_delegations(merchant_id,delegated_action,grant_id);
create index attendance_management_operation_actor_idx on pg_temp.merchant_attendance_management_delegation_operations(merchant_id,actor_auth_user_id,operation_id);
create index management_audit_grant_time_idx on pg_temp.merchant_attendance_management_delegations(merchant_id,recorded_at desc,grant_id desc);
create index management_audit_revoke_time_idx on pg_temp.merchant_attendance_management_delegation_revocations(merchant_id,recorded_at desc,operation_id desc);
create temp table merchant_attendance_correction_effects(merchant_id text,request_id uuid,primary key(merchant_id,request_id)) on commit drop;
create temp table merchant_attendance_correction_decisions(merchant_id text,operation_id uuid,primary key(merchant_id,operation_id)) on commit drop;
create temp table merchant_attendance_correction_controls(merchant_id text,revision bigint,primary key(merchant_id,revision)) on commit drop;
create temp table merchant_attendance_revision_requests (
  merchant_id text not null,base_request_id uuid not null,worker_id uuid not null,employee_id uuid not null,
  revision bigint not null check(revision between 1 and 9007199254740989),
  request_id uuid not null,operation_id uuid not null,actor_auth_user_id uuid not null,
  action text not null check(action in ('submit','withdraw')),
  policy_revision bigint not null,base_operation_id uuid not null,
  command jsonb not null check(jsonb_typeof(command)='object' and octet_length(command::text)<=12288),
  recorded_at timestamptz not null check(isfinite(recorded_at)),
  primary key(merchant_id,base_request_id,revision),unique(merchant_id,operation_id),
  foreign key(merchant_id,base_request_id) references pg_temp.merchant_attendance_correction_effects(merchant_id,request_id) on delete restrict,
  foreign key(merchant_id,base_operation_id) references pg_temp.merchant_attendance_correction_decisions(merchant_id,operation_id) on delete restrict,
  foreign key(merchant_id,worker_id) references pg_temp.merchant_attendance_workers(merchant_id,id) on delete restrict,
  foreign key(merchant_id,employee_id) references pg_temp.merchant_enterprise_employees(merchant_id,id) on delete restrict,
  foreign key(merchant_id,policy_revision) references pg_temp.merchant_attendance_correction_controls(merchant_id,revision) on delete restrict,
  check(action<>'submit' or request_id=operation_id)
 ) on commit drop;
create temp table merchant_attendance_effect_versions (
  merchant_id text not null,root_request_id uuid not null,worker_id uuid not null,start_event_id uuid not null,
  revision integer not null check(revision>=2),request_id uuid not null,operation_id uuid not null,previous_operation_id uuid not null,
  actor_auth_user_id uuid not null,request_revision bigint not null check(request_revision between 1 and 9007199254740989),
  evidence_token text not null check(evidence_token~'^[0-9a-f]{32}$'),
  reason text not null check(char_length(reason) between 1 and 500 and reason=btrim(reason) and reason !~ '[[:cntrl:]]'),
  recorded_at timestamptz not null check(isfinite(recorded_at)),policy_revision bigint not null,
  start_at timestamptz not null,end_at timestamptz not null,
  elapsed_us bigint not null,break_us bigint not null,paid_break_us bigint not null,worked_us bigint not null,
  primary key(merchant_id,root_request_id,revision),unique(merchant_id,request_id),unique(merchant_id,operation_id),
  unique(merchant_id,root_request_id,previous_operation_id),
  foreign key(merchant_id,root_request_id) references pg_temp.merchant_attendance_correction_effects(merchant_id,request_id) on delete restrict,
  foreign key(merchant_id,request_id) references pg_temp.merchant_attendance_revision_requests(merchant_id,operation_id) on delete restrict,
  foreign key(merchant_id,worker_id) references pg_temp.merchant_attendance_workers(merchant_id,id) on delete restrict,
  foreign key(start_event_id) references pg_temp.merchant_attendance_events(id) on delete restrict,
  foreign key(merchant_id,policy_revision) references pg_temp.merchant_attendance_correction_controls(merchant_id,revision) on delete restrict,
  check(isfinite(start_at) and isfinite(end_at) and end_at>start_at and end_at<=recorded_at),
  check(elapsed_us between 1 and 2678400000000 and elapsed_us=extract(epoch from(end_at-start_at))*1000000),
  check(break_us>=0 and paid_break_us>=0 and paid_break_us<=break_us and worked_us>=0 and worked_us+break_us=elapsed_us)
 ) on commit drop;
create temp table merchant_attendance_revision_decisions (
  merchant_id text not null,request_id uuid not null,operation_id uuid not null,base_request_id uuid not null,worker_id uuid not null,
  action text not null check(action in ('approve','reject')),actor_auth_user_id uuid not null,
  request_revision bigint not null check(request_revision between 1 and 9007199254740989),
  base_operation_id uuid not null,evidence_token text not null check(evidence_token~'^[0-9a-f]{32}$'),
  reason text not null check(reason=btrim(reason) and char_length(reason) between 1 and 500 and reason !~ '[[:cntrl:]]'),
  command jsonb not null check(jsonb_typeof(command)='object' and octet_length(command::text)<=4096),
  recorded_at timestamptz not null check(isfinite(recorded_at)),
  primary key(merchant_id,request_id),unique(merchant_id,operation_id),
  foreign key(merchant_id,request_id) references pg_temp.merchant_attendance_revision_requests(merchant_id,operation_id) on delete restrict,
  foreign key(merchant_id,base_request_id) references pg_temp.merchant_attendance_correction_effects(merchant_id,request_id) on delete restrict,
  foreign key(merchant_id,worker_id) references pg_temp.merchant_attendance_workers(merchant_id,id) on delete restrict
 ) on commit drop;
alter table pg_temp.merchant_attendance_effect_versions add constraint attendance_effect_version_decision_fk foreign key(merchant_id,operation_id)
 references pg_temp.merchant_attendance_revision_decisions(merchant_id,operation_id) deferrable initially deferred;
create unique index attendance_revision_submit_idx on pg_temp.merchant_attendance_revision_requests(merchant_id,request_id) where action='submit';
create index attendance_revision_request_idx on pg_temp.merchant_attendance_revision_requests(merchant_id,request_id,revision desc);
create index attendance_effect_versions_worker_start_idx on pg_temp.merchant_attendance_effect_versions(merchant_id,worker_id,start_at,start_event_id);
create index attendance_revision_decisions_root_idx on pg_temp.merchant_attendance_revision_decisions(merchant_id,base_request_id);
create index attendance_revision_owner_history_idx on pg_temp.merchant_attendance_revision_requests(merchant_id,recorded_at desc,request_id desc) where action='submit';
create index attendance_revision_root_history_idx on pg_temp.merchant_attendance_revision_requests(merchant_id,base_request_id,recorded_at desc,request_id desc) where action='submit';
create index attendance_revision_self_identity_history_idx
  on pg_temp.merchant_attendance_revision_requests
  (merchant_id,worker_id,employee_id,actor_auth_user_id,recorded_at desc,request_id desc)
  where action='submit';
create index attendance_revision_proposal_period_idx
  on pg_temp.merchant_attendance_revision_requests(merchant_id,worker_id,
    (public.faolla_attendance_instant_v1(command->'proposal'->>'startAt')),
    (public.faolla_attendance_instant_v1(command->'proposal'->>'endAt')),request_id)
  where action='submit';
create temp view revisions208_current_template as
select e.merchant_id,e.worker_id,e.start_event_id,e.request_id root_request_id,e.operation_id root_operation_id,e.recorded_at root_recorded_at,
  e.request_id,e.operation_id,e.revision,null::uuid previous_operation_id,e.policy_revision,e.proposal,e.time_zone,e.start_at,e.end_at,
  e.elapsed_us,e.break_us,e.paid_break_us,e.worked_us,e.recorded_at,r.employee_id,r.basis->'events'->-1->>'id' original_last_event_id
from public.merchant_attendance_correction_effects e join public.merchant_attendance_correction_entries r on r.merchant_id=e.merchant_id and r.operation_id=e.request_id and r.action='submit'
where not exists(select 1 from public.merchant_attendance_effect_versions n where n.merchant_id=e.merchant_id and n.root_request_id=e.request_id)
union all
select n.merchant_id,n.worker_id,n.start_event_id,n.root_request_id,e.operation_id,e.recorded_at,n.request_id,n.operation_id,n.revision,n.previous_operation_id,n.policy_revision,
  r.command->'proposal',e.time_zone,n.start_at,n.end_at,n.elapsed_us,n.break_us,n.paid_break_us,n.worked_us,n.recorded_at,r.employee_id,o.basis->'events'->-1->>'id'
from public.merchant_attendance_effect_versions n
join public.merchant_attendance_correction_effects e on e.merchant_id=n.merchant_id and e.request_id=n.root_request_id
join public.merchant_attendance_revision_requests r on r.merchant_id=n.merchant_id and r.operation_id=n.request_id and r.action='submit'
join public.merchant_attendance_correction_entries o on o.merchant_id=e.merchant_id and o.operation_id=e.request_id and o.action='submit'
where not exists(select 1 from public.merchant_attendance_effect_versions newer where newer.merchant_id=n.merchant_id and newer.root_request_id=n.root_request_id and newer.revision>n.revision);
create temp table merchant_attendance_schedule_commands (
  merchant_id text not null references pg_temp.merchant_attendance_settings(merchant_id) on delete restrict,
  revision bigint not null check(revision between 1 and 9007199254740989),
  operation_id uuid not null, actor_auth_user_id uuid not null,
  query jsonb not null, command jsonb not null, recorded_at timestamptz not null default clock_timestamp(),
  primary key(merchant_id,revision), unique(merchant_id,operation_id)
 ) on commit drop;
create temp table merchant_attendance_schedule_slots (
  merchant_id text not null, id uuid not null default gen_random_uuid(), revision bigint not null,
  worker_id uuid not null, employee_id uuid not null, worker_name text not null, location_id uuid not null, location_name text not null,
  time_zone text not null check(public.faolla_attendance_valid_zone_v1(time_zone)), work_date date not null,
  start_at timestamptz not null, end_at timestamptz not null,
  primary key(merchant_id,id),
  foreign key(merchant_id,revision) references pg_temp.merchant_attendance_schedule_commands(merchant_id,revision),
  foreign key(merchant_id,worker_id) references pg_temp.merchant_attendance_workers(merchant_id,id),
  foreign key(merchant_id,employee_id) references pg_temp.merchant_enterprise_employees(merchant_id,id),
  foreign key(merchant_id,location_id) references pg_temp.merchant_attendance_locations(merchant_id,id),
  check(isfinite(start_at) and isfinite(end_at) and end_at>start_at and end_at-start_at<=interval '24 hours'),
  check(work_date between date '2000-01-01' and date '2100-12-31')
 ) on commit drop;
create temp table merchant_attendance_schedule_cancellations (
  merchant_id text not null, slot_id uuid not null, revision bigint not null,
  primary key(merchant_id,slot_id),
  foreign key(merchant_id,slot_id) references pg_temp.merchant_attendance_schedule_slots(merchant_id,id),
  foreign key(merchant_id,revision) references pg_temp.merchant_attendance_schedule_commands(merchant_id,revision)
 ) on commit drop;
create temp table merchant_attendance_schedule_publication_evidence (
  merchant_id text not null check(merchant_id ~ E'^\\d{8}$'),revision bigint not null check(revision between 1 and 9007199254740990),
  operation_id uuid not null,actor_auth_user_id uuid not null,worker_id uuid not null,employee_id uuid not null,employee_auth_user_id uuid null,
  identity_status text not null check(identity_status in('bound','unbound')),
  worker_version bigint not null check(worker_version between 1 and 9007199254740991),
  location_id uuid not null,location_version bigint not null check(location_version between 1 and 9007199254740991),
  settings_version bigint not null check(settings_version between 1 and 9007199254740991),
  time_zone text not null check(char_length(time_zone) between 1 and 100 and time_zone=btrim(time_zone) and time_zone !~ '[[:cntrl:]]'),
  slots jsonb not null check(public.faolla_attendance_schedule_publication_slots_v1(slots)),
  published_at timestamptz not null check(isfinite(published_at)),recorded_at timestamptz not null check(isfinite(recorded_at)),
  capture_policy text not null check(capture_policy='publish-identity-context-v1'),
  primary key(merchant_id,revision),unique(merchant_id,operation_id),
  foreign key(merchant_id,revision) references pg_temp.merchant_attendance_schedule_commands(merchant_id,revision),
  foreign key(merchant_id,operation_id) references pg_temp.merchant_attendance_schedule_commands(merchant_id,operation_id),
  check((employee_auth_user_id is null and identity_status='unbound') or (employee_auth_user_id is not null and identity_status='bound'))
 ) on commit drop;
create temp table merchant_attendance_plan_exception_cases(
  merchant_id text not null check(merchant_id~'^[0-9]{8}$'),case_id uuid not null,worker_id uuid not null,slot_id uuid not null,
  employee_id uuid not null,employee_auth_user_id uuid not null,worker_name text not null,worker_no text not null,
  slot_start_at timestamptz not null,slot_end_at timestamptz not null,time_zone text not null,opened_at timestamptz not null,
  primary key(merchant_id,case_id),unique(merchant_id,slot_id),
  unique(merchant_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id),
  check(public.faolla_attendance_group_text_v1(worker_name,1,120) and public.faolla_attendance_group_text_v1(worker_no,1,40)
    and public.faolla_attendance_group_text_v1(time_zone,1,100)),
  check(isfinite(slot_start_at) and isfinite(slot_end_at) and slot_end_at>slot_start_at and isfinite(opened_at))
 ) on commit drop;
create temp table merchant_attendance_plan_exception_entries(
  merchant_id text not null,operation_id uuid not null,case_id uuid not null,worker_id uuid not null,slot_id uuid not null,
  employee_id uuid not null,employee_auth_user_id uuid not null,revision bigint not null check(revision between 1 and 9007199254740990),
  actor_auth_user_id uuid not null,kind text not null,command jsonb not null,evidence jsonb null,recorded_at timestamptz not null,
  primary key(merchant_id,operation_id),unique(merchant_id,case_id,revision),
  foreign key(merchant_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id)
    references pg_temp.merchant_attendance_plan_exception_cases(merchant_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id),
  check(kind in('decision','note') and public.faolla_attendance_plan_exception_review_command_v1(case kind when 'decision' then 'decide' else 'note' end,command) is true),
  check(command->>'operationId'=operation_id::text and (command->>'expectedRevision')::bigint=revision-1 and isfinite(recorded_at)),
  check((kind='decision' and evidence is not null and public.faolla_attendance_plan_exception_review_evidence_v1(evidence) is true
      and command->>'employeeId'=employee_id::text and command->>'employeeAuthUserId'=employee_auth_user_id::text
      and command->>'expectedFingerprint'=evidence->>'fingerprint' and (evidence->>'observedAt')::timestamptz<=recorded_at)
    or (kind='note' and evidence is null and actor_auth_user_id=employee_auth_user_id))
 ) on commit drop;
create temp table merchant_attendance_plan_exception_reads(
  merchant_id text not null,operation_id uuid not null,case_id uuid not null,worker_id uuid not null,slot_id uuid not null,
  employee_id uuid not null,employee_auth_user_id uuid not null,decision_operation_id uuid not null,command jsonb not null,read_at timestamptz not null,
  primary key(merchant_id,operation_id),unique(merchant_id,decision_operation_id),
  foreign key(merchant_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id)
    references pg_temp.merchant_attendance_plan_exception_cases(merchant_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id),
  foreign key(merchant_id,decision_operation_id) references pg_temp.merchant_attendance_plan_exception_entries(merchant_id,operation_id),
  check(public.faolla_attendance_plan_exception_review_command_v1('ack',command) is true
    and command->>'operationId'=operation_id::text and command->>'decisionOperationId'=decision_operation_id::text and isfinite(read_at))
 ) on commit drop;
alter table pg_temp.merchant_attendance_plan_exception_cases add constraint attendance_plan_exception_first_entry_fk foreign key(merchant_id,case_id)
 references pg_temp.merchant_attendance_plan_exception_entries(merchant_id,operation_id) deferrable initially deferred;
create index attendance_schedule_worker_date_idx on pg_temp.merchant_attendance_schedule_slots(merchant_id,worker_id,work_date,start_at,id);
create index attendance_schedule_worker_time_idx on pg_temp.merchant_attendance_schedule_slots(merchant_id,worker_id,start_at,end_at);
create index attendance_schedule_publication_idx
  on pg_temp.merchant_attendance_schedule_slots(merchant_id,revision,id);
create index attendance_plan_exception_owner_list_idx on pg_temp.merchant_attendance_plan_exception_cases(merchant_id,opened_at desc,case_id desc);
create index attendance_plan_exception_worker_list_idx on pg_temp.merchant_attendance_plan_exception_cases(merchant_id,worker_id,opened_at desc,case_id desc);
create index attendance_plan_exception_self_list_idx on pg_temp.merchant_attendance_plan_exception_cases(merchant_id,worker_id,employee_id,employee_auth_user_id,opened_at desc,case_id desc);
create index attendance_plan_exception_latest_decision_idx on pg_temp.merchant_attendance_plan_exception_entries(merchant_id,case_id,revision desc) where kind='decision';
 create temp table exceptions209_forward_metadata on commit drop as select proc.oid,to_jsonb(proc)-array['prosrc','proargdefaults'] metadata,pg_get_expr(proc.proargdefaults,0) default_expression from pg_proc proc where proc.oid in('public.faolla_attendance_plan_exception_clearance_execute_v1(jsonb,uuid,jsonb,boolean,boolean,boolean)'::regprocedure,'public.faolla_attendance_plan_exception_posthoc_execute_v1(jsonb,uuid,jsonb,boolean,boolean,boolean,boolean)'::regprocedure,'public.faolla_attendance_management_insert_v1()'::regprocedure);
 do $exceptions209_preflight$ declare ns text;expected_owner oid;installed boolean;has190 boolean;spec jsonb;forward_spec jsonb;own_spec jsonb;f regprocedure;meta record;actual_table regclass;expected_table regclass;foreign_table regclass;table_name text;constraint_spec record;actual_constraint record;index_spec record;actual_index record;trigger_spec jsonb;reference_keys smallint[]; begin select namespace.nspname,catalog_table.relowner into ns,expected_owner from pg_class catalog_table join pg_namespace namespace on namespace.oid=catalog_table.relnamespace where catalog_table.oid='public.merchant_attendance_settings'::regclass;
 if expected_owner is distinct from (select oid from pg_roles where rolname=current_user) then raise exception 'merchant_attendance_delegated_plan_exceptions_owner_conflict';end if;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610090209 and name='merchant_attendance_delegated_plan_exceptions');
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');own_spec:=$exceptions209_dependencies$[{"name":"faolla_attendance_events_append_only_v1","signature":"public.faolla_attendance_events_append_only_v1()","hash":"66b7826feb67a63b33b563d77176ef0ef81b49479657efbd80fbcefcb5512b0a","result":"trigger","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_effect_version_guard_v1","signature":"public.faolla_attendance_effect_version_guard_v1()","hash":"60429c8e854930b86950094ae031fe7cb19b7d4fa5475d3265d057ae912c4b2b","result":"trigger","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_correction_proposal_v1","signature":"public.faolla_attendance_correction_proposal_v1(jsonb,timestamptz)","hash":"d389ec334e368ecb2afcf44ad1a37ff39af028536fff6b30a64d72ca3ad3da9d","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_value","p_now"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_instant_v1","signature":"public.faolla_attendance_instant_v1(text)","hash":"feba243fa6d87442defe285e3c9e4789bae5671c18d09cecb7c65dae6dffe5a5","result":"timestamptz","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_value"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_revision_decision_link_v1","signature":"public.faolla_attendance_revision_decision_link_v1()","hash":"070bf93b624e2925d7b9adae3135b0bbb5aa01938d12586fff16a7fed5e46fc0","result":"trigger","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_missing_effect_guard_v1","signature":"public.faolla_attendance_missing_effect_guard_v1()","hash":"9d89cd60d473f4544f30c1a18ec7f35ffbc7f9963040cc618d65344cc190d4c3","result":"trigger","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_period_seal_insert_guard_v1","signature":"public.faolla_attendance_period_seal_insert_guard_v1()","hash":"81783ba090db4eb3f8c206a9dd6e723c4cd4fca0c581f13062ee4e3f4f2d96f5","result":"trigger","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_period_assert_open_v1","signature":"public.faolla_attendance_period_assert_open_v1(text,uuid,jsonb)","hash":"f92f8fa8ea1a70f48bf72e8b856e564e3eacabec024810146c590224fb3fc965","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_spans"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_review_routing_capture_v1","signature":"public.faolla_attendance_review_routing_capture_v1()","hash":"58342d0420d4a28f4756b3876ba0ac67be750ec379c5a4429615fa967fc63dc3","result":"trigger","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_consumer_item_v1","signature":"public.faolla_attendance_operational_consumer_item_v1(public.merchant_attendance_operational_consumer_activations)","hash":"018cf97af523313e0759e0cc378d80ba1d8bf98b0501ecbaab322b5819afc5a4","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_hash_v1","signature":"public.faolla_attendance_operational_rule_hash_v1(jsonb)","hash":"fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_consumer_command_v1","signature":"public.faolla_attendance_operational_consumer_command_v1(text,text,uuid,jsonb)","hash":"f22ef2fbe33e4214733482e36d121ded8cb9db2f48c3f84fef42faf70de641c7","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_consumer","p_actor","p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_object_v1","signature":"public.faolla_attendance_operational_rule_object_v1(jsonb,text[])","hash":"c2424b9408e816d4f5aee7b271d4e91ea6faf10c7643a940223a1d3896e56ca7","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","ks"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_application_window_scalar_v1","signature":"public.faolla_attendance_application_window_scalar_v1(jsonb,text)","hash":"fa75ce0a10f746cece393962aca52ffcdb191887d4ea6ed06a40b3867ef717db","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","k"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_scalar_v1","signature":"public.faolla_attendance_operational_rule_scalar_v1(jsonb,text)","hash":"99d575e267fe9ec7b8f56dbe92ac412405913695ae3a3085dc1a035c33614fce","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","k"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_text_v1","signature":"public.faolla_attendance_group_text_v1(text,integer,integer)","hash":"b440810c3afb56de19592e1492e16b12cf6faf800ac2f9d0a8e7bdeca2ecc562","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","lo","hi"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_punch_stamp_v1","signature":"public.faolla_attendance_operational_punch_stamp_v1(timestamptz)","hash":"6d0b940b342a28ef5abe117ceb132f80180680cf1a7ac65af88be475f7f879a2","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_review_routing_fact_v1","signature":"public.faolla_attendance_review_routing_fact_v1(text,text,uuid,boolean)","hash":"4de217d5343138427dc0af875cdccff5cf1ca844f087562af61298fcaf00a8f7","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_family","p_request","p_complete"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_correction_summary_v1","signature":"public.faolla_attendance_correction_summary_v1(public.merchant_attendance_correction_entries,public.merchant_attendance_correction_entries)","hash":"4aa9ea02f21c5dde7477666c3b68baffbd2ea49fb84279be4b5a55a4b39660b2","result":"jsonb","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_first","p_last"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_missing_summary_v1","signature":"public.faolla_attendance_missing_summary_v1(public.merchant_attendance_missing_requests)","hash":"b0e0bd86ca4583b4056d81043185d1727c5be85662dc97310e258ed684caad05","result":"jsonb","language":"sql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_leave_summary_v1","signature":"public.faolla_attendance_leave_summary_v1(public.merchant_attendance_leave_requests,integer)","hash":"5df82b03753c90636b8fd9fce15384560490c4f5996fafe1df76ec9e75b09fa6","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":1,"defaultExpression":"NULL::integer","args":["p","p_revision"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_work_arrangement_summary_v1","signature":"public.faolla_attendance_work_arrangement_summary_v1(public.merchant_attendance_work_arrangement_requests,integer)","hash":"a27f471975013268910a5523bf6e7998ce90f2901d25a234663e653ecc8222e5","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":1,"defaultExpression":"NULL::integer","args":["p","p_revision"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_work_arrangement_policy_v1","signature":"public.faolla_attendance_work_arrangement_policy_v1(public.merchant_attendance_work_arrangement_policies)","hash":"8698714418afefbb400b7fa588ef3cd01588a92ff5aabd9048df6688eec94039","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_work_arrangement_command_v1","signature":"public.faolla_attendance_work_arrangement_command_v1(jsonb)","hash":"d64d2d822ae5a0c9f86adf467cbea19aa515d52ca5ad04856866229ccfdc73c6","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_shift_rule_binding_scalar_v1","signature":"public.faolla_attendance_shift_rule_binding_scalar_v1(jsonb,text)","hash":"3d17c1dc4359ef24d5da51b926bc586f857d0b67b6cffda92869015accf3f7f0","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","kind"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_shift_rule_binding_object_v1","signature":"public.faolla_attendance_shift_rule_binding_object_v1(jsonb,text[])","hash":"2a634d258ceab747cb0098c516aa423babe8d7f0203ce9fb24725bc9602ded50","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","keys"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_review_routing_tuple_v1","signature":"public.faolla_attendance_review_routing_tuple_v1(jsonb,text)","hash":"afcd6520c775813bf11d0406e3f62b3cbf08445e1025be6761fc75d522b0d880","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_kind"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_source_stamp_v1","signature":"public.faolla_attendance_operational_source_stamp_v1(text)","hash":"4c2243afe68dfe18fd9de9954ff48803c7b256cd64a7d0e25cb04ff540620265","result":"timestamptz","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_source_v1","signature":"public.faolla_attendance_operational_source_v1(text,uuid,uuid,uuid,timestamptz)","hash":"9a547b0446c317483eb27a3d604011ec671218cda50ff2cf544c002af825cbee","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_employee","p_employee_auth","p_at"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_assignment_detail_v1","signature":"public.faolla_attendance_group_assignment_detail_v1(public.merchant_attendance_group_assignments)","hash":"aa65e21fdec5f8854145dfa71ee3d3e3e4eff34bca59a4cda18bf52fb6af0a82","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_command_v1","signature":"public.faolla_attendance_group_command_v1(jsonb)","hash":"579d7fa2487e8220179294ba36500b39e1a7e828024e8377ad69578da13d61c5","result":"boolean","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_valid_zone_v1","signature":"public.faolla_attendance_valid_zone_v1(text)","hash":"3681c82259aaf0653bbddf12e3904144a53030f6213b0e96cdf6f8d40702657d","result":"boolean","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_zone"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_date_v1","signature":"public.faolla_attendance_group_date_v1(text,text)","hash":"78b42d44e8e4a547db264ec59f7866627284a959b82f0c46f0d646fba5931c8b","result":"boolean","language":"plpgsql","volatility":"s","definer":false,"defaults":1,"defaultExpression":"NULL::text","args":["p","z"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_assignment_item_v1","signature":"public.faolla_attendance_group_assignment_item_v1(public.merchant_attendance_group_assignments)","hash":"475397dc4b3caf6ce0aab4058456d877e456b3744c3703f810cb80750fe67d82","result":"jsonb","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_rule_day_start_v1","signature":"public.faolla_attendance_rule_day_start_v1(text,text)","hash":"5aa3bbe223feed69419c53e22f1d77783b45f8bcae461c3d7d20d340a01faaf1","result":"timestamptz","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p","z"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_personal_rule_end_v1","signature":"public.faolla_attendance_personal_rule_end_v1(text,text)","hash":"db3c640e28878a9ac45f16e0af49df6bd0549169f7af6f5b317159d553f8bd25","result":"timestamptz","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p","z"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_checked_v1","signature":"public.faolla_attendance_group_checked_v1(public.merchant_attendance_groups)","hash":"045838f03a886a8d133419c37148a0c747b58d2a6c6ebe0c8aa85d4d53edd392","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_receipt_v1","signature":"public.faolla_attendance_group_receipt_v1(public.merchant_attendance_group_operations,public.merchant_attendance_groups)","hash":"0e0897b6905d35b557c49667d1b039f7601e939bceef00d521206d760239ce4a","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p","g"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_item_v1","signature":"public.faolla_attendance_group_item_v1(public.merchant_attendance_groups)","hash":"19231ed0c7b2ecf95e91a27dc92caaefcf6aa3b81b908b54b216574c882c6acf","result":"jsonb","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_source_layer_v1","signature":"public.faolla_attendance_operational_source_layer_v1(text,jsonb,timestamptz)","hash":"26cf463e0e5da24c8783c4f085ca8076984243bb787033782cba4a281d58fc40","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_scope","p_at"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_scope_v1","signature":"public.faolla_attendance_operational_rule_scope_v1(jsonb)","hash":"9e323d5672d38255e4f92bc2b0d5f0dd4e6190cbe04b7773bc80e40618f57275","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_check_v1","signature":"public.faolla_attendance_operational_rule_check_v1(text,text,bigint)","hash":"25809b0d345f18bc1558029cf1a1063285744d7b89d76b3e34462231542d7fc8","result":"void","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_key","p_revision"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_item_v1","signature":"public.faolla_attendance_operational_rule_item_v1(public.merchant_attendance_operational_rule_operations)","hash":"6fbb4c8e283366e526e208fae0b53dc41110161bdfd99e0af196a050c2448396","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_command_v1","signature":"public.faolla_attendance_operational_rule_command_v1(jsonb)","hash":"ba2f97fd74fac4343a513b6edf5c9faa34f44c89108908e7e411759b4fa6b5f1","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_context_tuple_v1","signature":"public.faolla_attendance_operational_rule_context_tuple_v1(jsonb,jsonb)","hash":"e0bc60a2402351503edb4ea94cd1791b95644c3f098af0aaefeac253c8264179","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p","s"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_values_v1","signature":"public.faolla_attendance_operational_rule_values_v1(jsonb)","hash":"ff59e8fceee61f8a60694614de50200e48f3e51ffb3d355e73d8f18f22af012b","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_references_tuple_v1","signature":"public.faolla_attendance_operational_rule_references_tuple_v1(jsonb,jsonb,jsonb)","hash":"642dd54d586411b6ac0aa435ad0ad53630eb2a5ed7a74d0559248bf942795a26","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p","s","r"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_source_baseline_v1","signature":"public.faolla_attendance_operational_source_baseline_v1(text,timestamptz,bigint)","hash":"6770099ab00f8827425c14773a8823509350c2745d742a998aff0dc7015019bf","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_at","p_settings_version"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_source_tuple_v1","signature":"public.faolla_attendance_operational_source_tuple_v1(jsonb)","hash":"df3dcf85c4372135967e37153987cc308524026a72d63238043263745bb6a61a","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_review_routing_origin_v1","signature":"public.faolla_attendance_review_routing_origin_v1(jsonb,text,bigint)","hash":"fa9cb981676d6e4f0eed10a73c99b200193c3d4aeb95a0f02502c18933ac7df5","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_source","p_family","p_activation"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_review_routing_choose_v1","signature":"public.faolla_attendance_review_routing_choose_v1(text,text,uuid,jsonb,uuid,timestamptz)","hash":"b60959dc2a537c238c0deedc03a3f240a10a441fab54261afcd9a1cec9eb144d","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_family","p_request","p_origin","p_owner","p_at"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_review_routing_candidates_v1","signature":"public.faolla_attendance_review_routing_candidates_v1(text,jsonb,jsonb,jsonb)","hash":"b6fdd5d441375fedea4328fd289b323d218a5e2b7c860061989552fec08640b8","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_ref","p_delegate","p_cursor"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_review_routing_qualify_v1","signature":"public.faolla_attendance_review_routing_qualify_v1(text,text,uuid,uuid,timestamptz)","hash":"7a867d0c19f5b7dedae30db3f1e9007ad7792702949c333c919e22ac7c7bdff9","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_family","p_request","p_grant","p_at"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_review_routing_grant_v1","signature":"public.faolla_attendance_review_routing_grant_v1(text,text,uuid)","hash":"8de810b68e5a3c994ed78b2e684d40e28967c5ec9f9381a92c64fcf42e233b9c","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_family","p_grant"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_correction_delegation_hash_v1","signature":"public.faolla_attendance_correction_delegation_hash_v1(text,text,jsonb)","hash":"5ab9296fcbf5d0fd65d680b4de9885d0eb2d06c0266bffe425875b9ff10ca62c","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_access","p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_correction_delegation_command_v1","signature":"public.faolla_attendance_correction_delegation_command_v1(jsonb,text)","hash":"555e4a58cfff0d2901d52fe94e411bad67debd2ec8c53b09c5e81ec0308557b7","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_access"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_missing_delegation_hash_v1","signature":"public.faolla_attendance_missing_delegation_hash_v1(text,text,jsonb)","hash":"2d1805657c298a6190ea36d2aa5dc1b35a393db31e305d1ed919eba02441bbcc","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_access","p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_missing_delegation_command_v1","signature":"public.faolla_attendance_missing_delegation_command_v1(jsonb,text)","hash":"7057ec66fa89364c341466660885d7bcf5b5d7abc931b089c5398fdc4021def9","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_access"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_application_delegation_hash_v1","signature":"public.faolla_attendance_application_delegation_hash_v1(text,text,jsonb)","hash":"2d54478110b1df6ea4d37a71899337dd283dc8a3bc63d97fad38db77ec952d09","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_access","p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_application_delegation_command_v1","signature":"public.faolla_attendance_application_delegation_command_v1(jsonb,text)","hash":"39f7db3343e77ee3499b4f7de4583286c109a49f36cdc32387a124586c4164fa","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_access"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_correction_delegation_usable_v1","signature":"public.faolla_attendance_correction_delegation_usable_v1(public.merchant_attendance_correction_delegations,timestamptz)","hash":"95427a0e2ee14be6aac45137a5cc154da56953bb4a7005027822376800fc0f2d","result":"boolean","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_at"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_correction_delegation_scope_v1","signature":"public.faolla_attendance_correction_delegation_scope_v1(jsonb,uuid)","hash":"0349465cb5460fa9cc15e5a12d1936683f52f9d5aef4a8ab976a8f4ca8e215fb","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_basis","p_location"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_correction_owner_basis_v1","signature":"public.faolla_attendance_correction_owner_basis_v1(text,uuid,uuid,uuid,timestamptz)","hash":"2523fe8ecf015e11b1b334bd1d9938b1b956bdeb47557c42e5b299c7eb1dae6e","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_employee","p_start","p_now"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_review_event_v1","signature":"public.faolla_attendance_review_event_v1(public.merchant_attendance_events)","hash":"050efeaa5104ad4f48d9cbe4e8087f9e59bb9cecd5022a9218f82cf9ff1c14c3","result":"jsonb","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_correction_delegation_original_v1","signature":"public.faolla_attendance_correction_delegation_original_v1(jsonb,timestamptz)","hash":"58ad93e2073338a63b5b1edc6deb0837b64949708cee9fff8d47b0e98c2df4b0","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_basis","p_now"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_missing_delegation_usable_v1","signature":"public.faolla_attendance_missing_delegation_usable_v1(public.merchant_attendance_missing_delegations,timestamptz)","hash":"a6511db89e8639edb4f445e42efc345930bce5f08a67ba0ecfba23feee6e99a2","result":"boolean","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_at"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_missing_delegation_usable_pre164","signature":"public.faolla_attendance_missing_delegation_usable_pre164(public.merchant_attendance_missing_delegations,timestamptz)","hash":"68e6c074e4916a35ea9f21b006c67ae3ad28365a885b4b44c75965f2240602c2","result":"boolean","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_at"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_account_grant_current_v1","signature":"public.faolla_attendance_account_grant_current_v1(text,text,uuid,uuid,uuid,uuid,uuid)","hash":"882d5dc7f35d43fb131c536b79b6daf367bdc48bfe5a0550182b4f38d73ba428","result":"boolean","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_channel","p_grant","p_delegate","p_delegate_auth","p_employee","p_auth"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_application_delegation_usable_v1","signature":"public.faolla_attendance_application_delegation_usable_v1(public.merchant_attendance_application_delegations,timestamptz)","hash":"11c1b220fa18dc1b55caf3378b248aa8ccd9914bc44cf4ed132baded58d84dda","result":"boolean","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_at"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_application_delegation_usable_pre164","signature":"public.faolla_attendance_application_delegation_usable_pre164(public.merchant_attendance_application_delegations,timestamptz)","hash":"ccb548d959cd1fa3d44adb41a335e000af899f1a6b62ff52e42249d45d446516","result":"boolean","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_at"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_review_routing_make_v1","signature":"public.faolla_attendance_review_routing_make_v1(text,jsonb,uuid,bigint,text,uuid,timestamptz,text,uuid,jsonb,jsonb,text)","hash":"c8c2cf0b9863ba02d74d2a57d80ecc1c799855ef9267e60fbd8cfa6862018763","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_ref","p_op","p_revision","p_action","p_actor","p_at","p_reason","p_previous","p_origin","p_assignment","p_fingerprint"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_punch_source_ref_v1","signature":"public.faolla_attendance_operational_punch_source_ref_v1(jsonb)","hash":"31e3cf7da541768bfe88b06b896720cf6d32cb47a8550f2375bc4fc8716c62e7","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_punch_hash_v1","signature":"public.faolla_attendance_operational_punch_hash_v1(jsonb)","hash":"fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_schedule_publication_guard_v1","signature":"public.faolla_attendance_schedule_publication_guard_v1()","hash":"f033808d30f1e3225db7f9efdc52b4e93077f198c491f0efe5646c42fff6258e","result":"trigger","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_schedule_delegation_proof_v1","signature":"public.faolla_attendance_schedule_delegation_proof_v1(public.merchant_attendance_schedule_commands)","hash":"6b93ed55f3b5b52a5656f83e67409528d70251c5eb23c5b12d5732eeff44cbaf","result":"boolean","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_schedule_delegation_command_v1","signature":"public.faolla_attendance_schedule_delegation_command_v1(jsonb,text)","hash":"f6bcfa143bf6e2229e3ab1ec8d3c05fca2ed8f71e06653133ca15787f24b70ff","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_access"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_schedule_delegation_hash_v1","signature":"public.faolla_attendance_schedule_delegation_hash_v1(jsonb,jsonb)","hash":"c9f06f82fe3c5331d607c13bebc1da670d086da1350519b82eee4a72e1851693","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_account_capture_v1","signature":"public.faolla_attendance_account_capture_v1(text,uuid,uuid,uuid,boolean)","hash":"c5ba771116846124af37e113086395bad0787b8daaf6f9e5283273cf82337907","result":"uuid","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_employee","p_actor","p_actor_employee","p_enabled"],"searchPath":"search_path=pg_catalog","isRpc":false,"changes":[{"from":"and not exists(select 1 from public.merchant_attendance_correction_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee)) then return null;end if;","to":"and not exists(select 1 from public.merchant_attendance_correction_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee))\n    and not exists(select 1 from public.merchant_attendance_management_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee)) then return null;end if;","count":2}]},{"name":"faolla_attendance_plan_exception_review_command_v1","signature":"public.faolla_attendance_plan_exception_review_command_v1(text,jsonb)","hash":"cf2c6ccdbec1748c94a25349045fd1f12db5ab705b7ea53c19566fceaac4dd2c","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["mode_name","p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_hash_v1","signature":"public.faolla_attendance_management_hash_v1(text,uuid,jsonb)","hash":"0251284215e3c71ba9420c3b7be5cc496699aa5a5cad4a6189da6b9a8361dd84","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_command_v1","signature":"public.faolla_attendance_management_command_v1(jsonb)","hash":"4bfb75e4776588b774e58e64018394a95fb8c802776c3df433dc0259de3a0fd3","result":"void","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scalar_v1","signature":"public.faolla_attendance_management_scalar_v1(jsonb,text)","hash":"1f1afb8930a212c34937f2cfe8b843e9991d9827440c7589afb93a4f2e62ac06","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","k"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scope_v1","signature":"public.faolla_attendance_management_scope_v1(jsonb,text)","hash":"715c2692e308c9562a54fab06f3ab4f0c888378837e6ffdf40e9531ad40ea16c","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","a"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_capability_v1","signature":"public.faolla_attendance_management_capability_v1(text)","hash":"8442e9811c7795f37e06e22fc84cca3d773cb084b19fc3c9528d3f642b97b990","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_array_v1","signature":"public.faolla_attendance_management_array_v1(jsonb,text[],integer,integer)","hash":"01b5e60f56433b2ec408d82c25bc9aec85187175e52482e33a15162d01cacebf","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","allowed","minimum","maximum"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_binding_v1","signature":"public.faolla_attendance_management_binding_v1(jsonb)","hash":"434f3279e8bd6c90d559db026bdeca2d6092749586bb6271146c23ab826358b0","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_current_v1","signature":"public.faolla_attendance_management_current_v1(public.merchant_attendance_management_delegations,timestamptz)","hash":"2148814cd6c45a36a584c6293e8abc8d7db61cdd62d55e06ceadcb0e757b7aa7","result":"boolean","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g","at_time"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scope_context_v1","signature":"public.faolla_attendance_management_scope_context_v1(text,jsonb,text)","hash":"dc5dbf304f62b90e211566ab9ca39a6dbace37341cf06e829f8c478dc681fa8f","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","p","a"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_schedule_publication_slots_v1","signature":"public.faolla_attendance_schedule_publication_slots_v1(jsonb)","hash":"d3ce30323a215892daa9ec20c84a914af9fc5be66b032734dd892bd79a73f5ae","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_exception_source_v1","signature":"public.faolla_attendance_plan_exception_source_v1(jsonb,uuid)","hash":"1234394b481e1e3063d6a12d83bf606e11be1cb8d64b4b86ea194091eb5334b1","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_plan_exception_source_legacy_v1","signature":"public.faolla_attendance_plan_exception_source_legacy_v1(jsonb,uuid)","hash":"89309840b875cf0d530abc9e80fa8c0bcd93a34c64f23053c446a16eeea1bc8c","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_coverage_adoptions_v1","signature":"public.faolla_attendance_plan_coverage_adoptions_v1(jsonb,uuid)","hash":"bd1383469e3692438b3af55a504ef8348f9ef6cdd1e4134e705e0a4c9c227a0f","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_plan_coverage_v1","signature":"public.faolla_attendance_plan_coverage_v1(jsonb,uuid)","hash":"21917f1580f1b831e38064ce9bb003bf146a133858693e6b7a858b516d5f5c73","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_self_schedule_slot_v1","signature":"public.faolla_attendance_self_schedule_slot_v1(public.merchant_attendance_schedule_slots)","hash":"3ea9205bf464f28cde58da98db82c863584e5287c529e3c5a26ae272fb6c374d","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_shift_check_v1","signature":"public.faolla_attendance_shift_check_v1(jsonb,uuid)","hash":"e08de457e5288513a0b53b8ed705fa4fe4369b0f5d81757c64dd93e935070956","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_shift_rule_binding_v1","signature":"public.faolla_attendance_shift_rule_binding_v1(jsonb,uuid)","hash":"e13c2a8d9265985dae141a96fa56d733f77ac2a007b830f07cb3d0be1bfd1437","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_shift_rule_source_valid_v1","signature":"public.faolla_attendance_shift_rule_source_valid_v1(text,text,uuid,text,integer)","hash":"29e3013c06a8c16b9b4ffd304c2ddd6bc5e31d9912d0d1894c922a3abe742cc0","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_text","p_site","p_worker","p_hash","p_bytes"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_shift_rule_fields_v1","signature":"public.faolla_attendance_shift_rule_fields_v1(jsonb)","hash":"d2a7b26a2ab624b8a2e6641b0dc640fff0b7b7f0cedcdec89429223ec95308c3","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_rule_values_v1","signature":"public.faolla_attendance_rule_values_v1(jsonb)","hash":"28d5094d4449869591c121c3780626220a7be7606cd02800b5d233378f8fb26b","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_shift_rule_binding_graph_v1","signature":"public.faolla_attendance_shift_rule_binding_graph_v1(jsonb,timestamptz)","hash":"25936764bb7f717efa27361320a41dac69511f295293a401ab548eba4f903546","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","point_at"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_administrative_boundary_v1","signature":"public.faolla_attendance_administrative_boundary_v1(text,uuid,uuid)","hash":"30f4e7c06f9fd44bd90e321ae8f7f7ec44638ba50e6092ae27cc967dfce196bb","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_start"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_administrative_entry_v1","signature":"public.faolla_attendance_administrative_entry_v1(public.merchant_attendance_administrative_closure_entries)","hash":"d663c9351beed34d63eee7ff75c19abb49e66e4cbc3ce1246fa3d17764ec4203","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_administrative_receipt_v1","signature":"public.faolla_attendance_administrative_receipt_v1(public.merchant_attendance_administrative_closure_entries)","hash":"cb0e6311ed78b29398f5f1bb52f6168258e21e22e802d79d21cbf3bf7afdbcc3","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_administrative_hash_v1","signature":"public.faolla_attendance_administrative_hash_v1(text,uuid,text,jsonb)","hash":"40d352beb1e5896edb8f428d143ae689a6ca7c90036bf5c8372cae0beac00419","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_actor","p_access","p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_administrative_scalar_v1","signature":"public.faolla_attendance_administrative_scalar_v1(jsonb,text)","hash":"814c0a864d7b7383eaf12f06c374ca8440be70c5b1edb5781e665130217ad295","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","k"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_administrative_command_v1","signature":"public.faolla_attendance_administrative_command_v1(jsonb)","hash":"c5ee520a78337d3fb2571743fd4ebf0e56c7abc9e529632731a0486ea7379187","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_administrative_stamp_v1","signature":"public.faolla_attendance_administrative_stamp_v1(timestamptz)","hash":"6d0b940b342a28ef5abe117ceb132f80180680cf1a7ac65af88be475f7f879a2","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_administrative_frame_v1","signature":"public.faolla_attendance_administrative_frame_v1(jsonb)","hash":"b1db19c72584d4f0617a0ac53f425f88e5ee9cae7f4e1600953d2f8adafea03f","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_administrative_scope_v1","signature":"public.faolla_attendance_administrative_scope_v1(jsonb)","hash":"cced0de14b5545e78c9587eec063cd70e49a318259306624f388bb5065004013","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_administrative_context_v1","signature":"public.faolla_attendance_administrative_context_v1(jsonb)","hash":"6770c4f42f603523da703e91c080dd350dc074707142506e1e3982050a6ce8b1","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_administrative_event_v1","signature":"public.faolla_attendance_administrative_event_v1(public.merchant_attendance_events)","hash":"fc6d90a50c6e1f08ff2e090278b3595a6591b0a7a3d9dbdb3d0ce912a1e3beb3","result":"jsonb","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_administrative_pause_v1","signature":"public.faolla_attendance_administrative_pause_v1(public.merchant_attendance_account_suspensions)","hash":"a4300e0f28d15b88fb47d71aca7af2c794e8c4dfbfc0b8de3610cb49f4a28723","result":"jsonb","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_administrative_predecessor_v1","signature":"public.faolla_attendance_administrative_predecessor_v1(text,uuid,public.merchant_attendance_events)","hash":"1a130e666abe5e6fbb6f52941676803fa0051fcff0e3eac042c1eb6c3d8acb56","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_first"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_effect_evidence_v2","signature":"public.faolla_attendance_effect_evidence_v2(public.merchant_attendance_effect_current_v2,timestamptz)","hash":"7399bd61e91171134adb5d421472210ac1efed45009d76312baad368887ab789","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["e","p_now"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_pin_schedule_receipt_v1","signature":"public.faolla_attendance_pin_schedule_receipt_v1(public.merchant_attendance_shift_schedule_relations,uuid)","hash":"a5dddcb339d5f9f44e796ecc6534db042cfdae4a796c1fbdbe398243bde91e0c","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_auth"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_shift_plan_adoption_read_v1","signature":"public.faolla_attendance_shift_plan_adoption_read_v1(jsonb)","hash":"54c3c29563565e964013e55c6796431fd0a98e7f0902115afbafb1e1cd35c5dd","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_check"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_shift_plan_adoption_v1","signature":"public.faolla_attendance_shift_plan_adoption_v1(public.merchant_attendance_shift_schedule_relations,uuid,uuid,boolean,text)","hash":"33961fe42724f6ccdcca379ca6a018b81ea027ac76af922eece3558dee75fd35","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_auth","p_approval_id","p_current","p_channel"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_location_schedule_receipt_v1","signature":"public.faolla_attendance_location_schedule_receipt_v1(public.merchant_attendance_shift_schedule_relations,uuid)","hash":"eeca33a4e024a460711581c3328ec5d912c8be16785fa8c1dc44b8b8fea727c3","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_auth"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_onsite_schedule_receipt_v1","signature":"public.faolla_attendance_onsite_schedule_receipt_v1(public.merchant_attendance_shift_schedule_relations,uuid)","hash":"440d093b1948076ef1dc0c2b3576737ec0720d9dcd7ffbcdf7333a61b9464e5d","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_auth"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_self_schedule_receipt_v1","signature":"public.faolla_attendance_self_schedule_receipt_v1(public.merchant_attendance_shift_schedule_relations,uuid)","hash":"74533c65136630b1af571a06b426d5e9a8a188c98b051850e2dca97cfd015930","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_auth"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_rule_command_v1","signature":"public.faolla_attendance_plan_rule_command_v1(jsonb)","hash":"db15373814794b836726ac2931dd101539149f3ded66f26e4f7a595698ae90a6","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_rule_source_v1","signature":"public.faolla_attendance_plan_rule_source_v1(jsonb)","hash":"24d6fd9b88e2c0bd6d3960b8161728442d1c8334e4d35f03a8794e57b304e86b","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_rule_fields_v1","signature":"public.faolla_attendance_plan_rule_fields_v1(jsonb)","hash":"84622fcb50c1d717ea9060309fd0a1d38259e01f55b8bb47a256395fde8f41ce","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_exception_session_v1","signature":"public.faolla_attendance_plan_exception_session_v1(jsonb)","hash":"7ee3d7e702e361ef426d2f1dec40b53ba3d7b172ae0a84a0d64354c58e80fd05","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_check"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_calendar_summary_v1","signature":"public.faolla_attendance_calendar_summary_v1(public.merchant_attendance_calendar_entries,integer)","hash":"4ffd6f0aaeb6c489707e8ec1d4b17d074fdf3c6f3a3e2e8d028e303545b66858","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":1,"defaultExpression":"NULL::integer","args":["p","p_revision"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_control_day_boundary_v1","signature":"public.faolla_attendance_control_day_boundary_v1(date,text)","hash":"6c1479bd60a7349acc92fe7a2b7552509751e65be5651cc48d102c00834164a8","result":"timestamptz","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_date","p_zone"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_work_arrangement_context_v1","signature":"public.faolla_attendance_work_arrangement_context_v1(text,uuid,uuid,uuid,timestamptz,timestamptz)","hash":"dfdfcdbffb8db9855c91ce3189e4ef8e049cb758b40727d2b4713fdcef8ae21d","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_employee","p_member_auth","p_from","p_to"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_pd_exception_v1","signature":"public.faolla_attendance_pd_exception_v1(jsonb,uuid)","hash":"8c20b5c314dd8f5f932b090ed9301123c6091a7c2ed86422fc8632c595df0fd5","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_pd_exception_legacy_v1","signature":"public.faolla_attendance_pd_exception_legacy_v1(jsonb,uuid)","hash":"472e3a992e9a1282c91bd6021d0bcb4029b7639fbb6166fd35b6becd0dfb3d9c","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_pd_adoptions_v1","signature":"public.faolla_attendance_pd_adoptions_v1(jsonb,uuid)","hash":"2bd55e8af66b971e2f16d03aee7a6daeff1fe01d290a03cd56d71f65b133f7e9","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_pd_coverage_v1","signature":"public.faolla_attendance_pd_coverage_v1(jsonb,uuid)","hash":"677053898b2daa329dd664175e8f40b0c39e664236b2e7829c620c1e28177440","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_pd_shift_v1","signature":"public.faolla_attendance_pd_shift_v1(jsonb,uuid)","hash":"95e9440e1aa03cdc31afd21356160ab6f205a887dc32228da1a9ac7d268d7a9b","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_pd_binding_v1","signature":"public.faolla_attendance_pd_binding_v1(jsonb,uuid)","hash":"bafe9103025f2d8717e840fb10554671bb44459a75065bb5fd1b560a96d7759f","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_exception_review_evidence_v1","signature":"public.faolla_attendance_plan_exception_review_evidence_v1(jsonb)","hash":"b2238eee2d6100256d4d93febf7451a805f3c29c40bc0cad6a6780c27cd7ae8d","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_exception_posthoc_evidence_v1","signature":"public.faolla_attendance_plan_exception_posthoc_evidence_v1(jsonb)","hash":"dd6b43732c116595e1c31fa6160f6a375c4076993e7dcb149d407826d0168d6a","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_exception_review_evidence_legacy_v1","signature":"public.faolla_attendance_plan_exception_review_evidence_legacy_v1(jsonb)","hash":"f5e90e3a18bdb07ed6b2e72beb3c6eab7e874c998c93c239215ead4b1fc2a28b","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_posthoc_formal_leave_v1","signature":"public.faolla_attendance_plan_posthoc_formal_leave_v1(jsonb,jsonb,jsonb)","hash":"3f5dbf083a8bf1deb5a5f0e7165e3597807a78915d61fc2e3866d3b6113b5543","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_plan","p_leave","p_work"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_posthoc_reference_v1","signature":"public.faolla_attendance_plan_posthoc_reference_v1(jsonb)","hash":"b11f18e0e7f7e20e975a10be979645b2954a2b1e82123b64ccd6c4c3cad5c148","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_exception_review_entry_v1","signature":"public.faolla_attendance_plan_exception_review_entry_v1(public.merchant_attendance_plan_exception_entries)","hash":"044e220ca14f67ae05dd30b6b2e88a7d653e74cd1a1926b2496326d4be2d787b","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_posthoc_operation_v1","signature":"public.faolla_attendance_plan_posthoc_operation_v1(public.merchant_attendance_plan_posthoc_operations)","hash":"eb59e0f4bc1b509cfd81551717c10f8a45870cbf25df1a63abbbd161408f5cad","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_posthoc_command_v1","signature":"public.faolla_attendance_plan_posthoc_command_v1(jsonb)","hash":"55f61f66802adeb66becb33e54c010eb1ce102eb7a63f3cd8e15f1741bd5eef2","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_event_notification_capture_v1","signature":"public.faolla_attendance_event_notification_capture_v1(text,text,uuid,uuid,jsonb)","hash":"b5f6cf8f13e36d404a95db730ba74d9a4819fb1ffcf8111429b08f08f18fa16e","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_category","p_operation","p_actor","p_command"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_event_notification_source_v1","signature":"public.faolla_attendance_event_notification_source_v1(text,text,uuid)","hash":"809383292eca0f8d6a595bdbde38d727d138db2d38532b0ae4184bfa8283df3d","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_category","p_operation"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_application_delegation_receipt_v1","signature":"public.faolla_attendance_application_delegation_receipt_v1(public.merchant_attendance_application_delegation_decisions)","hash":"e46bc3a861f15b486c51ce70bd53a779f65e0bcbb619d9d4c16be8fe380f1585","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_application_delegation_request_v1","signature":"public.faolla_attendance_application_delegation_request_v1(text,text,uuid)","hash":"5fb85a9f725390a6d030d4ce7e8e7262447bfb484e04b3ce74d46b867a400a28","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_category","p_request"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_posthoc_formal_source_v1","signature":"public.faolla_attendance_plan_posthoc_formal_source_v1(jsonb,uuid)","hash":"7794ff1971454006e2410476c4848faf3972d0e8bb67039c9acfb13dc32c7d64","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_plan_posthoc_formal_facts_v1","signature":"public.faolla_attendance_plan_posthoc_formal_facts_v1(jsonb,uuid)","hash":"c9c0ced9eca39a7ad6f70710a04ef6f25d8add120839c91beb38ae6e7b70eacc","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_posthoc_adoption_v1","signature":"public.faolla_attendance_plan_posthoc_adoption_v1(jsonb,uuid,jsonb,boolean)","hash":"a12c7b2e71b3c98c379680e3be8a8c592f299e2475fdf6737cb9d1184279288e","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_write"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_plan_posthoc_preview_v1","signature":"public.faolla_attendance_plan_posthoc_preview_v1(jsonb,uuid,integer,uuid)","hash":"9640704dae146d72816cdebc8e4da81bf82b99b242df063ea2251a3c2e20df0c","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id","p_revision","p_current"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_period_plan_rule_v1","signature":"public.faolla_attendance_period_plan_rule_v1(text,uuid,uuid,uuid,uuid,uuid)","hash":"14c5ebcc0ab24aa7cd9334633c76a3bd82484e894b17877168409618651f0e17","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_slot","p_employee","p_member_auth","p_operation"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_period_session_v1","signature":"public.faolla_attendance_period_session_v1(text,uuid,uuid,uuid,uuid,timestamptz)","hash":"d23cef1c4a301f655e3e9d43425671c0b56c5a598062302d25f851b3071d23e2","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_start","p_employee","p_member_auth","p_observed"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_administrative_report_boundary_v1","signature":"public.faolla_attendance_administrative_report_boundary_v1(jsonb)","hash":"546120e124c686ea41f5dfd5fd61c5f25fc6b5ccabbd5b8eea7e9e94ce732f04","result":"jsonb","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_posthoc_missing_v1","signature":"public.faolla_attendance_plan_posthoc_missing_v1(text,uuid,uuid,uuid,uuid)","hash":"c2dd4efcde6b512a2a5a4f00807287fb1173c3ed3127bf2b10b679b35b24f3d3","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_employee","p_auth","p_request"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_posthoc_observation_v1","signature":"public.faolla_attendance_plan_posthoc_observation_v1(text,uuid,uuid,uuid,jsonb,uuid,jsonb,jsonb,timestamptz)","hash":"391fd1674a436ed80bdc3feee19b0d8ac313a23720099553922291457476be4f","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_employee","p_auth","p_slot","p_operation","p_approval","p_saved","p_observed"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_posthoc_formal_compute_v1","signature":"public.faolla_attendance_plan_posthoc_formal_compute_v1(jsonb)","hash":"87a6d349fad373c4a8968c1b314c04bdcae3c64cbb845b8dfb83ed9e8336c48f","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_facts"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_pd_formal_source_v1","signature":"public.faolla_attendance_pd_formal_source_v1(jsonb,uuid)","hash":"df18e7f9c365cd2776cd6db47a634638406aee99f92d0a6db6375f1e47a7d4e3","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_pd_formal_facts_v1","signature":"public.faolla_attendance_pd_formal_facts_v1(jsonb,uuid)","hash":"d3aedf4a521221a406bc64132a522b1350a5df55719391508a5ee6e53bbaac5b","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_pd_posthoc_read_v1","signature":"public.faolla_attendance_pd_posthoc_read_v1(jsonb,uuid)","hash":"5dfbf7d4675cdf1d019756195a1283a12f4e39f9d6e1b8d01a03bb4478b1f20b","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_pd_posthoc_preview_v1","signature":"public.faolla_attendance_pd_posthoc_preview_v1(jsonb,uuid,integer,uuid)","hash":"9f0cdde2690e4c6b3f4b048ddba2eff9d74de42a0b3de702a1209a5b549a2709","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id","p_revision","p_current"],"searchPath":"search_path=pg_catalog","isRpc":false}]$exceptions209_dependencies$::jsonb;
 own_spec:=own_spec||jsonb_build_array(case when has190 then $exceptions209_catalog190${"name":"faolla_valid_merchant_enterprise_permissions_v1","signature":"public.faolla_valid_merchant_enterprise_permissions_v1(text[])","hash":"3d759540cb9f60753053c3012d4bbbc9d14aed92ad86aa9ba7358a0fc2d89792","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_permissions"],"searchPath":"search_path=pg_catalog, public","isRpc":false,"changes":[{"from":"      ('redemptions.view', array[]::text[]),","to":"      ('attendance.workers.manage', array['enterprise.view']::text[]),\n      ('attendance.groups.manage', array['enterprise.view']::text[]),\n      ('attendance.locations.manage', array['enterprise.view']::text[]),\n      ('attendance.rules.draft', array['enterprise.view']::text[]),\n      ('attendance.rules.publish', array['enterprise.view']::text[]),\n      ('attendance.rules.withdraw', array['enterprise.view']::text[]),\n      ('attendance.terminals.pair', array['enterprise.view']::text[]),\n      ('attendance.terminals.revoke', array['enterprise.view']::text[]),\n      ('attendance.pin.issue', array['enterprise.view']::text[]),\n      ('attendance.pin.revoke', array['enterprise.view']::text[]),\n      ('attendance.correction.revision.review', array['enterprise.view']::text[]),\n      ('attendance.plan_exception.review', array['enterprise.view']::text[]),\n      ('attendance.audit.view', array['enterprise.view']::text[]),\n      ('attendance.audit.export', array['enterprise.view']::text[]),\n      ('redemptions.view', array[]::text[]),","count":1}]}$exceptions209_catalog190$::jsonb else $exceptions209_catalog185${"name":"faolla_valid_merchant_enterprise_permissions_v1","signature":"public.faolla_valid_merchant_enterprise_permissions_v1(text[])","hash":"876f0456ae5a911a8dd7de7ebed3ab03aa3b9bb4fa347c9adae4261d4d64c48b","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_permissions"],"searchPath":"search_path=pg_catalog, public","isRpc":false,"changes":[{"from":"      ('redemptions.view', array[]::text[]),","to":"      ('attendance.workers.manage', array['enterprise.view']::text[]),\n      ('attendance.groups.manage', array['enterprise.view']::text[]),\n      ('attendance.locations.manage', array['enterprise.view']::text[]),\n      ('attendance.rules.draft', array['enterprise.view']::text[]),\n      ('attendance.rules.publish', array['enterprise.view']::text[]),\n      ('attendance.rules.withdraw', array['enterprise.view']::text[]),\n      ('attendance.terminals.pair', array['enterprise.view']::text[]),\n      ('attendance.terminals.revoke', array['enterprise.view']::text[]),\n      ('attendance.pin.issue', array['enterprise.view']::text[]),\n      ('attendance.pin.revoke', array['enterprise.view']::text[]),\n      ('attendance.correction.revision.review', array['enterprise.view']::text[]),\n      ('attendance.plan_exception.review', array['enterprise.view']::text[]),\n      ('attendance.audit.view', array['enterprise.view']::text[]),\n      ('attendance.audit.export', array['enterprise.view']::text[]),\n      ('redemptions.view', array[]::text[]),","count":1}]}$exceptions209_catalog185$::jsonb end);
 own_spec:=own_spec||$exceptions209_forwards$[{"name":"faolla_attendance_plan_exception_clearance_execute_v1","signature":"public.faolla_attendance_plan_exception_clearance_execute_v1(jsonb,uuid,jsonb,boolean,boolean,boolean)","hash":"449701832073245222b442d7d5fbb13d80b123bb80dbcc7076c0299d4d683412","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id","p_command","p_allow_write","p_allow_clearance","p_capture_notifications"],"searchPath":"search_path=pg_catalog","isRpc":false,"oldHash":"449701832073245222b442d7d5fbb13d80b123bb80dbcc7076c0299d4d683412","newHash":"847912ce9c2d83fed0e7814b2c00a06c86c6d32826fda5f2f56c0bc36eef4ad7"},{"name":"faolla_attendance_plan_exception_posthoc_execute_v1","signature":"public.faolla_attendance_plan_exception_posthoc_execute_v1(jsonb,uuid,jsonb,boolean,boolean,boolean,boolean)","hash":"a28df0ec556702b0e4fb30e434dc089d853c358a14ab907eab23b6b3a287be5f","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id","p_command","p_allow_write","p_allow_posthoc","p_allow_clearance","p_capture_notifications"],"searchPath":"search_path=pg_catalog","isRpc":false,"oldHash":"a28df0ec556702b0e4fb30e434dc089d853c358a14ab907eab23b6b3a287be5f","newHash":"919d96cc278c1790c0a2b0547339ed54156cd6a4d49edbaa3a8772045d6f44ce"},{"name":"faolla_attendance_management_insert_v1","signature":"public.faolla_attendance_management_insert_v1()","hash":"284e4388128f1bd0984fb5995a0f34cc9f23e2d1d67dfb4f5286cc46c1e006e6","result":"trigger","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false,"from":"if tg_table_name='merchant_attendance_management_delegation_operations' then raise exception 'attendance_management_executor_unavailable';end if;","to":"if tg_table_name='merchant_attendance_management_delegation_operations' then\n  if new.delegated_action='audit_export' then perform public.faolla_attendance_management_audit_authority_v1(new);return new;end if;\n  raise exception 'attendance_management_executor_unavailable';\n end if;","oldHash":"284e4388128f1bd0984fb5995a0f34cc9f23e2d1d67dfb4f5286cc46c1e006e6","newHash":"245e56cd2f82f0f341fe7fffb53008c871a10da226087d7dc9de56c17ca7fb5b"}]$exceptions209_forwards$::jsonb;
 for forward_spec in select value from jsonb_array_elements(own_spec) loop
  if forward_spec ? 'newHash' then forward_spec:=forward_spec||jsonb_build_object('hash',forward_spec->>(case when installed then 'newHash' else 'oldHash' end));end if;
  own_spec:=jsonb_build_array(forward_spec);for spec in select value from jsonb_array_elements(own_spec) loop
  f:=to_regprocedure(replace(spec->>'signature','public.',ns||'.'));
  select proc.*,language.lanname into meta from pg_proc proc join pg_language language on language.oid=proc.prolang where proc.oid=f;
  if f is null or meta.proowner is distinct from expected_owner or meta.prosecdef is distinct from (spec->>'definer')::boolean
   or meta.proconfig is distinct from array[replace(spec->>'searchPath','public',ns)] or meta.provolatile::text is distinct from spec->>'volatility'
   or meta.lanname is distinct from spec->>'language' or meta.prorettype is distinct from to_regtype(replace(spec->>'result','public.',ns||'.'))
   or meta.proretset or meta.proisstrict or meta.proleakproof or meta.prokind<>'f' or meta.proparallel<>'u' or meta.prosupport<>0::oid
   or meta.proallargtypes is not null or meta.proargmodes is not null or meta.pronargs<>jsonb_array_length(spec->'args')
   or meta.procost<>100 or meta.prorows<>0 or meta.pronargdefaults<>(spec->>'defaults')::integer
   or coalesce(meta.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'args'))
   or pg_get_expr(meta.proargdefaults,0) is distinct from spec->>'defaultExpression'
   or (select count(*) from pg_proc proc where proc.pronamespace=meta.pronamespace and proc.proname=meta.proname)<>1
   or encode(sha256(convert_to(replace(replace(meta.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from spec->>'hash'
   or has_function_privilege(expected_owner,f,'EXECUTE') is distinct from true
   or (case when spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' then (has_function_privilege(expected_owner,meta.oid,'EXECUTE') is distinct from true
    or (select coalesce(jsonb_agg(jsonb_build_array(a.grantor,a.grantee,a.privilege_type,a.is_grantable) order by a.grantee,a.grantor,a.privilege_type,a.is_grantable),'[]')
     from aclexplode(coalesce(meta.proacl,acldefault('f',meta.proowner))) a) not in(
      jsonb_build_array(jsonb_build_array(expected_owner,expected_owner,'EXECUTE',false)),
      jsonb_build_array(jsonb_build_array(expected_owner,0::oid,'EXECUTE',false),jsonb_build_array(expected_owner,expected_owner,'EXECUTE',false))))
    else has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or has_function_privilege('service_role',f,'EXECUTE') is distinct from (spec->>'isRpc')::boolean
   or exists(select 1 from aclexplode(coalesce(meta.proacl,acldefault('f',meta.proowner))) acl where acl.grantor<>expected_owner
    or acl.grantee<>expected_owner and ((spec->>'isRpc')::boolean is distinct from true or acl.grantee<>(select oid from pg_roles where rolname='service_role') or acl.privilege_type<>'EXECUTE' or acl.is_grantable)) end)
   then raise exception 'merchant_attendance_management_function_conflict';end if;
 end loop;
 end loop;foreach table_name in array array['merchant_attendance_terminals','merchant_attendance_terminal_audit','merchant_attendance_pin_credentials','merchant_attendance_pin_audit','merchant_attendance_pin_attempts','merchant_attendance_independent_subjects','merchant_attendance_independent_entries','merchant_attendance_independent_credentials','merchant_attendance_independent_leases','merchant_attendance_independent_event_sources','merchant_attendance_independent_member_bindings','merchant_attendance_management_delegations','merchant_attendance_management_delegation_revocations','merchant_attendance_management_delegation_operations','merchant_attendance_delegated_credential_proofs','merchant_attendance_revision_requests','merchant_attendance_effect_versions','merchant_attendance_revision_decisions','merchant_attendance_schedule_commands','merchant_attendance_schedule_slots','merchant_attendance_schedule_cancellations','merchant_attendance_schedule_publication_evidence','merchant_attendance_plan_exception_cases','merchant_attendance_plan_exception_entries','merchant_attendance_plan_exception_reads'] loop
 actual_table:=to_regclass(ns||'.'||table_name);expected_table:=to_regclass('pg_temp.'||table_name);
 if not exists(select 1 from pg_class catalog_table where catalog_table.oid=actual_table and catalog_table.relkind='r' and catalog_table.relowner=expected_owner and catalog_table.relrowsecurity and not catalog_table.relforcerowsecurity and catalog_table.relpersistence='p' and not catalog_table.relispartition)
  or exists(select 1 from pg_policy where polrelid=actual_table)
  or exists(select 1 from pg_class catalog_table cross join lateral aclexplode(coalesce(catalog_table.relacl,acldefault('r',catalog_table.relowner))) acl where catalog_table.oid=actual_table and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
  or exists(select 1 from pg_attribute attribute cross join lateral aclexplode(attribute.attacl) acl where attribute.attrelid=actual_table and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
  or (select count(*) from pg_attribute where attrelid=actual_table and attnum>0)<>(select count(*) from pg_attribute where attrelid=expected_table and attnum>0)
  or exists(select 1 from pg_attribute actual join pg_attribute expected on expected.attrelid=expected_table and actual.attnum=expected.attnum
   left join pg_attrdef actual_default on actual_default.adrelid=actual.attrelid and actual_default.adnum=actual.attnum
   left join pg_attrdef expected_default on expected_default.adrelid=expected.attrelid and expected_default.adnum=expected.attnum
   where actual.attrelid=actual_table and actual.attnum>0 and (row(actual.attname,actual.atttypid,actual.atttypmod,actual.attnotnull,actual.atthasdef,actual.attidentity,actual.attgenerated,actual.attndims,actual.attisdropped,actual.attcollation)
    is distinct from row(expected.attname,expected.atttypid,expected.atttypmod,expected.attnotnull,expected.atthasdef,expected.attidentity,expected.attgenerated,expected.attndims,expected.attisdropped,expected.attcollation)
    or pg_get_expr(actual_default.adbin,actual_table) is distinct from pg_get_expr(expected_default.adbin,expected_table))) then raise exception 'merchant_attendance_delegated_plan_exceptions_table_conflict';end if;
 if (select count(*) from pg_constraint where conrelid=actual_table and contype<>'t')<>(select count(*) from pg_constraint where conrelid=expected_table and contype<>'t') then raise exception 'merchant_attendance_delegated_plan_exceptions_constraint_conflict';end if;
 for constraint_spec in select * from pg_constraint where conrelid=expected_table and contype<>'t' loop
  select * into actual_constraint from pg_constraint where conrelid=actual_table and conname=constraint_spec.conname;
  foreign_table:=case when constraint_spec.contype='f' then to_regclass(ns||'.'||(select relname from pg_class where oid=constraint_spec.confrelid)) else 0::oid end;
  select array_agg(actual_ref.attnum::smallint order by requested.ord) into reference_keys from unnest(constraint_spec.confkey) with ordinality requested(attnum,ord)
   join pg_attribute expected_ref on expected_ref.attrelid=constraint_spec.confrelid and expected_ref.attnum=requested.attnum
   join pg_attribute actual_ref on actual_ref.attrelid=foreign_table and actual_ref.attname=expected_ref.attname;
  if actual_constraint.oid is null or row(actual_constraint.contype,actual_constraint.conkey,actual_constraint.confkey,actual_constraint.confrelid,actual_constraint.condeferrable,actual_constraint.condeferred,actual_constraint.convalidated,actual_constraint.confupdtype,actual_constraint.confdeltype,actual_constraint.confmatchtype,actual_constraint.connoinherit,actual_constraint.conislocal,actual_constraint.coninhcount)
   is distinct from row(constraint_spec.contype,constraint_spec.conkey,reference_keys,foreign_table::oid,constraint_spec.condeferrable,constraint_spec.condeferred,true,constraint_spec.confupdtype,constraint_spec.confdeltype,constraint_spec.confmatchtype,constraint_spec.connoinherit,true,0)
   or pg_get_expr(actual_constraint.conbin,actual_table) is distinct from pg_get_expr(constraint_spec.conbin,expected_table) then raise exception 'merchant_attendance_delegated_plan_exceptions_constraint_conflict';end if;
 end loop;
 if (select count(*) from pg_index where indrelid=actual_table)<>(select count(*) from pg_index where indrelid=expected_table) then raise exception 'merchant_attendance_delegated_plan_exceptions_index_conflict';end if;
 for index_spec in select index_row.*,index_table.relname,index_table.relam from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indrelid=expected_table loop
  select index_row.*,index_table.relowner,index_table.relam,index_table.relkind into actual_index from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indexrelid=to_regclass(ns||'.'||index_spec.relname);
  if actual_index.indexrelid is null or actual_index.indrelid<>actual_table or actual_index.relowner<>expected_owner or actual_index.relkind<>'i' or not actual_index.indisvalid or not actual_index.indisready or not actual_index.indislive
   or row(actual_index.relam,actual_index.indnatts,actual_index.indnkeyatts,actual_index.indisunique,actual_index.indisprimary,actual_index.indisexclusion,actual_index.indimmediate,actual_index.indnullsnotdistinct,actual_index.indkey,actual_index.indcollation,actual_index.indclass,actual_index.indoption)
   is distinct from row(index_spec.relam,index_spec.indnatts,index_spec.indnkeyatts,index_spec.indisunique,index_spec.indisprimary,index_spec.indisexclusion,index_spec.indimmediate,index_spec.indnullsnotdistinct,index_spec.indkey,index_spec.indcollation,index_spec.indclass,index_spec.indoption)
   or pg_get_expr(actual_index.indpred,actual_table) is distinct from pg_get_expr(index_spec.indpred,expected_table) or pg_get_expr(actual_index.indexprs,actual_table) is distinct from pg_get_expr(index_spec.indexprs,expected_table) then raise exception 'merchant_attendance_delegated_plan_exceptions_index_conflict';end if;
 end loop;



 if (select count(*) from pg_trigger actual where actual.tgrelid=actual_table and not actual.tgisinternal)<>(select count(*) from jsonb_array_elements($exceptions209_triggers$[{"table":"merchant_attendance_terminal_audit","name":"merchant_attendance_terminal_audit_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_terminal_audit","name":"merchant_attendance_terminal_audit_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_pin_credentials","name":"attendance_account_activation_guard","type":23,"fn":"faolla_attendance_account_activation_guard_v1","deferred":false},{"table":"merchant_attendance_pin_audit","name":"attendance_pin_audit_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_pin_audit","name":"attendance_pin_audit_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_independent_entries","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_entries","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_event_sources","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_event_sources","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_member_bindings","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_member_bindings","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_insert","type":7,"fn":"faolla_attendance_delegated_credentials_proof_insert_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_pair","type":5,"fn":"faolla_attendance_delegated_credentials_pair_v1","deferred":true},{"table":"merchant_attendance_revision_requests","name":"attendance_revision_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_revision_requests","name":"attendance_revision_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_revision_requests","name":"attendance_period_seal_guard","type":7,"fn":"faolla_attendance_period_seal_insert_guard_v1","deferred":false},{"table":"merchant_attendance_revision_requests","name":"review_routing_capture","type":5,"fn":"faolla_attendance_review_routing_capture_v1","deferred":false},{"table":"merchant_attendance_effect_versions","name":"attendance_effect_version_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_effect_versions","name":"attendance_effect_version_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_effect_versions","name":"attendance_period_seal_guard","type":7,"fn":"faolla_attendance_period_seal_insert_guard_v1","deferred":false},{"table":"merchant_attendance_effect_versions","name":"attendance_effect_version_insert_guard","type":7,"fn":"faolla_attendance_effect_version_guard_v1","deferred":false},{"table":"merchant_attendance_effect_versions","name":"attendance_revision_missing_guard","type":5,"fn":"faolla_attendance_missing_effect_guard_v1","deferred":false},{"table":"merchant_attendance_effect_versions","name":"attendance_effect_version_decision_link","type":5,"fn":"faolla_attendance_revision_decision_link_v1","deferred":true},{"table":"merchant_attendance_revision_decisions","name":"attendance_revision_decision_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_revision_decisions","name":"attendance_revision_decision_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_revision_decisions","name":"attendance_revision_decision_effect_link","type":5,"fn":"faolla_attendance_revision_decision_link_v1","deferred":true},{"table":"merchant_attendance_schedule_commands","name":"attendance_schedule_commands_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_commands","name":"attendance_schedule_commands_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_slots","name":"attendance_schedule_slots_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_slots","name":"attendance_schedule_slots_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_cancellations","name":"attendance_schedule_cancellations_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_cancellations","name":"attendance_schedule_cancellations_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_publication_evidence","name":"attendance_schedule_publication_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_publication_evidence","name":"attendance_schedule_publication_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_publication_evidence","name":"attendance_schedule_publication_insert","type":7,"fn":"faolla_attendance_schedule_publication_guard_v1","deferred":false},{"table":"merchant_attendance_plan_exception_cases","name":"attendance_plan_exception_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_plan_exception_cases","name":"attendance_plan_exception_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_plan_exception_entries","name":"attendance_plan_exception_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_plan_exception_entries","name":"attendance_plan_exception_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_plan_exception_reads","name":"attendance_plan_exception_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_plan_exception_reads","name":"attendance_plan_exception_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false}]$exceptions209_triggers$::jsonb) expected where expected->>'table'=table_name) then raise exception 'merchant_attendance_delegated_plan_exceptions_trigger_conflict';end if;
 for trigger_spec in select value from jsonb_array_elements($exceptions209_triggers$[{"table":"merchant_attendance_terminal_audit","name":"merchant_attendance_terminal_audit_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_terminal_audit","name":"merchant_attendance_terminal_audit_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_pin_credentials","name":"attendance_account_activation_guard","type":23,"fn":"faolla_attendance_account_activation_guard_v1","deferred":false},{"table":"merchant_attendance_pin_audit","name":"attendance_pin_audit_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_pin_audit","name":"attendance_pin_audit_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_independent_entries","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_entries","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_event_sources","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_event_sources","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_member_bindings","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_member_bindings","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_insert","type":7,"fn":"faolla_attendance_delegated_credentials_proof_insert_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_pair","type":5,"fn":"faolla_attendance_delegated_credentials_pair_v1","deferred":true},{"table":"merchant_attendance_revision_requests","name":"attendance_revision_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_revision_requests","name":"attendance_revision_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_revision_requests","name":"attendance_period_seal_guard","type":7,"fn":"faolla_attendance_period_seal_insert_guard_v1","deferred":false},{"table":"merchant_attendance_revision_requests","name":"review_routing_capture","type":5,"fn":"faolla_attendance_review_routing_capture_v1","deferred":false},{"table":"merchant_attendance_effect_versions","name":"attendance_effect_version_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_effect_versions","name":"attendance_effect_version_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_effect_versions","name":"attendance_period_seal_guard","type":7,"fn":"faolla_attendance_period_seal_insert_guard_v1","deferred":false},{"table":"merchant_attendance_effect_versions","name":"attendance_effect_version_insert_guard","type":7,"fn":"faolla_attendance_effect_version_guard_v1","deferred":false},{"table":"merchant_attendance_effect_versions","name":"attendance_revision_missing_guard","type":5,"fn":"faolla_attendance_missing_effect_guard_v1","deferred":false},{"table":"merchant_attendance_effect_versions","name":"attendance_effect_version_decision_link","type":5,"fn":"faolla_attendance_revision_decision_link_v1","deferred":true},{"table":"merchant_attendance_revision_decisions","name":"attendance_revision_decision_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_revision_decisions","name":"attendance_revision_decision_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_revision_decisions","name":"attendance_revision_decision_effect_link","type":5,"fn":"faolla_attendance_revision_decision_link_v1","deferred":true},{"table":"merchant_attendance_schedule_commands","name":"attendance_schedule_commands_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_commands","name":"attendance_schedule_commands_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_slots","name":"attendance_schedule_slots_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_slots","name":"attendance_schedule_slots_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_cancellations","name":"attendance_schedule_cancellations_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_cancellations","name":"attendance_schedule_cancellations_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_publication_evidence","name":"attendance_schedule_publication_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_publication_evidence","name":"attendance_schedule_publication_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_publication_evidence","name":"attendance_schedule_publication_insert","type":7,"fn":"faolla_attendance_schedule_publication_guard_v1","deferred":false},{"table":"merchant_attendance_plan_exception_cases","name":"attendance_plan_exception_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_plan_exception_cases","name":"attendance_plan_exception_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_plan_exception_entries","name":"attendance_plan_exception_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_plan_exception_entries","name":"attendance_plan_exception_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_plan_exception_reads","name":"attendance_plan_exception_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_plan_exception_reads","name":"attendance_plan_exception_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false}]$exceptions209_triggers$::jsonb) where value->>'table'=table_name loop
  if not exists(select 1 from pg_trigger actual where actual.tgrelid=actual_table and actual.tgname=(trigger_spec->>'name')::name and actual.tgtype=(trigger_spec->>'type')::integer
   and actual.tgfoid=to_regprocedure(ns||'.'||(trigger_spec->>'fn')||'()') and actual.tgenabled='O' and actual.tgnargs=0 and actual.tgqual is null and actual.tgparentid=0
   and actual.tgdeferrable=(trigger_spec->>'deferred')::boolean and actual.tginitdeferred=(trigger_spec->>'deferred')::boolean) then raise exception 'merchant_attendance_delegated_plan_exceptions_trigger_conflict';end if;
 end loop;
end loop;
if not exists(select 1 from pg_class actual where actual.oid=to_regclass(ns||'.merchant_attendance_effect_current_v2') and actual.relkind='v' and actual.relowner=expected_owner
 and actual.reloptions is null and not actual.relrowsecurity and not actual.relforcerowsecurity)
 or exists(select 1 from pg_class actual cross join lateral aclexplode(coalesce(actual.relacl,acldefault('r',actual.relowner))) acl
  where actual.oid=to_regclass(ns||'.merchant_attendance_effect_current_v2') and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
 or exists(select 1 from pg_attribute attribute cross join lateral aclexplode(attribute.attacl) acl where attribute.attrelid=to_regclass(ns||'.merchant_attendance_effect_current_v2') and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
 or pg_get_viewdef(to_regclass(ns||'.merchant_attendance_effect_current_v2'),true) is distinct from pg_get_viewdef('pg_temp.revisions208_current_template'::regclass,true)
 then raise exception 'merchant_attendance_delegated_plan_exceptions_view_conflict';end if;
 if (select count(*) from pg_proc proc where proc.pronamespace=(select oid from pg_namespace where nspname=ns) and proc.proname=any(array['faolla_attendance_delegated_plan_exceptions_command_v1','faolla_attendance_delegated_plan_exceptions_hash_v1','faolla_attendance_delegated_plan_exceptions_authorize_v1','faolla_attendance_delegated_plan_exceptions_target_v1','faolla_attendance_delegated_plan_exceptions_core_authorize_v1','faolla_attendance_delegated_plan_exceptions_clearance_core_v1','faolla_attendance_delegated_plan_exceptions_posthoc_core_v1','faolla_attendance_delegated_plan_exceptions_scope_v1','faolla_attendance_delegated_plan_exceptions_business_v1','faolla_attendance_delegated_plan_exceptions_operation_v1','faolla_attendance_delegated_plan_exceptions_authority_v1','faolla_attendance_delegated_plan_exceptions_receipt_v1','faolla_attendance_delegated_plan_exceptions_v1']))<>(case when installed then 13 else 0 end) then raise exception 'merchant_attendance_delegated_plan_exceptions_installation_conflict';end if;
 if installed then own_spec:=$exceptions209_own$[{"name":"faolla_attendance_delegated_plan_exceptions_command_v1","signature":"public.faolla_attendance_delegated_plan_exceptions_command_v1(jsonb)","hash":"dcc6a2df4b822d35fe761912aed4d86aca30c625256d6cf41be796d8c7673cfe","result":"void","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_plan_exceptions_hash_v1","signature":"public.faolla_attendance_delegated_plan_exceptions_hash_v1(text,uuid,uuid,uuid,uuid,jsonb)","hash":"aa4e546aab05cb32d5de1a8ca240ef7d7bc9fc9efd57ae7990a97896b726900f","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id","wid","sid","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_plan_exceptions_authorize_v1","signature":"public.faolla_attendance_delegated_plan_exceptions_authorize_v1(text,uuid,uuid)","hash":"df4904fef58531f6c0da133659831eafc1b106d731f313a22b10ec2cdfd183af","result":"public.merchant_attendance_management_delegations","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_plan_exceptions_target_v1","signature":"public.faolla_attendance_delegated_plan_exceptions_target_v1(public.merchant_attendance_management_delegations,uuid,uuid)","hash":"b88db3f87374ff7ea71b9874df19ae6fbbedc5addb9b969d3a8d87f62c76f6b8","result":"void","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["g","wid","sid"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_plan_exceptions_core_authorize_v1","signature":"public.faolla_attendance_delegated_plan_exceptions_core_authorize_v1(text,uuid,uuid,uuid,uuid,text,text)","hash":"34fd59f9f2e5a954d3413e5c6244930cef2297690f086885c784730115c7b9fa","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id","wid","sid","access_name","mode_name"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_plan_exceptions_clearance_core_v1","signature":"public.faolla_attendance_delegated_plan_exceptions_clearance_core_v1(jsonb,uuid,jsonb,boolean,boolean,boolean,uuid)","hash":"614ec2ce66ef080ab44165c447a41c7ce6db5e41267b96afabe91969c2653329","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id","p_command","p_allow_write","p_allow_clearance","p_capture_notifications","p_grant_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_plan_exceptions_posthoc_core_v1","signature":"public.faolla_attendance_delegated_plan_exceptions_posthoc_core_v1(jsonb,uuid,jsonb,boolean,boolean,boolean,boolean,uuid)","hash":"3d17f15a7f8c18a495ce2b5013376a702016a568dfa69201c67ded776612649c","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id","p_command","p_allow_write","p_allow_posthoc","p_allow_clearance","p_capture_notifications","p_grant_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_plan_exceptions_scope_v1","signature":"public.faolla_attendance_delegated_plan_exceptions_scope_v1(public.merchant_attendance_management_delegations,jsonb)","hash":"4495ccddf9f866eacbf7e2903963c98386a653c927aa1ab951cb47b6d2af91b8","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g","r"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_plan_exceptions_business_v1","signature":"public.faolla_attendance_delegated_plan_exceptions_business_v1(text,uuid)","hash":"6bbe987ae02a7f713459bacb828312f6d1ea28bced7e7d196ebd03a67f2fbccc","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","op"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_plan_exceptions_operation_v1","signature":"public.faolla_attendance_delegated_plan_exceptions_operation_v1(public.merchant_attendance_management_delegation_operations,boolean)","hash":"5363774c28b265089271d091830199cd9ca31e36410a952ca773f877a074afbe","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p","require_current"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_plan_exceptions_authority_v1","signature":"public.faolla_attendance_delegated_plan_exceptions_authority_v1(public.merchant_attendance_management_delegation_operations)","hash":"55182ce4492b78f862e05a7b81456b9dec1ef691c621e58e58a9bfbb9285534f","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_plan_exceptions_receipt_v1","signature":"public.faolla_attendance_delegated_plan_exceptions_receipt_v1(text,uuid,uuid,uuid)","hash":"c621f311944d064a9cf406b50841f34df3cdbdba7f390b5921e9939381cf4036","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id","op"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_plan_exceptions_v1","signature":"public.faolla_attendance_delegated_plan_exceptions_v1(jsonb,uuid,jsonb,boolean,boolean,boolean,boolean)","hash":"91c07fba72874eaf8b3c1b344ed3bf8c1a20b6254f01231e33550ca52691419f","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":5,"defaultExpression":"NULL::jsonb, false, false, false, false","args":["p_query","p_auth_user_id","p_command","p_allow_write","p_allow_posthoc","p_allow_clearance","p_capture_notifications"],"searchPath":"search_path=pg_catalog","isRpc":true}]$exceptions209_own$::jsonb;for spec in select value from jsonb_array_elements(own_spec) loop
  f:=to_regprocedure(replace(spec->>'signature','public.',ns||'.'));
  select proc.*,language.lanname into meta from pg_proc proc join pg_language language on language.oid=proc.prolang where proc.oid=f;
  if f is null or meta.proowner is distinct from expected_owner or meta.prosecdef is distinct from (spec->>'definer')::boolean
   or meta.proconfig is distinct from array[replace(spec->>'searchPath','public',ns)] or meta.provolatile::text is distinct from spec->>'volatility'
   or meta.lanname is distinct from spec->>'language' or meta.prorettype is distinct from to_regtype(replace(spec->>'result','public.',ns||'.'))
   or meta.proretset or meta.proisstrict or meta.proleakproof or meta.prokind<>'f' or meta.proparallel<>'u' or meta.prosupport<>0::oid
   or meta.proallargtypes is not null or meta.proargmodes is not null or meta.pronargs<>jsonb_array_length(spec->'args')
   or meta.procost<>100 or meta.prorows<>0 or meta.pronargdefaults<>(spec->>'defaults')::integer
   or coalesce(meta.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'args'))
   or pg_get_expr(meta.proargdefaults,0) is distinct from spec->>'defaultExpression'
   or (select count(*) from pg_proc proc where proc.pronamespace=meta.pronamespace and proc.proname=meta.proname)<>1
   or encode(sha256(convert_to(replace(replace(meta.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from spec->>'hash'
   or has_function_privilege(expected_owner,f,'EXECUTE') is distinct from true
   or (case when spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' then (has_function_privilege(expected_owner,meta.oid,'EXECUTE') is distinct from true
    or (select coalesce(jsonb_agg(jsonb_build_array(a.grantor,a.grantee,a.privilege_type,a.is_grantable) order by a.grantee,a.grantor,a.privilege_type,a.is_grantable),'[]')
     from aclexplode(coalesce(meta.proacl,acldefault('f',meta.proowner))) a) not in(
      jsonb_build_array(jsonb_build_array(expected_owner,expected_owner,'EXECUTE',false)),
      jsonb_build_array(jsonb_build_array(expected_owner,0::oid,'EXECUTE',false),jsonb_build_array(expected_owner,expected_owner,'EXECUTE',false))))
    else has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or has_function_privilege('service_role',f,'EXECUTE') is distinct from (spec->>'isRpc')::boolean
   or exists(select 1 from aclexplode(coalesce(meta.proacl,acldefault('f',meta.proowner))) acl where acl.grantor<>expected_owner
    or acl.grantee<>expected_owner and ((spec->>'isRpc')::boolean is distinct from true or acl.grantee<>(select oid from pg_roles where rolname='service_role') or acl.privilege_type<>'EXECUTE' or acl.is_grantable)) end)
   then raise exception 'merchant_attendance_management_function_conflict';end if;
 end loop;end if;
 end;$exceptions209_preflight$;
--END GENERATED DELEGATED PLAN EXCEPTIONS PREFLIGHT

create or replace function public.faolla_attendance_delegated_plan_exceptions_command_v1(c jsonb)
returns void language plpgsql immutable set search_path=pg_catalog as $$
begin
 if public.faolla_attendance_plan_exception_review_command_v1('decide',c) is distinct from true then raise exception 'attendance_invalid_request';end if;
end;
$$;
create or replace function public.faolla_attendance_delegated_plan_exceptions_hash_v1(site text,actor uuid,id uuid,wid uuid,sid uuid,c jsonb)
returns text language plpgsql immutable set search_path=pg_catalog as $$
begin
 perform public.faolla_attendance_delegated_plan_exceptions_command_v1(c);
 return public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-delegated-plan-exceptions-v1-command',site,actor,id,
  jsonb_build_array(wid,sid),jsonb_build_array(c->'operationId',c->'expectedRevision',c->'expectedFingerprint',c->'employeeId',c->'employeeAuthUserId',c->'outcome',c->'note')));
end;
$$;
create or replace function public.faolla_attendance_delegated_plan_exceptions_authorize_v1(site text,actor uuid,id uuid)
returns public.merchant_attendance_management_delegations language plpgsql set search_path=pg_catalog as $$
declare g public.merchant_attendance_management_delegations%rowtype;w public.merchant_attendance_workers%rowtype;
 e public.merchant_enterprise_employees%rowtype;delegate public.merchant_enterprise_employees%rowtype;
begin
 perform 1 from public.merchants actual where actual.id=site for share;if not found then raise exception 'attendance_access_denied';end if;
 perform 1 from public.merchant_attendance_settings actual where actual.merchant_id=site for update;if not found then raise exception 'attendance_settings_required';end if;
 --Immutable grant discovery precedes the shared worker -> ordered employees
 --and roles lock order. The locked reread below validates the same binding.
 select * into g from public.merchant_attendance_management_delegations actual where actual.merchant_id=site and actual.grant_id=id;
 if actor is null or g.grant_id is null or g.delegate_auth_user_id is distinct from actor or g.scope->>'kind' is distinct from 'formal_exception'
  or g.delegated_action is distinct from 'plan_exception_decide' or g.capability is distinct from 'attendance.plan_exception.review'
  or g.employee_id=g.delegate_employee_id or g.employee_auth_user_id=actor
  or g.command_fingerprint is distinct from public.faolla_attendance_management_hash_v1(site,g.actor_auth_user_id,g.command)
  then raise exception 'attendance_access_denied';end if;
 select * into w from public.merchant_attendance_workers actual where actual.merchant_id=site and actual.id=g.worker_id for update;
 perform 1 from public.merchant_enterprise_employees actual where actual.merchant_id=site and actual.id in(g.employee_id,g.delegate_employee_id) order by actual.id for share;
 select * into e from public.merchant_enterprise_employees actual where actual.merchant_id=site and actual.id=g.employee_id;
 select * into delegate from public.merchant_enterprise_employees actual where actual.merchant_id=site and actual.id=g.delegate_employee_id;
 perform 1 from public.merchant_enterprise_roles actual where actual.merchant_id=site and actual.id in(e.role_id,delegate.role_id) order by actual.id for share;
 perform 1 from public.merchant_attendance_account_epochs actual where actual.merchant_id=site and actual.employee_id in(g.employee_id,g.delegate_employee_id) order by actual.employee_id for share;
 select * into g from public.merchant_attendance_management_delegations actual where actual.merchant_id=site and actual.grant_id=id for share;
 if row(w.employee_id,e.auth_user_id,delegate.auth_user_id) is distinct from row(g.employee_id,g.employee_auth_user_id,actor)
  or not w.active or e.status is distinct from 'active'
  or exists(select 1 from public.merchant_attendance_account_epochs actual where actual.merchant_id=site and actual.employee_id=g.employee_id and actual.paused)
  or public.faolla_attendance_management_current_v1(g,clock_timestamp()) is distinct from true then raise exception 'attendance_access_denied';end if;
 return g;
end;
$$;
create or replace function public.faolla_attendance_delegated_plan_exceptions_target_v1(g public.merchant_attendance_management_delegations,wid uuid,sid uuid)
returns void language plpgsql stable set search_path=pg_catalog as $$
declare slot public.merchant_attendance_schedule_slots%rowtype;publication public.merchant_attendance_schedule_publication_evidence%rowtype;
 original public.merchant_attendance_schedule_commands%rowtype;expected_slot jsonb;
begin
 select * into slot from public.merchant_attendance_schedule_slots actual where actual.merchant_id=g.merchant_id and actual.id=sid;
 select * into publication from public.merchant_attendance_schedule_publication_evidence actual where actual.merchant_id=g.merchant_id and actual.revision=slot.revision;
 select * into original from public.merchant_attendance_schedule_commands actual where actual.merchant_id=g.merchant_id and actual.revision=slot.revision;
 expected_slot:=jsonb_build_object('id',slot.id,'workDate',to_char(slot.work_date,'YYYY-MM-DD'),
  'startAt',to_char(slot.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'endAt',to_char(slot.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 if wid is distinct from g.worker_id or row(slot.worker_id,slot.employee_id,publication.worker_id,publication.employee_id,publication.employee_auth_user_id)
  is distinct from row(g.worker_id,g.employee_id,g.worker_id,g.employee_id,g.employee_auth_user_id)
  or slot.id is null or publication.operation_id is null or original.operation_id is null
  or row(publication.operation_id,publication.actor_auth_user_id,publication.published_at,publication.location_id,publication.time_zone)
  is distinct from row(original.operation_id,original.actor_auth_user_id,original.recorded_at,slot.location_id,slot.time_zone)
  or publication.identity_status is distinct from 'bound' or original.command->>'action' is distinct from 'publish'
  or original.command->>'operationId' is distinct from original.operation_id::text
  or original.query->>'siteId' is distinct from g.merchant_id or original.query->>'workerId' is distinct from g.worker_id::text
  or original.command->>'locationId' is distinct from slot.location_id::text
  or public.faolla_attendance_schedule_publication_slots_v1(publication.slots) is distinct from true or not(publication.slots @> jsonb_build_array(expected_slot))
  or not(g.scope->'locationIds' @> jsonb_build_array(slot.location_id::text))
  or not isfinite(publication.published_at) or not(g.scope->>'includePending')::boolean and publication.published_at<g.recorded_at
  then raise exception 'attendance_management_delegation_scope_invalid';end if;
end;
$$;
create or replace function public.faolla_attendance_delegated_plan_exceptions_core_authorize_v1(site text,actor uuid,id uuid,wid uuid,sid uuid,access_name text,mode_name text)
returns void language plpgsql set search_path=pg_catalog as $$
declare g public.merchant_attendance_management_delegations%rowtype;
begin
 if access_name is distinct from 'owner' or mode_name not in('detail','decide') then raise exception 'attendance_access_denied';end if;
 g:=public.faolla_attendance_delegated_plan_exceptions_authorize_v1(site,actor,id);
 perform public.faolla_attendance_delegated_plan_exceptions_target_v1(g,wid,sid);
end;
$$;
--BEGIN GENERATED DELEGATED PLAN EXCEPTIONS CORES
create or replace function public.faolla_attendance_delegated_plan_exceptions_clearance_core_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb,p_allow_write boolean,p_allow_clearance boolean,p_capture_notifications boolean,p_grant_id uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare site text;access_name text;mode_name text;wid uuid;sid uuid;op uuid;cursor_at timestamptz;cursor_id uuid;
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
  r public.merchant_enterprise_roles%rowtype;c public.merchant_attendance_plan_exception_cases%rowtype;
  entry_row public.merchant_attendance_plan_exception_entries%rowtype;saved public.merchant_attendance_plan_exception_entries%rowtype;
  latest public.merchant_attendance_plan_exception_entries%rowtype;read_row public.merchant_attendance_plan_exception_reads%rowtype;
  saved_read public.merchant_attendance_plan_exception_reads%rowtype;
  source_result jsonb:=null;current_item jsonb:=null;evidence jsonb;refs jsonb;part jsonb;ref_item jsonb;ref_items jsonb;k text;
  worker_item jsonb;items jsonb:='[]';history jsonb:='[]';detail jsonb:=null;receipt jsonb:=null;read_receipt jsonb:=null;
  latest_item jsonb:=null;item jsonb;next_cursor jsonb:=null;result jsonb;head bigint:=0;row_count integer:=0;
  history_truncated boolean:=false;checked boolean:=false;stale boolean:=null;stamp timestamptz;last_at timestamptz;read_at timestamptz;
  n bigint;bytes bigint;current_employee uuid;current_auth uuid;capture_new_decision boolean:=false;
  stamp_format constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_auth_user_id is null or p_allow_write is null or p_allow_clearance is null or p_capture_notifications is null
    or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','access','mode','workerId','slotId','operationId','beforeAt','beforeId']) is distinct from true
    or octet_length(convert_to(p_query::text,'UTF8'))>4096 or jsonb_typeof(p_query->'siteId')<>'string'
    or char_length(p_query->>'siteId')<>8 or p_query->>'siteId'!~'^[0-9]{8}$' or jsonb_typeof(p_query->'access')<>'string' or p_query->>'access' not in('owner','self')
    or jsonb_typeof(p_query->'mode')<>'string' or p_query->>'mode' not in('list','detail','recover','decide','note','ack') then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';access_name:=p_query->>'access';mode_name:=p_query->>'mode';
  foreach k in array array['workerId','slotId','operationId','beforeId'] loop
    if p_query->k<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->k,'uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  end loop;
  if p_query->'beforeAt'<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'beforeAt','stamp6') is distinct from true then raise exception 'attendance_invalid_request';end if;
  wid:=(p_query->>'workerId')::uuid;sid:=(p_query->>'slotId')::uuid;op:=(p_query->>'operationId')::uuid;
  cursor_at:=(p_query->>'beforeAt')::timestamptz;cursor_id:=(p_query->>'beforeId')::uuid;
  if mode_name='list' then
    if sid is not null or op is not null or p_command is not null or (cursor_at is null)<>(cursor_id is null) then raise exception 'attendance_invalid_request';end if;
  else
    if wid is null or sid is null or cursor_at is not null or cursor_id is not null
      or (mode_name='detail')<>(op is null) then raise exception 'attendance_invalid_request';end if;
    if mode_name in('detail','recover') then
      if p_command is not null then raise exception 'attendance_invalid_request';end if;
    elsif public.faolla_attendance_plan_exception_review_command_v1(mode_name,p_command) is distinct from true
      or p_command->>'operationId' is distinct from op::text then raise exception 'attendance_invalid_request';end if;
  end if;
  if mode_name='decide' and access_name<>'owner' or mode_name in('note','ack') and access_name<>'self' then raise exception 'attendance_access_denied';end if;
 if p_grant_id is null then
  perform 1 from public.merchants where id=site and (access_name='self' or user_id=p_auth_user_id) for share;
  if not found then raise exception 'attendance_access_denied';end if;
 else
  perform public.faolla_attendance_delegated_plan_exceptions_core_authorize_v1(site,p_auth_user_id,p_grant_id,wid,sid,access_name,mode_name);
 end if;
  select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  if not found then raise exception 'attendance_settings_required';end if;
  if access_name='self' then
    -- Resolve the employee ID without locking, then follow the shared
    -- merchant/settings -> worker -> employee -> role order. The locked
    -- reread below rechecks the same authenticated binding after any wait.
    select id into current_employee from public.merchant_enterprise_employees where merchant_id=site and auth_user_id=p_auth_user_id;
    if current_employee is null then raise exception 'attendance_access_denied';end if;
    select * into w from public.merchant_attendance_workers where merchant_id=site and employee_id=current_employee for share;
    select * into e from public.merchant_enterprise_employees where merchant_id=site and id=current_employee and auth_user_id=p_auth_user_id for share;
    if not found or e.status<>'active' then raise exception 'attendance_access_denied';end if;
    select * into r from public.merchant_enterprise_roles where merchant_id=site and id=e.role_id for share;
    if not found or r.status<>'active' or public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions) is distinct from true
      or not('attendance.self.view'=any(r.permissions)) then raise exception 'attendance_access_denied';end if;
    if w.id is not null and w.employee_id is distinct from e.id then raise exception 'attendance_plan_exception_review_identity_changed';end if;
    if wid is not null and w.id is distinct from wid then raise exception 'attendance_plan_exception_review_identity_changed';end if;
    wid:=w.id;current_employee:=e.id;current_auth:=e.auth_user_id;
  elsif wid is not null then
    select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for share;
    if not found then raise exception 'attendance_worker_not_found';end if;
    if w.employee_id is not null then select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;end if;
    if e.id is null or e.auth_user_id is null then raise exception 'attendance_plan_exception_review_identity_changed';end if;
    current_employee:=e.id;current_auth:=e.auth_user_id;
  end if;
  -- New namespace serializes operation IDs across entries/reads, first-case
  -- creation and finite quotas. No old row receives UPDATE or lock upgrade.
  if p_command is not null then perform pg_advisory_xact_lock(hashtextextended('faolla:attendance-plan-exception-review:v1:'||site,0));end if;
  if mode_name<>'list' then
    if p_command is null then
      select * into c from public.merchant_attendance_plan_exception_cases where merchant_id=site and slot_id=sid for share;
    else
      select * into c from public.merchant_attendance_plan_exception_cases where merchant_id=site and slot_id=sid for update;
    end if;
    if c.case_id is not null then
      if c.worker_id is distinct from wid or c.employee_id is distinct from current_employee or c.employee_auth_user_id is distinct from current_auth then
        raise exception 'attendance_plan_exception_review_identity_changed';end if;
    elsif access_name='self' then raise exception 'attendance_plan_exception_review_not_found';end if;
  end if;
  -- Exact original receipts are read before pause, current-source collection,
  -- eligibility or quota. Current authorization and dual identity always apply.
  if op is not null then
    select * into saved from public.merchant_attendance_plan_exception_entries where merchant_id=site and operation_id=op;
    select * into saved_read from public.merchant_attendance_plan_exception_reads where merchant_id=site and operation_id=op;
    if saved.operation_id is not null and saved_read.operation_id is not null then raise exception 'attendance_plan_exception_review_invalid';end if;
    -- A concurrent first decision can commit between the earlier case lookup
    -- and this immutable receipt lookup. Re-pin the case after finding it.
    if c.case_id is null and (saved.operation_id is not null or saved_read.operation_id is not null) then
      select * into c from public.merchant_attendance_plan_exception_cases where merchant_id=site and case_id=coalesce(saved.case_id,saved_read.case_id) for share;
      if c.worker_id is distinct from wid or c.slot_id is distinct from sid or c.employee_id is distinct from current_employee
        or c.employee_auth_user_id is distinct from current_auth then raise exception 'attendance_plan_exception_review_identity_changed';end if;
    end if;
    if saved.operation_id is not null then
      if saved.actor_auth_user_id<>p_auth_user_id or saved.worker_id<>wid or saved.slot_id<>sid or saved.case_id is distinct from c.case_id
        or (saved.kind='decision')<>(access_name='owner') then raise exception 'attendance_access_denied';end if;
      if saved.employee_id<>current_employee or saved.employee_auth_user_id<>current_auth then raise exception 'attendance_plan_exception_review_identity_changed';end if;
      if p_command is not null and (saved.command is distinct from p_command or mode_name<>case saved.kind when 'decision' then 'decide' else 'note' end) then
        raise exception 'attendance_operation_conflict';end if;
    elsif saved_read.operation_id is not null then
      if access_name<>'self' or saved_read.employee_auth_user_id<>p_auth_user_id or saved_read.worker_id<>wid or saved_read.slot_id<>sid
        or saved_read.case_id is distinct from c.case_id then raise exception 'attendance_access_denied';end if;
      if saved_read.employee_id<>current_employee or saved_read.employee_auth_user_id<>current_auth then raise exception 'attendance_plan_exception_review_identity_changed';end if;
      if p_command is not null and (mode_name<>'ack' or saved_read.command is distinct from p_command) then raise exception 'attendance_operation_conflict';end if;
    end if;
  end if;
  if c.case_id is not null then
    select revision,recorded_at into head,last_at from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id order by revision desc limit 1;
    if head is null then raise exception 'attendance_plan_exception_review_invalid';end if;
    select * into latest from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id and kind='decision' order by revision desc limit 1;
    if latest.operation_id is null then raise exception 'attendance_plan_exception_review_invalid';end if;
  end if;
  if p_command is not null and saved.operation_id is null and saved_read.operation_id is null then
    if not p_allow_write or not s.enabled then raise exception 'attendance_platform_paused';end if;
    if access_name='self' and not w.active then raise exception 'attendance_access_denied';end if;
    --Only the explicit new RPC can authorize a fresh clearance. This is after
    --locked original-receipt resolution, before current-source collection.
    if mode_name='decide' and p_command->>'outcome'='cleared' then
      if not p_allow_clearance then raise exception 'attendance_plan_exception_clearance_disabled';end if;
      if c.case_id is null or head<1 or (p_command->>'expectedRevision')::bigint<1 then
        raise exception 'attendance_plan_exception_review_blocked';end if;
    end if;
    if mode_name<>'ack' and (p_command->>'expectedRevision')::bigint<>head then raise exception 'attendance_version_conflict';end if;
    if mode_name='decide' and (p_command->>'employeeId' is distinct from current_employee::text
      or p_command->>'employeeAuthUserId' is distinct from current_auth::text) then raise exception 'attendance_plan_exception_review_identity_changed';end if;
    if mode_name='decide' and p_auth_user_id=current_auth then raise exception 'attendance_access_denied';end if;
  end if;
  if access_name='owner' and (mode_name='detail' or mode_name='decide' and saved.operation_id is null) then
 if p_grant_id is null then
    source_result:=public.faolla_attendance_plan_exception_source_v1(jsonb_build_object('siteId',site,'workerId',wid,'slotId',sid),p_auth_user_id);
 else
    source_result:=public.faolla_attendance_pd_exception_v1(jsonb_build_object('siteId',site,'workerId',wid,'slotId',sid),p_auth_user_id);
 end if;
    if source_result->>'siteId' is distinct from site or source_result->>'actorId' is distinct from p_auth_user_id::text
      or source_result->'worker'->>'workerId' is distinct from wid::text or source_result->'worker'->>'employeeId' is distinct from current_employee::text
      or source_result->'worker'->>'employeeAuthUserId' is distinct from current_auth::text or source_result->'slot'->>'id' is distinct from sid::text
      or source_result->>'sourceText' is distinct from (source_result->'source')::text
      or source_result->>'fingerprint' is distinct from encode(sha256(convert_to(source_result->>'sourceText','UTF8')),'hex') then
      raise exception 'attendance_plan_exception_review_invalid';end if;
    current_item:=source_result-'sourceText';checked:=true;
    if latest.operation_id is not null then stale:=latest.evidence->>'fingerprint' is distinct from source_result->>'fingerprint';end if;
  end if;
  if p_command is not null and saved.operation_id is null and saved_read.operation_id is null then
    if mode_name='decide' then
      if source_result->>'fingerprint' is distinct from p_command->>'expectedFingerprint' then raise exception 'attendance_plan_exception_review_source_changed';end if;
      if p_command->>'outcome' in('confirmed','excused') and (source_result->>'eligible' is distinct from 'true'
        or not(source_result->'candidate'->'late'->>'state'='triggered' or source_result->'candidate'->'early'->>'state'='triggered')) then
        raise exception 'attendance_plan_exception_review_blocked';end if;
      if p_command->>'outcome'='cleared' and (source_result->>'eligible' is distinct from 'true'
        or source_result->'candidate'->'late'->>'state' is distinct from 'not_triggered'
        or source_result->'candidate'->'early'->>'state' is distinct from 'not_triggered') then
        raise exception 'attendance_plan_exception_review_blocked';end if;
      refs:='{}';
      foreach k in array array['sessions','unassociated','leave','calendar','missing','pendingCorrections']||case when source_result->'source'->>'policy'='owner-confirmed-plan-edges-work-v2' then array['workArrangements'] else array[]::text[] end loop
        part:=case when k='sessions' then jsonb_build_object('limited',false,'items',source_result->'source'->'sessions') else source_result->'source'->'context'->k end;
        ref_items:='[]';
        for ref_item in select value from jsonb_array_elements(part->'items') loop
          if k in('sessions','unassociated') then
            item:=jsonb_build_object('startEventId',ref_item->'startEventId','lastEventId',ref_item->'lastEventId','lastSequence',ref_item->'lastSequence','effectOperationId',ref_item->'effect'->'operationId');
          elsif k='calendar' then item:=jsonb_build_object('entryId',ref_item->'entryId','operationId',ref_item->'operationId','revision',ref_item->'revision');
          elsif k='workArrangements' then
            item:=jsonb_build_object('requestId',ref_item->'requestId','operationId',ref_item->'history'->-1->'operationId','revision',ref_item->'revision');
          else
            item:=jsonb_build_object('requestId',ref_item->'requestId','operationId',ref_item->'operationId','revision',ref_item->'revision');
            if k='pendingCorrections' then item:=item||jsonb_build_object('kind',ref_item->'kind','startEventId',ref_item->'startEventId');end if;
          end if;
          ref_items:=ref_items||jsonb_build_array(item);
        end loop;
        refs:=refs||jsonb_build_object(k,case when k='sessions' then ref_items else jsonb_build_object('limited',part->'limited','items',ref_items) end);
      end loop;
      evidence:=jsonb_build_object('policy',source_result->'source'->>'policy','fingerprint',source_result->'fingerprint','observedAt',source_result->'readAt',
        'eligible',source_result->'eligible','blockers',source_result->'blockers','candidate',source_result->'candidate',
        'approval',nullif(source_result->'source'->'approval','null'::jsonb)-'source','sessions',refs->'sessions','contextRefs',refs-'sessions');
      if octet_length(convert_to(evidence::text,'UTF8'))>131072 then raise exception 'attendance_plan_exception_too_large';end if;
      if public.faolla_attendance_plan_exception_review_evidence_v1(evidence) is distinct from true then raise exception 'attendance_plan_exception_review_invalid';end if;
    elsif mode_name='note' then
      if latest.operation_id is null or p_command->>'decisionOperationId' is distinct from latest.operation_id::text then raise exception 'attendance_version_conflict';end if;
    else
      select * into entry_row from public.merchant_attendance_plan_exception_entries where merchant_id=site and operation_id=(p_command->>'decisionOperationId')::uuid;
      if entry_row.case_id is distinct from c.case_id or entry_row.kind is distinct from 'decision' then raise exception 'attendance_plan_exception_review_not_found';end if;
      perform public.faolla_attendance_plan_exception_review_entry_v1(entry_row);
      if exists(select 1 from public.merchant_attendance_plan_exception_reads where merchant_id=site and decision_operation_id=entry_row.operation_id) then
        raise exception 'attendance_operation_conflict';end if;
    end if;
    if mode_name<>'ack' then
      select count(*),coalesce(sum(octet_length(convert_to(x.command::text,'UTF8'))+coalesce(octet_length(convert_to(x.evidence::text,'UTF8')),0)),0)
        into n,bytes from public.merchant_attendance_plan_exception_entries x where x.merchant_id=site;
      if n>=5000 or bytes+octet_length(convert_to(p_command::text,'UTF8'))+coalesce(octet_length(convert_to(evidence::text,'UTF8')),0)>67108864 or head>=200 then
        raise exception 'attendance_plan_exception_review_limit';end if;
    end if;
    stamp:=clock_timestamp();
    if last_at is not null and stamp<last_at or source_result is not null and stamp<(source_result->>'readAt')::timestamptz then
      raise exception 'attendance_plan_exception_review_invalid';end if;
    if c.case_id is null then
      if mode_name<>'decide' then raise exception 'attendance_plan_exception_review_not_found';end if;
      select count(*) into n from public.merchant_attendance_plan_exception_cases where merchant_id=site;
      if n>=500 or (select count(*) from public.merchant_attendance_plan_exception_cases where merchant_id=site and worker_id=wid)>=100 then
        raise exception 'attendance_plan_exception_review_limit';end if;
      insert into public.merchant_attendance_plan_exception_cases(merchant_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id,worker_name,worker_no,slot_start_at,slot_end_at,time_zone,opened_at)
        values(site,op,wid,sid,current_employee,current_auth,w.display_name,w.worker_no,(source_result->'slot'->>'startAt')::timestamptz,
          (source_result->'slot'->>'endAt')::timestamptz,source_result->'slot'->>'timeZone',stamp) returning * into c;
    end if;
    if mode_name='ack' then
      if stamp<entry_row.recorded_at then raise exception 'attendance_plan_exception_review_invalid';end if;
      insert into public.merchant_attendance_plan_exception_reads(merchant_id,operation_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id,decision_operation_id,command,read_at)
        values(site,op,c.case_id,wid,sid,current_employee,current_auth,entry_row.operation_id,p_command,stamp) returning * into saved_read;
    else
      insert into public.merchant_attendance_plan_exception_entries(merchant_id,operation_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id,revision,actor_auth_user_id,kind,command,evidence,recorded_at)
        values(site,op,c.case_id,wid,sid,current_employee,current_auth,head+1,p_auth_user_id,case mode_name when 'decide' then 'decision' else 'note' end,p_command,
          case when mode_name='decide' then evidence else null end,stamp) returning * into saved;
      head:=head+1;
      if mode_name='decide' then latest:=saved;stale:=false;capture_new_decision:=p_capture_notifications;end if;
    end if;
  end if;
  if saved.operation_id is not null then receipt:=jsonb_build_object('operationId',saved.operation_id,'command',saved.command,'item',public.faolla_attendance_plan_exception_review_entry_v1(saved));end if;
  if saved_read.operation_id is not null then
    select * into entry_row from public.merchant_attendance_plan_exception_entries where merchant_id=site and operation_id=saved_read.decision_operation_id;
    if entry_row.case_id is distinct from saved_read.case_id or entry_row.kind is distinct from 'decision' or saved_read.read_at<entry_row.recorded_at
      or public.faolla_attendance_plan_exception_review_command_v1('ack',saved_read.command) is distinct from true
      or saved_read.command->>'operationId' is distinct from saved_read.operation_id::text
      or saved_read.command->>'decisionOperationId' is distinct from saved_read.decision_operation_id::text then raise exception 'attendance_plan_exception_review_invalid';end if;
    perform public.faolla_attendance_plan_exception_review_entry_v1(entry_row);
    read_receipt:=jsonb_build_object('operationId',saved_read.operation_id,'command',saved_read.command,'decisionOperationId',saved_read.decision_operation_id,
      'actorId',saved_read.employee_auth_user_id,'employeeId',saved_read.employee_id,'employeeAuthUserId',saved_read.employee_auth_user_id,
      'readAt',to_char(saved_read.read_at at time zone 'UTC',stamp_format));
  end if;
  if mode_name='list' then
    for c in select x.* from public.merchant_attendance_plan_exception_cases x where x.merchant_id=site and (wid is null and access_name='owner' or x.worker_id=wid)
      and (access_name='owner' or x.employee_id=current_employee and x.employee_auth_user_id=current_auth)
      and (cursor_at is null or (x.opened_at,x.case_id)<(cursor_at,cursor_id)) order by x.opened_at desc,x.case_id desc limit 26 for share loop
      row_count:=row_count+1;if row_count>25 then exit;end if;
      -- Owner discovery must not hand a historical case to a newly bound member.
      select * into w from public.merchant_attendance_workers where merchant_id=site and id=c.worker_id for share;
      select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;
      if w.employee_id is distinct from c.employee_id or e.auth_user_id is distinct from c.employee_auth_user_id then raise exception 'attendance_plan_exception_review_identity_changed';end if;
      select revision into head from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id order by revision desc limit 1;
      select * into latest from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id and kind='decision' order by revision desc limit 1;
      if head is null or latest.operation_id is null then raise exception 'attendance_plan_exception_review_invalid';end if;
      item:=public.faolla_attendance_plan_exception_review_entry_v1(latest);
      select * into read_row from public.merchant_attendance_plan_exception_reads where merchant_id=site and decision_operation_id=latest.operation_id;
      if read_row.operation_id is not null and (read_row.case_id<>c.case_id or read_row.employee_id<>c.employee_id or read_row.employee_auth_user_id<>c.employee_auth_user_id or read_row.read_at<latest.recorded_at) then raise exception 'attendance_plan_exception_review_invalid';end if;
      items:=items||jsonb_build_array(jsonb_build_object('caseId',c.case_id,'workerId',c.worker_id,'slotId',c.slot_id,'employeeId',c.employee_id,
        'employeeAuthUserId',c.employee_auth_user_id,'workerName',c.worker_name,'workerNo',c.worker_no,'slotStartAt',to_char(c.slot_start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'slotEndAt',to_char(c.slot_end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'timeZone',c.time_zone,'openedAt',to_char(c.opened_at at time zone 'UTC',stamp_format),'revision',head,
        'latestDecision',jsonb_build_object('operationId',latest.operation_id,'revision',latest.revision,'outcome',latest.command->'outcome','recordedAt',item->'recordedAt','readAt',to_char(read_row.read_at at time zone 'UTC',stamp_format))));
      next_cursor:=jsonb_build_object('at',to_char(c.opened_at at time zone 'UTC',stamp_format),'id',c.case_id);
    end loop;
    if row_count<=25 then next_cursor:=null;end if;
  else
    if latest.operation_id is not null then
      latest_item:=public.faolla_attendance_plan_exception_review_entry_v1(latest);
      select * into read_row from public.merchant_attendance_plan_exception_reads where merchant_id=site and decision_operation_id=latest.operation_id;
      if read_row.operation_id is not null and (read_row.case_id<>c.case_id or read_row.employee_id<>c.employee_id or read_row.employee_auth_user_id<>c.employee_auth_user_id or read_row.read_at<latest.recorded_at) then raise exception 'attendance_plan_exception_review_invalid';end if;
      latest_item:=latest_item||jsonb_build_object('readAt',to_char(read_row.read_at at time zone 'UTC',stamp_format));
      for entry_row in select * from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id order by revision desc limit 26 loop
        row_count:=row_count+1;if row_count>25 then history_truncated:=true;exit;end if;
        history:=history||jsonb_build_array(public.faolla_attendance_plan_exception_review_entry_v1(entry_row)-'evidence');
      end loop;
    end if;
    worker_item:=jsonb_build_object('workerId',w.id,'workerName',w.display_name,'workerNo',w.worker_no,'employeeId',w.employee_id,
      'employeeAuthUserId',e.auth_user_id,'version',w.version,'active',w.active,'employeeActive',e.status='active');
    detail:=jsonb_build_object('caseId',c.case_id,'openedAt',to_char(c.opened_at at time zone 'UTC',stamp_format),'worker',worker_item,'slotId',sid,'revision',head,
      'current',current_item,'currentValidation',case when checked then 'checked' else 'not_checked' end,'stale',case when checked then stale else null end,
      'latestDecision',latest_item,'history',history,'historyTruncated',history_truncated,
      'canDecide',access_name='owner' and checked and p_allow_write and s.enabled and p_auth_user_id<>current_auth,
      'canNote',access_name='self' and latest.operation_id is not null and p_allow_write and s.enabled and w.active);
  end if;
  read_at:=clock_timestamp();
  if source_result is not null and read_at<(source_result->>'readAt')::timestamptz
    or saved.operation_id is not null and read_at<saved.recorded_at or saved_read.operation_id is not null and read_at<saved_read.read_at then
    raise exception 'attendance_plan_exception_review_invalid';end if;
  result:=jsonb_build_object('protocol','plan-exception-review-v1','siteId',site,'access',access_name,'actorId',p_auth_user_id,
    'employeeId',case when access_name='self' then current_employee else null end,'readAt',to_char(read_at at time zone 'UTC',stamp_format),
    'items',items,'nextCursor',next_cursor,'detail',detail,'receipt',receipt,'readReceipt',read_receipt);
  if octet_length(convert_to(result::text,'UTF8'))>1048576 then raise exception 'attendance_plan_exception_too_large';end if;
  --Set only by the actual new decision INSERT. Reads and exact retries never
  --infer freshness from a missing notification, even after rollout changes.
  if capture_new_decision then
    perform public.faolla_attendance_event_notification_capture_v1(site,'plan_exception',op,p_auth_user_id,p_command);
  end if;
  return result;
end;
$$;
create or replace function public.faolla_attendance_delegated_plan_exceptions_posthoc_core_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb,p_allow_write boolean,p_allow_posthoc boolean,p_allow_clearance boolean,p_capture_notifications boolean,p_grant_id uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare site text;access_name text;mode_name text;wid uuid;sid uuid;op uuid;cursor_at timestamptz;cursor_id uuid;
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
  r public.merchant_enterprise_roles%rowtype;c public.merchant_attendance_plan_exception_cases%rowtype;
  entry_row public.merchant_attendance_plan_exception_entries%rowtype;saved public.merchant_attendance_plan_exception_entries%rowtype;
  latest public.merchant_attendance_plan_exception_entries%rowtype;read_row public.merchant_attendance_plan_exception_reads%rowtype;
  saved_read public.merchant_attendance_plan_exception_reads%rowtype;
  source_basis jsonb;selected_sources jsonb;source_result jsonb:=null;current_item jsonb:=null;evidence jsonb;refs jsonb;part jsonb;ref_item jsonb;ref_items jsonb;k text;
  worker_item jsonb;items jsonb:='[]';history jsonb:='[]';detail jsonb:=null;receipt jsonb:=null;read_receipt jsonb:=null;
  latest_item jsonb:=null;item jsonb;next_cursor jsonb:=null;result jsonb;head bigint:=0;row_count integer:=0;
  history_truncated boolean:=false;checked boolean:=false;stale boolean:=null;stamp timestamptz;last_at timestamptz;read_at timestamptz;
  n bigint;bytes bigint;current_employee uuid;current_auth uuid;capture_new_decision boolean:=false;
  stamp_format constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_auth_user_id is null or p_allow_write is null or p_allow_posthoc is null or p_allow_clearance is null or p_capture_notifications is null
    or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','access','mode','workerId','slotId','operationId','beforeAt','beforeId']) is distinct from true
    or octet_length(convert_to(p_query::text,'UTF8'))>4096 or jsonb_typeof(p_query->'siteId')<>'string'
    or char_length(p_query->>'siteId')<>8 or p_query->>'siteId'!~'^[0-9]{8}$' or jsonb_typeof(p_query->'access')<>'string' or p_query->>'access' not in('owner','self')
    or jsonb_typeof(p_query->'mode')<>'string' or p_query->>'mode' not in('list','detail','recover','decide','note','ack') then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';access_name:=p_query->>'access';mode_name:=p_query->>'mode';
  foreach k in array array['workerId','slotId','operationId','beforeId'] loop
    if p_query->k<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->k,'uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  end loop;
  if p_query->'beforeAt'<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'beforeAt','stamp6') is distinct from true then raise exception 'attendance_invalid_request';end if;
  wid:=(p_query->>'workerId')::uuid;sid:=(p_query->>'slotId')::uuid;op:=(p_query->>'operationId')::uuid;
  cursor_at:=(p_query->>'beforeAt')::timestamptz;cursor_id:=(p_query->>'beforeId')::uuid;
  if mode_name='list' then
    if sid is not null or op is not null or p_command is not null or (cursor_at is null)<>(cursor_id is null) then raise exception 'attendance_invalid_request';end if;
  else
    if wid is null or sid is null or cursor_at is not null or cursor_id is not null
      or (mode_name='detail')<>(op is null) then raise exception 'attendance_invalid_request';end if;
    if mode_name in('detail','recover') then
      if p_command is not null then raise exception 'attendance_invalid_request';end if;
    elsif public.faolla_attendance_plan_exception_review_command_v1(mode_name,p_command) is distinct from true
      or p_command->>'operationId' is distinct from op::text then raise exception 'attendance_invalid_request';end if;
  end if;
  if mode_name='decide' and access_name<>'owner' or mode_name in('note','ack') and access_name<>'self' then raise exception 'attendance_access_denied';end if;
 if p_grant_id is null then
  perform 1 from public.merchants where id=site and (access_name='self' or user_id=p_auth_user_id) for share;
  if not found then raise exception 'attendance_access_denied';end if;
 else
  perform public.faolla_attendance_delegated_plan_exceptions_core_authorize_v1(site,p_auth_user_id,p_grant_id,wid,sid,access_name,mode_name);
 end if;
  select * into s from public.merchant_attendance_settings where merchant_id=site for update;
  if not found then raise exception 'attendance_settings_required';end if;
  if access_name='self' then
    -- Resolve the employee ID without locking, then follow the shared
    -- merchant/settings -> worker -> employee -> role order. The locked
    -- reread below rechecks the same authenticated binding after any wait.
    select id into current_employee from public.merchant_enterprise_employees where merchant_id=site and auth_user_id=p_auth_user_id;
    if current_employee is null then raise exception 'attendance_access_denied';end if;
    select * into w from public.merchant_attendance_workers where merchant_id=site and employee_id=current_employee for update;
    select * into e from public.merchant_enterprise_employees where merchant_id=site and id=current_employee and auth_user_id=p_auth_user_id for share;
    if not found or e.status<>'active' then raise exception 'attendance_access_denied';end if;
    select * into r from public.merchant_enterprise_roles where merchant_id=site and id=e.role_id for share;
    if not found or r.status<>'active' or public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions) is distinct from true
      or not('attendance.self.view'=any(r.permissions)) then raise exception 'attendance_access_denied';end if;
    if w.id is not null and w.employee_id is distinct from e.id then raise exception 'attendance_plan_exception_review_identity_changed';end if;
    if wid is not null and w.id is distinct from wid then raise exception 'attendance_plan_exception_review_identity_changed';end if;
    wid:=w.id;current_employee:=e.id;current_auth:=e.auth_user_id;
  elsif wid is not null then
    select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for update;
    if not found then raise exception 'attendance_worker_not_found';end if;
    if w.employee_id is not null then select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;end if;
    if e.id is null or e.auth_user_id is null then raise exception 'attendance_plan_exception_review_identity_changed';end if;
    current_employee:=e.id;current_auth:=e.auth_user_id;
  end if;
  --Do not introduce a new policy into no-ledger paths, or impersonate owner
  --for self reads/notes/acks. The locked legacy engine retains its exact result.
  if access_name<>'owner' or mode_name not in('detail','decide') or not exists(
    select 1 from public.merchant_attendance_plan_posthoc_operations where merchant_id=site and slot_id=sid) then
    if p_command is not null and mode_name='decide' and p_command->>'outcome'='not_applicable' then raise exception 'attendance_plan_exception_review_blocked';end if;
 if p_grant_id is null then
    return public.faolla_attendance_plan_exception_clearance_execute_v1(p_query,p_auth_user_id,p_command,p_allow_write,p_allow_clearance,p_capture_notifications);
 else
    return public.faolla_attendance_delegated_plan_exceptions_clearance_core_v1(p_query,p_auth_user_id,p_command,p_allow_write,p_allow_clearance,p_capture_notifications,p_grant_id);
 end if;
  end if;
  -- New namespace serializes operation IDs across entries/reads, first-case
  -- creation and finite quotas. No old row receives UPDATE or lock upgrade.
  if p_command is not null then perform pg_advisory_xact_lock(hashtextextended('faolla:attendance-plan-exception-review:v1:'||site,0));end if;
  if mode_name<>'list' then
    if p_command is null then
      select * into c from public.merchant_attendance_plan_exception_cases where merchant_id=site and slot_id=sid for share;
    else
      select * into c from public.merchant_attendance_plan_exception_cases where merchant_id=site and slot_id=sid for update;
    end if;
    if c.case_id is not null then
      if c.worker_id is distinct from wid or c.employee_id is distinct from current_employee or c.employee_auth_user_id is distinct from current_auth then
        raise exception 'attendance_plan_exception_review_identity_changed';end if;
    elsif access_name='self' then raise exception 'attendance_plan_exception_review_not_found';end if;
  end if;
  -- Exact original receipts are read before pause, current-source collection,
  -- eligibility or quota. Current authorization and dual identity always apply.
  if op is not null then
    select * into saved from public.merchant_attendance_plan_exception_entries where merchant_id=site and operation_id=op;
    select * into saved_read from public.merchant_attendance_plan_exception_reads where merchant_id=site and operation_id=op;
    if saved.operation_id is not null and saved_read.operation_id is not null then raise exception 'attendance_plan_exception_review_invalid';end if;
    -- A concurrent first decision can commit between the earlier case lookup
    -- and this immutable receipt lookup. Re-pin the case after finding it.
    if c.case_id is null and (saved.operation_id is not null or saved_read.operation_id is not null) then
      select * into c from public.merchant_attendance_plan_exception_cases where merchant_id=site and case_id=coalesce(saved.case_id,saved_read.case_id) for share;
      if c.worker_id is distinct from wid or c.slot_id is distinct from sid or c.employee_id is distinct from current_employee
        or c.employee_auth_user_id is distinct from current_auth then raise exception 'attendance_plan_exception_review_identity_changed';end if;
    end if;
    if saved.operation_id is not null then
      if saved.actor_auth_user_id<>p_auth_user_id or saved.worker_id<>wid or saved.slot_id<>sid or saved.case_id is distinct from c.case_id
        or (saved.kind='decision')<>(access_name='owner') then raise exception 'attendance_access_denied';end if;
      if saved.employee_id<>current_employee or saved.employee_auth_user_id<>current_auth then raise exception 'attendance_plan_exception_review_identity_changed';end if;
      if p_command is not null and (saved.command is distinct from p_command or mode_name<>case saved.kind when 'decision' then 'decide' else 'note' end) then
        raise exception 'attendance_operation_conflict';end if;
    elsif saved_read.operation_id is not null then
      if access_name<>'self' or saved_read.employee_auth_user_id<>p_auth_user_id or saved_read.worker_id<>wid or saved_read.slot_id<>sid
        or saved_read.case_id is distinct from c.case_id then raise exception 'attendance_access_denied';end if;
      if saved_read.employee_id<>current_employee or saved_read.employee_auth_user_id<>current_auth then raise exception 'attendance_plan_exception_review_identity_changed';end if;
      if p_command is not null and (mode_name<>'ack' or saved_read.command is distinct from p_command) then raise exception 'attendance_operation_conflict';end if;
    end if;
  end if;
  if c.case_id is not null then
    select revision,recorded_at into head,last_at from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id order by revision desc limit 1;
    if head is null then raise exception 'attendance_plan_exception_review_invalid';end if;
    select * into latest from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id and kind='decision' order by revision desc limit 1;
    if latest.operation_id is null then raise exception 'attendance_plan_exception_review_invalid';end if;
  end if;
  if p_command is not null and saved.operation_id is null and saved_read.operation_id is null then
    if not p_allow_write or not s.enabled then raise exception 'attendance_platform_paused';end if;
    if access_name='self' and not w.active then raise exception 'attendance_access_denied';end if;
    if mode_name='decide' then
      if not p_allow_posthoc then raise exception 'attendance_plan_exception_posthoc_disabled';end if;
      if c.case_id is null or head<1 or (p_command->>'expectedRevision')::bigint<1 then raise exception 'attendance_plan_exception_review_blocked';end if;
      if not w.active or e.status<>'active' then raise exception 'attendance_access_denied';end if;
    end if;
    --Only the explicit new RPC can authorize a fresh clearance. This is after
    --locked original-receipt resolution, before current-source collection.
    if mode_name='decide' and p_command->>'outcome'='cleared' then
      if not p_allow_clearance then raise exception 'attendance_plan_exception_clearance_disabled';end if;
      if c.case_id is null or head<1 or (p_command->>'expectedRevision')::bigint<1 then
        raise exception 'attendance_plan_exception_review_blocked';end if;
    end if;
    if mode_name<>'ack' and (p_command->>'expectedRevision')::bigint<>head then raise exception 'attendance_version_conflict';end if;
    if mode_name='decide' and (p_command->>'employeeId' is distinct from current_employee::text
      or p_command->>'employeeAuthUserId' is distinct from current_auth::text) then raise exception 'attendance_plan_exception_review_identity_changed';end if;
    if mode_name='decide' and p_auth_user_id=current_auth then raise exception 'attendance_access_denied';end if;
  end if;
  if access_name='owner' and (mode_name='detail' or mode_name='decide' and saved.operation_id is null) then
 if p_grant_id is null then
    source_result:=public.faolla_attendance_plan_posthoc_formal_source_v1(jsonb_build_object('siteId',site,'workerId',wid,'slotId',sid),p_auth_user_id);
 else
    source_result:=public.faolla_attendance_pd_formal_source_v1(jsonb_build_object('siteId',site,'workerId',wid,'slotId',sid),p_auth_user_id);
 end if;
    if source_result->>'siteId' is distinct from site or source_result->>'actorId' is distinct from p_auth_user_id::text
      or source_result->'worker'->>'workerId' is distinct from wid::text or source_result->'worker'->>'employeeId' is distinct from current_employee::text
      or source_result->'worker'->>'employeeAuthUserId' is distinct from current_auth::text or source_result->'slot'->>'id' is distinct from sid::text
      or source_result->>'sourceText' is distinct from (source_result->'source')::text
      or source_result->>'fingerprint' is distinct from encode(sha256(convert_to(source_result->>'sourceText','UTF8')),'hex') then
      raise exception 'attendance_plan_exception_review_invalid';end if;
    if source_result->>'protocol' is distinct from 'plan-exception-source-v3' then raise exception 'attendance_plan_exception_review_invalid';end if;
    source_basis:=source_result->'source'->'evaluation'->'basis';
    current_item:=source_result-'sourceText';checked:=true;
    if latest.operation_id is not null then stale:=latest.evidence->>'fingerprint' is distinct from source_result->>'fingerprint';end if;
  end if;
  if p_command is not null and saved.operation_id is null and saved_read.operation_id is null then
    if mode_name='decide' then
      if source_result->>'fingerprint' is distinct from p_command->>'expectedFingerprint' then raise exception 'attendance_plan_exception_review_source_changed';end if;
      if p_command->>'outcome' in('confirmed','excused') and (source_result->>'eligible' is distinct from 'true'
        or not(source_result->'candidate'->'late'->>'state'='triggered' or source_result->'candidate'->'early'->>'state'='triggered')) then
        raise exception 'attendance_plan_exception_review_blocked';end if;
      if p_command->>'outcome'='cleared' and (source_result->>'eligible' is distinct from 'true'
        or source_result->'candidate'->'late'->>'state' is distinct from 'not_triggered'
        or source_result->'candidate'->'early'->>'state' is distinct from 'not_triggered') then
        raise exception 'attendance_plan_exception_review_blocked';end if;
      if p_command->>'outcome'='not_applicable' and (source_result->>'state' is distinct from 'not_applicable'
        or source_result->>'eligible' is distinct from 'true' or source_result->'leaveEdges'->>'fullCoverage' is distinct from 'true'
        or source_result->'leaveEdges'->'work'<>'[]'::jsonb) then raise exception 'attendance_plan_exception_review_blocked';end if;
      --Formal facts omit seal state from their hash, but every fresh decision
      --still protects the plan and both saved/current source endpoint versions.
      perform public.faolla_attendance_period_assert_open_v1(site,wid,jsonb_build_array(jsonb_build_object(
        'startAt',to_char((source_result->'slot'->>'startAt')::timestamptz at time zone 'UTC',stamp_format),
        'endAt',to_char((source_result->'slot'->>'endAt')::timestamptz at time zone 'UTC',stamp_format))));
      selected_sources:=source_result->'source'->'evaluation'->'posthoc'->'selected';
      for ref_item in select observation_rows.value->'current' from jsonb_array_elements(source_result->'source'->'evaluation'->'observations') observation_rows(value) where observation_rows.value->'current'<>'null'::jsonb loop
        selected_sources:=selected_sources||jsonb_build_array(ref_item);
      end loop;
      for ref_item in select selected_rows.value from jsonb_array_elements(selected_sources) selected_rows(value) loop
        if ref_item->'selected'->>'endAt' is not null then perform public.faolla_attendance_period_assert_open_v1(site,wid,jsonb_build_array(ref_item->'selected'));end if;
        if ref_item->'original'->>'endAt' is not null then perform public.faolla_attendance_period_assert_open_v1(site,wid,jsonb_build_array(ref_item->'original'));end if;
      end loop;
      refs:='{}';
      foreach k in array array['sessions','unassociated','leave','calendar','missing','pendingCorrections']||case when source_basis->>'policy'='owner-confirmed-plan-edges-work-v2' then array['workArrangements'] else array[]::text[] end loop
        part:=case when k='sessions' then jsonb_build_object('limited',false,'items',source_basis->'sessions') else source_basis->'context'->k end;
        ref_items:='[]';
        for ref_item in select value from jsonb_array_elements(part->'items') loop
          if k in('sessions','unassociated') then
            item:=jsonb_build_object('startEventId',ref_item->'startEventId','lastEventId',ref_item->'lastEventId','lastSequence',ref_item->'lastSequence','effectOperationId',ref_item->'effect'->'operationId');
          elsif k='calendar' then item:=jsonb_build_object('entryId',ref_item->'entryId','operationId',ref_item->'operationId','revision',ref_item->'revision');
          elsif k='workArrangements' then
            item:=jsonb_build_object('requestId',ref_item->'requestId','operationId',ref_item->'history'->-1->'operationId','revision',ref_item->'revision');
          else
            item:=jsonb_build_object('requestId',ref_item->'requestId','operationId',ref_item->'operationId','revision',ref_item->'revision');
            if k='pendingCorrections' then item:=item||jsonb_build_object('kind',ref_item->'kind','startEventId',ref_item->'startEventId');end if;
          end if;
          ref_items:=ref_items||jsonb_build_array(item);
        end loop;
        refs:=refs||jsonb_build_object(k,case when k='sessions' then ref_items else jsonb_build_object('limited',part->'limited','items',ref_items) end);
      end loop;
      evidence:=jsonb_build_object('policy',source_result->'source'->>'policy','fingerprint',source_result->'fingerprint','observedAt',source_result->'readAt',
        'eligible',source_result->'eligible','blockers',source_result->'blockers','candidate',source_result->'candidate',
        'approval',nullif(source_result->'source'->'evaluation'->'approval','null'::jsonb)-'source','sessions',refs->'sessions','contextRefs',refs-'sessions',
        'evaluation',jsonb_build_object('state',source_result->'state','slot',jsonb_build_object('slotId',source_result->'slot'->'id','locationId',source_result->'slot'->'locationId',
          'timeZone',source_result->'slot'->'timeZone','startAt',source_result->'slot'->'startAt','endAt',source_result->'slot'->'endAt'),
          'posthoc',source_result->'source'->'evaluation'->'posthoc','observations',source_result->'source'->'evaluation'->'observations','leaveEdges',source_result->'leaveEdges'));
      if octet_length(convert_to(evidence::text,'UTF8'))>131072 then raise exception 'attendance_plan_exception_too_large';end if;
      if public.faolla_attendance_plan_exception_review_evidence_v1(evidence) is distinct from true then raise exception 'attendance_plan_exception_review_invalid';end if;
    elsif mode_name='note' then
      if latest.operation_id is null or p_command->>'decisionOperationId' is distinct from latest.operation_id::text then raise exception 'attendance_version_conflict';end if;
    else
      select * into entry_row from public.merchant_attendance_plan_exception_entries where merchant_id=site and operation_id=(p_command->>'decisionOperationId')::uuid;
      if entry_row.case_id is distinct from c.case_id or entry_row.kind is distinct from 'decision' then raise exception 'attendance_plan_exception_review_not_found';end if;
      perform public.faolla_attendance_plan_exception_review_entry_v1(entry_row);
      if exists(select 1 from public.merchant_attendance_plan_exception_reads where merchant_id=site and decision_operation_id=entry_row.operation_id) then
        raise exception 'attendance_operation_conflict';end if;
    end if;
    if mode_name<>'ack' then
      select count(*),coalesce(sum(octet_length(convert_to(x.command::text,'UTF8'))+coalesce(octet_length(convert_to(x.evidence::text,'UTF8')),0)),0)
        into n,bytes from public.merchant_attendance_plan_exception_entries x where x.merchant_id=site;
      if n>=5000 or bytes+octet_length(convert_to(p_command::text,'UTF8'))+coalesce(octet_length(convert_to(evidence::text,'UTF8')),0)>67108864 or head>=200 then
        raise exception 'attendance_plan_exception_review_limit';end if;
    end if;
    stamp:=clock_timestamp();
    if last_at is not null and stamp<last_at or source_result is not null and stamp<(source_result->>'readAt')::timestamptz then
      raise exception 'attendance_plan_exception_review_invalid';end if;
    if c.case_id is null then
      if mode_name<>'decide' then raise exception 'attendance_plan_exception_review_not_found';end if;
      select count(*) into n from public.merchant_attendance_plan_exception_cases where merchant_id=site;
      if n>=500 or (select count(*) from public.merchant_attendance_plan_exception_cases where merchant_id=site and worker_id=wid)>=100 then
        raise exception 'attendance_plan_exception_review_limit';end if;
      insert into public.merchant_attendance_plan_exception_cases(merchant_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id,worker_name,worker_no,slot_start_at,slot_end_at,time_zone,opened_at)
        values(site,op,wid,sid,current_employee,current_auth,w.display_name,w.worker_no,(source_result->'slot'->>'startAt')::timestamptz,
          (source_result->'slot'->>'endAt')::timestamptz,source_result->'slot'->>'timeZone',stamp) returning * into c;
    end if;
    if mode_name='ack' then
      if stamp<entry_row.recorded_at then raise exception 'attendance_plan_exception_review_invalid';end if;
      insert into public.merchant_attendance_plan_exception_reads(merchant_id,operation_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id,decision_operation_id,command,read_at)
        values(site,op,c.case_id,wid,sid,current_employee,current_auth,entry_row.operation_id,p_command,stamp) returning * into saved_read;
    else
      insert into public.merchant_attendance_plan_exception_entries(merchant_id,operation_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id,revision,actor_auth_user_id,kind,command,evidence,recorded_at)
        values(site,op,c.case_id,wid,sid,current_employee,current_auth,head+1,p_auth_user_id,case mode_name when 'decide' then 'decision' else 'note' end,p_command,
          case when mode_name='decide' then evidence else null end,stamp) returning * into saved;
      head:=head+1;
      if mode_name='decide' then latest:=saved;stale:=false;capture_new_decision:=p_capture_notifications;end if;
    end if;
  end if;
  if saved.operation_id is not null then receipt:=jsonb_build_object('operationId',saved.operation_id,'command',saved.command,'item',public.faolla_attendance_plan_exception_review_entry_v1(saved));end if;
  if saved_read.operation_id is not null then
    select * into entry_row from public.merchant_attendance_plan_exception_entries where merchant_id=site and operation_id=saved_read.decision_operation_id;
    if entry_row.case_id is distinct from saved_read.case_id or entry_row.kind is distinct from 'decision' or saved_read.read_at<entry_row.recorded_at
      or public.faolla_attendance_plan_exception_review_command_v1('ack',saved_read.command) is distinct from true
      or saved_read.command->>'operationId' is distinct from saved_read.operation_id::text
      or saved_read.command->>'decisionOperationId' is distinct from saved_read.decision_operation_id::text then raise exception 'attendance_plan_exception_review_invalid';end if;
    perform public.faolla_attendance_plan_exception_review_entry_v1(entry_row);
    read_receipt:=jsonb_build_object('operationId',saved_read.operation_id,'command',saved_read.command,'decisionOperationId',saved_read.decision_operation_id,
      'actorId',saved_read.employee_auth_user_id,'employeeId',saved_read.employee_id,'employeeAuthUserId',saved_read.employee_auth_user_id,
      'readAt',to_char(saved_read.read_at at time zone 'UTC',stamp_format));
  end if;
  if mode_name='list' then
    for c in select x.* from public.merchant_attendance_plan_exception_cases x where x.merchant_id=site and (wid is null and access_name='owner' or x.worker_id=wid)
      and (access_name='owner' or x.employee_id=current_employee and x.employee_auth_user_id=current_auth)
      and (cursor_at is null or (x.opened_at,x.case_id)<(cursor_at,cursor_id)) order by x.opened_at desc,x.case_id desc limit 26 for share loop
      row_count:=row_count+1;if row_count>25 then exit;end if;
      -- Owner discovery must not hand a historical case to a newly bound member.
      select * into w from public.merchant_attendance_workers where merchant_id=site and id=c.worker_id for share;
      select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;
      if w.employee_id is distinct from c.employee_id or e.auth_user_id is distinct from c.employee_auth_user_id then raise exception 'attendance_plan_exception_review_identity_changed';end if;
      select revision into head from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id order by revision desc limit 1;
      select * into latest from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id and kind='decision' order by revision desc limit 1;
      if head is null or latest.operation_id is null then raise exception 'attendance_plan_exception_review_invalid';end if;
      item:=public.faolla_attendance_plan_exception_review_entry_v1(latest);
      select * into read_row from public.merchant_attendance_plan_exception_reads where merchant_id=site and decision_operation_id=latest.operation_id;
      if read_row.operation_id is not null and (read_row.case_id<>c.case_id or read_row.employee_id<>c.employee_id or read_row.employee_auth_user_id<>c.employee_auth_user_id or read_row.read_at<latest.recorded_at) then raise exception 'attendance_plan_exception_review_invalid';end if;
      items:=items||jsonb_build_array(jsonb_build_object('caseId',c.case_id,'workerId',c.worker_id,'slotId',c.slot_id,'employeeId',c.employee_id,
        'employeeAuthUserId',c.employee_auth_user_id,'workerName',c.worker_name,'workerNo',c.worker_no,'slotStartAt',to_char(c.slot_start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'slotEndAt',to_char(c.slot_end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'timeZone',c.time_zone,'openedAt',to_char(c.opened_at at time zone 'UTC',stamp_format),'revision',head,
        'latestDecision',jsonb_build_object('operationId',latest.operation_id,'revision',latest.revision,'outcome',latest.command->'outcome','recordedAt',item->'recordedAt','readAt',to_char(read_row.read_at at time zone 'UTC',stamp_format))));
      next_cursor:=jsonb_build_object('at',to_char(c.opened_at at time zone 'UTC',stamp_format),'id',c.case_id);
    end loop;
    if row_count<=25 then next_cursor:=null;end if;
  else
    if latest.operation_id is not null then
      latest_item:=public.faolla_attendance_plan_exception_review_entry_v1(latest);
      select * into read_row from public.merchant_attendance_plan_exception_reads where merchant_id=site and decision_operation_id=latest.operation_id;
      if read_row.operation_id is not null and (read_row.case_id<>c.case_id or read_row.employee_id<>c.employee_id or read_row.employee_auth_user_id<>c.employee_auth_user_id or read_row.read_at<latest.recorded_at) then raise exception 'attendance_plan_exception_review_invalid';end if;
      latest_item:=latest_item||jsonb_build_object('readAt',to_char(read_row.read_at at time zone 'UTC',stamp_format));
      for entry_row in select * from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id order by revision desc limit 26 loop
        row_count:=row_count+1;if row_count>25 then history_truncated:=true;exit;end if;
        history:=history||jsonb_build_array(public.faolla_attendance_plan_exception_review_entry_v1(entry_row)-'evidence');
      end loop;
    end if;
    worker_item:=jsonb_build_object('workerId',w.id,'workerName',w.display_name,'workerNo',w.worker_no,'employeeId',w.employee_id,
      'employeeAuthUserId',e.auth_user_id,'version',w.version,'active',w.active,'employeeActive',e.status='active');
    detail:=jsonb_build_object('caseId',c.case_id,'openedAt',to_char(c.opened_at at time zone 'UTC',stamp_format),'worker',worker_item,'slotId',sid,'revision',head,
      'current',current_item,'currentValidation',case when checked then 'checked' else 'not_checked' end,'stale',case when checked then stale else null end,
      'latestDecision',latest_item,'history',history,'historyTruncated',history_truncated,
      'canDecide',access_name='owner' and checked and p_allow_write and p_allow_posthoc and s.enabled and w.active and e.status='active' and p_auth_user_id<>current_auth,
      'canNote',access_name='self' and latest.operation_id is not null and p_allow_write and s.enabled and w.active);
  end if;
  read_at:=clock_timestamp();
  if source_result is not null and read_at<(source_result->>'readAt')::timestamptz
    or saved.operation_id is not null and read_at<saved.recorded_at or saved_read.operation_id is not null and read_at<saved_read.read_at then
    raise exception 'attendance_plan_exception_review_invalid';end if;
  result:=jsonb_build_object('protocol','plan-exception-review-v1','siteId',site,'access',access_name,'actorId',p_auth_user_id,
    'employeeId',case when access_name='self' then current_employee else null end,'readAt',to_char(read_at at time zone 'UTC',stamp_format),
    'items',items,'nextCursor',next_cursor,'detail',detail,'receipt',receipt,'readReceipt',read_receipt);
  if octet_length(convert_to(result::text,'UTF8'))>1048576 then raise exception 'attendance_plan_exception_too_large';end if;
  --Set only by the actual new decision INSERT. Reads and exact retries never
  --infer freshness from a missing notification, even after rollout changes.
  if capture_new_decision then
    perform public.faolla_attendance_event_notification_capture_v1(site,'plan_exception',op,p_auth_user_id,p_command);
  end if;
  return result;
end;
$$;
--END GENERATED DELEGATED PLAN EXCEPTIONS CORES

create or replace function public.faolla_attendance_delegated_plan_exceptions_scope_v1(g public.merchant_attendance_management_delegations,r jsonb)
returns void language plpgsql set search_path=pg_catalog as $$
declare sample jsonb;node jsonb;node_depth integer;count_nodes integer:=0;count_sources integer:=0;reference uuid;event_key text;
begin
 if r->>'protocol' is distinct from 'plan-exception-review-v1' or r->>'siteId' is distinct from g.merchant_id
  or r->>'access' is distinct from 'owner' or r->>'actorId' is distinct from g.delegate_auth_user_id::text
  or r->'detail'->'worker'->>'workerId' is distinct from g.worker_id::text
  or r->'detail'->'worker'->>'employeeId' is distinct from g.employee_id::text
  or r->'detail'->'worker'->>'employeeAuthUserId' is distinct from g.employee_auth_user_id::text
  or r->'detail'->>'currentValidation' is distinct from 'checked' or r->'detail'->'current' is null
  or r->'detail'->'current'->>'actorId' is distinct from g.delegate_auth_user_id::text
  then raise exception 'attendance_management_delegation_scope_invalid';end if;
 --Do not redact a canonical source or pass unchecked caller JSON. This guard
 --sees only actual SQL-collected current facts plus immutable saved evidence.
 for sample in select r->'detail'->'current' union all select actual.evidence from public.merchant_attendance_plan_exception_entries actual
  where actual.merchant_id=g.merchant_id and actual.case_id=(r->'detail'->>'caseId')::uuid and actual.kind='decision' order by 1 loop
  count_sources:=count_sources+1;if count_sources>201 then raise exception 'attendance_delegated_plan_exceptions_invalid';end if;
  if octet_length(sample::text)>2097152 then raise exception 'attendance_delegated_plan_exceptions_invalid';end if;
  for node,node_depth in with recursive nodes(value,depth) as (
    select sample,0 union all select child.value,parent.depth+1 from nodes parent cross join lateral (
     select value from jsonb_each(case when jsonb_typeof(parent.value)='object' then parent.value else '{}'::jsonb end)
     union all select value from jsonb_array_elements(case when jsonb_typeof(parent.value)='array' then parent.value else '[]'::jsonb end)) child
     where parent.depth<65) select value,depth from nodes loop
   count_nodes:=count_nodes+1;if count_nodes>50000 or node_depth>64 then raise exception 'attendance_delegated_plan_exceptions_invalid';end if;
   if jsonb_typeof(node)='object' and node ? 'locationId' and node->'locationId'<>'null'::jsonb then
    if public.faolla_attendance_shift_rule_binding_scalar_v1(node->'locationId','uuid') is distinct from true
     or not(g.scope->'locationIds' @> jsonb_build_array(node->>'locationId'))
     or not exists(select 1 from public.merchant_attendance_locations actual where actual.merchant_id=g.merchant_id and actual.id=(node->>'locationId')::uuid)
     then raise exception 'attendance_management_delegation_scope_invalid';end if;
   end if;
   foreach event_key in array array['startEventId','lastEventId','endEventId'] loop
   if jsonb_typeof(node)='object' and node ? event_key and node->event_key<>'null'::jsonb then
    if public.faolla_attendance_shift_rule_binding_scalar_v1(node->event_key,'uuid') is distinct from true then raise exception 'attendance_management_delegation_scope_invalid';end if;
    reference:=(node->>event_key)::uuid;
    if not exists(select 1 from public.merchant_attendance_events actual where actual.merchant_id=g.merchant_id and actual.id=reference
     and actual.worker_id=g.worker_id and actual.actor_employee_id=g.employee_id and g.scope->'locationIds' @> jsonb_build_array(actual.location_id::text))
     then raise exception 'attendance_management_delegation_scope_invalid';end if;
   end if;
   end loop;
  end loop;
 end loop;
end;
$$;
create or replace function public.faolla_attendance_delegated_plan_exceptions_business_v1(site text,op uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare d public.merchant_attendance_plan_exception_entries%rowtype;c public.merchant_attendance_plan_exception_cases%rowtype;
 item jsonb;fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
 select * into d from public.merchant_attendance_plan_exception_entries actual where actual.merchant_id=site and actual.operation_id=op;
 if d.operation_id is null then return null;end if;
 select * into c from public.merchant_attendance_plan_exception_cases actual where actual.merchant_id=site and actual.case_id=d.case_id;
 perform public.faolla_attendance_delegated_plan_exceptions_command_v1(d.command);
 item:=public.faolla_attendance_plan_exception_review_entry_v1(d);
 if d.kind is distinct from 'decision' or d.actor_auth_user_id=d.employee_auth_user_id or c.case_id is null
  or row(d.worker_id,d.slot_id,d.employee_id,d.employee_auth_user_id) is distinct from row(c.worker_id,c.slot_id,c.employee_id,c.employee_auth_user_id)
  or item->>'actorId' is distinct from d.actor_auth_user_id::text or item->>'operationId' is distinct from op::text
  then raise exception 'attendance_delegated_plan_exceptions_invalid';end if;
 return jsonb_build_object('decision',to_jsonb(d)||jsonb_build_object('recorded_at',to_char(d.recorded_at at time zone 'UTC',fmt)),
  'case',to_jsonb(c)||jsonb_build_object('slot_start_at',to_char(c.slot_start_at at time zone 'UTC',fmt),
   'slot_end_at',to_char(c.slot_end_at at time zone 'UTC',fmt),'opened_at',to_char(c.opened_at at time zone 'UTC',fmt)));
end;
$$;
create or replace function public.faolla_attendance_delegated_plan_exceptions_operation_v1(p public.merchant_attendance_management_delegation_operations,require_current boolean)
returns void language plpgsql set search_path=pg_catalog as $$
declare g public.merchant_attendance_management_delegations%rowtype;b jsonb;c jsonb;wid uuid;sid uuid;
begin
 select * into g from public.merchant_attendance_management_delegations actual where actual.merchant_id=p.merchant_id and actual.grant_id=p.grant_id;
 b:=public.faolla_attendance_delegated_plan_exceptions_business_v1(p.merchant_id,p.operation_id);c:=b->'decision'->'command';
 wid:=(b->'decision'->>'worker_id')::uuid;sid:=(b->'decision'->>'slot_id')::uuid;
 if require_current is null or g.grant_id is null or b is null or g.delegated_action is distinct from 'plan_exception_decide'
  or g.scope->>'kind' is distinct from 'formal_exception' or g.employee_id=g.delegate_employee_id or g.employee_auth_user_id=p.actor_auth_user_id
  or g.command_fingerprint is distinct from public.faolla_attendance_management_hash_v1(p.merchant_id,g.actor_auth_user_id,g.command)
  then raise exception 'attendance_delegated_plan_exceptions_invalid';end if;
 perform public.faolla_attendance_delegated_plan_exceptions_target_v1(g,wid,sid);
 if row(p.actor_auth_user_id,p.delegate_employee_id,p.delegate_generation,p.delegated_action,p.business_operation_id,p.business_reference_id,p.business_revision,p.recorded_at)
  is distinct from row(g.delegate_auth_user_id,g.delegate_employee_id,g.delegate_generation,'plan_exception_decide',p.operation_id,sid,(b->'decision'->>'revision')::bigint,(b->'decision'->>'recorded_at')::timestamptz)
  or row(b->'decision'->>'actor_auth_user_id',b->'decision'->>'employee_id',b->'decision'->>'employee_auth_user_id')
  is distinct from row(p.actor_auth_user_id::text,g.employee_id::text,g.employee_auth_user_id::text)
  or p.recorded_at<g.recorded_at or p.recorded_at<g.valid_from or p.recorded_at>=g.valid_until or not isfinite(p.recorded_at)
  or p.command_fingerprint is distinct from public.faolla_attendance_delegated_plan_exceptions_hash_v1(p.merchant_id,p.actor_auth_user_id,p.grant_id,wid,sid,c)
  or p.business_fingerprint is distinct from public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-delegated-plan-exceptions-business-v1',b))
  or exists(select 1 from public.merchant_attendance_management_delegations actual where actual.merchant_id=p.merchant_id and actual.grant_id=p.operation_id)
  or exists(select 1 from public.merchant_attendance_management_delegation_revocations actual where actual.merchant_id=p.merchant_id and actual.operation_id=p.operation_id)
  then raise exception 'attendance_delegated_plan_exceptions_invalid';end if;
 if require_current then perform public.faolla_attendance_delegated_plan_exceptions_authorize_v1(p.merchant_id,p.actor_auth_user_id,p.grant_id);end if;
end;
$$;
create or replace function public.faolla_attendance_delegated_plan_exceptions_authority_v1(p public.merchant_attendance_management_delegation_operations)
returns void language plpgsql set search_path=pg_catalog as $$
begin perform public.faolla_attendance_delegated_plan_exceptions_operation_v1(p,true);end;
$$;
create or replace function public.faolla_attendance_delegated_plan_exceptions_receipt_v1(site text,actor uuid,id uuid,op uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare p public.merchant_attendance_management_delegation_operations%rowtype;g public.merchant_attendance_management_delegations%rowtype;b jsonb;
begin
 select * into p from public.merchant_attendance_management_delegation_operations actual where actual.merchant_id=site and actual.operation_id=op;
 if p.operation_id is null then return null;end if;
 if p.actor_auth_user_id is distinct from actor then raise exception 'attendance_access_denied';end if;
 if p.grant_id is distinct from id or p.delegated_action is distinct from 'plan_exception_decide' then raise exception 'attendance_operation_conflict';end if;
 --Minimal receipt still belongs to the same real Auth binding. Disable,
 --revocation, epoch and rollout changes do not erase that original receipt;
 --reassigning the employee to another Auth identity must not disclose it.
 perform 1 from public.merchant_enterprise_employees actual where actual.merchant_id=site
  and actual.id=p.delegate_employee_id and actual.auth_user_id=actor for share;
 if not found then raise exception 'attendance_access_denied';end if;
 perform public.faolla_attendance_delegated_plan_exceptions_operation_v1(p,false);
 select * into g from public.merchant_attendance_management_delegations actual where actual.merchant_id=site and actual.grant_id=id;
 b:=public.faolla_attendance_delegated_plan_exceptions_business_v1(site,op);
 return jsonb_build_object('operationId',op,'actorId',actor,'grantId',id,'action',p.delegated_action,
  'reference',jsonb_build_object('kind','formal_exception','workerId',g.worker_id,'slotId',p.business_reference_id,
   'employeeId',g.employee_id,'employeeAuthUserId',g.employee_auth_user_id,'caseId',b->'decision'->'case_id','decisionRevision',p.business_revision),
  'commandFingerprint',p.command_fingerprint,'businessFingerprint',p.business_fingerprint,'recordedAt',to_char(p.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end;
$$;
create or replace function public.faolla_attendance_delegated_plan_exceptions_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false,p_allow_posthoc boolean default false,p_allow_clearance boolean default false,p_capture_notifications boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;id uuid;wid uuid;sid uuid;op uuid;mode_name text;g public.merchant_attendance_management_delegations%rowtype;
 p public.merchant_attendance_management_delegation_operations%rowtype;receipt jsonb;r jsonb;b jsonb;fp text;result jsonb;stamp timestamptz;started_at timestamptz;pass integer;
 old_query jsonb;current_source jsonb;can_decide boolean;can_conclude boolean;can_clear boolean;can_not_applicable boolean;
begin
 if p_auth_user_id is null or p_allow_write is null or p_allow_posthoc is null or p_allow_clearance is null or p_capture_notifications is null
  or jsonb_typeof(p_query) is distinct from 'object' or octet_length(p_query::text)>4096
  or jsonb_typeof(p_query->'siteId') is distinct from 'string' or p_query->>'siteId' !~ '^[0-9]{8}$'
  or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'grantId','uuid') is distinct from true
  or jsonb_typeof(p_query->'mode') is distinct from 'string' then raise exception 'attendance_invalid_request';end if;
 site:=p_query->>'siteId';id:=(p_query->>'grantId')::uuid;mode_name:=p_query->>'mode';
 if mode_name='recover' then
  if p_command is not null or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','grantId','mode','operationId']) is distinct from true
   or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'operationId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  op:=(p_query->>'operationId')::uuid;
  return jsonb_build_object('protocol','attendance-delegated-plan-exceptions-v1','siteId',site,'actorId',p_auth_user_id,
   'readAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'kind','receipt','receipt',public.faolla_attendance_delegated_plan_exceptions_receipt_v1(site,p_auth_user_id,id,op));
 end if;
 if mode_name is distinct from 'context' or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','grantId','mode','workerId','slotId']) is distinct from true
  or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'workerId','uuid') is distinct from true
  or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'slotId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
 wid:=(p_query->>'workerId')::uuid;sid:=(p_query->>'slotId')::uuid;
 if p_command is not null then
  perform public.faolla_attendance_delegated_plan_exceptions_command_v1(p_command);op:=(p_command->>'operationId')::uuid;
  fp:=public.faolla_attendance_delegated_plan_exceptions_hash_v1(site,p_auth_user_id,id,wid,sid,p_command);
 end if;
 --Complete original POST before and after the settings wait. No current
 --qualification, source, rollout flag, notification inference or new write.
 for pass in 1..2 loop
  if p_command is not null then
   select * into p from public.merchant_attendance_management_delegation_operations actual where actual.merchant_id=site and actual.operation_id=op;
   if p.operation_id is not null then
    b:=public.faolla_attendance_delegated_plan_exceptions_business_v1(site,op);
    if row(p.actor_auth_user_id,p.grant_id,p.command_fingerprint) is distinct from row(p_auth_user_id,id,fp)
     or b->'decision'->'command' is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
    receipt:=public.faolla_attendance_delegated_plan_exceptions_receipt_v1(site,p_auth_user_id,id,op);
    return jsonb_build_object('protocol','attendance-delegated-plan-exceptions-v1','siteId',site,'actorId',p_auth_user_id,
     'readAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'kind','receipt','receipt',receipt);
   end if;
  end if;
  exit when pass=2;
  perform 1 from public.merchants actual where actual.id=site for share;if not found then raise exception 'attendance_access_denied';end if;
  perform 1 from public.merchant_attendance_settings actual where actual.merchant_id=site for update;if not found then raise exception 'attendance_settings_required';end if;
 end loop;
 g:=public.faolla_attendance_delegated_plan_exceptions_authorize_v1(site,p_auth_user_id,id);
 if p_allow_write is distinct from true then raise exception 'attendance_delegated_plan_exceptions_disabled';end if;
 perform public.faolla_attendance_delegated_plan_exceptions_target_v1(g,wid,sid);
 old_query:=jsonb_build_object('siteId',site,'access','owner','mode',case when p_command is null then 'detail' else 'decide' end,
  'workerId',wid,'slotId',sid,'operationId',op,'beforeAt',null,'beforeId',null);
 if p_command is null then
  r:=public.faolla_attendance_delegated_plan_exceptions_posthoc_core_v1(old_query,p_auth_user_id,null,p_allow_write,p_allow_posthoc,p_allow_clearance,p_capture_notifications,id);
  perform public.faolla_attendance_delegated_plan_exceptions_scope_v1(g,r);
  if r->'receipt' is distinct from 'null'::jsonb or r->'readReceipt' is distinct from 'null'::jsonb or r->'items' is distinct from '[]'::jsonb then raise exception 'attendance_delegated_plan_exceptions_invalid';end if;
  current_source:=r->'detail'->'current';can_decide:=(r->'detail'->>'canDecide')::boolean;
  can_conclude:=can_decide and current_source->>'eligible'='true' and (current_source->'candidate'->'late'->>'state'='triggered' or current_source->'candidate'->'early'->>'state'='triggered');
  can_clear:=can_decide and p_allow_clearance and r->'detail'->>'caseId' is not null and (r->'detail'->>'revision')::bigint>=1
   and current_source->>'eligible'='true' and current_source->'candidate'->'late'->>'state'='not_triggered' and current_source->'candidate'->'early'->>'state'='not_triggered';
  can_not_applicable:=can_decide and p_allow_posthoc and r->'detail'->>'caseId' is not null and (r->'detail'->>'revision')::bigint>=1
   and current_source->>'state'='not_applicable' and current_source->>'eligible'='true' and current_source->'blockers'='[]'::jsonb
   and current_source->'leaveEdges'->>'fullCoverage'='true' and current_source->'leaveEdges'->>'unknown'='false'
   and current_source->'leaveEdges'->>'state'='not_applicable' and current_source->'leaveEdges'->'work'='[]'::jsonb
   and current_source->'leaveEdges'->'workLeaveOverlaps'='[]'::jsonb
   and current_source->'candidate'->'late'->>'state'='blocked' and current_source->'candidate'->'early'->>'state'='blocked'
   and current_source->'candidate'->'original'->'startAt'='null'::jsonb and current_source->'candidate'->'original'->'endAt'='null'::jsonb
   and current_source->'candidate'->'selected'->'startAt'='null'::jsonb and current_source->'candidate'->'selected'->'endAt'='null'::jsonb;
  result:=jsonb_build_object('protocol','attendance-delegated-plan-exceptions-v1','siteId',site,'actorId',p_auth_user_id,
   'readAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'kind','context','grantId',id,'action',g.delegated_action,'scope',g.scope,
   'context',jsonb_build_object('review',r,'canDecide',can_decide,'canConclude',coalesce(can_conclude,false),'canClear',coalesce(can_clear,false),'canNotApplicable',coalesce(can_not_applicable,false)));
 else
  --Never adopt a legacy decision/read or another ledger's original number.
  if exists(select 1 from public.merchant_attendance_plan_exception_entries actual where actual.merchant_id=site and actual.operation_id=op)
   or exists(select 1 from public.merchant_attendance_plan_exception_reads actual where actual.merchant_id=site and actual.operation_id=op)
   or exists(select 1 from public.merchant_attendance_management_delegations actual where actual.merchant_id=site and actual.grant_id=op)
   or exists(select 1 from public.merchant_attendance_management_delegation_revocations actual where actual.merchant_id=site and actual.operation_id=op)
   then raise exception 'attendance_operation_conflict';end if;
  started_at:=clock_timestamp();
  r:=public.faolla_attendance_delegated_plan_exceptions_posthoc_core_v1(old_query,p_auth_user_id,p_command,p_allow_write,p_allow_posthoc,p_allow_clearance,p_capture_notifications,id);
  perform public.faolla_attendance_delegated_plan_exceptions_scope_v1(g,r);
  b:=public.faolla_attendance_delegated_plan_exceptions_business_v1(site,op);stamp:=(b->'decision'->>'recorded_at')::timestamptz;
  if b is null or r->'receipt'->>'operationId' is distinct from op::text or r->'receipt'->'command' is distinct from p_command or stamp<started_at
   then raise exception 'attendance_delegated_plan_exceptions_invalid';end if;
  insert into public.merchant_attendance_management_delegation_operations(merchant_id,operation_id,grant_id,actor_auth_user_id,delegate_employee_id,delegate_generation,delegated_action,
   business_operation_id,business_reference_id,business_revision,command_fingerprint,business_fingerprint,recorded_at)
  values(site,op,id,p_auth_user_id,g.delegate_employee_id,g.delegate_generation,'plan_exception_decide',op,sid,(b->'decision'->>'revision')::bigint,fp,
   public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-delegated-plan-exceptions-business-v1',b)),stamp);
  receipt:=public.faolla_attendance_delegated_plan_exceptions_receipt_v1(site,p_auth_user_id,id,op);
  result:=jsonb_build_object('protocol','attendance-delegated-plan-exceptions-v1','siteId',site,'actorId',p_auth_user_id,
   'readAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'kind','receipt','receipt',receipt);
 end if;
 if octet_length(convert_to(result::text,'UTF8'))>524288 then raise exception 'attendance_delegated_plan_exceptions_invalid';end if;
 return result;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end;
$$;
--BEGIN GENERATED DELEGATED PLAN EXCEPTIONS FORWARD
do $exceptions209_forward_0$ declare old_body text;definition text;begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610090209 and name='merchant_attendance_delegated_plan_exceptions') then return;end if;
 select replace(proc.prosrc,E'\r\n',E'\n'),pg_get_functiondef(proc.oid) into old_body,definition from pg_proc proc where proc.oid='public.faolla_attendance_plan_exception_clearance_execute_v1(jsonb,uuid,jsonb,boolean,boolean,boolean)'::regprocedure;
 if old_body is distinct from $exceptions209_old_0$
declare site text;access_name text;mode_name text;wid uuid;sid uuid;op uuid;cursor_at timestamptz;cursor_id uuid;
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
  r public.merchant_enterprise_roles%rowtype;c public.merchant_attendance_plan_exception_cases%rowtype;
  entry_row public.merchant_attendance_plan_exception_entries%rowtype;saved public.merchant_attendance_plan_exception_entries%rowtype;
  latest public.merchant_attendance_plan_exception_entries%rowtype;read_row public.merchant_attendance_plan_exception_reads%rowtype;
  saved_read public.merchant_attendance_plan_exception_reads%rowtype;
  source_result jsonb:=null;current_item jsonb:=null;evidence jsonb;refs jsonb;part jsonb;ref_item jsonb;ref_items jsonb;k text;
  worker_item jsonb;items jsonb:='[]';history jsonb:='[]';detail jsonb:=null;receipt jsonb:=null;read_receipt jsonb:=null;
  latest_item jsonb:=null;item jsonb;next_cursor jsonb:=null;result jsonb;head bigint:=0;row_count integer:=0;
  history_truncated boolean:=false;checked boolean:=false;stale boolean:=null;stamp timestamptz;last_at timestamptz;read_at timestamptz;
  n bigint;bytes bigint;current_employee uuid;current_auth uuid;capture_new_decision boolean:=false;
  stamp_format constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_auth_user_id is null or p_allow_write is null or p_allow_clearance is null or p_capture_notifications is null
    or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','access','mode','workerId','slotId','operationId','beforeAt','beforeId']) is distinct from true
    or octet_length(convert_to(p_query::text,'UTF8'))>4096 or jsonb_typeof(p_query->'siteId')<>'string'
    or char_length(p_query->>'siteId')<>8 or p_query->>'siteId'!~'^[0-9]{8}$' or jsonb_typeof(p_query->'access')<>'string' or p_query->>'access' not in('owner','self')
    or jsonb_typeof(p_query->'mode')<>'string' or p_query->>'mode' not in('list','detail','recover','decide','note','ack') then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';access_name:=p_query->>'access';mode_name:=p_query->>'mode';
  foreach k in array array['workerId','slotId','operationId','beforeId'] loop
    if p_query->k<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->k,'uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  end loop;
  if p_query->'beforeAt'<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'beforeAt','stamp6') is distinct from true then raise exception 'attendance_invalid_request';end if;
  wid:=(p_query->>'workerId')::uuid;sid:=(p_query->>'slotId')::uuid;op:=(p_query->>'operationId')::uuid;
  cursor_at:=(p_query->>'beforeAt')::timestamptz;cursor_id:=(p_query->>'beforeId')::uuid;
  if mode_name='list' then
    if sid is not null or op is not null or p_command is not null or (cursor_at is null)<>(cursor_id is null) then raise exception 'attendance_invalid_request';end if;
  else
    if wid is null or sid is null or cursor_at is not null or cursor_id is not null
      or (mode_name='detail')<>(op is null) then raise exception 'attendance_invalid_request';end if;
    if mode_name in('detail','recover') then
      if p_command is not null then raise exception 'attendance_invalid_request';end if;
    elsif public.faolla_attendance_plan_exception_review_command_v1(mode_name,p_command) is distinct from true
      or p_command->>'operationId' is distinct from op::text then raise exception 'attendance_invalid_request';end if;
  end if;
  if mode_name='decide' and access_name<>'owner' or mode_name in('note','ack') and access_name<>'self' then raise exception 'attendance_access_denied';end if;
  perform 1 from public.merchants where id=site and (access_name='self' or user_id=p_auth_user_id) for share;
  if not found then raise exception 'attendance_access_denied';end if;
  select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  if not found then raise exception 'attendance_settings_required';end if;
  if access_name='self' then
    -- Resolve the employee ID without locking, then follow the shared
    -- merchant/settings -> worker -> employee -> role order. The locked
    -- reread below rechecks the same authenticated binding after any wait.
    select id into current_employee from public.merchant_enterprise_employees where merchant_id=site and auth_user_id=p_auth_user_id;
    if current_employee is null then raise exception 'attendance_access_denied';end if;
    select * into w from public.merchant_attendance_workers where merchant_id=site and employee_id=current_employee for share;
    select * into e from public.merchant_enterprise_employees where merchant_id=site and id=current_employee and auth_user_id=p_auth_user_id for share;
    if not found or e.status<>'active' then raise exception 'attendance_access_denied';end if;
    select * into r from public.merchant_enterprise_roles where merchant_id=site and id=e.role_id for share;
    if not found or r.status<>'active' or public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions) is distinct from true
      or not('attendance.self.view'=any(r.permissions)) then raise exception 'attendance_access_denied';end if;
    if w.id is not null and w.employee_id is distinct from e.id then raise exception 'attendance_plan_exception_review_identity_changed';end if;
    if wid is not null and w.id is distinct from wid then raise exception 'attendance_plan_exception_review_identity_changed';end if;
    wid:=w.id;current_employee:=e.id;current_auth:=e.auth_user_id;
  elsif wid is not null then
    select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for share;
    if not found then raise exception 'attendance_worker_not_found';end if;
    if w.employee_id is not null then select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;end if;
    if e.id is null or e.auth_user_id is null then raise exception 'attendance_plan_exception_review_identity_changed';end if;
    current_employee:=e.id;current_auth:=e.auth_user_id;
  end if;
  -- New namespace serializes operation IDs across entries/reads, first-case
  -- creation and finite quotas. No old row receives UPDATE or lock upgrade.
  if p_command is not null then perform pg_advisory_xact_lock(hashtextextended('faolla:attendance-plan-exception-review:v1:'||site,0));end if;
  if mode_name<>'list' then
    if p_command is null then
      select * into c from public.merchant_attendance_plan_exception_cases where merchant_id=site and slot_id=sid for share;
    else
      select * into c from public.merchant_attendance_plan_exception_cases where merchant_id=site and slot_id=sid for update;
    end if;
    if c.case_id is not null then
      if c.worker_id is distinct from wid or c.employee_id is distinct from current_employee or c.employee_auth_user_id is distinct from current_auth then
        raise exception 'attendance_plan_exception_review_identity_changed';end if;
    elsif access_name='self' then raise exception 'attendance_plan_exception_review_not_found';end if;
  end if;
  -- Exact original receipts are read before pause, current-source collection,
  -- eligibility or quota. Current authorization and dual identity always apply.
  if op is not null then
    select * into saved from public.merchant_attendance_plan_exception_entries where merchant_id=site and operation_id=op;
    select * into saved_read from public.merchant_attendance_plan_exception_reads where merchant_id=site and operation_id=op;
    if saved.operation_id is not null and saved_read.operation_id is not null then raise exception 'attendance_plan_exception_review_invalid';end if;
    -- A concurrent first decision can commit between the earlier case lookup
    -- and this immutable receipt lookup. Re-pin the case after finding it.
    if c.case_id is null and (saved.operation_id is not null or saved_read.operation_id is not null) then
      select * into c from public.merchant_attendance_plan_exception_cases where merchant_id=site and case_id=coalesce(saved.case_id,saved_read.case_id) for share;
      if c.worker_id is distinct from wid or c.slot_id is distinct from sid or c.employee_id is distinct from current_employee
        or c.employee_auth_user_id is distinct from current_auth then raise exception 'attendance_plan_exception_review_identity_changed';end if;
    end if;
    if saved.operation_id is not null then
      if saved.actor_auth_user_id<>p_auth_user_id or saved.worker_id<>wid or saved.slot_id<>sid or saved.case_id is distinct from c.case_id
        or (saved.kind='decision')<>(access_name='owner') then raise exception 'attendance_access_denied';end if;
      if saved.employee_id<>current_employee or saved.employee_auth_user_id<>current_auth then raise exception 'attendance_plan_exception_review_identity_changed';end if;
      if p_command is not null and (saved.command is distinct from p_command or mode_name<>case saved.kind when 'decision' then 'decide' else 'note' end) then
        raise exception 'attendance_operation_conflict';end if;
    elsif saved_read.operation_id is not null then
      if access_name<>'self' or saved_read.employee_auth_user_id<>p_auth_user_id or saved_read.worker_id<>wid or saved_read.slot_id<>sid
        or saved_read.case_id is distinct from c.case_id then raise exception 'attendance_access_denied';end if;
      if saved_read.employee_id<>current_employee or saved_read.employee_auth_user_id<>current_auth then raise exception 'attendance_plan_exception_review_identity_changed';end if;
      if p_command is not null and (mode_name<>'ack' or saved_read.command is distinct from p_command) then raise exception 'attendance_operation_conflict';end if;
    end if;
  end if;
  if c.case_id is not null then
    select revision,recorded_at into head,last_at from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id order by revision desc limit 1;
    if head is null then raise exception 'attendance_plan_exception_review_invalid';end if;
    select * into latest from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id and kind='decision' order by revision desc limit 1;
    if latest.operation_id is null then raise exception 'attendance_plan_exception_review_invalid';end if;
  end if;
  if p_command is not null and saved.operation_id is null and saved_read.operation_id is null then
    if not p_allow_write or not s.enabled then raise exception 'attendance_platform_paused';end if;
    if access_name='self' and not w.active then raise exception 'attendance_access_denied';end if;
    --Only the explicit new RPC can authorize a fresh clearance. This is after
    --locked original-receipt resolution, before current-source collection.
    if mode_name='decide' and p_command->>'outcome'='cleared' then
      if not p_allow_clearance then raise exception 'attendance_plan_exception_clearance_disabled';end if;
      if c.case_id is null or head<1 or (p_command->>'expectedRevision')::bigint<1 then
        raise exception 'attendance_plan_exception_review_blocked';end if;
    end if;
    if mode_name<>'ack' and (p_command->>'expectedRevision')::bigint<>head then raise exception 'attendance_version_conflict';end if;
    if mode_name='decide' and (p_command->>'employeeId' is distinct from current_employee::text
      or p_command->>'employeeAuthUserId' is distinct from current_auth::text) then raise exception 'attendance_plan_exception_review_identity_changed';end if;
    if mode_name='decide' and p_auth_user_id=current_auth then raise exception 'attendance_access_denied';end if;
  end if;
  if access_name='owner' and (mode_name='detail' or mode_name='decide' and saved.operation_id is null) then
    source_result:=public.faolla_attendance_plan_exception_source_v1(jsonb_build_object('siteId',site,'workerId',wid,'slotId',sid),p_auth_user_id);
    if source_result->>'siteId' is distinct from site or source_result->>'actorId' is distinct from p_auth_user_id::text
      or source_result->'worker'->>'workerId' is distinct from wid::text or source_result->'worker'->>'employeeId' is distinct from current_employee::text
      or source_result->'worker'->>'employeeAuthUserId' is distinct from current_auth::text or source_result->'slot'->>'id' is distinct from sid::text
      or source_result->>'sourceText' is distinct from (source_result->'source')::text
      or source_result->>'fingerprint' is distinct from encode(sha256(convert_to(source_result->>'sourceText','UTF8')),'hex') then
      raise exception 'attendance_plan_exception_review_invalid';end if;
    current_item:=source_result-'sourceText';checked:=true;
    if latest.operation_id is not null then stale:=latest.evidence->>'fingerprint' is distinct from source_result->>'fingerprint';end if;
  end if;
  if p_command is not null and saved.operation_id is null and saved_read.operation_id is null then
    if mode_name='decide' then
      if source_result->>'fingerprint' is distinct from p_command->>'expectedFingerprint' then raise exception 'attendance_plan_exception_review_source_changed';end if;
      if p_command->>'outcome' in('confirmed','excused') and (source_result->>'eligible' is distinct from 'true'
        or not(source_result->'candidate'->'late'->>'state'='triggered' or source_result->'candidate'->'early'->>'state'='triggered')) then
        raise exception 'attendance_plan_exception_review_blocked';end if;
      if p_command->>'outcome'='cleared' and (source_result->>'eligible' is distinct from 'true'
        or source_result->'candidate'->'late'->>'state' is distinct from 'not_triggered'
        or source_result->'candidate'->'early'->>'state' is distinct from 'not_triggered') then
        raise exception 'attendance_plan_exception_review_blocked';end if;
      refs:='{}';
      foreach k in array array['sessions','unassociated','leave','calendar','missing','pendingCorrections']||case when source_result->'source'->>'policy'='owner-confirmed-plan-edges-work-v2' then array['workArrangements'] else array[]::text[] end loop
        part:=case when k='sessions' then jsonb_build_object('limited',false,'items',source_result->'source'->'sessions') else source_result->'source'->'context'->k end;
        ref_items:='[]';
        for ref_item in select value from jsonb_array_elements(part->'items') loop
          if k in('sessions','unassociated') then
            item:=jsonb_build_object('startEventId',ref_item->'startEventId','lastEventId',ref_item->'lastEventId','lastSequence',ref_item->'lastSequence','effectOperationId',ref_item->'effect'->'operationId');
          elsif k='calendar' then item:=jsonb_build_object('entryId',ref_item->'entryId','operationId',ref_item->'operationId','revision',ref_item->'revision');
          elsif k='workArrangements' then
            item:=jsonb_build_object('requestId',ref_item->'requestId','operationId',ref_item->'history'->-1->'operationId','revision',ref_item->'revision');
          else
            item:=jsonb_build_object('requestId',ref_item->'requestId','operationId',ref_item->'operationId','revision',ref_item->'revision');
            if k='pendingCorrections' then item:=item||jsonb_build_object('kind',ref_item->'kind','startEventId',ref_item->'startEventId');end if;
          end if;
          ref_items:=ref_items||jsonb_build_array(item);
        end loop;
        refs:=refs||jsonb_build_object(k,case when k='sessions' then ref_items else jsonb_build_object('limited',part->'limited','items',ref_items) end);
      end loop;
      evidence:=jsonb_build_object('policy',source_result->'source'->>'policy','fingerprint',source_result->'fingerprint','observedAt',source_result->'readAt',
        'eligible',source_result->'eligible','blockers',source_result->'blockers','candidate',source_result->'candidate',
        'approval',nullif(source_result->'source'->'approval','null'::jsonb)-'source','sessions',refs->'sessions','contextRefs',refs-'sessions');
      if octet_length(convert_to(evidence::text,'UTF8'))>131072 then raise exception 'attendance_plan_exception_too_large';end if;
      if public.faolla_attendance_plan_exception_review_evidence_v1(evidence) is distinct from true then raise exception 'attendance_plan_exception_review_invalid';end if;
    elsif mode_name='note' then
      if latest.operation_id is null or p_command->>'decisionOperationId' is distinct from latest.operation_id::text then raise exception 'attendance_version_conflict';end if;
    else
      select * into entry_row from public.merchant_attendance_plan_exception_entries where merchant_id=site and operation_id=(p_command->>'decisionOperationId')::uuid;
      if entry_row.case_id is distinct from c.case_id or entry_row.kind is distinct from 'decision' then raise exception 'attendance_plan_exception_review_not_found';end if;
      perform public.faolla_attendance_plan_exception_review_entry_v1(entry_row);
      if exists(select 1 from public.merchant_attendance_plan_exception_reads where merchant_id=site and decision_operation_id=entry_row.operation_id) then
        raise exception 'attendance_operation_conflict';end if;
    end if;
    if mode_name<>'ack' then
      select count(*),coalesce(sum(octet_length(convert_to(x.command::text,'UTF8'))+coalesce(octet_length(convert_to(x.evidence::text,'UTF8')),0)),0)
        into n,bytes from public.merchant_attendance_plan_exception_entries x where x.merchant_id=site;
      if n>=5000 or bytes+octet_length(convert_to(p_command::text,'UTF8'))+coalesce(octet_length(convert_to(evidence::text,'UTF8')),0)>67108864 or head>=200 then
        raise exception 'attendance_plan_exception_review_limit';end if;
    end if;
    stamp:=clock_timestamp();
    if last_at is not null and stamp<last_at or source_result is not null and stamp<(source_result->>'readAt')::timestamptz then
      raise exception 'attendance_plan_exception_review_invalid';end if;
    if c.case_id is null then
      if mode_name<>'decide' then raise exception 'attendance_plan_exception_review_not_found';end if;
      select count(*) into n from public.merchant_attendance_plan_exception_cases where merchant_id=site;
      if n>=500 or (select count(*) from public.merchant_attendance_plan_exception_cases where merchant_id=site and worker_id=wid)>=100 then
        raise exception 'attendance_plan_exception_review_limit';end if;
      insert into public.merchant_attendance_plan_exception_cases(merchant_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id,worker_name,worker_no,slot_start_at,slot_end_at,time_zone,opened_at)
        values(site,op,wid,sid,current_employee,current_auth,w.display_name,w.worker_no,(source_result->'slot'->>'startAt')::timestamptz,
          (source_result->'slot'->>'endAt')::timestamptz,source_result->'slot'->>'timeZone',stamp) returning * into c;
    end if;
    if mode_name='ack' then
      if stamp<entry_row.recorded_at then raise exception 'attendance_plan_exception_review_invalid';end if;
      insert into public.merchant_attendance_plan_exception_reads(merchant_id,operation_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id,decision_operation_id,command,read_at)
        values(site,op,c.case_id,wid,sid,current_employee,current_auth,entry_row.operation_id,p_command,stamp) returning * into saved_read;
    else
      insert into public.merchant_attendance_plan_exception_entries(merchant_id,operation_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id,revision,actor_auth_user_id,kind,command,evidence,recorded_at)
        values(site,op,c.case_id,wid,sid,current_employee,current_auth,head+1,p_auth_user_id,case mode_name when 'decide' then 'decision' else 'note' end,p_command,
          case when mode_name='decide' then evidence else null end,stamp) returning * into saved;
      head:=head+1;
      if mode_name='decide' then latest:=saved;stale:=false;capture_new_decision:=p_capture_notifications;end if;
    end if;
  end if;
  if saved.operation_id is not null then receipt:=jsonb_build_object('operationId',saved.operation_id,'command',saved.command,'item',public.faolla_attendance_plan_exception_review_entry_v1(saved));end if;
  if saved_read.operation_id is not null then
    select * into entry_row from public.merchant_attendance_plan_exception_entries where merchant_id=site and operation_id=saved_read.decision_operation_id;
    if entry_row.case_id is distinct from saved_read.case_id or entry_row.kind is distinct from 'decision' or saved_read.read_at<entry_row.recorded_at
      or public.faolla_attendance_plan_exception_review_command_v1('ack',saved_read.command) is distinct from true
      or saved_read.command->>'operationId' is distinct from saved_read.operation_id::text
      or saved_read.command->>'decisionOperationId' is distinct from saved_read.decision_operation_id::text then raise exception 'attendance_plan_exception_review_invalid';end if;
    perform public.faolla_attendance_plan_exception_review_entry_v1(entry_row);
    read_receipt:=jsonb_build_object('operationId',saved_read.operation_id,'command',saved_read.command,'decisionOperationId',saved_read.decision_operation_id,
      'actorId',saved_read.employee_auth_user_id,'employeeId',saved_read.employee_id,'employeeAuthUserId',saved_read.employee_auth_user_id,
      'readAt',to_char(saved_read.read_at at time zone 'UTC',stamp_format));
  end if;
  if mode_name='list' then
    for c in select x.* from public.merchant_attendance_plan_exception_cases x where x.merchant_id=site and (wid is null and access_name='owner' or x.worker_id=wid)
      and (access_name='owner' or x.employee_id=current_employee and x.employee_auth_user_id=current_auth)
      and (cursor_at is null or (x.opened_at,x.case_id)<(cursor_at,cursor_id)) order by x.opened_at desc,x.case_id desc limit 26 for share loop
      row_count:=row_count+1;if row_count>25 then exit;end if;
      -- Owner discovery must not hand a historical case to a newly bound member.
      select * into w from public.merchant_attendance_workers where merchant_id=site and id=c.worker_id for share;
      select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;
      if w.employee_id is distinct from c.employee_id or e.auth_user_id is distinct from c.employee_auth_user_id then raise exception 'attendance_plan_exception_review_identity_changed';end if;
      select revision into head from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id order by revision desc limit 1;
      select * into latest from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id and kind='decision' order by revision desc limit 1;
      if head is null or latest.operation_id is null then raise exception 'attendance_plan_exception_review_invalid';end if;
      item:=public.faolla_attendance_plan_exception_review_entry_v1(latest);
      select * into read_row from public.merchant_attendance_plan_exception_reads where merchant_id=site and decision_operation_id=latest.operation_id;
      if read_row.operation_id is not null and (read_row.case_id<>c.case_id or read_row.employee_id<>c.employee_id or read_row.employee_auth_user_id<>c.employee_auth_user_id or read_row.read_at<latest.recorded_at) then raise exception 'attendance_plan_exception_review_invalid';end if;
      items:=items||jsonb_build_array(jsonb_build_object('caseId',c.case_id,'workerId',c.worker_id,'slotId',c.slot_id,'employeeId',c.employee_id,
        'employeeAuthUserId',c.employee_auth_user_id,'workerName',c.worker_name,'workerNo',c.worker_no,'slotStartAt',to_char(c.slot_start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'slotEndAt',to_char(c.slot_end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'timeZone',c.time_zone,'openedAt',to_char(c.opened_at at time zone 'UTC',stamp_format),'revision',head,
        'latestDecision',jsonb_build_object('operationId',latest.operation_id,'revision',latest.revision,'outcome',latest.command->'outcome','recordedAt',item->'recordedAt','readAt',to_char(read_row.read_at at time zone 'UTC',stamp_format))));
      next_cursor:=jsonb_build_object('at',to_char(c.opened_at at time zone 'UTC',stamp_format),'id',c.case_id);
    end loop;
    if row_count<=25 then next_cursor:=null;end if;
  else
    if latest.operation_id is not null then
      latest_item:=public.faolla_attendance_plan_exception_review_entry_v1(latest);
      select * into read_row from public.merchant_attendance_plan_exception_reads where merchant_id=site and decision_operation_id=latest.operation_id;
      if read_row.operation_id is not null and (read_row.case_id<>c.case_id or read_row.employee_id<>c.employee_id or read_row.employee_auth_user_id<>c.employee_auth_user_id or read_row.read_at<latest.recorded_at) then raise exception 'attendance_plan_exception_review_invalid';end if;
      latest_item:=latest_item||jsonb_build_object('readAt',to_char(read_row.read_at at time zone 'UTC',stamp_format));
      for entry_row in select * from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id order by revision desc limit 26 loop
        row_count:=row_count+1;if row_count>25 then history_truncated:=true;exit;end if;
        history:=history||jsonb_build_array(public.faolla_attendance_plan_exception_review_entry_v1(entry_row)-'evidence');
      end loop;
    end if;
    worker_item:=jsonb_build_object('workerId',w.id,'workerName',w.display_name,'workerNo',w.worker_no,'employeeId',w.employee_id,
      'employeeAuthUserId',e.auth_user_id,'version',w.version,'active',w.active,'employeeActive',e.status='active');
    detail:=jsonb_build_object('caseId',c.case_id,'openedAt',to_char(c.opened_at at time zone 'UTC',stamp_format),'worker',worker_item,'slotId',sid,'revision',head,
      'current',current_item,'currentValidation',case when checked then 'checked' else 'not_checked' end,'stale',case when checked then stale else null end,
      'latestDecision',latest_item,'history',history,'historyTruncated',history_truncated,
      'canDecide',access_name='owner' and checked and p_allow_write and s.enabled and p_auth_user_id<>current_auth,
      'canNote',access_name='self' and latest.operation_id is not null and p_allow_write and s.enabled and w.active);
  end if;
  read_at:=clock_timestamp();
  if source_result is not null and read_at<(source_result->>'readAt')::timestamptz
    or saved.operation_id is not null and read_at<saved.recorded_at or saved_read.operation_id is not null and read_at<saved_read.read_at then
    raise exception 'attendance_plan_exception_review_invalid';end if;
  result:=jsonb_build_object('protocol','plan-exception-review-v1','siteId',site,'access',access_name,'actorId',p_auth_user_id,
    'employeeId',case when access_name='self' then current_employee else null end,'readAt',to_char(read_at at time zone 'UTC',stamp_format),
    'items',items,'nextCursor',next_cursor,'detail',detail,'receipt',receipt,'readReceipt',read_receipt);
  if octet_length(convert_to(result::text,'UTF8'))>1048576 then raise exception 'attendance_plan_exception_too_large';end if;
  --Set only by the actual new decision INSERT. Reads and exact retries never
  --infer freshness from a missing notification, even after rollout changes.
  if capture_new_decision then
    perform public.faolla_attendance_event_notification_capture_v1(site,'plan_exception',op,p_auth_user_id,p_command);
  end if;
  return result;
end;
$exceptions209_old_0$ or position(old_body in definition)=0 then raise exception 'merchant_attendance_delegated_plan_exceptions_forward_drift';end if;
 execute replace(definition,old_body,$exceptions209_new_0$
begin
 return public.faolla_attendance_delegated_plan_exceptions_clearance_core_v1(p_query,p_auth_user_id,p_command,p_allow_write,p_allow_clearance,p_capture_notifications,null);
end;
$exceptions209_new_0$);
 end;$exceptions209_forward_0$;
do $exceptions209_forward_1$ declare old_body text;definition text;begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610090209 and name='merchant_attendance_delegated_plan_exceptions') then return;end if;
 select replace(proc.prosrc,E'\r\n',E'\n'),pg_get_functiondef(proc.oid) into old_body,definition from pg_proc proc where proc.oid='public.faolla_attendance_plan_exception_posthoc_execute_v1(jsonb,uuid,jsonb,boolean,boolean,boolean,boolean)'::regprocedure;
 if old_body is distinct from $exceptions209_old_1$
declare site text;access_name text;mode_name text;wid uuid;sid uuid;op uuid;cursor_at timestamptz;cursor_id uuid;
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
  r public.merchant_enterprise_roles%rowtype;c public.merchant_attendance_plan_exception_cases%rowtype;
  entry_row public.merchant_attendance_plan_exception_entries%rowtype;saved public.merchant_attendance_plan_exception_entries%rowtype;
  latest public.merchant_attendance_plan_exception_entries%rowtype;read_row public.merchant_attendance_plan_exception_reads%rowtype;
  saved_read public.merchant_attendance_plan_exception_reads%rowtype;
  source_basis jsonb;selected_sources jsonb;source_result jsonb:=null;current_item jsonb:=null;evidence jsonb;refs jsonb;part jsonb;ref_item jsonb;ref_items jsonb;k text;
  worker_item jsonb;items jsonb:='[]';history jsonb:='[]';detail jsonb:=null;receipt jsonb:=null;read_receipt jsonb:=null;
  latest_item jsonb:=null;item jsonb;next_cursor jsonb:=null;result jsonb;head bigint:=0;row_count integer:=0;
  history_truncated boolean:=false;checked boolean:=false;stale boolean:=null;stamp timestamptz;last_at timestamptz;read_at timestamptz;
  n bigint;bytes bigint;current_employee uuid;current_auth uuid;capture_new_decision boolean:=false;
  stamp_format constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_auth_user_id is null or p_allow_write is null or p_allow_posthoc is null or p_allow_clearance is null or p_capture_notifications is null
    or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','access','mode','workerId','slotId','operationId','beforeAt','beforeId']) is distinct from true
    or octet_length(convert_to(p_query::text,'UTF8'))>4096 or jsonb_typeof(p_query->'siteId')<>'string'
    or char_length(p_query->>'siteId')<>8 or p_query->>'siteId'!~'^[0-9]{8}$' or jsonb_typeof(p_query->'access')<>'string' or p_query->>'access' not in('owner','self')
    or jsonb_typeof(p_query->'mode')<>'string' or p_query->>'mode' not in('list','detail','recover','decide','note','ack') then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';access_name:=p_query->>'access';mode_name:=p_query->>'mode';
  foreach k in array array['workerId','slotId','operationId','beforeId'] loop
    if p_query->k<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->k,'uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  end loop;
  if p_query->'beforeAt'<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'beforeAt','stamp6') is distinct from true then raise exception 'attendance_invalid_request';end if;
  wid:=(p_query->>'workerId')::uuid;sid:=(p_query->>'slotId')::uuid;op:=(p_query->>'operationId')::uuid;
  cursor_at:=(p_query->>'beforeAt')::timestamptz;cursor_id:=(p_query->>'beforeId')::uuid;
  if mode_name='list' then
    if sid is not null or op is not null or p_command is not null or (cursor_at is null)<>(cursor_id is null) then raise exception 'attendance_invalid_request';end if;
  else
    if wid is null or sid is null or cursor_at is not null or cursor_id is not null
      or (mode_name='detail')<>(op is null) then raise exception 'attendance_invalid_request';end if;
    if mode_name in('detail','recover') then
      if p_command is not null then raise exception 'attendance_invalid_request';end if;
    elsif public.faolla_attendance_plan_exception_review_command_v1(mode_name,p_command) is distinct from true
      or p_command->>'operationId' is distinct from op::text then raise exception 'attendance_invalid_request';end if;
  end if;
  if mode_name='decide' and access_name<>'owner' or mode_name in('note','ack') and access_name<>'self' then raise exception 'attendance_access_denied';end if;
  perform 1 from public.merchants where id=site and (access_name='self' or user_id=p_auth_user_id) for share;
  if not found then raise exception 'attendance_access_denied';end if;
  select * into s from public.merchant_attendance_settings where merchant_id=site for update;
  if not found then raise exception 'attendance_settings_required';end if;
  if access_name='self' then
    -- Resolve the employee ID without locking, then follow the shared
    -- merchant/settings -> worker -> employee -> role order. The locked
    -- reread below rechecks the same authenticated binding after any wait.
    select id into current_employee from public.merchant_enterprise_employees where merchant_id=site and auth_user_id=p_auth_user_id;
    if current_employee is null then raise exception 'attendance_access_denied';end if;
    select * into w from public.merchant_attendance_workers where merchant_id=site and employee_id=current_employee for update;
    select * into e from public.merchant_enterprise_employees where merchant_id=site and id=current_employee and auth_user_id=p_auth_user_id for share;
    if not found or e.status<>'active' then raise exception 'attendance_access_denied';end if;
    select * into r from public.merchant_enterprise_roles where merchant_id=site and id=e.role_id for share;
    if not found or r.status<>'active' or public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions) is distinct from true
      or not('attendance.self.view'=any(r.permissions)) then raise exception 'attendance_access_denied';end if;
    if w.id is not null and w.employee_id is distinct from e.id then raise exception 'attendance_plan_exception_review_identity_changed';end if;
    if wid is not null and w.id is distinct from wid then raise exception 'attendance_plan_exception_review_identity_changed';end if;
    wid:=w.id;current_employee:=e.id;current_auth:=e.auth_user_id;
  elsif wid is not null then
    select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for update;
    if not found then raise exception 'attendance_worker_not_found';end if;
    if w.employee_id is not null then select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;end if;
    if e.id is null or e.auth_user_id is null then raise exception 'attendance_plan_exception_review_identity_changed';end if;
    current_employee:=e.id;current_auth:=e.auth_user_id;
  end if;
  --Do not introduce a new policy into no-ledger paths, or impersonate owner
  --for self reads/notes/acks. The locked legacy engine retains its exact result.
  if access_name<>'owner' or mode_name not in('detail','decide') or not exists(
    select 1 from public.merchant_attendance_plan_posthoc_operations where merchant_id=site and slot_id=sid) then
    if p_command is not null and mode_name='decide' and p_command->>'outcome'='not_applicable' then raise exception 'attendance_plan_exception_review_blocked';end if;
    return public.faolla_attendance_plan_exception_clearance_execute_v1(p_query,p_auth_user_id,p_command,p_allow_write,p_allow_clearance,p_capture_notifications);
  end if;
  -- New namespace serializes operation IDs across entries/reads, first-case
  -- creation and finite quotas. No old row receives UPDATE or lock upgrade.
  if p_command is not null then perform pg_advisory_xact_lock(hashtextextended('faolla:attendance-plan-exception-review:v1:'||site,0));end if;
  if mode_name<>'list' then
    if p_command is null then
      select * into c from public.merchant_attendance_plan_exception_cases where merchant_id=site and slot_id=sid for share;
    else
      select * into c from public.merchant_attendance_plan_exception_cases where merchant_id=site and slot_id=sid for update;
    end if;
    if c.case_id is not null then
      if c.worker_id is distinct from wid or c.employee_id is distinct from current_employee or c.employee_auth_user_id is distinct from current_auth then
        raise exception 'attendance_plan_exception_review_identity_changed';end if;
    elsif access_name='self' then raise exception 'attendance_plan_exception_review_not_found';end if;
  end if;
  -- Exact original receipts are read before pause, current-source collection,
  -- eligibility or quota. Current authorization and dual identity always apply.
  if op is not null then
    select * into saved from public.merchant_attendance_plan_exception_entries where merchant_id=site and operation_id=op;
    select * into saved_read from public.merchant_attendance_plan_exception_reads where merchant_id=site and operation_id=op;
    if saved.operation_id is not null and saved_read.operation_id is not null then raise exception 'attendance_plan_exception_review_invalid';end if;
    -- A concurrent first decision can commit between the earlier case lookup
    -- and this immutable receipt lookup. Re-pin the case after finding it.
    if c.case_id is null and (saved.operation_id is not null or saved_read.operation_id is not null) then
      select * into c from public.merchant_attendance_plan_exception_cases where merchant_id=site and case_id=coalesce(saved.case_id,saved_read.case_id) for share;
      if c.worker_id is distinct from wid or c.slot_id is distinct from sid or c.employee_id is distinct from current_employee
        or c.employee_auth_user_id is distinct from current_auth then raise exception 'attendance_plan_exception_review_identity_changed';end if;
    end if;
    if saved.operation_id is not null then
      if saved.actor_auth_user_id<>p_auth_user_id or saved.worker_id<>wid or saved.slot_id<>sid or saved.case_id is distinct from c.case_id
        or (saved.kind='decision')<>(access_name='owner') then raise exception 'attendance_access_denied';end if;
      if saved.employee_id<>current_employee or saved.employee_auth_user_id<>current_auth then raise exception 'attendance_plan_exception_review_identity_changed';end if;
      if p_command is not null and (saved.command is distinct from p_command or mode_name<>case saved.kind when 'decision' then 'decide' else 'note' end) then
        raise exception 'attendance_operation_conflict';end if;
    elsif saved_read.operation_id is not null then
      if access_name<>'self' or saved_read.employee_auth_user_id<>p_auth_user_id or saved_read.worker_id<>wid or saved_read.slot_id<>sid
        or saved_read.case_id is distinct from c.case_id then raise exception 'attendance_access_denied';end if;
      if saved_read.employee_id<>current_employee or saved_read.employee_auth_user_id<>current_auth then raise exception 'attendance_plan_exception_review_identity_changed';end if;
      if p_command is not null and (mode_name<>'ack' or saved_read.command is distinct from p_command) then raise exception 'attendance_operation_conflict';end if;
    end if;
  end if;
  if c.case_id is not null then
    select revision,recorded_at into head,last_at from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id order by revision desc limit 1;
    if head is null then raise exception 'attendance_plan_exception_review_invalid';end if;
    select * into latest from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id and kind='decision' order by revision desc limit 1;
    if latest.operation_id is null then raise exception 'attendance_plan_exception_review_invalid';end if;
  end if;
  if p_command is not null and saved.operation_id is null and saved_read.operation_id is null then
    if not p_allow_write or not s.enabled then raise exception 'attendance_platform_paused';end if;
    if access_name='self' and not w.active then raise exception 'attendance_access_denied';end if;
    if mode_name='decide' then
      if not p_allow_posthoc then raise exception 'attendance_plan_exception_posthoc_disabled';end if;
      if c.case_id is null or head<1 or (p_command->>'expectedRevision')::bigint<1 then raise exception 'attendance_plan_exception_review_blocked';end if;
      if not w.active or e.status<>'active' then raise exception 'attendance_access_denied';end if;
    end if;
    --Only the explicit new RPC can authorize a fresh clearance. This is after
    --locked original-receipt resolution, before current-source collection.
    if mode_name='decide' and p_command->>'outcome'='cleared' then
      if not p_allow_clearance then raise exception 'attendance_plan_exception_clearance_disabled';end if;
      if c.case_id is null or head<1 or (p_command->>'expectedRevision')::bigint<1 then
        raise exception 'attendance_plan_exception_review_blocked';end if;
    end if;
    if mode_name<>'ack' and (p_command->>'expectedRevision')::bigint<>head then raise exception 'attendance_version_conflict';end if;
    if mode_name='decide' and (p_command->>'employeeId' is distinct from current_employee::text
      or p_command->>'employeeAuthUserId' is distinct from current_auth::text) then raise exception 'attendance_plan_exception_review_identity_changed';end if;
    if mode_name='decide' and p_auth_user_id=current_auth then raise exception 'attendance_access_denied';end if;
  end if;
  if access_name='owner' and (mode_name='detail' or mode_name='decide' and saved.operation_id is null) then
    source_result:=public.faolla_attendance_plan_posthoc_formal_source_v1(jsonb_build_object('siteId',site,'workerId',wid,'slotId',sid),p_auth_user_id);
    if source_result->>'siteId' is distinct from site or source_result->>'actorId' is distinct from p_auth_user_id::text
      or source_result->'worker'->>'workerId' is distinct from wid::text or source_result->'worker'->>'employeeId' is distinct from current_employee::text
      or source_result->'worker'->>'employeeAuthUserId' is distinct from current_auth::text or source_result->'slot'->>'id' is distinct from sid::text
      or source_result->>'sourceText' is distinct from (source_result->'source')::text
      or source_result->>'fingerprint' is distinct from encode(sha256(convert_to(source_result->>'sourceText','UTF8')),'hex') then
      raise exception 'attendance_plan_exception_review_invalid';end if;
    if source_result->>'protocol' is distinct from 'plan-exception-source-v3' then raise exception 'attendance_plan_exception_review_invalid';end if;
    source_basis:=source_result->'source'->'evaluation'->'basis';
    current_item:=source_result-'sourceText';checked:=true;
    if latest.operation_id is not null then stale:=latest.evidence->>'fingerprint' is distinct from source_result->>'fingerprint';end if;
  end if;
  if p_command is not null and saved.operation_id is null and saved_read.operation_id is null then
    if mode_name='decide' then
      if source_result->>'fingerprint' is distinct from p_command->>'expectedFingerprint' then raise exception 'attendance_plan_exception_review_source_changed';end if;
      if p_command->>'outcome' in('confirmed','excused') and (source_result->>'eligible' is distinct from 'true'
        or not(source_result->'candidate'->'late'->>'state'='triggered' or source_result->'candidate'->'early'->>'state'='triggered')) then
        raise exception 'attendance_plan_exception_review_blocked';end if;
      if p_command->>'outcome'='cleared' and (source_result->>'eligible' is distinct from 'true'
        or source_result->'candidate'->'late'->>'state' is distinct from 'not_triggered'
        or source_result->'candidate'->'early'->>'state' is distinct from 'not_triggered') then
        raise exception 'attendance_plan_exception_review_blocked';end if;
      if p_command->>'outcome'='not_applicable' and (source_result->>'state' is distinct from 'not_applicable'
        or source_result->>'eligible' is distinct from 'true' or source_result->'leaveEdges'->>'fullCoverage' is distinct from 'true'
        or source_result->'leaveEdges'->'work'<>'[]'::jsonb) then raise exception 'attendance_plan_exception_review_blocked';end if;
      --Formal facts omit seal state from their hash, but every fresh decision
      --still protects the plan and both saved/current source endpoint versions.
      perform public.faolla_attendance_period_assert_open_v1(site,wid,jsonb_build_array(jsonb_build_object(
        'startAt',to_char((source_result->'slot'->>'startAt')::timestamptz at time zone 'UTC',stamp_format),
        'endAt',to_char((source_result->'slot'->>'endAt')::timestamptz at time zone 'UTC',stamp_format))));
      selected_sources:=source_result->'source'->'evaluation'->'posthoc'->'selected';
      for ref_item in select observation_rows.value->'current' from jsonb_array_elements(source_result->'source'->'evaluation'->'observations') observation_rows(value) where observation_rows.value->'current'<>'null'::jsonb loop
        selected_sources:=selected_sources||jsonb_build_array(ref_item);
      end loop;
      for ref_item in select selected_rows.value from jsonb_array_elements(selected_sources) selected_rows(value) loop
        if ref_item->'selected'->>'endAt' is not null then perform public.faolla_attendance_period_assert_open_v1(site,wid,jsonb_build_array(ref_item->'selected'));end if;
        if ref_item->'original'->>'endAt' is not null then perform public.faolla_attendance_period_assert_open_v1(site,wid,jsonb_build_array(ref_item->'original'));end if;
      end loop;
      refs:='{}';
      foreach k in array array['sessions','unassociated','leave','calendar','missing','pendingCorrections']||case when source_basis->>'policy'='owner-confirmed-plan-edges-work-v2' then array['workArrangements'] else array[]::text[] end loop
        part:=case when k='sessions' then jsonb_build_object('limited',false,'items',source_basis->'sessions') else source_basis->'context'->k end;
        ref_items:='[]';
        for ref_item in select value from jsonb_array_elements(part->'items') loop
          if k in('sessions','unassociated') then
            item:=jsonb_build_object('startEventId',ref_item->'startEventId','lastEventId',ref_item->'lastEventId','lastSequence',ref_item->'lastSequence','effectOperationId',ref_item->'effect'->'operationId');
          elsif k='calendar' then item:=jsonb_build_object('entryId',ref_item->'entryId','operationId',ref_item->'operationId','revision',ref_item->'revision');
          elsif k='workArrangements' then
            item:=jsonb_build_object('requestId',ref_item->'requestId','operationId',ref_item->'history'->-1->'operationId','revision',ref_item->'revision');
          else
            item:=jsonb_build_object('requestId',ref_item->'requestId','operationId',ref_item->'operationId','revision',ref_item->'revision');
            if k='pendingCorrections' then item:=item||jsonb_build_object('kind',ref_item->'kind','startEventId',ref_item->'startEventId');end if;
          end if;
          ref_items:=ref_items||jsonb_build_array(item);
        end loop;
        refs:=refs||jsonb_build_object(k,case when k='sessions' then ref_items else jsonb_build_object('limited',part->'limited','items',ref_items) end);
      end loop;
      evidence:=jsonb_build_object('policy',source_result->'source'->>'policy','fingerprint',source_result->'fingerprint','observedAt',source_result->'readAt',
        'eligible',source_result->'eligible','blockers',source_result->'blockers','candidate',source_result->'candidate',
        'approval',nullif(source_result->'source'->'evaluation'->'approval','null'::jsonb)-'source','sessions',refs->'sessions','contextRefs',refs-'sessions',
        'evaluation',jsonb_build_object('state',source_result->'state','slot',jsonb_build_object('slotId',source_result->'slot'->'id','locationId',source_result->'slot'->'locationId',
          'timeZone',source_result->'slot'->'timeZone','startAt',source_result->'slot'->'startAt','endAt',source_result->'slot'->'endAt'),
          'posthoc',source_result->'source'->'evaluation'->'posthoc','observations',source_result->'source'->'evaluation'->'observations','leaveEdges',source_result->'leaveEdges'));
      if octet_length(convert_to(evidence::text,'UTF8'))>131072 then raise exception 'attendance_plan_exception_too_large';end if;
      if public.faolla_attendance_plan_exception_review_evidence_v1(evidence) is distinct from true then raise exception 'attendance_plan_exception_review_invalid';end if;
    elsif mode_name='note' then
      if latest.operation_id is null or p_command->>'decisionOperationId' is distinct from latest.operation_id::text then raise exception 'attendance_version_conflict';end if;
    else
      select * into entry_row from public.merchant_attendance_plan_exception_entries where merchant_id=site and operation_id=(p_command->>'decisionOperationId')::uuid;
      if entry_row.case_id is distinct from c.case_id or entry_row.kind is distinct from 'decision' then raise exception 'attendance_plan_exception_review_not_found';end if;
      perform public.faolla_attendance_plan_exception_review_entry_v1(entry_row);
      if exists(select 1 from public.merchant_attendance_plan_exception_reads where merchant_id=site and decision_operation_id=entry_row.operation_id) then
        raise exception 'attendance_operation_conflict';end if;
    end if;
    if mode_name<>'ack' then
      select count(*),coalesce(sum(octet_length(convert_to(x.command::text,'UTF8'))+coalesce(octet_length(convert_to(x.evidence::text,'UTF8')),0)),0)
        into n,bytes from public.merchant_attendance_plan_exception_entries x where x.merchant_id=site;
      if n>=5000 or bytes+octet_length(convert_to(p_command::text,'UTF8'))+coalesce(octet_length(convert_to(evidence::text,'UTF8')),0)>67108864 or head>=200 then
        raise exception 'attendance_plan_exception_review_limit';end if;
    end if;
    stamp:=clock_timestamp();
    if last_at is not null and stamp<last_at or source_result is not null and stamp<(source_result->>'readAt')::timestamptz then
      raise exception 'attendance_plan_exception_review_invalid';end if;
    if c.case_id is null then
      if mode_name<>'decide' then raise exception 'attendance_plan_exception_review_not_found';end if;
      select count(*) into n from public.merchant_attendance_plan_exception_cases where merchant_id=site;
      if n>=500 or (select count(*) from public.merchant_attendance_plan_exception_cases where merchant_id=site and worker_id=wid)>=100 then
        raise exception 'attendance_plan_exception_review_limit';end if;
      insert into public.merchant_attendance_plan_exception_cases(merchant_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id,worker_name,worker_no,slot_start_at,slot_end_at,time_zone,opened_at)
        values(site,op,wid,sid,current_employee,current_auth,w.display_name,w.worker_no,(source_result->'slot'->>'startAt')::timestamptz,
          (source_result->'slot'->>'endAt')::timestamptz,source_result->'slot'->>'timeZone',stamp) returning * into c;
    end if;
    if mode_name='ack' then
      if stamp<entry_row.recorded_at then raise exception 'attendance_plan_exception_review_invalid';end if;
      insert into public.merchant_attendance_plan_exception_reads(merchant_id,operation_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id,decision_operation_id,command,read_at)
        values(site,op,c.case_id,wid,sid,current_employee,current_auth,entry_row.operation_id,p_command,stamp) returning * into saved_read;
    else
      insert into public.merchant_attendance_plan_exception_entries(merchant_id,operation_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id,revision,actor_auth_user_id,kind,command,evidence,recorded_at)
        values(site,op,c.case_id,wid,sid,current_employee,current_auth,head+1,p_auth_user_id,case mode_name when 'decide' then 'decision' else 'note' end,p_command,
          case when mode_name='decide' then evidence else null end,stamp) returning * into saved;
      head:=head+1;
      if mode_name='decide' then latest:=saved;stale:=false;capture_new_decision:=p_capture_notifications;end if;
    end if;
  end if;
  if saved.operation_id is not null then receipt:=jsonb_build_object('operationId',saved.operation_id,'command',saved.command,'item',public.faolla_attendance_plan_exception_review_entry_v1(saved));end if;
  if saved_read.operation_id is not null then
    select * into entry_row from public.merchant_attendance_plan_exception_entries where merchant_id=site and operation_id=saved_read.decision_operation_id;
    if entry_row.case_id is distinct from saved_read.case_id or entry_row.kind is distinct from 'decision' or saved_read.read_at<entry_row.recorded_at
      or public.faolla_attendance_plan_exception_review_command_v1('ack',saved_read.command) is distinct from true
      or saved_read.command->>'operationId' is distinct from saved_read.operation_id::text
      or saved_read.command->>'decisionOperationId' is distinct from saved_read.decision_operation_id::text then raise exception 'attendance_plan_exception_review_invalid';end if;
    perform public.faolla_attendance_plan_exception_review_entry_v1(entry_row);
    read_receipt:=jsonb_build_object('operationId',saved_read.operation_id,'command',saved_read.command,'decisionOperationId',saved_read.decision_operation_id,
      'actorId',saved_read.employee_auth_user_id,'employeeId',saved_read.employee_id,'employeeAuthUserId',saved_read.employee_auth_user_id,
      'readAt',to_char(saved_read.read_at at time zone 'UTC',stamp_format));
  end if;
  if mode_name='list' then
    for c in select x.* from public.merchant_attendance_plan_exception_cases x where x.merchant_id=site and (wid is null and access_name='owner' or x.worker_id=wid)
      and (access_name='owner' or x.employee_id=current_employee and x.employee_auth_user_id=current_auth)
      and (cursor_at is null or (x.opened_at,x.case_id)<(cursor_at,cursor_id)) order by x.opened_at desc,x.case_id desc limit 26 for share loop
      row_count:=row_count+1;if row_count>25 then exit;end if;
      -- Owner discovery must not hand a historical case to a newly bound member.
      select * into w from public.merchant_attendance_workers where merchant_id=site and id=c.worker_id for share;
      select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;
      if w.employee_id is distinct from c.employee_id or e.auth_user_id is distinct from c.employee_auth_user_id then raise exception 'attendance_plan_exception_review_identity_changed';end if;
      select revision into head from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id order by revision desc limit 1;
      select * into latest from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id and kind='decision' order by revision desc limit 1;
      if head is null or latest.operation_id is null then raise exception 'attendance_plan_exception_review_invalid';end if;
      item:=public.faolla_attendance_plan_exception_review_entry_v1(latest);
      select * into read_row from public.merchant_attendance_plan_exception_reads where merchant_id=site and decision_operation_id=latest.operation_id;
      if read_row.operation_id is not null and (read_row.case_id<>c.case_id or read_row.employee_id<>c.employee_id or read_row.employee_auth_user_id<>c.employee_auth_user_id or read_row.read_at<latest.recorded_at) then raise exception 'attendance_plan_exception_review_invalid';end if;
      items:=items||jsonb_build_array(jsonb_build_object('caseId',c.case_id,'workerId',c.worker_id,'slotId',c.slot_id,'employeeId',c.employee_id,
        'employeeAuthUserId',c.employee_auth_user_id,'workerName',c.worker_name,'workerNo',c.worker_no,'slotStartAt',to_char(c.slot_start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'slotEndAt',to_char(c.slot_end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'timeZone',c.time_zone,'openedAt',to_char(c.opened_at at time zone 'UTC',stamp_format),'revision',head,
        'latestDecision',jsonb_build_object('operationId',latest.operation_id,'revision',latest.revision,'outcome',latest.command->'outcome','recordedAt',item->'recordedAt','readAt',to_char(read_row.read_at at time zone 'UTC',stamp_format))));
      next_cursor:=jsonb_build_object('at',to_char(c.opened_at at time zone 'UTC',stamp_format),'id',c.case_id);
    end loop;
    if row_count<=25 then next_cursor:=null;end if;
  else
    if latest.operation_id is not null then
      latest_item:=public.faolla_attendance_plan_exception_review_entry_v1(latest);
      select * into read_row from public.merchant_attendance_plan_exception_reads where merchant_id=site and decision_operation_id=latest.operation_id;
      if read_row.operation_id is not null and (read_row.case_id<>c.case_id or read_row.employee_id<>c.employee_id or read_row.employee_auth_user_id<>c.employee_auth_user_id or read_row.read_at<latest.recorded_at) then raise exception 'attendance_plan_exception_review_invalid';end if;
      latest_item:=latest_item||jsonb_build_object('readAt',to_char(read_row.read_at at time zone 'UTC',stamp_format));
      for entry_row in select * from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id order by revision desc limit 26 loop
        row_count:=row_count+1;if row_count>25 then history_truncated:=true;exit;end if;
        history:=history||jsonb_build_array(public.faolla_attendance_plan_exception_review_entry_v1(entry_row)-'evidence');
      end loop;
    end if;
    worker_item:=jsonb_build_object('workerId',w.id,'workerName',w.display_name,'workerNo',w.worker_no,'employeeId',w.employee_id,
      'employeeAuthUserId',e.auth_user_id,'version',w.version,'active',w.active,'employeeActive',e.status='active');
    detail:=jsonb_build_object('caseId',c.case_id,'openedAt',to_char(c.opened_at at time zone 'UTC',stamp_format),'worker',worker_item,'slotId',sid,'revision',head,
      'current',current_item,'currentValidation',case when checked then 'checked' else 'not_checked' end,'stale',case when checked then stale else null end,
      'latestDecision',latest_item,'history',history,'historyTruncated',history_truncated,
      'canDecide',access_name='owner' and checked and p_allow_write and p_allow_posthoc and s.enabled and w.active and e.status='active' and p_auth_user_id<>current_auth,
      'canNote',access_name='self' and latest.operation_id is not null and p_allow_write and s.enabled and w.active);
  end if;
  read_at:=clock_timestamp();
  if source_result is not null and read_at<(source_result->>'readAt')::timestamptz
    or saved.operation_id is not null and read_at<saved.recorded_at or saved_read.operation_id is not null and read_at<saved_read.read_at then
    raise exception 'attendance_plan_exception_review_invalid';end if;
  result:=jsonb_build_object('protocol','plan-exception-review-v1','siteId',site,'access',access_name,'actorId',p_auth_user_id,
    'employeeId',case when access_name='self' then current_employee else null end,'readAt',to_char(read_at at time zone 'UTC',stamp_format),
    'items',items,'nextCursor',next_cursor,'detail',detail,'receipt',receipt,'readReceipt',read_receipt);
  if octet_length(convert_to(result::text,'UTF8'))>1048576 then raise exception 'attendance_plan_exception_too_large';end if;
  --Set only by the actual new decision INSERT. Reads and exact retries never
  --infer freshness from a missing notification, even after rollout changes.
  if capture_new_decision then
    perform public.faolla_attendance_event_notification_capture_v1(site,'plan_exception',op,p_auth_user_id,p_command);
  end if;
  return result;
end;
$exceptions209_old_1$ or position(old_body in definition)=0 then raise exception 'merchant_attendance_delegated_plan_exceptions_forward_drift';end if;
 execute replace(definition,old_body,$exceptions209_new_1$
begin
 return public.faolla_attendance_delegated_plan_exceptions_posthoc_core_v1(p_query,p_auth_user_id,p_command,p_allow_write,p_allow_posthoc,p_allow_clearance,p_capture_notifications,null);
end;
$exceptions209_new_1$);
 end;$exceptions209_forward_1$;
do $exceptions209_forward_2$ declare old_body text;definition text;begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610090209 and name='merchant_attendance_delegated_plan_exceptions') then return;end if;
 select replace(proc.prosrc,E'\r\n',E'\n'),pg_get_functiondef(proc.oid) into old_body,definition from pg_proc proc where proc.oid='public.faolla_attendance_management_insert_v1()'::regprocedure;
 if old_body is distinct from $exceptions209_old_2$
declare context jsonb;g public.merchant_attendance_management_delegations%rowtype;stamp timestamptz;
begin
 if tg_table_name='merchant_attendance_management_delegation_operations' then
  if new.delegated_action='audit_export' then perform public.faolla_attendance_management_audit_authority_v1(new);return new;end if;
  if new.delegated_action in('group_save','group_assign','group_end','group_cancel') then perform public.faolla_attendance_delegated_groups_authority_v1(new);return new;end if;
  if new.delegated_action in('worker_save','location_save') then perform public.faolla_attendance_delegated_config_authority_v1(new);return new;end if;
  if new.delegated_action in('rule_draft','rule_publish','rule_withdraw','personal_rule_approve','personal_rule_withdraw','operational_rule_draft','operational_rule_publish','operational_rule_withdraw') then perform public.faolla_attendance_delegated_rules_authority_v1(new);return new;end if;
  if new.delegated_action in('terminal_prepare','terminal_revoke','pin_issue','pin_revoke') then perform public.faolla_attendance_delegated_credentials_authority_v1(new);return new;end if;
  if new.delegated_action in('revision_approve','revision_reject') then perform public.faolla_attendance_delegated_revisions_authority_v1(new);return new;end if;
  raise exception 'attendance_management_executor_unavailable';
 end if;
 perform public.faolla_attendance_management_command_v1(new.command);
 perform 1 from public.merchants actual where actual.id=new.merchant_id and actual.user_id=new.actor_auth_user_id for share;if not found then raise exception 'attendance_access_denied';end if;
 perform 1 from public.merchant_attendance_settings actual where actual.merchant_id=new.merchant_id for update;if not found then raise exception 'attendance_settings_required';end if;
 stamp:=clock_timestamp();
 if new.command_fingerprint is distinct from public.faolla_attendance_management_hash_v1(new.merchant_id,new.actor_auth_user_id,new.command)
  or new.reason is distinct from new.command->>'reason' or not isfinite(new.recorded_at) or new.recorded_at>stamp then raise exception 'attendance_management_delegation_invalid';end if;
 if tg_table_name='merchant_attendance_management_delegations' then
  if new.command->>'action' is distinct from 'grant' or row(new.grant_id::text,new.delegate_employee_id::text,new.delegate_auth_user_id::text,new.delegated_action) is distinct from row(new.command->>'operationId',new.command->>'delegateEmployeeId',new.command->>'delegateAuthUserId',new.command->>'delegatedAction')
   or new.scope is distinct from new.command->'scope' or new.capability is distinct from public.faolla_attendance_management_capability_v1(new.delegated_action)
   or new.valid_from is distinct from (new.command->>'validFrom')::timestamptz or new.valid_until is distinct from (new.command->>'validUntil')::timestamptz or new.valid_until<=stamp then raise exception 'attendance_management_delegation_invalid';end if;
  context:=public.faolla_attendance_management_scope_context_v1(new.merchant_id,new.scope,new.delegated_action);
  if context is null or row(new.worker_id,new.employee_id,new.employee_auth_user_id,new.employee_generation) is distinct from row((context->>'workerId')::uuid,(context->>'employeeId')::uuid,(context->>'employeeAuthUserId')::uuid,(context->>'generation')::bigint)
   or new.delegate_generation<>coalesce((select epoch.generation from public.merchant_attendance_account_epochs epoch where epoch.merchant_id=new.merchant_id and epoch.employee_id=new.delegate_employee_id),0)
   or exists(select 1 from public.merchant_attendance_account_epochs epoch where epoch.merchant_id=new.merchant_id and epoch.employee_id=new.delegate_employee_id and epoch.paused)
   or not exists(select 1 from public.merchant_enterprise_employees employee join public.merchant_enterprise_roles role_row on role_row.merchant_id=employee.merchant_id and role_row.id=employee.role_id
    where employee.merchant_id=new.merchant_id and employee.id=new.delegate_employee_id and employee.auth_user_id=new.delegate_auth_user_id and employee.status='active' and role_row.status='active'
     and public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions) and role_row.permissions @> array['enterprise.view',new.capability]) then raise exception 'attendance_management_delegation_scope_invalid';end if;
  if exists(select 1 from public.merchant_attendance_management_delegation_revocations actual where actual.merchant_id=new.merchant_id and actual.operation_id=new.grant_id)
   or exists(select 1 from public.merchant_attendance_management_delegation_operations actual where actual.merchant_id=new.merchant_id and actual.operation_id=new.grant_id) then raise exception 'attendance_operation_conflict';end if;
 elsif tg_table_name='merchant_attendance_management_delegation_revocations' then
  select * into g from public.merchant_attendance_management_delegations actual where actual.merchant_id=new.merchant_id and actual.grant_id=new.grant_id for share;
  if new.command->>'action' is distinct from 'revoke' or row(new.operation_id::text,new.grant_id::text) is distinct from row(new.command->>'operationId',new.command->>'grantId') or g.grant_id is null or new.recorded_at<g.recorded_at then raise exception 'attendance_management_delegation_invalid';end if;
  if exists(select 1 from public.merchant_attendance_management_delegations actual where actual.merchant_id=new.merchant_id and actual.grant_id=new.operation_id)
   or exists(select 1 from public.merchant_attendance_management_delegation_operations actual where actual.merchant_id=new.merchant_id and actual.operation_id=new.operation_id) then raise exception 'attendance_operation_conflict';end if;
 else raise exception 'attendance_management_delegation_invalid';end if;
 return new;
end;
$exceptions209_old_2$ or position(old_body in definition)=0 then raise exception 'merchant_attendance_delegated_plan_exceptions_forward_drift';end if;
 execute replace(definition,old_body,$exceptions209_new_2$
declare context jsonb;g public.merchant_attendance_management_delegations%rowtype;stamp timestamptz;
begin
 if tg_table_name='merchant_attendance_management_delegation_operations' then
  if new.delegated_action='audit_export' then perform public.faolla_attendance_management_audit_authority_v1(new);return new;end if;
  if new.delegated_action in('group_save','group_assign','group_end','group_cancel') then perform public.faolla_attendance_delegated_groups_authority_v1(new);return new;end if;
  if new.delegated_action in('worker_save','location_save') then perform public.faolla_attendance_delegated_config_authority_v1(new);return new;end if;
  if new.delegated_action in('rule_draft','rule_publish','rule_withdraw','personal_rule_approve','personal_rule_withdraw','operational_rule_draft','operational_rule_publish','operational_rule_withdraw') then perform public.faolla_attendance_delegated_rules_authority_v1(new);return new;end if;
  if new.delegated_action in('terminal_prepare','terminal_revoke','pin_issue','pin_revoke') then perform public.faolla_attendance_delegated_credentials_authority_v1(new);return new;end if;
  if new.delegated_action in('revision_approve','revision_reject') then perform public.faolla_attendance_delegated_revisions_authority_v1(new);return new;end if;
  if new.delegated_action='plan_exception_decide' then perform public.faolla_attendance_delegated_plan_exceptions_authority_v1(new);return new;end if;
  raise exception 'attendance_management_executor_unavailable';
 end if;
 perform public.faolla_attendance_management_command_v1(new.command);
 perform 1 from public.merchants actual where actual.id=new.merchant_id and actual.user_id=new.actor_auth_user_id for share;if not found then raise exception 'attendance_access_denied';end if;
 perform 1 from public.merchant_attendance_settings actual where actual.merchant_id=new.merchant_id for update;if not found then raise exception 'attendance_settings_required';end if;
 stamp:=clock_timestamp();
 if new.command_fingerprint is distinct from public.faolla_attendance_management_hash_v1(new.merchant_id,new.actor_auth_user_id,new.command)
  or new.reason is distinct from new.command->>'reason' or not isfinite(new.recorded_at) or new.recorded_at>stamp then raise exception 'attendance_management_delegation_invalid';end if;
 if tg_table_name='merchant_attendance_management_delegations' then
  if new.command->>'action' is distinct from 'grant' or row(new.grant_id::text,new.delegate_employee_id::text,new.delegate_auth_user_id::text,new.delegated_action) is distinct from row(new.command->>'operationId',new.command->>'delegateEmployeeId',new.command->>'delegateAuthUserId',new.command->>'delegatedAction')
   or new.scope is distinct from new.command->'scope' or new.capability is distinct from public.faolla_attendance_management_capability_v1(new.delegated_action)
   or new.valid_from is distinct from (new.command->>'validFrom')::timestamptz or new.valid_until is distinct from (new.command->>'validUntil')::timestamptz or new.valid_until<=stamp then raise exception 'attendance_management_delegation_invalid';end if;
  context:=public.faolla_attendance_management_scope_context_v1(new.merchant_id,new.scope,new.delegated_action);
  if context is null or row(new.worker_id,new.employee_id,new.employee_auth_user_id,new.employee_generation) is distinct from row((context->>'workerId')::uuid,(context->>'employeeId')::uuid,(context->>'employeeAuthUserId')::uuid,(context->>'generation')::bigint)
   or new.delegate_generation<>coalesce((select epoch.generation from public.merchant_attendance_account_epochs epoch where epoch.merchant_id=new.merchant_id and epoch.employee_id=new.delegate_employee_id),0)
   or exists(select 1 from public.merchant_attendance_account_epochs epoch where epoch.merchant_id=new.merchant_id and epoch.employee_id=new.delegate_employee_id and epoch.paused)
   or not exists(select 1 from public.merchant_enterprise_employees employee join public.merchant_enterprise_roles role_row on role_row.merchant_id=employee.merchant_id and role_row.id=employee.role_id
    where employee.merchant_id=new.merchant_id and employee.id=new.delegate_employee_id and employee.auth_user_id=new.delegate_auth_user_id and employee.status='active' and role_row.status='active'
     and public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions) and role_row.permissions @> array['enterprise.view',new.capability]) then raise exception 'attendance_management_delegation_scope_invalid';end if;
  if exists(select 1 from public.merchant_attendance_management_delegation_revocations actual where actual.merchant_id=new.merchant_id and actual.operation_id=new.grant_id)
   or exists(select 1 from public.merchant_attendance_management_delegation_operations actual where actual.merchant_id=new.merchant_id and actual.operation_id=new.grant_id) then raise exception 'attendance_operation_conflict';end if;
 elsif tg_table_name='merchant_attendance_management_delegation_revocations' then
  select * into g from public.merchant_attendance_management_delegations actual where actual.merchant_id=new.merchant_id and actual.grant_id=new.grant_id for share;
  if new.command->>'action' is distinct from 'revoke' or row(new.operation_id::text,new.grant_id::text) is distinct from row(new.command->>'operationId',new.command->>'grantId') or g.grant_id is null or new.recorded_at<g.recorded_at then raise exception 'attendance_management_delegation_invalid';end if;
  if exists(select 1 from public.merchant_attendance_management_delegations actual where actual.merchant_id=new.merchant_id and actual.grant_id=new.operation_id)
   or exists(select 1 from public.merchant_attendance_management_delegation_operations actual where actual.merchant_id=new.merchant_id and actual.operation_id=new.operation_id) then raise exception 'attendance_operation_conflict';end if;
 else raise exception 'attendance_management_delegation_invalid';end if;
 return new;
end;
$exceptions209_new_2$);
 end;$exceptions209_forward_2$;
--END GENERATED DELEGATED PLAN EXCEPTIONS FORWARD
--BEGIN GENERATED DELEGATED PLAN EXCEPTIONS POSTCONDITIONS
revoke all on function public.faolla_attendance_delegated_plan_exceptions_command_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_plan_exceptions_hash_v1(text,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_plan_exceptions_authorize_v1(text,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_plan_exceptions_target_v1(public.merchant_attendance_management_delegations,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_plan_exceptions_core_authorize_v1(text,uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_plan_exceptions_clearance_core_v1(jsonb,uuid,jsonb,boolean,boolean,boolean,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_plan_exceptions_posthoc_core_v1(jsonb,uuid,jsonb,boolean,boolean,boolean,boolean,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_plan_exceptions_scope_v1(public.merchant_attendance_management_delegations,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_plan_exceptions_business_v1(text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_plan_exceptions_operation_v1(public.merchant_attendance_management_delegation_operations,boolean) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_plan_exceptions_authority_v1(public.merchant_attendance_management_delegation_operations) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_plan_exceptions_receipt_v1(text,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_plan_exceptions_v1(jsonb,uuid,jsonb,boolean,boolean,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_delegated_plan_exceptions_v1(jsonb,uuid,jsonb,boolean,boolean,boolean,boolean) to service_role;
 do $exceptions209_postconditions$ declare ns text;expected_owner oid;installed boolean;has190 boolean;spec jsonb;forward_spec jsonb;own_spec jsonb;f regprocedure;meta record;actual_table regclass;expected_table regclass;foreign_table regclass;table_name text;constraint_spec record;actual_constraint record;index_spec record;actual_index record;trigger_spec jsonb;reference_keys smallint[]; begin select namespace.nspname,catalog_table.relowner into ns,expected_owner from pg_class catalog_table join pg_namespace namespace on namespace.oid=catalog_table.relnamespace where catalog_table.oid='public.merchant_attendance_settings'::regclass;
 if expected_owner is distinct from (select oid from pg_roles where rolname=current_user) then raise exception 'merchant_attendance_delegated_plan_exceptions_owner_conflict';end if;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610090209 and name='merchant_attendance_delegated_plan_exceptions');
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');own_spec:=$exceptions209_dependencies$[{"name":"faolla_attendance_events_append_only_v1","signature":"public.faolla_attendance_events_append_only_v1()","hash":"66b7826feb67a63b33b563d77176ef0ef81b49479657efbd80fbcefcb5512b0a","result":"trigger","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_effect_version_guard_v1","signature":"public.faolla_attendance_effect_version_guard_v1()","hash":"60429c8e854930b86950094ae031fe7cb19b7d4fa5475d3265d057ae912c4b2b","result":"trigger","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_correction_proposal_v1","signature":"public.faolla_attendance_correction_proposal_v1(jsonb,timestamptz)","hash":"d389ec334e368ecb2afcf44ad1a37ff39af028536fff6b30a64d72ca3ad3da9d","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_value","p_now"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_instant_v1","signature":"public.faolla_attendance_instant_v1(text)","hash":"feba243fa6d87442defe285e3c9e4789bae5671c18d09cecb7c65dae6dffe5a5","result":"timestamptz","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_value"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_revision_decision_link_v1","signature":"public.faolla_attendance_revision_decision_link_v1()","hash":"070bf93b624e2925d7b9adae3135b0bbb5aa01938d12586fff16a7fed5e46fc0","result":"trigger","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_missing_effect_guard_v1","signature":"public.faolla_attendance_missing_effect_guard_v1()","hash":"9d89cd60d473f4544f30c1a18ec7f35ffbc7f9963040cc618d65344cc190d4c3","result":"trigger","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_period_seal_insert_guard_v1","signature":"public.faolla_attendance_period_seal_insert_guard_v1()","hash":"81783ba090db4eb3f8c206a9dd6e723c4cd4fca0c581f13062ee4e3f4f2d96f5","result":"trigger","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_period_assert_open_v1","signature":"public.faolla_attendance_period_assert_open_v1(text,uuid,jsonb)","hash":"f92f8fa8ea1a70f48bf72e8b856e564e3eacabec024810146c590224fb3fc965","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_spans"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_review_routing_capture_v1","signature":"public.faolla_attendance_review_routing_capture_v1()","hash":"58342d0420d4a28f4756b3876ba0ac67be750ec379c5a4429615fa967fc63dc3","result":"trigger","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_consumer_item_v1","signature":"public.faolla_attendance_operational_consumer_item_v1(public.merchant_attendance_operational_consumer_activations)","hash":"018cf97af523313e0759e0cc378d80ba1d8bf98b0501ecbaab322b5819afc5a4","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_hash_v1","signature":"public.faolla_attendance_operational_rule_hash_v1(jsonb)","hash":"fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_consumer_command_v1","signature":"public.faolla_attendance_operational_consumer_command_v1(text,text,uuid,jsonb)","hash":"f22ef2fbe33e4214733482e36d121ded8cb9db2f48c3f84fef42faf70de641c7","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_consumer","p_actor","p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_object_v1","signature":"public.faolla_attendance_operational_rule_object_v1(jsonb,text[])","hash":"c2424b9408e816d4f5aee7b271d4e91ea6faf10c7643a940223a1d3896e56ca7","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","ks"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_application_window_scalar_v1","signature":"public.faolla_attendance_application_window_scalar_v1(jsonb,text)","hash":"fa75ce0a10f746cece393962aca52ffcdb191887d4ea6ed06a40b3867ef717db","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","k"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_scalar_v1","signature":"public.faolla_attendance_operational_rule_scalar_v1(jsonb,text)","hash":"99d575e267fe9ec7b8f56dbe92ac412405913695ae3a3085dc1a035c33614fce","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","k"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_text_v1","signature":"public.faolla_attendance_group_text_v1(text,integer,integer)","hash":"b440810c3afb56de19592e1492e16b12cf6faf800ac2f9d0a8e7bdeca2ecc562","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","lo","hi"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_punch_stamp_v1","signature":"public.faolla_attendance_operational_punch_stamp_v1(timestamptz)","hash":"6d0b940b342a28ef5abe117ceb132f80180680cf1a7ac65af88be475f7f879a2","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_review_routing_fact_v1","signature":"public.faolla_attendance_review_routing_fact_v1(text,text,uuid,boolean)","hash":"4de217d5343138427dc0af875cdccff5cf1ca844f087562af61298fcaf00a8f7","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_family","p_request","p_complete"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_correction_summary_v1","signature":"public.faolla_attendance_correction_summary_v1(public.merchant_attendance_correction_entries,public.merchant_attendance_correction_entries)","hash":"4aa9ea02f21c5dde7477666c3b68baffbd2ea49fb84279be4b5a55a4b39660b2","result":"jsonb","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_first","p_last"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_missing_summary_v1","signature":"public.faolla_attendance_missing_summary_v1(public.merchant_attendance_missing_requests)","hash":"b0e0bd86ca4583b4056d81043185d1727c5be85662dc97310e258ed684caad05","result":"jsonb","language":"sql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_leave_summary_v1","signature":"public.faolla_attendance_leave_summary_v1(public.merchant_attendance_leave_requests,integer)","hash":"5df82b03753c90636b8fd9fce15384560490c4f5996fafe1df76ec9e75b09fa6","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":1,"defaultExpression":"NULL::integer","args":["p","p_revision"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_work_arrangement_summary_v1","signature":"public.faolla_attendance_work_arrangement_summary_v1(public.merchant_attendance_work_arrangement_requests,integer)","hash":"a27f471975013268910a5523bf6e7998ce90f2901d25a234663e653ecc8222e5","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":1,"defaultExpression":"NULL::integer","args":["p","p_revision"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_work_arrangement_policy_v1","signature":"public.faolla_attendance_work_arrangement_policy_v1(public.merchant_attendance_work_arrangement_policies)","hash":"8698714418afefbb400b7fa588ef3cd01588a92ff5aabd9048df6688eec94039","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_work_arrangement_command_v1","signature":"public.faolla_attendance_work_arrangement_command_v1(jsonb)","hash":"d64d2d822ae5a0c9f86adf467cbea19aa515d52ca5ad04856866229ccfdc73c6","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_shift_rule_binding_scalar_v1","signature":"public.faolla_attendance_shift_rule_binding_scalar_v1(jsonb,text)","hash":"3d17c1dc4359ef24d5da51b926bc586f857d0b67b6cffda92869015accf3f7f0","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","kind"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_shift_rule_binding_object_v1","signature":"public.faolla_attendance_shift_rule_binding_object_v1(jsonb,text[])","hash":"2a634d258ceab747cb0098c516aa423babe8d7f0203ce9fb24725bc9602ded50","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","keys"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_review_routing_tuple_v1","signature":"public.faolla_attendance_review_routing_tuple_v1(jsonb,text)","hash":"afcd6520c775813bf11d0406e3f62b3cbf08445e1025be6761fc75d522b0d880","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_kind"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_source_stamp_v1","signature":"public.faolla_attendance_operational_source_stamp_v1(text)","hash":"4c2243afe68dfe18fd9de9954ff48803c7b256cd64a7d0e25cb04ff540620265","result":"timestamptz","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_source_v1","signature":"public.faolla_attendance_operational_source_v1(text,uuid,uuid,uuid,timestamptz)","hash":"9a547b0446c317483eb27a3d604011ec671218cda50ff2cf544c002af825cbee","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_employee","p_employee_auth","p_at"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_assignment_detail_v1","signature":"public.faolla_attendance_group_assignment_detail_v1(public.merchant_attendance_group_assignments)","hash":"aa65e21fdec5f8854145dfa71ee3d3e3e4eff34bca59a4cda18bf52fb6af0a82","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_command_v1","signature":"public.faolla_attendance_group_command_v1(jsonb)","hash":"579d7fa2487e8220179294ba36500b39e1a7e828024e8377ad69578da13d61c5","result":"boolean","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_valid_zone_v1","signature":"public.faolla_attendance_valid_zone_v1(text)","hash":"3681c82259aaf0653bbddf12e3904144a53030f6213b0e96cdf6f8d40702657d","result":"boolean","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_zone"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_date_v1","signature":"public.faolla_attendance_group_date_v1(text,text)","hash":"78b42d44e8e4a547db264ec59f7866627284a959b82f0c46f0d646fba5931c8b","result":"boolean","language":"plpgsql","volatility":"s","definer":false,"defaults":1,"defaultExpression":"NULL::text","args":["p","z"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_assignment_item_v1","signature":"public.faolla_attendance_group_assignment_item_v1(public.merchant_attendance_group_assignments)","hash":"475397dc4b3caf6ce0aab4058456d877e456b3744c3703f810cb80750fe67d82","result":"jsonb","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_rule_day_start_v1","signature":"public.faolla_attendance_rule_day_start_v1(text,text)","hash":"5aa3bbe223feed69419c53e22f1d77783b45f8bcae461c3d7d20d340a01faaf1","result":"timestamptz","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p","z"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_personal_rule_end_v1","signature":"public.faolla_attendance_personal_rule_end_v1(text,text)","hash":"db3c640e28878a9ac45f16e0af49df6bd0549169f7af6f5b317159d553f8bd25","result":"timestamptz","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p","z"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_checked_v1","signature":"public.faolla_attendance_group_checked_v1(public.merchant_attendance_groups)","hash":"045838f03a886a8d133419c37148a0c747b58d2a6c6ebe0c8aa85d4d53edd392","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_receipt_v1","signature":"public.faolla_attendance_group_receipt_v1(public.merchant_attendance_group_operations,public.merchant_attendance_groups)","hash":"0e0897b6905d35b557c49667d1b039f7601e939bceef00d521206d760239ce4a","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p","g"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_item_v1","signature":"public.faolla_attendance_group_item_v1(public.merchant_attendance_groups)","hash":"19231ed0c7b2ecf95e91a27dc92caaefcf6aa3b81b908b54b216574c882c6acf","result":"jsonb","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_source_layer_v1","signature":"public.faolla_attendance_operational_source_layer_v1(text,jsonb,timestamptz)","hash":"26cf463e0e5da24c8783c4f085ca8076984243bb787033782cba4a281d58fc40","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_scope","p_at"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_scope_v1","signature":"public.faolla_attendance_operational_rule_scope_v1(jsonb)","hash":"9e323d5672d38255e4f92bc2b0d5f0dd4e6190cbe04b7773bc80e40618f57275","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_check_v1","signature":"public.faolla_attendance_operational_rule_check_v1(text,text,bigint)","hash":"25809b0d345f18bc1558029cf1a1063285744d7b89d76b3e34462231542d7fc8","result":"void","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_key","p_revision"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_item_v1","signature":"public.faolla_attendance_operational_rule_item_v1(public.merchant_attendance_operational_rule_operations)","hash":"6fbb4c8e283366e526e208fae0b53dc41110161bdfd99e0af196a050c2448396","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_command_v1","signature":"public.faolla_attendance_operational_rule_command_v1(jsonb)","hash":"ba2f97fd74fac4343a513b6edf5c9faa34f44c89108908e7e411759b4fa6b5f1","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_context_tuple_v1","signature":"public.faolla_attendance_operational_rule_context_tuple_v1(jsonb,jsonb)","hash":"e0bc60a2402351503edb4ea94cd1791b95644c3f098af0aaefeac253c8264179","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p","s"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_values_v1","signature":"public.faolla_attendance_operational_rule_values_v1(jsonb)","hash":"ff59e8fceee61f8a60694614de50200e48f3e51ffb3d355e73d8f18f22af012b","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_references_tuple_v1","signature":"public.faolla_attendance_operational_rule_references_tuple_v1(jsonb,jsonb,jsonb)","hash":"642dd54d586411b6ac0aa435ad0ad53630eb2a5ed7a74d0559248bf942795a26","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p","s","r"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_source_baseline_v1","signature":"public.faolla_attendance_operational_source_baseline_v1(text,timestamptz,bigint)","hash":"6770099ab00f8827425c14773a8823509350c2745d742a998aff0dc7015019bf","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_at","p_settings_version"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_source_tuple_v1","signature":"public.faolla_attendance_operational_source_tuple_v1(jsonb)","hash":"df3dcf85c4372135967e37153987cc308524026a72d63238043263745bb6a61a","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_review_routing_origin_v1","signature":"public.faolla_attendance_review_routing_origin_v1(jsonb,text,bigint)","hash":"fa9cb981676d6e4f0eed10a73c99b200193c3d4aeb95a0f02502c18933ac7df5","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_source","p_family","p_activation"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_review_routing_choose_v1","signature":"public.faolla_attendance_review_routing_choose_v1(text,text,uuid,jsonb,uuid,timestamptz)","hash":"b60959dc2a537c238c0deedc03a3f240a10a441fab54261afcd9a1cec9eb144d","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_family","p_request","p_origin","p_owner","p_at"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_review_routing_candidates_v1","signature":"public.faolla_attendance_review_routing_candidates_v1(text,jsonb,jsonb,jsonb)","hash":"b6fdd5d441375fedea4328fd289b323d218a5e2b7c860061989552fec08640b8","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_ref","p_delegate","p_cursor"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_review_routing_qualify_v1","signature":"public.faolla_attendance_review_routing_qualify_v1(text,text,uuid,uuid,timestamptz)","hash":"7a867d0c19f5b7dedae30db3f1e9007ad7792702949c333c919e22ac7c7bdff9","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_family","p_request","p_grant","p_at"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_review_routing_grant_v1","signature":"public.faolla_attendance_review_routing_grant_v1(text,text,uuid)","hash":"8de810b68e5a3c994ed78b2e684d40e28967c5ec9f9381a92c64fcf42e233b9c","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_family","p_grant"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_correction_delegation_hash_v1","signature":"public.faolla_attendance_correction_delegation_hash_v1(text,text,jsonb)","hash":"5ab9296fcbf5d0fd65d680b4de9885d0eb2d06c0266bffe425875b9ff10ca62c","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_access","p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_correction_delegation_command_v1","signature":"public.faolla_attendance_correction_delegation_command_v1(jsonb,text)","hash":"555e4a58cfff0d2901d52fe94e411bad67debd2ec8c53b09c5e81ec0308557b7","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_access"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_missing_delegation_hash_v1","signature":"public.faolla_attendance_missing_delegation_hash_v1(text,text,jsonb)","hash":"2d1805657c298a6190ea36d2aa5dc1b35a393db31e305d1ed919eba02441bbcc","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_access","p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_missing_delegation_command_v1","signature":"public.faolla_attendance_missing_delegation_command_v1(jsonb,text)","hash":"7057ec66fa89364c341466660885d7bcf5b5d7abc931b089c5398fdc4021def9","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_access"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_application_delegation_hash_v1","signature":"public.faolla_attendance_application_delegation_hash_v1(text,text,jsonb)","hash":"2d54478110b1df6ea4d37a71899337dd283dc8a3bc63d97fad38db77ec952d09","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_access","p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_application_delegation_command_v1","signature":"public.faolla_attendance_application_delegation_command_v1(jsonb,text)","hash":"39f7db3343e77ee3499b4f7de4583286c109a49f36cdc32387a124586c4164fa","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_access"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_correction_delegation_usable_v1","signature":"public.faolla_attendance_correction_delegation_usable_v1(public.merchant_attendance_correction_delegations,timestamptz)","hash":"95427a0e2ee14be6aac45137a5cc154da56953bb4a7005027822376800fc0f2d","result":"boolean","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_at"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_correction_delegation_scope_v1","signature":"public.faolla_attendance_correction_delegation_scope_v1(jsonb,uuid)","hash":"0349465cb5460fa9cc15e5a12d1936683f52f9d5aef4a8ab976a8f4ca8e215fb","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_basis","p_location"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_correction_owner_basis_v1","signature":"public.faolla_attendance_correction_owner_basis_v1(text,uuid,uuid,uuid,timestamptz)","hash":"2523fe8ecf015e11b1b334bd1d9938b1b956bdeb47557c42e5b299c7eb1dae6e","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_employee","p_start","p_now"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_review_event_v1","signature":"public.faolla_attendance_review_event_v1(public.merchant_attendance_events)","hash":"050efeaa5104ad4f48d9cbe4e8087f9e59bb9cecd5022a9218f82cf9ff1c14c3","result":"jsonb","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_correction_delegation_original_v1","signature":"public.faolla_attendance_correction_delegation_original_v1(jsonb,timestamptz)","hash":"58ad93e2073338a63b5b1edc6deb0837b64949708cee9fff8d47b0e98c2df4b0","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_basis","p_now"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_missing_delegation_usable_v1","signature":"public.faolla_attendance_missing_delegation_usable_v1(public.merchant_attendance_missing_delegations,timestamptz)","hash":"a6511db89e8639edb4f445e42efc345930bce5f08a67ba0ecfba23feee6e99a2","result":"boolean","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_at"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_missing_delegation_usable_pre164","signature":"public.faolla_attendance_missing_delegation_usable_pre164(public.merchant_attendance_missing_delegations,timestamptz)","hash":"68e6c074e4916a35ea9f21b006c67ae3ad28365a885b4b44c75965f2240602c2","result":"boolean","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_at"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_account_grant_current_v1","signature":"public.faolla_attendance_account_grant_current_v1(text,text,uuid,uuid,uuid,uuid,uuid)","hash":"882d5dc7f35d43fb131c536b79b6daf367bdc48bfe5a0550182b4f38d73ba428","result":"boolean","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_channel","p_grant","p_delegate","p_delegate_auth","p_employee","p_auth"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_application_delegation_usable_v1","signature":"public.faolla_attendance_application_delegation_usable_v1(public.merchant_attendance_application_delegations,timestamptz)","hash":"11c1b220fa18dc1b55caf3378b248aa8ccd9914bc44cf4ed132baded58d84dda","result":"boolean","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_at"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_application_delegation_usable_pre164","signature":"public.faolla_attendance_application_delegation_usable_pre164(public.merchant_attendance_application_delegations,timestamptz)","hash":"ccb548d959cd1fa3d44adb41a335e000af899f1a6b62ff52e42249d45d446516","result":"boolean","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_at"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_review_routing_make_v1","signature":"public.faolla_attendance_review_routing_make_v1(text,jsonb,uuid,bigint,text,uuid,timestamptz,text,uuid,jsonb,jsonb,text)","hash":"c8c2cf0b9863ba02d74d2a57d80ecc1c799855ef9267e60fbd8cfa6862018763","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_ref","p_op","p_revision","p_action","p_actor","p_at","p_reason","p_previous","p_origin","p_assignment","p_fingerprint"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_punch_source_ref_v1","signature":"public.faolla_attendance_operational_punch_source_ref_v1(jsonb)","hash":"31e3cf7da541768bfe88b06b896720cf6d32cb47a8550f2375bc4fc8716c62e7","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_punch_hash_v1","signature":"public.faolla_attendance_operational_punch_hash_v1(jsonb)","hash":"fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_schedule_publication_guard_v1","signature":"public.faolla_attendance_schedule_publication_guard_v1()","hash":"f033808d30f1e3225db7f9efdc52b4e93077f198c491f0efe5646c42fff6258e","result":"trigger","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_schedule_delegation_proof_v1","signature":"public.faolla_attendance_schedule_delegation_proof_v1(public.merchant_attendance_schedule_commands)","hash":"6b93ed55f3b5b52a5656f83e67409528d70251c5eb23c5b12d5732eeff44cbaf","result":"boolean","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_schedule_delegation_command_v1","signature":"public.faolla_attendance_schedule_delegation_command_v1(jsonb,text)","hash":"f6bcfa143bf6e2229e3ab1ec8d3c05fca2ed8f71e06653133ca15787f24b70ff","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_access"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_schedule_delegation_hash_v1","signature":"public.faolla_attendance_schedule_delegation_hash_v1(jsonb,jsonb)","hash":"c9f06f82fe3c5331d607c13bebc1da670d086da1350519b82eee4a72e1851693","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_account_capture_v1","signature":"public.faolla_attendance_account_capture_v1(text,uuid,uuid,uuid,boolean)","hash":"c5ba771116846124af37e113086395bad0787b8daaf6f9e5283273cf82337907","result":"uuid","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_employee","p_actor","p_actor_employee","p_enabled"],"searchPath":"search_path=pg_catalog","isRpc":false,"changes":[{"from":"and not exists(select 1 from public.merchant_attendance_correction_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee)) then return null;end if;","to":"and not exists(select 1 from public.merchant_attendance_correction_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee))\n    and not exists(select 1 from public.merchant_attendance_management_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee)) then return null;end if;","count":2}]},{"name":"faolla_attendance_plan_exception_review_command_v1","signature":"public.faolla_attendance_plan_exception_review_command_v1(text,jsonb)","hash":"cf2c6ccdbec1748c94a25349045fd1f12db5ab705b7ea53c19566fceaac4dd2c","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["mode_name","p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_hash_v1","signature":"public.faolla_attendance_management_hash_v1(text,uuid,jsonb)","hash":"0251284215e3c71ba9420c3b7be5cc496699aa5a5cad4a6189da6b9a8361dd84","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_command_v1","signature":"public.faolla_attendance_management_command_v1(jsonb)","hash":"4bfb75e4776588b774e58e64018394a95fb8c802776c3df433dc0259de3a0fd3","result":"void","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scalar_v1","signature":"public.faolla_attendance_management_scalar_v1(jsonb,text)","hash":"1f1afb8930a212c34937f2cfe8b843e9991d9827440c7589afb93a4f2e62ac06","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","k"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scope_v1","signature":"public.faolla_attendance_management_scope_v1(jsonb,text)","hash":"715c2692e308c9562a54fab06f3ab4f0c888378837e6ffdf40e9531ad40ea16c","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","a"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_capability_v1","signature":"public.faolla_attendance_management_capability_v1(text)","hash":"8442e9811c7795f37e06e22fc84cca3d773cb084b19fc3c9528d3f642b97b990","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_array_v1","signature":"public.faolla_attendance_management_array_v1(jsonb,text[],integer,integer)","hash":"01b5e60f56433b2ec408d82c25bc9aec85187175e52482e33a15162d01cacebf","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","allowed","minimum","maximum"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_binding_v1","signature":"public.faolla_attendance_management_binding_v1(jsonb)","hash":"434f3279e8bd6c90d559db026bdeca2d6092749586bb6271146c23ab826358b0","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_current_v1","signature":"public.faolla_attendance_management_current_v1(public.merchant_attendance_management_delegations,timestamptz)","hash":"2148814cd6c45a36a584c6293e8abc8d7db61cdd62d55e06ceadcb0e757b7aa7","result":"boolean","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g","at_time"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scope_context_v1","signature":"public.faolla_attendance_management_scope_context_v1(text,jsonb,text)","hash":"dc5dbf304f62b90e211566ab9ca39a6dbace37341cf06e829f8c478dc681fa8f","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","p","a"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_schedule_publication_slots_v1","signature":"public.faolla_attendance_schedule_publication_slots_v1(jsonb)","hash":"d3ce30323a215892daa9ec20c84a914af9fc5be66b032734dd892bd79a73f5ae","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_exception_source_v1","signature":"public.faolla_attendance_plan_exception_source_v1(jsonb,uuid)","hash":"1234394b481e1e3063d6a12d83bf606e11be1cb8d64b4b86ea194091eb5334b1","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_plan_exception_source_legacy_v1","signature":"public.faolla_attendance_plan_exception_source_legacy_v1(jsonb,uuid)","hash":"89309840b875cf0d530abc9e80fa8c0bcd93a34c64f23053c446a16eeea1bc8c","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_coverage_adoptions_v1","signature":"public.faolla_attendance_plan_coverage_adoptions_v1(jsonb,uuid)","hash":"bd1383469e3692438b3af55a504ef8348f9ef6cdd1e4134e705e0a4c9c227a0f","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_plan_coverage_v1","signature":"public.faolla_attendance_plan_coverage_v1(jsonb,uuid)","hash":"21917f1580f1b831e38064ce9bb003bf146a133858693e6b7a858b516d5f5c73","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_self_schedule_slot_v1","signature":"public.faolla_attendance_self_schedule_slot_v1(public.merchant_attendance_schedule_slots)","hash":"3ea9205bf464f28cde58da98db82c863584e5287c529e3c5a26ae272fb6c374d","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_shift_check_v1","signature":"public.faolla_attendance_shift_check_v1(jsonb,uuid)","hash":"e08de457e5288513a0b53b8ed705fa4fe4369b0f5d81757c64dd93e935070956","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_shift_rule_binding_v1","signature":"public.faolla_attendance_shift_rule_binding_v1(jsonb,uuid)","hash":"e13c2a8d9265985dae141a96fa56d733f77ac2a007b830f07cb3d0be1bfd1437","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_shift_rule_source_valid_v1","signature":"public.faolla_attendance_shift_rule_source_valid_v1(text,text,uuid,text,integer)","hash":"29e3013c06a8c16b9b4ffd304c2ddd6bc5e31d9912d0d1894c922a3abe742cc0","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_text","p_site","p_worker","p_hash","p_bytes"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_shift_rule_fields_v1","signature":"public.faolla_attendance_shift_rule_fields_v1(jsonb)","hash":"d2a7b26a2ab624b8a2e6641b0dc640fff0b7b7f0cedcdec89429223ec95308c3","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_rule_values_v1","signature":"public.faolla_attendance_rule_values_v1(jsonb)","hash":"28d5094d4449869591c121c3780626220a7be7606cd02800b5d233378f8fb26b","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_shift_rule_binding_graph_v1","signature":"public.faolla_attendance_shift_rule_binding_graph_v1(jsonb,timestamptz)","hash":"25936764bb7f717efa27361320a41dac69511f295293a401ab548eba4f903546","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","point_at"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_administrative_boundary_v1","signature":"public.faolla_attendance_administrative_boundary_v1(text,uuid,uuid)","hash":"30f4e7c06f9fd44bd90e321ae8f7f7ec44638ba50e6092ae27cc967dfce196bb","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_start"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_administrative_entry_v1","signature":"public.faolla_attendance_administrative_entry_v1(public.merchant_attendance_administrative_closure_entries)","hash":"d663c9351beed34d63eee7ff75c19abb49e66e4cbc3ce1246fa3d17764ec4203","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_administrative_receipt_v1","signature":"public.faolla_attendance_administrative_receipt_v1(public.merchant_attendance_administrative_closure_entries)","hash":"cb0e6311ed78b29398f5f1bb52f6168258e21e22e802d79d21cbf3bf7afdbcc3","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_administrative_hash_v1","signature":"public.faolla_attendance_administrative_hash_v1(text,uuid,text,jsonb)","hash":"40d352beb1e5896edb8f428d143ae689a6ca7c90036bf5c8372cae0beac00419","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_actor","p_access","p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_administrative_scalar_v1","signature":"public.faolla_attendance_administrative_scalar_v1(jsonb,text)","hash":"814c0a864d7b7383eaf12f06c374ca8440be70c5b1edb5781e665130217ad295","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","k"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_administrative_command_v1","signature":"public.faolla_attendance_administrative_command_v1(jsonb)","hash":"c5ee520a78337d3fb2571743fd4ebf0e56c7abc9e529632731a0486ea7379187","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_administrative_stamp_v1","signature":"public.faolla_attendance_administrative_stamp_v1(timestamptz)","hash":"6d0b940b342a28ef5abe117ceb132f80180680cf1a7ac65af88be475f7f879a2","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_administrative_frame_v1","signature":"public.faolla_attendance_administrative_frame_v1(jsonb)","hash":"b1db19c72584d4f0617a0ac53f425f88e5ee9cae7f4e1600953d2f8adafea03f","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_administrative_scope_v1","signature":"public.faolla_attendance_administrative_scope_v1(jsonb)","hash":"cced0de14b5545e78c9587eec063cd70e49a318259306624f388bb5065004013","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_administrative_context_v1","signature":"public.faolla_attendance_administrative_context_v1(jsonb)","hash":"6770c4f42f603523da703e91c080dd350dc074707142506e1e3982050a6ce8b1","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_administrative_event_v1","signature":"public.faolla_attendance_administrative_event_v1(public.merchant_attendance_events)","hash":"fc6d90a50c6e1f08ff2e090278b3595a6591b0a7a3d9dbdb3d0ce912a1e3beb3","result":"jsonb","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_administrative_pause_v1","signature":"public.faolla_attendance_administrative_pause_v1(public.merchant_attendance_account_suspensions)","hash":"a4300e0f28d15b88fb47d71aca7af2c794e8c4dfbfc0b8de3610cb49f4a28723","result":"jsonb","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_administrative_predecessor_v1","signature":"public.faolla_attendance_administrative_predecessor_v1(text,uuid,public.merchant_attendance_events)","hash":"1a130e666abe5e6fbb6f52941676803fa0051fcff0e3eac042c1eb6c3d8acb56","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_first"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_effect_evidence_v2","signature":"public.faolla_attendance_effect_evidence_v2(public.merchant_attendance_effect_current_v2,timestamptz)","hash":"7399bd61e91171134adb5d421472210ac1efed45009d76312baad368887ab789","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["e","p_now"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_pin_schedule_receipt_v1","signature":"public.faolla_attendance_pin_schedule_receipt_v1(public.merchant_attendance_shift_schedule_relations,uuid)","hash":"a5dddcb339d5f9f44e796ecc6534db042cfdae4a796c1fbdbe398243bde91e0c","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_auth"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_shift_plan_adoption_read_v1","signature":"public.faolla_attendance_shift_plan_adoption_read_v1(jsonb)","hash":"54c3c29563565e964013e55c6796431fd0a98e7f0902115afbafb1e1cd35c5dd","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_check"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_shift_plan_adoption_v1","signature":"public.faolla_attendance_shift_plan_adoption_v1(public.merchant_attendance_shift_schedule_relations,uuid,uuid,boolean,text)","hash":"33961fe42724f6ccdcca379ca6a018b81ea027ac76af922eece3558dee75fd35","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_auth","p_approval_id","p_current","p_channel"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_location_schedule_receipt_v1","signature":"public.faolla_attendance_location_schedule_receipt_v1(public.merchant_attendance_shift_schedule_relations,uuid)","hash":"eeca33a4e024a460711581c3328ec5d912c8be16785fa8c1dc44b8b8fea727c3","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_auth"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_onsite_schedule_receipt_v1","signature":"public.faolla_attendance_onsite_schedule_receipt_v1(public.merchant_attendance_shift_schedule_relations,uuid)","hash":"440d093b1948076ef1dc0c2b3576737ec0720d9dcd7ffbcdf7333a61b9464e5d","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_auth"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_self_schedule_receipt_v1","signature":"public.faolla_attendance_self_schedule_receipt_v1(public.merchant_attendance_shift_schedule_relations,uuid)","hash":"74533c65136630b1af571a06b426d5e9a8a188c98b051850e2dca97cfd015930","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_auth"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_rule_command_v1","signature":"public.faolla_attendance_plan_rule_command_v1(jsonb)","hash":"db15373814794b836726ac2931dd101539149f3ded66f26e4f7a595698ae90a6","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_rule_source_v1","signature":"public.faolla_attendance_plan_rule_source_v1(jsonb)","hash":"24d6fd9b88e2c0bd6d3960b8161728442d1c8334e4d35f03a8794e57b304e86b","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_rule_fields_v1","signature":"public.faolla_attendance_plan_rule_fields_v1(jsonb)","hash":"84622fcb50c1d717ea9060309fd0a1d38259e01f55b8bb47a256395fde8f41ce","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_exception_session_v1","signature":"public.faolla_attendance_plan_exception_session_v1(jsonb)","hash":"7ee3d7e702e361ef426d2f1dec40b53ba3d7b172ae0a84a0d64354c58e80fd05","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_check"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_calendar_summary_v1","signature":"public.faolla_attendance_calendar_summary_v1(public.merchant_attendance_calendar_entries,integer)","hash":"4ffd6f0aaeb6c489707e8ec1d4b17d074fdf3c6f3a3e2e8d028e303545b66858","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":1,"defaultExpression":"NULL::integer","args":["p","p_revision"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_control_day_boundary_v1","signature":"public.faolla_attendance_control_day_boundary_v1(date,text)","hash":"6c1479bd60a7349acc92fe7a2b7552509751e65be5651cc48d102c00834164a8","result":"timestamptz","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_date","p_zone"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_work_arrangement_context_v1","signature":"public.faolla_attendance_work_arrangement_context_v1(text,uuid,uuid,uuid,timestamptz,timestamptz)","hash":"dfdfcdbffb8db9855c91ce3189e4ef8e049cb758b40727d2b4713fdcef8ae21d","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_employee","p_member_auth","p_from","p_to"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_pd_exception_v1","signature":"public.faolla_attendance_pd_exception_v1(jsonb,uuid)","hash":"8c20b5c314dd8f5f932b090ed9301123c6091a7c2ed86422fc8632c595df0fd5","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_pd_exception_legacy_v1","signature":"public.faolla_attendance_pd_exception_legacy_v1(jsonb,uuid)","hash":"472e3a992e9a1282c91bd6021d0bcb4029b7639fbb6166fd35b6becd0dfb3d9c","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_pd_adoptions_v1","signature":"public.faolla_attendance_pd_adoptions_v1(jsonb,uuid)","hash":"2bd55e8af66b971e2f16d03aee7a6daeff1fe01d290a03cd56d71f65b133f7e9","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_pd_coverage_v1","signature":"public.faolla_attendance_pd_coverage_v1(jsonb,uuid)","hash":"677053898b2daa329dd664175e8f40b0c39e664236b2e7829c620c1e28177440","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_pd_shift_v1","signature":"public.faolla_attendance_pd_shift_v1(jsonb,uuid)","hash":"95e9440e1aa03cdc31afd21356160ab6f205a887dc32228da1a9ac7d268d7a9b","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_pd_binding_v1","signature":"public.faolla_attendance_pd_binding_v1(jsonb,uuid)","hash":"bafe9103025f2d8717e840fb10554671bb44459a75065bb5fd1b560a96d7759f","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_exception_review_evidence_v1","signature":"public.faolla_attendance_plan_exception_review_evidence_v1(jsonb)","hash":"b2238eee2d6100256d4d93febf7451a805f3c29c40bc0cad6a6780c27cd7ae8d","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_exception_posthoc_evidence_v1","signature":"public.faolla_attendance_plan_exception_posthoc_evidence_v1(jsonb)","hash":"dd6b43732c116595e1c31fa6160f6a375c4076993e7dcb149d407826d0168d6a","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_exception_review_evidence_legacy_v1","signature":"public.faolla_attendance_plan_exception_review_evidence_legacy_v1(jsonb)","hash":"f5e90e3a18bdb07ed6b2e72beb3c6eab7e874c998c93c239215ead4b1fc2a28b","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_posthoc_formal_leave_v1","signature":"public.faolla_attendance_plan_posthoc_formal_leave_v1(jsonb,jsonb,jsonb)","hash":"3f5dbf083a8bf1deb5a5f0e7165e3597807a78915d61fc2e3866d3b6113b5543","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_plan","p_leave","p_work"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_posthoc_reference_v1","signature":"public.faolla_attendance_plan_posthoc_reference_v1(jsonb)","hash":"b11f18e0e7f7e20e975a10be979645b2954a2b1e82123b64ccd6c4c3cad5c148","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_exception_review_entry_v1","signature":"public.faolla_attendance_plan_exception_review_entry_v1(public.merchant_attendance_plan_exception_entries)","hash":"044e220ca14f67ae05dd30b6b2e88a7d653e74cd1a1926b2496326d4be2d787b","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_posthoc_operation_v1","signature":"public.faolla_attendance_plan_posthoc_operation_v1(public.merchant_attendance_plan_posthoc_operations)","hash":"eb59e0f4bc1b509cfd81551717c10f8a45870cbf25df1a63abbbd161408f5cad","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_posthoc_command_v1","signature":"public.faolla_attendance_plan_posthoc_command_v1(jsonb)","hash":"55f61f66802adeb66becb33e54c010eb1ce102eb7a63f3cd8e15f1741bd5eef2","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_event_notification_capture_v1","signature":"public.faolla_attendance_event_notification_capture_v1(text,text,uuid,uuid,jsonb)","hash":"b5f6cf8f13e36d404a95db730ba74d9a4819fb1ffcf8111429b08f08f18fa16e","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_category","p_operation","p_actor","p_command"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_event_notification_source_v1","signature":"public.faolla_attendance_event_notification_source_v1(text,text,uuid)","hash":"809383292eca0f8d6a595bdbde38d727d138db2d38532b0ae4184bfa8283df3d","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_category","p_operation"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_application_delegation_receipt_v1","signature":"public.faolla_attendance_application_delegation_receipt_v1(public.merchant_attendance_application_delegation_decisions)","hash":"e46bc3a861f15b486c51ce70bd53a779f65e0bcbb619d9d4c16be8fe380f1585","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_application_delegation_request_v1","signature":"public.faolla_attendance_application_delegation_request_v1(text,text,uuid)","hash":"5fb85a9f725390a6d030d4ce7e8e7262447bfb484e04b3ce74d46b867a400a28","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_category","p_request"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_posthoc_formal_source_v1","signature":"public.faolla_attendance_plan_posthoc_formal_source_v1(jsonb,uuid)","hash":"7794ff1971454006e2410476c4848faf3972d0e8bb67039c9acfb13dc32c7d64","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_plan_posthoc_formal_facts_v1","signature":"public.faolla_attendance_plan_posthoc_formal_facts_v1(jsonb,uuid)","hash":"c9c0ced9eca39a7ad6f70710a04ef6f25d8add120839c91beb38ae6e7b70eacc","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_posthoc_adoption_v1","signature":"public.faolla_attendance_plan_posthoc_adoption_v1(jsonb,uuid,jsonb,boolean)","hash":"a12c7b2e71b3c98c379680e3be8a8c592f299e2475fdf6737cb9d1184279288e","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_write"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_plan_posthoc_preview_v1","signature":"public.faolla_attendance_plan_posthoc_preview_v1(jsonb,uuid,integer,uuid)","hash":"9640704dae146d72816cdebc8e4da81bf82b99b242df063ea2251a3c2e20df0c","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id","p_revision","p_current"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_period_plan_rule_v1","signature":"public.faolla_attendance_period_plan_rule_v1(text,uuid,uuid,uuid,uuid,uuid)","hash":"14c5ebcc0ab24aa7cd9334633c76a3bd82484e894b17877168409618651f0e17","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_slot","p_employee","p_member_auth","p_operation"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_period_session_v1","signature":"public.faolla_attendance_period_session_v1(text,uuid,uuid,uuid,uuid,timestamptz)","hash":"d23cef1c4a301f655e3e9d43425671c0b56c5a598062302d25f851b3071d23e2","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_start","p_employee","p_member_auth","p_observed"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_administrative_report_boundary_v1","signature":"public.faolla_attendance_administrative_report_boundary_v1(jsonb)","hash":"546120e124c686ea41f5dfd5fd61c5f25fc6b5ccabbd5b8eea7e9e94ce732f04","result":"jsonb","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_posthoc_missing_v1","signature":"public.faolla_attendance_plan_posthoc_missing_v1(text,uuid,uuid,uuid,uuid)","hash":"c2dd4efcde6b512a2a5a4f00807287fb1173c3ed3127bf2b10b679b35b24f3d3","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_employee","p_auth","p_request"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_posthoc_observation_v1","signature":"public.faolla_attendance_plan_posthoc_observation_v1(text,uuid,uuid,uuid,jsonb,uuid,jsonb,jsonb,timestamptz)","hash":"391fd1674a436ed80bdc3feee19b0d8ac313a23720099553922291457476be4f","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_employee","p_auth","p_slot","p_operation","p_approval","p_saved","p_observed"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_posthoc_formal_compute_v1","signature":"public.faolla_attendance_plan_posthoc_formal_compute_v1(jsonb)","hash":"87a6d349fad373c4a8968c1b314c04bdcae3c64cbb845b8dfb83ed9e8336c48f","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_facts"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_pd_formal_source_v1","signature":"public.faolla_attendance_pd_formal_source_v1(jsonb,uuid)","hash":"df18e7f9c365cd2776cd6db47a634638406aee99f92d0a6db6375f1e47a7d4e3","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_pd_formal_facts_v1","signature":"public.faolla_attendance_pd_formal_facts_v1(jsonb,uuid)","hash":"d3aedf4a521221a406bc64132a522b1350a5df55719391508a5ee6e53bbaac5b","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_pd_posthoc_read_v1","signature":"public.faolla_attendance_pd_posthoc_read_v1(jsonb,uuid)","hash":"5dfbf7d4675cdf1d019756195a1283a12f4e39f9d6e1b8d01a03bb4478b1f20b","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_pd_posthoc_preview_v1","signature":"public.faolla_attendance_pd_posthoc_preview_v1(jsonb,uuid,integer,uuid)","hash":"9f0cdde2690e4c6b3f4b048ddba2eff9d74de42a0b3de702a1209a5b549a2709","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id","p_revision","p_current"],"searchPath":"search_path=pg_catalog","isRpc":false}]$exceptions209_dependencies$::jsonb;
 own_spec:=own_spec||jsonb_build_array(case when has190 then $exceptions209_catalog190${"name":"faolla_valid_merchant_enterprise_permissions_v1","signature":"public.faolla_valid_merchant_enterprise_permissions_v1(text[])","hash":"3d759540cb9f60753053c3012d4bbbc9d14aed92ad86aa9ba7358a0fc2d89792","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_permissions"],"searchPath":"search_path=pg_catalog, public","isRpc":false,"changes":[{"from":"      ('redemptions.view', array[]::text[]),","to":"      ('attendance.workers.manage', array['enterprise.view']::text[]),\n      ('attendance.groups.manage', array['enterprise.view']::text[]),\n      ('attendance.locations.manage', array['enterprise.view']::text[]),\n      ('attendance.rules.draft', array['enterprise.view']::text[]),\n      ('attendance.rules.publish', array['enterprise.view']::text[]),\n      ('attendance.rules.withdraw', array['enterprise.view']::text[]),\n      ('attendance.terminals.pair', array['enterprise.view']::text[]),\n      ('attendance.terminals.revoke', array['enterprise.view']::text[]),\n      ('attendance.pin.issue', array['enterprise.view']::text[]),\n      ('attendance.pin.revoke', array['enterprise.view']::text[]),\n      ('attendance.correction.revision.review', array['enterprise.view']::text[]),\n      ('attendance.plan_exception.review', array['enterprise.view']::text[]),\n      ('attendance.audit.view', array['enterprise.view']::text[]),\n      ('attendance.audit.export', array['enterprise.view']::text[]),\n      ('redemptions.view', array[]::text[]),","count":1}]}$exceptions209_catalog190$::jsonb else $exceptions209_catalog185${"name":"faolla_valid_merchant_enterprise_permissions_v1","signature":"public.faolla_valid_merchant_enterprise_permissions_v1(text[])","hash":"876f0456ae5a911a8dd7de7ebed3ab03aa3b9bb4fa347c9adae4261d4d64c48b","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_permissions"],"searchPath":"search_path=pg_catalog, public","isRpc":false,"changes":[{"from":"      ('redemptions.view', array[]::text[]),","to":"      ('attendance.workers.manage', array['enterprise.view']::text[]),\n      ('attendance.groups.manage', array['enterprise.view']::text[]),\n      ('attendance.locations.manage', array['enterprise.view']::text[]),\n      ('attendance.rules.draft', array['enterprise.view']::text[]),\n      ('attendance.rules.publish', array['enterprise.view']::text[]),\n      ('attendance.rules.withdraw', array['enterprise.view']::text[]),\n      ('attendance.terminals.pair', array['enterprise.view']::text[]),\n      ('attendance.terminals.revoke', array['enterprise.view']::text[]),\n      ('attendance.pin.issue', array['enterprise.view']::text[]),\n      ('attendance.pin.revoke', array['enterprise.view']::text[]),\n      ('attendance.correction.revision.review', array['enterprise.view']::text[]),\n      ('attendance.plan_exception.review', array['enterprise.view']::text[]),\n      ('attendance.audit.view', array['enterprise.view']::text[]),\n      ('attendance.audit.export', array['enterprise.view']::text[]),\n      ('redemptions.view', array[]::text[]),","count":1}]}$exceptions209_catalog185$::jsonb end);
 own_spec:=own_spec||$exceptions209_forwards$[{"name":"faolla_attendance_plan_exception_clearance_execute_v1","signature":"public.faolla_attendance_plan_exception_clearance_execute_v1(jsonb,uuid,jsonb,boolean,boolean,boolean)","hash":"449701832073245222b442d7d5fbb13d80b123bb80dbcc7076c0299d4d683412","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id","p_command","p_allow_write","p_allow_clearance","p_capture_notifications"],"searchPath":"search_path=pg_catalog","isRpc":false,"oldHash":"449701832073245222b442d7d5fbb13d80b123bb80dbcc7076c0299d4d683412","newHash":"847912ce9c2d83fed0e7814b2c00a06c86c6d32826fda5f2f56c0bc36eef4ad7"},{"name":"faolla_attendance_plan_exception_posthoc_execute_v1","signature":"public.faolla_attendance_plan_exception_posthoc_execute_v1(jsonb,uuid,jsonb,boolean,boolean,boolean,boolean)","hash":"a28df0ec556702b0e4fb30e434dc089d853c358a14ab907eab23b6b3a287be5f","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id","p_command","p_allow_write","p_allow_posthoc","p_allow_clearance","p_capture_notifications"],"searchPath":"search_path=pg_catalog","isRpc":false,"oldHash":"a28df0ec556702b0e4fb30e434dc089d853c358a14ab907eab23b6b3a287be5f","newHash":"919d96cc278c1790c0a2b0547339ed54156cd6a4d49edbaa3a8772045d6f44ce"},{"name":"faolla_attendance_management_insert_v1","signature":"public.faolla_attendance_management_insert_v1()","hash":"284e4388128f1bd0984fb5995a0f34cc9f23e2d1d67dfb4f5286cc46c1e006e6","result":"trigger","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false,"from":"if tg_table_name='merchant_attendance_management_delegation_operations' then raise exception 'attendance_management_executor_unavailable';end if;","to":"if tg_table_name='merchant_attendance_management_delegation_operations' then\n  if new.delegated_action='audit_export' then perform public.faolla_attendance_management_audit_authority_v1(new);return new;end if;\n  raise exception 'attendance_management_executor_unavailable';\n end if;","oldHash":"284e4388128f1bd0984fb5995a0f34cc9f23e2d1d67dfb4f5286cc46c1e006e6","newHash":"245e56cd2f82f0f341fe7fffb53008c871a10da226087d7dc9de56c17ca7fb5b"}]$exceptions209_forwards$::jsonb;
 for forward_spec in select value from jsonb_array_elements(own_spec) loop
  if forward_spec ? 'newHash' then forward_spec:=forward_spec||jsonb_build_object('hash',forward_spec->>(case when true then 'newHash' else 'oldHash' end));end if;
  own_spec:=jsonb_build_array(forward_spec);for spec in select value from jsonb_array_elements(own_spec) loop
  f:=to_regprocedure(replace(spec->>'signature','public.',ns||'.'));
  select proc.*,language.lanname into meta from pg_proc proc join pg_language language on language.oid=proc.prolang where proc.oid=f;
  if f is null or meta.proowner is distinct from expected_owner or meta.prosecdef is distinct from (spec->>'definer')::boolean
   or meta.proconfig is distinct from array[replace(spec->>'searchPath','public',ns)] or meta.provolatile::text is distinct from spec->>'volatility'
   or meta.lanname is distinct from spec->>'language' or meta.prorettype is distinct from to_regtype(replace(spec->>'result','public.',ns||'.'))
   or meta.proretset or meta.proisstrict or meta.proleakproof or meta.prokind<>'f' or meta.proparallel<>'u' or meta.prosupport<>0::oid
   or meta.proallargtypes is not null or meta.proargmodes is not null or meta.pronargs<>jsonb_array_length(spec->'args')
   or meta.procost<>100 or meta.prorows<>0 or meta.pronargdefaults<>(spec->>'defaults')::integer
   or coalesce(meta.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'args'))
   or pg_get_expr(meta.proargdefaults,0) is distinct from spec->>'defaultExpression'
   or (select count(*) from pg_proc proc where proc.pronamespace=meta.pronamespace and proc.proname=meta.proname)<>1
   or encode(sha256(convert_to(replace(replace(meta.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from spec->>'hash'
   or has_function_privilege(expected_owner,f,'EXECUTE') is distinct from true
   or (case when spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' then (has_function_privilege(expected_owner,meta.oid,'EXECUTE') is distinct from true
    or (select coalesce(jsonb_agg(jsonb_build_array(a.grantor,a.grantee,a.privilege_type,a.is_grantable) order by a.grantee,a.grantor,a.privilege_type,a.is_grantable),'[]')
     from aclexplode(coalesce(meta.proacl,acldefault('f',meta.proowner))) a) not in(
      jsonb_build_array(jsonb_build_array(expected_owner,expected_owner,'EXECUTE',false)),
      jsonb_build_array(jsonb_build_array(expected_owner,0::oid,'EXECUTE',false),jsonb_build_array(expected_owner,expected_owner,'EXECUTE',false))))
    else has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or has_function_privilege('service_role',f,'EXECUTE') is distinct from (spec->>'isRpc')::boolean
   or exists(select 1 from aclexplode(coalesce(meta.proacl,acldefault('f',meta.proowner))) acl where acl.grantor<>expected_owner
    or acl.grantee<>expected_owner and ((spec->>'isRpc')::boolean is distinct from true or acl.grantee<>(select oid from pg_roles where rolname='service_role') or acl.privilege_type<>'EXECUTE' or acl.is_grantable)) end)
   then raise exception 'merchant_attendance_management_function_conflict';end if;
 end loop;
 end loop;own_spec:=$exceptions209_post_own$[{"name":"faolla_attendance_delegated_plan_exceptions_command_v1","signature":"public.faolla_attendance_delegated_plan_exceptions_command_v1(jsonb)","hash":"dcc6a2df4b822d35fe761912aed4d86aca30c625256d6cf41be796d8c7673cfe","result":"void","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_plan_exceptions_hash_v1","signature":"public.faolla_attendance_delegated_plan_exceptions_hash_v1(text,uuid,uuid,uuid,uuid,jsonb)","hash":"aa4e546aab05cb32d5de1a8ca240ef7d7bc9fc9efd57ae7990a97896b726900f","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id","wid","sid","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_plan_exceptions_authorize_v1","signature":"public.faolla_attendance_delegated_plan_exceptions_authorize_v1(text,uuid,uuid)","hash":"df4904fef58531f6c0da133659831eafc1b106d731f313a22b10ec2cdfd183af","result":"public.merchant_attendance_management_delegations","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_plan_exceptions_target_v1","signature":"public.faolla_attendance_delegated_plan_exceptions_target_v1(public.merchant_attendance_management_delegations,uuid,uuid)","hash":"b88db3f87374ff7ea71b9874df19ae6fbbedc5addb9b969d3a8d87f62c76f6b8","result":"void","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["g","wid","sid"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_plan_exceptions_core_authorize_v1","signature":"public.faolla_attendance_delegated_plan_exceptions_core_authorize_v1(text,uuid,uuid,uuid,uuid,text,text)","hash":"34fd59f9f2e5a954d3413e5c6244930cef2297690f086885c784730115c7b9fa","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id","wid","sid","access_name","mode_name"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_plan_exceptions_clearance_core_v1","signature":"public.faolla_attendance_delegated_plan_exceptions_clearance_core_v1(jsonb,uuid,jsonb,boolean,boolean,boolean,uuid)","hash":"614ec2ce66ef080ab44165c447a41c7ce6db5e41267b96afabe91969c2653329","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id","p_command","p_allow_write","p_allow_clearance","p_capture_notifications","p_grant_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_plan_exceptions_posthoc_core_v1","signature":"public.faolla_attendance_delegated_plan_exceptions_posthoc_core_v1(jsonb,uuid,jsonb,boolean,boolean,boolean,boolean,uuid)","hash":"3d17f15a7f8c18a495ce2b5013376a702016a568dfa69201c67ded776612649c","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id","p_command","p_allow_write","p_allow_posthoc","p_allow_clearance","p_capture_notifications","p_grant_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_plan_exceptions_scope_v1","signature":"public.faolla_attendance_delegated_plan_exceptions_scope_v1(public.merchant_attendance_management_delegations,jsonb)","hash":"4495ccddf9f866eacbf7e2903963c98386a653c927aa1ab951cb47b6d2af91b8","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g","r"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_plan_exceptions_business_v1","signature":"public.faolla_attendance_delegated_plan_exceptions_business_v1(text,uuid)","hash":"6bbe987ae02a7f713459bacb828312f6d1ea28bced7e7d196ebd03a67f2fbccc","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","op"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_plan_exceptions_operation_v1","signature":"public.faolla_attendance_delegated_plan_exceptions_operation_v1(public.merchant_attendance_management_delegation_operations,boolean)","hash":"5363774c28b265089271d091830199cd9ca31e36410a952ca773f877a074afbe","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p","require_current"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_plan_exceptions_authority_v1","signature":"public.faolla_attendance_delegated_plan_exceptions_authority_v1(public.merchant_attendance_management_delegation_operations)","hash":"55182ce4492b78f862e05a7b81456b9dec1ef691c621e58e58a9bfbb9285534f","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_plan_exceptions_receipt_v1","signature":"public.faolla_attendance_delegated_plan_exceptions_receipt_v1(text,uuid,uuid,uuid)","hash":"c621f311944d064a9cf406b50841f34df3cdbdba7f390b5921e9939381cf4036","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id","op"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_plan_exceptions_v1","signature":"public.faolla_attendance_delegated_plan_exceptions_v1(jsonb,uuid,jsonb,boolean,boolean,boolean,boolean)","hash":"91c07fba72874eaf8b3c1b344ed3bf8c1a20b6254f01231e33550ca52691419f","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":5,"defaultExpression":"NULL::jsonb, false, false, false, false","args":["p_query","p_auth_user_id","p_command","p_allow_write","p_allow_posthoc","p_allow_clearance","p_capture_notifications"],"searchPath":"search_path=pg_catalog","isRpc":true}]$exceptions209_post_own$::jsonb;for spec in select value from jsonb_array_elements(own_spec) loop
  f:=to_regprocedure(replace(spec->>'signature','public.',ns||'.'));
  select proc.*,language.lanname into meta from pg_proc proc join pg_language language on language.oid=proc.prolang where proc.oid=f;
  if f is null or meta.proowner is distinct from expected_owner or meta.prosecdef is distinct from (spec->>'definer')::boolean
   or meta.proconfig is distinct from array[replace(spec->>'searchPath','public',ns)] or meta.provolatile::text is distinct from spec->>'volatility'
   or meta.lanname is distinct from spec->>'language' or meta.prorettype is distinct from to_regtype(replace(spec->>'result','public.',ns||'.'))
   or meta.proretset or meta.proisstrict or meta.proleakproof or meta.prokind<>'f' or meta.proparallel<>'u' or meta.prosupport<>0::oid
   or meta.proallargtypes is not null or meta.proargmodes is not null or meta.pronargs<>jsonb_array_length(spec->'args')
   or meta.procost<>100 or meta.prorows<>0 or meta.pronargdefaults<>(spec->>'defaults')::integer
   or coalesce(meta.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'args'))
   or pg_get_expr(meta.proargdefaults,0) is distinct from spec->>'defaultExpression'
   or (select count(*) from pg_proc proc where proc.pronamespace=meta.pronamespace and proc.proname=meta.proname)<>1
   or encode(sha256(convert_to(replace(replace(meta.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from spec->>'hash'
   or has_function_privilege(expected_owner,f,'EXECUTE') is distinct from true
   or (case when spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' then (has_function_privilege(expected_owner,meta.oid,'EXECUTE') is distinct from true
    or (select coalesce(jsonb_agg(jsonb_build_array(a.grantor,a.grantee,a.privilege_type,a.is_grantable) order by a.grantee,a.grantor,a.privilege_type,a.is_grantable),'[]')
     from aclexplode(coalesce(meta.proacl,acldefault('f',meta.proowner))) a) not in(
      jsonb_build_array(jsonb_build_array(expected_owner,expected_owner,'EXECUTE',false)),
      jsonb_build_array(jsonb_build_array(expected_owner,0::oid,'EXECUTE',false),jsonb_build_array(expected_owner,expected_owner,'EXECUTE',false))))
    else has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or has_function_privilege('service_role',f,'EXECUTE') is distinct from (spec->>'isRpc')::boolean
   or exists(select 1 from aclexplode(coalesce(meta.proacl,acldefault('f',meta.proowner))) acl where acl.grantor<>expected_owner
    or acl.grantee<>expected_owner and ((spec->>'isRpc')::boolean is distinct from true or acl.grantee<>(select oid from pg_roles where rolname='service_role') or acl.privilege_type<>'EXECUTE' or acl.is_grantable)) end)
   then raise exception 'merchant_attendance_management_function_conflict';end if;
 end loop;foreach table_name in array array['merchant_attendance_terminals','merchant_attendance_terminal_audit','merchant_attendance_pin_credentials','merchant_attendance_pin_audit','merchant_attendance_pin_attempts','merchant_attendance_independent_subjects','merchant_attendance_independent_entries','merchant_attendance_independent_credentials','merchant_attendance_independent_leases','merchant_attendance_independent_event_sources','merchant_attendance_independent_member_bindings','merchant_attendance_management_delegations','merchant_attendance_management_delegation_revocations','merchant_attendance_management_delegation_operations','merchant_attendance_delegated_credential_proofs','merchant_attendance_revision_requests','merchant_attendance_effect_versions','merchant_attendance_revision_decisions','merchant_attendance_schedule_commands','merchant_attendance_schedule_slots','merchant_attendance_schedule_cancellations','merchant_attendance_schedule_publication_evidence','merchant_attendance_plan_exception_cases','merchant_attendance_plan_exception_entries','merchant_attendance_plan_exception_reads'] loop
 actual_table:=to_regclass(ns||'.'||table_name);expected_table:=to_regclass('pg_temp.'||table_name);
 if not exists(select 1 from pg_class catalog_table where catalog_table.oid=actual_table and catalog_table.relkind='r' and catalog_table.relowner=expected_owner and catalog_table.relrowsecurity and not catalog_table.relforcerowsecurity and catalog_table.relpersistence='p' and not catalog_table.relispartition)
  or exists(select 1 from pg_policy where polrelid=actual_table)
  or exists(select 1 from pg_class catalog_table cross join lateral aclexplode(coalesce(catalog_table.relacl,acldefault('r',catalog_table.relowner))) acl where catalog_table.oid=actual_table and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
  or exists(select 1 from pg_attribute attribute cross join lateral aclexplode(attribute.attacl) acl where attribute.attrelid=actual_table and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
  or (select count(*) from pg_attribute where attrelid=actual_table and attnum>0)<>(select count(*) from pg_attribute where attrelid=expected_table and attnum>0)
  or exists(select 1 from pg_attribute actual join pg_attribute expected on expected.attrelid=expected_table and actual.attnum=expected.attnum
   left join pg_attrdef actual_default on actual_default.adrelid=actual.attrelid and actual_default.adnum=actual.attnum
   left join pg_attrdef expected_default on expected_default.adrelid=expected.attrelid and expected_default.adnum=expected.attnum
   where actual.attrelid=actual_table and actual.attnum>0 and (row(actual.attname,actual.atttypid,actual.atttypmod,actual.attnotnull,actual.atthasdef,actual.attidentity,actual.attgenerated,actual.attndims,actual.attisdropped,actual.attcollation)
    is distinct from row(expected.attname,expected.atttypid,expected.atttypmod,expected.attnotnull,expected.atthasdef,expected.attidentity,expected.attgenerated,expected.attndims,expected.attisdropped,expected.attcollation)
    or pg_get_expr(actual_default.adbin,actual_table) is distinct from pg_get_expr(expected_default.adbin,expected_table))) then raise exception 'merchant_attendance_delegated_plan_exceptions_table_conflict';end if;
 if (select count(*) from pg_constraint where conrelid=actual_table and contype<>'t')<>(select count(*) from pg_constraint where conrelid=expected_table and contype<>'t') then raise exception 'merchant_attendance_delegated_plan_exceptions_constraint_conflict';end if;
 for constraint_spec in select * from pg_constraint where conrelid=expected_table and contype<>'t' loop
  select * into actual_constraint from pg_constraint where conrelid=actual_table and conname=constraint_spec.conname;
  foreign_table:=case when constraint_spec.contype='f' then to_regclass(ns||'.'||(select relname from pg_class where oid=constraint_spec.confrelid)) else 0::oid end;
  select array_agg(actual_ref.attnum::smallint order by requested.ord) into reference_keys from unnest(constraint_spec.confkey) with ordinality requested(attnum,ord)
   join pg_attribute expected_ref on expected_ref.attrelid=constraint_spec.confrelid and expected_ref.attnum=requested.attnum
   join pg_attribute actual_ref on actual_ref.attrelid=foreign_table and actual_ref.attname=expected_ref.attname;
  if actual_constraint.oid is null or row(actual_constraint.contype,actual_constraint.conkey,actual_constraint.confkey,actual_constraint.confrelid,actual_constraint.condeferrable,actual_constraint.condeferred,actual_constraint.convalidated,actual_constraint.confupdtype,actual_constraint.confdeltype,actual_constraint.confmatchtype,actual_constraint.connoinherit,actual_constraint.conislocal,actual_constraint.coninhcount)
   is distinct from row(constraint_spec.contype,constraint_spec.conkey,reference_keys,foreign_table::oid,constraint_spec.condeferrable,constraint_spec.condeferred,true,constraint_spec.confupdtype,constraint_spec.confdeltype,constraint_spec.confmatchtype,constraint_spec.connoinherit,true,0)
   or pg_get_expr(actual_constraint.conbin,actual_table) is distinct from pg_get_expr(constraint_spec.conbin,expected_table) then raise exception 'merchant_attendance_delegated_plan_exceptions_constraint_conflict';end if;
 end loop;
 if (select count(*) from pg_index where indrelid=actual_table)<>(select count(*) from pg_index where indrelid=expected_table) then raise exception 'merchant_attendance_delegated_plan_exceptions_index_conflict';end if;
 for index_spec in select index_row.*,index_table.relname,index_table.relam from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indrelid=expected_table loop
  select index_row.*,index_table.relowner,index_table.relam,index_table.relkind into actual_index from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indexrelid=to_regclass(ns||'.'||index_spec.relname);
  if actual_index.indexrelid is null or actual_index.indrelid<>actual_table or actual_index.relowner<>expected_owner or actual_index.relkind<>'i' or not actual_index.indisvalid or not actual_index.indisready or not actual_index.indislive
   or row(actual_index.relam,actual_index.indnatts,actual_index.indnkeyatts,actual_index.indisunique,actual_index.indisprimary,actual_index.indisexclusion,actual_index.indimmediate,actual_index.indnullsnotdistinct,actual_index.indkey,actual_index.indcollation,actual_index.indclass,actual_index.indoption)
   is distinct from row(index_spec.relam,index_spec.indnatts,index_spec.indnkeyatts,index_spec.indisunique,index_spec.indisprimary,index_spec.indisexclusion,index_spec.indimmediate,index_spec.indnullsnotdistinct,index_spec.indkey,index_spec.indcollation,index_spec.indclass,index_spec.indoption)
   or pg_get_expr(actual_index.indpred,actual_table) is distinct from pg_get_expr(index_spec.indpred,expected_table) or pg_get_expr(actual_index.indexprs,actual_table) is distinct from pg_get_expr(index_spec.indexprs,expected_table) then raise exception 'merchant_attendance_delegated_plan_exceptions_index_conflict';end if;
 end loop;



 if (select count(*) from pg_trigger actual where actual.tgrelid=actual_table and not actual.tgisinternal)<>(select count(*) from jsonb_array_elements($exceptions209_triggers$[{"table":"merchant_attendance_terminal_audit","name":"merchant_attendance_terminal_audit_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_terminal_audit","name":"merchant_attendance_terminal_audit_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_pin_credentials","name":"attendance_account_activation_guard","type":23,"fn":"faolla_attendance_account_activation_guard_v1","deferred":false},{"table":"merchant_attendance_pin_audit","name":"attendance_pin_audit_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_pin_audit","name":"attendance_pin_audit_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_independent_entries","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_entries","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_event_sources","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_event_sources","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_member_bindings","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_member_bindings","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_insert","type":7,"fn":"faolla_attendance_delegated_credentials_proof_insert_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_pair","type":5,"fn":"faolla_attendance_delegated_credentials_pair_v1","deferred":true},{"table":"merchant_attendance_revision_requests","name":"attendance_revision_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_revision_requests","name":"attendance_revision_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_revision_requests","name":"attendance_period_seal_guard","type":7,"fn":"faolla_attendance_period_seal_insert_guard_v1","deferred":false},{"table":"merchant_attendance_revision_requests","name":"review_routing_capture","type":5,"fn":"faolla_attendance_review_routing_capture_v1","deferred":false},{"table":"merchant_attendance_effect_versions","name":"attendance_effect_version_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_effect_versions","name":"attendance_effect_version_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_effect_versions","name":"attendance_period_seal_guard","type":7,"fn":"faolla_attendance_period_seal_insert_guard_v1","deferred":false},{"table":"merchant_attendance_effect_versions","name":"attendance_effect_version_insert_guard","type":7,"fn":"faolla_attendance_effect_version_guard_v1","deferred":false},{"table":"merchant_attendance_effect_versions","name":"attendance_revision_missing_guard","type":5,"fn":"faolla_attendance_missing_effect_guard_v1","deferred":false},{"table":"merchant_attendance_effect_versions","name":"attendance_effect_version_decision_link","type":5,"fn":"faolla_attendance_revision_decision_link_v1","deferred":true},{"table":"merchant_attendance_revision_decisions","name":"attendance_revision_decision_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_revision_decisions","name":"attendance_revision_decision_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_revision_decisions","name":"attendance_revision_decision_effect_link","type":5,"fn":"faolla_attendance_revision_decision_link_v1","deferred":true},{"table":"merchant_attendance_schedule_commands","name":"attendance_schedule_commands_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_commands","name":"attendance_schedule_commands_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_slots","name":"attendance_schedule_slots_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_slots","name":"attendance_schedule_slots_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_cancellations","name":"attendance_schedule_cancellations_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_cancellations","name":"attendance_schedule_cancellations_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_publication_evidence","name":"attendance_schedule_publication_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_publication_evidence","name":"attendance_schedule_publication_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_publication_evidence","name":"attendance_schedule_publication_insert","type":7,"fn":"faolla_attendance_schedule_publication_guard_v1","deferred":false},{"table":"merchant_attendance_plan_exception_cases","name":"attendance_plan_exception_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_plan_exception_cases","name":"attendance_plan_exception_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_plan_exception_entries","name":"attendance_plan_exception_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_plan_exception_entries","name":"attendance_plan_exception_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_plan_exception_reads","name":"attendance_plan_exception_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_plan_exception_reads","name":"attendance_plan_exception_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false}]$exceptions209_triggers$::jsonb) expected where expected->>'table'=table_name) then raise exception 'merchant_attendance_delegated_plan_exceptions_trigger_conflict';end if;
 for trigger_spec in select value from jsonb_array_elements($exceptions209_triggers$[{"table":"merchant_attendance_terminal_audit","name":"merchant_attendance_terminal_audit_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_terminal_audit","name":"merchant_attendance_terminal_audit_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_pin_credentials","name":"attendance_account_activation_guard","type":23,"fn":"faolla_attendance_account_activation_guard_v1","deferred":false},{"table":"merchant_attendance_pin_audit","name":"attendance_pin_audit_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_pin_audit","name":"attendance_pin_audit_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_independent_entries","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_entries","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_event_sources","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_event_sources","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_member_bindings","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_member_bindings","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_insert","type":7,"fn":"faolla_attendance_delegated_credentials_proof_insert_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_pair","type":5,"fn":"faolla_attendance_delegated_credentials_pair_v1","deferred":true},{"table":"merchant_attendance_revision_requests","name":"attendance_revision_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_revision_requests","name":"attendance_revision_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_revision_requests","name":"attendance_period_seal_guard","type":7,"fn":"faolla_attendance_period_seal_insert_guard_v1","deferred":false},{"table":"merchant_attendance_revision_requests","name":"review_routing_capture","type":5,"fn":"faolla_attendance_review_routing_capture_v1","deferred":false},{"table":"merchant_attendance_effect_versions","name":"attendance_effect_version_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_effect_versions","name":"attendance_effect_version_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_effect_versions","name":"attendance_period_seal_guard","type":7,"fn":"faolla_attendance_period_seal_insert_guard_v1","deferred":false},{"table":"merchant_attendance_effect_versions","name":"attendance_effect_version_insert_guard","type":7,"fn":"faolla_attendance_effect_version_guard_v1","deferred":false},{"table":"merchant_attendance_effect_versions","name":"attendance_revision_missing_guard","type":5,"fn":"faolla_attendance_missing_effect_guard_v1","deferred":false},{"table":"merchant_attendance_effect_versions","name":"attendance_effect_version_decision_link","type":5,"fn":"faolla_attendance_revision_decision_link_v1","deferred":true},{"table":"merchant_attendance_revision_decisions","name":"attendance_revision_decision_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_revision_decisions","name":"attendance_revision_decision_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_revision_decisions","name":"attendance_revision_decision_effect_link","type":5,"fn":"faolla_attendance_revision_decision_link_v1","deferred":true},{"table":"merchant_attendance_schedule_commands","name":"attendance_schedule_commands_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_commands","name":"attendance_schedule_commands_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_slots","name":"attendance_schedule_slots_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_slots","name":"attendance_schedule_slots_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_cancellations","name":"attendance_schedule_cancellations_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_cancellations","name":"attendance_schedule_cancellations_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_publication_evidence","name":"attendance_schedule_publication_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_publication_evidence","name":"attendance_schedule_publication_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_schedule_publication_evidence","name":"attendance_schedule_publication_insert","type":7,"fn":"faolla_attendance_schedule_publication_guard_v1","deferred":false},{"table":"merchant_attendance_plan_exception_cases","name":"attendance_plan_exception_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_plan_exception_cases","name":"attendance_plan_exception_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_plan_exception_entries","name":"attendance_plan_exception_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_plan_exception_entries","name":"attendance_plan_exception_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_plan_exception_reads","name":"attendance_plan_exception_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_plan_exception_reads","name":"attendance_plan_exception_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false}]$exceptions209_triggers$::jsonb) where value->>'table'=table_name loop
  if not exists(select 1 from pg_trigger actual where actual.tgrelid=actual_table and actual.tgname=(trigger_spec->>'name')::name and actual.tgtype=(trigger_spec->>'type')::integer
   and actual.tgfoid=to_regprocedure(ns||'.'||(trigger_spec->>'fn')||'()') and actual.tgenabled='O' and actual.tgnargs=0 and actual.tgqual is null and actual.tgparentid=0
   and actual.tgdeferrable=(trigger_spec->>'deferred')::boolean and actual.tginitdeferred=(trigger_spec->>'deferred')::boolean) then raise exception 'merchant_attendance_delegated_plan_exceptions_trigger_conflict';end if;
 end loop;
end loop;
if not exists(select 1 from pg_class actual where actual.oid=to_regclass(ns||'.merchant_attendance_effect_current_v2') and actual.relkind='v' and actual.relowner=expected_owner
 and actual.reloptions is null and not actual.relrowsecurity and not actual.relforcerowsecurity)
 or exists(select 1 from pg_class actual cross join lateral aclexplode(coalesce(actual.relacl,acldefault('r',actual.relowner))) acl
  where actual.oid=to_regclass(ns||'.merchant_attendance_effect_current_v2') and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
 or exists(select 1 from pg_attribute attribute cross join lateral aclexplode(attribute.attacl) acl where attribute.attrelid=to_regclass(ns||'.merchant_attendance_effect_current_v2') and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
 or pg_get_viewdef(to_regclass(ns||'.merchant_attendance_effect_current_v2'),true) is distinct from pg_get_viewdef('pg_temp.revisions208_current_template'::regclass,true)
 then raise exception 'merchant_attendance_delegated_plan_exceptions_view_conflict';end if;
 if (select count(*) from exceptions209_forward_metadata)<>3 or exists(select 1 from exceptions209_forward_metadata original left join pg_proc proc on proc.oid=original.oid where proc.oid is null or to_jsonb(proc)-array['prosrc','proargdefaults'] is distinct from original.metadata or pg_get_expr(proc.proargdefaults,0) is distinct from original.default_expression) then raise exception 'merchant_attendance_delegated_plan_exceptions_forward_metadata_changed';end if;
 end;$exceptions209_postconditions$;
 drop view pg_temp.revisions208_current_template;
 drop table pg_temp.exceptions209_forward_metadata,pg_temp.merchant_attendance_plan_exception_reads,pg_temp.merchant_attendance_plan_exception_entries,pg_temp.merchant_attendance_plan_exception_cases,pg_temp.merchant_attendance_schedule_publication_evidence,pg_temp.merchant_attendance_schedule_cancellations,pg_temp.merchant_attendance_schedule_slots,pg_temp.merchant_attendance_schedule_commands,pg_temp.merchant_attendance_correction_controls,pg_temp.merchant_attendance_correction_decisions,pg_temp.merchant_attendance_correction_effects,pg_temp.merchant_attendance_revision_decisions,pg_temp.merchant_attendance_effect_versions,pg_temp.merchant_attendance_revision_requests,pg_temp.merchant_attendance_delegated_credential_proofs,pg_temp.merchant_attendance_management_delegation_operations,pg_temp.merchant_attendance_management_delegation_revocations,pg_temp.merchant_attendance_management_delegations,pg_temp.merchant_attendance_independent_member_bindings,pg_temp.merchant_attendance_independent_event_sources,pg_temp.merchant_attendance_independent_leases,pg_temp.merchant_attendance_independent_credentials,pg_temp.merchant_attendance_independent_entries,pg_temp.merchant_attendance_independent_subjects,pg_temp.merchant_attendance_pin_attempts,pg_temp.merchant_attendance_pin_audit,pg_temp.merchant_attendance_pin_credentials,pg_temp.merchant_attendance_terminal_audit,pg_temp.merchant_attendance_terminals,pg_temp.merchant_attendance_events,pg_temp.merchant_enterprise_employees,pg_temp.merchant_attendance_workers,pg_temp.merchant_attendance_locations,pg_temp.merchant_attendance_settings;
--END GENERATED DELEGATED PLAN EXCEPTIONS POSTCONDITIONS
insert into public.faolla_schema_migrations(version,name) values(202610090209,'merchant_attendance_delegated_plan_exceptions') on conflict(version) do nothing;
notify pgrst,'reload schema';
commit;
