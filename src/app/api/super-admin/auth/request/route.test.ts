import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "@/app/api/super-admin/auth/request/route";

test("super-admin auth request rejects wrong credentials before touching backend", async () => {
  const response = await POST(
    new Request("http://localhost/api/super-admin/auth/request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        account: "wrong",
        password: "bad",
        deviceId: "device-12345678",
        deviceLabel: "Windows / Chrome",
      }),
    }),
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "invalid_credentials" });
});

test("super-admin auth request rejects malformed devices", async () => {
  const response = await POST(
    new Request("http://localhost/api/super-admin/auth/request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        account: "felix",
        password: "987987",
        deviceId: "short",
        deviceLabel: "Windows / Chrome",
      }),
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_device" });
});
