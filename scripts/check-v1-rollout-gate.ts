import { createReadStream } from "node:fs";
import { resolve } from "node:path";

import { loadEnvConfig } from "@next/env";

import {
  createMerchantOrderV1DeploymentApprovalReceipt,
  invalidateMerchantOrderV1DeploymentApprovalReceipt,
  MERCHANT_ORDER_V1_DEPLOYMENT_APPROVAL_DEFAULT_TTL_MS,
  MERCHANT_ORDER_V1_DEPLOYMENT_APPROVAL_MAXIMUM_TTL_MS,
  MERCHANT_ORDER_V1_DEPLOYMENT_APPROVAL_MINIMUM_TTL_MS,
  persistMerchantOrderV1DeploymentApproval,
} from "../src/lib/merchantOrderV1DeploymentApproval.server";
import { evaluateMerchantV1RolloutGate } from "../src/lib/merchantV1RolloutGate";

export type V1RolloutGateOptions = {
  file: string;
  receiptFile: string | null;
  auditFile: string | null;
  ttlMinutes: number;
};

const MAX_MANIFEST_FILE_BYTES = 1024 * 1024;

export function parseV1RolloutGateOptions(
  args: string[],
): V1RolloutGateOptions {
  let file = "";
  let receiptFile: string | null = null;
  let auditFile: string | null = null;
  let ttlMinutes =
    MERCHANT_ORDER_V1_DEPLOYMENT_APPROVAL_DEFAULT_TTL_MS / 60_000;
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
      file = value;
      continue;
    }
    if (name === "receipt-file") {
      if (value === "-") throw new Error("receipt_file_must_be_a_path");
      receiptFile = value;
      continue;
    }
    if (name === "audit-file") {
      if (value === "-") throw new Error("audit_file_must_be_a_path");
      auditFile = value;
      continue;
    }
    if (name === "ttl-minutes") {
      if (!/^[1-9]\d*$/.test(value)) {
        throw new Error("ttl_minutes_must_be_an_integer");
      }
      ttlMinutes = Number(value);
      if (
        !Number.isSafeInteger(ttlMinutes) ||
        ttlMinutes <
          MERCHANT_ORDER_V1_DEPLOYMENT_APPROVAL_MINIMUM_TTL_MS / 60_000 ||
        ttlMinutes >
          MERCHANT_ORDER_V1_DEPLOYMENT_APPROVAL_MAXIMUM_TTL_MS / 60_000
      ) {
        throw new Error("ttl_minutes_out_of_range");
      }
      continue;
    }
    throw new Error(`unknown_argument:${name}`);
  }
  if (!file) throw new Error("file_is_required");
  if (seen.has("ttl-minutes") && receiptFile === null) {
    throw new Error("ttl_minutes_requires_receipt_file");
  }
  if (auditFile !== null && receiptFile === null) {
    throw new Error("audit_file_requires_receipt_file");
  }
  if (receiptFile !== null && auditFile === null) {
    auditFile = `${receiptFile}.audit.jsonl`;
  }
  return { file, receiptFile, auditFile, ttlMinutes };
}

export function parseV1RolloutGateManifestSource(source: string) {
  if (!source.trim()) throw new Error("manifest_is_empty");
  const normalizedSource =
    source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  return {
    manifest: JSON.parse(normalizedSource) as unknown,
    source: normalizedSource,
  };
}

async function loadJson(file: string) {
  const stream =
    file === "-"
      ? process.stdin
      : createReadStream(resolve(process.cwd(), file), { encoding: "utf8" });
  let source = "";
  let byteLength = 0;
  for await (const chunk of stream) {
    const text = String(chunk);
    byteLength += Buffer.byteLength(text, "utf8");
    if (byteLength > MAX_MANIFEST_FILE_BYTES) {
      throw new Error("manifest_is_too_large");
    }
    source += text;
  }
  return parseV1RolloutGateManifestSource(source);
}

async function main() {
  const options = parseV1RolloutGateOptions(process.argv.slice(2));
  loadEnvConfig(process.cwd());
  if (options.receiptFile !== null) {
    await invalidateMerchantOrderV1DeploymentApprovalReceipt(
      options.receiptFile,
    );
  }
  const loaded = await loadJson(options.file);
  const nowMs = Date.now();
  const report = evaluateMerchantV1RolloutGate({
    manifest: loaded.manifest,
    nowMs,
  });
  console.log(
    `[v1-rollout-gate] status=${report.status} site=${report.siteId ?? "-"} domain=${report.domain ?? "-"} transition=${report.currentReadMode ?? "-"}->${report.targetReadMode ?? "-"}`,
  );
  console.log(
    `[v1-rollout-gate] required-migrations=${report.requiredMigrations.join(",")}`,
  );
  report.blockers.forEach((blocker) => {
    console.error(`[v1-rollout-gate] blocker=${blocker}`);
  });
  report.warnings.forEach((warning) => {
    console.warn(`[v1-rollout-gate] warning=${warning}`);
  });
  if (report.status === "blocked") {
    process.exitCode = 2;
    return;
  }
  if (options.receiptFile !== null) {
    const receipt = createMerchantOrderV1DeploymentApprovalReceipt({
      gateReport: report,
      manifestSource: loaded.source,
      signingKey:
        process.env.MERCHANT_ORDER_V1_ROLLOUT_APPROVAL_KEY ?? "",
      nowMs,
      ttlMs: options.ttlMinutes * 60_000,
    });
    await persistMerchantOrderV1DeploymentApproval({
      receiptFile: options.receiptFile,
      auditFile: options.auditFile!,
      receipt,
    });
    console.log(
      `[v1-rollout-gate] approval=issued type=activation site=${receipt.siteId} expires-at=${receipt.expiresAt} audit=appended`,
    );
  }
}

const invokedFile = process.argv[1]?.replaceAll("\\", "/") ?? "";
if (invokedFile.endsWith("/check-v1-rollout-gate.ts")) {
  main().catch((error) => {
    console.error(
      `[v1-rollout-gate] failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  });
}
