import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import {
  LEGACY_SUPER_ADMIN_SESSION_COOKIE,
  SUPER_ADMIN_DEVICE_ID_COOKIE,
  SUPER_ADMIN_SESSION_COOKIE,
  SUPER_ADMIN_TRUSTED_DEVICE_COOKIE,
  clearSuperAdminSessionCookies,
} from "./superAdminSession";

test("super-admin cookie names are host-prefixed", () => {
  for (const name of [
    SUPER_ADMIN_SESSION_COOKIE,
    SUPER_ADMIN_DEVICE_ID_COOKIE,
    SUPER_ADMIN_TRUSTED_DEVICE_COOKIE,
  ]) {
    assert.match(name, /^__Host-/);
  }
});

test("super-admin cleanup expires new and legacy parent-domain cookies", () => {
  const response = NextResponse.json({ ok: true });
  clearSuperAdminSessionCookies(response, new Request("https://console.faolla.com/super-admin/logout"));
  const setCookie = response.headers.get("set-cookie") ?? "";
  assert.match(setCookie, new RegExp(`${SUPER_ADMIN_SESSION_COOKIE}=`));
  assert.match(setCookie, new RegExp(`${LEGACY_SUPER_ADMIN_SESSION_COOKIE}=`));
  assert.equal((setCookie.match(new RegExp(`${LEGACY_SUPER_ADMIN_SESSION_COOKIE}=`, "g")) ?? []).length, 2);
  assert.match(setCookie, /Domain=faolla\.com/i);
  assert.match(setCookie, /Max-Age=0/i);
});
