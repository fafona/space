import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  isValidAuthEmail,
  normalizeAuthEmail,
} from "@/lib/authCredentialValidation";
import type { PlatformAccountType } from "@/lib/platformAccounts";

export const ORDINARY_SIGNUP_INTENT_COOKIE =
  "merchant-space-ordinary-signup-intent";
export const ORDINARY_SIGNUP_INTENT_APP_METADATA_KEY =
  "ordinary_signup_intent_v1";
export const ORDINARY_SIGNUP_INTENT_TTL_SECONDS = 30 * 60;

const AUTH_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OrdinarySignupIntentRecord = {
  version: 1;
  status: "pending" | "completed";
  accountType: PlatformAccountType;
  emailHash: string;
  nonceHash: string;
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
};

export type OrdinarySignupIntentTokenPayload = {
  version: 1;
  userId: string;
  accountType: PlatformAccountType;
  email: string;
  nonce: string;
  iat: number;
  exp: number;
};

function readSecret() {
  return String(
    process.env.ORDINARY_SIGNUP_INTENT_SECRET ??
      process.env.SUPER_ADMIN_VERIFICATION_SECRET ??
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY ??
      "",
  ).trim();
}

function hash(value: string) {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value, "utf8").digest("base64url");
}

function deriveNonce(input: {
  secret: string;
  userId: string;
  email: string;
  accountType: PlatformAccountType;
  iat: number;
  exp: number;
}) {
  return sign(
    [
      "ordinary-signup-intent-nonce-v1",
      input.userId,
      input.email,
      input.accountType,
      String(input.iat),
      String(input.exp),
    ].join("\u0000"),
    input.secret,
  );
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function normalizeAccountType(value: unknown): PlatformAccountType | null {
  if (value === "merchant" || value === "personal") return value;
  return null;
}

function normalizeIso(value: unknown) {
  if (typeof value !== "string" || !value || value !== value.trim()) return "";
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

export function createOrdinarySignupIntent(input: {
  userId: string;
  email: string;
  accountType: PlatformAccountType;
  now?: number;
  nonce?: string;
}) {
  const secret = readSecret();
  const userId = input.userId.trim().toLowerCase();
  const email = normalizeAuthEmail(input.email);
  const accountType = normalizeAccountType(input.accountType);
  const now = Math.floor((input.now ?? Date.now()) / 1000);
  if (
    !secret ||
    !AUTH_UUID_PATTERN.test(userId) ||
    !isValidAuthEmail(email) ||
    !accountType
  ) {
    return null;
  }
  const exp = now + ORDINARY_SIGNUP_INTENT_TTL_SECONDS;
  const nonce =
    input.nonce ??
    deriveNonce({ secret, userId, email, accountType, iat: now, exp });
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(nonce)) return null;
  const payload: OrdinarySignupIntentTokenPayload = {
    version: 1,
    userId,
    accountType,
    email,
    nonce,
    iat: now,
    exp,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const record: OrdinarySignupIntentRecord = {
    version: 1,
    status: "pending",
    accountType,
    emailHash: hash(email),
    nonceHash: hash(nonce),
    createdAt: new Date(payload.iat * 1000).toISOString(),
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
  return {
    token: `${encodedPayload}.${sign(encodedPayload, secret)}`,
    payload,
    record,
  };
}

/**
 * Reissues the browser proof for a still-pending server-owned intent. The raw
 * nonce is never stored in Auth metadata: it is deterministically derived from
 * the server secret and every immutable intent field, then checked against the
 * stored hash before a token is minted. Password authentication alone can
 * therefore never manufacture an ordinary-account bootstrap intent.
 */
export function reissueOrdinarySignupIntent(input: {
  record: OrdinarySignupIntentRecord | null;
  userId: string;
  email: string;
  accountType: PlatformAccountType;
  now?: number;
}) {
  const secret = readSecret();
  const record = input.record;
  const userId = input.userId.trim().toLowerCase();
  const email = normalizeAuthEmail(input.email);
  const accountType = normalizeAccountType(input.accountType);
  const now = Math.floor((input.now ?? Date.now()) / 1000);
  if (
    !secret ||
    !record ||
    record.status !== "pending" ||
    !AUTH_UUID_PATTERN.test(userId) ||
    !isValidAuthEmail(email) ||
    !accountType ||
    record.accountType !== accountType ||
    record.emailHash !== hash(email)
  ) {
    return null;
  }
  const iatMilliseconds = new Date(record.createdAt).getTime();
  const expMilliseconds = new Date(record.expiresAt).getTime();
  if (
    !Number.isFinite(iatMilliseconds) ||
    !Number.isFinite(expMilliseconds) ||
    iatMilliseconds % 1000 !== 0 ||
    expMilliseconds % 1000 !== 0
  ) {
    return null;
  }
  const iat = iatMilliseconds / 1000;
  const exp = expMilliseconds / 1000;
  if (
    iat <= 0 ||
    exp <= now ||
    iat > now + 60 ||
    exp - iat !== ORDINARY_SIGNUP_INTENT_TTL_SECONDS
  ) {
    return null;
  }
  const nonce = deriveNonce({ secret, userId, email, accountType, iat, exp });
  if (record.nonceHash !== hash(nonce)) return null;
  const payload: OrdinarySignupIntentTokenPayload = {
    version: 1,
    userId,
    accountType,
    email,
    nonce,
    iat,
    exp,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return {
    token: `${encodedPayload}.${sign(encodedPayload, secret)}`,
    payload,
    record,
  };
}

export function verifyOrdinarySignupIntentToken(
  value: unknown,
  now = Date.now(),
): OrdinarySignupIntentTokenPayload | null {
  const token = typeof value === "string" ? value.trim() : "";
  const secret = readSecret();
  if (!secret || !token || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = sign(parts[0], secret);
  if (!safeEqual(parts[1], expected)) return null;
  try {
    const source = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const userId =
      typeof source.userId === "string" ? source.userId.trim().toLowerCase() : "";
    const email = normalizeAuthEmail(source.email);
    const accountType = normalizeAccountType(source.accountType);
    const nonce = typeof source.nonce === "string" ? source.nonce : "";
    const iat = Number.isSafeInteger(source.iat) ? Number(source.iat) : 0;
    const exp = Number.isSafeInteger(source.exp) ? Number(source.exp) : 0;
    const nowSeconds = Math.floor(now / 1000);
    if (
      source.version !== 1 ||
      !AUTH_UUID_PATTERN.test(userId) ||
      !isValidAuthEmail(email) ||
      !accountType ||
      !/^[A-Za-z0-9_-]{32,128}$/.test(nonce) ||
      iat <= 0 ||
      exp <= nowSeconds ||
      iat > nowSeconds + 60 ||
      exp - iat !== ORDINARY_SIGNUP_INTENT_TTL_SECONDS
    ) {
      return null;
    }
    return { version: 1, userId, accountType, email, nonce, iat, exp };
  } catch {
    return null;
  }
}

export function readOrdinarySignupIntentRecord(
  appMetadata: Record<string, unknown> | null | undefined,
): OrdinarySignupIntentRecord | null {
  const value = appMetadata?.[ORDINARY_SIGNUP_INTENT_APP_METADATA_KEY];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const accountType = normalizeAccountType(source.accountType);
  const createdAt = normalizeIso(source.createdAt);
  const expiresAt = normalizeIso(source.expiresAt);
  const completedAt = normalizeIso(source.completedAt);
  if (
    source.version !== 1 ||
    (source.status !== "pending" && source.status !== "completed") ||
    !accountType ||
    typeof source.emailHash !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(source.emailHash) ||
    typeof source.nonceHash !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(source.nonceHash) ||
    !createdAt ||
    !expiresAt ||
    (source.status === "completed" && !completedAt)
  ) {
    return null;
  }
  return {
    version: 1,
    status: source.status,
    accountType,
    emailHash: source.emailHash,
    nonceHash: source.nonceHash,
    createdAt,
    expiresAt,
    ...(completedAt ? { completedAt } : {}),
  };
}

export function matchesOrdinarySignupIntent(input: {
  record: OrdinarySignupIntentRecord | null;
  token: OrdinarySignupIntentTokenPayload | null;
  userId: string;
  email: string;
  accountType: PlatformAccountType;
  requirePending?: boolean;
  now?: number;
}) {
  const record = input.record;
  const token = input.token;
  const userId = input.userId.trim().toLowerCase();
  const email = normalizeAuthEmail(input.email);
  const now = input.now ?? Date.now();
  return Boolean(
    record &&
      token &&
      AUTH_UUID_PATTERN.test(userId) &&
      isValidAuthEmail(email) &&
      token.userId === userId &&
      token.email === email &&
      token.accountType === input.accountType &&
      record.accountType === input.accountType &&
      record.emailHash === hash(email) &&
      record.nonceHash === hash(token.nonce) &&
      new Date(record.createdAt).getTime() === token.iat * 1000 &&
      new Date(record.expiresAt).getTime() === token.exp * 1000 &&
      new Date(record.expiresAt).getTime() > now &&
      (!input.requirePending || record.status === "pending"),
  );
}

export function completeOrdinarySignupIntentRecord(
  record: OrdinarySignupIntentRecord,
  now = Date.now(),
): OrdinarySignupIntentRecord {
  return {
    ...record,
    status: "completed",
    completedAt: new Date(now).toISOString(),
  };
}

export function readOrdinarySignupIntentCookie(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== ORDINARY_SIGNUP_INTENT_COOKIE) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return "";
}
