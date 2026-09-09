import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
test("strict release env check keeps atomic candidate disabled and rejects misspellings", () => {
  for (const [mode, succeeds] of [["off", true], ["", true], ["atomic", false], [" atomic", false], ["false", false]]) {
    const result = spawnSync(process.execPath, ["scripts/check-env.mjs", "--strict"], { cwd: root, encoding: "utf8", windowsHide: true,
      env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic",
        ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED: "false", MERCHANT_STAFF_BUSINESS_RBAC_MODE: "off",
        MERCHANT_STAFF_BUSINESS_RBAC_SITE_IDS: "", FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE: mode } });
    assert.equal(result.status, succeeds ? 0 : 1, result.stderr);
    if (mode === "atomic") assert.match(result.stderr, /local-candidate-only/);
  }
});
test("business runner remains standalone and guards exact local instance and initially empty database", () => {
  const runner = readFileSync(new URL("./platform-snapshot-integration/business-run.ts", import.meta.url), "utf8");
  assert.match(runner, /PLATFORM_SNAPSHOT_BUSINESS_ALLOW_DISPOSABLE_DATABASE/);
  assert.match(runner, /faolla_platform_snapshot_business_test/); assert.match(runner, /"56481"/);
  assert.match(runner, /platform-snapshot-business-test-pg/); assert.match(runner, /Refusing nonempty database/);
  assert.ok(runner.indexOf("Refusing nonempty database") < runner.indexOf("create extension pgcrypto"));
  assert.match(runner, /child\.stdout\.setEncoding\("utf8"\)/);
  assert.match(runner, /child\.stderr\.setEncoding\("utf8"\)/);
  assert.doesNotMatch(runner, /drop database|truncate |dotenv|DATABASE_URL|--password/i);
  const pkg = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  assert.doesNotMatch(pkg, /business-run\.ts/);
});
test("streaming UTF-8 decoding preserves a Chinese character split across pipe chunks", async () => {
  const bytes = Buffer.from("before-中-after", "utf8");
  const split = [bytes.subarray(0, 8), bytes.subarray(8)];
  assert.notEqual(split.map((part) => part.toString()).join(""), bytes.toString("utf8"));
  const pipe = new PassThrough(); pipe.setEncoding("utf8"); let text = "";
  pipe.on("data", (part) => { text += part; });
  const ended = new Promise((resolve) => pipe.on("end", resolve));
  split.forEach((part) => pipe.write(part)); pipe.end(); await ended;
  assert.equal(text, bytes.toString("utf8"));
});
