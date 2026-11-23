export type OnSiteCollectionReceipt = { version: 1; siteId: string; operationKey: string; resourceKind: "booking" | "order"; resourceId: string;
  replayed: boolean; amountMinor: number; currency: "eur"; recordedAt: string };
export function parseOnSiteCollectionReceipt(raw: unknown, scope: { siteId: string; operationKey: string; amountMinor: number }): OnSiteCollectionReceipt {
  const r = raw as Partial<OnSiteCollectionReceipt> | null;
  if (!r || r.version !== 1 || r.siteId !== scope.siteId || r.operationKey !== scope.operationKey || !/^\d{8}$/.test(r.siteId) || !/^[a-f0-9]{64}$/.test(r.operationKey)
    || !["booking", "order"].includes(String(r.resourceKind)) || typeof r.resourceId !== "string" || !/^[A-Za-z0-9:_-]{1,160}$/.test(r.resourceId)
    || typeof r.replayed !== "boolean" || typeof r.amountMinor !== "number" || !Number.isSafeInteger(r.amountMinor) || r.amountMinor !== scope.amountMinor || r.amountMinor < 1 || r.amountMinor > 99_999_999
    || r.currency !== "eur" || typeof r.recordedAt !== "string" || r.recordedAt.length > 64 || !Number.isFinite(Date.parse(r.recordedAt))) throw new Error("checkout_invalid_response");
  return { version: 1, siteId: r.siteId, operationKey: r.operationKey, resourceKind: r.resourceKind as "booking" | "order", resourceId: r.resourceId,
    replayed: r.replayed, amountMinor: r.amountMinor, currency: r.currency, recordedAt: r.recordedAt };
}
