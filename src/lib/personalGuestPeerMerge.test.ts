import assert from "node:assert/strict";
import test from "node:test";
import { findMerchantPeerThreadForMerchants, listMerchantPeerContactsForMerchant } from "@/lib/merchantPeerInbox";
import { mergePersonalGuestPeerDataIntoMerchantPeerInbox } from "@/lib/personalGuestPeerMerge";

test("guest peer merge rewrites guest sender to the logged in account", () => {
  const result = mergePersonalGuestPeerDataIntoMerchantPeerInbox(
    { contacts: [], threads: [] },
    {
      guestAccountId: "11112222",
      targetAccountId: "33334444",
      targetName: "Logged customer",
      targetEmail: "customer@example.com",
      guestHash: "sha256:abc123",
      peerContacts: [
        {
          merchantId: "87654321",
          merchantName: "Peer merchant",
          merchantEmail: "peer@example.com",
          savedAt: "2026-07-04T10:00:00.000Z",
        },
      ],
      peerThreads: [
        {
          merchantAId: "11112222",
          merchantAName: "Guest",
          merchantBId: "87654321",
          merchantBName: "Peer merchant",
          merchantBEmail: "peer@example.com",
          updatedAt: "2026-07-04T10:01:00.000Z",
          messages: [
            {
              id: "local-msg-1",
              senderMerchantId: "11112222",
              text: "hello from guest",
              createdAt: "2026-07-04T10:01:00.000Z",
            },
          ],
        },
      ],
    },
  );

  assert.equal(result.contactCount, 1);
  assert.equal(result.messageCount, 1);
  assert.equal(result.skippedContactCount, 0);
  assert.equal(result.skippedThreadCount, 0);
  assert.equal(result.skippedMessageCount, 0);

  const contactsForCustomer = listMerchantPeerContactsForMerchant(result.payload, "33334444");
  const contactsForMerchant = listMerchantPeerContactsForMerchant(result.payload, "87654321");
  assert.equal(contactsForCustomer[0]?.merchantId, "87654321");
  assert.equal(contactsForMerchant[0]?.merchantId, "33334444");

  const thread = findMerchantPeerThreadForMerchants(result.payload, "33334444", "87654321");
  assert.equal(thread?.messages.length, 1);
  assert.equal(thread?.messages[0]?.senderMerchantId, "33334444");
  assert.equal(thread?.messages[0]?.text, "hello from guest");
  assert.match(thread?.messages[0]?.id ?? "", /^guest-peer:sha256:abc123:/);
});

test("guest peer merge is idempotent for repeated local messages", () => {
  const input = {
    guestAccountId: "11112222",
    targetAccountId: "33334444",
    targetName: "Logged customer",
    guestHash: "sha256:abc123",
    peerThreads: [
      {
        merchantAId: "11112222",
        merchantBId: "87654321",
        merchantBName: "Peer merchant",
        messages: [
          {
            id: "local-msg-1",
            senderMerchantId: "11112222",
            text: "hello from guest",
            createdAt: "2026-07-04T10:01:00.000Z",
          },
        ],
      },
    ],
  };

  const first = mergePersonalGuestPeerDataIntoMerchantPeerInbox({ contacts: [], threads: [] }, input);
  const second = mergePersonalGuestPeerDataIntoMerchantPeerInbox(first.payload, input);
  const thread = findMerchantPeerThreadForMerchants(second.payload, "33334444", "87654321");

  assert.equal(thread?.messages.length, 1);
  assert.equal(thread?.messages[0]?.text, "hello from guest");
});

test("guest peer merge keeps unrelated or spoofed messages out", () => {
  const result = mergePersonalGuestPeerDataIntoMerchantPeerInbox(
    { contacts: [], threads: [] },
    {
      guestAccountId: "11112222",
      targetAccountId: "33334444",
      peerContacts: [{ merchantId: "33334444", merchantName: "Self" }],
      peerThreads: [
        {
          merchantAId: "99990000",
          merchantBId: "87654321",
          messages: [{ id: "bad", senderMerchantId: "99990000", text: "spoof" }],
        },
        {
          merchantAId: "11112222",
          merchantBId: "87654321",
          messages: [{ id: "bad-sender", senderMerchantId: "99990000", text: "spoof" }],
        },
      ],
    },
  );

  assert.equal(result.contactCount, 0);
  assert.equal(result.messageCount, 0);
  assert.equal(result.skippedContactCount, 1);
  assert.equal(result.skippedThreadCount, 1);
  assert.equal(result.skippedMessageCount, 1);
  assert.equal(result.payload.threads.length, 0);
});
