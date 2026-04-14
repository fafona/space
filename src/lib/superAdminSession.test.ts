import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveSuperAdminCookieDomain,
  resolveSuperAdminCookieDomainFromHostname,
} from "./superAdminSession";

test("resolveSuperAdminCookieDomainFromHostname folds www portal config back to root domain", () => {
  const previousBaseDomain = process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN;
  process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = "https://www.faolla.com";
  try {
    assert.equal(resolveSuperAdminCookieDomainFromHostname("faolla.com"), "faolla.com");
    assert.equal(resolveSuperAdminCookieDomainFromHostname("www.faolla.com"), "faolla.com");
    assert.equal(resolveSuperAdminCookieDomainFromHostname("ops.faolla.com"), "faolla.com");
  } finally {
    process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = previousBaseDomain;
  }
});

test("resolveSuperAdminCookieDomain uses host header when present", () => {
  const previousBaseDomain = process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN;
  process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = "https://www.faolla.com";
  try {
    const request = new Request("https://www.faolla.com/api/super-admin/auth/complete", {
      headers: {
        host: "faolla.com",
      },
    });
    assert.equal(resolveSuperAdminCookieDomain(request), "faolla.com");
  } finally {
    process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = previousBaseDomain;
  }
});

test("resolveSuperAdminCookieDomainFromHostname falls back to the live request domain when portal config is stale", () => {
  const previousBaseDomain = process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN;
  process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = "https://www.fafona.com";
  try {
    assert.equal(resolveSuperAdminCookieDomainFromHostname("www.faolla.com"), "faolla.com");
    assert.equal(resolveSuperAdminCookieDomainFromHostname("faolla.com"), "faolla.com");
  } finally {
    process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = previousBaseDomain;
  }
});
