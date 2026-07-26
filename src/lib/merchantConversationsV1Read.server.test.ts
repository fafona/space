import assert from "node:assert/strict";
import test from "node:test";

import { buildMerchantConversationBackfillPlan } from "@/lib/merchantConversationBackfill.server";
import type { MerchantPeerInboxPayload } from "@/lib/merchantPeerInbox";
import type { MerchantSupportReadStatePayload } from "@/lib/merchantSupportReadState";
import type { PlatformSupportInboxPayload } from "@/lib/platformSupportInbox";
import {
  isMerchantConversationV1ReadEnabled,
  loadMerchantConversationsV1VerificationData,
  readMerchantConversationsWithV1Verification,
  reserveMerchantConversationV1ReadWindow,
  resolveMerchantConversationV1ReadConfig,
  validateMerchantConversationV1VerificationData,
  type MerchantConversationLegacySnapshot,
  type MerchantConversationV1ReadClient,
  type MerchantConversationV1ReadEvent,
  type MerchantConversationV1VerificationData,
} from "@/lib/merchantConversationsV1Read.server";

const SITE_ID = "10000000";
const PEER_ID = "10000001";
const PEER_TIME = "2026-07-25T09:00:00.000Z";
const SUPPORT_TIME = "2026-07-25T10:00:00.000Z";

function buildLegacy(): MerchantConversationLegacySnapshot {
  const peerInbox: MerchantPeerInboxPayload = {
    contacts: [
      {
        ownerMerchantId: SITE_ID,
        contactMerchantId: PEER_ID,
        contactName: "Peer",
        contactEmail: "peer@example.com",
        savedAt: PEER_TIME,
      },
    ],
    threads: [
      {
        threadKey: `${SITE_ID}::${PEER_ID}`,
        merchantAId: SITE_ID,
        merchantAName: "Owner",
        merchantAEmail: "owner@example.com",
        merchantBId: PEER_ID,
        merchantBName: "Peer",
        merchantBEmail: "peer@example.com",
        updatedAt: PEER_TIME,
        messages: [
          {
            id: "peer-1",
            senderMerchantId: PEER_ID,
            text: "PRIVATE PEER MESSAGE",
            createdAt: PEER_TIME,
          },
        ],
      },
    ],
  };
  const supportInbox: PlatformSupportInboxPayload = {
    threads: [
      {
        merchantId: SITE_ID,
        siteId: SITE_ID,
        merchantName: "Owner",
        merchantEmail: "owner@example.com",
        updatedAt: SUPPORT_TIME,
        messages: [
          {
            id: "support-1",
            sender: "super_admin",
            text: "PRIVATE SUPPORT MESSAGE",
            createdAt: SUPPORT_TIME,
          },
        ],
      },
    ],
  };
  const readState: MerchantSupportReadStatePayload = {
    accounts: [
      {
        accountId: SITE_ID,
        officialLastReadAt: SUPPORT_TIME,
        peerLastRead: { [PEER_ID]: PEER_TIME },
        updatedAt: SUPPORT_TIME,
      },
    ],
  };
  return { peerInbox, supportInbox, readState };
}

function buildMatchingData(
  legacy = buildLegacy(),
): MerchantConversationV1VerificationData {
  const plan = buildMerchantConversationBackfillPlan({
    accountId: SITE_ID,
    ...legacy,
  });
  assert.deepEqual(plan.blockers, []);
  return {
    threads: plan.expected.threads.map((item) => ({ ...item.thread })),
    participants: plan.expected.threads.flatMap((item) =>
      item.participants.map((participant) => ({ ...participant })),
    ),
    messages: plan.expected.threads.flatMap((item) =>
      item.messages.map((message) => ({ ...message })),
    ),
    contacts: plan.expected.contacts.map((contact) => ({
      ...contact,
      customer_id: "00000000-0000-4000-8000-000000000001",
    })),
    readCursors: plan.expected.read_cursors.map((cursor) => ({ ...cursor })),
  };
}

function createReadClient(
  tables: Record<string, Array<Record<string, unknown>>>,
): MerchantConversationV1ReadClient {
  return {
    from: (table) => {
      const equalFilters = new Map<string, unknown>();
      const inFilters = new Map<string, unknown[]>();
      let rangeStart = 0;
      let rangeEnd = Number.MAX_SAFE_INTEGER;
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          equalFilters.set(column, value);
          return query;
        },
        in: (column: string, values: unknown[]) => {
          inFilters.set(column, values);
          return query;
        },
        order: () => query,
        range: (from: number, to: number) => {
          rangeStart = from;
          rangeEnd = to;
          return query;
        },
        then: (
          onfulfilled?: ((
            value: { data: Array<Record<string, unknown>>; error: null },
          ) => unknown) | null,
          onrejected?: ((reason: unknown) => unknown) | null,
        ) => {
          const rows = (tables[table] ?? [])
            .filter((row) =>
              [...equalFilters].every(
                ([column, value]) => row[column] === value,
              ),
            )
            .filter((row) =>
              [...inFilters].every(([column, values]) =>
                values.includes(row[column]),
              ),
            )
            .slice(rangeStart, rangeEnd + 1);
          return Promise.resolve({ data: rows, error: null }).then(
            onfulfilled ?? undefined,
            onrejected ?? undefined,
          );
        },
      };
      return query as unknown as ReturnType<
        MerchantConversationV1ReadClient["from"]
      >;
    },
  };
}

test("conversation read verification is default-off and exact-merchant only", () => {
  const config = resolveMerchantConversationV1ReadConfig({
    MERCHANT_CONVERSATION_V1_READ_MODE: "verify",
    MERCHANT_CONVERSATION_V1_READ_SITE_IDS:
      "10000000,*,bad,20000000,10000000",
    MERCHANT_CONVERSATION_V1_READ_TIMEOUT_MS: "20",
    MERCHANT_CONVERSATION_V1_READ_MIN_INTERVAL_MS: "10",
  });
  assert.deepEqual(config, {
    mode: "verify",
    siteIds: ["10000000", "20000000"],
    timeoutMs: 250,
    minIntervalMs: 5000,
  });
  assert.equal(isMerchantConversationV1ReadEnabled(SITE_ID, config), true);
  assert.equal(isMerchantConversationV1ReadEnabled("30000000", config), false);
  assert.equal(
    resolveMerchantConversationV1ReadConfig({
      MERCHANT_CONVERSATION_V1_READ_MODE: "primary",
      MERCHANT_CONVERSATION_V1_READ_SITE_IDS: SITE_ID,
    }).mode,
    "off",
  );

  const gate = new Map<string, number>();
  assert.equal(
    reserveMerchantConversationV1ReadWindow(SITE_ID, config, {
      now: 100,
      gate,
    }),
    true,
  );
  assert.equal(
    reserveMerchantConversationV1ReadWindow(SITE_ID, config, {
      now: 101,
      gate,
    }),
    false,
  );
  assert.equal(
    reserveMerchantConversationV1ReadWindow(SITE_ID, config, {
      now: 5100,
      gate,
    }),
    true,
  );
});

test("disabled conversation verification never invokes the V1 loader", async () => {
  const legacy = buildLegacy();
  let calls = 0;
  const result = await readMerchantConversationsWithV1Verification({
    siteId: SITE_ID,
    legacy,
    loadV1: async () => {
      calls += 1;
      return buildMatchingData(legacy);
    },
    config: {
      mode: "off",
      siteIds: [SITE_ID],
      timeoutMs: 2500,
      minIntervalMs: 60000,
    },
  });
  assert.equal(result, legacy);
  assert.equal(calls, 0);
});

test("conversation verification records parity and returns the exact legacy snapshot", async () => {
  const legacy = buildLegacy();
  const events: MerchantConversationV1ReadEvent[] = [];
  const result = await readMerchantConversationsWithV1Verification({
    siteId: SITE_ID,
    legacy,
    loadV1: async () => buildMatchingData(legacy),
    config: {
      mode: "verify",
      siteIds: [SITE_ID],
      timeoutMs: 2500,
      minIntervalMs: 60000,
    },
    logger: (event) => events.push(event),
  });
  assert.equal(result, legacy);
  assert.equal(events[0]?.outcome, "match");
  assert.equal(events[0]?.reason, "parity");
  assert.equal(events[0]?.legacyPeerThreadCount, 1);
  assert.equal(events[0]?.legacySupportThreadCount, 1);
  assert.equal(events[0]?.v1MessageCount, 2);
  assert.match(events[0]?.observedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(Number.isInteger(events[0]?.durationMs), true);
});

test("conversation verification reports aggregate drift without logging content or email", async () => {
  const legacy = buildLegacy();
  const data = buildMatchingData(legacy);
  data.messages[0] = {
    ...data.messages[0],
    body: "SECRET MESSAGE BODY",
  };
  data.contacts[0] = {
    ...data.contacts[0],
    contact_email: "secret@example.com",
  };
  const events: MerchantConversationV1ReadEvent[] = [];
  const result = await readMerchantConversationsWithV1Verification({
    siteId: SITE_ID,
    legacy,
    loadV1: async () => data,
    config: {
      mode: "verify",
      siteIds: [SITE_ID],
      timeoutMs: 2500,
      minIntervalMs: 60000,
    },
    logger: (event) => events.push(event),
  });
  assert.equal(result, legacy);
  assert.equal(events[0]?.outcome, "fallback");
  assert.equal(events[0]?.reason, "v1_mismatch");
  assert.equal(events[0]?.mismatchCount, 2);
  const serialized = JSON.stringify(events[0]);
  assert.equal(serialized.includes("SECRET"), false);
  assert.equal(serialized.includes("example.com"), false);
});

test("conversation timeout, failure, and missing data keep the legacy snapshot", async () => {
  const legacy = buildLegacy();
  const events: MerchantConversationV1ReadEvent[] = [];
  const config = {
    mode: "verify" as const,
    siteIds: [SITE_ID],
    timeoutMs: 1,
    minIntervalMs: 60000,
  };
  const timeout = await readMerchantConversationsWithV1Verification({
    siteId: SITE_ID,
    legacy,
    loadV1: () =>
      new Promise<MerchantConversationV1VerificationData | null>(
        () => undefined,
      ),
    config,
    logger: (event) => events.push(event),
  });
  const failed = await readMerchantConversationsWithV1Verification({
    siteId: SITE_ID,
    legacy,
    loadV1: async () => {
      throw new Error("database unavailable");
    },
    config,
    logger: (event) => events.push(event),
  });
  const missing = await readMerchantConversationsWithV1Verification({
    siteId: SITE_ID,
    legacy,
    loadV1: async () => null,
    config,
    logger: (event) => events.push(event),
  });
  assert.equal(timeout, legacy);
  assert.equal(failed, legacy);
  assert.equal(missing, legacy);
  assert.deepEqual(
    events.map((event) => event.reason),
    ["v1_timeout", "v1_query_failed", "v1_missing"],
  );
});

test("conversation V1 validation rejects cross-account and unscoped identities", () => {
  const data = buildMatchingData();
  validateMerchantConversationV1VerificationData(SITE_ID, data);
  assert.throws(
    () =>
      validateMerchantConversationV1VerificationData(SITE_ID, {
        ...data,
        contacts: [
          { ...data.contacts[0], owner_merchant_id: "20000000" },
        ],
      }),
    /merchant_conversations_v1_identity_failed/,
  );
  assert.throws(
    () =>
      validateMerchantConversationV1VerificationData(SITE_ID, {
        ...data,
        messages: [
          ...data.messages,
          {
            ...data.messages[0],
            thread_id: "peer:20000000::20000001",
          },
        ],
      }),
    /merchant_conversations_v1_identity_failed/,
  );
});

test("conversation V1 loader reads all five account-scoped entities", async () => {
  const data = buildMatchingData();
  const client = createReadClient({
    merchant_conversation_threads:
      data.threads as Array<Record<string, unknown>>,
    merchant_conversation_participants:
      data.participants as Array<Record<string, unknown>>,
    merchant_conversation_messages:
      data.messages as Array<Record<string, unknown>>,
    merchant_conversation_contacts:
      data.contacts as Array<Record<string, unknown>>,
    merchant_conversation_read_cursors:
      data.readCursors as Array<Record<string, unknown>>,
  });
  const loaded = await loadMerchantConversationsV1VerificationData(
    client,
    SITE_ID,
  );
  assert.equal(loaded.threads.length, 2);
  assert.equal(loaded.participants.length, 4);
  assert.equal(loaded.messages.length, 2);
  assert.equal(loaded.contacts.length, 1);
  assert.equal(loaded.readCursors.length, 2);
});

test("conversation verification logging failures never affect legacy reads", async () => {
  const legacy = buildLegacy();
  const result = await readMerchantConversationsWithV1Verification({
    siteId: SITE_ID,
    legacy,
    loadV1: async () => buildMatchingData(legacy),
    config: {
      mode: "verify",
      siteIds: [SITE_ID],
      timeoutMs: 2500,
      minIntervalMs: 60000,
    },
    logger: () => {
      throw new Error("logger failed");
    },
  });
  assert.equal(result, legacy);
});
