import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMerchantConversationBackfillPlan,
  normalizeMerchantConversationBackfillBatchSize,
} from "@/lib/merchantConversationBackfill.server";
import type { MerchantPeerInboxPayload } from "@/lib/merchantPeerInbox";
import type { MerchantSupportReadStatePayload } from "@/lib/merchantSupportReadState";
import type { PlatformSupportInboxPayload } from "@/lib/platformSupportInbox";

const PEER_TIME = "2026-07-25T09:00:00.000Z";
const SUPPORT_TIME = "2026-07-25T10:00:00.000Z";

function buildPeerInbox(): MerchantPeerInboxPayload {
  return {
    contacts: [
      {
        ownerMerchantId: "10000000",
        contactMerchantId: "10000001",
        contactName: "Peer",
        contactEmail: "peer@example.com",
        savedAt: PEER_TIME,
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
        updatedAt: PEER_TIME,
        messages: [
          {
            id: "peer-message-1",
            senderMerchantId: "10000001",
            text: "Hello",
            createdAt: PEER_TIME,
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
        updatedAt: SUPPORT_TIME,
        messages: [
          {
            id: "support-message-1",
            sender: "super_admin",
            text: "Welcome",
            createdAt: SUPPORT_TIME,
          },
        ],
      },
    ],
  };
}

function buildReadState(): MerchantSupportReadStatePayload {
  return {
    accounts: [
      {
        accountId: "10000000",
        officialLastReadAt: SUPPORT_TIME,
        peerLastRead: { "10000001": PEER_TIME },
        updatedAt: SUPPORT_TIME,
      },
    ],
  };
}

test("conversation backfill batch size is safely bounded", () => {
  assert.equal(normalizeMerchantConversationBackfillBatchSize(undefined), 10);
  assert.equal(normalizeMerchantConversationBackfillBatchSize(0), 1);
  assert.equal(normalizeMerchantConversationBackfillBatchSize(500), 50);
});

test("conversation backfill is deterministic and writes cursors after threads", () => {
  const build = () =>
    buildMerchantConversationBackfillPlan({
      accountId: "10000000",
      peerInbox: buildPeerInbox(),
      supportInbox: buildSupportInbox(),
      readState: buildReadState(),
      batchSize: 1,
    });
  const first = build();
  const second = build();

  assert.equal(first.blockers.length, 0);
  assert.equal(first.threadCount, 2);
  assert.equal(first.participantCount, 4);
  assert.equal(first.messageCount, 2);
  assert.equal(first.contactCount, 1);
  assert.equal(first.readCursorCount, 2);
  assert.equal(first.batches.length, 2);
  assert.equal(first.batches[0]?.contacts.length, 1);
  assert.equal(first.batches[0]?.read_cursors.length, 0);
  assert.equal(first.batches[1]?.read_cursors.length, 2);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test("conversation backfill reports identity, duplicate and cursor blockers", () => {
  const peerInbox = buildPeerInbox();
  peerInbox.threads[0] = {
    ...peerInbox.threads[0]!,
    threadKey: "wrong",
    updatedAt: "bad",
    messages: [
      {
        id: "duplicate",
        senderMerchantId: "10000009",
        text: "",
        createdAt: "bad",
      },
      {
        id: "duplicate",
        senderMerchantId: "10000001",
        text: "valid",
        createdAt: PEER_TIME,
      },
    ],
  };
  peerInbox.contacts.push({ ...peerInbox.contacts[0]! });
  const supportInbox = buildSupportInbox();
  supportInbox.threads[0] = {
    ...supportInbox.threads[0]!,
    siteId: "10000001",
  };
  const readState = buildReadState();
  readState.accounts[0] = {
    ...readState.accounts[0]!,
    officialLastReadAt: "2026-07-25T10:01:00.000Z",
    peerLastRead: { "10000001": "2026-07-25T09:01:00.000Z" },
  };

  const plan = buildMerchantConversationBackfillPlan({
    accountId: "10000000",
    peerInbox,
    supportInbox,
    readState,
  });
  const codes = new Set(plan.blockers.map((blocker) => blocker.code));
  assert.equal(codes.has("invalid_peer_thread_key"), true);
  assert.equal(codes.has("invalid_thread_updated_at"), true);
  assert.equal(codes.has("duplicate_message_id"), true);
  assert.equal(codes.has("invalid_message_sender"), true);
  assert.equal(codes.has("missing_message_body"), true);
  assert.equal(codes.has("invalid_message_at"), true);
  assert.equal(codes.has("duplicate_contact"), true);
  assert.equal(codes.has("support_site_mismatch"), true);
  assert.equal(codes.has("read_cursor_message_not_found"), true);
});
