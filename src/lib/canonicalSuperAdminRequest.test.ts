import assert from "node:assert/strict";
import test from "node:test";
import {
  isCanonicalSuperAdminRequest,
  resolveCanonicalSuperAdminHostname,
} from "@/lib/canonicalSuperAdminRequest";

test("super-admin accepts only the dedicated console origin", () => {
  const previous = process.env.FAOLLA_SUPER_ADMIN_ORIGIN;
  process.env.FAOLLA_SUPER_ADMIN_ORIGIN = "https://console.faolla.com";
  try {
    assert.equal(resolveCanonicalSuperAdminHostname(), "console.faolla.com");
    assert.equal(
      isCanonicalSuperAdminRequest(new Request("https://console.faolla.com/api/super-admin/auth/session")),
      true,
    );
    assert.equal(
      isCanonicalSuperAdminRequest(new Request("https://www.faolla.com/api/super-admin/auth/session")),
      false,
    );
    assert.equal(
      isCanonicalSuperAdminRequest(new Request("https://merchant.faolla.com/api/super-admin/auth/session")),
      false,
    );
  } finally {
    if (previous === undefined) delete process.env.FAOLLA_SUPER_ADMIN_ORIGIN;
    else process.env.FAOLLA_SUPER_ADMIN_ORIGIN = previous;
  }
});

test("explicit console stays independent of the launch portal and rejects its accidental derived host", () => {
  const originalConsole = process.env.FAOLLA_SUPER_ADMIN_ORIGIN;
  const originalPortal = process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN;
  process.env.FAOLLA_SUPER_ADMIN_ORIGIN = "https://console.faolla.com";
  process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN = "https://launch.faolla.com";
  try {
    assert.equal(resolveCanonicalSuperAdminHostname(), "console.faolla.com");
    for (const [host, allowed] of [["console.faolla.com", true], ["launch.faolla.com", false], ["console.launch.faolla.com", false], ["www.faolla.com", false]] as const) {
      const request = new Request("http://127.0.0.1:3102/api/super-admin/auth/request", { headers: { host, "x-forwarded-host": host, "x-forwarded-proto": "https" } });
      assert.equal(isCanonicalSuperAdminRequest(request), allowed);
    }
  } finally {
    if (originalConsole === undefined) delete process.env.FAOLLA_SUPER_ADMIN_ORIGIN;
    else process.env.FAOLLA_SUPER_ADMIN_ORIGIN = originalConsole;
    if (originalPortal === undefined) delete process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN;
    else process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN = originalPortal;
  }
});
