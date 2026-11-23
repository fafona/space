import assert from "node:assert/strict";
import test from "node:test";
import { parsePersonalCheckoutEntryHint } from "./merchantCheckoutRecordEntry";
test("entry hints stay with the current personal account and do not accept malformed/foreign/oversized sites", () => {
  const hint = { accountId: "50010105", siteIds: ["10909095"] };
  assert.deepEqual(parsePersonalCheckoutEntryHint(hint, "50010105"), hint.siteIds);
  for (const value of [undefined, { ...hint, accountId: "50010106" }, { ...hint, siteIds: ["10909095", "10909095"] }, { ...hint, siteIds: ["not-a-site"] }, { ...hint, siteIds: Array(51).fill("10909095") }]) assert.deepEqual(parsePersonalCheckoutEntryHint(value, "50010105"), []);
  assert.deepEqual(parsePersonalCheckoutEntryHint(hint, undefined), []);
});
