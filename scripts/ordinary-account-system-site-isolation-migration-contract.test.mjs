import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202608190037_ordinary_account_system_site_principal_isolation.sql",
);
const acceptancePath = path.join(
  process.cwd(),
  "scripts",
  "enterprise-integration",
  "59-ordinary-account-system-site-principal-isolation.sql",
);
const runnerPath = path.join(
  process.cwd(),
  "scripts",
  "enterprise-integration",
  "run.sh",
);
const packagePath = path.join(process.cwd(), "package.json");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function statementFor(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `${label} statement is missing`);
  return match[0].trim();
}

function assertionForMessage(source, message) {
  const messageIndex = source.indexOf(`'${message}'`);
  assert.ok(messageIndex >= 0, `${message} assertion is missing`);
  const start = source.lastIndexOf(
    "select enterprise_integration.assert_true(",
    messageIndex,
  );
  const end = source.indexOf(");", messageIndex);
  assert.ok(start >= 0 && end > messageIndex, `${message} assertion is malformed`);
  return source.slice(start, end + 2);
}

test("037 selectively isolates only system-site principals shared with an ordinary plane", () => {
  const source = read(migrationPath);

  assert.doesNotMatch(
    source,
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
    "the production migration must derive principals relationally",
  );
  assert.match(source, /system_site\.id = 'site-main'/i);
  assert.match(source, /ordinary_merchant\.id <> 'site-main'/i);
  assert.match(source, /from public\.faolla_personal_accounts/i);
  assert.match(source, /from public\.merchant_enterprise_staff_identities/i);
  assert.match(
    source,
    /array_agg\([\s\S]+system_principal\.auth_user_id[\s\S]+join protected_principals/i,
  );

  for (const alias of [
    "user_id",
    "auth_user_id",
    "owner_user_id",
    "owner_id",
    "auth_id",
    "created_by",
    "created_by_user_id",
  ]) {
    assert.match(
      source,
      new RegExp(
        `set[\\s\\S]+${alias}\\s*=\\s*case[\\s\\S]+${alias}\\s*=\\s*any\\(v_overlap_auth_user_ids\\)[\\s\\S]+then null[\\s\\S]+else system_site\\.${alias}`,
        "i",
      ),
      `${alias} must be cleared only when it is in the overlap set`,
    );
  }

  assert.match(
    source,
    /update public\.merchants as system_site[\s\S]+where system_site\.id = 'site-main'[\s\S]+v_expected_update_count > 0/i,
  );
  assert.doesNotMatch(
    source,
    /update public\.(?:faolla_personal_accounts|merchant_enterprise_staff_identities)|(?:update|delete from) auth\.users/i,
  );
  assert.doesNotMatch(
    source,
    /set\s+(?:email|owner_email|contact_email|user_email)\s*=/i,
  );
  assert.match(source, /ordinary_account_system_site_isolation_content_drift/i);
  assert.match(source, /ordinary_account_system_site_isolation_alias_drift/i);
});

test("037 closes authenticated INSERT and UPDATE recontamination without blocking BYPASSRLS operations", () => {
  const source = read(migrationPath);
  const updatePolicy = statementFor(
    source,
    /create policy merchants_system_site_principal_isolation[\s\S]*?;/i,
    "restrictive UPDATE policy",
  );
  const insertPolicy = statementFor(
    source,
    /create policy merchants_system_site_principal_insert_isolation[\s\S]*?;/i,
    "restrictive INSERT policy",
  );

  assert.match(
    updatePolicy,
    /^create policy merchants_system_site_principal_isolation\s+on public\.merchants\s+as restrictive\s+for update\s+to authenticated\s+using \(id <> 'site-main'\)\s+with check \(id <> 'site-main'\);$/i,
  );
  assert.match(
    insertPolicy,
    /^create policy merchants_system_site_principal_insert_isolation\s+on public\.merchants\s+as restrictive\s+for insert\s+to authenticated\s+with check \(id <> 'site-main'\);$/i,
  );
  assert.match(
    source,
    /rolname = 'authenticated'[\s\S]+not role_metadata\.rolbypassrls/i,
  );
  assert.match(
    source,
    /rolname = 'service_role'[\s\S]+role_metadata\.rolbypassrls/i,
  );
  assert.match(source, /ordinary_account_system_site_isolation_policy_conflict/i);
  assert.match(source, /ordinary_account_system_site_isolation_registered_state_invalid/i);
  assert.match(source, /policy\.permissive = 'RESTRICTIVE'/i);
  assert.match(source, /policy\.roles = array\['authenticated'\]::name\[\]/i);
  assert.match(source, /policy\.cmd = 'UPDATE'/i);
  assert.match(source, /policy\.cmd = 'INSERT'/i);
  assert.match(source, /policy\.qual is null/i);
});

test("037 serializes with identity writers and proves the narrow readiness delta", () => {
  const source = read(migrationPath);
  const advisory = source.indexOf("pg_catalog.pg_advisory_xact_lock");
  const tableLock = source.toLowerCase().indexOf("lock table");
  const personalLock = source.indexOf("public.faolla_personal_accounts", tableLock);
  const merchantLock = source.indexOf("public.merchants", personalLock);

  assert.ok(advisory >= 0 && tableLock > advisory);
  assert.ok(personalLock > tableLock && merchantLock > personalLock);
  assert.match(source, /faolla:ordinary-account-binding-v1/i);
  assert.match(source, /in share row exclusive mode/i);
  assert.match(source, /ordinary_account_system_site_isolation_overlap_drift/i);
  assert.match(source, /systemSitePrincipalOverlapCount[\s\S]+<> 0/i);
  assert.match(
    source,
    /v_after_readiness - 'asOf' - 'readyForCutover'[\s\S]+#-[\s\S]+\{security,systemSitePrincipalOverlapCount\}[\s\S]+is distinct from/i,
  );
  assert.match(source, /ordinary_account_system_site_isolation_postcondition_failed/i);
  assert.match(source, /version = 202608190035/i);
  assert.match(source, /version = 202608190036/i);
  assert.match(source, /ordinary_account_system_site_isolation_registry_conflict/i);
  assert.match(
    source,
    /values \(\s*202608190037,\s*'ordinary_account_system_site_principal_isolation'\s*\)[\s\S]+notify pgrst, 'reload schema'[\s\S]+commit;\s*$/i,
  );
});

test("runner and real PostgreSQL acceptance cover conflict, retry, roles, and rollback", () => {
  const acceptance = read(acceptancePath);
  const runner = read(runnerPath);
  const packageSource = read(packagePath);
  const insertPolicyCatalog = assertionForMessage(
    acceptance,
    "037 restrictive site-main INSERT policy catalog drifted",
  );
  const absentSiteRollback = assertionForMessage(
    acceptance,
    "absent-site role probes did not roll back completely",
  );
  const absentSiteStart = acceptance.indexOf(
    "savepoint absent_site_insert_probes;",
  );
  const absentSiteEnd = acceptance.indexOf(
    "rollback to savepoint absent_site_insert_probes;",
    absentSiteStart,
  );
  assert.ok(absentSiteStart >= 0 && absentSiteEnd > absentSiteStart);
  const absentSiteProbes = acceptance.slice(
    absentSiteStart,
    absentSiteEnd + "rollback to savepoint absent_site_insert_probes;".length,
  );

  assert.match(runner, /ordinary_account_system_site_principal_isolation\.sql/i);
  assert.match(runner, /ordinary_account_system_site_isolation_registry_conflict/i);
  assert.match(runner, /ordinary_account_system_site_isolation_policy_conflict/i);
  assert.match(runner, /quote_all_identifiers=on/i);
  assert.match(runner, /retrying unregistered 037 with site-main absent/i);
  assert.match(runner, /system_site_absent_retry_verified=true/i);
  assert.match(runner, /59-ordinary-account-system-site-principal-isolation\.sql/i);

  assert.match(acceptance, /systemSitePrincipalOverlapCount/i);
  assert.match(acceptance, /owner_user_id = :'independent_system_auth'::uuid/i);
  assert.match(
    insertPolicyCatalog,
    /policyname\s*=\s*\n?\s*'merchants_system_site_principal_insert_isolation'/i,
  );
  assert.match(insertPolicyCatalog, /policy\.permissive = 'RESTRICTIVE'/i);
  assert.match(
    insertPolicyCatalog,
    /policy\.roles = array\['authenticated'\]::name\[\]/i,
  );
  assert.match(insertPolicyCatalog, /policy\.cmd = 'INSERT'/i);
  assert.match(insertPolicyCatalog, /policy\.qual is null/i);
  assert.match(
    insertPolicyCatalog,
    /coalesce\(policy\.with_check, ''\)[\s\S]+id<>''site-main''::text/i,
  );
  assert.match(
    absentSiteProbes,
    /delete from public\.merchants where id = 'site-main';[\s\S]+set role authenticated;[\s\S]+expect_error\([\s\S]+insert into public\.merchants\(id, name, user_id\)[\s\S]+site-main[\s\S]+new row violates row-level security policy[\s\S]+insert into public\.merchants\(id, name, user_id\)[\s\S]+19880003[\s\S]+authenticated ordinary merchant insert was blocked[\s\S]+reset role;/i,
  );
  assert.match(
    absentSiteProbes,
    /set role service_role;[\s\S]+insert into public\.merchants\(id, name, owner_user_id\)[\s\S]+site-main[\s\S]+service_role could not insert a missing site-main sentinel[\s\S]+reset role;[\s\S]+rollback to savepoint absent_site_insert_probes;/i,
  );
  assert.match(absentSiteRollback, /user_id is null/i);
  assert.match(absentSiteRollback, /auth_user_id is null/i);
  assert.match(
    absentSiteRollback,
    /owner_user_id = :'independent_system_auth'::uuid/i,
  );
  assert.match(absentSiteRollback, /where id = 'site-main'/i);
  assert.match(acceptance, /authenticated ordinary merchant update was blocked/i);
  assert.match(acceptance, /authenticated session updated site-main/i);
  assert.match(acceptance, /service_role platform ACL or BYPASSRLS prerequisite is missing/i);
  assert.match(acceptance, /service_role could not update site-main/i);
  assert.match(acceptance, /migration retry changed site-main updated_at/i);
  assert.match(acceptance, /migration retry with site-main absent was not verified/i);
  assert.match(acceptance, /absent-site role probes did not roll back completely/i);
  assert.doesNotMatch(
    acceptance,
    /grant\s+(?:select|insert|update)[\s\S]+on(?:\s+table)?\s+public\.merchants/i,
    "59 must verify the service-role ACL established before acceptance",
  );
  assert.match(acceptance, /rollback;\s*$/i);

  assert.match(
    packageSource,
    /"test:db-migrations":\s*"[^"]*ordinary-account-system-site-isolation-migration-contract\.test\.mjs/i,
  );
});
