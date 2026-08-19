import { createHmac } from "node:crypto";
import type { LegacyPersonalRecoveryCase } from "@/lib/legacyPersonalRecovery.server";
import { readRequestClientIp } from "@/lib/superAdminServer";

type RateLimitAction = "request_otp" | "verify_otp" | "approve";
type RateLimitEntry = { count: number; resetAt: number };

const POLICIES: Record<RateLimitAction, { limit: number; windowMs: number }> = {
  request_otp: { limit: 5, windowMs: 15 * 60 * 1000 },
  verify_otp: { limit: 8, windowMs: 15 * 60 * 1000 },
  approve: { limit: 3, windowMs: 5 * 60 * 1000 },
};
const MAX_ENTRIES = 2_000;
const entries = new Map<string, RateLimitEntry>();

function opaqueKey(
  recoveryCase: LegacyPersonalRecoveryCase,
  action: RateLimitAction,
  request: Request,
) {
  const clientIp = readRequestClientIp(request) || "unknown";
  return createHmac("sha256", recoveryCase.hmacSecret)
    .update(
      `faolla:legacy-personal-recovery:rate:v1\n${recoveryCase.caseHash}\n${action}\n${clientIp}`,
      "utf8",
    )
    .digest("hex");
}

function prune(now: number) {
  for (const [key, entry] of entries) {
    if (entry.resetAt <= now) entries.delete(key);
  }
  if (entries.size <= MAX_ENTRIES) return;
  for (const key of entries.keys()) {
    entries.delete(key);
    if (entries.size <= MAX_ENTRIES) break;
  }
}

export function consumeLegacyPersonalRecoveryRateLimit(
  recoveryCase: LegacyPersonalRecoveryCase,
  action: RateLimitAction,
  request: Request,
  now = Date.now(),
) {
  prune(now);
  const policy = POLICIES[action];
  const key = opaqueKey(recoveryCase, action, request);
  const current = entries.get(key);
  const entry =
    current && current.resetAt > now
      ? current
      : { count: 0, resetAt: now + policy.windowMs };
  entry.count += 1;
  entries.set(key, entry);
  return {
    allowed: entry.count <= policy.limit,
    retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
  };
}

export function __resetLegacyPersonalRecoveryRateLimitsForTests() {
  entries.clear();
}
