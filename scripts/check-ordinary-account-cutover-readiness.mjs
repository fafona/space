import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { inspectSelfHostedSupabaseTopology } from "./check-database-backup-readiness.mjs";
import {
  acquireProductionMigrationLock,
  runMigrationCommand,
} from "./apply-production-database-migrations.mjs";
import {
  isOrdinaryAccountIdentityContentSha256,
  ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_KEY,
  ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_SCALAR_SQL,
} from "./ordinary-account-identity-content-contract.mjs";

const CONTAINER_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,159}$/;
const DATABASE_NAME_PATTERN = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,62}$/;
const UNSIGNED_DECIMAL_PATTERN = /^(?:0|[1-9][0-9]{0,19})$/;
const POSITIVE_COUNT_PATTERN = /^[1-9][0-9]{0,14}$/;
const NON_NEGATIVE_COUNT_PATTERN = /^(?:0|[1-9][0-9]{0,14})$/;
const MAX_UINT64 = 18_446_744_073_709_551_615n;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DEFAULT_COMMAND_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const RUNTIME_RPC_HARDENING_MIGRATION_SHA256 =
  "9adcb21146cf24ae25e1acb26ebe1709a6f93a99e7e950bca6daf5f4d2b88eed";
const RUNTIME_RPC_HARDENING_MIGRATION_URL = new URL(
  "./supabase-migrations/202608190039_runtime_rpc_execute_acl_hardening.sql",
  import.meta.url,
);

function extractDollarQuotedDoBlock(source, label) {
  const delimiter = `$${label}$`;
  const opening = `do ${delimiter}`;
  const closing = `${delimiter};`;
  const start = source.indexOf(opening);
  const end = start < 0 ? -1 : source.indexOf(closing, start + opening.length);
  if (
    start < 0 ||
    end < 0 ||
    source.indexOf(opening, start + opening.length) >= 0
  ) {
    throw new Error(
      `ordinary_account_readiness_runtime_block_invalid:${label}`,
    );
  }
  return source.slice(start, end + closing.length);
}

function loadRuntimeRpcHardeningReadOnlyBlocks() {
  const source = readFileSync(RUNTIME_RPC_HARDENING_MIGRATION_URL, "utf8");
  const sourceHash = createHash("sha256").update(source, "utf8").digest("hex");
  if (sourceHash !== RUNTIME_RPC_HARDENING_MIGRATION_SHA256) {
    throw new Error("ordinary_account_readiness_runtime_source_invalid");
  }
  return Object.fromEntries(
    [
      "migrator_preflight",
      "catalog_quiescence_postlock",
      "preflight",
      "role_graph_postcondition",
      "postcondition",
      "definition_postcondition",
      "registry_postcondition",
    ].map((label) => [label, extractDollarQuotedDoBlock(source, label)]),
  );
}

const RUNTIME_RPC_HARDENING_READ_ONLY_BLOCKS =
  loadRuntimeRpcHardeningReadOnlyBlocks();

const PSQL_CONTAINER_SCRIPT = [
  "set -eu",
  ': "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"',
  ': "${POSTGRES_DB:?POSTGRES_DB is required}"',
  ': "${FAOLLA_EXPECTED_DATABASE_NAME:?FAOLLA_EXPECTED_DATABASE_NAME is required}"',
  ': "${FAOLLA_EXPECTED_DATABASE_SYSTEM_IDENTIFIER:?FAOLLA_EXPECTED_DATABASE_SYSTEM_IDENTIFIER is required}"',
  ': "${FAOLLA_EXPECTED_MERCHANT_RECORD_COUNT:?FAOLLA_EXPECTED_MERCHANT_RECORD_COUNT is required}"',
  ': "${FAOLLA_EXPECTED_PERSONAL_CANONICAL_COUNT:?FAOLLA_EXPECTED_PERSONAL_CANONICAL_COUNT is required}"',
  ': "${FAOLLA_EXPECTED_ORDINARY_IDENTITY_CONTENT_SHA256:?FAOLLA_EXPECTED_ORDINARY_IDENTITY_CONTENT_SHA256 is required}"',
  'export PGPASSWORD="$POSTGRES_PASSWORD"',
  "export PGOPTIONS='-c lock_timeout=15s -c statement_timeout=120s'",
  "exec psql --host=localhost --username=supabase_admin " +
    '--dbname="$POSTGRES_DB" --no-password --no-psqlrc ' +
    "--set=ON_ERROR_STOP=1 --set=VERBOSITY=verbose " +
    '--set=expected_database_name="$FAOLLA_EXPECTED_DATABASE_NAME" ' +
    '--set=expected_database_system_identifier="$FAOLLA_EXPECTED_DATABASE_SYSTEM_IDENTIFIER" ' +
    '--set=expected_merchant_record_count="$FAOLLA_EXPECTED_MERCHANT_RECORD_COUNT" ' +
    '--set=expected_personal_canonical_count="$FAOLLA_EXPECTED_PERSONAL_CANONICAL_COUNT" ' +
    '--set=expected_ordinary_identity_content_sha256="$FAOLLA_EXPECTED_ORDINARY_IDENTITY_CONTENT_SHA256" ' +
    "--quiet --tuples-only --no-align",
].join("\n");

export const PLATFORM_FUNCTION_DEFAULT_ACL_EXPECTED = Object.freeze(
  [
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
  ].map((entry) => Object.freeze(entry)),
);

const PLATFORM_FUNCTION_DEFAULT_ACL_EXPECTED_VALUES_SQL =
  PLATFORM_FUNCTION_DEFAULT_ACL_EXPECTED.map(
    ([creatorName, schemaName, granteeName, grantable]) =>
      `('${creatorName}', '${schemaName}', '${granteeName}', ${grantable})`,
  ).join(",\n    ");

const OBJECT_CONTRACT_OBSERVER_RELATIONS = Object.freeze([
  "auth.users",
  "public.merchants",
  "public.faolla_personal_accounts",
  "public.merchant_enterprise_staff_identities",
  "public.merchant_enterprise_employees",
]);
const OBJECT_CONTRACT_OBSERVER_COLUMNS = Object.freeze([
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
]);
const OBJECT_CONTRACT_MERCHANT_POLICIES = Object.freeze(
  [
    [
      "merchants_select_own",
      "r",
      true,
      "42205aae07118e35699a5507ffe3385a",
      null,
    ],
    [
      "merchants_insert_self",
      "a",
      true,
      null,
      "899af52ac5bbc8824aa635183199f48a",
    ],
    [
      "merchants_update_own",
      "w",
      true,
      "42205aae07118e35699a5507ffe3385a",
      "42205aae07118e35699a5507ffe3385a",
    ],
    [
      "merchants_system_site_principal_isolation",
      "w",
      false,
      "1c08e1341a191bbc45013950a337671d",
      "1c08e1341a191bbc45013950a337671d",
    ],
    [
      "merchants_system_site_principal_insert_isolation",
      "a",
      false,
      null,
      "1c08e1341a191bbc45013950a337671d",
    ],
  ].map((entry) => Object.freeze(entry)),
);
const OBJECT_CONTRACT_ACL_PRINCIPALS = Object.freeze([
  "PUBLIC",
  "supabase_admin",
  "postgres",
  "anon",
  "authenticated",
  "service_role",
]);
const OBJECT_CONTRACT_TABLE_PRIVILEGES = Object.freeze([
  "INSERT",
  "SELECT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
]);
const OBJECT_CONTRACT_PERSONAL_COLUMNS = Object.freeze([
  "public.faolla_personal_accounts.auth_user_id",
  "public.faolla_personal_accounts.personal_account_id",
  "public.faolla_personal_accounts.status",
  "public.faolla_personal_accounts.version",
  "public.faolla_personal_accounts.created_at",
  "public.faolla_personal_accounts.updated_at",
]);
const OBJECT_CONTRACT_PERSONAL_INDEXES = Object.freeze([
  "public.faolla_personal_accounts_auth_user_id_uidx",
  "public.faolla_personal_accounts_personal_account_id_uidx",
]);
const OBJECT_CONTRACT_PERSONAL_CONSTRAINTS = Object.freeze([
  "faolla_personal_accounts_personal_account_id_safe",
  "faolla_personal_accounts_status_valid",
  "faolla_personal_accounts_version_valid",
  "faolla_personal_accounts_timestamps_valid",
]);
const OBJECT_CONTRACT_REGISTRY_COLUMNS = Object.freeze([
  "public.faolla_schema_migrations.version",
  "public.faolla_schema_migrations.name",
  "public.faolla_schema_migrations.applied_at",
]);

function fixedTextArraySql(values) {
  return `ARRAY[${values.map((value) => `'${value}'`).join(",")} ]::text[]`;
}

const OBJECT_CONTRACT_OBSERVER_RELATION_ORDER_SQL = fixedTextArraySql(
  OBJECT_CONTRACT_OBSERVER_RELATIONS,
);
const OBJECT_CONTRACT_OBSERVER_COLUMN_ORDER_SQL = fixedTextArraySql(
  OBJECT_CONTRACT_OBSERVER_COLUMNS,
);
const OBJECT_CONTRACT_MERCHANT_POLICY_ORDER_SQL = fixedTextArraySql(
  OBJECT_CONTRACT_MERCHANT_POLICIES.map(([policyName]) => policyName),
);
const OBJECT_CONTRACT_ACL_PRINCIPAL_VALUES_SQL =
  OBJECT_CONTRACT_ACL_PRINCIPALS.map(
    (principal, index) =>
      `(${index + 1}, '${principal}', ${
        principal === "PUBLIC" ? "0::oid" : `to_regrole('${principal}')`
      })`,
  ).join(",\n    ");
const OBJECT_CONTRACT_TABLE_PRIVILEGE_VALUES_SQL =
  OBJECT_CONTRACT_TABLE_PRIVILEGES.map(
    (privilege, index) => `(${index + 1}, '${privilege}')`,
  ).join(",\n    ");
const OBJECT_CONTRACT_PERSONAL_COLUMN_ORDER_SQL = fixedTextArraySql(
  OBJECT_CONTRACT_PERSONAL_COLUMNS,
);
const OBJECT_CONTRACT_PERSONAL_INDEX_ORDER_SQL = fixedTextArraySql(
  OBJECT_CONTRACT_PERSONAL_INDEXES,
);
const OBJECT_CONTRACT_PERSONAL_CONSTRAINT_ORDER_SQL = fixedTextArraySql(
  OBJECT_CONTRACT_PERSONAL_CONSTRAINTS,
);
const OBJECT_CONTRACT_REGISTRY_COLUMN_ORDER_SQL = fixedTextArraySql(
  OBJECT_CONTRACT_REGISTRY_COLUMNS,
);

const ORDINARY_ACCOUNT_CUTOVER_AGGREGATE_SQL = String.raw`WITH expected_migration(version, name) AS (
  VALUES
    (202608190035::bigint, 'ordinary_account_authorization_foundation'::text),
    (202608190036::bigint, 'ordinary_account_authorization_bootstrap'::text),
    (202608190037::bigint, 'ordinary_account_system_site_principal_isolation'::text),
    (202608190038::bigint, 'ordinary_account_recovery_observer'::text),
    (202608190039::bigint, 'runtime_rpc_execute_acl_hardening'::text),
    (202608190040::bigint, 'merchant_acl_contract_hardening'::text)
), registry AS MATERIALIZED (
  SELECT registry_metadata.oid, registry_metadata.relowner,
         registry_metadata.relacl, registry_metadata.relkind,
         registry_metadata.relpersistence, registry_metadata.relnamespace,
         registry_metadata.relrowsecurity, registry_metadata.relforcerowsecurity,
         registry_metadata.relispartition, registry_metadata.relreplident
    FROM (SELECT to_regclass('public.faolla_schema_migrations') AS oid) AS target
    LEFT JOIN pg_catalog.pg_class AS registry_metadata
      ON registry_metadata.oid = target.oid
), migration_state AS MATERIALIZED (
  SELECT
    6 = (
      SELECT count(*)
        FROM expected_migration AS expected
        JOIN public.faolla_schema_migrations AS actual
          ON actual.version = expected.version
         AND actual.name = expected.name
    )
    AND NOT EXISTS (
      SELECT 1
        FROM public.faolla_schema_migrations AS actual
       WHERE actual.version IN (SELECT version FROM expected_migration)
         AND NOT EXISTS (
           SELECT 1 FROM expected_migration AS expected
            WHERE expected.version = actual.version
              AND expected.name = actual.name
         )
    ) AS ready
), expected_function(
  signature, function_name, source_md5, volatility, argument_count,
  argument_names, return_type, service_execute
) AS (
  VALUES
    ('public.faolla_resolve_ordinary_account_authorization_v1(uuid)',
     'faolla_resolve_ordinary_account_authorization_v1',
     'f373935460d080024f2a90edcb8d6889', 'v', 1,
     ARRAY['p_auth_user_id']::text[], 'pg_catalog.jsonb'::regtype, true),
    ('public.faolla_get_ordinary_account_authorization_readiness_v1()',
     'faolla_get_ordinary_account_authorization_readiness_v1',
     '5bcc22dfc26ba64336e4f64f23c94cf0', 'v', 0, NULL::text[],
     'pg_catalog.jsonb'::regtype, true),
    ('public.faolla_create_ordinary_account_authorization_v1(uuid,text,text)',
     'faolla_create_ordinary_account_authorization_v1',
     '4c6dd4e6b1090d2564da2c856bf54e80', 'v', 3,
     ARRAY['p_auth_user_id','p_account_type','p_account_id']::text[],
     'pg_catalog.jsonb'::regtype, true),
    ('public.faolla_bootstrap_ordinary_account_authorization_v1(uuid,text)',
     'faolla_bootstrap_ordinary_account_authorization_v1',
     'b0067cdbd61bdd4c967d8171b5080336', 'v', 2,
     ARRAY['p_auth_user_id','p_account_type']::text[],
     'pg_catalog.jsonb'::regtype, true),
    ('public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()',
     'faolla_get_ordinary_account_authoritative_cutover_readiness_v1',
     'e98fd6d7d08c7f021f205d265afd56f8', 's', 0, NULL::text[],
     'pg_catalog.jsonb'::regtype, true),
    ('public.faolla_observe_ordinary_account_recovery_v1(uuid,text)',
     'faolla_observe_ordinary_account_recovery_v1',
     '2ea42524e24378cb17c3cb423c572ad2', 's', 2,
     ARRAY['p_auth_user_id','p_personal_account_id']::text[],
     'pg_catalog.jsonb'::regtype, true),
    ('public.faolla_guard_personal_account_binding_v1()',
     'faolla_guard_personal_account_binding_v1',
     '9e5572f34a178da6551efda74751ba18', 'v', 0, NULL::text[],
     'pg_catalog.trigger'::regtype, false),
    ('public.faolla_guard_staff_identity_ordinary_exclusion_v1()',
     'faolla_guard_staff_identity_ordinary_exclusion_v1',
     'd218b98933beb03e4d519e00a43a10d4', 'v', 0, NULL::text[],
     'pg_catalog.trigger'::regtype, false),
    ('public.faolla_guard_auth_user_ordinary_account_delete_v1()',
     'faolla_guard_auth_user_ordinary_account_delete_v1',
     '8716c9419a42d19af5d2139475acf5ff', 'v', 0, NULL::text[],
     'pg_catalog.trigger'::regtype, false)
), function_metadata_state AS MATERIALIZED (
  SELECT NOT EXISTS (
    SELECT 1
      FROM expected_function AS expected
      CROSS JOIN registry
      LEFT JOIN pg_catalog.pg_proc AS metadata
        ON metadata.oid = to_regprocedure(expected.signature)
      LEFT JOIN pg_catalog.pg_language AS language_metadata
        ON language_metadata.oid = metadata.prolang
     WHERE metadata.oid IS NULL
        OR registry.relowner IS NULL
        OR metadata.proowner <> registry.relowner
        OR metadata.pronamespace <> to_regnamespace('public')
        OR metadata.proname <> expected.function_name
        OR metadata.prokind <> 'f'
        OR metadata.pronargs <> expected.argument_count
        OR metadata.prosecdef IS NOT TRUE
        OR metadata.provolatile::text <> expected.volatility
        OR metadata.proparallel <> 'u'
        OR metadata.proconfig IS DISTINCT FROM
          ARRAY['search_path=pg_catalog, public']::text[]
        OR language_metadata.lanname <> 'plpgsql'
        OR metadata.prorettype <> expected.return_type
        OR metadata.proretset
        OR metadata.proisstrict
        OR metadata.proleakproof
        OR metadata.pronargdefaults <> 0
        OR metadata.proargnames IS DISTINCT FROM expected.argument_names
        OR metadata.proargmodes IS NOT NULL
        OR metadata.proallargtypes IS NOT NULL
        OR pg_catalog.md5(pg_catalog.replace(metadata.prosrc, E'\r\n', E'\n'))
          <> expected.source_md5
        OR 1 <> (
          SELECT count(*) FROM pg_catalog.pg_proc AS overload
           WHERE overload.pronamespace = to_regnamespace('public')
             AND overload.proname = expected.function_name
        )
  ) AS ready
), function_acl_state AS MATERIALIZED (
  SELECT NOT EXISTS (
    SELECT 1
      FROM expected_function AS expected
      CROSS JOIN registry
      LEFT JOIN pg_catalog.pg_proc AS metadata
        ON metadata.oid = to_regprocedure(expected.signature)
     WHERE metadata.oid IS NULL
        OR registry.relowner IS NULL
        OR (CASE WHEN expected.service_execute THEN 2 ELSE 1 END) <> (
          SELECT count(*)
            FROM pg_catalog.aclexplode(coalesce(
              metadata.proacl,
              pg_catalog.acldefault('f', metadata.proowner)
            )) AS acl
        )
        OR EXISTS (
          SELECT 1
            FROM pg_catalog.aclexplode(coalesce(
              metadata.proacl,
              pg_catalog.acldefault('f', metadata.proowner)
            )) AS acl
           WHERE acl.grantor <> metadata.proowner
              OR acl.privilege_type <> 'EXECUTE'
              OR acl.is_grantable
              OR (
                acl.grantee <> metadata.proowner
                AND (
                  NOT expected.service_execute
                  OR acl.grantee <> to_regrole('service_role')
                )
              )
        )
        OR NOT EXISTS (
          SELECT 1
            FROM pg_catalog.aclexplode(coalesce(
              metadata.proacl,
              pg_catalog.acldefault('f', metadata.proowner)
            )) AS acl
           WHERE acl.grantee = metadata.proowner
             AND acl.grantor = metadata.proowner
             AND acl.privilege_type = 'EXECUTE'
             AND NOT acl.is_grantable
        )
        OR (
          expected.service_execute
          AND NOT EXISTS (
          SELECT 1
            FROM pg_catalog.aclexplode(coalesce(
              metadata.proacl,
              pg_catalog.acldefault('f', metadata.proowner)
            )) AS acl
           WHERE acl.grantee = to_regrole('service_role')
             AND acl.grantor = metadata.proowner
             AND acl.privilege_type = 'EXECUTE'
             AND NOT acl.is_grantable
          )
        )
        OR pg_catalog.has_function_privilege(
          'anon', expected.signature, 'EXECUTE'
        )
        OR pg_catalog.has_function_privilege(
          'authenticated', expected.signature, 'EXECUTE'
        )
        OR pg_catalog.has_function_privilege(
          'service_role', expected.signature, 'EXECUTE'
        ) <> expected.service_execute
  ) AS ready
), expected_observer_relation(relation_name) AS (
  VALUES
    ('auth.users'),
    ('public.merchants'),
    ('public.faolla_personal_accounts'),
    ('public.merchant_enterprise_staff_identities'),
    ('public.merchant_enterprise_employees')
), expected_observer_column(
  relation_name, column_name, type_oid, type_modifier, not_null, collation_oid
) AS (
  VALUES
    ('auth.users', 'id', 'pg_catalog.uuid'::regtype, -1, true, 0::oid),
    ('public.merchants', 'id', 'pg_catalog.text'::regtype, -1, true,
     to_regcollation('pg_catalog.default')),
    ('public.merchants', 'user_id', 'pg_catalog.uuid'::regtype, -1, false, 0::oid),
    ('public.merchants', 'auth_user_id', 'pg_catalog.uuid'::regtype, -1, false, 0::oid),
    ('public.merchants', 'owner_user_id', 'pg_catalog.uuid'::regtype, -1, false, 0::oid),
    ('public.merchants', 'owner_id', 'pg_catalog.uuid'::regtype, -1, false, 0::oid),
    ('public.merchants', 'auth_id', 'pg_catalog.uuid'::regtype, -1, false, 0::oid),
    ('public.merchants', 'created_by', 'pg_catalog.uuid'::regtype, -1, false, 0::oid),
    ('public.merchants', 'created_by_user_id', 'pg_catalog.uuid'::regtype, -1, false, 0::oid),
    ('public.faolla_personal_accounts', 'auth_user_id',
     'pg_catalog.uuid'::regtype, -1, true, 0::oid),
    ('public.faolla_personal_accounts', 'personal_account_id',
     'pg_catalog.text'::regtype, -1, true,
     to_regcollation('pg_catalog.default')),
    ('public.faolla_personal_accounts', 'status',
     'pg_catalog.text'::regtype, -1, true,
     to_regcollation('pg_catalog.default')),
    ('public.merchant_enterprise_staff_identities', 'auth_user_id',
     'pg_catalog.uuid'::regtype, -1, true, 0::oid),
    ('public.merchant_enterprise_employees', 'auth_user_id',
     'pg_catalog.uuid'::regtype, -1, false, 0::oid)
), observer_schema_state AS MATERIALIZED (
  SELECT
    5 = (SELECT count(*) FROM expected_observer_relation)
    AND NOT EXISTS (
      SELECT 1
        FROM expected_observer_relation AS expected
        LEFT JOIN pg_catalog.pg_class AS relation
          ON relation.oid = to_regclass(expected.relation_name)
       WHERE relation.oid IS NULL
          OR relation.relkind <> 'r'
          OR relation.relpersistence <> 'p'
          OR relation.relispartition
          OR EXISTS (
            SELECT 1 FROM pg_catalog.pg_inherits AS inheritance
             WHERE inheritance.inhrelid = relation.oid
                OR inheritance.inhparent = relation.oid
          )
    )
    AND 14 = (SELECT count(*) FROM expected_observer_column)
    AND NOT EXISTS (
      SELECT 1
        FROM expected_observer_column AS expected
       WHERE to_regclass(expected.relation_name) IS NULL
          OR NOT EXISTS (
            SELECT 1
              FROM pg_catalog.pg_attribute AS attribute
             WHERE attribute.attrelid = to_regclass(expected.relation_name)
               AND attribute.attname = expected.column_name
               AND attribute.attnum > 0
               AND attribute.atttypid = expected.type_oid
               AND attribute.atttypmod = expected.type_modifier
               AND attribute.attnotnull = expected.not_null
               AND attribute.attcollation = expected.collation_oid
               AND attribute.attidentity = ''
               AND attribute.attgenerated = ''
               AND NOT attribute.attisdropped
          )
    ) AS ready
), expected_merchant_policy(
  policy_name, command, permissive, qual_md5, check_md5
) AS (
  VALUES
    ('merchants_select_own', 'r', true,
     '42205aae07118e35699a5507ffe3385a',
     NULL::text),
    ('merchants_insert_self', 'a', true, NULL::text,
     '899af52ac5bbc8824aa635183199f48a'),
    ('merchants_update_own', 'w', true,
     '42205aae07118e35699a5507ffe3385a',
     '42205aae07118e35699a5507ffe3385a'),
    ('merchants_system_site_principal_isolation', 'w', false,
     '1c08e1341a191bbc45013950a337671d',
     '1c08e1341a191bbc45013950a337671d'),
    ('merchants_system_site_principal_insert_isolation', 'a', false,
     NULL::text, '1c08e1341a191bbc45013950a337671d')
), merchant_contract_state AS MATERIALIZED (
  SELECT coalesce((
    SELECT merchant.relkind = 'r'
       AND merchant.relpersistence = 'p'
       AND merchant.relowner = to_regrole('supabase_admin')
       AND merchant.relrowsecurity
       AND NOT merchant.relforcerowsecurity
       AND NOT merchant.relispartition
       AND merchant.relreplident = 'd'
       AND 5 = (
         SELECT count(*) FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = merchant.oid
       )
       AND NOT EXISTS (
         SELECT 1
           FROM expected_merchant_policy AS expected
          WHERE NOT EXISTS (
            SELECT 1
              FROM pg_catalog.pg_policy AS policy
             WHERE policy.polrelid = merchant.oid
               AND policy.polname = expected.policy_name
               AND policy.polcmd::text = expected.command
               AND policy.polpermissive = expected.permissive
               AND policy.polroles = ARRAY[to_regrole('authenticated')]::oid[]
               AND pg_catalog.md5(pg_catalog.pg_get_expr(
                     policy.polqual, policy.polrelid, false
                   )) IS NOT DISTINCT FROM expected.qual_md5
               AND pg_catalog.md5(pg_catalog.pg_get_expr(
                     policy.polwithcheck, policy.polrelid, false
                   )) IS NOT DISTINCT FROM expected.check_md5
          )
       )
       AND NOT EXISTS (
         WITH actual AS (
           SELECT acl.grantee, acl.grantor, acl.privilege_type, acl.is_grantable
             FROM pg_catalog.aclexplode(coalesce(
               merchant.relacl, pg_catalog.acldefault('r', merchant.relowner)
             )) AS acl
         ), expected AS (
           SELECT acl.grantee, acl.grantor, acl.privilege_type, acl.is_grantable
             FROM pg_catalog.aclexplode(
               pg_catalog.acldefault('r', merchant.relowner)
             ) AS acl
           UNION ALL
           SELECT to_regrole('postgres'), merchant.relowner,
                  acl.privilege_type, false
             FROM pg_catalog.aclexplode(
               pg_catalog.acldefault('r', merchant.relowner)
             ) AS acl
           UNION ALL
           SELECT to_regrole('authenticated'), merchant.relowner,
                  privilege_type, false
             FROM unnest(ARRAY['SELECT','INSERT','UPDATE']::text[])
                  AS privilege(privilege_type)
           UNION ALL
           SELECT to_regrole('service_role'), merchant.relowner,
                  privilege_type, false
             FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[])
                  AS privilege(privilege_type)
         )
         (SELECT * FROM actual EXCEPT SELECT * FROM expected)
         UNION ALL
         (SELECT * FROM expected EXCEPT SELECT * FROM actual)
       )
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = merchant.oid
            AND attribute.attnum > 0 AND NOT attribute.attisdropped
            AND attribute.attacl IS NOT NULL
       )
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_inherits AS inheritance
          WHERE inheritance.inhrelid = merchant.oid
             OR inheritance.inhparent = merchant.oid
       )
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_rewrite AS rule
          WHERE rule.ev_class = merchant.oid
       )
      FROM pg_catalog.pg_class AS merchant
     WHERE merchant.oid = to_regclass('public.merchants')
       AND merchant.relnamespace = to_regnamespace('public')
  ), false) AS ready
), personal_contract_state AS MATERIALIZED (
  SELECT coalesce((
    SELECT personal.relkind = 'r'
       AND personal.relpersistence = 'p'
       AND personal.relowner = to_regrole('supabase_admin')
       AND personal.relrowsecurity
       AND NOT personal.relforcerowsecurity
       AND NOT personal.relispartition
       AND personal.relreplident = 'd'
       AND 6 = (
         SELECT count(*) FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = personal.oid AND attribute.attnum > 0
       )
       AND NOT EXISTS (
         SELECT 1
           FROM (VALUES
             ('auth_user_id', 1, 'pg_catalog.uuid'::regtype, -1, true,
              0::oid, NULL::text),
             ('personal_account_id', 2, 'pg_catalog.text'::regtype, -1, true,
              to_regcollation('pg_catalog.default'), NULL::text),
             ('status', 3, 'pg_catalog.text'::regtype, -1, true,
              to_regcollation('pg_catalog.default'), '''active''::text'),
             ('version', 4, 'pg_catalog.int8'::regtype, -1, true,
              0::oid, '1'),
             ('created_at', 5, 'pg_catalog.timestamptz'::regtype, -1, true,
              0::oid, 'now()'),
             ('updated_at', 6, 'pg_catalog.timestamptz'::regtype, -1, true,
              0::oid, 'now()')
           ) AS expected(
             name, position, type_oid, type_modifier, not_null,
             collation_oid, default_expression
           )
          WHERE NOT EXISTS (
            SELECT 1
              FROM pg_catalog.pg_attribute AS attribute
              JOIN pg_catalog.pg_type AS type_metadata
                ON type_metadata.oid = attribute.atttypid
              LEFT JOIN pg_catalog.pg_attrdef AS default_metadata
                ON default_metadata.adrelid = attribute.attrelid
               AND default_metadata.adnum = attribute.attnum
             WHERE attribute.attrelid = personal.oid
               AND attribute.attname = expected.name
               AND attribute.attnum = expected.position
               AND attribute.atttypid = expected.type_oid
               AND attribute.atttypmod = expected.type_modifier
               AND attribute.attnotnull = expected.not_null
               AND attribute.attidentity = ''
               AND attribute.attgenerated = ''
               AND attribute.attcollation = expected.collation_oid
               AND attribute.attcollation = type_metadata.typcollation
               AND NOT attribute.attisdropped
               AND (
                 (expected.default_expression IS NULL AND default_metadata.oid IS NULL)
                 OR lower(pg_catalog.pg_get_expr(
                      default_metadata.adbin, default_metadata.adrelid, true
                    )) = expected.default_expression
               )
          )
       )
       AND 2 = (
         SELECT count(*) FROM pg_catalog.pg_index AS index_metadata
          WHERE index_metadata.indrelid = personal.oid
       )
       AND NOT EXISTS (
         SELECT 1
           FROM (VALUES
             ('public.faolla_personal_accounts_auth_user_id_uidx', 'auth_user_id'),
             ('public.faolla_personal_accounts_personal_account_id_uidx', 'personal_account_id')
           ) AS expected(index_name, column_name)
          WHERE NOT EXISTS (
            SELECT 1
              FROM pg_catalog.pg_index AS index_metadata
              JOIN pg_catalog.pg_class AS index_relation
                ON index_relation.oid = index_metadata.indexrelid
              JOIN pg_catalog.pg_am AS index_method
                ON index_method.oid = index_relation.relam
             WHERE index_metadata.indexrelid = to_regclass(expected.index_name)
               AND index_metadata.indrelid = personal.oid
               AND index_metadata.indisunique
               AND NOT index_metadata.indisprimary
               AND NOT index_metadata.indisexclusion
               AND index_metadata.indimmediate
               AND index_metadata.indisvalid
               AND index_metadata.indisready
               AND index_metadata.indislive
               AND index_metadata.indpred IS NULL
               AND index_metadata.indexprs IS NULL
               AND index_metadata.indnkeyatts = 1
               AND index_metadata.indnatts = 1
               AND index_method.amname = 'btree'
               AND NOT EXISTS (
                 SELECT 1
                   FROM unnest(index_metadata.indclass::oid[]) WITH ORDINALITY
                        AS index_operator_class(operator_class_oid, ordinality)
                   JOIN unnest(index_metadata.indkey::smallint[]) WITH ORDINALITY
                        AS index_column(attnum, ordinality) USING (ordinality)
                   JOIN pg_catalog.pg_attribute AS attribute
                     ON attribute.attrelid = personal.oid
                    AND attribute.attnum = index_column.attnum
                   LEFT JOIN pg_catalog.pg_opclass AS operator_class
                     ON operator_class.oid = index_operator_class.operator_class_oid
                  WHERE operator_class.oid IS NULL
                     OR operator_class.opcmethod <> index_relation.relam
                     OR operator_class.opcintype <> attribute.atttypid
                     OR NOT operator_class.opcdefault
               )
               AND NOT EXISTS (
                 SELECT 1
                   FROM unnest(index_metadata.indcollation::oid[]) WITH ORDINALITY
                        AS index_collation(collation_oid, ordinality)
                   JOIN unnest(index_metadata.indkey::smallint[]) WITH ORDINALITY
                        AS index_column(attnum, ordinality) USING (ordinality)
                   JOIN pg_catalog.pg_attribute AS attribute
                     ON attribute.attrelid = personal.oid
                    AND attribute.attnum = index_column.attnum
                  WHERE index_collation.collation_oid IS DISTINCT FROM attribute.attcollation
               )
               AND NOT EXISTS (
                 SELECT 1 FROM unnest(index_metadata.indoption::smallint[])
                   AS index_option(option_bits)
                  WHERE index_option.option_bits <> 0
               )
               AND (
                 SELECT array_agg(attribute.attname::text ORDER BY index_column.ordinality)
                   FROM unnest(index_metadata.indkey::smallint[]) WITH ORDINALITY
                        AS index_column(attnum, ordinality)
                   JOIN pg_catalog.pg_attribute AS attribute
                     ON attribute.attrelid = personal.oid
                    AND attribute.attnum = index_column.attnum
               ) = ARRAY[expected.column_name]::text[]
          )
       )
       AND 4 = (
         SELECT count(*) FROM pg_catalog.pg_constraint AS constraint_metadata
          WHERE constraint_metadata.conrelid = personal.oid
       )
       AND NOT EXISTS (
         SELECT 1
           FROM (VALUES
             ('faolla_personal_accounts_personal_account_id_safe',
              ARRAY['personal_account_id']::text[],
              '6c6a7472c2d303e319253578fc2a745a'),
             ('faolla_personal_accounts_status_valid',
              ARRAY['status']::text[],
              '8b4bd9cb5a89caab86807b61eb21151c'),
             ('faolla_personal_accounts_version_valid',
              ARRAY['version']::text[],
              '33e5475c2422f3c8d2ae88010bcee42a'),
             ('faolla_personal_accounts_timestamps_valid',
              ARRAY['updated_at','created_at']::text[],
              'ba66117c8f4124ec62639bc9756ee764')
           ) AS expected(name, columns, expression_md5)
          WHERE NOT EXISTS (
            SELECT 1
              FROM pg_catalog.pg_constraint AS constraint_metadata
             WHERE constraint_metadata.conrelid = personal.oid
               AND constraint_metadata.conname = expected.name
               AND constraint_metadata.contype = 'c'
               AND constraint_metadata.convalidated
               AND NOT constraint_metadata.condeferrable
               AND NOT constraint_metadata.condeferred
               AND NOT constraint_metadata.connoinherit
               AND (
                 SELECT array_agg(attribute.attname::text ORDER BY key.ordinality)
                   FROM unnest(constraint_metadata.conkey) WITH ORDINALITY
                        AS key(attnum, ordinality)
                   JOIN pg_catalog.pg_attribute AS attribute
                     ON attribute.attrelid = personal.oid
                   AND attribute.attnum = key.attnum
               ) = expected.columns
               AND pg_catalog.md5(pg_catalog.pg_get_expr(
                     constraint_metadata.conbin,
                     constraint_metadata.conrelid,
                     false
                   )) = expected.expression_md5
          )
       )
       AND 1 = (
         SELECT count(*) FROM pg_catalog.pg_trigger AS trigger_metadata
          WHERE trigger_metadata.tgrelid = personal.oid
            AND NOT trigger_metadata.tgisinternal
       )
       AND EXISTS (
         SELECT 1 FROM pg_catalog.pg_trigger AS trigger_metadata
          WHERE trigger_metadata.tgrelid = personal.oid
            AND trigger_metadata.tgname = 'faolla_personal_accounts_binding_guard'
            AND trigger_metadata.tgfoid = to_regprocedure(
              'public.faolla_guard_personal_account_binding_v1()'
            )
            AND trigger_metadata.tgenabled = 'A'
            AND trigger_metadata.tgtype = 27
            AND trigger_metadata.tgnargs = 0
            AND trigger_metadata.tgattr = ''::int2vector
            AND trigger_metadata.tgqual IS NULL
            AND NOT trigger_metadata.tgisinternal
       )
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = personal.oid
       )
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_rewrite AS rule
          WHERE rule.ev_class = personal.oid
       )
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_inherits AS inheritance
          WHERE inheritance.inhrelid = personal.oid
             OR inheritance.inhparent = personal.oid
       )
       AND NOT EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(coalesce(
             personal.relacl, pg_catalog.acldefault('r', personal.relowner)
           )) AS acl
          WHERE acl.grantee <> personal.relowner
             OR acl.grantor <> personal.relowner
             OR acl.is_grantable
       )
       AND 7 = (
         SELECT count(*)
           FROM pg_catalog.aclexplode(coalesce(
             personal.relacl, pg_catalog.acldefault('r', personal.relowner)
           )) AS acl
       )
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = personal.oid
            AND attribute.attnum > 0 AND NOT attribute.attisdropped
            AND attribute.attacl IS NOT NULL
       )
      FROM pg_catalog.pg_class AS personal
     WHERE personal.oid = to_regclass('public.faolla_personal_accounts')
       AND personal.relnamespace = to_regnamespace('public')
  ), false) AS ready
), registry_acl_state AS MATERIALIZED (
  SELECT coalesce((
    SELECT registry.relowner = to_regrole('supabase_admin')
       AND registry.relkind = 'r'
       AND registry.relrowsecurity
       AND NOT registry.relforcerowsecurity
       AND NOT EXISTS (
         WITH actual AS (
           SELECT acl.grantee, acl.grantor, acl.privilege_type, acl.is_grantable
             FROM pg_catalog.aclexplode(coalesce(
               registry.relacl,
               pg_catalog.acldefault('r', registry.relowner)
             )) AS acl
         ), expected AS (
           SELECT acl.grantee, acl.grantor, acl.privilege_type, acl.is_grantable
             FROM pg_catalog.aclexplode(
               pg_catalog.acldefault('r', registry.relowner)
             ) AS acl
           UNION ALL
           SELECT to_regrole('service_role'), registry.relowner, 'SELECT'::text, false
         )
         (SELECT * FROM actual EXCEPT SELECT * FROM expected)
         UNION ALL
         (SELECT * FROM expected EXCEPT SELECT * FROM actual)
       )
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = registry.oid
            AND attribute.attnum > 0
            AND NOT attribute.attisdropped
            AND attribute.attacl IS NOT NULL
       )
      FROM registry
     WHERE registry.oid IS NOT NULL
  ), false) AS ready
), registry_structure_state AS MATERIALIZED (
  SELECT coalesce((
    SELECT registry.relkind = 'r'
       AND registry.relpersistence = 'p'
       AND registry.relnamespace = to_regnamespace('public')
       AND registry.relowner = to_regrole('supabase_admin')
       AND registry.relrowsecurity
       AND NOT registry.relforcerowsecurity
       AND NOT registry.relispartition
       AND registry.relreplident = 'd'
       AND 3 = (
         SELECT count(*) FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = registry.oid AND attribute.attnum > 0
       )
       AND NOT EXISTS (
         SELECT 1
           FROM (VALUES
             ('version', 1, 'pg_catalog.int8'::regtype, -1, true,
              0::oid, NULL::text),
             ('name', 2, 'pg_catalog.text'::regtype, -1, true,
              to_regcollation('pg_catalog.default'), NULL::text),
             ('applied_at', 3, 'pg_catalog.timestamptz'::regtype, -1, true,
              0::oid, 'now()')
           ) AS expected(
             name, position, type_oid, type_modifier, not_null,
             collation_oid, default_expression
           )
          WHERE NOT EXISTS (
            SELECT 1
              FROM pg_catalog.pg_attribute AS attribute
              JOIN pg_catalog.pg_type AS type_metadata
                ON type_metadata.oid = attribute.atttypid
              LEFT JOIN pg_catalog.pg_attrdef AS default_metadata
                ON default_metadata.adrelid = attribute.attrelid
               AND default_metadata.adnum = attribute.attnum
             WHERE attribute.attrelid = registry.oid
               AND attribute.attname = expected.name
               AND attribute.attnum = expected.position
               AND attribute.atttypid = expected.type_oid
               AND attribute.atttypmod = expected.type_modifier
               AND attribute.attnotnull = expected.not_null
               AND attribute.attidentity = ''
               AND attribute.attgenerated = ''
               AND attribute.attcollation = expected.collation_oid
               AND attribute.attcollation = type_metadata.typcollation
               AND NOT attribute.attisdropped
               AND (
                 (expected.default_expression IS NULL AND default_metadata.oid IS NULL)
                 OR lower(pg_catalog.pg_get_expr(
                      default_metadata.adbin, default_metadata.adrelid, true
                    )) = expected.default_expression
               )
          )
       )
       AND 1 = (
         SELECT count(*) FROM pg_catalog.pg_constraint AS constraint_metadata
          WHERE constraint_metadata.conrelid = registry.oid
       )
       AND EXISTS (
         SELECT 1
           FROM pg_catalog.pg_constraint AS constraint_metadata
           JOIN pg_catalog.pg_index AS index_metadata
             ON index_metadata.indexrelid = constraint_metadata.conindid
           JOIN pg_catalog.pg_class AS index_relation
             ON index_relation.oid = index_metadata.indexrelid
           JOIN pg_catalog.pg_am AS index_method
             ON index_method.oid = index_relation.relam
          WHERE constraint_metadata.conrelid = registry.oid
            AND constraint_metadata.conname = 'faolla_schema_migrations_pkey'
            AND constraint_metadata.contype = 'p'
            AND constraint_metadata.conkey = ARRAY[1]::smallint[]
            AND NOT constraint_metadata.condeferrable
            AND NOT constraint_metadata.condeferred
            AND constraint_metadata.convalidated
            AND index_metadata.indrelid = registry.oid
            AND index_relation.relname = 'faolla_schema_migrations_pkey'
            AND index_relation.relnamespace = to_regnamespace('public')
            AND index_metadata.indisunique
            AND index_metadata.indisprimary
            AND NOT index_metadata.indisexclusion
            AND index_metadata.indimmediate
            AND index_metadata.indisvalid
            AND index_metadata.indisready
            AND index_metadata.indislive
            AND index_metadata.indpred IS NULL
            AND index_metadata.indexprs IS NULL
            AND index_metadata.indnkeyatts = 1
            AND index_metadata.indnatts = 1
            AND index_method.amname = 'btree'
            AND NOT EXISTS (
              SELECT 1
                FROM unnest(index_metadata.indclass::oid[]) WITH ORDINALITY
                     AS index_operator_class(operator_class_oid, ordinality)
                JOIN unnest(index_metadata.indkey::smallint[]) WITH ORDINALITY
                     AS index_column(attnum, ordinality) USING (ordinality)
                JOIN pg_catalog.pg_attribute AS attribute
                  ON attribute.attrelid = registry.oid
                 AND attribute.attnum = index_column.attnum
                LEFT JOIN pg_catalog.pg_opclass AS operator_class
                  ON operator_class.oid = index_operator_class.operator_class_oid
               WHERE operator_class.oid IS NULL
                  OR operator_class.opcmethod <> index_relation.relam
                  OR operator_class.opcintype <> attribute.atttypid
                  OR NOT operator_class.opcdefault
            )
            AND NOT EXISTS (
              SELECT 1
                FROM unnest(index_metadata.indcollation::oid[]) WITH ORDINALITY
                     AS index_collation(collation_oid, ordinality)
                JOIN unnest(index_metadata.indkey::smallint[]) WITH ORDINALITY
                     AS index_column(attnum, ordinality) USING (ordinality)
                JOIN pg_catalog.pg_attribute AS attribute
                  ON attribute.attrelid = registry.oid
                 AND attribute.attnum = index_column.attnum
               WHERE index_collation.collation_oid IS DISTINCT FROM attribute.attcollation
            )
            AND NOT EXISTS (
              SELECT 1 FROM unnest(index_metadata.indoption::smallint[])
                AS index_option(option_bits)
               WHERE index_option.option_bits <> 0
            )
       )
       AND 1 = (
         SELECT count(*) FROM pg_catalog.pg_index AS index_metadata
          WHERE index_metadata.indrelid = registry.oid
       )
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_trigger AS trigger_metadata
          WHERE trigger_metadata.tgrelid = registry.oid
            AND NOT trigger_metadata.tgisinternal
       )
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = registry.oid
       )
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_rewrite AS rule
          WHERE rule.ev_class = registry.oid
       )
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_inherits AS inheritance
          WHERE inheritance.inhrelid = registry.oid
             OR inheritance.inhparent = registry.oid
       )
      FROM registry
     WHERE registry.oid IS NOT NULL
  ), false) AS ready
), forbidden_binder_state AS MATERIALIZED (
  SELECT 0 = (
    SELECT count(*) FROM pg_catalog.pg_proc AS function_metadata
     WHERE function_metadata.proname =
       'faolla_bind_ordinary_account_authorization_v1'
       AND function_metadata.pronamespace = to_regnamespace('public')
  ) AS ready
), relevant_creator AS MATERIALIZED (
  SELECT creator.oid, creator.rolname,
         pg_catalog.array_remove(ARRAY[
           CASE WHEN creator.oid = to_regrole(current_user)
             THEN 'current_user'::text END,
           CASE WHEN creator.oid = to_regrole(session_user)
             THEN 'session_user'::text END,
           CASE WHEN creator.oid = to_regrole('postgres')
             THEN 'postgres_role'::text END,
           CASE WHEN creator.oid = to_regrole('supabase_admin')
             THEN 'supabase_admin_role'::text END,
           CASE WHEN creator.oid = (SELECT relowner FROM registry)
             THEN 'migration_registry_owner'::text END,
           CASE WHEN pg_catalog.has_schema_privilege(
             creator.oid, to_regnamespace('public'), 'CREATE'
           ) THEN 'public_schema_create'::text END
         ], NULL::text) AS reasons
    FROM pg_catalog.pg_roles AS creator
   WHERE creator.rolname !~ '^pg_'
     AND (
       creator.oid IN (
         to_regrole(current_user), to_regrole(session_user),
         to_regrole('postgres'), to_regrole('supabase_admin'),
         (SELECT relowner FROM registry)
       )
       OR pg_catalog.has_schema_privilege(
         creator.oid, to_regnamespace('public'), 'CREATE'
       )
     )
), platform_function_default_acl_expected AS MATERIALIZED (
  SELECT
    expected.creator_name::text AS creator_name,
    expected.schema_name::text AS schema_name,
    expected.grantee_name::text AS grantee_name,
    expected.grantable
  FROM (VALUES
    ${PLATFORM_FUNCTION_DEFAULT_ACL_EXPECTED_VALUES_SQL}
  ) AS expected(creator_name, schema_name, grantee_name, grantable)
), creator_default_acl_fact AS MATERIALIZED (
  SELECT
    creator.oid AS creator_oid,
    creator.rolname AS creator_name,
    creator.reasons AS creator_reasons,
    default_acl.oid AS default_acl_oid,
    default_acl.defaclnamespace AS schema_oid,
    schema_metadata.nspname AS schema_name,
    CASE WHEN acl.ordinality IS NULL THEN NULL ELSE
      pg_catalog.row_number() OVER (
        PARTITION BY default_acl.oid
        ORDER BY
          acl.grantor, acl.grantee, acl.privilege_type COLLATE "C",
          acl.is_grantable, acl.ordinality
      )
    END AS acl_ordinality,
    acl.grantor AS grantor_oid,
    grantor.rolname AS grantor_name,
    acl.grantee AS grantee_oid,
    CASE WHEN acl.grantee = 0 THEN 'public' ELSE 'role' END AS grantee_kind,
    CASE WHEN acl.grantee = 0 THEN NULL ELSE grantee.rolname END
      AS grantee_name,
    acl.privilege_type,
    acl.is_grantable
  FROM relevant_creator AS creator
  LEFT JOIN pg_catalog.pg_default_acl AS default_acl
    ON default_acl.defaclrole = creator.oid
   AND default_acl.defaclobjtype = 'f'
  LEFT JOIN pg_catalog.pg_namespace AS schema_metadata
    ON schema_metadata.oid = default_acl.defaclnamespace
  LEFT JOIN LATERAL pg_catalog.aclexplode(default_acl.defaclacl)
    WITH ORDINALITY AS acl(
      grantor, grantee, privilege_type, is_grantable, ordinality
    ) ON true
  LEFT JOIN pg_catalog.pg_roles AS grantor
    ON grantor.oid = acl.grantor
  LEFT JOIN pg_catalog.pg_roles AS grantee
    ON grantee.oid = acl.grantee
), creator_default_acl_creator AS MATERIALIZED (
  SELECT
    fact.creator_oid,
    fact.creator_name,
    fact.creator_reasons
  FROM creator_default_acl_fact AS fact
  GROUP BY
    fact.creator_oid, fact.creator_name, fact.creator_reasons
), creator_default_acl_row AS MATERIALIZED (
  SELECT
    fact.creator_oid,
    fact.default_acl_oid,
    fact.schema_oid,
    fact.schema_name,
    count(fact.acl_ordinality)::integer AS acl_entry_count,
    count(*) FILTER (
      WHERE fact.grantee_oid = fact.creator_oid
        AND fact.grantor_oid = fact.creator_oid
        AND fact.privilege_type = 'EXECUTE'
        AND NOT fact.is_grantable
    )::integer AS owner_execute_count,
    coalesce(pg_catalog.bool_and(
      (fact.schema_oid = 0 OR fact.schema_name IS NOT NULL)
      AND (
        fact.acl_ordinality IS NULL
        OR (
          fact.grantor_oid IS NOT NULL
          AND fact.grantor_oid <> 0
          AND fact.grantor_name IS NOT NULL
          AND fact.grantee_oid IS NOT NULL
          AND (fact.grantee_oid = 0 OR fact.grantee_name IS NOT NULL)
        )
      )
    ), false) AS catalog_reference_ready,
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'ordinal', fact.acl_ordinality,
          'grantorOid', fact.grantor_oid::text,
          'grantorName', fact.grantor_name,
          'granteeKind', fact.grantee_kind,
          'granteeOid', fact.grantee_oid::text,
          'granteeName', fact.grantee_name,
          'privilegeType', fact.privilege_type,
          'grantable', fact.is_grantable
        ) ORDER BY fact.acl_ordinality
      ) FILTER (WHERE fact.acl_ordinality IS NOT NULL),
      '[]'::jsonb
    ) AS entries
  FROM creator_default_acl_fact AS fact
  WHERE fact.default_acl_oid IS NOT NULL
  GROUP BY
    fact.creator_oid, fact.default_acl_oid, fact.schema_oid, fact.schema_name
), creator_default_acl_semantic_state AS MATERIALIZED (
  SELECT
    default_acl_row.*,
    default_acl_row.acl_entry_count = 1
      AND default_acl_row.owner_execute_count = 1
      AS strict_owner_only_ready,
    EXISTS (
      SELECT 1
      FROM platform_function_default_acl_expected AS expected
      WHERE expected.creator_name = creator.creator_name
        AND expected.schema_name = default_acl_row.schema_name
    ) AS platform_contract_managed,
    EXISTS (
      SELECT 1
      FROM platform_function_default_acl_expected AS expected
      WHERE expected.creator_name = creator.creator_name
        AND expected.schema_name = default_acl_row.schema_name
    )
      AND default_acl_row.catalog_reference_ready
      AND default_acl_row.acl_entry_count = (
        SELECT count(*)
        FROM platform_function_default_acl_expected AS expected
        WHERE expected.creator_name = creator.creator_name
          AND expected.schema_name = default_acl_row.schema_name
      )
      AND NOT EXISTS (
        SELECT 1
        FROM creator_default_acl_fact AS fact
        WHERE fact.default_acl_oid = default_acl_row.default_acl_oid
          AND fact.acl_ordinality IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM platform_function_default_acl_expected AS expected
            WHERE expected.creator_name = creator.creator_name
              AND expected.schema_name = default_acl_row.schema_name
              AND fact.grantor_oid = fact.creator_oid
              AND fact.grantor_name = creator.creator_name
              AND fact.grantee_kind = 'role'
              AND fact.grantee_name = expected.grantee_name
              AND fact.privilege_type = 'EXECUTE'
              AND fact.is_grantable = expected.grantable
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM platform_function_default_acl_expected AS expected
        WHERE expected.creator_name = creator.creator_name
          AND expected.schema_name = default_acl_row.schema_name
          AND NOT EXISTS (
            SELECT 1
            FROM creator_default_acl_fact AS fact
            WHERE fact.default_acl_oid = default_acl_row.default_acl_oid
              AND fact.acl_ordinality IS NOT NULL
              AND fact.grantor_oid = fact.creator_oid
              AND fact.grantor_name = creator.creator_name
              AND fact.grantee_kind = 'role'
              AND fact.grantee_name = expected.grantee_name
              AND fact.privilege_type = 'EXECUTE'
              AND fact.is_grantable = expected.grantable
          )
      ) AS platform_contract_ready
  FROM creator_default_acl_row AS default_acl_row
  JOIN creator_default_acl_creator AS creator
    ON creator.creator_oid = default_acl_row.creator_oid
), creator_default_acl_violation AS MATERIALIZED (
  SELECT
    creator.creator_oid,
    NULL::oid AS default_acl_oid,
    0 AS violation_rank,
    'global_function_default_acl_owner_execute_missing'::text AS code
  FROM creator_default_acl_creator AS creator
  WHERE NOT EXISTS (
    SELECT 1
    FROM creator_default_acl_row AS default_acl_row
    WHERE default_acl_row.creator_oid = creator.creator_oid
      AND default_acl_row.schema_oid = 0
      AND default_acl_row.acl_entry_count = 1
      AND default_acl_row.owner_execute_count = 1
  )
  UNION ALL
  SELECT
    semantic_state.creator_oid,
    semantic_state.default_acl_oid,
    1 AS violation_rank,
    'function_default_acl_platform_contract_invalid'::text AS code
  FROM creator_default_acl_semantic_state AS semantic_state
  WHERE semantic_state.platform_contract_managed
    AND NOT semantic_state.strict_owner_only_ready
    AND NOT semantic_state.platform_contract_ready
  UNION ALL
  SELECT
    semantic_state.creator_oid,
    semantic_state.default_acl_oid,
    2 AS violation_rank,
    'function_default_acl_entry_count_invalid'::text AS code
  FROM creator_default_acl_semantic_state AS semantic_state
  WHERE semantic_state.acl_entry_count <> 1
    AND NOT semantic_state.platform_contract_ready
  UNION ALL
  SELECT
    semantic_state.creator_oid,
    semantic_state.default_acl_oid,
    3 AS violation_rank,
    'function_default_acl_owner_execute_missing'::text AS code
  FROM creator_default_acl_semantic_state AS semantic_state
  WHERE semantic_state.owner_execute_count = 0
    AND NOT semantic_state.platform_contract_ready
  UNION ALL
  SELECT
    semantic_state.creator_oid,
    semantic_state.default_acl_oid,
    4 AS violation_rank,
    'function_default_acl_catalog_reference_unresolved'::text AS code
  FROM creator_default_acl_semantic_state AS semantic_state
  WHERE NOT semantic_state.catalog_reference_ready
), creator_default_acl_state AS MATERIALIZED (
  SELECT NOT EXISTS (
    SELECT 1 FROM creator_default_acl_violation
  ) AS ready
), creator_default_acl_diagnostic AS MATERIALIZED (
  SELECT pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'contract', 'runtime_rpc_function_default_acl_v1',
    'ready', (SELECT ready FROM creator_default_acl_state),
    'relevantCreatorCount',
      (SELECT count(*) FROM creator_default_acl_creator),
    'functionDefaultAclRowCount',
      (SELECT count(*) FROM creator_default_acl_row),
    'aclEntryCount', coalesce((
      SELECT sum(default_acl_row.acl_entry_count)
      FROM creator_default_acl_row AS default_acl_row
    ), 0),
    'violationCount', (SELECT count(*) FROM creator_default_acl_violation),
    'creators', coalesce((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'creatorOid', creator.creator_oid::text,
          'creatorName', creator.creator_name,
          'reasons', pg_catalog.to_jsonb(creator.creator_reasons),
          'globalOwnerExecuteReady', EXISTS (
            SELECT 1
            FROM creator_default_acl_row AS default_acl_row
            WHERE default_acl_row.creator_oid = creator.creator_oid
              AND default_acl_row.schema_oid = 0
              AND default_acl_row.acl_entry_count = 1
              AND default_acl_row.owner_execute_count = 1
          ),
          'functionDefaultAclRowCount', (
            SELECT count(*)
            FROM creator_default_acl_row AS default_acl_row
            WHERE default_acl_row.creator_oid = creator.creator_oid
          ),
          'aclEntryCount', coalesce((
            SELECT sum(default_acl_row.acl_entry_count)
            FROM creator_default_acl_row AS default_acl_row
            WHERE default_acl_row.creator_oid = creator.creator_oid
          ), 0),
          'violationCount', (
            SELECT count(*)
            FROM creator_default_acl_violation AS violation
            WHERE violation.creator_oid = creator.creator_oid
          )
        ) ORDER BY creator.creator_oid
      )
      FROM creator_default_acl_creator AS creator
    ), '[]'::jsonb),
    'rows', coalesce((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'defaultAclOid', default_acl_row.default_acl_oid::text,
          'creatorOid', default_acl_row.creator_oid::text,
          'schemaOid', default_acl_row.schema_oid::text,
          'schemaName', default_acl_row.schema_name,
          'objectType', 'FUNCTION',
          'aclEntryCount', default_acl_row.acl_entry_count,
          'entries', default_acl_row.entries
        ) ORDER BY
          default_acl_row.creator_oid, default_acl_row.default_acl_oid
      )
      FROM creator_default_acl_row AS default_acl_row
    ), '[]'::jsonb),
    'violations', coalesce((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'code', violation.code,
          'creatorOid', violation.creator_oid::text,
          'defaultAclOid', violation.default_acl_oid::text
        ) ORDER BY
          violation.creator_oid,
          coalesce(violation.default_acl_oid, 0::oid),
          violation.violation_rank
      )
      FROM creator_default_acl_violation AS violation
    ), '[]'::jsonb)
  ) AS value
), object_contract_state AS MATERIALIZED (
  SELECT
    (SELECT ready FROM observer_schema_state)
    AND (SELECT ready FROM merchant_contract_state)
    AND (SELECT ready FROM personal_contract_state)
    AND (SELECT ready FROM registry_structure_state)
    AND (SELECT ready FROM forbidden_binder_state)
    AND (SELECT ready FROM creator_default_acl_state)
    AS ready
), object_observer_relation_fact AS MATERIALIZED (
  SELECT
    expected.relation_name AS target,
    pg_catalog.array_position(
      ${OBJECT_CONTRACT_OBSERVER_RELATION_ORDER_SQL},
      expected.relation_name
    ) AS ordinal,
    relation.oid IS NOT NULL AS present,
    coalesce(relation.relkind = 'r', false) AS kind_ready,
    coalesce(relation.relpersistence = 'p', false) AS persistence_ready,
    coalesce(NOT relation.relispartition, false) AS partition_ready,
    NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_inherits AS inheritance
       WHERE inheritance.inhrelid = relation.oid
          OR inheritance.inhparent = relation.oid
    ) AS inheritance_ready
  FROM expected_observer_relation AS expected
  LEFT JOIN pg_catalog.pg_class AS relation
    ON relation.oid = to_regclass(expected.relation_name)
), object_observer_column_fact AS MATERIALIZED (
  SELECT
    expected.relation_name || '.' || expected.column_name AS target,
    pg_catalog.array_position(
      ${OBJECT_CONTRACT_OBSERVER_COLUMN_ORDER_SQL},
      expected.relation_name || '.' || expected.column_name
    ) AS ordinal,
    to_regclass(expected.relation_name) IS NOT NULL
    AND EXISTS (
      SELECT 1
        FROM pg_catalog.pg_attribute AS attribute
       WHERE attribute.attrelid = to_regclass(expected.relation_name)
         AND attribute.attname = expected.column_name
         AND attribute.attnum > 0
         AND attribute.atttypid = expected.type_oid
         AND attribute.atttypmod = expected.type_modifier
         AND attribute.attnotnull = expected.not_null
         AND attribute.attcollation = expected.collation_oid
         AND attribute.attidentity = ''
         AND attribute.attgenerated = ''
         AND NOT attribute.attisdropped
    ) AS ready
  FROM expected_observer_column AS expected
), object_merchant_relation_fact AS MATERIALIZED (
  SELECT
    merchant.oid AS relation_oid,
    merchant.oid IS NOT NULL AS relation_present,
    coalesce(merchant.relnamespace = to_regnamespace('public'), false)
      AS schema_ready,
    coalesce(merchant.relowner = to_regrole('supabase_admin'), false)
      AS owner_ready,
    merchant.relkind::text AS relation_kind,
    merchant.relpersistence::text AS persistence,
    merchant.relrowsecurity AS row_security,
    merchant.relforcerowsecurity AS force_row_security,
    merchant.relispartition AS partition,
    merchant.relreplident::text AS replica_identity
  FROM (SELECT to_regclass('public.merchants') AS oid) AS target
  LEFT JOIN pg_catalog.pg_class AS merchant ON merchant.oid = target.oid
), object_merchant_policy_fact AS MATERIALIZED (
  SELECT
    expected.policy_name AS target,
    pg_catalog.array_position(
      ${OBJECT_CONTRACT_MERCHANT_POLICY_ORDER_SQL}, expected.policy_name
    ) AS ordinal,
    policy_actual.policy_count,
    policy_actual.command,
    policy_actual.permissive,
    policy_actual.authenticated_only,
    policy_actual.qual_md5,
    policy_actual.check_md5,
    policy_actual.policy_count = 1
      AND policy_actual.command = expected.command
      AND policy_actual.permissive = expected.permissive
      AND policy_actual.authenticated_only
      AND policy_actual.qual_md5 IS NOT DISTINCT FROM expected.qual_md5
      AND policy_actual.check_md5 IS NOT DISTINCT FROM expected.check_md5
      AS ready
  FROM expected_merchant_policy AS expected
  CROSS JOIN object_merchant_relation_fact AS merchant
  CROSS JOIN LATERAL (
    SELECT
      count(policy.oid)::integer AS policy_count,
      min(policy.polcmd::text) AS command,
      CASE WHEN count(policy.oid) = 0 THEN NULL ELSE
        pg_catalog.bool_and(policy.polpermissive)
      END AS permissive,
      coalesce(pg_catalog.bool_and(
        policy.polroles = ARRAY[to_regrole('authenticated')]::oid[]
      ), false) AS authenticated_only,
      min(pg_catalog.md5(pg_catalog.pg_get_expr(
        policy.polqual, policy.polrelid, false
      ))) AS qual_md5,
      min(pg_catalog.md5(pg_catalog.pg_get_expr(
        policy.polwithcheck, policy.polrelid, false
      ))) AS check_md5
    FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid = merchant.relation_oid
      AND policy.polname = expected.policy_name
  ) AS policy_actual
), object_merchant_acl_actual AS MATERIALIZED (
  SELECT acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
  FROM object_merchant_relation_fact AS merchant
  CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(
    (SELECT relation.relacl FROM pg_catalog.pg_class AS relation
      WHERE relation.oid = merchant.relation_oid),
    pg_catalog.acldefault('r', (
      SELECT relation.relowner FROM pg_catalog.pg_class AS relation
       WHERE relation.oid = merchant.relation_oid
    ))
  )) AS acl
), object_merchant_acl_principal(ordinal, principal, principal_oid) AS (
  VALUES
    ${OBJECT_CONTRACT_ACL_PRINCIPAL_VALUES_SQL}
), object_merchant_acl_privilege(ordinal, privilege_type) AS (
  VALUES
    ${OBJECT_CONTRACT_TABLE_PRIVILEGE_VALUES_SQL}
), object_merchant_acl_matrix AS MATERIALIZED (
  SELECT
    principal.ordinal AS principal_ordinal,
    privilege.ordinal AS privilege_ordinal,
    principal.principal,
    privilege.privilege_type,
    count(actual.grantee)::integer AS entry_count,
    count(actual.grantee) FILTER (
      WHERE actual.grantor = merchant_owner.relowner
    )::integer AS owner_grantor_count,
    count(actual.grantee) FILTER (
      WHERE actual.is_grantable
    )::integer AS grantable_count
  FROM object_merchant_acl_principal AS principal
  CROSS JOIN object_merchant_acl_privilege AS privilege
  CROSS JOIN object_merchant_relation_fact AS merchant
  LEFT JOIN pg_catalog.pg_class AS merchant_owner
    ON merchant_owner.oid = merchant.relation_oid
  LEFT JOIN object_merchant_acl_actual AS actual
    ON actual.grantee = principal.principal_oid
   AND actual.privilege_type = privilege.privilege_type
  GROUP BY
    principal.ordinal, privilege.ordinal, principal.principal,
    privilege.privilege_type, merchant_owner.relowner
), object_personal_relation_fact AS MATERIALIZED (
  SELECT
    personal.oid AS relation_oid,
    personal.oid IS NOT NULL AS relation_present,
    coalesce(personal.relnamespace = to_regnamespace('public'), false)
      AS schema_ready,
    coalesce(personal.relowner = to_regrole('supabase_admin'), false)
      AS owner_ready,
    personal.relkind::text AS relation_kind,
    personal.relpersistence::text AS persistence,
    personal.relrowsecurity AS row_security,
    personal.relforcerowsecurity AS force_row_security,
    personal.relispartition AS partition,
    personal.relreplident::text AS replica_identity
  FROM (SELECT to_regclass('public.faolla_personal_accounts') AS oid) AS target
  LEFT JOIN pg_catalog.pg_class AS personal ON personal.oid = target.oid
), object_personal_column_fact AS MATERIALIZED (
  SELECT
    'public.faolla_personal_accounts.' || expected.name AS target,
    pg_catalog.array_position(
      ${OBJECT_CONTRACT_PERSONAL_COLUMN_ORDER_SQL},
      'public.faolla_personal_accounts.' || expected.name
    ) AS ordinal,
    EXISTS (
      SELECT 1
        FROM pg_catalog.pg_attribute AS attribute
        JOIN pg_catalog.pg_type AS type_metadata
          ON type_metadata.oid = attribute.atttypid
        LEFT JOIN pg_catalog.pg_attrdef AS default_metadata
          ON default_metadata.adrelid = attribute.attrelid
         AND default_metadata.adnum = attribute.attnum
       WHERE attribute.attrelid = personal.relation_oid
         AND attribute.attname = expected.name
         AND attribute.attnum = expected.position
         AND attribute.atttypid = expected.type_oid
         AND attribute.atttypmod = expected.type_modifier
         AND attribute.attnotnull = expected.not_null
         AND attribute.attidentity = ''
         AND attribute.attgenerated = ''
         AND attribute.attcollation = expected.collation_oid
         AND attribute.attcollation = type_metadata.typcollation
         AND NOT attribute.attisdropped
         AND (
           (expected.default_expression IS NULL AND default_metadata.oid IS NULL)
           OR lower(pg_catalog.pg_get_expr(
                default_metadata.adbin, default_metadata.adrelid, true
              )) = expected.default_expression
         )
    ) AS ready
  FROM (VALUES
    ('auth_user_id', 1, 'pg_catalog.uuid'::regtype, -1, true,
     0::oid, NULL::text),
    ('personal_account_id', 2, 'pg_catalog.text'::regtype, -1, true,
     to_regcollation('pg_catalog.default'), NULL::text),
    ('status', 3, 'pg_catalog.text'::regtype, -1, true,
     to_regcollation('pg_catalog.default'), '''active''::text'),
    ('version', 4, 'pg_catalog.int8'::regtype, -1, true,
     0::oid, '1'),
    ('created_at', 5, 'pg_catalog.timestamptz'::regtype, -1, true,
     0::oid, 'now()'),
    ('updated_at', 6, 'pg_catalog.timestamptz'::regtype, -1, true,
     0::oid, 'now()')
  ) AS expected(
    name, position, type_oid, type_modifier, not_null,
    collation_oid, default_expression
  )
  CROSS JOIN object_personal_relation_fact AS personal
), object_personal_index_fact AS MATERIALIZED (
  SELECT
    expected.index_name AS target,
    pg_catalog.array_position(
      ${OBJECT_CONTRACT_PERSONAL_INDEX_ORDER_SQL}, expected.index_name
    ) AS ordinal,
    EXISTS (
      SELECT 1
        FROM pg_catalog.pg_index AS index_metadata
        JOIN pg_catalog.pg_class AS index_relation
          ON index_relation.oid = index_metadata.indexrelid
        JOIN pg_catalog.pg_am AS index_method
          ON index_method.oid = index_relation.relam
       WHERE index_metadata.indexrelid = to_regclass(expected.index_name)
         AND index_metadata.indrelid = personal.relation_oid
         AND index_metadata.indisunique
         AND NOT index_metadata.indisprimary
         AND NOT index_metadata.indisexclusion
         AND index_metadata.indimmediate
         AND index_metadata.indisvalid
         AND index_metadata.indisready
         AND index_metadata.indislive
         AND index_metadata.indpred IS NULL
         AND index_metadata.indexprs IS NULL
         AND index_metadata.indnkeyatts = 1
         AND index_metadata.indnatts = 1
         AND index_method.amname = 'btree'
         AND NOT EXISTS (
           SELECT 1
             FROM unnest(index_metadata.indclass::oid[]) WITH ORDINALITY
                  AS index_operator_class(operator_class_oid, ordinality)
             JOIN unnest(index_metadata.indkey::smallint[]) WITH ORDINALITY
                  AS index_column(attnum, ordinality) USING (ordinality)
             JOIN pg_catalog.pg_attribute AS attribute
               ON attribute.attrelid = personal.relation_oid
              AND attribute.attnum = index_column.attnum
             LEFT JOIN pg_catalog.pg_opclass AS operator_class
               ON operator_class.oid = index_operator_class.operator_class_oid
            WHERE operator_class.oid IS NULL
               OR operator_class.opcmethod <> index_relation.relam
               OR operator_class.opcintype <> attribute.atttypid
               OR NOT operator_class.opcdefault
         )
         AND NOT EXISTS (
           SELECT 1
             FROM unnest(index_metadata.indcollation::oid[]) WITH ORDINALITY
                  AS index_collation(collation_oid, ordinality)
             JOIN unnest(index_metadata.indkey::smallint[]) WITH ORDINALITY
                  AS index_column(attnum, ordinality) USING (ordinality)
             JOIN pg_catalog.pg_attribute AS attribute
               ON attribute.attrelid = personal.relation_oid
              AND attribute.attnum = index_column.attnum
            WHERE index_collation.collation_oid
              IS DISTINCT FROM attribute.attcollation
         )
         AND NOT EXISTS (
           SELECT 1 FROM unnest(index_metadata.indoption::smallint[])
             AS index_option(option_bits)
            WHERE index_option.option_bits <> 0
         )
         AND (
           SELECT array_agg(attribute.attname::text ORDER BY key.ordinality)
             FROM unnest(index_metadata.indkey::smallint[]) WITH ORDINALITY
                  AS key(attnum, ordinality)
             JOIN pg_catalog.pg_attribute AS attribute
               ON attribute.attrelid = personal.relation_oid
              AND attribute.attnum = key.attnum
         ) = ARRAY[expected.column_name]::text[]
    ) AS ready
  FROM (VALUES
    ('public.faolla_personal_accounts_auth_user_id_uidx', 'auth_user_id'),
    ('public.faolla_personal_accounts_personal_account_id_uidx',
     'personal_account_id')
  ) AS expected(index_name, column_name)
  CROSS JOIN object_personal_relation_fact AS personal
), object_personal_constraint_fact AS MATERIALIZED (
  SELECT
    expected.name AS target,
    pg_catalog.array_position(
      ${OBJECT_CONTRACT_PERSONAL_CONSTRAINT_ORDER_SQL}, expected.name
    ) AS ordinal,
    EXISTS (
      SELECT 1
        FROM pg_catalog.pg_constraint AS constraint_metadata
       WHERE constraint_metadata.conrelid = personal.relation_oid
         AND constraint_metadata.conname = expected.name
         AND constraint_metadata.contype = 'c'
         AND constraint_metadata.convalidated
         AND NOT constraint_metadata.condeferrable
         AND NOT constraint_metadata.condeferred
         AND NOT constraint_metadata.connoinherit
         AND (
           SELECT array_agg(attribute.attname::text ORDER BY key.ordinality)
             FROM unnest(constraint_metadata.conkey) WITH ORDINALITY
                  AS key(attnum, ordinality)
             JOIN pg_catalog.pg_attribute AS attribute
               ON attribute.attrelid = personal.relation_oid
              AND attribute.attnum = key.attnum
         ) = expected.columns
         AND pg_catalog.md5(pg_catalog.pg_get_expr(
               constraint_metadata.conbin,
               constraint_metadata.conrelid,
               false
             )) = expected.expression_md5
    ) AS ready
  FROM (VALUES
    ('faolla_personal_accounts_personal_account_id_safe',
     ARRAY['personal_account_id']::text[],
     '6c6a7472c2d303e319253578fc2a745a'),
    ('faolla_personal_accounts_status_valid', ARRAY['status']::text[],
     '8b4bd9cb5a89caab86807b61eb21151c'),
    ('faolla_personal_accounts_version_valid', ARRAY['version']::text[],
     '33e5475c2422f3c8d2ae88010bcee42a'),
    ('faolla_personal_accounts_timestamps_valid',
     ARRAY['updated_at','created_at']::text[],
     'ba66117c8f4124ec62639bc9756ee764')
  ) AS expected(name, columns, expression_md5)
  CROSS JOIN object_personal_relation_fact AS personal
), object_registry_relation_fact AS MATERIALIZED (
  SELECT
    registry.oid AS relation_oid,
    registry.oid IS NOT NULL AS relation_present,
    coalesce(registry.relnamespace = to_regnamespace('public'), false)
      AS schema_ready,
    coalesce(registry.relowner = to_regrole('supabase_admin'), false)
      AS owner_ready,
    registry.relkind::text AS relation_kind,
    registry.relpersistence::text AS persistence,
    registry.relrowsecurity AS row_security,
    registry.relforcerowsecurity AS force_row_security,
    registry.relispartition AS partition,
    registry.relreplident::text AS replica_identity
  FROM registry
), object_registry_column_fact AS MATERIALIZED (
  SELECT
    'public.faolla_schema_migrations.' || expected.name AS target,
    pg_catalog.array_position(
      ${OBJECT_CONTRACT_REGISTRY_COLUMN_ORDER_SQL},
      'public.faolla_schema_migrations.' || expected.name
    ) AS ordinal,
    EXISTS (
      SELECT 1
        FROM pg_catalog.pg_attribute AS attribute
        JOIN pg_catalog.pg_type AS type_metadata
          ON type_metadata.oid = attribute.atttypid
        LEFT JOIN pg_catalog.pg_attrdef AS default_metadata
          ON default_metadata.adrelid = attribute.attrelid
         AND default_metadata.adnum = attribute.attnum
       WHERE attribute.attrelid = registry_relation.relation_oid
         AND attribute.attname = expected.name
         AND attribute.attnum = expected.position
         AND attribute.atttypid = expected.type_oid
         AND attribute.atttypmod = expected.type_modifier
         AND attribute.attnotnull = expected.not_null
         AND attribute.attidentity = ''
         AND attribute.attgenerated = ''
         AND attribute.attcollation = expected.collation_oid
         AND attribute.attcollation = type_metadata.typcollation
         AND NOT attribute.attisdropped
         AND (
           (expected.default_expression IS NULL AND default_metadata.oid IS NULL)
           OR lower(pg_catalog.pg_get_expr(
                default_metadata.adbin, default_metadata.adrelid, true
              )) = expected.default_expression
         )
    ) AS ready
  FROM (VALUES
    ('version', 1, 'pg_catalog.int8'::regtype, -1, true,
     0::oid, NULL::text),
    ('name', 2, 'pg_catalog.text'::regtype, -1, true,
     to_regcollation('pg_catalog.default'), NULL::text),
    ('applied_at', 3, 'pg_catalog.timestamptz'::regtype, -1, true,
     0::oid, 'now()')
  ) AS expected(
    name, position, type_oid, type_modifier, not_null,
    collation_oid, default_expression
  )
  CROSS JOIN object_registry_relation_fact AS registry_relation
), object_registry_primary_key_fact AS MATERIALIZED (
  SELECT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_metadata
      JOIN pg_catalog.pg_index AS index_metadata
        ON index_metadata.indexrelid = constraint_metadata.conindid
      JOIN pg_catalog.pg_class AS index_relation
        ON index_relation.oid = index_metadata.indexrelid
      JOIN pg_catalog.pg_am AS index_method
        ON index_method.oid = index_relation.relam
     WHERE constraint_metadata.conrelid = registry_relation.relation_oid
       AND constraint_metadata.conname = 'faolla_schema_migrations_pkey'
       AND constraint_metadata.contype = 'p'
       AND constraint_metadata.conkey = ARRAY[1]::smallint[]
       AND NOT constraint_metadata.condeferrable
       AND NOT constraint_metadata.condeferred
       AND constraint_metadata.convalidated
       AND index_metadata.indrelid = registry_relation.relation_oid
       AND index_relation.relname = 'faolla_schema_migrations_pkey'
       AND index_relation.relnamespace = to_regnamespace('public')
       AND index_metadata.indisunique
       AND index_metadata.indisprimary
       AND NOT index_metadata.indisexclusion
       AND index_metadata.indimmediate
       AND index_metadata.indisvalid
       AND index_metadata.indisready
       AND index_metadata.indislive
       AND index_metadata.indpred IS NULL
       AND index_metadata.indexprs IS NULL
       AND index_metadata.indnkeyatts = 1
       AND index_metadata.indnatts = 1
       AND index_method.amname = 'btree'
       AND NOT EXISTS (
         SELECT 1
           FROM unnest(index_metadata.indclass::oid[]) WITH ORDINALITY
                AS index_operator_class(operator_class_oid, ordinality)
           JOIN unnest(index_metadata.indkey::smallint[]) WITH ORDINALITY
                AS index_column(attnum, ordinality) USING (ordinality)
           JOIN pg_catalog.pg_attribute AS attribute
             ON attribute.attrelid = registry_relation.relation_oid
            AND attribute.attnum = index_column.attnum
           LEFT JOIN pg_catalog.pg_opclass AS operator_class
             ON operator_class.oid = index_operator_class.operator_class_oid
          WHERE operator_class.oid IS NULL
             OR operator_class.opcmethod <> index_relation.relam
             OR operator_class.opcintype <> attribute.atttypid
             OR NOT operator_class.opcdefault
       )
       AND NOT EXISTS (
         SELECT 1
           FROM unnest(index_metadata.indcollation::oid[]) WITH ORDINALITY
                AS index_collation(collation_oid, ordinality)
           JOIN unnest(index_metadata.indkey::smallint[]) WITH ORDINALITY
                AS index_column(attnum, ordinality) USING (ordinality)
           JOIN pg_catalog.pg_attribute AS attribute
             ON attribute.attrelid = registry_relation.relation_oid
            AND attribute.attnum = index_column.attnum
          WHERE index_collation.collation_oid
            IS DISTINCT FROM attribute.attcollation
       )
       AND NOT EXISTS (
         SELECT 1 FROM unnest(index_metadata.indoption::smallint[])
           AS index_option(option_bits)
          WHERE index_option.option_bits <> 0
       )
  ) AS ready
  FROM object_registry_relation_fact AS registry_relation
), object_merchant_count_fact AS MATERIALIZED (
  SELECT
    (SELECT count(*)::integer FROM pg_catalog.pg_policy AS policy
      WHERE policy.polrelid = merchant.relation_oid) AS policy_count,
    (SELECT count(*)::integer FROM object_merchant_acl_actual)
      AS acl_entry_count,
    (SELECT count(*)::integer
       FROM object_merchant_acl_actual AS actual
      WHERE NOT EXISTS (
        SELECT 1 FROM object_merchant_acl_principal AS principal
         WHERE principal.principal_oid IS NOT DISTINCT FROM actual.grantee
      )) AS unknown_principal_entry_count,
    (SELECT count(*)::integer
       FROM object_merchant_acl_actual AS actual
      WHERE NOT EXISTS (
        SELECT 1 FROM object_merchant_acl_privilege AS privilege
         WHERE privilege.privilege_type = actual.privilege_type
      )) AS unknown_privilege_entry_count,
    (SELECT count(*)::integer FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = merchant.relation_oid
        AND attribute.attnum > 0 AND NOT attribute.attisdropped
        AND attribute.attacl IS NOT NULL) AS column_acl_count,
    (SELECT count(*)::integer FROM pg_catalog.pg_inherits AS inheritance
      WHERE inheritance.inhrelid = merchant.relation_oid
         OR inheritance.inhparent = merchant.relation_oid)
      AS inheritance_edge_count,
    (SELECT count(*)::integer FROM pg_catalog.pg_rewrite AS rule
      WHERE rule.ev_class = merchant.relation_oid) AS rewrite_count
  FROM object_merchant_relation_fact AS merchant
), object_personal_count_fact AS MATERIALIZED (
  SELECT
    (SELECT count(*)::integer FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = personal.relation_oid
        AND attribute.attnum > 0) AS column_count,
    (SELECT count(*)::integer FROM pg_catalog.pg_index AS index_metadata
      WHERE index_metadata.indrelid = personal.relation_oid) AS index_count,
    (SELECT count(*)::integer FROM pg_catalog.pg_constraint AS constraint_metadata
      WHERE constraint_metadata.conrelid = personal.relation_oid)
      AS constraint_count,
    (SELECT count(*)::integer FROM pg_catalog.pg_trigger AS trigger_metadata
      WHERE trigger_metadata.tgrelid = personal.relation_oid
        AND NOT trigger_metadata.tgisinternal) AS trigger_count,
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger AS trigger_metadata
       WHERE trigger_metadata.tgrelid = personal.relation_oid
         AND trigger_metadata.tgname = 'faolla_personal_accounts_binding_guard'
         AND trigger_metadata.tgfoid = to_regprocedure(
           'public.faolla_guard_personal_account_binding_v1()'
         )
         AND trigger_metadata.tgenabled = 'A'
         AND trigger_metadata.tgtype = 27
         AND trigger_metadata.tgnargs = 0
         AND trigger_metadata.tgattr = ''::int2vector
         AND trigger_metadata.tgqual IS NULL
         AND NOT trigger_metadata.tgisinternal
    ) AS binding_guard_ready,
    (SELECT count(*)::integer FROM pg_catalog.pg_policy AS policy
      WHERE policy.polrelid = personal.relation_oid) AS policy_count,
    (SELECT count(*)::integer FROM pg_catalog.pg_rewrite AS rule
      WHERE rule.ev_class = personal.relation_oid) AS rewrite_count,
    (SELECT count(*)::integer FROM pg_catalog.pg_inherits AS inheritance
      WHERE inheritance.inhrelid = personal.relation_oid
         OR inheritance.inhparent = personal.relation_oid)
      AS inheritance_edge_count,
    (SELECT count(*)::integer
       FROM pg_catalog.aclexplode(coalesce(
         (SELECT relation.relacl FROM pg_catalog.pg_class AS relation
           WHERE relation.oid = personal.relation_oid),
         pg_catalog.acldefault('r', (
           SELECT relation.relowner FROM pg_catalog.pg_class AS relation
            WHERE relation.oid = personal.relation_oid
         ))
       )) AS acl) AS acl_entry_count,
    (SELECT count(*)::integer
       FROM pg_catalog.aclexplode(coalesce(
         (SELECT relation.relacl FROM pg_catalog.pg_class AS relation
           WHERE relation.oid = personal.relation_oid),
         pg_catalog.acldefault('r', (
           SELECT relation.relowner FROM pg_catalog.pg_class AS relation
            WHERE relation.oid = personal.relation_oid
         ))
       )) AS acl
      WHERE acl.grantee <> (
              SELECT relation.relowner FROM pg_catalog.pg_class AS relation
               WHERE relation.oid = personal.relation_oid
            )
         OR acl.grantor <> (
              SELECT relation.relowner FROM pg_catalog.pg_class AS relation
               WHERE relation.oid = personal.relation_oid
            )
         OR acl.is_grantable) AS invalid_acl_entry_count,
    (SELECT count(*)::integer FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = personal.relation_oid
        AND attribute.attnum > 0 AND NOT attribute.attisdropped
        AND attribute.attacl IS NOT NULL) AS column_acl_count
  FROM object_personal_relation_fact AS personal
), object_registry_count_fact AS MATERIALIZED (
  SELECT
    (SELECT count(*)::integer FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = registry_relation.relation_oid
        AND attribute.attnum > 0) AS column_count,
    (SELECT count(*)::integer FROM pg_catalog.pg_constraint AS constraint_metadata
      WHERE constraint_metadata.conrelid = registry_relation.relation_oid)
      AS constraint_count,
    (SELECT count(*)::integer FROM pg_catalog.pg_index AS index_metadata
      WHERE index_metadata.indrelid = registry_relation.relation_oid)
      AS index_count,
    (SELECT count(*)::integer FROM pg_catalog.pg_trigger AS trigger_metadata
      WHERE trigger_metadata.tgrelid = registry_relation.relation_oid
        AND NOT trigger_metadata.tgisinternal) AS trigger_count,
    (SELECT count(*)::integer FROM pg_catalog.pg_policy AS policy
      WHERE policy.polrelid = registry_relation.relation_oid) AS policy_count,
    (SELECT count(*)::integer FROM pg_catalog.pg_rewrite AS rule
      WHERE rule.ev_class = registry_relation.relation_oid) AS rewrite_count,
    (SELECT count(*)::integer FROM pg_catalog.pg_inherits AS inheritance
      WHERE inheritance.inhrelid = registry_relation.relation_oid
         OR inheritance.inhparent = registry_relation.relation_oid)
      AS inheritance_edge_count
  FROM object_registry_relation_fact AS registry_relation
), object_binder_fact AS MATERIALIZED (
  SELECT count(*)::integer AS forbidden_function_count
  FROM pg_catalog.pg_proc AS function_metadata
  WHERE function_metadata.proname =
    'faolla_bind_ordinary_account_authorization_v1'
    AND function_metadata.pronamespace = to_regnamespace('public')
), object_contract_violation AS MATERIALIZED (
  SELECT 'observer_schema'::text AS component_code,
         relation.ordinal * 10 + violation.rank AS violation_rank,
         violation.code, relation.target
  FROM object_observer_relation_fact AS relation
  CROSS JOIN LATERAL (VALUES
    (1, 'observer_relation_missing'::text, relation.present),
    (2, 'observer_relation_kind_invalid'::text, relation.kind_ready),
    (3, 'observer_relation_persistence_invalid'::text,
     relation.persistence_ready),
    (4, 'observer_relation_partitioned'::text, relation.partition_ready),
    (5, 'observer_relation_inheritance_present'::text,
     relation.inheritance_ready)
  ) AS violation(rank, code, ready)
  WHERE NOT violation.ready
  UNION ALL
  SELECT 'observer_schema', 1000 + column_fact.ordinal,
         'observer_column_invalid', column_fact.target
  FROM object_observer_column_fact AS column_fact
  WHERE NOT column_fact.ready
  UNION ALL
  SELECT 'merchant_contract', violation.rank, violation.code,
         'public.merchants'
  FROM object_merchant_relation_fact AS merchant
  CROSS JOIN LATERAL (VALUES
    (1, 'merchant_relation_missing'::text, merchant.relation_present),
    (2, 'merchant_schema_invalid'::text, merchant.schema_ready),
    (3, 'merchant_owner_invalid'::text, merchant.owner_ready),
    (4, 'merchant_relation_kind_invalid'::text,
     merchant.relation_kind = 'r'),
    (5, 'merchant_relation_persistence_invalid'::text,
     merchant.persistence = 'p'),
    (6, 'merchant_row_security_disabled'::text,
     merchant.row_security IS TRUE),
    (7, 'merchant_force_row_security_enabled'::text,
     merchant.force_row_security IS FALSE),
    (8, 'merchant_relation_partitioned'::text,
     merchant.partition IS FALSE),
    (9, 'merchant_replica_identity_invalid'::text,
     merchant.replica_identity = 'd')
  ) AS violation(rank, code, ready)
  WHERE violation.ready IS DISTINCT FROM true
  UNION ALL
  SELECT 'merchant_contract', 20,
         'merchant_policy_count_invalid', 'public.merchants'
  FROM object_merchant_count_fact AS count_fact
  WHERE count_fact.policy_count <> 5
  UNION ALL
  SELECT 'merchant_contract', 30 + policy.ordinal,
         'merchant_policy_invalid', policy.target
  FROM object_merchant_policy_fact AS policy
  WHERE NOT policy.ready
  UNION ALL
  SELECT 'merchant_contract', violation.rank, violation.code,
         'public.merchants'
  FROM object_merchant_count_fact AS count_fact
  CROSS JOIN LATERAL (VALUES
    (40, 'merchant_acl_entry_count_invalid'::text,
     count_fact.acl_entry_count = 21),
    (41, 'merchant_acl_unknown_principal'::text,
     count_fact.unknown_principal_entry_count = 0),
    (42, 'merchant_acl_unknown_privilege'::text,
     count_fact.unknown_privilege_entry_count = 0),
    (43, 'merchant_column_acl_present'::text,
     count_fact.column_acl_count = 0),
    (44, 'merchant_inheritance_present'::text,
     count_fact.inheritance_edge_count = 0),
    (45, 'merchant_rewrite_present'::text,
     count_fact.rewrite_count = 0)
  ) AS violation(rank, code, ready)
  WHERE NOT violation.ready
  UNION ALL
  SELECT 'merchant_contract',
         100 + matrix.principal_ordinal * 10 + matrix.privilege_ordinal,
         'merchant_acl_matrix_invalid',
         matrix.principal || ':' || matrix.privilege_type
  FROM object_merchant_acl_matrix AS matrix
  WHERE matrix.entry_count <> CASE
         WHEN matrix.principal = 'supabase_admin' THEN 1
         WHEN matrix.principal = 'postgres' THEN 1
          WHEN matrix.principal = 'authenticated'
           AND matrix.privilege_type IN ('SELECT', 'INSERT', 'UPDATE') THEN 1
          WHEN matrix.principal = 'service_role'
           AND matrix.privilege_type IN (
             'SELECT', 'INSERT', 'UPDATE', 'DELETE'
           ) THEN 1
          ELSE 0
        END
     OR matrix.owner_grantor_count <> CASE
         WHEN matrix.principal = 'supabase_admin' THEN 1
         WHEN matrix.principal = 'postgres' THEN 1
          WHEN matrix.principal = 'authenticated'
           AND matrix.privilege_type IN ('SELECT', 'INSERT', 'UPDATE') THEN 1
          WHEN matrix.principal = 'service_role'
           AND matrix.privilege_type IN (
             'SELECT', 'INSERT', 'UPDATE', 'DELETE'
           ) THEN 1
          ELSE 0
        END
     OR matrix.grantable_count <> 0
  UNION ALL
  SELECT 'personal_contract', violation.rank, violation.code,
         'public.faolla_personal_accounts'
  FROM object_personal_relation_fact AS personal
  CROSS JOIN LATERAL (VALUES
    (1, 'personal_relation_missing'::text, personal.relation_present),
    (2, 'personal_schema_invalid'::text, personal.schema_ready),
    (3, 'personal_owner_invalid'::text, personal.owner_ready),
    (4, 'personal_relation_kind_invalid'::text,
     personal.relation_kind = 'r'),
    (5, 'personal_relation_persistence_invalid'::text,
     personal.persistence = 'p'),
    (6, 'personal_row_security_disabled'::text,
     personal.row_security IS TRUE),
    (7, 'personal_force_row_security_enabled'::text,
     personal.force_row_security IS FALSE),
    (8, 'personal_relation_partitioned'::text,
     personal.partition IS FALSE),
    (9, 'personal_replica_identity_invalid'::text,
     personal.replica_identity = 'd')
  ) AS violation(rank, code, ready)
  WHERE violation.ready IS DISTINCT FROM true
  UNION ALL
  SELECT 'personal_contract', violation.rank, violation.code,
         'public.faolla_personal_accounts'
  FROM object_personal_count_fact AS count_fact
  CROSS JOIN LATERAL (VALUES
    (20, 'personal_column_count_invalid'::text,
     count_fact.column_count = 6),
    (30, 'personal_index_count_invalid'::text,
     count_fact.index_count = 2),
    (40, 'personal_constraint_count_invalid'::text,
     count_fact.constraint_count = 4),
    (50, 'personal_trigger_count_invalid'::text,
     count_fact.trigger_count = 1),
    (51, 'personal_binding_guard_invalid'::text,
     count_fact.binding_guard_ready),
    (60, 'personal_policy_present'::text,
     count_fact.policy_count = 0),
    (61, 'personal_rewrite_present'::text,
     count_fact.rewrite_count = 0),
    (62, 'personal_inheritance_present'::text,
     count_fact.inheritance_edge_count = 0),
    (70, 'personal_acl_entry_count_invalid'::text,
     count_fact.acl_entry_count = 7),
    (71, 'personal_acl_entry_invalid'::text,
     count_fact.invalid_acl_entry_count = 0),
    (72, 'personal_column_acl_present'::text,
     count_fact.column_acl_count = 0)
  ) AS violation(rank, code, ready)
  WHERE NOT violation.ready
  UNION ALL
  SELECT 'personal_contract', 100 + column_fact.ordinal,
         'personal_column_invalid', column_fact.target
  FROM object_personal_column_fact AS column_fact
  WHERE NOT column_fact.ready
  UNION ALL
  SELECT 'personal_contract', 200 + index_fact.ordinal,
         'personal_index_invalid', index_fact.target
  FROM object_personal_index_fact AS index_fact
  WHERE NOT index_fact.ready
  UNION ALL
  SELECT 'personal_contract', 300 + constraint_fact.ordinal,
         'personal_constraint_invalid', constraint_fact.target
  FROM object_personal_constraint_fact AS constraint_fact
  WHERE NOT constraint_fact.ready
  UNION ALL
  SELECT 'registry_structure', violation.rank, violation.code,
         'public.faolla_schema_migrations'
  FROM object_registry_relation_fact AS registry_relation
  CROSS JOIN LATERAL (VALUES
    (1, 'registry_relation_missing'::text,
     registry_relation.relation_present),
    (2, 'registry_schema_invalid'::text, registry_relation.schema_ready),
    (3, 'registry_owner_invalid'::text, registry_relation.owner_ready),
    (4, 'registry_relation_kind_invalid'::text,
     registry_relation.relation_kind = 'r'),
    (5, 'registry_relation_persistence_invalid'::text,
     registry_relation.persistence = 'p'),
    (6, 'registry_row_security_disabled'::text,
     registry_relation.row_security IS TRUE),
    (7, 'registry_force_row_security_enabled'::text,
     registry_relation.force_row_security IS FALSE),
    (8, 'registry_relation_partitioned'::text,
     registry_relation.partition IS FALSE),
    (9, 'registry_replica_identity_invalid'::text,
     registry_relation.replica_identity = 'd')
  ) AS violation(rank, code, ready)
  WHERE violation.ready IS DISTINCT FROM true
  UNION ALL
  SELECT 'registry_structure', violation.rank, violation.code,
         'public.faolla_schema_migrations'
  FROM object_registry_count_fact AS count_fact
  CROSS JOIN object_registry_primary_key_fact AS primary_key
  CROSS JOIN LATERAL (VALUES
    (20, 'registry_column_count_invalid'::text,
     count_fact.column_count = 3),
    (30, 'registry_constraint_count_invalid'::text,
     count_fact.constraint_count = 1),
    (31, 'registry_primary_key_invalid'::text, primary_key.ready),
    (40, 'registry_index_count_invalid'::text,
     count_fact.index_count = 1),
    (50, 'registry_trigger_present'::text,
     count_fact.trigger_count = 0),
    (51, 'registry_policy_present'::text,
     count_fact.policy_count = 0),
    (52, 'registry_rewrite_present'::text,
     count_fact.rewrite_count = 0),
    (53, 'registry_inheritance_present'::text,
     count_fact.inheritance_edge_count = 0)
  ) AS violation(rank, code, ready)
  WHERE NOT violation.ready
  UNION ALL
  SELECT 'registry_structure', 100 + column_fact.ordinal,
         'registry_column_invalid', column_fact.target
  FROM object_registry_column_fact AS column_fact
  WHERE NOT column_fact.ready
  UNION ALL
  SELECT 'forbidden_binder', 1,
         'forbidden_binder_function_present',
         'public.faolla_bind_ordinary_account_authorization_v1'
  FROM object_binder_fact AS binder
  WHERE binder.forbidden_function_count <> 0
  UNION ALL
  SELECT 'runtime_rpc_function_default_acl', 1,
         'runtime_rpc_function_default_acl_invalid', NULL::text
  FROM creator_default_acl_state AS default_acl
  WHERE NOT default_acl.ready
), object_contract_component AS MATERIALIZED (
  SELECT 1 AS component_ordinal, 'observer_schema'::text AS code,
         (SELECT ready FROM observer_schema_state) AS ready,
         pg_catalog.jsonb_build_object(
           'invalidRelationCount', (
             SELECT count(*) FROM object_observer_relation_fact AS fact
              WHERE NOT (
                fact.present AND fact.kind_ready AND fact.persistence_ready
                AND fact.partition_ready AND fact.inheritance_ready
              )
           ),
           'invalidColumnCount', (
             SELECT count(*) FROM object_observer_column_fact AS fact
              WHERE NOT fact.ready
           ),
           'relations', (
             SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'target', fact.target,
               'present', fact.present,
               'kindReady', fact.kind_ready,
               'persistenceReady', fact.persistence_ready,
               'partitionReady', fact.partition_ready,
               'inheritanceReady', fact.inheritance_ready
             ) ORDER BY fact.ordinal)
             FROM object_observer_relation_fact AS fact
           ),
           'columns', (
             SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'target', fact.target, 'ready', fact.ready
             ) ORDER BY fact.ordinal)
             FROM object_observer_column_fact AS fact
           )
         ) AS facts
  UNION ALL
  SELECT 2, 'merchant_contract',
         (SELECT ready FROM merchant_contract_state),
         pg_catalog.jsonb_build_object(
           'relationPresent', merchant.relation_present,
           'schemaReady', merchant.schema_ready,
           'ownerReady', merchant.owner_ready,
           'relationKind', merchant.relation_kind,
           'persistence', merchant.persistence,
           'rowSecurity', merchant.row_security,
           'forceRowSecurity', merchant.force_row_security,
           'partition', merchant.partition,
           'replicaIdentity', merchant.replica_identity,
           'policyCount', count_fact.policy_count,
           'policies', (
             SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'target', policy.target,
               'count', policy.policy_count,
               'command', policy.command,
               'permissive', policy.permissive,
               'authenticatedOnly', policy.authenticated_only,
               'qualMd5', policy.qual_md5,
               'checkMd5', policy.check_md5
             ) ORDER BY policy.ordinal)
             FROM object_merchant_policy_fact AS policy
           ),
           'aclEntryCount', count_fact.acl_entry_count,
           'unknownPrincipalEntryCount',
             count_fact.unknown_principal_entry_count,
           'unknownPrivilegeEntryCount',
             count_fact.unknown_privilege_entry_count,
           'aclEntries', (
             SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'principal', matrix.principal,
               'privilegeType', matrix.privilege_type,
               'entryCount', matrix.entry_count,
               'ownerGrantorCount', matrix.owner_grantor_count,
               'grantableCount', matrix.grantable_count
             ) ORDER BY matrix.principal_ordinal, matrix.privilege_ordinal)
             FROM object_merchant_acl_matrix AS matrix
           ),
           'columnAclCount', count_fact.column_acl_count,
           'inheritanceEdgeCount', count_fact.inheritance_edge_count,
           'rewriteCount', count_fact.rewrite_count
         )
  FROM object_merchant_relation_fact AS merchant
  CROSS JOIN object_merchant_count_fact AS count_fact
  UNION ALL
  SELECT 3, 'personal_contract',
         (SELECT ready FROM personal_contract_state),
         pg_catalog.jsonb_build_object(
           'relationPresent', personal.relation_present,
           'schemaReady', personal.schema_ready,
           'ownerReady', personal.owner_ready,
           'relationKind', personal.relation_kind,
           'persistence', personal.persistence,
           'rowSecurity', personal.row_security,
           'forceRowSecurity', personal.force_row_security,
           'partition', personal.partition,
           'replicaIdentity', personal.replica_identity,
           'columnCount', count_fact.column_count,
           'columns', (
             SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'target', fact.target, 'ready', fact.ready
             ) ORDER BY fact.ordinal)
             FROM object_personal_column_fact AS fact
           ),
           'indexCount', count_fact.index_count,
           'indexes', (
             SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'target', fact.target, 'ready', fact.ready
             ) ORDER BY fact.ordinal)
             FROM object_personal_index_fact AS fact
           ),
           'constraintCount', count_fact.constraint_count,
           'constraints', (
             SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'target', fact.target, 'ready', fact.ready
             ) ORDER BY fact.ordinal)
             FROM object_personal_constraint_fact AS fact
           ),
           'triggerCount', count_fact.trigger_count,
           'bindingGuardReady', count_fact.binding_guard_ready,
           'policyCount', count_fact.policy_count,
           'rewriteCount', count_fact.rewrite_count,
           'inheritanceEdgeCount', count_fact.inheritance_edge_count,
           'aclEntryCount', count_fact.acl_entry_count,
           'invalidAclEntryCount', count_fact.invalid_acl_entry_count,
           'columnAclCount', count_fact.column_acl_count
         )
  FROM object_personal_relation_fact AS personal
  CROSS JOIN object_personal_count_fact AS count_fact
  UNION ALL
  SELECT 4, 'registry_structure',
         (SELECT ready FROM registry_structure_state),
         pg_catalog.jsonb_build_object(
           'relationPresent', registry_relation.relation_present,
           'schemaReady', registry_relation.schema_ready,
           'ownerReady', registry_relation.owner_ready,
           'relationKind', registry_relation.relation_kind,
           'persistence', registry_relation.persistence,
           'rowSecurity', registry_relation.row_security,
           'forceRowSecurity', registry_relation.force_row_security,
           'partition', registry_relation.partition,
           'replicaIdentity', registry_relation.replica_identity,
           'columnCount', count_fact.column_count,
           'columns', (
             SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'target', fact.target, 'ready', fact.ready
             ) ORDER BY fact.ordinal)
             FROM object_registry_column_fact AS fact
           ),
           'constraintCount', count_fact.constraint_count,
           'primaryKeyReady', primary_key.ready,
           'indexCount', count_fact.index_count,
           'triggerCount', count_fact.trigger_count,
           'policyCount', count_fact.policy_count,
           'rewriteCount', count_fact.rewrite_count,
           'inheritanceEdgeCount', count_fact.inheritance_edge_count
         )
  FROM object_registry_relation_fact AS registry_relation
  CROSS JOIN object_registry_count_fact AS count_fact
  CROSS JOIN object_registry_primary_key_fact AS primary_key
  UNION ALL
  SELECT 5, 'forbidden_binder', (SELECT ready FROM forbidden_binder_state),
         pg_catalog.jsonb_build_object(
           'forbiddenFunctionCount', binder.forbidden_function_count
         )
  FROM object_binder_fact AS binder
  UNION ALL
  SELECT 6, 'runtime_rpc_function_default_acl',
         (SELECT ready FROM creator_default_acl_state),
         pg_catalog.jsonb_build_object(
           'contractReady', (SELECT ready FROM creator_default_acl_state)
         )
), object_contract_diagnostic AS MATERIALIZED (
  SELECT pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'contract', 'ordinary_account_object_contract_v1',
    'ready', (SELECT ready FROM object_contract_state),
    'componentCount', (SELECT count(*) FROM object_contract_component),
    'failedComponentCount', (
      SELECT count(*) FROM object_contract_component AS component
       WHERE NOT component.ready
    ),
    'violationCount', (SELECT count(*) FROM object_contract_violation),
    'components', (
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'code', component.code,
        'ready', component.ready,
        'violationCount', (
          SELECT count(*) FROM object_contract_violation AS violation
           WHERE violation.component_code = component.code
        ),
        'facts', component.facts,
        'violations', coalesce((
          SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'code', violation.code, 'target', violation.target
          ) ORDER BY violation.violation_rank)
          FROM object_contract_violation AS violation
          WHERE violation.component_code = component.code
        ), '[]'::jsonb)
      ) ORDER BY component.component_ordinal)
      FROM object_contract_component AS component
    )
  ) AS value
), ordinary_identity_content AS MATERIALIZED (
  SELECT ${ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_SCALAR_SQL} AS value
), readiness AS MATERIALIZED (
  SELECT public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()
    AS value
), expected_state AS MATERIALIZED (
  SELECT
    pg_catalog.current_database() = :'expected_database_name'::text
      AND (
        SELECT control.system_identifier::numeric
          FROM pg_catalog.pg_control_system() AS control
      ) = :'expected_database_system_identifier'::numeric
      AND NOT pg_catalog.pg_is_in_recovery()
      AS database_identity_ready,
    (readiness.value #>> '{merchant,recordCount}')::numeric =
      :'expected_merchant_record_count'::numeric
      AND (readiness.value #>> '{personal,canonicalBindingCount}')::numeric =
        :'expected_personal_canonical_count'::numeric
      AND (SELECT value FROM ordinary_identity_content) =
        :'expected_ordinary_identity_content_sha256'::text
      AS baseline_ready
    FROM readiness
)
SELECT (
pg_catalog.jsonb_build_object(
  'databaseActorReady', current_user = 'supabase_admin' AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles AS actor
     WHERE actor.rolname = current_user AND actor.rolsuper
  ),
  'databaseIdentity', pg_catalog.jsonb_build_object(
    'dbName', pg_catalog.current_database(),
    'dbOid', (
      SELECT database_metadata.oid::text
        FROM pg_catalog.pg_database AS database_metadata
       WHERE database_metadata.datname = pg_catalog.current_database()
    ),
    'systemId', (
      SELECT control.system_identifier::numeric::text
        FROM pg_catalog.pg_control_system() AS control
    ),
    'primary', NOT pg_catalog.pg_is_in_recovery()
  ),
  'databaseIdentityReady', (SELECT database_identity_ready FROM expected_state),
  'baselineReady', (SELECT baseline_ready FROM expected_state),
  'runtimeRpcHardeningReady', (SELECT ready FROM creator_default_acl_state),
  'migrationsReady', (SELECT ready FROM migration_state),
  'functionMetadataReady', (SELECT ready FROM function_metadata_state),
  'functionAclReady', (SELECT ready FROM function_acl_state),
  'registryAclReady', (SELECT ready FROM registry_acl_state),
  'objectContractsReady', (SELECT ready FROM object_contract_state),
  'readiness', pg_catalog.jsonb_build_object(
    'schemaVersion', (SELECT value -> 'schemaVersion' FROM readiness),
    'asOf', (SELECT value -> 'asOf' FROM readiness),
    'readyForCutover', (SELECT value -> 'readyForCutover' FROM readiness),
    'merchantRecordCount', (SELECT value #> '{merchant,recordCount}' FROM readiness),
    'merchantAuthoritativeBindingCount',
      (SELECT value #> '{merchant,authoritativeBindingCount}' FROM readiness),
    'merchantInvalidBindingCount',
      (SELECT value #> '{merchant,invalidBindingCount}' FROM readiness),
    'personalCanonicalBindingCount',
      (SELECT value #> '{personal,canonicalBindingCount}' FROM readiness),
    'personalCanonicalOrphanCount',
      (SELECT value #> '{personal,canonicalOrphanCount}' FROM readiness),
    'personalInvalidCanonicalCount',
      (SELECT value #> '{personal,invalidCanonicalCount}' FROM readiness),
    'personalDuplicateAuthUserCount',
      (SELECT value #> '{personal,duplicateAuthUserCount}' FROM readiness),
    'personalDuplicateAccountIdCount',
      (SELECT value #> '{personal,duplicatePersonalAccountIdCount}' FROM readiness),
    'crossAccountTypeOverlapCount',
      (SELECT value #> '{security,crossAccountTypeOverlapCount}' FROM readiness),
    'accountIdentifierCollisionCount',
      (SELECT value #> '{security,accountIdentifierCollisionCount}' FROM readiness),
    'staffRegistryOverlapCount',
      (SELECT value #> '{security,staffRegistryOverlapCount}' FROM readiness),
    'systemSitePrincipalOverlapCount',
      (SELECT value #> '{security,systemSitePrincipalOverlapCount}' FROM readiness),
    '${ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_KEY}',
      (SELECT value FROM ordinary_identity_content),
    'schemaReady', (SELECT value #> '{invariants,schemaReady}' FROM readiness),
    'aclReady', (SELECT value #> '{invariants,aclReady}' FROM readiness)
  )
)
|| CASE WHEN NOT (SELECT ready FROM creator_default_acl_state)
  THEN pg_catalog.jsonb_build_object(
    'defaultAclDiagnostic', (SELECT value FROM creator_default_acl_diagnostic)
  )
  ELSE '{}'::jsonb
END
|| CASE WHEN NOT (SELECT ready FROM object_contract_state)
  THEN pg_catalog.jsonb_build_object(
    'objectContractDiagnostic', (SELECT value FROM object_contract_diagnostic)
  )
  ELSE '{}'::jsonb
END
)::text;`;

export const ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL = [
  "BEGIN TRANSACTION READ ONLY;",
  "SET TRANSACTION ISOLATION LEVEL READ COMMITTED;",
  "SET LOCAL quote_all_identifiers = off;",
  "SET LOCAL search_path = pg_catalog, public;",
  "SET LOCAL lock_timeout = '15s';",
  "SET LOCAL statement_timeout = '120s';",
  "SELECT pg_catalog.pg_advisory_xact_lock(20260731, 1);",
  String.raw`LOCK TABLE
  auth.users,
  public.merchant_enterprise_employees,
  public.merchant_enterprise_staff_identities,
  public.faolla_personal_accounts,
  public.merchants
IN SHARE MODE;`,
  String.raw`LOCK TABLE
  pg_catalog.pg_database,
  pg_catalog.pg_authid,
  pg_catalog.pg_auth_members,
  pg_catalog.pg_namespace,
  pg_catalog.pg_language,
  pg_catalog.pg_type,
  pg_catalog.pg_collation,
  pg_catalog.pg_am,
  pg_catalog.pg_opclass,
  pg_catalog.pg_proc,
  pg_catalog.pg_default_acl,
  pg_catalog.pg_class,
  pg_catalog.pg_attribute,
  pg_catalog.pg_attrdef,
  pg_catalog.pg_index,
  pg_catalog.pg_constraint,
  pg_catalog.pg_trigger,
  pg_catalog.pg_policy,
  pg_catalog.pg_rewrite,
  pg_catalog.pg_inherits
IN SHARE ROW EXCLUSIVE MODE;`,
  RUNTIME_RPC_HARDENING_READ_ONLY_BLOCKS.catalog_quiescence_postlock,
  "LOCK TABLE public.faolla_schema_migrations IN SHARE ROW EXCLUSIVE MODE;",
  RUNTIME_RPC_HARDENING_READ_ONLY_BLOCKS.migrator_preflight,
  RUNTIME_RPC_HARDENING_READ_ONLY_BLOCKS.preflight,
  RUNTIME_RPC_HARDENING_READ_ONLY_BLOCKS.role_graph_postcondition,
  RUNTIME_RPC_HARDENING_READ_ONLY_BLOCKS.postcondition,
  RUNTIME_RPC_HARDENING_READ_ONLY_BLOCKS.definition_postcondition,
  RUNTIME_RPC_HARDENING_READ_ONLY_BLOCKS.registry_postcondition,
  ORDINARY_ACCOUNT_CUTOVER_AGGREGATE_SQL,
  "ROLLBACK;",
].join("\n\n");

const READINESS_BOOLEAN_KEYS = [
  "databaseActorReady",
  "databaseIdentityReady",
  "baselineReady",
  "runtimeRpcHardeningReady",
  "migrationsReady",
  "functionMetadataReady",
  "functionAclReady",
  "registryAclReady",
  "objectContractsReady",
];
const DATABASE_IDENTITY_REPORT_KEYS = [
  "dbName",
  "dbOid",
  "systemId",
  "primary",
];
const READINESS_COUNT_KEYS = [
  "merchantRecordCount",
  "merchantAuthoritativeBindingCount",
  "merchantInvalidBindingCount",
  "personalCanonicalBindingCount",
  "personalCanonicalOrphanCount",
  "personalInvalidCanonicalCount",
  "personalDuplicateAuthUserCount",
  "personalDuplicateAccountIdCount",
  "crossAccountTypeOverlapCount",
  "accountIdentifierCollisionCount",
  "staffRegistryOverlapCount",
  "systemSitePrincipalOverlapCount",
];
const DEFAULT_ACL_DIAGNOSTIC_KEYS = [
  "schemaVersion",
  "contract",
  "ready",
  "relevantCreatorCount",
  "functionDefaultAclRowCount",
  "aclEntryCount",
  "violationCount",
  "creators",
  "rows",
  "violations",
];
const DEFAULT_ACL_CREATOR_KEYS = [
  "creatorOid",
  "creatorName",
  "reasons",
  "globalOwnerExecuteReady",
  "functionDefaultAclRowCount",
  "aclEntryCount",
  "violationCount",
];
const DEFAULT_ACL_ROW_KEYS = [
  "defaultAclOid",
  "creatorOid",
  "schemaOid",
  "schemaName",
  "objectType",
  "aclEntryCount",
  "entries",
];
const DEFAULT_ACL_ENTRY_KEYS = [
  "ordinal",
  "grantorOid",
  "grantorName",
  "granteeKind",
  "granteeOid",
  "granteeName",
  "privilegeType",
  "grantable",
];
const DEFAULT_ACL_VIOLATION_KEYS = [
  "code",
  "creatorOid",
  "defaultAclOid",
];
const DEFAULT_ACL_REASONS = [
  "current_user",
  "session_user",
  "postgres_role",
  "supabase_admin_role",
  "migration_registry_owner",
  "public_schema_create",
];
const DEFAULT_ACL_GLOBAL_VIOLATION =
  "global_function_default_acl_owner_execute_missing";
const DEFAULT_ACL_ENTRY_COUNT_VIOLATION =
  "function_default_acl_entry_count_invalid";
const DEFAULT_ACL_OWNER_EXECUTE_VIOLATION =
  "function_default_acl_owner_execute_missing";
const DEFAULT_ACL_PLATFORM_CONTRACT_VIOLATION =
  "function_default_acl_platform_contract_invalid";
const DEFAULT_ACL_CATALOG_REFERENCE_VIOLATION =
  "function_default_acl_catalog_reference_unresolved";
const DEFAULT_ACL_DIAGNOSTIC_CONTRACT =
  "runtime_rpc_function_default_acl_v1";
const OBJECT_CONTRACT_DIAGNOSTIC_KEYS = [
  "schemaVersion",
  "contract",
  "ready",
  "componentCount",
  "failedComponentCount",
  "violationCount",
  "components",
];
const OBJECT_CONTRACT_COMPONENT_KEYS = [
  "code",
  "ready",
  "violationCount",
  "facts",
  "violations",
];
const OBJECT_CONTRACT_VIOLATION_KEYS = ["code", "target"];
const OBJECT_CONTRACT_COMPONENT_CODES = [
  "observer_schema",
  "merchant_contract",
  "personal_contract",
  "registry_structure",
  "forbidden_binder",
  "runtime_rpc_function_default_acl",
];
const OBJECT_CONTRACT_OBSERVER_FACT_KEYS = [
  "invalidRelationCount",
  "invalidColumnCount",
  "relations",
  "columns",
];
const OBJECT_CONTRACT_OBSERVER_RELATION_KEYS = [
  "target",
  "present",
  "kindReady",
  "persistenceReady",
  "partitionReady",
  "inheritanceReady",
];
const OBJECT_CONTRACT_TARGET_READY_KEYS = ["target", "ready"];
const OBJECT_CONTRACT_MERCHANT_FACT_KEYS = [
  "relationPresent",
  "schemaReady",
  "ownerReady",
  "relationKind",
  "persistence",
  "rowSecurity",
  "forceRowSecurity",
  "partition",
  "replicaIdentity",
  "policyCount",
  "policies",
  "aclEntryCount",
  "unknownPrincipalEntryCount",
  "unknownPrivilegeEntryCount",
  "aclEntries",
  "columnAclCount",
  "inheritanceEdgeCount",
  "rewriteCount",
];
const OBJECT_CONTRACT_MERCHANT_POLICY_KEYS = [
  "target",
  "count",
  "command",
  "permissive",
  "authenticatedOnly",
  "qualMd5",
  "checkMd5",
];
const OBJECT_CONTRACT_MERCHANT_ACL_KEYS = [
  "principal",
  "privilegeType",
  "entryCount",
  "ownerGrantorCount",
  "grantableCount",
];
const OBJECT_CONTRACT_PERSONAL_FACT_KEYS = [
  "relationPresent",
  "schemaReady",
  "ownerReady",
  "relationKind",
  "persistence",
  "rowSecurity",
  "forceRowSecurity",
  "partition",
  "replicaIdentity",
  "columnCount",
  "columns",
  "indexCount",
  "indexes",
  "constraintCount",
  "constraints",
  "triggerCount",
  "bindingGuardReady",
  "policyCount",
  "rewriteCount",
  "inheritanceEdgeCount",
  "aclEntryCount",
  "invalidAclEntryCount",
  "columnAclCount",
];
const OBJECT_CONTRACT_REGISTRY_FACT_KEYS = [
  "relationPresent",
  "schemaReady",
  "ownerReady",
  "relationKind",
  "persistence",
  "rowSecurity",
  "forceRowSecurity",
  "partition",
  "replicaIdentity",
  "columnCount",
  "columns",
  "constraintCount",
  "primaryKeyReady",
  "indexCount",
  "triggerCount",
  "policyCount",
  "rewriteCount",
  "inheritanceEdgeCount",
];
const OBJECT_CONTRACT_BINDER_FACT_KEYS = ["forbiddenFunctionCount"];
const OBJECT_CONTRACT_DEFAULT_ACL_FACT_KEYS = ["contractReady"];
const OBJECT_CONTRACT_DIAGNOSTIC_CONTRACT =
  "ordinary_account_object_contract_v1";
const LOWER_MD5_PATTERN = /^[0-9a-f]{32}$/;
function buildPlatformFunctionDefaultAclExpectedByCreator() {
  const byCreator = new Map();
  for (const [
    creatorName,
    schemaName,
    granteeName,
    grantable,
  ] of PLATFORM_FUNCTION_DEFAULT_ACL_EXPECTED) {
    const bySchema = byCreator.get(creatorName) ?? new Map();
    const byGrantee = bySchema.get(schemaName) ?? new Map();
    if (byGrantee.has(granteeName)) {
      throw new Error("ordinary_account_readiness_platform_acl_duplicate");
    }
    byGrantee.set(granteeName, grantable);
    bySchema.set(schemaName, byGrantee);
    byCreator.set(creatorName, bySchema);
  }
  return byCreator;
}

const PLATFORM_FUNCTION_DEFAULT_ACL_EXPECTED_BY_CREATOR =
  buildPlatformFunctionDefaultAclExpectedByCreator();
const ACL_PRIVILEGE_TYPES = new Set([
  "ALTER SYSTEM",
  "CONNECT",
  "CREATE",
  "DELETE",
  "EXECUTE",
  "INSERT",
  "MAINTAIN",
  "REFERENCES",
  "SELECT",
  "SET",
  "TEMPORARY",
  "TRIGGER",
  "TRUNCATE",
  "UPDATE",
  "USAGE",
]);
const MAX_OID = 4_294_967_295n;

export class OrdinaryAccountCutoverReadinessError extends Error {
  constructor(code) {
    super(code);
    this.name = "OrdinaryAccountCutoverReadinessError";
    this.code = code;
  }
}

function readinessError(code) {
  return new OrdinaryAccountCutoverReadinessError(code);
}

function trimText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function validateOrdinaryAccountCutoverExpectedEnvironment(
  environment = {},
) {
  const databaseName = trimText(environment.FAOLLA_EXPECTED_DATABASE_NAME);
  if (!DATABASE_NAME_PATTERN.test(databaseName)) {
    throw readinessError(
      "ordinary_account_readiness_expected_database_name_invalid",
    );
  }

  const databaseSystemIdentifier = trimText(
    environment.FAOLLA_EXPECTED_DATABASE_SYSTEM_IDENTIFIER,
  );
  if (
    !UNSIGNED_DECIMAL_PATTERN.test(databaseSystemIdentifier) ||
    BigInt(databaseSystemIdentifier) === 0n ||
    BigInt(databaseSystemIdentifier) > MAX_UINT64
  ) {
    throw readinessError(
      "ordinary_account_readiness_expected_database_system_identifier_invalid",
    );
  }

  const merchantRecordCount = trimText(
    environment.FAOLLA_EXPECTED_MERCHANT_RECORD_COUNT,
  );
  if (!POSITIVE_COUNT_PATTERN.test(merchantRecordCount)) {
    throw readinessError(
      "ordinary_account_readiness_expected_merchant_record_count_invalid",
    );
  }

  const personalCanonicalCount = trimText(
    environment.FAOLLA_EXPECTED_PERSONAL_CANONICAL_COUNT,
  );
  if (!NON_NEGATIVE_COUNT_PATTERN.test(personalCanonicalCount)) {
    throw readinessError(
      "ordinary_account_readiness_expected_personal_canonical_count_invalid",
    );
  }

  const ordinaryIdentityContentSha256 = trimText(
    environment.FAOLLA_EXPECTED_ORDINARY_IDENTITY_CONTENT_SHA256,
  );
  if (!isOrdinaryAccountIdentityContentSha256(ordinaryIdentityContentSha256)) {
    throw readinessError(
      "ordinary_account_readiness_expected_identity_content_sha256_invalid",
    );
  }

  return {
    FAOLLA_EXPECTED_DATABASE_NAME: databaseName,
    FAOLLA_EXPECTED_DATABASE_SYSTEM_IDENTIFIER: databaseSystemIdentifier,
    FAOLLA_EXPECTED_MERCHANT_RECORD_COUNT: merchantRecordCount,
    FAOLLA_EXPECTED_PERSONAL_CANONICAL_COUNT: personalCanonicalCount,
    FAOLLA_EXPECTED_ORDINARY_IDENTITY_CONTENT_SHA256:
      ordinaryIdentityContentSha256,
  };
}

function exactKeys(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isCanonicalOid(value, allowZero = false) {
  if (typeof value !== "string" || !UNSIGNED_DECIMAL_PATTERN.test(value)) {
    return false;
  }
  const oid = BigInt(value);
  return oid <= MAX_OID && (allowZero || oid > 0n);
}

function compareCanonicalOid(left, right) {
  const leftOid = BigInt(left);
  const rightOid = BigInt(right);
  return leftOid < rightOid ? -1 : leftOid > rightOid ? 1 : 0;
}

function isCatalogIdentifier(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= 63 &&
    !value.includes("\0")
  );
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isStableDefaultAclReasonList(reasons) {
  if (!Array.isArray(reasons) || reasons.length === 0) return false;
  let previousReasonIndex = -1;
  for (const reason of reasons) {
    const reasonIndex = DEFAULT_ACL_REASONS.indexOf(reason);
    if (reasonIndex <= previousReasonIndex) return false;
    previousReasonIndex = reasonIndex;
  }
  return true;
}

function isOwnerExecuteEntry(entry, creator) {
  return (
    entry.grantorOid === creator.creatorOid &&
    entry.grantorName === creator.creatorName &&
    entry.granteeKind === "role" &&
    entry.granteeOid === creator.creatorOid &&
    entry.granteeName === creator.creatorName &&
    entry.privilegeType === "EXECUTE" &&
    entry.grantable === false
  );
}

function expectedPlatformDefaultAclEntries(creatorName, schemaName) {
  return PLATFORM_FUNCTION_DEFAULT_ACL_EXPECTED_BY_CREATOR.get(
    creatorName,
  )?.get(schemaName);
}

function isExactPlatformDefaultAclRow(row, creator) {
  const expectedEntries = expectedPlatformDefaultAclEntries(
    creator.creatorName,
    row.schemaName,
  );
  if (!expectedEntries || row.entries.length !== expectedEntries.size) {
    return false;
  }

  const seenGrantees = new Set();
  for (const entry of row.entries) {
    if (
      entry.grantorOid !== creator.creatorOid ||
      entry.grantorName !== creator.creatorName ||
      entry.granteeKind !== "role" ||
      entry.granteeName === null ||
      !expectedEntries.has(entry.granteeName) ||
      entry.privilegeType !== "EXECUTE" ||
      entry.grantable !== expectedEntries.get(entry.granteeName) ||
      seenGrantees.has(entry.granteeName)
    ) {
      return false;
    }
    seenGrantees.add(entry.granteeName);
  }
  return seenGrantees.size === expectedEntries.size;
}

function compareDefaultAclEntries(left, right) {
  const grantorComparison = compareCanonicalOid(
    left.grantorOid,
    right.grantorOid,
  );
  if (grantorComparison !== 0) return grantorComparison;
  const granteeComparison = compareCanonicalOid(
    left.granteeOid,
    right.granteeOid,
  );
  if (granteeComparison !== 0) return granteeComparison;
  if (left.privilegeType !== right.privilegeType) {
    return left.privilegeType < right.privilegeType ? -1 : 1;
  }
  return Number(left.grantable) - Number(right.grantable);
}

function validateDefaultAclDiagnostic(diagnostic) {
  if (
    !exactKeys(diagnostic, DEFAULT_ACL_DIAGNOSTIC_KEYS) ||
    diagnostic.schemaVersion !== 1 ||
    diagnostic.contract !== DEFAULT_ACL_DIAGNOSTIC_CONTRACT ||
    typeof diagnostic.ready !== "boolean" ||
    !isNonNegativeSafeInteger(diagnostic.relevantCreatorCount) ||
    diagnostic.relevantCreatorCount === 0 ||
    !isNonNegativeSafeInteger(diagnostic.functionDefaultAclRowCount) ||
    !isNonNegativeSafeInteger(diagnostic.aclEntryCount) ||
    !isNonNegativeSafeInteger(diagnostic.violationCount) ||
    !Array.isArray(diagnostic.creators) ||
    !Array.isArray(diagnostic.rows) ||
    !Array.isArray(diagnostic.violations)
  ) {
    return false;
  }

  const creatorByOid = new Map();
  let previousCreatorOid;
  for (const creator of diagnostic.creators) {
    if (
      !exactKeys(creator, DEFAULT_ACL_CREATOR_KEYS) ||
      !isCanonicalOid(creator.creatorOid) ||
      !isCatalogIdentifier(creator.creatorName) ||
      !isStableDefaultAclReasonList(creator.reasons) ||
      typeof creator.globalOwnerExecuteReady !== "boolean" ||
      !isNonNegativeSafeInteger(creator.functionDefaultAclRowCount) ||
      !isNonNegativeSafeInteger(creator.aclEntryCount) ||
      !isNonNegativeSafeInteger(creator.violationCount) ||
      (previousCreatorOid !== undefined &&
        compareCanonicalOid(previousCreatorOid, creator.creatorOid) >= 0) ||
      creatorByOid.has(creator.creatorOid) ||
      (creator.reasons.includes("postgres_role") &&
        creator.creatorName !== "postgres") ||
      (creator.reasons.includes("supabase_admin_role") &&
        creator.creatorName !== "supabase_admin")
    ) {
      return false;
    }
    creatorByOid.set(creator.creatorOid, creator);
    previousCreatorOid = creator.creatorOid;
  }
  if (diagnostic.relevantCreatorCount !== diagnostic.creators.length) {
    return false;
  }

  const rowsByCreator = new Map(
    diagnostic.creators.map((creator) => [creator.creatorOid, []]),
  );
  const rowByOid = new Map();
  const creatorSchemaPairs = new Set();
  let previousRow;
  let recomputedAclEntryCount = 0;
  for (const row of diagnostic.rows) {
    if (
      !exactKeys(row, DEFAULT_ACL_ROW_KEYS) ||
      !isCanonicalOid(row.defaultAclOid) ||
      !isCanonicalOid(row.creatorOid) ||
      !isCanonicalOid(row.schemaOid, true) ||
      !creatorByOid.has(row.creatorOid) ||
      row.objectType !== "FUNCTION" ||
      !isNonNegativeSafeInteger(row.aclEntryCount) ||
      !Array.isArray(row.entries) ||
      row.aclEntryCount !== row.entries.length ||
      (row.schemaOid === "0"
        ? row.schemaName !== null
        : row.schemaName !== null &&
          !isCatalogIdentifier(row.schemaName)) ||
      rowByOid.has(row.defaultAclOid) ||
      creatorSchemaPairs.has(`${row.creatorOid}:${row.schemaOid}`) ||
      (previousRow !== undefined &&
        (compareCanonicalOid(previousRow.creatorOid, row.creatorOid) > 0 ||
          (previousRow.creatorOid === row.creatorOid &&
            compareCanonicalOid(
              previousRow.defaultAclOid,
              row.defaultAclOid,
            ) >= 0)))
    ) {
      return false;
    }

    let previousEntry;
    for (const [entryIndex, entry] of row.entries.entries()) {
      if (
        !exactKeys(entry, DEFAULT_ACL_ENTRY_KEYS) ||
        entry.ordinal !== entryIndex + 1 ||
        !isCanonicalOid(entry.grantorOid, true) ||
        (entry.grantorOid === "0"
          ? entry.grantorName !== null
          : entry.grantorName !== null &&
            !isCatalogIdentifier(entry.grantorName)) ||
        !["public", "role"].includes(entry.granteeKind) ||
        !isCanonicalOid(entry.granteeOid, true) ||
        (entry.granteeKind === "public"
          ? entry.granteeOid !== "0" || entry.granteeName !== null
          : !isCanonicalOid(entry.granteeOid) ||
            (entry.granteeName !== null &&
              !isCatalogIdentifier(entry.granteeName))) ||
        !ACL_PRIVILEGE_TYPES.has(entry.privilegeType) ||
        typeof entry.grantable !== "boolean" ||
        (previousEntry !== undefined &&
          compareDefaultAclEntries(previousEntry, entry) > 0)
      ) {
        return false;
      }
      previousEntry = entry;
    }

    rowsByCreator.get(row.creatorOid).push(row);
    rowByOid.set(row.defaultAclOid, row);
    creatorSchemaPairs.add(`${row.creatorOid}:${row.schemaOid}`);
    recomputedAclEntryCount += row.entries.length;
    previousRow = row;
  }
  if (
    diagnostic.functionDefaultAclRowCount !== diagnostic.rows.length ||
    diagnostic.aclEntryCount !== recomputedAclEntryCount
  ) {
    return false;
  }

  const expectedViolations = [];
  for (const creator of diagnostic.creators) {
    const creatorRows = rowsByCreator.get(creator.creatorOid);
    const globalOwnerExecuteReady = creatorRows.some(
      (row) =>
        row.schemaOid === "0" &&
        row.entries.length === 1 &&
        isOwnerExecuteEntry(row.entries[0], creator),
    );
    if (!globalOwnerExecuteReady) {
      expectedViolations.push({
        code: DEFAULT_ACL_GLOBAL_VIOLATION,
        creatorOid: creator.creatorOid,
        defaultAclOid: null,
      });
    }
    for (const row of creatorRows) {
      const strictOwnerOnlyReady =
        row.entries.length === 1 &&
        isOwnerExecuteEntry(row.entries[0], creator);
      const platformContractManaged =
        expectedPlatformDefaultAclEntries(
          creator.creatorName,
          row.schemaName,
        ) !== undefined;
      const platformContractReady = isExactPlatformDefaultAclRow(row, creator);
      if (
        platformContractManaged &&
        !strictOwnerOnlyReady &&
        !platformContractReady
      ) {
        expectedViolations.push({
          code: DEFAULT_ACL_PLATFORM_CONTRACT_VIOLATION,
          creatorOid: creator.creatorOid,
          defaultAclOid: row.defaultAclOid,
        });
      }
      if (row.entries.length !== 1 && !platformContractReady) {
        expectedViolations.push({
          code: DEFAULT_ACL_ENTRY_COUNT_VIOLATION,
          creatorOid: creator.creatorOid,
          defaultAclOid: row.defaultAclOid,
        });
      }
      if (
        !platformContractReady &&
        !row.entries.some((entry) =>
          isOwnerExecuteEntry(entry, creator),
        )
      ) {
        expectedViolations.push({
          code: DEFAULT_ACL_OWNER_EXECUTE_VIOLATION,
          creatorOid: creator.creatorOid,
          defaultAclOid: row.defaultAclOid,
        });
      }
      const catalogReferenceReady =
        (row.schemaOid === "0" || row.schemaName !== null) &&
        row.entries.every(
          (entry) =>
            entry.grantorOid !== "0" &&
            entry.grantorName !== null &&
            (entry.granteeKind === "public" ||
              entry.granteeName !== null),
        );
      if (!catalogReferenceReady) {
        expectedViolations.push({
          code: DEFAULT_ACL_CATALOG_REFERENCE_VIOLATION,
          creatorOid: creator.creatorOid,
          defaultAclOid: row.defaultAclOid,
        });
      }
    }

    const creatorViolationCount = expectedViolations.filter(
      (violation) => violation.creatorOid === creator.creatorOid,
    ).length;
    const creatorAclEntryCount = creatorRows.reduce(
      (sum, row) => sum + row.entries.length,
      0,
    );
    if (
      creator.globalOwnerExecuteReady !== globalOwnerExecuteReady ||
      creator.functionDefaultAclRowCount !== creatorRows.length ||
      creator.aclEntryCount !== creatorAclEntryCount ||
      creator.violationCount !== creatorViolationCount
    ) {
      return false;
    }
  }

  if (
    diagnostic.violationCount !== diagnostic.violations.length ||
    diagnostic.violationCount !== expectedViolations.length ||
    diagnostic.ready !== (expectedViolations.length === 0)
  ) {
    return false;
  }
  for (const [index, violation] of diagnostic.violations.entries()) {
    const expected = expectedViolations[index];
    if (
      !exactKeys(violation, DEFAULT_ACL_VIOLATION_KEYS) ||
      violation.code !== expected?.code ||
      violation.creatorOid !== expected?.creatorOid ||
      violation.defaultAclOid !== expected?.defaultAclOid ||
      !creatorByOid.has(violation.creatorOid) ||
      (violation.defaultAclOid !== null &&
        (!isCanonicalOid(violation.defaultAclOid) ||
          rowByOid.get(violation.defaultAclOid)?.creatorOid !==
            violation.creatorOid))
    ) {
      return false;
    }
  }
  return true;
}

function isNullableCatalogCode(value) {
  return value === null || (typeof value === "string" && /^[a-z]$/.test(value));
}

function isNullableBoolean(value) {
  return value === null || typeof value === "boolean";
}

function isNullableMd5(value) {
  return value === null ||
    (typeof value === "string" && LOWER_MD5_PATTERN.test(value));
}

function sameObjectContractViolations(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  return actual.every(
    (violation, index) =>
      exactKeys(violation, OBJECT_CONTRACT_VIOLATION_KEYS) &&
      violation.code === expected[index].code &&
      violation.target === expected[index].target,
  );
}

function validateFixedTargetReadyFacts(facts, targets) {
  if (!Array.isArray(facts) || facts.length !== targets.length) return false;
  return facts.every(
    (fact, index) =>
      exactKeys(fact, OBJECT_CONTRACT_TARGET_READY_KEYS) &&
      fact.target === targets[index] &&
      typeof fact.ready === "boolean",
  );
}

function relationMetadataViolations(prefix, facts, target) {
  const checks = [
    [facts.relationPresent, `${prefix}_relation_missing`],
    [facts.schemaReady, `${prefix}_schema_invalid`],
    [facts.ownerReady, `${prefix}_owner_invalid`],
    [facts.relationKind === "r", `${prefix}_relation_kind_invalid`],
    [facts.persistence === "p", `${prefix}_relation_persistence_invalid`],
    [facts.rowSecurity === true, `${prefix}_row_security_disabled`],
    [
      facts.forceRowSecurity === false,
      `${prefix}_force_row_security_enabled`,
    ],
    [facts.partition === false, `${prefix}_relation_partitioned`],
    [facts.replicaIdentity === "d", `${prefix}_replica_identity_invalid`],
  ];
  return checks
    .filter(([ready]) => !ready)
    .map(([, code]) => ({ code, target }));
}

function validateRelationMetadataFacts(facts) {
  return (
    typeof facts.relationPresent === "boolean" &&
    typeof facts.schemaReady === "boolean" &&
    typeof facts.ownerReady === "boolean" &&
    isNullableCatalogCode(facts.relationKind) &&
    isNullableCatalogCode(facts.persistence) &&
    isNullableBoolean(facts.rowSecurity) &&
    isNullableBoolean(facts.forceRowSecurity) &&
    isNullableBoolean(facts.partition) &&
    isNullableCatalogCode(facts.replicaIdentity)
  );
}

function validateObserverObjectContractFacts(facts) {
  if (
    !exactKeys(facts, OBJECT_CONTRACT_OBSERVER_FACT_KEYS) ||
    !isNonNegativeSafeInteger(facts.invalidRelationCount) ||
    !isNonNegativeSafeInteger(facts.invalidColumnCount) ||
    !Array.isArray(facts.relations) ||
    facts.relations.length !== OBJECT_CONTRACT_OBSERVER_RELATIONS.length ||
    !validateFixedTargetReadyFacts(
      facts.columns,
      OBJECT_CONTRACT_OBSERVER_COLUMNS,
    )
  ) {
    return null;
  }
  const violations = [];
  let invalidRelationCount = 0;
  for (const [index, relation] of facts.relations.entries()) {
    if (
      !exactKeys(relation, OBJECT_CONTRACT_OBSERVER_RELATION_KEYS) ||
      relation.target !== OBJECT_CONTRACT_OBSERVER_RELATIONS[index] ||
      [
        "present",
        "kindReady",
        "persistenceReady",
        "partitionReady",
        "inheritanceReady",
      ].some((key) => typeof relation[key] !== "boolean")
    ) {
      return null;
    }
    const checks = [
      [relation.present, "observer_relation_missing"],
      [relation.kindReady, "observer_relation_kind_invalid"],
      [relation.persistenceReady, "observer_relation_persistence_invalid"],
      [relation.partitionReady, "observer_relation_partitioned"],
      [relation.inheritanceReady, "observer_relation_inheritance_present"],
    ];
    if (checks.some(([ready]) => !ready)) invalidRelationCount += 1;
    for (const [ready, code] of checks) {
      if (!ready) violations.push({ code, target: relation.target });
    }
  }
  const invalidColumns = facts.columns.filter((column) => !column.ready);
  violations.push(
    ...invalidColumns.map((column) => ({
      code: "observer_column_invalid",
      target: column.target,
    })),
  );
  if (
    facts.invalidRelationCount !== invalidRelationCount ||
    facts.invalidColumnCount !== invalidColumns.length
  ) {
    return null;
  }
  return violations;
}

function validateMerchantObjectContractFacts(facts) {
  if (
    !exactKeys(facts, OBJECT_CONTRACT_MERCHANT_FACT_KEYS) ||
    !validateRelationMetadataFacts(facts) ||
    !isNonNegativeSafeInteger(facts.policyCount) ||
    !Array.isArray(facts.policies) ||
    facts.policies.length !== OBJECT_CONTRACT_MERCHANT_POLICIES.length ||
    !isNonNegativeSafeInteger(facts.aclEntryCount) ||
    !isNonNegativeSafeInteger(facts.unknownPrincipalEntryCount) ||
    !isNonNegativeSafeInteger(facts.unknownPrivilegeEntryCount) ||
    !Array.isArray(facts.aclEntries) ||
    facts.aclEntries.length !==
      OBJECT_CONTRACT_ACL_PRINCIPALS.length *
        OBJECT_CONTRACT_TABLE_PRIVILEGES.length ||
    !isNonNegativeSafeInteger(facts.columnAclCount) ||
    !isNonNegativeSafeInteger(facts.inheritanceEdgeCount) ||
    !isNonNegativeSafeInteger(facts.rewriteCount)
  ) {
    return null;
  }
  const target = "public.merchants";
  const violations = relationMetadataViolations("merchant", facts, target);
  if (facts.policyCount !== 5) {
    violations.push({ code: "merchant_policy_count_invalid", target });
  }
  for (const [index, policy] of facts.policies.entries()) {
    const [policyName, command, permissive, qualMd5, checkMd5] =
      OBJECT_CONTRACT_MERCHANT_POLICIES[index];
    if (
      !exactKeys(policy, OBJECT_CONTRACT_MERCHANT_POLICY_KEYS) ||
      policy.target !== policyName ||
      !isNonNegativeSafeInteger(policy.count) ||
      !(policy.command === null ||
        (typeof policy.command === "string" && /^[rawd*]$/.test(policy.command))) ||
      !isNullableBoolean(policy.permissive) ||
      typeof policy.authenticatedOnly !== "boolean" ||
      !isNullableMd5(policy.qualMd5) ||
      !isNullableMd5(policy.checkMd5)
    ) {
      return null;
    }
    if (
      policy.count !== 1 ||
      policy.command !== command ||
      policy.permissive !== permissive ||
      !policy.authenticatedOnly ||
      policy.qualMd5 !== qualMd5 ||
      policy.checkMd5 !== checkMd5
    ) {
      violations.push({ code: "merchant_policy_invalid", target: policyName });
    }
  }
  for (const [ready, code] of [
    [facts.aclEntryCount === 21, "merchant_acl_entry_count_invalid"],
    [
      facts.unknownPrincipalEntryCount === 0,
      "merchant_acl_unknown_principal",
    ],
    [
      facts.unknownPrivilegeEntryCount === 0,
      "merchant_acl_unknown_privilege",
    ],
    [facts.columnAclCount === 0, "merchant_column_acl_present"],
    [facts.inheritanceEdgeCount === 0, "merchant_inheritance_present"],
    [facts.rewriteCount === 0, "merchant_rewrite_present"],
  ]) {
    if (!ready) violations.push({ code, target });
  }
  let aclIndex = 0;
  for (const principal of OBJECT_CONTRACT_ACL_PRINCIPALS) {
    for (const privilegeType of OBJECT_CONTRACT_TABLE_PRIVILEGES) {
      const entry = facts.aclEntries[aclIndex];
      aclIndex += 1;
      if (
        !exactKeys(entry, OBJECT_CONTRACT_MERCHANT_ACL_KEYS) ||
        entry.principal !== principal ||
        entry.privilegeType !== privilegeType ||
        !isNonNegativeSafeInteger(entry.entryCount) ||
        !isNonNegativeSafeInteger(entry.ownerGrantorCount) ||
        !isNonNegativeSafeInteger(entry.grantableCount) ||
        entry.ownerGrantorCount > entry.entryCount ||
        entry.grantableCount > entry.entryCount
      ) {
        return null;
      }
      const expectedCount =
        principal === "supabase_admin" ||
        principal === "postgres" ||
        (principal === "authenticated" &&
          ["SELECT", "INSERT", "UPDATE"].includes(privilegeType)) ||
        (principal === "service_role" &&
          ["SELECT", "INSERT", "UPDATE", "DELETE"].includes(privilegeType))
          ? 1
          : 0;
      if (
        entry.entryCount !== expectedCount ||
        entry.ownerGrantorCount !== expectedCount ||
        entry.grantableCount !== 0
      ) {
        violations.push({
          code: "merchant_acl_matrix_invalid",
          target: `${principal}:${privilegeType}`,
        });
      }
    }
  }
  return violations;
}

function validatePersonalObjectContractFacts(facts) {
  if (
    !exactKeys(facts, OBJECT_CONTRACT_PERSONAL_FACT_KEYS) ||
    !validateRelationMetadataFacts(facts) ||
    !isNonNegativeSafeInteger(facts.columnCount) ||
    !validateFixedTargetReadyFacts(
      facts.columns,
      OBJECT_CONTRACT_PERSONAL_COLUMNS,
    ) ||
    !isNonNegativeSafeInteger(facts.indexCount) ||
    !validateFixedTargetReadyFacts(
      facts.indexes,
      OBJECT_CONTRACT_PERSONAL_INDEXES,
    ) ||
    !isNonNegativeSafeInteger(facts.constraintCount) ||
    !validateFixedTargetReadyFacts(
      facts.constraints,
      OBJECT_CONTRACT_PERSONAL_CONSTRAINTS,
    ) ||
    !isNonNegativeSafeInteger(facts.triggerCount) ||
    typeof facts.bindingGuardReady !== "boolean" ||
    ![
      "policyCount",
      "rewriteCount",
      "inheritanceEdgeCount",
      "aclEntryCount",
      "invalidAclEntryCount",
      "columnAclCount",
    ].every((key) => isNonNegativeSafeInteger(facts[key]))
  ) {
    return null;
  }
  const target = "public.faolla_personal_accounts";
  const violations = relationMetadataViolations("personal", facts, target);
  const aggregateChecks = [
    [facts.columnCount === 6, "personal_column_count_invalid"],
    [facts.indexCount === 2, "personal_index_count_invalid"],
    [facts.constraintCount === 4, "personal_constraint_count_invalid"],
    [facts.triggerCount === 1, "personal_trigger_count_invalid"],
    [facts.bindingGuardReady, "personal_binding_guard_invalid"],
    [facts.policyCount === 0, "personal_policy_present"],
    [facts.rewriteCount === 0, "personal_rewrite_present"],
    [facts.inheritanceEdgeCount === 0, "personal_inheritance_present"],
    [facts.aclEntryCount === 7, "personal_acl_entry_count_invalid"],
    [facts.invalidAclEntryCount === 0, "personal_acl_entry_invalid"],
    [facts.columnAclCount === 0, "personal_column_acl_present"],
  ];
  for (const [ready, code] of aggregateChecks) {
    if (!ready) violations.push({ code, target });
  }
  violations.push(
    ...facts.columns
      .filter((fact) => !fact.ready)
      .map((fact) => ({ code: "personal_column_invalid", target: fact.target })),
    ...facts.indexes
      .filter((fact) => !fact.ready)
      .map((fact) => ({ code: "personal_index_invalid", target: fact.target })),
    ...facts.constraints
      .filter((fact) => !fact.ready)
      .map((fact) => ({
        code: "personal_constraint_invalid",
        target: fact.target,
      })),
  );
  return violations;
}

function validateRegistryObjectContractFacts(facts) {
  if (
    !exactKeys(facts, OBJECT_CONTRACT_REGISTRY_FACT_KEYS) ||
    !validateRelationMetadataFacts(facts) ||
    !isNonNegativeSafeInteger(facts.columnCount) ||
    !validateFixedTargetReadyFacts(
      facts.columns,
      OBJECT_CONTRACT_REGISTRY_COLUMNS,
    ) ||
    ![
      "constraintCount",
      "indexCount",
      "triggerCount",
      "policyCount",
      "rewriteCount",
      "inheritanceEdgeCount",
    ].every((key) => isNonNegativeSafeInteger(facts[key])) ||
    typeof facts.primaryKeyReady !== "boolean"
  ) {
    return null;
  }
  const target = "public.faolla_schema_migrations";
  const violations = relationMetadataViolations("registry", facts, target);
  for (const [ready, code] of [
    [facts.columnCount === 3, "registry_column_count_invalid"],
    [facts.constraintCount === 1, "registry_constraint_count_invalid"],
    [facts.primaryKeyReady, "registry_primary_key_invalid"],
    [facts.indexCount === 1, "registry_index_count_invalid"],
    [facts.triggerCount === 0, "registry_trigger_present"],
    [facts.policyCount === 0, "registry_policy_present"],
    [facts.rewriteCount === 0, "registry_rewrite_present"],
    [facts.inheritanceEdgeCount === 0, "registry_inheritance_present"],
  ]) {
    if (!ready) violations.push({ code, target });
  }
  violations.push(
    ...facts.columns
      .filter((fact) => !fact.ready)
      .map((fact) => ({ code: "registry_column_invalid", target: fact.target })),
  );
  return violations;
}

function validateObjectContractDiagnostic(diagnostic) {
  if (
    !exactKeys(diagnostic, OBJECT_CONTRACT_DIAGNOSTIC_KEYS) ||
    diagnostic.schemaVersion !== 1 ||
    diagnostic.contract !== OBJECT_CONTRACT_DIAGNOSTIC_CONTRACT ||
    typeof diagnostic.ready !== "boolean" ||
    diagnostic.componentCount !== OBJECT_CONTRACT_COMPONENT_CODES.length ||
    !isNonNegativeSafeInteger(diagnostic.failedComponentCount) ||
    !isNonNegativeSafeInteger(diagnostic.violationCount) ||
    !Array.isArray(diagnostic.components) ||
    diagnostic.components.length !== OBJECT_CONTRACT_COMPONENT_CODES.length
  ) {
    return false;
  }

  let recomputedFailedComponentCount = 0;
  let recomputedViolationCount = 0;
  for (const [index, component] of diagnostic.components.entries()) {
    if (
      !exactKeys(component, OBJECT_CONTRACT_COMPONENT_KEYS) ||
      component.code !== OBJECT_CONTRACT_COMPONENT_CODES[index] ||
      typeof component.ready !== "boolean" ||
      !isNonNegativeSafeInteger(component.violationCount)
    ) {
      return false;
    }
    let expectedViolations;
    switch (component.code) {
      case "observer_schema":
        expectedViolations = validateObserverObjectContractFacts(
          component.facts,
        );
        break;
      case "merchant_contract":
        expectedViolations = validateMerchantObjectContractFacts(
          component.facts,
        );
        break;
      case "personal_contract":
        expectedViolations = validatePersonalObjectContractFacts(
          component.facts,
        );
        break;
      case "registry_structure":
        expectedViolations = validateRegistryObjectContractFacts(
          component.facts,
        );
        break;
      case "forbidden_binder": {
        const facts = component.facts;
        if (
          !exactKeys(facts, OBJECT_CONTRACT_BINDER_FACT_KEYS) ||
          !isNonNegativeSafeInteger(facts.forbiddenFunctionCount)
        ) {
          return false;
        }
        expectedViolations =
          facts.forbiddenFunctionCount === 0
            ? []
            : [
                {
                  code: "forbidden_binder_function_present",
                  target:
                    "public.faolla_bind_ordinary_account_authorization_v1",
                },
              ];
        break;
      }
      case "runtime_rpc_function_default_acl": {
        const facts = component.facts;
        if (
          !exactKeys(facts, OBJECT_CONTRACT_DEFAULT_ACL_FACT_KEYS) ||
          typeof facts.contractReady !== "boolean"
        ) {
          return false;
        }
        expectedViolations = facts.contractReady
          ? []
          : [
              {
                code: "runtime_rpc_function_default_acl_invalid",
                target: null,
              },
            ];
        break;
      }
      default:
        return false;
    }
    if (
      expectedViolations === null ||
      component.violationCount !== expectedViolations.length ||
      component.ready !== (expectedViolations.length === 0) ||
      !sameObjectContractViolations(
        component.violations,
        expectedViolations,
      )
    ) {
      return false;
    }
    if (!component.ready) recomputedFailedComponentCount += 1;
    recomputedViolationCount += expectedViolations.length;
  }
  return (
    diagnostic.failedComponentCount === recomputedFailedComponentCount &&
    diagnostic.violationCount === recomputedViolationCount &&
    diagnostic.ready === (recomputedFailedComponentCount === 0)
  );
}

export function parseOrdinaryAccountCutoverReadinessArguments(argv = []) {
  let json = false;
  let failOnBlocked = false;
  const seen = new Set();
  for (const entry of argv) {
    if (entry === "--json") {
      if (seen.has("json"))
        throw readinessError("ordinary_account_readiness_json_duplicate");
      seen.add("json");
      json = true;
      continue;
    }
    if (entry === "--fail-on-blocked") {
      if (seen.has("fail"))
        throw readinessError("ordinary_account_readiness_fail_duplicate");
      seen.add("fail");
      failOnBlocked = true;
      continue;
    }
    throw readinessError("ordinary_account_readiness_argument_unknown");
  }
  return { json, failOnBlocked };
}

function selectDatabaseContainer(topology, configuredName) {
  if (!topology?.available || !Array.isArray(topology.databaseCandidates)) {
    throw readinessError("ordinary_account_readiness_topology_unavailable");
  }
  const candidates = topology.databaseCandidates.filter(
    (candidate) =>
      candidate?.probeSucceeded === true &&
      candidate?.tools?.psql === true &&
      candidate?.tools?.databaseConfigured === true,
  );
  const requestedName = trimText(configuredName);
  let selected;
  if (requestedName) {
    if (!CONTAINER_NAME_PATTERN.test(requestedName)) {
      throw readinessError("ordinary_account_readiness_container_name_invalid");
    }
    selected = candidates.find((candidate) => candidate.name === requestedName);
  } else if (candidates.length === 1) {
    [selected] = candidates;
  }
  if (!selected || !CONTAINER_NAME_PATTERN.test(trimText(selected.name))) {
    throw readinessError(
      candidates.length > 1 && !requestedName
        ? "ordinary_account_readiness_container_ambiguous"
        : "ordinary_account_readiness_container_unavailable",
    );
  }
  return selected;
}

function dockerPsqlArguments(containerName, expectedEnvironment) {
  const environmentArguments = Object.entries(expectedEnvironment).flatMap(
    ([name, value]) => ["--env", `${name}=${value}`],
  );
  return [
    "exec",
    "-i",
    ...environmentArguments,
    containerName,
    "sh",
    "-lc",
    PSQL_CONTAINER_SCRIPT,
  ];
}

export function parseOrdinaryAccountCutoverDatabaseReport(stdout) {
  const output = String(stdout);
  if (Buffer.byteLength(output, "utf8") > DEFAULT_OUTPUT_LIMIT_BYTES) {
    throw readinessError("ordinary_account_readiness_output_invalid");
  }
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length !== 1)
    throw readinessError("ordinary_account_readiness_output_invalid");
  let parsed;
  try {
    parsed = JSON.parse(lines[0]);
  } catch {
    throw readinessError("ordinary_account_readiness_output_invalid");
  }
  const hasDefaultAclDiagnostic = Object.hasOwn(
    parsed ?? {},
    "defaultAclDiagnostic",
  );
  const hasObjectContractDiagnostic = Object.hasOwn(
    parsed ?? {},
    "objectContractDiagnostic",
  );
  if (
    !exactKeys(parsed, [
      ...READINESS_BOOLEAN_KEYS,
      "databaseIdentity",
      "readiness",
      ...(hasDefaultAclDiagnostic ? ["defaultAclDiagnostic"] : []),
      ...(hasObjectContractDiagnostic ? ["objectContractDiagnostic"] : []),
    ])
  ) {
    throw readinessError("ordinary_account_readiness_output_invalid");
  }
  if (READINESS_BOOLEAN_KEYS.some((key) => typeof parsed[key] !== "boolean")) {
    throw readinessError("ordinary_account_readiness_output_invalid");
  }
  if (
    hasDefaultAclDiagnostic === parsed.runtimeRpcHardeningReady ||
    hasObjectContractDiagnostic === parsed.objectContractsReady ||
    (!parsed.runtimeRpcHardeningReady && parsed.objectContractsReady) ||
    (hasDefaultAclDiagnostic &&
      (!validateDefaultAclDiagnostic(parsed.defaultAclDiagnostic) ||
        parsed.defaultAclDiagnostic.ready !==
          parsed.runtimeRpcHardeningReady)) ||
    (hasObjectContractDiagnostic &&
      (!validateObjectContractDiagnostic(parsed.objectContractDiagnostic) ||
        parsed.objectContractDiagnostic.ready !==
          parsed.objectContractsReady ||
        parsed.objectContractDiagnostic.components[5].ready !==
          parsed.runtimeRpcHardeningReady))
  ) {
    throw readinessError("ordinary_account_readiness_output_invalid");
  }
  const databaseIdentity = parsed.databaseIdentity;
  if (
    !exactKeys(databaseIdentity, DATABASE_IDENTITY_REPORT_KEYS) ||
    !DATABASE_NAME_PATTERN.test(databaseIdentity.dbName) ||
    !POSITIVE_COUNT_PATTERN.test(databaseIdentity.dbOid) ||
    BigInt(databaseIdentity.dbOid) > 4_294_967_295n ||
    !UNSIGNED_DECIMAL_PATTERN.test(databaseIdentity.systemId) ||
    BigInt(databaseIdentity.systemId) === 0n ||
    BigInt(databaseIdentity.systemId) > MAX_UINT64 ||
    typeof databaseIdentity.primary !== "boolean"
  ) {
    throw readinessError("ordinary_account_readiness_output_invalid");
  }
  const readiness = parsed.readiness;
  const readinessKeys = [
    "schemaVersion",
    "asOf",
    "readyForCutover",
    "schemaReady",
    "aclReady",
    ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_KEY,
    ...READINESS_COUNT_KEYS,
  ];
  if (!exactKeys(readiness, readinessKeys)) {
    throw readinessError("ordinary_account_readiness_output_invalid");
  }
  if (
    readiness.schemaVersion !== 1 ||
    typeof readiness.asOf !== "string" ||
    !UTC_TIMESTAMP_PATTERN.test(readiness.asOf) ||
    Number.isNaN(Date.parse(readiness.asOf)) ||
    typeof readiness.readyForCutover !== "boolean" ||
    typeof readiness.schemaReady !== "boolean" ||
    typeof readiness.aclReady !== "boolean" ||
    !isOrdinaryAccountIdentityContentSha256(
      readiness[ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_KEY],
    ) ||
    READINESS_COUNT_KEYS.some(
      (key) => !Number.isSafeInteger(readiness[key]) || readiness[key] < 0,
    )
  ) {
    throw readinessError("ordinary_account_readiness_output_invalid");
  }
  if (
    readiness.merchantAuthoritativeBindingCount +
      readiness.merchantInvalidBindingCount !==
      readiness.merchantRecordCount ||
    readiness.personalCanonicalOrphanCount >
      readiness.personalCanonicalBindingCount ||
    readiness.personalInvalidCanonicalCount >
      readiness.personalCanonicalBindingCount ||
    readiness.personalDuplicateAuthUserCount >
      readiness.personalCanonicalBindingCount ||
    readiness.personalDuplicateAccountIdCount >
      readiness.personalCanonicalBindingCount
  ) {
    throw readinessError("ordinary_account_readiness_output_invalid");
  }
  const expectedReady =
    readiness.merchantInvalidBindingCount === 0 &&
    readiness.personalCanonicalOrphanCount === 0 &&
    readiness.personalInvalidCanonicalCount === 0 &&
    readiness.personalDuplicateAuthUserCount === 0 &&
    readiness.personalDuplicateAccountIdCount === 0 &&
    readiness.crossAccountTypeOverlapCount === 0 &&
    readiness.accountIdentifierCollisionCount === 0 &&
    readiness.staffRegistryOverlapCount === 0 &&
    readiness.systemSitePrincipalOverlapCount === 0 &&
    readiness.schemaReady &&
    readiness.aclReady;
  if (readiness.readyForCutover !== expectedReady) {
    throw readinessError("ordinary_account_readiness_output_invalid");
  }
  const ready =
    expectedReady &&
    READINESS_BOOLEAN_KEYS.every((key) => parsed[key] === true);
  return {
    ...parsed,
    status: ready ? "ready" : "blocked",
  };
}

async function runReadinessQuery(input) {
  let result;
  try {
    result = await input.runCommand(
      "docker",
      dockerPsqlArguments(input.containerName, input.expectedEnvironment),
      {
        input: ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
        timeoutMs: input.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
        outputLimitBytes: DEFAULT_OUTPUT_LIMIT_BYTES,
      },
    );
  } catch {
    throw readinessError("ordinary_account_readiness_query_failed");
  }
  if (!result || result.status !== 0 || result.timedOut) {
    throw readinessError("ordinary_account_readiness_query_failed");
  }
  return parseOrdinaryAccountCutoverDatabaseReport(result.stdout);
}

export async function checkOrdinaryAccountCutoverReadiness(input = {}) {
  const environment = input.env ?? process.env;
  const expectedEnvironment =
    validateOrdinaryAccountCutoverExpectedEnvironment(environment);
  const topology =
    input.selfHostedTopology ??
    (input.inspectTopology ?? inspectSelfHostedSupabaseTopology)();
  const container = selectDatabaseContainer(
    topology,
    input.containerName ?? environment.FAOLLA_DATABASE_CONTAINER,
  );
  const acquireLock = input.acquireLock ?? acquireProductionMigrationLock;
  const lock = await acquireLock(input.lockPath);
  try {
    const databaseReport = await runReadinessQuery({
      containerName: container.name,
      runCommand: input.runCommand ?? runMigrationCommand,
      timeoutMs: input.commandTimeoutMs,
      expectedEnvironment,
    });
    return {
      schemaVersion: 1,
      mode: "read_only",
      databaseContainer: container.name,
      ...databaseReport,
    };
  } finally {
    await lock.release();
  }
}

function printTextReport(report, write) {
  write(
    `[ordinary-account-readiness] ${report.status.toUpperCase()} ` +
      `mode=${report.mode} asOf=${report.readiness.asOf}\n`,
  );
  write(
    `[ordinary-account-readiness] migrations=${report.migrationsReady} ` +
      `functions=${report.functionMetadataReady && report.functionAclReady} ` +
      `registry=${report.registryAclReady} authoritative=${report.readiness.readyForCutover}\n`,
  );
}

export async function runOrdinaryAccountCutoverReadinessCli(input = {}) {
  const argv = input.argv ?? process.argv.slice(2);
  const writeStdout =
    input.writeStdout ?? ((value) => process.stdout.write(value));
  const writeStderr =
    input.writeStderr ?? ((value) => process.stderr.write(value));
  const wantsJson = argv.includes("--json");
  try {
    const options = parseOrdinaryAccountCutoverReadinessArguments(argv);
    const report = await (
      input.execute ?? checkOrdinaryAccountCutoverReadiness
    )();
    if (options.json)
      writeStdout(`${JSON.stringify({ ok: true, ...report })}\n`);
    else printTextReport(report, writeStdout);
    return options.failOnBlocked && report.status !== "ready" ? 2 : 0;
  } catch (error) {
    const code =
      error instanceof OrdinaryAccountCutoverReadinessError
        ? error.code
        : "ordinary_account_cutover_readiness_failed";
    if (wantsJson)
      writeStderr(`${JSON.stringify({ ok: false, error: code })}\n`);
    else writeStderr(`[ordinary-account-readiness] ERROR ${code}\n`);
    return 1;
  }
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  process.exitCode = await runOrdinaryAccountCutoverReadinessCli();
}
