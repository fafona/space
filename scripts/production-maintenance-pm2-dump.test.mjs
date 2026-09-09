import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("private PM2 dump protocol and Linux atomic-file tests use only owned synthetic fixtures", () => {
  const script = fileURLToPath(new URL("./test_production_maintenance_pm2_dump.py", import.meta.url));
  const requireLinux = process.platform === "linux" || process.env.GITHUB_ACTIONS === "true";
  const result = spawnSync(process.platform === "win32" ? "python.exe" : "python3", ["-I", "-S", "-B", script], {
    cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", timeout: 60_000,
    maxBuffer: 256 * 1024, windowsHide: true, shell: false,
    env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "",
      TEMP: process.env.TEMP ?? "", TMP: process.env.TMP ?? "",
      FAOLLA_REQUIRE_LINUX_SOCKET_TESTS: requireLinux ? "1" : "0" },
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /Ran [1-9][0-9]* tests?/);
  assert.match(result.stderr, /\bOK\b/);
  if (requireLinux) assert.doesNotMatch(result.stderr, /skipped=/);
});
