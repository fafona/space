const FAOLLA_BADGE_CACHE = "faolla-badge-state-v1";
const FAOLLA_BADGE_STATE_URL = "/__faolla_badge_state__";
const FAOLLA_VISIBILITY_STATE_URL = "/__faolla_visibility_state__";
const FAOLLA_DEFAULT_ICON = "/faolla-app-icon-192.png";
const FAOLLA_VISIBLE_STATE_TTL_MS = 20_000;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

async function readBadgeCount() {
  try {
    const cache = await caches.open(FAOLLA_BADGE_CACHE);
    const response = await cache.match(FAOLLA_BADGE_STATE_URL);
    if (!response) return 0;
    const payload = await response.json().catch(() => null);
    const value = Number(payload?.count ?? 0);
    return Number.isFinite(value) ? Math.max(0, Math.min(999, Math.round(value))) : 0;
  } catch {
    return 0;
  }
}

async function writeBadgeCount(count) {
  try {
    const cache = await caches.open(FAOLLA_BADGE_CACHE);
    const payload = JSON.stringify({
      count: Math.max(0, Math.min(999, Math.round(Number(count) || 0))),
    });
    await cache.put(
      FAOLLA_BADGE_STATE_URL,
      new Response(payload, {
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      }),
    );
  } catch {
    // Ignore cache persistence failures.
  }
}

async function readVisibilityState() {
  try {
    const cache = await caches.open(FAOLLA_BADGE_CACHE);
    const response = await cache.match(FAOLLA_VISIBILITY_STATE_URL);
    if (!response) return null;
    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload !== "object") return null;
    const visible = payload.visible === true;
    const updatedAt = Number(payload.updatedAt ?? 0);
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) return null;
    return { visible, updatedAt };
  } catch {
    return null;
  }
}

async function writeVisibilityState(visible) {
  try {
    const cache = await caches.open(FAOLLA_BADGE_CACHE);
    const payload = JSON.stringify({
      visible: visible === true,
      updatedAt: Date.now(),
    });
    await cache.put(
      FAOLLA_VISIBILITY_STATE_URL,
      new Response(payload, {
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      }),
    );
  } catch {
    // Ignore visibility state persistence failures.
  }
}

async function applyBadgeCount(count) {
  const nextCount = Math.max(0, Math.min(999, Math.round(Number(count) || 0)));
  const workerNavigator = self.navigator;
  try {
    if (nextCount > 0 && typeof workerNavigator.setAppBadge === "function") {
      await workerNavigator.setAppBadge(nextCount);
      return;
    }
    if (typeof workerNavigator.clearAppBadge === "function") {
      await workerNavigator.clearAppBadge();
      return;
    }
    if (typeof workerNavigator.setAppBadge === "function") {
      await workerNavigator.setAppBadge(0);
    }
  } catch {
    // Ignore unsupported browsers or temporarily blocked badge updates.
  }
}

async function syncBadgeCount(count) {
  const nextCount = Math.max(0, Math.min(999, Math.round(Number(count) || 0)));
  await writeBadgeCount(nextCount);
  await applyBadgeCount(nextCount);
}

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "SYNC_BADGE") {
    event.waitUntil(syncBadgeCount(data.unreadCount));
    return;
  }
  if (data.type === "CLEAR_BADGE") {
    event.waitUntil(syncBadgeCount(0));
    return;
  }
  if (data.type === "SYNC_VISIBILITY") {
    event.waitUntil(writeVisibilityState(data.visible));
  }
});

async function shouldShowNotification() {
  const visibilityState = await readVisibilityState();
  if (visibilityState && Date.now() - visibilityState.updatedAt <= FAOLLA_VISIBLE_STATE_TTL_MS) {
    return !visibilityState.visible;
  }
  try {
    const clients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    return !clients.some((client) => client.visibilityState === "visible");
  } catch {
    return true;
  }
}

async function handlePush(payload) {
  const currentCount = await readBadgeCount();
  const nextCount =
    typeof payload.badgeCount === "number"
      ? payload.badgeCount
      : currentCount + Math.max(1, Math.round(Number(payload.incrementBadgeBy) || 1));
  await syncBadgeCount(nextCount);

  if (!(await shouldShowNotification())) return;

  const title = typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : "Faolla";
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  const url = typeof payload.url === "string" && payload.url.trim() ? payload.url.trim() : "/";
  const icon = typeof payload.icon === "string" && payload.icon.trim() ? payload.icon.trim() : FAOLLA_DEFAULT_ICON;
  const tag = typeof payload.tag === "string" && payload.tag.trim() ? payload.tag.trim() : undefined;
  await self.registration.showNotification(title, {
    body,
    tag,
    renotify: true,
    icon,
    badge: icon,
    data: {
      url,
    },
  });
}

self.addEventListener("push", (event) => {
  const payload = event.data?.json?.() ?? {};
  event.waitUntil(handlePush(payload));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = typeof event.notification.data?.url === "string" ? event.notification.data.url : "/";
  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const absoluteUrl = new URL(url, self.location.origin).toString();
      for (const client of windowClients) {
        if (client.url === absoluteUrl && "focus" in client) {
          await client.focus();
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(absoluteUrl);
      }
    })(),
  );
});
