import test from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import {
  RESET_PASSWORD_RECOVERY_COOKIE,
  RESET_PASSWORD_RECOVERY_REFRESH_COOKIE,
  clearResetRecoveryCookies,
  readResetRecoveryCookie,
  readResetRecoveryRefreshCookie,
  setResetRecoveryCookies,
} from "@/lib/resetPasswordRecoverySession";

test("reset recovery cookies can be read from request headers", () => {
  const request = new Request("http://localhost/reset-password", {
    headers: {
      cookie: `${RESET_PASSWORD_RECOVERY_COOKIE}=access-token; ${RESET_PASSWORD_RECOVERY_REFRESH_COOKIE}=refresh-token`,
    },
  });

  assert.equal(readResetRecoveryCookie(request), "access-token");
  assert.equal(readResetRecoveryRefreshCookie(request), "refresh-token");
});

test("reset recovery cookies can be written and cleared", () => {
  const response = NextResponse.json({ ok: true });
  setResetRecoveryCookies(response, {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    maxAgeSeconds: 900,
  });

  const setCookieHeader = response.headers.get("set-cookie") ?? "";
  assert.match(setCookieHeader, /merchant-space-reset-recovery=access-token/i);
  assert.match(setCookieHeader, /merchant-space-reset-recovery-refresh=refresh-token/i);

  const clearedResponse = NextResponse.json({ ok: true });
  clearResetRecoveryCookies(clearedResponse);
  const clearedSetCookieHeader = clearedResponse.headers.get("set-cookie") ?? "";
  assert.match(clearedSetCookieHeader, /merchant-space-reset-recovery=;/i);
  assert.match(clearedSetCookieHeader, /merchant-space-reset-recovery-refresh=;/i);
});
