import type { MerchantCouponRecord } from "@/lib/merchantCoupons";
import {
  buildMerchantCouponV1Mutation,
  type MerchantCouponClaimV1Payload,
  type MerchantCouponEventV1Payload,
  type MerchantCouponRedemptionV1Payload,
  type MerchantCouponV1Mutation,
} from "@/lib/merchantCouponsV1";

export const MERCHANT_COUPON_DUAL_WRITE_MODES = ["off", "shadow"] as const;

export type MerchantCouponDualWriteMode =
  (typeof MERCHANT_COUPON_DUAL_WRITE_MODES)[number];

export type MerchantCouponDualWriteConfig = {
  mode: MerchantCouponDualWriteMode;
  siteIds: string[];
  timeoutMs: number;
};

export type MerchantCouponShadowChange = {
  current: MerchantCouponRecord;
  previous?: MerchantCouponRecord | null;
};

export type MerchantCouponShadowClient = {
  rpc: (
    functionName: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data?: unknown; error?: unknown }>;
};

export type MerchantCouponDualWriteResult = {
  status: "disabled" | "skipped" | "written" | "failed" | "timeout";
  count: number;
  error?: string;
};

type MerchantCouponShadowLogger = (event: {
  event: "merchant_coupon_shadow_write_failed";
  status: "failed" | "timeout";
  siteIds: string[];
  couponIds: string[];
  count: number;
  error: string;
}) => void;

const DEFAULT_TIMEOUT_MS = 2500;
const MIN_TIMEOUT_MS = 250;
const MAX_TIMEOUT_MS = 10000;

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  const text = String(error ?? "").trim();
  return text || "unknown_error";
}

function normalizeTimeoutMs(value: unknown) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, parsed));
}

export function normalizeMerchantCouponDualWriteSiteIds(value: unknown) {
  return Array.from(
    new Set(
      String(value ?? "")
        .split(",")
        .map((siteId) => siteId.trim())
        .filter((siteId) => /^\d{8}$/.test(siteId)),
    ),
  );
}

export function resolveMerchantCouponDualWriteConfig(
  environment: Record<string, string | undefined> = process.env,
): MerchantCouponDualWriteConfig {
  const requestedMode = trimText(
    environment.MERCHANT_COUPON_V1_DUAL_WRITE_MODE,
  ).toLowerCase();
  return {
    mode: requestedMode === "shadow" ? "shadow" : "off",
    siteIds: normalizeMerchantCouponDualWriteSiteIds(
      environment.MERCHANT_COUPON_V1_DUAL_WRITE_SITE_IDS,
    ),
    timeoutMs: normalizeTimeoutMs(
      environment.MERCHANT_COUPON_V1_DUAL_WRITE_TIMEOUT_MS,
    ),
  };
}

function compareTimestamp(left: unknown, right: unknown) {
  const leftTime = Date.parse(trimText(left));
  const rightTime = Date.parse(trimText(right));
  if (!Number.isFinite(leftTime)) return -1;
  if (!Number.isFinite(rightTime)) return 1;
  return leftTime - rightTime;
}

function mergeById<T>(
  left: T[],
  right: T[],
  readId: (value: T) => string,
  readUpdatedAt?: (value: T) => string,
) {
  const map = new Map<string, T>();
  [...left, ...right].forEach((value) => {
    const id = readId(value);
    if (!id) return;
    const current = map.get(id);
    if (
      !current ||
      !readUpdatedAt ||
      compareTimestamp(readUpdatedAt(current), readUpdatedAt(value)) <= 0
    ) {
      map.set(id, value);
    }
  });
  return [...map.values()];
}

function mergeCouponMutations(
  left: MerchantCouponV1Mutation,
  right: MerchantCouponV1Mutation,
) {
  const rightIsLatest =
    compareTimestamp(left.coupon.updated_at, right.coupon.updated_at) <= 0;
  const latest = rightIsLatest ? right : left;
  return {
    coupon: latest.coupon,
    claims: mergeById<MerchantCouponClaimV1Payload>(
      left.claims,
      right.claims,
      (claim) => claim.id,
      (claim) => claim.source_updated_at,
    ),
    redemptions: mergeById<MerchantCouponRedemptionV1Payload>(
      left.redemptions,
      right.redemptions,
      (redemption) => redemption.id,
      (redemption) => redemption.source_updated_at,
    ),
    released_redemption_ids: [
      ...new Set([
        ...left.released_redemption_ids,
        ...right.released_redemption_ids,
      ]),
    ],
    events: mergeById<MerchantCouponEventV1Payload>(
      left.events,
      right.events,
      (event) => event.idempotency_key,
    ),
  } satisfies MerchantCouponV1Mutation;
}

function buildEligibleMutations(
  changes: MerchantCouponShadowChange[],
  config: MerchantCouponDualWriteConfig,
  buildMutation: (
    current: MerchantCouponRecord,
    previous?: MerchantCouponRecord | null,
  ) => MerchantCouponV1Mutation,
) {
  const allowedSites = new Set(config.siteIds);
  const mutations = new Map<string, MerchantCouponV1Mutation>();
  for (const change of Array.isArray(changes) ? changes : []) {
    const siteId = trimText(change?.current?.siteId);
    const couponId = trimText(change?.current?.id);
    if (!siteId || !couponId || !allowedSites.has(siteId)) continue;
    const mutation = buildMutation(change.current, change.previous);
    const identity = `${siteId}:${couponId}`;
    const current = mutations.get(identity);
    mutations.set(
      identity,
      current ? mergeCouponMutations(current, mutation) : mutation,
    );
  }
  return [...mutations.values()];
}

function defaultShadowLogger(event: Parameters<MerchantCouponShadowLogger>[0]) {
  console.error("[merchant-coupon-dual-write]", JSON.stringify(event));
}

export async function mirrorMerchantCouponChanges(
  client: MerchantCouponShadowClient,
  changes: MerchantCouponShadowChange[],
  options?: {
    config?: MerchantCouponDualWriteConfig;
    logger?: MerchantCouponShadowLogger;
    buildMutation?: (
      current: MerchantCouponRecord,
      previous?: MerchantCouponRecord | null,
    ) => MerchantCouponV1Mutation;
  },
): Promise<MerchantCouponDualWriteResult> {
  const config = options?.config ?? resolveMerchantCouponDualWriteConfig();
  if (config.mode === "off") return { status: "disabled", count: 0 };

  const timeoutToken = Symbol("merchant_coupon_shadow_timeout");
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let mutations: MerchantCouponV1Mutation[] = [];

  try {
    mutations = buildEligibleMutations(
      changes,
      config,
      options?.buildMutation ?? buildMerchantCouponV1Mutation,
    );
    if (mutations.length === 0) return { status: "skipped", count: 0 };

    const query = Promise.resolve(
      client.rpc("faolla_upsert_merchant_coupons_v1", {
        p_mutations: mutations,
      }),
    );
    const result = await Promise.race([
      query,
      new Promise<typeof timeoutToken>((resolve) => {
        timeoutHandle = setTimeout(() => resolve(timeoutToken), config.timeoutMs);
      }),
    ]);

    if (result === timeoutToken) {
      const error = `shadow_write_timeout:${config.timeoutMs}`;
      (options?.logger ?? defaultShadowLogger)({
        event: "merchant_coupon_shadow_write_failed",
        status: "timeout",
        siteIds: [
          ...new Set(mutations.map((mutation) => mutation.coupon.merchant_id)),
        ],
        couponIds: mutations.map((mutation) => mutation.coupon.id),
        count: mutations.length,
        error,
      });
      return { status: "timeout", count: mutations.length, error };
    }

    if (result.error) throw result.error;
    return { status: "written", count: mutations.length };
  } catch (error) {
    const message = toErrorMessage(error);
    const eligibleChanges = changes.filter((change) =>
      config.siteIds.includes(trimText(change?.current?.siteId)),
    );
    (options?.logger ?? defaultShadowLogger)({
      event: "merchant_coupon_shadow_write_failed",
      status: "failed",
      siteIds: [
        ...new Set(
          eligibleChanges.map((change) => trimText(change.current.siteId)),
        ),
      ],
      couponIds: eligibleChanges.map((change) => trimText(change.current.id)),
      count: mutations.length || eligibleChanges.length,
      error: message,
    });
    return {
      status: "failed",
      count: mutations.length || eligibleChanges.length,
      error: message,
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
