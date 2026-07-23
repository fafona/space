import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import {
  collectNextStaticAssetUrls,
  containsDefaultClientExceptionPage,
  normalizeProductionSmokePaths,
  runProductionSmoke,
} from "./check-production-smoke.mjs";

const silentLogger = {
  log() {},
  warn() {},
};

test("collectNextStaticAssetUrls keeps unique same-origin Next assets", () => {
  const html = `
    <script src="/_next/static/chunks/app.js"></script>
    <script src="/_next/static/chunks/app.js"></script>
    <link rel="stylesheet" href="/_next/static/css/site.css?x=1&amp;y=2">
    <script src="https://cdn.example.com/_next/static/chunks/external.js"></script>
  `;
  assert.deepEqual(collectNextStaticAssetUrls(html, "https://faolla.com/login"), [
    "https://faolla.com/_next/static/chunks/app.js",
    "https://faolla.com/_next/static/css/site.css?x=1&y=2",
  ]);
});

test("normalizeProductionSmokePaths rejects external and protocol-relative paths", () => {
  assert.deepEqual(normalizeProductionSmokePaths("/,/login,/login"), ["/", "/login"]);
  assert.throws(() => normalizeProductionSmokePaths("https://example.com/login"), /root-relative/);
  assert.throws(() => normalizeProductionSmokePaths("//example.com/login"), /root-relative/);
});

test("containsDefaultClientExceptionPage ignores detector text inside scripts", () => {
  const detectorText = "Application error: a client-side exception has occurred";
  assert.equal(
    containsDefaultClientExceptionPage(`<html><body><script>const marker = "${detectorText}";</script>OK</body></html>`),
    false,
  );
  assert.equal(containsDefaultClientExceptionPage(`<html><body>${detectorText}</body></html>`), true);
});

async function startSmokeServer() {
  let assetStatus = 200;
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/api/app-web-version") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: true, buildId: "build-123" }));
      return;
    }
    if (url.pathname === "/_next/static/chunks/app.js") {
      response.statusCode = assetStatus;
      response.setHeader("Content-Type", "application/javascript");
      response.end(assetStatus === 200 ? "globalThis.__smoke = true;" : "missing");
      return;
    }
    if (url.pathname === "/faolla-sw.js") {
      response.setHeader("Content-Type", "application/javascript");
      response.end("self.addEventListener('fetch', () => {});");
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html><body><script src="/_next/static/chunks/app.js"></script></body></html>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("smoke test server did not start");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    setAssetStatus(status) {
      assetStatus = status;
    },
    close() {
      return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

test("runProductionSmoke verifies build, pages, assets and service worker", async () => {
  const fixture = await startSmokeServer();
  try {
    const result = await runProductionSmoke({
      origin: fixture.origin,
      paths: ["/", "/login", "/10909094"],
      expectedBuildId: "build-123",
      attempts: 1,
      delayMs: 0,
      timeoutMs: 2_000,
      logger: silentLogger,
    });
    assert.equal(result.ok, true);
    assert.equal(result.buildId, "build-123");
    assert.equal(result.pagesChecked, 3);
    assert.equal(result.assetsChecked, 1);
  } finally {
    await fixture.close();
  }
});

test("runProductionSmoke fails when a referenced static asset returns 404", async () => {
  const fixture = await startSmokeServer();
  fixture.setAssetStatus(404);
  try {
    await assert.rejects(
      runProductionSmoke({
        origin: fixture.origin,
        paths: ["/10909094"],
        expectedBuildId: "build-123",
        attempts: 1,
        delayMs: 0,
        timeoutMs: 2_000,
        logger: silentLogger,
      }),
      /static asset request failed \(404\)/,
    );
  } finally {
    await fixture.close();
  }
});
