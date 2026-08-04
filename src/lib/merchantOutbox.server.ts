import { createHash } from "node:crypto";

export const MERCHANT_OUTBOX_EVENT_TYPES = [
  "merchant.notification.deliver",
  "google.reviews.sync",
  "asset.convert",
  "site.publish.follow_up",
  "backup.create",
  "webhook.deliver",
  "enterprise.workflow_automation.process",
] as const;

export type MerchantOutboxEventType = (typeof MERCHANT_OUTBOX_EVENT_TYPES)[number];

export type MerchantOutboxEventInput = {
  merchantId: string;
  eventType: MerchantOutboxEventType;
  aggregateType: string;
  aggregateId: string;
  operationId: string;
  payload?: Record<string, unknown>;
  availableAt?: string;
  maxAttempts?: number;
  priority?: number;
  correlationId?: string;
};

export type MerchantOutboxEventMutation = {
  merchant_id: string;
  event_key: string;
  event_type: MerchantOutboxEventType;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  available_at: string;
  max_attempts: number;
  priority: number;
  correlation_id: string;
};

export type MerchantOutboxClaimedEvent = {
  id: string;
  merchantId: string;
  eventKey: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  attempts: number;
  totalAttempts: number;
  maxAttempts: number;
  correlationId: string;
  leaseExpiresAt: string;
  createdAt: string;
};

export class MerchantOutboxValidationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "MerchantOutboxValidationError";
    this.code = code;
  }
}

const MAX_PAYLOAD_BYTES = 128 * 1024;
const MAX_PAYLOAD_DEPTH = 8;
const MAX_PAYLOAD_COLLECTION_LENGTH = 1000;
const MAX_PAYLOAD_STRING_LENGTH = 16 * 1024;
const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "apikey",
  "authorization",
  "clientsecret",
  "cookie",
  "credential",
  "credentials",
  "password",
  "privatekey",
  "refreshtoken",
  "secret",
  "servicekey",
  "setcookie",
  "token",
  "accesstoken",
]);
const FORBIDDEN_PAYLOAD_KEY_PARTS = [
  "apikey",
  "authorization",
  "cookie",
  "credential",
  "password",
  "privatekey",
  "secret",
  "servicekey",
  "token",
];

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function normalizePayloadKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function assertSafePayloadValue(value: unknown, depth: number, seen: Set<object>) {
  if (depth > MAX_PAYLOAD_DEPTH) {
    throw new MerchantOutboxValidationError("outbox_payload_too_deep");
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (typeof value === "string") {
    if (value.length > MAX_PAYLOAD_STRING_LENGTH) {
      throw new MerchantOutboxValidationError("outbox_payload_string_too_long");
    }
    return;
  }
  if (typeof value !== "object") {
    throw new MerchantOutboxValidationError("outbox_payload_not_json");
  }
  if (seen.has(value)) {
    throw new MerchantOutboxValidationError("outbox_payload_circular");
  }
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > MAX_PAYLOAD_COLLECTION_LENGTH) {
      throw new MerchantOutboxValidationError("outbox_payload_array_too_large");
    }
    value.forEach((entry) => assertSafePayloadValue(entry, depth + 1, seen));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new MerchantOutboxValidationError("outbox_payload_not_plain_json");
    }
    const entries = Object.entries(value);
    if (entries.length > MAX_PAYLOAD_COLLECTION_LENGTH) {
      throw new MerchantOutboxValidationError("outbox_payload_object_too_large");
    }
    for (const [key, entry] of entries) {
      const normalizedKey = normalizePayloadKey(key);
      if (
        FORBIDDEN_PAYLOAD_KEYS.has(normalizedKey) ||
        FORBIDDEN_PAYLOAD_KEY_PARTS.some((part) => normalizedKey.includes(part))
      ) {
        throw new MerchantOutboxValidationError("outbox_payload_contains_secret");
      }
      assertSafePayloadValue(entry, depth + 1, seen);
    }
  }
  seen.delete(value);
}

function normalizePayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MerchantOutboxValidationError("outbox_payload_must_be_object");
  }
  assertSafePayloadValue(value, 0, new Set());
  let serialized = "";
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new MerchantOutboxValidationError("outbox_payload_not_json");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_PAYLOAD_BYTES) {
    throw new MerchantOutboxValidationError("outbox_payload_too_large");
  }
  return JSON.parse(serialized) as Record<string, unknown>;
}

export function normalizeMerchantOutboxResult(value: unknown) {
  const result = normalizePayload(value ?? {});
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > 64 * 1024) {
    throw new MerchantOutboxValidationError("outbox_result_too_large");
  }
  return result;
}

function normalizeAvailableAt(value: unknown) {
  const text = trimText(value);
  if (!text) return new Date().toISOString();
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp) || timestamp > Date.now() + 366 * 24 * 60 * 60 * 1000) {
    throw new MerchantOutboxValidationError("invalid_outbox_available_at");
  }
  return new Date(timestamp).toISOString();
}

function requirePattern(
  value: unknown,
  code: string,
  pattern: RegExp,
  maximumLength: number,
) {
  const text = trimText(value);
  if (!text || text.length > maximumLength || !pattern.test(text)) {
    throw new MerchantOutboxValidationError(code);
  }
  return text;
}

export function isMerchantOutboxEventType(value: unknown): value is MerchantOutboxEventType {
  return MERCHANT_OUTBOX_EVENT_TYPES.includes(value as MerchantOutboxEventType);
}

export function buildMerchantOutboxEventMutation(
  input: MerchantOutboxEventInput,
): MerchantOutboxEventMutation {
  const merchantId = requirePattern(input.merchantId, "invalid_outbox_merchant_id", /^\d{8}$/, 8);
  if (!isMerchantOutboxEventType(input.eventType)) {
    throw new MerchantOutboxValidationError("invalid_outbox_event_type");
  }
  const aggregateType = requirePattern(
    input.aggregateType,
    "invalid_outbox_aggregate_type",
    /^[a-z][a-z0-9_-]*$/,
    80,
  );
  const aggregateId = requirePattern(
    input.aggregateId,
    "invalid_outbox_aggregate_id",
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/,
    180,
  );
  const operationId = requirePattern(
    input.operationId,
    "invalid_outbox_operation_id",
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/,
    180,
  );
  const correlationId = trimText(input.correlationId);
  if (
    correlationId &&
    (correlationId.length > 120 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(correlationId))
  ) {
    throw new MerchantOutboxValidationError("invalid_outbox_correlation_id");
  }
  const fingerprint = createHash("sha256")
    .update([merchantId, input.eventType, aggregateType, aggregateId, operationId].join("\n"))
    .digest("hex")
    .slice(0, 40);
  return {
    merchant_id: merchantId,
    event_key: `${input.eventType}:${fingerprint}`,
    event_type: input.eventType,
    aggregate_type: aggregateType,
    aggregate_id: aggregateId,
    payload: normalizePayload(input.payload ?? {}),
    available_at: normalizeAvailableAt(input.availableAt),
    max_attempts: normalizeInteger(input.maxAttempts, 8, 1, 50),
    priority: normalizeInteger(input.priority, 100, 0, 1000),
    correlation_id: correlationId,
  };
}

export function normalizeMerchantOutboxClaimedEvent(row: unknown): MerchantOutboxClaimedEvent {
  const record = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
  const id = requirePattern(
    record.id,
    "invalid_claimed_outbox_id",
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    36,
  );
  const merchantId = requirePattern(
    record.merchant_id,
    "invalid_claimed_outbox_merchant_id",
    /^\d{8}$/,
    8,
  );
  const eventKey = requirePattern(
    record.event_key,
    "invalid_claimed_outbox_event_key",
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/,
    180,
  );
  const eventType = requirePattern(
    record.event_type,
    "invalid_claimed_outbox_event_type",
    /^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9_-]*)+$/,
    80,
  );
  const aggregateType = requirePattern(
    record.aggregate_type,
    "invalid_claimed_outbox_aggregate_type",
    /^[a-z][a-z0-9_-]*$/,
    80,
  );
  const aggregateId = requirePattern(
    record.aggregate_id,
    "invalid_claimed_outbox_aggregate_id",
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/,
    180,
  );
  const leaseExpiresAt = normalizeAvailableAt(record.lease_expires_at);
  const createdAt = normalizeAvailableAt(record.created_at);
  const status = trimText(record.status);
  if (status !== "processing") {
    throw new MerchantOutboxValidationError("claimed_outbox_not_processing");
  }
  return {
    id,
    merchantId,
    eventKey,
    eventType,
    aggregateType,
    aggregateId,
    payload: normalizePayload(record.payload ?? {}),
    attempts: normalizeInteger(record.attempts, 0, 0, 50),
    totalAttempts: normalizeInteger(record.total_attempts, 0, 0, Number.MAX_SAFE_INTEGER),
    maxAttempts: normalizeInteger(record.max_attempts, 8, 1, 50),
    correlationId: trimText(record.correlation_id),
    leaseExpiresAt,
    createdAt,
  };
}
