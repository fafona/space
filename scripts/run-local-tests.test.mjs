import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  createLocalTestBatches,
  discoverLocalTests,
  main,
  parseLocalTestArguments,
  runLocalTests,
} from "./run-local-tests.mjs";

function fixture(context) {
  const root = mkdtempSync(path.join(os.tmpdir(), "faolla-local-tests-"));
  mkdirSync(path.join(root, "src"));
  mkdirSync(path.join(root, "scripts"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function file(root, name, content = "") {
  const target = path.join(root, name);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function outputBuffer() {
  let content = "";
  return { write(chunk) { content += String(chunk); }, get text() { return content; } };
}

test("discovery includes handwritten test variants but excludes operational entrypoints and other trees", (context) => {
  const root = fixture(context);
  const expected = [
    "scripts/a.test.mjs", "src/a.test.ts", "src/deep/b.spec.tsx", "src/deep/c.test.cts",
  ];
  for (const name of [...expected, "scripts/check-merchant-enterprise-browser.mjs", "scripts/deploy.production.sh",
    "scripts/enterprise-integration/run.sh", "src/production.ts", "android/ignored.test.js", ".next/ignored.test.js"]) {
    file(root, name);
  }
  assert.deepEqual(discoverLocalTests(root), expected);
});

test("empty discovery and missing source roots fail instead of succeeding with no tests", (context) => {
  const root = fixture(context);
  assert.throws(() => discoverLocalTests(root), /local_test_files_missing/);
  rmdirSync(path.join(root, "scripts"));
  assert.throws(() => discoverLocalTests(root), /ENOENT/);
});

test("list output is machine readable, complete, deterministic, and does not spawn tests", async (context) => {
  const root = fixture(context);
  file(root, "src/z.test.ts", "throw new Error('must not execute')");
  file(root, "scripts/a.spec.mjs", "throw new Error('must not execute')");
  const stdout = outputBuffer();
  assert.equal(await main(["--list"], { rootDirectory: root, stdout }), 0);
  assert.deepEqual(JSON.parse(stdout.text), {
    roots: ["src", "scripts"], count: 2, files: ["scripts/a.spec.mjs", "src/z.test.ts"],
  });
});

test("runner options reject unknown, repeated and unbounded values", () => {
  assert.deepEqual(parseLocalTestArguments(["--concurrency=2", "--batch-size=12"]), {
    list: false, concurrency: 2, batchSize: 12,
  });
  for (const args of [["--list", "--list"], ["--concurrency=0"], ["--concurrency=17"],
    ["--batch-size=65"], ["--root=elsewhere"], ["--concurrency=2", "--concurrency=3"]]) {
    assert.throws(() => parseLocalTestArguments(args));
  }
});

test("batching preserves every file while respecting file and Windows argument size limits", () => {
  const files = Array.from({ length: 130 }, (_, index) => `src/${"folder/".repeat(20)}${index}.test.ts`);
  const base = ["--test", "--test-concurrency=4"];
  const batches = createLocalTestBatches(files, base, 40);
  assert.deepEqual(batches.flat(), files);
  assert.ok(batches.length > 4);
  for (const batch of batches) {
    assert.ok(batch.length <= 40);
    assert.ok([process.execPath, ...base, ...batch].reduce((sum, value) => sum + value.length * 2 + 3, 0) <= 7_000);
  }
  assert.throws(() => createLocalTestBatches(["../external.test.ts"], base), /local_test_path_invalid/);
  assert.throws(() => createLocalTestBatches([`src/${"a".repeat(7_000)}.test.ts`], base), /local_test_path_too_long/);
});

test("all batches run and child failure or launch failure remains a nonzero result", async () => {
  const commands = [];
  const stdout = outputBuffer();
  const stderr = outputBuffer();
  const result = await runLocalTests({
    files: ["src/a.test.ts", "src/b.test.ts", "src/c.test.ts"],
    batchSize: 1, concurrency: 2, stdout, stderr,
    spawnProcess(command, args, options) {
      commands.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      const number = commands.length;
      process.nextTick(() => {
        if (number === 1) child.emit("close", 1, null);
        else if (number === 2) child.emit("error", new Error("fixture spawn failure"));
        else child.emit("close", 0, null);
      });
      return child;
    },
  });
  assert.deepEqual(result, { files: 3, batches: 3, failedBatches: 2, exitCode: 1 });
  assert.equal(commands.length, 3);
  for (const command of commands) {
    assert.equal(command.command, process.execPath);
    assert.equal(command.options.shell, false);
    assert.equal(command.options.windowsHide, true);
    assert.equal(command.options.env.NODE_TEST_CONTEXT, undefined);
    // Node 20 already isolates test files. Explicit isolation flags were added
    // later and would make the CI runtime reject this command before any test.
    assert.equal(command.args.some((argument) => argument.startsWith("--test-isolation")), false);
    assert.equal(command.args.some((argument) => argument.startsWith("--experimental-test-isolation")), false);
    assert.ok(command.args.includes("--test-concurrency=2"));
  }
});

test("real child processes load TypeScript and isolate environment and globals between files", async (context) => {
  const root = fixture(context);
  const stdout = outputBuffer();
  const stderr = outputBuffer();
  file(root, "src/a.test.ts", `import test from 'node:test';
    const value: number = 1;
    test('mutates only this process', () => { process.env.FAOLLA_RUNNER_FIXTURE = String(value); globalThis.faollaRunnerFixture = value; });`);
  file(root, "src/b.test.mjs", `import test from 'node:test'; import assert from 'node:assert/strict';
    test('receives an isolated process', () => { assert.equal(process.env.FAOLLA_RUNNER_FIXTURE, undefined); assert.equal(globalThis.faollaRunnerFixture, undefined); });`);
  const result = await runLocalTests({ rootDirectory: root, concurrency: 1, stdout, stderr });
  assert.equal(result.exitCode, 0, stdout.text + stderr.text);
  assert.equal(result.files, 2);
  assert.equal(result.batches, 1);
  assert.match(stdout.text, /mutates only this process/);
  assert.match(stdout.text, /receives an isolated process/);
});

test("a real failing test cannot produce a successful runner status", async (context) => {
  const root = fixture(context);
  file(root, "scripts/fail.test.mjs", "import test from 'node:test'; test('intentional fixture failure', () => { throw new Error('fixture'); });");
  const result = await runLocalTests({ rootDirectory: root, stdout: outputBuffer(), stderr: outputBuffer() });
  assert.equal(result.exitCode, 1);
  assert.equal(result.failedBatches, 1);
});
