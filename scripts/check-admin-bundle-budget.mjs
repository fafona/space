import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const manifestPath = path.join(
  rootDir,
  ".next",
  "server",
  "app",
  "admin",
  "page",
  "react-loadable-manifest.json",
);
const totalBudgetKb = Number(process.env.ADMIN_ASYNC_BUNDLE_BUDGET_KB || 1250);
const largestChunkBudgetKb = Number(process.env.ADMIN_ASYNC_CHUNK_BUDGET_KB || 760);

if (!fs.existsSync(manifestPath)) {
  console.error(`[admin-bundle-budget] Missing build manifest: ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const entries = Object.values(manifest)
  .filter((entry) => entry && Array.isArray(entry.files) && entry.files.length > 0)
  .map((entry) => {
    const files = entry.files.map((file) => {
      const filePath = path.join(rootDir, ".next", file);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Missing admin bundle file: ${file}`);
      }
      return {
        file,
        bytes: fs.statSync(filePath).size,
      };
    });
    return {
      id: String(entry.id ?? ""),
      files,
      totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    };
  });

if (entries.length === 0) {
  console.error("[admin-bundle-budget] No admin async entries found.");
  process.exit(1);
}

const adminEntry = entries.sort((left, right) => right.totalBytes - left.totalBytes)[0];
const largestChunk = [...adminEntry.files].sort((left, right) => right.bytes - left.bytes)[0];
const totalKb = adminEntry.totalBytes / 1024;
const largestChunkKb = largestChunk.bytes / 1024;

console.log(
  `[admin-bundle-budget] async entry ${totalKb.toFixed(1)} KB / ${totalBudgetKb} KB; ` +
    `largest chunk ${largestChunkKb.toFixed(1)} KB / ${largestChunkBudgetKb} KB`,
);

if (totalKb > totalBudgetKb || largestChunkKb > largestChunkBudgetKb) {
  console.error(
    `[admin-bundle-budget] Budget exceeded. Largest file: ${largestChunk.file}`,
  );
  process.exit(1);
}
