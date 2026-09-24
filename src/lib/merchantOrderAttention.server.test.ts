import assert from "node:assert/strict";
import test from "node:test";
import { readMerchantOrderAttentionSummary, type OrderAttentionRpcClient } from "./merchantOrderAttention.server";

const epoch = "fdd57d99-2d59-4c57-a307-888888888888";
const revision = { epoch, generation: "9007199254740993" };
const empty = { count: 0, latest: null };
function clientFor(results: Array<{ data: unknown; error?: unknown } | Error>) {
  const calls: { name: string; parameters: Record<string, unknown> }[] = [];
  const client: OrderAttentionRpcClient = { rpc: async (name, parameters) => {
    calls.push({ name, parameters });
    const result = results.shift();
    assert.ok(result, "unexpected extra RPC");
    if (result instanceof Error) throw result;
    return { data: result.data, error: result.error ?? null };
  } };
  return { client, calls };
}

test("a ready summary takes one bounded RPC, no full source read or write", async () => {
  const { client, calls } = clientFor([{ data: { state: "ready", ...revision, payload: empty } }]);
  assert.deepEqual(await readMerchantOrderAttentionSummary(client, "10000000"), empty);
  assert.deepEqual(calls, [{ name: "faolla_read_order_attention_v1", parameters: { p_site_id: "10000000", p_source: false } }]);
});

test("only an enabled deterministic source can publish, with the exact epoch and bigint string", async () => {
  const { client, calls } = clientFor([
    { data: { state: "source", ...revision, enabled: true, rows: [] } },
    { data: { state: "published", ...revision } },
  ]);
  assert.deepEqual(await readMerchantOrderAttentionSummary(client, "10000000"), empty);
  assert.deepEqual(calls[1], { name: "faolla_publish_order_attention_v1", parameters: {
    p_site_id: "10000000", p_epoch: epoch, p_generation: revision.generation, p_payload: empty,
  } });
});

test("disabled, unavailable, malformed or oversized source is unavailable, never zero", async () => {
  for (const data of [null, {}, { state: "disabled" }, { state: "unavailable" },
    { state: "ready", ...revision, payload: { count: 1, latest: null } },
    { state: "ready", ...revision, generation: 12, payload: empty },
    { state: "ready", ...revision, generation: "9223372036854775808", payload: empty },
    { state: "source", ...revision, enabled: false, rows: [] },
    { state: "source", ...revision, enabled: true, rows: null },
    { state: "source", ...revision, enabled: true, rows: Array(513).fill({}) },
  ]) {
    const { client, calls } = clientFor([{ data }]);
    assert.equal(await readMerchantOrderAttentionSummary(client, "10000000"), null);
    assert.equal(calls.length, 1);
  }
});

test("late, ambiguous, duplicate and wrong revision publication cannot report success or replay", async () => {
  for (const result of [
    { data: { state: "conflict" } }, { data: { state: "unavailable" } },
    { data: { state: "published", ...revision, generation: "2" } },
    { data: { state: "published", ...revision, epoch: "different" } },
    { data: null, error: { message: "private-db-diagnostic" } }, new Error("ambiguous transport"),
  ]) {
    const { client, calls } = clientFor([{ data: { state: "source", ...revision, enabled: true, rows: [] } }, result]);
    assert.equal(await readMerchantOrderAttentionSummary(client, "10000000"), null);
    assert.equal(calls.length, 2);
  }
});

test("foreign merchant and already aborted work perform no RPC", async () => {
  const { client, calls } = clientFor([]);
  assert.equal(await readMerchantOrderAttentionSummary(client, "20000000"), null);
  assert.equal(await readMerchantOrderAttentionSummary(client, "10000000", AbortSignal.abort()), null);
  assert.deepEqual(calls, []);
});

test("aborting after read or publication ignores late data and never publishes an aborted read", async () => {
  for (const abortAt of [1, 2]) {
    const controller = new AbortController();
    let calls = 0;
    const client: OrderAttentionRpcClient = { rpc: async () => {
      calls += 1;
      if (calls === abortAt) controller.abort();
      return { error: null, data: calls === 1
        ? { state: "source", ...revision, enabled: true, rows: [] }
        : { state: "published", ...revision } };
    } };
    assert.equal(await readMerchantOrderAttentionSummary(client, "10000000", controller.signal), null);
    assert.equal(calls, abortAt);
  }
});
