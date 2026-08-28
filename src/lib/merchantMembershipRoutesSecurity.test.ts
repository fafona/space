import assert from "node:assert/strict";
import test from "node:test";
import { GET as getRedemptionCashier } from "@/app/api/merchant-admin/redemption-cashier/route";
import {
  GET as getMemberships,
  PATCH as patchMemberships,
  POST as postMemberships,
} from "@/app/api/memberships/route";
import { PUT as putMembershipSettings } from "@/app/api/membership-settings/route";

function assertPrivateHeaders(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
}

test("membership private errors carry the complete response policy", async () => {
  const responses = await Promise.all([
    getMemberships(new Request("https://merchant.faolla.test/api/memberships?siteId=invalid")),
    getRedemptionCashier(
      new Request("https://merchant.faolla.test/api/merchant-admin/redemption-cashier?siteId=invalid"),
    ),
  ]);
  responses.forEach((response) => {
    assert.equal(response.status, 400);
    assertPrivateHeaders(response);
  });
});

test("membership mutations reject untrusted origins before parsing with private headers", async () => {
  const makeRequest = (path: string, method: string) =>
    new Request(`https://merchant.faolla.test${path}`, {
      method,
      headers: {
        host: "merchant.faolla.test",
        origin: "https://attacker.example",
        "content-type": "application/json",
      },
      body: "{not-json",
    });
  const responses = await Promise.all([
    patchMemberships(makeRequest("/api/memberships", "PATCH")),
    putMembershipSettings(makeRequest("/api/membership-settings", "PUT")),
  ]);
  responses.forEach((response) => {
    assert.equal(response.status, 403);
    assertPrivateHeaders(response);
  });
});

test("an explicit business header cannot enter membership personal mutations", async () => {
  for (const accessToken of ["", "invalid-employee-token"]) {
    const headers = {
      "content-type": "application/json",
      origin: "https://launch.faolla.com",
      "x-merchant-access-token": accessToken,
      cookie: "__Host-faolla-personal-auth-v2=forged-personal-cookie",
    };
    const responses = await Promise.all([
      postMemberships(
        new Request("https://launch.faolla.com/api/memberships", {
          method: "POST",
          headers,
          body: "{not-json",
        }),
      ),
      patchMemberships(
        new Request("https://launch.faolla.com/api/memberships", {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            siteId: "10000000",
            action: "member_checkin",
          }),
        }),
      ),
      patchMemberships(
        new Request("https://launch.faolla.com/api/memberships", {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            siteId: "10000000",
            action: "leave",
          }),
        }),
      ),
    ]);
    for (const response of responses) {
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), {
        error: "business_scope_required",
      });
      assertPrivateHeaders(response);
    }
  }
});
