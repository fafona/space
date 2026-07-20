import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlatformSupportInboxBlocks,
  createPlatformSupportMessage,
  mergePlatformSupportInboxPayloads,
  readPlatformSupportInboxFromBlocks,
  upsertPlatformSupportThread,
} from "@/lib/platformSupportInbox";

test("support inbox blocks round-trip thread messages", () => {
  const payload = {
    threads: [
      {
        merchantId: "10000000",
        siteId: "10000000",
        merchantName: "fafona",
        merchantEmail: "fafona@example.com",
        updatedAt: "2026-03-31T10:00:00.000Z",
        messages: [
          createPlatformSupportMessage({
            id: "m1",
            sender: "merchant",
            text: "hello",
            createdAt: "2026-03-31T09:00:00.000Z",
          }),
          createPlatformSupportMessage({
            id: "m2",
            sender: "super_admin",
            text: "world",
            createdAt: "2026-03-31T10:00:00.000Z",
          }),
        ],
      },
    ],
  };

  const blocks = buildPlatformSupportInboxBlocks(payload);
  const restored = readPlatformSupportInboxFromBlocks(blocks);
  assert.equal(restored.threads.length, 1);
  assert.equal(restored.threads[0]?.merchantId, "10000000");
  assert.equal(restored.threads[0]?.messages.length, 2);
  assert.equal(restored.threads[0]?.messages[1]?.sender, "super_admin");
});

test("upsertPlatformSupportThread appends and sorts newest thread first", () => {
  const first = upsertPlatformSupportThread(
    { threads: [] },
    {
      merchantId: "10000000",
      merchantName: "fafona",
      merchantEmail: "fafona@example.com",
      message: createPlatformSupportMessage({
        id: "m1",
        sender: "merchant",
        text: "first",
        createdAt: "2026-03-31T09:00:00.000Z",
      }),
    },
  );
  const second = upsertPlatformSupportThread(first, {
    merchantId: "10000001",
    merchantName: "other",
    message: createPlatformSupportMessage({
      id: "m2",
      sender: "merchant",
      text: "second",
      createdAt: "2026-03-31T10:00:00.000Z",
    }),
  });
  const third = upsertPlatformSupportThread(second, {
    merchantId: "10000000",
    message: createPlatformSupportMessage({
      id: "m3",
      sender: "super_admin",
      text: "reply",
      createdAt: "2026-03-31T11:00:00.000Z",
    }),
  });

  assert.equal(third.threads.length, 2);
  assert.equal(third.threads[0]?.merchantId, "10000000");
  assert.equal(third.threads[0]?.messages.length, 2);
  assert.equal(third.threads[0]?.messages[1]?.text, "reply");
});

test("support message ids are idempotent", () => {
  const first = upsertPlatformSupportThread(
    { threads: [] },
    {
      merchantId: "10000000",
      message: createPlatformSupportMessage({
        id: "same-message",
        sender: "merchant",
        text: "first",
        createdAt: "2026-03-31T09:00:00.000Z",
      }),
    },
  );
  const second = upsertPlatformSupportThread(first, {
    merchantId: "10000000",
    message: createPlatformSupportMessage({
      id: "same-message",
      sender: "merchant",
      text: "duplicate",
      createdAt: "2026-03-31T10:00:00.000Z",
    }),
  });

  assert.equal(second.threads[0]?.messages.length, 1);
  assert.equal(second.threads[0]?.messages[0]?.text, "first");
});

test("concurrent support snapshots merge without dropping replies", () => {
  const merchantSnapshot = upsertPlatformSupportThread(
    { threads: [] },
    {
      merchantId: "10000000",
      message: createPlatformSupportMessage({
        id: "merchant-message",
        sender: "merchant",
        text: "question",
        createdAt: "2026-03-31T09:00:00.000Z",
      }),
    },
  );
  const adminSnapshot = upsertPlatformSupportThread(
    { threads: [] },
    {
      merchantId: "10000000",
      message: createPlatformSupportMessage({
        id: "admin-message",
        sender: "super_admin",
        text: "answer",
        createdAt: "2026-03-31T09:00:01.000Z",
      }),
    },
  );

  const merged = mergePlatformSupportInboxPayloads(merchantSnapshot, adminSnapshot);
  assert.deepEqual(
    merged.threads[0]?.messages.map((message) => message.id),
    ["merchant-message", "admin-message"],
  );
});

test("an older support snapshot cannot restore stale merchant metadata", () => {
  const current = upsertPlatformSupportThread(
    { threads: [] },
    {
      merchantId: "10000000",
      merchantName: "Current merchant",
      merchantEmail: "current@example.com",
      message: createPlatformSupportMessage({
        id: "current-message",
        sender: "merchant",
        text: "current",
        createdAt: "2026-03-31T10:00:00.000Z",
      }),
    },
  );
  const stale = upsertPlatformSupportThread(
    { threads: [] },
    {
      merchantId: "10000000",
      merchantName: "Old merchant",
      merchantEmail: "old@example.com",
      message: createPlatformSupportMessage({
        id: "old-message",
        sender: "merchant",
        text: "old",
        createdAt: "2026-03-31T09:00:00.000Z",
      }),
    },
  );

  const merged = mergePlatformSupportInboxPayloads(current, stale);
  assert.equal(merged.threads[0]?.merchantName, "Current merchant");
  assert.equal(merged.threads[0]?.merchantEmail, "current@example.com");
  assert.deepEqual(
    merged.threads[0]?.messages.map((message) => message.id),
    ["old-message", "current-message"],
  );
});
