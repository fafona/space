import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import { areBackgroundJobsPaused } from "./backgroundJobsPause";
import type * as AutomationRuntime from "./merchantBookingAutomationRuntime";

const source = readFileSync(new URL("./merchantBookingAutomationRuntime.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function createRuntime(
  pauseValue: string | undefined,
  runJob: () => Promise<unknown> = async () => ({ synthetic: true }),
  beforeImport?: () => void,
) {
  const environment: Record<string, string | undefined> = {
    NODE_ENV: "production",
    FAOLLA_BACKGROUND_JOBS_PAUSED: pauseValue,
  };
  const timers: Array<() => void> = [];
  const errors: unknown[] = [];
  let imports = 0;
  let calls = 0;
  const runtimeModule = { exports: {} };
  // Execute the actual compiled runtime in an isolated VM. No production
  // module, real timer, process environment, or application service is loaded.
  runInNewContext(compiled, {
    exports: runtimeModule.exports,
    process: { env: environment },
    require(name: string) {
      if (name === "./backgroundJobsPause") {
        return { areBackgroundJobsPaused: () => areBackgroundJobsPaused(environment) };
      }
      assert.equal(name, "./merchantBookings.server");
      imports += 1;
      beforeImport?.();
      return {
        runMerchantBookingAutomationForAllSites: async () => {
          calls += 1;
          return runJob();
        },
      };
    },
    setInterval(callback: () => void) {
      timers.push(callback);
      return { unref() {} };
    },
    console: { error: (...values: unknown[]) => errors.push(values) },
  }, { filename: "merchantBookingAutomationRuntime.synthetic.cjs" });
  return {
    api: runtimeModule.exports as typeof AutomationRuntime,
    environment,
    timers,
    errors,
    imports: () => imports,
    calls: () => calls,
  };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("paused startup and later ticks never import or invoke booking jobs", async () => {
  const runtime = createRuntime("1");
  runtime.api.startMerchantBookingAutomationRuntime();
  runtime.timers[0]();
  await settle();
  assert.equal(runtime.imports(), 0);
  assert.equal(runtime.calls(), 0);
  const snapshot = runtime.api.getMerchantBookingAutomationRuntimeSnapshot();
  assert.equal(snapshot.started, true);
  assert.equal(snapshot.running, false);
  assert.equal(snapshot.lastStartedAt, "");
  assert.equal(snapshot.lastCompletedAt, "");
  assert.equal(snapshot.lastSuccessAt, "");
  assert.equal(snapshot.lastResult, null);
  assert.deepEqual(Object.keys(snapshot).sort(), [
    "started", "running", "lastStartedAt", "lastCompletedAt", "lastSuccessAt",
    "lastErrorAt", "lastErrorMessage", "lastResult",
  ].sort());
});

test("malformed explicit flags also block every booking tick", async () => {
  for (const value of ["", "false", " 0"]) {
    const runtime = createRuntime(value);
    runtime.api.startMerchantBookingAutomationRuntime();
    runtime.timers[0]();
    await settle();
    assert.equal(runtime.calls(), 0);
    assert.equal(runtime.imports(), 0);
    assert.equal(runtime.api.getMerchantBookingAutomationRuntimeSnapshot().lastSuccessAt, "");
  }
});

test("unset and zero retain immediate and scheduled booking execution", async () => {
  for (const value of [undefined, "0"]) {
    const runtime = createRuntime(value);
    runtime.api.startMerchantBookingAutomationRuntime();
    await settle();
    runtime.timers[0]();
    await settle();
    assert.equal(runtime.calls(), 2);
    assert.equal(runtime.api.getMerchantBookingAutomationRuntimeSnapshot().running, false);
    assert.ok(runtime.api.getMerchantBookingAutomationRuntimeSnapshot().lastSuccessAt);
    assert.equal(runtime.errors.length, 0);
  }
});

test("an admitted booking job completes normally while future ticks are paused", async () => {
  let complete!: (value: unknown) => void;
  const job = new Promise((resolve) => { complete = resolve; });
  const runtime = createRuntime("0", () => job);
  runtime.api.startMerchantBookingAutomationRuntime();
  await settle();
  assert.equal(runtime.calls(), 1);
  runtime.environment.FAOLLA_BACKGROUND_JOBS_PAUSED = "1";
  runtime.timers[0]();
  assert.equal(runtime.api.getMerchantBookingAutomationRuntimeSnapshot().running, true);
  complete({ finished: true });
  await settle();
  const completed = runtime.api.getMerchantBookingAutomationRuntimeSnapshot();
  assert.equal(completed.running, false);
  assert.ok(completed.lastSuccessAt);
  assert.equal((completed.lastResult as { finished: boolean }).finished, true);
  runtime.timers[0]();
  await settle();
  assert.equal(runtime.calls(), 1);
  assert.equal(runtime.api.getMerchantBookingAutomationRuntimeSnapshot().lastSuccessAt, completed.lastSuccessAt);
});

test("booking invocation rechecks the pause after the asynchronous module load", async () => {
  const runtime = createRuntime("0", undefined, () => {
    runtime.environment.FAOLLA_BACKGROUND_JOBS_PAUSED = "1";
  });
  runtime.api.startMerchantBookingAutomationRuntime();
  await settle();
  assert.equal(runtime.imports(), 1);
  assert.equal(runtime.calls(), 0);
  assert.equal(runtime.api.getMerchantBookingAutomationRuntimeSnapshot().lastCompletedAt, "");
  assert.equal(runtime.api.getMerchantBookingAutomationRuntimeSnapshot().running, false);
});

test("the existing test-mode startup exclusion is unchanged", () => {
  const runtime = createRuntime("0");
  runtime.environment.NODE_ENV = "test";
  runtime.api.startMerchantBookingAutomationRuntime();
  assert.equal(runtime.timers.length, 0);
  assert.equal(runtime.calls(), 0);
});
