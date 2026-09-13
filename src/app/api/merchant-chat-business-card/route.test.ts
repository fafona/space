import assert from "node:assert/strict";
import test from "node:test";
import {
  handleMerchantChatBusinessCardGet,
  handleMerchantChatBusinessCardPost,
  type MerchantChatBusinessCardDependencies,
} from "./route-handler";
import { buildPlatformMerchantSnapshotSite, type PlatformMerchantSnapshotPayload } from "@/lib/platformMerchantSnapshot";

const ownerId = "10000000";
const peerId = "10000001";
const origin = "https://faolla.example.invalid";

function request(method: "GET" | "POST", merchantId = ownerId, sourceOrigin = origin) {
  return new Request(`${origin}/api/merchant-chat-business-card?merchantId=${merchantId}`, {
    method,
    headers: method === "POST" ? { origin: sourceOrigin, "content-type": "application/json" } : {},
    ...(method === "POST" ? { body: JSON.stringify({ merchantId, businessCards: [] }) } : {}),
  });
}

function harness(input: { owner?: string | null; superAdmin?: boolean; legacyOwner?: string; staff?: boolean; linked?: boolean } = {}) {
  const calls = { client: 0, superAdmin: 0, session: 0, tokens: 0, auth: 0, staffGuard: 0, merchantLookup: 0, peers: 0, load: 0, save: 0 };
  const site = buildPlatformMerchantSnapshotSite({
    id: ownerId, merchantName: "Owner business", name: "Owner business", status: "online", createdAt: "2026-09-08T00:00:00.000Z",
  });
  assert.ok(site);
  const payload: PlatformMerchantSnapshotPayload = {
    revision: "original-revision", snapshot: [site], defaultSortRule: "created_desc", merchantConfigHistoryBySiteId: {},
  };
  type Client = NonNullable<ReturnType<MerchantChatBusinessCardDependencies["createClient"]>>;
  type Query = ReturnType<Client["from"]>;
  const client: Client = {
    from: (table) => {
      assert.equal(table, "merchants", "authorization must not query/write snapshot pages");
      calls.merchantLookup++;
      const result = { data: input.legacyOwner ? [{ id: input.legacyOwner }] : [], error: null };
      const query: Query = {
        select: () => query, eq: () => query, limit: () => query,
        maybeSingle: async () => result,
        then: (onfulfilled, onrejected) => Promise.resolve(result).then(onfulfilled, onrejected),
      };
      return query;
    },
    auth: { getUser: async () => {
      calls.auth++;
      return { data: { user: { id: "dummy-auth-user", email: "dummy@example.invalid" } }, error: null };
    } },
  };
  const dependencies: MerchantChatBusinessCardDependencies = {
    createClient: () => { calls.client++; return client; },
    authorizeSuperAdmin: async () => { calls.superAdmin++; return input.superAdmin === true; },
    resolveMerchantSession: async () => {
      calls.session++;
      return input.owner ? { merchantId: input.owner, merchantName: "Known owner", merchantEmail: "dummy@example.invalid" } : null;
    },
    readAccessTokens: () => { calls.tokens++; return input.legacyOwner || input.staff ? ["dummy-token-not-a-credential"] : []; },
    assertLegacyIdentityAllowed: async () => { calls.staffGuard++; if (input.staff) throw new Error("merchant_staff_identity_forbidden"); },
    loadPeerInbox: async () => {
      calls.peers++;
      return { threads: [], contacts: input.linked ? [{
        ownerMerchantId: peerId, contactMerchantId: ownerId, contactName: "Owner business", contactEmail: "", savedAt: "2026-09-08T00:00:00.000Z",
      }] : [] };
    },
    loadSnapshot: async () => { calls.load++; return structuredClone(payload); },
    saveSnapshot: async (_client, next, options) => {
      calls.save++;
      assert.equal(options?.expectedRevision, "original-revision", "keep original upstream revision, never substitute a fresh one");
      assert.equal(next.snapshot.find((row) => row.id === ownerId)?.merchantName, "Owner business");
      return { error: null, payload: next };
    },
  };
  return { calls, dependencies };
}

test("POST allows the authenticated owner and preserves the original expected revision", async () => {
  const h = harness({ owner: ownerId });
  const response = await handleMerchantChatBusinessCardPost(request("POST"), h.dependencies);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.equal(h.calls.load, 1); assert.equal(h.calls.save, 1); assert.equal(h.calls.peers, 0);
});

test("POST allows the existing super-admin authorization without needing a peer relation", async () => {
  const h = harness({ superAdmin: true });
  const response = await handleMerchantChatBusinessCardPost(request("POST"), h.dependencies);
  assert.equal(response.status, 200);
  assert.equal(h.calls.load, 1); assert.equal(h.calls.save, 1);
  assert.equal(h.calls.session, 0); assert.equal(h.calls.merchantLookup, 0); assert.equal(h.calls.peers, 0);
});

test("POST denies a linked peer before any target snapshot read or write", async () => {
  const h = harness({ owner: peerId, linked: true });
  const response = await handleMerchantChatBusinessCardPost(request("POST"), h.dependencies);
  assert.equal(response.status, 401); assert.deepEqual(await response.json(), { error: "unauthorized" });
  assert.equal(h.calls.peers, 0, "write authorization never consults read-only contacts");
  assert.equal(h.calls.load, 0); assert.equal(h.calls.save, 0);
});

test("GET continues allowing the same linked peer to read a shared card", async () => {
  const h = harness({ owner: peerId, linked: true });
  const response = await handleMerchantChatBusinessCardGet(request("GET"), h.dependencies);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true); assert.equal(body.merchantId, ownerId); assert.equal(body.profile.merchantName, "Owner business");
  assert.equal(h.calls.peers, 1); assert.equal(h.calls.load, 1); assert.equal(h.calls.save, 0);
});

test("GET denies an unrelated merchant without loading the target snapshot", async () => {
  const h = harness({ owner: peerId, linked: false });
  const response = await handleMerchantChatBusinessCardGet(request("GET"), h.dependencies);
  assert.equal(response.status, 401); assert.equal(h.calls.peers, 1); assert.equal(h.calls.load, 0); assert.equal(h.calls.save, 0);
});

test("both methods deny an anonymous request before peer or snapshot access", async () => {
  for (const method of ["GET", "POST"] as const) {
    const h = harness({ linked: true });
    const handle = method === "GET" ? handleMerchantChatBusinessCardGet : handleMerchantChatBusinessCardPost;
    const response = await handle(request(method), h.dependencies);
    assert.equal(response.status, 401); assert.equal(h.calls.peers, 0); assert.equal(h.calls.load, 0); assert.equal(h.calls.save, 0);
  }
});

test("legacy owner tokens still require the existing staff-identity guard before owner lookup", async () => {
  const h = harness({ legacyOwner: ownerId });
  const response = await handleMerchantChatBusinessCardPost(request("POST"), h.dependencies);
  assert.equal(response.status, 200);
  assert.equal(h.calls.auth, 1); assert.equal(h.calls.staffGuard, 1); assert.ok(h.calls.merchantLookup > 0);
  assert.equal(h.calls.load, 1); assert.equal(h.calls.save, 1); assert.equal(h.calls.peers, 0);
});

test("staff tokens cannot gain owner or peer access through legacy merchant aliases", async () => {
  for (const method of ["GET", "POST"] as const) {
    const h = harness({ legacyOwner: ownerId, staff: true, linked: true });
    const handle = method === "GET" ? handleMerchantChatBusinessCardGet : handleMerchantChatBusinessCardPost;
    const response = await handle(request(method), h.dependencies);
    assert.equal(response.status, 401);
    assert.equal(h.calls.staffGuard, 1); assert.equal(h.calls.merchantLookup, 0); assert.equal(h.calls.peers, 0);
    assert.equal(h.calls.load, 0); assert.equal(h.calls.save, 0);
  }
});

test("legacy owner of a different merchant may read its peer but cannot edit it", async () => {
  const get = harness({ legacyOwner: peerId, linked: true });
  assert.equal((await handleMerchantChatBusinessCardGet(request("GET"), get.dependencies)).status, 200);
  assert.equal(get.calls.peers, 1); assert.equal(get.calls.load, 1);
  const post = harness({ legacyOwner: peerId, linked: true });
  assert.equal((await handleMerchantChatBusinessCardPost(request("POST"), post.dependencies)).status, 401);
  assert.equal(post.calls.peers, 0); assert.equal(post.calls.load, 0); assert.equal(post.calls.save, 0);
});

test("cross-origin POST is rejected before creating a service client or authenticating", async () => {
  const h = harness({ superAdmin: true });
  const response = await handleMerchantChatBusinessCardPost(request("POST", ownerId, "https://other.example.invalid"), h.dependencies);
  assert.equal(response.status, 403);
  assert.equal(h.calls.client, 0); assert.equal(h.calls.superAdmin, 0); assert.equal(h.calls.load, 0); assert.equal(h.calls.save, 0);
});

test("malformed target identifiers cannot be used as a snapshot scope", async () => {
  const h = harness({ superAdmin: true });
  const response = await handleMerchantChatBusinessCardPost(request("POST", "__platform_merchant_snapshot__"), h.dependencies);
  assert.equal(response.status, 400); assert.equal(h.calls.superAdmin, 0); assert.equal(h.calls.load, 0); assert.equal(h.calls.save, 0);
});

test("CAS conflict remains a refusal, not a second load-and-save of a stale card", async () => {
  const h = harness({ owner: ownerId });
  h.dependencies.saveSnapshot = async () => { h.calls.save++; return { error: "platform_merchant_snapshot_conflict", code: "conflict" }; };
  const response = await handleMerchantChatBusinessCardPost(request("POST"), h.dependencies);
  assert.equal(response.status, 409); assert.equal(h.calls.load, 1); assert.equal(h.calls.save, 1);
});
