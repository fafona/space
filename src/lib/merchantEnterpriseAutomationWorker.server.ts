import {
  MerchantEnterpriseAccessError,
  requireMerchantEnterpriseEntitlement,
} from "@/lib/merchantEnterpriseAuth.server";
import type { MerchantOutboxRpcClient } from "@/lib/merchantOutboxEnqueue.server";
import {
  type MerchantOutboxClaimedEvent,
} from "@/lib/merchantOutbox.server";
import {
  MerchantOutboxTaskError,
  type MerchantOutboxTaskHandler,
} from "@/lib/merchantOutboxWorker.server";
import { MERCHANT_ENTERPRISE_AUTOMATION_OUTBOX_EVENT_TYPE } from "@/lib/merchantEnterpriseAutomation.server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL_AUTOMATION_RULE_ERROR_CODES = new Set([
  "automation_target_unavailable",
  "automation_workflow_unavailable",
  "automation_assignee_unavailable",
]);

type Dependencies = {
  requireEntitlement: (siteId: string) => Promise<unknown>;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, maximum = 1000) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function entitlementCode(error: unknown) {
  if (error instanceof MerchantEnterpriseAccessError) return error.code;
  if (error instanceof Error) return error.message;
  return "";
}

function assertEvent(event: MerchantOutboxClaimedEvent) {
  const payload = record(event.payload);
  const sourceType = payload?.sourceType;
  const eventId = text(payload?.eventId, 80).toLowerCase();
  const aggregateType =
    sourceType === "order" ? "merchant_order_event" : "merchant_booking_event";
  if (
    event.eventType !== MERCHANT_ENTERPRISE_AUTOMATION_OUTBOX_EVENT_TYPE ||
    !payload ||
    Object.keys(payload).some(
      (key) => key !== "sourceType" && key !== "eventId",
    ) ||
    (sourceType !== "order" && sourceType !== "booking") ||
    !UUID_PATTERN.test(eventId) ||
    event.aggregateType !== aggregateType ||
    event.aggregateId.toLowerCase() !== eventId ||
    event.eventKey !== `enterprise-automation:${sourceType}:${eventId}`
  ) {
    throw new MerchantOutboxTaskError("invalid_automation_outbox_event", {
      retryable: false,
    });
  }
  return { sourceType, eventId } as const;
}

function assertPauseResult(value: unknown, siteId: string) {
  const source = record(value);
  const pausedCount = source?.pausedCount ?? source?.paused_count;
  if (
    text(source?.merchantId ?? source?.merchant_id, 80) !== siteId ||
    !Number.isSafeInteger(pausedCount) ||
    Number(pausedCount) < 0 ||
    Number(pausedCount) > 100
  ) {
    throw new MerchantOutboxTaskError("invalid_automation_pause_result");
  }
}

async function rpc(
  client: MerchantOutboxRpcClient,
  functionName: string,
  args: Record<string, unknown>,
) {
  const result = await Promise.resolve(client.rpc(functionName, args));
  if (result.error) throw result.error;
  return result.data;
}

function normalizeProcessorResult(value: unknown, siteId: string) {
  const source = record(value);
  const runs = source?.runs;
  if (
    text(source?.merchantId, 80) !== siteId ||
    !Array.isArray(runs) ||
    runs.length > 20
  ) {
    throw new MerchantOutboxTaskError("invalid_automation_processor_result");
  }
  let completed = 0;
  let failed = 0;
  let retryableFailed = 0;
  let skipped = 0;
  let processing = 0;
  for (const value of runs) {
    const run = record(value);
    const runId = text(run?.runId, 80);
    const status = run?.status;
    if (
      !run ||
      !UUID_PATTERN.test(runId) ||
      (status !== "processing" &&
        status !== "completed" &&
        status !== "failed" &&
        status !== "skipped")
    ) {
      throw new MerchantOutboxTaskError("invalid_automation_processor_result");
    }
    if (status === "processing") processing += 1;
    else if (status === "completed") completed += 1;
    else if (status === "failed") {
      const errorCode = text(run.errorCode, 80);
      if (
        !/^[a-z][a-z0-9_]{0,79}$/.test(errorCode) ||
        typeof run.retryable !== "boolean" ||
        run.retryable === TERMINAL_AUTOMATION_RULE_ERROR_CODES.has(errorCode)
      ) {
        throw new MerchantOutboxTaskError("invalid_automation_processor_result");
      }
      failed += 1;
      if (run.retryable) retryableFailed += 1;
    }
    else skipped += 1;
  }
  return {
    runCount: runs.length,
    processing,
    completed,
    failed,
    retryableFailed,
    skipped,
  };
}

export function createMerchantEnterpriseAutomationOutboxHandler(
  client: MerchantOutboxRpcClient,
  options: Partial<Dependencies> = {},
): MerchantOutboxTaskHandler {
  const dependencies: Dependencies = {
    requireEntitlement: requireMerchantEnterpriseEntitlement,
    ...options,
  };
  return async (event, context) => {
    const input = assertEvent(event);
    if (context.signal.aborted) {
      throw new MerchantOutboxTaskError("automation_task_aborted");
    }
    try {
      await dependencies.requireEntitlement(event.merchantId);
    } catch (error) {
      if (entitlementCode(error) === "enterprise_management_disabled") {
        try {
          const pauseResult = await rpc(
            client,
            "faolla_pause_merchant_enterprise_automations_for_entitlement_v1",
            {
              p_input: {
                merchant_id: event.merchantId,
                reason_code: "entitlement_revoked",
              },
            },
          );
          assertPauseResult(pauseResult, event.merchantId);
        } catch {
          throw new MerchantOutboxTaskError(
            "automation_entitlement_pause_failed",
            { retryable: true },
          );
        }
        return {
          status: "skipped",
          reasonCode: "enterprise_management_disabled",
        };
      }
      throw new MerchantOutboxTaskError("enterprise_entitlement_unavailable", {
        retryable: true,
        retryAfterSeconds: 60,
      });
    }
    if (!(await context.renewLease())) {
      throw new MerchantOutboxTaskError("automation_lease_lost");
    }
    let data: unknown;
    try {
      data = await rpc(
        client,
        "faolla_process_merchant_enterprise_automation_event_v1",
        {
          p_input: {
            merchant_id: event.merchantId,
            source_type: input.sourceType,
            event_id: input.eventId,
          },
        },
      );
    } catch {
      throw new MerchantOutboxTaskError("automation_processor_failed", {
        retryable: true,
      });
    }
    const summary = normalizeProcessorResult(data, event.merchantId);
    if (summary.retryableFailed > 0) {
      throw new MerchantOutboxTaskError("automation_rule_failed", {
        retryable: true,
      });
    }
    if (summary.processing > 0) {
      throw new MerchantOutboxTaskError("automation_rule_processing", {
        retryable: true,
        retryAfterSeconds: 15,
      });
    }
    return { status: "processed", ...summary };
  };
}
