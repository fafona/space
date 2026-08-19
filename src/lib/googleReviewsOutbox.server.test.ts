import assert from "node:assert/strict";
import test from "node:test";

import type { GoogleBusinessProfileIntegration } from "@/lib/googleBusinessProfileStore";
import {
  buildGoogleReviewsSyncOutboxInput,
  createGoogleReviewsSyncOutboxHandler,
  enqueueGoogleReviewsSyncShadow,
} from "@/lib/googleReviewsOutbox.server";
import type { MerchantOutboxClaimedEvent } from "@/lib/merchantOutbox.server";
import type { MerchantOutboxEnqueueConfig } from "@/lib/merchantOutboxEnqueue.server";
import { GoogleBusinessProfileRequestError } from "@/lib/googleBusinessProfileServer";
import { MerchantOutboxTaskError } from "@/lib/merchantOutboxWorker.server";

const enabledConfig: MerchantOutboxEnqueueConfig = {
  mode: "shadow",
  siteIds: ["10000000"],
  eventTypes: ["google.reviews.sync"],
  timeoutMs: 2000,
};

function integration(
  overrides: Partial<GoogleBusinessProfileIntegration> = {},
): GoogleBusinessProfileIntegration {
  return {
    version: 1,
    siteId: "10000000",
    tokens: {
      accessToken: {
        version: 1,
        algorithm: "aes-256-gcm",
        iv: "iv",
        authTag: "tag",
        ciphertext: "ciphertext",
      },
      refreshToken: null,
      expiresAt: "2026-07-25T12:00:00.000Z",
      tokenType: "Bearer",
      scope: "business.manage",
    },
    accounts: [],
    locations: [],
    selectedAccountName: "accounts/1",
    selectedLocationName: "locations/1",
    snapshot: null,
    connectedAt: "2026-07-25T10:00:00.000Z",
    updatedAt: "2026-07-25T10:00:00.000Z",
    lastError: "",
    lastErrorAt: "",
    ...overrides,
  };
}

function claimedEvent(
  overrides: Partial<MerchantOutboxClaimedEvent> = {},
): MerchantOutboxClaimedEvent {
  return {
    id: "123e4567-e89b-42d3-a456-426614174000",
    merchantId: "10000000",
    eventKey: "google.reviews.sync:abc",
    eventType: "google.reviews.sync",
    aggregateType: "google_reviews",
    aggregateId: "10000000",
    payload: {
      version: 1,
      reason: "stale_public_read",
      requestedAt: "2026-07-25T10:00:00.000Z",
    },
    attempts: 1,
    totalAttempts: 1,
    replayCount: 0,
    maxAttempts: 6,
    correlationId: "",
    leaseExpiresAt: "2026-07-25T10:01:00.000Z",
    createdAt: "2026-07-25T10:00:00.000Z",
    ...overrides,
  };
}

test("Google review sync input deduplicates requests within one time window", () => {
  const first = buildGoogleReviewsSyncOutboxInput({
    siteId: "10000000",
    reason: "stale_public_read",
    requestedAt: "2026-07-25T10:01:00.000Z",
    dedupeWindowMs: 15 * 60 * 1000,
  });
  const second = buildGoogleReviewsSyncOutboxInput({
    siteId: "10000000",
    reason: "stale_public_read",
    requestedAt: "2026-07-25T10:14:59.000Z",
    dedupeWindowMs: 15 * 60 * 1000,
  });
  assert.equal(first.operationId, second.operationId);
  assert.deepEqual(first.payload, second.payload);
  assert.equal(first.eventType, "google.reviews.sync");
  assert.equal(first.aggregateId, "10000000");
});

test("Google review shadow enqueue remains disabled without generic rollout flags", async () => {
  let calls = 0;
  const result = await enqueueGoogleReviewsSyncShadow(
    {
      rpc: async () => {
        calls += 1;
        return { data: null, error: null };
      },
    },
    {
      siteId: "10000000",
      reason: "stale_public_read",
      requestedAt: "2026-07-25T10:01:00.000Z",
    },
  );
  assert.equal(result.status, "disabled");
  assert.equal(calls, 0);
});

test("Google review shadow enqueue uses an opaque event without OAuth secrets", async () => {
  const events: Record<string, unknown>[] = [];
  const result = await enqueueGoogleReviewsSyncShadow(
    {
      rpc: async (_name, args) => {
        events.push(args.p_event as Record<string, unknown>);
        return {
          data: {
            id: "123e4567-e89b-42d3-a456-426614174000",
            deduplicated: false,
          },
          error: null,
        };
      },
    },
    {
      siteId: "10000000",
      reason: "stale_public_read",
      requestedAt: "2026-07-25T10:01:00.000Z",
    },
    { config: enabledConfig },
  );
  assert.equal(result.status, "queued");
  assert.equal(JSON.stringify(events).includes("token"), false);
  assert.deepEqual(events[0]?.payload, {
    version: 1,
    reason: "stale_public_read",
    requestedAt: "2026-07-25T10:00:00.000Z",
  });
});

test("Google review handler synchronizes and stores an aggregate-only result", async () => {
  const saved: GoogleBusinessProfileIntegration[] = [];
  const source = integration();
  const next = integration({
    snapshot: {
      reviews: [],
      averageRating: 4.8,
      totalReviewCount: 23,
      syncedAt: "2026-07-25T10:02:00.000Z",
    },
    updatedAt: "2026-07-25T10:02:00.000Z",
  });
  const handler = createGoogleReviewsSyncOutboxHandler(
    {} as never,
    {
      load: async () => source,
      sync: async (_integration, options) => {
        assert.equal(options.signal.aborted, false);
        return next;
      },
      save: async (_client, value) => {
        saved.push(value);
        return value;
      },
    },
  );
  const result = await handler(claimedEvent(), {
    signal: new AbortController().signal,
    renewLease: async () => true,
  });
  assert.deepEqual(result, {
    syncedAt: "2026-07-25T10:02:00.000Z",
    reviewCount: 0,
    totalReviewCount: 23,
  });
  assert.equal(saved.length, 1);
});

test("Google review handler classifies authorization errors as nonretryable", async () => {
  const handler = createGoogleReviewsSyncOutboxHandler(
    {} as never,
    {
      load: async () => integration(),
      sync: async () => {
        throw new GoogleBusinessProfileRequestError(
          "private backend detail",
          401,
          "google_reauthorization_required",
        );
      },
      save: async (_client, value) => value,
    },
  );
  await assert.rejects(
    () =>
      handler(claimedEvent(), {
        signal: new AbortController().signal,
        renewLease: async () => true,
      }),
    (error) =>
      error instanceof MerchantOutboxTaskError &&
      error.code === "google_reauthorization_required" &&
      error.retryable === false &&
      !error.message.includes("private backend detail"),
  );
});

test("Google review handler passes aborts into the retry path", async () => {
  const controller = new AbortController();
  controller.abort();
  const handler = createGoogleReviewsSyncOutboxHandler(
    {} as never,
    {
      load: async () => integration(),
      sync: async () => integration(),
      save: async (_client, value) => value,
    },
  );
  await assert.rejects(
    () =>
      handler(claimedEvent(), {
        signal: controller.signal,
        renewLease: async () => true,
      }),
    (error) =>
      error instanceof MerchantOutboxTaskError &&
      error.code === "google_reviews_sync_aborted" &&
      error.retryable,
  );
});

test("Google review handler dead-letters malformed task payloads", async () => {
  const handler = createGoogleReviewsSyncOutboxHandler(
    {} as never,
    {
      load: async () => integration(),
      sync: async () => integration(),
      save: async (_client, value) => value,
    },
  );
  await assert.rejects(
    () =>
      handler(
        claimedEvent({
          payload: { version: 1, reason: "unknown", requestedAt: "bad" },
        }),
        {
          signal: new AbortController().signal,
          renewLease: async () => true,
        },
      ),
    (error) =>
      error instanceof MerchantOutboxTaskError &&
      error.retryable === false,
  );
});
