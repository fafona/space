import assert from "node:assert/strict";
import test from "node:test";
import {
  createMerchantPeerMessage,
  listMerchantPeerContactsForMerchant,
  upsertMerchantPeerContact,
  upsertMerchantPeerMessage,
} from "./merchantPeerInbox";

test("searched merchant contacts stay in the owner's left list", () => {
  const payload = upsertMerchantPeerContact(
    { contacts: [], threads: [] },
    {
      ownerMerchantId: "10000001",
      contactMerchantId: "10000002",
      contactName: "Merchant B",
      contactEmail: "merchant-b@example.com",
      savedAt: "2026-04-02T10:00:00.000Z",
    },
  );

  const contacts = listMerchantPeerContactsForMerchant(payload, "10000001");
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0]?.merchantId, "10000002");
  assert.equal(contacts[0]?.merchantName, "Merchant B");
  assert.equal(contacts[0]?.merchantEmail, "merchant-b@example.com");
  assert.equal(contacts[0]?.lastMessage, null);
});

test("sending a merchant message creates reciprocal contacts and a shared thread", () => {
  const payload = upsertMerchantPeerMessage(
    { contacts: [], threads: [] },
    {
      senderMerchantId: "10000001",
      senderMerchantName: "Merchant A",
      senderMerchantEmail: "merchant-a@example.com",
      recipientMerchantId: "10000002",
      recipientMerchantName: "Merchant B",
      recipientMerchantEmail: "merchant-b@example.com",
      message: createMerchantPeerMessage({
        senderMerchantId: "10000001",
        text: "hello",
        createdAt: "2026-04-02T10:00:00.000Z",
        id: "msg-1",
      }),
    },
  );

  const contactsForA = listMerchantPeerContactsForMerchant(payload, "10000001");
  const contactsForB = listMerchantPeerContactsForMerchant(payload, "10000002");

  assert.equal(contactsForA.length, 1);
  assert.equal(contactsForA[0]?.merchantId, "10000002");
  assert.equal(contactsForA[0]?.lastMessage?.text, "hello");

  assert.equal(contactsForB.length, 1);
  assert.equal(contactsForB[0]?.merchantId, "10000001");
  assert.equal(contactsForB[0]?.lastMessage?.text, "hello");
});

test("thread recency drives merchant contact order", () => {
  let payload = upsertMerchantPeerContact(
    { contacts: [], threads: [] },
    {
      ownerMerchantId: "10000001",
      contactMerchantId: "10000003",
      contactName: "Merchant C",
      savedAt: "2026-04-02T09:00:00.000Z",
    },
  );
  payload = upsertMerchantPeerMessage(payload, {
    senderMerchantId: "10000002",
    senderMerchantName: "Merchant B",
    recipientMerchantId: "10000001",
    recipientMerchantName: "Merchant A",
    message: createMerchantPeerMessage({
      senderMerchantId: "10000002",
      text: "latest",
      createdAt: "2026-04-02T11:00:00.000Z",
      id: "msg-latest",
    }),
  });

  const contacts = listMerchantPeerContactsForMerchant(payload, "10000001");
  assert.equal(contacts[0]?.merchantId, "10000002");
  assert.equal(contacts[1]?.merchantId, "10000003");
});
