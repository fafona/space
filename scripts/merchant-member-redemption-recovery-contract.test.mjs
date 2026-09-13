import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Static wiring guardrails, complementary to the behavioral API/service/UI
// suites. They do not execute a checkout or connect to a database.
function source(relativePath) {
  const text = readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return ts.createSourceFile(relativePath, text, ts.ScriptTarget.Latest, true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}
function findNode(root, predicate) {
  if (predicate(root)) return root;
  let found;
  ts.forEachChild(root, (child) => { if (!found) found = findNode(child, predicate); });
  return found;
}
function functionBody(root, name) {
  const node = findNode(root, (candidate) => ts.isFunctionDeclaration(candidate) && candidate.name?.text === name);
  assert.ok(node?.body, `missing function ${name}`);
  return node.body;
}
function text(node) { return node.getText(); }
function ifBranch(root, expression) {
  const node = findNode(root, (candidate) => ts.isIfStatement(candidate) && text(candidate.expression) === expression);
  assert.ok(node, `missing branch ${expression}`);
  return node.thenStatement;
}
function methodBody(root, name) {
  const node = findNode(root, (candidate) => ts.isMethodDeclaration(candidate) && text(candidate.name) === name);
  assert.ok(node?.body, `missing method ${name}`);
  return node.body;
}

const service = source("src/lib/merchantMemberships.server.ts");
const route = source("src/app/api/memberships/route-handler.ts");
const recovery = source("src/app/api/merchant-admin/redemption-checkout/route-handler.ts");
const cashier = source("src/components/admin/MerchantPointRedemptionCashier.tsx");
const memberManager = source("src/components/admin/MerchantMemberManager.tsx");
const memberRecovery = source("src/lib/merchantMemberCheckoutRecovery.ts");
const recoveryHook = source("src/components/admin/useMerchantMemberCheckoutRecovery.ts");
const recoveryPanel = source("src/components/admin/MerchantCheckoutRecoveryPanel.tsx");

test("membership-only legacy service refuses product checkout before taking the legacy mutation lock", () => {
  const publicBody = text(functionBody(service, "applyMerchantMembershipAccountOperation"));
  const privateBody = text(functionBody(service, "applyMerchantMembershipAccountOperationUnlocked"));
  for (const body of [publicBody, privateBody]) {
    assert.match(body, /throw new Error\("redemption_checkout_context_required"\)/);
    assert.doesNotMatch(body, /applyMerchantMembershipRedemptionCart\(/);
  }
  assert.ok(publicBody.indexOf('"redemption_checkout_context_required"') < publicBody.indexOf("withMerchantMembershipMutationLock("));
  assert.match(publicBody, /applyMerchantMembershipAccountOperationUnlocked\(\{ \.\.\.input, siteId \}\)/);
  assert.match(publicBody, /input\.assertAuthorizationCurrent/);
});

test("legacy selected-product PATCH delegates to the checkout service and never forwards client prices or operator", () => {
  const patch = functionBody(route, "handleMerchantMembershipsPatch");
  const product = text(ifBranch(patch, "memberItemCheckout"));
  assert.match(text(patch), /action === "member_operation" && operationType === "redeem" && hasRedemptionItem/);
  assert.match(product, /membership_redemption_item_invalid/);
  assert.match(product, /dependencies\.applyRedemptionCheckout\(/);
  assert.match(product, /items: \[\{ redemptionItemId: body\.redemptionItemId\.trim\(\), quantity: body\.redemptionQuantity \}\]/);
  assert.match(product, /operatorId: merchantSession\.operatorId/);
  assert.match(product, /operationId: body\.operationId/);
  assert.match(product, /assertAuthorizationCurrent: merchantSession\.assertAuthorizationCurrent/);
  assert.doesNotMatch(product, /applyAccountOperation\(|points: body\.|balanceAmount: body\.|operatorId: body\./);
  assert.ok(product.indexOf("await merchantSession.assertAuthorizationCurrent()") > product.indexOf("applyRedemptionCheckout("));
  assert.ok(product.indexOf("await merchantSession.assertAuthorizationCurrent()") < product.indexOf("return checkoutResultResponse("));
});

test("both checkout PATCH entry points preserve the authoritative receipt and nullable member without other history", () => {
  const patch = functionBody(route, "handleMerchantMembershipsPatch");
  const product = text(ifBranch(patch, "memberItemCheckout"));
  const cart = text(ifBranch(patch, 'action === "member_redemption_checkout" && merchantSession'));
  for (const body of [product, cart]) assert.match(body, /return checkoutResultResponse\(result, merchantSession\)/);
  const result = text(functionBody(route, "checkoutResultResponse"));
  assert.match(result, /membership: result\.membership \? redactMembershipMutationResult\(/);
  assert.match(result, /transactions: \[\], insight: undefined/);
  assert.match(result, /\) : null/);
  assert.match(result, /receipt: result\.receipt/);
  assert.match(result, /replayed: result\.replayed/);
  assert.doesNotMatch(result, /throw|membership_not_found/);
});

test("checkout PATCH and recovery errors share the exact safe mapper rather than raw storage errors", () => {
  const checkoutCatch = text(ifBranch(functionBody(route, "handleMerchantMembershipsPatch"), "checkoutRequest"));
  assert.match(checkoutCatch, /readMerchantRedemptionCheckoutError\(error\)/);
  assert.match(checkoutCatch, /error: code, message: code/);
  assert.doesNotMatch(checkoutCatch, /error\.message|String\(error\)/);
  assert.match(text(functionBody(recovery, "errorResponse")), /readMerchantRedemptionCheckoutError\(error\)/);
});

test("recovery stays actor-scoped checkout access, with current permission redaction rather than member-account access", () => {
  const get = text(functionBody(recovery, "handleMerchantRedemptionCheckoutGet"));
  const post = text(functionBody(recovery, "handleMerchantRedemptionCheckoutPost"));
  for (const body of [get, post]) {
    assert.match(body, /requiredPermission: "redemptions\.checkout"/);
    assert.match(body, /actor\.principalKey/);
    assert.doesNotMatch(body, /"members\.account\.view"|operatorId: body\./);
  }
  assert.match(post, /currentActor = await dependencies\.reauthorizeActor/);
  assert.match(post, /currentActor\.businessPermissions\.includes\("redemptions\.customer_data\.view"\)/);
  assert.match(post, /transactions: \[\], insight: undefined/);
  assert.match(text(functionBody(route, "resolveMembershipAdminSession")), /session\.actor = await authorizationDependencies\.reauthorizeActor/);
});

test("non-product account operations and cashier recharge retain their existing financial entry point", () => {
  const legacy = text(ifBranch(functionBody(route, "handleMerchantMembershipsPatch"), 'action === "member_operation" && merchantSession'));
  assert.match(legacy, /dependencies\.applyAccountOperation\(/);
  assert.match(legacy, /type: operationType/);
  assert.match(legacy, /points: body\?\.points/);
  assert.match(legacy, /balanceAmount: body\?\.balanceAmount/);
  const recharge = text(functionBody(cashier, "submitRechargePlan"));
  assert.match(recharge, /action: "member_operation"/);
  assert.match(recharge, /type: "recharge"/);
  assert.doesNotMatch(recharge, /action: "member_redemption_checkout"/);
});

test("member product submission uses the recovery controller and never merges cashier member data or acknowledges automatically", () => {
  const submit = functionBody(memberManager, "submitMemberOperation");
  const product = text(ifBranch(submit, "isProductCheckout && selectedRedemptionItem"));
  assert.match(text(submit), /productCheckoutController\.blocksNewSale\(\)/);
  assert.match(product, /await productCheckoutController\.submitOriginal\(/);
  assert.match(product, /return;/);
  assert.doesNotMatch(product, /requestMemberApi\(|setMemberships\(|\.membership|\.act\("ack"\)|window\.print|printReceipt/);
  assert.match(text(memberManager), /visibleMemberScope !== memberScope/);
  assert.match(text(memberManager), /setMemberships\(\[\]\); setMemberSettings\(null\); setSelectedMembershipId\(""\)/);
  assert.match(text(memberManager), /memberOperationMutationRef\.current = \{ fingerprint: "", operationId: "" \}/);
});

test("restoring an original member checkout sends only site, original operation and action, without local balance or cart guards", () => {
  const act = text(methodBody(memberRecovery, "act"));
  assert.match(act, /"\/api\/merchant-admin\/redemption-checkout"/);
  assert.match(act, /JSON\.stringify\(\{ siteId: options\.siteId, operationId: checkout\.operationId, action \}\)/);
  assert.doesNotMatch(act, /\/api\/memberships|redemptionItemId|membershipId|pointBalance|balanceAmount|createOperationId|submitOriginal/);
  assert.match(act, /if \(!result \|\| !result\.acknowledgedAt \|\| result\.status === "pending"\) throw new Error\("redemption_checkout_response_invalid"\)/);
  assert.match(act, /result\.operationId !== checkout\.operationId/);
  assert.match(text(recoveryPanel), /onClick=\{\(\) => onAction\("ack"\)\}/);
});

test("the member controller locks before preflight, validates authoritative receipts and keeps unknown outcomes blocked", () => {
  const submit = text(methodBody(memberRecovery, "submitOriginal"));
  assert.ok(submit.indexOf("mutationBusy = true") < submit.indexOf("await read(ticket)"));
  assert.ok(submit.indexOf("await read(ticket)") < submit.indexOf("createClientMutationOperationId("));
  const controller = text(functionBody(memberRecovery, "createMemberCheckoutRecoveryController"));
  assert.match(controller, /readCashierCheckoutReceipt\(data\.receipt, options\.siteId, operationId\)/);
  assert.match(controller, /if \(!checkout && uncertainOperationId\)/);
  assert.match(controller, /publish\(\{ phase: "error", checkout: null/);
  assert.match(controller, /current\(ticket\)/);
  assert.doesNotMatch(controller, /localStorage|sessionStorage|indexedDB|data\.membership|payload\.membership/);
});

test("scope changes invalidate the member controller and focus recovery performs reads, never automatic confirmation or printing", () => {
  const hook = text(functionBody(recoveryHook, "useMerchantMemberCheckoutRecovery"));
  assert.match(hook, /\[siteId, enabled, requestApi, scope\]/);
  assert.match(hook, /controller\.activate\(\)/);
  assert.match(hook, /controller\.deactivate\(\)/);
  assert.match(hook, /window\.addEventListener\("focus", refresh\)/);
  assert.match(hook, /document\.addEventListener\("visibilitychange", refresh\)/);
  assert.doesNotMatch(hook, /\.act\(|\.submitOriginal\(|\.print\(/);
  const deactivate = text(methodBody(memberRecovery, "deactivate"));
  assert.match(deactivate, /active = false; epoch \+= 1; sequence \+= 1/);
  assert.match(deactivate, /request\.abort\(\)/);
  assert.match(deactivate, /snapshot = initial\(\); attempt = null; uncertainOperationId = ""; failedMutation = null/);
});
