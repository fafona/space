import assert from "node:assert/strict";
import test from "node:test";
import { normalizePublicAssetUrl } from "./publicAssetUrl";

test("keeps non-storage urls unchanged", () => {
  assert.equal(normalizePublicAssetUrl("https://example.com/a.png", "https://faolla.com"), "https://example.com/a.png");
});

test("rewrites absolute storage urls to current origin", () => {
  assert.equal(
    normalizePublicAssetUrl(
      "http://101.44.37.126:8000/storage/v1/object/public/page-assets/a.webp",
      "https://faolla.com",
    ),
    "https://faolla.com/storage/v1/object/public/page-assets/a.webp",
  );
});

test("rewrites relative storage urls to current origin", () => {
  assert.equal(
    normalizePublicAssetUrl("/storage/v1/object/public/page-assets/a.webp", "https://faolla.com/"),
    "https://faolla.com/storage/v1/object/public/page-assets/a.webp",
  );
});

test("keeps data and blob urls unchanged", () => {
  assert.equal(normalizePublicAssetUrl("data:image/png;base64,abc", "https://faolla.com"), "data:image/png;base64,abc");
  assert.equal(normalizePublicAssetUrl("blob:http://faolla.com/test", "https://faolla.com"), "blob:http://faolla.com/test");
});
