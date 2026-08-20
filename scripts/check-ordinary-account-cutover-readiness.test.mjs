import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
  OrdinaryAccountCutoverReadinessError,
  checkOrdinaryAccountCutoverReadiness,
  parseOrdinaryAccountCutoverDatabaseReport,
  parseOrdinaryAccountCutoverReadinessArguments,
  runOrdinaryAccountCutoverReadinessCli,
  validateOrdinaryAccountCutoverExpectedEnvironment,
} from "./check-ordinary-account-cutover-readiness.mjs";

function topology(name = "supabase-db") {
  return {
    available: true,
    databaseCandidates: [
      {
        name,
        probeSucceeded: true,
        tools: { psql: true, databaseConfigured: true },
      },
    ],
  };
}

function lockProbe() {
  let released = false;
  return {
    lock: { async release() { released = true; } },
    wasReleased: () => released,
  };
}

function commandResult(stdout, status = 0) {
  return { status, stdout, stderr: "", timedOut: false, error: null };
}

function expectedEnvironment(overrides = {}) {
  return {
    FAOLLA_EXPECTED_DATABASE_NAME: "faolla",
    FAOLLA_EXPECTED_DATABASE_SYSTEM_IDENTIFIER: "7451234567890123456",
    FAOLLA_EXPECTED_MERCHANT_RECORD_COUNT: "9",
    FAOLLA_EXPECTED_PERSONAL_CANONICAL_COUNT: "4",
    ...overrides,
  };
}

function readiness(overrides = {}) {
  return {
    schemaVersion: 1,
    asOf: "2026-08-20T04:00:00.000Z",
    readyForCutover: true,
    merchantRecordCount: 9,
    merchantAuthoritativeBindingCount: 9,
    merchantInvalidBindingCount: 0,
    personalCanonicalBindingCount: 4,
    personalCanonicalOrphanCount: 0,
    personalInvalidCanonicalCount: 0,
    personalDuplicateAuthUserCount: 0,
    personalDuplicateAccountIdCount: 0,
    crossAccountTypeOverlapCount: 0,
    accountIdentifierCollisionCount: 0,
    staffRegistryOverlapCount: 0,
    systemSitePrincipalOverlapCount: 0,
    schemaReady: true,
    aclReady: true,
    ...overrides,
  };
}

function databaseIdentity(overrides = {}) {
  return {
    dbName: "faolla",
    dbOid: "16384",
    systemId: "7451234567890123456",
    primary: true,
    ...overrides,
  };
}

function databaseReport(overrides = {}) {
  return {
    databaseActorReady: true,
    databaseIdentity: databaseIdentity(),
    databaseIdentityReady: true,
    baselineReady: true,
    runtimeRpcHardeningReady: true,
    migrationsReady: true,
    functionMetadataReady: true,
    functionAclReady: true,
    registryAclReady: true,
    objectContractsReady: true,
    readiness: readiness(),
    ...overrides,
  };
}

test("the production probe is one read-only transaction with the exact runtime hardening gate", () => {
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /BEGIN TRANSACTION READ ONLY;/);
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /SET LOCAL quote_all_identifiers = off;/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /SET LOCAL search_path = pg_catalog, public;/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /'primary', NOT pg_catalog\.pg_is_in_recovery\(\)/,
  );
  assert.ok(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL.indexOf(
      "SET LOCAL quote_all_identifiers = off;",
    ) < ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL.indexOf("$migrator_preflight$"),
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /pg_advisory_xact_lock\(20260731, 1\)/,
  );
  const catalogs = [
    "pg_database",
    "pg_authid",
    "pg_auth_members",
    "pg_namespace",
    "pg_language",
    "pg_type",
    "pg_collation",
    "pg_am",
    "pg_opclass",
    "pg_proc",
    "pg_default_acl",
    "pg_class",
    "pg_attribute",
    "pg_attrdef",
    "pg_index",
    "pg_constraint",
    "pg_trigger",
    "pg_policy",
    "pg_rewrite",
    "pg_inherits",
  ];
  for (const catalog of catalogs) {
    assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, new RegExp(`pg_catalog\\.${catalog}`));
  }
  const catalogLockStart = ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL.indexOf(
    "pg_catalog.pg_database,",
  );
  const catalogLockEnd = ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL.indexOf(
    "IN SHARE ROW EXCLUSIVE MODE;",
    catalogLockStart,
  );
  const catalogLockSql = ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL.slice(
    catalogLockStart,
    catalogLockEnd,
  );
  let precedingCatalog = -1;
  for (const catalog of catalogs) {
    const position = catalogLockSql.indexOf(`pg_catalog.${catalog}`);
    assert.ok(position > precedingCatalog, `${catalog} must keep the fixed catalog-lock order`);
    precedingCatalog = position;
  }
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /pg_stat_clear_snapshot\(\)/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /activity\.backend_xid is not null/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /pg_catalog\.pg_prepared_xacts/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /\$role_graph_postcondition\$/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /\$definition_postcondition\$/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /\$registry_postcondition\$/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /ROLLBACK;/);
  const executableSql = ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL
    .replace(/--[^\n]*/g, "")
    .replace(/'(?:''|[^'])*'/gs, "''");
  assert.doesNotMatch(
    executableSql,
    /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE)\b/i,
  );
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /202608190035/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /202608190039/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /current_user = 'supabase_admin'/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /pg_catalog\.current_database\(\) = :'expected_database_name'/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /pg_catalog\.pg_control_system\(\)/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /:'expected_database_system_identifier'::numeric/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /:'expected_merchant_record_count'::numeric/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /:'expected_personal_canonical_count'::numeric/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /registry\.relrowsecurity/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /attribute\.attacl IS NOT NULL/);
  const dataLock = ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL.indexOf("auth.users,");
  const catalogLock = ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL.indexOf("pg_catalog.pg_database,");
  const registryLock = ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL.indexOf(
    "LOCK TABLE public.faolla_schema_migrations IN SHARE ROW EXCLUSIVE MODE;",
  );
  const quiescence = ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL.indexOf(
    "$catalog_quiescence_postlock$",
  );
  assert.ok(dataLock > 0 && dataLock < catalogLock);
  assert.ok(catalogLock < quiescence && quiescence < registryLock);
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /auth\.users,[\s\S]*public\.merchant_enterprise_employees,[\s\S]*public\.merchant_enterprise_staff_identities,[\s\S]*public\.faolla_personal_accounts,[\s\S]*public\.merchants[\s\S]*IN SHARE MODE;/,
  );
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /expected_observer_relation/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /relation\.relkind <> 'r'/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /relation\.relpersistence <> 'p'/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /relation\.relispartition/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /expected_observer_column/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /14 = \(SELECT count\(\*\) FROM expected_observer_column\)/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /attribute\.attnum > 0/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /attribute\.atttypmod = expected\.type_modifier/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /attribute\.attnotnull = expected\.not_null/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /expected_merchant_policy/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /merchants_system_site_principal_insert_isolation/);
  for (const hash of [
    "42205aae07118e35699a5507ffe3385a",
    "899af52ac5bbc8824aa635183199f48a",
    "1c08e1341a191bbc45013950a337671d",
  ]) {
    assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, new RegExp(hash));
  }
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /personal_contract_state/);
  for (const hash of [
    "6c6a7472c2d303e319253578fc2a745a",
    "8b4bd9cb5a89caab86807b61eb21151c",
    "33e5475c2422f3c8d2ae88010bcee42a",
    "ba66117c8f4124ec62639bc9756ee764",
  ]) {
    assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, new RegExp(hash));
  }
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /registry_structure_state/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /constraint_metadata\.condeferrable/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /constraint_metadata\.conname = 'faolla_schema_migrations_pkey'/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /index_relation\.relname = 'faolla_schema_migrations_pkey'/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /relreplident = 'd'/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /to_regcollation\('pg_catalog\.default'\)/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /function_metadata\.proname =[\s\S]*'faolla_bind_ordinary_account_authorization_v1'[\s\S]*function_metadata\.pronamespace = to_regnamespace\('public'\)/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /creator_default_acl_state/);
  const relevantCreatorSql = ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL.slice(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL.indexOf(
      "relevant_creator AS MATERIALIZED",
    ),
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL.indexOf(
      "creator_default_acl_state AS MATERIALIZED",
    ),
  );
  assert.doesNotMatch(relevantCreatorSql, /pg_default_acl/);
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /default_acl\.defaclobjtype = 'f'[\s\S]*OR EXISTS \([\s\S]*default_acl\.defaclobjtype = 'f'/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /default_acl\.defaclnamespace = 0[\s\S]*OR EXISTS \([\s\S]*default_acl\.defaclobjtype = 'f'/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /'runtimeRpcHardeningReady', \(SELECT ready FROM creator_default_acl_state\)/,
  );
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /'objectContractsReady'/);
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /'pg_catalog\.trigger'::regtype, false/g,
  );
});

test("the nine bridge and guard definition hashes are derived from the frozen migration sources", async () => {
  const migration035 = await readFile(
    new URL("./supabase-migrations/202608190035_ordinary_account_authorization_foundation.sql", import.meta.url),
    "utf8",
  );
  const migration036 = await readFile(
    new URL("./supabase-migrations/202608190036_ordinary_account_authorization_bootstrap.sql", import.meta.url),
    "utf8",
  );
  const migration038 = await readFile(
    new URL("./supabase-migrations/202608190038_ordinary_account_recovery_observer.sql", import.meta.url),
    "utf8",
  );
  const functions = [
    ["faolla_resolve_ordinary_account_authorization_v1", migration036],
    ["faolla_get_ordinary_account_authorization_readiness_v1", migration035],
    ["faolla_create_ordinary_account_authorization_v1", migration036],
    ["faolla_bootstrap_ordinary_account_authorization_v1", migration036],
    ["faolla_get_ordinary_account_authoritative_cutover_readiness_v1", migration036],
    ["faolla_observe_ordinary_account_recovery_v1", migration038],
    ["faolla_guard_personal_account_binding_v1", migration035],
    ["faolla_guard_staff_identity_ordinary_exclusion_v1", migration036],
    ["faolla_guard_auth_user_ordinary_account_delete_v1", migration036],
  ];
  for (const [name, source] of functions) {
    const pattern = new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\((.*?)\\)\\s*returns[\\s\\S]*?as\\s+\\$\\$([\\s\\S]*?)\\$\\$;`,
      "gis",
    );
    const matches = [...source.matchAll(pattern)];
    assert.ok(matches.length > 0, `${name} must exist in its source migration`);
    const body = String(matches.at(-1)[2]).replaceAll("\r\n", "\n");
    const hash = createHash("md5").update(body, "utf8").digest("hex");
    assert.match(
      ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
      new RegExp(`${name.replaceAll("_", "_")}[\\s\\S]{0,220}${hash}`),
      `${name} readiness hash must follow the migration body`,
    );
  }
});

test("the PostgreSQL integration runner executes the fixed production readiness SQL", async () => {
  const runner = await readFile(
    new URL("./enterprise-integration/run.sh", import.meta.url),
    "utf8",
  );
  const wrapper = await readFile(
    new URL(
      "./enterprise-integration/check-ordinary-account-cutover-readiness.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const driftMatrix = await readFile(
    new URL(
      "./enterprise-integration/62-ordinary-account-cutover-readiness-gate.sh",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    runner,
    /node "\$\{SCRIPT_DIR\}\/check-ordinary-account-cutover-readiness\.mjs"/,
  );
  assert.match(runner, /FAOLLA_EXPECTED_READINESS_STATUS=blocked/);
  assert.match(
    runner,
    /\. "\$\{SCRIPT_DIR\}\/62-ordinary-account-cutover-readiness-gate\.sh"/,
  );
  for (const variable of [
    "FAOLLA_EXPECTED_DATABASE_NAME",
    "FAOLLA_EXPECTED_DATABASE_SYSTEM_IDENTIFIER",
    "FAOLLA_EXPECTED_MERCHANT_RECORD_COUNT",
    "FAOLLA_EXPECTED_PERSONAL_CANONICAL_COUNT",
  ]) {
    assert.match(runner, new RegExp(`export ${variable}=`));
  }
  for (const variable of [
    "expected_database_name",
    "expected_database_system_identifier",
    "expected_merchant_record_count",
    "expected_personal_canonical_count",
  ]) {
    assert.match(wrapper, new RegExp(`--set=${variable}=`));
  }
  const merchantAclNormalization = runner.indexOf(
    "revoke select, insert, update on table public.merchants from service_role;",
  );
  const readinessInvocation = runner.indexOf(
    'node "${SCRIPT_DIR}/check-ordinary-account-cutover-readiness.mjs"',
  );
  assert.ok(
    merchantAclNormalization > 0 && merchantAclNormalization < readinessInvocation,
  );
  assert.match(wrapper, /\["blocked", "error", "ready"\]/);
  assert.match(wrapper, /FAOLLA_EXPECTED_READINESS_STATUS/);
  assert.match(wrapper, /objectContractsReady/);
  assert.doesNotMatch(wrapper, /result\.stderr/);
  for (const contract of [
    "normalizing the disposable fixture",
    "guard body drift",
    "observer ACL drift",
    "restrictive-policy expression drift",
    "merchant TRUNCATE and custom table grants",
    "referenced 038 column rename",
    "personal CHECK-expression drift",
    "extra NOT VALID personal CHECK",
    "personal rule",
    "personal inheritance child",
    "unlogged registry",
    "registry rule",
    "deferrable registry primary key",
    "public forbidden-binder signature",
    "non-public unsafe function default ACL",
    "+1 merchant baseline drift",
    "quote_all_identifiers=on",
    "search_path=public,pg_catalog",
    "readiness-held locks block business DML",
    "readiness-held locks block ALTER POLICY",
  ]) {
    assert.match(driftMatrix, new RegExp(contract.replaceAll("+", "\\+")));
  }
  assert.match(
    driftMatrix,
    /FAOLLA_EXPECTED_READINESS_STATUS=ready[\s\S]*pg_catalog\.pg_inherits[\s\S]*ShareRowExclusiveLock/,
  );
  const guardDefinitions = [...driftMatrix.matchAll(
    /create or replace function\s+public\.faolla_guard_personal_account_binding_v1\(\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/gi,
  )];
  assert.equal(guardDefinitions.length, 2);
  assert.equal(
    createHash("md5")
      .update(String(guardDefinitions.at(-1)[1]).replaceAll("\r\n", "\n"), "utf8")
      .digest("hex"),
    "9e5572f34a178da6551efda74751ba18",
  );
  assert.match(
    driftMatrix,
    /U&'\\0009\\000A[\s\S]*\\3000\\FEFF'/,
  );
  assert.match(
    driftMatrix,
    /ordinary_readiness_personal_safe_restore_hash_invalid/,
  );
  assert.match(driftMatrix, /6c6a7472c2d303e319253578fc2a745a/);
});

test("argument parser exposes only JSON and fail-on-blocked controls", () => {
  assert.deepEqual(
    parseOrdinaryAccountCutoverReadinessArguments(["--json", "--fail-on-blocked"]),
    { json: true, failOnBlocked: true },
  );
  assert.throws(
    () => parseOrdinaryAccountCutoverReadinessArguments(["--sql=select 1"]),
    (error) =>
      error instanceof OrdinaryAccountCutoverReadinessError &&
      error.code === "ordinary_account_readiness_argument_unknown",
  );
});

test("expected production identity and baselines are strict canonical values", () => {
  assert.deepEqual(
    validateOrdinaryAccountCutoverExpectedEnvironment(
      expectedEnvironment({
        FAOLLA_EXPECTED_DATABASE_NAME: " faolla ",
        FAOLLA_EXPECTED_MERCHANT_RECORD_COUNT: " 9 ",
      }),
    ),
    expectedEnvironment(),
  );
  for (const [name, value, code] of [
    [
      "FAOLLA_EXPECTED_DATABASE_NAME",
      "faolla;select",
      "ordinary_account_readiness_expected_database_name_invalid",
    ],
    [
      "FAOLLA_EXPECTED_DATABASE_SYSTEM_IDENTIFIER",
      "0",
      "ordinary_account_readiness_expected_database_system_identifier_invalid",
    ],
    [
      "FAOLLA_EXPECTED_DATABASE_SYSTEM_IDENTIFIER",
      "18446744073709551616",
      "ordinary_account_readiness_expected_database_system_identifier_invalid",
    ],
    [
      "FAOLLA_EXPECTED_MERCHANT_RECORD_COUNT",
      "0",
      "ordinary_account_readiness_expected_merchant_record_count_invalid",
    ],
    [
      "FAOLLA_EXPECTED_PERSONAL_CANONICAL_COUNT",
      "04",
      "ordinary_account_readiness_expected_personal_canonical_count_invalid",
    ],
  ]) {
    assert.throws(
      () =>
        validateOrdinaryAccountCutoverExpectedEnvironment(
          expectedEnvironment({ [name]: value }),
        ),
      (error) =>
        error instanceof OrdinaryAccountCutoverReadinessError &&
        error.code === code,
      `${name}=${value}`,
    );
  }
});

test("database report parser validates the exact aggregate shape", () => {
  const parsed = parseOrdinaryAccountCutoverDatabaseReport(
    `${JSON.stringify(databaseReport())}\n`,
  );
  assert.equal(parsed.status, "ready");
  assert.equal(parsed.readiness.merchantRecordCount, 9);
  assert.deepEqual(parsed.databaseIdentity, databaseIdentity());

  assert.equal(
    parseOrdinaryAccountCutoverDatabaseReport(
      JSON.stringify(databaseReport({ baselineReady: false })),
    ).status,
    "blocked",
  );

  assert.equal(
    parseOrdinaryAccountCutoverDatabaseReport(
      JSON.stringify(databaseReport({ objectContractsReady: false })),
    ).status,
    "blocked",
  );

  const blocked = databaseReport({
    readiness: readiness({
      readyForCutover: false,
      merchantAuthoritativeBindingCount: 8,
      merchantInvalidBindingCount: 1,
    }),
  });
  assert.equal(
    parseOrdinaryAccountCutoverDatabaseReport(JSON.stringify(blocked)).status,
    "blocked",
  );
  assert.throws(
    () => parseOrdinaryAccountCutoverDatabaseReport(JSON.stringify({ ...databaseReport(), row: {} })),
    /ordinary_account_readiness_output_invalid/,
  );
  for (const identity of [
    databaseIdentity({ dbOid: "0" }),
    databaseIdentity({ systemId: "18446744073709551616" }),
    databaseIdentity({ primary: "true" }),
    { ...databaseIdentity(), extra: true },
  ]) {
    assert.throws(
      () =>
        parseOrdinaryAccountCutoverDatabaseReport(
          JSON.stringify(databaseReport({ databaseIdentity: identity })),
        ),
      /ordinary_account_readiness_output_invalid/,
    );
  }
  assert.throws(
    () => parseOrdinaryAccountCutoverDatabaseReport("not-json"),
    /ordinary_account_readiness_output_invalid/,
  );
});

test("the package readiness command fails a blocked gate", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageJson.scripts["check:ordinary-account-cutover-readiness"],
    "node scripts/check-ordinary-account-cutover-readiness.mjs --fail-on-blocked",
  );
});

test("read-only inspection uses the selected database and always releases the mutex", async () => {
  const calls = [];
  const lock = lockProbe();
  const report = await checkOrdinaryAccountCutoverReadiness({
    env: expectedEnvironment(),
    selfHostedTopology: topology(),
    acquireLock: async () => lock.lock,
    runCommand: async (command, args, options) => {
      calls.push({ command, args, options });
      return commandResult(`${JSON.stringify(databaseReport())}\n`);
    },
  });
  assert.equal(report.status, "ready");
  assert.equal(report.mode, "read_only");
  assert.equal(report.databaseContainer, "supabase-db");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "docker");
  assert.deepEqual(calls[0].args.slice(0, -3), [
    "exec",
    "-i",
    "--env",
    "FAOLLA_EXPECTED_DATABASE_NAME=faolla",
    "--env",
    "FAOLLA_EXPECTED_DATABASE_SYSTEM_IDENTIFIER=7451234567890123456",
    "--env",
    "FAOLLA_EXPECTED_MERCHANT_RECORD_COUNT=9",
    "--env",
    "FAOLLA_EXPECTED_PERSONAL_CANONICAL_COUNT=4",
    "supabase-db",
  ]);
  assert.match(calls[0].args.at(-1), /--set=expected_database_name=/);
  assert.equal(calls[0].options.input, ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL);
  assert.equal(lock.wasReleased(), true);
});

test("invalid expected production metadata is rejected before locking or Docker", async () => {
  let lockAttempted = false;
  let commandAttempted = false;
  await assert.rejects(
    checkOrdinaryAccountCutoverReadiness({
      env: expectedEnvironment({
        FAOLLA_EXPECTED_DATABASE_NAME: "faolla;select",
      }),
      selfHostedTopology: topology(),
      acquireLock: async () => {
        lockAttempted = true;
        return lockProbe().lock;
      },
      runCommand: async () => {
        commandAttempted = true;
        return commandResult(`${JSON.stringify(databaseReport())}\n`);
      },
    }),
    /ordinary_account_readiness_expected_database_name_invalid/,
  );
  assert.equal(lockAttempted, false);
  assert.equal(commandAttempted, false);
});

test("readiness uses the production migration mutex without lock injection", async () => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "faolla-ordinary-readiness-lock-"),
  );
  const lockPath = join(temporaryDirectory, "readiness.lock");
  try {
    const report = await checkOrdinaryAccountCutoverReadiness({
      env: expectedEnvironment(),
      selfHostedTopology: topology(),
      lockPath,
      runCommand: async () =>
        commandResult(`${JSON.stringify(databaseReport())}\n`),
    });
    assert.equal(report.status, "ready");
    await assert.rejects(access(lockPath), (error) => error?.code === "ENOENT");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("query and topology failures are fail-closed without leaking command output", async () => {
  const lock = lockProbe();
  await assert.rejects(
    checkOrdinaryAccountCutoverReadiness({
      env: expectedEnvironment(),
      selfHostedTopology: topology(),
      acquireLock: async () => lock.lock,
      runCommand: async () => commandResult("sensitive-row", 1),
    }),
    (error) =>
      error instanceof OrdinaryAccountCutoverReadinessError &&
      error.code === "ordinary_account_readiness_query_failed",
  );
  assert.equal(lock.wasReleased(), true);
  await assert.rejects(
    checkOrdinaryAccountCutoverReadiness({
      env: expectedEnvironment(),
      selfHostedTopology: { available: false, databaseCandidates: [] },
    }),
    /ordinary_account_readiness_topology_unavailable/,
  );
});

test("CLI emits aggregate-only JSON and can fail a blocked release gate", async () => {
  const stdout = [];
  const stderr = [];
  const readyReport = {
    schemaVersion: 1,
    mode: "read_only",
    databaseContainer: "supabase-db",
    ...parseOrdinaryAccountCutoverDatabaseReport(JSON.stringify(databaseReport())),
  };
  const readyCode = await runOrdinaryAccountCutoverReadinessCli({
    argv: ["--json", "--fail-on-blocked"],
    execute: async () => readyReport,
    writeStdout: (value) => stdout.push(value),
    writeStderr: (value) => stderr.push(value),
  });
  assert.equal(readyCode, 0);
  assert.equal(stderr.length, 0);
  assert.equal(JSON.parse(stdout.join("")).status, "ready");

  const blockedCode = await runOrdinaryAccountCutoverReadinessCli({
    argv: ["--json", "--fail-on-blocked"],
    execute: async () => ({ ...readyReport, status: "blocked" }),
    writeStdout: () => {},
    writeStderr: () => {},
  });
  assert.equal(blockedCode, 2);
});
