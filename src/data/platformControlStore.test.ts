import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultMerchantPermissionConfig } from "./platformControlStore";

test("merchant permission config includes default business card background image limit", () => {
  const permission = createDefaultMerchantPermissionConfig();
  assert.equal(permission.businessCardBackgroundImageLimitKb, 200);
  assert.equal(permission.businessCardContactImageLimitKb, 200);
  assert.equal(permission.commonBlockImageLimitKb, 300);
  assert.equal(permission.galleryBlockImageLimitKb, 300);
  assert.equal(permission.allowBookingEmailPrefill, false);
});
