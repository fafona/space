import assert from "node:assert/strict";
import test from "node:test";
import { startVisiblePolling, type VisiblePollingEnvironment } from "./visiblePolling";

function harness() {
  let now = 0;
  let visible = true;
  let serial = 0;
  const timers = new Map<number, { due: number; callback: () => void }>();
  const listeners = new Set<() => void>();
  const environment: VisiblePollingEnvironment = {
    now: () => now,
    isVisible: () => visible,
    schedule(callback, delayMs) {
      const id = ++serial;
      timers.set(id, { due: now + delayMs, callback });
      return () => { timers.delete(id); };
    },
    subscribe(callback) {
      listeners.add(callback);
      return () => { listeners.delete(callback); };
    },
  };
  return {
    environment,
    timers,
    listeners,
    notify() { for (const listener of listeners) listener(); },
    setVisible(value: boolean) {
      visible = value;
      for (const listener of listeners) listener();
    },
    async tick(ms: number) {
      const target = now + ms;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        now = next[1].due;
        timers.delete(next[0]);
        next[1].callback();
        await Promise.resolve();
        await Promise.resolve();
      }
      now = target;
      await Promise.resolve();
    },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("visible polling preserves initial delay/freshness and coalesces foreground events", async () => {
  const runtime = harness();
  let calls = 0;
  const stop = startVisiblePolling({ refresh: async () => { calls++; }, intervalMs: 60, initialDelayMs: 10 }, runtime.environment);
  runtime.notify(); runtime.notify();
  await runtime.tick(9);
  assert.equal(calls, 0);
  await runtime.tick(1);
  assert.equal(calls, 1);
  runtime.notify(); runtime.notify();
  await runtime.tick(59);
  assert.equal(calls, 1);
  await runtime.tick(1);
  assert.equal(calls, 2);
  stop();
  assert.equal(runtime.timers.size, 0);
  assert.equal(runtime.listeners.size, 0);
});

test("hidden tabs make no requests and resume one overdue refresh", async () => {
  const runtime = harness();
  runtime.setVisible(false);
  let calls = 0;
  const stop = startVisiblePolling({ refresh: async () => { calls++; }, intervalMs: 60 }, runtime.environment);
  await runtime.tick(600);
  assert.equal(calls, 0);
  runtime.setVisible(true); runtime.notify();
  await runtime.tick(0);
  assert.equal(calls, 1);
  runtime.setVisible(false);
  await runtime.tick(600);
  assert.equal(calls, 1);
  stop();
});

test("slow or abort-ignoring requests never overlap; stopped results cannot publish", async () => {
  const runtime = harness();
  const pending = deferred();
  let calls = 0;
  let published = 0;
  let signal!: AbortSignal;
  const stop = startVisiblePolling({
    refresh: async (requestSignal) => {
      calls++;
      signal = requestSignal;
      await pending.promise;
      if (!requestSignal.aborted) published++;
    },
    intervalMs: 60, timeoutMs: 30,
  }, runtime.environment);
  await runtime.tick(300);
  runtime.notify();
  assert.equal(calls, 1);
  assert.equal(signal.aborted, true);
  stop();
  pending.resolve();
  await runtime.tick(600);
  assert.equal(calls, 1);
  assert.equal(published, 0);
  assert.equal(runtime.timers.size, 0);
});

test("hiding aborts in-flight work and foreground waits for it to settle", async () => {
  const runtime = harness();
  const pending = deferred();
  const signals: AbortSignal[] = [];
  const stop = startVisiblePolling({
    refresh: async (signal) => { signals.push(signal); if (signals.length === 1) await pending.promise; },
    intervalMs: 60,
  }, runtime.environment);
  await runtime.tick(0);
  runtime.setVisible(false);
  assert.equal(signals[0].aborted, true);
  runtime.setVisible(true);
  await runtime.tick(100);
  assert.equal(signals.length, 1);
  pending.resolve();
  await Promise.resolve(); await Promise.resolve();
  await runtime.tick(0);
  assert.equal(signals.length, 2);
  stop();
});

test("failures back off to a bound and a success restores normal cadence", async () => {
  const runtime = harness();
  const attempts: number[] = [];
  const stop = startVisiblePolling({
    refresh: async () => {
      attempts.push(runtime.environment.now());
      if (attempts.length <= 3) throw new Error("network unavailable");
    },
    intervalMs: 10, maxBackoffMs: 40,
  }, runtime.environment);
  await runtime.tick(110);
  assert.deepEqual(attempts, [0, 20, 60, 100, 110]);
  stop();
});

test("cancellation before the initial refresh removes all scheduled work", async () => {
  const runtime = harness();
  let calls = 0;
  const stop = startVisiblePolling({ refresh: async () => { calls++; }, intervalMs: 60, initialDelayMs: 10 }, runtime.environment);
  stop(); stop();
  runtime.notify();
  await runtime.tick(600);
  assert.equal(calls, 0);
  assert.equal(runtime.timers.size, 0);
  assert.equal(runtime.listeners.size, 0);
});

test("cold refresh can retain cancellable idle scheduling without delaying subsequent polls", async () => {
  const runtime = harness();
  let calls = 0;
  let idleSchedules = 0;
  const stop = startVisiblePolling({
    refresh: async () => { calls++; },
    intervalMs: 60,
    scheduleInitial: (callback) => {
      idleSchedules++;
      return runtime.environment.schedule(callback, 24);
    },
  }, runtime.environment);
  await runtime.tick(10);
  assert.equal(calls, 0);
  runtime.setVisible(false);
  await runtime.tick(100);
  assert.equal(calls, 0);
  runtime.setVisible(true);
  await runtime.tick(24);
  assert.equal(calls, 1);
  assert.equal(idleSchedules, 2);
  await runtime.tick(60);
  assert.equal(calls, 2);
  assert.equal(idleSchedules, 2);
  stop();
});

test("timeout abort rejection backs off and a healthy retry resumes the regular interval", async () => {
  const runtime = harness();
  const attempts: number[] = [];
  const stop = startVisiblePolling({
    refresh: (signal) => {
      attempts.push(runtime.environment.now());
      if (attempts.length > 1) return Promise.resolve();
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    },
    intervalMs: 60, timeoutMs: 20,
  }, runtime.environment);
  await runtime.tick(139);
  assert.deepEqual(attempts, [0]);
  await runtime.tick(1);
  assert.deepEqual(attempts, [0, 140]);
  await runtime.tick(60);
  assert.deepEqual(attempts, [0, 140, 200]);
  stop();
});
