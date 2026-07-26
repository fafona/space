import assert from "node:assert/strict";
import test from "node:test";

import { buildMerchantConversationBackfillPlan } from "@/lib/merchantConversationBackfill.server";
import {
  reconcileMerchantConversationStorage,
  type MerchantConversationContactV1Row,
  type MerchantConversationMessageV1Row,
  type MerchantConversationParticipantV1Row,
  type MerchantConversationReadCursorV1Row,
  type MerchantConversationThreadV1Row,
} from "@/lib/merchantConversationReconciliation";
import type { MerchantPeerInboxPayload } from "@/lib/merchantPeerInbox";
import type { MerchantSupportReadStatePayload } from "@/lib/merchantSupportReadState";
import type { PlatformSupportInboxPayload } from "@/lib/platformSupportInbox";

const PEER_TIME = "2026-07-25T09:00:00.000Z";
const SUPPORT_TIME = "2026-07-25T10:00:00.000Z";

function legacy() {
  const peerInbox: MerchantPeerInboxPayload = {
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
            id: "peer-1",
            senderMerchantId: "10000001",
            text: "Hello",
            createdAt: PEER_TIME,
          },
        ],
      },
    ],
  };
  const supportInbox: PlatformSupportInboxPayload = {
    threads: [
      {
        merchantId: "10000000",
        siteId: "10000000",
        merchantName: "Owner",
        merchantEmail: "owner@example.com",
        updatedAt: SUPPORT_TIME,
        messages: [
          {
            id: "support-1",
            sender: "super_admin",
            text: "Welcome",
            createdAt: SUPPORT_TIME,
          },
        ],
      },
    ],
  };
  const readState: MerchantSupportReadStatePayload = {
    accounts: [
      {
        accountId: "10000000",
        officialLastReadAt: SUPPORT_TIME,
        peerLastRead: { "10000001": PEER_TIME },
        updatedAt: SUPPORT_TIME,
      },
    ],
  };
  return { peerInbox, supportInbox, readState };
}

function v1FromLegacy() {
  const source = legacy();
  const plan = buildMerchantConversationBackfillPlan({
    accountId: "10000000",
    ...source,
  });
  return {
    source,
    v1Threads: plan.expected.threads.map((item) => ({
      ...item.thread,
    })) as MerchantConversationThreadV1Row[],
    v1Participants: plan.expected.threads.flatMap((item) =>
      item.participants.map(
        (participant) => ({ ...participant }),
      ),
    ) as MerchantConversationParticipantV1Row[],
    v1Messages: plan.expected.threads.flatMap((item) =>
      item.messages.map((message) => ({ ...message })),
    ) as MerchantConversationMessageV1Row[],
    v1Contacts: plan.expected.contacts.map(
      (contact) =>
        ({
          ...contact,
          customer_id: "00000000-0000-4000-8000-000000000001",
        }) as MerchantConversationContactV1Row,
    ) as MerchantConversationContactV1Row[],
    v1ReadCursors: plan.expected.read_cursors.map((cursor) => ({
      ...cursor,
    })) as MerchantConversationReadCursorV1Row[],
  };
}

test("conversation reconciliation accepts an exact canonical copy", () => {
  const input = v1FromLegacy();
  const report = reconcileMerchantConversationStorage({
    accountId: "10000000",
    ...input.source,
    v1Threads: input.v1Threads,
    v1Participants: input.v1Participants,
    v1Messages: input.v1Messages,
    v1Contacts: input.v1Contacts,
    v1ReadCursors: input.v1ReadCursors,
  });
  assert.equal(report.isMatch, true);
  assert.equal(report.expectedThreadCount, 2);
});

test("conversation reconciliation reports mutable and immutable mismatches", () => {
  const input = v1FromLegacy();
  input.v1Threads[0] = { ...input.v1Threads[0]!, state: "archived" };
  input.v1Messages[0] = { ...input.v1Messages[0]!, body: "Changed" };
  input.v1Contacts[0] = { ...input.v1Contacts[0]!, customer_id: null };
  input.v1ReadCursors = [];
  const report = reconcileMerchantConversationStorage({
    accountId: "10000000",
    ...input.source,
    v1Threads: input.v1Threads,
    v1Participants: input.v1Participants,
    v1Messages: input.v1Messages,
    v1Contacts: input.v1Contacts,
    v1ReadCursors: input.v1ReadCursors,
  });
  assert.equal(report.isMatch, false);
  assert.equal(report.contactsWithoutCustomer.length, 1);
  assert.equal(report.missingReadCursors.length, 2);
  assert.equal(
    report.mismatches.some(
      (mismatch) =>
        mismatch.entity === "thread" && mismatch.fields.includes("state"),
    ),
    true,
  );
  assert.equal(
    report.mismatches.some(
      (mismatch) =>
        mismatch.entity === "message" && mismatch.fields.includes("body"),
    ),
    true,
  );
});

test("conversation reconciliation allows archived support and retained support history", () => {
  const input = v1FromLegacy();
  input.v1Threads.push({
    id: "support:10000009",
    conversation_kind: "support",
    state: "archived",
    site_id: "10000009",
    source_snapshot: {},
    source_updated_at: SUPPORT_TIME,
    created_at: SUPPORT_TIME,
    updated_at: SUPPORT_TIME,
  });
  input.v1Messages.push({
    thread_id: "support:10000000",
    id: "preserved-support-history",
    sender_account_id: "faolla-support",
    sender_role: "platform",
    body: "Preserved",
    source_snapshot: {},
    created_at: "2026-07-24T10:00:00.000Z",
    source_updated_at: "2026-07-24T10:00:00.000Z",
  });
  const report = reconcileMerchantConversationStorage({
    accountId: "10000000",
    ...input.source,
    v1Threads: input.v1Threads,
    v1Participants: input.v1Participants,
    v1Messages: input.v1Messages,
    v1Contacts: input.v1Contacts,
    v1ReadCursors: input.v1ReadCursors,
  });
  assert.equal(report.isMatch, true);
  assert.deepEqual(report.allowedArchivedThreads, ["support:10000009"]);
  assert.deepEqual(report.allowedHistoricalMessages, [
    "support:10000000:preserved-support-history",
  ]);
});
