import {
  MERCHANT_MEMBERSHIP_LEDGER_ACCOUNT_TYPES,
  normalizeMembershipLedgerCurrency,
  type MerchantMembershipLedgerAccountType,
} from "@/lib/merchantMembershipLedger";
import {
  reconcileMerchantMembershipLedger,
  type MerchantAccountLedgerV1Row,
  type MerchantCustomerV1Row,
  type MerchantMembershipLedgerReconciliationReport,
} from "@/lib/merchantMembershipLedgerReconciliation";
import type { MerchantMembershipRecord } from "@/lib/merchantMemberships";

export const MERCHANT_MEMBERSHIP_V1_READ_MODES = ["off", "verify"] as const;

export type MerchantMembershipV1ReadMode =
  (typeof MERCHANT_MEMBERSHIP_V1_READ_MODES)[number];

export type MerchantMembershipV1ReadConfig = {
  mode: MerchantMembershipV1ReadMode;
  siteIds: string[];
  timeoutMs: number;
  currency: string;
};

export type MerchantMembershipV1ReadSnapshot = {
  memberships: MerchantMembershipRecord[];
  updatedAt: string | null;
};

export type MerchantMembershipV1VerificationData = {
  customers: MerchantCustomerV1Row[];
  ledgerEntries: MerchantAccountLedgerV1Row[];
};

type MerchantMembershipV1QueryResult = {
  data?: unknown;
  error?: unknown;
};

type MerchantMembershipV1Query =
  PromiseLike<MerchantMembershipV1QueryResult> & {
    select: (columns: string) => MerchantMembershipV1Query;
    eq: (column: string, value: unknown) => MerchantMembershipV1Query;
    not: (
      column: string,
      operator: string,
      value: unknown,
    ) => MerchantMembershipV1Query;
    in: (column: string, values: unknown[]) => MerchantMembershipV1Query;
    order: (
      column: string,
      options: { ascending: boolean },
    ) => MerchantMembershipV1Query;
    range: (from: number, to: number) => MerchantMembershipV1Query;
  };

export type MerchantMembershipV1ReadClient = {
  from: (table: string) => MerchantMembershipV1Query;
};

export type MerchantMembershipV1ReadEvent = {
  event: "merchant_membership_v1_read";
  siteId: string;
  mode: "verify";
  observedAt: string;
  durationMs: number;
  outcome: "match" | "fallback";
  reason:
    | "parity"
    | "v1_timeout"
    | "v1_query_failed"
    | "v1_missing"
    | "v1_reconciliation_failed"
    | "v1_mismatch";
  legacyMembershipCount: number;
  v1CustomerCount: number;
  ledgerEntryCount: number;
  matchedCustomerCount: number;
  missingCustomerCount: number;
  unexpectedCustomerCount: number;
  duplicateCustomerCount: number;
  customerMismatchCount: number;
  missingTransactionEntryCount: number;
  unexpectedTransactionEntryCount: number;
  entryMismatchCount: number;
  balanceMismatchCount: number;
};

type MerchantMembershipV1ReadLogger = (
  event: MerchantMembershipV1ReadEvent,
) => void;

const CUSTOMER_SELECT_COLUMNS = [
  "id",
  "merchant_id",
  "legacy_membership_id",
  "member_no",
  "status",
  "created_at",
].join(",");
const LEDGER_SELECT_COLUMNS = [
  "id",
  "merchant_id",
  "customer_id",
  "account_type",
  "delta",
  "balance_after",
  "currency",
  "entry_type",
  "reference_type",
  "reference_id",
  "idempotency_key",
  "reverses_entry_id",
  "created_at",
].join(",");
const LEGACY_REFERENCE_TYPES = [
  "legacy_membership_transaction",
  "legacy_membership_checkpoint",
];
const LEDGER_ENTRY_TYPES = new Set([
  "recharge",
  "redeem",
  "recharge_reversal",
  "recharge_manual_adjustment",
  "opening_balance",
  "legacy_reconciliation",
]);
const CUSTOMER_STATUSES = new Set(["active", "archived", "merged"]);
const DEFAULT_READ_TIMEOUT_MS = 2500;
const MIN_READ_TIMEOUT_MS = 250;
const MAX_READ_TIMEOUT_MS = 10000;
const READ_PAGE_SIZE = 1000;
const MAX_CUSTOMER_ROWS = 100000;
const MAX_LEDGER_ROWS = 500000;

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTimeoutMs(value: unknown) {
  const parsed = Number.parseInt(trimText(value), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_READ_TIMEOUT_MS;
  return Math.min(MAX_READ_TIMEOUT_MS, Math.max(MIN_READ_TIMEOUT_MS, parsed));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSafeInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed);
}

function isValidTimestamp(value: unknown) {
  const timestamp = Date.parse(trimText(value));
  return Number.isFinite(timestamp);
}

function throwReadError(scope: string): never {
  throw new Error(`merchant_membership_v1_${scope}_failed`);
}

async function readQuery(
  query: MerchantMembershipV1Query,
  scope: string,
): Promise<MerchantMembershipV1QueryResult> {
  const result = await query;
  if (result.error) throwReadError(scope);
  if (
    result.data !== null &&
    result.data !== undefined &&
    !Array.isArray(result.data)
  ) {
    throwReadError(scope);
  }
  return result;
}

async function loadCustomerRows(
  client: MerchantMembershipV1ReadClient,
  siteId: string,
) {
  const rows: MerchantCustomerV1Row[] = [];
  for (
    let offset = 0;
    offset < MAX_CUSTOMER_ROWS;
    offset += READ_PAGE_SIZE
  ) {
    const result = await readQuery(
      client
        .from("merchant_customers")
        .select(CUSTOMER_SELECT_COLUMNS)
        .eq("merchant_id", siteId)
        .not("legacy_membership_id", "is", null)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + READ_PAGE_SIZE - 1),
      "customers_query",
    );
    const page = (result.data ?? []) as MerchantCustomerV1Row[];
    rows.push(...page);
    if (page.length < READ_PAGE_SIZE) return rows;
  }
  throwReadError("customers_row_limit");
}

async function loadLedgerRows(
  client: MerchantMembershipV1ReadClient,
  siteId: string,
) {
  const rows: MerchantAccountLedgerV1Row[] = [];
  for (
    let offset = 0;
    offset < MAX_LEDGER_ROWS;
    offset += READ_PAGE_SIZE
  ) {
    const result = await readQuery(
      client
        .from("merchant_account_ledger")
        .select(LEDGER_SELECT_COLUMNS)
        .eq("merchant_id", siteId)
        .in("reference_type", LEGACY_REFERENCE_TYPES)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + READ_PAGE_SIZE - 1),
      "ledger_query",
    );
    const page = (result.data ?? []) as MerchantAccountLedgerV1Row[];
    rows.push(...page);
    if (page.length < READ_PAGE_SIZE) return rows;
  }
  throwReadError("ledger_row_limit");
}

function validateCustomerRows(siteId: string, customers: unknown) {
  if (!Array.isArray(customers)) throwReadError("response");
  const customerIds = new Set<string>();
  for (const customer of customers) {
    if (!isPlainRecord(customer)) throwReadError("identity");
    const customerId = trimText(customer.id);
    if (
      trimText(customer.merchant_id) !== siteId ||
      !customerId ||
      !trimText(customer.legacy_membership_id) ||
      !CUSTOMER_STATUSES.has(trimText(customer.status)) ||
      !isValidTimestamp(customer.created_at) ||
      customerIds.has(customerId)
    ) {
      throwReadError("identity");
    }
    customerIds.add(customerId);
  }
  return customerIds;
}

function validateLedgerRows(input: {
  siteId: string;
  currency: string;
  customerIds: Set<string>;
  ledgerEntries: unknown;
}) {
  if (!Array.isArray(input.ledgerEntries)) throwReadError("response");
  const entryIds = new Set<string>();
  const idempotencyKeys = new Set<string>();
  const reversalIds: string[] = [];
  for (const entry of input.ledgerEntries) {
    if (!isPlainRecord(entry)) throwReadError("identity");
    const entryId = trimText(entry.id);
    const customerId = trimText(entry.customer_id);
    const accountType = trimText(
      entry.account_type,
    ) as MerchantMembershipLedgerAccountType;
    const currency = trimText(entry.currency);
    const referenceType = trimText(entry.reference_type);
    const idempotencyKey = trimText(entry.idempotency_key);
    const reversalId = trimText(entry.reverses_entry_id);
    if (
      trimText(entry.merchant_id) !== input.siteId ||
      !entryId ||
      entryIds.has(entryId) ||
      !customerId ||
      !input.customerIds.has(customerId) ||
      !MERCHANT_MEMBERSHIP_LEDGER_ACCOUNT_TYPES.includes(accountType) ||
      !isSafeInteger(entry.delta) ||
      Number(entry.delta) === 0 ||
      (entry.balance_after !== null &&
        entry.balance_after !== undefined &&
        (!isSafeInteger(entry.balance_after) ||
          Number(entry.balance_after) < 0)) ||
      (accountType === "stored_value"
        ? currency !== input.currency
        : currency !== "") ||
      !LEDGER_ENTRY_TYPES.has(trimText(entry.entry_type)) ||
      !LEGACY_REFERENCE_TYPES.includes(referenceType) ||
      !trimText(entry.reference_id) ||
      !idempotencyKey ||
      idempotencyKeys.has(idempotencyKey) ||
      !isValidTimestamp(entry.created_at)
    ) {
      throwReadError("identity");
    }
    entryIds.add(entryId);
    idempotencyKeys.add(idempotencyKey);
    if (reversalId) reversalIds.push(reversalId);
  }
  if (reversalIds.some((entryId) => !entryIds.has(entryId))) {
    throwReadError("identity");
  }
}

export function validateMerchantMembershipV1VerificationData(
  siteId: string,
  data: MerchantMembershipV1VerificationData,
  currency = "EUR",
) {
  const normalizedSiteId = trimText(siteId);
  if (!/^\d{8}$/.test(normalizedSiteId)) throwReadError("identity");
  const normalizedCurrency = normalizeMembershipLedgerCurrency(currency);
  const customerIds = validateCustomerRows(
    normalizedSiteId,
    data?.customers,
  );
  validateLedgerRows({
    siteId: normalizedSiteId,
    currency: normalizedCurrency,
    customerIds,
    ledgerEntries: data?.ledgerEntries,
  });
  return data;
}

export async function loadMerchantMembershipV1VerificationData(
  client: MerchantMembershipV1ReadClient,
  siteId: string,
  currency = "EUR",
): Promise<MerchantMembershipV1VerificationData> {
  const normalizedSiteId = trimText(siteId);
  if (!/^\d{8}$/.test(normalizedSiteId)) throwReadError("identity");
  const [customers, ledgerEntries] = await Promise.all([
    loadCustomerRows(client, normalizedSiteId),
    loadLedgerRows(client, normalizedSiteId),
  ]);
  return validateMerchantMembershipV1VerificationData(
    normalizedSiteId,
    { customers, ledgerEntries },
    currency,
  );
}

export function resolveMerchantMembershipV1ReadConfig(
  environment: Record<string, string | undefined> = process.env,
): MerchantMembershipV1ReadConfig {
  const mode =
    trimText(environment.MERCHANT_MEMBERSHIP_V1_READ_MODE).toLowerCase() ===
    "verify"
      ? "verify"
      : "off";
  const siteIds = [
    ...new Set(
      trimText(environment.MERCHANT_MEMBERSHIP_V1_READ_SITE_IDS)
        .split(",")
        .map((siteId) => siteId.trim())
        .filter((siteId) => /^\d{8}$/.test(siteId)),
    ),
  ];
  return {
    mode,
    siteIds,
    timeoutMs: normalizeTimeoutMs(
      environment.MERCHANT_MEMBERSHIP_V1_READ_TIMEOUT_MS,
    ),
    currency: normalizeMembershipLedgerCurrency(
      environment.MERCHANT_MEMBERSHIP_V1_STORED_VALUE_CURRENCY,
    ),
  };
}

export function isMerchantMembershipV1ReadEnabled(
  siteId: string,
  config: MerchantMembershipV1ReadConfig,
) {
  return (
    config.mode === "verify" && config.siteIds.includes(trimText(siteId))
  );
}

function defaultReadLogger(event: MerchantMembershipV1ReadEvent) {
  const output = JSON.stringify(event);
  if (event.outcome === "fallback") {
    console.warn("[merchant-membership-v1-read]", output);
  } else {
    console.info("[merchant-membership-v1-read]", output);
  }
}

async function observeV1Read(
  loadV1: () => Promise<MerchantMembershipV1VerificationData | null>,
  timeoutMs: number,
): Promise<
  | { status: "loaded"; value: MerchantMembershipV1VerificationData | null }
  | { status: "timeout" }
  | { status: "failed" }
> {
  const timeoutToken = Symbol("merchant_membership_v1_read_timeout");
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      loadV1(),
      new Promise<typeof timeoutToken>((resolve) => {
        timeoutHandle = setTimeout(
          () => resolve(timeoutToken),
          Math.max(1, timeoutMs),
        );
      }),
    ]);
    return result === timeoutToken
      ? { status: "timeout" }
      : { status: "loaded", value: result };
  } catch {
    return { status: "failed" };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function emptyMetrics() {
  return {
    v1CustomerCount: 0,
    ledgerEntryCount: 0,
    matchedCustomerCount: 0,
    missingCustomerCount: 0,
    unexpectedCustomerCount: 0,
    duplicateCustomerCount: 0,
    customerMismatchCount: 0,
    missingTransactionEntryCount: 0,
    unexpectedTransactionEntryCount: 0,
    entryMismatchCount: 0,
    balanceMismatchCount: 0,
  };
}

function reportMetrics(report: MerchantMembershipLedgerReconciliationReport) {
  return {
    v1CustomerCount: report.customerCount,
    ledgerEntryCount: report.ledgerEntryCount,
    matchedCustomerCount: report.matchedCustomerCount,
    missingCustomerCount: report.missingCustomerMembershipIds.length,
    unexpectedCustomerCount: report.unexpectedCustomerMembershipIds.length,
    duplicateCustomerCount: report.duplicateCustomerMembershipIds.length,
    customerMismatchCount: report.customerMismatches.length,
    missingTransactionEntryCount: report.missingTransactionEntryKeys.length,
    unexpectedTransactionEntryCount:
      report.unexpectedTransactionEntryKeys.length,
    entryMismatchCount: report.entryMismatches.length,
    balanceMismatchCount: report.balanceMismatches.length,
  };
}

export async function readMerchantMembershipsWithV1Verification<
  T extends MerchantMembershipV1ReadSnapshot,
>(input: {
  siteId: string;
  legacy: T;
  loadV1: () => Promise<MerchantMembershipV1VerificationData | null>;
  config?: MerchantMembershipV1ReadConfig;
  logger?: MerchantMembershipV1ReadLogger;
}): Promise<T> {
  const config = input.config ?? resolveMerchantMembershipV1ReadConfig();
  if (!isMerchantMembershipV1ReadEnabled(input.siteId, config)) {
    return input.legacy;
  }

  const verificationStartedAt = Date.now();
  const observedV1 = await observeV1Read(input.loadV1, config.timeoutMs);
  const logger = input.logger ?? defaultReadLogger;
  const log = (
    outcome: MerchantMembershipV1ReadEvent["outcome"],
    reason: MerchantMembershipV1ReadEvent["reason"],
    metrics = emptyMetrics(),
  ) => {
    try {
      const completedAt = Date.now();
      logger({
        event: "merchant_membership_v1_read",
        siteId: trimText(input.siteId),
        mode: "verify",
        observedAt: new Date(completedAt).toISOString(),
        durationMs: Math.max(0, completedAt - verificationStartedAt),
        outcome,
        reason,
        legacyMembershipCount: input.legacy.memberships.length,
        ...metrics,
      });
    } catch {
      // Read observability must never affect the legacy membership result.
    }
  };

  if (observedV1.status === "timeout") {
    log("fallback", "v1_timeout");
    return input.legacy;
  }
  if (observedV1.status === "failed") {
    log("fallback", "v1_query_failed");
    return input.legacy;
  }
  if (!observedV1.value) {
    log("fallback", "v1_missing");
    return input.legacy;
  }

  let report: MerchantMembershipLedgerReconciliationReport;
  try {
    const v1 = validateMerchantMembershipV1VerificationData(
      input.siteId,
      observedV1.value,
      config.currency,
    );
    report = reconcileMerchantMembershipLedger({
      merchantId: input.siteId,
      legacyMemberships: input.legacy.memberships,
      customers: v1.customers,
      ledgerEntries: v1.ledgerEntries,
      currency: config.currency,
    });
  } catch {
    log("fallback", "v1_reconciliation_failed");
    return input.legacy;
  }

  const metrics = reportMetrics(report);
  if (!report.isMatch) {
    log("fallback", "v1_mismatch", metrics);
    return input.legacy;
  }
  log("match", "parity", metrics);
  return input.legacy;
}
