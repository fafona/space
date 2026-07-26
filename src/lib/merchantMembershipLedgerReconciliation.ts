import {
  buildMerchantMembershipLedgerMutations,
  type MerchantMembershipLedgerAccountType,
  type MerchantMembershipLedgerEntryMutation,
} from "@/lib/merchantMembershipLedger";
import type { MerchantMembershipRecord } from "@/lib/merchantMemberships";

export type MerchantCustomerV1Row = {
  id?: unknown;
  merchant_id?: unknown;
  legacy_membership_id?: unknown;
  member_no?: unknown;
  status?: unknown;
  created_at?: unknown;
};

export type MerchantAccountLedgerV1Row = {
  id?: unknown;
  merchant_id?: unknown;
  customer_id?: unknown;
  account_type?: unknown;
  delta?: unknown;
  balance_after?: unknown;
  currency?: unknown;
  entry_type?: unknown;
  reference_type?: unknown;
  reference_id?: unknown;
  idempotency_key?: unknown;
  reverses_entry_id?: unknown;
  created_at?: unknown;
};

export type MerchantMembershipLedgerEntryMismatch = {
  membershipId: string;
  idempotencyKey: string;
  fields: string[];
};

export type MerchantMembershipLedgerBalanceMismatch = {
  membershipId: string;
  accountType: MerchantMembershipLedgerAccountType;
  expected: number;
  actual: number;
};

export type MerchantMembershipLedgerReconciliationReport = {
  merchantId: string;
  legacyMembershipCount: number;
  customerCount: number;
  ledgerEntryCount: number;
  matchedCustomerCount: number;
  missingCustomerMembershipIds: string[];
  unexpectedCustomerMembershipIds: string[];
  duplicateCustomerMembershipIds: string[];
  customerMismatches: Array<{ membershipId: string; fields: string[] }>;
  missingTransactionEntryKeys: string[];
  unexpectedTransactionEntryKeys: string[];
  entryMismatches: MerchantMembershipLedgerEntryMismatch[];
  balanceMismatches: MerchantMembershipLedgerBalanceMismatch[];
  isMatch: boolean;
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function toNullableInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return toInteger(value);
}

function getExpectedBalance(
  membership: MerchantMembershipRecord,
  accountType: MerchantMembershipLedgerAccountType,
) {
  if (accountType === "points") return Math.round(membership.pointBalance);
  if (accountType === "stored_value") return Math.round(membership.balanceAmount * 100);
  return Math.round(membership.growthValue * 100);
}

function compareExpectedEntry(
  expected: MerchantMembershipLedgerEntryMutation,
  actual: MerchantAccountLedgerV1Row,
) {
  const fields: string[] = [];
  if (trimText(actual.account_type) !== expected.account_type) fields.push("account_type");
  if (toInteger(actual.delta) !== expected.delta) fields.push("delta");
  if (toNullableInteger(actual.balance_after) !== expected.balance_after) {
    fields.push("balance_after");
  }
  if (trimText(actual.currency) !== (expected.currency ?? "")) fields.push("currency");
  if (trimText(actual.entry_type) !== expected.entry_type) fields.push("entry_type");
  if (trimText(actual.reference_type) !== expected.reference_type) fields.push("reference_type");
  if (trimText(actual.reference_id) !== expected.reference_id) fields.push("reference_id");
  return fields;
}

export function reconcileMerchantMembershipLedger(input: {
  merchantId: string;
  legacyMemberships: MerchantMembershipRecord[];
  customers: MerchantCustomerV1Row[];
  ledgerEntries: MerchantAccountLedgerV1Row[];
  currency?: string;
}): MerchantMembershipLedgerReconciliationReport {
  const merchantId = trimText(input.merchantId);
  const legacyMemberships = input.legacyMemberships.filter(
    (membership) => membership.siteId === merchantId,
  );
  const customers = input.customers.filter(
    (customer) => trimText(customer.merchant_id) === merchantId,
  );
  const ledgerEntries = input.ledgerEntries.filter(
    (entry) => trimText(entry.merchant_id) === merchantId,
  );
  const legacyById = new Map(
    legacyMemberships.map((membership) => [membership.id, membership]),
  );
  const customersByMembershipId = new Map<string, MerchantCustomerV1Row[]>();
  customers.forEach((customer) => {
    const membershipId = trimText(customer.legacy_membership_id);
    if (!membershipId) return;
    const group = customersByMembershipId.get(membershipId) ?? [];
    group.push(customer);
    customersByMembershipId.set(membershipId, group);
  });

  const missingCustomerMembershipIds = legacyMemberships
    .filter((membership) => !customersByMembershipId.has(membership.id))
    .map((membership) => membership.id);
  const unexpectedCustomerMembershipIds = Array.from(customersByMembershipId.keys()).filter(
    (membershipId) => !legacyById.has(membershipId),
  );
  const duplicateCustomerMembershipIds = Array.from(customersByMembershipId.entries())
    .filter(([, rows]) => rows.length > 1)
    .map(([membershipId]) => membershipId);
  const customerMismatches: Array<{ membershipId: string; fields: string[] }> = [];

  legacyMemberships.forEach((membership) => {
    const customer = customersByMembershipId.get(membership.id)?.[0];
    if (!customer) return;
    const fields: string[] = [];
    if (trimText(customer.member_no) !== membership.memberNo) fields.push("member_no");
    const expectedStatus = membership.status === "active" ? "active" : "archived";
    if (trimText(customer.status) !== expectedStatus) fields.push("status");
    if (fields.length > 0) customerMismatches.push({ membershipId: membership.id, fields });
  });

  const customerIdToMembershipId = new Map<string, string>();
  customersByMembershipId.forEach((rows, membershipId) => {
    const customerId = trimText(rows[0]?.id);
    if (customerId) customerIdToMembershipId.set(customerId, membershipId);
  });
  const expectedMutations = buildMerchantMembershipLedgerMutations({
    nextMemberships: legacyMemberships,
    currency: input.currency,
  });
  const expectedTransactionEntries = new Map<
    string,
    { membershipId: string; entry: MerchantMembershipLedgerEntryMutation }
  >();
  expectedMutations.forEach((mutation) => {
    mutation.entries
      .filter((entry) => entry.reference_type === "legacy_membership_transaction")
      .forEach((entry) => {
        expectedTransactionEntries.set(entry.idempotency_key, {
          membershipId: mutation.customer.legacy_membership_id,
          entry,
        });
      });
  });

  const actualTransactionEntries = new Map<string, MerchantAccountLedgerV1Row>();
  ledgerEntries
    .filter(
      (entry) =>
        trimText(entry.reference_type) === "legacy_membership_transaction",
    )
    .forEach((entry) => {
      const key = trimText(entry.idempotency_key);
      if (key) actualTransactionEntries.set(key, entry);
    });

  const missingTransactionEntryKeys = Array.from(expectedTransactionEntries.keys()).filter(
    (key) => !actualTransactionEntries.has(key),
  );
  const unexpectedTransactionEntryKeys = Array.from(actualTransactionEntries.keys()).filter(
    (key) => !expectedTransactionEntries.has(key),
  );
  const entryMismatches: MerchantMembershipLedgerEntryMismatch[] = [];
  expectedTransactionEntries.forEach(({ membershipId, entry }, key) => {
    const actual = actualTransactionEntries.get(key);
    if (!actual) return;
    const fields = compareExpectedEntry(entry, actual);
    if (fields.length > 0) {
      entryMismatches.push({ membershipId, idempotencyKey: key, fields });
    }
  });

  const balances = new Map<
    string,
    Record<MerchantMembershipLedgerAccountType, number>
  >();
  ledgerEntries.forEach((entry) => {
    const membershipId = customerIdToMembershipId.get(trimText(entry.customer_id));
    const accountType = trimText(entry.account_type) as MerchantMembershipLedgerAccountType;
    if (
      !membershipId ||
      !["points", "stored_value", "growth"].includes(accountType)
    ) {
      return;
    }
    const current = balances.get(membershipId) ?? {
      points: 0,
      stored_value: 0,
      growth: 0,
    };
    current[accountType] += toInteger(entry.delta);
    balances.set(membershipId, current);
  });

  const balanceMismatches: MerchantMembershipLedgerBalanceMismatch[] = [];
  legacyMemberships.forEach((membership) => {
    const actual = balances.get(membership.id) ?? {
      points: 0,
      stored_value: 0,
      growth: 0,
    };
    (
      ["points", "stored_value", "growth"] as MerchantMembershipLedgerAccountType[]
    ).forEach((accountType) => {
      const expected = getExpectedBalance(membership, accountType);
      if (actual[accountType] !== expected) {
        balanceMismatches.push({
          membershipId: membership.id,
          accountType,
          expected,
          actual: actual[accountType],
        });
      }
    });
  });

  const report = {
    merchantId,
    legacyMembershipCount: legacyMemberships.length,
    customerCount: customers.length,
    ledgerEntryCount: ledgerEntries.length,
    matchedCustomerCount:
      legacyMemberships.length - missingCustomerMembershipIds.length,
    missingCustomerMembershipIds,
    unexpectedCustomerMembershipIds,
    duplicateCustomerMembershipIds,
    customerMismatches,
    missingTransactionEntryKeys,
    unexpectedTransactionEntryKeys,
    entryMismatches,
    balanceMismatches,
  };
  return {
    ...report,
    isMatch:
      report.missingCustomerMembershipIds.length === 0 &&
      report.unexpectedCustomerMembershipIds.length === 0 &&
      report.duplicateCustomerMembershipIds.length === 0 &&
      report.customerMismatches.length === 0 &&
      report.missingTransactionEntryKeys.length === 0 &&
      report.unexpectedTransactionEntryKeys.length === 0 &&
      report.entryMismatches.length === 0 &&
      report.balanceMismatches.length === 0,
  };
}
