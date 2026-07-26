import assert from "node:assert/strict";
import test from "node:test";

import type { MerchantPeerInboxPayload } from "@/lib/merchantPeerInbox";
import type { MerchantSupportReadStatePayload } from "@/lib/merchantSupportReadState";
import type { PlatformSupportInboxPayload } from "@/lib/platformSupportInbox";
import {
  mirrorMerchantConversationReadState,
  mirrorMerchantPeerConversationSnapshot,
  mirrorPlatformSupportConversationSnapshot,
  normalizeMerchantConversationDualWriteSiteIds,
  resolveMerchantConversationDualWriteConfig,
} from "@/lib/merchantConversationDualWrite.server";

function buildPeerInbox(messageIds = ["message-1"]): MerchantPeerInboxPayload {
  return {
    contacts: [
      {
        ownerMerchantId: "10000000",
        contactMerchantId: "10000001",
        contactName: "Peer",
        contactEmail: "peer@example.com",
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
        updatedAt:
          messageIds.length > 1
            ? "2026-07-25T09:01:00.000Z"
            : "2026-07-25T09:00:00.000Z",
        messages: messageIds.map((id, index) => ({
          id,
          senderMerchantId: index % 2 ? "10000001" : "10000000",
          text: `message ${index + 1}`,
          createdAt: `2026-07-25T09:0${index}:00.000Z`,
        })),
      },
    ],
  };
}

function shadowConfig(timeoutMs = 1000) {
  return {
    mode: "shadow" as const,
    siteIds: ["10000000"],
    timeoutMs,
  };
}

test("conversation shadow configuration is default-off and deny-by-default", () => {
  assert.deepEqual(resolveMerchantConversationDualWriteConfig({}), {
    mode: "off",
    siteIds: [],
    timeoutMs: 2500,
  });
  assert.deepEqual(
    resolveMerchantConversationDualWriteConfig({
      MERCHANT_CONVERSATION_V1_DUAL_WRITE_MODE: "shadow",
      MERCHANT_CONVERSATION_V1_DUAL_WRITE_SITE_IDS: "*",
    }),
    {
      mode: "shadow",
      siteIds: [],
      timeoutMs: 2500,
    },
  );
});

test("conversation shadow allowlist rejects wildcards and malformed ids", () => {
  assert.deepEqual(
    normalizeMerchantConversationDualWriteSiteIds(
      "10000000,*,abc,10000000,10000001",
    ),
    ["10000000", "10000001"],
  );
});

test("disabled conversation shadow writes do not invoke RPC", async () => {
  let calls = 0;
  const result = await mirrorMerchantPeerConversationSnapshot(
    {
      rpc: async () => {
        calls += 1;
        return { data: 1 };
      },
    },
    { current: buildPeerInbox() },
    {
      config: { mode: "off", siteIds: ["10000000"], timeoutMs: 1000 },
    },
  );
  assert.deepEqual(result, { status: "disabled", count: 0 });
  assert.equal(calls, 0);
});

test("peer shadow writes only the appended message for an enrolled account", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const result = await mirrorMerchantPeerConversationSnapshot(
    {
      rpc: async (_name, args) => {
        calls.push(args);
        return { data: 1 };
      },
    },
    {
      current: buildPeerInbox(["message-1", "message-2"]),
      previous: buildPeerInbox(["message-1"]),
    },
    { config: shadowConfig() },
  );
  assert.equal(result.status, "written");
  const mutation = calls[0]?.p_mutations as {
    threads: Array<{ messages: Array<{ id: string }> }>;
    contacts: unknown[];
  };
  assert.deepEqual(
    mutation.threads[0]?.messages.map((message) => message.id),
    ["message-2"],
  );
  assert.equal(mutation.contacts.length, 0);
});

test("support replace writes an archive marker without deleting messages", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const previous: PlatformSupportInboxPayload = {
    threads: [
      {
        merchantId: "10000000",
        siteId: "10000000",
        merchantName: "Owner",
        merchantEmail: "owner@example.com",
        updatedAt: "2026-07-25T10:00:00.000Z",
        messages: [],
      },
    ],
  };
  const result = await mirrorPlatformSupportConversationSnapshot(
    {
      rpc: async (_name, args) => {
        calls.push(args);
        return { data: 1 };
      },
    },
    {
      current: { threads: [] },
      previous,
      replace: true,
      operationAt: "2026-07-25T11:00:00.000Z",
    },
    { config: shadowConfig() },
  );
  assert.equal(result.status, "written");
  const mutation = calls[0]?.p_mutations as {
    archived_threads: Array<{ id: string }>;
  };
  assert.deepEqual(mutation.archived_threads, [
    { id: "support:10000000", archived_at: "2026-07-25T11:00:00.000Z" },
  ]);
});

test("read-state shadow writes only enrolled account cursors", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const payload: MerchantSupportReadStatePayload = {
    accounts: [
      {
        accountId: "10000000",
        officialLastReadAt: "2026-07-25T10:00:00.000Z",
        peerLastRead: {},
        updatedAt: "2026-07-25T10:00:00.000Z",
      },
      {
        accountId: "10000001",
        officialLastReadAt: "2026-07-25T09:00:00.000Z",
        peerLastRead: {},
        updatedAt: "2026-07-25T09:00:00.000Z",
      },
    ],
  };
  const result = await mirrorMerchantConversationReadState(
    {
      rpc: async (_name, args) => {
        calls.push(args);
        return { data: 1 };
      },
    },
    { current: payload },
    { config: shadowConfig() },
  );
  assert.equal(result.status, "written");
  const mutation = calls[0]?.p_mutations as {
    read_cursors: Array<{ account_id: string }>;
  };
  assert.deepEqual(
    mutation.read_cursors.map((cursor) => cursor.account_id),
    ["10000000"],
  );
});

test("conversation shadow failures are contained and do not log message bodies", async () => {
  const logged: unknown[] = [];
  const result = await mirrorMerchantPeerConversationSnapshot(
    {
      rpc: async () => ({ error: { message: "rpc unavailable" } }),
    },
    { current: buildPeerInbox() },
    {
      config: shadowConfig(),
      logger: (event) => logged.push(event),
    },
  );
  assert.equal(result.status, "failed");
  assert.equal(JSON.stringify(logged).includes("message 1"), false);
  assert.equal(JSON.stringify(logged).includes("peer@example.com"), false);
});

test("conversation shadow timeout is bounded and nonthrowing", async () => {
  const result = await mirrorMerchantPeerConversationSnapshot(
    {
      rpc: async () =>
        new Promise<{ data: number }>(() => {
          // Deliberately unresolved.
        }),
    },
    { current: buildPeerInbox() },
    {
      config: shadowConfig(5),
      logger: () => undefined,
    },
  );
  assert.equal(result.status, "timeout");
  assert.match(result.error ?? "", /shadow_write_timeout/);
});
