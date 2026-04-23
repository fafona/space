import { createHmac, timingSafeEqual } from "node:crypto";
import { type PlatformAccountType } from "@/lib/platformAccounts";

export type FrontendAuthProofPayload = {
  accountType: PlatformAccountType;
  accountId: string;
  userId: string;
  email: string;
  iat: number;
  exp: number;
};

const FRONTEND_AUTH_PROOF_TTL_SECONDS = 2 * 60 * 60;

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function readSecret() {
  return (
    trimText(process.env.FRONTEND_AUTH_PROOF_SECRET) ||
    trimText(process.env.SUPER_ADMIN_VERIFICATION_SECRET) ||
    trimText(process.env.SUPABASE_SERVICE_ROLE_KEY) ||
    trimText(process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY)
  );
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeAccountType(value: unknown): PlatformAccountType | null {
  return value === "personal" || value === "merchant" ? value : null;
}

function normalizePayload(value: unknown): FrontendAuthProofPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const accountType = normalizeAccountType(record.accountType);
  const accountId = trimText(record.accountId, 32);
  const userId = trimText(record.userId, 128);
  const email = trimText(record.email, 320).toLowerCase();
  const iat = typeof record.iat === "number" && Number.isFinite(record.iat) ? Math.floor(record.iat) : 0;
  const exp = typeof record.exp === "number" && Number.isFinite(record.exp) ? Math.floor(record.exp) : 0;
  if (!accountType || !accountId || !userId || !exp) return null;
  if (exp <= Math.floor(Date.now() / 1000)) return null;
  return { accountType, accountId, userId, email, iat, exp };
}

export function createFrontendAuthProof(input: {
  accountType: PlatformAccountType | null | undefined;
  accountId?: string | null;
  userId?: string | null;
  email?: string | null;
}) {
  const secret = readSecret();
  const accountType = normalizeAccountType(input.accountType);
  const accountId = trimText(input.accountId, 32);
  const userId = trimText(input.userId, 128);
  const email = trimText(input.email, 320).toLowerCase();
  if (!secret || !accountType || !accountId || !userId) return "";

  const now = Math.floor(Date.now() / 1000);
  const payload: FrontendAuthProofPayload = {
    accountType,
    accountId,
    userId,
    email,
    iat: now,
    exp: now + FRONTEND_AUTH_PROOF_TTL_SECONDS,
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  return `${encodedPayload}.${signPayload(encodedPayload, secret)}`;
}

export function verifyFrontendAuthProof(value: unknown): FrontendAuthProofPayload | null {
  const token = trimText(value);
  const secret = readSecret();
  if (!token || !secret) return null;
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;
  const expected = signPayload(encodedPayload, secret);
  if (!safeEqual(signature, expected)) return null;
  try {
    return normalizePayload(JSON.parse(decodeBase64Url(encodedPayload)));
  } catch {
    return null;
  }
}
