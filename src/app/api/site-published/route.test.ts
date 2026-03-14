import test from "node:test";
import assert from "node:assert/strict";
import {
  GET,
  isMissingPublishedSlugColumn,
  pickPublishedPageRow,
} from "@/app/api/site-published/route";
import type { Block } from "@/data/homeBlocks";

const demoBlocks = [{ id: "search", type: "search-bar", props: { heading: "搜索" } }] as Block[];

test("pickPublishedPageRow ignores empty block payloads and keeps the newest valid row", () => {
  const chosen = pickPublishedPageRow([
    { blocks: [], slug: "old-empty", updated_at: "2026-03-09T10:00:00.000Z" },
    { blocks: demoBlocks, slug: "old-valid", updated_at: "2026-03-10T10:00:00.000Z" },
    { blocks: demoBlocks, slug: "new-valid", updated_at: "2026-03-11T10:00:00.000Z" },
  ]);

  assert.equal(chosen?.slug, "new-valid");
});

test("isMissingPublishedSlugColumn detects known schema-cache slug errors", () => {
  assert.equal(isMissingPublishedSlugColumn('column pages.slug does not exist'), true);
  assert.equal(
    isMissingPublishedSlugColumn('could not find the "slug" column of "pages" in the schema cache'),
    true,
  );
  assert.equal(isMissingPublishedSlugColumn("other failure"), false);
});

test("site-published rejects invalid site ids before touching env or backend", async () => {
  const response = await GET(new Request("http://localhost/api/site-published?siteId=portal"));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_site_id" });
});

