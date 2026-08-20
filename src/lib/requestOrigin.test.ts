import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOriginScopedCacheKey,
  resolveConfiguredPublicRequestOrigin,
  resolveForwardedRequestOrigin,
  resolvePublicOriginFromHeaders,
  resolveTrustedPublicOrigin,
} from "./requestOrigin";

test("resolveForwardedRequestOrigin restores the public origin behind an internal proxy url", () => {
  const request = new Request("http://localhost:3000/card/example", {
    headers: {
      host: "localhost:3000",
      "x-forwarded-host": "faolla.com",
      "x-forwarded-proto": "https",
    },
  });

  assert.equal(resolveForwardedRequestOrigin(request), "https://faolla.com");
});

test("resolveForwardedRequestOrigin ignores a spoofed forwarded host when Host is already public", () => {
  const request = new Request("https://faolla.com/card/example", {
    headers: {
      host: "faolla.com",
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "http",
    },
  });

  assert.equal(resolveForwardedRequestOrigin(request), "https://faolla.com");
});

test("resolvePublicOriginFromHeaders uses a public fallback URL as the direct host boundary", () => {
  const headers = new Headers({
    "x-forwarded-host": "evil.example",
    "x-forwarded-proto": "http",
  });

  assert.equal(resolvePublicOriginFromHeaders(headers, "https://faolla.com/card/example"), "https://faolla.com");
});

test("origin-scoped cache keys cannot collide across public origins", () => {
  assert.equal(
    buildOriginScopedCacheKey("share-key", "https://faolla.com/card/example"),
    "share-key|https://faolla.com",
  );
  assert.notEqual(
    buildOriginScopedCacheKey("share-key", "https://faolla.com"),
    buildOriginScopedCacheKey("share-key", "https://public.faolla.com"),
  );
});

test("configured public request origin rejects a direct host outside the configured root", () => {
  const previousBaseDomain = process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN;
  process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = "https://www.faolla.com";
  try {
    assert.equal(
      resolveConfiguredPublicRequestOrigin(new Request("https://evil.example/card/example")),
      "https://www.faolla.com",
    );
    assert.equal(
      resolveConfiguredPublicRequestOrigin(new Request("https://tenant.faolla.com/card/example")),
      "https://tenant.faolla.com",
    );
  } finally {
    if (previousBaseDomain === undefined) delete process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN;
    else process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = previousBaseDomain;
  }
});

test("configured public request origin ignores off-root forwarded hosts on public requests", () => {
  const previousBaseDomain = process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN;
  process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = "https://www.faolla.com";
  try {
    const request = new Request("https://public.faolla.com/card/example", {
      headers: {
        host: "public.faolla.com",
        "x-forwarded-host": "evil.example",
        "x-forwarded-proto": "http",
      },
    });
    assert.equal(resolveConfiguredPublicRequestOrigin(request), "https://public.faolla.com");
  } finally {
    if (previousBaseDomain === undefined) delete process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN;
    else process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = previousBaseDomain;
  }
});

test("resolveTrustedPublicOrigin keeps the configured origin when it matches the live base domain", () => {
  const previousBaseDomain = process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN;
  process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = "https://www.faolla.com";
  try {
    assert.equal(
      resolveTrustedPublicOrigin("https://faolla.com/api/super-admin/auth/request"),
      "https://www.faolla.com",
    );
  } finally {
    process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = previousBaseDomain;
  }
});

test("resolveTrustedPublicOrigin prefers the configured origin over localhost requests", () => {
  const previousBaseDomain = process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN;
  process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = "https://www.faolla.com";
  try {
    assert.equal(
      resolveTrustedPublicOrigin("http://localhost:3000/api/auth/merchant-signup"),
      "https://www.faolla.com",
    );
  } finally {
    process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = previousBaseDomain;
  }
});

test("resolveTrustedPublicOrigin falls back to the live request origin when the configured base domain is stale", () => {
  const previousBaseDomain = process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN;
  process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = "https://www.fafona.com";
  try {
    assert.equal(
      resolveTrustedPublicOrigin("https://www.faolla.com/api/super-admin/auth/request"),
      "https://www.faolla.com",
    );
  } finally {
    process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = previousBaseDomain;
  }
});

test("forwarded public origins override a stale configured base domain", () => {
  const previousBaseDomain = process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN;
  process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = "https://www.fafona.com";
  try {
    const request = new Request("http://localhost:3000/card/example", {
      headers: {
        "x-forwarded-host": "faolla.com",
        "x-forwarded-proto": "https",
      },
    });
    assert.equal(
      resolveTrustedPublicOrigin(resolveForwardedRequestOrigin(request)),
      "https://faolla.com",
    );
  } finally {
    process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = previousBaseDomain;
  }
});
