import test from "node:test";
import assert from "node:assert/strict";
import type { Block } from "@/data/homeBlocks";
import {
  isMissingPlatformMerchantIdColumn,
  isMissingPlatformSlugColumn,
} from "@/lib/platformPublished";
import { createPlatformPublishedGetHandler } from "@/lib/platformPublishedRoute.server";

test("platform-published schema helpers detect known missing-column errors", () => {
  assert.equal(isMissingPlatformSlugColumn('column pages.slug does not exist'), true);
  assert.equal(
    isMissingPlatformSlugColumn('could not find the "slug" column of "pages" in the schema cache'),
    true,
  );
  assert.equal(isMissingPlatformSlugColumn("other failure"), false);

  assert.equal(isMissingPlatformMerchantIdColumn('column pages.merchant_id does not exist'), true);
  assert.equal(
    isMissingPlatformMerchantIdColumn('could not find the "merchant_id" column of "pages" in the schema cache'),
    true,
  );
  assert.equal(isMissingPlatformMerchantIdColumn("other failure"), false);
});

test("platform-published returns published data with its public cache policy", async () => {
  const blocks: Block[] = [{ id: "intro", type: "text", props: { heading: "FAOLLA", text: "Published home" } }];
  let loads = 0;
  const GET = createPlatformPublishedGetHandler(async () => {
    loads += 1;
    return { blocks, error: null };
  });
  const response = await GET();
  assert.equal(loads, 1);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, blocks });
  assert.equal(response.headers.get("Cache-Control"), "public, s-maxage=30, stale-while-revalidate=120");
});

test("platform-published returns 404 for empty or missing published data", async () => {
  for (const blocks of [null, []]) {
    const GET = createPlatformPublishedGetHandler(async () => ({ blocks, error: null }));
    const response = await GET();
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "platform_published_not_found" });
    assert.equal(response.headers.get("Cache-Control"), null);
  }
});

test("platform-published preserves a loader's missing-environment 404 contract", async () => {
  const GET = createPlatformPublishedGetHandler(async () => ({
    blocks: null,
    error: "platform_published_env_missing",
  }));
  const response = await GET();
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "platform_published_env_missing" });
});

test("platform-published preserves structured 500 errors without applying the successful cache policy", async () => {
  for (const failure of [new Error("fixture_loader_failure"), null]) {
    const GET = createPlatformPublishedGetHandler(async () => { throw failure; });
    const response = await GET();
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: "platform_published_failed",
      message: failure instanceof Error ? failure.message : "unknown_error",
    });
    assert.equal(response.headers.get("Cache-Control"), null);
  }
});
