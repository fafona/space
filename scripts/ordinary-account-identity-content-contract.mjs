import path from "node:path";
import { pathToFileURL } from "node:url";

export const ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_KEY =
  "ordinaryIdentityContentSha256";
export const ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_PATTERN =
  /^[0-9a-f]{64}$/;

const IDENTITY_RELATIONS = Object.freeze([
  Object.freeze({
    ordinal: 1,
    name: "auth.users",
    from: "auth.users AS identity",
    rowAlias: "identity",
    columns: Object.freeze(["id"]),
  }),
  Object.freeze({
    ordinal: 2,
    name: "public.merchants",
    from: "public.merchants AS merchant",
    rowAlias: "merchant",
    columns: Object.freeze([
      "id",
      "user_id",
      "auth_user_id",
      "owner_user_id",
      "owner_id",
      "auth_id",
      "created_by",
      "created_by_user_id",
    ]),
  }),
  Object.freeze({
    ordinal: 3,
    name: "public.faolla_personal_accounts",
    from: "public.faolla_personal_accounts AS personal",
    rowAlias: "personal",
    columns: Object.freeze(["auth_user_id", "personal_account_id", "status"]),
  }),
  Object.freeze({
    ordinal: 4,
    name: "public.merchant_enterprise_staff_identities",
    from: "public.merchant_enterprise_staff_identities AS staff",
    rowAlias: "staff",
    columns: Object.freeze(["auth_user_id"]),
  }),
  Object.freeze({
    ordinal: 5,
    name: "public.merchant_enterprise_employees",
    from: "public.merchant_enterprise_employees AS employee",
    rowAlias: "employee",
    columns: Object.freeze(["auth_user_id"]),
  }),
]);

export const ORDINARY_ACCOUNT_IDENTITY_CONTENT_FIELDS = Object.freeze(
  IDENTITY_RELATIONS.flatMap(({ name, columns }) =>
    columns.map((column) => `${name}.${column}`),
  ),
);

function canonicalFieldSql(expression) {
  return [
    `CASE WHEN ${expression} IS NULL THEN 'n'::pg_catalog.text ELSE`,
    "  pg_catalog.concat(",
    "    'v',",
    `    pg_catalog.octet_length(pg_catalog.convert_to(${expression}::pg_catalog.text, 'UTF8'))::pg_catalog.text,`,
    "    ':',",
    `    ${expression}::pg_catalog.text`,
    "  )",
    "END",
  ].join("\n");
}

function canonicalRowSql(rowAlias, columns) {
  return [
    "pg_catalog.concat(",
    ...columns.flatMap((column, index) => [
      `  'f',`,
      canonicalFieldSql(
        `pg_catalog.to_jsonb(${rowAlias}) OPERATOR(pg_catalog.->>) '${column}'`,
      )
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n") + (index === columns.length - 1 ? "" : ","),
    ]),
    ")",
  ].join("\n");
}

const relationValuesSql = IDENTITY_RELATIONS.map(
  ({ ordinal, name }) =>
    `    (${ordinal}::pg_catalog.int4, '${name}'::pg_catalog.text)`,
).join(",\n");

const rowUnionSql = IDENTITY_RELATIONS.map(
  ({ ordinal, from, rowAlias, columns }) =>
    [
      `  SELECT ${ordinal}::pg_catalog.int4 AS relation_ordinal,`,
      canonicalRowSql(rowAlias, columns)
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n") + " AS row_payload",
      `    FROM ${from}`,
    ].join("\n"),
).join("\n  UNION ALL\n");

export const ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_SCALAR_SQL = String.raw`(
WITH ordinary_identity_relation(relation_ordinal, relation_name) AS (
  VALUES
${relationValuesSql}
), ordinary_identity_row(relation_ordinal, row_payload) AS MATERIALIZED (
${rowUnionSql}
), ordinary_identity_relation_payload(
  relation_ordinal, relation_name, relation_payload
) AS MATERIALIZED (
  SELECT relation.relation_ordinal,
         relation.relation_name,
         COALESCE(
           pg_catalog.string_agg(
             pg_catalog.concat(
               'r',
               pg_catalog.octet_length(
                 pg_catalog.convert_to(row_payload, 'UTF8')
               )::pg_catalog.text,
               ':',
               row_payload
             ),
             ''::pg_catalog.text
             ORDER BY pg_catalog.convert_to(row_payload, 'UTF8')
           ) FILTER (WHERE row_payload IS NOT NULL),
           ''::pg_catalog.text
         ) AS relation_payload
    FROM ordinary_identity_relation AS relation
    LEFT JOIN ordinary_identity_row AS identity_row
      ON identity_row.relation_ordinal = relation.relation_ordinal
   GROUP BY relation.relation_ordinal, relation.relation_name
), ordinary_identity_canonical_content(canonical_content) AS MATERIALIZED (
  SELECT pg_catalog.concat(
           'faolla:ordinary-identity-content:v1:',
           pg_catalog.string_agg(
             pg_catalog.concat(
               't',
               pg_catalog.octet_length(
                 pg_catalog.convert_to(relation_name, 'UTF8')
               )::pg_catalog.text,
               ':',
               relation_name,
               'p',
               pg_catalog.octet_length(
                 pg_catalog.convert_to(relation_payload, 'UTF8')
               )::pg_catalog.text,
               ':',
               relation_payload
             ),
             ''::pg_catalog.text ORDER BY relation_ordinal
           )
         )
    FROM ordinary_identity_relation_payload
)
SELECT pg_catalog.encode(
         pg_catalog.sha256(
           pg_catalog.convert_to(canonical_content, 'UTF8')
         ),
         'hex'
       )
  FROM ordinary_identity_canonical_content
)`;

export const ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_SELECT_SQL =
  `SELECT ${ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_SCALAR_SQL} ` +
  "AS ordinary_identity_content_sha256;";

export function isOrdinaryAccountIdentityContentSha256(value) {
  return (
    typeof value === "string" &&
    ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_PATTERN.test(value)
  );
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  if (process.argv.length !== 3 || process.argv[2] !== "--select-sql") {
    process.stderr.write(
      "ordinary-account-identity-content-contract: expected --select-sql\n",
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `${ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_SELECT_SQL}\n`,
    );
  }
}
