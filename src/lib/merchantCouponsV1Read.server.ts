import type { MerchantCouponRecord } from "@/lib/merchantCoupons";
import {
  reconcileMerchantCouponStorage,
  type MerchantCouponClaimV1Row,
  type MerchantCouponEventV1Row,
  type MerchantCouponReconciliationReport,
  type MerchantCouponRedemptionV1Row,
  type MerchantCouponV1Row,
} from "@/lib/merchantCouponReconciliation";

export const MERCHANT_COUPON_V1_READ_MODES = ["off", "verify"] as const;

export type MerchantCouponV1ReadMode =
  (typeof MERCHANT_COUPON_V1_READ_MODES)[number];

export type MerchantCouponV1ReadConfig = {
  mode: MerchantCouponV1ReadMode;
  siteIds: string[];
  timeoutMs: number;
};

export type MerchantCouponV1ReadSnapshot = {
  coupons: MerchantCouponRecord[];
  updatedAt: string | null;
};

export type MerchantCouponV1VerificationData = {
  coupons: MerchantCouponV1Row[];
  claims: MerchantCouponClaimV1Row[];
  redemptions: MerchantCouponRedemptionV1Row[];
  events: MerchantCouponEventV1Row[];
};

type MerchantCouponV1QueryResult = {
  data?: unknown;
  error?: unknown;
};

type MerchantCouponV1Query = PromiseLike<MerchantCouponV1QueryResult> & {
  select: (columns: string) => MerchantCouponV1Query;
  eq: (column: string, value: unknown) => MerchantCouponV1Query;
  order: (
    column: string,
    options: { ascending: boolean },
  ) => MerchantCouponV1Query;
  range: (from: number, to: number) => MerchantCouponV1Query;
};

export type MerchantCouponV1ReadClient = {
  from: (table: string) => MerchantCouponV1Query;
};

export type MerchantCouponV1ReadEvent = {
  event: "merchant_coupon_v1_read";
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
  legacyCouponCount: number;
  v1CouponCount: number;
  matchedCouponCount: number;
  missingCouponCount: number;
  unexpectedCouponCount: number;
  duplicateCouponCount: number;
  missingClaimCount: number;
  duplicateClaimCount: number;
  missingRedemptionCount: number;
  duplicateRedemptionCount: number;
  unexpectedActiveRedemptionCount: number;
  missingEventCount: number;
  mismatchCount: number;
  couponIds: string[];
};

type MerchantCouponV1ReadLogger = (
  event: MerchantCouponV1ReadEvent,
) => void;

const COUPON_SELECT_COLUMNS = [
  "merchant_id",
  "id",
  "code",
  "title",
  "status",
  "discount_type",
  "discount_value",
  "minimum_amount",
  "total_quantity",
  "claimed_count",
  "used_count",
  "starts_at",
  "expires_at",
  "configuration",
  "source_snapshot",
  "created_at",
  "updated_at",
].join(",");
const CLAIM_SELECT_COLUMNS = [
  "merchant_id",
  "id",
  "coupon_id",
  "customer_id",
  "settlement_type",
  "settlement_code_hash",
  "claim_code_hash",
  "status",
  "customer_snapshot",
  "source_snapshot",
  "claimed_at",
  "valid_until",
  "source_updated_at",
].join(",");
const REDEMPTION_SELECT_COLUMNS = [
  "merchant_id",
  "id",
  "coupon_id",
  "claim_id",
  "customer_id",
  "state",
  "settlement_code_hash",
  "operator_id",
  "note",
  "source_snapshot",
  "redeemed_at",
  "source_updated_at",
].join(",");
const EVENT_SELECT_COLUMNS = [
  "merchant_id",
  "coupon_id",
  "idempotency_key",
].join(",");
const DEFAULT_READ_TIMEOUT_MS = 2500;
const MIN_READ_TIMEOUT_MS = 250;
const MAX_READ_TIMEOUT_MS = 10000;
const READ_PAGE_SIZE = 1000;
const MAX_ROWS_PER_TABLE = 100000;
const MAX_LOGGED_COUPON_IDS = 20;

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

function throwReadError(scope: string): never {
  throw new Error(`merchant_coupons_v1_${scope}_failed`);
}

async function readQuery(
  query: MerchantCouponV1Query,
  scope: string,
): Promise<MerchantCouponV1QueryResult> {
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

async function loadTableRows<T>(
  client: MerchantCouponV1ReadClient,
  input: {
    table: string;
    columns: string;
    siteId: string;
    orderBy: string;
    tieBreaker: string;
  },
): Promise<T[]> {
  const rows: T[] = [];
  for (
    let offset = 0;
    offset < MAX_ROWS_PER_TABLE;
    offset += READ_PAGE_SIZE
  ) {
    const result = await readQuery(
      client
        .from(input.table)
        .select(input.columns)
        .eq("merchant_id", input.siteId)
        .order(input.orderBy, { ascending: false })
        .order(input.tieBreaker, { ascending: false })
        .range(offset, offset + READ_PAGE_SIZE - 1),
      `${input.table}_query`,
    );
    const page = (result.data ?? []) as T[];
    rows.push(...page);
    if (page.length < READ_PAGE_SIZE) return rows;
  }
  throwReadError(`${input.table}_row_limit`);
}

function assertRowIdentity(
  siteId: string,
  row: unknown,
  requiredFields: string[],
) {
  if (
    !isPlainRecord(row) ||
    trimText(row.merchant_id) !== siteId ||
    requiredFields.some((field) => !trimText(row[field]))
  ) {
    throwReadError("identity");
  }
}

export function validateMerchantCouponV1VerificationData(
  siteId: string,
  data: MerchantCouponV1VerificationData,
) {
  const normalizedSiteId = trimText(siteId);
  if (!/^\d{8}$/.test(normalizedSiteId)) throwReadError("identity");
  const groups = [
    [data?.coupons, ["id"]],
    [data?.claims, ["id", "coupon_id"]],
    [data?.redemptions, ["id", "coupon_id", "claim_id"]],
    [data?.events, ["coupon_id", "idempotency_key"]],
  ] as const;
  for (const [rows, requiredFields] of groups) {
    if (!Array.isArray(rows)) throwReadError("response");
    for (const row of rows) {
      assertRowIdentity(normalizedSiteId, row, [...requiredFields]);
    }
  }
  return data;
}

export async function loadMerchantCouponsV1VerificationData(
  client: MerchantCouponV1ReadClient,
  siteId: string,
): Promise<MerchantCouponV1VerificationData> {
  const normalizedSiteId = trimText(siteId);
  if (!/^\d{8}$/.test(normalizedSiteId)) throwReadError("identity");
  const [coupons, claims, redemptions, events] = await Promise.all([
    loadTableRows<MerchantCouponV1Row>(client, {
      table: "merchant_coupons",
      columns: COUPON_SELECT_COLUMNS,
      siteId: normalizedSiteId,
      orderBy: "updated_at",
      tieBreaker: "id",
    }),
    loadTableRows<MerchantCouponClaimV1Row>(client, {
      table: "merchant_coupon_claims",
      columns: CLAIM_SELECT_COLUMNS,
      siteId: normalizedSiteId,
      orderBy: "source_updated_at",
      tieBreaker: "id",
    }),
    loadTableRows<MerchantCouponRedemptionV1Row>(client, {
      table: "merchant_coupon_redemptions",
      columns: REDEMPTION_SELECT_COLUMNS,
      siteId: normalizedSiteId,
      orderBy: "source_updated_at",
      tieBreaker: "id",
    }),
    loadTableRows<MerchantCouponEventV1Row>(client, {
      table: "merchant_coupon_events",
      columns: EVENT_SELECT_COLUMNS,
      siteId: normalizedSiteId,
      orderBy: "created_at",
      tieBreaker: "idempotency_key",
    }),
  ]);
  return validateMerchantCouponV1VerificationData(normalizedSiteId, {
    coupons,
    claims,
    redemptions,
    events,
  });
}

export function resolveMerchantCouponV1ReadConfig(
  environment: Record<string, string | undefined> = process.env,
): MerchantCouponV1ReadConfig {
  const mode =
    trimText(environment.MERCHANT_COUPON_V1_READ_MODE).toLowerCase() ===
    "verify"
      ? "verify"
      : "off";
  const siteIds = [
    ...new Set(
      trimText(environment.MERCHANT_COUPON_V1_READ_SITE_IDS)
        .split(",")
        .map((siteId) => siteId.trim())
        .filter((siteId) => /^\d{8}$/.test(siteId)),
    ),
  ];
  return {
    mode,
    siteIds,
    timeoutMs: normalizeTimeoutMs(
      environment.MERCHANT_COUPON_V1_READ_TIMEOUT_MS,
    ),
  };
}

export function isMerchantCouponV1ReadEnabled(
  siteId: string,
  config: MerchantCouponV1ReadConfig,
) {
  return (
    config.mode === "verify" &&
    config.siteIds.includes(trimText(siteId))
  );
}

function defaultReadLogger(event: MerchantCouponV1ReadEvent) {
  const output = JSON.stringify(event);
  if (event.outcome === "fallback") {
    console.warn("[merchant-coupon-v1-read]", output);
  } else {
    console.info("[merchant-coupon-v1-read]", output);
  }
}

async function observeV1Read(
  loadV1: () => Promise<MerchantCouponV1VerificationData | null>,
  timeoutMs: number,
): Promise<
  | { status: "loaded"; value: MerchantCouponV1VerificationData | null }
  | { status: "timeout" }
  | { status: "failed" }
> {
  const timeoutToken = Symbol("merchant_coupon_v1_read_timeout");
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
    v1CouponCount: 0,
    matchedCouponCount: 0,
    missingCouponCount: 0,
    unexpectedCouponCount: 0,
    duplicateCouponCount: 0,
    missingClaimCount: 0,
    duplicateClaimCount: 0,
    missingRedemptionCount: 0,
    duplicateRedemptionCount: 0,
    unexpectedActiveRedemptionCount: 0,
    missingEventCount: 0,
    mismatchCount: 0,
    couponIds: [] as string[],
  };
}

function reportMetrics(report: MerchantCouponReconciliationReport) {
  const couponIds = [
    ...report.missingCoupons,
    ...report.unexpectedCoupons,
    ...report.duplicateCouponIds,
    ...report.mismatches.map((mismatch) => mismatch.couponId),
  ];
  return {
    v1CouponCount: report.v1CouponCount,
    matchedCouponCount: report.matchedCouponCount,
    missingCouponCount: report.missingCoupons.length,
    unexpectedCouponCount: report.unexpectedCoupons.length,
    duplicateCouponCount: report.duplicateCouponIds.length,
    missingClaimCount: report.missingClaims.length,
    duplicateClaimCount: report.duplicateClaimIds.length,
    missingRedemptionCount: report.missingRedemptions.length,
    duplicateRedemptionCount: report.duplicateRedemptionIds.length,
    unexpectedActiveRedemptionCount:
      report.unexpectedActiveRedemptions.length,
    missingEventCount: report.missingEventKeys.length,
    mismatchCount: report.mismatches.length,
    couponIds: [...new Set(couponIds)].slice(0, MAX_LOGGED_COUPON_IDS),
  };
}

export async function readMerchantCouponsWithV1Verification<
  T extends MerchantCouponV1ReadSnapshot,
>(input: {
  siteId: string;
  legacy: T;
  loadV1: () => Promise<MerchantCouponV1VerificationData | null>;
  config?: MerchantCouponV1ReadConfig;
  logger?: MerchantCouponV1ReadLogger;
}): Promise<T> {
  const config = input.config ?? resolveMerchantCouponV1ReadConfig();
  if (!isMerchantCouponV1ReadEnabled(input.siteId, config)) {
    return input.legacy;
  }

  const verificationStartedAt = Date.now();
  const observedV1 = await observeV1Read(input.loadV1, config.timeoutMs);
  const logger = input.logger ?? defaultReadLogger;
  const log = (
    outcome: MerchantCouponV1ReadEvent["outcome"],
    reason: MerchantCouponV1ReadEvent["reason"],
    metrics = emptyMetrics(),
  ) => {
    try {
      const completedAt = Date.now();
      logger({
        event: "merchant_coupon_v1_read",
        siteId: trimText(input.siteId),
        mode: "verify",
        observedAt: new Date(completedAt).toISOString(),
        durationMs: Math.max(0, completedAt - verificationStartedAt),
        outcome,
        reason,
        legacyCouponCount: input.legacy.coupons.length,
        ...metrics,
      });
    } catch {
      // Read observability must never affect the legacy coupon result.
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

  let report: MerchantCouponReconciliationReport;
  try {
    const v1 = validateMerchantCouponV1VerificationData(
      input.siteId,
      observedV1.value,
    );
    report = reconcileMerchantCouponStorage({
      merchantId: input.siteId,
      legacyCoupons: input.legacy.coupons,
      v1Coupons: v1.coupons,
      v1Claims: v1.claims,
      v1Redemptions: v1.redemptions,
      v1Events: v1.events,
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
