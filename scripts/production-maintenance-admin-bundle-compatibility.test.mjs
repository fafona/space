import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ADMIN_CHUNK_BUDGET_KB, ADMIN_TOTAL_BUDGET_KB, WEBPACK_ADMIN_ENTRY, measureAdminBundle } from "./check-admin-bundle-budget.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "faolla-admin-bundle-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => { const p = path.join(root, ".next", name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, value); return p; };
  const manifest = (data, scoped = false) => write(scoped ? "server/app/admin/page/react-loadable-manifest.json" : "react-loadable-manifest.json", JSON.stringify(data));
  const chunk = (name, bytes) => write(`static/chunks/${name}.js`, Buffer.alloc(bytes, 32));
  return { root, write, manifest, chunk };
}
const entry = (files) => ({ id: 54889, files });
test("fixed budget defaults remain 1250/760 KiB", () => { assert.equal(ADMIN_TOTAL_BUDGET_KB, 1250); assert.equal(ADMIN_CHUNK_BUDGET_KB, 760); });
test("webpack selects exact AdminClientLoader and ignores unrelated global imports", (t) => {
  const f = fixture(t); f.chunk("admin", 500); f.manifest({ unrelated: entry(["static/chunks/missing.js"]), [WEBPACK_ADMIN_ENTRY]: entry(["static/chunks/admin.js"]) });
  const result = measureAdminBundle(f.root); assert.equal(result.manifestKind, "webpack-global"); assert.equal(result.totalBytes, 500); assert.equal(result.withinBudget, true);
});
test("scoped manifest keeps original largest-entry semantics and takes precedence", (t) => {
  const f = fixture(t); f.chunk("small", 10); f.chunk("large", 200); f.manifest({ [WEBPACK_ADMIN_ENTRY]: entry(["static/chunks/small.js"]) }); f.manifest({ one: entry(["static/chunks/small.js"]), two: entry(["static/chunks/large.js"]) }, true);
  assert.equal(measureAdminBundle(f.root).totalBytes, 200); assert.equal(measureAdminBundle(f.root).manifestKind, "admin-scoped");
});
test("missing or renamed webpack admin entry is not replaced by an unrelated small entry", (t) => {
  const f = fixture(t); f.manifest({ "app/super-admin/SuperAdminClient.tsx -> unrelated": entry(["static/chunks/a.js"]) }); assert.throws(() => measureAdminBundle(f.root), /admin_bundle_entry_missing/);
});
test("missing manifest and malformed JSON fail", (t) => {
  const f = fixture(t); assert.throws(() => measureAdminBundle(f.root), /admin_bundle_manifest_missing/); f.write("react-loadable-manifest.json", "{"); assert.throws(() => measureAdminBundle(f.root), /admin_bundle_manifest_unverified/);
});
test("empty entry and missing referenced chunk fail", (t) => {
  const f = fixture(t); f.manifest({ [WEBPACK_ADMIN_ENTRY]: entry([]) }); assert.throws(() => measureAdminBundle(f.root), /admin_bundle_entry_unverified/); f.manifest({ [WEBPACK_ADMIN_ENTRY]: entry(["static/chunks/missing.js"]) }); assert.throws(() => measureAdminBundle(f.root), /admin_bundle_chunk_missing/);
});
test("chunk traversal, URLs and duplicate files fail", (t) => {
  const f = fixture(t); for (const files of [["static/chunks/../../../outside.js"], ["https://example.invalid/a.js"], ["static/chunks/a.js", "static/chunks/a.js"]]) { f.manifest({ [WEBPACK_ADMIN_ENTRY]: entry(files) }); assert.throws(() => measureAdminBundle(f.root), /admin_bundle_(?:chunk_path|entry)_unverified/); }
});
test("total and largest-chunk limits are independently enforced", (t) => {
  const f = fixture(t); f.chunk("a", 700 * 1024); f.chunk("b", 600 * 1024); f.manifest({ [WEBPACK_ADMIN_ENTRY]: entry(["static/chunks/a.js", "static/chunks/b.js"]) }); assert.equal(measureAdminBundle(f.root).withinBudget, false);
  f.chunk("c", 761 * 1024); f.manifest({ [WEBPACK_ADMIN_ENTRY]: entry(["static/chunks/c.js"]) }); assert.equal(measureAdminBundle(f.root).withinBudget, false);
});
test("exact thresholds pass while nonfinite budget configuration fails", (t) => {
  const f = fixture(t); f.chunk("a", 760 * 1024); f.chunk("b", 490 * 1024); f.manifest({ [WEBPACK_ADMIN_ENTRY]: entry(["static/chunks/a.js", "static/chunks/b.js"]) }); assert.equal(measureAdminBundle(f.root).withinBudget, true); for (const value of [NaN, Infinity, 0, -1]) assert.throws(() => measureAdminBundle(f.root, { totalBudgetKb: value }), /admin_bundle_budget_invalid/);
});
test("CLI preserves nonzero exit on measured oversized admin entry", (t) => {
  const f = fixture(t); f.chunk("big", 800 * 1024); f.manifest({ [WEBPACK_ADMIN_ENTRY]: entry(["static/chunks/big.js"]) });
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./check-admin-bundle-budget.mjs", import.meta.url))], { cwd: f.root, env: { ...process.env, ADMIN_ASYNC_BUNDLE_BUDGET_KB: "1250", ADMIN_ASYNC_CHUNK_BUDGET_KB: "760" }, encoding: "utf8" }); assert.equal(result.status, 1); assert.match(result.stderr, /Budget exceeded/);
});
test("symlinked chunks cannot escape the build tree", { skip: process.platform === "win32" }, (t) => {
  const f = fixture(t), target = f.chunk("outside", 100); fs.symlinkSync(target, path.join(f.root, ".next/static/chunks/link.js")); f.manifest({ [WEBPACK_ADMIN_ENTRY]: entry(["static/chunks/link.js"]) }); assert.throws(() => measureAdminBundle(f.root), /admin_bundle_file_unverified/);
});
