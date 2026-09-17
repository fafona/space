import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createBusinessCardStorageReader } from "./merchantBusinessCardStorage";
import { isMerchantBusinessCardShareRevoked, loadMerchantBusinessCardSharePayloadByKey } from "./merchantBusinessCardShare";

const origin = "https://faolla.com";
const objectUrl = `${origin}/storage/v1/object/public/page-assets/merchant-shares/card-abc123.json`;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("overlapping reads share one request, but completed results are never cached", async () => {
  const gate = deferred(); let calls = 0;
  const read = createBusinessCardStorageReader({ fetchImpl: async (_url, init) => {
    calls++; assert.equal(init?.cache, "no-store"); assert.equal(init?.next?.revalidate, 0);
    await gate.promise; return Response.json({ version: calls });
  } });
  const pending = Array.from({ length: 12 }, () => read(objectUrl));
  assert.equal(calls, 1); gate.resolve();
  assert.deepEqual(await Promise.all(pending), Array.from({ length: 12 }, () => ({ exists: true, payload: { version: 1 } })));
  assert.deepEqual((await read(objectUrl)).payload, { version: 2 });
});

test("origins, buckets and object paths do not share a result", async () => {
  const urls: string[] = []; const gate = deferred();
  const read = createBusinessCardStorageReader({ fetchImpl: async (input) => {
    const url = new URL(String(input)); url.searchParams.delete("_ts"); urls.push(url.toString());
    await gate.promise; return Response.json({ url: url.toString() });
  } });
  const requested = [objectUrl, objectUrl.replace("faolla.com", "other.faolla.com"), objectUrl.replace("page-assets", "assets"), objectUrl.replace("abc123", "xyz123")];
  const pending = requested.map(url => read(url)); assert.deepEqual(urls, requested); gate.resolve();
  assert.deepEqual((await Promise.all(pending)).map(r => r.payload), requested.map(url => ({ url })));
});

test("missing objects and failures are retried by the next request", async () => {
  let calls = 0;
  const read = createBusinessCardStorageReader({ fetchImpl: async () => {
    calls++; if (calls === 1) return new Response(null, { status: 400 });
    if (calls === 2) throw new Error("network");
    return Response.json({ published: true });
  } });
  assert.equal((await read(objectUrl)).exists, false);
  await assert.rejects(read(objectUrl), /network/);
  assert.equal((await read(objectUrl)).exists, true); assert.equal(calls, 3);
});

test("a hung body is bounded and does not keep the coalescing entry forever", async () => {
  let calls = 0;
  const read = createBusinessCardStorageReader({ timeoutMs: 20, fetchImpl: async () => {
    calls++; if (calls === 1) return { ok: true, json: () => new Promise(() => {}) } as Response;
    return Response.json({ recovered: true });
  } });
  await assert.rejects(read(objectUrl), /business_card_storage_timeout/);
  assert.deepEqual((await read(objectUrl)).payload, { recovered: true });
});

test("a hung fetch is aborted", async () => {
  let signal: AbortSignal | null | undefined;
  const read = createBusinessCardStorageReader({ timeoutMs: 20, fetchImpl: async (_url, init) => {
    signal = init?.signal; return new Promise(() => {});
  } });
  await assert.rejects(read(objectUrl), /business_card_storage_timeout/);
  assert.equal(signal?.aborted, true);
});

test("revocation existence does not require a valid or completed body", async () => {
  let bodyReads = 0;
  const read = createBusinessCardStorageReader({ fetchImpl: async () => ({
    ok: true, json: () => { bodyReads++; return new Promise(() => {}); },
  } as Response) });
  assert.deepEqual(await read(objectUrl, true), { exists: true, payload: null });
  assert.equal(bodyReads, 0);
});

test("malformed JSON remains an existing object and can recover on the next read", async () => {
  let calls = 0;
  const read = createBusinessCardStorageReader({ fetchImpl: async () => {
    calls++;
    return calls === 1 ? new Response("not-json") : Response.json({ recovered: true });
  } });
  assert.deepEqual(await read(objectUrl), { exists: true, payload: null });
  assert.deepEqual(await read(objectUrl), { exists: true, payload: { recovered: true } });
});

test("existence checks do not wait for an overlapping payload body", async () => {
  let calls = 0;
  const gate = deferred();
  const read = createBusinessCardStorageReader({ fetchImpl: async () => {
    calls++;
    return { ok: true, json: async () => { await gate.promise; return { value: 1 }; } } as Response;
  } });
  const payload = read(objectUrl);
  try {
    assert.deepEqual(await read(objectUrl, true), { exists: true, payload: null });
    assert.equal(calls, 2);
  } finally { gate.resolve(); }
  assert.deepEqual(await payload, { exists: true, payload: { value: 1 } });
});

test("capacity limits coalescing without evicting another read or skipping a check", async () => {
  let calls = 0; const gate = deferred();
  const read = createBusinessCardStorageReader({ capacity: 1, fetchImpl: async () => {
    calls++; await gate.promise; return new Response(null, { status: 404 });
  } });
  const pending = [read(objectUrl), read(objectUrl), read(objectUrl + "?other=1"), read(objectUrl + "?other=1")];
  assert.equal(calls, 3); gate.resolve(); await Promise.all(pending);
  await read(objectUrl); assert.equal(calls, 4);
});

test("eight simultaneous manifest loads use four reads and still select the latest bucket", async () => {
  const originalFetch = globalThis.fetch; const gate = deferred(); let calls = 0;
  globalThis.fetch = async (input) => {
    calls++; await gate.promise; const url = String(input);
    if (!url.includes("/page-assets/") && !url.includes("/assets/")) return new Response(null, { status: 400 });
    return Response.json({ name: "Card", targetUrl: "https://fafona.faolla.com", updatedAt: url.includes("/assets/") ? "2026-09-17T12:00:00Z" : "2026-09-16T12:00:00Z" });
  };
  try {
    const pending = Array.from({ length: 8 }, () => loadMerchantBusinessCardSharePayloadByKey("coalesced-card", origin));
    assert.equal(calls, 4); gate.resolve();
    assert.ok((await Promise.all(pending)).every(p => p?.updatedAt === "2026-09-17T12:00:00.000Z"));
  } finally { gate.resolve(); globalThis.fetch = originalFetch; }
});

test("a revocation created after a negative read is visible immediately on the next read", async () => {
  const originalFetch = globalThis.fetch; let revoked = false; let calls = 0;
  globalThis.fetch = async (input) => {
    calls++; return new Response(null, { status: revoked && String(input).includes("/uploads/") ? 200 : 400 });
  };
  try {
    assert.equal(await isMerchantBusinessCardShareRevoked({ shareKey: "newly-revoked", preferredOrigin: origin }), false);
    revoked = true;
    assert.equal(await isMerchantBusinessCardShareRevoked({ shareKey: "newly-revoked", preferredOrigin: origin }), true);
    assert.equal(calls, 8);
  } finally { globalThis.fetch = originalFetch; }
});

test("overlapping revocation checks coalesce while preserving a legacy bucket marker", async () => {
  const originalFetch = globalThis.fetch;
  const gate = deferred();
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls++;
    await gate.promise;
    return new Response(null, { status: String(input).includes("/public/public/") ? 200 : 400 });
  };
  try {
    const pending = Array.from({ length: 8 }, () => isMerchantBusinessCardShareRevoked({
      shareKey: "overlapping-revoked", preferredOrigin: origin,
    }));
    assert.equal(calls, 4);
    gate.resolve();
    assert.deepEqual(await Promise.all(pending), Array(8).fill(true));
  } finally { gate.resolve(); globalThis.fetch = originalFetch; }
});

test("snapshot repair reuses the already-started GET before issuing HEAD probes", () => {
  const src = readFileSync(new URL("../app/card/[card]/route.ts", import.meta.url), "utf8");
  const start = src.indexOf("async function hasExistingShareManifestObject(");
  const end = src.indexOf("function isContactFieldVisibleOnContactCard", start);
  const helper = src.slice(start, end);
  const pendingCheck = helper.indexOf("if (await pendingPayload.catch(() => null)) return true;");
  assert.ok(start >= 0 && end > start && pendingCheck >= 0);
  assert.ok(pendingCheck < helper.indexOf("urls.map"));
  assert.ok(src.includes("hasExistingShareManifestObject(shareKey, requestOrigin, storedPayloadPromise)"));
});
