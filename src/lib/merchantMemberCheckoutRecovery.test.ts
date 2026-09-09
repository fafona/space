import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createMemberCheckoutRecoveryController, memberCheckoutRecoveryError, memberOperationUsesProductCheckout, readMemberScopedKeyword, type MemberProductCheckoutRequest } from "./merchantMemberCheckoutRecovery";
import type { MerchantRedemptionCheckoutReceipt, MerchantRedemptionCheckoutSummary } from "./merchantRedemptionCheckout";
import type { MerchantBusinessApiClient } from "./merchantBusinessApiClient";

const receipt: MerchantRedemptionCheckoutReceipt = {
  version: 1, operationId: "original-operation", siteId: "10000000", membershipId: "internal-member-id", transactionId: "transaction-one",
  createdAt: "2026-09-08T10:00:00.000Z", beforePointBalance: 100, afterPointBalance: 20,
  totalQuantity: 1, grossPoints: 80, couponPointDiscountTotal: 0, totalPoints: 80, couponCount: 0, note: "Original note",
  lines: [{ code: "one", name: "Original product", categoryName: "Category", quantity: 1, unitPoints: 80,
    subtotalPoints: 80, couponDiscountLabel: "", couponPointDiscount: 0 }],
};
const pending: MerchantRedemptionCheckoutSummary = { operationId: receipt.operationId, status: "pending", createdAt: receipt.createdAt, acknowledgedAt: null, result: null };
const committed: MerchantRedemptionCheckoutSummary = { ...pending, status: "committed", result: receipt };
const product: MemberProductCheckoutRequest = { action: "member_operation", type: "redeem", siteId: receipt.siteId,
  membershipId: "redacted-list-id", redemptionItemId: "product-one", redemptionQuantity: 1, points: 80, balanceAmount: 0, note: "Original note", rechargePlanId: "" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function setup(initial: MerchantRedemptionCheckoutSummary | null = null) {
  let checkout = initial ? structuredClone(initial) : null;
  let writes = 0;
  let nextId = 0;
  const calls: { path: string; method: string; body: Record<string, unknown> | null; signal: AbortSignal | null | undefined }[] = [];
  let override: ((path: string, init: RequestInit) => Promise<Response> | Response | undefined) | null = null;
  const requestApi: MerchantBusinessApiClient = async (path, init = {}) => {
    const body = typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null;
    calls.push({ path, method: init.method || "GET", body, signal: init.signal });
    const overridden = override?.(path, init);
    if (overridden) return overridden;
    if (init.method === "GET") return json({ ok: true, checkout });
    if (path === "/api/memberships") {
      writes += 1;
      checkout = { ...committed, operationId: String(body?.operationId), result: { ...receipt, operationId: String(body?.operationId) } };
      return json({ ok: true, membership: { id: "different-projection-id", email: "must-not-merge@example.invalid" }, receipt: checkout.result, replayed: false });
    }
    if (body?.action === "retry") {
      writes += 1; checkout = structuredClone(committed);
      return json({ ok: true, membership: null, receipt, replayed: true });
    }
    if (body?.action === "cancel") { checkout = { ...pending, status: "cancelled" }; return json({ ok: true, checkout }); }
    if (body?.action === "ack") {
      const acknowledged = checkout ? { ...checkout, acknowledgedAt: "2026-09-08T11:00:00.000Z" } : null;
      checkout = null; return json({ ok: true, checkout: acknowledged });
    }
    throw new Error("Unexpected test request");
  };
  const controller = createMemberCheckoutRecoveryController({ siteId: receipt.siteId, enabled: true, requestApi, createOperationId: () => `test-operation-${++nextId}` });
  return { controller, calls, requestApi, writes: () => writes, setCheckout: (next: MerchantRedemptionCheckoutSummary | null) => { checkout = next; },
    override: (next: typeof override) => { override = next; } };
}

test("only a selected catalog redemption enters recovery, never recharge or manual deductions", () => {
  assert.equal(memberOperationUsesProductCheckout("redeem", "product-one"), true);
  assert.equal(memberOperationUsesProductCheckout("redeem", ""), false);
  assert.equal(memberOperationUsesProductCheckout("redeem", "  "), false);
  assert.equal(memberOperationUsesProductCheckout("recharge", "product-one"), false);
});

test("scope changes drop both visible and deferred member search keywords before a new identity request", () => {
  const oldScope = {}; const newScope = {};
  assert.equal(readMemberScopedKeyword(newScope, oldScope, "old-person@example.invalid"), "");
  const newInput = { scope: newScope, keyword: readMemberScopedKeyword(newScope, oldScope, "old-person@example.invalid") };
  assert.equal(readMemberScopedKeyword(newScope, newInput.scope, newInput.keyword), "");
  assert.equal(readMemberScopedKeyword(newScope, newScope, "new-person@example.invalid"), "new-person@example.invalid");
});
test("mount is fail-closed, reads current operator and never mutates pending or completed results", async () => {
  for (const checkout of [pending, committed, { ...pending, status: "cancelled" as const }]) {
    const app = setup(checkout);
    assert.equal(app.controller.blocksNewSale(), true);
    await app.controller.activate();
    assert.equal(app.controller.blocksNewSale(), true);
    assert.equal(app.writes(), 0);
    assert.equal(app.calls.length, 1);
    assert.deepEqual(app.controller.getSnapshot().checkout, checkout);
    assert.equal(await app.controller.submitOriginal(product), null);
    app.controller.deactivate();
  }
});

test("GET failure and malformed response never become empty checkout", async () => {
  for (const value of [{ ok: true }, { ok: false, checkout: null }, { ok: true, checkout: { ...pending, status: "committed" } }]) {
    const app = setup(); app.override(() => json(value)); await app.controller.activate();
    assert.equal(app.controller.getSnapshot().phase, "error"); assert.equal(app.controller.blocksNewSale(), true);
  }
});

test("new product checkout preflights before PATCH and requires explicit ACK; response membership is never exposed", async () => {
  const app = setup(); await app.controller.activate();
  const result = await app.controller.submitOriginal(product);
  assert.equal(result?.receipt.totalPoints, 80); assert.equal(result?.receipt.membershipId, "internal-member-id");
  assert.deepEqual(Object.keys(result ?? {}).sort(), ["receipt", "replayed"]);
  assert.deepEqual(app.calls.map((entry) => entry.method), ["GET", "GET", "PATCH"]);
  assert.equal(app.calls[2].body?.membershipId, "redacted-list-id");
  assert.equal(app.controller.blocksNewSale(), true);
  await app.controller.submitOriginal({ ...product, redemptionQuantity: 2 }); assert.equal(app.writes(), 1);
  await app.controller.act("ack"); assert.equal(app.controller.blocksNewSale(), false);
  await app.controller.submitOriginal(product); assert.equal(app.writes(), 2);
  assert.notEqual(app.calls.filter((entry) => entry.method === "PATCH")[0].body?.operationId, app.calls.filter((entry) => entry.method === "PATCH")[1].body?.operationId);
});

test("preflight takes a synchronous mutex, preventing double-click GETs and duplicate writes", async () => {
  const app = setup(); await app.controller.activate();
  const wait = deferred<Response>(); app.override((_path, init) => init.method === "GET" ? wait.promise : undefined);
  const first = app.controller.submitOriginal(product);
  const second = app.controller.submitOriginal(product);
  assert.equal(await second, null); assert.equal(app.calls.length, 2);
  wait.resolve(json({ ok: true, checkout: null })); await first;
  assert.equal(app.writes(), 1);
});

test("an original checkout found during preflight blocks the new request without allocating a new write", async () => {
  const app = setup(); await app.controller.activate(); app.setCheckout(committed);
  assert.equal(await app.controller.submitOriginal(product), null);
  assert.equal(app.writes(), 0); assert.equal(app.controller.getSnapshot().checkout?.operationId, receipt.operationId);
});

test("retry sends only original operation and works without selected member, current stock or balance", async () => {
  const app = setup(pending); await app.controller.activate();
  const result = await app.controller.act("retry");
  assert.deepEqual(app.calls[1].body, { siteId: receipt.siteId, operationId: receipt.operationId, action: "retry" });
  assert.equal(result?.receipt.afterPointBalance, 20); assert.equal(result?.replayed, true);
  assert.equal(app.controller.blocksNewSale(), true); assert.equal(app.calls.some((entry) => entry.body?.action === "ack"), false);
});

test("initial response loss recovers committed result once and clears the old unknown warning", async () => {
  const app = setup(); await app.controller.activate();
  let actualWrites = 0;
  app.override((path, init) => {
    if (path !== "/api/memberships") return undefined;
    actualWrites += 1;
    const body = JSON.parse(String(init.body)) as { operationId: string };
    app.setCheckout({ ...committed, operationId: body.operationId, result: { ...receipt, operationId: body.operationId } });
    return json({ ok: false, message: "merchant_transaction_unavailable" }, 503);
  });
  await app.controller.submitOriginal(product);
  assert.equal(actualWrites, 1); assert.equal(app.controller.getSnapshot().checkout?.status, "committed");
  assert.equal(app.controller.getSnapshot().error, ""); assert.equal(app.controller.blocksNewSale(), true);
  await app.controller.submitOriginal({ ...product, membershipId: "other-member" }); assert.equal(actualWrites, 1);
});

test("retry response loss recovers original receipt without a second retry or automatic acknowledgement", async () => {
  const app = setup(pending); await app.controller.activate();
  app.override((_path, init) => {
    if (init.method !== "POST") return undefined;
    app.setCheckout(committed); return json({ ok: false, message: "merchant_transaction_unavailable" }, 503);
  });
  await app.controller.act("retry");
  assert.equal(app.controller.getSnapshot().checkout?.result?.totalPoints, 80); assert.equal(app.controller.getSnapshot().error, "");
  assert.equal(app.calls.filter((entry) => entry.method === "POST").length, 1);
});

test("null recovery after unknown failure remains blocked even on another GET; no new operation may bypass it", async () => {
  const app = setup(); await app.controller.activate();
  app.override((path) => path === "/api/memberships" ? json({ ok: false, message: "merchant_transaction_unavailable" }, 503) : undefined);
  await app.controller.submitOriginal(product); await app.controller.refresh();
  assert.equal(app.controller.getSnapshot().phase, "error"); assert.equal(app.controller.blocksNewSale(), true);
  assert.match(app.controller.getSnapshot().error, /不能据此认定请求未发送/);
  await app.controller.submitOriginal({ ...product, note: "changed" });
  assert.equal(app.calls.filter((entry) => entry.method === "PATCH").length, 1);
});

test("quote change stays pending and visible until explicit cancel and acknowledgement", async () => {
  const app = setup(pending); await app.controller.activate();
  app.override((_path, init) => init.method === "POST" && String(init.body).includes('"retry"') ? json({ ok: false, message: "redemption_checkout_quote_changed" }, 409) : undefined);
  await app.controller.act("retry");
  assert.equal(app.controller.getSnapshot().checkout?.status, "pending"); assert.match(app.controller.getSnapshot().error, /价格或规则已变化/);
  await app.controller.act("cancel"); assert.equal(app.controller.getSnapshot().checkout?.status, "cancelled"); assert.equal(app.controller.blocksNewSale(), true);
  await app.controller.act("ack"); assert.equal(app.controller.blocksNewSale(), false);
});

test("only an explicit first-request pre-stage rejection plus both empty GETs permits a corrected new attempt", async () => {
  for (const message of ["membership_balance_insufficient", "membership_redemption_stock_insufficient", "membership_redemption_quantity_invalid"]) {
    for (const errorBody of [{ ok: false, message }, { error: message, message }]) {
    const app = setup(); await app.controller.activate();
    app.override((path) => path === "/api/memberships" ? json(errorBody, 409) : undefined);
    await app.controller.submitOriginal(product);
    assert.equal(app.controller.blocksNewSale(), false); assert.match(app.controller.getSnapshot().notice, /服务器已拒绝/);
    const getPaths = app.calls.filter((entry) => entry.method === "GET").map((entry) => entry.path);
    assert.ok(getPaths.some((path) => path.includes("operationId=test-operation-1")));
    app.override(null); await app.controller.submitOriginal({ ...product, redemptionQuantity: 2 });
    assert.equal(app.writes(), 1); assert.equal(app.calls.at(-1)?.body?.operationId, "test-operation-2");
    }
  }
});

test("a pre-stage code cannot release an actual pending original or an existing pending retry", async () => {
  const app = setup(); await app.controller.activate();
  app.override((path, init) => {
    if (path !== "/api/memberships") return undefined;
    const body = JSON.parse(String(init.body)) as { operationId: string };
    app.setCheckout({ ...pending, operationId: body.operationId });
    return json({ ok: false, message: "membership_balance_insufficient" }, 409);
  });
  await app.controller.submitOriginal(product); assert.equal(app.controller.blocksNewSale(), true);
  const existing = setup(pending); await existing.controller.activate();
  existing.override((_path, init) => init.method === "POST" ? json({ ok: false, message: "membership_balance_insufficient" }, 409) : undefined);
  await existing.controller.act("retry"); assert.equal(existing.controller.getSnapshot().checkout?.status, "pending");
  assert.equal(existing.controller.blocksNewSale(), true);
});

test("503, network errors, malformed response, other 4xx and unchecked GETs never qualify as known rejection", async () => {
  const failures = [
    () => json({ ok: false, message: "membership_balance_insufficient" }, 503),
    () => { throw new Error("membership_balance_insufficient"); },
    () => json({ ok: true, message: "membership_balance_insufficient" }, 409),
    () => json({ ok: true, error: "membership_balance_insufficient", message: "membership_balance_insufficient" }, 409),
    () => json({ error: "different_code", message: "membership_balance_insufficient" }, 409),
    () => json({ ok: false, error: "different_code", message: "membership_balance_insufficient" }, 409),
    () => json({ error: "membership_balance_insufficient", message: "membership_balance_insufficient" }, 200),
    () => json({ ok: false, message: "other_business_error" }, 400),
  ];
  for (const failure of failures) {
    const app = setup(); await app.controller.activate(); app.override((path) => path === "/api/memberships" ? failure() : undefined);
    await app.controller.submitOriginal(product); assert.equal(app.controller.blocksNewSale(), true);
  }
  const app = setup(); await app.controller.activate();
  app.override((path) => path === "/api/memberships" ? json({ ok: false, message: "membership_redemption_stock_insufficient" }, 409)
    : path.includes("operationId=") ? json({ ok: false, message: "merchant_transaction_unavailable" }, 503) : undefined);
  await app.controller.submitOriginal(product); assert.equal(app.controller.blocksNewSale(), true);
  assert.match(memberCheckoutRecoveryError("redemption_pending_checkout_exists"), /等待处理或确认/);
});

test("first-request rejection evidence cannot release a later pending retry with unknown outcome", async () => {
  const app = setup(); await app.controller.activate();
  app.override((path, init) => {
    if (path === "/api/memberships") {
      const body = JSON.parse(String(init.body)) as { operationId: string };
      app.setCheckout({ ...pending, operationId: body.operationId });
      return json({ error: "membership_balance_insufficient", message: "membership_balance_insufficient" }, 409);
    }
    if (init.method === "POST") {
      app.setCheckout(null);
      return json({ error: "merchant_transaction_unavailable", message: "merchant_transaction_unavailable" }, 503);
    }
    return undefined;
  });
  await app.controller.submitOriginal(product); assert.equal(app.controller.getSnapshot().checkout?.status, "pending");
  await app.controller.act("retry");
  assert.equal(app.controller.getSnapshot().phase, "error"); assert.equal(app.controller.blocksNewSale(), true);
  assert.match(app.controller.getSnapshot().error, /不能据此认定请求未发送/);
});

test("cancel racing with commit reports completed and never claims to reverse the original transaction", async () => {
  const app = setup(pending); await app.controller.activate();
  app.override((_path, init) => init.method === "POST" ? json({ ok: true, checkout: committed }) : undefined);
  await app.controller.act("cancel");
  assert.equal(app.controller.getSnapshot().checkout?.status, "committed"); assert.match(app.controller.getSnapshot().notice, /未取消、未撤销/);
  assert.equal(app.controller.blocksNewSale(), true);
});

test("ACK null, wrong operation, pending or missing acknowledgement never releases the checkout", async () => {
  for (const checkout of [null, { ...committed, operationId: "wrong-operation", result: { ...receipt, operationId: "wrong-operation" } }, pending, committed]) {
    const app = setup(committed); await app.controller.activate();
    app.override((_path, init) => init.method === "POST" ? json({ ok: true, checkout }) : undefined);
    await app.controller.act("ack"); assert.equal(app.controller.blocksNewSale(), true);
    assert.equal(app.controller.getSnapshot().checkout?.operationId, committed.operationId);
  }
});

test("switching scope or unmount aborts and ignores delayed GET and mutation responses", async () => {
  for (const mutation of [false, true]) {
    const app = setup(); await app.controller.activate();
    const wait = deferred<Response>();
    app.override((path, init) => (mutation ? path === "/api/memberships" : init.method === "GET") ? wait.promise : undefined);
    const inflight = mutation ? app.controller.submitOriginal(product) : app.controller.refresh();
    if (mutation) { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await new Promise<void>((resolve) => setImmediate(resolve)); }
    app.controller.deactivate();
    assert.equal(app.calls.at(-1)?.signal?.aborted, true);
    wait.resolve(json(mutation ? { ok: true, membership: null, receipt: { ...receipt, operationId: "test-operation-1" }, replayed: false } : { ok: true, checkout: committed }));
    await inflight;
    assert.equal(app.controller.getSnapshot().checkout, null); assert.equal(app.controller.isActive(), false);
  }
});

test("revoked permission does not read or write and a new mount rediscovers the server original", async () => {
  const app = setup(committed);
  const revoked = createMemberCheckoutRecoveryController({ siteId: receipt.siteId, enabled: false, requestApi: app.requestApi });
  await revoked.activate(); await revoked.act("ack"); await revoked.submitOriginal(product); assert.equal(app.calls.length, 0);
  await app.controller.activate(); app.controller.deactivate();
  const remounted = createMemberCheckoutRecoveryController({ siteId: receipt.siteId, enabled: true, requestApi: app.requestApi });
  await remounted.activate(); assert.deepEqual(remounted.getSnapshot().checkout, committed); assert.equal(remounted.blocksNewSale(), true);
});

const memberSource = readFileSync(new URL("../components/admin/MerchantMemberManager.tsx", import.meta.url), "utf8");
test("member component keeps product recovery separate from manual/recharge and reloads its own permission projection", () => {
  const productBranch = memberSource.slice(memberSource.indexOf("if (isProductCheckout && selectedRedemptionItem)"), memberSource.indexOf("const operationFingerprint ="));
  assert.match(productBranch, /productCheckoutController\.submitOriginal/);
  assert.doesNotMatch(productBranch, /payload\.membership|receipt\.membershipId|memberOperationMutationRef|act\("ack"\)/);
  assert.match(memberSource, /void loadMemberships\("reset", true\)/);
  assert.match(memberSource, /void loadMemberSettings\(true\)/);
  assert.match(memberSource, /if \(!isCurrentMemberScope\(\)\) return;/);
  assert.match(memberSource, /visibleMemberScope !== memberScope/);
  assert.match(memberSource, /memberPermissionKey/);
  assert.match(memberSource, /readMemberScopedKeyword\(memberScope, visibleMemberScope, keyword\)/);
  assert.match(memberSource, /readMemberScopedKeyword\(memberScope, deferredMemberSearch\.scope, deferredMemberSearch\.keyword\)/);
  assert.match(memberSource, /init\.signal\?\.addEventListener\("abort", abortFromCaller/);
});

test("recovery never persists identity/cart/receipt or prints, and visible/focus handlers are cleaned up", () => {
  const controller = readFileSync(new URL("./merchantMemberCheckoutRecovery.ts", import.meta.url), "utf8");
  const hook = readFileSync(new URL("../components/admin/useMerchantMemberCheckoutRecovery.ts", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../components/admin/MerchantCheckoutRecoveryPanel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(controller + hook + panel, /localStorage|sessionStorage|indexedDB|document\.cookie|printReceipt|window\.print/);
  assert.match(hook, /controller\.deactivate\(\)/); assert.match(hook, /removeEventListener\("focus"/); assert.match(hook, /removeEventListener\("visibilitychange"/);
  assert.match(panel, /确认并开始下一单/); assert.doesNotMatch(panel, /membershipId|memberNo|email/);
});
