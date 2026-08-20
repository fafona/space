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

const ORDINARY_ACCOUNT_CUTOVER_AGGREGATE_SQL = String.raw`WITH expected_migration(version, name) AS (
  VALUES
    (202608190035::bigint, 'ordinary_account_authorization_foundation'::text),
    (202608190036::bigint, 'ordinary_account_authorization_bootstrap'::text),
    (202608190037::bigint, 'ordinary_account_system_site_principal_isolation'::text),
    (202608190038::bigint, 'ordinary_account_recovery_observer'::text),
    (202608190039::bigint, 'runtime_rpc_execute_acl_hardening'::text)
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
    5 = (
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
           SELECT to_regrole('authenticated'), merchant.relowner,
                  privilege_type, false
             FROM unnest(ARRAY['SELECT','INSERT','UPDATE']::text[])
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
    default_acl_row.creator_oid,
    default_acl_row.default_acl_oid,
    1 AS violation_rank,
    'function_default_acl_entry_count_invalid'::text AS code
  FROM creator_default_acl_row AS default_acl_row
  WHERE default_acl_row.acl_entry_count <> 1
  UNION ALL
  SELECT
    default_acl_row.creator_oid,
    default_acl_row.default_acl_oid,
    2 AS violation_rank,
    'function_default_acl_owner_execute_missing'::text AS code
  FROM creator_default_acl_row AS default_acl_row
  WHERE default_acl_row.owner_execute_count = 0
  UNION ALL
  SELECT
    default_acl_row.creator_oid,
    default_acl_row.default_acl_oid,
    3 AS violation_rank,
    'function_default_acl_catalog_reference_unresolved'::text AS code
  FROM creator_default_acl_row AS default_acl_row
  WHERE NOT default_acl_row.catalog_reference_ready
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
const DEFAULT_ACL_CATALOG_REFERENCE_VIOLATION =
  "function_default_acl_catalog_reference_unresolved";
const DEFAULT_ACL_DIAGNOSTIC_CONTRACT =
  "runtime_rpc_function_default_acl_v1";
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

function isOwnerExecuteEntry(entry, creatorOid) {
  return (
    entry.grantorOid === creatorOid &&
    entry.granteeOid === creatorOid &&
    entry.privilegeType === "EXECUTE" &&
    entry.grantable === false
  );
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
        isOwnerExecuteEntry(row.entries[0], creator.creatorOid),
    );
    if (!globalOwnerExecuteReady) {
      expectedViolations.push({
        code: DEFAULT_ACL_GLOBAL_VIOLATION,
        creatorOid: creator.creatorOid,
        defaultAclOid: null,
      });
    }
    for (const row of creatorRows) {
      if (row.entries.length !== 1) {
        expectedViolations.push({
          code: DEFAULT_ACL_ENTRY_COUNT_VIOLATION,
          creatorOid: creator.creatorOid,
          defaultAclOid: row.defaultAclOid,
        });
      }
      if (
        !row.entries.some((entry) =>
          isOwnerExecuteEntry(entry, creator.creatorOid),
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
  if (
    !exactKeys(parsed, [
      ...READINESS_BOOLEAN_KEYS,
      "databaseIdentity",
      "readiness",
      ...(hasDefaultAclDiagnostic ? ["defaultAclDiagnostic"] : []),
    ])
  ) {
    throw readinessError("ordinary_account_readiness_output_invalid");
  }
  if (READINESS_BOOLEAN_KEYS.some((key) => typeof parsed[key] !== "boolean")) {
    throw readinessError("ordinary_account_readiness_output_invalid");
  }
  if (
    hasDefaultAclDiagnostic === parsed.runtimeRpcHardeningReady ||
    (!parsed.runtimeRpcHardeningReady && parsed.objectContractsReady) ||
    (hasDefaultAclDiagnostic &&
      (!validateDefaultAclDiagnostic(parsed.defaultAclDiagnostic) ||
        parsed.defaultAclDiagnostic.ready !==
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
