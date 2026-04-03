import assert from "node:assert/strict";
import test from "node:test";
import {
  buildResetPasswordRecoveryUrl,
  type ResetPasswordRecoveryPayload,
} from "@/lib/resetPasswordRecoveryPayload";

test("buildResetPasswordRecoveryUrl appends direct session payload as hash params", () => {
  const payload: ResetPasswordRecoveryPayload = {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    tokenHash: "",
    code: "",
    type: "recovery",
    capturedAt: Date.now(),
  };
  const url = buildResetPasswordRecoveryUrl("https://faolla.com/reset-password", payload);
  assert.equal(url.pathname, "/reset-password");
  assert.equal(url.hash, "#access_token=access-token&refresh_token=refresh-token&type=recovery");
});

test("buildResetPasswordRecoveryUrl keeps target unchanged when payload is empty", () => {
  const url = buildResetPasswordRecoveryUrl("https://faolla.com/reset-password", null);
  assert.equal(url.toString(), "https://faolla.com/reset-password");
});
