import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlatformMerchantSnapshotFetch,
  isRetryablePlatformMerchantSnapshotFetchError,
} from "./platformMerchantSnapshotFetch";

test("snapshot fetch retries one transient GET transport failure", async () => {
  let calls = 0;
  const request = createPlatformMerchantSnapshotFetch({
    retryDelayMs: 0,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("fetch failed");
      return new Response("ok", { status: 200 });
    },
  });

  const response = await request("http://127.0.0.1:8000/rest/v1/pages");

  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test("snapshot fetch replays the exact deterministic PATCH once", async () => {
  const calls: Array<{ url: string; method: string; body: BodyInit | null | undefined }> = [];
  const request = createPlatformMerchantSnapshotFetch({
    retryDelayMs: 0,
    fetchImpl: async (input, init) => {
      calls.push({
        url: String(input),
        method: String(init?.method ?? "GET"),
        body: init?.body,
      });
      if (calls.length === 1) {
        return new Response("temporarily unavailable", { status: 503 });
      }
      return new Response(null, { status: 204 });
    },
  });
  const url = "http://127.0.0.1:8000/rest/v1/pages?id=eq.1";
  const body = JSON.stringify({
    blocks: [{ revision: "snapshot-fixed-revision" }],
    updated_at: "2026-07-31T10:00:00.000Z",
  });

  const response = await request(url, { method: "PATCH", body });

  assert.equal(response.status, 204);
  assert.deepEqual(calls, [
    { url, method: "PATCH", body },
    { url, method: "PATCH", body },
  ]);
});

test("snapshot fetch never blindly retries POST inserts", async () => {
  let calls = 0;
  const request = createPlatformMerchantSnapshotFetch({
    retryDelayMs: 0,
    fetchImpl: async () => {
      calls += 1;
      throw new TypeError("fetch failed");
    },
  });

  await assert.rejects(
    request("http://127.0.0.1:8000/rest/v1/pages", {
      method: "POST",
      body: JSON.stringify({ slug: "__platform_snapshot__" }),
    }),
    /fetch failed/,
  );
  assert.equal(calls, 1);
});

test("snapshot fetch never retries aborts or non-network errors", async () => {
  let calls = 0;
  const request = createPlatformMerchantSnapshotFetch({
    retryDelayMs: 0,
    fetchImpl: async () => {
      calls += 1;
      throw new DOMException("request aborted", "AbortError");
    },
  });

  await assert.rejects(
    request("http://127.0.0.1:8000/rest/v1/pages"),
    (error: unknown) =>
      error instanceof DOMException && error.name === "AbortError",
  );
  assert.equal(calls, 1);
  assert.equal(
    isRetryablePlatformMerchantSnapshotFetchError(
      Object.assign(new TypeError("fetch failed"), {
        cause: { code: "ECONNRESET" },
      }),
    ),
    true,
  );
  assert.equal(
    isRetryablePlatformMerchantSnapshotFetchError(
      new Error("permission denied"),
    ),
    false,
  );
});

test("snapshot fetch stops before retry when the caller aborts", async () => {
  let calls = 0;
  const controller = new AbortController();
  const request = createPlatformMerchantSnapshotFetch({
    retryDelayMs: 0,
    fetchImpl: async () => {
      calls += 1;
      controller.abort();
      throw new TypeError("fetch failed");
    },
  });

  await assert.rejects(
    request(
      new Request("http://127.0.0.1:8000/rest/v1/pages", {
        signal: controller.signal,
      }),
    ),
    (error: unknown) =>
      error instanceof DOMException && error.name === "AbortError",
  );
  assert.equal(calls, 1);
});
