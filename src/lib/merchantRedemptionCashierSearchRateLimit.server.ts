import { createHash } from "node:crypto";

type SearchRateLimitEntry = {
  count: number;
  resetAt: number;
};

const SEARCH_LIMIT = 30;
const SEARCH_WINDOW_MS = 60_000;
const MAX_ENTRIES = 2_000;
const entries = new Map<string, SearchRateLimitEntry>();

function buildOpaqueKey(siteId: string, principalKey: string) {
  return createHash("sha256")
    .update(`faolla:redemption-cashier:member-search:v1\n${siteId}\n${principalKey}`, "utf8")
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

function enforceCapacity() {
  while (entries.size > MAX_ENTRIES) {
    const oldestKey = entries.keys().next().value;
    if (typeof oldestKey !== "string") break;
    entries.delete(oldestKey);
  }
}

export function consumeMerchantRedemptionCashierSearchRateLimit(
  input: { siteId: string; principalKey: string },
  now = Date.now(),
) {
  prune(now);
  const key = buildOpaqueKey(input.siteId, input.principalKey);
  const current = entries.get(key);
  const entry =
    current && current.resetAt > now
      ? current
      : { count: 0, resetAt: now + SEARCH_WINDOW_MS };
  entry.count += 1;
  entries.set(key, entry);
  enforceCapacity();
  return {
    allowed: entry.count <= SEARCH_LIMIT,
    retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
  };
}

export function __resetMerchantRedemptionCashierSearchRateLimitsForTests() {
  entries.clear();
}

export function __getMerchantRedemptionCashierSearchRateLimitEntryCountForTests() {
  return entries.size;
}
