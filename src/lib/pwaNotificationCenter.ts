"use client";

export const FAOLLA_BADGE_CACHE = "faolla-badge-state-v1";
export const PWA_NOTIFICATION_SETTINGS_URL = "/__faolla_notification_settings__";
export const PWA_NOTIFICATION_HISTORY_URL = "/__faolla_notification_history__";
export const PWA_NOTIFICATION_HISTORY_LIMIT = 40;

export const PWA_NOTIFICATION_CATEGORIES = ["booking", "message", "system"] as const;

export type PwaNotificationCategory = (typeof PWA_NOTIFICATION_CATEGORIES)[number];
export type PwaNotificationRoutingMode = "target-url" | "recent-workspace";

export type PwaNotificationSettings = {
  version: 1;
  categories: Record<PwaNotificationCategory, boolean>;
  routingMode: PwaNotificationRoutingMode;
};

export type PwaNotificationHistoryEntry = {
  id: string;
  title: string;
  body: string;
  url: string;
  clickUrl: string;
  tag: string;
  category: PwaNotificationCategory;
  createdAt: string;
  shown: boolean;
  source: "push" | "test";
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function createDefaultPwaNotificationSettings(): PwaNotificationSettings {
  return {
    version: 1,
    categories: {
      booking: true,
      message: true,
      system: true,
    },
    routingMode: "target-url",
  };
}

function normalizeNotificationCategory(value: unknown): PwaNotificationCategory {
  const normalized = trimText(value);
  if (normalized === "booking" || normalized === "message" || normalized === "system") {
    return normalized;
  }
  return "system";
}

function normalizeNotificationRoutingMode(value: unknown): PwaNotificationRoutingMode {
  return trimText(value) === "recent-workspace" ? "recent-workspace" : "target-url";
}

export function normalizePwaNotificationSettings(value: unknown): PwaNotificationSettings {
  const defaults = createDefaultPwaNotificationSettings();
  if (!value || typeof value !== "object") return defaults;
  const source = value as Partial<PwaNotificationSettings>;
  const sourceCategories =
    source.categories && typeof source.categories === "object" ? source.categories : null;
  return {
    version: 1,
    categories: {
      booking:
        typeof sourceCategories?.booking === "boolean"
          ? sourceCategories.booking
          : defaults.categories.booking,
      message:
        typeof sourceCategories?.message === "boolean"
          ? sourceCategories.message
          : defaults.categories.message,
      system:
        typeof sourceCategories?.system === "boolean"
          ? sourceCategories.system
          : defaults.categories.system,
    },
    routingMode: normalizeNotificationRoutingMode(source.routingMode),
  };
}

function normalizeIsoDate(value: unknown) {
  const normalized = trimText(value);
  if (!normalized) return new Date().toISOString();
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString();
}

export function normalizePwaNotificationHistoryEntry(value: unknown): PwaNotificationHistoryEntry | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<PwaNotificationHistoryEntry>;
  const title = trimText(source.title);
  const createdAt = normalizeIsoDate(source.createdAt);
  return {
    id: trimText(source.id) || `${createdAt}:${title || "notification"}`,
    title,
    body: trimText(source.body),
    url: trimText(source.url),
    clickUrl: trimText(source.clickUrl),
    tag: trimText(source.tag),
    category: normalizeNotificationCategory(source.category),
    createdAt,
    shown: source.shown !== false,
    source: source.source === "test" ? "test" : "push",
  };
}

export function normalizePwaNotificationHistory(value: unknown): PwaNotificationHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .map((entry) => normalizePwaNotificationHistoryEntry(entry))
    .filter((entry): entry is PwaNotificationHistoryEntry => Boolean(entry))
    .filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    })
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, PWA_NOTIFICATION_HISTORY_LIMIT);
}

async function openNotificationCache() {
  if (typeof window === "undefined" || !("caches" in window)) return null;
  return caches.open(FAOLLA_BADGE_CACHE);
}

export async function readPwaNotificationSettings() {
  const cache = await openNotificationCache();
  if (!cache) return createDefaultPwaNotificationSettings();
  const response = await cache.match(PWA_NOTIFICATION_SETTINGS_URL);
  if (!response) return createDefaultPwaNotificationSettings();
  const payload = await response.json().catch(() => null);
  return normalizePwaNotificationSettings(payload);
}

export async function writePwaNotificationSettings(settings: PwaNotificationSettings) {
  const cache = await openNotificationCache();
  if (!cache) return;
  await cache.put(
    PWA_NOTIFICATION_SETTINGS_URL,
    new Response(JSON.stringify(normalizePwaNotificationSettings(settings)), {
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    }),
  );
}

export async function readPwaNotificationHistory() {
  const cache = await openNotificationCache();
  if (!cache) return [] as PwaNotificationHistoryEntry[];
  const response = await cache.match(PWA_NOTIFICATION_HISTORY_URL);
  if (!response) return [] as PwaNotificationHistoryEntry[];
  const payload = await response.json().catch(() => []);
  return normalizePwaNotificationHistory(payload);
}

export async function clearPwaNotificationHistory() {
  const cache = await openNotificationCache();
  if (!cache) return;
  await cache.delete(PWA_NOTIFICATION_HISTORY_URL);
}
