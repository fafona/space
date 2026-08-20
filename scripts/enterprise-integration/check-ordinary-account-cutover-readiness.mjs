import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import {
  ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
  parseOrdinaryAccountCutoverDatabaseReport,
  validateOrdinaryAccountCutoverExpectedEnvironment,
} from "../check-ordinary-account-cutover-readiness.mjs";

const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
assert.ok(databaseUrl, "DATABASE_URL is required");
const expectedStatus = String(
  process.env.FAOLLA_EXPECTED_READINESS_STATUS ?? "",
).trim();
assert.ok(
  ["blocked", "error", "ready"].includes(expectedStatus),
  "FAOLLA_EXPECTED_READINESS_STATUS must be blocked, error, or ready",
);
const expectedEnvironment =
  validateOrdinaryAccountCutoverExpectedEnvironment(process.env);

const result = spawnSync(
  "psql",
  [
    "-X",
    "--set=ON_ERROR_STOP=1",
    `--set=expected_database_name=${expectedEnvironment.FAOLLA_EXPECTED_DATABASE_NAME}`,
    `--set=expected_database_system_identifier=${expectedEnvironment.FAOLLA_EXPECTED_DATABASE_SYSTEM_IDENTIFIER}`,
    `--set=expected_merchant_record_count=${expectedEnvironment.FAOLLA_EXPECTED_MERCHANT_RECORD_COUNT}`,
    `--set=expected_personal_canonical_count=${expectedEnvironment.FAOLLA_EXPECTED_PERSONAL_CANONICAL_COUNT}`,
    "--no-psqlrc",
    "--quiet",
    "--tuples-only",
    "--no-align",
    "--command",
    "set role supabase_admin",
    "--file",
    "-",
    databaseUrl,
  ],
  {
    encoding: "utf8",
    env: process.env,
    input: ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    maxBuffer: 2 * 1024 * 1024,
    timeout: 120_000,
  },
);

assert.equal(result.signal, null, "readiness SQL was terminated by a signal");
assert.equal(result.error, undefined, "readiness SQL process failed to start");

if (expectedStatus === "error") {
  assert.notEqual(result.status, 0, "readiness SQL unexpectedly succeeded");
  console.log("Ordinary-account readiness expected error observed.");
  process.exit(0);
}

assert.equal(result.status, 0, "readiness SQL failed");

const report = parseOrdinaryAccountCutoverDatabaseReport(result.stdout);
assert.equal(report.readiness.schemaVersion, 1);
assert.equal(report.status, expectedStatus);

if (expectedStatus === "ready") {
  for (const key of [
    "databaseActorReady",
    "databaseIdentityReady",
    "baselineReady",
    "runtimeRpcHardeningReady",
    "migrationsReady",
    "functionMetadataReady",
    "functionAclReady",
    "registryAclReady",
    "objectContractsReady",
  ]) {
    assert.equal(report[key], true, `${key} must be true`);
  }
  assert.equal(report.readiness.readyForCutover, true);
  assert.equal(report.readiness.schemaReady, true);
  assert.equal(report.readiness.aclReady, true);
  assert.equal(report.databaseIdentity.primary, true);
  assert.equal(
    report.databaseIdentity.dbName,
    expectedEnvironment.FAOLLA_EXPECTED_DATABASE_NAME,
  );
  assert.equal(
    report.databaseIdentity.systemId,
    expectedEnvironment.FAOLLA_EXPECTED_DATABASE_SYSTEM_IDENTIFIER,
  );
}

console.log(
  `Ordinary-account readiness ${expectedStatus} expectation passed.`,
);
