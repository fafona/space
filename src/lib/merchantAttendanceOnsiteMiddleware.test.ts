import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { middleware } from "../../middleware";

test("actual middleware permits phone camera only at the exact enabled canonical page, not old pages or redirects", async () => {
  const flags = ["FAOLLA_ATTENDANCE_SELF_ENABLED", "FAOLLA_ATTENDANCE_TERMINALS_ENABLED", "FAOLLA_ATTENDANCE_ONSITE_QR_ENABLED"];
  const keys = [...flags, "FAOLLA_CANONICAL_PORTAL_ORIGIN", "FAOLLA_SUPER_ADMIN_ORIGIN"], saved = new Map(keys.map(key => [key, process.env[key]]));
  const origin = "https://www.faolla.com", scan = "/enterprise/attendance-scan";
  try {
    process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN = origin; process.env.FAOLLA_SUPER_ADMIN_ORIGIN = "https://console.faolla.com";
    for (const key of flags) process.env[key] = "1";
    const allowed = await middleware(new NextRequest(origin + scan));
    assert.equal(allowed.headers.get("permissions-policy"), "camera=(self), microphone=(), payment=()");
    assert.equal(allowed.headers.get("referrer-policy"), "no-referrer");
    assert.match(allowed.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
    assert.equal(allowed.headers.get("x-frame-options"), "DENY");
    for (const key of flags) {
      delete process.env[key];
      assert.equal((await middleware(new NextRequest(origin + scan))).headers.get("permissions-policy"), "camera=(), microphone=(), payment=()");
      process.env[key] = "1";
    }
    for (const path of ["/enterprise", "/enterprise/attendance-terminal", "/enterprise/attendance-terminal/onsite", scan + "/extra", "/admin", "/login"]) {
      const response = await middleware(new NextRequest(origin + path));
      assert.equal(response.headers.get("permissions-policy"), "camera=(), microphone=(), payment=()", path);
      if (path !== "/enterprise/attendance-terminal/onsite") assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
    }
    for (const url of ["https://other.faolla.com" + scan, "http://www.faolla.com" + scan, "https://console.faolla.com" + scan]) {
      assert.equal((await middleware(new NextRequest(url))).headers.get("permissions-policy"), "camera=(), microphone=(), payment=()");
    }
  } finally { for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
