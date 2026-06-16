import test from "node:test";
import assert from "node:assert/strict";
import { __clearPublishedSiteLookupCacheForTests, resolvePublishedSiteByPrefix } from "@/lib/publishedSiteLookup";

test("resolvePublishedSiteByPrefix normalizes prefixes and returns resolved numeric site ids", async () => {
  __clearPublishedSiteLookupCacheForTests();
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = (async (input: URL | RequestInfo) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ siteId: "10000000" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const resolved = await resolvePublishedSiteByPrefix(" FaFona ");
    assert.equal(requestedUrl.includes("/api/site-resolve?prefix=fafona"), true);
    assert.deepEqual(resolved, { prefix: "fafona", siteId: "10000000" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resolvePublishedSiteByPrefix returns null for backend 404 or malformed payloads", async () => {
  __clearPublishedSiteLookupCacheForTests();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

  try {
    const resolved = await resolvePublishedSiteByPrefix("fafona");
    assert.equal(resolved, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resolvePublishedSiteByPrefix skips requests for empty normalized prefixes", async () => {
  __clearPublishedSiteLookupCacheForTests();
  let called = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    called = true;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  try {
    const resolved = await resolvePublishedSiteByPrefix("%%%");
    assert.equal(resolved, null);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resolvePublishedSiteByPrefix reuses a fresh cached lookup", async () => {
  __clearPublishedSiteLookupCacheForTests();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ siteId: "10000000" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const first = await resolvePublishedSiteByPrefix("fafona");
    const second = await resolvePublishedSiteByPrefix(" FaFona ");
    assert.deepEqual(first, { prefix: "fafona", siteId: "10000000" });
    assert.deepEqual(second, { prefix: "fafona", siteId: "10000000" });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    __clearPublishedSiteLookupCacheForTests();
  }
});
