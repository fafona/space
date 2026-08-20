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
