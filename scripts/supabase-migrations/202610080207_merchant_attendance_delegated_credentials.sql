--207 local/default-off SOURCE candidate. Real actor, no owner impersonation.
--Only prepare/revoke terminals and issue/revoke member/independent PINs.
begin;
set local lock_timeout='3s';
--BEGIN GENERATED DELEGATED CREDENTIALS PREFLIGHT
do $credentials207_prerequisites$ begin
 if not exists(select 1 from public.faolla_schema_migrations where version=202610080206 and name='merchant_attendance_delegated_rules')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080196 and name='merchant_attendance_independent_workers') then raise exception 'merchant_attendance_delegated_credentials_prerequisite_required';end if;
 if exists(select 1 from public.faolla_schema_migrations where version=202610080207 and name<>'merchant_attendance_delegated_credentials') then raise exception 'merchant_attendance_delegated_credentials_installation_conflict';end if;
 end;$credentials207_prerequisites$;
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
 create temp table credentials207_forward_metadata on commit drop as select proc.oid,to_jsonb(proc)-array['prosrc','proargdefaults'] metadata,pg_get_expr(proc.proargdefaults,0) default_expression from pg_proc proc where proc.oid in('public.faolla_attendance_terminal_admin_v1(text,uuid,jsonb,jsonb,boolean)'::regprocedure,'public.faolla_attendance_pin_admin_v1(text,uuid,text,uuid,jsonb,boolean)'::regprocedure,'public.faolla_attendance_independent_admin_v1(text,uuid,jsonb,jsonb,jsonb,boolean)'::regprocedure,'public.faolla_attendance_terminal_snapshot_v1(text,uuid,timestamptz)'::regprocedure,'public.faolla_attendance_management_insert_v1()'::regprocedure);
 do $credentials207_preflight$ declare ns text;expected_owner oid;installed boolean;has190 boolean;spec jsonb;forward_spec jsonb;own_spec jsonb;f regprocedure;meta record;actual_table regclass;expected_table regclass;foreign_table regclass;table_name text;constraint_spec record;actual_constraint record;index_spec record;actual_index record;trigger_spec jsonb;reference_keys smallint[]; begin select namespace.nspname,catalog_table.relowner into ns,expected_owner from pg_class catalog_table join pg_namespace namespace on namespace.oid=catalog_table.relnamespace where catalog_table.oid='public.merchant_attendance_settings'::regclass;
 if expected_owner is distinct from (select oid from pg_roles where rolname=current_user) then raise exception 'merchant_attendance_delegated_credentials_owner_conflict';end if;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080207 and name='merchant_attendance_delegated_credentials');
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');own_spec:=$credentials207_dependencies$[{"name":"faolla_attendance_terminal_device_v1","signature":"public.faolla_attendance_terminal_device_v1(text,uuid,text,text,boolean)","hash":"268246908e643bebaba3519ae75117ef677d787de57535f571bee8d929ca7e99","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":["p_site","p_id","p_secret_hash","p_device_hash","p_allow_pair"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_independent_guard_v1","signature":"public.faolla_attendance_independent_guard_v1()","hash":"11a8d826bae099d9bcafad651222d8ef126f728670f16fc3143473fc42e40040","result":"trigger","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_independent_clock_receipt_v1","signature":"public.faolla_attendance_independent_clock_receipt_v1(public.merchant_attendance_independent_event_sources)","hash":"2bc9d92fa75ece3a3334ea0b88463945addcf7794b8dc07a7edfce95bec600ec","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_independent_clock_hash_v1","signature":"public.faolla_attendance_independent_clock_hash_v1(text,uuid,jsonb)","hash":"a8a07a7b3153c18e908f00bc101a8f6fd861b362235ad9350f41c8eac03e4e61","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_terminal","p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_hash_v1","signature":"public.faolla_attendance_operational_rule_hash_v1(jsonb)","hash":"fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_independent_clock_command_v1","signature":"public.faolla_attendance_independent_clock_command_v1(jsonb)","hash":"e32cd78012dd50709c4964a340b2d568f96ce2a98445c9cdd8a2ae2a0ee31c37","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_object_v1","signature":"public.faolla_attendance_operational_rule_object_v1(jsonb,text[])","hash":"c2424b9408e816d4f5aee7b271d4e91ea6faf10c7643a940223a1d3896e56ca7","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","ks"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_independent_scalar_v1","signature":"public.faolla_attendance_independent_scalar_v1(jsonb,text)","hash":"a3a0121cbb19210074802f404631eebc48bcaceb2f585c921a94548b9191276d","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","k"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_date_v1","signature":"public.faolla_attendance_group_date_v1(text,text)","hash":"78b42d44e8e4a547db264ec59f7866627284a959b82f0c46f0d646fba5931c8b","result":"boolean","language":"plpgsql","volatility":"s","definer":false,"defaults":1,"defaultExpression":"NULL::text","args":["p","z"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_valid_zone_v1","signature":"public.faolla_attendance_valid_zone_v1(text)","hash":"3681c82259aaf0653bbddf12e3904144a53030f6213b0e96cdf6f8d40702657d","result":"boolean","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_zone"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_scalar_v1","signature":"public.faolla_attendance_operational_rule_scalar_v1(jsonb,text)","hash":"99d575e267fe9ec7b8f56dbe92ac412405913695ae3a3085dc1a035c33614fce","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","k"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_punch_stamp_v1","signature":"public.faolla_attendance_operational_punch_stamp_v1(timestamptz)","hash":"6d0b940b342a28ef5abe117ceb132f80180680cf1a7ac65af88be475f7f879a2","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_independent_admin_hash_v1","signature":"public.faolla_attendance_independent_admin_hash_v1(text,uuid,jsonb)","hash":"654b0148881c9efafdefcaa3ece775fe0a3d1a1e8525eedc23cca2aeeb70efcb","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_auth","p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_independent_command_v1","signature":"public.faolla_attendance_independent_command_v1(jsonb)","hash":"f2e26335f15c0fdcb86e5cb7f5492c9e0f1fdf56dd03c5f60148a80f23b986ca","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_independent_text_v1","signature":"public.faolla_attendance_independent_text_v1(text,integer,integer)","hash":"ac9ef43eae2eb7946af62d07d128732dcd6efbe9baeca956a9cbeabe34daa5c9","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","lo","hi"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_text_v1","signature":"public.faolla_attendance_group_text_v1(text,integer,integer)","hash":"b440810c3afb56de19592e1492e16b12cf6faf800ac2f9d0a8e7bdeca2ecc562","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","lo","hi"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_account_capture_v1","signature":"public.faolla_attendance_account_capture_v1(text,uuid,uuid,uuid,boolean)","hash":"c5ba771116846124af37e113086395bad0787b8daaf6f9e5283273cf82337907","result":"uuid","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_employee","p_actor","p_actor_employee","p_enabled"],"searchPath":"search_path=pg_catalog","isRpc":false,"changes":[{"from":"and not exists(select 1 from public.merchant_attendance_correction_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee)) then return null;end if;","to":"and not exists(select 1 from public.merchant_attendance_correction_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee))\n    and not exists(select 1 from public.merchant_attendance_management_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee)) then return null;end if;","count":2}]},{"name":"faolla_attendance_account_activation_guard_v1","signature":"public.faolla_attendance_account_activation_guard_v1()","hash":"2a4f30a259800b7f0e9fda5104f3f16c94629939c28e486962fced41fea4851a","result":"trigger","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scalar_v1","signature":"public.faolla_attendance_management_scalar_v1(jsonb,text)","hash":"1f1afb8930a212c34937f2cfe8b843e9991d9827440c7589afb93a4f2e62ac06","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","k"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_shift_rule_binding_object_v1","signature":"public.faolla_attendance_shift_rule_binding_object_v1(jsonb,text[])","hash":"2a634d258ceab747cb0098c516aa423babe8d7f0203ce9fb24725bc9602ded50","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","keys"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_current_v1","signature":"public.faolla_attendance_management_current_v1(public.merchant_attendance_management_delegations,timestamptz)","hash":"2148814cd6c45a36a584c6293e8abc8d7db61cdd62d55e06ceadcb0e757b7aa7","result":"boolean","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g","at_time"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scope_context_v1","signature":"public.faolla_attendance_management_scope_context_v1(text,jsonb,text)","hash":"dc5dbf304f62b90e211566ab9ca39a6dbace37341cf06e829f8c478dc681fa8f","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","p","a"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scope_v1","signature":"public.faolla_attendance_management_scope_v1(jsonb,text)","hash":"715c2692e308c9562a54fab06f3ab4f0c888378837e6ffdf40e9531ad40ea16c","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","a"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_capability_v1","signature":"public.faolla_attendance_management_capability_v1(text)","hash":"8442e9811c7795f37e06e22fc84cca3d773cb084b19fc3c9528d3f642b97b990","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_array_v1","signature":"public.faolla_attendance_management_array_v1(jsonb,text[],integer,integer)","hash":"01b5e60f56433b2ec408d82c25bc9aec85187175e52482e33a15162d01cacebf","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","allowed","minimum","maximum"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_binding_v1","signature":"public.faolla_attendance_management_binding_v1(jsonb)","hash":"434f3279e8bd6c90d559db026bdeca2d6092749586bb6271146c23ab826358b0","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_hash_v1","signature":"public.faolla_attendance_management_hash_v1(text,uuid,jsonb)","hash":"0251284215e3c71ba9420c3b7be5cc496699aa5a5cad4a6189da6b9a8361dd84","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_command_v1","signature":"public.faolla_attendance_management_command_v1(jsonb)","hash":"4bfb75e4776588b774e58e64018394a95fb8c802776c3df433dc0259de3a0fd3","result":"void","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_pin_member_v1","signature":"public.faolla_attendance_pin_member_v1(text,text)","hash":"e5a6a21813de4e52ad6824d4821fe30d2a0bea46964648df6958526eeb4330bf","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_no"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_independent_material_hash_v1","signature":"public.faolla_attendance_independent_material_hash_v1(text,uuid,uuid,bigint,bigint,uuid,text,text)","hash":"d63aa1239d9964f16a9315935d486df25fba48bd9d328ef3967ada14cea6d0b3","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_subject","p_generation","p_revision","p_operation","p_salt","p_verifier"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_independent_receipt_v1","signature":"public.faolla_attendance_independent_receipt_v1(public.merchant_attendance_independent_entries)","hash":"882f13eeefc384d03eb3178648f4fa2ab1cd2890b6ed869336b5e9dbbc6df334","result":"jsonb","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_independent_subject_v1","signature":"public.faolla_attendance_independent_subject_v1(public.merchant_attendance_independent_subjects)","hash":"8d52a2ef476f26d901b91a06b300b5a170e62387eaee03281a861c9ede2b4320","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_independent_report_v1","signature":"public.faolla_attendance_independent_report_v1(text,uuid,date,date,uuid)","hash":"973fc3e6a226fb4f14a98097935eb6be8e0e8be52103f75adc5906447f08fbcd","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_subject","p_from","p_through","p_cursor"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_control_day_boundary_v1","signature":"public.faolla_attendance_control_day_boundary_v1(date,text)","hash":"6c1479bd60a7349acc92fe7a2b7552509751e65be5651cc48d102c00834164a8","result":"timestamptz","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_date","p_zone"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_independent_head_v1","signature":"public.faolla_attendance_independent_head_v1(text,uuid,uuid)","hash":"21eb62ecdfc08d4bf553b08aa2e895e85a9fc05c1f59610f3dccb8f72c928621","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_subject"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_independent_boundary_v1","signature":"public.faolla_attendance_independent_boundary_v1(public.merchant_attendance_independent_member_bindings)","hash":"067ecfc192485c414fcf55e9345a0fb9dcf3286f8a0cb5bc7fe2e0921ab48770","result":"jsonb","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false}]$credentials207_dependencies$::jsonb;
 own_spec:=own_spec||jsonb_build_array(case when has190 then $credentials207_catalog190${"name":"faolla_valid_merchant_enterprise_permissions_v1","signature":"public.faolla_valid_merchant_enterprise_permissions_v1(text[])","hash":"3d759540cb9f60753053c3012d4bbbc9d14aed92ad86aa9ba7358a0fc2d89792","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_permissions"],"searchPath":"search_path=pg_catalog, public","isRpc":false,"changes":[{"from":"      ('redemptions.view', array[]::text[]),","to":"      ('attendance.workers.manage', array['enterprise.view']::text[]),\n      ('attendance.groups.manage', array['enterprise.view']::text[]),\n      ('attendance.locations.manage', array['enterprise.view']::text[]),\n      ('attendance.rules.draft', array['enterprise.view']::text[]),\n      ('attendance.rules.publish', array['enterprise.view']::text[]),\n      ('attendance.rules.withdraw', array['enterprise.view']::text[]),\n      ('attendance.terminals.pair', array['enterprise.view']::text[]),\n      ('attendance.terminals.revoke', array['enterprise.view']::text[]),\n      ('attendance.pin.issue', array['enterprise.view']::text[]),\n      ('attendance.pin.revoke', array['enterprise.view']::text[]),\n      ('attendance.correction.revision.review', array['enterprise.view']::text[]),\n      ('attendance.plan_exception.review', array['enterprise.view']::text[]),\n      ('attendance.audit.view', array['enterprise.view']::text[]),\n      ('attendance.audit.export', array['enterprise.view']::text[]),\n      ('redemptions.view', array[]::text[]),","count":1}]}$credentials207_catalog190$::jsonb else $credentials207_catalog185${"name":"faolla_valid_merchant_enterprise_permissions_v1","signature":"public.faolla_valid_merchant_enterprise_permissions_v1(text[])","hash":"876f0456ae5a911a8dd7de7ebed3ab03aa3b9bb4fa347c9adae4261d4d64c48b","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_permissions"],"searchPath":"search_path=pg_catalog, public","isRpc":false,"changes":[{"from":"      ('redemptions.view', array[]::text[]),","to":"      ('attendance.workers.manage', array['enterprise.view']::text[]),\n      ('attendance.groups.manage', array['enterprise.view']::text[]),\n      ('attendance.locations.manage', array['enterprise.view']::text[]),\n      ('attendance.rules.draft', array['enterprise.view']::text[]),\n      ('attendance.rules.publish', array['enterprise.view']::text[]),\n      ('attendance.rules.withdraw', array['enterprise.view']::text[]),\n      ('attendance.terminals.pair', array['enterprise.view']::text[]),\n      ('attendance.terminals.revoke', array['enterprise.view']::text[]),\n      ('attendance.pin.issue', array['enterprise.view']::text[]),\n      ('attendance.pin.revoke', array['enterprise.view']::text[]),\n      ('attendance.correction.revision.review', array['enterprise.view']::text[]),\n      ('attendance.plan_exception.review', array['enterprise.view']::text[]),\n      ('attendance.audit.view', array['enterprise.view']::text[]),\n      ('attendance.audit.export', array['enterprise.view']::text[]),\n      ('redemptions.view', array[]::text[]),","count":1}]}$credentials207_catalog185$::jsonb end);
 own_spec:=own_spec||$credentials207_forwards$[{"name":"faolla_attendance_terminal_admin_v1","signature":"public.faolla_attendance_terminal_admin_v1(text,uuid,jsonb,jsonb,boolean)","hash":"55c20b87de72d6bb5d5ac6465cffa72c7dd1e725cfb34ca871ff8ad5c4703d17","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":["p_site","p_auth","p_query","p_command","p_allow_create"],"searchPath":"search_path=pg_catalog","isRpc":true,"coreArgs":"p_site text,p_auth uuid,p_query jsonb,p_command jsonb,p_allow_create boolean,p_grant_id uuid","oldHash":"55c20b87de72d6bb5d5ac6465cffa72c7dd1e725cfb34ca871ff8ad5c4703d17","newHash":"02f7d6491fc45f3184838208d3301190fdc0e5ce86122b20d143c4431eaf1f85"},{"name":"faolla_attendance_pin_admin_v1","signature":"public.faolla_attendance_pin_admin_v1(text,uuid,text,uuid,jsonb,boolean)","hash":"5576a8f69dbf2af7b3e6171aca170f1109791ea6aa267961e0e3618adaa59bf2","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":["p_site","p_auth","p_no","p_operation","p_command","p_allow_set"],"searchPath":"search_path=pg_catalog","isRpc":true,"coreArgs":"p_site text,p_auth uuid,p_no text,p_operation uuid,p_command jsonb,p_allow_set boolean,p_grant_id uuid","oldHash":"5576a8f69dbf2af7b3e6171aca170f1109791ea6aa267961e0e3618adaa59bf2","newHash":"0001e27faaf9ff6f077a87e86282788fb8c400b8e15aaacaf18348ab94b3fa86"},{"name":"faolla_attendance_independent_admin_v1","signature":"public.faolla_attendance_independent_admin_v1(text,uuid,jsonb,jsonb,jsonb,boolean)","hash":"95f6be0160c2b667dae62536b9c94c0abc4d76edc573c0eb7f747e0042e529bb","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":["p_site","p_auth","p_query","p_command","p_material","p_allow_new"],"searchPath":"search_path=pg_catalog","isRpc":true,"coreArgs":"p_site text,p_auth uuid,p_query jsonb,p_command jsonb,p_material jsonb,p_allow_new boolean,p_grant_id uuid","oldHash":"95f6be0160c2b667dae62536b9c94c0abc4d76edc573c0eb7f747e0042e529bb","newHash":"0de6259d3eaed84ffae30a751e53c0d90300b939450a3c63713a95b3c3979df6"},{"name":"faolla_attendance_terminal_snapshot_v1","signature":"public.faolla_attendance_terminal_snapshot_v1(text,uuid,timestamptz)","hash":"eeffc89f77cba9000046a15c7c95bfade2664c8543b419c77f6d45b53c2d70ac","result":"jsonb","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_id","p_now"],"searchPath":"search_path=pg_catalog","isRpc":false,"oldHash":"eeffc89f77cba9000046a15c7c95bfade2664c8543b419c77f6d45b53c2d70ac","newHash":"7a5620c7281bf0c424270f9f5b2272f7c1a26e0bb15a79a66b6a0228089dc0d8"},{"name":"faolla_attendance_management_insert_v1","signature":"public.faolla_attendance_management_insert_v1()","hash":"37216d21b66510291fb3833781951ffeef20218594879bfcb4729fea7496c4be","result":"trigger","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false,"from":"if tg_table_name='merchant_attendance_management_delegation_operations' then raise exception 'attendance_management_executor_unavailable';end if;","to":"if tg_table_name='merchant_attendance_management_delegation_operations' then\n  if new.delegated_action='audit_export' then perform public.faolla_attendance_management_audit_authority_v1(new);return new;end if;\n  raise exception 'attendance_management_executor_unavailable';\n end if;","oldHash":"37216d21b66510291fb3833781951ffeef20218594879bfcb4729fea7496c4be","newHash":"c46a7ada6f8cbe703bd11496d71d4b97ac2ab7e7bb19152b48c3aa0835c3cc57"}]$credentials207_forwards$::jsonb;
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
 end loop;
 if (to_regclass(ns||'.merchant_attendance_delegated_credential_proofs') is not null)<>installed
  or (select count(*) from pg_proc proc where proc.pronamespace=(select oid from pg_namespace where nspname=ns) and proc.proname=any(array['faolla_attendance_delegated_credentials_command_v1','faolla_attendance_delegated_credentials_hash_v1','faolla_attendance_delegated_credentials_member_material_v1','faolla_attendance_delegated_credentials_current_v1','faolla_attendance_delegated_credentials_authorize_v1','faolla_attendance_delegated_credentials_core_authorize_v1','faolla_attendance_delegated_credentials_terminal_core_v1','faolla_attendance_delegated_credentials_member_core_v1','faolla_attendance_delegated_credentials_independent_core_v1','faolla_attendance_delegated_credentials_business_v1','faolla_attendance_delegated_credentials_proof_v1','faolla_attendance_delegated_credentials_authority_v1','faolla_attendance_delegated_credentials_receipt_v1','faolla_attendance_delegated_credentials_issuer_v1','faolla_attendance_delegated_credentials_proof_insert_v1','faolla_attendance_delegated_credentials_pair_v1','faolla_attendance_delegated_credentials_execute_v1','faolla_attendance_delegated_terminals_v1','faolla_attendance_delegated_pin_v1']))<>(case when installed then 19 else 0 end) then raise exception 'merchant_attendance_delegated_credentials_installation_conflict';end if;
 if installed then own_spec:=$credentials207_own$[{"name":"faolla_attendance_delegated_credentials_command_v1","signature":"public.faolla_attendance_delegated_credentials_command_v1(jsonb)","hash":"aac1e0b9018a4c67bd4fff88299d74496501c789da0172a50c5364bc2dff53c7","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_hash_v1","signature":"public.faolla_attendance_delegated_credentials_hash_v1(text,uuid,uuid,jsonb)","hash":"acf2b45fb2ad56fc5ef75e46b23cf01ec0421fe83ee62aee1a708f1c9e4e50d5","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_member_material_v1","signature":"public.faolla_attendance_delegated_credentials_member_material_v1(text,uuid,uuid,jsonb,jsonb)","hash":"26cd0bfefddb2e0f238fa5964686fb6bee31e5d8d5c40b07647fb86695f10614","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id","c","material"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_current_v1","signature":"public.faolla_attendance_delegated_credentials_current_v1(public.merchant_attendance_management_delegations,timestamptz,jsonb,boolean)","hash":"d67e38e9f61e12b3e27870e43a190d79e997adede8c1521437ee404b5f9ad524","result":"boolean","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g","stamp","c","postimage"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_authorize_v1","signature":"public.faolla_attendance_delegated_credentials_authorize_v1(text,uuid,uuid,jsonb,boolean,timestamptz)","hash":"57e073f9f664398cb9c4f8cd6761fdba7afbe75abf115084cf27abd5962bf6cf","result":"public.merchant_attendance_management_delegations","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id","c","postimage","stamp"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_core_authorize_v1","signature":"public.faolla_attendance_delegated_credentials_core_authorize_v1(text,uuid,uuid,text,text,jsonb)","hash":"0ca0ed9232db3ea91efb5f9671c5a1c7346bba3ead2929fb5d172f78f087897b","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id","family","target","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_terminal_core_v1","signature":"public.faolla_attendance_delegated_credentials_terminal_core_v1(text,uuid,jsonb,jsonb,boolean,uuid)","hash":"ebc0b55f2234eadeef8540ca26c739be6f31f3af66dd3551de3a6b31d639af86","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_auth","p_query","p_command","p_allow_create","p_grant_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_member_core_v1","signature":"public.faolla_attendance_delegated_credentials_member_core_v1(text,uuid,text,uuid,jsonb,boolean,uuid)","hash":"38b1c18eb0b35977abf17fce8b970158fc66989e0ac0e427a6e41359cfd4c530","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_auth","p_no","p_operation","p_command","p_allow_set","p_grant_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_independent_core_v1","signature":"public.faolla_attendance_delegated_credentials_independent_core_v1(text,uuid,jsonb,jsonb,jsonb,boolean,uuid)","hash":"35105d744200f059536ad2c5158fb013b1845d4c01845a9c33efd5defbc53db7","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_auth","p_query","p_command","p_material","p_allow_new","p_grant_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_business_v1","signature":"public.faolla_attendance_delegated_credentials_business_v1(text,uuid,uuid,jsonb,text)","hash":"be5da7e5a4b6d80bc6648d101281111e4a64475e704202a2ad16bbcb23c8e4fc","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id","c","material_commitment"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_proof_v1","signature":"public.faolla_attendance_delegated_credentials_proof_v1(public.merchant_attendance_management_delegation_operations,boolean)","hash":"28a999ed375687ed6843aa86532a98fdbca22d1e9fe16561625b4b0f25a7125c","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p","require_current"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_authority_v1","signature":"public.faolla_attendance_delegated_credentials_authority_v1(public.merchant_attendance_management_delegation_operations)","hash":"cdcd68af237e8ec08eb0c23c69bc72616ee8c36acea7bf0da6c3e6df182f01a6","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_receipt_v1","signature":"public.faolla_attendance_delegated_credentials_receipt_v1(text,uuid,uuid,uuid)","hash":"629e9c672542b1ba2f682e7e29319a1a219f823511a2666962f8533556d5054b","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","op","actor","id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_issuer_v1","signature":"public.faolla_attendance_delegated_credentials_issuer_v1(text,uuid)","hash":"3de5f75f00be88b3dc40782eb6b52e8d172b38aee10bcc7ebeceee1d86e21b4c","result":"boolean","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","terminal_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_proof_insert_v1","signature":"public.faolla_attendance_delegated_credentials_proof_insert_v1()","hash":"bf4f2a5053da8de20f57a865caf622331b3d9cc8f0cff3775fa14d50a6177a46","result":"trigger","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_pair_v1","signature":"public.faolla_attendance_delegated_credentials_pair_v1()","hash":"c868ecef4df1fd696ec832087edcf98299ecd868391f67b4fb5849adb2cf173b","result":"trigger","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_execute_v1","signature":"public.faolla_attendance_delegated_credentials_execute_v1(jsonb,uuid,jsonb,boolean,jsonb,text)","hash":"094878226681c563557ed9456d0a8520951b01e2e6cf0d477583e3002af22d13","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id","p_command","p_allow_write","p_material","p_family"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_terminals_v1","signature":"public.faolla_attendance_delegated_terminals_v1(jsonb,uuid,jsonb,boolean,jsonb)","hash":"da9dd36e726766bf3753d1f7fe26606122a03d3b8c3deaa28db412043d5635af","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":3,"defaultExpression":"NULL::jsonb, false, NULL::jsonb","args":["p_query","p_auth_user_id","p_command","p_allow_write","p_material"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_delegated_pin_v1","signature":"public.faolla_attendance_delegated_pin_v1(jsonb,uuid,jsonb,boolean,jsonb)","hash":"383deb86b58a5ae4ff4d14b14337d5be057ef7357936189d3fc3379be3819618","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":3,"defaultExpression":"NULL::jsonb, false, NULL::jsonb","args":["p_query","p_auth_user_id","p_command","p_allow_write","p_material"],"searchPath":"search_path=pg_catalog","isRpc":true}]$credentials207_own$::jsonb;for spec in select value from jsonb_array_elements(own_spec) loop
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
 end loop;foreach table_name in array array['merchant_attendance_terminals','merchant_attendance_terminal_audit','merchant_attendance_pin_credentials','merchant_attendance_pin_audit','merchant_attendance_pin_attempts','merchant_attendance_independent_subjects','merchant_attendance_independent_entries','merchant_attendance_independent_credentials','merchant_attendance_independent_leases','merchant_attendance_independent_event_sources','merchant_attendance_independent_member_bindings','merchant_attendance_management_delegations','merchant_attendance_management_delegation_revocations','merchant_attendance_management_delegation_operations','merchant_attendance_delegated_credential_proofs'] loop
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
    or pg_get_expr(actual_default.adbin,actual_table) is distinct from pg_get_expr(expected_default.adbin,expected_table))) then raise exception 'merchant_attendance_delegated_credentials_table_conflict';end if;
 if (select count(*) from pg_constraint where conrelid=actual_table and contype<>'t')<>(select count(*) from pg_constraint where conrelid=expected_table and contype<>'t') then raise exception 'merchant_attendance_delegated_credentials_constraint_conflict';end if;
 for constraint_spec in select * from pg_constraint where conrelid=expected_table and contype<>'t' loop
  select * into actual_constraint from pg_constraint where conrelid=actual_table and conname=constraint_spec.conname;
  foreign_table:=case when constraint_spec.contype='f' then to_regclass(ns||'.'||(select relname from pg_class where oid=constraint_spec.confrelid)) else 0::oid end;
  select array_agg(actual_ref.attnum::smallint order by requested.ord) into reference_keys from unnest(constraint_spec.confkey) with ordinality requested(attnum,ord)
   join pg_attribute expected_ref on expected_ref.attrelid=constraint_spec.confrelid and expected_ref.attnum=requested.attnum
   join pg_attribute actual_ref on actual_ref.attrelid=foreign_table and actual_ref.attname=expected_ref.attname;
  if actual_constraint.oid is null or row(actual_constraint.contype,actual_constraint.conkey,actual_constraint.confkey,actual_constraint.confrelid,actual_constraint.condeferrable,actual_constraint.condeferred,actual_constraint.convalidated,actual_constraint.confupdtype,actual_constraint.confdeltype,actual_constraint.confmatchtype,actual_constraint.connoinherit,actual_constraint.conislocal,actual_constraint.coninhcount)
   is distinct from row(constraint_spec.contype,constraint_spec.conkey,reference_keys,foreign_table::oid,constraint_spec.condeferrable,constraint_spec.condeferred,true,constraint_spec.confupdtype,constraint_spec.confdeltype,constraint_spec.confmatchtype,constraint_spec.connoinherit,true,0)
   or pg_get_expr(actual_constraint.conbin,actual_table) is distinct from pg_get_expr(constraint_spec.conbin,expected_table) then raise exception 'merchant_attendance_delegated_credentials_constraint_conflict';end if;
 end loop;
 if (select count(*) from pg_index where indrelid=actual_table)<>(select count(*) from pg_index where indrelid=expected_table) then raise exception 'merchant_attendance_delegated_credentials_index_conflict';end if;
 for index_spec in select index_row.*,index_table.relname,index_table.relam from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indrelid=expected_table loop
  select index_row.*,index_table.relowner,index_table.relam,index_table.relkind into actual_index from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indexrelid=to_regclass(ns||'.'||index_spec.relname);
  if actual_index.indexrelid is null or actual_index.indrelid<>actual_table or actual_index.relowner<>expected_owner or actual_index.relkind<>'i' or not actual_index.indisvalid or not actual_index.indisready or not actual_index.indislive
   or row(actual_index.relam,actual_index.indnatts,actual_index.indnkeyatts,actual_index.indisunique,actual_index.indisprimary,actual_index.indisexclusion,actual_index.indimmediate,actual_index.indnullsnotdistinct,actual_index.indkey,actual_index.indcollation,actual_index.indclass,actual_index.indoption)
   is distinct from row(index_spec.relam,index_spec.indnatts,index_spec.indnkeyatts,index_spec.indisunique,index_spec.indisprimary,index_spec.indisexclusion,index_spec.indimmediate,index_spec.indnullsnotdistinct,index_spec.indkey,index_spec.indcollation,index_spec.indclass,index_spec.indoption)
   or pg_get_expr(actual_index.indpred,actual_table) is distinct from pg_get_expr(index_spec.indpred,expected_table) or pg_get_expr(actual_index.indexprs,actual_table) is distinct from pg_get_expr(index_spec.indexprs,expected_table) then raise exception 'merchant_attendance_delegated_credentials_index_conflict';end if;
 end loop;

 if (select count(*) from pg_trigger actual where actual.tgrelid=actual_table and not actual.tgisinternal)<>(select count(*) from jsonb_array_elements($credentials207_triggers$[{"table":"merchant_attendance_terminal_audit","name":"merchant_attendance_terminal_audit_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_terminal_audit","name":"merchant_attendance_terminal_audit_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_pin_credentials","name":"attendance_account_activation_guard","type":23,"fn":"faolla_attendance_account_activation_guard_v1","deferred":false},{"table":"merchant_attendance_pin_audit","name":"attendance_pin_audit_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_pin_audit","name":"attendance_pin_audit_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_independent_entries","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_entries","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_event_sources","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_event_sources","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_member_bindings","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_member_bindings","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_insert","type":7,"fn":"faolla_attendance_delegated_credentials_proof_insert_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_pair","type":5,"fn":"faolla_attendance_delegated_credentials_pair_v1","deferred":true}]$credentials207_triggers$::jsonb) expected where expected->>'table'=table_name) then
  raise exception 'merchant_attendance_delegated_credentials_trigger_conflict' using detail=(select jsonb_build_object(
   'table',table_name,'actualCount',(select count(*) from pg_trigger actual where actual.tgrelid=actual_table and not actual.tgisinternal),
   'expectedCount',(select count(*) from jsonb_array_elements($credentials207_triggers$[{"table":"merchant_attendance_terminal_audit","name":"merchant_attendance_terminal_audit_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_terminal_audit","name":"merchant_attendance_terminal_audit_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_pin_credentials","name":"attendance_account_activation_guard","type":23,"fn":"faolla_attendance_account_activation_guard_v1","deferred":false},{"table":"merchant_attendance_pin_audit","name":"attendance_pin_audit_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_pin_audit","name":"attendance_pin_audit_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_independent_entries","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_entries","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_event_sources","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_event_sources","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_member_bindings","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_member_bindings","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_insert","type":7,"fn":"faolla_attendance_delegated_credentials_proof_insert_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_pair","type":5,"fn":"faolla_attendance_delegated_credentials_pair_v1","deferred":true}]$credentials207_triggers$::jsonb) expected where expected->>'table'=table_name),
   'triggers',coalesce((select jsonb_agg(jsonb_build_object('name',limited.tgname,'function',limited.function_identity) order by limited.tgname,limited.oid)
    from(select actual.oid,actual.tgname,left(actual.tgfoid::regprocedure::text,180) function_identity from pg_trigger actual
     where actual.tgrelid=actual_table and not actual.tgisinternal order by actual.tgname,actual.oid limit 8) limited),'[]'::jsonb)))::text;
 end if;
 for trigger_spec in select value from jsonb_array_elements($credentials207_triggers$[{"table":"merchant_attendance_terminal_audit","name":"merchant_attendance_terminal_audit_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_terminal_audit","name":"merchant_attendance_terminal_audit_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_pin_credentials","name":"attendance_account_activation_guard","type":23,"fn":"faolla_attendance_account_activation_guard_v1","deferred":false},{"table":"merchant_attendance_pin_audit","name":"attendance_pin_audit_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_pin_audit","name":"attendance_pin_audit_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_independent_entries","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_entries","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_event_sources","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_event_sources","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_member_bindings","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_member_bindings","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_insert","type":7,"fn":"faolla_attendance_delegated_credentials_proof_insert_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_pair","type":5,"fn":"faolla_attendance_delegated_credentials_pair_v1","deferred":true}]$credentials207_triggers$::jsonb) where value->>'table'=table_name loop
  if not exists(select 1 from pg_trigger actual where actual.tgrelid=actual_table and actual.tgname=(trigger_spec->>'name')::name and actual.tgtype=(trigger_spec->>'type')::integer
   and actual.tgfoid=to_regprocedure(ns||'.'||(trigger_spec->>'fn')||'()') and actual.tgenabled='O' and actual.tgnargs=0 and actual.tgqual is null and actual.tgparentid=0
   and actual.tgdeferrable=(trigger_spec->>'deferred')::boolean and actual.tginitdeferred=(trigger_spec->>'deferred')::boolean) then raise exception 'merchant_attendance_delegated_credentials_trigger_conflict';end if;
 end loop;
end loop;else foreach table_name in array array['merchant_attendance_terminals','merchant_attendance_terminal_audit','merchant_attendance_pin_credentials','merchant_attendance_pin_audit','merchant_attendance_pin_attempts','merchant_attendance_independent_subjects','merchant_attendance_independent_entries','merchant_attendance_independent_credentials','merchant_attendance_independent_leases','merchant_attendance_independent_event_sources','merchant_attendance_independent_member_bindings','merchant_attendance_management_delegations','merchant_attendance_management_delegation_revocations','merchant_attendance_management_delegation_operations'] loop
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
    or pg_get_expr(actual_default.adbin,actual_table) is distinct from pg_get_expr(expected_default.adbin,expected_table))) then raise exception 'merchant_attendance_delegated_credentials_table_conflict';end if;
 if (select count(*) from pg_constraint where conrelid=actual_table and contype<>'t')<>(select count(*) from pg_constraint where conrelid=expected_table and contype<>'t') then raise exception 'merchant_attendance_delegated_credentials_constraint_conflict';end if;
 for constraint_spec in select * from pg_constraint where conrelid=expected_table and contype<>'t' loop
  select * into actual_constraint from pg_constraint where conrelid=actual_table and conname=constraint_spec.conname;
  foreign_table:=case when constraint_spec.contype='f' then to_regclass(ns||'.'||(select relname from pg_class where oid=constraint_spec.confrelid)) else 0::oid end;
  select array_agg(actual_ref.attnum::smallint order by requested.ord) into reference_keys from unnest(constraint_spec.confkey) with ordinality requested(attnum,ord)
   join pg_attribute expected_ref on expected_ref.attrelid=constraint_spec.confrelid and expected_ref.attnum=requested.attnum
   join pg_attribute actual_ref on actual_ref.attrelid=foreign_table and actual_ref.attname=expected_ref.attname;
  if actual_constraint.oid is null or row(actual_constraint.contype,actual_constraint.conkey,actual_constraint.confkey,actual_constraint.confrelid,actual_constraint.condeferrable,actual_constraint.condeferred,actual_constraint.convalidated,actual_constraint.confupdtype,actual_constraint.confdeltype,actual_constraint.confmatchtype,actual_constraint.connoinherit,actual_constraint.conislocal,actual_constraint.coninhcount)
   is distinct from row(constraint_spec.contype,constraint_spec.conkey,reference_keys,foreign_table::oid,constraint_spec.condeferrable,constraint_spec.condeferred,true,constraint_spec.confupdtype,constraint_spec.confdeltype,constraint_spec.confmatchtype,constraint_spec.connoinherit,true,0)
   or pg_get_expr(actual_constraint.conbin,actual_table) is distinct from pg_get_expr(constraint_spec.conbin,expected_table) then raise exception 'merchant_attendance_delegated_credentials_constraint_conflict';end if;
 end loop;
 if (select count(*) from pg_index where indrelid=actual_table)<>(select count(*) from pg_index where indrelid=expected_table) then raise exception 'merchant_attendance_delegated_credentials_index_conflict';end if;
 for index_spec in select index_row.*,index_table.relname,index_table.relam from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indrelid=expected_table loop
  select index_row.*,index_table.relowner,index_table.relam,index_table.relkind into actual_index from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indexrelid=to_regclass(ns||'.'||index_spec.relname);
  if actual_index.indexrelid is null or actual_index.indrelid<>actual_table or actual_index.relowner<>expected_owner or actual_index.relkind<>'i' or not actual_index.indisvalid or not actual_index.indisready or not actual_index.indislive
   or row(actual_index.relam,actual_index.indnatts,actual_index.indnkeyatts,actual_index.indisunique,actual_index.indisprimary,actual_index.indisexclusion,actual_index.indimmediate,actual_index.indnullsnotdistinct,actual_index.indkey,actual_index.indcollation,actual_index.indclass,actual_index.indoption)
   is distinct from row(index_spec.relam,index_spec.indnatts,index_spec.indnkeyatts,index_spec.indisunique,index_spec.indisprimary,index_spec.indisexclusion,index_spec.indimmediate,index_spec.indnullsnotdistinct,index_spec.indkey,index_spec.indcollation,index_spec.indclass,index_spec.indoption)
   or pg_get_expr(actual_index.indpred,actual_table) is distinct from pg_get_expr(index_spec.indpred,expected_table) or pg_get_expr(actual_index.indexprs,actual_table) is distinct from pg_get_expr(index_spec.indexprs,expected_table) then raise exception 'merchant_attendance_delegated_credentials_index_conflict';end if;
 end loop;

 if (select count(*) from pg_trigger actual where actual.tgrelid=actual_table and not actual.tgisinternal)<>(select count(*) from jsonb_array_elements($credentials207_triggers$[{"table":"merchant_attendance_terminal_audit","name":"merchant_attendance_terminal_audit_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_terminal_audit","name":"merchant_attendance_terminal_audit_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_pin_credentials","name":"attendance_account_activation_guard","type":23,"fn":"faolla_attendance_account_activation_guard_v1","deferred":false},{"table":"merchant_attendance_pin_audit","name":"attendance_pin_audit_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_pin_audit","name":"attendance_pin_audit_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_independent_entries","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_entries","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_event_sources","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_event_sources","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_member_bindings","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_member_bindings","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_insert","type":7,"fn":"faolla_attendance_delegated_credentials_proof_insert_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_pair","type":5,"fn":"faolla_attendance_delegated_credentials_pair_v1","deferred":true}]$credentials207_triggers$::jsonb) expected where expected->>'table'=table_name) then
  raise exception 'merchant_attendance_delegated_credentials_trigger_conflict' using detail=(select jsonb_build_object(
   'table',table_name,'actualCount',(select count(*) from pg_trigger actual where actual.tgrelid=actual_table and not actual.tgisinternal),
   'expectedCount',(select count(*) from jsonb_array_elements($credentials207_triggers$[{"table":"merchant_attendance_terminal_audit","name":"merchant_attendance_terminal_audit_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_terminal_audit","name":"merchant_attendance_terminal_audit_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_pin_credentials","name":"attendance_account_activation_guard","type":23,"fn":"faolla_attendance_account_activation_guard_v1","deferred":false},{"table":"merchant_attendance_pin_audit","name":"attendance_pin_audit_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_pin_audit","name":"attendance_pin_audit_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_independent_entries","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_entries","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_event_sources","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_event_sources","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_member_bindings","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_member_bindings","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_insert","type":7,"fn":"faolla_attendance_delegated_credentials_proof_insert_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_pair","type":5,"fn":"faolla_attendance_delegated_credentials_pair_v1","deferred":true}]$credentials207_triggers$::jsonb) expected where expected->>'table'=table_name),
   'triggers',coalesce((select jsonb_agg(jsonb_build_object('name',limited.tgname,'function',limited.function_identity) order by limited.tgname,limited.oid)
    from(select actual.oid,actual.tgname,left(actual.tgfoid::regprocedure::text,180) function_identity from pg_trigger actual
     where actual.tgrelid=actual_table and not actual.tgisinternal order by actual.tgname,actual.oid limit 8) limited),'[]'::jsonb)))::text;
 end if;
 for trigger_spec in select value from jsonb_array_elements($credentials207_triggers$[{"table":"merchant_attendance_terminal_audit","name":"merchant_attendance_terminal_audit_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_terminal_audit","name":"merchant_attendance_terminal_audit_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_pin_credentials","name":"attendance_account_activation_guard","type":23,"fn":"faolla_attendance_account_activation_guard_v1","deferred":false},{"table":"merchant_attendance_pin_audit","name":"attendance_pin_audit_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_pin_audit","name":"attendance_pin_audit_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_independent_entries","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_entries","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_event_sources","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_event_sources","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_member_bindings","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_member_bindings","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_insert","type":7,"fn":"faolla_attendance_delegated_credentials_proof_insert_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_pair","type":5,"fn":"faolla_attendance_delegated_credentials_pair_v1","deferred":true}]$credentials207_triggers$::jsonb) where value->>'table'=table_name loop
  if not exists(select 1 from pg_trigger actual where actual.tgrelid=actual_table and actual.tgname=(trigger_spec->>'name')::name and actual.tgtype=(trigger_spec->>'type')::integer
   and actual.tgfoid=to_regprocedure(ns||'.'||(trigger_spec->>'fn')||'()') and actual.tgenabled='O' and actual.tgnargs=0 and actual.tgqual is null and actual.tgparentid=0
   and actual.tgdeferrable=(trigger_spec->>'deferred')::boolean and actual.tginitdeferred=(trigger_spec->>'deferred')::boolean) then raise exception 'merchant_attendance_delegated_credentials_trigger_conflict';end if;
 end loop;
end loop;end if;
 end;$credentials207_preflight$;
--END GENERATED DELEGATED CREDENTIALS PREFLIGHT

create table if not exists public.merchant_attendance_delegated_credential_proofs(
 merchant_id text not null,
 operation_id uuid not null,
 command jsonb not null,
 command_fingerprint text not null,
 reference jsonb not null,
 material_commitment text,
 recorded_at timestamptz not null,
 constraint credentials207_proof_pk primary key(merchant_id,operation_id),
 constraint credentials207_proof_operation_fk foreign key(merchant_id,operation_id)
  references public.merchant_attendance_management_delegation_operations(merchant_id,operation_id) deferrable initially deferred,
 constraint credentials207_command_ck check(jsonb_typeof(command)='object' and octet_length(convert_to(command::text,'UTF8'))<=8192),
 constraint credentials207_hash_ck check(command_fingerprint~'^[0-9a-f]{64}$'),
 constraint credentials207_reference_ck check(jsonb_typeof(reference)='object'),
 constraint credentials207_material_ck check(material_commitment is null or material_commitment~'^[0-9a-f]{64}$'),
 constraint credentials207_material_action_ck check((command->>'action'='pin_issue')=(material_commitment is not null)),
 constraint credentials207_stamp_ck check(isfinite(recorded_at))
);
alter table public.merchant_attendance_delegated_credential_proofs enable row level security;
-- Revoke the bootstrap role only when it is not the private table owner.
do $pilot_private_table_bootstrap_acl$
declare target regclass;
begin
  for target in
    select c.oid::regclass from pg_catalog.pg_class c
    where c.oid=any(array[
      'public.merchant_attendance_delegated_credential_proofs'::regclass
    ]) and c.relowner<>(select oid from pg_catalog.pg_roles where rolname='postgres')
  loop
    execute format('revoke all privileges on table %s from postgres',target);
  end loop;
end;
$pilot_private_table_bootstrap_acl$;

revoke all on public.merchant_attendance_delegated_credential_proofs from public,anon,authenticated,service_role;

create or replace function public.faolla_attendance_delegated_credentials_command_v1(c jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare a text:=c->>'action';k text:=c->>'kind';ks text[];field text;v numeric;tuple_value jsonb;
begin
 if c is null or octet_length(convert_to(c::text,'UTF8'))>8192
  or not public.faolla_attendance_management_scalar_v1(c->'operationId','uuid')
  or not public.faolla_attendance_group_text_v1(c->>'reason',1,500) then raise exception 'attendance_invalid_request';end if;
 if a in('terminal_prepare','terminal_revoke') then
  ks:=array['action','operationId','terminalId','locationId','reason'];
  if a='terminal_prepare' then ks:=ks||array['label','pairHash'];end if;
  if public.faolla_attendance_shift_rule_binding_object_v1(c,ks) is distinct from true
   or not public.faolla_attendance_management_scalar_v1(c->'terminalId','uuid')
   or not public.faolla_attendance_management_scalar_v1(c->'locationId','uuid') then raise exception 'attendance_invalid_request';end if;
  tuple_value:=jsonb_build_array(a,c->'operationId',c->'terminalId',c->'locationId');
  if a='terminal_prepare' then
   if not public.faolla_attendance_group_text_v1(c->>'label',1,80) or jsonb_typeof(c->'pairHash') is distinct from 'string'
    or coalesce(c->>'pairHash','')!~'^[0-9a-f]{64}$' then raise exception 'attendance_invalid_request';end if;
   tuple_value:=tuple_value||jsonb_build_array(c->'label',c->'pairHash');
  end if;
  return tuple_value||jsonb_build_array(c->'reason');
 end if;
 if a is null or a not in('pin_issue','pin_revoke') or not public.faolla_attendance_management_scalar_v1(c->'workerId','uuid') then raise exception 'attendance_invalid_request';end if;
 ks:=array['kind','action','operationId','workerId','reason'];
 if k='member_pin' then
  ks:=ks||array['employeeId','employeeAuthUserId','workerNo','expectedRevision'];
  if public.faolla_attendance_shift_rule_binding_object_v1(c,ks) is distinct from true
   or not public.faolla_attendance_management_scalar_v1(c->'employeeId','uuid')
   or not public.faolla_attendance_management_scalar_v1(c->'employeeAuthUserId','uuid')
   or not public.faolla_attendance_group_text_v1(c->>'workerNo',1,40)
   or not public.faolla_attendance_management_scalar_v1(c->'expectedRevision','uint')
   or (c->>'expectedRevision')::numeric>999999997 or a='pin_revoke' and (c->>'expectedRevision')::numeric<1 then raise exception 'attendance_invalid_request';end if;
  return jsonb_build_array(k,a,c->'operationId',c->'workerId',c->'employeeId',c->'employeeAuthUserId',c->'workerNo',c->'expectedRevision',c->'reason');
 elsif k='independent_pin' then
  ks:=ks||array['subjectId','expectedSubjectRevision','expectedGeneration','expectedWorkerVersion','expectedSettingsVersion','expectedCredentialRevision'];
  if public.faolla_attendance_shift_rule_binding_object_v1(c,ks) is distinct from true
   or not public.faolla_attendance_management_scalar_v1(c->'subjectId','uuid') then raise exception 'attendance_invalid_request';end if;
  foreach field in array array['expectedSubjectRevision','expectedGeneration','expectedWorkerVersion','expectedSettingsVersion','expectedCredentialRevision'] loop
   if not public.faolla_attendance_management_scalar_v1(c->field,'uint') then raise exception 'attendance_invalid_request';end if;
   v:=(c->>field)::numeric;
   if field in('expectedSubjectRevision','expectedWorkerVersion','expectedSettingsVersion') and v<1
    or field<>'expectedSettingsVersion' and (field<>'expectedGeneration' or a='pin_revoke') and v>=9007199254740990
    or field='expectedCredentialRevision' and a='pin_revoke' and v<1 then raise exception 'attendance_invalid_request';end if;
  end loop;
  return jsonb_build_array(k,a,c->'operationId',c->'workerId',c->'subjectId',c->'expectedSubjectRevision',c->'expectedGeneration',c->'expectedWorkerVersion',c->'expectedSettingsVersion',c->'expectedCredentialRevision',c->'reason');
 end if;
 raise exception 'attendance_invalid_request';
end;
$$;
create or replace function public.faolla_attendance_delegated_credentials_hash_v1(site text,actor uuid,id uuid,c jsonb)
returns text language plpgsql immutable set search_path=pg_catalog as $$
begin
 return public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array(
  case when c->>'action' in('terminal_prepare','terminal_revoke') then 'attendance-delegated-terminals-v1-command' else 'attendance-delegated-pin-v1-command' end,
  site,actor,id,public.faolla_attendance_delegated_credentials_command_v1(c)));
end;
$$;
create or replace function public.faolla_attendance_delegated_credentials_member_material_v1(site text,actor uuid,id uuid,c jsonb,material jsonb)
returns text language plpgsql immutable set search_path=pg_catalog as $$
begin
 perform public.faolla_attendance_delegated_credentials_command_v1(c);
 if c->>'kind' is distinct from 'member_pin' or c->>'action' is distinct from 'pin_issue'
  or public.faolla_attendance_shift_rule_binding_object_v1(material,array['salt','verifier','commitment']) is distinct from true
  or jsonb_typeof(material->'salt') is distinct from 'string' or coalesce(material->>'salt','')!~'^[0-9a-f]{32}$'
  or jsonb_typeof(material->'verifier') is distinct from 'string' or coalesce(material->>'verifier','')!~'^[0-9a-f]{64}$'
  or jsonb_typeof(material->'commitment') is distinct from 'string' or coalesce(material->>'commitment','')!~'^[0-9a-f]{64}$' then raise exception 'attendance_invalid_request';end if;
 return public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-delegated-member-pin-material-v1',
  site,actor,id,c->'operationId',c->'workerId',c->'employeeId',c->'employeeAuthUserId',(c->>'expectedRevision')::bigint+1,material->'salt',material->'verifier'));
end;
$$;

--Only these two postimages consume their original scope: terminal creation,
--and independent PIN revocation's generation+1. Do not broaden202 current.
create or replace function public.faolla_attendance_delegated_credentials_current_v1(g public.merchant_attendance_management_delegations,stamp timestamptz,c jsonb,postimage boolean)
returns boolean language plpgsql set search_path=pg_catalog as $$
declare w public.merchant_attendance_workers%rowtype;sub public.merchant_attendance_independent_subjects%rowtype;
begin
 if not postimage or g.delegated_action<>'terminal_prepare' and not(g.delegated_action='pin_revoke' and g.scope->>'kind'='independent_pin') then
  return public.faolla_attendance_management_current_v1(g,stamp);
 end if;
 if stamp is null or not isfinite(stamp) or stamp<g.valid_from or stamp>=g.valid_until
  or not exists(select 1 from public.merchant_attendance_settings actual where actual.merchant_id=g.merchant_id and actual.enabled)
  or not exists(select 1 from public.merchants actual where actual.id=g.merchant_id and actual.user_id=g.actor_auth_user_id)
  or exists(select 1 from public.merchant_attendance_management_delegation_revocations actual where actual.merchant_id=g.merchant_id and actual.grant_id=g.grant_id)
  or g.delegate_generation<>coalesce((select epoch.generation from public.merchant_attendance_account_epochs epoch where epoch.merchant_id=g.merchant_id and epoch.employee_id=g.delegate_employee_id),0)
  or exists(select 1 from public.merchant_attendance_account_epochs epoch where epoch.merchant_id=g.merchant_id and epoch.employee_id=g.delegate_employee_id and epoch.paused)
  or not exists(select 1 from public.merchant_enterprise_employees employee join public.merchant_enterprise_roles role_row on role_row.merchant_id=employee.merchant_id and role_row.id=employee.role_id
   where employee.merchant_id=g.merchant_id and employee.id=g.delegate_employee_id and employee.auth_user_id=g.delegate_auth_user_id and employee.status='active' and role_row.status='active'
    and public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions) and role_row.permissions @> array['enterprise.view',g.capability]) then return false;end if;
 if g.delegated_action='terminal_prepare' then
  return g.scope->>'kind'='terminal' and g.scope->'create'='true'::jsonb and exists(select 1 from public.merchant_attendance_terminals actual
   where actual.merchant_id=g.merchant_id and actual.id=(g.scope->>'terminalId')::uuid and actual.location_id=(g.scope->>'locationId')::uuid
    and actual.created_by=g.delegate_auth_user_id and actual.label=c->>'label' and actual.pair_hash=c->>'pairHash'
    and actual.created_at=stamp and actual.pair_expires_at=stamp+interval '5 minutes')
   and exists(select 1 from public.merchant_attendance_terminal_audit actual where actual.merchant_id=g.merchant_id and actual.terminal_id=(g.scope->>'terminalId')::uuid
    and actual.action='create' and actual.actor_auth_user_id=g.delegate_auth_user_id and actual.recorded_at=stamp);
 end if;
 select * into w from public.merchant_attendance_workers actual where actual.merchant_id=g.merchant_id and actual.id=(g.scope->>'workerId')::uuid;
 select * into sub from public.merchant_attendance_independent_subjects actual where actual.merchant_id=g.merchant_id and actual.subject_id=(g.scope->>'subjectId')::uuid;
 return w.id is not null and w.employee_id is null and sub.worker_id=w.id and sub.state='independent'
  and sub.generation=(g.scope->>'generation')::bigint+1 and sub.revision=(c->>'expectedSubjectRevision')::bigint+1
  and w.version=(c->>'expectedWorkerVersion')::bigint+1 and sub.updated_at=stamp and w.updated_at=stamp
  and g.scope->'locationIds' @> jsonb_build_array(w.default_location_id);
end;
$$;

create or replace function public.faolla_attendance_delegated_credentials_authorize_v1(site text,actor uuid,id uuid,c jsonb,postimage boolean,stamp timestamptz)
returns public.merchant_attendance_management_delegations language plpgsql set search_path=pg_catalog as $$
declare g public.merchant_attendance_management_delegations%rowtype;
begin
 select * into g from public.merchant_attendance_management_delegations actual where actual.merchant_id=site and actual.grant_id=id for share;
 if g.grant_id is null or g.delegate_auth_user_id is distinct from actor or g.delegated_action not in('terminal_prepare','terminal_revoke','pin_issue','pin_revoke')
  or g.capability is distinct from public.faolla_attendance_management_capability_v1(g.delegated_action)
  or g.command_fingerprint is distinct from public.faolla_attendance_management_hash_v1(site,g.actor_auth_user_id,g.command)
  or not public.faolla_attendance_delegated_credentials_current_v1(g,stamp,c,postimage) then raise exception 'attendance_access_denied';end if;
 perform public.faolla_attendance_management_scope_v1(g.scope,g.delegated_action);
 if c is not null then
  perform public.faolla_attendance_delegated_credentials_command_v1(c);
  if c->>'action' is distinct from g.delegated_action then raise exception 'attendance_access_denied';end if;
  if g.scope->>'kind'='terminal' then
   if row(c->>'terminalId',c->>'locationId') is distinct from row(g.scope->>'terminalId',g.scope->>'locationId') then raise exception 'attendance_access_denied';end if;
  elsif g.scope->>'kind'='member_pin' then
   if c->>'kind' is distinct from 'member_pin' or row(c->>'workerId',c->>'employeeId',c->>'employeeAuthUserId') is distinct from row(g.scope->>'workerId',g.scope->>'employeeId',g.scope->>'employeeAuthUserId') then raise exception 'attendance_access_denied';end if;
  elsif g.scope->>'kind'='independent_pin' then
   if c->>'kind' is distinct from 'independent_pin' or row(c->>'workerId',c->>'subjectId',c->>'expectedGeneration') is distinct from row(g.scope->>'workerId',g.scope->>'subjectId',g.scope->>'generation') then raise exception 'attendance_access_denied';end if;
  else raise exception 'attendance_access_denied';end if;
 end if;
 return g;
end;
$$;

create or replace function public.faolla_attendance_delegated_credentials_core_authorize_v1(site text,actor uuid,id uuid,family text,target text,c jsonb)
returns void language plpgsql set search_path=pg_catalog as $$
declare g public.merchant_attendance_management_delegations%rowtype;worker public.merchant_attendance_workers%rowtype;
begin
 g:=public.faolla_attendance_delegated_credentials_authorize_v1(site,actor,id,null,false,clock_timestamp());
 if g.scope->>'kind' is distinct from family then raise exception 'attendance_access_denied';end if;
 if family='terminal' then
  if target is distinct from g.scope->>'terminalId' or c is not null and ((c->>'action'='create') is distinct from (g.delegated_action='terminal_prepare')
    or c->>'action' not in('create','revoke') or c->>'action'='create' and c->>'locationId' is distinct from g.scope->>'locationId') then raise exception 'attendance_access_denied';end if;
 elsif family='member_pin' then
  select * into worker from public.merchant_attendance_workers actual where actual.merchant_id=site and actual.id=(g.scope->>'workerId')::uuid;
  if worker.worker_no is distinct from target or c is not null and (row(c->>'workerId',c->>'employeeId') is distinct from row(g.scope->>'workerId',g.scope->>'employeeId')
   or (c->>'action'='set') is distinct from (g.delegated_action='pin_issue') or c->>'action' not in('set','revoke')) then raise exception 'attendance_access_denied';end if;
 elsif family='independent_pin' then
  if target is distinct from g.scope->>'subjectId' or c is not null and ((c->>'action'='issue_pin') is distinct from (g.delegated_action='pin_issue') or c->>'action' not in('issue_pin','revoke_pin')) then raise exception 'attendance_access_denied';end if;
 else raise exception 'attendance_access_denied';end if;
end;
$$;

--BEGIN GENERATED DELEGATED CREDENTIALS CORES
create or replace function public.faolla_attendance_delegated_credentials_terminal_core_v1(p_site text,p_auth uuid,p_query jsonb,p_command jsonb,p_allow_create boolean,p_grant_id uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare
  m public.merchants%rowtype; t public.merchant_attendance_terminals%rowtype; l public.merchant_attendance_locations%rowtype;
  now_at timestamptz; target uuid; cursor_id uuid; rows_json jsonb; next_id uuid;
  uuid_pattern text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_site is null or p_site !~ '^\d{8}$' or p_auth is null or p_query is null or jsonb_typeof(p_query)<>'object'
    or (select count(*) from jsonb_object_keys(p_query))<>2 or not(p_query ?& array['cursor','terminalId'])
    or (p_query->'cursor'<>'null'::jsonb and coalesce(p_query->>'cursor','') !~ uuid_pattern)
    or (p_query->'terminalId'<>'null'::jsonb and coalesce(p_query->>'terminalId','') !~ uuid_pattern)
    or (p_query->>'cursor' is not null and p_query->>'terminalId' is not null)
  then raise exception 'attendance_invalid_request'; end if;
  target:=(p_query->>'terminalId')::uuid; cursor_id:=(p_query->>'cursor')::uuid;
  if p_command is not null then
    if jsonb_typeof(p_command)<>'object' or target is not null or cursor_id is not null
      or coalesce(p_command->>'terminalId','') !~ uuid_pattern
      or coalesce(p_command->>'action','') not in ('create','revoke') then raise exception 'attendance_invalid_request'; end if;
    target:=(p_command->>'terminalId')::uuid;
    if p_command->>'action'='create' then
      if (select count(*) from jsonb_object_keys(p_command))<>5 or not(p_command ?& array['action','terminalId','locationId','label','pairHash'])
        or coalesce(p_command->>'locationId','') !~ uuid_pattern or jsonb_typeof(p_command->'label')<>'string'
        or char_length(btrim(p_command->>'label')) not between 1 and 80 or (p_command->>'label') ~ '[[:cntrl:]]'
        or coalesce(p_command->>'pairHash','') !~ '^[0-9a-f]{64}$' then raise exception 'attendance_invalid_request'; end if;
    elsif (select count(*) from jsonb_object_keys(p_command))<>2 then raise exception 'attendance_invalid_request'; end if;
  end if;
 if p_grant_id is null then
  select * into m from public.merchants where id=p_site for share;
  if not found or not coalesce(p_auth=any(array[m.user_id,m.auth_user_id,m.owner_user_id,m.owner_id,m.auth_id,m.created_by,m.created_by_user_id]),false)
    then raise exception 'attendance_access_denied'; end if;
 else
  perform public.faolla_attendance_delegated_credentials_core_authorize_v1(p_site,p_auth,p_grant_id,'terminal',target::text,p_command);
 end if;
  -- Consistent lock order: merchant -> settings -> location -> terminal.
  -- Configuration writes already use settings FOR UPDATE; no old writer changes.
  if p_command is null then perform 1 from public.merchant_attendance_settings where merchant_id=p_site for share;
  else perform 1 from public.merchant_attendance_settings where merchant_id=p_site for update; end if;
  if not found then raise exception 'attendance_settings_required'; end if;
  now_at:=clock_timestamp();
  if p_command is not null then
    select * into t from public.merchant_attendance_terminals where merchant_id=p_site and id=target for update;
    if p_command->>'action'='create' then
      if t.id is not null then
        if t.created_by<>p_auth or t.location_id<>(p_command->>'locationId')::uuid or t.label<>btrim(p_command->>'label') or t.pair_hash<>p_command->>'pairHash'
          then raise exception 'attendance_operation_conflict'; end if;
        -- Same intent returns CURRENT metadata only; never renew an expiry or resurrect.
      else
        if p_allow_create is distinct from true then raise exception 'attendance_platform_paused'; end if;
        select * into l from public.merchant_attendance_locations where merchant_id=p_site and id=(p_command->>'locationId')::uuid for share;
        if not found or not l.active then raise exception 'attendance_location_denied'; end if;
        if (select count(*) from public.merchant_attendance_terminals where merchant_id=p_site and revoked_at is null
            and coalesce(device_expires_at,pair_expires_at)>now_at)>=20
          or (select count(*) from public.merchant_attendance_terminals where merchant_id=p_site and created_at>now_at-interval '1 hour')>=10
          then raise exception 'attendance_terminal_limit'; end if;
        insert into public.merchant_attendance_terminals(merchant_id,id,location_id,label,time_zone,created_by,created_at,pair_hash,pair_expires_at)
          values(p_site,target,l.id,btrim(p_command->>'label'),l.time_zone,p_auth,now_at,p_command->>'pairHash',now_at+interval '5 minutes');
        insert into public.merchant_attendance_terminal_audit values(p_site,target,'create',p_auth,now_at);
      end if;
    else
      if t.id is null then raise exception 'attendance_terminal_not_found'; end if;
      if t.revoked_at is null then
        if now_at<coalesce(t.paired_at,t.created_at) then raise exception 'attendance_time_reversed'; end if;
        update public.merchant_attendance_terminals set revoked_at=now_at,revoked_by=p_auth where merchant_id=p_site and id=target;
        insert into public.merchant_attendance_terminal_audit values(p_site,target,'revoke',p_auth,now_at);
      end if;
    end if;
  end if;
  select coalesce(jsonb_agg(public.faolla_attendance_terminal_snapshot_v1(p_site,page.id,now_at) order by page.id),'[]'::jsonb)
    into rows_json from (select id from public.merchant_attendance_terminals where merchant_id=p_site
      and (target is null or id=target) and (cursor_id is null or id>cursor_id) order by id limit 26) page;
  if jsonb_array_length(rows_json)>25 then rows_json:=rows_json-25; next_id:=(rows_json->24->>'id')::uuid; end if;
  return jsonb_build_object('siteId',p_site,'items',rows_json,'nextCursor',next_id);
end;
$$;
create or replace function public.faolla_attendance_delegated_credentials_member_core_v1(p_site text,p_auth uuid,p_no text,p_operation uuid,p_command jsonb,p_allow_set boolean,p_grant_id uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
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
 if p_grant_id is null then
  select * into m from public.merchants where id=p_site for share;
  if not found or not coalesce(p_auth=any(array[m.user_id,m.auth_user_id,m.owner_user_id,m.owner_id,m.auth_id,m.created_by,m.created_by_user_id]),false) then raise exception 'attendance_access_denied';end if;
 else
  perform public.faolla_attendance_delegated_credentials_core_authorize_v1(p_site,p_auth,p_grant_id,'member_pin',p_no,p_command);
 end if;
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
create or replace function public.faolla_attendance_delegated_credentials_independent_core_v1(p_site text,p_auth uuid,p_query jsonb,p_command jsonb,p_material jsonb,p_allow_new boolean,p_grant_id uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare m public.merchants%rowtype;config public.merchant_attendance_settings%rowtype;s public.merchant_attendance_independent_subjects%rowtype;
 w public.merchant_attendance_workers%rowtype;c public.merchant_attendance_independent_credentials%rowtype;i public.merchant_attendance_independent_entries%rowtype;
 b public.merchant_attendance_independent_member_bindings%rowtype;e public.merchant_enterprise_employees%rowtype;r public.merchant_enterprise_roles%rowtype;l public.merchant_attendance_locations%rowtype;
 tail public.merchant_attendance_events%rowtype;x public.merchant_attendance_independent_event_sources%rowtype;
 mode_name text:=p_query->>'mode';a text:=p_command->>'action';ks text[];owner_now boolean;target_subject uuid;stamp timestamptz;fp text;commitment text;
 op uuid;v_credential_revision bigint;v_credential_id uuid;items jsonb:='[]';data_value jsonb;receipt jsonb:='null';result jsonb;seen integer:=0;last_id uuid;next_id uuid;
begin
 if p_site is null or p_site!~'^[0-9]{8}$' or p_auth is null or p_query->>'siteId' is distinct from p_site then raise exception 'attendance_invalid_request';end if;
 ks:=array['siteId','mode'];
 if mode_name='list' then ks:=ks||array['cursor','search','state'];
 elsif mode_name in('members','locations') then ks:=ks||array['cursor','search'];
 elsif mode_name in('detail','recover','history') then ks:=ks||array['subjectId'];
  if mode_name='recover' then ks:=ks||array['operationId'];end if;
  if mode_name='history' then ks:=ks||array['fromDate','throughDate','cursor'];end if;
 else raise exception 'attendance_invalid_request';end if;
 if public.faolla_attendance_operational_rule_object_v1(p_query,ks) is distinct from true then raise exception 'attendance_invalid_request';end if;
 if p_query ? 'cursor' and p_query->'cursor'<>'null'::jsonb and public.faolla_attendance_independent_scalar_v1(p_query->'cursor','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
 if mode_name in('list','members','locations') then
  if not public.faolla_attendance_independent_text_v1(p_query->>'search',0,80) then raise exception 'attendance_invalid_request';end if;
  if mode_name='list' and (p_query->>'state' is null or p_query->>'state' not in('all','independent','bound')) then raise exception 'attendance_invalid_request';end if;
 else
  if public.faolla_attendance_independent_scalar_v1(p_query->'subjectId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;target_subject:=(p_query->>'subjectId')::uuid;
 end if;
 if mode_name='recover' and public.faolla_attendance_independent_scalar_v1(p_query->'operationId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
 if mode_name='history' and (public.faolla_attendance_independent_scalar_v1(p_query->'fromDate','date') is distinct from true or public.faolla_attendance_independent_scalar_v1(p_query->'throughDate','date') is distinct from true) then raise exception 'attendance_invalid_request';end if;
 if p_command is not null then
  perform public.faolla_attendance_independent_command_v1(p_command);
  if mode_name<>'detail' or p_command->>'subjectId' is distinct from target_subject::text then raise exception 'attendance_invalid_request';end if;
  op:=(p_command->>'operationId')::uuid;fp:=public.faolla_attendance_independent_admin_hash_v1(p_site,p_auth,p_command);
  if a='issue_pin' then
   if public.faolla_attendance_operational_rule_object_v1(p_material,array['salt','verifier','commitment']) is distinct from true
    or coalesce(p_material->>'salt','')!~'^[0-9a-f]{32}$' or coalesce(p_material->>'verifier','')!~'^[0-9a-f]{64}$' or coalesce(p_material->>'commitment','')!~'^[0-9a-f]{64}$' then raise exception 'attendance_invalid_request';end if;
  elsif p_material is not null then raise exception 'attendance_invalid_request';end if;
 elsif p_material is not null then raise exception 'attendance_invalid_request';end if;
 if p_grant_id is null then
 select * into m from public.merchants where id=p_site for share;
 owner_now:=m.id is not null and coalesce(p_auth=any(array[m.user_id,m.auth_user_id,m.owner_user_id,m.owner_id,m.auth_id,m.created_by,m.created_by_user_id]),false);
 if mode_name='recover' then
  select * into i from public.merchant_attendance_independent_entries where merchant_id=p_site and operation_id=(p_query->>'operationId')::uuid;
  if not owner_now and (i.operation_id is null or i.actor_auth_user_id<>p_auth) then raise exception 'attendance_access_denied';end if;
  if i.operation_id is not null and i.subject_id<>target_subject then raise exception 'attendance_operation_conflict';end if;
 elsif not owner_now then raise exception 'attendance_access_denied';end if;
 else
 if mode_name<>'detail' then raise exception 'attendance_invalid_request';end if;
 perform public.faolla_attendance_delegated_credentials_core_authorize_v1(p_site,p_auth,p_grant_id,'independent_pin',target_subject::text,p_command);
 end if;
 if p_command is null then select * into config from public.merchant_attendance_settings where merchant_id=p_site for share;
 else select * into config from public.merchant_attendance_settings where merchant_id=p_site for update;end if;
 if config.merchant_id is null then raise exception 'attendance_settings_required';end if;stamp:=clock_timestamp();
 if p_command is not null then
  select * into i from public.merchant_attendance_independent_entries where merchant_id=p_site and operation_id=op;
  if i.operation_id is not null then
   if i.subject_id<>target_subject or i.actor_auth_user_id<>p_auth or i.command is distinct from p_command or i.command_fingerprint<>fp then raise exception 'attendance_operation_conflict';end if;
   if a='issue_pin' then
    commitment:=public.faolla_attendance_independent_material_hash_v1(p_site,i.worker_id,i.subject_id,i.generation,i.credential_revision,op,p_material->>'salt',p_material->>'verifier');
    if commitment is distinct from i.material_commitment or commitment is distinct from p_material->>'commitment' then raise exception 'attendance_operation_conflict';end if;
   end if;
  else
   if a in('create','enable','issue_pin','bind_member') and p_allow_new is distinct from true then raise exception 'attendance_independent_disabled';end if;
   if config.version<>(p_command->>'expectedSettingsVersion')::bigint then raise exception 'attendance_independent_changed';end if;
   if a='create' then
    select * into l from public.merchant_attendance_locations where merchant_id=p_site and id=(p_command->>'locationId')::uuid for share;
    if l.id is null or not l.active then raise exception 'attendance_location_denied';end if;
    if exists(select 1 from public.merchant_attendance_workers where merchant_id=p_site and (id=(p_command->>'workerId')::uuid or lower(btrim(worker_no))=lower(p_command->>'workerNo')))
     or exists(select 1 from public.merchant_attendance_independent_subjects where merchant_id=p_site and subject_id=target_subject) then raise exception 'attendance_operation_conflict';end if;
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,active,default_location_id,version,created_at,updated_at)
     values((p_command->>'workerId')::uuid,p_site,null,p_command->>'workerNo',p_command->>'displayName',false,l.id,1,stamp,stamp) returning * into w;
    insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values(p_site,w.id,(p_command->>'startsOn')::date);
    insert into public.merchant_attendance_independent_subjects values(p_site,target_subject,w.id,'independent','independent',false,0,1,op,p_auth,stamp,stamp) returning * into s;
   else
    --settings UPDATE is acquired before the optional member locks. Never lock
    --worker and then wait on the old member/role-before-worker path.
    if a='bind_member' then
     select * into e from public.merchant_enterprise_employees where merchant_id=p_site and id=(p_command->>'targetEmployeeId')::uuid for share;
     select * into r from public.merchant_enterprise_roles where merchant_id=p_site and id=e.role_id for share;
     if e.id is null or e.status<>'active' or e.auth_user_id is distinct from (p_command->>'targetAuthUserId')::uuid or r.status is distinct from 'active'
      or public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions) is distinct from true or not(array['enterprise.view','attendance.self.view','attendance.self.clock']::text[]<@r.permissions)
      or exists(select 1 from public.merchant_attendance_workers where merchant_id=p_site and employee_id=e.id) then raise exception 'attendance_employee_invalid';end if;
    end if;
    select * into s from public.merchant_attendance_independent_subjects where merchant_id=p_site and subject_id=target_subject;
    select * into w from public.merchant_attendance_workers where merchant_id=p_site and id=s.worker_id for update;
    select * into s from public.merchant_attendance_independent_subjects where merchant_id=p_site and subject_id=target_subject for update;
    select * into c from public.merchant_attendance_independent_credentials where merchant_id=p_site and subject_id=target_subject for update;
    if s.subject_id is null or w.id is null then raise exception 'attendance_independent_not_found';end if;
    if s.state<>'independent' or w.employee_id is not null then raise exception 'attendance_independent_bound';end if;
    if row(s.revision,s.generation,w.version) is distinct from row((p_command->>'expectedSubjectRevision')::bigint,(p_command->>'expectedGeneration')::bigint,(p_command->>'expectedWorkerVersion')::bigint)
     or p_command ? 'expectedCredentialRevision' and coalesce(c.revision,0)<>(p_command->>'expectedCredentialRevision')::bigint then raise exception 'attendance_independent_changed';end if;
    if s.revision>=9007199254740990 or w.version>=9007199254740990 or s.updated_at>stamp or c.changed_at>stamp then raise exception 'attendance_independent_changed';end if;
    if a in('disable','revoke_pin','bind_member') and s.generation>=9007199254740990 then raise exception 'attendance_independent_changed';end if;
    if a='enable' and s.enabled or a='disable' and not s.enabled or a='revoke_pin' and not coalesce(c.enabled,false) then raise exception 'attendance_independent_unchanged';end if;
    if a in('enable','issue_pin') then
     select * into l from public.merchant_attendance_locations where merchant_id=p_site and id=w.default_location_id for share;
     if l.id is null or not l.active then raise exception 'attendance_location_denied';end if;
     if a='issue_pin' and l.radius_meters is not null then raise exception 'attendance_location_verification_required';end if;
    end if;
    if a='bind_member' then
     select * into tail from public.merchant_attendance_events where merchant_id=p_site and worker_id=w.id order by sequence desc limit 1;
     if tail.id is not null and tail.action<>'clock_out' then raise exception 'attendance_open_sessions';end if;
     if row(tail.id,coalesce(tail.sequence,0)) is distinct from row((p_command->>'expectedLastEventId')::uuid,(p_command->>'expectedSequence')::bigint) then raise exception 'attendance_independent_changed';end if;
     if tail.id is not null then
      select * into x from public.merchant_attendance_independent_event_sources where event_id=tail.id;
      if x.subject_id is distinct from s.subject_id or tail.actor_employee_id is not null then raise exception 'attendance_independent_identity_changed';end if;
      perform public.faolla_attendance_independent_clock_receipt_v1(x);
     end if;
    end if;
    v_credential_revision:=coalesce(c.revision,0);
    if a='issue_pin' then
     if v_credential_revision>=9007199254740990 then raise exception 'attendance_independent_changed';end if;
     v_credential_revision:=v_credential_revision+1;v_credential_id:=coalesce(c.credential_id,gen_random_uuid());
     commitment:=public.faolla_attendance_independent_material_hash_v1(p_site,w.id,s.subject_id,s.generation,v_credential_revision,op,p_material->>'salt',p_material->>'verifier');
     if commitment is distinct from p_material->>'commitment' then raise exception 'attendance_invalid_request';end if;
     insert into public.merchant_attendance_independent_credentials values(p_site,s.subject_id,v_credential_id,w.id,s.generation,v_credential_revision,true,p_material->>'salt',p_material->>'verifier',op,stamp,0,stamp)
      on conflict(merchant_id,subject_id) do update set generation=excluded.generation,revision=excluded.revision,enabled=true,salt=excluded.salt,verifier=excluded.verifier,issue_operation_id=op,changed_at=stamp,attempts=0,window_at=stamp;
    end if;
    if a in('disable','revoke_pin','bind_member') and c.subject_id is not null then
     if v_credential_revision>=9007199254740990 then raise exception 'attendance_independent_changed';end if;v_credential_revision:=v_credential_revision+1;
     update public.merchant_attendance_independent_credentials set enabled=false,salt=null,verifier=null,revision=v_credential_revision,changed_at=stamp where merchant_id=p_site and subject_id=s.subject_id;
    end if;
    delete from public.merchant_attendance_independent_leases where merchant_id=p_site and subject_id=s.subject_id;
    update public.merchant_attendance_independent_subjects set revision=revision+1,generation=generation+case when a in('disable','revoke_pin','bind_member') then 1 else 0 end,
     enabled=case when a='enable' then true when a in('disable','bind_member') then false else enabled end,state=case when a='bind_member' then 'bound' else state end,updated_at=stamp
     where merchant_id=p_site and subject_id=s.subject_id returning * into s;
    update public.merchant_attendance_workers set version=version+1,active=case when a='enable' then true when a='disable' then false else active end,
     employee_id=case when a='bind_member' then e.id else employee_id end,updated_at=stamp where merchant_id=p_site and id=w.id returning * into w;
   end if;
   insert into public.merchant_attendance_independent_entries values(p_site,op,s.subject_id,w.id,a,p_auth,p_command,fp,s.revision,s.generation,w.version,
    case when a in('issue_pin','revoke_pin','disable','bind_member') then coalesce(v_credential_revision,0) else null end,case when a='issue_pin' then v_credential_id else null end,commitment,stamp) returning * into i;
   if a='bind_member' then
    insert into public.merchant_attendance_independent_member_bindings values(p_site,s.subject_id,w.id,op,e.id,e.auth_user_id,w.version,s.generation,tail.id,coalesce(tail.sequence,0),p_auth,fp,stamp);
   end if;
  end if;
 end if;
 if p_command is not null or mode_name='recover' then
  if i.operation_id is not null then receipt:=public.faolla_attendance_independent_receipt_v1(i);end if;data_value:=jsonb_build_object('kind','receipt');
 elsif mode_name='members' then
  --Read-only current-owner choices. The bind writer repeats the same checks
  --under its original employee/role-before-worker locks; a list grants nothing.
  for e in select z.* from public.merchant_enterprise_employees z join public.merchant_enterprise_roles role on role.merchant_id=z.merchant_id and role.id=z.role_id
   where z.merchant_id=p_site and z.status='active' and z.auth_user_id is not null and role.status='active'
    and public.faolla_valid_merchant_enterprise_permissions_v1(role.permissions) is true and array['enterprise.view','attendance.self.view','attendance.self.clock']::text[]<@role.permissions
    and not exists(select 1 from public.merchant_attendance_workers used where used.merchant_id=p_site and used.employee_id=z.id)
    and ((p_query->>'cursor')::uuid is null or z.id>(p_query->>'cursor')::uuid)
    and (p_query->>'search'='' or position(lower(p_query->>'search') in lower(z.display_name))>0)
   order by z.id limit 26 loop
   seen:=seen+1;if seen=26 then next_id:=last_id;exit;end if;
   items:=items||jsonb_build_array(jsonb_build_object('employeeId',e.id,'authUserId',e.auth_user_id,'displayName',e.display_name));last_id:=e.id;
  end loop;data_value:=jsonb_build_object('kind','members','items',items,'nextCursor',next_id);
 elsif mode_name='locations' then
  for l in select z.* from public.merchant_attendance_locations z where z.merchant_id=p_site and z.active
   and ((p_query->>'cursor')::uuid is null or z.id>(p_query->>'cursor')::uuid)
   and (p_query->>'search'='' or position(lower(p_query->>'search') in lower(z.name))>0)
   order by z.id limit 26 loop
   seen:=seen+1;if seen=26 then next_id:=last_id;exit;end if;
   items:=items||jsonb_build_array(jsonb_build_object('locationId',l.id,'name',l.name,'timeZone',l.time_zone));last_id:=l.id;
  end loop;data_value:=jsonb_build_object('kind','locations','items',items,'nextCursor',next_id);
 elsif mode_name='list' then
  for s in select q.* from public.merchant_attendance_independent_subjects q join public.merchant_attendance_workers z on z.merchant_id=q.merchant_id and z.id=q.worker_id
   where q.merchant_id=p_site and ((p_query->>'cursor')::uuid is null or q.subject_id>(p_query->>'cursor')::uuid)
    and (p_query->>'state'='all' or q.state=p_query->>'state') and (p_query->>'search'='' or position(lower(p_query->>'search') in lower(z.worker_no||' '||z.display_name))>0)
   order by q.subject_id limit 26 loop
   seen:=seen+1;if seen=26 then next_id:=last_id;exit;end if;items:=items||jsonb_build_array(public.faolla_attendance_independent_subject_v1(s));last_id:=s.subject_id;
  end loop;data_value:=jsonb_build_object('kind','list','items',items,'nextCursor',next_id);
 else
  select * into s from public.merchant_attendance_independent_subjects where merchant_id=p_site and subject_id=target_subject;
  if s.subject_id is null then raise exception 'attendance_independent_not_found';end if;
  if mode_name='history' then data_value:=jsonb_build_object('kind','history','report',public.faolla_attendance_independent_report_v1(p_site,s.subject_id,(p_query->>'fromDate')::date,(p_query->>'throughDate')::date,(p_query->>'cursor')::uuid));
  else
   select * into c from public.merchant_attendance_independent_credentials where merchant_id=p_site and subject_id=s.subject_id;
   select * into b from public.merchant_attendance_independent_member_bindings where merchant_id=p_site and subject_id=s.subject_id;
   data_value:=jsonb_build_object('kind','detail','subject',public.faolla_attendance_independent_subject_v1(s),
    'credential',jsonb_build_object('credentialId',c.credential_id,'revision',coalesce(c.revision,0),'enabled',coalesce(c.enabled,false),'generation',c.generation,'changedAt',public.faolla_attendance_operational_punch_stamp_v1(c.changed_at)),
    'head',public.faolla_attendance_independent_head_v1(p_site,s.worker_id,s.subject_id),'binding',case when b.subject_id is null then null else public.faolla_attendance_independent_boundary_v1(b) end);
  end if;
 end if;
 result:=jsonb_build_object('protocol','attendance-independent-admin-v1','siteId',p_site,'actorId',p_auth,'readAt',case when data_value->>'kind'='history' then data_value->'report'->>'readAt' else public.faolla_attendance_operational_punch_stamp_v1(clock_timestamp()) end,'settingsVersion',config.version,'data',data_value,'receipt',receipt);
 if octet_length(convert_to(result::text,'UTF8'))>1048576 then raise exception 'attendance_independent_too_large';end if;return result;
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then raise exception 'attendance_invalid_request';
end;
$$;
--END GENERATED DELEGATED CREDENTIALS CORES

create or replace function public.faolla_attendance_delegated_credentials_business_v1(site text,actor uuid,id uuid,c jsonb,material_commitment text)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare terminal_row public.merchant_attendance_terminals%rowtype;terminal_audit public.merchant_attendance_terminal_audit%rowtype;
 member_audit public.merchant_attendance_pin_audit%rowtype;independent_entry public.merchant_attendance_independent_entries%rowtype;
 ref jsonb;facts jsonb;old_command jsonb;stamp timestamptz;op uuid;reference_id uuid;revision_value bigint;
 fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';a text:=c->>'action';kind text:=c->>'kind';
begin
 perform public.faolla_attendance_delegated_credentials_command_v1(c);
 if (a='pin_issue') is distinct from (material_commitment is not null) then raise exception 'attendance_delegated_pin_invalid';end if;
 if a in('terminal_prepare','terminal_revoke') then
  select * into terminal_row from public.merchant_attendance_terminals actual where actual.merchant_id=site and actual.id=(c->>'terminalId')::uuid;
  select * into terminal_audit from public.merchant_attendance_terminal_audit actual where actual.merchant_id=site and actual.terminal_id=terminal_row.id and actual.action=case when a='terminal_prepare' then 'create' else 'revoke' end;
  if terminal_row.id is null or terminal_row.location_id is distinct from (c->>'locationId')::uuid
   or terminal_audit.actor_auth_user_id is distinct from actor or terminal_audit.recorded_at is null
   or a='terminal_prepare' and (terminal_row.created_by is distinct from actor or terminal_row.label is distinct from c->>'label'
    or terminal_row.pair_hash is distinct from c->>'pairHash' or terminal_row.created_at is distinct from terminal_audit.recorded_at)
   or a='terminal_revoke' and (terminal_row.revoked_by is distinct from actor or terminal_row.revoked_at is distinct from terminal_audit.recorded_at) then raise exception 'attendance_delegated_terminals_invalid';end if;
  stamp:=terminal_audit.recorded_at;op:=terminal_row.id;reference_id:=terminal_row.id;revision_value:=case when a='terminal_prepare' then 1 else 2 end;
  ref:=jsonb_build_object('kind','terminal','terminalId',terminal_row.id,'locationId',terminal_row.location_id,'auditAction',terminal_audit.action);
  --Only immutable creation fields and the selected immutable audit. Pairing or
  --a later explicit revoke must not rewrite a prepare receipt's fingerprint.
  facts:=jsonb_build_array(terminal_row.id,terminal_row.location_id,terminal_row.label,terminal_row.time_zone,terminal_row.created_by,
   to_char(terminal_row.created_at at time zone 'UTC',fmt),terminal_row.pair_hash,to_char(terminal_row.pair_expires_at at time zone 'UTC',fmt),
   terminal_audit.action,terminal_audit.actor_auth_user_id,to_char(stamp at time zone 'UTC',fmt));
 elsif kind='member_pin' then
  select * into member_audit from public.merchant_attendance_pin_audit actual where actual.merchant_id=site and actual.operation_id=(c->>'operationId')::uuid;
  if member_audit.operation_id is null or member_audit.worker_id is distinct from (c->>'workerId')::uuid or member_audit.actor is distinct from actor
   or member_audit.action is distinct from (case when a='pin_issue' then 'set' else 'revoke' end)
   or member_audit.revision is distinct from (c->>'expectedRevision')::bigint+1
   or member_audit.command_hash is distinct from coalesce(material_commitment,public.faolla_attendance_delegated_credentials_hash_v1(site,actor,id,c)) then raise exception 'attendance_delegated_pin_invalid';end if;
  stamp:=member_audit.recorded_at;op:=member_audit.operation_id;reference_id:=member_audit.worker_id;revision_value:=member_audit.revision;
  ref:=jsonb_build_object('kind','member_pin','workerId',member_audit.worker_id,'employeeId',c->'employeeId','employeeAuthUserId',c->'employeeAuthUserId','revision',member_audit.revision);
  facts:=to_jsonb(member_audit)||jsonb_build_object('recorded_at',to_char(stamp at time zone 'UTC',fmt));
 elsif kind='independent_pin' then
  select * into independent_entry from public.merchant_attendance_independent_entries actual where actual.merchant_id=site and actual.operation_id=(c->>'operationId')::uuid;
  old_command:=jsonb_build_object('action',case when a='pin_issue' then 'issue_pin' else 'revoke_pin' end,'operationId',c->'operationId','subjectId',c->'subjectId',
   'expectedSubjectRevision',c->'expectedSubjectRevision','expectedGeneration',c->'expectedGeneration','expectedWorkerVersion',c->'expectedWorkerVersion',
   'expectedSettingsVersion',c->'expectedSettingsVersion','expectedCredentialRevision',c->'expectedCredentialRevision','reason',c->'reason');
  if independent_entry.operation_id is null or independent_entry.worker_id is distinct from (c->>'workerId')::uuid
   or independent_entry.subject_id is distinct from (c->>'subjectId')::uuid or independent_entry.actor_auth_user_id is distinct from actor
   or independent_entry.command is distinct from old_command or independent_entry.command_fingerprint is distinct from public.faolla_attendance_independent_admin_hash_v1(site,actor,old_command)
   or row(independent_entry.subject_revision,independent_entry.generation,independent_entry.worker_version,independent_entry.credential_revision)
    is distinct from row((c->>'expectedSubjectRevision')::bigint+1,(c->>'expectedGeneration')::bigint+case when a='pin_revoke' then 1 else 0 end,
     (c->>'expectedWorkerVersion')::bigint+1,(c->>'expectedCredentialRevision')::bigint+1)
   or independent_entry.material_commitment is distinct from material_commitment
   or (a='pin_issue') is distinct from (independent_entry.credential_id is not null) then raise exception 'attendance_delegated_pin_invalid';end if;
  stamp:=independent_entry.recorded_at;op:=independent_entry.operation_id;reference_id:=independent_entry.subject_id;revision_value:=independent_entry.subject_revision;
  ref:=jsonb_build_object('kind','independent_pin','workerId',independent_entry.worker_id,'subjectId',independent_entry.subject_id,
   'subjectRevision',independent_entry.subject_revision,'generation',independent_entry.generation,'workerVersion',independent_entry.worker_version,'credentialRevision',independent_entry.credential_revision);
  facts:=to_jsonb(independent_entry)||jsonb_build_object('recorded_at',to_char(stamp at time zone 'UTC',fmt));
 else raise exception 'attendance_invalid_request';end if;
 if stamp is null or not isfinite(stamp) then raise exception 'attendance_management_delegation_invalid';end if;
 return jsonb_build_object('reference',ref,'businessOperationId',op,'businessReferenceId',reference_id,'businessRevision',revision_value,
  'recordedAt',to_char(stamp at time zone 'UTC',fmt),'businessFingerprint',public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-delegated-credentials-business-v1',facts,ref)));
end;
$$;

create or replace function public.faolla_attendance_delegated_credentials_proof_v1(p public.merchant_attendance_management_delegation_operations,require_current boolean)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare proof public.merchant_attendance_delegated_credential_proofs%rowtype;g public.merchant_attendance_management_delegations%rowtype;b jsonb;
begin
 select * into proof from public.merchant_attendance_delegated_credential_proofs actual where actual.merchant_id=p.merchant_id and actual.operation_id=p.operation_id;
 select * into g from public.merchant_attendance_management_delegations actual where actual.merchant_id=p.merchant_id and actual.grant_id=p.grant_id;
 if proof.operation_id is null or g.grant_id is null or g.delegated_action not in('terminal_prepare','terminal_revoke','pin_issue','pin_revoke')
  or row(p.actor_auth_user_id,p.delegate_employee_id,p.delegate_generation,p.delegated_action) is distinct from row(g.delegate_auth_user_id,g.delegate_employee_id,g.delegate_generation,g.delegated_action)
  or proof.command->>'operationId' is distinct from p.operation_id::text or proof.command->>'action' is distinct from p.delegated_action
  or proof.command_fingerprint is distinct from p.command_fingerprint or proof.command_fingerprint is distinct from public.faolla_attendance_delegated_credentials_hash_v1(p.merchant_id,p.actor_auth_user_id,p.grant_id,proof.command)
  or proof.recorded_at is distinct from p.recorded_at or not isfinite(p.recorded_at) or p.recorded_at>clock_timestamp()
  or g.command_fingerprint is distinct from public.faolla_attendance_management_hash_v1(p.merchant_id,g.actor_auth_user_id,g.command)
  or p.recorded_at<g.recorded_at or p.recorded_at<g.valid_from or p.recorded_at>=g.valid_until
  or exists(select 1 from public.merchant_attendance_management_delegation_revocations actual where actual.merchant_id=p.merchant_id and actual.grant_id=g.grant_id and actual.recorded_at<=p.recorded_at) then raise exception 'attendance_management_delegation_invalid';end if;
 perform public.faolla_attendance_management_scope_v1(g.scope,g.delegated_action);
 --Scope binding is immutable, not a claim that the CURRENT credential/head is
 --still this old outcome. This also preserves original actor GET recovery.
 if g.scope->>'kind'='terminal' then
  if row(proof.command->>'terminalId',proof.command->>'locationId') is distinct from row(g.scope->>'terminalId',g.scope->>'locationId') then raise exception 'attendance_management_delegation_invalid';end if;
 elsif g.scope->>'kind'='member_pin' then
  if proof.command->>'kind' is distinct from 'member_pin' or row(proof.command->>'workerId',proof.command->>'employeeId',proof.command->>'employeeAuthUserId') is distinct from row(g.scope->>'workerId',g.scope->>'employeeId',g.scope->>'employeeAuthUserId') then raise exception 'attendance_management_delegation_invalid';end if;
 elsif g.scope->>'kind'='independent_pin' then
  if proof.command->>'kind' is distinct from 'independent_pin' or row(proof.command->>'workerId',proof.command->>'subjectId',proof.command->>'expectedGeneration') is distinct from row(g.scope->>'workerId',g.scope->>'subjectId',g.scope->>'generation') then raise exception 'attendance_management_delegation_invalid';end if;
 else raise exception 'attendance_management_delegation_invalid';end if;
 b:=public.faolla_attendance_delegated_credentials_business_v1(p.merchant_id,p.actor_auth_user_id,p.grant_id,proof.command,proof.material_commitment);
 if proof.reference is distinct from b->'reference' or row(p.business_operation_id::text,p.business_reference_id::text,p.business_revision::text,p.business_fingerprint)
  is distinct from row(b->>'businessOperationId',b->>'businessReferenceId',b->>'businessRevision',b->>'businessFingerprint')
  or p.recorded_at is distinct from (b->>'recordedAt')::timestamptz then raise exception 'attendance_management_delegation_invalid';end if;
 if require_current then perform public.faolla_attendance_delegated_credentials_authorize_v1(p.merchant_id,p.actor_auth_user_id,p.grant_id,proof.command,true,p.recorded_at);end if;
 return b;
end;
$$;
create or replace function public.faolla_attendance_delegated_credentials_authority_v1(p public.merchant_attendance_management_delegation_operations)
returns void language plpgsql set search_path=pg_catalog as $$
begin
 perform public.faolla_attendance_delegated_credentials_proof_v1(p,true);
end;
$$;
create or replace function public.faolla_attendance_delegated_credentials_receipt_v1(site text,op uuid,actor uuid,id uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare p public.merchant_attendance_management_delegation_operations%rowtype;b jsonb;
begin
 select * into p from public.merchant_attendance_management_delegation_operations actual where actual.merchant_id=site and actual.operation_id=op
  and actual.actor_auth_user_id=actor and actual.grant_id=id and actual.delegated_action in('terminal_prepare','terminal_revoke','pin_issue','pin_revoke');
 if p.operation_id is null then return null;end if;
 b:=public.faolla_attendance_delegated_credentials_proof_v1(p,false);
 return jsonb_build_object('operationId',p.operation_id,'actorId',actor,'grantId',p.grant_id,'action',p.delegated_action,'reference',b->'reference',
  'commandFingerprint',p.command_fingerprint,'businessFingerprint',p.business_fingerprint,'recordedAt',b->'recordedAt');
end;
$$;

--Historical prepare provenance, not a perpetual management grant. Revoking or
--expiring a management grant/account does not remotely revoke an issued device.
create or replace function public.faolla_attendance_delegated_credentials_issuer_v1(site text,terminal_id uuid)
returns boolean language plpgsql stable set search_path=pg_catalog as $$
declare p public.merchant_attendance_management_delegation_operations%rowtype;g public.merchant_attendance_management_delegations%rowtype;
begin
 select * into p from public.merchant_attendance_management_delegation_operations actual where actual.merchant_id=site and actual.delegated_action='terminal_prepare' and actual.business_operation_id=terminal_id;
 if p.operation_id is null then return false;end if;
 select * into g from public.merchant_attendance_management_delegations actual where actual.merchant_id=site and actual.grant_id=p.grant_id;
 if not exists(select 1 from public.merchants actual where actual.id=site and actual.user_id=g.actor_auth_user_id) then return false;end if;
 perform public.faolla_attendance_delegated_credentials_proof_v1(p,false);return true;
end;
$$;
create or replace function public.faolla_attendance_delegated_credentials_proof_insert_v1()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if tg_op<>'INSERT' then raise exception 'attendance_management_delegation_invalid';end if;
 perform public.faolla_attendance_delegated_credentials_command_v1(new.command);
 if new.command->>'operationId' is distinct from new.operation_id::text or new.recorded_at>clock_timestamp() then raise exception 'attendance_management_delegation_invalid';end if;
 return new;
end;
$$;
create or replace function public.faolla_attendance_delegated_credentials_pair_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare p public.merchant_attendance_management_delegation_operations%rowtype;
begin
 select * into p from public.merchant_attendance_management_delegation_operations actual where actual.merchant_id=new.merchant_id and actual.operation_id=new.operation_id;
 if p.operation_id is null then raise exception 'attendance_management_delegation_invalid';end if;
 perform public.faolla_attendance_delegated_credentials_proof_v1(p,false);return new;
end;
$$;
do $credentials207_storage$
begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610080207 and name='merchant_attendance_delegated_credentials') then return;end if;
 create trigger credentials207_proof_insert before insert on public.merchant_attendance_delegated_credential_proofs for each row execute function public.faolla_attendance_delegated_credentials_proof_insert_v1();
 create trigger credentials207_proof_immutable before update or delete on public.merchant_attendance_delegated_credential_proofs for each row execute function public.faolla_attendance_events_append_only_v1();
 create trigger credentials207_proof_no_truncate before truncate on public.merchant_attendance_delegated_credential_proofs for each statement execute function public.faolla_attendance_events_append_only_v1();
 create constraint trigger credentials207_proof_pair after insert on public.merchant_attendance_delegated_credential_proofs deferrable initially deferred for each row execute function public.faolla_attendance_delegated_credentials_pair_v1();
end;
$credentials207_storage$;

create or replace function public.faolla_attendance_delegated_credentials_execute_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb,p_allow_write boolean,p_material jsonb,p_family text)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare site text:=p_query->>'siteId';id uuid;op uuid;mode_name text:=p_query->>'mode';protocol_name text;
 g public.merchant_attendance_management_delegations%rowtype;stored public.merchant_attendance_management_delegation_operations%rowtype;
 proof public.merchant_attendance_delegated_credential_proofs%rowtype;w public.merchant_attendance_workers%rowtype;
 member_credential public.merchant_attendance_pin_credentials%rowtype;independent_credential public.merchant_attendance_independent_credentials%rowtype;
 l public.merchant_attendance_locations%rowtype;settings_version bigint;stamp timestamptz;started_at timestamptz;
 fp text;commitment text;receipt jsonb;common jsonb;result jsonb;context_value jsonb;old_query jsonb;old_command jsonb;old_result jsonb;b jsonb;
 a text:=p_command->>'action';fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';pass integer;
begin
 if p_family is null or p_family not in('terminal','pin') or p_auth_user_id is null or site is null or site!~'^[0-9]{8}$' or p_allow_write is null
  or p_query is null or octet_length(convert_to(p_query::text,'UTF8'))>4096
  or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','grantId','mode','operationId']) is distinct from true
  or not public.faolla_attendance_management_scalar_v1(p_query->'grantId','uuid') then raise exception 'attendance_invalid_request';end if;
 if mode_name='context' then
  if p_query->'operationId' is distinct from 'null'::jsonb then raise exception 'attendance_invalid_request';end if;
 elsif mode_name='recover' then
  if p_command is not null or not public.faolla_attendance_management_scalar_v1(p_query->'operationId','uuid') then raise exception 'attendance_invalid_request';end if;
 else raise exception 'attendance_invalid_request';end if;
 id:=(p_query->>'grantId')::uuid;protocol_name:=case when p_family='terminal' then 'attendance-delegated-terminals-v1' else 'attendance-delegated-pin-v1' end;
 if p_command is not null then
  perform public.faolla_attendance_delegated_credentials_command_v1(p_command);
  if (p_family='terminal') is distinct from (a in('terminal_prepare','terminal_revoke')) then raise exception 'attendance_invalid_request';end if;
  op:=(p_command->>'operationId')::uuid;fp:=public.faolla_attendance_delegated_credentials_hash_v1(site,p_auth_user_id,id,p_command);
 end if;
 if a is distinct from 'pin_issue' then
  if p_material is not null then raise exception 'attendance_invalid_request';end if;
 elsif public.faolla_attendance_shift_rule_binding_object_v1(p_material,array['salt','verifier','commitment']) is distinct from true
  or jsonb_typeof(p_material->'salt') is distinct from 'string' or coalesce(p_material->>'salt','')!~'^[0-9a-f]{32}$'
  or jsonb_typeof(p_material->'verifier') is distinct from 'string' or coalesce(p_material->>'verifier','')!~'^[0-9a-f]{64}$'
  or jsonb_typeof(p_material->'commitment') is distinct from 'string' or coalesce(p_material->>'commitment','')!~'^[0-9a-f]{64}$' then raise exception 'attendance_invalid_request';end if;
 if mode_name='recover' then
  receipt:=public.faolla_attendance_delegated_credentials_receipt_v1(site,(p_query->>'operationId')::uuid,p_auth_user_id,id);
  if receipt is not null and (p_family='terminal') is distinct from (receipt->>'action' in('terminal_prepare','terminal_revoke')) then receipt:=null;end if;
  return jsonb_build_object('protocol',protocol_name,'siteId',site,'actorId',p_auth_user_id,'readAt',to_char(clock_timestamp() at time zone 'UTC',fmt),'kind','receipt','receipt',receipt);
 end if;
 --First exact original actor/command check, then merchant/settings lock and
 --the same check again. Secret-free actions recover before CURRENT authority.
 --PIN issue deliberately does NOT public-H-shortcircuit private material.
 for pass in 1..2 loop
  if op is not null then
   select * into stored from public.merchant_attendance_management_delegation_operations actual where actual.merchant_id=site and actual.operation_id=op;
   if stored.operation_id is not null then
    select * into proof from public.merchant_attendance_delegated_credential_proofs actual where actual.merchant_id=site and actual.operation_id=op;
    if row(stored.actor_auth_user_id,stored.grant_id,stored.command_fingerprint) is distinct from row(p_auth_user_id,id,fp)
     or proof.operation_id is null or proof.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
    receipt:=public.faolla_attendance_delegated_credentials_receipt_v1(site,op,p_auth_user_id,id);
    if a<>'pin_issue' then return jsonb_build_object('protocol',protocol_name,'siteId',site,'actorId',p_auth_user_id,'readAt',to_char(clock_timestamp() at time zone 'UTC',fmt),'kind','receipt','receipt',receipt);end if;
   end if;
  end if;
  if pass=1 then
   perform 1 from public.merchants actual where actual.id=site for share;if not found then raise exception 'attendance_access_denied';end if;
   if p_command is null then select actual.version into settings_version from public.merchant_attendance_settings actual where actual.merchant_id=site for share;
   else select actual.version into settings_version from public.merchant_attendance_settings actual where actual.merchant_id=site for update;end if;
   if settings_version is null then raise exception 'attendance_settings_required';end if;
  end if;
 end loop;
 stamp:=clock_timestamp();g:=public.faolla_attendance_delegated_credentials_authorize_v1(site,p_auth_user_id,id,p_command,false,stamp);
 if (p_family='terminal') is distinct from (g.scope->>'kind'='terminal') then raise exception 'attendance_access_denied';end if;
 if p_command is not null and p_allow_write is distinct from true then
  if p_family='terminal' then raise exception 'attendance_delegated_terminals_disabled';else raise exception 'attendance_delegated_pin_disabled';end if;
 end if;
 if a='pin_issue' then
  if p_command->>'kind'='member_pin' then commitment:=public.faolla_attendance_delegated_credentials_member_material_v1(site,p_auth_user_id,id,p_command,p_material);
  else commitment:=public.faolla_attendance_independent_material_hash_v1(site,(p_command->>'workerId')::uuid,(p_command->>'subjectId')::uuid,
    (p_command->>'expectedGeneration')::bigint,(p_command->>'expectedCredentialRevision')::bigint+1,op,p_material->>'salt',p_material->>'verifier');end if;
  if commitment is distinct from p_material->>'commitment' then raise exception 'attendance_operation_conflict';end if;
  if stored.operation_id is not null then
   if proof.material_commitment is distinct from commitment then raise exception 'attendance_operation_conflict';end if;
   return jsonb_build_object('protocol',protocol_name,'siteId',site,'actorId',p_auth_user_id,'readAt',to_char(clock_timestamp() at time zone 'UTC',fmt),'kind','receipt','receipt',receipt);
  end if;
 end if;
 common:=jsonb_build_object('protocol',protocol_name,'siteId',site,'actorId',p_auth_user_id,'readAt',to_char(stamp at time zone 'UTC',fmt));
 if p_command is null then
  if p_family='terminal' then
   select * into l from public.merchant_attendance_locations actual where actual.merchant_id=site and actual.id=(g.scope->>'locationId')::uuid;
   context_value:=jsonb_build_object('terminal',public.faolla_attendance_terminal_snapshot_v1(site,(g.scope->>'terminalId')::uuid,stamp),
    'location',jsonb_build_object('locationId',l.id,'name',l.name,'timeZone',l.time_zone,'version',l.version,'active',l.active));
  elsif g.scope->>'kind'='member_pin' then
   select * into w from public.merchant_attendance_workers actual where actual.merchant_id=site and actual.id=(g.scope->>'workerId')::uuid;
   old_result:=public.faolla_attendance_delegated_credentials_member_core_v1(site,p_auth_user_id,w.worker_no,null,null,false,id);
   context_value:=jsonb_build_object('status',old_result,'employeeAuthUserId',g.scope->'employeeAuthUserId');
  else
   old_query:=jsonb_build_object('siteId',site,'mode','detail','subjectId',g.scope->'subjectId');
   old_result:=public.faolla_attendance_delegated_credentials_independent_core_v1(p_site=>site,p_auth=>p_auth_user_id,p_query=>old_query,p_command=>null,p_material=>null,p_allow_new=>false,p_grant_id=>id);
   context_value:=jsonb_build_object('settingsVersion',old_result->'settingsVersion','detail',old_result->'data');
  end if;
  result:=common||jsonb_build_object('kind','context','grantId',id,'action',g.delegated_action,'scope',g.scope,'context',context_value);
 else
  started_at:=clock_timestamp();
  if p_family='terminal' then
   if a='terminal_prepare' and exists(select 1 from public.merchant_attendance_terminals actual where actual.merchant_id=site and actual.id=(p_command->>'terminalId')::uuid)
    then raise exception 'attendance_operation_conflict';end if;
   if a='terminal_revoke' and exists(select 1 from public.merchant_attendance_terminals actual where actual.merchant_id=site and actual.id=(p_command->>'terminalId')::uuid and actual.revoked_at is not null)
    then raise exception 'attendance_operation_conflict';end if;
   old_command:=jsonb_build_object('action',case when a='terminal_prepare' then 'create' else 'revoke' end,'terminalId',p_command->'terminalId');
   if a='terminal_prepare' then old_command:=old_command||jsonb_build_object('locationId',p_command->'locationId','label',p_command->'label','pairHash',p_command->'pairHash');end if;
   old_result:=public.faolla_attendance_delegated_credentials_terminal_core_v1(site,p_auth_user_id,jsonb_build_object('cursor',null,'terminalId',null),old_command,true,id);
  elsif g.scope->>'kind'='member_pin' then
   if exists(select 1 from public.merchant_attendance_pin_audit actual where actual.merchant_id=site and actual.operation_id=op) then raise exception 'attendance_operation_conflict';end if;
   select * into member_credential from public.merchant_attendance_pin_credentials actual where actual.merchant_id=site and actual.worker_id=(p_command->>'workerId')::uuid;
   if a='pin_revoke' and (member_credential.worker_id is null or not member_credential.enabled) then raise exception 'attendance_pin_changed';end if;
   old_command:=jsonb_build_object('action',case when a='pin_issue' then 'set' else 'revoke' end,'operationId',op,'expectedRevision',p_command->'expectedRevision',
    'workerId',p_command->'workerId','employeeId',p_command->'employeeId','salt',p_material->'salt','verifier',p_material->'verifier','commandHash',coalesce(commitment,fp));
   old_result:=public.faolla_attendance_delegated_credentials_member_core_v1(site,p_auth_user_id,p_command->>'workerNo',null,old_command,true,id);
  else
   if exists(select 1 from public.merchant_attendance_independent_entries actual where actual.merchant_id=site and actual.operation_id=op) then raise exception 'attendance_operation_conflict';end if;
   select * into independent_credential from public.merchant_attendance_independent_credentials actual where actual.merchant_id=site and actual.subject_id=(p_command->>'subjectId')::uuid;
   if a='pin_revoke' and (independent_credential.subject_id is null or not independent_credential.enabled) then raise exception 'attendance_independent_unchanged';end if;
   old_query:=jsonb_build_object('siteId',site,'mode','detail','subjectId',p_command->'subjectId');
   old_command:=jsonb_build_object('action',case when a='pin_issue' then 'issue_pin' else 'revoke_pin' end,'operationId',op,'subjectId',p_command->'subjectId',
    'expectedSubjectRevision',p_command->'expectedSubjectRevision','expectedGeneration',p_command->'expectedGeneration','expectedWorkerVersion',p_command->'expectedWorkerVersion',
    'expectedSettingsVersion',p_command->'expectedSettingsVersion','expectedCredentialRevision',p_command->'expectedCredentialRevision','reason',p_command->'reason');
   old_result:=public.faolla_attendance_delegated_credentials_independent_core_v1(p_site=>site,p_auth=>p_auth_user_id,p_query=>old_query,p_command=>old_command,p_material=>p_material,p_allow_new=>true,p_grant_id=>id);
  end if;
  --No adoption of any already-existing audit/entry. Its real writer must have
  --produced this postimage after the current scoped authorization above.
  b:=public.faolla_attendance_delegated_credentials_business_v1(site,p_auth_user_id,id,p_command,commitment);
  if (b->>'recordedAt')::timestamptz<started_at or (b->>'recordedAt')::timestamptz>clock_timestamp() then raise exception 'attendance_operation_conflict';end if;
  insert into public.merchant_attendance_delegated_credential_proofs values(site,op,p_command,fp,b->'reference',commitment,(b->>'recordedAt')::timestamptz);
  insert into public.merchant_attendance_management_delegation_operations(merchant_id,operation_id,grant_id,actor_auth_user_id,delegate_employee_id,delegate_generation,delegated_action,
   business_operation_id,business_reference_id,business_revision,business_fingerprint,command_fingerprint,recorded_at)
   values(site,op,id,p_auth_user_id,g.delegate_employee_id,g.delegate_generation,g.delegated_action,(b->>'businessOperationId')::uuid,(b->>'businessReferenceId')::uuid,
    (b->>'businessRevision')::bigint,b->>'businessFingerprint',fp,(b->>'recordedAt')::timestamptz);
  result:=jsonb_build_object('protocol',protocol_name,'siteId',site,'actorId',p_auth_user_id,'readAt',to_char(clock_timestamp() at time zone 'UTC',fmt),
   'kind','receipt','receipt',public.faolla_attendance_delegated_credentials_receipt_v1(site,op,p_auth_user_id,id));
 end if;
 if octet_length(convert_to(result::text,'UTF8'))>262144 then
  if p_family='terminal' then raise exception 'attendance_delegated_terminals_invalid';else raise exception 'attendance_delegated_pin_invalid';end if;
 end if;
 return result;
end;
$$;
create or replace function public.faolla_attendance_delegated_terminals_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false,p_material jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
 return public.faolla_attendance_delegated_credentials_execute_v1(p_query,p_auth_user_id,p_command,p_allow_write,p_material,'terminal');
end;
$$;
create or replace function public.faolla_attendance_delegated_pin_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false,p_material jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
 return public.faolla_attendance_delegated_credentials_execute_v1(p_query,p_auth_user_id,p_command,p_allow_write,p_material,'pin');
end;
$$;

--BEGIN GENERATED DELEGATED CREDENTIALS FORWARD
do $credentials207_forward_0$ declare old_body text;definition text;begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610080207 and name='merchant_attendance_delegated_credentials') then return;end if;
 select replace(proc.prosrc,E'\r\n',E'\n'),pg_get_functiondef(proc.oid) into old_body,definition from pg_proc proc where proc.oid='public.faolla_attendance_terminal_admin_v1(text,uuid,jsonb,jsonb,boolean)'::regprocedure;
 if old_body is distinct from $credentials207_old_0$
declare
  m public.merchants%rowtype; t public.merchant_attendance_terminals%rowtype; l public.merchant_attendance_locations%rowtype;
  now_at timestamptz; target uuid; cursor_id uuid; rows_json jsonb; next_id uuid;
  uuid_pattern text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_site is null or p_site !~ '^\d{8}$' or p_auth is null or p_query is null or jsonb_typeof(p_query)<>'object'
    or (select count(*) from jsonb_object_keys(p_query))<>2 or not(p_query ?& array['cursor','terminalId'])
    or (p_query->'cursor'<>'null'::jsonb and coalesce(p_query->>'cursor','') !~ uuid_pattern)
    or (p_query->'terminalId'<>'null'::jsonb and coalesce(p_query->>'terminalId','') !~ uuid_pattern)
    or (p_query->>'cursor' is not null and p_query->>'terminalId' is not null)
  then raise exception 'attendance_invalid_request'; end if;
  target:=(p_query->>'terminalId')::uuid; cursor_id:=(p_query->>'cursor')::uuid;
  if p_command is not null then
    if jsonb_typeof(p_command)<>'object' or target is not null or cursor_id is not null
      or coalesce(p_command->>'terminalId','') !~ uuid_pattern
      or coalesce(p_command->>'action','') not in ('create','revoke') then raise exception 'attendance_invalid_request'; end if;
    target:=(p_command->>'terminalId')::uuid;
    if p_command->>'action'='create' then
      if (select count(*) from jsonb_object_keys(p_command))<>5 or not(p_command ?& array['action','terminalId','locationId','label','pairHash'])
        or coalesce(p_command->>'locationId','') !~ uuid_pattern or jsonb_typeof(p_command->'label')<>'string'
        or char_length(btrim(p_command->>'label')) not between 1 and 80 or (p_command->>'label') ~ '[[:cntrl:]]'
        or coalesce(p_command->>'pairHash','') !~ '^[0-9a-f]{64}$' then raise exception 'attendance_invalid_request'; end if;
    elsif (select count(*) from jsonb_object_keys(p_command))<>2 then raise exception 'attendance_invalid_request'; end if;
  end if;
  select * into m from public.merchants where id=p_site for share;
  if not found or not coalesce(p_auth=any(array[m.user_id,m.auth_user_id,m.owner_user_id,m.owner_id,m.auth_id,m.created_by,m.created_by_user_id]),false)
    then raise exception 'attendance_access_denied'; end if;
  -- Consistent lock order: merchant -> settings -> location -> terminal.
  -- Configuration writes already use settings FOR UPDATE; no old writer changes.
  if p_command is null then perform 1 from public.merchant_attendance_settings where merchant_id=p_site for share;
  else perform 1 from public.merchant_attendance_settings where merchant_id=p_site for update; end if;
  if not found then raise exception 'attendance_settings_required'; end if;
  now_at:=clock_timestamp();
  if p_command is not null then
    select * into t from public.merchant_attendance_terminals where merchant_id=p_site and id=target for update;
    if p_command->>'action'='create' then
      if t.id is not null then
        if t.created_by<>p_auth or t.location_id<>(p_command->>'locationId')::uuid or t.label<>btrim(p_command->>'label') or t.pair_hash<>p_command->>'pairHash'
          then raise exception 'attendance_operation_conflict'; end if;
        -- Same intent returns CURRENT metadata only; never renew an expiry or resurrect.
      else
        if p_allow_create is distinct from true then raise exception 'attendance_platform_paused'; end if;
        select * into l from public.merchant_attendance_locations where merchant_id=p_site and id=(p_command->>'locationId')::uuid for share;
        if not found or not l.active then raise exception 'attendance_location_denied'; end if;
        if (select count(*) from public.merchant_attendance_terminals where merchant_id=p_site and revoked_at is null
            and coalesce(device_expires_at,pair_expires_at)>now_at)>=20
          or (select count(*) from public.merchant_attendance_terminals where merchant_id=p_site and created_at>now_at-interval '1 hour')>=10
          then raise exception 'attendance_terminal_limit'; end if;
        insert into public.merchant_attendance_terminals(merchant_id,id,location_id,label,time_zone,created_by,created_at,pair_hash,pair_expires_at)
          values(p_site,target,l.id,btrim(p_command->>'label'),l.time_zone,p_auth,now_at,p_command->>'pairHash',now_at+interval '5 minutes');
        insert into public.merchant_attendance_terminal_audit values(p_site,target,'create',p_auth,now_at);
      end if;
    else
      if t.id is null then raise exception 'attendance_terminal_not_found'; end if;
      if t.revoked_at is null then
        if now_at<coalesce(t.paired_at,t.created_at) then raise exception 'attendance_time_reversed'; end if;
        update public.merchant_attendance_terminals set revoked_at=now_at,revoked_by=p_auth where merchant_id=p_site and id=target;
        insert into public.merchant_attendance_terminal_audit values(p_site,target,'revoke',p_auth,now_at);
      end if;
    end if;
  end if;
  select coalesce(jsonb_agg(public.faolla_attendance_terminal_snapshot_v1(p_site,page.id,now_at) order by page.id),'[]'::jsonb)
    into rows_json from (select id from public.merchant_attendance_terminals where merchant_id=p_site
      and (target is null or id=target) and (cursor_id is null or id>cursor_id) order by id limit 26) page;
  if jsonb_array_length(rows_json)>25 then rows_json:=rows_json-25; next_id:=(rows_json->24->>'id')::uuid; end if;
  return jsonb_build_object('siteId',p_site,'items',rows_json,'nextCursor',next_id);
end;
$credentials207_old_0$ or position(old_body in definition)=0 then raise exception 'merchant_attendance_delegated_credentials_forward_drift';end if;
 execute replace(definition,old_body,$credentials207_new_0$
begin
 return public.faolla_attendance_delegated_credentials_terminal_core_v1(p_site,p_auth,p_query,p_command,p_allow_create,null);
end;
$credentials207_new_0$);
 end;$credentials207_forward_0$;
do $credentials207_forward_1$ declare old_body text;definition text;begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610080207 and name='merchant_attendance_delegated_credentials') then return;end if;
 select replace(proc.prosrc,E'\r\n',E'\n'),pg_get_functiondef(proc.oid) into old_body,definition from pg_proc proc where proc.oid='public.faolla_attendance_pin_admin_v1(text,uuid,text,uuid,jsonb,boolean)'::regprocedure;
 if old_body is distinct from $credentials207_old_1$
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
end;$credentials207_old_1$ or position(old_body in definition)=0 then raise exception 'merchant_attendance_delegated_credentials_forward_drift';end if;
 execute replace(definition,old_body,$credentials207_new_1$
begin
 return public.faolla_attendance_delegated_credentials_member_core_v1(p_site,p_auth,p_no,p_operation,p_command,p_allow_set,null);
end;
$credentials207_new_1$);
 end;$credentials207_forward_1$;
do $credentials207_forward_2$ declare old_body text;definition text;begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610080207 and name='merchant_attendance_delegated_credentials') then return;end if;
 select replace(proc.prosrc,E'\r\n',E'\n'),pg_get_functiondef(proc.oid) into old_body,definition from pg_proc proc where proc.oid='public.faolla_attendance_independent_admin_v1(text,uuid,jsonb,jsonb,jsonb,boolean)'::regprocedure;
 if old_body is distinct from $credentials207_old_2$
declare m public.merchants%rowtype;config public.merchant_attendance_settings%rowtype;s public.merchant_attendance_independent_subjects%rowtype;
 w public.merchant_attendance_workers%rowtype;c public.merchant_attendance_independent_credentials%rowtype;i public.merchant_attendance_independent_entries%rowtype;
 b public.merchant_attendance_independent_member_bindings%rowtype;e public.merchant_enterprise_employees%rowtype;r public.merchant_enterprise_roles%rowtype;l public.merchant_attendance_locations%rowtype;
 tail public.merchant_attendance_events%rowtype;x public.merchant_attendance_independent_event_sources%rowtype;
 mode_name text:=p_query->>'mode';a text:=p_command->>'action';ks text[];owner_now boolean;target_subject uuid;stamp timestamptz;fp text;commitment text;
 op uuid;v_credential_revision bigint;v_credential_id uuid;items jsonb:='[]';data_value jsonb;receipt jsonb:='null';result jsonb;seen integer:=0;last_id uuid;next_id uuid;
begin
 if p_site is null or p_site!~'^[0-9]{8}$' or p_auth is null or p_query->>'siteId' is distinct from p_site then raise exception 'attendance_invalid_request';end if;
 ks:=array['siteId','mode'];
 if mode_name='list' then ks:=ks||array['cursor','search','state'];
 elsif mode_name in('members','locations') then ks:=ks||array['cursor','search'];
 elsif mode_name in('detail','recover','history') then ks:=ks||array['subjectId'];
  if mode_name='recover' then ks:=ks||array['operationId'];end if;
  if mode_name='history' then ks:=ks||array['fromDate','throughDate','cursor'];end if;
 else raise exception 'attendance_invalid_request';end if;
 if public.faolla_attendance_operational_rule_object_v1(p_query,ks) is distinct from true then raise exception 'attendance_invalid_request';end if;
 if p_query ? 'cursor' and p_query->'cursor'<>'null'::jsonb and public.faolla_attendance_independent_scalar_v1(p_query->'cursor','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
 if mode_name in('list','members','locations') then
  if not public.faolla_attendance_independent_text_v1(p_query->>'search',0,80) then raise exception 'attendance_invalid_request';end if;
  if mode_name='list' and (p_query->>'state' is null or p_query->>'state' not in('all','independent','bound')) then raise exception 'attendance_invalid_request';end if;
 else
  if public.faolla_attendance_independent_scalar_v1(p_query->'subjectId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;target_subject:=(p_query->>'subjectId')::uuid;
 end if;
 if mode_name='recover' and public.faolla_attendance_independent_scalar_v1(p_query->'operationId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
 if mode_name='history' and (public.faolla_attendance_independent_scalar_v1(p_query->'fromDate','date') is distinct from true or public.faolla_attendance_independent_scalar_v1(p_query->'throughDate','date') is distinct from true) then raise exception 'attendance_invalid_request';end if;
 if p_command is not null then
  perform public.faolla_attendance_independent_command_v1(p_command);
  if mode_name<>'detail' or p_command->>'subjectId' is distinct from target_subject::text then raise exception 'attendance_invalid_request';end if;
  op:=(p_command->>'operationId')::uuid;fp:=public.faolla_attendance_independent_admin_hash_v1(p_site,p_auth,p_command);
  if a='issue_pin' then
   if public.faolla_attendance_operational_rule_object_v1(p_material,array['salt','verifier','commitment']) is distinct from true
    or coalesce(p_material->>'salt','')!~'^[0-9a-f]{32}$' or coalesce(p_material->>'verifier','')!~'^[0-9a-f]{64}$' or coalesce(p_material->>'commitment','')!~'^[0-9a-f]{64}$' then raise exception 'attendance_invalid_request';end if;
  elsif p_material is not null then raise exception 'attendance_invalid_request';end if;
 elsif p_material is not null then raise exception 'attendance_invalid_request';end if;
 select * into m from public.merchants where id=p_site for share;
 owner_now:=m.id is not null and coalesce(p_auth=any(array[m.user_id,m.auth_user_id,m.owner_user_id,m.owner_id,m.auth_id,m.created_by,m.created_by_user_id]),false);
 if mode_name='recover' then
  select * into i from public.merchant_attendance_independent_entries where merchant_id=p_site and operation_id=(p_query->>'operationId')::uuid;
  if not owner_now and (i.operation_id is null or i.actor_auth_user_id<>p_auth) then raise exception 'attendance_access_denied';end if;
  if i.operation_id is not null and i.subject_id<>target_subject then raise exception 'attendance_operation_conflict';end if;
 elsif not owner_now then raise exception 'attendance_access_denied';end if;
 if p_command is null then select * into config from public.merchant_attendance_settings where merchant_id=p_site for share;
 else select * into config from public.merchant_attendance_settings where merchant_id=p_site for update;end if;
 if config.merchant_id is null then raise exception 'attendance_settings_required';end if;stamp:=clock_timestamp();
 if p_command is not null then
  select * into i from public.merchant_attendance_independent_entries where merchant_id=p_site and operation_id=op;
  if i.operation_id is not null then
   if i.subject_id<>target_subject or i.actor_auth_user_id<>p_auth or i.command is distinct from p_command or i.command_fingerprint<>fp then raise exception 'attendance_operation_conflict';end if;
   if a='issue_pin' then
    commitment:=public.faolla_attendance_independent_material_hash_v1(p_site,i.worker_id,i.subject_id,i.generation,i.credential_revision,op,p_material->>'salt',p_material->>'verifier');
    if commitment is distinct from i.material_commitment or commitment is distinct from p_material->>'commitment' then raise exception 'attendance_operation_conflict';end if;
   end if;
  else
   if a in('create','enable','issue_pin','bind_member') and p_allow_new is distinct from true then raise exception 'attendance_independent_disabled';end if;
   if config.version<>(p_command->>'expectedSettingsVersion')::bigint then raise exception 'attendance_independent_changed';end if;
   if a='create' then
    select * into l from public.merchant_attendance_locations where merchant_id=p_site and id=(p_command->>'locationId')::uuid for share;
    if l.id is null or not l.active then raise exception 'attendance_location_denied';end if;
    if exists(select 1 from public.merchant_attendance_workers where merchant_id=p_site and (id=(p_command->>'workerId')::uuid or lower(btrim(worker_no))=lower(p_command->>'workerNo')))
     or exists(select 1 from public.merchant_attendance_independent_subjects where merchant_id=p_site and subject_id=target_subject) then raise exception 'attendance_operation_conflict';end if;
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,active,default_location_id,version,created_at,updated_at)
     values((p_command->>'workerId')::uuid,p_site,null,p_command->>'workerNo',p_command->>'displayName',false,l.id,1,stamp,stamp) returning * into w;
    insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values(p_site,w.id,(p_command->>'startsOn')::date);
    insert into public.merchant_attendance_independent_subjects values(p_site,target_subject,w.id,'independent','independent',false,0,1,op,p_auth,stamp,stamp) returning * into s;
   else
    --settings UPDATE is acquired before the optional member locks. Never lock
    --worker and then wait on the old member/role-before-worker path.
    if a='bind_member' then
     select * into e from public.merchant_enterprise_employees where merchant_id=p_site and id=(p_command->>'targetEmployeeId')::uuid for share;
     select * into r from public.merchant_enterprise_roles where merchant_id=p_site and id=e.role_id for share;
     if e.id is null or e.status<>'active' or e.auth_user_id is distinct from (p_command->>'targetAuthUserId')::uuid or r.status is distinct from 'active'
      or public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions) is distinct from true or not(array['enterprise.view','attendance.self.view','attendance.self.clock']::text[]<@r.permissions)
      or exists(select 1 from public.merchant_attendance_workers where merchant_id=p_site and employee_id=e.id) then raise exception 'attendance_employee_invalid';end if;
    end if;
    select * into s from public.merchant_attendance_independent_subjects where merchant_id=p_site and subject_id=target_subject;
    select * into w from public.merchant_attendance_workers where merchant_id=p_site and id=s.worker_id for update;
    select * into s from public.merchant_attendance_independent_subjects where merchant_id=p_site and subject_id=target_subject for update;
    select * into c from public.merchant_attendance_independent_credentials where merchant_id=p_site and subject_id=target_subject for update;
    if s.subject_id is null or w.id is null then raise exception 'attendance_independent_not_found';end if;
    if s.state<>'independent' or w.employee_id is not null then raise exception 'attendance_independent_bound';end if;
    if row(s.revision,s.generation,w.version) is distinct from row((p_command->>'expectedSubjectRevision')::bigint,(p_command->>'expectedGeneration')::bigint,(p_command->>'expectedWorkerVersion')::bigint)
     or p_command ? 'expectedCredentialRevision' and coalesce(c.revision,0)<>(p_command->>'expectedCredentialRevision')::bigint then raise exception 'attendance_independent_changed';end if;
    if s.revision>=9007199254740990 or w.version>=9007199254740990 or s.updated_at>stamp or c.changed_at>stamp then raise exception 'attendance_independent_changed';end if;
    if a in('disable','revoke_pin','bind_member') and s.generation>=9007199254740990 then raise exception 'attendance_independent_changed';end if;
    if a='enable' and s.enabled or a='disable' and not s.enabled or a='revoke_pin' and not coalesce(c.enabled,false) then raise exception 'attendance_independent_unchanged';end if;
    if a in('enable','issue_pin') then
     select * into l from public.merchant_attendance_locations where merchant_id=p_site and id=w.default_location_id for share;
     if l.id is null or not l.active then raise exception 'attendance_location_denied';end if;
     if a='issue_pin' and l.radius_meters is not null then raise exception 'attendance_location_verification_required';end if;
    end if;
    if a='bind_member' then
     select * into tail from public.merchant_attendance_events where merchant_id=p_site and worker_id=w.id order by sequence desc limit 1;
     if tail.id is not null and tail.action<>'clock_out' then raise exception 'attendance_open_sessions';end if;
     if row(tail.id,coalesce(tail.sequence,0)) is distinct from row((p_command->>'expectedLastEventId')::uuid,(p_command->>'expectedSequence')::bigint) then raise exception 'attendance_independent_changed';end if;
     if tail.id is not null then
      select * into x from public.merchant_attendance_independent_event_sources where event_id=tail.id;
      if x.subject_id is distinct from s.subject_id or tail.actor_employee_id is not null then raise exception 'attendance_independent_identity_changed';end if;
      perform public.faolla_attendance_independent_clock_receipt_v1(x);
     end if;
    end if;
    v_credential_revision:=coalesce(c.revision,0);
    if a='issue_pin' then
     if v_credential_revision>=9007199254740990 then raise exception 'attendance_independent_changed';end if;
     v_credential_revision:=v_credential_revision+1;v_credential_id:=coalesce(c.credential_id,gen_random_uuid());
     commitment:=public.faolla_attendance_independent_material_hash_v1(p_site,w.id,s.subject_id,s.generation,v_credential_revision,op,p_material->>'salt',p_material->>'verifier');
     if commitment is distinct from p_material->>'commitment' then raise exception 'attendance_invalid_request';end if;
     insert into public.merchant_attendance_independent_credentials values(p_site,s.subject_id,v_credential_id,w.id,s.generation,v_credential_revision,true,p_material->>'salt',p_material->>'verifier',op,stamp,0,stamp)
      on conflict(merchant_id,subject_id) do update set generation=excluded.generation,revision=excluded.revision,enabled=true,salt=excluded.salt,verifier=excluded.verifier,issue_operation_id=op,changed_at=stamp,attempts=0,window_at=stamp;
    end if;
    if a in('disable','revoke_pin','bind_member') and c.subject_id is not null then
     if v_credential_revision>=9007199254740990 then raise exception 'attendance_independent_changed';end if;v_credential_revision:=v_credential_revision+1;
     update public.merchant_attendance_independent_credentials set enabled=false,salt=null,verifier=null,revision=v_credential_revision,changed_at=stamp where merchant_id=p_site and subject_id=s.subject_id;
    end if;
    delete from public.merchant_attendance_independent_leases where merchant_id=p_site and subject_id=s.subject_id;
    update public.merchant_attendance_independent_subjects set revision=revision+1,generation=generation+case when a in('disable','revoke_pin','bind_member') then 1 else 0 end,
     enabled=case when a='enable' then true when a in('disable','bind_member') then false else enabled end,state=case when a='bind_member' then 'bound' else state end,updated_at=stamp
     where merchant_id=p_site and subject_id=s.subject_id returning * into s;
    update public.merchant_attendance_workers set version=version+1,active=case when a='enable' then true when a='disable' then false else active end,
     employee_id=case when a='bind_member' then e.id else employee_id end,updated_at=stamp where merchant_id=p_site and id=w.id returning * into w;
   end if;
   insert into public.merchant_attendance_independent_entries values(p_site,op,s.subject_id,w.id,a,p_auth,p_command,fp,s.revision,s.generation,w.version,
    case when a in('issue_pin','revoke_pin','disable','bind_member') then coalesce(v_credential_revision,0) else null end,case when a='issue_pin' then v_credential_id else null end,commitment,stamp) returning * into i;
   if a='bind_member' then
    insert into public.merchant_attendance_independent_member_bindings values(p_site,s.subject_id,w.id,op,e.id,e.auth_user_id,w.version,s.generation,tail.id,coalesce(tail.sequence,0),p_auth,fp,stamp);
   end if;
  end if;
 end if;
 if p_command is not null or mode_name='recover' then
  if i.operation_id is not null then receipt:=public.faolla_attendance_independent_receipt_v1(i);end if;data_value:=jsonb_build_object('kind','receipt');
 elsif mode_name='members' then
  --Read-only current-owner choices. The bind writer repeats the same checks
  --under its original employee/role-before-worker locks; a list grants nothing.
  for e in select z.* from public.merchant_enterprise_employees z join public.merchant_enterprise_roles role on role.merchant_id=z.merchant_id and role.id=z.role_id
   where z.merchant_id=p_site and z.status='active' and z.auth_user_id is not null and role.status='active'
    and public.faolla_valid_merchant_enterprise_permissions_v1(role.permissions) is true and array['enterprise.view','attendance.self.view','attendance.self.clock']::text[]<@role.permissions
    and not exists(select 1 from public.merchant_attendance_workers used where used.merchant_id=p_site and used.employee_id=z.id)
    and ((p_query->>'cursor')::uuid is null or z.id>(p_query->>'cursor')::uuid)
    and (p_query->>'search'='' or position(lower(p_query->>'search') in lower(z.display_name))>0)
   order by z.id limit 26 loop
   seen:=seen+1;if seen=26 then next_id:=last_id;exit;end if;
   items:=items||jsonb_build_array(jsonb_build_object('employeeId',e.id,'authUserId',e.auth_user_id,'displayName',e.display_name));last_id:=e.id;
  end loop;data_value:=jsonb_build_object('kind','members','items',items,'nextCursor',next_id);
 elsif mode_name='locations' then
  for l in select z.* from public.merchant_attendance_locations z where z.merchant_id=p_site and z.active
   and ((p_query->>'cursor')::uuid is null or z.id>(p_query->>'cursor')::uuid)
   and (p_query->>'search'='' or position(lower(p_query->>'search') in lower(z.name))>0)
   order by z.id limit 26 loop
   seen:=seen+1;if seen=26 then next_id:=last_id;exit;end if;
   items:=items||jsonb_build_array(jsonb_build_object('locationId',l.id,'name',l.name,'timeZone',l.time_zone));last_id:=l.id;
  end loop;data_value:=jsonb_build_object('kind','locations','items',items,'nextCursor',next_id);
 elsif mode_name='list' then
  for s in select q.* from public.merchant_attendance_independent_subjects q join public.merchant_attendance_workers z on z.merchant_id=q.merchant_id and z.id=q.worker_id
   where q.merchant_id=p_site and ((p_query->>'cursor')::uuid is null or q.subject_id>(p_query->>'cursor')::uuid)
    and (p_query->>'state'='all' or q.state=p_query->>'state') and (p_query->>'search'='' or position(lower(p_query->>'search') in lower(z.worker_no||' '||z.display_name))>0)
   order by q.subject_id limit 26 loop
   seen:=seen+1;if seen=26 then next_id:=last_id;exit;end if;items:=items||jsonb_build_array(public.faolla_attendance_independent_subject_v1(s));last_id:=s.subject_id;
  end loop;data_value:=jsonb_build_object('kind','list','items',items,'nextCursor',next_id);
 else
  select * into s from public.merchant_attendance_independent_subjects where merchant_id=p_site and subject_id=target_subject;
  if s.subject_id is null then raise exception 'attendance_independent_not_found';end if;
  if mode_name='history' then data_value:=jsonb_build_object('kind','history','report',public.faolla_attendance_independent_report_v1(p_site,s.subject_id,(p_query->>'fromDate')::date,(p_query->>'throughDate')::date,(p_query->>'cursor')::uuid));
  else
   select * into c from public.merchant_attendance_independent_credentials where merchant_id=p_site and subject_id=s.subject_id;
   select * into b from public.merchant_attendance_independent_member_bindings where merchant_id=p_site and subject_id=s.subject_id;
   data_value:=jsonb_build_object('kind','detail','subject',public.faolla_attendance_independent_subject_v1(s),
    'credential',jsonb_build_object('credentialId',c.credential_id,'revision',coalesce(c.revision,0),'enabled',coalesce(c.enabled,false),'generation',c.generation,'changedAt',public.faolla_attendance_operational_punch_stamp_v1(c.changed_at)),
    'head',public.faolla_attendance_independent_head_v1(p_site,s.worker_id,s.subject_id),'binding',case when b.subject_id is null then null else public.faolla_attendance_independent_boundary_v1(b) end);
  end if;
 end if;
 result:=jsonb_build_object('protocol','attendance-independent-admin-v1','siteId',p_site,'actorId',p_auth,'readAt',case when data_value->>'kind'='history' then data_value->'report'->>'readAt' else public.faolla_attendance_operational_punch_stamp_v1(clock_timestamp()) end,'settingsVersion',config.version,'data',data_value,'receipt',receipt);
 if octet_length(convert_to(result::text,'UTF8'))>1048576 then raise exception 'attendance_independent_too_large';end if;return result;
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then raise exception 'attendance_invalid_request';
end;
$credentials207_old_2$ or position(old_body in definition)=0 then raise exception 'merchant_attendance_delegated_credentials_forward_drift';end if;
 execute replace(definition,old_body,$credentials207_new_2$
begin
 return public.faolla_attendance_delegated_credentials_independent_core_v1(p_site=>p_site,p_auth=>p_auth,p_query=>p_query,p_command=>p_command,p_material=>p_material,p_allow_new=>p_allow_new,p_grant_id=>null);
end;
$credentials207_new_2$);
 end;$credentials207_forward_2$;
do $credentials207_forward_3$ declare old_body text;definition text;begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610080207 and name='merchant_attendance_delegated_credentials') then return;end if;
 select replace(proc.prosrc,E'\r\n',E'\n'),pg_get_functiondef(proc.oid) into old_body,definition from pg_proc proc where proc.oid='public.faolla_attendance_terminal_snapshot_v1(text,uuid,timestamptz)'::regprocedure;
 if old_body is distinct from $credentials207_old_3$
  select jsonb_build_object('id',t.id,'label',t.label,'locationId',t.location_id,'locationName',l.name,'timeZone',t.time_zone,
    'createdAt',to_char(t.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'pairExpiresAt',to_char(t.pair_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'pairedAt',to_char(t.paired_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'deviceExpiresAt',to_char(t.device_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'revokedAt',to_char(t.revoked_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'state',case when t.revoked_at is not null then 'revoked'
      when not l.active or l.time_zone<>t.time_zone or not coalesce(t.created_by=any(array[
        m.user_id,m.auth_user_id,m.owner_user_id,m.owner_id,m.auth_id,m.created_by,m.created_by_user_id]),false) then 'blocked'
      when p_now<t.created_at or p_now<coalesce(t.paired_at,t.created_at) then 'blocked'
      when t.paired_at is null then case when p_now>=t.pair_expires_at then 'expired' else 'pending' end
      when p_now>=t.device_expires_at then 'expired' else 'active' end)
  from public.merchant_attendance_terminals t join public.merchant_attendance_locations l on l.merchant_id=t.merchant_id and l.id=t.location_id
    join public.merchants m on m.id=t.merchant_id where t.merchant_id=p_site and t.id=p_id;
$credentials207_old_3$ or position(old_body in definition)=0 then raise exception 'merchant_attendance_delegated_credentials_forward_drift';end if;
 execute replace(definition,old_body,$credentials207_new_3$
  select jsonb_build_object('id',t.id,'label',t.label,'locationId',t.location_id,'locationName',l.name,'timeZone',t.time_zone,
    'createdAt',to_char(t.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'pairExpiresAt',to_char(t.pair_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'pairedAt',to_char(t.paired_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'deviceExpiresAt',to_char(t.device_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'revokedAt',to_char(t.revoked_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'state',case when t.revoked_at is not null then 'revoked'
      when not l.active or l.time_zone<>t.time_zone or not (coalesce(t.created_by=any(array[
        m.user_id,m.auth_user_id,m.owner_user_id,m.owner_id,m.auth_id,m.created_by,m.created_by_user_id]),false) or public.faolla_attendance_delegated_credentials_issuer_v1(t.merchant_id,t.id)) then 'blocked'
      when p_now<t.created_at or p_now<coalesce(t.paired_at,t.created_at) then 'blocked'
      when t.paired_at is null then case when p_now>=t.pair_expires_at then 'expired' else 'pending' end
      when p_now>=t.device_expires_at then 'expired' else 'active' end)
  from public.merchant_attendance_terminals t join public.merchant_attendance_locations l on l.merchant_id=t.merchant_id and l.id=t.location_id
    join public.merchants m on m.id=t.merchant_id where t.merchant_id=p_site and t.id=p_id;
$credentials207_new_3$);
 end;$credentials207_forward_3$;
do $credentials207_forward_4$ declare old_body text;definition text;begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610080207 and name='merchant_attendance_delegated_credentials') then return;end if;
 select replace(proc.prosrc,E'\r\n',E'\n'),pg_get_functiondef(proc.oid) into old_body,definition from pg_proc proc where proc.oid='public.faolla_attendance_management_insert_v1()'::regprocedure;
 if old_body is distinct from $credentials207_old_4$
declare context jsonb;g public.merchant_attendance_management_delegations%rowtype;stamp timestamptz;
begin
 if tg_table_name='merchant_attendance_management_delegation_operations' then
  if new.delegated_action='audit_export' then perform public.faolla_attendance_management_audit_authority_v1(new);return new;end if;
  if new.delegated_action in('group_save','group_assign','group_end','group_cancel') then perform public.faolla_attendance_delegated_groups_authority_v1(new);return new;end if;
  if new.delegated_action in('worker_save','location_save') then perform public.faolla_attendance_delegated_config_authority_v1(new);return new;end if;
  if new.delegated_action in('rule_draft','rule_publish','rule_withdraw','personal_rule_approve','personal_rule_withdraw','operational_rule_draft','operational_rule_publish','operational_rule_withdraw') then perform public.faolla_attendance_delegated_rules_authority_v1(new);return new;end if;
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
$credentials207_old_4$ or position(old_body in definition)=0 then raise exception 'merchant_attendance_delegated_credentials_forward_drift';end if;
 execute replace(definition,old_body,$credentials207_new_4$
declare context jsonb;g public.merchant_attendance_management_delegations%rowtype;stamp timestamptz;
begin
 if tg_table_name='merchant_attendance_management_delegation_operations' then
  if new.delegated_action='audit_export' then perform public.faolla_attendance_management_audit_authority_v1(new);return new;end if;
  if new.delegated_action in('group_save','group_assign','group_end','group_cancel') then perform public.faolla_attendance_delegated_groups_authority_v1(new);return new;end if;
  if new.delegated_action in('worker_save','location_save') then perform public.faolla_attendance_delegated_config_authority_v1(new);return new;end if;
  if new.delegated_action in('rule_draft','rule_publish','rule_withdraw','personal_rule_approve','personal_rule_withdraw','operational_rule_draft','operational_rule_publish','operational_rule_withdraw') then perform public.faolla_attendance_delegated_rules_authority_v1(new);return new;end if;
  if new.delegated_action in('terminal_prepare','terminal_revoke','pin_issue','pin_revoke') then perform public.faolla_attendance_delegated_credentials_authority_v1(new);return new;end if;
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
$credentials207_new_4$);
 end;$credentials207_forward_4$;
--END GENERATED DELEGATED CREDENTIALS FORWARD
--BEGIN GENERATED DELEGATED CREDENTIALS POSTCONDITIONS
revoke all on function public.faolla_attendance_delegated_credentials_command_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_credentials_hash_v1(text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_credentials_member_material_v1(text,uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_credentials_current_v1(public.merchant_attendance_management_delegations,timestamptz,jsonb,boolean) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_credentials_authorize_v1(text,uuid,uuid,jsonb,boolean,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_credentials_core_authorize_v1(text,uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_credentials_terminal_core_v1(text,uuid,jsonb,jsonb,boolean,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_credentials_member_core_v1(text,uuid,text,uuid,jsonb,boolean,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_credentials_independent_core_v1(text,uuid,jsonb,jsonb,jsonb,boolean,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_credentials_business_v1(text,uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_credentials_proof_v1(public.merchant_attendance_management_delegation_operations,boolean) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_credentials_authority_v1(public.merchant_attendance_management_delegation_operations) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_credentials_receipt_v1(text,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_credentials_issuer_v1(text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_credentials_proof_insert_v1() from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_credentials_pair_v1() from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_credentials_execute_v1(jsonb,uuid,jsonb,boolean,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_terminals_v1(jsonb,uuid,jsonb,boolean,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_delegated_terminals_v1(jsonb,uuid,jsonb,boolean,jsonb) to service_role;
revoke all on function public.faolla_attendance_delegated_pin_v1(jsonb,uuid,jsonb,boolean,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_delegated_pin_v1(jsonb,uuid,jsonb,boolean,jsonb) to service_role;
 do $credentials207_postconditions$ declare ns text;expected_owner oid;installed boolean;has190 boolean;spec jsonb;forward_spec jsonb;own_spec jsonb;f regprocedure;meta record;actual_table regclass;expected_table regclass;foreign_table regclass;table_name text;constraint_spec record;actual_constraint record;index_spec record;actual_index record;trigger_spec jsonb;reference_keys smallint[]; begin select namespace.nspname,catalog_table.relowner into ns,expected_owner from pg_class catalog_table join pg_namespace namespace on namespace.oid=catalog_table.relnamespace where catalog_table.oid='public.merchant_attendance_settings'::regclass;
 if expected_owner is distinct from (select oid from pg_roles where rolname=current_user) then raise exception 'merchant_attendance_delegated_credentials_owner_conflict';end if;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080207 and name='merchant_attendance_delegated_credentials');
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');own_spec:=$credentials207_dependencies$[{"name":"faolla_attendance_terminal_device_v1","signature":"public.faolla_attendance_terminal_device_v1(text,uuid,text,text,boolean)","hash":"268246908e643bebaba3519ae75117ef677d787de57535f571bee8d929ca7e99","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":["p_site","p_id","p_secret_hash","p_device_hash","p_allow_pair"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_independent_guard_v1","signature":"public.faolla_attendance_independent_guard_v1()","hash":"11a8d826bae099d9bcafad651222d8ef126f728670f16fc3143473fc42e40040","result":"trigger","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_independent_clock_receipt_v1","signature":"public.faolla_attendance_independent_clock_receipt_v1(public.merchant_attendance_independent_event_sources)","hash":"2bc9d92fa75ece3a3334ea0b88463945addcf7794b8dc07a7edfce95bec600ec","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_independent_clock_hash_v1","signature":"public.faolla_attendance_independent_clock_hash_v1(text,uuid,jsonb)","hash":"a8a07a7b3153c18e908f00bc101a8f6fd861b362235ad9350f41c8eac03e4e61","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_terminal","p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_hash_v1","signature":"public.faolla_attendance_operational_rule_hash_v1(jsonb)","hash":"fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_independent_clock_command_v1","signature":"public.faolla_attendance_independent_clock_command_v1(jsonb)","hash":"e32cd78012dd50709c4964a340b2d568f96ce2a98445c9cdd8a2ae2a0ee31c37","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_object_v1","signature":"public.faolla_attendance_operational_rule_object_v1(jsonb,text[])","hash":"c2424b9408e816d4f5aee7b271d4e91ea6faf10c7643a940223a1d3896e56ca7","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","ks"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_independent_scalar_v1","signature":"public.faolla_attendance_independent_scalar_v1(jsonb,text)","hash":"a3a0121cbb19210074802f404631eebc48bcaceb2f585c921a94548b9191276d","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","k"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_date_v1","signature":"public.faolla_attendance_group_date_v1(text,text)","hash":"78b42d44e8e4a547db264ec59f7866627284a959b82f0c46f0d646fba5931c8b","result":"boolean","language":"plpgsql","volatility":"s","definer":false,"defaults":1,"defaultExpression":"NULL::text","args":["p","z"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_valid_zone_v1","signature":"public.faolla_attendance_valid_zone_v1(text)","hash":"3681c82259aaf0653bbddf12e3904144a53030f6213b0e96cdf6f8d40702657d","result":"boolean","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_zone"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_scalar_v1","signature":"public.faolla_attendance_operational_rule_scalar_v1(jsonb,text)","hash":"99d575e267fe9ec7b8f56dbe92ac412405913695ae3a3085dc1a035c33614fce","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","k"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_punch_stamp_v1","signature":"public.faolla_attendance_operational_punch_stamp_v1(timestamptz)","hash":"6d0b940b342a28ef5abe117ceb132f80180680cf1a7ac65af88be475f7f879a2","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_independent_admin_hash_v1","signature":"public.faolla_attendance_independent_admin_hash_v1(text,uuid,jsonb)","hash":"654b0148881c9efafdefcaa3ece775fe0a3d1a1e8525eedc23cca2aeeb70efcb","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_auth","p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_independent_command_v1","signature":"public.faolla_attendance_independent_command_v1(jsonb)","hash":"f2e26335f15c0fdcb86e5cb7f5492c9e0f1fdf56dd03c5f60148a80f23b986ca","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_independent_text_v1","signature":"public.faolla_attendance_independent_text_v1(text,integer,integer)","hash":"ac9ef43eae2eb7946af62d07d128732dcd6efbe9baeca956a9cbeabe34daa5c9","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","lo","hi"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_text_v1","signature":"public.faolla_attendance_group_text_v1(text,integer,integer)","hash":"b440810c3afb56de19592e1492e16b12cf6faf800ac2f9d0a8e7bdeca2ecc562","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","lo","hi"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_account_capture_v1","signature":"public.faolla_attendance_account_capture_v1(text,uuid,uuid,uuid,boolean)","hash":"c5ba771116846124af37e113086395bad0787b8daaf6f9e5283273cf82337907","result":"uuid","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_employee","p_actor","p_actor_employee","p_enabled"],"searchPath":"search_path=pg_catalog","isRpc":false,"changes":[{"from":"and not exists(select 1 from public.merchant_attendance_correction_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee)) then return null;end if;","to":"and not exists(select 1 from public.merchant_attendance_correction_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee))\n    and not exists(select 1 from public.merchant_attendance_management_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee)) then return null;end if;","count":2}]},{"name":"faolla_attendance_account_activation_guard_v1","signature":"public.faolla_attendance_account_activation_guard_v1()","hash":"2a4f30a259800b7f0e9fda5104f3f16c94629939c28e486962fced41fea4851a","result":"trigger","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scalar_v1","signature":"public.faolla_attendance_management_scalar_v1(jsonb,text)","hash":"1f1afb8930a212c34937f2cfe8b843e9991d9827440c7589afb93a4f2e62ac06","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","k"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_shift_rule_binding_object_v1","signature":"public.faolla_attendance_shift_rule_binding_object_v1(jsonb,text[])","hash":"2a634d258ceab747cb0098c516aa423babe8d7f0203ce9fb24725bc9602ded50","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","keys"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_current_v1","signature":"public.faolla_attendance_management_current_v1(public.merchant_attendance_management_delegations,timestamptz)","hash":"2148814cd6c45a36a584c6293e8abc8d7db61cdd62d55e06ceadcb0e757b7aa7","result":"boolean","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g","at_time"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scope_context_v1","signature":"public.faolla_attendance_management_scope_context_v1(text,jsonb,text)","hash":"dc5dbf304f62b90e211566ab9ca39a6dbace37341cf06e829f8c478dc681fa8f","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","p","a"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scope_v1","signature":"public.faolla_attendance_management_scope_v1(jsonb,text)","hash":"715c2692e308c9562a54fab06f3ab4f0c888378837e6ffdf40e9531ad40ea16c","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","a"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_capability_v1","signature":"public.faolla_attendance_management_capability_v1(text)","hash":"8442e9811c7795f37e06e22fc84cca3d773cb084b19fc3c9528d3f642b97b990","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_array_v1","signature":"public.faolla_attendance_management_array_v1(jsonb,text[],integer,integer)","hash":"01b5e60f56433b2ec408d82c25bc9aec85187175e52482e33a15162d01cacebf","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","allowed","minimum","maximum"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_binding_v1","signature":"public.faolla_attendance_management_binding_v1(jsonb)","hash":"434f3279e8bd6c90d559db026bdeca2d6092749586bb6271146c23ab826358b0","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_hash_v1","signature":"public.faolla_attendance_management_hash_v1(text,uuid,jsonb)","hash":"0251284215e3c71ba9420c3b7be5cc496699aa5a5cad4a6189da6b9a8361dd84","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_command_v1","signature":"public.faolla_attendance_management_command_v1(jsonb)","hash":"4bfb75e4776588b774e58e64018394a95fb8c802776c3df433dc0259de3a0fd3","result":"void","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_pin_member_v1","signature":"public.faolla_attendance_pin_member_v1(text,text)","hash":"e5a6a21813de4e52ad6824d4821fe30d2a0bea46964648df6958526eeb4330bf","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_no"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_independent_material_hash_v1","signature":"public.faolla_attendance_independent_material_hash_v1(text,uuid,uuid,bigint,bigint,uuid,text,text)","hash":"d63aa1239d9964f16a9315935d486df25fba48bd9d328ef3967ada14cea6d0b3","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_subject","p_generation","p_revision","p_operation","p_salt","p_verifier"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_independent_receipt_v1","signature":"public.faolla_attendance_independent_receipt_v1(public.merchant_attendance_independent_entries)","hash":"882f13eeefc384d03eb3178648f4fa2ab1cd2890b6ed869336b5e9dbbc6df334","result":"jsonb","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_independent_subject_v1","signature":"public.faolla_attendance_independent_subject_v1(public.merchant_attendance_independent_subjects)","hash":"8d52a2ef476f26d901b91a06b300b5a170e62387eaee03281a861c9ede2b4320","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_independent_report_v1","signature":"public.faolla_attendance_independent_report_v1(text,uuid,date,date,uuid)","hash":"973fc3e6a226fb4f14a98097935eb6be8e0e8be52103f75adc5906447f08fbcd","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_subject","p_from","p_through","p_cursor"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_control_day_boundary_v1","signature":"public.faolla_attendance_control_day_boundary_v1(date,text)","hash":"6c1479bd60a7349acc92fe7a2b7552509751e65be5651cc48d102c00834164a8","result":"timestamptz","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_date","p_zone"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_independent_head_v1","signature":"public.faolla_attendance_independent_head_v1(text,uuid,uuid)","hash":"21eb62ecdfc08d4bf553b08aa2e895e85a9fc05c1f59610f3dccb8f72c928621","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_subject"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_independent_boundary_v1","signature":"public.faolla_attendance_independent_boundary_v1(public.merchant_attendance_independent_member_bindings)","hash":"067ecfc192485c414fcf55e9345a0fb9dcf3286f8a0cb5bc7fe2e0921ab48770","result":"jsonb","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false}]$credentials207_dependencies$::jsonb;
 own_spec:=own_spec||jsonb_build_array(case when has190 then $credentials207_catalog190${"name":"faolla_valid_merchant_enterprise_permissions_v1","signature":"public.faolla_valid_merchant_enterprise_permissions_v1(text[])","hash":"3d759540cb9f60753053c3012d4bbbc9d14aed92ad86aa9ba7358a0fc2d89792","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_permissions"],"searchPath":"search_path=pg_catalog, public","isRpc":false,"changes":[{"from":"      ('redemptions.view', array[]::text[]),","to":"      ('attendance.workers.manage', array['enterprise.view']::text[]),\n      ('attendance.groups.manage', array['enterprise.view']::text[]),\n      ('attendance.locations.manage', array['enterprise.view']::text[]),\n      ('attendance.rules.draft', array['enterprise.view']::text[]),\n      ('attendance.rules.publish', array['enterprise.view']::text[]),\n      ('attendance.rules.withdraw', array['enterprise.view']::text[]),\n      ('attendance.terminals.pair', array['enterprise.view']::text[]),\n      ('attendance.terminals.revoke', array['enterprise.view']::text[]),\n      ('attendance.pin.issue', array['enterprise.view']::text[]),\n      ('attendance.pin.revoke', array['enterprise.view']::text[]),\n      ('attendance.correction.revision.review', array['enterprise.view']::text[]),\n      ('attendance.plan_exception.review', array['enterprise.view']::text[]),\n      ('attendance.audit.view', array['enterprise.view']::text[]),\n      ('attendance.audit.export', array['enterprise.view']::text[]),\n      ('redemptions.view', array[]::text[]),","count":1}]}$credentials207_catalog190$::jsonb else $credentials207_catalog185${"name":"faolla_valid_merchant_enterprise_permissions_v1","signature":"public.faolla_valid_merchant_enterprise_permissions_v1(text[])","hash":"876f0456ae5a911a8dd7de7ebed3ab03aa3b9bb4fa347c9adae4261d4d64c48b","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_permissions"],"searchPath":"search_path=pg_catalog, public","isRpc":false,"changes":[{"from":"      ('redemptions.view', array[]::text[]),","to":"      ('attendance.workers.manage', array['enterprise.view']::text[]),\n      ('attendance.groups.manage', array['enterprise.view']::text[]),\n      ('attendance.locations.manage', array['enterprise.view']::text[]),\n      ('attendance.rules.draft', array['enterprise.view']::text[]),\n      ('attendance.rules.publish', array['enterprise.view']::text[]),\n      ('attendance.rules.withdraw', array['enterprise.view']::text[]),\n      ('attendance.terminals.pair', array['enterprise.view']::text[]),\n      ('attendance.terminals.revoke', array['enterprise.view']::text[]),\n      ('attendance.pin.issue', array['enterprise.view']::text[]),\n      ('attendance.pin.revoke', array['enterprise.view']::text[]),\n      ('attendance.correction.revision.review', array['enterprise.view']::text[]),\n      ('attendance.plan_exception.review', array['enterprise.view']::text[]),\n      ('attendance.audit.view', array['enterprise.view']::text[]),\n      ('attendance.audit.export', array['enterprise.view']::text[]),\n      ('redemptions.view', array[]::text[]),","count":1}]}$credentials207_catalog185$::jsonb end);
 own_spec:=own_spec||$credentials207_forwards$[{"name":"faolla_attendance_terminal_admin_v1","signature":"public.faolla_attendance_terminal_admin_v1(text,uuid,jsonb,jsonb,boolean)","hash":"55c20b87de72d6bb5d5ac6465cffa72c7dd1e725cfb34ca871ff8ad5c4703d17","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":["p_site","p_auth","p_query","p_command","p_allow_create"],"searchPath":"search_path=pg_catalog","isRpc":true,"coreArgs":"p_site text,p_auth uuid,p_query jsonb,p_command jsonb,p_allow_create boolean,p_grant_id uuid","oldHash":"55c20b87de72d6bb5d5ac6465cffa72c7dd1e725cfb34ca871ff8ad5c4703d17","newHash":"02f7d6491fc45f3184838208d3301190fdc0e5ce86122b20d143c4431eaf1f85"},{"name":"faolla_attendance_pin_admin_v1","signature":"public.faolla_attendance_pin_admin_v1(text,uuid,text,uuid,jsonb,boolean)","hash":"5576a8f69dbf2af7b3e6171aca170f1109791ea6aa267961e0e3618adaa59bf2","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":["p_site","p_auth","p_no","p_operation","p_command","p_allow_set"],"searchPath":"search_path=pg_catalog","isRpc":true,"coreArgs":"p_site text,p_auth uuid,p_no text,p_operation uuid,p_command jsonb,p_allow_set boolean,p_grant_id uuid","oldHash":"5576a8f69dbf2af7b3e6171aca170f1109791ea6aa267961e0e3618adaa59bf2","newHash":"0001e27faaf9ff6f077a87e86282788fb8c400b8e15aaacaf18348ab94b3fa86"},{"name":"faolla_attendance_independent_admin_v1","signature":"public.faolla_attendance_independent_admin_v1(text,uuid,jsonb,jsonb,jsonb,boolean)","hash":"95f6be0160c2b667dae62536b9c94c0abc4d76edc573c0eb7f747e0042e529bb","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":["p_site","p_auth","p_query","p_command","p_material","p_allow_new"],"searchPath":"search_path=pg_catalog","isRpc":true,"coreArgs":"p_site text,p_auth uuid,p_query jsonb,p_command jsonb,p_material jsonb,p_allow_new boolean,p_grant_id uuid","oldHash":"95f6be0160c2b667dae62536b9c94c0abc4d76edc573c0eb7f747e0042e529bb","newHash":"0de6259d3eaed84ffae30a751e53c0d90300b939450a3c63713a95b3c3979df6"},{"name":"faolla_attendance_terminal_snapshot_v1","signature":"public.faolla_attendance_terminal_snapshot_v1(text,uuid,timestamptz)","hash":"eeffc89f77cba9000046a15c7c95bfade2664c8543b419c77f6d45b53c2d70ac","result":"jsonb","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_id","p_now"],"searchPath":"search_path=pg_catalog","isRpc":false,"oldHash":"eeffc89f77cba9000046a15c7c95bfade2664c8543b419c77f6d45b53c2d70ac","newHash":"7a5620c7281bf0c424270f9f5b2272f7c1a26e0bb15a79a66b6a0228089dc0d8"},{"name":"faolla_attendance_management_insert_v1","signature":"public.faolla_attendance_management_insert_v1()","hash":"37216d21b66510291fb3833781951ffeef20218594879bfcb4729fea7496c4be","result":"trigger","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false,"from":"if tg_table_name='merchant_attendance_management_delegation_operations' then raise exception 'attendance_management_executor_unavailable';end if;","to":"if tg_table_name='merchant_attendance_management_delegation_operations' then\n  if new.delegated_action='audit_export' then perform public.faolla_attendance_management_audit_authority_v1(new);return new;end if;\n  raise exception 'attendance_management_executor_unavailable';\n end if;","oldHash":"37216d21b66510291fb3833781951ffeef20218594879bfcb4729fea7496c4be","newHash":"c46a7ada6f8cbe703bd11496d71d4b97ac2ab7e7bb19152b48c3aa0835c3cc57"}]$credentials207_forwards$::jsonb;
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
 end loop;own_spec:=$credentials207_post_own$[{"name":"faolla_attendance_delegated_credentials_command_v1","signature":"public.faolla_attendance_delegated_credentials_command_v1(jsonb)","hash":"aac1e0b9018a4c67bd4fff88299d74496501c789da0172a50c5364bc2dff53c7","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_hash_v1","signature":"public.faolla_attendance_delegated_credentials_hash_v1(text,uuid,uuid,jsonb)","hash":"acf2b45fb2ad56fc5ef75e46b23cf01ec0421fe83ee62aee1a708f1c9e4e50d5","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_member_material_v1","signature":"public.faolla_attendance_delegated_credentials_member_material_v1(text,uuid,uuid,jsonb,jsonb)","hash":"26cd0bfefddb2e0f238fa5964686fb6bee31e5d8d5c40b07647fb86695f10614","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id","c","material"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_current_v1","signature":"public.faolla_attendance_delegated_credentials_current_v1(public.merchant_attendance_management_delegations,timestamptz,jsonb,boolean)","hash":"d67e38e9f61e12b3e27870e43a190d79e997adede8c1521437ee404b5f9ad524","result":"boolean","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g","stamp","c","postimage"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_authorize_v1","signature":"public.faolla_attendance_delegated_credentials_authorize_v1(text,uuid,uuid,jsonb,boolean,timestamptz)","hash":"57e073f9f664398cb9c4f8cd6761fdba7afbe75abf115084cf27abd5962bf6cf","result":"public.merchant_attendance_management_delegations","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id","c","postimage","stamp"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_core_authorize_v1","signature":"public.faolla_attendance_delegated_credentials_core_authorize_v1(text,uuid,uuid,text,text,jsonb)","hash":"0ca0ed9232db3ea91efb5f9671c5a1c7346bba3ead2929fb5d172f78f087897b","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id","family","target","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_terminal_core_v1","signature":"public.faolla_attendance_delegated_credentials_terminal_core_v1(text,uuid,jsonb,jsonb,boolean,uuid)","hash":"ebc0b55f2234eadeef8540ca26c739be6f31f3af66dd3551de3a6b31d639af86","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_auth","p_query","p_command","p_allow_create","p_grant_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_member_core_v1","signature":"public.faolla_attendance_delegated_credentials_member_core_v1(text,uuid,text,uuid,jsonb,boolean,uuid)","hash":"38b1c18eb0b35977abf17fce8b970158fc66989e0ac0e427a6e41359cfd4c530","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_auth","p_no","p_operation","p_command","p_allow_set","p_grant_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_independent_core_v1","signature":"public.faolla_attendance_delegated_credentials_independent_core_v1(text,uuid,jsonb,jsonb,jsonb,boolean,uuid)","hash":"35105d744200f059536ad2c5158fb013b1845d4c01845a9c33efd5defbc53db7","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_auth","p_query","p_command","p_material","p_allow_new","p_grant_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_business_v1","signature":"public.faolla_attendance_delegated_credentials_business_v1(text,uuid,uuid,jsonb,text)","hash":"be5da7e5a4b6d80bc6648d101281111e4a64475e704202a2ad16bbcb23c8e4fc","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id","c","material_commitment"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_proof_v1","signature":"public.faolla_attendance_delegated_credentials_proof_v1(public.merchant_attendance_management_delegation_operations,boolean)","hash":"28a999ed375687ed6843aa86532a98fdbca22d1e9fe16561625b4b0f25a7125c","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p","require_current"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_authority_v1","signature":"public.faolla_attendance_delegated_credentials_authority_v1(public.merchant_attendance_management_delegation_operations)","hash":"cdcd68af237e8ec08eb0c23c69bc72616ee8c36acea7bf0da6c3e6df182f01a6","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_receipt_v1","signature":"public.faolla_attendance_delegated_credentials_receipt_v1(text,uuid,uuid,uuid)","hash":"629e9c672542b1ba2f682e7e29319a1a219f823511a2666962f8533556d5054b","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","op","actor","id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_issuer_v1","signature":"public.faolla_attendance_delegated_credentials_issuer_v1(text,uuid)","hash":"3de5f75f00be88b3dc40782eb6b52e8d172b38aee10bcc7ebeceee1d86e21b4c","result":"boolean","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","terminal_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_proof_insert_v1","signature":"public.faolla_attendance_delegated_credentials_proof_insert_v1()","hash":"bf4f2a5053da8de20f57a865caf622331b3d9cc8f0cff3775fa14d50a6177a46","result":"trigger","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_pair_v1","signature":"public.faolla_attendance_delegated_credentials_pair_v1()","hash":"c868ecef4df1fd696ec832087edcf98299ecd868391f67b4fb5849adb2cf173b","result":"trigger","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_credentials_execute_v1","signature":"public.faolla_attendance_delegated_credentials_execute_v1(jsonb,uuid,jsonb,boolean,jsonb,text)","hash":"094878226681c563557ed9456d0a8520951b01e2e6cf0d477583e3002af22d13","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id","p_command","p_allow_write","p_material","p_family"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_terminals_v1","signature":"public.faolla_attendance_delegated_terminals_v1(jsonb,uuid,jsonb,boolean,jsonb)","hash":"da9dd36e726766bf3753d1f7fe26606122a03d3b8c3deaa28db412043d5635af","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":3,"defaultExpression":"NULL::jsonb, false, NULL::jsonb","args":["p_query","p_auth_user_id","p_command","p_allow_write","p_material"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_delegated_pin_v1","signature":"public.faolla_attendance_delegated_pin_v1(jsonb,uuid,jsonb,boolean,jsonb)","hash":"383deb86b58a5ae4ff4d14b14337d5be057ef7357936189d3fc3379be3819618","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":3,"defaultExpression":"NULL::jsonb, false, NULL::jsonb","args":["p_query","p_auth_user_id","p_command","p_allow_write","p_material"],"searchPath":"search_path=pg_catalog","isRpc":true}]$credentials207_post_own$::jsonb;for spec in select value from jsonb_array_elements(own_spec) loop
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
 end loop;foreach table_name in array array['merchant_attendance_terminals','merchant_attendance_terminal_audit','merchant_attendance_pin_credentials','merchant_attendance_pin_audit','merchant_attendance_pin_attempts','merchant_attendance_independent_subjects','merchant_attendance_independent_entries','merchant_attendance_independent_credentials','merchant_attendance_independent_leases','merchant_attendance_independent_event_sources','merchant_attendance_independent_member_bindings','merchant_attendance_management_delegations','merchant_attendance_management_delegation_revocations','merchant_attendance_management_delegation_operations','merchant_attendance_delegated_credential_proofs'] loop
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
    or pg_get_expr(actual_default.adbin,actual_table) is distinct from pg_get_expr(expected_default.adbin,expected_table))) then raise exception 'merchant_attendance_delegated_credentials_table_conflict';end if;
 if (select count(*) from pg_constraint where conrelid=actual_table and contype<>'t')<>(select count(*) from pg_constraint where conrelid=expected_table and contype<>'t') then raise exception 'merchant_attendance_delegated_credentials_constraint_conflict';end if;
 for constraint_spec in select * from pg_constraint where conrelid=expected_table and contype<>'t' loop
  select * into actual_constraint from pg_constraint where conrelid=actual_table and conname=constraint_spec.conname;
  foreign_table:=case when constraint_spec.contype='f' then to_regclass(ns||'.'||(select relname from pg_class where oid=constraint_spec.confrelid)) else 0::oid end;
  select array_agg(actual_ref.attnum::smallint order by requested.ord) into reference_keys from unnest(constraint_spec.confkey) with ordinality requested(attnum,ord)
   join pg_attribute expected_ref on expected_ref.attrelid=constraint_spec.confrelid and expected_ref.attnum=requested.attnum
   join pg_attribute actual_ref on actual_ref.attrelid=foreign_table and actual_ref.attname=expected_ref.attname;
  if actual_constraint.oid is null or row(actual_constraint.contype,actual_constraint.conkey,actual_constraint.confkey,actual_constraint.confrelid,actual_constraint.condeferrable,actual_constraint.condeferred,actual_constraint.convalidated,actual_constraint.confupdtype,actual_constraint.confdeltype,actual_constraint.confmatchtype,actual_constraint.connoinherit,actual_constraint.conislocal,actual_constraint.coninhcount)
   is distinct from row(constraint_spec.contype,constraint_spec.conkey,reference_keys,foreign_table::oid,constraint_spec.condeferrable,constraint_spec.condeferred,true,constraint_spec.confupdtype,constraint_spec.confdeltype,constraint_spec.confmatchtype,constraint_spec.connoinherit,true,0)
   or pg_get_expr(actual_constraint.conbin,actual_table) is distinct from pg_get_expr(constraint_spec.conbin,expected_table) then raise exception 'merchant_attendance_delegated_credentials_constraint_conflict';end if;
 end loop;
 if (select count(*) from pg_index where indrelid=actual_table)<>(select count(*) from pg_index where indrelid=expected_table) then raise exception 'merchant_attendance_delegated_credentials_index_conflict';end if;
 for index_spec in select index_row.*,index_table.relname,index_table.relam from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indrelid=expected_table loop
  select index_row.*,index_table.relowner,index_table.relam,index_table.relkind into actual_index from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indexrelid=to_regclass(ns||'.'||index_spec.relname);
  if actual_index.indexrelid is null or actual_index.indrelid<>actual_table or actual_index.relowner<>expected_owner or actual_index.relkind<>'i' or not actual_index.indisvalid or not actual_index.indisready or not actual_index.indislive
   or row(actual_index.relam,actual_index.indnatts,actual_index.indnkeyatts,actual_index.indisunique,actual_index.indisprimary,actual_index.indisexclusion,actual_index.indimmediate,actual_index.indnullsnotdistinct,actual_index.indkey,actual_index.indcollation,actual_index.indclass,actual_index.indoption)
   is distinct from row(index_spec.relam,index_spec.indnatts,index_spec.indnkeyatts,index_spec.indisunique,index_spec.indisprimary,index_spec.indisexclusion,index_spec.indimmediate,index_spec.indnullsnotdistinct,index_spec.indkey,index_spec.indcollation,index_spec.indclass,index_spec.indoption)
   or pg_get_expr(actual_index.indpred,actual_table) is distinct from pg_get_expr(index_spec.indpred,expected_table) or pg_get_expr(actual_index.indexprs,actual_table) is distinct from pg_get_expr(index_spec.indexprs,expected_table) then raise exception 'merchant_attendance_delegated_credentials_index_conflict';end if;
 end loop;

 if (select count(*) from pg_trigger actual where actual.tgrelid=actual_table and not actual.tgisinternal)<>(select count(*) from jsonb_array_elements($credentials207_triggers$[{"table":"merchant_attendance_terminal_audit","name":"merchant_attendance_terminal_audit_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_terminal_audit","name":"merchant_attendance_terminal_audit_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_pin_credentials","name":"attendance_account_activation_guard","type":23,"fn":"faolla_attendance_account_activation_guard_v1","deferred":false},{"table":"merchant_attendance_pin_audit","name":"attendance_pin_audit_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_pin_audit","name":"attendance_pin_audit_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_independent_entries","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_entries","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_event_sources","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_event_sources","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_member_bindings","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_member_bindings","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_insert","type":7,"fn":"faolla_attendance_delegated_credentials_proof_insert_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_pair","type":5,"fn":"faolla_attendance_delegated_credentials_pair_v1","deferred":true}]$credentials207_triggers$::jsonb) expected where expected->>'table'=table_name) then
  raise exception 'merchant_attendance_delegated_credentials_trigger_conflict' using detail=(select jsonb_build_object(
   'table',table_name,'actualCount',(select count(*) from pg_trigger actual where actual.tgrelid=actual_table and not actual.tgisinternal),
   'expectedCount',(select count(*) from jsonb_array_elements($credentials207_triggers$[{"table":"merchant_attendance_terminal_audit","name":"merchant_attendance_terminal_audit_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_terminal_audit","name":"merchant_attendance_terminal_audit_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_pin_credentials","name":"attendance_account_activation_guard","type":23,"fn":"faolla_attendance_account_activation_guard_v1","deferred":false},{"table":"merchant_attendance_pin_audit","name":"attendance_pin_audit_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_pin_audit","name":"attendance_pin_audit_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_independent_entries","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_entries","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_event_sources","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_event_sources","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_member_bindings","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_member_bindings","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_insert","type":7,"fn":"faolla_attendance_delegated_credentials_proof_insert_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_pair","type":5,"fn":"faolla_attendance_delegated_credentials_pair_v1","deferred":true}]$credentials207_triggers$::jsonb) expected where expected->>'table'=table_name),
   'triggers',coalesce((select jsonb_agg(jsonb_build_object('name',limited.tgname,'function',limited.function_identity) order by limited.tgname,limited.oid)
    from(select actual.oid,actual.tgname,left(actual.tgfoid::regprocedure::text,180) function_identity from pg_trigger actual
     where actual.tgrelid=actual_table and not actual.tgisinternal order by actual.tgname,actual.oid limit 8) limited),'[]'::jsonb)))::text;
 end if;
 for trigger_spec in select value from jsonb_array_elements($credentials207_triggers$[{"table":"merchant_attendance_terminal_audit","name":"merchant_attendance_terminal_audit_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_terminal_audit","name":"merchant_attendance_terminal_audit_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_pin_credentials","name":"attendance_account_activation_guard","type":23,"fn":"faolla_attendance_account_activation_guard_v1","deferred":false},{"table":"merchant_attendance_pin_audit","name":"attendance_pin_audit_no_rewrite","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_pin_audit","name":"attendance_pin_audit_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_independent_entries","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_entries","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_event_sources","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_event_sources","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_member_bindings","name":"independent_immutable","type":31,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_independent_member_bindings","name":"independent_no_truncate","type":34,"fn":"faolla_attendance_independent_guard_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_revocations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_management_delegation_operations","name":"management_insert_guard","type":7,"fn":"faolla_attendance_management_insert_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_insert","type":7,"fn":"faolla_attendance_delegated_credentials_proof_insert_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_immutable","type":27,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_no_truncate","type":34,"fn":"faolla_attendance_events_append_only_v1","deferred":false},{"table":"merchant_attendance_delegated_credential_proofs","name":"credentials207_proof_pair","type":5,"fn":"faolla_attendance_delegated_credentials_pair_v1","deferred":true}]$credentials207_triggers$::jsonb) where value->>'table'=table_name loop
  if not exists(select 1 from pg_trigger actual where actual.tgrelid=actual_table and actual.tgname=(trigger_spec->>'name')::name and actual.tgtype=(trigger_spec->>'type')::integer
   and actual.tgfoid=to_regprocedure(ns||'.'||(trigger_spec->>'fn')||'()') and actual.tgenabled='O' and actual.tgnargs=0 and actual.tgqual is null and actual.tgparentid=0
   and actual.tgdeferrable=(trigger_spec->>'deferred')::boolean and actual.tginitdeferred=(trigger_spec->>'deferred')::boolean) then raise exception 'merchant_attendance_delegated_credentials_trigger_conflict';end if;
 end loop;
end loop;
 if (select count(*) from credentials207_forward_metadata)<>5 or exists(select 1 from credentials207_forward_metadata original left join pg_proc proc on proc.oid=original.oid where proc.oid is null or to_jsonb(proc)-array['prosrc','proargdefaults'] is distinct from original.metadata or pg_get_expr(proc.proargdefaults,0) is distinct from original.default_expression) then raise exception 'merchant_attendance_delegated_credentials_forward_metadata_changed';end if;
 end;$credentials207_postconditions$;
 drop table pg_temp.credentials207_forward_metadata,pg_temp.merchant_attendance_delegated_credential_proofs,pg_temp.merchant_attendance_management_delegation_operations,pg_temp.merchant_attendance_management_delegation_revocations,pg_temp.merchant_attendance_management_delegations,pg_temp.merchant_attendance_independent_member_bindings,pg_temp.merchant_attendance_independent_event_sources,pg_temp.merchant_attendance_independent_leases,pg_temp.merchant_attendance_independent_credentials,pg_temp.merchant_attendance_independent_entries,pg_temp.merchant_attendance_independent_subjects,pg_temp.merchant_attendance_pin_attempts,pg_temp.merchant_attendance_pin_audit,pg_temp.merchant_attendance_pin_credentials,pg_temp.merchant_attendance_terminal_audit,pg_temp.merchant_attendance_terminals,pg_temp.merchant_attendance_events,pg_temp.merchant_enterprise_employees,pg_temp.merchant_attendance_workers,pg_temp.merchant_attendance_locations,pg_temp.merchant_attendance_settings;
--END GENERATED DELEGATED CREDENTIALS POSTCONDITIONS
insert into public.faolla_schema_migrations(version,name) values(202610080207,'merchant_attendance_delegated_credentials') on conflict(version) do nothing;
commit;
