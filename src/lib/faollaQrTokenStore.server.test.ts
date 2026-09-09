import assert from "node:assert/strict";
import test from "node:test";
import {
  FaollaQrTokenStoreError,
  loadFaollaQrTokenEntry,
  mutateFaollaQrTokenEntry,
  type FaollaQrTokenStoreClient,
} from "./faollaQrTokenStore.server";

function readClient(blocks: unknown) {
  const calls: unknown[][] = [];
  const query = {
    select(...args: unknown[]) { calls.push(["select", ...args]); return query; },
    is(...args: unknown[]) { calls.push(["is", ...args]); return query; },
    eq(...args: unknown[]) { calls.push(["eq", ...args]); return query; },
    limit(...args: unknown[]) { calls.push(["limit", ...args]); return query; },
    async maybeSingle() { return { data: { blocks }, error: null }; },
  };
  return {
    calls,
    client: {
      from(table: string) { calls.push(["from", table]); return query; },
      rpc() { throw new Error("read_must_not_write"); },
    } as unknown as FaollaQrTokenStoreClient,
  };
}

test("QR reads preserve previously issued tokens and strictly scope the system page", async () => {
  const { client, calls } = readClient({ entries: {
    "merchant:12345678": { token: "old-issued-token", updatedAt: "2026-08-30T00:00:00.000Z" },
    "personal:12345678": { token: "personal-issued-token" },
  } });
  assert.deepEqual(await loadFaollaQrTokenEntry(client, "merchant", "12345678"), {
    token: "old-issued-token", updatedAt: "2026-08-30T00:00:00.000Z",
  });
  assert.deepEqual(calls, [
    ["from", "pages"], ["select", "blocks"], ["is", "merchant_id", null],
    ["eq", "slug", "__faolla_qr_tokens__"], ["limit", 1],
  ]);
  assert.deepEqual(await loadFaollaQrTokenEntry(client, "personal", "12345678"), {
    token: "personal-issued-token", updatedAt: "1970-01-01T00:00:00.000Z",
  });
  assert.equal(await loadFaollaQrTokenEntry(client, "merchant", "87654321"), null);
});

test("QR mutation sends a command, never a token or a stale JSON document", async () => {
  const expected = { token: "database-winner", updatedAt: "2026-09-08T10:00:00.000Z" };
  const client = {
    from() { throw new Error("unsafe_direct_table_write"); },
    async rpc(name: string, args: unknown) {
      assert.equal(name, "faolla_mutate_qr_token_v1");
      assert.deepEqual(args, { p_account_type: "personal", p_account_id: "12345678", p_action: "ensure" });
      return { data: expected, error: null };
    },
  } as unknown as FaollaQrTokenStoreClient;
  assert.deepEqual(await mutateFaollaQrTokenEntry(client, "personal", "12345678", "ensure"), expected);
});

for (const code of ["PGRST202", "42883", "42501"]) {
  test(`QR mutation fails closed when atomic RPC is unavailable (${code})`, async () => {
    const client = {
      from() { throw new Error("unsafe_direct_table_fallback"); },
      async rpc() { return { data: null, error: { code, message: "internal database detail" } }; },
    } as unknown as FaollaQrTokenStoreClient;
    await assert.rejects(mutateFaollaQrTokenEntry(client, "merchant", "12345678", "reset"),
      (error: unknown) => error instanceof FaollaQrTokenStoreError && error.code === "qr_token_store_unavailable");
  });
}

test("QR database conflicts and failed writes are not reported as success or retried unsafely", async () => {
  let writes = 0;
  const client = {
    from() { throw new Error("unsafe_direct_table_fallback"); },
    async rpc() { writes += 1; return { data: null, error: { code: "40001" } }; },
  } as unknown as FaollaQrTokenStoreClient;
  await assert.rejects(mutateFaollaQrTokenEntry(client, "merchant", "12345678", "reset"),
    { message: "qr_token_save_failed" });
  assert.equal(writes, 1);
});

test("QR mutation rejects malformed success results", async () => {
  for (const data of [null, {}, [], { token: "" }, { token: 123 }]) {
    const client = { async rpc() { return { data, error: null }; } } as unknown as FaollaQrTokenStoreClient;
    await assert.rejects(mutateFaollaQrTokenEntry(client, "merchant", "12345678", "ensure"),
      { message: "qr_token_save_failed" });
  }
});
