import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createContext, Script } from "node:vm";
import {
  FAOLLA_SERVICE_WORKER_BASE_PATH,
  buildFaollaServiceWorkerPath,
} from "./faollaServiceWorker";

test("service worker path stays stable without a build id", () => {
  assert.equal(buildFaollaServiceWorkerPath(""), FAOLLA_SERVICE_WORKER_BASE_PATH);
});

test("service worker path is scoped to the current web build", () => {
  assert.equal(
    buildFaollaServiceWorkerPath("42e53f87fc8c73a4e1bc44d703003e34038d9200"),
    "/faolla-sw.js?build=42e53f87fc8c",
  );
});

test("service worker never overrides the server-owned canonical portal origin", () => {
  const source = readFileSync(new URL("../../public/faolla-sw.js", import.meta.url), "utf8");

  assert.doesNotMatch(source, /target\.hostname = "www\.faolla\.com"/);
  assert.doesNotMatch(source, /resolveRetiredLaunchOriginTarget/);
  assert.doesNotMatch(source, /retireLaunchOriginWorker/);
  assert.doesNotMatch(source, /Response\.redirect\(retiredLaunchTarget/);
});

test("activation removes prior-generation page caches even under an unchanged legacy build query", async () => {
  const source = readFileSync(new URL("../../public/faolla-sw.js", import.meta.url), "utf8");
  const buildMarker = "0f95f72bbc3a";
  const legacyVersion = `faolla-pwa-v20260824-1-${buildMarker}`;
  const currentVersion = `faolla-pwa-v20260828-1-${buildMarker}`;
  const cacheNamesForVersion = (version: string) => [
    `faolla-shell-${version}`,
    `faolla-public-pages-${version}`,
    `faolla-app-pages-${version}`,
    `faolla-static-${version}`,
  ];
  const legacyCacheNames = cacheNamesForVersion(legacyVersion);
  const currentCacheNames = cacheNamesForVersion(currentVersion);
  const activeCacheNames = new Set([
    "faolla-badge-state-v1",
    "unrelated-runtime-cache",
    ...legacyCacheNames,
    ...currentCacheNames,
  ]);
  const deletedCacheNames: string[] = [];
  type WorkerListener = (event: { waitUntil?: (task: Promise<unknown>) => void }) => void;
  const listeners = new Map<string, WorkerListener[]>();
  const selfMock = {
    location: {
      href: `https://launch.faolla.com/faolla-sw.js?build=${buildMarker}`,
      hostname: "launch.faolla.com",
      origin: "https://launch.faolla.com",
    },
    navigator: {},
    registration: {
      navigationPreload: {
        enable: async () => undefined,
      },
    },
    clients: {
      claim: async () => undefined,
    },
    skipWaiting: async () => undefined,
    addEventListener: (type: string, listener: WorkerListener) => {
      const current = listeners.get(type) ?? [];
      current.push(listener);
      listeners.set(type, current);
    },
  };
  const cachesMock = {
    keys: async () => [...activeCacheNames],
    delete: async (key: string) => {
      deletedCacheNames.push(key);
      return activeCacheNames.delete(key);
    },
  };
  const context = createContext({
    self: selfMock,
    caches: cachesMock,
    URL,
    Request,
    Response,
    fetch: async () => new Response(null, { status: 204 }),
  });
  new Script(source, { filename: "faolla-sw.js" }).runInContext(context);

  const activateListener = listeners.get("activate")?.[0];
  assert.ok(activateListener, "service worker must register an activate listener");
  let activationTask: Promise<unknown> | null = null;
  activateListener({
    waitUntil(task) {
      activationTask = Promise.resolve(task);
    },
  });
  assert.ok(activationTask, "activate listener must bind cache migration to waitUntil");
  await activationTask;

  legacyCacheNames.forEach((cacheName) => {
    assert.equal(activeCacheNames.has(cacheName), false, `legacy cache survived activation: ${cacheName}`);
    assert.equal(deletedCacheNames.includes(cacheName), true, `legacy cache was not deleted: ${cacheName}`);
  });
  currentCacheNames.forEach((cacheName) => {
    assert.equal(activeCacheNames.has(cacheName), true, `current cache was deleted: ${cacheName}`);
  });
  assert.equal(activeCacheNames.has("faolla-badge-state-v1"), true);
  assert.equal(activeCacheNames.has("unrelated-runtime-cache"), false);
});

test("online login and application assets survive unavailable CacheStorage", async () => {
  const source = readFileSync(new URL("../../public/faolla-sw.js", import.meta.url), "utf8");
  const origin = "https://launch.faolla.com";
  type WorkerListener = (event: {
    request?: WorkerRequest;
    preloadResponse?: Promise<Response | undefined>;
    waitUntil?: (task: Promise<unknown>) => void;
    respondWith?: (task: Promise<Response>) => void;
  }) => void;
  class WorkerRequest {
    readonly url: string;
    readonly method: string;
    readonly mode: string;
    readonly destination: string;
    readonly cache: string;
    readonly headers: Headers;

    constructor(
      input: string | WorkerRequest,
      init: {
        method?: string;
        mode?: string;
        destination?: string;
        cache?: string;
      } = {},
    ) {
      const sourceRequest = typeof input === "string" ? null : input;
      this.url = new URL(typeof input === "string" ? input : input.url, origin).toString();
      this.method = init.method ?? sourceRequest?.method ?? "GET";
      this.mode = init.mode ?? sourceRequest?.mode ?? "cors";
      this.destination = init.destination ?? sourceRequest?.destination ?? "";
      this.cache = init.cache ?? sourceRequest?.cache ?? "default";
      this.headers = sourceRequest?.headers ?? new Headers();
    }
  }

  const listeners = new Map<string, WorkerListener[]>();
  let skipWaitingCalls = 0;
  let claimCalls = 0;
  const requestedUrls: string[] = [];
  const selfMock = {
    location: {
      href: `${origin}/faolla-sw.js?build=cache-storage-recovery`,
      hostname: "launch.faolla.com",
      origin,
    },
    navigator: {},
    registration: {
      navigationPreload: {
        enable: async () => undefined,
      },
    },
    clients: {
      claim: async () => {
        claimCalls += 1;
      },
    },
    skipWaiting: async () => {
      skipWaitingCalls += 1;
    },
    addEventListener: (type: string, listener: WorkerListener) => {
      const current = listeners.get(type) ?? [];
      current.push(listener);
      listeners.set(type, current);
    },
  };
  const cacheStorageError = new Error("CacheStorage quota unavailable");
  let cacheStorageOpens = false;
  let cacheStorageMatches = true;
  const cachesMock = {
    open: async () => {
      if (!cacheStorageOpens) throw cacheStorageError;
      return {
        match: async () => {
          if (!cacheStorageMatches) throw cacheStorageError;
          return null;
        },
        put: async () => {
          throw cacheStorageError;
        },
      };
    },
    keys: async () => {
      throw cacheStorageError;
    },
    match: async () => {
      throw cacheStorageError;
    },
    delete: async () => {
      throw cacheStorageError;
    },
  };
  const context = createContext({
    self: selfMock,
    caches: cachesMock,
    URL,
    Request: WorkerRequest,
    Response,
    fetch: async (request: WorkerRequest) => {
      requestedUrls.push(request.url);
      return new Response("online", { status: 200 });
    },
  });
  new Script(source, { filename: "faolla-sw.js" }).runInContext(context);

  const installListener = listeners.get("install")?.[0];
  assert.ok(installListener, "service worker must register an install listener");
  let installTask: Promise<unknown> | null = null;
  installListener({
    waitUntil(task) {
      installTask = Promise.resolve(task);
    },
  });
  assert.ok(installTask, "install listener must bind work to waitUntil");
  await installTask;
  assert.equal(skipWaitingCalls, 1);

  const activateListener = listeners.get("activate")?.[0];
  assert.ok(activateListener, "service worker must register an activate listener");
  let activateTask: Promise<unknown> | null = null;
  activateListener({
    waitUntil(task) {
      activateTask = Promise.resolve(task);
    },
  });
  assert.ok(activateTask, "activate listener must bind work to waitUntil");
  await activateTask;
  assert.equal(claimCalls, 1);

  const fetchListener = listeners.get("fetch")?.[0];
  assert.ok(fetchListener, "service worker must register a fetch listener");
  const loginUrl = `${origin}/login?loginFrom=https%3A%2F%2Fwww.faolla.com%2F`;
  let loginTask: Promise<Response> | null = null;
  fetchListener({
    request: new WorkerRequest(loginUrl, { mode: "navigate", destination: "document" }),
    preloadResponse: Promise.resolve(undefined),
    respondWith(task) {
      loginTask = Promise.resolve(task);
    },
  });
  assert.ok(loginTask, "login navigation must be handled");
  assert.equal((await loginTask).status, 200);

  const scriptUrl = `${origin}/_next/static/chunks/app.js`;
  let scriptTask: Promise<Response> | null = null;
  fetchListener({
    request: new WorkerRequest(scriptUrl, { mode: "cors", destination: "script" }),
    respondWith(task) {
      scriptTask = Promise.resolve(task);
    },
  });
  assert.ok(scriptTask, "application asset request must be handled");
  assert.equal((await scriptTask).status, 200);

  cacheStorageOpens = true;
  cacheStorageMatches = false;
  const cacheReadFailureScriptUrl = `${origin}/_next/static/chunks/cache-read-failure.js`;
  let cacheReadFailureScriptTask: Promise<Response> | null = null;
  fetchListener({
    request: new WorkerRequest(cacheReadFailureScriptUrl, { mode: "cors", destination: "script" }),
    respondWith(task) {
      cacheReadFailureScriptTask = Promise.resolve(task);
    },
  });
  assert.ok(cacheReadFailureScriptTask, "cache read failure must fall back to the online asset");
  assert.equal((await cacheReadFailureScriptTask).status, 200);

  cacheStorageMatches = true;
  const uncachedScriptUrl = `${origin}/_next/static/chunks/uncached.js`;
  let uncachedScriptTask: Promise<Response> | null = null;
  fetchListener({
    request: new WorkerRequest(uncachedScriptUrl, { mode: "cors", destination: "script" }),
    respondWith(task) {
      uncachedScriptTask = Promise.resolve(task);
    },
  });
  assert.ok(uncachedScriptTask, "cache write failure must not replace an online asset response");
  assert.equal((await uncachedScriptTask).status, 200);
  assert.deepEqual(requestedUrls, [loginUrl, scriptUrl, cacheReadFailureScriptUrl, uncachedScriptUrl]);
});

test("app-shell worker updater refreshes the scoped worker without install UI", () => {
  const updaterSource = readFileSync(
    new URL("../components/PwaServiceWorkerUpdater.tsx", import.meta.url),
    "utf8",
  );
  const loaderSource = readFileSync(new URL("../components/PwaBootstrapLoader.tsx", import.meta.url), "utf8");
  const layoutSource = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");

  assert.match(updaterSource, /navigator\.serviceWorker\.register\(FAOLLA_SERVICE_WORKER_PATH/);
  assert.match(updaterSource, /updateViaCache: "none"/);
  assert.match(updaterSource, /nextRegistration\.update\(\)/);
  assert.match(updaterSource, /type: "SKIP_WAITING"/);
  assert.match(updaterSource, /controlledAtStartup = Boolean\(navigator\.serviceWorker\.controller\)/);
  assert.match(updaterSource, /cancelled \|\| reloadTriggered \|\| !controlledAtStartup/);
  assert.match(updaterSource, /reloadTriggered = true;\s+window\.location\.reload\(\)/);
  assert.doesNotMatch(updaterSource, /beforeinstallprompt/i);
  assert.match(loaderSource, /setMode\("service-worker-only"\)/);
  assert.match(loaderSource, /return <PwaServiceWorkerUpdater \/>/);
  assert.match(loaderSource, /dataset\.faollaRequestedAppShell/);
  assert.match(layoutSource, /dataset\.faollaRequestedAppShell = "true"/);
});

test("launch recovery has a hard document-navigation watchdog", () => {
  const source = readFileSync(new URL("../app/launch/LaunchBootstrap.tsx", import.meta.url), "utf8");

  assert.match(source, /LAUNCH_RECOVERY_WATCHDOG_MS = 12_000/);
  assert.match(source, /window\.setTimeout\(\(\) => \{/);
  assert.match(source, /window\.location\.replace\(buildBackendAppShellHref\("\/login"\)\)/);
  assert.doesNotMatch(source, /useRouter|router\.replace/);
  assert.equal(source.match(/window\.clearTimeout\(watchdogId\)/g)?.length, 1);
});
