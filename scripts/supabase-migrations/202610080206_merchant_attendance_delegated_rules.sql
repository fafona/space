--206 local candidate: eight scoped rule actions, not a general administrator.
--No new persistent table/index; immutable actual-actor proof uses202 sidecars.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
--BEGIN GENERATED DELEGATED RULES PREFLIGHT
do $rules206_prerequisites$ begin
 if not exists(select 1 from public.faolla_schema_migrations where version=202610080205 and name='merchant_attendance_delegated_configuration') then raise exception 'merchant_attendance_delegated_rules_prerequisite_required';end if;
 if exists(select 1 from public.faolla_schema_migrations where version=202610080206 and name<>'merchant_attendance_delegated_rules') then raise exception 'merchant_attendance_delegated_rules_installation_conflict';end if;
 end;$rules206_prerequisites$;
 create temp table merchant_attendance_settings(merchant_id text primary key) on commit drop;
create temp table merchant_attendance_groups(merchant_id text,group_id uuid,primary key(merchant_id,group_id)) on commit drop;
create temp table merchant_attendance_workers(id uuid,merchant_id text,primary key(merchant_id,id)) on commit drop;
create temp table merchant_enterprise_employees(id uuid,merchant_id text,primary key(merchant_id,id)) on commit drop;
create temp table merchant_attendance_rule_streams (
  merchant_id text not null references pg_temp.merchant_attendance_settings(merchant_id),stream_key text not null,group_id uuid null,
  revision bigint not null check(revision between 1 and 9007199254740990),draft_revision bigint null,
  draft_action text not null default 'save_draft' check(draft_action='save_draft'),
  created_at timestamptz not null,updated_at timestamptz not null,
  primary key(merchant_id,stream_key),foreign key(merchant_id,group_id) references pg_temp.merchant_attendance_groups(merchant_id,group_id),
  check(stream_key=coalesce(group_id::text,'enterprise')),check(draft_revision is null or draft_revision between 1 and revision),
  check(isfinite(created_at) and isfinite(updated_at) and updated_at>=created_at)
) on commit drop;
create temp table merchant_attendance_rule_operations (
  merchant_id text not null,stream_key text not null,operation_id uuid not null,revision bigint not null check(revision between 1 and 9007199254740990),
  action text not null check(action in('save_draft','publish','withdraw')),actor_auth_user_id uuid not null,command jsonb not null,snapshot jsonb not null,
  recorded_at timestamptz not null check(isfinite(recorded_at)),settings_version bigint null,group_revision bigint null,time_zone text null,rules jsonb null,
  effective_on date null,effective_at timestamptz null,published_revision bigint null,source_draft_revision bigint null,draft_revision_after bigint null,
  draft_action text not null default 'save_draft' check(draft_action='save_draft'),published_action text not null default 'publish' check(published_action='publish'),
  primary key(merchant_id,operation_id),unique(merchant_id,stream_key,revision),unique(merchant_id,stream_key,revision,action),
  foreign key(merchant_id,stream_key) references pg_temp.merchant_attendance_rule_streams(merchant_id,stream_key),
  foreign key(merchant_id,stream_key,source_draft_revision,draft_action) references pg_temp.merchant_attendance_rule_operations(merchant_id,stream_key,revision,action),
  foreign key(merchant_id,stream_key,published_revision,published_action) references pg_temp.merchant_attendance_rule_operations(merchant_id,stream_key,revision,action),
  foreign key(merchant_id,stream_key,draft_revision_after,draft_action) references pg_temp.merchant_attendance_rule_operations(merchant_id,stream_key,revision,action) deferrable initially deferred,
  check(public.faolla_attendance_rule_command_v1(command)),check(jsonb_typeof(snapshot)='object'),
  check(command->>'operationId'=operation_id::text and command->>'action'=action and (command->>'expectedRevision')::bigint=revision-1),
  check(group_revision is null or group_revision between 1 and 9007199254740990),
  check((action in('save_draft','publish') and settings_version between 1 and 9007199254740990 and settings_version is not null
      and time_zone is not null and public.faolla_attendance_valid_zone_v1(time_zone) and rules is not null and public.faolla_attendance_rule_values_v1(rules)
      and ((stream_key='enterprise' and group_revision is null) or (stream_key<>'enterprise' and group_revision is not null)) and published_revision is null)
    or (action='withdraw' and settings_version is null and group_revision is null and time_zone is null and rules is null and published_revision is not null and published_revision<revision)),
  check((action='publish' and effective_on is not null and effective_on between date '2000-01-01' and date '2100-12-31'
      and effective_at is not null and isfinite(effective_at) and effective_at>recorded_at and source_draft_revision is not null and source_draft_revision<revision and draft_revision_after is null)
    or (action<>'publish' and effective_on is null and effective_at is null and source_draft_revision is null)),
  check(action<>'save_draft' or draft_revision_after is not null and draft_revision_after=revision),
  check(draft_revision_after is null or draft_revision_after between 1 and revision),check(revision<>1 or action='save_draft')
) on commit drop;
create temp table merchant_attendance_personal_rule_streams (
  merchant_id text not null references pg_temp.merchant_attendance_settings(merchant_id),worker_id uuid not null,
  employee_id uuid not null,employee_auth_user_id uuid not null,revision bigint not null check(revision between 1 and 9007199254740990),
  created_at timestamptz not null,updated_at timestamptz not null,
  primary key(merchant_id,worker_id),unique(merchant_id,worker_id,employee_id,employee_auth_user_id),
  foreign key(merchant_id,worker_id) references pg_temp.merchant_attendance_workers(merchant_id,id),
  foreign key(merchant_id,employee_id) references pg_temp.merchant_enterprise_employees(merchant_id,id),
  check(isfinite(created_at) and isfinite(updated_at) and updated_at>=created_at)
) on commit drop;
create temp table merchant_attendance_personal_rule_operations (
  merchant_id text not null,worker_id uuid not null,operation_id uuid not null,revision bigint not null check(revision between 1 and 9007199254740990),
  action text not null check(action in('approve','withdraw')),actor_auth_user_id uuid not null,command jsonb not null,snapshot jsonb not null,
  recorded_at timestamptz not null,employee_id uuid not null,employee_auth_user_id uuid not null,
  worker_version bigint not null check(worker_version between 1 and 9007199254740990),settings_version bigint not null check(settings_version between 1 and 9007199254740990),
  time_zone text not null check(public.faolla_attendance_valid_zone_v1(time_zone)),starts_on date not null,ends_on date not null,
  from_at timestamptz not null,to_at timestamptz not null,rules jsonb not null,approved_revision bigint null,
  approved_action text not null default 'approve' check(approved_action='approve'),
  primary key(merchant_id,operation_id),unique(merchant_id,worker_id,revision),unique(merchant_id,worker_id,revision,action),
  foreign key(merchant_id,worker_id,employee_id,employee_auth_user_id)
    references pg_temp.merchant_attendance_personal_rule_streams(merchant_id,worker_id,employee_id,employee_auth_user_id),
  foreign key(merchant_id,worker_id,approved_revision,approved_action)
    references pg_temp.merchant_attendance_personal_rule_operations(merchant_id,worker_id,revision,action),
  check(public.faolla_attendance_personal_rule_command_v1(command)),check(jsonb_typeof(snapshot)='object'),
  check(command->>'operationId'=operation_id::text and command->>'action'=action and (command->>'expectedRevision')::bigint=revision-1),
  check(starts_on between date '2000-01-01' and date '2100-12-31' and ends_on between starts_on and date '2100-12-31' and ends_on-starts_on<=30),
  check(isfinite(recorded_at) and isfinite(from_at) and isfinite(to_at) and to_at>from_at and recorded_at<from_at),
  check(public.faolla_attendance_rule_values_v1(rules)),
  check((action='approve' and approved_revision is null) or (action='withdraw' and approved_revision is not null and approved_revision between 1 and revision-1)),
  check(revision<>1 or action='approve')
) on commit drop;
create temp table merchant_attendance_operational_rule_streams (
 merchant_id text not null references pg_temp.merchant_attendance_settings(merchant_id),stream_key text not null,scope jsonb not null,
 revision bigint not null check(revision between 1 and 9007199254740990),draft_revision bigint null,
 created_at timestamptz not null,updated_at timestamptz not null,
 primary key(merchant_id,stream_key),
 check(stream_key=public.faolla_attendance_operational_rule_scope_v1(scope)::text),
 check(draft_revision is null or draft_revision between 1 and revision),
 check(isfinite(created_at) and isfinite(updated_at) and updated_at>=created_at)
) on commit drop;
create temp table merchant_attendance_operational_rule_operations (
 merchant_id text not null,stream_key text not null,operation_id uuid not null,revision bigint not null check(revision between 1 and 9007199254740990),
 scope jsonb not null,actor_auth_user_id uuid not null,action text not null check(action in('save_draft','publish','withdraw')),
 command jsonb not null,command_fingerprint text not null check(command_fingerprint~'^[0-9a-f]{64}$'),item jsonb not null,
 draft_revision_after bigint null,recorded_at timestamptz not null check(isfinite(recorded_at)),
 primary key(merchant_id,operation_id),unique(merchant_id,stream_key,revision),
 foreign key(merchant_id,stream_key) references pg_temp.merchant_attendance_operational_rule_streams(merchant_id,stream_key) deferrable initially deferred,
 check(stream_key=public.faolla_attendance_operational_rule_scope_v1(scope)::text),
 check(public.faolla_attendance_operational_rule_command_v1(command) is not null),
 check(command->>'siteId'=merchant_id and command->'scope'=scope and command->>'operationId'=operation_id::text and command->>'action'=action and (command->>'expectedRevision')::bigint=revision-1),
 check(draft_revision_after is null or draft_revision_after between 1 and revision),
 check((action='save_draft' and draft_revision_after=revision) or action='publish' and draft_revision_after is null or action='withdraw'),
 check(revision<>1 or action='save_draft')
) on commit drop;
create temp table merchant_attendance_operational_rule_publications (
 merchant_id text not null,stream_key text not null,published_revision bigint not null,operation_id uuid not null,
 effective_at timestamptz not null,ends_at timestamptz null,withdrawn_revision bigint null,
 primary key(merchant_id,stream_key,published_revision),unique(merchant_id,operation_id),
 foreign key(merchant_id,stream_key,published_revision) references pg_temp.merchant_attendance_operational_rule_operations(merchant_id,stream_key,revision) deferrable initially deferred,
 foreign key(merchant_id,operation_id) references pg_temp.merchant_attendance_operational_rule_operations(merchant_id,operation_id) deferrable initially deferred,
 foreign key(merchant_id,stream_key,withdrawn_revision) references pg_temp.merchant_attendance_operational_rule_operations(merchant_id,stream_key,revision) deferrable initially deferred,
 check(isfinite(effective_at) and (ends_at is null or isfinite(ends_at) and ends_at>effective_at)),
 check(withdrawn_revision is null or withdrawn_revision>published_revision)
) on commit drop;
create index attendance_rule_operations_history_idx on pg_temp.merchant_attendance_rule_operations(merchant_id,stream_key,revision desc);
create index attendance_rule_publications_idx on pg_temp.merchant_attendance_rule_operations(merchant_id,stream_key,effective_at desc) where action='publish';
create unique index attendance_rule_withdrawals_idx on pg_temp.merchant_attendance_rule_operations(merchant_id,stream_key,published_revision) where action='withdraw';
create index attendance_personal_rule_history_idx on pg_temp.merchant_attendance_personal_rule_operations(merchant_id,worker_id,revision desc);
create index attendance_personal_rule_interval_idx on pg_temp.merchant_attendance_personal_rule_operations(merchant_id,worker_id,from_at,to_at) where action='approve';
create unique index attendance_personal_rule_withdrawals_idx on pg_temp.merchant_attendance_personal_rule_operations(merchant_id,worker_id,approved_revision) where action='withdraw';
create index attendance_operational_rule_effective_idx on pg_temp.merchant_attendance_operational_rule_publications(merchant_id,stream_key,effective_at desc,published_revision desc) where withdrawn_revision is null;
create unique index attendance_operational_rule_unique_time_idx on pg_temp.merchant_attendance_operational_rule_publications(merchant_id,stream_key,effective_at) where withdrawn_revision is null;
create index attendance_operational_rule_personal_catalog_idx on pg_temp.merchant_attendance_operational_rule_streams(merchant_id,(scope->>'kind'),stream_key collate "C");
alter table pg_temp.merchant_attendance_rule_streams add constraint attendance_rule_head_receipt_fk foreign key(merchant_id,stream_key,revision)
      references pg_temp.merchant_attendance_rule_operations(merchant_id,stream_key,revision) deferrable initially deferred;
alter table pg_temp.merchant_attendance_rule_streams add constraint attendance_rule_draft_receipt_fk foreign key(merchant_id,stream_key,draft_revision,draft_action)
      references pg_temp.merchant_attendance_rule_operations(merchant_id,stream_key,revision,action) deferrable initially deferred;
alter table pg_temp.merchant_attendance_personal_rule_streams add constraint attendance_personal_rule_head_receipt_fk foreign key(merchant_id,worker_id,revision)
      references pg_temp.merchant_attendance_personal_rule_operations(merchant_id,worker_id,revision) deferrable initially deferred;
 create temp table rules206_forward_metadata on commit drop as select proc.oid,to_jsonb(proc)-array['prosrc','proargdefaults'] metadata,pg_get_expr(proc.proargdefaults,0) default_expression from pg_proc proc where proc.oid in('public.faolla_attendance_rules_v1(jsonb,uuid,jsonb,boolean)'::regprocedure,'public.faolla_attendance_personal_rules_v1(jsonb,uuid,jsonb,boolean)'::regprocedure,'public.faolla_attendance_operational_rules_v1(jsonb,uuid,jsonb,boolean)'::regprocedure,'public.faolla_attendance_management_insert_v1()'::regprocedure);
 do $rules206_preflight$ declare ns text;expected_owner oid;installed boolean;has190 boolean;spec jsonb;forward_spec jsonb;own_spec jsonb;f regprocedure;meta record;actual_table regclass;expected_table regclass;foreign_table regclass;table_name text;constraint_spec record;actual_constraint record;index_spec record;actual_index record;trigger_spec record;reference_keys smallint[]; begin select namespace.nspname,catalog_table.relowner into ns,expected_owner from pg_class catalog_table join pg_namespace namespace on namespace.oid=catalog_table.relnamespace where catalog_table.oid='public.merchant_attendance_settings'::regclass;
 if expected_owner is distinct from (select oid from pg_roles where rolname=current_user) then raise exception 'merchant_attendance_delegated_rules_owner_conflict';end if;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080206 and name='merchant_attendance_delegated_rules');
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');own_spec:=$rules206_dependencies$[{"name":"faolla_attendance_rule_values_v1","signature":"public.faolla_attendance_rule_values_v1(jsonb)","hash":"28d5094d4449869591c121c3780626220a7be7606cd02800b5d233378f8fb26b","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_rule_day_start_v1","signature":"public.faolla_attendance_rule_day_start_v1(text,text)","hash":"5aa3bbe223feed69419c53e22f1d77783b45f8bcae461c3d7d20d340a01faaf1","result":"timestamptz","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p","z"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_rule_command_v1","signature":"public.faolla_attendance_rule_command_v1(jsonb)","hash":"4e5bd54a168a51d660ce6365feee7ba994f9109e277f9b1532d1c5ae0bab5db6","result":"boolean","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_rule_item_v1","signature":"public.faolla_attendance_rule_item_v1(public.merchant_attendance_rule_operations)","hash":"09ac740476c817095c683248ee53e0c88de038b1350545985a6b61aa84b101f0","result":"jsonb","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_rule_receipt_v1","signature":"public.faolla_attendance_rule_receipt_v1(public.merchant_attendance_rule_operations)","hash":"26a72d561dff1ddd6dd88e1a5979b6005825e915d8ddbabc195589497f4f822e","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_rule_stream_checked_v1","signature":"public.faolla_attendance_rule_stream_checked_v1(public.merchant_attendance_rule_streams)","hash":"fbf190acb1b3816a37a1717fe681f02508d84fe829ef3003b9739baf15d9230a","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_personal_rule_end_v1","signature":"public.faolla_attendance_personal_rule_end_v1(text,text)","hash":"db3c640e28878a9ac45f16e0af49df6bd0549169f7af6f5b317159d553f8bd25","result":"timestamptz","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p","z"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_personal_rule_command_v1","signature":"public.faolla_attendance_personal_rule_command_v1(jsonb)","hash":"3dd5dad6a4aa3e796949e80b63f69eb743b1fc6aa695fc9b72ec43ba3e46b578","result":"boolean","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_personal_rule_item_v1","signature":"public.faolla_attendance_personal_rule_item_v1(public.merchant_attendance_personal_rule_operations)","hash":"f69ab41588a105384e01592649b78d261953b857ae4d493a3b3e8bbc6d175647","result":"jsonb","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_personal_rule_receipt_v1","signature":"public.faolla_attendance_personal_rule_receipt_v1(public.merchant_attendance_personal_rule_operations)","hash":"ee6db3bc3016929898335d0c839d9b31f3ba142b6a10aecbb0723e6a1ea95278","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_personal_rule_stream_checked_v1","signature":"public.faolla_attendance_personal_rule_stream_checked_v1(public.merchant_attendance_personal_rule_streams)","hash":"985bfa7add5e33fc6048c4f59f81f561bddcc93ed976dfcb6ea2c4f74dedb4ca","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_object_v1","signature":"public.faolla_attendance_operational_rule_object_v1(jsonb,text[])","hash":"c2424b9408e816d4f5aee7b271d4e91ea6faf10c7643a940223a1d3896e56ca7","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","ks"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_scalar_v1","signature":"public.faolla_attendance_operational_rule_scalar_v1(jsonb,text)","hash":"99d575e267fe9ec7b8f56dbe92ac412405913695ae3a3085dc1a035c33614fce","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","k"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_scope_v1","signature":"public.faolla_attendance_operational_rule_scope_v1(jsonb)","hash":"9e323d5672d38255e4f92bc2b0d5f0dd4e6190cbe04b7773bc80e40618f57275","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_context_tuple_v1","signature":"public.faolla_attendance_operational_rule_context_tuple_v1(jsonb,jsonb)","hash":"e0bc60a2402351503edb4ea94cd1791b95644c3f098af0aaefeac253c8264179","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p","s"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_values_v1","signature":"public.faolla_attendance_operational_rule_values_v1(jsonb)","hash":"ff59e8fceee61f8a60694614de50200e48f3e51ffb3d355e73d8f18f22af012b","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_command_v1","signature":"public.faolla_attendance_operational_rule_command_v1(jsonb)","hash":"ba2f97fd74fac4343a513b6edf5c9faa34f44c89108908e7e411759b4fa6b5f1","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_hash_v1","signature":"public.faolla_attendance_operational_rule_hash_v1(jsonb)","hash":"fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_context_v1","signature":"public.faolla_attendance_operational_rule_context_v1(text,jsonb)","hash":"0ffee88bfc9457553cdf5c17caeac906833d5fba986275facd2bb38fcedfdee3","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_scope"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_references_v1","signature":"public.faolla_attendance_operational_rule_references_v1(text,jsonb,jsonb,jsonb)","hash":"68ca4f0221d201560dde8ec88f9552e1423364dfdf717cfb1a9ea09882237dd5","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_scope","p_rules","p_subject"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_references_tuple_v1","signature":"public.faolla_attendance_operational_rule_references_tuple_v1(jsonb,jsonb,jsonb)","hash":"642dd54d586411b6ac0aa435ad0ad53630eb2a5ed7a74d0559248bf942795a26","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p","s","r"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_item_v1","signature":"public.faolla_attendance_operational_rule_item_v1(public.merchant_attendance_operational_rule_operations)","hash":"6fbb4c8e283366e526e208fae0b53dc41110161bdfd99e0af196a050c2448396","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_receipt_v1","signature":"public.faolla_attendance_operational_rule_receipt_v1(public.merchant_attendance_operational_rule_operations)","hash":"1e37a768f3b5e265dc195ea509c3395e00825495265c433a241b1be1203d5669","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_preview_v1","signature":"public.faolla_attendance_operational_rule_preview_v1(text,jsonb,bigint,jsonb,text,text)","hash":"073fd2f8d00e73d2685a4cd521ff3f429d7ba0b91414289f1a405c7d9e310535","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_scope","p_head","p_draft","p_day","p_end"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_check_v1","signature":"public.faolla_attendance_operational_rule_check_v1(text,text,bigint)","hash":"25809b0d345f18bc1558029cf1a1063285744d7b89d76b3e34462231542d7fc8","result":"void","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_key","p_revision"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_guard_v1","signature":"public.faolla_attendance_operational_rule_guard_v1()","hash":"5d10e43cc5b6e25a9d1872f4084389e32e831c664e08ef479d912ea9fcc36535","result":"trigger","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scalar_v1","signature":"public.faolla_attendance_management_scalar_v1(jsonb,text)","hash":"1f1afb8930a212c34937f2cfe8b843e9991d9827440c7589afb93a4f2e62ac06","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","k"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_array_v1","signature":"public.faolla_attendance_management_array_v1(jsonb,text[],integer,integer)","hash":"01b5e60f56433b2ec408d82c25bc9aec85187175e52482e33a15162d01cacebf","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","allowed","minimum","maximum"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_capability_v1","signature":"public.faolla_attendance_management_capability_v1(text)","hash":"8442e9811c7795f37e06e22fc84cca3d773cb084b19fc3c9528d3f642b97b990","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_binding_v1","signature":"public.faolla_attendance_management_binding_v1(jsonb)","hash":"434f3279e8bd6c90d559db026bdeca2d6092749586bb6271146c23ab826358b0","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scope_v1","signature":"public.faolla_attendance_management_scope_v1(jsonb,text)","hash":"715c2692e308c9562a54fab06f3ab4f0c888378837e6ffdf40e9531ad40ea16c","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","a"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_command_v1","signature":"public.faolla_attendance_management_command_v1(jsonb)","hash":"4bfb75e4776588b774e58e64018394a95fb8c802776c3df433dc0259de3a0fd3","result":"void","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_hash_v1","signature":"public.faolla_attendance_management_hash_v1(text,uuid,jsonb)","hash":"0251284215e3c71ba9420c3b7be5cc496699aa5a5cad4a6189da6b9a8361dd84","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scope_context_v1","signature":"public.faolla_attendance_management_scope_context_v1(text,jsonb,text)","hash":"dc5dbf304f62b90e211566ab9ca39a6dbace37341cf06e829f8c478dc681fa8f","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","p","a"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_current_v1","signature":"public.faolla_attendance_management_current_v1(public.merchant_attendance_management_delegations,timestamptz)","hash":"2148814cd6c45a36a584c6293e8abc8d7db61cdd62d55e06ceadcb0e757b7aa7","result":"boolean","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g","at_time"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_receipt_v1","signature":"public.faolla_attendance_management_receipt_v1(text,uuid,uuid)","hash":"e2fc56f00392cc2cd5e50c7208e9cdca9e75dde7ae49e3d0c1534a0d24a8958d","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","op","actor"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_grant_v1","signature":"public.faolla_attendance_management_grant_v1(public.merchant_attendance_management_delegations,timestamptz)","hash":"6dcd10acdf0b20a3184432fd943d702c75be56d37cf78c731b9f1f819e577358","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g","at_time"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_delegations_v1","signature":"public.faolla_attendance_management_delegations_v1(jsonb,uuid,jsonb,boolean)","hash":"0f8acf4b919f1f77d0f82a267705ace9490d8e5cbe349b04e99f64893968a513","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_grant"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_group_text_v1","signature":"public.faolla_attendance_group_text_v1(text,integer,integer)","hash":"b440810c3afb56de19592e1492e16b12cf6faf800ac2f9d0a8e7bdeca2ecc562","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","lo","hi"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_date_v1","signature":"public.faolla_attendance_group_date_v1(text,text)","hash":"78b42d44e8e4a547db264ec59f7866627284a959b82f0c46f0d646fba5931c8b","result":"boolean","language":"plpgsql","volatility":"s","definer":false,"defaults":1,"defaultExpression":"NULL::text","args":["p","z"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_checked_v1","signature":"public.faolla_attendance_group_checked_v1(public.merchant_attendance_groups)","hash":"045838f03a886a8d133419c37148a0c747b58d2a6c6ebe0c8aa85d4d53edd392","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_valid_zone_v1","signature":"public.faolla_attendance_valid_zone_v1(text)","hash":"3681c82259aaf0653bbddf12e3904144a53030f6213b0e96cdf6f8d40702657d","result":"boolean","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_zone"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_shift_rule_binding_object_v1","signature":"public.faolla_attendance_shift_rule_binding_object_v1(jsonb,text[])","hash":"2a634d258ceab747cb0098c516aa423babe8d7f0203ce9fb24725bc9602ded50","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","keys"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_events_append_only_v1","signature":"public.faolla_attendance_events_append_only_v1()","hash":"66b7826feb67a63b33b563d77176ef0ef81b49479657efbd80fbcefcb5512b0a","result":"trigger","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false}]$rules206_dependencies$::jsonb;
 own_spec:=own_spec||jsonb_build_array((case when has190 then $rules206_catalog190${"name":"faolla_valid_merchant_enterprise_permissions_v1","signature":"public.faolla_valid_merchant_enterprise_permissions_v1(text[])","hash":"3d759540cb9f60753053c3012d4bbbc9d14aed92ad86aa9ba7358a0fc2d89792","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_permissions"],"searchPath":"search_path=pg_catalog, public","isRpc":false}$rules206_catalog190$::jsonb else $rules206_catalog185${"name":"faolla_valid_merchant_enterprise_permissions_v1","signature":"public.faolla_valid_merchant_enterprise_permissions_v1(text[])","hash":"876f0456ae5a911a8dd7de7ebed3ab03aa3b9bb4fa347c9adae4261d4d64c48b","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_permissions"],"searchPath":"search_path=pg_catalog, public","isRpc":false}$rules206_catalog185$::jsonb end),$rules206_capture${"name":"faolla_attendance_account_capture_v1","signature":"public.faolla_attendance_account_capture_v1(text,uuid,uuid,uuid,boolean)","hash":"c5ba771116846124af37e113086395bad0787b8daaf6f9e5283273cf82337907","result":"uuid","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_employee","p_actor","p_actor_employee","p_enabled"],"searchPath":"search_path=pg_catalog","isRpc":false}$rules206_capture$::jsonb);
 own_spec:=own_spec||$rules206_forwards$[{"name":"faolla_attendance_rules_v1","signature":"public.faolla_attendance_rules_v1(jsonb,uuid,jsonb,boolean)","hash":"f10892ab5cb5e4920a63b9a31e75a7f33cb2542979cfb2736553b8ec918e8f97","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_write"],"searchPath":"search_path=pg_catalog","isRpc":true,"oldHash":"f10892ab5cb5e4920a63b9a31e75a7f33cb2542979cfb2736553b8ec918e8f97","newHash":"1432ccb65dc04d240175f89004c7da20fd87a683bd0a65fe35157b1181ea16db"},{"name":"faolla_attendance_personal_rules_v1","signature":"public.faolla_attendance_personal_rules_v1(jsonb,uuid,jsonb,boolean)","hash":"a1f2ddd77655a5b58e7fd27f8fea54a7c0459fbe26b79edecf2d486f37260b08","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_write"],"searchPath":"search_path=pg_catalog","isRpc":true,"oldHash":"a1f2ddd77655a5b58e7fd27f8fea54a7c0459fbe26b79edecf2d486f37260b08","newHash":"547c3eae0d1375d1837e950b6a25c43e4e5350cd55c235d8aa2c54143fecedb9"},{"name":"faolla_attendance_operational_rules_v1","signature":"public.faolla_attendance_operational_rules_v1(jsonb,uuid,jsonb,boolean)","hash":"c729c0c16e81c29dec02e7f78ebc77d4a2c7f4b3448724f6c5064a3f771ef7fb","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_write"],"searchPath":"search_path=pg_catalog","isRpc":true,"oldHash":"c729c0c16e81c29dec02e7f78ebc77d4a2c7f4b3448724f6c5064a3f771ef7fb","newHash":"ed260fdcb5e094d1e7aa9ff9ff447c0bf0a24e231db64354e4016f338155f05d"},{"name":"faolla_attendance_management_insert_v1","signature":"public.faolla_attendance_management_insert_v1()","hash":"0be4836fd81477e2aabd411f282f16909f3345e06cca96795e390a4b8d1115d7","result":"trigger","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false,"from":"if tg_table_name='merchant_attendance_management_delegation_operations' then raise exception 'attendance_management_executor_unavailable';end if;","to":"if tg_table_name='merchant_attendance_management_delegation_operations' then\n  if new.delegated_action='audit_export' then perform public.faolla_attendance_management_audit_authority_v1(new);return new;end if;\n  raise exception 'attendance_management_executor_unavailable';\n end if;","oldHash":"0be4836fd81477e2aabd411f282f16909f3345e06cca96795e390a4b8d1115d7","newHash":"37216d21b66510291fb3833781951ffeef20218594879bfcb4729fea7496c4be"}]$rules206_forwards$::jsonb;
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
 if (select count(*) from pg_proc proc where proc.pronamespace=(select oid from pg_namespace where nspname=ns) and proc.proname like 'faolla_attendance_delegated_rules_%')<>(case when installed then 19 else 0 end) then raise exception 'merchant_attendance_delegated_rules_installation_conflict';end if;
 if installed then own_spec:=$rules206_own$[{"name":"faolla_attendance_delegated_rules_query_v1","signature":"public.faolla_attendance_delegated_rules_query_v1(jsonb)","hash":"b5df9ad01dae597c4ad9a31506ddf93df212981228934c4f03a46e1fa6c1d592","result":"void","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_action_v1","signature":"public.faolla_attendance_delegated_rules_action_v1(text,text)","hash":"683123d682ab9cfc779007bd11598e20db0e14da1b3125da3a2826539deb4391","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["family","action_name"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_defaults_v1","signature":"public.faolla_attendance_delegated_rules_defaults_v1(text)","hash":"1bfcadd07f1cf94a703fea2bf659ff4ded935804ff0a009aa878b853f38a8eeb","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["family"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_command_v1","signature":"public.faolla_attendance_delegated_rules_command_v1(jsonb)","hash":"897a4d0449486dd380da00cdeeec4e538dc87d4301b50589bbbcef6415faf739","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_hash_v1","signature":"public.faolla_attendance_delegated_rules_hash_v1(text,uuid,uuid,jsonb)","hash":"73b8c186cb45bc637cb95bfc80476117fa71ec2181132d265718fd1e4b688b02","result":"text","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_authorize_v1","signature":"public.faolla_attendance_delegated_rules_authorize_v1(text,uuid,uuid,text,text)","hash":"6c7d13423932a2e94c6abb3c29763bb199bc03c9dd8a9d47fc0419a4e528cc6b","result":"public.merchant_attendance_management_delegations","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id","family","action_name"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_core_authorize_v1","signature":"public.faolla_attendance_delegated_rules_core_authorize_v1(text,uuid,uuid,text,jsonb,jsonb)","hash":"fc658683c08710244750c752df3bf4be93a8ddef4ac2a73ae83fb8b9eb409fdc","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id","family","subject","d"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_at_v1","signature":"public.faolla_attendance_delegated_rules_at_v1(text,text,jsonb,timestamptz,bigint,bigint)","hash":"36d592d137f66bd174f1eea7d0a2fac583f9999a046ce05a04cc5ee48b8e4ae0","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","family","subject","stamp","ceiling","excluded"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_baseline_v1","signature":"public.faolla_attendance_delegated_rules_baseline_v1(text,text,jsonb,timestamptz,bigint)","hash":"35d861e1a697ca28e665c48bafe97a0a89e8efbf27c0c2b9d1f70a68e41e98ce","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","family","subject","stamp","ceiling"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_choices_v1","signature":"public.faolla_attendance_delegated_rules_choices_v1(public.merchant_attendance_management_delegations,jsonb,jsonb)","hash":"3b6a703e24f380ca9b175bca2283554ed71cd3a4ec3220c39d9d8746f45d3a50","result":"void","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["g","before_rules","after_rules"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_effects_v1","signature":"public.faolla_attendance_delegated_rules_effects_v1(public.merchant_attendance_management_delegations,jsonb,timestamptz,bigint)","hash":"8981af7bf5db76aef87e422a3937242b7e2aaee896e2ef708d992af9a5ebf9eb","result":"void","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["g","d","stamp","ceiling"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_base_core_v1","signature":"public.faolla_attendance_delegated_rules_base_core_v1(jsonb,uuid,jsonb,boolean,uuid)","hash":"91e10598ecc8ec2aa0d41c16bcc2bc379b1c0e6a04e1c687b092506fd2ec74f4","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id","p_command","p_allow_write","p_grant_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_personal_core_v1","signature":"public.faolla_attendance_delegated_rules_personal_core_v1(jsonb,uuid,jsonb,boolean,uuid)","hash":"9ac405f1b162d80299698a176fd6e657cf9d2dae119bad029738c97c2e522849","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id","p_command","p_allow_write","p_grant_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_operational_core_v1","signature":"public.faolla_attendance_delegated_rules_operational_core_v1(jsonb,uuid,jsonb,boolean,uuid)","hash":"30eca7ce064aa69eac0f14e373adb13062136eaab200b194f4217defcb15ebbb","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id","p_command","p_allow_write","p_grant_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_business_v1","signature":"public.faolla_attendance_delegated_rules_business_v1(text,uuid,text)","hash":"0cc581dd6bc8c64c629ea7e5f40b738b31754892b4952ddfe0fb9f87ff1eca40","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","op","family"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_operation_v1","signature":"public.faolla_attendance_delegated_rules_operation_v1(public.merchant_attendance_management_delegation_operations,boolean)","hash":"9dfdb62438c9ee367d4c28d3d96a2720d243cf4eac8ca4af74556071ba4470c3","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_current"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_receipt_v1","signature":"public.faolla_attendance_delegated_rules_receipt_v1(text,uuid,uuid,uuid)","hash":"dc754661b3647f7fa2f83752d8aa127e49bc4d3456d867b13646b4500078d55a","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","op","actor","id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_authority_v1","signature":"public.faolla_attendance_delegated_rules_authority_v1(public.merchant_attendance_management_delegation_operations)","hash":"67c2620f43c2f78ecbc51ec3e7faf991a6d352b2c71da06012aea23da762823e","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_v1","signature":"public.faolla_attendance_delegated_rules_v1(jsonb,uuid,jsonb,boolean)","hash":"6c4cdf8b938941addcc72c48fe0dbeebaaa8bd9ffc619f25d09abfc2dd3b7880","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_write"],"searchPath":"search_path=pg_catalog","isRpc":true}]$rules206_own$::jsonb;for spec in select value from jsonb_array_elements(own_spec) loop
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
 end loop; end if;foreach table_name in array array['merchant_attendance_rule_streams','merchant_attendance_rule_operations','merchant_attendance_personal_rule_streams','merchant_attendance_personal_rule_operations','merchant_attendance_operational_rule_streams','merchant_attendance_operational_rule_operations','merchant_attendance_operational_rule_publications'] loop
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
    or pg_get_expr(actual_default.adbin,actual_table) is distinct from pg_get_expr(expected_default.adbin,expected_table))) then raise exception 'merchant_attendance_delegated_rules_table_conflict';end if;
 if (select count(*) from pg_constraint where conrelid=actual_table and contype<>'t')<>(select count(*) from pg_constraint where conrelid=expected_table and contype<>'t') then raise exception 'merchant_attendance_delegated_rules_constraint_conflict';end if;
 for constraint_spec in select * from pg_constraint where conrelid=expected_table and contype<>'t' loop
  select * into actual_constraint from pg_constraint where conrelid=actual_table and conname=constraint_spec.conname;
  foreign_table:=case when constraint_spec.contype='f' then to_regclass(ns||'.'||(select relname from pg_class where oid=constraint_spec.confrelid)) else 0::oid end;
  select array_agg(actual_ref.attnum::smallint order by requested.ord) into reference_keys from unnest(constraint_spec.confkey) with ordinality requested(attnum,ord)
   join pg_attribute expected_ref on expected_ref.attrelid=constraint_spec.confrelid and expected_ref.attnum=requested.attnum
   join pg_attribute actual_ref on actual_ref.attrelid=foreign_table and actual_ref.attname=expected_ref.attname;
  if actual_constraint.oid is null or row(actual_constraint.contype,actual_constraint.conkey,actual_constraint.confkey,actual_constraint.confrelid,actual_constraint.condeferrable,actual_constraint.condeferred,actual_constraint.convalidated,actual_constraint.confupdtype,actual_constraint.confdeltype,actual_constraint.confmatchtype,actual_constraint.connoinherit,actual_constraint.conislocal,actual_constraint.coninhcount)
   is distinct from row(constraint_spec.contype,constraint_spec.conkey,reference_keys,foreign_table::oid,constraint_spec.condeferrable,constraint_spec.condeferred,true,constraint_spec.confupdtype,constraint_spec.confdeltype,constraint_spec.confmatchtype,constraint_spec.connoinherit,true,0)
   or pg_get_expr(actual_constraint.conbin,actual_table) is distinct from pg_get_expr(constraint_spec.conbin,expected_table) then raise exception 'merchant_attendance_delegated_rules_constraint_conflict';end if;
 end loop;
 if (select count(*) from pg_index where indrelid=actual_table)<>(select count(*) from pg_index where indrelid=expected_table) then raise exception 'merchant_attendance_delegated_rules_index_conflict';end if;
 for index_spec in select index_row.*,index_table.relname,index_table.relam from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indrelid=expected_table loop
  select index_row.*,index_table.relowner,index_table.relam,index_table.relkind into actual_index from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indexrelid=to_regclass(ns||'.'||index_spec.relname);
  if actual_index.indexrelid is null or actual_index.indrelid<>actual_table or actual_index.relowner<>expected_owner or actual_index.relkind<>'i' or not actual_index.indisvalid or not actual_index.indisready or not actual_index.indislive
   or row(actual_index.relam,actual_index.indnatts,actual_index.indnkeyatts,actual_index.indisunique,actual_index.indisprimary,actual_index.indisexclusion,actual_index.indimmediate,actual_index.indnullsnotdistinct,actual_index.indkey,actual_index.indcollation,actual_index.indclass,actual_index.indoption)
   is distinct from row(index_spec.relam,index_spec.indnatts,index_spec.indnkeyatts,index_spec.indisunique,index_spec.indisprimary,index_spec.indisexclusion,index_spec.indimmediate,index_spec.indnullsnotdistinct,index_spec.indkey,index_spec.indcollation,index_spec.indclass,index_spec.indoption)
   or pg_get_expr(actual_index.indpred,actual_table) is distinct from pg_get_expr(index_spec.indpred,expected_table) or pg_get_expr(actual_index.indexprs,actual_table) is distinct from pg_get_expr(index_spec.indexprs,expected_table) then raise exception 'merchant_attendance_delegated_rules_index_conflict';end if;
 end loop;
 if table_name like '%operational%' then
  if (select count(*) from pg_trigger where tgrelid=actual_table and not tgisinternal)<>3 then raise exception 'merchant_attendance_delegated_rules_trigger_conflict';end if;
  for trigger_spec in select * from(values('operational_rule_no_truncate',34,false,false,'faolla_attendance_events_append_only_v1'),
   (case when table_name like '%operations' then 'operational_rule_immutable' else 'operational_rule_shape' end,case when table_name like '%operations' then 27 else 31 end,false,false,case when table_name like '%operations' then 'faolla_attendance_events_append_only_v1' else 'faolla_attendance_operational_rule_guard_v1' end),
   ('operational_rule_proof',case when table_name like '%operations' then 5 else 21 end,true,true,'faolla_attendance_operational_rule_guard_v1')) expected(name,kind,deferred,initially_deferred,fn) loop
   if not exists(select 1 from pg_trigger actual where actual.tgrelid=actual_table and actual.tgname=trigger_spec.name::name and actual.tgtype=trigger_spec.kind and actual.tgenabled='O' and actual.tgnargs=0 and actual.tgqual is null and actual.tgdeferrable=trigger_spec.deferred and actual.tginitdeferred=trigger_spec.initially_deferred and actual.tgfoid=to_regprocedure(ns||'.'||trigger_spec.fn||'()')) then raise exception 'merchant_attendance_delegated_rules_trigger_conflict';end if;
  end loop;
 else
  if (select count(*) from pg_trigger where tgrelid=actual_table and not tgisinternal)<>(case when table_name like '%operations' then 2 else 0 end) then raise exception 'merchant_attendance_delegated_rules_trigger_conflict';end if;
  if table_name like '%operations' then
   for trigger_spec in select * from(values(case when table_name like '%personal%' then 'attendance_personal_rule_operations_immutable' else 'merchant_attendance_rule_operations_immutable' end,27),
    (case when table_name like '%personal%' then 'attendance_personal_rule_operations_no_truncate' else 'merchant_attendance_rule_operations_no_truncate' end,34)) expected(name,kind) loop
    if not exists(select 1 from pg_trigger actual where actual.tgrelid=actual_table and actual.tgname=trigger_spec.name::name and actual.tgtype=trigger_spec.kind and actual.tgenabled='O' and actual.tgnargs=0 and actual.tgqual is null and not actual.tgdeferrable and not actual.tginitdeferred and actual.tgfoid=to_regprocedure(ns||'.faolla_attendance_events_append_only_v1()')) then raise exception 'merchant_attendance_delegated_rules_trigger_conflict';end if;
   end loop;
  end if;
 end if;
end loop;
 end;$rules206_preflight$;
--END GENERATED DELEGATED RULES PREFLIGHT

create or replace function public.faolla_attendance_delegated_rules_query_v1(p jsonb)
returns void language plpgsql immutable set search_path=pg_catalog as $$
declare mode_name text:=p->>'mode';c jsonb:=p->'cursor';
begin
 if p is null or octet_length(convert_to(p::text,'UTF8'))>8192 or jsonb_typeof(p->'siteId') is distinct from 'string'
  or coalesce(p->>'siteId','')!~'^[0-9]{8}$' or public.faolla_attendance_management_scalar_v1(p->'grantId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
 if mode_name in('context','recover') then
  if public.faolla_attendance_shift_rule_binding_object_v1(p,array['siteId','grantId','mode','operationId']) is distinct from true
   or mode_name='context' and p->'operationId' is distinct from 'null'::jsonb
   or mode_name='recover' and public.faolla_attendance_management_scalar_v1(p->'operationId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
 elsif mode_name='history' then
  if public.faolla_attendance_shift_rule_binding_object_v1(p,array['siteId','grantId','mode','cursor']) is distinct from true then raise exception 'attendance_invalid_request';end if;
  if c is distinct from 'null'::jsonb and (public.faolla_attendance_shift_rule_binding_object_v1(c,array['siteId','grantId','atRevision','beforeRevision']) is distinct from true
   or c->'siteId' is distinct from p->'siteId' or c->'grantId' is distinct from p->'grantId'
   or public.faolla_attendance_operational_rule_scalar_v1(c->'atRevision','positive') is distinct from true
   or public.faolla_attendance_operational_rule_scalar_v1(c->'beforeRevision','positive') is distinct from true
   or (c->>'beforeRevision')::numeric<=1 or (c->>'beforeRevision')::numeric>(c->>'atRevision')::numeric) then raise exception 'attendance_invalid_request';end if;
 elsif mode_name='preview' then
  if public.faolla_attendance_shift_rule_binding_object_v1(p,array['siteId','grantId','mode','sourceDraftRevision','effectiveOn','endsOn']) is distinct from true
   or public.faolla_attendance_operational_rule_scalar_v1(p->'sourceDraftRevision','positive') is distinct from true
   or jsonb_typeof(p->'effectiveOn') is distinct from 'string' or public.faolla_attendance_group_date_v1(p->>'effectiveOn') is distinct from true
   or p->'endsOn' is distinct from 'null'::jsonb and (jsonb_typeof(p->'endsOn') is distinct from 'string' or public.faolla_attendance_group_date_v1(p->>'endsOn') is distinct from true) then raise exception 'attendance_invalid_request';end if;
 else raise exception 'attendance_invalid_request';end if;
end;
$$;

create or replace function public.faolla_attendance_delegated_rules_action_v1(family text,action_name text)
returns text language sql immutable set search_path=pg_catalog as $$
 select case family when 'base' then case action_name when 'save_draft' then 'rule_draft' when 'publish' then 'rule_publish' when 'withdraw' then 'rule_withdraw' end
 when 'personal' then case action_name when 'approve' then 'personal_rule_approve' when 'withdraw' then 'personal_rule_withdraw' end
 when 'operational' then case action_name when 'save_draft' then 'operational_rule_draft' when 'publish' then 'operational_rule_publish' when 'withdraw' then 'operational_rule_withdraw' end end;
$$;

create or replace function public.faolla_attendance_delegated_rules_defaults_v1(family text)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare keys text[];key_name text;r jsonb:='{}';
begin
 keys:=case when family='operational' then array['allowedChannels','locationScope','shiftSource','breakTypes','correctionWindow','reviewRouting','timesheetCycle','reminders'] else array['lateGraceMinutes','earlyGraceMinutes','openSpanWarningMinutes','completedBreakMinimumMinutes'] end;
 foreach key_name in array keys loop r:=r||jsonb_build_object(key_name,jsonb_build_object('mode','inherit'));end loop;return r;
end;
$$;

create or replace function public.faolla_attendance_delegated_rules_command_v1(c jsonb)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare family text:=c->>'family';d jsonb:=c->'decision';r jsonb;choices jsonb:='[]';key_name text;v jsonb;
begin
 if c is null or octet_length(convert_to(c::text,'UTF8'))>49152 or public.faolla_attendance_shift_rule_binding_object_v1(c,array['family','decision']) is distinct from true then raise exception 'attendance_invalid_request';end if;
 if family='operational' then return jsonb_build_array(family,public.faolla_attendance_operational_rule_command_v1(d));end if;
 if family='base' then
  if public.faolla_attendance_rule_command_v1(d) is distinct from true then raise exception 'attendance_invalid_request';end if;
 elsif family='personal' then
  if public.faolla_attendance_personal_rule_command_v1(d) is distinct from true then raise exception 'attendance_invalid_request';end if;
 else raise exception 'attendance_invalid_request';end if;
 r:=jsonb_build_array(d->>'action',d->>'operationId',(d->>'expectedRevision')::bigint,d->>'reason');
 if d ? 'rules' then foreach key_name in array array['lateGraceMinutes','earlyGraceMinutes','openSpanWarningMinutes','completedBreakMinimumMinutes'] loop
  v:=d->'rules'->key_name;choices:=choices||jsonb_build_array(case when v->>'mode'='value' then jsonb_build_array('value',(v->>'minutes')::integer) else jsonb_build_array(v->>'mode') end);
 end loop;end if;
 if family='base' then
  if d->>'action'='withdraw' then r:=r||jsonb_build_array((d->>'publishedRevision')::bigint);
  else r:=r||jsonb_build_array((d->>'expectedSettingsVersion')::bigint,(d->>'expectedGroupRevision')::bigint,d->>'timeZone')||case when d->>'action'='save_draft' then jsonb_build_array(choices) else jsonb_build_array(d->>'effectiveOn') end;end if;
 else
  if d->>'action'='withdraw' then r:=r||jsonb_build_array((d->>'approvedRevision')::bigint);
  else r:=r||jsonb_build_array((d->>'expectedWorkerVersion')::bigint,(d->>'expectedSettingsVersion')::bigint,d->>'employeeId',d->>'employeeAuthUserId',d->>'timeZone',d->>'startsOn',d->>'endsOn',choices);end if;
 end if;return jsonb_build_array(family,r);
end;
$$;

create or replace function public.faolla_attendance_delegated_rules_hash_v1(site text,actor uuid,id uuid,c jsonb)
returns text language plpgsql stable set search_path=pg_catalog as $$
begin
 return public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-delegated-rules-command-v1',site,actor,id,public.faolla_attendance_delegated_rules_command_v1(c)));
end;
$$;

create or replace function public.faolla_attendance_delegated_rules_authorize_v1(site text,actor uuid,id uuid,family text,action_name text)
returns public.merchant_attendance_management_delegations language plpgsql set search_path=pg_catalog as $$
declare g public.merchant_attendance_management_delegations%rowtype;e public.merchant_enterprise_employees%rowtype;role_row public.merchant_enterprise_roles%rowtype;
begin
 perform 1 from public.merchants actual where actual.id=site for share;if not found then raise exception 'attendance_access_denied';end if;
 perform 1 from public.merchant_attendance_settings actual where actual.merchant_id=site for update;if not found then raise exception 'attendance_settings_required';end if;
 select * into g from public.merchant_attendance_management_delegations actual where actual.merchant_id=site and actual.grant_id=id for share;
 if actor is null or g.grant_id is null or g.delegate_auth_user_id is distinct from actor or g.scope->>'kind' is distinct from 'rules'
  or family is not null and g.scope->>'family' is distinct from family
  or action_name is not null and g.delegated_action is distinct from public.faolla_attendance_delegated_rules_action_v1(family,action_name)
  or g.delegated_action not in('rule_draft','rule_publish','rule_withdraw','personal_rule_approve','personal_rule_withdraw','operational_rule_draft','operational_rule_publish','operational_rule_withdraw') then raise exception 'attendance_access_denied';end if;
 select * into e from public.merchant_enterprise_employees actual where actual.merchant_id=site and actual.id=g.delegate_employee_id for share;
 select * into role_row from public.merchant_enterprise_roles actual where actual.merchant_id=site and actual.id=e.role_id for share;
 if public.faolla_attendance_management_current_v1(g,clock_timestamp()) is distinct from true then raise exception 'attendance_access_denied';end if;
 if action_name is not null and g.scope->'subject'->>'kind'='personal'
  and (g.employee_id=g.delegate_employee_id or g.employee_auth_user_id=actor) then raise exception 'attendance_access_denied';end if;
 return g;
end;
$$;

create or replace function public.faolla_attendance_delegated_rules_core_authorize_v1(site text,actor uuid,id uuid,family text,subject jsonb,d jsonb)
returns void language plpgsql set search_path=pg_catalog as $$
declare g public.merchant_attendance_management_delegations%rowtype;
begin
 g:=public.faolla_attendance_delegated_rules_authorize_v1(site,actor,id,family,d->>'action');
 if family='personal' then
  if subject->>'workerId' is distinct from g.scope->'subject'->>'workerId' then raise exception 'attendance_access_denied';end if;
 elsif subject is distinct from g.scope->'subject' then raise exception 'attendance_access_denied';end if;
end;
$$;

--Immutable as-of replay: ceiling excludes this/newer operations, so future
--owner edits/revocations cannot make a saved receipt depend on today's head.
create or replace function public.faolla_attendance_delegated_rules_at_v1(site text,family text,subject jsonb,stamp timestamptz,ceiling bigint,excluded bigint)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare r jsonb;n integer:=0;key_value text;base_candidate public.merchant_attendance_rule_operations%rowtype;
 candidate public.merchant_attendance_operational_rule_publications%rowtype;operational public.merchant_attendance_operational_rule_operations%rowtype;
begin
 if stamp is null or not isfinite(stamp) or ceiling is null or ceiling not between 1 and 9007199254740991 then raise exception 'attendance_delegated_rules_invalid';end if;
 if family='base' then
  key_value:=coalesce(subject->>'groupId','enterprise');
  --Prelimit raw indexed publications, including withdrawn ones. A 26th raw
  --candidate is refusal, never a silent missing/current/default publication.
  for base_candidate in select actual.* from public.merchant_attendance_rule_operations actual where actual.merchant_id=site and actual.stream_key=key_value and actual.action='publish'
   and actual.effective_at<=stamp and actual.revision<ceiling and actual.revision is distinct from excluded order by actual.effective_at desc,actual.revision desc limit 26 loop
   n:=n+1;if n=26 then raise exception 'attendance_delegated_rules_too_large';end if;
   perform public.faolla_attendance_rule_receipt_v1(base_candidate);
   if r is null and not exists(select 1 from public.merchant_attendance_rule_operations withdrawal where withdrawal.merchant_id=site and withdrawal.stream_key=key_value and withdrawal.action='withdraw' and withdrawal.published_revision=base_candidate.revision and withdrawal.revision<ceiling) then
    r:=jsonb_build_object('rules',base_candidate.rules,'revision',base_candidate.revision,'effectiveAt',base_candidate.effective_at);
   end if;
  end loop;
 elsif family='operational' then
  key_value:=public.faolla_attendance_operational_rule_scope_v1(subject)::text;
  for candidate in select actual.* from public.merchant_attendance_operational_rule_publications actual where actual.merchant_id=site and actual.stream_key=key_value
   and actual.effective_at<=stamp and actual.published_revision<ceiling and actual.published_revision is distinct from excluded
   order by actual.effective_at desc,actual.published_revision desc limit 26 loop
   n:=n+1;if n=26 then raise exception 'attendance_delegated_rules_too_large';end if;
   select * into operational from public.merchant_attendance_operational_rule_operations actual where actual.merchant_id=site and actual.stream_key=key_value and actual.revision=candidate.published_revision;
   perform public.faolla_attendance_operational_rule_item_v1(operational);
   if r is null and (candidate.withdrawn_revision is null or candidate.withdrawn_revision>=ceiling) and (candidate.ends_at is null or candidate.ends_at>stamp) then
    r:=jsonb_build_object('rules',operational.item->'rules','revision',operational.revision,'effectiveAt',candidate.effective_at);
   end if;
  end loop;
 elsif family<>'personal' then raise exception 'attendance_delegated_rules_invalid';end if;
 return coalesce(r,jsonb_build_object('rules',public.faolla_attendance_delegated_rules_defaults_v1(family),'revision',null,'effectiveAt',null));
end;
$$;

create or replace function public.faolla_attendance_delegated_rules_baseline_v1(site text,family text,subject jsonb,stamp timestamptz,ceiling bigint)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare previous public.merchant_attendance_rule_operations%rowtype;draft public.merchant_attendance_rule_operations%rowtype;
 prior_operational public.merchant_attendance_operational_rule_operations%rowtype;operational public.merchant_attendance_operational_rule_operations%rowtype;key_value text;r jsonb;revision_value bigint;
begin
 if family='base' then
  key_value:=coalesce(subject->>'groupId','enterprise');
  select * into previous from public.merchant_attendance_rule_operations actual where actual.merchant_id=site and actual.stream_key=key_value and actual.revision=ceiling-1;
  if previous.operation_id is not null then perform public.faolla_attendance_rule_receipt_v1(previous);revision_value:=previous.draft_revision_after;end if;
  if revision_value is not null then
   select * into draft from public.merchant_attendance_rule_operations actual where actual.merchant_id=site and actual.stream_key=key_value and actual.revision=revision_value;
   perform public.faolla_attendance_rule_receipt_v1(draft);if draft.action is distinct from 'save_draft' then raise exception 'attendance_delegated_rules_invalid';end if;
   return jsonb_build_object('baselineKind','draft','baselineRevision',draft.revision,'baselineRules',draft.rules);
  end if;
 elsif family='operational' then
  key_value:=public.faolla_attendance_operational_rule_scope_v1(subject)::text;
  select * into prior_operational from public.merchant_attendance_operational_rule_operations actual where actual.merchant_id=site and actual.stream_key=key_value and actual.revision=ceiling-1;
  if prior_operational.operation_id is not null then perform public.faolla_attendance_operational_rule_item_v1(prior_operational);revision_value:=prior_operational.draft_revision_after;end if;
  if revision_value is not null then
   select * into operational from public.merchant_attendance_operational_rule_operations actual where actual.merchant_id=site and actual.stream_key=key_value and actual.revision=revision_value;
   perform public.faolla_attendance_operational_rule_item_v1(operational);if operational.action is distinct from 'save_draft' then raise exception 'attendance_delegated_rules_invalid';end if;
   return jsonb_build_object('baselineKind','draft','baselineRevision',operational.revision,'baselineRules',operational.item->'rules');
  end if;
 else raise exception 'attendance_delegated_rules_invalid';end if;
 r:=public.faolla_attendance_delegated_rules_at_v1(site,family,subject,stamp,ceiling,null);
 return jsonb_build_object('baselineKind',case when r->'revision'='null'::jsonb then 'default' else 'publication' end,'baselineRevision',r->'revision','baselineRules',r->'rules');
end;
$$;

create or replace function public.faolla_attendance_delegated_rules_choices_v1(g public.merchant_attendance_management_delegations,before_rules jsonb,after_rules jsonb)
returns void language plpgsql stable set search_path=pg_catalog as $$
declare key_name text;family text:=g.scope->>'family';v jsonb;known_routes jsonb:='[]';
begin
 if family='operational' then perform public.faolla_attendance_operational_rule_values_v1(before_rules);perform public.faolla_attendance_operational_rule_values_v1(after_rules);
 elsif public.faolla_attendance_rule_values_v1(before_rules) is distinct from true or public.faolla_attendance_rule_values_v1(after_rules) is distinct from true then raise exception 'attendance_delegated_rules_invalid';end if;
 for key_name in select jsonb_object_keys(before_rules) loop
  if before_rules->key_name is distinct from after_rules->key_name and not(g.scope->'allowedRuleKeys' @> jsonb_build_array(key_name)) then raise exception 'attendance_delegated_rules_key_denied';end if;
 end loop;
 --Explicit UUID whitelist only. inherit/disabled are unchanged old semantics,
 --not a new population/geofence promise and not new approval authority.
 if family='operational' then
  foreach v in array array[before_rules->'locationScope',after_rules->'locationScope'] loop
   if v->>'mode'='value' and exists(select 1 from jsonb_array_elements(v->'value') requested(id) where not(g.scope->'locationIds' @> jsonb_build_array(requested.id))) then raise exception 'attendance_delegated_rules_reference_denied';end if;
  end loop;
  --At most4 actual immutable same-layer Employee/Auth pairs, never a current
  --merchant/member directory. Moving a known pair between categories grants
  --no new approval authority; the existing191 active-reference proof remains.
  if before_rules->'reviewRouting'->>'mode'='value' then
   foreach key_name in array array['correction','missing','leave','work_arrangement'] loop
    v:=before_rules->'reviewRouting'->'value'->key_name;if v<>'"owner"'::jsonb then known_routes:=known_routes||jsonb_build_array(v);end if;
   end loop;
  end if;
  if after_rules->'reviewRouting'->>'mode'='value' then
   foreach key_name in array array['correction','missing','leave','work_arrangement'] loop
    v:=after_rules->'reviewRouting'->'value'->key_name;
    if v<>'"owner"'::jsonb and not(known_routes @> jsonb_build_array(v)) then raise exception 'attendance_delegated_rules_reference_denied';end if;
   end loop;
  end if;
 end if;
end;
$$;

create or replace function public.faolla_attendance_delegated_rules_effects_v1(g public.merchant_attendance_management_delegations,d jsonb,stamp timestamptz,ceiling bigint)
returns void language plpgsql stable set search_path=pg_catalog as $$
declare family text:=g.scope->>'family';subject jsonb:=g.scope->'subject';a text:=d->>'action';before_rules jsonb;after_rules jsonb;key_value text;target_revision bigint;
 b public.merchant_attendance_rule_operations%rowtype;p public.merchant_attendance_personal_rule_operations%rowtype;o public.merchant_attendance_operational_rule_operations%rowtype;previous public.merchant_attendance_rule_operations%rowtype;
 start_at timestamptz;end_at timestamptz;point_at timestamptz;points timestamptz[];candidate_count integer:=0;candidate record;old_value jsonb;
begin
 if stamp is null or not isfinite(stamp) or ceiling is null or ceiling not between 1 and 9007199254740991 then raise exception 'attendance_delegated_rules_invalid';end if;
 if a='save_draft' then
  before_rules:=public.faolla_attendance_delegated_rules_baseline_v1(g.merchant_id,family,subject,stamp,ceiling)->'baselineRules';after_rules:=d->'rules';
  perform public.faolla_attendance_delegated_rules_choices_v1(g,before_rules,after_rules);return;
 elsif family='personal' then
  if a='approve' then
   start_at:=public.faolla_attendance_rule_day_start_v1(d->>'startsOn',d->>'timeZone');end_at:=public.faolla_attendance_personal_rule_end_v1(d->>'endsOn',d->>'timeZone');
   before_rules:=public.faolla_attendance_delegated_rules_defaults_v1(family);after_rules:=d->'rules';
  else
   select * into p from public.merchant_attendance_personal_rule_operations actual where actual.merchant_id=g.merchant_id and actual.worker_id=g.worker_id and actual.revision=(d->>'approvedRevision')::bigint;
   if p.action is distinct from 'approve' or p.revision>=ceiling then raise exception 'attendance_delegated_rules_invalid';end if;perform public.faolla_attendance_personal_rule_receipt_v1(p);
   start_at:=p.from_at;end_at:=p.to_at;target_revision:=p.revision;before_rules:=p.rules;after_rules:=public.faolla_attendance_delegated_rules_defaults_v1(family);
  end if;
  --The old129 interval invariant permits no other active same-layer approval.
  --Still bound/validate raw overlapping candidates, including withdrawn ones;
  --the26th refuses rather than pretending an unobserved interval is empty.
  if start_at is null or end_at is null or end_at<=start_at then raise exception 'attendance_invalid_request';end if;
  for candidate in select actual.operation_id,actual.revision from public.merchant_attendance_personal_rule_operations actual where actual.merchant_id=g.merchant_id and actual.worker_id=g.worker_id
   and actual.action='approve' and actual.revision<ceiling and actual.from_at<end_at and actual.to_at>start_at order by actual.from_at,actual.revision limit 26 loop
   candidate_count:=candidate_count+1;if candidate_count=26 then raise exception 'attendance_delegated_rules_too_large';end if;
   perform public.faolla_attendance_delegated_rules_business_v1(g.merchant_id,candidate.operation_id,family);
   if candidate.revision is distinct from target_revision and not exists(select 1 from public.merchant_attendance_personal_rule_operations withdrawal where withdrawal.merchant_id=g.merchant_id and withdrawal.worker_id=g.worker_id and withdrawal.action='withdraw' and withdrawal.approved_revision=candidate.revision and withdrawal.revision<ceiling) then raise exception 'attendance_personal_rule_overlap';end if;
  end loop;
  perform public.faolla_attendance_delegated_rules_choices_v1(g,before_rules,after_rules);return;
 elsif family='base' then
  key_value:=coalesce(subject->>'groupId','enterprise');
  if a='publish' then
   select * into previous from public.merchant_attendance_rule_operations actual where actual.merchant_id=g.merchant_id and actual.stream_key=key_value and actual.revision=ceiling-1;
   select * into b from public.merchant_attendance_rule_operations actual where actual.merchant_id=g.merchant_id and actual.stream_key=key_value and actual.revision=previous.draft_revision_after;
   if b.action is distinct from 'save_draft' then raise exception 'attendance_rule_draft_required';end if;perform public.faolla_attendance_rule_receipt_v1(b);
   start_at:=public.faolla_attendance_rule_day_start_v1(d->>'effectiveOn',d->>'timeZone');
   after_rules:=b.rules;
  else
   target_revision:=(d->>'publishedRevision')::bigint;
   select * into b from public.merchant_attendance_rule_operations actual where actual.merchant_id=g.merchant_id and actual.stream_key=key_value and actual.revision=target_revision;
   if b.action is distinct from 'publish' or b.revision>=ceiling then raise exception 'attendance_delegated_rules_invalid';end if;perform public.faolla_attendance_rule_receipt_v1(b);
   start_at:=b.effective_at;
  end if;
 else
  key_value:=public.faolla_attendance_operational_rule_scope_v1(subject)::text;
  target_revision:=(case when a='publish' then d->>'sourceDraftRevision' else d->>'publishedRevision' end)::bigint;
  select * into o from public.merchant_attendance_operational_rule_operations actual where actual.merchant_id=g.merchant_id and actual.stream_key=key_value and actual.revision=target_revision;
  perform public.faolla_attendance_operational_rule_item_v1(o);
  if o.revision>=ceiling or o.action is distinct from (case when a='publish' then 'save_draft' else 'publish' end) then raise exception 'attendance_delegated_rules_invalid';end if;
  if a='publish' then
   start_at:=public.faolla_attendance_rule_day_start_v1(d->>'effectiveOn',o.item->'context'->>'timeZone');
   end_at:=case when d->>'endsOn' is not null then public.faolla_attendance_personal_rule_end_v1(d->>'endsOn',o.item->'context'->>'timeZone') else null end;after_rules:=o.item->'rules';
  else
   start_at:=(o.item->>'effectiveAt')::timestamptz;end_at:=(o.item->>'endsAt')::timestamptz;
  end if;
 end if;
 if start_at is null or not isfinite(start_at) or end_at is not null and (not isfinite(end_at) or end_at<=start_at) then raise exception 'attendance_delegated_rules_invalid';end if;
 points:=array[start_at];
 --Every actual future same-layer segment boundary is checked under the
 --settings lock. raw26 sentinel fails closed, including withdrawn entries.
 for candidate in
  (select actual.operation_id,actual.revision,actual.effective_at,null::timestamptz ends_at from public.merchant_attendance_rule_operations actual where family='base' and actual.merchant_id=g.merchant_id and actual.stream_key=key_value and actual.action='publish' and actual.revision<ceiling and actual.effective_at>=start_at order by actual.effective_at,actual.revision limit 26)
  union all (select actual.operation_id,actual.published_revision,actual.effective_at,actual.ends_at from public.merchant_attendance_operational_rule_publications actual where family='operational' and actual.merchant_id=g.merchant_id and actual.stream_key=key_value and actual.published_revision<ceiling
   and (actual.effective_at>=start_at or actual.ends_at>start_at) and (end_at is null or actual.effective_at<end_at)
   order by actual.effective_at,actual.published_revision limit 26)
  order by effective_at,revision limit 26 loop
  candidate_count:=candidate_count+1;if candidate_count=26 then raise exception 'attendance_delegated_rules_too_large';end if;
  perform public.faolla_attendance_delegated_rules_business_v1(g.merchant_id,candidate.operation_id,family);
  if candidate.effective_at>=start_at then points:=array_append(points,candidate.effective_at);end if;
  if candidate.ends_at>start_at and (end_at is null or candidate.ends_at<end_at) then points:=array_append(points,candidate.ends_at);end if;
 end loop;
 for point_at in select distinct point_value from unnest(points) point(point_value) order by point_value loop
  old_value:=public.faolla_attendance_delegated_rules_at_v1(g.merchant_id,family,subject,point_at,ceiling,null);before_rules:=old_value->'rules';
  if a='withdraw' then
   after_rules:=public.faolla_attendance_delegated_rules_at_v1(g.merchant_id,family,subject,point_at,ceiling,target_revision)->'rules';
  elsif (old_value->>'effectiveAt')::timestamptz>start_at then
   --A later unchanged publication still wins both states. Nothing is silently
   --clipped: its entire choice JSON and UUID references are checked as well.
   after_rules:=old_value->'rules';
  elsif family='base' then after_rules:=b.rules;
  else after_rules:=o.item->'rules';end if;
  perform public.faolla_attendance_delegated_rules_choices_v1(g,before_rules,after_rules);
 end loop;
end;
$$;

--BEGIN GENERATED DELEGATED RULES CORES
create or replace function public.faolla_attendance_delegated_rules_base_core_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb,p_allow_write boolean,p_grant_id uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare site text;key text;gid uuid;op uuid;before_rev bigint;k text;action_name text;current_rev bigint:=0;new_rev bigint;
  s public.merchant_attendance_settings%rowtype;g public.merchant_attendance_groups%rowtype;stream public.merchant_attendance_rule_streams%rowtype;
  existing public.merchant_attendance_rule_operations%rowtype;entry public.merchant_attendance_rule_operations%rowtype;
  saved public.merchant_attendance_rule_operations%rowtype;target public.merchant_attendance_rule_operations%rowtype;withdrawal public.merchant_attendance_rule_operations%rowtype;
  group_item jsonb;draft_item jsonb;receipt jsonb;items jsonb:='[]';result jsonb;stamp timestamptz;boundary timestamptz;today date;
  count_seen integer:=0;next_before bigint;withdrawn_by bigint;
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_auth_user_id is null or p_allow_write is null or p_query is null or jsonb_typeof(p_query)<>'object' then raise exception 'attendance_invalid_request';end if;
  if (select count(*) from jsonb_object_keys(p_query))<>4 or not(p_query ?& array['siteId','groupId','operationId','beforeRevision'])
    or jsonb_typeof(p_query->'siteId')<>'string' or coalesce(p_query->>'siteId','') !~ '^\d{8}$' then raise exception 'attendance_invalid_request';end if;
  foreach k in array array['groupId','operationId'] loop
    if p_query->k<>'null'::jsonb and (jsonb_typeof(p_query->k)<>'string' or coalesce(p_query->>k,'') !~ uuid_pattern) then raise exception 'attendance_invalid_request';end if;
  end loop;
  if p_query->'beforeRevision'<>'null'::jsonb and (jsonb_typeof(p_query->'beforeRevision')<>'number'
    or coalesce(p_query->>'beforeRevision','') !~ '^[1-9][0-9]{0,15}$' or (p_query->>'beforeRevision')::numeric>9007199254740990) then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';gid:=(p_query->>'groupId')::uuid;key:=coalesce(gid::text,'enterprise');op:=(p_query->>'operationId')::uuid;before_rev:=(p_query->>'beforeRevision')::bigint;
  if op is not null and before_rev is not null then raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
    if op is not null or before_rev is not null or not public.faolla_attendance_rule_command_v1(p_command) then raise exception 'attendance_invalid_request';end if;
    if p_command->>'action'<>'withdraw' and ((gid is null)<>(p_command->'expectedGroupRevision'='null'::jsonb)) then raise exception 'attendance_invalid_request';end if;
    op:=(p_command->>'operationId')::uuid;action_name:=p_command->>'action';
  end if;

  -- Reauthorize under the same lock order as owner configuration and group124.
  if p_grant_id is null then
  perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  else
  perform public.faolla_attendance_delegated_rules_core_authorize_v1(site,p_auth_user_id,p_grant_id,'base',jsonb_build_object('kind',case when gid is null then 'enterprise' else 'group' end)||case when gid is null then '{}'::jsonb else jsonb_build_object('groupId',gid) end,p_command);
  end if;
  if p_command is null then select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  else select * into s from public.merchant_attendance_settings where merchant_id=site for update;end if;
  if not found then raise exception 'attendance_settings_required';end if;
  if s.version not between 1 and 9007199254740990 or not public.faolla_attendance_valid_zone_v1(s.time_zone) then raise exception 'attendance_rule_invalid';end if;
  if gid is not null then
    select * into g from public.merchant_attendance_groups where merchant_id=site and group_id=gid for share;
    if not found then raise exception 'attendance_group_not_found';end if;
    perform public.faolla_attendance_group_checked_v1(g);
    group_item:=jsonb_build_object('groupId',g.group_id,'revision',g.revision,'name',g.name,'active',g.active);
  end if;
  select * into stream from public.merchant_attendance_rule_streams where merchant_id=site and stream_key=key;
  if found then current_rev:=stream.revision;draft_item:=public.faolla_attendance_rule_stream_checked_v1(stream);end if;
  if op is not null then
    select * into existing from public.merchant_attendance_rule_operations where merchant_id=site and operation_id=op;
    if existing.operation_id is not null then
      if existing.stream_key<>key or existing.actor_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;
      if p_command is not null and existing.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
      if existing.revision>current_rev then raise exception 'attendance_rule_invalid';end if;
      receipt:=public.faolla_attendance_rule_receipt_v1(existing);
    end if;
  end if;

  -- Pause/activity/context/CAS eligibility applies only to a NEW operation.
  -- An exact original command remains confirmable by the CURRENT owner.
  if p_command is not null and receipt is null then
    if not p_allow_write then raise exception 'attendance_platform_paused';end if;
    if (p_command->>'expectedRevision')::bigint<>current_rev then raise exception 'attendance_version_conflict';end if;
    new_rev:=current_rev+1;
    if action_name in('save_draft','publish') then
      if gid is not null and not g.active then raise exception 'attendance_rule_group_inactive';end if;
      if (p_command->>'expectedSettingsVersion')::bigint<>s.version or (p_command->>'expectedGroupRevision')::bigint is distinct from g.revision
        or p_command->>'timeZone'<>s.time_zone then raise exception 'attendance_version_conflict';end if;
      if action_name='publish' then
        if stream.draft_revision is null then raise exception 'attendance_rule_draft_required';end if;
        select * into saved from public.merchant_attendance_rule_operations where merchant_id=site and stream_key=key and revision=stream.draft_revision;
        if saved.settings_version<>s.version or saved.group_revision is distinct from g.revision or saved.time_zone<>s.time_zone then raise exception 'attendance_version_conflict';end if;
        boundary:=public.faolla_attendance_rule_day_start_v1(p_command->>'effectiveOn',s.time_zone);
        if boundary is null then raise exception 'attendance_rule_future_required';end if;
        if exists(select 1 from public.merchant_attendance_rule_operations pub where pub.merchant_id=site and pub.stream_key=key and pub.action='publish'
          and pub.effective_at>=boundary and not exists(select 1 from public.merchant_attendance_rule_operations wd
            where wd.merchant_id=pub.merchant_id and wd.stream_key=pub.stream_key and wd.action='withdraw' and wd.published_revision=pub.revision)) then
          raise exception 'attendance_rule_order_conflict';end if;
      end if;
    else
      select * into target from public.merchant_attendance_rule_operations where merchant_id=site and stream_key=key and revision=(p_command->>'publishedRevision')::bigint and action='publish';
      if not found then raise exception 'attendance_not_available';end if;
      perform public.faolla_attendance_rule_receipt_v1(target);
      if exists(select 1 from public.merchant_attendance_rule_operations where merchant_id=site and stream_key=key and action='withdraw' and published_revision=target.revision) then
        raise exception 'attendance_rule_already_withdrawn';end if;
    end if;
    -- Never use transaction-start now(): settings/group locks can have waited.
    stamp:=clock_timestamp();
    if stream.updated_at is not null and stamp<stream.updated_at then raise exception 'attendance_rule_invalid';end if;
    if action_name='publish' then
      today:=(stamp at time zone s.time_zone)::date;
      if today not between date '2000-01-01' and date '2100-12-31' or (p_command->>'effectiveOn')::date<=today or boundary<=stamp then raise exception 'attendance_rule_future_required';end if;
    elsif action_name='withdraw' and stamp>=target.effective_at then raise exception 'attendance_rule_future_required';end if;

    entry.merchant_id:=site;entry.stream_key:=key;entry.operation_id:=op;entry.revision:=new_rev;entry.action:=action_name;entry.actor_auth_user_id:=p_auth_user_id;
    entry.command:=p_command;entry.recorded_at:=stamp;entry.draft_action:='save_draft';entry.published_action:='publish';
    if action_name in('save_draft','publish') then
      entry.settings_version:=s.version;entry.group_revision:=g.revision;entry.time_zone:=s.time_zone;
      if action_name='save_draft' then entry.rules:=p_command->'rules';entry.draft_revision_after:=new_rev;
      else entry.rules:=saved.rules;entry.effective_on:=(p_command->>'effectiveOn')::date;entry.effective_at:=boundary;entry.source_draft_revision:=saved.revision;end if;
    else entry.published_revision:=target.revision;entry.draft_revision_after:=stream.draft_revision;end if;
    entry.snapshot:=public.faolla_attendance_rule_item_v1(entry);
    if current_rev=0 then
      insert into public.merchant_attendance_rule_streams(merchant_id,stream_key,group_id,revision,draft_revision,created_at,updated_at)
        values(site,key,gid,new_rev,entry.draft_revision_after,stamp,stamp) returning * into stream;
    else
      update public.merchant_attendance_rule_streams set revision=new_rev,draft_revision=entry.draft_revision_after,updated_at=stamp
        where merchant_id=site and stream_key=key returning * into stream;
    end if;
    insert into public.merchant_attendance_rule_operations select entry.*;
    current_rev:=new_rev;draft_item:=public.faolla_attendance_rule_stream_checked_v1(stream);receipt:=public.faolla_attendance_rule_receipt_v1(entry);
  end if;

  for entry in select * from public.merchant_attendance_rule_operations where merchant_id=site and stream_key=key
    and (before_rev is null or revision<before_rev) order by revision desc limit 26 loop
    count_seen:=count_seen+1;exit when count_seen=26;
    perform public.faolla_attendance_rule_receipt_v1(entry);withdrawn_by:=null;
    if entry.action='publish' then
      select * into withdrawal from public.merchant_attendance_rule_operations where merchant_id=site and stream_key=key and action='withdraw' and published_revision=entry.revision;
      if found then perform public.faolla_attendance_rule_receipt_v1(withdrawal);withdrawn_by:=withdrawal.revision;end if;
    end if;
    items:=items||jsonb_build_array(entry.snapshot||jsonb_build_object('withdrawnByRevision',withdrawn_by));next_before:=entry.revision;
  end loop;
  result:=jsonb_build_object('protocol','rules-v1','siteId',site,'actorId',p_auth_user_id,'group',group_item,'settingsVersion',s.version,'timeZone',s.time_zone,
    'revision',current_rev,'draft',draft_item,'items',items,'nextBeforeRevision',case when count_seen=26 then next_before else null end,'receipt',receipt);
  if octet_length(result::text)>131072 then raise exception 'attendance_rule_invalid';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_parameter_value then raise exception 'attendance_invalid_request';
end;
$$;
create or replace function public.faolla_attendance_delegated_rules_personal_core_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb,p_allow_write boolean,p_grant_id uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare site text;wid uuid;op uuid;before_rev bigint;action_name text;current_rev bigint:=0;new_rev bigint;
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
  stream public.merchant_attendance_personal_rule_streams%rowtype;existing public.merchant_attendance_personal_rule_operations%rowtype;
  entry public.merchant_attendance_personal_rule_operations%rowtype;target public.merchant_attendance_personal_rule_operations%rowtype;
  withdrawal public.merchant_attendance_personal_rule_operations%rowtype;
  worker_item jsonb;receipt jsonb;items jsonb:='[]';result jsonb;stamp timestamptz;read_at timestamptz;start_at timestamptz;end_at timestamptz;today date;
  count_seen integer:=0;next_before bigint;withdrawn_by bigint;
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_auth_user_id is null or p_allow_write is null or p_query is null or jsonb_typeof(p_query)<>'object' then raise exception 'attendance_invalid_request';end if;
  if (select count(*) from jsonb_object_keys(p_query))<>4 or not(p_query ?& array['siteId','workerId','operationId','beforeRevision'])
    or jsonb_typeof(p_query->'siteId')<>'string' or coalesce(p_query->>'siteId','') !~ '^\d{8}$'
    or jsonb_typeof(p_query->'workerId')<>'string' or coalesce(p_query->>'workerId','') !~ uuid_pattern
    or p_query->'operationId'<>'null'::jsonb and (jsonb_typeof(p_query->'operationId')<>'string' or coalesce(p_query->>'operationId','') !~ uuid_pattern)
    or p_query->'beforeRevision'<>'null'::jsonb and (jsonb_typeof(p_query->'beforeRevision')<>'number'
      or coalesce(p_query->>'beforeRevision','') !~ '^[1-9][0-9]{0,15}$' or (p_query->>'beforeRevision')::numeric>9007199254740990) then
    raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';wid:=(p_query->>'workerId')::uuid;op:=(p_query->>'operationId')::uuid;before_rev:=(p_query->>'beforeRevision')::bigint;
  if op is not null and before_rev is not null then raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
    if op is not null or before_rev is not null or not public.faolla_attendance_personal_rule_command_v1(p_command) then raise exception 'attendance_invalid_request';end if;
    op:=(p_command->>'operationId')::uuid;action_name:=p_command->>'action';
  end if;

  -- Current owner -> serialized settings -> worker -> actual employee binding.
  -- Locks remain held through identity validation, original recovery and writes.
  if p_grant_id is null then
  perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  else
  perform public.faolla_attendance_delegated_rules_core_authorize_v1(site,p_auth_user_id,p_grant_id,'personal',jsonb_build_object('kind','personal','workerId',wid),p_command);
  end if;
  if p_command is null then select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  else select * into s from public.merchant_attendance_settings where merchant_id=site for update;end if;
  if not found then raise exception 'attendance_settings_required';end if;
  select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for share;
  if not found then raise exception 'attendance_worker_not_found';end if;
  if w.employee_id is not null then select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;end if;
  if s.version not between 1 and 9007199254740990 or w.version not between 1 and 9007199254740990
    or not public.faolla_attendance_valid_zone_v1(s.time_zone) or not public.faolla_attendance_group_text_v1(w.display_name,1,120)
    or not public.faolla_attendance_group_text_v1(w.worker_no,1,40) then raise exception 'attendance_personal_rule_invalid';end if;
  worker_item:=jsonb_build_object('workerId',w.id,'workerName',w.display_name,'workerNo',w.worker_no,'employeeId',w.employee_id,
    'employeeAuthUserId',e.auth_user_id,'version',w.version,'active',w.active,'employeeActive',coalesce(e.status='active',false));
  select * into stream from public.merchant_attendance_personal_rule_streams where merchant_id=site and worker_id=wid;
  if found then
    if stream.employee_id is distinct from w.employee_id or stream.employee_auth_user_id is distinct from e.auth_user_id then
      raise exception 'attendance_personal_rule_identity_changed';end if;
    current_rev:=stream.revision;perform public.faolla_attendance_personal_rule_stream_checked_v1(stream);
  end if;
  if op is not null then
    select * into existing from public.merchant_attendance_personal_rule_operations where merchant_id=site and operation_id=op;
    if existing.operation_id is not null then
      if existing.worker_id<>wid or existing.actor_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;
      if p_command is not null and existing.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
      if existing.revision>current_rev then raise exception 'attendance_personal_rule_invalid';end if;
      receipt:=public.faolla_attendance_personal_rule_receipt_v1(existing);
    end if;
  end if;

  -- Same-owner, same-identity original receipts precede new pause/activity/CAS
  -- eligibility. A rebound worker cannot recover another person's history.
  if p_command is not null and receipt is null then
    if not p_allow_write then raise exception 'attendance_platform_paused';end if;
    if (p_command->>'expectedRevision')::bigint<>current_rev then raise exception 'attendance_version_conflict';end if;
    new_rev:=current_rev+1;
    if action_name='approve' then
      if not w.active or e.id is null or e.status<>'active' or e.auth_user_id is null then raise exception 'attendance_personal_rule_worker_inactive';end if;
      if (p_command->>'employeeId')::uuid is distinct from w.employee_id or (p_command->>'employeeAuthUserId')::uuid is distinct from e.auth_user_id then
        raise exception 'attendance_personal_rule_identity_changed';end if;
      if (p_command->>'expectedWorkerVersion')::bigint<>w.version or (p_command->>'expectedSettingsVersion')::bigint<>s.version
        or p_command->>'timeZone'<>s.time_zone then raise exception 'attendance_version_conflict';end if;
      start_at:=public.faolla_attendance_rule_day_start_v1(p_command->>'startsOn',s.time_zone);
      end_at:=public.faolla_attendance_personal_rule_end_v1(p_command->>'endsOn',s.time_zone);
      if start_at is null or end_at is null or end_at<=start_at then raise exception 'attendance_invalid_request';end if;
      if exists(select 1 from public.merchant_attendance_personal_rule_operations approved where approved.merchant_id=site and approved.worker_id=wid and approved.action='approve'
        and approved.from_at<end_at and approved.to_at>start_at and not exists(select 1 from public.merchant_attendance_personal_rule_operations withdrawn
          where withdrawn.merchant_id=approved.merchant_id and withdrawn.worker_id=approved.worker_id and withdrawn.action='withdraw' and withdrawn.approved_revision=approved.revision)) then
        raise exception 'attendance_personal_rule_overlap';end if;
    else
      select * into target from public.merchant_attendance_personal_rule_operations where merchant_id=site and worker_id=wid and revision=(p_command->>'approvedRevision')::bigint and action='approve';
      if not found then raise exception 'attendance_not_available';end if;
      perform public.faolla_attendance_personal_rule_receipt_v1(target);
      if exists(select 1 from public.merchant_attendance_personal_rule_operations where merchant_id=site and worker_id=wid and action='withdraw' and approved_revision=target.revision) then
        raise exception 'attendance_personal_rule_already_withdrawn';end if;
    end if;
    -- Recheck with the wall clock AFTER waiting for all identity/settings locks.
    stamp:=clock_timestamp();
    if stream.updated_at is not null and stamp<stream.updated_at then raise exception 'attendance_personal_rule_invalid';end if;
    if action_name='approve' then
      today:=(stamp at time zone s.time_zone)::date;
      if today not between date '2000-01-01' and date '2100-12-31' or (p_command->>'startsOn')::date<=today or start_at<=stamp then
        raise exception 'attendance_personal_rule_future_required';end if;
      entry.employee_id:=w.employee_id;entry.employee_auth_user_id:=e.auth_user_id;entry.worker_version:=w.version;entry.settings_version:=s.version;
      entry.time_zone:=s.time_zone;entry.starts_on:=(p_command->>'startsOn')::date;entry.ends_on:=(p_command->>'endsOn')::date;
      entry.from_at:=start_at;entry.to_at:=end_at;entry.rules:=p_command->'rules';
    else
      if stamp>=target.from_at then raise exception 'attendance_personal_rule_future_required';end if;
      -- Withdrawal changes only the operation envelope; all original identity,
      -- versions, values and interval facts remain exactly the approved snapshot.
      entry.employee_id:=target.employee_id;entry.employee_auth_user_id:=target.employee_auth_user_id;
      entry.worker_version:=target.worker_version;entry.settings_version:=target.settings_version;entry.time_zone:=target.time_zone;
      entry.starts_on:=target.starts_on;entry.ends_on:=target.ends_on;entry.from_at:=target.from_at;entry.to_at:=target.to_at;
      entry.rules:=target.rules;entry.approved_revision:=target.revision;
    end if;
    entry.merchant_id:=site;entry.worker_id:=wid;entry.operation_id:=op;entry.revision:=new_rev;entry.action:=action_name;entry.actor_auth_user_id:=p_auth_user_id;
    entry.command:=p_command;entry.recorded_at:=stamp;entry.approved_action:='approve';entry.snapshot:=public.faolla_attendance_personal_rule_item_v1(entry);
    if current_rev=0 then
      insert into public.merchant_attendance_personal_rule_streams(merchant_id,worker_id,employee_id,employee_auth_user_id,revision,created_at,updated_at)
        values(site,wid,w.employee_id,e.auth_user_id,new_rev,stamp,stamp) returning * into stream;
    else
      update public.merchant_attendance_personal_rule_streams set revision=new_rev,updated_at=stamp where merchant_id=site and worker_id=wid returning * into stream;
    end if;
    insert into public.merchant_attendance_personal_rule_operations select entry.*;
    current_rev:=new_rev;perform public.faolla_attendance_personal_rule_stream_checked_v1(stream);receipt:=public.faolla_attendance_personal_rule_receipt_v1(entry);
  end if;

  for entry in select * from public.merchant_attendance_personal_rule_operations where merchant_id=site and worker_id=wid
    and (before_rev is null or revision<before_rev) order by revision desc limit 26 loop
    count_seen:=count_seen+1;exit when count_seen=26;
    perform public.faolla_attendance_personal_rule_receipt_v1(entry);withdrawn_by:=null;
    if entry.action='approve' then
      select * into withdrawal from public.merchant_attendance_personal_rule_operations where merchant_id=site and worker_id=wid and action='withdraw' and approved_revision=entry.revision;
      if found then perform public.faolla_attendance_personal_rule_receipt_v1(withdrawal);withdrawn_by:=withdrawal.revision;end if;
    end if;
    items:=items||jsonb_build_array(entry.snapshot||jsonb_build_object('withdrawnByRevision',withdrawn_by));next_before:=entry.revision;
  end loop;
  read_at:=clock_timestamp();
  if stream.updated_at is not null and read_at<stream.updated_at then raise exception 'attendance_personal_rule_invalid';end if;
  result:=jsonb_build_object('protocol','personal-rules-v1','siteId',site,'actorId',p_auth_user_id,'worker',worker_item,'settingsVersion',s.version,'timeZone',s.time_zone,
    'revision',current_rev,'items',items,'nextBeforeRevision',case when count_seen=26 then next_before else null end,'receipt',receipt,
    'readAt',to_char(read_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  if octet_length(result::text)>131072 then raise exception 'attendance_personal_rule_invalid';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_parameter_value then raise exception 'attendance_invalid_request';
end;
$$;
create or replace function public.faolla_attendance_delegated_rules_operational_core_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb,p_allow_write boolean,p_grant_id uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare site text;mode_name text;scope_value jsonb;key_value text;op uuid;action_name text;current_rev bigint:=0;at_rev bigint;before_rev bigint;next_rev bigint;
 h public.merchant_attendance_operational_rule_streams%rowtype;o public.merchant_attendance_operational_rule_operations%rowtype;draft_op public.merchant_attendance_operational_rule_operations%rowtype;
 target public.merchant_attendance_operational_rule_operations%rowtype;entry public.merchant_attendance_operational_rule_operations%rowtype;idx public.merchant_attendance_operational_rule_publications%rowtype;
 s public.merchant_attendance_settings%rowtype;m public.merchants%rowtype;w record;e record;
 info jsonb;refs jsonb;data_value jsonb;receipt_value jsonb;preview_value jsonb;current_value jsonb;next_value jsonb;draft_value jsonb;items jsonb:='[]';cursor_value jsonb;count_seen integer:=0;last_rev bigint;withdrawn bigint;
 stamp timestamptz;read_stamp timestamptz;can_write boolean:=false;tuple_value jsonb;fp text;v jsonb;catalog_name text;after_id uuid;last_id uuid;after_scope_key text;last_scope jsonb;
begin
 if p_auth_user_id is null or p_allow_write is null or p_query is null or octet_length(convert_to(p_query::text,'UTF8'))>8192
  or jsonb_typeof(p_query->'siteId') is distinct from 'string' or char_length(p_query->>'siteId')<>8 or coalesce(p_query->>'siteId','')!~'^[0-9]{8}$' then raise exception 'attendance_invalid_request';end if;
 site:=p_query->>'siteId';mode_name:=p_query->>'mode';scope_value:=p_query->'scope';
 if mode_name='recover' then
  if p_command is not null or public.faolla_attendance_operational_rule_object_v1(p_query,array['siteId','mode','operationId']) is distinct from true
   or public.faolla_attendance_operational_rule_scalar_v1(p_query->'operationId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;op:=(p_query->>'operationId')::uuid;
 elsif mode_name='catalog' then
  if p_command is not null then raise exception 'attendance_invalid_request';end if;catalog_name:=p_query->>'catalog';
  if catalog_name in('workers','routes') then
   if public.faolla_attendance_operational_rule_object_v1(p_query,array['siteId','mode','catalog','afterId']) is distinct from true
    or p_query->'afterId' is distinct from 'null'::jsonb and public.faolla_attendance_operational_rule_scalar_v1(p_query->'afterId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;after_id:=(p_query->>'afterId')::uuid;
  elsif catalog_name='saved_personal' then
   if public.faolla_attendance_operational_rule_object_v1(p_query,array['siteId','mode','catalog','afterScope']) is distinct from true then raise exception 'attendance_invalid_request';end if;
   if p_query->'afterScope' is distinct from 'null'::jsonb then
    if p_query->'afterScope'->>'kind' is distinct from 'personal' then raise exception 'attendance_invalid_request';end if;after_scope_key:=public.faolla_attendance_operational_rule_scope_v1(p_query->'afterScope')::text;
   end if;
  else raise exception 'attendance_invalid_request';end if;
 else
  key_value:=public.faolla_attendance_operational_rule_scope_v1(scope_value)::text;
  if mode_name='detail' then
   if public.faolla_attendance_operational_rule_object_v1(p_query,array['siteId','mode','scope']) is distinct from true then raise exception 'attendance_invalid_request';end if;
  elsif mode_name='history' then
   if p_command is not null or public.faolla_attendance_operational_rule_object_v1(p_query,array['siteId','mode','scope','cursor']) is distinct from true then raise exception 'attendance_invalid_request';end if;
   cursor_value:=p_query->'cursor';
   if cursor_value is distinct from 'null'::jsonb then
    if public.faolla_attendance_operational_rule_object_v1(cursor_value,array['siteId','scope','atRevision','beforeRevision']) is distinct from true
     or cursor_value->>'siteId' is distinct from site or cursor_value->'scope' is distinct from scope_value
     or public.faolla_attendance_operational_rule_scalar_v1(cursor_value->'atRevision','positive') is distinct from true
     or public.faolla_attendance_operational_rule_scalar_v1(cursor_value->'beforeRevision','positive') is distinct from true then raise exception 'attendance_invalid_request';end if;
    at_rev:=(cursor_value->>'atRevision')::bigint;before_rev:=(cursor_value->>'beforeRevision')::bigint;
    if before_rev<=1 or before_rev>at_rev then raise exception 'attendance_invalid_request';end if;
   end if;
  elsif mode_name='preview' then
   if p_command is not null or public.faolla_attendance_operational_rule_object_v1(p_query,array['siteId','mode','scope','sourceDraftRevision','effectiveOn','endsOn']) is distinct from true
    or public.faolla_attendance_operational_rule_scalar_v1(p_query->'sourceDraftRevision','positive') is distinct from true
    or jsonb_typeof(p_query->'effectiveOn') is distinct from 'string' or jsonb_typeof(p_query->'endsOn') not in('null','string') then raise exception 'attendance_invalid_request';end if;
  else raise exception 'attendance_invalid_request';end if;
 end if;
 if p_command is not null then
  tuple_value:=public.faolla_attendance_operational_rule_command_v1(p_command);
  if mode_name<>'detail' or p_command->>'siteId' is distinct from site or p_command->'scope' is distinct from scope_value then raise exception 'attendance_invalid_request';end if;
  op:=(p_command->>'operationId')::uuid;action_name:=p_command->>'action';
 end if;

 --Known-operation GET is deliberately independent of current ownership/binding.
 --It returns only this actual actor's minimal immutable receipt; no source read.
  if p_grant_id is null then
 select * into m from public.merchants x where x.id=site for share;
 if m.id is null or mode_name<>'recover' and m.user_id is distinct from p_auth_user_id then raise exception 'attendance_access_denied';end if;
  else
  if mode_name not in('detail','history','preview') then raise exception 'attendance_invalid_request';end if;
  select * into m from public.merchants x where x.id=site for share;
  perform public.faolla_attendance_delegated_rules_core_authorize_v1(site,p_auth_user_id,p_grant_id,'operational',scope_value,p_command);
  end if;
 if mode_name='recover' then
  select * into o from public.merchant_attendance_operational_rule_operations x where x.merchant_id=site and x.operation_id=op;
  if o.operation_id is not null then
   if o.actor_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;receipt_value:=public.faolla_attendance_operational_rule_receipt_v1(o);
  end if;data_value:=jsonb_build_object('kind','receipt');
 else
  if p_command is null then select * into s from public.merchant_attendance_settings x where x.merchant_id=site for share;
  else select * into s from public.merchant_attendance_settings x where x.merchant_id=site for update;end if;
  if s.merchant_id is null then raise exception 'attendance_settings_required';end if;
  if op is not null then
   select * into o from public.merchant_attendance_operational_rule_operations x where x.merchant_id=site and x.operation_id=op;
   if o.operation_id is not null then
    if o.actor_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;
    if o.scope is distinct from scope_value or o.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
    receipt_value:=public.faolla_attendance_operational_rule_receipt_v1(o);data_value:=jsonb_build_object('kind','receipt');
   end if;
  end if;
  if data_value is null and mode_name='catalog' then
   if catalog_name='workers' then
    for w in select x.id,x.display_name,e2.id employee_id,e2.auth_user_id from public.merchant_attendance_workers x
     join public.merchant_enterprise_employees e2 on e2.merchant_id=x.merchant_id and e2.id=x.employee_id
     where x.merchant_id=site and x.active and e2.status='active' and e2.auth_user_id is not null and (after_id is null or x.id>after_id) order by x.id limit 26 loop
     count_seen:=count_seen+1;exit when count_seen=26;
     if w.display_name is null or char_length(w.display_name) not between 1 and 120 or w.display_name~'[[:cntrl:]\u007f-\u009f]' then raise exception 'attendance_operational_rule_invalid';end if;
     items:=items||jsonb_build_array(jsonb_build_object('workerId',w.id,'workerName',w.display_name,'employeeId',w.employee_id,'employeeAuthUserId',w.auth_user_id));last_id:=w.id;
    end loop;
   elsif catalog_name='routes' then
    for e in select x.id,x.display_name,x.auth_user_id from public.merchant_enterprise_employees x where x.merchant_id=site and x.status='active' and x.auth_user_id is not null
     and (after_id is null or x.id>after_id) order by x.id limit 26 loop
     count_seen:=count_seen+1;exit when count_seen=26;
     if e.display_name is null or char_length(e.display_name) not between 1 and 120 or e.display_name~'[[:cntrl:]\u007f-\u009f]' then raise exception 'attendance_operational_rule_invalid';end if;
     items:=items||jsonb_build_array(jsonb_build_object('employeeId',e.id,'employeeName',e.display_name,'employeeAuthUserId',e.auth_user_id));last_id:=e.id;
    end loop;
   else
    for h in select x.* from public.merchant_attendance_operational_rule_streams x where x.merchant_id=site and x.scope->>'kind'='personal'
     and (after_scope_key is null or x.stream_key collate "C">after_scope_key collate "C") order by x.stream_key collate "C" limit 26 loop
     count_seen:=count_seen+1;exit when count_seen=26;perform public.faolla_attendance_operational_rule_check_v1(site,h.stream_key,h.revision);
     items:=items||jsonb_build_array(jsonb_build_object('scope',h.scope,'revision',h.revision,'updatedAt',to_char(h.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));last_scope:=h.scope;
    end loop;
   end if;
   data_value:=jsonb_build_object('kind','catalog','catalog',catalog_name,'items',items)||case when catalog_name='saved_personal' then jsonb_build_object('nextScope',case when count_seen=26 then last_scope else null end)
    else jsonb_build_object('nextId',case when count_seen=26 then last_id else null end) end;
  elsif data_value is null then
   select * into h from public.merchant_attendance_operational_rule_streams x where x.merchant_id=site and x.stream_key=key_value;
   if h.stream_key is not null then
    current_rev:=h.revision;perform public.faolla_attendance_operational_rule_check_v1(site,key_value,current_rev);
    if h.draft_revision is not null then
     select * into draft_op from public.merchant_attendance_operational_rule_operations x where x.merchant_id=site and x.stream_key=key_value and x.revision=h.draft_revision;
     if draft_op.action is distinct from 'save_draft' then raise exception 'attendance_operational_rule_invalid';end if;draft_value:=public.faolla_attendance_operational_rule_item_v1(draft_op);
    end if;
   end if;
   if p_command is not null then
    if (p_command->>'expectedRevision')::bigint<>current_rev then raise exception 'attendance_operational_rule_changed';end if;
    if current_rev>=9007199254740990 then raise exception 'attendance_operational_rule_limit';end if;next_rev:=current_rev+1;
    if action_name in('save_draft','publish') then
     if not p_allow_write then raise exception 'attendance_operational_rule_disabled';end if;
     info:=public.faolla_attendance_operational_rule_context_v1(site,scope_value);
     if info->'usable' is distinct from 'true'::jsonb then raise exception 'attendance_operational_rule_changed';end if;
     if action_name='save_draft' then
      if info->'context' is distinct from p_command->'expectedContext' then raise exception 'attendance_operational_rule_changed';end if;
      refs:=public.faolla_attendance_operational_rule_references_v1(site,scope_value,p_command->'rules',info->'subject');
     else
      if draft_value is null or h.draft_revision is distinct from (p_command->>'sourceDraftRevision')::bigint then raise exception 'attendance_operational_rule_changed';end if;
      preview_value:=public.faolla_attendance_operational_rule_preview_v1(site,scope_value,current_rev,draft_value,p_command->>'effectiveOn',p_command->>'endsOn');
      if preview_value->>'previewFingerprint' is distinct from p_command->>'previewFingerprint' then raise exception 'attendance_operational_rule_changed';end if;
      --Enterprise/group increasing starts; personal arbitrary non-overlapping
      --finite windows use only the two indexed neighbours, not all history.
      if scope_value->>'kind'='personal' then
       select * into idx from public.merchant_attendance_operational_rule_publications x where x.merchant_id=site and x.stream_key=key_value and x.withdrawn_revision is null and x.effective_at<=(preview_value->>'effectiveAt')::timestamptz order by x.effective_at desc,x.published_revision desc limit 1;
       if idx.operation_id is not null and idx.ends_at>(preview_value->>'effectiveAt')::timestamptz then raise exception 'attendance_operational_rule_overlap';end if;
       select * into idx from public.merchant_attendance_operational_rule_publications x where x.merchant_id=site and x.stream_key=key_value and x.withdrawn_revision is null and x.effective_at>=(preview_value->>'effectiveAt')::timestamptz order by x.effective_at,x.published_revision limit 1;
       if idx.operation_id is not null and idx.effective_at<(preview_value->>'endsAt')::timestamptz then raise exception 'attendance_operational_rule_overlap';end if;
      else
       select * into idx from public.merchant_attendance_operational_rule_publications x where x.merchant_id=site and x.stream_key=key_value and x.withdrawn_revision is null order by x.effective_at desc,x.published_revision desc limit 1;
       if idx.operation_id is not null and idx.effective_at>=(preview_value->>'effectiveAt')::timestamptz then raise exception 'attendance_operational_rule_overlap';end if;
      end if;
     end if;
    else
     select * into target from public.merchant_attendance_operational_rule_operations x where x.merchant_id=site and x.stream_key=key_value and x.revision=(p_command->>'publishedRevision')::bigint;
     if target.action is distinct from 'publish' then raise exception 'attendance_operational_rule_not_found';end if;perform public.faolla_attendance_operational_rule_check_v1(site,key_value,target.revision);
     select * into idx from public.merchant_attendance_operational_rule_publications x where x.merchant_id=site and x.stream_key=key_value and x.published_revision=target.revision;
     if idx.withdrawn_revision is not null then raise exception 'attendance_operational_rule_changed';end if;
    end if;
    stamp:=clock_timestamp();
    if h.updated_at is not null and stamp<h.updated_at then raise exception 'attendance_operational_rule_invalid';end if;
    if action_name='publish' and ((preview_value->>'effectiveAt')::timestamptz<=stamp or (preview_value->>'effectiveOn')::date<=(stamp at time zone (draft_value->'context'->>'timeZone'))::date)
     or action_name='withdraw' and stamp>=idx.effective_at then raise exception 'attendance_operational_rule_future_required';end if;
    fp:=public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-operational-rule-command-v1',p_auth_user_id::text,tuple_value));
    v:=jsonb_build_object('scope',scope_value,'operationId',op,'actorId',p_auth_user_id,'revision',next_rev,'action',action_name,'reason',p_command->>'reason',
     'recordedAt',to_char(stamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'commandFingerprint',fp);
    if action_name='save_draft' then
     v:=v||jsonb_build_object('context',info->'context','rules',p_command->'rules','references',refs,
      'rulesFingerprint',public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-operational-rule-values-v1',public.faolla_attendance_operational_rule_values_v1(p_command->'rules'))),
      'referenceFingerprint',public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-operational-rule-references-v1',site,public.faolla_attendance_operational_rule_scope_v1(scope_value),
       public.faolla_attendance_operational_rule_context_tuple_v1(info->'context',scope_value),public.faolla_attendance_operational_rule_references_tuple_v1(refs,scope_value,p_command->'rules'))));
    elsif action_name='publish' then
     v:=v||(preview_value-array['kind','scope','revision','applied'])||jsonb_build_object('rules',draft_value->'rules');
    else v:=v||jsonb_build_object('publishedRevision',target.revision);end if;
    entry.merchant_id:=site;entry.stream_key:=key_value;entry.scope:=scope_value;entry.operation_id:=op;entry.revision:=next_rev;entry.actor_auth_user_id:=p_auth_user_id;
    entry.action:=action_name;entry.command:=p_command;entry.command_fingerprint:=fp;entry.item:=v;entry.recorded_at:=stamp;
    entry.draft_revision_after:=case when action_name='save_draft' then next_rev when action_name='withdraw' then h.draft_revision else null end;
    perform public.faolla_attendance_operational_rule_item_v1(entry);
    insert into public.merchant_attendance_operational_rule_operations select entry.*;
    if h.stream_key is null then
     insert into public.merchant_attendance_operational_rule_streams(merchant_id,stream_key,scope,revision,draft_revision,created_at,updated_at) values(site,key_value,scope_value,next_rev,entry.draft_revision_after,stamp,stamp);
    else
     update public.merchant_attendance_operational_rule_streams set revision=next_rev,draft_revision=entry.draft_revision_after,updated_at=stamp where merchant_id=site and stream_key=key_value;
    end if;
    if action_name='publish' then
     insert into public.merchant_attendance_operational_rule_publications(merchant_id,stream_key,published_revision,operation_id,effective_at,ends_at) values(site,key_value,next_rev,op,(v->>'effectiveAt')::timestamptz,(v->>'endsAt')::timestamptz);
    elsif action_name='withdraw' then
     update public.merchant_attendance_operational_rule_publications set withdrawn_revision=next_rev where merchant_id=site and stream_key=key_value and published_revision=target.revision;
    end if;
    perform public.faolla_attendance_operational_rule_check_v1(site,key_value,next_rev);
    receipt_value:=public.faolla_attendance_operational_rule_receipt_v1(entry);data_value:=jsonb_build_object('kind','receipt');
   elsif mode_name='history' then
    if at_rev is null then at_rev:=current_rev;elsif at_rev>current_rev then raise exception 'attendance_invalid_request';end if;
    for entry in select x.* from public.merchant_attendance_operational_rule_operations x where x.merchant_id=site and x.stream_key=key_value and x.revision<=at_rev
     and (before_rev is null or x.revision<before_rev) order by x.revision desc limit 26 loop
     count_seen:=count_seen+1;exit when count_seen=26;
     if entry.revision is distinct from (case when count_seen=1 then least(at_rev,coalesce(before_rev-1,at_rev)) else last_rev-1 end) then raise exception 'attendance_operational_rule_invalid';end if;
     perform public.faolla_attendance_operational_rule_check_v1(site,key_value,entry.revision);withdrawn:=null;
     if entry.action='publish' then
      select x.withdrawn_revision into withdrawn from public.merchant_attendance_operational_rule_publications x where x.merchant_id=site and x.stream_key=key_value and x.published_revision=entry.revision;
      if withdrawn>at_rev then withdrawn:=null;end if;
     end if;
     items:=items||jsonb_build_array(jsonb_build_object('item',entry.item,'withdrawnByRevision',withdrawn));last_rev:=entry.revision;
    end loop;
    if count_seen<26 and (at_rev>0 and last_rev is distinct from 1) then raise exception 'attendance_operational_rule_invalid';end if;
    data_value:=jsonb_build_object('kind','history','scope',scope_value,'atRevision',at_rev,'items',items,'nextCursor',
     case when count_seen=26 then jsonb_build_object('siteId',site,'scope',scope_value,'atRevision',at_rev,'beforeRevision',last_rev) else null end);
   else
    info:=public.faolla_attendance_operational_rule_context_v1(site,scope_value);
    if h.stream_key is null and info->'context'='null'::jsonb then raise exception 'attendance_operational_rule_not_found';end if;
    can_write:=p_allow_write and info->'usable'='true'::jsonb and current_rev<9007199254740990;
    if mode_name='preview' then
     if not p_allow_write then raise exception 'attendance_operational_rule_disabled';end if;
     if draft_value is null or h.draft_revision is distinct from (p_query->>'sourceDraftRevision')::bigint then raise exception 'attendance_operational_rule_changed';end if;
     data_value:=public.faolla_attendance_operational_rule_preview_v1(site,scope_value,current_rev,draft_value,p_query->>'effectiveOn',p_query->>'endsOn');
    else
     read_stamp:=clock_timestamp();
     select * into idx from public.merchant_attendance_operational_rule_publications x where x.merchant_id=site and x.stream_key=key_value and x.withdrawn_revision is null and x.effective_at<=read_stamp order by x.effective_at desc,x.published_revision desc limit 1;
     if idx.operation_id is not null and (idx.ends_at is null or idx.ends_at>read_stamp) then
      perform public.faolla_attendance_operational_rule_check_v1(site,key_value,idx.published_revision);
      select x.item into current_value from public.merchant_attendance_operational_rule_operations x where x.merchant_id=site and x.operation_id=idx.operation_id;
     end if;
     select * into idx from public.merchant_attendance_operational_rule_publications x where x.merchant_id=site and x.stream_key=key_value and x.withdrawn_revision is null and x.effective_at>read_stamp order by x.effective_at,x.published_revision limit 1;
     if idx.operation_id is not null then
      perform public.faolla_attendance_operational_rule_check_v1(site,key_value,idx.published_revision);
      select x.item into next_value from public.merchant_attendance_operational_rule_operations x where x.merchant_id=site and x.operation_id=idx.operation_id;
     end if;
     data_value:=jsonb_build_object('kind','detail','scope',scope_value,'revision',current_rev,'context',info->'context','draft',draft_value,'currentPublication',current_value,'nextPublication',next_value,'canWithdraw',next_value is not null and current_rev<9007199254740990);
    end if;
   end if;
  end if;
 end if;
 read_stamp:=coalesce(read_stamp,clock_timestamp());
 v:=jsonb_build_object('protocol','attendance-operational-rule-ledger-v1','siteId',site,'actorId',p_auth_user_id,'readAt',to_char(read_stamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'canWrite',can_write,'data',data_value,'receipt',receipt_value);
 if octet_length(convert_to(v::text,'UTF8'))>262144 then raise exception 'attendance_operational_rule_too_large';end if;return v;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_parameter_value then raise exception 'attendance_invalid_request';
end;
$$;
--END GENERATED DELEGATED RULES CORES

create or replace function public.faolla_attendance_delegated_rules_business_v1(site text,op uuid,family text)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare b public.merchant_attendance_rule_operations%rowtype;p public.merchant_attendance_personal_rule_operations%rowtype;o public.merchant_attendance_operational_rule_operations%rowtype;
begin
 if family='base' then select * into b from public.merchant_attendance_rule_operations actual where actual.merchant_id=site and actual.operation_id=op;if b.operation_id is null then return null;end if;perform public.faolla_attendance_rule_receipt_v1(b);
  return to_jsonb(b)||jsonb_build_object('recorded_at',to_char(b.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'effective_at',to_char(b.effective_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 elsif family='personal' then select * into p from public.merchant_attendance_personal_rule_operations actual where actual.merchant_id=site and actual.operation_id=op;if p.operation_id is null then return null;end if;perform public.faolla_attendance_personal_rule_receipt_v1(p);
  return to_jsonb(p)||jsonb_build_object('recorded_at',to_char(p.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'from_at',to_char(p.from_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'to_at',to_char(p.to_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 elsif family='operational' then select * into o from public.merchant_attendance_operational_rule_operations actual where actual.merchant_id=site and actual.operation_id=op;if o.operation_id is null then return null;end if;perform public.faolla_attendance_operational_rule_item_v1(o);
  return to_jsonb(o)||jsonb_build_object('recorded_at',to_char(o.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 else raise exception 'attendance_delegated_rules_invalid';end if;
end;
$$;

create or replace function public.faolla_attendance_delegated_rules_operation_v1(p public.merchant_attendance_management_delegation_operations,p_current boolean)
returns void language plpgsql set search_path=pg_catalog as $$
declare g public.merchant_attendance_management_delegations%rowtype;b jsonb;c jsonb;family text;
begin
 select * into g from public.merchant_attendance_management_delegations actual where actual.merchant_id=p.merchant_id and actual.grant_id=p.grant_id;
 family:=g.scope->>'family';b:=public.faolla_attendance_delegated_rules_business_v1(p.merchant_id,p.operation_id,family);
 if p_current is null or g.grant_id is null or b is null then raise exception 'attendance_delegated_rules_invalid';end if;
 c:=jsonb_build_object('family',family,'decision',b->'command');perform public.faolla_attendance_delegated_rules_command_v1(c);
 if row(p.actor_auth_user_id,p.delegate_employee_id,p.delegate_generation,p.delegated_action,p.business_operation_id,p.business_reference_id,p.business_revision,p.recorded_at)
  is distinct from row(g.delegate_auth_user_id,g.delegate_employee_id,g.delegate_generation,public.faolla_attendance_delegated_rules_action_v1(family,b->>'action'),p.operation_id,p.operation_id,(b->>'revision')::bigint,(b->>'recorded_at')::timestamptz)
  or b->>'actor_auth_user_id' is distinct from p.actor_auth_user_id::text or g.delegated_action is distinct from p.delegated_action
  or p.business_revision<>(b->'command'->>'expectedRevision')::bigint+1 or not isfinite(p.recorded_at) or p.recorded_at<g.recorded_at
  or p.command_fingerprint is distinct from public.faolla_attendance_delegated_rules_hash_v1(p.merchant_id,p.actor_auth_user_id,p.grant_id,c)
  or p.business_fingerprint is distinct from public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-delegated-rules-business-v1',family,b))
  or exists(select 1 from public.merchant_attendance_management_delegations actual where actual.merchant_id=p.merchant_id and actual.grant_id=p.operation_id)
  or exists(select 1 from public.merchant_attendance_management_delegation_revocations actual where actual.merchant_id=p.merchant_id and actual.operation_id=p.operation_id) then raise exception 'attendance_delegated_rules_invalid';end if;
 if family='base' and b->>'stream_key' is distinct from coalesce(g.scope->'subject'->>'groupId','enterprise')
  or family='personal' and row(b->>'worker_id',b->>'employee_id',b->>'employee_auth_user_id') is distinct from row(g.worker_id::text,g.employee_id::text,g.employee_auth_user_id::text)
  or family='operational' and b->'scope' is distinct from g.scope->'subject' then raise exception 'attendance_delegated_rules_invalid';end if;
 --Saved proof uses immutable revision/time, never today's fallback/head.
 perform public.faolla_attendance_delegated_rules_effects_v1(g,b->'command',p.recorded_at,p.business_revision);
 if p_current then perform public.faolla_attendance_delegated_rules_authorize_v1(p.merchant_id,p.actor_auth_user_id,p.grant_id,family,b->>'action');end if;
end;
$$;

create or replace function public.faolla_attendance_delegated_rules_receipt_v1(site text,op uuid,actor uuid,id uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare p public.merchant_attendance_management_delegation_operations%rowtype;g public.merchant_attendance_management_delegations%rowtype;
begin
 if op is null then return null;end if;
 select * into p from public.merchant_attendance_management_delegation_operations actual where actual.merchant_id=site and actual.operation_id=op;
 if p.operation_id is null then return null;end if;
 if p.actor_auth_user_id is distinct from actor then raise exception 'attendance_access_denied';end if;
 if p.grant_id is distinct from id or p.delegated_action not in('rule_draft','rule_publish','rule_withdraw','personal_rule_approve','personal_rule_withdraw','operational_rule_draft','operational_rule_publish','operational_rule_withdraw') then raise exception 'attendance_operation_conflict';end if;
 perform public.faolla_attendance_delegated_rules_operation_v1(p,false);
 select * into g from public.merchant_attendance_management_delegations actual where actual.merchant_id=site and actual.grant_id=id;
 return jsonb_build_object('operationId',p.operation_id,'actorId',p.actor_auth_user_id,'grantId',p.grant_id,'family',g.scope->>'family','action',p.delegated_action,'referenceId',p.business_reference_id,
  'revision',p.business_revision,'commandFingerprint',p.command_fingerprint,'businessFingerprint',p.business_fingerprint,'recordedAt',to_char(p.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end;
$$;

create or replace function public.faolla_attendance_delegated_rules_authority_v1(p public.merchant_attendance_management_delegation_operations)
returns void language plpgsql set search_path=pg_catalog as $$
begin perform public.faolla_attendance_delegated_rules_operation_v1(p,true);end;
$$;

create or replace function public.faolla_attendance_delegated_rules_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;id uuid;op uuid;fp text;receipt jsonb;legacy jsonb;context jsonb;data jsonb;family text;subject jsonb;key_value text;d jsonb;
 g public.merchant_attendance_management_delegations%rowtype;entry public.merchant_attendance_management_delegation_operations%rowtype;
 b jsonb;record_value record;items jsonb:='[]';withdrawn bigint;revision_value bigint:=0;at_revision bigint;before_revision bigint;last_revision bigint;seen integer:=0;cursor_value jsonb;common jsonb;
begin
 perform public.faolla_attendance_delegated_rules_query_v1(p_query);site:=p_query->>'siteId';id:=(p_query->>'grantId')::uuid;
 if p_auth_user_id is null or p_allow_write is null or octet_length(convert_to(jsonb_build_object('query',p_query,'command',p_command)::text,'UTF8'))>49152 then raise exception 'attendance_invalid_request';end if;
 if p_query->>'mode'='recover' then if p_command is not null then raise exception 'attendance_invalid_request';end if;op:=(p_query->>'operationId')::uuid;
 elsif p_command is not null then
  if p_query->>'mode'<>'context' then raise exception 'attendance_invalid_request';end if;fp:=public.faolla_attendance_delegated_rules_hash_v1(site,p_auth_user_id,id,p_command);d:=p_command->'decision';op:=(d->>'operationId')::uuid;
 end if;
 receipt:=public.faolla_attendance_delegated_rules_receipt_v1(site,op,p_auth_user_id,id);
 if p_query->>'mode'='recover' or receipt is not null then
  if receipt is not null and fp is not null and receipt->>'commandFingerprint' is distinct from fp then raise exception 'attendance_operation_conflict';end if;
  return jsonb_build_object('protocol','attendance-delegated-rules-v1','siteId',site,'actorId',p_auth_user_id,'readAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'kind','receipt','receipt',receipt);
 end if;
 perform 1 from public.merchants actual where actual.id=site for share;if not found then raise exception 'attendance_access_denied';end if;
 perform 1 from public.merchant_attendance_settings actual where actual.merchant_id=site for update;if not found then raise exception 'attendance_settings_required';end if;
 receipt:=public.faolla_attendance_delegated_rules_receipt_v1(site,op,p_auth_user_id,id);
 if receipt is not null then
  if receipt->>'commandFingerprint' is distinct from fp then raise exception 'attendance_operation_conflict';end if;
  return jsonb_build_object('protocol','attendance-delegated-rules-v1','siteId',site,'actorId',p_auth_user_id,'readAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'kind','receipt','receipt',receipt);
 end if;
 if op is not null and (exists(select 1 from public.merchant_attendance_rule_operations actual where actual.merchant_id=site and actual.operation_id=op)
  or exists(select 1 from public.merchant_attendance_personal_rule_operations actual where actual.merchant_id=site and actual.operation_id=op)
  or exists(select 1 from public.merchant_attendance_operational_rule_operations actual where actual.merchant_id=site and actual.operation_id=op)
  or exists(select 1 from public.merchant_attendance_management_delegations actual where actual.merchant_id=site and actual.grant_id=op)
  or exists(select 1 from public.merchant_attendance_management_delegation_revocations actual where actual.merchant_id=site and actual.operation_id=op)) then raise exception 'attendance_operation_conflict';end if;
 if p_command is not null and not p_allow_write then raise exception 'attendance_delegated_rules_disabled';end if;
 g:=public.faolla_attendance_delegated_rules_authorize_v1(site,p_auth_user_id,id,p_command->>'family',d->>'action');family:=g.scope->>'family';subject:=g.scope->'subject';
 key_value:=case when family='operational' then public.faolla_attendance_operational_rule_scope_v1(subject)::text else coalesce(subject->>'groupId','enterprise') end;
 if p_command is not null then
  if family='operational' and (d->>'siteId' is distinct from site or d->'scope' is distinct from subject) then raise exception 'attendance_access_denied';end if;
  --The actual old core enforces its unchanged CAS first. The same-transaction
  --sidecar BEFORE guard then proves the full immutable before/after effect;
  --failure rolls back both original business rows and the sidecar atomically.
 end if;
 if family='base' then
  legacy:=public.faolla_attendance_delegated_rules_base_core_v1(jsonb_build_object('siteId',site,'groupId',subject->'groupId','operationId',null,'beforeRevision',null),p_auth_user_id,d,p_allow_write,id);
  revision_value:=(legacy->>'revision')::bigint;context:=jsonb_build_object('family',family,'revision',revision_value,'settingsVersion',legacy->'settingsVersion','timeZone',legacy->'timeZone','group',legacy->'group','draft',legacy->'draft');
 elsif family='personal' then
  legacy:=public.faolla_attendance_delegated_rules_personal_core_v1(jsonb_build_object('siteId',site,'workerId',g.worker_id,'operationId',null,'beforeRevision',null),p_auth_user_id,d,p_allow_write,id);
  revision_value:=(legacy->>'revision')::bigint;context:=jsonb_build_object('family',family,'revision',revision_value,'settingsVersion',legacy->'settingsVersion','timeZone',legacy->'timeZone','worker',legacy->'worker');
 else
  legacy:=public.faolla_attendance_delegated_rules_operational_core_v1(jsonb_build_object('siteId',site,'mode','detail','scope',subject),p_auth_user_id,d,p_allow_write,id);
  if d is null then revision_value:=(legacy->'data'->>'revision')::bigint;context:=jsonb_build_object('family',family,'detail',legacy->'data');end if;
 end if;
 if p_command is not null then
  b:=public.faolla_attendance_delegated_rules_business_v1(site,op,family);if b is null then raise exception 'attendance_delegated_rules_invalid';end if;
  insert into public.merchant_attendance_management_delegation_operations(merchant_id,operation_id,grant_id,actor_auth_user_id,delegate_employee_id,delegate_generation,delegated_action,business_operation_id,business_reference_id,business_revision,business_fingerprint,command_fingerprint,recorded_at)
   values(site,op,id,p_auth_user_id,g.delegate_employee_id,g.delegate_generation,g.delegated_action,op,op,(b->>'revision')::bigint,public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-delegated-rules-business-v1',family,b)),fp,(b->>'recorded_at')::timestamptz) returning * into entry;
  receipt:=public.faolla_attendance_delegated_rules_receipt_v1(site,op,p_auth_user_id,id);data:=jsonb_build_object('kind','receipt','receipt',receipt);
 elsif p_query->>'mode'='context' then
  if family in('base','operational') then context:=context||public.faolla_attendance_delegated_rules_baseline_v1(site,family,subject,clock_timestamp(),revision_value+1);end if;
  data:=jsonb_build_object('kind','context','grantId',id,'action',g.delegated_action,'scope',g.scope,'context',context);
 elsif p_query->>'mode'='preview' then
  if family<>'operational' or g.delegated_action<>'operational_rule_publish' then raise exception 'attendance_access_denied';end if;
  legacy:=public.faolla_attendance_delegated_rules_operational_core_v1(jsonb_build_object('siteId',site,'mode','preview','scope',subject,'sourceDraftRevision',p_query->'sourceDraftRevision','effectiveOn',p_query->'effectiveOn','endsOn',p_query->'endsOn'),p_auth_user_id,null,p_allow_write,id);
  data:=jsonb_build_object('kind','preview','grantId',id,'action',g.delegated_action,'scope',g.scope,'preview',legacy->'data');
 else
  cursor_value:=p_query->'cursor';at_revision:=case when cursor_value='null'::jsonb then revision_value else (cursor_value->>'atRevision')::bigint end;before_revision:=(cursor_value->>'beforeRevision')::bigint;
  if at_revision>revision_value then raise exception 'attendance_invalid_request';end if;
  for record_value in
   (select actual.revision,actual.snapshot item,actual.action,actual.published_revision ref from public.merchant_attendance_rule_operations actual where family='base' and actual.merchant_id=site and actual.stream_key=key_value and actual.revision<=at_revision and (before_revision is null or actual.revision<before_revision) order by actual.revision desc limit 26)
   union all (select actual.revision,actual.snapshot,actual.action,actual.approved_revision from public.merchant_attendance_personal_rule_operations actual where family='personal' and actual.merchant_id=site and actual.worker_id=g.worker_id and actual.revision<=at_revision and (before_revision is null or actual.revision<before_revision) order by actual.revision desc limit 26)
   union all (select actual.revision,actual.item,actual.action,(actual.item->>'publishedRevision')::bigint from public.merchant_attendance_operational_rule_operations actual where family='operational' and actual.merchant_id=site and actual.stream_key=key_value and actual.revision<=at_revision and (before_revision is null or actual.revision<before_revision) order by actual.revision desc limit 26)
   order by revision desc limit 26 loop
   seen:=seen+1;exit when seen=26;
   if record_value.revision is distinct from (case when seen=1 then least(at_revision,coalesce(before_revision-1,at_revision)) else last_revision-1 end) then raise exception 'attendance_delegated_rules_invalid';end if;
   if family='base' then perform public.faolla_attendance_delegated_rules_business_v1(site,(record_value.item->>'operationId')::uuid,family);
    select actual.revision into withdrawn from public.merchant_attendance_rule_operations actual where actual.merchant_id=site and actual.stream_key=key_value and actual.action='withdraw' and actual.published_revision=record_value.revision and actual.revision<=at_revision;
   elsif family='personal' then perform public.faolla_attendance_delegated_rules_business_v1(site,(record_value.item->>'operationId')::uuid,family);
    select actual.revision into withdrawn from public.merchant_attendance_personal_rule_operations actual where actual.merchant_id=site and actual.worker_id=g.worker_id and actual.action='withdraw' and actual.approved_revision=record_value.revision and actual.revision<=at_revision;
   else perform public.faolla_attendance_delegated_rules_business_v1(site,(record_value.item->>'operationId')::uuid,family);
    select actual.withdrawn_revision into withdrawn from public.merchant_attendance_operational_rule_publications actual where actual.merchant_id=site and actual.stream_key=key_value and actual.published_revision=record_value.revision and actual.withdrawn_revision<=at_revision;
   end if;
   items:=items||jsonb_build_array(jsonb_build_object('item',record_value.item,'withdrawnByRevision',withdrawn));last_revision:=record_value.revision;withdrawn:=null;
  end loop;
  if seen<26 and at_revision>0 and last_revision is distinct from 1 then raise exception 'attendance_delegated_rules_invalid';end if;
  data:=jsonb_build_object('kind','history','grantId',id,'action',g.delegated_action,'scope',g.scope,'atRevision',at_revision,'items',items,'nextCursor',case when seen=26 then jsonb_build_object('siteId',site,'grantId',id,'atRevision',at_revision,'beforeRevision',last_revision) else null end);
 end if;
 common:=jsonb_build_object('protocol','attendance-delegated-rules-v1','siteId',site,'actorId',p_auth_user_id,'readAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))||data;
 if octet_length(convert_to(common::text,'UTF8'))>262144 then raise exception 'attendance_delegated_rules_too_large';end if;return common;
end;
$$;

--BEGIN GENERATED DELEGATED RULES FORWARD
do $rules206_forward_0$ declare old_body text;definition text;begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610080206 and name='merchant_attendance_delegated_rules') then return;end if;
 select replace(proc.prosrc,E'\r\n',E'\n'),pg_get_functiondef(proc.oid) into old_body,definition from pg_proc proc where proc.oid='public.faolla_attendance_rules_v1(jsonb,uuid,jsonb,boolean)'::regprocedure;
 if old_body is distinct from $rules206_old_0$
declare site text;key text;gid uuid;op uuid;before_rev bigint;k text;action_name text;current_rev bigint:=0;new_rev bigint;
  s public.merchant_attendance_settings%rowtype;g public.merchant_attendance_groups%rowtype;stream public.merchant_attendance_rule_streams%rowtype;
  existing public.merchant_attendance_rule_operations%rowtype;entry public.merchant_attendance_rule_operations%rowtype;
  saved public.merchant_attendance_rule_operations%rowtype;target public.merchant_attendance_rule_operations%rowtype;withdrawal public.merchant_attendance_rule_operations%rowtype;
  group_item jsonb;draft_item jsonb;receipt jsonb;items jsonb:='[]';result jsonb;stamp timestamptz;boundary timestamptz;today date;
  count_seen integer:=0;next_before bigint;withdrawn_by bigint;
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_auth_user_id is null or p_allow_write is null or p_query is null or jsonb_typeof(p_query)<>'object' then raise exception 'attendance_invalid_request';end if;
  if (select count(*) from jsonb_object_keys(p_query))<>4 or not(p_query ?& array['siteId','groupId','operationId','beforeRevision'])
    or jsonb_typeof(p_query->'siteId')<>'string' or coalesce(p_query->>'siteId','') !~ '^\d{8}$' then raise exception 'attendance_invalid_request';end if;
  foreach k in array array['groupId','operationId'] loop
    if p_query->k<>'null'::jsonb and (jsonb_typeof(p_query->k)<>'string' or coalesce(p_query->>k,'') !~ uuid_pattern) then raise exception 'attendance_invalid_request';end if;
  end loop;
  if p_query->'beforeRevision'<>'null'::jsonb and (jsonb_typeof(p_query->'beforeRevision')<>'number'
    or coalesce(p_query->>'beforeRevision','') !~ '^[1-9][0-9]{0,15}$' or (p_query->>'beforeRevision')::numeric>9007199254740990) then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';gid:=(p_query->>'groupId')::uuid;key:=coalesce(gid::text,'enterprise');op:=(p_query->>'operationId')::uuid;before_rev:=(p_query->>'beforeRevision')::bigint;
  if op is not null and before_rev is not null then raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
    if op is not null or before_rev is not null or not public.faolla_attendance_rule_command_v1(p_command) then raise exception 'attendance_invalid_request';end if;
    if p_command->>'action'<>'withdraw' and ((gid is null)<>(p_command->'expectedGroupRevision'='null'::jsonb)) then raise exception 'attendance_invalid_request';end if;
    op:=(p_command->>'operationId')::uuid;action_name:=p_command->>'action';
  end if;

  -- Reauthorize under the same lock order as owner configuration and group124.
  perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  if p_command is null then select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  else select * into s from public.merchant_attendance_settings where merchant_id=site for update;end if;
  if not found then raise exception 'attendance_settings_required';end if;
  if s.version not between 1 and 9007199254740990 or not public.faolla_attendance_valid_zone_v1(s.time_zone) then raise exception 'attendance_rule_invalid';end if;
  if gid is not null then
    select * into g from public.merchant_attendance_groups where merchant_id=site and group_id=gid for share;
    if not found then raise exception 'attendance_group_not_found';end if;
    perform public.faolla_attendance_group_checked_v1(g);
    group_item:=jsonb_build_object('groupId',g.group_id,'revision',g.revision,'name',g.name,'active',g.active);
  end if;
  select * into stream from public.merchant_attendance_rule_streams where merchant_id=site and stream_key=key;
  if found then current_rev:=stream.revision;draft_item:=public.faolla_attendance_rule_stream_checked_v1(stream);end if;
  if op is not null then
    select * into existing from public.merchant_attendance_rule_operations where merchant_id=site and operation_id=op;
    if existing.operation_id is not null then
      if existing.stream_key<>key or existing.actor_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;
      if p_command is not null and existing.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
      if existing.revision>current_rev then raise exception 'attendance_rule_invalid';end if;
      receipt:=public.faolla_attendance_rule_receipt_v1(existing);
    end if;
  end if;

  -- Pause/activity/context/CAS eligibility applies only to a NEW operation.
  -- An exact original command remains confirmable by the CURRENT owner.
  if p_command is not null and receipt is null then
    if not p_allow_write then raise exception 'attendance_platform_paused';end if;
    if (p_command->>'expectedRevision')::bigint<>current_rev then raise exception 'attendance_version_conflict';end if;
    new_rev:=current_rev+1;
    if action_name in('save_draft','publish') then
      if gid is not null and not g.active then raise exception 'attendance_rule_group_inactive';end if;
      if (p_command->>'expectedSettingsVersion')::bigint<>s.version or (p_command->>'expectedGroupRevision')::bigint is distinct from g.revision
        or p_command->>'timeZone'<>s.time_zone then raise exception 'attendance_version_conflict';end if;
      if action_name='publish' then
        if stream.draft_revision is null then raise exception 'attendance_rule_draft_required';end if;
        select * into saved from public.merchant_attendance_rule_operations where merchant_id=site and stream_key=key and revision=stream.draft_revision;
        if saved.settings_version<>s.version or saved.group_revision is distinct from g.revision or saved.time_zone<>s.time_zone then raise exception 'attendance_version_conflict';end if;
        boundary:=public.faolla_attendance_rule_day_start_v1(p_command->>'effectiveOn',s.time_zone);
        if boundary is null then raise exception 'attendance_rule_future_required';end if;
        if exists(select 1 from public.merchant_attendance_rule_operations pub where pub.merchant_id=site and pub.stream_key=key and pub.action='publish'
          and pub.effective_at>=boundary and not exists(select 1 from public.merchant_attendance_rule_operations wd
            where wd.merchant_id=pub.merchant_id and wd.stream_key=pub.stream_key and wd.action='withdraw' and wd.published_revision=pub.revision)) then
          raise exception 'attendance_rule_order_conflict';end if;
      end if;
    else
      select * into target from public.merchant_attendance_rule_operations where merchant_id=site and stream_key=key and revision=(p_command->>'publishedRevision')::bigint and action='publish';
      if not found then raise exception 'attendance_not_available';end if;
      perform public.faolla_attendance_rule_receipt_v1(target);
      if exists(select 1 from public.merchant_attendance_rule_operations where merchant_id=site and stream_key=key and action='withdraw' and published_revision=target.revision) then
        raise exception 'attendance_rule_already_withdrawn';end if;
    end if;
    -- Never use transaction-start now(): settings/group locks can have waited.
    stamp:=clock_timestamp();
    if stream.updated_at is not null and stamp<stream.updated_at then raise exception 'attendance_rule_invalid';end if;
    if action_name='publish' then
      today:=(stamp at time zone s.time_zone)::date;
      if today not between date '2000-01-01' and date '2100-12-31' or (p_command->>'effectiveOn')::date<=today or boundary<=stamp then raise exception 'attendance_rule_future_required';end if;
    elsif action_name='withdraw' and stamp>=target.effective_at then raise exception 'attendance_rule_future_required';end if;

    entry.merchant_id:=site;entry.stream_key:=key;entry.operation_id:=op;entry.revision:=new_rev;entry.action:=action_name;entry.actor_auth_user_id:=p_auth_user_id;
    entry.command:=p_command;entry.recorded_at:=stamp;entry.draft_action:='save_draft';entry.published_action:='publish';
    if action_name in('save_draft','publish') then
      entry.settings_version:=s.version;entry.group_revision:=g.revision;entry.time_zone:=s.time_zone;
      if action_name='save_draft' then entry.rules:=p_command->'rules';entry.draft_revision_after:=new_rev;
      else entry.rules:=saved.rules;entry.effective_on:=(p_command->>'effectiveOn')::date;entry.effective_at:=boundary;entry.source_draft_revision:=saved.revision;end if;
    else entry.published_revision:=target.revision;entry.draft_revision_after:=stream.draft_revision;end if;
    entry.snapshot:=public.faolla_attendance_rule_item_v1(entry);
    if current_rev=0 then
      insert into public.merchant_attendance_rule_streams(merchant_id,stream_key,group_id,revision,draft_revision,created_at,updated_at)
        values(site,key,gid,new_rev,entry.draft_revision_after,stamp,stamp) returning * into stream;
    else
      update public.merchant_attendance_rule_streams set revision=new_rev,draft_revision=entry.draft_revision_after,updated_at=stamp
        where merchant_id=site and stream_key=key returning * into stream;
    end if;
    insert into public.merchant_attendance_rule_operations select entry.*;
    current_rev:=new_rev;draft_item:=public.faolla_attendance_rule_stream_checked_v1(stream);receipt:=public.faolla_attendance_rule_receipt_v1(entry);
  end if;

  for entry in select * from public.merchant_attendance_rule_operations where merchant_id=site and stream_key=key
    and (before_rev is null or revision<before_rev) order by revision desc limit 26 loop
    count_seen:=count_seen+1;exit when count_seen=26;
    perform public.faolla_attendance_rule_receipt_v1(entry);withdrawn_by:=null;
    if entry.action='publish' then
      select * into withdrawal from public.merchant_attendance_rule_operations where merchant_id=site and stream_key=key and action='withdraw' and published_revision=entry.revision;
      if found then perform public.faolla_attendance_rule_receipt_v1(withdrawal);withdrawn_by:=withdrawal.revision;end if;
    end if;
    items:=items||jsonb_build_array(entry.snapshot||jsonb_build_object('withdrawnByRevision',withdrawn_by));next_before:=entry.revision;
  end loop;
  result:=jsonb_build_object('protocol','rules-v1','siteId',site,'actorId',p_auth_user_id,'group',group_item,'settingsVersion',s.version,'timeZone',s.time_zone,
    'revision',current_rev,'draft',draft_item,'items',items,'nextBeforeRevision',case when count_seen=26 then next_before else null end,'receipt',receipt);
  if octet_length(result::text)>131072 then raise exception 'attendance_rule_invalid';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_parameter_value then raise exception 'attendance_invalid_request';
end;
$rules206_old_0$ or position(old_body in definition)=0 then raise exception 'merchant_attendance_delegated_rules_forward_drift';end if;
 execute replace(definition,old_body,$rules206_new_0$
begin
 return public.faolla_attendance_delegated_rules_base_core_v1(p_query,p_auth_user_id,p_command,p_allow_write,null);
end;
$rules206_new_0$);
 end;$rules206_forward_0$;
do $rules206_forward_1$ declare old_body text;definition text;begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610080206 and name='merchant_attendance_delegated_rules') then return;end if;
 select replace(proc.prosrc,E'\r\n',E'\n'),pg_get_functiondef(proc.oid) into old_body,definition from pg_proc proc where proc.oid='public.faolla_attendance_personal_rules_v1(jsonb,uuid,jsonb,boolean)'::regprocedure;
 if old_body is distinct from $rules206_old_1$
declare site text;wid uuid;op uuid;before_rev bigint;action_name text;current_rev bigint:=0;new_rev bigint;
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
  stream public.merchant_attendance_personal_rule_streams%rowtype;existing public.merchant_attendance_personal_rule_operations%rowtype;
  entry public.merchant_attendance_personal_rule_operations%rowtype;target public.merchant_attendance_personal_rule_operations%rowtype;
  withdrawal public.merchant_attendance_personal_rule_operations%rowtype;
  worker_item jsonb;receipt jsonb;items jsonb:='[]';result jsonb;stamp timestamptz;read_at timestamptz;start_at timestamptz;end_at timestamptz;today date;
  count_seen integer:=0;next_before bigint;withdrawn_by bigint;
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_auth_user_id is null or p_allow_write is null or p_query is null or jsonb_typeof(p_query)<>'object' then raise exception 'attendance_invalid_request';end if;
  if (select count(*) from jsonb_object_keys(p_query))<>4 or not(p_query ?& array['siteId','workerId','operationId','beforeRevision'])
    or jsonb_typeof(p_query->'siteId')<>'string' or coalesce(p_query->>'siteId','') !~ '^\d{8}$'
    or jsonb_typeof(p_query->'workerId')<>'string' or coalesce(p_query->>'workerId','') !~ uuid_pattern
    or p_query->'operationId'<>'null'::jsonb and (jsonb_typeof(p_query->'operationId')<>'string' or coalesce(p_query->>'operationId','') !~ uuid_pattern)
    or p_query->'beforeRevision'<>'null'::jsonb and (jsonb_typeof(p_query->'beforeRevision')<>'number'
      or coalesce(p_query->>'beforeRevision','') !~ '^[1-9][0-9]{0,15}$' or (p_query->>'beforeRevision')::numeric>9007199254740990) then
    raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';wid:=(p_query->>'workerId')::uuid;op:=(p_query->>'operationId')::uuid;before_rev:=(p_query->>'beforeRevision')::bigint;
  if op is not null and before_rev is not null then raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
    if op is not null or before_rev is not null or not public.faolla_attendance_personal_rule_command_v1(p_command) then raise exception 'attendance_invalid_request';end if;
    op:=(p_command->>'operationId')::uuid;action_name:=p_command->>'action';
  end if;

  -- Current owner -> serialized settings -> worker -> actual employee binding.
  -- Locks remain held through identity validation, original recovery and writes.
  perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  if p_command is null then select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  else select * into s from public.merchant_attendance_settings where merchant_id=site for update;end if;
  if not found then raise exception 'attendance_settings_required';end if;
  select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for share;
  if not found then raise exception 'attendance_worker_not_found';end if;
  if w.employee_id is not null then select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;end if;
  if s.version not between 1 and 9007199254740990 or w.version not between 1 and 9007199254740990
    or not public.faolla_attendance_valid_zone_v1(s.time_zone) or not public.faolla_attendance_group_text_v1(w.display_name,1,120)
    or not public.faolla_attendance_group_text_v1(w.worker_no,1,40) then raise exception 'attendance_personal_rule_invalid';end if;
  worker_item:=jsonb_build_object('workerId',w.id,'workerName',w.display_name,'workerNo',w.worker_no,'employeeId',w.employee_id,
    'employeeAuthUserId',e.auth_user_id,'version',w.version,'active',w.active,'employeeActive',coalesce(e.status='active',false));
  select * into stream from public.merchant_attendance_personal_rule_streams where merchant_id=site and worker_id=wid;
  if found then
    if stream.employee_id is distinct from w.employee_id or stream.employee_auth_user_id is distinct from e.auth_user_id then
      raise exception 'attendance_personal_rule_identity_changed';end if;
    current_rev:=stream.revision;perform public.faolla_attendance_personal_rule_stream_checked_v1(stream);
  end if;
  if op is not null then
    select * into existing from public.merchant_attendance_personal_rule_operations where merchant_id=site and operation_id=op;
    if existing.operation_id is not null then
      if existing.worker_id<>wid or existing.actor_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;
      if p_command is not null and existing.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
      if existing.revision>current_rev then raise exception 'attendance_personal_rule_invalid';end if;
      receipt:=public.faolla_attendance_personal_rule_receipt_v1(existing);
    end if;
  end if;

  -- Same-owner, same-identity original receipts precede new pause/activity/CAS
  -- eligibility. A rebound worker cannot recover another person's history.
  if p_command is not null and receipt is null then
    if not p_allow_write then raise exception 'attendance_platform_paused';end if;
    if (p_command->>'expectedRevision')::bigint<>current_rev then raise exception 'attendance_version_conflict';end if;
    new_rev:=current_rev+1;
    if action_name='approve' then
      if not w.active or e.id is null or e.status<>'active' or e.auth_user_id is null then raise exception 'attendance_personal_rule_worker_inactive';end if;
      if (p_command->>'employeeId')::uuid is distinct from w.employee_id or (p_command->>'employeeAuthUserId')::uuid is distinct from e.auth_user_id then
        raise exception 'attendance_personal_rule_identity_changed';end if;
      if (p_command->>'expectedWorkerVersion')::bigint<>w.version or (p_command->>'expectedSettingsVersion')::bigint<>s.version
        or p_command->>'timeZone'<>s.time_zone then raise exception 'attendance_version_conflict';end if;
      start_at:=public.faolla_attendance_rule_day_start_v1(p_command->>'startsOn',s.time_zone);
      end_at:=public.faolla_attendance_personal_rule_end_v1(p_command->>'endsOn',s.time_zone);
      if start_at is null or end_at is null or end_at<=start_at then raise exception 'attendance_invalid_request';end if;
      if exists(select 1 from public.merchant_attendance_personal_rule_operations approved where approved.merchant_id=site and approved.worker_id=wid and approved.action='approve'
        and approved.from_at<end_at and approved.to_at>start_at and not exists(select 1 from public.merchant_attendance_personal_rule_operations withdrawn
          where withdrawn.merchant_id=approved.merchant_id and withdrawn.worker_id=approved.worker_id and withdrawn.action='withdraw' and withdrawn.approved_revision=approved.revision)) then
        raise exception 'attendance_personal_rule_overlap';end if;
    else
      select * into target from public.merchant_attendance_personal_rule_operations where merchant_id=site and worker_id=wid and revision=(p_command->>'approvedRevision')::bigint and action='approve';
      if not found then raise exception 'attendance_not_available';end if;
      perform public.faolla_attendance_personal_rule_receipt_v1(target);
      if exists(select 1 from public.merchant_attendance_personal_rule_operations where merchant_id=site and worker_id=wid and action='withdraw' and approved_revision=target.revision) then
        raise exception 'attendance_personal_rule_already_withdrawn';end if;
    end if;
    -- Recheck with the wall clock AFTER waiting for all identity/settings locks.
    stamp:=clock_timestamp();
    if stream.updated_at is not null and stamp<stream.updated_at then raise exception 'attendance_personal_rule_invalid';end if;
    if action_name='approve' then
      today:=(stamp at time zone s.time_zone)::date;
      if today not between date '2000-01-01' and date '2100-12-31' or (p_command->>'startsOn')::date<=today or start_at<=stamp then
        raise exception 'attendance_personal_rule_future_required';end if;
      entry.employee_id:=w.employee_id;entry.employee_auth_user_id:=e.auth_user_id;entry.worker_version:=w.version;entry.settings_version:=s.version;
      entry.time_zone:=s.time_zone;entry.starts_on:=(p_command->>'startsOn')::date;entry.ends_on:=(p_command->>'endsOn')::date;
      entry.from_at:=start_at;entry.to_at:=end_at;entry.rules:=p_command->'rules';
    else
      if stamp>=target.from_at then raise exception 'attendance_personal_rule_future_required';end if;
      -- Withdrawal changes only the operation envelope; all original identity,
      -- versions, values and interval facts remain exactly the approved snapshot.
      entry.employee_id:=target.employee_id;entry.employee_auth_user_id:=target.employee_auth_user_id;
      entry.worker_version:=target.worker_version;entry.settings_version:=target.settings_version;entry.time_zone:=target.time_zone;
      entry.starts_on:=target.starts_on;entry.ends_on:=target.ends_on;entry.from_at:=target.from_at;entry.to_at:=target.to_at;
      entry.rules:=target.rules;entry.approved_revision:=target.revision;
    end if;
    entry.merchant_id:=site;entry.worker_id:=wid;entry.operation_id:=op;entry.revision:=new_rev;entry.action:=action_name;entry.actor_auth_user_id:=p_auth_user_id;
    entry.command:=p_command;entry.recorded_at:=stamp;entry.approved_action:='approve';entry.snapshot:=public.faolla_attendance_personal_rule_item_v1(entry);
    if current_rev=0 then
      insert into public.merchant_attendance_personal_rule_streams(merchant_id,worker_id,employee_id,employee_auth_user_id,revision,created_at,updated_at)
        values(site,wid,w.employee_id,e.auth_user_id,new_rev,stamp,stamp) returning * into stream;
    else
      update public.merchant_attendance_personal_rule_streams set revision=new_rev,updated_at=stamp where merchant_id=site and worker_id=wid returning * into stream;
    end if;
    insert into public.merchant_attendance_personal_rule_operations select entry.*;
    current_rev:=new_rev;perform public.faolla_attendance_personal_rule_stream_checked_v1(stream);receipt:=public.faolla_attendance_personal_rule_receipt_v1(entry);
  end if;

  for entry in select * from public.merchant_attendance_personal_rule_operations where merchant_id=site and worker_id=wid
    and (before_rev is null or revision<before_rev) order by revision desc limit 26 loop
    count_seen:=count_seen+1;exit when count_seen=26;
    perform public.faolla_attendance_personal_rule_receipt_v1(entry);withdrawn_by:=null;
    if entry.action='approve' then
      select * into withdrawal from public.merchant_attendance_personal_rule_operations where merchant_id=site and worker_id=wid and action='withdraw' and approved_revision=entry.revision;
      if found then perform public.faolla_attendance_personal_rule_receipt_v1(withdrawal);withdrawn_by:=withdrawal.revision;end if;
    end if;
    items:=items||jsonb_build_array(entry.snapshot||jsonb_build_object('withdrawnByRevision',withdrawn_by));next_before:=entry.revision;
  end loop;
  read_at:=clock_timestamp();
  if stream.updated_at is not null and read_at<stream.updated_at then raise exception 'attendance_personal_rule_invalid';end if;
  result:=jsonb_build_object('protocol','personal-rules-v1','siteId',site,'actorId',p_auth_user_id,'worker',worker_item,'settingsVersion',s.version,'timeZone',s.time_zone,
    'revision',current_rev,'items',items,'nextBeforeRevision',case when count_seen=26 then next_before else null end,'receipt',receipt,
    'readAt',to_char(read_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  if octet_length(result::text)>131072 then raise exception 'attendance_personal_rule_invalid';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_parameter_value then raise exception 'attendance_invalid_request';
end;
$rules206_old_1$ or position(old_body in definition)=0 then raise exception 'merchant_attendance_delegated_rules_forward_drift';end if;
 execute replace(definition,old_body,$rules206_new_1$
begin
 return public.faolla_attendance_delegated_rules_personal_core_v1(p_query,p_auth_user_id,p_command,p_allow_write,null);
end;
$rules206_new_1$);
 end;$rules206_forward_1$;
do $rules206_forward_2$ declare old_body text;definition text;begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610080206 and name='merchant_attendance_delegated_rules') then return;end if;
 select replace(proc.prosrc,E'\r\n',E'\n'),pg_get_functiondef(proc.oid) into old_body,definition from pg_proc proc where proc.oid='public.faolla_attendance_operational_rules_v1(jsonb,uuid,jsonb,boolean)'::regprocedure;
 if old_body is distinct from $rules206_old_2$
declare site text;mode_name text;scope_value jsonb;key_value text;op uuid;action_name text;current_rev bigint:=0;at_rev bigint;before_rev bigint;next_rev bigint;
 h public.merchant_attendance_operational_rule_streams%rowtype;o public.merchant_attendance_operational_rule_operations%rowtype;draft_op public.merchant_attendance_operational_rule_operations%rowtype;
 target public.merchant_attendance_operational_rule_operations%rowtype;entry public.merchant_attendance_operational_rule_operations%rowtype;idx public.merchant_attendance_operational_rule_publications%rowtype;
 s public.merchant_attendance_settings%rowtype;m public.merchants%rowtype;w record;e record;
 info jsonb;refs jsonb;data_value jsonb;receipt_value jsonb;preview_value jsonb;current_value jsonb;next_value jsonb;draft_value jsonb;items jsonb:='[]';cursor_value jsonb;count_seen integer:=0;last_rev bigint;withdrawn bigint;
 stamp timestamptz;read_stamp timestamptz;can_write boolean:=false;tuple_value jsonb;fp text;v jsonb;catalog_name text;after_id uuid;last_id uuid;after_scope_key text;last_scope jsonb;
begin
 if p_auth_user_id is null or p_allow_write is null or p_query is null or octet_length(convert_to(p_query::text,'UTF8'))>8192
  or jsonb_typeof(p_query->'siteId') is distinct from 'string' or char_length(p_query->>'siteId')<>8 or coalesce(p_query->>'siteId','')!~'^[0-9]{8}$' then raise exception 'attendance_invalid_request';end if;
 site:=p_query->>'siteId';mode_name:=p_query->>'mode';scope_value:=p_query->'scope';
 if mode_name='recover' then
  if p_command is not null or public.faolla_attendance_operational_rule_object_v1(p_query,array['siteId','mode','operationId']) is distinct from true
   or public.faolla_attendance_operational_rule_scalar_v1(p_query->'operationId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;op:=(p_query->>'operationId')::uuid;
 elsif mode_name='catalog' then
  if p_command is not null then raise exception 'attendance_invalid_request';end if;catalog_name:=p_query->>'catalog';
  if catalog_name in('workers','routes') then
   if public.faolla_attendance_operational_rule_object_v1(p_query,array['siteId','mode','catalog','afterId']) is distinct from true
    or p_query->'afterId' is distinct from 'null'::jsonb and public.faolla_attendance_operational_rule_scalar_v1(p_query->'afterId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;after_id:=(p_query->>'afterId')::uuid;
  elsif catalog_name='saved_personal' then
   if public.faolla_attendance_operational_rule_object_v1(p_query,array['siteId','mode','catalog','afterScope']) is distinct from true then raise exception 'attendance_invalid_request';end if;
   if p_query->'afterScope' is distinct from 'null'::jsonb then
    if p_query->'afterScope'->>'kind' is distinct from 'personal' then raise exception 'attendance_invalid_request';end if;after_scope_key:=public.faolla_attendance_operational_rule_scope_v1(p_query->'afterScope')::text;
   end if;
  else raise exception 'attendance_invalid_request';end if;
 else
  key_value:=public.faolla_attendance_operational_rule_scope_v1(scope_value)::text;
  if mode_name='detail' then
   if public.faolla_attendance_operational_rule_object_v1(p_query,array['siteId','mode','scope']) is distinct from true then raise exception 'attendance_invalid_request';end if;
  elsif mode_name='history' then
   if p_command is not null or public.faolla_attendance_operational_rule_object_v1(p_query,array['siteId','mode','scope','cursor']) is distinct from true then raise exception 'attendance_invalid_request';end if;
   cursor_value:=p_query->'cursor';
   if cursor_value is distinct from 'null'::jsonb then
    if public.faolla_attendance_operational_rule_object_v1(cursor_value,array['siteId','scope','atRevision','beforeRevision']) is distinct from true
     or cursor_value->>'siteId' is distinct from site or cursor_value->'scope' is distinct from scope_value
     or public.faolla_attendance_operational_rule_scalar_v1(cursor_value->'atRevision','positive') is distinct from true
     or public.faolla_attendance_operational_rule_scalar_v1(cursor_value->'beforeRevision','positive') is distinct from true then raise exception 'attendance_invalid_request';end if;
    at_rev:=(cursor_value->>'atRevision')::bigint;before_rev:=(cursor_value->>'beforeRevision')::bigint;
    if before_rev<=1 or before_rev>at_rev then raise exception 'attendance_invalid_request';end if;
   end if;
  elsif mode_name='preview' then
   if p_command is not null or public.faolla_attendance_operational_rule_object_v1(p_query,array['siteId','mode','scope','sourceDraftRevision','effectiveOn','endsOn']) is distinct from true
    or public.faolla_attendance_operational_rule_scalar_v1(p_query->'sourceDraftRevision','positive') is distinct from true
    or jsonb_typeof(p_query->'effectiveOn') is distinct from 'string' or jsonb_typeof(p_query->'endsOn') not in('null','string') then raise exception 'attendance_invalid_request';end if;
  else raise exception 'attendance_invalid_request';end if;
 end if;
 if p_command is not null then
  tuple_value:=public.faolla_attendance_operational_rule_command_v1(p_command);
  if mode_name<>'detail' or p_command->>'siteId' is distinct from site or p_command->'scope' is distinct from scope_value then raise exception 'attendance_invalid_request';end if;
  op:=(p_command->>'operationId')::uuid;action_name:=p_command->>'action';
 end if;

 --Known-operation GET is deliberately independent of current ownership/binding.
 --It returns only this actual actor's minimal immutable receipt; no source read.
 select * into m from public.merchants x where x.id=site for share;
 if m.id is null or mode_name<>'recover' and m.user_id is distinct from p_auth_user_id then raise exception 'attendance_access_denied';end if;
 if mode_name='recover' then
  select * into o from public.merchant_attendance_operational_rule_operations x where x.merchant_id=site and x.operation_id=op;
  if o.operation_id is not null then
   if o.actor_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;receipt_value:=public.faolla_attendance_operational_rule_receipt_v1(o);
  end if;data_value:=jsonb_build_object('kind','receipt');
 else
  if p_command is null then select * into s from public.merchant_attendance_settings x where x.merchant_id=site for share;
  else select * into s from public.merchant_attendance_settings x where x.merchant_id=site for update;end if;
  if s.merchant_id is null then raise exception 'attendance_settings_required';end if;
  if op is not null then
   select * into o from public.merchant_attendance_operational_rule_operations x where x.merchant_id=site and x.operation_id=op;
   if o.operation_id is not null then
    if o.actor_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;
    if o.scope is distinct from scope_value or o.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
    receipt_value:=public.faolla_attendance_operational_rule_receipt_v1(o);data_value:=jsonb_build_object('kind','receipt');
   end if;
  end if;
  if data_value is null and mode_name='catalog' then
   if catalog_name='workers' then
    for w in select x.id,x.display_name,e2.id employee_id,e2.auth_user_id from public.merchant_attendance_workers x
     join public.merchant_enterprise_employees e2 on e2.merchant_id=x.merchant_id and e2.id=x.employee_id
     where x.merchant_id=site and x.active and e2.status='active' and e2.auth_user_id is not null and (after_id is null or x.id>after_id) order by x.id limit 26 loop
     count_seen:=count_seen+1;exit when count_seen=26;
     if w.display_name is null or char_length(w.display_name) not between 1 and 120 or w.display_name~'[[:cntrl:]\u007f-\u009f]' then raise exception 'attendance_operational_rule_invalid';end if;
     items:=items||jsonb_build_array(jsonb_build_object('workerId',w.id,'workerName',w.display_name,'employeeId',w.employee_id,'employeeAuthUserId',w.auth_user_id));last_id:=w.id;
    end loop;
   elsif catalog_name='routes' then
    for e in select x.id,x.display_name,x.auth_user_id from public.merchant_enterprise_employees x where x.merchant_id=site and x.status='active' and x.auth_user_id is not null
     and (after_id is null or x.id>after_id) order by x.id limit 26 loop
     count_seen:=count_seen+1;exit when count_seen=26;
     if e.display_name is null or char_length(e.display_name) not between 1 and 120 or e.display_name~'[[:cntrl:]\u007f-\u009f]' then raise exception 'attendance_operational_rule_invalid';end if;
     items:=items||jsonb_build_array(jsonb_build_object('employeeId',e.id,'employeeName',e.display_name,'employeeAuthUserId',e.auth_user_id));last_id:=e.id;
    end loop;
   else
    for h in select x.* from public.merchant_attendance_operational_rule_streams x where x.merchant_id=site and x.scope->>'kind'='personal'
     and (after_scope_key is null or x.stream_key collate "C">after_scope_key collate "C") order by x.stream_key collate "C" limit 26 loop
     count_seen:=count_seen+1;exit when count_seen=26;perform public.faolla_attendance_operational_rule_check_v1(site,h.stream_key,h.revision);
     items:=items||jsonb_build_array(jsonb_build_object('scope',h.scope,'revision',h.revision,'updatedAt',to_char(h.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));last_scope:=h.scope;
    end loop;
   end if;
   data_value:=jsonb_build_object('kind','catalog','catalog',catalog_name,'items',items)||case when catalog_name='saved_personal' then jsonb_build_object('nextScope',case when count_seen=26 then last_scope else null end)
    else jsonb_build_object('nextId',case when count_seen=26 then last_id else null end) end;
  elsif data_value is null then
   select * into h from public.merchant_attendance_operational_rule_streams x where x.merchant_id=site and x.stream_key=key_value;
   if h.stream_key is not null then
    current_rev:=h.revision;perform public.faolla_attendance_operational_rule_check_v1(site,key_value,current_rev);
    if h.draft_revision is not null then
     select * into draft_op from public.merchant_attendance_operational_rule_operations x where x.merchant_id=site and x.stream_key=key_value and x.revision=h.draft_revision;
     if draft_op.action is distinct from 'save_draft' then raise exception 'attendance_operational_rule_invalid';end if;draft_value:=public.faolla_attendance_operational_rule_item_v1(draft_op);
    end if;
   end if;
   if p_command is not null then
    if (p_command->>'expectedRevision')::bigint<>current_rev then raise exception 'attendance_operational_rule_changed';end if;
    if current_rev>=9007199254740990 then raise exception 'attendance_operational_rule_limit';end if;next_rev:=current_rev+1;
    if action_name in('save_draft','publish') then
     if not p_allow_write then raise exception 'attendance_operational_rule_disabled';end if;
     info:=public.faolla_attendance_operational_rule_context_v1(site,scope_value);
     if info->'usable' is distinct from 'true'::jsonb then raise exception 'attendance_operational_rule_changed';end if;
     if action_name='save_draft' then
      if info->'context' is distinct from p_command->'expectedContext' then raise exception 'attendance_operational_rule_changed';end if;
      refs:=public.faolla_attendance_operational_rule_references_v1(site,scope_value,p_command->'rules',info->'subject');
     else
      if draft_value is null or h.draft_revision is distinct from (p_command->>'sourceDraftRevision')::bigint then raise exception 'attendance_operational_rule_changed';end if;
      preview_value:=public.faolla_attendance_operational_rule_preview_v1(site,scope_value,current_rev,draft_value,p_command->>'effectiveOn',p_command->>'endsOn');
      if preview_value->>'previewFingerprint' is distinct from p_command->>'previewFingerprint' then raise exception 'attendance_operational_rule_changed';end if;
      --Enterprise/group increasing starts; personal arbitrary non-overlapping
      --finite windows use only the two indexed neighbours, not all history.
      if scope_value->>'kind'='personal' then
       select * into idx from public.merchant_attendance_operational_rule_publications x where x.merchant_id=site and x.stream_key=key_value and x.withdrawn_revision is null and x.effective_at<=(preview_value->>'effectiveAt')::timestamptz order by x.effective_at desc,x.published_revision desc limit 1;
       if idx.operation_id is not null and idx.ends_at>(preview_value->>'effectiveAt')::timestamptz then raise exception 'attendance_operational_rule_overlap';end if;
       select * into idx from public.merchant_attendance_operational_rule_publications x where x.merchant_id=site and x.stream_key=key_value and x.withdrawn_revision is null and x.effective_at>=(preview_value->>'effectiveAt')::timestamptz order by x.effective_at,x.published_revision limit 1;
       if idx.operation_id is not null and idx.effective_at<(preview_value->>'endsAt')::timestamptz then raise exception 'attendance_operational_rule_overlap';end if;
      else
       select * into idx from public.merchant_attendance_operational_rule_publications x where x.merchant_id=site and x.stream_key=key_value and x.withdrawn_revision is null order by x.effective_at desc,x.published_revision desc limit 1;
       if idx.operation_id is not null and idx.effective_at>=(preview_value->>'effectiveAt')::timestamptz then raise exception 'attendance_operational_rule_overlap';end if;
      end if;
     end if;
    else
     select * into target from public.merchant_attendance_operational_rule_operations x where x.merchant_id=site and x.stream_key=key_value and x.revision=(p_command->>'publishedRevision')::bigint;
     if target.action is distinct from 'publish' then raise exception 'attendance_operational_rule_not_found';end if;perform public.faolla_attendance_operational_rule_check_v1(site,key_value,target.revision);
     select * into idx from public.merchant_attendance_operational_rule_publications x where x.merchant_id=site and x.stream_key=key_value and x.published_revision=target.revision;
     if idx.withdrawn_revision is not null then raise exception 'attendance_operational_rule_changed';end if;
    end if;
    stamp:=clock_timestamp();
    if h.updated_at is not null and stamp<h.updated_at then raise exception 'attendance_operational_rule_invalid';end if;
    if action_name='publish' and ((preview_value->>'effectiveAt')::timestamptz<=stamp or (preview_value->>'effectiveOn')::date<=(stamp at time zone (draft_value->'context'->>'timeZone'))::date)
     or action_name='withdraw' and stamp>=idx.effective_at then raise exception 'attendance_operational_rule_future_required';end if;
    fp:=public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-operational-rule-command-v1',p_auth_user_id::text,tuple_value));
    v:=jsonb_build_object('scope',scope_value,'operationId',op,'actorId',p_auth_user_id,'revision',next_rev,'action',action_name,'reason',p_command->>'reason',
     'recordedAt',to_char(stamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'commandFingerprint',fp);
    if action_name='save_draft' then
     v:=v||jsonb_build_object('context',info->'context','rules',p_command->'rules','references',refs,
      'rulesFingerprint',public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-operational-rule-values-v1',public.faolla_attendance_operational_rule_values_v1(p_command->'rules'))),
      'referenceFingerprint',public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-operational-rule-references-v1',site,public.faolla_attendance_operational_rule_scope_v1(scope_value),
       public.faolla_attendance_operational_rule_context_tuple_v1(info->'context',scope_value),public.faolla_attendance_operational_rule_references_tuple_v1(refs,scope_value,p_command->'rules'))));
    elsif action_name='publish' then
     v:=v||(preview_value-array['kind','scope','revision','applied'])||jsonb_build_object('rules',draft_value->'rules');
    else v:=v||jsonb_build_object('publishedRevision',target.revision);end if;
    entry.merchant_id:=site;entry.stream_key:=key_value;entry.scope:=scope_value;entry.operation_id:=op;entry.revision:=next_rev;entry.actor_auth_user_id:=p_auth_user_id;
    entry.action:=action_name;entry.command:=p_command;entry.command_fingerprint:=fp;entry.item:=v;entry.recorded_at:=stamp;
    entry.draft_revision_after:=case when action_name='save_draft' then next_rev when action_name='withdraw' then h.draft_revision else null end;
    perform public.faolla_attendance_operational_rule_item_v1(entry);
    insert into public.merchant_attendance_operational_rule_operations select entry.*;
    if h.stream_key is null then
     insert into public.merchant_attendance_operational_rule_streams(merchant_id,stream_key,scope,revision,draft_revision,created_at,updated_at) values(site,key_value,scope_value,next_rev,entry.draft_revision_after,stamp,stamp);
    else
     update public.merchant_attendance_operational_rule_streams set revision=next_rev,draft_revision=entry.draft_revision_after,updated_at=stamp where merchant_id=site and stream_key=key_value;
    end if;
    if action_name='publish' then
     insert into public.merchant_attendance_operational_rule_publications(merchant_id,stream_key,published_revision,operation_id,effective_at,ends_at) values(site,key_value,next_rev,op,(v->>'effectiveAt')::timestamptz,(v->>'endsAt')::timestamptz);
    elsif action_name='withdraw' then
     update public.merchant_attendance_operational_rule_publications set withdrawn_revision=next_rev where merchant_id=site and stream_key=key_value and published_revision=target.revision;
    end if;
    perform public.faolla_attendance_operational_rule_check_v1(site,key_value,next_rev);
    receipt_value:=public.faolla_attendance_operational_rule_receipt_v1(entry);data_value:=jsonb_build_object('kind','receipt');
   elsif mode_name='history' then
    if at_rev is null then at_rev:=current_rev;elsif at_rev>current_rev then raise exception 'attendance_invalid_request';end if;
    for entry in select x.* from public.merchant_attendance_operational_rule_operations x where x.merchant_id=site and x.stream_key=key_value and x.revision<=at_rev
     and (before_rev is null or x.revision<before_rev) order by x.revision desc limit 26 loop
     count_seen:=count_seen+1;exit when count_seen=26;
     if entry.revision is distinct from (case when count_seen=1 then least(at_rev,coalesce(before_rev-1,at_rev)) else last_rev-1 end) then raise exception 'attendance_operational_rule_invalid';end if;
     perform public.faolla_attendance_operational_rule_check_v1(site,key_value,entry.revision);withdrawn:=null;
     if entry.action='publish' then
      select x.withdrawn_revision into withdrawn from public.merchant_attendance_operational_rule_publications x where x.merchant_id=site and x.stream_key=key_value and x.published_revision=entry.revision;
      if withdrawn>at_rev then withdrawn:=null;end if;
     end if;
     items:=items||jsonb_build_array(jsonb_build_object('item',entry.item,'withdrawnByRevision',withdrawn));last_rev:=entry.revision;
    end loop;
    if count_seen<26 and (at_rev>0 and last_rev is distinct from 1) then raise exception 'attendance_operational_rule_invalid';end if;
    data_value:=jsonb_build_object('kind','history','scope',scope_value,'atRevision',at_rev,'items',items,'nextCursor',
     case when count_seen=26 then jsonb_build_object('siteId',site,'scope',scope_value,'atRevision',at_rev,'beforeRevision',last_rev) else null end);
   else
    info:=public.faolla_attendance_operational_rule_context_v1(site,scope_value);
    if h.stream_key is null and info->'context'='null'::jsonb then raise exception 'attendance_operational_rule_not_found';end if;
    can_write:=p_allow_write and info->'usable'='true'::jsonb and current_rev<9007199254740990;
    if mode_name='preview' then
     if not p_allow_write then raise exception 'attendance_operational_rule_disabled';end if;
     if draft_value is null or h.draft_revision is distinct from (p_query->>'sourceDraftRevision')::bigint then raise exception 'attendance_operational_rule_changed';end if;
     data_value:=public.faolla_attendance_operational_rule_preview_v1(site,scope_value,current_rev,draft_value,p_query->>'effectiveOn',p_query->>'endsOn');
    else
     read_stamp:=clock_timestamp();
     select * into idx from public.merchant_attendance_operational_rule_publications x where x.merchant_id=site and x.stream_key=key_value and x.withdrawn_revision is null and x.effective_at<=read_stamp order by x.effective_at desc,x.published_revision desc limit 1;
     if idx.operation_id is not null and (idx.ends_at is null or idx.ends_at>read_stamp) then
      perform public.faolla_attendance_operational_rule_check_v1(site,key_value,idx.published_revision);
      select x.item into current_value from public.merchant_attendance_operational_rule_operations x where x.merchant_id=site and x.operation_id=idx.operation_id;
     end if;
     select * into idx from public.merchant_attendance_operational_rule_publications x where x.merchant_id=site and x.stream_key=key_value and x.withdrawn_revision is null and x.effective_at>read_stamp order by x.effective_at,x.published_revision limit 1;
     if idx.operation_id is not null then
      perform public.faolla_attendance_operational_rule_check_v1(site,key_value,idx.published_revision);
      select x.item into next_value from public.merchant_attendance_operational_rule_operations x where x.merchant_id=site and x.operation_id=idx.operation_id;
     end if;
     data_value:=jsonb_build_object('kind','detail','scope',scope_value,'revision',current_rev,'context',info->'context','draft',draft_value,'currentPublication',current_value,'nextPublication',next_value,'canWithdraw',next_value is not null and current_rev<9007199254740990);
    end if;
   end if;
  end if;
 end if;
 read_stamp:=coalesce(read_stamp,clock_timestamp());
 v:=jsonb_build_object('protocol','attendance-operational-rule-ledger-v1','siteId',site,'actorId',p_auth_user_id,'readAt',to_char(read_stamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'canWrite',can_write,'data',data_value,'receipt',receipt_value);
 if octet_length(convert_to(v::text,'UTF8'))>262144 then raise exception 'attendance_operational_rule_too_large';end if;return v;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_parameter_value then raise exception 'attendance_invalid_request';
end;
$rules206_old_2$ or position(old_body in definition)=0 then raise exception 'merchant_attendance_delegated_rules_forward_drift';end if;
 execute replace(definition,old_body,$rules206_new_2$
begin
 return public.faolla_attendance_delegated_rules_operational_core_v1(p_query,p_auth_user_id,p_command,p_allow_write,null);
end;
$rules206_new_2$);
 end;$rules206_forward_2$;
do $rules206_forward_3$ declare old_body text;definition text;begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610080206 and name='merchant_attendance_delegated_rules') then return;end if;
 select replace(proc.prosrc,E'\r\n',E'\n'),pg_get_functiondef(proc.oid) into old_body,definition from pg_proc proc where proc.oid='public.faolla_attendance_management_insert_v1()'::regprocedure;
 if old_body is distinct from $rules206_old_3$
declare context jsonb;g public.merchant_attendance_management_delegations%rowtype;stamp timestamptz;
begin
 if tg_table_name='merchant_attendance_management_delegation_operations' then
  if new.delegated_action='audit_export' then perform public.faolla_attendance_management_audit_authority_v1(new);return new;end if;
  if new.delegated_action in('group_save','group_assign','group_end','group_cancel') then perform public.faolla_attendance_delegated_groups_authority_v1(new);return new;end if;
  if new.delegated_action in('worker_save','location_save') then perform public.faolla_attendance_delegated_config_authority_v1(new);return new;end if;
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
$rules206_old_3$ or position(old_body in definition)=0 then raise exception 'merchant_attendance_delegated_rules_forward_drift';end if;
 execute replace(definition,old_body,$rules206_new_3$
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
$rules206_new_3$);
 end;$rules206_forward_3$;
--END GENERATED DELEGATED RULES FORWARD
insert into public.faolla_schema_migrations(version,name) values(202610080206,'merchant_attendance_delegated_rules') on conflict(version) do nothing;
--BEGIN GENERATED DELEGATED RULES POSTCONDITIONS
revoke all on function public.faolla_attendance_delegated_rules_query_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_rules_action_v1(text,text) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_rules_defaults_v1(text) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_rules_command_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_rules_hash_v1(text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_rules_authorize_v1(text,uuid,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_rules_core_authorize_v1(text,uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_rules_at_v1(text,text,jsonb,timestamptz,bigint,bigint) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_rules_baseline_v1(text,text,jsonb,timestamptz,bigint) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_rules_choices_v1(public.merchant_attendance_management_delegations,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_rules_effects_v1(public.merchant_attendance_management_delegations,jsonb,timestamptz,bigint) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_rules_base_core_v1(jsonb,uuid,jsonb,boolean,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_rules_personal_core_v1(jsonb,uuid,jsonb,boolean,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_rules_operational_core_v1(jsonb,uuid,jsonb,boolean,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_rules_business_v1(text,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_rules_operation_v1(public.merchant_attendance_management_delegation_operations,boolean) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_rules_receipt_v1(text,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_rules_authority_v1(public.merchant_attendance_management_delegation_operations) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_rules_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_delegated_rules_v1(jsonb,uuid,jsonb,boolean) to service_role;
 do $rules206_postconditions$ declare ns text;expected_owner oid;installed boolean;has190 boolean;spec jsonb;forward_spec jsonb;own_spec jsonb;f regprocedure;meta record;actual_table regclass;expected_table regclass;foreign_table regclass;table_name text;constraint_spec record;actual_constraint record;index_spec record;actual_index record;trigger_spec record;reference_keys smallint[]; begin select namespace.nspname,catalog_table.relowner into ns,expected_owner from pg_class catalog_table join pg_namespace namespace on namespace.oid=catalog_table.relnamespace where catalog_table.oid='public.merchant_attendance_settings'::regclass;
 if expected_owner is distinct from (select oid from pg_roles where rolname=current_user) then raise exception 'merchant_attendance_delegated_rules_owner_conflict';end if;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080206 and name='merchant_attendance_delegated_rules');
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');own_spec:=$rules206_dependencies$[{"name":"faolla_attendance_rule_values_v1","signature":"public.faolla_attendance_rule_values_v1(jsonb)","hash":"28d5094d4449869591c121c3780626220a7be7606cd02800b5d233378f8fb26b","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_rule_day_start_v1","signature":"public.faolla_attendance_rule_day_start_v1(text,text)","hash":"5aa3bbe223feed69419c53e22f1d77783b45f8bcae461c3d7d20d340a01faaf1","result":"timestamptz","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p","z"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_rule_command_v1","signature":"public.faolla_attendance_rule_command_v1(jsonb)","hash":"4e5bd54a168a51d660ce6365feee7ba994f9109e277f9b1532d1c5ae0bab5db6","result":"boolean","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_rule_item_v1","signature":"public.faolla_attendance_rule_item_v1(public.merchant_attendance_rule_operations)","hash":"09ac740476c817095c683248ee53e0c88de038b1350545985a6b61aa84b101f0","result":"jsonb","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_rule_receipt_v1","signature":"public.faolla_attendance_rule_receipt_v1(public.merchant_attendance_rule_operations)","hash":"26a72d561dff1ddd6dd88e1a5979b6005825e915d8ddbabc195589497f4f822e","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_rule_stream_checked_v1","signature":"public.faolla_attendance_rule_stream_checked_v1(public.merchant_attendance_rule_streams)","hash":"fbf190acb1b3816a37a1717fe681f02508d84fe829ef3003b9739baf15d9230a","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_personal_rule_end_v1","signature":"public.faolla_attendance_personal_rule_end_v1(text,text)","hash":"db3c640e28878a9ac45f16e0af49df6bd0549169f7af6f5b317159d553f8bd25","result":"timestamptz","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p","z"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_personal_rule_command_v1","signature":"public.faolla_attendance_personal_rule_command_v1(jsonb)","hash":"3dd5dad6a4aa3e796949e80b63f69eb743b1fc6aa695fc9b72ec43ba3e46b578","result":"boolean","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_personal_rule_item_v1","signature":"public.faolla_attendance_personal_rule_item_v1(public.merchant_attendance_personal_rule_operations)","hash":"f69ab41588a105384e01592649b78d261953b857ae4d493a3b3e8bbc6d175647","result":"jsonb","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_personal_rule_receipt_v1","signature":"public.faolla_attendance_personal_rule_receipt_v1(public.merchant_attendance_personal_rule_operations)","hash":"ee6db3bc3016929898335d0c839d9b31f3ba142b6a10aecbb0723e6a1ea95278","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_personal_rule_stream_checked_v1","signature":"public.faolla_attendance_personal_rule_stream_checked_v1(public.merchant_attendance_personal_rule_streams)","hash":"985bfa7add5e33fc6048c4f59f81f561bddcc93ed976dfcb6ea2c4f74dedb4ca","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_object_v1","signature":"public.faolla_attendance_operational_rule_object_v1(jsonb,text[])","hash":"c2424b9408e816d4f5aee7b271d4e91ea6faf10c7643a940223a1d3896e56ca7","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","ks"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_scalar_v1","signature":"public.faolla_attendance_operational_rule_scalar_v1(jsonb,text)","hash":"99d575e267fe9ec7b8f56dbe92ac412405913695ae3a3085dc1a035c33614fce","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","k"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_scope_v1","signature":"public.faolla_attendance_operational_rule_scope_v1(jsonb)","hash":"9e323d5672d38255e4f92bc2b0d5f0dd4e6190cbe04b7773bc80e40618f57275","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_context_tuple_v1","signature":"public.faolla_attendance_operational_rule_context_tuple_v1(jsonb,jsonb)","hash":"e0bc60a2402351503edb4ea94cd1791b95644c3f098af0aaefeac253c8264179","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p","s"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_values_v1","signature":"public.faolla_attendance_operational_rule_values_v1(jsonb)","hash":"ff59e8fceee61f8a60694614de50200e48f3e51ffb3d355e73d8f18f22af012b","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_command_v1","signature":"public.faolla_attendance_operational_rule_command_v1(jsonb)","hash":"ba2f97fd74fac4343a513b6edf5c9faa34f44c89108908e7e411759b4fa6b5f1","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_hash_v1","signature":"public.faolla_attendance_operational_rule_hash_v1(jsonb)","hash":"fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_context_v1","signature":"public.faolla_attendance_operational_rule_context_v1(text,jsonb)","hash":"0ffee88bfc9457553cdf5c17caeac906833d5fba986275facd2bb38fcedfdee3","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_scope"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_references_v1","signature":"public.faolla_attendance_operational_rule_references_v1(text,jsonb,jsonb,jsonb)","hash":"68ca4f0221d201560dde8ec88f9552e1423364dfdf717cfb1a9ea09882237dd5","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_scope","p_rules","p_subject"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_references_tuple_v1","signature":"public.faolla_attendance_operational_rule_references_tuple_v1(jsonb,jsonb,jsonb)","hash":"642dd54d586411b6ac0aa435ad0ad53630eb2a5ed7a74d0559248bf942795a26","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p","s","r"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_item_v1","signature":"public.faolla_attendance_operational_rule_item_v1(public.merchant_attendance_operational_rule_operations)","hash":"6fbb4c8e283366e526e208fae0b53dc41110161bdfd99e0af196a050c2448396","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_receipt_v1","signature":"public.faolla_attendance_operational_rule_receipt_v1(public.merchant_attendance_operational_rule_operations)","hash":"1e37a768f3b5e265dc195ea509c3395e00825495265c433a241b1be1203d5669","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_preview_v1","signature":"public.faolla_attendance_operational_rule_preview_v1(text,jsonb,bigint,jsonb,text,text)","hash":"073fd2f8d00e73d2685a4cd521ff3f429d7ba0b91414289f1a405c7d9e310535","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_scope","p_head","p_draft","p_day","p_end"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_check_v1","signature":"public.faolla_attendance_operational_rule_check_v1(text,text,bigint)","hash":"25809b0d345f18bc1558029cf1a1063285744d7b89d76b3e34462231542d7fc8","result":"void","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_key","p_revision"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_guard_v1","signature":"public.faolla_attendance_operational_rule_guard_v1()","hash":"5d10e43cc5b6e25a9d1872f4084389e32e831c664e08ef479d912ea9fcc36535","result":"trigger","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scalar_v1","signature":"public.faolla_attendance_management_scalar_v1(jsonb,text)","hash":"1f1afb8930a212c34937f2cfe8b843e9991d9827440c7589afb93a4f2e62ac06","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","k"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_array_v1","signature":"public.faolla_attendance_management_array_v1(jsonb,text[],integer,integer)","hash":"01b5e60f56433b2ec408d82c25bc9aec85187175e52482e33a15162d01cacebf","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","allowed","minimum","maximum"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_capability_v1","signature":"public.faolla_attendance_management_capability_v1(text)","hash":"8442e9811c7795f37e06e22fc84cca3d773cb084b19fc3c9528d3f642b97b990","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_binding_v1","signature":"public.faolla_attendance_management_binding_v1(jsonb)","hash":"434f3279e8bd6c90d559db026bdeca2d6092749586bb6271146c23ab826358b0","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scope_v1","signature":"public.faolla_attendance_management_scope_v1(jsonb,text)","hash":"715c2692e308c9562a54fab06f3ab4f0c888378837e6ffdf40e9531ad40ea16c","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","a"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_command_v1","signature":"public.faolla_attendance_management_command_v1(jsonb)","hash":"4bfb75e4776588b774e58e64018394a95fb8c802776c3df433dc0259de3a0fd3","result":"void","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_hash_v1","signature":"public.faolla_attendance_management_hash_v1(text,uuid,jsonb)","hash":"0251284215e3c71ba9420c3b7be5cc496699aa5a5cad4a6189da6b9a8361dd84","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scope_context_v1","signature":"public.faolla_attendance_management_scope_context_v1(text,jsonb,text)","hash":"dc5dbf304f62b90e211566ab9ca39a6dbace37341cf06e829f8c478dc681fa8f","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","p","a"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_current_v1","signature":"public.faolla_attendance_management_current_v1(public.merchant_attendance_management_delegations,timestamptz)","hash":"2148814cd6c45a36a584c6293e8abc8d7db61cdd62d55e06ceadcb0e757b7aa7","result":"boolean","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g","at_time"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_receipt_v1","signature":"public.faolla_attendance_management_receipt_v1(text,uuid,uuid)","hash":"e2fc56f00392cc2cd5e50c7208e9cdca9e75dde7ae49e3d0c1534a0d24a8958d","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","op","actor"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_grant_v1","signature":"public.faolla_attendance_management_grant_v1(public.merchant_attendance_management_delegations,timestamptz)","hash":"6dcd10acdf0b20a3184432fd943d702c75be56d37cf78c731b9f1f819e577358","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g","at_time"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_delegations_v1","signature":"public.faolla_attendance_management_delegations_v1(jsonb,uuid,jsonb,boolean)","hash":"0f8acf4b919f1f77d0f82a267705ace9490d8e5cbe349b04e99f64893968a513","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_grant"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_group_text_v1","signature":"public.faolla_attendance_group_text_v1(text,integer,integer)","hash":"b440810c3afb56de19592e1492e16b12cf6faf800ac2f9d0a8e7bdeca2ecc562","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","lo","hi"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_date_v1","signature":"public.faolla_attendance_group_date_v1(text,text)","hash":"78b42d44e8e4a547db264ec59f7866627284a959b82f0c46f0d646fba5931c8b","result":"boolean","language":"plpgsql","volatility":"s","definer":false,"defaults":1,"defaultExpression":"NULL::text","args":["p","z"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_checked_v1","signature":"public.faolla_attendance_group_checked_v1(public.merchant_attendance_groups)","hash":"045838f03a886a8d133419c37148a0c747b58d2a6c6ebe0c8aa85d4d53edd392","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_valid_zone_v1","signature":"public.faolla_attendance_valid_zone_v1(text)","hash":"3681c82259aaf0653bbddf12e3904144a53030f6213b0e96cdf6f8d40702657d","result":"boolean","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_zone"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_shift_rule_binding_object_v1","signature":"public.faolla_attendance_shift_rule_binding_object_v1(jsonb,text[])","hash":"2a634d258ceab747cb0098c516aa423babe8d7f0203ce9fb24725bc9602ded50","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","keys"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_events_append_only_v1","signature":"public.faolla_attendance_events_append_only_v1()","hash":"66b7826feb67a63b33b563d77176ef0ef81b49479657efbd80fbcefcb5512b0a","result":"trigger","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false}]$rules206_dependencies$::jsonb;
 own_spec:=own_spec||jsonb_build_array((case when has190 then $rules206_catalog190${"name":"faolla_valid_merchant_enterprise_permissions_v1","signature":"public.faolla_valid_merchant_enterprise_permissions_v1(text[])","hash":"3d759540cb9f60753053c3012d4bbbc9d14aed92ad86aa9ba7358a0fc2d89792","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_permissions"],"searchPath":"search_path=pg_catalog, public","isRpc":false}$rules206_catalog190$::jsonb else $rules206_catalog185${"name":"faolla_valid_merchant_enterprise_permissions_v1","signature":"public.faolla_valid_merchant_enterprise_permissions_v1(text[])","hash":"876f0456ae5a911a8dd7de7ebed3ab03aa3b9bb4fa347c9adae4261d4d64c48b","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_permissions"],"searchPath":"search_path=pg_catalog, public","isRpc":false}$rules206_catalog185$::jsonb end),$rules206_capture${"name":"faolla_attendance_account_capture_v1","signature":"public.faolla_attendance_account_capture_v1(text,uuid,uuid,uuid,boolean)","hash":"c5ba771116846124af37e113086395bad0787b8daaf6f9e5283273cf82337907","result":"uuid","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_employee","p_actor","p_actor_employee","p_enabled"],"searchPath":"search_path=pg_catalog","isRpc":false}$rules206_capture$::jsonb);
 own_spec:=own_spec||$rules206_forwards$[{"name":"faolla_attendance_rules_v1","signature":"public.faolla_attendance_rules_v1(jsonb,uuid,jsonb,boolean)","hash":"f10892ab5cb5e4920a63b9a31e75a7f33cb2542979cfb2736553b8ec918e8f97","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_write"],"searchPath":"search_path=pg_catalog","isRpc":true,"oldHash":"f10892ab5cb5e4920a63b9a31e75a7f33cb2542979cfb2736553b8ec918e8f97","newHash":"1432ccb65dc04d240175f89004c7da20fd87a683bd0a65fe35157b1181ea16db"},{"name":"faolla_attendance_personal_rules_v1","signature":"public.faolla_attendance_personal_rules_v1(jsonb,uuid,jsonb,boolean)","hash":"a1f2ddd77655a5b58e7fd27f8fea54a7c0459fbe26b79edecf2d486f37260b08","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_write"],"searchPath":"search_path=pg_catalog","isRpc":true,"oldHash":"a1f2ddd77655a5b58e7fd27f8fea54a7c0459fbe26b79edecf2d486f37260b08","newHash":"547c3eae0d1375d1837e950b6a25c43e4e5350cd55c235d8aa2c54143fecedb9"},{"name":"faolla_attendance_operational_rules_v1","signature":"public.faolla_attendance_operational_rules_v1(jsonb,uuid,jsonb,boolean)","hash":"c729c0c16e81c29dec02e7f78ebc77d4a2c7f4b3448724f6c5064a3f771ef7fb","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_write"],"searchPath":"search_path=pg_catalog","isRpc":true,"oldHash":"c729c0c16e81c29dec02e7f78ebc77d4a2c7f4b3448724f6c5064a3f771ef7fb","newHash":"ed260fdcb5e094d1e7aa9ff9ff447c0bf0a24e231db64354e4016f338155f05d"},{"name":"faolla_attendance_management_insert_v1","signature":"public.faolla_attendance_management_insert_v1()","hash":"0be4836fd81477e2aabd411f282f16909f3345e06cca96795e390a4b8d1115d7","result":"trigger","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false,"from":"if tg_table_name='merchant_attendance_management_delegation_operations' then raise exception 'attendance_management_executor_unavailable';end if;","to":"if tg_table_name='merchant_attendance_management_delegation_operations' then\n  if new.delegated_action='audit_export' then perform public.faolla_attendance_management_audit_authority_v1(new);return new;end if;\n  raise exception 'attendance_management_executor_unavailable';\n end if;","oldHash":"0be4836fd81477e2aabd411f282f16909f3345e06cca96795e390a4b8d1115d7","newHash":"37216d21b66510291fb3833781951ffeef20218594879bfcb4729fea7496c4be"}]$rules206_forwards$::jsonb;
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
 end loop;own_spec:=$rules206_post_own$[{"name":"faolla_attendance_delegated_rules_query_v1","signature":"public.faolla_attendance_delegated_rules_query_v1(jsonb)","hash":"b5df9ad01dae597c4ad9a31506ddf93df212981228934c4f03a46e1fa6c1d592","result":"void","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_action_v1","signature":"public.faolla_attendance_delegated_rules_action_v1(text,text)","hash":"683123d682ab9cfc779007bd11598e20db0e14da1b3125da3a2826539deb4391","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["family","action_name"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_defaults_v1","signature":"public.faolla_attendance_delegated_rules_defaults_v1(text)","hash":"1bfcadd07f1cf94a703fea2bf659ff4ded935804ff0a009aa878b853f38a8eeb","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["family"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_command_v1","signature":"public.faolla_attendance_delegated_rules_command_v1(jsonb)","hash":"897a4d0449486dd380da00cdeeec4e538dc87d4301b50589bbbcef6415faf739","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_hash_v1","signature":"public.faolla_attendance_delegated_rules_hash_v1(text,uuid,uuid,jsonb)","hash":"73b8c186cb45bc637cb95bfc80476117fa71ec2181132d265718fd1e4b688b02","result":"text","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_authorize_v1","signature":"public.faolla_attendance_delegated_rules_authorize_v1(text,uuid,uuid,text,text)","hash":"6c7d13423932a2e94c6abb3c29763bb199bc03c9dd8a9d47fc0419a4e528cc6b","result":"public.merchant_attendance_management_delegations","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id","family","action_name"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_core_authorize_v1","signature":"public.faolla_attendance_delegated_rules_core_authorize_v1(text,uuid,uuid,text,jsonb,jsonb)","hash":"fc658683c08710244750c752df3bf4be93a8ddef4ac2a73ae83fb8b9eb409fdc","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id","family","subject","d"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_at_v1","signature":"public.faolla_attendance_delegated_rules_at_v1(text,text,jsonb,timestamptz,bigint,bigint)","hash":"36d592d137f66bd174f1eea7d0a2fac583f9999a046ce05a04cc5ee48b8e4ae0","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","family","subject","stamp","ceiling","excluded"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_baseline_v1","signature":"public.faolla_attendance_delegated_rules_baseline_v1(text,text,jsonb,timestamptz,bigint)","hash":"35d861e1a697ca28e665c48bafe97a0a89e8efbf27c0c2b9d1f70a68e41e98ce","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","family","subject","stamp","ceiling"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_choices_v1","signature":"public.faolla_attendance_delegated_rules_choices_v1(public.merchant_attendance_management_delegations,jsonb,jsonb)","hash":"3b6a703e24f380ca9b175bca2283554ed71cd3a4ec3220c39d9d8746f45d3a50","result":"void","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["g","before_rules","after_rules"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_effects_v1","signature":"public.faolla_attendance_delegated_rules_effects_v1(public.merchant_attendance_management_delegations,jsonb,timestamptz,bigint)","hash":"8981af7bf5db76aef87e422a3937242b7e2aaee896e2ef708d992af9a5ebf9eb","result":"void","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["g","d","stamp","ceiling"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_base_core_v1","signature":"public.faolla_attendance_delegated_rules_base_core_v1(jsonb,uuid,jsonb,boolean,uuid)","hash":"91e10598ecc8ec2aa0d41c16bcc2bc379b1c0e6a04e1c687b092506fd2ec74f4","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id","p_command","p_allow_write","p_grant_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_personal_core_v1","signature":"public.faolla_attendance_delegated_rules_personal_core_v1(jsonb,uuid,jsonb,boolean,uuid)","hash":"9ac405f1b162d80299698a176fd6e657cf9d2dae119bad029738c97c2e522849","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id","p_command","p_allow_write","p_grant_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_operational_core_v1","signature":"public.faolla_attendance_delegated_rules_operational_core_v1(jsonb,uuid,jsonb,boolean,uuid)","hash":"30eca7ce064aa69eac0f14e373adb13062136eaab200b194f4217defcb15ebbb","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id","p_command","p_allow_write","p_grant_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_business_v1","signature":"public.faolla_attendance_delegated_rules_business_v1(text,uuid,text)","hash":"0cc581dd6bc8c64c629ea7e5f40b738b31754892b4952ddfe0fb9f87ff1eca40","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","op","family"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_operation_v1","signature":"public.faolla_attendance_delegated_rules_operation_v1(public.merchant_attendance_management_delegation_operations,boolean)","hash":"9dfdb62438c9ee367d4c28d3d96a2720d243cf4eac8ca4af74556071ba4470c3","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_current"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_receipt_v1","signature":"public.faolla_attendance_delegated_rules_receipt_v1(text,uuid,uuid,uuid)","hash":"dc754661b3647f7fa2f83752d8aa127e49bc4d3456d867b13646b4500078d55a","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","op","actor","id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_authority_v1","signature":"public.faolla_attendance_delegated_rules_authority_v1(public.merchant_attendance_management_delegation_operations)","hash":"67c2620f43c2f78ecbc51ec3e7faf991a6d352b2c71da06012aea23da762823e","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_rules_v1","signature":"public.faolla_attendance_delegated_rules_v1(jsonb,uuid,jsonb,boolean)","hash":"6c4cdf8b938941addcc72c48fe0dbeebaaa8bd9ffc619f25d09abfc2dd3b7880","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_write"],"searchPath":"search_path=pg_catalog","isRpc":true}]$rules206_post_own$::jsonb;for spec in select value from jsonb_array_elements(own_spec) loop
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
 end loop;foreach table_name in array array['merchant_attendance_rule_streams','merchant_attendance_rule_operations','merchant_attendance_personal_rule_streams','merchant_attendance_personal_rule_operations','merchant_attendance_operational_rule_streams','merchant_attendance_operational_rule_operations','merchant_attendance_operational_rule_publications'] loop
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
    or pg_get_expr(actual_default.adbin,actual_table) is distinct from pg_get_expr(expected_default.adbin,expected_table))) then raise exception 'merchant_attendance_delegated_rules_table_conflict';end if;
 if (select count(*) from pg_constraint where conrelid=actual_table and contype<>'t')<>(select count(*) from pg_constraint where conrelid=expected_table and contype<>'t') then raise exception 'merchant_attendance_delegated_rules_constraint_conflict';end if;
 for constraint_spec in select * from pg_constraint where conrelid=expected_table and contype<>'t' loop
  select * into actual_constraint from pg_constraint where conrelid=actual_table and conname=constraint_spec.conname;
  foreign_table:=case when constraint_spec.contype='f' then to_regclass(ns||'.'||(select relname from pg_class where oid=constraint_spec.confrelid)) else 0::oid end;
  select array_agg(actual_ref.attnum::smallint order by requested.ord) into reference_keys from unnest(constraint_spec.confkey) with ordinality requested(attnum,ord)
   join pg_attribute expected_ref on expected_ref.attrelid=constraint_spec.confrelid and expected_ref.attnum=requested.attnum
   join pg_attribute actual_ref on actual_ref.attrelid=foreign_table and actual_ref.attname=expected_ref.attname;
  if actual_constraint.oid is null or row(actual_constraint.contype,actual_constraint.conkey,actual_constraint.confkey,actual_constraint.confrelid,actual_constraint.condeferrable,actual_constraint.condeferred,actual_constraint.convalidated,actual_constraint.confupdtype,actual_constraint.confdeltype,actual_constraint.confmatchtype,actual_constraint.connoinherit,actual_constraint.conislocal,actual_constraint.coninhcount)
   is distinct from row(constraint_spec.contype,constraint_spec.conkey,reference_keys,foreign_table::oid,constraint_spec.condeferrable,constraint_spec.condeferred,true,constraint_spec.confupdtype,constraint_spec.confdeltype,constraint_spec.confmatchtype,constraint_spec.connoinherit,true,0)
   or pg_get_expr(actual_constraint.conbin,actual_table) is distinct from pg_get_expr(constraint_spec.conbin,expected_table) then raise exception 'merchant_attendance_delegated_rules_constraint_conflict';end if;
 end loop;
 if (select count(*) from pg_index where indrelid=actual_table)<>(select count(*) from pg_index where indrelid=expected_table) then raise exception 'merchant_attendance_delegated_rules_index_conflict';end if;
 for index_spec in select index_row.*,index_table.relname,index_table.relam from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indrelid=expected_table loop
  select index_row.*,index_table.relowner,index_table.relam,index_table.relkind into actual_index from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indexrelid=to_regclass(ns||'.'||index_spec.relname);
  if actual_index.indexrelid is null or actual_index.indrelid<>actual_table or actual_index.relowner<>expected_owner or actual_index.relkind<>'i' or not actual_index.indisvalid or not actual_index.indisready or not actual_index.indislive
   or row(actual_index.relam,actual_index.indnatts,actual_index.indnkeyatts,actual_index.indisunique,actual_index.indisprimary,actual_index.indisexclusion,actual_index.indimmediate,actual_index.indnullsnotdistinct,actual_index.indkey,actual_index.indcollation,actual_index.indclass,actual_index.indoption)
   is distinct from row(index_spec.relam,index_spec.indnatts,index_spec.indnkeyatts,index_spec.indisunique,index_spec.indisprimary,index_spec.indisexclusion,index_spec.indimmediate,index_spec.indnullsnotdistinct,index_spec.indkey,index_spec.indcollation,index_spec.indclass,index_spec.indoption)
   or pg_get_expr(actual_index.indpred,actual_table) is distinct from pg_get_expr(index_spec.indpred,expected_table) or pg_get_expr(actual_index.indexprs,actual_table) is distinct from pg_get_expr(index_spec.indexprs,expected_table) then raise exception 'merchant_attendance_delegated_rules_index_conflict';end if;
 end loop;
 if table_name like '%operational%' then
  if (select count(*) from pg_trigger where tgrelid=actual_table and not tgisinternal)<>3 then raise exception 'merchant_attendance_delegated_rules_trigger_conflict';end if;
  for trigger_spec in select * from(values('operational_rule_no_truncate',34,false,false,'faolla_attendance_events_append_only_v1'),
   (case when table_name like '%operations' then 'operational_rule_immutable' else 'operational_rule_shape' end,case when table_name like '%operations' then 27 else 31 end,false,false,case when table_name like '%operations' then 'faolla_attendance_events_append_only_v1' else 'faolla_attendance_operational_rule_guard_v1' end),
   ('operational_rule_proof',case when table_name like '%operations' then 5 else 21 end,true,true,'faolla_attendance_operational_rule_guard_v1')) expected(name,kind,deferred,initially_deferred,fn) loop
   if not exists(select 1 from pg_trigger actual where actual.tgrelid=actual_table and actual.tgname=trigger_spec.name::name and actual.tgtype=trigger_spec.kind and actual.tgenabled='O' and actual.tgnargs=0 and actual.tgqual is null and actual.tgdeferrable=trigger_spec.deferred and actual.tginitdeferred=trigger_spec.initially_deferred and actual.tgfoid=to_regprocedure(ns||'.'||trigger_spec.fn||'()')) then raise exception 'merchant_attendance_delegated_rules_trigger_conflict';end if;
  end loop;
 else
  if (select count(*) from pg_trigger where tgrelid=actual_table and not tgisinternal)<>(case when table_name like '%operations' then 2 else 0 end) then raise exception 'merchant_attendance_delegated_rules_trigger_conflict';end if;
  if table_name like '%operations' then
   for trigger_spec in select * from(values(case when table_name like '%personal%' then 'attendance_personal_rule_operations_immutable' else 'merchant_attendance_rule_operations_immutable' end,27),
    (case when table_name like '%personal%' then 'attendance_personal_rule_operations_no_truncate' else 'merchant_attendance_rule_operations_no_truncate' end,34)) expected(name,kind) loop
    if not exists(select 1 from pg_trigger actual where actual.tgrelid=actual_table and actual.tgname=trigger_spec.name::name and actual.tgtype=trigger_spec.kind and actual.tgenabled='O' and actual.tgnargs=0 and actual.tgqual is null and not actual.tgdeferrable and not actual.tginitdeferred and actual.tgfoid=to_regprocedure(ns||'.faolla_attendance_events_append_only_v1()')) then raise exception 'merchant_attendance_delegated_rules_trigger_conflict';end if;
   end loop;
  end if;
 end if;
end loop;
 if (select count(*) from rules206_forward_metadata)<>4 or exists(select 1 from rules206_forward_metadata original left join pg_proc proc on proc.oid=original.oid where proc.oid is null or to_jsonb(proc)-array['prosrc','proargdefaults'] is distinct from original.metadata or pg_get_expr(proc.proargdefaults,0) is distinct from original.default_expression) then raise exception 'merchant_attendance_delegated_rules_forward_metadata_changed';end if;
 end;$rules206_postconditions$;
 drop table pg_temp.rules206_forward_metadata,pg_temp.merchant_attendance_operational_rule_publications,pg_temp.merchant_attendance_operational_rule_operations,pg_temp.merchant_attendance_operational_rule_streams,pg_temp.merchant_attendance_personal_rule_operations,pg_temp.merchant_attendance_personal_rule_streams,pg_temp.merchant_attendance_rule_operations,pg_temp.merchant_attendance_rule_streams,pg_temp.merchant_attendance_settings,pg_temp.merchant_attendance_groups,pg_temp.merchant_attendance_workers,pg_temp.merchant_enterprise_employees;
--END GENERATED DELEGATED RULES POSTCONDITIONS
commit;
