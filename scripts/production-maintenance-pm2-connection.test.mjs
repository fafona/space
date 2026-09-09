import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("connect-only PM2 protocol and isolated peer-credential tests run without a real daemon", () => {
  const script = fileURLToPath(new URL("./test_production_maintenance_pm2_connection.py", import.meta.url));
  const result = spawnSync(process.platform === "win32" ? "python.exe" : "python3", ["-I", "-S", "-B", script], {
    cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", timeout: 60_000, maxBuffer: 256 * 1024,
    windowsHide: true, shell: false,
    env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "",
      TEMP: process.env.TEMP ?? "", TMP: process.env.TMP ?? "",
      FAOLLA_REQUIRE_LINUX_SOCKET_TESTS: process.env.GITHUB_ACTIONS === "true" || process.platform === "linux" ? "1" : "0" },
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /Ran [1-9][0-9]* tests?/);
  assert.match(result.stderr, /\bOK\b/);
  if (process.env.GITHUB_ACTIONS === "true" || process.platform === "linux") assert.doesNotMatch(result.stderr, /skipped=/);
});

test("connection tests remain mandatory in the Linux maintenance CI suite", () => {
  const source = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(source, /runs-on: ubuntu-latest/);
  assert.match(source, /node --test scripts\/production-maintenance-\*\.test\.mjs/);
});
