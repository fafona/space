import assert from "node:assert/strict";
import test from "node:test";
import { getAccountSwitchHomeHref } from "./accountSwitching";

test("getAccountSwitchHomeHref sends personal accounts to the personal home", () => {
  assert.equal(getAccountSwitchHomeHref({ accountType: "personal", accountId: "12345678" }), "/me");
});

test("getAccountSwitchHomeHref sends merchant accounts to the existing admin route", () => {
  assert.equal(
    getAccountSwitchHomeHref({
      accountType: "merchant",
      accountId: "12345678",
      merchantId: "87654321",
      merchantIds: ["87654321"],
    }),
    "/admin",
  );
});
