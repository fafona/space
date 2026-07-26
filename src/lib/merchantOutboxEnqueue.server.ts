import {
  buildMerchantOutboxEventMutation,
  isMerchantOutboxEventType,
  MerchantOutboxValidationError,
  type MerchantOutboxEventInput,
  type MerchantOutboxEventType,
} from "@/lib/merchantOutbox.server";

export type MerchantOutboxEnqueueMode = "off" | "shadow";

export type MerchantOutboxEnqueueConfig = {
  mode: MerchantOutboxEnqueueMode;
  siteIds: string[];
  eventTypes: MerchantOutboxEventType[];
  timeoutMs: number;
};

export type MerchantOutboxRpcClient = {
  rpc: (
    functionName: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data?: unknown; error?: unknown }>;
};

export type MerchantOutboxEnqueueResult = {
  status: "disabled" | "not_allowed" | "invalid" | "queued" | "failed" | "timeout";
  eventId?: string;
  deduplicated?: boolean;
  errorCode?: string;
};

type MerchantOutboxEnqueueLogger = (event: {
  event: "merchant_outbox_enqueue_failed";
  status: "invalid" | "failed" | "timeout";
  merchantId: string;
  eventType: string;
  aggregateType: string;
  errorCode: string;
}) => void;

const DEFAULT_TIMEOUT_MS = 2000;

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTimeoutMs(value: unknown) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.min(10000, Math.max(250, parsed));
}

function normalizeSiteIds(value: unknown) {
  return Array.from(
    new Set(
      trimText(value)
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => /^\d{8}$/.test(entry)),
    ),
  ).sort();
}

function normalizeEventTypes(value: unknown) {
  return Array.from(
    new Set(
      trimText(value)
        .split(",")
        .map((entry) => entry.trim())
        .filter(isMerchantOutboxEventType),
    ),
  ).sort() as MerchantOutboxEventType[];
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message.trim();
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message.trim();
  }
  return "";
}

function toSafeErrorCode(error: unknown) {
  const message = toErrorMessage(error).toLowerCase();
  if (message.includes("outbox_event_conflict")) return "outbox_event_conflict";
  if (message.includes("outbox_merchant_not_found")) return "outbox_merchant_not_found";
  if (message.includes("invalid_outbox")) return "invalid_outbox_event";
  if (message.includes("does not exist") || message.includes("schema cache")) {
    return "outbox_schema_unavailable";
  }
  return "outbox_enqueue_failed";
}

function defaultLogger(event: Parameters<MerchantOutboxEnqueueLogger>[0]) {
  console.error("[merchant-outbox-enqueue]", JSON.stringify(event));
}

export function resolveMerchantOutboxEnqueueConfig(
  environment: Record<string, string | undefined> = process.env,
): MerchantOutboxEnqueueConfig {
  return {
    mode:
      trimText(environment.MERCHANT_OUTBOX_V1_ENQUEUE_MODE).toLowerCase() === "shadow"
        ? "shadow"
        : "off",
    siteIds: normalizeSiteIds(environment.MERCHANT_OUTBOX_V1_ENQUEUE_SITE_IDS),
    eventTypes: normalizeEventTypes(environment.MERCHANT_OUTBOX_V1_ENQUEUE_EVENT_TYPES),
    timeoutMs: normalizeTimeoutMs(environment.MERCHANT_OUTBOX_V1_ENQUEUE_TIMEOUT_MS),
  };
}

export async function enqueueMerchantOutboxEvent(
  client: MerchantOutboxRpcClient,
  input: MerchantOutboxEventInput,
  options?: {
    config?: MerchantOutboxEnqueueConfig;
    logger?: MerchantOutboxEnqueueLogger;
  },
): Promise<MerchantOutboxEnqueueResult> {
  const config = options?.config ?? resolveMerchantOutboxEnqueueConfig();
  if (config.mode === "off") return { status: "disabled" };
  if (
    !config.siteIds.includes(trimText(input.merchantId)) ||
    !config.eventTypes.includes(input.eventType)
  ) {
    return { status: "not_allowed" };
  }

  let mutation;
  try {
    mutation = buildMerchantOutboxEventMutation(input);
  } catch (error) {
    const errorCode =
      error instanceof MerchantOutboxValidationError
        ? error.code
        : "invalid_outbox_event";
    (options?.logger ?? defaultLogger)({
      event: "merchant_outbox_enqueue_failed",
      status: "invalid",
      merchantId: trimText(input.merchantId),
      eventType: trimText(input.eventType),
      aggregateType: trimText(input.aggregateType),
      errorCode,
    });
    return { status: "invalid", errorCode };
  }

  const timeoutToken = Symbol("merchant_outbox_enqueue_timeout");
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve(
        client.rpc("faolla_enqueue_merchant_outbox_v1", {
          p_event: mutation,
        }),
      ),
      new Promise<typeof timeoutToken>((resolve) => {
        timeoutHandle = setTimeout(() => resolve(timeoutToken), config.timeoutMs);
      }),
    ]);
    if (result === timeoutToken) {
      const errorCode = `outbox_enqueue_timeout_${config.timeoutMs}`;
      (options?.logger ?? defaultLogger)({
        event: "merchant_outbox_enqueue_failed",
        status: "timeout",
        merchantId: mutation.merchant_id,
        eventType: mutation.event_type,
        aggregateType: mutation.aggregate_type,
        errorCode,
      });
      return { status: "timeout", errorCode };
    }
    if (result.error) throw result.error;
    const data =
      result.data && typeof result.data === "object"
        ? (result.data as Record<string, unknown>)
        : {};
    const eventId = trimText(data.id);
    if (!eventId) throw new Error("outbox_enqueue_invalid_response");
    return {
      status: "queued",
      eventId,
      deduplicated: data.deduplicated === true,
    };
  } catch (error) {
    const errorCode = toSafeErrorCode(error);
    (options?.logger ?? defaultLogger)({
      event: "merchant_outbox_enqueue_failed",
      status: "failed",
      merchantId: mutation.merchant_id,
      eventType: mutation.event_type,
      aggregateType: mutation.aggregate_type,
      errorCode,
    });
    return { status: "failed", errorCode };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
