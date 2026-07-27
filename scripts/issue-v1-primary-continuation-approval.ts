import { loadEnvConfig } from "@next/env";

import {
  createMerchantOrderV1ContinuationDeploymentApprovalReceipt,
  invalidateMerchantOrderV1DeploymentApprovalReceipt,
  MERCHANT_ORDER_V1_DEPLOYMENT_APPROVAL_DEFAULT_TTL_MS,
  MERCHANT_ORDER_V1_DEPLOYMENT_APPROVAL_MAXIMUM_TTL_MS,
  MERCHANT_ORDER_V1_DEPLOYMENT_APPROVAL_MINIMUM_TTL_MS,
  persistMerchantOrderV1DeploymentApproval,
} from "../src/lib/merchantOrderV1DeploymentApproval.server";
import {
  DEFAULT_MERCHANT_ORDER_V1_PRIMARY_CANARY_WATCH_HEALTH_POLICY,
  evaluateMerchantOrderV1PrimaryCanaryWatchHealth,
  type MerchantOrderV1PrimaryCanaryWatchHealthReport,
} from "../src/lib/merchantOrderV1PrimaryCanaryWatchHealth";
import { readV1PrimaryCanaryWatchState } from "./watch-v1-primary-canary";

export type V1PrimaryContinuationApprovalOptions = {
  stateFile: string;
  siteId: string;
  activatedAt: string;
  receiptFile: string;
  auditFile: string;
  ttlMinutes: number;
  maximumStateAgeMinutes: number;
  maximumPendingDeliveryAgeMinutes: number;
  format: "text" | "json";
};

export type V1PrimaryContinuationApprovalReport = {
  schemaVersion: 1;
  status: "issued" | "blocked";
  authorization: "continuation" | null;
  siteId: string;
  healthStatus: MerchantOrderV1PrimaryCanaryWatchHealthReport["status"];
  expiresAt: string | null;
  blockers: string[];
  warnings: string[];
  audit: "appended" | null;
};

function parseBoundedInteger(
  value: string,
  name: string,
  minimum: number,
  maximum: number,
) {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name}_must_be_between_${minimum}_and_${maximum}`);
  }
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
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

export function parseV1PrimaryContinuationApprovalOptions(
  args: string[],
): V1PrimaryContinuationApprovalOptions {
  const options: Partial<V1PrimaryContinuationApprovalOptions> = {
    ttlMinutes:
      MERCHANT_ORDER_V1_DEPLOYMENT_APPROVAL_DEFAULT_TTL_MS / 60_000,
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
      if (!/^\d{8}$/.test(value)) {
        throw new Error("site_must_be_exact_8_digit_id");
      }
      options.siteId = value;
    } else if (name === "activated-at") {
      options.activatedAt = parseTimestamp(value);
    } else if (name === "receipt-file") {
      if (value === "-") throw new Error("receipt_file_must_be_a_path");
      options.receiptFile = value;
    } else if (name === "audit-file") {
      if (value === "-") throw new Error("audit_file_must_be_a_path");
      options.auditFile = value;
    } else if (name === "ttl-minutes") {
      options.ttlMinutes = parseBoundedInteger(
        value,
        "ttl_minutes",
        MERCHANT_ORDER_V1_DEPLOYMENT_APPROVAL_MINIMUM_TTL_MS / 60_000,
        MERCHANT_ORDER_V1_DEPLOYMENT_APPROVAL_MAXIMUM_TTL_MS / 60_000,
      );
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
  if (!options.receiptFile) throw new Error("receipt_file_is_required");
  if (!options.auditFile) {
    options.auditFile = `${options.receiptFile}.audit.jsonl`;
  }
  return options as V1PrimaryContinuationApprovalOptions;
}

export function renderV1PrimaryContinuationApprovalReport(
  report: V1PrimaryContinuationApprovalReport,
  format: V1PrimaryContinuationApprovalOptions["format"],
) {
  if (format === "json") return JSON.stringify(report);
  return [
    "[v1-primary-continuation-approval]",
    `status=${report.status}`,
    `site=${report.siteId}`,
    `health=${report.healthStatus}`,
    `authorization=${report.authorization ?? "-"}`,
    `expires-at=${report.expiresAt ?? "-"}`,
    `audit=${report.audit ?? "-"}`,
    `blockers=${report.blockers.join(",") || "-"}`,
    `warnings=${report.warnings.join(",") || "-"}`,
  ].join(" ");
}

export function v1PrimaryContinuationApprovalExitCode(
  status: V1PrimaryContinuationApprovalReport["status"],
) {
  return status === "issued" ? 0 : 2;
}

async function main() {
  const options = parseV1PrimaryContinuationApprovalOptions(
    process.argv.slice(2),
  );
  loadEnvConfig(process.cwd());
  await invalidateMerchantOrderV1DeploymentApprovalReceipt(
    options.receiptFile,
  );

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

  const nowMs = Date.now();
  const healthReport = evaluateMerchantOrderV1PrimaryCanaryWatchHealth({
    state,
    stateUnreadable,
    siteId: options.siteId,
    activatedAt: options.activatedAt,
    policy: {
      maximumStateAgeMinutes: options.maximumStateAgeMinutes,
      maximumPendingDeliveryAgeMinutes:
        options.maximumPendingDeliveryAgeMinutes,
    },
    nowMs,
  });

  if (healthReport.status !== "healthy" || state === null) {
    const report: V1PrimaryContinuationApprovalReport = {
      schemaVersion: 1,
      status: "blocked",
      authorization: null,
      siteId: options.siteId,
      healthStatus: healthReport.status,
      expiresAt: null,
      blockers: [...healthReport.blockers],
      warnings: [...healthReport.warnings],
      audit: null,
    };
    console.log(
      renderV1PrimaryContinuationApprovalReport(report, options.format),
    );
    process.exitCode = v1PrimaryContinuationApprovalExitCode(report.status);
    return;
  }

  const receipt =
    createMerchantOrderV1ContinuationDeploymentApprovalReceipt({
      healthReport,
      stateSource: JSON.stringify(state),
      signingKey:
        process.env.MERCHANT_ORDER_V1_ROLLOUT_APPROVAL_KEY ?? "",
      nowMs,
      ttlMs: options.ttlMinutes * 60_000,
    });
  await persistMerchantOrderV1DeploymentApproval({
    receiptFile: options.receiptFile,
    auditFile: options.auditFile,
    receipt,
  });
  const report: V1PrimaryContinuationApprovalReport = {
    schemaVersion: 1,
    status: "issued",
    authorization: "continuation",
    siteId: options.siteId,
    healthStatus: healthReport.status,
    expiresAt: receipt.expiresAt,
    blockers: [],
    warnings: [],
    audit: "appended",
  };
  console.log(
    renderV1PrimaryContinuationApprovalReport(report, options.format),
  );
  process.exitCode = v1PrimaryContinuationApprovalExitCode(report.status);
}

const invokedFile = process.argv[1]?.replaceAll("\\", "/") ?? "";
if (
  invokedFile.endsWith("/issue-v1-primary-continuation-approval.ts")
) {
  main().catch((error) => {
    console.error(
      `[v1-primary-continuation-approval] failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  });
}
