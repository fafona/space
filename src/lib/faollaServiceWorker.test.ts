import assert from "node:assert/strict";
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
