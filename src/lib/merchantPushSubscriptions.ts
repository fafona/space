export const MERCHANT_PUSH_SUBSCRIPTIONS_PAGE_SLUG = "merchant-push-subscriptions";

export type MerchantPushPermission = "default" | "granted" | "denied" | "unsupported";

export type MerchantWebPushSubscription = {
  endpoint: string;
  expirationTime?: number | null;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
};

export type MerchantPushSubscriptionRecord = {
  endpoint: string;
  merchantId: string;
  merchantName: string;
  merchantEmail: string;
  subscription: MerchantWebPushSubscription;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  lastDeliveredAt: string;
  permission: MerchantPushPermission;
  badgeCount: number;
  userAgent: string;
};

export type MerchantPushSubscriptionPayload = {
  version: 1;
  subscriptions: MerchantPushSubscriptionRecord[];
};

type UpsertMerchantPushSubscriptionInput = {
  merchantId: string;
  merchantName?: string | null;
  merchantEmail?: string | null;
  subscription: MerchantWebPushSubscription;
  permission?: MerchantPushPermission | null;
  badgeCount?: number | null;
  userAgent?: string | null;
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown) {
  return trimText(value).toLowerCase();
}

function normalizeMerchantId(value: unknown) {
  const normalized = trimText(value);
  return /^\d{8}$/.test(normalized) ? normalized : "";
}

function normalizeIsoDate(value: unknown, fallback: string) {
  const normalized = trimText(value);
  if (!normalized) return fallback;
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

function normalizeBadgeCount(value: unknown) {
  const numeric =
    typeof value === "number" && Number.isFinite(value)
      ? Math.round(value)
      : Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(999, numeric));
}

function normalizePermission(value: unknown): MerchantPushPermission {
  const normalized = trimText(value);
  if (normalized === "granted" || normalized === "denied" || normalized === "unsupported") {
    return normalized;
  }
  return "default";
}

function sortSubscriptions(records: MerchantPushSubscriptionRecord[]) {
  return [...records].sort((left, right) => {
    const updatedDiff = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    if (updatedDiff !== 0) return updatedDiff;
    return left.endpoint.localeCompare(right.endpoint, "en");
  });
}

function normalizeSubscription(value: unknown): MerchantWebPushSubscription | null {
  if (!value || typeof value !== "object") return null;
  const source = value as MerchantWebPushSubscription;
  const endpoint = trimText(source.endpoint);
  if (!endpoint) return null;
  const p256dh = trimText(source.keys?.p256dh);
  const auth = trimText(source.keys?.auth);
  return {
    endpoint,
    expirationTime:
      typeof source.expirationTime === "number" && Number.isFinite(source.expirationTime)
        ? source.expirationTime
        : null,
    keys: p256dh || auth ? { p256dh, auth } : undefined,
  };
}

function normalizeRecord(value: unknown): MerchantPushSubscriptionRecord | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<MerchantPushSubscriptionRecord>;
  const nowIso = new Date().toISOString();
  const subscription = normalizeSubscription(source.subscription ?? source);
  const merchantId = normalizeMerchantId(source.merchantId);
  if (!subscription || !merchantId) return null;
  return {
    endpoint: subscription.endpoint,
    merchantId,
    merchantName: trimText(source.merchantName) || merchantId,
    merchantEmail: normalizeEmail(source.merchantEmail),
    subscription,
    createdAt: normalizeIsoDate(source.createdAt, nowIso),
    updatedAt: normalizeIsoDate(source.updatedAt, nowIso),
    lastSeenAt: normalizeIsoDate(source.lastSeenAt, nowIso),
    lastDeliveredAt: normalizeIsoDate(source.lastDeliveredAt, ""),
    permission: normalizePermission(source.permission),
    badgeCount: normalizeBadgeCount(source.badgeCount),
    userAgent: trimText(source.userAgent),
  };
}

export function createEmptyMerchantPushSubscriptionPayload(): MerchantPushSubscriptionPayload {
  return {
    version: 1,
    subscriptions: [],
  };
}

export function normalizeMerchantPushSubscriptionPayload(value: unknown): MerchantPushSubscriptionPayload {
  if (!value || typeof value !== "object") {
    return createEmptyMerchantPushSubscriptionPayload();
  }
  const source = value as { subscriptions?: unknown };
  const list = Array.isArray(source.subscriptions) ? source.subscriptions : [];
  const deduped = new Map<string, MerchantPushSubscriptionRecord>();
  list.forEach((item) => {
    const record = normalizeRecord(item);
    if (!record) return;
    const previous = deduped.get(record.endpoint);
    if (!previous) {
      deduped.set(record.endpoint, record);
      return;
    }
    deduped.set(
      record.endpoint,
      new Date(record.updatedAt).getTime() >= new Date(previous.updatedAt).getTime() ? record : previous,
    );
  });
  return {
    version: 1,
    subscriptions: sortSubscriptions([...deduped.values()]),
  };
}

export function listMerchantPushSubscriptionsForMerchant(
  payload: MerchantPushSubscriptionPayload,
  merchantId: string,
) {
  const normalizedMerchantId = normalizeMerchantId(merchantId);
  if (!normalizedMerchantId) return [];
  return payload.subscriptions.filter((item) => item.merchantId === normalizedMerchantId);
}

export function upsertMerchantPushSubscription(
  payload: MerchantPushSubscriptionPayload,
  input: UpsertMerchantPushSubscriptionInput,
): MerchantPushSubscriptionPayload {
  const merchantId = normalizeMerchantId(input.merchantId);
  const subscription = normalizeSubscription(input.subscription);
  if (!merchantId || !subscription) return payload;
  const nowIso = new Date().toISOString();
  const previous = payload.subscriptions.find((item) => item.endpoint === subscription.endpoint) ?? null;
  const nextRecord: MerchantPushSubscriptionRecord = {
    endpoint: subscription.endpoint,
    merchantId,
    merchantName: trimText(input.merchantName) || previous?.merchantName || merchantId,
    merchantEmail: normalizeEmail(input.merchantEmail) || previous?.merchantEmail || "",
    subscription,
    createdAt: previous?.createdAt || nowIso,
    updatedAt: nowIso,
    lastSeenAt: nowIso,
    lastDeliveredAt: previous?.lastDeliveredAt || "",
    permission: normalizePermission(input.permission ?? previous?.permission),
    badgeCount: previous?.badgeCount ?? normalizeBadgeCount(input.badgeCount),
    userAgent: trimText(input.userAgent) || previous?.userAgent || "",
  };
  return {
    version: 1,
    subscriptions: sortSubscriptions([
      nextRecord,
      ...payload.subscriptions.filter((item) => item.endpoint !== nextRecord.endpoint),
    ]),
  };
}

export function removeMerchantPushSubscription(
  payload: MerchantPushSubscriptionPayload,
  endpoint: string,
): MerchantPushSubscriptionPayload {
  const normalizedEndpoint = trimText(endpoint);
  if (!normalizedEndpoint) return payload;
  return {
    version: 1,
    subscriptions: sortSubscriptions(
      payload.subscriptions.filter((item) => item.endpoint !== normalizedEndpoint),
    ),
  };
}

export function setMerchantPushSubscriptionBadgeCount(
  payload: MerchantPushSubscriptionPayload,
  endpoint: string,
  badgeCount: number,
  permission?: MerchantPushPermission | null,
): MerchantPushSubscriptionPayload {
  const normalizedEndpoint = trimText(endpoint);
  if (!normalizedEndpoint) return payload;
  const nowIso = new Date().toISOString();
  return {
    version: 1,
    subscriptions: sortSubscriptions(
      payload.subscriptions.map((item) =>
        item.endpoint !== normalizedEndpoint
          ? item
          : {
              ...item,
              badgeCount: normalizeBadgeCount(badgeCount),
              updatedAt: nowIso,
              lastSeenAt: nowIso,
              permission: normalizePermission(permission ?? item.permission),
            },
      ),
    ),
  };
}

export function incrementMerchantPushSubscriptionBadges(
  payload: MerchantPushSubscriptionPayload,
  merchantId: string,
  incrementBy = 1,
): { payload: MerchantPushSubscriptionPayload; deliveries: MerchantPushSubscriptionRecord[] } {
  const normalizedMerchantId = normalizeMerchantId(merchantId);
  if (!normalizedMerchantId) {
    return { payload, deliveries: [] as MerchantPushSubscriptionRecord[] };
  }
  const amount = Math.max(0, Math.round(incrementBy));
  if (amount <= 0) {
    return { payload, deliveries: [] as MerchantPushSubscriptionRecord[] };
  }
  const nowIso = new Date().toISOString();
  const deliveries: MerchantPushSubscriptionRecord[] = [];
  const nextPayload: MerchantPushSubscriptionPayload = {
    version: 1,
    subscriptions: sortSubscriptions(
      payload.subscriptions.map((item) => {
        if (item.merchantId !== normalizedMerchantId) return item;
        const nextRecord: MerchantPushSubscriptionRecord = {
          ...item,
          badgeCount: normalizeBadgeCount(item.badgeCount + amount),
          updatedAt: nowIso,
          lastDeliveredAt: nowIso,
        };
        deliveries.push(nextRecord);
        return nextRecord;
      }),
    ),
  };
  return {
    payload: nextPayload,
    deliveries,
  };
}

export function removeMerchantPushSubscriptionsByEndpoint(
  payload: MerchantPushSubscriptionPayload,
  endpoints: string[],
): MerchantPushSubscriptionPayload {
  const blocked = new Set(endpoints.map((item) => trimText(item)).filter(Boolean));
  if (blocked.size === 0) return payload;
  return {
    version: 1,
    subscriptions: sortSubscriptions(payload.subscriptions.filter((item) => !blocked.has(item.endpoint))),
  };
}
