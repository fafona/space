const FAOLLA_SW_VERSION = "faolla-pwa-v20260416-6";
const FAOLLA_BADGE_CACHE = "faolla-badge-state-v1";
const FAOLLA_BADGE_STATE_URL = "/__faolla_badge_state__";
const FAOLLA_VISIBILITY_STATE_URL = "/__faolla_visibility_state__";
const FAOLLA_LAUNCH_TARGET_URL = "/__faolla_launch_target__";
const FAOLLA_NOTIFICATION_SETTINGS_URL = "/__faolla_notification_settings__";
const FAOLLA_NOTIFICATION_HISTORY_URL = "/__faolla_notification_history__";
const FAOLLA_DEFAULT_ICON = "/faolla-app-icon-192.png";
const FAOLLA_VISIBLE_STATE_TTL_MS = 20_000;
const FAOLLA_NOTIFICATION_HISTORY_LIMIT = 40;
const FAOLLA_SHELL_CACHE = `faolla-shell-${FAOLLA_SW_VERSION}`;
const FAOLLA_PUBLIC_PAGE_CACHE = `faolla-public-pages-${FAOLLA_SW_VERSION}`;
const FAOLLA_APP_PAGE_CACHE = `faolla-app-pages-${FAOLLA_SW_VERSION}`;
const FAOLLA_STATIC_CACHE = `faolla-static-${FAOLLA_SW_VERSION}`;
const FAOLLA_PUBLIC_PAGE_LIMIT = 18;
const FAOLLA_APP_PAGE_LIMIT = 6;
const FAOLLA_RECENT_ROUTE_WARM_LIMIT = 6;
const FAOLLA_PRESERVED_CACHES = new Set([
  FAOLLA_BADGE_CACHE,
  FAOLLA_SHELL_CACHE,
  FAOLLA_PUBLIC_PAGE_CACHE,
  FAOLLA_APP_PAGE_CACHE,
  FAOLLA_STATIC_CACHE,
]);
const FAOLLA_SHELL_URLS = [
  "/",
  "/login",
  "/pwa",
  "/super-admin/login",
  "/offline",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/apple-touch-icon.png",
  "/faolla-app-icon-192.png",
  "/faolla-app-icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(FAOLLA_SHELL_CACHE);
      await Promise.all(
        FAOLLA_SHELL_URLS.map(async (path) => {
          try {
            const response = await fetch(new Request(path, { cache: "reload" }));
            if (response.ok) {
              await cache.put(path, response.clone());
            }
          } catch {
            // Ignore individual precache failures so the worker can still install.
          }
        }),
      );
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheKeys = await caches.keys();
      await Promise.all(
        cacheKeys.map((key) => {
          if (!FAOLLA_PRESERVED_CACHES.has(key)) {
            return caches.delete(key);
          }
          return Promise.resolve(false);
        }),
      );
      if ("navigationPreload" in self.registration) {
        try {
          await self.registration.navigationPreload.enable();
        } catch {
          // Ignore navigation preload failures.
        }
      }
      await self.clients.claim();
    })(),
  );
});

function resolveOfflineCopy(acceptLanguageHeader) {
  const normalized = String(acceptLanguageHeader || "").trim().toLowerCase();
  if (normalized.startsWith("zh")) {
    return {
      title: "当前处于离线状态",
      body: "网络暂时不可用。你可以继续查看已缓存页面，恢复连接后再刷新同步最新内容。",
      retry: "刷新重试",
      home: "返回首页",
    };
  }
  if (normalized.startsWith("es")) {
    return {
      title: "Ahora estás sin conexión",
      body: "La red no está disponible. Puedes seguir usando páginas en caché y actualizar cuando vuelva la conexión.",
      retry: "Reintentar",
      home: "Volver al inicio",
    };
  }
  return {
    title: "You are offline",
    body: "The network is unavailable right now. You can keep using cached pages and refresh again once the connection returns.",
    retry: "Retry",
    home: "Back to home",
  };
}

function buildOfflineFallbackResponse(request) {
  const copy = resolveOfflineCopy(request.headers.get("accept-language"));
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
    <title>Faolla Offline</title>
    <style>
      :root {
        color-scheme: dark;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: radial-gradient(circle at top, #1e3a8a 0%, #0f172a 42%, #020617 100%);
        color: #ffffff;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .card {
        width: min(100%, 560px);
        border-radius: 32px;
        border: 1px solid rgba(255,255,255,0.14);
        background: rgba(255,255,255,0.1);
        box-shadow: 0 30px 90px rgba(2,6,23,0.42);
        backdrop-filter: blur(24px);
        padding: 32px;
      }
      .eyebrow {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.18);
        background: rgba(255,255,255,0.1);
        padding: 6px 12px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.28em;
        text-transform: uppercase;
        color: #dbeafe;
      }
      h1 {
        margin: 18px 0 0;
        font-size: 32px;
        line-height: 1.15;
      }
      p {
        margin: 14px 0 0;
        color: #dbe4f0;
        font-size: 14px;
        line-height: 1.9;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 28px;
      }
      button, a {
        appearance: none;
        border: 0;
        text-decoration: none;
        cursor: pointer;
        border-radius: 999px;
        padding: 12px 18px;
        font-weight: 700;
        font-size: 14px;
      }
      button {
        background: #ffffff;
        color: #020617;
      }
      a {
        border: 1px solid rgba(255,255,255,0.24);
        color: #ffffff;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <div class="eyebrow">Faolla offline</div>
      <h1>${copy.title}</h1>
      <p>${copy.body}</p>
      <div class="actions">
        <button onclick="window.location.reload()">${copy.retry}</button>
        <a href="/">${copy.home}</a>
      </div>
    </main>
  </body>
</html>`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
    status: 200,
  });
}

function isNavigationRequest(request, url) {
  if (request.method !== "GET") return false;
  if (request.mode !== "navigate") return false;
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/api/")) return false;
  if (url.pathname.startsWith("/_next/")) return false;
  if (url.pathname.startsWith("/auth/confirm")) return false;
  if (url.pathname.startsWith("/reset-password")) return false;
  if (url.searchParams.has("token_hash")) return false;
  if (url.searchParams.has("code")) return false;
  if (url.searchParams.has("superAdminProof")) return false;
  if (url.searchParams.has("superAdminChallenge")) return false;
  return true;
}

function isStaticAssetRequest(request, url) {
  if (request.method !== "GET") return false;
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/api/")) return false;
  if (url.pathname.startsWith("/_next/image")) return false;
  if (url.pathname.startsWith("/_next/static/")) return true;
  return ["style", "script", "image", "font", "audio"].includes(request.destination);
}

function normalizeNavigationCacheKey(url) {
  return `${url.origin}${url.pathname}`;
}

function isMerchantBackendPath(pathname) {
  return /^\/\d{8}(?:\/|$)/.test(pathname);
}

function isAuthNavigationPath(pathname) {
  return (
    pathname === "/login" ||
    pathname === "/launch" ||
    pathname === "/super-admin/login" ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/auth/confirm")
  );
}

function isAppNavigationPath(pathname) {
  return pathname === "/admin" || isMerchantBackendPath(pathname) || pathname.startsWith("/super-admin");
}

function shouldPersistNavigationResponse(response) {
  if (!response || !response.ok) return false;
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("text/html")) return false;
  const cacheControl = String(response.headers.get("cache-control") || "").toLowerCase();
  if (cacheControl.includes("no-store") || cacheControl.includes("private")) return false;
  if (response.headers.has("set-cookie")) return false;
  return true;
}

function normalizeWarmRoutePath(input) {
  const raw = String(input || "").trim();
  if (!raw.startsWith("/")) return "";
  if (raw.startsWith("/api/")) return "";
  if (raw.startsWith("/_next/")) return "";
  if (raw === "/launch" || raw === "/offline" || raw === "/pwa") return "";
  if (raw === "/login" || raw === "/super-admin/login") return "";
  if (raw.startsWith("/reset-password")) return "";
  if (raw.startsWith("/auth/confirm")) return "";
  return raw;
}

function normalizeNotificationCategory(input) {
  const normalized = String(input || "").trim();
  if (normalized === "booking" || normalized === "message" || normalized === "system") {
    return normalized;
  }
  return "system";
}

function normalizeNotificationRoutingMode(input) {
  return String(input || "").trim() === "recent-workspace" ? "recent-workspace" : "target-url";
}

function createDefaultNotificationSettings() {
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

function normalizeNotificationSettings(input) {
  const defaults = createDefaultNotificationSettings();
  if (!input || typeof input !== "object") return defaults;
  const categories = input.categories && typeof input.categories === "object" ? input.categories : {};
  return {
    version: 1,
    categories: {
      booking: typeof categories.booking === "boolean" ? categories.booking : defaults.categories.booking,
      message: typeof categories.message === "boolean" ? categories.message : defaults.categories.message,
      system: typeof categories.system === "boolean" ? categories.system : defaults.categories.system,
    },
    routingMode: normalizeNotificationRoutingMode(input.routingMode),
  };
}

function inferNotificationCategory(payload) {
  const explicit = normalizeNotificationCategory(payload.category);
  if (explicit !== "system" || String(payload.category || "").trim() === "system") {
    return explicit;
  }
  const tag = String(payload.tag || "").trim();
  if (tag.startsWith("booking")) return "booking";
  if (tag.startsWith("peer:") || tag.startsWith("support:")) return "message";
  return "system";
}

async function warmRecentRoutes(paths) {
  if (!Array.isArray(paths) || !paths.length) return;
  const uniquePaths = [...new Set(paths.map(normalizeWarmRoutePath).filter(Boolean))].slice(0, FAOLLA_RECENT_ROUTE_WARM_LIMIT);
  await Promise.all(
    uniquePaths.map(async (path) => {
      try {
        const url = new URL(path, self.location.origin);
        const response = await fetch(
          new Request(url.toString(), {
            method: "GET",
            headers: {
              accept: "text/html",
            },
            credentials: "same-origin",
          }),
        );
        if (!shouldPersistNavigationResponse(response)) return;
        const cacheKey = normalizeNavigationCacheKey(url);
        if (isAppNavigationPath(url.pathname)) {
          await persistNavigationResponse(FAOLLA_APP_PAGE_CACHE, cacheKey, response, FAOLLA_APP_PAGE_LIMIT);
          return;
        }
        await persistNavigationResponse(FAOLLA_PUBLIC_PAGE_CACHE, cacheKey, response, FAOLLA_PUBLIC_PAGE_LIMIT);
      } catch {
        // Ignore individual route warm failures.
      }
    }),
  );
}

async function trimCacheEntries(cacheName, maxEntries) {
  if (!Number.isFinite(maxEntries) || maxEntries <= 0) return;
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  const overflow = keys.length - maxEntries;
  if (overflow <= 0) return;
  await Promise.all(keys.slice(0, overflow).map((key) => cache.delete(key)));
}

async function persistNavigationResponse(cacheName, cacheKey, response, maxEntries) {
  if (!shouldPersistNavigationResponse(response)) return;
  const cache = await caches.open(cacheName);
  await cache.put(cacheKey, response.clone());
  await trimCacheEntries(cacheName, maxEntries);
}

async function cacheStaticAsset(request) {
  const cache = await caches.open(FAOLLA_STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          return cache.put(request, response.clone());
        }
        return null;
      })
      .catch(() => null);
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return cached || Response.error();
  }
}

async function handleAuthNavigationRequest(event, request, url) {
  const shellCache = await caches.open(FAOLLA_SHELL_CACHE);
  try {
    return await resolveNavigationResponse(event, request);
  } catch {
    if (url.pathname === "/launch") {
      const launchTarget = await readLaunchTarget();
      if (launchTarget) {
        const cachedLaunchTarget = await caches.match(
          normalizeNavigationCacheKey(new URL(launchTarget, self.location.origin)),
          {
            cacheName: FAOLLA_APP_PAGE_CACHE,
          },
        );
        if (cachedLaunchTarget) return cachedLaunchTarget;
      }
    }
    const cachedResponse =
      (await shellCache.match(url.pathname)) ||
      (url.pathname !== "/login" ? await shellCache.match("/login") : null) ||
      (await shellCache.match("/"));
    if (cachedResponse) return cachedResponse;
    return buildOfflineFallbackResponse(request);
  }
}

async function resolveNavigationResponse(event, request) {
  try {
    const preloadResponse = await event.preloadResponse;
    if (preloadResponse) return preloadResponse;
  } catch {
    // Ignore preload lookup failures and fall back to a normal fetch.
  }
  return fetch(request);
}

async function handlePublicNavigationRequest(event, request, url) {
  const shellCache = await caches.open(FAOLLA_SHELL_CACHE);
  const cacheKey = normalizeNavigationCacheKey(url);
  try {
    const response = await resolveNavigationResponse(event, request);
    await persistNavigationResponse(FAOLLA_PUBLIC_PAGE_CACHE, cacheKey, response, FAOLLA_PUBLIC_PAGE_LIMIT);
    return response;
  } catch {
    const cachedResponse =
      (await caches.match(cacheKey, { cacheName: FAOLLA_PUBLIC_PAGE_CACHE })) ||
      (await shellCache.match(url.pathname)) ||
      (url.pathname !== "/" ? await shellCache.match("/") : null);
    if (cachedResponse) return cachedResponse;
    return buildOfflineFallbackResponse(request);
  }
}

async function handleAppNavigationRequest(event, request, url) {
  const shellCache = await caches.open(FAOLLA_SHELL_CACHE);
  const cacheKey = normalizeNavigationCacheKey(url);
  try {
    const response = await resolveNavigationResponse(event, request);
    await persistNavigationResponse(FAOLLA_APP_PAGE_CACHE, cacheKey, response, FAOLLA_APP_PAGE_LIMIT);
    return response;
  } catch {
    const cachedResponse =
      (await caches.match(cacheKey, { cacheName: FAOLLA_APP_PAGE_CACHE })) ||
      (await shellCache.match(url.pathname)) ||
      (await shellCache.match("/login"));
    if (cachedResponse) return cachedResponse;
    return buildOfflineFallbackResponse(request);
  }
}

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

async function readLaunchTarget() {
  try {
    const cache = await caches.open(FAOLLA_BADGE_CACHE);
    const response = await cache.match(FAOLLA_LAUNCH_TARGET_URL);
    if (!response) return "";
    const payload = await response.json().catch(() => null);
    const path = normalizeWarmRoutePath(String(payload?.path ?? ""));
    return isAppNavigationPath(path) ? path : "";
  } catch {
    return "";
  }
}

async function writeLaunchTarget(path) {
  try {
    const normalizedPath = normalizeWarmRoutePath(path);
    const cache = await caches.open(FAOLLA_BADGE_CACHE);
    if (!normalizedPath || !isAppNavigationPath(normalizedPath)) {
      await cache.delete(FAOLLA_LAUNCH_TARGET_URL);
      return;
    }
    const payload = JSON.stringify({
      path: normalizedPath,
      updatedAt: Date.now(),
    });
    await cache.put(
      FAOLLA_LAUNCH_TARGET_URL,
      new Response(payload, {
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      }),
    );
  } catch {
    // Ignore launch target persistence failures.
  }
}

async function readNotificationSettings() {
  try {
    const cache = await caches.open(FAOLLA_BADGE_CACHE);
    const response = await cache.match(FAOLLA_NOTIFICATION_SETTINGS_URL);
    if (!response) return createDefaultNotificationSettings();
    const payload = await response.json().catch(() => null);
    return normalizeNotificationSettings(payload);
  } catch {
    return createDefaultNotificationSettings();
  }
}

async function writeNotificationSettings(settings) {
  try {
    const cache = await caches.open(FAOLLA_BADGE_CACHE);
    const payload = JSON.stringify(normalizeNotificationSettings(settings));
    await cache.put(
      FAOLLA_NOTIFICATION_SETTINGS_URL,
      new Response(payload, {
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      }),
    );
  } catch {
    // Ignore notification settings persistence failures.
  }
}

async function readNotificationHistory() {
  try {
    const cache = await caches.open(FAOLLA_BADGE_CACHE);
    const response = await cache.match(FAOLLA_NOTIFICATION_HISTORY_URL);
    if (!response) return [];
    const payload = await response.json().catch(() => []);
    return Array.isArray(payload) ? payload : [];
  } catch {
    return [];
  }
}

async function writeNotificationHistory(entries) {
  try {
    const cache = await caches.open(FAOLLA_BADGE_CACHE);
    await cache.put(
      FAOLLA_NOTIFICATION_HISTORY_URL,
      new Response(JSON.stringify(entries), {
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      }),
    );
  } catch {
    // Ignore notification history persistence failures.
  }
}

async function appendNotificationHistory(entry) {
  const existing = await readNotificationHistory();
  const nextEntries = [entry]
    .concat(existing)
    .filter((item, index, array) => array.findIndex((candidate) => candidate.id === item.id) === index)
    .slice(0, FAOLLA_NOTIFICATION_HISTORY_LIMIT);
  await writeNotificationHistory(nextEntries);
}

async function clearNotificationHistory() {
  try {
    const cache = await caches.open(FAOLLA_BADGE_CACHE);
    await cache.delete(FAOLLA_NOTIFICATION_HISTORY_URL);
  } catch {
    // Ignore notification history clearing failures.
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

async function resolveNotificationClickUrl(targetUrl, routingMode) {
  const normalizedTarget = normalizeWarmRoutePath(targetUrl);
  if (normalizeNotificationRoutingMode(routingMode) === "recent-workspace") {
    const launchTarget = await readLaunchTarget();
    if (launchTarget) return launchTarget;
  }
  if (normalizedTarget) return normalizedTarget;
  const launchTarget = await readLaunchTarget();
  return launchTarget || "/";
}

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
    return;
  }
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
    return;
  }
  if (data.type === "SYNC_LAUNCH_TARGET") {
    event.waitUntil(writeLaunchTarget(data.path));
    return;
  }
  if (data.type === "SYNC_NOTIFICATION_SETTINGS") {
    event.waitUntil(writeNotificationSettings(data.settings));
    return;
  }
  if (data.type === "CLEAR_NOTIFICATION_HISTORY") {
    event.waitUntil(clearNotificationHistory());
    return;
  }
  if (data.type === "SHOW_TEST_NOTIFICATION") {
    event.waitUntil(
      handlePush({
        title: data.title || "Faolla test notification",
        body: data.body || "This is a local notification test from PWA settings.",
        url: data.url || "/",
        tag: data.tag || `pwa-test:${Date.now()}`,
        category: data.category || "system",
        forceShow: true,
        isTest: true,
        incrementBadgeBy: 0,
      }),
    );
    return;
  }
  if (data.type === "WARM_RECENT_ROUTES") {
    event.waitUntil(warmRecentRoutes(data.routes));
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
  const settings = await readNotificationSettings();
  const category = inferNotificationCategory(payload);
  const clickUrl = await resolveNotificationClickUrl(payload.url, settings.routingMode);
  const shouldDisplayCategory = settings.categories[category] !== false;
  const shouldDisplayVisibility =
    payload.forceShow === true ? true : await shouldShowNotification();
  const shown = shouldDisplayCategory && shouldDisplayVisibility;
  const title = typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : "Faolla";
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  const tag = typeof payload.tag === "string" && payload.tag.trim() ? payload.tag.trim() : undefined;
  const icon = typeof payload.icon === "string" && payload.icon.trim() ? payload.icon.trim() : FAOLLA_DEFAULT_ICON;
  const source = payload.isTest === true ? "test" : "push";
  await appendNotificationHistory({
    id: `${Date.now()}:${tag || title}:${source}`,
    title,
    body,
    url: typeof payload.url === "string" ? payload.url.trim() : "",
    clickUrl,
    tag: tag || "",
    category,
    createdAt: new Date().toISOString(),
    shown,
    source,
  });

  const currentCount = await readBadgeCount();
  const incrementByRaw = Number(payload.incrementBadgeBy);
  const incrementBy = Number.isFinite(incrementByRaw) ? Math.max(0, Math.round(incrementByRaw)) : 1;
  const nextCount =
    typeof payload.badgeCount === "number"
      ? payload.badgeCount
      : currentCount + incrementBy;
  await syncBadgeCount(nextCount);

  if (!shown) return;

  await self.registration.showNotification(title, {
    body,
    tag,
    renotify: true,
    icon,
    badge: icon,
    data: {
      url: clickUrl,
      category,
      source,
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

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (isNavigationRequest(request, url)) {
    if (isAuthNavigationPath(url.pathname)) {
      event.respondWith(handleAuthNavigationRequest(event, request, url));
      return;
    }
    if (isAppNavigationPath(url.pathname)) {
      event.respondWith(handleAppNavigationRequest(event, request, url));
      return;
    }
    event.respondWith(handlePublicNavigationRequest(event, request, url));
    return;
  }

  if (isStaticAssetRequest(request, url)) {
    event.respondWith(cacheStaticAsset(request));
  }
});
