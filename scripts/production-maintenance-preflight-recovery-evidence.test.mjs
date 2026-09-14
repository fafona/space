import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync } from "node:fs";
import { MAINTENANCE_PREFLIGHT_RECOVERY_SOURCE_PATHS, MAINTENANCE_PREFLIGHT_RECOVERY_MIGRATION_WINDOW,
  MAINTENANCE_PREFLIGHT_RECOVERY_MIGRATION_SQL, readMaintenancePreflightRecoverySourceProof,
  validateMaintenancePreflightRecoveryMigrationProof } from "./production-maintenance-preflight-recovery-evidence.mjs";
const previousTargetSha = "5c1130adf37308e30e5c656f3d894e096cd65b7f", targetSha = "f".repeat(40);
const request = () => ({ targetSha, previousTargetSha }), createdAt = 1789236034129;
const file = "scripts/production-maintenance-control.mjs";
const diff = (name = file, oldBlob = "a".repeat(40)) => `:100644 100644 ${oldBlob} ${"b".repeat(40)} M\0${name}\0`;
// Names are the actual local checked-in directory, not a hand-made partial ledger.
const files = readdirSync(new URL("./supabase-migrations/", import.meta.url)).sort();
const catalog = files.filter(name => name.endsWith(".sql")).map(name => ({ version: name.slice(0, 12), name: name.slice(13, -4) }));
const tree = files.map(name => `100644 blob ${"c".repeat(40)}\t${name}\0`).join("");
function git(change = () => {}) {
  const calls = [];
  return { calls, run(args) {
    calls.push(args); const changed = change(args, calls); if (changed !== undefined) return changed;
    if (args[0] === "rev-parse") return targetSha + "\n";
    if (["status", "merge-base"].includes(args[0])) return "";
    if (args[0] === "diff") return diff();
    if (args[0] === "ls-tree") return tree;
    throw new Error("PRIVATE");
  } };
}
const safeError = /^Error: maintenance_preflight_recovery_evidence_unverified$/;
const ledger = () => ({ readOnly: true, databaseOid: 5, rows: catalog.map((row, index) => ({ ...row,
  appliedAt: index < 51 ? "2026-09-12T18:00:34.129000Z" : `2026-09-12T21:52:${38 + index - 51}.000000Z` })) });
const validate = (value, execute = git().run) => validateMaintenancePreflightRecoveryMigrationProof(value, 5, createdAt, request(), execute);

test("source allowlist is fixed to this flat preflight-recovery delta and both executing target checks are real", () => {
  const f = git(), result = readMaintenancePreflightRecoverySourceProof(request(), f.run);
  assert.match(result.sourceDiffDigest, /^[a-f0-9]{64}$/); assert.deepEqual(result.sourceChangedPaths, [file]);
  assert.equal(MAINTENANCE_PREFLIGHT_RECOVERY_SOURCE_PATHS.length, 25); assert.ok(Object.isFrozen(MAINTENANCE_PREFLIGHT_RECOVERY_SOURCE_PATHS));
  assert.equal(f.calls.filter(args => args[0] === "rev-parse").length, 2);
  assert.equal(f.calls.filter(args => args[0] === "status").length, 2);
  assert.deepEqual(f.calls[2], ["merge-base", "--is-ancestor", previousTargetSha, targetSha]);
  assert.ok(f.calls[3].includes("--no-ext-diff")); assert.ok(f.calls[3].includes("--no-textconv"));
});
test("source hash binds every blob but canonicalizes order; app, SQL, deps, old recovery and CI changes are refused", () => {
  const second = "scripts/production-maintenance-preflight-recovery.mjs";
  const proof = raw => readMaintenancePreflightRecoverySourceProof(request(), git(args => args[0] === "diff" ? raw : undefined).run);
  assert.deepEqual(proof(diff() + diff(second)), proof(diff(second) + diff()));
  assert.notEqual(proof(diff()).sourceDiffDigest, proof(diff(file, "d".repeat(40))).sourceDiffDigest);
  for (const raw of ["", diff("src/app/admin/AdminClient.tsx"), diff("scripts/supabase-migrations/202609090048_pages_client_write_acl.sql"),
    diff("package-lock.json"), diff("scripts/production-maintenance-recovery.mjs"), diff(".github/workflows/ci.yml"), diff() + diff(),
    diff().replace(" M\0", " D\0"), diff().replace(":100644", ":120000"), diff().replace(":100644 100644", ":100755 100644"), diff().slice(0, -1)]) {
    assert.throws(() => proof(raw), safeError);
  }
});
test("source drift, dirty tree, unknown base and hostile descriptor errors remain fixed and private", () => {
  for (const change of [(args, calls) => args[0] === "rev-parse" && calls.length > 4 ? previousTargetSha + "\n" : undefined,
    args => args[0] === "status" ? " M PRIVATE\n" : undefined,
    args => { if (args[0] === "merge-base") throw new Error("PRIVATE"); }]) {
    assert.throws(() => readMaintenancePreflightRecoverySourceProof(request(), git(change).run), safeError);
  }
  let accessed = 0;
  for (const value of [{ ...request(), previousTargetSha: "f".repeat(40) }, { ...request(), directory: "/arbitrary" }, new Proxy(request(), {}),
    { get targetSha() { accessed++; return targetSha; }, previousTargetSha }]) assert.throws(() => readMaintenancePreflightRecoverySourceProof(value, git().run), safeError);
  assert.equal(accessed, 0);
});
test("fixed complete readonly SQL and exact T10/new-target migration trees verify all 56 registrations through 048", () => {
  assert.match(MAINTENANCE_PREFLIGHT_RECOVERY_MIGRATION_SQL, /^BEGIN READ ONLY; SET LOCAL search_path=pg_catalog;/);
  assert.match(MAINTENANCE_PREFLIGHT_RECOVERY_MIGRATION_SQL, /SET LOCAL row_security=off/);
  assert.match(MAINTENANCE_PREFLIGHT_RECOVERY_MIGRATION_SQL, /ORDER BY version/);
  assert.match(MAINTENANCE_PREFLIGHT_RECOVERY_MIGRATION_SQL, /FROM public\.faolla_schema_migrations/);
  assert.match(MAINTENANCE_PREFLIGHT_RECOVERY_MIGRATION_SQL, /ROLLBACK;$/);
  assert.doesNotMatch(MAINTENANCE_PREFLIGHT_RECOVERY_MIGRATION_SQL, /\b(?:UPDATE|INSERT|DELETE|CREATE|ALTER|DROP|LIMIT)\b/);
  const value = ledger(), before = structuredClone(value), f = git(); assert.equal(catalog.length, 56);
  assert.match(validate(value, f.run), /^[a-f0-9]{64}$/); assert.deepEqual(value, before);
  assert.deepEqual(f.calls.filter(args => args[0] === "ls-tree"), [
    ["ls-tree", "-z", `${previousTargetSha}:scripts/supabase-migrations`], ["ls-tree", "-z", `${targetSha}:scripts/supabase-migrations`],
  ]);
  assert.equal(MAINTENANCE_PREFLIGHT_RECOVERY_MIGRATION_WINDOW.runId, "34721155156");
});
test("registry rejects missing/extra/non-prefix/renamed rows, changed source tree, invalid identity and any unknown columns", () => {
  for (const mutate of [v => { v.rows.pop(); }, v => { v.rows.shift(); }, v => { v.rows.push(v.rows[55]); },
    v => { [v.rows[0], v.rows[1]] = [v.rows[1], v.rows[0]]; }, v => { v.rows[55].name += "_other"; },
    v => { v.rows[10].version = "202609090049"; }, v => { v.readOnly = false; }, v => { v.databaseOid = 6; },
    v => { v.rows[55].extra = "PRIVATE"; }, v => { v.extra = true; }, v => { delete v.rows[0]; },
    v => { v.rows = new Proxy(v.rows, {}); }, v => { Object.defineProperty(v.rows, "0", { enumerable: true, get() { throw new Error("PRIVATE"); } }); }]) {
    const value = ledger(); mutate(value); assert.throws(() => validate(value), safeError);
  }
  assert.throws(() => validate(ledger(), git(args => args[0] === "ls-tree" && args[2].startsWith(targetSha) ? tree.replace("c".repeat(40), "d".repeat(40)) : undefined).run), safeError);
  assert.throws(() => validateMaintenancePreflightRecoveryMigrationProof(ledger(), 5, createdAt + 1, request(), git().run), safeError);
});
test("microsecond time proof requires old prefix predates maintenance and 044–048 only in this exact M apply step", () => {
  for (const [index, at] of [[0, "2026-09-12T18:00:34.129001Z"], [51, "2026-09-12T21:52:37.999999Z"],
    [55, "2026-09-12T21:52:46.000000Z"], [53, "2026-09-12T21:52:38.000001Z"], [0, "2026-02-30T18:00:34.000000Z"],
    [55, "2026-09-12T21:52:40.000Z"], [55, null]]) {
    const value = ledger(); value.rows[index].appliedAt = at; assert.throws(() => validate(value), safeError);
  }
  const a = ledger(), b = ledger(); b.rows[55].appliedAt = "2026-09-12T21:52:45.999999Z";
  assert.notEqual(validate(a), validate(b));
});
test("every explicit allowed file is accepted individually, no broad source prefix or permission change", () => {
  for (const path of MAINTENANCE_PREFLIGHT_RECOVERY_SOURCE_PATHS) {
    const f = git(args => args[0] === "diff" ? diff(path) : undefined);
    assert.deepEqual(readMaintenancePreflightRecoverySourceProof(request(), f.run).sourceChangedPaths, [path]);
  }
  for (const path of ["package.json", "scripts/production-maintenance-runtime.test.mjs", "scripts/production-maintenance-ingress.mjs",
    "scripts/production-maintenance-build-recovery.mjs", "scripts/../package.json", "docs/another.md"]) {
    assert.throws(() => readMaintenancePreflightRecoverySourceProof(request(), git(args => args[0] === "diff" ? diff(path) : undefined).run), safeError);
  }
  assert.throws(() => readMaintenancePreflightRecoverySourceProof(request(), git(args => args[0] === "diff" ? diff().replace("100644 100644", "100644 100755") : undefined).run), safeError);
});
