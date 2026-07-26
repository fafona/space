import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMerchantOutboxEventMutation,
  MerchantOutboxValidationError,
  normalizeMerchantOutboxClaimedEvent,
} from "@/lib/merchantOutbox.server";

test("outbox mutations use deterministic opaque idempotency keys", () => {
  const input = {
    merchantId: "10000000",
    eventType: "merchant.notification.deliver" as const,
    aggregateType: "order",
    aggregateId: "O10000000202607250001",
    operationId: "order-created:1",
    payload: { orderId: "O10000000202607250001" },
    availableAt: "2026-07-25T10:00:00.000Z",
  };
  const first = buildMerchantOutboxEventMutation(input);
  const second = buildMerchantOutboxEventMutation(input);
  assert.equal(first.event_key, second.event_key);
  assert.match(first.event_key, /^merchant\.notification\.deliver:[0-9a-f]{40}$/);
  assert.equal(first.max_attempts, 8);
  assert.equal(first.priority, 100);
});

test("outbox mutation clamps operational limits", () => {
  const mutation = buildMerchantOutboxEventMutation({
    merchantId: "10000000",
    eventType: "backup.create",
    aggregateType: "merchant",
    aggregateId: "10000000",
    operationId: "daily:2026-07-25",
    payload: {},
    maxAttempts: 999,
    priority: -20,
  });
  assert.equal(mutation.max_attempts, 50);
  assert.equal(mutation.priority, 0);
});

test("outbox mutation rejects secrets anywhere in the payload", () => {
  assert.throws(
    () =>
      buildMerchantOutboxEventMutation({
        merchantId: "10000000",
        eventType: "webhook.deliver",
        aggregateType: "order",
        aggregateId: "order-1",
        operationId: "webhook-1",
        payload: {
          destinationId: "endpoint-1",
          metadata: {
            access_token: "must-not-enter-the-outbox",
          },
        },
      }),
    (error) =>
      error instanceof MerchantOutboxValidationError &&
      error.code === "outbox_payload_contains_secret",
  );
  assert.throws(
    () =>
      buildMerchantOutboxEventMutation({
        merchantId: "10000000",
        eventType: "google.reviews.sync",
        aggregateType: "merchant",
        aggregateId: "10000000",
        operationId: "sync-1",
        payload: { oauthTokenExpiresAt: "2026-07-25T10:00:00.000Z" },
      }),
    /outbox_payload_contains_secret/,
  );
});

test("outbox mutation accepts plain JSON only", () => {
  assert.throws(
    () =>
      buildMerchantOutboxEventMutation({
        merchantId: "10000000",
        eventType: "backup.create",
        aggregateType: "merchant",
        aggregateId: "10000000",
        operationId: "backup-1",
        payload: { requestedAt: new Date() },
      }),
    /outbox_payload_not_plain_json/,
  );
});

test("outbox mutation rejects unknown event types and malformed identities", () => {
  assert.throws(
    () =>
      buildMerchantOutboxEventMutation({
        merchantId: "*",
        eventType: "backup.create",
        aggregateType: "merchant",
        aggregateId: "10000000",
        operationId: "backup-1",
      }),
    /invalid_outbox_merchant_id/,
  );
  assert.throws(
    () =>
      buildMerchantOutboxEventMutation({
        merchantId: "10000000",
        eventType: "arbitrary.execute" as "backup.create",
        aggregateType: "merchant",
        aggregateId: "10000000",
        operationId: "backup-1",
      }),
    /invalid_outbox_event_type/,
  );
});

test("claimed outbox rows normalize the database contract", () => {
  const event = normalizeMerchantOutboxClaimedEvent({
    id: "123e4567-e89b-42d3-a456-426614174000",
    merchant_id: "10000000",
    event_key: "backup.create:abc",
    event_type: "backup.create",
    aggregate_type: "merchant",
    aggregate_id: "10000000",
    payload: { snapshotId: "snapshot-1" },
    status: "processing",
    attempts: 2,
    total_attempts: 4,
    max_attempts: 8,
    correlation_id: "request-1",
    lease_expires_at: "2026-07-25T10:01:00.000Z",
    created_at: "2026-07-25T10:00:00.000Z",
  });
  assert.equal(event.eventType, "backup.create");
  assert.equal(event.totalAttempts, 4);
  assert.deepEqual(event.payload, { snapshotId: "snapshot-1" });
});

test("claimed outbox rows must be processing and carry a valid lease", () => {
  assert.throws(
    () =>
      normalizeMerchantOutboxClaimedEvent({
        id: "123e4567-e89b-42d3-a456-426614174000",
        merchant_id: "10000000",
        event_key: "backup.create:abc",
        event_type: "backup.create",
        aggregate_type: "merchant",
        aggregate_id: "10000000",
        payload: {},
        status: "pending",
        lease_expires_at: "2026-07-25T10:01:00.000Z",
        created_at: "2026-07-25T10:00:00.000Z",
      }),
    /claimed_outbox_not_processing/,
  );
});
