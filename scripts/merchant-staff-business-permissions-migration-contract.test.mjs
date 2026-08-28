import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  discoverProductionDatabaseMigrations,
} from "./apply-production-database-migrations.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = path.join(
  root,
  "scripts",
  "supabase-migrations",
  "202608280041_merchant_staff_business_permissions.sql",
);
const staffSource = fs.readFileSync(
  path.join(root, "src", "lib", "merchantStaffBusiness.ts"),
  "utf8",
);
const enterpriseSource = fs.readFileSync(
  path.join(root, "src", "lib", "merchantEnterprise.ts"),
  "utf8",
);
const migrationSource = fs.readFileSync(migrationPath, "utf8");
const productionMigratorSource = fs.readFileSync(
  path.join(root, "scripts", "apply-production-database-migrations.mjs"),
  "utf8",
);
const productionWorkflowSource = fs.readFileSync(
  path.join(root, ".github", "workflows", "database-migrate.yml"),
  "utf8",
);
const enterpriseWorkflowSource = fs.readFileSync(
  path.join(root, ".github", "workflows", "enterprise-integration.yml"),
  "utf8",
);
const enterpriseRunnerSource = fs.readFileSync(
  path.join(root, "scripts", "enterprise-integration", "run.sh"),
  "utf8",
);
const enterpriseAcceptanceSource = fs.readFileSync(
  path.join(
    root,
    "scripts",
    "enterprise-integration",
    "63-staff-business-permissions.sql",
  ),
  "utf8",
);
const packageManifest = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const compatibilityMarker = JSON.parse(
  fs.readFileSync(
    path.join(
      root,
      "scripts",
      "merchant-staff-business-rbac-compatibility-v1.json",
    ),
    "utf8",
  ),
);

const FROZEN_V1_STAFF_PERMISSIONS = [
  "redemptions.view",
  "redemptions.customer_data.view",
  "redemptions.checkout",
  "redemptions.recharge",
  "redemptions.recharge.cancel",
  "redemptions.catalog.manage",
  "redemptions.print",
  "bookings.view",
  "bookings.customer_data.view",
  "bookings.update",
  "bookings.status.manage",
  "bookings.email.send",
  "bookings.analytics.view",
  "bookings.export",
  "bookings.settings.manage",
  "bookings.automation.manage",
  "bookings.calendar.manage",
  "orders.view",
  "orders.customer_data.view",
  "orders.status.manage",
  "orders.complete",
  "orders.items.update",
  "orders.print",
  "orders.analytics.view",
  "orders.export",
  "orders.export.customer_data",
  "orders.catalog.view",
  "orders.catalog.manage",
  "conversations.view",
  "conversations.search",
  "conversations.start",
  "conversations.send",
  "members.view",
  "members.customer_data.view",
  "members.account.view",
  "members.account.adjust",
  "members.allergens.manage",
  "members.insights.view",
  "members.settings.manage",
];
const FROZEN_V1_PERMISSION_KEYS_SHA256 =
  "bf35ba5e297d8a9dc0f164cd02063758ed245fd4d66ccfd71e45929c884c09a2";
// This digest freezes the ordered [{ key, dependencies }] contract. Never
// update it in place: a semantic change requires a new compatibility version.
const FROZEN_V1_PERMISSION_CONTRACT_SHA256 =
  "4d82b7912ff8acfd21550cc9d6884bb5bd75189aaef89fd7a4b0acd89ea3c2e5";

function stripSqlComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\r\n]*/g, "");
}

function quotedStrings(source) {
  return Array.from(source.matchAll(/["']([^"']+)["']/g), (match) => match[1]);
}

function readConstArray(source, name) {
  const expression = new RegExp(
    `export\\s+const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s+as\\s+const`,
  ).exec(source);
  assert.ok(expression, `missing TypeScript array ${name}`);
  return quotedStrings(expression[1]);
}

function readObjectLiteral(source, name) {
  const nameIndex = source.indexOf(name);
  assert.ok(nameIndex >= 0, `missing TypeScript object ${name}`);
  const assignmentIndex = source.indexOf("=", nameIndex);
  const openIndex = source.indexOf("{", assignmentIndex);
  assert.ok(assignmentIndex >= 0 && openIndex >= 0, `missing object body ${name}`);

  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, index);
    }
  }
  assert.fail(`unterminated TypeScript object ${name}`);
}

function readTypeScriptDependencies(source, name) {
  const objectBody = readObjectLiteral(source, name);
  const dependencies = new Map();
  for (const match of objectBody.matchAll(
    /["']([^"']+)["']\s*:\s*\[([\s\S]*?)\]/g,
  )) {
    dependencies.set(match[1], quotedStrings(match[2]));
  }
  return dependencies;
}

function readSqlFunction(source, name) {
  const startPattern = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`,
    "i",
  );
  const start = source.search(startPattern);
  assert.ok(start >= 0, `missing SQL function ${name}`);
  const bodyEnd = source.indexOf("$$;", start);
  assert.ok(bodyEnd >= 0, `unterminated SQL function ${name}`);
  return source.slice(start, bodyEnd + 3);
}

function readSqlPermissionCatalog(source) {
  const validator = readSqlFunction(
    source,
    "faolla_valid_merchant_enterprise_permissions_v1",
  );
  const catalog = new Map();
  for (const match of validator.matchAll(
    /\(\s*'([^']+)'(?:::text)?\s*,\s*array\[([\s\S]*?)\]::text\[\]\s*\)/g,
  )) {
    catalog.set(match[1], quotedStrings(match[2]));
  }
  return { validator, catalog };
}

function readConstraintAllowlist(source) {
  const start = source.indexOf(
    "add constraint merchant_enterprise_roles_permissions_check_041",
  );
  const end = source.indexOf(") not valid;", start);
  assert.ok(start >= 0 && end > start, "missing staged permission CHECK");
  const constraint = source.slice(start, end);
  const arrayStart = constraint.indexOf("permissions <@ array[");
  const arrayEnd = constraint.indexOf("]::text[]", arrayStart);
  assert.ok(arrayStart >= 0 && arrayEnd > arrayStart, "missing CHECK allowlist");
  return {
    constraint,
    permissions: quotedStrings(constraint.slice(arrayStart, arrayEnd)),
  };
}

function readBusinessGuardAllowlist(source) {
  const helper = readSqlFunction(
    source,
    "faolla_role_has_staff_business_permissions_v1",
  );
  const start = helper.indexOf("p_permissions && array[");
  const end = helper.indexOf("]::text[]", start);
  assert.ok(start >= 0 && end > start, "missing business guard allowlist");
  return quotedStrings(helper.slice(start, end));
}

const staffPermissions = readConstArray(
  staffSource,
  "MERCHANT_STAFF_BUSINESS_PERMISSIONS",
);
const collaborationPermissions = readConstArray(
  enterpriseSource,
  "MERCHANT_ENTERPRISE_COLLABORATION_PERMISSIONS",
);
const expectedPermissions = [...collaborationPermissions, ...staffPermissions];
const staffDependencies = readTypeScriptDependencies(
  staffSource,
  "MERCHANT_STAFF_BUSINESS_PERMISSION_DEPENDENCIES",
);
const collaborationDependencies = readTypeScriptDependencies(
  enterpriseSource,
  "MERCHANT_ENTERPRISE_PERMISSION_DEPENDENCIES",
);
const expectedDependencies = new Map([
  ...collaborationDependencies,
  ...staffDependencies,
]);

test("TypeScript exposes exactly 39 unique business permissions inside the enterprise catalog", () => {
  assert.equal(staffPermissions.length, 39);
  assert.equal(new Set(staffPermissions).size, staffPermissions.length);
  assert.deepEqual(
    staffPermissions,
    FROZEN_V1_STAFF_PERMISSIONS,
    "v1 permission keys and ordering are a rollback compatibility contract",
  );
  assert.deepEqual(
    [...collaborationDependencies.keys()],
    collaborationPermissions,
    "every collaboration permission must retain an explicit dependency entry",
  );
  assert.deepEqual(
    [...staffDependencies.keys()],
    staffPermissions,
    "every business permission must have one explicit dependency entry",
  );
  assert.match(
    enterpriseSource,
    /\.\.\.MERCHANT_ENTERPRISE_COLLABORATION_PERMISSIONS[\s\S]+\.\.\.MERCHANT_STAFF_BUSINESS_PERMISSIONS/,
  );
});

test("rollback compatibility marker freezes the exact v1 permission keys", () => {
  const keysDigest = createHash("sha256")
    .update(JSON.stringify(FROZEN_V1_STAFF_PERMISSIONS), "utf8")
    .digest("hex");
  const permissionContract = staffPermissions.map((key) => ({
    key,
    dependencies: staffDependencies.get(key),
  }));
  const contractDigest = createHash("sha256")
    .update(JSON.stringify(permissionContract), "utf8")
    .digest("hex");
  assert.equal(keysDigest, FROZEN_V1_PERMISSION_KEYS_SHA256);
  assert.equal(
    contractDigest,
    FROZEN_V1_PERMISSION_CONTRACT_SHA256,
    "v1 dependency semantics are part of rollback compatibility",
  );
  assert.deepEqual(compatibilityMarker, {
    schema: "faolla.merchant-staff-business-rbac-compatibility",
    version: 1,
    permissionCount: FROZEN_V1_STAFF_PERMISSIONS.length,
    permissionKeysSha256: FROZEN_V1_PERMISSION_KEYS_SHA256,
    permissionContractSha256: FROZEN_V1_PERMISSION_CONTRACT_SHA256,
  });
});

test("SQL validator permission catalog and dependencies exactly match TypeScript", () => {
  const { validator, catalog } = readSqlPermissionCatalog(migrationSource);
  assert.deepEqual([...catalog.keys()], expectedPermissions);
  assert.deepEqual(
    Object.fromEntries(catalog),
    Object.fromEntries(expectedDependencies),
  );
  assert.match(
    validator,
    /cardinality\(p_permissions\)[\s\S]+count\(distinct requested\.permission\)/i,
    "validator must reject duplicate and null permission entries",
  );
  assert.match(
    validator,
    /left join permission_catalog[\s\S]+where catalog\.permission is null/i,
    "validator must reject unknown permissions",
  );
  assert.match(
    validator,
    /catalog\.permission = any\(p_permissions\)[\s\S]+not \(catalog\.dependencies <@ p_permissions\)/i,
    "validator must enforce every selected permission dependency",
  );
});

test("staged CHECK and owner guard use the exact TypeScript allowlists", () => {
  const { constraint, permissions } = readConstraintAllowlist(migrationSource);
  assert.deepEqual(permissions, expectedPermissions);
  assert.match(
    constraint,
    /faolla_valid_merchant_enterprise_permissions_v1\(permissions\)/i,
  );
  assert.deepEqual(readBusinessGuardAllowlist(migrationSource), staffPermissions);
  assert.match(
    migrationSource,
    /validate constraint merchant_enterprise_roles_permissions_check_041[\s\S]+drop constraint merchant_enterprise_roles_permissions_check[\s\S]+rename constraint merchant_enterprise_roles_permissions_check_041/i,
  );
});

test("migration validates stable role rows without backfill or default grants", () => {
  assert.match(
    migrationSource,
    /lock table public\.merchant_enterprise_roles in share row exclusive mode/i,
  );
  assert.match(
    migrationSource,
    /role_prestate_invalid[\s\S]+create or replace function public\.faolla_valid_merchant_enterprise_permissions_v1/i,
  );
  assert.match(
    migrationSource,
    /faolla_valid_merchant_enterprise_permissions_v1\([\s\S]+role_row\.permissions[\s\S]+role_postcondition_failed/i,
  );
  assert.match(
    migrationSource,
    /role_row\.permissions\s*&&\s*array\[[\s\S]+orders\.view[\s\S]+members\.settings\.manage[\s\S]+role_prestate_invalid/i,
    "pre-DDL validation must reject every preseeded business capability",
  );
  const migrationWithoutFunctionDefinitions = stripSqlComments(
    migrationSource.replace(
      /create\s+(?:or\s+replace\s+)?function\s+public\.[\s\S]*?\n\$\$;/gi,
      "",
    ),
  );
  assert.doesNotMatch(
    migrationWithoutFunctionDefinitions,
    /\b(?:update|insert\s+into|delete\s+from)\s+public\.merchant_enterprise_roles\b/i,
    "migration execution must not mutate or backfill role rows outside RPC definitions",
  );
  assert.doesNotMatch(
    migrationSource,
    /faolla_add_default_workflow_permissions_v1|array_append\s*\(/i,
    "migration must not change future default-role permission grants",
  );
});

test("business role writes use owner-verified v3/core paths and fail closed", () => {
  const createV2 = readSqlFunction(
    migrationSource,
    "faolla_create_merchant_enterprise_role_v2",
  );
  const updateV2 = readSqlFunction(
    migrationSource,
    "faolla_update_merchant_enterprise_role_v2",
  );
  const createV3 = readSqlFunction(
    migrationSource,
    "faolla_create_merchant_enterprise_role_v3",
  );
  const updateV3 = readSqlFunction(
    migrationSource,
    "faolla_update_merchant_enterprise_role_v3",
  );
  const guard = readSqlFunction(
    migrationSource,
    "faolla_guard_staff_business_role_owner_v1",
  );
  const strictOwner = readSqlFunction(
    migrationSource,
    "faolla_assert_staff_business_role_owner_v1",
  );
  const workflowGrant = readSqlFunction(
    migrationSource,
    "faolla_grant_merchant_enterprise_role_workflow_permissions_v1",
  );

  for (const [wrapper, core] of [
    [createV2, "faolla_create_merchant_enterprise_role_v2_core_041"],
    [updateV2, "faolla_update_merchant_enterprise_role_v2_core_041"],
  ]) {
    assert.match(
      wrapper,
      /language plpgsql[\s\S]+security definer[\s\S]+set search_path = pg_catalog, public/i,
    );
    assert.match(wrapper, /pg_advisory_xact_lock[\s\S]+faolla:enterprise:role:/i);
    assert.match(wrapper, /faolla_role_has_staff_business_permissions_v1[\s\S]+permission_escalation_denied/i);
    assert.match(wrapper, new RegExp(`public\\.${core}\\(p_input\\)`, "i"));
  }
  assert.match(updateV2, /v_current_permissions[\s\S]+v_next_permissions[\s\S]+\bor\b[\s\S]+permission_escalation_denied/i);

  for (const [wrapper, core] of [
    [createV3, "faolla_create_merchant_enterprise_role_v2_core_041"],
    [updateV3, "faolla_update_merchant_enterprise_role_v2_core_041"],
  ]) {
    assert.match(wrapper, /language plpgsql[\s\S]+security definer[\s\S]+set search_path = pg_catalog, public/i);
    assert.match(wrapper, /staff_business_role_internal_actor_type/i);
    const validationIndex = wrapper.search(
      /if p_input is null[\s\S]+jsonb_typeof\(p_input -> 'actor_type'\) <> 'string'[\s\S]+v_actor_type is null[\s\S]+v_actor_type not in \('owner', 'employee'\)[\s\S]+raise exception 'invalid_role_actor'/i,
    );
    const markerIndex = wrapper.indexOf("perform set_config(");
    const delegateIndex = wrapper.indexOf(`public.${core}(p_input)`);
    assert.ok(validationIndex >= 0, "v3 must strictly validate its actor type");
    assert.doesNotMatch(
      wrapper,
      /btrim\(p_input ->> 'actor_type'\)/i,
      "v3 actor markers must match owner|employee exactly",
    );
    assert.ok(
      validationIndex < markerIndex && markerIndex < delegateIndex,
      "v3 must validate before setting its marker or calling the owner-only core",
    );
    assert.match(
      wrapper,
      /exception when others then[\s\S]+staff_business_role_internal_actor_type[\s\S]+v_previous_actor_type[\s\S]+raise\s*;/i,
      "v3 must restore its transaction-local marker on delegated failure",
    );
  }

  assert.match(createV3, /faolla_assert_staff_business_role_owner_v1[\s\S]+faolla_create_merchant_enterprise_role_v2_core_041/i);
  assert.match(updateV3, /v_next_permissions\s*:=\s*v_current_permissions/i);
  assert.match(
    updateV3,
    /jsonb_object_keys\(p_input\)[\s\S]+merchant_id[\s\S]+role_id[\s\S]+expected_version[\s\S]+actor_type[\s\S]+actor_id[\s\S]+permissions/i,
    "emergency downgrade must reject every non-permission mutation field",
  );
  assert.match(
    updateV3,
    /next_permission\.permission\s*=\s*any\(v_current_permissions\)[\s\S]+permission_escalation_denied/i,
    "emergency downgrade must be a true permission subset",
  );

  const authLockIndex = strictOwner.search(/from auth\.users[\s\S]+for key share/i);
  const merchantLockIndex = strictOwner.search(/from public\.merchants[\s\S]+for share/i);
  assert.ok(authLockIndex >= 0 && authLockIndex < merchantLockIndex);
  for (const alias of [
    "merchant.user_id",
    "merchant.auth_user_id",
    "merchant.owner_user_id",
    "merchant.owner_id",
    "merchant.auth_id",
    "merchant.created_by",
    "merchant.created_by_user_id",
  ]) {
    assert.match(strictOwner, new RegExp(alias.replace(".", "\\."), "i"));
  }
  assert.match(strictOwner, /cardinality\(array_remove\(v_owner_ids, null::uuid\)\) <> 7/i);
  assert.match(strictOwner, /count\(distinct owner_id\)[\s\S]+v_actor_id is distinct from v_owner_ids\[1\]/i);

  assert.equal(
    guard.match(/v_actor_type is distinct from 'owner'/gi)?.length,
    3,
    "INSERT, UPDATE and DELETE must reject missing, employee, and unknown markers",
  );
  assert.doesNotMatch(guard, /v_actor_type\s*=\s*'employee'/i);
  assert.match(
    guard,
    /tg_op = 'INSERT'[\s\S]+new\.permissions[\s\S]+v_actor_type is distinct from 'owner'[\s\S]+permission_escalation_denied/i,
  );
  assert.match(
    guard,
    /tg_op = 'UPDATE'[\s\S]+old\.permissions[\s\S]+new\.permissions[\s\S]+v_actor_type is distinct from 'owner'[\s\S]+permission_escalation_denied/i,
  );
  assert.match(
    guard,
    /tg_op = 'DELETE'[\s\S]+old\.permissions[\s\S]+v_actor_type is distinct from 'owner'[\s\S]+permission_escalation_denied[\s\S]+tg_op = 'DELETE'[\s\S]+return old/i,
  );
  assert.match(
    migrationSource,
    /create trigger merchant_enterprise_roles_staff_business_owner_guard[\s\S]+before insert or update or delete on public\.merchant_enterprise_roles/i,
  );
  assert.match(
    workflowGrant,
    /for update[\s\S]+faolla_role_has_staff_business_permissions_v1[\s\S]+business_role_workflow_grant_requires_role_editor[\s\S]+update public\.merchant_enterprise_roles/i,
  );
  assert.doesNotMatch(
    workflowGrant,
    /faolla_assert_staff_business_role_owner_v1|staff_business_role_internal_actor_type/i,
  );
});

test("role table and RPC ACLs are exact, owner-pinned, and forward registered", () => {
  for (const name of [
    "faolla_create_merchant_enterprise_role_v2",
    "faolla_update_merchant_enterprise_role_v2",
    "faolla_create_merchant_enterprise_role_v3",
    "faolla_update_merchant_enterprise_role_v3",
    "faolla_grant_merchant_enterprise_role_workflow_permissions_v1",
  ]) {
    assert.match(
      migrationSource,
      new RegExp(
        `grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\(jsonb\\)[\\s\\S]+?to\\s+service_role`,
        "i",
      ),
    );
  }
  for (const name of [
    "faolla_create_merchant_enterprise_role_v1",
    "faolla_update_merchant_enterprise_role_v1",
    "faolla_create_merchant_enterprise_role_v2_core_041",
    "faolla_update_merchant_enterprise_role_v2_core_041",
    "faolla_guard_staff_business_role_owner_v1",
    "faolla_assert_staff_business_role_owner_v1",
  ]) {
    assert.match(
      migrationSource,
      new RegExp(`alter\\s+function\\s+public\\.${name}\\(`, "i"),
    );
    assert.match(
      migrationSource,
      new RegExp(`alter\\s+function\\s+public\\.${name}\\([\\s\\S]+?owner\\s+to\\s+supabase_admin`, "i"),
    );
  }
  assert.match(
    migrationSource,
    /revoke all privileges on table public\.merchant_enterprise_roles from %s cascade/i,
  );
  assert.match(
    migrationSource,
    /grant all privileges on table public\.merchant_enterprise_roles[\s\S]+to supabase_admin[\s\S]+grant select on table public\.merchant_enterprise_roles to service_role/i,
  );
  assert.match(
    migrationSource,
    /actual\(grantee, grantor, privilege_type, is_grantable\)[\s\S]+expected\(grantee, grantor, privilege_type, is_grantable\)[\s\S]+except all[\s\S]+role_acl_failed/i,
  );
  assert.match(
    migrationSource,
    /v_owner_only_functions[\s\S]+v_service_functions[\s\S]+has_function_privilege[\s\S]+function_acl_failed/i,
  );
  assert.match(
    migrationSource,
    /\('anon'\), \('authenticated'\), \('authenticator'\)[\s\S]+has_table_privilege[\s\S]+has_function_privilege[\s\S]+effective_acl_failed/i,
  );
  assert.match(
    migrationSource,
    /actual_protected_membership[\s\S]+allowed_membership[\s\S]+with recursive role_path[\s\S]+membership_prerequisite_invalid/i,
  );
  assert.match(
    migrationSource,
    /lock table[\s\S]+pg_catalog\.pg_authid[\s\S]+pg_catalog\.pg_auth_members[\s\S]+pg_catalog\.pg_proc[\s\S]+in share row exclusive mode/i,
  );
  assert.match(
    migrationSource,
    /rolname in \('anon', 'authenticated'\)[\s\S]+rolcreaterole[\s\S]+rolname = 'service_role'[\s\S]+not rolbypassrls[\s\S]+rolname = 'authenticator'[\s\S]+not rolinherit[\s\S]+role_attribute_prerequisite_invalid/i,
  );
  assert.match(
    migrationSource,
    /proowner\s*<>\s*v_owner[\s\S]+proconfig is distinct from[\s\S]+source_md5[\s\S]+function_definition_failed/i,
  );
  assert.match(stripSqlComments(migrationSource), /^\s*begin\s*;/i);
  assert.match(
    migrationSource,
    /values \(202608280041, 'merchant_staff_business_permissions'\)/i,
  );
  assert.match(migrationSource, /notify pgrst, 'reload schema'/i);
  assert.match(migrationSource, /commit\s*;\s*$/i);
});

test("production discovery selects 041 while preserving the dedicated 040 forward-repair boundary", async () => {
  const through040 = await discoverProductionDatabaseMigrations({
    rootDir: root,
    through: "202608190040",
  });
  const through041 = await discoverProductionDatabaseMigrations({
    rootDir: root,
    through: "202608280041",
  });

  assert.equal(through040.selected.at(-1)?.version, "202608190040");
  assert.equal(
    through040.selected.some(({ version }) => version === "202608280041"),
    false,
  );
  assert.equal(through041.selected.at(-1)?.version, "202608280041");
  assert.equal(
    through041.migrations.filter(({ version }) => version === "202608280041")
      .length,
    1,
  );
  assert.deepEqual(
    through041.selected.slice(-2).map(({ version }) => version),
    ["202608190040", "202608280041"],
  );

  assert.match(
    productionMigratorSource,
    /const MERCHANT_ACL_MIGRATION_FILE\s*=\s*[\s\S]{0,80}"202608190040_merchant_acl_contract_hardening\.sql"/,
  );
  assert.doesNotMatch(
    productionMigratorSource,
    /const\s+[A-Z0-9_]+\s*=\s*"202608280041_merchant_staff_business_permissions\.sql"/,
    "041 must remain on the ordinary additive migration path",
  );
  assert.match(
    productionWorkflowSource,
    /discovery\.selected\.at\(-1\)\?\.version !== through/,
  );
  assert.match(
    productionWorkflowSource,
    /FORWARD_REPAIR_CONFIRMED === "true"[\s\S]+through !== DATABASE_MIGRATE_FORWARD_REPAIR\.version/,
  );
  assert.match(
    productionWorkflowSource,
    /APPLY_MERCHANT_ACL_FORWARD_REPAIR_202608190040/,
  );
  assert.doesNotMatch(
    productionWorkflowSource,
    /APPLY_MERCHANT_STAFF_BUSINESS_PERMISSIONS|FORWARD_REPAIR_202608280041/,
  );
});

test("repository migration checks and PG15 integration runner are wired through 041", () => {
  assert.match(
    packageManifest.scripts["test:db-migrations"],
    /(?:^|\s)scripts\/merchant-staff-business-permissions-migration-contract\.test\.mjs(?:\s|$)/,
  );
  assert.equal(
    enterpriseWorkflowSource.match(
      /- "scripts\/merchant-staff-business-permissions-migration-contract\.test\.mjs"/g,
    )?.length,
    2,
  );
  assert.match(
    enterpriseWorkflowSource,
    /node --test scripts\/enterprise-integration-workflow-contract\.test\.mjs scripts\/merchant-staff-business-permissions-migration-contract\.test\.mjs/,
  );

  assert.match(
    enterpriseRunnerSource,
    /-name '\*_merchant_staff_business_permissions\.sql'/,
  );
  assert.match(
    enterpriseRunnerSource,
    /staff_business_permissions_migration_path="\$\{REPOSITORY_ROOT\}\/scripts\/supabase-migrations\/202608280041_merchant_staff_business_permissions\.sql"/,
  );
  assert.match(
    enterpriseRunnerSource,
    /Staff business permissions 041 require the exact 040 merchant ACL migration/,
  );
  assert.match(enterpriseRunnerSource, /expected_registry_count=44/);
  assert.match(
    enterpriseRunnerSource,
    /"202608280041_merchant_staff_business_permissions\.sql"[\s\S]+alter table public\.merchant_enterprise_roles owner to supabase_admin[\s\S]+run_sql_file_as_role "\$\{migration\}" supabase_admin[\s\S]+63-staff-business-permissions\.sql" supabase_admin/,
  );
  assert.match(
    enterpriseRunnerSource,
    /rejecting a preseeded business permission before 041 DDL[\s\S]+role_prestate_invalid[\s\S]+rejecting transitive protected-role membership pollution[\s\S]+membership_prerequisite_invalid[\s\S]+rejecting authenticated CREATEROLE drift[\s\S]+role_attribute_prerequisite_invalid[\s\S]+rejecting authenticator CREATEROLE drift/,
  );
  assert.match(
    enterpriseRunnerSource,
    /pg_get_constraintdef[\s\S]+drop constraint merchant_enterprise_roles_permissions_check[\s\S]+add constraint merchant_enterprise_roles_permissions_check check \(true\)[\s\S]+staff_business_constraint_after_rejection[\s\S]+add constraint merchant_enterprise_roles_permissions_check \$\{staff_business_permissions_constraint_definition\}[\s\S]+staff_business_restored_constraint_definition/,
    "the preseed fixture must temporarily relax and then exactly restore the legacy CHECK",
  );
  assert.match(
    enterpriseRunnerSource,
    /staff_business_roles_trigger_definition[\s\S]+pg_get_triggerdef[\s\S]+set local session_replication_role = replica[\s\S]+staff_business_roles_trigger_after_injection[\s\S]+session_replication_role[\s\S]+staff_business_roles_trigger_after_rejection/,
    "the preseed fixture may bypass origin triggers only transaction-locally and must prove they did not drift",
  );
  assert.equal(
    enterpriseRunnerSource.match(/trigger_metadata\.tgenabled::text/g)?.length,
    3,
    "every trigger fingerprint must explicitly normalize PostgreSQL's internal char type",
  );
  assert.match(
    enterpriseRunnerSource,
    /staff_business_dashboard_prestate[\s\S]+to_regrole\('dashboard_user'\) is null[\s\S]+create role dashboard_user nologin noinherit[\s\S]+grant dashboard_user to redteam_staff_business_path_a_041[\s\S]+grant redteam_staff_business_path_a_041 to redteam_staff_business_path_b_041[\s\S]+pg_has_role\('redteam_staff_business_path_b_041', 'dashboard_user', 'MEMBER'\)[\s\S]+count\(\*\) = 2 and bool_and\(not \(granted_role\.rolname in[\s\S]+drop role redteam_staff_business_path_b_041; drop role redteam_staff_business_path_a_041; drop role dashboard_user/,
    "the role-graph fixture must reach a protected role without matching the direct-edge filter",
  );
  assert.match(
    enterpriseRunnerSource,
    /version in \([^)]*202608190040, 202608280041\)/,
  );
  assert.match(
    enterpriseRunnerSource,
    /"202608190040_merchant_acl_contract_hardening\.sql"[\s\S]+run_merchant_acl_040_with_hosted_postgres "\$\{migration\}"[\s\S]+040 exact-target replay changed ACL or registry state/,
    "040 must retain its dedicated hosted-prestate and replay checks",
  );

  assert.match(
    enterpriseAcceptanceSource,
    /not public\.faolla_valid_merchant_enterprise_permissions_v1\([\s\S]+duplicate business permissions were accepted/,
  );
  assert.match(
    enterpriseAcceptanceSource,
    /select id::text as role_manager_a,\s*version as role_manager_version_a[\s\S]+name = 'Scoped role manager'[\s\S]+\\gset[\s\S]+:'role_manager_a'/,
    "the standalone 63 acceptance file must seed its own role-manager psql variables",
  );
  for (const dynamicSql of enterpriseAcceptanceSource.matchAll(
    /\$sql\$([\s\S]*?)\$sql\$/g,
  )) {
    assert.doesNotMatch(
      dynamicSql[1],
      /(?<!:):(?:'[A-Za-z_][A-Za-z0-9_]*'|[A-Za-z_][A-Za-z0-9_]*)/,
      "psql variables are not expanded inside dollar-quoted dynamic SQL",
    );
  }
  assert.match(
    enterpriseAcceptanceSource,
    /faolla_create_merchant_enterprise_role_v3[\s\S]+faolla_update_merchant_enterprise_role_v3[\s\S]+permission_escalation_denied/,
  );
  assert.match(
    enterpriseAcceptanceSource,
    /Missing actor business role 041[\s\S]+invalid_role_actor[\s\S]+Unknown actor business role 041[\s\S]+invalid_role_actor/,
  );
  assert.match(
    enterpriseAcceptanceSource,
    /Missing actor role update 041[\s\S]+invalid_role_actor[\s\S]+Unknown actor role update 041[\s\S]+invalid_role_actor/,
  );
  assert.match(
    enterpriseAcceptanceSource,
    /faolla_create_merchant_enterprise_role_v2[\s\S]+Legacy v2 business role 041[\s\S]+permission_escalation_denied/,
  );
  assert.match(
    enterpriseAcceptanceSource,
    /Legacy v2 collaboration role 041[\s\S]+Rollback-compatible ordinary role fixture/,
  );
  assert.match(
    enterpriseAcceptanceSource,
    /faolla_create_merchant_enterprise_role_v2_core_041[\s\S]+permission denied/,
  );
  assert.match(
    enterpriseAcceptanceSource,
    /insert into public\.merchant_enterprise_roles[\s\S]+Direct backend business role 041[\s\S]+permission_escalation_denied/,
  );
  assert.match(
    enterpriseAcceptanceSource,
    /Owner business role 041[\s\S]+Direct-renamed business role 041[\s\S]+permission_escalation_denied/,
  );
  assert.match(
    enterpriseAcceptanceSource,
    /Employee-renamed business role 041[\s\S]+permission_escalation_denied[\s\S]+status', 'archived'[\s\S]+permission_escalation_denied/,
  );
  assert.match(
    enterpriseAcceptanceSource,
    /Employee collaboration role 041[\s\S]+Legacy collaboration behavior through v3/,
  );
  assert.match(
    enterpriseAcceptanceSource,
    /Business downgrade role 041[\s\S]+actor_type', 'employee'[\s\S]+permission_escalation_denied[\s\S]+status', 'archived'[\s\S]+permission_escalation_denied[\s\S]+roles\.manage'[\s\S]+permission_escalation_denied[\s\S]+permissions', jsonb_build_array\('enterprise\.view'\)/,
  );
  assert.match(
    enterpriseAcceptanceSource,
    /faolla_grant_merchant_enterprise_role_workflow_permissions_v1[\s\S]+staff-business-workflow-grant-041[\s\S]+business_role_workflow_grant_requires_role_editor[\s\S]+staff-ordinary-workflow-grant-041/,
  );
});
