import { createHash, createHmac } from "node:crypto";
import { readSuperAdminVerificationSecret } from "@/lib/superAdminServer";
import { SUPER_ADMIN_SESSION_COOKIE_MAX_AGE_SECONDS } from "@/lib/superAdminSession";
import type { SuperAdminTrustedDeviceDetails } from "@/lib/superAdminTrustedDevices";

const SUPER_ADMIN_CHALLENGE_TTL_MS = 10 * 60 * 1000;
const SUPER_ADMIN_EMAIL_PROOF_TTL_MS = 15 * 60 * 1000;
const SUPER_ADMIN_SESSION_TTL_MS = SUPER_ADMIN_SESSION_COOKIE_MAX_AGE_SECONDS * 1000;
const SUPER_ADMIN_TRUSTED_DEVICE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

type SuperAdminTokenKind = "challenge" | "email-proof" | "session" | "trusted-device";

type SignedSuperAdminTokenPayload = {
  kind: SuperAdminTokenKind;
  issuedAt: number;
  expiresAt: number;
};

export type SuperAdminChallengePayload = SignedSuperAdminTokenPayload & {
  kind: "challenge";
  deviceId: string;
  deviceLabel: string;
  nextPath: string;
  deviceDetails?: SuperAdminTrustedDeviceDetails | null;
};

type SuperAdminEmailProofPayload = SignedSuperAdminTokenPayload & {
  kind: "email-proof";
  challengeHash: string;
};

type SuperAdminSessionPayload = SignedSuperAdminTokenPayload & {
  kind: "session";
  deviceId: string;
  deviceLabel: string;
};

type SuperAdminTrustedDevicePayload = SignedSuperAdminTokenPayload & {
  kind: "trusted-device";
  deviceId: string;
  deviceLabel: string;
};

function base64UrlEncode(input: string) {
  return Buffer.from(input, "utf8").toString("base64url");
}

function base64UrlDecode(input: string) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function signTokenPayload(payload: SignedSuperAdminTokenPayload) {
  const secret = readSuperAdminVerificationSecret();
  if (!secret) return "";
  const serialized = JSON.stringify(payload);
  const encodedPayload = base64UrlEncode(serialized);
  const signature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function readSignedTokenPayload<T extends SignedSuperAdminTokenPayload>(token: string, expectedKind: T["kind"]) {
  const normalized = String(token ?? "").trim();
  if (!normalized) return null;
  const secret = readSuperAdminVerificationSecret();
  if (!secret) return null;
  const [encodedPayload, signature] = normalized.split(".");
  if (!encodedPayload || !signature) return null;
  const expectedSignature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  if (signature !== expectedSignature) return null;

  try {
    const parsed = JSON.parse(base64UrlDecode(encodedPayload)) as T;
    if (!parsed || parsed.kind !== expectedKind) return null;
    if (!Number.isFinite(parsed.issuedAt) || !Number.isFinite(parsed.expiresAt)) return null;
    if (Date.now() > parsed.expiresAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

function hashValue(value: string) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

export function normalizeSuperAdminNextPath(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized.startsWith("/") || normalized.startsWith("//")) return "/super-admin";
  return normalized || "/super-admin";
}

export function createSuperAdminChallengeToken(input: {
  deviceId: string;
  deviceLabel: string;
  nextPath?: string | null;
  deviceDetails?: SuperAdminTrustedDeviceDetails | null;
}) {
  const issuedAt = Date.now();
  const payload: SuperAdminChallengePayload = {
    kind: "challenge",
    issuedAt,
    expiresAt: issuedAt + SUPER_ADMIN_CHALLENGE_TTL_MS,
    deviceId: String(input.deviceId ?? "").trim(),
    deviceLabel: String(input.deviceLabel ?? "").trim() || "当前设备",
    nextPath: normalizeSuperAdminNextPath(input.nextPath),
    deviceDetails: input.deviceDetails ?? null,
  };
  if (!payload.deviceId) return "";
  return signTokenPayload(payload);
}

export function readSuperAdminChallengeToken(token: string) {
  return readSignedTokenPayload<SuperAdminChallengePayload>(token, "challenge");
}

export function createSuperAdminEmailProofToken(challengeToken: string) {
  const challenge = readSuperAdminChallengeToken(challengeToken);
  if (!challenge) return "";
  const issuedAt = Date.now();
  const payload: SuperAdminEmailProofPayload = {
    kind: "email-proof",
    issuedAt,
    expiresAt: Math.min(challenge.expiresAt + 5 * 60 * 1000, issuedAt + SUPER_ADMIN_EMAIL_PROOF_TTL_MS),
    challengeHash: hashValue(challengeToken),
  };
  return signTokenPayload(payload);
}

export function verifySuperAdminEmailProofToken(proofToken: string, challengeToken: string) {
  const payload = readSignedTokenPayload<SuperAdminEmailProofPayload>(proofToken, "email-proof");
  if (!payload) return false;
  return payload.challengeHash === hashValue(challengeToken);
}

export function createSuperAdminSessionToken(input: { deviceId: string; deviceLabel: string }) {
  const issuedAt = Date.now();
  const payload: SuperAdminSessionPayload = {
    kind: "session",
    issuedAt,
    expiresAt: issuedAt + SUPER_ADMIN_SESSION_TTL_MS,
    deviceId: String(input.deviceId ?? "").trim(),
    deviceLabel: String(input.deviceLabel ?? "").trim() || "当前设备",
  };
  if (!payload.deviceId) return "";
  return signTokenPayload(payload);
}

export function readSuperAdminSessionToken(token: string) {
  return readSignedTokenPayload<SuperAdminSessionPayload>(token, "session");
}

export function createSuperAdminTrustedDeviceToken(input: { deviceId: string; deviceLabel: string }) {
  const issuedAt = Date.now();
  const payload: SuperAdminTrustedDevicePayload = {
    kind: "trusted-device",
    issuedAt,
    expiresAt: issuedAt + SUPER_ADMIN_TRUSTED_DEVICE_TTL_MS,
    deviceId: String(input.deviceId ?? "").trim(),
    deviceLabel: String(input.deviceLabel ?? "").trim() || "当前设备",
  };
  if (!payload.deviceId) return "";
  return signTokenPayload(payload);
}

export function readSuperAdminTrustedDeviceToken(token: string) {
  return readSignedTokenPayload<SuperAdminTrustedDevicePayload>(token, "trusted-device");
}
