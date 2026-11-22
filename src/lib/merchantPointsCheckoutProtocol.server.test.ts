import assert from "node:assert/strict";
import test from "node:test";
import { executePointsCheckout, pointsCheckoutIdentity, type PointsCheckoutIntent, type PointsCheckoutRpc,
  type PointsCheckoutReceipt, type PointsCheckoutIdentity } from "./merchantPointsCheckoutProtocol.server";
import type { CheckoutPrincipal } from "./merchantCheckoutQuote.server";

const principal: CheckoutPrincipal = { accountId: "50010105", userId: "synthetic-user-1001" };
const intent = (): PointsCheckoutIntent => ({ siteId: "10909095", nonce: "12345678-1234-4234-8234-123456789abc", resourceKind: "booking",
  selection: { offerId: "abcdefab-abcd-4abc-8abc-abcdefabcdef", offerRevision: "87654321-4321-4321-8321-cba987654321", quantity: 1, slotKey: "slot-test" } });
const receipt = (i: PointsCheckoutIdentity): PointsCheckoutReceipt => ({ version: 1, siteId: i.siteId, principalKey: i.principalKey,
  operationKey: i.operationKey, requestHash: i.requestHash, offerId: i.selection.offerId, offerRevision: i.selection.offerRevision,
  resourceKind: i.resourceKind, resourceId: "booking-synthetic-1", membershipId: "member-synthetic-1", transactionId: "transaction-synthetic-1", totalPoints: 500, status: "points_redeemed" });
function setup() {
  const original = intent(), identity = pointsCheckoutIdentity(original, principal), calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let authorizations = 0;
  const rpc: PointsCheckoutRpc = async (name, args) => {
    calls.push({ name, args: structuredClone(args) });
    return { error: null, data: name === "faolla_member_checkout_snapshot_v1"
      ? { replayed: false, snapshot: { protocol: 1, ...identity, revision: "revision-1", data: { synthetic: true } } }
      : { replayed: false, receipt: structuredClone(args.p_receipt) } };
  };
  const input: Parameters<typeof executePointsCheckout>[0] = { intent: original, principal, rpc, authorize: async (): Promise<CheckoutPrincipal | null> => { authorizations++; return principal; },
    plan: async (_snapshot: unknown, i: PointsCheckoutIdentity) => ({ receipt: receipt(i), mutation: { synthetic: true } }) };
  return { input, identity, calls, authorizations: () => authorizations };
}
test("proposed protocol sends one composite write request, never an old cashier or separate debit call", async () => {
  const f = setup(), result = await executePointsCheckout(f.input);
  assert.equal(result.receipt.totalPoints, 500); assert.equal(f.authorizations(), 3);
  assert.deepEqual(f.calls.map(x => x.name), ["faolla_member_checkout_snapshot_v1", "faolla_member_checkout_commit_v1"]);
  assert.equal(f.calls[1].args.p_operation_key, f.identity.operationKey);
  assert.equal(f.calls[1].args.p_request_hash, f.identity.requestHash);
});
test("idempotency is principal/site/nonce bound, while every choice changes the request fingerprint", () => {
  const i = intent(), first = pointsCheckoutIdentity(i, principal);
  for (const next of [{ ...i, selection: { ...i.selection, quantity: 2 } }, { ...i, selection: { ...i.selection, slotKey: "another-slot" } },
    { ...i, selection: { ...i.selection, offerRevision: i.nonce } }]) {
    const changed = pointsCheckoutIdentity(next, principal);
    assert.equal(changed.operationKey, first.operationKey); assert.notEqual(changed.requestHash, first.requestHash);
  }
  assert.notEqual(pointsCheckoutIdentity(i, { ...principal, accountId: "50010106" }).operationKey, first.operationKey);
  assert.notEqual(pointsCheckoutIdentity({ ...i, siteId: "10909096" }, principal).operationKey, first.operationKey);
});
test("a recovered receipt is authorized again and never deducts points a second time", async () => {
  const f = setup(); f.input.rpc = async (name, args) => {
    f.calls.push({ name, args }); return { error: null, data: { replayed: true, receipt: receipt(f.identity) } };
  };
  f.input.plan = async () => { throw new Error("must not plan a committed checkout"); };
  assert.equal((await executePointsCheckout(f.input)).replayed, true); assert.equal(f.calls.length, 1); assert.equal(f.authorizations(), 2);
});
test("cross-merchant or cross-principal replay cannot expose another customer's receipt", async () => {
  for (const patch of [{ siteId: "10909096" }, { principalKey: "account:50010106:other-user" }, { totalPoints: 0 }, { requestHash: "changed" }, { email: "private@example.invalid" }]) {
    const f = setup(); f.input.rpc = async () => ({ error: null, data: { replayed: true, receipt: { ...receipt(f.identity), ...patch } } });
    await assert.rejects(() => executePointsCheckout(f.input), /checkout_invalid_response/);
  }
});
test("only an explicit no-write conflict re-reads/replans, at most three times", async () => {
  const f = setup(), original = f.input.rpc; let writes = 0;
  f.input.rpc = async (name, args) => name.endsWith("commit_v1") && ++writes < 3
    ? { data: null, error: { code: "checkout_conflict" } } : original(name, args);
  assert.equal((await executePointsCheckout(f.input)).receipt.totalPoints, 500); assert.equal(writes, 3);
  const always = setup(); let count = 0;
  always.input.rpc = async (name, args) => { if (name.endsWith("commit_v1")) { count++; return { data: null, error: { code: "checkout_conflict" } }; } return original(name, args); };
  await assert.rejects(() => executePointsCheckout(always.input), /checkout_conflict/); assert.equal(count, 3);
});
test("lost/ambiguous commit responses do not retry, compensate, change nonce or fall back", async () => {
  for (const mode of ["throw", "bad_response", "unknown_error"] as const) {
    const f = setup(), original = f.input.rpc;
    f.input.rpc = async (name, args) => {
      if (name.endsWith("snapshot_v1")) return original(name, args);
      f.calls.push({ name, args });
      if (mode === "throw") throw new Error("private SQL connection body");
      return mode === "bad_response" ? { error: null, data: null } : { error: { code: "private_secret" }, data: null };
    };
    await assert.rejects(() => executePointsCheckout(f.input), { message: "checkout_unconfirmed" });
    assert.equal(f.calls.filter(x => x.name.endsWith("commit_v1")).length, 1);
    assert.equal(f.input.intent.nonce, intent().nonce);
  }
});
test("cancelled checkout and changed quote are terminal for this operation", async () => {
  for (const code of ["checkout_cancelled", "checkout_quote_changed", "checkout_operation_conflict"]) {
    const f = setup(); let reads = 0;
    f.input.rpc = async () => { reads++; return { data: null, error: { code } }; };
    await assert.rejects(() => executePointsCheckout(f.input), new RegExp(code)); assert.equal(reads, 1);
  }
});
test("a changed login or revoked authorization during planning cannot start a write", async () => {
  const f = setup(); let calls = 0;
  f.input.authorize = async () => ++calls === 1 ? principal : null;
  await assert.rejects(() => executePointsCheckout(f.input), /checkout_unauthorized/);
  assert.equal(f.calls.filter(x => x.name.endsWith("commit_v1")).length, 0);
});
test("an aborted slow plan cannot dispatch a late financial write", async () => {
  const f = setup(), abort = new AbortController(); let release!: () => void;
  const started = new Promise<void>(resolve => { f.input.plan = async (_s, i) => { resolve(); await new Promise<void>(done => { release = done; }); return { receipt: receipt(i), mutation: {} }; }; });
  const pending = executePointsCheckout({ ...f.input, signal: abort.signal });
  await started; abort.abort(); release();
  await assert.rejects(() => pending, /checkout_deadline_exceeded/);
  assert.equal(f.calls.filter(x => x.name.endsWith("commit_v1")).length, 0);
});
test("deadline is checked after async planning, not only before a request starts", async () => {
  const f = setup(); let time = 100;
  f.input.plan = async (_s, i) => { time = 201; return { receipt: receipt(i), mutation: {} }; };
  await assert.rejects(() => executePointsCheckout({ ...f.input, now: () => time, deadline: 200 }), /checkout_deadline_exceeded/);
  assert.equal(f.calls.filter(x => x.name.endsWith("commit_v1")).length, 0);
});
test("database JSON key order does not make a correct receipt look invalid", async () => {
  const f = setup(), original = f.input.rpc;
  f.input.rpc = async (name, args) => name.endsWith("snapshot_v1") ? original(name, args)
    : { error: null, data: { replayed: false, receipt: Object.fromEntries(Object.entries(args.p_receipt as object).reverse()) } };
  assert.equal((await executePointsCheckout(f.input)).receipt.totalPoints, 500);
});
test("identity change after a committed write hides the receipt and requires reconciliation", async () => {
  const f = setup(); let checks = 0;
  f.input.authorize = async () => ++checks < 3 ? principal : null;
  await assert.rejects(() => executePointsCheckout(f.input), /checkout_unconfirmed/);
  assert.equal(f.calls.filter(x => x.name.endsWith("commit_v1")).length, 1);
});
test("mutating the original intent while authentication waits cannot switch the charged offer", async () => {
  const f = setup(); let release!: () => void, begun!: () => void;
  const started = new Promise<void>(resolve => { begun = resolve; }); let calls = 0;
  f.input.authorize = async () => { if (++calls === 1) { begun(); await new Promise<void>(done => { release = done; }); } return principal; };
  const pending = executePointsCheckout(f.input); await started;
  f.input.intent.selection.quantity = 999; release();
  assert.equal((await pending).receipt.requestHash, f.identity.requestHash);
});

test("private planner/authentication errors are sanitized before a future HTTP caller can see them", async () => {
  const f = setup(); f.input.plan = async () => { throw new Error("SELECT member_email secret_connection_string"); };
  await assert.rejects(() => executePointsCheckout(f.input), { message: "checkout_unavailable" });
  assert.equal(f.calls.filter(x => x.name.endsWith("commit_v1")).length, 0);
});

test("a non-JSON planner value is rejected before any financial write", async () => {
  const f = setup();
  f.input.plan = async (_snapshot, i) => ({ receipt: receipt(i), mutation: { createdAt: new Date() } as never });
  await assert.rejects(() => executePointsCheckout(f.input), /checkout_invalid_plan/);
  assert.equal(f.calls.filter(x => x.name.endsWith("commit_v1")).length, 0);
});
