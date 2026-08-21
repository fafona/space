import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const migrationPath = path.join(
  root,
  "scripts",
  "supabase-migrations",
  "202608190040_merchant_acl_contract_hardening.sql",
);
const initPath = path.join(root, "scripts", "supabase-init.sql");
const readinessPath = path.join(
  root,
  "scripts",
  "check-ordinary-account-cutover-readiness.mjs",
);
const readinessAcceptancePath = path.join(
  root,
  "scripts",
  "enterprise-integration",
  "62-ordinary-account-cutover-readiness-gate.sh",
);
const runnerPath = path.join(
  root,
  "scripts",
  "enterprise-integration",
  "run.sh",
);
const packagePath = path.join(root, "package.json");

const read = (file) => fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n");

test("040 accepts only the frozen production prestate or exact target before mutation", () => {
  const source = read(migrationPath);
  const catalogLock = source.indexOf("lock table\n  pg_catalog.pg_authid");
  const preflight = source.indexOf("do $preflight$");
  const mutation = source.indexOf("do $acl_mutation$");
  assert.match(source, /^--[^]*?\nbegin;/i);
  assert.match(source, /set transaction isolation level read committed/i);
  assert.match(source, /current_user <> 'supabase_admin'[\s\S]+rolsuper/i);
  const postgresSuperChecks = [
    ...source.matchAll(
      /from pg_catalog\.pg_roles as postgres_role[\s\S]*?where postgres_role\.rolname = 'postgres'[\s\S]*?and postgres_role\.rolsuper/gi,
    ),
  ];
  assert.equal(postgresSuperChecks.length, 2);
  assert.ok(
    postgresSuperChecks[0].index < catalogLock &&
      postgresSuperChecks[1].index > catalogLock &&
      postgresSuperChecks[1].index < mutation,
  );
  assert.doesNotMatch(
    source,
    /postgres_role\.rolsuper\s+or\s+postgres_role\.rolbypassrls/i,
  );
  assert.match(source, /pg_catalog\.pg_advisory_xact_lock\(20260731, 1\)/i);
  assert.match(
    source,
    /lock table[\s\S]+pg_catalog\.pg_authid,[\s\S]+pg_catalog\.pg_namespace,[\s\S]+pg_catalog\.pg_class,[\s\S]+pg_catalog\.pg_attribute,[\s\S]+pg_catalog\.pg_policy,[\s\S]+pg_catalog\.pg_rewrite,[\s\S]+pg_catalog\.pg_inherits[\s\S]+in share row exclusive mode/i,
  );
  assert.match(
    source,
    /lock table[\s\S]+public\.faolla_schema_migrations,[\s\S]+public\.merchants[\s\S]+in share row exclusive mode/i,
  );
  assert.match(source, /expected_production_acl/i);
  assert.match(source, /expected_target_acl/i);
  assert.match(source, /actual_acl[\s\S]+except all[\s\S]+expected_production_acl/i);
  assert.match(source, /expected_production_acl[\s\S]+except all[\s\S]+actual_acl/i);
  assert.match(source, /actual_acl[\s\S]+except all[\s\S]+expected_target_acl/i);
  assert.match(source, /expected_target_acl[\s\S]+except all[\s\S]+actual_acl/i);
  assert.match(source, /v_production_acl_ready[\s\S]+v_target_acl_ready/i);
  assert.match(source, /merchant_acl_contract_hardening_acl_prestate_invalid/i);
  assert.match(source, /merchant_acl_contract_hardening_registered_state_invalid/i);
  assert.ok(catalogLock > 0 && preflight > catalogLock && mutation > preflight);
});

test("040 preserves the minimal owner, browser, and service table ACL", () => {
  const source = read(migrationPath);
  assert.match(source, /count\(\*\)[\s\S]+35[\s\S]+v_production_acl_ready/i);
  assert.match(source, /count\(\*\)[\s\S]+14[\s\S]+v_target_acl_ready/i);
  assert.match(
    source,
    /authenticated'[\s\S]+ARRAY\['SELECT','INSERT','UPDATE'\]::text\[\]/i,
  );
  assert.match(
    source,
    /service_role'[\s\S]+ARRAY\['SELECT','INSERT','UPDATE','DELETE'\]::text\[\]/i,
  );
  assert.match(
    source,
    /revoke all privileges on table public\.merchants[\s\S]+from public, postgres, anon, authenticated, service_role/i,
  );
  assert.doesNotMatch(
    source,
    /revoke all privileges on table public\.merchants[^;']*cascade/i,
  );
  assert.match(
    source,
    /grant select, insert, update on table public\.merchants to authenticated/i,
  );
  assert.match(
    source,
    /grant select, insert, update, delete on table public\.merchants to service_role/i,
  );
  assert.doesNotMatch(
    source,
    /grant[^;]*(?:truncate|references|trigger)[^;]*to (?:anon|authenticated|service_role)/i,
  );
  assert.match(source, /acl\.grantor[\s\S]+merchant\.relowner/i);
  assert.match(source, /acl\.is_grantable/i);
  assert.match(source, /attribute\.attacl is not null/i);
});

test("040 freezes merchant ownership, relation shape, policies, and hostile surfaces", () => {
  const source = read(migrationPath);
  for (const policy of [
    "merchants_select_own",
    "merchants_insert_self",
    "merchants_update_own",
    "merchants_system_site_principal_isolation",
    "merchants_system_site_principal_insert_isolation",
  ]) {
    assert.match(source, new RegExp(policy, "i"));
  }
  for (const hash of [
    "42205aae07118e35699a5507ffe3385a",
    "899af52ac5bbc8824aa635183199f48a",
    "1c08e1341a191bbc45013950a337671d",
  ]) {
    assert.match(source, new RegExp(hash, "i"));
  }
  assert.match(source, /merchant\.relowner = to_regrole\('supabase_admin'\)/i);
  assert.match(source, /merchant\.relrowsecurity[\s\S]+merchant\.relforcerowsecurity/i);
  assert.match(source, /pg_catalog\.pg_inherits/i);
  assert.match(source, /pg_catalog\.pg_rewrite/i);
  assert.match(source, /merchant_acl_contract_hardening_object_contract_invalid/i);
  assert.match(source, /merchant_acl_contract_hardening_postcondition_failed/i);
});

test("040 registers exactly once after ACL postcondition and is replay safe", () => {
  const source = read(migrationPath);
  const aclMutation = source.indexOf(
    "revoke all privileges on table public.merchants",
  );
  const firstPostcondition = source.indexOf(
    "merchant_acl_contract_hardening_postcondition_failed",
  );
  const registryInsert = source.indexOf(
    "insert into public.faolla_schema_migrations",
  );
  assert.ok(aclMutation > 0 && firstPostcondition > aclMutation);
  assert.ok(registryInsert > firstPostcondition);
  assert.match(
    source.slice(registryInsert),
    /values\s*\(\s*202608190040,\s*'merchant_acl_contract_hardening'\s*\)[\s\S]+on conflict \(version\) do nothing/i,
  );
  assert.match(
    source.slice(registryInsert),
    /merchant_acl_contract_hardening_registry_postcondition_failed[\s\S]+commit;/i,
  );
  assert.equal(
    (source.match(/merchant_acl_contract_hardening_registry_conflict/g) ?? [])
      .length >= 1,
    true,
  );
});

test("040 target is wired into init, readiness, PostgreSQL acceptance, and tests", () => {
  const init = read(initPath);
  const readiness = read(readinessPath);
  const acceptance = read(readinessAcceptancePath);
  const runner = read(runnerPath);
  const packageSource = read(packagePath);
  assert.match(
    init,
    /revoke all privileges on table public\.merchants[\s\S]+from public, postgres, anon, authenticated, service_role/i,
  );
  assert.doesNotMatch(
    init,
    /revoke all privileges on table public\.merchants[^;]*cascade/i,
  );
  assert.match(
    init,
    /grant select, insert, update, delete on public\.merchants to service_role/i,
  );
  assert.match(
    init,
    /grant all privileges on table public\.merchants to current_user/i,
  );
  assert.match(readiness, /202608190040[\s\S]+merchant_acl_contract_hardening/i);
  assert.match(readiness, /acl_entry_count = 14/i);
  assert.match(
    readiness,
    /matrix\.principal = 'service_role'[\s\S]+matrix\.privilege_type IN\s*\([\s\S]+?'SELECT'[\s\S]+?'INSERT'[\s\S]+?'UPDATE'[\s\S]+?'DELETE'/i,
  );
  assert.match(acceptance, /rejecting merchant ACL unknown-principal drift/i);
  assert.match(
    runner,
    /rejecting a non-superuser postgres prerequisite[\s\S]+begin; set role supabase_admin; alter role postgres nosuperuser bypassrls;[\s\S]+merchant_acl_contract_hardening_prerequisite_missing/i,
  );
  assert.match(
    runner,
    /merchant_acl_postgres_prerequisite_state[\s\S]+rolsuper[\s\S]+count\(\*\) = 35[\s\S]+version = 202608190040/i,
  );
  assert.match(
    acceptance,
    /set role supabase_admin;[\s\S]+grant all privileges on table public\.merchants to current_user;[\s\S]+reset role;/i,
  );
  assert.match(acceptance, /rejecting merchant ACL delegated grant drift/i);
  assert.match(acceptance, /rejecting merchant column ACL drift/i);
  assert.match(acceptance, /rejecting merchant owner drift/i);
  assert.match(acceptance, /rejecting merchant policy drift/i);
  assert.match(acceptance, /accepting the exact merchant ACL target replay/i);
  assert.match(runner, /202608190040_merchant_acl_contract_hardening\.sql/i);
  assert.match(packageSource, /merchant-acl-contract-hardening-migration-contract\.test\.mjs/i);
});
