import assert from "node:assert/strict";
import test from "node:test";
import {
  createMerchantPeerMessage,
  listMerchantPeerContactsForMerchant,
  mergeMerchantPeerInboxPayloads,
  normalizeMerchantPeerInboxPayload,
  upsertMerchantPeerContact,
  upsertMerchantPeerMessage,
} from "./merchantPeerInbox";
import {
  loadStoredMerchantPeerInbox,
  type MerchantPeerInboxStoreClient,
} from "./merchantPeerInboxStore";
import {
  loadStoredMerchantSupportReadState,
  type MerchantSupportReadStateStoreClient,
} from "./merchantSupportReadStateStore";
import {
  loadStoredPlatformSupportInbox,
  type PlatformSupportInboxStoreClient,
} from "./platformSupportInboxStore";

type ConversationStoreClient = MerchantPeerInboxStoreClient &
  MerchantSupportReadStateStoreClient &
  PlatformSupportInboxStoreClient;

function createConversationReadClient(result: { data: unknown; error: unknown }): ConversationStoreClient {
  const query = {
    select: () => query,
    is: () => query,
    eq: () => query,
    limit: () => query,
    maybeSingle: async () => result,
  };
  return { from: () => query } as unknown as ConversationStoreClient;
}

test("conversation stores propagate unexpected read failures instead of reporting empty data", async () => {
  const client = createConversationReadClient({ data: null, error: { message: "upstream timeout" } });

  await assert.rejects(
    () => loadStoredMerchantPeerInbox(client, { bypassCache: true }),
    /merchant_peer_inbox_read_failed:upstream timeout/,
  );
  await assert.rejects(
    () => loadStoredPlatformSupportInbox(client, { bypassCache: true }),
    /platform_support_inbox_read_failed:upstream timeout/,
  );
  await assert.rejects(
    () => loadStoredMerchantSupportReadState(client, { bypassCache: true }),
    /merchant_support_read_state_read_failed:upstream timeout/,
  );
});

test("conversation stores still treat a known legacy schema without slug as empty", async () => {
  const client = createConversationReadClient({ data: null, error: { message: "column pages.slug does not exist" } });

  assert.deepEqual(await loadStoredMerchantPeerInbox(client, { bypassCache: true }), {
    contacts: [],
    threads: [],
  });
  assert.deepEqual(await loadStoredPlatformSupportInbox(client, { bypassCache: true }), { threads: [] });
  assert.deepEqual(await loadStoredMerchantSupportReadState(client, { bypassCache: true }), { accounts: [] });
});

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

test("message ids are idempotent inside an existing thread", () => {
  let payload = upsertMerchantPeerMessage(
    { contacts: [], threads: [] },
    {
      senderMerchantId: "10000001",
      senderMerchantName: "Merchant A",
      recipientMerchantId: "10000002",
      recipientMerchantName: "Merchant B",
      message: createMerchantPeerMessage({
        senderMerchantId: "10000001",
        text: "hello",
        createdAt: "2026-04-02T10:00:00.000Z",
        id: "msg-1",
      }),
    },
  );
  payload = upsertMerchantPeerMessage(payload, {
    senderMerchantId: "10000001",
    senderMerchantName: "Merchant A",
    recipientMerchantId: "10000002",
    recipientMerchantName: "Merchant B",
    message: createMerchantPeerMessage({
      senderMerchantId: "10000001",
      text: "hello again",
      createdAt: "2026-04-02T10:01:00.000Z",
      id: "msg-1",
    }),
  });

  assert.equal(payload.threads.length, 1);
  assert.equal(payload.threads[0]?.messages.length, 1);
  assert.equal(payload.threads[0]?.messages[0]?.text, "hello");
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

test("concurrent inbox snapshots merge without dropping either message", () => {
  const first = upsertMerchantPeerMessage(
    { contacts: [], threads: [] },
    {
      senderMerchantId: "10000001",
      senderMerchantName: "Merchant A",
      recipientMerchantId: "10000002",
      recipientMerchantName: "Merchant B",
      message: createMerchantPeerMessage({
        id: "concurrent-a",
        senderMerchantId: "10000001",
        text: "from A",
        createdAt: "2026-04-02T12:00:00.000Z",
      }),
    },
  );
  const second = upsertMerchantPeerMessage(
    { contacts: [], threads: [] },
    {
      senderMerchantId: "10000002",
      senderMerchantName: "Merchant B",
      recipientMerchantId: "10000001",
      recipientMerchantName: "Merchant A",
      message: createMerchantPeerMessage({
        id: "concurrent-b",
        senderMerchantId: "10000002",
        text: "from B",
        createdAt: "2026-04-02T12:00:01.000Z",
      }),
    },
  );

  const merged = mergeMerchantPeerInboxPayloads(first, second);
  assert.deepEqual(
    merged.threads[0]?.messages.map((message) => message.id),
    ["concurrent-a", "concurrent-b"],
  );
  assert.equal(listMerchantPeerContactsForMerchant(merged, "10000001")[0]?.lastMessage?.id, "concurrent-b");
});

test("normalization removes duplicate messages and messages from outsiders", () => {
  const payload = normalizeMerchantPeerInboxPayload({
    threads: [
      {
        merchantAId: "10000001",
        merchantBId: "10000002",
        messages: [
          { id: "valid", senderMerchantId: "10000001", text: "hello", createdAt: "2026-04-02T12:00:00Z" },
          { id: "valid", senderMerchantId: "10000001", text: "duplicate", createdAt: "2026-04-02T12:00:01Z" },
          { id: "foreign", senderMerchantId: "10000003", text: "invalid", createdAt: "2026-04-02T12:00:02Z" },
        ],
      },
    ],
  });

  assert.equal(payload.threads[0]?.messages.length, 1);
  assert.equal(payload.threads[0]?.messages[0]?.text, "hello");
});

test("an older contact snapshot cannot erase a saved name or move recency backwards", () => {
  const current = upsertMerchantPeerContact(
    { contacts: [], threads: [] },
    {
      ownerMerchantId: "10000001",
      contactMerchantId: "10000002",
      contactName: "Merchant B",
      savedAt: "2026-04-02T12:00:00.000Z",
    },
  );
  const merged = upsertMerchantPeerContact(current, {
    ownerMerchantId: "10000001",
    contactMerchantId: "10000002",
    savedAt: "2026-04-02T10:00:00.000Z",
  });

  assert.equal(merged.contacts[0]?.contactName, "Merchant B");
  assert.equal(merged.contacts[0]?.savedAt, "2026-04-02T12:00:00.000Z");
});

test("an older contact snapshot cannot restore stale profile metadata", () => {
  const current = upsertMerchantPeerContact(
    { contacts: [], threads: [] },
    {
      ownerMerchantId: "10000001",
      contactMerchantId: "10000002",
      contactName: "Current name",
      contactEmail: "current@example.com",
      savedAt: "2026-04-02T12:00:00.000Z",
    },
  );
  const stale = upsertMerchantPeerContact(
    { contacts: [], threads: [] },
    {
      ownerMerchantId: "10000001",
      contactMerchantId: "10000002",
      contactName: "Old name",
      contactEmail: "old@example.com",
      savedAt: "2026-04-02T10:00:00.000Z",
    },
  );

  const merged = mergeMerchantPeerInboxPayloads(current, stale);
  assert.equal(merged.contacts[0]?.contactName, "Current name");
  assert.equal(merged.contacts[0]?.contactEmail, "current@example.com");
});
