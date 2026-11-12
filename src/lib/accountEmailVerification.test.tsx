import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {readFile} from "node:fs/promises";
import {getAccountEmailVerificationStatus} from "./accountEmailVerification";
import {confirmSuperAdminAccountEmail, type AccountEmailVerificationResult} from "./superAdminAccountEmailVerificationClient";
import {AccountEmailVerificationStatus, VerifyAccountEmailButton} from "@/components/admin/AccountEmailVerification";

const target = {authUserId: "10000000-0000-4000-8000-000000000001", accountId: "10909096", accountType: "merchant" as const, email: "pending@example.invalid"};
const verified: AccountEmailVerificationResult = {...target, emailConfirmed: true, emailVerificationKnown: true, emailConfirmedAt: "2026-11-12T15:00:00Z"};
test("unverified, verified and unavailable are distinct from website/service state", () => {
  assert.equal(getAccountEmailVerificationStatus(null), "unknown");
  for (const [account, status, label, button] of [
    [{...target, emailConfirmed: false, emailVerificationKnown: true}, "unverified", "未验证", true],
    [{...target, emailConfirmed: true, emailVerificationKnown: true}, "verified", "已验证", false],
    [{...target, emailConfirmed: false, emailVerificationKnown: false}, "unknown", "验证状态待核验", false],
  ] as const) {
    assert.equal(getAccountEmailVerificationStatus(account), status);
    const html = renderToStaticMarkup(<><AccountEmailVerificationStatus account={account}/><VerifyAccountEmailButton account={account} busy={false} onVerify={()=>{}}/></>);
    assert(html.includes(label)); assert.equal(html.includes("验证账号"), button);
  }
});
test("cancelled manual confirmation sends nothing; accepted confirmation submits only the exact whitelist", async () => {
  assert.equal(await confirmSuperAdminAccountEmail(target, {confirm: ()=>false, request: async()=>assert.fail("must not request")}), null);
  const result = await confirmSuperAdminAccountEmail({...target, password: "must-not-send", profileSnapshot: {private: true}} as typeof target, {
    confirm: message => {assert(message.includes(target.email)); assert(message.includes("不会修改密码")); return true;},
    request: async(url, init) => {
      assert.equal(url, "/api/super-admin/merchant-accounts"); assert.equal(init.method, "POST");
      assert.deepEqual(JSON.parse(String(init.body)), {action: "verify_email", ...target, confirmed: true});
      return Response.json({verification: verified});
    },
  }); assert.equal(result?.verification.emailConfirmed, true);
});
test("an outage, wrong returned identity or missing authoritative timestamp cannot flip the client status", async () => {
  for (const [body, status] of [[{message: "请刷新状态"}, 503], [{verification: {...verified, authUserId: "wrong"}}, 200],
    [{verification: {...verified, emailConfirmedAt: ""}}, 200], [{verification: {...verified, email: null}}, 200]] as const) {
    await assert.rejects(confirmSuperAdminAccountEmail(target, {confirm: ()=>true, request: async()=>Response.json(body, {status})}));
  }
});
test("both merchant and personal lists/details use the guarded verification action without modifying signup/login OTP flows", async () => {
  const source = await readFile(new URL("../app/super-admin/SuperAdminClient.tsx", import.meta.url), "utf8");
  assert.equal(source.split("<VerifyAccountEmailButton ").length - 1, 4);
  const action = source.slice(source.indexOf("async function verifyAccountEmailAction("), source.indexOf("function buildAccountDeleteTargetFromMerchantRow("));
  assert(action.includes('guard("user.manage"')); assert(action.includes("accountEmailVerificationBusyRef.current"));
  assert(action.indexOf("confirmSuperAdminAccountEmail(") < action.indexOf("setBackendMerchantAccounts("));
  assert(action.includes('recordAuditBestEffort("account_email_verify"')); assert(!action.includes("createUser("));
});
