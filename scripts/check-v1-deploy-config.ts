import { loadEnvConfig } from "@next/env";

import {
  evaluateMerchantOrderV1DeploymentApproval,
  readMerchantOrderV1DeploymentApprovalReceipt,
  type MerchantOrderV1DeploymentApprovalReport,
} from "../src/lib/merchantOrderV1DeploymentApproval.server";
import {
  evaluateMerchantOrderV1DeploymentGuard,
  type MerchantOrderV1DeploymentGuardReport,
} from "../src/lib/merchantOrderV1DeploymentGuard";

export type V1DeployConfigOptions = {
  format: "text" | "json";
};

export type V1DeployConfigReport = {
  schemaVersion: 1;
  status: "ready" | "blocked";
  config: MerchantOrderV1DeploymentGuardReport;
  approval: MerchantOrderV1DeploymentApprovalReport;
};

export function parseV1DeployConfigOptions(args: string[]): V1DeployConfigOptions {
  let format: V1DeployConfigOptions["format"] = "text";
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
    if (name !== "format") throw new Error(`unknown_argument:${name}`);
    if (value !== "text" && value !== "json") {
      throw new Error("format_must_be_text_or_json");
    }
    format = value;
  }
  return { format };
}

export function renderV1DeployConfigReport(
  report: V1DeployConfigReport,
  format: V1DeployConfigOptions["format"],
) {
  if (format === "json") return JSON.stringify(report);
  return [
    "[v1-deploy-config]",
    `status=${report.status}`,
    `read-mode=${report.config.readMode ?? "invalid"}`,
    `sites=${report.config.readSiteIds.join(",") || "-"}`,
    `dual-write=${report.config.dualWriteMode ?? "invalid"}`,
    `circuit-breaker=${
      report.config.circuitBreakerEnabled === null
        ? "invalid"
        : String(report.config.circuitBreakerEnabled)
    }`,
    `approval=${report.approval.status}`,
    `approval-type=${report.approval.authorization ?? "-"}`,
    `approval-expires=${report.approval.expiresAt ?? "-"}`,
    `blockers=${report.config.blockers.join(",") || "-"}`,
    `approval-blockers=${report.approval.blockers.join(",") || "-"}`,
    `warnings=${report.config.warnings.join(",") || "-"}`,
  ].join(" ");
}

export function v1DeployConfigExitCode(
  status: V1DeployConfigReport["status"],
) {
  return status === "blocked" ? 2 : 0;
}

export function combineV1DeployConfigReport(input: {
  config: MerchantOrderV1DeploymentGuardReport;
  approval: MerchantOrderV1DeploymentApprovalReport;
}): V1DeployConfigReport {
  return {
    schemaVersion: 1,
    status:
      input.config.status === "blocked" ||
      input.approval.status === "blocked"
        ? "blocked"
        : "ready",
    config: input.config,
    approval: input.approval,
  };
}

async function main() {
  const options = parseV1DeployConfigOptions(process.argv.slice(2));
  loadEnvConfig(process.cwd());
  const config = evaluateMerchantOrderV1DeploymentGuard();
  const receiptFile =
    process.env.MERCHANT_ORDER_V1_ROLLOUT_APPROVAL_RECEIPT_FILE?.trim() ??
    "";
  const loadedReceipt =
    config.readMode === "primary" && receiptFile
      ? await readMerchantOrderV1DeploymentApprovalReceipt(receiptFile)
      : {
          receipt: null,
          blocker:
            config.readMode === "primary"
              ? ("primary_approval_receipt_file_not_configured" as const)
              : null,
        };
  const approval = evaluateMerchantOrderV1DeploymentApproval({
    readMode: config.readMode,
    readSiteIds: config.readSiteIds,
    receipt: loadedReceipt.receipt,
    signingKey: process.env.MERCHANT_ORDER_V1_ROLLOUT_APPROVAL_KEY,
    loadBlocker: loadedReceipt.blocker,
  });
  const report = combineV1DeployConfigReport({ config, approval });
  console.log(renderV1DeployConfigReport(report, options.format));
  process.exitCode = v1DeployConfigExitCode(report.status);
}

const invokedFile = process.argv[1]?.replaceAll("\\", "/") ?? "";
if (invokedFile.endsWith("/check-v1-deploy-config.ts")) {
  main().catch((error) => {
    console.error(
      `[v1-deploy-config] failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  });
}
