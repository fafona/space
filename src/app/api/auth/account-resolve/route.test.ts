import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "@/app/api/auth/account-resolve/route";

test("account-resolve rejects empty accounts", async () => {
  const response = await POST(
    new Request("http://localhost/api/auth/account-resolve", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ account: "   " }),
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_account" });
});

test("account-resolve returns a generic success payload for valid account probes", async () => {
  const response = await POST(
    new Request("http://localhost/api/auth/account-resolve", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ account: "merchant-lookup" }),
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});
