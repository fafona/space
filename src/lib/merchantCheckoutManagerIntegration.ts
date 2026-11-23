import type { CheckoutResourceReference } from "./merchantCheckoutReporting";

/** Only keys currently rendered by the host. Invalid old identifiers cannot
 * belong to this ledger and are not turned into an unpaid financial row. */
export function checkoutManagerResourcePages(resources: CheckoutResourceReference[]) {
  const seen = new Set<string>(), safe: CheckoutResourceReference[] = [];
  if (resources.length > 1000) throw new Error("checkout_reporting_invalid");
  for (const r of resources) {
    if (!r || (r.kind !== "booking" && r.kind !== "order") || typeof r.id !== "string" || !/^[A-Za-z0-9:_-]{1,160}$/.test(r.id)) continue;
    const key = `${r.kind}:${r.id}`;
    if (!seen.has(key)) { seen.add(key); safe.push({ kind: r.kind, id: r.id }); }
  }
  return Array.from({ length: Math.ceil(safe.length / 50) }, (_, i) => safe.slice(i * 50, i * 50 + 50));
}

export function parseCheckoutManagerAccess(payload: unknown, siteId: string): string | null {
  if (!payload || typeof payload !== "object" || !("ok" in payload) || payload.ok !== true || !("access" in payload)) throw new Error("checkout_reporting_unavailable");
  if (payload.access === null) return null;
  const a = payload.access;
  if (!a || typeof a !== "object" || !("siteId" in a) || a.siteId !== siteId || !("identityKey" in a)
    || typeof a.identityKey !== "string" || !/^[a-f0-9]{64}$/.test(a.identityKey)) throw new Error("checkout_reporting_unavailable");
  return a.identityKey;
}
