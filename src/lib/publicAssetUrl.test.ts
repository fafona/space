import assert from "node:assert/strict";
import test from "node:test";
import { normalizePublicAssetResponseUrl, normalizePublicAssetUrl } from "./publicAssetUrl";

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

test("falls back to a browser-safe relative path when no public origin is configured", () => {
  const previousWindow = globalThis.window;
  const previousBaseDomain = process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN;
  delete process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN;
  Reflect.deleteProperty(globalThis, "window");

  try {
    assert.equal(
      normalizePublicAssetResponseUrl("http://127.0.0.1:8000/storage/v1/object/public/page-assets/audio.mp3"),
      "/storage/v1/object/public/page-assets/audio.mp3",
    );
  } finally {
    if (typeof previousBaseDomain === "undefined") {
      delete process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN;
    } else {
      process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = previousBaseDomain;
    }
    if (typeof previousWindow === "undefined") {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.assign(globalThis, { window: previousWindow });
    }
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

test("allows only inert inline media and same-origin blob urls", () => {
  const previousWindow = globalThis.window;
  Object.assign(globalThis, { window: { location: { origin: "https://faolla.com" } } });
  assert.equal(normalizePublicAssetUrl("data:image/png;base64,abc", "https://faolla.com"), "data:image/png;base64,abc");
  assert.equal(normalizePublicAssetUrl("data:image/svg+xml,<svg onload='x'>", "https://faolla.com"), "");
  assert.equal(normalizePublicAssetUrl("data:text/html,<script>x</script>", "https://faolla.com"), "");
  assert.equal(normalizePublicAssetUrl("blob:https://faolla.com/test", "https://faolla.com"), "blob:https://faolla.com/test");
  assert.equal(normalizePublicAssetUrl("blob:https://attacker.example/test", "https://faolla.com"), "");
  if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window");
  else Object.assign(globalThis, { window: previousWindow });
});

test("rejects executable, insecure, and protocol-relative asset URLs", () => {
  assert.equal(normalizePublicAssetUrl("javascript:alert(1)"), "");
  assert.equal(normalizePublicAssetUrl("http://example.com/a.png"), "");
  assert.equal(normalizePublicAssetUrl("//example.com/a.png"), "");
  assert.equal(normalizePublicAssetUrl("/\\example.com/a.png"), "");
});
