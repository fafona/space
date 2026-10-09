import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { attendanceNativeConfig } from "./merchant-attendance-foundation-native.mjs";
import { attendanceLabelsReuseDirectory } from "./merchant-attendance-choice-labels-reuse-native.mjs";

test("native attendance database tests require explicit local opt-in and reject overrides", () => {
  assert.throws(() => attendanceNativeConfig([], "win32"));
  assert.throws(() => attendanceNativeConfig(["--run-local", "--database=production"], "win32"));
  assert.throws(() => attendanceNativeConfig(["--run-local"], "linux"));
  const config = attendanceNativeConfig(["--run-local"], "win32");
  assert.equal(config.database, "faolla_attendance_foundation_test");
  assert.equal(config.port, 16444);
});

test("native harness never imports application credentials and restricts cleanup to its own cluster", () => {
  const source = readFileSync(new URL("./merchant-attendance-foundation-native.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /dotenv|DATABASE_URL|SUPABASE_|\.env\.local|\.\.\.process\.env|rmSync|rmdirSync/);
  assert.match(source, /PGHOSTADDR: "127\.0\.0\.1"/);
  assert.match(source, /mkdtempSync\(path\.join\(tmpdir\(\), "faolla-attendance-foundation-"\)\)/);
  assert.match(source, /attendance_native_cleanup_directory_mismatch/);
  assert.match(source, /attendance_native_cleanup_port_mismatch/);
  assert.match(source, /windowsHide: true, shell: false/);
});

test("reuse harness requires an exact synthetic child of the temporary root", () => {
  const temp = "C:\\Users\\User\\AppData\\Local\\Temp";
  const target = `${temp}\\faolla-attendance-foundation-7rg4GW`;
  assert.equal(attendanceLabelsReuseDirectory(["--run-local","--directory",target],temp,"win32"),target);
  for (const args of [[],["--run-local"],["--run-local","--directory",temp],
    ["--run-local","--directory","D:\\production"],["--run-local","--directory",`${target}\\data`],
    ["--run-local","--directory","faolla-attendance-foundation-7rg4GW"],
    ["--run-local","--directory",target,"--port=5432"]]) {
    assert.throws(() => attendanceLabelsReuseDirectory(args,temp,"win32"));
  }
  assert.throws(() => attendanceLabelsReuseDirectory(["--run-local","--directory",target],temp,"linux"));
});

test("reuse native acceptance has no production credentials, new cluster or recursive cleanup", () => {
  const source = readFileSync(new URL("./merchant-attendance-choice-labels-reuse-native.mjs",import.meta.url),"utf8");
  assert.doesNotMatch(source,/dotenv|DATABASE_URL|SUPABASE_|\.env\.local|\.\.\.process\.env|rmSync|rmdirSync|mkdtempSync/);
  for (const guard of ["attendance_reuse_no_data_redirect","attendance_reuse_cluster_must_be_stopped",
    "attendance_reuse_synthetic_merchants_only","attendance_reuse_transaction_did_not_restore_state",
    "attendance_reuse_stop_directory_mismatch","attendance_reuse_stop_port_mismatch"]) assert.ok(source.includes(guard));
  assert.match(source,/windowsHide: true, shell: false/);
  const checks = readFileSync(new URL("./merchant-attendance-choice-labels-native-checks.mjs",import.meta.url),"utf8");
  assert.match(checks,/output=query\(`begin;/); assert.match(checks,/rollback;`\)/);
});
