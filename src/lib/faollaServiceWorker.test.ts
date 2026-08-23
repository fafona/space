import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
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

test("service worker retires the legacy launch origin before cached navigation", () => {
  const source = readFileSync(new URL("../../public/faolla-sw.js", import.meta.url), "utf8");

  assert.match(source, /hostname \|\| ""\).*launch\.faolla\.com/);
  assert.match(source, /target\.hostname = "www\.faolla\.com"/);
  assert.match(source, /target\.pathname = "\/launch"/);
  assert.match(source, /cacheKeys\.map\(\(key\) => caches\.delete\(key\)\)/);
  assert.match(source, /retireLaunchOrigin/);
  assert.match(source, /credentials: "include"/);
  assert.match(source, /redirect: "manual"/);
  assert.match(source, /self\.registration\.unregister\(\)/);
  assert.match(source, /event\.respondWith\(Response\.redirect\(retiredLaunchTarget, 308\)\)/);
  assert.match(source, /event\.waitUntil\(retireLaunchOriginWorker\(\)\)/);
  assert.ok(
    source.indexOf("event.respondWith(Response.redirect(retiredLaunchTarget, 308))") <
      source.indexOf("event.waitUntil(retireLaunchOriginWorker())"),
  );
});
