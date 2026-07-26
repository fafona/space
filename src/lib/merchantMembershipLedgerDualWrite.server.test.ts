import assert from "node:assert/strict";
import test from "node:test";

import {
  mirrorMerchantMembershipLedgerChanges,
  resolveMerchantMembershipLedgerDualWriteConfig,
  type MerchantMembershipLedgerDualWriteConfig,
} from "@/lib/merchantMembershipLedgerDualWrite.server";
import {
  normalizeMerchantMembershipRecords,
  type MerchantMembershipRecord,
} from "@/lib/merchantMemberships";

const SITE_ID = "10000000";
const BASE_CONFIG: MerchantMembershipLedgerDualWriteConfig = {
  mode: "shadow",
  siteIds: [SITE_ID],
  timeoutMs: 250,
  currency: "EUR",
};

function membership(input: Partial<MerchantMembershipRecord> = {}) {
  const result = normalizeMerchantMembershipRecords([
    {
      id: `${SITE_ID}:account-1`,
      siteId: SITE_ID,
      siteName: "Store",
      memberNo: "10000000000001",
      serial: 1,
      accountId: "account-1",
      userId: "user-1",
      email: "private@example.com",
      name: "Private Name",
      pointBalance: 25,
      balanceAmount: 0,
      growthValue: 0,
      transactions: [
        {
          id: "TX-1",
          type: "recharge",
          status: "completed",
          at: "2026-07-25T09:00:00.000Z",
          pointDelta: 25,
          balanceDelta: 0,
          growthDelta: 0,
          note: "Join",
          operatorId: "system",
        },
      ],
      status: "active",
      joinedAt: "2026-07-25T08:00:00.000Z",
      updatedAt: "2026-07-25T09:00:00.000Z",
      ...input,
    },
  ]);
  assert.equal(result.length, 1);
  return result[0]!;
}

test("configuration is default-off and requires exact eight-digit site ids", () => {
  assert.deepEqual(resolveMerchantMembershipLedgerDualWriteConfig({}), {
    mode: "off",
    siteIds: [],
    timeoutMs: 2500,
    currency: "EUR",
  });
  assert.deepEqual(
    resolveMerchantMembershipLedgerDualWriteConfig({
      MERCHANT_MEMBERSHIP_V1_DUAL_WRITE_MODE: "shadow",
      MERCHANT_MEMBERSHIP_V1_DUAL_WRITE_SITE_IDS: "10000000,*,bad,10909094",
      MERCHANT_MEMBERSHIP_V1_DUAL_WRITE_TIMEOUT_MS: "50",
      MERCHANT_MEMBERSHIP_V1_STORED_VALUE_CURRENCY: "usd",
    }),
    {
      mode: "shadow",
      siteIds: ["10000000", "10909094"],
      timeoutMs: 250,
      currency: "USD",
    },
  );
});

test("off mode never invokes the RPC", async () => {
  let calls = 0;
  const result = await mirrorMerchantMembershipLedgerChanges(
    {
      rpc: async () => {
        calls += 1;
        return {};
      },
    },
    { siteId: SITE_ID, nextMemberships: [membership()] },
    { config: { ...BASE_CONFIG, mode: "off" } },
  );
  assert.equal(result.status, "disabled");
  assert.equal(calls, 0);
});

test("shadow mode is restricted to the configured merchant allowlist", async () => {
  let calls = 0;
  const result = await mirrorMerchantMembershipLedgerChanges(
    {
      rpc: async () => {
        calls += 1;
        return {};
      },
    },
    { siteId: SITE_ID, nextMemberships: [membership()] },
    { config: { ...BASE_CONFIG, siteIds: ["10909094"] } },
  );
  assert.equal(result.status, "skipped");
  assert.equal(calls, 0);
});

test("writes the generated customer and ledger mutations through one RPC", async () => {
  const calls: Array<{ functionName: string; args: Record<string, unknown> }> = [];
  const result = await mirrorMerchantMembershipLedgerChanges(
    {
      rpc: async (functionName, args) => {
        calls.push({ functionName, args });
        return { data: 1 };
      },
    },
    { siteId: SITE_ID, nextMemberships: [membership()] },
    { config: BASE_CONFIG },
  );

  assert.equal(result.status, "written");
  assert.equal(result.customerCount, 1);
  assert.equal(result.entryCount, 1);
  assert.equal(calls[0]?.functionName, "faolla_upsert_merchant_membership_ledger_v1");
  assert.equal(Array.isArray(calls[0]?.args.p_mutations), true);
});

test("failure logs identifiers but does not expose member name or email", async () => {
  const events: unknown[] = [];
  const result = await mirrorMerchantMembershipLedgerChanges(
    {
      rpc: async () => ({ error: { message: "database_unavailable" } }),
    },
    { siteId: SITE_ID, nextMemberships: [membership()] },
    {
      config: BASE_CONFIG,
      logger: (event) => events.push(event),
    },
  );

  assert.equal(result.status, "failed");
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes("private@example.com"), false);
  assert.equal(serialized.includes("Private Name"), false);
  assert.equal(serialized.includes("TX-1"), true);
});

test("timeout returns without converting a successful legacy save into an error", async () => {
  const result = await mirrorMerchantMembershipLedgerChanges(
    {
      rpc: () => new Promise(() => undefined),
    },
    { siteId: SITE_ID, nextMemberships: [membership()] },
    {
      config: { ...BASE_CONFIG, timeoutMs: 5 },
      logger: () => undefined,
    },
  );

  assert.equal(result.status, "timeout");
  assert.equal(result.customerCount, 1);
  assert.equal(result.entryCount, 1);
});
