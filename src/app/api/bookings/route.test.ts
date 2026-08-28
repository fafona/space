import assert from "node:assert/strict";
import test from "node:test";
import { GET, PATCH, POST } from "@/app/api/bookings/route";

const ORIGIN = "https://launch.faolla.com";

function assertPrivateHeaders(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
}

test("booking list validation errors are private and non-cacheable", async () => {
  const response = await GET(
    new Request(`${ORIGIN}/api/bookings?siteId=invalid`, { method: "GET" }),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_site_id" });
  assertPrivateHeaders(response);
});

test("public booking creation responses are private and non-cacheable", async () => {
  const response = await POST(
    new Request(`${ORIGIN}/api/bookings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ siteId: "invalid" }),
    }),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_site_id" });
  assertPrivateHeaders(response);
});

test("booking mutations keep origin failures private and non-cacheable", async () => {
  const response = await PATCH(
    new Request(`${ORIGIN}/api/bookings`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.example",
      },
      body: JSON.stringify({ siteId: "10000000", status: "confirmed" }),
    }),
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "forbidden_origin");
  assertPrivateHeaders(response);
});

test("an explicit business header never falls through to booking personal or public mutations", async () => {
  for (const accessToken of ["", "invalid-employee-token"]) {
    const headers = {
      "x-merchant-access-token": accessToken,
      cookie: "__Host-faolla-personal-auth-v2=forged-personal-cookie",
    };
    const responses = await Promise.all([
      GET(
        new Request(`${ORIGIN}/api/bookings?scope=personal`, { headers }),
      ),
      POST(
        new Request(`${ORIGIN}/api/bookings`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: "{not-json",
        }),
      ),
      PATCH(
        new Request(`${ORIGIN}/api/bookings`, {
          method: "PATCH",
          headers: {
            ...headers,
            "content-type": "application/json",
            origin: ORIGIN,
          },
          body: JSON.stringify({
            scope: "personal",
            action: "cancel",
            bookingId: "booking-1",
          }),
        }),
      ),
      PATCH(
        new Request(`${ORIGIN}/api/bookings`, {
          method: "PATCH",
          headers: {
            ...headers,
            "content-type": "application/json",
            origin: ORIGIN,
          },
          body: JSON.stringify({
            action: "update",
            bookingId: "booking-1",
            editToken: "public-edit-token",
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
