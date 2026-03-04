"use client";

export const PUBLISH_SYNC_CHANNEL = "merchant-space-publish-sync-v1";
export const PUBLISH_SYNC_STORAGE_KEY = "merchant-space:publish:sync:v1";

export type PublishSyncMessage = {
  type: "published";
  siteIds: string[];
  at: number;
};

function normalizeSiteIds(siteIds: string[]) {
  return Array.from(
    new Set(
      siteIds
        .map((item) => (item ?? "").trim())
        .filter((item) => item.length > 0),
    ),
  );
}

function isPublishSyncMessage(value: unknown): value is PublishSyncMessage {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.type !== "published") return false;
  if (!Array.isArray(record.siteIds)) return false;
  if (typeof record.at !== "number") return false;
  return true;
}

export function broadcastPublishSync(siteIds: string[]) {
  if (typeof window === "undefined") return;
  const normalized = normalizeSiteIds(siteIds);
  if (normalized.length === 0) return;
  const message: PublishSyncMessage = {
    type: "published",
    siteIds: normalized,
    at: Date.now(),
  };

  try {
    localStorage.setItem(PUBLISH_SYNC_STORAGE_KEY, JSON.stringify(message));
    localStorage.removeItem(PUBLISH_SYNC_STORAGE_KEY);
  } catch {
    // Ignore localStorage failures.
  }

  if (typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel(PUBLISH_SYNC_CHANNEL);
      channel.postMessage(message);
      channel.close();
    } catch {
      // Ignore BroadcastChannel failures.
    }
  }
}

export function subscribePublishSync(onMessage: (message: PublishSyncMessage) => void): () => void {
  if (typeof window === "undefined") return () => {};

  const onStorage = (event: StorageEvent) => {
    if (event.key !== PUBLISH_SYNC_STORAGE_KEY) return;
    if (!event.newValue) return;
    try {
      const parsed = JSON.parse(event.newValue) as unknown;
      if (isPublishSyncMessage(parsed)) onMessage(parsed);
    } catch {
      // Ignore malformed payload.
    }
  };

  window.addEventListener("storage", onStorage);

  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel(PUBLISH_SYNC_CHANNEL);
      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (isPublishSyncMessage(event.data)) onMessage(event.data);
      };
    } catch {
      channel = null;
    }
  }

  return () => {
    window.removeEventListener("storage", onStorage);
    if (channel) {
      channel.close();
    }
  };
}

