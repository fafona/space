import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
  OrdinaryAccountCutoverReadinessError,
  PLATFORM_FUNCTION_DEFAULT_ACL_EXPECTED,
  checkOrdinaryAccountCutoverReadiness,
  parseOrdinaryAccountCutoverDatabaseReport,
  parseOrdinaryAccountCutoverReadinessArguments,
  runOrdinaryAccountCutoverReadinessCli,
  validateOrdinaryAccountCutoverExpectedEnvironment,
} from "./check-ordinary-account-cutover-readiness.mjs";
import { ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_SCALAR_SQL } from "./ordinary-account-identity-content-contract.mjs";

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
    lock: {
      async release() {
        released = true;
      },
    },
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
    FAOLLA_EXPECTED_ORDINARY_IDENTITY_CONTENT_SHA256: "1".repeat(64),
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
    ordinaryIdentityContentSha256: "1".repeat(64),
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
  const report = {
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
  if (
    report.runtimeRpcHardeningReady === false &&
    report.objectContractsReady === false &&
    Object.hasOwn(report, "defaultAclDiagnostic") &&
    !Object.hasOwn(report, "objectContractDiagnostic")
  ) {
    report.objectContractDiagnostic = objectContractDefaultAclDiagnostic();
  }
  return report;
}

function defaultAclDiagnostic(overrides = {}) {
  return {
    schemaVersion: 1,
    contract: "runtime_rpc_function_default_acl_v1",
    ready: false,
    relevantCreatorCount: 1,
    functionDefaultAclRowCount: 2,
    aclEntryCount: 2,
    violationCount: 1,
    creators: [
      {
        creatorOid: "10",
        creatorName: "supabase_admin",
        reasons: [
          "current_user",
          "session_user",
          "supabase_admin_role",
          "migration_registry_owner",
          "public_schema_create",
        ],
        globalOwnerExecuteReady: true,
        functionDefaultAclRowCount: 2,
        aclEntryCount: 2,
        violationCount: 1,
      },
    ],
    rows: [
      {
        defaultAclOid: "500",
        creatorOid: "10",
        schemaOid: "0",
        schemaName: null,
        objectType: "FUNCTION",
        aclEntryCount: 1,
        entries: [
          {
            ordinal: 1,
            grantorOid: "10",
            grantorName: "supabase_admin",
            granteeKind: "role",
            granteeOid: "10",
            granteeName: "supabase_admin",
            privilegeType: "EXECUTE",
            grantable: false,
          },
        ],
      },
      {
        defaultAclOid: "501",
        creatorOid: "10",
        schemaOid: "2200",
        schemaName: "redteam_readiness_defaults",
        objectType: "FUNCTION",
        aclEntryCount: 1,
        entries: [
          {
            ordinal: 1,
            grantorOid: "10",
            grantorName: "supabase_admin",
            granteeKind: "public",
            granteeOid: "0",
            granteeName: null,
            privilegeType: "EXECUTE",
            grantable: false,
          },
        ],
      },
    ],
    violations: [
      {
        code: "function_default_acl_owner_execute_missing",
        creatorOid: "10",
        defaultAclOid: "501",
      },
    ],
    ...overrides,
  };
}

function platformDefaultAclEntry({
  grantorOid = "10",
  grantorName = "supabase_admin",
  granteeKind = "role",
  granteeOid,
  granteeName,
  grantable = false,
}) {
  return {
    ordinal: 0,
    grantorOid,
    grantorName,
    granteeKind,
    granteeOid,
    granteeName,
    privilegeType: "EXECUTE",
    grantable,
  };
}

function platformDefaultAclDiagnostic({
  realtimeEntries = [
    platformDefaultAclEntry({
      granteeOid: "20",
      granteeName: "postgres",
    }),
    platformDefaultAclEntry({
      granteeOid: "30",
      granteeName: "dashboard_user",
    }),
  ],
  realtimeSchemaName = "realtime",
  realtimeViolationCodes = [],
} = {}) {
  const normalizedRealtimeEntries = realtimeEntries.map((entry, index) => ({
    ...entry,
    ordinal: index + 1,
  }));
  return {
    schemaVersion: 1,
    contract: "runtime_rpc_function_default_acl_v1",
    ready: false,
    relevantCreatorCount: 2,
    functionDefaultAclRowCount: 2,
    aclEntryCount: normalizedRealtimeEntries.length + 1,
    violationCount: realtimeViolationCodes.length + 1,
    creators: [
      {
        creatorOid: "10",
        creatorName: "supabase_admin",
        reasons: ["supabase_admin_role"],
        globalOwnerExecuteReady: true,
        functionDefaultAclRowCount: 2,
        aclEntryCount: normalizedRealtimeEntries.length + 1,
        violationCount: realtimeViolationCodes.length,
      },
      {
        creatorOid: "20",
        creatorName: "postgres",
        reasons: ["postgres_role"],
        globalOwnerExecuteReady: false,
        functionDefaultAclRowCount: 0,
        aclEntryCount: 0,
        violationCount: 1,
      },
    ],
    rows: [
      {
        defaultAclOid: "500",
        creatorOid: "10",
        schemaOid: "0",
        schemaName: null,
        objectType: "FUNCTION",
        aclEntryCount: 1,
        entries: [
          {
            ordinal: 1,
            grantorOid: "10",
            grantorName: "supabase_admin",
            granteeKind: "role",
            granteeOid: "10",
            granteeName: "supabase_admin",
            privilegeType: "EXECUTE",
            grantable: false,
          },
        ],
      },
      {
        defaultAclOid: "501",
        creatorOid: "10",
        schemaOid: "2200",
        schemaName: realtimeSchemaName,
        objectType: "FUNCTION",
        aclEntryCount: normalizedRealtimeEntries.length,
        entries: normalizedRealtimeEntries,
      },
    ],
    violations: [
      ...realtimeViolationCodes.map((code) => ({
        code,
        creatorOid: "10",
        defaultAclOid: "501",
      })),
      {
        code: "global_function_default_acl_owner_execute_missing",
        creatorOid: "20",
        defaultAclOid: null,
      },
    ],
  };
}

const objectContractObserverRelations = [
  "auth.users",
  "public.merchants",
  "public.faolla_personal_accounts",
  "public.merchant_enterprise_staff_identities",
  "public.merchant_enterprise_employees",
];
const objectContractObserverColumns = [
  "auth.users.id",
  "public.merchants.id",
  "public.merchants.user_id",
  "public.merchants.auth_user_id",
  "public.merchants.owner_user_id",
  "public.merchants.owner_id",
  "public.merchants.auth_id",
  "public.merchants.created_by",
  "public.merchants.created_by_user_id",
  "public.faolla_personal_accounts.auth_user_id",
  "public.faolla_personal_accounts.personal_account_id",
  "public.faolla_personal_accounts.status",
  "public.merchant_enterprise_staff_identities.auth_user_id",
  "public.merchant_enterprise_employees.auth_user_id",
];
const objectContractMerchantPolicies = [
  ["merchants_select_own", "r", true, "42205aae07118e35699a5507ffe3385a", null],
  ["merchants_insert_self", "a", true, null, "899af52ac5bbc8824aa635183199f48a"],
  ["merchants_update_own", "w", true, "42205aae07118e35699a5507ffe3385a", "42205aae07118e35699a5507ffe3385a"],
  ["merchants_system_site_principal_isolation", "w", false, "1c08e1341a191bbc45013950a337671d", "1c08e1341a191bbc45013950a337671d"],
  ["merchants_system_site_principal_insert_isolation", "a", false, null, "1c08e1341a191bbc45013950a337671d"],
];
const objectContractMerchantAclEntries = [
  "PUBLIC",
  "supabase_admin",
  "postgres",
  "anon",
  "authenticated",
  "service_role",
].flatMap((principal) =>
  [
    "INSERT",
    "SELECT",
    "UPDATE",
    "DELETE",
    "TRUNCATE",
    "REFERENCES",
    "TRIGGER",
  ].map((privilegeType) => {
    const expected =
      principal === "supabase_admin" ||
      principal === "postgres" ||
      (principal === "authenticated" &&
        ["SELECT", "INSERT", "UPDATE"].includes(privilegeType)) ||
      (principal === "service_role" &&
        ["SELECT", "INSERT", "UPDATE", "DELETE"].includes(privilegeType));
    return {
      principal,
      privilegeType,
      entryCount: expected ? 1 : 0,
      ownerGrantorCount: expected ? 1 : 0,
      grantableCount: 0,
    };
  }),
);

function objectContractDiagnostic() {
  const components = [
    {
      code: "observer_schema",
      ready: true,
      violationCount: 0,
      facts: {
        invalidRelationCount: 0,
        invalidColumnCount: 0,
        relations: objectContractObserverRelations.map((target) => ({
          target,
          present: true,
          kindReady: true,
          persistenceReady: true,
          partitionReady: true,
          inheritanceReady: true,
        })),
        columns: objectContractObserverColumns.map((target) => ({
          target,
          ready: true,
        })),
      },
      violations: [],
    },
    {
      code: "merchant_contract",
      ready: true,
      violationCount: 0,
      facts: {
        relationPresent: true,
        schemaReady: true,
        ownerReady: true,
        relationKind: "r",
        persistence: "p",
        rowSecurity: true,
        forceRowSecurity: false,
        partition: false,
        replicaIdentity: "d",
        policyCount: 5,
        policies: objectContractMerchantPolicies.map(
          ([target, command, permissive, qualMd5, checkMd5]) => ({
            target,
            count: 1,
            command,
            permissive,
            authenticatedOnly: true,
            qualMd5,
            checkMd5,
          }),
        ),
        aclEntryCount: 21,
        unknownPrincipalEntryCount: 0,
        unknownPrivilegeEntryCount: 0,
        aclEntries: objectContractMerchantAclEntries,
        columnAclCount: 0,
        inheritanceEdgeCount: 0,
        rewriteCount: 0,
      },
      violations: [],
    },
    {
      code: "personal_contract",
      ready: true,
      violationCount: 0,
      facts: {
        relationPresent: true,
        schemaReady: true,
        ownerReady: true,
        relationKind: "r",
        persistence: "p",
        rowSecurity: true,
        forceRowSecurity: false,
        partition: false,
        replicaIdentity: "d",
        columnCount: 6,
        columns: [
          "auth_user_id",
          "personal_account_id",
          "status",
          "version",
          "created_at",
          "updated_at",
        ].map((name) => ({
          target: `public.faolla_personal_accounts.${name}`,
          ready: true,
        })),
        indexCount: 2,
        indexes: [
          "public.faolla_personal_accounts_auth_user_id_uidx",
          "public.faolla_personal_accounts_personal_account_id_uidx",
        ].map((target) => ({ target, ready: true })),
        constraintCount: 4,
        constraints: [
          "faolla_personal_accounts_personal_account_id_safe",
          "faolla_personal_accounts_status_valid",
          "faolla_personal_accounts_version_valid",
          "faolla_personal_accounts_timestamps_valid",
        ].map((target) => ({ target, ready: true })),
        triggerCount: 1,
        bindingGuardReady: true,
        policyCount: 0,
        rewriteCount: 0,
        inheritanceEdgeCount: 0,
        aclEntryCount: 7,
        invalidAclEntryCount: 0,
        columnAclCount: 0,
      },
      violations: [],
    },
    {
      code: "registry_structure",
      ready: true,
      violationCount: 0,
      facts: {
        relationPresent: true,
        schemaReady: true,
        ownerReady: true,
        relationKind: "r",
        persistence: "p",
        rowSecurity: true,
        forceRowSecurity: false,
        partition: false,
        replicaIdentity: "d",
        columnCount: 3,
        columns: ["version", "name", "applied_at"].map((name) => ({
          target: `public.faolla_schema_migrations.${name}`,
          ready: true,
        })),
        constraintCount: 1,
        primaryKeyReady: true,
        indexCount: 1,
        triggerCount: 0,
        policyCount: 0,
        rewriteCount: 0,
        inheritanceEdgeCount: 0,
      },
      violations: [],
    },
    {
      code: "forbidden_binder",
      ready: false,
      violationCount: 1,
      facts: { forbiddenFunctionCount: 1 },
      violations: [
        {
          code: "forbidden_binder_function_present",
          target: "public.faolla_bind_ordinary_account_authorization_v1",
        },
      ],
    },
    {
      code: "runtime_rpc_function_default_acl",
      ready: true,
      violationCount: 0,
      facts: { contractReady: true },
      violations: [],
    },
  ];
  return {
    schemaVersion: 1,
    contract: "ordinary_account_object_contract_v1",
    ready: false,
    componentCount: 6,
    failedComponentCount: 1,
    violationCount: 1,
    components,
  };
}

function objectContractDefaultAclDiagnostic() {
  const diagnostic = objectContractDiagnostic();
  diagnostic.components[4] = {
    code: "forbidden_binder",
    ready: true,
    violationCount: 0,
    facts: { forbiddenFunctionCount: 0 },
    violations: [],
  };
  diagnostic.components[5] = {
    code: "runtime_rpc_function_default_acl",
    ready: false,
    violationCount: 1,
    facts: { contractReady: false },
    violations: [
      {
        code: "runtime_rpc_function_default_acl_invalid",
        target: null,
      },
    ],
  };
  return diagnostic;
}

function objectContractMerchantAclDiagnostic() {
  const diagnostic = objectContractDiagnostic();
  diagnostic.components[4] = {
    code: "forbidden_binder",
    ready: true,
    violationCount: 0,
    facts: { forbiddenFunctionCount: 0 },
    violations: [],
  };
  const merchant = diagnostic.components[1];
  const aclEntries = merchant.facts.aclEntries.map((entry) =>
    entry.principal === "authenticated" && entry.privilegeType === "TRIGGER"
      ? { ...entry, entryCount: 1, ownerGrantorCount: 1 }
      : entry,
  );
  diagnostic.components[1] = {
    ...merchant,
    ready: false,
    violationCount: 2,
    facts: {
      ...merchant.facts,
      aclEntryCount: 22,
      aclEntries,
    },
    violations: [
      {
        code: "merchant_acl_entry_count_invalid",
        target: "public.merchants",
      },
      {
        code: "merchant_acl_matrix_invalid",
        target: "authenticated:TRIGGER",
      },
    ],
  };
  diagnostic.violationCount = 2;
  return diagnostic;
}

function objectContractProductionMerchantAclDiagnostic() {
  const diagnostic = objectContractDiagnostic();
  diagnostic.components[4] = {
    code: "forbidden_binder",
    ready: true,
    violationCount: 0,
    facts: { forbiddenFunctionCount: 0 },
    violations: [],
  };
  const merchant = diagnostic.components[1];
  const aclEntries = merchant.facts.aclEntries.map((entry) =>
    entry.principal === "PUBLIC"
      ? entry
      : { ...entry, entryCount: 1, ownerGrantorCount: 1 },
  );
  const invalidTargets = [
    ...["anon"].flatMap((principal) =>
      [
        "INSERT",
        "SELECT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
      ].map((privilegeType) => `${principal}:${privilegeType}`),
    ),
    ...["DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"].map(
      (privilegeType) => `authenticated:${privilegeType}`,
    ),
    ...["TRUNCATE", "REFERENCES", "TRIGGER"].map(
      (privilegeType) => `service_role:${privilegeType}`,
    ),
  ];
  diagnostic.components[1] = {
    ...merchant,
    ready: false,
    violationCount: 15,
    facts: {
      ...merchant.facts,
      aclEntryCount: 35,
      aclEntries,
    },
    violations: [
      {
        code: "merchant_acl_entry_count_invalid",
        target: "public.merchants",
      },
      ...invalidTargets.map((target) => ({
        code: "merchant_acl_matrix_invalid",
        target,
      })),
    ],
  };
  diagnostic.violationCount = 15;
  return diagnostic;
}

function objectContractObserverDiagnostic() {
  const diagnostic = objectContractDiagnostic();
  diagnostic.components[4] = {
    code: "forbidden_binder",
    ready: true,
    violationCount: 0,
    facts: { forbiddenFunctionCount: 0 },
    violations: [],
  };
  const observer = diagnostic.components[0];
  diagnostic.components[0] = {
    ...observer,
    ready: false,
    violationCount: 1,
    facts: {
      ...observer.facts,
      invalidColumnCount: 1,
      columns: observer.facts.columns.map((column, index) =>
        index === 0 ? { ...column, ready: false } : column,
      ),
    },
    violations: [
      { code: "observer_column_invalid", target: "auth.users.id" },
    ],
  };
  return diagnostic;
}

function objectContractPersonalDiagnostic() {
  const diagnostic = objectContractDiagnostic();
  diagnostic.components[4] = {
    code: "forbidden_binder",
    ready: true,
    violationCount: 0,
    facts: { forbiddenFunctionCount: 0 },
    violations: [],
  };
  const personal = diagnostic.components[2];
  diagnostic.components[2] = {
    ...personal,
    ready: false,
    violationCount: 1,
    facts: { ...personal.facts, policyCount: 1 },
    violations: [
      {
        code: "personal_policy_present",
        target: "public.faolla_personal_accounts",
      },
    ],
  };
  return diagnostic;
}

function objectContractRegistryDiagnostic() {
  const diagnostic = objectContractDiagnostic();
  diagnostic.components[4] = {
    code: "forbidden_binder",
    ready: true,
    violationCount: 0,
    facts: { forbiddenFunctionCount: 0 },
    violations: [],
  };
  const registry = diagnostic.components[3];
  diagnostic.components[3] = {
    ...registry,
    ready: false,
    violationCount: 1,
    facts: { ...registry.facts, primaryKeyReady: false },
    violations: [
      {
        code: "registry_primary_key_invalid",
        target: "public.faolla_schema_migrations",
      },
    ],
  };
  return diagnostic;
}

test("the production probe is one read-only transaction with the exact runtime hardening gate", () => {
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /BEGIN TRANSACTION READ ONLY;/,
  );
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
    assert.match(
      ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
      new RegExp(`pg_catalog\\.${catalog}`),
    );
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
    assert.ok(
      position > precedingCatalog,
      `${catalog} must keep the fixed catalog-lock order`,
    );
    precedingCatalog = position;
  }
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /pg_stat_clear_snapshot\(\)/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /activity\.backend_xid is not null/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /pg_catalog\.pg_prepared_xacts/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /\$role_graph_postcondition\$/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /\$definition_postcondition\$/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /\$registry_postcondition\$/,
  );
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /ROLLBACK;/);
  const executableSql = ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL.replace(
    /--[^\n]*/g,
    "",
  ).replace(/'(?:''|[^'])*'/gs, "''");
  assert.doesNotMatch(
    executableSql,
    /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE)\b/i,
  );
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /202608190035/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /202608190039/);
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /202608190040/);
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /current_user = 'supabase_admin'/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /pg_catalog\.current_database\(\) = :'expected_database_name'/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /pg_catalog\.pg_control_system\(\)/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /:'expected_database_system_identifier'::numeric/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /:'expected_merchant_record_count'::numeric/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /:'expected_personal_canonical_count'::numeric/,
  );
  assert.ok(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL.includes(
      ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_SCALAR_SQL,
    ),
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /registry\.relrowsecurity/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /attribute\.attacl IS NOT NULL/,
  );
  const dataLock =
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL.indexOf("auth.users,");
  const catalogLock = ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL.indexOf(
    "pg_catalog.pg_database,",
  );
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
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /expected_observer_relation/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /relation\.relkind <> 'r'/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /relation\.relpersistence <> 'p'/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /relation\.relispartition/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /expected_observer_column/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /14 = \(SELECT count\(\*\) FROM expected_observer_column\)/,
  );
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /attribute\.attnum > 0/);
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /attribute\.atttypmod = expected\.type_modifier/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /attribute\.attnotnull = expected\.not_null/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /expected_merchant_policy/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /merchants_system_site_principal_insert_isolation/,
  );
  for (const hash of [
    "42205aae07118e35699a5507ffe3385a",
    "899af52ac5bbc8824aa635183199f48a",
    "1c08e1341a191bbc45013950a337671d",
  ]) {
    assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, new RegExp(hash));
  }
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /personal_contract_state/,
  );
  for (const hash of [
    "6c6a7472c2d303e319253578fc2a745a",
    "8b4bd9cb5a89caab86807b61eb21151c",
    "33e5475c2422f3c8d2ae88010bcee42a",
    "ba66117c8f4124ec62639bc9756ee764",
  ]) {
    assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, new RegExp(hash));
  }
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /registry_structure_state/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /constraint_metadata\.condeferrable/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /constraint_metadata\.conname = 'faolla_schema_migrations_pkey'/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /index_relation\.relname = 'faolla_schema_migrations_pkey'/,
  );
  assert.match(ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL, /relreplident = 'd'/);
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /to_regcollation\('pg_catalog\.default'\)/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /function_metadata\.proname =[\s\S]*'faolla_bind_ordinary_account_authorization_v1'[\s\S]*function_metadata\.pronamespace = to_regnamespace\('public'\)/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /creator_default_acl_state/,
  );
  const relevantCreatorSql = ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL.slice(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL.indexOf(
      "relevant_creator AS MATERIALIZED",
    ),
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL.indexOf(
      "creator_default_acl_fact AS MATERIALIZED",
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
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /creator_default_acl_fact AS MATERIALIZED/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /LEFT JOIN LATERAL pg_catalog\.aclexplode\(default_acl\.defaclacl\)/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /creator_default_acl_creator AS MATERIALIZED \([\s\S]*FROM creator_default_acl_fact AS fact/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /creator_default_acl_row AS MATERIALIZED \([\s\S]*FROM creator_default_acl_fact AS fact/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /'granteeKind', fact\.grantee_kind/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /function_default_acl_catalog_reference_unresolved/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /platform_function_default_acl_expected AS MATERIALIZED/,
  );
  const exactPlatformContracts = [
    ["supabase_admin", "realtime", "postgres", false],
    ["supabase_admin", "realtime", "dashboard_user", false],
    ["supabase_admin", "graphql_public", "postgres", false],
    ["supabase_admin", "graphql_public", "anon", false],
    ["supabase_admin", "graphql_public", "authenticated", false],
    ["supabase_admin", "graphql_public", "service_role", false],
    ["supabase_admin", "graphql", "postgres", false],
    ["supabase_admin", "graphql", "anon", false],
    ["supabase_admin", "graphql", "authenticated", false],
    ["supabase_admin", "graphql", "service_role", false],
    ["supabase_admin", "extensions", "postgres", true],
    ["postgres", "storage", "postgres", false],
    ["postgres", "storage", "anon", false],
    ["postgres", "storage", "authenticated", false],
    ["postgres", "storage", "service_role", false],
    ["postgres", "supabase_functions", "postgres", false],
    ["postgres", "supabase_functions", "anon", false],
    ["postgres", "supabase_functions", "authenticated", false],
    ["postgres", "supabase_functions", "service_role", false],
  ];
  assert.deepEqual(PLATFORM_FUNCTION_DEFAULT_ACL_EXPECTED, exactPlatformContracts);
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /function_default_acl_platform_contract_invalid/,
  );
  const platformExpectedCteSql = ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL.slice(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL.indexOf(
      "platform_function_default_acl_expected AS MATERIALIZED",
    ),
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL.indexOf(
      "creator_default_acl_fact AS MATERIALIZED",
    ),
  );
  const sqlPlatformContracts = [
    ...platformExpectedCteSql.matchAll(
      /\('([^']+)', '([^']+)', '([^']+)', (true|false)\)/g,
    ),
  ].map((match) => [match[1], match[2], match[3], match[4] === "true"]);
  assert.deepEqual(sqlPlatformContracts, exactPlatformContracts);
  assert.doesNotMatch(platformExpectedCteSql, /\boid\b/i);
  const platformSemanticSql = ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL.slice(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL.indexOf(
      "creator_default_acl_semantic_state AS MATERIALIZED",
    ),
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL.indexOf(
      "creator_default_acl_violation AS MATERIALIZED",
    ),
  );
  assert.doesNotMatch(
    platformSemanticSql,
    /(?:creator|schema|grantor|grantee)_oid\s*=\s*\d+/i,
    "platform default ACL contracts must be role/schema-name based, not OID-pinned",
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /'defaultAclDiagnostic'[\s\S]*creator_default_acl_diagnostic/,
  );
  assert.doesNotMatch(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /pg_catalog\.(?:coalesce|greatest|least|nullif)\s*\(/i,
    "SQL syntax constructs must not be schema-qualified as functions",
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /'objectContractsReady'/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /object_contract_diagnostic AS MATERIALIZED/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /'objectContractDiagnostic'[\s\S]*object_contract_diagnostic/,
  );
  assert.match(
    ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
    /'pg_catalog\.trigger'::regtype, false/g,
  );
});

test("the nine bridge and guard definition hashes are derived from the frozen migration sources", async () => {
  const migration035 = await readFile(
    new URL(
      "./supabase-migrations/202608190035_ordinary_account_authorization_foundation.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const migration036 = await readFile(
    new URL(
      "./supabase-migrations/202608190036_ordinary_account_authorization_bootstrap.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const migration038 = await readFile(
    new URL(
      "./supabase-migrations/202608190038_ordinary_account_recovery_observer.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const functions = [
    ["faolla_resolve_ordinary_account_authorization_v1", migration036],
    ["faolla_get_ordinary_account_authorization_readiness_v1", migration035],
    ["faolla_create_ordinary_account_authorization_v1", migration036],
    ["faolla_bootstrap_ordinary_account_authorization_v1", migration036],
    [
      "faolla_get_ordinary_account_authoritative_cutover_readiness_v1",
      migration036,
    ],
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
    "FAOLLA_EXPECTED_ORDINARY_IDENTITY_CONTENT_SHA256",
  ]) {
    assert.match(runner, new RegExp(`export ${variable}=`));
  }
  for (const variable of [
    "expected_database_name",
    "expected_database_system_identifier",
    "expected_merchant_record_count",
    "expected_personal_canonical_count",
    "expected_ordinary_identity_content_sha256",
  ]) {
    assert.match(wrapper, new RegExp(`--set=${variable}=`));
  }
  const merchantAclNormalization = runner.indexOf(
    "grant select, insert, update, delete on table public.merchants to service_role;",
  );
  const readinessInvocation = runner.indexOf(
    'node "${SCRIPT_DIR}/check-ordinary-account-cutover-readiness.mjs"',
  );
  assert.ok(
    merchantAclNormalization > 0 &&
      merchantAclNormalization < readinessInvocation,
  );
  assert.match(wrapper, /\["blocked", "error", "ready"\]/);
  assert.match(wrapper, /FAOLLA_EXPECTED_READINESS_STATUS/);
  assert.match(wrapper, /objectContractsReady/);
  assert.doesNotMatch(wrapper, /result\.stderr/);
  for (const contract of [
    "normalizing the disposable fixture",
    "exact merchant ACL target replay",
    "merchant ACL unknown-principal drift",
    "merchant ACL delegated grant drift",
    "merchant column ACL drift",
    "merchant owner drift",
    "guard body drift",
    "observer ACL drift",
    "merchant policy drift",
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
    "same-count ordinary identity content replacement",
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
  const guardDefinitions = [
    ...driftMatrix.matchAll(
      /create or replace function\s+public\.faolla_guard_personal_account_binding_v1\(\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/gi,
    ),
  ];
  assert.equal(guardDefinitions.length, 2);
  assert.equal(
    createHash("md5")
      .update(
        String(guardDefinitions.at(-1)[1]).replaceAll("\r\n", "\n"),
        "utf8",
      )
      .digest("hex"),
    "9e5572f34a178da6551efda74751ba18",
  );
  assert.match(driftMatrix, /U&'\\0009\\000A[\s\S]*\\3000\\FEFF'/);
  assert.match(
    driftMatrix,
    /ordinary_readiness_personal_safe_restore_hash_invalid/,
  );
  assert.match(driftMatrix, /6c6a7472c2d303e319253578fc2a745a/);
});

test("argument parser exposes only JSON and fail-on-blocked controls", () => {
  assert.deepEqual(
    parseOrdinaryAccountCutoverReadinessArguments([
      "--json",
      "--fail-on-blocked",
    ]),
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
    [
      "FAOLLA_EXPECTED_ORDINARY_IDENTITY_CONTENT_SHA256",
      "A".repeat(64),
      "ordinary_account_readiness_expected_identity_content_sha256_invalid",
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

test("database report parser validates the exact bounded baseline shape", () => {
  const parsed = parseOrdinaryAccountCutoverDatabaseReport(
    `${JSON.stringify(databaseReport())}\n`,
  );
  assert.equal(parsed.status, "ready");
  assert.equal(Object.hasOwn(parsed, "objectContractDiagnostic"), false);
  assert.equal(parsed.readiness.merchantRecordCount, 9);
  assert.equal(parsed.readiness.ordinaryIdentityContentSha256, "1".repeat(64));
  assert.deepEqual(parsed.databaseIdentity, databaseIdentity());

  assert.equal(
    parseOrdinaryAccountCutoverDatabaseReport(
      JSON.stringify(databaseReport({ baselineReady: false })),
    ).status,
    "blocked",
  );

  const objectContractBlocked = parseOrdinaryAccountCutoverDatabaseReport(
    JSON.stringify(
      databaseReport({
        objectContractsReady: false,
        objectContractDiagnostic: objectContractDiagnostic(),
      }),
    ),
  );
  assert.equal(objectContractBlocked.status, "blocked");
  assert.deepEqual(
    objectContractBlocked.objectContractDiagnostic,
    objectContractDiagnostic(),
  );

  const merchantAclBlocked = parseOrdinaryAccountCutoverDatabaseReport(
    JSON.stringify(
      databaseReport({
        objectContractsReady: false,
        objectContractDiagnostic: objectContractMerchantAclDiagnostic(),
      }),
    ),
  );
  assert.deepEqual(
    merchantAclBlocked.objectContractDiagnostic,
    objectContractMerchantAclDiagnostic(),
  );
  const productionMerchantAclBlocked =
    parseOrdinaryAccountCutoverDatabaseReport(
      JSON.stringify(
        databaseReport({
          migrationsReady: false,
          objectContractsReady: false,
          objectContractDiagnostic:
            objectContractProductionMerchantAclDiagnostic(),
        }),
      ),
    );
  assert.equal(productionMerchantAclBlocked.status, "blocked");
  assert.deepEqual(
    productionMerchantAclBlocked.objectContractDiagnostic,
    objectContractProductionMerchantAclDiagnostic(),
  );
  for (const diagnostic of [
    objectContractObserverDiagnostic(),
    objectContractPersonalDiagnostic(),
    objectContractRegistryDiagnostic(),
  ]) {
    assert.deepEqual(
      parseOrdinaryAccountCutoverDatabaseReport(
        JSON.stringify(
          databaseReport({
            objectContractsReady: false,
            objectContractDiagnostic: diagnostic,
          }),
        ),
      ).objectContractDiagnostic,
      diagnostic,
    );
  }

  assert.throws(
    () =>
      parseOrdinaryAccountCutoverDatabaseReport(
        JSON.stringify(databaseReport({ objectContractsReady: false })),
      ),
    /ordinary_account_readiness_output_invalid/,
  );
  assert.throws(
    () =>
      parseOrdinaryAccountCutoverDatabaseReport(
        JSON.stringify(
          databaseReport({
            objectContractDiagnostic: objectContractDiagnostic(),
          }),
        ),
      ),
    /ordinary_account_readiness_output_invalid/,
  );

  for (const diagnostic of [
    { ...objectContractDiagnostic(), ready: true },
    { ...objectContractDiagnostic(), componentCount: 5 },
    { ...objectContractDiagnostic(), failedComponentCount: 0 },
    { ...objectContractDiagnostic(), violationCount: 0 },
    {
      ...objectContractDiagnostic(),
      components: [...objectContractDiagnostic().components].reverse(),
    },
    {
      ...objectContractDiagnostic(),
      components: objectContractDiagnostic().components.map(
        (component, index) =>
          index === 4
            ? {
                ...component,
                facts: { forbiddenFunctionCount: 0 },
              }
            : component,
      ),
    },
    {
      ...objectContractDiagnostic(),
      components: objectContractDiagnostic().components.map(
        (component, index) =>
          index === 4
            ? {
                ...component,
                violations: [
                  {
                    code: "forbidden_binder_function_present",
                    target: "public.not_the_fixed_function",
                  },
                ],
              }
            : component,
      ),
    },
    (() => {
      const diagnostic = objectContractMerchantAclDiagnostic();
      diagnostic.components[1].facts.aclEntries[0] = {
        ...diagnostic.components[1].facts.aclEntries[0],
        principal: "unknown_runtime_role",
      };
      return diagnostic;
    })(),
    (() => {
      const diagnostic = objectContractDiagnostic();
      diagnostic.components[1].facts.policies[0] = {
        ...diagnostic.components[1].facts.policies[0],
        qualMd5: "A".repeat(32),
      };
      return diagnostic;
    })(),
    { ...objectContractDiagnostic(), extra: true },
  ]) {
    assert.throws(
      () =>
        parseOrdinaryAccountCutoverDatabaseReport(
          JSON.stringify(
            databaseReport({
              objectContractsReady: false,
              objectContractDiagnostic: diagnostic,
            }),
          ),
        ),
      /ordinary_account_readiness_output_invalid/,
    );
  }

  const defaultAclBlocked = parseOrdinaryAccountCutoverDatabaseReport(
    JSON.stringify(
      databaseReport({
        runtimeRpcHardeningReady: false,
        objectContractsReady: false,
        defaultAclDiagnostic: defaultAclDiagnostic(),
      }),
    ),
  );
  assert.equal(defaultAclBlocked.status, "blocked");
  assert.deepEqual(
    defaultAclBlocked.defaultAclDiagnostic,
    defaultAclDiagnostic(),
  );

  const exactPlatformDefaultAcl = platformDefaultAclDiagnostic();
  assert.deepEqual(
    parseOrdinaryAccountCutoverDatabaseReport(
      JSON.stringify(
        databaseReport({
          runtimeRpcHardeningReady: false,
          objectContractsReady: false,
          defaultAclDiagnostic: exactPlatformDefaultAcl,
        }),
      ),
    ).defaultAclDiagnostic,
    exactPlatformDefaultAcl,
  );

  const restrictiveManagedDefaultAcl = platformDefaultAclDiagnostic({
    realtimeEntries: [
      platformDefaultAclEntry({
        granteeOid: "10",
        granteeName: "supabase_admin",
      }),
    ],
  });
  assert.deepEqual(
    parseOrdinaryAccountCutoverDatabaseReport(
      JSON.stringify(
        databaseReport({
          runtimeRpcHardeningReady: false,
          objectContractsReady: false,
          defaultAclDiagnostic: restrictiveManagedDefaultAcl,
        }),
      ),
    ).defaultAclDiagnostic,
    restrictiveManagedDefaultAcl,
  );

  const platformContractViolation =
    "function_default_acl_platform_contract_invalid";
  const entryCountViolation = "function_default_acl_entry_count_invalid";
  const ownerExecuteViolation =
    "function_default_acl_owner_execute_missing";
  const catalogReferenceViolation =
    "function_default_acl_catalog_reference_unresolved";
  for (const [label, diagnostic] of [
    [
      "missing entry",
      platformDefaultAclDiagnostic({
        realtimeEntries: [
          platformDefaultAclEntry({
            granteeOid: "20",
            granteeName: "postgres",
          }),
        ],
        realtimeViolationCodes: [
          platformContractViolation,
          ownerExecuteViolation,
        ],
      }),
    ],
    [
      "extra entry",
      platformDefaultAclDiagnostic({
        realtimeEntries: [
          platformDefaultAclEntry({
            granteeOid: "20",
            granteeName: "postgres",
          }),
          platformDefaultAclEntry({
            granteeOid: "30",
            granteeName: "dashboard_user",
          }),
          platformDefaultAclEntry({
            granteeOid: "40",
            granteeName: "anon",
          }),
        ],
        realtimeViolationCodes: [
          platformContractViolation,
          entryCountViolation,
          ownerExecuteViolation,
        ],
      }),
    ],
    [
      "PUBLIC entry",
      platformDefaultAclDiagnostic({
        realtimeEntries: [
          platformDefaultAclEntry({
            granteeKind: "public",
            granteeOid: "0",
            granteeName: null,
          }),
          platformDefaultAclEntry({
            granteeOid: "20",
            granteeName: "postgres",
          }),
        ],
        realtimeViolationCodes: [
          platformContractViolation,
          entryCountViolation,
          ownerExecuteViolation,
        ],
      }),
    ],
    [
      "unknown grantee",
      platformDefaultAclDiagnostic({
        realtimeEntries: [
          platformDefaultAclEntry({
            granteeOid: "20",
            granteeName: "postgres",
          }),
          platformDefaultAclEntry({
            granteeOid: "40",
            granteeName: "anon",
          }),
        ],
        realtimeViolationCodes: [
          platformContractViolation,
          entryCountViolation,
          ownerExecuteViolation,
        ],
      }),
    ],
    [
      "wrong grantor",
      platformDefaultAclDiagnostic({
        realtimeEntries: [
          platformDefaultAclEntry({
            grantorOid: "20",
            grantorName: "postgres",
            granteeOid: "20",
            granteeName: "postgres",
          }),
          platformDefaultAclEntry({
            grantorOid: "20",
            grantorName: "postgres",
            granteeOid: "30",
            granteeName: "dashboard_user",
          }),
        ],
        realtimeViolationCodes: [
          platformContractViolation,
          entryCountViolation,
          ownerExecuteViolation,
        ],
      }),
    ],
    [
      "wrong grantability",
      platformDefaultAclDiagnostic({
        realtimeEntries: [
          platformDefaultAclEntry({
            granteeOid: "20",
            granteeName: "postgres",
          }),
          platformDefaultAclEntry({
            granteeOid: "30",
            granteeName: "dashboard_user",
            grantable: true,
          }),
        ],
        realtimeViolationCodes: [
          platformContractViolation,
          entryCountViolation,
          ownerExecuteViolation,
        ],
      }),
    ],
    [
      "unresolved catalog role",
      platformDefaultAclDiagnostic({
        realtimeEntries: [
          platformDefaultAclEntry({
            granteeOid: "20",
            granteeName: "postgres",
          }),
          platformDefaultAclEntry({
            granteeOid: "30",
            granteeName: null,
          }),
        ],
        realtimeViolationCodes: [
          platformContractViolation,
          entryCountViolation,
          ownerExecuteViolation,
          catalogReferenceViolation,
        ],
      }),
    ],
    [
      "platform tuple in unknown schema",
      platformDefaultAclDiagnostic({
        realtimeSchemaName: "unknown_platform_schema",
        realtimeViolationCodes: [
          entryCountViolation,
          ownerExecuteViolation,
        ],
      }),
    ],
  ]) {
    assert.deepEqual(
      parseOrdinaryAccountCutoverDatabaseReport(
        JSON.stringify(
          databaseReport({
            runtimeRpcHardeningReady: false,
            objectContractsReady: false,
            defaultAclDiagnostic: diagnostic,
          }),
        ),
      ).defaultAclDiagnostic,
      diagnostic,
      label,
    );
  }

  const emptyDefaultAclDiagnostic = defaultAclDiagnostic({
    ready: false,
    functionDefaultAclRowCount: 1,
    aclEntryCount: 0,
    violationCount: 3,
    creators: [
      {
        ...defaultAclDiagnostic().creators[0],
        globalOwnerExecuteReady: false,
        functionDefaultAclRowCount: 1,
        aclEntryCount: 0,
        violationCount: 3,
      },
    ],
    rows: [
      {
        ...defaultAclDiagnostic().rows[0],
        aclEntryCount: 0,
        entries: [],
      },
    ],
    violations: [
      {
        code: "global_function_default_acl_owner_execute_missing",
        creatorOid: "10",
        defaultAclOid: null,
      },
      {
        code: "function_default_acl_entry_count_invalid",
        creatorOid: "10",
        defaultAclOid: "500",
      },
      {
        code: "function_default_acl_owner_execute_missing",
        creatorOid: "10",
        defaultAclOid: "500",
      },
    ],
  });
  assert.deepEqual(
    parseOrdinaryAccountCutoverDatabaseReport(
      JSON.stringify(
        databaseReport({
          runtimeRpcHardeningReady: false,
          objectContractsReady: false,
          defaultAclDiagnostic: emptyDefaultAclDiagnostic,
        }),
      ),
    ).defaultAclDiagnostic,
    emptyDefaultAclDiagnostic,
  );

  const unresolvedDefaultAclDiagnostic = defaultAclDiagnostic({
    violationCount: 2,
    creators: [
      {
        ...defaultAclDiagnostic().creators[0],
        violationCount: 2,
      },
    ],
    rows: [
      defaultAclDiagnostic().rows[0],
      {
        ...defaultAclDiagnostic().rows[1],
        schemaName: null,
        entries: [
          {
            ...defaultAclDiagnostic().rows[1].entries[0],
            grantorName: null,
            granteeKind: "role",
            granteeOid: "20",
            granteeName: null,
          },
        ],
      },
    ],
    violations: [
      defaultAclDiagnostic().violations[0],
      {
        code: "function_default_acl_catalog_reference_unresolved",
        creatorOid: "10",
        defaultAclOid: "501",
      },
    ],
  });
  assert.deepEqual(
    parseOrdinaryAccountCutoverDatabaseReport(
      JSON.stringify(
        databaseReport({
          runtimeRpcHardeningReady: false,
          objectContractsReady: false,
          defaultAclDiagnostic: unresolvedDefaultAclDiagnostic,
        }),
      ),
    ).defaultAclDiagnostic,
    unresolvedDefaultAclDiagnostic,
  );

  assert.throws(
    () =>
      parseOrdinaryAccountCutoverDatabaseReport(
        JSON.stringify(
          databaseReport({
            defaultAclDiagnostic: defaultAclDiagnostic(),
          }),
        ),
      ),
    /ordinary_account_readiness_output_invalid/,
  );
  assert.throws(
    () =>
      parseOrdinaryAccountCutoverDatabaseReport(
        JSON.stringify(
          databaseReport({
            runtimeRpcHardeningReady: false,
            objectContractsReady: false,
          }),
        ),
      ),
    /ordinary_account_readiness_output_invalid/,
  );

  for (const diagnostic of [
    defaultAclDiagnostic({ violationCount: 0 }),
    defaultAclDiagnostic({ ready: true }),
    defaultAclDiagnostic({ extra: true }),
    defaultAclDiagnostic({
      creators: [
        {
          ...defaultAclDiagnostic().creators[0],
          aclEntryCount: 1,
        },
      ],
    }),
    defaultAclDiagnostic({ rows: [...defaultAclDiagnostic().rows].reverse() }),
    defaultAclDiagnostic({
      rows: [
        defaultAclDiagnostic().rows[0],
        {
          ...defaultAclDiagnostic().rows[1],
          entries: [
            {
              ...defaultAclDiagnostic().rows[1].entries[0],
              granteeName: "public",
            },
          ],
        },
      ],
    }),
    defaultAclDiagnostic({
      violations: [
        {
          ...defaultAclDiagnostic().violations[0],
          code: "unknown",
        },
      ],
    }),
  ]) {
    assert.throws(
      () =>
        parseOrdinaryAccountCutoverDatabaseReport(
          JSON.stringify(
            databaseReport({
              runtimeRpcHardeningReady: false,
              objectContractsReady: false,
              defaultAclDiagnostic: diagnostic,
            }),
          ),
        ),
      /ordinary_account_readiness_output_invalid/,
    );
  }

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
    () =>
      parseOrdinaryAccountCutoverDatabaseReport(
        JSON.stringify({ ...databaseReport(), row: {} }),
      ),
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
    () =>
      parseOrdinaryAccountCutoverDatabaseReport(
        JSON.stringify(
          databaseReport({
            readiness: readiness({
              ordinaryIdentityContentSha256: "A".repeat(64),
            }),
          }),
        ),
      ),
    /ordinary_account_readiness_output_invalid/,
  );
  assert.throws(
    () => parseOrdinaryAccountCutoverDatabaseReport("not-json"),
    /ordinary_account_readiness_output_invalid/,
  );
  assert.throws(
    () =>
      parseOrdinaryAccountCutoverDatabaseReport(" ".repeat(1024 * 1024 + 1)),
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
    "--env",
    `FAOLLA_EXPECTED_ORDINARY_IDENTITY_CONTENT_SHA256=${"1".repeat(64)}`,
    "supabase-db",
  ]);
  assert.match(calls[0].args.at(-1), /--set=expected_database_name=/);
  assert.match(
    calls[0].args.at(-1),
    /--set=expected_ordinary_identity_content_sha256=/,
  );
  assert.equal(calls[0].options.input, ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL);
  assert.equal(calls[0].options.outputLimitBytes, 1024 * 1024);
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

test("CLI emits bounded baseline JSON and can fail a blocked release gate", async () => {
  const stdout = [];
  const stderr = [];
  const readyReport = {
    schemaVersion: 1,
    mode: "read_only",
    databaseContainer: "supabase-db",
    ...parseOrdinaryAccountCutoverDatabaseReport(
      JSON.stringify(databaseReport()),
    ),
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
