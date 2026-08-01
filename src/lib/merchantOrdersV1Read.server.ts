import {
  normalizeMerchantOrderRecords,
  type MerchantOrderRecord,
} from "@/lib/merchantOrders";
import {
  type MerchantOrdersStoreClient,
  type StoredMerchantOrders,
  type StoredMerchantOrdersWindow,
} from "@/lib/merchantOrdersStore";
import {
  convertMerchantOrderV1Rows,
  type MerchantOrderItemV1StoredRow,
  type MerchantOrderV1StoredRow,
} from "@/lib/merchantOrdersV1";
import {
  merchantOrderV1ReadCircuitBreaker,
  resolveMerchantOrderV1ReadCircuitBreakerConfig,
  type MerchantOrderV1ReadCircuitBreaker,
  type MerchantOrderV1ReadCircuitBreakerConfig,
  type MerchantOrderV1ReadCircuitPermit,
} from "@/lib/merchantOrderV1ReadCircuitBreaker";

export const MERCHANT_ORDER_V1_READ_MODES = ["off", "verify", "primary"] as const;

export type MerchantOrderV1ReadMode = (typeof MERCHANT_ORDER_V1_READ_MODES)[number];

export type MerchantOrderV1ReadConfig = {
  mode: MerchantOrderV1ReadMode;
  siteIds: string[];
  timeoutMs: number;
};

type MerchantOrderReadEnvelope = StoredMerchantOrders | StoredMerchantOrdersWindow;

export type MerchantOrderV1ReadEvent = {
  event: "merchant_order_v1_read";
  siteId: string;
  mode: Exclude<MerchantOrderV1ReadMode, "off">;
  observedAt: string;
  durationMs: number;
  outcome: "match" | "fallback";
  reason:
    | "parity"
    | "v1_timeout"
    | "v1_query_failed"
    | "v1_missing"
    | "circuit_open"
    | "legacy_missing"
    | "count_mismatch"
    | "order_id_mismatch"
    | "order_content_mismatch"
    | "window_metadata_mismatch";
  legacyCount: number;
  v1Count: number;
  orderIds: string[];
};

type MerchantOrderV1ReadLogger = (event: MerchantOrderV1ReadEvent) => void;

type MerchantOrderV1ReadClient = MerchantOrdersStoreClient;

const ORDER_SELECT_COLUMNS = [
  "merchant_id",
  "id",
  "site_name",
  "block_id",
  "client_request_id",
  "status",
  "currency",
  "price_prefix",
  "total_quantity",
  "total_amount_minor",
  "customer_snapshot",
  "source_snapshot",
  "confirmed_at",
  "completed_at",
  "cancelled_at",
  "printed_at",
  "print_count",
  "merchant_touched_at",
  "created_at",
  "updated_at",
].join(",");

const ITEM_SELECT_COLUMNS = [
  "merchant_id",
  "order_id",
  "line_number",
  "product_id",
  "code",
  "name",
  "description",
  "image_url",
  "tag",
  "quantity",
  "unit_amount_minor",
  "subtotal_amount_minor",
  "unit_price_text",
  "source_snapshot",
].join(",");

const DEFAULT_READ_TIMEOUT_MS = 2500;
const MIN_READ_TIMEOUT_MS = 250;
const MAX_READ_TIMEOUT_MS = 10000;
const READ_PAGE_SIZE = 1000;
const ITEM_ORDER_ID_CHUNK_SIZE = 50;
const MAX_ORDER_ROWS = 100000;
const MAX_ITEM_ROWS = 500000;
const MAX_LOGGED_ORDER_IDS = 20;

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
  return Number.isFinite(parsed) ? Math.min(1000, Math.max(1, Math.floor(parsed))) : 100;
}

function toErrorMessage(input: unknown) {
  if (input instanceof Error && input.message.trim()) return input.message.trim();
  if (typeof input === "string" && input.trim()) return input.trim();
  if (input && typeof input === "object") {
    const message = (input as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return "unknown_error";
}

function throwV1ReadError(scope: string, input: unknown): never {
  throw new Error(`merchant_orders_v1_${scope}_failed:${toErrorMessage(input)}`);
}

function isStoredWindow(
  value: MerchantOrderReadEnvelope,
): value is StoredMerchantOrdersWindow {
  return (
    typeof (value as Partial<StoredMerchantOrdersWindow>).offset === "number" &&
    typeof (value as Partial<StoredMerchantOrdersWindow>).limit === "number" &&
    typeof (value as Partial<StoredMerchantOrdersWindow>).hasMore === "boolean"
  );
}

function buildUpdatedAt(orders: MerchantOrderRecord[]) {
  let latest = "";
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const order of orders) {
    const parsed = Date.parse(order.updatedAt);
    if (!Number.isFinite(parsed) || parsed <= latestTime) continue;
    latest = order.updatedAt;
    latestTime = parsed;
  }
  return latest || null;
}

async function readRows<T>(
  query: PromiseLike<{ data?: unknown; error?: unknown }>,
  scope: string,
): Promise<T[]> {
  const result = await query;
  if (result.error) throwV1ReadError(scope, result.error);
  if (result.data === null || result.data === undefined) return [];
  if (!Array.isArray(result.data)) throwV1ReadError(scope, "invalid_response");
  return result.data as T[];
}

async function readAllOrderRows(
  client: MerchantOrderV1ReadClient,
  siteId: string,
): Promise<MerchantOrderV1StoredRow[]> {
  const rows: MerchantOrderV1StoredRow[] = [];
  for (let offset = 0; offset < MAX_ORDER_ROWS; offset += READ_PAGE_SIZE) {
    const page = await readRows<MerchantOrderV1StoredRow>(
      client
        .from("merchant_orders")
        .select(ORDER_SELECT_COLUMNS)
        .eq("merchant_id", siteId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + READ_PAGE_SIZE - 1),
      "orders_query",
    );
    rows.push(...page);
    if (page.length < READ_PAGE_SIZE) return rows;
  }
  throwV1ReadError("orders_query", "row_limit_exceeded");
}

async function readOrderWindowRows(
  client: MerchantOrderV1ReadClient,
  siteId: string,
  offset: number,
  limit: number,
) {
  return readRows<MerchantOrderV1StoredRow>(
    client
      .from("merchant_orders")
      .select(ORDER_SELECT_COLUMNS)
      .eq("merchant_id", siteId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + limit),
    "orders_window_query",
  );
}

async function readSingleOrderRows(
  client: MerchantOrderV1ReadClient,
  siteId: string,
  orderId: string,
) {
  return readRows<MerchantOrderV1StoredRow>(
    client
      .from("merchant_orders")
      .select(ORDER_SELECT_COLUMNS)
      .eq("merchant_id", siteId)
      .eq("id", orderId)
      .limit(1),
    "order_query",
  );
}

function chunkValues<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function readItemRows(
  client: MerchantOrderV1ReadClient,
  siteId: string,
  orderIds: string[],
): Promise<MerchantOrderItemV1StoredRow[]> {
  if (orderIds.length === 0) return [];
  const rows: MerchantOrderItemV1StoredRow[] = [];
  for (const orderIdChunk of chunkValues(orderIds, ITEM_ORDER_ID_CHUNK_SIZE)) {
    for (let offset = 0; offset < MAX_ITEM_ROWS; offset += READ_PAGE_SIZE) {
      const page = await readRows<MerchantOrderItemV1StoredRow>(
        client
          .from("merchant_order_items")
          .select(ITEM_SELECT_COLUMNS)
          .eq("merchant_id", siteId)
          .in("order_id", orderIdChunk)
          .order("order_id", { ascending: true })
          .order("line_number", { ascending: true })
          .range(offset, offset + READ_PAGE_SIZE - 1),
        "items_query",
      );
      if (rows.length + page.length > MAX_ITEM_ROWS) {
        throwV1ReadError("items_query", "row_limit_exceeded");
      }
      rows.push(...page);
      if (page.length < READ_PAGE_SIZE) break;
      if (rows.length >= MAX_ITEM_ROWS) {
        throwV1ReadError("items_query", "row_limit_exceeded");
      }
    }
  }
  return rows;
}

async function readSingleOrderItemRows(
  client: MerchantOrderV1ReadClient,
  siteId: string,
  orderId: string,
) {
  return readRows<MerchantOrderItemV1StoredRow>(
    client
      .from("merchant_order_items")
      .select(ITEM_SELECT_COLUMNS)
      .eq("merchant_id", siteId)
      .eq("order_id", orderId)
      .order("line_number", { ascending: true }),
    "order_items_query",
  );
}

function convertRowsOrThrow(input: {
  siteId: string;
  orderRows: MerchantOrderV1StoredRow[];
  itemRows: MerchantOrderItemV1StoredRow[];
}) {
  const converted = convertMerchantOrderV1Rows({
    merchantId: input.siteId,
    orderRows: input.orderRows,
    itemRows: input.itemRows,
  });
  if (!converted.valid) {
    const errorCodes = [...new Set(converted.errors.map((error) => error.code))].sort();
    throwV1ReadError("conversion", errorCodes.join(",") || "invalid_rows");
  }
  return converted.orders;
}

export function resolveMerchantOrderV1ReadConfig(
  environment: Record<string, string | undefined> = process.env,
): MerchantOrderV1ReadConfig {
  const requestedMode = trimText(environment.MERCHANT_ORDER_V1_READ_MODE).toLowerCase();
  const mode: MerchantOrderV1ReadMode =
    requestedMode === "verify" || requestedMode === "primary" ? requestedMode : "off";
  const siteIds = [
    ...new Set(
      trimText(environment.MERCHANT_ORDER_V1_READ_SITE_IDS)
        .split(",")
        .map((siteId) => siteId.trim())
        .filter((siteId) => /^\d{8}$/.test(siteId)),
    ),
  ];
  return {
    mode,
    siteIds,
    timeoutMs: normalizeTimeoutMs(environment.MERCHANT_ORDER_V1_READ_TIMEOUT_MS),
  };
}

export function isMerchantOrderV1ReadEnabled(
  siteId: string,
  config: MerchantOrderV1ReadConfig,
) {
  const normalizedSiteId = trimText(siteId);
  return config.mode !== "off" && config.siteIds.includes(normalizedSiteId);
}

export async function loadMerchantOrdersV1(
  client: MerchantOrderV1ReadClient,
  siteId: string,
): Promise<StoredMerchantOrders> {
  const normalizedSiteId = trimText(siteId);
  const orderRows = await readAllOrderRows(client, normalizedSiteId);
  const itemRows = await readItemRows(
    client,
    normalizedSiteId,
    orderRows.map((row) => trimText(row.id)).filter(Boolean),
  );
  const orders = convertRowsOrThrow({
    siteId: normalizedSiteId,
    orderRows,
    itemRows,
  });
  return {
    siteId: normalizedSiteId,
    orders,
    updatedAt: buildUpdatedAt(orders),
  };
}

export async function loadMerchantOrderV1(
  client: MerchantOrderV1ReadClient,
  siteId: string,
  orderId: string,
): Promise<StoredMerchantOrders> {
  const normalizedSiteId = trimText(siteId);
  const normalizedOrderId = trimText(orderId);
  if (!normalizedSiteId || !normalizedOrderId) {
    return { siteId: normalizedSiteId, orders: [], updatedAt: null };
  }

  const orderRows = await readSingleOrderRows(
    client,
    normalizedSiteId,
    normalizedOrderId,
  );
  if (orderRows.length === 0) {
    return { siteId: normalizedSiteId, orders: [], updatedAt: null };
  }
  if (
    orderRows.some(
      (row) =>
        trimText(row.merchant_id) !== normalizedSiteId ||
        trimText(row.id) !== normalizedOrderId,
    )
  ) {
    throwV1ReadError("order_query", "scope_mismatch");
  }

  const itemRows = await readSingleOrderItemRows(
    client,
    normalizedSiteId,
    normalizedOrderId,
  );
  const orders = convertRowsOrThrow({
    siteId: normalizedSiteId,
    orderRows,
    itemRows,
  });
  return {
    siteId: normalizedSiteId,
    orders,
    updatedAt: buildUpdatedAt(orders),
  };
}

export async function loadMerchantOrdersV1Window(
  client: MerchantOrderV1ReadClient,
  siteId: string,
  input: {
    offset?: number;
    limit?: number;
  },
): Promise<StoredMerchantOrdersWindow> {
  const normalizedSiteId = trimText(siteId);
  const offset = normalizeWindowOffset(input.offset);
  const limit = normalizeWindowLimit(input.limit);
  const loadedRows = await readOrderWindowRows(client, normalizedSiteId, offset, limit);
  const hasMore = loadedRows.length > limit;
  const orderRows = loadedRows.slice(0, limit);
  const itemRows = await readItemRows(
    client,
    normalizedSiteId,
    orderRows.map((row) => trimText(row.id)).filter(Boolean),
  );
  const orders = convertRowsOrThrow({
    siteId: normalizedSiteId,
    orderRows,
    itemRows,
  });
  return {
    siteId: normalizedSiteId,
    orders,
    updatedAt: buildUpdatedAt(orders),
    offset,
    limit,
    hasMore,
  };
}

function compareReadEnvelopes(
  legacy: MerchantOrderReadEnvelope,
  v1: MerchantOrderReadEnvelope,
) {
  const legacyOrders = normalizeMerchantOrderRecords(legacy.orders);
  const v1Orders = normalizeMerchantOrderRecords(v1.orders);
  if (legacyOrders.length !== v1Orders.length) {
    return {
      reason: "count_mismatch" as const,
      orderIds: [],
      orderedV1Orders: [] as MerchantOrderRecord[],
    };
  }

  const legacyOrderIds = legacyOrders.map((order) => order.id);
  const legacyOrderIdSet = new Set(legacyOrderIds);
  const v1ById = new Map(v1Orders.map((order) => [order.id, order]));
  if (
    legacyOrderIdSet.size !== legacyOrderIds.length ||
    v1ById.size !== v1Orders.length ||
    legacyOrderIds.some((orderId) => !v1ById.has(orderId))
  ) {
    const allIds = new Set([...legacyOrderIds, ...v1Orders.map((order) => order.id)]);
    const mismatchedIds = [...allIds].filter(
      (orderId) =>
        !legacyOrderIdSet.has(orderId) ||
        !v1ById.has(orderId),
    );
    return {
      reason: "order_id_mismatch" as const,
      orderIds: mismatchedIds.slice(0, MAX_LOGGED_ORDER_IDS),
      orderedV1Orders: [] as MerchantOrderRecord[],
    };
  }

  const mismatchedOrderIds = legacyOrders
    .filter((legacyOrder) => JSON.stringify(legacyOrder) !== JSON.stringify(v1ById.get(legacyOrder.id)))
    .map((order) => order.id);
  if (mismatchedOrderIds.length > 0) {
    return {
      reason: "order_content_mismatch" as const,
      orderIds: mismatchedOrderIds.slice(0, MAX_LOGGED_ORDER_IDS),
      orderedV1Orders: [] as MerchantOrderRecord[],
    };
  }

  if (
    isStoredWindow(legacy) !== isStoredWindow(v1) ||
    (isStoredWindow(legacy) &&
      isStoredWindow(v1) &&
      (legacy.offset !== v1.offset || legacy.limit !== v1.limit || legacy.hasMore !== v1.hasMore))
  ) {
    return {
      reason: "window_metadata_mismatch" as const,
      orderIds: [],
      orderedV1Orders: [] as MerchantOrderRecord[],
    };
  }

  return {
    reason: "parity" as const,
    orderIds: [],
    orderedV1Orders: legacyOrderIds.map((orderId) => v1ById.get(orderId) as MerchantOrderRecord),
  };
}

function defaultReadLogger(event: MerchantOrderV1ReadEvent) {
  const output = JSON.stringify(event);
  if (event.outcome === "fallback") {
    console.warn("[merchant-order-v1-read]", output);
  } else {
    console.info("[merchant-order-v1-read]", output);
  }
}

async function observeV1Read<T extends MerchantOrderReadEnvelope>(
  loadV1: () => Promise<T | null>,
  timeoutMs: number,
): Promise<
  | { status: "loaded"; value: T | null }
  | { status: "timeout" }
  | { status: "failed" }
> {
  const timeoutToken = Symbol("merchant_order_v1_read_timeout");
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      loadV1(),
      new Promise<typeof timeoutToken>((resolve) => {
        timeoutHandle = setTimeout(() => resolve(timeoutToken), Math.max(1, timeoutMs));
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

export async function readMerchantOrdersWithV1Fallback<T extends MerchantOrderReadEnvelope>(input: {
  siteId: string;
  loadLegacy: () => Promise<T | null>;
  loadV1: () => Promise<T | null>;
  config?: MerchantOrderV1ReadConfig;
  circuitBreaker?: MerchantOrderV1ReadCircuitBreaker;
  circuitBreakerConfig?: MerchantOrderV1ReadCircuitBreakerConfig;
  logger?: MerchantOrderV1ReadLogger;
}): Promise<T | null> {
  const config = input.config ?? resolveMerchantOrderV1ReadConfig();
  if (!isMerchantOrderV1ReadEnabled(input.siteId, config)) {
    return input.loadLegacy();
  }

  const verificationStartedAt = Date.now();
  const mode = config.mode as Exclude<MerchantOrderV1ReadMode, "off">;
  const normalizedSiteId = trimText(input.siteId);
  const circuitBreaker = input.circuitBreaker ?? merchantOrderV1ReadCircuitBreaker;
  const circuitBreakerConfig =
    input.circuitBreakerConfig ?? resolveMerchantOrderV1ReadCircuitBreakerConfig();
  const circuitPermit: MerchantOrderV1ReadCircuitPermit | null =
    mode === "primary"
      ? circuitBreaker.acquire(
          normalizedSiteId,
          circuitBreakerConfig,
          verificationStartedAt,
        )
      : null;
  const logger = input.logger ?? defaultReadLogger;
  let legacy: T | null = null;

  const log = (
    outcome: MerchantOrderV1ReadEvent["outcome"],
    reason: MerchantOrderV1ReadEvent["reason"],
    v1Count: number,
    orderIds: string[] = [],
  ) => {
    try {
      const completedAt = Date.now();
      logger({
        event: "merchant_order_v1_read",
        siteId: normalizedSiteId,
        mode,
        observedAt: new Date(completedAt).toISOString(),
        durationMs: Math.max(0, completedAt - verificationStartedAt),
        outcome,
        reason,
        legacyCount: legacy?.orders.length ?? 0,
        v1Count,
        orderIds: orderIds.slice(0, MAX_LOGGED_ORDER_IDS),
      });
    } catch {
      // Observability must never affect the order read path.
    }
  };

  const legacyTask = Promise.resolve().then(input.loadLegacy);
  if (circuitPermit && !circuitPermit.allowed) {
    legacy = await legacyTask;
    log("fallback", "circuit_open", 0);
    return legacy;
  }

  const v1Task = observeV1Read(input.loadV1, config.timeoutMs);
  try {
    legacy = await legacyTask;
  } catch (error) {
    if (circuitPermit) {
      circuitBreaker.recordInconclusive(
        normalizedSiteId,
        circuitBreakerConfig,
        circuitPermit,
      );
    }
    throw error;
  }
  const observedV1 = await v1Task;

  const recordCircuitFailure = () => {
    if (!circuitPermit) return;
    circuitBreaker.recordFailure(
      normalizedSiteId,
      circuitBreakerConfig,
      circuitPermit,
    );
  };

  if (observedV1.status === "timeout") {
    recordCircuitFailure();
    log("fallback", "v1_timeout", 0);
    return legacy;
  }
  if (observedV1.status === "failed") {
    recordCircuitFailure();
    log("fallback", "v1_query_failed", 0);
    return legacy;
  }
  const v1 = observedV1.value;
  if (!v1) {
    recordCircuitFailure();
    log("fallback", "v1_missing", 0);
    return legacy;
  }
  if (!legacy) {
    if (circuitPermit) {
      circuitBreaker.recordInconclusive(
        normalizedSiteId,
        circuitBreakerConfig,
        circuitPermit,
      );
    }
    log("fallback", "legacy_missing", v1.orders.length);
    return legacy;
  }

  const comparison = compareReadEnvelopes(legacy, v1);
  if (comparison.reason !== "parity") {
    recordCircuitFailure();
    log("fallback", comparison.reason, v1.orders.length, comparison.orderIds);
    return legacy;
  }

  if (circuitPermit) {
    circuitBreaker.recordSuccess(
      normalizedSiteId,
      circuitBreakerConfig,
      circuitPermit,
    );
  }
  log("match", "parity", v1.orders.length);
  if (mode === "verify") return legacy;
  return {
    ...legacy,
    orders: comparison.orderedV1Orders,
  };
}
