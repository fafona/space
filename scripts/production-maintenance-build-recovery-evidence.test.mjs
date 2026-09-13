import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { MAINTENANCE_ROUTE_BUILD_ROUTE_PATHS, MAINTENANCE_ROUTE_BUILD_TEST_PATHS } from "./production-maintenance-route-build-evidence.mjs";
import { MAINTENANCE_BUILD_RECOVERY_SOURCE_PATHS, MAINTENANCE_BUILD_RECOVERY_MIGRATION_WINDOW,
  MAINTENANCE_BUILD_RECOVERY_MIGRATION_SQL, readMaintenanceBuildRecoverySourceProof,
  validateMaintenanceBuildRecoveryMigrationProof } from "./production-maintenance-build-recovery-evidence.mjs";
const previousTargetSha = "46f007fbd9e417f93c01e398c77cf38ec814547d", targetSha = "f".repeat(40);
const request = () => ({ targetSha, previousTargetSha }), createdAt = 1789236034129;
const file = "scripts/production-maintenance-control.mjs";
const diff = (name = file, oldBlob = "a".repeat(40)) => `:100644 100644 ${oldBlob} ${"b".repeat(40)} M\0${name}\0`;
// Names are the actual local checked-in directory, not a hand-made partial ledger.
const files = readdirSync(new URL("./supabase-migrations/", import.meta.url)).sort();
const catalog = files.filter(name => name.endsWith(".sql")).map(name => ({ version: name.slice(0, 12), name: name.slice(13, -4) }));
const tree = files.map(name => `100644 blob ${"c".repeat(40)}\t${name}\0`).join("");
const nextPackage = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const nextLock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const oldPackage = structuredClone(nextPackage), oldLock = structuredClone(nextLock);
oldPackage.scripts.build = "npm run check:env:strict && npm run check:v1-deploy-config && next build && npm run check:bundle:admin";
delete oldPackage.devDependencies["@next/swc-wasm-nodejs"];
delete oldLock.packages[""].devDependencies["@next/swc-wasm-nodejs"];
delete oldLock.packages["node_modules/@next/swc-wasm-nodejs"];
const manifest = name => diff(name);
const routeBodies = new Map(), routeChanges = [];
const blob = text => createHash("sha1").update("blob " + Buffer.byteLength(text) + "\0").update(text).digest("hex");
const source = file => readFileSync(new URL("../" + file, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const changeBody = (file, before, after) => {
  if (before !== null) routeBodies.set(previousTargetSha + ":" + file, before);
  routeBodies.set(targetSha + ":" + file, after);
  routeChanges.push(`:${before === null ? "000000" : "100644"} 100644 ${before === null ? "0".repeat(40) : blob(before)} ${blob(after)} ${before === null ? "A" : "M"}\0${file}\0`);
};
for (const file of MAINTENANCE_ROUTE_BUILD_ROUTE_PATHS) {
  const handler = file.replace(/route\.ts$/, "route-handler.ts");
  changeBody(file, source(handler), source(file)); changeBody(handler, null, source(handler));
}
for (const file of MAINTENANCE_ROUTE_BUILD_TEST_PATHS) {
  const after = source(file); let before = after;
  for (const route of MAINTENANCE_ROUTE_BUILD_ROUTE_PATHS) {
    const base = route.slice(0, -3), relative = path.posix.relative(path.posix.dirname(file), base);
    for (const value of [base, "@/" + base.slice(4), relative, ...(relative.startsWith(".") ? [] : ["./" + relative])]) {
      for (const quote of ['"', "'"]) for (const extension of ["", ".ts"]) {
        before = before.split(quote + value + "-handler" + extension + quote).join(quote + value + extension + quote);
      }
    }
  }
  changeBody(file, before, after);
}
const requiredDiff = () => manifest("package.json") + manifest("package-lock.json") + routeChanges.join("");
function git(change = () => {}) {
  const calls = [];
  return { calls, run(args) {
    calls.push(args); const changed = change(args, calls); if (changed !== undefined) return changed;
    if (args[0] === "rev-parse") return targetSha + "\n";
    if (["status", "merge-base"].includes(args[0])) return "";
    if (args[0] === "diff") return diff() + requiredDiff();
    if (args[0] === "show") return routeBodies.get(args[1]) ?? JSON.stringify(args[1] === previousTargetSha + ":package.json" ? oldPackage : args[1] === previousTargetSha + ":package-lock.json" ? oldLock : args[1] === targetSha + ":package.json" ? nextPackage : nextLock);
    if (args[0] === "ls-tree") return tree;
    throw new Error("PRIVATE");
  } };
}
const safeError = /^Error: maintenance_build_recovery_evidence_unverified$/;
const ledger = () => ({ readOnly: true, databaseOid: 5, rows: catalog.map((row, index) => ({ ...row,
  appliedAt: index < 51 ? "2026-09-12T18:00:34.129000Z" : `2026-09-12T21:52:${38 + index - 51}.000000Z` })) });
const validate = (value, execute = git().run) => validateMaintenanceBuildRecoveryMigrationProof(value, 5, createdAt, request(), execute);

test("source allowlist is fixed to this maintenance/build delta and both executing target checks are real", () => {
  const f = git(), result = readMaintenanceBuildRecoverySourceProof(request(), f.run);
  assert.match(result.sourceDiffDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.sourceChangedPaths, ["package-lock.json", "package.json", file,
    ...MAINTENANCE_ROUTE_BUILD_ROUTE_PATHS.flatMap(p => [p, p.replace(/route\.ts$/, "route-handler.ts")]),
    ...MAINTENANCE_ROUTE_BUILD_TEST_PATHS].sort());
  assert.equal(MAINTENANCE_BUILD_RECOVERY_SOURCE_PATHS.length, 175); assert.ok(Object.isFrozen(MAINTENANCE_BUILD_RECOVERY_SOURCE_PATHS));
  assert.equal(f.calls.filter(args => args[0] === "rev-parse").length, 2);
  assert.equal(f.calls.filter(args => args[0] === "status").length, 2);
  assert.deepEqual(f.calls[2], ["merge-base", "--is-ancestor", previousTargetSha, targetSha]);
  assert.ok(f.calls[3].includes("--no-ext-diff")); assert.ok(f.calls[3].includes("--no-textconv"));
});
test("source hash binds every blob but canonicalizes order; unrelated app, SQL, old recovery and CI changes are refused", () => {
  const second = "scripts/production-maintenance-build-recovery.mjs";
  const proof = raw => readMaintenanceBuildRecoverySourceProof(request(), git(args => args[0] === "diff" ? raw + requiredDiff() : undefined).run);
  assert.deepEqual(proof(diff() + diff(second)), proof(diff(second) + diff()));
  assert.notEqual(proof(diff()).sourceDiffDigest, proof(diff(file, "d".repeat(40))).sourceDiffDigest);
  for (const raw of [diff("src/app/admin/AdminClient.tsx"), diff("scripts/supabase-migrations/202609090048_pages_client_write_acl.sql"),
    diff("package-lock.json"), diff("scripts/production-maintenance-recovery.mjs"), diff(".github/workflows/ci.yml"), diff() + diff(),
    diff().replace(" M\0", " D\0"), diff().replace(":100644", ":120000"), diff().replace(":100644 100644", ":100755 100644"), diff().slice(0, -1)]) {
    assert.throws(() => proof(raw), safeError);
  }
});
test("source drift, dirty tree, unknown base and hostile descriptor errors remain fixed and private", () => {
  for (const change of [(args, calls) => args[0] === "rev-parse" && calls.length > 4 ? previousTargetSha + "\n" : undefined,
    args => args[0] === "status" ? " M PRIVATE\n" : undefined,
    args => { if (args[0] === "merge-base") throw new Error("PRIVATE"); }]) {
    assert.throws(() => readMaintenanceBuildRecoverySourceProof(request(), git(change).run), safeError);
  }
  let accessed = 0;
  for (const value of [{ ...request(), previousTargetSha: "e".repeat(40) }, { ...request(), directory: "/arbitrary" }, new Proxy(request(), {}),
    { get targetSha() { accessed++; return targetSha; }, previousTargetSha }]) assert.throws(() => readMaintenanceBuildRecoverySourceProof(value, git().run), safeError);
  assert.equal(accessed, 0);
});
test("fixed complete readonly SQL and exact T3/T4 migration trees verify all 56 registrations through 048", () => {
  assert.match(MAINTENANCE_BUILD_RECOVERY_MIGRATION_SQL, /^BEGIN READ ONLY; SET LOCAL search_path=pg_catalog;/);
  assert.match(MAINTENANCE_BUILD_RECOVERY_MIGRATION_SQL, /SET LOCAL row_security=off/);
  assert.match(MAINTENANCE_BUILD_RECOVERY_MIGRATION_SQL, /ORDER BY version/);
  assert.match(MAINTENANCE_BUILD_RECOVERY_MIGRATION_SQL, /FROM public\.faolla_schema_migrations/);
  assert.match(MAINTENANCE_BUILD_RECOVERY_MIGRATION_SQL, /ROLLBACK;$/);
  assert.doesNotMatch(MAINTENANCE_BUILD_RECOVERY_MIGRATION_SQL, /\b(?:UPDATE|INSERT|DELETE|CREATE|ALTER|DROP|LIMIT)\b/);
  const value = ledger(), before = structuredClone(value), f = git(); assert.equal(catalog.length, 56);
  assert.match(validate(value, f.run), /^[a-f0-9]{64}$/); assert.deepEqual(value, before);
  assert.deepEqual(f.calls.filter(args => args[0] === "ls-tree"), [
    ["ls-tree", "-z", `${previousTargetSha}:scripts/supabase-migrations`], ["ls-tree", "-z", `${targetSha}:scripts/supabase-migrations`],
  ]);
  assert.equal(MAINTENANCE_BUILD_RECOVERY_MIGRATION_WINDOW.runId, "34721155156");
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
  assert.throws(() => validateMaintenanceBuildRecoveryMigrationProof(ledger(), 5, createdAt + 1, request(), git().run), safeError);
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

test("only the reviewed build command and one exact integrity-pinned dependency delta is accepted", () => {
  for (const which of ["package", "lock"]) for (const change of [
    value => { value.version = "99.0.0"; },
    value => { if (which === "package") value.dependencies.next = "16.3.5"; else value.packages["node_modules/next"].version = "16.3.5"; },
    value => { if (which === "package") value.scripts.build = "next build --webpack"; else value.packages["node_modules/@next/swc-wasm-nodejs"].integrity = "sha512-" + "a".repeat(86) + "=="; },
    value => { if (which === "package") value.devDependencies["@next/swc-wasm-nodejs"] = "^16.3.4"; else value.packages["node_modules/@next/swc-wasm-nodejs"].optional = true; },
  ]) {
    const value = structuredClone(which === "package" ? nextPackage : nextLock); change(value);
    const file = which === "package" ? "package.json" : "package-lock.json";
    assert.throws(() => readMaintenanceBuildRecoverySourceProof(request(), git(args => args[0] === "show" && args[1] === targetSha + ":" + file ? JSON.stringify(value) : undefined).run), safeError);
  }
  for (const raw of [diff(), diff("package.json"), diff("package-lock.json"), ""]) {
    assert.throws(() => readMaintenanceBuildRecoverySourceProof(request(), git(args => args[0] === "diff" ? raw : undefined).run), safeError);
  }
});
