import type { MerchantBookingStoredRecord } from "@/lib/merchantBookings";
import {
  buildMerchantBookingV1Mutation,
  type MerchantBookingV1Mutation,
} from "@/lib/merchantBookingsV1";

export const MERCHANT_BOOKING_DUAL_WRITE_MODES = ["off", "shadow"] as const;

export type MerchantBookingDualWriteMode =
  (typeof MERCHANT_BOOKING_DUAL_WRITE_MODES)[number];

export type MerchantBookingDualWriteConfig = {
  mode: MerchantBookingDualWriteMode;
  siteIds: string[];
  timeoutMs: number;
};

export type MerchantBookingShadowClient = {
  rpc: (
    functionName: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data?: unknown; error?: unknown }>;
};

export type MerchantBookingDualWriteResult = {
  status: "disabled" | "skipped" | "written" | "failed" | "timeout";
  count: number;
  error?: string;
};

type MerchantBookingShadowLogger = (event: {
  event: "merchant_booking_shadow_write_failed";
  status: "failed" | "timeout";
  siteIds: string[];
  bookingIds: string[];
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

export function normalizeMerchantBookingDualWriteSiteIds(value: unknown) {
  return Array.from(
    new Set(
      String(value ?? "")
        .split(",")
        .map((siteId) => siteId.trim())
        .filter((siteId) => /^\d{8}$/.test(siteId)),
    ),
  );
}

export function resolveMerchantBookingDualWriteConfig(
  environment: Record<string, string | undefined> = process.env,
): MerchantBookingDualWriteConfig {
  const requestedMode = trimText(
    environment.MERCHANT_BOOKING_V1_DUAL_WRITE_MODE,
  ).toLowerCase();
  return {
    mode: requestedMode === "shadow" ? "shadow" : "off",
    siteIds: normalizeMerchantBookingDualWriteSiteIds(
      environment.MERCHANT_BOOKING_V1_DUAL_WRITE_SITE_IDS,
    ),
    timeoutMs: normalizeTimeoutMs(
      environment.MERCHANT_BOOKING_V1_DUAL_WRITE_TIMEOUT_MS,
    ),
  };
}

function compareUpdatedAt(
  left: MerchantBookingStoredRecord,
  right: MerchantBookingStoredRecord,
) {
  const leftTime = Date.parse(left.updatedAt);
  const rightTime = Date.parse(right.updatedAt);
  if (!Number.isFinite(leftTime)) return -1;
  if (!Number.isFinite(rightTime)) return 1;
  return leftTime - rightTime;
}

function selectEligibleRecords(
  records: MerchantBookingStoredRecord[],
  config: MerchantBookingDualWriteConfig,
) {
  const allowedSites = new Set(config.siteIds);
  const recordsByIdentity = new Map<string, MerchantBookingStoredRecord>();
  for (const record of Array.isArray(records) ? records : []) {
    const siteId = trimText(record?.siteId);
    const bookingId = trimText(record?.id);
    if (!siteId || !bookingId || !allowedSites.has(siteId)) continue;
    const identity = `${siteId}:${bookingId}`;
    const current = recordsByIdentity.get(identity);
    if (!current || compareUpdatedAt(current, record) <= 0) {
      recordsByIdentity.set(identity, record);
    }
  }
  return [...recordsByIdentity.values()];
}

function defaultShadowLogger(event: Parameters<MerchantBookingShadowLogger>[0]) {
  console.error("[merchant-booking-dual-write]", JSON.stringify(event));
}

export async function mirrorMerchantBookingRecords(
  client: MerchantBookingShadowClient,
  records: MerchantBookingStoredRecord[],
  options?: {
    config?: MerchantBookingDualWriteConfig;
    logger?: MerchantBookingShadowLogger;
    buildMutation?: (record: MerchantBookingStoredRecord) => MerchantBookingV1Mutation;
  },
): Promise<MerchantBookingDualWriteResult> {
  const config = options?.config ?? resolveMerchantBookingDualWriteConfig();
  if (config.mode === "off") return { status: "disabled", count: 0 };

  const eligibleRecords = selectEligibleRecords(records, config);
  if (eligibleRecords.length === 0) return { status: "skipped", count: 0 };

  const timeoutToken = Symbol("merchant_booking_shadow_timeout");
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    const mutations = eligibleRecords.map(
      options?.buildMutation ?? buildMerchantBookingV1Mutation,
    );
    const query = Promise.resolve(
      client.rpc("faolla_upsert_merchant_bookings_v1", {
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
        event: "merchant_booking_shadow_write_failed",
        status: "timeout",
        siteIds: [...new Set(eligibleRecords.map((record) => record.siteId))],
        bookingIds: eligibleRecords.map((record) => record.id),
        count: eligibleRecords.length,
        error,
      });
      return { status: "timeout", count: eligibleRecords.length, error };
    }

    if (result.error) throw result.error;
    return { status: "written", count: eligibleRecords.length };
  } catch (error) {
    const message = toErrorMessage(error);
    (options?.logger ?? defaultShadowLogger)({
      event: "merchant_booking_shadow_write_failed",
      status: "failed",
      siteIds: [...new Set(eligibleRecords.map((record) => record.siteId))],
      bookingIds: eligibleRecords.map((record) => record.id),
      count: eligibleRecords.length,
      error: message,
    });
    return {
      status: "failed",
      count: eligibleRecords.length,
      error: message,
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
