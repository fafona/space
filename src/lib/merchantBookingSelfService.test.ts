import assert from "node:assert/strict";
import test from "node:test";
import { buildMerchantBookingSelfServiceUrl, readMerchantBookingManageRedirect } from "./merchantBookingSelfService";

test("new management links use a device-independent route with credentials only in the fragment", () => {
  const url = new URL(buildMerchantBookingSelfServiceUrl("https://merchant.example.invalid/site/99999999", { id: "test-1", bookingBlockId: "desktop-only", bookingViewport: "desktop" }, "secret-token"));
  assert.equal(url.pathname, "/booking-manage");
  assert.equal(url.search, "");
  assert.equal(new URLSearchParams(url.hash.slice(1)).get("editToken"), "secret-token");
});

test("legacy hash and query links retain credentials when redirected without retaining viewport dependency", () => {
  for (const suffix of ["#bookingId=test-1&editToken=secret-token&bookingViewport=desktop", "?bookingId=test-1&editToken=secret-token&bookingBlockId=old"]) {
    assert.equal(readMerchantBookingManageRedirect(`https://merchant.example.invalid/${suffix}`), "/booking-manage#bookingId=test-1&editToken=secret-token");
  }
  assert.equal(readMerchantBookingManageRedirect("https://merchant.example.invalid/#bookingId=test-1"), "");
});
