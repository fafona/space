import assert from "node:assert/strict";
import test from "node:test";
import { handleFaollaQrTokenGet, handleFaollaQrTokenPost } from "./faollaQrTokenRoute.server";
import { FaollaQrTokenStoreError, type FaollaQrTokenStoreClient } from "./faollaQrTokenStore.server";

const unusedClient = {} as FaollaQrTokenStoreClient;
const authorized = async () => true;
function get(id = "12345678", query = "ensure=1") {
  return new Request(`https://faolla.com/api/faolla-qr-token?type=merchant&id=${id}&${query}`);
}
function post(id = "12345678") {
  return new Request("https://faolla.com/api/faolla-qr-token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "merchant", id, action: "reset" }),
  });
}

test("QR ensure uses the token returned by the atomic database operation without a stale pre-read", async () => {
  const response = await handleFaollaQrTokenGet(get(), {
    client: () => unusedClient, authorized,
    load: async () => { throw new Error("stale_pre_read_forbidden"); },
    mutate: async (_client, type, id, action) => {
      assert.deepEqual([type, id, action], ["merchant", "12345678", "ensure"]);
      return { token: "db-current-token", updatedAt: "now" };
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true, token: "db-current-token", updatedAt: "now" });
});

test("QR validation remains public/read-only and preserves old links until reset", async () => {
  for (const [supplied, valid] of [["old-issued-token", true], ["revoked-token", false], ["", false]] as const) {
    const response = await handleFaollaQrTokenGet(get("12345678", `mode=validate&ensure=1&token=${supplied}`), {
      client: () => unusedClient,
      authorized: async () => { throw new Error("validation_does_not_require_owner_login"); },
      load: async () => ({ token: "old-issued-token", updatedAt: "legacy" }),
      mutate: async () => { throw new Error("public_validation_must_never_write"); },
    });
    assert.deepEqual(await response.json(), { ok: true, valid });
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("QR unauthorized ensure and reset cannot access or mutate the store", async () => {
  const deps = {
    authorized: async () => false,
    client: () => { throw new Error("store_access_before_authorization"); },
  };
  assert.equal((await handleFaollaQrTokenGet(get(), deps)).status, 401);
  assert.equal((await handleFaollaQrTokenPost(post(), deps)).status, 401);
});

test("QR missing migration returns 503 without fallback or internal error disclosure", async () => {
  const deps = {
    client: () => unusedClient, authorized,
    load: async () => { throw new Error("unsafe_fallback_read"); },
    mutate: async () => { throw new FaollaQrTokenStoreError("qr_token_store_unavailable"); },
  };
  for (const response of [await handleFaollaQrTokenGet(get(), deps), await handleFaollaQrTokenPost(post(), deps)]) {
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "qr_token_store_unavailable" });
  }
});

test("QR reset rejects a failed atomic write and does not return an uncommitted token", async () => {
  const response = await handleFaollaQrTokenPost(post(), {
    client: () => unusedClient, authorized,
    mutate: async () => { throw new Error("sensitive database exception"); },
  });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "qr_token_save_failed" });
});

test("QR plain owner read preserves a missing token without creating it", async () => {
  const response = await handleFaollaQrTokenGet(get("12345678", ""), {
    client: () => unusedClient, authorized, load: async () => null,
    mutate: async () => { throw new Error("unexpected_mutation"); },
  });
  assert.deepEqual(await response.json(), { ok: true, token: "", updatedAt: "" });
});

test("QR concurrent requests use independent atomic commands and return database winners", async () => {
  const saved = new Map<string, { token: string; updatedAt: string }>();
  let sequence = 0;
  // This models only the RPC contract. Actual PostgreSQL row-lock and
  // first-insert races are covered by scripts/qr-token-integration.
  const client = {
    from() { throw new Error("unsafe_snapshot_write"); },
    async rpc(_name: string, args: Record<string, string>) {
      await Promise.resolve();
      const key = `${args.p_account_type}:${args.p_account_id}`;
      let entry = saved.get(key);
      if (!entry || args.p_action === "reset") {
        entry = { token: `token-${++sequence}`, updatedAt: "now" };
        saved.set(key, entry);
      }
      return { data: entry, error: null };
    },
  } as unknown as FaollaQrTokenStoreClient;
  const deps = { client: () => client, authorized };
  const ensured = await Promise.all([handleFaollaQrTokenGet(get(), deps), handleFaollaQrTokenGet(get(), deps)]);
  const ensuredBodies = await Promise.all(ensured.map((response) => response.json()));
  assert.equal(ensuredBodies[0].token, ensuredBodies[1].token);
  assert.equal(sequence, 1);
  const previous = ensuredBodies[0].token;
  const responses = await Promise.all([
    handleFaollaQrTokenPost(post("12345678"), deps),
    handleFaollaQrTokenPost(post("87654321"), deps),
  ]);
  const bodies = await Promise.all(responses.map((response) => response.json()));
  assert.equal(saved.get("merchant:12345678")?.token, bodies[0].token);
  assert.equal(saved.get("merchant:87654321")?.token, bodies[1].token);
  assert.notEqual(bodies[0].token, previous);
  const resets = await Promise.all([handleFaollaQrTokenPost(post(), deps), handleFaollaQrTokenPost(post(), deps)]);
  const resetBodies = await Promise.all(resets.map((response) => response.json()));
  assert.notEqual(resetBodies[0].token, resetBodies[1].token);
  const latest = saved.get("merchant:12345678")?.token;
  const afterReset = await handleFaollaQrTokenGet(get(), deps);
  assert.equal((await afterReset.json()).token, latest);
  assert.notEqual(latest, previous);
});
