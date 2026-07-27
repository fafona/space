import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { MerchantOrderV1PrimaryCanaryWatchHealthReport } from "@/lib/merchantOrderV1PrimaryCanaryWatchHealth";
import type { MerchantV1RolloutGateReport } from "@/lib/merchantV1RolloutGate";

export const MERCHANT_ORDER_V1_DEPLOYMENT_APPROVAL_SCHEMA_VERSION = 2;
export const MERCHANT_ORDER_V1_DEPLOYMENT_APPROVAL_DEFAULT_TTL_MS =
  60 * 60 * 1000;
export const MERCHANT_ORDER_V1_DEPLOYMENT_APPROVAL_MINIMUM_TTL_MS =
  5 * 60 * 1000;
export const MERCHANT_ORDER_V1_DEPLOYMENT_APPROVAL_MAXIMUM_TTL_MS =
  24 * 60 * 60 * 1000;

export type MerchantOrderV1DeploymentApprovalAuthorization =
  | "order_v1_primary_activation"
  | "order_v1_primary_continuation";

export type MerchantOrderV1DeploymentApprovalReceipt = {
  schemaVersion: 2;
  authorization: MerchantOrderV1DeploymentApprovalAuthorization;
  siteId: string;
  activatedAt: string | null;
  issuedAt: string;
  expiresAt: string;
  evaluatedAt: string;
  evidenceSha256: string;
  nonce: string;
  signature: string;
};

export type MerchantOrderV1DeploymentApprovalAuditRecord = {
  schemaVersion: 1;
  event: "merchant_order_v1_deployment_approval_issued";
  recordedAt: string;
  receipt: MerchantOrderV1DeploymentApprovalReceipt;
};

export type MerchantOrderV1DeploymentApprovalBlocker =
  | "primary_approval_scope_invalid"
  | "primary_approval_key_missing_or_weak"
  | "primary_approval_receipt_file_not_configured"
  | "primary_approval_receipt_missing"
  | "primary_approval_receipt_unreadable"
  | "primary_approval_receipt_is_symlink"
  | "primary_approval_receipt_too_large"
  | "primary_approval_receipt_invalid"
  | "primary_approval_signature_invalid"
  | "primary_approval_scope_mismatch"
  | "primary_approval_not_yet_valid"
  | "primary_approval_expired"
  | "primary_approval_lifetime_invalid";

export type MerchantOrderV1DeploymentApprovalReport = {
  status: "not_required" | "ready" | "blocked";
  authorization: "activation" | "continuation" | null;
  siteId: string | null;
  activatedAt: string | null;
  evaluatedAt: string | null;
  expiresAt: string | null;
  blockers: MerchantOrderV1DeploymentApprovalBlocker[];
};

export type MerchantOrderV1DeploymentApprovalLoadResult = {
  receipt: unknown | null;
  blocker: MerchantOrderV1DeploymentApprovalBlocker | null;
};

const SITE_ID_PATTERN = /^\d{8}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_APPROVAL_ISSUANCE_DELAY_MS = 5 * 60 * 1000;
const MAX_RECEIPT_FILE_BYTES = 16 * 1024;
const MAX_EVIDENCE_SOURCE_BYTES = 1024 * 1024;
const MAX_AUDIT_FILE_BYTES = 10 * 1024 * 1024;
const MINIMUM_SIGNING_KEY_BYTES = 32;
const MAXIMUM_SIGNING_KEY_BYTES = 4096;
const RECEIPT_KEYS = new Set([
  "schemaVersion",
  "authorization",
  "siteId",
  "activatedAt",
  "issuedAt",
  "expiresAt",
  "evaluatedAt",
  "evidenceSha256",
  "nonce",
  "signature",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pushUnique<T>(items: T[], item: T) {
  if (!items.includes(item)) items.push(item);
}

function isCanonicalTimestamp(value: unknown) {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString() === value
  );
}

function signingKeyIsStrong(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const byteLength = Buffer.byteLength(value, "utf8");
  return (
    byteLength >= MINIMUM_SIGNING_KEY_BYTES &&
    byteLength <= MAXIMUM_SIGNING_KEY_BYTES
  );
}

function approvalKind(
  authorization: MerchantOrderV1DeploymentApprovalAuthorization,
) {
  return authorization === "order_v1_primary_activation"
    ? ("activation" as const)
    : ("continuation" as const);
}

function receiptPayload(
  receipt: Omit<MerchantOrderV1DeploymentApprovalReceipt, "signature">,
) {
  return JSON.stringify({
    schemaVersion: receipt.schemaVersion,
    authorization: receipt.authorization,
    siteId: receipt.siteId,
    activatedAt: receipt.activatedAt,
    issuedAt: receipt.issuedAt,
    expiresAt: receipt.expiresAt,
    evaluatedAt: receipt.evaluatedAt,
    evidenceSha256: receipt.evidenceSha256,
    nonce: receipt.nonce,
  });
}

function signReceiptPayload(payload: string, signingKey: string) {
  return createHmac("sha256", signingKey)
    .update(payload, "utf8")
    .digest("base64url");
}

function signaturesMatch(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function normalizeReceipt(
  value: unknown,
): MerchantOrderV1DeploymentApprovalReceipt | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (
    keys.length !== RECEIPT_KEYS.size ||
    keys.some((key) => !RECEIPT_KEYS.has(key))
  ) {
    return null;
  }
  const authorization =
    value.authorization === "order_v1_primary_activation" ||
    value.authorization === "order_v1_primary_continuation"
      ? value.authorization
      : null;
  const activatedAtValid =
    authorization === "order_v1_primary_activation"
      ? value.activatedAt === null
      : authorization === "order_v1_primary_continuation" &&
        isCanonicalTimestamp(value.activatedAt);
  if (
    value.schemaVersion !==
      MERCHANT_ORDER_V1_DEPLOYMENT_APPROVAL_SCHEMA_VERSION ||
    authorization === null ||
    !activatedAtValid ||
    typeof value.siteId !== "string" ||
    !SITE_ID_PATTERN.test(value.siteId) ||
    !isCanonicalTimestamp(value.issuedAt) ||
    !isCanonicalTimestamp(value.expiresAt) ||
    !isCanonicalTimestamp(value.evaluatedAt) ||
    typeof value.evidenceSha256 !== "string" ||
    !SHA256_PATTERN.test(value.evidenceSha256) ||
    typeof value.nonce !== "string" ||
    !UUID_PATTERN.test(value.nonce) ||
    typeof value.signature !== "string" ||
    !SIGNATURE_PATTERN.test(value.signature)
  ) {
    return null;
  }
  return value as MerchantOrderV1DeploymentApprovalReceipt;
}

function isNotFound(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

async function pathIsSymlink(path: string) {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

function validateReceiptCreationInput(input: {
  siteId: string;
  activatedAt: string | null;
  evaluatedAt: string;
  evidenceSource: string;
  signingKey: string;
  nowMs: number;
  ttlMs: number;
  nonce: string;
}) {
  if (!Number.isFinite(input.nowMs)) {
    throw new Error("primary_approval_now_must_be_finite");
  }
  if (
    !Number.isSafeInteger(input.ttlMs) ||
    input.ttlMs < MERCHANT_ORDER_V1_DEPLOYMENT_APPROVAL_MINIMUM_TTL_MS ||
    input.ttlMs > MERCHANT_ORDER_V1_DEPLOYMENT_APPROVAL_MAXIMUM_TTL_MS
  ) {
    throw new Error("primary_approval_ttl_invalid");
  }
  if (!signingKeyIsStrong(input.signingKey)) {
    throw new Error("primary_approval_key_missing_or_weak");
  }
  if (!SITE_ID_PATTERN.test(input.siteId)) {
    throw new Error("primary_approval_scope_invalid");
  }
  if (
    typeof input.evidenceSource !== "string" ||
    !input.evidenceSource.trim()
  ) {
    throw new Error("primary_approval_evidence_source_missing");
  }
  if (
    Buffer.byteLength(input.evidenceSource, "utf8") >
    MAX_EVIDENCE_SOURCE_BYTES
  ) {
    throw new Error("primary_approval_evidence_source_too_large");
  }
  if (!UUID_PATTERN.test(input.nonce)) {
    throw new Error("primary_approval_nonce_invalid");
  }
  if (!isCanonicalTimestamp(input.evaluatedAt)) {
    throw new Error("primary_approval_evaluation_invalid");
  }
  const evaluatedAtMs = Date.parse(input.evaluatedAt);
  if (
    evaluatedAtMs > input.nowMs + MAX_CLOCK_SKEW_MS ||
    input.nowMs - evaluatedAtMs > MAX_APPROVAL_ISSUANCE_DELAY_MS
  ) {
    throw new Error("primary_approval_evaluation_not_current");
  }
  if (
    input.activatedAt !== null &&
    (!isCanonicalTimestamp(input.activatedAt) ||
      Date.parse(input.activatedAt) > input.nowMs + MAX_CLOCK_SKEW_MS)
  ) {
    throw new Error("primary_approval_activation_invalid");
  }
}

function createSignedReceipt(input: {
  authorization: MerchantOrderV1DeploymentApprovalAuthorization;
  siteId: string;
  activatedAt: string | null;
  evaluatedAt: string;
  evidenceSource: string;
  signingKey: string;
  nowMs: number;
  ttlMs: number;
  nonce: string;
}): MerchantOrderV1DeploymentApprovalReceipt {
  validateReceiptCreationInput(input);
  const unsignedReceipt: Omit<
    MerchantOrderV1DeploymentApprovalReceipt,
    "signature"
  > = {
    schemaVersion: MERCHANT_ORDER_V1_DEPLOYMENT_APPROVAL_SCHEMA_VERSION,
    authorization: input.authorization,
    siteId: input.siteId,
    activatedAt: input.activatedAt,
    issuedAt: new Date(input.nowMs).toISOString(),
    expiresAt: new Date(input.nowMs + input.ttlMs).toISOString(),
    evaluatedAt: input.evaluatedAt,
    evidenceSha256: createHash("sha256")
      .update(input.evidenceSource, "utf8")
      .digest("hex"),
    nonce: input.nonce,
  };
  return {
    ...unsignedReceipt,
    signature: signReceiptPayload(
      receiptPayload(unsignedReceipt),
      input.signingKey,
    ),
  };
}

export function createMerchantOrderV1DeploymentApprovalReceipt(input: {
  gateReport: MerchantV1RolloutGateReport;
  manifestSource: string;
  signingKey: string;
  nowMs?: number;
  ttlMs?: number;
  nonce?: string;
}): MerchantOrderV1DeploymentApprovalReceipt {
  const nowMs = input.nowMs ?? Date.now();
  if (
    input.gateReport.status !== "ready" ||
    input.gateReport.domain !== "orders" ||
    input.gateReport.targetReadMode !== "primary" ||
    input.gateReport.siteId === null
  ) {
    throw new Error("primary_approval_gate_not_ready");
  }
  try {
    return createSignedReceipt({
      authorization: "order_v1_primary_activation",
      siteId: input.gateReport.siteId,
      activatedAt: null,
      evaluatedAt: input.gateReport.evaluatedAt,
      evidenceSource: input.manifestSource,
      signingKey: input.signingKey,
      nowMs,
      ttlMs:
        input.ttlMs ??
        MERCHANT_ORDER_V1_DEPLOYMENT_APPROVAL_DEFAULT_TTL_MS,
      nonce: input.nonce ?? randomUUID(),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "primary_approval_evaluation_not_current"
    ) {
      throw new Error("primary_approval_gate_evaluation_not_current");
    }
    throw error;
  }
}

export function createMerchantOrderV1ContinuationDeploymentApprovalReceipt(
  input: {
    healthReport: MerchantOrderV1PrimaryCanaryWatchHealthReport;
    stateSource: string;
    signingKey: string;
    nowMs?: number;
    ttlMs?: number;
    nonce?: string;
  },
): MerchantOrderV1DeploymentApprovalReceipt {
  const nowMs = input.nowMs ?? Date.now();
  if (
    input.healthReport.status !== "healthy" ||
    input.healthReport.canaryStatus !== "healthy" ||
    input.healthReport.blockers.length !== 0 ||
    input.healthReport.warnings.length !== 0 ||
    input.healthReport.stateUpdatedAt === null ||
    input.healthReport.evaluatedAt === null
  ) {
    throw new Error("primary_continuation_health_not_ready");
  }
  try {
    return createSignedReceipt({
      authorization: "order_v1_primary_continuation",
      siteId: input.healthReport.siteId,
      activatedAt: input.healthReport.activatedAt,
      evaluatedAt: input.healthReport.checkedAt,
      evidenceSource: input.stateSource,
      signingKey: input.signingKey,
      nowMs,
      ttlMs:
        input.ttlMs ??
        MERCHANT_ORDER_V1_DEPLOYMENT_APPROVAL_DEFAULT_TTL_MS,
      nonce: input.nonce ?? randomUUID(),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "primary_approval_evaluation_not_current"
    ) {
      throw new Error("primary_continuation_health_not_current");
    }
    throw error;
  }
}

export function evaluateMerchantOrderV1DeploymentApproval(input: {
  readMode: string | null;
  readSiteIds: string[];
  receipt?: unknown;
  signingKey?: string;
  loadBlocker?: MerchantOrderV1DeploymentApprovalBlocker | null;
  nowMs?: number;
}): MerchantOrderV1DeploymentApprovalReport {
  if (input.readMode !== "primary") {
    return {
      status: "not_required",
      authorization: null,
      siteId: null,
      activatedAt: null,
      evaluatedAt: null,
      expiresAt: null,
      blockers: [],
    };
  }

  const blockers: MerchantOrderV1DeploymentApprovalBlocker[] = [];
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) {
    throw new Error("primary_approval_now_must_be_finite");
  }
  const expectedSiteId =
    input.readSiteIds.length === 1 &&
    SITE_ID_PATTERN.test(input.readSiteIds[0] ?? "")
      ? input.readSiteIds[0]
      : null;
  if (expectedSiteId === null) {
    pushUnique(blockers, "primary_approval_scope_invalid");
  }
  if (!signingKeyIsStrong(input.signingKey)) {
    pushUnique(blockers, "primary_approval_key_missing_or_weak");
  }
  if (input.loadBlocker) {
    pushUnique(blockers, input.loadBlocker);
  } else if (input.receipt === undefined || input.receipt === null) {
    pushUnique(blockers, "primary_approval_receipt_missing");
  }

  const receipt = normalizeReceipt(input.receipt);
  if (
    !input.loadBlocker &&
    input.receipt !== undefined &&
    input.receipt !== null &&
    receipt === null
  ) {
    pushUnique(blockers, "primary_approval_receipt_invalid");
  }
  if (receipt !== null) {
    if (expectedSiteId !== null && receipt.siteId !== expectedSiteId) {
      pushUnique(blockers, "primary_approval_scope_mismatch");
    }
    const issuedAtMs = Date.parse(receipt.issuedAt);
    const expiresAtMs = Date.parse(receipt.expiresAt);
    const evaluatedAtMs = Date.parse(receipt.evaluatedAt);
    const activatedAtMs =
      receipt.activatedAt === null
        ? null
        : Date.parse(receipt.activatedAt);
    if (
      expiresAtMs <= issuedAtMs ||
      expiresAtMs - issuedAtMs <
        MERCHANT_ORDER_V1_DEPLOYMENT_APPROVAL_MINIMUM_TTL_MS ||
      expiresAtMs - issuedAtMs >
        MERCHANT_ORDER_V1_DEPLOYMENT_APPROVAL_MAXIMUM_TTL_MS ||
      evaluatedAtMs > issuedAtMs + MAX_CLOCK_SKEW_MS ||
      issuedAtMs - evaluatedAtMs > MAX_APPROVAL_ISSUANCE_DELAY_MS ||
      (activatedAtMs !== null &&
        activatedAtMs > issuedAtMs + MAX_CLOCK_SKEW_MS)
    ) {
      pushUnique(blockers, "primary_approval_lifetime_invalid");
    }
    if (issuedAtMs > nowMs + MAX_CLOCK_SKEW_MS) {
      pushUnique(blockers, "primary_approval_not_yet_valid");
    }
    if (expiresAtMs <= nowMs) {
      pushUnique(blockers, "primary_approval_expired");
    }
    if (signingKeyIsStrong(input.signingKey)) {
      const { signature, ...unsignedReceipt } = receipt;
      const expectedSignature = signReceiptPayload(
        receiptPayload(unsignedReceipt),
        input.signingKey,
      );
      if (!signaturesMatch(signature, expectedSignature)) {
        pushUnique(blockers, "primary_approval_signature_invalid");
      }
    }
  }

  return {
    status: blockers.length === 0 ? "ready" : "blocked",
    authorization: receipt ? approvalKind(receipt.authorization) : null,
    siteId: receipt?.siteId ?? expectedSiteId,
    activatedAt: receipt?.activatedAt ?? null,
    evaluatedAt: receipt?.evaluatedAt ?? null,
    expiresAt: receipt?.expiresAt ?? null,
    blockers,
  };
}

export async function readMerchantOrderV1DeploymentApprovalReceipt(
  receiptFile: string,
): Promise<MerchantOrderV1DeploymentApprovalLoadResult> {
  const path = resolve(process.cwd(), receiptFile);
  try {
    if (await pathIsSymlink(path)) {
      return {
        receipt: null,
        blocker: "primary_approval_receipt_is_symlink",
      };
    }
    const info = await stat(path);
    if (!info.isFile()) {
      return {
        receipt: null,
        blocker: "primary_approval_receipt_unreadable",
      };
    }
    if (info.size > MAX_RECEIPT_FILE_BYTES) {
      return {
        receipt: null,
        blocker: "primary_approval_receipt_too_large",
      };
    }
    const raw = await readFile(path, "utf8");
    try {
      return {
        receipt: JSON.parse(raw) as unknown,
        blocker: null,
      };
    } catch {
      return {
        receipt: null,
        blocker: "primary_approval_receipt_invalid",
      };
    }
  } catch (error) {
    return {
      receipt: null,
      blocker: isNotFound(error)
        ? "primary_approval_receipt_missing"
        : "primary_approval_receipt_unreadable",
    };
  }
}

export async function invalidateMerchantOrderV1DeploymentApprovalReceipt(
  receiptFile: string,
) {
  const path = resolve(process.cwd(), receiptFile);
  if (await pathIsSymlink(path)) {
    throw new Error("primary_approval_receipt_is_symlink");
  }
  try {
    const info = await stat(path);
    if (!info.isFile()) {
      throw new Error("primary_approval_receipt_is_not_a_file");
    }
    await unlink(path);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

export async function writeMerchantOrderV1DeploymentApprovalReceipt(
  receiptFile: string,
  receipt: MerchantOrderV1DeploymentApprovalReceipt,
) {
  const path = resolve(process.cwd(), receiptFile);
  await mkdir(dirname(path), { recursive: true });
  if (await pathIsSymlink(path)) {
    throw new Error("primary_approval_receipt_is_symlink");
  }
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(receipt, null, 2)}\n`,
      {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      },
    );
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function appendMerchantOrderV1DeploymentApprovalAuditRecord(
  auditFile: string,
  receipt: MerchantOrderV1DeploymentApprovalReceipt,
) {
  const path = resolve(process.cwd(), auditFile);
  const record: MerchantOrderV1DeploymentApprovalAuditRecord = {
    schemaVersion: 1,
    event: "merchant_order_v1_deployment_approval_issued",
    recordedAt: receipt.issuedAt,
    receipt,
  };
  const line = `${JSON.stringify(record)}\n`;
  const lineBytes = Buffer.byteLength(line, "utf8");
  await mkdir(dirname(path), { recursive: true });
  if (await pathIsSymlink(path)) {
    throw new Error("primary_approval_audit_file_is_symlink");
  }
  try {
    const info = await stat(path);
    if (!info.isFile()) {
      throw new Error("primary_approval_audit_path_is_not_a_file");
    }
    if (info.size + lineBytes > MAX_AUDIT_FILE_BYTES) {
      throw new Error("primary_approval_audit_file_is_too_large");
    }
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  await writeFile(path, line, {
    encoding: "utf8",
    flag: "a",
    mode: 0o600,
  });
}

export async function persistMerchantOrderV1DeploymentApproval(input: {
  receiptFile: string;
  auditFile: string;
  receipt: MerchantOrderV1DeploymentApprovalReceipt;
}) {
  if (
    resolve(process.cwd(), input.receiptFile) ===
    resolve(process.cwd(), input.auditFile)
  ) {
    throw new Error("primary_approval_receipt_and_audit_paths_must_differ");
  }
  await writeMerchantOrderV1DeploymentApprovalReceipt(
    input.receiptFile,
    input.receipt,
  );
  try {
    await appendMerchantOrderV1DeploymentApprovalAuditRecord(
      input.auditFile,
      input.receipt,
    );
  } catch (error) {
    await invalidateMerchantOrderV1DeploymentApprovalReceipt(
      input.receiptFile,
    ).catch(() => undefined);
    throw error;
  }
}
