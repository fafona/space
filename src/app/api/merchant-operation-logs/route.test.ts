import assert from "node:assert/strict";
import test from "node:test";
import { GET, POST } from "@/app/api/merchant-operation-logs/route";

test("operation logs reject invalid merchant ids before storage access", async () => {
  const response = await GET(new Request("https://www.faolla.com/api/merchant-operation-logs?siteId=invalid"));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_site_id" });
});

test("operation logs do not expose merchant data without an authenticated session", async () => {
  const response = await GET(new Request("https://www.faolla.com/api/merchant-operation-logs?siteId=10000000"));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "unauthorized" });
});

test("operation log writes reject untrusted cross-origin requests", async () => {
  const response = await POST(
    new Request("https://www.faolla.com/api/merchant-operation-logs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.invalid",
      },
      body: JSON.stringify({
        id: "test-log",
        siteId: "10000000",
        at: "2026-07-21T10:00:00.000Z",
        module: "test",
        action: "write",
        summary: "cross-origin write",
        status: "success",
      }),
    }),
  );
  assert.equal(response.status, 403);
});
