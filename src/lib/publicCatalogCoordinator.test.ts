import assert from "node:assert/strict";
import test from "node:test";
import {
  createPublicCatalogCoordinator,
  type PublicCatalogFetcher,
} from "./publicCatalogCoordinator";
import type { PublicCatalogBatchResponse, PublicCatalogViewport } from "./merchantPublicCatalog";

const SITE_ID = "12345678";
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function network() {
  type RequestBody = { siteId: string; viewport: PublicCatalogViewport; blockIds: string[] };
  const requests: {
    url: string;
    init: RequestInit;
    body: RequestBody;
    response: ReturnType<typeof deferred<Pick<Response, "ok" | "json">>>;
    json: ReturnType<typeof deferred<unknown>>;
    jsonReads: number;
    headers: (ok?: boolean) => void;
  }[] = [];
  const fetcher: PublicCatalogFetcher = (url, init) => {
    const response = deferred<Pick<Response, "ok" | "json">>();
    const json = deferred<unknown>();
    const request = {
      url,
      init,
      body: JSON.parse(String(init.body)) as RequestBody,
      response,
      json,
      jsonReads: 0,
      headers(ok = true) {
        response.resolve({ ok, json: () => { request.jsonReads += 1; return json.promise; } });
      },
    };
    requests.push(request);
    return response.promise;
  };
  const reply = async (index: number, body: unknown, ok = true) => {
    requests[index].headers(ok);
    requests[index].json.resolve(body);
    await tick();
  };
  return { requests, fetcher, reply };
}

function payload(
  blockIds: readonly string[],
  revision = 7,
  price = "10.00",
  viewport: PublicCatalogViewport = "desktop",
): PublicCatalogBatchResponse {
  return {
    ok: true,
    siteId: SITE_ID,
    viewport,
    catalog: {
      revision,
      updatedAt: `revision-${revision}`,
      pricePrefix: "$",
      products: [{
        id: "product-a", code: "A", name: "Product A", description: "",
        price, imageUrl: "", thumbnailUrl: "", tag: "", availability: "available",
      }],
      categories: [{ id: "category-a", name: "A", productIds: ["product-a"] }],
    },
    results: blockIds.map((blockId) => ({
      blockId,
      status: "ready",
      collection: { id: `collection-${blockId}`, blockId, viewport },
      productIds: ["product-a"],
    })),
  };
}

function harness(viewport: PublicCatalogViewport = "desktop") {
  const net = network();
  const changes: string[][] = [];
  const coordinator = createPublicCatalogCoordinator({
    siteId: SITE_ID,
    viewport,
    fetcher: net.fetcher,
    onChange: (ids) => changes.push([...ids]),
  });
  return { ...net, changes, coordinator };
}

test("one bounded POST batches trimmed IDs, and stable/reordered rerenders never refetch", async () => {
  const h = harness();
  h.coordinator.setBlocks([" a ", "b", "a"]);
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.requests[0].body, { siteId: SITE_ID, viewport: "desktop", blockIds: ["a", "b"] });
  assert.equal(h.requests[0].url, "/api/orders/catalog/public");
  assert.equal(h.requests[0].init.method, "POST");
  assert.equal(h.requests[0].init.cache, "no-store");
  assert.deepEqual(h.requests[0].init.headers, { "Content-Type": "application/json" });
  assert.equal(h.coordinator.getState("a").status, "loading");
  await h.reply(0, payload(["a", "b"]));
  const a = h.coordinator.getState("a");
  const b = h.coordinator.getState("b");
  const changeCount = h.changes.length;
  h.coordinator.setBlocks(["b", "a"]);
  h.coordinator.setBlocks([" a ", "b", "b"]);
  assert.equal(h.requests.length, 1);
  assert.equal(h.changes.length, changeCount);
  assert.strictEqual(h.coordinator.getState(" a "), a);
  assert.strictEqual(h.coordinator.getState("b"), b);
  h.coordinator.dispose();
});

test("empty and overlong IDs fail locally without poisoning valid siblings", async () => {
  const h = harness();
  const validBoundary = "v".repeat(200);
  const invalid = "x".repeat(201);
  h.coordinator.setBlocks(["a", invalid, " ", validBoundary]);
  assert.equal(h.coordinator.getState(invalid).status, "error");
  assert.equal(h.coordinator.getState("").status, "error");
  assert.deepEqual(h.requests[0].body.blockIds, ["a", validBoundary]);
  await h.reply(0, payload(["a", validBoundary]));
  assert.equal(h.coordinator.getState("a").status, "ready");
  assert.equal(h.coordinator.getState(validBoundary).status, "ready");
  h.coordinator.refresh([invalid, "", "missing"]);
  assert.equal(h.requests.length, 1);
  h.coordinator.dispose();
});

test("A to B to A visits reject old late JSON and retain a fresh scope instance", async () => {
  const a1 = harness();
  a1.coordinator.setBlocks(["a"]);
  a1.requests[0].headers();
  await tick();
  assert.equal(a1.requests[0].jsonReads, 1);
  a1.coordinator.dispose();
  const b = harness("mobile");
  b.coordinator.setBlocks(["a"]);
  b.coordinator.dispose();
  const a2 = harness();
  a2.coordinator.setBlocks(["a"]);
  const oldNotifications = a1.changes.length;
  a1.requests[0].json.resolve(payload(["a"], 1));
  await b.reply(0, payload(["a"], 2, "2.00", "mobile"));
  assert.equal(a2.coordinator.getState("a").status, "loading");
  assert.equal(a1.changes.length, oldNotifications);
  assert.equal(a1.coordinator.getState("a").status, "loading");
  assert.equal(a1.requests[0].init.signal?.aborted, true);
  await a2.reply(0, payload(["a"], 3));
  assert.equal(a2.coordinator.getState("a").catalog?.revision, 3);
  a2.coordinator.dispose();
});

test("refresh A rejects its older JSON but lets the original batch finish B", async () => {
  const h = harness();
  h.coordinator.setBlocks(["a", "b"]);
  h.requests[0].headers();
  await tick();
  h.coordinator.refresh(["a"]);
  assert.equal(h.requests[0].init.signal?.aborted, false);
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.requests[1].body.blockIds, ["a"]);
  await h.reply(1, payload(["a"], 8, "20.00"));
  const newA = h.coordinator.getState("a");
  h.requests[0].json.resolve(payload(["a", "b"], 7));
  await tick();
  assert.strictEqual(h.coordinator.getState("a"), newA);
  assert.equal(newA.catalog?.revision, 8);
  assert.equal(newA.catalog?.products[0].price, "20.00");
  assert.equal(h.coordinator.getState("b").catalog?.revision, 7);
  h.coordinator.dispose();
});

test("refreshing A never loads B or mixes response revisions, prices and category snapshots", async () => {
  const h = harness();
  h.coordinator.setBlocks(["a", "b"]);
  const originalResponse = payload(["a", "b"]);
  await h.reply(0, originalResponse);
  const originalB = h.coordinator.getState("b");
  const originalBCopy = structuredClone(originalB);
  h.coordinator.refresh(["a", "a"]);
  assert.equal(h.coordinator.getState("a").status, "loading");
  assert.strictEqual(h.coordinator.getState("b"), originalB);
  assert.equal(h.coordinator.getState("b").status, "ready");
  await h.reply(1, payload(["a"], 8, "20.00"));
  assert.strictEqual(h.coordinator.getState("b"), originalB);
  assert.deepEqual(originalB, originalBCopy);
  // The decoder copies products/categories, so even a caller retaining the wire body
  // cannot mutate a previously published per-response price or category snapshot.
  originalResponse.catalog!.products[0].price = "999.00";
  originalResponse.catalog!.categories[0].productIds.length = 0;
  assert.deepEqual(originalB, originalBCopy);
  assert.equal(h.coordinator.getState("a").catalog?.products[0].price, "20.00");
  h.coordinator.dispose();
});

test("removing and reopening a modal block gets a new generation without aborting its sibling", async () => {
  const h = harness();
  h.coordinator.setBlocks(["inline", "modal"]);
  h.requests[0].headers();
  await tick();
  h.coordinator.setBlocks(["inline"]);
  assert.equal(h.requests[0].init.signal?.aborted, false);
  h.coordinator.setBlocks(["inline", "modal"]);
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.requests[1].body.blockIds, ["modal"]);
  h.requests[0].json.resolve(payload(["inline", "modal"], 7));
  await tick();
  assert.equal(h.coordinator.getState("inline").catalog?.revision, 7);
  assert.equal(h.coordinator.getState("modal").status, "loading");
  await h.reply(1, payload(["modal"], 8));
  assert.equal(h.coordinator.getState("modal").catalog?.revision, 8);
  h.coordinator.dispose();
});

test("adding and closing a modal leaves already-ready inline state untouched", async () => {
  const h = harness();
  h.coordinator.setBlocks(["inline"]);
  await h.reply(0, payload(["inline"]));
  const inline = h.coordinator.getState("inline");
  h.coordinator.setBlocks(["inline", "modal"]);
  assert.deepEqual(h.requests[1].body.blockIds, ["modal"]);
  assert.strictEqual(h.coordinator.getState("inline"), inline);
  h.coordinator.setBlocks(["inline"]);
  assert.equal(h.requests[1].init.signal?.aborted, true);
  assert.strictEqual(h.coordinator.getState("inline"), inline);
  h.coordinator.setBlocks(["inline", "modal"]);
  assert.equal(h.requests.length, 3);
  await h.reply(1, payload(["modal"], 7));
  assert.equal(h.coordinator.getState("modal").status, "loading");
  await h.reply(2, payload(["modal"], 8));
  assert.strictEqual(h.coordinator.getState("inline"), inline);
  h.coordinator.dispose();
});

test("more than 32 blocks split into bounded chunks with at most two active requests", async () => {
  const h = harness();
  const ids = Array.from({ length: 75 }, (_, index) => `block-${index}`);
  h.coordinator.setBlocks(ids);
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.requests.map((request) => request.body.blockIds.length), [32, 32]);
  assert.equal(h.coordinator.getState(ids[74]).status, "loading");
  await h.reply(1, payload(ids.slice(32, 64), 8));
  assert.equal(h.requests.length, 3);
  assert.deepEqual(h.requests[2].body.blockIds, ids.slice(64));
  await h.reply(2, payload(ids.slice(64), 9));
  await h.reply(0, payload(ids.slice(0, 32), 7));
  assert.equal(h.coordinator.getState(ids[0]).catalog?.revision, 7);
  assert.equal(h.coordinator.getState(ids[32]).catalog?.revision, 8);
  assert.equal(h.coordinator.getState(ids[74]).catalog?.revision, 9);
  h.coordinator.refresh([ids[0]]);
  await h.reply(3, payload([ids[0]], 10));
  assert.equal(h.coordinator.getState(ids[32]).catalog?.revision, 8);
  assert.equal(h.coordinator.getState(ids[74]).catalog?.revision, 9);
  h.coordinator.dispose();
});

test("dispose aborts all active work, discards queued blocks and rejects late failures", async () => {
  const h = harness();
  h.coordinator.setBlocks(Array.from({ length: 100 }, (_, index) => `block-${index}`));
  h.requests[0].headers();
  await tick();
  const notificationCount = h.changes.length;
  h.coordinator.dispose();
  h.coordinator.dispose();
  assert.ok(h.requests.every((request) => request.init.signal?.aborted));
  h.requests[0].json.reject(new Error("late body failure"));
  h.requests[1].response.reject(new Error("late fetch failure"));
  h.coordinator.setBlocks(["new"]);
  h.coordinator.refresh();
  await tick();
  assert.equal(h.requests.length, 2);
  assert.equal(h.changes.length, notificationCount);
  assert.equal(h.coordinator.getState("block-0").status, "loading");
});

test("queued removals and refreshes skip stale generations without duplicate or ghost requests", async () => {
  const h = harness();
  const ids = Array.from({ length: 66 }, (_, index) => `block-${index}`);
  h.coordinator.setBlocks(ids);
  h.coordinator.setBlocks(ids.slice(0, 65));
  h.coordinator.refresh([ids[64]]);
  h.coordinator.setBlocks(ids);
  assert.equal(h.requests.length, 2);
  await h.reply(0, payload(ids.slice(0, 32)));
  assert.equal(h.requests.length, 3);
  assert.deepEqual(h.requests[2].body.blockIds, ids.slice(64));
  await h.reply(2, payload(ids.slice(64), 8));
  await h.reply(1, payload(ids.slice(32, 64)));
  assert.equal(h.coordinator.getState(ids[64]).catalog?.revision, 8);
  assert.equal(h.coordinator.getState(ids[65]).catalog?.revision, 8);
  assert.equal(h.requests.length, 3);
  h.coordinator.dispose();
});

test("refresh aborts an orphaned late body, and its rejection cannot overwrite fresh state", async () => {
  const h = harness();
  h.coordinator.setBlocks(["a"]);
  h.requests[0].headers();
  await tick();
  h.coordinator.refresh();
  assert.equal(h.requests[0].init.signal?.aborted, true);
  assert.equal(h.requests.length, 2);
  await h.reply(1, payload(["a"], 8));
  const fresh = h.coordinator.getState("a");
  h.requests[0].json.reject(new Error("late decode failure"));
  await tick();
  assert.strictEqual(h.coordinator.getState("a"), fresh);
  h.coordinator.dispose();
});

test("an older sibling batch failure affects only entries still owned by that request", async () => {
  const h = harness();
  h.coordinator.setBlocks(["a", "b"]);
  h.requests[0].headers();
  await tick();
  h.coordinator.refresh(["a"]);
  await h.reply(1, payload(["a"], 8));
  const freshA = h.coordinator.getState("a");
  h.requests[0].json.reject(new Error("old sibling body failure"));
  await tick();
  assert.strictEqual(h.coordinator.getState("a"), freshA);
  assert.deepEqual(h.coordinator.getState("b"), { status: "error", catalog: null });
  h.coordinator.dispose();
});

test("HTTP, network and malformed data fail closed without single-GET fallback", async () => {
  for (const failure of ["http", "network", "malformed", "wrong-scope"] as const) {
    const h = harness();
    h.coordinator.setBlocks(["a"]);
    if (failure === "network") {
      h.requests[0].response.reject(new Error("unavailable"));
      await tick();
    } else {
      await h.reply(0, failure === "wrong-scope" ? payload(["a"], 7, "10.00", "mobile") : {}, failure !== "http");
    }
    assert.deepEqual(h.coordinator.getState("a"), { status: "error", catalog: null }, failure);
    assert.equal(h.requests.length, 1, failure);
    if (failure === "http") assert.equal(h.requests[0].jsonReads, 0);
    h.coordinator.dispose();
  }
});

test("only explicit legacy decodes to ready/null and malformed siblings remain isolated", async () => {
  const h = harness();
  h.coordinator.setBlocks(["ready", "legacy", "missing", "broken"]);
  const response = payload(["ready"]);
  response.results.push(
    { blockId: "legacy", status: "legacy" },
    { blockId: "broken", status: "ready", collection: { id: "bad", blockId: "mismatch", viewport: "desktop" }, productIds: [] },
    { blockId: "unrequested", status: "legacy" },
  );
  await h.reply(0, response);
  assert.equal(h.coordinator.getState("ready").catalog?.revision, 7);
  assert.deepEqual(h.coordinator.getState("legacy"), { status: "ready", catalog: null });
  assert.deepEqual(h.coordinator.getState("missing"), { status: "error", catalog: null });
  assert.deepEqual(h.coordinator.getState("broken"), { status: "error", catalog: null });
  assert.deepEqual(h.coordinator.getState("unrequested"), { status: "loading", catalog: null });
  h.coordinator.dispose();
});
