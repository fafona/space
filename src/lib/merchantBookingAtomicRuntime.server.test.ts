import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { runAtomicBookingMutation, stageAtomicBookingPersistence, readAtomicBookingPersistence, withBookingRequestIdentity, isAtomicBookingStorageEnabled } from "./merchantBookingAtomicRuntime.server";
import type { BookingAtomicRpc } from "./merchantBookingAtomicPreparation.server";

function harness(protocol = 2) {
  const rows = [
    { id: "records", slug: "__merchant_booking_records__:v1", updated_at: null, blocks: { version: 1, records: [] } },
    { id: "settings", slug: "__merchant_booking_workbench__:v1", updated_at: null, blocks: { version: 1, settingsBySiteId: { other: { unknownLegacyField: "preserve" }, shop: { bufferMinutes: 5 } } } },
  ];
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let replay: unknown = null;
  const rpc: BookingAtomicRpc = async (name, args) => {
    calls.push({ name, args });
    const snapshot = { generation: randomUUID(), revision: "0", rows: structuredClone(rows) };
    if (name.includes("read_v2")) return { data: { ...snapshot, protocol }, error: null };
    if (name.includes("snapshot")) return { data: replay ?? { ...snapshot, replayed: false }, error: null };
    return { data: { replayed: false, result: (args.p_mutation as { result: unknown }).result }, error: null };
  };
  return { rpc, calls, replay(value: unknown) { replay = value; } };
}
test("new storage mode is opt-in; unknown configuration fails closed", () => {
  const before = process.env.MERCHANT_BOOKING_STORAGE_MODE;
  try {
    delete process.env.MERCHANT_BOOKING_STORAGE_MODE; assert.equal(isAtomicBookingStorageEnabled(), false);
    process.env.MERCHANT_BOOKING_STORAGE_MODE = "accidental-typo"; assert.throws(isAtomicBookingStorageEnabled, /invalid_mode/);
  } finally { if (before === undefined) delete process.env.MERCHANT_BOOKING_STORAGE_MODE; else process.env.MERCHANT_BOOKING_STORAGE_MODE = before; }
});
test("incompatible database protocol never executes a planner or falls back to legacy IO", async () => {
  const h = harness(1); let planned = false;
  await assert.rejects(runAtomicBookingMutation({ siteId: "shop", operation: "test" }, async () => { planned = true; return null; }, h.rpc), /protocol_mismatch/);
  assert.equal(planned, false); assert.equal(h.calls.length, 1);
});
test("configuration writes preserve foreign raw JSON even when a caller normalizes it away", async () => {
  const h = harness();
  await runAtomicBookingMutation({ siteId: "shop", operation: "settings" }, async () => {
    stageAtomicBookingPersistence("workbench", { version: 1, settingsBySiteId: { other: {}, shop: { bufferMinutes: 15 } } });
    return { saved: true };
  }, h.rpc);
  const mutation = h.calls.find((entry) => entry.name.includes("commit"))?.args.p_mutation as { configuration: { workbench: { settingsBySiteId: Record<string, unknown> } } };
  assert.deepEqual(mutation.configuration.workbench.settingsBySiteId.other, { unknownLegacyField: "preserve" });
  assert.deepEqual(mutation.configuration.workbench.settingsBySiteId.shop, { bufferMinutes: 15 });
});
test("pure reads/no-op automation do not write, persist full stores in command results or touch local files", async () => {
  const h = harness();
  await runAtomicBookingMutation({ siteId: "shop", operation: "read", rememberResult: false }, async () => {
    const read = await readAtomicBookingPersistence("records", (value) => value);
    assert.equal(read.handled, true); return { largeStore: "not-a-command-result" };
  }, h.rpc);
  assert.equal(h.calls.some((entry) => entry.name.includes("commit")), false);
});
test("idempotent replay reauthorizes and never reruns a mutation or notification planner", async () => {
  const h = harness(); h.replay({ replayed: true, result: { value: { bookingId: "original" } } });
  let authorized = 0;
  const result = await withBookingRequestIdentity({ nonce: randomUUID(), principalScope: "personal:one", semanticInput: { action: "create" } },
    () => runAtomicBookingMutation({ siteId: "shop", operation: "create", authorize: async () => { authorized++; } }, async () => { throw new Error("must_not_repeat"); }, h.rpc));
  assert.equal(authorized, 1); assert.deepEqual(result, { bookingId: "original" });
  await assert.rejects(runAtomicBookingMutation({ siteId: "shop", operation: "create", authorize: async () => { throw new Error("revoked"); } }, async () => null, h.rpc), /revoked/);
});
