import { isDeepStrictEqual } from "node:util";

import {
  MERCHANT_BOOKING_STATUSES,
  withoutMerchantBookingToken,
  type MerchantBookingRecord,
  type MerchantBookingStoredRecord,
} from "@/lib/merchantBookings";

export const MERCHANT_BOOKING_V1_READ_MODES = ["off", "verify"] as const;

export type MerchantBookingV1ReadMode =
  (typeof MERCHANT_BOOKING_V1_READ_MODES)[number];

export type MerchantBookingV1ReadConfig = {
  mode: MerchantBookingV1ReadMode;
  siteIds: string[];
  timeoutMs: number;
};

export type MerchantBookingV1ReadEnvelope = {
  records: MerchantBookingRecord[];
  offset?: number;
  limit?: number;
  total?: number;
  hasMore?: boolean;
};

export type MerchantBookingV1StoredRow = {
  merchant_id?: unknown;
  id?: unknown;
  source_snapshot?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
};

type MerchantBookingV1QueryResult = {
  data?: unknown;
  error?: unknown;
  count?: number | null;
};

type MerchantBookingV1Query = PromiseLike<MerchantBookingV1QueryResult> & {
  select: (
    columns: string,
    options?: { count?: "exact" },
  ) => MerchantBookingV1Query;
  eq: (column: string, value: unknown) => MerchantBookingV1Query;
  order: (
    column: string,
    options: { ascending: boolean },
  ) => MerchantBookingV1Query;
  range: (from: number, to: number) => MerchantBookingV1Query;
};

export type MerchantBookingV1ReadClient = {
  from: (table: string) => MerchantBookingV1Query;
};

export type MerchantBookingV1ReadEvent = {
  event: "merchant_booking_v1_read";
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
    | "count_mismatch"
    | "booking_id_mismatch"
    | "booking_content_mismatch"
    | "booking_order_mismatch"
    | "window_metadata_mismatch";
  legacyCount: number;
  v1Count: number;
  bookingIds: string[];
};

type MerchantBookingV1ReadLogger = (
  event: MerchantBookingV1ReadEvent,
) => void;

const BOOKING_SELECT_COLUMNS = [
  "merchant_id",
  "id",
  "source_snapshot",
  "created_at",
  "updated_at",
].join(",");
const DEFAULT_READ_TIMEOUT_MS = 2500;
const MIN_READ_TIMEOUT_MS = 250;
const MAX_READ_TIMEOUT_MS = 10000;
const READ_PAGE_SIZE = 1000;
const MAX_BOOKING_ROWS = 100000;
const MAX_LOGGED_BOOKING_IDS = 20;

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTimeoutMs(value: unknown) {
  const parsed = Number.parseInt(trimText(value), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_READ_TIMEOUT_MS;
  return Math.min(MAX_READ_TIMEOUT_MS, Math.max(MIN_READ_TIMEOUT_MS, parsed));
}

function normalizeWindowOffset(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function normalizeWindowLimit(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(1000, Math.max(1, Math.floor(parsed)))
    : 500;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasValidTimestamp(value: unknown) {
  const text = trimText(value);
  return Boolean(text) && Number.isFinite(Date.parse(text));
}

function throwReadError(scope: string): never {
  throw new Error(`merchant_bookings_v1_${scope}_failed`);
}

async function readQuery(
  query: MerchantBookingV1Query,
  scope: string,
): Promise<MerchantBookingV1QueryResult> {
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

function assertStoredSnapshot(
  siteId: string,
  row: MerchantBookingV1StoredRow,
): MerchantBookingStoredRecord {
  const merchantId = trimText(row.merchant_id);
  const bookingId = trimText(row.id);
  const snapshot = row.source_snapshot;
  if (
    merchantId !== siteId ||
    !bookingId ||
    !isPlainRecord(snapshot) ||
    Object.hasOwn(snapshot, "editToken") ||
    trimText(snapshot.siteId) !== siteId ||
    trimText(snapshot.id) !== bookingId ||
    !MERCHANT_BOOKING_STATUSES.includes(
      trimText(snapshot.status) as (typeof MERCHANT_BOOKING_STATUSES)[number],
    ) ||
    !hasValidTimestamp(snapshot.createdAt) ||
    !hasValidTimestamp(snapshot.updatedAt)
  ) {
    throwReadError("conversion");
  }
  const requiredTextFields = [
    "siteName",
    "store",
    "item",
    "appointmentAt",
    "title",
    "customerName",
    "email",
    "phone",
    "note",
  ];
  if (
    requiredTextFields.some(
      (field) => typeof snapshot[field] !== "string",
    )
  ) {
    throwReadError("conversion");
  }
  return {
    ...structuredClone(snapshot),
    editToken: "",
  } as MerchantBookingStoredRecord;
}

export function convertMerchantBookingV1Rows(input: {
  siteId: string;
  rows: MerchantBookingV1StoredRow[];
  options?: {
    includeAutomationState?: boolean;
    includeCustomerEmailLogs?: boolean;
    includeTimeline?: boolean;
  };
}) {
  const siteId = trimText(input.siteId);
  if (!/^\d{8}$/.test(siteId)) throwReadError("conversion");
  const seen = new Set<string>();
  return input.rows.map((row) => {
    const bookingId = trimText(row.id);
    if (seen.has(bookingId)) throwReadError("conversion");
    seen.add(bookingId);
    return withoutMerchantBookingToken(
      assertStoredSnapshot(siteId, row),
      input.options,
    );
  });
}

function buildBaseQuery(
  client: MerchantBookingV1ReadClient,
  siteId: string,
  count = false,
) {
  return client
    .from("merchant_bookings")
    .select(
      BOOKING_SELECT_COLUMNS,
      count ? { count: "exact" } : undefined,
    )
    .eq("merchant_id", siteId)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
}

export async function loadMerchantBookingsV1(
  client: MerchantBookingV1ReadClient,
  siteId: string,
  options?: {
    includeAutomationState?: boolean;
    includeCustomerEmailLogs?: boolean;
    includeTimeline?: boolean;
  },
): Promise<MerchantBookingV1ReadEnvelope> {
  const normalizedSiteId = trimText(siteId);
  const rows: MerchantBookingV1StoredRow[] = [];
  for (let offset = 0; offset < MAX_BOOKING_ROWS; offset += READ_PAGE_SIZE) {
    const result = await readQuery(
      buildBaseQuery(client, normalizedSiteId).range(
        offset,
        offset + READ_PAGE_SIZE - 1,
      ),
      "query",
    );
    const page = (result.data ?? []) as MerchantBookingV1StoredRow[];
    rows.push(...page);
    if (page.length < READ_PAGE_SIZE) {
      return {
        records: convertMerchantBookingV1Rows({
          siteId: normalizedSiteId,
          rows,
          options,
        }),
      };
    }
  }
  throwReadError("row_limit");
}

export async function loadMerchantBookingsV1Window(
  client: MerchantBookingV1ReadClient,
  siteId: string,
  input: {
    offset?: number;
    limit?: number;
    includeAutomationState?: boolean;
    includeCustomerEmailLogs?: boolean;
    includeTimeline?: boolean;
  },
): Promise<MerchantBookingV1ReadEnvelope> {
  const normalizedSiteId = trimText(siteId);
  const offset = normalizeWindowOffset(input.offset);
  const limit = normalizeWindowLimit(input.limit);
  const result = await readQuery(
    buildBaseQuery(client, normalizedSiteId, true).range(
      offset,
      offset + limit - 1,
    ),
    "window_query",
  );
  if (
    !Number.isInteger(result.count) ||
    (result.count as number) < 0
  ) {
    throwReadError("window_count");
  }
  const rows = (result.data ?? []) as MerchantBookingV1StoredRow[];
  const total = result.count as number;
  return {
    records: convertMerchantBookingV1Rows({
      siteId: normalizedSiteId,
      rows,
      options: input,
    }),
    offset,
    limit,
    total,
    hasMore: offset + rows.length < total,
  };
}

export function resolveMerchantBookingV1ReadConfig(
  environment: Record<string, string | undefined> = process.env,
): MerchantBookingV1ReadConfig {
  const mode =
    trimText(environment.MERCHANT_BOOKING_V1_READ_MODE).toLowerCase() ===
    "verify"
      ? "verify"
      : "off";
  const siteIds = [
    ...new Set(
      trimText(environment.MERCHANT_BOOKING_V1_READ_SITE_IDS)
        .split(",")
        .map((siteId) => siteId.trim())
        .filter((siteId) => /^\d{8}$/.test(siteId)),
    ),
  ];
  return {
    mode,
    siteIds,
    timeoutMs: normalizeTimeoutMs(
      environment.MERCHANT_BOOKING_V1_READ_TIMEOUT_MS,
    ),
  };
}

export function isMerchantBookingV1ReadEnabled(
  siteId: string,
  config: MerchantBookingV1ReadConfig,
) {
  return (
    config.mode === "verify" &&
    config.siteIds.includes(trimText(siteId))
  );
}

function compareEnvelopes(
  legacy: MerchantBookingV1ReadEnvelope,
  v1: MerchantBookingV1ReadEnvelope,
) {
  if (legacy.records.length !== v1.records.length) {
    return { reason: "count_mismatch" as const, bookingIds: [] };
  }
  const legacyIds = legacy.records.map((record) => record.id);
  const v1ById = new Map(v1.records.map((record) => [record.id, record]));
  if (
    new Set(legacyIds).size !== legacyIds.length ||
    v1ById.size !== v1.records.length ||
    legacyIds.some((bookingId) => !v1ById.has(bookingId))
  ) {
    const legacyIdSet = new Set(legacyIds);
    const allIds = new Set([
      ...legacyIds,
      ...v1.records.map((record) => record.id),
    ]);
    return {
      reason: "booking_id_mismatch" as const,
      bookingIds: [...allIds]
        .filter(
          (bookingId) =>
            !legacyIdSet.has(bookingId) || !v1ById.has(bookingId),
        )
        .slice(0, MAX_LOGGED_BOOKING_IDS),
    };
  }
  const contentMismatchIds = legacy.records
    .filter(
      (record) =>
        !isDeepStrictEqual(record, v1ById.get(record.id)),
    )
    .map((record) => record.id);
  if (contentMismatchIds.length > 0) {
    return {
      reason: "booking_content_mismatch" as const,
      bookingIds: contentMismatchIds.slice(0, MAX_LOGGED_BOOKING_IDS),
    };
  }
  if (
    legacyIds.some(
      (bookingId, index) => v1.records[index]?.id !== bookingId,
    )
  ) {
    return {
      reason: "booking_order_mismatch" as const,
      bookingIds: legacyIds.slice(0, MAX_LOGGED_BOOKING_IDS),
    };
  }
  const metadataKeys = ["offset", "limit", "total", "hasMore"] as const;
  if (
    metadataKeys.some(
      (key) => legacy[key] !== v1[key],
    )
  ) {
    return {
      reason: "window_metadata_mismatch" as const,
      bookingIds: [],
    };
  }
  return { reason: "parity" as const, bookingIds: [] };
}

function defaultReadLogger(event: MerchantBookingV1ReadEvent) {
  const output = JSON.stringify(event);
  if (event.outcome === "fallback") {
    console.warn("[merchant-booking-v1-read]", output);
  } else {
    console.info("[merchant-booking-v1-read]", output);
  }
}

async function observeV1Read(
  loadV1: () => Promise<MerchantBookingV1ReadEnvelope | null>,
  timeoutMs: number,
): Promise<
  | { status: "loaded"; value: MerchantBookingV1ReadEnvelope | null }
  | { status: "timeout" }
  | { status: "failed" }
> {
  const timeoutToken = Symbol("merchant_booking_v1_read_timeout");
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

export async function readMerchantBookingsWithV1Verification<
  T extends MerchantBookingV1ReadEnvelope,
>(input: {
  siteId: string;
  loadLegacy: () => Promise<T>;
  loadV1: () => Promise<MerchantBookingV1ReadEnvelope | null>;
  config?: MerchantBookingV1ReadConfig;
  logger?: MerchantBookingV1ReadLogger;
}): Promise<T> {
  const config = input.config ?? resolveMerchantBookingV1ReadConfig();
  if (!isMerchantBookingV1ReadEnabled(input.siteId, config)) {
    return input.loadLegacy();
  }

  const verificationStartedAt = Date.now();
  const legacyTask = input.loadLegacy();
  const v1Task = observeV1Read(input.loadV1, config.timeoutMs);
  const legacy = await legacyTask;
  const observedV1 = await v1Task;
  const logger = input.logger ?? defaultReadLogger;
  const log = (
    outcome: MerchantBookingV1ReadEvent["outcome"],
    reason: MerchantBookingV1ReadEvent["reason"],
    v1Count: number,
    bookingIds: string[] = [],
  ) => {
    try {
      const completedAt = Date.now();
      logger({
        event: "merchant_booking_v1_read",
        siteId: trimText(input.siteId),
        mode: "verify",
        observedAt: new Date(completedAt).toISOString(),
        durationMs: Math.max(0, completedAt - verificationStartedAt),
        outcome,
        reason,
        legacyCount: legacy.records.length,
        v1Count,
        bookingIds: bookingIds.slice(0, MAX_LOGGED_BOOKING_IDS),
      });
    } catch {
      // Read observability must never affect the legacy booking result.
    }
  };

  if (observedV1.status === "timeout") {
    log("fallback", "v1_timeout", 0);
    return legacy;
  }
  if (observedV1.status === "failed") {
    log("fallback", "v1_query_failed", 0);
    return legacy;
  }
  const v1 = observedV1.value;
  if (!v1) {
    log("fallback", "v1_missing", 0);
    return legacy;
  }
  const comparison = compareEnvelopes(legacy, v1);
  if (comparison.reason !== "parity") {
    log(
      "fallback",
      comparison.reason,
      v1.records.length,
      comparison.bookingIds,
    );
    return legacy;
  }
  log("match", "parity", v1.records.length);
  return legacy;
}
