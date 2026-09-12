import assert from "node:assert/strict";
import test from "node:test";
import { MAINTENANCE_RECOVERY_SOURCE_PATHS, readMaintenanceRecoverySourceProof,
  MAINTENANCE_RECOVERY_MIGRATION_SQL, validateMaintenanceRecoveryMigrationProof } from "./production-maintenance-recovery-evidence.mjs";
const targetSha = "b".repeat(40), previousTargetSha = "a".repeat(40);
const request = { targetSha, previousTargetSha };
const file = "scripts/production-maintenance-control.mjs";
const diff = (path = file, oldBlob = "c".repeat(40)) => `:100644 100644 ${oldBlob} ${"d".repeat(40)} M\0${path}\0`;
function git(raw = diff(), change = () => {}) {
  let headReads = 0; const calls = [];
  return { calls, run(args) {
    calls.push(args); const command = args[0];
    if (command === "rev-parse") return change(command, ++headReads) ?? targetSha + "\n";
    if (command === "status") return change(command, headReads) ?? "";
    if (command === "merge-base") return change(command, headReads) ?? "";
    if (command === "diff") return raw;
    throw new Error("UNEXPECTED_PRIVATE_COMMAND");
  } };
}
test("source evidence reads exact clean executing target, ancestor and bounded reviewed blob changes twice", () => {
  const fixture = git(); const result = readMaintenanceRecoverySourceProof(request, fixture.run);
  assert.match(result.sourceDiffDigest, /^[0-9a-f]{64}$/); assert.deepEqual(result.sourceChangedPaths, [file]);
  assert.equal(fixture.calls.filter(args => args[0] === "rev-parse").length, 2);
  assert.equal(fixture.calls.filter(args => args[0] === "status").length, 2);
  assert.deepEqual(fixture.calls[2], ["merge-base", "--is-ancestor", previousTargetSha, targetSha]);
  assert.deepEqual(fixture.calls[3], ["diff", "--raw", "-z", "--abbrev=40", "--no-renames", "--no-ext-diff", "--no-textconv", previousTargetSha, targetSha, "--"]);
  assert.ok(Object.isFrozen(MAINTENANCE_RECOVERY_SOURCE_PATHS)); assert.ok(Object.isFrozen(result.sourceChangedPaths));
});
test("source digest canonicalizes ordering but not blobs, and rejects empty, unknown, duplicate, deletion or mode changes", () => {
  const second = "docs/production-maintenance.md";
  const a = readMaintenanceRecoverySourceProof(request, git(diff() + diff(second)).run);
  const b = readMaintenanceRecoverySourceProof(request, git(diff(second) + diff()).run);
  assert.deepEqual(a, b);
  assert.notEqual(readMaintenanceRecoverySourceProof(request, git(diff(file, "e".repeat(40))).run).sourceDiffDigest,
    readMaintenanceRecoverySourceProof(request, git().run).sourceDiffDigest);
  for (const value of ["", diff("scripts/deploy.production.sh"), diff() + diff(), diff().replace(" M\0", " D\0"),
    diff().replace(":100644 100644", ":100755 100644"), diff().replace(":100644", ":120000"), diff().slice(0, -1)]) {
    assert.throws(() => readMaintenanceRecoverySourceProof(request, git(value).run), /maintenance_recovery_evidence_unverified/);
  }
});
test("source drift, dirty tree, non-ancestor, malformed inputs and command errors fail without exposing data", () => {
  for (const change of [(command, n) => command === "rev-parse" && n === 2 ? previousTargetSha + "\n" : undefined,
    command => command === "status" ? " M secret\n" : undefined, command => { if (command === "merge-base") throw new Error("PRIVATE"); }]) {
    assert.throws(() => readMaintenanceRecoverySourceProof(request, git(diff(), change).run), /^Error: maintenance_recovery_evidence_unverified$/);
  }
  for (const value of [{ ...request, directory: "/arbitrary" }, { ...request, previousTargetSha: targetSha }, new Proxy(request, {}),
    { get targetSha() { throw new Error("PRIVATE"); }, previousTargetSha }]) {
    assert.throws(() => readMaintenanceRecoverySourceProof(value, git().run), /^Error: maintenance_recovery_evidence_unverified$/);
  }
});
const when = Date.parse("2026-09-12T12:00:00.123Z");
const migration = () => ({ readOnly: true, databaseOid: 5, rows: [
  { version: "202609080047", name: "redemption_checkouts", appliedAt: "2026-09-12T12:00:00.123000Z" },
] });
test("fixed SQL reads complete metadata with bounded catalog-only read-only transaction; digest preserves exact timestamps", () => {
  assert.match(MAINTENANCE_RECOVERY_MIGRATION_SQL, /^BEGIN READ ONLY; SET LOCAL search_path=pg_catalog;/);
  assert.match(MAINTENANCE_RECOVERY_MIGRATION_SQL, /SET LOCAL row_security=off/);
  assert.match(MAINTENANCE_RECOVERY_MIGRATION_SQL, /ORDER BY version/);
  assert.match(MAINTENANCE_RECOVERY_MIGRATION_SQL, /FROM public\.faolla_schema_migrations/);
  assert.match(MAINTENANCE_RECOVERY_MIGRATION_SQL, /ROLLBACK;$/);
  assert.doesNotMatch(MAINTENANCE_RECOVERY_MIGRATION_SQL, /\b(?:UPDATE|INSERT|DELETE|CREATE|ALTER|DROP|LIMIT)\b/);
  const a = migration(), before = structuredClone(a), hash = validateMaintenanceRecoveryMigrationProof(a, 5, when);
  assert.match(hash, /^[0-9a-f]{64}$/); assert.deepEqual(a, before);
  a.rows[0].appliedAt = "2026-09-12T12:00:00.122999Z";
  assert.notEqual(validateMaintenanceRecoveryMigrationProof(a, 5, when), hash);
});
test("ledger 48, microsecond-after-cutoff, identity, missing rows, ordering and accessor failures are rejected", () => {
  for (const mutate of [v => { v.rows[0].version = "202609090048"; }, v => { v.rows[0].appliedAt = "2026-09-12T12:00:00.123001Z"; },
    v => { v.databaseOid = 6; }, v => { v.readOnly = false; }, v => { v.rows = null; }, v => { v.rows.push(v.rows[0]); },
    v => { v.rows[0].version = 202609080047; }, v => { v.rows[0].appliedAt = null; }, v => { v.rows[0].extra = "PRIVATE"; },
    v => { v.rows = Array(1); }, v => { Object.defineProperty(v.rows, "0", { enumerable: true, get() { throw new Error("PRIVATE"); } }); },
    v => { v.rows[0].appliedAt = "2026-02-30T12:00:00.123000Z"; }]) {
    const value = migration(); mutate(value);
    assert.throws(() => validateMaintenanceRecoveryMigrationProof(value, 5, when), /^Error: maintenance_recovery_evidence_unverified$/);
  }
});
