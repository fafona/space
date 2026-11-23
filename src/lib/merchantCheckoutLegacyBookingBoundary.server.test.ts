import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { runAtomicBookingMutation, stageAtomicBookingPersistence, withBookingRequestIdentity } from "./merchantBookingAtomicRuntime.server";
import type { BookingAtomicRpc } from "./merchantBookingAtomicPreparation.server";
import { bookingRpcWithCheckoutIntent } from "./merchantCheckoutLegacyBookingBoundary.server";
import { createMerchantBooking } from "./merchantBookings.server";

const siteId = "10909994";
async function withIntent<T>(task: () => Promise<T>) {
  const keys = ["MERCHANT_MEMBER_CHECKOUT_PILOT_SITES", "MERCHANT_MEMBER_CHECKOUT_CART_PILOT_SITES", "MERCHANT_MEMBER_CHECKOUT_CART_UI_PILOT_SITES", "MERCHANT_MEMBER_CHECKOUT_INTENT_PILOT_SITES"];
  const before = keys.map(key => process.env[key]);
  try { keys.forEach(key => { process.env[key] = siteId; }); return await task(); }
  finally { keys.forEach((key, i) => { if (before[i] === undefined) delete process.env[key]; else process.env[key] = before[i]; }); }
}
function fixture(code: string | null = "checkout_original_pending") {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const rpc: BookingAtomicRpc = async (name, args) => {
    calls.push({ name, args });
    if (name === "faolla_booking_atomic_read_v2" || name === "faolla_booking_atomic_snapshot_v1") return { data: { protocol: 2, replayed: false, generation: randomUUID(), revision: "0", rows: [{ id: "synthetic", slug: "__merchant_booking_records__:v1", updated_at: null, blocks: { version: 1, records: [] } }] }, error: null };
    if (name === "faolla_checkout_legacy_booking_commit_v1" && code) return { data: null, error: { message: code } };
    assert.ok(["faolla_booking_atomic_commit_v1", "faolla_checkout_legacy_booking_commit_v1"].includes(name)); return { data: { replayed: false, result: (args.p_mutation as { result: unknown }).result }, error: null };
  };
  const create = () => withBookingRequestIdentity({ nonce: randomUUID(), principalScope: "personal:59000001", semanticInput: { siteId, customerAccountId: "59000001", customerUserId: "synthetic-user" } },
    () => runAtomicBookingMutation({ siteId, operation: "createMerchantBooking" }, async () => { stageAtomicBookingPersistence("records", { version: 1, records: [{ id: "synthetic-booking", siteId, customerAccountId: "59000001", customerUserId: "synthetic-user" }] }); return { bookingId: "synthetic-booking" }; }, rpc));
  return { calls, create, rpc };
}
test("actual atomic booking runtime cannot create another ordinary booking past an enrolled original", async () => withIntent(async () => {
  const x = fixture(); await assert.rejects(x.create(), /checkout_original_pending/);
  assert.equal(x.calls.filter(c => c.name === "faolla_checkout_legacy_booking_commit_v1").length, 1);
  assert.equal(x.calls.filter(c => c.name === "faolla_booking_atomic_commit_v1").length, 0);
}));
test("pending/review/unknown booking refusals never use old CAS or retry the command", async () => withIntent(async () => {
  for (const code of ["checkout_original_pending", "checkout_intent_review_required", "checkout_create_unconfirmed", "PRIVATE SQL body"]) {
    const x = fixture(code); await assert.rejects(x.create(), new RegExp(code.startsWith("PRIVATE") ? "booking_atomic_storage_unconfirmed" : code));
    assert.equal(x.calls.filter(c => c.name.includes("commit")).length, 1);
  }
}));
test("gate off keeps the original booking command and gate on uses one original mutation with bounded deadline", async () => {
  const x = fixture(null); await x.create(); assert.equal(x.calls.at(-1)?.name, "faolla_booking_atomic_commit_v1");
  await withIntent(async () => { const y = fixture(null); assert.deepEqual(await y.create(), { bookingId: "synthetic-booking" });
    const last = y.calls.at(-1)!; assert.equal(last.name, "faolla_checkout_legacy_booking_commit_v1"); assert.ok(Date.parse(String(last.args.p_not_after)) <= Date.now() + 11_000); assert.ok(last.args.p_mutation); });
});
test("intent opt-in does not replace existing configuration commands", async () => withIntent(async () => {
  const x = fixture(null);
  await runAtomicBookingMutation({ siteId, operation: "saveWorkbench" }, async () => {
    stageAtomicBookingPersistence("workbench", { version: 1, settingsBySiteId: { [siteId]: { timeZone: "UTC" } } }); return { saved: true };
  }, x.rpc);
  assert.equal(x.calls.at(-1)?.name, "faolla_booking_atomic_commit_v1");
  assert.equal(x.calls.some(c => c.name === "faolla_checkout_legacy_booking_commit_v1"), false);
}));
test("expired planning cannot dispatch a late ordinary booking RPC or obtain a renewed budget", async () => {
  let called = 0; const rpc = bookingRpcWithCheckoutIntent(async () => { called++; throw Error("must not dispatch"); }, Date.now() - 12_000);
  for (const name of ["faolla_booking_atomic_snapshot_v1", "faolla_booking_atomic_commit_v1"]) assert.equal((await rpc(name, {})).error?.message, "checkout_create_unconfirmed");
  assert.equal(called, 0);
});
test("intent enabled cannot enter legacy booking file merge or direct email mode", async () => withIntent(async () => {
  const before = process.env.MERCHANT_BOOKING_STORAGE_MODE;
  try { process.env.MERCHANT_BOOKING_STORAGE_MODE = "legacy";
    await assert.rejects(createMerchantBooking({ siteId, store: "Synthetic", item: "Synthetic", appointmentAt: "2030-02-01T10:00", title: "Mx", customerName: "Synthetic", email: "synthetic@example.invalid", phone: "000", note: "" }), /checkout_unavailable/);
  } finally { if (before === undefined) delete process.env.MERCHANT_BOOKING_STORAGE_MODE; else process.env.MERCHANT_BOOKING_STORAGE_MODE = before; }
}));
