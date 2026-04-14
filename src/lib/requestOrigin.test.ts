import assert from "node:assert/strict";
import test from "node:test";
import { resolveTrustedPublicOrigin } from "./requestOrigin";

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
