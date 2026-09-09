import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { MerchantOutboxWorkerSummary } from "../src/lib/merchantOutboxWorker.server";
import {
  runMerchantEnterpriseAutomationWorker,
  runMerchantEnterpriseInvitationWorker,
  waitForPausedEnterpriseWorkerShutdown,
  type MerchantEnterpriseAutomationWorkerConfig,
} from "./run-merchant-enterprise-automation-worker";

const config: MerchantEnterpriseAutomationWorkerConfig = {
  enabled: true,
  pollIntervalMs: 1_000,
  failureBackoffInitialMs: 1_000,
  failureBackoffMaxMs: 30_000,
  discoveryLimit: 250,
  merchantScopeLimit: 50,
  batchLimit: 5,
  leaseSeconds: 90,
  taskTimeoutMs: 60_000,
  requestTimeoutMs: 10_000,
};
const idle: MerchantOutboxWorkerSummary = {
  status: "idle", claimed: 0, completed: 0, retried: 0,
  deadLettered: 0, leaseLost: 0, malformed: 0,
};

async function withPauseValue(value: string | undefined, action: () => Promise<void>) {
  const before = process.env.FAOLLA_BACKGROUND_JOBS_PAUSED;
  if (value === undefined) delete process.env.FAOLLA_BACKGROUND_JOBS_PAUSED;
  else process.env.FAOLLA_BACKGROUND_JOBS_PAUSED = value;
  try {
    await action();
  } finally {
    if (before === undefined) delete process.env.FAOLLA_BACKGROUND_JOBS_PAUSED;
    else process.env.FAOLLA_BACKGROUND_JOBS_PAUSED = before;
  }
}

function workerInput() {
  return {
    client: { rpc: async () => { throw new Error("unexpected_real_rpc"); } },
    runtime: { baseUrl: "https://synthetic.invalid", headers: {} },
    handler: async () => undefined,
    settlement: {
      complete: async () => true,
      fail: async () => "dead_lettered" as const,
    },
    config,
    signal: new AbortController().signal,
    workerId: "synthetic:pause-test",
  };
}

for (const [name, runWorker] of [
  ["automation", runMerchantEnterpriseAutomationWorker],
  ["invitation", runMerchantEnterpriseInvitationWorker],
] as const) {
  test(`${name}: paused and malformed flags block discovery and claims`, async () => {
    for (const value of ["1", "", "false"]) {
      await withPauseValue(value, async () => {
        let discoveries = 0;
        let claims = 0;
        let sleeps = 0;
        await runWorker({
          ...workerInput(),
          dependencies: {
            maxCycles: 2,
            discoverMerchantIds: async () => { discoveries += 1; return ["10000001"]; },
            processBatch: async () => { claims += 1; return idle; },
            sleep: async () => { sleeps += 1; },
            logger: { info() {}, warn() {}, error() {} },
          },
        });
        assert.equal(discoveries, 0);
        assert.equal(claims, 0);
        assert.equal(sleeps, 2);
      });
    }
  });

  test(`${name}: pause after discovery prevents a new claim`, async () => {
    await withPauseValue("0", async () => {
      let discoveries = 0;
      let claims = 0;
      await runWorker({
        ...workerInput(),
        dependencies: {
          maxCycles: 2,
          discoverMerchantIds: async () => {
            discoveries += 1;
            process.env.FAOLLA_BACKGROUND_JOBS_PAUSED = "1";
            return ["10000001"];
          },
          processBatch: async () => { claims += 1; return idle; },
          sleep: async () => undefined,
          logger: { info() {}, warn() {}, error() {} },
        },
      });
      assert.equal(discoveries, 1);
      assert.equal(claims, 0);
    });
  });

  test(`${name}: default and zero retain the existing batch behavior`, async () => {
    for (const value of [undefined, "0"]) {
      await withPauseValue(value, async () => {
        let discoveries = 0;
        let claims = 0;
        await runWorker({
          ...workerInput(),
          dependencies: {
            maxCycles: 1,
            discoverMerchantIds: async () => { discoveries += 1; return ["10000001"]; },
            processBatch: async () => { claims += 1; return idle; },
            sleep: async () => undefined,
            logger: { info() {}, warn() {}, error() {} },
          },
        });
        assert.equal(discoveries, 1);
        assert.equal(claims, 1);
      });
    }
  });

  test(`${name}: an admitted batch finishes without cancellation or new settlement rules`, async () => {
    await withPauseValue("0", async () => {
      const input = workerInput();
      let claims = 0;
      let completed = false;
      await runWorker({
        ...input,
        dependencies: {
          maxCycles: 2,
          discoverMerchantIds: async () => ["10000001"],
          processBatch: async () => {
            claims += 1;
            process.env.FAOLLA_BACKGROUND_JOBS_PAUSED = "1";
            await Promise.resolve();
            assert.equal(input.signal.aborted, false);
            completed = true;
            return { ...idle, status: "processed", claimed: 1, completed: 1 };
          },
          sleep: async () => undefined,
          logger: { info() {}, warn() {}, error() {} },
        },
      });
      assert.equal(claims, 1);
      assert.equal(completed, true);
      assert.equal(input.signal.aborted, false);
    });
  });
}

test("paused startup stays idle until termination, without polling an external control", async () => {
  const controller = new AbortController();
  let sleeps = 0;
  await waitForPausedEnterpriseWorkerShutdown(controller.signal, async (milliseconds, signal) => {
    sleeps += 1;
    assert.equal(milliseconds, 60_000);
    assert.equal(signal, controller.signal);
    controller.abort();
  });
  assert.equal(sleeps, 1);
});

test("an already terminated paused supervisor does not wait again", async () => {
  const controller = new AbortController();
  controller.abort();
  await waitForPausedEnterpriseWorkerShutdown(controller.signal, async () => {
    assert.fail("must_not_wait");
  });
});

test("source contract: paused startup precedes clients, configuration and invitation readiness", () => {
  const source = readFileSync(new URL("./run-merchant-enterprise-automation-worker.ts", import.meta.url), "utf8");
  const main = source.slice(source.indexOf("async function main() {"));
  const pause = main.indexOf("if (areBackgroundJobsPaused()) {");
  assert.ok(pause > main.indexOf("loadEnvConfig(process.cwd())"));
  const idleWait = main.indexOf("await waitForPausedEnterpriseWorkerShutdown(controller.signal)");
  assert.ok(idleWait > pause);
  for (const operation of [
    "const automationConfig = resolveMerchantEnterpriseAutomationWorkerConfig()",
    "const runtime = createMerchantEnterpriseAutomationWorkerRestRuntime()",
    "const client = createServerSupabaseServiceClient()",
    "await prepareMerchantEnterpriseInvitationWorkerBeforeReady(",
  ]) {
    assert.ok(main.indexOf(operation) > idleWait, operation);
  }
  assert.match(main.slice(pause, idleWait), /paused restart-required=true/);
  assert.doesNotMatch(main.slice(pause, main.indexOf("const automationConfig =")), /process\.send/);
  assert.ok(main.indexOf('process.send("ready")') > main.indexOf("await prepareMerchantEnterpriseInvitationWorkerBeforeReady("));
  assert.match(main, /process\.once\("SIGTERM", onSigterm\)/);
  assert.match(main, /process\.removeListener\("SIGTERM", onSigterm\)/);
});

test("source contract: pause does not add handler cancellation or settlement policy", () => {
  const source = readFileSync(new URL("./run-merchant-enterprise-automation-worker.ts", import.meta.url), "utf8");
  const handler = source.slice(source.indexOf("function withShutdownSignal("), source.indexOf("export async function waitForMerchantEnterpriseAutomationWorkerReady("));
  assert.doesNotMatch(handler, /areBackgroundJobsPaused|background_jobs_paused/);
  assert.equal(source.match(/if \(areBackgroundJobsPaused\(\)\)/g)?.length, 5);
});
