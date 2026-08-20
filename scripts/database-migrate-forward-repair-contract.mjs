import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  parseOrdinaryAccountCutoverDatabaseReport,
} from "./check-ordinary-account-cutover-readiness.mjs";
import {
  canonicalJsonBytes,
  PRODUCTION_RELEASE_BASELINE_KEYS,
} from "./production-release-attestation.mjs";

export const DATABASE_MIGRATE_FORWARD_REPAIR = Object.freeze({
  schemaVersion: 1,
  version: "202608190040",
  name: "merchant_acl_contract_hardening",
  fileName: "202608190040_merchant_acl_contract_hardening.sql",
  path:
    "scripts/supabase-migrations/" +
    "202608190040_merchant_acl_contract_hardening.sql",
  sha256: "1b0bff4e67d490a07440d606b7182d77fd8952a9138e0743b8a7afc13de65cdd",
  confirmation: "APPLY_MERCHANT_ACL_FORWARD_REPAIR_202608190040",
});

const READINESS_BOOLEAN_KEYS = Object.freeze([
  "databaseActorReady",
  "databaseIdentityReady",
  "baselineReady",
  "runtimeRpcHardeningReady",
  "migrationsReady",
  "functionMetadataReady",
  "functionAclReady",
  "registryAclReady",
  "objectContractsReady",
]);
const OBJECT_COMPONENT_CODES = Object.freeze([
  "observer_schema",
  "merchant_contract",
  "personal_contract",
  "registry_structure",
  "forbidden_binder",
  "runtime_rpc_function_default_acl",
]);
const ACL_PRINCIPALS = Object.freeze([
  "PUBLIC",
  "supabase_admin",
  "postgres",
  "anon",
  "authenticated",
  "service_role",
]);
const TABLE_PRIVILEGES = Object.freeze([
  "INSERT",
  "SELECT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
]);
const PRESTATE_MATRIX_VIOLATIONS = Object.freeze([
  ...TABLE_PRIVILEGES.map((privilege) => `postgres:${privilege}`),
  ...TABLE_PRIVILEGES.map((privilege) => `anon:${privilege}`),
  ...["DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"].map(
    (privilege) => `authenticated:${privilege}`,
  ),
  ...["TRUNCATE", "REFERENCES", "TRIGGER"].map(
    (privilege) => `service_role:${privilege}`,
  ),
]);
const MIGRATION_REPORT_KEYS = Object.freeze([
  "ok",
  "schemaVersion",
  "mode",
  "databaseContainer",
  "through",
  "effectiveThrough",
  "registryExists",
  "discovered",
  "selected",
  "registeredVersions",
  "registered",
  "pending",
  "executed",
  "status",
]);
const MIGRATION_ENTRY_KEYS = Object.freeze([
  "version",
  "name",
  "fileName",
]);
const REGISTRY_ENTRY_KEYS = Object.freeze(["version", "name"]);
const VERSION_PATTERN = /^\d{12}$/;
const MIGRATION_NAME_PATTERN = /^[a-z][a-z0-9_]{0,159}$/;
const MIGRATION_FILE_PATTERN = /^\d{12}_[a-z][a-z0-9_]{0,159}\.sql$/;

export class DatabaseMigrateForwardRepairContractError extends Error {
  constructor(code) {
    super(code);
    this.name = "DatabaseMigrateForwardRepairContractError";
    this.code = code;
  }
}

function fail(code) {
  throw new DatabaseMigrateForwardRepairContractError(code);
}

export async function assertForwardRepairMigrationSource(rootDir) {
  const configuredRoot = path.resolve(rootDir ?? process.cwd());
  let canonicalRoot;
  let canonicalTarget;
  let details;
  let bytes;
  const targetPath = path.resolve(
    configuredRoot,
    DATABASE_MIGRATE_FORWARD_REPAIR.path,
  );
  try {
    canonicalRoot = await realpath(configuredRoot);
    canonicalTarget = await realpath(targetPath);
    details = await lstat(targetPath);
    bytes = await readFile(targetPath);
  } catch {
    fail("forward_repair_migration_source_unavailable");
  }
  if (
    canonicalRoot !== configuredRoot ||
    canonicalTarget !== targetPath ||
    path.relative(canonicalRoot, canonicalTarget) !==
      DATABASE_MIGRATE_FORWARD_REPAIR.path.replaceAll("/", path.sep) ||
    !details.isFile() ||
    details.isSymbolicLink() ||
    bytes.length <= 0 ||
    !/^[0-9a-f]{64}$/.test(
      DATABASE_MIGRATE_FORWARD_REPAIR.sha256 ?? "",
    ) ||
    createHash("sha256").update(bytes).digest("hex") !==
      DATABASE_MIGRATE_FORWARD_REPAIR.sha256
  ) {
    fail("forward_repair_migration_source_invalid");
  }
  return DATABASE_MIGRATE_FORWARD_REPAIR;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return (
    actual.length === sorted.length &&
    actual.every((key, index) => key === sorted[index])
  );
}

function exactArray(left, right) {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
  );
}

function parseReadinessCliReport(report, diagnosticExpected) {
  const expectedKeys = [
    "ok",
    "schemaVersion",
    "mode",
    "databaseContainer",
    "status",
    ...READINESS_BOOLEAN_KEYS,
    "databaseIdentity",
    "readiness",
    ...(diagnosticExpected ? ["objectContractDiagnostic"] : []),
  ];
  if (
    !exactKeys(report, expectedKeys) ||
    report.ok !== true ||
    report.schemaVersion !== 1 ||
    report.mode !== "read_only" ||
    typeof report.databaseContainer !== "string"
  ) {
    fail("forward_repair_readiness_report_invalid");
  }
  const databasePayload = Object.fromEntries(
    [
      ...READINESS_BOOLEAN_KEYS,
      "databaseIdentity",
      "readiness",
      ...(diagnosticExpected ? ["objectContractDiagnostic"] : []),
    ].map((key) => [key, report[key]]),
  );
  let parsed;
  try {
    parsed = parseOrdinaryAccountCutoverDatabaseReport(
      JSON.stringify(databasePayload),
    );
  } catch {
    fail("forward_repair_readiness_report_invalid");
  }
  if (
    !isDeepStrictEqual(
      report,
      {
        ok: true,
        schemaVersion: 1,
        mode: "read_only",
        databaseContainer: report.databaseContainer,
        ...parsed,
      },
    )
  ) {
    fail("forward_repair_readiness_report_invalid");
  }
  return parsed;
}

function assertExpectedIdentityAndBaseline(
  report,
  expectedDatabase,
  expectedBaseline,
) {
  if (
    !exactKeys(expectedDatabase, [
      "containerName",
      "containerId",
      "dbName",
      "dbOid",
      "systemId",
      "primary",
    ]) ||
    !exactKeys(expectedBaseline, PRODUCTION_RELEASE_BASELINE_KEYS)
  ) {
    fail("forward_repair_expected_evidence_invalid");
  }
  const actualDatabase = {
    containerName: report.databaseContainer,
    containerId: expectedDatabase.containerId,
    dbName: report.databaseIdentity?.dbName,
    dbOid: report.databaseIdentity?.dbOid,
    systemId: report.databaseIdentity?.systemId,
    primary: report.databaseIdentity?.primary,
  };
  const actualBaseline = Object.fromEntries(
    PRODUCTION_RELEASE_BASELINE_KEYS.map((key) => [
      key,
      key === "ordinaryIdentityContentSha256"
        ? report.readiness?.[key]
        : String(report.readiness?.[key]),
    ]),
  );
  if (
    !canonicalJsonBytes(actualDatabase).equals(
      canonicalJsonBytes(expectedDatabase),
    ) ||
    !canonicalJsonBytes(actualBaseline).equals(
      canonicalJsonBytes(expectedBaseline),
    )
  ) {
    fail("forward_repair_attested_state_mismatch");
  }
}

function expectedPrestateAclEntries() {
  return ACL_PRINCIPALS.flatMap((principal) =>
    TABLE_PRIVILEGES.map((privilegeType) => {
      const count = principal === "PUBLIC" ? 0 : 1;
      return {
        principal,
        privilegeType,
        entryCount: count,
        ownerGrantorCount: count,
        grantableCount: 0,
      };
    }),
  );
}

function expectedPrestateViolations() {
  return [
    {
      code: "merchant_acl_entry_count_invalid",
      target: "public.merchants",
    },
    ...PRESTATE_MATRIX_VIOLATIONS.map((target) => ({
      code: "merchant_acl_matrix_invalid",
      target,
    })),
  ];
}

export function assertForwardRepairPreflightState(parsed) {
  const expectedBooleans = {
    databaseActorReady: true,
    databaseIdentityReady: true,
    baselineReady: true,
    runtimeRpcHardeningReady: true,
    migrationsReady: false,
    functionMetadataReady: true,
    functionAclReady: true,
    registryAclReady: true,
    objectContractsReady: false,
  };
  if (
    parsed.status !== "blocked" ||
    !isDeepStrictEqual(
      Object.fromEntries(
        READINESS_BOOLEAN_KEYS.map((key) => [key, parsed[key]]),
      ),
      expectedBooleans,
    ) ||
    parsed.readiness.readyForCutover !== true ||
    parsed.readiness.schemaReady !== true ||
    parsed.readiness.aclReady !== true
  ) {
    fail("forward_repair_preflight_health_invalid");
  }

  const diagnostic = parsed.objectContractDiagnostic;
  const components = diagnostic?.components;
  if (
    diagnostic?.ready !== false ||
    diagnostic.componentCount !== OBJECT_COMPONENT_CODES.length ||
    diagnostic.failedComponentCount !== 1 ||
    diagnostic.violationCount !== 22 ||
    !Array.isArray(components) ||
    !exactArray(
      components.map((component) => component?.code),
      OBJECT_COMPONENT_CODES,
    ) ||
    components.some((component, index) =>
      index === 1
        ? component.ready !== false || component.violationCount !== 22
        : component.ready !== true || component.violationCount !== 0,
    )
  ) {
    fail("forward_repair_preflight_object_contract_invalid");
  }
  const merchant = components[1];
  if (
    merchant.facts?.aclEntryCount !== 35 ||
    merchant.facts.unknownPrincipalEntryCount !== 0 ||
    merchant.facts.unknownPrivilegeEntryCount !== 0 ||
    !isDeepStrictEqual(
      merchant.facts.aclEntries,
      expectedPrestateAclEntries(),
    ) ||
    !isDeepStrictEqual(merchant.violations, expectedPrestateViolations())
  ) {
    fail("forward_repair_preflight_acl_prestate_invalid");
  }
  return parsed;
}

export function assertForwardRepairPreflightReport(
  report,
  expectedDatabase,
  expectedBaseline,
) {
  const parsed = parseReadinessCliReport(report, true);
  assertExpectedIdentityAndBaseline(
    {
      databaseContainer: report.databaseContainer,
      ...parsed,
    },
    expectedDatabase,
    expectedBaseline,
  );
  assertForwardRepairPreflightState(parsed);
  return report;
}

export function assertForwardRepairPostflightState(parsed) {
  if (
    parsed.status !== "ready" ||
    READINESS_BOOLEAN_KEYS.some((key) => parsed[key] !== true) ||
    parsed.readiness?.readyForCutover !== true ||
    parsed.readiness.schemaReady !== true ||
    parsed.readiness.aclReady !== true ||
    Object.hasOwn(parsed, "objectContractDiagnostic")
  ) {
    fail("forward_repair_postflight_health_invalid");
  }
  return parsed;
}

export function assertForwardRepairPostflightReport(
  report,
  expectedDatabase,
  expectedBaseline,
) {
  const parsed = parseReadinessCliReport(report, false);
  assertExpectedIdentityAndBaseline(
    {
      databaseContainer: report.databaseContainer,
      ...parsed,
    },
    expectedDatabase,
    expectedBaseline,
  );
  assertForwardRepairPostflightState(parsed);
  return report;
}

function migrationEntry(value) {
  return (
    exactKeys(value, MIGRATION_ENTRY_KEYS) &&
    VERSION_PATTERN.test(value.version) &&
    MIGRATION_NAME_PATTERN.test(value.name) &&
    MIGRATION_FILE_PATTERN.test(value.fileName) &&
    value.fileName === `${value.version}_${value.name}.sql`
  );
}

function registryEntry(value) {
  return (
    exactKeys(value, REGISTRY_ENTRY_KEYS) &&
    VERSION_PATTERN.test(value.version) &&
    MIGRATION_NAME_PATTERN.test(value.name)
  );
}

function sameMigration(left, right) {
  return (
    left?.version === right?.version &&
    left?.name === right?.name &&
    left?.fileName === right?.fileName
  );
}

function targetMigration() {
  return {
    version: DATABASE_MIGRATE_FORWARD_REPAIR.version,
    name: DATABASE_MIGRATE_FORWARD_REPAIR.name,
    fileName: DATABASE_MIGRATE_FORWARD_REPAIR.fileName,
  };
}

function assertMigrationReportCommon(report, expectedContainer, mode, status) {
  if (
    !exactKeys(report, MIGRATION_REPORT_KEYS) ||
    report.ok !== true ||
    report.schemaVersion !== 1 ||
    report.mode !== mode ||
    report.status !== status ||
    report.databaseContainer !== expectedContainer ||
    report.through !== DATABASE_MIGRATE_FORWARD_REPAIR.version ||
    report.effectiveThrough !== DATABASE_MIGRATE_FORWARD_REPAIR.version ||
    report.registryExists !== true ||
    !Array.isArray(report.discovered) ||
    !Array.isArray(report.selected) ||
    !Array.isArray(report.registeredVersions) ||
    !Array.isArray(report.registered) ||
    !Array.isArray(report.pending) ||
    !Array.isArray(report.executed) ||
    report.discovered.some((entry) => !migrationEntry(entry)) ||
    report.selected.some((entry) => !migrationEntry(entry)) ||
    report.registered.some((entry) => !registryEntry(entry)) ||
    report.pending.some((entry) => !migrationEntry(entry)) ||
    report.executed.some((entry) => !migrationEntry(entry))
  ) {
    fail("forward_repair_migration_report_invalid");
  }
  const target = targetMigration();
  const targetIndexes = report.discovered.flatMap((entry, index) =>
    sameMigration(entry, target) ? [index] : [],
  );
  if (targetIndexes.length !== 1) {
    fail("forward_repair_target_inventory_invalid");
  }
  const expectedSelected = report.discovered.slice(0, targetIndexes[0] + 1);
  if (
    expectedSelected.length === 0 ||
    !isDeepStrictEqual(report.selected, expectedSelected) ||
    !sameMigration(report.selected.at(-1), target)
  ) {
    fail("forward_repair_selected_prefix_invalid");
  }
  return { target, expectedSelected };
}

function assertRegistryMatches(report, expectedMigrations) {
  const versions = expectedMigrations.map((entry) => entry.version);
  const registered = expectedMigrations.map(({ version, name }) => ({
    version,
    name,
  }));
  if (
    !isDeepStrictEqual(report.registeredVersions, versions) ||
    !isDeepStrictEqual(report.registered, registered)
  ) {
    fail("forward_repair_registry_prefix_invalid");
  }
}

export function assertForwardRepairDryRunReport(report, expectedContainer) {
  const { target, expectedSelected } = assertMigrationReportCommon(
    report,
    expectedContainer,
    "dry_run",
    "dry_run",
  );
  assertRegistryMatches(report, expectedSelected.slice(0, -1));
  if (
    !isDeepStrictEqual(report.pending, [target]) ||
    report.executed.length !== 0
  ) {
    fail("forward_repair_dry_run_state_invalid");
  }
  return report;
}

export function assertForwardRepairApplyReport(report, expectedContainer) {
  const { target, expectedSelected } = assertMigrationReportCommon(
    report,
    expectedContainer,
    "apply",
    "applied",
  );
  assertRegistryMatches(report, expectedSelected);
  if (
    !isDeepStrictEqual(report.pending, [target]) ||
    !isDeepStrictEqual(report.executed, [target])
  ) {
    fail("forward_repair_apply_state_invalid");
  }
  return report;
}

export function assertForwardRepairPostDryRunReport(report, expectedContainer) {
  const { expectedSelected } = assertMigrationReportCommon(
    report,
    expectedContainer,
    "dry_run",
    "dry_run",
  );
  assertRegistryMatches(report, expectedSelected);
  if (report.pending.length !== 0 || report.executed.length !== 0) {
    fail("forward_repair_post_dry_run_state_invalid");
  }
  return report;
}
