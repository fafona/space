import assert from "node:assert/strict";
import test from "node:test";
import { createMemberRedemptionHarnessService, MEMBER_HARNESS_SITE, type HarnessActor } from "./syntheticService";

type Service = ReturnType<typeof createMemberRedemptionHarnessService>;
const CHECKOUT = `/api/merchant-admin/redemption-checkout?siteId=${MEMBER_HARNESS_SITE}`;
async function read(service: Service, actor: HarnessActor = "employee-A", operationId?: string) {
  const response = await service.request(actor, `${CHECKOUT}${operationId ? `&operationId=${operationId}` : ""}`);
  return { status: response.status, data: await response.json() };
}
async function action(service: Service, action: string, operationId = "original-employee-A", actor: HarnessActor = "employee-A") {
  const response = await service.request(actor, "/api/merchant-admin/redemption-checkout", { method: "POST",
    body: JSON.stringify({ siteId: MEMBER_HARNESS_SITE, action, operationId }) });
  return { status: response.status, data: await response.json() };
}
function newCheckout(service: Service, actor: HarnessActor = "employee-A") {
  return service.request(actor, "/api/memberships", { method: "PATCH", body: JSON.stringify({
    siteId: MEMBER_HARNESS_SITE, membershipId: `member-${actor}`, action: "member_operation", type: "redeem",
    redemptionItemId: "gift-one", redemptionQuantity: 1, points: 20, operationId: "new-operation", note: "合成新单",
  }) });
}

test("pending is authoritative, retry commits once, and acknowledge retains explicit old receipt", async () => {
  const service = createMemberRedemptionHarnessService();
  assert.equal((await read(service)).data.checkout.status, "pending");
  const first = await action(service, "retry");
  assert.equal(first.data.receipt.totalPoints, 80);
  assert.equal(first.data.replayed, false);
  assert.equal((await action(service, "retry")).data.replayed, true);
  assert.equal(service.snapshot().actors["employee-A"].writes, 1);
  await action(service, "ack");
  assert.equal((await read(service)).data.checkout, null);
  assert.deepEqual((await read(service, "employee-A", "original-employee-A")).data.checkout.result, first.data.receipt);
});

test("lost first response survives a new client closure and never duplicates the financial write", async () => {
  const service = createMemberRedemptionHarnessService();
  service.reset("employee-A", "first-response-lost");
  assert.equal((await newCheckout(service)).status, 503);
  const remountedClient = (path: string) => service.request("employee-A", path);
  const recovered = await (await remountedClient(CHECKOUT)).json();
  assert.equal(recovered.checkout.operationId, "new-operation");
  assert.equal(recovered.checkout.result.afterPointBalance, 80);
  assert.equal((await newCheckout(service)).status, 200);
  assert.equal(service.snapshot().actors["employee-A"].writes, 1);
});

test("lost retry response is recoverable and read failures never masquerade as an empty slot", async () => {
  const service = createMemberRedemptionHarnessService();
  service.reset("employee-A", "retry-response-lost");
  assert.equal((await action(service, "retry")).status, 503);
  assert.equal((await read(service)).data.checkout.status, "committed");
  assert.equal(service.snapshot().actors["employee-A"].writes, 1);
  service.reset("employee-A", "read-error");
  assert.equal((await read(service)).status, 503);
  assert.equal(service.snapshot().actors["employee-A"].writes, 0);
  service.recoverReads("employee-A");
  assert.equal((await read(service)).data.checkout.status, "pending");
});

test("quote change preserves pending until explicit cancellation and acknowledgement", async () => {
  const service = createMemberRedemptionHarnessService();
  service.reset("employee-A", "quote-changed");
  assert.equal((await action(service, "retry")).data.message, "redemption_checkout_quote_changed");
  assert.equal((await read(service)).data.checkout.status, "pending");
  assert.equal((await action(service, "ack")).status, 409);
  assert.equal((await action(service, "cancel")).data.checkout.status, "cancelled");
  await action(service, "ack");
  assert.equal((await read(service)).data.checkout, null);
  const response = await (await newCheckout(service)).json();
  assert.equal(response.receipt.totalPoints, 40);
  assert.equal(service.snapshot().actors["employee-A"].writes, 1);
});

test("both synthetic race outcomes preserve the winning terminal state", async () => {
  const service = createMemberRedemptionHarnessService();
  service.reset("employee-A", "cancel-wins");
  assert.equal((await action(service, "retry")).data.message, "redemption_checkout_cancelled");
  assert.equal((await read(service)).data.checkout.status, "cancelled");
  assert.equal(service.snapshot().actors["employee-A"].writes, 0);
  service.reset("employee-A", "commit-wins");
  const result = await action(service, "cancel");
  assert.equal(result.data.checkout.status, "committed");
  assert.equal(result.data.checkout.result.totalPoints, 80);
  assert.equal((await action(service, "cancel")).data.checkout.status, "committed");
  assert.equal(service.snapshot().actors["employee-A"].writes, 1);
});

test("actor changes, permission revocation and deleted members do not expose or recreate a different receipt", async () => {
  const service = createMemberRedemptionHarnessService();
  assert.equal((await read(service, "employee-B")).data.checkout, null);
  assert.equal((await action(service, "retry", "original-employee-A", "employee-B")).status, 404);
  service.allowCheckout("employee-A", false);
  assert.equal((await read(service)).status, 403);
  assert.equal((await action(service, "retry")).status, 403);
  service.allowCheckout("employee-A", true);
  assert.equal((await read(service)).data.checkout.status, "pending");
  service.reset("owner", "committed");
  assert.equal((await read(service, "owner")).data.checkout.result.membershipId, "member-owner");
  service.reset("employee-A", "deleted-member");
  const list = await (await service.request("employee-A", `/api/memberships?siteId=${MEMBER_HARNESS_SITE}`)).json();
  assert.deepEqual(list.memberships, []);
  const replay = await action(service, "retry");
  assert.equal(replay.data.membership, null);
  assert.equal(replay.data.receipt.membershipId, "member-employee-A");
  assert.equal(service.snapshot().actors["employee-A"].writes, 1);
});

test("delayed old-actor response remains tagged as old state without touching the new actor", async () => {
  const service = createMemberRedemptionHarnessService();
  service.reset("employee-A", "delayed");
  const oldRead = read(service);
  assert.equal((await read(service, "employee-B")).data.checkout, null);
  assert.equal((await oldRead).data.checkout.operationId, "original-employee-A");
  assert.equal(service.snapshot().actors["employee-B"].checkout, null);
});

test("all unknown or external requests fail in memory; no real-network fallback", async () => {
  const service = createMemberRedemptionHarnessService();
  assert.equal((await service.request("owner", "https://example.com/api/memberships?siteId=10000000")).status, 404);
  assert.equal((await service.request("owner", "/api/unknown?siteId=10000000")).status, 404);
  assert.equal((await service.request("owner", "/api/memberships?siteId=99999999")).status, 400);
  assert.equal(service.snapshot().actors.owner.writes, 0);
});
