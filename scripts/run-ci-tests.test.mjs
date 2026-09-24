import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { discoverLocalTests } from "./run-local-tests.mjs";
import { main, partitionCiTests } from "./run-ci-tests.mjs";

const required = [
  "scripts/ci-workflow-contract.test.mjs",
  "scripts/check-production-maintenance-topology.test.mjs",
  "scripts/check-production-maintenance-capabilities.test.mjs",
  "scripts/maintenance-control-probe-headers.test.mjs",
  "scripts/pages-client-write-acl-migration-contract.test.mjs",
  "scripts/pages-acl-integration/run.test.mjs",
  "scripts/maintenance-supabase-scheduler-profile.test.mjs",
  "scripts/maintenance-supabase-scheduler-acceptance.test.mjs",
  "scripts/production-maintenance-native-proof.test.mjs",
  "scripts/production-maintenance-runtime.test.mjs",
  "scripts/production-maintenance-topology-workflow.test.mjs",
];
const baseline = [...required, "src/application.test.ts"];
const output = () => ({ text: "", write(chunk) { this.text += String(chunk); } });

function fixture(context, remaining) {
  const directory = mkdtempSync(path.join(tmpdir(), "faolla-ci-partition-"));
  for (const file of baseline) {
    const destination = path.join(directory, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, file === "src/application.test.ts" ? remaining : "throw new Error('explicit CI group must not run twice');");
  }
  context.after(() => {
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), path.resolve(tmpdir()));
    assert.ok(path.basename(target).startsWith("faolla-ci-partition-"));
    rmSync(target, { recursive: true, force: true });
  });
  return directory;
}

test("CI partitions every discovered repository test exactly once and retains serial proofs", () => {
  const files = discoverLocalTests(fileURLToPath(new URL("../", import.meta.url)));
  const groups = partitionCiTests(files);
  const all = Object.values(groups).flat();
  assert.deepEqual(all.sort(), files);
  assert.equal(new Set(all).size, files.length);
  assert.ok(groups.maintenance.includes("scripts/production-maintenance-native-proof.test.mjs"));
  assert.ok(groups.maintenance.includes("scripts/production-maintenance-runtime.test.mjs"));
  assert.ok(groups.remaining.includes("scripts/run-local-tests.test.mjs"));
  assert.ok(groups.remaining.includes("scripts/run-ci-tests.test.mjs"));
  assert.equal(groups.remaining.some((file) => file.startsWith("scripts/production-maintenance-")), false);
});

test("new tests are never lost: ordinary variants join remaining and matching proofs join maintenance", () => {
  const additions = ["src/new.spec.tsx", "scripts/new.test.cts", "scripts/production-maintenance-future.test.mjs",
    "scripts/nested/production-maintenance-extra.test.mjs", "scripts/production-maintenance-new.test.ts"];
  const groups = partitionCiTests([...baseline, ...additions].reverse());
  assert.ok(groups.maintenance.includes(additions[2]));
  assert.deepEqual(groups.remaining, [...additions.filter((_, index) => index !== 2), "src/application.test.ts"].sort());
  assert.deepEqual(Object.values(groups).flat().sort(), [...baseline, ...additions].sort());
});

test("missing mandatory groups, duplicate paths, unsafe paths and empty inventory fail closed", () => {
  assert.throws(() => partitionCiTests([]), /inventory_invalid/);
  assert.throws(() => partitionCiTests([...baseline, baseline[0]]), /inventory_invalid/);
  for (const file of required) assert.throws(() => partitionCiTests(baseline.filter((candidate) => candidate !== file)), /missing/);
  for (const file of ["../outside.test.ts", "scripts/../outside.test.mjs", "scripts//new.test.ts", "scripts\\new.test.mjs",
    "scripts/deploy.production.sh", "src/./new.test.ts"]) assert.throws(() => partitionCiTests([...baseline, file]), /path_invalid/);
  assert.throws(() => partitionCiTests(required), /remaining_tests_missing/);
});

test("CI runner accepts only its fixed remaining partition or a non-executing inventory", async (context) => {
  const rootDirectory = fixture(context, "throw new Error('must not execute when listing');");
  const stdout = output();
  const runTests = () => { throw new Error("listing must not spawn"); };
  assert.equal(await main(["--list"], { rootDirectory, stdout, runTests }), 0);
  const result = JSON.parse(stdout.text);
  assert.deepEqual(result.groups, partitionCiTests(baseline));
  assert.equal(Object.values(result.counts).reduce((sum, count) => sum + count, 0), baseline.length);
  for (const args of [[], ["maintenance"], ["remaining", "remaining"], ["--skip=native"], ["remaining", "--concurrency=16"]]) {
    await assert.rejects(main(args, { rootDirectory, stdout, runTests }), /invocation_invalid/);
  }
});

test("CI delegates the exact complement with existing concurrency and preserves failure status", async (context) => {
  const rootDirectory = fixture(context, "");
  for (const exitCode of [0, 1]) {
    const calls = [];
    const result = await main(["remaining"], { rootDirectory, stdout: output(), runTests: async (options) => {
      calls.push(options); return { exitCode };
    } });
    assert.equal(result, exitCode);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].files, ["src/application.test.ts"]);
    assert.equal(calls[0].concurrency, 4);
    assert.equal(calls[0].batchSize, 40);
  }
});

test("real subprocess failure remains a failed CI partition without executing excluded fixtures", async (context) => {
  const rootDirectory = fixture(context, "import test from 'node:test'; test('intentional CI partition fixture failure', () => { throw new Error('synthetic failure'); });");
  const stdout = output();
  assert.equal(await main(["remaining"], { rootDirectory, stdout }), 1);
  assert.match(stdout.text, /intentional CI partition fixture failure/);
  assert.doesNotMatch(stdout.text, /explicit CI group must not run twice/);
});
