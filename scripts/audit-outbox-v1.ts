import { evaluateMerchantOutboxHealth } from "../src/lib/merchantOutboxHealth";
import {
  assertOutboxV1Ready,
  createOutboxRestRuntime,
  loadOutboxV1Health,
} from "./outbox-v1-runtime";

type AuditOptions = {
  merchantId?: string;
  windowHours: number;
  maximumDueAgeSeconds: number;
};

function parseBoundedInteger(
  value: string,
  name: string,
  minimum: number,
  maximum: number,
) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || String(parsed) !== value || parsed < minimum || parsed > maximum) {
    throw new Error(`${name}_must_be_between_${minimum}_and_${maximum}`);
  }
  return parsed;
}

export function parseOutboxAuditOptions(args: string[]): AuditOptions {
  const options: AuditOptions = {
    windowHours: 24,
    maximumDueAgeSeconds: 300,
  };
  const seen = new Set<string>();
  for (const arg of args) {
    const separator = arg.indexOf("=");
    if (!arg.startsWith("--") || separator < 3) {
      throw new Error(`unknown_argument:${arg}`);
    }
    const name = arg.slice(2, separator);
    const value = arg.slice(separator + 1).trim();
    if (seen.has(name)) throw new Error(`duplicate_argument:${name}`);
    seen.add(name);
    if (name === "site") {
      if (!/^\d{8}$/.test(value)) throw new Error("site_must_be_exact_8_digit_id");
      options.merchantId = value;
    } else if (name === "window-hours") {
      options.windowHours = parseBoundedInteger(value, "window_hours", 1, 168);
    } else if (name === "max-due-age-seconds") {
      options.maximumDueAgeSeconds = parseBoundedInteger(
        value,
        "max_due_age_seconds",
        30,
        86400,
      );
    } else {
      throw new Error(`unknown_argument:${name}`);
    }
  }
  return options;
}

async function main() {
  const options = parseOutboxAuditOptions(process.argv.slice(2));
  const runtime = createOutboxRestRuntime();
  await assertOutboxV1Ready(runtime);
  const snapshot = await loadOutboxV1Health(runtime, {
    merchantId: options.merchantId,
    windowHours: options.windowHours,
  });
  const evaluation = evaluateMerchantOutboxHealth(snapshot, {
    maximumOldestDueAgeSeconds: options.maximumDueAgeSeconds,
  });
  console.log(
    `[outbox-v1-audit] scope=${snapshot.merchantScope} status=${evaluation.status} pending=${snapshot.pendingCount} retry-scheduled=${snapshot.retryScheduledCount} processing=${snapshot.processingCount} completed=${snapshot.completedCount} dead-letter=${snapshot.deadLetterCount} due=${snapshot.dueCount} scheduled=${snapshot.scheduledCount} expired-leases=${snapshot.expiredLeaseCount} attempt-limit-risk=${snapshot.attemptLimitRiskCount} unknown-types=${snapshot.unknownEventTypeCount} oldest-due-seconds=${snapshot.oldestDueAgeSeconds} attempts-${snapshot.windowHours}h=${snapshot.attemptsInWindow} completed-attempts=${snapshot.completedAttemptsInWindow} retry-attempts=${snapshot.retryAttemptsInWindow} dead-letter-attempts=${snapshot.deadLetterAttemptsInWindow} lease-expired-attempts=${snapshot.leaseExpiredAttemptsInWindow}`,
  );
  evaluation.blockers.forEach((code) => {
    console.error(`[outbox-v1-audit] blocker=${code}`);
  });
  evaluation.warnings.forEach((code) => {
    console.warn(`[outbox-v1-audit] warning=${code}`);
  });
  if (evaluation.status === "degraded") process.exitCode = 2;
}

const invokedFile = process.argv[1]?.replaceAll("\\", "/") ?? "";
if (invokedFile.endsWith("/audit-outbox-v1.ts")) {
  main().catch((error) => {
    console.error(
      `[outbox-v1-audit] failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
