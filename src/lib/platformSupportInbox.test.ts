import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlatformSupportInboxBlocks,
  createPlatformSupportMessage,
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
