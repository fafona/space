import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202608190039_runtime_rpc_execute_acl_hardening.sql",
);
const acceptancePath = path.join(
  process.cwd(),
  "scripts",
  "enterprise-integration",
  "61-runtime-rpc-execute-acl-hardening.sql",
);
const runnerPath = path.join(
  process.cwd(),
  "scripts",
  "enterprise-integration",
  "run.sh",
);
const stubPath = path.join(
  process.cwd(),
  "scripts",
  "enterprise-integration",
  "00-supabase-stubs.sql",
);
const packagePath = path.join(process.cwd(), "package.json");
const productionApplyPath = path.join(
  process.cwd(),
  "scripts",
  "apply-production-database-migrations.mjs",
);
const productionWorkflowPath = path.join(
  process.cwd(),
  ".github",
  "workflows",
  "database-migrate.yml",
);

const read = (file) => fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n");

const signatures = [
  "faolla_is_merchant_owner(text)",
  "faolla_upsert_merchant_order_v1(jsonb,jsonb,jsonb)",
  "faolla_upsert_merchant_orders_v1(jsonb)",
  "faolla_upsert_merchant_membership_ledger_v1(jsonb)",
  "faolla_upsert_merchant_bookings_v1(jsonb)",
  "faolla_resolve_merchant_customer_v1(text,jsonb,text)",
  "faolla_upsert_merchant_coupons_v1(jsonb)",
  "faolla_upsert_merchant_conversations_v1(jsonb)",
  "faolla_enqueue_merchant_outbox_v1(jsonb)",
  "faolla_claim_merchant_outbox_v1(text,integer,integer,text[])",
  "faolla_renew_merchant_outbox_lease_v1(uuid,text,integer)",
  "faolla_complete_merchant_outbox_v1(uuid,text,jsonb)",
  "faolla_fail_merchant_outbox_v1(uuid,text,text,text,boolean,integer)",
  "faolla_replay_merchant_outbox_v1(uuid,text,text)",
  "faolla_claim_merchant_outbox_scoped_v1(text,text[],text[],integer,integer)",
  "faolla_get_merchant_outbox_health_v1(text,integer)",
];

test("039 freezes all 16 RPC definitions and overload surfaces", () => {
  const source = read(migrationPath);
  for (const signature of signatures) {
    assert.match(source, new RegExp(signature.replace(/[()[\].]/g, "\\$&"), "i"));
  }
  assert.equal(new Set(source.match(/[0-9a-f]{32}/g)).size, 16);
  assert.match(source, /pg_catalog\.md5\(pg_catalog\.replace\([\s\S]+?prosrc/i);
  assert.match(source, /proowner\s*<>\s*to_regrole\(current_user\)/i);
  assert.match(source, /proretset[\s\S]+proisstrict[\s\S]+proleakproof/i);
  assert.match(source, /pronargdefaults[\s\S]+proargnames/i);
  assert.match(source, /pg_get_expr\(function_metadata\.proargdefaults, 0\)/i);
  assert.match(source, /proargmodes is not null[\s\S]+proallargtypes is not null/i);
  assert.match(source, /select count\(\*\)[\s\S]+overload\.proname = expected\.function_name/i);
  assert.equal((source.match(/public\.merchant_outbox_events/g) ?? []).length >= 4, true);
  assert.match(source, /definition_postcondition[\s\S]+definition_postcondition_failed/i);
  assert.equal((source.match(/pg_catalog\.md5\(pg_catalog\.replace\(/g) ?? []).length >= 2, true);
});

test("039 rebuilds exact owner/authenticated/service ACLs with grantor checks", () => {
  const source = read(migrationPath);
  assert.match(source, /faolla_is_merchant_owner\(text\)', 'authenticated_only'/i);
  assert.match(source, /faolla_upsert_merchant_order_v1\(jsonb,jsonb,jsonb\)', 'owner_only'/i);
  assert.equal((source.match(/'service_only'/g) ?? []).length >= 14, true);
  assert.match(source, /pg_catalog\.aclexplode[\s\S]+revoke all privileges on function %s from %s cascade/i);
  assert.match(source, /grant execute on function %s to %I[\s\S]+pg_get_userbyid/i);
  assert.match(source, /grant execute on function %s to authenticated/i);
  assert.match(source, /grant execute on function %s to service_role/i);
  assert.match(source, /acl\.grantor <> function_metadata\.proowner/i);
  assert.match(source, /1 <> \([\s\S]+owner_acl[\s\S]+allowed_acl/i);
  assert.doesNotMatch(source, /cross join pg_catalog\.pg_roles as role_metadata[\s\S]+has_function_privilege/i);
  assert.match(source, /do \$registry_acl\$[\s\S]+revoke all privileges on table public\.faolla_schema_migrations from %s cascade/i);
  assert.match(source, /revoke all privileges \(%I\) on table public\.faolla_schema_migrations from %s cascade/i);
  assert.match(source, /grant all privileges on table public\.faolla_schema_migrations to %I/i);
  assert.match(source, /grant select on table public\.faolla_schema_migrations to service_role/i);
  assert.equal(
    (source.match(/runtime_rpc_execute_acl_hardening_registry_acl_invariant_failed/g) ?? []).length,
    2,
  );
  assert.equal(
    (source.match(/pg_catalog\.acldefault\('r', v_registry_owner\)/g) ?? []).length >= 2,
    true,
  );
  assert.equal((source.match(/attribute\.attacl is not null/g) ?? []).length >= 2, true);
});

test("039 normalizes global future defaults for every audited creator", () => {
  const source = read(migrationPath);
  assert.match(
    source,
    /alter default privileges for role %I revoke execute on functions from public cascade/i,
  );
  assert.doesNotMatch(
    source,
    /alter default privileges for role %I in schema public revoke execute on functions from public cascade/i,
  );
  assert.match(source, /to_regrole\(current_user\), to_regrole\(session_user\)/i);
  assert.match(source, /to_regrole\('postgres'\), to_regrole\('supabase_admin'\)/i);
  assert.match(source, /has_schema_privilege\([\s\S]+?'CREATE'/i);
  assert.match(source, /defaclnamespace in \(0, 'public'::regnamespace\)/i);
  assert.match(source, /acl\.grantor <> default_acl\.defaclrole/i);
  assert.match(source, /acl\.is_grantable/i);
});

test("039 locks the official role graph and trusted migration identity", () => {
  const source = read(migrationPath);
  assert.match(source, /current_user <> 'supabase_admin'[\s\S]+rolsuper/i);
  assert.match(source, /runtime_rpc_execute_acl_hardening_untrusted_migrator/i);
  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.match(
      source,
      new RegExp(`\\('${role}', 'authenticator', false\\)`, "i"),
    );
  }
  assert.match(source, /revoke supabase_admin from authenticator/i);
  assert.match(source, /supabase_storage_admin[\s\S]+rolinherit/i);
  assert.match(source, /grantor_role\.rolname not in \('postgres', 'supabase_admin'\)/i);
  assert.match(source, /cli_login_postgres[\s\S]+member_role\.rolname = 'cli_login_postgres'[\s\S]+grantor_role\.rolname <> 'supabase_admin'/i);
  assert.match(source, /actual_protected_membership[\s\S]+except[\s\S]+allowed_membership/i);
  assert.match(source, /with recursive role_path/i);
  assert.match(source, /dashboard_user[\s\S]+supabase_auth_admin[\s\S]+supabase_functions_admin/i);
});

test("039 serializes catalogs, proves cluster quiescence, and post-asserts the registry", () => {
  const source = read(migrationPath);
  const firstSqlStatement = source
    .replace(/^\uFEFF?/, "")
    .replace(/^(?:\s*--[^\n]*\n)+/, "")
    .trimStart();
  const registryInsert = source.lastIndexOf("values (202608190039");
  const isolation = source.indexOf("set transaction isolation level read committed");
  const advisory = source.indexOf("pg_catalog.pg_advisory_xact_lock(20260731, 1)");
  const catalogLock = source.indexOf("lock table\n  pg_catalog.pg_database");
  const quiescence = source.indexOf("do $catalog_quiescence_postlock$");
  const registryLock = source.indexOf(
    "lock table public.faolla_schema_migrations in share row exclusive mode",
  );
  const preflight = source.indexOf("do $preflight$");
  assert.match(firstSqlStatement, /^begin;\s+set transaction isolation level read committed;/i);
  assert.match(source, /set local lock_timeout = '15s'/i);
  assert.match(source, /set local statement_timeout = '60s'/i);
  assert.ok(isolation >= 0 && advisory > isolation && catalogLock > advisory);
  assert.match(
    source.slice(catalogLock, quiescence),
    /pg_database,[\s\S]+pg_authid,[\s\S]+pg_auth_members,[\s\S]+pg_namespace,[\s\S]+pg_language,[\s\S]+pg_type,[\s\S]+pg_proc,[\s\S]+pg_default_acl,[\s\S]+pg_class,[\s\S]+pg_attribute[\s\S]+in share row exclusive mode;/i,
  );
  assert.ok(quiescence > catalogLock && registryLock > quiescence && preflight > registryLock);
  assert.match(
    source.slice(quiescence, registryLock),
    /pg_stat_clear_snapshot\(\)[\s\S]+activity\.pid <> pg_catalog\.pg_backend_pid\(\)[\s\S]+activity\.leader_pid is distinct from pg_catalog\.pg_backend_pid\(\)[\s\S]+activity\.backend_xid is not null[\s\S]+end if;[\s\S]+if exists \(select 1 from pg_catalog\.pg_prepared_xacts\)/i,
  );
  assert.doesNotMatch(source.slice(quiescence, registryLock), /backend_type|xact_start|datname/i);
  assert.match(
    source.slice(registryLock, preflight + "do $preflight$".length),
    /share row exclusive mode;\s*(?:--[^\n]*\n\s*)*do \$preflight\$/i,
  );
  assert.equal((source.match(/current_user <> 'supabase_admin'/g) ?? []).length >= 2, true);
  assert.match(source, /runtime_rpc_execute_acl_hardening_registry_conflict/i);
  assert.match(source, /constraint_metadata\.contype = 'p'/i);
  assert.match(source, /trigger_metadata\.tgisinternal/i);
  assert.ok(registryInsert > source.lastIndexOf("definition_postcondition_failed"));
  assert.match(source.slice(registryInsert), /registry_postcondition_failed[\s\S]+notify pgrst[\s\S]+commit;/i);
});

test("039 uses the production deployment mutex and the only controlled workflow", () => {
  const source = read(migrationPath);
  const productionApply = read(productionApplyPath);
  const productionWorkflow = read(productionWorkflowPath);
  assert.match(source, /pg_advisory_xact_lock\(20260731, 1\)/i);
  assert.match(
    productionApply,
    /MIGRATION_ADVISORY_LOCK_SQL[\s\S]+pg_advisory_lock\(20260731, 1\)[\s\S]+MIGRATION_ADVISORY_UNLOCK_SQL[\s\S]+pg_advisory_unlock\(20260731, 1\)/i,
  );
  assert.match(
    productionApply,
    /wrapMigrationWithAdvisoryLock\(source\)[\s\S]+MIGRATION_ADVISORY_LOCK_SQL,[\s\S]+source\.replace[\s\S]+MIGRATION_ADVISORY_UNLOCK_SQL/i,
  );
  assert.match(
    productionWorkflow,
    /apply-production-database-migrations\.mjs --apply --through=/i,
  );
});

test("runner and acceptance cover the full 001-008 and hostile ACL matrix", () => {
  const runner = read(runnerPath);
  const acceptance = read(acceptancePath);
  const stub = read(stubPath);
  const packageSource = read(packagePath);
  for (const version of ["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008"]) {
    assert.match(runner, new RegExp(`20260725${version}_`, "i"));
  }
  assert.match(runner, /61-runtime-rpc-execute-acl-hardening\.sql/i);
  assert.match(runner, /quote_all_identifiers=on/i);
  assert.match(runner, /runtime_rpc_execute_acl_hardening_untrusted_migrator/i);
  assert.match(runner, /count\(\*\) = 15[\s\S]+has_function_privilege\('anon'/i);
  assert.match(runner, /grant postgres to cli_login_postgres with admin option/i);
  assert.match(runner, /drop role cli_login_postgres/i);
  assert.match(runner, /lc_messages=C/i);
  assert.match(runner, /enterprise_rpc_acl_ddl_first_039[\s\S]+track_activities = off;"[\s\S]+--command "begin; create function[\s\S]+backend_xid is not null[\s\S]+state = 'disabled'[\s\S]+xact_start is null/i);
  assert.match(runner, /enterprise_rpc_acl_cross_database_probe_039[\s\S]+insert into public\.enterprise_rpc_acl_cross_database_probe_039[\s\S]+enterprise_rpc_acl_cross_database_039[\s\S]+backend_xid is not null/i);
  assert.match(runner, /max_prepared_transactions[\s\S]+create table public\.redteam_rpc_acl_prepared_probe_039[^\n]+\\[\s\S]+--command "begin; insert[\s\S]+prepare transaction 'enterprise_rpc_acl_prepared_039'[\s\S]+rollback prepared/i);
  assert.match(runner, /redteam_rpc_acl_database_owner_039 nologin noinherit createdb[\s\S]+enterprise_rpc_acl_database_owner_039[\s\S]+set lock_timeout = 0[\s\S]+alter database[\s\S]+pg_database[\s\S]+RowExclusiveLock[\s\S]+canceling statement due to lock timeout/i);
  assert.match(runner, /enterprise_rpc_acl_migration_barrier_039[\s\S]+10 = \(select count\(\*\)[\s\S]+pg_class[\s\S]+pg_attribute[\s\S]+ShareRowExclusiveLock[\s\S]+not registry_lock\.granted/i);
  assert.match(runner, /PGAPPNAME=enterprise_rpc_acl_migration_barrier_039[\s\S]+PGAPPNAME=enterprise_rpc_acl_second_migration_039/i);
  assert.match(runner, /enterprise_rpc_acl_catalog_database_039[\s\S]+pg_database[\s\S]+RowExclusiveLock/i);
  assert.match(runner, /enterprise_rpc_acl_catalog_class_table_grant_039[\s\S]+pg_class[\s\S]+grant update on table public\.faolla_schema_migrations/i);
  assert.match(runner, /enterprise_rpc_acl_catalog_class_column_grant_039[\s\S]+pg_class[\s\S]+grant update\(applied_at\) on table public\.faolla_schema_migrations/i);
  assert.match(runner, /enterprise_rpc_acl_catalog_attribute_lock_039[\s\S]+pg_attribute[\s\S]+lock table pg_catalog\.pg_attribute in row exclusive mode/i);
  assert.match(runner, /Catalog SHARE ROW EXCLUSIVE gates blocked an ordinary catalog read/i);
  assert.match(runner, /enterprise_rpc_acl_postlock_ddl_039[\s\S]+backend_xid is null[\s\S]+not lock_state\.granted/i);
  assert.match(runner, /pg_advisory_lock\(20260731, 1\)[\s\S]+pg_advisory_unlock\(20260731, 1\)[\s\S]+wrapper_lock_leaked/i);
  assert.match(runner, /pg_terminate_backend[\s\S]+Post-lock function DDL inherited a non-owner runtime ACL/i);
  assert.match(runner, /run_sql_file_as_role[\s\S]+202607250001_core_transaction_foundation\.sql[\s\S]+supabase_admin/i);
  assert.match(acceptance, /16 frozen runtime RPC definitions changed/i);
  assert.match(acceptance, /runtime RPC protected role graph is not exact/i);
  assert.match(acceptance, /future function owner-only canary failed/i);
  assert.match(acceptance, /future function default EXECUTE ACL is not owner-only/i);
  assert.match(acceptance, /039 registry raw ACL is not exact/i);
  assert.match(acceptance, /service_role cannot read the migration registry/i);
  assert.equal((acceptance.match(/'42501'/g) ?? []).length >= 5, true);
  assert.match(runner, /grant select on table public\.faolla_schema_migrations to \\?"redteam rpc acl 039\\?" with grant option/i);
  assert.match(runner, /grant update\(applied_at\) on table public\.faolla_schema_migrations to \\?"redteam rpc acl 039\\?" with grant option/i);
  assert.match(runner, /grant select on table public\.faolla_schema_migrations to redteam_rpc_acl_child_039, service_role/i);
  assert.match(runner, /039 registry conflict changed ACL or registry state/i);
  assert.match(runner, /039 did not normalize the exact registry table and column ACLs/i);
  assert.match(stub, /alter role supabase_admin[\s\S]+superuser/i);
  assert.match(stub, /grant anon, authenticated, service_role to authenticator/i);
  assert.doesNotMatch(stub, /grant[^;]*supabase_admin[^;]*to authenticator/i);
  assert.match(stub, /alter default privileges for role supabase_admin[\s\S]+grant execute on functions to public, anon, authenticated, service_role/i);
  assert.match(stub, /grant postgres to cli_login_postgres/i);
  assert.match(packageSource, /runtime-rpc-execute-acl-hardening-migration-contract\.test\.mjs/i);
});
