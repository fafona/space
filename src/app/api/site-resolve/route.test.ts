import test from "node:test";
import assert from "node:assert/strict";
import { GET, pickResolvedSiteRow } from "@/app/api/site-resolve/route";

test("pickResolvedSiteRow prefers numeric merchant ids over non-numeric placeholders", () => {
  const chosen = pickResolvedSiteRow([
    { merchant_id: "site-main", slug: "fafona", updated_at: "2026-03-10T10:00:00.000Z" },
    { merchant_id: "10000000", slug: "fafona", updated_at: "2026-03-09T10:00:00.000Z" },
  ]);

  assert.equal(chosen?.merchant_id, "10000000");
});

test("pickResolvedSiteRow prefers the newest numeric merchant row", () => {
  const chosen = pickResolvedSiteRow([
    { merchant_id: "10000000", slug: "fafona", updated_at: "2026-03-09T10:00:00.000Z" },
    { merchant_id: "10000001", slug: "fafona", updated_at: "2026-03-11T10:00:00.000Z" },
  ]);

  assert.equal(chosen?.merchant_id, "10000001");
});

test("site-resolve rejects empty prefixes before touching env or backend", async () => {
  const response = await GET(new Request("http://localhost/api/site-resolve?prefix="));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_prefix" });
});

