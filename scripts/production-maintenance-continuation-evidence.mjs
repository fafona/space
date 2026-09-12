import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isProxy } from "node:util/types";

// Incident-specific continuation, never an application/SQL/dependency update.
export const MAINTENANCE_CONTINUATION_SOURCE_PATHS = Object.freeze([
  ".github/workflows/deploy.yml", ".github/workflows/production-maintenance.yml", "docs/production-maintenance.md",
  "scripts/deploy.production.sh", "scripts/deploy-production-contract.test.mjs", "scripts/production-maintenance-deploy.test.mjs",
  ...["production-maintenance-control", "production-maintenance-launch-journal-storage", "production-maintenance-continuation",
    "production-maintenance-continuation-evidence", "production-maintenance-continuation-workflow",
    "production-maintenance-workflow-contract", "production-maintenance-deploy-read"].flatMap(name => [`scripts/${name}.mjs`, `scripts/${name}.test.mjs`]),
].sort());
export const MAINTENANCE_CONTINUATION_MIGRATION_WINDOW = Object.freeze({
  runId: "34721155156", attempt: 1, startedAt: "2026-09-12T21:52:38.000Z", endedBefore: "2026-09-12T21:52:46.000Z",
});
const PREVIOUS = "b7c3d57f4739846fb45f236ef83b97b7ff21a7cf", CREATED_AT = 1789236034129;
const SHA = /^[a-f0-9]{40}$/, ZERO = "0".repeat(40);
const LAST = [
  ["202609080044", "qr_token_atomic_mutation"], ["202609080045", "order_membership_atomic_mutation"],
  ["202609080046", "redemption_atomic_mutation"], ["202609080047", "redemption_checkout_context"],
  ["202609090048", "pages_client_write_acl"],
];
const fail = () => { throw new Error("maintenance_continuation_evidence_unverified"); };
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length || !keys.every(key => descriptors[key]?.enumerable && Object.hasOwn(descriptors[key], "value"))) fail();
}
function dense(value, length) {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== length) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== length + 1) fail();
  for (let index = 0; index < length; index++) if (!descriptors[index]?.enumerable || !Object.hasOwn(descriptors[index], "value")) fail();
}
function runGit(args) {
  const result = spawnSync("/usr/bin/git", ["--no-optional-locks", "-c", "core.fsmonitor=false", ...args], {
    cwd: path.dirname(path.dirname(fileURLToPath(import.meta.url))), encoding: "utf8", timeout: 12000, maxBuffer: 262144,
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0", GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_GLOBAL: "/dev/null", GIT_ATTR_NOSYSTEM: "1" }, stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.signal || result.status !== 0 || result.stderr) fail();
  return result.stdout;
}
function reader(request, executeFixed) {
  exact(request, ["targetSha", "previousTargetSha"]);
  if (typeof request.targetSha !== "string" || !SHA.test(request.targetSha) || request.previousTargetSha !== PREVIOUS ||
      request.targetSha === PREVIOUS || typeof executeFixed !== "function") fail();
  const targetSha = request.targetSha;
  const read = args => { const value = executeFixed(args); if (typeof value !== "string" || Buffer.byteLength(value) > 262144) fail(); return value; };
  const check = () => {
    if (read(["rev-parse", "--verify", "HEAD"]) !== targetSha + "\n" ||
        read(["status", "--porcelain=v1", "--untracked-files=all"]) !== "") fail();
  };
  return { read, check, targetSha };
}

/** Fixed executing checkout, exact ancestor and canonical reviewed blob delta. */
export function readMaintenanceContinuationSourceProof(request, executeFixed = runGit) {
  try {
    const { read, check, targetSha } = reader(request, executeFixed); check();
    if (read(["merge-base", "--is-ancestor", PREVIOUS, targetSha]) !== "") fail();
    const raw = read(["diff", "--raw", "-z", "--abbrev=40", "--no-renames", "--no-ext-diff", "--no-textconv", PREVIOUS, targetSha, "--"]);
    if (!raw.endsWith("\0")) fail();
    const fields = raw.slice(0, -1).split("\0"), changes = [];
    if (!fields.length || fields.length % 2 || fields.length > MAINTENANCE_CONTINUATION_SOURCE_PATHS.length * 2) fail();
    for (let index = 0; index < fields.length; index += 2) {
      const match = /^:(000000|100644|100755) (100644|100755) ([0-9a-f]{40}) ([0-9a-f]{40}) ([AM])$/.exec(fields[index]), file = fields[index + 1];
      if (!match || !MAINTENANCE_CONTINUATION_SOURCE_PATHS.includes(file) || changes.some(value => value.path === file)) fail();
      const [, oldMode, newMode, oldBlob, newBlob, status] = match;
      if (newBlob === ZERO || oldBlob === newBlob ||
          (status === "A" ? oldMode !== "000000" || oldBlob !== ZERO : oldMode !== newMode || oldBlob === ZERO)) fail();
      changes.push({ path: file, oldMode, newMode, oldBlob, newBlob, status });
    }
    changes.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0); check();
    return Object.freeze({ sourceDiffDigest: hash(changes), sourceChangedPaths: Object.freeze(changes.map(value => value.path)) });
  } catch { fail(); }
}

export const MAINTENANCE_CONTINUATION_MIGRATION_SQL = "BEGIN READ ONLY; SET LOCAL search_path=pg_catalog; SET LOCAL timezone='UTC'; " +
  "SET LOCAL row_security=off; SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='1s'; " +
  "SELECT json_build_object('readOnly',current_setting('transaction_read_only')='on'," +
  "'databaseOid',(SELECT oid::bigint FROM pg_database WHERE datname=current_database())," +
  "'rows',(SELECT coalesce(json_agg(json_build_object('version',version::text,'name',name," +
  "'appliedAt',to_char(applied_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')) ORDER BY version),'[]'::json) " +
  "FROM public.faolla_schema_migrations))::text; ROLLBACK;";

function migrationCatalog(request, executeFixed) {
  const { read, check, targetSha } = reader(request, executeFixed); check();
  const raw = read(["ls-tree", "-z", `${PREVIOUS}:scripts/supabase-migrations`]);
  if (raw !== read(["ls-tree", "-z", `${targetSha}:scripts/supabase-migrations`]) || !raw.endsWith("\0")) fail();
  const rows = []; let readme = false;
  for (const entry of raw.slice(0, -1).split("\0")) {
    const match = /^100644 blob ([0-9a-f]{40})\t(.+)$/.exec(entry); if (!match || match[1] === ZERO) fail();
    if (match[2] === "README.md" && !readme) { readme = true; continue; }
    const file = /^([0-9]{12})_([a-z][a-z0-9_]{0,149})\.sql$/.exec(match[2]);
    if (!file || rows.some(value => value.version === file[1])) fail();
    rows.push({ version: file[1], name: file[2] });
  }
  if (!readme || rows.length !== 56 || rows.some((row, index) => index > 0 && row.version <= rows[index - 1].version) ||
      LAST.some(([version, name], index) => rows[index + 51].version !== version || rows[index + 51].name !== name)) fail();
  check(); return rows;
}
function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)) fail();
  const millis = Date.parse(value);
  if (!Number.isSafeInteger(millis) || millis < 0 || new Date(millis).toISOString() !== value.slice(0, 23) + "Z") fail();
  return BigInt(millis) * 1000n + BigInt(value.slice(23, 26));
}

/** Complete registry, not selected rows. No caller-chosen catalog or time window. */
export function validateMaintenanceContinuationMigrationProof(value, databaseOid, createdAt, request, executeFixed = runGit) {
  try {
    exact(value, ["readOnly", "databaseOid", "rows"]);
    if (value.readOnly !== true || !Number.isSafeInteger(databaseOid) || databaseOid < 1 || value.databaseOid !== databaseOid || createdAt !== CREATED_AT) fail();
    dense(value.rows, 56);
    const captured = value.rows.map(row => {
      exact(row, ["version", "name", "appliedAt"]);
      if (typeof row.version !== "string" || typeof row.name !== "string") fail();
      timestamp(row.appliedAt);
      return { version: row.version, name: row.name, appliedAt: row.appliedAt };
    });
    const catalog = migrationCatalog(request, executeFixed), rows = [];
    const start = BigInt(Date.parse(MAINTENANCE_CONTINUATION_MIGRATION_WINDOW.startedAt)) * 1000n;
    const end = BigInt(Date.parse(MAINTENANCE_CONTINUATION_MIGRATION_WINDOW.endedBefore)) * 1000n;
    let previousApplied = null;
    for (let index = 0; index < catalog.length; index++) {
      const row = captured[index];
      if (row.version !== catalog[index].version || row.name !== catalog[index].name) fail();
      const applied = timestamp(row.appliedAt);
      if (index < 51 ? applied > BigInt(CREATED_AT) * 1000n : applied < start || applied >= end || (previousApplied !== null && applied < previousApplied)) fail();
      if (index >= 51) previousApplied = applied;
      rows.push({ version: row.version, name: row.name, appliedAt: row.appliedAt });
    }
    return hash(rows);
  } catch { fail(); }
}
