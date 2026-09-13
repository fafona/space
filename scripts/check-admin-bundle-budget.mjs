import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const WEBPACK_ADMIN_ENTRY = "app/admin/AdminClientLoader.tsx -> ./AdminClient";
export const ADMIN_TOTAL_BUDGET_KB = 1250;
export const ADMIN_CHUNK_BUDGET_KB = 760;

const fail = (code) => { throw new Error(code); };
function regularFile(filePath, maxBytes, missingCode) {
  let stat;
  try { stat = fs.lstatSync(filePath); } catch (error) {
    if (error.code === "ENOENT") fail(missingCode);
    fail("admin_bundle_file_unverified");
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maxBytes || fs.realpathSync(filePath) !== filePath) fail("admin_bundle_file_unverified");
  return stat;
}

export function measureAdminBundle(rootDir, {
  totalBudgetKb = ADMIN_TOTAL_BUDGET_KB,
  largestChunkBudgetKb = ADMIN_CHUNK_BUDGET_KB,
} = {}) {
  if (![totalBudgetKb, largestChunkBudgetKb].every((value) => Number.isFinite(value) && value > 0)) fail("admin_bundle_budget_invalid");
  const root = path.resolve(rootDir);
  const scopedPath = path.join(root, ".next/server/app/admin/page/react-loadable-manifest.json");
  let scoped = true;
  try { fs.lstatSync(scopedPath); } catch (error) {
    if (error.code !== "ENOENT") fail("admin_bundle_manifest_unverified");
    scoped = false;
  }
  const manifestPath = scoped ? scopedPath : path.join(root, ".next/react-loadable-manifest.json");
  regularFile(manifestPath, 8388608, "admin_bundle_manifest_missing");
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch { fail("admin_bundle_manifest_unverified"); }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || Object.keys(manifest).length > 10000) fail("admin_bundle_manifest_unverified");
  // A Turbopack per-admin manifest already scopes the entries. Webpack emits a
  // global manifest: only this exact AdminClientLoader import represents the
  // same admin async entry, never a smaller unrelated global entry.
  const selected = scoped
    ? Object.values(manifest).filter((entry) => entry && Array.isArray(entry.files) && entry.files.length > 0)
    : Object.hasOwn(manifest, WEBPACK_ADMIN_ENTRY) ? [manifest[WEBPACK_ADMIN_ENTRY]] : [];
  if (selected.length === 0) fail("admin_bundle_entry_missing");
  const entries = selected.map((entry) => {
    if (!entry || !Array.isArray(entry.files) || entry.files.length < 1 || entry.files.length > 1000 || new Set(entry.files).size !== entry.files.length) fail("admin_bundle_entry_unverified");
    const files = entry.files.map((file) => {
      if (typeof file !== "string" || !/^static\/(?:chunks|css)\/[a-zA-Z0-9_./-]+\.(?:js|css)$/.test(file) || file.split("/").some((part) => part === "." || part === ".." || part === "")) fail("admin_bundle_chunk_path_unverified");
      const filePath = path.join(root, ".next", file);
      const stat = regularFile(filePath, 67108864, "admin_bundle_chunk_missing");
      return { file, bytes: stat.size };
    });
    return { id: String(entry.id ?? ""), files, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0) };
  });
  const adminEntry = entries.sort((left, right) => right.totalBytes - left.totalBytes)[0];
  const largestChunk = [...adminEntry.files].sort((left, right) => right.bytes - left.bytes)[0];
  const totalKb = adminEntry.totalBytes / 1024;
  const largestChunkKb = largestChunk.bytes / 1024;
  return {
    manifestKind: scoped ? "admin-scoped" : "webpack-global",
    id: adminEntry.id,
    fileCount: adminEntry.files.length,
    totalBytes: adminEntry.totalBytes,
    largestChunkBytes: largestChunk.bytes,
    totalKb, largestChunkKb, totalBudgetKb, largestChunkBudgetKb,
    withinBudget: totalKb <= totalBudgetKb && largestChunkKb <= largestChunkBudgetKb,
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = measureAdminBundle(process.cwd(), {
      totalBudgetKb: Number(process.env.ADMIN_ASYNC_BUNDLE_BUDGET_KB || 1250),
      largestChunkBudgetKb: Number(process.env.ADMIN_ASYNC_CHUNK_BUDGET_KB || 760),
    });
    console.log(`[admin-bundle-budget] async entry ${result.totalKb.toFixed(1)} KB / ${result.totalBudgetKb} KB; largest chunk ${result.largestChunkKb.toFixed(1)} KB / ${result.largestChunkBudgetKb} KB`);
    if (!result.withinBudget) {
      console.error("[admin-bundle-budget] Budget exceeded.");
      process.exitCode = 1;
    }
  } catch (error) {
    const message = typeof error?.message === "string" && /^admin_bundle_[a-z_]+$/.test(error.message) ? error.message : "admin_bundle_unverified";
    console.error(`[admin-bundle-budget] ${message}`);
    process.exitCode = 1;
  }
}
