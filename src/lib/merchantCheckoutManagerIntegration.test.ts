import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { checkoutManagerResourcePages, parseCheckoutManagerAccess } from "./merchantCheckoutManagerIntegration";

test("rendered keys are partitioned into complete bounded groups without silently truncating or inventing a payment", () => {
  const records = Array.from({ length: 121 }, (_, i) => ({ kind: "booking" as const, id: `B${i}` }));
  const pages = checkoutManagerResourcePages([...records, records[0], { kind: "order", id: "B0" }, { kind: "booking", id: "历史/记录" }]);
  assert.deepEqual(pages.map(p => p.length), [50, 50, 22]); assert.deepEqual(pages.flat(), [...records, { kind: "order", id: "B0" }]);
  assert.deepEqual(checkoutManagerResourcePages([]), []);
  assert.throws(() => checkoutManagerResourcePages(Array(1001).fill(records[0])), /checkout_reporting_invalid/);
});
test("manager visibility never trusts browser flags, private fields or a foreign owner's resource scope", () => {
  const siteId = "10909095", key = "a".repeat(64);
  assert.equal(parseCheckoutManagerAccess({ ok: true, access: null }, siteId), null);
  assert.equal(parseCheckoutManagerAccess({ ok: true, access: { siteId, identityKey: key, private: "not used" } }, siteId), key);
  for (const payload of [null, {}, { ok: false, access: null }, { ok: true, access: {} }, { ok: true, access: { siteId: "10909096", identityKey: key } }, { ok: true, access: { siteId, identityKey: "owner:guess" } }]) {
    assert.throws(() => parseCheckoutManagerAccess(payload, siteId), /checkout_reporting_unavailable/);
  }
});
test("all four real managers pass rendered keys and revision; employee views remain explicitly separated from financial access", () => {
  for (const name of ["MerchantBookingManagerDialog", "MerchantBookingMobilePanel", "MerchantOrderManagerDialog", "MerchantOrderMobilePanel"]) {
    const source = readFileSync(new URL(`../components/admin/${name}.tsx`, import.meta.url), "utf8");
    assert.match(source, /<MerchantCheckoutManagerIntegration/);
    assert.match(source, /resources=\{renderedRecords\.map/); assert.match(source, /r\.updatedAt, r\.status/);
    if (name.endsWith("ManagerDialog")) assert.match(source, /employeeMode=\{employeeMode\}/);
  }
  const source = readFileSync(new URL("../app/me/page.tsx", import.meta.url), "utf8");
  assert.equal([...source.matchAll(/\{renderPersonalCheckoutEntry\((booking|order), "(booking|order)"\)\}/g)].length, 4);
  assert.match(source, /record\.customerAccountId === accountId/); assert.match(source, /personalCheckoutEntries\?\.accountId === accountId/);
});
