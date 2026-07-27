import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

import {
  DEFAULT_MERCHANT_ORDER_V1_PRIMARY_CANARY_POLICY,
  evaluateMerchantOrderV1PrimaryCanary,
  parseMerchantOrderV1PrimaryCanaryLines,
} from "../src/lib/merchantOrderV1PrimaryCanaryAudit";

export type V1PrimaryCanaryAuditOptions = {
  file: string;
  siteId: string;
  activatedAt: string;
  minimumSamples: number;
  minimumObservationWindowMinutes: number;
  maximumP95DurationMs: number;
  maximumLastObservationAgeMinutes: number;
};

function parseBoundedInteger(
  value: string,
  name: string,
  minimum: number,
  maximum: number,
) {
  const parsed = Number.parseInt(value, 10);
  if (
    !Number.isFinite(parsed) ||
    String(parsed) !== value ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new Error(`${name}_must_be_between_${minimum}_and_${maximum}`);
  }
  return parsed;
}

function parseTimestamp(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("activated_at_must_be_valid_timestamp");
  }
  return new Date(parsed).toISOString();
}

export function parseV1PrimaryCanaryAuditOptions(
  args: string[],
): V1PrimaryCanaryAuditOptions {
  const options: Partial<V1PrimaryCanaryAuditOptions> = {
    minimumSamples:
      DEFAULT_MERCHANT_ORDER_V1_PRIMARY_CANARY_POLICY.minimumSamples,
    minimumObservationWindowMinutes:
      DEFAULT_MERCHANT_ORDER_V1_PRIMARY_CANARY_POLICY.minimumObservationWindowMinutes,
    maximumP95DurationMs:
      DEFAULT_MERCHANT_ORDER_V1_PRIMARY_CANARY_POLICY.maximumP95DurationMs,
    maximumLastObservationAgeMinutes:
      DEFAULT_MERCHANT_ORDER_V1_PRIMARY_CANARY_POLICY.maximumLastObservationAgeMinutes,
  };
  const seen = new Set<string>();

  for (const arg of args) {
    const separator = arg.indexOf("=");
    if (!arg.startsWith("--") || separator < 3) {
      throw new Error(`unknown_argument:${arg}`);
    }
    const name = arg.slice(2, separator);
    const value = arg.slice(separator + 1).trim();
    if (!value) throw new Error(`empty_argument:${name}`);
    if (seen.has(name)) throw new Error(`duplicate_argument:${name}`);
    seen.add(name);

    if (name === "file") {
      options.file = value;
    } else if (name === "site") {
      if (!/^\d{8}$/.test(value)) throw new Error("site_must_be_exact_8_digit_id");
      options.siteId = value;
    } else if (name === "activated-at") {
      options.activatedAt = parseTimestamp(value);
    } else if (name === "min-samples") {
      options.minimumSamples = parseBoundedInteger(
        value,
        "min_samples",
        1,
        1_000_000,
      );
    } else if (name === "min-window-minutes") {
      options.minimumObservationWindowMinutes = parseBoundedInteger(
        value,
        "min_window_minutes",
        1,
        43_200,
      );
    } else if (name === "max-p95-ms") {
      options.maximumP95DurationMs = parseBoundedInteger(
        value,
        "max_p95_ms",
        1,
        600_000,
      );
    } else if (name === "max-last-age-minutes") {
      options.maximumLastObservationAgeMinutes = parseBoundedInteger(
        value,
        "max_last_age_minutes",
        1,
        10_080,
      );
    } else {
      throw new Error(`unknown_argument:${name}`);
    }
  }

  if (!options.file) throw new Error("file_is_required");
  if (!options.siteId) throw new Error("site_is_required");
  if (!options.activatedAt) throw new Error("activated_at_is_required");
  return options as V1PrimaryCanaryAuditOptions;
}

async function loadObservationLines(file: string) {
  const stream =
    file === "-"
      ? process.stdin
      : createReadStream(resolve(process.cwd(), file), { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  const lines: string[] = [];
  for await (const line of reader) lines.push(line);
  return lines;
}

function formatNumber(value: number | null, fractionDigits = 1) {
  return value === null ? "-" : value.toFixed(fractionDigits);
}

async function main() {
  const options = parseV1PrimaryCanaryAuditOptions(process.argv.slice(2));
  const lines = await loadObservationLines(options.file);
  const parsed = parseMerchantOrderV1PrimaryCanaryLines(lines, {
    siteId: options.siteId,
    activatedAt: options.activatedAt,
  });
  const report = evaluateMerchantOrderV1PrimaryCanary({
    siteId: options.siteId,
    activatedAt: options.activatedAt,
    parsed,
    policy: {
      minimumSamples: options.minimumSamples,
      minimumObservationWindowMinutes: options.minimumObservationWindowMinutes,
      maximumP95DurationMs: options.maximumP95DurationMs,
      maximumLastObservationAgeMinutes:
        options.maximumLastObservationAgeMinutes,
    },
  });

  console.log(
    `[v1-primary-canary-audit] site=${report.siteId} status=${report.status} activated-at=${report.activatedAt} samples=${report.sampleCount} matches=${report.matchCount} fallbacks=${report.fallbackCount} circuit-open=${report.circuitOpenCount} rejected=${report.rejectedLineCount} ignored=${report.ignoredLineCount} window-minutes=${formatNumber(report.observationWindowMinutes)} last-age-minutes=${formatNumber(report.latestObservationAgeMinutes)} p50-ms=${formatNumber(report.p50DurationMs, 0)} p95-ms=${formatNumber(report.p95DurationMs, 0)} p99-ms=${formatNumber(report.p99DurationMs, 0)}`,
  );
  report.rollbackReasons.forEach((reason) => {
    console.error(`[v1-primary-canary-audit] rollback-reason=${reason}`);
  });
  report.observationBlockers.forEach((blocker) => {
    console.warn(`[v1-primary-canary-audit] observation-blocker=${blocker}`);
  });

  if (report.status === "rollback_required") {
    console.error(
      "[v1-primary-canary-audit] action=set MERCHANT_ORDER_V1_READ_MODE=off for the canary and redeploy",
    );
    process.exitCode = 2;
  } else if (report.status === "observing") {
    process.exitCode = 3;
  }
}

const invokedFile = process.argv[1]?.replaceAll("\\", "/") ?? "";
if (invokedFile.endsWith("/audit-v1-primary-canary.ts")) {
  main().catch((error) => {
    console.error(
      `[v1-primary-canary-audit] failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  });
}
