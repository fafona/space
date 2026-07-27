import {
  DEFAULT_MERCHANT_ORDER_V1_PRIMARY_CANARY_WATCH_HEALTH_POLICY,
  evaluateMerchantOrderV1PrimaryCanaryWatchHealth,
  type MerchantOrderV1PrimaryCanaryWatchHealthReport,
} from "../src/lib/merchantOrderV1PrimaryCanaryWatchHealth";
import { readV1PrimaryCanaryWatchState } from "./watch-v1-primary-canary";

export type V1PrimaryCanaryWatchHealthOptions = {
  stateFile: string;
  siteId: string;
  activatedAt: string;
  maximumStateAgeMinutes: number;
  maximumPendingDeliveryAgeMinutes: number;
  format: "text" | "json";
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

export function parseV1PrimaryCanaryWatchHealthOptions(
  args: string[],
): V1PrimaryCanaryWatchHealthOptions {
  const options: Partial<V1PrimaryCanaryWatchHealthOptions> = {
    maximumStateAgeMinutes:
      DEFAULT_MERCHANT_ORDER_V1_PRIMARY_CANARY_WATCH_HEALTH_POLICY.maximumStateAgeMinutes,
    maximumPendingDeliveryAgeMinutes:
      DEFAULT_MERCHANT_ORDER_V1_PRIMARY_CANARY_WATCH_HEALTH_POLICY.maximumPendingDeliveryAgeMinutes,
    format: "text",
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

    if (name === "state-file") {
      if (value === "-") throw new Error("state_file_cannot_be_stdin");
      options.stateFile = value;
    } else if (name === "site") {
      if (!/^\d{8}$/.test(value)) throw new Error("site_must_be_exact_8_digit_id");
      options.siteId = value;
    } else if (name === "activated-at") {
      options.activatedAt = parseTimestamp(value);
    } else if (name === "max-state-age-minutes") {
      options.maximumStateAgeMinutes = parseBoundedInteger(
        value,
        "max_state_age_minutes",
        1,
        1440,
      );
    } else if (name === "max-pending-age-minutes") {
      options.maximumPendingDeliveryAgeMinutes = parseBoundedInteger(
        value,
        "max_pending_age_minutes",
        1,
        1440,
      );
    } else if (name === "format") {
      if (value !== "text" && value !== "json") {
        throw new Error("format_must_be_text_or_json");
      }
      options.format = value;
    } else {
      throw new Error(`unknown_argument:${name}`);
    }
  }

  if (!options.stateFile) throw new Error("state_file_is_required");
  if (!options.siteId) throw new Error("site_is_required");
  if (!options.activatedAt) throw new Error("activated_at_is_required");
  return options as V1PrimaryCanaryWatchHealthOptions;
}

function formatNumber(value: number | null) {
  return value === null ? "-" : value.toFixed(1);
}

export function renderV1PrimaryCanaryWatchHealthReport(
  report: MerchantOrderV1PrimaryCanaryWatchHealthReport,
  format: "text" | "json",
) {
  if (format === "json") return JSON.stringify(report);
  return [
    "[v1-primary-canary-watch-health]",
    `site=${report.siteId}`,
    `health=${report.status}`,
    `canary=${report.canaryStatus ?? "-"}`,
    `state-age-minutes=${formatNumber(report.stateAgeMinutes)}`,
    `evaluation-age-minutes=${formatNumber(report.evaluationAgeMinutes)}`,
    `pending-age-minutes=${formatNumber(report.pendingNotificationAgeMinutes)}`,
    `blockers=${report.blockers.join(",") || "-"}`,
    `warnings=${report.warnings.join(",") || "-"}`,
  ].join(" ");
}

export function v1PrimaryCanaryWatchHealthExitCode(
  status: MerchantOrderV1PrimaryCanaryWatchHealthReport["status"],
) {
  if (status === "critical") return 2;
  if (status === "degraded") return 3;
  return 0;
}

async function main() {
  const options = parseV1PrimaryCanaryWatchHealthOptions(process.argv.slice(2));
  let state = null;
  let stateUnreadable = false;
  try {
    state = await readV1PrimaryCanaryWatchState(options.stateFile, {
      siteId: options.siteId,
      activatedAt: options.activatedAt,
    });
  } catch {
    stateUnreadable = true;
  }

  const report = evaluateMerchantOrderV1PrimaryCanaryWatchHealth({
    state,
    stateUnreadable,
    siteId: options.siteId,
    activatedAt: options.activatedAt,
    policy: {
      maximumStateAgeMinutes: options.maximumStateAgeMinutes,
      maximumPendingDeliveryAgeMinutes:
        options.maximumPendingDeliveryAgeMinutes,
    },
  });
  console.log(renderV1PrimaryCanaryWatchHealthReport(report, options.format));
  process.exitCode = v1PrimaryCanaryWatchHealthExitCode(report.status);
}

const invokedFile = process.argv[1]?.replaceAll("\\", "/") ?? "";
if (invokedFile.endsWith("/check-v1-primary-canary-watch-health.ts")) {
  main().catch((error) => {
    console.error(
      `[v1-primary-canary-watch-health] failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  });
}
