import {
  isMerchantOutboxEventType,
  MerchantOutboxValidationError,
  normalizeMerchantOutboxClaimedEvent,
  normalizeMerchantOutboxResult,
  type MerchantOutboxClaimedEvent,
  type MerchantOutboxEventType,
} from "@/lib/merchantOutbox.server";
import type { MerchantOutboxRpcClient } from "@/lib/merchantOutboxEnqueue.server";

export type MerchantOutboxTaskContext = {
  signal: AbortSignal;
  renewLease: () => Promise<boolean>;
  workerId?: string;
};

export type MerchantOutboxTaskHandler = (
  event: MerchantOutboxClaimedEvent,
  context: MerchantOutboxTaskContext,
) => Promise<Record<string, unknown> | void>;

export type MerchantOutboxTaskHandlers = Partial<
  Record<MerchantOutboxEventType, MerchantOutboxTaskHandler>
>;

export type MerchantOutboxTaskFailure = {
  code: string;
  retryable: boolean;
  retryAfterSeconds?: number;
};

export type MerchantOutboxEventSettlement = {
  complete: (input: {
    client: MerchantOutboxRpcClient;
    event: MerchantOutboxClaimedEvent;
    workerId: string;
    result: Record<string, unknown>;
  }) => Promise<boolean>;
  fail: (input: {
    client: MerchantOutboxRpcClient;
    event: MerchantOutboxClaimedEvent;
    workerId: string;
    error: MerchantOutboxTaskFailure;
  }) => Promise<"retry_scheduled" | "dead_lettered" | "lease_lost">;
};

export type MerchantOutboxEventSettlements = Partial<
  Record<MerchantOutboxEventType, MerchantOutboxEventSettlement>
>;

export type MerchantOutboxWorkerSummary = {
  status: "idle" | "processed" | "failed";
  claimed: number;
  completed: number;
  retried: number;
  deadLettered: number;
  leaseLost: number;
  malformed: number;
  errorCode?: string;
};

export class MerchantOutboxTaskError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number;

  constructor(
    code: string,
    options?: {
      retryable?: boolean;
      retryAfterSeconds?: number;
    },
  ) {
    const normalizedCode = normalizeErrorCode(code);
    super(normalizedCode);
    this.name = "MerchantOutboxTaskError";
    this.code = normalizedCode;
    this.retryable = options?.retryable !== false;
    this.retryAfterSeconds = normalizeOptionalRetryDelay(options?.retryAfterSeconds);
  }
}

type MerchantOutboxWorkerOptions = {
  workerId: string;
  merchantIds: string[];
  limit?: number;
  leaseSeconds?: number;
  taskTimeoutMs?: number;
  claimFunctionName?:
    | "faolla_claim_merchant_outbox_scoped_v1"
    | "faolla_claim_merchant_enterprise_automation_outbox_v1";
  handlers: MerchantOutboxTaskHandlers;
  settlements?: MerchantOutboxEventSettlements;
};

const EMPTY_SUMMARY: MerchantOutboxWorkerSummary = {
  status: "idle",
  claimed: 0,
  completed: 0,
  retried: 0,
  deadLettered: 0,
  leaseLost: 0,
  malformed: 0,
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function normalizeOptionalRetryDelay(value: unknown) {
  if (value === undefined || value === null) return undefined;
  return normalizeInteger(value, 5, 5, 86400);
}

function normalizeErrorCode(value: unknown) {
  const code = trimText(value).toLowerCase();
  return /^[a-z][a-z0-9_:-]{0,79}$/.test(code) ? code : "task_failed";
}

function normalizeWorkerId(value: unknown) {
  const workerId = trimText(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(workerId)) {
    throw new MerchantOutboxValidationError("invalid_outbox_worker_id");
  }
  return workerId;
}

function normalizeMerchantIds(value: unknown) {
  if (!Array.isArray(value)) {
    throw new MerchantOutboxValidationError("invalid_outbox_worker_merchant_scope");
  }
  const merchantIds = Array.from(
    new Set(
      value.map((entry) => trimText(entry)).filter((entry) => /^\d{8}$/.test(entry)),
    ),
  ).sort();
  if (
    merchantIds.length === 0 ||
    merchantIds.length > 50 ||
    merchantIds.length !== value.length
  ) {
    throw new MerchantOutboxValidationError("invalid_outbox_worker_merchant_scope");
  }
  return merchantIds;
}

function readClaimedRowId(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const id = trimText((value as { id?: unknown }).id);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id,
  )
    ? id
    : "";
}

function getRpcErrorCode(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === "object"
        ? trimText((error as { message?: unknown }).message)
        : "";
  const normalized = message.toLowerCase();
  if (normalized.includes("does not exist") || normalized.includes("schema cache")) {
    return "outbox_schema_unavailable";
  }
  if (normalized.includes("timeout")) return "outbox_rpc_timeout";
  return "outbox_rpc_failed";
}

async function callRpc(
  client: MerchantOutboxRpcClient,
  name: string,
  args: Record<string, unknown>,
) {
  const result = await Promise.resolve(client.rpc(name, args));
  if (result.error) throw result.error;
  return result.data;
}

function resolveTaskError(error: unknown): MerchantOutboxTaskFailure {
  if (error instanceof MerchantOutboxTaskError) {
    return {
      code: error.code,
      retryable: error.retryable,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }
  if (error instanceof MerchantOutboxValidationError) {
    return {
      code: normalizeErrorCode(error.code),
      retryable: false,
      retryAfterSeconds: undefined,
    };
  }
  return {
    code: error instanceof DOMException && error.name === "AbortError"
      ? "task_aborted"
      : "task_failed",
    retryable: true,
    retryAfterSeconds: undefined,
  };
}

async function failClaimedEvent(
  client: MerchantOutboxRpcClient,
  event: MerchantOutboxClaimedEvent,
  workerId: string,
  error: ReturnType<typeof resolveTaskError>,
) {
  const data = await callRpc(client, "faolla_fail_merchant_outbox_v1", {
    p_event_id: event.id,
    p_worker_id: workerId,
    p_error_code: error.code,
    p_error_message: error.code,
    p_retryable: error.retryable,
    p_retry_after_seconds: error.retryAfterSeconds ?? null,
  });
  return data && typeof data === "object"
    ? trimText((data as { status?: unknown }).status)
    : "";
}

async function completeClaimedEvent(
  client: MerchantOutboxRpcClient,
  event: MerchantOutboxClaimedEvent,
  workerId: string,
  result: Record<string, unknown>,
) {
  const completion = await callRpc(
    client,
    "faolla_complete_merchant_outbox_v1",
    {
      p_event_id: event.id,
      p_worker_id: workerId,
      p_result: result,
    },
  );
  return completion === true;
}

export async function processMerchantOutboxBatch(
  client: MerchantOutboxRpcClient,
  options: MerchantOutboxWorkerOptions,
): Promise<MerchantOutboxWorkerSummary> {
  const workerId = normalizeWorkerId(options.workerId);
  const merchantIds = normalizeMerchantIds(options.merchantIds);
  const limit = normalizeInteger(options.limit, 10, 1, 50);
  const leaseSeconds = normalizeInteger(options.leaseSeconds, 60, 15, 900);
  const taskTimeoutMs = normalizeInteger(
    options.taskTimeoutMs,
    Math.max(5000, leaseSeconds * 800),
    1000,
    Math.max(1000, leaseSeconds * 900),
  );
  const eventTypes = Object.keys(options.handlers).filter(
    isMerchantOutboxEventType,
  ) as MerchantOutboxEventType[];
  if (eventTypes.length === 0) return { ...EMPTY_SUMMARY };

  let claimedRows: unknown;
  try {
    claimedRows = await callRpc(
      client,
      options.claimFunctionName ?? "faolla_claim_merchant_outbox_scoped_v1",
      {
      p_worker_id: workerId,
      p_merchant_ids: merchantIds,
      p_event_types: eventTypes,
      p_limit: limit,
      p_lease_seconds: leaseSeconds,
      },
    );
  } catch (error) {
    return {
      ...EMPTY_SUMMARY,
      status: "failed",
      errorCode: getRpcErrorCode(error),
    };
  }
  if (!Array.isArray(claimedRows) || claimedRows.length === 0) {
    return { ...EMPTY_SUMMARY };
  }

  const summary: MerchantOutboxWorkerSummary = {
    ...EMPTY_SUMMARY,
    status: "processed",
    claimed: claimedRows.length,
  };

  for (const row of claimedRows) {
    let event: MerchantOutboxClaimedEvent;
    try {
      event = normalizeMerchantOutboxClaimedEvent(row);
    } catch {
      summary.malformed += 1;
      const eventId = readClaimedRowId(row);
      if (eventId) {
        const data = await callRpc(client, "faolla_fail_merchant_outbox_v1", {
          p_event_id: eventId,
          p_worker_id: workerId,
          p_error_code: "malformed_claimed_event",
          p_error_message: "malformed_claimed_event",
          p_retryable: false,
          p_retry_after_seconds: null,
        }).catch(() => null);
        const outcome =
          data && typeof data === "object"
            ? trimText((data as { status?: unknown }).status)
            : "";
        if (outcome === "dead_lettered") summary.deadLettered += 1;
        else summary.leaseLost += 1;
      }
      continue;
    }
    const handler = isMerchantOutboxEventType(event.eventType)
      ? options.handlers[event.eventType]
      : undefined;
    if (!handler) {
      const outcome = await failClaimedEvent(client, event, workerId, {
        code: "handler_not_registered",
        retryable: false,
        retryAfterSeconds: undefined,
      }).catch(() => "lease_lost");
      if (outcome === "dead_lettered") summary.deadLettered += 1;
      else summary.leaseLost += 1;
      continue;
    }

    const controller = new AbortController();
    let leaseLost = false;
    let renewing = false;
    const renewLease = async () => {
      if (renewing || leaseLost) return !leaseLost;
      renewing = true;
      try {
        const data = await callRpc(client, "faolla_renew_merchant_outbox_lease_v1", {
          p_event_id: event.id,
          p_worker_id: workerId,
          p_lease_seconds: leaseSeconds,
        });
        if (data !== true) {
          leaseLost = true;
          controller.abort();
          return false;
        }
        return true;
      } catch {
        leaseLost = true;
        controller.abort();
        return false;
      } finally {
        renewing = false;
      }
    };
    const heartbeat = setInterval(
      () => void renewLease(),
      Math.max(5000, Math.floor(leaseSeconds * 400)),
    );
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutToken = Symbol("outbox_task_timeout");
      const result = await Promise.race([
        handler(event, { signal: controller.signal, renewLease, workerId }),
        new Promise<typeof timeoutToken>((resolve) => {
          timeoutHandle = setTimeout(() => {
            controller.abort();
            resolve(timeoutToken);
          }, taskTimeoutMs);
        }),
      ]);
      if (result === timeoutToken) {
        throw new MerchantOutboxTaskError("task_timeout", { retryable: true });
      }
      if (leaseLost) {
        summary.leaseLost += 1;
        continue;
      }
      const normalizedResult = normalizeMerchantOutboxResult(result ?? {});
      const settlement = options.settlements?.[event.eventType as MerchantOutboxEventType];
      const completed = settlement
        ? await settlement.complete({
            client,
            event,
            workerId,
            result: normalizedResult,
          })
        : await completeClaimedEvent(
            client,
            event,
            workerId,
            normalizedResult,
          );
      if (completed) summary.completed += 1;
      else summary.leaseLost += 1;
    } catch (error) {
      if (leaseLost) {
        summary.leaseLost += 1;
        continue;
      }
      const resolvedError = resolveTaskError(error);
      const settlement = options.settlements?.[event.eventType as MerchantOutboxEventType];
      const outcome = await (settlement
        ? settlement.fail({
            client,
            event,
            workerId,
            error: resolvedError,
          })
        : failClaimedEvent(client, event, workerId, resolvedError)
      ).catch(() => "lease_lost" as const);
      if (outcome === "retry_scheduled") summary.retried += 1;
      else if (outcome === "dead_lettered") summary.deadLettered += 1;
      else summary.leaseLost += 1;
    } finally {
      clearInterval(heartbeat);
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  return summary;
}
