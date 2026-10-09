import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {attendanceNativeConnectionLifetime, attendanceNativeConnections} from "./merchant-attendance-native-connections.mjs";

const source = readFileSync(new URL("./merchant-attendance-native-connections.mjs", import.meta.url), "utf8");

test("native connections retain 25 second default and require exact 90/180 second opt-in", () => {
  assert.equal(attendanceNativeConnectionLifetime(), 25000);
  assert.equal(attendanceNativeConnectionLifetime(undefined), 25000);
  assert.equal(attendanceNativeConnectionLifetime({lifetimeMs:25000}), 25000);
  assert.equal(attendanceNativeConnectionLifetime({lifetimeMs:90000}), 90000);
  assert.equal(attendanceNativeConnectionLifetime({lifetimeMs:180000}), 180000);
});

test("native lifetime rejects missing, nonnumeric, nonfinite and unapproved durations", () => {
  for (const options of [null, false, 90000, "90000", [], {}, {lifetimeMs:undefined},
    ...[0, -1, 25001, 89999, 90001, 179999, 180001, 180000.5, 25000.5, NaN, Infinity, -Infinity, "25000", "90000", "180000", null].map(lifetimeMs => ({lifetimeMs}))]) {
    assert.throws(() => attendanceNativeConnectionLifetime(options), /attendance_concurrency_lifetime_options/);
  }
});

test("native lifetime rejects extra string or symbol keys and inherited settings", () => {
  for (const options of [{lifetimeMs:90000, stepTimeoutMs:90000}, {lifetimeMs:25000, extra:undefined},
    {[Symbol("extra")]:true, lifetimeMs:90000}, Object.create({lifetimeMs:90000}), new Date()]) {
    assert.throws(() => attendanceNativeConnectionLifetime(options), /attendance_concurrency_lifetime_options/);
  }
  const plain = Object.assign(Object.create(null), {lifetimeMs:90000});
  assert.equal(attendanceNativeConnectionLifetime(plain), 90000);
});

test("native lifetime does not evaluate an options accessor", () => {
  let reads = 0;
  assert.throws(() => attendanceNativeConnectionLifetime({get lifetimeMs() { reads++; return 90000; }}),
    /attendance_concurrency_lifetime_options/);
  assert.equal(reads, 0);
});

test("connect validates options before inspecting binaries or starting any process", async () => {
  let binaryReads = 0;
  const connections = attendanceNativeConnections({get binaries() { binaryReads++; throw new Error("must_not_spawn"); }}, {});
  assert.throws(() => connections.connect({lifetimeMs:90001}), /attendance_concurrency_lifetime_options/);
  assert.throws(() => connections.connect({lifetimeMs:90000, extra:true}), /attendance_concurrency_lifetime_options/);
  assert.equal(binaryReads, 0);
  await connections.closeAll();
});

test("source regression: only whole-session timeout opts in; step, cap and cleanup remain bounded", () => {
  assert.match(source, /const lifetimeMs = attendanceNativeConnectionLifetime\(options\)/);
  assert.match(source, /setTimeout\(\(\) => \{ fail\(new Error\("attendance_concurrency_lifetime"\)\); child\.kill\(\); \}, lifetimeMs\)/);
  assert.match(source, /attendance_concurrency_step_deadline"\)\); child\.kill\(\); \}, 12000\)/);
  assert.match(source, /active\.size < 4, "attendance_concurrency_connection_limit"/);
  assert.match(source, /clearTimeout\(lifetime\); active\.delete\(session\)/);
  assert.match(source, /closeAll\(\) \{ await Promise\.all\(\[\.\.\.active\]\.map\(session => session\.close\(\)\)\)/);
  assert.match(source, /child\.kill\(\); await finished/);
  assert.match(source, /"--host=127\.0\.0\.1"/);
  assert.match(source, /windowsHide:true, shell:false/);
  assert.doesNotMatch(source, /statement_timeout|lock_timeout/);
});
