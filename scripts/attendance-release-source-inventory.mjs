import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { discoverLocalTests } from "./run-local-tests.mjs";
import { partitionCiTests } from "./run-ci-tests.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
export const snapshotPath = "docs/attendance-release-source-scope-20261009.json";
const testPattern = /\.(?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/;
export const reviewedTrackedPaths = Object.freeze([
  "middleware.ts", "package.json",
  "scripts/check-supabase-migrations.mjs", "scripts/check-supabase-migrations.test.mjs",
  "scripts/merchant-enterprise-invitation-application-contract.test.mjs",
  "scripts/merchant-enterprise-membership-selector-ui-contract.test.mjs",
  "scripts/merchant-enterprise-ui-contract.test.mjs", "scripts/supabase-migrations/README.md",
  "src/app/admin/AdminClient.tsx",
  "src/app/api/merchant-enterprise/employees/accept/route-handler.ts",
  "src/app/api/merchant-enterprise/employees/route-handler.ts",
  "src/app/api/merchant-enterprise/invitations/initial-password/route-handler.ts",
  "src/app/api/merchant-enterprise/overview/route-handler.ts",
  "src/app/enterprise/EnterpriseSelectorClient.tsx",
  "src/app/enterprise/[siteId]/EnterprisePortalClient.tsx",
  "src/app/super-admin/SuperAdminClient.contract.test.ts", "src/app/super-admin/SuperAdminClient.tsx",
  "src/components/admin/MerchantEnterpriseManager.tsx", "src/components/enterprise/MerchantEmployeeWorkspace.tsx",
  "src/data/platformControlStore.test.ts", "src/data/platformControlStore.ts",
  "src/lib/merchantEnterprise.test.ts", "src/lib/merchantEnterprise.ts",
  "src/lib/merchantEnterpriseAuth.server.test.ts", "src/lib/merchantEnterpriseAuth.server.ts",
  "src/lib/merchantEnterpriseStore.server.ts", "src/lib/merchantEnterpriseSupabase.ts",
  "src/lib/platformAdminBackupValidation.test.ts", "src/lib/platformMerchantUserManageAtomic.server.test.ts",
]);
const trackedPaths = new Set(reviewedTrackedPaths);
const extraEnterpriseSource = new Set([
  "src/app/api/merchant-enterprise/employees/accept/route.test.ts",
  "src/app/api/merchant-enterprise/invitations/initial-password/route.default.test.ts",
  "src/app/api/merchant-enterprise/roles/route-handler.ts",
  "src/lib/merchantEmployeeRootLeaveGuard.test.ts", "src/lib/merchantEmployeeRootLeaveGuard.ts",
  "src/lib/merchantEnterpriseAuthEvents.sdk.test.ts", "src/lib/merchantEnterpriseAuthEvents.test.ts",
  "src/lib/merchantEnterpriseAuthEvents.ts",
  "src/lib/merchantEnterpriseInvitationRecovery.server.test.ts", "src/lib/merchantEnterpriseInvitationRecovery.server.ts",
  "src/lib/merchantEnterpriseInvitationSession.test.ts", "src/lib/merchantEnterpriseInvitationSession.ts",
  "src/lib/merchantEnterpriseLogout.test.ts", "src/lib/merchantEnterpriseLogout.ts",
]);
const extraEnterpriseChecks = new Set([
  "scripts/merchant-enterprise-authorization-ui.test.mjs",
  "scripts/merchant-enterprise-logout-browser-check.mjs",
]);
const extraCiSupport = new Set([
  "scripts/attendance-recovery-content-contract.mjs", "scripts/attendance-recovery-content-contract.test.mjs",
  "scripts/attendance-self-browser-harness.mjs",
]);

function safeRelativePath(value) {
  if (typeof value !== "string" || !value || value.includes("\\") || path.posix.isAbsolute(value)
    || /^[A-Za-z]:/.test(value) || value.includes("\0")
    || value.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("attendance_scope_path_invalid");
  }
  return value;
}

/** Classify names before reading any contents. Exclusions are not deleted. */
export function classifyAttendanceChange(value) {
  const file = safeRelativePath(value);
  const parts = file.toLowerCase().split("/");
  if (parts.some((part) => [".git", ".runtime", ".tmp", ".next", "node_modules", "credentials", "secrets"].includes(part))
    || parts.some((part) => part === ".env" || part.startsWith(".env."))
    || /\.(?:pem|key|p12|pfx|kdbx|sqlite|db|bak)$/i.test(file)) {
    return { category: "excluded-sensitive-or-generated", readContents: false };
  }
  if (file.startsWith("public/downloads/") || /\.(?:png|jpe?g|webp|zip|tgz|tar|gz|exe|msi|mp4)$/i.test(file)) {
    return { category: "excluded-generated-artifact", readContents: false };
  }
  if (file === snapshotPath) return { category: "snapshot-self", readContents: false };
  if (/^scripts\/manual-storage-/.test(file) || /^docs\/(?:manual-storage-|online-artifact-reclaim-)/.test(file)) {
    return { category: "excluded-unrelated-storage-work", readContents: false };
  }
  if (/^scripts\/attendance-release-source-inventory(?:\.test)?\.mjs$/.test(file)
    || file === "scripts/attendance-production-database-migrations.manifest.json"
    || file === "docs/attendance-production-release-scope-20261009.json") {
    return { category: "release-review-metadata", readContents: true };
  }
  if (file === "scripts/attendance-production-database-migrations.test.mjs"
    || file === "scripts/attendance-online-build.test.mjs") {
    return { category: "unit-or-contract-test", readContents: true };
  }
  if (file === "scripts/attendance-production-database-migrations.mjs"
    || file === "scripts/attendance-online-build.mjs"
    || file === "scripts/online-traffic-release-policy.mjs") {
    return { category: "release-operation-source", readContents: true };
  }
  if (file === "next.config.ts" || file === "scripts/attendance-build-worker-config.test.mjs") {
    return { category: testPattern.test(file) ? "unit-or-contract-test" : "opt-in-build-resource-configuration", readContents: true };
  }
  if (/^scripts\/(?:attendance-(?:isolated-pilot|local-preview|pilot-app)|package-attendance-pilot)/.test(file)) {
    return { category: "local-or-isolated-pilot-tooling", readContents: true };
  }
  if (/^scripts\/supabase-migrations\/\d{12}_merchant_(?:attendance_|employee_initial_password_)[^/]+\.sql$/.test(file)) {
    return { category: "database-migration", readContents: true };
  }
  if (file === "scripts/supabase-migrations/README.md"
    || /^docs\/(?:employee-attendance-|attendance-local-pg-)[^/]+\.md$/.test(file)) {
    return { category: "feature-documentation", readContents: true };
  }
  if (/^scripts\/fixtures\/attendance[^/]*\.(?:[cm]?[jt]sx?|sql|json)$/.test(file)
    || /^src\/lib\/merchantAttendance[^/]*TestFixtures\.ts$/.test(file)) {
    return { category: "ci-fixture-source", readContents: true };
  }
  if (trackedPaths.has(file) || extraEnterpriseSource.has(file)
    || /^src\/(?:app|components|lib)\/.*attendance/i.test(file)) {
    return { category: testPattern.test(file) ? "unit-or-contract-test" :
      file.startsWith("scripts/") ? "ci-support-source" : "application-source", readContents: true };
  }
  if (/^scripts\/run-merchant-attendance-reminders(?:\.test)?\.ts$/.test(file)) {
    return { category: testPattern.test(file) ? "unit-or-contract-test" : "background-worker-source", readContents: true };
  }
  if (/^scripts\/merchant-attendance-[^/]+\.(?:[cm]?[jt]sx?)$/.test(file)
    || extraEnterpriseChecks.has(file) || extraCiSupport.has(file)) {
    return { category: testPattern.test(file) ? "unit-or-contract-test" : "ci-support-source", readContents: true };
  }
  return { category: "unreviewed-change", readContents: false };
}

export function parseGitChangeStatus(raw) {
  const records = raw.split("\0");
  const result = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (!record) continue;
    if (record.length < 4 || record[2] !== " ") throw new Error("attendance_scope_git_status_invalid");
    const status = record.slice(0, 2);
    if (/[RD]/.test(status)) throw new Error("attendance_scope_rename_or_delete_needs_review");
    result.push({ status, path: safeRelativePath(record.slice(3)) });
  }
  if (new Set(result.map((entry) => entry.path)).size !== result.length) {
    throw new Error("attendance_scope_duplicate_change");
  }
  return result.sort((a, b) => a.path.localeCompare(b.path, "en"));
}

function readPhysicalSource(root, relative) {
  const target = path.join(root, ...safeRelativePath(relative).split("/"));
  let current = root;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error(`attendance_scope_link_refused:${relative}`);
  }
  const resolved = realpathSync(target);
  const rel = path.relative(root, resolved);
  if (!rel || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error("attendance_scope_path_escape");
  const metadata = lstatSync(target);
  if (!metadata.isFile() || metadata.nlink !== 1 || metadata.size > 16 * 1024 * 1024) {
    throw new Error(`attendance_scope_file_invalid:${relative}`);
  }
  const content = readFileSync(target);
  return { bytes: content.length, sha256: createHash("sha256").update(content).digest("hex") };
}

/** Read-only review inventory. No install, copy, write, build, DB or release side effects. */
export function collectAttendanceReleaseScope(rootDirectory = repositoryRoot) {
  const root = realpathSync(rootDirectory);
  const git = (arguments_) => execFileSync("git", arguments_, { cwd: root, encoding: "utf8", windowsHide: true });
  const rawStatus = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const changes = parseGitChangeStatus(rawStatus);
  const tests = discoverLocalTests(root);
  const groups = partitionCiTests(tests);
  const testGroups = new Map(Object.entries(groups).flatMap(([group, files]) => files.map((file) => [file, group])));
  const files = changes.map((entry) => {
    const classification = classifyAttendanceChange(entry.path);
    const isTest = testPattern.test(entry.path);
    if (isTest && classification.readContents && !testGroups.has(entry.path)) {
      throw new Error(`attendance_scope_ci_test_missing:${entry.path}`);
    }
    return { ...entry, category: classification.category, contentsInventoried: classification.readContents,
      test: isTest, ...(isTest && testGroups.has(entry.path) ? { ciPartition: testGroups.get(entry.path) } : {}),
      ...(classification.readContents ? readPhysicalSource(root, entry.path) : {}) };
  });
  const counts = {};
  for (const entry of files) counts[entry.category] = (counts[entry.category] ?? 0) + 1;
  return {
    schemaVersion: 1, purpose: "attendance-source-review-snapshot", generatedAt: new Date().toISOString(),
    repositoryHead: git(["rev-parse", "HEAD"]).trim(),
    gitStatusSha256: createHash("sha256").update(rawStatus).digest("hex"),
    releaseAuthorization: false, databaseUpgradeExecuted: false, buildExecuted: false,
    fullProductionArtifact: false, sourcePackagerMustNotBeUsedForProduction: true,
    preserveExistingProductionAssets: ["public/", "public/downloads/", "public/fonts/qr/"],
    excludedPathsAreNotDeleted: true, ignoredSecretsOrRuntimeFilesRead: false,
    notes: [
      "This is an exact changed-source audit snapshot, not a production archive or deployment authorization.",
      "CI fixture and mock harness SOURCE must remain available to the tests that import it; generated harness artifacts are excluded.",
      "Local/pilot tooling is separately classified and does not enter production application routes.",
      "All current discovered unit/contract tests are partitioned exactly once by the existing mandatory CI workflow.",
      "Migration order, production backup, old-client compatibility and disposable DB acceptance remain independent release gates.",
      "Ignored .env, .runtime, credentials, installed dependencies and production data were not read or copied.",
    ],
    counts, totalChanges: files.length,
    reviewedContentBytes: files.reduce((sum, file) => sum + (file.bytes ?? 0), 0),
    ci: { totalDiscovered: tests.length,
      partitionCounts: Object.fromEntries(Object.entries(groups).map(([name, members]) => [name, members.length])),
      changedTests: files.filter((file) => file.test).length,
      inventoriedChangedTests: files.filter((file) => file.test && file.contentsInventoried).length },
    files,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 3 || process.argv[2] !== "--json") {
    process.stderr.write("attendance_scope_invocation_requires_read_only_json\n");
    process.exitCode = 1;
  } else {
    try { process.stdout.write(`${JSON.stringify(collectAttendanceReleaseScope(), null, 2)}\n`); }
    catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
  }
}
