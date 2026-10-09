import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyAttendanceChange, parseGitChangeStatus, reviewedTrackedPaths, snapshotPath } from "./attendance-release-source-inventory.mjs";
import { discoverLocalTests } from "./run-local-tests.mjs";
import { partitionCiTests } from "./run-ci-tests.mjs";

test("reviewed existing enterprise changes have an explicit bounded inventory", () => {
  assert.equal(reviewedTrackedPaths.length, 29);
  assert.equal(new Set(reviewedTrackedPaths).size, 29);
  for (const file of reviewedTrackedPaths) assert.equal(classifyAttendanceChange(file).readContents, true, file);
  assert.equal(classifyAttendanceChange("src/app/admin/Unrelated.tsx").category, "unreviewed-change");
});

test("names are classified before any credential, runtime or generated artifact can be read", () => {
  for (const file of [".env", ".env.production", ".runtime/state.json", ".tmp/attendance/image.png",
    "scripts/credentials/access.json", "scripts/secrets/auth.json", "key.pem", "archive.db", "node_modules/pkg/index.js",
    "public/downloads/setup.exe", "docs/attendance-screenshot.png", snapshotPath,
    "scripts/manual-storage-reclaim-20260929.mjs"]) {
    assert.equal(classifyAttendanceChange(file).readContents, false, file);
  }
  for (const file of ["../secret", "src/../secret", "src//file", "C:/file", "/file", "src\\file", ""]) {
    assert.throws(() => classifyAttendanceChange(file), /attendance_scope_path_invalid/);
  }
  assert.equal(classifyAttendanceChange("src/lib/merchantAttendanceCredentials.server.ts").category, "application-source");
});

test("database source, CI fixture code and local-only tooling cannot be confused with deployable application routes", () => {
  const examples = new Map([
    ["scripts/supabase-migrations/202610090210_merchant_attendance_utc_validation_fastpath.sql", "database-migration"],
    ["scripts/supabase-migrations/202610020114_merchant_employee_initial_password_replay.sql", "database-migration"],
    ["src/lib/merchantAttendanceApplicationWindowTestFixtures.ts", "ci-fixture-source"],
    ["scripts/fixtures/attendance-plan-exception-contract.json", "ci-fixture-source"],
    ["scripts/fixtures/attendance-plan-posthoc-formal-cases.test.ts", "ci-fixture-source"],
    ["scripts/attendance-local-preview.mjs", "local-or-isolated-pilot-tooling"],
    ["scripts/package-attendance-pilot-app.mjs", "local-or-isolated-pilot-tooling"],
    ["scripts/attendance-isolated-pilot/compose.yaml", "local-or-isolated-pilot-tooling"],
    ["src/app/api/merchant-attendance/self/route.ts", "application-source"],
    ["scripts/merchant-attendance-event-channels-shell-transport.test.ts", "unit-or-contract-test"],
    ["scripts/run-merchant-attendance-reminders.ts", "background-worker-source"],
    ["next.config.ts", "opt-in-build-resource-configuration"],
    ["scripts/attendance-build-worker-config.test.mjs", "unit-or-contract-test"],
  ]);
  for (const [file, category] of examples) assert.equal(classifyAttendanceChange(file).category, category, file);
});

test("NUL-delimited Git paths preserve spaces and refuse deletion, rename, duplicates and escapes", () => {
  assert.deepEqual(parseGitChangeStatus(" M src/file with space.ts\0?? scripts/new.test.mjs\0"), [
    { status: "??", path: "scripts/new.test.mjs" }, { status: " M", path: "src/file with space.ts" },
  ]);
  for (const raw of [" D src/deleted.ts\0", "R  src/new.ts\0src/old.ts\0", "?? ../secret\0", "?? a\0?? a\0", "bad\0"]) {
    assert.throws(() => parseGitChangeStatus(raw), /attendance_scope_/);
  }
});

test("existing mandatory CI discovers every attendance test including nested fixture tests exactly once", () => {
  const files = discoverLocalTests();
  const groups = partitionCiTests(files);
  const attendanceTests = files.filter((file) => /attendance/i.test(file)
    || /^src\/lib\/merchant(?:Enterprise(?:AuthEvents|InvitationRecovery|InvitationSession|Logout)|EmployeeRootLeaveGuard)/.test(file));
  assert(attendanceTests.length > 900);
  const entries = Object.values(groups).flat();
  for (const file of attendanceTests) assert.equal(entries.filter((entry) => entry === file).length, 1, file);
  assert(files.includes("scripts/fixtures/attendance-plan-posthoc-formal-cases.test.ts"));
  assert(files.includes("scripts/attendance-release-source-inventory.test.mjs"));
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(workflow, /node scripts\/run-ci-tests\.mjs remaining/);
});

test("review tooling offers only a read-only JSON entrypoint, never an install, deployment or cleanup command", () => {
  const source = readFileSync(new URL("./attendance-release-source-inventory.mjs", import.meta.url), "utf8");
  assert.match(source, /process\.argv\[2\] !== "--json"/);
  assert.doesNotMatch(source, /writeFile|rmSync|unlink|mkdir|copyFile|\bfetch\(|\bssh\b|\bscp\b|\bnpm ci\b/);
});
