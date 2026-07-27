import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { MerchantOrderV1PrimaryCanaryWatchNotification } from "../src/lib/merchantOrderV1PrimaryCanaryWatch";
import {
  deliverV1PrimaryCanaryWatchWebhook,
  parseV1PrimaryCanaryWatchOptions,
  readV1PrimaryCanaryWatchState,
  resolveV1PrimaryCanaryWatchRuntimeConfig,
  writeV1PrimaryCanaryWatchState,
} from "./watch-v1-primary-canary";

const ACTIVATED_AT = "2026-07-25T00:00:00.000Z";

test("watch options require durable state scope and retain safe defaults", () => {
  assert.deepEqual(
    parseV1PrimaryCanaryWatchOptions([
      "--file=logs/order-primary.jsonl",
      "--state-file=private/order-primary-watch.json",
      "--site=10000000",
      `--activated-at=${ACTIVATED_AT}`,
    ]),
    {
      file: "logs/order-primary.jsonl",
      stateFile: "private/order-primary-watch.json",
      siteId: "10000000",
      activatedAt: ACTIVATED_AT,
      minimumSamples: 100,
      minimumObservationWindowMinutes: 1440,
      maximumP95DurationMs: 2500,
      maximumLastObservationAgeMinutes: 15,
      rollbackReminderMinutes: 60,
      webhookTimeoutMs: 5000,
      staleLockMinutes: 15,
    },
  );
});

test("watch options reject missing, duplicate, unknown, and unsafe values", () => {
  assert.throws(
    () =>
      parseV1PrimaryCanaryWatchOptions([
        "--file=logs/order-primary.jsonl",
        "--site=10000000",
        `--activated-at=${ACTIVATED_AT}`,
      ]),
    /state_file_is_required/,
  );
  assert.throws(
    () =>
      parseV1PrimaryCanaryWatchOptions([
        "--file=-",
        "--state-file=-",
        "--site=10000000",
        `--activated-at=${ACTIVATED_AT}`,
      ]),
    /state_file_cannot_be_stdin/,
  );
  assert.throws(
    () =>
      parseV1PrimaryCanaryWatchOptions([
        "--file=-",
        "--state-file=watch.json",
        "--state-file=watch-2.json",
        "--site=10000000",
        `--activated-at=${ACTIVATED_AT}`,
      ]),
    /duplicate_argument:state-file/,
  );
  assert.throws(
    () =>
      parseV1PrimaryCanaryWatchOptions([
        "--file=-",
        "--state-file=watch.json",
        "--site=10000000",
        `--activated-at=${ACTIVATED_AT}`,
        "--auto-rollback=true",
      ]),
    /unknown_argument:auto-rollback/,
  );
  assert.throws(
    () =>
      parseV1PrimaryCanaryWatchOptions([
        "--file=-",
        "--state-file=watch.json",
        "--site=10000000",
        `--activated-at=${ACTIVATED_AT}`,
        "--rollback-reminder-minutes=1",
      ]),
    /rollback_reminder_minutes_must_be_between_5_and_1440/,
  );
});

test("watch runtime is opt-in and accepts only credential-safe HTTPS webhooks", () => {
  assert.deepEqual(resolveV1PrimaryCanaryWatchRuntimeConfig({}), {
    enabled: false,
    webhookUrl: null,
    bearerToken: null,
  });
  assert.deepEqual(
    resolveV1PrimaryCanaryWatchRuntimeConfig({
      MERCHANT_ORDER_V1_PRIMARY_CANARY_WATCH_ENABLED: "TRUE",
      MERCHANT_ORDER_V1_PRIMARY_CANARY_ALERT_WEBHOOK_URL:
        "https://alerts.example.test/canary",
      MERCHANT_ORDER_V1_PRIMARY_CANARY_ALERT_BEARER_TOKEN: "secret",
    }),
    {
      enabled: true,
      webhookUrl: "https://alerts.example.test/canary",
      bearerToken: "secret",
    },
  );
  assert.throws(
    () =>
      resolveV1PrimaryCanaryWatchRuntimeConfig({
        MERCHANT_ORDER_V1_PRIMARY_CANARY_ALERT_WEBHOOK_URL:
          "http://alerts.example.test/canary",
      }),
    /webhook_url_must_be_valid_https/,
  );
  assert.throws(
    () =>
      resolveV1PrimaryCanaryWatchRuntimeConfig({
        MERCHANT_ORDER_V1_PRIMARY_CANARY_ALERT_BEARER_TOKEN: "secret",
      }),
    /webhook_url_required_for_bearer_token/,
  );
});

test("watch state is written atomically and can be loaded for the same canary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "faolla-canary-watch-"));
  const stateFile = join(directory, "watch.json");
  const state = {
    schemaVersion: 1 as const,
    siteId: "10000000",
    activatedAt: ACTIVATED_AT,
    updatedAt: "2026-07-26T12:00:00.000Z",
    current: {
      status: "healthy" as const,
      fingerprint: "healthy|-|-",
      evaluatedAt: "2026-07-26T12:00:00.000Z",
      sampleCount: 100,
      fallbackCount: 0,
      circuitOpenCount: 0,
      p95DurationMs: 100,
      latestObservationAgeMinutes: 1,
      rollbackReasons: [],
      observationBlockers: [],
    },
    lastNotification: null,
    pendingNotification: null,
  };

  try {
    await writeV1PrimaryCanaryWatchState(stateFile, state);
    assert.match(await readFile(stateFile, "utf8"), /"schemaVersion": 1/);
    assert.deepEqual(
      await readV1PrimaryCanaryWatchState(stateFile, {
        siteId: "10000000",
        activatedAt: ACTIVATED_AT,
      }),
      state,
    );
    const updatedState = {
      ...state,
      updatedAt: "2026-07-26T12:05:00.000Z",
      current: {
        ...state.current,
        evaluatedAt: "2026-07-26T12:05:00.000Z",
        sampleCount: 105,
      },
    };
    await writeV1PrimaryCanaryWatchState(stateFile, updatedState);
    assert.deepEqual(
      await readV1PrimaryCanaryWatchState(stateFile, {
        siteId: "10000000",
        activatedAt: ACTIVATED_AT,
      }),
      updatedState,
    );
    assert.equal(
      await readV1PrimaryCanaryWatchState(join(directory, "missing.json"), {
        siteId: "10000000",
        activatedAt: ACTIVATED_AT,
      }),
      null,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("webhook delivery sends a bounded event with idempotency and authorization", async () => {
  const notification: MerchantOrderV1PrimaryCanaryWatchNotification = {
    schemaVersion: 1,
    id: "order-v1-primary-canary:10000000:1:initial_issue",
    event: "merchant_order_v1_primary_canary_watch",
    kind: "initial_issue",
    severity: "critical",
    createdAt: "2026-07-26T12:00:00.000Z",
    siteId: "10000000",
    activatedAt: ACTIVATED_AT,
    previousStatus: null,
    current: {
      status: "rollback_required",
      fingerprint: "rollback_required|fallback_observed|-",
      evaluatedAt: "2026-07-26T12:00:00.000Z",
      sampleCount: 100,
      fallbackCount: 1,
      circuitOpenCount: 0,
      p95DurationMs: 100,
      latestObservationAgeMinutes: 1,
      rollbackReasons: ["fallback_observed"],
      observationBlockers: [],
    },
    message: "rollback",
    action: "disable primary",
  };
  let capturedInit: RequestInit | undefined;

  await deliverV1PrimaryCanaryWatchWebhook({
    url: "https://alerts.example.test/canary",
    bearerToken: "secret",
    timeoutMs: 1000,
    notification,
    fetchImpl: async (_url, init) => {
      capturedInit = init;
      return { ok: true, status: 204 };
    },
  });

  assert.equal(capturedInit?.method, "POST");
  assert.equal(
    (capturedInit?.headers as Record<string, string>)["Idempotency-Key"],
    notification.id,
  );
  assert.equal(
    (capturedInit?.headers as Record<string, string>).Authorization,
    "Bearer secret",
  );
  assert.deepEqual(
    JSON.parse(String(capturedInit?.body)),
    notification,
  );
  await assert.rejects(
    deliverV1PrimaryCanaryWatchWebhook({
      url: "https://alerts.example.test/canary",
      bearerToken: null,
      timeoutMs: 1000,
      notification,
      fetchImpl: async () => ({ ok: false, status: 503 }),
    }),
    /webhook_http_503/,
  );
});
