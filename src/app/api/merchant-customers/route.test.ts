import assert from "node:assert/strict";
import test from "node:test";
import { GET, POST } from "@/app/api/merchant-customers/route";

test("merchant customer API rejects an invalid site id before reading data", async () => {
  const response = await GET(
    new Request("https://faolla.com/api/merchant-customers?siteId=invalid"),
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_site_id");
});

test("merchant customer mutation rejects cross-origin requests", async () => {
  const response = await POST(
    new Request("https://faolla.com/api/merchant-customers", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
      },
      body: JSON.stringify({ siteId: "10000000", version: "", customers: [] }),
    }),
  );
  assert.equal(response.status, 403);
});
