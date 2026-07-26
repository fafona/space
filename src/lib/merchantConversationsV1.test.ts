import assert from "node:assert/strict";
import test from "node:test";

import type { MerchantPeerInboxPayload } from "@/lib/merchantPeerInbox";
import type { MerchantSupportReadStatePayload } from "@/lib/merchantSupportReadState";
import type { PlatformSupportInboxPayload } from "@/lib/platformSupportInbox";
import {
  buildMerchantConversationReadStateV1Mutation,
  buildMerchantPeerConversationThreadId,
  buildMerchantPeerConversationV1Mutation,
  buildPlatformSupportConversationThreadId,
  buildPlatformSupportConversationV1Mutation,
  mergeMerchantConversationV1Mutations,
} from "@/lib/merchantConversationsV1";

function buildPeerInbox(): MerchantPeerInboxPayload {
  return {
    contacts: [
      {
        ownerMerchantId: "10000000",
        contactMerchantId: "10000001",
        contactName: "Peer",
        contactEmail: "peer@example.com",
        savedAt: "2026-07-25T08:00:00.000Z",
      },
      {
        ownerMerchantId: "10000001",
        contactMerchantId: "10000000",
        contactName: "Owner",
        contactEmail: "owner@example.com",
        savedAt: "2026-07-25T08:00:00.000Z",
      },
    ],
    threads: [
      {
        threadKey: "10000000::10000001",
        merchantAId: "10000000",
        merchantAName: "Owner",
        merchantAEmail: "owner@example.com",
        merchantBId: "10000001",
        merchantBName: "Peer",
        merchantBEmail: "peer@example.com",
        updatedAt: "2026-07-25T09:00:00.000Z",
        messages: [
          {
            id: "message-1",
            senderMerchantId: "10000000",
            text: "hello",
            createdAt: "2026-07-25T09:00:00.000Z",
          },
        ],
      },
    ],
  };
}

function buildSupportInbox(): PlatformSupportInboxPayload {
  return {
    threads: [
      {
        merchantId: "10000000",
        siteId: "10000000",
        merchantName: "Owner",
        merchantEmail: "owner@example.com",
        updatedAt: "2026-07-25T10:00:00.000Z",
        messages: [
          {
            id: "support-1",
            sender: "super_admin",
            text: "support reply",
            createdAt: "2026-07-25T10:00:00.000Z",
          },
        ],
      },
    ],
  };
}

test("peer mapping scopes contacts to the allowlisted owner and links a canonical customer", () => {
  const mutation = buildMerchantPeerConversationV1Mutation({
    current: buildPeerInbox(),
    accountIds: ["10000000"],
  });

  assert.equal(mutation.threads.length, 1);
  assert.equal(
    mutation.threads[0]?.thread.id,
    buildMerchantPeerConversationThreadId("10000000", "10000001"),
  );
  assert.equal(mutation.threads[0]?.messages[0]?.body, "hello");
  assert.equal(mutation.contacts.length, 1);
  assert.equal(mutation.contacts[0]?.owner_merchant_id, "10000000");
  assert.equal(
    mutation.contacts[0]?.customer.account_id,
    "10000001",
  );
  assert.equal(mutation.contacts[0]?.customer.merchant_id, "10000000");
});

test("peer mapping emits only a newly appended message", () => {
  const previous = buildPeerInbox();
  const current = buildPeerInbox();
  current.threads[0]?.messages.push({
    id: "message-2",
    senderMerchantId: "10000001",
    text: "new",
    createdAt: "2026-07-25T09:01:00.000Z",
  });
  if (current.threads[0]) {
    current.threads[0].updatedAt = "2026-07-25T09:01:00.000Z";
  }

  const mutation = buildMerchantPeerConversationV1Mutation({
    current,
    previous,
    accountIds: ["10000000"],
  });

  assert.equal(mutation.threads.length, 1);
  assert.deepEqual(
    mutation.threads[0]?.messages.map((message) => message.id),
    ["message-2"],
  );
  assert.equal(mutation.contacts.length, 0);
});

test("support mapping retains sender roles and archives removed threads on replace", () => {
  const previous = buildSupportInbox();
  const current: PlatformSupportInboxPayload = { threads: [] };
  const mutation = buildPlatformSupportConversationV1Mutation({
    current,
    previous,
    accountIds: ["10000000"],
    replace: true,
    operationAt: "2026-07-25T11:00:00.000Z",
  });

  assert.deepEqual(mutation.archived_threads, [
    {
      id: buildPlatformSupportConversationThreadId("10000000"),
      archived_at: "2026-07-25T11:00:00.000Z",
    },
  ]);

  const active = buildPlatformSupportConversationV1Mutation({
    current: previous,
    accountIds: ["10000000"],
  });
  assert.equal(active.threads[0]?.messages[0]?.sender_role, "platform");
  assert.equal(active.threads[0]?.thread.conversation_kind, "support");
});

test("read state maps official and peer cursors without moving other accounts", () => {
  const payload: MerchantSupportReadStatePayload = {
    accounts: [
      {
        accountId: "10000000",
        officialLastReadAt: "2026-07-25T10:00:00.000Z",
        peerLastRead: {
          "10000001": "2026-07-25T09:00:00.000Z",
        },
        updatedAt: "2026-07-25T10:00:00.000Z",
      },
      {
        accountId: "10000002",
        officialLastReadAt: "2026-07-25T08:00:00.000Z",
        peerLastRead: {},
        updatedAt: "2026-07-25T08:00:00.000Z",
      },
    ],
  };

  const mutation = buildMerchantConversationReadStateV1Mutation({
    current: payload,
    accountIds: ["10000000"],
  });

  assert.deepEqual(
    mutation.read_cursors.map((cursor) => cursor.thread_id),
    [
      buildMerchantPeerConversationThreadId("10000000", "10000001"),
      buildPlatformSupportConversationThreadId("10000000"),
    ],
  );
  assert.equal(
    mutation.read_cursors.every(
      (cursor) => cursor.account_id === "10000000",
    ),
    true,
  );
});

test("merged conversation mutations are deterministic and prefer latest cursors", () => {
  const peer = buildMerchantPeerConversationV1Mutation({
    current: buildPeerInbox(),
    accountIds: ["10000000"],
  });
  const support = buildPlatformSupportConversationV1Mutation({
    current: buildSupportInbox(),
    accountIds: ["10000000"],
  });
  const first = mergeMerchantConversationV1Mutations(peer, support);
  const second = mergeMerchantConversationV1Mutations(support, peer);

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.threads.map((thread) => thread.thread.id),
    [
      buildMerchantPeerConversationThreadId("10000000", "10000001"),
      buildPlatformSupportConversationThreadId("10000000"),
    ],
  );
});
