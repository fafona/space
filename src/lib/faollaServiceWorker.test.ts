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
