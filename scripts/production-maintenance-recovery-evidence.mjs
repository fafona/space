import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isProxy } from "node:util/types";

// One reviewed recovery source delta, not a general source-editor permission.
export const MAINTENANCE_RECOVERY_SOURCE_PATHS = Object.freeze([
  ".github/workflows/production-maintenance.yml",
  "docs/production-maintenance.md",
  ...["production-maintenance-control", "production-maintenance-launch-journal-storage",
    "production-maintenance-recovery", "production-maintenance-recovery-workflow",
    "production-maintenance-workflow-contract", "production-maintenance-ingress",
    "maintenance-postgrest-root-acceptance", "maintenance-supabase-scheduler-acceptance",
    "production-maintenance-recovery-evidence"].flatMap(name => [`scripts/${name}.mjs`, `scripts/${name}.test.mjs`]),
].sort());
const SHA = /^[0-9a-f]{40}$/;
const ZERO = "0".repeat(40);
const fail = () => { throw new Error("maintenance_recovery_evidence_unverified"); };
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length || !keys.every(key => descriptors[key]?.enumerable && Object.hasOwn(descriptors[key], "value"))) fail();
}
function runGit(args) {
  const result = spawnSync("/usr/bin/git", args, {
    cwd: path.dirname(path.dirname(fileURLToPath(import.meta.url))), encoding: "utf8", timeout: 12000, maxBuffer: 262144,
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0",
      GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_GLOBAL: "/dev/null", GIT_ATTR_NOSYSTEM: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.signal || result.status !== 0 || result.stderr) fail();
  return result.stdout;
}

/** Read only the exact executing checkout; no caller-selected directory or git command. */
export function readMaintenanceRecoverySourceProof(request, executeFixed = runGit) {
  try {
    exact(request, ["targetSha", "previousTargetSha"]);
    const { targetSha, previousTargetSha } = request;
    if (typeof targetSha !== "string" || typeof previousTargetSha !== "string" || !SHA.test(targetSha) || !SHA.test(previousTargetSha) ||
        targetSha === previousTargetSha || typeof executeFixed !== "function") fail();
    const read = args => { const value = executeFixed(args); if (typeof value !== "string" || Buffer.byteLength(value) > 262144) fail(); return value; };
    const check = () => {
      if (read(["rev-parse", "--verify", "HEAD"]) !== targetSha + "\n" ||
          read(["status", "--porcelain=v1", "--untracked-files=all"]) !== "") fail();
    };
    check();
    if (read(["merge-base", "--is-ancestor", previousTargetSha, targetSha]) !== "") fail();
    const raw = read(["diff", "--raw", "-z", "--abbrev=40", "--no-renames", "--no-ext-diff", "--no-textconv", previousTargetSha, targetSha, "--"]);
    if (!raw.endsWith("\0")) fail();
    const fields = raw.slice(0, -1).split("\0");
    if (!fields.length || fields.length % 2 || fields.length > MAINTENANCE_RECOVERY_SOURCE_PATHS.length * 2) fail();
    const changes = [];
    for (let index = 0; index < fields.length; index += 2) {
      const match = /^:(000000|100644|100755) (100644|100755) ([0-9a-f]{40}) ([0-9a-f]{40}) ([AM])$/.exec(fields[index]);
      const file = fields[index + 1];
      if (!match || !MAINTENANCE_RECOVERY_SOURCE_PATHS.includes(file) || changes.some(value => value.path === file)) fail();
      const [, oldMode, newMode, oldBlob, newBlob, status] = match;
      if (newBlob === ZERO || oldBlob === newBlob ||
          (status === "A" ? oldMode !== "000000" || oldBlob !== ZERO : oldMode !== newMode || oldBlob === ZERO)) fail();
      changes.push({ path: file, oldMode, newMode, oldBlob, newBlob, status });
    }
    changes.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    check();
    return Object.freeze({ sourceDiffDigest: hash(changes), sourceChangedPaths: Object.freeze(changes.map(value => value.path)) });
  } catch { fail(); }
}

export const MAINTENANCE_RECOVERY_MIGRATION_SQL = "BEGIN READ ONLY; SET LOCAL search_path=pg_catalog; SET LOCAL timezone='UTC'; " +
  "SET LOCAL row_security=off; SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='1s'; " +
  "SELECT json_build_object('readOnly',current_setting('transaction_read_only')='on'," +
  "'databaseOid',(SELECT oid::bigint FROM pg_database WHERE datname=current_database())," +
  "'rows',(SELECT coalesce(json_agg(json_build_object('version',version::text,'name',name," +
  "'appliedAt',to_char(applied_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')) ORDER BY version),'[]'::json) " +
  "FROM public.faolla_schema_migrations))::text; ROLLBACK;";

/** Metadata only: no application records, SQL mutations or migration execution. */
export function validateMaintenanceRecoveryMigrationProof(value, databaseOid, createdAt) {
  try {
    exact(value, ["readOnly", "databaseOid", "rows"]);
    if (value.readOnly !== true || !Number.isSafeInteger(databaseOid) || databaseOid < 1 || value.databaseOid !== databaseOid ||
        !Number.isSafeInteger(createdAt) || createdAt < 1 || !Array.isArray(value.rows) || isProxy(value.rows) || value.rows.length > 1024) fail();
    const descriptors = Object.getOwnPropertyDescriptors(value.rows);
    if (Reflect.ownKeys(descriptors).length !== value.rows.length + 1) fail();
    const rows = []; let previous = "";
    for (let index = 0; index < value.rows.length; index++) {
      const descriptor = descriptors[index];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail();
      const row = descriptor.value;
      exact(row, ["version", "name", "appliedAt"]);
      if (typeof row.version !== "string" || !/^[0-9]{12}$/.test(row.version) || row.version <= previous || row.version === "202609090048" ||
          typeof row.name !== "string" || !/^[a-z][a-z0-9_]{0,149}$/.test(row.name) ||
          typeof row.appliedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(row.appliedAt)) fail();
      const millis = Date.parse(row.appliedAt);
      if (!Number.isSafeInteger(millis) || millis < 0 || new Date(millis).toISOString() !== row.appliedAt.slice(0, 23) + "Z" ||
          BigInt(millis) * 1000n + BigInt(row.appliedAt.slice(23, 26)) > BigInt(createdAt) * 1000n) fail();
      rows.push({ version: row.version, name: row.name, appliedAt: row.appliedAt }); previous = row.version;
    }
    return hash(rows);
  } catch { fail(); }
}
