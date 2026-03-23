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

test("rewrites wrapped storage urls with extra path prefixes to current origin", () => {
  assert.equal(
    normalizePublicAssetUrl(
      "http://localhost:3000/api/business-card-share/storage/v1/object/public/page-assets/a.webp",
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

test("rewrites storage urls from merchant subdomain origin back to apex domain", () => {
  assert.equal(
    normalizePublicAssetUrl("/storage/v1/object/public/page-assets/a.webp", "https://fafona.faolla.com"),
    "https://fafona.faolla.com/storage/v1/object/public/page-assets/a.webp",
  );
});

test("rewrites storage urls to portal base domain when no preferred origin is provided", () => {
  const previous = process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN;
  process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = "https://faolla.com";
  try {
    assert.equal(
      normalizePublicAssetUrl("http://101.44.37.126:8000/storage/v1/object/public/page-assets/a.webp"),
      "https://faolla.com/storage/v1/object/public/page-assets/a.webp",
    );
  } finally {
    process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = previous;
  }
});

test("prefers runtime origin over stale env when no preferred origin is provided", () => {
  const previousWindow = globalThis.window;
  const previousBaseDomain = process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN;
  process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = "https://www.fafona.com";
  Object.assign(globalThis, {
    window: {
      location: {
        origin: "https://faolla.com",
      },
    },
  });

  try {
    assert.equal(
      normalizePublicAssetUrl("http://101.44.37.126:8000/storage/v1/object/public/page-assets/a.webp"),
      "https://faolla.com/storage/v1/object/public/page-assets/a.webp",
    );
  } finally {
    process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = previousBaseDomain;
    if (typeof previousWindow === "undefined") {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.assign(globalThis, { window: previousWindow });
    }
  }
});

test("keeps data and blob urls unchanged", () => {
  assert.equal(normalizePublicAssetUrl("data:image/png;base64,abc", "https://faolla.com"), "data:image/png;base64,abc");
  assert.equal(normalizePublicAssetUrl("blob:http://faolla.com/test", "https://faolla.com"), "blob:http://faolla.com/test");
});
