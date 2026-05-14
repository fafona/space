export const MERCHANT_NATIVE_PUSH_TOKENS_PAGE_SLUG = "merchant-native-push-tokens";

export type MerchantNativePushPlatform = "android";

export type MerchantNativePushTokenRecord = {
  token: string;
  platform: MerchantNativePushPlatform;
  merchantId: string;
  merchantName: string;
  merchantEmail: string;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  lastDeliveredAt: string;
  badgeCount: number;
  userAgent: string;
};

export type MerchantNativePushTokenPayload = {
  version: 1;
  tokens: MerchantNativePushTokenRecord[];
};

type UpsertMerchantNativePushTokenInput = {
  token: string;
  platform?: MerchantNativePushPlatform | null;
  merchantId: string;
  merchantName?: string | null;
  merchantEmail?: string | null;
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

function normalizePlatform(): MerchantNativePushPlatform {
  return "android";
}

function sortTokens(records: MerchantNativePushTokenRecord[]) {
  return [...records].sort((left, right) => {
    const updatedDiff = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    if (updatedDiff !== 0) return updatedDiff;
    return left.token.localeCompare(right.token, "en");
  });
}

function normalizeRecord(value: unknown): MerchantNativePushTokenRecord | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<MerchantNativePushTokenRecord>;
  const token = trimText(source.token);
  const merchantId = normalizeMerchantId(source.merchantId);
  if (!token || !merchantId) return null;
  const nowIso = new Date().toISOString();
  return {
    token,
    platform: normalizePlatform(),
    merchantId,
    merchantName: trimText(source.merchantName) || merchantId,
    merchantEmail: normalizeEmail(source.merchantEmail),
    createdAt: normalizeIsoDate(source.createdAt, nowIso),
    updatedAt: normalizeIsoDate(source.updatedAt, nowIso),
    lastSeenAt: normalizeIsoDate(source.lastSeenAt, nowIso),
    lastDeliveredAt: normalizeIsoDate(source.lastDeliveredAt, ""),
    badgeCount: normalizeBadgeCount(source.badgeCount),
    userAgent: trimText(source.userAgent),
  };
}

export function createEmptyMerchantNativePushTokenPayload(): MerchantNativePushTokenPayload {
  return {
    version: 1,
    tokens: [],
  };
}

export function normalizeMerchantNativePushTokenPayload(value: unknown): MerchantNativePushTokenPayload {
  if (!value || typeof value !== "object") return createEmptyMerchantNativePushTokenPayload();
  const source = value as { tokens?: unknown };
  const list = Array.isArray(source.tokens) ? source.tokens : [];
  const deduped = new Map<string, MerchantNativePushTokenRecord>();
  list.forEach((item) => {
    const record = normalizeRecord(item);
    if (!record) return;
    const previous = deduped.get(record.token);
    if (!previous || new Date(record.updatedAt).getTime() >= new Date(previous.updatedAt).getTime()) {
      deduped.set(record.token, record);
    }
  });
  return {
    version: 1,
    tokens: sortTokens([...deduped.values()]),
  };
}

export function listMerchantNativePushTokensForMerchant(
  payload: MerchantNativePushTokenPayload,
  merchantId: string,
) {
  const normalizedMerchantId = normalizeMerchantId(merchantId);
  if (!normalizedMerchantId) return [];
  return payload.tokens.filter((item) => item.merchantId === normalizedMerchantId);
}

export function upsertMerchantNativePushToken(
  payload: MerchantNativePushTokenPayload,
  input: UpsertMerchantNativePushTokenInput,
): MerchantNativePushTokenPayload {
  const token = trimText(input.token);
  const merchantId = normalizeMerchantId(input.merchantId);
  if (!token || !merchantId) return payload;
  const nowIso = new Date().toISOString();
  const previous = payload.tokens.find((item) => item.token === token) ?? null;
  const nextRecord: MerchantNativePushTokenRecord = {
    token,
    platform: normalizePlatform(),
    merchantId,
    merchantName: trimText(input.merchantName) || previous?.merchantName || merchantId,
    merchantEmail: normalizeEmail(input.merchantEmail) || previous?.merchantEmail || "",
    createdAt: previous?.createdAt || nowIso,
    updatedAt: nowIso,
    lastSeenAt: nowIso,
    lastDeliveredAt: previous?.lastDeliveredAt || "",
    badgeCount: normalizeBadgeCount(input.badgeCount ?? previous?.badgeCount ?? 0),
    userAgent: trimText(input.userAgent) || previous?.userAgent || "",
  };
  return {
    version: 1,
    tokens: sortTokens([nextRecord, ...payload.tokens.filter((item) => item.token !== token)]),
  };
}

export function removeMerchantNativePushToken(
  payload: MerchantNativePushTokenPayload,
  token: string,
): MerchantNativePushTokenPayload {
  const normalizedToken = trimText(token);
  if (!normalizedToken) return payload;
  return {
    version: 1,
    tokens: sortTokens(payload.tokens.filter((item) => item.token !== normalizedToken)),
  };
}

export function setMerchantNativePushTokenBadgeCount(
  payload: MerchantNativePushTokenPayload,
  token: string,
  badgeCount: number,
): MerchantNativePushTokenPayload {
  const normalizedToken = trimText(token);
  if (!normalizedToken) return payload;
  const nowIso = new Date().toISOString();
  return {
    version: 1,
    tokens: sortTokens(
      payload.tokens.map((item) =>
        item.token !== normalizedToken
          ? item
          : {
              ...item,
              badgeCount: normalizeBadgeCount(badgeCount),
              updatedAt: nowIso,
              lastSeenAt: nowIso,
            },
      ),
    ),
  };
}

export function incrementMerchantNativePushTokenBadges(
  payload: MerchantNativePushTokenPayload,
  merchantId: string,
  incrementBy = 1,
): { payload: MerchantNativePushTokenPayload; deliveries: MerchantNativePushTokenRecord[] } {
  const normalizedMerchantId = normalizeMerchantId(merchantId);
  if (!normalizedMerchantId) return { payload, deliveries: [] };
  const amount = Math.max(0, Math.round(incrementBy));
  if (amount <= 0) return { payload, deliveries: [] };
  const nowIso = new Date().toISOString();
  const deliveries: MerchantNativePushTokenRecord[] = [];
  const nextPayload: MerchantNativePushTokenPayload = {
    version: 1,
    tokens: sortTokens(
      payload.tokens.map((item) => {
        if (item.merchantId !== normalizedMerchantId) return item;
        const nextRecord = {
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
  return { payload: nextPayload, deliveries };
}

export function removeMerchantNativePushTokens(
  payload: MerchantNativePushTokenPayload,
  tokens: string[],
): MerchantNativePushTokenPayload {
  const blocked = new Set(tokens.map((item) => trimText(item)).filter(Boolean));
  if (blocked.size === 0) return payload;
  return {
    version: 1,
    tokens: sortTokens(payload.tokens.filter((item) => !blocked.has(item.token))),
  };
}
