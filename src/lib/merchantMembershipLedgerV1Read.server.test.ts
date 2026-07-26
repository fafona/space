import assert from "node:assert/strict";
import test from "node:test";

import { buildMerchantMembershipLedgerMutations } from "@/lib/merchantMembershipLedger";
import {
  isMerchantMembershipV1ReadEnabled,
  loadMerchantMembershipV1VerificationData,
  readMerchantMembershipsWithV1Verification,
  resolveMerchantMembershipV1ReadConfig,
  validateMerchantMembershipV1VerificationData,
  type MerchantMembershipV1ReadClient,
  type MerchantMembershipV1ReadEvent,
  type MerchantMembershipV1VerificationData,
} from "@/lib/merchantMembershipLedgerV1Read.server";
import {
  normalizeMerchantMembershipRecords,
  type MerchantMembershipRecord,
} from "@/lib/merchantMemberships";

const SITE_ID = "10000000";

function buildMembership(
  input: Partial<MerchantMembershipRecord> = {},
): MerchantMembershipRecord {
  return normalizeMerchantMembershipRecords([
    {
      id: `${SITE_ID}:account-1`,
      siteId: SITE_ID,
      siteName: "Store",
      memberNo: "10000000000001",
      serial: 1,
      accountId: "account-1",
      userId: "user-1",
      email: "private@example.com",
      name: "Private Member",
      pointBalance: 20,
      balanceAmount: 5,
      growthValue: 1.5,
      transactions: [
        {
          id: "TX-SECRET-1",
          type: "recharge",
          status: "completed",
          at: "2026-07-25T09:00:00.000Z",
          pointDelta: 20,
          balanceDelta: 5,
          growthDelta: 1.5,
          note: "",
          operatorId: "",
        },
      ],
      status: "active",
      joinedAt: "2026-07-25T08:00:00.000Z",
      updatedAt: "2026-07-25T09:00:00.000Z",
      ...input,
    },
  ])[0]!;
}

function buildMatchingData(
  membership: MerchantMembershipRecord,
): MerchantMembershipV1VerificationData {
  const mutation = buildMerchantMembershipLedgerMutations({
    nextMemberships: [membership],
    currency: "EUR",
  })[0]!;
  const entryIds = new Map(
    mutation.entries.map((entry, index) => [
      entry.idempotency_key,
      `entry-${index}`,
    ]),
  );
  return {
    customers: [
      {
        id: "customer-1",
        merchant_id: SITE_ID,
        legacy_membership_id: membership.id,
        member_no: membership.memberNo,
        status: "active",
        created_at: membership.joinedAt,
      } as Record<string, unknown>,
    ],
    ledgerEntries: mutation.entries.map((entry, index) => ({
      id: `entry-${index}`,
      merchant_id: SITE_ID,
      customer_id: "customer-1",
      account_type: entry.account_type,
      delta: entry.delta,
      balance_after: entry.balance_after,
      currency: entry.currency,
      entry_type: entry.entry_type,
      reference_type: entry.reference_type,
      reference_id: entry.reference_id,
      idempotency_key: entry.idempotency_key,
      reverses_entry_id: entry.reverses_idempotency_key
        ? entryIds.get(entry.reverses_idempotency_key) ?? null
        : null,
      created_at: entry.created_at,
    })),
  };
}

function createReadClient(
  tables: Record<string, Array<Record<string, unknown>>>,
  calls: Array<{ table: string; column: string; value: unknown }> = [],
): MerchantMembershipV1ReadClient {
  return {
    from: (table) => {
      let merchantId = "";
      let requireLegacyMembership = false;
      let referenceTypes: unknown[] | null = null;
      let rangeStart = 0;
      let rangeEnd = Number.MAX_SAFE_INTEGER;
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          calls.push({ table, column, value });
          if (column === "merchant_id") merchantId = String(value);
          return query;
        },
        not: (column: string, operator: string, value: unknown) => {
          calls.push({
            table,
            column: `${column}:${operator}`,
            value,
          });
          if (
            column === "legacy_membership_id" &&
            operator === "is" &&
            value === null
          ) {
            requireLegacyMembership = true;
          }
          return query;
        },
        in: (column: string, values: unknown[]) => {
          calls.push({ table, column: `${column}:in`, value: values });
          if (column === "reference_type") referenceTypes = values;
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
            value: {
              data: Array<Record<string, unknown>>;
              error: null;
            },
          ) => unknown) | null,
          onrejected?: ((reason: unknown) => unknown) | null,
        ) => {
          const rows = (tables[table] ?? [])
            .filter(
              (row) =>
                String(row.merchant_id ?? "") === merchantId &&
                (!requireLegacyMembership ||
                  Boolean(String(row.legacy_membership_id ?? "").trim())) &&
                (!referenceTypes ||
                  referenceTypes.includes(row.reference_type)),
            )
            .slice(rangeStart, rangeEnd + 1);
          return Promise.resolve({ data: rows, error: null }).then(
            onfulfilled ?? undefined,
            onrejected ?? undefined,
          );
        },
      };
      return query as unknown as ReturnType<
        MerchantMembershipV1ReadClient["from"]
      >;
    },
  };
}

test("membership read verification is default-off and exact-merchant only", () => {
  const config = resolveMerchantMembershipV1ReadConfig({
    MERCHANT_MEMBERSHIP_V1_READ_MODE: "verify",
    MERCHANT_MEMBERSHIP_V1_READ_SITE_IDS:
      "10000000,*,bad,20000000,10000000",
    MERCHANT_MEMBERSHIP_V1_READ_TIMEOUT_MS: "20",
    MERCHANT_MEMBERSHIP_V1_STORED_VALUE_CURRENCY: "usd",
  });
  assert.deepEqual(config, {
    mode: "verify",
    siteIds: ["10000000", "20000000"],
    timeoutMs: 250,
    currency: "USD",
  });
  assert.equal(isMerchantMembershipV1ReadEnabled(SITE_ID, config), true);
  assert.equal(isMerchantMembershipV1ReadEnabled("30000000", config), false);
  assert.equal(
    resolveMerchantMembershipV1ReadConfig({
      MERCHANT_MEMBERSHIP_V1_READ_MODE: "primary",
      MERCHANT_MEMBERSHIP_V1_READ_SITE_IDS: SITE_ID,
    }).mode,
    "off",
  );
});

test("disabled membership verification never invokes the V1 loader", async () => {
  const legacy = {
    memberships: [buildMembership()],
    updatedAt: null,
  };
  let calls = 0;
  const result = await readMerchantMembershipsWithV1Verification({
    siteId: SITE_ID,
    legacy,
    loadV1: async () => {
      calls += 1;
      return buildMatchingData(legacy.memberships[0]!);
    },
    config: {
      mode: "off",
      siteIds: [SITE_ID],
      timeoutMs: 2500,
      currency: "EUR",
    },
  });
  assert.equal(result, legacy);
  assert.equal(calls, 0);
});

test("membership verification records parity and returns the exact legacy snapshot", async () => {
  const membership = buildMembership();
  const legacy = {
    memberships: [membership],
    updatedAt: membership.updatedAt,
  };
  const events: MerchantMembershipV1ReadEvent[] = [];
  const result = await readMerchantMembershipsWithV1Verification({
    siteId: SITE_ID,
    legacy,
    loadV1: async () => buildMatchingData(membership),
    config: {
      mode: "verify",
      siteIds: [SITE_ID],
      timeoutMs: 2500,
      currency: "EUR",
    },
    logger: (event) => events.push(event),
  });
  assert.equal(result, legacy);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.outcome, "match");
  assert.equal(events[0]?.reason, "parity");
  assert.equal(events[0]?.matchedCustomerCount, 1);
  assert.match(events[0]?.observedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(Number.isInteger(events[0]?.durationMs), true);
});

test("membership drift logs aggregate metrics without member or transaction identifiers", async () => {
  const membership = buildMembership();
  const legacy = { memberships: [membership], updatedAt: null };
  const data = buildMatchingData(membership);
  data.ledgerEntries = data.ledgerEntries.slice(1);
  const events: MerchantMembershipV1ReadEvent[] = [];
  const result = await readMerchantMembershipsWithV1Verification({
    siteId: SITE_ID,
    legacy,
    loadV1: async () => data,
    config: {
      mode: "verify",
      siteIds: [SITE_ID],
      timeoutMs: 2500,
      currency: "EUR",
    },
    logger: (event) => events.push(event),
  });
  const serialized = JSON.stringify(events);
  assert.equal(result, legacy);
  assert.equal(events[0]?.reason, "v1_mismatch");
  assert.equal(events[0]?.missingTransactionEntryCount, 1);
  assert.doesNotMatch(serialized, /Private Member/);
  assert.doesNotMatch(serialized, /private@example\.com/);
  assert.doesNotMatch(serialized, /10000000000001/);
  assert.doesNotMatch(serialized, /TX-SECRET-1/);
  assert.doesNotMatch(serialized, /idempotency/i);
});

test("membership verification safely falls back on timeout, failure, and missing data", async () => {
  const legacy = { memberships: [buildMembership()], updatedAt: null };
  const events: MerchantMembershipV1ReadEvent[] = [];
  const config = {
    mode: "verify" as const,
    siteIds: [SITE_ID],
    timeoutMs: 1,
    currency: "EUR",
  };
  const timeout = await readMerchantMembershipsWithV1Verification({
    siteId: SITE_ID,
    legacy,
    loadV1: () =>
      new Promise<MerchantMembershipV1VerificationData | null>(
        () => undefined,
      ),
    config,
    logger: (event) => events.push(event),
  });
  const failed = await readMerchantMembershipsWithV1Verification({
    siteId: SITE_ID,
    legacy,
    loadV1: async () => {
      throw new Error("database unavailable");
    },
    config,
    logger: (event) => events.push(event),
  });
  const missing = await readMerchantMembershipsWithV1Verification({
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

test("membership verification rejects cross-merchant, orphan, and wrong-currency rows", () => {
  const membership = buildMembership();
  const crossMerchant = buildMatchingData(membership);
  crossMerchant.customers[0]!.merchant_id = "20000000";
  assert.throws(() =>
    validateMerchantMembershipV1VerificationData(
      SITE_ID,
      crossMerchant,
      "EUR",
    ),
  );

  const orphan = buildMatchingData(membership);
  orphan.ledgerEntries[0]!.customer_id = "missing-customer";
  assert.throws(() =>
    validateMerchantMembershipV1VerificationData(SITE_ID, orphan, "EUR"),
  );

  const wrongCurrency = buildMatchingData(membership);
  const storedValueEntry = wrongCurrency.ledgerEntries.find(
    (entry) => entry.account_type === "stored_value",
  );
  assert.ok(storedValueEntry);
  storedValueEntry.currency = "USD";
  assert.throws(() =>
    validateMerchantMembershipV1VerificationData(
      SITE_ID,
      wrongCurrency,
      "EUR",
    ),
  );
});

test("membership V1 loader scopes both tables and excludes unrelated rows", async () => {
  const membership = buildMembership();
  const data = buildMatchingData(membership);
  const calls: Array<{ table: string; column: string; value: unknown }> = [];
  const client = createReadClient(
    {
      merchant_customers: [
        ...(data.customers as Array<Record<string, unknown>>),
        {
          id: "generic-customer",
          merchant_id: SITE_ID,
          legacy_membership_id: null,
          status: "active",
          created_at: membership.joinedAt,
        },
      ],
      merchant_account_ledger: [
        ...(data.ledgerEntries as Array<Record<string, unknown>>),
        {
          id: "unrelated-entry",
          merchant_id: SITE_ID,
          customer_id: "customer-1",
          account_type: "points",
          delta: 1,
          balance_after: 21,
          currency: null,
          entry_type: "manual",
          reference_type: "other_domain",
          reference_id: "other",
          idempotency_key: "other",
          reverses_entry_id: null,
          created_at: membership.updatedAt,
        },
      ],
    },
    calls,
  );
  const loaded = await loadMerchantMembershipV1VerificationData(
    client,
    SITE_ID,
    "EUR",
  );
  assert.equal(loaded.customers.length, 1);
  assert.equal(loaded.ledgerEntries.length, data.ledgerEntries.length);
  assert.equal(
    calls.filter(
      (call) => call.column === "merchant_id" && call.value === SITE_ID,
    ).length,
    2,
  );
  assert.equal(
    calls.some(
      (call) =>
        call.column === "legacy_membership_id:is" && call.value === null,
    ),
    true,
  );
  assert.equal(
    calls.some((call) => call.column === "reference_type:in"),
    true,
  );
});

test("membership verification logging failures never affect legacy reads", async () => {
  const membership = buildMembership();
  const legacy = { memberships: [membership], updatedAt: null };
  const result = await readMerchantMembershipsWithV1Verification({
    siteId: SITE_ID,
    legacy,
    loadV1: async () => buildMatchingData(membership),
    config: {
      mode: "verify",
      siteIds: [SITE_ID],
      timeoutMs: 2500,
      currency: "EUR",
    },
    logger: () => {
      throw new Error("logger unavailable");
    },
  });
  assert.equal(result, legacy);
});
