import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "@/app/api/auth/status/route";

test("auth-status rejects invalid email payloads", async () => {
  const response = await POST(
    new Request("http://localhost/api/auth/status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "invalid-email",
      }),
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_email" });
});

test("auth-status returns a generic success response for valid emails", async () => {
  const response = await POST(
    new Request("http://localhost/api/auth/status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "merchant@example.com",
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});
