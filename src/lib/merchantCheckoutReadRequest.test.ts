import assert from "node:assert/strict";
import test from "node:test";
import { isTrustedCheckoutReadRequest } from "./merchantCheckoutReadRequest";
test("private checkout reads accept same-origin no-referrer browsers without allowing ambiguous or contradictory cross-origin reads", () => {
  const origin = "https://launch.faolla.com", check = (headers: HeadersInit) => isTrustedCheckoutReadRequest(new Request(origin + "/api/member-checkout/resource", { headers }));
  assert.equal(check({ origin }), true); assert.equal(check({ referer: origin + "/me" }), true);
  assert.equal(check({ origin, referer: origin + "/me", "sec-fetch-site": "same-origin" }), true);
  assert.equal(check({ "sec-fetch-site": "same-origin" }), true);
  const denied: HeadersInit[] = [{}, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }, { origin: "https://foreign.invalid" }, { referer: "https://foreign.invalid/me", "sec-fetch-site": "same-origin" },
    { origin, referer: "https://foreign.invalid/me" }, { origin, "sec-fetch-site": "cross-site" }, { origin, referer: "" }];
  for (const headers of denied) assert.equal(check(headers), false);
  assert.equal(isTrustedCheckoutReadRequest(new Request(origin, { method: "POST", headers: { origin } })), false);
});
