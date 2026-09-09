// Version 1 covered four relations. Keep its exact roster for historical
// archive identification, never silently upgrade it to current release proof.
export const DATABASE_RECOVERY_CONTENT_SCHEMA_VERSION = 2;
export const DATABASE_RECOVERY_LEGACY_RELATIONS = Object.freeze([
  "public.pages",
  "public.faolla_redemption_operations",
  "public.faolla_redemption_checkouts",
  "public.faolla_schema_migrations",
]);
// These rows are one recovery unit: live books/history/QR revocations, durable
// redemption/cancellation evidence, and historical snapshot restore receipts.
// The receipt candidate has no migration registration yet; inspect its actual
// presence independently, including an explicitly absent or empty table.
export const DATABASE_RECOVERY_RELATIONS = Object.freeze([
  ...DATABASE_RECOVERY_LEGACY_RELATIONS,
  "public.faolla_platform_snapshot_restore_receipts",
]);
export const DATABASE_RECOVERY_MIGRATIONS = Object.freeze({
  "202609080044": "qr_token_atomic_mutation",
  "202609080045": "order_membership_atomic_mutation",
  "202609080046": "redemption_atomic_mutation",
  "202609080047": "redemption_checkout_context",
});

const shaPattern = /^[0-9a-f]{64}$/;
const countPattern = /^(?:0|[1-9][0-9]{0,18})$/;
function record(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value, expected) {
  if (!record(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && [...expected].sort().every((key, i) => key === keys[i]);
}
function literal(value) { return `'${value.replaceAll("'", "''")}'`; }

// Only fixed identifiers from the source-controlled allowlist enter query_to_xml.
// The XML contains counts and hashes, never raw page/receipt/token fields. A row
// is hashed before aggregation to bound aggregate memory and retain duplicates.
function relationDigestSql(name) {
  const relation = name.split(".").map((part) => `"${part}"`).join(".");
  const sql = `SELECT pg_catalog.jsonb_build_object(
    'rowCount', pg_catalog.count(*)::text,
    'contentSha256', pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      ${literal(`faolla:recovery-content:v2:${name}:`)} || COALESCE(
        pg_catalog.string_agg(row_hash, '' ORDER BY row_hash COLLATE "C"), ''), 'UTF8')), 'hex')
  )::text AS value FROM (
    SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.to_jsonb(recovery_row)::text, 'UTF8')), 'hex') AS row_hash
    FROM ${relation} AS recovery_row
  ) AS rows`;
  return `(pg_catalog.xpath('/table/row/value/text()', pg_catalog.query_to_xml(${literal(sql)}, false, false, '')))[1]::text::jsonb`;
}

export function buildDatabaseRecoveryContentScalarSql() {
  const relations = DATABASE_RECOVERY_RELATIONS.map((name) => `pg_catalog.jsonb_build_object(
    'name', ${literal(name)}, 'present', pg_catalog.to_regclass(${literal(name)}) IS NOT NULL
  ) || CASE WHEN pg_catalog.to_regclass(${literal(name)}) IS NULL
    THEN '{"rowCount":null,"contentSha256":null}'::jsonb
    ELSE ${relationDigestSql(name)} END`).join(",\n");
  // This query intentionally fails if the required migration registry is absent.
  // A duplicate/misnamed row remains an invalid proof rather than being normalized.
  const migrations = Object.keys(DATABASE_RECOVERY_MIGRATIONS).flatMap((version) => [
    literal(version), `(SELECT name FROM public.faolla_schema_migrations WHERE version = ${version})`,
  ]).join(",\n");
  return `pg_catalog.jsonb_build_object('schemaVersion', ${DATABASE_RECOVERY_CONTENT_SCHEMA_VERSION},
    'relations', pg_catalog.jsonb_build_array(${relations}),
    'migrationNames', pg_catalog.jsonb_build_object(${migrations})
  )`;
}

/** Execute with UTC / ISO DateStyle / extra_float_digits=3 in one read-only
 * repeatable-read transaction, including any identity probes sharing the proof.
 * Before/after equality alone is not evidence of a writer freeze or of a
 * cluster-wide/storage snapshot. The restored content must also match exactly.
 */
export function buildDatabaseRecoveryContentSql() {
  return `SELECT ${buildDatabaseRecoveryContentScalarSql()} AS recovery_content;`;
}

// Separate -c invocations share one psql connection/transaction and preserve the
// SELECT result. A single -c string ending in COMMIT can discard that result.
// selectSql is internal, source-generated SQL, never a CLI/user-supplied query.
export function buildDatabaseRecoveryReadOnlyPsqlArgs(selectSql) {
  if (typeof selectSql !== "string" || !selectSql.trim()) throw new Error("database_recovery_query_invalid");
  return ["--command", "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;",
    "--command", "SET LOCAL timezone='UTC';", "--command", "SET LOCAL datestyle='ISO,YMD';",
    "--command", "SET LOCAL extra_float_digits=3;", "--command", selectSql, "--command", "COMMIT;"];
}

export function validateDatabaseRecoveryContent(value, options = {}) {
  const invalid = () => ({ valid: false, error: "database_recovery_content_invalid" });
  if (!exactKeys(value, ["schemaVersion", "relations", "migrationNames"]) ||
      (value.schemaVersion !== 1 && value.schemaVersion !== DATABASE_RECOVERY_CONTENT_SCHEMA_VERSION) ||
      (options.requireCurrent === true && value.schemaVersion !== DATABASE_RECOVERY_CONTENT_SCHEMA_VERSION)) return invalid();
  const roster = value.schemaVersion === 1 ? DATABASE_RECOVERY_LEGACY_RELATIONS : DATABASE_RECOVERY_RELATIONS;
  if (!Array.isArray(value.relations) || value.relations.length !== roster.length ||
      !exactKeys(value.migrationNames, Object.keys(DATABASE_RECOVERY_MIGRATIONS))) return invalid();
  const relations = [];
  for (const [index, name] of roster.entries()) {
    const item = value.relations[index];
    if (!exactKeys(item, ["name", "present", "rowCount", "contentSha256"]) || item.name !== name || typeof item.present !== "boolean") return invalid();
    if (item.present ? typeof item.rowCount !== "string" || !countPattern.test(item.rowCount) ||
        BigInt(item.rowCount) > 9223372036854775807n || typeof item.contentSha256 !== "string" || !shaPattern.test(item.contentSha256)
      : item.rowCount !== null || item.contentSha256 !== null) return invalid();
    relations.push({ name, present: item.present, rowCount: item.rowCount, contentSha256: item.contentSha256 });
  }
  if (!relations[0].present || !relations[3].present) return invalid();
  const migrationNames = {};
  for (const [version, name] of Object.entries(DATABASE_RECOVERY_MIGRATIONS)) {
    const appliedName = value.migrationNames[version];
    if (appliedName !== null && appliedName !== name) return invalid();
    migrationNames[version] = appliedName;
  }
  if (BigInt(relations[3].rowCount) < BigInt(Object.values(migrationNames).filter((name) => name !== null).length)) return invalid();
  const orderApplied = migrationNames["202609080045"] !== null;
  const operationApplied = migrationNames["202609080046"] !== null;
  const checkoutApplied = migrationNames["202609080047"] !== null;
  if (relations[1].present !== operationApplied || relations[2].present !== checkoutApplied ||
      (operationApplied && !orderApplied) || (checkoutApplied && !operationApplied)) return invalid();
  return { valid: true, content: { schemaVersion: value.schemaVersion, relations, migrationNames } };
}

export function assertDatabaseRecoveryContentMatch(actual, expected) {
  // A valid legacy archive is not complete current recovery evidence. Do not
  // truncate v2, fill a missing fifth relation, or accept two legacy proofs.
  const left = validateDatabaseRecoveryContent(actual, { requireCurrent: true });
  const right = validateDatabaseRecoveryContent(expected, { requireCurrent: true });
  if (!left.valid || !right.valid) throw new Error("database_recovery_content_invalid");
  if (JSON.stringify(left.content) !== JSON.stringify(right.content)) throw new Error("database_recovery_content_mismatch");
  return left.content;
}
