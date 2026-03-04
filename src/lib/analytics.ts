import { isSupabaseEnabled, supabase } from "@/lib/supabase";

const CONTACT_CLICK_KEY = "merchant-space:contact-clicks:v1";
const CONTACT_CLICK_DAILY_KEY = "merchant-space:contact-clicks-daily:v1";
const PAGE_VIEW_DAILY_KEY = "merchant-space:page-views-daily:v1";
const PUBLISH_EVENT_KEY = "merchant-space:publish-events:v1";
const MAX_PUBLISH_EVENTS = 400;

type ContactClickStats = Record<string, number>;
type DailyStats = Record<string, number>;
type ContactClickDailyStats = Record<string, DailyStats>;
type PageViewDailyStats = Record<string, DailyStats>;
type PublishEvent = {
  at: string;
  success: boolean;
  bytes: number;
  changedBlocks: number;
  reason?: string;
};
type RemoteEventInput = {
  eventType: "page_view" | "contact_click" | "publish";
  channel?: string;
  pagePath?: string;
  success?: boolean;
  bytes?: number;
  changedBlocks?: number;
  reason?: string;
};
type RemoteEventRow = {
  at: string;
  eventType: string;
  channel: string;
  success: boolean | null;
};
export type RemoteAnalyticsSummary = {
  pageView1d: number;
  pageView7d: number;
  pageView30d: number;
  publishTotal7d: number;
  publishSuccess7d: number;
  publishTotal30d: number;
  publishSuccess30d: number;
  contactTop7d: Array<{ channel: string; count: number }>;
};

let remoteAnalyticsTableAvailable: boolean | null = null;
let remoteAnalyticsCooldownUntil = 0;
const REMOTE_ANALYTICS_TIMEOUT_MS = 1500;
const REMOTE_ANALYTICS_COOLDOWN_MS = 90_000;

function isIgnorableRemoteError(reason: unknown) {
  if (!reason || typeof reason !== "object") return false;
  const record = reason as { name?: unknown; message?: unknown; __isAuthError?: unknown; status?: unknown };
  const name = typeof record.name === "string" ? record.name : "";
  const message = typeof record.message === "string" ? record.message : "";
  if (name === "AbortError") return true;
  if (message.includes("signal is aborted without reason")) return true;
  if (record.__isAuthError === true && name === "AuthRetryableFetchError") return true;
  if (record.__isAuthError === true && record.status === 0) return true;
  return false;
}

function suspendRemoteAnalytics(ms = REMOTE_ANALYTICS_COOLDOWN_MS) {
  remoteAnalyticsCooldownUntil = Date.now() + Math.max(1000, ms);
}

async function withRemoteTimeout<T>(task: PromiseLike<T>, timeoutMs = REMOTE_ANALYTICS_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  const safeTask = Promise.resolve(task).catch((error) => {
    if (timedOut) {
      return new Promise<T>(() => {});
    }
    throw error;
  });
  const timeoutTask = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error("remote_analytics_timeout"));
    }, timeoutMs);
  });

  try {
    return await Promise.race([safeTask, timeoutTask]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function readRaw(): ContactClickStats {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(CONTACT_CLICK_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};
    const next: ContactClickStats = {};
    Object.entries(parsed).forEach(([key, value]) => {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        next[key] = Math.round(value);
      }
    });
    return next;
  } catch {
    return {};
  }
}

function writeRaw(stats: ContactClickStats) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CONTACT_CLICK_KEY, JSON.stringify(stats));
  } catch {
    // ignore storage write failures
  }
}

function getDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readDailyStatsByKey(key: string): Record<string, DailyStats> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};
    const next: Record<string, DailyStats> = {};
    Object.entries(parsed).forEach(([bucket, dayStats]) => {
      if (!dayStats || typeof dayStats !== "object") return;
      const safeStats: DailyStats = {};
      Object.entries(dayStats as Record<string, unknown>).forEach(([day, value]) => {
        if (typeof value === "number" && Number.isFinite(value) && value > 0) {
          safeStats[day] = Math.round(value);
        }
      });
      if (Object.keys(safeStats).length > 0) next[bucket] = safeStats;
    });
    return next;
  } catch {
    return {};
  }
}

function writeDailyStatsByKey(key: string, value: Record<string, DailyStats>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage write failures
  }
}

function readPublishEventsRaw(): PublishEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PUBLISH_EVENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const items: PublishEvent[] = [];
    parsed.forEach((item) => {
      if (!item || typeof item !== "object") return;
      const record = item as Record<string, unknown>;
      const at = typeof record.at === "string" ? record.at : "";
      const success = typeof record.success === "boolean" ? record.success : null;
      const bytes = typeof record.bytes === "number" && Number.isFinite(record.bytes) ? Math.max(0, Math.round(record.bytes)) : 0;
      const changedBlocks =
        typeof record.changedBlocks === "number" && Number.isFinite(record.changedBlocks)
          ? Math.max(0, Math.round(record.changedBlocks))
          : 0;
      const reason = typeof record.reason === "string" ? record.reason.trim().slice(0, 200) : undefined;
      if (!at || success === null) return;
      items.push({ at, success, bytes, changedBlocks, reason });
    });
    return items.slice(-MAX_PUBLISH_EVENTS);
  } catch {
    return [];
  }
}

function writePublishEventsRaw(events: PublishEvent[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PUBLISH_EVENT_KEY, JSON.stringify(events.slice(-MAX_PUBLISH_EVENTS)));
  } catch {
    // ignore storage write failures
  }
}

function isMissingTableError(message: string) {
  return /relation .* does not exist/i.test(message) || /table .* does not exist/i.test(message);
}

function toIsoDateWindow(days: number) {
  const now = Date.now();
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
}

function normalizeRemoteEventRows(rows: unknown[]): RemoteEventRow[] {
  const next: RemoteEventRow[] = [];
  rows.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const at =
      (typeof record.created_at === "string" && record.created_at) ||
      (typeof record.at === "string" && record.at) ||
      (typeof record.timestamp === "string" && record.timestamp) ||
      "";
    const eventType =
      (typeof record.event_type === "string" && record.event_type) ||
      (typeof record.type === "string" && record.type) ||
      (typeof record.event === "string" && record.event) ||
      "";
    const channel =
      (typeof record.channel === "string" && record.channel) ||
      (typeof record.page_path === "string" && record.page_path) ||
      "";
    const success =
      typeof record.success === "boolean"
        ? record.success
        : typeof record.status === "string"
          ? record.status.toLowerCase() === "success"
          : null;
    if (!at || !eventType) return;
    next.push({ at, eventType: eventType.toLowerCase(), channel: channel.trim().toLowerCase(), success });
  });
  return next;
}

async function trackRemoteEvent(input: RemoteEventInput) {
  if (typeof window === "undefined") return;
  if (!isSupabaseEnabled) return;
  if (remoteAnalyticsTableAvailable === false) return;
  if (Date.now() < remoteAnalyticsCooldownUntil) return;
  const payload = {
    event_type: input.eventType,
    channel: input.channel?.trim() || null,
    page_path: input.pagePath?.trim() || null,
    success: typeof input.success === "boolean" ? input.success : null,
    payload_bytes: typeof input.bytes === "number" ? Math.max(0, Math.round(input.bytes)) : null,
    changed_blocks: typeof input.changedBlocks === "number" ? Math.max(0, Math.round(input.changedBlocks)) : null,
    reason: input.reason?.trim() || null,
    created_at: new Date().toISOString(),
  };

  try {
    const first = await withRemoteTimeout(supabase.from("page_events").insert(payload));
    if (!first.error) {
      remoteAnalyticsTableAvailable = true;
      return;
    }
    if (isMissingTableError(first.error.message)) {
      remoteAnalyticsTableAvailable = false;
      return;
    }

    const fallback = await withRemoteTimeout(
      supabase.from("page_events").insert({
        event_type: input.eventType,
        channel: input.channel?.trim() || null,
        created_at: new Date().toISOString(),
      }),
    );
    if (!fallback.error) {
      remoteAnalyticsTableAvailable = true;
      return;
    }
    if (isMissingTableError(fallback.error.message)) {
      remoteAnalyticsTableAvailable = false;
      return;
    }
    suspendRemoteAnalytics();
  } catch (error) {
    if (isIgnorableRemoteError(error)) {
      suspendRemoteAnalytics();
      return;
    }
    suspendRemoteAnalytics();
  }
}

export function trackContactClick(channel: string) {
  const key = channel.trim().toLowerCase();
  if (!key) return;
  const current = readRaw();
  current[key] = (current[key] ?? 0) + 1;
  writeRaw(current);

  const daily = readDailyStatsByKey(CONTACT_CLICK_DAILY_KEY);
  const dateKey = getDateKey();
  const bucket = daily[key] ?? {};
  bucket[dateKey] = (bucket[dateKey] ?? 0) + 1;
  daily[key] = bucket;
  writeDailyStatsByKey(CONTACT_CLICK_DAILY_KEY, daily);
  void trackRemoteEvent({ eventType: "contact_click", channel: key });
}

export function readContactClickStats() {
  return readRaw();
}

export function readContactClickDailyStats(): ContactClickDailyStats {
  return readDailyStatsByKey(CONTACT_CLICK_DAILY_KEY);
}

export function trackPageView(path: string) {
  const key = path.trim() || "home";
  const daily = readDailyStatsByKey(PAGE_VIEW_DAILY_KEY);
  const dateKey = getDateKey();
  const bucket = daily[key] ?? {};
  bucket[dateKey] = (bucket[dateKey] ?? 0) + 1;
  daily[key] = bucket;
  writeDailyStatsByKey(PAGE_VIEW_DAILY_KEY, daily);
  void trackRemoteEvent({ eventType: "page_view", pagePath: key, channel: key });
}

export function readPageViewDailyStats(): PageViewDailyStats {
  return readDailyStatsByKey(PAGE_VIEW_DAILY_KEY);
}

export function trackPublishEvent(input: {
  success: boolean;
  bytes: number;
  changedBlocks: number;
  reason?: string;
}) {
  const events = readPublishEventsRaw();
  events.push({
    at: new Date().toISOString(),
    success: input.success,
    bytes: Math.max(0, Math.round(input.bytes)),
    changedBlocks: Math.max(0, Math.round(input.changedBlocks)),
    reason: input.reason?.trim() ? input.reason.trim().slice(0, 200) : undefined,
  });
  writePublishEventsRaw(events);
  void trackRemoteEvent({
    eventType: "publish",
    success: input.success,
    bytes: input.bytes,
    changedBlocks: input.changedBlocks,
    reason: input.reason,
  });
}

export function readPublishEvents(): PublishEvent[] {
  return readPublishEventsRaw();
}

export async function readRemoteAnalyticsSummary(days = 30): Promise<RemoteAnalyticsSummary | null> {
  if (!isSupabaseEnabled) return null;
  if (remoteAnalyticsTableAvailable === false) return null;
  if (Date.now() < remoteAnalyticsCooldownUntil) return null;

  try {
    const fromIso = toIsoDateWindow(Math.max(1, days));
    const ordered = await withRemoteTimeout(
      supabase.from("page_events").select("*").gte("created_at", fromIso).order("created_at", { ascending: false }).limit(4000),
    );
    let rows: unknown[] = [];
    if (!ordered.error) {
      rows = Array.isArray(ordered.data) ? ordered.data : [];
      remoteAnalyticsTableAvailable = true;
    } else {
      if (isMissingTableError(ordered.error.message)) {
        remoteAnalyticsTableAvailable = false;
        return null;
      }
      const fallback = await withRemoteTimeout(supabase.from("page_events").select("*").limit(4000));
      if (fallback.error) {
        if (isMissingTableError(fallback.error.message)) remoteAnalyticsTableAvailable = false;
        suspendRemoteAnalytics();
        return null;
      }
      rows = Array.isArray(fallback.data) ? fallback.data : [];
      remoteAnalyticsTableAvailable = true;
    }

    const events = normalizeRemoteEventRows(rows);
    const nowMs = Date.now();
    const inDays = (at: string, day: number) => {
      const time = new Date(at).getTime();
      if (!Number.isFinite(time)) return false;
      return nowMs - time <= day * 24 * 60 * 60 * 1000;
    };

    const pageView1d = events.filter((item) => item.eventType === "page_view" && inDays(item.at, 1)).length;
    const pageView7d = events.filter((item) => item.eventType === "page_view" && inDays(item.at, 7)).length;
    const pageView30d = events.filter((item) => item.eventType === "page_view" && inDays(item.at, 30)).length;
    const publish7d = events.filter((item) => item.eventType === "publish" && inDays(item.at, 7));
    const publish30d = events.filter((item) => item.eventType === "publish" && inDays(item.at, 30));
    const publishSuccess7d = publish7d.filter((item) => item.success === true).length;
    const publishSuccess30d = publish30d.filter((item) => item.success === true).length;

    const contactTopMap = new Map<string, number>();
    events
      .filter((item) => item.eventType === "contact_click" && inDays(item.at, 7))
      .forEach((item) => {
        const key = item.channel || "unknown";
        contactTopMap.set(key, (contactTopMap.get(key) ?? 0) + 1);
      });
    const contactTop7d = Array.from(contactTopMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([channel, count]) => ({ channel, count }));

    return {
      pageView1d,
      pageView7d,
      pageView30d,
      publishTotal7d: publish7d.length,
      publishSuccess7d,
      publishTotal30d: publish30d.length,
      publishSuccess30d,
      contactTop7d,
    };
  } catch (error) {
    if (isIgnorableRemoteError(error)) {
      suspendRemoteAnalytics();
      return null;
    }
    suspendRemoteAnalytics();
    return null;
  }
}
